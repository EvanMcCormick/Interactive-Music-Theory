import { Injectable, InjectionToken, NgZone, inject } from '@angular/core';
import { Node } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { BehaviorSubject, Observable } from 'rxjs';
import { SongDoc, SongMeta, SongSummary } from '../models/song.model';
import { messageOf } from './error-message';
import { committed } from './indexed-db';
import { UNTITLED_SONG, createSongContent, songNodeOf, songSummaryOf } from './song-document';

/**
 * The IndexedDB database songs are kept in: `song-library`. A token, as `GP_LIBRARY_DB` is, so each spec opens a
 * database of its own and deletes it after, rather than share - or wipe - the one a developer's browser holds.
 */
export const SONG_LIBRARY_DB = new InjectionToken<string>('SONG_LIBRARY_DB', {
  providedIn: 'root',
  factory: () => 'song-library'
});

/**
 * Version 1 holds the `songs` store alone. Memos arrive in S4 with a store of their own and a bump to 2, whose upgrade
 * adds it: creating it now would be a store nothing writes, whose shape S4 would be bound to before designing it.
 */
const DB_VERSION = 1;
const STORE_NAME = 'songs';

/**
 * What opening a song found.
 *
 * - **`song`**: the record, and its content as a document `songNodeOf` has checked - the editor's starting state, so
 *   the page never parses the content a second time, nor holds a record it has not checked.
 * - **`unreadable`**: the record is there but cannot be opened, and why. Not thrown: a corrupt song is a fact the page
 *   shows - "This song cannot be opened: <reason>" with the way back to the library, where its card offers Delete - not
 *   a failure of the library. Its record is not handed back, so nothing can edit, and then save over, a song it could
 *   not read.
 *
 * `null` - no such song - is outside the union, as `ComposerLibraryService.get` and `GpLibraryService.getEntry` give
 * it: not being there is not a property of a record, and the page answers it differently (back to the library, which
 * no longer lists it). A storage failure rejects, as every other call here does.
 */
export type SongLoad = { kind: 'song'; doc: SongDoc; node: Node } | { kind: 'unreadable'; reason: string };

/** What a save of a song another tab or window has saved since is refused with. */
const SAVED_ELSEWHERE =
  'This song was changed in another tab or window after it was opened here, so the changes here were not saved. ' +
  'Reload it to see that version.';

/**
 * Why a write or read failed when IndexedDB gives no reason: an abort with no failed request, which is the commit's
 * own failure (`committed`).
 */
const ABANDONED = 'The browser abandoned the change.';
const ABANDONED_READ = 'The browser abandoned the read.';

/** What a write to a song that is no longer stored is refused with. */
const NOT_IN_LIBRARY = 'This song is no longer in the library - it may have been deleted in another tab or window.';

/**
 * The library of songs: IndexedDB, the `/songs` list's source, and where the sheet loads from and autosaves to.
 *
 * Built as `ComposerLibraryService` and `GpLibraryService` are: one database promise (`database`), let go on a
 * `versionchange` so another tab's upgrade or a spec's delete is not held up, and every write settled on its commit
 * (`committed`), never on its request. Two differences, both deliberate:
 *
 * - **Records are checked on the way out.** `content` is a ProseMirror document as JSON, which a bug or a hand-edited
 *   import can leave unreadable, so nothing read here is trusted: `loadSong` and the list both go through `songNodeOf`,
 *   and a record that fails is reported, never thrown or dropped.
 * - **A save is compare-and-swap on `revision`** (`saveSong`), because a song can be open in two tabs and both
 *   autosave: the slower must not silently overwrite the faster.
 *
 * Every failure rejects with an `Error` whose message a page can show as it is.
 */
@Injectable({ providedIn: 'root' })
export class SongLibraryService {
  private readonly dbName: string = inject(SONG_LIBRARY_DB);
  private readonly ngZone = inject(NgZone);
  private readonly summariesSubject = new BehaviorSubject<SongSummary[]>([]);
  private readyPromise: Promise<IDBDatabase> | null = null;
  /** The newest list read started, so an older read finishing after it cannot replace its result (`refresh`). */
  private refreshes = 0;

