import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PianoRollComponent } from './piano-roll.component';
import { ProgressionState } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * The roll's half of M3 Task 9: when a pitch gesture is read back as a chord.
 *
 * The rule is one reading per gesture, in that gesture's undo entry, and the
 * roll is the only thing on the page that knows where a gesture ends. So this
 * file pins three decisions and nothing else:
 *
 *  1. **A move defers.** Every commit it makes passes `deferRecognition`, so the
 *     card does not flicker through the chords a travelling note passes over.
 *  2. **Pointerup settles, from the gesture-start snapshot** - and only when the
 *     drag actually committed, which is the discipline
 *     `ProgressionNoteEditor.writeNotes` argues: the settle continues the drag's
 *     run, and a continuation of a run that never opened folds into the previous
 *     gesture's entry.
 *  3. **The other two gestures never settle**, because a timing edit and a
 *     velocity edit never change what a slot is called.
 *
 * Driven through the `begin*` seam with a geometry the test supplies, on
 * `piano-roll.component.spec.ts`' terms and for its reason - the layout is not
 * what is under test. That file is at the project's 1000-line cap, which is why
 * this is a sibling rather than a fourth `describe` in it; the precedent is M3
 * Task 6's split of the palette's spec.
 */
describe('PianoRollComponent: reading a drag back as a chord', () => {
  let fixture: ComponentFixture<PianoRollComponent>;
  let component: PianoRollComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PianoRollComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(PianoRollComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function settle(): void {
    fixture.detectChanges();
  }

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /** Appends a chord and renders it; `appendSlot` selects what it appends. */
  function build(degree = 0): string {
    progression.appendSlot(degree);
    settle();
    return currentState().doc.slots[0].id;
  }

  function pointerAt(clientX: number, clientY: number): PointerEvent {
    return { clientX, clientY, button: 0 } as PointerEvent;
  }

  const PX_PER_BEAT = 40;
  const ROW_HEIGHT = 12;

  /** The harmony of the only slot, as the document holds it. */
  function harmony() {
    return currentState().doc.slots[0].harmony;
  }

  /**
   * A note dragged one row down the screen, which is one semitone down in pitch.
   * `heldRows` inverts the axis; `midiToY` argues why.
   */
  function dragDownOneRow(index: number): void {
    component.beginMove(index, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
    component.onPointerMove(pointerAt(100, 100 + ROW_HEIGHT));
  }

  it('defers recognition on every commit a move makes', () => {
    build();
    spyOn(progression, 'placeNotes').and.returnValue(true);

    dragDownOneRow(0);

    expect(progression.placeNotes).toHaveBeenCalledWith(
      jasmine.any(String),
      jasmine.any(Array),
      jasmine.objectContaining({ deferRecognition: true })
    );
  });

  it('settles the gesture on pointerup, against the notes it began with', () => {
    const id = build();
    const before = currentState().doc.slots[0].notes.map(note => ({ ...note }));
    spyOn(progression, 'settlePitchGesture').and.returnValue(true);

    dragDownOneRow(0);
    component.onPointerUp();

    expect(progression.settlePitchGesture).toHaveBeenCalledWith(id, before);
  });

  /** A cancelled pointer is a finished gesture too: everything it did is stored. */
  it('settles a cancelled gesture as well', () => {
    build();
    spyOn(progression, 'settlePitchGesture').and.returnValue(true);

    dragDownOneRow(0);
    component.onPointerCancel();

    expect(progression.settlePitchGesture).toHaveBeenCalled();
  });

  /**
   * The discipline. A setter that declined leaves no entry to continue, and a
   * settle under the drag's run key would fold into the entry the *previous*
   * gesture left - one undo taking back two drags.
   */
  it('settles nothing when the drag committed nothing', () => {
    build();
    spyOn(progression, 'placeNotes').and.returnValue(false);
    spyOn(progression, 'settlePitchGesture');

    dragDownOneRow(0);
    component.onPointerUp();

    expect(progression.settlePitchGesture).not.toHaveBeenCalled();
  });

  it('settles nothing when no note was dragged at all', () => {
    build();
    spyOn(progression, 'settlePitchGesture');

    component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
    component.onPointerUp();

    expect(progression.settlePitchGesture).not.toHaveBeenCalled();
  });

  /** M1's rule, kept where the gesture ends: neither of the other two reads. */
  it('never settles a resize or a velocity drag', () => {
    build();
    spyOn(progression, 'settlePitchGesture');

    component.beginResize(0, 100, PX_PER_BEAT);
    component.onPointerMove(pointerAt(100 + PX_PER_BEAT, 100));
    component.onPointerUp();

    component.beginVelocity(0, 100, 0.5);
    component.onPointerMove(pointerAt(100, 60));
    component.onPointerUp();

    expect(progression.settlePitchGesture).not.toHaveBeenCalled();
  });

  /**
   * End to end, through the real service: the third of a `I` dragged down a
   * semitone is a minor triad, and the card says so only once the pointer is up.
   * One undo takes back the note and the numeral together.
   */
  it('relabels once the drag is released, and undoes as one step', () => {
    build();

    dragDownOneRow(1);
    settle();

    expect(harmony()).toEqual(jasmine.objectContaining({ kind: 'degree' }));
    expect(currentState().relabel).toBeNull();

    component.onPointerUp();
    settle();

    const relabelled = harmony();
    if (relabelled.kind !== 'degree') throw new Error('the slot lost its numeral');
    expect(relabelled.degree.quality).toBe('minor');
    expect(currentState().relabel?.slotId).toBe(currentState().doc.slots[0].id);

    progression.undo();
    settle();

    const restored = harmony();
    if (restored.kind !== 'degree') throw new Error('the slot lost its numeral');
    expect(restored.degree.quality).toBeNull();
    expect(currentState().doc.slots[0].notes.map(note => note.midi)).toEqual([60, 64, 67]);
  });
});
