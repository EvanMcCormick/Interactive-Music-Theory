import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerLibraryPanelComponent } from './composer-library-panel.component';
import { AlphaTexService } from '../../../../services/alpha-tex.service';
import { CompositionEntry, ComposerLibraryService } from '../../../../services/composer-library.service';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';

/**
 * Saves asked for while a write is under way: which composition each lands in, and in what order they run.
 *
 * `composer-library-panel.component.spec.ts` pins one follow-up for a click and Ctrl+S. These pin what the queue
 * owes the composition a press was made for: a load mid-write must not turn a queued Save into a write over another
 * entry, a copy and a plain Save pressed together must each do what was pressed, and nothing may run once the panel
 * is gone. Each write the library is asked for is held until the spec settles it.
 */
describe('ComposerLibraryPanelComponent queued saves', () => {
  let fixture: ComponentFixture<ComposerLibraryPanelComponent>;
  let panel: ComposerLibraryPanelComponent;
  let composer: ComposerService;
  let library: ComposerLibraryService;
  /** Each write the library was asked for, in order, to land or fail. */
  let writes: Array<{ land: (id: string) => void; fail: (error: Error) => void }>;

  /** Lets every pending promise callback run. */
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve));
  /** The id each write was asked to overwrite, or undefined for a new entry. */
  const idsWritten = (): Array<string | undefined> => (library.save as jasmine.Spy).calls.allArgs().map(args => args[1]);
  /** The tempo each write held. */
  const temposWritten = (): number[] => (library.save as jasmine.Spy).calls.allArgs().map(args => args[0].tempo);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerLibraryPanelComponent] }).compileComponents();

    library = TestBed.inject(ComposerLibraryService);
    spyOn(library, 'refresh').and.resolveTo([]);
    writes = [];
    spyOn(library, 'save').and.callFake(
      () => new Promise<string>((land, fail) => writes.push({ land, fail }))
    );

    composer = TestBed.inject(ComposerService);
    composer.replaceDocument(ComposerService.createEmptyScore(), { markClean: true, newComposition: true });

    fixture = TestBed.createComponent(ComposerLibraryPanelComponent);
    panel = fixture.componentInstance;
    fixture.detectChanges();
    panel.currentId = 'a-id';
  });

  /** A saved composition called C, at 90 BPM, that `library.get` hands back. */
  function savedComposition(): CompositionEntry {
    const doc = { ...ComposerService.createEmptyScore(), title: 'C', tempo: 90 };
    const tex = TestBed.inject(AlphaTexService).export(TestBed.inject(ScoreDocMapperService).toScore(doc, new alphaTab.Settings()));
    const now = new Date();
    return { id: 'c-id', title: 'C', artist: '', tex, tempo: 90, trackCount: 1, barCount: doc.masterBars.length, dateCreated: now, dateModified: now };
  }

  describe('and a load', () => {
    beforeEach(() => {
      spyOn(library, 'get').and.resolveTo(savedComposition());
      spyOn(window, 'confirm').and.returnValue(true);
    });

    it('drops a Save queued before the load, and keeps the loaded composition current when the write lands', async () => {
      composer.setTempo(140);
      void panel.save();
      composer.setTempo(150);
      void panel.save();

      await panel.load('c-id');
      writes[0].land('a-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.currentId).toBe('c-id');

      void panel.save();
      await settle();
      expect(idsWritten()).toEqual(['a-id', 'c-id']);
    });

    it('keeps the loaded composition current when a follow-up already writing lands after the load', async () => {
      composer.setTempo(140);
      void panel.save();
      composer.setTempo(150);
      void panel.save();
      writes[0].land('a-id');
      await settle();
      expect(idsWritten()).toEqual(['a-id', 'a-id']);

      await panel.load('c-id');
      writes[1].land('a-id');
      await settle();

      expect(panel.currentId).toBe('c-id');
      expect(temposWritten()).withContext('the follow-up wrote A as it stood, into A').toEqual([140, 150]);
    });

    it('starts the loaded composition with no history, so an undo cannot put A back under C\'s name', async () => {
      composer.setTempo(140);
      expect(composer.state.canUndo).toBeTrue();

      await panel.load('c-id');
      composer.undo();
      void panel.save();
      await settle();

      expect(composer.state.canUndo).toBeFalse();
      expect(idsWritten()).toEqual(['c-id']);
      expect(temposWritten()).toEqual([90]);
    });

    it('does not make a copy of A current when the load came while the copy was writing', async () => {
      void panel.save(true);

      await panel.load('c-id');
      writes[0].land('copy-id');
      await settle();

      expect(panel.currentId).toBe('c-id');
    });

    it('runs a Save pressed after the load, for the loaded composition, once the earlier write lands', async () => {
      composer.setTempo(140);
      void panel.save();

      await panel.load('c-id');
      void panel.save();
      writes[0].land('a-id');
      await settle();

      expect(idsWritten()).toEqual(['a-id', 'c-id']);
      expect(temposWritten()).toEqual([140, 90]);
    });
  });

  describe('and New', () => {
    // The page's New resets the service's document, and the panel hears of it only through the state's `documentId`.

    it('writes the new score as a new entry, not over the entry just saved', async () => {
      void panel.save();
      writes[0].land('a-id');
      await settle();

      composer.reset();
      void panel.save();
      await settle();

      expect(idsWritten()).toEqual(['a-id', undefined]);
      expect(panel.currentId).toBeNull();
    });

    it('drops a Save queued before New, so the write under way lands and nothing is written over its entry', async () => {
      void panel.save();
      composer.setTempo(140);
      void panel.save();

      composer.reset();
      writes[0].land('a-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.currentId).toBeNull();
    });
  });

  describe('and a transcription opened in the composer', () => {
    // The transcription page hands over its document as a new composition, not saved.

    it('writes it as a new entry, not over the entry open before', async () => {
      composer.replaceDocument({ ...ComposerService.createEmptyScore(), tempo: 100 }, { newComposition: true });
      void panel.save();
      await settle();

      expect(idsWritten()).toEqual([undefined]);
      expect(temposWritten()).toEqual([100]);
    });
  });

  describe('and deleting the entry', () => {
    /** Each delete the library was asked for, to resolve or reject. */
    let deletes: Array<{ resolve: () => void; reject: (error: Error) => void }>;

    beforeEach(() => {
      spyOn(window, 'confirm').and.returnValue(true);
      deletes = [];
      spyOn(library, 'delete').and.callFake(() => new Promise<void>((resolve, reject) => deletes.push({ resolve, reject })));
    });

    /** Resolves every delete asked for so far, as each arrives. */
    async function deleteSucceeds(): Promise<void> {
      await settle();
      for (const pending of deletes) pending.resolve();
      await settle();
    }

    it('keeps the entry current when the delete fails, so the next Save updates it', async () => {
      const removing = panel.remove('a-id', 'A', new Event('click'));
      await settle();
      expect(panel.currentId).withContext('forgotten before the delete was known to succeed').toBe('a-id');

      deletes[0].reject(new Error('Blocked'));
      await removing;
      void panel.save();
      await settle();

      expect(panel.errorMessage).toBe('Blocked');
      expect(panel.currentId).toBe('a-id');
      expect(idsWritten()).toEqual(['a-id']);
    });

    it('adopts a copy of the entry that was writing when the delete was pressed', async () => {
      void panel.save(true);
      const removing = panel.remove('a-id', 'A', new Event('click'));
      writes[0].land('copy-id');
      await deleteSucceeds();
      await removing;

      expect(library.delete).toHaveBeenCalledOnceWith('a-id');
      expect(panel.currentId).toBe('copy-id');
    });

    it('adopts a copy pressed while the delete was under way, which landed after it', async () => {
      const removing = panel.remove('a-id', 'A', new Event('click'));
      await settle();
      void panel.save(true);
      await deleteSucceeds();
      await removing;
      writes[0].land('copy-id');
      await settle();

      expect(panel.currentId).toBe('copy-id');
    });

    it('writes a Save pressed while the delete is under way as a new entry, which cannot put the deleted one back', async () => {
      const removing = panel.remove('a-id', 'A', new Event('click'));
      await settle();
      composer.setTempo(140);
      void panel.save();
      await deleteSucceeds();
      await removing;
      writes[0].land('b-id');
      await settle();

      expect(idsWritten()).toEqual([undefined]);
      expect(panel.currentId).toBe('b-id');
    });

    it('deletes it once a write under way to it lands, and neither that write nor a queued Save brings it back', async () => {
      void panel.save();
      composer.setTempo(140);
      void panel.save();

      const removing = panel.remove('a-id', 'A', new Event('click'));
      await settle();
      expect(library.delete).withContext('the write under way would put the entry back').not.toHaveBeenCalled();

      writes[0].land('a-id');
      await deleteSucceeds();
      await removing;
      await settle();

      expect(library.delete).toHaveBeenCalledOnceWith('a-id');
      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.currentId).toBeNull();
    });
  });

  describe('and Flatten and save', () => {
    it('flattens when pressed during a write, and saves the flattened score once that write lands', async () => {
      void panel.save();
      // A score that writes something else than the write under way - a link alone writes nothing, since alphaTex has
      // nowhere to keep it - and is linked to a progression.
      composer.replaceDocument({
        ...composer.doc,
        tempo: 140,
        tracks: composer.doc.tracks.map(track => ({
          ...track,
          generated: { progressionId: 'prog', progressionName: 'Verse', source: { kind: 'revision' as const, revision: 1 } }
        }))
      });

      await panel.flattenAndSave();
      expect(composer.doc.tracks[0].generated).toBeNull();
      expect(library.save).toHaveBeenCalledTimes(1);

      writes[0].land('a-id');
      await settle();

      expect(idsWritten()).toEqual(['a-id', 'a-id']);
      expect(temposWritten()).toEqual([120, 140]);
      expect(panel.saveBlockedReason).toBeNull();
    });

    /** Links the score to a progression at 140 BPM - a tempo the write under way does not hold - and presses Flatten and save. */
    async function flattenAndSaveMidWrite(): Promise<void> {
      void panel.save();
      composer.replaceDocument({
        ...composer.doc,
        tempo: 140,
        tracks: composer.doc.tracks.map(track => ({
          ...track,
          generated: { progressionId: 'prog', progressionName: 'Verse', source: { kind: 'revision' as const, revision: 1 } }
        }))
      });
      await panel.flattenAndSave();
    }

    /** Expects the announced report that the flatten happened and nothing saved it. */
    function expectFlattenedButUnsaved(): void {
      expect(panel.saveBlockedReason).toContain('The track was flattened, but the composition still could not be saved');
      expect(panel.pendingSave?.flattened).toBeTrue();
      expect(panel.errorMessage).withContext('said once, in the announced region').toBeNull();
    }

    it('says the flatten was not saved when the write under way fails, dropping its queued save', async () => {
      await flattenAndSaveMidWrite();

      writes[0].fail(new Error('Quota exceeded'));
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expectFlattenedButUnsaved();
      expect(panel.saveBlockedReason).toContain('Quota exceeded');
    });

    it('says the flatten was not saved when its queued save fails', async () => {
      await flattenAndSaveMidWrite();
      writes[0].land('a-id');
      await settle();

      writes[1].fail(new Error('Quota exceeded'));
      await settle();

      expectFlattenedButUnsaved();
    });

    it('says the flatten was not saved when its queued save is refused', async () => {
      let refusing = false;
      TestBed.inject(ComposerSaveRequests).guard(() => refusing);
      await flattenAndSaveMidWrite();

      refusing = true;
      writes[0].land('a-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expectFlattenedButUnsaved();
    });
  });

  describe('as Save as copy', () => {
    it('makes one copy for a double click', async () => {
      void panel.save(true);
      void panel.save(true);
      writes[0].land('copy-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.currentId).toBe('copy-id');
    });

    it('makes one copy when Save as copy is pressed again after an edit that is then undone', async () => {
      // Undo gives back a copy of the document, not the one the write held; what the two would write is the same.
      void panel.save(true);
      composer.setTempo(140);
      void panel.save(true);
      composer.undo();

      writes[0].land('copy-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
    });

    it('saves the edit over the original, then copies, when Save and then Save as copy are pressed mid-write', async () => {
      void panel.save();
      composer.setTempo(140);
      void panel.save();
      void panel.save(true);

      writes[0].land('a-id');
      await settle();
      writes[1].land('a-id');
      await settle();
      writes[2].land('copy-id');
      await settle();

      expect(idsWritten()).toEqual(['a-id', 'a-id', undefined]);
      expect(temposWritten()).toEqual([120, 140, 140]);
      expect(panel.currentId).toBe('copy-id');
    });

    it('runs them in the order pressed: a copy first, then no Save over it, which would write the same document', async () => {
      void panel.save();
      composer.setTempo(140);
      void panel.save(true);
      void panel.save();

      writes[0].land('a-id');
      await settle();
      writes[1].land('copy-id');
      await settle();

      expect(idsWritten()).toEqual(['a-id', undefined]);
      expect(composer.state.isDirty).toBeFalse();
    });
  });

  it('runs no queued save once the panel is destroyed', async () => {
    void panel.save();
    composer.setTempo(140);
    void panel.save();

    fixture.destroy();
    writes[0].land('a-id');
    await settle();

    expect(library.save).toHaveBeenCalledTimes(1);
  });

  it('drops every queued save when the write fails, and a later press still writes', async () => {
    void panel.save();
    composer.setTempo(140);
    void panel.save();
    void panel.save(true);

    writes[0].fail(new Error('Quota exceeded'));
    await settle();

    expect(library.save).toHaveBeenCalledTimes(1);
    expect(panel.errorMessage).toBe('Quota exceeded');

    void panel.save();
    await settle();
    expect(library.save).toHaveBeenCalledTimes(2);
  });
});
