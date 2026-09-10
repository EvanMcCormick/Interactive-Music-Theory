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

/**
 * How many whole octaves this voicing may be shifted above `baseMidi` before
 * its top note passes `highestMidi`.
 *
 * The answer to "how high may this chord be voiced", asked of the module that
 * decides how high a chord is voiced. It lives here rather than beside the
 * generator for the reason `voiceChord`'s own placement rule lives here: the
 * reach of a voicing is a fact about the arithmetic above and nothing else, and
 * a caller that derived it from a copy of that arithmetic would be guarding a
 * pipeline it had reimplemented. `chordOctaveCeiling` in
 * `progression-generate.ts` is the caller that has a key and a scale, and it
 * bounds this answer to the octave control's own range.
 *
 * ## One voicing is enough, and the answer is exact
 *
 * `voiceChord` places each note a fixed number of semitones above the one below
 * it, and that number is `(pitchClass - previous) mod 12`. Adding twelve to
 * `baseMidi` adds twelve to `previous` and leaves every one of those steps
 * unchanged - so **a whole-octave shift of the base moves every note in the
 * chord by exactly twelve**, and nothing about the voicing's shape can change
 * under it.
 *
 * That is what makes this a division rather than a search, and what makes the
 * result *maximal* rather than merely safe. A ceiling that fits but is not the
 * highest that fits costs the user range without ever saying so, which is the
 * quieter of the two failures and the harder to notice.
 *
 * It is only true for whole octaves. A base moved by anything else changes the
 * steps and can change the reach, which is why `OCTAVE_MIN`/`OCTAVE_MAX` count
 * octaves and why the sweeps that measure this pipeline vary the tonic
 * separately from the base.
 *
 * ## Two answers that are not zero
 *
 * **A chord already over the ceiling gets a negative answer**, and that is the
 * information the caller needs: how far it must come *down*. Rounding it up to
 * zero would report a chord that does not fit as one that just fits.
 *
 * **A chord with no notes gets `Infinity`.** There is no note to pass a
 * ceiling, so there is no octave at which it stops fitting, and the caller's own
 * maximum is what stops it. Zero would be a lie in the other direction - an
 * empty chord pinned to its base for no reason at all. `voiceChord` returns no
 * notes for no pitch classes rather than refusing, and this is the matching
 * answer one layer up.
 */
export function headroomOctaves(
  pitchClasses: readonly number[],
  inversion: number,
  baseMidi: number,
  highestMidi: number
): number {
  const notes = voiceChord(pitchClasses, inversion, baseMidi);
  if (notes.length === 0) return Infinity;

  // Floored rather than rounded or truncated. `Math.trunc` would round a
  // negative headroom *towards* zero and report a chord that overflows as one
  // that fits where it stands, which is the one direction this must never err
  // in.
  return Math.floor((highestMidi - notes[notes.length - 1]) / 12);
}
