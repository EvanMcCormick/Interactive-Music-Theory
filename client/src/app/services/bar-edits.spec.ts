import { ComposerService } from './composer.service';
import {
  keySignatureFault,
  setClef,
  setKeySignature,
  setTimeSignature,
  timeSignatureFault,
  toggleMasterBarFlag,
  deleteBars,
  insertBarsBefore,
  toggleRepeatClose
} from './bar-edits';
import { scoreBarFills } from './bar-fill';
import { createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

const THREE_FOUR = { numerator: 3, denominator: 4, isCommon: false };
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

describe('timeSignatureFault and keySignatureFault', () => {
  it('accepts what a score can have', () => {
    expect(timeSignatureFault({ numerator: 7, denominator: 8, isCommon: false })).toBeNull();
    expect(keySignatureFault({ fifths: -7, mode: 'minor' })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(timeSignatureFault({ numerator: 5, denominator: 6, isCommon: false })).toMatch(/denominator/i);
    expect(timeSignatureFault({ numerator: 0, denominator: 4, isCommon: false })).toMatch(/top[\s\S]*numerator/i);
    expect(keySignatureFault({ fifths: 8, mode: 'major' })).toMatch(/7/);
  });

  it('draws a C only for 4/4 and 2/2, and refuses common time on any other meter', () => {
    expect(timeSignatureFault({ numerator: 4, denominator: 4, isCommon: true })).toBeNull();
    expect(timeSignatureFault({ numerator: 2, denominator: 2, isCommon: true })).toBeNull();
    expect(timeSignatureFault({ numerator: 3, denominator: 4, isCommon: true })).toBe('Common time is drawn only for 4/4, and cut time only for 2/2.');
  });
});

describe('setTimeSignature', () => {
  it('declares at the bar and fits every bar up to the next declaration', () => {
    const doc = ComposerService.createEmptyScore();

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.masterBars.map(bar => bar.timeSignature?.numerator ?? null)).toEqual([4, 3, null, null]);
    expect(scoreBarFills(doc)[0][0].every(fill => fill.kind === 'full')).toBeTrue();
  });

  it('declares nothing when the meter is already in force', () => {
    const doc = ComposerService.createEmptyScore();

    setTimeSignature(doc, 2, FOUR_FOUR);

    expect(doc.masterBars[2].timeSignature).toBeNull();
  });

  it('declares 4/4 under common time, since C is drawn as a meter of its own', () => {
    // Bar 1 of an empty score is C. The same four quarters drawn as 4/4 are a change a reader sees.
    const doc = ComposerService.createEmptyScore();
    const plain = { numerator: 4, denominator: 4, isCommon: false };

    setTimeSignature(doc, 2, plain);

    expect(doc.masterBars[2].timeSignature).toEqual(plain);
  });

  it('keeps a later common-time declaration when 4/4 is declared before it', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[3].timeSignature = FOUR_FOUR;
    const plain = { numerator: 4, denominator: 4, isCommon: false };

    setTimeSignature(doc, 1, plain);

    expect(doc.masterBars.map(bar => bar.timeSignature?.isCommon ?? null)).toEqual([true, false, null, true]);
  });

  it('drops a later declaration the change now repeats', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[3].timeSignature = THREE_FOUR;

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.masterBars[3].timeSignature).toBeNull();
  });

  it('leaves notes that no longer fit as overflow', () => {
    const doc = ComposerService.createEmptyScore();
    const last = doc.tracks[0].staves[0].bars[1].voices[0].beats[3];
    last.isRest = false;
    last.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'over', ticks: 960 });
  });

  it('leaves a bar that is only a whole rest as it is, since that fills any meter', () => {
    // Measured by written value the rest would be 960 over in 3/4, taken, and refilled as a
    // dotted half. alphaTab draws it as a full-bar rest, so nothing needs to change.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1)];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([1]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });

  it('keeps a whole rest that fills the bar once the rests after it are gone', () => {
    // 5/4's whole rest and quarter rest are 4800 ticks, over 3/4's 2880. Taking the quarter
    // leaves the whole rest alone, which fills any meter, so the fit stops there.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].timeSignature = { numerator: 5, denominator: 4, isCommon: false };
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1), createRestBeat(4)];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([1]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });

  it('leaves a free-time bar as it is, and fits the bars after it', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isFreeTime = true;

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars.map(bar => bar.voices[0].beats.length)).toEqual([4, 4, 3, 3]);
  });
});

