import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { HighlightConfig } from '../../../../models/alpha-tab.model';

interface ScaleOption {
  id: string;
  name: string;
  intervals: number[];
  categoryName: string;
}

@Component({
  selector: 'app-gp-scale-highlighter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gp-scale-highlighter.component.html',
  styleUrls: ['./gp-scale-highlighter.component.scss']
})
export class GpScaleHighlighterComponent implements OnInit, OnDestroy {
  @Output() highlightChange = new EventEmitter<HighlightConfig>();

  private destroy$ = new Subject<void>();

  // Note names for dropdown
  noteNames = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

  // Available scales (populated from MusicTheoryService)
  scaleOptions: ScaleOption[] = [];

  // Current selection
  isEnabled = false;
  selectedRoot = 0; // C
  selectedScaleId = '';
  selectedType: 'scale' | 'chord' = 'scale';

  constructor(private musicTheoryService: MusicTheoryService) {}

  ngOnInit(): void {
    this.loadScalesAndChords();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load available scales and chords from MusicTheoryService
   */
  private loadScalesAndChords(): void {
    const categories = this.musicTheoryService.getUnifiedCategories();

    this.scaleOptions = [];

    categories.forEach(category => {
      category.items.forEach(item => {
        this.scaleOptions.push({
          id: item.id,
          name: item.name,
          intervals: item.intervals,
          categoryName: category.name
        });
      });
    });
  }

  /**
   * Toggle highlighting on/off
   */
  toggleHighlight(): void {
    this.isEnabled = !this.isEnabled;
    this.emitChange();
  }

  /**
   * Handle root note change
   */
  onRootChange(): void {
    if (this.isEnabled) {
      this.emitChange();
    }
  }

  /**
   * Handle scale selection change
   */
  onScaleChange(): void {
    if (this.isEnabled && this.selectedScaleId) {
      this.emitChange();
    }
  }

  /**
   * Emit the current highlight configuration
   */
  private emitChange(): void {
    const selectedScale = this.scaleOptions.find(s => s.id === this.selectedScaleId);

    const config: HighlightConfig = {
      enabled: this.isEnabled && !!selectedScale,
      rootNote: this.selectedRoot,
      intervals: selectedScale?.intervals || [],
      name: selectedScale ? `${this.noteNames[this.selectedRoot]} ${selectedScale.name}` : '',
      type: this.selectedType
    };

    this.highlightChange.emit(config);
  }

  /**
   * Get the note values that should be highlighted
   */
  getHighlightedNotes(): number[] {
    const selectedScale = this.scaleOptions.find(s => s.id === this.selectedScaleId);
    if (!selectedScale) return [];

    return selectedScale.intervals.map(interval =>
      (this.selectedRoot + interval) % 12
    );
  }

  /**
   * Get scales grouped by category for the dropdown
   */
  getGroupedScales(): { name: string; scales: ScaleOption[] }[] {
    const groups = new Map<string, ScaleOption[]>();

    this.scaleOptions.forEach(scale => {
      if (!groups.has(scale.categoryName)) {
        groups.set(scale.categoryName, []);
      }
      groups.get(scale.categoryName)!.push(scale);
    });

    return Array.from(groups.entries()).map(([name, scales]) => ({
      name,
      scales
    }));
  }

  /**
   * Get the name of the currently selected scale
   */
  getSelectedScaleName(): string {
    const selectedScale = this.scaleOptions.find(s => s.id === this.selectedScaleId);
    return selectedScale?.name || '';
  }
}
