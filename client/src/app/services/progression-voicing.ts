/**
 * Turns a chord's pitch classes into actual MIDI notes.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent.
 *
 * Deliberately independent of `progression-harmony.ts`, which it does not
 * import: it voices any ascending list of pitch classes, whether they came from
 * a diatonic stack of thirds, a recognised chord, or a hand-built one. Coupling
 * it to the diatonic module would tie voicing to a source it has no reason to
 * care about.
 *
 * The rule is that every note ascends from the one below it. That is what makes
 * an inversion a rotation: move the root to the top of the list and it is
 * re-stacked an octave up, which is what a first inversion is.
 */

/**
 * Voices a chord ascending from `baseMidi`.
 *
 * `pitchClasses` may exceed 11 - `degreePitchClasses` returns [11, 14, 17] for a
 * vii chord - and that is fine, since only the pitch class mod 12 is used.
 *
 * `inversion` wraps in both directions, so stepping past either end of the
 * chord lands back inside it rather than off the array.
 */
export function voiceChord(
  pitchClasses: readonly number[],
  inversion: number,
  baseMidi: number
): number[] {
  const count = pitchClasses.length;
  if (count === 0) return [];

  // Modulo twice: JavaScript's `%` keeps the sign of the left operand, so a
  // negative inversion needs the extra `+ count` to land inside the chord.
  const shift = ((inversion % count) + count) % count;
  const rotated = [...pitchClasses.slice(shift), ...pitchClasses.slice(0, shift)];

  const notes: number[] = [];
  // The loop below places each note strictly above the one before it, which is
  // the right rule everywhere except the first note, where the base is a floor
  // the chord may sit *on*. Starting a semitone under the base converts the one
  // into the other, so a single rule covers both: a first note whose pitch
  // class matches the base lands on the base itself rather than an octave up.
  let previous = baseMidi - 1;

  for (const pitchClass of rotated) {
    const step = (((pitchClass - previous) % 12) + 12) % 12;
    // A step of zero means the same pitch class as the previous note. For an
    // inner note that would repeat a pitch already sounding and lose a voice;
    // for the first note - vii-dim in C, whose B sits a semitone below middle C
    // - it would fall below the base. An octave up is the answer to both.
    const midi = previous + (step === 0 ? 12 : step);
    notes.push(midi);
    previous = midi;
  }

  return notes;
}
