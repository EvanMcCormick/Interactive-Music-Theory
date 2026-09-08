import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressionStripComponent } from './progression-strip.component';
import { CardSpan } from './progression-strip-gestures';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import {
  ProgressionDoc,
  ProgressionState,
  createDefaultProgression
} from '../../../../models/progression.model';

/**
 * What the strip renders, and what it dispatches.
 *
 * The two gestures are the risky part, and they are tested in two halves.
 * `progression-strip-gestures.spec.ts` has the arithmetic; this file has the
 * wiring, driven by calling the component's own `begin*` handlers with a
 * geometry the test supplies. Nothing here dispatches a real `PointerEvent`: a
 * simulated drag would assert that Chrome delivers pointer events in the order
 * Chrome delivers them, and would pin card widths, gaps and where the handle
 * sits - layout detail `CLAUDE.md` rules out, and the first thing a style
 * change would break.
 *
 * Two DOM assertions only, for the reason the palette's one is there: a value
 * the component computed but never rendered would pass every expectation about
 * the view model and show the user nothing. Proportional sizing *is* the
 * feature here, so the binding that carries it is checked once.
 *
 * The label tables are not re-tested - `progression-harmony.spec.ts` checks
 * `romanNumeral` and `chordName` directly. What is tested here is that a card
 * reads the *slot's* stored quality and the *progression's* key.
 */
