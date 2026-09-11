import {
  CHORD_EXTENTS,
  DEFAULT_VELOCITY,
  MIN_NOTE_BEATS,
  VELOCITY_MAX,
  VELOCITY_MIN,
  normalizeChordSlot,
  normalizeProgressionDoc
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ExtensionAlterations,
  ProgressionDoc,
  ProgressionKey,
  RollNote,
  SlotOwnership
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import { ChordExtent } from './progression-harmony';

/**
 * The pure decisions the progression's edit path makes.
 *
 * Split out of `ProgressionService` because none of them is about state: each
 * takes a slot, a degree or a document and hands one back, with no subject, no
 * injection and no history. The service is the funnel that decides *when* they
 * run and what it does with the answers; this is what the answers are,
 * checkable the way `progression-harmony.ts` and `progression-voicing.ts` are.
 *
 * The seam is drawn at Angular rather than at anything arbitrary. The one thing
 * the service knows that this file cannot is which scale a `scaleId` names -
 * that is `MusicTheoryService`, which is injected - so `regenerateSlot` takes
 * the intervals rather than the id, and the service resolves them.
 *
 * `CLAUDE.md` caps a file's length and the service had grown past it, which is
 * what prompted the split - the cap stood at 500 lines then and stands at 1000
 * now, `fda93c1`. The raise does not un-split them: the seam is where it is
 * because everything on this side of it was already the part that was never
 * about state.
 */

/**
 * The rung of the `CHORD_EXTENTS` ladder that `extent` means, or null when it
 * means nothing.
 *
 * The parameter is `number` rather than `ChordExtent` deliberately, because
 * handling values outside that union is the whole of what this function is for
 * and a signature saying otherwise would be a lie about its job. The values do
 * arrive: `CHORD_EXTENTS[5]` and `CHORD_EXTENTS[-1]` are both `undefined` at
 * runtime whatever their static type, and a caller that computed an extent
 * rather than indexing one can produce anything at all.
 *
 * `undefined` and the other non-finite values are refused rather than clamped,
 * because off the top and off the bottom are the same value and there is no end
 * to clamp *toward*. `stepSlotExtent` is what a +/- control should use, and it
 * clamps before it ever gets here - it steps an *index* into the ladder, which
 * has two distinguishable ends where a value has none.
 *
 * A finite value that is simply not a rung snaps to the nearest, which clamps
 * at both ends: 14 and 100 both give 13, 2 and -50 both give 3. A tie resolves
 * low, because the search keeps the rung it has unless a later one is strictly
 * closer.
 */
export function nearestExtent(extent: number): ChordExtent | null {
  if (CHORD_EXTENTS.includes(extent as ChordExtent)) return extent as ChordExtent;
  if (!Number.isFinite(extent)) return null;
  return CHORD_EXTENTS.reduce((best, rung) =>
    Math.abs(rung - extent) < Math.abs(best - extent) ? rung : best
  );
}

/**
 * A continuous control's value, held between its ends - and left alone when it
 * is not a number at all.
 *
 * The finite test is what makes the clamp safe rather than belt and braces.
 * `Math.min(max, Math.max(min, NaN))` is `NaN`, so a clamp written without it
 * passes the one value arithmetic cannot fix straight through the guard meant
 * to catch it - while `Math.max(0, -Infinity)` would *swallow* one, turning a
 * value of the wrong kind into a plausible 0 before `normalizeRollNote` ever
 * sees it. Both are the first clause of the model's rule leaking through the
 * second, so a non-finite value goes on untouched to the guard that throws.
 */
function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Where a note may start within its slot: at the slot's own start, or later.
 *
 * The floor is not taste. `normalizeRollNote` *throws* on a negative
 * `startBeat` - a note before the start of the slot that holds it is outside
 * the slot rather than at the end of it - and a drag that crossed the left edge
 * would abort the whole gesture rather than stop it. Clamping here is what
 * turns that throw into a control resting on its limit.
 *
 * There is no ceiling, deliberately: see `MIN_NOTE_BEATS`, and `retimeNotes`,
 * which leaves a note hanging past a shortened slot on purpose. A ceiling here
 * would quietly drag such a note back inside the next time anything about it
 * moved.
 */
export function boundNoteStart(startBeat: number): number {
  return clampFinite(startBeat, 0, Number.POSITIVE_INFINITY);
}

/** How long a note may be: at least `MIN_NOTE_BEATS`, and open at the top. */
export function boundNoteLength(lengthBeats: number): number {
  return clampFinite(lengthBeats, MIN_NOTE_BEATS, Number.POSITIVE_INFINITY);
}

/**
 * A velocity as the MIDI byte `RollNote.velocity` is documented to be.
 *
 * Rounded as well as clamped, and it is the one field a setter has to make
 * whole itself: `normalizeRollNote` requires `midi` to be an integer and asks
 * only that velocity be finite. A velocity drag produces pixels, and storing
 * 90.6 in a field that names a byte is a document that disagrees with its own
 * type for no gain.
 */
export function boundVelocity(velocity: number): number {
  // No finite check of its own: `Math.round` is the identity on `NaN` and on
  // both infinities, so `clampFinite` below sees them and hands them on.
  return clampFinite(Math.round(velocity), VELOCITY_MIN, VELOCITY_MAX);
}

/**
 * A note the roll drew, held to all of the above.
 *
 * **`midi` is passed through untouched**, and that is a decision rather than an
 * omission - the same one `normalizeRollNote` records for itself.
 *
 * It used to be argued from the transposition: `regenerateSlot` added a
 * `transposeBy` to a claimed pitch after this ran, so a bound here would have
 * guarded one end of a sum whose other end was open. That argument was
 * backwards. Every *term* of that sum was bounded - `keyTransposeInterval`
 * returns -6 to 6 and `regenerateSlot` integer-checks it - and it was the
 * **accumulator** that was open, which is to say `RollNote.midi` itself.
 * Bounding the summand was never the option; bounding the sum was, and
 * `anchoredShift` below is where it is done.
 *
 * What is left is the honest reason, and it is enough on its own: where a pitch
 * drag stops on screen is the roll's geometry to decide, and a clamp here would
 * rewrite a voicing the caller meant - collapsing it onto the ceiling one note
 * at a time, which is exactly the failure `chordOctaveCeiling` refuses to accept
 * for the generator, where it moves the whole chord down an octave instead.
 */
export function boundNote(note: RollNote): RollNote {
  return {
    midi: note.midi,
    startBeat: boundNoteStart(note.startBeat),
    lengthBeats: boundNoteLength(note.lengthBeats),
    velocity: boundVelocity(note.velocity)
  };
}

/**
 * A copy of `notes` with the one at `index` changed, or null when the list
 * holds no such note.
 *
 * Null rather than the list unchanged, so the caller can tell "nothing to do"
 * from "done, and nothing moved" - the first must not open an undo entry and
 * the second may still need to, because a claim is a change even when a number
 * is not.
 *
 * The index is checked for being a whole number as well as in range:
 * `notes[0.5]` is `undefined` at runtime whatever its static type, and a caller
 * that computed an index from a pointer can produce one.
 */
export function replaceNote(
  notes: readonly RollNote[],
  index: number,
  change: (note: RollNote) => RollNote
): RollNote[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= notes.length) return null;

  const next = [...notes];
  next[index] = change(next[index]);
  return next;
}

