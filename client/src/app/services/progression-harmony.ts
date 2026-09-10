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
 *
 * ## The one import, and why it is erased
 *
 * `ChordShape` below is `ChordDegree` minus its register, taken as a `Pick`
 * rather than written out again, so the fields M3 added to a chord -
 * `suspension` and `extensions` - are declared once, beside that interface in
 * `progression.model.ts`. The model already imports `ChordExtent` and
 * `NamedQuality` from this file the same way, so the cycle is closed, and it
 * exists for the type checker and nowhere else: an `import type` is erased, and
 * this module keeps no runtime dependency on the model at all. That is the
 * device `progression-normalize.ts` documents against the same file.
 */

import type { ChordDegree, SuspensionKind } from '../models/progression.model';

/**
 * The rules in `degreeQuality` produce no name that is not in this list, and
 * `'other'` is the honest answer for a stack of thirds that is not a named
 * chord at all.
 *
 * ## Twelve of these used to be chord ids, and nothing leans on that now
 *
 * Every name here except the four added-tone shapes is also a chord id in
 * `music-theory.service.ts`, and the fretboard used to lean on the coincidence:
 * it was lit by handing the quality straight to `selectKeyAndMode` as an id.
 * The four added-tone shapes broke it in two places - `major6` is `'6'` there
 * and `minorAdd9` is `'minor_add9'` - and a composed name breaks it altogether,
 * because `V7♭9` is a name no single quality holds.
 *
 * M3 Task 5 stopped leaning rather than bending four names into ids. The
 * fretboard is lit by `findChordByIntervals` from `ChordIdentity.intervals`, so
 * what is lit is the interval set the chord was actually built from - which
 * lights every entry the chord table holds rather than the twelve whose names
 * happened to match, and lights nothing at all for a set it does not hold.
 */
export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'major7' | 'minor7' | 'dominant7' | 'minorMajor7'
  | 'halfDiminished7' | 'diminished7' | 'augmented7' | 'augmentedMajor7'
  | 'major6' | 'minor6' | 'add9' | 'minorAdd9'
  | 'other';

/**
 * `ChordQuality` minus `'other'`, which is a refusal rather than a name - the
 * answer for a stack of thirds that is no named chord - so it has no interval
 * set and cannot be an override. Splitting it off keys `QUALITY_INTERVALS`
 * exhaustively on the qualities that *do* name intervals, so a quality added to
 * the union above cannot compile until its intervals are written down.
 *
 * It is also what `ChordDegree.quality` is typed as, which makes the refusal a
 * compile-time impossibility rather than only a runtime one: that field holds
 * an override, and the value with no shape to override with can no longer be
 * written into it. It could be, and had to be, while `regenerateSlot` wrote the
 * derived *label* into the same field.
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
 * Triads name three intervals and every four-note shape names four, and **every
 * four-note shape opens with the triad of the same name** - which is what lets
 * `chordPitchClasses` take one only as far as a triad's height without
 * producing some other chord. The augmented pair earns its place there:
 * harmonic minor's III+ carries a major seventh and the Neapolitans put a minor
 * seventh over the same augmented triad, so without both the augmented triads
 * this module already finds would lose their name on extension.
 *
 * No two entries share a shape, which is what makes the reverse reading a
 * function rather than a first match.
 *
 * ## The four added-tone shapes, and why they are qualities rather than heights
 *
 * `major6`, `minor6`, `add9` and `minorAdd9` join at M3. They are four-note
 * chords that are not sevenths - the fourth note is a sixth or a ninth - so
 * they have no other home: `extent` is a count of stacked thirds and neither an
 * added sixth nor an added ninth is one.
 *
 * Both invariants above hold across them, and both had to be checked rather
 * than assumed. `major6` and `add9` open with `major`, `minor6` and `minorAdd9`
 * with `minor`, so a `major6` chosen while a slot is still a triad is cut back
 * to the C major triad it is built on rather than to some other chord. And the
 * four shapes are distinct from each other and from all twelve above: the
 * sevenths put 10 or 11 in the fourth position, these put 9 or 14, and the two
 * pairs are told apart by their third.
 *
 * A `major6` at extent 9 builds a 6/9 with no rule of its own - the shape gives
 * the first four notes and the scale's own ninth sits on top - which is the
 * whole argument for widening the table here rather than listing named extended
 * chords in it. See "The chord model grows three ways, all through `null`".
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
  augmentedMajor7: [0, 4, 8, 11],
  major6: [0, 4, 7, 9],
  minor6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  minorAdd9: [0, 3, 7, 14]
};

/** The table above as a list, typed once so the lookup below need not cast. */
const QUALITY_TABLE = Object.entries(QUALITY_INTERVALS) as [
  NamedQuality,
  readonly number[]
][];

