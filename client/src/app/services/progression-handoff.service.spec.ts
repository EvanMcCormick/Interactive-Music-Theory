import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { history } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { firstValueFrom } from 'rxjs';
import { createExtensions } from '../models/progression-normalize';
import { ChordDegree, ProgressionDoc, ProgressionKey, ProgressionState } from '../models/progression.model';
import { SongMeta } from '../models/song.model';
import {
  HandoffBanner,
  PROGRESSION_HANDOFF_STORAGE,
  ProgressionHandoffService,
  SectionHandoff
} from './progression-handoff.service';
import { ProgressionService } from './progression.service';
import { chordSlotOf, chordsOf, createSongIdsPlugin, sectionsOf } from './song-document';
import { applyReturn, sectionHandoffOf, songAfterReturnOf } from './song-progression-return';
import { songSchema } from './song-schema';

/**
 * Open in Progression and back (brief decision 7): the one link between a song's section and the Progression page,
 * against the real `ProgressionService`. The router is the real one with its `navigate` answered by a spy, and the
 * session storage a link survives a reload in is a map of the spec's own.
 */
const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
const META: SongMeta = { title: 'Last Dance', artist: 'The Band', key: C_MAJOR, tempo: 100, timeSignature: FOUR_FOUR };

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

function chord(degree: number, id: string): Node {
  return songSchema.node('chord', { ...chordSlotOf(degreeAt(degree), C_MAJOR, IONIAN, FOUR_FOUR), id });
}

/** "Last Dance": Verse 1 is C and Am, the chorus G. */
function lastDance(): Node {
  return songSchema.node('doc', META, [
    songSchema.node('section', { id: 'v1', label: 'Verse 1', kind: 'verse' }, [
      songSchema.node('lyricLine', null, [
        chord(0, 'C'),
        songSchema.text('Got me '),
        chord(5, 'Am'),
        songSchema.text('thinking')
      ])
    ]),
    songSchema.node('section', { id: 'c1', label: 'Chorus', kind: 'chorus' }, [
      songSchema.node('lyricLine', null, [chord(4, 'G'), songSchema.text('Oh')])
    ])
  ]);
}

function handoffOf(doc: Node, sectionId: string, songId = 'song-1'): SectionHandoff {
  const section = sectionHandoffOf(songId, doc, sectionId);
  if (section === null) throw new Error(`No section ${sectionId}`);
  return section;
}

