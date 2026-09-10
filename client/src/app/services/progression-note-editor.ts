import { ChordSlot, RollNote, SlotOwnership } from '../models/progression.model';
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
}

/**
 * The roll's note setters: what a user writes into a slot by hand, and which
 * aspect of it they thereby claim.
 *
 * This was the middle of `ProgressionService`, and like `ProgressionStore` it
 * comes out on a seam rather than at a line count. The seam is that **none of
 * it resolves a scale.** Every method below works out a list of notes, adds the
 * claim the gesture makes, and hands the pair to `commitSlot`; not one of them
 * asks what chord the slot is, what key the document is in, or whether thirds
 * can be stacked through it. `writeNotes` is the funnel they share and it is
 * here with them, so the run-key discipline and the claim rules its docstring
 * argues are enforced beside the code they are rules about.
 *
 * What did not come with it is `resetSlotToChord`, which reads like a fifth
 * roll setter and is not one: it rebuilds the block chord from the degree, so
 * it needs `regenerate` and `canBuildChords` - harmony, and the one thing this
 * file must not learn.
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
  constructor(private readonly store: ProgressionStore) {}

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
    this.store.commitSlot(id, () => ({ ...slot, notes: [...notes], owned }), {
      key: runKey,
      continues: options.coalesce === true
    });
    return true;
  }
}
