import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from '../../../../services/alpha-tex.service';
import { ComposerExportService } from '../../../../services/composer-export.service';
import {
  ComposerLibraryService,
  CompositionSummary
} from '../../../../services/composer-library.service';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { ComposerState } from '../../../../models/composer.model';

/**
 * What the panel is currently asking the user to decide about a save.
 *
 * One field rather than three, because the three are one decision and reading
 * any of them without the others is a bug. `reason` is what is announced,
 * `asNew` is which press the announcement is standing in for, and `flattened`
 * says whether the flatten has already happened - which is the difference
 * between an offer the user can still decline and a report of something that
 * has already changed their document.
 *
 * Held as a single nullable object so that clearing it is one assignment and
 * cannot half-happen. The previous shape was two fields written together by
 * convention: every writer honoured it, but nothing made a writer that forgot
 * fail, and forgetting reopens the path where `Save as copy` overwrites the
 * original.
 */
interface PendingSave {
  reason: string;
  asNew: boolean;
  flattened: boolean;
}

/**
 * Save, load and export for the composer: the top bar's Library and Export menus, and the saved list
 * in a drawer.
 *
 * Kept out of ComposerComponent so neither file outgrows the project's 1000-line guideline. Every
 * dependency is a root service, so this needs no inputs or outputs; the keyboard's Ctrl+S reaches
 * `save` through `ComposerSaveRequests`.
 */
