import { GroundTruthNote, renderNotes } from './harmonic-eval/material';
import { DETECTION_SAMPLE_RATE } from './note-detector';
import { DetectionResult } from './note-detector';
import { suppressHarmonics } from './transcription-harmonics';
import { WorkerDetector } from './worker-detector';

/**
 * A `Worker` that does nothing but let a spec dispatch events at it.
 *
 * Everything else in this file wants a real worker and says why. The specs at
 * the bottom cannot use one: the two failures they tell apart are *a module
 * that would not load* and *a module that threw*, and a real worker cannot be
 * made to do the first on demand - its URL is fixed at build time and the
 * module is known to load. What distinguishes them is only which event the
 * browser dispatches, and an event is dispatchable.
 */
class StubWorker extends EventTarget {
  static instances: StubWorker[] = [];

  /** The worker `WorkerDetector` most recently constructed. */
  static get last(): StubWorker {
    const worker = StubWorker.instances[StubWorker.instances.length - 1];
    if (!worker) throw new Error('No stub worker has been constructed.');

    return worker;
  }

  /** Swallowed: nothing answers, and the spec settles the detection itself. */
  postMessage(): void {
    return;
  }

  terminate(): void {
    return;
  }

  constructor() {
    super();
    StubWorker.instances.push(this);
  }
}

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

const SPACING_SEC = 0.5;

/**
 * The line the fixture plays: open E, A, D and G on a bass, one every
 * `SPACING_SEC` and each left to ring for that long.
 *
 * Synthesised by `harmonic-eval/material.ts`'s Karplus-Strong string, which is
 * the same model the sixteen accuracy fixtures are captured from. This spec
 * used to carry its own `pluck` - four sinusoids, the `h`th damping `h` times
 * as fast as the fundamental - and so did `basic-pitch-detector.spec.ts`:
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

/** `pitches` played in turn, for the lifecycle specs that need a fresh buffer. */
function bassline(pitches: number[]): Float32Array {
  return renderNotes(
    pitches.map((pitch, index) => ({
      pitch,
      onsetSec: index * SPACING_SEC,
      durationSec: SPACING_SEC
    })),
    DETECTION_SAMPLE_RATE
  );
}

describe('WorkerDetector', () => {
  const detector = new WorkerDetector();
  const progress: number[] = [];
  let result: DetectionResult;
  let audio: Float32Array;
  let mainThreadTicks = 0;

  beforeAll(async () => {
    audio = renderNotes(LINE, DETECTION_SAMPLE_RATE);

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

  it('leaves the played line standing once the partials are suppressed', () => {
    // The same end-to-end claim `basic-pitch-detector.spec.ts` makes, made
    // again across the worker boundary: what comes back through `postMessage`
    // is not a lossy copy of what the detector produced. See that spec for why
    // this is a containment rather than an equality.
    const kept = suppressHarmonics(result.notes);
    const pitches = new Set(kept.map(note => note.pitch));

    for (const pitch of PLAYED) {
      expect(pitches.has(pitch)).withContext(`MIDI ${pitch}`).toBe(true);
    }
    expect(kept.length).toBeLessThan(result.notes.length);
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

describe('WorkerDetector error reporting', () => {
  let detector: WorkerDetector;
  let realWorker: typeof Worker;

  beforeEach(() => {
    StubWorker.instances = [];
    realWorker = globalThis.Worker;
    // A stub only has to satisfy the three members `WorkerDetector` touches -
    // the constructor, `postMessage` and `terminate` - so it is cast rather
    // than made to implement the whole of `Worker`.
    globalThis.Worker = StubWorker as unknown as typeof Worker;
    detector = new WorkerDetector();
  });

  afterEach(() => {
    globalThis.Worker = realWorker;
  });

  /** Starts a detection and hands the worker `event` instead of an answer. */
  function detectionFailingWith(event: Event): Promise<DetectionResult> {
    const running = detector.detect(new Float32Array(64), DETECTION_SAMPLE_RATE, () => undefined);

    StubWorker.last.dispatchEvent(event);

    return running;
  }

  it('says the worker never loaded when the browser reports a bare event', async () => {
    // Measured in Chrome: a worker whose script 404s dispatches a plain
    // `Event` - not an `ErrorEvent` - with no `message`, `filename` or
    // `lineno` at all. Every failure raised *inside* a running worker arrives
    // as a real `ErrorEvent` carrying text. Reporting one generic string for
    // both sent a user hunting their audio for a fault in the bundle.
    await expectAsync(detectionFailingWith(new Event('error'))).toBeRejectedWithError(
      /could not be loaded/
    );
  });

  it('does not blame the audio for a worker that never loaded', async () => {
    // The whole point of separating the two. A chunk that did not load is
    // file-independent, so "try a different file" is advice that cannot work
    // and the message has to say so.
    await expectAsync(detectionFailingWith(new Event('error'))).toBeRejectedWithError(
      /not in the audio/
    );
  });

  it('reads an ErrorEvent with no message as a load failure too', async () => {
    // Firefox and Safari answer a worker script that would not load with an
    // `ErrorEvent` whose `message` is empty rather than with a bare `Event`.
    // The distinction that matters is whether there is anything to report,
    // not which constructor the browser reached for.
    await expectAsync(
      detectionFailingWith(new ErrorEvent('error', { message: '' }))
    ).toBeRejectedWithError(/could not be loaded/);
  });

  it('repeats what the worker said when the worker itself failed', async () => {
    // The other half: a live worker that threw knows more about the failure
    // than this class ever will, so its text is passed through unaltered.
    await expectAsync(
      detectionFailingWith(new ErrorEvent('error', { message: 'Uncaught Error: boom from worker' }))
    ).toBeRejectedWithError('Uncaught Error: boom from worker');
  });

  it('clears the detection so a later one can run', async () => {
    await expectAsync(detectionFailingWith(new Event('error'))).toBeRejected();

    expect(detector.busy).toBe(false);
  });
});
