import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { moveNotesToString, shiftSemitone } from './note-moves';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number, beatIndex = 0): BeatRef => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

/** A guitar and a piano, with `guitar`'s notes on the guitar's first beat and C4 on the piano's. */
function doc(...guitar: NotePitch[]): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  const note = (pitch: NotePitch): NoteDoc => ({ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });
  const first = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  first.isRest = false;
  first.notes = guitar.map(note);
  const piano = score.tracks[1].staves[0].bars[0].voices[0].beats[0];
  piano.isRest = false;
  piano.notes = [note({ kind: 'pitched', noteValue: 0, octave: 4, letter: 'C' })];
  return score;
}
const notesOf = (score: ScoreDoc, trackIndex: number): NoteDoc[] => score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0].notes;

describe('shiftSemitone', () => {
  it('moves a fret and its trill up a semitone', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });
    notesOf(score, 0)[0].effects.trill = { value: 62, speed: 16 };

    expect(shiftSemitone(score, [ref(0)], null, 1)).toBeNull();

    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 3, fret: 6 });
    expect(notesOf(score, 0)[0].effects.trill).toEqual({ value: 63, speed: 16 });
  });

  it('moves a pitched note across an octave and drops the letter that named the old pitch', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });

    shiftSemitone(score, [ref(1)], null, -1);

    expect(notesOf(score, 1)[0].pitch).toEqual({ kind: 'pitched', noteValue: 11, octave: 3 });
  });

  it('puts a forced accidental that cannot name the new pitch back to auto, and keeps one that can', () => {
    // String 3 (G, 55) at fret 3 is B flat, 58. A semitone up is 59, which a flat still names - C flat.
    // A semitone down is 57, A, which a flat cannot name: its letter would be a black key.
    const up = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(up, 0)[0].accidental = 'flat';
    shiftSemitone(up, [ref(0)], null, 1);
    expect(notesOf(up, 0)[0].accidental).toBe('flat');

    const down = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(down, 0)[0].accidental = 'flat';
    shiftSemitone(down, [ref(0)], null, -1);
    expect(notesOf(down, 0)[0].accidental).toBe('auto');
  });

  it('refuses the whole press when one note would go below fret 0, and moves nothing', () => {
    const score = doc({ kind: 'fretted', string: 1, fret: 0 }, { kind: 'fretted', string: 2, fret: 3 });

    expect(shiftSemitone(score, [ref(0)], null, -1)).toMatch(/fret/i);
    expect(notesOf(score, 0).map(note => note.pitch.kind === 'fretted' && note.pitch.fret)).toEqual([0, 3]);
  });
});

describe('moveNotesToString', () => {
  it('moves a note to the string above, keeping its pitch', () => {
    // String 2 (B, 59) at fret 5 is E, 64: fret 0 on string 1.
    const score = doc({ kind: 'fretted', string: 2, fret: 5 });

    expect(moveNotesToString(score, [ref(0)], null, -1)).toBeNull();

    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
  });

  it('refuses a note that would need a fret below 0, saying which', () => {
    const score = doc({ kind: 'fretted', string: 2, fret: 3 });

    expect(moveNotesToString(score, [ref(0)], null, -1)).toMatch(/fret -2/);
  });

  it('refuses a string that does not exist, and a pitched staff', () => {
    expect(moveNotesToString(doc({ kind: 'fretted', string: 1, fret: 3 }), [ref(0)], null, -1)).toMatch(/no string/i);
    expect(moveNotesToString(doc({ kind: 'fretted', string: 1, fret: 3 }), [ref(1)], null, 1)).toMatch(/pitched/i);
  });

  it('refuses a beat where two notes would share a string, and lets a whole chord move together', () => {
    const chord = (): ScoreDoc => doc({ kind: 'fretted', string: 2, fret: 5 }, { kind: 'fretted', string: 3, fret: 9 });

    expect(moveNotesToString(chord(), [ref(0)], 2, -1)).toMatch(/already/i);
    const score = chord();
    expect(moveNotesToString(score, [ref(0)], null, -1)).toBeNull();
    expect(notesOf(score, 0).map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 0 },
      { kind: 'fretted', string: 2, fret: 5 }
    ]);
  });
});
