import { TimeSignature } from '../models/composer.model';
import { BeatGrid, DetectedNote } from '../models/transcription.model';

/**
 * Finds where the beats fall, given the notes a detector heard.
 *
 * This is Ellis's dynamic-programming beat tracker, in three steps: an onset
 * signal, a global tempo estimate, then a dynamic program that picks the beat
 * sequence maximising landed onset energy less a penalty for straying from
 * that tempo. Most beat trackers are two passes - one for the tempo, one for
 * the phase - and the reason the phase pass is a dynamic program rather than a
 * greedy walk is that a greedy walk commits to an early mistake it can never
 * undo, while the DP keeps every possible predecessor alive until the whole
 * signal has been seen.
 *
 * The onset signal is built from `DetectedNote` onsets rather than the
 * spectral-flux envelope the literature assumes. For a plucked-string stem the
 * notes *are* the rhythm: every onset a flux envelope would find is already a
 * detected note carrying an amplitude, so the extra STFT buys nothing and
 * costs an FFT. The consequence is that this module needs no audio and no
 * model to test - it is arithmetic over a note list, checkable against pulses
 * written by hand. A spectral envelope is the upgrade path if note onsets ever
 * prove too sparse, and only `onsetSignal` would change.
 *
 * Two things carry most of the weight, and both are easy to lose:
 *
 * The **log-normal tempo prior** is what stops the estimate locking onto half
 * or double the played tempo. Raw autocorrelation cannot tell a beat from its
 * own subdivision - a line of eighth notes correlates at the eighth about as
 * well as at the quarter, and often better, because the shorter lag has more
 * overlapping terms to sum. Weighting each lag by how plausible its tempo is
 * as a *perceived* tempo breaks the tie the way a listener does.
 *
 * The **squared-log transition penalty** is what lets the beat drift with the
 * music without skipping one. It is symmetric in the ratio of the gap to the
 * period, so 10 % fast costs the same as 10 % slow, and it grows fast enough
 * that dropping or doubling a beat - a factor of two, costing
 * `tightness * ln(2)^2` - is never worth any amount of onset energy. A linear
 * penalty would do neither: it would charge a real accelerando nearly what it
 * charges a skipped beat.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent.
 */

export interface BeatTrackingOptions {
  /** Resolution the onset signal, tempo search and beat times all work at. */
  frameRateHz: number;
  /** Slowest tempo the search will consider. */
  minBpm: number;
  /** Fastest tempo the search will consider. */
  maxBpm: number;
  /** Tempo the log-normal prior is centred on. */
  priorBpm: number;
  /** Width of that prior, in octaves. 1.0 puts half or double at exp(-0.5). */
  priorWidth: number;
  /** Weight of the penalty for straying from the estimated period. */
  tightness: number;
}

export const DEFAULT_BEAT_OPTIONS: BeatTrackingOptions = {
  frameRateHz: 100,
  minBpm: 50,
  maxBpm: 210,
  priorBpm: 120,
  priorWidth: 1.0,
  tightness: 100
};

/**
 * Standard deviation of the blur applied to each onset, in seconds.
 *
 * Without it an onset is a single frame, so a beat one frame away scores
 * nothing and the tracker has to hit detected onsets exactly - which they are
 * not accurate enough to reward. 20 ms sits comfortably inside the 10-25 ms
 * onset accuracy measured for the detector.
 */
const ONSET_BLUR_SEC = 0.02;

/** Kernel half-width, in standard deviations. Beyond 3 the weight is under 2 %. */
const BLUR_RADIUS_SIGMAS = 3;

/**
 * Onset energy per frame: an impulse at each onset weighted by the note's
 * confidence, blurred by `ONSET_BLUR_SEC`.
 *
 * The kernel has unit *peak* rather than unit area, so a lone onset's frame
 * holds its confidence and simultaneous onsets add - a chord reads as a
 * stronger beat than a single note, which is what makes strong beats stand out
 * in the autocorrelation.
 */
export function onsetSignal(
  notes: DetectedNote[],
  durationSec: number,
  frameRateHz: number
): Float32Array {
  const rate =
    Number.isFinite(frameRateHz) && frameRateHz > 0
      ? frameRateHz
      : DEFAULT_BEAT_OPTIONS.frameRateHz;

  // Never shorter than the notes it has to hold: a caller's durationSec is
  // metadata about the file, and a detector can report an onset past it.
  const frames = Math.max(2, Math.ceil(spanSec(notes, durationSec) * rate) + 1);
  const signal = new Float32Array(frames);

  const sigma = Math.max(ONSET_BLUR_SEC * rate, 0.5);
  const radius = Math.ceil(BLUR_RADIUS_SIGMAS * sigma);

  for (const note of notes) {
    if (!Number.isFinite(note.onsetSec) || note.onsetSec < 0) continue;

    const weight = Number.isFinite(note.confidence) ? Math.max(note.confidence, 0) : 0;
    if (weight === 0) continue;

    const centre = Math.round(note.onsetSec * rate);
    const from = Math.max(0, centre - radius);
    const to = Math.min(frames - 1, centre + radius);
    for (let i = from; i <= to; i++) {
      const offset = (i - centre) / sigma;
      signal[i] += weight * Math.exp(-0.5 * offset * offset);
    }
  }

  return signal;
}

