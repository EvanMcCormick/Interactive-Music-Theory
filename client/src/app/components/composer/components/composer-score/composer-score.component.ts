import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerService } from '../../../../services/composer.service';
import {
  StaffSlot,
  caretHalfStepsOf,
  caretSlotIndexOf,
  dragContinues,
  dragExtends,
  dragTargetOf,
  highlightEndsOf,
  hoverKeyOf,
  hoverSurvives,
  penHoverHalfStepsOf,
  PressGuard,
  pressGuardAfter,
  sameCaret,
  scorePressOf,
  scoreRedrawOf,
  scoreTakesPress,
  seeksOnPress,
  snappedHoverX,
  staffSlotsOf,
  writeSounds
} from '../../../../services/composer-score-interaction';
import {
  SystemBands,
  highlightBeatsOf,
  measuredStaffOfSlot,
  pressSystemIndexOf,
  slotIndexAt,
  systemBandsOf,
  systemIndexAt,
  targetTrackBeat
} from '../../../../services/composer-score-systems';
import { BeatRef } from '../../../../services/composer-selection';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { Rect, StaffHitTestService, StaffLines } from '../../../../services/staff-hit-test.service';
import { bottomLineDiatonic, diatonicToPitch, pitchToMidi } from '../../../../services/staff-pitch';
import { ComposerState, EditCursor, ScoreDoc } from '../../../../models/composer.model';

/** The pointer as the last mouse event over the score left it. */
interface Pointer {
  x: number;
  y: number;
  shiftKey: boolean;
  /** `MouseEvent.buttons`: bit 0 is the primary button. See `dragContinues`. */
  buttons: number;
}

/** A staff under the pointer: its index among the measured staves, the slot it draws, and its lines. */
interface StaffUnderPointer {
  index: number;
  slotIndex: number;
  slot: StaffSlot;
  lines: StaffLines;
  /** Its middle line, in bounds lookup pixels: its system, which the press's beat is read on too (`pressSystemIndexOf`). */
  centre: number;
}

