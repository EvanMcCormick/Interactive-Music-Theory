import { TestBed } from '@angular/core/testing';
import { Node } from 'prosemirror-model';
import { firstValueFrom } from 'rxjs';
import { ProgressionKey, createDegreeSlot } from '../models/progression.model';
import { SongDoc, SongSummary } from '../models/song.model';
import { abortOnSuccess, deletedDatabase } from './indexed-db.spec-helper';
import { regenerateSlot } from './progression-edit';
import { atomAttrsOf, createSongContent } from './song-document';
import { SONG_LIBRARY_DB, SongLibraryService } from './song-library.service';
import { songSchema } from './song-schema';

/**
 * The library of songs, against real IndexedDB under Karma.
 *
 * Each spec opens a database of its own through `SONG_LIBRARY_DB` and deletes it
 * after with `deletedDatabase`, which fails the spec if the service left a
 * connection open: the service must let its database go when asked.
 */
describe('SongLibraryService', () => {
  let dbName: string;
  let library: SongLibraryService;

  const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];

  /** Two sections holding two chords, a tab block and a memo: one of every node that carries an id. */
  function fullSong(title: string): Node {
    const chord = (degree: number): Node =>
      songSchema.node('chord', atomAttrsOf(regenerateSlot(createDegreeSlot(degree, 0), C_MAJOR, IONIAN)));
    return songSchema.node('doc', { ...createSongContent().attrs, title, artist: 'The Band' }, [
      songSchema.node('section', { id: 'sec-1', label: 'Verse 1', kind: 'verse' }, [
        songSchema.node('lyricLine', null, [chord(0), songSchema.text('Wondering '), chord(4), songSchema.text('where')])
      ]),
      songSchema.node('section', { id: 'sec-2', label: 'Chorus', kind: 'chorus' }, [
        songSchema.node('tabBlock', {
          id: 'tab-1',
          name: 'Riff',
          score: { title: '', subTitle: '', artist: '', album: '', tempo: 100, masterBars: [], tracks: [] }
        }),
        songSchema.node('memo', { id: 'memo-1', name: 'Hum', durationSec: 12.5 })
      ])
    ]);
  }

  /** Every id in `content`, in document order. */
  function idsIn(content: SongDoc['content']): string[] {
    const ids: string[] = [];
    Node.fromJSON(songSchema, content).descendants(node => {
      if (typeof node.attrs['id'] === 'string') ids.push(node.attrs['id']);
    });
    return ids;
  }

  /** `content` with every id blanked, so two songs can be compared for everything but their ids. */
  function withoutIds(content: SongDoc['content']): unknown {
    return JSON.parse(JSON.stringify(content), (key, value) => (key === 'id' ? '' : value));
  }

  /**
   * Writes `record` straight into the store, past the service: how a corrupt record gets there. The service lists the
   * library first, so the database and its store exist before this opens it.
   */
  async function putRaw(record: unknown): Promise<void> {
    await library.refresh();
    return new Promise<void>((resolve, reject) => {
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

  /** Waits until the clock has moved on, so two writes get different `updatedAt`s. */
  async function nextMillisecond(): Promise<void> {
    const start = Date.now();
    while (Date.now() === start) await new Promise(resolve => setTimeout(resolve, 1));
  }

  beforeEach(() => {
    dbName = `song-library-spec-${crypto.randomUUID()}`;
    TestBed.configureTestingModule({ providers: [{ provide: SONG_LIBRARY_DB, useValue: dbName }] });
    library = TestBed.inject(SongLibraryService);
  });

  afterEach(async () => {
    await deletedDatabase(dbName);
  });

  describe('createSong', () => {
    it('stores a new song at revision 1 with the default facts and one empty verse, and returns it', async () => {
      const song = await library.createSong();

      expect(song.revision).toBe(1);
      expect(song.createdAt).toBe(song.updatedAt);
      const loaded = await library.loadSong(song.id);
      expect(loaded?.kind).toBe('song');
      if (loaded?.kind !== 'song') return;
      expect(loaded.doc).toEqual(song);
      expect(loaded.node.attrs['title']).toBe('');
      expect(loaded.node.childCount).toBe(1);
      expect(loaded.node.child(0).attrs['label']).toBe('Verse 1');
    });

    it('starts the song with the facts it is given', async () => {
      const song = await library.createSong({ title: 'Last Dance', tempo: 84 });

      const summary = (await library.refresh()).find(entry => entry.id === song.id);
      expect(summary?.title).toBe('Last Dance');
      expect(song.content['attrs']).toEqual(jasmine.objectContaining({ title: 'Last Dance', tempo: 84 }));
    });

    it('gives each song an id of its own', async () => {
      const first = await library.createSong();
      const second = await library.createSong();

      expect(first.id).not.toBe(second.id);
    });

    it('refuses a create whose transaction aborts after its write succeeded, and keeps nothing', async () => {
      abortOnSuccess('add');

      const failure = library.createSong({ title: 'Lost' });

      await expectAsync(failure).toBeRejectedWithError(/song/i);
      expect(await library.refresh()).toEqual([]);
    });
  });

  describe('loadSong', () => {
    it('gives null for an id that is not in the library', async () => {
      expect(await library.loadSong('nobody')).toBeNull();
    });

    it('reads back the song as stored, as a record and as a checked document', async () => {
      const created = await library.createSong();
      const content = fullSong('Last Dance');
      const saved = await library.saveSong({ ...created, content: content.toJSON() });

      const loaded = await library.loadSong(created.id);

      expect(loaded?.kind).toBe('song');
      if (loaded?.kind !== 'song') return;
      expect(loaded.doc).toEqual(saved);
      expect(loaded.node.eq(content)).toBeTrue();
    });

    it('refuses a record whose content is not a song, with the reason, rather than throwing', async () => {
      const created = await library.createSong();
      await putRaw({ ...created, content: { type: 'doc', attrs: { title: 'Broken' }, content: [{ type: 'nonsense' }] } });

      const loaded = await library.loadSong(created.id);

      expect(loaded?.kind).toBe('unreadable');
      if (loaded?.kind !== 'unreadable') return;
      expect(loaded.reason).toMatch(/nonsense/);
    });

    it('refuses a record that is not even a song record, with the reason', async () => {
      await putRaw({ id: 'odd', revision: 'seven', content: null });

      const loaded = await library.loadSong('odd');

      expect(loaded?.kind).toBe('unreadable');
      if (loaded?.kind !== 'unreadable') return;
      expect(loaded.reason).toMatch(/revision/);
    });
  });

  describe('saveSong', () => {
    it('writes the content, bumps the revision and the time it was updated, and keeps when it was made', async () => {
      const created = await library.createSong();
      await nextMillisecond();

      const saved = await library.saveSong({ ...created, content: fullSong('Second').toJSON() });

      expect(saved.revision).toBe(2);
      expect(saved.createdAt).toBe(created.createdAt);
      expect(saved.updatedAt).toBeGreaterThan(created.updatedAt);
      const loaded = await library.loadSong(created.id);
      expect(loaded?.kind === 'song' ? loaded.doc : null).toEqual(saved);
    });

    it('takes the song it returned for the next save, so saves can follow one another', async () => {
      let song = await library.createSong();
      for (const title of ['One', 'Two', 'Three']) {
        song = await library.saveSong({ ...song, content: fullSong(title).toJSON() });
      }

      expect(song.revision).toBe(4);
      expect((await library.refresh())[0].title).toBe('Three');
    });

    it('refuses a save from a copy older than the one stored - another tab saved since - and keeps the newer', async () => {
      const opened = await library.createSong();
      const elsewhere = await library.saveSong({ ...opened, content: fullSong('From the other tab').toJSON() });

      const stale = library.saveSong({ ...opened, content: fullSong('From this tab').toJSON() });

      await expectAsync(stale).toBeRejectedWithError(/another tab/);
      const loaded = await library.loadSong(opened.id);
      expect(loaded?.kind === 'song' ? loaded.doc : null).toEqual(elsewhere);
    });

    it('refuses a save of a song that has been deleted, rather than bringing it back', async () => {
      const song = await library.createSong();
      await library.deleteSong(song.id);

      await expectAsync(library.saveSong(song)).toBeRejectedWithError(/no longer in the library/);
      expect(await library.loadSong(song.id)).toBeNull();
    });

    it('refuses to write content it could not read back, and keeps what was stored', async () => {
      const song = await library.createSong();

      const broken = library.saveSong({ ...song, content: { type: 'doc', content: [] } });

      await expectAsync(broken).toBeRejectedWithError(/not saved/);
      const loaded = await library.loadSong(song.id);
      expect(loaded?.kind === 'song' ? loaded.doc : null).toEqual(song);
    });

    it('refuses a save whose transaction aborts after its write succeeded, and keeps what was stored', async () => {
      const song = await library.createSong();
      abortOnSuccess('put');

      const failure = library.saveSong({ ...song, content: fullSong('Lost').toJSON() });

      await expectAsync(failure).toBeRejectedWithError(/song/i);
      const loaded = await library.loadSong(song.id);
      expect(loaded?.kind === 'song' ? loaded.doc : null).toEqual(song);
    });

    it('resolves a save once it has committed, though the list read after it fails', async () => {
      const song = await library.createSong();
      library.getSummaries().subscribe();
      const logged = spyOn(console, 'error');
      const listed = spyOn(library, 'refresh').and.rejectWith(new Error('read failed'));

      const saved = await library.saveSong({ ...song, content: fullSong('Landed').toJSON() });

      expect(saved.revision).toBe(2);
      expect(listed).toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
    });
  });

  describe('duplicateSong', () => {
    it('copies a song under a new id and "(copy)" title, at revision 1, leaving the original alone', async () => {
      const original = await library.saveSong({ ...(await library.createSong()), content: fullSong('Last Dance').toJSON() });

      const id = await library.duplicateSong(original.id);

      expect(id).not.toBe(original.id);
      const copy = await library.loadSong(id);
      expect(copy?.kind).toBe('song');
      if (copy?.kind !== 'song') return;
      expect(copy.doc.revision).toBe(1);
      expect(copy.node.attrs['title']).toBe('Last Dance (copy)');
      expect(copy.node.attrs['artist']).toBe('The Band');
      const kept = await library.loadSong(original.id);
      expect(kept?.kind === 'song' ? kept.doc : null).toEqual(original);
    });

    it('gives every section, chord, tab block and memo of the copy a fresh id, and changes nothing else', async () => {
      const original = await library.saveSong({ ...(await library.createSong()), content: fullSong('Last Dance').toJSON() });

      const copy = await library.loadSong(await library.duplicateSong(original.id));

      if (copy?.kind !== 'song') return fail('The copy should read back as a song');
      const before = idsIn(original.content);
      const after = idsIn(copy.doc.content);
      expect(before.length).toBe(6);
      expect(after.length).toBe(before.length);
      expect(new Set(after).size).toBe(after.length);
      expect(after.filter(id => before.includes(id))).toEqual([]);
      const { attrs: copiedAttrs, ...copiedRest } = withoutIds(copy.doc.content) as Record<string, unknown>;
      const { attrs: originalAttrs, ...originalRest } = withoutIds(original.content) as Record<string, unknown>;
      expect(copiedRest).toEqual(originalRest);
      expect({ ...(copiedAttrs as object), title: '' }).toEqual({ ...(originalAttrs as object), title: '' });
    });

    it('calls the copy of an untitled song "Untitled song (copy)"', async () => {
      const original = await library.createSong();

      const copy = await library.loadSong(await library.duplicateSong(original.id));

      expect(copy?.kind === 'song' ? copy.node.attrs['title'] : null).toBe('Untitled song (copy)');
    });

    it('refuses to copy a song that is not there, or one that cannot be read', async () => {
      await putRaw({ id: 'broken', revision: 1, createdAt: 1, updatedAt: 1, content: { type: 'doc' } });

      await expectAsync(library.duplicateSong('nobody')).toBeRejectedWithError(/no longer in the library/);
      await expectAsync(library.duplicateSong('broken')).toBeRejectedWithError(/cannot be read/);
      expect((await library.refresh()).length).toBe(1);
    });
  });

  describe('deleteSong', () => {
    it('deletes the song, and an id that is not there deletes nothing and resolves', async () => {
      const gone = await library.createSong({ title: 'Gone' });
      const kept = await library.createSong({ title: 'Kept' });

      await library.deleteSong(gone.id);
      await library.deleteSong('nobody');

      expect(await library.loadSong(gone.id)).toBeNull();
      expect((await library.refresh()).map(summary => summary.id)).toEqual([kept.id]);
    });

    it('refuses a delete whose transaction aborts after its request succeeded, and keeps the song', async () => {
      const song = await library.createSong();
      abortOnSuccess('delete');

      await expectAsync(library.deleteSong(song.id)).toBeRejectedWithError(/song/i);

      expect(await library.loadSong(song.id)).not.toBeNull();
    });
  });

  describe('getSummaries', () => {
    it('lists every song newest first, and lists them again after each write', async () => {
      const seen: SongSummary[][] = [];
      library.getSummaries().subscribe(list => seen.push(list));

      const older = await library.createSong({ title: 'Older' });
      await nextMillisecond();
      const newer = await library.createSong({ title: 'Newer' });
      const titles = (): string[] => seen[seen.length - 1].map(summary => summary.title);
      expect(titles()).toEqual(['Newer', 'Older']);

      await nextMillisecond();
      await library.saveSong({ ...older, content: fullSong('Older, edited').toJSON() });
      expect(titles()).toEqual(['Older, edited', 'Newer']);

      await library.duplicateSong(newer.id);
      expect(titles()).toEqual(['Newer (copy)', 'Older, edited', 'Newer']);

      await library.deleteSong(newer.id);
      expect(titles()).toEqual(['Newer (copy)', 'Older, edited']);
    });

    it('does not read the list after a write while nothing watches it, and reads it afresh when asked', async () => {
      const listed = spyOn(library, 'refresh').and.callThrough();

      const song = await library.createSong({ title: 'Unwatched' });
      await library.saveSong({ ...song, content: fullSong('Edited unwatched').toJSON() });
      await library.duplicateSong(song.id);
      await library.deleteSong(song.id);

      expect(listed).not.toHaveBeenCalled();
      expect((await library.refresh()).map(summary => summary.title)).toEqual(['Edited unwatched (copy)']);
    });

    it('summarises each song from its content - key, section count - and holds no content', async () => {
      const song = await library.saveSong({ ...(await library.createSong()), content: fullSong('Last Dance').toJSON() });

      await library.refresh();
      const [summary] = await firstValueFrom(library.getSummaries());

      expect(summary).toEqual({
        id: song.id,
        title: 'Last Dance',
        artist: 'The Band',
        key: C_MAJOR,
        sectionCount: 2,
        updatedAt: song.updatedAt,
        unreadable: null
      });
      expect(Object.keys(summary)).not.toContain('content');
    });

    it('lists a corrupt record as unreadable, with the reason and the title it still has, rather than dropping it', async () => {
      await library.createSong({ title: 'Fine' });
      await putRaw({ id: 'broken', revision: 1, createdAt: 1, updatedAt: 1, content: { type: 'doc', attrs: { title: 'Broken' } } });
      await putRaw({ id: 'odd', content: 'not a song' });

      const summaries = await library.refresh();

      expect(summaries.map(summary => [summary.title, summary.unreadable === null])).toEqual([
        ['Fine', true],
        ['Broken', false],
        ['', false]
      ]);
      expect(summaries[1].key).toBeNull();
      expect(summaries[2].id).toBe('odd');
      expect(summaries[2].unreadable).toMatch(/revision/);
    });
  });

  describe('its database', () => {
    it('lets its database go when it is deleted, and opens it afresh on the next call', async () => {
      await library.createSong({ title: 'Gone' });

      await deletedDatabase(dbName);

      await library.createSong({ title: 'New' });
      expect((await library.refresh()).map(summary => summary.title)).toEqual(['New']);
    });

    it('opens again after an open that failed, rather than failing for good', async () => {
      // A database already at a later version refuses the service's open (VersionError).
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 99);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });

      await expectAsync(library.refresh()).toBeRejectedWithError(/song library could not be opened/);
      await deletedDatabase(dbName);

      expect(await library.refresh()).toEqual([]);
    });
  });
});
