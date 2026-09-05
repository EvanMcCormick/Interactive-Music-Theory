/**
 * Getting a message, or an Error, out of something caught.
 *
 * `catch` binds `unknown` under strict mode and a thrown value need not be an
 * Error: a rejected `postMessage`, a `DOMException`, a library that throws a
 * string. Every module in the transcription pipeline has to deal with that at
 * its own boundary - `TranscriptionService` when a run fails, `WorkerDetector`
 * three times over as it settles a detection, `detection.worker` when it has
 * to post a failure across a channel Errors do not survive - and the ternary
 * was written out five times before this existed.
 *
 * Deliberately tiny and dependency-free: the worker imports it too, and
 * anything reachable from `detection.worker.ts` on the main thread's side of
 * the import graph would undo the bundle split. This is two functions and no
 * imports.
 */

/** The message of `error`, or its string form when it is not an Error. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `error` as an Error, wrapping it only if it is not one already.
 *
 * Not `new Error(messageOf(error))` unconditionally: a real Error arrives with
 * a stack pointing at where it was thrown, and rebuilding it around its own
 * message throws that away and points at here instead.
 */
export function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(messageOf(error));
}
