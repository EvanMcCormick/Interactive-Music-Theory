import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { scoreBarFills } from './bar-fill';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { ComposerService } from './composer.service';
import { selectionTargets } from './composer-selection';
import { progressionTrack } from './progression-track';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import {
  ProgressionDoc,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  BeatDoc,
  ComposerState,
  DurationValue,
  ScoreDoc,
  TimeSignature,
  createDefaultNoteEffects,
  createRestBeat,
  effectiveTimeSignature
} from '../models/composer.model';

/** A beat holding one note on string 1. */
const noteBeat = (duration: DurationValue): BeatDoc => ({
  ...createRestBeat(duration),
  isRest: false,
  notes: [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }]
});

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

describe('ComposerService selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const state = (): ComposerState => {
    let latest: ComposerState | undefined;
    service.getState().subscribe(value => (latest = value)).unsubscribe();
    if (!latest) throw new Error('no state');
    return latest;
  };

  it('starts as the caret alone', () => {
    expect(state().anchor).toBeNull();
  });

  it('extends from where the caret was', () => {
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.extendSelectionTo({ barIndex: 1, beatIndex: 0 });

    expect(state().anchor?.beatIndex).toBe(1);
    expect(state().cursor.barIndex).toBe(1);
    expect(selectionTargets(service.doc, state().anchor, state().cursor).length).toBe(4);
  });

  it('drops the range on a plain caret move', () => {
    service.extendSelectionTo({ barIndex: 2 });

    service.setCursor({ barIndex: 0 });

    expect(state().anchor).toBeNull();
  });

  it('selects every beat of the caret\'s track', () => {
    service.selectAllInTrack();

    expect(selectionTargets(service.doc, state().anchor, state().cursor).length).toBe(16);
  });

  it('keeps the anchor inside the score when bars go', () => {
    service.setCursor({ barIndex: 0 });
    service.extendSelectionTo({ barIndex: 3 });
    service.setCursor({ barIndex: 3 });
    service.extendSelectionTo({ barIndex: 0 });

    service.removeBar(3);

    expect(state().anchor?.barIndex).toBe(2);
  });

  it('drops the range when the whole document is replaced', () => {
    service.extendSelectionTo({ barIndex: 2 });

    service.replaceDocument(ComposerService.createEmptyScore());

    expect(state().anchor).toBeNull();
  });
});

