/**
 * Runs an audio file through the transcription pipeline and owns the result.
 *
 * Every other module in the feature is a pure function or a thin adapter; this
 * is the only stateful one, and the only one that knows the order the steps run
 * in: decode, detect, suppress harmonics, track beats, assemble a
 * `TranscriptionSession`, derive a score. State lives behind a `BehaviorSubject`
 * per the project's service convention, so a component subscribing at any point
 * - including after a run has finished - immediately sees where things stand.
 *
 * ## Two things about the order that are not arbitrary
 *
 * **Beat tracking runs on the suppressed notes, not the raw ones.** Harmonic
 * partials carry onsets of their own - twenty-six of them in the thirty-four
 * notes the detector returned for an eight-note fixture - and an onset-driven
 * beat tracker fed those follows the artefacts rather than the rhythm. The
 * suppression pass is not a cosmetic filter applied to the output; it is a
 * precondition of the step after it.
 *
 * **Detection and derivation are separated by the session.** `deriveScore` is
 * pure and fast, so `updateSettings` re-derives from `session.notes` - plain
 * objects, kept for exactly this - without touching the detector. That is M1's
 * two-layer model paying off: changing tuning, capo, grid or confidence floor
 * costs a millisecond, not a re-run of a model.
 *
 * ## Buffer ownership
 *
 * Two steps take their input away rather than borrowing it. `decodeToMono`
 * detaches the `ArrayBuffer` it is given, because decoding transfers it, and
 * `WorkerDetector.detect` detaches the `Float32Array`'s buffer when it posts
 * the samples to the worker. Neither is a bug and both are documented at their
 * source, but it means nothing here may read either buffer afterwards. Nothing
 * does: the file is read fresh on every call, and every fact the pipeline needs
 * from the audio - its duration - is taken off the decode result, which is a
 * number. `updateSettings` needs neither buffer for the same reason.
 *
 * ## What the phases mean
 *
 * `progress` is 0-1 *within the current phase*, not across the run: the three
 * working phases have wildly different and unknowable relative costs, and a
 * single bar that jumps would be a worse lie than three that do not. `ready`
 * and `failed` are terminal, and a run always ends in one of them - a pipeline
 * failure is reported as state rather than as a rejected promise, because the
 * subscriber showing the spinner is the thing that has to hear about it. The
 * two terminal phases carry a fixed progress: 1 for `ready`, 0 for `failed`,
 * which has none to report.
 *
 * `busy` goes false *before* the terminal state is pushed, so a subscriber that
 * reacts to `ready` or `failed` by starting the next transcription is not told
 * one is already running. `WorkerDetector.settle` takes the same care for the
 * same reason.
 *
 * The one exception is a *concurrent* call, which rejects. See `transcribe`.
 *
 * ## Lifecycle
 *
 * This service does not own the detector's worker and does not terminate it:
 * the detector is injected, may be shared, and `NoteDetector` has no teardown
 * in its contract. A component that wants inference cancelled on destroy
 * injects `NOTE_DETECTOR` itself and calls `WorkerDetector.terminate`. Nothing
 * here subscribes to anything, so there is nothing else to unsubscribe from.
 */

