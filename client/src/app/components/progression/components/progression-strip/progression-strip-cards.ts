import {
  ChordSlot,
  ProgressionKey,
  ProgressionState,
  SlotHarmony
} from '../../../../models/progression.model';
import {
  chordName,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-chord-names';
import { effectiveChord } from '../../../../services/progression-harmony';
import { chordRootName } from '../../../../services/progression-spelling';

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
 * The spelling used to be *given* rather than decided - a `SpellNote` handed in,
 * because how a pitch class is written was `MusicTheoryService`'s app-wide
 * decision. It is now asked of `progression-spelling.ts`, which needs the key
 * and the degree and nothing else. That is not a loss of the separation but the
 * same separation drawn where it holds: this file still does not decide how a
 * note is written, it names the chord whose letter decides it.
 *
 * ## What a card prints, and what it deliberately does not
 *
 * The numeral and the name both come from `effectiveChord`, which is the
 * identity of the chord the slot actually builds: the key's own answer for a
 * slot the user has not overridden, and the *built* chord's identity for one
 * they have. They used to come from `ChordDegree.quality` directly, which is the
 * label the model happens to store, and the two part company the moment an
 * override does not fill the extent it was chosen at - see `effectiveChord`'s
 * own note.
 *
 * Asking one function for it is what keeps this card and the fretboard
 * selection agreeing about one chord; resolving it here would be the second
 * writing of a rule that has two readers.
 *
 * **The card shows the height now, and the argument against it is what
 * changed.** Until M3 Task 5 both lines were figured from a single
 * `ChordQuality`, which names a ninth after its seventh - so a slot raised to a
 * ninth reported `dominant7`, printed `V7`, and read `G7` beside it while the
 * palette's complexity readout said "9th". Printing `V9` on the numeral alone
 * would have put a second convention in a component and moved the disagreement
 * *onto* the card: `V9` over `G7`, two lines about one chord.
 *
 * `effectiveChord` removes the choice rather than settling it. Both lines are
 * composed from one identity by one function - `composeFigure` in
 * `progression-chord-names.ts` - so they carry the same height in the two
 * conventions they are each written in, and `V9` sits over `G9`. There is
 * nothing left for the card to disagree with, which is why the height can be
 * printed at all.
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
export function buildStripView(state: ProgressionState): StripView {
  // The palette's gate, read rather than recomputed. `canBuildChords` is
  // `isHeptatonic` already applied to `keyScale`, so the strip refuses to name
  // a chord in exactly the keys the palette refuses to offer one - two halves
  // of one screen giving one answer about what the key can say.
  const intervals = state.canBuildChords && state.keyScale ? state.keyScale.intervals : null;

  const cards = state.doc.slots.map(slot => buildCard(slot, state, intervals));

  return {
    cards,
    unlabelledHint: cards.some(card => card.isUnlabelled) ? UNLABELLED_HINT : null
  };
}

function buildCard(
  slot: ChordSlot,
  state: ProgressionState,
  intervals: readonly number[] | null
): StripCard {
  const described = describeSlot(slot.harmony, state.doc.key, intervals);
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
  intervals: readonly number[] | null
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
  // Spelled on the letter the numeral names, so the card's two lines cannot
  // disagree about which note the chord is on: a `♭II` prints `Cb Maj` in B
  // flat major, where the chromatic tables could only offer `B Maj` and read as
  // a raised seventh. The palette button this card came from spells it through
  // the same function. See `progression-spelling.ts`.
  const root = chordRootName(key, intervals, degree);
  // `quality` is nullable and `null` means "as the key gives it", so the card
  // prints the key's own answer for a slot the user has not overridden. Asked
  // through `effectiveChord` rather than resolved here, so that the strip and
  // the fretboard cannot come to different answers about one chord - and given
  // the whole degree, because an override built on a displaced root, or under a
  // suspension, or over a pinned extension, is a different chord from the one
  // the override is called, and the card names what sounds.
  const chord = effectiveChord(intervals, degree);

  return {
    isUnlabelled: false,
    numeral: romanNumeral(degree.degree, degree.alter, chord),
    name: chordName(root, chord),
    subject: spokenChordName(root, chord),
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
