/**
 * Diatonic chords built by stacking thirds through a scale.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent, so the arithmetic can be checked directly against hand-written
 * chord tables.
 *
 * Everything here is relative to the tonic: a I chord is [0, 4, 7] in every
 * key. Applying the tonic is the caller's job, which keeps transposition a
 * single addition rather than a rule spread through the module.
 *
 * Quality is derived from the intervals the stack happens to produce rather
 * than looked up per mode. That is why one short table gives the major scale
 * I ii iii IV V vi vii-dim and natural minor i ii-dim III iv v VI VII, and why
 * an unusual scale - harmonic minor, say - yields its augmented III without
 * anyone having to enumerate it. `QUALITY_INTERVALS` is that table, and it is
 * read in both directions: `chordPitchClasses` builds a chord from a quality
 * where `qualityOfIntervals` reads a quality off a chord.
 */

/**
 * Every name is also a chord id in `music-theory.service.ts`, and the rules in
 * `degreeQuality` produce no name that is not in this list. That correspondence
 * is load-bearing: the fretboard is lit by handing the quality straight to
 * `selectKeyAndMode` as a chord id, so a quality with no matching chord would
 * light nothing, and `'other'` is the honest answer for a stack of thirds that
 * is not a named chord at all.
 */
export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'major7' | 'minor7' | 'dominant7' | 'minorMajor7'
  | 'halfDiminished7' | 'diminished7' | 'augmented7' | 'augmentedMajor7'
  | 'other';

/**
 * `ChordQuality` minus `'other'`, which is a refusal rather than a name - the
 * answer for a stack of thirds that is no named chord - so it has no interval
 * set and cannot be an override. Splitting it off keys `QUALITY_INTERVALS`
 * exhaustively on the qualities that *do* name intervals, so a quality added to
 * the union above cannot compile until its intervals are written down.
 */
export type NamedQuality = Exclude<ChordQuality, 'other'>;

/** Stacked-third extent. 3 is a triad; 7, 9, 11, 13 add one third each. */
export type ChordExtent = 3 | 7 | 9 | 11 | 13;

/**
 * Whether thirds can be stacked through this scale at all.
 *
 * Exported so a caller that would rather explain itself than fail can ask
 * first, instead of calling and catching. The rule lives here so the guard
 * below and the palette that renders the explanation cannot drift apart.
 */
export function isHeptatonic(scaleIntervals: readonly number[]): boolean {
  return scaleIntervals.length === 7;
}

/** Notes in a chord of the given extent. 3 -> 3 notes, 7 -> 4, 9 -> 5. */
export function noteCount(extent: ChordExtent): number {
  // Chords are named after their topmost interval, and every other scale degree
  // below it is in the stack, so a chord topping out at `n` has (n + 1) / 2
  // notes: 7 -> 4, 13 -> 7. The triad is the exception because 3 is not a
  // topmost interval in this encoding - a triad reaches a fifth - it is the
  // note count itself, so the formula has nothing to convert.
  return extent === 3 ? 3 : (extent + 1) / 2;
}

/**
 * Pitch classes of a diatonic chord, relative to the tonic, ascending.
 *
 * Not reduced mod 12: a chord that crosses the octave keeps climbing, so
 * [11, 14, 17] rather than [11, 2, 5]. Voicing needs the ascending order and
 * reducing here would throw it away.
 */
export function degreePitchClasses(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent
): number[] {
  // Stacking thirds only means anything when every other scale note is a third
  // away, which is to say in a seven-note scale. A pentatonic would silently
  // produce chords that are not thirds at all, so refuse rather than invent.
  if (!isHeptatonic(scaleIntervals)) {
    throw new Error(
      `Diatonic chords need a heptatonic scale; got ${scaleIntervals.length} notes`
    );
  }

  // The degree indexes the interval table directly, and JavaScript reads a bad
  // index as `undefined` rather than complaining, so the arithmetic below turns
  // -1 or 1.5 into NaN and `degreeQuality` reports the result as 'other' - a
  // refusal that looks like an answer. 7 is worse still: it wraps to the tonic
  // an octave up and returns a perfectly plausible wrong chord. Refuse all
  // three here, on the same principle as the scale check above.
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(
      `Diatonic chords need a scale degree from 0 to 6; got ${degree}`
    );
  }

  const notes: number[] = [];
  for (let i = 0; i < noteCount(extent); i++) {
    // A third is two scale steps, and each wrap past the seventh degree is one
    // octave higher than the interval table describes.
    const step = degree + i * 2;
    const octaves = Math.floor(step / 7);
    notes.push(scaleIntervals[step % 7] + octaves * 12);
  }
  return notes;
}

