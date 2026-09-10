import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  RelabelNotice,
  RollNote,
  SlotHarmony,
  SlotOwnership,
  literalHarmony
} from '../models/progression.model';
import {
  boundNote,
  boundNoteLength,
  boundNoteStart,
  boundVelocity,
  replaceNote,
  sameNotes,
  sameOwnership
} from './progression-edit';
import { ProgressionStore } from './progression-history';
import { recognise } from './progression-recognise';

/**
 * The scale a recognised chord is expressed in, for the key the document is in.
 *
 * A callback rather than `ProgressionKeyContext` itself, and the difference is
 * the whole of what keeps this file's seam. The editor needs one answer - the
 * intervals to write a degree against - and the context answers four more
 * questions besides, `spellingFor` and `findScale` among them, none of which a
 * note setter has any business asking. `ProgressionDegreeEditor` takes the whole
 * context deliberately and its docstring argues why that is different: every
 * method on it restates a chord, and a restated chord has to be rebuilt.
 *
 * Null where the key cannot stack thirds, which is `chordScaleFor`'s own answer
 * carried through: there is no degree to express anything as, so recognition
 * does not run at all.
 */
export type ChordScaleFor = (key: ProgressionKey) => readonly number[] | null;

/**
 * How a pointer-driven edit should be recorded. See
 * `ProgressionService.setSlotLength`, which was the first of them, and
 * `CommitRun` in `progression-history.ts` for what a run is.
 *
 * Shared by every setter a drag drives - the strip's resize and all three of
 * the roll's gestures - because they all have the same problem: the card, or
 * the note, has to be where it is being dragged to, so the setter commits on
 * every threshold the pointer crosses.
 */
export interface EditOptions {
  /**
   * Whether this is a continuation of the edit before it rather than a new one.
   * A continuation folds into that entry instead of adding its own, so one drag
   * is one undo step however many thresholds it crosses.
   */
  coalesce?: boolean;

  /**
   * Whether to leave the recogniser for the end of the gesture.
   *
   * Set by every commit a *drag* makes, and by nothing else. A drag commits on
   * every threshold the pointer crosses, so recognising on each of them would
   * relabel the slot once per grid line the note passes over - `I`, `Isus4`,
   * `I`, `♭II`, `Isus4` - which is a card flickering through chords the user is
   * only travelling through. The roll calls `settlePitchGesture` on pointerup
   * instead, and that commit folds into the drag's own undo entry, so the notes
   * and the label they turned out to mean are one step back together.
   *
   * A one-shot edit - a double-click add, a delete, an arrow-key nudge - passes
   * nothing and recognises inside its own commit, because there is no later
   * moment to defer to.
   */
  deferRecognition?: boolean;
}

/**
 * The roll's note setters: what a user writes into a slot by hand, and which
 * aspect of it they thereby claim.
 *
 * This was the middle of `ProgressionService`, and like `ProgressionStore` it
 * comes out on a seam rather than at a line count. Every method below works out
 * a list of notes, adds the claim the gesture makes, and hands the pair to
 * `commitSlot`. `writeNotes` is the funnel they share and it is here with them,
 * so the run-key discipline and the claim rules its docstring argues are
 * enforced beside the code they are rules about.
 *
 * What did not come with it is `resetSlotToChord`, which reads like a fifth
 * roll setter and is not one: it rebuilds the block chord from the degree, so
 * it needs `regenerate` and `canBuildChords` - harmony, and the one thing this
 * file must not learn.
 *
 * ## The seam, restated where M3 Task 9 moved it
 *
 * It used to read "none of it resolves a scale", and after this task that is
 * still true but no longer says enough: recognition is here, and a recognised
 * chord has to be written as a degree of *something*. The line that holds is
 * one word narrower and one word sharper - **nothing here resolves a scale, and
 * nothing here rebuilds a chord.** The scale arrives as a `ChordScaleFor`
 * callback the service hands over at construction, so this file still does not
 * know that a key carries a scale id or that resolving one means asking
 * `MusicTheoryService`; and everything recognition writes is a *label* over
 * notes the user played, so no method below ever generates a note from a
 * degree. That second half is what keeps `resetSlotToChord` where it is, and
 * `ProgressionKeyContext`'s own docstring makes the same point from the other
 * end: the seam holds only while what this editor is handed cannot rebuild a
 * chord.
 *
 * The three chip actions - `chooseRelabelAlternate`, `revertRelabel`,
 * `keepAsLiteral` - are here for the same reason rather than on the service:
 * each one takes back or amends a label recognition wrote, each keeps every note
 * exactly as it is, and none of them needs a scale at all.
 *
 * ## Plain, not injectable, and owned rather than provided
 *
 * `ProgressionService` constructs one, keeps it private, and delegates to it in
 * one line per setter. The reason is `ProgressionStore`'s: "every mutation goes
 * through one commit" holds only while there is one door, and an injectable
 * editor would be a second one a component could reach for. It is also why this
 * takes the store rather than the service - it is handed the narrow thing it
 * needs and can learn nothing else through it.
 */
