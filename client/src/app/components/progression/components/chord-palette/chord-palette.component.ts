import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { Scale } from '../../../../models/music-theory.model';
import {
  ChordDegree,
  ProgressionKey,
  ProgressionState
} from '../../../../models/progression.model';
import { ChordChoice, ProgressionService } from '../../../../services/progression.service';
import {
  SuspensionChoice,
  TensionChoice,
  TensionRow,
  buildOctaveView,
  buildSuspensions,
  buildTensions
} from './chord-palette-controls-view';
import {
  EXTENT_LABELS,
  PALETTE_ALTER,
  addVerb,
  buildOption,
  paletteDegree,
  shapeVerb,
  warnAboutHeight
} from './chord-palette-options-view';
import {
  chordName,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-chord-names';
import { effectiveChord } from '../../../../services/progression-harmony';
import { chordRootName } from '../../../../services/progression-spelling';
import { ChordOption, chordVocabulary } from '../../../../services/progression-vocabulary';

/** One button: where the chord sits in the key, and what it is called there. */
export interface PaletteChord {
  /** 0-6, the domain `appendSlot` takes. */
  degree: number;
  numeral: string;
  name: string;
  /**
   * What the button says aloud, built here rather than in the template.
   *
   * Two reasons, and the second is the one that matters. A concatenation in an
   * `[attr.aria-label]` binding is re-evaluated on every change-detection pass,
   * which the project rules single out; and the visible pair - `vii°` over `B°`
   * - announces as "vii degree sign, B degree sign", so it needs writing rather
   * than assembling. See `spokenChordName`.
   */
  label: string;
  /** The I chord, which takes the root colour the fretboard gives the root. */
  isTonic: boolean;
}

/**
 * One button in the three rows below the seven: what it stores, and what it
 * says.
 *
 * It extends `ChordChoice`, so the object the template hands back on a click is
 * the object the service takes - no adapter, and no chance of a button that
 * prints one chord and dispatches another. The service copies the four fields
 * it reads and ignores the rest; `chosen()` there says why that is a guard.
 *
 * It is a copy of `ChordOption` rather than the option itself for the reason
 * `PaletteChord` is a view model at all: the fields a template binds are the
 * fields the component has decided to draw, and `spoken` and `group` are
 * neither drawn nor dispatched - they are the inputs to `label` and to which
 * row this ended up in.
 */
export interface PaletteOption extends ChordChoice {
  numeral: string;
  name: string;
  /** What the button says aloud. See `PaletteChord.label`, which argues it. */
  label: string;
  /**
   * Whether the selected slot already holds this chord.
   *
   * Copied from `ChordOption.current` and never recomputed here: the comparison
   * is not the obvious one - a fresh slot's `quality` is `null` - and that
   * docstring is where it is argued.
   */
  current: boolean;
  /** Identity for `trackBy`. Unique within a row; see `optionKey`. */
  key: string;
}

/**
 * An alternates-row button, which also states the height it will set.
 *
 * The other two rows append, so what they build is a fresh slot at the shape's
 * own height and there is nothing for a user to lose. This row retunes the slot
 * that is selected, and every shape is offered at *its* height rather than at
 * the slot's - so choosing one moves the height too, and on a ninth that is two
 * notes gone. These two fields are how the panel says so before the click
 * rather than after it.
 */
export interface PaletteAlternate extends PaletteOption {
  /** `Triad`, `7th` - the rung this shape stands on. */
  heightLabel: string;
  /** Whether that rung is *below* the one the selected slot is on. */
  lowersHeight: boolean;
}

/** The readout when there is nothing selected for the controls to describe. */
const NOTHING_SELECTED = '—';

/**
 * The paragraph that says why every control on the panel is grey.
 *
 * An id rather than a repeated sentence: `aria-describedby` points the dead
 * controls at the one the page already draws, so the reason a screen reader
 * gives and the reason a sighted user reads cannot come apart. The template
 * carries the matching `id`.
 */
const ADJUST_HINT_ID = 'palette-adjust-hint';

/** The paragraph that says which of the two octave limits the `+` has hit. */
const OCTAVE_LIMIT_HINT_ID = 'palette-octave-limit';

/**
 * The alternates heading when no button on the row names what the slot builds.
 *
 * Reachable, and it is the case `ChordOption.current` describes: a stack that
 * fits no name resolves to `'other'`, which no option carries, so nothing is
 * marked and there is no chord for the heading to name. It says which row it is
 * rather than naming a chord wrongly, on the strip card's rule for the same
 * situation - unlabelled rather than mislabelled.
 */
const ALTERNATES_UNNAMED = 'Other shapes on the selected chord';

/**
 * The diatonic chords of the current key, as seven buttons.
 *
 * ## Two sibling modules hold the parts that are not about state
 *
 * `chord-palette-controls-view.ts` builds the octave, sus and tension controls;
 * `chord-palette-options-view.ts` builds a chord button - the degree one stands
 * for, the verb and label it says aloud, its `trackBy` identity, and the
 * sentence under the alternates row. Both are pure, both were free functions
 * below this class first, and each split is what put this file back under the
 * project's file-length cap. Their headers argue the seam; what is left here is
 * everything that needs the *state*, which is the subscription, the fields it
 * writes and the dispatch back.
 *
 * ## It holds no state of its own
 *
 * Everything on screen is derived from `ProgressionService`'s state and rebuilt
 * when that state changes, the way the circle of fifths derives its highlight
 * from `MusicTheoryService`. The fields below are a cached rendering of that
 * state and not a second copy of it: nothing here is written except by
 * `render`, and every button dispatches straight back to the service.
 *
 * ## One source, and why that is the fix rather than the simplification
 *
 * Everything on this page - the numerals, the names and their *spelling* - is a
 * property of the progression's key, so `ProgressionService` is the only thing
 * it subscribes to. It used to combine `MusicTheoryService.getState()` as well,
 * so that a name was spelled the way the fretboard behind it spells the same
 * note; that was wrong, not merely redundant. The fretboard has a key of its
 * own, the two are allowed to differ, and asking the app-wide rule printed
 * `D♯ Maj` as the tonic chord of E flat major. `key.preferSharps` is the key's
 * own answer and is derived from its signature - see `ProgressionService`'s
 * `spellingFor` - so this page is right on its own terms rather than only while
 * two services happen to agree. `MusicTheoryService` was still injected after
 * that, for `spellNote`; M3 took the injection out altogether. A root is now
 * spelled on the letter its own degree names, by `progression-spelling.ts`,
 * which needs the key and the degree and nothing app-wide at all - so the last
 * reason this component had to know the app's spelling rule existed is gone.
 *
 * ## The guard, and the scale behind it
 *
 * `state.canBuildChords` decides whether there are chords to offer and
 * `state.keyScale` is the scale it was decided on. Both are read rather than
 * recomputed: `canBuildChords` is `isHeptatonic` already applied, so reading it
 * makes "the palette will offer this" and "the service will accept it" one
 * answer instead of two that can drift, and `keyScale` is the same resolution
 * of `scaleId` the service already performs to regenerate a slot. The loop that
 * resolved it lived here too, character for character, until the state carried
 * it.
 *
 * It refuses the whole panel and not only the seven. Borrowed chords are
 * exactly as meaningless in a pentatonic key as diatonic ones, and three rows
 * of them beside a paragraph explaining that this key has no chords would be
 * the panel contradicting itself. `chordVocabulary` answers with three empty
 * groups on the same scale, so the two agree by construction.
 *
 * ## The three rows below, and the two verbs they are clicked with
 *
 * `chordVocabulary` derives them - other shapes on the selected chord, chords
 * borrowed from the parallel modes, and the dominant of every degree the key
 * could tonicise. What it cannot decide, because it is pure and sees no page,
 * is what a click does. This component decides, and it is **not** one answer
 * for all three:
 *
 *  - **Borrowed and secondary append**, as the seven above them do. That is the
 *    argument `BORROWINGS` makes for harmonic minor's `V` being on that row at
 *    all: a chord you cannot append is a chord this palette does not offer, and
 *    the reason a minor key needs `V` is that the `v` it would otherwise have to
 *    re-shape is the chord you did not want. Retuning the selection instead
 *    would mean a borrowed chord could only ever *replace* one, which is the
 *    limit that row exists to lift.
 *  - **Alternates retune the selected slot.** The row is defined by the
 *    selection - every named shape on the root the selected chord already sits on -
 *    and it disappears without one. Appending from it would put a second chord
 *    on the same root at the end of the progression, which is not what "other
 *    shapes on this chord" can mean.
 *
 * The vocabulary's `ChordOption.current` docstring assumes a single verb, and
 * says of the chord that appears in two rows at once that "clicking either does
 * the same thing". Under the split above it does not: with a `♭VI` selected,
 * the alternates row's `major` re-shapes it and the borrowed `♭VI` adds another.
 * **Both are still marked**, which is the conclusion that mattered, on a reason
 * the pure layer could not have: each row is telling the truth about the
 * selection from where it stands - "this is the shape you are on" and "the
 * chord you are on is the Neapolitan" - and suppressing either would be hiding
 * a true statement to protect a symmetry the page does not have.
 *
 * The mark and the `aria-current` that carried it used to be one thing, and are
 * now two. `aria-current="true"` means "this is the current one *of these*",
 * which is true of the alternates row - the button restates the shape the slot
 * has - and false of a row whose buttons all append: with a `♭VII` selected, an
 * `Add B flat major` button announcing itself as the current item is a state
 * and a verb contradicting each other. So the append rows keep the ring, which
 * is a statement about the selection, and say the same thing in words instead -
 * `Add another B flat major` - which is what the button will actually do.
 *
 * ## Where the rows sit, which is decided by the verb and not by the source
 *
 * All three come out of `chordVocabulary`, and grouping them by that is what
 * this panel did until it bit. The two append rows are drawn under the seven
 * they behave like; the alternates row is drawn **below the complexity and
 * octave steppers**, with which it shares both its verb and its subject - all
 * three change the chord that is selected, and none of them adds one.
 *
 * That is not only tidiness. The alternates row appears and disappears with the
 * selection, so drawn above the append rows it moved them: clicking Borrowed
 * `♭VII` on an empty progression appends *and selects*, a row of buttons and a
 * heading materialise above the row that was just clicked, and the second click
 * of a pair aimed at the same place lands on a different chord. Below the
 * steppers it appears in the space the "pick a chord in the strip" hint gives
 * up, and nothing above it moves.
 *
 * It also fixes what the heading could not say from up there. `Other shapes`
 * over a row that acts on the selection, with the selection shown in a strip
 * somewhere else, left "which chord?" to be inferred; the heading names it -
 * `Other shapes on V (G Maj)` - so re-pointing the row at a newly appended
 * chord is visible rather than silent.
 *
 * ## Two orderings and a coincidence, all three deliberately left alone
 *
 * `secondary` arrives ordered by the degree each dominant tonicises, so `V/V`
 * is the fourth of five rather than the first. It is left there: the row then
 * runs in the same degree order as the seven buttons directly above it, and
 * leading with the most-used chord would trade that correspondence for one
 * chord's convenience. The borrowed row is in `BORROWINGS` order, which is the
 * same degree order for the same reason.
 *
 * A secondary dominant can also *be* a chord the key already has - G mixolydian's
 * `V/IV` is a G7, which is that key's own `I7`. Nothing is said about it in the
 * UI, and the two labels are the reason: a numeral says where a chord sits and a
 * slash numeral says what it points at, so `V/IV` and `I7` are two true
 * descriptions of one chord rather than a contradiction to explain. Nor are the
 * two ever on screen together - the diatonic row is triads, so it prints `I`
 * over `G Maj` while the secondary row prints `V/IV` over `G7`.
 *
 * **The mark reaches further than the names do**, and that argument does not
 * cover it. Step the tonic of G mixolydian up one rung of complexity and the
 * strip card reads `I7` while `V/IV` lights up under "Secondary dominants" -
 * two clicks from a shipped mode's default, and the numerals are then beside
 * each other after all. It is left as it is, because the mark is a statement
 * about the *chord* rather than about the numeral: this slot holds the chord
 * that button offers, which is true, and it is what tells a user that clicking
 * would add a second one. Suppressing it on this row would trade a true
 * statement for the appearance of consistency, and would suppress it in every
 * key where the two numerals are genuinely different chords, which is most of
 * them.
 */
@Component({
  selector: 'app-chord-palette',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chord-palette.component.html',
  styleUrls: ['./chord-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChordPaletteComponent implements OnInit, OnDestroy {
  /** The seven buttons, or empty when the key can build no chords. */
  chords: readonly PaletteChord[] = [];

  /** Every named shape on the selected chord's root. Empty with no selection. */
  alternates: readonly PaletteAlternate[] = [];

  /**
   * The alternates row's heading, which names the shape the row acts on.
   *
   * `Other shapes on V (G Maj)`. The row is the one part of this panel that
   * changes a chord rather than adding one, and every append re-points it at
   * whatever was just appended - so a heading that did not name its subject
   * left the row's buttons standing still while their meaning moved.
   *
   * The *shape* rather than the whole chord, which are the same thing until a
   * slot carries a suspension or a pinned tension and differ by exactly what a
   * click here discards. `nameAlternates` argues it.
   */
  alternatesTitle = ALTERNATES_UNNAMED;

  /**
   * The same heading as a phrase that can be read aloud, for the section's
   * `aria-label`.
   *
   * Two fields rather than one because a numeral is not a word: `V (G Maj)`
   * announces as "vee, gee maj", so the spoken form gives the chord's name and
   * drops the numeral, exactly as every button's label on this page does.
   */
  alternatesLabel = ALTERNATES_UNNAMED;

  /** Chords from the parallel modes this key does not have of its own. */
  borrowed: readonly PaletteOption[] = [];

  /** The dominant seventh of every degree this key could tonicise. */
  secondary: readonly PaletteOption[] = [];

  /**
   * What choosing an alternate would cost, or null when it would cost nothing.
   *
   * The one thing about this panel a user could not otherwise find out before
   * clicking: every shape is offered at its own height, so on a ninth every
   * one of them shortens the chord - including the one marked as the shape it
   * already is. The per-button `heightLabel` states where each lands and this
   * states what is at stake, because a row of heights does not by itself say
   * that the current one is going.
   */
  heightWarning: string | null = null;

  /** Why there are no buttons, or null when there are. */
  unavailable: string | null = null;

  /** Whether the +/- controls have a chord to act on. */
  canAdjust = false;
  extentLabel = NOTHING_SELECTED;

  /**
   * The octave the chord is **sounding** at, signed.
   *
   * `SlotOctave.sounding` and not `ChordDegree.octave`: a chord too wide for
   * the octave it was given is clamped on use, so the stored number describes a
   * document and this one describes a sound. `slotOctave`'s docstring argues it
   * at length, and the stepper below reads the same field for the same reason.
   */
  octaveLabel = NOTHING_SELECTED;

  /** Whether the octave `+` is at its limit, of either kind. */
  octaveCeilingReached = false;

  /**
   * Which limit that is, in words, or null while there is none.
   *
   * A disabled button with no reason beside it is the failure this panel has
   * been fixed for twice. The two sentences are genuinely different facts - the
   * control has no more range, or this chord cannot use the range that is left
   * - and only the second is about the chord the user is looking at.
   */
  octaveLimit: string | null = null;

  /**
   * What every grey control on the panel is described by, or null when none of
   * them is grey.
   *
   * Held as a field rather than written into the template as
   * `!canAdjust ? '…' : null`, on `PaletteChord.label`'s rule: a conditional in
   * a binding is re-evaluated on every change-detection pass, and this one is
   * on eight bindings. It is also why there is one field for all eight - what
   * they share is a single reason, said once on the page.
   *
   * Null rather than the id when the controls are live, because the paragraph
   * is not on the page then: `aria-describedby` pointing at an id that does not
   * resolve is a description that silently is not read, which is the failure
   * this whole change is about, one indirection along.
   */
  adjustHintId: string | null = null;

  /**
   * The same, for the octave `+`, which has a second way of being dead.
   *
   * Two reasons and one button: no chord to raise, or a chord that cannot go
   * higher. They are never both true - `octaveLimit` is null whenever
   * `canAdjust` is false, because `renderOctave` asks for no octave then - so
   * this is one id rather than a list, and `renderOctave` sets it where both
   * facts are already in hand.
   */
  octaveUpHintId: string | null = null;

  /** None / sus2 / sus4. Empty when there is no key to build chords in. */
  suspensions: readonly SuspensionChoice[] = [];

  /** One row per extension the selected chord actually has. Empty below a ninth. */
  tensions: readonly TensionRow[] = [];

  private selectedSlotId: string | null = null;
  private soundingOctave = 0;

  private readonly progression = inject(ProgressionService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.render(state);
        this.changes.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Adds the clicked chord to the end of the progression. */
  addChord(chord: PaletteChord): void {
    this.progression.appendSlot(chord.degree);
  }

  /**
   * Adds a borrowed chord or a secondary dominant, as the seven above do.
   *
   * `appendChord` rather than `appendSlot`, because a degree cannot say ♭VII:
   * the accidental and the shape are two more fields, and a path that emits
   * them has to be a path that regenerates. The service argues both.
   */
  addOption(option: PaletteOption): void {
    this.progression.appendChord(option);
  }

  /**
   * Re-shapes the selected chord into another shape on its own root.
   *
   * The guard is not decoration: the row is empty without a selection, so a
   * click can only arrive here in the gap between a selection being cleared and
   * the row being re-rendered. The service would refuse an id it does not hold,
   * but `null` is not an id it would refuse - it is a `string` the signature
   * does not take.
   *
   * **Even the marked button does something**, and it is the right something:
   * the slot's `quality` stops being `null` and becomes an override, so a chord
   * that was following the mode is pinned to the shape that was clicked. A user
   * who clicks `major` has said the chord is major, which is what this row is
   * for; the visible cost is the height, and `heightWarning` is that.
   *
   * The pin is the *invisible* cost, and the panel now carries both halves of
   * it. `shapeVerb` puts it on the button that is otherwise a no-op - "Pin as G
   * major" rather than "Change to" - and the note under the row names the way
   * back, which is `resetSlotToChord` and which until this review did not clear
   * `quality` at all. A row that pins with no way out is a one-way door, and
   * that is the failure the plan's own hand-check catches: a pinned slot stops
   * re-voicing when the key moves, alone among the chords beside it.
   *
   * **The marked button is no longer a no-op on a suspended slot**, and that is
   * the other half of M3's final review. `chosen()` clears the suspension and
   * the pinned extensions now, so pressing `major` on a `Bbsus4` slot genuinely
   * returns the chord to `Bb Maj` - which is what every button here prints and
   * what none of them used to do. `shapeVerb` says "Change to" there rather
   * than "Pin as" for exactly that reason, and the note under the row carries
   * the cost in words beside the height each button carries on itself.
   */
  chooseAlternate(option: PaletteAlternate): void {
    if (this.selectedSlotId === null) return;
    this.progression.setSlotChord(this.selectedSlotId, option);
  }

  /**
   * The +/- complexity buttons: one rung up or down the extent ladder.
   *
   * `stepSlotExtent` clamps at both ends, which is why the button is not
   * disabled at the top - resting on the thirteenth is a normal thing for a
   * held button to do, and the service records no undo step for it.
   */
  stepComplexity(delta: number): void {
    if (!this.canAdjust || this.selectedSlotId === null) return;
    this.progression.stepSlotExtent(this.selectedSlotId, delta);
  }

  /**
   * The +/- octave buttons.
   *
   * **It steps from what is sounding**, not from what the document stores. The
   * two differ exactly when a chord is too wide for the octave it was given, and
   * stepping from the stored number there would write a value that changes no
   * note - a control that visibly does nothing, and an undo entry for nothing.
   * `slotOctave` makes the argument in full.
   *
   * The upward refusal is the same failure from the other end. At the ceiling,
   * `setSlotOctave(sounding + 1)` would store a *larger* request that still
   * sounds where it already does: a commit, an undo step, and no change.
   *
   * **This guard is now the whole of the refusal.** The button carries
   * `aria-disabled` rather than `disabled`, so that it keeps its place in the
   * tab order and can be asked why it is dead - see the template, which argues
   * it - and a browser fires the click on such a button like any other. The
   * guard was already here, written for the click that races a re-render, and
   * it is why the swap is safe: nothing below it was relying on the platform.
   */
  stepOctave(delta: number): void {
    if (!this.canAdjust || this.selectedSlotId === null) return;
    if (delta > 0 && this.octaveCeilingReached) return;
    this.progression.setSlotOctave(this.selectedSlotId, this.soundingOctave + delta);
  }

  /**
   * The Sus buttons: replace the third with the second or the fourth, or put it
   * back.
   *
   * The whole choice is handed back rather than a string, on the alternates
   * row's rule: the object the template holds is the object the service takes,
   * so a button cannot print one thing and dispatch another.
   */
  setSuspension(choice: SuspensionChoice): void {
    if (!this.canAdjust || this.selectedSlotId === null) return;
    this.progression.setSlotSuspension(this.selectedSlotId, choice.value);
  }

  /**
   * The Tensions buttons: pin one extension to the figure that was clicked.
   *
   * Three arms rather than one call, and the switch is what pays for the
   * discriminated union above: `setSlotExtension` pairs each extension with the
   * alterations it takes, and narrowing on `choice.extension` is how that
   * pairing survives the trip through a template. One call with the alteration
   * widened to a number would compile and would push the check down into the
   * normalisation, where it becomes a throw rather than a compile error.
   *
   * **Clicking pins**, exactly as the alternates row does, including on the
   * button that is already marked - the note does not move and the slot stops
   * following the key. The note under that row already names Reset to chord as
   * the way back, and it takes all three of these with it.
   */
  setTension(choice: TensionChoice): void {
    if (!this.canAdjust || this.selectedSlotId === null) return;
    const id = this.selectedSlotId;

    switch (choice.extension) {
      case 'ninth':
        this.progression.setSlotExtension(id, 'ninth', choice.alteration);
        return;
      case 'eleventh':
        this.progression.setSlotExtension(id, 'eleventh', choice.alteration);
        return;
      case 'thirteenth':
        this.progression.setSlotExtension(id, 'thirteenth', choice.alteration);
        return;
    }
  }

  /** The degree is the identity of a button: the key changes, the seven do not. */
  trackByDegree(_index: number, chord: PaletteChord): number {
    return chord.degree;
  }

  /** An option's identity is the chord it stores. See `optionKey`. */
  trackByKey(_index: number, option: PaletteOption): string {
    return option.key;
  }

  /** A suspension's identity is the value it stores; there are three, always. */
  trackBySuspension(_index: number, choice: SuspensionChoice): string {
    return choice.value;
  }

  /** A row's identity is the extension it alters. */
  trackByExtension(_index: number, row: TensionRow): string {
    return row.extension;
  }

  /** A tension button's identity is its extension and its figure. */
  trackByTension(_index: number, choice: TensionChoice): string {
    return choice.key;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Rebuilds everything on screen from one published state. */
  private render(state: ProgressionState): void {
    const scale = state.keyScale;
    // Read before the rows are built rather than after, because two of the
    // three read it: the alternates row is shapes on *this* chord's root, and
    // the height warning is about *this* chord's height.
    const degree = this.selectedDegree(state);

    if (state.canBuildChords && scale) {
      this.chords = this.buildChords(state.doc.key, scale.intervals);
      this.buildOptions(state.doc.key, scale.intervals, degree);
      this.unavailable = null;
    } else {
      this.chords = [];
      this.clearOptions();
      this.unavailable = this.explain(scale);
    }

    this.selectedSlotId = state.selectedSlotId;
    // A key that can build no chords can adjust none either: `editDegree`
    // refuses every one of these edits, so offering them would be a control
    // that does nothing with no explanation for why.
    this.canAdjust = state.canBuildChords && degree !== null;
    // The reason the grey controls point at, resolved here rather than in eight
    // template conditions. See `adjustHintId`.
    this.adjustHintId = this.canAdjust ? null : ADJUST_HINT_ID;
    this.extentLabel = degree ? EXTENT_LABELS[degree.extent] : NOTHING_SELECTED;

    // The chord this slot actually builds, asked for once and read by both
    // controls below. It is the same identity the strip card and the fretboard
    // read, which is what stops the panel disagreeing with the card about the
    // chord it is pointed at - and it is the whole of why the Tensions row can
    // mark a ♭9 the user never pinned.
    // `canAdjust` is the guard rather than `degree !== null`: a five-note scale
    // resolves to a real `Scale`, and `degreePitchClasses` throws on one. The
    // panel is already refusing in that state, so the chord is simply not asked
    // for - the same "ask first rather than call and catch" the service opens
    // `editDegree` with.
    const chord = this.canAdjust && degree && scale ? effectiveChord(scale.intervals, degree) : null;
    this.suspensions = state.canBuildChords ? buildSuspensions(chord) : [];
    this.tensions = chord ? buildTensions(chord) : [];
    this.renderOctave(state.selectedSlotId, this.canAdjust);
  }

  /**
   * The octave readout and the two facts the `+` button needs.
   *
   * Asked of the service rather than read off `ChordDegree.octave`, which is
   * the change M3 Task 4b's other half made necessary: the ceiling is per-chord
   * and applied on use, so the document's number and the sounding one come
   * apart and only the service can say by how much. See `SlotOctave`, where the
   * two predicates `buildOctaveView` applies are argued - and where the one
   * Task 4b wrote down is recorded as the wrong one.
   *
   * `soundingOctave` is kept here rather than on the view, because it is not
   * drawn: it is what the stepper adds to, and a number a button reads is the
   * component's business rather than the template's.
   */
  private renderOctave(selectedSlotId: string | null, canAdjust: boolean): void {
    const octave = canAdjust && selectedSlotId !== null
      ? this.progression.slotOctave(selectedSlotId)
      : null;
    const view = buildOctaveView(octave, NOTHING_SELECTED);

    this.soundingOctave = octave?.sounding ?? 0;
    this.octaveLabel = view.label;
    this.octaveCeilingReached = view.ceilingReached;
    this.octaveLimit = view.limit;
    // Which sentence the `+` is described by, decided where both facts are
    // already in hand. `view.limit` is non-null only when `canAdjust` is true,
    // so the two arms cannot both apply; the order states which is asked first
    // rather than relying on that.
    this.octaveUpHintId = !canAdjust
      ? ADJUST_HINT_ID
      : view.limit !== null
        ? OCTAVE_LIMIT_HINT_ID
        : null;
  }

  private buildChords(key: ProgressionKey, intervals: readonly number[]): PaletteChord[] {
    return [0, 1, 2, 3, 4, 5, 6].map(degree => {
      // The whole identity rather than a bare quality, which is what the three
      // renderers take since M3 Task 5 - and it is the same identity the strip
      // card and the fretboard read, so a diatonic button here cannot come to a
      // different conclusion about a chord from the card it will make. At this
      // row's extent nothing composes: a triad with no suspension and no pinned
      // extension renders exactly what `degreeQuality` rendered before.
      const chord = effectiveChord(intervals, paletteDegree(degree));
      // The shared arithmetic rather than a local `(tonic + interval) % 12`,
      // which is what this was and which agrees with it only while `alter` is
      // pinned at zero. The strip card and the fretboard highlight both call
      // this function; a palette doing its own sum is the one label that would
      // not follow when M2 lets a degree be altered - and it would also not
      // fold a negative sum back into range.
      //
      // Spelled on this degree's own letter rather than from the two chromatic
      // tables, which is what makes F locrian's third degree an `Ab` here
      // instead of the `G♯` a six-sharp signature gave it - and what keeps this
      // row agreeing with the borrowed row beside it, where a lowered root now
      // has a letter no preference could have chosen.
      const root = chordRootName(key, intervals, paletteDegree(degree));

      return {
        degree,
        numeral: romanNumeral(degree, PALETTE_ALTER, chord),
        name: chordName(root, chord),
        // The numeral is dropped from the spoken label rather than translated:
        // read aloud it is a string of letters ("vee eye eye") and the one fact
        // it carries beyond the position - the quality - is already in the
        // spoken name. The position is given as the degree instead.
        label: `Add ${spokenChordName(root, chord)}, degree ${degree + 1}`,
        isTonic: degree === 0
      };
    });
  }

  /**
   * The three rows, from the vocabulary and the selection.
   *
   * Nothing is handed over to spell with any more. `chordVocabulary` names each
   * root on the letter its own numeral names, which is the same rule
   * `buildChords` follows one method up - one spelling for the whole panel, so
   * a borrowed button and the diatonic button beside it cannot disagree about
   * which note a chord is on.
   */
  private buildOptions(
    key: ProgressionKey,
    intervals: readonly number[],
    selected: ChordDegree | null
  ): void {
    const vocabulary = chordVocabulary(key, intervals, selected);

    const alternates = vocabulary.alternates.map(option => this.buildAlternate(option, selected));

    this.alternates = alternates;
    // The numeral is dropped from both spoken labels and what the row is
    // supplies the position instead, on `PaletteChord.label`'s argument: read
    // aloud a numeral is a string of letters, and `♭VII` adds a glyph to it.
    this.borrowed = vocabulary.borrowed.map(option =>
      buildOption(option, `${addVerb(option)} ${option.spoken}, borrowed chord`)
    );
    this.secondary = vocabulary.secondary.map(option =>
      buildOption(option, `${addVerb(option)} ${option.spoken}, secondary dominant`)
    );
    // The buttons that were just built rather than the field they were written
    // into. See `warnAboutHeight`.
    this.heightWarning = warnAboutHeight(alternates, selected);
    this.nameAlternates(vocabulary.alternates);
  }

  /**
   * The heading over the alternates row, from whichever button is marked.
   *
   * Read off the marked option rather than figured a second time from the
   * selected degree. `ChordOption.current` is "the shape the selected slot
   * already has", resolved through `effectiveChord` and at the slot's own
   * height - which is the same composition of `romanNumeral`, `chordName` and
   * `spokenChordName` the strip card performs, already done. A heading that did
   * its own sum would be a third statement of that rule, free to disagree with
   * the card the user is reading it against, and it would disagree first in the
   * awkward cases the two existing callers write paragraphs about.
   *
   * It is given the vocabulary's options and not this component's, because the
   * three writings of a chord it needs include `spoken` - the one field
   * `PaletteOption` deliberately drops, being neither drawn nor dispatched.
   *
   * ## What it names is the *shape*, which is not always what the card names
   *
   * "The same composition the strip card performs" is exact for a slot with no
   * suspension and nothing pinned, which was every slot the palette could reach
   * until M3 Task 6. It is not exact for one that carries either: the card names
   * the whole chord and this names the marked option, and since `chosen()`
   * clears both on the way in, the marked option names the chord that pressing
   * it *builds*. So a `Bbsus4` slot reads `Isus4` / `Bbsus4` on the card under a
   * heading saying `Other shapes on I (Bb Maj)`.
   *
   * The two differ by exactly what a click here discards, and that is the
   * arrangement rather than a leak in it: every button on the row means "this is
   * what you would have instead", including the marked one, so the heading has
   * to be read in the row's terms and not the card's. The note under the row is
   * where that is said in words. Naming the slot instead - `describeSlot` of the
   * selected harmony - would put a chord in the heading that no button on the
   * row can produce, which is the worse of the two mismatches.
   */
  private nameAlternates(alternates: readonly ChordOption[]): void {
    const marked = alternates.find(option => option.current);

    this.alternatesTitle = marked
      ? `Other shapes on ${marked.numeral} (${marked.name})`
      : ALTERNATES_UNNAMED;
    this.alternatesLabel = marked
      ? `Other shapes on ${marked.spoken}`
      : ALTERNATES_UNNAMED;
  }

  /** Three empty rows, for a key with no chords to offer in the first place. */
  private clearOptions(): void {
    this.alternates = [];
    this.borrowed = [];
    this.secondary = [];
    this.heightWarning = null;
    this.alternatesTitle = ALTERNATES_UNNAMED;
    this.alternatesLabel = ALTERNATES_UNNAMED;
  }

  /**
   * One alternate, with the height it sets and whether that is a step down.
   *
   * The comparison is against the *slot's* height rather than against another
   * option's, because that is what the click replaces. It is false with nothing
   * selected for the same reason the row is empty then: there is no chord for a
   * shape to be shorter than.
   */
  private buildAlternate(
    option: ChordOption,
    selected: ChordDegree | null
  ): PaletteAlternate {
    const heightLabel = EXTENT_LABELS[option.extent];
    const standing = selected === null ? null : EXTENT_LABELS[selected.extent];
    const lowersHeight = selected !== null && option.extent < selected.extent;
    const cost = lowersHeight && standing !== null ? `, down from the ${standing}` : '';

    return {
      ...buildOption(
        option,
        `${shapeVerb(option, selected)} ${option.spoken}, ${heightLabel.toLowerCase()}${cost}`
      ),
      heightLabel,
      lowersHeight
    };
  }

  /**
   * What to say instead of buttons.
   *
   * Two roads to the same refusal, and they need different sentences: a scale
   * that is simply not seven notes can be named and counted, and an id that
   * resolves to nothing cannot.
   */
  private explain(scale: Scale | null): string {
    if (!scale) {
      return 'This progression is in a scale the app does not know, so there are no chords to offer.';
    }

    return (
      `${scale.name} has ${scale.intervals.length} notes. Diatonic chords are built by ` +
      'stacking thirds, which needs a seven-note scale - pick a mode or another ' +
      'seven-note scale to build chords in.'
    );
  }

  /** The selected slot's degree, or null when nothing selectable is selected. */
  private selectedDegree(state: ProgressionState): ChordDegree | null {
    const slot = state.doc.slots.find(candidate => candidate.id === state.selectedSlotId);
    // A literal slot has no degree, so the steppers have nothing to move. It
    // cannot be reached in M1 - the recogniser that makes one is M3's - and
    // the check is here so that when it can be, the controls grey out rather
    // than dispatching edits the service silently drops.
    if (!slot || slot.harmony.kind !== 'degree') return null;
    return slot.harmony.degree;
  }
}
