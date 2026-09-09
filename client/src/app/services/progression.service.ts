import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CHORD_EXTENTS,
  createOwnership,
  normalizeChordSlot,
  normalizeProgressionKey
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  ProgressionState,
  RollNote,
  SlotOwnership,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  boundNote,
  boundNoteLength,
  boundNoteStart,
  boundVelocity,
  keyTransposeInterval,
  nearestExtent,
  reclaimPitches,
  regenerateSlot,
  replaceNote,
  retimeNotes,
  sameDegree,
  sameNotes,
  sameOwnership
} from './progression-edit';
import { ChordExtent, NamedQuality, isHeptatonic } from './progression-harmony';
import { CommitRun, HistoryDepth, ProgressionStore } from './progression-history';
import { Scale } from '../models/music-theory.model';
import { keySignatureKind } from './circle-of-fifths.data';
import { MusicTheoryService } from './music-theory.service';

/**
 * How a pointer-driven edit should be recorded. See `setSlotLength`, which was
 * the first of them, and `CommitRun` in `progression-history.ts` for what a run
 * is.
 *
 * Shared by every setter a drag drives - the strip's resize and all three of
 * the roll's - because they all have the same problem: the card, or the note,
 * has to be where it is being dragged to, so the setter commits on every
 * threshold the pointer crosses.
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
 * A chord to put in a slot: the four fields that decide what it sounds.
 *
 * `appendChord` and `setSlotChord` take one. It is a `ChordDegree` minus the
 * three fields a *voicing* owns - inversion, suspension and octave - because a
 * caller naming a chord is not thereby choosing how it is laid out: an appended
 * chord takes the factory's voicing and a retuned one keeps the voicing it had.
 *
 * `ChordOption` from `progression-vocabulary.ts` satisfies this structurally,
 * so the palette hands one of its own options straight over and the service
 * stays ignorant of that module. Only the four fields below are read;
 * `chosen()` copies them one at a time and says why that matters.
 */
export interface ChordChoice {
  /** 0-6, as `ChordDegree.degree`. Outside it `createDegreeSlot` throws. */
  degree: number;
  /** Semitones the root is displaced by. Clamped by the normalisation. */
  alter: number;
  /**
   * The shape, or `null` for "as the key gives it".
   *
   * `null` with a non-zero `alter` is the one pair `normalizeChordDegree`
   * refuses outright: a displaced root has no diatonic stack to fall back on.
   */
  quality: NamedQuality | null;
  /** How high the shape stands. A quality names one; see `setSlotChord`. */
  extent: ChordExtent;
}

