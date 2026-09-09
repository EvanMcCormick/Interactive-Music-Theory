import { ALTER_MAX, ALTER_MIN } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import {
  RomanTarget,
  SpellNote,
  chordName,
  romanNumeral,
  rootPrefersSharps,
  spokenChordName
} from './progression-chord-names';
import { chordRootPitchClass } from './progression-generate';
import {
  ChordExtent,
  NAMED_QUALITIES,
  NamedQuality,
  QUALITY_INTERVALS,
  degreeQuality,
  effectiveQuality,
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
 *  2. **The name is never a surprise.** `effectiveQuality` reads a chord's name
 *     off the stack it builds, and at the height a quality itself names the
 *     answer is always that quality - swept over every scale, degree and
 *     `alter` the app can reach. So no button here can print `?`, and no two
 *     buttons can print the same name.
 *  3. **The alternative prints duplicates.** Offered at a slot's own extent of
 *     9, a `major` override and a `major7` override build the same five notes,
 *     because the seventh they disagree about is diatonic there anyway. Two
 *     buttons, one chord, one name.
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

/** The tonic. Its own dominant is `V`, which the diatonic row already offers. */
const TONIC_DEGREE = 0;

/** Degree 5 of a key, zero-indexed: the `V` on the left of every slash. */
const DOMINANT_DEGREE = 4;

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
 * Which degrees are borrowed, and which parallel mode each is borrowed from.
 *
 * The five the design doc names - ♭II, ♭III, iv, ♭VI, ♭VII - and this is the
 * whole of what is written down about them. The accidental is the distance
 * between the source mode's degree and the current key's, and the shape is the
 * source mode's own triad on that degree, so both fall out of the two arrays
 * above rather than being asserted here.
 *
 * The parallel minor's other three degrees are deliberately not on this list.
 * Its tonic, second and fifth - `i`, `ii°`, `v` in a major key - are the three
 * whose roots the key already has, so they are shapes on an existing root:
 * alternates, which is the row that offers them, and which offers all twelve
 * shapes rather than the parallel minor's one. `iv` is on the list despite
 * sharing that property, because it is the one modal-mixture chord common
 * enough that a user looking for a borrowed sound expects to find it here.
 */
interface Borrowing {
  degree: number;
  source: readonly number[];
}

const BORROWINGS: readonly Borrowing[] = [
  { degree: 1, source: PARALLEL_PHRYGIAN },
  { degree: 2, source: PARALLEL_MINOR },
  { degree: 3, source: PARALLEL_MINOR },
  { degree: 5, source: PARALLEL_MINOR },
  { degree: 6, source: PARALLEL_MINOR }
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
 * `spell` is `MusicTheoryService.spellNote`, handed in for the reason every
 * other view model on this page hands it in: how a pitch class is written is an
 * app-wide decision this module is not party to. What this module *does* decide
 * is which way a displaced root leans - see `rootPrefersSharps`.
 */
export function chordVocabulary(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  selected: ChordDegree | null,
  spell: SpellNote
): ChordVocabulary {
  if (!isHeptatonic(scaleIntervals)) {
    return { alternates: [], borrowed: [], secondary: [] };
  }

  return {
    alternates: alternates(key, scaleIntervals, selected, spell),
    borrowed: borrowed(key, scaleIntervals, spell),
    secondary: secondary(key, scaleIntervals, spell)
  };
}

/**
 * Every named quality on the selected chord's own root.
 *
 * All twelve rather than eleven: the shape the slot already has is offered back
 * to it, so the row is the same twelve buttons in the same order whatever is
 * selected, and the one that is already chosen is a place to mark rather than a
 * hole to leave. `NAMED_QUALITIES` is derived from `QUALITY_INTERVALS`, so a
 * quality added there appears here without anything being edited.
 */
function alternates(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  selected: ChordDegree | null,
  spell: SpellNote
): ChordOption[] {
  if (selected === null) return [];

  return NAMED_QUALITIES.map(quality =>
    buildOption(key, scaleIntervals, 'alternate', selected.degree, selected.alter, quality, spell)
  );
}

/**
 * The parallel minor's chords, read through this key's degrees.
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
 *    key is offered only the Neapolitan: it has the other four.
 *  - **A chord the model cannot store is not offered.** `normalizeChordDegree`
 *    clamps `alter` into `ALTER_MIN`..`ALTER_MAX`, so an option past those
 *    bounds would be silently retuned on its way into the slot and the chord
 *    that sounded would not be the chord the button named. No scale the app
 *    offers reaches that bound today; the guard is here because the failure it
 *    prevents is invisible.
 */
function borrowed(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  spell: SpellNote
): ChordOption[] {
  const options: ChordOption[] = [];

  for (const borrowing of BORROWINGS) {
    const quality = degreeQuality(borrowing.source, borrowing.degree, TRIAD);
    // Unreachable for these two modes - every triad of aeolian and phrygian is
    // a named chord - and the type says so honestly rather than asserting it:
    // an unnameable stack cannot be an override, so there would be nothing to
    // offer even if a future source mode produced one.
    if (quality === 'other') continue;

    const alter = nearestZero(
      borrowing.source[borrowing.degree] - scaleIntervals[borrowing.degree]
    );
    if (alter < ALTER_MIN || alter > ALTER_MAX) continue;
    if (alter === 0 && degreeQuality(scaleIntervals, borrowing.degree, TRIAD) === quality) {
      continue;
    }

    options.push(
      buildOption(key, scaleIntervals, 'borrowed', borrowing.degree, alter, quality, spell)
    );
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
 * tonicise, and the tonic itself is excluded because its dominant is `V`, which
 * the diatonic row is already showing.
 *
 * In a major key that rule selects exactly the five the design doc lists -
 * V/ii, V/iii, V/IV, V/V, V/vi, with `vii°` falling out on its own - and in a
 * natural minor key it selects V/III, V/iv, V/v, V/VI and V/VII, because those
 * are that key's five tonicisable degrees.
 *
 * The accidental is always zero in practice and computed anyway. That is not
 * dead arithmetic: it is zero *because* the targets are filtered to major and
 * minor triads, whose fifth is perfect and whose fifth is the very degree the
 * root is expressed against. Writing the zero down instead would be asserting a
 * theorem the filter above is free to change.
 */
function secondary(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  spell: SpellNote
): ChordOption[] {
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
      buildOption(key, scaleIntervals, 'secondary', degree, alter, SECONDARY_QUALITY, spell, {
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
 * The name comes from `effectiveQuality` rather than from the override, which
 * is the rule the strip card and the fretboard selection already share - a
 * chord is named after what it builds. At the height chosen here that is always
 * the override itself, so the two are the same answer; asking the shared
 * function anyway is what keeps them the same answer if the height rule ever
 * changes, and is the difference between an invariant and a coincidence.
 */
function buildOption(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  group: ChordOptionGroup,
  degree: number,
  alter: number,
  quality: NamedQuality,
  spell: SpellNote,
  of?: RomanTarget
): ChordOption {
  const extent = naturalExtent(quality);
  const built = effectiveQuality(scaleIntervals, degree, extent, alter, quality);
  const root = spell(
    chordRootPitchClass(key, scaleIntervals, optionDegree(degree, alter, quality, extent)),
    rootPrefersSharps(key.preferSharps, alter)
  );

  return {
    degree,
    alter,
    quality,
    extent,
    // A slash numeral is measured against its target, so the degree on the left
    // is the dominant of that target rather than this chord's own position in
    // the key. See `romanNumeral`.
    numeral:
      of === undefined
        ? romanNumeral(degree, alter, built)
        : romanNumeral(DOMINANT_DEGREE, alter, built, of),
    name: chordName(root, built),
    spoken: spokenChordName(root, built),
    group
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
 * The `ChordDegree` an option stands for, as `chordRootPitchClass` wants it.
 *
 * The shared arithmetic rather than a local `(tonic + interval + alter) % 12`,
 * on the argument the palette's own `paletteDegree` makes: the strip card, the
 * fretboard highlight and the generator all root a chord through this one
 * function, and a fifth caller doing its own sum is the label that stops
 * agreeing with the sound. It also folds a negative sum back into range, which
 * a displaced root in a flat key reaches.
 *
 * Only `degree` and `alter` are read. The other three are what a fresh slot
 * carries, and they are here because the function takes a whole `ChordDegree`
 * rather than because this module has an opinion about inversion.
 */
function optionDegree(
  degree: number,
  alter: number,
  quality: NamedQuality,
  extent: ChordExtent
): ChordDegree {
  return { degree, alter, extent, quality, inversion: 0, suspension: 'none', octave: 0 };
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
