import { Injectable, InjectionToken, NgZone, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GpLibraryEntry, GpLibraryFilter } from '../models/alpha-tab.model';

const DB_VERSION = 1;
const STORE_NAME = 'files';

/**
 * The IndexedDB database the library keeps its files in: `gp-library`. A token so each spec can open a database of its
 * own and delete it after, rather than share - or wipe - the one a developer's browser holds.
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
  private entriesSubject = new BehaviorSubject<GpLibraryEntry[]>([]);
  private readonly dbName: string = inject(GP_LIBRARY_DB);

  constructor(private ngZone: NgZone) {
    // The gallery lists the library as soon as it is shown.
    void this.loadAllEntries().catch(error => console.error('Failed to open the GP library:', error));
  }

  /**
   * Get observable of all library entries
   */
  getEntries(): Observable<GpLibraryEntry[]> {
    return this.entriesSubject.asObservable();
  }

  /** Opens the database once; later calls await the same promise. */
  private ensureDb(): Promise<IDBDatabase> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => reject(request.error ?? new Error('Failed to open the GP library'));
      request.onsuccess = () => resolve(request.result);
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
    return this.readyPromise;
  }

  /** Runs `body` against the store in one transaction and resolves with what its request returns. */
  private async inStore<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.ensureDb();
    return new Promise<T>((resolve, reject) => {
      const request = body(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('The GP library could not be read or written'));
    });
  }

  /**
   * Load all entries from IndexedDB
   */
  private async loadAllEntries(): Promise<void> {
    const entries = await this.inStore<GpLibraryEntry[]>('readonly', store => store.getAll());
    // IndexedDB callbacks run outside Angular's zone.
    this.ngZone.run(() => this.entriesSubject.next(entries ?? []));
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
   * Update an existing entry's metadata
   */
  async updateEntry(id: string, updates: Partial<GpLibraryEntry>): Promise<void> {
    const entry = await this.getEntry(id);
    if (!entry) throw new Error('Entry not found');
    await this.inStore('readwrite', store => store.put({ ...entry, ...updates, id }));
    await this.loadAllEntries();
  }

  /**
   * Delete an entry from the library
   */
  async deleteEntry(id: string): Promise<void> {
    await this.inStore('readwrite', store => store.delete(id));
    await this.loadAllEntries();
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(id: string): Promise<GpLibraryEntry | null> {
    return (await this.inStore<GpLibraryEntry | undefined>('readonly', store => store.get(id))) ?? null;
  }

  /**
   * Get file data as ArrayBuffer for a library entry
   */
  async getFileData(id: string): Promise<ArrayBuffer | null> {
    const entry = await this.getEntry(id);
    return entry?.fileData || null;
  }

  /**
   * Filter entries based on criteria
   */
  filterEntries(entries: GpLibraryEntry[], filter: GpLibraryFilter): GpLibraryEntry[] {
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
    entries: GpLibraryEntry[],
    sortBy: 'title' | 'artist' | 'dateAdded' | 'tempo',
    ascending = true
  ): GpLibraryEntry[] {
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