/**
 * Intervals above the root for each nameable quality: the single table both
 * directions of the naming read.
 *
 * `degreeQuality` used to carry this as a chain of comparisons on the third,
 * the fifth and the seventh: the same table written the other way round, and
 * two writings of one table is the arrangement that drifts. M3's recogniser
 * runs the naming in both directions - build a chord from a quality, then read
 * a quality back off a set of notes - so a disagreement would surface as a
 * chord not matching the name it was built from, a long way from either table.
 * One table instead, read forwards by `qualityOfIntervals` and backwards by
 * `chordPitchClasses`.
 *
 * Triads name three intervals and sevenths four, and **every seventh opens
 * with the triad of the same name** - which is what lets `chordPitchClasses`
 * take a seventh only as far as a triad's height without producing some other
 * chord. The augmented pair earns its place there: harmonic minor's III+ carries
 * a major seventh and the Neapolitans put a minor seventh over the same
 * augmented triad, so without both the augmented triads this module already
 * finds would lose their name on extension.
 *
 * No two entries share a shape, which is what makes the reverse reading a
 * function rather than a first match.
 */
export const QUALITY_INTERVALS: Readonly<Record<NamedQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  major7: [0, 4, 7, 11],
  dominant7: [0, 4, 7, 10],
  minor7: [0, 3, 7, 10],
  minorMajor7: [0, 3, 7, 11],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  augmented7: [0, 4, 8, 10],
  augmentedMajor7: [0, 4, 8, 11]
};

/** The table above as a list, typed once so the lookup below need not cast. */
const NAMED_QUALITIES = Object.entries(QUALITY_INTERVALS) as [
  NamedQuality,
  readonly number[]
][];

/**
 * The runtime twin of `ChordQuality`, for the guard that has to check a stored
 * value against the union at a point where the union no longer exists.
 *
 * Derived from `QUALITY_INTERVALS` rather than written out, so it cannot fall
 * behind the type: that table is keyed exhaustively on `NamedQuality`, so a
 * quality added to the union has to appear there before anything compiles, and
 * appearing there puts it here. `'other'` is appended because it is the one
 * member the table cannot hold - it names no intervals - and it is nonetheless
 * a value the model stores, `regenerateSlot` writing it as the label for a
 * stack that is no named chord.
 *
 * `CHORD_EXTENTS` is the same device one field over, and lives beside the guard
 * that reads it rather than beside its union; this one lives beside its union
 * because deriving it needs the table.
 */
export const CHORD_QUALITIES: readonly ChordQuality[] = [
  ...(Object.keys(QUALITY_INTERVALS) as NamedQuality[]),
  'other'
];

/**
 * The name for a stack of notes, from its intervals above its own root.
 *
 * Takes the notes as `degreePitchClasses` returns them - ascending, not reduced
 * mod 12, rooted wherever the chord happens to sit - and reads the intervals
 * relative to the first, so a Bb chord written [10, 14, 17] is major on exactly
 * the terms [0, 4, 7] is. A stack four notes tall or more is named after its
 * seventh, the convention `ChordDegree.quality` already stores a ninth under;
 * below four, only the third and the fifth are read.
 *
 * `'other'` is the honest answer for a stack that is no named chord - degree 6
 * of the double harmonic scale stacks a second under a diminished fifth - and
 * it is a refusal rather than a name. That is why `chordPitchClasses` will not
 * take it back the other way as an override.
 */
export function qualityOfIntervals(notes: readonly number[]): ChordQuality {
  const root = notes[0];
  // Four is where the seventh table starts, and a taller stack is named after
  // its seventh - so everything above the fourth note is dropped rather than
  // compared against a table that has no entry that tall.
  const width = notes.length >= 4 ? 4 : 3;
  const shape = notes.slice(0, width).map(note => note - root);

  for (const [quality, intervals] of NAMED_QUALITIES) {
    if (
      intervals.length === shape.length &&
      intervals.every((interval, i) => interval === shape[i])
    ) {
      return quality;
    }
  }
  return 'other';
}

/** Quality of the diatonic chord on `degree`: the stack first, then the name. */
export function degreeQuality(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent
): ChordQuality {
  return qualityOfIntervals(degreePitchClasses(scaleIntervals, degree, extent));
}

