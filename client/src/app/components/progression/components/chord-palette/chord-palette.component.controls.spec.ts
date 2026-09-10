import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ChordPaletteComponent,
  PaletteAlternate,
  PaletteOption
} from './chord-palette.component';
import { ProgressionService } from '../../../../services/progression.service';
import { OCTAVE_MAX } from '../../../../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState
} from '../../../../models/progression.model';
import { NamedQuality, effectiveChord } from '../../../../services/progression-harmony';

/**
 * What the palette *changes*: the steppers, and the row that re-shapes the
 * chord they are pointed at.
 *
 * Split out of `chord-palette.component.spec.ts` when that file reached the
 * 1000-line cap, on the precedent `progression-vocabulary.spelling.spec.ts`
 * set - a second topic-named spec for one component, with its own local
 * fixtures rather than a shared helper module, the two files cross-referencing.
 *
 * ## Where the seam is, and why it is not "the rows"
 *
 * The obvious cut is by row, and it is the wrong one. The component's own
 * docstring argues at length that the alternates row belongs with the steppers
 * rather than with the two rows above it: all three act on the chord that is
 * *selected*, none of them adds one, and that shared verb is why the row is
 * drawn below the steppers rather than beside its two siblings. So the cut is
 * by verb. Over there the subject is what the palette offers - which chords are
 * in this key, which are borrowed, what each button says, and what appending one
 * does. Here it is what happens to the chord already in the strip.
 *
 * The complexity stepper and the alternates row are the pair that most needs to
 * be read together: every shape is offered at its own height, so choosing one
 * moves the stepper, and `heightWarning` is the panel saying so before the
 * click. Splitting those two apart would have put a claim and its cost in
 * different files.
 *
 * ## The fixtures are copied, and that was a decision rather than a default
 *
 * This is the third pair of specs in the project to duplicate a fixture block -
 * after `score-doc-mapper.ghost-voice.spec.ts` and
 * `progression-vocabulary.spelling.spec.ts` - and three is where a rule of
 * thumb would say to extract a shared helper. It is still not extracted, and
 * the reason is that the count is of *pairs* and not of *callers*.
 *
 * The three fixture blocks have nothing in common with each other: one builds
 * score documents, one builds keys and vocabularies, this one stands up an
 * Angular TestBed. A shared helper turns on how many callers read one set of
 * fixtures, and each of these sets has exactly two. Extracting them would make
 * three new modules, each serving two files, and would not remove a single
 * duplicated line from any other pair. What recurs here is the *pattern* of
 * splitting a spec, not a fixture.
 *
 * The second half of the argument is local and is the one that would change the
 * answer if it stopped holding: the two halves of this pair do not want the same
 * helpers. That file keeps `secondary()`, which nothing here asks for; this one
 * grows readouts for the sus, tension and octave controls that nothing there
 * asks for. A shared module frozen at the intersection would hold `settle` and
 * two three-line lookups, and every later test would have to decide whether its
 * helper was general enough to go in it - which is a decision per test, where
 * copying is a decision once.
 */
