import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CHORD_EXTENTS,
  createExtensions,
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
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import {
  keyTransposeInterval,
  nearestExtent,
  reclaimPitches,
  regenerateSlot,
  retimeNotes,
  sameDegree,
  sameNotes,
  sameOwnership
} from './progression-edit';
import { chordOctaveCeiling } from './progression-generate';
import { ChordExtent, NamedQuality } from './progression-harmony';
import { HistoryDepth, ProgressionStore } from './progression-history';
import { ProgressionKeyContext } from './progression-key-context';
import { EditOptions, ProgressionNoteEditor } from './progression-note-editor';
import { MusicTheoryService } from './music-theory.service';

/**
 * Re-exported so that a caller naming the option type names it where it names
 * the setters that take it. `EditOptions` is shared by `setSlotLength`, which
 * is still here, and by all four of the roll's setters, which are not.
 */
export type { EditOptions };

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
 * Where a slot's octave control stands, as `ProgressionService.slotOctave`
 * reports it.
 *
 * Three numbers rather than one because the clamp is applied on use: the
 * document holds the request, the synth hears the sounding value, and the
 * control has to disable itself against the ceiling. Collapsing them would put
 * the palette back to guessing which it had.
 *
 * ## The two predicates a control reads off these
 *
 * The stepper steps from `sounding` and the readout shows it, for the reason
 * `slotOctave` gives at length. What that method does not spell out, and Task
 * 6's palette needs, is which comparison answers which question:
 *
 *  - **`sounding >= ceiling` disables the `+` stepper.** It covers both ways of
 *    running out of room without distinguishing them, which is right for a
 *    button: at the top of the control and too wide to go higher are the same
 *    fact about what the next press would do, namely nothing.
 *  - **`requested > ceiling` chooses the message**, and only then. It is true
 *    exactly when the chord itself is the limit - the document is asking for an
 *    octave this chord cannot take - so it selects "this chord is too wide to go
 *    higher" over the ordinary "this is the top of the range".
 *
 * They are different tests and folding them into one loses a case: a chord whose
 * `ceiling` is below `OCTAVE_MAX` but which is sitting *under* that ceiling has
 * `requested === sounding < ceiling`, is limited by nothing yet, and should show
 * an enabled stepper and no message at all.
 */
