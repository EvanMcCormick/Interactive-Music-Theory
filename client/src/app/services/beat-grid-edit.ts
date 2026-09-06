import { BeatGrid } from '../models/transcription.model';

/**
 * Corrections a listener makes to a tracked beat grid.
 *
 * Beat tracking gets tempo right far more often than it gets phase right: the
 * grid's first beat is whichever tracked pulse the onsets first support, and
 * nothing about it makes it a downbeat. So a transcription can be perfectly in
 * time and still have every bar line a beat out of place, which no amount of
 * tuning the tracker fixes and which a listener spots instantly.
 *
 * Both functions return a new grid, so the caller can re-derive and compare.
 *
 * ## Both corrections are bounded here, not in the UI
 *
 * These are public service methods reached through `updateTempo` and
 * `nudgeDownbeat`, and a `min`/`max` on a number input is not their contract -
 * it is one caller's decoration. The bound has to live where the validation
 * already does, because what is on the other side of it is not a wrong answer
 * but a hang: bar count scales linearly with tempo, and a nudge builds an array
 * per beat it prepends. `updateTempo(9999)` on a five-minute file asks for some
 * 12,500 bars, each a `MasterBarDoc`, a `quantizeBar` call and a full bar of
 * rests, and then an alphaTab render that does not return.
 * `nudgeDownbeat(-1e9)` goes straight to `Array.from({ length: 1e9 })`. This is
 * the hazard `barsInSource` closes from the note side, reopened from the grid
 * side.
 *
 * Out-of-range values are refused rather than clamped, matching how both
 * functions already treat input they cannot use: the grid comes back untouched,
 * so a caller can compare by identity and a UI can say the correction was not
 * applied instead of silently applying a different one.
 */

/**
 * Slowest tempo a listener can state.
 *
 * Below Larghissimo, and slow enough that a beat is no longer felt as a pulse.
 * The tracker's own band starts at 50 BPM; this is well under it, because a
 * correction exists precisely for the cases the tracker got wrong.
 */
export const MIN_TEMPO_BPM = 20;

/**
 * Fastest tempo a listener can state.
 *
 * Twice Prestissimo, and comfortably past the tracker's 210 BPM ceiling, so a
 * listener who hears the tracked pulse as half-time can double it and still be
 * inside the range. At 400 BPM a five-minute source is 2,000 beats - 500 bars
 * of 4/4, a long score but a writable one.
 */
export const MAX_TEMPO_BPM = 400;

/**
 * Furthest the downbeat can be moved, in either direction.
 *
 * Two bars of 4/4. The correction answers "which pulse is beat 1", and that
 * question is settled inside one bar - a nudge of a whole bar is already the
 * same answer again. Anything past two bars is not a phase correction, it is a
 * trim, and this is not the control for it.
 */
export const MAX_DOWNBEAT_NUDGE_BEATS = 8;

/**
 * Respaces a grid to a new tempo, anchored on its first beat.
 *
 * The first beat is the one the user has already positioned with the nudge
 * controls, so a tempo change must not move it.
 *
 * A tempo outside `MIN_TEMPO_BPM`..`MAX_TEMPO_BPM` leaves the grid alone; see
 * the module docblock for why the bound is here rather than on an input.
 */
export function withTempo(grid: BeatGrid, bpm: number): BeatGrid {
  // Written as a range test rather than as `> 0` plus a ceiling, so NaN - which
  // compares false against everything - is refused by the same expression.
  if (!(bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM)) return grid;

  const beats = grid.beatsSec;
  if (beats.length < 2) return grid;

  const start = beats[0];
  const span = beats[beats.length - 1] - start;
  const interval = 60 / bpm;
  const count = Math.max(2, Math.round(span / interval) + 1);

  return {
    ...grid,
    beatsSec: Array.from({ length: count }, (_, i) => start + i * interval)
  };
}

/**
 * Moves which tracked beat counts as bar 1, beat 1.
 *
 * Positive nudges drop beats off the front, so the bar starts later. Negative
 * ones extend backwards using the leading interval, which can place the first
 * beat before zero — that is correct, and means the piece begins mid-bar.
 * `secondsToBeats` extrapolates before the grid by design.
 *
 * Bounded at `MAX_DOWNBEAT_NUDGE_BEATS` in *both* directions. The forward
 * direction was already limited by the beats there are to drop; the backward
 * one had no limit at all, and every beat it prepends is an array element it
 * builds first.
 *
 * ## What a round trip costs, on a grid that is not evenly spaced
 *
 * The *leading* interval, not the median, because it is the one the prepended
 * beat is adjacent to: a real tracked grid drifts, and rebuilding the head from
 * an average of the whole piece would be a worse answer than rebuilding it from
 * its neighbour. On a tracked fixture the intervals run
 * [0.49, 0.49, 0.51, 0.5, 0.5, 0.49, 0.51], so the two differ.
 *
 * That makes the two round trips asymmetric, and it is worth writing down so
 * the next reader does not have to derive it again:
 *
 * - **`-1` then `+1` is exact.** The beat that was prepended is the beat that
 *   is dropped, and nothing else was touched.
 * - **`+1` then `-1` is not.** The forward nudge discards `b0` for good, and
 *   the backward one writes `2·b1 - b2` in its place. The error is
 *   `(b1 - b0) - (b2 - b1)` - the difference between two adjacent intervals,
 *   so strictly less than one interval - and it lands entirely on the first
 *   beat, since nothing from `b1` on is rewritten.
 * - **It does not accumulate.** The second cycle rebuilds `2·b1 - b2` from the
 *   same `b1` and `b2`, so it reproduces the first cycle's answer exactly. The
 *   drift is one interval's worth once, not once per press.
 *
 * A note struck after `b1` is therefore placed identically across a round trip.
 * One struck inside the rebuilt interval moves by up to that error, which on a
 * sixteenth grid is at most a slot.
 */
export function nudgedDownbeat(grid: BeatGrid, beats: number): BeatGrid {
  const source = grid.beatsSec;
  if (source.length < 2 || !Number.isInteger(beats) || beats === 0) return grid;
  if (Math.abs(beats) > MAX_DOWNBEAT_NUDGE_BEATS) return grid;

  if (beats > 0) {
    const drop = Math.min(beats, source.length - 2);
    return { ...grid, beatsSec: source.slice(drop) };
  }

  const interval = source[1] - source[0];
  const added = Array.from(
    { length: -beats },
    (_, i) => source[0] - (i + 1) * interval
  ).reverse();

  return { ...grid, beatsSec: [...added, ...source] };
}
