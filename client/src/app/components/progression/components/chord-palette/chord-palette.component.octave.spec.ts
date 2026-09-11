import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordPaletteComponent } from './chord-palette.component';
import { ProgressionService } from '../../../../services/progression.service';
import { OCTAVE_MAX } from '../../../../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState
} from '../../../../models/progression.model';

/**
 * The octave control: what it reports, where it stops, and how it says so.
 *
 * The third spec on this component and the second split of it, taken at M3
 * Task 6's review when `chord-palette.component.controls.spec.ts` reached 999
 * lines against a 1000-line cap - one `it(` short of breaching the cap it had
 * itself been created to relieve, three commits earlier.
 *
 * ## Why the octave is the seam, rather than a line drawn at 500
 *
 * It is the one control on the panel with a rule of its own. The complexity
 * stepper, the sus toggles and the tension rows all write a field and are done;
 * this one asks the service what the chord is *sounding* at, because a chord
 * too wide for the octave it was given is clamped on use - so the document's
 * number and the readout's come apart, the `+` has two different reasons to
 * stop, and the widest chord in the project has to be built by hand to reach
 * either of them. That is a topic, and `buildTheWidestChord` is its fixture:
 * thirty lines of hand-worked chord that nothing else in the two files beside
 * this one has any use for.
 *
 * The cut also leaves the pair that has to be read together intact. The
 * complexity stepper stays beside the alternates row, because every shape is
 * offered at its own height and choosing one moves the stepper; the sus and
 * tension controls stay beside it because they are what the ladder's upper
 * rungs are *for*.
 *
 * ## The fixture block is copied, for the fourth time and on the same argument
 *
 * `chord-palette.component.controls.spec.ts`'s header makes it at length and it
 * is not restated here. One clause of it does need a correction, and this file
 * is the correction: that header contrasts its local fixtures with a shared
 * helper module on the grounds that a split spec's helpers are "read by exactly
 * two files". True of the ones that carry this component's meaning, and it is
 * now three files rather than two. It was never true of `settle` and
 * `currentState`, which are a repo-wide idiom - see
 * `progression.service.tensions.spec.ts`, where the same sentence has been
 * fixed. The decision is unchanged; the reason is the second half of it.
 */
