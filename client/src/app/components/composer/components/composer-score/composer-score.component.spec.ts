import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as alphaTab from '@coderline/alphatab';

import { ComposerScoreComponent } from './composer-score.component';
import { AlphaTabState } from '../../../../models/alpha-tab.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerService } from '../../../../services/composer.service';

/**
 * The score's press guard, wired to the page's events (`pressGuardAfter`, design decision 17).
 *
 * alphaTab is stubbed: the spec hands the component a beat press as alphaTab would, after the mouse-down the component
 * hears on its container. With no surface engraved no staff is under the pointer, so a press that acts puts the caret on
 * the beat pressed.
 */
describe('ComposerScoreComponent press guard', () => {
  let fixture: ComponentFixture<ComposerScoreComponent>;
  let component: ComposerScoreComponent;
  let composer: ComposerService;
  let beatMouseDown: (beat: alphaTab.model.Beat) => void = () => undefined;

  beforeEach(async () => {
    const alphaTabService = jasmine.createSpyObj<AlphaTabService>('AlphaTabService', [
      'initializeApi',
      'renderScore',
      'render',
      'auditionAfterRender',
      'getApi',
      'getBoundsLookup',
      'getCurrentState',
      'onBeatMouseDown',
      'onBeatMouseMove',
      'onBeatMouseUp',
      'onRenderFinished',
      'onPostRenderFinished',
      'highlightRange',
      'clearHighlight',
      'seekToBeat',
      'dispose'
    ]);
    alphaTabService.getApi.and.returnValue(null);
    alphaTabService.getBoundsLookup.and.returnValue(null);
    alphaTabService.getCurrentState.and.returnValue({ isPlaying: false } as AlphaTabState);
    alphaTabService.onBeatMouseDown.and.callFake(handler => (beatMouseDown = handler));

    await TestBed.configureTestingModule({
      imports: [ComposerScoreComponent],
      providers: [{ provide: AlphaTabService, useValue: alphaTabService }]
    }).compileComponents();

    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerScoreComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  /** A press on the score: the mouse-down on its container, then alphaTab's beat press on bar `barIndex`'s first beat. */
  function pressBar(barIndex: number): void {
    const container: HTMLElement = fixture.nativeElement.querySelector('.alphatab-container');
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, buttons: 1 }));
    beatMouseDown({ index: 0, voice: { index: 0, bar: { index: barIndex, staff: { index: 0, track: { index: 0 } } } } } as unknown as alphaTab.model.Beat);
  }

  it('ignores the press that closed a popover, and takes the next once it is released', () => {
    component.ignoreNextPress();
    pressBar(2);
    expect(composer.state.cursor.barIndex).withContext('the closing press').toBe(0);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    pressBar(2);
    expect(composer.state.cursor.barIndex).toBe(2);
  });

  it('takes the next press once the closing press is cancelled, as a press dragged from a nav link is, with no mouse-up', () => {
    // pointerdown, mousedown, dragstart, pointercancel, dragend: the popover closed, and no mouse-up came.
    component.ignoreNextPress();
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));

    pressBar(2);

    expect(composer.state.cursor.barIndex).toBe(2);
  });

  it('takes the next press once a drag from the closing press ends, should its pointercancel be missed', () => {
    component.ignoreNextPress();
    pressBar(1);
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));

    pressBar(2);

    expect(composer.state.cursor.barIndex).toBe(2);
  });

  it('stops hearing the page once destroyed', () => {
    const removed = spyOn(document, 'removeEventListener').and.callThrough();

    fixture.destroy();

    const types = removed.calls.allArgs().map(args => args[0]);
    expect(types).toContain('pointercancel');
    expect(types).toContain('dragend');
    expect(types).toContain('mouseup');
  });
});
