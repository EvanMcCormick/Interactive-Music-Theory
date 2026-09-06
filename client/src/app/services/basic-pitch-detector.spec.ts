import { DETECTION_SAMPLE_RATE } from './note-detector';
import { BasicPitchDetector } from './basic-pitch-detector';
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
 * plucked bass line roughly fourfold by design, and turning that back into the
 * played line is `suppressHarmonics`' job, pinned against real output in its
 * own spec. Asserting a note count here would be asserting the same thing
 * twice, badly.
 */

const E1 = 28;
const A1 = 33;
const D2 = 38;
const G2 = 43;

/** The line the fixture plays: open E, A, D and G on a bass. */
const PLAYED = [E1, A1, D2, G2];
const SPACING_SEC = 0.5;

const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * One plucked bass note.
 *
 * Fundamental plus 2nd, 3rd and 4th harmonics, each quieter than the one below
 * it and each damping `h` times as fast.
 *
 * The first of those is what a real string does. **The second is not**, and
 * this comment used to claim it was. Measured on a Karplus-Strong string,
 * where per-partial decay comes out of a loop filter rather than out of a
 * typed-in exponent, partials 1 through 8 of an E1 damp at -20.0 to -20.7
 * dB/s: a spread of 0.7 dB/s, not a factor of eight. What actually differs
 * between a partial and its fundamental is where it *starts* - 8 to 35 dB
 * lower - so it crosses the detector's frame threshold sooner and is reported
 * as a shorter note.
 *
 * That mattered, because `suppressHarmonics` used to arbitrate partials on
 * exactly the property this synthesis asserts. It no longer does; see
 * `transcription-harmonics.ts`. This audio is left as it is rather than
 * quietly fixed, because a spec below still fails on it and the failure is
 * the record.
 */
function pluck(midi: number, seconds: number, rate: number): Float32Array {
  const frames = Math.round(seconds * rate);
  const out = new Float32Array(frames);
  const f0 = midiToHz(midi);

  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    // 1 ms of attack and 20 ms of release. A bare step at either end would put
    // a broadband click there, and a click is exactly what an onset detector
    // is built to notice.
    const envelope = Math.min(1, t / 0.001, (seconds - t) / 0.02);

    let sample = 0;
    for (let h = 1; h <= 4; h++) {
      sample += (1 / h) * Math.exp(-2.5 * h * t) * Math.sin(2 * Math.PI * f0 * h * t);
    }

    out[i] = envelope * sample * 0.4;
  }

  return out;
}

/** `pitches` played in turn, one every `SPACING_SEC`. */
function bassline(pitches: number[], rate: number): Float32Array {
  const stride = Math.round(SPACING_SEC * rate);
  const out = new Float32Array(pitches.length * stride);

  pitches.forEach((pitch, index) => out.set(pluck(pitch, SPACING_SEC, rate), index * stride));

  return out;
}

describe('BasicPitchDetector', () => {
  let result: DetectionResult;
  const progress: number[] = [];

  beforeAll(async () => {
    const detector = new BasicPitchDetector();
    const audio = bassline(PLAYED, DETECTION_SAMPLE_RATE);

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

      // Measured, on this fixture: 0 ms, 47 ms, 25 ms, 14 ms. The spike put
      // the error at 10-25 ms and the A1 here is twice that, so the bound is
      // set well clear of what was actually observed rather than just past it.
      expect(Math.abs(nearest - expected)).toBeLessThan(0.08);
    });
  });

  it('over-detects, which is what harmonic suppression is for', () => {
    // Not a count assertion — a floor. The spike measured 24 % precision on a
    // line like this one, and a detector that suddenly returned exactly four
    // notes would mean the chain below had stopped being exercised.
    expect(result.notes.length).toBeGreaterThan(PLAYED.length);
  });

  it('recovers the played line once the partials are suppressed', () => {
    // The end-to-end claim of the milestone's detection half: raw audio in,
    // the notes actually played out.
  // KNOWN RED since the partial branch moved from a duration ratio to
  // `partialConfidenceRatio`. The audio this fixture is detected from gives
  // partial `h` a decay rate `h` times the fundamental's, which builds the old
  // rule's premise into the signal; measured on a string model that asserts
  // nothing of the kind, partials 1-8 of an E1 damp within 0.7 dB/s of each
  // other. See `transcription-harmonics.spec.ts`'s docblock. Left failing on
  // purpose until Task 5 rebuilds the fixture; do not re-pin it.
    expect(suppressHarmonics(result.notes).map(note => note.pitch)).toEqual(PLAYED);
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