describe('ComposerService edits', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const refusal = (): string | null => {
    let latest: string | null = null;
    service.getState().subscribe(value => (latest = value.refusal)).unsubscribe();
    return latest;
  };
  const writeNote = (barIndex: number, beatIndex: number, string = 1): void => {
    service.setCursor({ barIndex, beatIndex, stringIndex: string - 1 });
    service.setNoteAtCursor({ kind: 'fretted', string, fret: 3 }, false);
  };

  it('palm-mutes every note in a range as one undo step', () => {
    writeNote(0, 0);
    writeNote(0, 1);
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });

    service.toggleNoteEffect('isPalmMute', true, false);
    const beats = service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.slice(0, 2).every(beat => beat.notes[0].effects.isPalmMute)).toBeTrue();

    service.undo();
    expect(service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.isPalmMute).toBeFalse();
  });

  it('acts on the caret\'s string alone in a chord', () => {
    writeNote(0, 0, 1);
    writeNote(0, 0, 2);
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 1 });

    service.toggleNoteEffect('isGhost', true, false);

    const notes = service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    expect(notes.map(note => note.effects.isGhost)).toEqual([false, true]);
  });

  it('refuses a note tool on a rest, says why, and spends no undo', () => {
    const before = JSON.stringify(service.doc);

    service.toggleNoteEffect('isGhost', true, false);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(refusal()).toMatch(/note/i);
    let canUndo = true;
    service.getState().subscribe(value => (canUndo = value.canUndo)).unsubscribe();
    expect(canUndo).toBeFalse();
  });

  it('clears the refusal when the next edit lands', () => {
    service.toggleNoteEffect('isGhost', true, false);
    writeNote(0, 0);

    service.toggleNoteEffect('isGhost', true, false);

    expect(refusal()).toBeNull();
  });

  it('makes a grace by the toggle rule, settling the bar each way', () => {
    // The caret's quarter rest becomes a grace, which takes no room. The rest that fills its gap
    // goes where the quarter stood, in front of the grace, so the grace moves to index 2 - and
    // the caret follows it there, so a second press acts on the grace. Pressed again it is a
    // quarter, and takes the rest it led into.
    const beats = () => service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    const caret = (): number => {
      let beatIndex = -1;
      service.getState().subscribe(value => (beatIndex = value.cursor.beatIndex)).unsubscribe();
      return beatIndex;
    };
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.toggleGrace('beforeBeat');
    expect(beats().map(beat => beat.effects.grace)).toEqual(['none', 'none', 'beforeBeat', 'none', 'none']);
    expect(caret()).toBe(2);

    service.toggleGrace('beforeBeat');
    expect(beats().map(beat => beat.effects.grace)).toEqual(['none', 'none', 'none', 'none']);
  });

  it('keeps a range on its beats when an edit inserts rests inside it', () => {
    // Four quarter notes become eighths, and each eighth rest goes right after its note, so the
    // fourth note moves from beat 3 to beat 6. The range's end follows it there, so the next press
    // still covers all four notes - and the rests between them, which have no note to take it.
    [0, 1, 2, 3].forEach(beatIndex => writeNote(0, beatIndex));
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 3 });

    service.applyDurationAtCursor(8, 0);
    service.toggleNoteEffect('isStaccato', true, false);

    const beats = service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.map(beat => (beat.isRest ? 'r' : beat.notes[0].effects.isStaccato ? 'staccato' : 'n')))
      .toEqual(['staccato', 'r', 'staccato', 'r', 'staccato', 'r', 'staccato', 'r']);
    service.getState().subscribe(state => {
      expect(state.anchor?.beatIndex).toBe(0);
      expect(state.cursor.beatIndex).toBe(6);
    }).unsubscribe();
  });

  it('refuses a tap on a pitched staff, and commits nothing', () => {
    service.addTrack('Piano', 0, false);
    service.setCursor({ trackIndex: 1, barIndex: 0, beatIndex: 0 });
    const before = JSON.stringify(service.doc);

    service.toggleBeatEffect('tap', true, false);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(refusal()).toMatch(/fretted/i);
  });

  it('marks a dynamic on every beat in a range, rests included', () => {
    service.selectAllInTrack();

    service.setDynamics('mp');

    expect(service.doc.tracks[0].staves[0].bars[3].voices[0].beats[3].dynamics).toBe('mp');
  });
});

