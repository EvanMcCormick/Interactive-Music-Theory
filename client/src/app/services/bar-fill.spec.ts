import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import {
  BarMeter,
  absorbFollowingRests,
  barCapacityTicks,
  barFillAt,
  barFillOf,
  beatTicks,
  fillBarGaps,
  fixBarOverflow,
  scoreBarFills
} from './bar-fill';
import {
  BarDoc,
  BeatDoc,
  DurationValue,
  NoteDoc,
  ScoreDoc,
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

  describe('fillBarGaps', () => {
    const FOUR_FOUR = meterOf(4, 4);
    const shape = (bar: BarDoc): string[] =>
      bar.voices[0].beats.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);
    const graceRest = (): BeatDoc => ({
      ...createRestBeat(8),
      effects: { ...createDefaultBeatEffects(), grace: 'beforeBeat' }
    });

    it('fills a shortened beat\'s gap at the end of the bar', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r8', 'r4', 'r4', 'r4', 'r8']);
    });

    it('spells a long gap on the beat, not as one odd value', () => {
      // Half a bar of 4/4 is a half rest, at the half-bar, where the ear expects it.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(2)];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r2', 'r2']);
    });

    it('fills 6/8 in dotted quarters', () => {
      const sixEight = meterOf(6, 8);
      const bar = createDefaultBar(false, sixEight.timeSignature);
      bar.voices[0].beats = [{ ...createRestBeat(4), dots: 1 }];

      fillBarGaps(bar, sixEight);

      expect(shape(bar)).toEqual(['r4.', 'r4.']);
    });

    it('leaves a gap it cannot spell exactly, rather than guess', () => {
      // One triplet eighth is 320 ticks, not a whole number of 64ths.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [{ ...createRestBeat(8), tuplet: { numerator: 3, denominator: 2 } }];

      fillBarGaps(bar, FOUR_FOUR);

      expect(bar.voices[0].beats.length).toBe(1);
      expect(barFillOf(bar, FOUR_FOUR).kind).toBe('under');
    });

    it('leaves a full or overfull bar alone', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 2;

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r2', 'r4', 'r4', 'r4']);
    });

    it('leaves a short free-time bar alone, since the meter does not govern it', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      fillBarGaps(bar, meterOf(4, 4, true));

      expect(shape(bar)).toEqual(['r8', 'r4', 'r4', 'r4']);
    });

    it('measures a grace beat as no room', () => {
      // A quarter, a grace and a quarter leave half a bar, spelled from the half-bar.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), graceRest(), createRestBeat(4)];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r4', 'r8', 'r4', 'r2']);
    });

    it('puts the rests in front of a grace that ends the bar, keeping the order it was written in', () => {
      // alphaTab groups a grace only with a beat after it in its own voice, so a grace that ends
      // a bar leads into nothing. The rests go in front of it so it stays where it was written.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), createRestBeat(4), createRestBeat(4), graceRest()];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r4', 'r4', 'r4', 'r4', 'r8']);
      expect(bar.voices[0].beats[4].effects.grace).toBe('beforeBeat');
    });
  });

  describe('absorbFollowingRests', () => {
    const FOUR_FOUR = meterOf(4, 4);
    const note = (): NoteDoc => ({
      pitch: { kind: 'pitched', noteValue: 0, octave: 4 },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    });

    it('removes the rests a lengthened beat now covers', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const [first] = bar.voices[0].beats;
      first.duration = 2;

      const left = absorbFollowingRests(bar.voices[0], first, 960, new Set());

      expect(left).toBe(0);
      expect(bar.voices[0].beats.length).toBe(3);
    });

    it('stops at a note and reports what it could not take', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats[1] = { ...beats[1], isRest: false, notes: [note()] };
      beats[0].duration = 2;

      const left = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set());

      expect(left).toBe(960);
      expect(bar.voices[0].beats.length).toBe(4);
    });

    it('takes a beat with no notes, which alphaTab draws as a rest, even when it is not marked one', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats[1] = { ...beats[1], isRest: false };
      beats[0].duration = 2;

      const left = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set());

      expect(left).toBe(0);
      expect(bar.voices[0].beats.length).toBe(3);
    });

    it('never takes a beat that is itself being changed', () => {
      // Pressing a half on four selected quarters makes four halves, not one.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;

      const left = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set(beats));

      expect(left).toBe(960);
      expect(bar.voices[0].beats.length).toBe(4);
    });

    it('takes a longer rest whole, leaving the difference as a gap to fill', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), createRestBeat(2), createRestBeat(4)];
      bar.voices[0].beats[0].duration = 2;

      const left = absorbFollowingRests(bar.voices[0], bar.voices[0].beats[0], 960, new Set());
      fillBarGaps(bar, FOUR_FOUR);

      expect(left).toBe(0);
      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('stops at a grace beat, even a grace rest, and never takes it', () => {
      // A grace takes no room, so taking one gains nothing, and it belongs to the beat after it.
      // A grace rest is the case that matters: `isRest` alone would let the walk take it.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats.splice(2, 0, { ...createRestBeat(8), effects: { ...createDefaultBeatEffects(), grace: 'beforeBeat' } });
      beats[0].duration = 1;

      const left = absorbFollowingRests(bar.voices[0], beats[0], 2880, new Set());

      expect(left).toBe(1920);
      expect(bar.voices[0].beats.map(beat => beat.effects.grace)).toEqual(['none', 'beforeBeat', 'none', 'none']);
    });
  });

  describe('fixBarOverflow', () => {
    const fretNote = (): NoteDoc => ({
      pitch: { kind: 'fretted', string: 1, fret: 0 },
      isTied: false,
      accidental: 'auto',
      effects: { ...createDefaultNoteEffects(), accent: 'normal' }
    });
    const noteBeat = (duration: DurationValue): BeatDoc => ({
      ...createRestBeat(duration),
      isRest: false,
      notes: [fretNote()]
    });
    const graceBeat = (): BeatDoc => {
      const beat = noteBeat(8);
      return { ...beat, effects: { ...beat.effects, grace: 'beforeBeat' } };
    };
    const shape = (doc: ScoreDoc, bar: number): string[] =>
      doc.tracks[0].staves[0].bars[bar].voices[0].beats.map(beat =>
        `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}${beat.notes[0]?.isTied ? '~' : ''}`);

    it('splits a beat across the bar line and ties the rest into the next bar', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4~', 'r4', 'r4', 'r4']);
    });

    it('gives the tied continuation the pitch and not the attack', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2)];

      fixBarOverflow(doc, 0, 0, 0);

      const tail = doc.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0];
      expect(tail.pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
      expect(tail.effects.accent).toBe('none');
    });

    it('carries whole beats past the line without splitting them', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      fixBarOverflow(doc, 0, 0, 0);

      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4']);
    });

    it('carries on into the next bar when that one has no rests to give', () => {
      const doc = ComposerService.createEmptyScore();
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      fixBarOverflow(doc, 0, 0, 0);

      expect(scoreBarFills(doc)[0][0].map(fill => fill.kind)).toEqual(['full', 'full', 'full', 'full']);
      expect(shape(doc, 2)).toEqual(['n4', 'r4', 'r4', 'r4']);
    });

    it('appends a bar only when the carry runs off the end', () => {
      const doc = ComposerService.createEmptyScore();
      const last = doc.tracks[0].staves[0].bars[3];
      last.voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      const result = fixBarOverflow(doc, 0, 0, 3);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 1 });
      expect(doc.masterBars.length).toBe(5);
      expect(shape(doc, 4)).toEqual(['n4', 'r4', 'r4', 'r4']);
    });

    it('refuses a bar that is not over', () => {
      const doc = ComposerService.createEmptyScore();

      expect(fixBarOverflow(doc, 0, 0, 0).kind).toBe('refused');
    });

    it('refuses a free-time bar however much it holds, since free time is never over', () => {
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].isFreeTime = true;
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/not over/) });
      expect(shape(doc, 0).length).toBe(5);
    });

    it('refuses to split a tuplet across the bar line', () => {
      // Three quarters, a triplet eighth, then a quarter that starts 640 ticks before the
      // line: 640 is not a whole number of 64ths, so no written value can be the head.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [
        noteBeat(4), noteBeat(4), noteBeat(4),
        { ...noteBeat(8), tuplet: { numerator: 3, denominator: 2 } },
        noteBeat(4)
      ];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result.kind).toBe('refused');
    });

    it('carries a grace note with the beat it leads into', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [
        noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(4), graceBeat(), noteBeat(4)
      ];

      fixBarOverflow(doc, 0, 0, 0);

      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n8', 'n4', 'r4', 'r4', 'r4']);
      expect(doc.tracks[0].staves[0].bars[1].voices[0].beats[0].effects.grace).toBe('beforeBeat');
    });

    it('carries a grace that ends the bar behind the tied tail, in the order it was written', () => {
      // The grace follows the half that crosses the line, so it follows the whole half - head
      // and tail. It led into nothing where it was, and leads into a rest now.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2), graceBeat()];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4~', 'n8', 'r4', 'r4', 'r4']);
      expect(doc.tracks[0].staves[0].bars[1].voices[0].beats[1].effects.grace).toBe('beforeBeat');
    });

    it('never takes a rest a grace leads into, and carries on instead', () => {
      // Bar 2 cannot give up its last rest, so it goes over and passes the grace and that rest on.
      const doc = ComposerService.createEmptyScore();
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(4), createRestBeat(4), createRestBeat(4), graceBeat(), createRestBeat(4)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4']);
      expect(shape(doc, 2)).toEqual(['n8', 'r4', 'r4', 'r4', 'r4']);
    });

    it('refuses a bar that is only a whole rest, which fills any meter', () => {
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
      doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1)];

      expect(fixBarOverflow(doc, 0, 0, 1).kind).toBe('refused');
    });

    it('takes a lone whole rest as room when the bar is over with it, and fills behind what it carried', () => {
      // Once the carried quarter joins it the whole rest is no longer alone, so it is measured
      // at 3840: 4800 in a 3/4 bar of 2880 is over, so it is taken, the bar is one quarter,
      // and the gap fills from beat 2.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(1)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r2']);
    });

    it('keeps a whole rest the carry leaves the bar exactly full with', () => {
      // In 5/4 the carried quarter and the whole rest, measured at 3840 now it is not alone,
      // are 4800 ticks: the bar's capacity. Rests are taken only while a bar is over, so the
      // whole rest stays.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].timeSignature = { numerator: 5, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(1)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r1']);
      expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
    });
  });
});
