import { ALTER_MAX, ALTER_MIN, createExtensions } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import {
  RomanTarget,
  chordName,
  romanNumeral,
  spokenChordName
} from './progression-chord-names';
import { chordRootName } from './progression-spelling';
import {
  ChordExtent,
  ChordQuality,
  NAMED_QUALITIES,
  NamedQuality,
  QUALITY_INTERVALS,
  degreeQuality,
  effectiveChord,
  isHeptatonic
} from './progression-harmony';

/**
 * The chords a key offers beyond its own seven: other shapes on the chord you
 * are on, chords borrowed from the parallel minor, and the dominants of the
 * degrees you could go to.
 *
 * Pure, with no Angular dependency, on the `progression-harmony.ts` precedent.
 * It is the layer above that one: harmony answers "what notes does this triple
 * make", this module answers "which triples are worth offering", and the
 * palette in Task 9 answers "how are they drawn".
 *
 * ## Why this exists at all
 *
 * `ChordDegree.quality` became an override in Task 2, which is the mechanism a
 * borrowed chord needs and which M1 emitted none of. Everything the palette
 * could reach was `quality: null` - the key's own chord on one of seven degrees
 * - so the field was machinery with no UI attached. These three groups are that
 * UI's data, and two of the three need a **chromatic root**, which is exactly
 * what the design doc's correction is about: `alter` displaces the root and the
 * quality carries the shape, so `♭VII` is *degree 6, alter -1, quality major*
 * and not the degree-6 stack shifted down a semitone.
 *
 * ## Everything is derived; nothing is a pitch class
 *
 * No group here is a table of "in C major, offer B flat". The borrowed set is
 * the parallel minor's own chords read through the current key's degrees, and
 * the secondary set is a rule about fifths. That is what makes the same code
 * right in D flat lydian and in Hungarian minor, and it is also what makes the
 * groups **shrink honestly**: a natural minor key already contains ♭III, ♭VI,
 * ♭VII and iv, so it is offered none of them.
 *
 * ## Every option is offered at its own height
 *
 * An option's extent is the one its quality names - a triad for a triad, a
 * seventh for a seventh - rather than whatever height the selected slot happens
 * to be at. Three things follow, and all three are the reason:
 *
 *  1. **"Turns V into V7" is a change of height**, and the design doc gives
 *     that as the alternates row's own example. A shape has a height.
 *  2. **The name is never a surprise.** `effectiveChord` reads a chord's name
 *     off the stack it builds, and at the height a quality itself names the
 *     answer is always that quality - swept over every scale, degree and
 *     `alter` the app can reach. So no button here can print `?`, and no two
 *     buttons can print the same name.
 *  3. **The alternative prints duplicates below and `?` above.** Offered at the
 *     slot's own extent, a seventh is cut back to its triad the moment the slot
 *     is one - and every fresh slot is. At extent 3 the sixteen qualities build
 *     **four** distinct chords, in all 1015 (scale, degree, alter) combinations
 *     the app can reach: `major`, `major7`, `dominant7`, `major6` and `add9` are
 *     one button's worth of chord, and so are the minor, the diminished and the
 *     augmented families. Twelve buttons in sixteen would duplicate another,
 *     always - it was nine in twelve before M3 Task 4 added the added-tone
 *     shapes, which land on their own triads too.
 *
 *     At extent 7 or higher the collapse is smaller - 609 of the 1015 still
 *     produce a duplicate - and a second failure replaces it: a triad quality
 *     there keeps the key's own seventh, and that stack often has no name, so
 *     2436 of the 12180 buttons would print `?`. The natural height is the one
 *     rule with neither.
 *
 *     Those two figures were measured over the original twelve qualities, and
 *     12180 is 1015 times twelve. M3 Task 4 made it sixteen, so both counts are
 *     now floors rather than totals - re-measuring them would sharpen a case
 *     against an alternative that was already rejected, which is why they are
 *     annotated rather than re-run.
 *
 *     What those two qualities do *not* do at extent 9 is coincide, and an
 *     earlier version of this note said they did. `major` and `major7` differ
 *     there in **812 of the 1015** combinations - on C major's V they give
 *     `G B D F` against `G B D F♯` - so "the seventh is diatonic anyway" was
 *     never the argument. It is recorded here because it is the kind of claim a
 *     reader would build on rather than re-derive.
 *
 * The cost is that clicking an option sets the slot's height as well as its
 * shape. That is what the complexity stepper is for, and it is beside the
 * palette.
 *
 * ## What it will not do
 *
 * A scale that cannot stack thirds comes back with three empty groups rather
 * than a throw. Borrowed chords are exactly as meaningless in a pentatonic key
 * as diatonic ones, and `ProgressionState.canBuildChords` is `isHeptatonic`
 * already applied to the same scale - so the palette refuses the whole panel
 * before it reaches here, and a caller that forgets gets an empty menu rather
 * than an exception three layers down. That is the same bargain `isHeptatonic`
 * is exported to offer.
 */

