import { MIN_NOTE_BEATS } from '../models/progression-normalize';
import type { RollNote, SuspensionKind } from '../models/progression.model';
import {
  ChordExtent,
  ChordIdentity,
  ChordQuality,
  identityOfStack,
  qualityOfIntervals
} from './progression-harmony';

/**
 * Reading notes: what a slot is sounding, and what chord that is.
 *
 * The first half of the `notes -> harmony` arrow, and the half that takes no
 * view of the key. `structuralPitchClasses` says which of a slot's notes are the
 * chord and which are passing; `parseChord` reads a set of pitch classes as a
 * stack of thirds over a given root, or refuses. Neither knows what a degree is.
 *
 * `progression-recognise.ts` is the other half - writing a reading into a key,
 * and choosing between readings - and it was one file with this one until the
 * ruling of 2026-09-10 grew the ranking past what the two together could hold
 * under the 1000-line cap. The seam is the one the file already had a section
 * rule across: everything here is spelled in semitones over an arbitrary root,
 * and nothing here can produce a `ChordDegree`. A caller wanting a numeral wants
 * `expressInKey` or `recognise`, both of which are built on this.
 *
 * `generateSlotNotes` is the arrow this one runs backwards, and the two are
 * deliberately not each other's inverse in code: this module does not search
 * the space that one generates. It **parses**. Each pitch class the slot sounds
 * structurally is tried as a root, the intervals above it are read as a third or
 * a suspension, a fifth, a seventh or an added tone and then the extensions, and
 * an interval left over means no chord from that root. Seven parses at most,
 * each linear in the notes.
 *
 * ## The frame everything here is in
 *
 * A pitch class in `parseChord` is whatever frame its caller counts in - the
 * function only ever subtracts one from another - while `structuralPitchClasses`
 * is absolute, because `RollNote.midi` is. `recognise` is the one function that
 * crosses between the two, and it is the only one that holds a key.
 */

/**
 * A chord read off a set of notes: a `ChordIdentity` and the one thing a
 * *reading* knows that a chord does not.
 *
 * The plan asked for `ParsedChord` and `ChordIdentity` to be one type if they
 * could be, on the project rule against two declarations of one concept, and
 * they very nearly are: every field describing the chord is `ChordIdentity`'s,
 * inherited rather than restated, so a `ParsedChord` is a `ChordIdentity`
 * everywhere one is wanted - `expressInKey` takes the interface and Task 8 hands
 * it one that was never parsed at all.
 *
 * `complete` is the exception and it is not a field about the chord. A chord
 * either has a fifth or does not; this says whether the fifth was **sounding**,
 * which is a fact about the notes the parse was given. The parse fills an absent
 * perfect fifth in, because a chord with a hole in it cannot be built back and
 * "I7 minus its G is still I7" is the behaviour the design asks for - and then
 * the ranking has to know which parses guessed. Putting the flag on
 * `ChordIdentity` would make every caller of `effectiveChord` answer a question
 * about a reading it never did.
 */
export interface ParsedChord extends ChordIdentity {
  /** Whether the fifth was actually sounding, or was filled in by the parse. */
  complete: boolean;
}

/**
 * What share of a slot a pitch class must sound for to count as structural.
 *
 * A quarter, and the threshold is a decision with a cost either way. At a
 * quarter an eighth-note arpeggio keeps every chord tone, a sixteenth passing
 * tone drops out, and a quarter-note passing tone in a four-beat slot sits
 * exactly on the line and counts. Tightening it to a third loses the tones of a
 * quarter-note arpeggio, which is the worse error: a chord played as an arpeggio
 * is still that chord, where a chord with a passing tone read into it is a
 * different chord.
 */
const STRUCTURAL_SHARE = 4;

/**
 * Slack on the threshold above, for the boundary case it is chosen to include.
 *
 * Beats on this page are dyadic - the roll's floor is `MIN_NOTE_BEATS`, one
 * sixteenth - so a quarter-note arpeggio's 1.0 against a four-beat slot's 1.0 is
 * exact and needs none of this. It is here for the sums that are not: three
 * triplet eighths of a beat each are 0.333... and their sum is not the number a
 * reader would write down. A pitch class within a nanobeat of the line is a coin
 * flip either way, and this makes it land on the side the threshold was chosen
 * for.
 */
const STRUCTURAL_EPSILON = 1e-9;

/**
 * Stack height to extent - the inverse of `noteCount`, which the spec pins.
 *
 * Written as a table rather than derived, because the inverse of `(n + 1) / 2`
 * is `2n - 1` everywhere except the triad, where `extent` is the note count
 * itself. One special case in a formula reads worse than five rows.
 */
