import {
  ALTER_MAX,
  ALTER_MIN,
  ELEVENTH_ALTERATIONS,
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
  RollNote
} from '../models/progression.model';
import {
  ChordIdentity,
  ChordShape,
  NAMED_QUALITIES,
  NamedQuality,
  chordPitchClasses,
  degreePitchClasses,
  effectiveChord,
  isHeptatonic
} from './progression-harmony';
import {
  ParsedChord,
  nearest,
  parseChord,
  reduce,
  structuralPitchClasses
} from './progression-parse';

/**
 * The `notes -> harmony` arrow: what a hand-edited slot turns out to be.
 *
 * Pure, with no Angular and no store, on the `progression-harmony.ts` and
 * `progression-generate.ts` precedent - it is handed the notes a slot held
 * before an edit and the slot as it stands after one, and answers whether the
 * label still fits, what it should become, or that nothing fits at all. Task 9
 * is what wires it to a gesture; nothing here knows that a gesture exists.
 *
 * This is the *writing* half of that arrow. The reading half - which notes of a
 * slot are the chord, and what chord a set of pitch classes makes over a given
 * root - is `progression-parse.ts`, and the two were one file until the ruling
 * of 2026-09-10 grew the ranking. Everything here turns a reading into a numeral
 * of a key: `expressInKey` writes one identity on one key's degrees, `rank`
 * chooses between the readings a set of notes admits, and `recognise` is the
 * boundary where an absolute MIDI note becomes a degree of something.
 *
 * The alternative to parsing - vary one attribute of the current chord at a time
 * and see which variation matches - is what the design doc's older "Two-way
 * sync" section described, and it cannot see an edit that moves two fields at
 * once. Adding a flat seventh to a `I` moves both `extent` and `quality`, and it
 * is the most common way there is to make a secondary dominant. The locality
 * that approach wanted survives here in the *ranking* instead: an edit is one
 * note, so the chord that keeps the current root is preferred over one that does
 * not, and the numeral the user picked for that root is preferred over its
 * enharmonic twin.
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
 * over four openings and four fifths: **tens of microseconds per call**, over
 * runs of 2000.
 *
 * **The order of magnitude is the claim; the digits are hardware.** Figures from
 * 17 to 34 microseconds have been taken on different machines for the same code,
 * which is a wider spread than any change made to this module has produced - so
 * a number written here is a number about the machine that ran it, and reading
 * one as a baseline to compare against would find a regression in a busy laptop.
 * `progression-recognise.spec.ts` prints its own measurement on every run, and
 * that printout is the figure to read.
 *
 * What the order of magnitude buys is that no caller needs to think about when
 * this runs: `recognise` happens once per pitch gesture, so the budget it has is
 * a pointerup, and tens of microseconds is three orders of magnitude inside it.
 * The whole round-trip sweep in the spec - some 22,000 chords generated,
 * recognised and compared - runs in well under a second, which is the same
 * figure from the other end.
 *
 * The spec asserts only a loose ceiling on the per-call figure, for the reason
 * above: a tight one would be a flaky test on a shared machine rather than a
 * guarantee.
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
 * How many runners-up the chip offers. Three, which is what a menu holds beside
 * *Back to* and *Keep as literal* without becoming a list to read.
 */
const ALTERNATE_COUNT = 3;

/** Where the three extensions sit in a stack of thirds: above the seventh. */
const FIRST_EXTENSION_POSITION = 4;

/** Whether two structural sets hold exactly the same pitch classes. */
function sameSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const member of left) {
    if (!right.has(member)) return false;
  }
  return true;
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
 * **It does not know what the slot was called before, and that is deliberate.**
 * Task 8 calls this with an identity that was never parsed - `effectiveChord` in
 * the key a slot is *leaving* - and wants the new key's own best spelling, not
 * the old key's numeral carried across a modulation. Preferring the numeral a
 * user picked is therefore a clause of the ranking in `recognise`, which is the
 * one caller that knows what the slot already held. See `keptNumeral`.
 */
export function expressInKey(
  identity: ChordIdentity,
  scaleIntervals: readonly number[],
  octave: number,
  bass: number
): ChordDegree | null {
  if (!isHeptatonic(scaleIntervals) || identity.intervals.length === 0) return null;

  for (const candidate of degreeCandidates(identity, scaleIntervals)) {
    const written = atDegree(identity, scaleIntervals, candidate, octave, bass);
    if (written !== null) return written;
  }

  return null;
}

/**
 * This chord written on one named degree, register and all, or null when that
 * degree cannot write it.
 *
 * `writeAt` answers the harmony half and this adds the two register fields, so
 * that the two callers who choose a degree by different means - `expressInKey`,
 * which ranks them, and `keptNumeral`, which is handed one - agree on
 * everything after the choice.
 */
