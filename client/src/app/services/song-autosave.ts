import { BehaviorSubject, Observable } from 'rxjs';
import { messageOf } from './error-message';

/**
 * Where a song's saving stands, for the title bar (design decision 9): "Saved · just now", "Saving…", "Unsaved", or
 * "Not saved: <reason>".
 *
 * - `saved`: everything changed has been written; `at` is when the last write landed (epoch ms), or when the song was
 *   last written before it was opened.
 * - `saving`: a write is in flight.
 * - `unsaved`: there is a change no write has started on yet - waiting out the delay.
 * - `failed`: the last write was refused or failed, and `reason` says why. The change it carried is still pending.
 */
export type SaveStatus =
  | { kind: 'saved'; at: number }
  | { kind: 'saving' }
  | { kind: 'unsaved' }
  | { kind: 'failed'; reason: string };

/** Time, as autosave needs it: injected so specs move it by hand. */
export interface AutosaveClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * How long after the last change a save starts.
 *
 * Long enough that a run of typing - keys land 100 to 300 ms apart - is one write, not one a keystroke: each write
 * bumps the song's revision and re-reads the library list, and a status flickering "Saving…" under every letter is
 * noise. Short enough that the status catches up as soon as the writer pauses: under a second still reads as "just
 * now", and a tab closed in that second is caught by the page's flush on `pagehide`. The write itself costs a few
 * milliseconds for a song of a few hundred nodes, so it is the flicker, not the cost, that sets the floor.
 */
export const AUTOSAVE_DELAY_MS = 800;

/**
 * The longest a change waits, however long the changes keep coming.
 *
 * A pure debounce never saves while someone types without an 800 ms pause - a fast typist pasting and editing for a
 * minute - and a crash then loses the whole minute. This bounds that loss to a few seconds of typing, while still
 * being rare enough that a writer in full flow sees "Saving…" only now and then.
 */
export const AUTOSAVE_MAX_WAIT_MS = 5000;

/** What an autosave is built with. */
export interface SongAutosaveOptions<T> {
  /**
   * Writes `content`, resolving once it is kept and rejecting with why not. Never called while an earlier call is in
   * flight, so a persist that carries the song's revision forward from one save to the next (`saveSong`) sees its own
   * last result.
   */
  persist: (content: T) => Promise<unknown>;
  /** When the song was last written (its record's `updatedAt`): the starting "Saved · …". */
  savedAt: number;
  clock?: AutosaveClock;
  delayMs?: number;
  maxWaitMs?: number;
}

