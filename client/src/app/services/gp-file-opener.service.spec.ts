import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { GpFileOpener } from './gp-file-opener.service';
import { GP_LIBRARY_DB, GpLibraryService } from './gp-library.service';
import { deletedDatabase } from './indexed-db.spec-helper';

/**
 * The ways a `.gp` file comes into the composer, against a real `gp-library` of the spec's own: what each writes, what it
 * shows, and what it says when it cannot. The page's spec pins the wiring - the gallery's `?gp=`, a drop - and these the
 * order the opener keeps: parse, ask, write, show.
 */
describe('GpFileOpener', () => {
  let opener: GpFileOpener;
  let gpLibrary: GpLibraryService;
  let composer: ComposerService;
  let gp: ComposerGpService;
  let dbName: string;

  beforeEach(() => {
    dbName = `gp-library-opener-spec-${Math.random().toString(36).slice(2)}`;
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: dbName }] });
    opener = TestBed.inject(GpFileOpener);
    gpLibrary = TestBed.inject(GpLibraryService);
    composer = TestBed.inject(ComposerService);
    gp = TestBed.inject(ComposerGpService);
  });

  afterEach(async () => {
    await deletedDatabase(dbName);
  });

  /** A one-track score at 90 BPM written as a Guitar Pro 7 file, as a real `.gp` would arrive: there is no fixture in the repo. */
  function gpBytes(title: string): ArrayBuffer {
    const { score } = TestBed.inject(AlphaTexService).parse([`\\title "${title}"`, '\\tempo 90', '\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 |'].join('\n'));
    if (!score) throw new Error('the file did not parse');
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  /** Bytes no Guitar Pro reader takes. */
  const garbage = (): ArrayBuffer => new Uint8Array([1, 2, 3, 4]).buffer;

  /** Waits for `done` to hold - it may read IndexedDB - or two seconds, whichever comes first. */
  async function until(done: () => Promise<boolean> | boolean): Promise<void> {
    for (let waited = 0; !(await done()) && waited < 2000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
  }

  describe('openEntry', () => {
    it("opens the entry in Original, and corrects an entry added knowing nothing to the file's title, tempo and track count", async () => {
      const added = await gpLibrary.addBytes(gpBytes('Riff'), 'riff.gp', {});
      expect(added.tempo).withContext('the invented metadata the gallery writes').toBe(120);

      expect(await opener.openEntry(added.id)).toBeTrue();

      expect(gp.original?.entryId).toBe(added.id);
      expect(gp.original?.score.title).toBe('Riff');
      await until(async () => (await gpLibrary.getEntry(added.id))?.title === 'Riff');
      const corrected = await gpLibrary.getEntry(added.id);
      expect(corrected?.title).toBe('Riff');
      expect(corrected?.tempo).toBe(90);
      expect(corrected?.trackCount).toBe(1);
    });

    it('shows the file without waiting for its card to be corrected', async () => {
      const added = await gpLibrary.addBytes(gpBytes('Riff'), 'riff.gp', {});
      const update = spyOn(gpLibrary, 'updateEntry').and.returnValue(new Promise<void>(() => undefined));

      expect(await opener.openEntry(added.id)).toBeTrue();

      expect(gp.isOriginal).toBeTrue();
      expect(update).toHaveBeenCalled();
    });

    it('refuses a file it cannot read, and neither corrects its entry nor leaves Composition', async () => {
      const added = await gpLibrary.addBytes(garbage(), 'bad.gp', {});
      const update = spyOn(gpLibrary, 'updateEntry').and.callThrough();

      expect(await opener.openEntry(added.id)).toBeFalse();

      expect(composer.state.refusal).toBe('"bad.gp" could not be read as a Guitar Pro file.');
      expect(update).not.toHaveBeenCalled();
      expect(gp.isOriginal).toBeFalse();
    });

    it('says an entry that is gone is no longer in the library', async () => {
      expect(await opener.openEntry('missing')).toBeFalse();

      expect(composer.state.refusal).toBe('That file is no longer in the library.');
    });

    it('tells a library it could not read apart from an entry that is gone', async () => {
      spyOn(gpLibrary, 'getEntry').and.rejectWith(new Error('The GP library could not be read'));

      expect(await opener.openEntry('any')).toBeFalse();

      expect(composer.state.refusal).toBe('The library could not be read: The GP library could not be read');
      expect(gp.isOriginal).toBeFalse();
    });

    it('opens nothing and corrects nothing when the unsaved work is kept', async () => {
      const added = await gpLibrary.addBytes(gpBytes('Riff'), 'riff.gp', {});
      spyOn(composer, 'confirmDiscard').and.returnValue(false);
      const update = spyOn(gpLibrary, 'updateEntry').and.callThrough();
      const reset = spyOn(composer, 'reset').and.callThrough();

      expect(await opener.openEntry(added.id)).toBeFalse();

      expect(update).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      expect(gp.isOriginal).toBeFalse();
    });
  });

  describe('importFile', () => {
    it('adds the file with what it says of itself, and opens it in Original', async () => {
      expect(await opener.importFile(new File([gpBytes('Riff')], 'riff.gp'))).toBeTrue();

      const entryId = gp.original?.entryId ?? '';
      const entry = await gpLibrary.getEntry(entryId);
      expect(entry?.title).toBe('Riff');
      expect(entry?.tempo).toBe(90);
      expect(entry?.trackCount).toBe(1);
    });

    it('refuses a file that is not a Guitar Pro file by its name, before reading it', async () => {
      const add = spyOn(gpLibrary, 'addBytes').and.callThrough();

      expect(await opener.importFile(new File(['text'], 'notes.txt'))).toBeFalse();

      expect(composer.state.refusal).toBe('"notes.txt" is not a Guitar Pro file.');
      expect(add).not.toHaveBeenCalled();
    });

    it('refuses a file the disk will not give up, rather than failing unheard', async () => {
      const file = new File([gpBytes('Riff')], 'riff.gp');
      spyOn(file, 'arrayBuffer').and.rejectWith(new DOMException('The file was moved.', 'NotReadableError'));
      const add = spyOn(gpLibrary, 'addBytes').and.callThrough();

      expect(await opener.importFile(file)).toBeFalse();

      expect(composer.state.refusal).toBe('"riff.gp" could not be read: The file was moved.');
      expect(add).not.toHaveBeenCalled();
      expect(gp.isOriginal).toBeFalse();
    });

    it('refuses a file it cannot read as Guitar Pro, and writes nothing', async () => {
      const add = spyOn(gpLibrary, 'addBytes').and.callThrough();

      expect(await opener.importFile(new File([garbage()], 'bad.gp'))).toBeFalse();

      expect(composer.state.refusal).toBe('"bad.gp" could not be read as a Guitar Pro file.');
      expect(add).not.toHaveBeenCalled();
      expect(gp.isOriginal).toBeFalse();
    });

    it('writes nothing, resets nothing and stays in Composition when the unsaved work is kept', async () => {
      spyOn(composer, 'confirmDiscard').and.returnValue(false);
      const add = spyOn(gpLibrary, 'addBytes').and.callThrough();
      const reset = spyOn(composer, 'reset').and.callThrough();

      expect(await opener.importFile(new File([gpBytes('Riff')], 'riff.gp'))).toBeFalse();

      expect(add).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      expect(gp.isOriginal).toBeFalse();
    });

    it('leaves the page as it was when the library cannot take the file, and says why', async () => {
      spyOn(gpLibrary, 'addBytes').and.rejectWith(new Error('Quota exceeded'));
      const reset = spyOn(composer, 'reset').and.callThrough();
      const documentId = composer.state.documentId;

      expect(await opener.importFile(new File([gpBytes('Riff')], 'riff.gp'))).toBeFalse();

      expect(composer.state.refusal).toBe('"riff.gp" could not be added to the library: Quota exceeded');
      expect(reset).not.toHaveBeenCalled();
      expect(composer.state.documentId).toBe(documentId);
      expect(gp.isOriginal).toBeFalse();
    });
  });

  describe('one open at a time', () => {
    it('runs a second open asked while one is under way - a double click - not at all', async () => {
      const added = await gpLibrary.addBytes(gpBytes('Riff'), 'riff.gp', { title: 'Riff', tempo: 90, trackCount: 1 });
      const open = spyOn(gp, 'open').and.callThrough();

      const first = opener.openEntry(added.id);
      const second = opener.openEntry(added.id);

      expect(await second).toBeFalse();
      expect(await first).toBeTrue();
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('takes one of two files dropped in quick succession, and opens again once it is done', async () => {
      const add = spyOn(gpLibrary, 'addBytes').and.callThrough();

      const first = opener.importFile(new File([gpBytes('One')], 'one.gp'));
      const second = opener.importFile(new File([gpBytes('Two')], 'two.gp'));

      expect(await second).toBeFalse();
      expect(await first).toBeTrue();
      expect(add).toHaveBeenCalledTimes(1);
      expect(await opener.importFile(new File([gpBytes('Two')], 'two.gp'))).toBeTrue();
      expect(gp.original?.score.title).toBe('Two');
    });
  });

  describe('importDropped', () => {
    it('opens the first Guitar Pro file, and counts the other Guitar Pro files apart from the files that are not', async () => {
      const files = [new File([gpBytes('One')], 'one.gp'), new File(['text'], 'notes.txt'), new File([gpBytes('Two')], 'two.gp')];

      await opener.importDropped(files);

      expect(gp.original?.score.title).toBe('One');
      expect(composer.state.notice).toBe('Opened "one.gp". 1 other Guitar Pro file was left: one file opens at a time. 1 file was not a Guitar Pro file.');
    });

    it('says nothing more for one Guitar Pro file dropped alone', async () => {
      await opener.importDropped([new File([gpBytes('One')], 'one.gp')]);

      expect(gp.original?.score.title).toBe('One');
      expect(composer.state.notice).toBeNull();
    });
  });
});
