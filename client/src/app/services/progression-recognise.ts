import {
  ALTER_MAX,
  ALTER_MIN,
  ELEVENTH_ALTERATIONS,
  MIN_NOTE_BEATS,
  NINTH_ALTERATIONS,
  OCTAVE_MAX,
  OCTAVE_MIN,
  THIRTEENTH_ALTERATIONS,
  VOICING_BASE_MIDI,
  createExtensions
} from '../models/progression-normalize';
import type {
  ChordDegree,
  ChordSlot,
  ExtensionAlterations,
  ProgressionKey,
  RollNote,
  SuspensionKind
} from '../models/progression.model';
import {
  ChordExtent,
  ChordIdentity,
  ChordQuality,
  ChordShape,
  NamedQuality,
  chordPitchClasses,
  degreePitchClasses,
  effectiveChord,
  identityOfStack,
  isHeptatonic,
  qualityOfIntervals
} from './progression-harmony';

/**
 * The `notes -> harmony` arrow: what a hand-edited slot turns out to be.
 *
 * Pure, with no Angular and no store, on the `progression-harmony.ts` and
 * `progression-generate.ts` precedent - it is handed the notes a slot held
 * before an edit and the slot as it stands after one, and answers whether the
 * label still fits, what it should become, or that nothing fits at all. Task 9
 * is what wires it to a gesture; nothing here knows that a gesture exists.
 *
 * `generateSlotNotes` is the arrow this one runs backwards, and the two are
 * deliberately not each other's inverse in code: this module does not search
 * the space that one generates. It **parses**. Each pitch class the slot sounds
 * structurally is tried as a root, the intervals above it are read as a third or
 * a suspension, a fifth, a seventh or an added tone and then the extensions, and
 * an interval left over means no chord from that root. Seven parses at most,
 * each linear in the notes.
 *
 * The alternative - vary one attribute of the current chord at a time and see
 * which variation matches - is what the design doc's older "Two-way sync"
 * section described, and it cannot see an edit that moves two fields at once.
 * Adding a flat seventh to a `I` moves both `extent` and `quality`, and it is
 * the most common way there is to make a secondary dominant. The locality that
 * approach wanted survives here in the *ranking* instead: an edit is one note,
 * so the chord that keeps the current root is preferred over one that does not.
 *
 * ## The three answers
 *
 * `unchanged` when the notes that matter did not move, when the user has
 * detached the slot by hand, or when the best parse is the label the slot
 * already carries. `relabel` when a different chord fits, with the runners-up
 * for the chip to offer. `literal` when nothing fits - the slot keeps every note
 * and loses its numeral, which is the rule the whole strip is built on:
 * unlabelled rather than mislabelled.
 *
 * ## Before against after, never against the label
 *
 * The quiet test compares the structural pitch classes *before* the edit with
 * those *after* it, and not against what `harmony` currently generates. That is
 * the design doc's own correction and it is load-bearing: timing edits never run
 * the recogniser, so they can change which notes are structural without anything
 * re-reading the slot. Compare against the label and the next passing tone
 * dropped onto that slot relabels it, on the strength of a note the user moved
 * two gestures ago. `ignores a passing tone after a timing edit` in the spec is
 * that case exactly.
 *
 * ## Speed
 *
 * Measured on 2026-09-10, Chrome headless, on a `Imaj13♯11` - the widest chord
 * the model builds, seven notes and so seven roots to try, each backtracking
 * over four openings and four fifths: **about 17 microseconds per call**, over
 * runs of 2000. `recognise` happens once per pitch gesture, so the budget it has
 * is a pointerup, and it is three orders of magnitude inside it. The whole
 * round-trip sweep below - some 13,000 chords generated, recognised and
 * compared - runs in a quarter of a second, which is the same figure from the
 * other end.
 *
 * The figure is re-measured by `progression-recognise.spec.ts`, which asserts
 * only a loose ceiling: a tight one would be a flaky test on a shared machine,
 * and what the number is for is to say that no caller needs to think about when
 * this runs.
 *
 * ## The frame everything here is in
 *
 * Tonic-relative, like `progression-harmony.ts` and unlike `RollNote.midi`. A
 * pitch class in this module is semitones above the key's tonic, so a
 * `ChordIdentity.root` of 7 is the dominant in every key.
 *
 * `recognise` is the one function that crosses that boundary, and it is the
 * reason it takes a `ProgressionKey` where the plan's signature had only the
 * scale. A MIDI note carries no tonic; a scale's intervals are already
 * tonic-relative and cannot supply one. Without the key nothing here could turn
 * a sounding note into a degree of anything, and putting the key any further in
 * would mean two frames in one file. `expressInKey` genuinely does not need it -
 * every number it touches is already relative - which is what lets Task 8 hand
 * it an identity from a *different* key's `effectiveChord` and get the same
 * chord re-spelled.
 */

