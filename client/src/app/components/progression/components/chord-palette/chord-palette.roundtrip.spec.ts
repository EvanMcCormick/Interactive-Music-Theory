import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordPaletteComponent, PaletteAlternate } from './chord-palette.component';
import { describeSlot } from '../progression-strip/progression-strip-cards';
import {
  ChordDegree,
  ChordSlot,
  ExtensionAlterations,
  ProgressionKey,
  ProgressionState,
  SuspensionKind,
  createDegreeSlot
} from '../../../../models/progression.model';
import { createExtensions, normalizeChordSlot } from '../../../../models/progression-normalize';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ChordExtent, isHeptatonic } from '../../../../services/progression-harmony';
import { ProgressionKeyContext } from '../../../../services/progression-key-context';
import { ProgressionService } from '../../../../services/progression.service';
import { chosen } from '../../../../services/progression-degree-editor';
import { ChordOption, chordVocabulary } from '../../../../services/progression-vocabulary';

/**
 * The one property every button in this palette is supposed to have: **the name
 * it prints is the name of the chord pressing it builds**.
 *
 * ## The bug this closes, and why it is a sweep rather than a fixture
 *
 * `progression-vocabulary.ts` names each option over `optionDegree`, which
 * carries no suspension and no pinned extension, and asserted in its docstring
 * that this "is also what makes the name it prints the name of the chord the
 * button will actually build". That was true of the two rows that **append** -
 * a fresh slot carries neither - and false of the alternates row, which
 * **retunes** the selected slot through `chosen()`, and `chosen` kept both.
 *
 * Three clicks from a fresh slot in B♭ major reached it. Select the `I`, press
 * Sus → sus4, and press the button reading `i°` / `Bb°` whose label announces
 * *Change to B flat diminished, triad*: the stored degree came back
 * `quality: 'diminished', suspension: 'sus4'`, the chord built B♭-E♭-F♭, and
 * the card read `I?` / `Bb?` - the app's refusal to name a chord, produced by a
 * button that had just promised a name. `SUSPENDED_FIGURES` holds six bases, so
 * ten of the sixteen shapes on that row had no printable name over a suspended
 * slot and the row would have printed `?` on all ten had it been asked.
 *
 * A fixture for that one chord would have pinned the instance. The **class** is
 * that `ChordDegree` has fields the namer does not see, so the next one added
 * drifts the same way, silently, in whichever row does not append. So this file
 * asserts the round trip over the whole reachable grid instead: take every
 * option `chordVocabulary` offers, build what pressing it builds, and ask
 * `describeSlot` - the strip card's own namer, the thing the user reads the
 * answer off - to name it.
 *
 * ## Why the vocabulary's option is the button
 *
 * `ChordPaletteComponent.buildOption` copies `numeral` and `name` from a
 * `ChordOption` into a `PaletteOption` verbatim and hands that same object to
 * `ProgressionService`, so there is no layer between the two that could change
 * either string; `chord-palette.component.spec.ts` pins the rendering of both
 * onto the page. Sweeping the vocabulary is therefore sweeping the buttons, and
 * it is what makes the grid below affordable - a `TestBed` per key would not be.
 *
 * The last `describe` closes that gap from the other end, on the fixture the bug
 * was found in: it drives the real component and the real service, presses every
 * button on the row, and reads the card.
 */
