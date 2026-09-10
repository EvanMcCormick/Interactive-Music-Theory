import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ChordPaletteComponent,
  PaletteAlternate,
  PaletteOption
} from './chord-palette.component';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState
} from '../../../../models/progression.model';
import { NamedQuality } from '../../../../services/progression-harmony';

/**
 * What the palette *offers*: the chords in this key, the two rows it can append
 * from, what each button says, and what a click on one adds.
 *
 * **The other half is `chord-palette.component.controls.spec.ts`** - the
 * complexity, octave, sus and tension controls, and the alternates row, which
 * shares their verb rather than the append rows'. That file's header argues
 * where the seam is and why the fixtures below are copied there rather than
 * shared. The split was taken when this file reached the 1000-line cap.
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
   * what that row varies: all sixteen sit on one root.
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
     * The first key here whose seventh degree is not one of the twelve table
     * names, and the reason every key above it agreed with the old rule.
     *
     * C, A minor, G, E flat and B are all keys the two chromatic arrays can
     * spell every degree of, so this row came out identical whether it was
     * spelled from the tables or from the degree's letter - which is why M3
     * could change `buildChords` to `chordRootName` with nothing failing.
     * F♯ major is F♯ G♯ A♯ B C♯ D♯ E♯, and `E♯` is in neither array: the tables
     * gave pitch class 5 as `F` and printed `F°` under a numeral reading
     * `vii°`, a *seventh* degree on the same letter as the tonic.
     */
    it('spells a seventh degree the tables have no name for', () => {
      progression.setKey(6, 'ionian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
      expect(component.chords.map(chord => chord.name))
        .toEqual(['F# Maj', 'G# min', 'A# min', 'B Maj', 'C# Maj', 'D# min', 'E#°']);
    });

    /**
     * The mode this row and the borrowed row beside it used to disagree about.
     *
     * F locrian inherits F♯ major's six sharps - locrian is the seventh degree,
     * so `MODE_OFFSETS.locrian` is 11 and `keySignatureKind` reads the parent as
     * `(5 - 11 + 12) % 12`, which is pitch *class* 6, a semitone above F - and a
     * six-sharp key spelled from the tables prints F F♯ G♯ A♯ B C♯ D♯: six of
     * seven degrees on the wrong letter, and a `II` and a `iii` a semitone
     * apart. The scale is F G♭ A♭ B♭ C♭ D♭ E♭, and the fifth degree is the C
     * flat neither table holds at all.
     *
     * The letters do not move with the signature, which is the whole point: they
     * are counted from the tonic's, one per degree, so a mode whose degrees are
     * nearly all flattened still gets one letter each and takes flats to land
     * them. Its triads are diminished, major, minor, minor, major, major, minor.
     */
    it('spells a mode whose signature disagrees with its own notes', () => {
      progression.setKey(5, 'locrian');
      settle();

      expect(component.chords.map(chord => chord.numeral))
        .toEqual(['i°', 'II', 'iii', 'iv', 'V', 'VI', 'vii']);
      expect(component.chords.map(chord => chord.name))
        .toEqual(['F°', 'Gb Maj', 'Ab min', 'Bb min', 'Cb Maj', 'Db Maj', 'Eb min']);
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

      // Sixteen since M3 Task 4: the twelve triads and sevenths, plus the four
      // added-tone shapes. The row maps `NAMED_QUALITIES`, which is derived from
      // `QUALITY_INTERVALS`, so a shape added to that table joins the row.
      expect(component.alternates.length).toBe(16);
      expect(component.alternates.map(chord => chord.name)).toContain('G Maj');
      expect(component.alternates.map(chord => chord.name)).toContain('G6');
    });

    /**
     * The four added-tone shapes, at the height each of them names.
     *
     * `naturalExtent` reads a shape's height off its own interval count, so a
     * four-note shape is offered at a seventh's - and `G6` is four notes that
     * are not a seventh. A row that had listed its shapes instead of mapping
     * `NAMED_QUALITIES` would have gone on offering twelve; what clicking one
     * does is in `chord-palette.component.controls.spec.ts`.
     */
    it('offers the added-tone shapes at a seventh`s height', () => {
      component.addChord(component.chords[4]);
      settle();

      for (const quality of ['major6', 'minor6', 'add9', 'minorAdd9'] as const) {
        expect(alternate(quality).extent).toBe(7);
      }

      expect(alternate('major6').name).toBe('G6');
      expect(alternate('add9').name).toBe('G add9');
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

    /**
     * The mark means two different things on the two kinds of row, and the
     * labels are where that is said rather than left to be inferred from a
     * ring. On the append rows the button still appends - so "another".
     */
    it('says the append rows would add a second one', () => {
      component.addOption(borrowed('♭VII'));
      settle();

      expect(borrowed('♭VII').label).toBe('Add another B flat major, borrowed chord');
      expect(borrowed('♭VI').label).toBe('Add A flat major, borrowed chord');
    });

    it('says the same of a secondary dominant the slot already holds', () => {
      component.addOption(secondary('V/V'));
      settle();

      expect(secondary('V/V').label).toBe('Add another D dominant seventh, secondary dominant');
      expect(secondary('V/vi').label).toBe('Add E dominant seventh, secondary dominant');
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

    /**
     * The element a press at the middle of this one would actually land on.
     *
     * The **topmost** element and not the topmost *option*, which is the whole
     * point of asking. Task 7's Critical bug was an element drawn on top of the
     * thing a spec reached for by selector; searching the hit list for the first
     * entry inside a `button.option` walks straight down past exactly that -
     * anything overlaying the row is skipped, and the probe reports the button
     * it was hoping to find. `elementsFromPoint` is ordered front to back, so
     * entry zero is what the pointer gets and nothing else is.
     */
    function pressed(button: HTMLElement): HTMLElement {
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      const [topmost] = document.elementsFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      if (!(topmost instanceof HTMLElement)) {
        throw new Error('nothing at the middle of that button');
      }
      return topmost;
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

    /**
     * The alternates row's labels, on the buttons, which is where the spec
     * above could not reach them: it runs with nothing selected, so that
     * section is not on the page at all.
     *
     * They are the row that most needs the check. "down from the 9th" is the
     * only channel through which a user who cannot see the amber chip learns
     * that a shape will shorten the chord, and a label computed but never bound
     * would pass every expectation in "the height an alternate sets".
     *
     * The order is the order the rows are drawn in - the two append rows, then
     * the alternates below the steppers - which is the layout the spec below
     * this one is about.
     */
    it('puts the alternates row`s labels on its buttons too', () => {
      component.addChord(component.chords[4]);
      component.stepComplexity(1);
      component.stepComplexity(1);
      settle();

      const buttons: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.option'));
      const labels = buttons.map(button => button.getAttribute('aria-label'));

      expect(labels).toEqual(
        [...component.borrowed, ...component.secondary, ...component.alternates]
          .map(chord => chord.label)
      );
      expect(labels).toContain('Change to G major, triad, down from the 9th');
    });

    /**
     * The layout bug the alternates row was moved to fix.
     *
     * That row appears and disappears with the selection, and every append
     * *selects*. Drawn above the append rows, clicking Borrowed `♭VII` on an
     * empty progression put a heading, twelve buttons and a paragraph above the
     * row that had just been clicked - some 200px - so the row jumped down
     * under the pointer and a second click aimed at the same place landed on a
     * different chord.
     *
     * The button is captured before the click rather than looked up again
     * after: `trackByKey` keeps the same DOM node, and asking for `♭VII` a
     * second time would find the alternates row's own `♭VII` - sixteen shapes on
     * that root include the major triad - which is a different button.
     *
     * Measured from the panel and not from the viewport. `click()` focuses the
     * button, and a focus scrolls the element into view, so a viewport-relative
     * top moves by however far the runner's page happened to be scrolled - a
     * fact about the harness rather than about the layout. The distance from the
     * top of the panel is the thing the bug was about: what got taller *above*
     * this row.
     */
    it('leaves the append rows where they were when one of them is clicked', () => {
      const panel: HTMLElement = fixture.nativeElement.querySelector('.chord-palette');
      const fromPanelTop = (element: HTMLElement) =>
        element.getBoundingClientRect().top - panel.getBoundingClientRect().top;

      const button = optionButton('♭VII');
      const before = fromPanelTop(button);

      button.click();
      settle();

      expect(component.alternates.length).toBe(16);
      expect(fixture.nativeElement.contains(button)).toBeTrue();
      expect(fromPanelTop(button)).toBe(before);
    });

    /**
     * `aria-current="true"` says "this is the current one *of these*", which is
     * true of a row whose buttons restate the selection and false of one whose
     * buttons all append. With a `♭VII` selected it used to sit on two buttons
     * at once - `Change to B flat major` and `Add B flat major` - so one ring
     * and one ARIA state carried two verbs.
     */
    it('marks the current item on the row that has one, and not on the append rows', () => {
      component.addOption(borrowed('♭VII'));
      settle();

      const marked: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.option[aria-current]'));
      const ringed: HTMLElement[] =
        Array.from(fixture.nativeElement.querySelectorAll('button.option.current'));

      expect(marked.length).toBe(1);
      expect(marked[0].getAttribute('aria-label')).toBe('Pin as B flat major, triad');
      // The ring is still on both: it is a statement about the selection, and
      // the append row says the same thing in words instead of in ARIA.
      expect(ringed.length).toBe(2);
      expect(ringed.map(button => button.getAttribute('aria-label')))
        .toContain('Add another B flat major, borrowed chord');
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