/**
 * What the recogniser makes of an edit.
 *
 * `relabel` carries the alternates with it rather than leaving the caller to
 * ask again: they are the same ranking, already computed, and recomputing them
 * for the chip would mean parsing a second time against notes that may have
 * moved on.
 */
export type Recognition =
  | { kind: 'unchanged' }
  | { kind: 'relabel'; degree: ChordDegree; alternates: readonly ChordDegree[] }
  | { kind: 'literal' };

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
 * How many runners-up the chip offers. Three, which is what a menu holds beside
 * *Back to* and *Keep as literal* without becoming a list to read.
 */
const ALTERNATE_COUNT = 3;

/** Where the three extensions sit in a stack of thirds: above the seventh. */
const FIRST_EXTENSION_POSITION = 4;

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
function reduce(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * A displacement read as the nearer of its two representatives, -6..5: the same
 * reading `progression-harmony.ts` gives an alteration, for the same reason. An
 * `alter` of -1 and one of +11 are the same root.
 */
function nearest(displacement: number): number {
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
 * the rest of the module works in.
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
    if (note.startBeat < MIN_NOTE_BEATS) structural.add(pitchClass);

    const end = Math.min(note.startBeat + Math.max(0, note.lengthBeats), lengthBeats);
    const inside = end - note.startBeat;
    if (inside > 0) sounding.set(pitchClass, (sounding.get(pitchClass) ?? 0) + inside);
  }

  for (const [pitchClass, beats] of sounding) {
    if (beats >= threshold) structural.add(pitchClass);
  }

  return structural;
}

/** Whether two structural sets hold exactly the same pitch classes. */
function sameSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const member of left) {
    if (!right.has(member)) return false;
  }
  return true;
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
 * produces - and a suspension replaces the third whichever shape supplied it, so
 * both answers build the same chord. Every name the user sees is rendered from
 * `effectiveChord` on the stored degree, after the fact.
 */
function baseOf(stack: readonly number[], suspension: SuspensionKind): ChordQuality {
  if (suspension === 'none') return qualityOfIntervals(stack);
  return qualityOfIntervals([stack[0], 4, ...stack.slice(2)]);
}

// ---------------------------------------------------------------------------
// Expressing a parse in the key
// ---------------------------------------------------------------------------

/**
 * A chord written as a degree of this key, or null when this key cannot write
 * it.
 *
 * The identity is what a chord *is*; a `ChordDegree` is how this key spells it.
 * Three questions, in this order:
 *
 *  1. **Which degree the root belongs to** - `degreeCandidates`, which is where
 *     the ordering and its two worked examples are argued.
 *  2. **Which fields can be left `null`.** `null` means "as the key gives it",
 *     and a recognised `ii` that stores `quality: null` re-voices on a key
 *     change exactly as a palette `ii` does - which is the whole reason the
 *     recogniser writes degrees rather than notes. So the chord is *rebuilt* at
 *     each candidate setting and compared with what was parsed: nothing is
 *     pinned that the key already agrees with, and nothing is left unpinned that
 *     the key would get wrong.
 *  3. **Where the bass is.** The inversion is the bass's position in the built
 *     stack, and the octave is the one whose voicing base the bass sits on.
 *
 * Returning null rather than forcing a spelling is the same refusal the rest of
 * this page makes: a chord whose root is more than a whole tone from every
 * degree, or whose shape has no name to override with, is honestly not
 * expressible in this key, and `literal` is what the caller does about it.
 *
 * Task 8 calls this with an identity that was never parsed - `effectiveChord` in
 * the key a slot is leaving - which is why it takes the interface rather than a
 * `ParsedChord`.
 */
