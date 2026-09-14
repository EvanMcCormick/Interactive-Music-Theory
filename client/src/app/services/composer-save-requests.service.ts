import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * A request to save the composition, from somewhere that cannot press the library's Save button - the
 * keyboard's Ctrl+S.
 *
 * Save stays the library panel's: its refusal of a linked progression track, its live regions and its
 * focus return all belong to the press, whichever way the press arrives. So this carries no document
 * and does no saving. It only asks, and the panel answers by running its own `save()`.
 *
 * It also carries the other way what can stand in the way of a save that the panel cannot see: the page's
 * alphaTex draft. A save writes the document, not the text box, so saving with a draft not yet applied
 * would leave the draft unsaved without a word. The page registers a guard; the panel asks before any save.
 */
@Injectable({ providedIn: 'root' })
export class ComposerSaveRequests {
  private readonly requests = new Subject<void>();
  private guards: ReadonlyArray<() => boolean> = [];

  /** Emits once per request. */
  readonly requested$: Observable<void> = this.requests.asObservable();

  request(): void {
    this.requests.next();
  }

  /**
   * Registers something that can refuse a save, and returns the function that removes it. A guard answers
   * true to refuse, and says why itself, where the thing it guards is shown.
   */
  guard(refuses: () => boolean): () => void {
    this.guards = [...this.guards, refuses];
    return () => (this.guards = this.guards.filter(other => other !== refuses));
  }

  /** Whether a guard refuses a save now. Asked by the library panel before every save, clicked or keyed. */
  refused(): boolean {
    return this.guards.some(refuses => refuses());
  }
}
