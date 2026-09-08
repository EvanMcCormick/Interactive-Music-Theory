import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { Subject, combineLatest, takeUntil } from 'rxjs';

import { Scale } from '../../../../models/music-theory.model';
import {
  ChordDegree,
  ProgressionKey,
  ProgressionState
} from '../../../../models/progression.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import {
  ChordExtent,
  chordName,
  degreeQuality,
  romanNumeral
} from '../../../../services/progression-harmony';

/** One button: where the chord sits in the key, and what it is called there. */
export interface PaletteChord {
  /** 0-6, the domain `appendSlot` takes. */
  degree: number;
  numeral: string;
  name: string;
  /** The I chord, which takes the root colour the fretboard gives the root. */
  isTonic: boolean;
}

/**
 * The palette offers triads, because that is what `createDegreeSlot` builds.
 *
 * A palette that printed seventh figures and appended triads would be a label
 * disagreeing with the thing it labelled before the user had touched anything.
 * The complexity control below is how a chord gets taller, after it is placed.
 */
const PALETTE_EXTENT: ChordExtent = 3;

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
 * ## Why it listens to two services
 *
 * The numerals come from the progression's key and the *spelling* of the names
 * comes from `MusicTheoryService.getNoteName`, which follows the app-wide
 * sharps-or-flats rule so this page spells a chord the way the fretboard behind
 * it spells the same note. Two inputs, so two sources - and `combineLatest`
 * says so, rather than leaving the names to refresh only when something else
 * happens to change.
 *
 * ## The guard
 *
 * `state.canBuildChords` decides whether there are chords to offer, and it is
 * read rather than recomputed. It is `isHeptatonic` already applied to the
 * key's scale, so reading it is what makes "the palette will offer this" and
 * "the service will accept it" one answer instead of two that can drift. The
 * scale is still looked up here for its intervals and its name - but the *rule*
 * is not restated, only the lookup.
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
    combineLatest([this.progression.getState(), this.musicTheory.getState()])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([state]) => {
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

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Rebuilds everything on screen from one published state. */
  private render(state: ProgressionState): void {
    const scale = this.findScale(state.doc.key.scaleId);

    if (state.canBuildChords && scale) {
      this.chords = this.buildChords(state.doc.key, scale.intervals);
      this.unavailable = null;
    } else {
      this.chords = [];
      this.unavailable = this.explain(scale);
    }

    const degree = this.selectedDegree(state);
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
      // `degreePitchClasses` works relative to the tonic, so the tonic is added
      // here - the same one addition `generateSlotNotes` makes on the way to
      // the notes, so the label and the sound come from one arithmetic.
      const root = this.musicTheory.getNoteName((key.tonic + intervals[degree]) % 12);

      return {
        degree,
        numeral: romanNumeral(degree, quality),
        name: chordName(root, quality),
        isTonic: degree === 0
      };
    });
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

  /** The scale a key names, or null when the id names nothing the app knows. */
  private findScale(scaleId: string): Scale | null {
    for (const category of this.musicTheory.getScaleCategories()) {
      const scale = category.scales.find(candidate => candidate.id === scaleId);
      if (scale) return scale;
    }
    return null;
  }
}

/** `+1`, `0`, `-2` - signed, so the readout says which way it has been moved. */
function formatOctave(octave: number): string {
  return octave > 0 ? `+${octave}` : `${octave}`;
}