export interface SlotOctave {
  /** What `ChordDegree.octave` stores: what the user asked for. */
  requested: number;
  /** What the chord is voiced at, which is `min(requested, ceiling)`. */
  sounding: number;
  /**
   * The highest octave this chord fits in, bounded by `OCTAVE_MAX`. Below it,
   * the chord is too wide to sound where it was asked to.
   */
  ceiling: number;
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
 * everything that knows what a chord is - `regenerate`, `editDegree`,
 * `reclaimPitches`, and every refusal argued below.
 *
 * The seam is `derive`. `ProgressionState` carries `canBuildChords` and
 * `keyScale`, which are `ProgressionKeyContext` resolving a scale id and
 * `isHeptatonic` over what comes back - harmony, and the one thing the store
 * must not learn. So the store is handed this service's own `derive` at
 * construction and calls it, contributing only the `HistoryDepth` it alone
 * knows. An `inject()` in that file instead would compile and pass, and would
 * put the resolution of a scale id inside the undo stack.
 *
 * The shape is still `ComposerService`'s, for the reason that service gives:
 * every mutation goes through one `commit()`, which snapshots the previous
 * document onto an undo stack with `structuredClone`. `ProgressionDoc` is an
 * acyclic plain object, so a snapshot is one call and a whole document is the
 * unit of undo. `ProgressionStore` is where that now lives, along with what
 * `settle()` does on the way out of every commit.
 *
 * ## Nor does it write the roll's notes
 *
 * `ProgressionNoteEditor` is the second collaborator, on the same terms: owned,
 * private, and reached only through one-line delegations. Its seam is that
 * **nothing in it resolves a scale** - `setSlotNotes`, `placeNotes`,
 * `setNoteTiming`, `setNoteVelocity` and the `writeNotes` funnel under them
 * work out notes and claims and commit the pair, and never ask what chord a
 * slot is. `resetSlotToChord` reads like a fifth one and stayed here, because
 * it rebuilds the block chord from the degree and so needs `regenerate`. That
 * is the whole of what pins it: `canBuildChords` is `this.keys.canBuildChords`
 * now, on an object a collaborator can simply be handed. See
 * `progression-key-context.ts`, which puts the same seam sharply - it holds
 * only while what the editor is handed cannot rebuild a chord.
 *
 * It is handed the store rather than this service, which is what keeps that
 * seam from being a matter of discipline: there is no path from there to
 * `ProgressionKeyContext`.
 *
 * ## Nor does it resolve a key's scale
 *
 * `ProgressionKeyContext` is the third, and it is the answer to the question
 * both of the others were asking this service. `ProgressionKey.scaleId` is an
 * id into `MusicTheoryService`'s tables; `findScale`, `chordScale`,
 * `canBuildChords` and `spellingFor` are the whole of what resolving one and
 * reading the result comes to, and they are there now. The store still borrows
 * `derive`, and M3's recogniser will hand the note editor a scale the same way
 * - two arrows for one kind of knowledge, which is what made it worth a name.
 *
 * `derive` and `regenerate` stayed. Neither is key knowledge: the first builds
 * a whole `ProgressionState`, of which two fields are the key's and five are
 * not, and the second merges a rebuilt chord into a slot. That file's docstring
 * argues both, and why the second matters more than it looks.
 *
 * ## What the service refuses
 *
 * Diatonic chords need a seven-note scale, and `degreePitchClasses` throws on
 * anything else - so the service asks first, through `canBuildChords`, rather
 * than calling and catching. `isHeptatonic` is exported for that question;
 * `ProgressionKeyContext` is where it is now put.
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
   * How a key id becomes a scale. A field initializer rather than a line in the
   * constructor, because it needs nothing but `musicTheory` - which the line
   * above has filled by the time this one runs - and it has to be in place this
   * early because `ProgressionStore`'s constructor calls `derive`
   * *synchronously* to build its first state: the first publish happens inside
   * the line below that constructs the store, not at the first edit.
   */
  private readonly keys = new ProgressionKeyContext(this.musicTheory);

  /**
   * The document, the selection and the history.
   *
   * Constructed rather than injected, and private rather than exposed: "every
   * mutation goes through one commit" is a promise that holds only while there
   * is one door, and this service is that door.
   */
  private readonly store: ProgressionStore;

  /**
   * The roll's note setters. Constructed and kept private for the reason the
   * store is: one door.
   */
  private readonly notes: ProgressionNoteEditor;

  /**
   * Built in the constructor body rather than as a field initializer, because
   * the callback it hands over reads `keys` - which is filled by the field
   * initializer above, and so is in place by the time this line runs. The arrow
   * keeps `this` this service's, which is the whole of what the store borrows
   * from it.
   *
   * The editor follows on the next line rather than in a field initializer for
   * a plainer reason: it takes the store, which does not exist until the line
   * above has run.
   */
  constructor() {
    this.store = new ProgressionStore(
      createDefaultProgression(),
      (doc, selectedSlotId, isDirty, history) =>
        this.derive(doc, selectedSlotId, isDirty, history)
    );
    this.notes = new ProgressionNoteEditor(this.store);
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
    if (!this.keys.canBuildChords(doc.key)) return;

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
    if (!this.keys.canBuildChords(doc.key)) return;

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
    const slot = this.store.slot(id);
    if (!slot) return;

    const resized = normalizeChordSlot({ ...slot, lengthBeats: beats });
    if (resized.lengthBeats === slot.lengthBeats) return;

    this.store.commitSlot(id, () => retimeNotes(resized), {
      key: `length:${id}`,
      continues: options.coalesce === true
    });
  }

