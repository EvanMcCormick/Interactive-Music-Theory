import type { ChordExtent, ChordIdentity, ChordQuality } from './progression-harmony';

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
 * They were one file until it passed the project's file-length cap, which stood
 * at 500 lines then and stands at 1000 now - `fda93c1`, which argues that a cap
 * counting prose was measuring the wrong thing in a codebase this documented.
 * The raise does not un-split them, because the seam is the one above rather
 * than a line count, and both halves have grown into it since: M2 Task 8 widened
 * this one with the numeral's accidental, and M3 Task 5 widened it again with
 * every composed figure below.
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
 * How a chord's *height* is written, once a name can carry one.
 *
 * The three tables above hold **base shapes**, exactly as `QUALITY_INTERVALS`
 * does, and a composed figure is a base plus three small rules: the height, the
 * altered extensions, and the suspension. That split is what stops the tables
 * multiplying - a flat list of named extended chords would need a row per
 * combination in each of the three conventions, and the combinations are what a
 * user makes up as they go.
 *
 * The height is written into the base's own figure by **replacing its seventh**,
 * which is why there is no fourth table: `maj7` becomes `maj13`, `min7` becomes
 * `min11`, `minMaj7` becomes `minMaj9`, and `major seventh` becomes `major
 * thirteenth`. Every seventh figure this module writes names its seventh exactly
 * once, so the substitution is total rather than a best effort - and at height 7
 * it is the identity, which is what keeps every existing figure exactly as it
 * was.
 *
 * A triad has no height to write, so its entry is empty and the substitution is
 * skipped: nothing in a triad's figure is a seventh to replace.
 *
 * ## Which bases take a height, and the answer is every one that names a seventh
 *
 * Including the four whose figure carries a sign: `°7` becomes `°13`, `ø7`
 * becomes `ø11`, `+7` becomes `+13` and `+Maj7` becomes `+Maj9`, on exactly the
 * substitution `maj7` and `min7` get. That is the *opposite* answer
 * `SUSPENDED_FIGURES` gives the same signs twenty lines below, and the two are
 * different questions rather than one question answered twice:
 *
 *  - A **suspension** asks the symbol to describe a *changed third*, and `°`,
 *    `ø` and `+` describe the fifth as well as the third. Dropping the sign
 *    would lose the fifth and keeping it would print `C°sus4`, a symbol no chart
 *    uses - so there is nothing to print and the figure refuses.
 *  - A **height** changes no note the sign describes. It stacks further thirds
 *    *above* a shape the sign already names, so the sign goes on saying exactly
 *    what it said and only the topmost figure moves.
 *
 * The reach was measured rather than assumed, and it is not a corner. Over the
 * app's 33 heptatonic scales, with nothing pinned and no override at all, **130
 * chords print one of these raised** - and among them is C major's own `vii`,
 * three steps of the complexity control from a fresh slot, which prints
 * `viiø11♭9` beside `Bø11b9`. That is the one a reader meets first: the default
 * key, no borrowing, no pinning. Refusing it would put a `?` there, and `ø11♭9`
 * is a symbol a reader can decode where `?` is nothing to decode. It is also
 * more honest than what this module printed before M3 Task 5, which was `ø7`
 * over six sounding notes.
 *
 * With overrides it reaches `C+13`, `C°13` and `Cø13#9#11`, which are stranger
 * and are named on the same terms: this module names what was actually built,
 * and refuses only where no symbol exists at all. `progression-chord-names.spec.ts`
 * counts the 130 so the ruling stays visible whether or not it is ever revisited.
 */
const SEVENTH_FIGURE = '7';
const SPOKEN_SEVENTH = 'seventh';

const HEIGHT_FIGURES: Readonly<Record<ChordExtent, string>> = {
  3: '',
  7: '7',
  9: '9',
  11: '11',
  13: '13'
};

const SPOKEN_HEIGHTS: Readonly<Record<ChordExtent, string>> = {
  3: '',
  7: 'seventh',
  9: 'ninth',
  11: 'eleventh',
  13: 'thirteenth'
};

