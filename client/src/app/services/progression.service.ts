import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  CHORD_EXTENTS,
  normalizeChordSlot,
  normalizeProgressionKey
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  ProgressionState,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  nearestExtent,
  regenerateSlot,
  requireUniqueSlotIds,
  retimeNotes,
  sameDegree,
  settle
} from './progression-edit';
import { ChordExtent, isHeptatonic } from './progression-harmony';
import { Scale } from '../models/music-theory.model';
import { keySignatureKind } from './circle-of-fifths.data';
import { MusicTheoryService } from './music-theory.service';

/** How a length change should be recorded. See `setSlotLength`. */
export interface SetLengthOptions {
  /**
   * Whether this is a continuation of the length change before it rather than a
   * new one. A continuation folds into that entry instead of adding its own, so
   * one drag is one undo step however many beats it crosses.
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
   * `retimeNotes` says what a literal slot gets instead.
   *
   * `coalesce` folds this call into the undo entry the previous one opened, so
   * that a drag across three beats is one step back rather than three. The
   * caller passes it false for the first length it commits and true for every
   * one after, which is what keeps two separate drags on the same slot two
   * separate steps - there is nothing else between them for the service to tell
   * them apart by. A caller that never passes it gets the old behaviour, one
   * entry per call, which is right for the arrow keys.
   */
  setSlotLength(id: string, beats: number, options: SetLengthOptions = {}): void {
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

    this.replaceSlot(id, draftKey => this.regenerate(edited, draftKey));
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
   * sounds and how it is labelled.
   *
   * **This still regenerates every degree slot unconditionally, and that is
   * the simple version rather than the intended one.** A key change should
   * regenerate only the dimensions the user has not claimed - transposing owned
   * pitches, keeping owned timing and velocity - and leave a `literal` slot's
   * notes alone, which is why `ChordSlot` carries `SlotOwnership` and
   * `SlotHarmony` has a `literal` branch. Neither branch is reachable yet:
   * nothing here sets ownership, because the piano roll that would is still
   * being built, and the recogniser that degrades a slot to literal is M3's.
   * `regenerateSlot` becomes the merge in M2 Task 4, and `setKey` starts
   * passing it the semitone delta in Task 5. Until then `regenerate` is safe to
   * run over everything, because every slot so far was generated from its
   * degree and nothing else.
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

      draft.key = {
        ...bounded,
        preferSharps:
          preferSharps ??
          this.spellingFor(bounded.tonic, scaleId, scale, draft.key.preferSharps)
      };

      // No `isHeptatonic` check of its own: `regenerate` asks already, and
      // hands a slot back unchanged when the answer is no - which is what
      // returning early here did, in a second copy of the rule.
      draft.slots = draft.slots.map(slot => this.regenerate(slot, draft.key));
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

  /** Re-derives a slot's quality label and its notes, in the key it is in. */
  private regenerate(slot: ChordSlot, key: ProgressionKey): ChordSlot {
    return regenerateSlot(slot, key, this.chordScale(this.findScale(key.scaleId)));
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