export function expressInKey(
  identity: ChordIdentity,
  scaleIntervals: readonly number[],
  octave: number,
  bass: number
): ChordDegree | null {
  if (!isHeptatonic(scaleIntervals) || identity.intervals.length === 0) return null;

  for (const candidate of degreeCandidates(identity, scaleIntervals)) {
    const written = writeAt(identity, scaleIntervals, candidate.degree, candidate.alter);
    if (written === null) continue;

    return {
      ...written,
      inversion: inversionOf(identity, bass),
      octave: Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, octave))
    };
  }

  return null;
}

/**
 * Every degree this root could be written on, best first.
 *
 * The whole list rather than the winner, because a degree can win the spelling
 * and then fail to build - an override whose shape has no name, an extension
 * outside what a `ChordDegree` may store - and falling through to the next
 * spelling is a better answer than degrading a chord the key can perfectly well
 * write.
 *
 * ## The order, and where it departs from the design doc
 *
 * **Nearest first, then shared notes, then the flat side.** The doc gives shared
 * notes and then the flat side, and that pair alone puts a plain diatonic chord
 * on somebody else's numeral in two different ways:
 *
 *  - `Imaj13` in C major sounds all seven notes of the key, so it ties with
 *    *every* degree on shared notes at any height a comparison is taken at - a
 *    thirteenth chord is the whole scale, and at the triad `I`, `♭♭II` and
 *    `♯vii` each share their three. The flat side alone then writes it `♭♭II`.
 *  - `V9sus4` has no third, so the subdominant triad shares three of its notes
 *    where the dominant's shares two, and shared notes alone writes a chord
 *    rooted on the dominant as the subdominant raised a whole tone.
 *
 * Both are chords the model never displaced, and the fix is the clause the doc
 * leaves implicit: a root that *is* a degree is written on that degree. Shared
 * notes then do the work the doc describes them doing, which is choosing between
 * the two degrees a genuinely chromatic root sits equally far from - and both of
 * the doc's own worked examples are exactly that case, so both still come out as
 * it says. D♭ major in C is a semitone from the tonic and a semitone from the
 * supertonic, and it shares its F with the diatonic ii; C♯ diminished is the
 * same two semitones away and shares its E and its G with the diatonic I.
 *
 * The comparison is taken at the **triad**, which is where the degrees of a
 * scale are furthest apart. Taking it at the chord's own height would make the
 * clause vacuous exactly where the chord is tall enough to need it.
 */
function degreeCandidates(
  identity: ChordIdentity,
  scaleIntervals: readonly number[]
): readonly { degree: number; alter: number }[] {
  const sounding = new Set(identity.intervals.map(interval => reduce(identity.root + interval)));
  const candidates: { degree: number; alter: number; shared: number }[] = [];

  for (let degree = 0; degree <= 6; degree++) {
    const alter = nearest(identity.root - scaleIntervals[degree]);
    if (alter < ALTER_MIN || alter > ALTER_MAX) continue;

    const triad = degreePitchClasses(scaleIntervals, degree, 3);
    const shared = triad.filter(note => sounding.has(reduce(note))).length;
    candidates.push({ degree, alter, shared });
  }

  return candidates.sort(
    (left, right) =>
      Math.abs(left.alter) - Math.abs(right.alter) ||
      right.shared - left.shared ||
      left.alter - right.alter
  );
}

/**
 * The harmony fields of a `ChordDegree` that builds exactly this chord on this
 * degree, or null when none does.
 *
 * `null` before the override, because "as the key gives it" is the answer that
 * survives a key change and the one the ranking counts. It is only available on
 * a diatonic root - `chordPitchClasses` refuses a displaced root with no shape
 * under it, and `normalizeChordDegree` refuses to store the pair - so a borrowed
 * chord always carries its quality, exactly as the numeral's accidental implies.
 */
