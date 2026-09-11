import {
  ChordDegree,
  ProgressionState,
  RelabelNotice
} from '../../../../models/progression.model';
import { CardDescription, describeSlot } from '../progression-strip/progression-strip-cards';

/**
 * What the chip says about the relabel the last edit made.
 *
 * Pure, beside the component, on the `progression-strip-cards.ts` and
 * `piano-roll-view.ts` precedent and for their reason: a published state goes in
 * and a view model comes out, with no Angular, no DOM and no injector, so what
 * the chip says can be checked against the recogniser's own output rather than
 * against a rendered template.
 *
 * ## The rule it exists to keep
 *
 * The design's containment rule is that a relabel is **never silent**: the app
 * may change a label, but not without saying so and not without a way back. This
 * is the saying-so. Every field below is one of three things - what the label is
 * now, what it was, or a way back to it - and there is nothing else here.
 *
 * ## It names a slot the way the card names it
 *
 * Both ends of a notice and every alternate go through `describeSlot`, the
 * strip's own. That is not reuse for its own sake: the chip sits under a strip
 * that is naming the same slot at the same moment, and a chip reading `Isus4`
 * over a card reading `IV` would be two answers about one chord. One function
 * gives one answer, including about the case where there is no answer - a key
 * that cannot stack thirds names neither the card nor the chip, and says so in
 * the same words.
 *
 * ## Why `null` is an answer, and not only for "nothing happened"
 *
 * There are two of them, and the second is the one worth writing down.
 *
 *  - **No notice.** Nothing was relabelled, so there is nothing to say. Silence
 *    here is not the silence the rule forbids: the rule is about a label the app
 *    changed, and it changed none.
 *  - **A notice for a slot other than the selected one.** The chip is in the
 *    roll, the roll shows the selected slot, and *Back to* on a chip over some
 *    other slot's notice is a control that does nothing - `revertRelabel`
 *    refuses outright when `RelabelNotice.slotId` is not the id it was given,
 *    because a notice for another slot is no evidence about this one. A button
 *    that cannot act is worse than no button, so the chip is not drawn.
 *
 * The second is close to unreachable and is written down rather than assumed: a
 * pitch gesture can only edit the slot the roll is showing, and the strip cannot
 * be clicked while a pointer is held down over the roll. It is a guard against
 * the page growing a second way to change the selection, which is the kind of
 * change that would otherwise leave a dead control behind it.
 */

/** What the chip says in place of a numeral when nothing matched. */
const NO_MATCH = 'No chord matches';

/**
 * What the chip **prints** in a numeral's place when there is no numeral.
 *
 * The printed form only - the `(was …)` line and the *Back to* label, both of
 * which sit where a numeral otherwise goes and are read against the card's own
 * em dash. Everything the chip *says* aloud goes through `describeSlot`'s
 * `subject`, which calls the same thing an `unlabelled chord`; this used to be
 * substituted there as well, so the chip and the card an inch below it gave two
 * phrasings for one slot while the module note above claimed they gave one.
 */
const NO_NUMERAL = 'unlabelled';

/**
 * What the chip's controls promise, and the reason the button names for itself.
 *
 * On the chip's own button through `aria-describedby`, rather than in the live
 * region alone: a region announces once, to whoever was listening at the time,
 * and a user who arrives at the chip afterwards - by tab, or by moving a screen
 * reader's cursor - has no way to ask what it is for. A control that carries its
 * own reason can always be asked. The same argument is what makes the roll's
 * Reset to chord button focusable while it is unavailable.
 */
const CHIP_HINT =
  'Your edit changed what this chord is called. The notes are kept whichever ' +
  'name you choose, and going back changes the label only.';

/**
 * One runner-up from the recogniser: another name for the notes that are there.
 *
 * A *name*, and only the runners-up that have one reach here - see
 * `buildAlternates`, which argues why the ones that have none are dropped and why
 * they are dropped at this layer.
 */
