/**
 * `NoteDetector` backed by Spotify's Basic Pitch, running in the browser on
 * the TF.js WebGL backend.
 *
 * ## Why this reimplements the library's own inference loop
 *
 * `BasicPitch.evaluateModel` is the obvious entry point and it cannot be used.
 * It reads each batch's output with `await tensor.array()`, and TF.js 3.21's
 * *asynchronous* WebGL readback never resolves inside a Web Worker: a spike
 * measured `.data()` hanging indefinitely there while `.dataSync()` on
 * identical code returned in 3 ms. Inference has to live in a worker — a
 * four-minute stem otherwise freezes the UI for seconds, and confining TF.js
 * to a worker chunk is also what keeps it out of the main bundle — so the loop
 * below mirrors `evaluateModel` structurally and substitutes `arraySync()` for
 * every `await ...array()`. The CPU backend would sidestep the readback
 * problem and is roughly 100x slower, which is not a trade worth making.
 *
 * Nothing here is a fork or a patch. Every piece it calls —
 * `evaluateSingleFrame`, `unwrapOutput`, the `model` promise — is public API;
 * only the three lines that read tensors back differ.
 *
 * The loop also releases the tensors it allocates, which `evaluateModel` does
 * not. On a long stem that is tens of megabytes of GPU textures.
 *
 * The one piece it does *not* call is `prepareData`, whose framing crashes the
 * shader compiler on a sixteenth of song-length inputs. `detection-framing.ts`
 * replaces it and explains itself at length.
 *
 * ## What comes out
 *
 * Basic Pitch over-detects a plucked bass line: across the sixteen
 * Karplus-Strong materials in `harmonic-eval/`, 182 played notes come back as
 * **310**, at 72.0 % recall and 42.3 % precision, with the spurious ones
 * overwhelmingly harmonic partials *above* a fundamental. Recall is what this
 * adapter is responsible for; `suppressHarmonics` is responsible for
 * precision. Constraining the model's own `minFreq`/`maxFreq` is not a
 * substitute — measured on the spike's bassline, it removed exactly one of
 * the twenty-six partials, because they sit inside a bass's range too — so
 * the model's defaults are used unaltered.
 */

import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly
} from '@spotify/basic-pitch';
import type { NoteEventTime } from '@spotify/basic-pitch';

import { DetectedNote } from '../models/transcription.model';
import { FFT_HOP, frameForModel } from './detection-framing';
import { DETECTION_SAMPLE_RATE, DetectionResult, NoteDetector } from './note-detector';

/** Where `angular.json` copies the weights bundled with the npm package. */
export const BASIC_PITCH_MODEL_URL = '/basic-pitch-model/model.json';

/**
 * Rate at which the model reports frames, and so the rate `bendCents` is
 * sampled at.
 *
 * 86.13 Hz, not the 86 the library's own `ANNOTATIONS_FPS` floors it to. That
 * floored value exists only to count how many frames of output an input should
 * produce; `modelFrameToTime`, which is what actually places notes in time,
 * uses the unrounded ratio. Reporting 86 here would walk a bend a whole frame
 * off its note every 6.5 seconds.
 */
export const BEND_FRAME_RATE_HZ = DETECTION_SAMPLE_RATE / FFT_HOP;

/** Contour bins per semitone in the model's bend output. Mirrors the library. */
const CONTOUR_BINS_PER_SEMITONE = 3;

/** The three model outputs, in the order `evaluateSingleFrame` returns them. */
type Posteriorgrams = [number[][], number[][], number[][]];

export class BasicPitchDetector implements NoteDetector {
  private readonly basicPitch: BasicPitch;

  /**
   * Constructing this starts the model download; the promise lives inside
   * `BasicPitch` and is awaited on first use. One instance, reused across
   * calls — reloading the graph per file would cost a fetch and a fresh set of
   * shader compiles every time.
   */
  constructor(modelUrl: string = BASIC_PITCH_MODEL_URL) {
    this.basicPitch = new BasicPitch(modelUrl);
  }

