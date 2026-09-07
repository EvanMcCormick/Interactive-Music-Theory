/**
 * What `trackBeats` gets *wrong about tempo*, on material whose tempo is known.
 *
 * `beat-tracking.spec.ts` checks the tracker against pulses written by hand, and
 * `harmonic-accuracy.spec.ts` scores which notes survive suppression. Neither
 * has ever asked the question this file asks: given eleven synthetic lines whose
 * tempo is fixed by their own construction, and the detector output frozen in
 * `detections.fixture.ts`, **how often is the tracked tempo the played tempo?**
 *
 * Nothing here needs a browser beyond karma, a model, a GPU or audio - the
 * detections are frozen and everything else is arithmetic - so it runs in the
 * default suite and gives the same answer on every machine.
 *
 * ## Where the true tempos come from
 *
 * Derived from `material.ts`, never written down here. A table of BPMs beside a
 * file that can be edited is a table that goes quietly wrong; a derivation goes
 * loudly wrong. Two steps:
 *
 * 1. **The lattice unit** is found from the onsets alone - the shortest period
 *    that maps most onsets onto other onsets (`latticeUnit`). It reads 0.6 s off
 *    `walking`, 0.10714 s off `run`, and 1.6 s off `leaps`, whose onsets are two
 *    interleaved voices rather than an even grid.
 * 2. **Which note value that unit is** cannot be read off onsets - that is the
 *    whole reason a beat tracker can be right about the pulse and wrong about
 *    the level - so it is declared per material in `LABELLED`, each entry citing
 *    the construction it comes from. `octaves` is literally built at
 *    `60 / 116 / 2`, so its unit is an eighth and `stepsPerBeat` is 2.
 *
 * Change a spacing in `material.ts` and the true tempo here moves with it.
 * Make a labelled material irregular and `latticeUnit` returns null and the
 * suite fails rather than measuring against a tempo that no longer exists.
 *
 * The five materials absent from `LABELLED` - `pedal`, `repeats`, `fifths`,
 * `quietOverLoud`, `loudOverQuiet` - have no tempo to be right or wrong about,
 * and `latticeUnit` independently finds no unit in any of them, which is
 * asserted below rather than assumed.
 *
 * ## What the columns mean
 *
 * | column | what it is |
 * |---|---|
 * | true | derived above |
 * | tracked | median inter-beat interval of the `trackBeats` grid, as BPM |
 * | ratio | tracked / true, so a 2:1 or 3:2 error reads as 0.50 or 0.67 |
 * | proposal | what `inferMetricalLevel` returns, verdict and all |
 * | applied | `atMetricalLevel` at that proposal, and whether it lands on true |
 *
 * The last column is the one that had never been looked at: it measures the
 * metrical-level machinery **end to end** on labelled data, rather than
 * measuring the inference in isolation against synthetic onsets as
 * `metrical-level-inference.spec.ts` does.
 *
 * ## The result, plainly
 *
 * **7 of 11 within 3 %**, and the four that miss do not miss in the way the real
 * file does. Not one of them is a clean 2:1 or 3:2 metrical-level error on
 * material the detector actually resolves:
 *
 * | material | miss | what it actually is |
 * |---|---|---|
 * | `leaps` | 37.5 true, 187.50 tracked | **outside the search band.** `minBpm` is 50; the tracker cannot return 37.5 and was never able to. Flagged in the table rather than counted as a tracking error. |
 * | `decrescendo` | 133.33 true, 139.53 tracked | **4.7 % out - a precision miss, not a level error.** `crescendo` is the same eight onsets at the same eight times with the velocity ramp reversed, and tracks at 136.36, inside tolerance. The pair differ by which notes the detector found, and by nothing else. |
 * | `run` | 140 true, 103.45 tracked | **71 % of `run` is never detected.** What is left is not a sixteenth stream, and 0.739 is not a metrical ratio of anything. |
 * | `ghosts` | 100 true, 67.42 tracked | **62 % never detected**, and only 4 onsets survive inside the tracked span. 0.674 reads like 2:3 and is four samples of noise. |
 *
 * So the tracker is **better on this material than the real file suggested**, and
 * the two worst rows are the detector's failures arriving at the tracker rather
 * than the tracker's own. That is the honest read, and it is also the limit of
 * what this material can say: nothing here reproduces the 3:2 error that
 * `metrical-level-inference.ts` was built for, so this file does not test the
 * case that module exists for.
 *
 * ## What it does say about the metrical level machinery, which is worse
 *
 * **`inferMetricalLevel` never fires on any of it.** `MIN_INFERENCE_ONSETS` is
 * 250 and the richest material here contributes 19 measured onsets, so every
 * verdict is `tooFewOnsets`, the applied column is the tracked column, and the
 * end-to-end path is exercised by nothing at all. That is the module behaving
 * exactly as documented.
 *
 * `favouredLevel` then asks what the module's own published `fits` would have
 * chosen with that floor lifted - a diagnostic, not a prediction - and the
 * answer is the reason the floor is not negotiable:
 *
 * - **It proposes 1.5 on `octaves`**, which is straight eighths at 116 and which
 *   the tracker already got right at 115.38. Applying it gives **173.08**. The
 *   inference would take a correct answer and break it, on material it has no
 *   business touching.
 * - It repairs **nothing**: 6 of 11 would land against 7 of 11 tracked. Lifting
 *   the floor is strictly net-negative here.
 *
 * The cause is visible in the same table. `octaves` fits `k = 3` at 0.24 against
 * `k = 2` at 0.76 - which looks emphatic and is eleven onsets of noise, because
 * 56 % of `octaves` is undetected and what survives is not an eighth grid.
 * `MIN_INFERENCE_ONSETS` is the only thing standing between that and a rebuilt
 * grid, and this is the first labelled evidence that it earns its keep.
 *
 * ## The assertions are a regression floor, not a target
 *
 * Per-material tracked tempos are pinned within `PIN_TOLERANCE_BPM` because they
 * are fixed by two frozen files and nothing else: pinning them is how a change
 * says *which* material moved. They are not aspirations, and re-freezing one
 * deliberately is a normal thing to do.
 *
 * The accuracy counts are floors. They are not good numbers and pinning them is
 * the opposite of aspiration - it is so that a refactor of `beat-tracking.ts`
 * that quietly costs tempo accuracy has something to fail against.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

import { TimeSignature } from '../../models/composer.model';
import { BeatGrid, DetectedNote } from '../../models/transcription.model';
import { atMetricalLevel } from '../beat-grid-edit';
import { DEFAULT_BEAT_OPTIONS, trackBeats } from '../beat-tracking';
import {
  LEVEL_MARGIN,
  MIN_INFERENCE_ONSETS,
  inferMetricalLevel
} from '../metrical-level-inference';
import type { MetricalLevelProposal, SubdivisionFit } from '../metrical-level-inference';
import { suppressHarmonics } from '../transcription-harmonics';
import { MATERIAL, materialDurationSec } from './material';
import type { Material } from './material';
import { detectionsOf } from './detections.fixture';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

/**
 * How many lattice units make one beat, for every material that has a tempo.
 *
 * The number cannot be derived - onsets alone cannot say whether an even stream
 * is quarters or eighths - so each entry cites the construction in `material.ts`
 * it is read from. Absence means the material has no tempo; see the docblock.
 */