const EXTENT_BY_LENGTH: Readonly<Record<number, ChordExtent>> = {
  3: 3,
  4: 7,
  5: 9,
  6: 11,
  7: 13
};

/**
 * What may fill position 1 of a stack, in preference order: a major third, a
 * minor third, a suspended fourth, a suspended second.
 *
 * A chord with a third is not a suspended chord, which is why the two thirds
 * come first - but the preference is only a preference, because every one of
 * these four intervals has a second job. A 3 over a major third is a ♯9, a 5 is
 * an eleventh, a 2 is a ninth, and a 4 is nothing else at all. So the list is
 * *tried* rather than *chosen*: harmonic minor's `vi` suspended at extent 9
 * sounds a ♯9 that a third-first reading takes for the third and then strands
 * the fourth, and the same chord read as the suspension it is consumes every
 * note. See `parseChord`.
 */
const OPENINGS: readonly { position1: number; suspension: SuspensionKind }[] = [
  { position1: 4, suspension: 'none' },
  { position1: 3, suspension: 'none' },
  { position1: 5, suspension: 'sus4' },
  { position1: 2, suspension: 'sus2' }
];

/**
 * What may fill position 2, in preference order: a perfect fifth, a diminished
 * one, an augmented one, and `null` for a fifth that is not sounding at all.
 *
 * Tried rather than chosen, for `OPENINGS`' reason: six is a ♭5 and it is also a
 * ♯11, eight is a ♯5 and it is also a ♭13, and which is which depends on what
 * else the chord turns out to hold. An augmented seventh on a displaced root can
 * sound both a six and an eight - a ♯5 under a ♯11 - and a fifth read
 * first-come would take the six and strand the eight.
 *
 * `null` is last because the fifth is filled in when it is absent and the
 * ranking prefers the parses that did not have to. Reaching it while a real
 * fifth is sounding cannot produce a parse: that interval would then be left
 * over, and a leftover is a refusal.
 */
const FIFTHS: readonly (number | null)[] = [7, 6, 8, null];

