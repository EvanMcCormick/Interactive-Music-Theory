import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ChordPaletteComponent,
  PaletteAlternate,
  PaletteOption
} from './chord-palette.component';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import { OCTAVE_MAX } from '../../../../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState
} from '../../../../models/progression.model';
import { NamedQuality, effectiveQuality } from '../../../../services/progression-harmony';

/**
 * What the palette offers, what it refuses, and what it dispatches.
 *
 * The DOM is asserted in one place only - that the refusal is actually on
 * screen - and never by shape. `CLAUDE.md` rules out pinning structure, and the
 * circle of fifths' spec makes the same call for the same reason: the contract
 * worth protecting is the one with the service, so these tests call the
 * component's own methods and read the service back, exactly as a click would.
 *
 * The two label tables are not re-tested here. `progression-chord-names.spec.ts`
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

  /**
   * What the selected slot actually sounds, as pitch classes.
   *
   * The half of a borrowed chord a label cannot show. A slot can be stored
   * saying `♭VII` over the notes of the diatonic `VII` - that is precisely what
   * `replaceDocument` would have left behind - so the numeral on the card and
   * the notes under it are two claims, and only this one reaches the synth.
   */
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

  function secondary(numeral: string): PaletteOption {
    return option(component.secondary, numeral);
  }

  /**
   * An alternate by its shape rather than its numeral, because the shape is
   * what that row varies: all twelve sit on one root.
   */
  function alternate(quality: NamedQuality): PaletteAlternate {
    const found = component.alternates.find(candidate => candidate.quality === quality);
    if (found === undefined) throw new Error(`no ${quality} on the alternates row`);
    return found;
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

    /**
     * The first key here with a black note in it, and the reason every key
     * above has only naturals is why this was wrong for so long.
     *
     * E flat major is E♭ F G A♭ B♭ C D. Spelling it from anything but its own
     * signature gives D♯ F G G♯ A♯ C D - five wrong accidentals, printed as
     * fact on a page whose whole job is to teach which chords are in a key.
     */
    it('spells a flat key with flats', () => {
      progression.setKey(3, 'ionian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
      expect(component.chords.map(chord => chord.name))
        .toEqual(['Eb Maj', 'F min', 'G min', 'Ab Maj', 'Bb Maj', 'C min', 'D°']);
    });

    /** And a sharp one with sharps: B major is B C♯ D♯ E F♯ G♯ A♯. */
    it('spells a sharp key with sharps', () => {
      progression.setKey(11, 'ionian');
      settle();

      expect(component.chords.map(chord => chord.name))
        .toEqual(['B Maj', 'C# min', 'D# min', 'E Maj', 'F# Maj', 'G# min', 'A#°']);
    });

    /**
     * `isTonic` is what the template colours the I chord with, and it is a
     * field rather than a style - one button in seven, and it moves with the
     * key rather than with the button's position, because the tonic is degree
     * 0 of whatever mode is selected.
     */
    it('marks the tonic and only the tonic', () => {
      expect(component.chords.map(chord => chord.isTonic))
        .toEqual([true, false, false, false, false, false, false]);

      progression.setKey(9, 'aeolian');
      settle();

      expect(component.chords.map(chord => chord.isTonic))
        .toEqual([true, false, false, false, false, false, false]);
    });

    /**
     * What the buttons say aloud.
     *
     * The visible pair is `vii°` over `B°`, which a screen reader announces as
     * "vii degree sign, B degree sign" - a label naming something that is not a
     * chord. It is precomputed rather than concatenated in the template, both
     * because the project rules keep computation out of templates and because
     * a phrase like this needs writing rather than assembling.
     */
    it('labels each button with something that can be read aloud', () => {
      progression.setKey(3, 'ionian');
      settle();

      expect(component.chords[0].label).toBe('Add E flat major, degree 1');
      expect(component.chords[6].label).toBe('Add D diminished, degree 7');
    });

    it('puts that label on the button rather than the printed name', () => {
      const buttons: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.chord'));

      expect(buttons.length).toBe(7);
      expect(buttons.map(button => button.getAttribute('aria-label')))
        .toEqual(component.chords.map(chord => chord.label));
    });

    /**
     * The spelling belongs to the progression's key, not to the app's.
     *
     * These are two selections and they are allowed to differ - the page
     * shell wires the circle to both, and until then only one of them moves. A
     * palette that asked `MusicTheoryService` how to spell would print E flat
     * major with
     * sharps whenever the fretboard behind it happened to be in one, which is
     * how this page came to show D♯ Maj as the tonic of E♭ major.
     */
    it('ignores the key the fretboard is in', () => {
      const musicTheory = TestBed.inject(MusicTheoryService);
      progression.setKey(3, 'ionian');
      musicTheory.selectKeyAndMode('F#', 'diatonicModes', 'ionian');
      settle();

      expect(component.chords.map(chord => chord.name))
        .toEqual(['Eb Maj', 'F min', 'G min', 'Ab Maj', 'Bb Maj', 'C min', 'D°']);
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

    /**
     * The sentence is measured, not fixed prose.
     *
     * "seven" appears in the sentence whatever the count says, so asserting
     * only that leaves the two numbers it actually reads - the scale it is in
     * and how many notes that scale has - free to be anything at all. A
     * pentatonic scale reported as having six notes is a wrong statement about
     * music on a page whose job is to make true ones.
     */
    it('names the scale it is refusing and counts its notes', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(component.unavailable).toContain('Major Pentatonic');
      expect(component.unavailable).toContain('5 notes');
    });

    it('counts a six-note scale as six', () => {
      progression.setKey(0, 'minorBlues');
      settle();

      expect(component.unavailable).toContain('Minor Blues');
      expect(component.unavailable).toContain('6 notes');
    });

    /**
     * Fix 4's other half. The steppers act on a selected chord and there is
     * none to select, so a panel that kept them would be half grey with the
     * hint that explains grey steppers suppressed - in exactly the state this
     * component works hardest to explain.
     */
    it('shows no controls to explain away', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(fixture.nativeElement.querySelectorAll('button.step').length).toBe(0);
    });

    /**
     * Switching to a pentatonic scale replaces the palette with a sentence, and
     * a screen reader is told nothing at all unless the region announcing it
     * was already on the page.
     */
    it('announces the refusal in a region that was already there', () => {
      const region = fixture.nativeElement.querySelector('[aria-live]');
      expect(region).not.toBeNull();

      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(region.textContent).toContain(component.unavailable ?? '');
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
      expect(effectiveQuality(intervals, 4, 7, 0, null)).toBe('dominant7');
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
   * The three rows below the seven, and the two verbs they are clicked with.
   *
   * `progression-vocabulary.spec.ts` checks every numeral in every seven-note
   * scale the app offers, so this is not that sweep again. What is checked here
   * is the wiring: that the rows reach the screen at all, that a click writes
   * the *whole* triple into a slot, and that the notes under the label move
   * with it - which is the one thing a document route would have got wrong.
   */
  describe('the vocabulary rows', () => {
    /**
     * C major's borrowed row, hand-checked: the parallel minor's ♭III, iv, ♭VI
     * and ♭VII, plus the Neapolitan from the parallel phrygian.
     */
    it('offers the parallel minor and the Neapolitan in a major key', () => {
      expect(component.borrowed.map(chord => chord.numeral))
        .toEqual(['♭II', '♭III', 'iv', '♭VI', '♭VII']);
      expect(component.borrowed.map(chord => chord.name))
        .toEqual(['Db Maj', 'Eb Maj', 'F min', 'Ab Maj', 'Bb Maj']);
    });

    /**
     * The row is in target order - the dominant of the second, then of the
     * third - which is the order of the seven buttons above it rather than an
     * order of usefulness. `V/V` is the fourth of the five, and putting it
     * first would break the correspondence for the sake of one chord.
     */
    it('offers a dominant for every degree the key could tonicise', () => {
      expect(component.secondary.map(chord => chord.numeral))
        .toEqual(['V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi']);
      expect(component.secondary.map(chord => chord.name))
        .toEqual(['A7', 'B7', 'C7', 'D7', 'E7']);
    });

    /**
     * The fix that made a minor key's dominant reachable at all.
     *
     * C minor's diatonic row shows `v`, a G minor triad, and nothing on it is a
     * G major chord. The borrowed row is where harmonic minor supplies one -
     * and the leading-tone triad beside it - so this row is not a smaller
     * version of the major key's but a different one.
     */
    it('gives a minor key the dominant its diatonic row lacks', () => {
      progression.setKey(0, 'aeolian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
      expect(component.borrowed.map(chord => chord.numeral)).toEqual(['♭II', 'V', '♯vii°']);
      expect(component.borrowed.map(chord => chord.name)).toEqual(['Db Maj', 'G Maj', 'B°']);
    });

    // Borrowed chords and secondary dominants do not depend on the selection,
    // which is what lets a user start a progression with one.
    it('offers both append rows before anything is selected', () => {
      expect(currentState().doc.slots).toEqual([]);
      expect(component.borrowed.length).toBe(5);
      expect(component.secondary.length).toBe(5);
    });

    // The alternates row is other shapes on the selected chord, so with nothing
    // selected there is no root for it to sit on.
    it('offers no alternates until a chord is selected', () => {
      expect(component.alternates).toEqual([]);

      component.addChord(component.chords[4]);
      settle();

      expect(component.alternates.length).toBe(12);
      expect(component.alternates.map(chord => chord.name)).toContain('G Maj');
    });

    /**
     * The whole panel refuses together. Borrowed chords are exactly as
     * meaningless in a pentatonic key as diatonic ones, and offering three rows
     * of them beside a paragraph explaining that there are no chords would be
     * the panel contradicting itself.
     */
    it('offers none of the three in a key that can build no chords', () => {
      component.addChord(component.chords[0]);
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(component.alternates).toEqual([]);
      expect(component.borrowed).toEqual([]);
      expect(component.secondary).toEqual([]);
      expect(component.unavailable).not.toBeNull();
    });

    it('offers them again when a heptatonic key comes back', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();
      progression.setKey(0, 'ionian');
      settle();

      expect(component.borrowed.length).toBe(5);
      expect(component.secondary.length).toBe(5);
    });
  });

  /**
   * Which button is lit, which is a claim about the selected chord rather than
   * about the last click.
   */
  describe('marking the chord that is already there', () => {
    /**
     * A fresh slot stores `quality: null` - "as the key gives it" - so a mark
     * that compared the stored field would light nothing on the row a user
     * first opens, even though one of the twelve is the chord that is sounding.
     */
    it('marks the shape a diatonic slot is playing, not its stored null', () => {
      component.addChord(component.chords[4]);
      settle();

      expect(selectedDegree().quality).toBeNull();
      expect(alternate('major').current).toBeTrue();
      expect(component.alternates.filter(chord => chord.current).length).toBe(1);
    });

    /** And it follows the height, because that is what the slot is playing. */
    it('marks the seventh once the slot is raised to one', () => {
      component.addChord(component.chords[4]);
      settle();
      component.stepComplexity(1);
      settle();

      expect(alternate('dominant7').current).toBeTrue();
      expect(alternate('major').current).toBeFalse();
    });

    /**
     * One mark per row, and two rows can carry one.
     *
     * A borrowed chord in a slot *is* a shape on that slot's own root, so it is
     * honestly reachable from two rows at once - and marking one of them and
     * not the other would be picking a winner between two true statements.
     */
    it('marks the same chord in both rows that reach it', () => {
      component.addOption(borrowed('♭VII'));
      settle();

      expect(borrowed('♭VII').current).toBeTrue();
      expect(alternate('major').current).toBeTrue();
      expect(component.borrowed.filter(chord => chord.current).length).toBe(1);
      expect(component.alternates.filter(chord => chord.current).length).toBe(1);
    });

    it('marks nothing at all with nothing selected', () => {
      expect(component.borrowed.some(chord => chord.current)).toBeFalse();
      expect(component.secondary.some(chord => chord.current)).toBeFalse();
    });
  });

  /**
   * The append rows: a borrowed chord and a secondary dominant are chords you
   * *add*, which is the argument the vocabulary's `BORROWINGS` makes for
   * harmonic minor's `V` being on that row at all - a chord you cannot append
   * is a chord this palette does not offer.
   */
  describe('clicking a borrowed chord or a secondary dominant', () => {
    it('appends the whole triple the button names', () => {
      component.addOption(borrowed('♭VII'));
      settle();

      const degree = selectedDegree();
      expect(currentState().doc.slots.length).toBe(1);
      expect([degree.degree, degree.alter, degree.extent]).toEqual([6, -1, 3]);
      expect(degree.quality).toBe('major');
    });

    /**
     * The reason this needed a service method of its own.
     *
     * `appendSlot` takes a degree and nothing else, so ♭VII could only have
     * arrived as the diatonic degree 6 - a B diminished triad under a ♭VII
     * label. Assembling a document instead would have been worse: `settle()`
     * bounds and re-flows but never regenerates, so the notes would have stayed
     * B D F under the new name for as long as the document lived.
     */
    it('sounds B flat major rather than the diatonic chord on that degree', () => {
      component.addOption(borrowed('♭VII'));
      settle();

      expect(selectedPitchClasses()).toEqual([2, 5, 10]);
    });

    /** A secondary dominant arrives at a seventh's height, which names it. */
    it('appends a secondary dominant as a seventh', () => {
      component.addOption(secondary('V/V'));
      settle();

      const degree = selectedDegree();
      expect([degree.degree, degree.alter, degree.extent]).toEqual([1, 0, 7]);
      expect(degree.quality).toBe('dominant7');
      // D F♯ A C: the F♯ is the accidental that makes it a dominant of G
      // rather than the key's own ii7.
      expect(selectedPitchClasses()).toEqual([0, 2, 6, 9]);
    });

    it('adds to the end rather than replacing what is selected', () => {
      component.addChord(component.chords[0]);
      settle();
      component.addOption(borrowed('♭VI'));
      settle();

      const slots = currentState().doc.slots;
      expect(slots.length).toBe(2);
      expect(slots[1].id).toBe(currentState().selectedSlotId ?? '');
    });

    // The row is gone by then, so this is a click that raced a key change - and
    // the service is the thing that has to refuse it, not the empty row.
    it('refuses in a key that can build no chords', () => {
      const flatSeven = borrowed('♭VII');
      progression.setKey(0, 'majorPentatonic');
      settle();
      component.addOption(flatSeven);
      settle();

      expect(currentState().doc.slots).toEqual([]);
    });
  });

  /**
   * The alternates row is the other verb: it re-shapes the chord that is
   * selected rather than adding one, which is the only thing twelve shapes on a
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
     * On a ninth, every one of the twelve is shorter - the triads by two rungs
     * and the sevenths by one - so all twelve are marked and the row says which
     * height is at stake.
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
     * The warning is about something that really happens, including on the
     * button that matches the shape the slot already has: `major` is marked
     * `current` on this ninth and clicking it still takes two notes away.
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
   * The rows on screen, checked through the hit test a pointer does rather than
   * by naming an element with a selector.
   *
   * Task 7 shipped a Critical bug behind a spec that reached for the first
   * element matching a selector while a different one was drawn on top of it.
   * Three new rows of buttons is exactly the change that can put one element
   * over another, so the click below goes to whatever a press at the button's
   * own centre would actually reach.
   */
  describe('on screen', () => {
    /** The option button whose numeral is this one, in any of the three rows. */
    function optionButton(numeral: string): HTMLElement {
      const buttons: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.option'));
      const found = buttons.find(
        button => button.querySelector('.numeral')?.textContent?.trim() === numeral
      );
      if (!found) throw new Error(`no option button for ${numeral}`);
      return found;
    }

    /** The element a press at the middle of this one would actually land on. */
    function pressed(button: HTMLElement): HTMLElement {
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      const hit = document
        .elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        .find(candidate => candidate.closest('button.option') !== null);
      if (!(hit instanceof HTMLElement)) {
        throw new Error('nothing clickable at the middle of that button');
      }
      return hit;
    }

    it('draws every option as a button of its own', () => {
      component.addChord(component.chords[4]);
      settle();

      expect(fixture.nativeElement.querySelectorAll('button.option').length)
        .toBe(component.alternates.length + component.borrowed.length + component.secondary.length);
    });

    it('appends the chord a press at that button would reach', () => {
      const button = optionButton('♭VII');
      expect(pressed(button).closest('button.option')).toBe(button);

      pressed(button).click();
      settle();

      expect(selectedDegree().alter).toBe(-1);
      expect(selectedPitchClasses()).toEqual([2, 5, 10]);
    });

    it('retunes the selected slot from a press on an alternate', () => {
      component.addChord(component.chords[4]);
      settle();

      const button = optionButton('v');
      expect(pressed(button).closest('button.option')).toBe(button);

      pressed(button).click();
      settle();

      expect(currentState().doc.slots.length).toBe(1);
      expect(selectedDegree().quality).toBe('minor');
    });

    it('puts a spoken label on each of them', () => {
      const buttons: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.option'));

      expect(buttons.map(button => button.getAttribute('aria-label')))
        .toEqual([...component.borrowed, ...component.secondary].map(chord => chord.label));
    });

    it('draws no option rows at all in a key that can build none', () => {
      progression.setKey(0, 'majorPentatonic');
      settle();

      expect(fixture.nativeElement.querySelectorAll('button.option').length).toBe(0);
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
