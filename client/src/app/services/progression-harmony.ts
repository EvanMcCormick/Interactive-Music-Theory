/**
 * Diatonic chords built by stacking thirds through a scale.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent, so the arithmetic can be checked directly against hand-written
 * chord tables.
 *
 * Everything here is relative to the tonic: a I chord is [0, 4, 7] in every
 * key. Applying the tonic is the caller's job, which keeps transposition a
 * single addition rather than a rule spread through the module.
 *
 * Quality is derived from the intervals the stack happens to produce rather
 * than looked up per mode. That is why one short table gives the major scale
 * I ii iii IV V vi vii-dim and natural minor i ii-dim III iv v VI VII, and why
 * an unusual scale - harmonic minor, say - yields its augmented III without
 * anyone having to enumerate it. `QUALITY_INTERVALS` is that table, and it is
 * read in both directions: `chordPitchClasses` builds a chord from a quality
 * where `qualityOfIntervals` reads a quality off a chord.
 */

/**
 * Every name is also a chord id in `music-theory.service.ts`, and the rules in
 * `degreeQuality` produce no name that is not in this list. That correspondence
 * is load-bearing: the fretboard is lit by handing the quality straight to
 * `selectKeyAndMode` as a chord id, so a quality with no matching chord would
 * light nothing, and `'other'` is the honest answer for a stack of thirds that
 * is not a named chord at all.
 */
export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'major7' | 'minor7' | 'dominant7' | 'minorMajor7'
  | 'halfDiminished7' | 'diminished7' | 'augmented7' | 'augmentedMajor7'
  | 'other';

/**
 * `ChordQuality` minus `'other'`, which is a refusal rather than a name - the
 * answer for a stack of thirds that is no named chord - so it has no interval
 * set and cannot be an override. Splitting it off keys `QUALITY_INTERVALS`
 * exhaustively on the qualities that *do* name intervals, so a quality added to
 * the union above cannot compile until its intervals are written down.
 */
export type NamedQuality = Exclude<ChordQuality, 'other'>;

/** Stacked-third extent. 3 is a triad; 7, 9, 11, 13 add one third each. */
export type ChordExtent = 3 | 7 | 9 | 11 | 13;

/**
 * Whether thirds can be stacked through this scale at all.
 *
 * Exported so a caller that would rather explain itself than fail can ask
 * first, instead of calling and catching. The rule lives here so the guard
 * below and the palette that renders the explanation cannot drift apart.
 */
export function isHeptatonic(scaleIntervals: readonly number[]): boolean {
  return scaleIntervals.length === 7;
}

/** Notes in a chord of the given extent. 3 -> 3 notes, 7 -> 4, 9 -> 5. */
export function noteCount(extent: ChordExtent): number {
  // Chords are named after their topmost interval, and every other scale degree
  // below it is in the stack, so a chord topping out at `n` has (n + 1) / 2
  // notes: 7 -> 4, 13 -> 7. The triad is the exception because 3 is not a
  // topmost interval in this encoding - a triad reaches a fifth - it is the
  // note count itself, so the formula has nothing to convert.
  return extent === 3 ? 3 : (extent + 1) / 2;
}

/**
 * Pitch classes of a diatonic chord, relative to the tonic, ascending.
 *
 * Not reduced mod 12: a chord that crosses the octave keeps climbing, so
 * [11, 14, 17] rather than [11, 2, 5]. Voicing needs the ascending order and
 * reducing here would throw it away.
 */
export function degreePitchClasses(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent
): number[] {
  // Stacking thirds only means anything when every other scale note is a third
  // away, which is to say in a seven-note scale. A pentatonic would silently
  // produce chords that are not thirds at all, so refuse rather than invent.
  if (!isHeptatonic(scaleIntervals)) {
    throw new Error(
      `Diatonic chords need a heptatonic scale; got ${scaleIntervals.length} notes`
    );
  }

  // The degree indexes the interval table directly, and JavaScript reads a bad
  // index as `undefined` rather than complaining, so the arithmetic below turns
  // -1 or 1.5 into NaN and `degreeQuality` reports the result as 'other' - a
  // refusal that looks like an answer. 7 is worse still: it wraps to the tonic
  // an octave up and returns a perfectly plausible wrong chord. Refuse all
  // three here, on the same principle as the scale check above.
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(
      `Diatonic chords need a scale degree from 0 to 6; got ${degree}`
    );
  }

  const notes: number[] = [];
  for (let i = 0; i < noteCount(extent); i++) {
    // A third is two scale steps, and each wrap past the seventh degree is one
    // octave higher than the interval table describes.
    const step = degree + i * 2;
    const octaves = Math.floor(step / 7);
    notes.push(scaleIntervals[step % 7] + octaves * 12);
  }
  return notes;
}