/**
 * The runtime twin of `NamedQuality`, for the guard that has to check a stored
 * value against the union at a point where the union no longer exists.
 *
 * Derived from `QUALITY_INTERVALS` rather than written out, so it cannot fall
 * behind the type: that table is keyed exhaustively on `NamedQuality`, so a
 * quality added to the union has to appear there before anything compiles, and
 * appearing there puts it here.
 *
 * It is the *named* qualities and not the whole of `ChordQuality`, because
 * `'other'` is the one member the table cannot hold and the one member a
 * `ChordDegree` cannot store: the field is an override, and `'other'` names no
 * shape to override with. It was storable while `regenerateSlot` wrote the
 * derived label into that field; nothing writes one now, so the model's type
 * narrowed to `NamedQuality | null` and this list is what enforces it.
 *
 * `CHORD_EXTENTS` is the same device one field over, and lives beside the guard
 * that reads it rather than beside its union; this one lives beside its union
 * because deriving it needs the table.
 */
export const NAMED_QUALITIES: readonly NamedQuality[] =
  Object.keys(QUALITY_INTERVALS) as NamedQuality[];

/**
 * The name for a stack of notes, from its intervals above its own root.
 *
 * Takes the notes as `degreePitchClasses` returns them - ascending, not reduced
 * mod 12, rooted wherever the chord happens to sit - and reads the intervals
 * relative to the first, so a Bb chord written [10, 14, 17] is major on exactly
 * the terms [0, 4, 7] is. A stack four notes tall or more is named from its
 * first four - its seventh, or its added sixth or ninth - which is the
 * convention `ChordDegree.quality` already stores a ninth under; below four,
 * only the third and the fifth are read.
 *
 * `'other'` is the honest answer for a stack that is no named chord - degree 6
 * of the double harmonic scale stacks a second under a diminished fifth - and
 * it is a refusal rather than a name. That is why `chordPitchClasses` will not
 * take it back the other way as an override.
 */