@Component({
  selector: 'app-composer-library-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-library-panel.component.html',
  styleUrls: ['./composer-library-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerLibraryPanelComponent implements OnInit, OnChanges, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  entries: CompositionSummary[] = [];
  state: ComposerState | null = null;
  currentId: string | null = null;
  statusMessage: string | null = null;
  errorMessage: string | null = null;

  /**
   * Names of the progressions whose tracks are still linked, in track order.
   *
   * Rebuilt on every state emission, not only on a document change: the state
   * subject also fires for cursor moves and `markSaved`, and telling those
   * apart would cost more bookkeeping than the scan it saves - one pass over a
   * handful of tracks. Kept as a field rather than read off `state.doc` in the
   * template because with `OnPush` the template is not the place for a scan.
   *
   * What is gated on the list actually changing is the refusal text, which
   * would otherwise be recomputed - and so re-announced - on every unrelated
   * commit. See `ngOnInit`.
   */
  linkedProgressions: string[] = [];

  /** The offer or report currently occupying the announced region. */
  pendingSave: PendingSave | null = null;

  /**
   * Which of the top bar's menus is open, and whether the saved list's drawer is. Presentation only:
   * the three are hidden with CSS rather than removed, so the announced regions beside them stay in the
   * accessibility tree whichever is open.
   */
  libraryMenuOpen = false;
  exportMenuOpen = false;
  drawerOpen = false;

  /**
   * Whether a modal - the shortcut sheet - is open over the page. Opening one closes the menus and the drawer, and
   * while it is open the panel's Escape listener stands aside, so Escape closes the modal rather than a menu hidden
   * behind it.
   */
  @Input() modalOpen = false;

  /** Emits when a menu or the drawer opens. */
  @Output() readonly menuOpened = new EventEmitter<void>();

  /**
   * Whether a write to the library is under way. A trigger while it is - Ctrl+S just after a click, a double
   * click, Ctrl+S after an edit made mid-write - does not start a second write at once: the first write's id is
   * not known until it lands, so letting the second through would create a second entry rather than overwrite
   * the first. It is queued instead, in `queuedSaves`.
   */
  private saving = false;

  /**
   * The saves asked for while a write was under way, in the order first pressed: at most one plain Save and one
   * Save as copy, however many times each was pressed. They run one at a time after that write lands, through
   * `save` and its refusals - a plain Save over the entry the write left current. Each runs only if it still has
   * something to write: a plain Save when the document moved on since the write before it began, a copy unless
   * that write was a copy of the same document, so a double click on Save as copy makes one copy. Dropped when
   * the write failed, which has been reported and would only fail again; when a load or New replaces the document, or
   * its entry is deleted, since they were pressed for what is gone (`forgetEntry`); and when the panel is destroyed,
   * since the page's guards are gone.
   */
  private queuedSaves: Array<'save' | 'copy'> = [];

  /**
   * Bumped whenever the panel forgets its entry - a load or New replacing the document, or the entry deleted
   * (`forgetEntry`). A write that began before it still lands in the entry it was writing, but leaves `currentId` as it
   * now is: otherwise the next Save would write the new document over the entry that write was for.
   */
  private loadGeneration = 0;

  /** The write under way, settled either way, or a settled promise. A delete of an entry waits for it (`remove`). */
  private writing: Promise<void> = Promise.resolve();

  /** Set on destroy: a queued save must not run against a page that has gone, whose guards are no longer asked. */
  private destroyed = false;

  /**
   * Why the last press of Save was refused, or `null` if it was not.
   *
   * A view onto `pendingSave` rather than a field of its own. See `PendingSave`
   * for why the parts are not stored separately, and `refuseToSave` for what
   * makes saving refuse at all.
   */
  get saveBlockedReason(): string | null {
    return this.pendingSave?.reason ?? null;
  }

  /**
   * The Library and Export menu buttons, which take the focus back when Escape closes their menu, and when a refusal,
   * the saved list or an export takes away what held it. Both buttons in the announced region destroy the region they
   * live in, so without one the browser drops the focus to `<body>` and a keyboard user restarts tabbing from the top.
   */
  @ViewChild('libraryToggle') private libraryToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('exportToggle') private exportToggle?: ElementRef<HTMLButtonElement>;
  /** The saved list, and its close button, which takes the focus when the list opens. */
  @ViewChild('drawer') private drawer?: ElementRef<HTMLElement>;
  @ViewChild('drawerClose') private drawerClose?: ElementRef<HTMLButtonElement>;

  private readonly document = inject(DOCUMENT);
  /** The timer that takes `statusMessage` down, cleared on destroy so it does not run against a panel that has gone. */
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly library: ComposerLibraryService,
    private readonly exporter: ComposerExportService,
    private readonly mapper: ScoreDocMapperService,
    private readonly tex: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef,
    private readonly host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        // Another composition - New, or a load - is not the entry last loaded or saved (`forgetEntry`).
        if (this.state && state.documentId !== this.state.documentId) this.forgetEntry();
        this.state = state;

        const linked = state.doc.tracks.flatMap(track =>
          track.generated ? [track.generated.progressionName || track.name] : []
        );
        const linksChanged =
          linked.length !== this.linkedProgressions.length ||
          linked.some((name, index) => name !== this.linkedProgressions[index]);
        this.linkedProgressions = linked;

        // A standing offer describes the document as it was when the press was
        // refused, and the Tracks panel, undo and redo can all move it out from
        // under that description. Gated on the list having actually changed:
        // recomputing on every emission would re-announce the alert on every
        // unrelated commit, which is worse than the staleness it fixes.
        //
        // A report of a failed save is left alone. Its flatten has already
        // happened, so it is not describing the current links at all, and the
        // emptying of the list is the very thing it is reporting.
        if (linksChanged && this.pendingSave && !this.pendingSave.flattened) {
          this.pendingSave =
            linked.length === 0
              ? null
              : { ...this.pendingSave, reason: this.describeRefusal() };
        }

        this.cdr.markForCheck();
      });

    this.library
      .getEntries()
      .pipe(takeUntil(this.destroy$))
      .subscribe(entries => {
        this.entries = entries;
        this.cdr.markForCheck();
      });

    this.document.addEventListener('keydown', this.escapeListener, true);

    // Ctrl+S. The same `save()` as the button, so a keyboard save is refused, announced and followed by
    // focus exactly as a click is.
    this.saveRequests.requested$.pipe(takeUntil(this.destroy$)).subscribe(() => void this.save());

    void this.library.refresh().catch(error => this.reportError(error));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modalOpen'] && this.modalOpen) this.closeMenus();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.queuedSaves = [];
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.document.removeEventListener('keydown', this.escapeListener, true);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // -------------------------------------------------------------------------
  // Menus and drawer
  // -------------------------------------------------------------------------

  toggleLibraryMenu(): void {
    this.libraryMenuOpen = !this.libraryMenuOpen;
    this.exportMenuOpen = false;
    if (this.libraryMenuOpen) this.menuOpened.emit();
  }

  toggleExportMenu(): void {
    this.exportMenuOpen = !this.exportMenuOpen;
    this.libraryMenuOpen = false;
    if (this.exportMenuOpen) this.menuOpened.emit();
  }

  /**
   * Opens the saved list, closing the menu it was opened from, and puts the focus on its close button: the menu item
   * that opened it is hidden now, and a hidden element drops the focus to the page.
   */
  openDrawer(): void {
    this.drawerOpen = true;
    this.libraryMenuOpen = false;
    this.menuOpened.emit();
    this.cdr.detectChanges();
    this.drawerClose?.nativeElement.focus();
  }

  /** Closes the saved list, giving the focus to the Library button when it was in the list - on its ×, or a row that loaded. */
  closeDrawer(): void {
    const focusWasInside = !!this.drawer?.nativeElement.contains(this.document.activeElement);
    this.drawerOpen = false;
    this.cdr.detectChanges();
    if (focusWasInside) this.libraryToggle?.nativeElement.focus();
  }

  /** Closes the Export menu on a choice, giving the focus to its button: the item chosen is hidden with the menu. */
  private closeExportMenu(): void {
    const focusWasInside = this.host.nativeElement.contains(this.document.activeElement);
    this.exportMenuOpen = false;
    this.cdr.detectChanges();
    if (focusWasInside) this.exportToggle?.nativeElement.focus();
  }

  /** A click anywhere outside the panel closes its menus and its drawer, as a menu is expected to. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.anyOpen || (event.target instanceof Node && this.host.nativeElement.contains(event.target))) return;
    this.closeMenus();
  }

  /** Whether a menu or the drawer is open. */
  private get anyOpen(): boolean {
    return this.libraryMenuOpen || this.exportMenuOpen || this.drawerOpen;
  }

  private closeMenus(): void {
    this.libraryMenuOpen = false;
    this.exportMenuOpen = false;
    this.drawerOpen = false;
    this.cdr.markForCheck();
  }

  /**
   * Escape closes an open menu or the drawer, and claims the key - and gives focus back to the menu's
   * button when it was inside what closed, since a focused element that is hidden drops focus to the page.
   *
   * On the document in the capture phase, for the reason the shell's Escape is (`AppComponent.onEscape`):
   * the page's keyboard handler listens on the document too, and was added before this panel existed, so a
   * bubbling listener here would run after it had gone back to Select and dropped the range. A press
   * something earlier claimed - the shell closing the circle-of-fifths drawer - is left alone, and with
   * nothing open nothing is claimed, so Escape stays the page's.
   */
  private readonly escapeListener = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || this.modalOpen || !this.anyOpen) return;
    event.preventDefault();
    const focusWasInside = this.host.nativeElement.contains(this.document.activeElement);
    const toggle = this.exportMenuOpen && !this.libraryMenuOpen ? this.exportToggle : this.libraryToggle;
    this.closeMenus();
    if (focusWasInside) toggle?.nativeElement.focus();
  };

  // -------------------------------------------------------------------------
  // Save / load
  // -------------------------------------------------------------------------

  /**
   * Saves, unless a track is still linked to a progression - then refuses.
   *
   * ## Why this refuses instead of just saving
   *
   * `CompositionEntry` stores a composition as alphaTex, deliberately: it is
   * compact, diffable and immune to `ScoreDoc` schema drift. The price is that
   * alphaTex has no property that would round-trip `TrackDoc.generated` through
   * alphaTab's own exporter - `score-doc-mapper.service.spec.ts` pins this, and
   * pins it at the strongest point: the marker is already gone in alphaTab's
   * model before a character of tex is written, so no choice of exporter or
   * parser downstream could rescue it.
   *
   * So a save that went ahead would flatten the track silently. That is a
   * change to the user's document they did not ask for and would not discover
   * until they reopened it and found the link gone. Refusing makes it explicit;
   * `Flatten and save` makes the chore one click without making it implicit.
   * The design doc weighs the two rejected alternatives - flattening silently,
   * and storing the marker beside the tex where its far end may no longer exist
   * - under "Saving refuses rather than flattening".
   *
   * Export is deliberately not guarded the same way: an exported file has
   * already left the app and has nothing to stay linked to.
   */
  async save(asNew = false): Promise<void> {
    // A guard that refuses has said why where its own state is shown - the alphaTex draft, in the status line.
    if (!this.state || this.destroyed || this.saveRequests.refused()) return;

    if (this.saving) {
      this.queueSave(asNew);
      return;
    }

    if (this.linkedProgressions.length > 0) {
      this.refuseToSave(asNew);
      return;
    }

    await this.writeToLibrary(asNew);
  }

  /**
   * Detaches every linked track, then finishes the save that was refused.
   *
   * The flatten goes through `ComposerService.flattenTrack`, so it is an
   * ordinary command: it lands on the undo stack and marks the document dirty
   * like any other edit, and a user who takes the offer and then thinks better
   * of it can undo their way back to the link.
   *
   * ## The second step can fail, and failing quietly here is the whole bug
   *
   * `library.save` reaches IndexedDB, so quota, private browsing and a failed
   * version upgrade are all ordinary outcomes rather than theoretical ones. By
   * the time one of them lands the flatten has committed, which is precisely
   * the state this task exists to prevent: the user's document changed in a way
   * they did not ask for and nothing was written in exchange. Left to
   * `reportError` alone it would say so only in a plain paragraph at the foot
   * of the panel, after the announced region had already been torn down.
   *
   * So the failure goes back through the same region the refusal used. That
   * keeps one channel for the whole decision, and it is the region the user is
   * already listening to, having just pressed a button inside it.
   */
  async flattenAndSave(): Promise<void> {
    if (this.destroyed || this.saveRequests.refused()) return;
    const asNew = this.pendingSave?.asNew ?? false;
    const flattened = this.flattenEveryLinkedTrack();
    this.pendingSave = null;

    // Pressed while a write is under way: flattened as pressed, and saved once that write lands, as a Save pressed now
    // is (`queuedSaves`) - the entry that write makes is not known until it lands.
    if (this.saving) {
      this.queueSave(asNew);
      this.returnFocusToLibrary();
      return;
    }

    if (!(await this.writeToLibrary(asNew))) {
      this.pendingSave = {
        reason: this.describeFlattenedButUnsaved(flattened),
        asNew,
        flattened: true
      };
      // The message has moved into the announced region, so the unannounced
      // paragraph at the foot of the panel would only be saying it a second
      // time - and it is the copy a screen reader would not read out.
      this.errorMessage = null;
    }

    this.returnFocusToLibrary();
  }

  /** Declines the offer, leaving the link and the composition unsaved. */
  dismissSaveBlock(): void {
    this.pendingSave = null;
    this.returnFocusToLibrary();
  }

  /** Remembers a save pressed while a write is under way, once for each kind (`queuedSaves`). */
  private queueSave(asNew: boolean): void {
    const intent = asNew ? 'copy' : 'save';
    if (!this.queuedSaves.includes(intent)) this.queuedSaves.push(intent);
  }

  private refuseToSave(asNew: boolean): void {
    // The refusal drops below the top bar, where the menus open, so it closes them rather than cover Save; a focus in
    // the Library menu goes to its button, since a hidden Save drops it to the page.
    const focusWasInMenu = this.libraryMenuOpen && this.host.nativeElement.contains(this.document.activeElement);
    this.libraryMenuOpen = false;
    this.exportMenuOpen = false;
    this.pendingSave = { reason: this.describeRefusal(), asNew, flattened: false };
    this.statusMessage = null;
    // A failure from an earlier press sits directly under the refusal, where it
    // reads as part of it.
    this.errorMessage = null;
    this.cdr.markForCheck();
    if (focusWasInMenu) this.returnFocusToLibrary();
  }

  /**
   * Puts the focus on the Library button after the announced region is torn down, or a refusal closed the menu.
   *
   * Change detection has to run first: the region is still in the DOM at the
   * moment the handler returns, and moving focus before it goes would be undone
   * by the browser when it does.
   */
  private returnFocusToLibrary(): void {
    // Not Save: it is in the Library menu, which, opened, would sit under a refusal still showing.
    this.cdr.detectChanges();
    this.libraryToggle?.nativeElement.focus();
  }

  private describeRefusal(): string {
    const names = this.linkedProgressions.map(name => `"${name}"`);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const subject = names.length === 1 ? 'a track generated from' : 'tracks generated from';

    return (
      `This composition still has ${subject} ${list}. A saved composition is stored as ` +
      'alphaTex, which has nowhere to keep that link, so saving would quietly flatten it. ' +
      'Flatten and save to do it deliberately, or export instead - an exported file has ' +
      'nothing to stay linked to.'
    );
  }

  /**
   * What to say when the flatten went through and the save behind it did not.
   *
   * Says the three things the user needs in the order they need them: what
   * changed in their document, that nothing was written, and that the change is
   * reversible. The undo count is spelled out because the flatten is one
   * command per track - see `flattenEveryLinkedTrack`.
   */
  private describeFlattenedButUnsaved(flattenedCount: number): string {
    const undo =
      flattenedCount > 1
        ? `${flattenedCount} presses of undo restore the links`
        : 'undo restores the link';

    return (
      `The ${flattenedCount === 1 ? 'track was' : 'tracks were'} flattened, but the ` +
      `composition still could not be saved: ${this.errorMessage ?? 'the save failed'}. ` +
      `Nothing was written to the library, and ${undo}.`
    );
  }

  /**
   * Clears every marker in the document, returning how many it cleared.
   *
   * `flattenTrack` takes a single index and commits, so several linked tracks
   * cost several undo entries. That is a real wart - one press of undo puts
   * back one link, which is confusing when there were two - and it is not
   * unfixable: `flattenTrack` already delegates to a pure
   * `flattenGeneratedTrack(score, index)`, so an atomic version would be a
   * `reduce` inside a single `commit`. It is left alone because two
   * progressions in one score is rare, not because the bulk command would be
   * hard or unwanted.
   *
   * The indices are read before the first call because each commit republishes
   * the document. They stay valid across the loop for a reason worth stating:
   * flattening clears a marker rather than removing a track, so nothing shifts.
   */
  private flattenEveryLinkedTrack(): number {
    const linked = this.composer.doc.tracks
      .map((track, index) => (track.generated ? index : -1))
      .filter(index => index >= 0);

    for (const index of linked) this.composer.flattenTrack(index);

    return linked.length;
  }

  /** Writes the composition, reporting any failure. True when it landed. */
  private async writeToLibrary(asNew: boolean): Promise<boolean> {
    if (!this.state || this.saving) return false;

    this.saving = true;
    // The document this write holds. Only it is marked saved, and a queued save runs after it only when it still has
    // something to write (`runQueuedSave`).
    const doc = this.state.doc;
    // A load, New or a delete of the entry while this write is under way leaves `currentId` as they left it (`loadGeneration`).
    const generation = this.loadGeneration;
    // What this write holds, as alphaTex: a queued save runs after it only when the document would write something else.
    let written: string | null = null;
    let landed = false;
    try {
      written = this.tex.export(this.buildScore());

      const write = this.library.save(
        {
          title: doc.title || 'Untitled',
          artist: doc.artist,
          tex: written,
          tempo: doc.tempo,
          trackCount: doc.tracks.length,
          barCount: doc.masterBars.length
        },
        asNew ? undefined : this.currentId ?? undefined
      );
      this.writing = write.then(
        () => undefined,
        () => undefined
      );
      const id = await write;

      if (generation === this.loadGeneration) this.currentId = id;
      this.composer.markSaved(doc);
      this.pendingSave = null;
      this.report(`Saved "${doc.title || 'Untitled'}"`);
      landed = true;
    } catch (error) {
      this.reportError(error);
    } finally {
      this.saving = false;
    }

    if (landed && !this.destroyed && written !== null) this.runQueuedSave(written, asNew);
    else this.queuedSaves = [];
    return landed;
  }

  /**
   * Runs the first queued save that still has something to write, after a write of `written` - the alphaTex it held,
   * a copy when `wroteCopy` - has landed. The rest stay queued behind the write it starts. A plain Save of a document
   * that writes the same alphaTex would write it again, and so would a copy after a copy of it; both are skipped.
   * Compared as alphaTex rather than by identity: undo gives back a copy of the document the write held. A save that
   * starts no write has been refused, and said why, and the rest would be refused the same way, so they are dropped.
   */
  private runQueuedSave(written: string, wroteCopy: boolean): void {
    while (this.queuedSaves.length > 0) {
      const asNew = this.queuedSaves.shift() === 'copy';
      const moved = this.texOfDocument() !== written;
      if (!moved && (!asNew || wroteCopy)) continue;
      void this.save(asNew);
      if (!this.saving) this.queuedSaves = [];
      return;
    }
  }

  async load(id: string): Promise<void> {
    if (this.state?.isDirty && !confirm('Discard unsaved changes and load this composition?')) {
      return;
    }

    try {
      const entry = await this.library.get(id);
      if (!entry) {
        this.reportError(new Error('That composition could not be found'));
        return;
      }

      const parsed = this.tex.parse(entry.tex);
      if (!parsed.score) {
        this.reportError(new Error('The saved composition could not be parsed'));
        return;
      }

      // Marked clean, the loaded document is another composition (`documentId`), so the panel forgets the one it replaces
      // as the state arrives - dropping the saves queued for it - and then names the loaded entry.
      this.composer.replaceDocument(this.mapper.toDoc(parsed.score), true);
      this.currentId = id;
      this.closeDrawer();
      this.report(`Loaded "${entry.title}"`);
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Forgets the composition the document was, when a load or New replaces it (`ComposerState.documentId`) or its entry
   * is deleted. Saves queued for it were pressed for it and are dropped; a write still under way for it lands in its
   * entry but does not make that entry current again (`loadGeneration`); and the next Save writes a new entry, until a
   * load or a save names one.
   */
  private forgetEntry(): void {
    this.loadGeneration++;
    this.queuedSaves = [];
    this.currentId = null;
    this.cdr.markForCheck();
  }

  async remove(id: string, title: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    try {
      // Deleting the entry being edited forgets it, as New does: a write under way to it does not make it current again,
      // and no queued save writes it back. That write would put the entry back itself, so the delete waits for it.
      if (this.currentId === id) this.forgetEntry();
      await this.writing;
      await this.library.delete(id);
      this.report(`Deleted "${title}"`);
    } catch (error) {
      this.reportError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  exportGuitarPro(): void {
    this.closeExportMenu();
    if (!this.state) return;
    try {
      const settings = new alphaTab.Settings();
      const score = this.mapper.toScore(this.state.doc, settings);
      this.exporter.downloadGuitarPro(
        score,
        settings,
        this.exporter.toFileName(this.state.doc.title)
      );
      this.report('Exported Guitar Pro file');
    } catch (error) {
      this.reportError(error);
    }
  }

  exportAlphaTex(): void {
    this.closeExportMenu();
    if (!this.state) return;
    try {
      this.exporter.downloadAlphaTex(
        this.tex.export(this.buildScore()),
        this.exporter.toFileName(this.state.doc.title)
      );
      this.report('Exported alphaTex file');
    } catch (error) {
      this.reportError(error);
    }
  }

  exportMidi(): void {
    this.closeExportMenu();
    if (!this.state) return;
    try {
      // Same three steps as the Guitar Pro export: build the score, hand it to
      // the exporter. MIDI used to go through the rendering api instead, which
      // meant it alone could fail with "the player is not ready yet".
      const settings = new alphaTab.Settings();
      const score = this.mapper.toScore(this.state.doc, settings);
      this.exporter.downloadMidiFile(
        score,
        settings,
        this.exporter.toFileName(this.state.doc.title)
      );
      this.report('Exported MIDI file');
    } catch (error) {
      this.reportError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildScore(): alphaTab.model.Score {
    return this.mapper.toScore(this.state!.doc, new alphaTab.Settings());
  }

  /** The document's alphaTex as a save would write it, or null when it cannot be built. */
  private texOfDocument(): string | null {
    try {
      return this.state ? this.tex.export(this.buildScore()) : null;
    } catch {
      return null;
    }
  }

  private report(message: string): void {
    this.statusMessage = message;
    this.errorMessage = null;
    this.cdr.markForCheck();
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.statusMessage = null;
      this.cdr.markForCheck();
    }, 2500);
  }

  private reportError(error: unknown): void {
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.statusMessage = null;
    this.cdr.markForCheck();
  }

  trackById(_index: number, entry: CompositionSummary): string {
    return entry.id;
  }
}
