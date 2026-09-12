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

    it('names both progressions when two tracks are linked', async () => {
      // The refusal is the only place the user is told which links are in the
      // way, so it has to name all of them, not just the one that tripped it.
      composer.replaceDocument(marked(withSecondTrack(composer.doc), 1, 'Chorus'));
      fixture.detectChanges();

      await panel.save();

      expect(panel.saveBlockedReason).toContain('Verse');
      expect(panel.saveBlockedReason).toContain('Chorus');
    });

    it('stops naming a link that went away while the refusal was showing', async () => {
      // Refuse with two, flatten one from the Tracks panel, and the refusal is
      // now describing a document that has moved on under it.
      composer.replaceDocument(marked(withSecondTrack(composer.doc), 1, 'Chorus'));
      fixture.detectChanges();

      await panel.save();
      composer.flattenTrack(1);
      fixture.detectChanges();

      expect(panel.saveBlockedReason).toContain('Verse');
      expect(panel.saveBlockedReason).not.toContain('Chorus');
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

    /**
     * The pending press must not outlive the refusal that carried it.
     *
     * `Save as copy` refuses, the refusal goes away without being taken up, and
     * the next press is a plain `Save`. If clearing the refusal left the "as a
     * copy" half of it behind, that later `Save` would still be finished as a
     * copy - or, with the two halves out of step the other way, a copy would
     * overwrite the original. The two are one decision and are held as one
     * field, so neither is reachable; these pin the behaviour at both exits.
     */
    describe('after a refusal that was cleared rather than taken up', () => {
      it('overwrites when the next press is Save, having been dismissed', async () => {
        panel.currentId = 'existing';

        await panel.save(true);
        panel.dismissSaveBlock();
        await panel.save();
        await panel.flattenAndSave();

        expect(library.save).toHaveBeenCalledTimes(1);
        expect(library.save).toHaveBeenCalledWith(jasmine.anything(), 'existing');
      });

      it('overwrites when the next press is Save, the link having gone elsewhere', async () => {
        panel.currentId = 'existing';

        await panel.save(true);
        // The Tracks panel flattening is what clears the refusal here, so this
        // exit runs through the state subscription rather than the button.
        composer.flattenTrack(0);
        fixture.detectChanges();
        link('Bridge');

        await panel.save();
        await panel.flattenAndSave();

        expect(library.save).toHaveBeenCalledTimes(1);
        expect(library.save).toHaveBeenCalledWith(jasmine.anything(), 'existing');
      });
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

      it('has the live region in the tree before there is anything to announce', () => {
        // A node inserted with role="alert" already on it is the documented
        // flake case: some screen readers only announce a region whose content
        // changes while the region is already in the accessibility tree. Since
        // the whole point of leaving Save pressable is that the press produces
        // the explanation, a missed announcement is the feature failing.
        const alert = fixture.debugElement.query(By.css('[role="alert"]'));

        expect(alert).not.toBeNull();
        expect(alert.nativeElement.textContent.trim()).toBe('');
      });

      it('announces the resolution as well as the refusal', async () => {
        // Hearing the objection and then silence is the asymmetry: the user is
        // told why the press was refused but not that the retry worked.
        composer.flattenTrack(0);
        fixture.detectChanges();

        await panel.save();
        fixture.detectChanges();

        const polite = fixture.debugElement.query(By.css('[aria-live="polite"]'));
        expect(polite).not.toBeNull();
        expect(polite.nativeElement.textContent).toContain('Saved');
      });

      it('returns focus to Save when the offer is declined', async () => {
        await panel.save();
        fixture.detectChanges();

        panel.dismissSaveBlock();
        fixture.detectChanges();

        const save = fixture.debugElement.query(By.css('.save-actions button'));
        expect(document.activeElement).toBe(save.nativeElement);
      });

      it('returns focus to Save when the offer is taken', async () => {
        // Both buttons destroy the element they live in, so without this focus
        // falls back to <body> and the keyboard user restarts from the top.
        await panel.save();
        fixture.detectChanges();

        await panel.flattenAndSave();
        fixture.detectChanges();

        const save = fixture.debugElement.query(By.css('.save-actions button'));
        expect(document.activeElement).toBe(save.nativeElement);
      });
    });

    /**
     * Taking the offer is two steps, and the second one can fail.
     *
     * `library.save` reaches IndexedDB, so quota, private browsing and a failed
     * version upgrade are all real. The flatten has already committed by then,
     * which is exactly the outcome the refusal exists to prevent: the user's
     * document changed and nothing was written. It has to say so, in the region
     * the user is already listening to, and say that undo puts it back.
     */
    describe('when the save fails after the flatten', () => {
      beforeEach(() => {
        (library.save as jasmine.Spy).and.rejectWith(new Error('Quota exceeded'));
      });

      it('says so through the same announced region', async () => {
        await panel.save();
        await panel.flattenAndSave();
        fixture.detectChanges();

        const alert = fixture.debugElement.query(By.css('[role="alert"]'));
        expect(alert.nativeElement.textContent).toContain('Quota exceeded');
      });

      it('does not also leave it in the status paragraph', async () => {
        // The announced region is the single channel for this decision. The
        // same message in the unannounced paragraph below says it twice, and
        // the second copy is the one a screen reader will not read out.
        await panel.save();
        await panel.flattenAndSave();

        expect(panel.errorMessage).toBeNull();
      });

      it('says the flatten happened and that undo restores the link', async () => {
        await panel.save();
        await panel.flattenAndSave();

        expect(composer.doc.tracks[0].generated).toBeNull();
        expect(panel.saveBlockedReason).toContain('undo');
      });

      it('does not offer to flatten again, there being nothing left to flatten', async () => {
        await panel.save();
        await panel.flattenAndSave();
        fixture.detectChanges();

        const alert = fixture.debugElement.query(By.css('[role="alert"]'));
        expect(alert.nativeElement.textContent).not.toContain('Flatten and save');
      });

      it('clears the notice once a later save succeeds', async () => {
        await panel.save();
        await panel.flattenAndSave();

        (library.save as jasmine.Spy).and.resolveTo('saved-id');
        await panel.save();

        expect(panel.saveBlockedReason).toBeNull();
      });
    });

    it('clears a stale error when it refuses', async () => {
      // The error paragraph and the refusal sit in the same corner of the
      // panel. An error left over from an earlier failure reads as part of the
      // refusal that is now sitting above it.
      panel.errorMessage = 'Quota exceeded';

      await panel.save();

      expect(panel.errorMessage).toBeNull();
    });
  });
});
