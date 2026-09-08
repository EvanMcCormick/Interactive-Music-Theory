import {
  ChordExtent,
  ChordQuality,
  chordName,
  degreeQuality,
  degreePitchClasses,
  isHeptatonic,
  noteCount,
  romanNumeral
} from './progression-harmony';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
const NEAPOLITAN_MINOR = [0, 1, 3, 5, 7, 8, 11];

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

  // The module claims an unusual scale yields its augmented III without anyone
  // enumerating it, and harmonic minor is the case it names. Raising the
  // seventh to 11 turns III into an augmented triad (G# above the C-E of a C
  // chord in A harmonic minor) and V into a major one, which is the whole
  // point of the scale.
  it('gives harmonic minor i ii-dim III-aug iv V VI vii-dim', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(HARMONIC_MINOR, d, 3));
    expect(qualities).toEqual([
      'minor', 'diminished', 'augmented', 'minor', 'major', 'major', 'diminished'
    ] as ChordQuality[]);
  });

  it('finds the dominant seventh on degree 5 of a major scale', () => {
    expect(degreeQuality(MAJOR, 4, 7)).toBe('dominant7');
  });

  it('finds the major seventh on degree 1 of a major scale', () => {
    expect(degreeQuality(MAJOR, 0, 7)).toBe('major7');
  });

  // The tonic seventh of both minor scales that raise the leading tone: a
  // minor triad carrying a major seventh, [0, 3, 7, 11].
  it('finds the minor-major seventh on the tonic of harmonic and melodic minor', () => {
    expect(degreePitchClasses(HARMONIC_MINOR, 0, 7)).toEqual([0, 3, 7, 11]);
    expect(degreeQuality(HARMONIC_MINOR, 0, 7)).toBe('minorMajor7');
    expect(degreeQuality(MELODIC_MINOR, 0, 7)).toBe('minorMajor7');
  });

  // The seventh over harmonic minor's augmented III: [0, 4, 8, 11] above its
  // own root, which is the III+ triad with the tonic a major seventh above it.
  it('finds the augmented major seventh on degree 3 of harmonic minor', () => {
    expect(degreePitchClasses(HARMONIC_MINOR, 2, 7)).toEqual([3, 7, 11, 14]);
    expect(degreeQuality(HARMONIC_MINOR, 2, 7)).toBe('augmentedMajor7');
  });

  // [0, 4, 8, 10] - a dominant seventh with a raised fifth. Nothing in the
  // common scales produces one; the Neapolitans do, on their third degree.
  it('finds the augmented seventh on degree 3 of Neapolitan minor', () => {
    expect(degreePitchClasses(NEAPOLITAN_MINOR, 2, 7)).toEqual([3, 7, 11, 13]);
    expect(degreeQuality(NEAPOLITAN_MINOR, 2, 7)).toBe('augmented7');
  });

  it('rejects a degree outside the scale', () => {
    expect(() => degreeQuality(MAJOR, -1, 3)).toThrowError(/degree/i);
    expect(() => degreeQuality(MAJOR, 7, 3)).toThrowError(/degree/i);
  });
});

