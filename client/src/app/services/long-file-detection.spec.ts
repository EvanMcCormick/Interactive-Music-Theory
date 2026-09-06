/**
 * The reported failure, end to end, at the length it was reported at.
 *
 * A user's 209.8 s stem died about a second into detection with "The detection
 * worker failed." and no progress at all. It was not the stem: at 22.05 kHz
 * that length cuts into **129** model windows, and `tf.signal.frame`'s concat
 * of 129 tensors chunks into eight groups of sixteen plus one group of *one*,
 * which TF.js 3.21 compiles into a shader calling an undeclared `getT1`.
 * `detection-framing.ts` says the rest.
 *
 * `detection-framing.spec.ts` covers the same defect in a second, at the
 * smallest window count that triggers it, and that is the spec to read.
 * This one exists because it is the only place the *whole* pipeline - framing,
 * 129 batches of inference, the trim, `outputToNotesPoly` - is run at a real
 * song's length, and because "we fixed it at 17 windows" is not the claim the
 * bug report makes.
 *
 * ## Not in the default suite
 *
 * Three and a half minutes of synthesis and 129 WebGL inference batches, in
 * one `it`. Karma's `browserNoActivityTimeout` is 30 s and a browser busy for
 * longer is indistinguishable from a dead one, which is the same reason
 * `harmonic-capture.spec.ts` is excluded; both are reached through a
 * configuration that swaps in `karma.capture.conf.js` and its raised budgets.
 * Excluded by an `exclude` glob on the `test` target in `angular.json`, not by
 * being renamed, so `tsconfig.spec.json` still type-checks it every run.
 *
 * Run it when the framing, the inference loop or the TF.js version changes:
 *
 *     npm test -- --configuration=longform --watch=false
 */

import { BasicPitchDetector } from './basic-pitch-detector';
import { LEAD_IN_SAMPLES, WINDOW_HOP, WINDOW_SAMPLES, windowCountFor } from './detection-framing';
import { GroundTruthNote, renderNotes } from './harmonic-eval/material';
import { DETECTION_SAMPLE_RATE } from './note-detector';

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

/** The reported length, to the tenth of a second the reproduction used. */
const SECONDS = 209.8;

/** The window count that reported length produces, and the whole point. */
const BROKEN_WINDOW_COUNT = 129;

/** A bass line, tiled to fill `sampleCount` samples. */
function longBassline(sampleCount: number): Float32Array {
  const pitches = [28, 33, 38, 43, 45, 40, 35, 31];
  const bar: GroundTruthNote[] = pitches.map((pitch, index) => ({
    pitch,
    onsetSec: index * 0.5,
    durationSec: 0.5
  }));
  const tile = renderNotes(bar, DETECTION_SAMPLE_RATE);
  const audio = new Float32Array(sampleCount);

  for (let at = 0; at < sampleCount; at += tile.length) {
    audio.set(tile.subarray(0, Math.min(tile.length, sampleCount - at)), at);
  }

  return audio;
}

describe('detection at a song length', () => {
  it('transcribes a file whose window count used to break the shader compiler', async () => {
    const samples = Math.round(SECONDS * DETECTION_SAMPLE_RATE);

    // The reproduction, restated as arithmetic before a single sample is
    // synthesised: this length is the one that fails, and it fails because of
    // its length alone.
    expect(windowCountFor(samples)).toBe(BROKEN_WINDOW_COUNT);
    expect(BROKEN_WINDOW_COUNT % 16).toBe(1);
    expect(LEAD_IN_SAMPLES + samples).toBeGreaterThan(128 * WINDOW_HOP);
    expect(WINDOW_SAMPLES).toBe(43844);

    const audio = longBassline(samples);
    const progress: number[] = [];
    const startedAt = performance.now();

    const result = await new BasicPitchDetector().detect(audio, DETECTION_SAMPLE_RATE, fraction =>
      progress.push(fraction)
    );

    const elapsed = (performance.now() - startedAt) / 1000;
    log(
      `LONGFORM ${SECONDS} s  ${BROKEN_WINDOW_COUNT} windows  ` +
        `${result.notes.length} notes  ${elapsed.toFixed(1)} s`
    );

    // The failure this replaces was not a wrong answer, it was no answer: the
    // run died inside framing, before the first batch, so the progress bar
    // never moved off zero.
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(result.notes.length).toBeGreaterThan(0);

    // Notes are found across the whole file, not only in the windows before
    // the one that used to break - a trim computed from the wrong length
    // would show up here as output that stops early.
    const last = result.notes.reduce((latest, note) => Math.max(latest, note.onsetSec), 0);
    expect(last).toBeGreaterThan(SECONDS - 5);
  }, 600_000);
});
