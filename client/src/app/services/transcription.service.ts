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
 * partials carry onsets of their own - ten of the twenty-eight notes the
 * detector returns for the twelve-note `walking` fixture - and an onset-driven
 * beat tracker fed those follows the artefacts rather than the rhythm. The
 * suppression pass is not a cosmetic filter applied to the output; it is a
 * precondition of the step after it. It is not, however, allowed to destroy
 * anything: the raw list stays on the session and the partials it removed go
 * on the state, because deciding a note is an artefact is interpretation and
 * interpretation has to be reversible.
 *
 * That dependency is why moving suppression into `rederive` had to bring beat
 * tracking with it. A threshold change is a different tracker input, so the
 * grid is rebuilt - except where the user has already corrected it by hand,
 * which outranks anything the tracker would infer. `rederive` argues that rule
 * out.
 *
 * **Detection and derivation are separated by the session.** `deriveScore` is
 * pure and fast, so `updateSettings` re-derives from `session.notes` - plain
 * objects, kept for exactly this - without touching the detector. That is M1's
 * two-layer model paying off: changing tuning, capo, grid or confidence floor
 * costs a millisecond, not a re-run of a model. `updateHarmonics` reaches one
 * step further back, to `session.rawNotes`, and still never asks the detector
 * anything: suppression is a pure function of that list and four thresholds.
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
 *
 * ## Past CLAUDE.md's 500-line ceiling, deliberately
 *
 * Roughly 260 of these lines are code and the rest is prose. The rule exists so
 * that a file stays small enough to hold in the head, and splitting this one to
 * satisfy the count would work against that: what is here is a single state
 * machine over one `BehaviorSubject`, and every public method is one call into
 * `rederive`. The candidates for extraction are the state type and the
 * injection token, which would leave two files that have to be read together,
 * or the docblocks, which are the part worth keeping next to the code.
 *
 * If the *code* grows past the ceiling the answer is different. Suppression
 * moving into the re-derive path was named here as the change that would do
 * it; it has now happened, and per-note overrides after it, and neither did -
 * the code went from roughly 190 lines to roughly 236 and then to 264, because
 * each pass is one call and the rules around them are `resuppressed` and
 * `toggledDecisions`, pure functions at the foot of the file that a reader can
 * take or leave. The file is much longer, and nearly all of the growth is the
 * argument for those rules. If the code does cross, the extraction is still
 * the one named: the pipeline assembly in `transcribe` becomes a module of its
 * own.
 */

