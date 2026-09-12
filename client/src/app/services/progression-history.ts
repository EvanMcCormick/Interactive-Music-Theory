import { BehaviorSubject, Observable } from 'rxjs';
import {
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  ProgressionState,
  RelabelNotice
} from '../models/progression.model';
import { requireUniqueSlotIds, settle } from './progression-edit';

/**
 * The progression document, the strip's selection, and undo/redo - with no
 * opinion at all about what a chord is.
 *
 * This was the back half of `ProgressionService`, and it comes out on a seam
 * rather than at a line count. Everything below is one mechanism: a mutation is
 * applied to a clone, settled, snapshotted onto a stack, and published. What
 * makes it a seam is that **every rule here is enforced by a guard here**, so
 * nothing is separated from the thing that keeps it true:
 *
 *  - settle-then-push-then-publish is the last three lines of `commit`
 *  - run coalescing is `extendsRun` beside the `currentRun` it reads
 *  - eviction is `MAX_HISTORY` inside `pushUndo`, its only caller pair
 *  - dropping the redo branch is `pushHistory`, which is what "a new step makes
 *    the old future unreachable" means
 *
 * Nothing harmony-shaped came with it. `canBuildChords`, `regenerate`,
 * `editDegree`, `reclaimPitches` and every refusal the service's own docstring
 * argues are all still on the service's side of this split, because they are
 * rules about chords rather than about documents.
 *
 * ## Plain, not injectable, and owned rather than provided
 *
 * `ProgressionService` constructs one and holds it. There is no second
 * consumer, no reason for Angular to know it exists, and one very good reason
 * for it not to: an injectable store would be a second thing a component could
 * reach for, and "every mutation goes through one commit" is a promise that
 * only holds while there is one door. The service is that door and this is
 * behind it.
 *
 * ## Why it is handed a `derive` rather than given the pieces
 *
 * `ProgressionState` is bigger than a document. It carries `canBuildChords` and
 * `keyScale`, which are answers about *harmony* - `ProgressionKeyContext`
 * resolving an id through `MusicTheoryService`, then `isHeptatonic` over what
 * comes back - and a store that could work those out for itself would be a
 * store that had acquired the knowledge this split exists to keep out. So it
 * does not know them and cannot learn them: it is given a function at
 * construction and calls it, and the only thing it contributes is the pair of
 * numbers it alone knows, `HistoryDepth`.
 *
 * That is the one place this split can go wrong, and it goes wrong quietly -
 * an `inject()` here would compile, pass every test, and put the resolution of
 * a scale id inside the undo stack.
 *
 * ## What `settle()` does on every commit, which no setter is trusted to do
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
 * A value the normalisation refuses - a non-finite tempo, a fractional tonic -
 * throws out of the commit and publishes nothing, and that promise covers the
 * *history* as well as the document. See `commit`, where the order of three
 * lines is the whole of it.
 */

/** How many documents the undo stack holds before the oldest is dropped. */
const MAX_HISTORY = 100;

/**
 * A stretch of commits that undo as one step.
 *
 * `key` names the run - `length:<slotId>` - and `continues` says whether this
 * commit joins the run of that name or starts it. Only the caller knows which,
 * because the store cannot see where one drag ends and the next begins. See
 * `ProgressionStore.commit`.
 */
export interface CommitRun {
  key: string;
  continues: boolean;
}

/**
 * How far the history reaches in each direction, which is the only part of the
 * published state the store knows and the deriver does not.
 *
 * Passed rather than read back off the store, so that `derive` is a pure
 * function of its arguments and cannot observe a stack mid-push. The order in
 * `commit` is settle, push, publish, and this is what makes "publish" see the
 * push that has already happened rather than one that is about to.
 */
export interface HistoryDepth {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * How a document becomes the state the page reads.
 *
 * Everything on `ProgressionState` that is not a document, a selection or a
 * flag is a fact about harmony, so this is supplied by the owner rather than
 * computed here. See the note on the class above, which is the reason this is
 * a callback and not four more imports.
 */
export type DeriveState = (
  doc: ProgressionDoc,
  selectedSlotId: string | null,
  isDirty: boolean,
  history: HistoryDepth,
  relabel: RelabelNotice | null
) => ProgressionState;

export class ProgressionStore {
  private readonly derive: DeriveState;
  private readonly stateSubject: BehaviorSubject<ProgressionState>;
  private undoStack: ProgressionDoc[] = [];
  private redoStack: ProgressionDoc[] = [];