/**
 * Pitch classes of the chord a slot names: the diatonic stack, with its root
 * displaced by `alter` and its shape overridden by `quality`.
 *
 * This is the correction the design doc records under "`alter` cannot express a
 * borrowed chord". `alter` moves the root alone and the quality carries the
 * shape - what a Roman numeral's accidental does, and what shifting the whole
 * stack could not, that being transposition and transposition preserving
 * quality. So bVII came out diminished, bVI, bIII and the Neapolitan bII came
 * out minor, and #iv-dim came out major: every conventional altered numeral
 * wrong in shape on a root that was always right.
 *
 * `quality === null` means "as the key gives it" and hands back the diatonic
 * stack untouched. A non-null quality replaces the chord tones from the bottom
 * up, for as many intervals as it names.
 *
 * ## Two refusals
 *
 * **A chromatic root with no shape to build throws.** `alter !== 0` under a
 * null quality has no diatonic chord to inherit a shape from, and letting it
 * fall through to a whole-stack shift is exactly the failure above. It is a
 * value of the wrong kind rather than a control at its limit - the first clause
 * of the normalisation rule in `progression-normalize.ts` - and it is checked
 * here rather than among those guards because neither field is wrong alone:
 * `alter` is a bounded integer, `null` is the quality every fresh slot carries,
 * and only the pair names nothing. Every UI path supplies both together.
 *
 * **`'other'` cannot be an override.** It names no interval set, so there is
 * nothing to build from: it is `qualityOfIntervals`' refusal rather than a
 * name, and reading a refusal back as an instruction would mean inventing a
 * shape for a chord that has none.
 *
 * The scale and the degree stay `degreePitchClasses`' to refuse, and its throws
 * are allowed through rather than repeated here.
 *
 * ## The extent decides the note count, in both directions
 *
 * A quality naming **fewer** intervals than the extent asks for leaves the rest
 * diatonic, so a bVII9 is Bb-D-F over the ninth the key already gave that
 * degree. That is design decision 2, taken over refusing overrides above extent
 * 7 because refusing would make the complexity stepper fail on exactly the
 * borrowed chords a user most wants to extend.
 *
 * A quality naming **more** intervals than the extent asks for - a seventh
 * chosen while the slot is still a triad - is taken only as far as the extent
 * goes. `noteCount(extent)` is what `normalizeInversion` wraps an inversion
 * against and what the complexity readout prints, so a chord taller than its
 * own extent would put both out of step with what is sounding. Nothing musical
 * is lost, because every seventh in `QUALITY_INTERVALS` opens with the triad of
 * the same name: the seventh is dropped and that quality's chord is left.
 *
 * ## And the gap a displaced root opens above it
 *
 * The extensions staying diatonic has a consequence the note count does not
 * describe: the interval between the override's topmost note and the first
 * extension is whatever the displacement left, and it can be very wide. A
 * Hungarian minor 13th on degree 5, altered down a tone and overridden to
 * `augmented7`, leaves **seven semitones** between its seventh and the scale's
 * own ninth. That is a fifth where a chord of stacked thirds would have had a
 * second or a third, and it is the arithmetic working rather than failing: the
 * override moved its four notes and the scale kept the other three where they
 * were. It is recorded here because "extensions stay diatonic" says how many
 * notes come from where and says nothing about the shape of the seam.
 *
 * ## Ascending is a promise, and a displaced root can break it
 *
 * The stack is handed to `voiceChord`, whose header states its precondition
 * outright: a rotation is an *inversion* only if the input is root position and
 * ascending. Nothing about the mapping above guarantees the second half.
 * `root + shape[k]` can land on, or above, the diatonic note that follows it -
 * over the reachable grid it does so 1560 times, 72 of them by an outright
 * descent - so the last step is to lift each note by whole octaves until it
 * clears the one before it.
 *
 * An octave is a register and not a pitch, so nothing about the chord changes:
 * the same pitch classes come out in the same order. The lift is therefore a
 * fix to the *contract* rather than to the sound, and deliberately so. Two
 * consequences worth being explicit about:
 *
 *  - **It is audible nowhere today.** `voiceChord` places each note from the
 *    previous one modulo 12, so adding twelves to its input cannot move its
 *    output. What the lift buys is that the precondition is true rather than
 *    incidentally survivable - which is what M2's voice leading will need, and
 *    what no reader should have to re-derive from `voiceChord`'s arithmetic.
 *  - **A duplicated pitch class stays duplicated**, lifted to an octave above
 *    rather than dropped. Dropping it is the other candidate fix and it is the
 *    wrong one: it would return fewer notes than `noteCount(extent)`, which is
 *    what `normalizeInversion` wraps against and what the complexity readout
 *    prints. A doubled voice is a chord; a chord with a note missing from the
 *    count two other things are derived from is a bug in three places.
 */
