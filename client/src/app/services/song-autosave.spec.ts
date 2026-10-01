import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AutosaveClock,
  SaveStatus,
  SongAutosave
} from './song-autosave';

/**
 * Autosave against a fake clock and a fake store.
 *
 * The clock runs a timer only when a spec moves time on (`tick`), and the store
 * settles a save only when a spec says so (`succeed`, `failWith`), so every
 * spec decides exactly what has happened by each expectation: nothing here
 * waits on real time.
 */
class FakeClock implements AutosaveClock {
  time = 10_000;
  private timers: { handle: number; at: number; callback: () => void }[] = [];
  private nextHandle = 1;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.push({ handle, at: this.time + ms, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter(timer => timer.handle !== handle);
  }

  /** Moves time on by `ms`, running each timer that falls due at its own moment, and lets what it starts settle. */
  async tick(ms: number): Promise<void> {
    const until = this.time + ms;
    for (;;) {
      const due = this.timers.filter(timer => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter(timer => timer !== due);
      this.time = due.at;
      due.callback();
      await settled();
    }
    this.time = until;
    await settled();
  }
}

/** A store whose saves stay in flight until a spec settles them, oldest first. */
class FakeStore {
  /** What each save was asked to write, in order, whatever became of it. */
  readonly asked: string[] = [];
  /** What the saves that succeeded wrote, in order. */
  readonly written: string[] = [];
  private inFlight: { content: string; resolve: () => void; reject: (error: unknown) => void }[] = [];

  readonly persist = (content: string): Promise<void> => {
    this.asked.push(content);
    return new Promise<void>((resolve, reject) => this.inFlight.push({ content, resolve, reject }));
  };

  get pending(): number {
    return this.inFlight.length;
  }

  async succeed(): Promise<void> {
    const save = this.next();
    this.written.push(save.content);
    save.resolve();
    await settled();
  }

  async failWith(error: unknown): Promise<void> {
    this.next().reject(error);
    await settled();
  }

  private next() {
    const save = this.inFlight.shift();
    if (save === undefined) throw new Error('No save is in flight');
    return save;
  }
}

/** Lets every promise reaction already queued run. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('SongAutosave', () => {
  const SAVED_AT = 5_000;
  let clock: FakeClock;
  let store: FakeStore;
  let autosave: SongAutosave<string>;
  let statuses: SaveStatus[];

  beforeEach(() => {
    clock = new FakeClock();
    store = new FakeStore();
    autosave = new SongAutosave<string>({ persist: store.persist, savedAt: SAVED_AT, clock });
    statuses = [];
    autosave.status$.subscribe(status => statuses.push(status));
  });

  it('starts saved, as of when the song was last written', () => {
    expect(statuses).toEqual([{ kind: 'saved', at: SAVED_AT }]);
    expect(autosave.hasUnsavedChanges()).toBeFalse();
  });

  describe('debounce', () => {
    it('saves a moment after the last change, not after each one', async () => {
      autosave.change('a');
      await clock.tick(500);
      autosave.change('ab');
      await clock.tick(AUTOSAVE_DELAY_MS - 1);

      expect(store.asked).toEqual([]);

      await clock.tick(1);

      expect(store.asked).toEqual(['ab']);
    });

    it('saves at the latest a few seconds after the first unsaved change, though the changes never pause', async () => {
      for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 400) {
        autosave.change(`at ${elapsed}`);
        await clock.tick(400);
      }

      expect(store.asked.length).toBe(1);
      expect(clock.time - 10_000).toBeGreaterThanOrEqual(AUTOSAVE_MAX_WAIT_MS);
      expect(store.asked[0]).toBe('at 4800');
    });

    it('honours a delay it is given', async () => {
      const quick = new SongAutosave<string>({ persist: store.persist, savedAt: SAVED_AT, clock, delayMs: 100 });

      quick.change('a');
      await clock.tick(100);

      expect(store.asked).toEqual(['a']);
    });
  });

  describe('status', () => {
    it('goes unsaved on a change, saving when the write starts, and saved - at when it landed - when it lands', async () => {
      autosave.change('a');
      autosave.change('ab');
      await clock.tick(AUTOSAVE_DELAY_MS);
      clock.time += 30;
      await store.succeed();

      expect(statuses).toEqual([
        { kind: 'saved', at: SAVED_AT },
        { kind: 'unsaved' },
        { kind: 'saving' },
        { kind: 'saved', at: 10_000 + AUTOSAVE_DELAY_MS + 30 }
      ]);
    });

    it('says the song has unsaved changes from the change until the save of the latest lands', async () => {
      autosave.change('a');
      expect(autosave.hasUnsavedChanges()).toBeTrue();

      await clock.tick(AUTOSAVE_DELAY_MS);
      expect(autosave.hasUnsavedChanges()).toBeTrue();

      await store.succeed();
      expect(autosave.hasUnsavedChanges()).toBeFalse();
    });
  });

  describe('one save at a time', () => {
    it('never starts a save while another is in flight, and saves a change made meanwhile once it lands', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      autosave.change('ab');
      await clock.tick(AUTOSAVE_DELAY_MS * 10);

      expect(store.pending).toBe(1);
      expect(store.asked).toEqual(['a']);

      await store.succeed();

      expect(store.asked).toEqual(['a', 'ab']);
      expect(statuses.slice(-2)).toEqual([{ kind: 'unsaved' }, { kind: 'saving' }]);
    });

    it('waits out the rest of the delay for a change made just before the save in flight lands', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      autosave.change('ab');
      await clock.tick(300);
      await store.succeed();

      expect(store.asked).toEqual(['a']);

      await clock.tick(AUTOSAVE_DELAY_MS - 300);

      expect(store.asked).toEqual(['a', 'ab']);
    });

    it('writes only the latest of the changes made while a save was in flight', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      autosave.change('ab');
      autosave.change('abc');
      autosave.change('abcd');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.succeed();
      await store.succeed();

      expect(store.written).toEqual(['a', 'abcd']);
      expect(statuses[statuses.length - 1].kind).toBe('saved');
    });
  });

  describe('flush', () => {
    it('saves a pending change now, without waiting out the delay, and resolves with the status it ends in', async () => {
      autosave.change('a');

      const flushed = autosave.flush();
      expect(store.asked).toEqual(['a']);
      await store.succeed();

      expect(await flushed).toEqual({ kind: 'saved', at: clock.time });
      await clock.tick(AUTOSAVE_DELAY_MS * 2);
      expect(store.asked).toEqual(['a']);
    });

    it('writes nothing when nothing is pending', async () => {
      expect(await autosave.flush()).toEqual({ kind: 'saved', at: SAVED_AT });
      expect(store.asked).toEqual([]);
    });

    it('waits for the save in flight, then saves what came after it', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      autosave.change('ab');

      let done = false;
      const flushed = autosave.flush().then(status => {
        done = true;
        return status;
      });
      await settled();
      expect(store.asked).toEqual(['a']);

      await store.succeed();
      expect(store.asked).toEqual(['a', 'ab']);
      expect(done).toBeFalse();

      await store.succeed();
      expect((await flushed).kind).toBe('saved');
    });

    it('resolves with the failure when its save fails, rather than rejecting', async () => {
      autosave.change('a');

      const flushed = autosave.flush();
      await store.failWith(new Error('The disk is full'));

      expect(await flushed).toEqual({ kind: 'failed', reason: 'The disk is full' });
    });
  });

  describe('failure', () => {
    it('keeps a failed change pending, says why, and does not retry on its own', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.failWith(new Error('The disk is full'));

      expect(statuses[statuses.length - 1]).toEqual({ kind: 'failed', reason: 'The disk is full' });
      expect(autosave.hasUnsavedChanges()).toBeTrue();

      await clock.tick(60_000);

      expect(store.asked).toEqual(['a']);
    });

    it('tries again on the next change, writing the latest, and recovers', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.failWith(new Error('The disk is full'));

      autosave.change('ab');
      // The failure stays shown until the next attempt starts: the change is still not saved, and for that reason.
      expect(statuses[statuses.length - 1].kind).toBe('failed');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.succeed();

      expect(store.asked).toEqual(['a', 'ab']);
      expect(statuses.slice(-3)).toEqual([
        { kind: 'failed', reason: 'The disk is full' },
        { kind: 'saving' },
        { kind: 'saved', at: clock.time }
      ]);
      expect(autosave.hasUnsavedChanges()).toBeFalse();
    });

    it('tries the failed change again on a flush', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.failWith(new Error('The disk is full'));

      const flushed = autosave.flush();
      await store.succeed();

      expect(store.written).toEqual(['a']);
      expect((await flushed).kind).toBe('saved');
    });

    it('still saves a change made while the failing save was in flight, a moment after it was made', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      autosave.change('ab');
      await store.failWith(new Error('The disk is full'));
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.succeed();

      expect(store.written).toEqual(['ab']);
    });

    it('gives a reason for a failure that is not an Error', async () => {
      autosave.change('a');
      await clock.tick(AUTOSAVE_DELAY_MS);
      await store.failWith('quota');

      expect(statuses[statuses.length - 1]).toEqual({ kind: 'failed', reason: 'quota' });
    });
  });

  describe('destroy', () => {
    it('saves what is pending, completes its status, and ignores changes after it', async () => {
      let completed = false;
      autosave.status$.subscribe({ complete: () => (completed = true) });
      autosave.change('a');

      const destroyed = autosave.destroy();
      autosave.change('after');
      await store.succeed();

      expect((await destroyed).kind).toBe('saved');
      expect(completed).toBeTrue();
      await clock.tick(AUTOSAVE_DELAY_MS * 2);
      expect(store.asked).toEqual(['a']);
    });
  });
});