/**
 * Whether two notes would sound the same.
 *
 * The comparisons are collected into a `Record<keyof RollNote, boolean>` rather
 * than chained, for the reason `sameDegree` gives: a field added to `RollNote`
 * and forgotten here is a compile error rather than an edit this quietly stops
 * noticing - and an edit this fails to notice is one that is never committed.
 */
export function sameNote(a: RollNote, b: RollNote): boolean {
  const matches: Record<keyof RollNote, boolean> = {
    midi: a.midi === b.midi,
    startBeat: a.startBeat === b.startBeat,
    lengthBeats: a.lengthBeats === b.lengthBeats,
    velocity: a.velocity === b.velocity
  };
  return Object.values(matches).every(match => match);
}

/** Whether two note lists hold the same notes in the same order. */
export function sameNotes(a: readonly RollNote[], b: readonly RollNote[]): boolean {
  return a.length === b.length && a.every((note, index) => sameNote(note, b[index]));
}

/** Whether two slots claim the same dimensions. Exhaustive, like `sameNote`. */
export function sameOwnership(a: SlotOwnership, b: SlotOwnership): boolean {
  const matches: Record<keyof SlotOwnership, boolean> = {
    pitches: a.pitches === b.pitches,
    timing: a.timing === b.timing,
    velocity: a.velocity === b.velocity
  };
  return Object.values(matches).every(match => match);
}

