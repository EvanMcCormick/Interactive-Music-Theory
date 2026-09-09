import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
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
  requireUniqueSlotIds,
  retimeNotes,
  sameDegree,
  sameNotes,
  sameOwnership,
  settle
} from './progression-edit';
import { ChordExtent, isHeptatonic } from './progression-harmony';
import { Scale } from '../models/music-theory.model';
import { keySignatureKind } from './circle-of-fifths.data';
import { MusicTheoryService } from './music-theory.service';

/**
 * How a pointer-driven edit should be recorded. See `setSlotLength`, which was
 * the first of them, and `CommitRun` below for what a run is.
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
 * A stretch of commits that undo as one step.
 *
 * `key` names the run - `length:<slotId>` - and `continues` says whether this
 * commit joins the run of that name or starts it. Only the caller knows which,
 * because the service cannot see where one drag ends and the next begins. See
 * `ProgressionService.commit`.
 */
interface CommitRun {
  key: string;
  continues: boolean;
}

/**
 * Owns the progression document, the strip's selection, and undo/redo.
 *
 * Built to the shape of `ComposerService`, for the reason that service gives:
 * every mutation goes through one `commit()`, which snapshots the previous
 * document onto an undo stack with `structuredClone`. `ProgressionDoc` is an
 * acyclic plain object, so a snapshot is one call and a whole document is the
 * unit of undo.
 *
 * Every commit then passes through `settle()`, which does two things no setter
 * is trusted to do for itself:
 *
 *  1. **It normalises.** `normalizeProgressionDoc` checks and bounds every
 *     number that can reach the audio layer. Its own docstring names this call
 *     site: putting it here turns "each setter should bound its argument" from
 *     a convention that eleven setters have to remember into a mechanism with
 *     one place to check - and `setKey` and `setTempo`, which have no slot to
 *     normalise, are exactly the two that would have forgotten.
 *  2. **It re-flows.** INVARIANT: slots are contiguous - `slots[i].startBeat`
 *     equals the sum of every earlier `lengthBeats`. Append, remove, move and
 *     resize all disturb it, and a fifth mutation that disturbed it would be
 *     added by someone who had never read this comment. Re-flowing on the way
 *     out means no mutation can leave the timeline with a hole in it, because
 *     no mutation gets to choose.
 *
 * ## What the service refuses
 *
 * Diatonic chords need a seven-note scale, and `degreePitchClasses` throws on
 * anything else - so the service asks `isHeptatonic` first rather than calling
 * and catching, which is what it is exported for.
 *
 * The line is drawn between harmony and timeline. Adding a chord or changing
 * one - `appendSlot`, `setSlotExtent`, `stepSlotExtent`, `setSlotInversion`,
 * `setSlotOctave` - is refused outright while the key cannot build chords,
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
 * *history* as well as the document. See `commit()`, where the order of three
 * lines is the whole of it.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private static readonly MAX_HISTORY = 100;

  private readonly musicTheory = inject(MusicTheoryService);

  private readonly stateSubject: BehaviorSubject<ProgressionState>;
  private undoStack: ProgressionDoc[] = [];
  private redoStack: ProgressionDoc[] = [];

  /**
   * The run of commits the last one belonged to, or null when it belonged to
   * none. See `commit()`, and `CommitRun` for what a run is.
   */
  private currentRun: string | null = null;

  constructor() {
    this.stateSubject = new BehaviorSubject<ProgressionState>(
      this.derive(createDefaultProgression(), null, false)
    );
  }

  getState(): Observable<ProgressionState> {
    return this.stateSubject.asObservable();
  }

  get doc(): ProgressionDoc {
    return this.stateSubject.getValue().doc;
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
   */
  appendSlot(degree: number): void {
    const doc = this.doc;
    if (!this.canBuildChords(doc.key)) return;

    // Beat 0, and not the sum of what is already there: `settle()` lays every
    // slot end to end on the way out, so summing here would be a second
    // statement of the contiguity rule in the one place the docstring above
    // argues no mutation gets to choose. Two statements of a rule can disagree.
    const slot = this.regenerate(createDegreeSlot(degree, 0), doc.key);

    this.commit(draft => {
      draft.slots.push(slot);
    }, slot.id);
  }

  /** Drops a slot. The re-flow in `commit()` closes the gap it leaves. */
  removeSlot(id: string): void {
    if (!this.doc.slots.some(slot => slot.id === id)) return;
    this.commit(draft => {
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

    this.commit(draft => {
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
   * The consequence for the roll is a rule rather than a surprise: a gesture
   * that *places* a note in time is a timing edit as well as a pitch one, and
   * must follow with `setNoteTiming` for the note it placed. Coalescing is what
   * keeps the pair one undo step.
   *
   * Every note is bounded on the way in - see `boundNote`, which passes `midi`
   * through untouched and says why.
   */
  setSlotNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): void {
    this.writeNotes(id, { pitches: true }, () => notes.map(boundNote), `notes:${id}`, options);
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
   * An index the slot has no note at is a no-op rather than a throw.
   */
  setNoteTiming(
    id: string,
    noteIndex: number,
    startBeat: number,
    lengthBeats: number,
    options: EditOptions = {}
  ): void {
    this.writeNotes(
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
   */
  setNoteVelocity(
    id: string,
    noteIndex: number,
    velocity: number,
    options: EditOptions = {}
  ): void {
    this.writeNotes(
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
   * The slot's *harmony* and its *length* are not touched: this restates what
   * the slot sounds, not what chord it is or where it sits. So the block chord
   * it rebuilds is the slot's own length, and a borrowed chord stays borrowed.
   *
   * It refuses where there is no chord to reset to - a key that cannot stack
   * thirds, or a literal slot. Clearing the claims without regenerating would
   * be the worst of both: the hand edits would stay, now unclaimed, and the
   * next key change would quietly throw them away.
   *
   * Nothing is recorded when the slot already owns nothing and already sounds
   * what the generator would write, so pressing the button twice costs one
   * undo step rather than two.
   */
  resetSlotToChord(id: string): void {
    const doc = this.doc;
    if (!this.canBuildChords(doc.key)) return;

    const slot = this.slotOf(id);
    if (!slot || slot.harmony.kind !== 'degree') return;

    const reset = this.regenerate({ ...slot, owned: createOwnership() }, doc.key);
    if (sameOwnership(reset.owned, slot.owned) && sameNotes(reset.notes, slot.notes)) return;

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
   * The run is keyed per *note* rather than per slot, so a continuation meant
   * for one note cannot fold into the entry another note's drag opened - the
   * same reason `setSlotLength` keys its run by slot rather than globally.
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
  ): void {
    const slot = this.slotOf(id);
    if (!slot) return;

    const notes = edit(slot);
    if (notes === null) return;

    const owned: SlotOwnership = { ...slot.owned, ...claims };
    if (sameOwnership(owned, slot.owned) && sameNotes(notes, slot.notes)) return;

    // The spread is what turns the callback's `readonly` promise into the
    // mutable field `ChordSlot.notes` is, and it is a type conversion rather
    // than a defence: every callback above already builds a fresh array, and
    // `normalizeChordSlot` rebuilds every note again inside `settle()`.
    this.replaceSlot(id, () => ({ ...slot, notes: [...notes], owned }), {
      key: runKey,
      continues: options.coalesce === true
    });
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
   * Every command that reaches here - `setSlotExtent`, `stepSlotExtent`,
   * `setSlotInversion`, `setSlotOctave` - restates the chord or its voicing, so
   * the pitches the slot is holding are the ones the user is asking to replace.
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
    this.commit(
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
    const state = this.stateSubject.getValue();
    this.publish(state.doc, id, state.isDirty);
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
   */
  setKey(tonic: number, scaleId: string, preferSharps?: boolean): void {
    const scale = this.findScale(scaleId);

    this.commit(draft => {
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
    this.commit(draft => {
      draft.tempo = bpm;
    });
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /**
   * Applies a mutation to a cloned document and pushes the old one onto undo.
   *
   * The clone is what makes a mutation atomic: `mutate` writes to a copy, so a
   * throw out of it leaves the published document untouched rather than
   * half-edited.
   *
   * The order of the last three lines is the rest of that promise. Settling can
   * throw as readily as the mutation can - `setTempo(NaN)` never reaches
   * `mutate` at all, it fails in the normalisation afterwards - and the history
   * is state too. Settled first, then pushed, then published: a throw at any
   * point leaves both stacks and all three flags exactly as they were.
   *
   * ## One drag, one step
   *
   * A `run` is a stretch of commits that undo together. A commit that continues
   * the run already under way pushes nothing, so the entry the run's first
   * commit left on the stack - the document from before the run began - stays
   * where one undo will land. That is what a resize drag needs: it commits on
   * every whole beat it crosses, because the card has to be the length it is
   * being dragged to, and without this a drag across three beats cost three
   * undo steps and a pointer jittering on a beat boundary cost as many as it
   * liked. `MAX_HISTORY` is 100, so a few seconds of that used to evict every
   * step the user had taken before the drag.
   *
   * It is deliberately not a transaction. There is nothing to open and nothing
   * to close, so a gesture abandoned mid-drag - the pointer cancelled, the
   * component destroyed, an exception - leaves no state behind to be closed:
   * the next commit that does not continue the run simply pushes, as every
   * commit did before.
   */
  private commit(mutate: (draft: ProgressionDoc) => void, select?: string, run?: CommitRun): void {
    const state = this.stateSubject.getValue();
    const previous = structuredClone(state.doc);
    const draft = structuredClone(state.doc);

    mutate(draft);
    const settled = settle(draft);

    // A continuation is only honoured while the run it names is the one under
    // way, so a caller that passes `continues` with nothing to continue - or
    // after an undo has moved the stack under it - opens an entry rather than
    // folding into whatever happens to be on top.
    const extendsRun = run !== undefined && run.continues && run.key === this.currentRun;
    if (!extendsRun) this.pushHistory(previous);
    this.currentRun = run?.key ?? null;

    this.publish(settled, select ?? state.selectedSlotId, true);
  }

  /**
   * Walking the history ends whatever run was under way: the entry a run was
   * folding into is no longer on top of the stack, so the next commit has to
   * open one of its own rather than fold into whatever is.
   *
   * `redo` needs no such line, and does not have one. It can only run when
   * `redoStack` is non-empty, which happens only after an `undo` - and no
   * commit can refill it in between, because the *first* commit of a run always
   * pushes and so always clears the redo branch. So by the time `redo` runs,
   * this has already been nulled.
   */
  undo(): void {
    const state = this.stateSubject.getValue();
    const previous = this.undoStack.pop();
    if (!previous) return;

    this.currentRun = null;
    this.redoStack.push(structuredClone(state.doc));
    this.publish(previous, state.selectedSlotId, true);
  }

  redo(): void {
    const state = this.stateSubject.getValue();
    const next = this.redoStack.pop();
    if (!next) return;

    this.pushUndo(structuredClone(state.doc));
    this.publish(next, state.selectedSlotId, true);
  }

  /**
   * Replaces the whole document, e.g. on loading a saved progression.
   *
   * The only door a document the service did not build comes through, so it is
   * where the ids are checked - and, like `commit()`, it settles before it
   * touches the history, so a document that cannot be settled costs the user
   * neither stack.
   *
   * It is also the only door in M1 through which a `literal` slot can arrive,
   * which is how the characterisation of resizing one is testable at all
   * before M3 builds the recogniser that makes them for real.
   *
   * ## It settles the document; it does not regenerate it
   *
   * `settle()` bounds and re-flows. Nothing in it rebuilds a slot's notes from
   * its degree, so **a document is installed exactly as it was handed over,
   * disagreements and all**, and the disagreement lives until something else
   * triggers a regeneration - a key change, a complexity step, an inversion.
   * A document whose `harmony.degree` says bVII while its `notes` still sound
   * B-D-F is stored saying one thing and sounding another.
   *
   * That used to be self-correcting and invisible. `quality` was a transient
   * label that every regeneration overwrote, so a stale document was repaired
   * by whatever the user did next and no state persisted the disagreement. M2
   * Task 4 made the field **durable user intent**: it is now the override that
   * survives every regeneration, so a loaded document can hold a card and a
   * synth that disagree about one chord indefinitely - the failure
   * `effectiveQuality`'s docstring exists to prevent, arriving by the one road
   * that does not go through it.
   *
   * The consequence for callers is a rule, and it is not only this method's:
   * **a path that emits harmony must be a path that regenerates.** Task 9's
   * palette emits `(degree, alter, quality)` for a borrowed chord, and it has
   * to reach the slot through `editDegree` - or through a new setter that
   * regenerates - rather than by assembling a document and handing it here. The
   * spec that installs a bVII works around this with a no-op `setKey` and says
   * so at the call; that is a test's licence, not an example to follow.
   *
   * Regenerating here was considered and is not obviously wrong. It is not done
   * because this method has no production caller yet and regenerating would
   * silently rewrite the notes of a document that meant them - which is the
   * whole of what a `literal` slot is for, and the distinction a loader will
   * need to make deliberately rather than inherit.
   */
  replaceDocument(doc: ProgressionDoc, markClean = false): void {
    const state = this.stateSubject.getValue();
    const settled = settle(requireUniqueSlotIds(doc));

    this.currentRun = null;
    this.pushHistory(structuredClone(state.doc));
    this.publish(settled, state.selectedSlotId, !markClean);
  }

  /** Records a step, and drops the redo branch it just made unreachable. */
  private pushHistory(previous: ProgressionDoc): void {
    this.pushUndo(previous);
    this.redoStack = [];
  }

  /**
   * Pushes onto the undo stack, capped.
   *
   * The cap lives with the push rather than at one of its two call sites. Redo
   * cannot reach it today - it pops one redo entry for every one it pushes
   * here, so the pair conserves the total - but a cap only some pushes respect
   * stops working the moment a third caller arrives, silently.
   */
  private pushUndo(doc: ProgressionDoc): void {
    this.undoStack.push(doc);
    if (this.undoStack.length > ProgressionService.MAX_HISTORY) {
      this.undoStack.shift();
    }
  }

  /** Publishes a document and everything the page derives from it. */
  private publish(doc: ProgressionDoc, selectedSlotId: string | null, isDirty: boolean): void {
    this.stateSubject.next(this.derive(doc, selectedSlotId, isDirty));
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
   * The constructor builds its first state through here too, rather than
   * writing the six fields out a second time. A field added to
   * `ProgressionState` and filled in only one of two places would be right
   * until the first render and wrong before the first click.
   */
  private derive(
    doc: ProgressionDoc,
    selectedSlotId: string | null,
    isDirty: boolean
  ): ProgressionState {
    const keyScale = this.findScale(doc.key.scaleId);

    return {
      doc,
      selectedSlotId: doc.slots.some(slot => slot.id === selectedSlotId) ? selectedSlotId : null,
      canBuildChords: this.chordScale(keyScale) !== null,
      keyScale,
      isDirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
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