describe('ProgressionStripComponent', () => {
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

  /** Re-runs change detection after a service change, as the real page does. */
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

  /** The one field of a pointer event either gesture reads. */
  function pointerAt(clientX: number): PointerEvent {
    return { clientX, button: 0 } as PointerEvent;
  }

  /** Three cards a hundred pixels wide, laid end to end. */
  const THREE_SPANS: CardSpan[] = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 }
  ];

  /**
   * A document holding one `literal` slot. `replaceDocument` is the only door
   * in M1 through which one can arrive - its own docstring says so, the
   * recogniser that makes them being M3's - which is what makes this branch
   * testable now rather than after it is first reachable by hand.
   */
  function literalDoc(reason: 'unrecognised' | 'user-detached'): ProgressionDoc {
    return {
      ...createDefaultProgression(),
      slots: [
        {
          id: 'literal-slot',
          harmony: { kind: 'literal', reason },
          startBeat: 0,
          lengthBeats: 4,
          notes: [{ midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 }],
          isHandEdited: true
        }
      ]
    };
  }

  describe('what it shows', () => {
    it('shows an empty strip until a chord is added', () => {
      expect(component.cards).toEqual([]);
      expect(fixture.nativeElement.textContent).toContain('Pick a chord');
    });

    // C major: degree 0 is the tonic triad, 4 the dominant, 5 the relative minor.
    it('names each card by its numeral and its chord name', () => {
      build(0, 4, 5);

      expect(component.cards.map(card => card.numeral)).toEqual(['I', 'V', 'vi']);
      expect(component.cards.map(card => card.name)).toEqual(['C Maj', 'G Maj', 'A min']);
    });

    it('keeps the cards in the order the progression holds them', () => {
      const ids = build(3, 0, 4);
      expect(component.cards.map(card => card.id)).toEqual(ids);
    });

    /**
     * The spelling belongs to the progression's key, not the app's - the Task 6
     * bug, one component over. A strip that asked `getNoteName` would print
     * D♯ Maj whenever the fretboard behind it happened to be in a sharp key.
     */
    it('spells a card from the progression key rather than the fretboard', () => {
      const musicTheory = TestBed.inject(MusicTheoryService);
      progression.setKey(3, 'ionian');
      musicTheory.selectKeyAndMode('F#', 'diatonicModes', 'ionian');
      build(0, 3);

      expect(component.cards.map(card => card.name)).toEqual(['Eb Maj', 'Ab Maj']);
    });

    /** Turn the key and every numeral holds while every name moves. */
    it('re-labels itself when the key changes', () => {
      build(0, 4);
      progression.setKey(9, 'aeolian');
      settle();

      expect(component.cards.map(card => card.numeral)).toEqual(['i', 'v']);
      expect(component.cards.map(card => card.name)).toEqual(['A min', 'E min']);
    });

    /**
     * The numeral follows the slot's stored quality, which the service keeps
     * current - so raising a chord to a seventh re-figures the card.
     */
    it('figures a seventh from the slot it is rendering', () => {
      const [id] = build(4);
      progression.setSlotExtent(id, 7);
      settle();

      expect(component.cards[0].numeral).toBe('V7');
      expect(component.cards[0].name).toBe('G7');
    });

    it('marks the selected card and only that one', () => {
      const ids = build(0, 4);
      progression.selectSlot(ids[1]);
      settle();

      expect(component.cards.map(card => card.isSelected)).toEqual([false, true]);
    });

    it('carries each slot length', () => {
      const ids = build(0, 4);
      progression.setSlotLength(ids[0], 2);
      settle();

      expect(component.cards.map(card => card.lengthBeats)).toEqual([2, 4]);
    });

    /**
     * The one sizing assertion. A length computed and never bound would satisfy
     * every expectation above and size nothing on screen, and proportional
     * width is the whole of what this strip shows about time.
     */
    it('sizes each card in proportion to its length', () => {
      const ids = build(0, 4);
      progression.setSlotLength(ids[0], 2);
      settle();

      const cards: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.card'));
      expect(cards.map(card => card.style.flexGrow)).toEqual(['2', '4']);
    });

    /**
     * What a card says aloud. The numeral is dropped for the reason the palette
     * drops it: read out it is a string of letters, and the one fact it carries
     * beyond the position is the quality, already in the spoken name.
     */
    it('labels each card with something that can be read aloud', () => {
      build(4);

      expect(component.cards[0].label).toBe('G major, degree 5, 4 beats');
      expect(component.cards[0].removeLabel).toBe('Remove G major');
      expect(component.cards[0].resizeLabel).toBe('Length of G major, 4 beats');
    });

    it('counts a single beat in the singular', () => {
      const [id] = build(0);
      progression.setSlotLength(id, 1);
      settle();

      expect(component.cards[0].label).toBe('C major, degree 1, 1 beat');
    });
  });

  /**
   * Unlabelled rather than mislabelled.
   *
   * A card prints a Roman numeral only when the slot has a degree *and* the key
   * can name it. Everywhere else it says so, and keeps the chord.
   */
  describe('a chord the key cannot name', () => {
    it('gives a literal slot no Roman numeral', () => {
      progression.replaceDocument(literalDoc('unrecognised'));
      settle();

      expect(component.cards.length).toBe(1);
      expect(component.cards[0].isUnlabelled).toBeTrue();
      expect(component.cards[0].numeral).toBe('—');
      expect(component.cards[0].name).toBe('Unlabelled');
    });

    it('says why an unrecognised slot has no numeral', () => {
      progression.replaceDocument(literalDoc('unrecognised'));
      settle();

      expect(component.cards[0].label).toBe(
        'unlabelled chord, its notes match no chord in this key, 4 beats'
      );
    });

    /** The other branch of the union, and a different story about the same card. */
    it('says why a detached slot has no numeral', () => {
      progression.replaceDocument(literalDoc('user-detached'));
      settle();

      expect(component.cards[0].label).toBe(
        'unlabelled chord, detached from the key by hand, 4 beats'
      );
    });

    /**
     * Built in C major, then moved to a pentatonic key. The slots keep their
     * notes, but the stored quality came from a scale no longer selected, so
     * any numeral would be stale. The strip refuses on the gate the palette
     * refuses on, so the two halves of the screen agree.
     */
    it('refuses to label a chord in a key that can build none', () => {
      build(0, 4);
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(component.cards.map(card => card.isUnlabelled)).toEqual([true, true]);
      expect(component.cards[0].label).toContain('this key cannot name it');
    });

    it('labels them again when a heptatonic key comes back', () => {
      build(0, 4);
      progression.setKey(0, 'majorPentatonic');
      settle();
      progression.setKey(0, 'ionian');
      settle();

      expect(component.cards.map(card => card.numeral)).toEqual(['I', 'V']);
    });

    /** Explained once below the strip; a card has no room for a sentence. */
    it('explains the missing numerals once, on screen', () => {
      progression.replaceDocument(literalDoc('unrecognised'));
      settle();

      expect(component.unlabelledHint).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain(component.unlabelledHint ?? '');
    });

    it('says nothing when every card has a numeral', () => {
      build(0);
      expect(component.unlabelledHint).toBeNull();
    });

    /** Still removable and still resizable: it is a chord, only an unnamed one. */
    it('leaves an unlabelled card its controls', () => {
      progression.replaceDocument(literalDoc('unrecognised'));
      settle();

      expect(component.cards[0].removeLabel).toBe('Remove unlabelled chord');
      expect(component.cards[0].resizeLabel).toBe('Length of unlabelled chord, 4 beats');
    });
  });

  describe('clicking a card', () => {
    it('selects the chord that was clicked', () => {
      const ids = build(0, 4);
      spyOn(progression, 'selectSlot');

      component.select(component.cards[1]);

      expect(progression.selectSlot).toHaveBeenCalledWith(ids[1]);
    });

    // The same click against the real service, which a spy cannot see through.
    it('puts the selection on that slot', () => {
      const ids = build(0, 4);
      component.select(component.cards[0]);
      settle();

      expect(currentState().selectedSlotId).toBe(ids[0]);
      expect(component.cards.map(card => card.isSelected)).toEqual([true, false]);
    });
  });

  describe('the delete control', () => {
    it('removes the chord it belongs to', () => {
      const ids = build(0, 4, 5);
      spyOn(progression, 'removeSlot');

      component.remove(component.cards[1]);

      expect(progression.removeSlot).toHaveBeenCalledWith(ids[1]);
    });

    it('closes the gap it leaves', () => {
      build(0, 4, 5);
      component.remove(component.cards[1]);
      settle();

      expect(component.cards.map(card => card.numeral)).toEqual(['I', 'vi']);
      expect(currentState().doc.slots.map(slot => slot.startBeat)).toEqual([0, 4]);
    });
  });

  describe('dragging the right edge', () => {
    it('sets the slot length the drag reaches', () => {
      const [id] = build(0);
      spyOn(progression, 'setSlotLength');

      // A four-beat card forty pixels to the beat, dragged two beats wider.
      component.beginResize(id, 100, 4, 40);
      component.onPointerMove(pointerAt(180));

      expect(progression.setSlotLength).toHaveBeenCalledWith(id, 6);
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

  /**
   * The `takeUntil(destroy$)` guardrail, asserted rather than assumed: a
   * subscription that outlived the component would keep rebuilding a view
   * nothing renders, and the project rules single this out.
   */
  it('stops listening once destroyed', () => {
    build(0);
    const before = component.cards.map(card => card.numeral);

    fixture.destroy();
    progression.appendSlot(4);

    expect(component.cards.map(card => card.numeral)).toEqual(before);
  });
});
