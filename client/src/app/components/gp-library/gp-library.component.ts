import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { GpLibraryService } from '../../services/gp-library.service';
import { GpLibraryEntry, GpLibraryFilter } from '../../models/alpha-tab.model';
import { GpFileCardComponent } from './components/gp-file-card/gp-file-card.component';
import { GpLibraryFiltersComponent } from './components/gp-library-filters/gp-library-filters.component';

@Component({
  selector: 'app-gp-library',
  standalone: true,
  imports: [CommonModule, FormsModule, GpFileCardComponent, GpLibraryFiltersComponent],
  templateUrl: './gp-library.component.html',
  styleUrls: ['./gp-library.component.scss']
})
export class GpLibraryComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  entries: GpLibraryEntry[] = [];
  filteredEntries: GpLibraryEntry[] = [];
  currentFilter: GpLibraryFilter = {};
  sortBy: 'title' | 'artist' | 'dateAdded' | 'tempo' = 'dateAdded';
  sortAscending = false;
  viewMode: 'grid' | 'list' = 'grid';
  isDragging = false;

  constructor(
    private libraryService: GpLibraryService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.libraryService.getEntries()
      .pipe(takeUntil(this.destroy$))
      .subscribe(entries => {
        this.entries = entries;
        this.applyFiltersAndSort();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Apply current filters and sorting to entries
   */
  private applyFiltersAndSort(): void {
    let result = this.libraryService.filterEntries(this.entries, this.currentFilter);
    result = this.libraryService.sortEntries(result, this.sortBy, this.sortAscending);
    this.filteredEntries = result;
  }

  /**
   * Handle filter changes from filter component
   */
  onFilterChange(filter: GpLibraryFilter): void {
    this.currentFilter = filter;
    this.applyFiltersAndSort();
  }

  /**
   * Handle sort change
   */
  onSortChange(sortBy: 'title' | 'artist' | 'dateAdded' | 'tempo'): void {
    if (this.sortBy === sortBy) {
      this.sortAscending = !this.sortAscending;
    } else {
      this.sortBy = sortBy;
      this.sortAscending = sortBy === 'title' || sortBy === 'artist';
    }
    this.applyFiltersAndSort();
  }

  /**
   * Toggle view mode between grid and list
   */
  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
  }

  /**
   * Open a file in the GP viewer
   */
  openFile(entry: GpLibraryEntry): void {
    this.router.navigate(['/gp-viewer'], {
      queryParams: { id: entry.id }
    });
  }

  /**
   * Delete a file from the library
   */
  async deleteFile(entry: GpLibraryEntry): Promise<void> {
    if (confirm(`Delete "${entry.title}" from the library?`)) {
      await this.libraryService.deleteEntry(entry.id);
    }
  }

  /**
   * Handle file drop for adding to library
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files) {
      await this.addFiles(Array.from(files));
    }
  }

  /**
   * Handle file input change
   */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      await this.addFiles(Array.from(input.files));
      input.value = ''; // Reset input
    }
  }

  /**
   * Add multiple files to the library
   */
  private async addFiles(files: File[]): Promise<void> {
    const validExtensions = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];

    for (const file of files) {
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));

      if (isValid) {
        try {
          await this.libraryService.addFile(file, {});
        } catch (error) {
          console.error('Failed to add file:', file.name, error);
        }
      }
    }
  }

  /**
   * Clear the entire library
   */
  async clearLibrary(): Promise<void> {
    if (confirm('Delete all files from the library? This cannot be undone.')) {
      await this.libraryService.clearLibrary();
    }
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Format date for display
   */
  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString();
  }
}