function writeAt(
  identity: ChordIdentity,
  scaleIntervals: readonly number[],
  degree: number,
  alter: number
): Omit<ChordDegree, 'inversion' | 'octave'> | null {
  const qualities: (NamedQuality | null)[] = [];
  if (alter === 0) qualities.push(null);
  if (identity.base !== 'other') qualities.push(identity.base);

  for (const quality of qualities) {
    const shape: ChordShape = {
      degree,
      alter,
      extent: identity.extent,
      quality,
      suspension: identity.suspension,
      extensions: createExtensions()
    };

    const extensions = fitExtensions(scaleIntervals, shape, identity);
    // `quality` again on the way out, narrowed: `ChordShape` widens the field to
    // take `'other'` and a `ChordDegree` may not store one.
    if (extensions !== null) return { ...shape, quality, extensions };
  }

  return null;
}

/**
 * The extension record that makes this shape build this chord, or null when no
 * storable one does.
 *
 * Nothing is pinned first, because every pin is a field the key can no longer
 * move. Only a position the key gets *wrong* is pinned, and only to the
 * alteration the identity already read off that position - so the ninth of a
 * recognised `V9` stays `null` and re-voices with the key, while the ninth of a
 * `V7♭9` is pinned because nothing else would sound it.
 *
 * The whole chord is rebuilt and compared after the pins go on rather than the
 * pinned positions being checked one by one. A replacement can land under the
 * note beneath it and `liftIntoAscent` then raises it an octave, which moves a
 * position nobody pinned; only the finished stack says whether the record is
 * right.
 *
 * An alteration the identity read but a `ChordDegree` cannot store - a
 * diminished eleventh, which no chart writes a figure for - fails here rather
 * than being rounded to the nearest one it can store. That is the enumerated-set
 * clause of the normalisation rule, applied one step before the guard: rounding
 * would hand back a degree that builds a different chord from the one the user
 * played.
 */
function fitExtensions(
  scaleIntervals: readonly number[],
  shape: ChordShape,
  identity: ChordIdentity
): ExtensionAlterations | null {
  const target = identity.intervals;
  const plain = buildIntervals(scaleIntervals, shape);
  if (sameIntervals(plain, target)) return createExtensions();

  // Each extension asked for in turn: the alteration the identity read off that
  // position, or `null` where the key already put the right note there. The
  // three are named rather than indexed, so an extension added to
  // `ExtensionAlterations` is a compile error here rather than a position this
  // function quietly stops covering - the device `sameDegree` and
  // `normalizeRollNote` both use.
  const ninth = pinOf(0, plain, target, identity.ninth, NINTH_ALTERATIONS);
  const eleventh = pinOf(1, plain, target, identity.eleventh, ELEVENTH_ALTERATIONS);
  const thirteenth = pinOf(2, plain, target, identity.thirteenth, THIRTEENTH_ALTERATIONS);
  if (ninth === REFUSED || eleventh === REFUSED || thirteenth === REFUSED) return null;

  const pinned: ExtensionAlterations = { ninth, eleventh, thirteenth };
  const built = buildIntervals(scaleIntervals, { ...shape, extensions: pinned });
  return sameIntervals(built, target) ? pinned : null;
}

/**
 * The refusal, as a value: an alteration this chord needs and a `ChordDegree`
 * cannot store. Distinct from `null`, which means the key already agrees.
 */
const REFUSED = Symbol('no storable alteration');

/**
 * What to pin at one extension position: `null` where the key already sounds
 * the right note there, the alteration where it does not, and `REFUSED` where
 * the alteration wanted is outside what the model may store.
 */
function pinOf<T extends number>(
  index: number,
  plain: readonly number[],
  target: readonly number[],
  read: number | null,
  storable: readonly T[]
): T | null | typeof REFUSED {
  const position = FIRST_EXTENSION_POSITION + index;
  if (position >= target.length) return null;
  if (plain[position] === target[position]) return null;

  const alteration = storable.find(candidate => candidate === read);
  return alteration ?? REFUSED;
}

/** The chord a shape builds, as intervals above its own root. */
function buildIntervals(scaleIntervals: readonly number[], shape: ChordShape): number[] {
  const stack = chordPitchClasses(scaleIntervals, shape);
  return stack.map(note => note - stack[0]);
}

function sameIntervals(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((note, i) => note === right[i]);
}

/**
 * Which note of the chord is in the bass, as an inversion.
 *
 * The first position holding that pitch class, which matters where a stack
 * sounds one pitch class twice - a sus4 under an eleventh - and there the lower
 * of the two is the one a listener hears as the bass note of that voicing. A
 * bass that is no chord tone at all reads as root position, which is the honest
 * answer: the inversion says which chord tone is lowest, and none is.
 */
