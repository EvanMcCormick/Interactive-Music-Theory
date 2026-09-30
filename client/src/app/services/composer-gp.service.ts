import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

/**
 * The `.gp` file the composer is showing as alphaTab read it - every track, as the file was written, with no
 * `ScoreDoc` behind it.
 *
 * `bytes` is the only copy there will be: Convert drops them, and "Save the original file first" in the conversion
 * prompt is what writes them out.
 */
export interface GpOriginal {
  /** The `gp-library` entry the bytes came from. Convert replaces exactly this entry with the composition. */
  entryId: string;
  fileName: string;
  bytes: ArrayBuffer;
  score: alphaTab.model.Score;
}

/**
 * Which of the composer's two states the page is in.
 *
 * Non-null is **Original**: the bytes alphaTab read, every track rendered, no document. Null is **Composition**:
 * today's composer. A `.gp` opens in Original and every other way in starts in Composition.
 *
 * Its own root service rather than a field on `ComposerService`, which is 861 lines against `CLAUDE.md`'s 1000-line
 * cap and whose history M2 already moved out to make room. `ComposerState` gains nothing either: the empty document
 * it already holds is simply not drawn while an original is current.
 */
@Injectable({ providedIn: 'root' })
export class ComposerGpService {
  private readonly subject = new BehaviorSubject<GpOriginal | null>(null);

  getState(): Observable<GpOriginal | null> {
    return this.subject.asObservable();
  }

  /** The file being shown, or null in Composition. */
  get original(): GpOriginal | null {
    return this.subject.getValue();
  }

  /** Whether the page is in Original. */
  get isOriginal(): boolean {
    return this.subject.getValue() !== null;
  }

  /** Shows `original`, replacing whatever was shown: opening a second file is not a stack. */
  open(original: GpOriginal): void {
    this.subject.next(original);
  }

  /** Back to Composition, dropping the bytes: a conversion, or a composition opened over the file. */
  clear(): void {
    this.subject.next(null);
  }
}