describe('ChordPaletteComponent: the octave control', () => {
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

  /** The slot the strip has selected, for the tests that read its notes. */
  function selectedSlot(): ChordSlot {
    const state = currentState();
    const slot = state.doc.slots.find(candidate => candidate.id === state.selectedSlotId);
    if (!slot) throw new Error('nothing is selected');
    return slot;
  }

  /** The degree of the slot the strip has selected, for the control tests. */
  function selectedDegree(): ChordDegree {
    const slot = selectedSlot();
    if (slot.harmony.kind !== 'degree') throw new Error('no degree slot is selected');
    return slot.harmony.degree;
  }

  /** The `+` button itself, for the tests that are about the element. */
  function upButton(): HTMLButtonElement {
    const found: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button.step[aria-label="Octave up"]');
    if (found === null) throw new Error('the octave up button is not on the page');
    return found;
  }

  /** The live region the octave limit is announced in, whether or not it has text. */
  function limitRegion(): HTMLElement {
    const found: HTMLElement | null = fixture.nativeElement.querySelector('.limit-region');
    if (found === null) throw new Error('the octave limit region is not on the page');
    return found;
  }

  /**
   * A chord too wide for the top of the control, built through the palette
   * and the two setters this task adds: degree 3 of C major at a thirteenth,
   * altered down a tone, overridden to `diminished`, suspended, with a flat
   * ninth and a flat thirteenth. Two of those replacements land below the note
   * beneath them, so the ascent lift adds an octave twice.
   *
   * It tops out at MIDI 107 where it sits, 47 semitones above the voicing
   * base, so it fits at octave 1 and would end on 131 at octave 2. Its ceiling
   * is therefore **1** against a control that goes to 2 - the case the two
   * messages have to tell apart. It is the design doc's witness minus the
   * inversion and the key that take it to 58, and those eleven semitones would
   * only move the ceiling to 0.
   */
  function buildTheWidestChord(): string {
    component.addChord(component.chords[3]);
    settle();
    const id = currentState().selectedSlotId ?? '';
    progression.setSlotChord(id, { degree: 3, alter: -2, quality: 'diminished', extent: 13 });
    progression.setSlotSuspension(id, 'sus4');
    progression.setSlotExtension(id, 'ninth', -1);
    progression.setSlotExtension(id, 'thirteenth', -1);
    settle();
    return id;
  }

  describe('stepping the octave', () => {
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

    /**
     * The sign is the readout. `1` and `-1` are two octaves apart and differ on
     * screen by one character, so an unsigned positive reads as an absolute
     * position rather than as a shift from where the chord sits by default.
     */
    it('signs the octave it reports', () => {
      expect(component.octaveLabel).toBe('0');

      component.stepOctave(1);
      settle();
      expect(component.octaveLabel).toBe('+1');

      component.stepOctave(-1);
      component.stepOctave(-1);
      settle();
      expect(component.octaveLabel).toBe('-1');
    });
  });

  /**
   * The other half of "the octave ceiling is the chord's, not the model's":
   * the readout says what is *sounding*, and the `+` stepper stops with a
   * reason when the chord cannot go higher. A control that silently does nothing
   * is the failure this panel has been fixed for three times, and a per-chord
   * ceiling is exactly the shape that produces one: the document stores 2, the
   * chord sounds at 0, and a `-` stepping from the stored value would write 1
   * and move nothing.
   *
   * These are the numbers. The describe below is how the stopping is *said*.
   */
  describe('the octave a chord is really sounding at', () => {
    it('reports the ordinary octave when the chord fits', () => {
      component.addChord(component.chords[0]);
      settle();

      expect(component.octaveLabel).toBe('0');
      expect(component.octaveCeilingReached).toBeFalse();
      expect(component.octaveLimit).toBeNull();
    });

    /** And the stepper rests there rather than running off the ladder. */
    it('disables the up stepper at the top of the range, and says so', () => {
      component.addChord(component.chords[0]);
      settle();
      for (let press = 0; press < 6; press++) {
        component.stepOctave(1);
        settle();
      }

      expect(selectedDegree().octave).toBe(OCTAVE_MAX);
      expect(component.octaveLabel).toBe(`+${OCTAVE_MAX}`);
      expect(component.octaveCeilingReached).toBeTrue();
      expect(component.octaveLimit).toContain('top of the range');
    });

    /**
     * A wide chord has room below its own ceiling like any other, so the panel
     * says nothing while it is under one. This is the case Task 4b's note warns
     * that folding the two predicates together would lose.
     */
    it('says nothing while a wide chord is still under its ceiling', () => {
      const id = buildTheWidestChord();

      expect(progression.slotOctave(id)?.ceiling).toBeLessThan(OCTAVE_MAX);
      expect(component.octaveCeilingReached).toBeFalse();
      expect(component.octaveLimit).toBeNull();
    });

    /**
     * The chord's own limit is a different sentence: the control has room and
     * this chord does not. Task 4b wrote the predicate as `requested > ceiling`,
     * which is false here - the slot is asking for exactly the octave it got -
     * so that version would have told a user one press into a two-octave control
     * that they were at the top of the range.
     */
    it('says the chord is too wide when the chord is the limit', () => {
      const id = buildTheWidestChord();

      component.stepOctave(1);
      settle();

      const octave = progression.slotOctave(id);
      expect(octave?.requested).toBe(1);
      expect(octave?.sounding).toBe(octave?.ceiling ?? -99);
      expect(octave?.ceiling).toBeLessThan(OCTAVE_MAX);
      expect(component.octaveCeilingReached).toBeTrue();
      expect(component.octaveLimit).toContain('too wide');
    });

    /** And the stepper refuses rather than storing a request that sounds nothing. */
    it('records nothing when the up stepper is pressed against that ceiling', () => {
      const id = buildTheWidestChord();
      component.stepOctave(1);
      settle();
      const before = currentState().doc;

      component.stepOctave(1);
      settle();

      expect(currentState().doc).toBe(before);
      expect(progression.slotOctave(id)?.requested).toBe(1);
    });

    /**
     * The readout follows what is sounding rather than what is stored, which is
     * the number the `-` stepper has to work from: stepping down from a stored 2
     * that sounds at 0 would write 1 and change no note.
     */
    it('reports the sounding octave and steps down from it', () => {
      const id = buildTheWidestChord();
      progression.setSlotOctave(id, OCTAVE_MAX);
      settle();

      const octave = progression.slotOctave(id);
      const sounding = octave?.sounding ?? 0;
      expect(octave?.requested).toBe(OCTAVE_MAX);
      expect(sounding).toBeLessThan(OCTAVE_MAX);
      expect(component.octaveLabel).toBe(sounding > 0 ? `+${sounding}` : `${sounding}`);

      component.stepOctave(-1);
      settle();

      expect(selectedDegree().octave).toBe(sounding - 1);
    });
  });

  /**
   * How the `+` says why it has stopped, which is the third attempt at it.
   *
   * Task 4b disabled the button. Task 6 added a sentence beside it. This adds
   * the only part that was missing both times: a *link* between the two, and a
   * button a user can still reach in order to follow it.
   *
   * Both halves are asserted on the element rather than on the component's
   * fields, because both halves are the element. A `disabled` attribute that
   * crept back would take the button out of the tab order with every field on
   * this component still correct, and a hint whose `id` was renamed would leave
   * `aria-describedby` pointing at nothing with no test failing.
   */
  describe('saying why the up stepper has stopped', () => {
    /**
     * The reproduction of the bug this describe was written for.
     *
     * The region used to carry `*ngIf="unavailable === null"`, which is the
     * failure its own comment describes: a pentatonic key removed the wrapper,
     * and coming back from one created the wrapper and the sentence together -
     * so a screen reader was told nothing, in the one state where the panel had
     * something to say. The assertion is on the node's identity, because "the
     * text is right" is true either way and is not what was broken.
     */
    it('keeps the live region on the page through a key with no chords', () => {
      const region = limitRegion();

      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(fixture.nativeElement.contains(region)).toBeTrue();

      progression.setKey(0, 'ionian');
      settle();

      expect(limitRegion()).toBe(region);
    });

    /** And it is the region the sentence actually lands in when one appears. */
    it('announces the limit in that same region', () => {
      const region = limitRegion();
      expect(region.textContent?.trim()).toBe('');

      buildTheWidestChord();
      component.stepOctave(1);
      settle();

      expect(component.octaveLimit).not.toBeNull();
      expect(region.textContent).toContain(component.octaveLimit ?? '');
    });

    /**
     * `aria-disabled` and not `disabled`, which is the whole point: a disabled
     * button is out of the tab order, so a user who arrives after the
     * announcement - or who arrives by tabbing, and never lands on it at all -
     * has no way to ask what happened.
     */
    it('leaves the stepper focusable and marks it aria-disabled', () => {
      buildTheWidestChord();
      component.stepOctave(1);
      settle();

      const button = upButton();
      expect(button.disabled).toBeFalse();
      expect(button.getAttribute('aria-disabled')).toBe('true');

      button.focus();
      expect(document.activeElement).toBe(button);
    });

    /** And points at the sentence, by an id that has to resolve to it. */
    it('describes the stepper by the sentence that explains it', () => {
      buildTheWidestChord();
      component.stepOctave(1);
      settle();

      const describedBy = upButton().getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();

      const hint: HTMLElement | null =
        fixture.nativeElement.querySelector(`#${describedBy}`);
      expect(hint).not.toBeNull();
      expect(hint?.textContent).toContain('too wide');
    });

    /**
     * With nothing selected the same button is dead for a different reason, and
     * points at the different sentence. Two reasons, one button, and never both
     * at once: `renderOctave` asks for no octave without a selection, so there
     * is no ceiling for it to have reached.
     */
    it('points at the other reason when there is nothing selected', () => {
      component.addChord(component.chords[0]);
      settle();
      progression.selectSlot(null);
      settle();

      const describedBy = upButton().getAttribute('aria-describedby');
      const hint: HTMLElement | null =
        fixture.nativeElement.querySelector(`#${describedBy}`);

      expect(upButton().getAttribute('aria-disabled')).toBe('true');
      expect(hint?.textContent).toContain('Pick a chord in the strip');
    });

    /** And says nothing at all while the button works. */
    it('describes nothing while the stepper has somewhere to go', () => {
      component.addChord(component.chords[0]);
      settle();

      const button = upButton();
      expect(button.getAttribute('aria-disabled')).toBe('false');
      expect(button.getAttribute('aria-describedby')).toBeNull();
    });

    /**
     * The refusal survives the swap, which is the one thing `disabled` was
     * doing for free. A browser fires the click on an `aria-disabled` button
     * like any other, so the guard in `stepOctave` is now the whole of it.
     */
    it('still refuses a real click at the ceiling', () => {
      const id = buildTheWidestChord();
      component.stepOctave(1);
      settle();
      const before = currentState().doc;

      upButton().click();
      settle();

      expect(currentState().doc).toBe(before);
      expect(progression.slotOctave(id)?.requested).toBe(1);
    });
  });
});