import { InjectionToken, Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { TimeSignature } from '../models/composer.model';
import {
  DerivationSettings,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { decodeToMono } from './audio-decode';
import {
  atMetricalLevel,
  canApplyMetricalLevel,
  nudgedDownbeat,
  withTempo
} from './beat-grid-edit';
import { messageOf } from './error-message';
import { trackBeats } from './beat-tracking';
import { DETECTION_SAMPLE_RATE, NoteDetector } from './note-detector';
import { fretboardFault } from './transcription-fingering';
import { DerivedScore, deriveScore } from './score-derivation';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HarmonicOptions,
  NO_NOTE_DECISIONS,
  NoteDecisions,
  suppressHarmonics
} from './transcription-harmonics';
import { barGridFault } from './transcription-quantize';

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
  /**
   * The partials harmonic suppression removed, earliest first.
   *
   * Alongside `derived.dropped` rather than inside it: those are notes
   * *derivation* turned away, and M3 renders both greyed for the same reason -
   * a note the pipeline decided against is worth showing as a decision rather
   * than as an absence. On real material it is a third of the detection: ten
   * of the twenty-eight notes on the `walking` fixture, and 101 of 310 across
   * the sixteen accuracy fixtures.
   *
   * It used to be described here as larger than what survived by an order of
   * magnitude - twenty-six of thirty-four. That was true of one fixture and of
   * one discriminator, and both are gone; see `transcription-harmonics.ts`.
   *
   * At state level rather than on the session because it is what the current
   * suppression pass concluded, not a fact about the audio - `session.rawNotes`
   * is that. It was fixed at detection time and is now a per-derivation answer:
   * `rederive` re-runs the pass whenever a threshold moves, and this is the
   * list that pass produced. The same array as long as the decisions hold, so a
   * change that leaves the kept set alone does not hand a subscriber a
   * new-but-equal list to re-render.
   *
   * Empty rather than null when there is nothing: a run with no partials and a
   * run that has not happened are both "nothing was suppressed", and the phase
   * already says which.
   */
  suppressed: DetectedNote[];
  error: string | null;
  /**
   * Why the last settings change was turned away, or null when it was applied.
   *
   * Separate from `error` because it is not one: the phase is still `ready`,
   * the score is still the one that was there before, and the only thing that
   * did not happen is the change. `error` means the run failed and there is
   * nothing to show; a UI that renders the two the same way would report a
   * working score as broken. Cleared by the next change that succeeds.
   *
   * See `rederive` for what can land here and why it is refused rather than
   * thrown.
   */
  refusal: string | null;
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
  suppressed: [],
  error: null,
  refusal: null
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
   *
   * A meter the default grid cannot write - a /32 or /64 bar against the
   * default sixteenth-note `finestDivision` - lands in `failed` before
   * anything is decoded. It would otherwise be found by `quantizeBar` at the
   * far end of a decode and an inference, and reported as though the file were
   * at fault rather than the meter.
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

    const settings = createDefaultDerivationSettings();

    // Checked here rather than left to `deriveScore`: same rule as `rederive`,
    // one phase earlier. A caller mistake in the meter is not a fact about the
    // audio, so it is worth saying so plainly and worth not spending an
    // inference to find out.
    const fault = barGridFault(timeSignature, settings.finestDivision);
    if (fault !== null) {
      this.push({
        ...IDLE_STATE,
        phase: 'failed',
        error: `Could not transcribe "${file.name}": ${fault}.`
      });

      return;
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
        DETECTION_SAMPLE_RATE,
        fraction => this.reportDetectionProgress(fraction)
      );

      this.push({ ...IDLE_STATE, phase: 'deriving' });

      // Nothing the detector reported is thrown away here: the partials go on
      // the state for M3 to render, and the whole raw list stays on the
      // session beside the thresholds this ran with, so `rederive` can re-run
      // suppression on different numbers without re-running the model.
      //
      // Copied rather than aliased to the exported default, which is a shared
      // const: `updateHarmonics` replaces the object rather than mutating it,
      // but a session holding the module's own default would be one careless
      // caller away from changing every session there will ever be.
      const harmonics: HarmonicOptions = { ...DEFAULT_HARMONIC_OPTIONS };
      const suppressed: DetectedNote[] = [];
      // `NO_NOTE_DECISIONS` shared rather than copied, unlike the thresholds
      // above: it is frozen, and every producer of a `NoteDecisions` builds a
      // new object rather than mutating one, so there is nothing for a
      // careless caller to reach through. Its identity is also how `rederive`
      // tells that a session has never overridden anything.
      const notes = suppressHarmonics(
        detection.notes,
        harmonics,
        NO_NOTE_DECISIONS,
        suppressed
      );

      // Tracked once, kept twice. `grid` is the working copy that `updateTempo`
      // and `nudgeDownbeat` replace; `trackedGrid` is what the tracker actually
      // measured, and it is the only copy of that - both corrections destroy
      // the per-beat measurements and neither can rebuild them.
      const tracked = trackBeats(notes, decoded.durationSec, timeSignature);

      const session: TranscriptionSession = {
        id: nextSessionId(),
        sourceName: file.name,
        durationSec: decoded.durationSec,
        notes,
        // Copied, not aliased: `suppressHarmonics` hands back an array of its
        // own and the two lists should not differ in whose they are.
        rawNotes: [...detection.notes],
        // Kept with the notes it describes. Every `bendCents` above is sampled
        // at this rate and is uninterpretable without it.
        bendFrameRateHz: detection.bendFrameRateHz,
        // The suppressed notes, not `detection.notes`. See the module docblock.
        grid: tracked,
        trackedGrid: tracked,
        // The tracked pulse is taken to be the beat until someone says
        // otherwise, which is what the tracker itself claims.
        //
        // `inferMetricalLevel` can say otherwise, and deliberately is not
        // called here: it *proposes* a level with the evidence behind it, and
        // that evidence separates the real case by only about 20 % - a
        // proposal that applied itself on arrival would be a silent answer
        // that is sometimes confidently wrong. It belongs beside the control
        // that shows it, where a listener can see the numbers and override it.
        beatsPerPulse: 1,
        harmonics,
        decisions: NO_NOTE_DECISIONS,
        settings
      };

      terminal = {
        phase: 'ready',
        progress: 1,
        session,
        derived: deriveScore(session),
        suppressed,
        error: null,
        refusal: null
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
   * Throws the finished transcription away and goes back to `idle`.
   *
   * The counterpart `transcribe` always implied and never had. Its docblock
   * says a run clears whatever the last one produced, which is true of the
   * *state* and not of the way out: `session` is non-null from the first
   * success onwards, and a UI that shows the dropzone only while it is null
   * therefore never shows it again. The service is `providedIn: 'root'`, so
   * leaving the route and coming back restores the same session rather than
   * clearing it. This is the door.
   *
   * **The detector is deliberately untouched.** Resetting is about the state,
   * not the worker: the model download and the shader compiles are what make
   * the first detection the expensive one, and throwing them away between two
   * files would make the second run pay for them again. Terminating is a
   * separate decision, taken by whoever injected `NOTE_DETECTOR` - see the
   * lifecycle note at the top of this file.
   *
   * A no-op while a run is in flight, because the run's terminal state would
   * land on top of the idle one a moment later and the user would be looking at
   * a score they had just cleared. `busy` is how a caller asks first. Also a
   * no-op when the state is already idle, so a control that is pressed twice
   * does not push a state that says nothing new.
   */
  reset(): void {
    if (this.inFlight !== null || this.state.phase === 'idle') return;

    this.push(IDLE_STATE);
  }

  /**
   * Re-derives the score from the session already in hand.
   *
   * Synchronous, and the reason the raw events are kept: no decode and no
   * detection, just `deriveScore` over `session.notes`, which are plain objects
   * untouched by either of the pipeline's buffer transfers. A change that moves
   * a suppression threshold does re-run suppression and may re-track the beat
   * as well - see `rederive` - and that costs about a millisecond on real
   * material against a tenth of one for `deriveScore` alone. Measured on the
   * largest accuracy fixture, 31 detections: 0.8 ms median and 1.5 ms worst
   * with a re-track, under 0.1 ms without one, where the re-track is nearly all
   * of it. So every setting here stays a live knob rather than a form with an
   * Apply button.
   *
   * A no-op unless a transcription has succeeded: there is nothing to re-derive
   * before the first run, during one, or after a failure, and the alternative -
   * throwing at a UI whose slider the user has just dragged - would be worse
   * than doing nothing.
   *
   * Settings that do not describe something writable are refused rather than
   * applied: the score stays as it was and `refusal` says why. Two families of
   * those - a `finestDivision` the current meter cannot be written on
   * (`barGridFault`) and a neck that cannot be played (`fretboardFault`, which
   * covers `capo`, `maxFret` and `positionHint`). The bound belongs here rather
   * than on the controls, for the reason `beat-grid-edit.ts` sets out at
   * length: a `min`/`max` on a number input is not this method's contract, it
   * is one caller's decoration, and a typed or pasted value walks past it. See
   * `rederive`.
   *
   * Meter is not here because meter is not a `DerivationSettings` field; it
   * lives on the beat grid. `updateTimeSignature` changes it, at the same cost.
   * Nor are the suppression thresholds, for the reason set out on
   * `TranscriptionSession.harmonics`; `updateHarmonics` changes those.
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
   * Moves a harmonic-suppression threshold and re-runs the pass on the raw
   * detection.
   *
   * The knob M2 had no way to offer. Suppression removes about three quarters
   * of what the detector reports - more than any other stage - and it ran
   * inside `transcribe` on hardcoded defaults, so a real note it destroyed
   * could only be recovered by re-uploading the file, which is deterministic
   * and gives the same answer. `session.rawNotes` was already kept for exactly
   * this; `session.harmonics` is the other half, and this is the door.
   *
   * Routed through `rederive` and not around it, so it inherits the whole
   * refusal contract: a no-op unless a transcription has succeeded, and a
   * combination that cannot be written turns the change away rather than
   * throwing out of the handler that moved the control.
   *
   * **May rebuild the beat grid**, which no other knob here does. Beat tracking
   * runs on the suppressed notes by design, so a different kept set is a
   * different tracker input; `rederive` re-tracks unless the user has already
   * corrected the beats by hand, in which case their correction stands. That
   * rule and why it is drawn where it is are set out on `rederive`.
   */
  updateHarmonics(partial: Partial<HarmonicOptions>): void {
    this.rederive(session => ({
      ...session,
      harmonics: { ...session.harmonics, ...partial }
    }));
  }

  /**
   * Overrules the suppressor on one note, or takes back an overruling.
   *
   * `updateHarmonics` moves the whole population and this moves one note, and
   * both are needed for the same reason: `partialConfidenceRatio` is a
   * calibration over 120 candidate pairs whose two distributions overlap from
   * 0.49 to 1.33, so the cut that recovers the real note the pass ate readmits
   * artefacts everywhere else. The note in front of the user is the one they
   * can actually judge.
   *
   * **Symmetric**, because the algorithm's two failure modes are. It destroys
   * three real notes across the sixteen accuracy fixtures and keeps sixty
   * artefacts, so a control that only restored would leave the larger half
   * unaddressable. A suppressed note becomes kept; a kept note becomes
   * suppressed.
   *
   * **Toggling twice returns the note to the algorithm's own answer**, rather
   * than pinning it in place with a second override. So an override taken by
   * mistake is undone by repeating the gesture, and a note is never held down
   * by a decision the user has forgotten making. That is why the two existing
   * overrides are tested before the current verdict is: a note in `keep` is
   * kept, so "a kept note becomes suppressed" would otherwise send it to
   * `drop` and leave it stuck one gesture away from the algorithm in either
   * direction.
   *
   * It is also what keeps an id out of both lists: this only ever adds to the
   * list the id is absent from, having found it absent from the other.
   *
   * **An id naming no detection is ignored**, and ignored *silently* - no
   * push, so not even a re-derivation of the identical score. Not a
   * hypothetical: a click is resolved against the session that was rendered,
   * and a second `transcribe` can replace that session while the click is in
   * flight. There is nothing to say about it and nobody to say it to.
   *
   * Checked here rather than inside the change function because `rederive`
   * has no notion of a change that turned out to be nothing: handed back an
   * unchanged session it would re-derive it and push a new state object,
   * telling every subscriber to re-render a score that did not move.
   *
   * Otherwise it is `updateHarmonics` in every respect - routed through
   * `rederive`, so it inherits the refusal contract, and it re-tracks the beat
   * grid on the same rule, since restoring or dropping a note changes what the
   * tracker sees exactly as moving a threshold does.
   */
  toggleNote(id: string): void {
    const current = this.state;
    if (current.phase !== 'ready' || current.session === null) return;
    if (!current.session.rawNotes.some(note => note.id === id)) return;

    this.rederive(session => ({ ...session, decisions: toggledDecisions(session, id) }));
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
   * `updateSettings`, and refused on the same terms: a meter whose beat the
   * current `finestDivision` is coarser than leaves the score alone and sets
   * `refusal`.
   */
  updateTimeSignature(timeSignature: TimeSignature): void {
    this.rederive(session => ({
      ...session,
      grid: { ...session.grid, timeSignature }
    }));
  }

  /**
   * Respaces the beat grid to a stated tempo, keeping bar 1 where it is.
   *
   * The tracker measures each beat rather than fitting one tempo, so a grid
   * that drifted, dropped a beat or locked onto a subdivision is corrected by
   * replacing the measurements with an even pulse - not by scaling them, which
   * would carry the mistake through at a different speed. What survives is the
   * first beat, because the user has already placed it with `nudgeDownbeat`
   * and a tempo control that moved the bar lines would undo that work.
   *
   * Costs a re-derivation and no detection, like every other knob here. A
   * tempo outside `MIN_TEMPO_BPM`..`MAX_TEMPO_BPM` leaves the grid alone,
   * because bar count scales linearly with it and the far side of that bound is
   * a render that does not return rather than a wrong answer; see
   * `withTempo`. A no-op unless a transcription has succeeded, and refused on
   * the same terms as `updateSettings`.
   *
   * **Not reversible from the grid it leaves behind**, which is what
   * `session.trackedGrid` is for. Typing the original BPM back produces an even
   * pulse at that tempo, not the measured one the tracker returned, because the
   * measurements are what this replaces. `nudgeDownbeat` is the same shape: it
   * drops beats off the front for good. Eight of the ten knobs are reversible
   * and these two are not; the tracked grid is kept so a "restore tracked
   * tempo" control can exist, and that control is follow-up work.
   */
  updateTempo(bpm: number): void {
    this.rederive(session => ({
      ...session,
      grid: withTempo(session.grid, bpm)
    }));
  }

  /**
   * States which note value the tracker found, and rebuilds the grid at the
   * one the music is actually in.
   *
   * The correction `updateTempo` cannot make. A beat tracker can be right about
   * *where* the beats are and wrong about *which* note value they are: a user's
   * 3+3+2 tresillo bassline at 153 BPM tracked at 100.96, a clean 3:2 error,
   * because the strongest onset periodicity in the line is the three-eighth
   * grouping - and the tracked positions were still good to 23 ms against the
   * true eighth grid. `updateMetricalLevel(1.5)` says "that pulse is a dotted
   * quarter" and resamples the measurements at the quarter.
   *
   * Typing 153 into the tempo box instead gets the number right and the timing
   * wrong: `withTempo` lays a uniform pulse and discards every per-beat
   * measurement, and the take is human - local tempo wanders 150.5 to 153.8, so
   * an even grid is right for about fifteen bars and at chance half a minute
   * in. `atMetricalLevel` argues the contrast at length.
   *
   * ## Always from `trackedGrid`, never from the current grid
   *
   * So levels are commutative and lossless: 1 to 1.5 and back returns the
   * original beats exactly, because the second call resamples the same pristine
   * measurements rather than a resampling of them. Chaining would compound the
   * interpolation error and a round trip would land somewhere new.
   *
   * ## Which means it discards a beat correction, deliberately
   *
   * A tempo typed into the box and a downbeat nudged by hand are both replaced,
   * because both are edits to a grid this rebuilds from source. That is the
   * right answer for the tempo - the two are ways of setting the same thing and
   * the level is the better one - and it is the only available answer for the
   * nudge: a phase correction is whole beats at the level it was made at, and
   * one beat of a dotted quarter is two thirds of a quarter, which
   * `nudgedDownbeat` cannot express. A UI has to say so rather than let it
   * happen quietly.
   *
   * The **meter** survives, because it is not a beat correction: the resampled
   * grid is restamped with `session.grid.timeSignature`, which is the corrected
   * one, rather than with the meter the tracker ran under.
   *
   * A level `canApplyMetricalLevel` turns down - outside
   * `MIN_BEATS_PER_PULSE`..`MAX_BEATS_PER_PULSE`, not a number, or a grid too
   * short to resample - changes nothing, and in particular does not record
   * itself: a session claiming a level its grid is not at would make
   * `resuppressed` read a hand correction where there is none. Refused rather
   * than clamped, like every other correction on this service.
   *
   * Costs a re-derivation and no detection, like every other knob here, and a
   * no-op unless a transcription has succeeded.
   */
  updateMetricalLevel(beatsPerPulse: number): void {
    this.rederive(session => {
      if (!canApplyMetricalLevel(session.trackedGrid, beatsPerPulse)) return session;

      return {
        ...session,
        beatsPerPulse,
        grid: {
          ...atMetricalLevel(session.trackedGrid, beatsPerPulse),
          // At level 1 this spreads the tracked grid, so `beatsSec` is still
          // the tracked array itself and `resuppressed` goes on reading the
          // question by identity.
          timeSignature: session.grid.timeSignature
        }
      };
    });
  }

  /**
   * Moves the bar lines by whole beats, without moving the beats themselves.
   *
   * The correction M2 left undone. `trimBeats` starts the grid at the first
   * beat the onsets support and derivation reads that beat as bar 1 beat 1,
   * but nothing established it as a downbeat - so a line that begins on beat 3
   * tracks perfectly and is barred a half-bar out. This is how a listener says
   * where bar 1 actually begins: `+1` starts it a beat later, `-1` a beat
   * earlier.
   *
   * Nudging back can put the grid's first beat before zero, which is the
   * correct answer rather than an edge case - it says the piece begins mid-bar
   * - and `secondsToBeats` extrapolates there by design, so a note that now
   * falls on beat 2 of bar 1 is written there rather than clamped onto beat 1
   * and reported as `beforeGrid`.
   *
   * A no-op unless a transcription has succeeded, and refused on the same
   * terms as `updateSettings`. A fractional or zero nudge leaves the grid
   * alone, as does one further than `MAX_DOWNBEAT_NUDGE_BEATS` - which is a
   * trim rather than a phase correction, and backwards is an array element per
   * beat asked for; see `nudgedDownbeat`.
   */
  nudgeDownbeat(beats: number): void {
    this.rederive(session => ({
      ...session,
      grid: nudgedDownbeat(session.grid, beats)
    }));
  }

  /**
   * Applies `change` to the current session and pushes the score it derives.
   *
   * ## The error contract, settled here
   *
   * **Derivation degrades when the fault is a settings combination the user
   * chose; it throws only on input data that cannot be honoured.** A knob the
   * user can turn must never be able to throw out of a state-reporting method,
   * because the exception escapes into whatever handler moved the control:
   * nothing is pushed, and the UI goes on showing the old score with the
   * control in its new position, describing a state that does not exist.
   *
   * So the impossible combination is checked *before* `deriveScore` sees it,
   * and the change is refused - previous session, previous score, a message
   * saying why. Two checks, both over knobs the user turns:
   *
   * - `barGridFault`. `finestDivision` and the meter's denominator are both
   *   live, and `quantizeBar` cannot write a bar whose beat the grid is coarser
   *   than: 6/8 with a `finestDivision` of 4, or 4/16 with 8. Reaching that
   *   through two legal public calls takes nothing exotic - transcribe in 6/8,
   *   then drag `finestDivision` down.
   * - `fretboardFault`. `capo`, `maxFret` and `positionHint` describe a neck
   *   between them, and some of what they can say is not a neck: capo 12 on a
   *   12-fret setting leaves nothing but open strings and collapses the score
   *   to a bar of rests, and both numbers are on the spinner arrows.
   *
   * Refused rather than clamped, matching `withTempo` and `nudgedDownbeat`: a
   * clamp applies a change nobody asked for, and the control then shows a value
   * the score was not derived with.
   *
   * **Not a try/catch around `deriveScore`.** M1 warned that a throwing pure
   * function inside a live re-derive loop blanks the preview, and a catch that
   * swallowed everything would reintroduce exactly that: a bad note pitch or a
   * NaN onset - facts about the detection, which no setting can repair - would
   * be quietly absorbed instead of surfacing. Those still throw, and should:
   * a session sitting in `ready` derived successfully once already, so they are
   * bugs rather than user-facing failures.
   *
   * ## Suppression, and the beat grid it drags behind it
   *
   * Suppression used to run once, inside `transcribe`. It runs here now, over
   * `session.rawNotes`, `session.harmonics` and `session.decisions`, which is
   * what makes those four thresholds live knobs instead of constants a
   * re-upload could not change - and what lets one note be overruled without a
   * second place deciding the kept set.
   *
   * It is skipped when none of the three moved, and that is not an
   * optimisation of the answer - it is the same answer, since the pass is a
   * pure function of exactly those three. What the skip buys is identity:
   * `notes` and `suppressed` stay the arrays they were, so a tuning change
   * does not hand a subscriber a new-but-equal discard list to re-render.
   *
   * When the kept set does move - whether a threshold moved it or a single
   * toggle did - the beat grid is stale. **Beat tracking runs on the
   * suppressed notes**, deliberately - harmonic partials carry onsets of
   * their own and an onset-driven tracker fed them follows the artefacts - so a
   * different kept set is a different tracker input, and a grid tracked from
   * the old one describes a note list that no longer exists.
   *
   * Rebuilding it is right *unless the user has already corrected it*, in which
   * case rebuilding would silently throw that correction away, and an explicit
   * correction outranks an inference. `session.trackedGrid` is what makes the
   * question answerable: it is what `trackBeats` returned, `grid` is what is in
   * force, and `withTempo`, `nudgedDownbeat` and `updateMetricalLevel` replace
   * only the latter.
   *
   * The test is on `beatsSec` rather than on the grid object, which matters:
   * `updateTimeSignature` spreads the grid to restamp the meter and so replaces
   * the object every time, including with a meter equal to the one already
   * there. `grid !== trackedGrid` would read that as a beat correction and stop
   * re-tracking for the rest of the session - a wrong answer arrived at
   * silently. A meter change moves no beats, and it is beats the tracker would
   * overwrite, so `beatsSec` is the field the question is actually about. The
   * meter itself survives either way: a re-track is handed
   * `session.grid.timeSignature`, which is the corrected one.
   *
   * **A metrical level moves the beats without being a hand correction**, and
   * that is the second way this test could be read wrong. `grid` is then a
   * resampling of `trackedGrid` and the two arrays differ by construction, so
   * the identity test would answer "corrected" for a session nobody has
   * corrected - and a threshold change would stop re-tracking. The question is
   * therefore asked against `atMetricalLevel(trackedGrid, beatsPerPulse)`,
   * which is the grid the current level implies; at level 1 that is the tracked
   * array itself and the test is the identity one it always was.
   *
   * After a re-track **both** fields take the new grid, `grid` at the level in
   * force. A `trackedGrid` left behind would differ from `grid` from then on,
   * and the next threshold change would read a correction nobody made; a level
   * not re-applied would revert the user's correction just as quietly, since
   * the tracker returns its own level every time.
   *
   * A grid the user has corrected outlives the notes it was tracked from, and
   * that is coherent rather than a compromise: `BeatGrid` is a list of times in
   * seconds against audio that has not changed, and `deriveScore` reads it as
   * one - `secondsToBeats` places a note against the beats and extrapolates
   * past both ends. Nothing downstream asks which note list produced the grid,
   * because there is nothing it could do with the answer.
   */
  private rederive(
    change: (session: TranscriptionSession) => TranscriptionSession
  ): void {
    const current = this.state;
    if (current.phase !== 'ready' || current.session === null) return;

    const changed = change(current.session);

    // Checked before any work is done rather than after: neither suppression
    // nor beat tracking can turn a faulted combination into a sound one, and
    // re-tracking does not touch the meter this reads.
    //
    // Both faults are combinations of live knobs, and neither can be left to
    // the controls: an HTML `min`/`max` is one caller's decoration, and a typed
    // or pasted value walks straight past it.
    const fault =
      barGridFault(changed.grid.timeSignature, changed.settings.finestDivision)
      ?? fretboardFault(changed.settings);
    if (fault !== null) {
      // The whole change is turned away, not the offending half of it: a
      // partly applied settings object would leave the state describing
      // something the caller never asked for.
      this.push({ ...current, refusal: `Could not apply that change: ${fault}.` });

      return;
    }

    const suppressed: DetectedNote[] = [];
    const session = resuppressed(changed, current.session, suppressed);

    this.push({
      phase: 'ready',
      progress: 1,
      session,
      derived: deriveScore(session),
      // The array `resuppressed` filled, or - when it handed `changed` straight
      // back, meaning it found nothing to redo - the one already on the state.
      // Session identity is the signal, so this cannot drift out of step with
      // what was actually recomputed.
      suppressed: session === changed ? current.suppressed : suppressed,
      error: null,
      refusal: null
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

/**
 * `session` with `notes` rebuilt from `rawNotes` and `harmonics`, re-tracking
 * the beat grid if that moved the tracker's input.
 *
 * `previous` is the session the change was made from, and is read for one
 * thing only: whether any of the three suppression inputs is the same object
 * it was. The pass is pure in exactly `rawNotes`, `harmonics` and `decisions`,
 * so when none of them moved the answer cannot have, and the whole function is
 * `return session` - which keeps `notes` the array it already was rather than
 * replacing it with an equal one.
 *
 * `decisions` earns its place in that test twice over. Leaving it out would
 * not merely miss an optimisation, it would skip the pass outright on a
 * toggle: `toggleNote` moves nothing else, so the note would stay exactly
 * where the thresholds put it and the click would do nothing at all.
 *
 * `suppressed` collects the partials removed, matching `suppressHarmonics`'
 * own out-parameter, and is filled **only when the kept set actually changed**.
 * Untouched otherwise, and in that case `session` itself comes straight back
 * by identity - which is how `rederive` tells the two apart without comparing
 * two equal lists to find out that nothing happened.
 *
 * The re-track rule, and why the test is `beatsSec` rather than the grid, are
 * argued at length on `TranscriptionService.rederive`.
 */
function resuppressed(
  session: TranscriptionSession,
  previous: TranscriptionSession,
  suppressed: DetectedNote[]
): TranscriptionSession {
  if (
    session.rawNotes === previous.rawNotes &&
    session.harmonics === previous.harmonics &&
    session.decisions === previous.decisions
  ) {
    return session;
  }

  const removed: DetectedNote[] = [];
  const notes = suppressHarmonics(
    session.rawNotes,
    session.harmonics,
    session.decisions,
    removed
  );

  // A threshold that moved without changing a single decision - which is most
  // of a drag along a slider, since the thresholds are continuous and the
  // decisions are not. Nothing downstream has anything to do about it, and
  // re-tracking here would rebuild the grid for an unchanged note list.
  if (sameNotes(notes, session.notes)) return session;

  // One at a time rather than spread: a long stem discards thousands of
  // partials, and `push(...removed)` would eventually hit the argument limit.
  // `suppressHarmonics` avoids it for the same reason.
  for (const note of removed) suppressed.push(note);

  const suppressedSession: TranscriptionSession = { ...session, notes };

  // Their correction outranks the tracker's inference, and rebuilding would
  // discard it without saying so.
  //
  // The comparison is against the grid the *level* makes of the tracked one,
  // not against the tracked one itself. At level 1 those are the same array and
  // this is the identity test it has always been; at any other level they
  // differ by construction, and asking the old question would read the level as
  // a hand correction and stop re-tracking for the rest of the session.
  const leveled = atMetricalLevel(session.trackedGrid, session.beatsPerPulse);
  if (!sameBeats(session.grid.beatsSec, leveled.beatsSec)) return suppressedSession;

  // The session's own meter, not the tracked grid's: a meter correction is not
  // a beat correction and has to survive this.
  const tracked = trackBeats(notes, session.durationSec, session.grid.timeSignature);

  // Both, so the question above goes on being answerable: `trackedGrid` is
  // what the tracker just measured and `grid` is that at the level in force. A
  // `trackedGrid` left at the old object would answer "corrected" forever.
  //
  // Re-applying the level here is the whole reason the session carries it. The
  // tracker returns its own level every time, so without this a threshold
  // change would quietly revert the correction the user made.
  return {
    ...suppressedSession,
    grid: atMetricalLevel(tracked, session.beatsPerPulse),
    trackedGrid: tracked
  };
}

/**
 * Whether two beat lists hold the same times.
 *
 * By identity first, which is the level-1 case and costs nothing, then by
 * value - because the list a level implies is *recomputed* rather than kept,
 * and a fresh array of the same numbers is the same grid. `atMetricalLevel` is
 * pure and deterministic, so equal inputs give bit-identical outputs and this
 * is exact rather than approximate.
 */
function sameBeats(a: number[], b: number[]): boolean {
  return a === b || (a.length === b.length && a.every((sec, i) => sec === b[i]));
}

/**
 * `session.decisions` with the verdict on `id` moved one step round the cycle
 * override-removed -> overridden -> override-removed.
 *
 * The two lists are read before `session.notes` is, which is what makes the
 * cycle two steps rather than three: a note already overridden is *at* the
 * verdict its override names, so asking "is it kept?" first would read the
 * override's own effect and push a second override on top of it.
 *
 * New arrays every time, and never a mutation: `NoteDecisions` is shared with
 * whatever is rendering it, and `resuppressed` compares the object by identity
 * to decide whether the pass has to run again.
 */
function toggledDecisions(session: TranscriptionSession, id: string): NoteDecisions {
  const { keep, drop } = session.decisions;

  if (keep.includes(id)) return { keep: keep.filter(other => other !== id), drop };
  if (drop.includes(id)) return { keep, drop: drop.filter(other => other !== id) };

  // Neither list holds it, so whichever list it joins, it joins alone.
  return session.notes.some(note => note.id === id)
    ? { keep, drop: [...drop, id] }
    : { keep: [...keep, id], drop };
}

/**
 * Whether two kept sets are the same notes in the same order.
 *
 * By element identity, which is exact rather than approximate here:
 * `suppressHarmonics` returns the objects it was given, from one array, under
 * one comparator. Two runs that reached the same decisions therefore return the
 * same objects in the same order, and any difference in decision shows up as a
 * difference in this.
 */
function sameNotes(a: DetectedNote[], b: DetectedNote[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

/** Matches the id shape `ComposerService` and `ComposerLibraryService` use. */
function nextSessionId(): string {
  return `txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

