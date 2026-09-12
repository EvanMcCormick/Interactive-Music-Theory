import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ProgressionDoc, ProgressionState } from '../models/progression.model';

/**
 * `ProgressionDoc.revision`: the counter the Composer's staleness check reads.
 *
 * One number, compared for equality against the one a generated track was
 * built from. The design doc argues in "Staleness is one comparison, and it
 * over-reports in the safe direction" why that comparison is worth more than a
 * hash of the projection: it can report a staleness the user cannot see the
 * reason for, costing a needless Update, and it cannot miss one, which would
 * cost a badge that lies.
 *
 * Two specs below are the two halves of what the number has to be, and both are
 * load-bearing on the explicit-Update design:
 *
 *  - **It travels with the document.** Undo restores a document, so a document
 *    restored to what it was reads as the revision it was, and a track built
 *    from it is current again. A counter published from beside the document
 *    would climb through the undo and call that track stale.
 *  - **It is never issued twice.** Which is why the *allocator* does not travel
 *    with the document. Undo, then a different edit, and a path counter hands
 *    the abandoned branch's number to a document that is not the one the track
 *    was built from - the badge going quiet about exactly the case it exists
 *    for.
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

  /**
   * The other half of the property, and the one a path counter fails.
   *
   * Undo rewinds the document, so `previous + 1` hands the number the abandoned
   * branch already used to a document with different content in it. A track
   * marked with that number then reads as current against a document it was
   * never built from - the badge staying quiet is exactly the failure the
   * counter exists to prevent.
   */
  it('never issues one number to two different documents', () => {
    service.appendSlot(0);
    service.appendSlot(1);
    const abandoned = revision();

    service.undo();
    service.appendSlot(2);

    expect(revision()).not.toBe(abandoned);
  });

  /**
   * `replaceDocument` is the load door, and the number a document arrives
   * holding was issued by whatever produced it. Installing it as-is would let a
   * saved progression re-use a number this store has already spent.
   */
  it('gives a replaced document a number of its own rather than the one it arrives holding', () => {
    service.appendSlot(0);
    service.appendSlot(1);
    const issued = revision();

    service.replaceDocument({ ...currentState().doc, revision: 0 });

    expect(revision()).toBeGreaterThan(issued);
  });

  // A document written before the field existed arrives with no number at all.
  // Counting from it is `undefined + 1`, and NaN never equals NaN, so every
  // later comparison would read stale forever.
  it('counts on from a document that predates the field', () => {
    const legacy: ProgressionDoc = { ...currentState().doc };
    delete (legacy as Partial<ProgressionDoc>).revision;

    service.replaceDocument(legacy);
    service.appendSlot(0);

    expect(Number.isFinite(revision())).toBe(true);
  });
});