describe('ChordPaletteComponent controls', () => {
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

  /** What the selected slot actually sounds, as pitch classes. */
  function selectedPitchClasses(): number[] {
    const classes = selectedSlot().notes.map(note => ((note.midi % 12) + 12) % 12);
    return [...new Set(classes)].sort((first, second) => first - second);
  }

  /** The one option in a row with this numeral, or a failure that names the row. */
  function option(row: readonly PaletteOption[], numeral: string): PaletteOption {
    const found = row.find(candidate => candidate.numeral === numeral);
    if (found === undefined) {
      throw new Error(`no ${numeral} among [${row.map(one => one.numeral).join(', ')}]`);
    }
    return found;
  }

  function borrowed(numeral: string): PaletteOption {
    return option(component.borrowed, numeral);
  }

  /**
   * An alternate by its shape rather than its numeral, because the shape is
   * what that row varies: all sixteen sit on one root.
   */
  function alternate(quality: NamedQuality): PaletteAlternate {
    const found = component.alternates.find(candidate => candidate.quality === quality);
    if (found === undefined) throw new Error(`no ${quality} on the alternates row`);
    return found;
  }

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

    /**
     * The stored `quality` is the user's override and stays `null` through a
     * complexity step - it used to be overwritten with the derived label on
     * every regeneration, which is what erased a borrowed chord. The name is
     * read back off the chord that was built, which is where the strip card
     * gets it.
     */
    it('raises a triad to a seventh, and the name follows the notes', () => {
      component.stepComplexity(1);
      settle();

      expect(selectedDegree().extent).toBe(7);
      expect(selectedDegree().quality).toBeNull();

      const intervals = currentState().keyScale?.intervals ?? [];
      // Degree 4 of a major scale, extended: the dominant seventh.
      expect(effectiveChord(intervals, {
        degree: 4,
        alter: 0,
        extent: 7,
        quality: null,
        suspension: 'none',
        extensions: { ninth: null, eleventh: null, thirteenth: null }
      }).base).toBe('dominant7');
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

    /**
     * The readout, rung by rung.
     *
     * These five words are the whole of what the control tells a user about
     * what it just did, and they are the component's own table - nothing in
     * `progression-harmony.spec.ts` covers them. Swapped or shifted by one they
     * would report a seventh as a ninth, which is a false statement about the
     * chord that is playing.
     */
    it('names each rung of the ladder as it climbs', () => {
      const climbed = [component.extentLabel];

      for (let press = 0; press < 4; press++) {
        component.stepComplexity(1);
        settle();
        climbed.push(component.extentLabel);
      }

      expect(climbed).toEqual(['Triad', '7th', '9th', '11th', '13th']);
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

    /**
     * And says so in the readouts, rather than leaving the last chord's
     * complexity and octave standing beside two dead buttons - which reads as
     * a description of something still selected.
     */
    it('describes nothing in the readouts', () => {
      expect(component.extentLabel).toBe('—');
      expect(component.octaveLabel).toBe('—');
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
   * The half of the alternates row that changes no note and so had nothing on
   * screen saying it happened.
   *
   * Clicking the marked button turns `ChordDegree.quality` from `null` - "as
   * the key gives it" - into an override, which is the *right* reading of the
   * row and is also the one thing about it a user could not see. The button
   * announced itself as "Change to G major, triad", identical to the eleven
   * beside it and a promise of a change on the one button that changes no note.
   */
  describe('saying that a shape pins the chord', () => {
    beforeEach(() => {
      component.addChord(component.chords[4]);
      settle();
    });

    it('names the pin on the marked button and the change on the others', () => {
      expect(alternate('major').current).toBeTrue();
      expect(alternate('major').label).toBe('Pin as G major, triad');
      expect(alternate('minor').label).toBe('Change to G minor, triad');
    });

    /**
     * The height cost is still on it: the marked button shortens a ninth too,
     * which is the whole of what `heightWarning` is about. The marked shape
     * there is the dominant seventh rather than the triad, a stack of four or
     * more being named after its seventh - so the pin and the cost land on one
     * button and both have to be said.
     */
    it('keeps the height cost on the pin', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      expect(alternate('dominant7').current).toBeTrue();
      expect(alternate('dominant7').label)
        .toBe('Pin as G dominant seventh, 7th, down from the 9th');
    });

    /**
     * The mark follows what the slot *plays*, so the pinned button is the
     * marked one before and after the click - and the second click is a no-op
     * on a command that is already satisfied, which is what "Pin as" says.
     */
    it('still names the pin once the shape is pinned', () => {
      component.chooseAlternate(alternate('major'));
      settle();

      expect(selectedDegree().quality).toBe('major');
      expect(alternate('major').label).toBe('Pin as G major, triad');
    });

    /** And the way back out of it is said once under the row, not on a button. */
    it('names the way back under the row', () => {
      expect(fixture.nativeElement.textContent).toContain('Reset to chord');
    });
  });

  /**
   * Which chord the alternates row acts on, which the heading did not say.
   *
   * The row is defined by the selection and every append re-points it, so a
   * user who clicks a borrowed chord and then reaches for `minor` re-shapes the
   * chord they just added rather than the one they were editing. `Other shapes`
   * over twelve buttons that stayed put said nothing about that.
   */
  describe('naming the chord the alternates row acts on', () => {
    it('names it in the heading and speaks it in the label', () => {
      component.addChord(component.chords[4]);
      settle();

      expect(component.alternatesTitle).toBe('Other shapes on V (G Maj)');
      expect(component.alternatesLabel).toBe('Other shapes on G major');
    });

    it('follows the shape the slot is retuned to', () => {
      component.addChord(component.chords[4]);
      settle();
      component.chooseAlternate(alternate('minor7'));
      settle();

      expect(component.alternatesTitle).toBe('Other shapes on v7 (G min7)');
    });

    it('re-points at whatever was appended last', () => {
      component.addChord(component.chords[0]);
      settle();
      expect(component.alternatesTitle).toBe('Other shapes on I (C Maj)');

      component.addOption(borrowed('♭VII'));
      settle();
      expect(component.alternatesTitle).toBe('Other shapes on ♭VII (Bb Maj)');
    });

    it('puts the heading on the page', () => {
      component.addChord(component.chords[4]);
      settle();

      const heading = fixture.nativeElement.querySelector('.group-title.named');
      expect(heading.textContent.trim()).toBe('Other shapes on V (G Maj)');
      expect(fixture.nativeElement.querySelector('.alternates').getAttribute('aria-label'))
        .toBe('Other shapes on G major');
    });

    it('says which row it is when nothing selected leaves it off the page', () => {
      expect(component.alternates).toEqual([]);
      expect(component.alternatesTitle).toBe('Other shapes on the selected chord');
    });
  });

  /**
   * The alternates row is the other verb: it re-shapes the chord that is
   * selected rather than adding one, which is the only thing sixteen shapes on a
   * root the user is already sitting on could usefully mean.
   */
  describe('clicking an alternate', () => {
    beforeEach(() => {
      component.addChord(component.chords[4]);
      settle();
    });

    it('retunes the selected slot rather than appending', () => {
      component.chooseAlternate(alternate('minor'));
      settle();

      expect(currentState().doc.slots.length).toBe(1);
      expect(selectedDegree().quality).toBe('minor');
      // G B♭ D.
      expect(selectedPitchClasses()).toEqual([2, 7, 10]);
    });

    it('keeps the degree and the accidental it is a shape of', () => {
      component.addOption(borrowed('♭VI'));
      settle();
      component.chooseAlternate(alternate('minor7'));
      settle();

      const degree = selectedDegree();
      expect([degree.degree, degree.alter]).toEqual([5, -1]);
      expect(degree.quality).toBe('minor7');
    });

    /**
     * The marked button is not a no-op, and that is deliberate rather than
     * overlooked: a fresh slot follows the mode, and clicking the shape it
     * happens to be pins it to that shape. Which is what the row means - a user
     * who clicks `major` has said the chord is major - so the key change that
     * would have turned it minor now leaves it alone.
     */
    it('pins the shape even when it is the one already marked', () => {
      expect(selectedDegree().quality).toBeNull();
      expect(alternate('major').current).toBeTrue();

      component.chooseAlternate(alternate('major'));
      settle();

      expect(selectedDegree().quality).toBe('major');
      // G B D still, because the shape did not move - only the claim did.
      expect(selectedPitchClasses()).toEqual([2, 7, 11]);
    });

    it('dispatches nothing with nothing selected', () => {
      const shape = alternate('minor');
      progression.selectSlot(null);
      settle();
      spyOn(progression, 'setSlotChord');

      component.chooseAlternate(shape);

      expect(progression.setSlotChord).not.toHaveBeenCalled();
    });

  });

  /**
   * The cost the vocabulary could not fix from the pure layer: every shape is
   * offered at the height its own name is true at, so choosing one sets the
   * slot's height as well as its shape - and a user sitting on a ninth loses
   * the ninth. The panel has to say so before the click, not after.
   */
  describe('the height an alternate sets', () => {
    beforeEach(() => {
      component.addChord(component.chords[4]);
      settle();
    });

    it('states that height on every button', () => {
      expect(alternate('major').heightLabel).toBe('Triad');
      expect(alternate('dominant7').heightLabel).toBe('7th');
    });

    it('says nothing while no shape would shorten the chord', () => {
      expect(component.extentLabel).toBe('Triad');
      expect(component.alternates.some(chord => chord.lowersHeight)).toBeFalse();
      expect(component.heightWarning).toBeNull();
    });

    /**
     * On a ninth, every one of the sixteen is shorter - the triads by two rungs
     * and the four-note shapes by one - so all sixteen are marked and the row
     * says which height is at stake.
     */
    it('marks every button that would shorten it, and names what is at stake', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      expect(component.extentLabel).toBe('9th');
      expect(component.alternates.every(chord => chord.lowersHeight)).toBeTrue();
      expect(component.heightWarning).toContain('9th');
    });

    /** On a seventh only the triads shorten it, and only those are marked. */
    it('marks only the shapes that are shorter than the chord', () => {
      component.stepComplexity(1);
      settle();

      expect(alternate('major').lowersHeight).toBeTrue();
      expect(alternate('dominant7').lowersHeight).toBeFalse();
    });

    /**
     * The warning is about something that really happens, and it reaches the
     * marked button too: a ninth is named after its seventh, so `dominant7` is
     * what is marked here, it stands a rung below the slot, and clicking it
     * takes a note away. Every one of the sixteen does, which is what the
     * sentence under the row says.
     */
    it('takes the ninth away when one of them is clicked', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();
      expect(selectedSlot().notes.length).toBe(5);

      component.chooseAlternate(alternate('major'));
      settle();

      expect(selectedDegree().extent).toBe(3);
      expect(selectedSlot().notes.length).toBe(3);
      expect(component.extentLabel).toBe('Triad');
    });

    /** And the spoken label carries it, for a user who cannot see the mark. */
    it('says on the button that it will shorten the chord', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      expect(alternate('major').label).toContain('down from the 9th');
      expect(alternate('major7').label).toContain('down from the 9th');
    });

    it('says nothing of the kind on a shape that stands taller', () => {
      expect(alternate('dominant7').label).not.toContain('down from');
    });
  });
});
