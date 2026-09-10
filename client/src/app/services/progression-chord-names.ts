import type { ChordQuality } from './progression-harmony';

/**
 * How a chord is written, in the three places this app writes one.
 *
 * Split from `progression-harmony.ts`, which owns the arithmetic these names
 * are read off. The seam is a real one rather than a line count: everything
 * there answers to music theory and can be checked against a chord table, and
 * everything here answers to *typographic* convention and can only be checked
 * against how the figures are printed. `romanNumeral` knows that a diminished
 * triad takes a `°`; it does not know what a diminished triad is.
 *
 * They were one file until it passed the project's 500-line cap, and M2 Task 8
 * widens exactly this half - a numeral needs its accidental, a chord name its
 * slash bass - so the cut is where the growth is.
 *
 * `ChordQuality` comes back the other way as a type-only import, so nothing
 * here is on the arithmetic module's runtime graph and the dependency runs one
 * way: names know about qualities, qualities know nothing about names.
 */

/**
 * How the root arrives, and who decides it.
 *
 * A root reaches `chordName` and `spokenChordName` already spelled, as text,
 * and that has not changed - what changed is who spells it. Until M3 this
 * module also owned `rootPrefersSharps`, a rule that chose between a sharp
 * preference and a flat one by the sign of the chord's `alter`, and the two
 * functions below took whichever of twelve names that preference gave.
 *
 * `progression-spelling.ts` replaces it, and the reason is that the failure was
 * never about a preference. A preference chooses between two names for one
 * pitch class; it cannot choose a **letter**, and 55 buttons across the seven
 * diatonic modes in all twelve keys needed a letter the two chromatic tables do
 * not hold - B♭ major's `♭II` is a C flat and printed `B Maj`, which reads as a
 * raised seventh under a numeral that says lowered second. The old rule also
 * got 112 displaced roots wrong that following the key would have got right,
 * seven of them in keys a user might really be in. Both counts, and the whole
 * argument, are on `progression-spelling.ts`.
 *
 * What stays true here is the separation: this module writes chords and does
 * not spell notes. It now receives a spelling made by degree letter rather than
 * by preference, and the only consequence it has to know about is that a root
 * may carry a double accidental - see `spokenRoot`.
 */

/**
 * How a quality is written, in the three places a chord is written at all.
 *
 * All three tables live together rather than one per module, and here rather
 * than in the palette that prints them, for one reason: they are keyed
 * exhaustively on `ChordQuality`, so adding a quality cannot compile until
 * every way of writing it has been decided. A table in a component would be as
 * correct today and would not have that property - the next quality would reach
 * the screen as `undefined`.
 *
 * They are three tables rather than one because they answer to three different
 * conventions. A Roman numeral spells its sevenths in lower case (`imaj7`)
 * because the numeral's own case is already carrying the third; a chord symbol
 * spells them as they are printed on a chart (`C Maj7`); and neither is a
 * sequence of letters a screen reader can say, which is what the third is for
 * (`C major seventh`). Folding any two together would mean picking one
 * convention and being wrong everywhere the other is used.
 */
interface NumeralFigure {
  /** Whether the numeral is lower case: a claim about the third, not the mode. */
  lowerCase: boolean;
  suffix: string;
}

