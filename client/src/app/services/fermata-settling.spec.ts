import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { deleteBeats, insertBeatAt, setBeatDurations, setGrace } from './beat-edits';
import { playbackStartsOf } from './bar-fill';
import { fermataNoticeOf } from './fermata-settling';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { writtenBeats, writtenOf } from './written-beats.spec-helper';
import { ScoreDoc } from '../models/composer.model';

/**
 * A fermata through an edit that moves beats, read at the tick alphaTab files it at.
 *
 * alphaTab finishes tracks in order and files each beat's fermata on its master bar at the tick the beat plays
 * at, handing it to every beat finished later at that tick without one (`Voice.finish` ~3262-3294,
 * `MasterBar.addFermata` ~2705, `MasterBar.getFermata` ~2728). Each spec saves through the mapper and expects the
 * document back as it was.
 */

/** Track `trackIndex`'s beat `beatIndex` in bar 0. */
const ref = (beatIndex: number, trackIndex = 0): BeatRef => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

/**
 * A score whose tracks are all guitars, bar 0 of each written in `writtenBeats`' shorthand with `F` after a beat
 * holding a medium fermata: `n4 n4F n2`.
 */
function scoreOf(...tracks: string[]): ScoreDoc {
  const doc = ComposerService.createEmptyScore();
  tracks.forEach((written, trackIndex) => {
    if (trackIndex > 0) doc.tracks.push(ComposerService.createTrack(`Guitar ${trackIndex + 1}`, `gt${trackIndex + 1}`, 25, true, doc.masterBars));
    const tokens = written.split(' ');
    const beats = writtenBeats(tokens.map(token => token.replace(/F$/, '')).join(' '));
    tokens.forEach((token, index) => {
      if (token.endsWith('F')) beats[index].effects.fermata = { type: 'medium', length: 1 };
    });
    doc.tracks[trackIndex].staves[0].bars[0].voices[0].beats = beats;
  });
  return doc;
}

/** Bar 0 of every track in `scoreOf`'s shorthand. */
const shapesOf = (doc: ScoreDoc): string[] =>
  doc.tracks.map(track => {
    const beats = track.staves[0].bars[0].voices[0].beats;
    return writtenOf(beats).split(' ').map((token, index) => `${token}${beats[index].effects.fermata ? 'F' : ''}`).join(' ');
  });

describe('playbackStartsOf', () => {
  it('starts graces one after another, a beat after on-beat graces where they end, and one after before-beat graces at its own tick', () => {
    // A lone grace plays a 32nd (120), two play 64ths (60) and more play 128ths (30).
    expect(playbackStartsOf(writtenBeats('n4 o n4 g g n4 o o o n4'))).toEqual([0, 960, 1080, 1920, 1980, 1920, 2880, 2910, 2940, 2970]);
  });

  it('reads a run by its first grace, and leaves graces that end a bar where they play', () => {
    expect(playbackStartsOf(writtenBeats('o g n2 n4 g'))).toEqual([0, 60, 120, 1920, 2880]);
  });
});

