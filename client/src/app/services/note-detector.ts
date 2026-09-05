/**
 * The boundary between "something turned audio into note events" and every
 * consumer of those events.
 *
 * `TranscriptionService` orchestrates decode -> detect -> suppress -> track ->
 * derive, and only this one step needs a model. Naming it as an interface is
 * what lets the rest of the chain be tested without one, what lets M2's
 * in-browser detector run behind a Web Worker without the caller knowing, and
 * what leaves room for a server-side detector later: a bigger model, or one
 * that will not fit in a bundle, becomes an implementation of `detect` that
 * happens to POST the samples somewhere.
 *
 * The signature is deliberately not "give me a file". Decoding is a separate,
 * detector-independent step (`audio-decode.ts`), and a detector that took a
 * `File` could not be handed synthesised audio in a test.
 */

import { DetectedNote } from '../models/transcription.model';

/**
 * The rate audio is handed to a detector at, in Hz.
 *
 * Basic Pitch is trained at 22.05 kHz and rejects anything else, so this is
 * simultaneously what `decodeToMono` resamples *to* and what the detector
 * checks its input *against*. Those are two ends of one contract and were two
 * unrelated constants, `TARGET_SAMPLE_RATE` in `audio-decode.ts` and
 * `MODEL_SAMPLE_RATE` in `basic-pitch-detector.ts`, which had to agree with
 * nothing linking them: change one and the decoder silently produces audio the
 * detector refuses.
 *
 * It lives here because this is the boundary the two sides meet at, and
 * because `basic-pitch-detector.ts` must stay unreachable from the main thread
 * - putting it there would give the decoder no way to read it without dragging
 * TF.js into the main bundle. This module is types and a number, and imports
 * nothing but the domain model.
 */
export const DETECTION_SAMPLE_RATE = 22050;

export interface DetectionResult {
  notes: DetectedNote[];
  /**
   * Frame rate of `DetectedNote.bendCents`, in Hz. Basic Pitch: 22050/256.
   *
   * It rides on the result rather than on each note because it is a property
   * of the detector, not of a note, and because `DetectedNote` deliberately
   * does not record it — a bend array is useless without it, so whoever hands
   * out the notes has to hand out the rate too.
   */
  bendFrameRateHz: number;
}

export interface NoteDetector {
  /**
   * Detects the notes in `audio`.
   *
   * `audio` is mono. A detector may require a particular `sampleRate` — Basic
   * Pitch is trained at 22.05 kHz and rejects anything else rather than
   * resampling, since `decodeToMono` already resamples properly and a second,
   * worse resampler here would be a silent downgrade.
   *
   * `onProgress` is called with 0-1 as inference proceeds, ending at exactly
   * 1. It is a callback rather than an observable because the detector that
   * matters runs in a worker, where the only channel is `postMessage`.
   */
  detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void
  ): Promise<DetectionResult>;
}
