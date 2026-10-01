import { Injectable, InjectionToken, NgZone, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GpLibraryEntry, GpLibraryFilter, GpLibrarySummary } from '../models/alpha-tab.model';
import { committed } from './indexed-db';

const DB_VERSION = 1;
const STORE_NAME = 'files';

/**
 * The IndexedDB database the library keeps its files in: `gp-library`. A token so each spec can open a database of its
 * own and delete it after, rather than share - or wipe - the one a developer's browser holds. A spec that injects the
 * real `GpLibraryService` must override it: the constructor opens the database at once, so merely injecting the service
 * opens `gp-library`.
 */
export const GP_LIBRARY_DB = new InjectionToken<string>('GP_LIBRARY_DB', { providedIn: 'root', factory: () => 'gp-library' });

/** What a caller can say about a file it adds; everything else is filled in (`addBytes`). */
export type GpFileMetadata = Partial<Omit<GpLibraryEntry, 'id' | 'fileName' | 'fileSize' | 'fileData' | 'dateAdded'>>;

/**
 * The library of `.gp` files: IndexedDB, the gallery's source, and where the composer's Original state reads a file from.
 *
 * **One database promise** (`ensureDb`), as `ComposerLibraryService` keeps. The service used to start opening the
 * database from its constructor and keep no hold on the promise, so a write arriving before it opened either opened it a
 * second time or - `updateEntry`, `deleteEntry`, `clearLibrary` - resolved having done nothing. The conversion deletes
 * a file's entry once its composition is written, and a delete that did nothing would say it had.
 */
@Injectable({
  providedIn: 'root'
})
export class GpLibraryService {
  private readyPromise: Promise<IDBDatabase> | null = null;
  private entriesSubject = new BehaviorSubject<GpLibrarySummary[]>([]);
  private readonly dbName: string = inject(GP_LIBRARY_DB);

  constructor(private ngZone: NgZone) {
    // The gallery lists the library as soon as it is shown.
    void this.loadAllEntries().catch(error => console.error('Failed to open the GP library:', error));
  }

  /** Every entry, without its bytes (`loadAllEntries`): a reader of a file's bytes reads its entry (`getEntry`). */
  getEntries(): Observable<GpLibrarySummary[]> {
    return this.entriesSubject.asObservable();
  }