const LABELLED: Readonly<Record<string, number | undefined>> = {
  /** `line(..., 0.6, ...)`: quarters at 100. */
  walking: 1,
  /** `line(..., 60 / 116 / 2, ...)`: eighths at 116. */
  octaves: 2,
  /** `line(..., 60 / 140 / 4, ...)`: sixteenths at 140. */
  run: 4,
  /** Root notes 1.6 s apart, each answered 0.35 s later. */
  leaps: 1,
  /** Thumbed roots 1.0 s apart, each popped 0.22 s later. */
  slap: 1,
  /** `line(..., 0.5, ...)`: quarters at 120. */
  guitar: 1,
  /** `line(..., 1.2, ...)`: quarters at 50. */
  ballad: 1,
  /** `i * 0.45`: quarters at 133.33. */
  crescendo: 1,
  /** The same eight onsets as `crescendo`, ramp reversed. */
  decrescendo: 1,
  /** A 0.3 s grid with two slots left empty: eighths at 100. */
  ghosts: 2,
  /** `(i * 60) / 108 / 2`: eighths at 108. */
  accents: 2
};

/**
 * Slack for calling two onset times the same, in seconds.
 *
 * 1 ms. Onsets in `material.ts` are built by repeated addition of values like
 * `60 / 116 / 2`, so nominally equal spacings differ in the last few bits, and
 * an exact comparison finds no lattice in `octaves` at all. A millisecond is
 * three orders of magnitude below any spacing here and two below the detector's
 * own onset accuracy, so it cannot merge two intervals that differ musically.
 */
