import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { ComposerShortcutSheetComponent } from './components/composer-shortcut-sheet/composer-shortcut-sheet.component';
import { ComposerStatusLineComponent } from './components/composer-status-line/composer-status-line.component';
import { ComposerTrackStripComponent } from './components/composer-track-strip/composer-track-strip.component';
import { AlphaTabState } from '../../models/alpha-tab.model';
import { ComposerState, ScoreDoc, TexDiagnostic } from '../../models/composer.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
import { ComposerKeyHandler } from '../../services/composer-key-handler';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
import { ComposerSaveRequests } from '../../services/composer-save-requests.service';
import { pressesFocusedControl } from '../../services/editable-target';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, PopoverKind, shortcutTitleOf } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';

/** What the status line says when a save meets an alphaTex draft that has been edited and not applied. */
const TEX_DRAFT_UNSAVED = 'Apply or revert the alphaTex draft before saving.';

/** What the status line and the panel say when that draft was written against a score that has changed since. */
const TEX_DRAFT_OUT_OF_DATE =
  'The alphaTex draft was written against an earlier score; revert it, or apply it to replace the changes made since.';

/** The shortest the track strip can be dragged, in pixels: about one row and the add-track controls. */
const STRIP_MIN_HEIGHT = 72;

/** The least height the strip leaves the score, in pixels, as the page's styles give the score (`10rem`). */
const SCORE_MIN_HEIGHT = 160;

/** How far one arrow key moves the strip's separator, in pixels. */
const STRIP_KEY_STEP = 16;

/** The heights the track strip may take, which its separator announces as its range. */
export interface StripHeightRange {
  min: number;
  max: number;
}

/**
 * The heights the strip may take in a page `pageHeight` tall whose other fixed rows - the top bar, the status line and
 * the separator - take `fixedRowsHeight`: from one row up to what leaves the score its minimum, and never less than one
 * row, however short the page.
 */
export function stripHeightRangeOf(pageHeight: number, fixedRowsHeight: number): StripHeightRange {
  return { min: STRIP_MIN_HEIGHT, max: Math.max(STRIP_MIN_HEIGHT, Math.floor(pageHeight - fixedRowsHeight - SCORE_MIN_HEIGHT)) };
}

/** `height` clamped to `range`, in whole pixels. */
export function clampedStripHeight(height: number, range: StripHeightRange): number {
  return Math.max(range.min, Math.min(range.max, Math.round(height)));
}

/**
 * The composer page: top bar, palette, score, status line and track strip, in one grid.
 *
 * Holds no document state - that is `ComposerService`'s - only what the page presents: which popover
 * is open, whether the shortcut sheet is, the alphaTex draft, and how tall the strip is. It is the
 * `ComposerToolHost` every tool runs against, so a palette press and a key press run one command. The
 * keyboard is `ComposerKeyHandler`'s, fret digits are `FretDigitEntry`'s, the track rows are the strip's,
 * and save, load and export are the library panel's.
 */
