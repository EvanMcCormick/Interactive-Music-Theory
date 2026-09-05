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

  it('survives a grid too short to interpolate', () => {
    const single: BeatGrid = { ...GRID, beatsSec: [0.4] };
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
});
