import { ErrorHandler, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
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
 * Its own root service rather than a field on `ComposerService`, which is 861 lines against `CLAUDE.md`'s 1000-line
 * cap and whose history M2 already moved out to make room. `ComposerState` gains nothing either: the empty document
 * it already holds is simply not drawn while an original is current.
 *
 * **Another composition opening ends Original.** A load, New, an opened transcription and Convert itself each move
 * `ComposerState.documentId` on, and the file on show is no longer what the page is about - so the service follows the
 * composer's state and clears itself, rather than every one of those paths remembering to.
 *
 * A progression sent over is not one of them. `sendProgression` is a plain commit into the composition that is open,
 * which in Original is the empty one no one can see, and `documentId` stays where it is - so it is gated instead, as any
 * edit is: the strip's Add progression track and Update, and the progression page's Send, each go through `requestEdit`.
 */
@Injectable({ providedIn: 'root' })
export class ComposerGpService {
  private readonly subject = new BehaviorSubject<GpOriginal | null>(null);
  private readonly requestSubject = new BehaviorSubject<EditRequest | null>(null);
  /** The composition that was open when the file opened: once another is, Original ends. */
  private openedOver: number | null = null;

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
    const loss = this.lossOf(file.score);
    this.openedOver = this.composer.state.documentId;
    this.requestSubject.next(null);
    this.subject.next({ ...file, loss });
  }

  /** `conversionLossOf` the file, or the one item saying it could not be measured. */
  private lossOf(score: alphaTab.model.Score): LossItem[] {
    try {
      return conversionLossOf(score, this.mapper.toDoc(score));
    } catch (error) {
      // Still a defect in the mapper or the checker, so it is reported where the app's defects go, not only dropped.
      this.errors.handleError(error);
      return unmeasuredLoss();
    }
  }

  /** Back to Composition, dropping the bytes and any command waiting on the prompt. */
  clear(): void {
    this.openedOver = null;
    this.requestSubject.next(null);
    if (this.subject.getValue() !== null) this.subject.next(null);
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
