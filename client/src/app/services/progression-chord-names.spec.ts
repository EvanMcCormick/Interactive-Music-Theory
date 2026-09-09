import {
  ChordExtent,
  ChordQuality,
  degreeQuality
} from './progression-harmony';
import { chordName, romanNumeral, spokenChordName } from './progression-chord-names';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

/**
 * The three ways this app writes a chord, checked against the conventions they
 * answer to rather than against the arithmetic that produced the quality.
 *
 * `progression-harmony.spec.ts` is next door and checks that a C major scale
 * gives I ii iii IV V vi vii-dim; this file checks that a diminished triad is
 * written `vii°` and not `viio`, printed `B°` and not `B dim`, and *said*
 * "B diminished" rather than "B degree sign". Those are different claims with
 * different sources, which is why the split runs between them.
 *
 * `degreeQuality` is still used here, in the two figure tables that walk a whole
 * scale: the teaching claim is about a row of numerals rather than about any one
 * of them, and hand-listing the qualities to feed them would test this file
 * against a copy of the other one's answer.
 */

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
    expect(romanNumeral(0, 'minorMajor7')).toBe('i(maj7)');
    expect(romanNumeral(6, 'halfDiminished7')).toBe('viiø7');
    expect(romanNumeral(6, 'diminished7')).toBe('vii°7');
    expect(romanNumeral(2, 'augmented7')).toBe('III+7');
    expect(romanNumeral(2, 'augmentedMajor7')).toBe('III+maj7');
  });

  /**
   * Why the minor-major seventh is parenthesised, pinned as the property
   * rather than as a string.
   *
   * `Imaj7` and `imaj7` differ by the case of one leading letter, and both are
   * reachable: the first is ionian's tonic seventh, the second harmonic and
   * melodic minor's. A reader who has to compare letter case in a font they did
   * not choose has been given a distinction they cannot rely on, which is why
   * the convention brackets the minor-major.
   */
  it('does not distinguish two seventh figures by letter case alone', () => {
    const major = romanNumeral(0, 'major7');
    const minorMajor = romanNumeral(0, 'minorMajor7');

    expect(minorMajor).not.toBe(major);
    expect(minorMajor.toLowerCase()).not.toBe(major.toLowerCase());
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

/**
 * The third table: the same chords as something a screen reader can say.
 *
 * `chordName` prints symbols, and symbols are not read - `B°` is announced as
 * "B degree sign" and `Eb` as "E b". A button whose only label is that is a
 * button a listener cannot identify, so the spoken form is written rather than
 * assembled from the printed one.
 */
describe('spokenChordName', () => {
  it('says the suffix instead of printing it', () => {
    expect(spokenChordName('B', 'diminished')).toBe('B diminished');
    expect(spokenChordName('C', 'augmented')).toBe('C augmented');
    expect(spokenChordName('B', 'halfDiminished7')).toBe('B half diminished seventh');
    expect(spokenChordName('G', 'dominant7')).toBe('G dominant seventh');
  });

  it('says the accidental instead of spelling it', () => {
    expect(spokenChordName('Eb', 'major')).toBe('E flat major');
    expect(spokenChordName('A#', 'minor')).toBe('A sharp minor');
    expect(spokenChordName('C', 'major')).toBe('C major');
  });

  /** The chord is real; only its name is missing, and the label says so. */
  it('still identifies a stack that is not a named chord', () => {
    expect(spokenChordName('B', 'other')).toBe('B unnamed chord');
  });

  /**
   * Nothing here may come back as punctuation or as `undefined`. The table is
   * keyed exhaustively on `ChordQuality`, so this is a check that every entry
   * is a phrase rather than a copy of the printed figure.
   */
  it('gives every quality words rather than symbols', () => {
    const qualities: ChordQuality[] = [
      'major', 'minor', 'diminished', 'augmented',
      'major7', 'minor7', 'dominant7', 'minorMajor7',
      'halfDiminished7', 'diminished7', 'augmented7', 'augmentedMajor7',
      'other'
    ];

    for (const quality of qualities) {
      const spoken = spokenChordName('C', quality);
      expect(spoken)
        .withContext(`${quality} is not spoken as words`)
        .toMatch(/^C [a-z ]+$/);
    }
  });
});