/** Which of the three rows an option came from. */
export type ChordOptionGroup = 'alternate' | 'borrowed' | 'secondary';

/**
 * One chord a user could put in a slot: what to store, and what to print.
 *
 * The first four fields are a `ChordDegree`'s worth of instruction - degree,
 * accidental, shape and height - and the rest is what the button says. Task 9
 * writes the first four into a slot and renders the rest.
 *
 * `quality` is not nullable, where the field it is written into is. `null`
 * means "as the key gives it", which is the *diatonic* row the palette already
 * draws; every option in every group here names a shape of its own, and two of
 * the three groups could not exist otherwise - a chromatic root with no shape
 * under it is the one combination `chordPitchClasses` throws on.
 */
export interface ChordOption {
  /** 0-6, indexing the key's scale, as `ChordDegree.degree` does. */
  degree: number;
  /** Semitones the root is displaced by. The numeral's accidental. */
  alter: number;
  quality: NamedQuality;
  /** The height this option's name is true at. See the note above. */
  extent: ChordExtent;
  /** `♭VII`, `V/V`, `iv`. */
  numeral: string;
  /** `Bb Maj`, `D7`. */
  name: string;
  /** The same chord as a phrase, for a label that is heard. `B flat major`. */
  spoken: string;
  group: ChordOptionGroup;
  /**
   * Whether this is the shape the selected slot already has: the button to mark
   * rather than the hole to leave.
   *
   * The alternates row offers every named quality precisely so the chosen one
   * has a place, and a place needs a mark. It is computed here rather than left
   * to the palette for the reason the numeral and the name are: the comparison
   * is not the obvious one, and a caller doing it by eye gets it wrong in the
   * commonest case of all.
   *
   * **The comparison is against the slot's shape, with `null` resolved.** A
   * fresh slot carries `quality: null`, meaning "as the key gives it", so
   * matching on the stored field alone marks nothing at all on the row a user
   * first opens - even though one of them builds exactly the chord that is
   * sounding. So a null quality is read as the key's own quality *at the slot's
   * own height*: a plain V slot marks `major` at extent 3 and `dominant7` at
   * extent 7, which is the chord it is playing in each case.
   *
   * **At most one option per group**, because within a group the three fields
   * compared are distinct: the alternates carry one distinct quality each, and
   * no two rows of `BORROWINGS` or two targets produce the same triple.
   *
   * Across groups two can be marked, and that is right rather than a leak. The
   * alternates row offers every named shape on the *selected* root, so whenever
   * the selection is itself a borrowed chord that chord appears in both rows -
   * select the `♭VI` of Lydian ♯2 and the borrowed `♭VI` and the alternates row's
   * `major` are the same chord, reached two ways. Marking one and not the other
   * would be picking a winner between two buttons that do the same thing.
   *
   * None is marked when no option names what the slot builds. A slot whose stack
   * no name fits resolves to `'other'`, which no option carries, so the row is
   * left unmarked rather than marked wrongly - the same rule the numeral's `?`
   * follows one layer down.
   */
  current: boolean;
}

/** The three groups, in the order the palette stacks them. */
export interface ChordVocabulary {
  /** Other shapes on the selected chord's own root. Empty with no selection. */
  alternates: readonly ChordOption[];
  borrowed: readonly ChordOption[];
  secondary: readonly ChordOption[];
}

/** A triad, which is the height every borrowed chord here is offered at. */
const TRIAD: ChordExtent = 3;

/** A seventh, which is the height every secondary dominant is offered at. */
const SEVENTH: ChordExtent = 7;

