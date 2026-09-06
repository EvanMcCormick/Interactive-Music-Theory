import { TimeSignature } from '../models/composer.model';
import { BeatGrid, DetectedNote } from '../models/transcription.model';
import { isCompoundMeter } from './transcription-quantize';
import { secondsToBeats } from './transcription-timing';

/**
 * Infers which note value the beat tracker actually found.
 *
 * A beat tracker can be right about *where* the beats are and wrong about
 * *which* note value they are. The file this module exists for is a 3+3+2
 * tresillo bassline at 153 BPM that tracked at 100.96 - a clean 3:2 error,
 * because the strongest onset periodicity in the line is the three-eighth
 * grouping - with tracked positions still good to 23 ms against the true eighth
 * grid. Right pulse, wrong level. `atMetricalLevel` is the correction; this is
 * what proposes it.
 *
 * Pure arithmetic over a note list and a grid, so it needs no audio and no
 * model to test, following `beat-tracking.ts` and `staff-pitch.ts`.
 *
 * ## The measurement
 *
 * For each candidate subdivision `k`, take every onset's position in tracked
 * beats and measure its distance to the nearest `k`-subdivision of the beat -
 * then the mean of those distances, in units of tracked beats. An onset placed
 * uniformly at random sits on average `1/(4k)` from the nearest subdivision, so
 * that is the chance baseline, and `meanDeviation / chance` is what the
 * candidates are compared on.
 *
 * The ratio and not the deviation, because a finer grid is closer to
 * *everything*: a subdivision of 4 has half the chance distance of a
 * subdivision of 2 and would win every comparison made on raw deviation,
 * including comparisons on noise.
 *
 * Measured on the real file, `k = 3` fits at 0.039 against a 0.083 chance and
 * `k = 4` at 0.049 against 0.0625 - ratios of 0.47 and 0.78. That is real
 * signal and it is not overwhelming, which is why the proposal has to be shown
 * with its evidence rather than applied silently.
 *
 * ## The candidates, and why `k = 2` is load-bearing
 *
 * `2`, `3` and `4`. The decision they settle is binary: does the tracked pulse
 * divide **in three** - it is a dotted value, or the beat of a compound meter -
 * or **in two**, which is what an ordinary beat does. So 2 and 4 are two
 * readings of one hypothesis and are scored as one, by whichever of them fits
 * better.
 *
 * Both readings are needed, and dropping either breaks a real case:
 *
 * - **Without `k = 4`**, straight sixteenths score at chance on `k = 2` - 0.995,
 *   because a sixteenth sits exactly half a 2-subdivision away, the worst place
 *   there is. The ternary reading sits at 0.990, so the two would be
 *   indistinguishable and plainly straight material would come back "cannot
 *   tell". With `k = 4` at 0.65 the binary reading wins it outright.
 * - **Without `k = 2`**, material whose onsets fall *only on the tracked beats*
 *   - which says nothing whatever about how the beat divides - proposes 1.5
 *   with apparent confidence. Every candidate then measures the same deviation,
 *   so the ratios are ordered purely by chance baseline and the coarsest
 *   surviving candidate wins: `k = 3` at 0.45 against `k = 4` at 0.60, a
 *   separation of 0.75 that clears the margin easily. Adding `k = 2` puts a
 *   binary reading at 0.30 in front of it and the answer becomes "the tracker
 *   found the beat", which is the truth.
 *
 * `k = 1` is excluded for the reason that second case exposes, pushed one step
 * further. It is not a subdivision - it measures whether onsets are on the
 * beats, which is what the tracker already maximised - and its 0.25 chance
 * baseline makes it the winner of almost any comparison it enters. On the real
 * file it scores 0.455 against `k = 3`'s 0.470 and would bury the finding.
 *
 * ## Reading the time signature
 *
 * A pulse that divides in three is a *correction* only in a simple meter. In
 * 6/8, 9/8 and 12/8 the dotted quarter is the beat and dividing in three is
 * what it is supposed to do, so proposing a correction there turns a right
 * answer into a wrong one - worse than proposing nothing. `isCompoundMeter` is
 * shared with `metricFrame` rather than restated, so the two cannot come to
 * disagree about the same session's meter.
 *
 * The whole mapping:
 *
 * | meter    | pulse divides in | proposal | why                                                                 |
 * |----------|------------------|----------|---------------------------------------------------------------------|
 * | simple   | three            | **1.5**  | a beat does not divide in three; the tracker found a dotted value    |
 * | simple   | two              | 1        | that is what a beat does; nothing here says the tracker erred        |
 * | compound | three            | 1        | that is what a *compound* beat does; the tracker found it            |
 * | compound | two              | 1        | a binary division says nothing about the length of a compound pulse  |
 *
 * So the only proposal that changes anything is simple meter plus a ternary
 * pulse, and every other row is "leave it alone". That is deliberate: this
 * exists to catch one specific tracker failure, not to second-guess the tracker
 * in general.
 *
 * ### What the compound row costs, and why it is still right
 *
 * `BeatGrid.beatsSec` holds one entry per *denominator unit* - eighths in 12/8,
 * not dotted quarters - so a tracker that found dotted quarters in 12/8 is
 * strictly at level 3, and proposing 1 leaves that uncorrected. That is a known
 * and separate problem: the pipeline reading the tracked beat as the
 * denominator unit is what makes setting 12/8 on this file produce
 * seven-second bars, and it predates any of this.
 *
 * Proposing 3 instead would conflate the two. A ternary division in a compound
 * meter is exactly what a *correctly* tracked compound beat looks like, so the
 * observation is not evidence of a tracker error - and a threefold change of
 * the grid driven by an observation consistent with the tracker being right is
 * the failure mode this module exists to avoid. A listener who wants it can
 * still say 3 on the control.
 *
 * ## Which onsets
 *
 * The **suppressed** list - `TranscriptionSession.notes`, after harmonic
 * partials are removed - and not `rawNotes`. Three reasons, in order of weight:
 *
 * 1. It is what the tracker saw. `trackBeats` runs on the suppressed notes, so
 *    measuring the grid against the raw list would score a grid against a
 *    population that did not produce it.
 * 2. A partial shares its fundamental's attack, so it contributes no *distinct*
 *    onset time. What it does contribute is a re-weighting of one, by how many
 *    partials the detector happened to find under that note - which is not a
 *    musical weight.
 * 3. The partials that survive suppression are disproportionately the ones with
 *    onsets of their own, displaced from any attack. Those are exactly the
 *    detections that blur the fit.
 *
 * Onsets are counted once each and not weighted by confidence. Simultaneous
 * onsets are left to add, matching `onsetSignal`'s treatment of a chord as a
 * stronger beat; weighting by confidence would make the effective sample size
 * smaller than `onsetCount`, and `onsetCount` is what `MIN_INFERENCE_ONSETS` is
 * a bound on.
 *
 * ## This proposes, it never applies
 *
 * Nothing here is stored on a session and nothing here writes `beatsPerPulse` -
 * `TranscriptionService.updateMetricalLevel` is the only thing that does, and
 * only when a listener asks. That matters after a re-track: changing a
 * suppression threshold rebuilds both the note list and the tracked grid, so a
 * proposal computed before it describes a grid that no longer exists. Because
 * this is a pure function of exactly those two inputs plus the meter,
 * "recompute the proposal" is just "call it again", and a caller that calls it
 * while rendering is current for free.
 *
 * The corollary for that caller: a proposal is not a level. An applied level
 * survives a re-track by design, so a control must seed itself from the
 * proposal without letting a later proposal move a listener's choice underneath
 * them.
 */

