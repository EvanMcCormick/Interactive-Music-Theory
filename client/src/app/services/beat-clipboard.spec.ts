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
  it('copies a range across a bar line as one run of beats, in order', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);

    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(copied?.beats.map(beat => beat.isRest)).toEqual([false, false]);
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

    expect(pasteBeats(doc, ref(1, 1), copied!)).toEqual({ appendedBars: 0, at: ref(1, 1) });

    expect(shape(doc, 1)).toEqual(['r4', 'n4', 'n4', 'r4']);
  });

  it('lays a run copied across a bar line down as one run, so its beats stay adjacent', () => {
    // Bar 0's last beat and bar 1's first are a quarter apart. Pasted at bar 3's first beat they are
    // still a quarter apart, in bar 3 - not a bar apart, as a paste bar by bar would put them.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(pasteBeats(doc, ref(3, 0), copied!)).toEqual({ appendedBars: 0, at: ref(3, 0) });

    expect(shape(doc, 3)).toEqual(['n4', 'n4', 'r4', 'r4']);
    expect(doc.masterBars.length).toBe(4);
  });

  it('splits a beat that crosses a bar line as Fix bar does, tying its tail into the next bar', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 2, createRestBeat(2));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    expect(pasteBeats(doc, ref(2, 3), copied!)).toEqual({ appendedBars: 0, at: ref(2, 3) });

    expect(shape(doc, 2)).toEqual(['r4', 'r4', 'r4', 'n4']);
    expect(shape(doc, 3)).toEqual(['n4', 'r4', 'r4', 'r4']);
    expect(beats(doc, 3)[0].notes[0].isTied).toBeTrue();
  });

  it('refuses a tuplet that would cross the bar line, as Fix bar does', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 4, ...[0, 1, 2].map(() => ({ ...createRestBeat(4), tuplet: { numerator: 3, denominator: 2 } })), createRestBeat(2));
    const copied = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1), ref(0, 2)]);

    expect(pasteBeats(doc, ref(1, 3), copied!)).toMatch(/tuplet/i);
  });

  it('puts a pasted fermata on every track at its position, and gives a pasted beat the fermata already there', () => {
    // Decision 2: a fermata belongs to a bar position, not to one staff's beat.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    withNote(doc, 0, 0);
    withNote(doc, 0, 1);
    beats(doc, 0)[0].effects.fermata = { type: 'medium', length: 1 };
    doc.tracks[1].staves[0].bars[2].voices[0].beats[2].effects.fermata = { type: 'long', length: 1 };
    const copied = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1)]);

    pasteBeats(doc, ref(2, 1), copied!);

    const piano = doc.tracks[1].staves[0].bars[2].voices[0].beats;
    expect(piano[1].effects.fermata).toEqual({ type: 'medium', length: 1 });
    expect(beats(doc, 2)[2].effects.fermata).toEqual({ type: 'long', length: 1 });
  });

  it('fills the spare right after the pasted beats when they end inside a beat', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 1, createRestBeat(8), createRestBeat(8));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 0), copied!);

    expect(shape(doc, 1)).toEqual(['n8', 'r8', 'r4', 'r4', 'r4']);
  });

  it('leaves a bar that was already over still over, rather than push its overflow on', () => {
    // Bar 1 holds a half and three quarters, 960 over. A quarter pasted on the half covers it with 960
    // to spare, which goes back as a rest: the bar is as over as it was, for Fix bar.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 1).splice(0, 1, createRestBeat(2));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 0), copied!);

    expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'over', ticks: 960 });
  });

  it('pastes across a bar line, and appends bars when it runs off the end', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(pasteBeats(doc, ref(3, 3), copied!)).toEqual({ appendedBars: 1, at: ref(3, 3) });

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