/**
 * Global tempo, in BPM.
 *
 * Autocorrelation over every lag in the `minBpm`..`maxBpm` band, each lag's
 * raw correlation scaled by the log-normal prior on the tempo it implies. See
 * the module docblock for why that prior is not optional.
 *
 * Falls back to `priorBpm` when the signal correlates with itself nowhere in
 * the band - a single note, or silence.
 */
export function estimateTempo(
  signal: Float32Array,
  options: BeatTrackingOptions = DEFAULT_BEAT_OPTIONS
): number {
  const rate = options.frameRateHz;
  const frames = signal.length;
  const minLag = Math.max(1, Math.floor((60 * rate) / options.maxBpm));
  const maxLag = Math.min(frames - 1, Math.ceil((60 * rate) / options.minBpm));

  let bestScore = 0;
  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    for (let i = 0, last = frames - lag; i < last; i++) {
      correlation += signal[i] * signal[i + lag];
    }
    if (correlation <= 0) continue;

    const bpm = (60 * rate) / lag;
    const octaves = Math.log2(bpm / options.priorBpm) / options.priorWidth;
    const score = correlation * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestLag < 0 ? options.priorBpm : (60 * rate) / bestLag;
}

/**
 * Where the beats fall.
 *
 * Degrades rather than throws, the way `transcription-timing.ts` does: silence,
 * a single note and a zero duration all give an even grid at `priorBpm` rather
 * than an empty or one-entry `beatsSec` that every consumer downstream would
 * have to special-case.
 */
export function trackBeats(
  notes: DetectedNote[],
  durationSec: number,
  timeSignature: TimeSignature,
  options: BeatTrackingOptions = DEFAULT_BEAT_OPTIONS
): BeatGrid {
  const rate =
    Number.isFinite(options.frameRateHz) && options.frameRateHz > 0
      ? options.frameRateHz
      : DEFAULT_BEAT_OPTIONS.frameRateHz;

  const signal = onsetSignal(notes, durationSec, rate);
  const localScore = normalise(signal);
  if (localScore === null) {
    return evenGrid(notes, durationSec, options.priorBpm, timeSignature);
  }

  const bpm = estimateTempo(signal, options);
  const chain = trackFrames(localScore, (60 * rate) / bpm, options.tightness);
  const frames = trimBeats(localScore, chain);
  if (frames.length < 2) return evenGrid(notes, durationSec, bpm, timeSignature);

  return { beatsSec: frames.map(frame => frame / rate), timeSignature };
}

/** Seconds the grid has to cover: the stated duration, or the last onset. */
function spanSec(notes: DetectedNote[], durationSec: number): number {
  let span = Number.isFinite(durationSec) ? Math.max(durationSec, 0) : 0;
  for (const note of notes) {
    if (Number.isFinite(note.onsetSec)) span = Math.max(span, note.onsetSec);
  }
  return span;
}

/**
 * Scales the signal to unit standard deviation, or null when it holds no
 * energy at all.
 *
 * The dynamic program weighs onset energy against a penalty measured in fixed
 * units, so the two are only commensurable once the signal has a known scale -
 * otherwise `tightness` would mean one thing for a quiet stem and another for
 * a loud one. Divided by the deviation without subtracting the mean, as Ellis
 * does: the signal is mostly silence, and shifting it negative would make the
 * gaps between onsets cost something.
 */
function normalise(signal: Float32Array): Float64Array | null {
  const frames = signal.length;
  let sum = 0;
  let sumOfSquares = 0;
  for (let i = 0; i < frames; i++) {
    sum += signal[i];
    sumOfSquares += signal[i] * signal[i];
  }

  const mean = sum / frames;
  const deviation = Math.sqrt(Math.max(sumOfSquares / frames - mean * mean, 0));
  if (!(deviation > 0)) return null;

  const scaled = new Float64Array(frames);
  for (let i = 0; i < frames; i++) scaled[i] = signal[i] / deviation;
  return scaled;
}

