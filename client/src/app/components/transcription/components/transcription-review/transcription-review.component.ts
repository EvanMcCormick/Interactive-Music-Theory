import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgModel } from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc, TimeSignature } from '../../../../models/composer.model';
import {
  DerivationSettings,
  FinestDivision
} from '../../../../models/transcription.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import {
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  canNudgeDownbeat
} from '../../../../services/beat-grid-edit';
import { messageOf } from '../../../../services/error-message';
import {
  NoteIndex,
  RenderedNote,
  buildPreviewDoc,
  detectionAt
} from '../../../../services/preview-score';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HarmonicOptions
} from '../../../../services/transcription-harmonics';
import { TranscriptionState } from '../../../../services/transcription.service';
import {
  DiscardGroup,
  DiscardRow,
  FINEST_DIVISIONS,
  HARMONIC_REFUSALS,
  HarmonicMirror,
  TIME_SIGNATURE_PRESETS,
  TUNING_PRESETS,
  TimeSignaturePreset,
  TuningPreset,
  derivationRemedies,
  describeFolds,
  describeToggle,
  drawnIds,
  gridTempoBpm,
  groupDiscards,
  meterId,
  restoredRows,
  sameTuning,
  withCurrentMeter,
  withCurrentTuning
} from './review-controls';

/**
 * The screen where a transcription becomes trustworthy.
 *
 * Nine knobs on one side, the score they produce on the other, and - the part
 * that makes the discards judgeable rather than invisible - every detection the
 * pipeline turned away drawn as a ghost in the bar it was struck in.
 *
 * ## It never sees `TranscriptionService`
 *
 * The state arrives as an `@Input` and every change leaves as an `@Output`, so
 * the panel is exercised against a plain object rather than a running pipeline.
 * That is not only a testing convenience: it is what makes the round trip
 * checkable at all. A control here is *controlled* - it shows what the state
 * says and nothing else - so a change the service refuses visibly snaps back,
 * and a change it applies is visible because the state came back carrying it.
 * A component that emitted and then trusted its own optimistic value could not
 * tell those two apart.
 *
 * The mirror fields (`tuningPresetId`, `tempoBpm`, ...) are what make that
 * work. Each is set optimistically when its control moves and then overwritten
 * from the incoming state in `ngOnChanges`. Binding the controls straight at
 * `state.session.settings.x` would look tidier and would *not* snap back: with
 * the bound value unchanged, `ngModel` has nothing to write, and the control
 * would sit showing a setting the score was never derived with.
 *
 * The mirror fields are necessary and, for the two controls a *refusal* can
 * touch, not sufficient - the round trip happens inside one change-detection
 * cycle, so `ngModel` sees the same bound value at both ends of it and writes
 * nothing. `snapRefusedControlsBack` is the other half; read it before
 * changing either.
 *
 * `@Input` state must be replaced rather than mutated - `OnPush` plus
 * `ngOnChanges` is the whole update path. `TranscriptionService` pushes a new
 * object every time, including on a refusal.
 *
 * ## The preview is the ghost document
 *
 * `buildPreviewDoc`, not `derived.doc`: voice 1 is shared by identity with the
 * document that exports, and voice 2 carries the discards. *Open in Composer*
 * is Task 5's job and sends `derived.doc`, never this.
 *
 * ## Past CLAUDE.md's 500-line ceiling, deliberately
 *
 * 303 of these lines are code and the rest is prose, and the same argument
 * `transcription.service.ts` makes applies: the rule exists so a file stays
 * small enough to hold in the head, and the only extractions on offer here are
 * the docblocks - which are the part worth keeping next to the code. The knob
 * table, the preset lists and the discard grouping already live in
 * `review-controls.ts`. If the *code* grows past the ceiling the answer
 * changes, and splitting the preview rendering out into a child component is
 * the shape that would take.
 *
 * Rendering follows `ComposerScoreComponent` exactly - one alphaTab instance, a
 * debounced render request, and a `ResizeObserver`, because alphaTab silently
 * refuses to draw into a zero-width element and never retries. The one
 * difference is that `AlphaTabService` is provided *here* rather than taken
 * from the root injector. The root instance holds a single `AlphaTabApi` and
 * `initializeApi` disposes whatever was already there, so two components that
 * both used it would tear down each other's score. It also makes the renderer
 * stubbable, which is how the specs assert the preview re-renders without
 * booting a real engraver.
 */

/** Coalesces renders, so dragging the confidence slider re-engraves once. */
const RENDER_DEBOUNCE_MS = 120;

/** Shared: `NoteIndex` is a `ReadonlyMap` and nothing here writes to one. */
const EMPTY_INDEX: NoteIndex = new Map<string, string>();

