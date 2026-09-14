/**
 * `value`, frozen all the way down, and returned.
 *
 * For specs of functions that only read a document: handed a deep-frozen `ScoreDoc`, a reader that
 * changes it in place - a `reverse()` or `sort()` on a voice's own `beats` - throws, where it would
 * otherwise quietly reorder the published document with no undo step. Freezing a value that is already
 * frozen does nothing, so shared parts are safe to pass twice.
 */
export function deepFrozen<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFrozen(inner);
  }
  return value;
}