describe('setKeySignature and setClef', () => {
  it('runs forward until the bars carry a different key', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[3].keySignature = { fifths: -1, mode: 'major' };

    setKeySignature(doc, { first: 1, last: 1 }, { fifths: 2, mode: 'major' });

    expect(doc.tracks[0].staves[0].bars.map(bar => bar.keySignature.fifths)).toEqual([0, 2, 2, -1]);
  });

  it('sets a clef on one staff only', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    setClef(doc, 1, 0, { first: 0, last: 0 }, 'f4', 'regular');

    expect(doc.tracks[1].staves[0].bars.every(bar => bar.clef === 'f4')).toBeTrue();
    expect(doc.tracks[0].staves[0].bars[0].clef).toBe('g2');
  });

  it('runs a clef forward from one bar until the bars carry a different clef or ottava', () => {
    const doc = ComposerService.createEmptyScore();
    const bars = doc.tracks[0].staves[0].bars;
    bars[3].clefOttava = '8va';

    setClef(doc, 0, 0, { first: 1, last: 1 }, 'f4', 'regular');

    expect(bars.map(bar => bar.clef)).toEqual(['g2', 'f4', 'f4', 'g2']);
  });

  it('writes a key over the whole of a range, on every staff, when a key change falls inside it', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    for (const track of doc.tracks) {
      for (const index of [2, 3]) track.staves[0].bars[index].keySignature = { fifths: -1, mode: 'major' };
    }

    setKeySignature(doc, { first: 1, last: 2 }, { fifths: 2, mode: 'major' });

    for (const track of doc.tracks) {
      expect(track.staves[0].bars.map(bar => bar.keySignature.fifths)).withContext(track.name).toEqual([0, 2, 2, -1]);
    }
  });

  it('writes a changed ottava over the whole of a range whose clefs are mixed, each bar keeping its own clef', () => {
    const doc = ComposerService.createEmptyScore();
    const bars = doc.tracks[0].staves[0].bars;
    bars[2].clef = 'f4';
    bars[3].clef = 'f4';

    setClef(doc, 0, 0, { first: 1, last: 2 }, null, '8va');

    expect(bars.map(bar => `${bar.clef}/${bar.clefOttava}`)).toEqual(['g2/regular', 'g2/8va', 'f4/8va', 'f4/regular']);
  });
});

describe('toggleMasterBarFlag', () => {
  it('follows the toggle rule across the bars', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isDoubleBar = true;

    toggleMasterBarFlag(doc, { first: 0, last: 1 }, 'isDoubleBar');

    expect(doc.masterBars.slice(0, 2).map(bar => bar.isDoubleBar)).toEqual([true, true]);
  });

  it('fits a bar taken out of free time to its meter, on every staff', () => {
    // Bar 2 is a lone quarter rest in free time on both tracks, full while free. Out of free
    // time it is 4/4's, 2880 ticks short from beat 2: the gap fills to the half-bar with a
    // quarter rest, then a half rest, so the bar is a quarter, a quarter and a half, and full.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.masterBars[1].isFreeTime = true;
    for (const track of doc.tracks) {
      for (const staff of track.staves) staff.bars[1].voices[0].beats = [createRestBeat(4)];
    }

    toggleMasterBarFlag(doc, { first: 1, last: 1 }, 'isFreeTime');

    expect(doc.masterBars[1].isFreeTime).toBeFalse();
    for (const track of doc.tracks) {
      for (const staff of track.staves) {
        expect(staff.bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([4, 4, 2]);
      }
    }
    expect(scoreBarFills(doc).every(track => track.every(staff => staff[1].kind === 'full'))).toBeTrue();
  });

  it('leaves a bar put into free time as it was', () => {
    // A lone quarter rest is 2880 ticks short in 4/4. Free time changes nothing in the bar:
    // it only stops the meter governing it, so the bar reads full holding the same quarter.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(4)];

    toggleMasterBarFlag(doc, { first: 1, last: 1 }, 'isFreeTime');

    expect(doc.masterBars[1].isFreeTime).toBeTrue();
    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([4]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });
});

describe('toggleRepeatClose, insertBarsBefore and deleteBars', () => {
  const threeFour = THREE_FOUR;

  it('closes a repeat played twice, and opens it again when every bar closes one', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].repeatCount = 3;

    toggleRepeatClose(doc, { first: 0, last: 1 });
    expect(doc.masterBars.slice(0, 2).map(bar => bar.repeatCount)).toEqual([2, 3]);

    toggleRepeatClose(doc, { first: 0, last: 1 });
    expect(doc.masterBars.slice(0, 2).map(bar => bar.repeatCount)).toEqual([0, 0]);
  });

  it('inserts bars in front of a bar, on every staff', () => {
    const doc = ComposerService.createEmptyScore();

    insertBarsBefore(doc, 1, 2);

    expect(doc.masterBars.length).toBe(6);
    expect(doc.tracks[0].staves[0].bars.length).toBe(6);
  });

  it('refuses to delete every bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(deleteBars(doc, { first: 0, last: 3 })).toMatch(/at least one bar/i);
    expect(doc.masterBars.length).toBe(4);
  });

  it('keeps the meter the deleted first bar declared', () => {
    const doc = ComposerService.createEmptyScore();
    setTimeSignature(doc, 0, threeFour);

    expect(deleteBars(doc, { first: 0, last: 0 })).toBeNull();

    expect(doc.masterBars.length).toBe(3);
    expect(doc.masterBars[0].timeSignature).toEqual(threeFour);
  });

  it('moves a later declaration to the bar that follows the deleted ones, and drops one that repeats', () => {
    const doc = ComposerService.createEmptyScore();
    setTimeSignature(doc, 2, threeFour);

    deleteBars(doc, { first: 1, last: 2 });
    expect(doc.masterBars[1].timeSignature).toEqual(threeFour);

    // Bar 3 repeats bar 1's 3/4 - a shape a loaded file can have. With bar 2 gone it follows bar 1
    // directly, so its declaration repeats the meter in force and is dropped.
    const same = ComposerService.createEmptyScore();
    setTimeSignature(same, 1, threeFour);
    same.masterBars[3].timeSignature = { ...threeFour };
    deleteBars(same, { first: 2, last: 2 });
    expect(same.masterBars.map(bar => bar.timeSignature?.numerator ?? null)).toEqual([4, 3, null]);
  });
});
