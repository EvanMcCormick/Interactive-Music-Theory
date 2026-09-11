import {
  ChordSlot,
  LiteralReason,
  ProgressionKey,
  ProgressionState,
  SlotHarmony
} from '../../../../models/progression.model';
import {
  chordName,
  isNameable,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-chord-names';
import { effectiveChord } from '../../../../services/progression-harmony';
import { RESET_REFUSAL_TEXT, resetOutcome } from '../../../../services/progression-reset';
import { chordRootName } from '../../../../services/progression-spelling';

/**
 * What the strip says about a progression: one card per slot, and the sentence
 * under them.
 *
 * Pure, on the `progression-strip-gestures.ts` precedent and for its two
 * reasons. None of this is about a component - a published state goes in and a
 * view model comes out, with no Angular, no DOM and no injector - and taking it
 * out of the component put that file back under the project's file-length cap -
 * 500 lines when this was split and 1000 now, `fda93c1` - which the gesture
 * split had done once already.
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
 *
 * **The sentence under the strip is chosen per road, and its way back is asked
 * of the service's own predicate.** It used to be one fixed string ending
 * "Reset to chord, in the roll, turns it back into one", shown whenever any card
 * was bare - which is a promise `resetSlotToChord` refuses to keep on the third
 * road, and the third road is the one that bares every card at once. See
 * `buildHint` and `progression-reset.ts`.
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
   * Whether this is the card the last edit relabelled - `state.relabel.slotId`.
   *
   * The chip in the roll's toolbar says *what* changed; this says *where*, which
   * the chip cannot: the roll is one slot's notes and the strip is the whole
   * progression, and a user who drags a note is looking at the roll rather than
   * counting cards. The card carries a mark as well as a colour, for the reason
   * the palette's alternates row gives about its `↓`: a colour alone is not a
   * carrier, and this one is spoken as well - see `label`.
   */
  isRelabelled: boolean;
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

/**
 * How the sentence under the strip opens, per road to an unlabelled card.
 *
 * One opening per road because the roads are different facts and a user reading
 * this is trying to find out which one happened to them. The third is the state
 * that unlabels the whole strip at once, so its opening is the one about the key
 * rather than about any card's notes.
 *
 * The fourth entry is for a strip carrying both literal roads, where naming
 * either would be naming the wrong one for half the cards.
 */
const UNLABELLED_LEAD: Record<UnlabelledRoad | 'mixed', string> = {
  unrecognised:
    'A card with no numeral is notes this app could not name as a chord in this key. ' +
    'They are kept exactly as they are.',
  'user-detached':
    'A card with no numeral is notes you detached from the key by hand. They are kept ' +
    'exactly as they are.',
  'unnameable-key':
    'A card with no numeral is a chord this key cannot name. Its notes are kept exactly ' +
    'as they are.',
  mixed:
    'A card with no numeral is notes this key has no name for. They are kept exactly as ' +
    'they are.'
};

/**
 * How it closes when there is a way back, and when there is one for some of the
 * cards only.
 *
 * This half is owed to the user rather than merely useful: every command on this
 * page refuses a slot with no numeral, so a card that loses one is a card whose
 * whole panel of controls stops answering. Naming the one button that still
 * works is the difference between a slot the user can recover and a slot they
 * can only delete.
 *
 * Which is exactly why it may not be said when the button will not work. It used
 * to be the fixed tail of one fixed sentence, promised whenever *any* card was
 * unlabelled - so in a key that cannot stack thirds it promised a button that
 * was greyed out one panel over, reading the opposite. When there is no way back
 * the closing sentence is the refusal's own words, from
 * `progression-reset.ts`, which is the same string the button explains itself
 * with. Two surfaces, one state, one sentence.
 */
const WAY_BACK = 'Reset to chord, in the roll, turns it back into one.';
const SOME_WAY_BACK =
  'Reset to chord, in the roll, turns back the ones this app wrote; the others were ' +
  'never chords here.';

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

  const described = state.doc.slots.map(slot =>
    describeSlot(slot.harmony, state.doc.key, intervals)
  );

  return {
    cards: state.doc.slots.map((slot, index) => buildCard(slot, state, described[index])),
    unlabelledHint: buildHint(state, described)
  };
}

