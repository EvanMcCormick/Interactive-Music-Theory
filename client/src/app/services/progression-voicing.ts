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
 *
 * That independence leaves the caller holding a precondition: a rotation is an
 * *inversion* only if the input is root position and ascending. [7, 4, 0] is
 * accepted and voices to a perfectly legal ascending chord, but at inversion 0
 * it comes out G-E-C, with the fifth in the bass - root position was asked for
 * and something else arrived. `degreePitchClasses` guarantees the ordering, and
 * anything hand-built has to guarantee it for itself.
 *
 * The base is a floor rather than a centre, and that is audible. In C from
 * middle C, I voices to C4-E4-G4 while vii-dim voices to B4-D5-F5, because B is
 * the last pitch class that fits above the floor. So I - vii-dim - I leaps up
 * nearly an octave and back. That is correct under the rule as written and no
 * voice-leading is promised before M2, but it is the first thing that will
 * sound wrong once a progression plays, so it belongs here as a known
 * consequence rather than waiting to be found as a bug.
 */

/**
 * Voices a chord ascending from `baseMidi`.
 *
 * `pitchClasses` may exceed 11 - `degreePitchClasses` returns [11, 14, 17] for a
 * vii chord - and that is fine, since only the pitch class mod 12 is used.
 *
 * `inversion` wraps in both directions, so stepping past either end of the
 * chord lands back inside it rather than off the array.
 *
 * It is deliberately unguarded, where `degreePitchClasses` guards its `degree`.
 * The asymmetry is not that this failure is milder: it is that a bad inversion
 * cannot produce a bad note. `NaN % count` is `NaN` and `slice(NaN)` coerces to
 * 0, so nonsense silently voices root position, and the output is a valid
 * ascending chord whatever arrives. A bad degree instead produced `NaN`, which
 * would have run through here untouched into `RollNote.midi` and on to
 * `Tone.PolySynth`. That guard keeps `NaN` out of the audio layer; a guard here
 * would prevent nothing worse than a control appearing not to work.
 *
 * A non-integer inversion truncates asymmetrically, because the wrap is
 * computed before `slice` truncates: 1.5 gives the first inversion, while -0.5
 * wraps to 2.5 and gives the *second*. No caller passes fractions, but the
 * behaviour should be read as arithmetic rather than as a bug.
 */
export function voiceChord(
  pitchClasses: readonly number[],
  inversion: number,
  baseMidi: number
): number[] {
  const count = pitchClasses.length;
  if (count === 0) return [];

  // Normalised into 0..count-1 so `shift` is a real array index. It is not
  // needed for correctness - `slice` reads a negative index as `length + index`
  // and so rotates identically on a bare `inversion % count` - but relying on
  // that would make the rotation legible only to a reader who knows `slice`'s
  // sign rules.
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
