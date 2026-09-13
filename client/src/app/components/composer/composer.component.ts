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
import {
  GeneratedTrackState,
  generatedTrackState,
  progressionLabel,
  progressionTrack
} from '../../services/progression-track';
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

/**
 * How one generated row stands to the progression that is open.
 *
 * `GeneratedTrackState` answers this for a score and a progression as a *pair*,
 * which is one answer short of what a row has to draw: it splits `'stale'` into
 * neither of its two halves, and it has no word at all for a row built from
 * some progression other than the one open, because from its point of view that
 * score holds nothing of this progression. This is that answer widened by the
 * two facts the row knows and the pair does not - which marker this row carries,
 * and what kind of source it names.
 *
 * Still derived from `generatedTrackState` rather than computed beside it. The
 * splitting is a *reading* of the one answer, not a second opinion about it, so
 * the enabled/refused line stays where every other caller reads it.
 */
type GeneratedRowState = 'current' | 'behind' | 'moved' | 'foreign';

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
   * every change-detection pass - the badge, the row's status, whether Update
   * and the panel's own send button are refusing, and all four of their labels
   * come from it - and `OnPush` needs the answer to change in step with the
   * subscription that delivered it.
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

    // The `markForCheck` here is not held by the suite, and saying so is
    // cheaper than a test that would pin it. `fixture.detectChanges()` refreshes
    // the fixture's own view whether or not it was marked dirty, so deleting
    // this line leaves every test in `composer.component.spec.ts` green while
    // the panel stops repainting in the app. What keeps the risk small is that
    // the two pages are separate routes: a progression cannot be edited while
    // this component is alive today, so the only emission it currently sees is
    // the synchronous first one, which arrives before the first render anyway.
    // A progression editable beside the score - a split view, or the library
    // this feature is heading for - is what would make the line load-bearing,
    // and is when it is worth a test that drives change detection itself.
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
  //
  // ## Where the state is said, and what the two buttons do about it
  //
  // Three facts settle the shape of everything below, and the first two were
  // found by review rather than by design.
  //
  // A `disabled` button hides its own explanation from nearly everybody. It is
  // out of the tab order, so its `aria-label` cannot be reached by focus, and
  // browsers suppress `title` on it - so the sentence explaining *why* Update
  // is greyed out reached only a screen-reader user browsing the page outside
  // focus order. That is the smallest audience of the three who need it.
  //
  // And a refusal one button makes is not a refusal the panel makes. "Add
  // progression track" is the same `sendProgression` call, so pressing it on an
  // up-to-date track committed a byte-identical merge - an undo entry and a
  // dirty document for no visible change - which is exactly what the Update
  // beside it was greyed out to prevent.
  //
  // So: **the state is said on the row, in words, where nothing has to be
  // focused to read it**; both buttons refuse on one reading of that state; and
  // both refuse with `aria-disabled` plus an early return rather than with
  // `disabled`, which keeps them focusable, keeps the tooltip, and leaves the
  // reason reachable by every route. The early return is what makes the refusal
  // real - `aria-disabled` is advisory, so a handler that ignored it would let
  // a click through the announcement.
  //
  // The alternative considered was relabelling the panel button ("Update
  // progression track" when the score already holds it). It was rejected: the
  // word on a button is what a speech-input user says to press it, so a caption
  // that changes underneath the state is a control whose name moves, and the
  // row already carries an Update whose whole job is that case.
  // -------------------------------------------------------------------------

  /**
   * What this score holds of the progression that is open, or null before the
   * first publish.
   *
   * The single reading every control below is derived from: whether either
   * button refuses, what each of the four labels says, and what the row's
   * status shows. Deriving them rather than each asking `generatedTrackState`
   * on its own terms is what stops the panel refusing a press for one reason
   * and explaining it with another.
   *
   * Null is the pre-publish state and it is not reachable today - `getState()`
   * is a `BehaviorSubject` and emits synchronously inside `ngOnInit`, so the
   * field is set before the first render. It is a branch rather than a `!`
   * because a page that could be opened without a progression is the cheaper
   * thing to keep true than to prove impossible.
   */
  private sendState(): GeneratedTrackState | null {
    if (!this.state || !this.progressionState) return null;

    return generatedTrackState(this.state.doc, this.progressionState.doc);
  }

  /**
   * Whether "Add progression track" would change the score.
   *
   * `'current'` is the one answer that refuses, and it refuses for the reason
   * the section comment gives: the merge would be byte-identical, so the press
   * would spend an undo entry and the dirty flag on nothing. `'absent'` adds and
   * `'stale'` refreshes, and both are real changes.
   */
  canAddProgressionTrack(): boolean {
    const state = this.sendState();

    return state !== null && state !== 'current';
  }

  /**
   * What the panel's send button is offering, in a sentence that starts with
   * the words printed on it.
   *
   * Leading with the visible label is WCAG 2.1 SC 2.5.3 and not house style: an
   * accessible name that does not contain the visible one is a control a
   * speech-input user cannot address by the name they can see. The old label -
   * "Add the current progression to this score as a track" - shared no phrase
   * with "Add progression track", so saying the words on the button matched
   * nothing.
   */
  addProgressionTrackLabel(): string {
    const state = this.progressionState;
    if (!state) return 'Add progression track: there is no progression to add yet';

    const from = progressionLabel(state.doc.name);

    switch (this.sendState()) {
      case 'stale':
        return `Add progression track: refreshes the copy of ${from} this score already holds`;
      case 'current':
        return `Add progression track: this score already holds ${from} as it stands`;
      default:
        return `Add progression track: puts ${from} into this score as a track`;
    }
  }

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
   * The guard is `canAddProgressionTrack` and not a null check, because
   * `aria-disabled` only says a control is refusing - it does not stop the
   * click, and the handler is where the refusal is actually made.
   */
  addProgressionTrack(): void {
    // The refusal is the second half; the first is only how a null field
    // becomes a `ProgressionState` below, since `canAddProgressionTrack`
    // already answers false for it.
    const state = this.progressionState;
    if (!state || !this.canAddProgressionTrack()) return;

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
   * Almost an alias, and deliberately little more: the button is named for what
   * the user is doing rather than for what the service calls it, and a second
   * method with a body of its own would be a second place for the two to drift.
   *
   * ## Why it takes no track when everything beside it does
   *
   * `flattenGeneratedTrack` takes an index, `canUpdate` and the labels take a
   * track, and this takes nothing - which is correct only because of an
   * invariant worth naming rather than rediscovering. **At most one track in a
   * score can carry the open progression's id**: `mergeGeneratedTrack` matches
   * on `progressionId` and replaces in place, so a second Send never appends a
   * second copy. A row whose marker names some *other* progression is refused
   * below rather than updated. So there is only ever one row this could mean,
   * and passing the row in would be passing in a value the call could not use.
   *
   * The day that stops being true - a score holding two progressions' tracks
   * with the second one open, which is what a progression library brings - this
   * has to take the track and send *that* row's progression, or it becomes a
   * wrong-row update: the press would refresh whichever track matches the open
   * progression rather than the one whose button was pressed.
   *
   * The refusal is `'stale'` and not "anything but current", which matters for
   * exactly that case: a row built from a progression that is not open reads
   * `'absent'` here, and falling through to the send would *append* a second
   * generated track rather than refuse.
   */
  updateGeneratedTrack(): void {
    if (this.sendState() !== 'stale') return;

    this.addProgressionTrack();
  }

  /** Hands the track over to the user, keeping the music and dropping the link. */
  flattenGeneratedTrack(index: number): void {
    this.composer.flattenTrack(index);
  }

  /**
   * How this row stands to the progression that is open.
   *
   * The one branch point the row has: the status on screen, whether Update
   * refuses and what its label says are all this answer said three ways, so
   * they cannot disagree about which of them the user is looking at.
   *
   * `generatedTrackState` is still the function that decides *stale or not* -
   * it is the one the badge, the edit gate and the service's own refusals all
   * read, and answering that here would be a second opinion about it. What this
   * adds is the two distinctions it does not carry:
   *
   *  - **Which row.** The state is a fact about a score and a progression as a
   *    pair, so a score holding some *other* progression's track would read that
   *    track's freshness off this row. `'foreign'` is that case named, and it is
   *    a refusal rather than a claim: whether that track matches its own
   *    progression is a question this page has no document to answer.
   *  - **Which half of stale.** `'stale'` is one answer to two questions, and
   *    `GeneratedOrigin.source` is where they stay apart - which is the whole
   *    reason the marker holds a union rather than a revision and a flag. A
   *    moved revision means the progression changed; `'diverged'` means a
   *    score-wide bar edit moved this track while the progression stood still.
   *    Telling a user the second was the first is a claim about a document they
   *    did not touch.
   *
   * A track that is both - a bar inserted and then the progression edited -
   * reads `'moved'`, because the marker was restated as `'diverged'` and no
   * longer holds a revision to compare. Both are stale and one Update fixes
   * both, so the cost is the less complete of two true sentences.
   */
  private generatedStatus(track: TrackDoc): GeneratedRowState {
    const marker = track.generated;
    if (!marker || marker.progressionId !== this.progressionState?.doc.id) return 'foreign';
    if (marker.source.kind === 'diverged') return 'moved';

    return this.sendState() === 'stale' ? 'behind' : 'current';
  }

  /**
   * That state in the fewest true words, drawn beside the badge.
   *
   * On screen because a `disabled` control's explanation is unreachable by
   * focus and its tooltip is suppressed - see the section comment. The row is
   * where the state can be read without pressing or focusing anything, which is
   * also what lets the labels below stay a sentence each rather than the only
   * copy of the information.
   *
   * Short because the panel is 15rem wide and this sits under a name the user
   * is scanning for. "behind the progression" and "moved by a score edit" are
   * the two halves of stale in the plainest words that distinguish them.
   */
  generatedStatusLabel(track: TrackDoc): string {
    switch (this.generatedStatus(track)) {
      case 'behind':
        return 'behind the progression';
      case 'moved':
        return 'moved by a score edit';
      case 'foreign':
        return 'progression not open';
      default:
        return 'up to date';
    }
  }

  /** Whether this row's Update would change anything. Refuses on the other three. */
  canUpdate(track: TrackDoc): boolean {
    const state = this.generatedStatus(track);

    return state === 'behind' || state === 'moved';
  }

  /**
   * What Update is offering, in a sentence.
   *
   * The badge and the status sit *beside* this button rather than inside it,
   * and nothing carries a neighbouring element into a button's accessible name,
   * so the label has to name the track and the reason itself. Which track,
   * because a panel of rows offers one of these per row; and why, because a
   * refusal that does not say why is a greyed-out control and nothing more.
   *
   * Every answer leads with "Update", the word printed on the button. That is
   * WCAG 2.1 SC 2.5.3: an accessible name that drops the visible one leaves a
   * speech-input user saying what they can see and matching nothing. It applies
   * to the refusals too, now that they are focusable.
   *
   * Four answers, one per state, and the two halves of stale are two of them.
   * The `'foreign'` sentence is the one the app cannot currently produce - see
   * `openAnotherProgression` in the spec for what would - and it is still not
   * "up to date", because that would be a claim this page has no document to
   * check.
   */
  updateLabel(track: TrackDoc): string {
    const from = this.sourceOf(track);

    switch (this.generatedStatus(track)) {
      case 'behind':
        return `Update ${track.name} from ${from}, which has changed since this track was `
          + 'written';
      case 'moved':
        return `Update ${track.name} from ${from}, because a score edit has moved this track `
          + 'since it was written';
      case 'foreign':
        return `Update ${track.name}: ${from} is not the one that is open, so this track `
          + 'cannot be updated here';
      default:
        return `Update ${track.name}: it already matches ${from}`;
    }
  }

  /** What Flatten is offering, named the same way and for the same reason. */
  flattenLabel(track: TrackDoc): string {
    return `Flatten ${track.name}, detaching it from ${this.sourceOf(track)} and keeping the music`;
  }

  /**
   * How a label refers to the progression a track came from.
   *
   * Two names that are usually one string. The row is labelled with the track's
   * name and the marker carries the progression's, and they start out equal
   * because nothing renames a progression - so naming both said "it already
   * matches the progression Progression", which is what nearly every user
   * heard. They are still two different facts, and they come apart the moment
   * either end is renamed, so the fix is to stop saying the second aloud when
   * it would only repeat the first rather than to drop it from the sentence.
   *
   * Every caller reads this as a noun phrase mid-sentence, which is why the
   * article is in here and not at the call sites: "the progression it came
   * from" and "the progression Verse" have to substitute for one another in
   * all five, including `'foreign'`, where the phrase is the subject.
   */
  private sourceOf(track: TrackDoc): string {
    const from = track.generated?.progressionName ?? '';
    return from === track.name ? 'the progression it came from' : `the progression ${from}`;
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
