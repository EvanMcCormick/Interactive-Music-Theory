import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressionStripComponent } from './progression-strip.component';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import {
  ChordSlot,
  ProgressionDoc,
  ProgressionState,
  createDefaultProgression,
  createOwnership
} from '../../../../models/progression.model';

/**
 * What the strip renders.
 *
 * The gestures are next door in `progression-strip-pointer.spec.ts`, which
 * drives them with real `PointerEvent`s, and the arithmetic underneath them is
 * in `progression-strip-gestures.spec.ts`. This file is the view model: what a
 * card is called, what it says aloud, and what it refuses to say.
 *
 * Two DOM assertions only, for the reason the palette's one is there: a value
 * the component computed but never rendered would pass every expectation about
 * the view model and show the user nothing. Sizing by length *is* the feature
 * here, so the binding that carries it is checked once, and once through the
 * geometry it produces.
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

  function cardElements(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.card'));
  }

  /** A whole document, for the states no M1 setter can reach by hand. */
  function docOf(...slots: ChordSlot[]): ProgressionDoc {
    return { ...createDefaultProgression(), slots };
  }

  /**
   * A `literal` slot. `replaceDocument` is the only door in M1 through which
   * one can arrive - its own docstring says so, the recogniser that makes them
   * being M3's - which is what makes this branch testable now rather than after
   * it is first reachable by hand.
   */
  function literalSlot(reason: 'unrecognised' | 'user-detached'): ChordSlot {
    return {
      id: 'literal-slot',
      harmony: { kind: 'literal', reason },
      startBeat: 0,
      lengthBeats: 4,
      notes: [{ midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 }],
      // A literal slot is one whose notes are no longer the app's to derive, so
      // the honest reading of the `isHandEdited: true` this used to carry is
      // that the user owns its pitches. The strip does not read the field.
      owned: { ...createOwnership(), pitches: true }
    };
  }

  /** A degree slot built by hand, for the fields no M1 control moves. */
  function degreeSlot(id: string, alter: number, lengthBeats: number): ChordSlot {
    return {
      id,
      harmony: {
        kind: 'degree',
        degree: {
          degree: 0,
          alter,
          extent: 3,
          quality: 'major',
          inversion: 0,
          suspension: 'none',
          octave: 0
        }
      },
      startBeat: 0,
      lengthBeats,
      notes: [],
      owned: createOwnership()
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
     * The spelling belongs to the progression's key, not the app's - the
     * chord palette's bug, one component over. A strip that asked `getNoteName`
     * would print D♯ Maj whenever the fretboard behind it happened to be in a
     * sharp key.
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

    /**
     * `alter` can push a root below the bottom of the chromatic table, where
     * JavaScript's `%` keeps the sign and the spelling would be read off the
     * front of it. Nothing in M1 moves `alter`; `replaceDocument` can bring in
     * a document that already has.
     */
    it('names a chord whose alteration takes its root below the tonic', () => {
      progression.replaceDocument(docOf(degreeSlot('altered', -2, 4)));
      settle();

      expect(component.cards[0].name).toBe('A# Maj');
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
     * The sizing assertions. A length computed and never bound would satisfy
     * every expectation above and size nothing on screen, and width is the
     * whole of what this strip says about time.
     *
     * The widths are read as a ratio rather than in pixels: what is being
     * asserted is that a beat is a fixed distance, which is what makes the row
     * a timeline and what lets a resize drag be scaled by a constant. The
     * number of pixels a beat is belongs to the stylesheet.
     */
    it('sizes each card by its length, at one distance per beat', () => {
      const ids = build(0, 4);
      progression.setSlotLength(ids[0], 2);
      settle();

      const cards = cardElements();
      expect(cards.map(card => card.style.getPropertyValue('--card-beats'))).toEqual(['2', '4']);

      const widths = cards.map(card => card.getBoundingClientRect().width);
      expect(widths[0]).toBeGreaterThan(0);
      expect(widths[1] / widths[0]).toBeCloseTo(2, 5);
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
    });

    /**
     * The handle is a slider, so its length is its *value* rather than part of
     * its name: `aria-valuetext` is re-read after an arrow key changes it,
     * where a name would have changed silently under a focus that never moved.
     */
    it('gives the resize handle a name and a value, separately', () => {
      build(4);

      expect(component.cards[0].resizeLabel).toBe('Length of G major');
      expect(component.cards[0].beatsText).toBe('4 beats');
      expect(component.cards[0].maxBeats).toBeGreaterThanOrEqual(component.cards[0].lengthBeats);
    });

    /** A slider has to declare a ceiling; a slot longer than it widens it. */
    it('widens the announced range to hold a slot longer than it', () => {
      progression.replaceDocument(docOf(degreeSlot('long', 0, 200)));
      settle();

      expect(component.cards[0].maxBeats).toBe(200);
    });

    it('counts a single beat in the singular', () => {
      const [id] = build(0);
      progression.setSlotLength(id, 1);
      settle();

      expect(component.cards[0].label).toBe('C major, degree 1, 1 beat');
    });

    /** M2's free timing will put fractions here, and a rounded one is a lie. */
    it('keeps a fraction of a beat in what it says', () => {
      progression.replaceDocument(docOf(degreeSlot('fractional', 0, 1.5)));
      settle();

      expect(component.cards[0].beatsText).toBe('1.5 beats');
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
      progression.replaceDocument(docOf(literalSlot('unrecognised')));
      settle();

      expect(component.cards.length).toBe(1);
      expect(component.cards[0].isUnlabelled).toBeTrue();
      expect(component.cards[0].numeral).toBe('—');
      expect(component.cards[0].name).toBe('Unlabelled');
    });

    it('says why an unrecognised slot has no numeral', () => {
      progression.replaceDocument(docOf(literalSlot('unrecognised')));
      settle();

      expect(component.cards[0].label).toBe(
        'unlabelled chord, its notes match no chord in this key, 4 beats'
      );
    });

    /** The other branch of the union, and a different story about the same card. */
    it('says why a detached slot has no numeral', () => {
      progression.replaceDocument(docOf(literalSlot('user-detached')));
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
      progression.replaceDocument(docOf(literalSlot('unrecognised')));
      settle();

      expect(component.unlabelledHint).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain(component.unlabelledHint ?? '');
    });

    it('says nothing when every card has a numeral', () => {
      build(0);
      expect(component.unlabelledHint).toBeNull();
    });

    /**
     * One unlabelled card among labelled ones is exactly when the sentence is
     * needed, and a strip of one card cannot tell "any" from "all".
     */
    it('explains them when only some of the cards have no numeral', () => {
      progression.replaceDocument(docOf(degreeSlot('named', 0, 4), literalSlot('unrecognised')));
      settle();

      expect(component.cards.map(card => card.isUnlabelled)).toEqual([false, true]);
      expect(component.unlabelledHint).not.toBeNull();
    });

    /** Still removable and still resizable: it is a chord, only an unnamed one. */
    it('leaves an unlabelled card its controls', () => {
      progression.replaceDocument(docOf(literalSlot('unrecognised')));
      settle();

      expect(component.cards[0].removeLabel).toBe('Remove unlabelled chord');
      expect(component.cards[0].resizeLabel).toBe('Length of unlabelled chord');
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
