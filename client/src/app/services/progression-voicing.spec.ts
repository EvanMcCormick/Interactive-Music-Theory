import { headroomOctaves, voiceChord } from './progression-voicing';

// Middle C is MIDI 60 throughout.
describe('voiceChord', () => {
  it('stacks a root-position C major from middle C', () => {
    expect(voiceChord([0, 4, 7], 0, 60)).toEqual([60, 64, 67]);
  });

  // An inversion moves the bottom note to the top rather than leaving it where
  // it is, so the root climbs an octave and the chord as a whole rises. That is
  // what makes C/E sound higher than C, and it is the property a rotation that
  // re-stacked from the original bass would get wrong.
  it('puts the third in the bass for a first inversion', () => {
    expect(voiceChord([0, 4, 7], 1, 60)).toEqual([64, 67, 72]);
  });

  it('puts the fifth in the bass for a second inversion', () => {
    expect(voiceChord([0, 4, 7], 2, 60)).toEqual([67, 72, 76]);
  });

  // Inversion 4, not 3. At 3 - exactly the note count - a chord with the wrap
  // removed altogether would still pass, because `slice(3)` on a three-note
  // chord is empty and leaves the rotation in root position either way. Only
  // past the count do the two diverge, so 4 is the case that tests the wrap and
  // 3 the boundary it turns at.
  it('wraps past the top of the chord when the inversion exceeds the note count', () => {
    expect(voiceChord([0, 4, 7], 4, 60)).toEqual([64, 67, 72]);
    expect(voiceChord([0, 4, 7], 3, 60)).toEqual([60, 64, 67]);
  });

  // A UI that steps the inversion down past zero should land on the top
  // inversion rather than on a negative array index.
  it('counts a negative inversion backwards from the top', () => {
    expect(voiceChord([0, 4, 7], -1, 60)).toEqual([67, 72, 76]);
    expect(voiceChord([0, 4, 7], -3, 60)).toEqual([60, 64, 67]);
  });

  it('keeps a chord wider than an octave ascending', () => {
    // A stacked 9th spans more than an octave; every note must still ascend.
    const notes = voiceChord([0, 4, 7, 11, 14], 0, 60);
    expect(notes).toEqual([60, 64, 67, 71, 74]);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    }
  });

  // The case the "same pitch class as the note below" rule exists for: a chord
  // that doubles its root. Without it the doubled C would land on the very MIDI
  // note already sounding, so the chord would be a note short.
  it('lifts a doubled root an octave instead of repeating it', () => {
    // C C E G - 0 and 12 are the same pitch class.
    expect(voiceChord([0, 12, 16, 19], 0, 60)).toEqual([60, 72, 76, 79]);
  });

  // The other half of that rule, and the half that fires on real diatonic
  // input: vii-dim in C major is B D F, whose lowest pitch class sits a
  // semitone *below* middle C. It must be voiced from the B above the base,
  // not the B below it.
  it('lifts a chord whose lowest tone sits just under the base', () => {
    expect(voiceChord([11, 14, 17], 0, 60)).toEqual([71, 74, 77]);
  });

  // Asserted exactly rather than as `>= 48`: an implementation that ignored the
  // base and always started from middle C would satisfy the inequality, and
  // this is the one parameter an octave control moves, so it has to be pinned
  // to the note rather than to a range.
  it('voices from the base it is given, not from middle C', () => {
    expect(voiceChord([0, 4, 7], 0, 48)).toEqual([48, 52, 55]);
  });

  it('starts no note below the base', () => {
    // Base 60 is a C, so the twelve pitch classes should land on the twelve
    // semitones running up from 60 - pitch class 11 on 71, never on 59.
    for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
      expect(voiceChord([pitchClass], 0, 60)).toEqual([60 + pitchClass]);
    }
  });

  // Interval arrays are reference data in this codebase, so voicing one must
  // not be able to disturb it.
  it('leaves the caller\'s pitch classes untouched', () => {
    const pitchClasses: readonly number[] = Object.freeze([0, 4, 7]);
    expect(voiceChord(pitchClasses, 1, 60)).toEqual([64, 67, 72]);
    expect(pitchClasses).toEqual([0, 4, 7]);
  });

  it('voices an empty chord as no notes at all', () => {
    expect(voiceChord([], 0, 60)).toEqual([]);
  });
});

