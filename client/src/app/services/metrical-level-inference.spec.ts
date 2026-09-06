import { TimeSignature } from '../models/composer.model';
import { BeatGrid, DetectedNote } from '../models/transcription.model';
import {
  LEVEL_MARGIN,
  MIN_INFERENCE_ONSETS,
  SubdivisionFit,
  inferMetricalLevel
} from './metrical-level-inference';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
const TWELVE_EIGHT: TimeSignature = { numerator: 12, denominator: 8, isCommon: false };
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };
const NINE_EIGHT: TimeSignature = { numerator: 9, denominator: 8, isCommon: false };
const THREE_EIGHT: TimeSignature = { numerator: 3, denominator: 8, isCommon: false };

/**
 * The tempo the real file tracked at: dotted quarters read as quarters, a clean
 * 3:2 error against the 153 BPM that was played.
 */
const TRACKED_BPM = 100.96;
const TRACKED_PERIOD_SEC = 60 / TRACKED_BPM;

/**
 * Deterministic jitter, uniform in `+/- spread` tracked beats.
 *
 * A spec cannot use `Math.random` and hand-writing a thousand onsets is not
 * readable, so this is a plain LCG. What it stands in for is real onset
 * timing: the tracked positions on the file this module exists for sit 23 ms
 * from the true eighth grid, which at a 0.594 s tracked beat is 0.039 - and a
 * uniform spread of 0.078 has exactly that mean absolute value. That is why
 * every fixture below reports `k = 3` at 0.039 without being told to.
 */
function jitter(count: number, spread: number, seed: number): number[] {
  const values: number[] = [];
  let state = seed;
  for (let i = 0; i < count; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values.push(((state / 2147483648) * 2 - 1) * spread);
  }
  return values;
}

const JITTER_SPREAD = 0.078;

/**
 * Onset positions in tracked beats: a repeating `cycle` of within-beat offsets
 * laid across `spanBeats` tracked beats, jittered.
 *
 * Offset by two beats so nothing sits on the grid's first beat, where a
 * negative jitter would put an onset outside the tracked span and quietly
 * change the count.
 */
function rhythm(
  count: number,
  cycle: number[],
  spanBeats: number,
  seed: number
): number[] {
  const noise = jitter(count, JITTER_SPREAD, seed);
  return Array.from(
    { length: count },
    (_, i) => 2 + Math.floor(i / cycle.length) * spanBeats + cycle[i % cycle.length] + noise[i]
  );
}

/** Notes at the given tracked-beat positions, on an even grid at `TRACKED_BPM`. */
function onsetsAt(positions: number[]): DetectedNote[] {
  return positions.map((position, i) => ({
    id: `n${i}`,
    pitch: 33,
    onsetSec: position * TRACKED_PERIOD_SEC,
    offsetSec: (position + 0.5) * TRACKED_PERIOD_SEC,
    confidence: 0.8,
    bendCents: []
  }));
}

/** An even tracked grid long enough to measure every one of `positions`. */
function gridFor(positions: number[], timeSignature: TimeSignature): BeatGrid {
  const beats = Math.ceil(Math.max(...positions)) + 2;
  return {
    beatsSec: Array.from({ length: beats }, (_, i) => i * TRACKED_PERIOD_SEC),
    timeSignature
  };
}

function fitFor(fits: SubdivisionFit[], subdivision: number): SubdivisionFit {
  const fit = fits.find(candidate => candidate.subdivision === subdivision);
  if (fit === undefined) throw new Error(`No fit measured for k=${subdivision}`);
  return fit;
}

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

/**
 * The real file's shape: a 3+3+2 tresillo bassline whose accents fall on the
 * three-eighth grouping the tracker locked onto, with the line's remaining
 * notes on the off-eighths of that grouping.
 *
 * Nine onsets on the tracked pulse to three off it, which is the mix that
 * reproduces **both** numbers the investigation measured - `k = 3` at 0.039 and
 * `k = 4` at 0.049 - rather than only the first. The assertions below pin that,
 * because a fixture that merely proposed 1.5 would pass while measuring
 * something else entirely.
 */
const TRESILLO_CYCLE = [0, 1, 1 + 1 / 3, 2, 3, 3 + 2 / 3, 4, 5, 5 + 1 / 3, 6, 7, 8];
const TRESILLO_SPAN = 9;
const TRESILLO_SEED = 20260906;

function tresillo(count = 1002): number[] {
  return rhythm(count, TRESILLO_CYCLE, TRESILLO_SPAN, TRESILLO_SEED);
}