describe('ComposerService bar and track edits', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const latest = (): ComposerState => {
    let value: ComposerState | undefined;
    service.getState().subscribe(state => (value = state)).unsubscribe();
    if (!value) throw new Error('no state');
    return value;
  };

  it('declares a time signature from the caret\'s bar and fits the bars under it', () => {
    service.setCursor({ barIndex: 1 });

    service.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    expect(service.doc.masterBars[1].timeSignature?.numerator).toBe(3);
    const bars = service.doc.tracks[0].staves[0].bars;
    expect(bars.map(bar => bar.voices[0].beats.length)).toEqual([4, 3, 3, 3]);
  });

  it('refuses a time signature no score can have, and commits nothing', () => {
    const before = JSON.stringify(service.doc);

    service.setTimeSignature({ numerator: 5, denominator: 6, isCommon: false });

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(latest().refusal).toMatch(/denominator/i);
  });

  it('sets the key on every staff from the caret\'s bar on', () => {
    service.addTrack('Piano', 0, false);
    service.setCursor({ barIndex: 2 });

    service.setKeySignature({ fifths: 2, mode: 'major' });

    for (const track of service.doc.tracks) {
      expect(track.staves[0].bars.map(bar => bar.keySignature.fifths)).toEqual([0, 0, 2, 2]);
    }
  });

  it("gives a track added later the score's key signatures, bar by bar, and keeps its own clef", () => {
    service.setCursor({ barIndex: 3 });
    service.setKeySignature({ fifths: 7, mode: 'minor' });

    service.addTrack('Piano', 0, false);

    const piano = service.doc.tracks[1].staves[0].bars;
    expect(piano.map(bar => bar.keySignature)).toEqual(service.doc.tracks[0].staves[0].bars.map(bar => bar.keySignature));
    expect(piano[3].keySignature).toEqual({ fifths: 7, mode: 'minor' });
    // Copied, not shared: a later key on the guitar alone cannot move the piano's.
    expect(piano[3].keySignature).not.toBe(service.doc.tracks[0].staves[0].bars[3].keySignature);
    expect(piano.map(bar => bar.clef)).toEqual(['g2', 'g2', 'g2', 'g2']);

    const settings = new alphaTab.Settings();
    const mapper = new ScoreDocMapperService();
    const readBack = mapper.toDoc(mapper.toScore(service.doc, settings));
    expect(readBack.tracks[1].staves[0].bars[3].keySignature).toEqual({ fifths: 7, mode: 'minor' });
  });

  it('toggles a repeat start across the selected bars as one undo step', () => {
    service.setCursor({ barIndex: 0 });
    service.extendSelectionTo({ barIndex: 1 });

    service.toggleMasterBarFlag('isRepeatStart');
    expect(service.doc.masterBars.slice(0, 2).map(bar => bar.isRepeatStart)).toEqual([true, true]);

    service.undo();
    expect(service.doc.masterBars[0].isRepeatStart).toBeFalse();
  });

  it('refuses a tuning that would strand notes on strings it removes', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 5 });
    service.setNoteAtCursor({ kind: 'fretted', string: 6, fret: 3 }, false);
    const before = JSON.stringify(service.doc);

    service.setStaffTuning([43, 38, 33, 28], 'Bass Standard Tuning');

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(latest().refusal).toMatch(/string/i);
  });

  it('retunes a staff whose notes all fit', () => {
    service.setStaffTuning([43, 38, 33, 28], 'Bass Standard Tuning');

    expect(service.doc.tracks[0].staves[0].tuning).toEqual([43, 38, 33, 28]);
  });

  it('mutes a track', () => {
    service.setPlayback({ isMute: true });

    expect(service.doc.tracks[0].playback.isMute).toBeTrue();
  });
});

describe('ComposerService durations and bar filling', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const firstBar = () => service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
  const note = (string = 1) => ({ kind: 'fretted' as const, string, fret: 0 });

  it('fills the bar when a shorter duration is applied, right after the beat', () => {
    // The caret's quarter becomes an eighth, and the eighth rest goes where its gap opened, at
    // 480, so the three quarter rests keep their places.
    service.applyDurationAtCursor(8, 0);

    expect(firstBar().map(beat => beat.duration)).toEqual([8, 8, 4, 4, 4]);
  });

  it('applies a duration to every beat of a range', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 3 });

    service.applyDurationAtCursor(8, 0);

    // Each quarter becomes an eighth with its eighth rest right after it, settled last to first
    // so no settled rest moves.
    expect(firstBar().map(beat => beat.duration)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });

  it('writes a longer note by taking the rests after it', () => {
    // The half needs 960 more ticks and the quarter rest after it is exactly that, so nothing is
    // over-taken and nothing goes back.
    service.setInputDuration(2, 0);

    service.setNoteAtCursor(note(), false);

    expect(firstBar().map(beat => beat.duration)).toEqual([2, 4, 4]);
  });

  it('leaves overflow for Fix bar rather than overwrite a note', () => {
    service.setCursor({ beatIndex: 1 });
    service.setNoteAtCursor(note(), false);
    service.setCursor({ beatIndex: 0 });

    service.applyDurationAtCursor(2, 0);

    expect(firstBar().length).toBe(4);
    expect(firstBar()[1].isRest).toBeFalse();
  });
});

