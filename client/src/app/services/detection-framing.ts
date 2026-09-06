/**
 * Cutting mono audio into the overlapping windows Basic Pitch's graph expects.
 *
 * ## Why this is not `BasicPitch.prepareData`
 *
 * It was, and on **6.25 % of song-length files** it crashed before a single
 * batch ran. `prepareData` calls
 * `tf.signal.frame(wavSamples, 43844, 36164, true, 0)`, which slices one
 * tensor per window and hands the whole list to `tf.concat`. TF.js 3.21's
 * WebGL concat chunks its inputs by
 * `maxTexturesInShader = Math.min(16, gl.MAX_TEXTURE_IMAGE_UNITS)` - 16 on any
 * WebGL2 device - and recurses on the chunk results. When a chunk holds
 * exactly **one** tensor, `concat_gpu.ts` generates a shader that will not
 * compile:
 *
 * ```js
 * const offsets = new Array(shapes.length - 1);   // length 0 for one input
 * offsets[0] = shapes[0][1];                      // grows it to 1
 * const lastIndex = offsets.length;               // 1
 * snippets.push(`else setOutput(getT${lastIndex}(yR, yC-${lastShift}));`);
 * ```
 *
 * `variableNames` is `['T0']`, the GLSL calls `getT1`, and compilation dies
 * with `'getT1' : no matching overloaded function found`. `ConcatPackedProgram`
 * has the same defect; `tf.concat` itself is safe only because it clones a
 * lone tensor instead of running a kernel, which the *recursive* call inside
 * the backend does not do.
 *
 * So with `N = ceil((3840 + samples) / 36164)` windows, framing fails whenever
 * `N > 16 && N % 16 === 1` - and, because the chunk results are concatenated
 * the same way, whenever that holds of `ceil(N / 16)` too. Measured at
 * 22.05 kHz: 209.7 s gives 128 windows and works, **209.8 s gives 129 and
 * fails in about a second**, 212.0 s gives 130 and works. A 1.64 s dead band
 * in every 26.24 s, plus one contiguous run of seventeen counts, N = 257..273
 * (roughly 7:00 to 7:29 of audio), where the *second* level of chunking claims
 * the fifteen in the middle that `N % 16 === 1` does not name. Under 26 s it
 * cannot happen at all, which is why every fixture in this repository passed.
 *
 * ## Why framing rather than padding
 *
 * Appending silence until `N` lands on a safe count also works, and is a
 * smaller change. It was rejected for two reasons. It leaves the fix depending
 * on a library internal we cannot see from here - the chunk size is a GPU
 * capability, and TF.js is free to change how it chunks - and the arithmetic
 * is not the one-liner it looks like: inside the 257..273 run a *single* hop
 * of padding lands on another failing count, and 17 hops (27.9 s of silence)
 * are needed to escape it. Building the windows directly depends on
 * nothing but the definition of `tf.signal.frame`, which
 * `detection-framing.spec.ts` checks this against elementwise.
 *
 * It is also cheaper on exactly the files that used to break: one allocation
 * and one upload instead of N slice kernels and a log-depth tree of concats,
 * whose intermediates are about twice the framed data again in GPU textures.
 *
 * **Do not "simplify" this back to `prepareData`.** It is not a
 * reimplementation for its own sake, and the bug it avoids is silent until a
 * user's file happens to be the wrong length by a second and a half.
 */

import * as tf from '@tensorflow/tfjs';

import { DETECTION_SAMPLE_RATE } from './note-detector';

/** Samples per model frame. The model's own `FFT_HOP`. */
export const FFT_HOP = 256;

/** Samples in one model window: two seconds less a frame. `AUDIO_N_SAMPLES`. */
export const WINDOW_SAMPLES = DETECTION_SAMPLE_RATE * 2 - FFT_HOP;

/** Frames each window shares with its neighbour. `N_OVERLAPPING_FRAMES`. */
const OVERLAP_FRAMES = 30;

/** Samples of that overlap. `OVERLAP_LENGTH_FRAMES`. */
const OVERLAP_SAMPLES = OVERLAP_FRAMES * FFT_HOP;

/** Samples between the starts of consecutive windows. `HOP_SIZE`. */
export const WINDOW_HOP = WINDOW_SAMPLES - OVERLAP_SAMPLES;

/**
 * Silence prepended ahead of the first sample, so the first window's output
 * has the same half-overlap trimmed from its front as every other window's.
 * The model's `floor(OVERLAP_LENGTH_FRAMES / 2)`.
 */
export const LEAD_IN_SAMPLES = Math.floor(OVERLAP_SAMPLES / 2);

/**
 * How many windows `sampleCount` samples of audio is cut into.
 *
 * `tf.signal.frame` starts a window at every multiple of the hop that falls
 * inside the signal, zero-filling the last one, so this is the signal length -
 * lead-in included - over the hop, rounded up.
 */
export function windowCountFor(sampleCount: number): number {
  return Math.ceil((LEAD_IN_SAMPLES + sampleCount) / WINDOW_HOP);
}

/**
 * `audio` as the `[windows, WINDOW_SAMPLES, 1]` tensor the graph takes.
 *
 * Identical, sample for sample, to what `prepareData` returns - the module
 * docblock says why it is built rather than borrowed. Windows overlap, so the
 * result is about 1.21x the length of the audio.
 */
export function frameForModel(audio: Float32Array): tf.Tensor3D {
  const windows = windowCountFor(audio.length);
  const framed = new Float32Array(windows * WINDOW_SAMPLES);

  for (let window = 0; window < windows; window++) {
    // Where this window starts in the lead-in-plus-audio signal, and how much
    // of its head falls in the lead-in. Only the first window has any, since
    // the hop is far longer than the lead-in, but saying so in arithmetic
    // rather than in a special case is what keeps the two ends symmetric.
    const start = window * WINDOW_HOP;
    const silentHead = Math.max(0, LEAD_IN_SAMPLES - start);
    const from = start + silentHead - LEAD_IN_SAMPLES;
    // Short on the last window, which runs off the end of the audio. Whatever
    // is left of it stays zero, which is `padEnd`'s `padValue`.
    const count = Math.min(WINDOW_SAMPLES - silentHead, audio.length - from);

    if (count > 0) {
      framed.set(audio.subarray(from, from + count), window * WINDOW_SAMPLES + silentHead);
    }
  }

  return tf.tensor3d(framed, [windows, WINDOW_SAMPLES, 1]);
}
