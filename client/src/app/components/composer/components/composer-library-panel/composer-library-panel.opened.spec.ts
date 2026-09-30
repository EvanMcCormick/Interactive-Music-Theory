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
 * The order is the point: the conversion replaces the document as a new composition, which moves `documentId` on and
 * makes the panel forget the entry it had (`forgetEntry`), and only then names the new one (`opened$`). Adopted before
 * the forget, the id would be dropped again, and the next Save would write a second copy of the converted file.
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

    library.markOpened('x');
    expect(panel.currentId).toBe('x');

    composer.setTempo(140);
    await panel.save();

    expect(library.save).toHaveBeenCalledTimes(1);
    expect((library.save as jasmine.Spy).calls.mostRecent().args[1]).toBe('x');
  });
});