describe('inferMetricalLevel, on the file this exists for', () => {
  it('reproduces the measured fits: k=3 at 0.039, k=4 at 0.049', () => {
    const positions = tresillo();
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(fitFor(proposal.fits, 3).meanDeviation).toBeCloseTo(0.039, 3);
    expect(fitFor(proposal.fits, 4).meanDeviation).toBeCloseTo(0.049, 3);
    // The chance baselines the ratios are taken against, stated once so a
    // change to 1/(4k) cannot pass silently.
    expect(fitFor(proposal.fits, 3).chance).toBeCloseTo(1 / 12, 6);
    expect(fitFor(proposal.fits, 4).chance).toBeCloseTo(1 / 16, 6);
  });

  it('proposes a dotted value in 4/4', () => {
    const positions = tresillo();
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('proposed');
    expect(proposal.beatsPerPulse).toBe(1.5);
  });

  it('proposes no change in 12/8, where a ternary pulse is the beat', () => {
    // The heart of scope decision 3. Same onsets, same grid, same measurements
    // - only the meter differs, and the answer flips from "the tracker found a
    // dotted quarter" to "the tracker found the beat".
    const positions = tresillo();
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, TWELVE_EIGHT),
      TWELVE_EIGHT
    );

    expect(proposal.verdict).toBe('proposed');
    expect(proposal.beatsPerPulse).toBe(1);
    // Same evidence either way; only the reading of it changed.
    expect(fitFor(proposal.fits, 3).meanDeviation).toBeCloseTo(0.039, 3);
  });

  it('reads 6/8 and 9/8 as compound too, and 3/8 as simple', () => {
    const positions = tresillo();
    const notes = onsetsAt(positions);
    const levelIn = (timeSignature: TimeSignature): number | null =>
      inferMetricalLevel(notes, gridFor(positions, timeSignature), timeSignature).beatsPerPulse;

    expect(levelIn(SIX_EIGHT)).toBe(1);
    expect(levelIn(NINE_EIGHT)).toBe(1);
    // 3/8 is three beats, not one group of three, so a ternary pulse there is
    // a dotted value exactly as it is in 4/4.
    expect(levelIn(THREE_EIGHT)).toBe(1.5);
  });

  it('returns the evidence ranked best fit first', () => {
    const positions = tresillo();
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.fits.map(fit => fit.subdivision)).toEqual([3, 2, 4]);
    expect(proposal.onsetCount).toBe(positions.length);
    for (const fit of proposal.fits) {
      expect(fit.ratio).toBeCloseTo(fit.meanDeviation / fit.chance, 9);
    }
  });
});

describe('inferMetricalLevel, on straight material', () => {
  it('proposes no change for eighth notes on the beat', () => {
    const positions = rhythm(400, [0, 0.5], 1, 51);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('proposed');
    expect(proposal.beatsPerPulse).toBe(1);
  });

  it('proposes no change for sixteenth notes', () => {
    // The case that needs `k = 4`. A sixteenth sits exactly half a
    // 2-subdivision from the nearest one, so `k = 2` scores at chance here -
    // 0.99 - and a candidate set without `k = 4` would hand the comparison to
    // a ternary reading that fits no better than it does.
    const positions = rhythm(400, [0, 0.25, 0.5, 0.75], 1, 51);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(fitFor(proposal.fits, 2).ratio).toBeGreaterThan(0.9);
    expect(proposal.verdict).toBe('proposed');
    expect(proposal.beatsPerPulse).toBe(1);
  });

  it('proposes no change when the onsets say nothing about the subdivision', () => {
    // Onsets only on the tracked beats. Every candidate then measures the same
    // deviation, so the ratios are ordered purely by chance baseline and the
    // *coarsest* candidate wins - which is why `k = 2` has to be in the set.
    // Without it the winner would be k=3 at 0.45 against k=4 at 0.60, a
    // separation of 0.75 that clears the margin comfortably, and this material
    // would propose 1.5 on no evidence whatever.
    const positions = rhythm(400, [0], 1, 77);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    const ternary = fitFor(proposal.fits, 3).ratio;
    expect(ternary / fitFor(proposal.fits, 4).ratio).toBeLessThanOrEqual(LEVEL_MARGIN);
    expect(fitFor(proposal.fits, 2).ratio).toBeLessThan(ternary);

    expect(proposal.verdict).toBe('proposed');
    expect(proposal.beatsPerPulse).toBe(1);
  });
});