/** The three extensions, as the figure and the word each is written with. */
const EXTENSION_FIGURES: readonly string[] = ['9', '11', '13'];
const SPOKEN_EXTENSIONS: readonly string[] = ['nine', 'eleven', 'thirteen'];

/**
 * What a suspension adds, and it goes **last** in all three conventions.
 *
 * `V7♭9sus4` rather than `V7sus4♭9`: the suffix is read as a chord's shape
 * followed by what was done to it, and the suspension is the one alteration
 * that changes which chord tone is missing rather than where one sits.
 */
const SUSPENSION_FIGURES: Readonly<Record<'sus2' | 'sus4', { figure: string; spoken: string }>> = {
  sus2: { figure: 'sus2', spoken: 'suspended second' },
  sus4: { figure: 'sus4', spoken: 'suspended fourth' }
};

/**
 * What a base is written as **once its third has been suspended away**, for the
 * six bases where that is a chord anyone writes a symbol for.
 *
 * A suspension replaces the third, so the part of a figure describing the third
 * goes with it and the height stays. That is why `dominant7` and `minor7` share
 * a row: with no third there is no difference between them, and `C7sus4` is what
 * both are printed as. `major7` and `minorMajor7` share one for the same reason.
 *
 * **The four bases not here refuse, and the refusal is the point.** `°` and `+`
 * describe the *fifth* as well as the third, and a suspension leaves the fifth
 * where it is - so dropping the sign would lose the flat fifth, and keeping it
 * would print `C°sus4`, which is not a symbol any chart uses. The added-tone
 * shapes refuse on the same terms: `C6sus4` is occasionally written but
 * `Cadd9sus4` is not, and a rule that named half of them would be choosing which
 * unconventional symbol to invent. `?` says the chord is real and its name is
 * not, which is what this module does everywhere else.
 *
 * Three of those four bases take a *height* rather than refusing it, and the
 * ruling for why the same signs answer the two questions differently is on
 * `SEVENTH_FIGURE` above.
 *
 * The numeral keeps the base's own **case** even though the third it describes
 * is gone. A numeral says where in the key a chord sits, and `V7sus4` is the
 * dominant suspended - it is the chord being suspended that the case names, and
 * the `sus` figure beside it already says the third is displaced.
 */
interface SuspendedFigure {
  numeral: string;
  symbol: string;
  spoken: string;
}

const SUSPENDED_FIGURES: Readonly<Partial<Record<ChordQuality, SuspendedFigure>>> = {
  major: { numeral: '', symbol: '', spoken: '' },
  minor: { numeral: '', symbol: '', spoken: '' },
  dominant7: { numeral: '7', symbol: '7', spoken: 'dominant seventh' },
  minor7: { numeral: '7', symbol: '7', spoken: 'dominant seventh' },
  major7: { numeral: 'maj7', symbol: 'Maj7', spoken: 'major seventh' },
  minorMajor7: { numeral: 'maj7', symbol: 'Maj7', spoken: 'major seventh' }
};

/**
 * A sixth chord with an unaltered ninth over it, which is written `6/9` and not
 * as any composition of a `6` with a `9`.
 *
 * The one combination in this module that is a name in its own right rather than
 * a base plus a rule, and it earns the exception by being what a chart prints:
 * `C6/9` is a standard symbol and `C6add9` is not.
 */
const SIX_NINE_FIGURES: Readonly<Partial<Record<ChordQuality, SuspendedFigure>>> = {
  major6: { numeral: '6/9', symbol: '6/9', spoken: 'six nine' },
  minor6: { numeral: '6/9', symbol: 'min6/9', spoken: 'minor six nine' }
};

/** The four shapes whose fourth note is a sixth or a ninth rather than a seventh. */
const ADDED_TONE_BASES: readonly ChordQuality[] = ['major6', 'minor6', 'add9', 'minorAdd9'];

