import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import * as alphaTab from '@coderline/alphatab';
import { Subject, debounceTime, takeUntil } from 'rxjs';

import { ProgressionDoc } from '../../../../models/progression.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { messageOf } from '../../../../services/error-message';
import { progressionToScore } from '../../../../services/progression-score';
import { ProgressionService } from '../../../../services/progression.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';

/**
 * The progression, engraved.
 *
 * `progression-score.ts` does the projection and `ScoreDocMapperService` the
 * handoff to alphaTab; this component is the part that has to decide *when*
 * both of those run. It wires itself to `ProgressionService` and takes no
 * inputs, like the four components beside it - see `ProgressionComponent`.
 *
 * ## On demand to open, live while open
 *
 * Both, and the split is where the cost is. Closed, this draws nothing and
 * *initialises* nothing: `initializeApi` is what fetches alphaTab's music font
 * and starts its workers, and a page that paid for an engraver on load to show
 * a panel most sessions never open would be paying for it on every visit. So
 * there is no api until the panel is opened, and `dispose` takes it away again
 * when it closes - the `@ViewChild` setter below is the whole of that, because
 * the container itself only exists while the panel is open.
 *
 * Open, it follows the document. A preview a user has to press a button to
 * refresh is a preview they will read while it is stale, which on this page
 * means reading last edit's rhythm.
 *
 * ### Why the debounce is a timer and not an edit boundary
 *
 * "Re-render on each edit" is not implementable as stated, and the reason is
 * worth writing down. The roll's drag setters *coalesce*: `EditOptions.coalesce`
 * folds a drag into one undo entry, but it does that by committing on every
 * threshold the pointer crosses and merging the history entries afterwards. So
 * a drag publishes a state per threshold - which is the point, the note has to
 * follow the pointer - and there is no "the edit finished" event to listen for.
 * A pointer-up would only cover the roll's gestures, and would say nothing about
 * a key change or a chord swap.
 *
 * A trailing debounce answers the question the boundary was a proxy for: draw
 * when the user stops moving. `RENDER_DEBOUNCE_MS` is
 * `TranscriptionReviewComponent`'s, whose preview has the same problem with a
 * slider.
 */
const RENDER_DEBOUNCE_MS = 120;

@Component({
  selector: 'app-progression-notation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progression-notation.component.html',
  styleUrls: ['./progression-notation.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgressionNotationComponent implements OnInit, OnDestroy {
  /** Whether the panel is showing notation, and so whether anything is drawn. */
  isOpen = false;

  /** Bars the progression occupies, whether or not they all fit. */
  barCount = 0;

  /** Set when the progression is longer than the preview will draw. */
  truncatedTo: number | null = null;

  /** What went wrong drawing it, or null. */
  renderError: string | null = null;

  private readonly progression = inject(ProgressionService);
  private readonly alphaTab = inject(AlphaTabService);
  private readonly mapper = inject(ScoreDocMapperService);
  private readonly changes = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();
  private readonly renderRequest$ = new Subject<void>();

  /** The document last published, drawn whenever the panel is open. */
  private latest: ProgressionDoc | null = null;

  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * True when a render was asked for and refused because the container had no
   * width yet. alphaTab logs "skipped rendering because of width=0" and never
   * retries, so the observer below has to.
   */
  private renderPending = false;
  private lastRenderedWidth = 0;

  /**
   * Set up and torn down as the panel opens and closes.
   *
   * A setter rather than a query read in `ngAfterViewInit`, because the element
   * is behind an `*ngIf` and so does not exist until the panel is opened: the
   * setter is called with the element when Angular inserts it and with
   * `undefined` when it takes it away, which is exactly the pair of moments the
   * api has to be created and destroyed at.
   */
  @ViewChild('previewContainer')
  set previewContainer(reference: ElementRef<HTMLDivElement> | undefined) {
    const element = reference?.nativeElement ?? null;
    if (element === this.container) return;

    if (!element) {
      this.teardown();
      return;
    }

    this.container = element;
    this.alphaTab.initializeApi(element, {
      core: { fontDirectory: '/font/', useWorkers: true },
      display: { scale: 0.9, staveProfile: 'default', layoutMode: 'page' },
      // No player. This is a preview to read; the progression's own transport
      // is three rows up, and a soundfont is a megabyte to fetch for a second
      // way to hear the same thing.
      player: { enablePlayer: false, enableCursor: false, enableUserInteraction: false }
    });

    this.observeContainerWidth(element);
    this.renderRequest$.next();
  }

  ngOnInit(): void {
    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.latest = state.doc;
        // Only while open: a closed panel has no api to draw with, and
        // projecting a document nobody is looking at is work for nothing.
        if (this.isOpen) this.renderRequest$.next();
      });

    this.renderRequest$
      .pipe(debounceTime(RENDER_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe(() => this.render());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.teardown();
  }

  /**
   * Opens or closes the panel.
   *
   * Closing disposes the engraver, through the `@ViewChild` setter: leaving one
   * alive behind a hidden panel would hold alphaTab's workers for the rest of
   * the session, and `AlphaTabService` holds a single api that the composer
   * route will want when the user navigates to it.
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) this.renderRequest$.next();
  }

  /**
   * Projects the document and hands it to alphaTab.
   *
   * The projection runs before the width check, so the bar count and the
   * truncation notice are right even when the drawing is deferred - those are
   * facts about the progression rather than about the canvas.
   *
   * **Everything that can throw is inside the try**, the projection included.
   * This runs from a subscription, and an error out of an RxJS handler
   * terminates the subscription that raised it: one bad document would not
   * merely fail to draw, it would leave a panel that never drew again and said
   * nothing about why. `quantizeBar` throws on a meter its grid cannot express,
   * which is the reachable case.
   */
  private render(): void {
    const element = this.container;
    const doc = this.latest;
    if (!this.isOpen || !element || !doc || !this.alphaTab.getApi()) return;

    try {
      const projected = progressionToScore(doc);
      this.barCount = projected.barCount;
      this.truncatedTo = projected.truncated ? projected.doc.masterBars.length : null;

      if (element.clientWidth === 0) {
        this.renderPending = true;
        this.changes.markForCheck();
        return;
      }
      this.renderPending = false;

      const score = this.mapper.toScore(projected.doc, new alphaTab.Settings());
      this.alphaTab.renderScore(
        score,
        score.tracks.map((_, index) => index)
      );
      this.renderError = null;
    } catch (error) {
      // A projection or a mapping that throws must not take the page with it:
      // the roll above is still editable and the transport still plays.
      this.renderError = `Could not draw the notation: ${messageOf(error)}`;
    }

    this.changes.markForCheck();
  }

  /** Redraws once the panel has actually been laid out, and on every resize. */
  private observeContainerWidth(element: HTMLDivElement): void {
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;

      if (this.renderPending) this.render();
      else if (width !== this.lastRenderedWidth) this.alphaTab.render();

      this.lastRenderedWidth = width;
    });
    this.resizeObserver.observe(element);
  }

  /**
   * Gives back the engraver and the observer, in either order of arrival.
   *
   * The readouts are cleared with them, because they describe a drawing that no
   * longer exists: a panel reopened after an edit would otherwise show the old
   * bar count, the old truncation notice and - worst of the three - a stale
   * error banner over a score that draws perfectly well, for the 120 ms until
   * the debounce catches up.
   */
  private teardown(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.lastRenderedWidth = 0;
    this.renderPending = false;
    this.barCount = 0;
    this.truncatedTo = null;
    this.renderError = null;

    if (!this.container) return;
    this.container = null;
    this.alphaTab.dispose();
  }
}