const GRID_TOLERANCE_SEC = 1e-3;

/**
 * Fraction of shiftable onsets a candidate period has to carry.
 *
 * Not 1, because a material may rest: `ghosts` leaves two of its 0.3 s slots
 * empty and carries 10 of 12. Not lower, because `leaps` and `slap` are two
 * interleaved voices whose *inner* spacing (0.35 s, 0.22 s) carries 4 of 7, and
 * accepting that would read the answering voice as the beat.
 */
const MIN_LATTICE_HIT_RATE = 0.75;

/**
 * Repetitions of the unit the material has to contain.
 *
 * The degenerate reading of "period that maps onsets onto onsets" is a period
 * about as long as the whole material, which every onset set satisfies
 * vacuously - `quietOverLoud` offers 5.6 s across a 6.9 s span. Requiring three
 * repetitions rejects that and the four other irregular materials, whose best
 * candidates repeat 1.05 to 2.15 times, while `leaps` and `slap` - the sparsest
 * things here with a real tempo - repeat 3.22 times and survive.
 *
 * That 2.15-to-3.22 gap is the whole of the margin, and it is the one number in
 * this file chosen rather than measured.
 */
const MIN_LATTICE_REPEATS = 3;

/**
 * How close a tempo has to be to count as right, as a fraction.
 *
 * 3 %. The tracker works at `frameRateHz` 100, so every beat interval it can
 * return is a whole number of 10 ms frames; at the fastest labelled tempo here
 * - `run` at 140, a 0.4286 s beat - one frame is 2.3 %. Anything tighter would
 * fail material for being quantised rather than for being wrong.
 */
const TEMPO_TOLERANCE = 0.03;

/** Slack on the pinned per-material tempos. See the docblock. */
const PIN_TOLERANCE_BPM = 1;

/** Ascending distinct onset times, merged at `GRID_TOLERANCE_SEC`. */
function onsetTimes(notes: { onsetSec: number }[]): number[] {
  const sorted = notes.map(note => note.onsetSec).sort((a, b) => a - b);

  const distinct: number[] = [];
  for (const onset of sorted) {
    const last = distinct[distinct.length - 1];
    if (last === undefined || onset - last > GRID_TOLERANCE_SEC) distinct.push(onset);
  }
  return distinct;
}

/** Fraction of onsets that land on another onset when shifted by `period`. */
function hitRate(onsets: number[], period: number): number {
  const last = onsets[onsets.length - 1];

  let shiftable = 0;
  let hits = 0;
  for (const onset of onsets) {
    const target = onset + period;
    if (target > last + GRID_TOLERANCE_SEC) continue;
    shiftable++;
    if (onsets.some(other => Math.abs(other - target) <= GRID_TOLERANCE_SEC)) hits++;
  }

  return shiftable === 0 ? 0 : hits / shiftable;
}

/**
 * The shortest period the onsets repeat at, or null when they do not.
 *
 * Candidates are every interval present between two onsets, shortest first, so
 * the search only ever considers periods the material itself contains. The
 * first that clears `MIN_LATTICE_HIT_RATE` wins; the walk stops once candidates
 * grow past `MIN_LATTICE_REPEATS`, which is what keeps a period as long as the
 * material from winning by default.
 */
function latticeUnit(onsets: number[]): number | null {
  if (onsets.length < 2) return null;
  const span = onsets[onsets.length - 1] - onsets[0];

  const candidates: number[] = [];
  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < onsets.length; j++) candidates.push(onsets[j] - onsets[i]);
  }
  candidates.sort((a, b) => a - b);

  for (const period of candidates) {
    if (period <= GRID_TOLERANCE_SEC) continue;
    if (span / period < MIN_LATTICE_REPEATS) return null;
    if (hitRate(onsets, period) >= MIN_LATTICE_HIT_RATE) return period;
  }
  return null;
}

