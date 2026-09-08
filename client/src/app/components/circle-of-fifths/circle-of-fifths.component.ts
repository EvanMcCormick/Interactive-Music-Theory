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

import { MusicTheoryService } from '../../services/music-theory.service';
import {
  CIRCLE_POSITIONS,
  CircleDirection,
  CirclePosition,
  circleOrder
} from './circle-of-fifths.data';

/**
 * The circle of fifths, as a key selector for the whole app.
 *
 * Not a reference chart. Clicking a wedge sets `selectedKey` and the mode on
 * `MusicTheoryService`, which the fretboard and keyboard already read, so the
 * circle teaches by doing: you move round it and watch the instrument relight.
 *
 * ## It holds no state of its own
 *
 * The selection lives in the service and is read back for highlighting, so
 * arriving with A minor already chosen lights the inner ring without the circle
 * being told. The one thing it does own is which way round it is being read,
 * because that is a property of this view and of nothing else.
 *
 * ## Three rings
 *
 * Signature outside, majors in the middle, relative minors inside. Every wedge
 * is an SVG arc in a fixed `viewBox`, so the whole diagram scales to whatever
 * width the drawer gives it without breakpoints and without reflowing.
 *
 * Labels are upright rather than rotated to the wedge. Rotated text looks right
 * on a poster and is unreadable at drawer width.
 *
 * ## C stays at the top
 *
 * The circle does not rotate to put the selected key under the pointer. That is
 * prettier and it destroys the thing the diagram is for: the shape is learned by
 * its fixed positions, and one that moves under the reader teaches nothing.
 */
