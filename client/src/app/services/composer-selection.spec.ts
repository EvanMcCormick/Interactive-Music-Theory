import { ComposerService } from './composer.service';
import { selectedBars, selectionTargets } from './composer-selection';
import { EditCursor } from '../models/composer.model';

describe('selectionTargets', () => {
  const at = (barIndex: number, beatIndex: number, trackIndex = 0): EditCursor => ({
    trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex: 0
  });
  const positions = (refs: { barIndex: number; beatIndex: number; trackIndex: number }[]): string[] =>
    refs.map(ref => `${ref.trackIndex}:${ref.barIndex}.${ref.beatIndex}`);

  it('is the caret alone when there is no anchor', () => {
    const doc = ComposerService.createEmptyScore();

    expect(positions(selectionTargets(doc, null, at(1, 2)))).toEqual(['0:1.2']);
  });

  it('runs from anchor to head in timeline order, whichever was clicked first', () => {
    const doc = ComposerService.createEmptyScore();

    expect(positions(selectionTargets(doc, at(1, 1), at(0, 3)))).toEqual(['0:0.3', '0:1.0', '0:1.1']);
  });

  it('covers whole bars on every track between two tracks', () => {
    // Guitar Pro's multitrack selection: a rectangle of bars, not a ragged run of beats.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    const refs = selectionTargets(doc, at(1, 3, 0), at(2, 0, 1));

    expect(refs.length).toBe(2 * 2 * 4);
    expect(positions(refs).slice(0, 5)).toEqual(['0:1.0', '0:1.1', '0:1.2', '0:1.3', '0:2.0']);
  });

  it('is empty when the head names no beat', () => {
    const doc = ComposerService.createEmptyScore();

    expect(selectionTargets(doc, null, at(9, 0))).toEqual([]);
  });
});

describe('selectedBars', () => {
  it('spans the bars between the two ends, in order', () => {
    const cursor = (barIndex: number): EditCursor =>
      ({ trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex: 0, stringIndex: null });

    expect(selectedBars(cursor(3), cursor(1))).toEqual({ first: 1, last: 3 });
    expect(selectedBars(null, cursor(2))).toEqual({ first: 2, last: 2 });
  });
});
