import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { TimeSignature } from '../../models/composer.model';
import { DerivationSettings } from '../../models/transcription.model';
import { ComposerService } from '../../services/composer.service';
import { messageOf } from '../../services/error-message';
import { NoteDetector } from '../../services/note-detector';
import { HarmonicOptions } from '../../services/transcription-harmonics';
import {
  NOTE_DETECTOR,
  TranscriptionPhase,
  TranscriptionService,
  TranscriptionState
} from '../../services/transcription.service';
import { AudioDropzoneComponent } from './components/audio-dropzone/audio-dropzone.component';
import { TranscriptionReviewComponent } from './components/transcription-review/transcription-review.component';

/**
 * The `/transcribe` route: a file goes in one end, a score comes out the other.
 *
 * Three things live here and nowhere else - the `TranscriptionService`, the
 * decision about which of the two child components is on screen, and the hop
 * into the composer. Everything below is either pure (`deriveScore`,
 * `buildPreviewDoc`) or state-free by construction: `TranscriptionReviewComponent`
 * takes a plain state object and emits, `AudioDropzoneComponent` emits a `File`.
 * This is the only place the two halves are joined.
 *
 * ## Open in Composer sends `derived.doc`
 *
 * Not the preview. The preview document carries the discarded detections in
 * voice 2 and exists only to be looked at; `derived.doc` is what M1 promised
 * exports, and its voice 1 is the same object the preview shares by identity.
 * Sending the preview would silently export the notes the pipeline decided
 * against, which is the one thing the ghost display must not cause.
 *
 * Handed over without a clone. `ComposerService.replaceDocument` takes the
 * document as the new state and every mutation after that goes through
 * `commit`, which `structuredClone`s before it touches anything - so the
 * composer cannot write back into the transcription's document. The other
 * direction is safe because `deriveScore` builds a fresh document on every
 * re-derivation rather than editing the one it last returned.
 *
 * ## One polite region, and only two things go in it
 *
 * A completion and a refusal. Not the phases: "Decoding... Detecting...
 * Deriving..." is interstitial churn, and a screen reader reading three of them
 * across a fifteen-second inference says nothing the progress bar does not -
 * which is `role="progressbar"` precisely so it is polled rather than
 * announced.
 *
 * **Nor a failure.** The template renders it in a `role="alert"` region, which
 * is assertive and announces itself; putting the same string in the polite
 * region in the same pass had a screen reader read one failure twice. Of the
 * two, the alert region is the one to keep - a run that produced nothing is
 * exactly the case for interrupting - so this one stays quiet and says so
 * below. The two halves of that bug shipped together and the spec named for it
 * checked the paragraph and the dropzone without ever reading the region.
 *
 * Nor the *successful* settings changes, which arrive as a new `ready` state on
 * every knob turn. The score visibly re-renders; announcing each one would put
 * the churn back under a different name. That is why a completion is announced
 * on the *transition* into `ready` from a working phase rather than whenever a
 * `ready` state is seen.
 *
 * **The dropzone's own refusals are not repeated here.** It owns a polite region
 * for the file types it turns away before `TranscriptionService` sees them, so
 * they are not in this state and there is nothing here to read. Two regions
 * describing the same drop would interleave unpredictably; the split is that
 * this one announces what the *service* reported and the dropzone announces what
 * it rejected on the doorstep.
 *
 * The region is emptied whenever a change is applied, so that repeating a
 * refusal - 6/8, then 4/4, then 6/8 again - is a change of text content and
 * therefore actually announced. Leaving the previous refusal standing would
 * make the second one silent.
 *
 * ## Terminating the detector
 *
 * `TranscriptionService` deliberately does not own the worker: the detector is
 * injected, may be shared, and `NoteDetector` has no teardown in its contract.
 * The documented arrangement is that a component wanting inference cancelled on
 * destroy injects `NOTE_DETECTOR` itself and terminates it, which is what
 * `ngOnDestroy` does - structurally, because the token's contract is
 * `NoteDetector` and a spec's stub has no `terminate` to call.
 *
 * Termination is "cancel and release" rather than a one-way door: the next
 * `detect` starts a fresh worker. It does pay for the model download and the
 * shader compiles again, which is why it happens on leaving the route rather
 * than after every run.
 *
 * The service itself is the root instance rather than a component-scoped one,
 * so a finished transcription survives the trip to the composer and back. The
 * worker is the expensive thing to hold open; the session is three arrays.
 *
 * ## Transcribing a second file
 *
 * That same root scope is why *Transcribe another file* has to exist. The
 * dropzone is on screen when there is no session, and after one success there
 * is a session for the life of the tab - leaving `/transcribe` and returning
 * replays it. `transcribeAnother` calls `TranscriptionService.reset`, which
 * clears the state and deliberately does not touch the detector, so the second
 * run reuses the worker rather than paying for the model download again.
 */