/** The browser's own timers and clock. */
const BROWSER_CLOCK: AutosaveClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * Saves the latest version of a song a moment after it changes, one write at a time, and says how that is going.
 *
 * Design Part 8's "persist the latest document" seam, from the page's side: the page hands every new document to
 * `change`, and this decides when `persist` writes one. Nothing here knows what a song is - `T` is whatever `persist`
 * takes - so a sync provider can replace `persist` later and keep this.
 *
 * A plain class, not an injectable: it is made per song, when the page has loaded one, and is bound to that song's
 * `persist` and last save time, which do not exist before then. The page makes one per opened song and destroys it
 * with the page.
 *
 * **The rules:**
 * - **Debounced** (`AUTOSAVE_DELAY_MS` after the last change), **bounded** (`AUTOSAVE_MAX_WAIT_MS` after the first
 *   unsaved one).
 * - **Never two writes at once.** A change made while one is in flight waits for it, then for the rest of its own delay,
 *   counted from when it was made - so one that came long before the write landed goes at once.
 * - **Only the latest is written.** Changes replace one another while they wait; a write is always of the newest.
 * - **A failure keeps the change pending and does not retry on a timer.** The failures IndexedDB gives are not ones
 *   that pass by themselves - storage full, a song saved or deleted in another tab, a browser refusing storage - so a
 *   retry loop would repeat the same failure under a status that already says why. It retries on the next change, on
 *   `flush` (which the page's Retry, route leave and `pagehide` call), and on `destroy`. The failure stays shown while
 *   changes come in, until the next write starts: the work is still not saved, and for that reason.
 * - **`flush` saves now** and resolves once everything changed before it is saved or a save has failed, with the status
 *   it ends in. It never rejects: a failure is a status, not an exception.
 *
 * **What the page wires** (S1 task 6): `change` on every document change; `flush` on `visibilitychange` to hidden and on
 * `pagehide` (best effort - the browser may stop the page before an IndexedDB write commits); `hasUnsavedChanges` in
 * `beforeunload`, to ask before leaving with work pending; and `destroy` in `ngOnDestroy`.
 */
export class SongAutosave<T> {
  readonly status$: Observable<SaveStatus>;

  private readonly statusSubject: BehaviorSubject<SaveStatus>;
  private readonly persist: (content: T) => Promise<unknown>;
  private readonly clock: AutosaveClock;
  private readonly delayMs: number;
  private readonly maxWaitMs: number;

  /** The newest change no write has taken yet, boxed so a change of `undefined` is still a change. */
  private pending: { content: T } | null = null;
  /** When the pending change was made, and when the oldest change not yet saved was: the delay and its bound. */
  private lastChangeAt = 0;
  private firstUnsavedAt: number | null = null;
  /** The write in flight; it settles - never rejects - once the write has landed or failed. */
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private destroyed = false;

  constructor(options: SongAutosaveOptions<T>) {
    this.persist = options.persist;
    this.clock = options.clock ?? BROWSER_CLOCK;
    this.delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
    this.maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
    this.statusSubject = new BehaviorSubject<SaveStatus>({ kind: 'saved', at: options.savedAt });
    this.status$ = this.statusSubject.asObservable();
  }

  /** The status now; `status$` emits each one. */
  get status(): SaveStatus {
    return this.statusSubject.getValue();
  }

  /** Whether some change is not yet saved: pending, in flight, or failed. */
  hasUnsavedChanges(): boolean {
    return this.pending !== null || this.inFlight !== null;
  }

  /** Takes `content` as the song's latest version, to be saved a moment from now. Ignored once destroyed. */
  change(content: T): void {
    if (this.destroyed) return;
    const now = this.clock.now();
    this.pending = { content };
    this.lastChangeAt = now;
    this.firstUnsavedAt ??= now;
    // "Saving…" stays while a write is in flight, and a failure stays shown until the next write starts.
    if (this.status.kind === 'saved') this.setStatus({ kind: 'unsaved' });
    this.schedule();
  }

  /**
   * Saves whatever is pending now, after the write in flight if there is one, and resolves with the status that ends
   * in: `saved` when everything changed before the call is written, `failed` when a write fails. One failed write ends
   * it - a flush tries once, it does not loop.
   */
  async flush(): Promise<SaveStatus> {
    this.cancelTimer();
    for (;;) {
      if (this.inFlight !== null) {
        await this.inFlight;
        // Landing, the write may have set a timer for what came after it; this flush takes that over.
        this.cancelTimer();
        continue;
      }
      if (this.pending === null) return this.status;
      await this.write();
      if (this.status.kind === 'failed') return this.status;
    }
  }

  /**
   * Flushes, then stops: no further change is taken and `status$` completes once the flush settles. For the page's
   * `ngOnDestroy`, which cannot wait for it - the write goes on after the page has gone, and lands.
   */
  async destroy(): Promise<SaveStatus> {
    this.destroyed = true;
    try {
      return await this.flush();
    } finally {
      this.cancelTimer();
      this.statusSubject.complete();
    }
  }

  /**
   * Sets the timer for the pending change: its delay from when it was made, cut short by the bound from the first
   * unsaved change. Due already - a change that waited out a write longer than its delay - it starts now.
   */
  private schedule(): void {
    this.cancelTimer();
    if (this.pending === null || this.inFlight !== null) return;

    const due = Math.min(this.lastChangeAt + this.delayMs, (this.firstUnsavedAt ?? this.lastChangeAt) + this.maxWaitMs);
    const wait = due - this.clock.now();
    if (wait <= 0) {
      void this.write();
      return;
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      // A write that started since - a flush - has the change, or will schedule it when it lands.
      if (this.inFlight === null) void this.write();
    }, wait);
  }

  /**
   * Writes the pending change, and settles once the write has landed or failed. Called only with no write in flight,
   * and synchronously up to `persist`, so two callers cannot both find none and start two.
   */
  private write(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return Promise.resolve();
    this.cancelTimer();
    this.pending = null;
    this.firstUnsavedAt = null;
    this.setStatus({ kind: 'saving' });

    const started = this.clock.now();
    const writing = this.persistSafely(pending.content).then(
      () => {
        this.inFlight = null;
        if (this.pending === null) {
          this.setStatus({ kind: 'saved', at: this.clock.now() });
          return;
        }
        // Changed while the write was in flight: still not saved, and its save is due a moment after it was made.
        this.setStatus({ kind: 'unsaved' });
        this.schedule();
      },
      (error: unknown) => {
        this.inFlight = null;
        const newer = this.pending !== null;
        // A newer change replaces the failed one; otherwise the failed one waits, for the next change or a flush, and
        // has been unsaved since its write started - the bound on the next change's wait counts from then.
        if (!newer) {
          this.pending = pending;
          this.firstUnsavedAt = started;
        }
        this.setStatus({ kind: 'failed', reason: messageOf(error) });
        // A change made during the failed write is the next change it retries on.
        if (newer) this.schedule();
      }
    );
    this.inFlight = writing;
    return writing;
  }

  /** `persist(content)`, with a synchronous throw turned into a rejection, so it fails the same way as one that rejects. */
  private persistSafely(content: T): Promise<unknown> {
    try {
      return this.persist(content);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Emits `next`, except a repeat of `saving` or `unsaved`, which would tell a subscriber nothing new. */
  private setStatus(next: SaveStatus): void {
    if ((next.kind === 'saving' || next.kind === 'unsaved') && next.kind === this.status.kind) return;
    this.statusSubject.next(next);
  }
}
