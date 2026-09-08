import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app.component';

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
