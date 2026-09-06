import { DETECTION_SAMPLE_RATE } from './note-detector';
import { DetectionResult } from './note-detector';
import { suppressHarmonics } from './transcription-harmonics';
import { WorkerDetector } from './worker-detector';

/**
 * Integration tests, like `basic-pitch-detector.spec.ts`: a real worker, the
 * real model fetched over HTTP from inside it, real WebGL shaders and real
 * inference. There is nothing worth asserting about a stubbed worker, because
 * everything this class exists to be right about - that the module really runs
 * off the main thread, that a root-relative asset URL resolves from a worker
 * context, that TF.js finds a GPU there - is only true or false against the
 * real thing.
 *
 * Two consequences. They are **slow**, so every spec that runs inference gets
 * an explicit Jasmine timeout sized for a cold worker: model download plus a
 * shader compile the spike measured at 0.6-4.4 s on its own. And they need a
 * browser with a GL context, which stock ChromeHeadless is not - `karma.conf.js`
 * shadows the launcher with a SwiftShader-backed one, and without it
 * `reports the backend it is actually running on` fails rather than passing
 * vacuously.
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
 * One plucked bass note: fundamental plus three harmonics, each damping `h`
 * times as fast - which is not what a string does. See the same function in
 * `basic-pitch-detector.spec.ts` for the measurement that says so and for why
 * the spec below is left failing rather than repaired.
 */
