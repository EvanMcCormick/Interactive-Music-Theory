/**
 * Deletes the IndexedDB database `name`, resolving only once it is gone.
 *
 * A delete waits for every connection still open to the database to close, and says so with `blocked`. Resolving on
 * `blocked`, as the library specs once did, hid a service that never let its database go: the delete never finished,
 * and the database outlived the spec. A connection asked to close may take a moment to, so a blocked delete gets a
 * short grace before it fails the spec.
 */
export function deletedDatabase(name: string, graceMs = 1000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    let grace: ReturnType<typeof setTimeout> | undefined;
    request.onsuccess = () => {
      clearTimeout(grace);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(grace);
      reject(request.error ?? new Error(`Deleting the database ${name} failed`));
    };
    request.onblocked = () => {
      grace = setTimeout(() => reject(new Error(`Deleting the database ${name} was blocked by a connection left open`)), graceMs);
    };
  });
}

/**
 * Makes every `method` request on an object store abort its transaction the moment the request succeeds, until the spec
 * ends (Jasmine restores the method) or it calls `.and.callThrough()` on the spy.
 *
 * The request reports success, and then the transaction rolls back and nothing is written: what a commit that fails
 * after every request succeeded looks like - a quota a large file exceeds - which a spec cannot provoke on demand. A key
 * that collides is no stand-in: `add` then fails as a request error (ConstraintError) before its transaction aborts,
 * and a write that settled on its request already caught that.
 */
export function abortOnSuccess(method: 'add' | 'put' | 'delete'): jasmine.Spy {
  const original = IDBObjectStore.prototype[method] as (this: IDBObjectStore, ...args: unknown[]) => IDBRequest;
  return spyOn(IDBObjectStore.prototype, method).and.callFake(function (this: IDBObjectStore, ...args: unknown[]): IDBRequest {
    const request = original.apply(this, args);
    // Added before the service sets its own `onsuccess`, so this runs first: the service still hears the success.
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
}