  /**
   * The run of commits the last one belonged to, or null when it belonged to
   * none. See `commit`, and `CommitRun` for what a run is.
   */
  private currentRun: string | null = null;

  /**
   * The next revision to hand out. Never reused, and never rewound.
   *
   * The number itself travels *on* the document, because undo restores a
   * document and a track built from one and undone back to it is current again.
   * What cannot live there too is the issuing. `state.doc.revision + 1` counts
   * the path rather than the document: undo one step, edit differently, and the
   * second branch is stamped with the number the first branch already spent - so
   * a generated track marked with it reads as current against a document it was
   * never built from, which is the badge going quiet about the one thing it
   * exists to say.
   *
   * A revision is therefore an identity and not a position. Undo moves which
   * number is published; it does not move which numbers are left.
   */
  private nextRevision = 1;

  /**
   * The first state goes through `derive` like every one after it, rather than
   * having the seven fields written out a second time. A field added to
   * `ProgressionState` and filled in only one of two places would be right
   * until the first render and wrong before the first click.
   *
   * It does not go through `publish`, which is the one asymmetry: a
   * `BehaviorSubject` has to be constructed with its first value, so the
   * subject cannot exist before the state does. `depth()` still answers, both
   * stacks being empty at that point, so the first state's `canUndo` and
   * `canRedo` are derived rather than asserted.
   *
   * Written as an assignment rather than a parameter property so that the
   * order is on the page: `derive` is in place before the line that calls it.
   */
  constructor(initial: ProgressionDoc, derive: DeriveState) {
    this.derive = derive;
    this.stateSubject = new BehaviorSubject<ProgressionState>(
      derive(initial, null, false, this.depth(), null)
    );
  }

  getState(): Observable<ProgressionState> {
    return this.stateSubject.asObservable();
  }

  get doc(): ProgressionDoc {
    return this.stateSubject.getValue().doc;
  }

  /** The slot with this id, or null when the document does not hold one. */
  slot(id: string): ChordSlot | null {
    return this.doc.slots.find(candidate => candidate.id === id) ?? null;
  }

  /** The relabel the last commit raised, or null. See `RelabelNotice`. */
  get relabel(): RelabelNotice | null {
    return this.stateSubject.getValue().relabel;
  }

  /**
   * Which slot the strip has selected. Not a document change, so not undoable -
   * and it drops any relabel notice, which is the one thing here that is not
   * simply "publish the same document again": the chip describes an edit to one
   * slot, and moving to another slot is the user having finished with it.
   */
  selectSlot(id: string | null): void {
    const state = this.stateSubject.getValue();
    this.publish(state.doc, id, state.isDirty);
  }

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
   *
   * ## The relabel notice rides on the commit, and defaults to none
   *
   * `notice` is page state and not part of the document, so it is neither
   * cloned, pushed, nor restored by `undo`. It is a parameter here rather than a
   * setter of its own for the one property that matters: it is published in the
   * **same emission** as the document it describes, so nothing can render a chip
   * naming a chord the published state does not hold yet.
   *
   * Defaulting to `null` is what makes "any document change clears it" a
   * mechanism rather than a convention. Every other commit on the page - a
   * palette step, an append, a resize, a key change - passes nothing and thereby
   * takes the chip down, without one of them having to know a chip exists.
   */
  commit(
    mutate: (draft: ProgressionDoc) => void,
    select?: string,
    run?: CommitRun,
    notice: RelabelNotice | null = null
  ): void {
    const state = this.stateSubject.getValue();
    const previous = structuredClone(state.doc);
    const draft = structuredClone(state.doc);

    mutate(draft);
    // Stamped here rather than inside `settle`, which `load` also calls and
    // which specs lean on being idempotent. `commit` is the one door a mutation
    // comes through, so it is the one place a mutation can be counted - and
    // counted from `nextRevision`, not from the document, for the reason that
    // field's docstring gives.
    const settled = { ...settle(draft), revision: this.nextRevision++ };

    // A continuation is only honoured while the run it names is the one under
    // way, so a caller that passes `continues` with nothing to continue - or
    // after an undo has moved the stack under it - opens an entry rather than
    // folding into whatever happens to be on top.
    const extendsRun = run !== undefined && run.continues && run.key === this.currentRun;
    if (!extendsRun) this.pushHistory(previous);
    this.currentRun = run?.key ?? null;

    this.publish(settled, select ?? state.selectedSlotId, true, notice);
  }