/** A base figure resolved at the height it stands, in all three conventions. */
interface ComposedFigure {
  lowerCase: boolean;
  /** The numeral's suffix: `maj13♯11`, `7sus4`, `6/9`. */
  numeral: string;
  /** The chord symbol's suffix: `Maj13#11`, `7sus4`, `6/9`. */
  symbol: string;
  /** Whether that suffix is a word and takes a space. See `chordName`. */
  spaced: boolean;
  /** The whole quality as words: `major thirteenth sharp eleven`. */
  spoken: string;
}

/** The refusal, in all three conventions at once. */
const UNNAMEABLE: ComposedFigure = {
  lowerCase: NUMERAL_FIGURES.other.lowerCase,
  numeral: NUMERAL_FIGURES.other.suffix,
  symbol: CHORD_SUFFIXES.other,
  spaced: false,
  spoken: SPOKEN_QUALITIES.other
};

/**
 * The whole of a chord's figure, composed from what it is.
 *
 * One function for all three renderers, so a numeral, a printed name and a
 * spoken label can differ in convention and never in *content*: the three
 * strings below are made in one pass off one identity, which is the property
 * `effectiveChord` exists to give them.
 *
 * Three rules, in this order, and the order is the convention:
 *
 *  1. **The height is the highest unaltered extension present**, or the base's
 *     own height when none is. So a V with a natural ninth is `V9`, and a V with
 *     a flattened one is `V7♭9` - the flat nine cannot be the height, because
 *     `V9` would say it was natural.
 *  2. **The altered extensions follow it, ascending.** `V7♭9♯11` rather than
 *     `V7♯11♭9`, which is how a chart lists them.
 *  3. **The suspension goes last.** See `SUSPENSION_FIGURES`.
 *
 * And one refusal, which is `?` in all three: a base of `'other'`, a suspension
 * over a base no suspended symbol exists for, or an added-tone shape carried
 * past the heights it has a name at. Each is argued where its table is.
 */
function composeFigure(chord: ChordIdentity): ComposedFigure {
  const base = baseFigure(chord);
  if (base === null) return UNNAMEABLE;

  const altered = alteredExtensions(chord);
  const suspension =
    chord.suspension === 'none' ? null : SUSPENSION_FIGURES[chord.suspension];

  return {
    lowerCase: base.lowerCase,
    numeral:
      base.numeral + altered.map(one => one.numeral).join('') + (suspension?.figure ?? ''),
    symbol:
      base.symbol + altered.map(one => one.symbol).join('') + (suspension?.figure ?? ''),
    // Read off the *base*, not off the whole suffix, which is the same rule as
    // before at one remove: a suffix is spaced because it opens with a word, and
    // an alteration or a `sus` is never the opening. A suspended triad has no
    // base figure at all and closes up, which is what gives `Csus2` rather than
    // the `C sus2` a test of the first character would have produced.
    spaced: /^[A-Za-z]/.test(base.symbol),
    spoken: [base.spoken, ...altered.map(one => one.spoken), suspension?.spoken]
      .filter(part => part !== undefined && part !== '')
      .join(' ')
  };
}

/**
 * The height a chord's figure names: the highest extension present whose
 * alteration is nothing.
 *
 * An altered extension cannot be the height because the height figure asserts it
 * is natural, and a lower unaltered one still can be - `Imaj13♯11` names a
 * thirteenth over a sharpened eleventh, because the thirteenth itself is where
 * the key put it.
 */
function heightOf(chord: ChordIdentity): ChordExtent {
  if (chord.thirteenth === 0) return 13;
  if (chord.eleventh === 0) return 11;
  if (chord.ninth === 0) return 9;
  // Four notes is a seventh or an added tone; three is a triad, which has no
  // height figure to write.
  return chord.intervals.length >= 4 ? 7 : 3;
}

/**
 * Whether this chord has a name at all, in any of the three conventions.
 *
 * The same refusal `composeFigure` makes, asked *before* it is printed rather
 * than read back off the `?` it prints: a base of `'other'`, a suspension over a
 * base no suspended symbol exists for, or an added-tone shape carried past the
 * heights it has a name at. All three are `baseFigure` answering null, so this is
 * that call and not a second statement of the rule - a second one would drift,
 * and the drift would be a caller believing a chord nameable that this module
 * then writes `?` for.
 *
 * Exported for the relabel chip, whose menu is a menu of **names**. Printing `?`
 * on a card is the honest refusal the whole strip is built on - unlabelled rather
 * than mislabelled - and nothing here changes that. Offering that same refusal as
 * a menu item is a different act, because an item invites the user to choose it,
 * and *Label as G unnamed chord* is not a choice anyone can make. See
 * `buildAlternates` in `relabel-chip-view.ts`, which is the only caller.
 */
