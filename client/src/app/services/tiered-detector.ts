/**
 * The one place the two tiers meet: server when signed in, browser when not,
 * and browser again when the server lets us down.
 *
 * ## The tier line, as code
 *
 * A seat gets `RemoteDetector` — a bigger machine, no WebGL, and 1.81 s against
 * the browser's 15 s. An anonymous visitor gets `WorkerDetector`, which is the
 * same product with a different `NoteDetector`: everything downstream of
 * detection runs identically in both, because suppression, beat tracking and
 * derivation never left the client.
 *
 * Auth state is read per call rather than at construction. Signing in mid-visit
 * is a thing people do, and a detector chosen once at bootstrap would leave
 * whoever did it on the anonymous path until they reloaded.
 *
 * ## Failure degrades rather than breaks
 *
 * If the server is down, or the request fails, or the job comes back failed, a
 * paying user gets an in-browser transcription instead of an error page. They
 * lose speed and — when it is licensed — separation. They do not lose the
 * product.
 *
 * This is nearly free and the design said not to skip it. Two things make it
 * work: the worker is constructed lazily, so an anonymous session never pays
 * for a fallback it will not use, and `RemoteDetector` never touches the audio
 * buffer, so it is still intact to hand to the worker. The worker detector
 * *transfers* that buffer, which is why the fallback runs in this direction and
 * could not run in the other.
 */

import { errorOf } from './error-message';
import { DetectionResult, NoteDetector } from './note-detector';

/** Reads auth state at the moment of the call. */
export type IsSignedIn = () => boolean;

export class TieredDetector implements NoteDetector {
  private worker: NoteDetector | null = null;

  /**
   * @param isSignedIn Whether this call should go to the server.
   * @param createRemote Built per call, and **asynchronously**: it is cheap to
   *   construct, holding one across a sign-out would keep a stale token, and
   *   the promise is what lets the caller reach it through a dynamic `import`.
   *   That last one is load-bearing — `RemoteDetector` pulls in the SignalR
   *   client, which is 58 kB the landing page has no use for.
   * @param createWorker Built once and kept. A fresh worker pays for the model
   *   download and the shader compiles again.
   * @param onFallback Told when the server path failed and the browser took
   *   over, so the UI can say so rather than silently being slow.
   */
  constructor(
    private readonly isSignedIn: IsSignedIn,
    private readonly createRemote: () => Promise<NoteDetector>,
    private readonly createWorker: () => NoteDetector,
    private readonly onFallback: (reason: Error) => void = () => undefined
  ) {}

  async detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void,
    file?: File
  ): Promise<DetectionResult> {
    if (this.isSignedIn() && file) {
      try {
        const remote = await this.createRemote();
        return await remote.detect(audio, sampleRate, onProgress, file);
      } catch (error) {
        // Back to zero: the server may have reported progress before it failed,
        // and a bar that jumps backwards is better than one that stalls at 40 %
        // and then finishes twice.
        onProgress(0);
        this.onFallback(errorOf(error));
      }
    }

    return this.local().detect(audio, sampleRate, onProgress, file);
  }

  /**
   * Releases the worker, if one was ever made.
   *
   * Mirrors `WorkerDetector.terminate`, which `TranscriptionService`'s host
   * component calls on destroy. An anonymous session that never fell back has
   * nothing to release, which is the point of building it lazily.
   */
  terminate(): void {
    const worker = this.worker as { terminate?: () => void } | null;
    worker?.terminate?.();
    this.worker = null;
  }

  private local(): NoteDetector {
    this.worker ??= this.createWorker();
    return this.worker;
  }
}
