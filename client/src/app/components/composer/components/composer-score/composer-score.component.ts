import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerService } from '../../../../services/composer.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { StaffHitTestService, StaffLines } from '../../../../services/staff-hit-test.service';
import {
  bottomLineDiatonic,
  diatonicToPitch,
  pitchToMidi
} from '../../../../services/staff-pitch';
import { ComposerState } from '../../../../models/composer.model';

/** One staff as alphaTab draws it, tied back to the track it came from. */
interface StaffSlot {
  trackIndex: number;
  staffIndex: number;
  kind: 'notation' | 'tab';
}

/**
 * The engraved score, and the click-to-edit surface over it.
 *
 * Owns the alphaTab instance, the render pipeline, and the edit caret. Split
 * out of ComposerComponent so each file stays within the project's 500-line
 * guideline and so the score view is a single cohesive unit.
 */
@Component({
  selector: 'app-composer-score',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-score.component.html',
  styleUrls: ['./composer-score.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerScoreComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('alphaTabContainer') alphaTabContainer!: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();
  /** Coalesces renders so typing does not re-engrave on every keystroke. */
  private readonly renderRequest$ = new Subject<void>();

  state: ComposerState | null = null;
  renderError: string | null = null;

  /** Caret box drawn over the staff, in container-relative pixels. */
  caretRect: { left: number; top: number; width: number; height: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedWidth = 0;
  /** Set when a render was skipped because the container had no width yet. */
  private renderPending = false;
  private destroyed = false;
  private pointer: { x: number; y: number } | null = null;

  /** Which rendered staff the caret sits on, and how far up it. */
  private caretStaffIndex: number | null = null;
  private caretHalfSteps = 0;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly hitTest: StaffHitTestService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to render requests first so the initial document state below is
    // picked up. The debounce also defers the first render past
    // ngAfterViewInit, giving alphaTab time to boot its workers.
    this.renderRequest$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(() => this.renderCurrentDocument());

    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.renderRequest$.next();
        this.scheduleCaretUpdate();
        this.cdr.markForCheck();
      });
  }

  ngAfterViewInit(): void {
    this.alphaTabService.initializeApi(this.alphaTabContainer.nativeElement, {
      core: { fontDirectory: '/font/', useWorkers: true },
      display: { scale: 1.0, staveProfile: 'default', layoutMode: 'page' },
      player: {
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: this.alphaTabContainer.nativeElement
      }
    });

    this.observeContainerWidth();
    this.wireScoreInteraction();
    this.renderRequest$.next();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.alphaTabContainer?.nativeElement.removeEventListener(
      'mousedown',
      this.onScorePointerDown,
      { capture: true }
    );
    this.alphaTabService.dispose();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderCurrentDocument(): void {
    if (!this.state) return;

    // alphaTab refuses to draw into a zero-width element, logging "skipped
    // rendering because of width=0", and never retries by itself. Defer until
    // the ResizeObserver reports a real width.
    if ((this.alphaTabContainer?.nativeElement.clientWidth ?? 0) === 0) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;

    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      // Render every track: without explicit indices alphaTab shows only the
      // first, which hides all but one staff on a multi-track score.
      this.alphaTabService.renderScore(
        score,
        score.tracks.map((_, index) => index)
      );
      this.renderError = null;
    } catch (error) {
      this.renderError =
        error instanceof Error ? error.message : 'Failed to render the score';
    }
    this.cdr.markForCheck();
  }

  /**
   * alphaTab refuses to render into a zero-width element and does not retry on
   * its own. Watch for the container gaining width and render then; this also
   * re-flows the score when the window or side panels resize.
   */
  private observeContainerWidth(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;

      if (this.renderPending) {
        this.renderCurrentDocument();
      } else if (width !== this.lastRenderedWidth) {
        this.alphaTabService.render();
      }
      this.lastRenderedWidth = width;
      this.scheduleCaretUpdate();
    });
    this.resizeObserver.observe(element);
  }

  // -------------------------------------------------------------------------
  // Click to edit
  // -------------------------------------------------------------------------

  /**
   * Clicking a staff moves the caret there. On tablature the fret is then
   * typed, as in Guitar Pro; on standard notation the clicked position is
   * itself the pitch, so the note is written straight away.
   *
   * The pointer position is captured in the capture phase so it is available
   * when alphaTab's own handler fires.
   */
  private wireScoreInteraction(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element) return;

    element.addEventListener('mousedown', this.onScorePointerDown, { capture: true });
    this.alphaTabService.onBeatMouseDown(beat => this.selectBeat(beat));

    // alphaTab attaches the rendered surface after this event, so measuring
    // has to wait for the DOM to settle.
    this.alphaTabService.onRenderFinished(() => this.scheduleCaretUpdate());
  }

  /**
   * Recomputes the caret once the DOM has settled.
   *
   * markForCheck alone is not enough: these callbacks originate from alphaTab,
   * outside Angular's change detection, so the view is refreshed explicitly as
   * the project's alphaTab guidance recommends.
   */
  private scheduleCaretUpdate(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.destroyed) return;
        this.updateCaretOverlay();
        this.cdr.detectChanges();
      })
    );
  }

  private readonly onScorePointerDown = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  /**
   * The staves alphaTab draws, in render order, described from the document.
   *
   * alphaTab lays out each track's staves in order, standard notation before
   * tablature, so this lines up index-for-index with the measured staves and
   * says which track a clicked staff belongs to.
   */
  private staffSlots(): StaffSlot[] {
    const slots: StaffSlot[] = [];
    if (!this.state) return slots;

    this.state.doc.tracks.forEach((track, trackIndex) => {
      track.staves.forEach((staff, staffIndex) => {
        if (staff.showStandardNotation) {
          slots.push({ trackIndex, staffIndex, kind: 'notation' });
        }
        if (staff.showTablature && staff.tuning.length > 0) {
          slots.push({ trackIndex, staffIndex, kind: 'tab' });
        }
      });
    });

    return slots;
  }

  /**
   * Moves the caret to the clicked position.
   *
   * The beat comes from alphaTab, but the track and staff cannot: a beat's
   * bounds cover every staff in the system, so alphaTab always reports the
   * first track. Both are taken from where the pointer landed vertically.
   */
  private selectBeat(beat: alphaTab.model.Beat): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element || !this.state) return;

    const hitIndex = this.pointer
      ? this.hitTest.staffIndexAt(element, this.pointer.x, this.pointer.y)
      : null;
    const slot = hitIndex !== null ? this.staffSlots()[hitIndex] : undefined;
    const staff = hitIndex !== null ? this.hitTest.allStaves(element)[hitIndex] : undefined;

    const cursor = {
      trackIndex: slot ? slot.trackIndex : beat.voice.bar.staff.track.index,
      staffIndex: slot ? slot.staffIndex : beat.voice.bar.staff.index,
      barIndex: beat.voice.bar.index,
      voiceIndex: beat.voice.index,
      beatIndex: beat.index
    };

    if (slot?.kind === 'tab' && staff && this.pointer) {
      this.composer.setCursor({
        ...cursor,
        stringIndex: this.hitTest.stringIn(staff, this.pointer.y) - 1
      });
    } else {
      this.composer.setCursor(cursor);
    }

    this.caretStaffIndex = hitIndex;

    if (slot?.kind === 'notation' && staff) this.placeClickedPitch(staff);

    this.scheduleCaretUpdate();
  }

  /** Writes the note the pointer landed on, for standard notation staves. */
  private placeClickedPitch(staff: StaffLines): void {
    if (!this.pointer || !this.state) return;

    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;

    const diatonic = this.hitTest.diatonicIn(staff, bar.clef, this.pointer.y);
    if (diatonic === null) return;

    const pitch = diatonicToPitch(diatonic, bar.keySignature, bar.clefOttava);
    const program =
      this.state.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 0;

    this.caretHalfSteps = diatonic - (bottomLineDiatonic(bar.clef) ?? 0);
    this.alphaTabService.auditionNote(pitchToMidi(pitch), program);
    // Advance so a melody flows, matching fret entry.
    this.composer.setNoteAtCursor(pitch, true);
  }

  private updateCaretOverlay(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const api = this.alphaTabService.getApi();
    const lookup = this.alphaTabService.getBoundsLookup();

    if (!element || !api?.score || !lookup || !this.state || this.caretStaffIndex === null) {
      this.caretRect = null;
      return;
    }

    const cursor = this.state.cursor;
    const beat = api.score.tracks[cursor.trackIndex]
      ?.staves[cursor.staffIndex]
      ?.bars[cursor.barIndex]
      ?.voices[cursor.voiceIndex]
      ?.beats[cursor.beatIndex];

    const bounds = beat ? lookup.findBeat(beat) : null;
    if (!bounds) {
      this.caretRect = null;
      return;
    }

    const halfSteps =
      this.stringCount > 0
        ? this.hitTest.stringToHalfSteps((cursor.stringIndex ?? 0) + 1, this.stringCount)
        : this.caretHalfSteps;

    this.caretRect = this.hitTest.caretRect(
      element,
      this.caretStaffIndex,
      bounds.visualBounds.x,
      bounds.visualBounds.w,
      halfSteps
    );
  }

  /** String count of the staff the caret is on; 0 for non-fretted staves. */
  private get stringCount(): number {
    if (!this.state) return 0;
    return this.composer.staffAt(this.state.doc, this.state.cursor)?.tuning.length ?? 0;
  }
}