/**
 * Intervals above the root for each nameable quality: the single table both
 * directions of the naming read.
 *
 * `degreeQuality` used to carry this as a chain of comparisons on the third,
 * the fifth and the seventh: the same table written the other way round, and
 * two writings of one table is the arrangement that drifts. M3's recogniser
 * runs the naming in both directions - build a chord from a quality, then read
 * a quality back off a set of notes - so a disagreement would surface as a
 * chord not matching the name it was built from, a long way from either table.
 * One table instead, read forwards by `qualityOfIntervals` and backwards by
 * `chordPitchClasses`.
 *
 * Triads name three intervals and sevenths four, and **every seventh opens
 * with the triad of the same name** - which is what lets `chordPitchClasses`
 * take a seventh only as far as a triad's height without producing some other
 * chord. The augmented pair earns its place there: harmonic minor's III+ carries
 * a major seventh and the Neapolitans put a minor seventh over the same
 * augmented triad, so without both the augmented triads this module already
 * finds would lose their name on extension.
 *
 * No two entries share a shape, which is what makes the reverse reading a
 * function rather than a first match.
 */
export const QUALITY_INTERVALS: Readonly<Record<NamedQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  major7: [0, 4, 7, 11],
  dominant7: [0, 4, 7, 10],
  minor7: [0, 3, 7, 10],
  minorMajor7: [0, 3, 7, 11],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  augmented7: [0, 4, 8, 10],
  augmentedMajor7: [0, 4, 8, 11]
};

/** The table above as a list, typed once so the lookup below need not cast. */
const NAMED_QUALITIES = Object.entries(QUALITY_INTERVALS) as [
  NamedQuality,
  readonly number[]
][];

/**
 * The name for a stack of notes, from its intervals above its own root.
 *
 * Takes the notes as `degreePitchClasses` returns them - ascending, not reduced
 * mod 12, rooted wherever the chord happens to sit - and reads the intervals
 * relative to the first, so a Bb chord written [10, 14, 17] is major on exactly
 * the terms [0, 4, 7] is. A stack four notes tall or more is named after its
 * seventh, the convention `ChordDegree.quality` already stores a ninth under;
 * below four, only the third and the fifth are read.
 *
 * `'other'` is the honest answer for a stack that is no named chord - degree 6
 * of the double harmonic scale stacks a second under a diminished fifth - and
 * it is a refusal rather than a name. That is why `chordPitchClasses` will not
 * take it back the other way as an override.
 */
export function qualityOfIntervals(notes: readonly number[]): ChordQuality {
  const root = notes[0];
  // Four is where the seventh table starts, and a taller stack is named after
  // its seventh - so everything above the fourth note is dropped rather than
  // compared against a table that has no entry that tall.
  const width = notes.length >= 4 ? 4 : 3;
  const shape = notes.slice(0, width).map(note => note - root);

  for (const [quality, intervals] of NAMED_QUALITIES) {
    if (
      intervals.length === shape.length &&
      intervals.every((interval, i) => interval === shape[i])
    ) {
      return quality;
    }
  }
  return 'other';
}

/** Quality of the diatonic chord on `degree`: the stack first, then the name. */
export function degreeQuality(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent
): ChordQuality {
  return qualityOfIntervals(degreePitchClasses(scaleIntervals, degree, extent));
}

/**
 * The quality a slot is *named* by: its override, or the one the key gives that
 * degree.
 *
 * `null` means "as the key gives it", so every reader wanting a name rather
 * than an override has this same line to write - and writing it twice is how
 * two parts of one screen come to disagree about one chord. The strip's card
 * and the fretboard selection are the two that want it today. It is the naming
 * counterpart of `chordPitchClasses`, which resolves the same `null` into the
 * same diatonic answer one axis over, in pitches rather than in words.
 */
export function effectiveQuality(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent,
  quality: ChordQuality | null
): ChordQuality {
  return quality ?? degreeQuality(scaleIntervals, degree, extent);
}

