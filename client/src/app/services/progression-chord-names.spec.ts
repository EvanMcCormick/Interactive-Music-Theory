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
    return [0, 1, 2, 3, 4, 5, 6].map(d => romanNumeral(d, 0, degreeQuality(scale, d, extent)));
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
    expect(romanNumeral(2, 0, 'augmented')).toBe('III+');
  });

  // The seventh figures, each against the shape it is conventionally written
  // as: Imaj7, V7, ii7, viiø7, vii°7.
  it('writes the seventh chords with their usual figures', () => {
    expect(romanNumeral(0, 0, 'major7')).toBe('Imaj7');
    expect(romanNumeral(4, 0, 'dominant7')).toBe('V7');
    expect(romanNumeral(1, 0, 'minor7')).toBe('ii7');
    expect(romanNumeral(0, 0, 'minorMajor7')).toBe('i(maj7)');
    expect(romanNumeral(6, 0, 'halfDiminished7')).toBe('viiø7');
    expect(romanNumeral(6, 0, 'diminished7')).toBe('vii°7');
    expect(romanNumeral(2, 0, 'augmented7')).toBe('III+7');
    expect(romanNumeral(2, 0, 'augmentedMajor7')).toBe('III+maj7');
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
    const major = romanNumeral(0, 0, 'major7');
    const minorMajor = romanNumeral(0, 0, 'minorMajor7');

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
      expect(romanNumeral(4, 0, degreeQuality(MAJOR, 4, extent))).toBe('V7');
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
    expect(romanNumeral(6, 0, 'other')).toBe('VII?');
  });

  // The same domain `degreePitchClasses` enforces, and for the same reason: a
  // degree off the end of the table would otherwise read `undefined` and print
  // the string "undefined" into a button.
  it('refuses a degree that is not one of the seven', () => {
    expect(() => romanNumeral(-1, 0, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(7, 0, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(1.5, 0, 'major')).toThrowError(/degree/i);
    expect(() => romanNumeral(NaN, 0, 'major')).toThrowError(/degree/i);
  });

  /**
   * The accidental, which is the half of a borrowed chord's numeral the case
   * cannot carry.
   *
   * These are the four rows of the design doc's correction table that M1 could
   * not print at all. The accidental displaces the *root* and the case still
   * carries the third, which is exactly why `♭VII` is upper case: B flat major,
   * not the B diminished a whole-stack transposition produced.
   */
  it('writes a lowered root with a flat and keeps the case for the third', () => {
    expect(romanNumeral(6, -1, 'major')).toBe('♭VII');
    expect(romanNumeral(5, -1, 'major')).toBe('♭VI');
    expect(romanNumeral(2, -1, 'major')).toBe('♭III');
    expect(romanNumeral(1, -1, 'major')).toBe('♭II');
  });

  // The fifth row of that table, and the one that goes the other way: a raised
  // root takes a sharp, and the figure still follows the shape.
  it('writes a raised root with a sharp', () => {
    expect(romanNumeral(3, 1, 'diminished')).toBe('♯iv°');
    expect(romanNumeral(4, 2, 'major')).toBe('♯♯V');
  });

  // A double flat is two glyphs rather than a different sign, which is what
  // `ALTER_MIN` of -2 makes reachable.
  it('repeats the glyph for a double accidental', () => {
    expect(romanNumeral(1, -2, 'major')).toBe('♭♭II');
  });

  // An unaltered degree prints no accidental at all - the M1 numeral, unchanged
  // by widening the signature.
  it('prints nothing for an unaltered root', () => {
    expect(romanNumeral(3, 0, 'minor')).toBe('iv');
  });

  // Wrong kind throws, on the same rule as the degree beside it: a fractional
  // accidental would render as an empty string through `repeat`, which is a
  // silently missing flat rather than a failure.
  it('refuses an accidental that is not a whole number of semitones', () => {
    expect(() => romanNumeral(6, -0.5, 'major')).toThrowError(/accidental/i);
    expect(() => romanNumeral(6, NaN, 'major')).toThrowError(/accidental/i);
  });

  /**
   * The slash, which names a chord's function in a key it is not in.
   *
   * `V/vi` is the dominant *of the sixth degree*, so the numeral on the left is
   * measured against the target and not against the home key - which is why the
   * degree argument reads 4 for all five secondary dominants a major key has.
   */
  it('names a chord after the degree it tonicises', () => {
    expect(romanNumeral(4, 0, 'dominant7', { degree: 5, quality: 'minor' })).toBe('V/vi');
    expect(romanNumeral(4, 0, 'dominant7', { degree: 4, quality: 'major' })).toBe('V/V');
    expect(romanNumeral(4, 0, 'dominant7', { degree: 3, quality: 'major' })).toBe('V/IV');
  });

  /**
   * The figure is dropped on the left of a slash, and kept on the right.
   *
   * `V/vi` rather than `V7/vi` is how the design doc writes all three of its
   * examples, and the group these appear under is called "secondary dominants",
   * so a `7` on every member would distinguish none of them. The target keeps
   * its own figure, because that one is telling the reader which chord is being
   * tonicised.
   */
  it('drops the dominant seventh figure and keeps the target one', () => {
    expect(romanNumeral(4, 0, 'dominant7', { degree: 5, quality: 'minor' })).not.toContain('7/');
    expect(romanNumeral(4, 0, 'dominant7', { degree: 6, quality: 'diminished' })).toBe('V/vii°');
  });

  /**
   * The target is a degree of the key, so it is never itself altered - and the
   * accidental on the left, if there is one, belongs to the chord rather than to
   * the thing it points at.
   *
   * **This is a statement about `romanNumeral`, not a licence for its callers.**
   * The accidental it keeps is one measured *against the target*: `♭II/V` is a
   * Neapolitan of the dominant, a chord whose root really is a flattened second
   * above the thing it points at. A secondary dominant never is one - its root
   * is a perfect fifth above its target by construction - so
   * `progression-vocabulary.ts` passes a constant zero here rather than the
   * chord's displacement within the *key*, which is a different measurement and
   * would print `♯V/vii°` for a plain `V/vii°`. See `ALTER_AGAINST_TARGET`.
   */
  it('puts an accidental on the chord and not on its target', () => {
    expect(romanNumeral(1, -1, 'major', { degree: 4, quality: 'major' })).toBe('♭II/V');
  });

  // A bad target degree is refused on the same terms as a bad degree, because
  // it is read out of the same table.
  it('refuses a target degree that is not one of the seven', () => {
    expect(() => romanNumeral(4, 0, 'dominant7', { degree: 7, quality: 'major' }))
      .toThrowError(/degree/i);
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

  /**
   * A double accidental is said, not counted.
   *
   * Reachable on a root only since spelling came from the degree's letter: D♭
   * major's `♭II` is an E double flat and G♯ minor's `♯vii°` an F double sharp,
   * where the two chromatic tables could offer neither and printed the letter
   * next door. Left to the single-accidental rule these announce as "E flat"
   * with a stray character, or as "E b b" - a chord on the wrong note either
   * way.
   */
  it('says a double accidental as a double', () => {
    expect(spokenChordName('Ebb', 'major')).toBe('E double flat major');
    expect(spokenChordName('F##', 'diminished')).toBe('F double sharp diminished');
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

