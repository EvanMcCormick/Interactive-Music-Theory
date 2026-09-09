import {
  ChordSlot,
  ProgressionKey,
  ProgressionState,
  SlotHarmony
} from '../../../../models/progression.model';
import { chordRootPitchClass } from '../../../../services/progression-generate';
import {
  chordName,
  effectiveQuality,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-harmony';

/**
 * What the strip says about a progression: one card per slot, and the sentence
 * under them.
 *
 * Pure, on the `progression-strip-gestures.ts` precedent and for its two
 * reasons. None of this is about a component - a published state goes in and a
 * view model comes out, with no Angular, no DOM and no injector - and taking it
 * out of the component put that file back under the project's 500-line cap,
 * which the gesture split had done once already.
 *
 * The one thing it is *given* rather than deciding is the spelling. How a pitch
 * class is written is `MusicTheoryService`'s app-wide decision, so it arrives as
 * a function, and is asked to spell a note with a given preference rather than
 * asked what the preference is: `getNoteName` answers for the fretboard's key,
 * the two are allowed to differ, and asking the app-wide rule is how the palette
 * came to print `D♯ Maj` as the tonic chord of E flat major.
 *
 * ## What a card prints, and what it deliberately does not
 *
 * The numeral and the name both come from `ChordDegree.quality` - the field the
 * model stores and `regenerateSlot` recomputes on every change that could move
 * it. That source of truth is chosen rather than fallen into, because a second
 * one is available and the two disagree: `degreeQuality` names a ninth after its
 * seventh, so a slot raised to a ninth reports `dominant7` and prints `V7` while
 * the palette's complexity readout beside it says "9th".
 *
 * **The card does not show the height.** Numeral and name are both figured from
 * the one stored quality, so a card's two lines can never disagree with each
 * other, and the panel that says "9th" is labelled "Complexity" - a different
 * question about the same chord. Printing `V9` here would put a second
 * convention in a component, derived from the extent while the chord name beside
 * it still read `G7`: the disagreement would move onto the card rather than off
 * it.
 *
 * `romanNumeral`'s own note offers "widen the signature to take the extent" as
 * the M2 fix, and on its own that is exactly the `V9` over `G7` card this
 * paragraph argues against - `chordName` reads the same `quality` field and is
 * blind to the height in the same way. The disagreement starts lower down, in
 * `ChordQuality`, which has no ninth, eleventh or thirteenth member for either
 * function to name. M2 has to widen the type, or widen both functions together.
 *
 * ## Unlabelled rather than mislabelled
 *
 * `describeSlot` prints a numeral only when the slot has a degree *and* the key
 * can name it, and says so plainly otherwise. The `literal` branch is
 * unreachable in M1 - the recogniser that degrades a slot to literal is M3's -
 * but the rule becomes visible to a user on the card, so it is written now
 * rather than discovered then.
 */

/** One chord card: what it is called, how long it is, and what it says aloud. */
export interface StripCard {
  /** The slot's id. The card's identity for `trackBy`, and for every dispatch. */
  id: string;
  /** `V7`, or the unlabelled mark when the key cannot name this chord. */
  numeral: string;
  name: string;
  /** Beats. The card is drawn this many beat-widths wide; see the SCSS. */
  lengthBeats: number;
  /** `4 beats`, for the handle's `aria-valuetext`. */
  beatsText: string;
  /**
   * The ceiling the resize handle announces. `role="slider"` has to declare one
   * and the model has none - a slot may be as long as the user drags it - so
   * this is nominal, widened to whatever this slot already is so that
   * `aria-valuenow` stays inside the range without inventing a limit.
   */
  maxBeats: number;
  isSelected: boolean;
  /** Whether this card has no numeral to show. See `describeSlot`. */
  isUnlabelled: boolean;
  /**
   * What the card says aloud, built here rather than in the template, for the
   * palette's two reasons: a concatenation in an `[attr.aria-label]` binding is
   * re-evaluated on every change-detection pass, and `V7` over `G7` announces
   * as "vee seven, gee seven" rather than as a chord. See `spokenChordName`.
   */
  label: string;
  removeLabel: string;
  /**
   * The handle's name alone. Its *value* is `beatsText`, announced through
   * `aria-valuetext`, which is what gets re-read when an arrow key changes it -
   * a name that carried the length would change silently under a focus that
   * never moved.
   */
  resizeLabel: string;
}

/** The whole of what the strip renders from one published state. */
export interface StripView {
  cards: readonly StripCard[];
  /** The sentence under the strip, or null when every card has a numeral. */
  unlabelledHint: string | null;
}

/** How a pitch class is written. `MusicTheoryService.spellNote`, passed in. */
export type SpellNote = (pitchClass: number, preferSharps: boolean) => string;

/** The numeral slot of a card that has no numeral. */
const NO_NUMERAL = '—';

/** The name of a chord this key cannot name. */
const UNLABELLED_NAME = 'Unlabelled';

/** How such a card refers to itself in the labels that are read aloud. */
const UNLABELLED_SUBJECT = 'unlabelled chord';

/** Said once below the strip rather than on each card, which has no room. */
const UNLABELLED_HINT =
  'A card with no numeral is a chord this key cannot name. Its notes are kept exactly as they are.';

/**
 * The announced ceiling before it is widened. Sixteen bars of four - well past
 * anything M1 writes, and a range rather than a rule. See `StripCard.maxBeats`.
 */
const ANNOUNCED_MAX_BEATS = 64;

/** Builds every card from one published state. */
export function buildStripView(state: ProgressionState, spell: SpellNote): StripView {
  // The palette's gate, read rather than recomputed. `canBuildChords` is
  // `isHeptatonic` already applied to `keyScale`, so the strip refuses to name
  // a chord in exactly the keys the palette refuses to offer one - two halves
  // of one screen giving one answer about what the key can say.
  const intervals = state.canBuildChords && state.keyScale ? state.keyScale.intervals : null;

  const cards = state.doc.slots.map(slot => buildCard(slot, state, intervals, spell));

  return {
    cards,
    unlabelledHint: cards.some(card => card.isUnlabelled) ? UNLABELLED_HINT : null
  };
}

function buildCard(
  slot: ChordSlot,
  state: ProgressionState,
  intervals: readonly number[] | null,
  spell: SpellNote
): StripCard {
  const described = describeSlot(slot.harmony, state.doc.key, intervals, spell);
  const beats = formatBeats(slot.lengthBeats);

  return {
    id: slot.id,
    numeral: described.numeral,
    name: described.name,
    lengthBeats: slot.lengthBeats,
    beatsText: beats,
    maxBeats: Math.max(ANNOUNCED_MAX_BEATS, slot.lengthBeats),
    isSelected: slot.id === state.selectedSlotId,
    isUnlabelled: described.isUnlabelled,
    label: `${described.subject}, ${described.detail}, ${beats}`,
    removeLabel: `Remove ${described.subject}`,
    resizeLabel: `Length of ${described.subject}`
  };
}

/**
 * What to print on a card, and what to say about it.
 *
 * Three roads to the same refusal, told apart because they are different facts
 * about the progression: a slot the recogniser could not name, one the user
 * detached by hand, and a slot whose degree is perfectly good but whose *key*
 * has no name for it. The last is reachable today - build in C major and switch
 * to a pentatonic - and it is a refusal rather than a stale label because the
 * stored quality came from a scale no longer selected.
 */
function describeSlot(
  harmony: SlotHarmony,
  key: ProgressionKey,
  intervals: readonly number[] | null,
  spell: SpellNote
): CardDescription {
  if (harmony.kind === 'literal') {
    return unlabelled(
      harmony.reason === 'unrecognised'
        ? 'its notes match no chord in this key'
        : 'detached from the key by hand'
    );
  }

  if (!intervals) return unlabelled('this key cannot name it');

  const degree = harmony.degree;
  const root = spell(chordRootPitchClass(key, intervals, degree), key.preferSharps);
  // `quality` is nullable and `null` means "as the key gives it", so the card
  // prints the key's own answer for a slot the user has not overridden. Asked
  // through `effectiveQuality` rather than resolved here, so that the strip and
  // the fretboard cannot come to different answers about one chord.
  const quality = effectiveQuality(intervals, degree.degree, degree.extent, degree.quality);

  return {
    isUnlabelled: false,
    numeral: romanNumeral(degree.degree, quality),
    name: chordName(root, quality),
    subject: spokenChordName(root, quality),
    // The numeral is dropped from the spoken label and the position given as a
    // degree instead, exactly as the palette does it: read aloud a numeral is a
    // string of letters, and the quality it carries is already in the spoken
    // name.
    detail: `degree ${degree.degree + 1}`
  };
}

/** What a card prints, and the two phrases its labels are built from. */
interface CardDescription {
  /**
   * Whether this is a card with no numeral.
   *
   * Carried rather than inferred by comparing `numeral` to `NO_NUMERAL`. The
   * two branches above are the only things that decide it and they know the
   * answer outright; recovering it downstream from the em dash they happened to
   * print made a styling rule and an `aria` label depend on a glyph.
   */
  isUnlabelled: boolean;
  numeral: string;
  name: string;
  /** The chord as a phrase to be read aloud: `G major`. */
  subject: string;
  /** What else there is to say about it: its position, or why it has no numeral. */
  detail: string;
}

/** A card with no numeral, and the reason it has none. */
function unlabelled(detail: string): CardDescription {
  return {
    isUnlabelled: true,
    numeral: NO_NUMERAL,
    name: UNLABELLED_NAME,
    subject: UNLABELLED_SUBJECT,
    detail
  };
}

/** `1 beat`, `4 beats`, `1.5 beats`. */
function formatBeats(beats: number): string {
  // `lengthBeats` is a float, and M2's free timing will put fractions here.
  const shown = Number(beats.toFixed(2));
  return `${shown} ${shown === 1 ? 'beat' : 'beats'}`;
}