function pluck(midi: number, seconds: number, rate: number): Float32Array {
  const frames = Math.round(seconds * rate);
  const out = new Float32Array(frames);
  const f0 = midiToHz(midi);

  for (let i = 0; i < frames; i++) {
    const t = i / rate;
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
function bassline(pitches: number[]): Float32Array {
  const stride = Math.round(SPACING_SEC * DETECTION_SAMPLE_RATE);
  const out = new Float32Array(pitches.length * stride);

  pitches.forEach((pitch, index) =>
    out.set(pluck(pitch, SPACING_SEC, DETECTION_SAMPLE_RATE), index * stride)
  );

  return out;
}

describe('WorkerDetector', () => {
  const detector = new WorkerDetector();
  const progress: number[] = [];
  let result: DetectionResult;
  let audio: Float32Array;
  let mainThreadTicks = 0;

  beforeAll(async () => {
    audio = bassline(PLAYED);

    // A 10 ms interval that keeps counting only if the main thread is free to
    // run it. This is the claim the whole task rests on and the one thing a
    // functional assertion cannot make: inference on the main thread would
    // block this timer for as long as it ran.
    const ticker = setInterval(() => mainThreadTicks++, 10);
    try {
      result = await detector.detect(audio, DETECTION_SAMPLE_RATE, fraction =>
        progress.push(fraction)
      );
    } finally {
      clearInterval(ticker);
    }
  }, 120_000);

  afterAll(() => detector.terminate());

  it('runs the detector off the main thread', () => {
    // Reported by the worker about itself. A build that inlined the module
    // into the main bundle, or a fallback that quietly ran it here, would
    // still pass every functional spec below.
    expect(detector.lastEnvironment?.offMainThread).toBe(true);
    expect(detector.lastEnvironment?.globalScope).toBe('DedicatedWorkerGlobalScope');
  });

  it('reports the backend it is actually running on', () => {
    // TF.js answers a missing GL context by falling back to CPU, which is
    // ~100x slower and unusable for a full song, and says nothing when it
    // does. If this fails, look at the launcher flags before the code.
    expect(detector.lastEnvironment?.backend).toBe('webgl');
  });

  it('leaves the main thread free while it works', () => {
    expect(mainThreadTicks).toBeGreaterThan(10);
  });

  it('loads the model from inside the worker', () => {
    // `/basic-pitch-model/model.json` is root-relative, and a worker resolves
    // it against its own script URL rather than the page's. Notes coming back
    // at all is the proof that it resolved: no model, no notes.
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('finds every pitch that was played', () => {
    const detected = new Set(result.notes.map(note => note.pitch));

    for (const pitch of PLAYED) {
      expect(detected.has(pitch)).withContext(`MIDI ${pitch}`).toBe(true);
    }
  });

  it('recovers the played line once the partials are suppressed', () => {
  // KNOWN RED since the partial branch moved from a duration ratio to
  // `partialConfidenceRatio`. The audio this fixture is detected from gives
  // partial `h` a decay rate `h` times the fundamental's, which builds the old
  // rule's premise into the signal; measured on a string model that asserts
  // nothing of the kind, partials 1-8 of an E1 damp within 0.7 dB/s of each
  // other. See `transcription-harmonics.spec.ts`'s docblock. Left failing on
  // purpose until Task 5 rebuilds the fixture; do not re-pin it.
    // The same end-to-end claim `basic-pitch-detector.spec.ts` makes, made
    // again across the worker boundary: what comes back through `postMessage`
    // is not a lossy copy of what the detector produced.
    expect(suppressHarmonics(result.notes).map(note => note.pitch)).toEqual(PLAYED);
  });

  it('carries the bend frame rate across the boundary', () => {
    expect(result.bendFrameRateHz).toBeCloseTo(86.13, 2);
  });

  it('carries bend arrays across the boundary', () => {
    // Structured clone drops nothing, but a protocol that posted only the
    // scalar fields would still satisfy every other spec here.
    expect(result.notes.some(note => note.bendCents.length > 0)).toBe(true);
  });

  it('relays progress from nothing to done', () => {
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('takes ownership of the audio it is given', () => {
    // Documented, and worth pinning: the buffer is transferred, not copied, so
    // the caller's view is detached on return. 21 MB for a four-minute stem is
    // worth a caller having to know this.
    expect(audio.length).toBe(0);
  });

  it('refuses a second detection while one is running, without taking its audio', async () => {
    const first = detector.detect(bassline([E1]), DETECTION_SAMPLE_RATE, () => undefined);
    const second = bassline([A1]);

    await expectAsync(
      detector.detect(second, DETECTION_SAMPLE_RATE, () => undefined)
    ).toBeRejectedWithError(/already running/);

    // A rejected call must not have cost the caller its audio, or a caller who
    // waits and retries has nothing left to retry with.
    expect(second.length).toBeGreaterThan(0);

    await first;
  }, 120_000);

  it('reports a failure inside the worker as a rejection', async () => {
    // The rate check in `BasicPitchDetector` throws before the model is
    // touched, which is the cheapest real error the worker can raise.
    await expectAsync(
      detector.detect(new Float32Array(1024), 44100, () => undefined)
    ).toBeRejectedWithError(/22050/);
  }, 120_000);

  it('rejects rather than hangs when the audio it is handed is already detached', async () => {
    // The direct consequence of transferring: passing the same Float32Array a
    // second time is a DataCloneError out of `postMessage`, thrown after the
    // detection has been recorded as pending. Unhandled, that is a promise
    // nobody ever settles.
    await expectAsync(
      detector.detect(audio, DETECTION_SAMPLE_RATE, () => undefined)
    ).toBeRejectedWithError(/detached/);

    expect(detector.busy).toBe(false);
  }, 120_000);

  it('recovers after a failure', async () => {
    // The pending detection is cleared when it rejects rather than left behind
    // to make every later call look concurrent.
    expect(detector.busy).toBe(false);

    const after = await detector.detect(bassline([E1]), DETECTION_SAMPLE_RATE, () => undefined);

    expect(after.notes.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('WorkerDetector lifecycle', () => {
  let detector: WorkerDetector;

  beforeEach(() => {
    detector = new WorkerDetector();
  });

  afterEach(() => detector.terminate());

  it('rejects the detection in flight when it is terminated', async () => {
    const running = detector.detect(bassline(PLAYED), DETECTION_SAMPLE_RATE, () => undefined);

    detector.terminate();

    // The failure mode this replaces is not an error, it is a promise that
    // never settles: the worker that owed the answer no longer exists.
    await expectAsync(running).toBeRejectedWithError(/terminated/);
  }, 120_000);

  it('starts a fresh worker for the next detection after a terminate', async () => {
    detector.terminate();

    const result = await detector.detect(bassline([E1]), DETECTION_SAMPLE_RATE, () => undefined);

    expect(result.notes.length).toBeGreaterThan(0);
    expect(detector.lastEnvironment?.offMainThread).toBe(true);
  }, 120_000);

  it('does nothing when terminated twice', () => {
    expect(() => {
      detector.terminate();
      detector.terminate();
    }).not.toThrow();
  });
});
