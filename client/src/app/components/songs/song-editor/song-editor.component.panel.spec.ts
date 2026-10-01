import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { SongDoc } from '../../../models/song.model';
import { deletedDatabase } from '../../../services/indexed-db.spec-helper';
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

/** "Last Dance" in C major: C over "Got" and Am over "thinking". */
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

/** A clock whose timers never come due: nothing autosaves behind a spec's back, and the page's destroy still saves. */
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

@Component({ standalone: true, template: '<p class="library-stand-in">Library</p>' })
class LibraryStandIn {}

/**
 * The song page's side panel: its tab, its hide and show, and the Chords tab acting on the sheet - a click placing a
 * chord at the caret the lyrics last had, or replacing the selected chord - against real routing and a song library
 * of its own in real IndexedDB.
 */
describe('SongEditorComponent: the side panel', () => {
  let harness: RouterTestingHarness;
  let library: SongLibraryService;
  let dbName: string;

  beforeEach(async () => {
    dbName = `song-editor-panel-spec-${Math.random().toString(36).slice(2)}`;
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
    }).compileComponents();
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

  /** Stores "Last Dance", opens it, and waits for its sheet. */
  async function openLastDance(): Promise<string> {
    const created = await library.createSong();
    const song: SongDoc = await library.saveSong({ ...created, content: lastDance().toJSON() });
    await harness.navigateByUrl(`/songs/${song.id}`, SongEditorComponent);
    await until(() => host().querySelector('.ProseMirror') !== null);
    return song.id;
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
  const editor = (): HTMLElement => element('.ProseMirror');

  /** The Chords tab's cell `index` in `group`. */
  function cell(group: string, index: number): HTMLButtonElement {
    const cells = host().querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] .cell`);
    const found = cells.item(index);
    if (!found) throw new Error(`No cell ${index} in ${group}`);
    return found;
  }

  function press(target: HTMLElement): void {
    target.click();
    harness.detectChanges();
  }

  /** The caret at `pos` in the lyrics, which have the focus - and then the focus somewhere else, as a click away does. */
  function caretAt(pos: number): void {
    sheet().focus();
    sheet().run(state => ({ kind: 'edit', tr: state.tr.setSelection(TextSelection.create(state.doc, pos)) }));
    element<HTMLInputElement>('.song-title').focus();
    harness.detectChanges();
  }

  // "Last Dance": the section opens at 0, its line at 1, C at 2, "Got me " from 3, Am at 10, "thinking" from 11.

  describe('the tabs', () => {
    it('is a tablist of one tab, Chords, selected and controlling its panel', async () => {
      await openLastDance();

      const tablist = element('[role="tablist"]');
      const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
      expect(tablist.getAttribute('aria-label')).toBe('Song panel');
      expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['Chords']);

      const [chords] = tabs;
      const panel = element(`#${chords.getAttribute('aria-controls')}`);
      expect(chords.getAttribute('aria-selected')).toBe('true');
      expect(chords.getAttribute('tabindex')).toBe('0');
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(chords.id);
      expect(panel.querySelector('app-song-chord-panel')).not.toBeNull();
    });

    it('keeps the focus on the selected tab under the arrow keys, Home and End', async () => {
      await openLastDance();
      const chords = element('[role="tab"]');
      chords.focus();

      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        chords.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        harness.detectChanges();
        expect(document.activeElement).toBe(chords);
        expect(chords.getAttribute('aria-selected')).toBe('true');
      }
    });
  });

  describe('hide and show', () => {
    it('hides the panel and shows it again, remembering the choice for the next song opened', async () => {
      await openLastDance();
      const toggle = element<HTMLButtonElement>('.panel-toggle');
      expect(toggle.getAttribute('aria-label')).toBe('Hide panel');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(element(`#${toggle.getAttribute('aria-controls')}`).classList).toContain('side-panel');

      toggle.focus();
      press(toggle);
      expect(host().querySelector('[role="tabpanel"]')).toBeNull();
      expect(toggle.getAttribute('aria-label')).toBe('Show panel');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
      expect(TestBed.inject(SongSheetPreferencesService).preferences.panelOpen).toBeFalse();

      await harness.navigateByUrl('/songs');
      await openLastDance();
      expect(host().querySelector('[role="tabpanel"]')).toBeNull();

      press(element('.panel-toggle'));
      expect(host().querySelector('[role="tabpanel"] app-song-chord-panel')).not.toBeNull();
    });
  });

  describe('the Chords tab', () => {
    it('shows the song’s key and transposes the song from its arrows', async () => {
      await openLastDance();
      expect(text('.panel-key-name')).toBe('C Ionian (Major)');

      press(element('.panel-transpose-up'));
      expect(names()).toEqual(['Db', 'Bbm']);
      expect(text('.panel-key-name')).toBe('Db Ionian (Major)');
      expect(element<HTMLSelectElement>('.key-tonic').value).toBe('1b');
      expect(text('[data-group="triads"] .cell .cell-primary')).toBe('Db');

      press(element('.panel-transpose-down'));
      expect(names()).toEqual(['C', 'Am']);
    });

    it('places a clicked chord at the caret the lyrics last had, as one undo step, and gives them the focus back', async () => {
      await openLastDance();
      caretAt(7);

      press(cell('triads', 3));

      expect(names()).toEqual(['C', 'F', 'Am']);
      expect(document.activeElement).toBe(editor());
      expect(editorState().selection.from).toBe(8);
      sheet().undo();
      harness.detectChanges();
      expect(names()).toEqual(['C', 'Am']);
    });

    it('builds a progression left to right from repeated clicks', async () => {
      await openLastDance();
      caretAt(7);

      press(cell('triads', 3));
      press(cell('sevenths', 4));
      press(cell('borrowed', 4));

      expect(names()).toEqual(['C', 'F', 'G7', 'Bb', 'Am']);
      expect(editorState().selection.from).toBe(10);
      expect(editorState().doc.textContent).toBe('Got me thinking');
      sheet().undo();
      harness.detectChanges();
      expect(names()).toEqual(['C', 'F', 'G7', 'Am']);
    });

    it('replaces the chord selected on the sheet, which stays selected and marked', async () => {
      await openLastDance();
      press(host().querySelectorAll<HTMLElement>('.song-chord-name')[1]);
      expect(Array.from(host().querySelectorAll('.cell.on'))).toEqual([cell('triads', 5)]);
      expect(text('.panel-hint')).toBe('Click a chord to replace the one selected on the sheet.');

      press(cell('triads', 1));

      expect(names()).toEqual(['C', 'Dm']);
      const selection = editorState().selection;
      expect(selection instanceof NodeSelection && selection.from).toBe(10);
      expect(document.activeElement).toBe(editor());
      expect(Array.from(host().querySelectorAll('.cell.on'))).toEqual([cell('triads', 1)]);
    });

    it('says why nothing was placed when the lyrics have not had a caret yet', async () => {
      await openLastDance();

      press(cell('triads', 3));

      expect(names()).toEqual(['C', 'Am']);
      expect(messages()).toBe('Put the caret in a line of lyrics to add a chord there.');
      expect(document.activeElement).not.toBe(editor());
    });
  });
});
