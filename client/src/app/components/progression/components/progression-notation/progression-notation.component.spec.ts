import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabSettings } from '../../../../models/alpha-tab.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ProgressionService } from '../../../../services/progression.service';
import { ProgressionNotationComponent } from './progression-notation.component';

/**
 * Stands in for the engraver, so nothing here fetches a font or a soundfont.
 *
 * The counts are the assertions this file is mostly about: whether an api
 * exists at all is the panel's whole "on demand" claim, and how many renders a
 * burst of edits produces is its "debounced to a rest" one.
 */
class FakeAlphaTabService {
  initialised = 0;
  disposed = 0;
  reRenders = 0;
  readonly rendered: alphaTab.model.Score[] = [];
  settings: AlphaTabSettings | undefined;
  /** Set to throw out of `renderScore`, for the error path. */
  failWith: string | null = null;

  private api: object | null = null;

  initializeApi(_element: HTMLElement, settings?: AlphaTabSettings): void {
    this.initialised += 1;
    this.settings = settings;
    this.api = {};
  }

  renderScore(score: alphaTab.model.Score): void {
    if (this.failWith) throw new Error(this.failWith);
    this.rendered.push(score);
  }

  render(): void {
    this.reRenders += 1;
  }

  getApi(): object | null {
    return this.api;
  }

  dispose(): void {
    this.disposed += 1;
    this.api = null;
  }
}

/** The debounce the component uses, plus a tick to clear it. */
const PAST_DEBOUNCE = 150;