export function chordPitchClasses(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent,
  alter: number,
  quality: ChordQuality | null
): number[] {
  const diatonic = degreePitchClasses(scaleIntervals, degree, extent);

  if (quality === null) {
    if (alter !== 0) {
      throw new Error(
        `A chromatic root needs an explicit quality to build from; ` +
          `got alter ${alter} with no quality`
      );
    }
    return diatonic;
  }

  if (quality === 'other') {
    throw new Error(
      `'other' names no interval set and cannot override a chord's shape`
    );
  }

  const shape = QUALITY_INTERVALS[quality];
  const root = diatonic[0] + alter;
  // Mapped over the diatonic stack rather than concatenated onto the shape,
  // which is what keeps the count the extent's in both directions: the shape is
  // read while it lasts, and every position past it keeps the scale's own note.
  const stacked = diatonic.map((note, i) => (i < shape.length ? root + shape[i] : note));

  return liftIntoAscent(stacked);
}

/**
 * Raises each note by whole octaves until it clears the one below it.
 *
 * The same rule `voiceChord` applies to pitch classes, applied here to the
 * stack before it gets there - which is what makes this the fix that satisfies
 * that function's precondition rather than one that works around it. See the
 * last section of `chordPitchClasses`' note for why an octave is free and why a
 * duplicate is lifted rather than dropped.
 */
function liftIntoAscent(notes: readonly number[]): number[] {
  const ascending: number[] = [];

  for (const note of notes) {
    let lifted = note;
    // `ascending` is empty only on the first note, which has nothing to clear.
    // Read through `at` rather than by index arithmetic so the empty case is
    // `undefined` rather than `notes[-1]`, which reads the same and says less.
    const previous = ascending.at(-1);
    if (previous !== undefined) {
      while (lifted <= previous) lifted += 12;
    }
    ascending.push(lifted);
  }

  return ascending;
}

/**
 * The quality a slot is *named* by: the name of the chord it actually builds.
 *
 * `null` means "as the key gives it", so every reader wanting a name rather
 * than an override has this same line to write - and writing it twice is how
 * two parts of one screen come to disagree about one chord. The strip's card
 * and the fretboard selection are the two that want it today.
 *
 * ## Why it names the chord rather than repeating the override
 *
 * It used to be `quality ?? degreeQuality(...)`, which is the override's own
 * name and not the chord's, and the two are different in both directions:
 *
 *  - **Below the override's height.** A `major7` chosen while the slot is still
 *    a triad builds a plain major triad - the extent decides the note count -
 *    and the card printed `Imaj7` over three notes.
 *  - **Above it.** A `major` chosen at extent 7 keeps the key's own seventh, so
 *    bVII in C major is Bb-D-F-A. `chordPitchClasses`' note calls that a
 *    decision rather than an accident, and the spec below names the chord that
 *    comes out of it a Bb major seventh - while the card printed `B♭ Maj`.
 *
 * Neither is a near miss. The first prints a seventh over a triad, the second a
 * triad over a seventh, and both are the label disagreeing with the synth about
 * one chord on one card. So the name is read off the chord, through the same
 * pair of functions that already read the naming in both directions: build the
 * stack, then ask what it is. Two readings of one arithmetic cannot drift the
 * way two tables can, which is the argument `QUALITY_INTERVALS` is built on.
 *
 * At the height the override itself names - a triad at extent 3, a seventh at
 * extent 7 - the answer is always the override, unchanged, over every scale the
 * app offers and every `alter` the model stores. The user's own choice is never
 * contradicted; only the notes the override deliberately left to the key can
 * move the name.
 *
 * ## The two qualities it will not build
 *
 * **`'other'` is answered with itself.** It names no interval set, so there is
 * no chord to build and read back - `chordPitchClasses` refuses it outright.
 * `'other'` *is* the honest name for a stack that is no named chord, so handing
 * it straight back is the answer rather than a fallback.
 *
 * **A null quality is answered from the key**, without building anything. That
 * is what `null` means, and it also sidesteps the one pair `chordPitchClasses`
 * throws on: a chromatic root with no shape under it. The pair is refused at
 * the door by `normalizeChordDegree`, so a stored slot cannot carry it, and
 * naming is not the place to discover that it did.
 *
 * A stack that no name fits comes back as `'other'` even though an override
 * asked for something else, and that is the intended answer rather than a gap:
 * the numeral prints `?` and the fretboard lights nothing, which is what both
 * already do for a diatonic stack with no name. Unlabelled rather than
 * mislabelled is the rule the strip is built on.
 */
export function effectiveQuality(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent,
  alter: number,
  quality: ChordQuality | null
): ChordQuality {
  if (quality === null) return degreeQuality(scaleIntervals, degree, extent);
  if (quality === 'other') return 'other';

  return qualityOfIntervals(
    chordPitchClasses(scaleIntervals, degree, extent, alter, quality)
  );
}

