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
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly ngZone: NgZone) {}

  getEntries(): Observable<CompositionSummary[]> {
    return this.entriesSubject.asObservable();
  }

  /** Opens the database once; later calls await the same promise. */
  private ensureDb(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
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
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
    });

    return this.readyPromise;
  }

  async refresh(): Promise<CompositionSummary[]> {
    await this.ensureDb();

    const summaries = await new Promise<CompositionSummary[]>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
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
    await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);

      request.onsuccess = () => resolve((request.result as CompositionEntry) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read composition'));
    });
  }

  /**
   * Creates a composition, or updates it in place when `id` is supplied.
   * Returns the id, so a first save can adopt the generated one.
   */
  async save(
    entry: Omit<CompositionEntry, 'id' | 'dateCreated' | 'dateModified'>,
    id?: string
  ): Promise<string> {
    await this.ensureDb();

    const existing = id ? await this.get(id) : null;
    const now = new Date();
    const record: CompositionEntry = {
      ...entry,
      id: existing?.id ?? id ?? this.generateId(),
      dateCreated: existing?.dateCreated ?? now,
      dateModified: now
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Failed to save composition'));
    });

    await this.refresh();
    return record.id;
  }

  async delete(id: string): Promise<void> {
    await this.ensureDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Failed to delete composition'));
    });

    await this.refresh();
  }

  private generateId(): string {
    return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