describe('ProgressionNotationComponent', () => {
  let fixture: ComponentFixture<ProgressionNotationComponent>;
  let component: ProgressionNotationComponent;
  let progression: ProgressionService;
  let engraver: FakeAlphaTabService;

  beforeEach(() => {
    engraver = new FakeAlphaTabService();

    TestBed.configureTestingModule({
      imports: [ProgressionNotationComponent],
      providers: [{ provide: AlphaTabService, useValue: engraver }]
    });

    fixture = TestBed.createComponent(ProgressionNotationComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function toggleButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.notation-toggle') as HTMLButtonElement;
  }

  /**
   * Presses the toggle, the way a user does.
   *
   * Through the button rather than by calling `toggle()`: the panel is
   * `OnPush`, so a property set from outside a template event never marks the
   * view dirty and the `*ngIf` would not run - which is also exactly what would
   * happen in the page if the toggle were driven by anything but a click.
   */
  function press(): void {
    toggleButton().click();
    fixture.detectChanges();
  }

  /** Opens the panel and lets the debounced render run. */
  function open(): void {
    press();
    tick(PAST_DEBOUNCE);
    fixture.detectChanges();
  }

  it('starts closed, with no engraver at all', () => {
    expect(component.isOpen).toBeFalse();
    expect(engraver.initialised).toBe(0);
    expect(fixture.nativeElement.querySelector('.notation-surface')).toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('does no work while a closed panel watches the document change', fakeAsync(() => {
    progression.appendSlot(0);
    tick(PAST_DEBOUNCE);

    expect(engraver.initialised).toBe(0);
    expect(engraver.rendered.length).toBe(0);
  }));

  it('builds the engraver when it is opened, and draws once', fakeAsync(() => {
    progression.appendSlot(0);
    open();

    expect(engraver.initialised).toBe(1);
    expect(engraver.rendered.length).toBe(1);
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
  }));

  it('asks for no player', fakeAsync(() => {
    open();

    expect(engraver.settings?.player?.enablePlayer).toBeFalse();
  }));

  it('draws the progression, not an empty score', fakeAsync(() => {
    progression.appendSlot(0);
    progression.appendSlot(4);
    open();

    const score = engraver.rendered[0];
    expect(score.masterBars.length).toBe(2);
    expect(score.tracks.length).toBe(1);
    // The first bar carries the chord the palette put there.
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length)
      .toBeGreaterThan(0);
  }));

  it('follows the document while it is open', fakeAsync(() => {
    open();
    const before = engraver.rendered.length;

    progression.appendSlot(0);
    tick(PAST_DEBOUNCE);
    fixture.detectChanges();

    expect(engraver.rendered.length).toBe(before + 1);
  }));

  it('draws once for a burst of edits rather than once each', fakeAsync(() => {
    // What a drag looks like from here: the roll's setters coalesce into one
    // undo entry but publish a state per threshold the pointer crosses, so
    // there is no edit boundary to render on - only a rest.
    open();
    const before = engraver.rendered.length;

    progression.appendSlot(0);
    tick(20);
    progression.setSlotLength(progression.doc.slots[0].id, 5, { coalesce: true });
    tick(20);
    progression.setSlotLength(progression.doc.slots[0].id, 6, { coalesce: true });
    tick(PAST_DEBOUNCE);
    fixture.detectChanges();

    expect(engraver.rendered.length).toBe(before + 1);
  }));

  it('counts the bars it drew', fakeAsync(() => {
    progression.appendSlot(0);
    progression.appendSlot(3);
    progression.appendSlot(4);
    open();

    expect(component.barCount).toBe(3);
    expect(component.truncatedTo).toBeNull();
    expect(fixture.nativeElement.querySelector('.notation-count').textContent).toContain('3 bars');
  }));

  it('says so when a progression is too long to draw in full', fakeAsync(() => {
    progression.appendSlot(0);
    progression.setSlotLength(progression.doc.slots[0].id, 4000);
    open();

    expect(component.truncatedTo).toBe(512);
    expect(component.barCount).toBe(1000);
    expect(fixture.nativeElement.querySelector('.notation-warning')).not.toBeNull();
  }));

  it('reports a failed drawing instead of taking the page down', fakeAsync(() => {
    engraver.failWith = 'no font';
    progression.appendSlot(0);
    open();

    expect(component.renderError).toContain('no font');
    expect(fixture.nativeElement.querySelector('.notation-error')).not.toBeNull();
  }));

  it('survives a document it cannot project, and draws the next one', fakeAsync(() => {
    // A meter the quantizer's grid cannot express: `barGridFault` refuses
    // 4/128 at a finest division of 64, and `quantizeBar` throws on it. The
    // render runs from a subscription, so an escaping error would end the
    // subscription and leave a panel that never drew again.
    progression.appendSlot(0);
    open();
    const good = progression.doc;

    progression.replaceDocument({
      ...good,
      timeSignature: { numerator: 4, denominator: 128, isCommon: false }
    });
    tick(PAST_DEBOUNCE);
    fixture.detectChanges();

    expect(component.renderError).toContain('Could not draw');

    const before = engraver.rendered.length;
    progression.replaceDocument(good);
    tick(PAST_DEBOUNCE);
    fixture.detectChanges();

    expect(engraver.rendered.length).toBe(before + 1);
    expect(component.renderError).toBeNull();
  }));

  it('gives the engraver back when it is closed', fakeAsync(() => {
    open();
    expect(engraver.disposed).toBe(0);

    press();

    expect(component.isOpen).toBeFalse();
    expect(engraver.disposed).toBe(1);
    expect(engraver.getApi()).toBeNull();
  }));

  it('stops drawing once it is closed', fakeAsync(() => {
    open();
    const before = engraver.rendered.length;

    press();

    progression.appendSlot(0);
    tick(PAST_DEBOUNCE);

    expect(engraver.rendered.length).toBe(before);
  }));

  it('reopens with nothing left over from the last drawing', fakeAsync(() => {
    engraver.failWith = 'no font';
    progression.appendSlot(0);
    open();
    expect(component.renderError).not.toBeNull();
    expect(component.barCount).toBe(1);

    press();

    // Cleared on close rather than on the next successful render, so the
    // reopened panel does not show a stale error over a fresh score for the
    // length of the debounce.
    expect(component.renderError).toBeNull();
    expect(component.barCount).toBe(0);
    expect(component.truncatedTo).toBeNull();
  }));

  it('builds a fresh engraver when it is opened again', fakeAsync(() => {
    open();
    press();
    open();

    expect(engraver.initialised).toBe(2);
    expect(engraver.disposed).toBe(1);
  }));

  it('gives the engraver back when the page is left', fakeAsync(() => {
    open();
    fixture.destroy();

    expect(engraver.disposed).toBe(1);
  }));

  it('disposes nothing it never built', () => {
    fixture.destroy();

    expect(engraver.disposed).toBe(0);
  });
});
