import { BeatGrid } from '../models/transcription.model';

/**
 * Position of `sec` on the beat grid, measured in beats.
 *
 * The result is fractional and unbounded. Times before the first beat come
 * back negative and times past the last extrapolate from the final interval,
 * so callers never have to special-case a note that strays outside the
 * tracked region - a pickup before the first downbeat, or a ring-out after
 * the last.
 */
export function secondsToBeats(sec: number, grid: BeatGrid): number {
  const beats = grid.beatsSec;
  if (beats.length < 2) return 0;

  const last = beats.length - 1;

  if (sec <= beats[0]) {
    const interval = beats[1] - beats[0];
    return interval > 0 ? (sec - beats[0]) / interval : 0;
  }

  if (sec >= beats[last]) {
    const interval = beats[last] - beats[last - 1];
    return interval > 0 ? last + (sec - beats[last]) / interval : last;
  }

  // Binary search for the pair of beats bracketing `sec`.
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (beats[mid] <= sec) low = mid;
    else high = mid;
  }

  const span = beats[low + 1] - beats[low];
  return span > 0 ? low + (sec - beats[low]) / span : low;
}

/**
 * Tempo in BPM of the denominator unit.
 *
 * Median rather than mean, so one dropped or doubled beat in the tracked grid
 * does not drag the whole tempo with it.
 */
export function gridTempo(grid: BeatGrid): number {
  const beats = grid.beatsSec;
  if (beats.length < 2) return 120;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }
  intervals.sort((a, b) => a - b);

  const median = intervals[intervals.length >> 1];
  return median > 0 ? Math.round(60 / median) : 120;
}
