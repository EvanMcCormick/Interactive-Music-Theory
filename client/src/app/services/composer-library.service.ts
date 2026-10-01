import { committed } from './indexed-db';
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const DB_NAME = 'composer-library';
const DB_VERSION = 1;
const STORE_NAME = 'compositions';

/**
 * A saved composition.
 *
 * The score is stored as alphaTex rather than a serialised ScoreDoc: it is
 * compact, human-readable, diffable, and immune to ScoreDoc schema drift
 * between versions. Metadata is denormalised so the library list renders
 * without parsing anything.
 */
export interface CompositionEntry {
  id: string;
  title: string;
  artist: string;
  /** Canonical alphaTex produced by alphaTab's exporter. */
  tex: string;
  tempo: number;
  trackCount: number;
  barCount: number;
  dateCreated: Date;
  dateModified: Date;
}

export type CompositionSummary = Omit<CompositionEntry, 'tex'>;

/**
 * IndexedDB persistence for composer scores, following the same pattern as
 * GpLibraryService.
 */
@Injectable({ providedIn: 'root' })
export class ComposerLibraryService {
  private db: IDBDatabase | null = null;
  private readonly entriesSubject = new BehaviorSubject<CompositionSummary[]>([]);
  /**
   * The entry the composition open is - the one the next Save writes over - and which composition that is
   * (`ComposerState.documentId`). The one place it is held: the library panel is made again each time the composer page
   * is, and reads it here, so a save, a load or a Convert is not forgotten by leaving the page, nor a save or a delete
   * that lands after the page was left.
   */
  private readonly openEntrySubject = new BehaviorSubject<{ id: string; documentId: number } | null>(null);
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly ngZone: NgZone) {}

  getEntries(): Observable<CompositionSummary[]> {
    return this.entriesSubject.asObservable();
  }

  /**
   * Says the entry `id` is composition `documentId`, opened by something other than the library panel: a converted
   * `.gp` file, written and opened in one step (`GpConversionService`), so the next Save writes over it.
   */
  markOpened(id: string, documentId: number): void {
    this.rememberOpen(id, documentId);
  }

  /** Holds `id` - or null, none - as the entry composition `documentId` is. */
  rememberOpen(id: string | null, documentId: number): void {
    // `documentId` only moves on. A panel the page has left still has a write landing for the composition it knew, which
    // is not the one open now and must not displace its entry.
    const held = this.openEntrySubject.getValue();
    if (held && documentId < held.documentId) return;
    const next = id === null ? null : { id, documentId };
    if (next?.id !== held?.id || next?.documentId !== held?.documentId) this.openEntrySubject.next(next);
  }

  /** The entry composition `documentId` is, or null: one held for another composition is not this one's. */
  openEntryOf(documentId: number): string | null {
    const held = this.openEntrySubject.getValue();
    return held?.documentId === documentId ? held.id : null;
  }

  /** Each change of the entry held open (`rememberOpen`), for a view that draws it. */
  getOpenEntry(): Observable<{ id: string; documentId: number } | null> {
    return this.openEntrySubject.asObservable();
  }

  /**
   * Opens the database once; later calls await the same promise - until the open fails, or the connection is let go, and
   * the next call opens it again. A failed open kept would fail every call after it for as long as the page is open.
   */
  private ensureDb(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const opening = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('dateModified', 'dateModified');
          store.createIndex('title', 'title');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // A delete of the database, or an upgrade to a later version from another tab, waits until every connection to it
        // closes. Held open, this one would hold them up for as long as the page is open.
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
          if (this.readyPromise === opening) this.readyPromise = null;
        };
        this.db = db;
        resolve();
      };

      request.onerror = () => {
        if (this.readyPromise === opening) this.readyPromise = null;
        reject(request.error ?? new Error('Failed to open database'));
      };
    });

    this.readyPromise = opening;
    return opening;
  }

  /** The open database, opened first if need be. */
  private async database(): Promise<IDBDatabase> {
    await this.ensureDb();
    // Let go (`onversionchange`) between the open and now: the next call opens it again.
    if (!this.db) throw new Error('The composer library was closed while it was being opened');
    return this.db;
  }

  async refresh(): Promise<CompositionSummary[]> {
    const db = await this.database();

    const summaries = await new Promise<CompositionSummary[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();

      request.onsuccess = () => {
        const entries = (request.result as CompositionEntry[]).map(entry => {
          const { tex, ...summary } = entry;
          return summary;
        });
        entries.sort(
          (a, b) => new Date(b.dateModified).getTime() - new Date(a.dateModified).getTime()
        );
        resolve(entries);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to read compositions'));
    });

    // IndexedDB callbacks run outside Angular's zone.
    this.ngZone.run(() => this.entriesSubject.next(summaries));
    return summaries;
  }

  async get(id: string): Promise<CompositionEntry | null> {
    const db = await this.database();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);

      request.onsuccess = () => resolve((request.result as CompositionEntry) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read composition'));
    });
  }

  /**
   * Creates a composition, or updates it in place when `id` is supplied.
   * Returns the id, so a first save can adopt the generated one - once the
   * write has committed (`committed`), not merely been asked for. The list
   * read after it (`refresh`) failing is logged, not thrown: the write landed,
   * and a caller told it failed would say so - a conversion refused though its
   * composition was saved.
   */
  async save(
    entry: Omit<CompositionEntry, 'id' | 'dateCreated' | 'dateModified'>,
    id?: string
  ): Promise<string> {
    const existing = id ? await this.get(id) : null;
    const now = new Date();
    const record: CompositionEntry = {
      ...entry,
      id: existing?.id ?? id ?? this.generateId(),
      dateCreated: existing?.dateCreated ?? now,
      dateModified: now
    };

    const transaction = (await this.database()).transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await committed(transaction, 'Failed to save composition');

    await this.refresh().catch(error => console.error('Failed to list the composer library after a save:', error));
    return record.id;
  }

  /** Deletes a composition, resolving once the delete has committed; an id that is not there resolves too. */
  async delete(id: string): Promise<void> {
    const transaction = (await this.database()).transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    await committed(transaction, 'Failed to delete composition');

    await this.refresh();
  }

  private generateId(): string {
    return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
