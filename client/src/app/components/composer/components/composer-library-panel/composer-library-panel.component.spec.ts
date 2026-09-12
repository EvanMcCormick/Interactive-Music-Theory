import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposerLibraryPanelComponent } from './composer-library-panel.component';
import { ScoreDoc } from '../../../../models/composer.model';
import { ComposerExportService } from '../../../../services/composer-export.service';
import { ComposerLibraryService } from '../../../../services/composer-library.service';
import { ComposerService } from '../../../../services/composer.service';

/**
 * What the Library panel refuses to save, and what it still exports.
 *
 * The panel's other duties - loading, deleting, the three export formats - are
 * covered by the services they delegate to. This file is about the one decision
 * the panel makes on its own: a composition holding a track generated from a
 * progression cannot be written to the library as it stands, because
 * `CompositionEntry` stores a composition as alphaTex and alphaTex has nowhere
 * to keep the marker. `score-doc-mapper.service.spec.ts` pins the loss itself -
 * the marker is gone in alphaTab's own model before a character of tex is
 * written - so nothing here re-proves it; these tests are about what the panel
 * does with a fact already established.
 *
 * ## Everything that touches a device is spied, and nothing else is
 *
 * `ComposerLibraryService` reaches IndexedDB and `ComposerExportService` ends
 * in a synthesised anchor click, which in a headless browser is a real
 * download. Both are spied. Under the spies the mapper, the alphaTex exporter
 * and `ComposerService` itself are the real things, so a refusal that only held
 * against a fake document would not pass.
 */
