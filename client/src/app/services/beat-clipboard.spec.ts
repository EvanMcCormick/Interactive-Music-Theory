import { copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { scoreBarFills } from './bar-fill';
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

const ref = (barIndex: number, beatIndex: number, trackIndex = 0): BeatRef =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });
const beats = (doc: ScoreDoc, bar: number) => doc.tracks[0].staves[0].bars[bar].voices[0].beats;
const shape = (doc: ScoreDoc, bar: number): string[] =>
  beats(doc, bar).map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);
const withNote = (doc: ScoreDoc, bar: number, beat: number): void => {
  const target = beats(doc, bar)[beat];
  target.isRest = false;
  target.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
};

describe('copiedBeatsOf', () => {
  it('copies a range bar by bar', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);

    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(copied?.bars.map(bar => bar.length)).toEqual([1, 1]);
    expect(copied?.fretted).toBeTrue();
  });

  it('copies nothing from more than one staff', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(copiedBeatsOf(doc, [ref(0, 0), ref(0, 0, 1)])).toBeNull();
  });
});

describe('pasteBeats', () => {
  it('writes the copied beats from the caret, over what was there', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);
    withNote(doc, 0, 1);
    const copied = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1)]);

    expect(pasteBeats(doc, ref(1, 1), copied!)).toEqual({ appendedBars: 0 });

    expect(shape(doc, 1)).toEqual(['r4', 'n4', 'n4', 'r4']);
  });

  it('fills the spare right after the pasted beats when they end inside a beat', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 1, createRestBeat(8), createRestBeat(8));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 0), copied!);

    expect(shape(doc, 1)).toEqual(['n8', 'r8', 'r4', 'r4', 'r4']);
  });

  it('leaves a bar over when the copied beats are longer than its room', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 2, createRestBeat(2));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 3), copied!);

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'over', ticks: 960 });
  });

  it('pastes across a bar line, and appends bars when it runs off the end', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(pasteBeats(doc, ref(3, 3), copied!)).toEqual({ appendedBars: 1 });

    expect(shape(doc, 3)).toEqual(['r4', 'r4', 'r4', 'n4']);
    expect(shape(doc, 4)[0]).toBe('n4');
    expect(doc.masterBars.length).toBe(5);
  });

  it('refuses fretted beats on a pitched staff', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    expect(pasteBeats(doc, ref(0, 0, 1), copied!)).toMatch(/fretted/i);
  });
});
