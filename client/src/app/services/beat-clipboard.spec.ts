import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { CopiedBeats, copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { barMeterAt, fillBarGaps, scoreBarFills } from './bar-fill';
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { writtenBeats } from './written-beats';
import { BeatDoc, FermataDoc, ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

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

  it('refuses a copy that holds part of a tuplet group, and pastes the whole group', () => {
    // One triplet quarter of three. Pasted alone it would start a group alphaTab never closes, and the
    // room it leaves - 320 ticks short of a quarter - is off the 64th grid, so the bar would stay short.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 2, ...[0, 1, 2].map(() => ({ ...createRestBeat(4), tuplet: { numerator: 3, denominator: 2 } })));
    withNote(doc, 0, 0);

    expect(pasteBeats(doc, ref(1, 0), copiedBeatsOf(doc, [ref(0, 0)])!)).toMatch(/part of a tuplet group/i);
    expect(shape(doc, 1)).toEqual(['r4', 'r4', 'r4', 'r4']);
    expect(pasteBeats(doc, ref(1, 0), copiedBeatsOf(doc, [ref(0, 0), ref(0, 1), ref(0, 2)])!)).toEqual({ appendedBars: 0, at: ref(1, 0) });
  });

  it('refuses a paste that would split a tuplet group, and pastes a whole group over a whole group', () => {
    // A quarter pasted over the group's second triplet takes the second and third, leaving the first open.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 4, ...writtenBeats('n8t3 n8t3 n8t3 n4 n2'));
    const group = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1), ref(0, 2)])!;

    expect(pasteBeats(structuredClone(doc), ref(0, 1), { fretted: true, beats: writtenBeats('n4') })).toMatch(/paste would split a tuplet group/i);
    expect(pasteBeats(structuredClone(doc), ref(0, 0), group)).toEqual({ appendedBars: 0, at: ref(0, 0) });
  });

  it('refuses a paste that would carry part of a tuplet group into the next bar', () => {
    // A whole group pasted at the last of twelve triplets puts one in bar 1 and two in bar 2.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 4, ...writtenBeats(Array.from({ length: 12 }, () => 'n8t3').join(' ')));

    expect(pasteBeats(doc, ref(0, 11), { fretted: true, beats: writtenBeats('n8t3 n8t3 n8t3') })).toMatch(/paste would split a tuplet group/i);
  });

  it('refuses a paste at a beat past the bar line of a bar already over, and not one before the line', () => {
    // Bar 1 holds a half and three quarters, 960 over: its last quarter starts at 3840, on the line. A
    // paste there would land in bar 2 while the caret stayed on that quarter.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 1).splice(0, 1, createRestBeat(2));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    expect(pasteBeats(doc, ref(1, 3), copied!)).toMatch(/past the bar line.*Fix bar/i);
    expect(shape(doc, 2)).toEqual(['r4', 'r4', 'r4', 'r4']);
    expect(pasteBeats(doc, ref(1, 2), copied!)).toEqual({ appendedBars: 0, at: ref(1, 2) });
  });

  it('refuses a paste at a grace that ends a full bar, which would land in the next bar while the caret stayed put', () => {
    // The grace starts at 3840, on the line of a bar that is not over, so Fix bar has nothing to do there.
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 4, ...writtenBeats('n1 g'));

    expect(pasteBeats(doc, ref(0, 1), { fretted: true, beats: writtenBeats('n4') })).toMatch(/grace.*full bar.*next bar/i);
    expect(shape(doc, 1)).toEqual(['r4', 'r4', 'r4', 'r4']);
  });
});

describe('pasteBeats, a grace and a fermata', () => {
  // alphaTab files a beat's fermata on the master bar at the tick the beat is finished at, and hands it to
  // every beat finished later at that tick without one (`Voice.finish` ~3294, `MasterBar.getFermata`
  // ~2728). A grace is finished at the tick of the beat it leads into, so a fermata left on a pasted grace
  // reaches every track at that position on save.
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  /** A guitar, a piano and an organ. */
  const threeTracks = (): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks.push(ComposerService.createTrack('Organ', 'org', 16, false, doc.masterBars));
    return doc;
  };
  /** A copy of one before-beat grace on string 2, carrying `fermata`. */
  const graceCopy = (fermata: FermataDoc): CopiedBeats => {
    const grace: BeatDoc = { ...createRestBeat(8), isRest: false };
    grace.notes = [{ pitch: { kind: 'fretted', string: 2, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    grace.effects = { ...grace.effects, grace: 'beforeBeat', fermata };
    return { fretted: true, beats: [grace] };
  };
  const fermatas = (doc: ScoreDoc): (string | null)[][] =>
    doc.tracks.map(track => track.staves[0].bars[0].voices[0].beats.map(beat => beat.effects.fermata?.type ?? null));
  const saved = (doc: ScoreDoc): ScoreDoc => mapper.toDoc(mapper.toScore(doc, new alphaTab.Settings()));

  it('clears a pasted grace\'s fermata where its position has none, so a save puts none on any track', () => {
    const doc = threeTracks();

    pasteBeats(doc, ref(0, 3), graceCopy({ type: 'medium', length: 1 }));

    expect(beats(doc, 0)[3].effects.grace).toBe('beforeBeat');
    expect(fermatas(doc)).toEqual([[null, null, null, null, null], [null, null, null, null], [null, null, null, null]]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('keeps a fermata at its position when a paste pulls the beat holding it earlier', () => {
    // A 64th pasted over a dotted 64th leaves 30 ticks, which no rest spells, so the beats after it move 30
    // ticks earlier. The dotted 64th with the fermata moves off its position on the guitar alone.
    const doc = threeTracks();
    doc.tracks.forEach((track, trackIndex) => {
      const bar = track.staves[0].bars[0];
      const note = (): BeatDoc => ({
        ...createRestBeat(64), dots: 1, isRest: false,
        notes: [{
          pitch: trackIndex === 0 ? { kind: 'fretted', string: 1, fret: 3 } : { kind: 'pitched', noteValue: 0, octave: 4 },
          isTied: false, accidental: 'auto', effects: createDefaultNoteEffects()
        }]
      });
      bar.voices[0].beats = [note(), note()];
      bar.voices[0].beats[1].effects.fermata = { type: 'medium', length: 1 };
      fillBarGaps(bar, barMeterAt(doc, 0));
    });
    const sixtyFourth: BeatDoc = { ...createRestBeat(64), isRest: false };
    sixtyFourth.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];

    pasteBeats(doc, ref(0, 0), { fretted: true, beats: [sixtyFourth] });

    expect(fermatas(doc).map(list => list.indexOf('medium'))).toEqual([-1, 1, 1]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });

  it('gives a pasted grace the fermata at its position, so a save changes nothing', () => {
    const doc = threeTracks();
    for (const track of doc.tracks) track.staves[0].bars[0].voices[0].beats[3].effects.fermata = { type: 'long', length: 1 };

    pasteBeats(doc, ref(0, 3), graceCopy({ type: 'medium', length: 1 }));

    expect(fermatas(doc)).toEqual([[null, null, null, 'long', 'long'], [null, null, null, 'long'], [null, null, null, 'long']]);
    expect(fermatas(saved(doc))).toEqual(fermatas(doc));
  });
});