/** The tonic, which is the one degree no secondary tonicises. See `secondary`. */
const TONIC_DEGREE = 0;

/** Degree 5 of a key, zero-indexed: the `V` on the left of every slash. */
const DOMINANT_DEGREE = 4;

/**
 * The accidental on the left of a slash, which for a secondary dominant is
 * always none.
 *
 * `alter` is this chord's displacement *within the key*, and the numeral on the
 * left of a slash is not measured in the key at all - it is measured against the
 * target. A secondary dominant's root is a perfect fifth above its target's root
 * by construction, so relative to that target it is a plain `V` whatever `alter`
 * turned out to be, and passing `alter` there would print an accidental from the
 * wrong frame of reference.
 *
 * `alter` is zero for every target the filter admits today, so nothing shows;
 * the constant is here for the day that filter widens. Admit a diminished target
 * and C major offers a dominant of `vii°`: degree 3, alter +1, root F sharp -
 * where `alter` would print `♯V/vii°` for what is simply the dominant of the
 * seventh degree, `V/vii°`.
 *
 * This is not `romanNumeral` being handed something false. Its contract is that
 * the accidental belongs to the chord and survives on the left of a slash -
 * `♭II/V` is a real numeral, and `progression-chord-names.spec.ts` pins it - and
 * that is right for a chord altered *relative to its target*, which a secondary
 * dominant by definition never is. The zero is a fact about this call site, not
 * a correction to that one.
 */
const ALTER_AGAINST_TARGET = 0;

/** A fifth is four steps through a seven-note scale, and seven semitones. */
const STEPS_TO_A_FIFTH = 4;
const SEMITONES_IN_A_FIFTH = 7;

/** What a secondary dominant is, and the only shape this group offers. */
const SECONDARY_QUALITY: NamedQuality = 'dominant7';

/**
 * The parallel minor, which is where a major key's borrowed chords come from.
 *
 * These are `MusicTheoryService`'s own `aeolian` and `phrygian` intervals,
 * written out because this module is pure and has no business injecting a
 * service for reference data - the same trade `progression-harmony.spec.ts`
 * makes with its `MAJOR`. The spec checks them against the service's table, so
 * the copy cannot drift; and because the borrowed set is *derived* from them,
 * changing either array here changes every borrowed chord the palette offers.
 *
 * Phrygian is here for one chord. The Neapolitan's flattened second is
 * phrygian's, not aeolian's - aeolian's second is a whole tone up and carries a
 * diminished triad - and it is the one borrowing that is as much at home in a
 * minor key as in a major one.
 */
const PARALLEL_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 10];
const PARALLEL_PHRYGIAN: readonly number[] = [0, 1, 3, 5, 7, 8, 10];

/**
 * The parallel harmonic minor, which is where a *minor* key's two borrowings
 * come from.
 *
 * `MusicTheoryService`'s own `harmonicMinor`, on the same terms as the two above
 * and checked against the same table by the same spec. It is here for two
 * degrees and only two: its raised seventh is what makes its degree 4 a major
 * triad and its degree 6 a diminished one, which are the major dominant and the
 * leading-tone triad that a natural minor key has no other way to reach.
 */
const PARALLEL_HARMONIC_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 11];

