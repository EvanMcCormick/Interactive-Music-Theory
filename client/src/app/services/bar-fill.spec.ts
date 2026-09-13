import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { BarMeter, barCapacityTicks, barFillAt, barFillOf, beatTicks, scoreBarFills } from './bar-fill';
import {
  BeatDoc,
  DurationValue,
  Tuplet,
  createDefaultBar,
  createDefaultBeatEffects,
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

/** A meter to measure a bar against. A function declaration, so every describe can use it. */
function meterOf(numerator: number, denominator: number, isFreeTime = false): BarMeter {
  return { timeSignature: { numerator, denominator, isCommon: false }, isFreeTime };
}

// One describe around the file, so its `beforeEach` covers every spec here and no others: a
// `beforeEach` outside any describe would run before every spec in the whole suite.
describe('bar-fill', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('beatTicks', () => {
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

  describe('barCapacityTicks', () => {
    it('agrees with alphaTab\'s bar length in every meter, truncating where alphaTab does', () => {
      // One master bar per meter, each declaring it, and a default bar on every staff. 3/7,
      // 5/12 and 11/6 have denominators that are no written value, so a seventh's 548.57
      // ticks tells truncation from rounding; 1/128 and 2/1 are the ends of the range.
      const mapper = TestBed.inject(ScoreDocMapperService);
      const meters = [[4, 4], [3, 4], [2, 2], [6, 8], [7, 8], [5, 16], [12, 8], [3, 7], [5, 12], [11, 6], [1, 128], [2, 1]];
      const signatures = meters.map(([numerator, denominator]) => ({ numerator, denominator, isCommon: false }));
      const doc = ComposerService.createEmptyScore();
      doc.masterBars = signatures.map(timeSignature => ({ ...createDefaultMasterBar(), timeSignature }));
      for (const track of doc.tracks) {
        for (const staff of track.staves) {
          staff.bars = signatures.map(timeSignature => createDefaultBar(staff.showTablature, timeSignature));
        }
      }

      const score = mapper.toScore(doc, new alphaTab.Settings());

      expect(signatures.map(barCapacityTicks)).toEqual(score.masterBars.map(masterBar => masterBar.calculateDuration()));
    });
  });

  describe('barFillOf', () => {
    const FOUR_FOUR = meterOf(4, 4);

    it('calls a bar of four quarters full in 4/4', () => {
      expect(barFillOf(createDefaultBar(false, FOUR_FOUR.timeSignature), FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('reports a short bar by how much', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'under', ticks: 480 });
    });

    it('reports an overfull bar by how much', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 2;

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'over', ticks: 960 });
    });

    it('measures 6/8 in its own units', () => {
      const sixEight = meterOf(6, 8);

      expect(barFillOf(createDefaultBar(false, sixEight.timeSignature), sixEight)).toEqual({ kind: 'full' });
    });

    it('calls a bar with no voices under by its whole capacity', () => {
      const threeFour = meterOf(3, 4);
      const bar = { ...createDefaultBar(false, threeFour.timeSignature), voices: [] };

      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'under', ticks: 2880 });
    });

    it('calls a bar holding only a whole rest full in any meter, as alphaTab draws it', () => {
      // alphaTab's `isFullBarRest`: a lone whole rest is laid out as the bar's length, and its
      // dots are never read. A lone whole note is not a rest, so it is measured, and is over.
      const threeFour = meterOf(3, 4);
      const bar = createDefaultBar(false, threeFour.timeSignature);

      bar.voices[0].beats = [createRestBeat(1)];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

      bar.voices[0].beats = [{ ...createRestBeat(1), dots: 1 }];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

      bar.voices[0].beats = [noteBeatOf(1)];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'over', ticks: 960 });
    });

    it('calls four quarters and an on-beat grace note full in 4/4', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats.splice(2, 0, noteBeatOf(8, 'onBeat'));

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('calls a free-time bar full whatever it holds', () => {
      // Free time is the score saying the meter does not govern this bar.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 1;

      expect(barFillOf(bar, meterOf(4, 4, true))).toEqual({ kind: 'full' });
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
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].isFreeTime = true;
      doc.tracks[0].staves[0].bars[1].voices[0].beats[0].duration = 1;

      expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
    });

    it('agrees with alphaTab about which lone whole rests fill their bar', () => {
      // Bar 1 declares 6/8 and holds a whole beat marked as no rest but with no notes, which
      // alphaTab reads as a rest. Bar 2 declares nothing; the mapper resolves it against the
      // bar before (`previousTimeSignature`), so alphaTab measures it as 6/8, 2880 ticks. It
      // holds an on-beat grace whole rest: `Beat.finish` rewrites a lone grace to an eighth
      // and `updateDurations` gives any grace 0, so it fills nothing. Bar 3 declares 2/4 and
      // holds a double-dotted whole rest, laid out as the bar's 1920 ticks, dots unread.
      const mapper = TestBed.inject(ScoreDocMapperService);
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 6, denominator: 8, isCommon: false };
      doc.masterBars[2].timeSignature = { numerator: 2, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [{ ...createRestBeat(1), isRest: false }];
      bars[1].voices[0].beats = [{ ...createRestBeat(1), effects: { ...createDefaultBeatEffects(), grace: 'onBeat' } }];
      bars[2].voices[0].beats = [{ ...createRestBeat(1), dots: 2 }];

      const score = mapper.toScore(doc, new alphaTab.Settings());
      const laidOut = [0, 1, 2].map(index => score.tracks[0].staves[0].bars[index].voices[0].beats[0].displayDuration);

      expect(score.masterBars[1].calculateDuration()).toBe(2880);
      expect(laidOut).toEqual([2880, 0, 1920]);
      expect(scoreBarFills(doc)[0][0].slice(0, 3)).toEqual([
        { kind: 'full' },
        { kind: 'under', ticks: 2880 },
        { kind: 'full' }
      ]);
    });
  });

  describe('barFillAt', () => {
    it('reads one bar against its own meter and free time', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[2].voices[0].beats[0].duration = 2;

      expect(barFillAt(doc, 0, 0, 2)).toEqual({ kind: 'over', ticks: 960 });

      doc.masterBars[2].isFreeTime = true;
      expect(barFillAt(doc, 0, 0, 2)).toEqual({ kind: 'full' });
    });

    it('is undefined where there is no bar', () => {
      const doc = ComposerService.createEmptyScore();

      expect(barFillAt(doc, 0, 0, 9)).toBeUndefined();
      expect(barFillAt(doc, 3, 0, 0)).toBeUndefined();
    });
  });
});