/** Session storage for one spec: what a link is kept in across a reload. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('ProgressionHandoffService', () => {
  let storage: MemoryStorage;
  let handoff: ProgressionHandoffService;
  let progression: ProgressionService;
  let navigate: jasmine.Spy;
  let errors: jasmine.Spy;

  /** A fresh app on `storage`: what a reload of the page is, as far as these services can tell. */
  function startApp(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PROGRESSION_HANDOFF_STORAGE, useValue: storage },
        { provide: ErrorHandler, useValue: { handleError: jasmine.createSpy('handleError') } }
      ]
    });
    progression = TestBed.inject(ProgressionService);
    handoff = TestBed.inject(ProgressionHandoffService);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    errors = TestBed.inject(ErrorHandler).handleError as jasmine.Spy;
  }

  /** The user's own progression: two chords, unsaved, as they would be after a few clicks on the palette. */
  function ownProgression(): ProgressionDoc {
    progression.appendSlot(0);
    progression.appendSlot(4);
    return progression.doc;
  }

  function currentState(): Promise<ProgressionState> {
    return firstValueFrom(progression.getState());
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    startApp();
  });

  describe('going out', () => {
    it("puts the section's progression on the page, keeps the user's own, records the revision and goes there", () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));

      expect(progression.doc.id).toBe('v1');
      expect(progression.doc.slots.map(slot => slot.id)).toEqual(['C', 'Am']);
      expect(handoff.link?.previous).toEqual(own);
      expect(handoff.link?.sent.revision).toBe(progression.doc.revision);
      expect(handoff.link).toEqual(
        jasmine.objectContaining({
          songId: 'song-1',
          sectionId: 'v1',
          sectionLabel: 'Verse 1',
          songTitle: 'Last Dance'
        })
      );
      expect(handoff.isLinked(progression.doc)).toBeTrue();
      expect(navigate).toHaveBeenCalledOnceWith(['/progression']);
    });

    it('opens the section clean, so nothing reads as an unsaved change of its own', async () => {
      ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      expect((await currentState()).isDirty).toBeFalse();
    });

    it("keeps the user's own progression through a second open, of another section or another song", () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      handoff.open(handoffOf(lastDance(), 'c1', 'song-2'));

      expect(progression.doc.id).toBe('c1');
      expect(handoff.link?.previous).toEqual(own);
      expect(handoff.link?.songId).toBe('song-2');
    });

    it("keeps the first section's edits for its song when a second is opened over them", () => {
      ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);
      handoff.open(handoffOf(lastDance(), 'c1', 'song-2'));

      const [kept] = handoff.takeReturn('song-1');
      expect(kept.sectionId).toBe('v1');
      expect(kept.returned.slots[1].lengthBeats).toBe(8);
      expect(handoff.takeReturn('song-2')).toEqual([]);
    });

    it('carries on with the section already open there, edits and all, rather than deriving it again over them', () => {
      ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);
      const edited = progression.doc;
      handoff.open(handoffOf(lastDance(), 'v1'));

      expect(progression.doc).toBe(edited);
      expect(navigate).toHaveBeenCalledTimes(2);
    });
  });

  describe('coming back', () => {
    it("hands the edited progression to the song, puts the user's own back and goes to the song", async () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);
      const returned = progression.doc;

      expect(await handoff.returnToSong()).toBeTrue();

      expect(progression.doc.id).toBe(own.id);
      expect(progression.doc.slots).toEqual(own.slots);
      expect(handoff.link).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/songs', 'song-1']);
      const [back] = handoff.takeReturn('song-1');
      expect(back.returned).toEqual(returned);
      expect(back.sent.revision).not.toBe(returned.revision);
      expect(handoff.takeReturn('song-1')).toEqual([]);
    });

    it("puts the user's own progression back as they had it: unsaved if it was", async () => {
      ownProgression();
      expect((await currentState()).isDirty).toBeTrue();
      handoff.open(handoffOf(lastDance(), 'v1'));
      await handoff.returnToSong();
      expect((await currentState()).isDirty).toBeTrue();
    });

    it("puts the user's own progression back as they had it: clean if it was", async () => {
      progression.replaceDocument(progression.doc, true);
      handoff.open(handoffOf(lastDance(), 'v1'));
      await handoff.returnToSong();
      expect((await currentState()).isDirty).toBeFalse();
    });

    it('hands nothing back when nothing changed there: Back to song is then a cancel', async () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      await handoff.returnToSong();

      expect(handoff.takeReturn('song-1')).toEqual([]);
      expect(progression.doc.slots).toEqual(own.slots);
    });

    it('cancels: goes back without the edits, and puts the own progression back', async () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);

      expect(await handoff.cancel()).toBeTrue();

      expect(handoff.takeReturn('song-1')).toEqual([]);
      expect(progression.doc.slots).toEqual(own.slots);
      expect(handoff.link).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/songs', 'song-1']);
    });

    it("does nothing while the progression open is not the section's", async () => {
      ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.undo();

      expect(handoff.isLinked(progression.doc)).toBeFalse();
      expect(await handoff.returnToSong()).toBeFalse();
      expect(handoff.link).not.toBeNull();
    });
  });

  describe('the banner and the key', () => {
    function banner(): Promise<HandoffBanner | null> {
      return firstValueFrom(handoff.banner$);
    }

    it('names the section and the song while its progression is the one open, and only then', async () => {
      ownProgression();
      expect(await banner()).toBeNull();

      handoff.open(handoffOf(lastDance(), 'v1'));
      expect(await banner()).toEqual(
        jasmine.objectContaining({ sectionLabel: 'Verse 1', songTitle: 'Last Dance', keyHeld: false })
      );

      progression.undo();
      expect(await banner()).toBeNull();
    });

    it("declines another key for the section's progression and says the song's key holds", async () => {
      handoff.open(handoffOf(lastDance(), 'v1'));

      expect(handoff.declineKey(progression.doc, { tonic: 2, scaleId: 'ionian', preferSharps: true })).toBeTrue();
      expect((await banner())?.keyHeld).toBeTrue();
      expect(handoff.declineKey(progression.doc, C_MAJOR)).toBeTrue();
      expect((await banner())?.keyHeld).toBeFalse();
    });

    it("lets any other progression take the circle's key", () => {
      ownProgression();
      expect(handoff.declineKey(progression.doc, { tonic: 2, scaleId: 'ionian', preferSharps: true })).toBeFalse();
    });
  });

  describe('a reload', () => {
    it("comes back to the section's progression, edits and all, still linked to the song", async () => {
      const own = ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);

      startApp();

      expect(progression.doc.id).toBe('v1');
      expect(progression.doc.slots[1].lengthBeats).toBe(8);
      expect(handoff.isLinked(progression.doc)).toBeTrue();

      await handoff.returnToSong();
      expect(progression.doc.slots).toEqual(own.slots);
      expect(handoff.takeReturn('song-1')[0].returned.slots[1].lengthBeats).toBe(8);
    });

    it('still reads as unchanged when nothing had been edited before it', async () => {
      ownProgression();
      handoff.open(handoffOf(lastDance(), 'v1'));

      startApp();
      await handoff.returnToSong();

      expect(handoff.takeReturn('song-1')).toEqual([]);
    });

    it('keeps edits handed back but not yet taken by their song', () => {
      handoff.open(handoffOf(lastDance(), 'v1'));
      progression.setSlotLength('Am', 8);
      void handoff.returnToSong();

      startApp();

      expect(handoff.takeReturn('song-1').length).toBe(1);
      expect(storage.length).toBe(0);
    });

    it('leaves nothing in storage once nothing is open or waiting', async () => {
      handoff.open(handoffOf(lastDance(), 'v1'));
      expect(storage.length).toBe(1);
      await handoff.cancel();
      expect(storage.length).toBe(0);
    });

    it('drops a stored link it cannot read, and reports it', () => {
      storage.setItem('progression-handoff', '{"version":1,"link":{"songId":4}}');
      startApp();

      expect(handoff.link).toBeNull();
      expect(errors).toHaveBeenCalled();
      expect(storage.length).toBe(0);
    });
  });

  describe('a round trip through the real progression service', () => {
    it("brings a chord's new length and quality back into its atom", async () => {
      const song = lastDance();
      handoff.open(handoffOf(song, 'v1'));
      progression.setSlotLength('Am', 2);
      progression.setSlotChord('Am', { degree: 5, alter: 0, quality: 'minor7', extent: 7 });
      const changed = progression.doc.slots[1];
      await handoff.returnToSong();

      const [back] = handoff.takeReturn('song-1');
      const state = EditorState.create({ doc: song, plugins: [history(), createSongIdsPlugin()] });
      const outcome = songAfterReturnOf(state.doc, back.sectionId, back.returned, back.sent);
      if (outcome.kind !== 'changes') throw new Error(`Expected changes, got ${outcome.kind}`);
      const run = applyReturn(state.doc, outcome.steps)(state);
      if (run.kind !== 'edit') throw new Error('The return did not apply');
      const after = state.apply(run.tr).doc;

      const [verse] = sectionsOf(after);
      const am = chordsOf(verse.node, verse.pos).find(entry => entry.attrs.id === 'Am')?.attrs;
      expect(am?.lengthBeats).toBe(2);
      expect(am?.harmony).toEqual(changed.harmony);
      expect(am?.notes).toEqual(changed.notes);
      expect(am?.harmony.kind === 'degree' && am.harmony.degree.quality).toBe('minor7');
    });
  });
});
