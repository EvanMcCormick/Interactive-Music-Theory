import {
  SpelledNote,
  formatNote,
  letterOf,
  parseNoteName,
  pitchClassOf,
  scientificOctave,
  spellAt,
  spellPitchClass
} from './note-spelling';

const C: SpelledNote = { letter: 0, accidental: 0 };
const F: SpelledNote = { letter: 3, accidental: 0 };
const B_FLAT: SpelledNote = { letter: 6, accidental: -1 };
const D_FLAT: SpelledNote = { letter: 1, accidental: -1 };
const C_SHARP: SpelledNote = { letter: 0, accidental: 1 };
const G_SHARP: SpelledNote = { letter: 4, accidental: 1 };

describe('spellAt', () => {
  // The four named failures from the design doc's "cannot spell every borrowed
  // root" section, each now spelled as the numeral above it says.
  it('spells the ♭II of B flat major as C flat', () => {
    expect(spellAt(11, B_FLAT, 1)).toEqual({ letter: 0, accidental: -1 });
  });

  it('spells the ♭II of D flat major as E double flat', () => {
    expect(spellAt(2, D_FLAT, 1)).toEqual({ letter: 2, accidental: -2 });
  });

  it('spells the ♯vii° of C sharp minor on B sharp', () => {
    expect(spellAt(0, C_SHARP, 6)).toEqual({ letter: 6, accidental: 1 });
  });

  it('spells the ♯vii° of G sharp minor on F double sharp', () => {
    expect(spellAt(7, G_SHARP, 6)).toEqual({ letter: 3, accidental: 2 });
  });

  // One of the thirteen the key's own spelling got wrong: F locrian was treated
  // as a six-sharp key and printed G♯ for its third degree.
  it('spells the third degree of F locrian as A flat', () => {
    expect(spellAt(8, F, 2)).toEqual({ letter: 5, accidental: -1 });
  });

  it('refuses a spelling past a double accidental', () => {
    // Pitch class 1 on the letter E needs three flats.
    expect(spellAt(1, C, 2)).toBeNull();
  });

  // The docstring promises both arguments take unreduced input, and Task 5
  // feeds exactly that. A seventh chord's stack crosses the octave without
  // being reduced - `degreePitchClasses` really does return `[11, 14, 17, 21]`
  // for a B half-diminished seventh - so the seventh arrives as 21, not 9.
  it('takes a chord-stack member that was never reduced', () => {
    const B: SpelledNote = { letter: 6, accidental: 0 };
    expect(spellAt(21, B, 6)).toEqual({ letter: 5, accidental: 0 });
  });

  // A negative step, the other half of that promise: one letter *below* the
  // tonic is the letter above it at the far end of the octave, so C's is a B.
  it('takes a step downward', () => {
    expect(spellAt(11, C, -1)).toEqual({ letter: 6, accidental: 0 });
  });
});

describe('formatNote and parseNoteName', () => {
  it('writes ASCII, as the chromatic tables do', () => {
    expect(formatNote({ letter: 0, accidental: -1 })).toBe('Cb');
    expect(formatNote({ letter: 2, accidental: -2 })).toBe('Ebb');
    expect(formatNote({ letter: 3, accidental: 2 })).toBe('F##');
    expect(formatNote(C)).toBe('C');
  });

  it('reads back what it writes', () => {
    for (const name of ['C', 'Db', 'F#', 'Cb', 'Ebb', 'F##', 'B#']) {
      expect(formatNote(parseNoteName(name)!)).toBe(name);
    }
  });

  // Strictly the inverse of `formatNote`, which is a decision rather than an
  // accident: each of these has an obvious reading, and guessing it would be
  // choosing a spelling on the caller's behalf.
  it('refuses a name that is not one', () => {
    expect(parseNoteName('H')).toBeNull();
    expect(parseNoteName('C#/Db')).toBeNull();
    expect(parseNoteName('c')).toBeNull();     // lower case
    expect(parseNoteName('Cb#')).toBeNull();   // two signs at once
    expect(parseNoteName('C###')).toBeNull();  // past a double accidental
  });
});

describe('pitchClassOf, scientificOctave, spellPitchClass', () => {
  it('wraps a spelled note onto its pitch class', () => {
    expect(pitchClassOf({ letter: 0, accidental: -1 })).toBe(11);
    expect(pitchClassOf({ letter: 6, accidental: 1 })).toBe(0);
  });

  // The octave number follows the letter, not the pitch: C flat 5 sounds B4.
  it('numbers the octave by the letter', () => {
    expect(scientificOctave(71, { letter: 0, accidental: -1 })).toBe(5); // Cb5
    expect(scientificOctave(60, { letter: 6, accidental: 1 })).toBe(3);  // B#3
    expect(scientificOctave(60, C)).toBe(4);                            // C4
  });

  it('spells a bare pitch class by preference, as the tables do', () => {
    expect(spellPitchClass(1, true)).toEqual({ letter: 0, accidental: 1 });
    expect(spellPitchClass(1, false)).toEqual({ letter: 1, accidental: -1 });
    expect(spellPitchClass(4, false)).toEqual({ letter: 2, accidental: 0 });
  });
});

describe('letterOf', () => {
  // The caller that wants the letter alone is the projection, which hands it to
  // a note so the engraver draws the line the degree names. The accidental has
  // already done its work by then.
  it('names the letter of a spelling, accidental and all', () => {
    expect(letterOf({ letter: 0, accidental: -1 })).toBe('C'); // Cb is on a C
    expect(letterOf({ letter: 6, accidental: 1 })).toBe('B');  // B# is on a B
    expect(letterOf({ letter: 3, accidental: 0 })).toBe('F');
  });
});
