import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GpLibraryEntry } from '../../../../models/alpha-tab.model';

@Component({
  selector: 'app-gp-file-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './gp-file-card.component.html',
  styleUrls: ['./gp-file-card.component.scss']
})
export class GpFileCardComponent {
  @Input() entry!: GpLibraryEntry;
  @Input() viewMode: 'grid' | 'list' = 'grid';
  @Output() open = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();

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

  /**
   * Get file extension badge color
   */
  getExtensionColor(): string {
    const ext = this.entry.fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'gp5': return '#e74c3c';
      case 'gp4': return '#e67e22';
      case 'gp3': return '#f1c40f';
      case 'gpx': return '#9b59b6';
      default: return '#3498db';
    }
  }

  /**
   * Get file extension for display
   */
  getExtension(): string {
    return this.entry.fileName.split('.').pop()?.toUpperCase() || 'GP';
  }

  onOpen(event: Event): void {
    event.stopPropagation();
    this.open.emit();
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.delete.emit();
  }
}
