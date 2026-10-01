import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Node } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey, RollNote } from '../../../models/progression.model';
import { ChordAtomAttrs, SongDoc } from '../../../models/song.model';
import { deletedDatabase } from '../../../services/indexed-db.spec-helper';
import { ProgressionPlayerService } from '../../../services/progression-player.service';
import { AutosaveClock } from '../../../services/song-autosave';
import { chordSlotOf } from '../../../services/song-document';
import { SONG_LIBRARY_DB, SongLibraryService } from '../../../services/song-library.service';
import { songSchema } from '../../../services/song-schema';
import { SONG_PREFERENCES_STORAGE, SongSheetPreferencesService } from '../../../services/song-sheet-preferences.service';
import { SongSheetComponent } from '../song-sheet/song-sheet.component';
import { SONG_AUTOSAVE_CLOCK, SongEditorComponent } from './song-editor.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

function chord(degree: number): Node {
  const at: ChordDegree = {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
  return songSchema.node('chord', chordSlotOf(at, C_MAJOR, IONIAN, FOUR_FOUR));
}

/** "Last Dance" in C major at 100 BPM: C over "Got" and Am over "thinking". */
function lastDance(): Node {
  return songSchema.node(
    'doc',
    { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR },
    [
      songSchema.node('section', { id: crypto.randomUUID(), label: 'Verse 1', kind: 'verse' }, [
        songSchema.node('lyricLine', null, [chord(0), songSchema.text('Got me '), chord(5), songSchema.text('thinking')])
      ])
    ]
  );
}

/** A clock whose timers never come due: nothing autosaves behind a spec's back. */
class StoppedClock implements AutosaveClock {
  now(): number {
    return Date.now();
  }
  setTimeout(): unknown {
    return 0;
  }
  clearTimeout(): void {
    return;
  }
}

/** One audition asked of the player. */
interface Audition {
  notes: readonly RollNote[];
  seconds: number;
  tempo: number;
}

/**
 * The player, as far as the song page uses it: it records each audition, and fails one with `failure` as a browser
 * that will not start audio does. No Tone, so nothing here touches the headless browser's audio context.
 */
class FakePlayer implements Pick<ProgressionPlayerService, 'audition'> {
  readonly auditions: Audition[] = [];
  failure: Error | null = null;

  audition(notes: readonly RollNote[], seconds: number, tempo: number): Promise<void> {
    this.auditions.push({ notes, seconds, tempo });
    return this.failure === null ? Promise.resolve() : Promise.reject(this.failure);
  }
}

@Component({ standalone: true, template: '<p class="library-stand-in">Library</p>' })
class LibraryStandIn {}

/**
 * Hearing a chord on the song page: a chord the Chords tab places sounds as it lands (unless the viewer has turned
 * that off), the popover's Hear it plays its chord, and a click on a chord's name - which is for editing - is silent.
 * Against real routing and a song library of its own in real IndexedDB, with the player faked.
 */
describe('SongEditorComponent: hearing chords', () => {
  let harness: RouterTestingHarness;
  let library: SongLibraryService;
  let player: FakePlayer;
  let dbName: string;

  beforeEach(async () => {
    dbName = `song-editor-audition-spec-${Math.random().toString(36).slice(2)}`;
    player = new FakePlayer();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'songs/:id', component: SongEditorComponent },
          { path: 'songs', component: LibraryStandIn }
        ]),
        { provide: SONG_LIBRARY_DB, useValue: dbName },
        { provide: SONG_AUTOSAVE_CLOCK, useValue: new StoppedClock() },
        { provide: SONG_PREFERENCES_STORAGE, useValue: null }
      ]
    })
      .overrideComponent(SongEditorComponent, {
        set: { providers: [{ provide: ProgressionPlayerService, useValue: player }] }
      })
      .compileComponents();
    library = TestBed.inject(SongLibraryService);
    harness = await RouterTestingHarness.create();
  });

  afterEach(async () => {
    harness.fixture.destroy();
    await new Promise(resolve => setTimeout(resolve, 50));
    await deletedDatabase(dbName);
  });

  const host = (): HTMLElement => harness.fixture.nativeElement;
  const text = (selector: string): string => host().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const messages = (): string => text('.editor-messages');
  const names = (): string[] => Array.from(host().querySelectorAll('.song-chord-name')).map(name => name.textContent ?? '');

  function element<T extends HTMLElement>(selector: string): T {
    const found = host().querySelector<T>(selector);
    if (!found) throw new Error(`No ${selector} on the page`);
    return found;
  }

  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; waited < 2000; waited += 10) {
      harness.detectChanges();
      if (done()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    harness.detectChanges();
  }

  async function openLastDance(): Promise<void> {
    const created = await library.createSong();
    const song: SongDoc = await library.saveSong({ ...created, content: lastDance().toJSON() });
    await harness.navigateByUrl(`/songs/${song.id}`, SongEditorComponent);
    await until(() => host().querySelector('.ProseMirror') !== null);
  }

  const sheet = (): SongSheetComponent => {
    const found = harness.fixture.debugElement.query(By.directive(SongSheetComponent));
    if (!found) throw new Error('No sheet on the page');
    return found.componentInstance;
  };
  const editorState = (): EditorState => {
    const state = sheet().editorState();
    if (!state) throw new Error('No editor');
    return state;
  };

  /** The song's chords now, in order, as the sheet holds them. */
  function chords(): ChordAtomAttrs[] {
    const found: ChordAtomAttrs[] = [];
    editorState().doc.descendants(node => {
      if (node.type.name === 'chord') found.push(node.attrs as ChordAtomAttrs);
    });
    return found;
  }

  function cell(group: string, index: number): HTMLButtonElement {
    const found = host().querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] .cell`).item(index);
    if (!found) throw new Error(`No cell ${index} in ${group}`);
    return found;
  }

  function press(target: HTMLElement): void {
    target.click();
    harness.detectChanges();
  }

  /** The caret at `pos` in the lyrics, and then the focus elsewhere, as a click away does. */
  function caretAt(pos: number): void {
    sheet().focus();
    sheet().run(state => ({ kind: 'edit', tr: state.tr.setSelection(TextSelection.create(state.doc, pos)) }));
    element<HTMLInputElement>('.song-title').focus();
    harness.detectChanges();
  }

  const chordName = (index: number): HTMLElement => host().querySelectorAll<HTMLElement>('.song-chord-name')[index];

  // "Last Dance": the section opens at 0, its line at 1, C at 2, "Got me " from 3, Am at 10, "thinking" from 11.

  describe('placing from the Chords tab', () => {
    it('plays the chord it places, voiced as it was placed, at the song\'s tempo, as a short stab', async () => {
      await openLastDance();
      caretAt(7);

      press(cell('triads', 3));

      expect(names()).toEqual(['C', 'F', 'Am']);
      const placed = chords()[1];
      expect(player.auditions).toEqual([{ notes: placed.notes, seconds: 1.5, tempo: 100 }]);
      expect(placed.notes.length).toBe(3);
    });

    it('plays the new chord when a click replaces the one selected on the sheet', async () => {
      await openLastDance();
      press(chordName(1));

      press(cell('triads', 1));

      expect(names()).toEqual(['C', 'Dm']);
      expect(player.auditions.map(audition => audition.notes)).toEqual([chords()[1].notes]);
    });

    it('plays nothing when nothing was placed', async () => {
      await openLastDance();

      press(cell('triads', 3));

      expect(names()).toEqual(['C', 'Am']);
      expect(player.auditions).toEqual([]);
    });

    it('places silently once the viewer has turned the sound off, and remembers that', async () => {
      await openLastDance();
      const toggle = element<HTMLButtonElement>('.panel-sound');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      press(toggle);
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(TestBed.inject(SongSheetPreferencesService).preferences.playOnPlace).toBeFalse();

      caretAt(7);
      press(cell('triads', 3));
      expect(names()).toEqual(['C', 'F', 'Am']);
      expect(player.auditions).toEqual([]);
    });
  });

  describe('the popover', () => {
    it('plays its chord on Hear it, with the sound on or off', async () => {
      await openLastDance();
      press(element('.panel-sound'));
      press(chordName(1));

      press(element('.hear-chord'));

      expect(player.auditions).toEqual([{ notes: chords()[1].notes, seconds: 1.5, tempo: 100 }]);
      expect(host().querySelector('app-song-chord-popover [role="dialog"]')).not.toBeNull();
    });
  });

  it('opens a chord whose name is clicked without playing it', async () => {
    await openLastDance();

    press(chordName(0));

    expect(host().querySelector('app-song-chord-popover [role="dialog"]')).not.toBeNull();
    expect(player.auditions).toEqual([]);
  });

  it('says in the live region why there was no sound, and tries again on the next click', async () => {
    await openLastDance();
    caretAt(7);
    player.failure = new Error('The AudioContext was not allowed to start');

    press(cell('triads', 3));
    await until(() => messages() !== '');

    expect(messages()).toBe('Sound could not start: The AudioContext was not allowed to start');
    expect(names()).toEqual(['C', 'F', 'Am']);

    player.failure = null;
    caretAt(8);
    press(cell('triads', 4));
    expect(player.auditions.length).toBe(2);
  });
});
