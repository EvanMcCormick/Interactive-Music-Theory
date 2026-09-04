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

import { AlphaTabService } from '../../../../services/alpha-tab.service';
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

  constructor(
    private readonly composer: ComposerService,
    private readonly library: ComposerLibraryService,
    private readonly exporter: ComposerExportService,
    private readonly mapper: ScoreDocMapperService,
    private readonly tex: AlphaTexService,
    private readonly alphaTabService: AlphaTabService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
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

  async save(asNew = false): Promise<void> {
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
    const ok = this.exporter.downloadMidi(this.alphaTabService.getApi());
    if (ok) {
      this.report('Exported MIDI file');
    } else {
      this.reportError(new Error('The player is not ready yet'));
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