const NUMERAL_FIGURES: Record<ChordQuality, NumeralFigure> = {
  major: { lowerCase: false, suffix: '' },
  minor: { lowerCase: true, suffix: '' },
  diminished: { lowerCase: true, suffix: '°' },
  augmented: { lowerCase: false, suffix: '+' },
  major7: { lowerCase: false, suffix: 'maj7' },
  dominant7: { lowerCase: false, suffix: '7' },
  minor7: { lowerCase: true, suffix: '7' },
  // Parenthesised, and that is the convention rather than a house style. The
  // minor-major seventh differs from the major seventh by the *case* of one
  // leading letter - `imaj7` against `Imaj7` - and both are reachable here:
  // major7 from ionian's tonic, minorMajor7 from harmonic and melodic minor's.
  // Two figures a reader tells apart only by letter case, in a font they did
  // not choose, is not a distinction to rest a teaching page on.
  minorMajor7: { lowerCase: true, suffix: '(maj7)' },
  halfDiminished7: { lowerCase: true, suffix: 'ø7' },
  diminished7: { lowerCase: true, suffix: '°7' },
  augmented7: { lowerCase: false, suffix: '+7' },
  augmentedMajor7: { lowerCase: false, suffix: '+maj7' },
  // The four added-tone shapes. Case carries the third here as everywhere else,
  // so the sixth and the added ninth each take two rows rather than one - `I6`
  // against `i6` is the same distinction `IV` against `iv` is - and the figure
  // itself says nothing about the third, which is why one figure serves both.
  major6: { lowerCase: false, suffix: '6' },
  minor6: { lowerCase: true, suffix: '6' },
  add9: { lowerCase: false, suffix: 'add9' },
  minorAdd9: { lowerCase: true, suffix: 'add9' },
  // See `romanNumeral` for why an unnameable stack is marked rather than left
  // to whichever case the table happened to pick.
  other: { lowerCase: false, suffix: '?' }
};

const CHORD_SUFFIXES: Record<ChordQuality, string> = {
  major: 'Maj',
  minor: 'min',
  diminished: '°',
  augmented: '+',
  major7: 'Maj7',
  dominant7: '7',
  minor7: 'min7',
  minorMajor7: 'minMaj7',
  halfDiminished7: 'ø7',
  diminished7: '°7',
  augmented7: '+7',
  augmentedMajor7: '+Maj7',
  // `chordName`'s separator rule reads the first character: `6` is a figure and
  // closes up to give `C6`, where `min6`, `add9` and `minadd9` begin with a
  // letter and take a space. That is how each is written on a chart.
  major6: '6',
  minor6: 'min6',
  add9: 'add9',
  minorAdd9: 'minadd9',
  other: '?'
};

/**
 * The same qualities as words, for a label that is heard rather than read.
 *
 * `°`, `ø7` and `+` are typography. A screen reader announces them as "degree
 * sign", "latin small letter o with stroke" or nothing at all, so a button
 * labelled `B°` is announced as something that is not a chord. Spelled out, the
 * same button says "B diminished".
 */
const SPOKEN_QUALITIES: Record<ChordQuality, string> = {
  major: 'major',
  minor: 'minor',
  diminished: 'diminished',
  augmented: 'augmented',
  major7: 'major seventh',
  dominant7: 'dominant seventh',
  minor7: 'minor seventh',
  minorMajor7: 'minor major seventh',
  halfDiminished7: 'half diminished seventh',
  diminished7: 'diminished seventh',
  augmented7: 'augmented seventh',
  augmentedMajor7: 'augmented major seventh',
  major6: 'sixth',
  minor6: 'minor sixth',
  add9: 'added ninth',
  minorAdd9: 'minor added ninth',
  // `chordName` prints `?` here, which is honest on screen and says nothing at
  // all aloud. The chord is real and only its name is missing, so the spoken
  // form says exactly that rather than dropping the button's identity.
  other: 'unnamed chord'
};

/** The seven numerals, in the case the figure table then chooses. */
const ROMAN_NUMERALS: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * The glyphs an accidental is written with, and they are the musical signs
 * rather than the letters `b` and `#`.
 *
 * `♭VII` beside `Bb Maj` does mix two conventions on one card, and it is the
 * right way round. A note name is `MusicTheoryService`'s to spell and its two
 * chromatic tables are ASCII; a numeral is this module's to write, and this
 * module already prefers `°` to `dim` and `ø7` to `m7b5` for the same reason.
 * `bVII` also reads as a chord on B, which is exactly the chord it is not.
 *
 * The app prints these glyphs elsewhere already - the circle of fifths labels a
 * wedge `3♭`, and two scales are named `Dorian ♭2` and `Mixolydian ♭6` - so
 * this is the existing convention rather than a new one.
 */
