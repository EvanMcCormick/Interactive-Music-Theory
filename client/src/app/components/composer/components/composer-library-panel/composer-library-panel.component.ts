import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
 * Save, load and export for the composer.
 *
 * Kept out of ComposerComponent so neither file outgrows the project's
 * 1000-line guideline. Every dependency is a root service, so this needs no
 * inputs or outputs.
 */
@Component({
  selector: 'app-composer-library-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-library-panel.component.html',
  styleUrls: ['./composer-library-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerLibraryPanelComponent implements OnInit, OnDestroy {
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
   * The Save button, so dismissing the offer can hand focus back to it.
   *
   * Both buttons in the announced region destroy the region they live in, so
   * without this the browser drops focus to `<body>` and a keyboard user
   * restarts tabbing from the top of the page.
   */
  @ViewChild('saveButton') private saveButton?: ElementRef<HTMLButtonElement>;

  constructor(
    private readonly composer: ComposerService,
    private readonly library: ComposerLibraryService,
    private readonly exporter: ComposerExportService,
    private readonly mapper: ScoreDocMapperService,
    private readonly tex: AlphaTexService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
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

    void this.library.refresh().catch(error => this.reportError(error));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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
    if (!this.state) return;

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
    const asNew = this.pendingSave?.asNew ?? false;
    const flattened = this.flattenEveryLinkedTrack();
    this.pendingSave = null;

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

    this.returnFocusToSave();
  }

  /** Declines the offer, leaving the link and the composition unsaved. */
  dismissSaveBlock(): void {
    this.pendingSave = null;
    this.returnFocusToSave();
  }

  private refuseToSave(asNew: boolean): void {
    this.pendingSave = { reason: this.describeRefusal(), asNew, flattened: false };
    this.statusMessage = null;
    // A failure from an earlier press sits directly under the refusal, where it
    // reads as part of it.
    this.errorMessage = null;
    this.cdr.markForCheck();
  }

  /**
   * Puts focus back on Save after the announced region is torn down.
   *
   * Change detection has to run first: the region is still in the DOM at the
   * moment the handler returns, and moving focus before it goes would be undone
   * by the browser when it does.
   */
  private returnFocusToSave(): void {
    this.cdr.detectChanges();
    this.saveButton?.nativeElement.focus();
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
    if (!this.state) return false;

    try {
      const doc = this.state.doc;
      const score = this.buildScore();

      const id = await this.library.save(
        {
          title: doc.title || 'Untitled',
          artist: doc.artist,
          tex: this.tex.export(score),
          tempo: doc.tempo,
          trackCount: doc.tracks.length,
          barCount: doc.masterBars.length
        },
        asNew ? undefined : this.currentId ?? undefined
      );

      this.currentId = id;
      this.composer.markSaved();
      this.pendingSave = null;
      this.report(`Saved "${doc.title || 'Untitled'}"`);
      return true;
    } catch (error) {
      this.reportError(error);
      return false;
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

      this.composer.replaceDocument(this.mapper.toDoc(parsed.score), true);
      this.currentId = id;
      this.report(`Loaded "${entry.title}"`);
    } catch (error) {
      this.reportError(error);
    }
  }

  async remove(id: string, title: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    try {
      await this.library.delete(id);
      if (this.currentId === id) this.currentId = null;
      this.report(`Deleted "${title}"`);
    } catch (error) {
      this.reportError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  exportGuitarPro(): void {
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

  private report(message: string): void {
    this.statusMessage = message;
    this.errorMessage = null;
    this.cdr.markForCheck();
    setTimeout(() => {
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