  /**
   * Every song's card, newest first; read again after each write this service makes while anything subscribes
   * (`refreshAfterWrite`).
   *
   * Starts empty and is not read until something calls `refresh`, as the composer's library is not: the list page
   * calls it when it opens, so a song another tab wrote since is there and a list left stale while nobody watched it is
   * put right, and a page that only opens a song never reads the list at all.
   */
  getSummaries(): Observable<SongSummary[]> {
    return this.summariesSubject.asObservable();
  }

  /**
   * Reads every song's card, newest first by `updatedAt` (then by id, so equal times keep one order), publishes the
   * list and returns it.
   *
   * Read through a cursor, as `GpLibraryService` lists its files: each record is summarised as it is read and let go,
   * so the list never holds more than one song's content at once, and none once read. A card is derived from the
   * content (`songSummaryOf`) rather than stored beside it, so it cannot disagree with the sheet it opens - which is
   * why the content is read at all. A record that cannot be read is listed with its reason (`unreadable`), never
   * dropped, so the user can see it and delete it.
   */
  async refresh(): Promise<SongSummary[]> {
    const ticket = ++this.refreshes;
    const summaries: SongSummary[] = [];
    try {
      const transaction = (await this.database()).transaction(STORE_NAME, 'readonly');
      const cursor = transaction.objectStore(STORE_NAME).openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        summaries.push(cardOf(at.value));
        at.continue();
      };
      await committed(transaction, ABANDONED_READ);
    } catch (error) {
      throw failure('The song library could not be read', error);
    }