describe('ComposerService fix bar', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const overfillBar = (barIndex: number): void => {
    for (const beatIndex of [0, 1, 2, 3]) {
      service.setCursor({ barIndex, beatIndex, stringIndex: 0 });
      service.setNoteAtCursor({ kind: 'fretted', string: 1, fret: beatIndex }, false);
    }
    service.setCursor({ barIndex, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);
  };

  it('carries the caret bar\'s overflow into the next as one undo step', () => {
    overfillBar(0);
    const before = JSON.stringify(service.doc);

    service.fixBar();
    expect(scoreBarFills(service.doc)[0][0].slice(0, 2).map(fill => fill.kind)).toEqual(['full', 'full']);

    service.undo();
    expect(JSON.stringify(service.doc)).toBe(before);
  });

  it('refuses when no selected bar is over, committing nothing', () => {
    const before = JSON.stringify(service.doc);
    let refusal: string | null = null;

    service.fixBar();
    service.getState().subscribe(state => (refusal = state.refusal)).unsubscribe();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(refusal).toMatch(/over/i);
  });

  it('keeps the caret on a beat it carries into the next bar', () => {
    // The eighth lies wholly past the line, so Fix bar moves it, whole, to the start of bar 2.
    const doc = ComposerService.createEmptyScore();
    const bar = doc.tracks[0].staves[0].bars[0].voices[0];
    bar.beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(8)];
    service.replaceDocument(doc);
    service.setCursor({ barIndex: 0, beatIndex: 4 });

    service.fixBar();

    service.getState().subscribe(state => {
      expect(state.cursor.barIndex).toBe(1);
      expect(state.cursor.beatIndex).toBe(0);
    }).unsubscribe();
    const carried = service.doc.tracks[0].staves[0].bars[1].voices[0].beats[0];
    expect(carried.isRest).toBeFalse();
    expect(carried.duration).toBe(8);
  });

  it('leaves a carried beat\'s fermata at its bar position, not on the beat, so a save adds none', () => {
    // alphaTab files a fermata by bar and tick, and hands it to every later track's beat at that tick. The
    // eighth's fermata was at 3840 in bar 1, where no track has a beat once it is carried; carried to the start
    // of bar 2, it would reach the piano's rest there on save.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(8)];
    doc.tracks[0].staves[0].bars[0].voices[0].beats[4].effects.fermata = { type: 'medium', length: 1 };
    service.replaceDocument(doc);
    service.setCursor({ barIndex: 0, beatIndex: 4 });
    const fermatas = (score: ScoreDoc): (string | null)[][][] =>
      score.tracks.map(track => track.staves[0].bars.slice(0, 2).map(bar => bar.voices[0].beats.map(beat => beat.effects.fermata?.type ?? null)));

    service.fixBar();

    expect(fermatas(service.doc).flat(2).filter(type => type !== null)).toEqual([]);
    const saved = TestBed.inject(ScoreDocMapperService).toDoc(TestBed.inject(ScoreDocMapperService).toScore(service.doc, new alphaTab.Settings()));
    expect(fermatas(saved)).toEqual(fermatas(service.doc));
  });
});

describe('ComposerService note entry in a second voice', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    // A loaded bar can hold a second voice, and a click can put the caret in it. Its first beat
    // holds a note, so a delete would have something to clear.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices.push({ beats: [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(4)] });
    service.replaceDocument(doc);
    service.setCursor({ barIndex: 0, voiceIndex: 1, beatIndex: 0 });
  });

  const state = (): ComposerState => {
    let latest: ComposerState | null = null;
    service.getState().subscribe(value => (latest = value)).unsubscribe();
    return latest as unknown as ComposerState;
  };

  it('refuses a rest, changes nothing, and says why', () => {
    service.setInputDuration(8, 0);
    const before = JSON.stringify(service.doc);

    service.setRestAtCursor();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(state().refusal).toMatch(/second voice/i);
    expect(state().cursor.beatIndex).toBe(0);
  });

  it('refuses a note and a delete the same way', () => {
    const before = JSON.stringify(service.doc);

    service.setNoteAtCursor({ kind: 'fretted', string: 2, fret: 3 });
    expect(state().refusal).toMatch(/second voice/i);

    service.deleteAtCursor();
    expect(state().refusal).toMatch(/second voice/i);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(state().cursor.beatIndex).toBe(0);
  });

  it('still clears a rest in the first voice', () => {
    // Delete on a rest is a no-op clear, not a note tool on a rest, so it is not refused. A
    // refusal is published first, so a delete that lands is seen to clear it.
    service.setRestAtCursor();
    service.setCursor({ barIndex: 0, voiceIndex: 0, beatIndex: 1 });

    service.deleteAtCursor();

    expect(state().refusal).toBeNull();
  });
});