export interface RelabelAlternate {
  /**
   * The degree to dispatch. Carried whole rather than rebuilt from the numeral,
   * because it is the recogniser's own reading and `chooseRelabelAlternate`
   * takes exactly that.
   */
  degree: ChordDegree;
  /** Identity for `trackBy`. The numeral and the name, which no two share. */
  key: string;
  numeral: string;
  name: string;
  /** The chord as a phrase: `G dominant seventh`. Used in the spoken label. */
  spoken: string;
  /** What the menu item says aloud. See `StripCard.label`, which argues it. */
  label: string;
}

/** The whole of what the chip draws from one published state. */
export interface RelabelChipView {
  /** The slot the notice names, which is also the selected one. */
  slotId: string;
  /** `V7♭9`, or `No chord matches`. */
  headline: string;
  /** `(was V9)`. */
  previousText: string;
  /** What the chip's button says aloud, announcement and affordance together. */
  buttonLabel: string;
  /** The menu's own name, for the `role="menu"` container. */
  menuLabel: string;
  /** "Relabelled G dominant seventh flat nine, was G dominant ninth". */
  announcement: string;
  alternates: readonly RelabelAlternate[];
  /** `Back to V9`. */
  revertLabel: string;
  revertAriaLabel: string;
  /** What the live region says once *Back to* has been taken. */
  revertedAnnouncement: string;
  keepLabel: string;
  keepAriaLabel: string;
  /** What the live region says once the slot has been kept as notes. */
  keptAnnouncement: string;
  /** The sentence the button points `aria-describedby` at. See `CHIP_HINT`. */
  hint: string;
}

/**
 * The chip for a published state, or null when there is nothing to show.
 *
 * See the module note for the two roads to null; neither of them is a failure.
 */
export function buildRelabelChipView(state: ProgressionState): RelabelChipView | null {
  const notice = state.relabel;
  if (notice === null) return null;
  if (notice.slotId !== state.selectedSlotId) return null;

  // The strip's gate, read exactly as `buildStripView` reads it, so that the
  // chip and the cards under it refuse to name a chord in the same keys.
  const intervals = state.canBuildChords && state.keyScale ? state.keyScale.intervals : null;
  const key = state.doc.key;

  const current = describeSlot(notice.current, key, intervals);
  const previous = describeSlot(notice.previous, key, intervals);

  const headline = current.isUnlabelled ? NO_MATCH : current.numeral;
  const wasNumeral = previous.isUnlabelled ? NO_NUMERAL : previous.numeral;
  const announcement = announce(current, previous);

  return {
    slotId: notice.slotId,
    headline,
    previousText: `(was ${wasNumeral})`,
    // The numeral is dropped from the spoken form and the chord said in words,
    // exactly as the strip and the palette do it: read aloud, `V7♭9` is a run of
    // letters and punctuation, and the height it carries is already in the name.
    buttonLabel: `${announcement}. Other names for these notes.`,
    menuLabel: 'Other names for these notes',
    announcement,
    alternates: buildAlternates(notice, state, intervals),
    revertLabel: `Back to ${wasNumeral}`,
    // The two commands part company only when the slot *came from* an unlabelled
    // state: *Back to unlabelled* and *Keep as literal* then leave the card
    // looking identical, and the difference is whether the next edit may name it
    // again. Neither label said so, so both say so now - and only on the branch
    // where they are otherwise indistinguishable, because "this slot can be read
    // as a chord again" is noise on a *Back to V9*.
    revertAriaLabel: previous.isUnlabelled
      ? `Back to ${previous.subject}, keeping the notes. A later edit can still name it.`
      : `Back to ${previous.subject}, keeping the notes`,
    revertedAnnouncement: `Back to ${previous.subject}. The notes are unchanged.`,
    keepLabel: 'Keep as literal',
    keepAriaLabel: 'Keep as notes rather than a chord, and stop reading them as one',
    keptAnnouncement: 'Kept as notes. This chord has no numeral now.',
    hint: CHIP_HINT
  };
}

