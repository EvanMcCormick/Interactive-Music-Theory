import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { LAST_SHOWN_TRACK } from './composer-text';
import { trackRowsOf } from './composer-track-rows';
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

  describe("in Original, the file's caret", () => {
    /** A file of three one-bar tracks, read as alphaTab reads a `.gp`. */
    function openBand(): void {
      const source = ['\\track "Guitar"', '3.3.1 | 3.3.1 |', '\\track "Bass"', '3.4.1 | 3.4.1 |', '\\track "Keys"', 'c4.1 | c4.1 |'].join('\n');
      const score = TestBed.inject(AlphaTexService).parse(source).score;
      if (!score) throw new Error('the file did not parse');
      gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    }
    const rows = () => trackRowsOf(gp.original!.score, views.view);

    it('moves off a track as it is hidden, keeping its bar, and never touches the composition under the file', () => {
      openBand();
      composer.setCursor({ trackIndex: 1, barIndex: 1 });
      const under = composer.state.cursor;

      views.toggleShown(rows(), 1);

      expect(gp.caret?.cursor).toEqual(jasmine.objectContaining({ trackIndex: 2, barIndex: 1, beatIndex: 0 }));
      expect(composer.state.cursor).toBe(under);
    });

    it('passes over hidden tracks on a keyboard track move', () => {
      openBand();
      views.toggleShown(rows(), 1);

      composer.moveCursor({ kind: 'track', delta: 1 });

      expect(gp.caret?.cursor.trackIndex).toBe(2);
    });
  });

  describe('in Composition', () => {
    /** Opens a composition of the empty score's guitar and a track for each of `names`. */
    function openComposition(...names: string[]): void {
      const doc = ComposerService.createEmptyScore();
      for (const name of names) doc.tracks.push(ComposerService.createTrack(name, name, 0, false, doc.masterBars));
      composer.replaceDocument(doc, { newComposition: true });
    }

    const rows = () => trackRowsOf(composer.doc, views.view);
    const shown = (): boolean[] => rows().map(row => row.shown);

    it('shows every track again when Remove leaves only hidden ones', () => {
      openComposition('Piano');
      views.toggleShown(rows(), 0);

      composer.removeTrack(1);

      expect(shown()).toEqual([true]);
      expect(views.view.hidden.size).toBe(0);
    });

    it('shows every track again when Undo takes away the track that was the only one shown', () => {
      openComposition();
      composer.addTrack('Piano', 0, false);
      views.toggleShown(rows(), 0);
      expect(shown()).toEqual([false, true]);

      composer.undo();

      expect(shown()).toEqual([true]);
      expect(views.view.hidden.size).toBe(0);
    });

    it('forgets a hidden track the document no longer has, so a later one is not hidden by it', () => {
      openComposition('Piano', 'Bass');
      views.toggleShown(rows(), 2);

      composer.removeTrack(2);

      expect(views.view.hidden.size).toBe(0);
    });

    it('shows every track again when an alphaTex draft is applied: a new document from text, its tracks numbered afresh', () => {
      openComposition('Piano');
      views.toggleShown(rows(), 1);
      // Numbered as `toDoc` numbers them, by position: the ids come back, on whatever tracks the text now puts there.
      const applied = ComposerService.createEmptyScore();
      applied.tracks.push(ComposerService.createTrack('Bass', 'bass', 33, true, applied.masterBars));
      applied.tracks.forEach((track, index) => (track.id = composer.doc.tracks[index].id));

      // What the page's Apply does (`ComposerComponent.applyTexDraft`): an edit of this composition, not a new one.
      composer.replaceDocument(applied);

      expect(shown()).toEqual([true, true]);
    });

    it("moves the caret off a track it hides: to the next track shown, else the one before it", () => {
      openComposition('Piano', 'Bass');
      composer.setCursor({ trackIndex: 1, barIndex: 2 });

      views.toggleShown(rows(), 1);
      expect(composer.state.cursor.trackIndex).toBe(2);

      views.toggleShown(rows(), 2);
      expect(composer.state.cursor.trackIndex).toBe(0);
    });

    it('leaves the caret where it is when another track is hidden', () => {
      openComposition('Piano');
      composer.setCursor({ trackIndex: 1, barIndex: 2 });

      views.toggleShown(rows(), 0);

      expect(composer.state.cursor.trackIndex).toBe(1);
      expect(composer.state.cursor.barIndex).toBe(2);
    });

    it('shows every track again on New', () => {
      openComposition('Piano');
      views.toggleShown(rows(), 1);

      composer.reset();

      expect(views.view.hidden.size).toBe(0);
    });

    it('passes over hidden tracks on a keyboard track move', () => {
      openComposition('Piano', 'Bass');
      views.toggleShown(rows(), 1);

      composer.moveCursor({ kind: 'track', delta: 1 });
      expect(composer.state.cursor.trackIndex).toBe(2);

      composer.moveCursor({ kind: 'track', delta: -1 });
      expect(composer.state.cursor.trackIndex).toBe(0);
    });
  });
});
