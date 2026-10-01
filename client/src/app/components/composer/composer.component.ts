import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  ErrorHandler,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { ComposerConvertPromptComponent } from './components/composer-convert-prompt/composer-convert-prompt.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScalePanelComponent } from './components/composer-scale-panel/composer-scale-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { ComposerShortcutSheetComponent } from './components/composer-shortcut-sheet/composer-shortcut-sheet.component';
import { ComposerStatusLineComponent } from './components/composer-status-line/composer-status-line.component';
import { ComposerTrackStripComponent } from './components/composer-track-strip/composer-track-strip.component';
import { AlphaTabState, DEFAULT_HIGHLIGHT_CONFIG, HighlightConfig } from '../../models/alpha-tab.model';
import { ComposerState, EditCursor, ScoreDoc, TexDiagnostic } from '../../models/composer.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ASKING_PAGE_COMMANDS } from '../../services/composer-edit-intent';
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { GpConversionService } from '../../services/gp-conversion.service';
import { GpFileOpener } from '../../services/gp-file-opener.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
import { ComposerKeyHandler } from '../../services/composer-key-handler';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
import { ComposerSaveRequests } from '../../services/composer-save-requests.service';
import { pressesFocusedControl } from '../../services/editable-target';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, PopoverKind, shortcutTitleOf } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';
import { SPEED_RANGE, clockTimeOf } from '../../services/transport-time';

/** What the status line says when a save meets an alphaTex draft that has been edited and not applied. */
const TEX_DRAFT_UNSAVED = 'Apply or revert the alphaTex draft before saving.';

/** What the status line and the panel say when that draft was written against a score that has changed since. */
const TEX_DRAFT_OUT_OF_DATE =
  'The alphaTex draft was written against an earlier score; revert it, or apply it to replace the changes made since.';

/** The shortest the track strip can be dragged, in pixels: about one row and the add-track controls. */
const STRIP_MIN_HEIGHT = 72;

/**
 * The least height the strip leaves the score, in pixels, where the score's own minimum cannot be read: `10rem` at a 16px
 * root font. `fitStrip` reads the minimum the page's styles give the score, which follows the root font size.
 */
const SCORE_MIN_HEIGHT = 160;

/** How far one arrow key moves the strip's separator, in pixels. */
const STRIP_KEY_STEP = 16;

/** The heights the track strip may take, which its separator announces as its range. */
export interface StripHeightRange {
  min: number;
  max: number;
}

/**
 * The heights the strip may take in a page `pageHeight` tall whose other fixed rows - the top bar, the status line, the
 * separator, and the alphaTex panel while it is open - take `fixedRowsHeight`: from one row up to what leaves the score
 * `scoreMinHeight`, and never less than one row, however short the page.
 */