/**
 * What the region says when the chip appears.
 *
 * Two sentences rather than one, because the two cases are different facts: the
 * app found another name for these notes, or it found none. The second is the
 * one the rule was written for - a slot losing its numeral is the largest thing
 * an edit can do to it, and it is exactly the change a sighted user sees as a
 * dashed border and a screen reader would otherwise see as nothing.
 */
function announce(current: CardDescription, previous: CardDescription): string {
  // Both ends named by `describeSlot`'s `subject`, with nothing substituted for
  // it - which is what the module note's "says it in the same words" actually
  // requires. `unlabelled` used to be put here in place of `unlabelled chord`,
  // so the chip and the card an inch below it gave two phrasings for one slot.
  return current.isUnlabelled
    ? `No chord matches these notes, was ${previous.subject}`
    : `Relabelled ${current.subject}, was ${previous.subject}`;
}

/**
 * The runners-up, named - and only the ones there is a name for.
 *
 * Empty for a literal notice, and that is the recogniser's answer rather than
 * this function's: nothing parsed, so there are no other readings to offer. It
 * is also empty when the key cannot name a chord at all, because a numeral built
 * from a scale that cannot stack thirds is the mislabel this whole design
 * refuses - `describeSlot` would answer with the unlabelled card's em dash, and
 * a menu of em dashes is not a choice.
 *
 * ## And the runners-up it drops, one at a time
 *
 * A reading this key can *express* as a degree but the namer cannot *name* is
 * left out. The recogniser ranks by what the notes make of a key's degrees and
 * knows nothing about figures, so it will happily rank a parse whose composed
 * name is `composeFigure`'s refusal: C-E-G-B♭ edited into a slot offers `♯VI?` /
 * `A#?` and `V?` / `G?` among its runners-up, which say aloud *Label as A sharp
 * unnamed chord* and *Label as G unnamed chord*.
 *
 * Those items are not the dead control the module note forbids - they dispatch a
 * real degree and the card would change - but a menu whose whole purpose is to
 * offer a *better name* cannot offer the absence of one. `?` on a card is the
 * honest refusal the page is built on: the app has no name for these notes and
 * says so. An item in a list of names is not a refusal, it is an invitation, and
 * *Label as G unnamed chord* is not a choice a user can make on any grounds.
 *
 * **Here rather than in `recognise`**, on the two-layer argument the whole of
 * this file rests on. The recogniser's alternates are a fact about the *model* -
 * which chords these notes could be, in this key's degrees - and a fact that
 * `expressNotesInKey`'s ranking shares with it; the naming is a fact about what
 * this app can *write*, which lives in `progression-chord-names.ts` and which the
 * harmony layer deliberately knows nothing about (that module's header: "names
 * know about qualities, qualities know nothing about names"). Filtering there
 * would invert that dependency to make a menu shorter. This function is already
 * the one that turns degrees into words, and it is already the one that answers
 * `[]` when the key cannot name any of them - this is the same rule at one chord's
 * resolution rather than a key's.
 *
 * **The selected label is untouched by all of this.** A slot whose *best* reading
 * has no name still gets that reading, and the card still prints `?`, because
 * that is what the chord is. Only the offer of an unnameable alternative goes.
 *
 * Dropping every one of them is an ordinary answer and not a broken menu: *Back
 * to X* and *Keep as literal* are the two commands that always apply, and the
 * template draws both whatever this returns.
 */
function buildAlternates(
  notice: RelabelNotice,
  state: ProgressionState,
  intervals: readonly number[] | null
): readonly RelabelAlternate[] {
  if (intervals === null) return [];

  const named: RelabelAlternate[] = [];

  for (const degree of notice.alternates) {
    const described = describeSlot({ kind: 'degree', degree }, state.doc.key, intervals);
    if (!described.hasName) continue;

    named.push({
      degree,
      key: `${described.numeral}:${described.name}`,
      numeral: described.numeral,
      name: described.name,
      spoken: described.subject,
      label: `Label as ${described.subject}`
    });
  }

  return named;
}
