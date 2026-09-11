import { CHORD_EXTENTS, createExtensions } from '../models/progression-normalize';
import type { SuspensionKind } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import {
  ChordExtent,
  ChordIdentity,
  ChordQuality,
  ChordShape,
  NamedQuality,
  QUALITY_INTERVALS,
  degreeQuality,
  effectiveChord,
  isHeptatonic
} from './progression-harmony';
import {
  chordName,
  isNameable,
  romanNumeral,
  spokenChordName
} from './progression-chord-names';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

/** The four four-note shapes whose fourth note is not a seventh. */
const ADDED_TONE_SHAPES: readonly NamedQuality[] = ['major6', 'minor6', 'add9', 'minorAdd9'];

/**
 * The identity of a chord that is only a quality: nothing suspended, nothing
 * pinned, standing at the height its own shape reaches.
 *
 * The three renderers take a `ChordIdentity` since M3 Task 5, and every
 * expectation below about a triad or a seventh is unchanged by that - which is
 * the claim this helper exists to make checkable. An identity built this way
 * renders exactly what the three tables rendered when they were handed a bare
 * quality, because with no height above the base, no alteration and no
 * suspension there is nothing for `composeFigure` to compose.
 *
 * `intervals` is the shape's own, so its *length* is right, which is what
 * decides a triad from a four-note chord when no extension is present. The rest
 * of the composed cases are built through `effectiveChord` from real shapes
 * further down, because a hand-written identity could assert a chord the
 * arithmetic cannot build.
 */
function chord(base: ChordQuality): ChordIdentity {
  const intervals = base === 'other' ? [] : QUALITY_INTERVALS[base];

  return {
    root: 0,
    base,
    suspension: 'none',
    extent: intervals.length >= 4 ? 7 : 3,
    intervals,
    ninth: null,
    eleventh: null,
    thirteenth: null,
    steps: []
  };
}

/** A shape to build an identity from, with C major's defaults. */
function shape(overrides: Partial<ChordShape> = {}): ChordShape {
  return {
    degree: 0,
    alter: 0,
    extent: 3,
    quality: null,
    suspension: 'none',
    extensions: createExtensions(),
    ...overrides
  };
}