/** A detector that can be told to stop, which `NoteDetector` does not require. */
interface TerminableDetector {
  terminate(): void;
}

/** The phases a run passes through on its way to a terminal one. */
const WORKING_PHASES: readonly TranscriptionPhase[] = ['decoding', 'detecting', 'deriving'];

/** What the progress bar is labelled while each working phase runs. */
const PHASE_LABELS: Readonly<Record<TranscriptionPhase, string>> = {
  idle: '',
  decoding: 'Decoding the audio',
  detecting: 'Detecting notes',
  deriving: 'Deriving the score',
  ready: '',
  failed: ''
};

/**
 * Whether `detector` can be terminated.
 *
 * Structural rather than `instanceof WorkerDetector`: the token is bound to
 * whatever `main.ts` says, a spec binds a stub with nothing but `detect`, and a
 * server-side detector would have no worker to stop. All three are legitimate
 * `NoteDetector`s, so the question is what this one can do rather than what
 * class it is.
 */
export function canTerminate(
  detector: NoteDetector
): detector is NoteDetector & TerminableDetector {
  return typeof (detector as Partial<TerminableDetector>).terminate === 'function';
}

@Component({
  selector: 'app-transcription',
  standalone: true,
  imports: [CommonModule, AudioDropzoneComponent, TranscriptionReviewComponent],
  templateUrl: './transcription.component.html',
  styleUrls: ['./transcription.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TranscriptionComponent implements OnInit, OnDestroy {
  private readonly transcription = inject(TranscriptionService);
  private readonly composer = inject(ComposerService);
  private readonly router = inject(Router);
  private readonly detector = inject(NOTE_DETECTOR);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();

  state: TranscriptionState | null = null;

  /** The dropzone until a run starts, the progress bar while it runs. */
  showDropzone = true;
  showProgress = false;
  showReview = false;
  canOpenInComposer = false;

  /** Named phase and 0-100 within it, for the progress bar. */
  phaseLabel = '';
  progressPercent = 0;

  /** What the one polite region currently says; empty when it says nothing. */
  announcement = '';

  /**
   * Set when a file arrives while a run is already going.
   *
   * The dropzone is not on screen then, so this is belt and braces rather than
   * an expected path - but `transcribe` *rejects* a concurrent call rather than
   * reporting it as state, and an unhandled rejection is a worse outcome than a
   * line of text.
   */
  busyNote: string | null = null;

  ngOnInit(): void {
    this.transcription
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.applyState(state);
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (canTerminate(this.detector)) this.detector.terminate();
  }

  // -------------------------------------------------------------------------
  // The pipeline
  // -------------------------------------------------------------------------

  onFileSelected(file: File): void {
    if (this.transcription.busy) {
      this.busyNote =
        `Still transcribing. Wait for that to finish before starting "${file.name}".`;

      return;
    }

    this.busyNote = null;
    // Pipeline failures are reported as state, so the only rejection left is
    // the concurrent one guarded above. Caught anyway: a promise nobody handles
    // becomes a console warning rather than a message on screen.
    void this.transcription.transcribe(file).catch((error: unknown) => {
      this.busyNote = messageOf(error);
      this.cdr.markForCheck();
    });
  }

  onSettingsChanged(settings: Partial<DerivationSettings>): void {
    this.transcription.updateSettings(settings);
  }

  onTimeSignatureChanged(timeSignature: TimeSignature): void {
    this.transcription.updateTimeSignature(timeSignature);
  }

  onTempoChanged(bpm: number): void {
    this.transcription.updateTempo(bpm);
  }

  onDownbeatNudged(beats: number): void {
    this.transcription.nudgeDownbeat(beats);
  }

  /**
   * Reverses the suppression verdict on one detection.
   *
   * The review panel resolves a click on a notehead to a `DetectedNote.id` and
   * emits it; which way the verdict moves is `toggleNote`'s to decide, since
   * the kept set and the override lists are the service's. An id the session
   * does not carry is ignored there, silently and without a push - which is
   * why nothing is checked here.
   *
   * Synchronous, like every other knob: `toggleNote` pushes a new state before
   * this returns, the subscription in `ngOnInit` marks this component, and the
   * new state reaches the panel as a changed `@Input` in the change-detection
   * pass Angular runs after the handler. The click arrives inside the Angular
   * zone - `AlphaTabService.onNoteMouseDown` wraps its handler in
   * `ngZone.run` - so that pass actually happens.
   */
  onNoteToggled(id: string): void {
    this.transcription.toggleNote(id);
  }

  /**
   * Moves a harmonic-suppression threshold.
   *
   * Its own method rather than a branch of `onSettingsChanged`, because the two
   * are different contracts: `DerivationSettings` is what `deriveScore`
   * consumes and these four run a step before it, deciding which detections are
   * notes at all. `updateHarmonics` re-runs that pass over `session.rawNotes`
   * and may rebuild the beat grid with it - the one knob on this screen that
   * does.
   */
  onHarmonicsChanged(partial: Partial<HarmonicOptions>): void {
    this.transcription.updateHarmonics(partial);
  }

  /**
   * Clears the finished transcription, bringing the dropzone back.
   *
   * The way out of the review screen, and the reason `showDropzone` is a
   * function of the state rather than a latch: `session` is non-null from the
   * first success onwards, so without this the primary flow works exactly once
   * per page load. `TranscriptionService.reset` leaves the detector alone, so
   * the second file reuses the worker that the first one paid to start.
   */
  transcribeAnother(): void {
    this.transcription.reset();
  }

  /**
   * Hands the clean document to the composer and goes there.
   *
   * `replaceDocument` is already wrapped by the composer's undo stack, so
   * arriving with a transcription and pressing undo gives back whatever was
   * open before - which is the reason this is a document replacement rather
   * than a new score.
   */
  openInComposer(): void {
    const doc = this.state?.derived?.doc;
    if (!doc) return;

    this.composer.replaceDocument(doc);
    void this.router.navigate(['/composer']);
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  private applyState(state: TranscriptionState): void {
    const previousPhase = this.state?.phase ?? 'idle';
    this.state = state;

    const working = WORKING_PHASES.includes(state.phase);
    this.showProgress = working;
    this.showReview = state.session !== null;
    this.showDropzone = state.session === null && !working;
    this.canOpenInComposer = state.derived !== null;

    this.phaseLabel = PHASE_LABELS[state.phase];
    this.progressPercent = Math.round(
      100 * Math.min(1, Math.max(0, Number.isFinite(state.progress) ? state.progress : 0))
    );

    if (working) this.busyNote = null;
    this.announcement = this.announcementFor(state, previousPhase);
  }

  /**
   * What the polite region should say about `state`, having last seen
   * `previousPhase`.
   *
   * Empty is the common answer, deliberately: a settings change that was
   * applied says nothing, because the score redrawing is the feedback and it
   * does not need narrating nine different ways.
   *
   * A failure is empty too, and that is the point rather than an omission: the
   * template already renders it in a `role="alert"` region. Announcing it here
   * as well put the same sentence through a screen reader twice in one pass.
   */
  private announcementFor(
    state: TranscriptionState,
    previousPhase: TranscriptionPhase
  ): string {
    // Said by the alert region, which interrupts - the right treatment for a
    // run that produced nothing, and the reason this one stays quiet.
    if (state.phase === 'failed') return '';

    if (state.phase === 'ready' && WORKING_PHASES.includes(previousPhase)) {
      return this.completionMessage(state);
    }

    return state.refusal ?? '';
  }

  private completionMessage(state: TranscriptionState): string {
    const name = state.session?.sourceName ?? 'the audio';
    const bars = state.derived?.doc.masterBars.length ?? 0;
    const discarded = (state.derived?.dropped.length ?? 0) + state.suppressed.length;

    const headline = `Transcribed ${name}: ${bars} ${bars === 1 ? 'bar' : 'bars'}.`;
    if (discarded === 0) return `${headline} Nothing was discarded.`;

    return `${headline} ${discarded} ${
      discarded === 1 ? 'detection is' : 'detections are'
    } drawn as ghosts rather than notes.`;
  }
}
