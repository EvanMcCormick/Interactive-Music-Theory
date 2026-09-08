import { ChordQuality, degreeQuality, degreePitchClasses } from './progression-harmony';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('degreeQuality', () => {
  // The seven triads of a major scale, checked against the figures every
  // theory text prints: I ii iii IV V vi vii-dim.
  it('gives the major scale I ii iii IV V vi vii-dim', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(MAJOR, d, 3));
    expect(qualities).toEqual([
      'major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'
    ] as ChordQuality[]);
  });

  // The Captain Chords screenshot for A minor shows i ii-dim III iv v VI VII.
  it('gives the natural minor scale i ii-dim III iv v VI VII', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(NATURAL_MINOR, d, 3));
    expect(qualities).toEqual([
      'minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'
    ] as ChordQuality[]);
  });

  it('finds the dominant seventh on degree 5 of a major scale', () => {
    expect(degreeQuality(MAJOR, 4, 7)).toBe('dominant7');
  });

  it('finds the major seventh on degree 1 of a major scale', () => {
    expect(degreeQuality(MAJOR, 0, 7)).toBe('major7');
  });
});

describe('degreePitchClasses', () => {
  // Relative to the tonic, so a C major I is 0,4,7 and an A minor I is too -
  // the tonic offset is applied by the caller.
  it('stacks thirds within the scale', () => {
    expect(degreePitchClasses(MAJOR, 0, 3)).toEqual([0, 4, 7]);
    expect(degreePitchClasses(MAJOR, 1, 3)).toEqual([2, 5, 9]);
    expect(degreePitchClasses(MAJOR, 6, 3)).toEqual([11, 14, 17]);
  });

  it('keeps stacking for sevenths and ninths', () => {
    expect(degreePitchClasses(MAJOR, 4, 7)).toEqual([7, 11, 14, 17]);
    expect(degreePitchClasses(MAJOR, 0, 9)).toEqual([0, 4, 7, 11, 14]);
  });

  it('refuses a scale that is not seven notes', () => {
    expect(() => degreePitchClasses([0, 2, 4, 7, 9], 0, 3)).toThrowError(/heptatonic/);
  });
});