describe('headroomOctaves', () => {
  // Middle C to 127. A C major triad from middle C tops out on G4 = 67, and
  // 127 - 67 is 60 - five whole octaves, with nothing left over.
  it('counts whole octaves between a voicing and the ceiling', () => {
    expect(headroomOctaves([0, 4, 7], 0, 60, 127)).toBe(5);
  });

  // The remainder is discarded downward rather than rounded, because half an
  // octave of headroom is no headroom at all: this control moves in twelves.
  it('discards a part-octave of headroom rather than rounding it up', () => {
    // Tops out on 67. 68 leaves one semitone; 78 leaves eleven; 79 leaves
    // twelve, which is the first that buys an octave.
    expect(headroomOctaves([0, 4, 7], 0, 60, 68)).toBe(0);
    expect(headroomOctaves([0, 4, 7], 0, 60, 78)).toBe(0);
    expect(headroomOctaves([0, 4, 7], 0, 60, 79)).toBe(1);
  });

  // A chord already over the ceiling where it stands has *negative* headroom,
  // and saying so is the whole point: the answer is how far it must move, and
  // the direction is part of the answer. Rounding it up to 0 would report a
  // chord that does not fit as one that just fits.
  it('reports negative headroom for a voicing already past the ceiling', () => {
    expect(headroomOctaves([0, 4, 7], 0, 60, 66)).toBe(-1);
    expect(headroomOctaves([0, 4, 7], 0, 60, 55)).toBe(-1);
    expect(headroomOctaves([0, 4, 7], 0, 60, 54)).toBe(-2);
  });

  /**
   * The property the whole ceiling rests on, and the reason a single voicing is
   * enough to derive it: shifting the base by whole octaves shifts every note by
   * exactly the same amount.
   *
   * `voiceChord` places each note from the one below it modulo 12, and adding
   * twelve to the base leaves every one of those steps unchanged. So the
   * headroom answer is the *maximal* one rather than merely a safe one, and it
   * can be read off one voicing instead of searched for.
   */
  it('is the highest shift that fits, because an octave shift is exact', () => {
    const chord = [3, 8, 9, 16, 28, 35, 47];
    const headroom = headroomOctaves(chord, 2, 60, 127);

    const topAt = (base: number): number => {
      const notes = voiceChord(chord, 2, base);
      return notes[notes.length - 1];
    };
    expect(topAt(60 + headroom * 12)).toBeLessThanOrEqual(127);
    expect(topAt(60 + (headroom + 1) * 12)).toBeGreaterThan(127);
  });

  // The inversion is part of the question, because a rotation moves the top
  // note: a first-inversion C major reaches 72 where root position reaches 67.
  it('answers for the inversion it is asked about', () => {
    expect(headroomOctaves([0, 4, 7], 0, 60, 127)).toBe(5);
    expect(headroomOctaves([0, 4, 7], 1, 60, 127)).toBe(4);
  });

  /**
   * A chord with no notes cannot pass a ceiling, so there is no octave at which
   * it stops fitting. `Infinity` is that answer written down; the caller's own
   * maximum is what stops it. Zero would be a lie in the other direction - a
   * chord pinned to its base for no reason.
   */
  it('gives an empty chord unbounded headroom', () => {
    expect(headroomOctaves([], 0, 60, 127)).toBe(Infinity);
  });

  it('leaves the caller\'s pitch classes untouched', () => {
    const pitchClasses: readonly number[] = Object.freeze([0, 4, 7]);
    expect(headroomOctaves(pitchClasses, 1, 60, 127)).toBe(4);
    expect(pitchClasses).toEqual([0, 4, 7]);
  });
});