const FLAT_SIGN = '♭';
const SHARP_SIGN = '♯';

/**
 * The degree a slash numeral points at: `V/vi` tonicises the sixth.
 *
 * It carries no accidental of its own, because a secondary dominant tonicises a
 * *degree of the key* and the degrees of a key are diatonic by definition. It
 * carries a quality because the target's numeral has to be written in the key's
 * own terms - the sixth is `vi` in a major key and `VI` in a minor one, and a
 * numeral that said `V/vi` in C minor would be pointing at a chord the palette
 * does not offer.
 */
export interface RomanTarget {
  degree: number;
  quality: ChordQuality;
}

/**
 * The Roman numeral for a chord in a key: `I`, `ii`, `vii°`, `V7`, `♭VII`,
 * `V/vi`.
 *
 * This is the teaching content of the whole progression page, which is why it
 * is a function with a table behind it rather than a line of template. The
 * numeral says *where in the key* a chord sits and its case says *what kind of
 * chord* that turns out to be, and those two facts moving independently is the
 * thing the page exists to show: turn the circle of fifths and every numeral
 * holds while the chord names change underneath it.
 *
 * Case carries the third. Upper for a major third, lower for a minor one, so a
 * diminished chord is lower case with a `°` and an augmented chord is upper
 * case with a `+`. That rule - rather than a per-mode lookup - is what makes
 * the same table print major's I ii iii IV V vi vii° and natural minor's
 * i ii° III iv v VI VII, and print harmonic minor's III+ without anyone having
 * enumerated harmonic minor.
 *
 * ## The accidental, which the case cannot carry
 *
 * `alter` displaces the *root* and the case still describes the third, and
 * that split is the whole of the design doc's correction: `♭VII` in C major is
 * B flat **major**, where shifting the degree-6 stack down a semitone gives a B
 * flat diminished. The two halves of a borrowed chord's numeral come from two
 * different arguments here for exactly that reason, and a numeral that could
 * only take a quality could not write one at all.
 *
 * A double accidental is the sign twice rather than a third sign, which is what
 * `ALTER_MIN` and `ALTER_MAX` of -2 and 2 make reachable - and the palette
 * reaches it. The borrowed row prints `♭♭II` in Hungarian major and in Lydian
 * ♯2, `♭♭VI` in the enigmatic scale, and `♯♯vii°` in ultra locrian.
 *
 * ## The numerals are the mode's, not the parallel major's
 *
 * `degree` indexes the *current* scale, so `alter` measures displacement from
 * that scale's own degree rather than from a major scale on the same tonic. F
 * lydian's fourth is a B, so a B flat minor triad there is `♭iv` where standard
 * practice writes `iv`; E phrygian's seventh is a D, so a D major triad is `VII`
 * where standard practice writes `♭VII`.
 *
 * That is the same reading the diatonic row already uses - it prints phrygian's
 * second degree `II`, not `♭II` - so one reading throughout is worth more than
 * agreeing with convention in the modes where the two happen to coincide. It is
 * worth knowing when reading the design doc, whose correction table writes
 * `#iv-dim`: that table is describing a *bug* in major-relative terms, not
 * quoting a numeral this function prints.
 *
 * ## The slash, which names a function rather than a position
 *
 * `V/vi` is *the dominant of the sixth degree*, so with a target present the
 * `degree` argument is read against the target and not against the home key -
 * which is why all five of a major key's secondary dominants pass 4. The
 * accidental, if there is one, still belongs to the chord.
 *
 * **The figure is dropped on the left of a slash and kept on the right.** Every
 * secondary dominant this app builds is a dominant seventh, so a `7` there
 * would be on all five and tell a reader nothing the group's own heading does
 * not; the design doc writes all three of its examples `V/V`, `V/vi`, `V/IV`;
 * and the chord name beside the numeral reads `D7`, so the height is on screen
 * either way. The target keeps its figure because that one *is* carrying
 * information - which chord is being tonicised.
 *
 * This is the line to revisit if a later milestone adds secondary leading-tone
 * chords. `vii°7/V` needs its figure, and dropping it would turn a diminished
 * seventh into a numeral that reads as a dominant.
 *
 * ## What it does not know: how tall the chord is
 *
 * It takes a quality and not an extent, and `degreeQuality` names a ninth,
 * eleventh and thirteenth after their seventh. So a V9 arrives here as
 * `dominant7` and prints `V7`: the figure describes the quality, not the height
 * of the stack, and the + complexity button changes what a slot sounds without
 * changing what it is called.
 *
 * That is deliberate and it is the model's existing convention rather than a
 * new one - `ChordDegree.quality` stores `dominant7` for a ninth too - so the
 * numeral agrees with the field it was computed from.
 *
 * **Note for the chord palette, settled.** Its complexity readout prints
 * the extent in words, so a user who presses `+` twice reads "Complexity: 9th"
 * in that panel while the strip card beside it reads `V7`. The strip decided
 * not to print the height: its two lines are the numeral and the chord name,
 * and the panel that says "9th" is labelled "Complexity", a different question.
 *
 * **Settled at M2 Task 8: the height stays unnamed.** The alternative was to
 * give `ChordQuality` ninth, eleventh and thirteenth members, and two things
 * make that a much larger change than the `V9` label it buys:
 *
 *  - `QUALITY_INTERVALS` is read in both directions and rests on no two
 *    entries sharing a shape. A ninth admits `[0,4,7,10,14]`, `[0,4,7,10,13]`
 *    and `[0,4,7,10,15]` - the app's own chord table lists all three - and the
 *    invariant would have to hold across the eleventh and thirteenth variants
 *    of each.
 *  - The three tables here are keyed exhaustively on `ChordQuality`, so every
 *    new member needs a numeral figure, a printed suffix and a spoken phrase:
 *    typographic decisions, made to serve an arithmetic problem.
 *
 * **And a third consideration cuts the other way, so it is stated as a cost of
 * deferring rather than a reason for it.** An earlier version of this note
 * claimed a `dominant9` override at extent 9 would build the same five notes a
 * `dominant7` override does, "because the ninth is diatonic either way". It does
 * not. `ChordDegree.quality` overrides the chord tones from the bottom up and
 * everything above the override stays diatonic, so the ninth comes from the
 * *key*: `V/vi` in C major raised to a ninth builds `E G♯ B D F` - a flat ninth
 * - where a real `dominant9` would build `E G♯ B D F♯`. The two disagree in
 * **812 of the 1015** (scale, degree, alter) combinations the app can reach.
 *
 * So the widening would buy genuinely unreachable chords rather than a
 * relabelling: a plain dominant ninth cannot be built at all today, on a chord
 * this feature offers. That makes it an M3 feature, recorded in the design doc
 * under "A real ninth chord is unreachable", and not a naming preference that
 * was dismissed.
 *
 * What deferring costs is therefore two things. One is a truncation, and a
 * truncation rather than a falsehood: a borrowed `♭VII` on a slot raised to a
 * ninth prints `♭VIImaj7` over a stack that really is a B flat major seventh
 * with the key's own ninth on top, and the palette's "Complexity: 9th" readout
 * states the height beside it. Truncated rather than wrong is the same rule as
 * unlabelled rather than mislabelled. The other is the harmony above: the
 * extensions a user gets are the key's, and there is no way to ask for any
 * others.
 *
 * ## And the two things it refuses
 *
 * A degree outside 0-6 throws, on exactly the argument `degreePitchClasses`
 * makes for the same guard: the index would read `undefined` out of the table
 * and the button would print the string `undefinedmaj7` rather than fail.
 *
 * A fractional accidental throws for the same kind of reason. `repeat` takes
 * the floor of its argument, so half a flat would render as no flat at all -
 * a `VII` where a `♭VII` was asked for, which is a different chord printed
 * silently rather than a failure.
 */
