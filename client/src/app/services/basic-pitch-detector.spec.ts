import { DETECTION_SAMPLE_RATE } from './note-detector';
import { BasicPitchDetector } from './basic-pitch-detector';
import { GroundTruthNote, renderNotes } from './harmonic-eval/material';
import { DetectionResult } from './note-detector';
import { suppressHarmonics } from './transcription-harmonics';

/**
 * These are integration tests, not unit tests. They download the real model,
 * compile real WebGL shaders and run real inference, because there is nothing
 * useful left to assert about the adapter once the model is stubbed out — the
 * whole of it is the batch loop and the post-processing chain, and both are
 * only meaningful against genuine posteriorgrams.
 *
 * So detection runs **once**, in a `beforeAll`, and every spec reads that one
 * result. The first-run cost is model load plus a shader compile, which the
 * spike measured at 0.6-4.4 s on its own; the timeouts below are sized for a
 * cold GPU rather than for the 1 s the inference itself takes.
 *
 * The WebGL part of that is not free — stock ChromeHeadless has no GL context
 * and TF.js answers a missing one by silently running on the CPU backend, so
 * `karma.conf.js` shadows the launcher with a SwiftShader-backed one. Without
 * that these specs would pass while never touching the synchronous readback
 * the adapter is written around.
 *
 * What they assert is **recall, not precision**. Basic Pitch over-detects a
 * plucked bass line by design - across the sixteen captured accuracy fixtures
 * it returns 310 notes for 182 played, at 42.3 % precision - and turning that
 * back into the played line is `suppressHarmonics`' job, pinned against real
 * output in its own spec. Asserting a note count here would be asserting the
 * same thing twice, badly.
 */

const E1 = 28;
const A1 = 33;
const D2 = 38;
const G2 = 43;

const SPACING_SEC = 0.5;

/**
 * The line the fixture plays: open E, A, D and G on a bass, one every
 * `SPACING_SEC` and each left to ring for that long.
 *
 * Synthesised by `harmonic-eval/material.ts`'s Karplus-Strong string, which is
 * the same model the sixteen accuracy fixtures are captured from. This spec
 * used to carry its own `pluck` - four sinusoids, the `h`th damping `h` times
 * as fast as the fundamental - and so did `worker-detector.spec.ts`:
 * two copies of an assertion about strings that turns out to be false.
 * Measured on a string
 * model that asserts nothing of the kind, partials 1 through 8 of an E1 damp
 * at -20.0 to -20.7 dB/s, a spread of 0.7 dB/s across the whole series. The
 * suppression rule those fixtures were used to justify rested on exactly that
 * difference, which made the measurement circular; see
 * `transcription-harmonics.ts`.
 */
const PLAYED = [E1, A1, D2, G2];
const LINE: GroundTruthNote[] = PLAYED.map((pitch, index) => ({
  pitch,
  onsetSec: index * SPACING_SEC,
  durationSec: SPACING_SEC
}));

