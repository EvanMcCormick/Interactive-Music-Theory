import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Node } from 'prosemirror-model';
import { createExtensions } from '../../../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../../../models/progression.model';
import { SongDoc } from '../../../models/song.model';
import { deletedDatabase } from '../../../services/indexed-db.spec-helper';
import {
  PROGRESSION_HANDOFF_STORAGE,
  ProgressionHandoffService,
  ProgressionReturn
} from '../../../services/progression-handoff.service';
import { ProgressionPlayerService } from '../../../services/progression-player.service';
import { ProgressionService } from '../../../services/progression.service';
import { AutosaveClock } from '../../../services/song-autosave';
import { chordSlotOf, sectionProgressionOf, sectionsOf } from '../../../services/song-document';
import { SONG_LIBRARY_DB, SongLibraryService } from '../../../services/song-library.service';
import { songSchema } from '../../../services/song-schema';
import { SONG_PREFERENCES_STORAGE } from '../../../services/song-sheet-preferences.service';
import { SONG_AUTOSAVE_CLOCK, SongEditorComponent } from './song-editor.component';

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

function degreeAt(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: 3,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

function chord(degree: number): Node {
  return songSchema.node('chord', chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR));
}

/** "Last Dance" in C major: one verse, C over "Got" and Am over "thinking". */
function lastDance(): Node {
  return songSchema.node(
    'doc',
    { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR },
    [
      songSchema.node('section', { id: crypto.randomUUID(), label: 'Verse 1', kind: 'verse' }, [
        songSchema.node('lyricLine', null, [
          chord(0),
          songSchema.text('Got me '),
          chord(5),
          songSchema.text('thinking')
        ])
      ])
    ]
  );
}

/** Time that moves only by hand: these specs save by flushing, never by waiting out autosave's pause. */
class StillClock implements AutosaveClock {
  now(): number {
    return Date.now();
  }

  setTimeout(): unknown {
    return 0;
  }

  clearTimeout(): void {
    // Nothing is ever pending.
  }
}

@Component({ standalone: true, template: '<p class="progression-stand-in">Progression</p>' })
class ProgressionStandIn {}

/**
 * Open in Progression from the song page, and what the page makes of what comes back (brief decision 7): the section
 * menu's item, the save before leaving, and a return applied on load with its notices in the live region. Against real
 * routing, the real hand-off and progression services, and a song library of its own in real IndexedDB; the
 * Progression page is a stand-in, since what happens there is `ProgressionService`'s.
 */