export function qualityOfIntervals(notes: readonly number[]): ChordQuality {
  const root = notes[0];
  // Four is the widest entry the table holds, and a taller stack is named after
  // its first four - so everything above the fourth note is dropped rather than
  // compared against a table that has no entry that tall.
  const width = notes.length >= 4 ? 4 : 3;
  const shape = notes.slice(0, width).map(note => note - root);

  for (const [quality, intervals] of QUALITY_TABLE) {
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
 * Everything about a chord that decides which notes it sounds, and nothing
 * else: a `ChordDegree` without its `inversion` or its `octave`, which are
 * register rather than harmony and belong to `voiceChord`.
 *
 * A `Pick` rather than a second interface listing the same six fields, on the
 * project rule against two declarations of one concept: a field added to
 * `ChordDegree` that changes what a chord *is* joins this type by being added
 * there, and a field renamed there fails to compile here.
 *
 * One field is widened rather than picked. `quality` is `ChordQuality` where
 * the model narrowed it to `NamedQuality | null`, because the model's field
 * holds a stored *override* and `'other'` names no shape to override with,
 * while this function is also called with hand-built shapes and keeps the
 * runtime refusal its docstring documents. Widening rather than narrowing is
 * what keeps a `ChordDegree` assignable to this without a cast.
 *
 * It is an object rather than six positional arguments because six positional
 * arguments of which four are numbers is where a caller starts getting the
 * order wrong silently. Every caller already holds a `ChordDegree`, so the
 * object costs them nothing.
 */
export type ChordShape =
  Pick<ChordDegree, 'degree' | 'alter' | 'extent' | 'suspension' | 'extensions'> & {
    quality: ChordQuality | null;
  };

/**
 * The natural interval of each extension above the root: a major ninth, a
 * perfect eleventh, a major thirteenth. Indexed by the position each occupies
 * in a stack of thirds, which is 4, 5 and 6 - the notes above the seventh.
 *
 * These are the *chord's* naturals rather than the *scale's*, and that is the
 * whole of what an alteration is measured from. The scale's own ninth on
 * `V/vi` in C major is an F, a flat ninth off the key; a `ninth: 0` asks for
 * the F♯ that is a major ninth above E, which is the chord the design doc
 * records as unbuildable before this field existed.
 */
const EXTENSION_NATURALS: readonly number[] = [14, 17, 21];

/** Where the ninth, eleventh and thirteenth sit in a stack of thirds. */
const FIRST_EXTENSION_POSITION = 4;

/**
 * Pitch classes of the chord a slot names: the diatonic stack, with its root
 * displaced by `alter`, its shape overridden by `quality`, its third replaced
 * by a `suspension` and its extensions moved by `extensions`.
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
 *
 * ## Four steps, in this order
 *
 * M3 adds two of them, and the order between all four is the whole of what they
 * mean:
 *
 *  1. **The diatonic stack, with the quality override mapped over it** - the
 *     rule above, unchanged.
 *  2. **The suspension replaces position 1** with `root + 2` or `root + 5`.
 *     Position 1 rather than "the third", because after step 1 the note there
 *     may be an override's third rather than the key's; and measured from the
 *     *root* the shape gave, so a sus4 on a displaced root is a fourth above
 *     that root rather than above the degree it displaced. It replaces at every
 *     height, which is what makes `7sus4` and `9sus4` fall out with no rule of
 *     their own.
 *  3. **Each non-null extension replaces its position** - 4, 5, 6 - with
 *     `root + EXTENSION_NATURALS[...] + alteration`, and only where that
 *     position exists at this extent. That is `extent` staying the single
 *     height control: a `ninth: -1` on a triad pins nothing and adds nothing,
 *     because a triad has no ninth to pin.
 *  4. **`liftIntoAscent`**, as before, over the result. It has more to do now:
 *     a sus4 at extent 11 puts the same pitch class in positions 1 and 5, and a
 *     ♭13 measured from a displaced root can land under the eleventh below it.
 *
 * A suspension and an extension can therefore both be true of one chord and
 * neither cancels the other: `sus4` at extent 11 sounds the fourth twice, an
 * octave apart. Dropping the duplicate is the same wrong fix the lift's note
 * refuses above, for the same reason - the note count is what two other things
 * are derived from.
 */
export function chordPitchClasses(
  scaleIntervals: readonly number[],
  shape: ChordShape
): number[] {
  const { degree, extent, alter, quality, suspension, extensions } = shape;
  const diatonic = degreePitchClasses(scaleIntervals, degree, extent);

  // Copied rather than returned or mutated: this used to hand the diatonic
  // array straight back, and the steps below write into what they are given.
  let stacked = [...diatonic];
  let root = diatonic[0];

  if (quality === null) {
    if (alter !== 0) {
      throw new Error(
        `A chromatic root needs an explicit quality to build from; ` +
          `got alter ${alter} with no quality`
      );
    }
  } else if (quality === 'other') {
    throw new Error(
      `'other' names no interval set and cannot override a chord's shape`
    );
  } else {
    const intervals = QUALITY_INTERVALS[quality];
    root = diatonic[0] + alter;
    // Mapped over the diatonic stack rather than concatenated onto the shape,
    // which is what keeps the count the extent's in both directions: the shape
    // is read while it lasts, and every position past it keeps the scale's own
    // note.
    stacked = diatonic.map((note, i) => (i < intervals.length ? root + intervals[i] : note));
  }

  if (suspension !== 'none') {
    stacked[1] = root + (suspension === 'sus2' ? 2 : 5);
  }

  const alterations: readonly (number | null)[] = [
    extensions.ninth,
    extensions.eleventh,
    extensions.thirteenth
  ];
  alterations.forEach((alteration, i) => {
    const position = FIRST_EXTENSION_POSITION + i;
    // An extension the extent does not reach is not there to alter. This is the
    // guard that keeps `extent` the single height control rather than letting a
    // pinned thirteenth quietly make a triad seven notes tall.
    if (alteration === null || position >= stacked.length) return;
    stacked[position] = root + EXTENSION_NATURALS[i] + alteration;
  });

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
 * Where each note of a stack of thirds sits as a *letter*, counted from the
 * root: a third is two letters up, a seventh six, a ninth one.
 *
 * Indexed by position in the stack, which is why it runs 0 2 4 6 1 3 5 rather
 * than 0 1 2 3 4 5 6 - the extensions are the same three letters as the ninth,
 * eleventh and thirteenth's own second, fourth and sixth, an octave higher, and
 * `spellAt` reduces the count mod 7 anyway. Two positions read a different
 * letter and both are named below: position 1 under a suspension, and position 3
 * under an added-tone shape.
 *
 * Semitones cannot settle this and that is the whole reason it is written down.
 * Nine semitones above the root is a *sixth* in a `major6` and a *seventh* in a
 * `diminished7`, and the two are spelled on different letters - A against B♭♭ on
 * a C root - so a chord tone spelled from its interval alone is spelled wrong
 * about a third of the time in the shapes M3 added.
 */
const STACK_STEPS: readonly number[] = [0, 2, 4, 6, 1, 3, 5];

/**
 * What position 1 is a letter-wise, once a suspension has replaced it: a second
 * under `sus2` and a fourth under `sus4`, where a third would be a third.
 */
const SUSPENSION_STEPS: Readonly<Record<SuspensionKind, number>> = {
  none: 2,
  sus2: 1,
  sus4: 3
};

/**
 * The four shapes whose fourth note is not a seventh, and the letter it is
 * instead: a sixth for the two sixth chords, a ninth for the two added ninths.
 *
 * Keyed on the *base*, which is read off the built stack, so a shape truncated
 * back to its triad never reaches here - there is no fourth note to name.
 */
const ADDED_TONE_STEPS: Readonly<Partial<Record<ChordQuality, number>>> = {
  major6: 5,
  minor6: 5,
  add9: 1,
  minorAdd9: 1
};

/** Reduces to 0-11, for a stack that was deliberately never reduced. */
function reduceToOctave(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * A displacement read as the nearer of its two representatives, -6..5.
 *
 * The same reading `spellAt` gives an accidental, and here for the same kind of
 * reason: `liftIntoAscent` may have raised an extension by an octave to keep the
 * stack ascending, and an octave is a register rather than a pitch. A ♭13 that
 * was lifted over the eleventh below it is still a ♭13, and reading the raw
 * difference would call it an alteration of +11 and refuse to name the chord.
 */
function nearestAlteration(displacement: number): number {
  return ((((displacement + 6) % 12) + 12) % 12) - 6;
}

/**
 * What a chord is, independent of the key it is written in: the thing both the
 * name and the fretboard are read off, so the two cannot disagree.
 *
 * It carries the *built* chord rather than the stored one, for the reason
 * `effectiveChord` argues at length. Nothing here is a `ChordDegree` field
 * repeated: `base` is what the stack turned out to be and not what was asked
 * for, the three alterations are measured against the chord's own naturals
 * rather than read out of `extensions`, and `intervals` and `steps` are the
 * notes themselves.
 */
export interface ChordIdentity {
  /** The root, relative to the tonic, 0-11. */
  root: number;
  /** The triad, seventh or added-tone shape; `'other'` when no name fits. */
  base: ChordQuality;
  suspension: SuspensionKind;
  extent: ChordExtent;
  /** Semitones above the root, ascending, as built. What the fretboard is lit by. */
  intervals: readonly number[];
  /** Alteration from natural of each extension present; null when absent. */
  ninth: number | null;
  eleventh: number | null;
  thirteenth: number | null;
  /** Letter steps above the root, per interval. What chord tones are spelled by. */
  steps: readonly number[];
}

/**
 * The alterations a name exists for, per extension.
 *
 * The unions in `progression.model.ts` say what a user may *pin*; this says what
 * can be *read back*, and the two are not the same list because an extension is
 * also whatever the key put there. An exotic scale can stack a ninth an octave
 * above its own root, which is neither a ♭9 nor a ♯9 nor a 9 - there is no
 * figure for it, so the chord has no composed name and comes back `'other'`.
 */
const NAMEABLE_ALTERATIONS: readonly (readonly number[])[] = [
  [-1, 0, 1],
  [0, 1],
  [-1, 0]
];

/**
 * The identity of the chord a slot builds: what it is, rather than what it was
 * asked for.
 *
 * `null` means "as the key gives it", so every reader wanting a name rather
 * than an override has this same line to write - and writing it twice is how
 * two parts of one screen come to disagree about one chord. The strip's card,
 * the palette's buttons and the fretboard selection are the three that want it.
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
 * ## Why it returns a chord rather than a quality
 *
 * A quality is one word, and by M3 the model can build chords no single word
 * describes. `effectiveQuality` returned `'other'` for a `Csus4` - `[0, 5, 7]`
 * is no `QUALITY_INTERVALS` shape - and returned `dominant7` for both a V9 and a
 * V7♭9, which is the opposite failure: unlabelled in the first case,
 * *under*-labelled in the second, and the card printing one numeral over two
 * different chords.
 *
 * Both are the same missing layer. The base shape, the suspension, the height
 * and the alterations are four facts about one chord, and a name is composed
 * from all four; squeezing them into a `ChordQuality` loses three of them.
 * `progression-chord-names.ts` does the composing and this function does the
 * reading, which keeps the split the two modules were separated on: the
 * arithmetic here can be checked against a chord table, the typography there
 * against how a chart is printed.
 *
 * **`base` is read with the suspension removed.** A G7sus4's base is
 * `dominant7`, because the chord being suspended is what the figure `7sus4` is
 * built on - and because `[0, 5, 7, 10]` is not a `QUALITY_INTERVALS` entry and
 * never will be: that table holds base shapes only, which is what keeps "no two
 * entries share a shape" true while the combinations live in the composed layer.
 *
 * **The alterations are measured against the chord's own naturals**, 14, 17 and
 * 21, not against the key's - `EXTENSION_NATURALS` argues that - and only where
 * the extent reaches the position. An extension whose alteration is outside the
 * set a figure exists for makes `base` `'other'`, which prints `?` and lights
 * nothing: unlabelled rather than mislabelled, as everywhere else. That is
 * reachable with nothing pinned at all, in a scale whose own ninth lands an
 * octave above the root.
 *
 * **`steps` is what chord tones are spelled by.** See `STACK_STEPS`: nine
 * semitones is a sixth in one shape and a seventh in another, so the interval
 * alone cannot say which letter to write.
 *
 * ## The two qualities it will not build
 *
 * **`'other'` is answered with an identity that names nothing.** It names no
 * interval set, so there is no chord to build and read back -
 * `chordPitchClasses` refuses it outright - and the identity comes back with the
 * degree's own root, an empty interval list and `base` `'other'`. `'other'` *is*
 * the honest name for a stack that is no named chord, so handing it back is the
 * answer rather than a fallback; an empty interval list lights nothing, which is
 * the same answer the numeral's `?` gives.
 *
 * **A null quality over a displaced root is answered from the key**, without
 * building anything, because that pair is the one `chordPitchClasses` throws
 * on: a chromatic root with no shape under it. The pair is refused at the door
 * by `normalizeChordDegree`, so a stored slot cannot carry it, and naming is
 * not the place to discover that it did.
 *
 * A null quality on a *diatonic* root is built and read back, where it used to
 * be answered straight from `degreeQuality`. The two agree by construction on
 * the stack of thirds - `degreeQuality` is `qualityOfIntervals` applied to that
 * same stack - and they stop agreeing the moment M3's two new fields are set:
 * a `Csus4` slot carries `quality: null` and is no major triad. Building is
 * therefore the branch that keeps this function's one promise, which is that
 * the name comes off the chord.
 *
 * A stack that no name fits comes back with `base` as `'other'` even though an
 * override asked for something else, and that is the intended answer rather
 * than a gap: the numeral prints `?`, which is what it already does for a
 * diatonic stack with no name. Unlabelled rather than mislabelled is the rule
 * the strip is built on.
 */
export function effectiveChord(
  scaleIntervals: readonly number[],
  shape: ChordShape
): ChordIdentity {
  if (shape.quality === 'other') return unnameable(scaleIntervals, shape);

  // A null quality over a displaced root is the one pair `chordPitchClasses`
  // refuses, and naming is not the place to discover that a document carried it
  // anyway. Built as the key gives it, without the displacement, which is what
  // `null` means - and which is the answer `effectiveQuality` reached through
  // `degreeQuality`, on the same stack.
  const built: ChordShape =
    shape.quality === null && shape.alter !== 0 ? { ...shape, alter: 0 } : shape;

  const stack = chordPitchClasses(scaleIntervals, built);
  const root = stack[0];
  const intervals = stack.map(note => note - root);

  const base =
    built.suspension === 'none'
      ? qualityOfIntervals(stack)
      : qualityOfIntervals(
          chordPitchClasses(scaleIntervals, { ...built, suspension: 'none' })
        );

  const alterations = EXTENSION_NATURALS.map((natural, i) => {
    const position = FIRST_EXTENSION_POSITION + i;
    if (position >= intervals.length) return null;
    return nearestAlteration(intervals[position] - natural);
  });

  // An extension no figure exists for is a chord no figure exists for. Checked
  // here rather than in the renderer because it is a fact about the notes: the
  // stack really does hold an interval convention has no name for, and three
  // renderers discovering that separately is three chances to disagree.
  const nameable = alterations.every(
    (alteration, i) => alteration === null || NAMEABLE_ALTERATIONS[i].includes(alteration)
  );

  return {
    root: reduceToOctave(root),
    base: nameable ? base : 'other',
    suspension: built.suspension,
    extent: built.extent,
    intervals,
    ninth: alterations[0],
    eleventh: alterations[1],
    thirteenth: alterations[2],
    steps: stepsOf(intervals.length, built.suspension, base)
  };
}

/**
 * The identity of a chord there is nothing to build: `'other'` as a stored
 * quality, which names no interval set.
 *
 * The root is still the degree's own, because the degree is a fact whatever the
 * shape is - the strip prints the numeral from it, and a numeral with no figure
 * still says where in the key the chord sits. Everything else is the refusal.
 */
function unnameable(scaleIntervals: readonly number[], shape: ChordShape): ChordIdentity {
  const diatonic = degreePitchClasses(scaleIntervals, shape.degree, shape.extent);

  return {
    root: reduceToOctave(diatonic[0] + shape.alter),
    base: 'other',
    suspension: shape.suspension,
    extent: shape.extent,
    intervals: [],
    ninth: null,
    eleventh: null,
    thirteenth: null,
    steps: []
  };
}

/**
 * The letter step of each position in a stack this tall: `STACK_STEPS`, with
 * position 1 moved by a suspension and position 3 by an added-tone base.
 *
 * The base decides position 3 and the base is read off the built stack, so a
 * `major6` cut back to its own triad never gets a sixth here - there is no
 * fourth note to spell. A stack with no name at all keeps the plain stack of
 * thirds, which is what its positions are whatever they add up to.
 */
function stepsOf(
  length: number,
  suspension: SuspensionKind,
  base: ChordQuality
): readonly number[] {
  const steps = STACK_STEPS.slice(0, length);

  if (steps.length > 1) steps[1] = SUSPENSION_STEPS[suspension];

  const added = ADDED_TONE_STEPS[base];
  if (added !== undefined && steps.length > 3) steps[3] = added;

  return steps;
}

