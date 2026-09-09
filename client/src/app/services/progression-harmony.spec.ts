import {
  ChordExtent,
  ChordQuality,
  QUALITY_INTERVALS,
  chordName,
  chordPitchClasses,
  degreeQuality,
  degreePitchClasses,
  isHeptatonic,
  noteCount,
  qualityOfIntervals,
  romanNumeral,
  spokenChordName
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

// ---------------------------------------------------------------------------
// Chromatic roots and overridden shapes
// ---------------------------------------------------------------------------

/**
 * The correction the design doc records under "`alter` cannot express a
 * borrowed chord", checked against the table it tabulates.
 *
 * `alter` used to shift the whole stack, which is transposition, and
 * transposition preserves quality - so every conventional altered numeral in a
 * major key came out with the wrong shape on the right root. These specs are
 * that table read the other way round: what each numeral has to produce.
 */
describe('QUALITY_INTERVALS', () => {
  /**
   * The inverse of `degreeQuality`, and the pair has to agree in both
   * directions or a chord built from a quality would not be recognised as that
   * quality - which is exactly what M3's recogniser will do.
   */
  it('round-trips through the recogniser for every named quality', () => {
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      expect(qualityOfIntervals(intervals))
        .withContext(`${quality} is not recognised from its own intervals`)
        .toBe(quality as ChordQuality);
    }
  });

  /** Every name `degreeQuality` can return, except the one that names nothing. */
  it('holds every named quality and no unnamed one', () => {
    const named: ChordQuality[] = [
      'major', 'minor', 'diminished', 'augmented',
      'major7', 'minor7', 'dominant7', 'minorMajor7',
      'halfDiminished7', 'diminished7', 'augmented7', 'augmentedMajor7'
    ];

    expect(Object.keys(QUALITY_INTERVALS).sort()).toEqual([...named].sort());
  });

  /** Each seventh chord opens with the triad of the same name. */
  it('opens every seventh with its own triad', () => {
    expect(QUALITY_INTERVALS.dominant7.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.major7.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.minor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
    expect(QUALITY_INTERVALS.minorMajor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
    expect(QUALITY_INTERVALS.halfDiminished7.slice(0, 3)).toEqual(QUALITY_INTERVALS.diminished);
    expect(QUALITY_INTERVALS.diminished7.slice(0, 3)).toEqual(QUALITY_INTERVALS.diminished);
    expect(QUALITY_INTERVALS.augmented7.slice(0, 3)).toEqual(QUALITY_INTERVALS.augmented);
    expect(QUALITY_INTERVALS.augmentedMajor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.augmented);
  });
});

describe('qualityOfIntervals', () => {
  /**
   * `degreeQuality` is this function applied to a diatonic stack, so the two
   * cannot disagree by construction. Pinned anyway: the whole point of one
   * table is that the second reading of it is not a second table.
   */
  it('agrees with degreeQuality on every degree of every scale checked here', () => {
    const scales = [MAJOR, NATURAL_MINOR, HARMONIC_MINOR, MELODIC_MINOR, NEAPOLITAN_MINOR];

    for (const scale of scales) {
      for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
        for (const extent of [3, 7, 9, 11, 13] as ChordExtent[]) {
          expect(qualityOfIntervals(degreePitchClasses(scale, degree, extent)))
            .withContext(`degree ${degree} extent ${extent}`)
            .toBe(degreeQuality(scale, degree, extent));
        }
      }
    }
  });

  /** It reads intervals above the root, wherever the root happens to sit. */
  it('reads a stack that does not start at zero', () => {
    expect(qualityOfIntervals([10, 14, 17])).toBe('major');
    expect(qualityOfIntervals([11, 14, 17])).toBe('diminished');
  });

  it('names a stack that is no chord "other"', () => {
    expect(qualityOfIntervals([0, 1, 6])).toBe('other');
  });
});

describe('chordPitchClasses', () => {
  /** Every case below is in C major, where the correction's table is written. */
  function chord(
    degree: number,
    extent: ChordExtent,
    alter: number,
    quality: ChordQuality | null
  ): number[] {
    return chordPitchClasses(MAJOR, degree, extent, alter, quality);
  }

  it('gives the diatonic stack when no quality overrides it', () => {
    expect(chord(0, 3, 0, null)).toEqual([0, 4, 7]);
    expect(chord(6, 3, 0, null)).toEqual([11, 14, 17]);
    expect(chord(4, 7, 0, null)).toEqual([7, 11, 14, 17]);
  });

  /**
   * The five borrowed numerals the correction tabulates, each with the shape
   * its case carries rather than the shape a transposed stack would have had.
   * Pitch classes are relative to the tonic and keep climbing past the octave,
   * as `degreePitchClasses` returns them, so 14 is the D above 2.
   */
  it('builds the borrowed chords of a major key', () => {
    // bVII: B-D-F becomes Bb-D-F. Diminished under the old semantics.
    expect(chord(6, 3, -1, 'major')).toEqual([10, 14, 17]);
    // bVI: A-C-E becomes Ab-C-Eb. Minor under the old semantics.
    expect(chord(5, 3, -1, 'major')).toEqual([8, 12, 15]);
    // bIII: E-G-B becomes Eb-G-Bb. Minor under the old semantics.
    expect(chord(2, 3, -1, 'major')).toEqual([3, 7, 10]);
    // bII, the Neapolitan: D-F-A becomes Db-F-Ab. Minor under the old semantics.
    expect(chord(1, 3, -1, 'major')).toEqual([1, 5, 8]);
    // #iv-dim: F-A-C becomes F#-A-C. Major under the old semantics.
    expect(chord(3, 3, 1, 'diminished')).toEqual([6, 9, 12]);
  });

  /**
   * A secondary dominant is a dominant seventh on a diatonic root, so it needs
   * no alteration at all - only a quality the key does not give that degree.
   * V/V in C is D7: D-F#-A-C, where the key gives D-F-A-C.
   */
  it('builds a secondary dominant on an unaltered root', () => {
    expect(chord(1, 7, 0, 'dominant7')).toEqual([2, 6, 9, 12]);
  });

  /**
   * Design decision 2. `ChordQuality` names only triads and sevenths, so an
   * override at extent 9 and above has nothing to say about the extensions:
   * they keep the scale's own notes. bVII9 is Bb-D-F over a diatonic ninth.
   */
  it('leaves the extensions diatonic above an overridden triad', () => {
    expect(chord(6, 9, -1, 'major')).toEqual([10, 14, 17, 21, 24]);
    expect(chord(6, 13, -1, 'major').slice(0, 3)).toEqual([10, 14, 17]);
    expect(chord(6, 13, -1, 'major').slice(3))
      .toEqual(degreePitchClasses(MAJOR, 6, 13).slice(3));
  });

  /**
   * The other end of the same rule, which the plan's sketch left open: a
   * seventh quality asked for at a triad's height has one interval too many.
   * The extent decides how many notes a chord has - `noteCount` is what
   * `normalizeInversion` wraps against and what the complexity readout prints -
   * so the shape is taken while it lasts and no further. Every seventh opens
   * with its own triad, so what is dropped is the seventh and what is left is
   * still that quality's chord.
   */
  it('takes only as many notes as the extent asks for', () => {
    expect(chord(4, 3, 0, 'dominant7')).toEqual([7, 11, 14]);
    expect(chord(1, 3, 0, 'halfDiminished7')).toEqual([2, 5, 8]);
  });

  it('gives the extent its own note count for every quality', () => {
    for (const extent of [3, 7, 9, 11, 13] as ChordExtent[]) {
      for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
        expect(chord(0, extent, 0, quality).length)
          .withContext(`${quality} at extent ${extent}`)
          .toBe(noteCount(extent));
      }
    }
  });

  /** The stack still ascends, which is `voiceChord`'s stated precondition. */
  it('keeps the stack ascending', () => {
    for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
      for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
        const notes = chord(degree, 9, 0, quality);
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i])
            .withContext(`${quality} on degree ${degree}, note ${i}`)
            .toBeGreaterThan(notes[i - 1]);
        }
      }
    }
  });

  /**
   * Design decision 1. A chromatic root with no shape to build is a value of
   * the wrong kind rather than a control at its limit, so it throws under the
   * first clause of the rule in `progression-normalize.ts` rather than falling
   * through to the transposition that produced the wrong table above.
   */
  it('refuses a chromatic root with no shape to build', () => {
    expect(() => chord(6, 3, -1, null)).toThrowError(/quality/i);
    expect(() => chord(6, 3, 1, null)).toThrowError(/quality/i);
  });

  /** `other` names no interval set, so there is nothing to build from. */
  it('refuses an override that names no interval set', () => {
    expect(() => chord(0, 3, 0, 'other')).toThrowError(/other/i);
    expect(() => chord(0, 3, -1, 'other')).toThrowError(/other/i);
  });

  /** The guards under it still apply: the scale and the degree are checked. */
  it('refuses a scale that cannot stack thirds, and a degree off the scale', () => {
    expect(() => chordPitchClasses([0, 2, 4, 7, 9], 0, 3, 0, 'major'))
      .toThrowError(/heptatonic/i);
    expect(() => chordPitchClasses(MAJOR, 7, 3, 0, 'major')).toThrowError(/degree/i);
  });

  /**
   * The round trip the one table exists to keep: a chord built from a quality
   * is recognised as that quality, on a chromatic root as much as a diatonic
   * one. bVII built as major reads back as major, where the old semantics read
   * back as diminished.
   *
   * Asked at the height the quality itself names, which is the width of the
   * claim: a triad override at extent 7 keeps the scale's seventh above it by
   * design, so the chord that comes back is that triad under a diatonic seventh
   * and is rightly named as one. The round trip is a promise about the notes
   * the override supplies, not about the ones it deliberately leaves alone.
   */
  it('builds a chord the recogniser reads back as the quality asked for', () => {
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      const extent: ChordExtent = intervals.length === 3 ? 3 : 7;

      for (const alter of [-1, 0, 1]) {
        for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
          expect(qualityOfIntervals(chord(degree, extent, alter, quality as ChordQuality)))
            .withContext(`${quality} on degree ${degree} altered by ${alter}`)
            .toBe(quality as ChordQuality);
        }
      }
    }
  });

  /**
   * The other half of that promise, stated so it is a decision rather than a
   * surprise: a triad override under an extent that reaches a seventh takes the
   * seventh from the key. bVII at extent 7 in C major is Bb-D-F over the A the
   * scale already had - a Bb major seventh, and named as one. A user who wants
   * a dominant Bb7 asks for `dominant7`, which names the seventh it wants.
   */
  it('names a triad override under a diatonic seventh after what it became', () => {
    expect(chord(6, 7, -1, 'major')).toEqual([10, 14, 17, 21]);
    expect(qualityOfIntervals(chord(6, 7, -1, 'major'))).toBe('major7');
    expect(chord(6, 7, -1, 'dominant7')).toEqual([10, 14, 17, 20]);
    expect(qualityOfIntervals(chord(6, 7, -1, 'dominant7'))).toBe('dominant7');
  });
});
