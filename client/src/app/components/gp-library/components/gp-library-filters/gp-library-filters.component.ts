import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GpLibraryFilter } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

@Component({
  selector: 'app-gp-library-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gp-library-filters.component.html',
  styleUrls: ['./gp-library-filters.component.scss']
})
export class GpLibraryFiltersComponent implements OnInit {
  @Output() filterChange = new EventEmitter<GpLibraryFilter>();

  searchText = '';
  selectedKey: number | null = null;
  selectedScaleId = '';
  selectedChordId = '';

  noteNames = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
  scales: { id: string; name: string }[] = [];
  chords: { id: string; name: string }[] = [];

  constructor(private musicTheoryService: MusicTheoryService) {}

  ngOnInit(): void {
    this.loadScalesAndChords();
  }

  private loadScalesAndChords(): void {
    const categories = this.musicTheoryService.getUnifiedCategories();

    this.scales = [];
    this.chords = [];

    categories.forEach(category => {
      const isChordCategory = category.name.toLowerCase().includes('chord') ||
                              category.name.toLowerCase().includes('triad') ||
                              category.name.toLowerCase().includes('seventh');

      category.items.forEach(item => {
        if (isChordCategory) {
          this.chords.push({ id: item.id, name: item.name });
        } else {
          this.scales.push({ id: item.id, name: item.name });
        }
      });
    });
  }

  onSearchChange(): void {
    this.emitFilter();
  }

  onKeyChange(): void {
    this.emitFilter();
  }

  onScaleChange(): void {
    this.emitFilter();
  }

  onChordChange(): void {
    this.emitFilter();
  }

  clearFilters(): void {
    this.searchText = '';
    this.selectedKey = null;
    this.selectedScaleId = '';
    this.selectedChordId = '';
    this.emitFilter();
  }

  private emitFilter(): void {
    const filter: GpLibraryFilter = {};

    if (this.searchText.trim()) {
      filter.searchText = this.searchText.trim();
    }

    if (this.selectedKey !== null) {
      filter.key = this.selectedKey;
    }

    if (this.selectedScaleId) {
      filter.scaleIds = [this.selectedScaleId];
    }

    if (this.selectedChordId) {
      filter.chordIds = [this.selectedChordId];
    }

    this.filterChange.emit(filter);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchText.trim() ||
      this.selectedKey !== null ||
      this.selectedScaleId ||
      this.selectedChordId
    );
  }
}