/**
 * Which degrees are borrowed, and which parallel mode each is borrowed from.
 *
 * The five the design doc names - ♭II, ♭III, iv, ♭VI, ♭VII - plus the two a
 * minor key needs and nothing else offers, and this is the whole of what is
 * written down about them. The accidental is the distance between the source
 * mode's degree and the current key's, and the shape is the source mode's own
 * triad on that degree, so both fall out of the three arrays above rather than
 * being asserted here. A source is always a *parallel mode* and never a pitch
 * class, which is what makes the same seven rows right in D flat lydian and in
 * Hungarian minor.
 *
 * ## The two harmonic-minor rows, and why a minor key needed them
 *
 * The first five rows are borrowings a *major* key makes, and in a minor key the
 * "the key already has it" filter drops nearly all of them. That is correct -
 * ♭III, ♭VI, ♭VII and iv *are* natural minor's own chords, and relabelling them
 * as borrowings would say something false about the diatonic row. What it left
 * was a minor key offered one borrowed chord and no route at all to the two it
 * actually borrows most: **its major dominant** and **its raised leading-tone
 * triad**. C aeolian's diatonic row shows `v`, a G minor triad; G7 appeared
 * nowhere in the palette, and `♮vii°` nowhere either.
 *
 * The claim that the alternates row covers them does not hold. That row can only
 * re-shape a slot that already exists and is selected, so reaching a major V
 * needed a degree-4 slot to be there already - and the reason you want it is
 * that the `v` which would be in it is the chord you did not want. A chord you
 * cannot **append** is a chord this palette does not offer.
 *
 * Harmonic minor supplies both from one array and asserts neither. Its degree 4
 * stacks a major triad and its degree 6 a diminished one, so `degreeQuality`
 * reads them out as `V` (alter 0) and `♯vii°` (alter +1) in aeolian. In a major
 * key both are dropped by the same filter that drops the rest - ionian's own
 * degree 4 is already major and its degree 6 already diminished - so no major
 * key's row moves by a single button.
 *
 * ## The Picardy third is deliberately not here
 *
 * It would be one more row, `{ degree: 0, source: PARALLEL_MAJOR }` over
 * `[0, 2, 4, 5, 7, 9, 11]`, and it is left out on the distinction that put `V`
 * in: **this group exists to offer chords a user cannot otherwise reach, and the
 * alternates row's real limit is that it can only re-shape a slot that already
 * exists.** A major dominant in a minor key is a chord you append. A Picardy
 * third is, by construction, a change to the final tonic you have just written -
 * the slot is there, selecting it is the click you were going to make anyway,
 * and the alternates row on it already offers `I` among its own shapes. The limit
 * does not bite, so the row would be a second way to reach a chord that is never
 * more than one click away. If a later milestone finds users hunting for it, the
 * row above is the whole change.
 *
 * ## And the parallel minor's other three degrees
 *
 * Its tonic, second and fifth - `i`, `ii°`, `v` in a major key - are the three
 * whose roots the key already has, so they are shapes on an existing root:
 * alternates, which is the row that offers them, and which offers every named
 * shape rather than the parallel minor's one. `iv` is on the list despite
 * sharing that property, because it is the one modal-mixture chord common enough
 * that a user looking for a borrowed sound expects to find it here - and the
 * harmonic minor `V` is on it for the stronger version of the same argument.
 */
interface Borrowing {
  degree: number;
  source: readonly number[];
}

const BORROWINGS: readonly Borrowing[] = [
  { degree: 1, source: PARALLEL_PHRYGIAN },
  { degree: 2, source: PARALLEL_MINOR },
  { degree: 3, source: PARALLEL_MINOR },
  { degree: 4, source: PARALLEL_HARMONIC_MINOR },
  { degree: 5, source: PARALLEL_MINOR },
  { degree: 6, source: PARALLEL_MINOR },
  { degree: 6, source: PARALLEL_HARMONIC_MINOR }
];

/**
 * The three groups for a key, and a selection within it.
 *
 * `selected` supplies a root and nothing else - the alternates row is other
 * shapes on *that* chord's root, so a slot's degree and accidental are the two
 * fields read. Pass `null` when nothing is selected, or when what is selected
 * is a literal slot with no degree to build from: the other two groups do not
 * depend on the selection and are offered either way, which is what lets the
 * palette append a borrowed chord to an empty progression.
 *
 * Nothing is handed in to spell a root with any more. It used to take a
 * `SpellNote` and choose a preference for it, because how a pitch class is
 * written was an app-wide decision this module was not party to; a root is now
 * spelled by the letter its own numeral names, which is a fact about the option
 * being built and belongs where the option is built. See
 * `progression-spelling.ts` for why no preference could have reached it.
 */
export function chordVocabulary(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  selected: ChordDegree | null
): ChordVocabulary {
  if (!isHeptatonic(scaleIntervals)) {
    return { alternates: [], borrowed: [], secondary: [] };
  }

  const context: OptionContext = {
    key,
    scaleIntervals,
    current: currentChord(scaleIntervals, selected)
  };

  return {
    alternates: alternates(context, selected),
    borrowed: borrowed(context),
    secondary: secondary(context)
  };
}

/**
 * What every option in one call needs and none of them decides: the key, its
 * scale, and what the slot already holds.
 *
 * Bundled rather than threaded through four functions as separate arguments,
 * which is what they were until `current` made it five. The three groups differ
 * in *which chords they offer* and in nothing else, so the shared half is worth
 * a name - and `buildOption` reads all three of them.
 */