/** The identity of a chord built in a scale, which is what the renderers take. */
function built(
  scale: readonly number[],
  overrides: Partial<ChordShape> = {}
): ChordIdentity {
  return effectiveChord(scale, shape(overrides));
}

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
    return [0, 1, 2, 3, 4, 5, 6].map(d => romanNumeral(d, 0, chord(degreeQuality(scale, d, extent))));
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
    expect(romanNumeral(2, 0, chord('augmented'))).toBe('III+');
  });

  // The seventh figures, each against the shape it is conventionally written
  // as: Imaj7, V7, ii7, viiø7, vii°7.
  it('writes the seventh chords with their usual figures', () => {
    expect(romanNumeral(0, 0, chord('major7'))).toBe('Imaj7');
    expect(romanNumeral(4, 0, chord('dominant7'))).toBe('V7');
    expect(romanNumeral(1, 0, chord('minor7'))).toBe('ii7');
    expect(romanNumeral(0, 0, chord('minorMajor7'))).toBe('i(maj7)');
    expect(romanNumeral(6, 0, chord('halfDiminished7'))).toBe('viiø7');
    expect(romanNumeral(6, 0, chord('diminished7'))).toBe('vii°7');
    expect(romanNumeral(2, 0, chord('augmented7'))).toBe('III+7');
    expect(romanNumeral(2, 0, chord('augmentedMajor7'))).toBe('III+maj7');
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
    const major = romanNumeral(0, 0, chord('major7'));
    const minorMajor = romanNumeral(0, 0, chord('minorMajor7'));

    expect(minorMajor).not.toBe(major);
    expect(minorMajor.toLowerCase()).not.toBe(major.toLowerCase());
  });

  /**
   * **This expectation is the one M3 Task 5 deliberately reversed.** It read
   * `V7` at all three heights, on the argument that the figure described the
   * quality rather than the stack - which was true while a `ChordQuality` was
   * all this function was given, and which the + complexity button made visible
   * as a slot that sounded taller without being called anything different.
   *
   * A `ChordIdentity` carries the height, so the figure now states it. The
   * chord name beside it states the same height in its own convention, because
   * both are composed from the one identity by the one function - which is what
   * removed the reason for printing `V7` over five notes.
   */
  it('prints an extended chord at the height it reaches', () => {
    const figures = ([9, 11, 13] as ChordExtent[]).map(extent =>
      romanNumeral(4, 0, built(MAJOR, { degree: 4, extent }))
    );

    expect(figures).toEqual(['V9', 'V11', 'V13']);
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
    expect(romanNumeral(6, 0, chord('other'))).toBe('VII?');
  });

  // The same domain `degreePitchClasses` enforces, and for the same reason: a
  // degree off the end of the table would otherwise read `undefined` and print
  // the string "undefined" into a button.
  it('refuses a degree that is not one of the seven', () => {
    expect(() => romanNumeral(-1, 0, chord('major'))).toThrowError(/degree/i);
    expect(() => romanNumeral(7, 0, chord('major'))).toThrowError(/degree/i);
    expect(() => romanNumeral(1.5, 0, chord('major'))).toThrowError(/degree/i);
    expect(() => romanNumeral(NaN, 0, chord('major'))).toThrowError(/degree/i);
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
    expect(romanNumeral(6, -1, chord('major'))).toBe('♭VII');
    expect(romanNumeral(5, -1, chord('major'))).toBe('♭VI');
    expect(romanNumeral(2, -1, chord('major'))).toBe('♭III');
    expect(romanNumeral(1, -1, chord('major'))).toBe('♭II');
  });

  // The fifth row of that table, and the one that goes the other way: a raised
  // root takes a sharp, and the figure still follows the shape.
  it('writes a raised root with a sharp', () => {
    expect(romanNumeral(3, 1, chord('diminished'))).toBe('♯iv°');
    expect(romanNumeral(4, 2, chord('major'))).toBe('♯♯V');
  });

  // A double flat is two glyphs rather than a different sign, which is what
  // `ALTER_MIN` of -2 makes reachable.
  it('repeats the glyph for a double accidental', () => {
    expect(romanNumeral(1, -2, chord('major'))).toBe('♭♭II');
  });

  // An unaltered degree prints no accidental at all - the M1 numeral, unchanged
  // by widening the signature.
  it('prints nothing for an unaltered root', () => {
    expect(romanNumeral(3, 0, chord('minor'))).toBe('iv');
  });

  // Wrong kind throws, on the same rule as the degree beside it: a fractional
  // accidental would render as an empty string through `repeat`, which is a
  // silently missing flat rather than a failure.
  it('refuses an accidental that is not a whole number of semitones', () => {
    expect(() => romanNumeral(6, -0.5, chord('major'))).toThrowError(/accidental/i);
    expect(() => romanNumeral(6, NaN, chord('major'))).toThrowError(/accidental/i);
  });

  /**
   * The slash, which names a chord's function in a key it is not in.
   *
   * `V/vi` is the dominant *of the sixth degree*, so the numeral on the left is
   * measured against the target and not against the home key - which is why the
   * degree argument reads 4 for all five secondary dominants a major key has.
   */
  it('names a chord after the degree it tonicises', () => {
    expect(romanNumeral(4, 0, chord('dominant7'), { degree: 5, quality: 'minor' })).toBe('V/vi');
    expect(romanNumeral(4, 0, chord('dominant7'), { degree: 4, quality: 'major' })).toBe('V/V');
    expect(romanNumeral(4, 0, chord('dominant7'), { degree: 3, quality: 'major' })).toBe('V/IV');
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
    expect(romanNumeral(4, 0, chord('dominant7'), { degree: 5, quality: 'minor' })).not.toContain('7/');
    expect(romanNumeral(4, 0, chord('dominant7'), { degree: 6, quality: 'diminished' })).toBe('V/vii°');
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
    expect(romanNumeral(1, -1, chord('major'), { degree: 4, quality: 'major' })).toBe('♭II/V');
  });

  // A bad target degree is refused on the same terms as a bad degree, because
  // it is read out of the same table.
  it('refuses a target degree that is not one of the seven', () => {
    expect(() => romanNumeral(4, 0, chord('dominant7'), { degree: 7, quality: 'major' }))
      .toThrowError(/degree/i);
  });
});

