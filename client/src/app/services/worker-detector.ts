/**
 * `NoteDetector` that runs the real detector in a Web Worker.
 *
 * This is the main-thread half of `detection.worker.ts`: it owns the worker,
 * marshals one detection at a time across `postMessage`, and turns the
 * worker's message stream back into the promise-plus-callback shape the
 * `NoteDetector` interface promises. Callers cannot tell it from
 * `BasicPitchDetector` except that it does not freeze the page.
 *
 * ## Why the import of the worker module is type-only
 *
 * The whole bundling benefit - TF.js in a 1.05 MB chunk of its own rather than
 * in a 1.76 MB main bundle - depends on the worker module being reachable
 * *only* through `new Worker(new URL(...))`. A value import of
 * `detection.worker.ts` here, however incidental, would pull TF.js into the
 * main graph as well and quietly undo it. Hence `import type`, which the
 * compiler erases entirely.
 *
 * ## Lifecycle
 *
 * The worker is created on the first `detect` and kept, because a fresh one
 * pays for the model download and the WebGL shader compiles again.
 * `terminate` disposes it and rejects anything in flight; a later `detect`
 * starts a new one, so `terminate` is "cancel and release", not a one-way
 * door. Concurrent `detect` calls are rejected rather than queued - one worker
 * cannot interleave two inferences, and which of two files a caller wants is
 * not a decision this class should be making.
 */

import type {
  DetectionRequest,
  DetectionResponse,
  WorkerEnvironment
} from '../workers/detection.worker';
import { DetectionResult, NoteDetector } from './note-detector';

interface PendingDetection {
  resolve: (result: DetectionResult) => void;
  reject: (error: Error) => void;
  onProgress: (fraction: number) => void;
}

export class WorkerDetector implements NoteDetector {
  private worker: Worker | null = null;
  private pending: PendingDetection | null = null;
  private environment: WorkerEnvironment | null = null;

  /**
   * Where the last detection actually ran, or null before the first one.
   *
   * Diagnostic, and worth surfacing: the difference between the WebGL backend
   * and the CPU fallback is roughly two orders of magnitude, and nothing else
   * in the pipeline reports which one it got.
   */
  get lastEnvironment(): WorkerEnvironment | null {
    return this.environment;
  }

  /** True while a detection is in flight, so a caller can avoid the rejection below. */
  get busy(): boolean {
    return this.pending !== null;
  }

  /**
   * Detects the notes in `audio`.
   *
   * **`audio` is given away, not lent.** Its buffer is transferred to the
   * worker, which detaches it here: on return `audio.length` is 0 and reading
   * it yields nothing. This mirrors `decodeToMono`, whose output is the
   * natural thing to pass in and which the caller has no other use for. A copy
   * would cost 21 MB of allocation and 21 MB of duplicate residency on a
   * four-minute stem, twice over the wire.
   *
   * The one case where the buffer is *not* taken is a rejected call - a
   * concurrent one, or a missing `Worker` - which rejects before posting, so
   * a caller who retries still has their audio.
   */
  detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void
  ): Promise<DetectionResult> {
    return new Promise<DetectionResult>((resolve, reject) => {
      if (this.pending) {
        reject(
          new Error('This detector is already running a detection; wait for it or terminate it.')
        );

        return;
      }

      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));

        return;
      }

      this.pending = { resolve, reject, onProgress };

      const request: DetectionRequest = { audio, sampleRate };
      // A view onto a SharedArrayBuffer is not transferable and must not be
      // detached anyway, so it goes by copy. Everything `decodeToMono`
      // produces is a plain ArrayBuffer and takes the fast path.
      const transfer: Transferable[] =
        audio.buffer instanceof ArrayBuffer ? [audio.buffer] : [];

      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        // Reachable, and not exotic: handing back a buffer that has already
        // been transferred - the same `Float32Array` twice - is a DataCloneError
        // here. `this.pending` is already set at this point, so without this
        // the caller would wait on a worker that was never asked anything.
        this.settle(pending =>
          pending.reject(error instanceof Error ? error : new Error(String(error)))
        );
      }
    });
  }

  /**
   * Disposes the worker, rejecting any detection still running.
   *
   * Call it from `ngOnDestroy`. Rejecting rather than leaving the promise
   * dangling is the whole point: a caller awaiting a detection whose worker
   * has been killed would otherwise wait for a message that can never arrive.
   */
  terminate(): void {
    this.dispose();
    this.settle(pending =>
      pending.reject(new Error('Detection was cancelled: the worker was terminated.'))
    );
  }

  /** Kills the worker without touching the pending detection. */
  private dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    if (typeof Worker === 'undefined') {
      throw new Error('This environment has no Web Worker support, so detection cannot run.');
    }

    const worker = new Worker(new URL('../workers/detection.worker', import.meta.url));

    worker.addEventListener('message', (event: MessageEvent<DetectionResponse>) =>
      this.receive(event.data)
    );

    // An `error` here is one the worker did not catch - most often a failure
    // to load or parse the worker module at all, which happens before any of
    // its own error handling exists. The worker is discarded as well as the
    // detection rejected, because a module that would not load will not load
    // on the next request either, and posting into it would hang instead of
    // failing. `messageerror` - a response that could not be deserialised -
    // leaves a healthy worker behind, so only the detection is lost.
    worker.addEventListener('error', event => {
      // Identity-checked: an event already queued when `terminate` ran would
      // otherwise arrive after a replacement worker had been created and kill
      // that one instead.
      if (this.worker === worker) this.dispose();
      this.settle(pending =>
        pending.reject(new Error(event.message || 'The detection worker failed.'))
      );
    });
    worker.addEventListener('messageerror', () =>
      this.settle(pending =>
        pending.reject(new Error('The detection worker sent a message that could not be read.'))
      )
    );

    this.worker = worker;

    return worker;
  }

  private receive(response: DetectionResponse): void {
    // Recorded whether or not anything is waiting, and outside the switch
    // below, because it describes the worker rather than the detection.
    if (response.type === 'environment') {
      this.environment = response.environment;

      return;
    }

    const pending = this.pending;
    if (!pending) return;

    switch (response.type) {
      case 'progress':
        pending.onProgress(response.fraction);
        break;
      case 'done':
        this.settle(detection => detection.resolve(response.result));
        break;
      case 'error':
        this.settle(detection => detection.reject(new Error(response.message)));
        break;
    }
  }

  /**
   * Clears the pending detection *before* settling it, so that a handler which
   * synchronously starts another detection is not told one is already running.
   */
  private settle(finish: (pending: PendingDetection) => void): void {
    const pending = this.pending;
    if (!pending) return;

    this.pending = null;
    finish(pending);
  }
}