/**
 * Whether two degrees would build the same chord.
 *
 * The comparisons are collected into a `Record<keyof ChordDegree, boolean>`
 * rather than chained with `&&`, so that a field added to `ChordDegree` and
 * forgotten here is a compile error rather than a comparison that silently
 * stops noticing an edit - and an edit this fails to notice is one that is
 * never committed.
 */
export function sameDegree(a: ChordDegree, b: ChordDegree): boolean {
  const matches: Record<keyof ChordDegree, boolean> = {
    degree: a.degree === b.degree,
    alter: a.alter === b.alter,
    extent: a.extent === b.extent,
    quality: a.quality === b.quality,
    inversion: a.inversion === b.inversion,
    suspension: a.suspension === b.suspension,
    // A record, so it is compared member by member rather than by reference -
    // two degrees that pin nothing hold two different all-null objects, and by
    // reference every one of them would differ from every other. The three
    // members are named rather than looped for `sameNote`'s reason one level
    // down: an extension added to `ExtensionAlterations` is a compile error
    // here rather than an edit this quietly stops noticing.
    extensions: sameExtensions(a.extensions, b.extensions),
    octave: a.octave === b.octave
  };
  return Object.values(matches).every(match => match);
}

/** Whether two degrees pin the same alteration on each extension. */
function sameExtensions(a: ExtensionAlterations, b: ExtensionAlterations): boolean {
  const matches: Record<keyof ExtensionAlterations, boolean> = {
    ninth: a.ninth === b.ninth,
    eleventh: a.eleventh === b.eleventh,
    thirteenth: a.thirteenth === b.thirteenth
  };
  return Object.values(matches).every(match => match);
}

/**
 * Gives a slot's notes the slot's own length - unless the slot's timing is not
 * the app's to write.
 *
 * Resizing is timing and not harmony. A block chord is one attack filling the
 * slot, so the new length is the only thing about the notes that changes -
 * which means a resize needs no scale, and works in a key that cannot build
 * chords at all. Regenerating from the degree would need one, and would refuse.
 *
 * ## Two kinds of slot are returned untouched, for one reason
 *
 * **A literal slot**, whose notes are the playback truth - the same rule
 * `generateSlotNotes` states by handing a literal slot its own array straight
 * back. Nothing in M1 creates one; M3 does.
 *
 * **A slot that owns its timing**, which is what the roll's `setNoteTiming`
 * writes. This one used to be flattened along with everything else, and the
 * damage that did was *partial*, which is worse than a clean reset rather than
 * better: `startBeat` survived while every `lengthBeats` was overwritten with
 * the slot's, so a hand-written rhythm came back with its onsets intact and
 * every note running into the next. A groove turned into a smear rather than
 * into a block, and a smear does not read as "the app rebuilt this".
 *
 * ## A shortened slot keeps notes that no longer fit
 *
 * Nothing is truncated and nothing is dropped, so a note may start past the new
 * end or run past it. That is deliberate, and it is not only the literal slot's
 * "do not rewrite what the user played" argument again.
 *
 * A resize is a **drag**, and a drag goes both ways. `ProgressionService.commit`
 * coalesces one into a single undo entry, so a rule that discarded on the way in
 * could not be undone by the way out: a pointer that overshoots to two beats and
 * comes back to four would have destroyed the groove in the middle of a gesture
 * that ended exactly where it started, and the only way back would be to undo
 * the whole drag. Keeping the notes makes the gesture reversible by definition.
 *
 * The consequence is audible and is meant to be: a note hanging off a shortened
 * slot sounds over the chord after it, and one hanging off the **last** slot
 * lengthens the progression rather than being cut off by it. `buildSchedule`
 * measures to the last thing that sounds, and its own docstring argues why that
 * is worth a loop longer than the strip draws.
 * `ProgressionService.resetSlotToChord` is the way back to a block.
 */
export function retimeNotes(slot: ChordSlot): ChordSlot {
  if (slot.harmony.kind === 'literal') return slot;
  if (slot.owned.timing) return slot;
  return {
    ...slot,
    notes: slot.notes.map(note => ({ ...note, lengthBeats: slot.lengthBeats }))
  };
}

