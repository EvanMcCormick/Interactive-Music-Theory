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
import { TabHitTestService } from '../../../../services/tab-hit-test.service';
import { ComposerState } from '../../../../models/composer.model';

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

  /** Caret box drawn over the tab staff, in container-relative pixels. */
  caretRect: { left: number; top: number; width: number; height: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedWidth = 0;
  /** Set when a render was skipped because the container had no width yet. */
  private renderPending = false;
  private destroyed = false;
  private pointer: { x: number; y: number } | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly tabHitTest: TabHitTestService,
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
      this.alphaTabService.renderScore(score);
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
   * Clicking the tab moves the caret there, as in Guitar Pro; the fret is then
   * typed on the keyboard.
   *
   * alphaTab resolves which beat was hit. It has no notion of which string line
   * the pointer landed on, because a bar's bounds span the notation and tab
   * staves together, so the pointer position is captured in the capture phase
   * and resolved against the measured tab geometry.
   */
  private wireScoreInteraction(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element) return;

    element.addEventListener('mousedown', this.onScorePointerDown, { capture: true });

    this.alphaTabService.onBeatMouseDown(beat => this.selectBeat(beat));

    // alphaTab attaches the rendered surface after this event, so measuring
    // has to wait for the DOM to settle. Two frames covers append plus layout.
    this.alphaTabService.onRenderFinished(() => this.scheduleCaretUpdate());
  }

  /**
   * Recomputes the caret once the DOM has settled.
   *
   * markForCheck alone is not enough here: these callbacks originate from
   * alphaTab, outside Angular's own change detection, so the view is refreshed
   * explicitly as the project's alphaTab guidance recommends.
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

  private selectBeat(beat: alphaTab.model.Beat): void {
    const element = this.alphaTabContainer?.nativeElement;
    // Measure against the staff that was actually clicked, which on a
    // multi-track score need not be the one the caret is currently on.
    const stringCount = beat.voice.bar.staff.stringTuning.tunings.length;

    const hit =
      element && this.pointer
        ? this.tabHitTest.stringAt(element, stringCount, this.pointer.x, this.pointer.y)
        : null;

    this.composer.setCursor({
      trackIndex: beat.voice.bar.staff.track.index,
      staffIndex: beat.voice.bar.staff.index,
      barIndex: beat.voice.bar.index,
      voiceIndex: beat.voice.index,
      beatIndex: beat.index,
      ...(hit !== null ? { stringIndex: hit - 1 } : {})
    });

    this.scheduleCaretUpdate();
  }

  private updateCaretOverlay(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const api = this.alphaTabService.getApi();
    const lookup = this.alphaTabService.getBoundsLookup();

    if (!element || !api?.score || !lookup || !this.state || this.stringCount === 0) {
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
    this.caretRect = bounds
      ? this.tabHitTest.caretRect(
          element,
          this.stringCount,
          bounds.visualBounds.x,
          bounds.visualBounds.w,
          (cursor.stringIndex ?? 0) + 1
        )
      : null;
  }

  /** String count of the staff the caret is on; 0 for non-fretted staves. */
  private get stringCount(): number {
    if (!this.state) return 0;
    return this.composer.staffAt(this.state.doc, this.state.cursor)?.tuning.length ?? 0;
  }
}