export function isNameable(chord: ChordIdentity): boolean {
  return baseFigure(chord) !== null;
}

/** The base's own figure at the height it stands, or null when it has none. */
function baseFigure(chord: ChordIdentity): ComposedFigure | null {
  if (chord.base === 'other') return null;

  const numeral = NUMERAL_FIGURES[chord.base];
  const height = heightOf(chord);

  if (chord.suspension !== 'none') {
    const suspended = SUSPENDED_FIGURES[chord.base];
    if (suspended === undefined) return null;
    return figureAt(numeral.lowerCase, suspended, height);
  }

  if (ADDED_TONE_BASES.includes(chord.base)) return addedToneFigure(chord);

  return figureAt(
    numeral.lowerCase,
    {
      numeral: numeral.suffix,
      symbol: CHORD_SUFFIXES[chord.base],
      spoken: SPOKEN_QUALITIES[chord.base]
    },
    height
  );
}

/**
 * An added-tone shape's figure, which exists at two heights and no others.
 *
 * `C6` and `Cadd9` at their own height; `C6/9` where a sixth carries an
 * unaltered ninth. `Cadd9` keeps its own figure at a ninth's height too, because
 * the stack's ninth is the added ninth an octave up - the same pitch class, so
 * the chord is the one the figure already names.
 *
 * Everything else refuses. A sixth with an eleventh or a thirteenth over it, or
 * with a flattened ninth, is a real chord with no conventional symbol: `C6/9/11`
 * and `C6♭9` are not written, and truncating to `C6/9` would be silent about a
 * note that is sounding - which is the mislabelling this whole layer exists to
 * stop. `?` says the chord is real and unnamed.
 */
function addedToneFigure(chord: ChordIdentity): ComposedFigure | null {
  if (chord.eleventh !== null || chord.thirteenth !== null) return null;
  if (chord.ninth !== null && chord.ninth !== 0) return null;

  const numeral = NUMERAL_FIGURES[chord.base];
  const sixNine = chord.ninth === 0 ? SIX_NINE_FIGURES[chord.base] : undefined;

  return figureAt(
    numeral.lowerCase,
    sixNine ?? {
      numeral: numeral.suffix,
      symbol: CHORD_SUFFIXES[chord.base],
      spoken: SPOKEN_QUALITIES[chord.base]
    },
    // An added-tone figure never takes a height: its own note is the fourth one,
    // and the only extension it admits is folded into `6/9` above.
    7
  );
}

/** One base figure with its seventh raised to the chord's height. */
function figureAt(
  lowerCase: boolean,
  figure: SuspendedFigure,
  height: ChordExtent
): ComposedFigure {
  return {
    lowerCase,
    numeral: raise(figure.numeral, SEVENTH_FIGURE, HEIGHT_FIGURES[height]),
    symbol: raise(figure.symbol, SEVENTH_FIGURE, HEIGHT_FIGURES[height]),
    spaced: false,
    spoken: raise(figure.spoken, SPOKEN_SEVENTH, SPOKEN_HEIGHTS[height])
  };
}

/**
 * Replaces the last `seventh` in a figure with the chord's own height.
 *
 * The last rather than the first, for `minMaj7`, where the `7` is the last
 * character but not the last token; and a no-op at a triad's height and a
 * seventh's, where there is nothing to raise and a substitution would strip a
 * figure that never named a height at all.
 */
function raise(figure: string, seventh: string, height: string): string {
  if (height === '' || height === seventh) return figure;

  const at = figure.lastIndexOf(seventh);
  return at < 0 ? figure : figure.slice(0, at) + height + figure.slice(at + seventh.length);
}

