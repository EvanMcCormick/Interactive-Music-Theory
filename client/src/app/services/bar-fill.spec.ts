import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { barFillOf, beatTicks, scoreBarFills } from './bar-fill';
import {
  BeatDoc,
  DurationValue,
  Tuplet,
  createDefaultBar,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createRestBeat
} from '../models/composer.model';

function beatOf(duration: DurationValue, dots = 0, tuplet: Tuplet | null = null): BeatDoc {
  return { ...createRestBeat(duration), dots, tuplet };
}

function noteBeatOf(duration: DurationValue, grace: BeatDoc['effects']['grace'] = 'none'): BeatDoc {
  const beat = createRestBeat(duration);
  return {
    ...beat,
    isRest: false,
    notes: [{
      pitch: { kind: 'fretted', string: 1, fret: 3 },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    }],
    effects: { ...beat.effects, grace }
  };
}

describe('beatTicks', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('gives a quarter 960 ticks', () => {
    expect(beatTicks(beatOf(4))).toBe(960);
  });

  it('adds half again for a dot and three quarters again for two', () => {
    expect(beatTicks(beatOf(4, 1))).toBe(1440);
    expect(beatTicks(beatOf(4, 2))).toBe(1680);
  });

  it('scales a triplet eighth to 320', () => {
    expect(beatTicks(beatOf(8, 0, { numerator: 3, denominator: 2 }))).toBe(320);
  });

  it('applies a tuplet only where alphaTab does', () => {
    // alphaTab's guard is `tupletDenominator > 0 && tupletNumerator >= 0`. A numerator of 0
    // passes and divides by zero, which `| 0` turns into 0.
    expect(beatTicks(beatOf(4, 0, { numerator: 3, denominator: 0 }))).toBe(960);
    expect(beatTicks(beatOf(4, 0, { numerator: -1, denominator: 2 }))).toBe(960);
    expect(beatTicks(beatOf(4, 0, { numerator: 0, denominator: 2 }))).toBe(0);
  });

  it('gives a grace beat no room in the bar', () => {
    expect(beatTicks(noteBeatOf(8, 'onBeat'))).toBe(0);
    expect(beatTicks(noteBeatOf(8, 'beforeBeat'))).toBe(0);
  });

  it('agrees with alphaTab\'s layout on every value, dot, tuplet and grace the palette can write', () => {
    // Compared with `displayDuration`, the length alphaTab lays a bar out by. Three samples
    // tell truncation from rounding: a quarter 7:4 is 548.57 (548 truncated, 549 rounded),
    // a dotted quarter 7:4 822.86, a half 9:8 1706.67. Every other tuplet here lands on or
    // below .5 and would pass either way. The graces sit before notes: a before-beat grace
    // shortens the previous beat's playback and an on-beat grace its own beat's, and neither
    // touches any beat's `displayDuration`. The voice has many beats, so the lone-whole-rest
    // rule does not apply to the whole rest.
    const mapper = TestBed.inject(ScoreDocMapperService);
    const beats = [
      beatOf(1), beatOf(2, 1), beatOf(4, 2), beatOf(64),
      beatOf(8, 0, { numerator: 3, denominator: 2 }),
      beatOf(16, 1, { numerator: 5, denominator: 4 }),
      beatOf(16, 0, { numerator: 7, denominator: 4 }),
      beatOf(32, 2, { numerator: 3, denominator: 2 }),
      beatOf(4, 0, { numerator: 7, denominator: 4 }),
      beatOf(4, 1, { numerator: 7, denominator: 4 }),
      beatOf(2, 0, { numerator: 9, denominator: 8 }),
      noteBeatOf(4),
      noteBeatOf(8, 'onBeat'),
      noteBeatOf(4),
      noteBeatOf(8, 'beforeBeat'),
      noteBeatOf(2)
    ];
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = beats;

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const laidOut = score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.displayDuration);

    expect(beats.map(beatTicks)).toEqual(laidOut);
  });
});

describe('barFillOf', () => {
  const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

  it('calls a bar of four quarters full in 4/4', () => {
    expect(barFillOf(createDefaultBar(false, FOUR_FOUR), FOUR_FOUR)).toEqual({ kind: 'full' });
  });

  it('reports a short bar by how much', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 8;

    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'under', ticks: 480 });
  });

  it('reports an overfull bar by how much', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 2;

    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'over', ticks: 960 });
  });

  it('measures 6/8 in its own units', () => {
    const sixEight = { numerator: 6, denominator: 8, isCommon: false };

    expect(barFillOf(createDefaultBar(false, sixEight), sixEight)).toEqual({ kind: 'full' });
  });

  it('calls a bar holding only a whole rest full in any meter, as alphaTab draws it', () => {
    // alphaTab's `isFullBarRest`: a lone whole rest is laid out as the bar's length, and its
    // dots are never read. A lone whole note is not a rest, so it is measured, and is over.
    const threeFour = { numerator: 3, denominator: 4, isCommon: false };
    const bar = createDefaultBar(false, threeFour);

    bar.voices[0].beats = [createRestBeat(1)];
    expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

    bar.voices[0].beats = [{ ...createRestBeat(1), dots: 1 }];
    expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

    bar.voices[0].beats = [noteBeatOf(1)];
    expect(barFillOf(bar, threeFour)).toEqual({ kind: 'over', ticks: 960 });
  });

  it('calls four quarters and an on-beat grace note full in 4/4', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats.splice(2, 0, noteBeatOf(8, 'onBeat'));

    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
  });
});

describe('scoreBarFills', () => {
  it('reads every bar of every staff against the meter in force there', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[2].voices[0].beats[0].duration = 2;

    const fills = scoreBarFills(doc);

    expect(fills[0][0].map(fill => fill.kind)).toEqual(['full', 'full', 'over', 'full']);
  });

  it('calls a free-time bar full whatever it holds', () => {
    // Free time is the score saying the meter does not govern this bar.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isFreeTime = true;
    doc.tracks[0].staves[0].bars[1].voices[0].beats[0].duration = 1;

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });
});