describe('chordName', () => {
  // The concrete names beside the numerals, in the reference UI's spelling.
  it('names the triads', () => {
    expect(chordName('C', chord('major'))).toBe('C Maj');
    expect(chordName('A', chord('minor'))).toBe('A min');
    expect(chordName('B', chord('diminished'))).toBe('B°');
    expect(chordName('C', chord('augmented'))).toBe('C+');
  });

  /**
   * The separator is a rule rather than a second column: a suffix that starts
   * with a letter is a word and takes a space, and one that starts with a
   * symbol or a digit is a figure and does not. That gives `C Maj7` and `G7`,
   * which is how both are written.
   */
  it('spaces a worded suffix and closes up a figured one', () => {
    expect(chordName('C', chord('major7'))).toBe('C Maj7');
    expect(chordName('A', chord('minor7'))).toBe('A min7');
    expect(chordName('A', chord('minorMajor7'))).toBe('A minMaj7');
    expect(chordName('G', chord('dominant7'))).toBe('G7');
    expect(chordName('B', chord('halfDiminished7'))).toBe('Bø7');
    expect(chordName('B', chord('diminished7'))).toBe('B°7');
    expect(chordName('C', chord('augmented7'))).toBe('C+7');
    expect(chordName('C', chord('augmentedMajor7'))).toBe('C+Maj7');
  });

  it('marks a stack that is not a named chord', () => {
    expect(chordName('B', chord('other'))).toBe('B?');
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
    expect(spokenChordName('B', chord('diminished'))).toBe('B diminished');
    expect(spokenChordName('C', chord('augmented'))).toBe('C augmented');
    expect(spokenChordName('B', chord('halfDiminished7'))).toBe('B half diminished seventh');
    expect(spokenChordName('G', chord('dominant7'))).toBe('G dominant seventh');
  });

  it('says the accidental instead of spelling it', () => {
    expect(spokenChordName('Eb', chord('major'))).toBe('E flat major');
    expect(spokenChordName('A#', chord('minor'))).toBe('A sharp minor');
    expect(spokenChordName('C', chord('major'))).toBe('C major');
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
    expect(spokenChordName('Ebb', chord('major'))).toBe('E double flat major');
    expect(spokenChordName('F##', chord('diminished'))).toBe('F double sharp diminished');
  });

  /** The chord is real; only its name is missing, and the label says so. */
  it('still identifies a stack that is not a named chord', () => {
    expect(spokenChordName('B', chord('other'))).toBe('B unnamed chord');
  });

  /**
   * A row each in the three tables for the four added-tone shapes, checked in
   * all three conventions at once because that is what having three tables is
   * for: the numeral spells the third in its case, the chord symbol is what a
   * chart prints, and the spoken form is words.
   *
   * `C6` closes up and `C add9` takes a space, which is `chordName`'s separator
   * rule reading the first character of the suffix rather than a column in the
   * table: a figure begins with a digit or a symbol, a word with a letter.
   */
  it('writes the four added-tone shapes in all three conventions', () => {
    expect(romanNumeral(0, 0, chord('major6'))).toBe('I6');
    expect(romanNumeral(0, 0, chord('minor6'))).toBe('i6');
    expect(romanNumeral(0, 0, chord('add9'))).toBe('Iadd9');
    expect(romanNumeral(0, 0, chord('minorAdd9'))).toBe('iadd9');

    expect(chordName('C', chord('major6'))).toBe('C6');
    expect(chordName('C', chord('minor6'))).toBe('C min6');
    expect(chordName('C', chord('add9'))).toBe('C add9');
    expect(chordName('C', chord('minorAdd9'))).toBe('C minadd9');

    expect(spokenChordName('C', chord('major6'))).toBe('C sixth');
    expect(spokenChordName('C', chord('minor6'))).toBe('C minor sixth');
    expect(spokenChordName('C', chord('add9'))).toBe('C added ninth');
    expect(spokenChordName('C', chord('minorAdd9'))).toBe('C minor added ninth');
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
      'major6', 'minor6', 'add9', 'minorAdd9',
      'other'
    ];

    for (const quality of qualities) {
      const spoken = spokenChordName('C', chord(quality));
      expect(spoken)
        .withContext(`${quality} is not spoken as words`)
        .toMatch(/^C [a-z ]+$/);
    }
  });
});

