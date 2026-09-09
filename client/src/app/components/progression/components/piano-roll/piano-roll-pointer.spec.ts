import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PianoRollComponent } from './piano-roll.component';
import { VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * The adapter under the roll's gestures, driven by real events on a rendered
 * roll: which button was pressed, which element gets measured and by what
 * divisor, what is listened to and what is let go of.
 *
 * The layer below - which service call a gesture makes, with which arguments,
 * and when - is next door in `piano-roll.component.spec.ts`, driven through the
 * `begin*` seam with a geometry the test supplies. The arithmetic under that is
 * in `piano-roll-geometry.spec.ts`. This is the strip's three-file split, and
 * this file is the one the strip shipped without: it left six mutants alive in
 * the adapter, including a dropped pixels-per-beat divisor and a deleted
 * mouse-button guard, because none of that can be reached by calling
 * `beginResize`.
 *
 * It pins no layout. Every coordinate comes from a live
 * `getBoundingClientRect()` and every assertion is about what was dispatched to
 * `ProgressionService` or about where the browser actually drew a note; there is
 * not a hard-coded width, offset or row height in the file, so the stylesheet
 * can move and these still hold. Two of them are about the stylesheet on
 * purpose - a note is one row tall and one beat-width per beat wide - because
 * the scale the pointer arithmetic uses is *measured* off the grid, so a
 * stylesheet that draws a note somewhere other than where the model says is a
 * gesture that will act on the wrong note.
 */
describe('PianoRollComponent pointer gestures', () => {
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

  /** The notes of the first slot, as the document holds them. */
  function storedNotes(): readonly RollNote[] {
    return currentState().doc.slots[0].notes;
  }

  /**
   * Appends a chord and renders it. `appendSlot` selects what it appends, so
   * the roll opens on it exactly as it does when a user clicks the palette.
   */
  function build(degree = 0): string {
    progression.appendSlot(degree);
    settle();
    return currentState().doc.slots[0].id;
  }

  function pointer(type: string, clientX: number, clientY: number, init: PointerEventInit = {}) {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
      ...init
    });
  }

  function element(selector: string): HTMLElement {
    const found = fixture.nativeElement.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`no ${selector} on the roll`);
    return found;
  }

  function grid(): HTMLElement {
    return element('.grid');
  }

  function noteElements(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.note'));
  }

  function partOf(index: number, selector: string): HTMLElement {
    const part = noteElements()[index].querySelector(selector);
    if (!(part instanceof HTMLElement)) throw new Error(`no ${selector} on note ${index}`);
    return part;
  }

  /**
   * The scale the roll is drawn at, taken from the grid rather than assumed:
   * the whole point of the absolute layout is that a beat is the same width
   * wherever it falls, so the grid is exactly `totalBeats` of them across.
   */
  function beatWidth(): number {
    return grid().getBoundingClientRect().width / component.totalBeats;
  }

  function rowHeight(): number {
    return grid().getBoundingClientRect().height / component.gridRows;
  }

  /** Where a beat and a pitch fall on the screen, from the same live rect. */
  function clientOf(beat: number, midi: number): [number, number] {
    const rect = grid().getBoundingClientRect();
    return [
      rect.left + beat * beatWidth(),
      rect.top + (component.topMidi - midi + 0.5) * rowHeight()
    ];
  }

  /**
   * The bug the absolute layout exists to prevent. M1's strip scaled a drag
   * by a proportional width, so the edge it was holding ran up to 525px from
   * the cursor. Nothing about that can be seen through `beginMove`, because
   * the scale is handed in there already worked out.
   */
  it('moves a note exactly as far as the pointer that is dragging it', () => {
    build();
    const before = noteElements()[0].getBoundingClientRect();
    const travel = beatWidth() * 2;

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', before.left + 5, before.top + 5)
    );
    document.dispatchEvent(pointer('pointermove', before.left + 5 + travel, before.top + 5));
    settle();

    const after = noteElements()[0].getBoundingClientRect();
    expect(after.left - before.left).toBeCloseTo(travel, 0);
  });

  /**
   * The scale is the grid's width over its *length in beats*, not its width.
   * A four-beat slot makes the two differ by a factor of four, so a drag of
   * one grid-width would reach beat 4 rather than beat 1 if the divisor went.
   */
  it('scales the drag by one beat of the grid, not by the whole grid', () => {
    build();
    const before = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', before.left + 5, before.top + 5)
    );
    document.dispatchEvent(
      pointer('pointermove', before.left + 5 + beatWidth(), before.top + 5)
    );
    settle();

    expect(storedNotes()[0].startBeat).toBe(1);
  });

  /** And the pitch axis, whose divisor is the row height and not the grid. */
  it('raises a note by exactly the rows the pointer crossed', () => {
    build();
    const before = storedNotes()[0].midi;
    const start = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', start.left + 5, start.top + 5)
    );
    document.dispatchEvent(
      pointer('pointermove', start.left + 5, start.top + 5 - 3 * rowHeight())
    );
    settle();

    expect(storedNotes()[0].midi).toBe(before + 3);
  });

  /** Where the browser drew the note is where the model says it is. */
  it('draws a note at its own beat and pitch', () => {
    const id = build();
    progression.setNoteTiming(id, 0, 2, 1);
    settle();

    const rect = noteElements()[0].getBoundingClientRect();
    const [x, y] = clientOf(2, storedNotes()[0].midi);

    expect(rect.left - x).toBeCloseTo(0, 0);
    expect(rect.top - (y - rowHeight() / 2)).toBeCloseTo(0, 0);
    expect(rect.width).toBeCloseTo(beatWidth(), 0);
    // Exactly one row tall, which is what makes the row a note is drawn on
    // and the row the pointer arithmetic reads back the same row.
    expect(rect.height).toBeCloseTo(rowHeight(), 0);
  });

  it('drags the right edge of a note with a real pointer', () => {
    build();
    const before = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-resize').dispatchEvent(
      pointer('pointerdown', before.right - 2, before.top + 5)
    );
    document.dispatchEvent(
      pointer('pointermove', before.right - 2 + beatWidth() * 2, before.top + 5)
    );
    settle();

    expect(storedNotes()[0].lengthBeats).toBe(6);
  });

  it('drags a velocity with a real pointer', () => {
    build();
    const before = storedNotes()[0].velocity;
    const bar = element('.velocity');
    const rect = bar.getBoundingClientRect();

    bar.dispatchEvent(pointer('pointerdown', rect.left + 2, rect.top + 2));
    document.dispatchEvent(
      pointer('pointermove', rect.left + 2, rect.top + 2 + rect.height / 2)
    );
    settle();

    // Half the lane is half the MIDI range, whatever the lane is styled at.
    expect(storedNotes()[0].velocity).toBe(
      Math.round(before - (VELOCITY_MAX - VELOCITY_MIN) / 2)
    );
  });

  /** A right-click is a context menu, not the start of a drag. Three times. */
  it('begins no gesture from a button other than the primary one', () => {
    build();
    const rect = noteElements()[0].getBoundingClientRect();
    const secondary = { button: 2, buttons: 2 };
    spyOn(progression, 'placeNotes');
    spyOn(progression, 'setNoteTiming');
    spyOn(progression, 'setNoteVelocity');

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', rect.left + 5, rect.top + 5, secondary)
    );
    partOf(0, '.note-resize').dispatchEvent(
      pointer('pointerdown', rect.right - 2, rect.top + 5, secondary)
    );
    element('.velocity').dispatchEvent(
      pointer('pointerdown', rect.left + 5, rect.top + 5, secondary)
    );
    document.dispatchEvent(
      pointer('pointermove', rect.left + 5 + beatWidth() * 2, rect.top + 5 - 40)
    );

    expect(progression.placeNotes).not.toHaveBeenCalled();
    expect(progression.setNoteTiming).not.toHaveBeenCalled();
    expect(progression.setNoteVelocity).not.toHaveBeenCalled();
  });

  /**
   * A press on the resize handle is prevented, so the browser neither selects
   * text nor starts a drag of its own - and that also suppresses the focus the
   * press would have given it, which is the whole keyboard path to a length.
   */
  it('focuses the handle it is dragging', () => {
    build();
    const handle = partOf(0, '.note-resize');
    const rect = noteElements()[0].getBoundingClientRect();
    const press = pointer('pointerdown', rect.right - 2, rect.top + 5);

    handle.dispatchEvent(press);

    expect(document.activeElement).toBe(handle);
    expect(press.defaultPrevented).toBeTrue();
  });

  /** Double-clicking empty grid writes a note at that beat and that pitch. */
  it('adds a note where the grid was double-clicked', () => {
    const id = build();
    const before = storedNotes();
    const target = component.topMidi - 4;
    const [x, y] = clientOf(2, target);
    spyOn(progression, 'placeNotes');

    element('.surface').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })
    );

    expect(progression.placeNotes).toHaveBeenCalledWith(id, [
      ...before,
      { midi: target, startBeat: 2, lengthBeats: 0.25, velocity: jasmine.any(Number) }
    ]);
  });

  it('adds the note for real, and it survives a key change', () => {
    build();
    const count = storedNotes().length;
    const [x, y] = clientOf(3, component.topMidi - 6);

    element('.surface').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })
    );
    settle();
    expect(storedNotes().length).toBe(count + 1);

    progression.setKey(9, 'aeolian');
    settle();
    expect(storedNotes().some(note => note.startBeat === 3)).toBeTrue();
  });

  /** Double-clicking a note is not a request for another one on top of it. */
  it('adds nothing when the double-click lands on a note', () => {
    build();
    spyOn(progression, 'placeNotes');
    const rect = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-body').dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 5,
        clientY: rect.top + 5
      })
    );

    expect(progression.placeNotes).not.toHaveBeenCalled();
  });

  it('deletes a note on a right-click, and shows no context menu', () => {
    build();
    const count = storedNotes().length;
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    partOf(0, '.note-body').dispatchEvent(menu);
    settle();

    expect(storedNotes().length).toBe(count - 1);
    expect(menu.defaultPrevented).toBeTrue();
  });

  /**
   * A gesture can outlive the component - navigating away mid-drag - and its
   * listeners are on the document rather than on anything Angular tears down.
   */
  it('drops a gesture the component is destroyed in the middle of', () => {
    build();
    const rect = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', rect.left + 5, rect.top + 5)
    );
    fixture.destroy();

    spyOn(progression, 'placeNotes');
    document.dispatchEvent(pointer('pointermove', rect.left + 500, rect.top + 5));

    expect(progression.placeNotes).not.toHaveBeenCalled();
  });

  /**
   * And lets go of the document when a gesture ends normally. A page nobody is
   * dragging should run no pointer handler at all: an always-attached
   * `pointermove` costs a change-detection pass per pixel of every mouse
   * movement anywhere on the page.
   */
  it('lets go of the document once the gesture is over', () => {
    build();
    const rect = noteElements()[0].getBoundingClientRect();

    partOf(0, '.note-body').dispatchEvent(
      pointer('pointerdown', rect.left + 5, rect.top + 5)
    );
    document.dispatchEvent(pointer('pointerup', rect.left + 5, rect.top + 5));

    spyOn(component, 'onPointerMove');
    document.dispatchEvent(pointer('pointermove', rect.left + 500, rect.top + 5));

    expect(component.onPointerMove).not.toHaveBeenCalled();
  });
});