    summaries.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Two reads can overlap - a save's and the list page's - and finish in either order; only the one started last
    // has seen every write before it. IndexedDB callbacks run outside Angular's zone.
    if (ticket === this.refreshes) this.ngZone.run(() => this.summariesSubject.next(summaries));
    return summaries;
  }

  /**
   * Makes a new song - the defaults of `createSongContent` under whatever `meta` says - stores it, and returns its
   * record at revision 1: it has been written once.
   */
  async createSong(meta: Partial<SongMeta> = {}): Promise<SongDoc> {
    const now = Date.now();
    const song: SongDoc = {
      id: crypto.randomUUID(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      content: createSongContent(meta).toJSON()
    };
    await this.write(song, 'The song could not be created');
    return song;
  }

  /** The song `id` as `SongLoad` says, or null when there is none. Never throws over what the record holds. */
  async loadSong(id: string): Promise<SongLoad | null> {
    const stored = await this.read(id);
    if (stored === undefined) return null;

    const record = songRecordOf(stored);
    if (typeof record === 'string') return { kind: 'unreadable', reason: record };
    const reading = songNodeOf(record.content);
    return reading.kind === 'song'
      ? { kind: 'song', doc: record, node: reading.doc }
      : { kind: 'unreadable', reason: reading.reason };
  }

  /**
   * Writes `song`'s content over the stored record and returns the record as written: its revision one more than
   * before, its `updatedAt` now, its `createdAt` the stored one. Hand the returned record to the next save.
   *
   * This is the "persist the latest document" seam (design Part 8): autosave calls it and nothing else, so a sync
   * provider can take its place later without the sheet knowing.
   *
   * **Refused, with a reason, when:**
   * - **the stored revision is not `song.revision`.** Someone else - another tab, another window - saved since this
   *   copy was read, and writing over theirs would lose their changes without a word. Last-writer-wins would be quieter
   *   and would lose work; merging two ProseMirror documents is collaboration's job (design Part 8), not a library's.
   *   So the save is refused and the page says so; reloading shows the other version. Compared for equality, not
   *   "older than", so a copy claiming a revision the store never reached is refused too: it did not come from here.
   * - **the song is no longer stored.** It was deleted - most likely in another tab - and writing it back would undo
   *   that delete behind the user's back.
   * - **its content could not be read back** (`songNodeOf`). A song is never written in a form that would open as
   *   unreadable; the editor only makes valid documents, so this guards against a bug, not the user.
   *
   * The check and the write are one readwrite transaction, so no other tab's save can land between them: IndexedDB runs
   * readwrite transactions on one store one at a time.
   */
  async saveSong(song: SongDoc): Promise<SongDoc> {
    const reading = songNodeOf(song.content);
    if (reading.kind === 'refused') {
      throw new SongLibraryError(`This song was not saved, because it could not be read back: ${reading.reason}`);
    }

    // Set inside the read's callback, so held in an object: a `let` assigned in a callback is invisible to the
    // narrowing after it.
    const outcome: { written?: SongDoc; refusal?: string } = {};
    try {
      const transaction = (await this.database()).transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const read = store.get(song.id);
      read.onsuccess = () => {
        if (read.result === undefined) {
          outcome.refusal = NOT_IN_LIBRARY;
          return;
        }
        // A stored record that cannot be read has no revision to compare: the copy here cannot have come from it.
        const stored = songRecordOf(read.result);
        if (typeof stored === 'string' || stored.revision !== song.revision) {
          outcome.refusal = SAVED_ELSEWHERE;
          return;
        }
        // Listed rather than spread, so whatever else a caller hung on the record is not stored with it.
        outcome.written = {
          id: stored.id,
          revision: stored.revision + 1,
          createdAt: stored.createdAt,
          updatedAt: Date.now(),
          content: song.content
        };
        store.put(outcome.written);
      };
      await committed(transaction, ABANDONED);
    } catch (error) {
      throw failure('The song could not be saved', error);
    }

    if (outcome.refusal !== undefined) throw new SongLibraryError(outcome.refusal);
    // Committed with neither a refusal nor a write: the read's callback never ran, which a commit rules out.
    if (outcome.written === undefined) throw new SongLibraryError(`The song could not be saved: ${ABANDONED}`);
    await this.refreshAfterWrite();
    return outcome.written;
  }

  /**
   * Copies the song `id` into a new song titled "<title> (copy)" ("Untitled song (copy)" when it has none), at
   * revision 1, and returns the copy's id. Refuses a song that is not there or cannot be read: a copy of what could not
   * be read would be a second unreadable song.
   *
   * **Every section, chord, tab block and memo is given a fresh id.** A section's id is also the id of its derived
   * progression (`sectionProgressionOf`), and a chord's is its slot's, so a copy sharing them would be taken for the
   * original by anything that matches on them - Open in Progression's hand-off, a generated track's origin (S2). Fresh
   * ids make the copy a song of its own from the start. A memo's id is also the key of its audio, which has a store of
   * its own from S4; nothing is stored under a memo id before then, so renewing one loses nothing now.
   */
  async duplicateSong(id: string): Promise<string> {
    const loaded = await this.loadSong(id);
    if (loaded === null) throw new SongLibraryError(NOT_IN_LIBRARY);
    if (loaded.kind === 'unreadable') {
      throw new SongLibraryError(`This song cannot be read, so it cannot be copied: ${loaded.reason}`);
    }

    const title: string = loaded.node.attrs['title'];
    const copy = withFreshIdsOf(loaded.node);
    copy.setDocAttribute('title', `${title.trim() === '' ? UNTITLED_SONG : title} (copy)`);

    const now = Date.now();
    const song: SongDoc = { id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now, content: copy.doc.toJSON() };
    await this.write(song, 'The song could not be copied');
    return song.id;
  }

  /**
   * Deletes the song `id`, resolving once the delete has committed. An id that is not there resolves too - IndexedDB
   * counts it a success - so deleting a song twice, from two tabs, is harmless.
   */
  async deleteSong(id: string): Promise<void> {
    try {
      const transaction = (await this.database()).transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      await committed(transaction, ABANDONED);
    } catch (error) {
      throw failure('The song could not be deleted', error);
    }
    await this.refreshAfterWrite();
  }

  /** Adds a new record, settled on its commit. `add`, not `put`: a new song never writes over one already stored. */
  private async write(song: SongDoc, what: string): Promise<void> {
    try {
      const transaction = (await this.database()).transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).add(song);
      await committed(transaction, ABANDONED);
    } catch (error) {
      throw failure(what, error);
    }
    await this.refreshAfterWrite();
  }

  /** The stored record under `id`, unchecked, or undefined when there is none. */
  private async read(id: string): Promise<unknown> {
    try {
      const db = await this.database();
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(ABANDONED_READ));
      });
    } catch (error) {
      throw failure('The song could not be read', error);
    }
  }

  /**
   * Lists the library again after a write, while anything is watching the list.
   *
   * **Only while watched**, because reading the list reads and checks every song (`refresh`), and the sheet - where
   * autosave writes, a moment after every pause in typing - does not show it. Re-reading the whole library under each
   * autosave would be work nobody sees, growing with the library. A list nobody watches goes stale instead, and is
   * read afresh by the list page when it opens (`getSummaries`).
   *
   * **Its failure is logged, not thrown:** the write landed, and a caller told it failed would say so - autosave showing
   * "Not saved" over a song that is saved.
   */
  private async refreshAfterWrite(): Promise<void> {
    if (!this.summariesSubject.observed) return;
    await this.refresh().catch(error => console.error('Failed to list the song library after a write:', error));
  }

  /**
   * Opens the database once; later calls await the same promise - until the open fails, or the connection is let go,
   * and the next call opens it again. A failed open kept would fail every call after it for as long as the page is
   * open.
   */
  private database(): Promise<IDBDatabase> {
    if (this.readyPromise) return this.readyPromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        // No indexes: the list is read whole through a cursor and sorted in memory - a songwriter's library is tens of
        // songs, not thousands - and an index on a field inside `content` is not possible anyway.
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };

      request.onsuccess = () => {
        const db = request.result;
        const letGo = (): void => {
          if (this.readyPromise === opening) this.readyPromise = null;
        };
        // A delete of the database, or an upgrade to a later version from another tab, waits until every connection to
        // it closes. Held open, this one would hold them up for as long as the page is open.
        db.onversionchange = () => {
          db.close();
          letGo();
        };
        // The browser closed it - storage cleared, the disk gone - so the next call opens it again rather than failing
        // on a dead connection.
        db.onclose = letGo;
        resolve(db);
      };

      request.onerror = () => {
        if (this.readyPromise === opening) this.readyPromise = null;
        reject(request.error ?? new Error('The browser refused to open it.'));
      };
    }).catch(error => {
      throw failure('The song library could not be opened', error);
    });

    this.readyPromise = opening;
    return opening;
  }
}

