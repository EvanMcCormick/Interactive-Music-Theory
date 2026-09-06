import { ScoreDoc, TimeSignature } from '../models/composer.model';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { deriveScore } from './score-derivation';
import { beatSlots } from './transcription-quantize';
import {
  MAX_DOWNBEAT_NUDGE_BEATS,
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  nudgedDownbeat,
  withTempo
} from './beat-grid-edit';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** Five beats at 120 BPM, starting at 1.0 s. */
const GRID: BeatGrid = {
  beatsSec: [1.0, 1.5, 2.0, 2.5, 3.0],
  timeSignature: FOUR_FOUR
};

describe('withTempo', () => {
  it('respaces the beats without moving the first one', () => {
    const slower = withTempo(GRID, 60);

    expect(slower.beatsSec[0]).toBe(1.0);
    expect(slower.beatsSec[1] - slower.beatsSec[0]).toBeCloseTo(1.0, 6);
  });

  it('covers the same span it was given', () => {
    const slower = withTempo(GRID, 60);
    const last = slower.beatsSec[slower.beatsSec.length - 1];

    // Original span is 2 s; at 60 BPM that is 2 beats plus the first.
    expect(last).toBeCloseTo(3.0, 6);
  });

  it('gives more beats at a faster tempo', () => {
    expect(withTempo(GRID, 240).beatsSec.length)
      .toBeGreaterThan(GRID.beatsSec.length);
  });

  it('refuses a tempo that is not a positive number', () => {
    for (const bad of [0, -60, NaN, Infinity]) {
      expect(withTempo(GRID, bad)).toBe(GRID);
    }
  });

  it('refuses a tempo outside the musical range', () => {
    for (const bad of [MIN_TEMPO_BPM - 1, MAX_TEMPO_BPM + 1, 9999, 1e6]) {
      expect(withTempo(GRID, bad)).toBe(GRID);
    }
  });

  it('accepts both ends of the range', () => {
    expect(withTempo(GRID, MIN_TEMPO_BPM)).not.toBe(GRID);
    expect(withTempo(GRID, MAX_TEMPO_BPM)).not.toBe(GRID);
  });

  it('cannot be asked for more bars than a score can hold', () => {
    // The hazard the ceiling exists for: bar count scales linearly with tempo,
    // and every bar is a MasterBarDoc, a quantizeBar call and a bar of rests.
    // Five minutes of audio at the top of the range, in beats.
    const fiveMinutes: BeatGrid = { beatsSec: [0, 0.5, 300], timeSignature: FOUR_FOUR };

    expect(withTempo(fiveMinutes, MAX_TEMPO_BPM).beatsSec.length).toBeLessThan(2100);
    expect(withTempo(fiveMinutes, 9999).beatsSec).toBe(fiveMinutes.beatsSec);
  });

  it('keeps the time signature', () => {
    expect(withTempo(GRID, 90).timeSignature).toEqual(FOUR_FOUR);
  });
});

describe('nudgedDownbeat', () => {
  it('starts the bar a beat later when nudged forward', () => {
    expect(nudgedDownbeat(GRID, 1).beatsSec).toEqual([1.5, 2.0, 2.5, 3.0]);
  });

  it('starts the bar a beat earlier when nudged back', () => {
    expect(nudgedDownbeat(GRID, -1).beatsSec).toEqual([0.5, 1.0, 1.5, 2.0, 2.5, 3.0]);
  });

  it('nudges several beats at once', () => {
    expect(nudgedDownbeat(GRID, 2).beatsSec).toEqual([2.0, 2.5, 3.0]);
  });

  it('is the identity for a nudge of nothing', () => {
    expect(nudgedDownbeat(GRID, 0)).toBe(GRID);
  });

  it('never leaves fewer than two beats', () => {
    // The grid has five beats and the nudge asks for eight, which is the most
    // it will take at all.
    expect(nudgedDownbeat(GRID, MAX_DOWNBEAT_NUDGE_BEATS).beatsSec.length).toBe(2);
  });

  it('lets the grid start before the audio does', () => {
    // A first note on beat 2 means bar 1 began before it — which is a
    // negative time. secondsToBeats extrapolates there by design.
    expect(nudgedDownbeat(GRID, -3).beatsSec[0]).toBeCloseTo(-0.5, 6);
  });

  it('restores the original spacing on a round trip', () => {
    const there = nudgedDownbeat(GRID, 1);
    const back = nudgedDownbeat(there, -1);

    expect(back.beatsSec).toEqual(GRID.beatsSec);
  });

  it('refuses a fractional nudge', () => {
    expect(nudgedDownbeat(GRID, 0.5)).toBe(GRID);
  });

  it('refuses a nudge further than the bound, in either direction', () => {
    const tooFar = MAX_DOWNBEAT_NUDGE_BEATS + 1;

    expect(nudgedDownbeat(GRID, tooFar)).toBe(GRID);
    expect(nudgedDownbeat(GRID, -tooFar)).toBe(GRID);
  });

  it('does not build an array per beat for an absurd backward nudge', () => {
    // Before the bound this reached `Array.from({ length: 1e9 })`. The
    // assertion is that it returns at all; `toBe` is what says it did nothing.
    expect(nudgedDownbeat(GRID, -1e9)).toBe(GRID);
  });

  it('accepts a nudge exactly at the bound', () => {
    expect(nudgedDownbeat(GRID, -MAX_DOWNBEAT_NUDGE_BEATS).beatsSec.length)
      .toBe(GRID.beatsSec.length + MAX_DOWNBEAT_NUDGE_BEATS);
  });
});

