import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  CHORD_EXTENTS,
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  ProgressionState,
  createDefaultProgression,
  createDegreeSlot,
  normalizeChordSlot,
  normalizeProgressionDoc
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import { ChordExtent, degreeQuality, isHeptatonic } from './progression-harmony';
import { Scale } from '../models/music-theory.model';
import { MusicTheoryService } from './music-theory.service';

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
 * Diatonic chords need a seven-note scale. `degreePitchClasses` throws on
 * anything else, and that throw is allowed to propagate through
 * `generateSlotNotes` - so the service asks `isHeptatonic` first rather than
 * calling and catching, which is what it is exported for.
 *
 * The line is drawn between harmony and timeline. Adding a chord or changing
 * one - `appendSlot`, `setSlotExtent`, `setSlotInversion`, `setSlotOctave` - is
 * refused outright while the key cannot build chords, because the alternative
 * is a slot whose label and notes disagree. Moving, resizing, removing, the
 * tempo and the key itself always work: they are the timeline and the
 * transport, they invent no harmony, and refusing the key change in particular
 * would leave this page silently disagreeing with the fretboard behind it.
 *
 * A refusal is a no-op with no undo entry - the user pressed a button that did
 * nothing, and an undo step for nothing is worse than none. `canBuildChords` on
 * the state is how the page explains why.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private static readonly MAX_HISTORY = 100;

  private readonly musicTheory = inject(MusicTheoryService);

  private readonly stateSubject: BehaviorSubject<ProgressionState>;
  private undoStack: ProgressionDoc[] = [];
  private redoStack: ProgressionDoc[] = [];

  constructor() {
    const doc = createDefaultProgression();
    this.stateSubject = new BehaviorSubject<ProgressionState>({
      doc,
      selectedSlotId: null,
      canBuildChords: this.canBuildChords(doc.key),
      isDirty: false,
      canUndo: false,
      canRedo: false
    });
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
    const doc = this.stateSubject.getValue().doc;
    if (!this.canBuildChords(doc.key)) return;

    const startBeat = doc.slots.reduce((sum, slot) => sum + slot.lengthBeats, 0);
    const slot = this.regenerate(createDegreeSlot(degree, startBeat), doc.key);

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
   * Resizes a slot, and re-generates its notes so they fill it.
   *
   * The length is bounded before the notes are made rather than after, so a
   * drag past zero gives the notes the clamped length rather than the dragged
   * one.
   *
   * **On a literal slot this changes the slot and not its notes.**
   * `generateSlotNotes` hands a literal slot its own notes straight back - they
   * are the playback truth, and stretching them to fit a drag would be the app
   * rewriting what the user played - so shrinking such a slot leaves notes
   * hanging past its end and lengthening it leaves silence at the end. Nothing
   * in M1 creates a literal slot; M3 does, and this is the consequence it
   * inherits rather than discovers.
   */
  setSlotLength(id: string, beats: number): void {
    const slot = this.doc.slots.find(candidate => candidate.id === id);
    if (!slot) return;

    const resized = normalizeChordSlot({ ...slot, lengthBeats: beats });
    if (resized.lengthBeats === slot.lengthBeats) return;

    this.replaceSlot(id, draftKey => this.regenerate(resized, draftKey));
  }

  /**
   * The +/- complexity buttons: how far the thirds are stacked.
   *
   * `normalizeChordSlot` throws on an extent that is not on the ladder, so
   * keeping the stepper on it is this method's job rather than that guard's.
   * See `nearestExtent` for what "keeping it on" means at each end.
   */
  setSlotExtent(id: string, extent: ChordExtent): void {
    const rung = nearestExtent(extent);
    if (rung === null) return;
    this.editDegree(id, degree => ({ ...degree, extent: rung }));
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

    const slot = doc.slots.find(candidate => candidate.id === id);
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

  /** Swaps one slot for what `build` makes of it, by id. */
  private replaceSlot(id: string, build: (key: ProgressionKey) => ChordSlot): void {
    this.commit(draft => {
      const index = draft.slots.findIndex(slot => slot.id === id);
      if (index < 0) return;
      draft.slots[index] = build(draft.key);
    });
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
   * **M1 regenerates every degree slot unconditionally, and that is the simple
   * version rather than the intended one.** The design doc says a key change
   * regenerates an untouched slot but *transposes* a hand-edited one, and
   * leaves a `literal` slot's notes alone - which is why `ChordSlot` carries
   * `isHandEdited` and `SlotHarmony` has a `literal` branch. Neither branch is
   * reachable in M1: nothing here can hand-edit a slot, because the piano roll
   * that would is M2's, and the recogniser that degrades a slot to literal is
   * M3's. The branches land with them. Until then `regenerate` is safe to run
   * over everything, because every slot in an M1 document was generated from
   * its degree and nothing else.
   *
   * The key is applied even when its scale cannot build chords. Refusing it
   * would leave this page in a different key from the fretboard behind it,
   * which is a worse lie than a progression whose slots keep the notes they
   * already had.
   */
  setKey(tonic: number, scaleId: string): void {
    const scale = this.findScale(scaleId);

    this.commit(draft => {
      draft.key = {
        tonic,
        scaleId,
        // An unknown id is left with whatever preference was already in force:
        // there is no scale to ask, and guessing would be worse than keeping.
        preferSharps: scale ? scale.preferSharps : draft.key.preferSharps
      };

      if (!scale || !isHeptatonic(scale.intervals)) return;
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
   * The clone is what makes a mutation atomic: `mutate` writes to a copy, and a
   * throw out of it - or out of the normalisation that follows - leaves the
   * published state untouched rather than half-edited.
   */
  private commit(mutate: (draft: ProgressionDoc) => void, select?: string): void {
    const state = this.stateSubject.getValue();
    const previous = structuredClone(state.doc);
    const draft = structuredClone(state.doc);

    mutate(draft);

    this.pushHistory(previous);
    this.publish(this.settle(draft), select ?? state.selectedSlotId, true);
  }

  undo(): void {
    const state = this.stateSubject.getValue();
    const previous = this.undoStack.pop();
    if (!previous) return;

    this.redoStack.push(structuredClone(state.doc));
    this.publish(previous, state.selectedSlotId, true);
  }

  redo(): void {
    const state = this.stateSubject.getValue();
    const next = this.redoStack.pop();
    if (!next) return;

    this.undoStack.push(structuredClone(state.doc));
    this.publish(next, state.selectedSlotId, true);
  }

  /**
   * Replaces the whole document, e.g. on loading a saved progression.
   *
   * It is also the only door in M1 through which a `literal` slot can arrive,
   * which is how the characterisation of resizing one is testable at all
   * before M3 builds the recogniser that makes them for real.
   */
  replaceDocument(doc: ProgressionDoc, markClean = false): void {
    const state = this.stateSubject.getValue();
    this.pushHistory(structuredClone(state.doc));
    this.publish(this.settle(doc), state.selectedSlotId, !markClean);
  }

  private pushHistory(previous: ProgressionDoc): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > ProgressionService.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Bounds a document and lays its slots end to end.
   *
   * Normalise, then re-flow, and the order is not interchangeable: a length
   * clamped after the positions had been summed from it would leave every
   * later slot starting in the wrong place.
   */
  private settle(doc: ProgressionDoc): ProgressionDoc {
    const bounded = normalizeProgressionDoc(doc);
    return { ...bounded, slots: reflow(bounded.slots) };
  }

  /**
   * Publishes a document, deriving the state around it in one place.
   *
   * `canBuildChords` is a function of the key and the selection a function of
   * the slots, so both are computed here rather than at each call site - the
   * same argument that put the normalisation inside `commit()`. The selection
   * is validated rather than trusted, which is how removing the selected slot
   * clears the selection without `removeSlot` having to remember to.
   */
  private publish(doc: ProgressionDoc, selectedSlotId: string | null, isDirty: boolean): void {
    this.stateSubject.next({
      doc,
      selectedSlotId: doc.slots.some(slot => slot.id === selectedSlotId) ? selectedSlotId : null,
      canBuildChords: this.canBuildChords(doc.key),
      isDirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
    });
  }

  // -------------------------------------------------------------------------
  // Harmony
  // -------------------------------------------------------------------------

  /**
   * Re-derives everything a slot's harmony decides: its quality label and its
   * notes.
   *
   * Bounds first, generate second. The order is load-bearing for the same
   * reason it is in `commit()`: `generateSlotNotes` copies `lengthBeats` onto
   * every note it makes, so generating from an unbounded slot would give the
   * notes a length the slot itself is then clamped away from.
   */
  private regenerate(slot: ChordSlot, key: ProgressionKey): ChordSlot {
    const bounded = normalizeChordSlot(slot);

    const scale = this.findScale(key.scaleId);
    if (!scale || !isHeptatonic(scale.intervals)) return bounded;
    const intervals = scale.intervals;

    const labelled: ChordSlot =
      bounded.harmony.kind === 'degree'
        ? {
            ...bounded,
            harmony: {
              kind: 'degree',
              degree: {
                ...bounded.harmony.degree,
                quality: degreeQuality(
                  intervals,
                  bounded.harmony.degree.degree,
                  bounded.harmony.degree.extent
                )
              }
            }
          }
        : bounded;

    const notes = generateSlotNotes(labelled, key, intervals);
    // A literal slot gets its own array back by identity, and copying it would
    // report a change where none happened. Copy only what was built fresh.
    return notes === labelled.notes ? labelled : { ...labelled, notes: notes.slice() };
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

  /** Whether thirds can be stacked through the key's scale at all. */
  private canBuildChords(key: ProgressionKey): boolean {
    const scale = this.findScale(key.scaleId);
    return scale !== null && isHeptatonic(scale.intervals);
  }
}

/**
 * The rung of the `CHORD_EXTENTS` ladder that `extent` means, or null when it
 * means nothing.
 *
 * The union type says the argument is always on the ladder. A +/- stepper says
 * otherwise: walking off the top computes `CHORD_EXTENTS[5]` and off the bottom
 * `CHORD_EXTENTS[-1]`, and both are `undefined` at runtime whatever their
 * static type. They are indistinguishable from each other, so there is no end
 * to clamp *toward* - and refusing leaves the control resting on the rung it
 * was already on, which is exactly what clamping at that end would have shown
 * the user.
 *
 * A finite value that is simply not a rung - from a caller that computed an
 * extent rather than indexing one - snaps to the nearest, which clamps at both
 * ends: 14 and 100 both give 13, 2 and -50 both give 3.
 */
function nearestExtent(extent: ChordExtent): ChordExtent | null {
  if (CHORD_EXTENTS.includes(extent)) return extent;
  if (!Number.isFinite(extent)) return null;
  return CHORD_EXTENTS.reduce((best, rung) =>
    Math.abs(rung - extent) < Math.abs(best - extent) ? rung : best
  );
}

/**
 * Whether two degrees would build the same chord.
 *
 * The comparisons are collected into a `Record<keyof ChordDegree, boolean>`
 * rather than chained with `&&`, so that a field added to `ChordDegree` and
 * forgotten here is a compile error rather than a comparison that silently
 * stops noticing an edit - and an edit this fails to notice is one that is
 * never committed.
 */
function sameDegree(a: ChordDegree, b: ChordDegree): boolean {
  const matches: Record<keyof ChordDegree, boolean> = {
    degree: a.degree === b.degree,
    alter: a.alter === b.alter,
    extent: a.extent === b.extent,
    quality: a.quality === b.quality,
    inversion: a.inversion === b.inversion,
    suspension: a.suspension === b.suspension,
    octave: a.octave === b.octave
  };
  return Object.values(matches).every(match => match);
}

/**
 * Lays slots end to end, so the timeline has no hole and no overlap.
 *
 * Returns a slot unchanged when it is already in the right place, so a mutation
 * that moved nothing - a tempo change, an inversion - hands back the same
 * objects it was given and change detection sees no edit.
 */
function reflow(slots: readonly ChordSlot[]): ChordSlot[] {
  let beat = 0;
  return slots.map(slot => {
    const placed = slot.startBeat === beat ? slot : { ...slot, startBeat: beat };
    beat += slot.lengthBeats;
    return placed;
  });
}
