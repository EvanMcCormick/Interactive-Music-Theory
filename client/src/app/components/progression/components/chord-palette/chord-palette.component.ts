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
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { chordRootPitchClass } from '../../../../services/progression-generate';
import { ChordChoice, ProgressionService } from '../../../../services/progression.service';
import {
  chordName,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-chord-names';
import {
  ChordExtent,
  degreeQuality
} from '../../../../services/progression-harmony';
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

/**
 * The palette offers triads, because that is what `createDegreeSlot` builds.
 *
 * A palette that printed seventh figures and appended triads would be a label
 * disagreeing with the thing it labelled before the user had touched anything.
 * The complexity control below is how a chord gets taller, after it is placed.
 */
const PALETTE_EXTENT: ChordExtent = 3;

/**
 * The diatonic row is unaltered, which is what makes it the diatonic row.
 *
 * Named rather than written as a bare `0` at the `romanNumeral` call, because
 * the argument it fills is the one Task 8 added for borrowed chords: the seven
 * buttons here are the key's own degrees and the accidental is what the
 * borrowed group below them carries. It is `createDegreeSlot`'s `alter` and
 * `paletteDegree`'s, for the same reason both of those write it down.
 */
const PALETTE_ALTER = 0;

/** What each rung of the ladder is called, for the complexity readout. */
const EXTENT_LABELS: Record<ChordExtent, string> = {
  3: 'Triad',
  7: '7th',
  9: '9th',
  11: '11th',
  13: '13th'
};

/** The readout when there is nothing selected for the controls to describe. */
const NOTHING_SELECTED = '—';

/**
 * The diatonic chords of the current key, as seven buttons.
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
 * two services happen to agree. `MusicTheoryService` is still injected, for
 * `spellNote`, but it is asked to spell a note with a given preference rather
 * than asked what the preference is.
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
 *    selection - twelve shapes on the root the selected chord already sits on -
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

  /** Chords from the parallel modes this key does not have of its own. */
  borrowed: readonly PaletteOption[] = [];

  /** The dominant seventh of every degree this key could tonicise. */
  secondary: readonly PaletteOption[] = [];

  /**
   * What choosing an alternate would cost, or null when it would cost nothing.
   *
   * The one thing about this panel a user could not otherwise find out before
   * clicking: every shape is offered at its own height, so on a ninth all
   * twelve of them shorten the chord - including the one marked as the shape it
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
  octaveLabel = NOTHING_SELECTED;

  private selectedSlotId: string | null = null;
  private selectedOctave = 0;

  private readonly progression = inject(ProgressionService);
  private readonly musicTheory = inject(MusicTheoryService);
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

  /** The +/- octave buttons. Clamped to the playable range by the service. */
  stepOctave(delta: number): void {
    if (!this.canAdjust || this.selectedSlotId === null) return;
    this.progression.setSlotOctave(this.selectedSlotId, this.selectedOctave + delta);
  }

  /** The degree is the identity of a button: the key changes, the seven do not. */
  trackByDegree(_index: number, chord: PaletteChord): number {
    return chord.degree;
  }

  /** An option's identity is the chord it stores. See `optionKey`. */
  trackByKey(_index: number, option: PaletteOption): string {
    return option.key;
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
    this.selectedOctave = degree?.octave ?? 0;
    // A key that can build no chords can adjust none either: `editDegree`
    // refuses every one of these edits, so offering them would be a control
    // that does nothing with no explanation for why.
    this.canAdjust = state.canBuildChords && degree !== null;
    this.extentLabel = degree ? EXTENT_LABELS[degree.extent] : NOTHING_SELECTED;
    this.octaveLabel = degree ? formatOctave(degree.octave) : NOTHING_SELECTED;
  }

  private buildChords(key: ProgressionKey, intervals: readonly number[]): PaletteChord[] {
    return [0, 1, 2, 3, 4, 5, 6].map(degree => {
      const quality = degreeQuality(intervals, degree, PALETTE_EXTENT);
      // The shared arithmetic rather than a local `(tonic + interval) % 12`,
      // which is what this was and which agrees with it only while `alter` is
      // pinned at zero. The strip card and the fretboard highlight both call
      // this function; a palette doing its own sum is the one label that would
      // not follow when M2 lets a degree be altered - and it would also not
      // fold a negative sum back into range.
      //
      // Spelled from `key.preferSharps` and not from `getNoteName`, which
      // answers for the *fretboard's* key. See the note at the top of the file.
      const root = this.musicTheory.spellNote(
        chordRootPitchClass(key, intervals, paletteDegree(degree)),
        key.preferSharps
      );

      return {
        degree,
        numeral: romanNumeral(degree, PALETTE_ALTER, quality),
        name: chordName(root, quality),
        // The numeral is dropped from the spoken label rather than translated:
        // read aloud it is a string of letters ("vee eye eye") and the one fact
        // it carries beyond the position - the quality - is already in the
        // spoken name. The position is given as the degree instead.
        label: `Add ${spokenChordName(root, quality)}, degree ${degree + 1}`,
        isTonic: degree === 0
      };
    });
  }

  /**
   * The three rows, from the vocabulary and the selection.
   *
   * `spellNote` is handed over rather than the preference asked for, which is
   * the same separation `buildChords` keeps one method up: how a pitch class is
   * written is `MusicTheoryService`'s decision, but *which* preference applies
   * is the progression key's - and for a displaced root it is neither's, which
   * is why `chordVocabulary` decides that one itself.
   */
  private buildOptions(
    key: ProgressionKey,
    intervals: readonly number[],
    selected: ChordDegree | null
  ): void {
    const vocabulary = chordVocabulary(key, intervals, selected, (pitchClass, preferSharps) =>
      this.musicTheory.spellNote(pitchClass, preferSharps)
    );

    this.alternates = vocabulary.alternates.map(option =>
      this.buildAlternate(option, selected)
    );
    // The numeral is dropped from both spoken labels and what the row is
    // supplies the position instead, on `PaletteChord.label`'s argument: read
    // aloud a numeral is a string of letters, and `♭VII` adds a glyph to it.
    this.borrowed = vocabulary.borrowed.map(option =>
      buildOption(option, `Add ${option.spoken}, borrowed chord`)
    );
    this.secondary = vocabulary.secondary.map(option =>
      buildOption(option, `Add ${option.spoken}, secondary dominant`)
    );
    this.heightWarning = this.warnAboutHeight(selected);
  }

  /** Three empty rows, for a key with no chords to offer in the first place. */
  private clearOptions(): void {
    this.alternates = [];
    this.borrowed = [];
    this.secondary = [];
    this.heightWarning = null;
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
      ...buildOption(option, `Change to ${option.spoken}, ${heightLabel.toLowerCase()}${cost}`),
      heightLabel,
      lowersHeight
    };
  }

  /**
   * The sentence under the alternates row, or null when there is nothing to
   * warn about.
   *
   * Asked of the buttons rather than of the extent, so the sentence cannot
   * appear over a row where nothing is marked or fail to appear over one where
   * something is. It names the height at stake because "these will shorten it"
   * without saying from what reads as a caution about nothing in particular.
   */
  private warnAboutHeight(selected: ChordDegree | null): string | null {
    if (selected === null) return null;
    if (!this.alternates.some(option => option.lowersHeight)) return null;

    return (
      `Every shape has a height of its own, marked on each button. Choosing one ` +
      `sets that height, so this ${EXTENT_LABELS[selected.extent]} will not stay one.`
    );
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

/**
 * The degree a palette button stands for, as `chordRootPitchClass` wants it.
 *
 * It is `createDegreeSlot`'s degree at the palette's own extent - the slot the
 * button appends - so building it here rather than passing the index alone is
 * what makes the label and the appended chord one description. `alter: 0` is
 * copied from that factory rather than assumed: it is the field M2's borrowed
 * chords move, and the day it moves the palette follows through the shared
 * function instead of standing still.
 *
 * `quality: null` is copied from it for the same reason, and it used to be the
 * *derived* label instead - which was the palette writing a name into a field
 * that means "override", one call site over from the `regenerateSlot` that did
 * the same thing everywhere else. `chordRootPitchClass` reads neither, so
 * nothing moved; what changed is that the two descriptions now match.
 */
function paletteDegree(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: PALETTE_EXTENT,
    quality: null,
    inversion: 0,
    suspension: 'none',
    octave: 0
  };
}