export function stripHeightRangeOf(pageHeight: number, fixedRowsHeight: number, scoreMinHeight = SCORE_MIN_HEIGHT): StripHeightRange {
  return { min: STRIP_MIN_HEIGHT, max: Math.max(STRIP_MIN_HEIGHT, Math.floor(pageHeight - fixedRowsHeight - scoreMinHeight)) };
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
    ComposerConvertPromptComponent,
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
    ComposerScalePanelComponent,
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
  /** The alphaTex panel while it is open: a row the strip leaves room for, watched as its diagnostics grow (`fitStrip`). */
  @ViewChild('texPanel') private set texPanelRef(ref: ElementRef<HTMLElement> | undefined) {
    const panel = ref?.nativeElement ?? null;
    if (panel === this.texPanel) return;
    if (this.texPanel) {
      this.pageObserver?.unobserve(this.texPanel);
      // A panel that opens is observed, and that first report fits the strip; one that closes is reported by nothing, since
      // the page and the rows left are the size they were. So the strip is fitted here, past the view query that found the
      // panel gone, where the bound height and range may change.
      queueMicrotask(() => this.refitStrip());
    }
    this.texPanel = panel;
    if (panel) this.pageObserver?.observe(panel);
  }
  private texPanel: HTMLElement | null = null;

  private readonly destroy$ = new Subject<void>();

  state: ComposerState | null = null;
  playerState: AlphaTabState | null = null;
  /**
   * The `.gp` file the page is showing, or null in Composition (`ComposerGpService`).
   *
   * What it changes about the page is what the page can honestly show: there is no document to undo, to set a BPM
   * on, or to rename, so those controls read the file and take no input. The palette, the keys and the popovers
   * stay live - the first command that would change the document asks instead.
   */
  original: GpOriginal | null = null;
  /** In Original, the file's caret, which the status line reads out (`ComposerGpService.caret`); null in Composition. */
  fileCursor: EditCursor | null = null;
  /** The command waiting on the conversion prompt, which is open while there is one (`ComposerGpService.requestEdit`). */
  editRequest: EditRequest | null = null;
  /**
   * Whether a conversion is under way: the prompt's Convert does not start a second, and nothing cancels it - Cancel,
   * Escape and the backdrop do nothing, and the page stays inert (`modalOpen`) - since closing the prompt would not stop
   * it: the file would still be converted, and the edit applied, behind a page taking input again.
   */
  converting = false;

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
   * The composition the draft was written for (`ComposerState.documentId`). Once another is open - a load, New, an opened
   * transcription - the draft is thrown away and seeded again: applied, it would be an edit of the wrong composition.
   */
  private texDraftDocumentId: number | null = null;
  /** Takes the edited draft back out of the unsaved work a new composition asks about (`confirmDiscard`). */
  private releaseUnsavedDraft: () => void = () => undefined;
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

  /** The scale panel's highlight, which the score draws, in either state. */
  highlight: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG;

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
  /** Set once the page is destroyed, so a fit waiting on a microtask does not draw into a destroyed view. */
  private destroyed = false;

  /** Whether the page is showing a `.gp` file as alphaTab read it. */
  get viewingOriginal(): boolean {
    return this.original !== null;
  }

  /** Why the prompt's Convert cannot run now: one is already under way. */
  get convertRefusal(): string | null {
    return this.converting ? 'Converting…' : null;
  }

  /**
   * Whether a modal is open over the page - the shortcut sheet, or the conversion prompt - so the rest of the page is
   * `inert` and the keys reach only what a modal takes (`ComposerKeyHandler`). A conversion under way counts until it
   * settles: it drops the request that opened the prompt as it converts, before the edit that asked has run.
   */
  get modalOpen(): boolean {
    return this.sheetOpen || this.editRequest !== null || this.converting;
  }

  /** The title shown: the composition's, or the file's own - its score title, or its file name where it has none. */
  get titleText(): string {
    if (this.original) return this.original.score.title || this.original.fileName;
    return this.state?.doc.title ?? '';
  }

  /** The BPM shown beside the transport: the composition's, or the file's own. */
  get tempoValue(): number {
    if (this.original) return this.original.score.tempo;
    return this.state?.doc.tempo ?? 120;
  }

  /** In Original, how many bars the file has, for the status line's readout; null in Composition. */
  get fileBarCount(): number | null {
    return this.original?.score.masterBars.length ?? null;
  }

  /** Undo's and Redo's tooltips, with the keys the platform's keyboard writes: Ctrl+Z, or ⌘+Z on a Mac. */
  readonly undoTitle: string = shortcutTitleOf('undo', inject(KEY_PLATFORM));
  readonly redoTitle: string = shortcutTitleOf('redo', inject(KEY_PLATFORM));
  /** Where a conversion that throws is reported (`convert`). */
  private readonly errors = inject(ErrorHandler);

  /** What every tool runs against. */
  readonly host: ComposerToolHost;
  /**
   * `COMPOSER_TOOLS`, each asking `ComposerGpService.requestEdit` before it runs, so in Original the first that would change
   * the document opens the conversion prompt instead - from the palette and the keys alike.
   */
  private readonly gatedTools: readonly ComposerTool[];

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
    private readonly gp: ComposerGpService,
    private readonly texService: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly exporter: ComposerExportService,
    private readonly conversion: GpConversionService,
    private readonly opener: GpFileOpener,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.fretEntry = new FretDigitEntry(composer, () => Date.now(), midi =>
      this.alphaTabService.auditionAfterRender(midi, this.currentTrackProgram)
    );
    this.host = {
      composer,
      // A popover's own button, or its key, closes it when it is the one open, as a disclosure button does.
      openPopover: kind => this.present(() => (this.popover = this.popover === kind ? null : kind)),
      // Not over the conversion prompt: the sheet would open behind a question the page is waiting on.
      toggleShortcutSheet: () => this.present(() => this.editRequest === null && this.toggleShortcutSheet()),
      escape: () =>
        this.present(() => {
          // The conversion prompt takes Escape as Cancel - and, while a conversion is under way, as nothing (`converting`).
          // An open popover takes Escape alone - as the popover itself does when it has the focus - and so does the open
          // shortcut sheet, a modal over the score: the press that closes either does not also drop the range.
          if (this.converting) return;
          if (this.editRequest) {
            this.gp.cancelEdit();
            return;
          }
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
    this.gatedTools = COMPOSER_TOOLS.map(tool => ({
      ...tool,
      run: (host, press) => this.gp.requestEdit(tool.id, tool.label, () => tool.run(host, press))
    }));
    // The score's element, so a text selection inside the score does not stop Ctrl+C and Ctrl+X copying beats.
    // And whether a modal is open: while one is, only the sheet's key and Escape reach the tools, so no key edits the
    // score hidden behind it (`TOOLS_OVER_A_MODAL`), and a Ctrl, Alt or Cmd press is claimed and dropped, so the
    // browser's own shortcuts do not act behind it either.
    this.keyHandler = new ComposerKeyHandler(
      this.host,
      this.gatedTools,
      () => this.scoreElement?.nativeElement ?? null,
      () => this.modalOpen
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
        // as typed, and is out of date from here (`texDraftOutOfDate`) - until another composition opens, which asked about
        // it first (`confirmDiscard`) and throws it away.
        if (this.showTexPanel && state.documentId !== this.texDraftDocumentId) this.discardTexDraft();
        else if (docChanged && this.showTexPanel && !this.texDraftEdited) this.seedTexDraft();
        this.cdr.markForCheck();
      });

    this.alphaTabService
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.playerState = state;
        this.timeReadout = this.timeReadoutOf(this.seekDraft ?? state.timePosition);
        // Marked, not detected: `AlphaTabService` brings alphaTab's events back into the zone, whose tick checks the
        // page. A position event arrives many times a second while playing, and each ran a second pass of its own.
        this.cdr.markForCheck();
      });

    this.gp
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(original => {
        const changed = original !== this.original;
        this.original = original;
        // The alphaTex shown is the file's while there is one and the composition's after, so an untouched draft follows
        // it as it follows the score. Opening a file does not move `documentId` - the reset before it did - so the
        // composer's subscription would leave the empty composition's alphaTex in a panel already open. A draft typed
        // into is left as typed, as it is when the score changes.
        if (changed && this.showTexPanel && !this.texDraftEdited) this.seedTexDraft();
        this.cdr.markForCheck();
      });

    this.gp
      .getCaret()
      .pipe(takeUntil(this.destroy$))
      .subscribe(caret => {
        this.fileCursor = caret?.cursor ?? null;
        this.cdr.markForCheck();
      });

    this.gp
      .getRequest()
      .pipe(takeUntil(this.destroy$))
      .subscribe(request => {
        this.editRequest = request;
        // A popover left open would sit in the top layer above the prompt, inside a palette gone inert.
        if (request) this.popover = null;
        this.cdr.markForCheck();
      });

    // `/composer?gp=<id>`, the gallery's Open: the file opens in Original. The query is cleared first, so a reload does not
    // open again a file converted since - the page never used the router before, and this is the one parameter it reads.
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const id = params.get('gp');
      if (!id) return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { gp: null }, queryParamsHandling: 'merge', replaceUrl: true });
      void this.opener.openEntry(id);
    });

    // Save in the Library menu asks the same questions Ctrl+S does (`requestSave`): the draft's, and in Original the
    // conversion prompt's, since the library holds compositions and a file not yet converted has none to write.
    this.removeSaveGuard = this.saveRequests.guard(() => this.refusesSaveForDraft() || this.asksBeforeSaving());
    // An edited draft is unsaved work that a load, New or an opened transcription would throw away.
    this.releaseUnsavedDraft = this.composer.holdUnsavedWork(() => this.showTexPanel && this.texDraftEdited);
  }

  /**
   * Watches the page and the rows it leaves the strip less room for - the top bar, which wraps on a narrow window; the
   * status line, which wraps on a long message; and the alphaTex panel while it is open (`texPanelRef`) - and fits the
   * strip to the room they leave. The observer's first report comes after layout, outside any template pass, so the bound
   * height and range change there.
   */
  ngAfterViewInit(): void {
    const page = this.page?.nativeElement;
    if (!page || typeof ResizeObserver === 'undefined') return;
    this.pageObserver = new ResizeObserver(() => this.refitStrip());
    this.pageObserver.observe(page);
    for (const row of [this.topBar?.nativeElement, this.statusLine?.nativeElement, this.texPanel]) {
      if (row) this.pageObserver.observe(row);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // A command asked here dies with the page: the prompt that named it is going, and one found by the next composer page
    // would ask about a press the user made on a page they left. One asked from elsewhere - the progression page's Send -
    // is made while no composer page is alive, and waits for the next to show it.
    this.gp.cancelEdit();
    this.pageObserver?.disconnect();
    this.removeSaveGuard();
    this.releaseUnsavedDraft();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * The page's one keyboard listener. See `ComposerKeyHandler` for what it takes and what it leaves. Space
   * and Enter on a button focused from the keyboard - a palette tool, a menu item, a track row's Update - press
   * that button, so the handler is not asked (`pressesFocusedControl`). A held Enter would press it again on every
   * repeat - a menu's Save, a saved row's load, a track's Remove - so a repeat is dropped on every such control, and let
   * through only on a palette button whose tool's key repeats (`ComposerTool.repeatable`).
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (pressesFocusedControl(event)) {
      if (event.key === 'Enter' && event.repeat && !this.repeatableToolAt(event.target)) event.preventDefault();
      return;
    }
    this.keyHandler.handle(event);
  }

  /** A file dragged over the page may be dropped on it: without this the browser would open the file itself. */
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  }

  /**
   * A `.gp` dropped anywhere on the page opens in Original (`GpFileOpener.importDropped`) - but not over a modal. `inert`
   * reaches only the page's children, so a drop still lands here: opened, a file would reset the page under the prompt
   * and drop the edit it holds, or open under a conversion whose write then clears it. The drop is still claimed, so
   * the browser does not open the file itself, and refused out loud.
   */
  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    if (this.modalOpen) {
      this.composer.announce(this.dropRefusal(), true);
      return;
    }
    void this.opener.importDropped(files);
  }

  /** Why a file dropped while a modal is open is not opened: what the modal is waiting on (`modalOpen`). */
  private dropRefusal(): string {
    if (this.converting) return 'Wait for the conversion to finish before opening another file.';
    if (this.editRequest) return 'Answer the question about the open file before opening another.';
    return 'Close the shortcut sheet before opening a file.';
  }

  /** Whether `target` is a palette button whose tool a held key runs again. */
  private repeatableToolAt(target: EventTarget | null): boolean {
    const id = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-tool]')?.dataset['tool'] : undefined;
    return COMPOSER_TOOLS.some(tool => tool.id === id && tool.repeatable === true);
  }

  /** A palette press runs the same tool, against the same host, as its key - asking first in Original, as the key does. */
  runTool(tool: ComposerTool): void {
    this.gp.requestEdit(tool.id, tool.label, () => tool.run(this.host, null));
  }

  /**
   * The prompt's Cancel, its backdrop, and Escape: the command that asked is dropped, and the page says nothing more. Not
   * while a conversion is under way, which closing the prompt would not stop (`converting`).
   */
  cancelConvert(): void {
    if (this.converting) return;
    this.gp.cancelEdit();
  }

  /** "Save the original file first": the untouched bytes, under the file's own name. The prompt stays open. */
  saveOriginal(): void {
    const original = this.original;
    if (original) this.exporter.downloadOriginal(original.bytes, original.fileName);
  }

  /**
   * The prompt's Convert (`GpConversionService`). Converted, the page is a composition and the edit that asked has run;
   * refused, the prompt closes, the page stays in Original with nothing applied, and the status line says why. A throw
   * the service did not turn into a refusal is reported and said the same way, and however it ends, Convert is live
   * again: a conversion left `converting` would leave the prompt's Convert disabled for as long as the page is open.
   */
  convert(): void {
    if (this.converting) return;
    this.converting = true;
    void this.conversion
      .convert()
      .then(outcome => {
        if (outcome.kind === 'refused') {
          this.gp.cancelEdit();
          this.composer.announce(outcome.reason, true);
        }
      })
      .catch((error: unknown) => {
        this.errors.handleError(error);
        this.gp.cancelEdit();
        this.composer.announce('The file could not be converted.', true);
      })
      .finally(() => {
        this.converting = false;
        this.cdr.markForCheck();
      });
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

  /** The scale panel opened for the first time: note bounds from here on, for the highlight to read. */
  onScalePanelOpened(): void {
    this.alphaTabService.setNoteBounds(true);
  }

  // -------------------------------------------------------------------------
  // The rest of the transport: loop, speed, volume and the seek bar - the viewer's, in both states (design decision 10)
  // -------------------------------------------------------------------------

  readonly speedRange = SPEED_RANGE;

  toggleLoop(): void {
    this.alphaTabService.setLooping(!(this.playerState?.isLooping ?? false));
  }

  /**
   * The speed a drag of the speed slider is at, as a percentage, until it lets go; null when no drag is under way. The
   * player is set once, on `change`: each of a drag's `input` steps setting it would retime playback a dozen times.
   */
  speedDraft: number | null = null;

  /**
   * Where a drag of the seek bar is, in milliseconds, until it lets go; null when no drag is under way. The thumb and the
   * readout follow it rather than the player, whose position events would otherwise snap the thumb back under the hand
   * while it plays, and the player seeks once, on `change`, rather than at every step of the drag.
   */
  seekDraft: number | null = null;

  /**
   * Where playback is - or a drag of the seek bar, while one is under way - and how long the score plays, as
   * `1:05 / 3:20`. A field set when either changes, not a getter: the template reads it twice a pass, and a position
   * event arrives many times a second.
   */
  timeReadout = this.timeReadoutOf(0);

  /** Speed, as a percentage of the score's own tempo: a playback multiplier, never the BPM, which is the score's. */
  get speedPercent(): number {
    return this.speedDraft ?? Math.round((this.playerState?.tempoMultiplier ?? 1) * 100);
  }

  onSpeedInput(value: string): void {
    this.speedDraft = Number(value);
  }

  onSpeedChange(value: string): void {
    this.speedDraft = null;
    this.alphaTabService.setPlaybackSpeed(Number(value) / 100);
  }

  get volumePercent(): number {
    return Math.round((this.playerState?.volume ?? 1) * 100);
  }

  onVolumeInput(value: string): void {
    this.alphaTabService.setVolume(Number(value) / 100);
  }

  onSeekInput(value: string): void {
    this.seekDraft = Number(value);
    this.timeReadout = this.timeReadoutOf(this.seekDraft);
  }

  onSeekChange(value: string): void {
    this.seekDraft = null;
    this.alphaTabService.seekToTime(Number(value));
    this.timeReadout = this.timeReadoutOf(this.playerState?.timePosition ?? 0);
  }

  /** `position` and the score's length, as the transport's readout writes them. */
  private timeReadoutOf(position: number): string {
    return `${clockTimeOf(position)} / ${clockTimeOf(this.playerState?.totalDuration ?? 0)}`;
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

  /** A new, empty score, with a fresh history - asked first when anything is unsaved (`confirmDiscard`). */
  newScore(): void {
    if (this.composer.confirmDiscard('start a new score')) this.composer.reset();
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
   * Measures the strip's range again - for a row that changed size, or one that has gone - and draws only when the range
   * or the strip's height changed. Runs outside any template pass: a `ResizeObserver`'s report comes after layout, and the
   * panel's fit on a microtask past the view query that found it gone.
   */
  private refitStrip(): void {
    if (this.destroyed) return;
    const before = `${this.stripHeight}:${this.stripRange.max}`;
    this.fitStrip();
    if (`${this.stripHeight}:${this.stripRange.max}` !== before) this.cdr.detectChanges();
  }

  /**
   * Measures the strip's range from the page as it is laid out - its height, less the top bar, the status line, the
   * separator and the open alphaTex panel, and less the score's minimum as its styles compute it (`stripHeightRangeOf`) -
   * and clamps the strip to it.
   */
  private fitStrip(): void {
    const page = this.page?.nativeElement;
    if (!page) return;
    const rows = [this.topBar?.nativeElement, this.statusLine?.nativeElement, this.stripSeparator?.nativeElement, this.texPanel];
    const fixedRows = rows.reduce((sum, row) => sum + (row?.offsetHeight ?? 0), 0);
    this.stripRange = stripHeightRangeOf(page.clientHeight, fixedRows, this.scoreMinHeight());
    this.stripHeight = clampedStripHeight(this.stripHeight, this.stripRange);
  }

  /** The least height the page's styles give the score, in pixels: `10rem`, so it follows the root font size. */
  private scoreMinHeight(): number {
    const score = this.scoreElement?.nativeElement;
    const minHeight = score ? parseFloat(getComputedStyle(score).minHeight) : Number.NaN;
    return Number.isFinite(minHeight) ? minHeight : SCORE_MIN_HEIGHT;
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
    this.texDraftDocumentId = this.state?.documentId ?? null;
  }

  /** Throws the draft away for the next composition's, with what the panel said about it. */
  private discardTexDraft(): void {
    this.seedTexDraft();
    this.texDiagnostics = [];
    this.texApplyError = null;
  }

  /**
   * Canonical alphaTex for the current document, generated on demand - or, in Original, alphaTab's own alphaTex for the
   * file, which has no document behind it (design Part 1). Applying a draft of it asks, as any edit does.
   */
  private currentTex(): string {
    try {
      if (this.original) return this.texService.export(this.original.score);
      if (!this.state) return '';
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      return this.texService.export(score);
    } catch {
      // A file's model the exporter cannot write, as much as a document the mapper cannot, leaves the panel empty rather
      // than taking the page down.
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
   * In Original, refuses the save and asks the conversion prompt instead, with the save as the command waiting on it:
   * once converted, the save runs again and finds a composition to write.
   */
  private asksBeforeSaving(): boolean {
    if (!this.viewingOriginal) return false;
    this.gp.requestEdit('save', 'Save', () => this.saveRequests.request());
    return true;
  }

  /**
   * Apply: in Original it asks the conversion prompt first, with the draft as typed held for after it. Converting opens a
   * new composition, which seeds the panel afresh (`discardTexDraft`), so the draft is put back before it is applied.
   */
  applyTex(): void {
    const draft = this.texDraft;
    this.gp.requestEdit(ASKING_PAGE_COMMANDS.texApply, 'Applying the alphaTex draft', () => {
      this.texDraft = draft;
      this.applyTexDraft();
    });
  }

  /**
   * Applies the draft as an edit of this composition, on the undo stack (`replaceDocument`). A draft out of date would
   * replace the changes made since it was written, so that is asked - once the draft parses, since a draft that cannot
   * be applied has nothing to ask about.
   */
  private applyTexDraft(): void {
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;

    if (!result.score) {
      // Keep the last good document; the diagnostics explain the failure, and the status line says so.
      this.texApplyError = 'alphaTex could not be parsed. The score is unchanged.';
      this.texErrorId++;
      this.cdr.markForCheck();
      return;
    }
    if (this.texDraftOutOfDate && !confirm('The alphaTex draft was written against an earlier score. Apply it anyway, replacing the changes made since?')) {
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