describe('what the palette prints and what it builds', () => {
  let service: MusicTheoryService;
  let keys: ProgressionKeyContext;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MusicTheoryService);
    keys = new ProgressionKeyContext(service);
  });

  // ---------------------------------------------------------------------------
  // The grid
  // ---------------------------------------------------------------------------

  /**
   * Every seven-note scale the app offers, with the id beside the intervals.
   *
   * The id because a key carries one and `spellingFor` reads it: a key built
   * with a made-up id has no signature and would be spelled by a default rather
   * than by the rule the palette actually runs under.
   */
  function heptatonicScales(): { id: string; intervals: readonly number[] }[] {
    const found: { id: string; intervals: readonly number[] }[] = [];
    for (const category of service.getScaleCategories()) {
      for (const scale of category.scales) {
        if (isHeptatonic(scale.intervals)) {
          found.push({ id: scale.id, intervals: scale.intervals });
        }
      }
    }
    return found;
  }

  /** A key as `ProgressionService.setKey` builds one, signature and all. */
  function keyFor(tonic: number, scaleId: string): ProgressionKey {
    const scale = keys.findScale(scaleId);
    return { tonic, scaleId, preferSharps: keys.spellingFor(tonic, scaleId, scale, true) };
  }

  /**
   * A selected slot, in whatever state the sweep wants it in.
   *
   * `extent` moves with the alteration because the two are coupled in the model:
   * `chordPitchClasses` skips an extension the stack does not reach, so a pinned
   * ♭13 on a triad is stored, sounds nothing, and would make this sweep pass on
   * a slot the user cannot hear. Pinning one means standing the slot up to where
   * it is audible.
   */
  function selection(
    degree: number,
    state: AlterationState,
    quality: ChordDegree['quality'] = null
  ): ChordDegree {
    return {
      degree,
      alter: 0,
      extent: state.extent,
      quality,
      inversion: 0,
      suspension: state.suspension,
      extensions: state.extensions,
      octave: 0
    };
  }

  /** One way a slot can be altered away from the plain stack its degree gives. */
  interface AlterationState {
    name: string;
    suspension: SuspensionKind;
    extensions: ExtensionAlterations;
    extent: ChordExtent;
  }

  /**
   * The states a slot can be in that `chosen()` clears, plus the one it cannot.
   *
   * Seven, and every one of them reachable from the palette in two clicks: the
   * Sus control writes the first three and the Tensions control the next three,
   * with the last a slot carrying both at once. They are here because they are
   * exactly the fields the namer does not see, which is the whole of the defect
   * this file exists to close.
   *
   * The alterations are the ones `progression.model.ts` lets a user pin - a ♭9,
   * a ♯11, a ♭13 - rather than the naturals, because a natural pin and no pin at
   * all build the same notes in most keys and so would test very little.
   */
  const ALTERATION_STATES: readonly AlterationState[] = [
    { name: 'plain', suspension: 'none', extensions: createExtensions(), extent: 3 },
    { name: 'sus2', suspension: 'sus2', extensions: createExtensions(), extent: 3 },
    { name: 'sus4', suspension: 'sus4', extensions: createExtensions(), extent: 3 },
    {
      name: 'flat ninth',
      suspension: 'none',
      extensions: { ...createExtensions(), ninth: -1 },
      extent: 9
    },
    {
      name: 'sharp eleventh',
      suspension: 'none',
      extensions: { ...createExtensions(), eleventh: 1 },
      extent: 11
    },
    {
      name: 'flat thirteenth',
      suspension: 'none',
      extensions: { ...createExtensions(), thirteenth: -1 },
      extent: 13
    },
    {
      name: 'sus4 over a flat ninth',
      suspension: 'sus4',
      extensions: { ...createExtensions(), ninth: -1 },
      extent: 9
    }
  ];

  // ---------------------------------------------------------------------------
  // The round trip
  // ---------------------------------------------------------------------------

  /**
   * The degree pressing one button stores, by the route that button is actually
   * dispatched through.
   *
   * The two routes differ only in what `chosen()` is handed. `addOption` runs it
   * over a fresh `createDegreeSlot`; `chooseAlternate` runs it over the selected
   * slot. Both then hand the result to `normalizeChordSlot`, which is the last
   * thing that can move a value before the document holds it - an `alter` past
   * the storable range would be clamped there, and a button whose chord had been
   * quietly retuned on the way in is the failure `borrowed()`'s own guard names.
   *
   * Naming the route rather than collapsing the two is the point: the whole
   * defect was one route carrying fields the other could not, so a helper that
   * assumed they agreed would assume away the thing under test.
   */
  function built(option: ChordOption, selected: ChordDegree): ChordDegree {
    const base =
      option.group === 'alternate'
        ? selected
        : degreeOf(createDegreeSlot(option.degree, 0));

    return degreeOf(
      normalizeChordSlot({
        ...createDegreeSlot(option.degree, 0),
        harmony: { kind: 'degree', degree: chosen(base, option) }
      })
    );
  }

  /** A degree slot's degree. The narrowing `SlotHarmony` needs, not a doubt. */
  function degreeOf(slot: ChordSlot): ChordDegree {
    if (slot.harmony.kind !== 'degree') throw new Error('createDegreeSlot made a literal slot');
    return slot.harmony.degree;
  }

  /**
   * Every option in one key whose printed text is not the printed text of the
   * chord pressing it builds, described so a failure reads as a chord.
   *
   * All three writings are compared, not only the two on the button's face. The
   * spoken one is what the `aria-label` is assembled from, and the reported bug
   * announced *Change to B flat diminished* on a press that built a chord with
   * no name at all - so a sweep that checked the glyphs and not the words would
   * have left the screen-reader half of the same failure open.
   *
   * ## The one writing a secondary dominant is exempt from, and why
   *
   * Its **numeral**, which is a slash numeral by design: `romanNumeral` is asked
   * for `V/vi` there and for `III7` on the card, and those are two true
   * statements about one chord rather than a disagreement - a slash says what a
   * chord *points at* and a plain numeral says where it *sits*. The palette's
   * own docstring rules on the pair being on screen together and keeps both.
   *
   * The exemption is exactly one field wide. The **name** and the **spoken**
   * form are compared on that row like every other, and they are what carries
   * the whole of this file's claim there: `D7` on the button has to be `D7` on
   * the card. A round trip that skipped the row altogether would leave a third
   * of the palette unswept.
   */
  function disagreements(
    scale: { id: string; intervals: readonly number[] },
    tonic: number,
    state: AlterationState,
    quality: ChordDegree['quality'] = null
  ): string[] {
    const key = keyFor(tonic, scale.id);
    const wrong: string[] = [];

    for (let degree = 0; degree <= 6; degree++) {
      const selected = selection(degree, state, quality);

      for (const option of everyOption(scale.intervals, key, selected)) {
        const card = describeSlot(
          { kind: 'degree', degree: built(option, selected) },
          key,
          scale.intervals
        );
        const numeralAgrees = option.group === 'secondary' || card.numeral === option.numeral;

        if (numeralAgrees && card.name === option.name && card.subject === option.spoken) {
          continue;
        }

        wrong.push(
          `${scale.id} on ${tonic}, degree ${degree} ${state.name}: ` +
            `${option.group} button printed ${option.numeral} / ${option.name} / ` +
            `"${option.spoken}" and built ${card.numeral} / ${card.name} / ` +
            `"${card.subject}"`
        );
      }
    }

    return wrong;
  }

  function everyOption(
    intervals: readonly number[],
    key: ProgressionKey,
    selected: ChordDegree
  ): ChordOption[] {
    const vocabulary = chordVocabulary(key, intervals, selected);
    return [...vocabulary.alternates, ...vocabulary.borrowed, ...vocabulary.secondary];
  }

  // ---------------------------------------------------------------------------
  // The sweeps
  // ---------------------------------------------------------------------------

  /**
   * Every button, in every key, on every degree - with the slot in the state a
   * fresh one is in.
   *
   * The base case, and the one that already held: nothing here is suspended and
   * nothing is pinned, so `optionDegree`'s fields and the slot's are the same
   * fields and the name could not have disagreed. It is swept anyway because it
   * is what the *append* rows always build - `createDegreeSlot` carries exactly
   * this state - so this is those two rows' whole claim, at full scope.
   */
  it('prints the chord every button builds, over every scale, key and degree', () => {
    const wrong: string[] = [];

    for (const scale of heptatonicScales()) {
      for (let tonic = 0; tonic < 12; tonic++) {
        wrong.push(...disagreements(scale, tonic, ALTERATION_STATES[0]));
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * And with the slot suspended, or pinned, or both - which is where it broke.
   *
   * **Two keys rather than twelve**, and that is exhaustive rather than partial
   * because of an argument. What a key decides here is the *root's spelling*,
   * and both sides of the comparison spell it with the same call to
   * `chordRootName` over the same `degree` and `alter` - the option's - so the
   * root string is equal by construction on every key and cannot be what breaks.
   * What a suspension and a pin move is the **figure**, which is composed from
   * the identity `effectiveChord` reads off the built stack and depends on the
   * scale and the degree, both of which are swept in full.
   *
   * The two are C, where the app starts, and B♭, which is the key the bug was
   * reported in and a flat key deep enough to reach a `C♭` root. Sweeping all
   * twelve would multiply the grid by six for a string that is already known
   * equal; the test above sweeps them, so a spelling that broke for every state
   * at once would still be caught.
   */
  it('prints the chord every button builds on a slot that is suspended or pinned', () => {
    const wrong: string[] = [];

    for (const scale of heptatonicScales()) {
      for (const tonic of [0, 10]) {
        for (const state of ALTERATION_STATES.slice(1)) {
          wrong.push(...disagreements(scale, tonic, state));
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * The same, over a slot whose shape is already an override rather than the
   * key's own.
   *
   * A second click on this row lands here, and so does every click after a
   * borrowed chord has been appended and selected: `quality` is then a stored
   * `NamedQuality` rather than `null`, which is a different branch of
   * `chordPitchClasses` and a different branch of `effectiveChord`. The
   * alternates row is the only group that reads the selection, so this is that
   * row's second half.
   */
  it('prints the chord every button builds on a slot whose shape is pinned', () => {
    const wrong: string[] = [];

    for (const scale of heptatonicScales()) {
      for (const state of ALTERATION_STATES) {
        wrong.push(...disagreements(scale, 0, state, 'dominant7'));
      }
    }

    expect(wrong).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // And the same property through the component that draws the buttons
  // ---------------------------------------------------------------------------

  /**
   * The round trip once more, end to end: the real component, the real service,
   * every button on the row pressed, and the card read afterwards.
   *
   * The sweeps above are the class and this is the *mechanism* - it is the only
   * place the claim "the vocabulary's option is the button" is checked rather
   * than argued, and it is run on the fixture the bug was reported on. One key
   * and one slot, because what it adds is the wiring: `buildOption`'s copy,
   * `chooseAlternate`'s dispatch, `setSlotChord`'s funnel and the document that
   * comes out the far end.
   */
  describe('through the palette itself', () => {
    let fixture: ComponentFixture<ChordPaletteComponent>;
    let component: ChordPaletteComponent;
    let progression: ProgressionService;
    let state: ProgressionState;

    beforeEach(() => {
      fixture = TestBed.createComponent(ChordPaletteComponent);
      component = fixture.componentInstance;
      progression = TestBed.inject(ProgressionService);
      progression.getState().subscribe(published => (state = published));
      fixture.detectChanges();
    });

    function settle(): void {
      fixture.detectChanges();
    }

    /** What the strip would print for the one slot in the document. */
    function card(): { numeral: string; name: string } {
      const slot = state.doc.slots[0];
      const intervals = state.canBuildChords && state.keyScale ? state.keyScale.intervals : null;
      return describeSlot(slot.harmony, state.doc.key, intervals);
    }

    /**
     * One tonic slot standing on a sus4, whatever was there before.
     *
     * The three clicks the bug was found in - append `I`, press Sus → sus4 - and
     * the row above is then naming shapes over a chord that is no longer a plain
     * triad. It empties the strip first rather than undoing its way back,
     * because the number of undo entries a press records is exactly what this
     * file is testing: a loop that stepped back by a count it had assumed would
     * be asserting against its own assumption.
     */
    function suspendedTonic(): void {
      for (const slot of [...state.doc.slots]) progression.removeSlot(slot.id);
      component.addChord(component.chords[0]);
      settle();
      progression.setSlotSuspension(state.doc.slots[0].id, 'sus4');
      settle();
    }

    it('builds the chord the button printed, on every button of the row', () => {
      const wrong: string[] = [];

      suspendedTonic();
      const row: PaletteAlternate[] = [...component.alternates];

      for (const option of row) {
        suspendedTonic();
        component.chooseAlternate(option);
        settle();

        const built = card();
        if (built.numeral === option.numeral && built.name === option.name) continue;

        wrong.push(
          `${option.numeral} / ${option.name} built ${built.numeral} / ${built.name}`
        );
      }

      expect(wrong).toEqual([]);
    });

    /**
     * And the press that reaches the far end of the funnel really does take the
     * suspension with it, rather than the two happening to agree because neither
     * moved. The button reading `i°` is the one the bug was reported on.
     */
    it('clears the suspension the shape was chosen over', () => {
      suspendedTonic();
      const diminished = component.alternates.find(option => option.quality === 'diminished');
      if (diminished === undefined) throw new Error('no diminished shape on the row');

      component.chooseAlternate(diminished);
      settle();

      const slot = state.doc.slots[0];
      if (slot.harmony.kind !== 'degree') throw new Error('the slot lost its degree');
      expect(slot.harmony.degree.quality).toBe('diminished');
      expect(slot.harmony.degree.suspension).toBe('none');
      expect(card().name).toBe('C°');
    });

    /**
     * The other half `chosen()` clears, and the half that had no way of being
     * seen: a pinned ♭9 sounds nothing at a triad's height, so a row that kept
     * it looked as though the click had worked and handed the pin back the next
     * time the complexity control reached a ninth.
     */
    it('clears a pinned extension the shape was chosen over', () => {
      component.addChord(component.chords[4]);
      settle();
      const id = state.doc.slots[0].id;
      progression.stepSlotExtent(id, 2);
      progression.setSlotExtension(id, 'ninth', -1);
      settle();

      const minor = component.alternates.find(option => option.quality === 'minor');
      if (minor === undefined) throw new Error('no minor shape on the row');
      component.chooseAlternate(minor);
      settle();

      const slot = state.doc.slots[0];
      if (slot.harmony.kind !== 'degree') throw new Error('the slot lost its degree');
      expect(slot.harmony.degree.extensions.ninth).toBeNull();

      // And it stays gone when the height that would sound it comes back.
      progression.stepSlotExtent(slot.id, 2);
      settle();
      expect(card().name).toBe('G min9');
    });

    /**
     * The verb on the marked button follows the same rule. "Pin as" is for the
     * press whose whole effect is the pin; over a suspended slot the press also
     * takes the suspension, so it is a change and says so.
     */
    it('says "Change to" on the marked button when there is an alteration to clear', () => {
      component.addChord(component.chords[0]);
      settle();
      const marked = () => component.alternates.find(option => option.current);
      expect(marked()?.label).toBe('Pin as C major, triad');

      progression.setSlotSuspension(state.doc.slots[0].id, 'sus4');
      settle();
      expect(marked()?.label).toBe('Change to C major, triad');
    });
  });
});