/**
 * `doc` with a fresh UUID on every node that carries an id, as a transform whose `doc` is the copy - so the caller can
 * add its own steps (the copy's title) before reading it.
 *
 * `setNodeAttribute` replaces no content, so every position found before the first step is still right after the last.
 */
function withFreshIdsOf(doc: Node): Transform {
  const transform = new Transform(doc);
  doc.descendants((node, pos) => {
    if (typeof node.attrs['id'] === 'string') transform.setNodeAttribute(pos, 'id', crypto.randomUUID());
  });
  return transform;
}

/**
 * A stored value as a `SongDoc`, or the reason it is not one.
 *
 * Checks the record's own fields, which `songNodeOf` - checking only `content` - cannot: a record without a revision
 * could never be saved over (`saveSong` compares it), and one whose content is not an object would throw in
 * `songSummaryOf`.
 */
function songRecordOf(value: unknown): SongDoc | string {
  if (typeof value !== 'object' || value === null) return 'The stored song is not a record.';
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') return 'The stored song has no id.';
  const revision = record['revision'];
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    return 'The stored song has no revision.';
  }
  for (const field of ['createdAt', 'updatedAt']) {
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) return `The stored song has no ${field}.`;
  }
  const content = record['content'];
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return 'The stored song has no content.';
  return record as unknown as SongDoc;
}

/**
 * A stored value's library card: `songSummaryOf` for a record, and for anything else a card that says why it cannot be
 * opened, under whatever id it is stored at and with an `updatedAt` of 0 if it has none, so it sorts last.
 */
function cardOf(value: unknown): SongSummary {
  const record = songRecordOf(value);
  if (typeof record !== 'string') return songSummaryOf(record);

  const fields = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const updatedAt = fields['updatedAt'];
  return {
    id: String(fields['id']),
    title: '',
    artist: '',
    key: null,
    sectionCount: 0,
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
    unreadable: record
  };
}

/** An error this service has already worded for a page: passed on as it is, never wrapped a second time. */
class SongLibraryError extends Error {}

/**
 * An Error for a page to show: what could not be done, then why.
 *
 * IndexedDB's own errors are `DOMException`s whose message describes the transaction ("The transaction was aborted"),
 * not the song, so the message leads with what the user tried. One of this service's own - an open that failed, seen
 * by the read that needed it - is already worded, and is passed on unchanged.
 */
function failure(what: string, error: unknown): Error {
  return error instanceof SongLibraryError ? error : new SongLibraryError(`${what}: ${messageOf(error)}`);
}
