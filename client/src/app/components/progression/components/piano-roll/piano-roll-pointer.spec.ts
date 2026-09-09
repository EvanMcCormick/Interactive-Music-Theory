import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PianoRollComponent } from './piano-roll.component';
import {
  MIN_NOTE_BEATS,
  VELOCITY_MAX,
  VELOCITY_MIN
} from '../../../../models/progression-normalize';
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

  /**
   * A key the browser would send, not a call to the handler behind it.
   *
   * Every keyboard test in this component used to call `nudgePitch` and friends
   * directly, which is below the seam the eight `(keydown.*)` bindings are: with
   * that coverage alone, swapping Up and Down on the note body, flipping the
   * sign on either resize arrow and deleting the Delete binding all survive, and
   * so does `preventDefault`, because a direct call passes `undefined` for the
   * event. That is the strip's gap on the other axis, and this closes it.
   */
  function key(name: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  }

  function element(selector: string): HTMLElement {
    const found = fixture.nativeElement.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`no ${selector} on the roll`);
    return found;
  }

  function velocityBars(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.velocity'));
  }

  /**
   * The element the browser would actually deliver a press at this point to.
   *
   * The whole point of the velocity fix, so the test has to go through the same
   * hit test a pointer does rather than name an element by selector.
   * `querySelector('.velocity')` answers the *first* bar in the DOM whatever is
   * drawn on top of it, which is how three bars stacked on one rectangle passed
   * a test for months while only the last of them could be pressed.
   */
  function topmostAt(clientX: number, clientY: number, selector: string): HTMLElement {
    const hit = document
      .elementsFromPoint(clientX, clientY)
      .find(candidate => candidate.matches(selector));
    if (!(hit instanceof HTMLElement)) {
      throw new Error(`nothing matching ${selector} at ${clientX},${clientY}`);
    }
    return hit;
  }

  /**
   * The middle of an element, which is where a user aiming at it would press.
   *
   * Scrolled into view first, and that is about the test runner rather than the
   * roll: `elementsFromPoint` answers only for points that are on screen, and
   * the velocity lane sits below the fold of Karma's window. The rect is read
   * back afterwards, so the coordinate is whatever the scroll left it at.
   */
  function centreOf(target: HTMLElement): [number, number] {
    target.scrollIntoView({ block: 'center' });
    const rect = target.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
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

  /**
   * The bug the lane's columns exist to prevent, asserted the only way it can
   * be seen: through the hit test.
   *
   * Every note of a generated chord starts at beat 0 and lasts the whole slot,
   * so bars drawn at their note's own beat and length occupied *one* rectangle -
   * three elements, identical rects, painting over each other in DOM order. The
   * lane showed the silhouette of whichever note was loudest, and a press
   * anywhere in it went to the last note in the list. Notes 0 and 1 could not be
   * edited by a mouse at all, and a user aiming at either edited note 2 with no
   * indication that anything had gone elsewhere.
   */
  it('gives every note a velocity bar the pointer can tell apart', () => {
    build();
    const bars = velocityBars();
    expect(bars.length).toBe(storedNotes().length);
    expect(bars.length).toBeGreaterThan(1);

    for (const bar of bars) {
      const [x, y] = centreOf(bar);
      expect(topmostAt(x, y, '.velocity')).toBe(bar);
    }
  });

  /**
   * And the press lands on the note the pointer is over. The element is the one
   * the *hit test* answered, not one this test picked out by selector - naming
   * it is exactly what let the bug through.
   */
  it('drags the velocity of the note under the pointer, and no other', () => {
    build();
    const before = storedNotes().map(note => note.velocity);
    const [x, y] = centreOf(velocityBars()[0]);
    const bar = topmostAt(x, y, '.velocity');
    const rect = bar.getBoundingClientRect();

    bar.dispatchEvent(pointer('pointerdown', x, y));
    document.dispatchEvent(pointer('pointermove', x, y + rect.height / 2));
    settle();

    // Half the lane is half the MIDI range, whatever the lane is styled at.
    expect(storedNotes()[0].velocity).toBe(
      Math.round(before[0] - (VELOCITY_MAX - VELOCITY_MIN) / 2)
    );
    expect(storedNotes().slice(1).map(note => note.velocity)).toEqual(before.slice(1));
  });

  /** The same, aimed at the last note, so neither end is a special case. */
  it('drags the last note velocity when that is the one aimed at', () => {
    build();
    const before = storedNotes().map(note => note.velocity);
    const last = before.length - 1;
    const [x, y] = centreOf(velocityBars()[last]);
    const bar = topmostAt(x, y, '.velocity');

    bar.dispatchEvent(pointer('pointerdown', x, y));
    document.dispatchEvent(pointer('pointermove', x, y - bar.getBoundingClientRect().height / 2));
    settle();

    expect(storedNotes()[last].velocity).toBeGreaterThan(before[last]);
    expect(storedNotes().slice(0, last).map(note => note.velocity)).toEqual(
      before.slice(0, last)
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

  /**
   * A click names a cell, and the note it makes has to contain the point that
   * asked for it - on both axes. The beat used to be `snapBeat`, which rounds to
   * the nearest line: at the default 1/16 grid a cell is a quarter of a beat, so
   * a click past the middle of one created a note starting to the *right* of the
   * pointer, on a cell the click was never in, while the pitch came from the row
   * it was. The coordinate here is deliberately three quarters of the way into
   * the cell, which is where the two rules disagree.
   */
  it('adds the note in the cell that was clicked, not the nearer line', () => {
    const id = build();
    const before = storedNotes();
    const target = component.topMidi - 4;
    const [x, y] = clientOf(2, target);
    spyOn(progression, 'placeNotes');

    element('.surface').dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: x + beatWidth() * component.gridStep * 0.75,
        clientY: y
      })
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

  // ---------------------------------------------------------------------------
  // The keyboard bindings, driven by keys rather than by the methods behind them
  // ---------------------------------------------------------------------------

  /**
   * Eight `(keydown.*)` bindings, none of which had a test that pressed a key.
   * Every keyboard test called `component.nudgePitch(...)` and friends, which is
   * below the seam: with only that, Up and Down could be swapped on the note
   * body, either resize arrow could have its sign flipped, and Delete or
   * Backspace could be deleted outright, and all of it would pass. So could
   * dropping `event?.preventDefault()`, because a direct call passes no event.
   *
   * The strip shipped that gap on the pointer axis and this file exists because
   * of it. This is the same gap on the other axis.
   */
  describe('the keyboard bindings', () => {
    it('raises the pitch on Up and lowers it on Down', () => {
      build();
      const before = storedNotes()[0].midi;
      const body = partOf(0, '.note-body');

      const up = key('ArrowUp');
      body.dispatchEvent(up);
      settle();
      expect(storedNotes()[0].midi).toBe(before + 1);
      // An arrow key on a focused control inside a scrolling grid scrolls it.
      expect(up.defaultPrevented).toBeTrue();

      const down = key('ArrowDown');
      partOf(0, '.note-body').dispatchEvent(down);
      settle();
      expect(storedNotes()[0].midi).toBe(before);
      expect(down.defaultPrevented).toBeTrue();
    });

    it('moves the note one grid cell right on Right and left on Left', () => {
      build();
      component.setDivision(2);
      settle();

      const right = key('ArrowRight');
      partOf(0, '.note-body').dispatchEvent(right);
      settle();
      expect(storedNotes()[0].startBeat).toBe(0.5);
      expect(right.defaultPrevented).toBeTrue();

      const left = key('ArrowLeft');
      partOf(0, '.note-body').dispatchEvent(left);
      settle();
      expect(storedNotes()[0].startBeat).toBe(0);
      expect(left.defaultPrevented).toBeTrue();
    });

    /** The pitch keys and the time keys are different keys on the same control. */
    it('leaves the beat alone on Up and the pitch alone on Right', () => {
      build();
      const before = storedNotes()[0];

      partOf(0, '.note-body').dispatchEvent(key('ArrowUp'));
      settle();
      expect(storedNotes()[0].startBeat).toBe(before.startBeat);

      partOf(0, '.note-body').dispatchEvent(key('ArrowRight'));
      settle();
      expect(storedNotes()[0].midi).toBe(before.midi + 1);
    });

    it('lengthens the note on Right of the handle and shortens it on Left', () => {
      build();
      component.setDivision(2);
      settle();
      const before = storedNotes()[0].lengthBeats;

      const longer = key('ArrowRight');
      partOf(0, '.note-resize').dispatchEvent(longer);
      settle();
      expect(storedNotes()[0].lengthBeats).toBe(before + 0.5);
      expect(longer.defaultPrevented).toBeTrue();

      const shorter = key('ArrowLeft');
      partOf(0, '.note-resize').dispatchEvent(shorter);
      settle();
      expect(storedNotes()[0].lengthBeats).toBe(before);
      expect(shorter.defaultPrevented).toBeTrue();
    });

    /** The handle's Right must not also move the note, which is the body's key. */
    it('leaves the note where it is when its length is stepped', () => {
      build();
      const before = storedNotes()[0].startBeat;

      partOf(0, '.note-resize').dispatchEvent(key('ArrowRight'));
      settle();

      expect(storedNotes()[0].startBeat).toBe(before);
    });

    it('raises the velocity on Up of the bar and lowers it on Down', () => {
      build();
      const before = storedNotes()[0].velocity;
      const bars = velocityBars();

      const louder = key('ArrowUp');
      bars[0].dispatchEvent(louder);
      settle();
      expect(storedNotes()[0].velocity).toBeGreaterThan(before);
      expect(louder.defaultPrevented).toBeTrue();

      const quieter = key('ArrowDown');
      velocityBars()[0].dispatchEvent(quieter);
      settle();
      expect(storedNotes()[0].velocity).toBe(before);
      expect(quieter.defaultPrevented).toBeTrue();
    });

    /** A velocity key is a velocity key: it says nothing about pitch. */
    it('leaves the pitch alone when the velocity is stepped', () => {
      build();
      const before = storedNotes()[0].midi;

      velocityBars()[0].dispatchEvent(key('ArrowUp'));
      settle();

      expect(storedNotes()[0].midi).toBe(before);
    });

    it('removes the note on Delete', () => {
      build();
      const before = storedNotes().map(note => note.midi);

      partOf(0, '.note-body').dispatchEvent(key('Delete'));
      settle();

      expect(storedNotes().map(note => note.midi)).toEqual(before.slice(1));
    });

    /** Backspace is the same gesture on the keyboards that do not have Delete. */
    it('removes the note on Backspace', () => {
      build();
      const before = storedNotes().map(note => note.midi);

      partOf(0, '.note-body').dispatchEvent(key('Backspace'));
      settle();

      expect(storedNotes().map(note => note.midi)).toEqual(before.slice(1));
    });

    /** Backspace on a focused control is the browser's Back, historically. */
    it('prevents the browser default on a delete key', () => {
      build();
      const back = key('Backspace');

      partOf(0, '.note-body').dispatchEvent(back);

      expect(back.defaultPrevented).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // Creating a note, and where the focus goes
  // ---------------------------------------------------------------------------

  describe('the keyboard path to a note', () => {
    /**
     * WCAG 2.1.1. Everything else about a note is reachable from the keyboard -
     * moving it, resizing it, re-voicing it, its velocity, deleting it - and
     * creating one was not: `addNote` was bound to `(dblclick)` on a bare
     * `<div>` with no role, no `tabindex` and no key handler.
     */
    it('offers a control the tab order reaches', () => {
      build();
      const add = element('.add');

      expect(add.tagName).toBe('BUTTON');
      expect((add as HTMLButtonElement).disabled).toBeFalse();
    });

    it('adds a note when that control is clicked', () => {
      build();
      const count = storedNotes().length;

      element('.add').click();
      settle();

      expect(storedNotes().length).toBe(count + 1);
    });

    /**
     * And leaves the focus on what it made, so the arrow keys act on it. A
     * control that adds a note and drops the focus back to `<body>` has handed
     * a keyboard user a note they cannot reach.
     */
    it('puts the focus on the note it just made', () => {
      build();
      element('.add').click();
      settle();

      const bodies = Array.from<HTMLElement>(
        fixture.nativeElement.querySelectorAll('.note-body')
      );
      expect(document.activeElement).toBe(bodies[bodies.length - 1]);
    });

    /**
     * Deleting the note under the focus has to say where the focus went.
     * `trackByIndex` means the survivors shuffle down into the index that was
     * deleted, so leaving it to the browser either drops the focus to `<body>`
     * or hands it silently to a different note.
     */
    it('moves the focus to the note that takes the place of a deleted one', () => {
      build();
      const first = partOf(0, '.note-body');
      first.focus();

      first.dispatchEvent(key('Delete'));
      settle();

      expect(document.activeElement).toBe(partOf(0, '.note-body'));
    });

    it('moves the focus back one when the last note in the list goes', () => {
      build();
      const last = storedNotes().length - 1;
      const body = partOf(last, '.note-body');
      body.focus();

      body.dispatchEvent(key('Delete'));
      settle();

      expect(document.activeElement).toBe(partOf(last - 1, '.note-body'));
    });

    /** And to the one control that can undo it when there is nothing left. */
    it('moves the focus to Add note when the last note is deleted', () => {
      build();
      while (storedNotes().length > 1) {
        component.deleteNote(component.notes[0]);
        settle();
      }

      const body = partOf(0, '.note-body');
      body.focus();
      body.dispatchEvent(key('Delete'));
      settle();

      expect(storedNotes()).toEqual([]);
      expect(document.activeElement).toBe(element('.add'));
    });

    /**
     * But only when the focus was on the note that went. A right-click deletes
     * too, and a right-click on one note while another is focused must not move
     * the focus off the note the user is working on.
     */
    it('leaves the focus alone when a note it was not on is deleted', () => {
      build();
      const first = partOf(0, '.note-body');
      first.focus();

      noteElements()[1].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
      settle();

      expect(document.activeElement).toBe(partOf(0, '.note-body'));
    });
  });

  // ---------------------------------------------------------------------------
  // The layout the pointer arithmetic is measured against
  // ---------------------------------------------------------------------------

  /**
   * The grid carries no border and no padding, and until now that was enforced
   * by a comment. The nearest test measured a note at beat 2 of a four-beat grid
   * with a 0.5px tolerance - which is the midpoint, where a uniform 1px border
   * offsets the note by exactly as much as it shrinks the measured beat width,
   * and the error is zero. The two ends are where it shows.
   *
   * A generated chord fills its slot, so its notes span the whole grid: the
   * first beat starts at the grid's left edge and the last ends at its right,
   * exactly, or the notes are drawn somewhere other than the beats they claim
   * and every gesture acts on the wrong one.
   */
  it('draws a slot-length note across the exact width of the grid', () => {
    build();
    const grid = element('.grid').getBoundingClientRect();
    const note = noteElements()[0].getBoundingClientRect();

    expect(note.left).toBe(grid.left);
    expect(note.right).toBe(grid.right);
  });

  /**
   * The shortest note the model stores is `MIN_NOTE_BEATS`, which at the roll's
   * scale is narrower than the note's own resize handle. The handle is a fixed
   * width and does not shrink, so the note's floor has to leave room for both -
   * otherwise the handle takes the whole note, `.note-body` collapses and the
   * note cannot be moved, focused or reached by any key at all.
   *
   * Asserted through the hit test rather than by measuring a width, because a
   * body a fraction of a pixel wide has a width greater than zero and is still
   * nothing a pointer can land on. The body is the leftmost part of a note and
   * the handle the rightmost, so both edges have to answer for themselves.
   */
  it('leaves a note at the shortest storable length something to drag', () => {
    const id = build();
    progression.setNoteTiming(id, 0, 0, MIN_NOTE_BEATS);
    settle();

    const note = noteElements()[0];
    note.scrollIntoView({ block: 'center' });
    const rect = note.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    const parts = '.note-body, .note-resize';

    expect(topmostAt(rect.left + 1, middle, parts)).toBe(partOf(0, '.note-body'));
    expect(topmostAt(rect.right - 1, middle, parts)).toBe(partOf(0, '.note-resize'));
  });
});