  async detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void
  ): Promise<DetectionResult> {
    if (sampleRate !== DETECTION_SAMPLE_RATE) {
      throw new Error(
        `Basic Pitch needs audio at ${DETECTION_SAMPLE_RATE} Hz, was given ${sampleRate} Hz.`
      );
    }

    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await this.infer(
      audio,
      ([batchFrames, batchOnsets, batchContours]) => {
        // Appended row by row rather than with `push(...rows)`: a batch is
        // only ~142 rows, but spreading a long stem's worth would eventually
        // hit the argument-count limit.
        for (const row of batchFrames) frames.push(row);
        for (const row of batchOnsets) onsets.push(row);
        for (const row of batchContours) contours.push(row);
      },
      onProgress
    );

    const events = noteFramesToTime(
      addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets))
    );

    // `outputToNotesPoly` walks the posteriorgram pitch by pitch, so what it
    // returns is in no useful order at all. Pitch breaks the ties, so the
    // result does not lean on the sort being stable.
    events.sort(
      (a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi
    );

    return { notes: events.map(toDetectedNote), bendFrameRateHz: BEND_FRAME_RATE_HZ };
  }

  /**
   * `BasicPitch.evaluateModel`, with synchronous readback and with its tensors
   * released.
   *
   * Kept line-for-line comparable to the original, including the
   * trim-to-original-length arithmetic, which is the subtle part: the model
   * runs over overlapping two-second windows, so the concatenated output
   * overshoots the input and the last useful batch has to be cut short.
   *
   * `frameForModel` stands in for `prepareData`, and the trim is measured
   * against `audio.length` - the audio as handed in - exactly as the original
   * measures it against `prepareData`'s second return value. Anything that
   * ever makes the framed input longer than the audio, silence included, must
   * leave that number alone, or the extra windows' frames would be kept.
   */
  private async infer(
    audio: Float32Array,
    onBatch: (posteriorgrams: Posteriorgrams) => void,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    const audioOriginalLength = audio.length;
    const reshapedInput = frameForModel(audio);

    try {
      // The library floors the frame rate to count output frames, and this
      // trim has to agree with it exactly or the output shifts in time.
      const annotationsFps = Math.floor(DETECTION_SAMPLE_RATE / FFT_HOP);
      const framesWanted = Math.floor(
        audioOriginalLength * (annotationsFps / DETECTION_SAMPLE_RATE)
      );
      const batches = reshapedInput.shape[0];
      let framesSoFar = 0;

      for (let batch = 0; batch < batches; batch++) {
        onProgress(batch / batches);

        // The original tests this after running the batch and throws the
        // result away. Same output, one less inference.
        if (framesSoFar >= framesWanted) continue;

        const results = await this.basicPitch.evaluateSingleFrame(reshapedInput, batch);
        const unwrapped = results.map(result => this.basicPitch.unwrapOutput(result));
        for (const result of results) result.dispose();

        const batchFrames = unwrapped[0].shape[0];
        const keep = Math.min(batchFrames, framesWanted - framesSoFar);
        const trimmed =
          keep < batchFrames
            ? unwrapped.map(output => output.slice([0, 0], [keep, -1]))
            : unwrapped;
        if (trimmed !== unwrapped) {
          for (const output of unwrapped) output.dispose();
        }
        framesSoFar += batchFrames;

        // The one substantive difference from `evaluateModel`: `arraySync`,
        // not `await array()`. See the module docblock.
        onBatch([trimmed[0].arraySync(), trimmed[1].arraySync(), trimmed[2].arraySync()]);
        for (const output of trimmed) output.dispose();
      }

      onProgress(1);
    } finally {
      reshapedInput.dispose();
    }
  }
}

/**
 * `amplitude` becomes `confidence` - and it is the library's field name that
 * is wrong, not ours.
 *
 * It is the **mean** of the note's frame activations across its span, not a
 * peak, not a calibrated probability, and not a level. Both of `toMidi.ts`'s
 * construction sites compute it as
 * `frames.slice(start, end).reduce(...) / (end - start)`; the second even
 * carries the numpy line it came from as a comment.
 *
 * The M2 plan called this "amplitude, used as a proxy for confidence". That is
 * backwards, and the mistake was load-bearing: it is a confidence, and a poor
 * proxy for amplitude. Measured across the six accuracy fixtures that carry
 * dynamics - 49 detected notes spanning 17.7 dB of pluck strength - its
 * correlation with how hard the note was played is **r = 0.182**, and the mean
 * over the softest notes is 0.954 of the mean over the loudest against a
 * physical amplitude ratio near 0.3. On the `accents` fixture the offbeats,
 * plucked at a third of the downbeats' strength, come back *higher*. Do not
 * read a low `confidence` as a quiet note; `harmonic-accuracy.spec.ts`
 * measures this and will say so if a model change ever makes it untrue.
 *
 * Two more things follow, and neither is what "peak" would imply.
 *
 * **It is biased against long notes.** A mean over a decaying activation falls
 * as the note is held, so a sustained note scores below a short punchy one of
 * the same strength — the opposite of the bias a peak would carry, and worth
 * knowing before anyone reads a low `confidence` as a weak detection.
 *
 * **`DerivationSettings.confidenceFloor` is very nearly a no-op at its
 * default.** `outputToNotesPoly` builds a note's span out of exactly the frames
 * that cleared its `frameThresh`, so the mean of those frames is bounded below
 * by that threshold. `frameThresh` defaults to 0.3 and `confidenceFloor`
 * defaults to 0.3: the same threshold applied twice, the second time to numbers
 * the first has already guaranteed. Measured on the spike fixture,
 * post-suppression amplitudes cluster in 0.520–0.712, so the floor changes
 * nothing at all until it is raised past 0.52 — 0.22 above where it sits. Not
 * re-tuned here: one synthetic fixture is not enough to pick a number, and M3
 * has real stems. See the plan.
 *
 * What it cannot do at any setting: separate a real note from a harmonic
 * partial, because it is a threshold on one note rather than a comparison
 * between two. In the spike's output a partial came back 5 % *higher* than the
 * note that produced it. The comparison does carry real information -
 * `transcription-harmonics.ts` suppresses partials on the ratio between a note
 * and the one below it, and argues there why the model is less sure of a
 * partial than of a note - but no floor can see that.
 */
function toDetectedNote(event: NoteEventTime, index: number): DetectedNote {
  return {
    // Position in the sorted result. Stable for a given detection, which is
    // all anything downstream asks of it — a note's identity does not survive
    // re-running detection anyway.
    id: `bp-${index}`,
    pitch: event.pitchMidi,
    onsetSec: event.startTimeSeconds,
    offsetSec: event.startTimeSeconds + event.durationSeconds,
    confidence: event.amplitude,
    bendCents: toCents(event.pitchBends)
  };
}

/**
 * Basic Pitch reports bends in **contour bins**, not cents.
 *
 * `addPitchBendsToNoteEvents` returns the argmax of the contour posteriorgram
 * in a window around the note's nominal bin, offset so that 0 is the nominal
 * pitch — and the contour grid is three bins to a semitone. So a bin is 100/3
 * cents, and passing the raw array straight to `DetectedNote.bendCents`, which
 * the model documents as cents, would understate every bend 33-fold.
 */
function toCents(pitchBends: number[] | undefined): number[] {
  const centsPerBin = 100 / CONTOUR_BINS_PER_SEMITONE;

  return pitchBends?.map(bins => bins * centsPerBin) ?? [];
}