export class ProgressionNoteEditor {
  constructor(
    private readonly store: ProgressionStore,
    private readonly chordScaleFor: ChordScaleFor
  ) {}

  /**
   * Replaces a slot's notes, and claims its pitches.
   *
   * The roll's coarse edit: a pitch dragged, a note added, a note deleted. The
   * count is part of what it writes, because a note *is* a pitch - a user who
   * adds one owns the count, and `mergeNotes` reads the list length off
   * whichever side owns the pitches.
   *
   * ## It claims the pitches and nothing else, which has a consequence
   *
   * The notes it stores carry timing and velocity too, and those are **not**
   * claimed - so a note placed at beat 2 through this setter alone will be
   * blocked back to beat 0 by the next regeneration, and its velocity reset.
   * That is deliberate and it is the narrow reading: claiming all three from
   * here would collapse per-aspect ownership back into the single boolean M2
   * exists to replace, one setter at a time, and a pitch drag would silently
   * tell the app the user wrote the rhythm.
   *
   * So a gesture that *places* a note in time is a timing edit as well as a
   * pitch one, and this is not the setter for it: **`placeNotes` is**. This
   * used to tell the caller to follow with `setNoteTiming` and to lean on
   * coalescing to keep the pair one undo step, which was a promise the service
   * could not keep - the two runs are named differently on purpose, so `commit`
   * refuses to fold them and no argument a component can pass makes it.
   *
   * Every note is bounded on the way in - see `boundNote`, which passes `midi`
   * through untouched and says why.
   *
   * Answers whether it recorded anything; `writeNotes` says what a caller does
   * with that.
   */
  setSlotNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): boolean {
    return this.writeNotes(
      id,
      { pitches: true },
      () => notes.map(boundNote),
      `notes:${id}`,
      options
    );
  }

  /**
   * Replaces a slot's notes as `setSlotNotes` does, and claims the timing with
   * the pitches: the setter for a gesture that puts a note *somewhere*.
   *
   * Double-click to add, and a drag that moves a note in pitch and time at
   * once. Both say two things about the slot in one movement - these are the
   * pitches, and this is when they sound - so both claims are the user's, and
   * both are recorded in **one commit**.
   *
   * ## Why a setter and not a run key the caller names
   *
   * The alternative was to let a caller pass its own key on `EditOptions` and
   * coalesce `setSlotNotes` and `setNoteTiming` into a single undo entry. That
   * would have made the pair *undo* as one step while still committing twice,
   * so the state between them - the note present, snapped back to beat 0,
   * pitches owned and timing not - would still be published, rendered, and
   * available to anything reading `getState()`. It is a state no gesture ever
   * meant and no user ever asked for, and one commit is how it stops existing
   * rather than merely stops being reachable by undo.
   *
   * It also keeps the run keys this module's own. A caller-supplied key is a
   * caller-supplied way to fold two unrelated gestures together, which is the
   * one thing the per-gesture keying is for.
   *
   * The narrow reading `setSlotNotes` argues for is intact: neither setter
   * claims all three, the gesture still chooses what it claims, and a pitch
   * drag that moves nothing in time still says nothing about the rhythm - it
   * just calls the other one.
   *
   * Answers whether it recorded anything; `writeNotes` says what a caller does
   * with that.
   */
  placeNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): boolean {
    return this.writeNotes(
      id,
      { pitches: true, timing: true },
      () => notes.map(boundNote),
      `place:${id}`,
      options
    );
  }

  /**
   * Moves or resizes one note, and claims the slot's timing.
   *
   * Timing only: the pitch and the velocity of the note come through unchanged,
   * and neither of the other two claims is touched. That is the M1 rule this
   * milestone must not break - **a timing edit never changes what chord a slot
   * is**, which is what M3's recogniser depends on.
   *
   * `startBeat` is clamped at 0 and `lengthBeats` at `MIN_NOTE_BEATS`, with no
   * ceiling on either: a note may sit or run past the end of the slot that
   * holds it, which is the same answer `retimeNotes` gives a shortened slot.
   * An index the slot has no note at is a no-op rather than a throw - and one
   * the caller can see, because this answers whether it recorded anything.
   * `writeNotes` says what a caller does with that.
   */
  setNoteTiming(
    id: string,
    noteIndex: number,
    startBeat: number,
    lengthBeats: number,
    options: EditOptions = {}
  ): boolean {
    return this.writeNotes(
      id,
      { timing: true },
      slot =>
        replaceNote(slot.notes, noteIndex, note => ({
          ...note,
          startBeat: boundNoteStart(startBeat),
          lengthBeats: boundNoteLength(lengthBeats)
        })),
      `timing:${id}:${noteIndex}`,
      options
    );
  }

  /**
   * Sets one note's velocity, and claims the slot's velocities.
   *
   * Clamped into MIDI's 1-127 and rounded to a byte; `boundVelocity` carries
   * both arguments. The claim lands even when the number does not move - a user
   * who drags the control and lets go on the value it started at has still said
   * the dynamics of that slot are theirs.
   *
   * Answers whether it recorded anything; `writeNotes` says what a caller does
   * with that.
   */
  setNoteVelocity(
    id: string,
    noteIndex: number,
    velocity: number,
    options: EditOptions = {}
  ): boolean {
    return this.writeNotes(
      id,
      { velocity: true },
      slot =>
        replaceNote(slot.notes, noteIndex, note => ({
          ...note,
          velocity: boundVelocity(velocity)
        })),
      `velocity:${id}:${noteIndex}`,
      options
    );
  }

  /**
   * The shape all four of the roll's setters share: work out the new notes,
   * add the claim the gesture makes, and record the pair as one step of
   * whatever drag is under way.
   *
   * `edit` returns null for a gesture with nothing to act on - an index the
   * slot has no note at - which must not open an undo entry. That is a
   * different answer from "the notes did not change", which still may: the
   * comparison below is over the notes **and** the claim together, because the
   * first touch of a control is a change even when the number it writes is the
   * one already there. Comparing only the numbers would drop that claim
   * silently, and a claim dropped is a hand edit the next key change erases.
   *
   * ## How far the run key protects a caller, which is not as far as it reads
   *
   * The key names the gesture, and each setter picks the finest name it honestly
   * can. `setNoteTiming` and `setNoteVelocity` act on one note and key their
   * runs by it, so a continuation meant for one note cannot fold into the entry
   * another note's drag opened. `setSlotNotes` and `placeNotes` write the whole
   * list and so can only key by **slot** - there is no note for them to name.
   *
   * The consequence is a discipline rather than a guarantee, and Task 7 has to
   * keep it: two pitch drags on two different notes of the same slot fold into
   * one undo entry unless each pointerdown passes `coalesce: false`. That is
   * the same rule `ProgressionService.setSlotLength` states for two consecutive
   * resizes of one card - nothing below the pointer, here or there, can see
   * where one gesture ends and the next begins - but it is easy to read the
   * keying as covering it, and it does not.
   *
   * ## Why it answers, and what the answer is for
   *
   * It returns whether it actually opened or extended an undo entry. That is
   * the other half of the discipline above, and it is not decoration: the three
   * ways out below all decline *silently*, so a caller tracking "have I
   * committed yet in this gesture" by counting its own calls is tracking
   * something else. A gesture whose first commit is refused and then sets that
   * flag anyway sends `coalesce: true` on its second - and `commit` honours a
   * continuation on the run key alone, which for `placeNotes` names only the
   * slot. The second commit would fold into the entry the *previous* gesture
   * left, and one undo would take both back.
   *
   * The guards in the roll's own gesture arithmetic happen to make that
   * unreachable today. A guarantee that rests on two independent guards
   * agreeing is a coincidence, not an invariant, so the flag is made able to
   * mean what its name says instead.
   *
   * Nothing here bounds a value the setters did not already bound; `settle()`
   * inside `commit` is still the funnel, and a value of the wrong kind throws
   * out of it having published nothing.
   */
  private writeNotes(
    id: string,
    claims: Partial<SlotOwnership>,
    edit: (slot: ChordSlot) => readonly RollNote[] | null,
    runKey: string,
    options: EditOptions
  ): boolean {
    const slot = this.store.slot(id);
    if (!slot) return false;

    const notes = edit(slot);
    if (notes === null) return false;

    // The comparison is against the notes as they arrive, before `settle()` has
    // seen them, where the slot's own notes have been through it already. That
    // is exact today because every value a setter can produce normalises to
    // itself - the bounds are applied on the way in and `normalizeRollNote`
    // only checks kinds. A normaliser that ever *transformed* a note rather
    // than clamping it would break the symmetry, and this guard would start
    // recording no-ops as edits. It is a note rather than a defence: comparing
    // settled notes here would mean settling twice per keystroke.
    const owned: SlotOwnership = { ...slot.owned, ...claims };
    if (sameOwnership(owned, slot.owned) && sameNotes(notes, slot.notes)) return false;

    // The spread is what turns the callback's `readonly` promise into the
    // mutable field `ChordSlot.notes` is, and it is a type conversion rather
    // than a defence: every callback above already builds a fresh array, and
    // `normalizeChordSlot` rebuilds every note again inside `settle()`.
    const written: ChordSlot = { ...slot, notes: [...notes], owned };

    // **Only a setter that claims the pitches may recognise.** That is the M1
    // rule the whole milestone rests on, stated here rather than at the two
    // setters that pass the claim, so that a fifth setter arriving with
    // `{ timing: true }` inherits the refusal instead of having to remember it.
    // `setNoteTiming` and `setNoteVelocity` can change *which* notes are
    // structural - a chord tone dragged off the downbeat - and must still never
    // change what the slot is called.
    const read =
      claims.pitches === true && options.deferRecognition !== true
        ? this.recognised(written, slot.notes)
        : null;

    this.store.commitSlot(
      id,
      () => (read === null ? written : { ...written, harmony: read.harmony }),
      { key: runKey, continues: options.coalesce === true },
      read?.notice ?? null
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Recognition
  // -------------------------------------------------------------------------

  /**
   * Reads a drag's finished notes back as a chord, in the drag's own undo entry.
   *
   * The other half of `deferRecognition`: the roll's pointerup calls this with
   * the notes the slot held when the gesture began, so the recogniser compares
   * the two ends of the whole drag rather than the two ends of one threshold
   * crossing. `before` is the roll's own `Gesture.notes` snapshot, which is why
   * this takes it rather than digging the previous document out of the undo
   * stack: the stack holds the *document* before whatever entry is on top, and
   * for a coalesced drag that is the document before the drag's first commit
   * only by an accident of how the run happens to have folded.
   *
   * ## The run key, and the discipline it inherits
   *
   * It commits under `place:${id}` with `continues: true`, which is what folds
   * the label into the drag's entry so that **one undo takes back the notes and
   * the new label together**. That only works while the drag really opened an
   * entry, and `ProgressionStore.commit` honours a continuation on the run key
   * alone - so a call made after a gesture that committed nothing would fold
   * into whatever entry happened to be on top, which is the previous gesture's.
   * The roll therefore calls this only when `move.committed` is true, and
   * `move.committed` is set from what `placeNotes` *answered*.
   *
   * This answers on the same terms and for the same reason: whether it recorded
   * anything. A gesture that ended on the notes it started with recognises
   * nothing and commits nothing, and a caller counting its own calls would be
   * counting something else.
   */
  settlePitchGesture(id: string, before: readonly RollNote[]): boolean {
    const slot = this.store.slot(id);
    if (!slot) return false;

    const read = this.recognised(slot, before);
    if (read === null) return false;

    this.store.commitSlot(
      id,
      () => ({ ...slot, harmony: read.harmony }),
      { key: `place:${id}`, continues: true },
      read.notice
    );
    return true;
  }

  /**
   * Takes one of the chip's runners-up instead of the reading that won.
   *
   * Its own undo entry, not a continuation of anything: the relabel it replaces
   * is already committed, and a user who picks `IVsus2` over `Isus4` has made a
   * second decision that should be separately reversible.
   *
   * The notes are untouched, which is the whole point - the alternates are other
   * *names* for the notes that are there, and picking one is a spelling choice
   * rather than an edit. Nothing is regenerated for the same reason, and it is
   * also the reason this can live in a file that cannot rebuild a chord.
   *
   * The degree arrives from `RelabelNotice.alternates`, which the recogniser
   * built and `expressInKey` already vetted; it goes through `settle()` on the
   * way in like every other value, so a caller that invents one gets the
   * normalisation's answer rather than a slot the model could not have made.
   */
  chooseRelabelAlternate(id: string, degree: ChordDegree): boolean {
    return this.relabelTo(id, { kind: 'degree', degree });
  }

  /**
   * Puts the label the slot had back, and **keeps the notes**.
   *
   * *Back to `I`* on the chip. The user played something the recogniser read as
   * a different chord and is saying it is still the old one - a passing
   * dissonance, an added colour they do not want named. So the numeral returns
   * and not one note moves: reverting is not an undo, and offering it as one
   * would throw away the edit that was the point of the gesture.
   *
   * It reads the previous harmony off the notice rather than taking an argument,
   * because the notice is the only record of it - the document holds the *new*
   * label by the time the chip is on screen. A notice for some other slot is no
   * evidence about this one and is refused, which is the same guard
   * `keepAsLiteral` needs and for the same reason.
   */
  revertRelabel(id: string): boolean {
    const notice = this.store.relabel;
    if (notice === null || notice.slotId !== id) return false;

    return this.relabelTo(id, notice.previous);
  }

  /**
   * Says this slot is notes and not a chord, and means it.
   *
   * `user-detached` rather than `unrecognised`, and the difference is the whole
   * of what this button is for: `recognise` never re-reads a detached slot, so
   * the next pitch edit leaves the label alone instead of quietly putting a
   * numeral back on a slot the user has just said should not have one. An
   * `unrecognised` slot is the app failing to name something; a detached one is
   * the user declining to have it named.
   *
   * It keeps the degree it had as `from`, through `literalHarmony`, so Reset to
   * chord still leads back out - a door with no way back is not a door, which is
   * the argument `resetSlotToChord` makes at length. The degree kept is the one
   * the slot is carrying *now*, which after a relabel is the recogniser's
   * reading rather than the label before it: that is what the notes actually
   * sound, and it is the better chord to rebuild from.
   */
  keepAsLiteral(id: string): boolean {
    const slot = this.store.slot(id);
    if (!slot) return false;

    return this.relabelTo(id, literalHarmony('user-detached', degreeOf(slot.harmony)));
  }

  /**
   * Writes one harmony over a slot, keeping every note, as its own undo entry.
   *
   * The shape the three chip actions share. No notice goes with it: the chip is
   * being *answered*, so the commit's default takes it down - which is the
   * behaviour to want at every one of the three, since after any of them the
   * slot says what the user asked it to say and there is nothing left to offer.
   *
   * A harmony the slot already holds records nothing, on `editDegree`'s
   * argument: the chip's own *Back to* is reachable twice if a second notice
   * arrives for the same slot, and an undo entry for a button that changed
   * nothing is worse than none.
   */
  private relabelTo(id: string, harmony: SlotHarmony): boolean {
    const slot = this.store.slot(id);
    if (!slot || sameHarmony(slot.harmony, harmony)) return false;

    this.store.commitSlot(id, () => ({ ...slot, harmony }));
    return true;
  }

  /**
   * What the recogniser makes of a written slot, or null when it makes nothing.
   *
   * The one place recognition is called from, so the four things a caller must
   * not get wrong are settled once: the key comes off the document rather than
   * from a caller, the scale comes through the callback and a key that cannot
   * stack thirds simply does not recognise, `unchanged` is a null here rather
   * than a harmony equal to the one already stored - so a caller cannot commit a
   * no-op believing it recognised something - and the notice is built beside the
   * harmony it describes rather than by whoever commits it.
   *
   * `slot` is the slot **after** the edit, still carrying its old label, which is
   * what `recognise` needs: `before` says what was sounding and the harmony says
   * what it was called.
   */
  private recognised(
    slot: ChordSlot,
    before: readonly RollNote[]
  ): { harmony: SlotHarmony; notice: RelabelNotice } | null {
    const key = this.store.doc.key;
    const scale = this.chordScaleFor(key);
    if (scale === null) return null;

    const outcome = recognise(before, slot, key, scale);
    if (outcome.kind === 'unchanged') return null;

    const harmony: SlotHarmony =
      outcome.kind === 'relabel'
        ? { kind: 'degree', degree: outcome.degree }
        : literalHarmony('unrecognised', degreeOf(slot.harmony));

    return {
      harmony,
      notice: {
        slotId: slot.id,
        previous: slot.harmony,
        current: harmony,
        alternates: outcome.kind === 'relabel' ? outcome.alternates : []
      }
    };
  }
}

/**
 * The degree a slot is carrying, whichever kind of harmony it is carrying it in.
 *
 * A degree slot's own, or the one a literal slot kept when it lost its label.
 * Both of the writers below want the same thing - a chord to keep as `from` -
 * and neither cares which branch it came from. `?? null` rather than trusting
 * the field, on `SlotHarmony.from`'s own terms: everything through the funnel
 * holds it, and a slot built a line ago may not have been.
 */
function degreeOf(harmony: SlotHarmony): ChordDegree | null {
  return harmony.kind === 'degree' ? harmony.degree : harmony.from ?? null;
}

/**
 * Whether two harmonies say the same thing, for the no-op guard above.
 *
 * A reference comparison on the degree, deliberately: the only caller compares a
 * slot's own harmony with one taken off a notice or rebuilt from it, and a
 * structural comparison would be `sameDegree` - which lives in
 * `progression-edit.ts` and is about a chord the generator is going to rebuild.
 * Here the question is narrower and the cheap answer is the honest one: two
 * degrees that are not the same object may still be equal, and committing that
 * costs one undo entry and changes nothing, where the alternative is a second
 * copy of a comparison that already exists.
 */
function sameHarmony(left: SlotHarmony, right: SlotHarmony): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'degree' && right.kind === 'degree') return left.degree === right.degree;

  return (
    left.kind === 'literal' &&
    right.kind === 'literal' &&
    left.reason === right.reason &&
    (left.from ?? null) === (right.from ?? null)
  );
}
