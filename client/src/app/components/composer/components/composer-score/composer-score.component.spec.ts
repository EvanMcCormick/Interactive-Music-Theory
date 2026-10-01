import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerScoreComponent } from './composer-score.component';
import { AlphaTabState, HighlightConfig } from '../../../../models/alpha-tab.model';
import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { trackRowsOf } from '../../../../services/composer-track-rows';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
import { ComposerService } from '../../../../services/composer.service';
import { AlphaTexService } from '../../../../services/alpha-tex.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
import { ComposerLibraryService } from '../../../../services/composer-library.service';
import { GpConversionService } from '../../../../services/gp-conversion.service';
import { GP_LIBRARY_DB, GpLibraryService } from '../../../../services/gp-library.service';
import { deletedDatabase } from '../../../../services/indexed-db.spec-helper';
import { NoteBoundsSource } from '../../../../services/scale-highlight';
import { StaffHitTestService } from '../../../../services/staff-hit-test.service';
import { bottomLineDiatonic } from '../../../../services/staff-pitch';

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

  /** Opens a file of `names`, and gives the score it was read into. */
  function openFile(...names: string[]): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    for (const name of names) {
      const track = new alphaTab.model.Track();
      track.name = name;
      score.addTrack(track);
    }
    gp.open({ entryId: `entry-${names.join('-')}`, fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    return score;
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

  it('draws the score the file was read into with every track shown, and hides one in Original by drawing the others', fakeAsync(() => {
    const score = openFile('Lead', 'Bass', 'Drums');
    create();
    expect(alphaTabService.renderScore).toHaveBeenCalledOnceWith(score, [0, 1, 2]);

    views.toggleShown(rows(), 1);

    expect(alphaTabService.renderTracks).toHaveBeenCalledWith([0, 2]);
    expect(alphaTabService.renderScore).toHaveBeenCalledTimes(1);
    settle();
  }));

  it('does not read the bytes again: the file is parsed once, as it opens', fakeAsync(() => {
    const parse = spyOn(alphaTab.importer.ScoreLoader, 'loadScoreFromBytes').and.callThrough();
    openFile('Lead', 'Bass');

    create();

    expect(alphaTabService.renderScore.calls.mostRecent().args[0]).toBe(gp.original?.score as alphaTab.model.Score);
    expect(parse).not.toHaveBeenCalled();
    settle();
  }));

  it('draws the file again with only the tracks the strip shows, when the page comes back to it', fakeAsync(() => {
    const score = openFile('Lead', 'Bass', 'Drums');
    create();
    views.toggleShown(rows(), 1);
    fixture?.destroy();

    create();

    expect(alphaTabService.renderScore.calls.mostRecent().args).toEqual([score, [0, 2]]);
    settle();
  }));

  it('draws nothing of the last file when another opens: the new one is drawn with its own tracks', fakeAsync(() => {
    openFile('Lead', 'Bass');
    create();
    views.toggleShown(rows(), 1);
    alphaTabService.renderTracks.calls.reset();

    const score = openFile('Keys', 'Bass', 'Drums');
    expect(alphaTabService.renderTracks).not.toHaveBeenCalled();
    tick(200);

    expect(alphaTabService.renderScore.calls.mostRecent().args).toEqual([score, [0, 1, 2]]);
    settle();
  }));
});

/**
 * The scale panel's highlight on the page: rings drawn over the engraving from alphaTab's bounds lookup, once a render's
 * bounds are in place (`onPostRenderFinished`) and never while they are pending. alphaTab is stubbed, as above, and hands
 * the component a lookup of three note heads, and a `.at-surface` - the lookup's origin - is placed in the container.
 */
