import { ScoreDoc, TimeSignature } from '../models/composer.model';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { deriveScore } from './score-derivation';
import { DEFAULT_HARMONIC_OPTIONS, NO_NOTE_DECISIONS } from './transcription-harmonics';
import { beatSlots } from './transcription-quantize';
import { gridTempo } from './transcription-timing';
import {
  MAX_BEATS_PER_PULSE,
  MAX_DOWNBEAT_NUDGE_BEATS,
  MAX_TEMPO_BPM,
  MIN_BEATS_PER_PULSE,
  MIN_TEMPO_BPM,
  atMetricalLevel,
  canApplyMetricalLevel,
  canNudgeDownbeat,
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

  it('refuses a grid whose ends are not times', () => {
    // `Math.max(2, NaN)` is NaN and `Array.from({ length: NaN })` is `[]`, so
    // without the guard this returned an empty grid - and `secondsToBeats`
    // reads a grid of under two beats as position 0 for every note there is.
    // Unreachable from `trackBeats`; the point is that the floor is a floor.
    for (const bad of [NaN, Infinity]) {
      const broken: BeatGrid = { beatsSec: [bad, 0.5, 1.0], timeSignature: FOUR_FOUR };
      const brokenEnd: BeatGrid = { beatsSec: [0, 0.5, bad], timeSignature: FOUR_FOUR };

      expect(withTempo(broken, 120)).toBe(broken);
      expect(withTempo(brokenEnd, 120)).toBe(brokenEnd);
    }
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
    // True here only because `GRID` is evenly spaced, so the interval the
    // backward nudge reconstructs from is the one it destroyed. `UNEVEN` below
    // is the case that actually exercises the reconstruction.
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

  it('hands back the same grid when the forward clamp leaves nothing to do', () => {
    // Two beats is the floor, so there is nothing to drop. Before this it
    // returned `source.slice(0)` - a new array, equal to the old one, which the
    // caller could not tell from an applied nudge.
    const floored: BeatGrid = { beatsSec: [1.0, 1.5], timeSignature: FOUR_FOUR };

    expect(nudgedDownbeat(floored, 1)).toBe(floored);
  });
});

/**
 * The predicate a disabled button keys on.
 *
 * `nudgedDownbeat` returning the grid unchanged is the honest answer, but a
 * control cannot act on it after the fact: by then a re-derivation has already
 * been asked for. This is the same set of refusals, asked in advance.
 */
describe('canNudgeDownbeat', () => {
  it('agrees with what nudgedDownbeat actually does', () => {
    const grids: BeatGrid[] = [
      GRID,
      { beatsSec: [1.0, 1.5], timeSignature: FOUR_FOUR },
      { beatsSec: [1.0], timeSignature: FOUR_FOUR }
    ];
    const nudges = [-99, -8, -1, 0, 0.5, 1, 2, 3, 8, 99];

    for (const grid of grids) {
      for (const beats of nudges) {
        // Identity is the whole contract: a refused nudge is the same object.
        expect(nudgedDownbeat(grid, beats) !== grid).toBe(canNudgeDownbeat(grid, beats));
      }
    }
  });

  it('is false for a forward nudge with no beats left to drop', () => {
    const floored: BeatGrid = { beatsSec: [1.0, 1.5], timeSignature: FOUR_FOUR };

    expect(canNudgeDownbeat(floored, 1)).toBe(false);
    // Backwards always has somewhere to go: it builds the beats it needs.
    expect(canNudgeDownbeat(floored, -1)).toBe(true);
  });

  it('is false past the bound and true inside it', () => {
    expect(canNudgeDownbeat(GRID, MAX_DOWNBEAT_NUDGE_BEATS)).toBe(true);
    expect(canNudgeDownbeat(GRID, MAX_DOWNBEAT_NUDGE_BEATS + 1)).toBe(false);
    expect(canNudgeDownbeat(GRID, -MAX_DOWNBEAT_NUDGE_BEATS)).toBe(true);
    expect(canNudgeDownbeat(GRID, -MAX_DOWNBEAT_NUDGE_BEATS - 1)).toBe(false);
  });
});

/**
 * What the backward nudge reconstructs, on a grid that can tell.
 *
 * Every other fixture here is evenly spaced at the head, which makes the
 * leading, trailing and median intervals the same number - so the choice of
 * interval is untested and a forward-then-back round trip reproduces the array
 * exactly whatever it picks. A real tracked grid is not like that: the pinned
 * detector fixture comes back as [0.49, 0.49, 0.51, 0.5, 0.5, 0.49, 0.51].
 *
 * The head is 0.42 against 0.5 for everything after it, so:
 *
 * - **`-1` then `+1` is an exact inverse.** The prepended beat is dropped again
 *   and nothing else was touched.
 * - **`+1` then `-1` is not.** The forward nudge discards `b0`, and the
 *   backward one rebuilds it from the interval that is now leading, writing
 *   `2·b1 − b2` where `b0` was. The error is `|b1 − b0| − |b2 − b1|`, strictly
 *   under one interval, and it lands entirely on the first beat: nothing after
 *   `b1` moves at all.
 * - **It does not accumulate.** A second cycle rebuilds `2·b1 − b2` from the
 *   same `b1` and `b2` and so returns the same array. The drift is one
 *   interval's worth once, not once per press.
 */
describe('nudgedDownbeat on an unevenly headed grid', () => {
  const UNEVEN: BeatGrid = {
    beatsSec: [0, 0.42, 0.92, 1.42, 1.92],
    timeSignature: FOUR_FOUR
  };

  it('extends backwards by the leading interval, not the median', () => {
    // 0.42, the interval the prepended beat is adjacent to. The median and the
    // trailing interval are both 0.5, so this is the assertion that says which
    // one is used - and no other fixture here can make it.
    expect(nudgedDownbeat(UNEVEN, -1).beatsSec[0]).toBeCloseTo(-0.42, 9);
  });

  it('is an exact inverse when nudged back and then forward', () => {
    const back = nudgedDownbeat(UNEVEN, -1);

    expect(nudgedDownbeat(back, 1).beatsSec).toEqual(UNEVEN.beatsSec);
  });

  it('does not restore the beat times when nudged forward and then back', () => {
    const round = nudgedDownbeat(nudgedDownbeat(UNEVEN, 1), -1);

    // 2·0.42 − 0.92. The head interval is gone and cannot be recovered.
    expect(round.beatsSec[0]).toBeCloseTo(-0.08, 9);
    expect(round.beatsSec).not.toEqual(UNEVEN.beatsSec);
  });

  it('confines the drift to the first beat and bounds it by one interval', () => {
    const round = nudgedDownbeat(nudgedDownbeat(UNEVEN, 1), -1);

    expect(round.beatsSec.slice(1)).toEqual(UNEVEN.beatsSec.slice(1));
    expect(Math.abs(round.beatsSec[0] - UNEVEN.beatsSec[0]))
      .toBeLessThan(UNEVEN.beatsSec[1] - UNEVEN.beatsSec[0]);
  });

  it('does not accumulate drift over repeated round trips', () => {
    const once = nudgedDownbeat(nudgedDownbeat(UNEVEN, 1), -1);
    const twice = nudgedDownbeat(nudgedDownbeat(once, 1), -1);

    expect(twice.beatsSec).toEqual(once.beatsSec);
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

  const session = (grid: BeatGrid, notes: DetectedNote[] = NOTES): TranscriptionSession => ({
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes,
    rawNotes: notes,
    bendFrameRateHz: 86.13,
    grid,
    trackedGrid: grid,
    beatsPerPulse: 1,
    harmonics: DEFAULT_HARMONIC_OPTIONS,
    decisions: NO_NOTE_DECISIONS,
    settings: createDefaultDerivationSettings()
  });

  /** The same two notes, struck `sec` seconds later. */
  const struckAt = (...onsets: number[]): DetectedNote[] =>
    NOTES.map((note, index) => ({
      ...note,
      onsetSec: onsets[index],
      offsetSec: onsets[index] + 0.4
    }));

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

  /**
   * The round trip that matters, on a grid whose head interval is not the
   * others.
   *
   * `TRACKED` is evenly spaced, so `+1` then `-1` reproduces `beatsSec`
   * exactly and the test above would pass comparing the arrays. This is the
   * claim the docblock actually makes: the beat *times* do not come back, and
   * the notes are written where they were anyway.
   */
  const UNEVEN: BeatGrid = {
    beatsSec: [0, 0.42, 0.92, 1.42, 1.92],
    timeSignature: FOUR_FOUR
  };

  it('writes the notes back where they were, though the beats did not return', () => {
    const round = nudgedDownbeat(nudgedDownbeat(UNEVEN, 1), -1);

    // The grid is not the one it started as: the head interval was 0.42 and is
    // rebuilt as 0.5, putting bar 1 at -0.08 s instead of 0.
    expect(round.beatsSec).not.toEqual(UNEVEN.beatsSec);

    // Struck after the second beat, where the drift stops.
    const notes = struckAt(1.0, 2.0);
    const before = deriveScore(session(UNEVEN, notes));
    const after = deriveScore(session(round, notes));

    expect(firstAttackSlot(before.doc, 0)).toBe(9);
    expect(firstAttackSlot(after.doc, 0)).toBe(firstAttackSlot(before.doc, 0));
    expect(firstAttackSlot(after.doc, 1)).toBe(firstAttackSlot(before.doc, 1));
    expect(after.doc.masterBars.length).toBe(before.doc.masterBars.length);
    expect(after.dropped).toEqual([]);
  });

  it('moves a note in front of the second beat by at most the drift', () => {
    // The honest limit of the guarantee above. A note inside the interval the
    // round trip rebuilt is placed against the rebuilt one, and 0.08 s is 0.16
    // of a beat - two thirds of a sixteenth slot, which rounds to one.
    const round = nudgedDownbeat(nudgedDownbeat(UNEVEN, 1), -1);
    const notes = struckAt(0.0, 2.0);

    expect(firstAttackSlot(deriveScore(session(UNEVEN, notes)).doc, 0)).toBe(0);
    expect(firstAttackSlot(deriveScore(session(round, notes)).doc, 0)).toBe(1);
  });
});

/**
 * The level the tracker found, corrected.
 *
 * The case is a real one, and the numbers below are its numbers. A user's bass
 * stem - Ab minor, 153 BPM, 4:22 - transcribed at **100.96**: a clean 3:2
 * error, because the line is a 3+3+2 eighth figure and the strongest onset
 * periodicity in it is the three-eighth grouping. The tracker's *positions*
 * were good to 23 ms against the true eighth grid. Right pulse, wrong level.
 *
 * ## The drift test is the one that matters
 *
 * A test that only checked the resulting tempo would pass for `withTempo` too,
 * and would therefore say nothing: typing 153 into the tempo box gets the
 * number right and the timing wrong, because it lays a uniform pulse and
 * discards every per-beat measurement the tracker made. The take is human -
 * measured local tempo wanders 150.5 to 153.8 - so a uniform grid is right for
 * about fifteen bars and at chance half a minute in.
 *
 * So the fixture drifts, and the assertions are against a *ground truth* grid
 * rather than against a tempo: `DRIFTING_EIGHTHS` is an eighth-note grid whose
 * quarter tempo ramps 150.5 to 153.8, `TRACKED_DOTTED` is every third eighth of
 * it - what the tracker found - and `TRUE_QUARTERS` is every second, which is
 * where the beats actually are. Resampling the first at 1.5 has to land on the
 * second.
 */
describe('atMetricalLevel', () => {
  /** Evenly spaced beats at `bpm`, from the top of the audio. */
  const flatGrid = (bpm: number, count: number): BeatGrid => ({
    beatsSec: Array.from({ length: count }, (_, i) => (i * 60) / bpm),
    timeSignature: FOUR_FOUR
  });

  /** The take this exists for, as tracked: dotted quarters at 100.96 BPM. */
  const TRACKED_FLAT = flatGrid(100.96, 40);

  it('turns a tracked dotted quarter into a quarter at the corrected tempo', () => {
    const quarters = atMetricalLevel(TRACKED_FLAT, 1.5);
    const interval = quarters.beatsSec[1] - quarters.beatsSec[0];

    // 100.96 x 1.5. The score reads its tempo off the grid with `gridTempo`,
    // so this is also what the user is told the piece is at.
    expect(60 / interval).toBeCloseTo(151.44, 2);
    expect(gridTempo(quarters)).toBe(151);
  });

  it('puts the resampled beats where the plan says', () => {
    // The worked example: 0.000 0.594 1.188 1.782 tracked becomes
    // 0.000 0.396 0.792 1.189 - and the fourth of those is the tracked third
    // beat itself rather than an approximation of it.
    const quarters = atMetricalLevel(TRACKED_FLAT, 1.5);

    expect(quarters.beatsSec.slice(0, 4).map(sec => Number(sec.toFixed(3))))
      .toEqual([0, 0.396, 0.792, 1.189]);
    expect(quarters.beatsSec[3]).toBe(TRACKED_FLAT.beatsSec[2]);
  });

  /**
   * An eighth-note grid whose quarter tempo ramps 150.5 to 153.8 over ~71 s.
   *
   * The wander is the one measured on the real file across 20-second windows.
   * Built at the eighth level because both the tracked pulse (three eighths)
   * and the true beat (two) are whole multiples of it, so the two grids below
   * are exact subsets of one ground truth rather than two roundings of it.
   */
  const DRIFTING_EIGHTHS: number[] = (() => {
    const count = 361;
    const times = [0];
    for (let i = 0; i < count - 1; i++) {
      const bpm = 150.5 + (153.8 - 150.5) * (i / (count - 2));
      times.push(times[times.length - 1] + 30 / bpm);
    }

    return times;
  })();

  /** What the tracker found: the three-eighth grouping of the tresillo. */
  const TRACKED_DOTTED: BeatGrid = {
    beatsSec: DRIFTING_EIGHTHS.filter((_, i) => i % 3 === 0),
    timeSignature: FOUR_FOUR
  };

  /** Where the beats actually are. */
  const TRUE_QUARTERS: number[] = DRIFTING_EIGHTHS.filter((_, i) => i % 2 === 0);

  /**
   * The best uniform pulse there is for this take, in BPM.
   *
   * Deliberately not 153, and not the median either: this is the tempo that
   * makes `withTempo` end in exactly the right place, so the comparison below
   * is against the *best* an even pulse can do rather than against a badly
   * chosen one.
   */
  const BEST_UNIFORM_BPM =
    (60 * (TRUE_QUARTERS.length - 1)) /
    (TRUE_QUARTERS[TRUE_QUARTERS.length - 1] - TRUE_QUARTERS[0]);

  /** Furthest any beat of `grid` sits from where the beat actually is. */
  const maxError = (grid: BeatGrid, truth: number[]): number =>
    Math.max(...truth.map((sec, i) => Math.abs((grid.beatsSec[i] ?? Infinity) - sec)));

  const localBpm = (beats: number[], i: number): number => 60 / (beats[i + 1] - beats[i]);

  it('has something to say: the take drifts', () => {
    // Without this every assertion below would pass on a uniform fixture, and
    // `withTempo` would be as good an answer as this function is.
    expect(localBpm(TRUE_QUARTERS, 0)).toBeCloseTo(150.5, 1);
    expect(localBpm(TRUE_QUARTERS, TRUE_QUARTERS.length - 2)).toBeCloseTo(153.8, 1);
  });

  it('lands on the true beats of a take that drifts', () => {
    const quarters = atMetricalLevel(TRACKED_DOTTED, 1.5);

    expect(quarters.beatsSec.length).toBe(TRUE_QUARTERS.length);
    // Interpolation error only, and it is second-order: the tempo moves by
    // about 0.02 BPM between one tracked pulse and the next.
    expect(maxError(quarters, TRUE_QUARTERS)).toBeLessThan(0.001);
  });

  it('follows the drift where withTempo cannot', () => {
    // The contrast the whole function is for. `withTempo` is handed the best
    // uniform tempo this material has and still walks off the beat, because an
    // even pulse has no way to say that the take sped up.
    const uniform = withTempo(TRACKED_DOTTED, BEST_UNIFORM_BPM);
    const quarters = atMetricalLevel(TRACKED_DOTTED, 1.5);

    // 193 ms against 0.012 ms, worst at beat 90 of 181: half a beat out in the
    // middle of the take, which is where an even pulse anchored on beat 1 and
    // ending in the right place is at its worst.
    expect(maxError(uniform, TRUE_QUARTERS)).toBeGreaterThan(0.15);
    expect(maxError(quarters, TRUE_QUARTERS)).toBeLessThan(0.001);
    expect(maxError(uniform, TRUE_QUARTERS))
      .toBeGreaterThan(maxError(quarters, TRUE_QUARTERS) * 1000);
  });

  it('inherits the local tempo the tracker measured instead of averaging it', () => {
    const quarters = atMetricalLevel(TRACKED_DOTTED, 1.5).beatsSec;
    const uniform = withTempo(TRACKED_DOTTED, BEST_UNIFORM_BPM).beatsSec;

    // The measured wander, arriving intact at the corrected level.
    expect(localBpm(quarters, 0)).toBeCloseTo(150.5, 1);
    expect(localBpm(quarters, quarters.length - 2)).toBeCloseTo(153.8, 1);

    // The same two windows of the same audio after `withTempo`: one number,
    // twice. The measurements are gone.
    expect(localBpm(uniform, 0)).toBeCloseTo(BEST_UNIFORM_BPM, 6);
    expect(localBpm(uniform, uniform.length - 2)).toBeCloseTo(BEST_UNIFORM_BPM, 6);
  });

  it('is the same grid, by identity, at level 1', () => {
    // Not only an optimisation: `resuppressed` reads `beatsSec` identity as
    // "the user has corrected the beats", so an equal-but-new array here would
    // stop a suppression change re-tracking for the rest of the session.
    expect(atMetricalLevel(TRACKED_DOTTED, 1)).toBe(TRACKED_DOTTED);
  });

  it('samples integer indices exactly, so a level is reversible through the tracked grid', () => {
    // Levels are applied to the tracked grid rather than chained, so this is
    // the arithmetic that "1 -> 1.5 -> 1 returns the original" rests on -
    // checked rather than taken on trust from the shortcut above, because
    // `i / 1.5` is not exact for every `i`. Every resampled beat whose index
    // lands on a tracked one is that tracked beat, bit for bit.
    for (const beatsPerPulse of [0.5, 1.5, 2, 3, 4]) {
      const resampled = atMetricalLevel(TRACKED_DOTTED, beatsPerPulse).beatsSec;
      let exact = 0;

      resampled.forEach((sec, i) => {
        const index = i / beatsPerPulse;
        if (!Number.isInteger(index) || index >= TRACKED_DOTTED.beatsSec.length) return;

        exact++;
        expect(sec).toBe(TRACKED_DOTTED.beatsSec[index]);
      });

      expect(exact).toBeGreaterThan(1);
    }
  });

  it('halves the beat count when the tracker found the subdivision', () => {
    // The other direction: 0.5 says the tracked pulse is an eighth and the beat
    // is the quarter, so every second tracked beat survives.
    const coarser = atMetricalLevel(flatGrid(240, 9), 0.5);

    expect(coarser.beatsSec).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(gridTempo(coarser)).toBe(120);
  });

  it('keeps the time signature', () => {
    expect(atMetricalLevel(TRACKED_DOTTED, 1.5).timeSignature).toEqual(FOUR_FOUR);
  });

  it('refuses a level that is not a positive number', () => {
    for (const bad of [0, -1.5, NaN, Infinity, -Infinity]) {
      expect(atMetricalLevel(GRID, bad)).toBe(GRID);
    }
  });

  it('refuses a level outside the range', () => {
    for (const bad of [MIN_BEATS_PER_PULSE / 2, MAX_BEATS_PER_PULSE + 1, 1e6]) {
      expect(atMetricalLevel(GRID, bad)).toBe(GRID);
    }
  });

  it('accepts both ends of the range', () => {
    expect(atMetricalLevel(GRID, MIN_BEATS_PER_PULSE)).not.toBe(GRID);
    expect(atMetricalLevel(GRID, MAX_BEATS_PER_PULSE)).not.toBe(GRID);
  });

  it('cannot be asked for more beats than a score can hold', () => {
    // The hazard the ceiling exists for, the same one `withTempo` has: beats
    // are bars, and bars are MasterBarDocs, quantizeBar calls and full bars of
    // rests. Five minutes at the top of the tracker's band, as tracked.
    const fiveMinutes = flatGrid(210, 1051);

    expect(atMetricalLevel(fiveMinutes, MAX_BEATS_PER_PULSE).beatsSec.length)
      .toBeLessThan(4300);
    expect(atMetricalLevel(fiveMinutes, 1e4).beatsSec).toBe(fiveMinutes.beatsSec);
  });

  it('never returns a grid of under two beats', () => {
    // `secondsToBeats` reads a shorter grid as position 0 for every note in the
    // piece, so the floor is the one `withTempo` keeps. The second beat is
    // extrapolated past the end using the final tracked interval.
    const short: BeatGrid = { beatsSec: [1.0, 1.5, 2.0], timeSignature: FOUR_FOUR };
    const coarse = atMetricalLevel(short, MIN_BEATS_PER_PULSE);

    expect(coarse.beatsSec.length).toBe(2);
    expect(coarse.beatsSec[0]).toBe(1.0);
    expect(coarse.beatsSec[1]).toBeCloseTo(3.0, 9);
  });

  it('leaves a grid it cannot resample alone', () => {
    const single: BeatGrid = { beatsSec: [1.0], timeSignature: FOUR_FOUR };
    const empty: BeatGrid = { beatsSec: [], timeSignature: FOUR_FOUR };

    expect(atMetricalLevel(single, 1.5)).toBe(single);
    expect(atMetricalLevel(empty, 1.5)).toBe(empty);
  });

  it('refuses a grid whose ends are not times', () => {
    // Nothing here would throw - the count comes off the index span - but
    // every interpolated time would be NaN, and a grid of NaNs is worse than
    // the grid that was handed in. `withTempo` refuses the same two.
    for (const bad of [NaN, Infinity]) {
      const broken: BeatGrid = { beatsSec: [bad, 0.5, 1.0], timeSignature: FOUR_FOUR };
      const brokenEnd: BeatGrid = { beatsSec: [0, 0.5, bad], timeSignature: FOUR_FOUR };

      expect(atMetricalLevel(broken, 1.5)).toBe(broken);
      expect(atMetricalLevel(brokenEnd, 1.5)).toBe(brokenEnd);
    }
  });
});

/**
 * The question a caller asks before recording a level.
 *
 * `atMetricalLevel` hands back the grid it was given both when it refuses and
 * when the level is 1, so identity cannot tell a caller which happened - unlike
 * `nudgedDownbeat`, where it can. A session that recorded a refused level would
 * claim a level its grid is not at, and `resuppressed` would then read a hand
 * correction where there is none and stop re-tracking.
 */
describe('canApplyMetricalLevel', () => {
  it('is true at level 1, which is applied and is the identity', () => {
    expect(canApplyMetricalLevel(GRID, 1)).toBeTrue();
    expect(atMetricalLevel(GRID, 1)).toBe(GRID);
  });

  it('is false for every level atMetricalLevel refuses', () => {
    for (const bad of [0, -1, NaN, Infinity, MAX_BEATS_PER_PULSE + 1, 1e6]) {
      expect(canApplyMetricalLevel(GRID, bad)).toBeFalse();
      expect(atMetricalLevel(GRID, bad)).toBe(GRID);
    }
  });

  it('is false for a grid it cannot resample, at any level', () => {
    const short: BeatGrid = { beatsSec: [1.0], timeSignature: FOUR_FOUR };
    const broken: BeatGrid = { beatsSec: [0, 0.5, NaN], timeSignature: FOUR_FOUR };

    for (const level of [0.5, 1, 1.5, 2]) {
      expect(canApplyMetricalLevel(short, level)).toBeFalse();
      expect(canApplyMetricalLevel(broken, level)).toBeFalse();
    }
  });

  it('is true across the range on a grid that can take it', () => {
    for (const level of [MIN_BEATS_PER_PULSE, 0.5, 1, 1.5, 2, 3, MAX_BEATS_PER_PULSE]) {
      expect(canApplyMetricalLevel(GRID, level)).toBeTrue();
    }
  });
});

/**
 * What the level is for, checked through derivation rather than on the array.
 *
 * `BeatGrid.beatsSec` is one beat of the time signature's *denominator*, and
 * after a resampling at 1.5 those entries are quarters where they were dotted
 * quarters. Nothing downstream may assume the grid came straight from
 * `trackBeats` - `deriveScore` reaches it only through `secondsToBeats`,
 * `gridTempo` and the bar count, all of which read it as a list of beat times -
 * and this is the assertion that says so out loud.
 *
 * The case is the real one in miniature: a line played in quarters, tracked as
 * dotted quarters. At level 1 the beats the tracker found are written as the
 * beat, and a line on the true quarters lands off the grid; at 1.5 it lands on
 * it.
 */
describe('deriving a score at a metrical level', () => {
  /** Six dotted quarters of 0.6 s: 100 BPM as tracked, 150 BPM as played. */
  const TRACKED_DOTTED: BeatGrid = {
    beatsSec: [0, 0.6, 1.2, 1.8, 2.4, 3.0],
    timeSignature: FOUR_FOUR
  };

  /** Four notes on the true quarters, 0.4 s apart, on four different strings. */
  const QUARTER_NOTES: DetectedNote[] = [28, 33, 38, 43].map((pitch, index) => ({
    id: `q${index}`,
    pitch,
    onsetSec: index * 0.4,
    offsetSec: index * 0.4 + 0.3,
    confidence: 1,
    bendCents: []
  }));

  const session = (grid: BeatGrid): TranscriptionSession => ({
    id: 's1',
    sourceName: 'tresillo.wav',
    durationSec: 3.2,
    notes: QUARTER_NOTES,
    rawNotes: QUARTER_NOTES,
    bendFrameRateHz: 86.13,
    grid,
    trackedGrid: TRACKED_DOTTED,
    beatsPerPulse: 1,
    harmonics: DEFAULT_HARMONIC_OPTIONS,
    decisions: NO_NOTE_DECISIONS,
    settings: createDefaultDerivationSettings()
  });

  /** Which sixteenth slot of `bar` each attack sits on. */
  function attackSlots(doc: ScoreDoc, bar: number): number[] {
    const beats = doc.tracks[0].staves[0].bars[bar].voices[0].beats;

    return beats.flatMap((beat, index) =>
      beat.isRest || beat.notes[0].isTied ? [] : [beatSlots(beats.slice(0, index), 16)]
    );
  }

  it('writes the line off the beat at the level the tracker found', () => {
    // 0.4 s is two thirds of a tracked beat, so the second note is written on
    // the third sixteenth of the bar - a dotted eighth into a line of
    // quarters. This is the bug, in one array.
    expect(attackSlots(deriveScore(session(TRACKED_DOTTED)).doc, 0))
      .toEqual([0, 3, 5, 8]);
  });

  it('writes it on the beat at the corrected level', () => {
    const corrected = atMetricalLevel(TRACKED_DOTTED, 1.5);

    // One note per beat, which is what was played. A sixteenth slot is a
    // quarter of a beat, so the four quarters are slots 0, 4, 8 and 12.
    expect(attackSlots(deriveScore(session(corrected)).doc, 0)).toEqual([0, 4, 8, 12]);
  });

  it('reads the resampled entries as the denominator unit', () => {
    const corrected = atMetricalLevel(TRACKED_DOTTED, 1.5);

    // 100 BPM of dotted quarters is 150 BPM of quarters, and the score says so
    // because `gridTempo` reads the interval it is given rather than asking
    // where the grid came from.
    expect(deriveScore(session(TRACKED_DOTTED)).doc.tempo).toBe(100);
    expect(deriveScore(session(corrected)).doc.tempo).toBe(150);
  });

  it('loses nothing to the correction', () => {
    expect(deriveScore(session(atMetricalLevel(TRACKED_DOTTED, 1.5))).dropped).toEqual([]);
  });
});