function atDegree(
  identity: ChordIdentity,
  scaleIntervals: readonly number[],
  candidate: { degree: number; alter: number },
  octave: number,
  bass: number
): ChordDegree | null {
  const written = writeAt(identity, scaleIntervals, candidate.degree, candidate.alter);
  if (written === null) return null;

  return {
    ...written,
    inversion: inversionOf(identity, bass),
    octave: Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, octave))
  };
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
 * That is the answer for a chromatic root arriving with no history. A chromatic
 * root that the *user* already named keeps its numeral instead, and that is the
 * ranking's business rather than this function's - a spelling this order would
 * never pick can still win in `rank`. Nothing here changes to make that happen.
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
    // Drops the far degrees; it cannot drop them all. The widest step in any
    // heptatonic scale the app offers is an augmented second, so every pitch
    // class has a degree within one semitone of it and at least one candidate
    // always survives - which is why there is no "no degree can reach this
    // root" fixture in the spec, only the one for a key that cannot stack
    // thirds at all. `progression-recognise.spec.ts` checks that property over
    // the real scale table rather than leaving this comment to be believed.
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
 *
 * ## Why every quality is tried and not only the parse's own
 *
 * `identity.base` is a *preference*, not the answer, and the fix of 2026-09-10
 * is that the list no longer ends there. A parse has no third to read a shape
 * off - that is what a suspension is - so `baseOf` substitutes one, and the
 * shape it substitutes into is not always a shape that has a name. A diminished
 * triad suspended by a second sounds `[0, 2, 6]`; put a major third back in and
 * `[0, 4, 6]` is in no table, so `base` came back `'other'` and the only
 * candidate left was `null`, which builds a perfect fifth and cannot match.
 * Every suspended chord on a diminished shape was therefore unwritable, and the
 * ranking fell through to whatever else the notes admitted - which for
 * `{C, D, G♭}` in C major was a `II7` sounding an A that the slot never played.
 * That is the silent mislabel the design says the app must never produce.
 *
 * Substituting a minor third in `baseOf` instead would only move the hole onto
 * the major and dominant shapes. What closes it is that this function *rebuilds
 * and compares* already: a quality that builds the wrong notes is rejected on
 * the notes, so offering more of them costs correctness nothing. The preference
 * stays at the head of the list, so a chord that could always be written keeps
 * the exact spelling it had, and the widening is only ever reached where the
 * answer used to be `null`.
 */