/**
 * How much better the winning hypothesis has to fit than the losing one.
 *
 * A ratio of ratios: the winner is accepted only when
 * `best <= runnerUp * LEVEL_MARGIN`, so 0.88 asks the winner to fit 12 %
 * better.
 *
 * ## Where 0.88 comes from
 *
 * Two opposite failures bound it, and it is placed between them rather than
 * against either one. Swept at 250 onsets, over 500 jitter seeds per fixture
 * and 8,000 runs of uniformly random onsets:
 *
 * | margin | real file proposes 1.5 | noise proposes anything | noise proposes 1.5 |
 * |--------|------------------------|-------------------------|--------------------|
 * | 0.80   | 19 %                   | 0.03 %                  | 0.00 %             |
 * | 0.85   | 85 %                   | 0.13 %                  | 0.00 %             |
 * | **0.88** | **99 %**             | **1.3 %**               | **0.11 %**         |
 * | 0.90   | 100 %                  | 4.1 %                   | 0.39 %             |
 * | 0.92   | 100 %                  | 10.5 %                  | 1.5 %              |
 *
 * - **Below 0.88 it stops being reliable on the file this exists for.** The
 *   file's measured shape - `k = 3` at 0.039, `k = 4` at 0.049 - is reproduced
 *   by a family of onset distributions rather than by one, because the fit at
 *   `k = 2` was never recorded and it is `k = 2` the ternary reading actually
 *   has to beat. Across the reconstructions that hit both measured numbers, the
 *   separation runs **0.77 to 0.83**, and the tightest of them clears a margin
 *   of 0.85 only 85 % of the time even at the onset floor below.
 * - **Above 0.90 it starts guessing.** Material that genuinely mixes ternary
 *   and binary subdivision - triplets answered by sixteenths - separates at
 *   **0.96**, and noise acceptance triples between 0.88 and 0.90.
 *
 * So the usable window is roughly `[0.88, 0.90]` and 0.88 is chosen at the end
 * of it that costs the *proposal* rather than the end that costs the *truth*: a
 * margin that declines on real evidence gives a listener nothing, while one
 * that accepts noise gives them a confident wrong answer. It is deliberately
 * not tuned to the tightest reconstruction - 0.83 - because that number is a
 * reconstruction and not a measurement.
 *
 * The Monte Carlo behind the noise column also settles `MIN_INFERENCE_ONSETS`,
 * which is the other half of this: every rate in the table is a rate *at a
 * count*, and the count is what buys the noise column down.
 */