/** Distinguishes control ids when more than one panel is on a page. */
let instanceCount = 0;

/**
 * Which knob a refusal is standing next to.
 *
 * Every control whose value `TranscriptionService.rederive` can turn away:
 * `barGridFault` answers for the first two and `fretboardFault` for the rest.
 * A refusal shown beside the wrong control is worse than none, so a control
 * added to either check has to be added here and given its own message slot in
 * the template.
 */
export type RefusableControl =
  | 'finestDivision'
  | 'timeSignature'
  | 'capo'
  | 'maxFret'
  | 'positionHint';

@Component({
  selector: 'app-transcription-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transcription-review.component.html',
  styleUrls: ['./transcription-review.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AlphaTabService]
})
export class TranscriptionReviewComponent
  implements OnInit, OnChanges, AfterViewInit, OnDestroy
{
  @Input() state: TranscriptionState | null = null;

  /** Any subset of `DerivationSettings`, which the service merges. */
  @Output() readonly settingsChanged = new EventEmitter<Partial<DerivationSettings>>();
  @Output() readonly timeSignatureChanged = new EventEmitter<TimeSignature>();
  @Output() readonly tempoChanged = new EventEmitter<number>();
  /** Whole beats, signed. `-1` starts bar 1 a beat earlier. */
  @Output() readonly downbeatNudged = new EventEmitter<number>();
  /**
   * A `DetectedNote.id` whose suppression verdict the user wants reversed.
   *
   * An id and not a verdict, because the panel is not entitled to one: which
   * way a toggle goes depends on the kept set, which the service owns, and a
   * component that emitted "keep this" would be stating a conclusion it had
   * derived from a score that may already have been replaced. `toggleNote`
   * reads the current session and decides; see its docblock for why the cycle
   * is two steps rather than three.
   */
  @Output() readonly noteToggled = new EventEmitter<string>();
  /**
   * A suppression threshold, which the service merges onto `session.harmonics`.
   *
   * Separate from `settingsChanged` because the two are separate contracts:
   * `DerivationSettings` is what `deriveScore` consumes, and these four run a
   * step earlier, deciding which detections are notes at all. One emitter
   * carrying both would hand the host a union it had to take apart.
   */
  @Output() readonly harmonicsChanged = new EventEmitter<Partial<HarmonicOptions>>();

  @ViewChild('previewContainer') previewContainer?: ElementRef<HTMLDivElement>;

  // The controls a refusal can leave disagreeing with the score. See
  // `snapRefusedControlsBack`.
  @ViewChild('divisionModel') divisionModel?: NgModel;
  @ViewChild('meterModel') meterModel?: NgModel;
  @ViewChild('capoModel') capoModel?: NgModel;
  @ViewChild('maxFretModel') maxFretModel?: NgModel;
  @ViewChild('positionModel') positionModel?: NgModel;

  readonly finestDivisions = FINEST_DIVISIONS;
  readonly minTempoBpm = MIN_TEMPO_BPM;
  readonly maxTempoBpm = MAX_TEMPO_BPM;

  private readonly seq = ++instanceCount;

  /** Control and hint ids, unique per instance so every `for` is unambiguous. */
  readonly id = {
    tuning: `txr-tuning-${this.seq}`,
    capo: `txr-capo-${this.seq}`,
    division: `txr-division-${this.seq}`,
    divisionHint: `txr-division-hint-${this.seq}`,
    confidence: `txr-confidence-${this.seq}`,
    confidenceHint: `txr-confidence-hint-${this.seq}`,
    position: `txr-position-${this.seq}`,
    positionHint: `txr-position-hint-${this.seq}`,
    maxFret: `txr-max-fret-${this.seq}`,
    maxFretHint: `txr-max-fret-hint-${this.seq}`,
    meter: `txr-meter-${this.seq}`,
    tempo: `txr-tempo-${this.seq}`,
    tempoHint: `txr-tempo-hint-${this.seq}`,
    downbeatHint: `txr-downbeat-hint-${this.seq}`,
    controlsHeading: `txr-controls-heading-${this.seq}`,
    previewHeading: `txr-preview-heading-${this.seq}`,
    partialRatio: `txr-partial-ratio-${this.seq}`,
    partialRatioHint: `txr-partial-ratio-hint-${this.seq}`,
    tolerance: `txr-tolerance-${this.seq}`,
    toleranceHint: `txr-tolerance-hint-${this.seq}`,
    unisonConfidence: `txr-unison-confidence-${this.seq}`,
    unisonConfidenceHint: `txr-unison-confidence-hint-${this.seq}`,
    unisonDuration: `txr-unison-duration-${this.seq}`,
    unisonDurationHint: `txr-unison-duration-hint-${this.seq}`,
    advancedHint: `txr-advanced-hint-${this.seq}`,
    discardsHeading: `txr-discards-heading-${this.seq}`
  };

  // What the controls show. Set optimistically when one moves, then
  // authoritatively from the incoming state; see the class docblock.
  tuningPresetId = '';
  capo = 0;
  finestDivision: FinestDivision = 16;
  confidenceFloor = 0;
  positionHint: number | null = null;
  maxFret = 24;
  timeSignatureId = '';
  tempoBpm: number | null = null;
  /**
   * What the four threshold controls show.
   *
   * One object rather than four fields, and replaced rather than mutated, for
   * the reason the class docblock gives about the other mirrors: it is set
   * optimistically when a control moves and overwritten from the arriving
   * session, so a change the service turns away visibly snaps back. Sharing
   * the session's own object between those two moments is safe because nothing
   * here writes into it.
   *
   * `HarmonicMirror` and not `HarmonicOptions`, because a threshold the panel
   * *refused* is written here too - the box is showing a non-number and this
   * has to be able to say so. That is what makes the snap-back work at all;
   * see `onHarmonicChange` and `HarmonicMirror`.
   */
  harmonics: HarmonicMirror = { ...DEFAULT_HARMONIC_OPTIONS };

  /** Presets plus, when the state matches none of them, the setting it is on. */
  tuningOptions: TuningPreset[] = [...TUNING_PRESETS];
  timeSignatureOptions: TimeSignaturePreset[] = [...TIME_SIGNATURE_PRESETS];

  hasScore = false;
  hasBars = false;
  failure: string | null = null;
  renderError: string | null = null;

  canNudgeBack = false;
  canNudgeForward = false;

  /** Everything missing from the score, grouped by why. */
  discards: DiscardGroup[] = [];
  discardTotal = 0;
  /** Ghosts the preview could not place at all, across every group. */
  omittedCount = 0;
  /** In the score only because the user put them back; undoable from here. */
  restored: DiscardRow[] = [];
  /**
   * Which ghosts a click must decline, and what to say instead.
   *
   * The staff draws two kinds of ghost and a notehead does not distinguish
   * them: suppression's, which a toggle reverses, and derivation's, which it
   * would *suppress*. `DiscardGroup.restorable` states the difference and the
   * list acts on it by withholding a button; `onNoteClicked` acts on it by
   * reading this. See `derivationRemedies`.
   */
  private remedies: ReadonlyMap<string, string> = new Map<string, string>();
  /**
   * What octave correction moved, or null when it moved nothing.
   *
   * Beside the discard counts and deliberately not among them: a folded note is
   * in the score, so it is not something the pipeline discarded. It is still
   * something the pipeline decided, and until this line existed the panel's
   * only account of the pipeline's decisions was the discard list - so
   * switching from a bass tuning to a guitar one moved every note under E2 up
   * an octave and the screen said nothing at all.
   */
  foldNote: string | null = null;

  /**
   * What the last click on the score did, or null when the last state change
   * was not one.
   *
   * Derived from the state that came back rather than from the click that went
   * out, which is the same stance the mirror fields take: the panel emitted an
   * id and has no idea which way the service moved it, so it asks the arriving
   * session whether that note is in the kept set now. A click the service
   * ignored - an id it did not recognise - pushes no state at all and leaves
   * this null, which is the honest answer.
   *
   * Cleared by the next state that is not a toggle, so a sentence about one
   * note cannot outlive the derivation it described.
   *
   * Also where a *declined* click reports itself. That gesture produces no
   * state at all - it is refused before the emit - so the sentence is written
   * here directly and says which control moves the note instead. See
   * `onNoteClicked`.
   */
  toggleNote: string | null = null;

  /** Set when the user states a tempo outside the range the service accepts. */
  tempoNote: string | null = null;
  /**
   * Why a threshold was not applied, by field; each is rendered beside its own
   * control. Empty when all four are numbers. See `HARMONIC_REFUSALS`.
   */
  harmonicNotes: Partial<Record<keyof HarmonicOptions, string>> = {};
  /** Which control the current refusal belongs beside. */
  refusalControl: RefusableControl = 'finestDivision';

  private previewDoc: ScoreDoc | null = null;
  /**
   * The way back from a note **on the page** to the detection behind it.
   *
   * On the page, not in the latest state: this is only ever replaced by
   * `renderPreview`, once `renderScore` has been handed the document it
   * describes. `buildPreviewDoc` hands the document and the index back together
   * because an index read against a document it did not describe answers a
   * click with a different note and nothing downstream can tell - and this
   * field is where that guarantee has to survive the trip through a renderer.
   *
   * Assigning it in `ngOnChanges` alongside `previewDoc` looked like the same
   * thing and was not, because three paths leave `ngOnChanges` without anything
   * being drawn. The render is debounced by `RENDER_DEBOUNCE_MS`, so for that
   * long the pixels are the previous score's. `renderPreview` returns without
   * drawing when the container has no width yet, and alphaTab never retries on
   * its own, so that gap lasts until the pane is laid out. And `mapper.toScore`
   * can throw, which leaves the previous score drawn and clickable under an
   * error message. In the last two the index would have run ahead of the pixels
   * indefinitely - a click on a notehead the reader can see, answered through
   * the index of a score they cannot, which is the confident wrong answer
   * `preview-score.ts` says the whole arrangement defends against.
   *
   * So the new index waits in `pendingIndex` and is promoted here after the
   * draw. Index and pixels then come from one derivation by construction, which
   * is the stance `buildPreviewDoc` already takes one level down. What remains
   * is alphaTab's own asynchrony - `renderScore` returns before the glyphs are
   * painted - and that window is a frame rather than a debounce or a resize.
   */
  private noteIndex: NoteIndex = EMPTY_INDEX;
  /**
   * The index for the document that has not been drawn yet.
   *
   * Written by `ngOnChanges` and read only by `renderPreview`. See `noteIndex`.
   */
  private pendingIndex: NoteIndex = EMPTY_INDEX;
  /** The id of the click awaiting the state it produced; see `toggleNote`. */
  private pendingToggleId: string | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly renderRequest$ = new Subject<void>();
  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedWidth = 0;
  /** Set when a render was skipped because the container had no width yet. */
  private renderPending = false;

  constructor(
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.renderRequest$
      .pipe(debounceTime(RENDER_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe(() => this.renderPreview());
  }

  /**
   * Reads the new state into the fields the template binds to.
   *
   * Everything is computed here rather than in the template, per the project's
   * change-detection guidance, and because `buildPreviewDoc` is not something
   * to run once per binding check.
   *
   * Fires before `ngOnInit` on the first cycle, so the render request it makes
   * has no subscriber yet. `ngAfterViewInit` makes another, which is also when
   * there is somewhere to draw.
   */
  ngOnChanges(): void {
    const state = this.state;
    const session = state?.session ?? null;
    const derived = state?.derived ?? null;

    // Read once and cleared here, so the sentence it produces describes this
    // state and no later one. A threshold moved after a click therefore clears
    // it rather than leaving it standing over a different score.
    const toggled = this.pendingToggleId;
    this.pendingToggleId = null;

    this.failure = state?.phase === 'failed' ? state.error : null;
    this.hasScore = session !== null && derived !== null;

    if (!session || !derived) {
      this.hasBars = false;
      this.previewDoc = null;
      // `noteIndex` is left alone here and cleared by `renderPreview`, which is
      // the only place that knows what is on the page. See `noteIndex`.
      this.pendingIndex = EMPTY_INDEX;
      this.toggleNote = null;
      this.renderError = null;
      this.discards = [];
      this.discardTotal = 0;
      this.omittedCount = 0;
      this.restored = [];
      this.remedies = new Map<string, string>();
      this.harmonics = { ...DEFAULT_HARMONIC_OPTIONS };
      this.harmonicNotes = {};
      this.foldNote = null;
      this.canNudgeBack = false;
      this.canNudgeForward = false;
      this.renderRequest$.next();
      return;
    }

    const settings = session.settings;
    this.capo = settings.capo;
    this.finestDivision = settings.finestDivision;
    this.confidenceFloor = settings.confidenceFloor;
    this.positionHint = settings.positionHint;
    this.maxFret = settings.maxFret;

    // The tempo note describes a value that is no longer in the box: a state
    // arriving means something was applied, and the field below is about to be
    // rewritten from the grid. Left standing it would explain a number that is
    // not on screen any more.
    this.tempoBpm = gridTempoBpm(session.grid.beatsSec);
    this.tempoNote = null;

    this.harmonics = session.harmonics;
    // A state arriving means a change was applied, so a refusal standing beside
    // a control would explain a value that is no longer in it. Same argument as
    // `tempoNote` above.
    this.harmonicNotes = {};

    this.tuningOptions = withCurrentTuning(settings.tuning);
    this.tuningPresetId =
      this.tuningOptions.find(option => sameTuning(option.tuning, settings.tuning))?.id ??
      'custom';
    this.timeSignatureOptions = withCurrentMeter(session.grid.timeSignature);
    this.timeSignatureId = meterId(session.grid.timeSignature);

    this.canNudgeBack = canNudgeDownbeat(session.grid, -1);
    this.canNudgeForward = canNudgeDownbeat(session.grid, 1);

    if (state?.refusal) this.snapRefusedControlsBack();

    // The preview is the only place the discards are actually drawn, and its
    // index is the only record of which ones it managed to draw - so the
    // document, the list under it and the counts on that list are one pass.
    try {
      // Document and index in one statement, never separately: a click is
      // resolved through the index against the pixels the document produced,
      // and the way that goes wrong is by their coming apart. `renderPreview`
      // promotes the index once the document has been drawn. See `noteIndex`.
      const preview = buildPreviewDoc(session, derived, state?.suppressed ?? []);
      this.previewDoc = preview.doc;
      this.pendingIndex = preview.index;
      this.renderError = null;
    } catch (error) {
      this.previewDoc = null;
      // Nothing will be drawn, so `renderPreview` will empty `noteIndex` and
      // clicks on the score still on screen - from the *previous* derivation -
      // get no answer at all rather than a plausible wrong one.
      this.pendingIndex = EMPTY_INDEX;
      this.renderError = `Could not build the preview: ${messageOf(error)}`;
    }

    this.hasBars = (this.previewDoc?.masterBars.length ?? 0) > 0;

    // The one place the list and the staff could disagree, closed by reading
    // the staff's own index rather than asking a second function what the
    // score ought to contain. The pending one and not `noteIndex`, because this
    // list describes the derivation that has just arrived and `noteIndex` still
    // describes the one on screen - the list runs ahead of the staff by the
    // render debounce either way, which is a different and much older thing
    // from an index running ahead of the pixels it resolves against. See
    // `groupDiscards` and `noteIndex`.
    const drawn = drawnIds(this.pendingIndex);
    this.discards = groupDiscards(
      derived.dropped,
      state?.suppressed ?? [],
      session.decisions,
      drawn
    );
    this.restored = restoredRows(session, drawn);
    // From `derived.dropped` and not from `this.discards`, because the rows in
    // there stop at `MAX_LISTED_ROWS` and a click lands on any ghost the staff
    // drew. Same table either way; see `derivationRemedies`.
    this.remedies = derivationRemedies(derived.dropped);
    this.discardTotal = this.discards.reduce((total, group) => total + group.count, 0);
    this.omittedCount = this.discards.reduce((total, group) => total + group.omitted, 0);
    this.foldNote = describeFolds(derived.folded);
    this.toggleNote = toggled === null ? null : describeToggle(session, toggled);

    this.renderRequest$.next();
  }

  ngAfterViewInit(): void {
    const element = this.previewContainer?.nativeElement;
    if (!element) return;

    this.alphaTabService.initializeApi(element, {
      // `includeNoteBounds` is what makes a note clickable at all: alphaTab
      // hit-tests the beat and only asks for the note inside it when it
      // recorded note bounds, so without this `onNoteMouseDown` registers a
      // handler that is never called and the whole gesture fails silently.
      core: { fontDirectory: '/font/', useWorkers: true, includeNoteBounds: true },
      display: { scale: 0.9, staveProfile: 'default', layoutMode: 'page' },
      // No playback here. The review panel is for looking at, the soundfont is
      // a megabyte, and Task 5's "Open in Composer" is where a score gets a
      // player.
      player: { enablePlayer: false, enableCursor: false, enableUserInteraction: false }
    });

    // Registered once, here, against the api `initializeApi` just created.
    // `AlphaTabService` holds one `AlphaTabApi` for this component's lifetime -
    // `renderScore` reuses it and only `dispose` replaces it - so this survives
    // every re-render, and the preview re-renders on every knob turn.
    // Registering it in `renderPreview` instead would add a handler per render
    // and fire one click as many times as the score had been drawn; registering
    // it against an api that is later disposed would stop it working. Neither
    // happens because there is exactly one api and exactly one registration.
    this.alphaTabService.onNoteMouseDown(note => this.onNoteClicked(note));

    this.observeContainerWidth();
    this.renderRequest$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.alphaTabService.dispose();
  }

  // -------------------------------------------------------------------------
  // Overruling one note
  // -------------------------------------------------------------------------

  /**
   * Reverses the pipeline's verdict on the note that was clicked, if there is
   * one behind it.
   *
   * **Silent when there is not**, and that covers every case rather than a
   * corner of one: a rest has no `Note` for alphaTab to report in the first
   * place, an unfretted note takes no key the index can hold, a staff with no
   * tuning cannot have its string number flipped, and a bar the index does not
   * describe answers nothing. All four arrive here as `null` and all four are
   * a no-op, because there is nothing to say and nowhere to say it - this runs
   * from a mouse event, where a thrown error escapes into alphaTab's own
   * dispatch.
   *
   * **Declines a ghost suppression did not remove**, which is the one case
   * where there is something to say and the gesture must not be made. The staff
   * draws derivation's discards as ghosts too, and a notehead does not say
   * which kind it is - so a click on a note below the confidence floor found it
   * in `session.notes`, read it as kept, and sent it to `drop`: nothing visible
   * happened, the changed kept set re-tracked the beat grid, and the note
   * quietly acquired an override outranking the very floor the panel was
   * telling the user to lower. `DiscardGroup.restorable` already draws this
   * line for the list's button; `remedies` is the same line, drawn for a
   * surface that cannot withhold a control. The group's own remedy goes into
   * the live region instead, so the click is answered rather than swallowed.
   *
   * Otherwise the id goes out and nothing is assumed about what it means. The
   * panel does not know whether this note is about to be restored or
   * suppressed: that depends on the kept set and on the two override lists,
   * which the service owns. `toggleNote` decides, and the sentence the user
   * reads is written from the state that comes back. See
   * `TranscriptionReviewComponent.toggleNote`.
   *
   * Typed as `RenderedNote` rather than `alphaTab.model.Note`, matching
   * `detectionAt`: a real `Note` satisfies it exactly, and a spec can drive
   * this with four numbers instead of booting an engraver.
   */
  private onNoteClicked(note: RenderedNote): void {
    const id = detectionAt(this.noteIndex, note);
    if (id === null) return;

    const remedy = this.remedies.get(id);
    if (remedy !== undefined) {
      // No emit, so no state comes back and `ngOnChanges` never runs: OnPush
      // has to be told this field moved, or the sentence is written and never
      // drawn.
      this.toggleNote = remedy;
      this.cdr.markForCheck();
      return;
    }

    this.pendingToggleId = id;
    this.noteToggled.emit(id);
  }

  // -------------------------------------------------------------------------
  // The nine knobs
  // -------------------------------------------------------------------------

  /**
   * States a tuning, and what it is called.
   *
   * The label travels with the pitches because only this control knows it: the
   * array says which notes the open strings sound and nothing about which entry
   * in the list the user picked, and `deriveScore` writes it onto the staff. The
   * synthetic "Current (N strings)" entry names no instrument, so it sends
   * `null` and lets derivation infer a family from the pitches instead.
   */
  onTuningChange(presetId: string): void {
    this.tuningPresetId = presetId;
    const preset = this.tuningOptions.find(option => option.id === presetId);
    if (!preset) return;

    // Copied: the service copies it again, but handing out a preset's own array
    // would put shared reference data on the session.
    this.settingsChanged.emit({
      tuning: [...preset.tuning],
      tuningLabel: preset.id === 'custom' ? null : preset.label
    });
  }

  /**
   * States a capo position.
   *
   * The bound is `fretboardFault`'s, not this method's: a capo past the end of
   * the neck is refused by the service and the refusal is rendered next to this
   * control, rather than being pre-empted here. Checking in both places would
   * mean two copies of the rule, and the one on the control is the copy that
   * silently stops agreeing. The same goes for `onMaxFretChange` and
   * `onPositionHintChange`; contrast `onTempoChange`, where the service refuses
   * *silently* and the panel has to say so itself.
   */
  onCapoChange(capo: number | null): void {
    if (capo === null || !Number.isFinite(capo)) return;
    this.capo = capo;
    this.refusalControl = 'capo';
    this.settingsChanged.emit({ capo });
  }

  onFinestDivisionChange(division: FinestDivision): void {
    this.finestDivision = division;
    this.refusalControl = 'finestDivision';
    this.settingsChanged.emit({ finestDivision: division });
  }

  onConfidenceFloorChange(confidenceFloor: number | null): void {
    if (confidenceFloor === null || !Number.isFinite(confidenceFloor)) return;
    this.confidenceFloor = confidenceFloor;
    this.settingsChanged.emit({ confidenceFloor });
  }

  /** Blank means "let the hand roam", which is `null` on the settings. */
  onPositionHintChange(positionHint: number | null): void {
    const value =
      positionHint !== null && Number.isFinite(positionHint) ? positionHint : null;
    this.positionHint = value;
    this.refusalControl = 'positionHint';
    this.settingsChanged.emit({ positionHint: value });
  }

  onMaxFretChange(maxFret: number | null): void {
    if (maxFret === null || !Number.isFinite(maxFret)) return;
    this.maxFret = maxFret;
    this.refusalControl = 'maxFret';
    this.settingsChanged.emit({ maxFret });
  }

  onTimeSignatureChange(presetId: string): void {
    this.timeSignatureId = presetId;
    this.refusalControl = 'timeSignature';
    const preset = this.timeSignatureOptions.find(option => option.id === presetId);
    if (preset) this.timeSignatureChanged.emit({ ...preset.value });
  }

  /**
   * States a tempo, or says why this one will not be applied.
   *
   * `withTempo` refuses an out-of-range tempo rather than clamping it, and the
   * refusal is silent: the grid comes back by identity, and the state that
   * arrives is indistinguishable from one where nothing was asked for.
   * Emitting anyway would leave the input showing a tempo the score was not
   * derived at with nothing on screen to say so, so the bound is checked before
   * the emit and the reason written next to the control.
   */
  onTempoChange(bpm: number | null): void {
    this.tempoBpm = bpm;

    if (bpm === null || !(bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM)) {
      this.tempoNote = `Tempo has to be between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM} BPM.`;
      return;
    }

    this.tempoNote = null;
    this.tempoChanged.emit(bpm);
  }

  /**
   * States one suppression threshold, or says why this value will not be used.
   *
   * The guard is the whole of the difference from the eight knobs above.
   * `updateHarmonics` merges whatever it is handed straight onto the session
   * and the pass compares against it unchecked, so a NaN loses every
   * comparison it is in and suppresses *nothing* - a threshold that silently
   * turns the entire stage off, with no error and no refusal anywhere. An
   * empty number input produces exactly that, and three of the four controls
   * are number inputs. So the bound is checked before the emit and the reason
   * written next to the control, on the same argument `onTempoChange` makes.
   *
   * **The mirror moves either way**, which is the whole of why the refusal is
   * survivable. The obvious reading is that a mirror should hold only values
   * the score was derived with, and it costs the control its snap-back: the
   * mirror would still read 0.03 while the box read blank, the next state to
   * arrive would set it to 0.03 again, `NgModel` would compare 0.03 against
   * 0.03, conclude nothing changed and never call `writeValue` - leaving an
   * empty control, a message that `ngOnChanges` has just cleared, and a score
   * derived at a threshold nothing on screen states. That is exactly the
   * failure `snapRefusedControlsBack` exists to prevent, arrived at by another
   * route. Writing the refused value in is what makes the bound value differ
   * from the arriving one, so the accessor writes it back. What is *not* moved
   * is the score: nothing is emitted, so the derivation stands at the last
   * threshold that was a number.
   *
   * No range check beyond "is a number". A ratio of 0 suppresses nothing and a
   * high one suppresses nearly everything, and both are legitimate things to
   * ask for while judging where the cut belongs - the score comes back and says
   * what they did. Where a range is stated it is the *control's* and not this
   * method's: the measured ratio is a slider stopping at 2, chosen because the
   * two distributions it cuts between overlap from 0.49 to 1.33 and the answer
   * has stopped changing well before twice that; the other three are number
   * inputs whose `min`/`max` is decoration a typed or pasted value walks past,
   * exactly as on the fret controls. This method pre-empts neither.
   */
  onHarmonicChange(field: keyof HarmonicOptions, value: number | null): void {
    // Before the guard, not after it. See the docblock: a mirror that held only
    // good values would leave a refused control blank and unrecoverable.
    this.harmonics = { ...this.harmonics, [field]: value };

    if (value === null || !Number.isFinite(value)) {
      this.harmonicNotes = { ...this.harmonicNotes, [field]: HARMONIC_REFUSALS[field] };

      return;
    }

    this.harmonicNotes = { ...this.harmonicNotes, [field]: undefined };
    this.harmonicsChanged.emit({ [field]: value });
  }

  /** The list's own restore control, which is `onNoteClicked` by another route. */
  onRestoreClicked(id: string): void {
    this.pendingToggleId = id;
    this.noteToggled.emit(id);
  }

  /** Buttons that would do nothing are disabled, so this only ever moves the bar. */
  onNudgeDownbeat(beats: number): void {
    this.downbeatNudged.emit(beats);
  }

  /**
   * Rewrites the two refusable selects from the state, when a change was
   * refused.
   *
   * The mirror fields on their own are not enough, and the reason is an
   * ordering the panel's own spec could not see. `TranscriptionService` is
   * synchronous: the emit, the refusal and the replacement state all happen
   * inside the `change` handler, before Angular checks a single binding. So
   * `finestDivision` is set to 4 optimistically and back to 16 by `ngOnChanges`
   * within one cycle, `NgModel` compares the bound value against the one it
   * last saw - 16, both times - concludes nothing changed, and never writes to
   * the view. The select goes on showing "Quarter note" beside a score written
   * in sixteenths, which is precisely the state the mirror fields exist to
   * prevent.
   *
   * A spec that pushes the refusal in a later change-detection cycle than the
   * one the control moved in inserts the missing comparison and passes. Found
   * in the browser, on the real wiring, driving `/transcribe`.
   *
   * `FormControl.setValue` writes through the value accessor unconditionally,
   * which is the whole point of reaching for it here. Both flags matter:
   * `emitViewToModelChange: false` stops it firing `ngModelChange` and looping
   * the refused change straight back out of the component, and `emitEvent:
   * false` keeps it off `valueChanges`.
   *
   * Only on a refusal, because that is the only way the two can disagree. Every
   * other control emits a change the service applies, so the state that comes
   * back already carries it.
   */
  private snapRefusedControlsBack(): void {
    const options = { emitViewToModelChange: false, emitEvent: false };

    this.divisionModel?.control.setValue(this.finestDivision, options);
    this.meterModel?.control.setValue(this.timeSignatureId, options);
    this.capoModel?.control.setValue(this.capo, options);
    this.maxFretModel?.control.setValue(this.maxFret, options);
    this.positionModel?.control.setValue(this.positionHint, options);
  }

  // -------------------------------------------------------------------------
  // Template helpers
  // -------------------------------------------------------------------------

  /**
   * The refusal, if it belongs beside `control`.
   *
   * `rederive` refuses on `barGridFault` - `finestDivision` and the meter - or
   * on `fretboardFault` - capo, max fret and position hint. A session sitting
   * in `ready` already derived cleanly once, so whichever of those five moved
   * last is the one that caused the refusal; tempo and downbeat touch neither
   * check and the tuning select cannot fail either. Tempo has a note of its own
   * because the service refuses a tempo *silently*.
   */
  refusalFor(control: RefusableControl): string | null {
    if (this.refusalControl !== control) return null;
    return this.state?.refusal ?? null;
  }

  trackByPreset(_index: number, preset: { id: string }): string {
    return preset.id;
  }

  trackByDivision(_index: number, division: { value: FinestDivision }): number {
    return division.value;
  }

  trackByDiscard(_index: number, group: DiscardGroup): string {
    return group.reason;
  }

  /** By detection id, so restoring one row does not re-key the rest. */
  trackByRow(_index: number, row: DiscardRow): string {
    return row.id;
  }

  // -------------------------------------------------------------------------
  // Preview rendering
  // -------------------------------------------------------------------------

  /**
   * Draws the pending document, and only then lets its index answer clicks.
   *
   * The promotion is the point, and it is placed after `renderScore` rather
   * than beside `previewDoc` because two of the exits below draw nothing and
   * leave the previous score on the page: see `noteIndex`.
   */
  private renderPreview(): void {
    const element = this.previewContainer?.nativeElement;
    if (!element || !this.alphaTabService.getApi()) return;

    const doc = this.previewDoc;
    if (!doc || doc.masterBars.length === 0) {
      // Nothing will be drawn and nothing will replace what is on screen, which
      // came from a derivation that has been superseded. Neither index
      // describes something a click should act on, so clicks get no answer.
      this.noteIndex = EMPTY_INDEX;
      this.renderPending = false;
      return;
    }

    // alphaTab logs "skipped rendering because of width=0" and never retries,
    // which is what the observer below is for. The pane starts hidden until
    // there is a score, so this is an ordinary path rather than a corner of one.
    // `noteIndex` stays where it is: the pixels have not moved either.
    if (element.clientWidth === 0) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;

    try {
      const score = this.mapper.toScore(doc, new alphaTab.Settings());
      this.alphaTabService.renderScore(
        score,
        score.tracks.map((_, index) => index)
      );
      // Only here, and only after the draw was asked for. A throw above leaves
      // the previous score drawn under an error message, and the index that
      // describes it is the previous one.
      this.noteIndex = this.pendingIndex;
      this.renderError = null;
    } catch (error) {
      this.renderError = `Could not draw the preview: ${messageOf(error)}`;
    }
    this.cdr.markForCheck();
  }

  private observeContainerWidth(): void {
    const element = this.previewContainer?.nativeElement;
    if (!element || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;

      if (this.renderPending) this.renderPreview();
      else if (width !== this.lastRenderedWidth) this.alphaTabService.render();

      this.lastRenderedWidth = width;
    });
    this.resizeObserver.observe(element);
  }
}