/**
 * How far a key change moves a voicing the user owns, in semitones.
 *
 * `regenerateSlot` transposes owned pitches by an interval it cannot work out
 * for itself, and `ProgressionService.setKey` is the only caller that can - it
 * is the only one that sees both tonics. This is what it computes with, kept
 * here rather than inline because it is a **rule** and not a subtraction: C to
 * A is +9 and -3, the same chord in two registers, and only one of them is an
 * answer a user would recognise as their chord.
 *
 * ## The nearest of the two, so a voicing stays where it was put
 *
 * The obvious form, `(to - from + 12) % 12`, always runs upward. That is wrong
 * for half the circle: moving the key down a semitone would carry a hand-voiced
 * chord *up* eleven, nearly an octave from where the user left it and quite
 * possibly out of the roll's window. Reading the same pitch class as the nearer
 * of its two representatives keeps every key change inside a tritone, which is
 * the smallest move that still lands on the right note.
 *
 * The alternative - re-voicing the chord from the new key, which is what an
 * *unowned* slot gets - is exactly what owning the pitches asked this code not
 * to do.
 *
 * ## The tritone is a tie, and the tie-break buys a property worth having
 *
 * Six up and six down are the same distance, so no rule about the *interval*
 * can choose between them. This one consults the tonics instead: it moves in
 * the direction the tonic number moved. That is the only place these two
 * arguments are read separately rather than subtracted, and it is what makes
 * the function antisymmetric - `keyTransposeInterval(a, b)` is exactly
 * `-keyTransposeInterval(b, a)` for **every** pair, tritone included.
 *
 * Antisymmetry is the property, not the elegance: a key change and its inverse
 * cancel, so flipping between two keys leaves a claimed voicing where it was.
 * Every other pair cancels for free; the tritone cancels only because of the
 * line below.
 *
 * ## Antisymmetry covers **pairs**, and only pairs
 *
 * This used to be written as though it bounded a claimed voicing outright. It
 * does not, and the gap is not a corner case. A *lap* of the circle is a sum of
 * twelve terms rather than a pair, and no pairwise property constrains a sum:
 * twelve clockwise fifths are twelve moves of -5 and carry a voicing five
 * octaves down, twelve anticlockwise are twelve of +5 and carry it five up, and
 * C to E to G sharp and home is three moves of +4 that gain an octave every lap
 * for as long as the user keeps clicking. Each term is bounded and the
 * accumulator - `RollNote.midi` - was not.
 *
 * The sum is bounded in `mergeNotes` now, by `anchoredShift`, which re-anchors
 * a transposed voicing onto the chord the degree generates in the new key. That
 * makes the whole thing a function of the key rather than of the route taken to
 * it, which is the only shape that can close a cycle - and it means the
 * **octave** of the interval this function returns is no longer observable in
 * what a slot ends up sounding, only its pitch class. The nearest reading is
 * kept regardless: it is the honest answer to "how far did the key move", it is
 * what a reader finding a `transposeBy` in a debugger will expect, and it is
 * what the merge would fall back on if the anchor were ever removed.
 *
 * Both tonics are already whole pitch classes: they come from
 * `normalizeProgressionKey`, which throws on a fractional one and wraps the
 * rest into 0-11. `regenerateSlot` re-checks the interval it is handed anyway,
 * which is the guard that catches a caller who computed one some other way.
 */
export function keyTransposeInterval(fromTonic: number, toTonic: number): number {
  const up = (((toTonic - fromTonic) % 12) + 12) % 12;
  if (up < 6) return up;
  if (up > 6) return up - 12;
  return toTonic > fromTonic ? 6 : -6;
}

/**
 * Lays slots end to end, so the timeline has no hole and no overlap.
 *
 * Every slot is rebuilt rather than only the ones that moved. There is nothing
 * to preserve by doing otherwise: this runs inside `settle()`, downstream of
 * `normalizeProgressionDoc`, which maps every slot through `normalizeChordSlot`
 * and that spreads unconditionally - so identity is already gone by the time
 * the slots arrive here. A component rendering them tracks by `slot.id`, which
 * is what `trackBy` is for.
 */
export function reflow(slots: readonly ChordSlot[]): ChordSlot[] {
  let beat = 0;
  return slots.map(slot => {
    const placed = { ...slot, startBeat: beat };
    beat += slot.lengthBeats;
    return placed;
  });
}

/**
 * Bounds a document and lays its slots end to end.
 *
 * Normalise, then re-flow, and the order is not interchangeable: a length
 * clamped after the positions had been summed from it would leave every later
 * slot starting in the wrong place.
 */
