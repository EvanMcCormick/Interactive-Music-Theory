/**
 * Resolves when `transaction` commits, and rejects with why it did not.
 *
 * Settle a write here, not on its request's `success`: that says the request ran, not that it was kept. The commit can
 * still abort after every request succeeded - a quota a large file exceeds - and a write that resolved on its request
 * would say it landed when it did not. A request that fails says why first, as an `error` bubbling up from it; the
 * abort that follows settles nothing further. An abort with no failed request - the commit's own, or `abort()` - says
 * why in the transaction's `error`, when it says at all.
 *
 * Call it before the transaction can finish - in the same task that created it - or the events are missed.
 */
export function committed(transaction: IDBTransaction, failure: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = event =>
      reject((event.target instanceof IDBRequest ? event.target.error : null) ?? transaction.error ?? new Error(failure));
    transaction.onabort = () => reject(transaction.error ?? new Error(failure));
  });
}
