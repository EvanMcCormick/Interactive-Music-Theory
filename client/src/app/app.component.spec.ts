import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app.component';
import { ComposerKeyHandler } from './services/composer-key-handler';
import { ComposerService } from './services/composer.service';

/**
 * The shell, and specifically the circle drawer it hosts.
 *
 * The drawer sets `selectedKey`, so it is only meaningful where something reads
 * it. On `/gp-viewer` and `/gp-library` it would do nothing; on `/transcribe` it
 * would be worse than nothing, because that page has its own key handling inside
 * `DerivationSettings` and a global key control that did not drive it would look
 * broken. The allow-list is the whole of that decision and is what these pin.
 */
describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('where the circle is offered', () => {
    it('offers it on the pages that read the key', () => {
      expect(AppComponent.showsCircle('/fretboard')).toBeTrue();
      expect(AppComponent.showsCircle('/composer')).toBeTrue();
    });

    /**
     * The progression page has no key picker of its own: the drawer *is* its
     * key control, which is the design doc's decision and the reason the page
     * mirrors `selectedKey` into `ProgressionService`. Withholding the toggle
     * there would leave the page with no way to change key at all.
     */
    it('offers it on the progression page, whose only key control it is', () => {
      expect(AppComponent.showsCircle('/progression')).toBeTrue();
    });

    it('withholds it where it would do nothing', () => {
      expect(AppComponent.showsCircle('/gp-viewer')).toBeFalse();
      expect(AppComponent.showsCircle('/gp-library')).toBeFalse();
    });

    it('withholds it on transcribe, where it would mislead', () => {
      expect(AppComponent.showsCircle('/transcribe')).toBeFalse();
    });

    it('ignores query strings and fragments', () => {
      expect(AppComponent.showsCircle('/fretboard?tuning=drop-d')).toBeTrue();
      expect(AppComponent.showsCircle('/composer#bar-4')).toBeTrue();
    });

    it('treats the empty route as the fretboard it redirects to', () => {
      expect(AppComponent.showsCircle('/')).toBeTrue();
    });
  });

  describe('opening and closing', () => {
    it('starts closed', () => {
      expect(component.circleOpen).toBeFalse();
    });

    it('toggles', () => {
      component.toggleCircle();
      expect(component.circleOpen).toBeTrue();

      component.toggleCircle();
      expect(component.circleOpen).toBeFalse();
    });

    it('closes on Escape', () => {
      component.toggleCircle();
      component.onEscape();

      expect(component.circleOpen).toBeFalse();
    });

    /**
     * The composer's Escape means back to Select, and it ignores a press something before it claimed.
     * So the shell claims Escape when - and only when - it used it: a claim with the drawer closed would
     * take Escape away from every page.
     */
    it('claims Escape only when it closes the drawer', () => {
      const withDrawerClosed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(withDrawerClosed);
      expect(withDrawerClosed.defaultPrevented).toBeFalse();

      component.toggleCircle();
      const withDrawerOpen = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(withDrawerOpen);
      expect(withDrawerOpen.defaultPrevented).toBeTrue();
      expect(component.circleOpen).toBeFalse();
    });

    /**
     * The claim must not depend on which listener was added first. A document listener registered before
     * the shell's - the composer's, on a page that set its up earlier - would otherwise run first and see
     * Escape unclaimed. The shell listens in the capture phase, which runs before every bubbling listener.
     */
    it('claims Escape before a page listener added earlier sees it, with a real key press', () => {
      const composer = TestBed.inject(ComposerService);
      const host = {
        composer,
        ...jasmine.createSpyObj('host', ['openPopover', 'toggleShortcutSheet', 'escape', 'playPause', 'playFromStart', 'requestSave', 'addTrack', 'typeFretDigit'])
      };
      const handler = new ComposerKeyHandler(host);
      const listener = (event: KeyboardEvent): void => void handler.handle(event);
      fixture.destroy();
      document.addEventListener('keydown', listener);
      try {
        const shell = TestBed.createComponent(AppComponent);
        shell.detectChanges();
        const escape = (): void => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        shell.componentInstance.toggleCircle();
        escape();
        expect(shell.componentInstance.circleOpen).toBeFalse();
        expect(host.escape).not.toHaveBeenCalled();

        escape();
        expect(host.escape).toHaveBeenCalledTimes(1);
        shell.destroy();
      } finally {
        document.removeEventListener('keydown', listener);
      }
    });

    it('closes when navigating somewhere the circle does not belong', () => {
      component.toggleCircle();
      expect(component.circleOpen).toBeTrue();

      // Leaving the fretboard for the transcriber must not leave a drawer open
      // over a page that it does not drive.
      component.onNavigated('/transcribe');

      expect(component.circleAvailable).toBeFalse();
      expect(component.circleOpen).toBeFalse();
    });

    it('stays open when navigating between pages that read the key', () => {
      component.onNavigated('/fretboard');
      component.toggleCircle();
      component.onNavigated('/composer');

      expect(component.circleAvailable).toBeTrue();
      expect(component.circleOpen).toBeTrue();
    });
  });
});