/**
 * The sentence under the strip: which road the unlabelled cards took, and
 * whether the button they point at will work.
 *
 * Both halves are asked rather than assumed, and the second is asked of
 * `resetOutcome` - the predicate `ProgressionService.resetSlotToChord` refuses
 * on and the roll's button explains itself from. The sentence promised that
 * button unconditionally until this, which made it false in exactly the state
 * that fires it for every card at once.
 *
 * The refusals do not mix freely, and the ordering below leans on it: a key that
 * cannot stack thirds leaves `intervals` null for the whole document, so
 * `unbuildable-key` is all cards or none. `no-origin` is per slot, and a strip
 * may hold one of each - hence the third clause, which promises the button for
 * the cards it will answer on and says plainly that the rest have nowhere to go.
 */
function buildHint(state: ProgressionState, described: readonly CardDescription[]): string | null {
  // Pushed rather than filtered, so that `road` is narrowed by the check that
  // selected the card rather than by an assertion after it.
  const bare: { road: UnlabelledRoad; harmony: SlotHarmony }[] = [];
  state.doc.slots.forEach((slot, index) => {
    const road = described[index].road;
    if (road !== null) bare.push({ road, harmony: slot.harmony });
  });
  if (bare.length === 0) return null;

  const refusals = bare.map(entry => {
    const outcome = resetOutcome(state.canBuildChords, entry.harmony);
    return outcome.canReset ? null : outcome.refusal;
  });

  // The key's own refusal covers every card there is, so it is the opening as
  // well as the closing: no card's notes are the reason any of them is bare.
  if (refusals.includes('unbuildable-key')) {
    return `${UNLABELLED_LEAD['unnameable-key']} ${RESET_REFUSAL_TEXT['unbuildable-key']}`;
  }

  const roads = bare.map(entry => entry.road);
  const lead = roads.every(road => road === roads[0])
    ? UNLABELLED_LEAD[roads[0]]
    : UNLABELLED_LEAD.mixed;
  const refused = refusals.filter(refusal => refusal !== null).length;

  if (refused === 0) return `${lead} ${WAY_BACK}`;
  if (refused === refusals.length) return `${lead} ${RESET_REFUSAL_TEXT['no-origin']}`;
  return `${lead} ${SOME_WAY_BACK}`;
}