export function settle(doc: ProgressionDoc): ProgressionDoc {
  const bounded = normalizeProgressionDoc(doc);
  return { ...bounded, slots: reflow(bounded.slots) };
}

/**
 * Hands a slot's pitches back to the generator.
 *
 * The one thing a command may do to ownership that the user did not do
 * directly, and it is narrow on purpose: it is for a command that **restates
 * the chord or its voicing** - which is every command reaching
 * `ProgressionDegreeEditor.editDegree`, and there are **seven**:
 * `setSlotExtent`, `stepSlotExtent`, `setSlotChord`, `setSlotInversion`,
 * `setSlotOctave`, and the pair M3 Task 6 added, `setSlotSuspension` and
 * `setSlotExtension`. The list read `setSlotExtent`, `stepSlotExtent`,
 * `setSlotInversion`, `setSlotOctave` until that task's review, and the two it
 * missed are the ones the argument below fits best - a suspension and a pinned
 * ♭9 each move a chord tone, so a slot keeping the notes it had would sound
 * neither. Without the reclaim all seven collide with a
 * claim over `pitches`, and the collision is not a near miss. A complexity step
 * on such a slot writes `extent: 7`, so `effectiveChord` names it `Imaj7` on
 * the card, while `mergeNotes` hands back the three pitches the user was
 * holding: the stepper does nothing audible and mislabels the slot in the same
 * press. `effectiveChord`'s own docstring opens on two examples of exactly that
 * - the label disagreeing with the synth about one chord on one card - and
 * calls it the failure the function exists to prevent.
 *
 * Between honouring the request and preserving the pitches the user is in the
 * act of replacing, the request wins. It is undoable, which is what makes that
 * safe: one press of undo puts the claimed voicing back, where a stepper that
 * silently refused to move would leave the user with no way to find out why.
 *
 * **A key change does not reclaim.** Preserving a voicing across a
 * transposition is the entire point of the merge, and a key change restates no
 * chord - it moves every chord at once, which is what `transposeBy` is for.
 *
 * `timing` and `velocity` are left alone by all seven, because none of them
 * restates a rhythm or a dynamic: a complexity step should keep your groove.
 */
export function reclaimPitches(slot: ChordSlot): ChordSlot {
  return { ...slot, owned: { ...slot.owned, pitches: false } };
}

/**
 * Re-derives what a slot sounds, keeping the dimensions the user has claimed.
 *
 * This is a **merge**, not a replace, and that is the idea M2 turns on. M1
 * rebuilt every note from the degree on every key change, complexity step,
 * inversion and octave shift, which was safe only while nothing but the
 * generator had ever written a note. A piano roll ends that, and the single
 * `isHandEdited` boolean it would otherwise have needed forces a bad trade in
 * both directions - see `SlotOwnership`. So the three dimensions are answered
 * separately:
 *
 * | dimension | owned | not owned |
 * |---|---|---|
 * | pitches | transposed by `transposeBy`, then re-anchored | re-voiced from the degree |
 * | timing | kept | regenerated as a block |
 * | velocity | kept | reset to `DEFAULT_VELOCITY` |
 *
 * "Re-anchored" is `anchoredShift`, and it is what keeps the pitch row's owned
 * column from being an open-ended running sum. Read it before reading the row.
 *
 * **`quality` is left exactly as it arrived.** M1 wrote the *derived* label
 * into it here, which is consequence 4 of the design doc's correction section:
 * an override lived until the next regeneration and no longer, so there was
 * nowhere to write a borrowed chord that kept. `null` now means "as the key
 * gives it" and is re-derived on read by `effectiveChord` - which is where
 * the strip card and the fretboard highlight already got the name, off the
 * chord that was actually built rather than out of this field.
 *
 * **The asymmetry in the pitch row is why `transposeBy` is a parameter.**
 * Re-voicing needs only the new key, which is an argument; transposing owned
 * pitches needs the interval between the *old* key and the new one, which this
 * function cannot see. `ProgressionService.setKey` is the only caller that can
 * compute one, and every other call site passes 0 - which is not a default
 * standing in for a missing answer but the honest one: a complexity step or an
 * inversion moves no key, so there is no interval to move claimed pitches by.
 *
 * ## The two paths in here differ in intent, not only in `transposeBy`
 *
 * A **key change** regenerates to keep what the user has: the pitch row's
 * "owned" column is the whole point of the merge, because a voicing written in
 * C should follow the progression to A minor rather than be thrown away by it.
 * That path arrives with `owned` exactly as the document holds it.
 *
 * A **harmony command** - `setSlotExtent`, `stepSlotExtent`, `setSlotInversion`,
 * `setSlotOctave` - regenerates to *replace* what the user has, because that is
 * what the user just asked for: each of those restates the chord or its
 * voicing, and a stepper that left claimed pitches alone would move the label
 * without moving a note. So `ProgressionService.editDegree` calls
 * `reclaimPitches` first, and that path arrives with `owned.pitches` already
 * false. This function does not know which path it is on and does not need to:
 * the caller has already said so in the only vocabulary it reads.
 *
 * The consequence for the table is that its pitch row's "owned" column is
 * reachable **from the key path alone**. `owned.timing` and `owned.velocity`
 * are untouched on both - a complexity step keeps your rhythm and your
 * dynamics, because neither is a restatement of the chord.
 *
 * Bounds first, generate second. The order is load-bearing for the same reason
 * it is in `commit()`: `generateSlotNotes` copies `lengthBeats` onto every note
 * it makes, so generating from an unbounded slot would give the notes a length
 * the slot itself is then clamped away from.
 *
 * `scaleIntervals` is null when the key's scale cannot stack thirds at all -
 * unknown id, or not seven notes - and then the slot comes back bounded and
 * otherwise untouched. `degreePitchClasses` would throw on such a scale, so
 * this is the check that keeps the throw from happening rather than catching
 * it, and it is the only one on the regeneration path: `setKey` leans on it
 * instead of repeating it. `appendSlot` and the degree steppers ask
 * `canBuildChords` first for a different reason - they need to *refuse*, and a
 * slot handed back unchanged is not a refusal.
 */