@Component({
  selector: 'app-circle-of-fifths',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './circle-of-fifths.component.html',
  styleUrls: ['./circle-of-fifths.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CircleOfFifthsComponent implements OnInit, OnDestroy {
  /** The category `ionian` and `aeolian` live in. */
  private static readonly MODE_CATEGORY = 'diatonicModes';

  private static readonly MAJOR_MODE = 'ionian';
  private static readonly MINOR_MODE = 'aeolian';

  /** Geometry, in `viewBox` units. The SVG is square and 400 on a side. */
  readonly centre = 200;
  readonly rings = {
    signature: { outer: 196, inner: 164 },
    major: { outer: 162, inner: 108 },
    minor: { outer: 106, inner: 56 }
  };

  direction: CircleDirection = 'fifths';
  positions: readonly CirclePosition[] = CIRCLE_POSITIONS;

  private selectedKey = '';
  private selectedItem = '';

  private readonly service = inject(MusicTheoryService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.service
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.selectedKey = state.selectedKey;
        this.selectedItem = state.selectedItem;
        this.changes.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Reads the same twelve positions the other way round. */
  setDirection(direction: CircleDirection): void {
    this.direction = direction;
    this.positions = circleOrder(direction);
    this.changes.markForCheck();
  }

  /**
   * Selects a major key.
   *
   * @param enharmonic Take the alternative spelling, for the one position that
   *   has one. Which spelling was clicked is a real choice — F sharp and G flat
   *   are the same pitch and different keys — and it decides whether the app
   *   spells everything else in sharps or flats.
   */
  selectMajor(position: CirclePosition, enharmonic = false): void {
    const key = enharmonic && position.majorEnharmonic ? position.majorEnharmonic : position.major;

    this.service.selectKeyAndMode(
      key,
      CircleOfFifthsComponent.MODE_CATEGORY,
      CircleOfFifthsComponent.MAJOR_MODE
    );
  }

  /** Selects the relative minor: its own root, and the minor mode. */
  selectMinor(position: CirclePosition, enharmonic = false): void {
    const key = enharmonic && position.minorEnharmonic ? position.minorEnharmonic : position.minor;

    this.service.selectKeyAndMode(
      key,
      CircleOfFifthsComponent.MODE_CATEGORY,
      CircleOfFifthsComponent.MINOR_MODE
    );
  }

  isMajorSelected(position: CirclePosition): boolean {
    return (
      this.selectedItem === CircleOfFifthsComponent.MAJOR_MODE &&
      this.matches(position.major, position.majorEnharmonic)
    );
  }

  isMinorSelected(position: CirclePosition): boolean {
    return (
      this.selectedItem === CircleOfFifthsComponent.MINOR_MODE &&
      this.matches(position.minor, position.minorEnharmonic)
    );
  }

  /**
   * The label for a wedge's key signature: `2♯`, `3♭`, or nothing for C.
   */
  signatureLabel(position: CirclePosition, enharmonic = false): string {
    const kind = enharmonic ? position.enharmonicAccidentalKind : position.accidentalKind;

    if (kind === null || kind === 'none') {
      return '';
    }

    return `${position.accidentals}${kind === 'sharp' ? '♯' : '♭'}`;
  }

  /** What a screen reader is told about a wedge. */
  majorLabel(position: CirclePosition, enharmonic = false): string {
    const key = enharmonic && position.majorEnharmonic ? position.majorEnharmonic : position.major;
    const signature = this.signatureLabel(position, enharmonic);

    return signature ? `${key} major, ${signature}` : `${key} major, no accidentals`;
  }

  minorLabel(position: CirclePosition, enharmonic = false): string {
    const key = enharmonic && position.minorEnharmonic ? position.minorEnharmonic : position.minor;
    return `${key} minor`;
  }

  // ----- geometry -----

  /**
   * The wedge path for one position on one ring.
   *
   * Twelve equal segments starting at twelve o'clock, so position 0 straddles
   * the top rather than beginning there — which is what puts C's label centred
   * under the pointer rather than off to one side.
   */
  wedge(index: number, ring: { outer: number; inner: number }, half: 'top' | 'bottom' | null = null): string {
    const step = 360 / this.positions.length;
    let from = index * step - step / 2 - 90;
    let to = from + step;

    // The enharmonic wedge is cut in half radially, so both spellings get their
    // own hit target on the same segment.
    if (half) {
      const middle = (ring.outer + ring.inner) / 2;
      ring = half === 'top'
        ? { outer: ring.outer, inner: middle }
        : { outer: middle, inner: ring.inner };
    }

    const outerFrom = this.point(ring.outer, from);
    const outerTo = this.point(ring.outer, to);
    const innerTo = this.point(ring.inner, to);
    const innerFrom = this.point(ring.inner, from);

    return [
      `M ${outerFrom.x} ${outerFrom.y}`,
      `A ${ring.outer} ${ring.outer} 0 0 1 ${outerTo.x} ${outerTo.y}`,
      `L ${innerTo.x} ${innerTo.y}`,
      `A ${ring.inner} ${ring.inner} 0 0 0 ${innerFrom.x} ${innerFrom.y}`,
      'Z'
    ].join(' ');
  }

  /** Where a wedge's label sits: the midpoint of its arc. */
  labelPoint(index: number, ring: { outer: number; inner: number }, offset = 0): { x: number; y: number } {
    const step = 360 / this.positions.length;
    const angle = index * step - 90;
    return this.point((ring.outer + ring.inner) / 2 + offset, angle);
  }

  private point(radius: number, degrees: number): { x: number; y: number } {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: round(this.centre + radius * Math.cos(radians)),
      y: round(this.centre + radius * Math.sin(radians))
    };
  }

  /**
   * Whether the selected key is this position, on either spelling.
   *
   * Compared by name rather than by pitch, then widened to the enharmonic:
   * arriving with `Gb` selected has to light the `F#/Gb` wedge, and arriving
   * with `F#` has to light the same one.
   */
  private matches(name: string, enharmonic: string | null): boolean {
    return this.selectedKey === name || (enharmonic !== null && this.selectedKey === enharmonic);
  }
}

/** Two decimals is well under a pixel at any size this renders at. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
