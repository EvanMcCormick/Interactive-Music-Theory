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
 */

/**
 * Respaces a grid to a new tempo, anchored on its first beat.
 *
 * The first beat is the one the user has already positioned with the nudge
 * controls, so a tempo change must not move it.
 */
export function withTempo(grid: BeatGrid, bpm: number): BeatGrid {
  if (!Number.isFinite(bpm) || bpm <= 0) return grid;

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
 */
export function nudgedDownbeat(grid: BeatGrid, beats: number): BeatGrid {
  const source = grid.beatsSec;
  if (source.length < 2 || !Number.isInteger(beats) || beats === 0) return grid;

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