/** Each altered extension present, ascending, in all three conventions. */
function alteredExtensions(chord: ChordIdentity): SuspendedFigure[] {
  const figures: SuspendedFigure[] = [];

  [chord.ninth, chord.eleventh, chord.thirteenth].forEach((alteration, i) => {
    if (alteration === null || alteration === 0) return;

    const raised = alteration > 0;
    figures.push({
      numeral: (raised ? SHARP_SIGN : FLAT_SIGN) + EXTENSION_FIGURES[i],
      symbol: (raised ? '#' : 'b') + EXTENSION_FIGURES[i],
      spoken: `${raised ? 'sharp' : 'flat'} ${SPOKEN_EXTENSIONS[i]}`
    });
  });

  return figures;
}

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
 * ## How tall the chord is, which it used to have no way of knowing
 *
 * It took a `ChordQuality` until M3 Task 5, and a quality names a ninth,
 * eleventh and thirteenth after their seventh - so a V9 arrived here as
 * `dominant7` and printed `V7`. That was recorded as deliberate, and it was: the
 * alternative on the table at M2 was to give `ChordQuality` ninth, eleventh and
 * thirteenth members, and the invariant `QUALITY_INTERVALS` is read in both
 * directions under would have had to hold across every altered variant of each -
 * `[0,4,7,10,14]`, `[0,4,7,10,13]` and `[0,4,7,10,15]` are all ninths, and the
 * app's own chord table lists all three.
 *
 * It takes a `ChordIdentity` now, and the widening that was rejected is still
 * rejected: the table stays base shapes only and the height is a *rule* applied
 * to a base figure rather than a row of its own. So `V9`, `V7♭9`, `Imaj13♯11`
 * and `V7sus4` are all written without one new entry in any of the three tables,
 * and "no two entries share a shape" is as true as it was.
 *
 * **The strip's argument against printing the height is settled by the same
 * change.** That argument was that `V9` over a chord name reading `G7` would be
 * worse than `V7` over `G7`: two conventions on one card, disagreeing. Both
 * lines now come from one identity through one `composeFigure`, so they agree at
 * every height by construction, and the card can print the height because there
 * is nothing left for it to disagree with. `progression-strip-cards.ts` carries
 * the same note from the other end.
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
  chord: ChordIdentity,
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

  const figure = composeFigure(chord);
  const roman = ROMAN_NUMERALS[degree];
  const numeral =
    accidental(alter) + (figure.lowerCase ? roman.toLowerCase() : roman);

  // The figure is the target's rather than this chord's once there is a slash.
  // See the note above for why the left-hand one is dropped.
  return of === undefined ? numeral + figure.numeral : `${numeral}/${targetNumeral(of)}`;
}

/**
 * The numeral on the right of a slash, which is a plain triad by construction.
 *
 * Written from `NUMERAL_FIGURES` directly rather than by recursing with an
 * identity built for the target: a `RomanTarget` is a *degree of the key* and
 * the key's degrees are diatonic, so `secondary()` filters them to major and
 * minor triads before ever getting here. Building a whole identity to render
 * three characters would mean this module could ask for a chord to be built,
 * which is the dependency direction its header rules out.
 */
function targetNumeral(of: RomanTarget): string {
  if (!Number.isInteger(of.degree) || of.degree < 0 || of.degree > 6) {
    throw new Error(`A Roman numeral needs a scale degree from 0 to 6; got ${of.degree}`);
  }

  const figure = NUMERAL_FIGURES[of.quality];
  const roman = ROMAN_NUMERALS[of.degree];

  return (figure.lowerCase ? roman.toLowerCase() : roman) + figure.suffix;
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
 * The rule is now read off the *base* of a composed suffix rather than off its
 * first character - see `composeFigure`, which is where the two part company.
 */
export function chordName(root: string, chord: ChordIdentity): string {
  const figure = composeFigure(chord);
  return figure.spaced ? `${root} ${figure.symbol}` : `${root}${figure.symbol}`;
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
export function spokenChordName(root: string, chord: ChordIdentity): string {
  return `${spokenRoot(root)} ${composeFigure(chord).spoken}`;
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
