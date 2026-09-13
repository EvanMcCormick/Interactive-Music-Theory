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

  it('refuses a capo on a pitched staff, and changes nothing', () => {
    const score = doc();

    expect(setStaffNumber(score, 1, 0, 'capo', 2)).toMatch(/pitched[\s\S]*capo/i);
    expect(score.tracks[1].staves[0].capo).toBe(0);
  });
});

describe('trills follow their notes', () => {
  // A trill's target is a pitch, and a note keeps its fret when its string's pitch moves, so the
  // target moves with the note or the trilled interval silently changes. String 6 is E, 40: the
  // note at fret 3 is 43, trilled to fret 5, 45. String 1 is E, 64: a note at fret 0 trilled to
  // fret 2, 66.
  const trilled = (): ScoreDoc => {
    const score = doc();
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
    beats[0].notes[0].effects.trill = { value: 45, speed: 16 };
    beats[1].isRest = false;
    beats[1].notes = [{
      pitch: { kind: 'fretted', string: 1, fret: 0 },
      isTied: false,
      accidental: 'auto',
      effects: { ...createDefaultNoteEffects(), trill: { value: 66, speed: 32 } }
    }];
    return score;
  };
  const trills = (score: ScoreDoc): (number | undefined)[] =>
    score.tracks[0].staves[0].bars[0].voices[0].beats.slice(0, 2).map(beat => beat.notes[0].effects.trill?.value);

  it('moves each string\'s trills by how far that string was retuned', () => {
    const score = trilled();

    expect(setStaffTuning(score, 0, 0, [64, 59, 55, 50, 45, 38], 'Drop D')).toBeNull();

    expect(trills(score)).toEqual([43, 66]);
  });

  it('moves every trill by the change in capo', () => {
    const score = trilled();

    setStaffNumber(score, 0, 0, 'capo', 2);
    expect(trills(score)).toEqual([47, 68]);

    setStaffNumber(score, 0, 0, 'capo', 1);
    expect(trills(score)).toEqual([46, 67]);
  });

  it('leaves trills alone for a transposition, which does not move alphaTab\'s `trillFret`', () => {
    const score = trilled();

    setStaffNumber(score, 0, 0, 'transpose', 2);
    setStaffNumber(score, 0, 0, 'displayTranspose', -3);

    expect(trills(score)).toEqual([45, 66]);
  });

  it('leaves trills alone when a retune or capo is refused', () => {
    const score = trilled();

    setStaffNumber(score, 0, 0, 'capo', 30);
    setStaffTuning(score, 0, 0, STANDARD_BASS_TUNING, 'Bass');

    expect(trills(score)).toEqual([45, 66]);
  });
});

describe('setStaffViews', () => {
  it('refuses a staff that would show nothing', () => {
    expect(setStaffViews(doc(), 0, 0, { showStandardNotation: false, showTablature: false })).toMatch(/something/i);
  });

  it('refuses tablature on a pitched staff', () => {
    expect(setStaffViews(doc(), 1, 0, { showTablature: true })).toMatch(/pitched/i);
  });

  it('refuses only turning tablature on, not other changes to a pitched staff already showing it', () => {
    // A loaded file can leave a pitched staff with tablature on. That must not lock its other
    // views, or stop the user turning the tablature off.
    const score = doc();
    const piano = score.tracks[1].staves[0];
    piano.showTablature = true;

    expect(setStaffViews(score, 1, 0, { showSlash: true })).toBeNull();
    expect(setStaffViews(score, 1, 0, { showTablature: false })).toBeNull();
    expect(piano.showSlash).toBeTrue();
    expect(piano.showTablature).toBeFalse();
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