/**
 * The harmony of a progression: what a chord means in a key, and what the app
 * will refuse to make of one.
 *
 * ## It no longer holds the document; it owns something that does
 *
 * `ProgressionStore` is the document, the strip's selection and undo/redo, and
 * this service constructs one and keeps it to itself. The public API is
 * unchanged - `getState`, `doc`, `undo`, `redo`, `replaceDocument` and
 * `selectSlot` are one-line delegations - because the split is between two
 * kinds of knowledge rather than between two APIs.
 *
 * What went is a mechanism whose every rule is enforced by a guard beside it:
 * settle-then-push-then-publish, run coalescing, eviction at `MAX_HISTORY`, and
 * the redo branch dropping when a new step makes it unreachable. What stayed is
 * everything that knows what a chord is - `canBuildChords`, `regenerate`,
 * `editDegree`, `reclaimPitches`, and every refusal argued below.
 *
 * The seam is `derive`. `ProgressionState` carries `canBuildChords` and
 * `keyScale`, which are `findScale` and `isHeptatonic` - harmony, and the one
 * thing the store must not learn. So the store is handed this service's own
 * `derive` at construction and calls it, contributing only the `HistoryDepth`
 * it alone knows. An `inject()` in that file instead would compile and pass,
 * and would put the resolution of a scale id inside the undo stack.
 *
 * The shape is still `ComposerService`'s, for the reason that service gives:
 * every mutation goes through one `commit()`, which snapshots the previous
 * document onto an undo stack with `structuredClone`. `ProgressionDoc` is an
 * acyclic plain object, so a snapshot is one call and a whole document is the
 * unit of undo. `ProgressionStore` is where that now lives, along with what
 * `settle()` does on the way out of every commit.
 *
 * ## What the service refuses
 *
 * Diatonic chords need a seven-note scale, and `degreePitchClasses` throws on
 * anything else - so the service asks `isHeptatonic` first rather than calling
 * and catching, which is what it is exported for.
 *
 * The line is drawn between harmony and timeline. Adding a chord or changing
 * one - `appendSlot`, `appendChord`, `setSlotChord`, `setSlotExtent`,
 * `stepSlotExtent`, `setSlotInversion`, `setSlotOctave` - is refused outright
 * while the key cannot build chords,
 * because the alternative is a slot whose label and notes disagree. Moving,
 * resizing, removing, the tempo and the key itself always work: they are the
 * timeline and the transport, they invent no harmony, and refusing the key
 * change in particular would leave this page silently disagreeing with the
 * fretboard behind it. Resizing is on that side because a block chord's length
 * is a number written onto notes that already exist; see `retimeNotes`.
 *
 * A refusal is a no-op with no undo entry - the user pressed a button that did
 * nothing, and an undo step for nothing is worse than none. `canBuildChords` on
 * the state is how the page explains why.
 *
 * A value the normalisation refuses - a non-finite tempo, a fractional tonic -
 * throws out of the commit and publishes nothing, and that promise covers the
 * *history* as well as the document. See `ProgressionStore.commit`, where the
 * order of three lines is the whole of it.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly musicTheory = inject(MusicTheoryService);

  /**
   * The document, the selection and the history.
   *
   * Constructed rather than injected, and private rather than exposed: "every
   * mutation goes through one commit" is a promise that holds only while there
   * is one door, and this service is that door.
   */
  private readonly store: ProgressionStore;

  /**
   * Built in the constructor body rather than as a field initializer, because
   * the callback it hands over reads `musicTheory` - which is filled by the
   * field initializer above, and so is in place by the time this line runs. The
   * arrow keeps `this` this service's, which is the whole of what the store
   * borrows from it.
   */
  constructor() {
    this.store = new ProgressionStore(
      createDefaultProgression(),
      (doc, selectedSlotId, isDirty, history) =>
        this.derive(doc, selectedSlotId, isDirty, history)
    );
  }

  getState(): Observable<ProgressionState> {
    return this.store.getState();
  }

  get doc(): ProgressionDoc {
    return this.store.doc;
  }

  // -------------------------------------------------------------------------
  // Slots
  // -------------------------------------------------------------------------

  /**
   * Adds a chord on `degree` to the end of the progression, one bar long, and
   * selects it - the chord you just clicked is the one the +/- controls should
   * act on next.
   *
   * `degree` is 0-6 and `createDegreeSlot` throws outside that range. That is
   * the model's rule for a value with no meaningful nearest end rather than an
   * oversight here: an eighth degree of a seven-note scale is a caller bug, and
   * the palette that calls this emits one button per scale degree.
   *
   * The chord is the key's own, at a triad: a degree is all this takes, and a
   * degree can say nothing else. **`appendChord` is the one to add a borrowed
   * chord or a secondary dominant with**, and it says why.
   */
  appendSlot(degree: number): void {
    const doc = this.doc;
    if (!this.canBuildChords(doc.key)) return;

    this.append(createDegreeSlot(degree, 0), doc.key);
  }

  /**
   * Adds a chord the key does not have on that degree: a borrowed chord, a
   * secondary dominant, anything carrying an accidental or a shape of its own.
   *
   * The door `appendSlot` could not be: a degree is every chord a key *has* and
   * no chord it borrows, and `♭VII` is degree 6 with `alter: -1` under a
   * `major` override - two more fields, neither with a way in through a single
   * number.
   *
   * **It regenerates, and that is the whole reason it is a setter** rather than
   * a document the palette assembles and hands to `replaceDocument`. That
   * method settles - it bounds and re-flows - and never rebuilds a slot's notes
   * from its degree, so the document route stores the new label over the old
   * notes and leaves a card and a synth disagreeing for as long as the document
   * lives. `replaceDocument`'s own docstring states the rule this exists to
   * satisfy: a path that emits harmony must be a path that regenerates.
   *
   * Everything else is `appendSlot`'s, through the tail they share.
   */
  appendChord(choice: ChordChoice): void {
    const doc = this.doc;
    if (!this.canBuildChords(doc.key)) return;

    const fresh = createDegreeSlot(choice.degree, 0);
    // `createDegreeSlot` builds a degree slot and nothing else. This is the
    // narrowing `SlotHarmony` needs, not a doubt about which kind came back.
    if (fresh.harmony.kind !== 'degree') return;

    this.append(
      normalizeChordSlot({
        ...fresh,
        harmony: { kind: 'degree', degree: chosen(fresh.harmony.degree, choice) }
      }),
      doc.key
    );
  }

  /**
   * The tail both appends share: derive what the slot sounds, put it on the
   * end, and select it.
   *
   * Beat 0, and not the sum of what is already there: `settle()` lays every
   * slot end to end on the way out, so summing here would be a second statement
   * of the contiguity rule in the one place the class docstring argues no
   * mutation gets to choose. Two statements of a rule can disagree.
   */
  private append(fresh: ChordSlot, key: ProgressionKey): void {
    const slot = this.regenerate(fresh, key);

    this.store.commit(draft => {
      draft.slots.push(slot);
    }, slot.id);
  }

  /** Drops a slot. The re-flow in `commit()` closes the gap it leaves. */
  removeSlot(id: string): void {
    if (!this.doc.slots.some(slot => slot.id === id)) return;
    this.store.commit(draft => {
      draft.slots = draft.slots.filter(slot => slot.id !== id);
    });
  }

  /**
   * Moves a slot to `toIndex`, clamped into the progression. A drag can be
   * released past either end of the strip, and the nearest position is what it
   * meant.
   *
   * The lower end of the clamp is easy to mistake for decoration: `splice`
   * reads a negative start as `length + start` and so lands on 0 for anything
   * far enough out, which hides a missing `Math.max(0, ...)` everywhere except
   * -1 - where it inserts one place in from the left instead of at it.
   */
  moveSlot(id: string, toIndex: number): void {
    const slots = this.doc.slots;
    const from = slots.findIndex(slot => slot.id === id);
    if (from < 0) return;

    const to = Math.max(0, Math.min(slots.length - 1, Math.trunc(toIndex)));
    if (to === from) return;

    this.store.commit(draft => {
      const [moved] = draft.slots.splice(from, 1);
      draft.slots.splice(to, 0, moved);
    });
  }

  /**
   * Resizes a slot, and gives its notes the same new length.
   *
   * The length is bounded before it reaches the notes rather than after, so a
   * drag past zero gives them the clamped length rather than the dragged one.
   *
   * It re-times rather than re-generates, which is what lets it work in a key
   * that cannot build chords: a block chord needs no scale to be made longer,
   * only the number. Regenerating needed one, and a slot resized in a
   * pentatonic key came away two beats long holding four-beat notes.
   *
   * **A slot that owns its timing keeps its rhythm through this**, notes past
   * the new end included, and so does a literal slot. `retimeNotes` carries
   * both arguments; the short version is that a resize is a drag, a drag goes
   * both ways, and coalescing makes the whole of one a single undo step - so a
   * rule that discarded on the way in could not be undone by the way out.
   *
   * `coalesce` folds this call into the undo entry the previous one opened, so
   * that a drag across three beats is one step back rather than three. The
   * caller passes it false for the first length it commits and true for every
   * one after, which is what keeps two separate drags on the same slot two
   * separate steps - there is nothing else between them for the service to tell
   * them apart by. A caller that never passes it gets the old behaviour, one
   * entry per call, which is right for the arrow keys.
   */
  setSlotLength(id: string, beats: number, options: EditOptions = {}): void {
    const slot = this.slotOf(id);
    if (!slot) return;

    const resized = normalizeChordSlot({ ...slot, lengthBeats: beats });
    if (resized.lengthBeats === slot.lengthBeats) return;

    this.replaceSlot(id, () => retimeNotes(resized), {
      key: `length:${id}`,
      continues: options.coalesce === true
    });
  }

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
   * It also keeps the run keys the service's own. A caller-supplied key is a
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
   * Hands the whole slot back to the generator: every claim dropped, the block
   * chord rebuilt from the degree.
   *
   * **The escape hatch, and it is not optional.** Per-aspect ownership is only
   * safe if there is a way back. Without this, a user who drags one note has
   * opted that slot out of re-voicing for good - the next key change moves the
   * chord underneath everything else and leaves their note where it was - with
   * no route back but undo, and undo is gone the moment they do anything else.
   *
   * The slot's *length* is not touched, and neither is where it sits: this
   * restates what the slot sounds, not the timeline around it. So the block
   * chord it rebuilds is the slot's own length.
   *
   * ## It drops the shape override too, which is the other claim
   *
   * `ChordDegree.quality` is user intent exactly as `SlotOwnership` is - Task 4
   * made it durable, and `regenerateSlot` carries it through every regeneration
   * untouched. So a slot with a pinned shape is a slot opted out of re-voicing
   * in the one dimension the ownership record does not cover: the palette's
   * alternates row pins `major` onto a `V`, the key moves to the parallel minor,
   * and that one chord stays major while every untouched slot beside it turns
   * minor. The plan's own hand-check - "switch to A minor on the circle, the
   * groove survives and the chords re-voice" - is what that breaks.
   *
   * `createDegreeSlot` was the only producer of `quality: null` in the app, so
   * before this the pin had no way back short of deleting the slot. The escape
   * hatch is not optional for ownership and it is not optional here either, for
   * the same reason and by the same argument.
   *
   * **A displaced root keeps its shape**, and that is not an exception being
   * carved out. `normalizeChordDegree` refuses `alter != 0` with a null quality
   * outright - a chromatic root has no diatonic stack to fall back on - so a
   * borrowed chord's shape is not an override over some other answer, it is the
   * only answer there is. `unpinned` is where that is written down. A borrowed
   * chord therefore stays borrowed through this, as it always did.
   *
   * It refuses where there is no chord to reset to - a key that cannot stack
   * thirds, or a literal slot. Clearing the claims without regenerating would
   * be the worst of both: the hand edits would stay, now unclaimed, and the
   * next key change would quietly throw them away.
   *
   * Nothing is recorded when the slot owns nothing, is pinned to nothing, and
   * already sounds what the generator would write, so pressing the button twice
   * costs one undo step rather than two. The shape is part of that comparison
   * because it is part of what is being taken back: pinning a `V` to `major` in
   * a major key changes no note, so a comparison over notes and claims alone
   * would call the reset a no-op and leave the pin in place - silently, and on
   * the one path that exists to remove it.
   */
  resetSlotToChord(id: string): void {
    const doc = this.doc;
    if (!this.canBuildChords(doc.key)) return;

    const slot = this.slotOf(id);
    if (!slot || slot.harmony.kind !== 'degree') return;

    const degree = unpinned(slot.harmony.degree);
    const reset = this.regenerate(
      { ...slot, harmony: { kind: 'degree', degree }, owned: createOwnership() },
      doc.key
    );
    if (
      sameDegree(degree, slot.harmony.degree) &&
      sameOwnership(reset.owned, slot.owned) &&
      sameNotes(reset.notes, slot.notes)
    ) {
      return;
    }

    this.replaceSlot(id, () => reset);
  }

  /**
   * The shape all three of the roll's setters share: work out the new notes,
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
   * the same rule `setSlotLength` states for two consecutive resizes of one
   * card - the service cannot see where one gesture ends and the next begins -
   * but it is easy to read the keying as covering it, and it does not.
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
    const slot = this.slotOf(id);
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
    this.replaceSlot(id, () => ({ ...slot, notes: [...notes], owned }), {
      key: runKey,
      continues: options.coalesce === true
    });
    return true;
  }

  /**
   * Sets how far the thirds are stacked, to an absolute rung.
   *
   * `normalizeChordSlot` throws on an extent that is not on the ladder, so
   * keeping a computed one on it is this method's job rather than that guard's;
   * see `nearestExtent` for what that means at each end. **The +/- complexity
   * buttons want `stepSlotExtent`**, which clamps rather than refusing because
   * it steps the index and not the value.
   */
  setSlotExtent(id: string, extent: ChordExtent): void {
    const rung = nearestExtent(extent);
    if (rung === null) return;
    this.editDegree(id, degree => ({ ...degree, extent: rung }));
  }

  /**
   * The +/- complexity buttons: `delta` rungs further up or down the ladder,
   * clamped at both ends.
   *
   * A stepper that walked the *value* could not clamp: off the top computes
   * `CHORD_EXTENTS[5]` and off the bottom `CHORD_EXTENTS[-1]`, both `undefined`
   * at runtime and indistinguishable from each other, so there is no end to
   * clamp toward. Stepping the *index* has the ends the value lacks - 0 and
   * `CHORD_EXTENTS.length - 1` are different numbers - so + on a thirteenth
   * rests on the thirteenth and - on a triad rests on the triad.
   *
   * It also puts "which rung is this slot on" in the service rather than in
   * each of the components that will ask, which is where the project rules put
   * state that more than one component reads.
   */
  stepSlotExtent(id: string, delta: number): void {
    // A `NaN` from an emptied input is not a direction, and names no rung.
    if (!Number.isFinite(delta)) return;

    const slot = this.slotOf(id);
    if (!slot || slot.harmony.kind !== 'degree') return;

    // Always a real index: every slot in the document has been through
    // `normalizeChordSlot`, which throws on an extent that is not a rung.
    const index = CHORD_EXTENTS.indexOf(slot.harmony.degree.extent);
    const stepped = index + Math.trunc(delta);
    const rung = Math.max(0, Math.min(CHORD_EXTENTS.length - 1, stepped));

    this.setSlotExtent(id, CHORD_EXTENTS[rung]);
  }

  /**
   * Retunes a slot to another chord: its degree, its accidental, its shape and
   * its height, all in one commit.
   *
   * The palette's alternates row, which offers every named shape on the root a
   * slot already sits on. It goes through `editDegree` for everything that
   * makes an edit here safe - the no-op comparison, the pitch reclaim, the
   * regeneration - and so it inherits that method's two refusals with them: a
   * key that cannot build chords, and a literal slot with no degree to change.
   *
   * **It sets the height as well as the shape**, and that is not incidental. A
   * shape has a height: `major` and `major7` are one chord at two of them, and
   * a caller that could ask for the seventh's name without its height would be
   * asking for a name over notes that do not make it. The cost is that a slot
   * standing on a ninth is stood back down by a triad's name -
   * `progression-vocabulary.ts` makes the argument for offering every shape at
   * its own height, and the palette shows the cost on the button rather than
   * letting a user find it after the click.
   */
  setSlotChord(id: string, choice: ChordChoice): void {
    this.editDegree(id, degree => chosen(degree, choice));
  }

  /** Rotates the voicing. Wraps, so any number names a real inversion. */
  setSlotInversion(id: string, inversion: number): void {
    this.editDegree(id, degree => ({ ...degree, inversion }));
  }

  /** Shifts the voicing base by whole octaves, clamped to the playable range. */
  setSlotOctave(id: string, octave: number): void {
    this.editDegree(id, degree => ({ ...degree, octave }));
  }

  /**
   * Changes one slot's harmony and re-derives what it sounds.
   *
   * The bounded result is compared with what is already there, and an edit that
   * changes nothing is not recorded. That is not tidiness: the extent and
   * octave controls are steppers that clamp, so pressing one at its limit is a
   * normal thing to do repeatedly, and a hundred of those would empty the undo
   * stack of everything the user actually did.
   *
   * ## It reclaims the pitches, where `setKey` does not
   *
   * Every command that reaches here - `setSlotChord`, `setSlotExtent`,
   * `stepSlotExtent`, `setSlotInversion`, `setSlotOctave` - restates the chord
   * or its voicing, so the pitches the slot is holding are the ones the user is
   * asking to replace.
   * Leaving a claim over them intact would let the label move while the notes
   * did not: a complexity step on a claimed slot stores `extent: 7`, the card
   * prints `Imaj7`, and the synth keeps sounding the three pitches that were
   * there. `reclaimPitches` is that decision, and its docstring carries the
   * argument.
   *
   * The reclaim happens **after** the no-op comparison above, so a stepper
   * resting on its limit reclaims nothing - there is no commit to reclaim in.
   * `owned.timing` and `owned.velocity` are not touched by any of the four.
   */
  private editDegree(id: string, change: (degree: ChordDegree) => ChordDegree): void {
    const doc = this.doc;
    // A slot whose label and notes could not be made to agree is worse than a
    // control that does nothing, so the whole edit is refused.
    if (!this.canBuildChords(doc.key)) return;

    const slot = this.slotOf(id);
    // A literal slot has no degree to change - its notes are the truth, and
    // there is no label for a stepper to move.
    if (!slot || slot.harmony.kind !== 'degree') return;

    const current = slot.harmony.degree;
    const edited = normalizeChordSlot({
      ...slot,
      harmony: { kind: 'degree', degree: change(current) }
    });
    if (edited.harmony.kind !== 'degree') return;
    if (sameDegree(edited.harmony.degree, current)) return;

    this.replaceSlot(id, draftKey => this.regenerate(reclaimPitches(edited), draftKey));
  }

  /** The slot with this id, or null when the document does not hold one. */
  private slotOf(id: string): ChordSlot | null {
    return this.doc.slots.find(candidate => candidate.id === id) ?? null;
  }

  /** Swaps one slot for what `build` makes of it, by id. */
  private replaceSlot(
    id: string,
    build: (key: ProgressionKey) => ChordSlot,
    run?: CommitRun
  ): void {
    this.store.commit(
      draft => {
        const index = draft.slots.findIndex(slot => slot.id === id);
        if (index < 0) return;
        draft.slots[index] = build(draft.key);
      },
      undefined,
      run
    );
  }

  /** Which slot the strip has selected. Not a document change, so not undoable. */
  selectSlot(id: string | null): void {
    this.store.selectSlot(id);
  }

  // -------------------------------------------------------------------------
  // Key and tempo
  // -------------------------------------------------------------------------

  /**
   * Moves the whole progression to a new key, re-deriving what every slot
   * sounds. The labels move with the key on their own - `effectiveQuality`
   * reads them off the chord that was built, and no field here holds one.
   *
   * Every slot is passed through `regenerateSlot`, which is a merge and not a
   * replace: it re-derives only the dimensions the user has not claimed, and
   * hands a `literal` slot's notes straight back. So running it over everything
   * is the right thing rather than merely a safe one.
   *
   * **It does not reclaim anything.** A key change restates no chord - it moves
   * every chord at once - so a claimed voicing is meant to survive it, which is
   * the case the whole merge is argued from. The harmony commands are the ones
   * that reclaim, and `editDegree` says why.
   *
   * **It is the one caller that supplies the interval.** `regenerateSlot`
   * transposes *owned* pitches by a `transposeBy` it cannot work out for itself
   * - it is handed the new key and never sees the old one - and this method is
   * the only caller that can, being the only one that moves a key at all. It is
   * computed from the tonic that will be **stored** rather than the one that
   * arrived, for the same reason the slots are generated from that one: 21 is A
   * an octave up, and an interval measured from it would carry a claimed
   * voicing most of two octaves. `keyTransposeInterval` is the rule, and its
   * docstring argues the direction.
   *
   * What reaches a claimed note is that interval **re-anchored** to the chord
   * the degree generates in the new key - `anchoredShift` in `progression-edit`
   * - so the octave chosen here is not the octave the voicing ends up in. That
   * is what keeps a lap of the circle of fifths from walking a voicing off the
   * end of MIDI, and the reason is worth reading there before this method's
   * interval is changed.
   *
   * The key is applied even when its scale cannot build chords. Refusing it
   * would leave this page in a different key from the fretboard behind it,
   * which is a worse lie than a progression whose slots keep the notes they
   * already had.
   *
   * ## `preferSharps` is an argument because a pitch class cannot carry it
   *
   * `spellingFor` below works the spelling out from the tonic and the mode,
   * and that is the right answer for every caller that has only those two
   * numbers. It is not always the *available* answer: F sharp major and G flat
   * major are one pitch class and two keys, and a caller who knows which of
   * them the user picked knows something this service cannot re-derive. The
   * circle of fifths is that caller, through `ProgressionComponent.adopt`,
   * which hands over `MusicTheoryService.shouldUseSharps()` - the app-wide
   * answer, taken from the key *name* the user clicked.
   *
   * Optional rather than required, so that a caller who genuinely has only the
   * numbers - a spec, a future importer - still gets the derived answer instead
   * of having to invent one. `undefined` means "derive it"; `false` is a real
   * request for flats and is not swallowed, which is why this is `??` and not
   * `||`.
   *
   * Worth saying plainly: **the derived branch is dead in production today.**
   * `ProgressionComponent.adopt` is the only caller the running app has and it
   * always passes the argument, so only specs reach `spellingFor` through here.
   * It stays because the alternative is a required parameter that every future
   * caller has to answer with a guess, and because `spellingFor` is the same
   * rule the argument is derived from one layer up - not a fallback that could
   * quietly disagree with it.
   */
  setKey(tonic: number, scaleId: string, preferSharps?: boolean): void {
    const scale = this.findScale(scaleId);

    this.store.commit(draft => {
      // Bounded here rather than left to `settle()`, which does not run until
      // this callback is over - and the slots are generated from this key
      // inside it. Generating from the raw tonic while storing the wrapped one
      // agrees today only because `voiceChord` reduces mod 12, which is a fact
      // about a module two layers down rather than a promise to this one.
      //
      // Bounded before the spelling is decided, too: a tonic of 13 is E flat's
      // pitch class dressed as an octave above, and a signature looked up from
      // 13 is no signature at all.
      const bounded = normalizeProgressionKey({
        tonic,
        scaleId,
        preferSharps: draft.key.preferSharps
      });

      // Read before `draft.key` is overwritten, and off the document rather
      // than off the argument: `draft.key.tonic` is the tonic the progression
      // was actually in, already wrapped by the commit that stored it.
      const transposeBy = keyTransposeInterval(draft.key.tonic, bounded.tonic);

      draft.key = {
        ...bounded,
        preferSharps:
          preferSharps ??
          this.spellingFor(bounded.tonic, scaleId, scale, draft.key.preferSharps)
      };

      // No `isHeptatonic` check of its own: `regenerate` asks already, and
      // hands a slot back unchanged when the answer is no - which is what
      // returning early here did, in a second copy of the rule.
      draft.slots = draft.slots.map(slot => this.regenerate(slot, draft.key, transposeBy));
    });
  }

  /** BPM. Clamped to the playable range by the normalisation in `commit()`. */
  setTempo(bpm: number): void {
    this.store.commit(draft => {
      draft.tempo = bpm;
    });
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------
  //
  // All of it is `ProgressionStore`'s. These three are the public API kept
  // where it always was: a component asks the service, and the service is
  // still the only door. See that class for why the mechanism is one file and
  // the harmony another.

  /** One step back through the document history. */
  undo(): void {
    this.store.undo();
  }

  /** One step forward, where an undo has left somewhere to go. */
  redo(): void {
    this.store.redo();
  }

  /**
   * Replaces the whole document, e.g. on loading a saved progression.
   *
   * **It settles the document; it does not regenerate it**, which puts a rule
   * on every caller: a path that emits harmony must be a path that
   * regenerates. `ProgressionStore.replaceDocument` argues it, and `appendChord`
   * is what it produced.
   */
  replaceDocument(doc: ProgressionDoc, markClean = false): void {
    this.store.replaceDocument(doc, markClean);
  }

  /**
   * Builds the whole published state around a document, in one place.
   *
   * `keyScale` and `canBuildChords` are functions of the key and the selection
   * a function of the slots, so all three are computed here rather than at each
   * call site - the same argument that put the normalisation inside `commit()`.
   * The selection is validated rather than trusted, which is how removing the
   * selected slot clears the selection without `removeSlot` having to remember
   * to.
   *
   * The store's first state comes through here too, rather than having the
   * seven fields written out a second time. A field added to `ProgressionState`
   * and filled in only one of two places would be right until the first render
   * and wrong before the first click.
   *
   * ## It is the seam, and this is which way it faces
   *
   * The store calls this on every publish, and the arrow it was handed at
   * construction is the only thing it holds of this service. Two of the fields
   * below need `findScale` - an id resolved through `MusicTheoryService` - and
   * `isHeptatonic` over what comes back, which is harmony; the two the store
   * knows and this method cannot see are the ones it hands over in
   * `HistoryDepth`. So each side contributes exactly what it is allowed to
   * know, and neither can compute the other's half.
   */
  private derive(
    doc: ProgressionDoc,
    selectedSlotId: string | null,
    isDirty: boolean,
    history: HistoryDepth
  ): ProgressionState {
    const keyScale = this.findScale(doc.key.scaleId);

    return {
      doc,
      selectedSlotId: doc.slots.some(slot => slot.id === selectedSlotId) ? selectedSlotId : null,
      canBuildChords: this.chordScale(keyScale) !== null,
      keyScale,
      isDirty,
      canUndo: history.canUndo,
      canRedo: history.canRedo
    };
  }

  // -------------------------------------------------------------------------
  // Harmony
  // -------------------------------------------------------------------------

  /**
   * Re-derives what a slot sounds, in the key it is in.
   *
   * It does **not** re-derive the label. `ChordDegree.quality` is the user's
   * override and `regenerateSlot` leaves it exactly as it found it; the name on
   * the card comes from `effectiveQuality`, read off the chord that was
   * actually built. Writing the derived label into the field here is what M2
   * Task 4 removed, and this line used to say so.
   *
   * `transposeBy` defaults to 0 and only `setKey` passes anything else. That is
   * the honest value rather than a stand-in for a missing answer: a complexity
   * step, an inversion, an octave shift and an append all move no key, so there
   * is no interval to move claimed pitches by.
   */
  private regenerate(slot: ChordSlot, key: ProgressionKey, transposeBy = 0): ChordSlot {
    return regenerateSlot(
      slot,
      key,
      this.chordScale(this.findScale(key.scaleId)),
      transposeBy
    );
  }

  /**
   * How the new key spells its notes: its own signature, then the scale's
   * default, then whatever was already in force.
   *
   * The first clause is the one that matters and it is `b514027`'s rule, called
   * rather than restated - E flat ionian carries three flats however the ionian
   * scale's `preferSharps` is set, and it is set to `true`. Reading that flag
   * first was how the palette came to print `D♯ Maj` in E flat major.
   *
   * The second clause is not a fallback from failure but the honest answer for
   * a scale with no parent major: a pentatonic has no signature to inherit, so
   * the only opinion available is the one it declares for itself. The third is
   * for an id the app cannot resolve at all - there is no scale to ask, and
   * guessing would be worse than keeping.
   */
  private spellingFor(
    tonic: number,
    scaleId: string,
    scale: Scale | null,
    inForce: boolean
  ): boolean {
    const signature = keySignatureKind(scaleId, tonic);
    if (signature === 'sharp') return true;
    if (signature === 'flat') return false;

    return scale ? scale.preferSharps : inForce;
  }

  /**
   * The scale a key names, or null when the id names nothing the app knows.
   *
   * `ProgressionKey.scaleId` is an id from `MusicTheoryService` and this is the
   * one place that resolves it, so an id that does not resolve produces a page
   * with no chords to offer rather than an exception somewhere downstream.
   */
  private findScale(scaleId: string): Scale | null {
    for (const category of this.musicTheory.getScaleCategories()) {
      const scale = category.scales.find(candidate => candidate.id === scaleId);
      if (scale) return scale;
    }
    return null;
  }

  /**
   * The intervals a scale can stack thirds through, or null when it cannot.
   *
   * Two questions with one answer: whether the palette may offer a chord, and
   * what `regenerateSlot` builds one from. An unknown id and a scale that is
   * not heptatonic answer both, asked once so the two cannot drift.
   *
   * It takes the resolved scale rather than the key so that `derive` can ask it
   * about the scale it has already looked up. The heptatonic rule is stated
   * here and nowhere else, which is the property worth keeping.
   */
  private chordScale(scale: Scale | null): readonly number[] | null {
    return scale && isHeptatonic(scale.intervals) ? scale.intervals : null;
  }

  /** Whether thirds can be stacked through the key's scale at all. */
  private canBuildChords(key: ProgressionKey): boolean {
    return this.chordScale(this.findScale(key.scaleId)) !== null;
  }
}

