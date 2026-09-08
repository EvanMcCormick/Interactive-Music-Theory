import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordPaletteComponent } from './chord-palette.component';
import { ProgressionService } from '../../../../services/progression.service';
import {
  ChordDegree,
  OCTAVE_MAX,
  ProgressionState
} from '../../../../models/progression.model';

/**
 * What the palette offers, what it refuses, and what it dispatches.
 *
 * The DOM is asserted in one place only - that the refusal is actually on
 * screen - and never by shape. `CLAUDE.md` rules out pinning structure, and the
 * circle of fifths' spec makes the same call for the same reason: the contract
 * worth protecting is the one with the service, so these tests call the
 * component's own methods and read the service back, exactly as a click would.
 *
 * The two label tables are not re-tested here. `progression-harmony.spec.ts`
 * checks `romanNumeral` and `chordName` against both figure tables directly,
 * and repeating that through a fixture would test the same table twice and the
 * wiring not at all. What is tested here is that the palette reads the *key's*
 * scale - which is why both key tests check the numerals and the names together:
 * the numerals holding while the names move is the whole teaching claim.
 */
describe('ChordPaletteComponent', () => {
  let fixture: ComponentFixture<ChordPaletteComponent>;
  let component: ChordPaletteComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChordPaletteComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ChordPaletteComponent);
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

  /** The degree of the slot the strip has selected, for the control tests. */
  function selectedDegree(): ChordDegree {
    const state = currentState();
    const slot = state.doc.slots.find(candidate => candidate.id === state.selectedSlotId);
    if (!slot || slot.harmony.kind !== 'degree') throw new Error('no degree slot is selected');
    return slot.harmony.degree;
  }

  describe('what it offers', () => {
    // The default key. C ionian is what `createDefaultProgression` opens on, so
    // this is what the page shows before anything is touched.
    it('offers the seven chords of a major key', () => {
      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
      expect(component.chords.map(chord => chord.name))
        .toEqual(['C Maj', 'D min', 'E min', 'F Maj', 'G Maj', 'A min', 'B°']);
    });

    /**
     * The claim the page is built to make: the numerals are a property of the
     * mode and the names a property of the key, so moving to A minor changes
     * every name and the numerals with them - because the *mode* changed too.
     */
    it('re-labels itself when the key changes', () => {
      progression.setKey(9, 'aeolian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
      expect(component.chords.map(chord => chord.name))
        .toEqual(['A min', 'B°', 'C Maj', 'D min', 'E min', 'F Maj', 'G Maj']);
    });

    // Same mode, different tonic: every numeral holds and every name moves.
    it('keeps the numerals when only the tonic moves', () => {
      progression.setKey(7, 'ionian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
      expect(component.chords[0].name).toBe('G Maj');
    });
  });

  describe('the non-heptatonic guard', () => {
    /**
     * The guard the whole palette turns on. Stacking thirds through a
     * five-note scale is not a harder version of the same sum, it is a
     * different sum with no answer, so the page has to say so rather than
     * print five chords that are not chords.
     */
    it('offers nothing and explains itself for a pentatonic scale', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      const explanation = component.unavailable ?? '';

      expect(component.chords).toEqual([]);
      expect(explanation).toContain('seven');
      // The one DOM assertion: an explanation the component computed but never
      // rendered would pass every expectation above and show the user nothing.
      expect(fixture.nativeElement.textContent).toContain(explanation);
    });

    it('offers nothing for a blues scale', () => {
      progression.setKey(0, 'minorBlues');
      settle();

      expect(component.chords).toEqual([]);
      expect(component.unavailable).not.toBeNull();
    });

    /**
     * An id nothing resolves is the same refusal by another road, and it is
     * reachable: `ProgressionKey.scaleId` is a plain string, and `setKey`
     * stores an unknown one rather than refusing it.
     */
    it('offers nothing for a scale the app does not know', () => {
      progression.setKey(0, 'no-such-scale');
      settle();

      expect(component.chords).toEqual([]);
      expect(component.unavailable).not.toBeNull();
    });

    it('offers the seven again when a heptatonic key comes back', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();
      progression.setKey(0, 'ionian');
      settle();

      expect(component.chords.length).toBe(7);
      expect(component.unavailable).toBeNull();
    });
  });

  describe('clicking a chord', () => {
    it('appends the degree that was clicked', () => {
      spyOn(progression, 'appendSlot');

      component.addChord(component.chords[4]);

      expect(progression.appendSlot).toHaveBeenCalledWith(4);
    });

    // The same click against the real service, because a spy cannot see that
    // the degree the palette emits is the degree the service can build from.
    it('puts that chord on the end of the progression and selects it', () => {
      component.addChord(component.chords[4]);
      settle();

      const state = currentState();
      expect(state.doc.slots.length).toBe(1);
      expect(selectedDegree().degree).toBe(4);
      expect(state.selectedSlotId).toBe(state.doc.slots[0].id);
    });
  });

  describe('the complexity control', () => {
    beforeEach(() => {
      component.addChord(component.chords[4]);
      settle();
    });

    it('steps the selected slot up and down the extent ladder', () => {
      const selected = currentState().selectedSlotId ?? '';
      spyOn(progression, 'stepSlotExtent');

      component.stepComplexity(1);
      expect(progression.stepSlotExtent).toHaveBeenCalledWith(selected, 1);

      component.stepComplexity(-1);
      expect(progression.stepSlotExtent).toHaveBeenCalledWith(selected, -1);
    });

    it('raises a triad to a seventh, and re-labels it', () => {
      component.stepComplexity(1);
      settle();

      expect(selectedDegree().extent).toBe(7);
      // Degree 4 of a major scale, extended: the dominant seventh.
      expect(selectedDegree().quality).toBe('dominant7');
    });

    /**
     * `stepSlotExtent` clamps at both ends of the ladder, and the control has
     * to be usable in the way that makes that matter: held down at the top.
     */
    it('rests at the top of the ladder rather than running off it', () => {
      for (let press = 0; press < 8; press++) {
        component.stepComplexity(1);
        settle();
      }

      expect(selectedDegree().extent).toBe(13);
    });

    it('rests at the triad rather than running below it', () => {
      component.stepComplexity(-1);
      component.stepComplexity(-1);
      settle();

      expect(selectedDegree().extent).toBe(3);
    });
  });

  describe('the octave control', () => {
    beforeEach(() => {
      component.addChord(component.chords[0]);
      settle();
    });

    it('shifts the selected slot by whole octaves', () => {
      component.stepOctave(1);
      settle();
      expect(selectedDegree().octave).toBe(1);

      component.stepOctave(-1);
      settle();
      expect(selectedDegree().octave).toBe(0);
    });

    it('rests at the top of the playable range', () => {
      for (let press = 0; press < 6; press++) {
        component.stepOctave(1);
        settle();
      }

      expect(selectedDegree().octave).toBe(OCTAVE_MAX);
    });
  });

  /**
   * With nothing selected the controls do nothing at all, rather than falling
   * back to the last chord.
   *
   * Silently editing a chord the user is not looking at is the worse failure,
   * and there is no path to it worth having: `appendSlot` selects what it
   * appends, so clicking a chord and then adjusting it - the whole flow these
   * buttons exist for - always has a selection. The controls are disabled so
   * that the no-op is visible rather than mysterious.
   */
  describe('with nothing selected', () => {
    beforeEach(() => {
      component.addChord(component.chords[0]);
      settle();
      progression.selectSlot(null);
      settle();
    });

    it('disables the controls', () => {
      expect(component.canAdjust).toBeFalse();
    });

    it('dispatches nothing', () => {
      spyOn(progression, 'stepSlotExtent');
      spyOn(progression, 'setSlotOctave');

      component.stepComplexity(1);
      component.stepOctave(1);

      expect(progression.stepSlotExtent).not.toHaveBeenCalled();
      expect(progression.setSlotOctave).not.toHaveBeenCalled();
    });

    // A key that can build no chords can adjust none either - the service
    // refuses the edit, so the control must not offer it.
    it('disables the controls in a key that can build no chords', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(component.canAdjust).toBeFalse();
    });
  });

  /**
   * The `takeUntil(destroy$)` guardrail, asserted rather than assumed: a
   * subscription that outlived the component would keep rebuilding a view
   * nothing renders, and the project rules single this out.
   */
  it('stops listening once destroyed', () => {
    const before = component.chords.map(chord => chord.name);

    fixture.destroy();
    progression.setKey(9, 'aeolian');

    expect(component.chords.map(chord => chord.name)).toEqual(before);
  });
});