export const LEVEL_MARGIN = 0.88;

/**
 * Onsets below which no proposal is made at all.
 *
 * The fit is a mean over onsets, so its sampling error falls as `1/sqrt(n)` and
 * a short or sparse passage will separate two hypotheses that are not actually
 * different. Concretely: a deviation drawn uniformly inside one subdivision has
 * a standard deviation of `1/(2k * sqrt(12))`, which against the `1/(4k)`
 * baseline makes the *ratio*'s standard error `0.577 / sqrt(n)` whatever `k`
 * is. Asking the margin's 0.12 to be three of those gives `n = 208`.
 *
 * 250, which the simulation agrees with. Uniformly random onsets - no rhythm at
 * all - produce a proposal at `LEVEL_MARGIN` in:
 *
 * | onsets | proposes anything | proposes 1.5 |
 * |--------|-------------------|--------------|
 * | 100    | 12 %              | 1.7 %        |
 * | 150    | 5.7 %             | 0.61 %       |
 * | 200    | 2.7 %             | 0.17 %       |
 * | **250** | **1.3 %**        | **0.11 %**   |
 * | 300    | 0.75 %            | 0.04 %       |
 *
 * The column that matters is the second: a spurious *binary* reading proposes 1
 * and changes nothing, where a spurious ternary one rebuilds the grid at 1.5.
 *
 * On the file this exists for, which keeps 986 notes across 4:22, this binds on
 * nothing. It binds on an excerpt: 250 eighth-note onsets at 150 BPM is about
 * fifty seconds of continuous playing, and under that the honest answer is that
 * there is not enough to tell - which costs a listener nothing, since the level
 * stays where the tracker put it and the control still sets it by hand.
 */
export const MIN_INFERENCE_ONSETS = 250;

/** Subdivision that says the pulse is ternary. */
const TERNARY_SUBDIVISION = 3;

/** Subdivisions that say it is binary. Scored as one hypothesis; see above. */
const BINARY_SUBDIVISIONS: readonly number[] = [2, 4];

/** The level a ternary pulse implies in a simple meter: a dotted value. */
const DOTTED_LEVEL = 1.5;

/** The level every other reading implies: the tracker found the beat. */
const UNCHANGED_LEVEL = 1;

/** How one candidate subdivision fits the onsets. */
export interface SubdivisionFit {
  /** Parts the tracked beat was divided into. */
  subdivision: number;
  /**
   * Mean distance from an onset to the nearest subdivision, in tracked beats.
   * Zero is a perfect fit.
   */
  meanDeviation: number;
  /** What a uniformly placed onset would average: `1/(4 * subdivision)`. */
  chance: number;
  /** `meanDeviation / chance`. Under 1 beats chance; lower is a better fit. */
  ratio: number;
}

/** Whether a level was proposed, and if not, why not. */
export type MetricalLevelVerdict = 'proposed' | 'tooFewOnsets' | 'tooClose';

/** A proposed metrical level, with the measurements that produced it. */
export interface MetricalLevelProposal {
  /**
   * Grid beats per tracked pulse to propose, or null when the evidence does not
   * support one. Only ever 1 or 1.5; see the mapping table above.
   */
  beatsPerPulse: number | null;
  verdict: MetricalLevelVerdict;
  /**
   * Every candidate measured, best fit first. Populated even when nothing is
   * proposed, so a caller can show *why* it declined.
   */
  fits: SubdivisionFit[];
  /** Onsets the fits were measured over: those inside the tracked span. */
  onsetCount: number;
}

/**
 * Proposes which note value the tracker found, and the evidence for it.
 *
 * `tracked` is `TranscriptionSession.trackedGrid` - the pristine tracker
 * output, since that is what a level is applied to. `timeSignature` is
 * `session.grid.timeSignature`, the meter **in force**, and deliberately not
 * `tracked.timeSignature`: `updateTimeSignature` corrects the working grid's
 * meter and leaves the tracked grid stamped with whatever the tracker ran
 * under, so reading the meter off `tracked` would hand a listener who set 12/8
 * the simple-meter answer.
 *
 * Degrades rather than throws, like the rest of this feature: a grid too short
 * to interpolate, a grid whose ends are not times, and an empty note list all
 * come back as `tooFewOnsets` with no fits and no proposal.
 */
