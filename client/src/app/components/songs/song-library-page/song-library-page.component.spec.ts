import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SongLibraryPageComponent } from './song-library-page.component';
import { abortOnSuccess, deletedDatabase } from '../../../services/indexed-db.spec-helper';
import { SONG_LIBRARY_DB, SongLibraryService } from '../../../services/song-library.service';

/**
 * The Songs library (design Part 6): its cards, its search, New song, Duplicate, Delete, the card a corrupt song gets,
 * and where it says what went wrong. Against a library of its own in real IndexedDB, deleted after each spec.
 */
describe('SongLibraryPageComponent', () => {
  let fixture: ComponentFixture<SongLibraryPageComponent>;
  let library: SongLibraryService;
  let dbName: string;
  let host: HTMLElement;

  beforeEach(async () => {
    dbName = `song-library-page-spec-${Math.random().toString(36).slice(2)}`;
    await TestBed.configureTestingModule({
      imports: [SongLibraryPageComponent],
      providers: [provideRouter([]), { provide: SONG_LIBRARY_DB, useValue: dbName }]
    }).compileComponents();
    library = TestBed.inject(SongLibraryService);
  });

  afterEach(async () => {
    fixture?.destroy();
    await deletedDatabase(dbName);
  });

  /** Creates the page, which lists the library as it opens, and waits for that first list to be on screen. */
  async function open(): Promise<void> {
    fixture = TestBed.createComponent(SongLibraryPageComponent);
    host = fixture.nativeElement;
    fixture.detectChanges();
    await until(() => host.querySelector('.library-body')?.getAttribute('aria-busy') === 'false');
  }

  /** Resolves once `done` holds, checking every few milliseconds for up to two seconds: IndexedDB answers outside the zone. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; waited < 2000; waited += 10) {
      fixture.detectChanges();
      if (done()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    fixture.detectChanges();
  }

  const cards = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.song-card'));
  const titles = (): string[] => cards().map(card => card.querySelector('.card-title')?.textContent?.trim() ?? '');
  const text = (selector: string): string => host.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const status = (): string => text('.library-status');

  function search(query: string): void {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('No search box');
    input.value = query;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Opens `card`'s menu and presses the item `selector` names in it. */
  function choose(card: HTMLElement, selector: string): void {
    card.querySelector<HTMLButtonElement>('.card-menu-toggle')?.click();
    fixture.detectChanges();
    const item = card.querySelector<HTMLButtonElement>(selector);
    if (!item) throw new Error(`No ${selector} in the card's menu`);
    item.click();
  }

  /** Writes `record` straight into the store, past the service: how a corrupt record gets there. */
  async function putRaw(record: unknown): Promise<void> {
    await library.refresh();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('songs', 'readwrite');
        transaction.objectStore('songs').put(record);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }

  describe('cards', () => {
    it('shows a card for each song, newest first: title, artist, key, sections and when it was edited', async () => {
      await library.createSong({ title: 'Older', artist: 'Someone' });
      await new Promise(resolve => setTimeout(resolve, 2));
      await library.createSong({ title: 'Last Dance', artist: 'The Band', key: { tonic: 9, scaleId: 'aeolian', preferSharps: false } });

      await open();

      expect(titles()).toEqual(['Last Dance', 'Older']);
      const [first] = cards();
      expect(first.querySelector('.card-artist')?.textContent?.trim()).toBe('The Band');
      expect(first.querySelector('.card-key')?.textContent?.trim()).toBe('A Aeolian (Natural Minor)');
      expect(first.querySelector('.card-sections')?.textContent?.trim()).toBe('1 section');
      expect(first.querySelector('.card-edited')?.textContent?.trim()).toBe('Edited just now');
    });

    it('calls a song with no title "Untitled song", and leaves out an artist it does not have', async () => {
      await library.createSong();

      await open();

      expect(titles()).toEqual(['Untitled song']);
      expect(cards()[0].querySelector('.card-artist')).toBeNull();
    });

    it('opens a song from a real link to /songs/<id> across the whole card', async () => {
      const song = await library.createSong({ title: 'Linked' });

      await open();

      const link = cards()[0].querySelector<HTMLAnchorElement>('a.card-link');
      expect(link?.getAttribute('href')).toBe(`/songs/${song.id}`);
      expect(link?.textContent).toContain('Linked');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await library.createSong({ title: 'Last Dance', artist: 'The Band' });
      await library.createSong({ title: 'Café del Mar', artist: 'Energy 52' });
      await library.createSong({ title: 'Morning', artist: 'Dancing Feet' });
      await open();
    });

    it('filters on title and artist, ignoring case', () => {
      search('DANC');

      expect(titles().sort()).toEqual(['Last Dance', 'Morning']);
    });

    it('ignores accents, so "cafe" finds "Café"', () => {
      search('cafe');

      expect(titles()).toEqual(['Café del Mar']);
    });

    it('says so when nothing matches, quoting the search', () => {
      search('polka');

      expect(cards()).toEqual([]);
      expect(text('.empty-state')).toBe('No songs match "polka"');
    });

    it('shows every song again when the search is cleared', () => {
      search('polka');
      search('');

      expect(cards().length).toBe(3);
    });
  });

  describe('New song', () => {
    it('creates a song and opens it at /songs/<id>', async () => {
      await open();
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      host.querySelector<HTMLButtonElement>('.new-song')?.click();
      await until(() => navigate.calls.count() > 0);

      const summaries = await library.refresh();
      expect(summaries.length).toBe(1);
      expect(navigate).toHaveBeenCalledWith(['/songs', summaries[0].id]);
    });

    it('says why in the live region when the song could not be created, and goes nowhere', async () => {
      await open();
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      abortOnSuccess('add');

      host.querySelector<HTMLButtonElement>('.new-song')?.click();
      await until(() => status() !== '');

      expect(status()).toMatch(/^The song could not be created: /);
      expect(host.querySelector('.library-status [role="status"]')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("a card's menu", () => {
    beforeEach(async () => {
      await library.createSong({ title: 'Menu' });
      await open();
    });

    const toggle = (): HTMLButtonElement => {
      const button = cards()[0].querySelector<HTMLButtonElement>('.card-menu-toggle');
      if (!button) throw new Error('No menu toggle');
      return button;
    };

    it('opens on its button, and stays open: the click that opened it is not a click outside it', () => {
      toggle().click();
      fixture.detectChanges();

      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(getComputedStyle(cards()[0].querySelector('.menu-panel') as Element).display).not.toBe('none');
    });

    it('closes on a click outside it', () => {
      toggle().click();
      fixture.detectChanges();

      document.body.click();
      fixture.detectChanges();

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on Escape, giving the focus back to its button', () => {
      toggle().click();
      fixture.detectChanges();
      const duplicate = cards()[0].querySelector<HTMLButtonElement>('.card-duplicate');
      duplicate?.focus();

      duplicate?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle());
    });
  });

  describe('Duplicate', () => {
    it('adds a card for the copy', async () => {
      await library.createSong({ title: 'Original' });
      await open();

      choose(cards()[0], '.card-duplicate');
      await until(() => cards().length === 2);

      expect(titles().sort()).toEqual(['Original', 'Original (copy)']);
      expect(status()).toBe('Duplicated "Original"');
    });
  });

  describe('Delete', () => {
    it('asks first, naming the song, and removes its card when the answer is yes', async () => {
      await library.createSong({ title: 'Doomed' });
      await open();
      const confirm = spyOn(window, 'confirm').and.returnValue(true);

      choose(cards()[0], '.card-delete');
      await until(() => cards().length === 0);

      expect(confirm).toHaveBeenCalledOnceWith('Delete "Doomed"? This cannot be undone.');
      expect(await library.refresh()).toEqual([]);
      expect(status()).toBe('Deleted "Doomed"');
    });

    it('keeps the song when the answer is no', async () => {
      await library.createSong({ title: 'Spared' });
      await open();
      spyOn(window, 'confirm').and.returnValue(false);

      choose(cards()[0], '.card-delete');
      await new Promise(resolve => setTimeout(resolve, 50));
      fixture.detectChanges();

      expect(titles()).toEqual(['Spared']);
      expect((await library.refresh()).length).toBe(1);
    });
  });

  describe('a song that cannot be read', () => {
    beforeEach(async () => {
      await putRaw({
        id: 'broken',
        revision: 1,
        createdAt: 1,
        updatedAt: Date.now(),
        content: { type: 'doc', attrs: { title: 'Broken' } }
      });
      await open();
    });

    it('gets a card that says why, under the title it still has', () => {
      expect(titles()).toEqual(['Broken']);
      expect(text('.song-card .card-reason')).toMatch(/^This song cannot be opened: ./);
    });

    it('offers Delete and nothing else: no link to open it, and no Duplicate', () => {
      const [card] = cards();
      expect(card.querySelector('a')).toBeNull();
      expect(card.querySelector('.card-duplicate')).toBeNull();
      expect(Array.from(card.querySelectorAll('button')).map(button => button.textContent?.trim())).toEqual(['Delete']);
    });

    it('deletes it, after asking', async () => {
      spyOn(window, 'confirm').and.returnValue(true);

      cards()[0].querySelector<HTMLButtonElement>('.card-delete')?.click();
      await until(() => cards().length === 0);

      expect(window.confirm).toHaveBeenCalledOnceWith('Delete "Broken"? This cannot be undone.');
    });
  });

  describe('empty', () => {
    it('says there are no songs yet, beside a way to make one', async () => {
      await open();

      expect(cards()).toEqual([]);
      expect(text('.empty-state')).toBe('No songs yet — New song');
      expect(host.querySelector('.empty-state button')?.textContent?.trim()).toBe('New song');
    });
  });

  describe('failures', () => {
    it('says what went wrong in a polite live region that was on the page before it spoke', async () => {
      await open();
      const region = host.querySelector('.library-status [role="status"]');
      spyOn(library, 'duplicateSong').and.rejectWith(new Error('This song is no longer in the library.'));
      await library.createSong({ title: 'Gone' });
      await until(() => cards().length === 1);

      choose(cards()[0], '.card-duplicate');
      await until(() => status() !== '');

      expect(status()).toBe('This song is no longer in the library.');
      expect(host.querySelector('.library-status [role="status"]')).toBe(region);
    });

    it('says a failure twice in a row as a change, so it is announced again', async () => {
      await open();
      spyOn(library, 'duplicateSong').and.rejectWith(new Error('No.'));
      await library.createSong({ title: 'Twice' });
      await until(() => cards().length === 1);
      const spans = (): string[] =>
        Array.from(host.querySelectorAll('.library-status [role="status"]')).map(span => span.textContent ?? '');

      choose(cards()[0], '.card-duplicate');
      await until(() => status() !== '');
      const first = spans();
      choose(cards()[0], '.card-duplicate');
      await until(() => spans().join() !== first.join());

      expect(spans()).not.toEqual(first);
      expect(status()).toBe('No.');
    });
  });
});