/**
 * The engraved score, and the mouse over it.
 *
 * Owns the alphaTab instance, the render pipeline, the caret box, the range highlight and Pen's hover
 * notehead. What a click, a drag, the caret and a redraw mean is decided in `composer-score-interaction.ts`,
 * which has the specs this component cannot; this measures the page with `StaffHitTestService` and calls it.
 *
 * alphaTab's own selection is off (`enableUserInteraction: false`): with it on, a mouse-up sets the
 * playback range, and selecting must never change what the transport plays. The beat mouse events fire
 * either way; the highlight is drawn from state, and a click moves the playback position itself.
 *
 * Mouse only. alphaTab listens for mouse events alone (`HtmlElementContainer`, `mousedown`/`mousemove`/
 * `mouseup`), and so does this. A tap or a stylus press reaches both as the browser's compatibility mouse
 * events, so it moves the caret, seeks, and in Pen writes; but a touch drag scrolls the score rather than
 * selecting, and a touch has no hover notehead. Pointer events are recorded as a follow-up, not built.
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
  // Assigned by Angular before `ngAfterViewInit`, which is the first place it is read.
  @ViewChild('alphaTabContainer') alphaTabContainer!: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();
  /** Coalesces renders so typing does not re-engrave on every keystroke. */
  private readonly renderRequest$ = new Subject<void>();

  state: ComposerState | null = null;
  renderError: string | null = null;

  /** Caret box drawn over the staff, in container-relative pixels. */
  caretRect: Rect | null = null;
  /** Pen's hover notehead, in container-relative pixels, or null. */
  hoverRect: Rect | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedWidth = 0;
  /** Set when a render was skipped because the container had no width yet. */
  private renderPending = false;
  private destroyed = false;
  private pointer: Pointer | null = null;

  /** The document last handed to alphaTab. See `scoreRedrawOf`. */
  private lastRenderedDoc: ScoreDoc | null = null;
  /** The slot (`staffSlotsOf`) last clicked, on whichever system, which the caret stays on while it is the caret's. */
  private clickedSlotIndex: number | null = null;
  /** Where on notation the last click landed, in half line-spacings above the bottom line. */
  private clickedHalfSteps: number | null = null;
  /** Whether moving with the button held extends the range, for the drag the last mouse-down started. */
  private dragging = false;
  /** The staves as last measured, with their middle lines in bounds lookup pixels. See `measure`. */
  private measured: { staves: StaffLines[]; centres: number[] } | null = null;
  /** The systems of the bounds lookup they were read from. See `systems`. */
  private systemsRead: { lookup: alphaTab.rendering.BoundsLookup; systems: SystemBands[] } | null = null;
  /** Drops the measure when lazy loading attaches or detaches a system. See `observeSurface`. */
  private surfaceObserver: MutationObserver | null = null;
  /** The staves the document draws, for the document they were read from. */
  private slotsRead: { doc: ScoreDoc; slots: StaffSlot[] } | null = null;
  /** What the hover notehead last drew, by `hoverKeyOf`, or null for none. */
  private hoverKey: string | null = null;
  /** Whether the press under way closed a popover, and so does nothing here. See `pressGuardAfter`. */
  private pressGuard: PressGuard = 'none';
  /** Set from a render's `renderFinished` to its `postRenderFinished`, while the bounds lookup is still the last render's. */
  private boundsPending = false;
  /** Whether a caret update is already waiting for its frames (`scheduleCaretUpdate`). */
  private caretUpdateScheduled = false;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly hitTest: StaffHitTestService,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone
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
        // The hover notehead goes when Pen does, and when the document changes under it (`hoverSurvives`).
        if (this.hoverKey !== null && !hoverSurvives(this.state, state)) {
          this.hoverKey = null;
          this.hoverRect = null;
        }
        this.state = state;
        // Engrave only a document alphaTab has not been given. A selection, a caret move or an entry mode
        // change redraws what sits over the engraving - otherwise a drag re-engraved the score per beat.
        if (scoreRedrawOf(this.lastRenderedDoc, state.doc) === 'render') this.renderRequest$.next();
        else this.drawHighlight();
        this.scheduleCaretUpdate();
        this.cdr.markForCheck();
      });
  }

  ngAfterViewInit(): void {
    // Outside Angular's zone: alphaTab listens to every pointer move on its surface, and inside the zone
    // each one would run change detection. `AlphaTabService` re-enters the zone for every event it forwards
    // but the beat mouse-move, which a drag enters only to change state.
    this.ngZone.runOutsideAngular(() =>
      this.alphaTabService.initializeApi(this.alphaTabContainer.nativeElement, {
        core: { fontDirectory: '/font/', useWorkers: true },
        display: { scale: 1.0, staveProfile: 'default', layoutMode: 'page' },
        player: {
          enablePlayer: true,
          enableCursor: true,
          // Off: with it on, alphaTab's own mouse-up sets the playback range. See the class comment.
          enableUserInteraction: false,
          soundFont: '/soundfont/sonivox.sf2',
          scrollElement: this.alphaTabContainer.nativeElement
        }
      })
    );

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
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = null;
    const element = this.alphaTabContainer?.nativeElement;
    element?.removeEventListener('mousedown', this.onScorePointerDown, { capture: true });
    element?.removeEventListener('mousemove', this.onScorePointerMove, { capture: true });
    element?.removeEventListener('mouseleave', this.onScorePointerLeave);
    document.removeEventListener('mouseup', this.onDocumentMouseUp, { capture: true });
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
    // Recorded before the attempt: a document the mapper cannot draw is not tried again on every caret move.
    this.lastRenderedDoc = this.state.doc;

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
      this.measured = null;
      this.scheduleCaretUpdate();
    });
    this.resizeObserver.observe(element);
  }

  // -------------------------------------------------------------------------
  // The mouse
  // -------------------------------------------------------------------------

  /**
   * The pointer is read on the container in the capture phase, so its position, Shift and buttons are
   * current when alphaTab's own beat events fire, and outside Angular's zone, since it runs on every move.
   * A mouse-up anywhere on the page ends a drag: alphaTab hears mouse-up only on its own surface. Every
   * render moves the beats, so the highlight is redrawn and the caret re-measured once its bounds lookup is
   * in place (`onPostRenderFinished`), and whenever lazy loading attaches a system (`observeSurface`).
   */
  private wireScoreInteraction(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element) return;

    this.ngZone.runOutsideAngular(() => {
      element.addEventListener('mousedown', this.onScorePointerDown, { capture: true });
      element.addEventListener('mousemove', this.onScorePointerMove, { capture: true });
      element.addEventListener('mouseleave', this.onScorePointerLeave);
      // In the capture phase, so a control that stops a release cannot leave a drag or a closing press running.
      document.addEventListener('mouseup', this.onDocumentMouseUp, { capture: true });
    });
    this.alphaTabService.onBeatMouseDown(beat => this.pressBeat(beat));
    this.alphaTabService.onBeatMouseMove(() => this.dragOverBeat());
    this.alphaTabService.onBeatMouseUp(() => (this.dragging = false));

    // A render replaces the page's systems, so the measure goes at once. The highlight and the caret read
    // bounds, which with workers are still the last render's at `renderFinished`: they wait for post-render.
    // Presses, drags and hover wait for post-render as well (`scoreTakesPress`): until then they would read the new
    // page's staves against the last render's systems and beats.
    this.alphaTabService.onRenderFinished(() => {
      this.measured = null;
      this.boundsPending = true;
    });
    this.alphaTabService.onPostRenderFinished(() => {
      this.measured = null;
      this.boundsPending = false;
      this.drawHighlight();
      this.scheduleCaretUpdate();
    });
    this.observeSurface(element);
  }

  /**
   * Lazy loading (`core.enableLazyLoading`, on by default) attaches a system's partial as it scrolls into view
   * and detaches it as it leaves (`BrowserUiFacade._onElementVisibilityChanged`), with no render event. So any
   * change of children under `.at-surface` drops the measure, and the caret - which may sit on the system just
   * attached - is measured again. The caret and hover boxes, and alphaTab's cursors and highlight, sit outside
   * `.at-surface` and are not counted, so drawing them does not come back here.
   */
  private observeSurface(element: HTMLElement): void {
    if (typeof MutationObserver === 'undefined') return;
    this.ngZone.runOutsideAngular(() => {
      this.surfaceObserver = new MutationObserver(records => {
        if (!records.some(record => isUnderSurface(record.target))) return;
        this.measured = null;
        this.scheduleCaretUpdate();
      });
      this.surfaceObserver.observe(element, { childList: true, subtree: true });
    });
  }

  /**
   * Recomputes the caret once the DOM has settled.
   *
   * markForCheck alone is not enough: these callbacks originate from alphaTab,
   * outside Angular's change detection, so the view is refreshed explicitly as
   * the project's alphaTab guidance recommends. The measure is kept: only a
   * render, a resize or a system attached or detached drops it, never a caret move.
   */
  private scheduleCaretUpdate(): void {
    // One update per pair of frames, however many state changes, renders and attached systems ask for one before it runs.
    if (this.caretUpdateScheduled) return;
    this.caretUpdateScheduled = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.caretUpdateScheduled = false;
        if (this.destroyed) return;
        this.updateCaretOverlay();
        this.cdr.detectChanges();
      })
    );
  }

  /**
   * The press under way closed a popover, and does only that: it moves no caret, seeks nothing and writes nothing
   * (design decision 17). Told by the page while the press's `pointerdown` is still being dispatched, before the
   * `mousedown` that alphaTab turns into a beat press.
   */
  ignoreNextPress(): void {
    this.pressGuard = pressGuardAfter(this.pressGuard, 'popoverClosedByPress');
  }

  private readonly onScorePointerDown = (event: MouseEvent): void => {
    // Before alphaTab hears it: this listens in the capture phase on an ancestor of alphaTab's surface.
    this.pressGuard = pressGuardAfter(this.pressGuard, 'press');
    this.pointer = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, buttons: event.buttons };
  };

  private readonly onScorePointerMove = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, buttons: event.buttons };
    this.updateHover();
  };

  private readonly onScorePointerLeave = (): void => {
    if (this.hoverKey === null) return;
    this.hoverKey = null;
    // Outside the zone: only this component's view changes.
    this.hoverRect = null;
    this.cdr.detectChanges();
  };

  /** The button went up somewhere on the page, which alphaTab may not have heard. */
  private readonly onDocumentMouseUp = (): void => {
    this.dragging = false;
    this.pressGuard = pressGuardAfter(this.pressGuard, 'release');
  };

  /**
   * The rendered staves and their middle lines in bounds lookup pixels, measured once and kept until alphaTab
   * lays the page out again or attaches or detaches a system, rather than measured on every pointer move. An
   * empty measure, before a surface is attached, is not kept.
   */
  private measure(element: HTMLElement): { staves: StaffLines[]; centres: number[] } {
    if (this.measured) return this.measured;
    const staves = this.hitTest.allStaves(element);
    const measured = { staves, centres: this.hitTest.staffCentresIn(element, staves) };
    if (staves.length > 0 && measured.centres.length === staves.length) this.measured = measured;
    return measured;
  }

  /** The systems of the bounds lookup alphaTab holds now (`systemBandsOf`), read once per lookup. */
  private systems(): SystemBands[] {
    const lookup = this.alphaTabService.getBoundsLookup();
    if (!lookup) return [];
    let read = this.systemsRead;
    if (!read || read.lookup !== lookup) read = this.systemsRead = { lookup, systems: systemBandsOf(lookup) };
    return read.systems;
  }

  /** The staves `doc` draws (`staffSlotsOf`), read once per document. */
  private slots(doc: ScoreDoc): StaffSlot[] {
    let read = this.slotsRead;
    if (!read || read.doc !== doc) read = this.slotsRead = { doc, slots: staffSlotsOf(doc) };
    return read.slots;
  }

  /**
   * The staff under the pointer: its index among the measured staves, the slot it draws - found through the
   * system it sits in (`slotIndexAt`) - its lines, and its middle line, which names that system for the beat too.
   */
  private staffUnderPointer(): StaffUnderPointer | null {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element || !this.state || !this.pointer) return null;
    const { staves, centres } = this.measure(element);
    const index = this.hitTest.staffIndexAt(element, this.pointer.x, this.pointer.y, staves);
    const y = index === null ? undefined : centres[index];
    if (index === null || y === undefined) return null;

    const systems = this.systems();
    const systemIndex = systemIndexAt(systems, y);
    if (systemIndex === null) return null;
    const slots = this.slots(this.state.doc);
    const slotIndex = slotIndexAt(systems[systemIndex], y, slots);
    const slot = slotIndex === null ? undefined : slots[slotIndex];
    return slotIndex !== null && slot ? { index, slotIndex, slot, lines: staves[index], centre: y } : null;
  }

  /** The pointer in the bounds lookup's pixels - from the top left of `.at-surface` - or null before a surface exists. */
  private pointerOnSurface(element: HTMLElement): { x: number; y: number } | null {
    const pointer = this.pointer;
    const origin = pointer ? this.hitTest.surfaceOriginOf(element) : null;
    return pointer && origin ? { x: pointer.x - origin.left, y: pointer.y - origin.top } : null;
  }

  /**
   * The beat under the pointer on one track and staff: on the system of the staff under the pointer (`under`) - or, off
   * every staff, the system under the pointer (`pressSystemIndexOf`) - in the master bar under the pointer, that staff's
   * beat (`targetTrackBeat`). Not alphaTab's hit beat, which may belong to another track.
   */
  private beatUnderPointerOn(trackIndex: number, staffIndex: number, under: StaffUnderPointer | null): alphaTab.model.Beat | null {
    const element = this.alphaTabContainer?.nativeElement;
    const lookup = this.alphaTabService.getBoundsLookup();
    const at = element ? this.pointerOnSurface(element) : null;
    if (!lookup || !at) return null;
    const systemIndex = pressSystemIndexOf(this.systems(), under?.centre ?? null, at.y);
    const masterBar = systemIndex === null ? null : lookup.staffSystems[systemIndex]?.findBarAtPos(at.x);
    return masterBar ? targetTrackBeat(masterBar, at.x, trackIndex, staffIndex) : null;
  }

  /**
   * The caret the pointer names: the track, staff and string of the staff under it - or, between staves, the
   * caret's own (`dragTargetOf`) - at that track's beat under the pointer. Null over no beat of that track.
   */
  private cursorUnderPointer(under: StaffUnderPointer | null, current: EditCursor): EditCursor | null {
    const stringIndex = under?.slot.kind === 'tab' && this.pointer ? this.hitTest.stringIn(under.lines, this.pointer.y) - 1 : null;
    const target = dragTargetOf(under ? { slot: under.slot, stringIndex } : null, current);
    const beat = this.beatUnderPointerOn(target.trackIndex, target.staffIndex, under);
    return beat ? { ...target, barIndex: beat.voice.bar.index, voiceIndex: beat.voice.index, beatIndex: beat.index } : null;
  }

  /**
   * A mouse-down on a beat. See `scorePressOf` and `seeksOnPress`. On a staff the caret goes to that staff's
   * beat under the pointer (`cursorUnderPointer`); off every staff, to the beat alphaTab hit, on its own track.
   */
  private pressBeat(beat: alphaTab.model.Beat): void {
    // A press waits for the render's bounds, and the press that closed a popover only closed it (`scoreTakesPress`).
    if (!this.state || !scoreTakesPress(this.boundsPending, this.pressGuard)) return;
    const under = this.staffUnderPointer();
    const mode = this.state.entryMode;
    const cursor = under ? this.cursorUnderPointer(under, this.state.cursor) : beatCursorOf(beat);
    if (!cursor) return;
    const press = scorePressOf(mode, under?.slot.kind ?? null, this.pointer?.shiftKey ?? false);

    if (press === 'extend') {
      this.composer.extendSelectionTo(cursor);
      this.dragging = false;
    } else {
      this.composer.setCursor(cursor);
      // Before any write, which engraves again: the caret's beat is still in the score alphaTab holds.
      if (seeksOnPress(press, this.alphaTabService.getCurrentState().isPlaying)) this.seekToCaret();
      this.dragging = dragExtends(mode, under?.slot.kind ?? null);
      if (under) this.clickedSlotIndex = under.slotIndex;
      if (under?.slot.kind === 'notation') this.rememberNotationClick(under.lines);
      if (press === 'write' && under) this.placeClickedPitch(under.lines);
    }

    this.scheduleCaretUpdate();
  }

  /**
   * A beat crossed after a mouse-down: extends the range to the caret under the pointer, while this drag extends
   * and the button is down. Runs outside Angular's zone on every move alphaTab reports - including every move
   * after a release outside the score, which alphaTab never heard (`onBeatMouseMove`) - and enters the zone only
   * to extend to a caret that differs from the current one.
   */
  private dragOverBeat(): void {
    if (!this.state || this.boundsPending) return;
    if (!dragContinues(this.dragging, this.pointer?.buttons ?? 0)) {
      this.dragging = false;
      return;
    }
    const current = this.state.cursor;
    const cursor = this.cursorUnderPointer(this.staffUnderPointer(), current);
    // A move to another string or voice of the same beat is a new caret too.
    if (cursor && !sameCaret(cursor, current)) this.ngZone.run(() => this.composer.extendSelectionTo(cursor));
  }

  /**
   * Moves the playback position to the caret's beat, on the caret's own track - not alphaTab's hit beat, which
   * may be another track's - in the score alphaTab holds now.
   */
  private seekToCaret(): void {
    const beat = this.engravedBeatOf(this.composer.state.cursor);
    if (beat) this.alphaTabService.seekToBeat(beat);
  }

  /** The beat `ref` names in the score alphaTab holds, if it has one there. */
  private engravedBeatOf(ref: BeatRef): alphaTab.model.Beat | undefined {
    return this.alphaTabService
      .getApi()
      ?.score?.tracks[ref.trackIndex]
      ?.staves[ref.staffIndex]
      ?.bars[ref.barIndex]
      ?.voices[ref.voiceIndex]
      ?.beats[ref.beatIndex];
  }

  /** Records where on a notation staff the click landed, so the caret box sits there. */
  private rememberNotationClick(lines: StaffLines): void {
    if (!this.pointer || !this.state) return;
    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;
    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, this.pointer.y);
    const bottom = bottomLineDiatonic(bar.clef);
    this.clickedHalfSteps = diatonic !== null && bottom !== null ? diatonic - bottom : null;
  }

  /** Writes the note the pointer landed on, for standard notation staves in Pen. */
  private placeClickedPitch(lines: StaffLines): void {
    if (!this.pointer || !this.state) return;

    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;

    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, this.pointer.y);
    if (diatonic === null) return;

    const pitch = diatonicToPitch(diatonic, bar.keySignature, bar.clefOttava);
    const program = this.state.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 0;
    const before = this.state.doc;

    // Advance so a melody flows, matching fret entry.
    this.composer.setNoteAtCursor(pitch, true);
    // A refused write says why on the status line, and sounds nothing (`writeSounds`).
    if (writeSounds(before, this.composer.state.doc)) this.alphaTabService.auditionNote(pitchToMidi(pitch), program);
  }

  /**
   * Pen's hover notehead: rendering only, it never touches the document. Runs outside Angular's zone on
   * every pointer move, and redraws only when what is drawn changes (`hoverKeyOf`) - this component's view
   * alone, with `detectChanges`, never a change detection pass over the whole app.
   */
  private updateHover(): void {
    const hover = this.hoverUnderPointer();
    const key = hover?.key ?? null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hoverRect = hover ? hover.rect() : null;
    this.cdr.detectChanges();
  }

  /**
   * The hover notehead for the pointer now - its key, and how to place it - or null when none is drawn. See
   * `penHoverHalfStepsOf`. The pitch is read under the clef of the bar under the pointer, on the staff under
   * it - not the caret's bar, which may be in another clef. The box is placed only when the key has changed,
   * so a move within one snapped position measures no more than it must.
   */
  private hoverUnderPointer(): { key: string; rect: () => Rect | null } | null {
    const element = this.alphaTabContainer?.nativeElement;
    const state = this.state;
    const pointer = this.pointer;
    if (!element || !state || !pointer || state.entryMode !== 'pen' || this.boundsPending) return null;
    const under = this.staffUnderPointer();
    if (!under) return null;

    const hovered = this.beatUnderPointerOn(under.slot.trackIndex, under.slot.staffIndex, under);
    const bar = hovered ? state.doc.tracks[under.slot.trackIndex]?.staves[under.slot.staffIndex]?.bars[hovered.voice.bar.index] : undefined;
    const diatonic = bar ? this.hitTest.diatonicIn(under.lines, bar.clef, pointer.y) : null;
    const halfSteps = bar ? penHoverHalfStepsOf(state.entryMode, under.slot.kind, diatonic, bar.clef) : null;
    if (halfSteps === null) return null;

    const surface = under.lines.surface.getBoundingClientRect();
    const scale = this.hitTest.scaleOf(under.lines.surface, surface);
    const spacing = under.lines.spacing;
    const x = snappedHoverX((pointer.x - surface.left) / scale, spacing);
    return {
      key: hoverKeyOf(under.index, halfSteps, x, spacing, element.scrollTop),
      rect: () => this.hitTest.caretRect(element, under.index, x - spacing * 0.65, spacing * 1.3, halfSteps, this.measure(element).staves)
    };
  }

  /**
   * Draws the range from state with alphaTab's highlight, or clears it. Called for every selection change,
   * and after every render's bounds arrive, since a render replaces the beats the highlight was drawn on. While
   * a render is in flight the lookup does not know the new beats, so it clears rather than let alphaTab throw
   * (`highlightBeatsOf`); post-render draws it again.
   */
  private drawHighlight(): void {
    const state = this.state;
    const ends = state ? highlightEndsOf(state.doc, state.anchor, state.cursor) : null;
    const beats = highlightBeatsOf(
      ends ? this.engravedBeatOf(ends.first) : undefined,
      ends ? this.engravedBeatOf(ends.last) : undefined,
      this.alphaTabService.getBoundsLookup()
    );
    if (beats) this.alphaTabService.highlightRange(beats.first, beats.last);
    else this.alphaTabService.clearHighlight();
  }

  /**
   * Measures the caret box from state: its slot (`caretSlotIndexOf`), drawn on the system that holds its beat
   * (`measuredStaffOfSlot`), its beat, and its string or pitch. None while that system is not attached.
   */
  private updateCaretOverlay(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const api = this.alphaTabService.getApi();
    const lookup = this.alphaTabService.getBoundsLookup();
    const state = this.state;

    if (!element || !api?.score || !lookup || !state) {
      this.caretRect = null;
      return;
    }

    const cursor = state.cursor;
    const slots = this.slots(state.doc);
    const slotIndex = caretSlotIndexOf(slots, cursor, this.clickedSlotIndex);
    const beat = this.engravedBeatOf(cursor);
    const bounds = beat ? lookup.findBeat(beat) : null;
    const system = bounds?.barBounds.masterBarBounds.staffSystemBounds ?? null;
    const systemBands = system ? this.systems()[system.index] : undefined;
    const { staves, centres } = this.measure(element);
    const staffIndex = slotIndex !== null && systemBands ? measuredStaffOfSlot(systemBands, centres, slotIndex, slots) : null;

    if (slotIndex === null || !bounds || staffIndex === null) {
      this.caretRect = null;
      return;
    }

    const slot = slots[slotIndex];
    const stringCount = this.composer.staffAt(state.doc, cursor)?.tuning.length ?? 0;
    const clicked = slotIndex === this.clickedSlotIndex ? this.clickedHalfSteps : null;
    const halfSteps = caretHalfStepsOf(slot.kind, stringCount, cursor.stringIndex, clicked);

    this.caretRect = this.hitTest.caretRect(
      element,
      staffIndex,
      bounds.visualBounds.x,
      bounds.visualBounds.w,
      halfSteps,
      staves
    );
  }
}

/** Whether a mutation's target is alphaTab's `.at-surface` or inside it: a system's partial attached or detached. */
function isUnderSurface(target: Node): boolean {
  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest('.at-surface') != null;
}

/** A caret on the beat alphaTab hit, on that beat's own track and staff: for a press on no staff. */
function beatCursorOf(beat: alphaTab.model.Beat): Partial<EditCursor> {
  return {
    trackIndex: beat.voice.bar.staff.track.index,
    staffIndex: beat.voice.bar.staff.index,
    barIndex: beat.voice.bar.index,
    voiceIndex: beat.voice.index,
    beatIndex: beat.index
  };
}