/**
 * The composed figures, checked in all three conventions at once.
 *
 * Every chord here is built by `effectiveChord` from a real shape rather than
 * hand-written as an identity, so an expectation cannot assert a chord the
 * arithmetic does not produce - which is the failure a naming test is most
 * exposed to, being a claim about typography sitting one step from a claim about
 * notes. The intervals are asserted alongside the names for the same reason: if
 * the stack is not what this file thinks it is, the name it checks is a name for
 * something else.
 *
 * The rule under test is three lines long. The height is the highest *unaltered*
 * extension present; the altered ones follow it in ascending order; the
 * suspension goes last.
 */
describe('composed figures', () => {
  /** All three renderings of one chord, which is what the strip card prints. */
  function names(degree: number, root: string, identity: ChordIdentity): string[] {
    return [
      romanNumeral(degree, 0, identity),
      chordName(root, identity),
      spokenChordName(root, identity)
    ];
  }

  // G B D F A. The ninth is the key's own and is a major ninth above G, so it
  // is unaltered and it is the height.
  it('names a ninth after its ninth', () => {
    const v9 = built(MAJOR, { degree: 4, extent: 9 });

    expect(v9.intervals).toEqual([0, 4, 7, 10, 14]);
    expect(names(4, 'G', v9)).toEqual(['V9', 'G9', 'G dominant ninth']);
  });

  // G B D F A flat. An altered extension cannot be the height, because `V9`
  // would be saying the ninth was natural - so the figure falls back to the
  // seventh and the flat nine is written after it.
  it('drops to the seventh when the ninth is flattened', () => {
    const flatNine = built(MAJOR, {
      degree: 4,
      extent: 9,
      extensions: { ninth: -1, eleventh: null, thirteenth: null }
    });

    expect(flatNine.intervals).toEqual([0, 4, 7, 10, 13]);
    expect(names(4, 'G', flatNine)).toEqual([
      'V7♭9',
      'G7b9',
      'G dominant seventh flat nine'
    ]);
  });

  // C E G B D F sharp A. The thirteenth is where the key put it, so it is still
  // the height even though the eleventh below it is raised.
  it('keeps a thirteenth as the height over a sharpened eleventh', () => {
    const maj13 = built(MAJOR, {
      extent: 13,
      extensions: { ninth: null, eleventh: 1, thirteenth: null }
    });

    expect(maj13.intervals).toEqual([0, 4, 7, 11, 14, 18, 21]);
    expect(names(0, 'C', maj13)).toEqual([
      'Imaj13♯11',
      'C Maj13#11',
      'C major thirteenth sharp eleven'
    ]);
  });

  // D F A C E G, every rung diatonic.
  it('names a minor eleventh', () => {
    const ii11 = built(MAJOR, { degree: 1, extent: 11 });

    expect(ii11.intervals).toEqual([0, 3, 7, 10, 14, 17]);
    expect(names(1, 'D', ii11)).toEqual(['ii11', 'D min11', 'D minor eleventh']);
  });

  // G C D F. The base is read with the suspension removed, so it is the
  // dominant seventh that is being suspended - which is what `7sus4` says.
  it('names a suspended seventh', () => {
    const v7sus4 = built(MAJOR, { degree: 4, extent: 7, suspension: 'sus4' });

    expect(v7sus4.intervals).toEqual([0, 5, 7, 10]);
    expect(v7sus4.base).toBe('dominant7');
    expect(names(4, 'G', v7sus4)).toEqual([
      'V7sus4',
      'G7sus4',
      'G dominant seventh suspended fourth'
    ]);
  });

  // C D G. A suspended triad has no third, so the word that described one goes
  // - which is also what closes the printed name up: `Csus2`, never `C Majsus2`.
  it('drops the quality word from a suspended triad', () => {
    const sus2 = built(MAJOR, { suspension: 'sus2' });

    expect(sus2.intervals).toEqual([0, 2, 7]);
    expect(names(0, 'C', sus2)).toEqual(['Isus2', 'Csus2', 'C suspended second']);
  });

  // C E G A D, which is written `6/9` and not as any composition of a 6 with
  // a 9. The one combination in the module that is a name in its own right.
  it('names a sixth with a ninth over it as a six nine', () => {
    const sixNine = built(MAJOR, { extent: 9, quality: 'major6' });

    expect(sixNine.intervals).toEqual([0, 4, 7, 9, 14]);
    expect(names(0, 'C', sixNine)).toEqual(['I6/9', 'C6/9', 'C six nine']);
  });

  // B D F A flat in C harmonic minor, and the figure it has always had. A
  // seventh with nothing above it composes to exactly what the tables held.
  it('leaves a plain seventh exactly as the tables wrote it', () => {
    const dim7 = built(HARMONIC_MINOR, { degree: 6, extent: 7 });

    expect(dim7.intervals).toEqual([0, 3, 6, 9]);
    expect(names(6, 'B', dim7)).toEqual(['vii°7', 'B°7', 'B diminished seventh']);
  });

  /**
   * Two alterations at once, which the rule covers and the plan's table did
   * not: they follow the height in ascending order, which is the order a chart
   * lists them in. The bracketed form a chart often uses puts the same two
   * figures in the same order.
   */
  it('lists two altered extensions in ascending order', () => {
    const both = built(MAJOR, {
      degree: 4,
      extent: 11,
      extensions: { ninth: -1, eleventh: 1, thirteenth: null }
    });

    expect(both.intervals).toEqual([0, 4, 7, 10, 13, 18]);
    expect(names(4, 'G', both)).toEqual([
      'V7♭9♯11',
      'G7b9#11',
      'G dominant seventh flat nine sharp eleven'
    ]);
  });

  /**
   * An added-tone shape carried above the height it has a name at.
   *
   * A `major6` at extent 11 sounds C E G A D F - a 6/9 with an eleventh over
   * it. There is no conventional symbol for that, and truncating to `C6/9`
   * would be silent about a note that is sounding. So the refusal, which is the
   * same one a nameless stack of thirds gets.
   */
  it('refuses a sixth chord carried past a ninth', () => {
    const wide = built(MAJOR, { extent: 11, quality: 'major6' });

    expect(wide.intervals).toEqual([0, 4, 7, 9, 14, 17]);
    expect(names(0, 'C', wide)).toEqual(['I?', 'C?', 'C unnamed chord']);
  });

  /**
   * And a suspension over a base whose figure describes the fifth as well as
   * the third.
   *
   * A suspended diminished triad is B E F: the third is gone and the diminished
   * fifth is not, so dropping the degree sign would lose it and keeping it would
   * print a symbol no chart uses. Unlabelled rather than mislabelled, and the
   * numeral goes upper case with the rest of the refusal because its case would
   * be asserting a third that is not there either.
   */
  it('refuses a suspension over a diminished triad', () => {
    const diminishedSus = built(MAJOR, { degree: 6, suspension: 'sus4' });

    expect(diminishedSus.intervals).toEqual([0, 5, 6]);
    expect(names(6, 'B', diminishedSus)).toEqual(['VII?', 'B?', 'B unnamed chord']);
  });

  /**
   * A seventh chosen at a triad's height, then suspended.
   *
   * The extent decides the note count, so the seventh is never built - and the
   * base is read off the stack that *was* built, which is a plain major triad.
   * A chord sounding C F G is a `Csus4` whatever was asked for, and reading the
   * base off the stored quality instead would have printed `C7sus4` over three
   * notes.
   */
  it('names a truncated seventh under a suspension by what it built', () => {
    const truncated = built(MAJOR, { quality: 'dominant7', suspension: 'sus4' });

    expect(truncated.intervals).toEqual([0, 5, 7]);
    expect(truncated.base).toBe('major');
    expect(names(0, 'C', truncated)).toEqual(['Isus4', 'Csus4', 'C suspended fourth']);
  });

  /**
   * A stack no name fits at all, which is the fourth way to reach the refusal.
   *
   * A major triad two semitones flat under a seventh the key kept where it was
   * spans thirteen semitones root to top. `qualityOfIntervals` refuses it, and
   * the refusal reaches all three renderings unchanged.
   */
  it('refuses a stack that is no named chord', () => {
    const unnameable = built(MAJOR, { extent: 7, alter: -2, quality: 'major' });

    expect(unnameable.base).toBe('other');
    expect(names(0, 'C', unnameable)).toEqual(['I?', 'C?', 'C unnamed chord']);
  });

  /**
   * Every four-note base at every height, which is what makes the height a rule
   * rather than a table.
   *
   * The substitution replaces the base figure's own seventh, so a figure naming
   * its seventh twice, or not at all, would come out wrong here rather than in
   * whichever key first reached it. The four added-tone shapes are excluded
   * because they name no seventh to raise - their own test is above.
   */
  it('raises every seventh figure to every height', () => {
    const wrong: string[] = [];

    for (const quality of Object.keys(QUALITY_INTERVALS) as NamedQuality[]) {
      if (QUALITY_INTERVALS[quality].length < 4) continue;
      if (ADDED_TONE_SHAPES.includes(quality)) continue;

      const base = chordName('C', chord(quality));

      for (const extent of [9, 11, 13] as ChordExtent[]) {
        const printed = chordName('C', {
          ...chord(quality),
          extent,
          ninth: 0,
          eleventh: extent >= 11 ? 0 : null,
          thirteenth: extent >= 13 ? 0 : null
        });
        const expected = base.replace(/7(?![^7]*7)/, String(extent));

        if (printed !== expected) {
          wrong.push(`${quality} at ${extent}: ${base} became ${printed}, wanted ${expected}`);
        }
      }
    }

    expect(wrong).withContext(wrong.join('\n')).toEqual([]);
  });

  /**
   * The suspension goes last, after any alteration.
   *
   * The suffix reads as a shape followed by what was done to it, and a
   * suspension is what is *missing* from the shape rather than where one of its
   * notes sits.
   */
  it('puts the suspension after the alterations', () => {
    const both = built(MAJOR, {
      degree: 4,
      extent: 9,
      suspension: 'sus4',
      extensions: { ninth: -1, eleventh: null, thirteenth: null }
    });

    expect(chordName('G', both)).toBe('G7b9sus4');
  });
});