export function regenerateSlot(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[] | null,
  transposeBy = 0
): ChordSlot {
  // The first clause of the model's normalisation rule, one road over. This
  // number is added straight to `RollNote.midi`, which reaches
  // `Tone.PolySynth` with nothing in between that looks at it again - so a
  // `NaN` interval is silence rather than an error, three layers from the
  // caller that computed it. Checked before anything else, because the caller
  // passing one is the bug whether or not this particular slot would have used
  // it.
  if (!Number.isInteger(transposeBy)) {
    throw new Error(
      `regenerateSlot transposeBy must be a whole number of semitones to ` +
        `transpose owned pitches by; got ${transposeBy}`
    );
  }

  const bounded = normalizeChordSlot(slot);
  if (!scaleIntervals) return bounded;

  const generated = generateSlotNotes(bounded, key, scaleIntervals);
  // A literal slot gets its own array back by identity, and there is nothing
  // to merge it with: its notes ARE the truth, so every dimension of them is
  // the user's whatever `owned` says. Returning early also keeps the copy from
  // happening, which would report a change where none happened - and keeps the
  // velocity column of the table above off a slot that never asked the app for
  // a note in the first place.
  if (generated === bounded.notes) return bounded;

  return { ...bounded, notes: mergeNotes(bounded, generated, transposeBy) };
}

/**
 * The table in `regenerateSlot`, applied note by note.
 *
 * **Pitches decide how many notes there are**, because a note is a pitch: a
 * user who added or removed one owns that count, and a re-voiced chord brings
 * its own. The other two dimensions are then read at the same index from
 * whichever list owns them, which is the only correspondence available - the
 * chord is a different set of notes after a re-voice, so there is no note to
 * carry an identity across the change. That is also why `SlotOwnership` is per
 * slot rather than per note.
 *
 * The two lists can therefore differ in length, in both directions, and both
 * are reachable from one complexity step on a slot the user has claimed. The
 * shorter list is read at its last note rather than off its end - see
 * `noteAt`.
 */
