import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { EMPTY_TRACK_VIEW, LAST_SHOWN_TRACK, TrackView, hideRefusalOf, renderedTracksOf, trackRowsOf } from './composer-track-rows';

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
});

describe('renderedTracksOf', () => {
  it('draws the rows shown, in order', () => {
    const rows = trackRowsOf(ComposerService.createEmptyScore(), EMPTY_TRACK_VIEW);

    expect(renderedTracksOf(rows)).toEqual([0]);
    expect(renderedTracksOf(rows.map(row => ({ ...row, shown: false })))).toEqual([]);
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