/**
 * The height rule applied to the four bases whose figure carries a sign, and how
 * far it reaches.
 *
 * `°`, `ø` and `+` describe the fifth as well as the third, and that is why
 * `SUSPENDED_FIGURES` refuses to suspend them. A *height* gets the opposite
 * answer - it stacks thirds above a shape the sign already names and changes no
 * note the sign describes - so `°7` becomes `°13` and `ø7` becomes `ø11` like
 * any other seventh figure. `SEVENTH_FIGURE`'s note is where that ruling is
 * argued; this is the census that keeps it visible.
 *
 * The count matters because the ruling is not a corner case. It is measured over
 * the app's own scales with **nothing pinned and no override at all**, which is
 * to say what a user reaches by pressing the complexity control on a plain
 * palette button, and it lands on the default key: C major's `vii` at extent 11
 * is a `Bø11b9`, pinned separately below.
 *
 * If a number moves, it is a ruling to make and not a count to update. Either a
 * scale has been added, or `NAMEABLE_ALTERATIONS` has changed which alterations
 * have a figure, or the substitution has stopped reaching one of these bases.
 */
describe('the signed bases at a height', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** All three renderings of one chord, as the sibling describe builds them. */
  function names(degree: number, root: string, identity: ChordIdentity): string[] {
    return [
      romanNumeral(degree, 0, identity),
      chordName(root, identity),
      spokenChordName(root, identity)
    ];
  }

  /** The four bases whose figure carries a sign describing the fifth. */
  const SIGNED_BASES: readonly ChordQuality[] = [
    'diminished7',
    'halfDiminished7',
    'augmented7',
    'augmentedMajor7'
  ];

  /**
   * Whether a chord printed one of those figures with its seventh replaced.
   *
   * Read off the printed symbol rather than recomputed from the identity,
   * because the printed symbol is what the ruling is about. Each of the four
   * figures names its seventh exactly once and holds no other `7`, and no
   * alteration or height figure is a `7` either - so a `7` left in the suffix is
   * a figure the substitution did not touch.
   */
  function raised(identity: ChordIdentity): boolean {
    return (
      SIGNED_BASES.includes(identity.base) && !chordName('C', identity).includes('7')
    );
  }

  /**
   * 130 in total, and none of them below a ninth - a triad has no seventh to
   * raise and a seventh's own height is the identity substitution.
   *
   * The review that asked for this census counted 71, which is these four bases
   * less `augmentedMajor7`. That base belongs here: `+Maj7` carries the same `+`
   * and takes the same height, so leaving it out would be pinning three quarters
   * of one ruling. `diminished7` contributes none of the 130 - no diatonic
   * diminished-seventh stack in these scales carries an unaltered extension - so
   * `°13` is reachable only through an override, which is exactly what the
   * ruling's own examples say.
   */
  const RAISED_BY_EXTENT: ReadonlyMap<number, number> = new Map([
    [3, 0],
    [7, 0],
    [9, 32],
    [11, 50],
    [13, 48]
  ]);

  it('raises a sign figure on 130 chords reachable with nothing pinned', () => {
    const measured = new Map<number, number>();

    for (const extent of CHORD_EXTENTS) {
      let count = 0;

      for (const intervals of APP_SCALES) {
        for (let degree = 0; degree <= 6; degree++) {
          if (raised(built(intervals, { degree, extent }))) count++;
        }
      }

      measured.set(extent, count);
    }

    expect([...measured]).toEqual([...RAISED_BY_EXTENT]);
    expect([...measured.values()].reduce((sum, count) => sum + count, 0)).toBe(130);
  });

  /**
   * The one a reader meets first, in all three conventions.
   *
   * C major, no borrowing, nothing pinned: three steps of the complexity control
   * from a fresh slot and the seventh degree is a half-diminished eleventh with
   * the key's own flat ninth in it. Refusing the height here would print `?` on
   * the default key's own `vii`, and `ø11♭9` is a symbol a reader can decode
   * where `?` is nothing to decode.
   */
  it('names C major own vii at an eleventh rather than refusing it', () => {
    const vii11 = built(MAJOR, { degree: 6, extent: 11 });

    expect(vii11.intervals).toEqual([0, 3, 6, 10, 13, 17]);
    expect(vii11.base).toBe('halfDiminished7');
    expect(names(6, 'B', vii11)).toEqual([
      'viiø11♭9',
      'Bø11b9',
      'B half diminished eleventh flat nine'
    ]);
  });

  /**
   * And the extremes an override reaches, which are stranger and are named on
   * the same terms: what was built, rather than what a chart happens to print
   * often. The refusal is kept for where no symbol exists at all - a suspension
   * over these same signs, which is the neighbouring ruling.
   */
  it('names the tallest sign figures an override reaches', () => {
    const augmented13 = built(MAJOR, { extent: 13, quality: 'augmented7' });
    const diminished13 = built(MAJOR, { extent: 13, quality: 'diminished7' });

    expect(chordName('C', augmented13)).toBe('C+13');
    expect(chordName('C', diminished13)).toBe('C°13');
  });
});

