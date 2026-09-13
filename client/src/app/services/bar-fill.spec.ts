import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { beatTicks } from './bar-fill';
import { BeatDoc, DurationValue, Tuplet, createRestBeat } from '../models/composer.model';

function beatOf(duration: DurationValue, dots = 0, tuplet: Tuplet | null = null): BeatDoc {
  return { ...createRestBeat(duration), dots, tuplet };
}

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

  it('agrees with alphaTab on every value, dot and tuplet the palette can write', () => {
    // The septuplet is the case that matters: 240 * 4 / 7 truncates, and a mirror that
    // rounded instead would call a bar full that alphaTab lays out one tick short.
    TestBed.configureTestingModule({});
    const mapper = TestBed.inject(ScoreDocMapperService);
    const beats = [
      beatOf(1), beatOf(2, 1), beatOf(4, 2), beatOf(64),
      beatOf(8, 0, { numerator: 3, denominator: 2 }),
      beatOf(16, 1, { numerator: 5, denominator: 4 }),
      beatOf(16, 0, { numerator: 7, denominator: 4 }),
      beatOf(32, 2, { numerator: 3, denominator: 2 })
    ];
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = beats;

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const played = score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.playbackDuration);

    expect(beats.map(beatTicks)).toEqual(played);
  });
});