/** The tempo a material was built at, or null when it has none. */
function trueBpm(material: Material): number | null {
  const stepsPerBeat = LABELLED[material.name];
  if (stepsPerBeat === undefined) return null;

  const unit = latticeUnit(onsetTimes(material.notes));
  if (unit === null) return null;

  return 60 / (unit * stepsPerBeat);
}

/**
 * The tempo a grid states, from the median of its beat intervals.
 *
 * The median rather than the mean over the whole span, because the dynamic
 * program is free to stretch one interval to reach a strong onset and a mean
 * would spread that across every beat. Returns null for a grid too short to
 * have an interval.
 */
function gridBpm(grid: BeatGrid): number | null {
  const beats = grid.beatsSec;
  if (beats.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  intervals.sort((a, b) => a - b);

  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2 === 1
      ? intervals[middle]
      : (intervals[middle - 1] + intervals[middle]) / 2;

  return median > 0 ? 60 / median : null;
}

/**
 * The level `inferMetricalLevel`'s own fits favour, ignoring the onset floor.
 *
 * A **diagnostic and not a prediction**: the pipeline never reaches this point
 * on material this short, and `MIN_INFERENCE_ONSETS` exists precisely because a
 * fit over forty onsets separates hypotheses that are not actually different.
 * It is reported so that the shape of the evidence on labelled material is
 * visible at all, rather than eleven identical `tooFewOnsets` rows.
 *
 * `LEVEL_MARGIN` is imported rather than restated, and the fits are the
 * module's own published output, so this cannot drift from the rule it mirrors
 * in anything but the count.
 */
function favouredLevel(fits: SubdivisionFit[]): number | null {
  const ternaryFit = fits.find(fit => fit.subdivision === 3);
  const binaryFits = fits.filter(fit => fit.subdivision !== 3);
  if (!ternaryFit || binaryFits.length === 0) return null;

  const ternary = ternaryFit.ratio;
  const binary = Math.min(...binaryFits.map(fit => fit.ratio));
  if (!(Math.min(ternary, binary) < 1)) return null;

  if (ternary <= binary * LEVEL_MARGIN) return 1.5;
  if (binary <= ternary * LEVEL_MARGIN) return 1;
  return null;
}

/** One material's row of the table. */
interface Row {
  name: string;
  trueBpm: number;
  /** The suppressed notes the tracker was given. */
  notes: DetectedNote[];
  trackedBpm: number | null;
  proposal: MetricalLevelProposal;
  /** Tempo after `atMetricalLevel` at whatever was proposed. */
  appliedBpm: number | null;
  /** The same, at whatever the fits favour with the onset floor lifted. */
  favouredBpm: number | null;
  favoured: number | null;
  /**
   * Whether the true tempo is one `estimateTempo` could return at all.
   *
   * `leaps` at 37.5 is under `minBpm` 50, so its row measures the band and not
   * the tracker. Flagged rather than dropped: a labelled material the tracker
   * structurally cannot reach is worth seeing, and silently excluding it would
   * flatter the count.
   */
  inBand: boolean;
}

function within(bpm: number | null, target: number): boolean {
  return bpm !== null && Math.abs(bpm - target) / target <= TEMPO_TOLERANCE;
}

function bpmCell(bpm: number | null): string {
  return (bpm === null ? '-' : bpm.toFixed(2)).padStart(7);
}

/**
 * What the harness measures today, and what a change may not silently undo.
 *
 * Tracked tempos are pinned because two frozen files fix them exactly. The
 * counts below them are floors.
 */
const MEASURED: {
  trackedBpm: Readonly<Record<string, number | undefined>>;
  correctTracked: number;
  correctApplied: number;
  proposalsMade: number;
  favouredLands: number;
} = {
  trackedBpm: {
    walking: 100.0,
    octaves: 115.38,
    /** 71 % of the material undetected; not a metrical ratio of anything. */
    run: 103.45,
    /** Under `minBpm`. This is the band, not the tracker. */
    leaps: 187.5,
    slap: 60.61,
    guitar: 120.0,
    ballad: 50.42,
    crescendo: 136.36,
    /** The same onsets as `crescendo`, 3 BPM apart on dynamics alone. */
    decrescendo: 139.53,
    /** Four surviving onsets. */
    ghosts: 67.42,
    accents: 107.14
  },
  correctTracked: 7,
  correctApplied: 7,
  proposalsMade: 0,
  favouredLands: 6
};

describe('beat tracking tempo accuracy', () => {
  const rows: Row[] = [];

  beforeAll(() => {
    for (const material of MATERIAL) {
      const target = trueBpm(material);
      if (target === null) continue;

      // The suppressed list, not the raw detections: `trackBeats` runs on
      // `TranscriptionSession.notes`, so measuring a grid built from anything
      // else would be measuring a pipeline that does not exist.
      const notes = suppressHarmonics(detectionsOf(material.name));
      const tracked = trackBeats(notes, materialDurationSec(material), FOUR_FOUR);
      const proposal = inferMetricalLevel(notes, tracked, FOUR_FOUR);
      const favoured = favouredLevel(proposal.fits);

      rows.push({
        name: material.name,
        trueBpm: target,
        notes,
        trackedBpm: gridBpm(tracked),
        proposal,
        appliedBpm: gridBpm(atMetricalLevel(tracked, proposal.beatsPerPulse ?? 1)),
        favouredBpm: gridBpm(atMetricalLevel(tracked, favoured ?? 1)),
        favoured,
        inBand: target >= DEFAULT_BEAT_OPTIONS.minBpm && target <= DEFAULT_BEAT_OPTIONS.maxBpm
      });
    }
  });

  it('derives a tempo from every labelled material and from no other', () => {
    const labelled = MATERIAL.filter(material => trueBpm(material) !== null).map(m => m.name);
    expect(labelled).toEqual(Object.keys(LABELLED));

    // The five without an entry are irregular by construction, and the
    // derivation agrees independently of the declaration: no candidate period
    // in any of them both repeats three times and carries its onsets. If one
    // ever does, it has a tempo and belongs in `LABELLED`.
    for (const material of MATERIAL) {
      if (LABELLED[material.name] !== undefined) continue;
      expect(latticeUnit(onsetTimes(material.notes))).toBeNull();
    }
  });

  it('reports the tracked tempo, the proposal, and whether applying it lands', () => {
    log('');
    log(
      `TEMPO tracked on suppressed detections; +-${TEMPO_TOLERANCE * 100} % counts as right; ` +
        `* marks a true tempo outside ${DEFAULT_BEAT_OPTIONS.minBpm}-` +
        `${DEFAULT_BEAT_OPTIONS.maxBpm} BPM, which the tracker cannot return`
    );
    log('TEMPO  material         true tracked  ratio   onsets  proposal        applied  hits');
    for (const row of rows) {
      const ratio = row.trackedBpm === null ? NaN : row.trackedBpm / row.trueBpm;
      const proposed =
        row.proposal.beatsPerPulse === null
          ? row.proposal.verdict
          : `${row.proposal.verdict} ${row.proposal.beatsPerPulse}`;

      log(
        `TEMPO  ${(row.name + (row.inBand ? '' : ' *')).padEnd(13)} ` +
          `${bpmCell(row.trueBpm)} ${bpmCell(row.trackedBpm)} ` +
          `${(Number.isFinite(ratio) ? ratio.toFixed(3) : '-').padStart(6)} ` +
          `${String(row.proposal.onsetCount).padStart(6)}   ${proposed.padEnd(15)} ` +
          `${bpmCell(row.appliedBpm)}  ${within(row.appliedBpm, row.trueBpm) ? 'yes' : 'NO'}`
      );
    }

    const correctTracked = rows.filter(row => within(row.trackedBpm, row.trueBpm)).length;
    const correctApplied = rows.filter(row => within(row.appliedBpm, row.trueBpm)).length;
    log(
      `TEMPO  ${correctTracked}/${rows.length} tracked within tolerance; ` +
        `${correctApplied}/${rows.length} after applying what was proposed`
    );

    // Pinned, not aspired to: the frozen fixture and the frozen material fix
    // each of these exactly, so a move here names the material that changed.
    for (const row of rows) {
      const pinned = MEASURED.trackedBpm[row.name];
      expect(pinned).withContext(`no pinned tempo for ${row.name}`).toBeDefined();
      expect(row.trackedBpm).withContext(`${row.name} tracked no tempo`).not.toBeNull();

      // Written as a distance rather than `toBeCloseTo` so the tolerance is the
      // BPM in `PIN_TOLERANCE_BPM` rather than a decimal-place count that has
      // to be converted into one.
      const drift = Math.abs((row.trackedBpm ?? NaN) - (pinned ?? NaN));
      expect(drift)
        .withContext(`${row.name} tracked ${row.trackedBpm}, pinned at ${pinned}`)
        .toBeLessThanOrEqual(PIN_TOLERANCE_BPM);
    }

    // Floors. See the docblock: not targets.
    expect(correctTracked).toBeGreaterThanOrEqual(MEASURED.correctTracked);
    expect(correctApplied).toBeGreaterThanOrEqual(MEASURED.correctApplied);
  });

  it('shows the metrical level machinery declining on every labelled material', () => {
    log('');
    log(
      `TEMPO metrical level: nothing here reaches MIN_INFERENCE_ONSETS ` +
        `(${MIN_INFERENCE_ONSETS}); the column below is what the published fits ` +
        `favour with that floor lifted, and is a diagnostic only`
    );
    log('TEMPO  material       onsets   k=3   k=2   k=4  favours  at level  lands');
    for (const row of rows) {
      const ratioOf = (subdivision: number): string =>
        (row.proposal.fits.find(fit => fit.subdivision === subdivision)?.ratio ?? NaN)
          .toFixed(2)
          .padStart(5);

      log(
        `TEMPO  ${row.name.padEnd(13)} ${String(row.proposal.onsetCount).padStart(6)} ` +
          `${ratioOf(3)} ${ratioOf(2)} ${ratioOf(4)}  ` +
          `${(row.favoured === null ? 'nothing' : String(row.favoured)).padStart(7)} ` +
          `${bpmCell(row.favouredBpm)}  ${within(row.favouredBpm, row.trueBpm) ? 'yes' : 'NO'}`
      );
    }

    const proposalsMade = rows.filter(row => row.proposal.verdict === 'proposed').length;
    const favouredLands = rows.filter(row => within(row.favouredBpm, row.trueBpm)).length;
    const correctTracked = rows.filter(row => within(row.trackedBpm, row.trueBpm)).length;
    log(
      `TEMPO  ${proposalsMade}/${rows.length} proposed; ${favouredLands}/${rows.length} ` +
        `would land if the favoured level were applied, against ${correctTracked}/${rows.length} ` +
        'left alone'
    );

    // Every material is under the floor, so every verdict must be that and not
    // `tooClose`: a `tooClose` here would mean the count check had moved.
    for (const row of rows) {
      expect(row.proposal.onsetCount).toBeLessThan(MIN_INFERENCE_ONSETS);
      expect(row.proposal.verdict).toBe('tooFewOnsets');
      expect(row.proposal.beatsPerPulse).toBeNull();
    }

    expect(proposalsMade).toBe(MEASURED.proposalsMade);
    expect(favouredLands).toBe(MEASURED.favouredLands);

    // The finding, as an assertion: lifting the onset floor would repair
    // nothing and would break `octaves`, which the tracker already had right.
    // If this ever fails because the left side grew, the inference has become
    // useful on short material and `MIN_INFERENCE_ONSETS` is worth revisiting -
    // which is a conclusion to reach deliberately, not one to pass silently.
    expect(favouredLands).toBeLessThanOrEqual(correctTracked);
  });

  it('leaves the grid untouched when nothing is proposed', () => {
    // The applied column can only be read as a measurement of the correction if
    // "no proposal" really is the identity on the grid. `atMetricalLevel` at
    // level 1 returns the tracked grid itself, and every row here is level 1.
    for (const row of rows) {
      expect(row.appliedBpm).toBe(row.trackedBpm);
    }
  });
});
