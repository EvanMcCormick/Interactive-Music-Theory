/// <reference lib="webworker" />

/**
 * Runs note detection off the main thread.
 *
 * Two separate things make this a worker rather than a call:
 *
 * 1. **The UI must stay alive.** Inference is a tight loop of GPU dispatches
 *    with a synchronous readback after each one (see `BasicPitchDetector` for
 *    why the readback is synchronous). On the main thread that loop blocks
 *    paint and input for as long as it runs - single-digit seconds for a
 *    four-minute stem, and there is a progress bar that is supposed to move
 *    during exactly that window.
 * 2. **TF.js must stay out of the main bundle.** `@spotify/basic-pitch` drags
 *    in TF.js 3.21 and its WebGL backend, which is about a megabyte. Reaching
 *    it *only* through `new Worker(new URL(...))` is what makes the bundler
 *    put it in a chunk of its own instead of in `main.js`: measured, 714 kB
 *    main plus a 1.05 MB worker chunk, against 1.76 MB of main bundle when
 *    the same import is reachable from `main.ts`.
 *
 * The second one is a constraint on the *import graph*, not just on this file:
 * nothing on the main thread may import `basic-pitch-detector.ts`, or the
 * megabyte lands in `main.js` as well as in the worker. `worker-detector.ts`
 * is careful to import only types from here for that reason.
 *
 * ## Protocol
 *
 * In: one `DetectionRequest` per detection. Out: an `environment` message,
 * then `progress` repeatedly, then exactly one of `done` or `error`.
 *
 * One request at a time. The worker does not police that - `WorkerDetector`
 * does, on the main thread, where it can reject the second caller before it
 * has given up ownership of its audio buffer.
 */

import * as tf from '@tensorflow/tfjs';

import { BasicPitchDetector } from '../services/basic-pitch-detector';
import { DetectionResult } from '../services/note-detector';

/**
 * What the main thread posts in.
 *
 * `audio` arrives by **transfer**, not by copy: the caller's `Float32Array` is
 * detached the moment it is posted. A four-minute stem is 21 MB, and copying
 * it costs both the copy and a second 21 MB live at once.
 */
export interface DetectionRequest {
  audio: Float32Array;
  sampleRate: number;
}

/**
 * Proof that this module is doing what it was written to do, reported once per
 * detection.
 *
 * Neither field is decoration. A worker module that quietly ended up running
 * on the main thread would pass every functional test in the suite while
 * delivering none of the reason this file exists, and TF.js answers a missing
 * WebGL context by falling back to its CPU backend - which is roughly 100x
 * slower and, on some paths, differently behaved - without raising anything a
 * caller can see.
 */
export interface WorkerEnvironment {
  /** True when there is no `window`, i.e. this really is off the main thread. */
  offMainThread: boolean;
  /** Global scope's constructor name, e.g. `DedicatedWorkerGlobalScope`. */
  globalScope: string;
  /** The TF.js backend actually in use: `webgl` when all is well, else `cpu`. */
  backend: string;
}

export type DetectionResponse =
  | { type: 'environment'; environment: WorkerEnvironment }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: DetectionResult }
  | { type: 'error'; message: string };

/**
 * Created on the first request rather than at module load.
 *
 * Constructing it starts the model fetch, and a fetch that fails before anyone
 * is awaiting it becomes an unhandled rejection with no route back to the
 * caller. Deferring it to inside `run`'s try/catch turns a bad model URL into
 * an `error` message like any other failure. The instance is then kept: the
 * model download and the WebGL shader compiles are the expensive part of the
 * first detection and neither should be paid twice.
 */
let detector: BasicPitchDetector | null = null;

addEventListener('message', (event: MessageEvent<DetectionRequest>) => {
  void run(event.data);
});

async function run(request: DetectionRequest): Promise<void> {
  try {
    post({ type: 'environment', environment: await describeEnvironment() });

    detector ??= new BasicPitchDetector();
    const result = await detector.detect(request.audio, request.sampleRate, fraction =>
      post({ type: 'progress', fraction })
    );

    post({ type: 'done', result });
  } catch (error) {
    // Errors do not survive `postMessage` usefully - a structured-cloned Error
    // loses its prototype in some engines and its stack in all of them - so the
    // message crosses as a string and `WorkerDetector` builds a fresh Error
    // around it on the other side.
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * `tf.ready()` is what settles the backend choice; before it resolves,
 * `getBackend()` can still report the registered default rather than the one
 * that actually initialised.
 */
async function describeEnvironment(): Promise<WorkerEnvironment> {
  await tf.ready();

  return {
    // Absence of `window` rather than `self instanceof WorkerGlobalScope`: the
    // check has to be meaningful even when this module has been bundled into
    // the main thread by mistake, which is the case it exists to catch, and
    // `WorkerGlobalScope` is not defined there to compare against. It is
    // spelt as a property test because `typeof window` does not compile at
    // all under `"lib": [..., "webworker"]` - which is itself half the
    // answer, and the wrong half to rely on, since the app's own tsconfig
    // still sees this file with the DOM lib loaded.
    offMainThread: !('window' in globalThis),
    globalScope: self.constructor.name,
    backend: tf.getBackend()
  };
}

/** Typed `postMessage`, so a malformed response is a compile error. */
function post(response: DetectionResponse): void {
  postMessage(response);
}
