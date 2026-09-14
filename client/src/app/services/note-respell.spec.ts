import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { respellNotes, respellRefusal, respellingsOf } from './note-respell';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number): BeatRef => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });

/** A guitar and a piano, with one note on each track's first beat. */
function doc(guitar: NotePitch, piano: NotePitch): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  [guitar, piano].forEach((pitch, trackIndex) => {
    const beat = score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0];
    beat.isRest = false;
    beat.notes = [{ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  });
  return score;
}
const noteOf = (score: ScoreDoc, trackIndex: number): NoteDoc => score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0].notes[0];
/** String 2 (B, 59) at fret 2 is C sharp; at fret 1, C. */
const C_SHARP_FRET: NotePitch = { kind: 'fretted', string: 2, fret: 2 };
const C_FRET: NotePitch = { kind: 'fretted', string: 2, fret: 1 };
const C_SHARP: NotePitch = { kind: 'pitched', noteValue: 1, octave: 4 };

describe('respellingsOf', () => {
  it('offers a black key\'s sharp and flat on a fretted staff, and a white key nothing', () => {
    expect(respellingsOf(1, true)).toEqual(['sharp', 'flat']);
    expect(respellingsOf(0, true)).toEqual([]);
  });

  it('offers every spelling that names the pitch on a pitched staff', () => {
    // C sharp: B double sharp, C sharp, D flat. C: B sharp, C, D double flat.
    expect(respellingsOf(1, false)).toEqual(['doubleSharp', 'sharp', 'flat']);
    expect(respellingsOf(0, false)).toEqual(['sharp', 'auto', 'doubleFlat']);
  });
});

describe('respellNotes', () => {
  it('turns a fretted C sharp spelled from C major into D flat, and back', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);

    respellNotes(score, [ref(0)], null);
    expect(noteOf(score, 0).accidental).toBe('flat');

    respellNotes(score, [ref(0)], null);
    expect(noteOf(score, 0).accidental).toBe('sharp');
  });

  it('starts from the flat a flat key draws', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    score.tracks[0].staves[0].bars[0].keySignature = { fifths: -2, mode: 'major' };

    respellNotes(score, [ref(0)], null);

    expect(noteOf(score, 0).accidental).toBe('sharp');
  });

  it('cycles a pitched C sharp\'s letter through D flat, B double sharp and C sharp', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    const letters: (string | undefined)[] = [];

    for (let press = 0; press < 3; press++) {
      respellNotes(score, [ref(1)], null);
      const note = noteOf(score, 1);
      letters.push(note.pitch.kind === 'pitched' ? `${note.pitch.letter}:${note.accidental}` : undefined);
    }

    expect(letters).toEqual(['D:flat', 'B:doubleSharp', 'C:sharp']);
  });

  it('sets the accidental and drops the letter on a transposed staff, where a letter names the stored pitch', () => {
    // Stored C sharp, transposed by 2, is drawn as B. Its spellings are A double sharp, B and C flat,
    // and the next after B is C flat. A letter is read against the stored pitch by the mapper, so a
    // letter chosen from the drawn one would be wrong; `setAccidental` drops it, and so does this.
    const score = doc(C_SHARP_FRET, C_SHARP);
    score.tracks[1].staves[0].transpose = 2;

    respellNotes(score, [ref(1)], null);

    expect(noteOf(score, 1).pitch).toEqual({ kind: 'pitched', noteValue: 1, octave: 4 });
    expect(noteOf(score, 1).accidental).toBe('flat');
  });

  it('reads a written letter as the current spelling', () => {
    const score = doc(C_SHARP_FRET, { ...C_SHARP, letter: 'D' });

    respellNotes(score, [ref(1)], null);

    const pitch = noteOf(score, 1).pitch;
    expect(pitch.kind === 'pitched' ? pitch.letter : null).toBe('B');
  });
});

describe('respellRefusal', () => {
  it('refuses a fretted white key, saying why', () => {
    expect(respellRefusal(doc(C_FRET, C_SHARP), [ref(0)], null)).toMatch(/black key/i);
  });

  it('refuses a fretted natural harmonic', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    noteOf(score, 0).effects.harmonic = 'natural';

    expect(respellRefusal(score, [ref(0)], null)).toMatch(/harmonic/i);
  });

  it('allows a range with something to respell, and refuses a rest', () => {
    const score = doc(C_FRET, C_SHARP);

    expect(respellRefusal(score, [ref(0), ref(1)], null)).toBeNull();
    expect(respellRefusal(score, [{ ...ref(0), beatIndex: 1 }], null)).toMatch(/note/i);
  });
});
