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
import { ProgressionService } from '../../../../services/progression.service';
import {
  chordName,
  romanNumeral,
  spokenChordName
} from '../../../../services/progression-chord-names';
import {
  ChordExtent,
  degreeQuality
} from '../../../../services/progression-harmony';

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
    const scale = state.keyScale;

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
        numeral: romanNumeral(degree, quality),
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

/** `+1`, `0`, `-2` - signed, so the readout says which way it has been moved. */
function formatOctave(octave: number): string {
  return octave > 0 ? `+${octave}` : `${octave}`;
}