/**
 * What the nudge is for, checked through derivation rather than on the array.
 *
 * The unit tests above prove the arithmetic and nothing else: an array that
 * shifts correctly is not the same claim as a bar line that lands where the
 * listener says it does. This is the assertion that the feature works, and it
 * runs the whole of `deriveScore` to make it.
 *
 * The case is the one M2 left open. A bassline whose first *tracked* beat is
 * really beat 2 of the bar is barred a beat out, and the correction pushes the
 * grid's first beat to a negative time - before the audio starts. That is the
 * intended answer rather than an edge case, but it is also exactly where the
 * two guards on the path could quietly swallow it: `deriveScore` clamps beat
 * positions with `Math.max(0, ...)` and reports what the clamp moved as
 * `beforeGrid`. A note pulled back onto beat 1 and dropped would look, from
 * the arrays alone, like a nudge that worked.
 */
describe('nudging the grid a score is derived from', () => {
  /** Eight beats at 120 BPM from the top of the audio: two bars of 4/4. */
  const TRACKED: BeatGrid = {
    beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
    timeSignature: FOUR_FOUR
  };

  /** E1 and D2 - different strings on the default bass tuning, so neither
   *  can take the other's. */
  const NOTES: DetectedNote[] = [28, 38].map((pitch, index) => ({
    id: `n${index}`,
    pitch,
    onsetSec: index,
    offsetSec: index + 0.4,
    confidence: 1,
    bendCents: []
  }));

  const session = (grid: BeatGrid): TranscriptionSession => ({
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes: NOTES,
    rawNotes: NOTES,
    bendFrameRateHz: 86.13,
    grid,
    settings: createDefaultDerivationSettings()
  });

  /**
   * Which sixteenth slot of `bar` the first attack sits on.
   *
   * Summed from the durations written before it rather than read off an
   * index: how a leading silence is spelled - one quarter rest or four
   * sixteenths - is `quantizeBar`'s business, and counting `BeatDoc`s would
   * make this test fail when that changed without the note having moved.
   */
  function firstAttackSlot(doc: ScoreDoc, bar: number): number {
    const beats = doc.tracks[0].staves[0].bars[bar].voices[0].beats;
    const index = beats.findIndex(beat => !beat.isRest && !beat.notes[0].isTied);

    return index < 0 ? -1 : beatSlots(beats.slice(0, index), 16);
  }

  it('writes the first note on beat 2 when bar 1 is nudged back in front of it', () => {
    // As tracked: the first note is read as the downbeat, which is the
    // arbitrary phase M2 recorded rather than a measurement.
    expect(firstAttackSlot(deriveScore(session(TRACKED)).doc, 0)).toBe(0);

    const nudged = nudgedDownbeat(TRACKED, -1);
    // Bar 1 now begins half a second before the audio does.
    expect(nudged.beatsSec[0]).toBe(-0.5);

    const shifted = deriveScore(session(nudged));

    // A sixteenth slot is a quarter of a beat, so beat 2 of the bar is slot 4
    // and beat 4 is slot 12. Both notes moved by exactly one beat.
    expect(firstAttackSlot(shifted.doc, 0)).toBe(4);
    // Not clamped onto beat 1 and reported as `beforeGrid`: the negative first
    // beat is honoured, so nothing is lost to the correction.
    expect(shifted.dropped).toEqual([]);
  });

  it('keeps every note in the bar it was already in', () => {
    const shifted = deriveScore(session(nudgedDownbeat(TRACKED, -1)));
    const struck = shifted.doc.tracks[0].staves[0].bars.map(
      bar => bar.voices[0].beats.filter(beat => !beat.isRest && !beat.notes[0].isTied).length
    );

    expect(struck).toEqual([2]);
  });

  it('puts the bar line back where it was on a round trip', () => {
    const there = nudgedDownbeat(TRACKED, -1);
    const back = nudgedDownbeat(there, 1);

    expect(firstAttackSlot(deriveScore(session(back)).doc, 0)).toBe(0);
  });
});
