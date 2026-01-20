import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  HostListener,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { GpLibraryService } from '../../services/gp-library.service';
import { AlphaTabState, GpScoreInfo, GpTrackInfo, HighlightConfig } from '../../models/alpha-tab.model';
import { GpScaleHighlighterComponent } from './components/gp-scale-highlighter/gp-scale-highlighter.component';
import * as Tone from 'tone';

@Component({
  selector: 'app-gp-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, GpScaleHighlighterComponent],
  templateUrl: './gp-viewer.component.html',
  styleUrls: ['./gp-viewer.component.scss']
})
export class GpViewerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('alphaTabContainer') alphaTabContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();

  // State
  state: AlphaTabState | null = null;
  scoreInfo: GpScoreInfo | null = null;
  tracks: GpTrackInfo[] = [];

  // UI State
  isDragging = false;
  showControls = true;
  volume = 100;
  tempo = 100;

  // Highlighting
  highlightConfig: HighlightConfig | null = null;

  // Library integration
  currentFile: File | null = null;
  currentLibraryId: string | null = null;
  isInLibrary = false;
  isSaving = false;

  constructor(
    private alphaTabService: AlphaTabService,
    private libraryService: GpLibraryService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to state changes
    this.alphaTabService.getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        if (state.isLoaded) {
          this.scoreInfo = this.alphaTabService.getScoreInfo();
          this.tracks = this.alphaTabService.getTrackInfo();
        }
        // Force change detection since alphaTab events come from outside Angular zone
        this.cdr.detectChanges();
      });

    // Check for library file ID in query params
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        if (params['id']) {
          this.loadFromLibrary(params['id']);
        }
      });

    // Suspend Tone.js to avoid audio conflicts
    this.suspendToneJs();
  }

  ngAfterViewInit(): void {
    // Initialize alphaTab after view is ready
    this.initAlphaTab();
  }

  ngOnDestroy(): void {
    // Cleanup
    this.destroy$.next();
    this.destroy$.complete();

    // Dispose alphaTab resources
    this.alphaTabService.dispose();

    // Resume Tone.js for other pages
    this.resumeToneJs();
  }

  /**
   * Suspend Tone.js audio context to avoid conflicts with alphaTab
   * Note: alphaTab uses its own audio context, so this is mainly for resource management
   */
  private suspendToneJs(): void {
    // Tone.js and alphaTab use separate audio contexts, so no suspension needed
    // This is a placeholder for potential future audio conflict resolution
  }

  /**
   * Resume Tone.js audio context when leaving GP viewer
   */
  private resumeToneJs(): void {
    // Tone.js will resume automatically when the fretboard component initializes
  }

  /**
   * Initialize alphaTab on the container element
   */
  private initAlphaTab(): void {
    if (!this.alphaTabContainer) return;

    this.alphaTabService.initializeApi(this.alphaTabContainer.nativeElement, {
      core: {
        fontDirectory: '/font/',
        useWorkers: true
      },
      display: {
        scale: 1.0,
        staveProfile: 'default',
        layoutMode: 'page'
      },
      player: {
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: this.alphaTabContainer.nativeElement,
        scrollMode: 'continuous'
      }
    });
  }

  /**
   * Handle file input change
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.loadFile(input.files[0]);
    }
  }

  /**
   * Load a file into alphaTab
   */
  async loadFile(file: File): Promise<void> {
    try {
      this.currentFile = file;
      this.currentLibraryId = null;
      this.isInLibrary = false;
      await this.alphaTabService.loadFile(file);
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  }

  /**
   * Load a file from the library by ID
   */
  async loadFromLibrary(id: string): Promise<void> {
    try {
      const entry = await this.libraryService.getEntry(id);
      if (entry && entry.fileData) {
        this.currentLibraryId = id;
        this.isInLibrary = true;
        // Create a blob from the stored data
        const blob = new Blob([entry.fileData]);
        const file = new File([blob], entry.fileName);
        this.currentFile = file;
        await this.alphaTabService.loadFile(file);
      }
    } catch (error) {
      console.error('Failed to load from library:', error);
    }
  }

  /**
   * Save the current file to the library
   */
  async saveToLibrary(): Promise<void> {
    if (!this.currentFile || !this.scoreInfo || this.isSaving) return;

    this.isSaving = true;
    try {
      const entry = await this.libraryService.addFile(this.currentFile, {
        title: this.scoreInfo.title || this.currentFile.name,
        artist: this.scoreInfo.artist,
        album: this.scoreInfo.album,
        tempo: this.scoreInfo.tempo,
        trackCount: this.scoreInfo.trackCount
      });
      this.currentLibraryId = entry.id;
      this.isInLibrary = true;
    } catch (error) {
      console.error('Failed to save to library:', error);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Trigger file input click
   */
  openFileDialog(): void {
    this.fileInput?.nativeElement?.click();
  }

  // Drag and drop handlers
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (this.isValidGpFile(file)) {
        this.loadFile(file);
      }
    }
  }

  /**
   * Check if file is a valid Guitar Pro format
   */
  private isValidGpFile(file: File): boolean {
    const validExtensions = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];
    const fileName = file.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
  }

  // Playback controls
  play(): void {
    this.alphaTabService.play();
  }

  pause(): void {
    this.alphaTabService.pause();
  }

  playPause(): void {
    this.alphaTabService.playPause();
  }

  stop(): void {
    this.alphaTabService.stop();
  }

  /**
   * Handle volume slider change
   */
  onVolumeChange(): void {
    this.alphaTabService.setVolume(this.volume / 100);
  }

  /**
   * Handle tempo slider change
   */
  onTempoChange(): void {
    this.alphaTabService.setPlaybackSpeed(this.tempo / 100);
  }

  /**
   * Seek to position based on progress bar click
   */
  onProgressClick(event: MouseEvent): void {
    if (!this.state || this.state.totalDuration === 0) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const newTime = percent * this.state.totalDuration;

    this.alphaTabService.seekToTime(newTime);
  }

  /**
   * Toggle track mute
   */
  toggleTrackMute(index: number): void {
    const track = this.tracks[index];
    if (track) {
      track.isMuted = !track.isMuted;
      this.alphaTabService.setTrackMute(index, track.isMuted);
    }
  }

  /**
   * Toggle track solo
   */
  toggleTrackSolo(index: number): void {
    const track = this.tracks[index];
    if (track) {
      track.isSolo = !track.isSolo;
      this.alphaTabService.setTrackSolo(index, track.isSolo);
    }
  }

  /**
   * Format time in mm:ss
   */
  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Get progress bar percentage
   */
  getProgressPercent(): number {
    if (!this.state || this.state.totalDuration === 0) return 0;
    return (this.state.timePosition / this.state.totalDuration) * 100;
  }

  /**
   * Toggle looping
   */
  toggleLoop(): void {
    if (this.state) {
      this.alphaTabService.setLooping(!this.state.isLooping);
    }
  }

  /**
   * Handle highlight configuration change from scale highlighter
   */
  onHighlightChange(config: HighlightConfig): void {
    this.highlightConfig = config;
    this.applyHighlighting();
  }

  /**
   * Apply CSS highlighting to alphaTab notes based on current config
   */
  private applyHighlighting(): void {
    if (!this.alphaTabContainer) return;

    const container = this.alphaTabContainer.nativeElement;

    // Remove existing highlights
    container.querySelectorAll('.at-note.scale-highlight').forEach((el: Element) => {
      el.classList.remove('scale-highlight');
    });

    if (!this.highlightConfig?.enabled || !this.highlightConfig.intervals.length) {
      return;
    }

    // Calculate which note values (0-11) should be highlighted
    const highlightedNotes = this.highlightConfig.intervals.map(interval =>
      (this.highlightConfig!.rootNote + interval) % 12
    );

    // Find all note elements and highlight matching ones
    // alphaTab renders notes with data attributes we can use
    container.querySelectorAll('.at-note').forEach((noteEl: Element) => {
      const noteValue = noteEl.getAttribute('data-note');
      if (noteValue !== null) {
        const noteNum = parseInt(noteValue, 10) % 12;
        if (highlightedNotes.includes(noteNum)) {
          noteEl.classList.add('scale-highlight');
        }
      }
    });
  }
}