describe('BasicPitchDetector', () => {
  let result: DetectionResult;
  const progress: number[] = [];

  beforeAll(async () => {
    const detector = new BasicPitchDetector();
    const audio = renderNotes(LINE, DETECTION_SAMPLE_RATE);

    result = await detector.detect(audio, DETECTION_SAMPLE_RATE, fraction =>
      progress.push(fraction)
    );
  }, 120_000);

  it('finds every pitch that was played', () => {
    const detected = new Set(result.notes.map(note => note.pitch));

    for (const pitch of PLAYED) {
      expect(detected.has(pitch)).withContext(`MIDI ${pitch}`).toBe(true);
    }
  });

  it('puts each played note where it was struck', () => {
    PLAYED.forEach((pitch, index) => {
      const expected = index * SPACING_SEC;
      const onsets = result.notes
        .filter(note => note.pitch === pitch)
        .map(note => note.onsetSec);
      const nearest = onsets.reduce(
        (best, onset) =>
          Math.abs(onset - expected) < Math.abs(best - expected) ? onset : best,
        Infinity
      );

      // Measured on this audio: 23 ms, 34 ms, 22 ms, 26 ms - two, three and
      // two of the model's own 11.6 ms frames. The bound is set well clear of
      // that rather than just past it, because it is a property of a model on
      // a low register and not something this repository controls.
      expect(Math.abs(nearest - expected)).toBeLessThan(0.08);
    });
  });

  it('over-detects, which is what harmonic suppression is for', () => {
    // Not a count assertion — a floor. The spike measured 24 % precision on a
    // line like this one, and a detector that suddenly returned exactly four
    // notes would mean the chain below had stopped being exercised.
    expect(result.notes.length).toBeGreaterThan(PLAYED.length);
  });

  it('leaves the played line standing once the partials are suppressed', () => {
    // The end-to-end claim of the milestone's detection half, stated as
    // strongly as honest audio supports: raw audio in, and every note that was
    // played still there afterwards.
    //
    // Not `toEqual(PLAYED)`. That is what this spec asserted while it ran on
    // additive synthesis whose partials damped `h` times as fast as their
    // fundamentals, and it passed because the fixture agreed with the rule.
    // On a real string model suppression recovers the played line exactly on
    // one of sixteen materials and improves it on the rest;
    // `harmonic-eval/harmonic-accuracy.spec.ts` measures that at 61.2 %
    // precision and 70.3 % recall. Pinning an exact recovery here would be
    // pinning a thing that is not true of this algorithm.
    //
    // What this line cannot say, and a reader should not read into it: no two
    // of E1, A1, D2 and G2 are a partial's interval apart, so suppression has
    // no opportunity to destroy one of them however wrong it is. The two
    // halves below bracket it from the other side instead - one fails if
    // suppression removes a played pitch, the other if it stops removing
    // anything. The figures suppression really can destroy are `octaves`,
    // `leaps` and `slap` in `transcription-harmonics.spec.ts`.
    const kept = suppressHarmonics(result.notes);
    const pitches = new Set(kept.map(note => note.pitch));

    for (const pitch of PLAYED) {
      expect(pitches.has(pitch)).withContext(`MIDI ${pitch}`).toBe(true);
    }
    // ...and suppression is doing something, rather than passing this by
    // keeping everything the detector said.
    expect(kept.length).toBeLessThan(result.notes.length);
  });

  it('returns notes in onset order', () => {
    const onsets = result.notes.map(note => note.onsetSec);

    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
  });

  it('gives every note its own id', () => {
    expect(new Set(result.notes.map(note => note.id)).size).toBe(result.notes.length);
  });

  it('reports amplitudes usable as a confidence', () => {
    for (const note of result.notes) {
      expect(note.confidence).toBeGreaterThan(0);
      expect(note.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('ends every note after it starts', () => {
    for (const note of result.notes) expect(note.offsetSec).toBeGreaterThan(note.onsetSec);
  });

  it('states the frame rate its bends are sampled at', () => {
    // 22050 / 256. Nothing else can convert bendCents to bend points, and the
    // DetectedNote model deliberately does not record it.
    expect(result.bendFrameRateHz).toBeCloseTo(86.13, 2);
  });

  it('samples a bend once per frame of the note it belongs to', () => {
    for (const note of result.notes) {
      const frames = (note.offsetSec - note.onsetSec) * result.bendFrameRateHz;

      expect(note.bendCents.length).toBeGreaterThan(0);
      expect(Math.abs(note.bendCents.length - frames)).toBeLessThan(2);
    }
  });

  it('reports bends in cents, not in the contour bins the model emits', () => {
    // The model's bend output is an argmax over a contour grid three bins to
    // a semitone, so every value it can produce is a whole number of 100/3
    // cents. Handing those out raw as `bendCents` would understate a bend
    // 33-fold, and nothing downstream would notice.
    const centsPerBin = 100 / 3;

    for (const note of result.notes) {
      for (const cents of note.bendCents) {
        expect(Math.abs(cents / centsPerBin - Math.round(cents / centsPerBin))).toBeLessThan(
          1e-9
        );
      }
    }

    // ...and at least one note actually bends, or the check above is vacuous.
    expect(result.notes.some(note => note.bendCents.some(cents => cents !== 0))).toBe(true);
  });

  it('runs progress from nothing to done', () => {
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('refuses audio that is not at the rate the model was trained on', async () => {
    // The real model URL, not a stub one: `BasicPitch` starts the load in its
    // constructor and nothing here awaits it, so a URL that 404s would leave
    // an unhandled rejection behind. The rate check runs before the model is
    // touched, so this costs a cached fetch and no inference.
    const detector = new BasicPitchDetector();

    await expectAsync(
      detector.detect(new Float32Array(1024), 44100, () => undefined)
    ).toBeRejectedWithError(/22050/);
  });
});