interface OptionContext {
  key: ProgressionKey;
  scaleIntervals: readonly number[];
  current: CurrentChord | null;
}

/**
 * The chord the selected slot holds, with `null` resolved to the key's answer.
 *
 * See `ChordOption.current` for why the resolution is the whole point: a slot's
 * stored `quality` is an override and is `null` on every slot the user has not
 * altered, so comparing options against the raw field marks nothing on the row
 * a user first opens.
 *
 * The height is the *slot's* and not the option's, which is what makes the
 * answer single. Resolved at each option's own height instead, a plain V slot
 * would match `major` at 3 and `dominant7` at 7 and the row would carry two
 * marks for one chord.
 */
interface CurrentChord {
  degree: number;
  alter: number;
  quality: ChordQuality;
}

function currentChord(
  scaleIntervals: readonly number[],
  selected: ChordDegree | null
): CurrentChord | null {
  if (selected === null) return null;

  return {
    degree: selected.degree,
    alter: selected.alter,
    quality:
      selected.quality ?? degreeQuality(scaleIntervals, selected.degree, selected.extent)
  };
}

/**
 * Every named quality on the selected chord's own root.
 *
 * All of them rather than all but one: the shape the slot already has is offered
 * back to it, so the row is the same buttons in the same order whatever is
 * selected, and the one that is already chosen is a place to mark rather than a
 * hole to leave. `NAMED_QUALITIES` is derived from `QUALITY_INTERVALS`, so a
 * quality added there appears here without anything being edited.
 */
function alternates(context: OptionContext, selected: ChordDegree | null): ChordOption[] {
  if (selected === null) return [];

  return NAMED_QUALITIES.map(quality =>
    buildOption(context, 'alternate', selected.degree, selected.alter, quality)
  );
}

/**
 * The parallel modes' chords, read through this key's degrees.
 *
 * The accidental is the distance between the two modes at that degree, so ♭VII
 * is `-1` in a major key, `0` in phrygian - which already has a flat seventh -
 * and would be `-2` in a mode whose seventh is raised. The shape is the source
 * mode's own triad, which is what makes ♭VII major and iv minor without either
 * being written down.
 *
 * Two filters, and both are about not lying:
 *
 *  - **A chord the key already has is not borrowed.** Aeolian's own ♭VII is
 *    its VII, and offering it under "Borrowed" would say something false about
 *    a chord the diatonic row is already showing. This is why a natural minor
 *    key is offered the Neapolitan and the two harmonic-minor rows and nothing
 *    else: it has the other four already.
 *  - **A chord the model cannot store is not offered.** `normalizeChordDegree`
 *    clamps `alter` into `ALTER_MIN`..`ALTER_MAX`, so an option past those
 *    bounds would be silently retuned on its way into the slot and the chord
 *    that sounded would not be the chord the button named. No scale the app
 *    offers reaches that bound today; the guard is here because the failure it
 *    prevents is invisible.
 */
function borrowed(context: OptionContext): ChordOption[] {
  const { scaleIntervals } = context;
  const options: ChordOption[] = [];

  for (const borrowing of BORROWINGS) {
    const quality = degreeQuality(borrowing.source, borrowing.degree, TRIAD);
    // Unreachable for these three modes - every triad of aeolian, phrygian and
    // harmonic minor is a named chord - and the type says so honestly rather
    // than asserting it: an unnameable stack cannot be an override, so there
    // would be nothing to offer even if a future source mode produced one.
    if (quality === 'other') continue;

    const alter = nearestZero(
      borrowing.source[borrowing.degree] - scaleIntervals[borrowing.degree]
    );
    if (alter < ALTER_MIN || alter > ALTER_MAX) continue;
    if (alter === 0 && degreeQuality(scaleIntervals, borrowing.degree, TRIAD) === quality) {
      continue;
    }

    options.push(buildOption(context, 'borrowed', borrowing.degree, alter, quality));
  }

  return options;
}

