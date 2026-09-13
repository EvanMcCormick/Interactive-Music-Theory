import { ComposerService } from './composer.service';
import { renameTrack, setPlayback, setStaffNumber, setStaffTuning, setStaffViews } from './track-edits';
import { STANDARD_BASS_TUNING, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/** A guitar score with a note on string 6 in bar 1, and a piano track. */
function doc(): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  beat.isRest = false;
  beat.notes = [{ pitch: { kind: 'fretted', string: 6, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  return score;
}

describe('setStaffTuning', () => {
  it('refuses to strand notes, and changes nothing', () => {
    const score = doc();

    expect(setStaffTuning(score, 0, 0, STANDARD_BASS_TUNING, 'Bass')).toMatch(/string/i);
    expect(score.tracks[0].staves[0].tuning.length).toBe(6);
  });

  it('retunes when every note fits, keeping frets', () => {
    const score = doc();
    const dropD = [64, 59, 55, 50, 45, 38];

    expect(setStaffTuning(score, 0, 0, dropD, 'Drop D')).toBeNull();
    expect(score.tracks[0].staves[0].tuning).toEqual(dropD);
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 6, fret: 3 });
  });

  it('refuses to tune a pitched staff', () => {
    expect(setStaffTuning(doc(), 1, 0, STANDARD_BASS_TUNING, 'Bass')).toMatch(/pitched/i);
  });
});

describe('setStaffNumber', () => {
  it('sets a capo within the neck and refuses one past it', () => {
    const score = doc();

    expect(setStaffNumber(score, 0, 0, 'capo', 2)).toBeNull();
    expect(setStaffNumber(score, 0, 0, 'capo', 30)).toMatch(/capo/i);
    expect(score.tracks[0].staves[0].capo).toBe(2);
  });
});

describe('setStaffViews', () => {
  it('refuses a staff that would show nothing', () => {
    expect(setStaffViews(doc(), 0, 0, { showStandardNotation: false, showTablature: false })).toMatch(/something/i);
  });

  it('refuses tablature on a pitched staff', () => {
    expect(setStaffViews(doc(), 1, 0, { showTablature: true })).toMatch(/pitched/i);
  });
});

describe('setPlayback and renameTrack', () => {
  it('mutes, and refuses a volume off the scale', () => {
    const score = doc();

    expect(setPlayback(score, 0, { isMute: true })).toBeNull();
    expect(setPlayback(score, 0, { volume: 20 })).toMatch(/16/);
    expect(score.tracks[0].playback).toEqual(jasmine.objectContaining({ isMute: true, volume: 15 }));
  });

  it('refuses a blank name', () => {
    expect(renameTrack(doc(), 0, '   ', '')).toMatch(/name/i);
  });
});