describe('fermata positions and carrying', () => {
  let mapper: ScoreDocMapperService;
  const saved = (doc: ScoreDoc): ScoreDoc => mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings()));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  it('reads a beat after an on-beat grace at the tick it plays, so a save gives no other track its fermata', () => {
    // An on-beat grace takes its 32nd from the beat it leads into, which alphaTab starts, and files a fermata for,
    // 120 ticks later. The second track's 32nd there took the fermata on save.
    const doc = scoreOf('n4 n4F n2', 'n4 n32F n32 n16 n8 n2');

    setGrace(doc, [ref(0)], 'onBeat');

    // The quarter holding the fermata now plays at 1080, and the second track still holds it at 960, so it stays
    // there: on the grace, which plays at 960.
    expect(shapesOf(doc)).toEqual(['r4 oF n4 n2', 'n4 n32F n32 n16 n8 n2']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });

  it('carries a fermata with its note when a beat before it grows on a single track', () => {
    const doc = scoreOf('n4 n4F n4 n4');

    setBeatDurations(doc, [ref(0)], 2, 0);

    expect(shapesOf(doc)).toEqual(['n2 n4F n4 n4']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });

  it('carries every fermata along a run of notes that each move onto the next one\'s place', () => {
    const doc = scoreOf('n4 n4F n4F n4');

    setBeatDurations(doc, [ref(0)], 2, 0);

    expect(shapesOf(doc)).toEqual(['n2 n4F n4F n4']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });

  it('removes a fermata whose note moved where another track has a beat, and says so', () => {
    // Carried to 1920, the fermata would reach the second track's half there on save.
    const doc = scoreOf('n4 n4F n4 n4', 'n2 n2');

    const dropped = setBeatDurations(doc, [ref(0)], 2, 0);

    expect(shapesOf(doc)).toEqual(['n2 n4 n4 n4', 'n2 n2']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
    expect(dropped).toEqual(['otherTracks']);
    expect(fermataNoticeOf(dropped)).toBe('1 fermata removed: its note moved where it would reach other tracks.');
  });

  it('says nothing was removed when every fermata was carried or kept', () => {
    expect(setBeatDurations(scoreOf('n4 n4F n4 n4'), [ref(0)], 2, 0)).toEqual([]);
    expect(setBeatDurations(scoreOf('n4 n4F n4 n4', 'n4 n4F n4 n4'), [ref(0)], 2, 0)).toEqual([]);
    expect(fermataNoticeOf([])).toBeNull();
  });

  it('carries a fermata an insert pushes later, and reports one it cannot', () => {
    const single = scoreOf('n4 n4F n4 n4');
    expect(insertBeatAt(single, ref(0), 4, 0)?.droppedFermatas).toEqual([]);
    expect(shapesOf(single)).toEqual(['r4 n4 n4F n4 n4']);
    expect(shapesOf(saved(single))).toEqual(shapesOf(single));

    // The half is pushed across 1920, so nothing plays at the fermata's place any more, and the note holding it is
    // pushed to 2880, where the second track has a quarter.
    const shared = scoreOf('n2 n4F n4', 'n4. n4. n4');
    expect(insertBeatAt(shared, ref(0), 4, 0)?.droppedFermatas).toEqual(['otherTracks']);
    expect(shapesOf(shared)).toEqual(['r4 n2 n4 n4', 'n4. n4. n4']);
    expect(shapesOf(saved(shared))).toEqual(shapesOf(shared));

    // Where a beat moves onto the fermata's place, the fermata stays there, on that beat.
    const kept = scoreOf('n4 n4F n4 n4', 'n2 n2');
    expect(insertBeatAt(kept, ref(0), 4, 0)?.droppedFermatas).toEqual([]);
    expect(shapesOf(kept)).toEqual(['r4 n4F n4 n4 n4', 'n2 n2']);
    expect(shapesOf(saved(kept))).toEqual(shapesOf(kept));
  });

  it('words each reason, for one fermata and for several', () => {
    expect(fermataNoticeOf(['otherTracks', 'otherTracks'])).toBe('2 fermatas removed: their notes moved where they would reach other tracks.');
    expect(fermataNoticeOf(['ontoAnotherFermata', 'noNoteThere'])).toBe(
      "1 fermata removed: its note moved onto another fermata's place. 1 fermata removed: no note starts at its place any more."
    );
    expect(fermataNoticeOf(['otherVoices'])).toBe('1 fermata removed: its note moved where it would reach another staff or voice of its track.');
  });

  it('takes the fermata with its note when the beat before it is deleted on a single track', () => {
    const doc = scoreOf('n4 n4F n4 n4');

    deleteBeats(doc, [ref(0)]);

    expect(shapesOf(doc)).toEqual(['n4F n4 n4 r4']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });

  it('keeps a fermata at its position when another track still holds it there', () => {
    const doc = scoreOf('n4 n4F n4 n4', 'n4 n4F n4 n4');

    setBeatDurations(doc, [ref(0)], 2, 0);

    expect(shapesOf(doc)).toEqual(['n2 n4 n4 n4', 'n4 n4F n4 n4']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });

  it('makes tracks loaded disagreeing about a fermata agree once a bar they share is edited', () => {
    // alphaTab hands a fermata only to later tracks, so a file can hold one on the second track and not the first.
    const doc = scoreOf('n4 n4 n4 n4', 'n4 n4F n4 n4');
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));

    setBeatDurations(doc, [ref(3)], 8, 0);

    expect(shapesOf(doc)).toEqual(['n4 n4F n4 n8 r8', 'n4 n4F n4 n4']);
    expect(shapesOf(saved(doc))).toEqual(shapesOf(doc));
  });
});

describe('a fermata when a track is added or removed', () => {
  let service: ComposerService;
  let mapper: ScoreDocMapperService;
  const saved = (doc: ScoreDoc): ScoreDoc => mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings()));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  it('gives a new track every fermata at a position where its rests start, so a save adds none', () => {
    service.replaceDocument(scoreOf('n4 n4F n4 n4'));

    service.addTrack('Guitar', 25, true);

    expect(shapesOf(service.doc)).toEqual(['n4 n4F n4 n4', 'r4 r4F r4 r4']);
    expect(shapesOf(saved(service.doc))).toEqual(shapesOf(service.doc));
  });

  it('takes a fermata only that track held away with the track, and leaves the others as they were', () => {
    // No other track has a beat at 960, so nothing is left holding that fermata, and nothing takes it on save.
    service.replaceDocument(scoreOf('n4 n4F n4 n4', 'n2F n2'));

    service.removeTrack(0);

    expect(shapesOf(service.doc)).toEqual(['n2F n2']);
    expect(shapesOf(saved(service.doc))).toEqual(shapesOf(service.doc));
  });
});
