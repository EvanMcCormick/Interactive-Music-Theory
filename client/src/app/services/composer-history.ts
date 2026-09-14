import { ComposerState, DocumentReplacement, EditCursor, ScoreDoc } from '../models/composer.model';
import { clampedCursor } from './composer-cursor';
import { beatAt, followedEnd } from './composer-selection';
import { EditOutcome, SelectionPlacement, noticeOfOutcome } from './composer-service-structure';

/**
 * The composer's history - commits, undo and redo, and replacing the whole document - and what the status line's live
 * region says: a refusal, or a notice.
 *
 * Nothing here touches the page: the prompt before a new composition discards unsaved work is `ComposerService`'s
 * (`confirmDiscard`), which asks this only what the document holds.
 *
 * Lifted out of `ComposerService` for the 1000-line cap, as `composer-service-structure.ts` and
 * `composer-entry-commands.ts` were. The service owns the state subject and exposes each command; this class holds the
 * undo and redo stacks and reaches the state only through `ComposerHistoryHost`.
 *
 * ScoreDoc is an acyclic plain object, so a snapshot is a structuredClone - the reason the composer keeps its own model
 * rather than mutating alphaTab's Score, whose cyclic parent references cannot be cloned cheaply.
 */

/** What the history needs from `ComposerService`: the state, and a way to publish the next one. */
export interface ComposerHistoryHost {
  state(): ComposerState;
  publish(state: ComposerState): void;
}

/** Commits, undo and redo, and the refusals and notices published beside them. */
export class ComposerHistory {
  private static readonly MAX_HISTORY = 100;

  private undoStack: ScoreDoc[] = [];
  private redoStack: ScoreDoc[] = [];

  constructor(private readonly host: ComposerHistoryHost) {}

  /**
   * Runs `edit` on a cloned document and commits the result - or, when `edit` returns a reason,
   * publishes that and commits nothing. With `amend` the result replaces the last commit instead of
   * adding an undo step: the second digit of a two-digit fret (`retypeNote`).
   */
  commit(edit: (draft: ScoreDoc) => EditOutcome, amend = false): void {
    const state = this.host.state();
    const draft = structuredClone(state.doc);
    const reason = edit(draft);
    if (typeof reason === 'string') return this.refuse(reason);
    // An amend replaces the commit before it, whose notice - a fermata the first digit's note removed - still holds.
    const notice = noticeOfOutcome(null, reason);
    this.commitDocument(draft, undefined, amend, amend ? notice ?? state.notice : notice);
  }

  /**
   * Runs `edit` on a clone of the document and commits it with the selection still on its
   * beats - or, when `edit` returns a reason, publishes that and commits nothing, so an edit
   * that refuses part-way leaves nothing behind.
   *
   * The selection's ends name beats by position, and an edit can move the beats they name: a
   * duration change puts rests right after each beat it shortens, a new grace gets its gap's
   * rests in front of it, Fix bar splits and carries beats. Left by position, a range of four
   * notes made eighths would end on a rest halfway through them, and the next press would miss
   * half the notes. So the beat each end names is found before the edit and looked for again
   * after it (`followedEnd`). An end whose beat is gone stays where it was, clamped. `place`, when
   * given, decides the selection from those followed ends instead, in the same publish, and `notice`
   * what the command says it did (`ComposerState.notice`).
   */
  commitFollowing(
    edit: (draft: ScoreDoc) => EditOutcome,
    place?: (draft: ScoreDoc, followed: SelectionPlacement) => SelectionPlacement,
    notice?: () => string | null
  ): void {
    const state = this.host.state();
    const draft = structuredClone(state.doc);
    const cursorBeat = beatAt(draft, state.cursor);
    const anchorBeat = state.anchor ? beatAt(draft, state.anchor) : null;

    const reason = edit(draft);
    if (typeof reason === 'string') return this.refuse(reason);

    const followed: SelectionPlacement = {
      cursor: followedEnd(draft, state.cursor, cursorBeat),
      anchor: state.anchor ? followedEnd(draft, state.anchor, anchorBeat) : null
    };
    this.commitDocument(draft, place ? place(draft, followed) : followed, false, noticeOfOutcome(notice?.() ?? null, reason));
  }

