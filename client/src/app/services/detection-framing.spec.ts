import * as tf from '@tensorflow/tfjs';

import {
  LEAD_IN_SAMPLES,
  WINDOW_HOP,
  WINDOW_SAMPLES,
  frameForModel,
  windowCountFor
} from './detection-framing';
import { DETECTION_SAMPLE_RATE } from './note-detector';

/**
 * These specs are about arithmetic and memory layout, not about music, so
 * unlike the two detector specs they run no inference and load no model. They
 * do need a real WebGL backend, because half of what they pin is a shader that
 * TF.js fails to compile; `karma.conf.js` provides one.
 */

/** Ordinary audio, whose value at every index says which index it is. */
function ramp(sampleCount: number): Float32Array {
  const audio = new Float32Array(sampleCount);

  // Distinct over a span far longer than a window, so a window copied from
  // the wrong offset cannot match by coincidence: 65536 shares no factor
  // with WINDOW_HOP (36164 = 2^2 x 7 x 1291) beyond 4.
  for (let i = 0; i < sampleCount; i++) audio[i] = (i % 65536) / 65536 - 0.5;

  return audio;
}

/** Index of the first non-zero sample in `[from, to)`, or -1 if there is none. */
function nonZeroIn(samples: ArrayLike<number>, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (samples[i] !== 0) return i;
  }

  return -1;
}

/**
 * How many windows `tf.signal.frame` produces, by its own two loops rather
 * than by a closed form.
 *
 * `windowCountFor` is the closed form; this is what it has to agree with, and
 * it is written out here so the agreement is a measurement and not a
 * restatement.
 */
function referenceWindowCount(sampleCount: number): number {
  const size = LEAD_IN_SAMPLES + sampleCount;
  let start = 0;
  let count = 0;

  while (start + WINDOW_SAMPLES <= size) {
    count++;
    start += WINDOW_HOP;
  }
  // padEnd: whatever is left over becomes one more window, zero-filled.
  while (start < size) {
    count++;
    start += WINDOW_HOP;
  }

  return count;
}

/** `BasicPitch.prepareData`'s body: what this module replaces, verbatim. */
function libraryFraming(audio: Float32Array): tf.Tensor {
  const wavSamples = tf.concat1d([tf.zeros([LEAD_IN_SAMPLES], 'float32'), tf.tensor(audio)]);

  return tf.expandDims(tf.signal.frame(wavSamples, WINDOW_SAMPLES, WINDOW_HOP, true, 0), -1);
}

/**
 * `Math.min(16, gl.MAX_TEXTURE_IMAGE_UNITS)` - 16 on any WebGL2 device, and
 * the size TF.js chunks a concat's inputs into.
 */
const MAX_TEXTURES_IN_SHADER = 16;

/**
 * Whether TF.js can build a shader for a concat of `inputs` tensors.
 *
 * `ConcatProgram` sizes its offsets array `new Array(shapes.length - 1)`, which
 * is empty for a single input; assigning `offsets[0]` grows it to one, so
 * `lastIndex` is 1 and the generated GLSL calls `getT1` while `variableNames`
 * declares only `T0`. Compilation then fails with
 * `'getT1' : no matching overloaded function found`. `Concat_impl` chunks by
 * `MAX_TEXTURES_IN_SHADER` and recurses, so a final chunk of exactly one
 * tensor reaches that program - and so does a *second-level* chunking of the
 * chunk results, which is why this recurses rather than testing `% 16 === 1`.
 */
function chunkedConcatCompiles(inputs: number): boolean {
  if (inputs === 1) return false;
  if (inputs <= MAX_TEXTURES_IN_SHADER) return true;

  const lastChunk = inputs % MAX_TEXTURES_IN_SHADER || MAX_TEXTURES_IN_SHADER;

  return lastChunk !== 1 && chunkedConcatCompiles(Math.ceil(inputs / MAX_TEXTURES_IN_SHADER));
}

/** The same, entered the way `tf.signal.frame` enters it. */
function libraryFramingCompiles(windows: number): boolean {
  // `tf.concat` clones a lone tensor rather than running a kernel, so one
  // window never reaches the broken program.
  return windows === 1 || chunkedConcatCompiles(windows);
}

/** Sample counts for 30 s to 300 s of audio, a tenth of a second apart. */
const SWEEP: number[] = [];
for (let tenths = 300; tenths <= 3000; tenths++) {
  SWEEP.push(Math.round((tenths / 10) * DETECTION_SAMPLE_RATE));
}

describe('windowCountFor', () => {
  it('counts windows the way tf.signal.frame does', () => {
    const disagreements = SWEEP.filter(
      samples => windowCountFor(samples) !== referenceWindowCount(samples)
    );

    expect(disagreements).toEqual([]);
  });

  it('counts the durations the failure was measured on', () => {
    // Straight from the reproduction. 209.7 s works and 209.8 s does not, and
    // nothing about the audio changed - only how many windows it cuts into.
    const measured: [number, number][] = [
      [209.7, 128],
      [209.8, 129],
      [212.0, 130],
      [237.0, 145],
      [480.0, 293]
    ];

    for (const [seconds, windows] of measured) {
      expect(windowCountFor(Math.round(seconds * DETECTION_SAMPLE_RATE)))
        .withContext(`${seconds} s`)
        .toBe(windows);
    }
  });

  it('reaches window counts the library cannot concatenate', () => {
    // Without this the specs below would be pinning a fix to a problem the
    // range never contains. A sixteenth of all song-length durations land on
    // a window count whose concat will not compile: 1.64 s of every 26.24 s.
    const broken = SWEEP.filter(samples => !libraryFramingCompiles(windowCountFor(samples)));

    expect(broken.length).toBeGreaterThan(0);
    expect(broken.length / SWEEP.length).toBeCloseTo(1 / 16, 2);
  });
});