describe('noteCount', () => {
  // Named directly rather than only through degreePitchClasses, because this
  // is where the extent-to-note-count arithmetic actually lives: every extent
  // above the triad names its topmost interval, so it has (n + 1) / 2 notes,
  // while 3 already is a note count.
  it('counts one note per third in the stack', () => {
    expect(noteCount(3)).toBe(3);
    expect(noteCount(7)).toBe(4);
    expect(noteCount(9)).toBe(5);
    expect(noteCount(11)).toBe(6);
    expect(noteCount(13)).toBe(7);
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

  // The tall extents, where a wrong note count would go unnoticed in the
  // shorter chords. Both figures are the `major11` and `major13` interval
  // arrays from `music-theory.service.ts`, which is what they are checked
  // against: an independently written table of the same chords.
  it('reaches the eleventh and the thirteenth', () => {
    expect(degreePitchClasses(MAJOR, 0, 11)).toEqual([0, 4, 7, 11, 14, 17]);
    expect(degreePitchClasses(MAJOR, 0, 13)).toEqual([0, 4, 7, 11, 14, 17, 21]);
  });

  it('refuses a scale that is not seven notes', () => {
    expect(() => degreePitchClasses([0, 2, 4, 7, 9], 0, 3)).toThrowError(/heptatonic/);
    // Eight notes is refused as flatly as five. The rule is that a third has
    // to be two scale steps, not that the scale has to be big enough.
    expect(() => degreePitchClasses([0, 2, 3, 5, 6, 8, 9, 11], 0, 3))
      .toThrowError(/heptatonic/);
  });

  // Without this an out-of-range index reads `undefined` from the interval
  // array and the arithmetic quietly yields NaN, which `degreeQuality` then
  // reports as 'other' - a wrong answer dressed as a real one.
  it('refuses a degree that is not one of the seven', () => {
    expect(() => degreePitchClasses(MAJOR, -1, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, 7, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, 1.5, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, NaN, 3)).toThrowError(/degree/i);
  });

  it('accepts every degree of the scale', () => {
    for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
      expect(() => degreePitchClasses(MAJOR, degree, 3)).not.toThrow();
    }
  });
});

describe('isHeptatonic', () => {
  // Exported so the palette can ask before calling rather than catching a
  // throw, and so the length rule lives in exactly one place.
  it('is true for seven notes and false for anything else', () => {
    expect(isHeptatonic(MAJOR)).toBe(true);
    expect(isHeptatonic(HARMONIC_MINOR)).toBe(true);
    expect(isHeptatonic([0, 2, 4, 7, 9])).toBe(false);
    expect(isHeptatonic([0, 2, 3, 5, 6, 8, 9, 11])).toBe(false);
    expect(isHeptatonic([])).toBe(false);
  });
});

describe('romanNumeral', () => {
  /** The numeral for each degree of `scale`, as the palette would print them. */
  function figures(scale: readonly number[], extent: ChordExtent = 3): string[] {
    return [0, 1, 2, 3, 4, 5, 6].map(d => romanNumeral(d, degreeQuality(scale, d, extent)));
  }

  // The first of the two tables this module is checked against, and the one
  // every theory text prints on its first page of harmony.
  it('gives the major scale I ii iii IV V vi vii-dim', () => {
    expect(figures(MAJOR)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  });

  // The second table: the Captain Chords figures for A minor, which is the
  // check that the case rule is carrying the quality rather than the mode.
  it('gives the natural minor scale i ii-dim III iv v VI VII', () => {
    expect(figures(NATURAL_MINOR)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
  });

  // Case is a claim about the third, so the augmented triad is upper case with
  // a plus rather than lower case: III+ in harmonic minor is a major third
  // with a sharpened fifth, not a minor chord.
  it('marks the augmented triad with a plus and keeps it upper case', () => {
    expect(romanNumeral(2, 'augmented')).toBe('III+');
  });

  // The seventh figures, each against the shape it is conventionally written
  // as: Imaj7, V7, ii7, viiø7, vii°7.
  it('writes the seventh chords with their usual figures', () => {
    expect(romanNumeral(0, 'major7')).toBe('Imaj7');
    expect(romanNumeral(4, 'dominant7')).toBe('V7');
    expect(romanNumeral(1, 'minor7')).toBe('ii7');
    expect(romanNumeral(0, 'minorMajor7')).toBe('imaj7');
    expect(romanNumeral(6, 'halfDiminished7')).toBe('viiø7');
    expect(romanNumeral(6, 'diminished7')).toBe('vii°7');
    expect(romanNumeral(2, 'augmented7')).toBe('III+7');
    expect(romanNumeral(2, 'augmentedMajor7')).toBe('III+maj7');
  });

  /**
   * The documented consequence of taking a quality rather than an extent.
   *
   * `degreeQuality` names a ninth after its seventh, so a V9 arrives here as
   * `dominant7` and is printed `V7`. The figure is therefore the *quality's*
   * figure, not the stack's height: raising a slot with the + complexity
   * button changes what it sounds without changing what it is called. That is
   * the same convention the model already keeps - `ChordDegree.quality` holds
   * `dominant7` for a ninth too - rather than a second, contradictory one.
   */
  it('prints an extended chord with its seventh figure', () => {
    for (const extent of [9, 11, 13] as ChordExtent[]) {
      expect(romanNumeral(4, degreeQuality(MAJOR, 4, extent))).toBe('V7');
    }
  });

  /**
   * A stack of thirds with no name gets its degree and withdraws the claim.
   *
   * Reachable from scales the app already offers: degree 6 of the double
   * harmonic scale stacks a second and a diminished fifth, which is no chord
   * anyone has a name for. Upper case would assert a major third it does not
   * have and lower case a minor one, so the `?` says the case means nothing
   * here rather than letting it lie.
   */
  it('marks a stack that is not a named chord', () => {
    expect(romanNumeral(6, 'other')).toBe('VII?');
  });

  // The same domain `degreePitchClasses` enforces, and for the same reason: a
  // degree off the end of the table would otherwise read `undefined` and print
  // the string "undefined" into a button.
  it('refuses a degree that is not one of the seven', () => {
    expect(() => romanNumeral(-1, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(7, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(1.5, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(NaN, 'major')).toThrowError(/degree/i);
  });
});

describe('chordName', () => {
  // The concrete names beside the numerals, in the reference UI's spelling.
  it('names the triads', () => {
    expect(chordName('C', 'major')).toBe('C Maj');
    expect(chordName('A', 'minor')).toBe('A min');
    expect(chordName('B', 'diminished')).toBe('B°');
    expect(chordName('C', 'augmented')).toBe('C+');
  });

  /**
   * The separator is a rule rather than a second column: a suffix that starts
   * with a letter is a word and takes a space, and one that starts with a
   * symbol or a digit is a figure and does not. That gives `C Maj7` and `G7`,
   * which is how both are written.
   */
  it('spaces a worded suffix and closes up a figured one', () => {
    expect(chordName('C', 'major7')).toBe('C Maj7');
    expect(chordName('A', 'minor7')).toBe('A min7');
    expect(chordName('A', 'minorMajor7')).toBe('A minMaj7');
    expect(chordName('G', 'dominant7')).toBe('G7');
    expect(chordName('B', 'halfDiminished7')).toBe('Bø7');
    expect(chordName('B', 'diminished7')).toBe('B°7');
    expect(chordName('C', 'augmented7')).toBe('C+7');
    expect(chordName('C', 'augmentedMajor7')).toBe('C+Maj7');
  });

  it('marks a stack that is not a named chord', () => {
    expect(chordName('B', 'other')).toBe('B?');
  });
});