export function inferMetricalLevel(
  notes: DetectedNote[],
  tracked: BeatGrid,
  timeSignature: TimeSignature
): MetricalLevelProposal {
  const positions = measuredPositions(notes, tracked);

  // Nothing to measure at all - an unusable grid, or no onset inside it.
  // Reported as no fits rather than as three fits sitting "exactly at chance",
  // which would read like a measurement and is not one.
  if (positions.length === 0) {
    return { beatsPerPulse: null, verdict: 'tooFewOnsets', fits: [], onsetCount: 0 };
  }

  const ternaryFit = fitSubdivision(positions, TERNARY_SUBDIVISION);
  const binaryFits = BINARY_SUBDIVISIONS.map(k => fitSubdivision(positions, k));
  // Measured even when the count refuses below: a caller saying why it declined
  // is more useful with the numbers than with a bare count.
  const fits = [ternaryFit, ...binaryFits].sort((a, b) => a.ratio - b.ratio);

  if (positions.length < MIN_INFERENCE_ONSETS) {
    return {
      beatsPerPulse: null,
      verdict: 'tooFewOnsets',
      fits,
      onsetCount: positions.length
    };
  }

  const ternary = ternaryFit.ratio;
  const binary = Math.min(...binaryFits.map(fit => fit.ratio));

  const declined: MetricalLevelProposal = {
    beatsPerPulse: null,
    verdict: 'tooClose',
    fits,
    onsetCount: positions.length
  };

  // A hypothesis that fits no better than a random placement is not evidence
  // for anything, however far ahead of the other one it happens to be. Written
  // as a negated `<` so NaN - false against everything - declines by the same
  // test rather than falling through to a comparison it would also fail.
  if (!(Math.min(ternary, binary) < 1)) return declined;

  if (ternary <= binary * LEVEL_MARGIN) {
    return {
      ...declined,
      // The whole of scope decision 3. In a compound meter a ternary pulse is
      // the beat, so the finding is that the tracker was right.
      beatsPerPulse: isCompoundMeter(timeSignature) ? UNCHANGED_LEVEL : DOTTED_LEVEL,
      verdict: 'proposed'
    };
  }

  if (binary <= ternary * LEVEL_MARGIN) {
    return { ...declined, beatsPerPulse: UNCHANGED_LEVEL, verdict: 'proposed' };
  }

  return declined;
}

/**
 * Onset positions in tracked beats, for the onsets the grid actually measured.
 *
 * Onsets outside `[first beat, last beat]` are dropped rather than converted.
 * `secondsToBeats` extrapolates past either end by design, but an extrapolated
 * position is a guess about where a beat would have been rather than a
 * measurement of where one was - and `trimBeats` cuts the grid back to the run
 * the onsets support precisely because the tracker's chain always runs past it.
 * Fitting subdivisions out there would be scoring the extrapolation. Dropping
 * them also keeps `onsetCount` a count of what was measured, which is what
 * `MIN_INFERENCE_ONSETS` is a bound on.
 */
function measuredPositions(notes: DetectedNote[], tracked: BeatGrid): number[] {
  const beats = tracked.beatsSec;
  if (beats.length < 2) return [];

  const first = beats[0];
  const last = beats[beats.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || !(last > first)) return [];

  const positions: number[] = [];
  for (const note of notes) {
    const onset = note.onsetSec;
    if (!Number.isFinite(onset) || onset < first || onset > last) continue;
    positions.push(secondsToBeats(onset, tracked));
  }

  return positions;
}

/**
 * How well the onsets sit on the `subdivision`-way division of the tracked beat.
 *
 * The subdivisions are anchored on the tracked beats themselves - offsets
 * `0, 1/k, 2/k, ...` from each - so there is no phase to search for: where a
 * subdivision falls inside a beat is fixed by the beat.
 */
function fitSubdivision(positions: number[], subdivision: number): SubdivisionFit {
  let total = 0;
  for (const position of positions) {
    const scaled = position * subdivision;
    total += Math.abs(scaled - Math.round(scaled)) / subdivision;
  }

  const chance = 1 / (4 * subdivision);
  // `inferMetricalLevel` returns before it can reach this with an empty list,
  // but chance rather than a 0/0 keeps the degenerate answer at "exactly at
  // chance" instead of at NaN.
  const meanDeviation = positions.length > 0 ? total / positions.length : chance;

  return { subdivision, meanDeviation, chance, ratio: meanDeviation / chance };
}