/** Reduces to 0-11, for pitch classes arrived at by subtraction. */
export function reduce(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * A displacement read as the nearer of its two representatives, -6..5: the same
 * reading `progression-harmony.ts` gives an alteration, for the same reason. An
 * `alter` of -1 and one of +11 are the same root.
 */
export function nearest(displacement: number): number {
  return reduce(displacement + 6) - 6;
}

// ---------------------------------------------------------------------------
// What the slot is sounding
// ---------------------------------------------------------------------------

/**
 * The pitch classes a slot sounds *structurally*: those at the downbeat, plus
 * any sounding for at least a quarter of the slot.
 *
 * Absolute pitch classes, 0-11 from C, because `RollNote.midi` is absolute and
 * this function has no key. `recognise` moves them into the tonic-relative frame
 * the rest of the reading works in.
 *
 * Two rules rather than one, and each catches what the other misses. The
 * downbeat rule keeps the chord of a slot whose notes are all short - a stab, a
 * staccato comp - where a duration rule alone would find nothing structural at
 * all and degrade every such slot to literal. The duration rule keeps the tones
 * of an arpeggio, where a downbeat rule alone would keep only the first.
 *
 * **Time past the slot's end does not count.** A note may legitimately hang over
 * - `retimeNotes` leaves one there through a resize deliberately - and counting
 * the overhang would let a note that is mostly in the *next* slot decide this
 * one's chord. Each note is clipped to the slot before its time is summed.
 *
 * Overlapping notes of one pitch class are summed rather than unioned, so a
 * doubled octave held for half the slot reaches the threshold on its own. That
 * is the right way round for a recogniser: doubling a note is emphasis, and
 * emphasis is what the threshold is trying to measure.
 */
export function structuralPitchClasses(
  notes: readonly RollNote[],
  lengthBeats: number
): Set<number> {
  const threshold = lengthBeats / STRUCTURAL_SHARE - STRUCTURAL_EPSILON;
  const structural = new Set<number>();
  const sounding = new Map<number, number>();

  for (const note of notes) {
    const pitchClass = reduce(note.midi);

    // `MIN_NOTE_BEATS` is the shortest note the roll can draw, so a note that
    // starts inside one is a note that starts on the beat as far as anything
    // the user can express is concerned. A bare `=== 0` would miss a note
    // nudged by a single grid step and read the chord without it.
    //
    // A length of its own is required as well, because this clause is about
    // emphasis and a note of no length is not sounding at all. Without it a
    // zero-length note at beat 0 - a degenerate note the normaliser's floor
    // keeps out of the store, but which nothing stops a caller handing this
    // function directly - would decide the slot's chord on its own.
    if (note.startBeat < MIN_NOTE_BEATS && note.lengthBeats > 0) structural.add(pitchClass);

    const end = Math.min(note.startBeat + Math.max(0, note.lengthBeats), lengthBeats);
    const inside = end - note.startBeat;
    if (inside > 0) sounding.set(pitchClass, (sounding.get(pitchClass) ?? 0) + inside);
  }

  for (const [pitchClass, beats] of sounding) {
    if (beats >= threshold) structural.add(pitchClass);
  }

  return structural;
}

// ---------------------------------------------------------------------------
// The parse
// ---------------------------------------------------------------------------

/**
 * The chord these pitch classes make when read from this root, or null when
 * they make none.
 *
 * The intervals above the root are consumed in the order a stack of thirds is
 * built, and each rung takes the one note it can take:
 *
 *  - **Position 1** is a 4, else a 3, else a 5 as a sus4, else a 2 as a sus2 -
 *    `OPENINGS`. Nothing there is no chord: there would be nothing to put in the
 *    second position of a stack, and a power chord is not something this model
 *    can express.
 *
 *    **This is the one rung that is tried more than one way**, because it is the
 *    one where every candidate has a second job. Over a major third a 3 is a ♯9;
 *    a 5 is an eleventh; a 2 is a ninth. So the four are a preference and not a
 *    choice: harmonic minor's `vi` suspended at extent 9 sounds a ♯9 that a
 *    third-first reading takes for the third and then strands the fourth, and E
 *    phrygian's `iii` suspended by a second at extent 11 sounds both its F♯ and
 *    its F. Each parses from exactly one opening and from no other. Everywhere
 *    above position 1 a note has one role it could be playing, so nothing else
 *    here backtracks.
 *  - **The fifth** is a 7, else a 6 (♭5) or an 8 (♯5). Absent is allowed, and
 *    is the *only* omission allowed: a perfect fifth is filled in, `complete`
 *    goes false, and the ranking prefers the parses that did not guess. With a
 *    7 present a 6 is a ♯11 and an 8 is a ♭13 instead.
 *  - **The fourth note** is a 10 or an 11; a 9 over a ♭5 and a minor third is a
 *    diminished seventh, and any other 9 is an added sixth. A 2 here, with no
 *    seventh under it, is an added ninth - the `add9` shapes, whose fourth note
 *    is neither.
 *  - **The extensions** are a ninth (1, 2 or 3), then an eleventh (5 or 6), then
 *    a thirteenth (9 or 8). A 5 is an eleventh anywhere but under a sus4, where
 *    the suspension has already spent it.
 *
 * **Every rung needs the one below it.** An eleventh with no ninth and no
 * seventh is not an eleventh chord, and the note is left unconsumed - which
 * makes it a leftover, and **any interval left over means no parse from this
 * root**. That refusal is the whole of what stops this function naming a
 * cluster: `C C♯ D` leaves something over from all three of its roots.
 *
 * A parse is not a search and takes no view of the key. `expressInKey` is what
 * turns one into something a slot can store.
 */
export function parseChord(
  pitchClasses: ReadonlySet<number>,
  root: number
): ParsedChord | null {
  if (!pitchClasses.has(reduce(root))) return null;

  const intervals = new Set<number>();
  for (const pitchClass of pitchClasses) intervals.add(reduce(pitchClass - root));
  intervals.delete(0);

  for (const opening of OPENINGS) {
    if (!intervals.has(opening.position1)) continue;

    const above = new Set(intervals);
    above.delete(opening.position1);

    for (const fifth of FIFTHS) {
      if (fifth !== null && !above.has(fifth)) continue;

      const rest = new Set(above);
      if (fifth !== null) rest.delete(fifth);

      const parsed = parseAbove(rest, opening, fifth, root);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

/**
 * The rest of a parse, given position 1 and the fifth: the fourth note, the
 * extensions, and whether anything was left over.
 *
 * Separate from `parseChord` only so that the two ambiguous rungs below it can
 * be tried more than one way. Everything from here up is forced.
 */
function parseAbove(
  rest: Set<number>,
  opening: { position1: number; suspension: SuspensionKind },
  chosenFifth: number | null,
  root: number
): ParsedChord | null {
  const { position1, suspension } = opening;
  const complete = chosenFifth !== null;
  const fifth = chosenFifth ?? 7;

  const stack = [0, position1, fifth];
  // A perfect eleventh and a suspended fourth are one pitch class, and a set
  // holds each only once - so under a sus4 the 5 has already been spent and
  // there is none left to be an eleventh. Under a sus2 there is: a stack
  // suspended by a second still reaches its own eleventh, and E phrygian's
  // `iiisus2` at extent 11 sounds F♯ and F at once, the suspension and the
  // eleventh. That chord is why this is a test on the suspension rather than on
  // whether a third is present, which is what it was first written as - and
  // under which it parsed as nothing at all.
  const elevenIsFree = suspension !== 'sus4';

  // The fourth note, which is a seventh, a sixth or a ninth.
  //
  // A 9 is one branch and not two, though it is a diminished seventh over a ♭5
  // and a minor third and an added sixth everywhere else. The distinction is
  // real and it is made by the shape rather than here: [0, 3, 6, 9] reads back
  // as `diminished7` and [0, 4, 7, 9] as `major6`, off the one table both
  // directions of the naming already share. Branching here would be a second
  // statement of it, and the letter each is spelled on - a seventh against a
  // sixth, B♭♭ against A - already follows the base rather than the interval.
  //
  // `addedNinth` is tracked because that one occupies the position an extension
  // would: a stack whose fourth note is already a ninth can carry nothing above
  // it, and anything left over is a leftover.
  let addedNinth = false;
  if (rest.delete(10)) stack.push(10);
  else if (rest.delete(11)) stack.push(11);
  else if (rest.delete(9)) stack.push(9);
  else if (rest.delete(2)) {
    stack.push(14);
    addedNinth = true;
  }

  if (stack.length === 4 && !addedNinth) {
    // A suspension sounds an extension's pitch class as well as its own: the
    // sus2 at position 1 is the natural ninth an octave down, and the sus4 is
    // the natural eleventh. So a suspended chord tall enough to reach that
    // extension sounds the same pitch class twice and a set holds it once, and
    // a ladder that insisted on seeing it separately would refuse every
    // suspended eleventh and thirteenth the model can build. The note is there;
    // it is only the octave that has been lost, and an octave is a register.
    //
    // Implied only where something *above* it is waiting, so that a plain
    // `7sus2` is not quietly grown into a `9sus2` with no ninth of its own.
    let ninth: number | null = null;
    if (rest.delete(2)) ninth = 14;
    else if (rest.delete(1)) ninth = 13;
    else if (rest.delete(3)) ninth = 15;
    else if (suspension === 'sus2' && (rest.has(5) || rest.has(6))) ninth = 14;

    if (ninth !== null) {
      stack.push(ninth);

      let eleventh: number | null = null;
      if (elevenIsFree && rest.delete(5)) eleventh = 17;
      else if (rest.delete(6)) eleventh = 18;
      else if (suspension === 'sus4' && (rest.has(9) || rest.has(8))) eleventh = 17;

      if (eleventh !== null) {
        stack.push(eleventh);

        if (rest.delete(9)) stack.push(21);
        else if (rest.delete(8)) stack.push(20);
      }
    }
  }

  if (rest.size > 0) return null;

  const extent = EXTENT_BY_LENGTH[stack.length];
  const identity = identityOfStack(root, stack, suspension, baseOf(stack, suspension), extent);
  return { ...identity, complete };
}

/**
 * The shape a suspended chord is a suspension *of*.
 *
 * `effectiveChord` answers this by rebuilding the stack from the key with the
 * suspension taken out, and gets the key's own third back. A parse has no third
 * to get back - that is what a suspension is - so it substitutes a major one and
 * reads the shape above it. So a `7sus4` is a `dominant7` suspended and a plain
 * `sus4` is a `major` suspended, which is what the figures on a chart mean.
 *
 * The two therefore disagree about a suspended chord on a minor degree: this
 * calls a `iisus4` a suspended major where `effectiveChord` calls it a suspended
 * minor. Nothing reads both. `base` here feeds `expressInKey` and only
 * `expressInKey`, which uses it as a *quality override* and checks the notes it
 * produces; every name the user sees is rendered from `effectiveChord` on the
 * stored degree, after the fact.
 *
 * **This used to argue that the disagreement was harmless** - that a suspension
 * replaces the third whichever shape supplied it, so both answers build the same
 * chord. That is false, and it was false in the one direction that matters. A
 * major third substituted into a flattened fifth gives `[0, 4, 6]`, which is in
 * no table, so this returns `'other'` for exactly the stacks `effectiveChord`
 * calls `diminished` - and `'other'` is not a name that can be written back.
 * `augmented` survives only by luck, because `[0, 4, 8]` happens to be named.
 *
 * Substituting a minor third instead would move the same hole onto the major and
 * dominant shapes, so the answer is not here at all: `writeAt` treats this as
 * the first candidate rather than the only one, and rebuilds the notes to check.
 * What is written above is a preference, and this note says so instead of
 * claiming a correctness it does not have.
 */
function baseOf(stack: readonly number[], suspension: SuspensionKind): ChordQuality {
  if (suspension === 'none') return qualityOfIntervals(stack);
  return qualityOfIntervals([stack[0], 4, ...stack.slice(2)]);
}