/**
 * The dominant seventh of every degree this key could tonicise.
 *
 * A rule rather than a table, in both halves. The **root** is a fifth above the
 * target's own root, which is four steps up the scale and seven semitones up in
 * pitch; expressing it as that degree with an accidental for the difference is
 * what gives it the right letter - the dominant of `ii` in C major is A and not
 * B double flat. The **targets** are the degrees a key could be in: a
 * diminished or augmented triad is nobody's tonic, so there is nothing to
 * tonicise, and the tonic itself is excluded because `V/I` is a numeral nobody
 * writes. The dominant of the home key is *the* `V`, named without a slash, and
 * a button for it here would say that the key's own dominant belonged somewhere
 * else.
 *
 * **That is a claim about the numeral, not about the chord.** In a minor key the
 * major dominant genuinely is missing: C aeolian's diatonic row shows `v`, a G
 * minor triad, and G7 is nowhere on it. This group is not where that is fixed,
 * because what is missing there is a chord *of* the key rather than a chord
 * pointing at one - the **borrowed** group fixes it, through harmonic minor. See
 * `BORROWINGS`, which is also where the claim this paragraph replaced is
 * recorded as having been false.
 *
 * In a major key that rule selects exactly the five the design doc lists -
 * V/ii, V/iii, V/IV, V/V, V/vi, with `vii°` falling out on its own - and in a
 * natural minor key it selects V/III, V/iv, V/v, V/VI and V/VII, because those
 * are that key's five tonicisable degrees.
 *
 * The accidental within the key is always zero in practice and computed anyway.
 * That is not dead arithmetic: it is zero *because* the targets are filtered to
 * major and minor triads, whose fifth is perfect and whose fifth is the very
 * degree the root is expressed against. Writing the zero down instead would be
 * asserting a theorem the filter above is free to change. The zero that *is*
 * written down is a different one - the accidental on the left of the slash, in
 * `ALTER_AGAINST_TARGET` - and that one is a theorem the filter cannot touch.
 */
function secondary(context: OptionContext): ChordOption[] {
  const { scaleIntervals } = context;
  const options: ChordOption[] = [];

  for (let target = 0; target < scaleIntervals.length; target++) {
    if (target === TONIC_DEGREE) continue;

    const targetQuality = degreeQuality(scaleIntervals, target, TRIAD);
    if (targetQuality !== 'major' && targetQuality !== 'minor') continue;

    const degree = (target + STEPS_TO_A_FIFTH) % scaleIntervals.length;
    const alter = nearestZero(
      scaleIntervals[target] + SEMITONES_IN_A_FIFTH - scaleIntervals[degree]
    );
    if (alter < ALTER_MIN || alter > ALTER_MAX) continue;

    options.push(
      buildOption(context, 'secondary', degree, alter, SECONDARY_QUALITY, {
        degree: target,
        quality: targetQuality
      })
    );
  }

  return options;
}

/**
 * One option: the triple to store, and the three ways of writing it.
 *
 * The name comes from `effectiveChord` rather than from the override, which
 * is the rule the strip card and the fretboard selection already share - a
 * chord is named after what it builds. At the height chosen here that is always
 * the override itself, so the two are the same answer; asking the shared
 * function anyway is what keeps them the same answer if the height rule ever
 * changes, and is the difference between an invariant and a coincidence.
 */
function buildOption(
  context: OptionContext,
  group: ChordOptionGroup,
  degree: number,
  alter: number,
  quality: NamedQuality,
  of?: RomanTarget
): ChordOption {
  const { key, scaleIntervals, current } = context;
  const extent = naturalExtent(quality);
  const option = optionDegree(degree, alter, quality, extent);
  const built = effectiveChord(scaleIntervals, option);
  // On the letter the numeral names, whatever `alter` does to the pitch: a
  // `♭II` button and a `II` button are written on the same letter, and the
  // accidental in the name is the one the numeral is already showing. That is
  // what makes a borrowed root print `Cb` in B flat major rather than the `B`
  // the chromatic tables could only give.
  const root = chordRootName(key, scaleIntervals, option);

  return {
    degree,
    alter,
    quality,
    extent,
    // A slash numeral is measured against its target, so the degree on the left
    // is the dominant of that target rather than this chord's own position in
    // the key - and the accidental on the left is measured there too, which is
    // why it is a constant rather than `alter`. See `ALTER_AGAINST_TARGET`.
    numeral:
      of === undefined
        ? romanNumeral(degree, alter, built)
        : romanNumeral(DOMINANT_DEGREE, ALTER_AGAINST_TARGET, built, of),
    name: chordName(root, built),
    spoken: spokenChordName(root, built),
    group,
    // The *stored* quality rather than the built one, so raising a borrowed
    // chord's complexity does not un-mark its button: the shape the slot holds
    // is still the shape that button offers. See `ChordOption.current`.
    current:
      current !== null &&
      current.degree === degree &&
      current.alter === alter &&
      current.quality === quality
  };
}

