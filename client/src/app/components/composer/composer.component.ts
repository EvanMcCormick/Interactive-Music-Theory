import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';
import {
  AlphaTabState
} from '../../models/alpha-tab.model';
import {
  ComposerState,
  DurationValue,
  NotePitch,
  TexDiagnostic
} from '../../models/composer.model';

interface DurationOption {
  label: string;
  value: DurationValue;
  dots: number;
}

interface InstrumentOption {
  name: string;
  program: number;
  fretted: boolean;
}

const CHROMATIC_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer.component.html',
  styleUrls: ['./composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('alphaTabContainer') alphaTabContainer!: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();
  /** Coalesces renders so typing does not re-engrave on every keystroke. */
  private readonly renderRequest$ = new Subject<void>();

  state: ComposerState | null = null;
  playerState: AlphaTabState | null = null;

  texSource = '';
  texDraft = '';
  texDiagnostics: TexDiagnostic[] = [];
  showTexPanel = false;
  texApplyError: string | null = null;

  metronomeEnabled = false;
  countInEnabled = false;

  readonly durations: DurationOption[] = [
    { label: '𝅝', value: 1, dots: 0 },
    { label: '𝅗𝅥', value: 2, dots: 0 },
    { label: '𝅘𝅥', value: 4, dots: 0 },
    { label: '𝅘𝅥𝅮', value: 8, dots: 0 },
    { label: '𝅘𝅥𝅯', value: 16, dots: 0 },
    { label: '𝅘𝅥𝅰', value: 32, dots: 0 }
  ];

  readonly instruments: InstrumentOption[] = [
    { name: 'Acoustic Guitar', program: 25, fretted: true },
    { name: 'Electric Guitar', program: 27, fretted: true },
    { name: 'Bass', program: 33, fretted: true },
    { name: 'Piano', program: 0, fretted: false },
    { name: 'Strings', program: 48, fretted: false },
    { name: 'Flute', program: 73, fretted: false },
    { name: 'Trumpet', program: 56, fretted: false }
  ];

  newTrackInstrument: InstrumentOption = this.instruments[3];

  /** Octaves offered by the pitched-input keyboard. */
  readonly octaves = [2, 3, 4, 5, 6];
  inputOctave = 4;
  readonly chromatic = CHROMATIC_SHARPS;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly texService: AlphaTexService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.renderRequest$.next();
        this.cdr.markForCheck();
      });

    this.alphaTabService
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.playerState = state;
        // alphaTab events originate outside Angular's zone.
        this.cdr.detectChanges();
      });

    this.renderRequest$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(() => this.renderCurrentDocument());
  }

  ngAfterViewInit(): void {
    this.alphaTabService.initializeApi(this.alphaTabContainer.nativeElement, {
      core: { fontDirectory: '/font/', useWorkers: true },
      display: { scale: 1.0, staveProfile: 'default', layoutMode: 'page' },
      player: {
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: this.alphaTabContainer.nativeElement
      }
    });
    this.renderCurrentDocument();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.alphaTabService.dispose();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderCurrentDocument(): void {
    if (!this.state) return;

    try {
      const settings = new alphaTab.Settings();
      const score = this.mapper.toScore(this.state.doc, settings);
      this.alphaTabService.renderScore(score);
      this.texSource = this.texService.export(score);
      if (!this.showTexPanel) {
        this.texDraft = this.texSource;
      }
      this.texApplyError = null;
    } catch (error) {
      this.texApplyError =
        error instanceof Error ? error.message : 'Failed to render the score';
    }
    this.cdr.markForCheck();
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  playPause(): void {
    this.alphaTabService.playPause();
  }

  stop(): void {
    this.alphaTabService.stop();
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

  // -------------------------------------------------------------------------
  // Note entry
  // -------------------------------------------------------------------------

  get currentStaffIsFretted(): boolean {
    if (!this.state) return false;
    const staff = this.composer.staffAt(this.state.doc, this.state.cursor);
    return !!staff && staff.tuning.length > 0;
  }

  get currentStringCount(): number {
    if (!this.state) return 0;
    return this.composer.staffAt(this.state.doc, this.state.cursor)?.tuning.length ?? 0;
  }

  get currentTrackProgram(): number {
    if (!this.state) return 25;
    return this.state.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 25;
  }

  /** Frets offered by the fretted-input widget. */
  readonly frets = Array.from({ length: 13 }, (_, i) => i);

  enterFret(stringIndex: number, fret: number): void {
    const pitch: NotePitch = { kind: 'fretted', string: stringIndex + 1, fret };
    this.auditionFretted(stringIndex, fret);
    this.composer.setCursor({ stringIndex });
    this.composer.setNoteAtCursor(pitch);
  }

  enterPitch(noteValue: number): void {
    const pitch: NotePitch = { kind: 'pitched', noteValue, octave: this.inputOctave };
    // alphaTab octave convention is handled in the mapper; MIDI is direct here.
    this.alphaTabService.auditionNote(
      (this.inputOctave + 1) * 12 + noteValue,
      this.currentTrackProgram
    );
    this.composer.setNoteAtCursor(pitch);
  }

  private auditionFretted(stringIndex: number, fret: number): void {
    if (!this.state) return;
    const staff = this.composer.staffAt(this.state.doc, this.state.cursor);
    const openString = staff?.tuning[stringIndex];
    if (openString === undefined) return;
    this.alphaTabService.auditionNote(openString + fret, this.currentTrackProgram);
  }

  enterRest(): void {
    this.composer.setRestAtCursor();
  }

  deleteAtCursor(): void {
    this.composer.deleteAtCursor();
  }

  selectDuration(option: DurationOption): void {
    this.composer.applyDurationAtCursor(option.value, option.dots);
  }

  toggleDot(): void {
    if (!this.state) return;
    const dots = this.state.inputDots > 0 ? 0 : 1;
    this.composer.applyDurationAtCursor(this.state.inputDuration, dots);
  }

  isDurationActive(option: DurationOption): boolean {
    return this.state?.inputDuration === option.value;
  }

  // -------------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------------

  addBar(): void {
    this.composer.appendBar();
  }

  removeBar(): void {
    if (this.state) this.composer.removeBar(this.state.cursor.barIndex);
  }

  addTrack(): void {
    const instrument = this.newTrackInstrument;
    this.composer.addTrack(instrument.name, instrument.program, instrument.fretted);
  }

  removeTrack(index: number): void {
    this.composer.removeTrack(index);
  }

  selectTrack(index: number): void {
    this.composer.setCursor({ trackIndex: index, staffIndex: 0 });
  }

  undo(): void {
    this.composer.undo();
  }

  redo(): void {
    this.composer.redo();
  }

  newScore(): void {
    this.composer.reset();
  }

  // -------------------------------------------------------------------------
  // alphaTex escape hatch
  // -------------------------------------------------------------------------

  toggleTexPanel(): void {
    this.showTexPanel = !this.showTexPanel;
    if (this.showTexPanel) {
      this.texDraft = this.texSource;
      this.texDiagnostics = [];
      this.texApplyError = null;
    }
  }

  applyTex(): void {
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;

    if (!result.score) {
      // Keep the last good document; the diagnostics explain the failure.
      this.texApplyError = 'alphaTex could not be parsed. The score is unchanged.';
      this.cdr.markForCheck();
      return;
    }

    this.texApplyError = null;
    this.composer.replaceDocument(this.mapper.toDoc(result.score));
    this.cdr.markForCheck();
  }

  revertTex(): void {
    this.texDraft = this.texSource;
    this.texDiagnostics = [];
    this.texApplyError = null;
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts (Guitar Pro style)
  // -------------------------------------------------------------------------

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.composer.redo() : this.composer.undo();
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.composer.moveCursorByBeat(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.composer.moveCursorByBeat(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.composer.moveCursorByString(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.composer.moveCursorByString(1);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.composer.deleteAtCursor();
        break;
      case 'r':
        event.preventDefault();
        this.enterRest();
        break;
      case '+':
        event.preventDefault();
        this.shiftDuration(-1);
        break;
      case '-':
        event.preventDefault();
        this.shiftDuration(1);
        break;
      case ' ':
        event.preventDefault();
        this.playPause();
        break;
      default:
        this.handleFretDigit(event);
    }
  }

  /** Number keys type frets directly onto the current string, as in Guitar Pro. */
  private handleFretDigit(event: KeyboardEvent): void {
    if (!this.currentStaffIsFretted) return;
    if (!/^[0-9]$/.test(event.key)) return;

    event.preventDefault();
    const stringIndex = this.state?.cursor.stringIndex ?? 0;
    this.enterFret(stringIndex, Number(event.key));
  }

  private shiftDuration(direction: number): void {
    if (!this.state) return;
    const index = this.durations.findIndex(d => d.value === this.state!.inputDuration);
    const next = this.durations[Math.max(0, Math.min(this.durations.length - 1, index + direction))];
    if (next) this.composer.applyDurationAtCursor(next.value, this.state.inputDots);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