function mergeNotes(
  slot: ChordSlot,
  generated: readonly RollNote[],
  transposeBy: number
): RollNote[] {
  const held = slot.notes;
  const owned = slot.owned;

  // The list is walked rather than rebuilt: the map below writes every field of
  // every note anyway, so a transposed copy made here would be an object built
  // to have one number read off it. The shift is hoisted to match - it is 0 on
  // the re-voiced branch by the same argument that makes `transposeBy` 0 at
  // every call site but `setKey`: a chord rebuilt from the degree is already in
  // the new key, so moving it again would move it twice.
  const pitched = owned.pitches ? held : generated;
  const shift = owned.pitches ? anchoredShift(held, generated, transposeBy) : 0;

  return pitched.map((note, index) => {
    // `note` as the last resort rather than a written-out block: when timing is
    // not owned the source *is* the generated list, so this falls back to the
    // note it is already standing on, and the block-chord rule stays stated in
    // `generateSlotNotes` alone.
    //
    // It is reached by a claim over timing sitting above an **empty** held
    // list, which is a state the page can now produce: `setNoteTiming` claims
    // the timing, `setSlotNotes(id, [])` empties the notes, and the next
    // `stepSlotExtent` reclaims the pitches and lands here with nothing owned
    // to read a start or a length off. `replaceDocument` is the other door and
    // was once the only one.
    const timing = noteAt(owned.timing ? held : generated, index) ?? note;

    return {
      midi: note.midi + shift,
      startBeat: timing.startBeat,
      lengthBeats: timing.lengthBeats,
      velocity: owned.velocity
        ? noteAt(held, index)?.velocity ?? DEFAULT_VELOCITY
        : DEFAULT_VELOCITY
    };
  });
}

/**
 * How far a claimed voicing actually moves when the key does: the interval,
 * plus however many whole octaves put the result back on the chord.
 *
 * ## The sum this closes
 *
 * `mergeNotes` used to add `transposeBy` straight to `RollNote.midi` and store
 * what came out, which made the stored pitch a **running sum** over every key
 * change the progression had ever seen. Each term of that sum was bounded -
 * `keyTransposeInterval` returns -6 to 6, and `regenerateSlot` refuses a term
 * that is not a whole number of semitones - and the accumulator was not, which
 * is a different thing and the one that mattered. Antisymmetry cancels a *pair*
 * of key changes and says nothing about a longer route, so any cycle of three
 * or more walked: twelve clicks clockwise round the circle of fifths carried a
 * voicing from middle C to MIDI 0, twelve anticlockwise to 120, and C to E to G
 * sharp and home gained an octave a lap with nothing at either end to stop it.
 * `frequencyOf` sounds those at 8 Hz and 790 kHz, and Task 6's
 * `visibleMidiRange` would have scrolled the roll to follow.
 *
 * ## Re-anchoring instead of accumulating
 *
 * The voicing is transposed as before, then shifted by whole octaves until its
 * lowest note sits as near as it can to the lowest note of the chord the degree
 * generates in the **new** key. One shift moves every note, so the intervals
 * the user stacked survive exactly, and so does their offset from the chord for
 * anything within a tritone of it.
 *
 * What that buys is **path independence**. The answer is a function of the key
 * the progression has arrived in and the pitch class the voicing has arrived
 * on, and of nothing about the route taken to either - so every cycle closes by
 * construction, three-key laps included, and the *octave*
 * `keyTransposeInterval` picked stops being observable at all. It is bounded as
 * well as closed, which is what makes this a fix rather than a rearrangement:
 * `chordOctaveCeiling` bounds the generated chord inside MIDI, the anchor holds
 * the voicing within a tritone of that, and the span of the voicing is whatever
 * the user drew and never grows.
 *
 * ## What it costs, and why the cost is not avoidable
 *
 * A user who parks a voicing more than a tritone from the chord it belongs to
 * has that register pulled back on the next key change. Preserving the register
 * across a lap means preserving *history*, and a rule that reads history is a
 * rule a cycle can walk - the two cannot both be had, and an unbounded pitch is
 * the worse half to keep. Storing the offset on the slot is the design that
 * would keep both; it is model surgery, and it is not this fix.
 *
 * The second consequence is worth stating rather than discovering. The
 * generator's own register jumps: `voiceChord` stacks from a floor, so the I of
 * C sits at 60 while the I of B - one semitone down - sits at 71. An anchored
 * voicing follows that jump where a plain nearest-interval move did not, and it
 * follows it **in company**, because every unclaimed slot in the progression
 * jumps the same way at the same moment. Any rule that closes a cycle has to
 * put one discontinuity somewhere round the circle; this one puts it where the
 * app already had one, rather than adding a second.
 *
 * The lowest note is the anchor on both sides. It is what `voiceChord` itself
 * anchors on - `baseMidi` is a floor under the first note and the rest are
 * stacked above it - and it is the statistic that survives the two lists being
 * different lengths, which they are whenever the user has added or deleted a
 * note: a mean would compare a five-note hand voicing against a three-note
 * triad and read the difference as register.
 */
