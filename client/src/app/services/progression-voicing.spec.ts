import { voiceChord } from './progression-voicing';

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

  it('wraps back to root position when the inversion exceeds the note count', () => {
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

  it('starts no note below the base', () => {
    expect(Math.min(...voiceChord([0, 4, 7], 0, 48))).toBeGreaterThanOrEqual(48);
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