function writeAt(
  identity: ChordIdentity,
  scaleIntervals: readonly number[],
  degree: number,
  alter: number
): Omit<ChordDegree, 'inversion' | 'octave'> | null {
  for (const quality of qualityCandidates(identity, alter)) {
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
 * Which qualities `writeAt` tries, in order: the two the parse itself argues
 * for, and then every other name there is.
 *
 * The head of the list is the whole of the old behaviour and decides every
 * chord that could already be written - `null` where the key gives the shape
 * outright, then the shape the parse read. The tail is only ever reached after
 * both have been rebuilt and rejected, so it can add answers and cannot change
 * one.
 *
 * The tail is not as wasteful as its length suggests, either. At extent 3 a
 * four-note quality is cut to its own triad, so several entries build the same
 * three notes and the first of them settles it; and a candidate is only tried
 * at all on a degree the preference has already failed on.
 */
function qualityCandidates(identity: ChordIdentity, alter: number): (NamedQuality | null)[] {
  const preferred: (NamedQuality | null)[] = [];
  if (alter === 0) preferred.push(null);
  if (identity.base !== 'other') preferred.push(identity.base);

  return [...preferred, ...NAMED_QUALITIES.filter(quality => !preferred.includes(quality))];
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
  /** Whether this reading is the numeral the slot already carried. See `rank`. */
  kept: boolean;
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

  const written = slot.harmony.kind === 'degree' ? slot.harmony.degree : null;
  const current = written === null ? null : effectiveChord(scaleIntervals, written);

  const bass = bassOf(slot.notes, after);
  const ranked = rank(after, key, scaleIntervals, bass, current?.root ?? null, written);

  if (ranked.length === 0) {
    // A slot that was already unrecognised and still is has not changed. The
    // caller would write the harmony it already holds, and the chip would
    // announce a degradation that happened some edits ago.
    return slot.harmony.kind === 'literal' ? { kind: 'unchanged' } : { kind: 'literal' };
  }

  const best = ranked[0];
  if (written !== null && sameHarmony(best.degree, written)) {
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
 * The order is the design doc's, with one clause added by the ruling of
 * 2026-09-10, and its first two are deliberately the reverse of an earlier draft
 * that broke ties on the bass first:
 *
 *  1. **Complete before incomplete.** A chord whose fifth was actually sounding
 *     beats one whose fifth this module supplied.
 *  2. **Keeps the current root.** Proximity, and it has to come before the bass:
 *     the four inversions of a diminished seventh are one chord, so a `vii°7`
 *     re-voiced onto each of its notes in turn must not be relabelled four ways.
 *  3. **Spells that root the way the slot already spelled it.** ♯I and ♭II are
 *     one root written twice and notes carry no letters, so a user who picked
 *     ♯I off the palette gets ♯I back; only a chord whose root actually *moved*
 *     is renumbered. See `keptNumeral` for why this is a clause here rather than
 *     an argument to `expressInKey`.
 *  4. **Its root is the bass.** What decides a chord with no current root to
 *     stay near - a literal slot finding its way back.
 *  5. **Most fields `null`.** The reading that leaves the most to the key is the
 *     one that survives a key change best.
 *  6. **Lowest extent.** Do not read a taller chord than the notes require.
 *
 * `C6` against `Am7` comes out the way the design's older section wanted without
 * a rule of its own: both are complete, both leave `quality` unpinned on one
 * side or the other, and clause 2 gives each slot its own root - `I` plus an A
 * is `I6`, `vi` plus a G is `vi7`.
 *
 * Clause 3 cannot reach past the two above it, and that is structural rather
 * than lucky. It is only ever set on a reading of the root the previous numeral
 * *names*, and a root has one parse, so the readings it separates are two
 * spellings of one identity - alike on `complete`, alike on the current root,
 * alike on the bass. A previous numeral naming some other root scores clause 3
 * on a reading that has already lost clause 2 to any reading that keeps the
 * root, so it wins only where nothing keeps the root at all.
 *
 * Roots are tried in ascending order and `Array.prototype.sort` is stable, so
 * two parses alike on all six clauses come back in a fixed order rather than
 * an engine-dependent one. Nothing depends on *which* order; the sweep depends
 * on there being one.
 */
function rank(
  pitchClasses: ReadonlySet<number>,
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  bassMidi: number | null,
  currentRoot: number | null,
  currentDegree: ChordDegree | null
): readonly Ranked[] {
  const bass = bassMidi === null ? null : reduce(bassMidi - key.tonic);
  const octave =
    bassMidi === null ? 0 : Math.floor((bassMidi - VOICING_BASE_MIDI) / 12);

  const relative = new Set([...pitchClasses].map(pitchClass => reduce(pitchClass - key.tonic)));
  const candidates: Ranked[] = [];

  for (const root of [...relative].sort((left, right) => left - right)) {
    const identity = parseChord(relative, root);
    if (identity === null) continue;

    const from = bass ?? identity.root;
    const kept = keptNumeral(identity, scaleIntervals, currentDegree, octave, from);
    if (kept !== null) candidates.push({ degree: kept, identity, kept: true });

    // The ordinary spelling is kept in the list beside it rather than replaced:
    // where the two differ they are two numerals for one chord, and the loser is
    // exactly what the chip should offer a user who did want the other one.
    const degree = expressInKey(identity, scaleIntervals, octave, from);
    if (degree === null) continue;
    if (kept !== null && degree.degree === kept.degree && degree.alter === kept.alter) continue;

    candidates.push({ degree, identity, kept: false });
  }

  // Scored once each rather than inside the comparator, which would rebuild the
  // same six numbers on every comparison. The first five are better when
  // larger and the last when smaller, so the extent is negated and one loop
  // covers all six.
  const scored = candidates.map(candidate => ({
    candidate,
    score: [
      candidate.identity.complete ? 1 : 0,
      currentRoot !== null && candidate.identity.root === currentRoot ? 1 : 0,
      candidate.kept ? 1 : 0,
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
 * This chord written on the numeral the slot already carried, or null where that
 * numeral is not a name for this chord's root.
 *
 * **The ruling of 2026-09-10: keep the numeral the user picked.** A root that the
 * key does not contain has two numerals - ♯I and ♭II in C are one pitch class -
 * and a `RollNote` carries a pitch, not a letter, so nothing in the notes can
 * say which the user meant. What can say is the label the slot is still
 * carrying. A user who picked ♯I off the palette, moved a note and moved it back
 * keeps ♯I; only a chord whose root actually moved is renumbered.
 *
 * The test is on the root and on nothing else. The numeral has to *name* this
 * root - `scaleIntervals[degree] + alter`, the pitch class the palette's own
 * spelling puts it on - and everything above the root is then re-read from the
 * notes as usual, so an edit that turns a ♯I into a ♯I7 still says so. A
 * previous numeral that names some other root is no evidence about this one and
 * returns null.
 *
 * Here rather than in `expressInKey` because `expressInKey` has one other caller
 * with the opposite need: Task 8 re-expresses a slot across a key change, hands
 * it an identity from the key being left, and must get the *new* key's own best
 * spelling rather than the old key's numeral. Only `recognise` knows that the
 * label it is holding describes the same key the notes are being read in.
 */
function keptNumeral(
  identity: ParsedChord,
  scaleIntervals: readonly number[],
  current: ChordDegree | null,
  octave: number,
  bass: number
): ChordDegree | null {
  if (current === null) return null;
  // The same range `degreeCandidates` filters on, for the same reason: a numeral
  // outside it is one `normalizeChordDegree` would clamp on the way back into
  // the store, and a clamped numeral names a different root from the one that
  // was checked here.
  if (current.alter < ALTER_MIN || current.alter > ALTER_MAX) return null;
  if (reduce(scaleIntervals[current.degree] + current.alter) !== identity.root) return null;

  return atDegree(identity, scaleIntervals, current, octave, bass);
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
