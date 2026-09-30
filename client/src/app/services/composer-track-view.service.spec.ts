import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { LAST_SHOWN_TRACK, trackRowsOf } from './composer-track-rows';
import { ComposerTrackViewService } from './composer-track-view.service';

describe('ComposerTrackViewService', () => {
  let views: ComposerTrackViewService;
  let gp: ComposerGpService;
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    views = TestBed.inject(ComposerTrackViewService);
    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
  });

  /** A file of two tracks, the second muted and soloed by the file itself. */
  function openFile(): void {
    const score = new alphaTab.model.Score();
    score.addTrack(new alphaTab.model.Track());
    const second = new alphaTab.model.Track();
    second.playbackInfo.isMute = true;
    second.playbackInfo.isSolo = true;
    score.addTrack(second);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
  }

  it("takes a file's mutes and solos from what the file declares, with every track shown", () => {
    openFile();

    expect([...views.view.muted]).toEqual(['1']);
    expect([...views.view.soloed]).toEqual(['1']);
    expect(views.view.hidden.size).toBe(0);
  });

  it('toggles the player\'s mute and solo in Original, and never the file\'s', () => {
    openFile();

    views.toggleMuted('0');
    views.toggleSoloed('1');

    expect([...views.view.muted].sort()).toEqual(['0', '1']);
    expect([...views.view.soloed]).toEqual([]);
    expect(gp.original?.score.tracks[0].playbackInfo.isMute).toBeFalse();
  });

  it('hides and shows a track, and refuses to hide the last one shown', () => {
    openFile();
    const rows = () => trackRowsOf(gp.original!.score, views.view);

    expect(views.toggleShown(rows(), 0)).toBeNull();
    expect(views.toggleShown(rows(), 1)).toBe(LAST_SHOWN_TRACK);
    expect(rows().map(row => row.shown)).toEqual([false, true]);
    expect(views.toggleShown(rows(), 0)).toBeNull();
    expect(rows().map(row => row.shown)).toEqual([true, true]);
  });

  it('shows every track again when another composition opens', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    composer.replaceDocument(doc, { newComposition: true });
    views.toggleShown(trackRowsOf(composer.doc, views.view), 0);
    expect(views.view.hidden.size).toBe(1);

    composer.reset();

    expect(views.view.hidden.size).toBe(0);
  });

  it('keeps nothing of the file once the page leaves it', () => {
    openFile();

    gp.clear();

    expect(views.view.muted.size).toBe(0);
  });
});
