import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposerLibraryPanelComponent } from './composer-library-panel.component';
import { ScoreDoc } from '../../../../models/composer.model';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from '../../../../services/alpha-tex.service';
import { ComposerExportService } from '../../../../services/composer-export.service';
import { CompositionEntry, ComposerLibraryService } from '../../../../services/composer-library.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';

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
    composer.replaceDocument(ComposerService.createEmptyScore(), { markClean: true, newComposition: true });

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

    it('saves when the keyboard asks, through the same save its button runs', async () => {
      TestBed.inject(ComposerSaveRequests).request();
      await fixture.whenStable();

      expect(library.save).toHaveBeenCalled();
    });

    it('writes one entry when a click and Ctrl+S both arrive while the first save is still writing', async () => {
      let finish: (id: string) => void = () => undefined;
      (library.save as jasmine.Spy).and.returnValue(new Promise<string>(resolve => (finish = resolve)));

      const click = panel.save();
      TestBed.inject(ComposerSaveRequests).request();
      const again = panel.save();
      finish('saved-id');
      await Promise.all([click, again]);
      await fixture.whenStable();

      expect(library.save).toHaveBeenCalledTimes(1);
    });

    describe('when Save is asked for again while a write is under way', () => {
      /** Resolves each write the library was asked for, in order. */
      let writes: Array<(id: string) => void>;
      /** Lets every pending promise callback run. */
      const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve));

      beforeEach(() => {
        writes = [];
        (library.save as jasmine.Spy).and.callFake(() => new Promise<string>(resolve => writes.push(resolve)));
      });

      it('leaves an edit made mid-write unsaved until one more write, over the same entry, lands', async () => {
        const first = panel.save();
        composer.setTempo(140);
        TestBed.inject(ComposerSaveRequests).request();

        writes[0]('saved-id');
        await first;
        await settle();
        expect(composer.state.isDirty).withContext('the first write held the tempo before the edit').toBeTrue();
        expect(library.save).toHaveBeenCalledTimes(2);
        expect((library.save as jasmine.Spy).calls.argsFor(1)[1]).toBe('saved-id');

        writes[1]('saved-id');
        await settle();
        expect(composer.state.isDirty).toBeFalse();
        expect(library.save).toHaveBeenCalledTimes(2);
      });

      it('writes one entry for a click and Ctrl+S, the second write updating the entry the first made', async () => {
        const click = panel.save();
        composer.setTempo(140);
        TestBed.inject(ComposerSaveRequests).request();
        writes[0]('saved-id');
        await click;
        await settle();
        writes[1]('saved-id');
        await settle();

        const ids = (library.save as jasmine.Spy).calls.allArgs().map(args => args[1]);
        expect(ids).toEqual([undefined, 'saved-id']);
      });

      it('runs one follow-up for three triggers', async () => {
        const first = panel.save();
        composer.setTempo(140);
        TestBed.inject(ComposerSaveRequests).request();
        void panel.save();
        TestBed.inject(ComposerSaveRequests).request();

        writes[0]('saved-id');
        await first;
        await settle();
        writes[1]('saved-id');
        await settle();

        expect(library.save).toHaveBeenCalledTimes(2);
        expect(composer.state.isDirty).toBeFalse();
      });
    });

    it('does not save while something on the page stands in the way, however Save is pressed', async () => {
      const requests = TestBed.inject(ComposerSaveRequests);
      const removeGuard = requests.guard(() => true);

      await panel.save();
      requests.request();
      await fixture.whenStable();
      expect(library.save).not.toHaveBeenCalled();

      removeGuard();
      await panel.save();
      expect(library.save).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Menus and a drawer in the top bar, hidden with CSS rather than removed - and the announced regions
   * outside them, since a region inside a hidden menu is out of the accessibility tree.
   */
  describe('as top-bar menus', () => {
    it('keeps both menus and the drawer in the page while closed', () => {
      const menus: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.menu-panel'));
      const drawer: HTMLElement = fixture.nativeElement.querySelector('.library-drawer');

      expect(menus.length).toBe(2);
      expect(menus.every(menu => getComputedStyle(menu).display === 'none')).toBeTrue();
      expect(drawer.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps its alert outside the menus and the drawer, and holds no live region of its own', () => {
      const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');

      expect(alert.closest('.menu-panel, .library-drawer')).toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-live]')).withContext('the page\'s status line is its one live region').toBeNull();
    });

    it('keeps a plain key pressed in the saved list from the score behind it, and lets Tab and Ctrl through', () => {
      panel.openDrawer();
      fixture.detectChanges();
      const heard: string[] = [];
      const page = (event: KeyboardEvent): void => void heard.push(event.key);
      document.addEventListener('keydown', page);

      const close: HTMLElement = fixture.nativeElement.querySelector('.drawer-close');
      for (const init of [{ key: 'ArrowRight' }, { key: 'r' }, { key: '5' }, { key: ' ' }, { key: 'Tab' }, { key: 's', ctrlKey: true }]) {
        close.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      }
      document.removeEventListener('keydown', page);

      expect(heard).toEqual(['Tab', 's']);
    });

    it('opens a menu from its button, and the saved list in a drawer', () => {
      (fixture.nativeElement.querySelector('[aria-controls="composer-library-menu"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const library: HTMLElement = fixture.nativeElement.querySelector('#composer-library-menu');
      expect(getComputedStyle(library).display).not.toBe('none');

      (fixture.nativeElement.querySelector('.open-drawer') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.library-drawer').getAttribute('aria-hidden')).toBe('false');
      expect(panel.libraryMenuOpen).toBeFalse();
    });

    it('closes the Export menu when an export is chosen', () => {
      panel.toggleExportMenu();

      panel.exportMidi();

      expect(panel.exportMenuOpen).toBeFalse();
    });

    it('closes a menu and the drawer on Escape, claiming it so the page\'s own Escape does not also act', () => {
      panel.toggleExportMenu();
      panel.openDrawer();
      let claimedBeforeThePage = false;
      const page = (event: KeyboardEvent): void => void (claimedBeforeThePage = event.defaultPrevented);
      document.addEventListener('keydown', page);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.removeEventListener('keydown', page);

      expect(panel.exportMenuOpen).toBeFalse();
      expect(panel.drawerOpen).toBeFalse();
      expect(claimedBeforeThePage).toBeTrue();
    });

    it('closes its menus and the drawer when a modal opens over the page, so Escape reaches the modal', () => {
      panel.toggleExportMenu();
      panel.openDrawer();

      fixture.componentRef.setInput('modalOpen', true);
      fixture.detectChanges();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(escape);

      expect(panel.exportMenuOpen).toBeFalse();
      expect(panel.drawerOpen).toBeFalse();
      expect(escape.defaultPrevented).toBeFalse();
    });

    it('leaves Escape to the page while nothing is open', () => {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

      document.body.dispatchEvent(escape);

      expect(escape.defaultPrevented).toBeFalse();
    });

    it('focuses the drawer\'s close button when it opens, and gives the focus to Library when × or Escape closes it', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-controls="composer-library-menu"]');
      const close: HTMLButtonElement = fixture.nativeElement.querySelector('.drawer-close');

      panel.openDrawer();
      fixture.detectChanges();
      expect(document.activeElement).toBe(close);

      close.click();
      fixture.detectChanges();
      expect(panel.drawerOpen).toBeFalse();
      expect(document.activeElement).toBe(toggle);

      panel.openDrawer();
      fixture.detectChanges();
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(panel.drawerOpen).toBeFalse();
      expect(document.activeElement).toBe(toggle);
    });

    it('gives the focus to Export after an export, whose item closed with its menu', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-controls="composer-export-menu"]');
      toggle.click();
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('#composer-export-menu button') as HTMLButtonElement).focus();

      panel.exportAlphaTex();
      fixture.detectChanges();

      expect(document.activeElement).toBe(toggle);
    });

    it('says when a menu or the drawer opens, so the page can close an open popover', () => {
      let opened = 0;
      panel.menuOpened.subscribe(() => opened++);

      panel.toggleLibraryMenu();
      panel.toggleLibraryMenu();
      panel.toggleExportMenu();
      panel.openDrawer();

      expect(opened).toBe(3);
    });

    it('says what it did, and why it failed, in the page\'s status line through the service', () => {
      panel.exportMidi();
      expect(composer.state.notice).toBe('Exported MIDI file');

      (exporter.downloadMidiFile as jasmine.Spy).and.throwError('No MIDI device');
      panel.exportMidi();
      expect(composer.state.refusal).toBe('No MIDI device');
      expect(composer.state.notice).toBeNull();
    });

    it('draws each saved composition as a button, which loads it and gives the focus to Library as the drawer closes', async () => {
      const doc = { ...ComposerService.createEmptyScore(), title: 'C' };
      const tex = TestBed.inject(AlphaTexService).export(TestBed.inject(ScoreDocMapperService).toScore(doc, new alphaTab.Settings()));
      const now = new Date();
      const entry: CompositionEntry = { id: 'c-id', title: 'C', artist: '', tex, tempo: 120, trackCount: 1, barCount: 4, dateCreated: now, dateModified: now };
      spyOn(library, 'get').and.resolveTo(entry);
      panel.entries = [entry];
      panel.openDrawer();
      fixture.detectChanges();

      // A button is pressed by Enter and Space as well as a click, and reached by Tab.
      const load: HTMLElement = fixture.nativeElement.querySelector('.composition-load');
      expect(load instanceof HTMLButtonElement).withContext('a row loads through a button').toBeTrue();
      load.focus();
      load.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(panel.currentId).toBe('c-id');
      expect(panel.drawerOpen).toBeFalse();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[aria-controls="composer-library-menu"]'));
    });

    it('closes on a click outside the panel, and not on a click inside it', () => {
      panel.toggleLibraryMenu();
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('#composer-library-menu') as HTMLElement).click();
      expect(panel.libraryMenuOpen).toBeTrue();

      document.body.click();
      expect(panel.libraryMenuOpen).toBeFalse();
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

        // In the page's status line, which reads out `ComposerState.notice`.
        expect(composer.state.notice).toContain('Saved');
      });

      /**
       * Save is in the Library menu, and the refusal drops below the top bar where that menu opens, so the two cannot be
       * shown together: a refusal closes the menu, and the focus goes to the Library button rather than into a menu the
       * refusal would cover.
       */
      const libraryToggle = (): HTMLButtonElement => fixture.nativeElement.querySelector('[aria-controls="composer-library-menu"]');

      it('closes the Library menu when Save pressed in it is refused, giving the focus to Library', async () => {
        libraryToggle().click();
        fixture.detectChanges();
        const save: HTMLButtonElement = fixture.nativeElement.querySelector('.save-actions button');
        save.focus();
        expect(document.activeElement).withContext('Save has the focus in the open menu').toBe(save);

        await panel.save();
        fixture.detectChanges();

        expect(panel.libraryMenuOpen).toBeFalse();
        expect(document.activeElement).toBe(libraryToggle());
      });

      it('gives the focus to Library when the offer is declined, leaving the menu closed', async () => {
        await panel.save();
        fixture.detectChanges();

        panel.dismissSaveBlock();
        fixture.detectChanges();

        expect(panel.libraryMenuOpen).toBeFalse();
        expect(document.activeElement).toBe(libraryToggle());
      });

      it('gives the focus to Library when the offer is taken, leaving the menu closed', async () => {
        // Both buttons destroy the element they live in, so without this focus
        // falls back to <body> and the keyboard user restarts from the top.
        await panel.save();
        fixture.detectChanges();

        await panel.flattenAndSave();
        fixture.detectChanges();

        expect(panel.libraryMenuOpen).toBeFalse();
        expect(document.activeElement).toBe(libraryToggle());
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