  /**
   * Opens the database once; later calls await the same promise - until the open fails, or the connection is let go, and
   * the next call opens it again. A failed open kept would fail every call after it for as long as the page is open.
   */
  private ensureDb(): Promise<IDBDatabase> {
    if (this.readyPromise) return this.readyPromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => {
        if (this.readyPromise === opening) this.readyPromise = null;
        reject(request.error ?? new Error('Failed to open the GP library'));
      };
      request.onsuccess = () => {
        const db = request.result;
        // A delete of the database, or an upgrade to a later version from another tab, waits until every connection to it
        // closes. Held open, this one would hold them up for as long as the page is open.
        db.onversionchange = () => {
          db.close();
          if (this.readyPromise === opening) this.readyPromise = null;
        };
        resolve(db);
      };
      request.onupgradeneeded = () => {
        const db = request.result;

        // Create object store for GP files
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

          // Create indexes for searching/filtering
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('artist', 'artist', { unique: false });
          store.createIndex('dateAdded', 'dateAdded', { unique: false });
          store.createIndex('key', 'key', { unique: false });
        }
      };
    });
    this.readyPromise = opening;
    return opening;
  }

  /**
   * Runs `body` against the store in one transaction and resolves with what its request returns: a read once the
   * request has, a write once the transaction has committed (`committed`).
   */
  private async inStore<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.ensureDb();
    const transaction = db.transaction(STORE_NAME, mode);
    const request = body(transaction.objectStore(STORE_NAME));
    if (mode !== 'readonly') {
      await committed(transaction, 'The GP library could not be written');
      return request.result as T;
    }
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('The GP library could not be read'));
    });
  }

  /**
   * Lists the library, every entry without its bytes (`GpLibrarySummary`). The list is kept for the session by a root
   * service the composer page injects too, for its drawer's titles; kept whole, a first visit to the composer held every
   * file's bytes until the tab closed.
   *
   * Read through a cursor, one entry at a time, rather than `getAll`, so no more than one file's bytes are held at once,
   * and none once read. They are still read: IndexedDB has no way to read part of a record, and the store's indexes
   * (`title`, `artist`, `dateAdded`, `key`) carry only their own field and the id. Not reading them at all needs the
   * metadata in a store of its own (`docs/TODO.md`).
   */
  private async loadAllEntries(): Promise<void> {
    const db = await this.ensureDb();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const summaries: GpLibrarySummary[] = [];
    const cursor = transaction.objectStore(STORE_NAME).openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      const { fileData, ...summary } = at.value as GpLibraryEntry;
      summaries.push(summary);
      at.continue();
    };
    await committed(transaction, 'The GP library could not be read');
    // IndexedDB callbacks run outside Angular's zone.
    this.ngZone.run(() => this.entriesSubject.next(summaries));
  }

  /**
   * Add a GP file to the library
   */
  async addFile(file: File, metadata: GpFileMetadata): Promise<GpLibraryEntry> {
    return this.addBytes(await file.arrayBuffer(), file.name, metadata);
  }

  /**
   * Adds `bytes` as a file named `fileName`, with what `metadata` says of it, and returns the entry. A title the metadata
   * does not give is the file name's; a tempo and a track count it does not give are 120 and 0, which is what a file no
   * one parsed can say.
   */
  async addBytes(bytes: ArrayBuffer, fileName: string, metadata: GpFileMetadata): Promise<GpLibraryEntry> {
    const entry: GpLibraryEntry = {
      id: this.generateId(),
      fileName,
      fileSize: bytes.byteLength,
      fileData: bytes,
      title: metadata.title || this.extractTitleFromFileName(fileName),
      artist: metadata.artist || '',
      album: metadata.album || '',
      dateAdded: new Date(),
      key: metadata.key,
      detectedScales: metadata.detectedScales || [],
      detectedChords: metadata.detectedChords || [],
      trackCount: metadata.trackCount || 0,
      tempo: metadata.tempo || 120
    };
    await this.inStore('readwrite', store => store.add(entry));
    await this.loadAllEntries();
    return entry;
  }

  /**
   * Updates an existing entry's metadata, or rejects with 'Entry not found'. Read and written in one transaction: in
   * two, a delete could land between them, and the write would put the deleted entry back.
   */
  async updateEntry(id: string, updates: Partial<GpLibraryEntry>): Promise<void> {
    const db = await this.ensureDb();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let found = false;
    const read = store.get(id);
    read.onsuccess = () => {
      const entry = read.result as GpLibraryEntry | undefined;
      if (!entry) return;
      found = true;
      store.put({ ...entry, ...updates, id });
    };
    await committed(transaction, 'The GP library entry could not be updated');
    if (!found) throw new Error('Entry not found');
    await this.loadAllEntries();
  }

  /**
   * Deletes an entry from the library, resolving once the delete has committed. Deleting an id that is not there
   * resolves too - IndexedDB counts it a success - which Convert relies on: deleting a file's entry twice is harmless.
   */
  async deleteEntry(id: string): Promise<void> {
    await this.inStore('readwrite', store => store.delete(id));
    // Settled on the commit: the list read after it failing is logged, not thrown, since a caller told the delete failed
    // would say the entry is still there - a conversion saying the original was kept when it is gone.
    await this.loadAllEntries().catch(error => console.error('Failed to list the GP library after a delete:', error));
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(id: string): Promise<GpLibraryEntry | null> {
    return (await this.inStore<GpLibraryEntry | undefined>('readonly', store => store.get(id))) ?? null;
  }


  /**
   * Filter entries based on criteria
   */
  filterEntries(entries: GpLibrarySummary[], filter: GpLibraryFilter): GpLibrarySummary[] {
    return entries.filter(entry => {
      // Search text filter
      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        const matchesSearch =
          entry.title.toLowerCase().includes(searchLower) ||
          entry.artist?.toLowerCase().includes(searchLower) ||
          entry.album?.toLowerCase().includes(searchLower) ||
          entry.fileName.toLowerCase().includes(searchLower);

        if (!matchesSearch) return false;
      }

      // Key filter
      if (filter.key !== undefined && entry.key !== filter.key) {
        return false;
      }

      // Scale filter
      if (filter.scaleIds && filter.scaleIds.length > 0) {
        const hasMatchingScale = entry.detectedScales?.some(
          scale => filter.scaleIds!.includes(scale)
        );
        if (!hasMatchingScale) return false;
      }

      // Chord filter
      if (filter.chordIds && filter.chordIds.length > 0) {
        const hasMatchingChord = entry.detectedChords?.some(
          chord => filter.chordIds!.includes(chord)
        );
        if (!hasMatchingChord) return false;
      }

      return true;
    });
  }

  /**
   * Sort entries by specified field
   */
  sortEntries(
    entries: GpLibrarySummary[],
    sortBy: 'title' | 'artist' | 'dateAdded' | 'tempo',
    ascending = true
  ): GpLibrarySummary[] {
    return [...entries].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'artist':
          comparison = (a.artist || '').localeCompare(b.artist || '');
          break;
        case 'dateAdded':
          comparison = new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
          break;
        case 'tempo':
          comparison = (a.tempo || 0) - (b.tempo || 0);
          break;
      }

      return ascending ? comparison : -comparison;
    });
  }

  /**
   * Generate a unique ID for entries
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract a display title from the file name
   */
  private extractTitleFromFileName(fileName: string): string {
    // Remove extension
    const withoutExt = fileName.replace(/\.(gp|gp3|gp4|gp5|gpx)$/i, '');
    // Replace underscores and hyphens with spaces
    return withoutExt.replace(/[_-]/g, ' ').trim();
  }

  /**
   * Clear all entries from the library
   */
  async clearLibrary(): Promise<void> {
    await this.inStore('readwrite', store => store.clear());
    this.ngZone.run(() => this.entriesSubject.next([]));
  }
}