export function romanNumeral(
  degree: number,
  alter: number,
  quality: ChordQuality,
  of?: RomanTarget
): string {
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(`A Roman numeral needs a scale degree from 0 to 6; got ${degree}`);
  }
  if (!Number.isInteger(alter)) {
    throw new Error(
      `A Roman numeral's accidental must be a whole number of semitones; got ${alter}`
    );
  }

  const figure = NUMERAL_FIGURES[quality];
  const roman = ROMAN_NUMERALS[degree];
  const numeral =
    accidental(alter) + (figure.lowerCase ? roman.toLowerCase() : roman);

  // The figure is the target's rather than this chord's once there is a slash.
  // See the note above for why the left-hand one is dropped.
  return of === undefined
    ? numeral + figure.suffix
    : `${numeral}/${romanNumeral(of.degree, 0, of.quality)}`;
}

/** `-1` -> `♭`, `2` -> `♯♯`, `0` -> nothing at all. */
function accidental(alter: number): string {
  return (alter < 0 ? FLAT_SIGN : SHARP_SIGN).repeat(Math.abs(alter));
}

/**
 * The concrete chord name beside the numeral: `C Maj`, `A min`, `B°`, `G7`.
 *
 * The root arrives already spelled, because how a pitch class is spelled is
 * `MusicTheoryService`'s app-wide decision and not this module's - the same
 * separation that keeps every other function here relative to a tonic it is
 * never told the name of.
 *
 * The separator is a rule rather than a column in the table: a suffix that
 * begins with a letter is a word and takes a space, and one that begins with a
 * symbol or a digit is a figure and closes up. That gives `C Maj7` and `G7`,
 * which is how each is written, from one line instead of thirteen decisions.
 */
