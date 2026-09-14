import { ComposerService } from './composer.service';
import { frettedDocOf, frettedPlacementOf, maxFretOf, soundingMidiOf, staffEntryOf } from './pitch-on-strings';
import { BeatDoc, NoteDoc, NotePitch, ScoreDoc, StaffDoc, createDefaultNoteEffects } from '../models/composer.model';

const noteOf = (pitch: NotePitch): NoteDoc => ({ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });
const guitar = (): StaffDoc => ComposerService.createEmptyScore().tracks[0].staves[0];
const D5 = 74;

describe('frettedPlacementOf', () => {
  it('takes the lowest fret over every string, whatever string the caret is on', () => {
    expect(frettedPlacementOf(guitar(), D5, new Set(), null)).toEqual({ kind: 'fretted', string: 1, fret: 10 });
    // D5 on the D string is fret 24, which the hand check got with the caret left on string 4.
    expect(frettedPlacementOf(guitar(), D5, new Set(), 4)).toEqual({ kind: 'fretted', string: 1, fret: 10 });
    // D5 on the G string is fret 19, nine above the lowest.
    expect(frettedPlacementOf(guitar(), D5, new Set(), 3)).toEqual({ kind: 'fretted', string: 1, fret: 10 });
    expect(frettedPlacementOf(guitar(), 40, new Set(), null)).toEqual({ kind: 'fretted', string: 6, fret: 0 });
  });

  it("plays the high E string's open pitch open, not at fret 24 on the low E string the caret is on", () => {
    expect(frettedPlacementOf(guitar(), 64, new Set(), 6)).toEqual({ kind: 'fretted', string: 1, fret: 0 });
  });

  it("prefers the caret's string when it reaches the pitch within 4 frets of the lowest", () => {
    // D4, 62: fret 3 on the B string, 7 on the G string (4 above), 12 on the D string (9 above).
    expect(frettedPlacementOf(guitar(), 62, new Set(), 3)).toEqual({ kind: 'fretted', string: 3, fret: 7 });
    expect(frettedPlacementOf(guitar(), 62, new Set(), 4)).toEqual({ kind: 'fretted', string: 2, fret: 3 });
    expect(frettedPlacementOf(guitar(), 62, new Set(), null)).toEqual({ kind: 'fretted', string: 2, fret: 3 });
  });

  it('skips a string that already holds a note on the beat', () => {
    expect(frettedPlacementOf(guitar(), D5, new Set([1]), 1)).toEqual({ kind: 'fretted', string: 2, fret: 15 });
    expect(frettedPlacementOf(guitar(), D5, new Set([1, 2, 3, 4]), null)).toMatch(/already has a note/);
  });

  it("breaks a tie between two strings tuned alike toward the caret's string, and then the higher string", () => {
    const unison = { tuning: [50, 50], capo: 0 };

    expect(frettedPlacementOf(unison, 55, new Set(), null)).toEqual({ kind: 'fretted', string: 1, fret: 5 });
    expect(frettedPlacementOf(unison, 55, new Set(), 2)).toEqual({ kind: 'fretted', string: 2, fret: 5 });
  });

  it("does not prefer the caret's string when it holds a note on the beat", () => {
    // D4 on the G string would be 4 above the lowest, but the G string is taken.
    expect(frettedPlacementOf(guitar(), 62, new Set([3]), 3)).toEqual({ kind: 'fretted', string: 2, fret: 3 });
  });

  it("refuses a pitch below the lowest string or past the highest fret, counting frets from the capo", () => {
    expect(frettedPlacementOf(guitar(), 38, new Set(), null)).toBe("That pitch is below this staff's lowest string.");
    expect(frettedPlacementOf(guitar(), 89, new Set(), null)).toMatch(/above the highest fret/);

    const capoed = { ...guitar(), capo: 2 };
    expect(frettedPlacementOf(capoed, 42, new Set(), null)).toEqual({ kind: 'fretted', string: 6, fret: 0 });
    expect(frettedPlacementOf(capoed, 40, new Set(), null)).toMatch(/below/);
    // A capo at 2 leaves 22 frets in front of it.
    expect(frettedPlacementOf(capoed, 88, new Set(), null)).toEqual({ kind: 'fretted', string: 1, fret: 22 });
    expect(frettedPlacementOf(capoed, 89, new Set(), null)).toMatch(/above/);
  });
});

describe('maxFretOf', () => {
  it('is 24 on a neck with no capo, and 24 less the capo in front of one', () => {
    expect(maxFretOf({ capo: 0 })).toBe(24);
    expect(maxFretOf({ capo: 5 })).toBe(19);
  });
});

