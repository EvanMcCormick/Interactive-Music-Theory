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
/** Adds a note on the guitar's beat `beatIndex` in bar 0, and returns it. */
function put(score: ScoreDoc, beatIndex: number, pitch: NotePitch): NoteDoc {
  const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[beatIndex];
  const note: NoteDoc = { pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };
  beat.isRest = false;
  beat.notes.push(note);
  return note;
}

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

  it('keeps a forced accidental only where respell would offer it for the new pitch', () => {
    // String 3 (G, 55) at fret 3 is B flat, 58. A semitone up is 59, B: a flat would spell it C flat,
    // which respell never offers on a fretted staff and so could not undo - it goes back to auto. A
    // semitone down is 57, A, which a flat cannot name at all.
    const up = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(up, 0)[0].accidental = 'flat';
    shiftSemitone(up, [ref(0)], null, 1);
    expect(notesOf(up, 0)[0].accidental).toBe('auto');

    const down = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(down, 0)[0].accidental = 'flat';
    shiftSemitone(down, [ref(0)], null, -1);
    expect(notesOf(down, 0)[0].accidental).toBe('auto');

    // Fret 2 is A, 57, forced sharp; a semitone up is 58, a black key, whose sharp respell offers.
    const black = doc({ kind: 'fretted', string: 3, fret: 2 });
    notesOf(black, 0)[0].accidental = 'sharp';
    shiftSemitone(black, [ref(0)], null, 1);
    expect(notesOf(black, 0)[0].accidental).toBe('sharp');
  });

  it('keeps a pitched note\'s forced accidental only on a black key', () => {
    // C sharp 4 forced sharp, moved up to D: a white key, so auto. C 4 forced sharp - written B sharp -
    // moved up to C sharp: a black key whose sharp spelling exists, so kept.
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });
    const piano = notesOf(score, 1)[0];
    piano.pitch = { kind: 'pitched', noteValue: 1, octave: 4 };
    piano.accidental = 'sharp';
    shiftSemitone(score, [ref(1)], null, 1);
    expect(piano.accidental).toBe('auto');

    piano.pitch = { kind: 'pitched', noteValue: 0, octave: 4 };
    piano.accidental = 'sharp';
    shiftSemitone(score, [ref(1)], null, 1);
    expect(piano.accidental).toBe('sharp');
  });

  it('refuses the whole press when one note would go below fret 0, and moves nothing', () => {
    const score = doc({ kind: 'fretted', string: 1, fret: 0 }, { kind: 'fretted', string: 2, fret: 3 });

    expect(shiftSemitone(score, [ref(0)], null, -1)).toMatch(/fret/i);
    expect(notesOf(score, 0).map(note => note.pitch.kind === 'fretted' && note.pitch.fret)).toEqual([0, 3]);
  });

  it('refuses a semitone up past the last fret in front of the capo, saying so', () => {
    const score = doc({ kind: 'fretted', string: 1, fret: 19 });
    score.tracks[0].staves[0].capo = 5;

    expect(shiftSemitone(score, [ref(0)], null, 1)).toBe(
      'With the capo at 5, a fret runs from 0 to 19, so a note in the selection cannot move up a semitone.'
    );
    expect(shiftSemitone(score, [ref(0)], null, -1)).toBeNull();
  });

  it('lets a loaded fret past the fretboard move back toward it, and refuses one further out', () => {
    const score = doc({ kind: 'fretted', string: 1, fret: 30 });

    expect(shiftSemitone(score, [ref(0)], null, 1)).toMatch(/fret/i);
    expect(shiftSemitone(score, [ref(0)], null, -1)).toBeNull();
    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 29 });
  });

  it('refuses a move that would take a trill past the MIDI range, which alphaTab would drop', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });
    notesOf(score, 1)[0].effects.trill = { value: 127, speed: 16 };

    expect(shiftSemitone(score, [ref(1)], null, 1)).toMatch(/trill/i);
    expect(notesOf(score, 1)[0].pitch).toEqual({ kind: 'pitched', noteValue: 0, octave: 4, letter: 'C' });
  });

  it('moves a whole tie chain when one of its notes is moved, since alphaTab copies the origin\'s fret onward', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });
    const tied = put(score, 1, { kind: 'fretted', string: 3, fret: 5 });
    tied.isTied = true;
    const again = put(score, 2, { kind: 'fretted', string: 3, fret: 5 });
    again.isTied = true;

    expect(shiftSemitone(score, [ref(0, 1)], null, 1)).toBeNull();

    expect([notesOf(score, 0)[0], tied, again].map(note => note.pitch.kind === 'fretted' && note.pitch.fret)).toEqual([6, 6, 6]);
  });

  it('moves a tie chain back into an uneven bar without reordering that bar', () => {
    // Bar 0 is a half on string 2, a quarter rest and a quarter on string 3; bar 1 opens with the
    // quarter's tied continuation. Finding the origin walks bar 0 backwards, and must not reverse it.
    const score = ComposerService.createEmptyScore();
    const bar0 = score.tracks[0].staves[0].bars[0].voices[0].beats;
    bar0.splice(0, bar0.length, { ...bar0[0], duration: 2 }, { ...bar0[1] }, { ...bar0[2] });
    put(score, 0, { kind: 'fretted', string: 2, fret: 7 });
    const origin = put(score, 2, { kind: 'fretted', string: 3, fret: 5 });
    const next = score.tracks[0].staves[0].bars[1].voices[0].beats[0];
    next.isRest = false;
    next.notes = [{ pitch: { kind: 'fretted', string: 3, fret: 5 }, isTied: true, accidental: 'auto', effects: createDefaultNoteEffects() }];

    expect(shiftSemitone(score, [{ ...ref(0), barIndex: 1 }], null, 1)).toBeNull();

    expect(bar0.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}`)).toEqual(['n2', 'r4', 'n4']);
    expect([origin, next.notes[0]].map(note => note.pitch.kind === 'fretted' && note.pitch.fret)).toEqual([6, 6]);
    expect(bar0[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 2, fret: 7 });
  });
});

describe('moveNotesToString with ties and landings', () => {
  it('moves a whole tie chain to the new string', () => {
    // String 2 (B, 59) at fret 5 is E, 64: fret 0 on string 1.
    const score = doc({ kind: 'fretted', string: 2, fret: 5 });
    const tied = put(score, 1, { kind: 'fretted', string: 2, fret: 5 });
    tied.isTied = true;

    expect(moveNotesToString(score, [ref(0)], null, -1)).toBeNull();

    expect([notesOf(score, 0)[0].pitch, tied.pitch]).toEqual([{ kind: 'fretted', string: 1, fret: 0 }, { kind: 'fretted', string: 1, fret: 0 }]);
  });

  it('refuses a move that would put another note between a tied note and the note it is tied from', () => {
    const score = doc({ kind: 'fretted', string: 2, fret: 5 });
    put(score, 1, { kind: 'fretted', string: 1, fret: 3 });
    const tied = put(score, 2, { kind: 'fretted', string: 2, fret: 5 });
    tied.isTied = true;

    expect(moveNotesToString(score, [ref(0)], null, -1)).toMatch(/tie/i);
    expect(tied.pitch).toEqual({ kind: 'fretted', string: 2, fret: 5 });
  });

  it('refuses a move that would strand another note\'s hammer-on, and lets the pair move together', () => {
    const strand = (): ScoreDoc => {
      const score = doc({ kind: 'fretted', string: 2, fret: 5 });
      notesOf(score, 0)[0].effects.isHammerPullOrigin = true;
      put(score, 1, { kind: 'fretted', string: 2, fret: 7 });
      return score;
    };

    const moved = strand();
    expect(moveNotesToString(moved, [ref(0, 1)], null, -1)).toMatch(/hammer-on/i);
    expect(moved.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].pitch).toEqual({ kind: 'fretted', string: 2, fret: 7 });

    expect(moveNotesToString(strand(), [ref(0, 0)], null, -1)).toMatch(/hammer-on/i);
    expect(moveNotesToString(strand(), [ref(0, 0), ref(0, 1)], null, -1)).toBeNull();
  });

  it('refuses to keep a natural harmonic on a fret that has none, and moves one that lands on a node', () => {
    // String 3 (G, 55) at fret 5 is C, 60: fret 1 on string 2, where no natural harmonic sounds.
    const off = doc({ kind: 'fretted', string: 3, fret: 5 });
    notesOf(off, 0)[0].effects.harmonic = 'natural';
    expect(moveNotesToString(off, [ref(0)], null, -1)).toMatch(/harmonic/i);

    // String 2 at fret 12 is 71: fret 7 on string 1, a node.
    const on = doc({ kind: 'fretted', string: 2, fret: 12 });
    notesOf(on, 0)[0].effects.harmonic = 'natural';
    expect(moveNotesToString(on, [ref(0)], null, -1)).toBeNull();
    expect(notesOf(on, 0)[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 7 });
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

  it('refuses a note that would need a fret past the last one in front of the capo', () => {
    // String 1 (E, 64) at fret 16 under a capo at 5 is 85: fret 21 on string 2 (B, 59), with 19 in front of the capo.
    const score = doc({ kind: 'fretted', string: 1, fret: 16 });
    score.tracks[0].staves[0].capo = 5;

    expect(moveNotesToString(score, [ref(0)], null, 1)).toMatch(/fret 21/);
    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 16 });

    const lower = doc({ kind: 'fretted', string: 1, fret: 14 });
    lower.tracks[0].staves[0].capo = 5;
    expect(moveNotesToString(lower, [ref(0)], null, 1)).toBeNull();
    expect(notesOf(lower, 0)[0].pitch).toEqual({ kind: 'fretted', string: 2, fret: 19 });
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
