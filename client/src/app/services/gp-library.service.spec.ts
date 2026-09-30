import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { GP_LIBRARY_DB, GpLibraryService } from './gp-library.service';
import { abortOnSuccess, deletedDatabase } from './indexed-db.spec-helper';

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
    // Let the constructor's open and first read finish: the delete closes the connection, and a read still to start on
    // it would throw, and be logged. Then the delete must finish - the service lets its database go when asked - so a
    // connection left open fails the spec rather than leaking the database.
    await service.getEntry('none');
    await deletedDatabase(dbName);
  });

  const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

  it('adds bytes as a file, filling in what the caller does not say, and reads them back', async () => {
    const added = await service.addBytes(bytes(1, 2, 3), 'My_Song-take.gp', { trackCount: 4 });

    const read = await service.getEntry(added.id);
    expect(read?.fileName).toBe('My_Song-take.gp');
    expect(read?.fileSize).toBe(3);
    expect(read).not.toBeNull();
    if (read) expect(Array.from(new Uint8Array(read.fileData))).toEqual([1, 2, 3]);
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

  it('updates in one transaction: an update asked before a delete cannot bring the entry back after it', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});

    // The update reads, then writes. Read and written in two transactions, the delete ran between them and the write
    // put the entry back.
    const updating = service.updateEntry(added.id, { tempo: 96 });
    const deleting = service.deleteEntry(added.id);
    await updating;
    await deleting;

    expect(await service.getEntry(added.id)).toBeNull();
  });

  it('refuses an update asked after a delete, and does not bring the entry back', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});

    const deleting = service.deleteEntry(added.id);
    // Watched from the start, so its refusal - which comes before the delete's reload - is never unhandled.
    const refused = expectAsync(service.updateEntry(added.id, { tempo: 96 })).toBeRejectedWithError('Entry not found');

    await deleting;
    await refused;
    expect(await service.getEntry(added.id)).toBeNull();
  });

  it('refuses an add whose transaction aborts after its request succeeded, and keeps nothing', async () => {
    const add = abortOnSuccess('add');

    await expectAsync(service.addBytes(bytes(1), 'lost.gp', {})).toBeRejected();

    add.and.callThrough();
    await service.addBytes(bytes(2), 'kept.gp', {});
    expect((await firstValueFrom(service.getEntries())).map(entry => entry.fileName)).toEqual(['kept.gp']);
  });

  it('refuses a delete whose transaction aborts after its request succeeded, and keeps the entry', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    abortOnSuccess('delete');

    await expectAsync(service.deleteEntry(added.id)).toBeRejected();

    expect((await service.getEntry(added.id))?.fileName).toBe('a.gp');
  });

  it('resolves a delete once it has committed, though the list read after it fails', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    const logged = spyOn(console, 'error');
    const getAll = spyOn(IDBObjectStore.prototype, 'getAll').and.throwError('read failed');

    await expectAsync(service.deleteEntry(added.id)).toBeResolved();

    getAll.and.callThrough();
    expect(await service.getEntry(added.id)).toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it('refuses an update whose transaction aborts after its write succeeded, and keeps the entry as it was', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    abortOnSuccess('put');

    await expectAsync(service.updateEntry(added.id, { tempo: 96 })).toBeRejected();

    expect((await service.getEntry(added.id))?.tempo).toBe(120);
  });

  it('resolves a delete of an entry that is not there', async () => {
    await expectAsync(service.deleteEntry('missing')).toBeResolved();
  });

  it('lets its database go when it is deleted, and opens it afresh on the next call', async () => {
    await service.addBytes(bytes(1), 'a.gp', {});

    await deletedDatabase(dbName);

    await service.addBytes(bytes(2), 'b.gp', {});
    expect((await firstValueFrom(service.getEntries())).map(entry => entry.fileName)).toEqual(['b.gp']);
  });

  it('opens again after an open that failed, rather than failing for good', async () => {
    // A database already at a later version refuses the service's open (VersionError).
    const newer = `${dbName}-newer`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(newer, 99);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    // The spec's own database is done with: clean it up here, as the cleanup after will clean up the newer one.
    await service.getEntry('none');
    await deletedDatabase(dbName);
    spyOn(console, 'error'); // The constructor's open fails, and says so.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: newer }] });
    const fresh = TestBed.inject(GpLibraryService);
    service = fresh;
    dbName = newer;

    await expectAsync(fresh.getEntry('none')).toBeRejected();
    await deletedDatabase(newer);

    expect(await fresh.getEntry('none')).toBeNull();
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