/**
 * A vocabulary option as a button, with the label its row decided on.
 *
 * The four `ChordChoice` fields are copied one at a time rather than spread,
 * for the reason the service's `chosen()` gives from the other end: what is
 * being built is the object a click hands to the service, and `spoken` and
 * `group` have no business in a document. `current` is copied and never
 * recomputed - see `ChordOption.current`, where the comparison it stands for is
 * argued at length and is not the obvious one.
 */
function buildOption(option: ChordOption, label: string): PaletteOption {
  return {
    degree: option.degree,
    alter: option.alter,
    quality: option.quality,
    extent: option.extent,
    numeral: option.numeral,
    name: option.name,
    label,
    current: option.current,
    key: optionKey(option)
  };
}

/**
 * A button's identity for `trackBy`: the chord it puts in a slot.
 *
 * The numeral would do for the two append rows and not for the alternates,
 * where all twelve shapes sit on one degree and one accidental - `V` and `V7`
 * differ, but the numeral is the *rendering* and the shape is the thing. The
 * quality would do for the alternates and not for the others, where every
 * secondary dominant is a `dominant7`. The triple is what all three rows vary,
 * and it is unique within each of them.
 */
function optionKey(option: ChordOption): string {
  return `${option.degree}:${option.alter}:${option.quality}`;
}

/** `+1`, `0`, `-2` - signed, so the readout says which way it has been moved. */
function formatOctave(octave: number): string {
  return octave > 0 ? `+${octave}` : `${octave}`;
}