/**
 * A degree with the four fields a choice names written over it, and the three
 * it does not name - inversion, suspension, octave - left where they were.
 *
 * Copied one at a time rather than spread, and that is a guard rather than a
 * style. `ChordChoice` is satisfied structurally, so what actually arrives is a
 * palette view model carrying a numeral, a printed name and several more fields
 * meant for the screen. A spread would write every one of them into the stored
 * `ChordDegree`, where `normalizeChordDegree` spreads them on again and
 * `structuredClone` copies them into every undo entry the document ever takes -
 * a display string preserved as though it were harmony, and preserved *stale*,
 * because nothing regenerates it.
 */
/**
 * A degree with the shape override dropped, where there is one to drop and a
 * diatonic answer to fall back to.
 *
 * The two guards are one rule read from both ends. `quality: null` means "as
 * the key gives it", and the key only gives an answer on a degree of its own
 * scale - so `normalizeChordDegree` refuses a null quality over a displaced
 * root, and a borrowed chord's shape is the whole of what that chord is rather
 * than an override on top of something else. Written here rather than at the
 * one call site so that the next caller who wants to un-pin a slot gets the
 * refusal instead of the throw.
 *
 * Returns the degree itself when there is nothing to drop, so the comparison in
 * `resetSlotToChord` reads "the shape did not move" rather than needing a
 * second copy of these two conditions to know whether it could have.
 */
function unpinned(degree: ChordDegree): ChordDegree {
  if (degree.quality === null || degree.alter !== 0) return degree;
  return { ...degree, quality: null };
}

function chosen(degree: ChordDegree, choice: ChordChoice): ChordDegree {
  return {
    ...degree,
    degree: choice.degree,
    alter: choice.alter,
    quality: choice.quality,
    extent: choice.extent
  };
}
