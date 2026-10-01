import { TestBed } from '@angular/core/testing';

import { ComposerLibraryService } from './composer-library.service';
import { abortOnSuccess, deletedDatabase } from './indexed-db.spec-helper';

/** The name the service opens; it takes no other (see below). */
const DB_NAME = 'composer-library';

/**
 * The composer's library of saved compositions, against real IndexedDB under Karma.
 *
 * Unlike `GpLibraryService` the service names its database itself, so these specs use `composer-library` and delete it
 * before and after each. That is never a developer's library: karma-chrome-launcher starts every run's Chrome with a
 * throwaway profile. Deleting it first also clears whatever an earlier spec's service wrote there.
 */
describe('ComposerLibraryService', () => {
  let service: ComposerLibraryService;

  const composition = (title: string) => ({ title, artist: '', tex: `\\title "${title}" .`, tempo: 120, trackCount: 1, barCount: 1 });

  beforeEach(async () => {
    await deletedDatabase(DB_NAME);
    service = TestBed.inject(ComposerLibraryService);
  });

  afterEach(async () => {
    // The service lets its database go when asked, so the delete must finish: a connection left open fails the spec.
    await deletedDatabase(DB_NAME);
  });

  it('saves a composition and reads it back, and a save over its id keeps when it was made', async () => {
    const id = await service.save(composition('First'));
    const made = (await service.get(id))?.dateCreated;

    await service.save(composition('Second'), id);

    const read = await service.get(id);
    expect(read?.title).toBe('Second');
    expect(read?.dateCreated).toEqual(made as Date);
    expect((await service.refresh()).map(summary => summary.title)).toEqual(['Second']);
  });

  it('refuses a save whose transaction aborts after its write succeeded, and keeps nothing', async () => {
    abortOnSuccess('put');

    await expectAsync(service.save(composition('Lost'))).toBeRejected();

    expect(await service.refresh()).toEqual([]);
  });

  it('resolves a save once it has committed, though the list read after it fails', async () => {
    const logged = spyOn(console, 'error');
    spyOn(service, 'refresh').and.rejectWith(new Error('read failed'));

    const id = await service.save(composition('Landed'));

    expect((await service.get(id))?.title).toBe('Landed');
    expect(logged).toHaveBeenCalled();
  });

  it('refuses a delete whose transaction aborts after its request succeeded, and keeps the composition', async () => {
    const id = await service.save(composition('Kept'));
    abortOnSuccess('delete');

    await expectAsync(service.delete(id)).toBeRejected();

    expect((await service.get(id))?.title).toBe('Kept');
  });

  it('lets its database go when it is deleted, and opens it afresh on the next call', async () => {
    await service.save(composition('Gone'));

    await deletedDatabase(DB_NAME);

    await service.save(composition('New'));
    expect((await service.refresh()).map(summary => summary.title)).toEqual(['New']);
  });

  it('opens again after an open that failed, rather than failing for good', async () => {
    // A database already at a later version refuses the service's open (VersionError).
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 99);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    await expectAsync(service.refresh()).toBeRejected();
    await deletedDatabase(DB_NAME);

    expect(await service.refresh()).toEqual([]);
  });
});