describe('soundingMidiOf', () => {
  it('sounds a fret from its open string and the capo, and a pitch as itself', () => {
    expect(soundingMidiOf({ ...guitar(), capo: 2 }, { kind: 'fretted', string: 1, fret: 8 })).toBe(D5);
    expect(soundingMidiOf(guitar(), { kind: 'pitched', noteValue: 2, octave: 5 })).toBe(D5);
  });
});

describe('staffEntryOf', () => {
  const beat = (notes: NoteDoc[]): BeatDoc => ({ ...ComposerService.createEmptyScore().tracks[0].staves[0].bars[0].voices[0].beats[0], notes, isRest: notes.length === 0 });
  const piano = (): StaffDoc => ({ ...guitar(), tuning: [], tuningLabel: '', showTablature: false });
  const d5: NotePitch = { kind: 'pitched', noteValue: 2, octave: 5 };

  it('writes a pitch on a staff with a tuning as a fret, and on one without as itself', () => {
    expect(staffEntryOf(guitar(), beat([]), d5, null)).toEqual({ kind: 'write', pitch: { kind: 'fretted', string: 1, fret: 10 } });
    expect(staffEntryOf(piano(), beat([]), d5, null)).toEqual({ kind: 'write', pitch: d5 });
  });

  it('takes out a note already sounding the pitch, as a click on a notehead does', () => {
    const held = beat([noteOf({ kind: 'fretted', string: 2, fret: 15 })]);

    expect(staffEntryOf(guitar(), held, d5, null)).toEqual({ kind: 'remove', index: 0 });
  });

  it('refuses a fret past the last one in front of the capo, saying why, and writes one up to it', () => {
    const capoed = { ...guitar(), capo: 5 };

    expect(staffEntryOf(capoed, beat([]), { kind: 'fretted', string: 1, fret: 20 }, 0)).toBe('With the capo at 5, a fret runs from 0 to 19.');
    expect(staffEntryOf(guitar(), beat([]), { kind: 'fretted', string: 1, fret: 25 }, 0)).toBe('A fret runs from 0 to 24.');
    expect(staffEntryOf(capoed, beat([]), { kind: 'fretted', string: 1, fret: 19 }, 0)).toEqual({
      kind: 'write',
      pitch: { kind: 'fretted', string: 1, fret: 19 }
    });
  });

  it('refuses a fret on a staff with no strings', () => {
    expect(staffEntryOf(piano(), beat([]), { kind: 'fretted', string: 1, fret: 3 }, 0)).toMatch(/no strings/);
  });
});

describe('frettedDocOf', () => {
  function withPitches(pitches: NotePitch[]): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    const target = doc.tracks[0].staves[0].bars[0].voices[0].beats;
    pitches.forEach((pitch, index) => {
      target[index].isRest = false;
      target[index].notes = [noteOf(pitch)];
    });
    return doc;
  }

  it('hands back the same document when no staff with a tuning holds a pitched note', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes = [noteOf({ kind: 'pitched', noteValue: 0, octave: 4 })];

    expect(frettedDocOf(doc)).toEqual({ doc, dropped: 0 });
  });

  it('frets every pitched note on a staff with a tuning, on a copy, and leaves out a note no string reaches', () => {
    const doc = withPitches([
      { kind: 'pitched', noteValue: 2, octave: 5 },
      { kind: 'pitched', noteValue: 4, octave: 1 }
    ]);
    const before = structuredClone(doc);

    const result = frettedDocOf(doc);
    const beats = result.doc.tracks[0].staves[0].bars[0].voices[0].beats;

    expect(doc).toEqual(before);
    expect(result.dropped).toBe(1);
    expect(beats[0].notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
    expect(beats[1].notes).toEqual([]);
    expect(beats[1].isRest).toBeTrue();
  });

  it('puts a chord of pitches on strings of their own', () => {
    const doc = ComposerService.createEmptyScore();
    const beat = doc.tracks[0].staves[0].bars[0].voices[0].beats[0];
    beat.isRest = false;
    beat.notes = [noteOf({ kind: 'fretted', string: 1, fret: 10 }), noteOf({ kind: 'pitched', noteValue: 11, octave: 4 })];

    const notes = frettedDocOf(doc).doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;

    // B4 is fret 7 on string 1, which the D5 holds, so it goes to fret 12 on string 2.
    expect(notes.map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 10 },
      { kind: 'fretted', string: 2, fret: 12 }
    ]);
  });
});