function buildCard(
  slot: ChordSlot,
  state: ProgressionState,
  described: CardDescription
): StripCard {
  const beats = formatBeats(slot.lengthBeats);
  const isRelabelled = slot.id === state.relabel?.slotId;

  return {
    id: slot.id,
    numeral: described.numeral,
    name: described.name,
    lengthBeats: slot.lengthBeats,
    beatsText: beats,
    maxBeats: Math.max(ANNOUNCED_MAX_BEATS, slot.lengthBeats),
    isSelected: slot.id === state.selectedSlotId,
    isUnlabelled: described.isUnlabelled,
    isRelabelled,
    // The relabel is said as well as drawn and marked. The mark is
    // `aria-hidden` - it is the sighted half of a fact the colour cannot carry
    // alone - so without this clause a screen reader would have the card's new
    // name and no word about the app having chosen it.
    label: `${described.subject}, ${described.detail}, ${beats}${
      isRelabelled ? ', relabelled by your edit' : ''
    }`,
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
 *
 * **Exported for the relabel chip**, which names the two ends of a relabel and
 * each of its alternates, and has to name them the way the card does: a chip
 * reading `Isus4` over a card reading something else would be two answers about
 * one slot. It is the same argument `effectiveChord` makes one level down, and
 * it is why this is exported rather than copied - a second naming of a slot is
 * a second set of rules for when a slot has no name.
 *
 * **Which road it took comes back with the answer.** It is the one thing in
 * here that knows, and the sentence under the strip has to say something
 * different on each - it used to say one thing on all three, which was a
 * promise the service refuses on the third. Recovering it downstream would mean
 * a second reading of the same two branches; see `CardDescription.road`.
 */
export function describeSlot(
  harmony: SlotHarmony,
  key: ProgressionKey,
  intervals: readonly number[] | null
): CardDescription {
  if (harmony.kind === 'literal') {
    return unlabelled(
      harmony.reason,
      harmony.reason === 'unrecognised'
        ? 'its notes match no chord in this key'
        : 'detached from the key by hand'
    );
  }

  if (!intervals) return unlabelled('unnameable-key', 'this key cannot name it');

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
    road: null,
    // Asked of the namer rather than recovered from the `?` it prints, on the
    // argument `isUnlabelled` makes about the em dash. See the field.
    hasName: isNameable(chord),
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

/**
 * Which of `describeSlot`'s three roads to an unlabelled card was taken.
 *
 * The first two are `LiteralReason` spelled out again rather than imported,
 * because they are not the same fact: `LiteralReason` is why the *model* holds
 * notes instead of a degree, and this is why the *card* has no numeral to print.
 * They coincide on two of three values and the third has no model side at all -
 * a perfectly good degree slot in a key with no name for it, which is a fact
 * about the key and not about the slot. A union that imported the other would
 * have to be widened anyway, and would read as though the third value were a
 * kind of literal harmony, which is the one thing it is not.
 */
export type UnlabelledRoad = LiteralReason | 'unnameable-key';

/** What a card prints, and the two phrases its labels are built from. */
export interface CardDescription {
  /**
   * How this card came to have no numeral, or null when it has one.
   *
   * Carried for the reason `isUnlabelled` is carried one field down, taken one
   * step further: the branches above are the only things that know which road
   * they took, and the sentence under the strip has to say something different
   * on each. Recovering it downstream would mean reading `harmony.kind` and
   * `intervals` a second time, in a second place, free to disagree with the card
   * it is printed under - which is how the sentence came to promise a button the
   * service refuses. See `buildHint`.
   *
   * It is the road and not the *refusal*: whether Reset to chord will actually
   * work is `resetOutcome`'s answer, and this function has no business holding a
   * second opinion about it.
   */
  road: UnlabelledRoad | null;
  /**
   * Whether this is a card with no numeral.
   *
   * Carried rather than inferred by comparing `numeral` to `NO_NUMERAL`. The
   * two branches above are the only things that decide it and they know the
   * answer outright; recovering it downstream from the em dash they happened to
   * print made a styling rule and an `aria` label depend on a glyph.
   */
  isUnlabelled: boolean;
  /**
   * Whether what this description prints is a *name*, or the app's refusal to
   * give one.
   *
   * Two ways to be false, and they print differently - the em dash of a card with
   * no numeral, and the `?` `composeFigure` writes for a chord that is real and
   * has no symbol - which is why this is a field of its own rather than
   * `isUnlabelled` widened to cover both. A `♯VI?` card *has* a numeral: what it
   * has not got is a name.
   *
   * Carried rather than recovered from the `?`, for exactly the reason
   * `isUnlabelled` gives one field up.
   *
   * **The card does not read it**, and that is the rule rather than an omission:
   * a card prints what the namer gives it, and `?` there is the refusal working -
   * unlabelled rather than mislabelled. The relabel chip reads it, because its
   * menu is a menu of *names* and a name the app has not got cannot be offered as
   * one. See `buildAlternates` in `relabel-chip-view.ts`.
   */
  hasName: boolean;
  numeral: string;
  name: string;
  /** The chord as a phrase to be read aloud: `G major`. */
  subject: string;
  /** What else there is to say about it: its position, or why it has no numeral. */
  detail: string;
}

/** A card with no numeral, the road it took, and the reason it says aloud. */
function unlabelled(road: UnlabelledRoad, detail: string): CardDescription {
  return {
    isUnlabelled: true,
    road,
    // No numeral and no name: this branch has nothing to print in either slot.
    hasName: false,
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
