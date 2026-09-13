import { ComposerService } from './composer.service';
import { selectedBars, selectionTargets } from './composer-selection';
import { DurationValue, EditCursor, createRestBeat } from '../models/composer.model';

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

  it('orders ends in two voices by time, and takes the head voice\'s beats that start within the span', () => {
    // Voice 1 is four quarters, starting 0, 960, 1920, 2880. Voice 2 is four eighths and a
    // half, starting 0, 480, 960, 1440, 1920. Beat indices in the two voices do not line up in
    // time, so the ends are ordered by where each starts in its own voice.
    const doc = ComposerService.createEmptyScore();
    const bar = doc.tracks[0].staves[0].bars[0];
    bar.voices.push({ beats: [8, 8, 8, 8, 2].map(duration => createRestBeat(duration as DurationValue)) });
    const inVoice = (voiceIndex: number, beatIndex: number): EditCursor => ({ ...at(0, beatIndex), voiceIndex });

    // The anchor is voice 1's second quarter, at 960; the head is voice 2's second eighth, at 480.
    // By index the anchor would come first and the range would be the head alone. By time the
    // head comes first, and voice 2's beats starting from 480 to 960 are its second and third.
    const earlier = selectionTargets(doc, inVoice(0, 1), inVoice(1, 1));
    expect(positions(earlier)).toEqual(['0:0.1', '0:0.2']);
    expect(earlier.every(ref => ref.voiceIndex === 1)).toBeTrue();

    // The anchor is voice 1's last quarter, at 2880; the head is voice 2's third eighth, at 960.
    // By index the range would stop at voice 2's beat 3; by time it runs on to the half at 1920.
    expect(positions(selectionTargets(doc, inVoice(0, 3), inVoice(1, 2)))).toEqual(['0:0.2', '0:0.3', '0:0.4']);
  });

  it('keeps a multitrack rectangle on the first voice', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[0].staves[0].bars[0].voices.push({ beats: [createRestBeat(2), createRestBeat(2)] });

    const refs = selectionTargets(doc, { ...at(0, 0, 0), voiceIndex: 1 }, at(0, 0, 1));

    expect(refs.every(ref => ref.voiceIndex === 0)).toBeTrue();
    expect(refs.length).toBe(2 * 4);
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