function inversionOf(identity: ChordIdentity, bass: number): number {
  const position = identity.intervals.findIndex(
    interval => reduce(identity.root + interval) === reduce(bass)
  );
  return position < 0 ? 0 : position;
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

/** A parse, its expression in the key, and what the ranking sorts them on. */
interface Ranked {
  degree: ChordDegree;
  identity: ParsedChord;
}

/**
 * What a slot has become, given the notes it held before the edit.
 *
 * `slot` is the slot **after** the edit and still carrying its old label, which
 * is what makes the comparison possible: `before` says what was sounding and the
 * harmony says what it was called.
 *
 * The key is here and nowhere else in this module. `RollNote.midi` is absolute
 * and everything downstream of this function is tonic-relative, so this is the
 * boundary, and passing the key past it would mean two frames in one file.
 *
 * Quiet in four cases, and each is a different kind of nothing-happened:
 *
 *  - **The slot is `user-detached`.** The user said this slot is notes and not a
 *    chord. Re-reading it would take that back on their behalf, and there would
 *    be no way to say it again that the next edit did not undo.
 *  - **The key cannot stack thirds.** There is no degree to express anything as,
 *    so there is nothing to say. Degrading to literal instead would punish a
 *    slot for the key it is in.
 *  - **The structural notes did not move.** A voicing change - an octave, an
 *    inversion, a doubling - is not a harmony change, and this is the test that
 *    knows the difference without consulting the label.
 *  - **The best parse is the label the slot already carries**, ignoring
 *    inversion and octave, which are register rather than harmony. The user
 *    inverted a chord; it is the same chord.
 */
export function recognise(
  before: readonly RollNote[],
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[]
): Recognition {
  if (slot.harmony.kind === 'literal' && slot.harmony.reason === 'user-detached') {
    return { kind: 'unchanged' };
  }
  if (!isHeptatonic(scaleIntervals)) return { kind: 'unchanged' };

  const after = structuralPitchClasses(slot.notes, slot.lengthBeats);
  if (sameSet(structuralPitchClasses(before, slot.lengthBeats), after)) {
    return { kind: 'unchanged' };
  }

  const current =
    slot.harmony.kind === 'degree'
      ? effectiveChord(scaleIntervals, slot.harmony.degree)
      : null;

  const bass = bassOf(slot.notes, after);
  const ranked = rank(after, key, scaleIntervals, bass, current?.root ?? null);

  if (ranked.length === 0) {
    // A slot that was already unrecognised and still is has not changed. The
    // caller would write the harmony it already holds, and the chip would
    // announce a degradation that happened some edits ago.
    return slot.harmony.kind === 'literal' ? { kind: 'unchanged' } : { kind: 'literal' };
  }

  const best = ranked[0];
  if (slot.harmony.kind === 'degree' && sameHarmony(best.degree, slot.harmony.degree)) {
    return { kind: 'unchanged' };
  }

  return {
    kind: 'relabel',
    degree: best.degree,
    alternates: ranked.slice(1, 1 + ALTERNATE_COUNT).map(candidate => candidate.degree)
  };
}

/**
 * The lowest note carrying a structural pitch class, or null when the slot is
 * silent.
 *
 * The structural set rather than the notes outright, so a sixteenth grace note
 * under the chord does not decide the inversion of a chord it is not part of.
 */
function bassOf(notes: readonly RollNote[], structural: ReadonlySet<number>): number | null {
  let lowest: number | null = null;
  for (const note of notes) {
    if (!structural.has(reduce(note.midi))) continue;
    if (lowest === null || note.midi < lowest) lowest = note.midi;
  }
  return lowest;
}

/**
 * Every chord these notes could be, best first.
 *
 * The order is the design doc's, and its first two clauses are deliberately the
 * reverse of an earlier draft that broke ties on the bass first:
 *
 *  1. **Complete before incomplete.** A chord whose fifth was actually sounding
 *     beats one whose fifth this module supplied.
 *  2. **Keeps the current root.** Proximity, and it has to come before the bass:
 *     the four inversions of a diminished seventh are one chord, so a `vii°7`
 *     re-voiced onto each of its notes in turn must not be relabelled four ways.
 *  3. **Its root is the bass.** What decides a chord with no current root to
 *     stay near - a literal slot finding its way back.
 *  4. **Most fields `null`.** The reading that leaves the most to the key is the
 *     one that survives a key change best.
 *  5. **Lowest extent.** Do not read a taller chord than the notes require.
 *
 * `C6` against `Am7` comes out the way the design's older section wanted without
 * a rule of its own: both are complete, both leave `quality` unpinned on one
 * side or the other, and clause 2 gives each slot its own root - `I` plus an A
 * is `I6`, `vi` plus a G is `vi7`.
 *
 * Roots are tried in ascending order and `Array.prototype.sort` is stable, so
 * two parses alike on all five clauses come back in a fixed order rather than
 * an engine-dependent one. Nothing depends on *which* order; the sweep depends
 * on there being one.
 */
function rank(
  pitchClasses: ReadonlySet<number>,
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  bassMidi: number | null,
  currentRoot: number | null
): readonly Ranked[] {
  const bass = bassMidi === null ? null : reduce(bassMidi - key.tonic);
  const octave =
    bassMidi === null ? 0 : Math.floor((bassMidi - VOICING_BASE_MIDI) / 12);

  const relative = new Set([...pitchClasses].map(pitchClass => reduce(pitchClass - key.tonic)));
  const candidates: Ranked[] = [];

  for (const root of [...relative].sort((left, right) => left - right)) {
    const identity = parseChord(relative, root);
    if (identity === null) continue;

    const degree = expressInKey(identity, scaleIntervals, octave, bass ?? identity.root);
    if (degree === null) continue;

    candidates.push({ degree, identity });
  }

  // Scored once each rather than inside the comparator, which would rebuild the
  // same five numbers on every comparison. The first four are better when
  // larger and the last when smaller, so the extent is negated and one loop
  // covers all five.
  const scored = candidates.map(candidate => ({
    candidate,
    score: [
      candidate.identity.complete ? 1 : 0,
      currentRoot !== null && candidate.identity.root === currentRoot ? 1 : 0,
      bass !== null && candidate.identity.root === bass ? 1 : 0,
      nullCount(candidate.degree),
      -candidate.degree.extent
    ]
  }));

  scored.sort((left, right) => {
    for (let i = 0; i < left.score.length; i++) {
      if (left.score[i] !== right.score[i]) return right.score[i] - left.score[i];
    }
    return 0;
  });

  return scored.map(entry => entry.candidate);
}

/**
 * How many of a degree's four "as the key gives it" fields are still `null`.
 *
 * The quality and the three extensions, and nothing else: those are the fields
 * that mean *the key decides*, and leaving one of them null is what lets a
 * recognised chord re-voice on a key change. `suspension` and `alter` are not
 * among them - neither has a `null`, and `'none'` and `0` are values rather than
 * deferrals.
 */
function nullCount(degree: ChordDegree): number {
  const fields = [
    degree.quality,
    degree.extensions.ninth,
    degree.extensions.eleventh,
    degree.extensions.thirteenth
  ];
  return fields.filter(field => field === null).length;
}

/**
 * Whether two degrees name the same chord, ignoring register.
 *
 * `inversion` and `octave` are left out because the recogniser derives both from
 * where the notes happen to sit, and a chord moved up an octave or turned onto
 * its third is the same chord. Every other field is compared, and they are
 * listed rather than spread so that a field added to `ChordDegree` is a compile
 * error here rather than one this comparison quietly stops covering.
 */
function sameHarmony(left: ChordDegree, right: ChordDegree): boolean {
  const compared: Record<keyof Omit<ChordDegree, 'inversion' | 'octave'>, boolean> = {
    degree: left.degree === right.degree,
    alter: left.alter === right.alter,
    extent: left.extent === right.extent,
    quality: left.quality === right.quality,
    suspension: left.suspension === right.suspension,
    extensions:
      left.extensions.ninth === right.extensions.ninth &&
      left.extensions.eleventh === right.extensions.eleventh &&
      left.extensions.thirteenth === right.extensions.thirteenth
  };

  return Object.values(compared).every(same => same);
}