  undo(): void {
    const state = this.host.state();
    const previous = this.undoStack.pop();
    if (!previous) return;

    this.redoStack.push(structuredClone(state.doc));
    this.host.publish({
      ...state,
      doc: previous,
      cursor: clampedCursor(state.cursor, previous),
      anchor: state.anchor ? clampedCursor(state.anchor, previous) : null,
      refusal: null,
      notice: null,
      isDirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: true
    });
  }

  redo(): void {
    const state = this.host.state();
    const next = this.redoStack.pop();
    if (!next) return;

    this.undoStack.push(structuredClone(state.doc));
    this.host.publish({
      ...state,
      doc: next,
      cursor: clampedCursor(state.cursor, next),
      anchor: state.anchor ? clampedCursor(state.anchor, next) : null,
      refusal: null,
      notice: null,
      isDirty: true,
      canUndo: true,
      canRedo: this.redoStack.length > 0
    });
  }

  /**
   * Replaces the whole document: by default an edit of this composition, as an applied alphaTex draft is, on the undo
   * stack. A new composition - a load, an opened transcription - moves `documentId` on and starts a fresh history.
   */
  replaceDocument(doc: ScoreDoc, { markClean = false, newComposition = false }: DocumentReplacement = {}): void {
    const state = this.host.state();
    if (newComposition) this.undoStack = [];
    else this.undoStack.push(structuredClone(state.doc));
    this.redoStack = [];

    this.host.publish({
      ...state,
      doc,
      cursor: clampedCursor(state.cursor, doc),
      anchor: null,
      refusal: null,
      notice: null,
      documentId: newComposition ? state.documentId + 1 : state.documentId,
      isDirty: !markClean,
      canUndo: this.undoStack.length > 0,
      canRedo: false
    });
  }

  /**
   * Marks the document clean, if `saved` - the document that was written - is still it. A save is written
   * asynchronously, and an edit made while it was being written is not in it, so it stays unsaved.
   */
  markSaved(saved: ScoreDoc): void {
    const state = this.host.state();
    if (state.doc !== saved) return;
    this.host.publish({ ...state, isDirty: false });
  }

  /** Forgets every undo and redo step, for a new score (`ComposerService.reset`). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Publishes why a command did nothing. Commits nothing, so it costs no undo step. */
  refuse(reason: string): void {
    const state = this.host.state();
    this.host.publish({ ...state, refusal: reason, notice: null, messageId: state.messageId + 1 });
  }

  /**
   * Says what happened outside the document's commands - a save, a load, an export - in the status line's one live region,
   * as a notice; or, when `failed`, why it did not, as a refusal. Commits nothing. A notice leaves a refusal still showing
   * as it is: it says nothing about why that press failed.
   */
  announce(message: string, failed = false): void {
    const state = this.host.state();
    this.host.publish({ ...state, refusal: failed ? message : state.refusal, notice: failed ? null : message, messageId: state.messageId + 1 });
  }

  /**
   * Publishes a prepared document and pushes the old one onto undo, with `selection` in place
   * of the current one when given. Either way the selection is clamped into the new document.
   */
  private commitDocument(
    next: ScoreDoc,
    selection?: { cursor: EditCursor; anchor: EditCursor | null },
    amend = false,
    notice: string | null = null
  ): void {
    const state = this.host.state();
    const cursor = selection ? selection.cursor : state.cursor;
    const anchor = selection ? selection.anchor : state.anchor;
    if (!amend) {
      this.undoStack.push(structuredClone(state.doc));
      if (this.undoStack.length > ComposerHistory.MAX_HISTORY) this.undoStack.shift();
    }
    this.redoStack = [];

    this.host.publish({
      ...state,
      doc: next,
      cursor: clampedCursor(cursor, next),
      anchor: anchor ? clampedCursor(anchor, next) : null,
      refusal: null,
      notice,
      // A new message, unless an amend kept the one already showing (`commit`).
      messageId: notice !== null && !(amend && notice === state.notice) ? state.messageId + 1 : state.messageId,
      isDirty: true,
      canUndo: true,
      canRedo: false
    });
  }
}