/**
 * How high a shape stands on its own: a triad for three intervals, a seventh
 * for four.
 *
 * Read off `QUALITY_INTERVALS` rather than listed, so the answer for a quality
 * is the shape that quality actually names. A seventh offered at a triad's
 * height is cut back to the triad by `chordPitchClasses` and would print the
 * triad's name.
 */
function naturalExtent(quality: NamedQuality): ChordExtent {
  return QUALITY_INTERVALS[quality].length >= 4 ? SEVENTH : TRIAD;
}

/**
 * The `ChordDegree` an option stands for, as `chordRootName` wants it.
 *
 * The shared arithmetic rather than a local `(tonic + interval + alter) % 12`,
 * on the argument the palette's own `paletteDegree` makes: the strip card, the
 * fretboard highlight and the generator all root a chord through
 * `chordRootPitchClass`, which is what `chordRootName` spells, and a caller
 * doing its own sum is the label that stops agreeing with the sound. It also
 * folds a negative sum back into range, which a displaced root in a flat key
 * reaches.
 *
 * `chordRootName` reads only `degree` and `alter`; `effectiveChord`, the
 * other caller, reads everything but `inversion` and `octave`. The fields a
 * palette button does not choose are what a fresh slot carries - no
 * suspension, no pinned extension.
 *
 * ## And that is what the name is true over, because the click clears them too
 *
 * These four lines print the name; `chosen()`, in `progression-degree-editor.ts`,
 * stores the chord. The two agree only while they write the same `suspension`
 * and the same `extensions`, and until M3's final review they did not: `chosen`
 * kept whatever the slot already held, so this docstring's claim that the name
 * printed "is the name of the chord the button will actually build" was true of
 * the two rows that **append** onto a fresh slot and false of the one that
 * **retunes** a selected one. In a `Bbsus4` slot the alternates row's `i°` /
 * `Bb°` button stored `diminished` under the surviving `sus4`, built
 * B♭-E♭-F♭ and left the card reading `I?` / `Bb?` - the app's refusal to name,
 * printed by a button that had promised a name.
 *
 * `chosen` now clears both, on the argument written out there, so the fresh
 * slot's values above are what every route stores and the claim holds for all
 * three rows. The invariant is pinned rather than asserted:
 * `chord-palette.roundtrip.spec.ts`, beside the component that draws the
 * buttons, walks every option of every group over every heptatonic scale and
 * every degree - including slots carrying each suspension and each pinned
 * alteration - and checks that `describeSlot` of what `chosen` builds prints
 * exactly what the button printed. A fixture for the one sus4 case would have
 * let the next field added to `ChordDegree` drift the same way.
 *
 * The one field exempt there is the **secondary row's numeral**, which is a
 * slash numeral by design and is measured against its target rather than
 * against the key - see `ALTER_AGAINST_TARGET` above, and `romanNumeral`. Its
 * name and its spoken form are swept like every other button's.
 */
function optionDegree(
  degree: number,
  alter: number,
  quality: NamedQuality,
  extent: ChordExtent
): ChordDegree {
  return {
    degree,
    alter,
    extent,
    quality,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/**
 * The smallest displacement that means the same thing: 11 semitones up is one
 * down.
 *
 * An accidental is a distance rather than a position, and the difference
 * between two modes at one degree is only ever a semitone or two in practice.
 * The wrap is what stops an exotic mode producing a nominal `+10` that fails
 * the storable-range check when `-2` would have passed it.
 *
 * Exactly six semitones is the one distance with no nearer direction, and which
 * way it goes is unobservable: a tritone is outside `ALTER_MIN`..`ALTER_MAX`
 * whichever sign it takes, so both answers are dropped by the same guard.
 */
function nearestZero(semitones: number): number {
  const wrapped = ((semitones % 12) + 12) % 12;
  return wrapped > 6 ? wrapped - 12 : wrapped;
}
