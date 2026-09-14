import { ComposerService } from './composer.service';
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { EditCursor, ScoreDoc, createRestBeat } from '../models/composer.model';

const at = (barIndex: number, beatIndex: number, extra: Partial<EditCursor> = {}): EditCursor => ({
  trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex: 0, ...extra
});
const where = (cursor: EditCursor): string => `${cursor.trackIndex}:${cursor.barIndex}.${cursor.beatIndex}`;
const moved = (doc: ScoreDoc, cursor: EditCursor, move: CursorMove): string => where(movedCursor(doc, cursor, move));

describe('clampedCursor', () => {
  it('pulls every index back inside the document', () => {
    const doc = ComposerService.createEmptyScore();

    expect(clampedCursor(at(9, 9, { trackIndex: 3, stringIndex: 8 }), doc)).toEqual(at(3, 3, { stringIndex: 5 }));
  });

  it('gives a pitched staff no string', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(clampedCursor(at(0, 0, { trackIndex: 1, stringIndex: 2 }), doc).stringIndex).toBeNull();
  });
});

describe('movedCursor', () => {
  it('steps a beat, wrapping across bar lines both ways and stopping at the ends', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(0, 3), { kind: 'beat', delta: 1 })).toBe('0:1.0');
    expect(moved(doc, at(1, 0), { kind: 'beat', delta: -1 })).toBe('0:0.3');
    expect(moved(doc, at(0, 0), { kind: 'beat', delta: -1 })).toBe('0:0.0');
    expect(moved(doc, at(3, 3), { kind: 'beat', delta: 1 })).toBe('0:3.3');
  });

  it('wraps by each bar\'s own beat count', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [createRestBeat(2), createRestBeat(2)];

    expect(moved(doc, at(1, 0), { kind: 'beat', delta: -1 })).toBe('0:0.1');
  });

  it('changes string on a fretted staff and not on a pitched one', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(movedCursor(doc, at(0, 0, { stringIndex: 5 }), { kind: 'string', delta: 1 }).stringIndex).toBe(5);
    expect(movedCursor(doc, at(0, 0, { stringIndex: 2 }), { kind: 'string', delta: -1 }).stringIndex).toBe(1);
    const piano = at(0, 0, { trackIndex: 1, stringIndex: null });
    expect(movedCursor(doc, piano, { kind: 'string', delta: 1 })).toEqual(piano);
  });

  it('goes to the first and last beat of the bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(2, 2), { kind: 'barEdge', edge: 'first' })).toBe('0:2.0');
    expect(moved(doc, at(2, 1), { kind: 'barEdge', edge: 'last' })).toBe('0:2.3');
  });

  it('goes to the first beat of the previous or next bar, and stops at the ends', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(1, 2), { kind: 'bar', delta: 1 })).toBe('0:2.0');
    expect(moved(doc, at(1, 2), { kind: 'bar', delta: -1 })).toBe('0:0.0');
    expect(moved(doc, at(3, 2), { kind: 'bar', delta: 1 })).toBe('0:3.0');
  });

  it('goes to the first beat of the score and the last', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(2, 2), { kind: 'scoreEdge', edge: 'first' })).toBe('0:0.0');
    expect(moved(doc, at(1, 1), { kind: 'scoreEdge', edge: 'last' })).toBe('0:3.3');
  });

  it('goes to the same bar on the next or previous track, and stops at the ends', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(moved(doc, at(2, 3), { kind: 'track', delta: 1 })).toBe('1:2.0');
    expect(moved(doc, at(2, 3, { trackIndex: 1 }), { kind: 'track', delta: 1 })).toBe('1:2.0');
    expect(moved(doc, at(2, 3, { trackIndex: 1 }), { kind: 'track', delta: -1 })).toBe('0:2.0');
  });
});