describe('SongEditorComponent and the Progression page', () => {
  let harness: RouterTestingHarness;
  let library: SongLibraryService;
  let handoff: ProgressionHandoffService;
  let progression: ProgressionService;
  let dbName: string;

  beforeEach(async () => {
    dbName = `song-editor-handoff-spec-${Math.random().toString(36).slice(2)}`;
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'songs/:id', component: SongEditorComponent },
          { path: 'progression', component: ProgressionStandIn }
        ]),
        { provide: SONG_LIBRARY_DB, useValue: dbName },
        { provide: SONG_AUTOSAVE_CLOCK, useValue: new StillClock() },
        { provide: SONG_PREFERENCES_STORAGE, useValue: null },
        // A link for this spec only: nothing it opens is left in the tab's session storage.
        { provide: PROGRESSION_HANDOFF_STORAGE, useValue: null }
      ]
    })
      .overrideComponent(SongEditorComponent, {
        set: { providers: [{ provide: ProgressionPlayerService, useValue: { audition: () => Promise.resolve() } }] }
      })
      .compileComponents();
    library = TestBed.inject(SongLibraryService);
    handoff = TestBed.inject(ProgressionHandoffService);
    progression = TestBed.inject(ProgressionService);
    harness = await RouterTestingHarness.create();
  });

  afterEach(async () => {
    harness.fixture.destroy();
    await new Promise(resolve => setTimeout(resolve, 50));
    await deletedDatabase(dbName);
  });

  const host = (): HTMLElement => harness.fixture.nativeElement;
  const text = (selector: string): string =>
    host().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const messages = (): string => text('.editor-messages');
  const names = (): string[] =>
    Array.from(host().querySelectorAll('.song-chord-name')).map(name => name.textContent ?? '');

  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; waited < 2000; waited += 10) {
      harness.detectChanges();
      if (done()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    harness.detectChanges();
  }

  async function storeSong(): Promise<SongDoc> {
    const created = await library.createSong();
    return library.saveSong({ ...created, content: lastDance().toJSON() });
  }

  async function open(id: string): Promise<void> {
    await harness.navigateByUrl(`/songs/${id}`, SongEditorComponent);
    await until(() => host().querySelector('.ProseMirror') !== null);
  }

  async function stored(id: string): Promise<Node> {
    const loaded = await library.loadSong(id);
    if (loaded?.kind !== 'song') throw new Error('The song did not load');
    return loaded.node;
  }

  function press(selector: string): void {
    const button = host().querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`No ${selector} on the page`);
    button.click();
    harness.detectChanges();
  }

  /** Chooses "Open in Progression" from the first section's ⋮ menu. */
  function openInProgression(): void {
    press('.song-section-menu-toggle');
    const item = Array.from(host().querySelectorAll<HTMLButtonElement>('.song-section-menu-item')).find(
      candidate => candidate.textContent?.trim() === 'Open in Progression'
    );
    if (!item) throw new Error('No Open in Progression in the section menu');
    item.click();
  }

  function setTitle(title: string): void {
    const input = host().querySelector<HTMLInputElement>('.song-title');
    if (!input) throw new Error('No title field');
    input.value = title;
    input.dispatchEvent(new Event('change'));
    harness.detectChanges();
  }

  it('saves the song, then opens the section in the Progression page', async () => {
    const song = await storeSong();
    await open(song.id);
    const verseId = sectionsOf(await stored(song.id))[0].id;
    setTitle('First Dance');
    let titleStoredAtOpen = '';
    const opened = spyOn(handoff, 'open').and.callFake(() => {
      void stored(song.id).then(node => (titleStoredAtOpen = node.attrs['title']));
    });

    openInProgression();
    await until(() => opened.calls.count() > 0 && titleStoredAtOpen !== '');

    expect(opened).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        songId: song.id,
        sectionId: verseId,
        sectionLabel: 'Verse 1',
        songTitle: 'First Dance'
      })
    );
    expect(titleStoredAtOpen).toBe('First Dance');
  });

  it('stays, and says why, when the song cannot be saved first', async () => {
    const song = await storeSong();
    await open(song.id);
    setTitle('First Dance');
    spyOn(library, 'saveSong').and.rejectWith(new Error('The disk is full.'));
    const opened = spyOn(handoff, 'open');

    openInProgression();
    await until(() => messages().includes('Not opened in Progression'));

    expect(messages()).toContain('Not opened in Progression: the song could not be saved first. The disk is full.');
    expect(opened).not.toHaveBeenCalled();
  });

  it('applies what comes back as one undo step, and says what changed', async () => {
    const song = await storeSong();
    await open(song.id);
    openInProgression();
    await until(() => text('.progression-stand-in') !== '');

    // On the Progression page: Am becomes Dm and two beats long, and a G goes on the end.
    const am = progression.doc.slots[1].id;
    progression.setSlotChord(am, { degree: 1, alter: 0, quality: null, extent: 3 });
    progression.setSlotLength(am, 2);
    progression.appendSlot(4);
    await handoff.returnToSong();
    await until(() => names().join(' ') === 'C Dm G');

    expect(names()).toEqual(['C', 'Dm', 'G']);
    expect(messages()).toContain('Verse 1: 1 chord changed on the Progression page.');
    expect(messages()).toContain(
      "1 chord added on the Progression page is at the end of Verse 1's last line; drag it onto its word."
    );
    const [verse] = sectionsOf(currentDoc());
    expect(sectionProgressionOf(currentDoc(), verse.id)?.slots[1].lengthBeats).toBe(2);

    press('.undo');
    expect(names()).toEqual(['C', 'Am']);
  });

  it('offers a new section for chords whose section was deleted while out, and places them on request', async () => {
    const song = await storeSong();
    const doc = await stored(song.id);
    const verse = sectionProgressionOf(doc, sectionsOf(doc)[0].id);
    if (verse === null) throw new Error('No verse');
    const sent = { ...verse, id: 'gone', revision: 3 };
    const back: ProgressionReturn = {
      songId: song.id,
      sectionId: 'gone',
      sectionLabel: 'Bridge',
      sectionKind: 'bridge',
      sent,
      returned: { ...sent, revision: 4 }
    };
    spyOn(handoff, 'takeReturn').and.returnValue([back]);

    await open(song.id);
    await until(() => text('.return-offer') !== '');
    expect(text('.return-offer')).toContain('Bridge is no longer in this song');
    expect(messages()).toContain('Bridge is no longer in this song');

    press('.return-offer .keep-returned');
    await until(() => names().length === 4);

    const sections = sectionsOf(currentDoc());
    expect(sections.map(entry => [entry.label, entry.kind])).toEqual([
      ['Verse 1', 'verse'],
      ['Bridge', 'bridge']
    ]);
    expect(names()).toEqual(['C', 'Am', 'C', 'Am']);
    expect(text('.return-offer')).toBe('');
  });

  it('lets the chords whose section was deleted go, when asked to', async () => {
    const song = await storeSong();
    const doc = await stored(song.id);
    const verse = sectionProgressionOf(doc, sectionsOf(doc)[0].id);
    if (verse === null) throw new Error('No verse');
    const sent = { ...verse, id: 'gone', revision: 3 };
    spyOn(handoff, 'takeReturn').and.returnValue([
      {
        songId: song.id,
        sectionId: 'gone',
        sectionLabel: 'Bridge',
        sectionKind: 'bridge',
        sent,
        returned: { ...sent, revision: 4 }
      }
    ]);

    await open(song.id);
    await until(() => text('.return-offer') !== '');
    press('.return-offer .discard-returned');

    expect(text('.return-offer')).toBe('');
    expect(names()).toEqual(['C', 'Am']);
    expect(messages()).toContain('Discarded the chords that came back for Bridge.');
  });

  /** The document the page's sheet holds now. */
  function currentDoc(): Node {
    const page = harness.routeDebugElement?.componentInstance as SongEditorComponent | undefined;
    if (!page?.doc) throw new Error('No song open');
    return page.doc;
  }
});