  /** See `ProgressionNoteEditor.setSlotNotes`. */
  setSlotNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): boolean {
    return this.notes.setSlotNotes(id, notes, options);
  }

  /** See `ProgressionNoteEditor.placeNotes`. */
  placeNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): boolean {
    return this.notes.placeNotes(id, notes, options);
  }

  /** See `ProgressionNoteEditor.setNoteTiming`. */
  setNoteTiming(
    id: string,
    noteIndex: number,
    startBeat: number,
    lengthBeats: number,
    options: EditOptions = {}
  ): boolean {
    return this.notes.setNoteTiming(id, noteIndex, startBeat, lengthBeats, options);
  }

  /** See `ProgressionNoteEditor.setNoteVelocity`. */
  setNoteVelocity(
    id: string,
    noteIndex: number,
    velocity: number,
    options: EditOptions = {}
  ): boolean {
    return this.notes.setNoteVelocity(id, noteIndex, velocity, options);
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
    if (!this.keys.canBuildChords(doc.key)) return;

    const slot = this.store.slot(id);
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

    this.store.commitSlot(id, () => reset);
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

    const slot = this.store.slot(id);
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
   * Where one slot's octave control actually stands: what was asked for, what
   * is sounding, and how high this chord may go.
   *
   * The three are usually one number. They come apart when a chord is too wide
   * for the octave it was given - `chordOctaveCeiling` explains why that is
   * clamped on use rather than written back - and this is what a control needs
   * in order to say so rather than to appear broken.
   *
   * ## The stepper steps from `sounding`, and the readout shows `sounding`
   *
   * That is the answer to "what octave is this slot on", and the other one is a
   * trap. A slot storing 1 against a ceiling of 0 *is* on 0: that is the chord
   * the user hears and the notes the roll draws. A readout showing 1 would be
   * describing a number in a document rather than a sound, and - worse - a
   * stepper that subtracted from 1 would write 0, change nothing that sounds,
   * and be a control that visibly does nothing. Stepping down from `sounding`
   * writes -1 and moves the chord, which is what the button says it does.
   *
   * `requested` is not shown, and is here because the palette's `+` needs to
   * know which of two things to say when it is disabled: the control is at its
   * limit, or this chord cannot go higher than it already is.
   *
   * ## What `null` means
   *
   * There is no octave: the slot is gone, it is literal - its notes are the
   * truth and there is no degree to voice - or the key cannot stack thirds at
   * all, which is the same refusal `editDegree` opens with. All three are cases
   * where the palette's controls are already not offered, so the caller has an
   * empty state to fall into rather than a number to disbelieve.
   */
  slotOctave(id: string): SlotOctave | null {
    const doc = this.doc;
    const scale = this.keys.chordScaleFor(doc.key);
    if (scale === null) return null;

    const slot = this.store.slot(id);
    if (!slot || slot.harmony.kind !== 'degree') return null;

    const degree = slot.harmony.degree;
    const ceiling = chordOctaveCeiling(doc.key, scale, degree);
    return {
      requested: degree.octave,
      sounding: Math.min(degree.octave, ceiling),
      ceiling
    };
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
    if (!this.keys.canBuildChords(doc.key)) return;

    const slot = this.store.slot(id);
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

    this.store.commitSlot(id, draftKey => this.regenerate(reclaimPitches(edited), draftKey));
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
   * `ProgressionKeyContext.spellingFor` works the spelling out from the tonic
   * and the mode, and that is the right answer for every caller that has only
   * those two numbers. It is not always the *available* answer: F sharp major
   * and G flat major are one pitch class and two keys, and a caller who knows
   * which of them the user picked knows something this service cannot
   * re-derive. The circle of fifths is that caller, through
   * `ProgressionComponent.adopt`, which hands over
   * `MusicTheoryService.shouldUseSharps()` - the app-wide answer, taken from
   * the key *name* the user clicked.
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
    const scale = this.keys.findScale(scaleId);

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
          this.keys.spellingFor(bounded.tonic, scaleId, scale, draft.key.preferSharps)
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
   * below need `ProgressionKeyContext.findScale` - an id resolved through
   * `MusicTheoryService` - and `isHeptatonic` over what comes back, which is
   * harmony; the two the store knows and this method cannot see are the ones it
   * hands over in `HistoryDepth`. So each side contributes exactly what it is
   * allowed to know, and neither can compute the other's half.
   *
   * ## Why it stayed here when those two questions went
   *
   * Only `keyScale` and `canBuildChords` are the key context's. The selection is
   * validated against the slots, `isDirty` and the two history flags are the
   * store's own, and none of that would have gone with a move - it would only
   * have arrived in that file because it happened to share a method with the
   * two lines that belong there. So this asks the key its two questions and
   * stays the seam the store borrows.
   */
  private derive(
    doc: ProgressionDoc,
    selectedSlotId: string | null,
    isDirty: boolean,
    history: HistoryDepth
  ): ProgressionState {
    const keyScale = this.keys.findScale(doc.key.scaleId);

    return {
      doc,
      selectedSlotId: doc.slots.some(slot => slot.id === selectedSlotId) ? selectedSlotId : null,
      canBuildChords: this.keys.chordScale(keyScale) !== null,
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
   *
   * The intervals it builds from are `ProgressionKeyContext`'s answer, and that
   * is the whole of what this asks the key: a slot is rebuilt here, where the
   * merge rules are, and the scale is resolved there, where the tables are.
   */
  private regenerate(slot: ChordSlot, key: ProgressionKey, transposeBy = 0): ChordSlot {
    return regenerateSlot(slot, key, this.keys.chordScaleFor(key), transposeBy);
  }
}

/**
 * A degree with everything the user pinned above the key dropped: the shape
 * override where there is one to drop and a diatonic answer to fall back to,
 * the suspension, and every pinned extension.
 *
 * The two guards on the *quality* are one rule read from both ends.
 * `quality: null` means "as the key gives it", and the key only gives an answer
 * on a degree of its own scale - so `normalizeChordDegree` refuses a null
 * quality over a displaced root, and a borrowed chord's shape is the whole of
 * what that chord is rather than an override on top of something else. Written
 * here rather than at the one call site so that the next caller who wants to
 * un-pin a slot gets the refusal instead of the throw.
 *
 * **The suspension and the extensions are dropped unconditionally**, and they
 * belong here on the same argument the quality does rather than as an extra.
 * All three are the user saying something the key did not: `'none'` and three
 * nulls are what a fresh slot carries and what "as the key gives it" means one
 * field over. Neither has a pairing that makes dropping it illegal - there is
 * no suspension a displaced root needs to stay buildable - so neither needs a
 * guard. And Reset to chord hands the *whole* slot back: a button that took
 * back the shape and left a ♭9 pinned would be the one path out of a hand-made
 * chord that does not quite lead out.
 *
 * Returns the degree itself when there is nothing to drop, so the comparison in
 * `resetSlotToChord` reads "the chord did not move" rather than needing a
 * second copy of these conditions to know whether it could have.
 */
function unpinned(degree: ChordDegree): ChordDegree {
  const quality = degree.quality !== null && degree.alter === 0 ? null : degree.quality;
  const dropped: ChordDegree = {
    ...degree,
    quality,
    suspension: 'none',
    extensions: createExtensions()
  };
  return sameDegree(dropped, degree) ? degree : dropped;
}

/**
 * A degree with the four fields a choice names written over it, and the four
 * it does not name - inversion, suspension, extensions, octave - left where
 * they were.
 *
 * Leaving them is the same rule as ever and it is worth restating now that two
 * of them sound: a palette button re-shapes the chord it is pressed on, so a
 * slot that was suspended stays suspended and a pinned ♭9 stays pinned.
 * `unpinned`, above, is the one that takes all of it back, and the note under
 * the alternates row already names Reset to chord as the way there.
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
function chosen(degree: ChordDegree, choice: ChordChoice): ChordDegree {
  return {
    ...degree,
    degree: choice.degree,
    alter: choice.alter,
    quality: choice.quality,
    extent: choice.extent
  };
}
