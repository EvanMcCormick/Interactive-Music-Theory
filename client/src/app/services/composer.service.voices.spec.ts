import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerService } from './composer.service';
import { stateOf } from './composer.service.spec-helper';
import { toolStateOf } from './composer-tool-states';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { writtenBeats, writtenOf } from './written-beats.spec-helper';
import { ScoreDoc } from '../models/composer.model';

/**
 * A staff whose bars hold a second voice, which only a loaded file gives it until multiple voices are designed.
 *
 * alphaTab's `Voice._chain` reads `bar.nextBar.voices[this.index]` for the last beat of every voice, unchecked, so a
 * bar with a second voice beside one without throws out of `Score.finish` - and so out of every save and every render.
 * Each new bar a command makes must carry every voice its neighbours do.
 */
describe('ComposerService bars added beside a second voice', () => {
  let service: ComposerService;
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    mapper = TestBed.inject(ScoreDocMapperService);
    // Every bar of the guitar holds two half notes in a second voice.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars.forEach(bar => bar.voices.push({ beats: writtenBeats('n2 n2') }));
    service.replaceDocument(doc);
  });

  const bars = () => service.doc.tracks[0].staves[0].bars;
  /** Each bar's second voice, in `writtenBeats`' shorthand, or null where the bar has none. */
  const secondVoices = (): (string | null)[] => bars().map(bar => (bar.voices[1] ? writtenOf(bar.voices[1].beats) : null));
  const saves = (): void => expect(() => mapper.toScore(service.doc, new alphaTab.Settings())).not.toThrow();

  it('appends a bar whose second voice is a whole-bar rest, so the score still saves', () => {
    service.appendBar();

    expect(secondVoices()).toEqual(['n2 n2', 'n2 n2', 'n2 n2', 'n2 n2', 'r1']);
    saves();
  });

  it('inserts a bar at the start, in the middle and before the selection with every voice', () => {
    service.insertBar(0);
    service.insertBar(3);
    service.setCursor({ barIndex: 1, beatIndex: 0 });
    service.insertBarsBeforeSelection();

    expect(secondVoices()).toEqual(['r1', 'r1', 'n2 n2', 'n2 n2', 'r1', 'n2 n2', 'n2 n2']);
    saves();
  });

  it('gives the bar Fix bar appends every voice', () => {
    bars()[3].voices[0].beats = writtenBeats('n2 n2 n4');
    service.replaceDocument(structuredClone(service.doc));
    service.setCursor({ barIndex: 3, beatIndex: 2 });

    service.fixBar();

    expect(stateOf(service).refusal).toBeNull();
    expect(secondVoices()).toEqual(['n2 n2', 'n2 n2', 'n2 n2', 'n2 n2', 'r1']);
    saves();
  });

  it('gives the bars a paste appends every voice', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
    service.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 5 }, false);
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 3, beatIndex: 3 });

    service.paste();

    expect(stateOf(service).refusal).toBeNull();
    expect(secondVoices()).toEqual(['n2 n2', 'n2 n2', 'n2 n2', 'n2 n2', 'r1']);
    saves();
  });
});

/**
 * A second voice of rests through a save. The mapper draws such a voice as nothing (`isEmpty`, in
 * `score-doc-mapper.ghost-voice.spec.ts`), so the alphaTex exporter writes none of its beats: alphaTab keeps the voice
 * only where a bar of the staff has something in it, and gives each bar whose voice was all rests its own placeholder,
 * one rest. Kept as it is: the voice says nothing, a bar's beat at tick 0 holds that tick's fermata in either shape, and
 * the shape alphaTab reads back saves again unchanged.
 */
describe('A second voice of rests through alphaTex', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
  });

  /** The empty score with bar `i`'s second voice written `written[i]`. */
  const scoreWith = (...written: string[]): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars.forEach((bar, index) => bar.voices.push({ beats: writtenBeats(written[index]) }));
    return doc;
  };
  const saved = (doc: ScoreDoc): ScoreDoc => {
    const parsed = tex.parse(tex.export(mapper.toScore(doc, new alphaTab.Settings())));
    if (!parsed.score) throw new Error('the saved alphaTex did not parse');
    return mapper.toDoc(parsed.score);
  };
  const voicesOf = (doc: ScoreDoc): string[] => doc.tracks[0].staves[0].bars.map(bar => bar.voices.map(voice => writtenOf(voice.beats)).join(' | '));

  it('is not kept when no bar of the staff has a note in it', () => {
    expect(voicesOf(saved(scoreWith('r1', 'r1', 'r1', 'r1')))).toEqual(['r4 r4 r4 r4', 'r4 r4 r4 r4', 'r4 r4 r4 r4', 'r4 r4 r4 r4']);
  });

  it('comes back as one rest in a bar beside bars with notes, which saves again unchanged', () => {
    const once = saved(scoreWith('n2 n2', 'r1', 'r2 r2', 'n2 n2'));

    expect(voicesOf(once)).toEqual(['r4 r4 r4 r4 | n2 n2', 'r4 r4 r4 r4 | r4', 'r4 r4 r4 r4 | r4', 'r4 r4 r4 r4 | n2 n2']);
    expect(voicesOf(saved(once))).toEqual(voicesOf(once));
  });
});

/**
 * A fermata only a loaded bar's second voice holds, at a tick where the first voice has a beat without one. The button
 * reads every beat at the position (`fermataPositionsOf`), so it is mixed; a press turns it on for all of them, since
 * one lacks it, and a second press clears it from all of them, the second voice's included.
 */
describe('ComposerService fermata held by a second voice alone', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars.forEach((bar, index) => {
      bar.voices[0].beats = writtenBeats('n4 n4 n4 n4');
      bar.voices.push({ beats: writtenBeats(index === 0 ? 'n2 n2' : 'r1') });
    });
    doc.tracks[0].staves[0].bars[0].voices[1].beats[1].effects.fermata = { type: 'medium', length: 1 };
    service.replaceDocument(doc);
    // Beat 2 of the first voice plays at 1920, where the second voice's second half holds the fermata.
    service.setCursor({ barIndex: 0, beatIndex: 2 });
  });

  const pressed = () => toolStateOf(service.doc, null, stateOf(service).cursor, 'fermata').pressed;
  const held = (): boolean[] => service.doc.tracks[0].staves[0].bars[0].voices.flatMap(voice => voice.beats.map(beat => beat.effects.fermata !== null));

  it('reads mixed, turns it on for every beat there on the first press, and clears it from all on the second', () => {
    expect(pressed()).toBe('mixed');

    service.toggleFermata();
    expect(stateOf(service).refusal).toBeNull();
    expect(pressed()).toBeTrue();
    expect(held()).toEqual([false, false, true, false, false, true]);

    service.toggleFermata();
    expect(pressed()).toBeFalse();
    expect(held()).toEqual([false, false, false, false, false, false]);
  });
});
