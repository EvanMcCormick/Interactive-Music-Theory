import { ComposerService } from './composer.service';
import {
  keySignatureFault,
  setClef,
  setKeySignature,
  setTimeSignature,
  timeSignatureFault,
  toggleMasterBarFlag
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
    expect(timeSignatureFault({ numerator: 0, denominator: 4, isCommon: false })).toMatch(/top/i);
    expect(keySignatureFault({ fifths: 8, mode: 'major' })).toMatch(/7/);
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

    setKeySignature(doc, 1, { fifths: 2, mode: 'major' });

    expect(doc.tracks[0].staves[0].bars.map(bar => bar.keySignature.fifths)).toEqual([0, 2, 2, -1]);
  });

  it('sets a clef on one staff only', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    setClef(doc, 1, 0, 0, 'f4', 'regular');

    expect(doc.tracks[1].staves[0].bars.every(bar => bar.clef === 'f4')).toBeTrue();
    expect(doc.tracks[0].staves[0].bars[0].clef).toBe('g2');
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