describe('the window counts TF.js cannot concatenate', () => {
  it('is every count one over a multiple of sixteen', () => {
    for (const windows of [17, 33, 129, 145, 241]) {
      expect(libraryFramingCompiles(windows)).withContext(`${windows}`).toBe(false);
    }
    for (const windows of [1, 2, 16, 18, 128, 130, 293]) {
      expect(libraryFramingCompiles(windows)).withContext(`${windows}`).toBe(true);
    }
  });

  it('and a whole band more, which `N % 16 === 1` does not name', () => {
    // The chunk *results* are concatenated the same way, so the rule recurses.
    // 258 windows chunk into 17 results and those chunk into 16 + 1: a second
    // lone tensor, a second uncompilable shader. Seventeen counts in a row
    // fail that way - 257 through 273, roughly 7:00 to 7:29 of audio at
    // 22.05 kHz - and only the two ends of that run, 257 and 273, are ones
    // the simple rule names. This is the reason padding was not the fix:
    // padding one hop from 257 lands on 258, which is no better, and escaping
    // the band takes 17 hops, 27.9 s of silence.
    for (let windows = 257; windows <= 273; windows++) {
      expect(libraryFramingCompiles(windows)).withContext(`${windows}`).toBe(false);
    }
    for (let windows = 258; windows <= 272; windows++) {
      expect(windows % 16).withContext(`${windows}`).not.toBe(1);
    }

    expect(libraryFramingCompiles(256)).toBe(true);
    expect(libraryFramingCompiles(274)).toBe(true);
  });
});

describe('frameForModel', () => {
  beforeEach(() => tf.engine().startScope());
  afterEach(() => tf.engine().endScope());

  it('lays every window out exactly as the library does', () => {
    // Window counts the library can still manage, so the two are comparable:
    // one window, a couple, the full chunk of sixteen, and seventeen-plus-one
    // where TF.js concatenates in two chunks.
    const lengths = [
      1000,
      WINDOW_HOP,
      2 * WINDOW_HOP,
      16 * WINDOW_HOP - LEAD_IN_SAMPLES,
      18 * WINDOW_HOP - LEAD_IN_SAMPLES
    ];

    for (const length of lengths) {
      const audio = ramp(length);
      const expected = libraryFraming(audio).dataSync();
      const actual = frameForModel(audio).dataSync();

      expect(actual.length).withContext(`${length} samples`).toBe(expected.length);

      let differing = 0;
      let firstAt = -1;
      for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
          if (differing === 0) firstAt = i;
          differing++;
        }
      }

      expect(differing)
        .withContext(`${length} samples, first differing at index ${firstAt}`)
        .toBe(0);
    }
  });

  it('shapes the tensor the graph expects', () => {
    const audio = ramp(2 * WINDOW_HOP);

    expect(frameForModel(audio).shape).toEqual([3, WINDOW_SAMPLES, 1]);
  });

  it('frames a length whose window count the library cannot concatenate', () => {
    // Seventeen windows - 27.7 s of audio - is the smallest count that breaks
    // TF.js, and it breaks it for exactly the reason a 209.8 s file does: the
    // last chunk of the concat holds one tensor. This is the whole reason the
    // module exists, so it is asserted from both sides.
    const samples = 17 * WINDOW_HOP - LEAD_IN_SAMPLES;

    expect(windowCountFor(samples)).toBe(17);
    expect(libraryFramingCompiles(17)).toBe(false);

    expect(tf.getBackend())
      .withContext('needs the SwiftShader launcher in karma.conf.js, not stock ChromeHeadless')
      .toBe('webgl');
    // "Failed to compile fragment shader." out of TF.js, from the `getT1` the
    // generated GLSL calls and never declares.
    expect(() => libraryFraming(ramp(samples))).toThrow();

    expect(frameForModel(ramp(samples)).shape).toEqual([17, WINDOW_SAMPLES, 1]);
  });

  it('leads in with silence and pads the tail with silence', () => {
    const audio = ramp(WINDOW_HOP + 5);
    const framed = frameForModel(audio).dataSync();
    const windows = windowCountFor(audio.length);

    // The model's own lead-in, so the first window's output is trimmed like
    // every other window's.
    expect(nonZeroIn(framed, 0, LEAD_IN_SAMPLES)).toBe(-1);
    expect(framed[LEAD_IN_SAMPLES]).toBe(audio[0]);

    // The last window runs off the end of the audio, and everything past that
    // point is zero rather than stale, wrapped or a repeat of the last sample.
    const lastWindow = (windows - 1) * WINDOW_SAMPLES;
    const audioLeft = LEAD_IN_SAMPLES + audio.length - (windows - 1) * WINDOW_HOP;

    expect(audioLeft).toBeLessThan(WINDOW_SAMPLES);
    expect(framed[lastWindow + audioLeft - 1]).toBe(audio[audio.length - 1]);
    expect(nonZeroIn(framed, lastWindow + audioLeft, lastWindow + WINDOW_SAMPLES)).toBe(-1);
  });
});