function anchoredShift(
  held: readonly RollNote[],
  generated: readonly RollNote[],
  transposeBy: number
): number {
  // Nothing to anchor, and nothing to anchor to. The empty `held` case is the
  // one the page can reach - see the `?? note` fallback in `mergeNotes` - and
  // it maps no notes anyway, so the shift it returns is never added to
  // anything.
  if (held.length === 0 || generated.length === 0) return transposeBy;

  const moved = lowestMidi(held) + transposeBy;
  const octaves = Math.round((lowestMidi(generated) - moved) / 12);
  return transposeBy + octaves * 12;
}

/** The lowest pitch in a note list. Its one caller turns an empty list away first. */
function lowestMidi(notes: readonly RollNote[]): number {
  return notes.reduce((lowest, note) => Math.min(lowest, note.midi), notes[0].midi);
}

/**
 * The note at `index`, the last note when the list is shorter than that, or
 * null when it holds none.
 *
 * The clamp is the answer to a chord that grew past the notes the user owns -
 * a complexity step under a hand-written rhythm, where the new seventh has no
 * claimed counterpart at its index. It joins the last note the user placed,
 * because a chord tone added under a rhythm belongs to the event that rhythm
 * ends on; springing back to the slot's start and full length would make it the
 * one voice ignoring the groove.
 *
 * ## One extra note is the easy case, and not the argument
 *
 * The gap is a gap and not an off-by-one: three held notes against a thirteenth
 * chord's seven puts **four** notes on the last onset, all sounding together
 * where the user wrote one. That is a real change to what the slot sounds like,
 * and no rule available here avoids it - the user owns three onsets and the
 * chord has seven notes, so at least two tones must share.
 *
 * The clamp is still the right rule, for a stronger reason than "the last event
 * is the closest one". It keeps the onsets **monotone in chord-tone order**:
 * read up the stack and the attacks never go backwards. The obvious
 * alternative - wrapping round to note 0 - would put the eleventh and the
 * thirteenth at the *start* of an ascending arpeggio and the root at its end,
 * inverting the figure the user actually wrote. And the clamp invents no
 * attack: every onset in the result is one the user placed, where spreading the
 * overflow across the slot would be the app writing rhythm on their behalf.
 * Piling notes onto an onset that exists is a smaller lie than inventing one
 * that does not.
 *
 * **The same clamp decides velocity, and there it has a shape worth knowing.**
 * The overflow tones inherit the *last* note's velocity, so under a decrescendo
 * the chord tones the step adds are the quietest notes in the slot - the added
 * seventh and ninth arrive under the chord rather than on top of it. That reads
 * as a deliberate voicing more often than not, but it is a consequence of the
 * clamp rather than a decision about dynamics, and a roll that later wants to
 * spread the added tones should change both dimensions together.
 *
 * `null` rather than `undefined` so the caller has to say what an empty list
 * means for its own dimension, which is not the same answer twice: timing falls
 * back to the regenerated note and velocity to `DEFAULT_VELOCITY`.
 */
function noteAt(notes: readonly RollNote[], index: number): RollNote | null {
  if (notes.length === 0) return null;
  return notes[Math.min(index, notes.length - 1)];
}

/**
 * The document back, if no two of its slots share an id.
 *
 * Ids are how every method on the service finds a slot, and a repeated one
 * breaks them in different directions: `removeSlot` filters by id and drops
 * both twins, while `ProgressionStore.commitSlot` finds the first and edits it
 * twice over. A document like that arrives from a file rather than from a
 * user, so it is a corrupt document rather than a control at its limit - the
 * wrong-kind clause of the model's normalisation rule, which throws.
 *
 * It is checked at `replaceDocument` rather than inside `settle()`, because
 * that is the only door a document the service did not build comes through.
 */
export function requireUniqueSlotIds(doc: ProgressionDoc): ProgressionDoc {
  const seen = new Set<string>();
  for (const slot of doc.slots) {
    if (seen.has(slot.id)) {
      throw new Error(`ProgressionDoc slots must have distinct ids; ${slot.id} is repeated`);
    }
    seen.add(slot.id);
  }
  return doc;
}