/**
 * The question `isNameable` answers, which is the one `composeFigure` answers a
 * moment later.
 *
 * It exists for a caller that has to decide something *before* a name is
 * printed - the relabel chip, whose menu is a menu of names and which cannot
 * offer a chord this module would write `?` for. The risk in such a predicate is
 * that it becomes a second statement of the refusal and drifts from the printer,
 * so what is asserted here is the agreement rather than a list of cases: over
 * every chord the app's own scales build, at every height and under every
 * suspension, the predicate says no exactly where the symbol says `?`.
 */
describe('isNameable', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  const SUSPENSIONS: readonly SuspensionKind[] = ['none', 'sus2', 'sus4'];

  it('agrees with the symbol, over every chord the app can build', () => {
    const disagreed: string[] = [];
    let refused = 0;

    for (const intervals of APP_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of CHORD_EXTENTS) {
          for (const suspension of SUSPENSIONS) {
            const identity = built(intervals, { degree, extent, suspension });
            const printed = chordName('C', identity);

            if (!isNameable(identity)) refused++;
            if (isNameable(identity) === printed.endsWith('?')) disagreed.push(printed);
          }
        }
      }
    }

    expect(disagreed).toEqual([]);
    // The sweep reaches the refusal rather than only the happy side of it: a
    // predicate that agreed with the printer on nothing but names would pass the
    // assertion above and be worthless to the chip.
    expect(refused).toBeGreaterThan(0);
  });

  /**
   * And the four roads to it, named, so a reader need not run the sweep to see
   * what it found: a stack that is no named chord, a suspension over a base
   * whose sign describes the fifth, a sixth carried past its ninth, and - the
   * happy side - an ordinary seventh.
   */
  it('names the three refusals and the chord beside them', () => {
    expect(isNameable(built(MAJOR, { extent: 7, alter: -2, quality: 'major' }))).toBe(false);
    expect(isNameable(built(MAJOR, { degree: 6, suspension: 'sus4' }))).toBe(false);
    expect(isNameable(built(MAJOR, { extent: 11, quality: 'major6' }))).toBe(false);
    expect(isNameable(built(MAJOR, { degree: 4, extent: 7 }))).toBe(true);
  });
});
