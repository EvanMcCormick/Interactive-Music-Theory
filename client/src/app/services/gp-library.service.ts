import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GpLibraryEntry, GpLibraryFilter } from '../models/alpha-tab.model';

const DB_NAME = 'gp-library';
const DB_VERSION = 1;
const STORE_NAME = 'files';

@Injectable({
  providedIn: 'root'
})
export class GpLibraryService {
  private db: IDBDatabase | null = null;
  private entriesSubject = new BehaviorSubject<GpLibraryEntry[]>([]);

  constructor(private ngZone: NgZone) {
    this.initDatabase();
  }

  /**
   * Get observable of all library entries
   */
  getEntries(): Observable<GpLibraryEntry[]> {
    return this.entriesSubject.asObservable();
  }

  /**
   * Initialize IndexedDB database
   */
  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.loadAllEntries();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

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
  }

  /**
   * Load all entries from IndexedDB
   */
  private loadAllEntries(): void {
    if (!this.db) return;

    const transaction = this.db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      this.ngZone.run(() => {
        this.entriesSubject.next(request.result || []);
      });
    };

    request.onerror = () => {
      console.error('Failed to load entries:', request.error);
    };
  }

  /**
   * Add a GP file to the library
   */
  async addFile(file: File, metadata: Partial<GpLibraryEntry>): Promise<GpLibraryEntry> {
    if (!this.db) {
      await this.initDatabase();
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const entry: GpLibraryEntry = {
          id: this.generateId(),
          fileName: file.name,
          fileSize: file.size,
          fileData: reader.result as ArrayBuffer,
          title: metadata.title || this.extractTitleFromFileName(file.name),
          artist: metadata.artist || '',
          album: metadata.album || '',
          dateAdded: new Date(),
          key: metadata.key,
          detectedScales: metadata.detectedScales || [],
          detectedChords: metadata.detectedChords || [],
          trackCount: metadata.trackCount || 0,
          tempo: metadata.tempo || 120
        };

        const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = () => {
          this.loadAllEntries();
          resolve(entry);
        };

        request.onerror = () => {
          reject(request.error);
        };
      };

      reader.onerror = () => {
        reject(reader.error);
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Update an existing entry's metadata
   */
  async updateEntry(id: string, updates: Partial<GpLibraryEntry>): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        const updatedEntry = { ...entry, ...updates };
        const putRequest = store.put(updatedEntry);

        putRequest.onsuccess = () => {
          this.loadAllEntries();
          resolve();
        };

        putRequest.onerror = () => {
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  /**
   * Delete an entry from the library
   */
  async deleteEntry(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        this.loadAllEntries();
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(id: string): Promise<GpLibraryEntry | null> {
    if (!this.db) {
      await this.initDatabase();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
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
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.entriesSubject.next([]);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
