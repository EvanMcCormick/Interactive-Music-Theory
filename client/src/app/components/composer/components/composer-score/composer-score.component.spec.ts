import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerScoreComponent } from './composer-score.component';
import { AlphaTabState } from '../../../../models/alpha-tab.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { trackRowsOf } from '../../../../services/composer-track-rows';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
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
      'renderTracks',
      'setTrackPlayback',
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

/**
 * The track strip's view reaching alphaTab: which tracks are drawn, in either state, and the mixer - without engraving
 * again for a mute, a solo or a hide, since a render reloads the MIDI, and alphaTab's `loadMidiFile` stops the player and
 * rewinds it to bar 1.
 */
describe('ComposerScoreComponent and the track strip', () => {
  let alphaTabService: jasmine.SpyObj<AlphaTabService>;
  let composer: ComposerService;
  let gp: ComposerGpService;
  let views: ComposerTrackViewService;
  let fixture: ComponentFixture<ComposerScoreComponent> | null = null;

  beforeEach(async () => {
    alphaTabService = jasmine.createSpyObj<AlphaTabService>('AlphaTabService', [
      'initializeApi',
      'renderScore',
      'renderTracks',
      'loadBytes',
      'setTrackPlayback',
      'render',
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
      'dispose'
    ]);
    alphaTabService.getApi.and.returnValue(null);
    alphaTabService.getBoundsLookup.and.returnValue(null);
    alphaTabService.getCurrentState.and.returnValue({ isPlaying: false } as AlphaTabState);

    await TestBed.configureTestingModule({
      imports: [ComposerScoreComponent],
      providers: [{ provide: AlphaTabService, useValue: alphaTabService }]
    }).compileComponents();

    composer = TestBed.inject(ComposerService);
    gp = TestBed.inject(ComposerGpService);
    views = TestBed.inject(ComposerTrackViewService);
  });

  afterEach(() => fixture?.destroy());

  /** Makes the score, gives its container a width - alphaTab draws into none - and lets the first render's debounce run. */
  function create(): void {
    fixture = TestBed.createComponent(ComposerScoreComponent);
    fixture.detectChanges();
    const container: HTMLElement = fixture.nativeElement.querySelector('.alphatab-container');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 });
    tick(200);
  }

  /** Ends a fake-async spec with nothing left queued: the caret's frames and the debounce's timer. */
  function settle(): void {
    flush();
    discardPeriodicTasks();
  }

  /** Opens a composition of the empty score's guitar and a track for each of `names`. */
  function openComposition(...names: string[]): void {
    const doc = ComposerService.createEmptyScore();
    for (const name of names) doc.tracks.push(ComposerService.createTrack(name, name, 0, false, doc.masterBars));
    composer.replaceDocument(doc, { newComposition: true });
  }

  /** Opens a file of `names`, and gives its bytes. */
  function openFile(...names: string[]): ArrayBuffer {
    const score = new alphaTab.model.Score();
    for (const name of names) {
      const track = new alphaTab.model.Track();
      track.name = name;
      score.addTrack(track);
    }
    const bytes = new ArrayBuffer(4);
    gp.open({ entryId: `entry-${names.join('-')}`, fileName: 'Band.gp', bytes, score });
    return bytes;
  }

  /** The strip's rows for what the page shows. */
  const rows = () => trackRowsOf(gp.original?.score ?? composer.doc, views.view);

  it('engraves only the tracks the strip shows, in Composition', fakeAsync(() => {
    openComposition('Piano', 'Bass');
    views.toggleShown(rows(), 1);

    create();

    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(1);
    expect(alphaTabService.renderScore.calls.mostRecent().args[1]).toEqual([0, 2]);
    settle();
  }));

  it('plays a mute or a solo without engraving again, which would stop the player', fakeAsync(() => {
    openComposition('Piano');
    create();

    composer.setPlayback({ isMute: true }, 1);
    composer.setPlayback({ isSolo: true }, 0);
    tick(200);

    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(1);
    expect(alphaTabService.setTrackPlayback).toHaveBeenCalledWith([
      { mute: false, solo: true },
      { mute: true, solo: false }
    ]);
    settle();
  }));

  it('still engraves an edit made after a mute', fakeAsync(() => {
    openComposition('Piano');
    create();
    composer.setPlayback({ isMute: true }, 1);
    tick(200);

    composer.toggleMasterBarFlag('isDoubleBar');
    tick(200);

    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(2);
    settle();
  }));

  it('hides a track in Composition by drawing the shown tracks of the score alphaTab holds, not by engraving again', fakeAsync(() => {
    openComposition('Piano');
    create();

    views.toggleShown(rows(), 0);
    tick(200);

    expect(alphaTabService.renderTracks).toHaveBeenCalledWith([1]);
    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(1);
    settle();
  }));

  it('engraves the document a Remove leaves rather than drawing the old score with its rows', fakeAsync(() => {
    // A shown, B hidden: removing A leaves B alone, which the view then shows (`keptHiddenOf`) - before this component
    // has heard of the Remove, since the view service hears the composer first.
    openComposition('Piano');
    views.toggleShown(rows(), 1);
    create();
    alphaTabService.renderTracks.calls.reset();

    composer.removeTrack(0);
    tick(200);

    expect(alphaTabService.renderTracks).not.toHaveBeenCalled();
    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(2);
    expect(alphaTabService.renderScore.calls.mostRecent().args[1]).toEqual([0]);
    settle();
  }));

  it("hands the player each row's mute and solo", fakeAsync(() => {
    openComposition('Piano');
    composer.setPlayback({ isSolo: true }, 0);

    create();

    expect(alphaTabService.setTrackPlayback).toHaveBeenCalledWith([
      { mute: false, solo: true },
      { mute: false, solo: false }
    ]);
    settle();
  }));

  it('loads a file with every track shown, and hides one in Original by drawing the others of the score it holds', fakeAsync(() => {
    const bytes = openFile('Lead', 'Bass', 'Drums');
    create();
    expect(alphaTabService.loadBytes).toHaveBeenCalledOnceWith(bytes, [0, 1, 2]);

    views.toggleShown(rows(), 1);

    expect(alphaTabService.renderTracks).toHaveBeenCalledWith([0, 2]);
    expect(alphaTabService.loadBytes).toHaveBeenCalledTimes(1);
    settle();
  }));

  it('loads a file again with only the tracks the strip shows, when the page comes back to it', fakeAsync(() => {
    const bytes = openFile('Lead', 'Bass', 'Drums');
    create();
    views.toggleShown(rows(), 1);
    fixture?.destroy();

    create();

    expect(alphaTabService.loadBytes.calls.mostRecent().args).toEqual([bytes, [0, 2]]);
    settle();
  }));

  it('draws nothing of the last file when another opens: the new one is loaded with its own tracks', fakeAsync(() => {
    openFile('Lead', 'Bass');
    create();
    views.toggleShown(rows(), 1);
    alphaTabService.renderTracks.calls.reset();

    const bytes = openFile('Keys', 'Bass', 'Drums');
    expect(alphaTabService.renderTracks).not.toHaveBeenCalled();
    tick(200);

    expect(alphaTabService.loadBytes.calls.mostRecent().args).toEqual([bytes, [0, 1, 2]]);
    settle();
  }));
});