export function chordName(root: string, quality: ChordQuality): string {
  const suffix = CHORD_SUFFIXES[quality];
  return /^[A-Za-z]/.test(suffix) ? `${root} ${suffix}` : `${root}${suffix}`;
}

/**
 * The same chord as a phrase to be read aloud: `E flat major`, `B diminished`.
 *
 * For `aria-label`, where `chordName`'s output is not a name but a rendering of
 * one. Two things go wrong when a chord symbol is announced instead of read:
 * the suffix is punctuation - `B°` is "B degree sign" - and the accidental is a
 * letter, so `Eb` is "E b" and `A#` is "A hash" or "A number sign" depending on
 * the reader. Both are fixed here rather than at the call site, so that a
 * component that wants a spoken label cannot get half of one.
 *
 * The root arrives spelled, as `chordName`'s does and for the same reason: how
 * a pitch class is spelled is a decision this module is never party to.
 */
export function spokenChordName(root: string, quality: ChordQuality): string {
  return `${spokenRoot(root)} ${SPOKEN_QUALITIES[quality]}`;
}

/**
 * `Eb` -> `E flat`, `A#` -> `A sharp`, `Ebb` -> `E double flat`, `C` -> `C`.
 *
 * The doubles are not decoration. Degree-letter spelling makes them reachable
 * on a root for the first time - D♭ major's `♭II` is an E double flat, G♯
 * minor's `♯vii°` an F double sharp - and read as a bare accidental *count* a
 * screen reader gets `E b b`, which is worse than the single case it already
 * mishandled. Said as "double flat" it is what a musician would call it.
 *
 * The accidental is read off the second character and the count off the length,
 * because `formatNote` writes one sign repeated and never mixes them.
 */
function spokenRoot(root: string): string {
  if (root.length < 2) return root;

  const sign = root[1] === '#' ? 'sharp' : 'flat';
  return `${root[0]} ${root.length > 2 ? 'double ' : ''}${sign}`;
}
