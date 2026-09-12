import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ProgressionState } from '../models/progression.model';

/**
 * `ProgressionDoc.revision`: the counter the Composer's staleness check reads.
 *
 * One number, compared for equality against the one a generated track was
 * built from. The design doc argues in "Staleness is one comparison, and it is
 * exact" that a document counter is not merely the cheap check but the exact
 * one, because every field of `ProgressionDoc` reaches the generated track -
 * so "the revision moved" and "Update would change something" name the same
 * set.
 *
 * The second spec below is the reason the counter lives on the *document*
 * rather than beside it on the store, and it is the one to keep working. Undo
 * restores a document, so a document restored to what it was must read as the
 * revision it was: a counter on the store would keep climbing through the undo
 * and report a track built from that document as stale when nothing about the
 * document had changed. That is not a nicety - it is the property the whole
 * explicit-Update design rests on, because it is what stops the badge claiming
 * a staleness the document does not have.
 */
describe('ProgressionService revision', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  /**
   * The state as it stands now.
   *
   * The throw is the assertion that `getState()` is backed by a
   * `BehaviorSubject`: a plain `Subject` would publish nothing to a subscriber
   * that arrives after the fact, and every expectation below would then be
   * reading a stale local rather than the service.
   */
  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    service.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function revision(): number {
    return currentState().doc.revision;
  }

  it('starts at 0 and rises once per commit', () => {
    expect(revision()).toBe(0);
    service.appendSlot(0);
    expect(revision()).toBe(1);
    service.setTempo(96);
    expect(revision()).toBe(2);
  });

  // The reason the counter lives on the document. A track built from revision 1
  // and then undone back to revision 1 is not stale, and would be if undo
  // stamped a fresh number onto an identical document.
  it('travels backwards with undo rather than counting the undo', () => {
    service.appendSlot(0);
    const at = revision();
    service.appendSlot(1);
    service.undo();
    expect(revision()).toBe(at);
  });

  it('does not rise on a publish that changes no document', () => {
    service.appendSlot(0);
    const at = revision();
    service.selectSlot(currentState().doc.slots[0].id);
    expect(revision()).toBe(at);
  });
});
