import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { GP_LIBRARY_DB, GpLibraryService } from './gp-library.service';

/**
 * The library of `.gp` files, against real IndexedDB under Karma - each spec in a database of its own
 * (`GP_LIBRARY_DB`), deleted after it, so nothing here touches the library a browser already holds.
 */
describe('GpLibraryService', () => {
  let service: GpLibraryService;
  let dbName: string;

  beforeEach(() => {
    dbName = `gp-library-spec-${Math.random().toString(36).slice(2)}`;
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: dbName }] });
    service = TestBed.inject(GpLibraryService);
  });

  afterEach(async () => {
    // Wait for the service's own open to settle, so the delete is not blocked by a connection still opening.
    await service.getEntry('none');
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

  it('adds bytes as a file, filling in what the caller does not say, and reads them back', async () => {
    const added = await service.addBytes(bytes(1, 2, 3), 'My_Song-take.gp', { trackCount: 4 });

    const read = await service.getEntry(added.id);
    expect(read?.fileName).toBe('My_Song-take.gp');
    expect(read?.fileSize).toBe(3);
    expect(Array.from(new Uint8Array(read!.fileData))).toEqual([1, 2, 3]);
    expect(read?.title).toBe('My Song take');
    expect(read?.trackCount).toBe(4);
    expect(read?.tempo).toBe(120);
  });

  it('adds a File through the same path', async () => {
    const added = await service.addFile(new File([new Uint8Array([9])], 'one.gp'), { title: 'One' });

    expect((await service.getEntry(added.id))?.title).toBe('One');
  });

  it('adds rather than overwrites: the same file added twice is two entries', async () => {
    await service.addBytes(bytes(1), 'a.gp', {});
    await service.addBytes(bytes(1), 'a.gp', {});

    const entries = await firstValueFrom(service.getEntries().pipe(filter(list => list.length === 2)));
    expect(entries.length).toBe(2);
  });

  it('updates an entry in place, and refuses one that is not there', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});

    await service.updateEntry(added.id, { tempo: 96, trackCount: 3 });

    const read = await service.getEntry(added.id);
    expect(read?.tempo).toBe(96);
    expect(read?.trackCount).toBe(3);
    await expectAsync(service.updateEntry('missing', { tempo: 1 })).toBeRejectedWithError('Entry not found');
  });

  it('deletes an entry, even when asked before the database has finished opening', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: dbName }] });
    const fresh = TestBed.inject(GpLibraryService);

    await fresh.deleteEntry(added.id);

    expect(await fresh.getEntry(added.id)).toBeNull();
    service = fresh;
  });

  it('publishes the entries after every change', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    await firstValueFrom(service.getEntries().pipe(filter(list => list.length === 1)));

    await service.deleteEntry(added.id);

    expect(await firstValueFrom(service.getEntries())).toEqual([]);
  });

  it('clears the library', async () => {
    await service.addBytes(bytes(1), 'a.gp', {});

    await service.clearLibrary();

    expect(await firstValueFrom(service.getEntries())).toEqual([]);
  });
});
