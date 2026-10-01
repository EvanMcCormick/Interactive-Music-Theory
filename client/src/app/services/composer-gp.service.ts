import { ErrorHandler, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

import { CaretSelection, EditCursor, ScoreDoc, createDefaultCursor } from '../models/composer.model';
import { ComposerService } from './composer.service';
import { CaretOwner, CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { changesDocument } from './composer-edit-intent';
import { LossItem, conversionLossOf, unmeasuredLoss } from './gp-conversion-loss';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/** A `.gp` file as alphaTab read it: what opening it into the Original state takes. */
export interface GpFile {
  /** The `gp-library` entry the bytes came from. Convert replaces exactly this entry with the composition. */
  entryId: string;
  fileName: string;
  /**
   * The only copy there will be: Convert drops them, and "Save the original file first" in the conversion prompt is
   * what writes them out.
   */
  bytes: ArrayBuffer;
  score: alphaTab.model.Score;
}

/** The file the composer is showing, with what converting it would change, measured once as it opened. */
export interface GpOriginal extends GpFile {
  /** `conversionLossOf` the file: what the conversion prompt lists. */
  loss: LossItem[];
  /**
   * The file read as a document (`toDoc`), as the loss was measured from it: what the caret is clamped to and moves over
   * in Original, and what the score reads a bar's clef from. `toDoc` keeps the score's track, staff, bar, voice and beat
   * indices and its string order (`ScoreDocMapperService.fromTrack` and below map each list one for one), so a caret
   * on it names the beat alphaTab drew. Null when the file could not be read as one.
   */
  doc: ScoreDoc | null;
}

/**
 * A command held back until the file is converted: the first command in Original that would change the document asks
 * first (design decision 4), and runs only once the prompt's Convert has made a document for it to change.
 */
export interface EditRequest {
  /** The command's id: a tool's, or one of `ASKING_PAGE_COMMANDS`. */
  id: string;
  /** What the prompt calls it: a tool's label, or a phrase for a page command - "Applying the alphaTex draft". */
  label: string;
  run: () => void;
}

/**
 * Which of the composer's two states the page is in, and the command waiting on the conversion prompt.
 *
 * Non-null `original` is **Original**: the bytes alphaTab read, every track rendered, no document. Null is
 * **Composition**: today's composer. A `.gp` opens in Original and every other way in starts in Composition.
 *
 * Its own root service rather than a field on `ComposerService`, which sits near `CLAUDE.md`'s 1000-line cap and whose
 * history M2 already moved out to make room. `ComposerState` gains nothing either: the empty document
 * it already holds is simply not drawn while an original is current.
 *
 * **Another composition opening ends Original.** A load, New, an opened transcription and Convert itself each move
 * `ComposerState.documentId` on, and the file on show is no longer what the page is about - so the service follows the
 * composer's state and clears itself, rather than every one of those paths remembering to.
 *
 * A progression sent over is not one of them. `sendProgression` is a plain commit into the composition that is open,
 * which in Original is the empty one no one can see, and `documentId` stays where it is - so it is gated instead, as any
 * edit is: the strip's Add progression track and Update, and the progression page's Send, each go through `requestEdit`.
 *
 * **The file has its own caret** (`caret`). The composition under it is empty, so a caret held there was clamped to its
 * bar 1; while a file is shown, `ComposerService` lends this service its caret commands (`lendCaret`), and they move
 * this caret over the file's document instead. Convert carries it into the composition (`GpConversionService`), so the
 * edit that asked is written where it was asked.
 */
@Injectable({ providedIn: 'root' })
export class ComposerGpService implements CaretOwner {
  private readonly subject = new BehaviorSubject<GpOriginal | null>(null);
  private readonly requestSubject = new BehaviorSubject<EditRequest | null>(null);
  private readonly caretSubject = new BehaviorSubject<CaretSelection | null>(null);
  /** The composition that was open when the file opened: once another is, Original ends. */
  private openedOver: number | null = null;
  /** The file's tracks a keyboard track move passes over, by index. See `passOverTracks`. */
  private passedOver: (trackIndex: number) => boolean = () => false;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly errors: ErrorHandler
  ) {
    this.composer.getState().subscribe(state => {
      if (this.openedOver !== null && state.documentId !== this.openedOver) this.clear();
    });
  }

  getState(): Observable<GpOriginal | null> {
    return this.subject.asObservable();
  }

  /** The command waiting on the conversion prompt, or null: the prompt is open while there is one. */
  getRequest(): Observable<EditRequest | null> {
    return this.requestSubject.asObservable();
  }

  /** The file being shown, or null in Composition. */
  get original(): GpOriginal | null {
    return this.subject.getValue();
  }

  /** Whether the page is in Original. */
  get isOriginal(): boolean {
    return this.subject.getValue() !== null;
  }

  /** The command waiting on the prompt, or null. */
  get request(): EditRequest | null {
    return this.requestSubject.getValue();
  }

  /** The caret over the file, or null in Composition. */
  getCaret(): Observable<CaretSelection | null> {
    return this.caretSubject.asObservable();
  }

  /** The caret over the file, or null in Composition. */
  get caret(): CaretSelection | null {
    return this.caretSubject.getValue();
  }

  /**
   * Shows `file`, replacing whatever was shown: opening a second file is not a stack. What converting it would change is
   * measured here, once, off the rendering path (design Risks): `toDoc` is the conversion's first step, and the checker
   * reads it for the notes no string would reach.
   *
   * **The caller resets the composer first.** Original ends when `documentId` moves off the composition open now
   * (`openedOver`), so a reset after this call would end it at once; and the composition under the file is the one a
   * held command runs against once converted, which should be an empty one, not whatever was being edited.
   *
   * A measurement that throws does not stop the file opening: alphaTab has read it and can draw it, and a model the
   * mapper or the checker has not met is theirs to fix, not a reason to refuse to show the file. The prompt then says
   * the loss could not be measured (`unmeasuredLoss`), which leaves Save the original first as the answer to it.
   */
  open(file: GpFile): void {
    const { doc, loss } = this.readingOf(file.score);
    this.openedOver = this.composer.state.documentId;
    this.requestSubject.next(null);
    // Before the file is published, so what hears it finds its caret.
    this.caretSubject.next({ cursor: doc ? clampedCursor(createDefaultCursor(), doc) : createDefaultCursor(), anchor: null });
    this.subject.next({ ...file, loss, doc });
    this.composer.lendCaret(this);
  }

  /**
   * The file as a document, and `conversionLossOf` it - or no document, and the one item saying it could not be measured.
   * A document of no bars is none for the caret: there is no beat to stand on, and `clampedCursor` reads bar 1.
   */
  private readingOf(score: alphaTab.model.Score): { doc: ScoreDoc | null; loss: LossItem[] } {
    let doc: ScoreDoc | null = null;
    try {
      const read = this.mapper.toDoc(score);
      doc = read.masterBars.length > 0 ? read : null;
      return { doc, loss: conversionLossOf(score, read) };
    } catch (error) {
      // Still a defect in the mapper or the checker, so it is reported where the app's defects go, not only dropped. A
      // document read before the checker threw still carries the caret.
      this.errors.handleError(error);
      return { doc, loss: unmeasuredLoss() };
    }
  }

  /** Back to Composition, dropping the bytes, the file's caret and any command waiting on the prompt. */
  clear(): void {
    this.openedOver = null;
    this.composer.lendCaret(null);
    this.requestSubject.next(null);
    if (this.caretSubject.getValue() !== null) this.caretSubject.next(null);
    if (this.subject.getValue() !== null) this.subject.next(null);
  }

  // -------------------------------------------------------------------------
  // The file's caret: `ComposerService`'s caret commands, lent here in Original (`CaretOwner`)
  // -------------------------------------------------------------------------

  /** Moves the file's caret, and drops any range. A press on the file names a beat it has; a key is clamped to it. */
  setCursor(cursor: Partial<EditCursor>): void {
    const caret = this.caret;
    if (caret) this.publishCaret(this.placed({ ...caret.cursor, ...cursor }), null);
  }

  /** Moves the range's moving end over the file, fixing the other where the caret was if there was no range. */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const caret = this.caret;
    if (caret) this.publishCaret(this.placed({ ...caret.cursor, ...cursor }), caret.anchor ?? caret.cursor);
  }

  /**
   * A key's move over the file (`movedCursor`), as `ComposerService.moveCursor` makes it over the composition. None when
   * the file could not be read as a document, which leaves nothing to move over.
   */
  moveCursor(move: CursorMove, extend: boolean): void {
    const caret = this.caret;
    const doc = this.original?.doc;
    if (!caret || !doc) return;
    const anchor = extend ? caret.anchor ?? caret.cursor : move.kind === 'string' ? caret.anchor : null;
    this.publishCaret(movedCursor(doc, caret.cursor, move, track => this.passedOver(doc.tracks.indexOf(track))), anchor);
  }

  /** Selects every beat of the caret's staff in the file. */
  selectAllInTrack(): void {
    const caret = this.caret;
    const doc = this.original?.doc;
    if (!caret || !doc) return;
    this.publishCaret(
      movedCursor(doc, caret.cursor, { kind: 'scoreEdge', edge: 'last' }),
      movedCursor(doc, caret.cursor, { kind: 'scoreEdge', edge: 'first' })
    );
  }

  /** The file's caret and range, and the file read as a document, for Copy (`CaretOwner.readSelection`). */
  readSelection(): { doc: ScoreDoc | null; caret: CaretSelection } | null {
    const caret = this.caret;
    return caret ? { doc: this.original?.doc ?? null, caret } : null;
  }

  /**
   * Makes a keyboard track move over the file pass over the tracks `test` names by index: the strip's hidden ones, which
   * `ComposerTrackViewService` holds and sets here, as it does `ComposerService.passOverTracks`.
   */
  passOverTracks(test: (trackIndex: number) => boolean): void {
    this.passedOver = test;
  }

  /** `cursor` clamped to the file's document - or as it is when there is none, a press's beat being one alphaTab drew. */
  private placed(cursor: EditCursor): EditCursor {
    const doc = this.original?.doc;
    return doc ? clampedCursor(cursor, doc) : cursor;
  }

  private publishCaret(cursor: EditCursor, anchor: EditCursor | null): void {
    this.caretSubject.next({ cursor, anchor });
  }

  /**
   * Runs `run` - or, in Original, when the command `id` would change the document (`changesDocument`), holds it and
   * opens the conversion prompt instead. The one gate every writing command on the page goes through: the tools, from
   * the palette and the keys, a popover's value, Pen's write, the strip's Add track, an alphaTex apply, and Save.
   */
  requestEdit(id: string, label: string, run: () => void): void {
    if (!this.isOriginal || !changesDocument(id)) {
      run();
      return;
    }
    // The first command asked is the one the prompt names. A second can only come from off the composer page, which is
    // inert behind the prompt - the progression page's Send pressed again before the composer showed the first, say.
    // Replacing the first would convert for a command the prompt may never have named, and drop the one it did; so the
    // second is dropped, as a Cancel would drop it.
    if (this.request !== null) return;
    this.requestSubject.next({ id, label, run });
  }

  /** Cancel: the command that asked is dropped, and nothing else changes. */
  cancelEdit(): void {
    this.requestSubject.next(null);
  }
}
