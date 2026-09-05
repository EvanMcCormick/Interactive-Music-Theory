import { BeatGrid } from '../models/transcription.model';

/**
 * Converts between audio time and beat-grid position.
 *
 * This is the boundary between the audio world, where everything is absolute
 * seconds into the source, and the notation world, where everything is beats.
 * A `BeatGrid` is a list of measured beat times rather than a single tempo, so
 * conversion is a lookup between neighbouring beats and not a division - which
 * is what lets a score follow a performance that breathes.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the arithmetic can be checked directly
 * against hand-written grids.
 */

/** Ascending gaps between consecutive beats. */
function beatIntervals(beats: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  return intervals;
}

/** Median gap. Resists a single dropped or doubled beat. */
function medianInterval(beats: number[]): number {
  const sorted = beatIntervals(beats).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  // Even counts average the two middle values rather than taking the upper.
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Interval to extrapolate an edge by.
 *
 * The local interval, so a real ritardando reads correctly, but clamped
 * against the median so a single mistracked edge beat cannot throw a note
 * into the wrong bar.
 */
function edgeInterval(local: number, median: number): number {
  if (median <= 0) return local;
  return Math.min(median * 2, Math.max(median / 2, local));
}

/**
 * Position of `sec` on the beat grid, measured in beats since its first beat.
 *
 * Beat 0 of the result is `beatsSec[0]`, which derivation writes as bar 1 beat
 * 1, so callers can divide by the numerator to find the bar. That is a
 * convention rather than a measurement: M2's tracker finds the pulse and not
 * its phase, so whether the first tracked beat is a downbeat is not
 * established. See `BeatGrid`.
 *
 * The result is fractional and unbounded. Times before the first beat come
 * back negative and times past the last extrapolate onwards, so callers never
 * have to special-case a note that strays outside the tracked region - a
 * pickup before the first downbeat, or a ring-out after the last. Both edges
 * extrapolate by the local interval clamped to between half and twice the
 * median, so a genuine tempo change is honoured while a single mistracked edge
 * beat is bounded.
 */
export function secondsToBeats(sec: number, grid: BeatGrid): number {
  const beats = grid.beatsSec;
  if (beats.length < 2) return 0;

  const last = beats.length - 1;

  if (sec <= beats[0]) {
    const interval = edgeInterval(beats[1] - beats[0], medianInterval(beats));
    return interval > 0 ? (sec - beats[0]) / interval : 0;
  }

  if (sec >= beats[last]) {
    const interval = edgeInterval(beats[last] - beats[last - 1], medianInterval(beats));
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

  const median = medianInterval(beats);
  return median > 0 ? Math.round(60 / median) : 120;
}