describe('ComposerLibraryPanelComponent', () => {
  let fixture: ComponentFixture<ComposerLibraryPanelComponent>;
  let panel: ComposerLibraryPanelComponent;
  let composer: ComposerService;
  let library: ComposerLibraryService;
  let exporter: ComposerExportService;

  /** The same score with the track at `index` marked as a progression's. */
  function marked(doc: ScoreDoc, index: number, progressionName: string): ScoreDoc {
    return {
      ...doc,
      tracks: doc.tracks.map((track, i) =>
        i === index
          ? {
              ...track,
              generated: {
                progressionId: `prog-${i}`,
                progressionName,
                source: { kind: 'revision' as const, revision: 1 }
              }
            }
          : track
      )
    };
  }

  /** A second track, so a score can hold one linked and one ordinary. */
  function withSecondTrack(doc: ScoreDoc): ScoreDoc {
    return {
      ...doc,
      tracks: [
        ...doc.tracks,
        ComposerService.createTrack('Bass', 'bs', 33, true, doc.masterBars)
      ]
    };
  }

  function link(progressionName: string, index = 0): void {
    composer.replaceDocument(marked(composer.doc, index, progressionName));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComposerLibraryPanelComponent]
    }).compileComponents();

    library = TestBed.inject(ComposerLibraryService);
    spyOn(library, 'refresh').and.resolveTo([]);
    spyOn(library, 'save').and.resolveTo('saved-id');

    exporter = TestBed.inject(ComposerExportService);
    spyOn(exporter, 'downloadGuitarPro');
    spyOn(exporter, 'downloadAlphaTex');
    spyOn(exporter, 'downloadMidiFile');

    composer = TestBed.inject(ComposerService);
    composer.replaceDocument(ComposerService.createEmptyScore(), true);

    fixture = TestBed.createComponent(ComposerLibraryPanelComponent);
    panel = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('with nothing linked', () => {
    it('saves', async () => {
      await panel.save();

      expect(library.save).toHaveBeenCalled();
      expect(panel.saveBlockedReason).toBeNull();
    });
  });

  describe('with a generated track linked', () => {
    beforeEach(() => link('Verse'));

    it('refuses to save', async () => {
      // alphaTex cannot round-trip the marker, so saving would silently flatten
      // - a change to the user's document they would not find until they
      // reopened it.
      await panel.save();

      expect(library.save).not.toHaveBeenCalled();
      expect(panel.saveBlockedReason).not.toBeNull();
    });

    it('refuses to save as a copy for the same reason', async () => {
      panel.currentId = 'existing';

      await panel.save(true);

      expect(library.save).not.toHaveBeenCalled();
      expect(panel.saveBlockedReason).not.toBeNull();
    });

    it('names the progression in the refusal, so the user knows which track', async () => {
      await panel.save();

      expect(panel.saveBlockedReason).toContain('Verse');
    });

    it('flattens and saves when the user takes the offer', async () => {
      await panel.save();
      await panel.flattenAndSave();

      expect(composer.doc.tracks.every(track => track.generated === null)).toBeTrue();
      // Once, not twice: the refused press must not have written anything.
      expect(library.save).toHaveBeenCalledTimes(1);
      expect(panel.saveBlockedReason).toBeNull();
    });

    it('flattens every linked track, not only the first', async () => {
      composer.replaceDocument(marked(withSecondTrack(composer.doc), 1, 'Chorus'));
      fixture.detectChanges();

      await panel.save();
      await panel.flattenAndSave();

      expect(composer.doc.tracks.every(track => track.generated === null)).toBeTrue();
      expect(composer.doc.tracks.length).toBe(2);
    });

    it('still writes a copy when the refusal came from Save as copy', async () => {
      // The detour through the offer must not turn a copy into an overwrite:
      // the id is what tells the library which of the two it is being asked
      // for, and it is decided before the refusal and used after it.
      panel.currentId = 'existing';

      await panel.save(true);
      await panel.flattenAndSave();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(library.save).toHaveBeenCalledWith(jasmine.anything(), undefined);
    });

    it('still overwrites when the refusal came from Save', async () => {
      panel.currentId = 'existing';

      await panel.save();
      await panel.flattenAndSave();

      expect(library.save).toHaveBeenCalledTimes(1);
      expect(library.save).toHaveBeenCalledWith(jasmine.anything(), 'existing');
    });

    it('drops the refusal when the link goes away by some other route', async () => {
      // The tracks panel can flatten too, and a refusal left standing after
      // that would be telling the user about a link the document no longer has.
      await panel.save();
      composer.flattenTrack(0);
      fixture.detectChanges();

      expect(panel.saveBlockedReason).toBeNull();
    });

    it('drops the refusal when the user declines the offer', async () => {
      await panel.save();
      panel.dismissSaveBlock();

      expect(panel.saveBlockedReason).toBeNull();
      expect(composer.doc.tracks[0].generated).not.toBeNull();
    });

    describe('does not block export', () => {
      // An exported file has already left the app and has nothing to stay
      // linked to, so the reason saving refuses does not apply to it.
      it('for Guitar Pro', () => {
        panel.exportGuitarPro();

        expect(exporter.downloadGuitarPro).toHaveBeenCalled();
        expect(panel.saveBlockedReason).toBeNull();
      });

      it('for alphaTex', () => {
        panel.exportAlphaTex();

        expect(exporter.downloadAlphaTex).toHaveBeenCalled();
        expect(panel.saveBlockedReason).toBeNull();
      });

      it('for MIDI', () => {
        panel.exportMidi();

        expect(exporter.downloadMidiFile).toHaveBeenCalled();
        expect(panel.saveBlockedReason).toBeNull();
      });
    });

    /**
     * The refusal is announced, not merely displayed.
     *
     * The alternative - disabling Save and hanging the explanation off it with
     * `aria-describedby` - puts the reason on a control that is not in the tab
     * order, so a keyboard user never lands on it and never hears why. Keeping
     * Save operable and answering the press into a live region means the
     * explanation arrives at the moment it is asked for.
     */
    describe('reaches a screen reader', () => {
      it('leaves Save pressable rather than disabling it', () => {
        const save = fixture.debugElement.query(By.css('.save-actions button'));

        expect(save.nativeElement.disabled).toBeFalse();
        expect(save.nativeElement.getAttribute('aria-disabled')).toBeNull();
      });

      it('puts the refusal in a live region, with the offer inside it', async () => {
        await panel.save();
        fixture.detectChanges();

        const alert = fixture.debugElement.query(By.css('[role="alert"]'));
        expect(alert).not.toBeNull();
        expect(alert.nativeElement.textContent).toContain('Verse');
        expect(alert.nativeElement.textContent).toContain('Flatten and save');
      });
    });
  });
});