import { InjectionToken, Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { TimeSignature } from '../models/composer.model';
import {
  DerivationSettings,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { TARGET_SAMPLE_RATE, decodeToMono } from './audio-decode';
import { trackBeats } from './beat-tracking';
import { NoteDetector } from './note-detector';
import { DerivedScore, deriveScore } from './score-derivation';
import { suppressHarmonics } from './transcription-harmonics';

export type TranscriptionPhase =
  | 'idle'
  | 'decoding'
  | 'detecting'
  | 'deriving'
  | 'ready'
  | 'failed';

export interface TranscriptionState {
  phase: TranscriptionPhase;
  /** 0-1 within the current phase. */
  progress: number;
  session: TranscriptionSession | null;
  derived: DerivedScore | null;
  error: string | null;
}

/**
 * The detector `TranscriptionService` runs.
 *
 * A token rather than a class dependency because `NoteDetector` is an
 * interface, which erases: there is no runtime symbol to inject. It is also
 * what lets the spec supply a stub that needs no worker and no model, and what
 * would let a server-side detector be swapped in without touching this file.
 *
 * Bound to `WorkerDetector` in `main.ts`, deliberately with no default factory
 * here - a service that silently fell back to a real worker in a test would be
 * a slow, confusing surprise rather than a convenience.
 */
export const NOTE_DETECTOR = new InjectionToken<NoteDetector>('NoteDetector');

/** 4/4, the meter a caller gets if it does not state one. */
export const DEFAULT_TIME_SIGNATURE: TimeSignature = {
  numerator: 4,
  denominator: 4,
  isCommon: true
};

const IDLE_STATE: TranscriptionState = {
  phase: 'idle',
  progress: 0,
  session: null,
  derived: null,
  error: null
};

@Injectable({ providedIn: 'root' })
export class TranscriptionService {
  private readonly detector = inject(NOTE_DETECTOR);
  private readonly stateSubject = new BehaviorSubject<TranscriptionState>(IDLE_STATE);

  /** Name of the file being transcribed, or null when nothing is running. */
  private inFlight: string | null = null;

  getState(): Observable<TranscriptionState> {
    return this.stateSubject.asObservable();
  }

  get state(): TranscriptionState {
    return this.stateSubject.getValue();
  }

  /** True while a transcription is running, so a caller need never provoke the refusal below. */
  get busy(): boolean {
    return this.inFlight !== null;
  }

  /**
   * Transcribes `file`, pushing state as it goes and ending in `ready` or
   * `failed`.
   *
   * Resolves either way. A file that will not decode, a detector that will not
   * load its model, a derivation that throws - all of them land in `failed`
   * with a message, because the caller that needs to know is the one rendering
   * the state, and a component that must both subscribe *and* catch would end
   * up displaying the same failure twice or not at all.
   *
   * **Rejects in exactly one case: a second call while one is running.** That
   * is not a transcription outcome, it is a caller mistake, and it has nowhere
   * to go in the state without destroying the state of the run still going.
   * Refusing also matches `WorkerDetector`, which rejects concurrent
   * detections for its own reason: one worker cannot interleave two inferences.
   * Queueing was rejected because the state stream would then describe a run
   * whose beginning the caller never saw, and cancelling because tearing down
   * the worker throws away the model download and the shader compiles that make
   * the *first* detection the expensive one. Which of two files the user meant
   * is a question for the UI; `busy` is there so it can ask without provoking
   * this.
   *
   * Starting a run clears whatever the last one produced. The state describes
   * one transcription at a time, so a failure cannot leave a stale score behind
   * it looking like a current one.
   *
   * `timeSignature` is the caller's: M2 tracks where the beats fall but does
   * not infer meter, and bar 1 starts at the first tracked beat. It can be
   * changed afterwards with `updateTimeSignature` for the cost of a
   * re-derivation.
   */
  async transcribe(
    file: File,
    timeSignature: TimeSignature = DEFAULT_TIME_SIGNATURE
  ): Promise<void> {
    if (this.inFlight !== null) {
      throw new Error(
        `Already transcribing "${this.inFlight}"; wait for it to finish before starting ` +
          `"${file.name}".`
      );
    }

    this.inFlight = file.name;
    this.push({ ...IDLE_STATE, phase: 'decoding' });

    // Built rather than pushed inside the try, so that `finally` can release
    // the run before a subscriber sees it end. A handler that starts the next
    // transcription on hearing `ready` would otherwise be refused by a run that
    // has already finished.
    let terminal: TranscriptionState;

    try {
      const decoded = await decodeToMono(await file.arrayBuffer());
      this.push({ ...IDLE_STATE, phase: 'decoding', progress: 1 });

      this.push({ ...IDLE_STATE, phase: 'detecting' });
      // `decoded.audio` is given away here, not lent: the worker detector
      // transfers its buffer. Everything needed from the audio afterwards has
      // already been read into `decoded.durationSec`.
      const detection = await this.detector.detect(
        decoded.audio,
        TARGET_SAMPLE_RATE,
        fraction => this.reportDetectionProgress(fraction)
      );

      this.push({ ...IDLE_STATE, phase: 'deriving' });
      const notes = suppressHarmonics(detection.notes);
      const session: TranscriptionSession = {
        id: nextSessionId(),
        sourceName: file.name,
        durationSec: decoded.durationSec,
        notes,
        // The suppressed notes, not `detection.notes`. See the module docblock.
        grid: trackBeats(notes, decoded.durationSec, timeSignature),
        settings: createDefaultDerivationSettings()
      };

      terminal = {
        phase: 'ready',
        progress: 1,
        session,
        derived: deriveScore(session),
        error: null
      };
    } catch (error) {
      terminal = {
        ...IDLE_STATE,
        phase: 'failed',
        error: `Could not transcribe "${file.name}": ${messageOf(error)}`
      };
    } finally {
      this.inFlight = null;
    }

    this.push(terminal);
  }

  /**
   * Re-derives the score from the session already in hand.
   *
   * Synchronous, and the reason the raw events are kept: no decode, no
   * detection, no beat tracking - just `deriveScore` over the same
   * `session.notes`, which are plain objects untouched by either of the
   * pipeline's buffer transfers. Milliseconds, so every setting can be a live
   * knob rather than a form with an Apply button.
   *
   * A no-op unless a transcription has succeeded: there is nothing to re-derive
   * before the first run, during one, or after a failure, and the alternative -
   * throwing at a UI whose slider the user has just dragged - would be worse
   * than doing nothing.
   *
   * Meter is not here because meter is not a `DerivationSettings` field; it
   * lives on the beat grid. `updateTimeSignature` changes it, at the same cost.
   */
  updateSettings(partial: Partial<DerivationSettings>): void {
    this.rederive(session => ({
      ...session,
      settings: {
        ...session.settings,
        ...partial,
        // Copied, so a caller that keeps and later mutates the array it passed
        // cannot reach into the state through it. `createDefaultDerivationSettings`
        // copies the tuning for the same reason.
        tuning: [...(partial.tuning ?? session.settings.tuning)]
      }
    }));
  }

  /**
   * Re-bars the score in a different meter, from the beats already tracked.
   *
   * The beat positions do not move: `trackBeats` uses the time signature only
   * to stamp it onto the grid it returns, so a corrected meter is a
   * re-derivation and not a re-tracking. `deriveScore` reads bar 1 as starting
   * at `beatsSec[0]` and every bar after it as another `numerator` beats, so
   * this is the whole of what changing meter means.
   *
   * A no-op unless a transcription has succeeded, for the same reason as
   * `updateSettings`.
   */
  updateTimeSignature(timeSignature: TimeSignature): void {
    this.rederive(session => ({
      ...session,
      grid: { ...session.grid, timeSignature }
    }));
  }

  /**
   * Applies `change` to the current session and pushes the score it derives.
   *
   * `deriveScore` is deliberately not wrapped: it throws only on a note whose
   * onset is not a finite time, and a session sitting in `ready` derived
   * successfully once already, so a throw here is a bug worth surfacing rather
   * than a user-facing failure. Catching it would replace a working score with
   * a `failed` state the user could not undo.
   */
  private rederive(
    change: (session: TranscriptionSession) => TranscriptionSession
  ): void {
    const current = this.state;
    if (current.phase !== 'ready' || current.session === null) return;

    const session = change(current.session);

    this.push({
      phase: 'ready',
      progress: 1,
      session,
      derived: deriveScore(session),
      error: null
    });
  }

  /**
   * Records how far detection has got.
   *
   * Guarded on both sides, because the fraction comes from outside: a detector
   * is free to report NaN, a number outside 0-1, the same value twice, or one
   * that arrives after the run it belongs to has already ended - the last of
   * those being ordinary for a worker whose messages are still in flight. None
   * of that may be allowed to break the state's own guarantees, so progress is
   * clamped, never runs backwards inside a phase, and is dropped outright
   * unless detection is what is currently happening.
   */
  private reportDetectionProgress(fraction: number): void {
    const current = this.state;
    if (current.phase !== 'detecting') return;

    const progress = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    if (progress <= current.progress) return;

    this.push({ ...current, progress });
  }

  private push(state: TranscriptionState): void {
    this.stateSubject.next(state);
  }
}

/** Matches the id shape `ComposerService` and `ComposerLibraryService` use. */
function nextSessionId(): string {
  return `txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