  /**
   * Swaps one slot for what `build` makes of it, by id, in one commit.
   *
   * Addressing a slot by id rather than by index is what makes this safe to
   * hand a `build` that was computed before the commit began: the index a slot
   * sits at is a fact about the document at a moment, and `settle()` re-flows
   * the timeline on the way out of every commit. An id that is no longer in the
   * document is a no-op inside the mutation - the entry is still pushed, which
   * is the same answer `commit` gives any mutation that changes nothing.
   *
   * It lives here rather than on either caller because both of them need it:
   * the service's own harmony edits and `ProgressionNoteEditor`'s note writes
   * are the same document operation with different things to put in the slot.
   */
  commitSlot(
    id: string,
    build: (key: ProgressionKey) => ChordSlot,
    run?: CommitRun,
    notice: RelabelNotice | null = null
  ): void {
    this.commit(
      draft => {
        const index = draft.slots.findIndex(slot => slot.id === id);
        if (index < 0) return;
        draft.slots[index] = build(draft.key);
      },
      undefined,
      run,
      notice
    );
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
   *
   * Both drop the relabel notice, through `publish`'s default. That is not
   * housekeeping either: the notice describes an edit that undo has just taken
   * back, so a chip surviving one would offer to revert a label the document no
   * longer carries.
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
   * where the ids are checked - and, like `commit`, it settles before it
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
   * `effectiveChord`'s docstring exists to prevent, arriving by the one road
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
   * need to make deliberately rather than inherit. It is also, now, a thing
   * this file could not do: regenerating a slot means resolving a scale, which
   * is exactly the harmony knowledge the split above keeps out. A loader that
   * wants it wants a method on `ProgressionService` that regenerates and then
   * calls this.
   *
   * ## The revision is re-issued, not adopted
   *
   * The `revision` on an arriving document was issued by whatever produced it
   * and means nothing to this store's allocator. Installed as it stands, it is a
   * number two documents can hold: the next commit here resumes from a counter
   * that never saw it, so a marker left behind by that other producer - a
   * generated track built from the file's own revision 7 - would later match a
   * document of ours that happens to reach 7 and read as current.
   *
   * So the allocator is first moved past whatever arrived, and then the
   * installed document is stamped from it like any commit. `?? 0` is the other
   * half: a document written before the field existed arrives holding
   * `undefined`, and `undefined + 1` is `NaN`, which - `NaN` equalling nothing,
   * itself included - would read as stale forever rather than fail loudly.
   *
   * The number a load *shows* is therefore not the number the file held, and
   * that is the trade: a revision means "this document, in this store", so the
   * only thing worth preserving across the door is the promise that no two
   * documents ever answer to one.
   */
  replaceDocument(doc: ProgressionDoc, markClean = false): void {
    const state = this.stateSubject.getValue();
    const clean = settle(requireUniqueSlotIds(doc));
    this.nextRevision = Math.max(this.nextRevision, (doc.revision ?? 0) + 1);
    const settled = { ...clean, revision: this.nextRevision++ };

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
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
  }

  /**
   * Publishes a document and everything the page derives from it.
   *
   * `notice` defaults to none, so every publish that does not deliberately raise
   * one takes down whatever chip was showing. See `commit`.
   */
  private publish(
    doc: ProgressionDoc,
    selectedSlotId: string | null,
    isDirty: boolean,
    notice: RelabelNotice | null = null
  ): void {
    this.stateSubject.next(this.derive(doc, selectedSlotId, isDirty, this.depth(), notice));
  }

  /** How far the history reaches, read at the moment of publishing. */
  private depth(): HistoryDepth {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
    };
  }
}
