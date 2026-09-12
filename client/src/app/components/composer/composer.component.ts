import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';
import { ProgressionService } from '../../services/progression.service';
import { generatedTrackState, progressionTrack } from '../../services/progression-track';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTabState } from '../../models/alpha-tab.model';
import {
  ComposerState,
  DurationValue,
  EditCursor,
  NotePitch,
  TexDiagnostic,
  TrackDoc
} from '../../models/composer.model';
import { ProgressionState } from '../../models/progression.model';

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

@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [CommonModule, FormsModule, ComposerLibraryPanelComponent, ComposerScoreComponent],
  templateUrl: './composer.component.html',
  styleUrls: ['./composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerComponent implements OnInit, OnDestroy {
  /** Highest fret the digit accumulator will build up to. */
  private static readonly MAX_FRET = 24;
  /** How long consecutive digits keep combining into one fret number. */
  private static readonly FRET_BUFFER_MS = 800;

  private readonly destroy$ = new Subject<void>();

  state: ComposerState | null = null;
  playerState: AlphaTabState | null = null;

  /**
   * The progression this page can send, or null before the first publish.
   *
   * Held rather than read on demand because the Tracks panel asks about it on
   * every change-detection pass - the badge, Update's disabled state and its
   * label all come from it - and `OnPush` needs the answer to change in step
   * with the subscription that delivered it.
   */
  progressionState: ProgressionState | null = null;

  texDraft = '';
  texDiagnostics: TexDiagnostic[] = [];
  showTexPanel = false;
  texApplyError: string | null = null;

  metronomeEnabled = false;
  countInEnabled = false;

  /** Accumulates digits so two-digit frets like 12 can be typed. */
  private fretBuffer = '';
  private fretBufferTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the digits currently being typed were written. */
  private fretTarget: EditCursor | null = null;

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

  constructor(
    private readonly composer: ComposerService,
    private readonly progression: ProgressionService,
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
        this.cdr.markForCheck();
      });

    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.progressionState = state;
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
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resetFretBuffer();
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

  get currentTrackProgram(): number {
    if (!this.state) return 25;
    return this.state.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 25;
  }

  /**
   * Writes a fret and moves on, or rewrites the note just written.
   *
   * The first digit places a note and advances the caret so a melody flows.
   * A further digit typed within the window belongs to the same number, so it
   * rewrites that note in place - "1" then "2" gives fret 12 on one beat, not
   * fret 1 followed by fret 2 - and the caret stays where it moved to.
   */
  private writeFret(fret: number, continuing: boolean): void {
    if (!this.state) return;

    const target = continuing && this.fretTarget ? this.fretTarget : this.state.cursor;
    const stringIndex = target.stringIndex ?? 0;
    const pitch: NotePitch = { kind: 'fretted', string: stringIndex + 1, fret };

    this.auditionFretted(stringIndex, fret);

    if (continuing && this.fretTarget) {
      const resume = this.state.cursor;
      this.composer.setCursor(this.fretTarget);
      this.composer.setNoteAtCursor(pitch, false);
      this.composer.setCursor(resume);
      return;
    }

    this.fretTarget = { ...target };
    this.composer.setNoteAtCursor(pitch, true);
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

  // -------------------------------------------------------------------------
  // The progression's track
  // -------------------------------------------------------------------------

  /**
   * Puts the progression into the score, or refreshes the copy already in it.
   *
   * "Add progression track" and a row's Update are one call, because
   * `sendProgression` is one command: the merge appends when the score holds
   * nothing of this progression and replaces it in place when it does, so the
   * difference is a fact about the score rather than a choice this component
   * makes. The progression page's Send is the third button over the same call -
   * the push is where the user made the thing, the pull is where it will
   * appear, and the design doc settles that under "Where the controls are".
   *
   * Nothing happens before the service's first publish, which is the one state
   * in which this page does not yet know what it would be sending.
   */
  addProgressionTrack(): void {
    const state = this.progressionState;
    if (!state) return;

    // Projected fresh on every press and not retained. `sendProgression` states
    // both of the preconditions this expression satisfies: the merged score
    // shares bar objects with the projection, so a kept copy edited afterwards
    // would be writing into a committed score behind undo's back; and the
    // track has to be barred in the *score's* meter, because it will share the
    // score's bar lines - a mismatch throws rather than engraving music that
    // disagrees with the lines drawn over it. `scoreMeter` is the service's own
    // name for the meter its guard asks about, so the two cannot answer
    // differently-shaped questions.
    //
    // The scale comes from the published state because `progressionTrack` is
    // pure and cannot resolve `key.scaleId` itself. Empty when the id resolves
    // to nothing, which spells every note from the key's preference; the
    // progression page's own export does the same for the same reason.
    this.composer.sendProgression(
      progressionTrack(
        state.doc,
        state.keyScale ? state.keyScale.intervals : [],
        this.composer.scoreMeter
      )
    );
  }

  /**
   * Update, which is a Send into a score that already holds the track.
   *
   * An alias and deliberately nothing more. The button is named for what the
   * user is doing rather than for what the service calls it, and a second
   * method with a body of its own would be a second place for the two to drift.
   */
  updateGeneratedTrack(): void {
    this.addProgressionTrack();
  }

  /** Hands the track over to the user, keeping the music and dropping the link. */
  flattenGeneratedTrack(index: number): void {
    this.composer.flattenTrack(index);
  }

  /**
   * Whether this row's track is behind the progression it was built from.
   *
   * `generatedTrackState` is the one function the badge, the edit gate and this
   * button all read, so a moved revision and a divergence - a bar inserted into
   * the score, which moves the track's content while the progression stands
   * still - cannot be answered differently by two callers who each remembered
   * one of them.
   *
   * The id check beside it is what keeps the answer *this row's*. The state is
   * a fact about a score and a progression as a pair, so a score holding a
   * track from some progression other than the one open would otherwise read
   * that other track's freshness off this one's.
   */
  canUpdate(track: TrackDoc): boolean {
    const current = this.progressionState;
    if (!current || !this.state) return false;
    if (track.generated?.progressionId !== current.doc.id) return false;

    return generatedTrackState(this.state.doc, current.doc) === 'stale';
  }

  /**
   * What Update is offering, in a sentence.
   *
   * The badge sits *beside* this button rather than inside it, and nothing
   * carries a neighbouring element into a button's accessible name, so the
   * label has to name both the track and the reason itself. Which track,
   * because a panel of rows offers one of these per row and "Update" alone
   * names none of them; and why, because the disabled state is the whole
   * information the button carries in that case.
   *
   * Three answers and not two: a track whose marker names a progression that is
   * not the one open cannot be updated either, and saying it is up to date
   * would be a claim this page cannot check.
   */
  updateLabel(track: TrackDoc): string {
    const from = track.generated?.progressionName ?? '';

    if (this.canUpdate(track)) {
      return `Update ${track.name} from the progression ${from}, which has changed since `
        + 'this track was written';
    }

    if (track.generated?.progressionId === this.progressionState?.doc.id) {
      return `${track.name} is up to date with the progression ${from}`;
    }

    return `${from} is not the progression that is open, so ${track.name} cannot be updated here`;
  }

  /** What Flatten is offering, named the same way and for the same reason. */
  flattenLabel(track: TrackDoc): string {
    const from = track.generated?.progressionName ?? '';
    return `Flatten ${track.name}, detaching it from the progression ${from} and keeping the music`;
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
      this.texDraft = this.currentTex();
      this.texDiagnostics = [];
      this.texApplyError = null;
    }
  }

  /** Canonical alphaTex for the current document, generated on demand. */
  private currentTex(): string {
    if (!this.state) return '';
    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      return this.texService.export(score);
    } catch {
      return '';
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
    this.texDraft = this.currentTex();
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
        this.resetFretBuffer();
        this.composer.moveCursorByBeat(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.resetFretBuffer();
        this.composer.moveCursorByBeat(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.resetFretBuffer();
        this.composer.moveCursorByString(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.resetFretBuffer();
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

  /**
   * Number keys type frets onto the current string, as in Guitar Pro.
   *
   * Digits accumulate briefly so two-digit frets can be typed: "1" then "2"
   * within the window means fret 12, not fret 1 followed by fret 2. A digit
   * that would overshoot the fretboard starts a fresh number rather than being
   * silently clamped.
   */
  private handleFretDigit(event: KeyboardEvent): void {
    if (!this.currentStaffIsFretted) return;
    if (!/^[0-9]$/.test(event.key)) return;

    event.preventDefault();

    const combined = Number(this.fretBuffer + event.key);
    const continuing = this.fretBuffer !== '' && combined <= ComposerComponent.MAX_FRET;
    const fret = continuing ? combined : Number(event.key);

    this.fretBuffer = String(fret);
    if (this.fretBufferTimer) clearTimeout(this.fretBufferTimer);
    this.fretBufferTimer = setTimeout(
      () => this.resetFretBuffer(),
      ComposerComponent.FRET_BUFFER_MS
    );

    this.writeFret(fret, continuing);
  }

  private resetFretBuffer(): void {
    this.fretBuffer = '';
    this.fretTarget = null;
    if (this.fretBufferTimer) {
      clearTimeout(this.fretBufferTimer);
      this.fretBufferTimer = null;
    }
  }

  private shiftDuration(direction: number): void {
    if (!this.state) return;
    const index = this.durations.findIndex(d => d.value === this.state!.inputDuration);
    const next =
      this.durations[Math.max(0, Math.min(this.durations.length - 1, index + direction))];
    if (next) this.composer.applyDurationAtCursor(next.value, this.state.inputDots);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
