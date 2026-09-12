import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
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
 * Save, load and export for the composer.
 *
 * Kept out of ComposerComponent so neither file outgrows the project's
 * 500-line guideline. Every dependency is a root service, so this needs no
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
   * Kept as a field rather than read off `state.doc` in the template: with
   * `OnPush` the list only has to be rebuilt when the document changes, and the
   * template is not the place for a scan of every track.
   */
  linkedProgressions: string[] = [];

  /**
   * Why the last press of Save was refused, or `null` if it was not.
   *
   * See `refuseToSave` for what makes saving refuse at all. Public because the
   * template renders it and the spec reads it.
   */
  saveBlockedReason: string | null = null;

  /**
   * Whether the refused press was `Save as copy` rather than `Save`.
   *
   * Held across the refusal so that taking the offer finishes the command the
   * user actually gave. Without it, flattening would always overwrite, and a
   * user who asked for a copy would lose the original to a chore they only
   * accepted in order to get the copy.
   */
  private pendingSaveAsNew = false;

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
        this.linkedProgressions = state.doc.tracks.flatMap(track =>
          track.generated ? [track.generated.progressionName || track.name] : []
        );

        // The Tracks panel can flatten too, and so can undo. A refusal left
        // standing after the last link went away would be describing a document
        // that no longer exists.
        if (this.linkedProgressions.length === 0) {
          this.saveBlockedReason = null;
          this.pendingSaveAsNew = false;
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
   */
  async flattenAndSave(): Promise<void> {
    const asNew = this.pendingSaveAsNew;
    this.flattenEveryLinkedTrack();
    this.saveBlockedReason = null;
    this.pendingSaveAsNew = false;
    await this.writeToLibrary(asNew);
  }

  /** Declines the offer, leaving the link and the composition unsaved. */
  dismissSaveBlock(): void {
    this.saveBlockedReason = null;
    this.pendingSaveAsNew = false;
    this.cdr.markForCheck();
  }

  private refuseToSave(asNew: boolean): void {
    this.pendingSaveAsNew = asNew;
    this.saveBlockedReason = this.describeRefusal();
    this.statusMessage = null;
    this.cdr.markForCheck();
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
   * Clears every marker in the document, one command per track.
   *
   * `flattenTrack` takes a single index and commits, so several linked tracks
   * cost several undo entries. Rare enough to leave alone: two progressions in
   * one score is possible but not the ordinary case, and a bulk command in the
   * service would exist only for this caller.
   *
   * The indices are read before the first call because each commit republishes
   * the document. They stay valid across the loop for a reason worth stating:
   * flattening clears a marker rather than removing a track, so nothing shifts.
   */
  private flattenEveryLinkedTrack(): void {
    const linked = this.composer.doc.tracks
      .map((track, index) => (track.generated ? index : -1))
      .filter(index => index >= 0);

    for (const index of linked) this.composer.flattenTrack(index);
  }

  private async writeToLibrary(asNew: boolean): Promise<void> {
    if (!this.state) return;

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
      this.report(`Saved "${doc.title || 'Untitled'}"`);
    } catch (error) {
      this.reportError(error);
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
