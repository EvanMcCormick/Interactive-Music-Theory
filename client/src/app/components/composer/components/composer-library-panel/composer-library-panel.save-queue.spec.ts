import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerLibraryPanelComponent } from './composer-library-panel.component';
import { AlphaTexService } from '../../../../services/alpha-tex.service';
import { CompositionEntry, ComposerLibraryService } from '../../../../services/composer-library.service';
import { ComposerService } from '../../../../services/composer.service';
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
    composer.replaceDocument(ComposerService.createEmptyScore(), true);

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

  describe('as Save as copy', () => {
    it('makes one copy for a double click', async () => {
      void panel.save(true);
      void panel.save(true);
      writes[0].land('copy-id');
      await settle();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.currentId).toBe('copy-id');
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
