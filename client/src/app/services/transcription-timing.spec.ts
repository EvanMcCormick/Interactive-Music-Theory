import { BeatGrid } from '../models/transcription.model';
import { gridTempo, secondsToBeats } from './transcription-timing';

/** Four beats at 120 BPM, so every beat is half a second. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0],
  downbeatIndices: [0, 4],
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

/** The same grid with beat 3 held long: intervals 0.5, 0.5, 2.0, 0.5. */
const WOBBLY: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 3.0, 3.5] };

/** Slows at the end: intervals 0.5, 0.5, 0.5, 2.0. Median 0.5. */
const RITARDANDO: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 1.5, 3.5] };

/** Starts slow: intervals 2.0, 0.5, 0.5. Median 0.5. */
const ACCELERANDO: BeatGrid = {
  ...GRID,
  beatsSec: [0, 2.0, 2.5, 3.0],
  downbeatIndices: [0]
};

describe('secondsToBeats', () => {
  it('maps a beat time onto its beat index', () => {
    expect(secondsToBeats(1.0, GRID)).toBe(2);
  });

  it('interpolates between two beats', () => {
    expect(secondsToBeats(1.25, GRID)).toBe(2.5);
  });

  /**
   * GRID is perfectly uniform, so every other test here also passes for an
   * implementation that ignores where the beats actually fall and just divides
   * by one average interval - which would defeat the point of tracking beats
   * individually. Only an uneven grid exercises the bracketing search.
   */
  it('interpolates within the beat it actually lands in on an uneven grid', () => {
    // 2.0s is halfway through the long beat spanning 1.0s-3.0s.
    expect(secondsToBeats(2.0, WOBBLY)).toBe(2.5);
    expect(secondsToBeats(3.0, WOBBLY)).toBe(3);
  });

  it('extrapolates before the first beat as a negative position', () => {
    expect(secondsToBeats(-0.25, GRID)).toBe(-0.5);
  });

  it('extrapolates past the last beat using the final interval', () => {
    expect(secondsToBeats(2.5, GRID)).toBe(5);
  });

  /**
   * Both extrapolation branches read the same interval on a uniform grid, so
   * GRID cannot tell them apart: swapping one branch to use the other end's
   * interval leaves every assertion above passing. These two fixtures have
   * deliberately unequal first and final intervals, so each branch is pinned
   * to its own end of the grid - and to the clamp that bounds it.
   */
  it('extrapolates past the end by the final interval, clamped to the median', () => {
    // Final interval 2.0 is clamped to twice the 0.5 median, so 1.0s past the
    // last beat at 3.5s is one further beat, not half of one.
    expect(secondsToBeats(4.5, RITARDANDO)).toBe(5);
  });

  it('extrapolates before the start by the first interval, clamped to the median', () => {
    // First interval 2.0 is clamped to 1.0 the same way, so 1.0s before the
    // first beat is one beat early.
    expect(secondsToBeats(-1.0, ACCELERANDO)).toBe(-1);
  });

  it('leaves each edge reading its own end of the grid', () => {
    // The unclamped ends: RITARDANDO starts at the 0.5 median and ACCELERANDO
    // finishes there, so a branch reaching for the wrong end would show up.
    expect(secondsToBeats(-0.25, RITARDANDO)).toBe(-0.5);
    expect(secondsToBeats(4.0, ACCELERANDO)).toBe(5);
  });

  it('survives a grid too short to interpolate', () => {
    const single: BeatGrid = { ...GRID, beatsSec: [0.4], downbeatIndices: [0] };
    expect(secondsToBeats(9, single)).toBe(0);
  });
});

describe('gridTempo', () => {
  it('reads 120 BPM off a half-second grid', () => {
    expect(gridTempo(GRID)).toBe(120);
  });

  it('ignores a single outlier interval', () => {
    expect(gridTempo(WOBBLY)).toBe(120);
  });

  /**
   * An even number of intervals has no single middle value. Taking the upper
   * one instead of averaging the two reports the slower half of the grid as
   * the tempo of the whole.
   */
  it('averages the two middle intervals when the count is even', () => {
    const even: BeatGrid = { ...GRID, beatsSec: [0, 0.4, 0.8, 1.4, 2.0] };
    expect(gridTempo(even)).toBe(120);
  });
});
