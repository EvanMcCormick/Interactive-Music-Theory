import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressionStripComponent } from './progression-strip.component';
import { CardSpan } from './progression-strip-gestures';
import { ProgressionService } from '../../../../services/progression.service';
import { ProgressionState } from '../../../../models/progression.model';

/**
 * The strip's two pointer gestures: the wiring, and the adapter under it.
 *
 * Two layers, tested two ways. The `begin*` handlers take a geometry the caller
 * supplies, so the wiring - which service call, with which arguments, and when
 * - is driven straight through them. Everything *above* that seam is the
 * adapter: which mouse button was pressed, which element gets measured, what is
 * listened to and what is let go of. None of it is arithmetic and none of it
 * can be reached by calling `beginResize`, so the probes below dispatch real
 * `PointerEvent`s at a rendered strip.
 *
 * That does not pin any layout. Every coordinate here comes from a live
 * `getBoundingClientRect()` and every assertion is about what was dispatched to
 * `ProgressionService`; there is not a hard-coded width or offset in the file,
 * so the stylesheet can move and these still hold. The earlier claim that a
 * real drag would have to assert card widths and handle positions was simply
 * wrong, and it left the whole `listen()`/`unlisten` mechanism untested - it
 * could have been deleted with the suite still green.
 */
describe('ProgressionStripComponent pointer gestures', () => {
  let fixture: ComponentFixture<ProgressionStripComponent>;
  let component: ProgressionStripComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressionStripComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressionStripComponent);
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

  /** Appends chords on these degrees and renders, as clicking the palette would. */
  function build(...degrees: number[]): string[] {
    for (const degree of degrees) progression.appendSlot(degree);
    settle();
    return currentState().doc.slots.map(slot => slot.id);
  }

  /** The one field of a pointer event either gesture reads, for the seam tests. */
  function pointerAt(clientX: number): PointerEvent {
    return { clientX, button: 0 } as PointerEvent;
  }

  /** Three cards a hundred pixels wide, laid end to end. */
  const THREE_SPANS: CardSpan[] = [{ right: 100 }, { right: 200 }, { right: 300 }];

  // ---------------------------------------------------------------------------
  // The wiring: a geometry the test supplies, and what the service is told.
  // ---------------------------------------------------------------------------

  describe('dragging the right edge', () => {
    it('sets the slot length the drag reaches', () => {
      const [id] = build(0);
      spyOn(progression, 'setSlotLength');

      // A four-beat card forty pixels to the beat, dragged two beats wider.
      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));

      expect(progression.setSlotLength).toHaveBeenCalledWith(id, 6, { coalesce: false });
    });

    /**
     * One drag is one undo step. The first length a drag commits opens an entry
     * and every later one folds into it, which is what stops a drag - or a
     * pointer shaking on a beat boundary - pushing the rest of the history off
     * the hundred-deep stack. See `ProgressionService.commit`.
     */
    it('folds every later length of the same drag into the first', () => {
      const [id] = build(0);
      spyOn(progression, 'setSlotLength');

      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerMove(pointerAt(220));
      component.onPointerMove(pointerAt(260));

      expect((progression.setSlotLength as jasmine.Spy).calls.allArgs()).toEqual([
        [id, 6, { coalesce: false }],
        [id, 7, { coalesce: true }],
        [id, 8, { coalesce: true }]
      ]);
    });

    it('leaves one undo step behind, and it goes back to before the drag', () => {
      const [id] = build(0);

      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerMove(pointerAt(260));
      component.onPointerUp(pointerAt(260));
      settle();
      expect(component.cards[0].lengthBeats).toBe(8);

      progression.undo();
      settle();
      expect(component.cards[0].lengthBeats).toBe(4);

      // And the step under it is the one that added the chord, not a length the
      // drag passed through on its way.
      progression.undo();
      settle();
      expect(component.cards).toEqual([]);
    });

    /** Two drags are two steps: there is nothing between them but the release. */
    it('keeps a second drag on the same card a step of its own', () => {
      const [id] = build(0);

      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerUp(pointerAt(180));

      component.beginResize(id, 100, 6, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerUp(pointerAt(180));
      settle();
      expect(component.cards[0].lengthBeats).toBe(8);

      progression.undo();
      settle();

      expect(component.cards[0].lengthBeats).toBe(6);
    });

    it('resizes the slot for real, and re-flows what follows it', () => {
      const ids = build(0, 4);
      component.beginResize(ids[0], 100, 4, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerUp(pointerAt(180));
      settle();

      expect(component.cards.map(card => card.lengthBeats)).toEqual([6, 4]);
      expect(currentState().doc.slots.map(slot => slot.startBeat)).toEqual([0, 6]);
    });

    /** Absolute, not incremental: every move is measured from where it started. */
    it('measures each move from where the drag began', () => {
      const [id] = build(0);
      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));
      component.onPointerMove(pointerAt(140));
      component.onPointerUp(pointerAt(140));
      settle();

      expect(component.cards[0].lengthBeats).toBe(5);
    });

    /**
     * A pointer resting on the half-beat and shaking by a pixel used to cross
     * the boundary over and over, each crossing a real commit.
     */
    it('holds the length steady while the pointer sits on a boundary', () => {
      const [id] = build(0);
      spyOn(progression, 'setSlotLength');

      component.beginResize(id, 100, 4, 40);
      // 40px is one beat, so 120 is dead on the half-beat between 4 and 5.
      component.onPointerMove(pointerAt(120));
      component.onPointerMove(pointerAt(121));
      component.onPointerMove(pointerAt(119));

      expect(progression.setSlotLength).not.toHaveBeenCalled();
    });

    it('stops resizing once the pointer is released', () => {
      const [id] = build(0);
      component.beginResize(id, 100, 4, 40);
      component.onPointerUp(pointerAt(100));

      spyOn(progression, 'setSlotLength');
      component.onPointerMove(pointerAt(300));

      expect(progression.setSlotLength).not.toHaveBeenCalled();
    });

    /** The arrow keys are the same edit for someone who is not holding a mouse. */
    it('nudges the length by one beat from the keyboard', () => {
      const [id] = build(0);
      spyOn(progression, 'setSlotLength');

      component.nudgeLength(component.cards[0], 1);
      expect(progression.setSlotLength).toHaveBeenCalledWith(id, 5);

      component.nudgeLength(component.cards[0], -1);
      expect(progression.setSlotLength).toHaveBeenCalledWith(id, 3);
    });
  });

  describe('dragging a card to reorder it', () => {
    it('moves the slot to the card it was dropped on', () => {
      const ids = build(0, 4, 5);
      spyOn(progression, 'moveSlot');

      component.beginReorder(ids[0], 50, THREE_SPANS);
      component.onPointerMove(pointerAt(250));
      component.onPointerUp(pointerAt(250));

      expect(progression.moveSlot).toHaveBeenCalledWith(ids[0], 2);
    });

    it('reorders the progression for real', () => {
      const ids = build(0, 4, 5);

      component.beginReorder(ids[0], 50, THREE_SPANS);
      component.onPointerMove(pointerAt(250));
      component.onPointerUp(pointerAt(250));
      settle();

      expect(component.cards.map(card => card.numeral)).toEqual(['V', 'vi', 'I']);
    });

    /**
     * A click is a press and a release too. Below the threshold the gesture was
     * never a drag, so it must reorder nothing - the click handler selects, and
     * that is all that should happen.
     */
    it('moves nothing when the pointer barely moved', () => {
      const ids = build(0, 4, 5);
      spyOn(progression, 'moveSlot');

      component.beginReorder(ids[0], 50, THREE_SPANS);
      component.onPointerMove(pointerAt(52));
      component.onPointerUp(pointerAt(52));

      expect(progression.moveSlot).not.toHaveBeenCalled();
    });

    it('leaves the order alone when a drag comes back to where it started', () => {
      const ids = build(0, 4, 5);

      component.beginReorder(ids[0], 50, THREE_SPANS);
      component.onPointerMove(pointerAt(250));
      component.onPointerUp(pointerAt(50));
      settle();

      expect(component.cards.map(card => card.id)).toEqual(ids);
    });

    /** The card being dragged is marked so the user can see what they have hold of. */
    it('marks the dragged card while the drag is under way, and not after', () => {
      const ids = build(0, 4, 5);

      component.beginReorder(ids[0], 50, THREE_SPANS);
      expect(component.draggingId).toBeNull();

      component.onPointerMove(pointerAt(250));
      expect(component.draggingId).toBe(ids[0]);

      component.onPointerUp(pointerAt(250));
      expect(component.draggingId).toBeNull();
    });

    it('dispatches nothing for pointer movement with no gesture under way', () => {
      build(0, 4);
      spyOn(progression, 'moveSlot');
      spyOn(progression, 'setSlotLength');

      component.onPointerMove(pointerAt(250));
      component.onPointerUp(pointerAt(250));

      expect(progression.moveSlot).not.toHaveBeenCalled();
      expect(progression.setSlotLength).not.toHaveBeenCalled();
    });

    /** One gesture at a time: starting a resize abandons a reorder in progress. */
    it('abandons a reorder when a resize starts', () => {
      const ids = build(0, 4, 5);
      component.beginReorder(ids[0], 50, THREE_SPANS);
      component.beginResize(ids[0], 100, 4, 40);

      spyOn(progression, 'moveSlot');
      component.onPointerMove(pointerAt(180));
      component.onPointerUp(pointerAt(180));

      expect(progression.moveSlot).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // The adapter: real events on a rendered strip, coordinates from live rects.
  // ---------------------------------------------------------------------------

  describe('a real pointer on a rendered strip', () => {
    function event(type: string, clientX: number, init: PointerEventInit = {}): PointerEvent {
      return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, ...init });
    }

    function cardElements(): HTMLElement[] {
      return Array.from(fixture.nativeElement.querySelectorAll('.card'));
    }

    function rects(): DOMRect[] {
      return cardElements().map(card => card.getBoundingClientRect());
    }

    function partOf(index: number, selector: string): HTMLElement {
      const part = cardElements()[index].querySelector(selector);
      if (!(part instanceof HTMLElement)) throw new Error(`no ${selector} on card ${index}`);
      return part;
    }

    /**
     * The scale a resize is measured in, taken from the card rather than
     * assumed: the whole point of the absolute layout is that this is a
     * constant the drag can be scaled by.
     */
    function beatWidthOf(index: number): number {
      return rects()[index].width / component.cards[index].lengthBeats;
    }

    /**
     * The bug the layout was changed for: under the old proportional row,
     * growing one card shrank the others, so the edge moved a fraction of the
     * distance the pointer did - 39px for the first 87px of a drag, 174px for
     * 698px. Nothing about that can be seen from `beginResize`, because the
     * scale is handed in there already computed.
     */
    it('moves the card edge exactly as far as the pointer that is dragging it', () => {
      build(0);
      const before = rects()[0];
      const beat = beatWidthOf(0);
      const travel = beat * 4;

      partOf(0, '.resize').dispatchEvent(event('pointerdown', before.right - 4));
      document.dispatchEvent(event('pointermove', before.right - 4 + travel));
      settle();

      const after = rects()[0];
      expect(after.right - before.right).toBeCloseTo(travel, 0);
    });

    /**
     * The scale is the card's width over its *length*, not its width. A card is
     * four beats wide by default, so the two differ by a factor of four and a
     * drag of four beat-widths reaches eight beats rather than five.
     */
    it('scales the drag by one beat of the card, not by the whole card', () => {
      const [id] = build(0);
      const before = rects()[0];
      const beat = beatWidthOf(0);
      spyOn(progression, 'setSlotLength');

      partOf(0, '.resize').dispatchEvent(event('pointerdown', before.right - 4));
      document.dispatchEvent(event('pointermove', before.right - 4 + beat * 4));

      expect(progression.setSlotLength).toHaveBeenCalledWith(id, 8, { coalesce: false });
    });

    /** The handle it measures is the one the press landed in, after a reorder. */
    it('measures the card that was pressed once the strip has been reordered', () => {
      const ids = build(0, 4);
      progression.setSlotLength(ids[1], 2);
      progression.moveSlot(ids[1], 0);
      settle();
      expect(component.cards.map(card => card.id)).toEqual([ids[1], ids[0]]);

      const before = rects()[0];
      const beat = beatWidthOf(0);
      spyOn(progression, 'setSlotLength');

      partOf(0, '.resize').dispatchEvent(event('pointerdown', before.right - 4));
      document.dispatchEvent(event('pointermove', before.right - 4 + beat * 3));

      expect(progression.setSlotLength).toHaveBeenCalledWith(ids[1], 5, { coalesce: false });
    });

    /**
     * A press on the handle is prevented, so the browser does not select text
     * or start a drag of its own - and that also suppresses the focus the press
     * would have given it. The arrow keys are the whole keyboard path to a
     * length, so a mouse user would have had to Tab back to a control they were
     * already holding.
     */
    it('focuses the handle it is dragging', () => {
      build(0);
      const handle = partOf(0, '.resize');
      const press = event('pointerdown', rects()[0].right - 4);

      handle.dispatchEvent(press);

      expect(document.activeElement).toBe(handle);
      expect(press.defaultPrevented).toBeTrue();
    });

    it('drags a card to a new position with a real pointer', () => {
      const ids = build(0, 4, 5);
      const spans = rects();
      spyOn(progression, 'moveSlot');

      partOf(0, '.body').dispatchEvent(event('pointerdown', spans[0].left + 5));
      document.dispatchEvent(event('pointermove', spans[2].right - 5));
      document.dispatchEvent(event('pointerup', spans[2].right - 5));

      expect(progression.moveSlot).toHaveBeenCalledWith(ids[0], 2);
    });

    /** A right-click is a context menu, not the start of a drag. */
    it('begins no drag from a button other than the primary one', () => {
      build(0, 4, 5);
      const spans = rects();
      spyOn(progression, 'moveSlot');

      partOf(0, '.body').dispatchEvent(
        event('pointerdown', spans[0].left + 5, { button: 2, buttons: 2 })
      );
      document.dispatchEvent(event('pointermove', spans[2].right - 5));
      document.dispatchEvent(event('pointerup', spans[2].right - 5));

      expect(progression.moveSlot).not.toHaveBeenCalled();
    });

    /**
     * A gesture can outlive the component - navigating away mid-drag - and its
     * listeners are on the document rather than on anything Angular tears down.
     */
    it('drops a gesture the component is destroyed in the middle of', () => {
      build(0, 4, 5);
      const spans = rects();

      partOf(0, '.body').dispatchEvent(event('pointerdown', spans[0].left + 5));
      fixture.destroy();

      spyOn(progression, 'moveSlot');
      document.dispatchEvent(event('pointermove', spans[2].right - 5));
      document.dispatchEvent(event('pointerup', spans[2].right - 5));

      expect(progression.moveSlot).not.toHaveBeenCalled();
    });

    /**
     * And lets go of the document when a gesture ends normally. A page nobody
     * is dragging should run no pointer handler at all: an always-attached
     * `pointermove` costs a change-detection pass per pixel of every mouse
     * movement anywhere on the page.
     */
    it('lets go of the document once the gesture is over', () => {
      build(0, 4);
      const spans = rects();

      partOf(0, '.body').dispatchEvent(event('pointerdown', spans[0].left + 5));
      document.dispatchEvent(event('pointerup', spans[0].left + 5));

      spyOn(component, 'onPointerMove');
      document.dispatchEvent(event('pointermove', spans[1].right - 5));

      expect(component.onPointerMove).not.toHaveBeenCalled();
    });

    /**
     * `trackBy` is the slot id, so a reorder moves a card's own element rather
     * than repainting the first one with the second card's words. Marked in the
     * DOM and looked for afterwards, because element identity is the only thing
     * that tells the two apart.
     */
    it('carries the pressed card its own element when the strip is reordered', () => {
      const ids = build(0, 4, 5);
      cardElements()[0].dataset['probe'] = 'first';

      progression.moveSlot(ids[0], 2);
      settle();

      const marked = cardElements().map(card => card.dataset['probe']);
      expect(marked).toEqual([undefined, undefined, 'first']);
      expect(component.cards.map(card => card.numeral)).toEqual(['V', 'vi', 'I']);
    });
  });
});
