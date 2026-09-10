import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ChordPaletteComponent,
  PaletteAlternate,
  PaletteOption
} from './chord-palette.component';
import {
  SuspensionChoice,
  TensionChoice,
  TensionRow
} from './chord-palette-controls-view';
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
 * docstring argues that the alternates row belongs with the steppers rather
 * than with the two rows above it: all three act on the chord that is
 * *selected*, none of them adds one, and that shared verb is why the row is
 * drawn below the steppers. So the cut is by verb - over there, which chords
 * this key offers and what appending one does; here, what happens to the chord
 * already in the strip. It also keeps the complexity stepper beside the
 * alternates row, which is the pair that most needs reading together: every
 * shape is offered at its own height, so choosing one moves the stepper, and
 * `heightWarning` is the panel saying so before the click.
 *
 * ## The fixtures are copied, and that was a decision rather than a default
 *
 * This is the third pair of specs in the project to duplicate a fixture block -
 * after `score-doc-mapper.ghost-voice.spec.ts` and
 * `progression-vocabulary.spelling.spec.ts` - and three is where a rule of
 * thumb would say to extract a shared helper. It is still not extracted,
 * because the count is of *pairs* rather than of *callers*: the three blocks
 * have nothing in common with each other - one builds score documents, one
 * builds keys and vocabularies, this one stands up a TestBed - so extracting
 * them would make three modules serving two files each and would remove not one
 * duplicated line from any other pair. What recurs is the *pattern* of splitting
 * a spec, not a fixture.
 *
 * The local half of the argument is the one that would change the answer if it
 * stopped holding: the two halves of this pair do not want the same helpers.
 * That file keeps `secondary()`, which nothing here asks for; this one grows
 * readouts for the sus, tension and octave controls that nothing there asks
 * for. A shared module frozen at the intersection would hold `settle` and two
 * three-line lookups, and every later test would have to decide whether its
 * helper was general enough to go in it - a decision per test, where copying is
 * a decision once.
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

  /** What the selected slot actually sounds, as MIDI numbers in order. */
  function selectedMidi(): number[] {
    return selectedSlot().notes.map(note => note.midi);
  }

  /** The Sus button with this face, or a failure that says what is on the row. */
  function suspension(label: string): SuspensionChoice {
    const found = component.suspensions.find(candidate => candidate.label === label);
    if (found === undefined) {
      throw new Error(
        `no ${label} among [${component.suspensions.map(one => one.label).join(', ')}]`
      );
    }
    return found;
  }

  /** The one Tensions row for this extension, or a failure that says what is there. */
  function tensionRow(extension: string): TensionRow {
    const found = component.tensions.find(candidate => candidate.extension === extension);
    if (found === undefined) {
      throw new Error(
        `no ${extension} row among [${component.tensions.map(one => one.extension).join(', ')}]`
      );
    }
    return found;
  }

  /** The button with this figure on that row. */
  function tension(extension: string, label: string): TensionChoice {
    const found = tensionRow(extension).choices.find(candidate => candidate.label === label);
    if (found === undefined) throw new Error(`no ${label} on the ${extension} row`);
    return found;
  }

  /** Whichever figure on a row is marked, or null when none is. */
  function markedTension(extension: string): string | null {
    return tensionRow(extension).choices.find(choice => choice.current)?.label ?? null;
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

    /**
     * The four added-tone shapes M3 Task 4 put in `QUALITY_INTERVALS`. That the
     * row *offers* them at a seventh's height is pinned in
     * `chord-palette.component.spec.ts`; this is what clicking one does, which
     * is four notes rather than a truncated triad.
     */
    it('builds a sixth chord from the added-tone shape', () => {
      component.chooseAlternate(alternate('major6'));
      settle();

      expect(selectedDegree().quality).toBe('major6');
      expect(selectedDegree().extent).toBe(7);
      // G B D E.
      expect(selectedPitchClasses()).toEqual([2, 4, 7, 11]);
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
  /**
   * The Sus control: the third replaced by the second or the fourth, at
   * whatever height the chord is standing on.
   *
   * Nothing in the UI wrote `ChordDegree.suspension` before M3 Task 6 - the
   * field had been stored, normalised and, since Task 4, *sounded*, and was
   * reachable only by dragging a note in the roll. These are the buttons that
   * make the design's "any combination can be built" true from the palette.
   */
  describe('the sus control', () => {
    beforeEach(() => {
      component.addChord(component.chords[0]);
      settle();
    });

    it('offers none, sus2 and sus4, with the current one pressed', () => {
      expect(component.suspensions.map(choice => choice.label))
        .toEqual(['None', 'sus2', 'sus4']);
      expect(component.suspensions.map(choice => choice.current))
        .toEqual([true, false, false]);
    });

    /** C E G becomes C F G: the third replaced, the fifth left alone. */
    it('suspends the fourth over the third', () => {
      component.setSuspension(suspension('sus4'));
      settle();

      expect(selectedDegree().suspension).toBe('sus4');
      expect(selectedMidi()).toEqual([60, 65, 67]);
      expect(component.suspensions.map(choice => choice.current))
        .toEqual([false, false, true]);
    });

    /** And C D G for the second. */
    it('suspends the second over the third', () => {
      component.setSuspension(suspension('sus2'));
      settle();

      expect(selectedMidi()).toEqual([60, 62, 67]);
    });

    it('takes the suspension off again', () => {
      component.setSuspension(suspension('sus4'));
      settle();
      component.setSuspension(suspension('None'));
      settle();

      expect(selectedDegree().suspension).toBe('none');
      expect(selectedMidi()).toEqual([60, 64, 67]);
    });

    /**
     * The suspension replaces the third at every height, which is what makes
     * `7sus4` fall out of the model with no rule of its own - and what the
     * control has to be able to reach. G7 is G B D F, so G7sus4 is G C D F.
     */
    it('suspends a seventh chord without lowering it', () => {
      component.addChord(component.chords[4]);
      component.stepComplexity(1);
      settle();

      component.setSuspension(suspension('sus4'));
      settle();

      expect(selectedDegree().extent).toBe(7);
      expect(selectedPitchClasses()).toEqual([0, 2, 5, 7]);
    });

    /** A glyph-free label, because "sus4" read aloud is three letters and a four. */
    it('says each button aloud', () => {
      expect(component.suspensions.map(choice => choice.ariaLabel))
        .toEqual(['no suspension', 'suspended second', 'suspended fourth']);
    });

    it('dispatches nothing with nothing selected', () => {
      const choice = suspension('sus4');
      progression.selectSlot(null);
      settle();
      spyOn(progression, 'setSlotSuspension');

      component.setSuspension(choice);

      expect(progression.setSlotSuspension).not.toHaveBeenCalled();
    });

    /**
     * Greyed rather than gone with nothing selected, as the two steppers beside
     * it are: a group three buttons wide that came and went would move the rows
     * under it every time a selection was cleared.
     */
    it('is greyed rather than removed with nothing selected', () => {
      progression.selectSlot(null);
      settle();

      expect(component.canAdjust).toBeFalse();
      expect(component.suspensions.length).toBe(3);
      expect(component.suspensions.some(choice => choice.current)).toBeFalse();
    });

    it('has no buttons at all in a key that can build no chords', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(component.suspensions).toEqual([]);
    });
  });

  /**
   * The Tensions control: one row per extension the chord actually has, with
   * the alteration it is *sounding* marked.
   *
   * The marked value is read off `effectiveChord` and never off the stored
   * field, for the reason `ChordOption.current` gives one row up: a fresh slot
   * stores `null` in all three, meaning "as the key gives it", so a row that
   * compared the stored field would mark nothing at all on the chord a user has
   * just raised to a ninth - even though one of the three buttons is the note
   * that is playing.
   */
  describe('the tensions control', () => {
    beforeEach(() => {
      component.addChord(component.chords[4]);
      settle();
    });

    /** `extent` is the single height control, so a triad has no tension to alter. */
    it('offers nothing on a triad or a seventh', () => {
      expect(component.tensions).toEqual([]);

      component.stepComplexity(1);
      settle();
      expect(component.tensions).toEqual([]);
    });

    /**
     * The V of C major raised to a ninth builds G B D F A: a *natural* ninth,
     * which is what the row marks though the slot stores `null`.
     */
    it('marks the alteration the key gave, not the stored null', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      expect(selectedDegree().extensions.ninth).toBeNull();
      expect(component.tensions.map(row => row.extension)).toEqual(['ninth']);
      expect(tensionRow('ninth').choices.map(choice => choice.label))
        .toEqual(['♭9', '♮9', '♯9']);
      expect(markedTension('ninth')).toBe('♮9');
    });

    /** G B D F A flat, and the row follows it. */
    it('flattens the ninth and pins it', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      component.setTension(tension('ninth', '♭9'));
      settle();

      expect(selectedDegree().extensions)
        .toEqual({ ninth: -1, eleventh: null, thirteenth: null });
      expect(selectedPitchClasses()).toEqual([2, 5, 7, 8, 11]);
      expect(markedTension('ninth')).toBe('♭9');
    });

    /** One row per extension present, and each opens as the extent reaches it. */
    it('adds a row for each extension the chord reaches', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();
      expect(component.tensions.map(row => row.extension)).toEqual(['ninth', 'eleventh']);
      expect(tensionRow('eleventh').choices.map(choice => choice.label))
        .toEqual(['♮11', '♯11']);

      component.stepComplexity(1);
      settle();
      expect(component.tensions.map(row => row.extension))
        .toEqual(['ninth', 'eleventh', 'thirteenth']);
      expect(tensionRow('thirteenth').choices.map(choice => choice.label))
        .toEqual(['♭13', '♮13']);
    });

    /** Imaj13#11 in C major: C E G B D F# A. Only the eleventh moves. */
    it('sharpens the eleventh of a thirteenth chord', () => {
      component.addChord(component.chords[0]);
      for (let press = 0; press < 4; press++) component.stepComplexity(1);
      settle();

      component.setTension(tension('eleventh', '♯11'));
      settle();

      expect(selectedPitchClasses()).toEqual([0, 2, 4, 6, 7, 9, 11]);
      expect(markedTension('eleventh')).toBe('♯11');
      // The other two are still the key's own, and still marked as such.
      expect(markedTension('ninth')).toBe('♮9');
      expect(markedTension('thirteenth')).toBe('♮13');
    });

    /**
     * The one the design doc records as unbuildable before `extensions` existed.
     *
     * `V/vi` in C major is an E7, and the key's own ninth above E is an F - a
     * flat ninth nobody asked for. The row marks the flat ninth the chord really
     * has, and pressing the natural one builds the F sharp that makes it a real
     * E9: E G# B D F#.
     */
    it('marks a flat ninth the key put there, and lets it be raised', () => {
      component.addOption(option(component.secondary, 'V/vi'));
      component.stepComplexity(1);
      settle();

      expect(selectedDegree().extent).toBe(9);
      expect(selectedDegree().extensions.ninth).toBeNull();
      expect(markedTension('ninth')).toBe('♭9');

      component.setTension(tension('ninth', '♮9'));
      settle();

      expect(selectedPitchClasses()).toEqual([2, 4, 6, 8, 11]);
      expect(markedTension('ninth')).toBe('♮9');
    });

    /** A glyph announces as nothing useful, so the label is the word. */
    it('says each figure aloud', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      expect(tensionRow('ninth').choices.map(choice => choice.ariaLabel))
        .toEqual(['flat ninth', 'natural ninth', 'sharp ninth']);
    });

    it('dispatches nothing with nothing selected', () => {
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();
      const choice = tension('ninth', '♭9');
      progression.selectSlot(null);
      settle();
      spyOn(progression, 'setSlotExtension');

      component.setTension(choice);

      expect(progression.setSlotExtension).not.toHaveBeenCalled();
    });
  });

  /**
   * The other half of "the octave ceiling is the chord's, not the model's":
   * the readout says what is *sounding*, and the `+` stepper is disabled with a
   * reason when the chord cannot go higher. A control that silently does nothing
   * is the failure this panel has been fixed for twice, and a per-chord ceiling
   * is exactly the shape that produces one: the document stores 2, the chord
   * sounds at 0, and a `-` stepping from the stored value would write 1 and move
   * nothing.
   */
  describe('the octave a chord is really sounding at', () => {
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
});