describe('inferMetricalLevel, when it should decline', () => {
  it('proposes nothing on material that subdivides both ways', () => {
    // A tracked beat of triplets answered by a tracked beat of sixteenths.
    // Both hypotheses fit, neither fits much better: the ternary reading lands
    // at 0.77 and the binary one at 0.80, a separation of 0.96 against a
    // margin of 0.88. This is what genuinely ambiguous looks like, and a
    // threshold that never declines is not a threshold.
    const positions = rhythm(602, [0, 1 / 3, 2 / 3, 1, 1.25, 1.5, 1.75], 2, 11);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('tooClose');
    expect(proposal.beatsPerPulse).toBeNull();
    // Declining is not the same as measuring nothing: the numbers come back so
    // a caller can show why.
    expect(proposal.fits.length).toBe(3);
    expect(proposal.onsetCount).toBe(602);
  });

  it('proposes nothing below the onset floor, however clear the evidence', () => {
    const positions = tresillo(MIN_INFERENCE_ONSETS - 1);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('tooFewOnsets');
    expect(proposal.beatsPerPulse).toBeNull();
    expect(proposal.onsetCount).toBe(MIN_INFERENCE_ONSETS - 1);
    // Same material one onset longer is a proposal, so the floor is what
    // refused it rather than the evidence being weak.
    const enough = tresillo(MIN_INFERENCE_ONSETS);
    expect(
      inferMetricalLevel(onsetsAt(enough), gridFor(enough, FOUR_FOUR), FOUR_FOUR).beatsPerPulse
    ).toBe(1.5);
  });

  it('proposes nothing on onsets spread evenly across the beat', () => {
    // Twenty positions per tracked beat: no division of the beat describes
    // this any better than any other, and every ratio comes back at chance.
    const positions = rhythm(
      600,
      Array.from({ length: 20 }, (_, i) => i / 20),
      1,
      3
    );
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    expect(proposal.fits.every(fit => fit.ratio > 0.9)).toBe(true);
    expect(proposal.verdict).toBe('tooClose');
    expect(proposal.beatsPerPulse).toBeNull();
  });

  it('proposes nothing when the winner still fits worse than chance', () => {
    // Onsets on the *anti-nodes* of the ternary division - a sixth of a beat
    // either side of it - so nothing lands on a subdivision of anything. All
    // three candidates come back above 1: k=2 at 1.32, k=3 at 1.54, k=4 at
    // 1.21.
    //
    // The margin alone would still answer. The binary reading beats the
    // ternary one by 21 %, clearing 0.88 comfortably, and without the
    // beats-chance guard this would report "the tracker found the beat" on
    // material where every hypothesis fits worse than a coin toss. Winning a
    // comparison between two bad fits is not evidence.
    const positions = rhythm(600, [1 / 6, 5 / 6], 1, 3);
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      gridFor(positions, FOUR_FOUR),
      FOUR_FOUR
    );

    const binary = Math.min(fitFor(proposal.fits, 2).ratio, fitFor(proposal.fits, 4).ratio);
    expect(binary).toBeGreaterThan(1);
    expect(binary).toBeLessThanOrEqual(fitFor(proposal.fits, 3).ratio * LEVEL_MARGIN);

    expect(proposal.verdict).toBe('tooClose');
    expect(proposal.beatsPerPulse).toBeNull();
  });
});

describe('inferMetricalLevel, on input it cannot use', () => {
  it('measures only the onsets inside the tracked span', () => {
    const positions = tresillo();
    const grid = gridFor(positions, FOUR_FOUR);
    const lastSec = grid.beatsSec[grid.beatsSec.length - 1];

    // Two before the grid's first beat and one past its last, all in the region
    // `secondsToBeats` extrapolates rather than measures.
    const strays: DetectedNote[] = [-4 * TRACKED_PERIOD_SEC, -1, lastSec + 5].map(
      (onsetSec, i) => ({
        id: `stray${i}`,
        pitch: 33,
        onsetSec,
        offsetSec: onsetSec + 0.3,
        confidence: 0.8,
        bendCents: []
      })
    );
    const withStrays = onsetsAt(positions).concat(strays);

    const proposal = inferMetricalLevel(withStrays, grid, FOUR_FOUR);

    expect(proposal.onsetCount).toBe(positions.length);
  });

  it('declines rather than throwing on a grid too short to interpolate', () => {
    const positions = tresillo();
    const proposal = inferMetricalLevel(
      onsetsAt(positions),
      { beatsSec: [0], timeSignature: FOUR_FOUR },
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('tooFewOnsets');
    expect(proposal.onsetCount).toBe(0);
    expect(proposal.fits).toEqual([]);
  });

  it('declines rather than throwing on a grid whose ends are not times', () => {
    const positions = tresillo();
    const proposal = inferMetricalLevel(onsetsAt(positions), {
      beatsSec: [0, 1, Number.NaN],
      timeSignature: FOUR_FOUR
    }, FOUR_FOUR);

    expect(proposal.beatsPerPulse).toBeNull();
    expect(proposal.onsetCount).toBe(0);
  });

  it('declines rather than throwing on an empty note list', () => {
    const proposal = inferMetricalLevel(
      [],
      { beatsSec: [0, 0.6, 1.2], timeSignature: FOUR_FOUR },
      FOUR_FOUR
    );

    expect(proposal.verdict).toBe('tooFewOnsets');
    expect(proposal.fits).toEqual([]);
  });

  it('skips onsets that are not times', () => {
    const positions = tresillo();
    const notes = onsetsAt(positions);
    notes.push({
      id: 'nan',
      pitch: 33,
      onsetSec: Number.NaN,
      offsetSec: 1,
      confidence: 0.8,
      bendCents: []
    });

    const proposal = inferMetricalLevel(notes, gridFor(positions, FOUR_FOUR), FOUR_FOUR);

    expect(proposal.onsetCount).toBe(positions.length);
    expect(proposal.beatsPerPulse).toBe(1.5);
  });
});
