import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerLibraryPanelComponent } from './composer-library-panel.component';
import { ComposerLibraryService } from '../../../../services/composer-library.service';
import { ComposerService } from '../../../../services/composer.service';
import { GP_LIBRARY_DB } from '../../../../services/gp-library.service';
import { deletedDatabase } from '../../../../services/indexed-db.spec-helper';

/**
 * An entry opened by something other than the panel - a converted `.gp` file, written and opened in one step
 * (`GpConversionService`) - is the one the next Save writes over.
 *
 * The conversion replaces the document as a new composition, which moves `documentId` on and makes the panel forget the
 * entry it had (`forgetEntry`), and then names the new one for the new `documentId` (`markOpened`). The service holds it
 * (`ComposerLibraryService.rememberOpen`), keyed by that composition, so neither the forget nor the page being left
 * drops it, and the next Save writes over it rather than making a second copy of the converted file.
 */
describe('ComposerLibraryPanelComponent and an entry opened elsewhere', () => {
  let fixture: ComponentFixture<ComposerLibraryPanelComponent>;
  let panel: ComposerLibraryPanelComponent;
  let composer: ComposerService;
  let library: ComposerLibraryService;
  // A GP library of its own: the panel lists one, and nothing here should read the one a browser holds.
  const gpDb = `gp-library-panel-opened-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await deletedDatabase(gpDb);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerLibraryPanelComponent], providers: [{ provide: GP_LIBRARY_DB, useValue: gpDb }] }).compileComponents();

    // Spied, so nothing reaches IndexedDB.
    library = TestBed.inject(ComposerLibraryService);
    spyOn(library, 'refresh').and.resolveTo([]);
    spyOn(library, 'save').and.resolveTo('x');

    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerLibraryPanelComponent);
    panel = fixture.componentInstance;
    fixture.detectChanges();
    panel.currentId = 'earlier';
  });

  it('adopts the entry opened after a new composition replaced the document, and saves over it', async () => {
    composer.replaceDocument(ComposerService.createEmptyScore(), { newComposition: true, markClean: true });
    expect(panel.currentId).toBeNull();

    library.markOpened('x', composer.state.documentId);
    expect(panel.currentId).toBe('x');

    composer.setTempo(140);
    await panel.save();

    expect(library.save).toHaveBeenCalledTimes(1);
    expect((library.save as jasmine.Spy).calls.mostRecent().args[1]).toBe('x');
  });

  /**
   * Across a route round trip. The panel is made again when the page comes back, and the entry it had was its own field:
   * leaving the page after Convert or a load, coming back and pressing Save made a second composition. The service holds
   * the entry open now, for the composition it is (`documentId`), and a new panel adopts it while that composition is
   * still open.
   */
  describe('across a route round trip', () => {
    /** Leaves the page and comes back to it: the panel is made again. */
    function comeBack(): void {
      fixture.destroy();
      fixture = TestBed.createComponent(ComposerLibraryPanelComponent);
      panel = fixture.componentInstance;
      fixture.detectChanges();
    }
    const saveTarget = (): unknown => (library.save as jasmine.Spy).calls.mostRecent().args[1];

    it('keeps the entry a converted file was written to, so Save writes over it rather than making a second', async () => {
      composer.replaceDocument(ComposerService.createEmptyScore(), { newComposition: true, markClean: true });
      library.markOpened('converted', composer.state.documentId);

      comeBack();
      composer.setTempo(140);
      await panel.save();

      expect(saveTarget()).toBe('converted');
    });

    it('keeps the entry the last save made', async () => {
      composer.replaceDocument(ComposerService.createEmptyScore(), { newComposition: true, markClean: true });
      await panel.save();

      comeBack();
      composer.setTempo(140);
      await panel.save();

      expect(saveTarget()).toBe('x');
    });

    it('adopts a save that lands after the page was left and came back', async () => {
      composer.replaceDocument(ComposerService.createEmptyScore(), { newComposition: true, markClean: true });
      let land: (id: string) => void = () => undefined;
      (library.save as jasmine.Spy).and.returnValue(new Promise<string>(resolve => (land = resolve)));
      const leaving = panel.save();

      comeBack();
      land('landed');
      await leaving;
      fixture.detectChanges();
      expect(panel.currentId).toBe('landed');

      (library.save as jasmine.Spy).and.resolveTo('landed');
      composer.setTempo(140);
      await panel.save();
      expect(saveTarget()).toBe('landed');
    });

    it('forgets it once another composition has opened while the page was away', async () => {
      composer.replaceDocument(ComposerService.createEmptyScore(), { newComposition: true, markClean: true });
      library.markOpened('converted', composer.state.documentId);
      fixture.destroy();
      composer.reset();

      comeBack();
      await panel.save();

      expect(saveTarget()).toBeUndefined();
    });
  });
});