describe('ComposerScoreComponent and the scale highlight', () => {
  let fixture: ComponentFixture<ComposerScoreComponent>;
  let renderFinished: () => void = () => undefined;
  let postRenderFinished: () => void = () => undefined;
  let surface: HTMLElement;

  const cMajor: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 4, 7], name: 'C Major', type: 'chord' };

  /** C4, D4 and E4 on one notation staff, their heads 20px apart. */
  const staff = { showSlash: false, showStandardNotation: true, showNumbered: false };
  const lookup: NoteBoundsSource & { findBeat(): null } = {
    staffSystems: [
      {
        bars: [
          {
            bars: [
              {
                beats: [
                  {
                    beat: { voice: { bar: { staff } } },
                    notes: [60, 62, 64].map((realValue, index) => ({
                      noteHeadBounds: { x: 30 + index * 20, y: 40, w: 10, h: 8 },
                      note: { realValue, isPercussion: false, isDead: false }
                    }))
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    findBeat: () => null
  };

  beforeEach(async () => {
    const alphaTabService = jasmine.createSpyObj<AlphaTabService>('AlphaTabService', [
      'initializeApi',
      'renderScore',
      'renderTracks',
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
    alphaTabService.getBoundsLookup.and.returnValue(lookup as unknown as alphaTab.rendering.BoundsLookup);
    alphaTabService.getCurrentState.and.returnValue({ isPlaying: false } as AlphaTabState);
    alphaTabService.onRenderFinished.and.callFake(handler => (renderFinished = handler));
    alphaTabService.onPostRenderFinished.and.callFake(handler => (postRenderFinished = handler));

    await TestBed.configureTestingModule({
      imports: [ComposerScoreComponent],
      providers: [{ provide: AlphaTabService, useValue: alphaTabService }]
    }).compileComponents();

    fixture = TestBed.createComponent(ComposerScoreComponent);
    fixture.detectChanges();
    const container: HTMLElement = fixture.nativeElement.querySelector('.alphatab-container');
    surface = document.createElement('div');
    surface.className = 'at-surface';
    surface.style.cssText = 'position: absolute; left: 12px; top: 24px; width: 400px; height: 200px;';
    container.appendChild(surface);
  });

  afterEach(() => fixture.destroy());

  const marks = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.scale-mark'));

  /** Says the highlight to the score, as the page's binding does. */
  function highlight(config: HighlightConfig): void {
    fixture.componentRef.setInput('highlight', config);
    fixture.detectChanges();
  }

  /** alphaTab's post-render: the bounds of what it drew are in place. */
  function boundsArrive(): void {
    postRenderFinished();
    fixture.detectChanges();
  }

  it("rings each note head the highlight names once a render's bounds arrive, the root apart, where alphaTab drew it", () => {
    highlight(cMajor);
    boundsArrive();

    expect(marks().length).withContext('C and E, not D').toBe(2);
    expect(marks().map(mark => mark.classList.contains('root'))).toEqual([true, false]);
    const container: HTMLElement = fixture.nativeElement.querySelector('.alphatab-container');
    const offset = surface.getBoundingClientRect().left - container.getBoundingClientRect().left;
    expect(marks().map(mark => parseFloat(mark.style.left))).toEqual([offset + 30, offset + 70]);
    expect(marks().map(mark => mark.style.width)).toEqual(['10px', '10px']);
  });

  it('clears its rings when the highlight is turned off', () => {
    highlight(cMajor);
    boundsArrive();

    highlight({ ...cMajor, enabled: false });

    expect(marks().length).toBe(0);
  });

  it("clears the last engraving's rings as a render finishes, and draws none while its bounds are pending", () => {
    highlight(cMajor);
    boundsArrive();

    renderFinished();
    fixture.detectChanges();
    expect(marks().length).withContext('the new engraving is on the page, its bounds not yet').toBe(0);

    highlight({ ...cMajor, rootNote: 2 });
    expect(marks().length).withContext('a new highlight while the bounds are pending').toBe(0);

    boundsArrive();
    expect(marks().length).withContext('D major: D alone of C, D and E').toBe(1);
  });

  it('keeps its ring elements for a redraw that rings the same heads', () => {
    highlight(cMajor);
    boundsArrive();
    const [first] = marks();

    boundsArrive();
    highlight({ ...cMajor, name: 'C Major again' });

    expect(marks()[0]).toBe(first);
  });
});

/**
 * The caret over a `.gp` file in Original. The composition under the page is the empty one no one sees, so a caret held
 * there was clamped to bar 1: a press seeked to bar 1, and the edit that asked was written there after Convert. The file
 * keeps its own caret (`ComposerGpService.caret`), and Convert carries it into the composition.
 *
 * alphaTab is stubbed and holds the file's own score. For Pen, the hit test is faked as well: one notation staff under the
 * pointer, its bottom line clicked, on a page of one system whose master bar is the file's bar 3.
 */
describe('ComposerScoreComponent over a file in Original', () => {
  let fixture: ComponentFixture<ComposerScoreComponent>;
  let alphaTabService: jasmine.SpyObj<AlphaTabService>;
  let hitTest: jasmine.SpyObj<StaffHitTestService>;
  let composer: ComposerService;
  let gp: ComposerGpService;
  let beatMouseDown: (beat: alphaTab.model.Beat) => void = () => undefined;
  let score: alphaTab.model.Score;
  // The GP library opens its database as it is made: one of its own, not the one a browser holds.
  const gpDb = `gp-library-score-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await deletedDatabase(gpDb);
  });

  beforeEach(async () => {
    alphaTabService = jasmine.createSpyObj<AlphaTabService>('AlphaTabService', [
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
    hitTest = jasmine.createSpyObj<StaffHitTestService>('StaffHitTestService', [
      'allStaves',
      'surfaceOriginOf',
      'staffCentresIn',
      'staffIndexAt',
      'stringIn',
      'diatonicIn',
      'caretRect',
      'bandCaretRect',
      'lookupOffsetOf',
      'scaleOf'
    ]);
    alphaTabService.getBoundsLookup.and.returnValue(null);
    alphaTabService.getCurrentState.and.returnValue({ isPlaying: false } as AlphaTabState);
    alphaTabService.onBeatMouseDown.and.callFake(handler => (beatMouseDown = handler));
    // No staff under the pointer until a spec draws one.
    hitTest.allStaves.and.returnValue([]);
    hitTest.staffCentresIn.and.returnValue([]);
    hitTest.staffIndexAt.and.returnValue(null);
    hitTest.surfaceOriginOf.and.returnValue(null);
    hitTest.caretRect.and.returnValue(null);
    hitTest.lookupOffsetOf.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [ComposerScoreComponent],
      providers: [
        { provide: AlphaTabService, useValue: alphaTabService },
        { provide: StaffHitTestService, useValue: hitTest },
        { provide: GP_LIBRARY_DB, useValue: gpDb }
      ]
    }).compileComponents();

    composer = TestBed.inject(ComposerService);
    gp = TestBed.inject(ComposerGpService);
    const parsed = TestBed.inject(AlphaTexService).parse(['\\title "Keys"', '\\track "Piano"', 'c4.1 | c4.1 | r.2 e4.2 | c4.1 |'].join('\n')).score;
    if (!parsed) throw new Error('the file did not parse');
    score = parsed;
    // Bar 3 in the bass clef, so a pitch read under bar 1's treble clef would be the wrong note.
    score.tracks[0].staves[0].bars[2].clef = alphaTab.model.Clef.F4;
    alphaTabService.getApi.and.returnValue({ score } as unknown as alphaTab.AlphaTabApi);
    gp.open({ entryId: 'entry-keys', fileName: 'Keys.gp', bytes: new ArrayBuffer(4), score });

    fixture = TestBed.createComponent(ComposerScoreComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  const fileBeat = (barIndex: number): alphaTab.model.Beat => score.tracks[0].staves[0].bars[barIndex].voices[0].beats[0];

  /** The mouse-down on the score's container at (100, 50), then alphaTab's beat press on `beat`. */
  function press(beat: alphaTab.model.Beat, shiftKey = false): void {
    const container: HTMLElement = fixture.nativeElement.querySelector('.alphatab-container');
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, buttons: 1, clientX: 100, clientY: 50, shiftKey }));
    beatMouseDown(beat);
  }

  it("puts the file's caret on the beat pressed, not the empty composition's, and seeks there while stopped", () => {
    press(fileBeat(2));

    expect(gp.caret?.cursor).toEqual(jasmine.objectContaining({ trackIndex: 0, barIndex: 2, beatIndex: 0 }));
    expect(composer.state.cursor.barIndex).withContext('the composition under the file').toBe(0);
    expect(alphaTabService.seekToBeat).toHaveBeenCalledOnceWith(fileBeat(2));
  });

  it('does not seek on a press while the file plays', () => {
    alphaTabService.getCurrentState.and.returnValue({ isPlaying: true } as AlphaTabState);

    press(fileBeat(3));

    expect(gp.caret?.cursor.barIndex).toBe(3);
    expect(alphaTabService.seekToBeat).not.toHaveBeenCalled();
  });

  it("highlights a Shift-press's range over the file", () => {
    alphaTabService.getBoundsLookup.and.returnValue({ staffSystems: [], findBeat: () => ({}) } as unknown as alphaTab.rendering.BoundsLookup);

    press(fileBeat(1));
    press(fileBeat(3), true);

    expect(gp.caret?.anchor?.barIndex).toBe(1);
    expect(gp.caret?.cursor.barIndex).toBe(3);
    expect(alphaTabService.highlightRange).toHaveBeenCalledWith(fileBeat(1), fileBeat(3));
  });

  it("writes a Pen click in Original at the bar clicked once converted, its pitch read under that bar's clef", async () => {
    spyOn(TestBed.inject(ComposerLibraryService), 'save').and.resolveTo('composition-1');
    spyOn(TestBed.inject(GpLibraryService), 'deleteEntry').and.resolveTo();
    // One system, 0-100, drawing the piano's notation staff at 30-70; its master bar is bar 3 wherever it is pressed.
    const barBounds = { realBounds: { y: 30, h: 40 }, beats: [{ beat: fileBeat(2) }], findBeatAtPos: () => ({ beat: fileBeat(2) }) };
    const masterBar = { bars: [barBounds] };
    alphaTabService.getBoundsLookup.and.returnValue({
      staffSystems: [{ realBounds: { y: 0, h: 100 }, bars: [masterBar], findBarAtPos: () => masterBar }],
      findBeat: () => null
    } as unknown as alphaTab.rendering.BoundsLookup);
    const lines = { surface: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), lineY: [30, 40, 50, 60, 70], spacing: 10 };
    hitTest.allStaves.and.returnValue([lines]);
    hitTest.staffCentresIn.and.returnValue([50]);
    hitTest.staffIndexAt.and.returnValue(0);
    hitTest.surfaceOriginOf.and.returnValue({ left: 0, top: 0 } as DOMRect);
    // The click is on the bottom line: G2 in the bass clef, E4 in the treble.
    hitTest.diatonicIn.and.callFake((_lines, clef) => bottomLineDiatonic(clef));
    composer.setEntryMode('pen');

    // alphaTab's hit is bar 2; the staff under the pointer reads its own beat, bar 3's.
    press(fileBeat(1));
    expect(gp.request?.id).withContext('Pen asks before it writes').toBe(ASKING_PAGE_COMMANDS.penWrite);
    expect(gp.caret?.cursor.barIndex).toBe(2);

    await TestBed.inject(GpConversionService).convert();

    const beatAt = (barIndex: number) => composer.doc.tracks[0].staves[0].bars[barIndex].voices[0].beats[0];
    expect(beatAt(2).notes.map(note => note.pitch)).toEqual([jasmine.objectContaining({ kind: 'pitched', noteValue: 7, octave: 2 })]);
    expect(beatAt(0).notes.map(note => note.pitch))
      .withContext("the file's first beat, as it was")
      .toEqual([jasmine.objectContaining({ kind: 'pitched', noteValue: 0, octave: 4 })]);
  });
});