/**
 * The dynamic program itself. Returns beat frame indices, ascending.
 *
 * `score[i] = local[i] + max over j in [i - 2P, i - P/2] of
 * (score[j] - tightness * ln((i - j) / P)^2)`, then a backtrace from the
 * best-scoring frame in the final period. Frames earlier than `P/2` have no
 * legal predecessor and start a chain, so the phase of the whole grid is
 * settled by which chain ends up strongest over the entire signal rather than
 * by wherever the first onset happens to be.
 *
 * The flip side of that is that the chain it returns *always* reaches back to
 * within half a beat of frame zero and forward to within a beat of the last
 * frame, whether or not there is any music out there. `trimBeats` is what cuts
 * it back to the stretch the onsets actually support.
 */
function trackFrames(localScore: Float64Array, period: number, tightness: number): number[] {
  const frames = localScore.length;
  const minGap = Math.max(1, Math.round(period / 2));
  const maxGap = Math.max(minGap, Math.round(period * 2));

  const score = new Float64Array(frames);
  const backlink = new Int32Array(frames);

  for (let i = 0; i < frames; i++) {
    let best = -Infinity;
    let bestFrom = -1;

    const from = Math.max(0, i - maxGap);
    const to = i - minGap;
    for (let j = from; j <= to; j++) {
      const drift = Math.log((i - j) / period);
      const candidate = score[j] - tightness * drift * drift;
      if (candidate > best) {
        best = candidate;
        bestFrom = j;
      }
    }

    score[i] = bestFrom < 0 ? localScore[i] : localScore[i] + best;
    backlink[i] = bestFrom;
  }

  const tailStart = Math.max(0, frames - Math.max(1, Math.round(period)));
  let end = tailStart;
  for (let i = tailStart + 1; i < frames; i++) {
    if (score[i] > score[end]) end = i;
  }

  const beats: number[] = [];
  // backlink[cursor] is always below cursor, or -1, so this terminates.
  for (let cursor = end; cursor >= 0; cursor = backlink[cursor]) beats.push(cursor);
  return beats.reverse();
}

/**
 * Smoothing applied to the beat-strength curve before trimming: the three
 * non-zero taps of the five-point Hann window librosa uses.
 *
 * One weak beat inside a phrase should not end the run, so each beat is
 * judged with its neighbours weighed in at half.
 */
const TRIM_SMOOTHING = [0.5, 1, 0.5];

/** Fraction of the RMS beat strength a beat has to clear to be kept. */
const TRIM_THRESHOLD = 0.5;

/**
 * Drops leading and trailing beats that no onset supports.
 *
 * `trackFrames` cannot help inventing them. Only frames inside the first half
 * period can start a chain, so its first beat is structurally always less than
 * half a beat into the file - and when the music starts later than that, every
 * beat in front of it is fabricated. That matters because `deriveScore` reads
 * `beatsSec[0]` as bar 1 beat 1: music starting at 2.7 s arrives with five
 * phantom beats ahead of it, which puts the first played note on bar 2 beat 2
 * with the tempo still exactly right. The tail is the same fault pointed the
 * other way - a `durationSec` long past the last note fills the difference
 * with beats nothing plays.
 *
 * This is librosa's `__trim_beats`: sample the local score at the beat frames,
 * smooth it, and keep the run from the first to the last beat clearing half
 * the RMS of that curve. One deliberate deviation - librosa's slice stops
 * *before* the last beat it just called valid, throwing away a real beat;
 * this keeps it.
 *
 * Returns an empty array when nothing clears the threshold, which is the
 * caller's cue to fall back to an even grid.
 */
function trimBeats(localScore: Float64Array, beats: number[]): number[] {
  if (beats.length === 0) return beats;

  const strength = beats.map((_, i) => {
    let sum = 0;
    for (let tap = 0; tap < TRIM_SMOOTHING.length; tap++) {
      const neighbour = beats[i + tap - 1];
      if (neighbour === undefined) continue;
      sum += TRIM_SMOOTHING[tap] * localScore[neighbour];
    }
    return sum;
  });

  const meanSquare = strength.reduce((sum, value) => sum + value * value, 0) / strength.length;
  const threshold = TRIM_THRESHOLD * Math.sqrt(meanSquare);

  const first = strength.findIndex(value => value > threshold);
  if (first < 0) return [];

  let last = strength.length - 1;
  while (strength[last] <= threshold) last--;

  return beats.slice(first, last + 1);
}

/** Evenly spaced beats at `bpm`, covering the same span. Always two or more. */
function evenGrid(
  notes: DetectedNote[],
  durationSec: number,
  bpm: number,
  timeSignature: TimeSignature
): BeatGrid {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : DEFAULT_BEAT_OPTIONS.priorBpm;
  const periodSec = 60 / safeBpm;
  const count = Math.max(2, Math.floor(spanSec(notes, durationSec) / periodSec) + 1);

  const beatsSec: number[] = [];
  for (let i = 0; i < count; i++) beatsSec.push(i * periodSec);
  return { beatsSec, timeSignature };
}
