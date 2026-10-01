import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  SONG_PREFERENCES_STORAGE,
  SongSheetPreferences,
  SongSheetPreferencesService
} from './song-sheet-preferences.service';

/** An in-memory `Storage`, so these specs never touch the developer's own `localStorage`. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const KEY = 'songSheetPreferences';

/** How the sheet is shown to this viewer: names or numerals, and the lyric size - kept per browser, never in a song. */
describe('SongSheetPreferencesService', () => {
  let storage: MemoryStorage;

  function serviceWith(store: Storage | null): SongSheetPreferencesService {
    TestBed.configureTestingModule({ providers: [{ provide: SONG_PREFERENCES_STORAGE, useValue: store }] });
    return TestBed.inject(SongSheetPreferencesService);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('starts on chord names at the medium size when nothing is stored', () => {
    expect(serviceWith(storage).preferences).toEqual({ numerals: false, lyricSize: 'medium' });
  });

  it('reads back what an earlier visit chose', () => {
    storage.setItem(KEY, JSON.stringify({ numerals: true, lyricSize: 'large' }));
    expect(serviceWith(storage).preferences).toEqual({ numerals: true, lyricSize: 'large' });
  });

  it('keeps each stored choice it can read and defaults the rest', () => {
    storage.setItem(KEY, JSON.stringify({ numerals: 'yes', lyricSize: 'small' }));
    expect(serviceWith(storage).preferences).toEqual({ numerals: false, lyricSize: 'small' });
  });

  it('defaults everything over a stored value that is not JSON', () => {
    storage.setItem(KEY, '{not json');
    expect(serviceWith(storage).preferences).toEqual({ numerals: false, lyricSize: 'medium' });
  });

  it('publishes and stores each change', async () => {
    const service = serviceWith(storage);
    service.setNumerals(true);
    service.setLyricSize('small');

    const published: SongSheetPreferences = await firstValueFrom(service.preferences$);
    expect(published).toEqual({ numerals: true, lyricSize: 'small' });
    expect(JSON.parse(storage.getItem(KEY) ?? 'null')).toEqual({ numerals: true, lyricSize: 'small' });
  });

  it('does not publish a choice that changes nothing', () => {
    const service = serviceWith(storage);
    const seen: SongSheetPreferences[] = [];
    service.preferences$.subscribe(preferences => seen.push(preferences));
    service.setNumerals(false);
    service.setLyricSize('medium');
    expect(seen.length).toBe(1);
  });

  it('works for the visit when the browser gives it no storage', () => {
    const service = serviceWith(null);
    service.setNumerals(true);
    expect(service.preferences.numerals).toBeTrue();
  });

  it('keeps a choice for the visit when the browser refuses to store it', () => {
    spyOn(storage, 'setItem').and.throwError(new DOMException('Full', 'QuotaExceededError'));
    const service = serviceWith(storage);
    service.setLyricSize('large');
    expect(service.preferences.lyricSize).toBe('large');
  });

  it('starts on the defaults when the browser refuses to read storage', () => {
    spyOn(storage, 'getItem').and.throwError(new DOMException('Denied', 'SecurityError'));
    expect(serviceWith(storage).preferences).toEqual({ numerals: false, lyricSize: 'medium' });
  });
});