@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
    ComposerScoreComponent,
    ComposerShortcutSheetComponent,
    ComposerStatusLineComponent,
    ComposerTrackStripComponent
  ],
  templateUrl: './composer.component.html',
  styleUrls: ['./composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(ComposerTrackStripComponent) private strip?: ComposerTrackStripComponent;
  /** The score's element, where a text selection is the score's own rather than the page's. */
  @ViewChild('score', { read: ElementRef }) private scoreElement?: ElementRef<HTMLElement>;
  /** The page grid, and the rows the strip's range is measured against (`fitStrip`). */
  @ViewChild('page') private page?: ElementRef<HTMLElement>;
  @ViewChild('topBar') private topBar?: ElementRef<HTMLElement>;
  @ViewChild('statusLine', { read: ElementRef }) private statusLine?: ElementRef<HTMLElement>;
  @ViewChild('stripSeparator') private stripSeparator?: ElementRef<HTMLElement>;

  private readonly destroy$ = new Subject<void>();

  state: ComposerState | null = null;
  playerState: AlphaTabState | null = null;

  texDraft = '';
  texDiagnostics: TexDiagnostic[] = [];
  showTexPanel = false;
  /** What the panel says while an edited draft is out of date (`texDraftOutOfDate`). */
  readonly texOutOfDate = TEX_DRAFT_OUT_OF_DATE;
  /**
   * The alphaTex the draft was seeded from, or last applied as: a draft still equal to it has not been typed into, so it
   * follows the score as the score changes, and never stands in the way of a save.
   */
  private texDraftBase = '';
  /** The document the draft was written against: once the score is another, an edited draft is out of date. */
  private texDraftDoc: ScoreDoc | null = null;
  /**
   * Why the alphaTex draft is in the way, for the status line: an apply that could not parse, or a save
   * refused while the draft is not applied. Cleared by a good apply, a revert, and closing the panel.
   */
  texApplyError: string | null = null;
  /**
   * Which saying of `texApplyError` it is, moved on each time the page says it, so the status line replaces the
   * message's node and a screen reader reads the same words again - as `ComposerState.messageId` does for a refusal.
   */
  texErrorId = 0;

  metronomeEnabled = false;
  countInEnabled = false;

  /** The valued tool whose popover is open. The page holds it, because a key can open one as well as a button. */
  popover: PopoverKind | null = null;
  sheetOpen = false;
  stripHeight = 180;
  /** The heights the strip may take, measured from the page as laid out (`fitStrip`); the window's until it is. */
  stripRange: StripHeightRange = stripHeightRangeOf(window.innerHeight, 0);
  /** Measures the strip's range again when the page or its top bar changes size, and clamps the strip to it. */
  private pageObserver: ResizeObserver | null = null;

  /** Undo's and Redo's tooltips, with the keys the platform's keyboard writes: Ctrl+Z, or ⌘+Z on a Mac. */
  readonly undoTitle: string = shortcutTitleOf('undo', inject(KEY_PLATFORM));
  readonly redoTitle: string = shortcutTitleOf('redo', inject(KEY_PLATFORM));

  /** What every tool runs against. */
  readonly host: ComposerToolHost;

  private readonly keyHandler: ComposerKeyHandler;
  private readonly fretEntry: FretDigitEntry;
  /** Where a drag of the strip's separator started, while one is under way. */
  private stripDrag: { startY: number; startHeight: number } | null = null;
  /** Takes the page's save guard back off `ComposerSaveRequests`. */
  private removeSaveGuard: () => void = () => undefined;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly texService: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.fretEntry = new FretDigitEntry(composer, () => Date.now(), midi =>
      this.alphaTabService.auditionNote(midi, this.currentTrackProgram)
    );
    this.host = {
      composer,
      // A popover's own button, or its key, closes it when it is the one open, as a disclosure button does.
      openPopover: kind => this.present(() => (this.popover = this.popover === kind ? null : kind)),
      toggleShortcutSheet: () => this.present(() => this.toggleShortcutSheet()),
      escape: () =>
        this.present(() => {
          // An open popover takes Escape alone - as the popover itself does when it has the focus - and so does the
          // open shortcut sheet, a modal over the score: the press that closes either does not also drop the range.
          if (this.popover) {
            this.popover = null;
            return;
          }
          if (this.sheetOpen) {
            this.sheetOpen = false;
            return;
          }
          composer.setEntryMode('select');
          composer.setCursor({});
        }),
      playPause: () => this.alphaTabService.playPause(),
      // Stop rewinds to the start, so stop then play is play from the start.
      playFromStart: () => {
        this.alphaTabService.stop();
        this.alphaTabService.play();
      },
      requestSave: () => {
        if (!this.refusesSaveForDraft()) this.saveRequests.request();
      },
      addTrack: () => this.strip?.addTrack(),
      typeFretDigit: digit => this.fretEntry.type(digit)
    };
    // The score's element, so a text selection inside the score does not stop Ctrl+C and Ctrl+X copying beats.
    // And the sheet's state: while it is open, only its own key and Escape reach the tools, so no key edits the score
    // hidden behind it (`TOOLS_OVER_A_MODAL`), and a Ctrl, Alt or Cmd press is claimed and dropped, so the browser's own
    // shortcuts do not act behind it either.
    this.keyHandler = new ComposerKeyHandler(
      this.host,
      COMPOSER_TOOLS,
      () => this.scoreElement?.nativeElement ?? null,
      () => this.sheetOpen
    );
  }

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        const docChanged = this.state !== null && state.doc !== this.state.doc;
        this.state = state;
        // An untouched draft follows the score - an edit, a load, New - so it never refuses a save. One typed into is left
        // as typed, and is out of date from here (`texDraftOutOfDate`).
        if (docChanged && this.showTexPanel && !this.texDraftEdited) this.seedTexDraft();
        this.cdr.markForCheck();
      });

    this.alphaTabService
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.playerState = state;
        // alphaTab events originate outside Angular's zone.
        this.cdr.detectChanges();
      });

    // Save in the Library menu asks the same question Ctrl+S does (`requestSave`).
    this.removeSaveGuard = this.saveRequests.guard(() => this.refusesSaveForDraft());
  }

  /**
   * Watches the page and its top bar, which wraps on a narrow window, and fits the strip to the room they leave. The
   * observer's first report comes after layout, outside any template pass, so the bound height and range change there.
   */
  ngAfterViewInit(): void {
    const page = this.page?.nativeElement;
    if (!page || typeof ResizeObserver === 'undefined') return;
    this.pageObserver = new ResizeObserver(() => {
      const before = `${this.stripHeight}:${this.stripRange.max}`;
      this.fitStrip();
      if (`${this.stripHeight}:${this.stripRange.max}` !== before) this.cdr.detectChanges();
    });
    this.pageObserver.observe(page);
    if (this.topBar) this.pageObserver.observe(this.topBar.nativeElement);
  }

  ngOnDestroy(): void {
    this.pageObserver?.disconnect();
    this.removeSaveGuard();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * The page's one keyboard listener. See `ComposerKeyHandler` for what it takes and what it leaves. Space
   * and Enter on a button focused from the keyboard - a palette tool, a menu item, a track row's Update - press
   * that button, so the handler is not asked (`pressesFocusedControl`). A held Enter presses it again on every
   * repeat, so a repeat is dropped unless the button is a tool whose key repeats (`ComposerTool.repeatable`).
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (pressesFocusedControl(event)) {
      if (event.key === 'Enter' && event.repeat && !this.repeatableToolAt(event.target)) event.preventDefault();
      return;
    }
    this.keyHandler.handle(event);
  }

  /** Whether `target` is a palette button whose tool a held key runs again. */
  private repeatableToolAt(target: EventTarget | null): boolean {
    const id = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-tool]')?.dataset['tool'] : undefined;
    return COMPOSER_TOOLS.some(tool => tool.id === id && tool.repeatable === true);
  }

  /** A palette press runs the same tool, against the same host, as its key. */
  runTool(tool: ComposerTool): void {
    tool.run(this.host, null);
  }

  closePopover(): void {
    this.popover = null;
  }

  /**
   * Opens or closes the shortcut sheet. Opening it closes an open popover: the popover is in the top layer, so it would
   * stay above the sheet, inside a palette gone inert, and take the first Escape and none of the backdrop's clicks.
   */
  toggleShortcutSheet(): void {
    this.sheetOpen = !this.sheetOpen;
    if (this.sheetOpen) this.popover = null;
  }

  closeShortcutSheet(): void {
    this.sheetOpen = false;
  }

  /**
   * The score's host, where the shortcut sheet gives the focus back when what had it before is gone. A function the
   * sheet asks as it closes: `scoreElement` is a view query inside `*ngIf`, unset when the sheet's input is first bound.
   */
  readonly scoreHost = (): HTMLElement | null => this.scoreElement?.nativeElement ?? null;

  /** The program of the caret's track, for auditioning a typed fret on its own sound. */
  get currentTrackProgram(): number {
    return this.state?.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 25;
  }

  // -------------------------------------------------------------------------
  // Transport and score info
  // -------------------------------------------------------------------------

  playPause(): void {
    this.alphaTabService.playPause();
  }

  stop(): void {
    this.alphaTabService.stop();
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
    this.alphaTabService.setMetronomeVolume(this.metronomeEnabled ? 1 : 0);
  }

  toggleCountIn(): void {
    this.countInEnabled = !this.countInEnabled;
    this.alphaTabService.setCountInVolume(this.countInEnabled ? 1 : 0);
  }

  onTempoChange(value: string): void {
    const tempo = Number(value);
    if (!Number.isNaN(tempo)) this.composer.setTempo(tempo);
  }

  onTitleChange(value: string): void {
    this.composer.updateScoreInfo({ title: value });
  }

  undo(): void {
    this.composer.undo();
  }

  redo(): void {
    this.composer.redo();
  }

  newScore(): void {
    this.composer.reset();
  }

  // -------------------------------------------------------------------------
  // The track strip's height
  // -------------------------------------------------------------------------

  onStripResizeStart(event: PointerEvent): void {
    this.fitStrip();
    this.stripDrag = { startY: event.clientY, startHeight: this.stripHeight };
    // Captured, so the drag keeps its pointer when it leaves the thin separator.
    if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId);
  }

  onStripResize(event: PointerEvent): void {
    if (!this.stripDrag) return;
    this.stripHeight = clampedStripHeight(this.stripDrag.startHeight + this.stripDrag.startY - event.clientY, this.stripRange);
  }

  onStripResizeEnd(): void {
    this.stripDrag = null;
  }

  /**
   * The separator's keys, as a separator's are: ↑ and ↓ a step, Home the shortest and End the tallest. Stopped here, so
   * the page's keyboard listener does not also move the caret with the same press.
   */
  onStripResizeKey(event: KeyboardEvent): void {
    const heightFor: Readonly<Record<string, (range: StripHeightRange) => number>> = {
      ArrowUp: () => this.stripHeight + STRIP_KEY_STEP,
      ArrowDown: () => this.stripHeight - STRIP_KEY_STEP,
      Home: range => range.min,
      End: range => range.max
    };
    const next = heightFor[event.key];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    this.fitStrip();
    this.stripHeight = clampedStripHeight(next(this.stripRange), this.stripRange);
  }

  /**
   * Measures the strip's range from the page as it is laid out - its height, less the top bar, the status line and the
   * separator (`stripHeightRangeOf`) - and clamps the strip to it.
   */
  private fitStrip(): void {
    const page = this.page?.nativeElement;
    if (!page) return;
    const fixedRows = [this.topBar, this.statusLine, this.stripSeparator].reduce((sum, row) => sum + (row?.nativeElement.offsetHeight ?? 0), 0);
    this.stripRange = stripHeightRangeOf(page.clientHeight, fixedRows);
    this.stripHeight = clampedStripHeight(this.stripHeight, this.stripRange);
  }

  // -------------------------------------------------------------------------
  // alphaTex escape hatch
  // -------------------------------------------------------------------------

  /** Opens or closes the alphaTex panel. Either way its message goes: it was about a draft that is gone or new. */
  toggleTexPanel(): void {
    this.showTexPanel = !this.showTexPanel;
    this.texApplyError = null;
    if (this.showTexPanel) {
      this.seedTexDraft();
      this.texDiagnostics = [];
    }
    this.cdr.markForCheck();
  }

  /** Whether the draft has been typed into since it was seeded, reverted or applied. */
  get texDraftEdited(): boolean {
    return this.texDraft !== this.texDraftBase;
  }

  /** Whether the open panel's draft has been typed into and the score has changed since it was written. */
  get texDraftOutOfDate(): boolean {
    return this.showTexPanel && this.texDraftEdited && this.state?.doc !== this.texDraftDoc;
  }

  /** Seeds the draft from the score as it is now. */
  private seedTexDraft(): void {
    this.texDraft = this.texDraftBase = this.currentTex();
    this.texDraftDoc = this.state?.doc ?? null;
  }

  /** Canonical alphaTex for the current document, generated on demand. */
  private currentTex(): string {
    if (!this.state) return '';
    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      return this.texService.export(score);
    } catch {
      return '';
    }
  }

  /**
   * Refuses a save while the alphaTex panel is open on a draft that has been typed into, saying why in the status
   * line. A save writes the document, not the draft, so saving then would leave what is in the text box unsaved
   * without a word - and Ctrl+S runs from the textarea itself (`inTextFields`). A draft written against an earlier
   * score says so, since applying it would replace what changed since. An untouched draft follows the score and
   * refuses nothing, and no alphaTex is built to ask.
   */
  private refusesSaveForDraft(): boolean {
    if (!this.showTexPanel || !this.texDraftEdited) return false;
    this.texApplyError = this.texDraftOutOfDate ? TEX_DRAFT_OUT_OF_DATE : TEX_DRAFT_UNSAVED;
    this.texErrorId++;
    this.cdr.markForCheck();
    return true;
  }

  /**
   * Applies the draft as an edit of this composition, on the undo stack (`replaceDocument`). A draft out of date would
   * replace the changes made since it was written, so that is asked first.
   */
  applyTex(): void {
    if (this.texDraftOutOfDate && !confirm('The alphaTex draft was written against an earlier score. Apply it anyway, replacing the changes made since?')) {
      return;
    }
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;

    if (!result.score) {
      // Keep the last good document; the diagnostics explain the failure, and the status line says so.
      this.texApplyError = 'alphaTex could not be parsed. The score is unchanged.';
      this.texErrorId++;
      this.cdr.markForCheck();
      return;
    }

    this.texApplyError = null;
    this.composer.replaceDocument(this.mapper.toDoc(result.score));
    // The score is now what the draft says: the draft counts as untouched from here, and follows the next change.
    this.texDraftBase = this.texDraft;
    this.texDraftDoc = this.composer.doc;
    this.cdr.markForCheck();
  }

  revertTex(): void {
    this.seedTexDraft();
    this.texDiagnostics = [];
    this.texApplyError = null;
  }

  /** Runs a change the host makes from outside a template event, and marks the page for checking. */
  private present(change: () => void): void {
    change();
    this.cdr.markForCheck();
  }
}