/**
 * Which composition the document is (`ComposerState.documentId`), apart from whether it is saved. Opening a different
 * composition starts a fresh history, as opening a file does in Guitar Pro: an undo across it would put back the
 * composition before while the library panel names the one opened, and Save would write the one over the other.
 */
describe('ComposerService composition identity', () => {
  let service: ComposerService;
  const state = (): ComposerState => service.state;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    service.setTempo(140);
  });

  it('starts a fresh history for a composition that is loaded, marked clean', () => {
    const before = state().documentId;

    service.replaceDocument({ ...ComposerService.createEmptyScore(), tempo: 90 }, { markClean: true, newComposition: true });

    expect(state().documentId).toBe(before + 1);
    expect(state().isDirty).toBeFalse();
    expect(state().canUndo).toBeFalse();
    service.undo();
    expect(service.doc.tempo).withContext('undo put back the composition before').toBe(90);
  });

  it('starts a fresh history for a new composition that is not saved, and leaves it unsaved', () => {
    service.undo();
    expect(state().canRedo).toBeTrue();
    const before = state().documentId;

    service.replaceDocument({ ...ComposerService.createEmptyScore(), tempo: 90 }, { newComposition: true });

    expect(state().documentId).toBe(before + 1);
    expect(state().isDirty).toBeTrue();
    expect(state().canUndo).toBeFalse();
    expect(state().canRedo).toBeFalse();
    service.undo();
    service.redo();
    expect(service.doc.tempo).toBe(90);
  });

  it('keeps the composition and its history for a replacement that is an edit, as an applied alphaTex draft is', () => {
    const before = state().documentId;

    service.replaceDocument({ ...ComposerService.createEmptyScore(), tempo: 90 });

    expect(state().documentId).toBe(before);
    expect(state().isDirty).toBeTrue();
    service.undo();
    expect(service.doc.tempo).toBe(140);
  });
});

describe('ComposerService discarding unsaved work', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('lets a composition with nothing unsaved go without asking', () => {
    const asked = spyOn(window, 'confirm');

    expect(service.confirmDiscard('start a new score')).toBeTrue();
    expect(asked).not.toHaveBeenCalled();
  });

  it('asks before unsaved changes go, answers as the user did, and changes nothing by asking', () => {
    service.setTempo(140);
    const asked = spyOn(window, 'confirm').and.returnValues(false, true);

    expect(service.confirmDiscard('start a new score')).toBeFalse();
    expect(service.confirmDiscard('start a new score')).toBeTrue();

    expect(asked).toHaveBeenCalledWith('Discard unsaved changes and start a new score?');
    expect(service.doc.tempo).toBe(140);
    expect(service.state.canUndo).toBeTrue();
  });

  it('counts unsaved work held outside the document, as an edited alphaTex draft is, until it is released', () => {
    const release = service.holdUnsavedWork(() => true);
    const asked = spyOn(window, 'confirm').and.returnValue(true);

    service.confirmDiscard('load this composition');
    expect(asked).toHaveBeenCalledTimes(1);

    release();
    service.confirmDiscard('load this composition');
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe('ComposerService announcements', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('keeps a refusal still showing through a notice, and a failure replaces it', () => {
    service.toggleNoteEffect('isGhost', true, false);
    const refusal = service.state.refusal;
    expect(refusal).not.toBeNull();

    service.announce('Saved "A"');
    expect(service.state.refusal).withContext('the notice says nothing about why that press failed').toBe(refusal);
    expect(service.state.notice).toBe('Saved "A"');

    service.announce('Disk full', true);
    expect(service.state.refusal).toBe('Disk full');
    expect(service.state.notice).toBeNull();
  });
});
