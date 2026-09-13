import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { progressionTrack } from './progression-track';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import {
  ProgressionDoc,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  ScoreDoc,
  TimeSignature,
  effectiveTimeSignature
} from '../models/composer.model';

/**
 * Bar insertion and the score's meter.
 *
 * A master bar declares a time signature only where the meter changes, and
 * every later bar inherits it - the mapper reads a loaded file into exactly
 * that shape. So bar 1 is the one bar that must always declare, because there
 * is nothing before it to inherit from, and `effectiveTimeSignature` answers a
 * bar 1 that declares nothing with a hardcoded 4/4.
 *
 * Inserting at index 0 used to put a fresh, undeclared master bar in that
 * position. A 3/4 score then read as 4/4 to everything that asks what meter it
 * is in - `scoreMeter`, and through it the guard on `sendProgression` - while
 * the score's own 3/4 moved to bar 2 and declared a meter change that nobody
 * made. See "Not in M4" in the progression composer design doc.
 */
describe('ComposerService bar insertion', () => {
  let service: ComposerService;

  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };
  const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  /**
   * A four-bar score in 3/4, declared on bar 1 only, with `later` declared on
   * bar 3 when given - the shape the mapper produces from a loaded file.
   */
  function scoreIn(meter: TimeSignature, later: TimeSignature | null = null): ScoreDoc {
    const empty = ComposerService.createEmptyScore();
    const masterBars = empty.masterBars.map((bar, index) => ({
      ...bar,
      timeSignature: index === 0 ? meter : index === 2 ? later : null
    }));
    return {
      ...empty,
      masterBars,
      tracks: [ComposerService.createTrack('Guitar', 'gtr', 25, true, masterBars)]
    };
  }

  /** Every bar's meter, read the way the rest of the app reads it. */
  function meters(): TimeSignature[] {
    const { masterBars } = service.doc;
    return masterBars.map((_, index) => effectiveTimeSignature(masterBars, index));
  }

  /** A one-bar I chord, for the spec that sends into the score. */
  function oneChord(): ProgressionDoc {
    return {
      ...createDefaultProgression(),
      id: 'prog-1',
      name: 'Verse',
      revision: 1,
      slots: [
        {
          ...createDegreeSlot(0, 0),
          lengthBeats: 3,
          notes: [60, 64, 67].map(midi => ({
            midi,
            startBeat: 0,
            lengthBeats: 3,
            velocity: DEFAULT_VELOCITY
          }))
        }
      ]
    };
  }

  it('keeps the score\'s meter when a bar is inserted at the start', () => {
    service.replaceDocument(scoreIn(THREE_FOUR));

    service.insertBar(0);

    expect(service.scoreMeter).toEqual(THREE_FOUR);
    expect(meters()).toEqual(Array(5).fill(THREE_FOUR));
  });

  it('fills the inserted first bar to the score\'s meter, not the 4/4 default', () => {
    service.replaceDocument(scoreIn(THREE_FOUR));

    service.insertBar(0);

    const beats = service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.length).toBe(3);
    expect(beats.every(beat => beat.duration === 4)).toBeTrue();
  });

  it('does not leave a meter change behind on what is now bar 2', () => {
    // Inheriting the right answer is not enough: a bar 2 that still declares
    // 3/4 is a declared change to the meter already in force, which a loaded
    // file would never contain and a round trip through the mapper would drop.
    service.replaceDocument(scoreIn(THREE_FOUR));

    service.insertBar(0);

    expect(service.doc.masterBars[0].timeSignature).toEqual(THREE_FOUR);
    expect(service.doc.masterBars[1].timeSignature).toBeNull();
  });

  it('moves a real meter change along with the bar that made it', () => {
    service.replaceDocument(scoreIn(THREE_FOUR, SIX_EIGHT));

    service.insertBar(0);

    expect(meters()).toEqual([THREE_FOUR, THREE_FOUR, THREE_FOUR, SIX_EIGHT, SIX_EIGHT]);
  });

  it('leaves bar 1\'s declaration alone when inserting anywhere else', () => {
    service.replaceDocument(scoreIn(THREE_FOUR));

    service.insertBar(2);

    expect(service.doc.masterBars[0].timeSignature).toEqual(THREE_FOUR);
    expect(service.doc.masterBars[2].timeSignature).toBeNull();
    expect(meters()).toEqual(Array(5).fill(THREE_FOUR));
  });

  it('takes the whole insertion back on undo, declarations included', () => {
    const original = scoreIn(THREE_FOUR);
    service.replaceDocument(structuredClone(original));

    service.insertBar(0);
    service.undo();

    expect(service.doc.masterBars).toEqual(original.masterBars);
  });

  it('guards a Send against the meter the score is actually in afterwards', () => {
    // The consequence that made this a bug rather than an oddity. Before the
    // fix, `scoreMeter` read 4/4 here, so the guard - asking the same wrong
    // question as every caller - let a 4/4 track in under 3/4 bar lines and
    // refused the 3/4 one that fits.
    service.replaceDocument(scoreIn(THREE_FOUR));
    service.insertBar(0);

    const fourFour = progressionTrack(oneChord(), IONIAN, { numerator: 4, denominator: 4, isCommon: true });
    expect(() => service.sendProgression(fourFour)).toThrowError(/scoreMeter/);

    service.sendProgression(progressionTrack(oneChord(), IONIAN, THREE_FOUR));
    expect(service.doc.tracks.some(track => track.generated !== null)).toBeTrue();
  });
});

/**
 * `updateScoreInfo` changes the descriptive fields and nothing else.
 *
 * Its parameter type rejects an object literal that names `tracks`, but TypeScript checks
 * excess properties only on a fresh literal: a spread or a variable of a wider type passes,
 * and a cast gets past the literal check outright. So the per-field body is the guard, and
 * these pin it at runtime.
 */
describe('ComposerService updateScoreInfo', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('leaves the structure alone when handed a whole document', () => {
    const before = structuredClone(service.doc);
    // Built as a variable and passed with no cast: excess properties are checked only on a
    // fresh literal, so this compiles, and it is the spread a caller could really write.
    const whole = { ...structuredClone(service.doc), title: 'New', tracks: [] };

    service.updateScoreInfo(whole);

    expect(service.doc.title).toBe('New');
    expect(service.doc.tracks).toEqual(before.tracks);
    expect(service.doc.masterBars).toEqual(before.masterBars);
  });

  it('clears a title given as empty, and leaves one that is not given', () => {
    service.updateScoreInfo({ title: 'Named' });

    service.updateScoreInfo({ title: '' });
    expect(service.doc.title).toBe('');

    service.updateScoreInfo({ title: 'Named' });
    service.updateScoreInfo({});
    expect(service.doc.title).toBe('Named');
  });
});
