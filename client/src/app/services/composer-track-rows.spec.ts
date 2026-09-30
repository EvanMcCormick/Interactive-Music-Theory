import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { LAST_SHOWN_TRACK } from './composer-text';
import {
  EMPTY_TRACK_VIEW,
  TrackView,
  hiddenAfterConvertOf,
  hideRefusalOf,
  keptHiddenOf,
  nearestShownTrackOf,
  renderedTracksOf,
  trackRowsOf
} from './composer-track-rows';

describe('trackRowsOf', () => {
  /** A composition of guitar and piano, the piano muted in its own mixer. */
  function composition() {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].playback.isMute = true;
    return doc;
  }

  /** A file of two tracks, the second unnamed. */
  function file(): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    const first = new alphaTab.model.Track();
    first.name = 'Lead';
    score.addTrack(first);
    score.addTrack(new alphaTab.model.Track());
    return score;
  }

  it("reads a composition's rows from its document, mute and solo from its own mixer", () => {
    const doc = composition();

    const rows = trackRowsOf(doc, EMPTY_TRACK_VIEW);

    expect(rows.map(row => [row.index, row.key, row.name, row.shown, row.muted, row.soloed])).toEqual([
      [0, doc.tracks[0].id, doc.tracks[0].name, true, false, false],
      [1, doc.tracks[1].id, 'Piano', true, true, false]
    ]);
  });

  it("reads a file's rows from the alphaTab score, and mute and solo from the view: the player's, not the file's", () => {
    const view: TrackView = { hidden: new Set(['1']), muted: new Set(['0']), soloed: new Set(['1']) };

    const rows = trackRowsOf(file(), view);

    expect(rows.map(row => [row.index, row.key, row.name, row.shown, row.muted, row.soloed])).toEqual([
      [0, '0', 'Lead', true, true, false],
      [1, '1', 'Track 2', false, false, true]
    ]);
  });

  it("keeps a composition's hidden track by its id, so it stays hidden when a track before it goes", () => {
    const doc = composition();
    const view: TrackView = { ...EMPTY_TRACK_VIEW, hidden: new Set([doc.tracks[1].id]) };
    doc.tracks.shift();

    expect(trackRowsOf(doc, view).map(row => row.shown)).toEqual([false]);
  });

  it("names an unnamed composition track as an unnamed file track is named, so its buttons never read \"Mute \"", () => {
    const doc = composition();
    doc.tracks[1].name = '';

    expect(trackRowsOf(doc, EMPTY_TRACK_VIEW).map(row => row.name)).toEqual([doc.tracks[0].name, 'Track 2']);
  });
});

describe('renderedTracksOf', () => {
  it('draws the rows shown, in order', () => {
    const rows = trackRowsOf(ComposerService.createEmptyScore(), EMPTY_TRACK_VIEW);

    expect(renderedTracksOf(rows)).toEqual([0]);
  });

  it('never draws no track: rows all hidden draw every row, as alphaTab would otherwise draw the first with no staves known', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const rows = trackRowsOf(doc, EMPTY_TRACK_VIEW);

    expect(renderedTracksOf(rows.map(row => ({ ...row, shown: false })))).toEqual([0, 1]);
    expect(renderedTracksOf([])).toEqual([]);
  });
});

describe('nearestShownTrackOf', () => {
  /** Four rows, with the ones at `hidden` hidden. */
  function rows(...hidden: number[]) {
    const doc = ComposerService.createEmptyScore();
    for (const name of ['B', 'C', 'D']) doc.tracks.push(ComposerService.createTrack(name, name, 0, false, doc.masterBars));
    return trackRowsOf(doc, { ...EMPTY_TRACK_VIEW, hidden: new Set(hidden.map(index => doc.tracks[index].id)) });
  }

  it('is the next track shown after it, else the one before it', () => {
    expect(nearestShownTrackOf(rows(1), 1)).toBe(2);
    expect(nearestShownTrackOf(rows(1, 2), 1)).toBe(3);
    expect(nearestShownTrackOf(rows(3), 3)).toBe(2);
    expect(nearestShownTrackOf(rows(2, 3), 3)).toBe(1);
  });

  it('is none when no other track is shown', () => {
    expect(nearestShownTrackOf(rows(0, 1, 2), 3)).toBeNull();
  });
});

describe('keptHiddenOf', () => {
  function doc() {
    const score = ComposerService.createEmptyScore();
    score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
    return score;
  }

  it('keeps a hidden set whose tracks are all still there, as the same set', () => {
    const score = doc();
    const hidden = new Set([score.tracks[1].id]);

    expect(keptHiddenOf(hidden, score)).toBe(hidden);
  });

  it('drops the tracks the document no longer has', () => {
    const score = doc();

    expect([...keptHiddenOf(new Set([score.tracks[1].id, 'track-gone']), score)]).toEqual([score.tracks[1].id]);
  });

  it('shows every track rather than none: a set that would hide them all is dropped', () => {
    const score = doc();
    score.tracks.pop();

    expect(keptHiddenOf(new Set([score.tracks[0].id]), score).size).toBe(0);
  });
});

describe('hiddenAfterConvertOf', () => {
  it("names the file's hidden tracks, kept by index, by the ids of the composition made of it", () => {
    const score = ComposerService.createEmptyScore();
    score.tracks.push(ComposerService.createTrack('Bass', 'bass', 33, true, score.masterBars));
    score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));

    expect([...hiddenAfterConvertOf(new Set(['1', '7']), score)]).toEqual([score.tracks[1].id]);
  });
});

describe('hideRefusalOf', () => {
  it('refuses hiding the last track shown, and nothing else', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const both = trackRowsOf(doc, EMPTY_TRACK_VIEW);
    const one = trackRowsOf(doc, { ...EMPTY_TRACK_VIEW, hidden: new Set([doc.tracks[0].id]) });

    expect(hideRefusalOf(both, 0)).toBeNull();
    expect(hideRefusalOf(one, 1)).toBe(LAST_SHOWN_TRACK);
    // Showing the hidden one is never refused.
    expect(hideRefusalOf(one, 0)).toBeNull();
  });
});