/**
 * Pitch classes of the chord a slot names: the diatonic stack, with its root
 * displaced by `alter` and its shape overridden by `quality`.
 *
 * This is the correction the design doc records under "`alter` cannot express a
 * borrowed chord". `alter` moves the root alone and the quality carries the
 * shape - what a Roman numeral's accidental does, and what shifting the whole
 * stack could not, that being transposition and transposition preserving
 * quality. So bVII came out diminished, bVI, bIII and the Neapolitan bII came
 * out minor, and #iv-dim came out major: every conventional altered numeral
 * wrong in shape on a root that was always right.
 *
 * `quality === null` means "as the key gives it" and hands back the diatonic
 * stack untouched. A non-null quality replaces the chord tones from the bottom
 * up, for as many intervals as it names.
 *
 * ## Two refusals
 *
 * **A chromatic root with no shape to build throws.** `alter !== 0` under a
 * null quality has no diatonic chord to inherit a shape from, and letting it
 * fall through to a whole-stack shift is exactly the failure above. It is a
 * value of the wrong kind rather than a control at its limit - the first clause
 * of the normalisation rule in `progression-normalize.ts` - and it is checked
 * here rather than among those guards because neither field is wrong alone:
 * `alter` is a bounded integer, `null` is the quality every fresh slot carries,
 * and only the pair names nothing. Every UI path supplies both together.
 *
 * **`'other'` cannot be an override.** It names no interval set, so there is
 * nothing to build from: it is `qualityOfIntervals`' refusal rather than a
 * name, and reading a refusal back as an instruction would mean inventing a
 * shape for a chord that has none.
 *
 * The scale and the degree stay `degreePitchClasses`' to refuse, and its throws
 * are allowed through rather than repeated here.
 *
 * ## The extent decides the note count, in both directions
 *
 * A quality naming **fewer** intervals than the extent asks for leaves the rest
 * diatonic, so a bVII9 is Bb-D-F over the ninth the key already gave that
 * degree. That is design decision 2, taken over refusing overrides above extent
 * 7 because refusing would make the complexity stepper fail on exactly the
 * borrowed chords a user most wants to extend.
 *
 * A quality naming **more** intervals than the extent asks for - a seventh
 * chosen while the slot is still a triad - is taken only as far as the extent
 * goes. `noteCount(extent)` is what `normalizeInversion` wraps an inversion
 * against and what the complexity readout prints, so a chord taller than its
 * own extent would put both out of step with what is sounding. Nothing musical
 * is lost, because every seventh in `QUALITY_INTERVALS` opens with the triad of
 * the same name: the seventh is dropped and that quality's chord is left.
 */
export function chordPitchClasses(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent,
  alter: number,
  quality: ChordQuality | null
): number[] {
  const diatonic = degreePitchClasses(scaleIntervals, degree, extent);

  if (quality === null) {
    if (alter !== 0) {
      throw new Error(
        `A chromatic root needs an explicit quality to build from; ` +
          `got alter ${alter} with no quality`
      );
    }
    return diatonic;
  }

  if (quality === 'other') {
    throw new Error(
      `'other' names no interval set and cannot override a chord's shape`
    );
  }

  const shape = QUALITY_INTERVALS[quality];
  const root = diatonic[0] + alter;
  // Mapped over the diatonic stack rather than concatenated onto the shape,
  // which is what keeps the count the extent's in both directions: the shape is
  // read while it lasts, and every position past it keeps the scale's own note.
  return diatonic.map((note, i) => (i < shape.length ? root + shape[i] : note));
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * How a quality is written, in the three places a chord is written at all.
 *
 * All three tables live beside `ChordQuality` rather than in the palette that
 * prints them, and beside each other rather than one per module, for one
 * reason: they are keyed exhaustively on the union declared above, so adding a
 * quality cannot compile until every way of writing it has been decided. A
 * table in a component would be as correct today and would not have that
 * property - the next quality would reach the screen as `undefined`.
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
  // `chordName` prints `?` here, which is honest on screen and says nothing at
  // all aloud. The chord is real and only its name is missing, so the spoken
  // form says exactly that rather than dropping the button's identity.
  other: 'unnamed chord'
};

/** The seven numerals, in the case the tables above then choose. */
const ROMAN_NUMERALS: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * The Roman numeral for a diatonic chord: `I`, `ii`, `vii°`, `V7`.
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
 * **And the M2 fix is bigger than this signature.** Widening it to take the
 * extent, on its own, prints `V9` over a card whose name still reads `G7` -
 * `chordName` reads the same `quality` field and is blind to the height in the
 * same way, so the disagreement moves onto the card rather than off it. It
 * starts below both of them: `ChordQuality` has no ninth, eleventh or
 * thirteenth member for either function to name, and the three tables here are
 * keyed by it. M2 has to widen the type, or widen both functions together.
 *
 * ## And the one thing it refuses
 *
 * A degree outside 0-6 throws, on exactly the argument `degreePitchClasses`
 * makes for the same guard: the index would read `undefined` out of the table
 * and the button would print the string `undefinedmaj7` rather than fail.
 */
export function romanNumeral(degree: number, quality: ChordQuality): string {
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(`A Roman numeral needs a scale degree from 0 to 6; got ${degree}`);
  }

  const figure = NUMERAL_FIGURES[quality];
  const numeral = ROMAN_NUMERALS[degree];

  return (figure.lowerCase ? numeral.toLowerCase() : numeral) + figure.suffix;
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

/** `Eb` -> `E flat`, `A#` -> `A sharp`, `C` -> `C`. */
function spokenRoot(root: string): string {
  if (root.length < 2) return root;
  return root[0] + (root[1] === '#' ? ' sharp' : ' flat');
}
