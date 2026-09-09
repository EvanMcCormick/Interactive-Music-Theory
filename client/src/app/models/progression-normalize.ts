// Split by kind so the one runtime edge is visible: the types come back from
// the model erased, and `noteCount` is the only import here that survives to
// runtime. See the layering note below.
import type { ChordExtent } from '../services/progression-harmony';
import { noteCount } from '../services/progression-harmony';
import type {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  SlotOwnership
} from './progression.model';

/**
 * The bounds a progression's numbers are held to, and the guards that hold
 * them there.
 *
 * This was the back half of `progression.model.ts`, and the rule below read
 * worse for it. Its second clause names `OCTAVE_MIN` and `TEMPO_MAX`; those
 * constants sat some three hundred lines further down, with every type
 * declaration in the document model in between. A rule, the numbers its clauses
 * name, and the code that enforces them are one thought, and this file is that
 * thought in one place. The constants travel with the guards rather than into a
 * file of their own for the same reason: split those two and the rule is back
 * to naming a limit defined somewhere else.
 *
 * ## The edge to `progression.model.ts` runs one way
 *
 * `createDegreeSlot` there calls `normalizeChordSlot` here, so the model
 * imports this file at runtime. The types go straight back the other way, and
 * would close a cycle if they were ordinary imports - so they are not. An
 * `import type` is erased, and the cycle exists for the type checker and
 * nowhere else. That is the device `transcription.model.ts` already uses
 * against `transcription-harmonics.ts`, and the reason is recorded there.
 *
 * Both imports above are split rather than mixed, so the distinction cannot be
 * lost by accident: adding a genuine runtime edge back to the model would mean
 * writing it on its own line, where it is impossible to miss.
 *
 * `createOwnership` lives here for that reason and not for a better one. It
 * belongs beside the `SlotOwnership` interface it builds, and would still be
 * there if it were only a factory - but it is also the safe default the fifth
 * clause fills an absent record with, and `normalizeOwnership` calls it. Left
 * in the model it would be the one value these guards needed from there, and so
 * the one thing that would make that cycle real.
 *
 * `noteCount` is the one genuine runtime edge out of this file, and it carries
 * no Angular or audio dependency.
 *
 * ## The normalisation rule
 *
 * Every numeric field that can reach the audio layer is checked in one place -
 * `normalizeChordSlot` for a slot, `normalizeProgressionDoc` for the document
 * around it - under a single rule with five clauses:
 *
 *  - **A value of the wrong kind is a bug, and throws.** `NaN` or `undefined` in
 *    a chord's pitch data runs through `voiceChord` untouched into
 *    `RollNote.midi` and on to `Tone.PolySynth` - precisely the failure
 *    `degreePitchClasses` guards its own `degree` against. Throwing puts the
 *    error where it was introduced rather than three layers downstream.
 *  - **A continuous control past its limit is clamped** - `octave`, `alter`,
 *    `lengthBeats`, `tempo`. Each has natural ends, and a control resting on one
 *    is not an error: `setSlotLength` is a drag handler, and a throw the moment
 *    the dragged edge crosses zero would abort the gesture rather than stop it.
 *  - **A cyclic control past its limit wraps** - `inversion`, and the key's
 *    `tonic`. The inversion above the last is root position again; the pitch
 *    class above B is C. Storing them wrapped keeps them nameable.
 *  - **A value outside an enumerated set throws** - `extent`. `ChordExtent` is a
 *    union rather than a range, so a value that is not in it is a type violation
 *    rather than a control at its limit, and there is no end to clamp to: the
 *    set is a ladder, not an interval. Keeping the +/- complexity buttons inside
 *    `CHORD_EXTENTS` is therefore the *stepper's* job - stepping off either end
 *    should fail loudly here rather than be rounded back onto the last rung.
 *  - **A field that reaches no audio path and has a defined safe default is
 *    filled when it is absent, rather than thrown on** - `owned`. The clauses
 *    above are about values that arrive somewhere unlooked-at, where "I cannot
 *    tell" has no answer but a failure. This one is about a field that arrives
 *    nowhere at all, where it has one: the value a fresh slot already carries.
 *    The clause is about *absence* only, and absence is a migration - a field
 *    added to a document type is missing from every document written before it.
 *    A member that is present and of the wrong kind is corruption rather than
 *    migration, and falls back under the first clause and throws.
 *
 * `normalizeProgressionDoc` is what makes the rule a mechanism rather than a
 * convention: `ProgressionService.commit` calls it on every mutation, so the
 * funnel has
 * one call site instead of eleven setters each remembering to opt in.
 */

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** One bar in 4/4. The length a chord gets unless the user changes it. */
export const BEATS_PER_SLOT_DEFAULT = 4;

/**
 * The shortest a slot may be, in beats.
 *
 * One beat rather than a fraction of one. `startBeat` and `lengthBeats` are
 * floats so the timeline can hold whatever M2 puts on it, but M1 measures slots
 * in beats and sounds each as a single block, so a slot shorter than a beat is
 * not something M1 can ask for or play. It is a floor on a drag rather than a
 * grid, so it costs nothing to lower when free timing arrives in M2 - and this
 * is the constant to revisit then.
 */
export const MIN_SLOT_BEATS = 1;

/** Middle C. Where voicings are stacked from before `octave` shifts them. */
export const VOICING_BASE_MIDI = 60;

/**
 * How far the octave control may shift the voicing base, in octaves.
 *
 * The top is arithmetic rather than taste. `voiceChord` has no MIDI clamp, so
 * this is the last line before a note reaches `Tone.PolySynth`. Measured over
 * the pipeline `generateSlotNotes` actually runs - all 33 heptatonic scales the
 * app offers, every degree, extent, inversion, `alter` and tonic - the highest
 * note a chord can reach is **33** semitones above the base: a 9th on the double
 * harmonic scale, fourth inversion, altered down a tone.
 *
 * `alter` and `tonic` belong in that measurement rather than being factored out
 * of it, because the reach is not transposition-invariant: `voiceChord` places
 * its first note anywhere from the base to eleven semitones above it, so
 * transposing a chord can widen it. A sweep of untransposed chords measures 32,
 * and is measuring a pipeline this bound does not guard.
 *
 * `OCTAVE_MAX` of 2 puts the base at C6 and that ceiling at 117, ten short of
 * 127; 3 would put it at 129, off the end of MIDI. The spec proves both halves,
 * so a new scale that widened the stack would fail rather than clip.
 *
 * The bottom is taste, and the spec pins it as taste rather than deriving it:
 * `voiceChord` never voices below its base, so the MIDI floor would permit
 * anything down to -5 and says nothing about where to stop. C2 is where the
 * musical argument stops - below the low E of a guitar in standard tuning, and
 * chords voiced under it are mud rather than music.
 */
export const OCTAVE_MIN = -2;
export const OCTAVE_MAX = 2;

/**
 * How far a degree may be chromatically altered, in semitones. Past a whole
 * tone it is a different degree rather than an alteration of this one.
 */
export const ALTER_MIN = -2;
export const ALTER_MAX = 2;

/**
 * The playable tempo range, in BPM.
 *
 * `Tone.Transport.bpm` takes any number at all: 0 stops the transport dead
 * while a progression appears to play, and a negative one is not meaningful
 * time. The ends here are the musical ones rather than those arithmetic edges -
 * 20 is slower than any grave, 300 faster than any prestissimo - because a
 * tempo box that stops somewhere usable is more use than one that stops just
 * short of breaking playback.
 */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;

/**
 * The velocity every generated note is given, out of MIDI's 1-127.
 *
 * It lives here rather than in `progression-generate.ts` because it is a
 * `RollNote` default rather than a fact about chord generation. M2's piano roll
 * draws notes by hand and needs the same starting value, and it has no business
 * importing a constant out of the block-chord generator to get it - the same
 * argument that put `VOICING_BASE_MIDI` here rather than beside `voiceChord`.
 *
 * 80 is `mf` on the dynamics map MIDI writers share - 49 p, 64 mp, 80 mf, 96 f
 * - which is the value to reach for when the score is unmarked, and every M1
 * chord is unmarked. Sitting at neither end is the point: M1 sounds every note
 * at exactly this velocity, so the constant's real job is to leave M2's
 * velocity editing somewhere to move in both directions from.
 *
 * It corroborates against the instruments already in the app, which reach Tone
 * as an 0-1 gain rather than as a MIDI byte: the fretboard plucks at 0.6-1.0
 * and the keyboard strikes at 0.5-1.0. 80/127 is 0.63, inside both ranges and
 * at the bottom of them, so a progression sits under a plucked note rather than
 * over it - which is what a backing track is for.
 */
export const DEFAULT_VELOCITY = 80;

/**
 * The runtime twin of the `ChordExtent` union, ascending, so the +/- complexity
 * control has an order to step along and the guard below has a list to check
 * against. The union alone cannot do either job at runtime.
 */
export const CHORD_EXTENTS: readonly ChordExtent[] = [3, 7, 9, 11, 13];

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function requireInteger(value: number, field: string): number {
  // Catches `undefined` and `NaN` as well as fractions: `Number.isInteger`
  // takes no view of what a non-number might have meant.
  if (!Number.isInteger(value)) {
    throw new Error(`ChordSlot ${field} must be a whole number; got ${value}`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Wraps a value into 0..modulus-1, for the cyclic controls. */
function wrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function requireStartBeat(startBeat: number): number {
  // A `NaN` here is the same failure as a `NaN` midi, one axis over: it reaches
  // Tone as a schedule time, and nothing between here and there looks at it.
  if (!Number.isFinite(startBeat) || startBeat < 0) {
    throw new Error(
      `ChordSlot startBeat must be a finite position at or after 0; got ${startBeat}`
    );
  }
  return startBeat;
}

function normalizeLengthBeats(lengthBeats: number): number {
  // The wrong-kind half of the rule, and here it is the whole of it: a `NaN` or
  // `Infinity` length reaches Tone as a note duration, unlooked-at in between.
  if (!Number.isFinite(lengthBeats)) {
    throw new Error(
      `ChordSlot lengthBeats must be a finite duration; got ${lengthBeats}`
    );
  }
  // Too short clamps rather than throwing, because `setSlotLength` is a
  // drag-the-edge handler and dragging past the far edge produces exactly 0 and
  // then negatives. There is no maximum to clamp against - a slot may be as
  // long as the user drags it.
  return Math.max(MIN_SLOT_BEATS, lengthBeats);
}

function requireDegreeIndex(degree: number): number {
  // The domain `degreePitchClasses` enforces, checked here as well so a bad
  // degree fails when the slot is built rather than when it is first sounded.
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(`ChordSlot degree must be a scale degree from 0 to 6; got ${degree}`);
  }
  return degree;
}

/**
 * The enumerated-set clause of the rule above, and the one guard that throws on
 * an out-of-range value rather than bounding it.
 *
 * Not belt-and-braces over the union: `noteCount` reads an unlisted extent as a
 * fractional note count, and `degreePitchClasses` then loops past it and
 * returns a chord with a note too many. A wrong chord, not a crash. And not a
 * clamp, because keeping the +/- complexity buttons on the ladder is the
 * *stepper's* job - `ProgressionService.setSlotExtent` owns that, not this
 * guard.
 */
function requireExtent(extent: ChordExtent): ChordExtent {
  if (!CHORD_EXTENTS.includes(extent)) {
    throw new Error(
      `ChordSlot extent must be one of ${CHORD_EXTENTS.join(', ')}; got ${extent}`
    );
  }
  return extent;
}

/**
 * Inversion wraps where octave clamps, because it is cyclic: the inversion
 * above the last one is root position again. Storing it wrapped keeps it
 * nameable, so a control that has been stepped round twice still reads as
 * "second inversion" rather than "eighth".
 *
 * `voiceChord` wraps too and would cope on its own. This is not that guard: it
 * is the one that keeps `NaN` out, which `voiceChord` deliberately does not do
 * - a `NaN` inversion there silently voices root position, so the control looks
 * broken and nothing says why.
 */
function normalizeInversion(inversion: number, extent: ChordExtent): number {
  return wrap(inversion, noteCount(extent));
}

/**
 * The tonic is a pitch class, so it wraps for the reason inversion does: the
 * note above B is C, and a control stepped past the end of the circle has
 * arrived somewhere real rather than failed. It is checked at all because
 * `generateSlotNotes` adds it to every pitch class on the way into
 * `voiceChord`, making `setKey` a second road to the same `RollNote.midi`.
 */
function normalizeTonic(tonic: number): number {
  if (!Number.isInteger(tonic)) {
    throw new Error(`ProgressionKey tonic must be a whole pitch class; got ${tonic}`);
  }
  return wrap(tonic, 12);
}

/**
 * Tempo reaches `Tone.Transport.bpm` - the audio layer by another road than
 * `RollNote.midi`, and just as unguarded along the way. Continuous, so it
 * clamps; unquantised, so a metronome may sit between two whole numbers.
 */
function normalizeTempo(tempo: number): number {
  if (!Number.isFinite(tempo)) {
    throw new Error(`ProgressionDoc tempo must be a finite BPM; got ${tempo}`);
  }
  return clamp(tempo, TEMPO_MIN, TEMPO_MAX);
}

/**
 * A slot that owns nothing: everything about it is the app's to re-derive.
 *
 * A function rather than a shared constant, for the reason
 * `createDefaultProgression` builds its `slots` array per call:
 * `structuredClone` undo is only safe while no two documents point at the same
 * object.
 *
 * That is load-bearing at the call sites that do not pass through
 * `normalizeChordSlot`, which rebuilds `owned` unconditionally and so would
 * launder a shared constant into a fresh record before any document saw it.
 * Task 4's merge is the first of them.
 */
export function createOwnership(): SlotOwnership {
  return { pitches: false, timing: false, velocity: false };
}

/**
 * Fills in a slot's ownership record when it is absent, and checks it when it
 * is not. The fifth clause of the rule above, and the only guard that has a
 * default to fall back on at all.
 *
 * The clauses before it govern the numbers that reach the audio layer, where a
 * value of the wrong kind throws because nothing between the model and
 * `Tone.PolySynth` looks at it again: a `NaN` midi is inaudible as an error and
 * audible as silence. Ownership reaches no such road. Nothing reads it yet;
 * `regenerateSlot` still replaces a slot wholesale and becomes the merge that
 * reads it in M2 Task 4, to decide which dimensions to re-derive. The safe
 * answer to "I cannot tell" is the value a fresh slot already carries - own
 * nothing, regenerate everything - which is a defined default where a `NaN`
 * octave has none.
 *
 * What getting it wrong will cost, once the merge does read it, is hand edits
 * rather than a chord that never sounds. The loss is per *document* and not per
 * slot: a key change re-derives every slot in one pass, so a progression that
 * arrives owning nothing loses every hand edit on it at once. Still recoverable
 * - one undo, and nothing about it is silent - but it is the whole document's
 * work, which is why the fill is the last resort and not the first.
 *
 * ## Absent is filled; present and wrong is thrown on
 *
 * A *missing* record is a migration: a document written before this field
 * existed has no `owned` at all, and refusing to open it over a field that says
 * nothing about what it sounds like would be the worse answer. There are no
 * such documents yet - a progression is not persisted anywhere, and
 * `replaceDocument` has no production caller - so the set is empty today. It
 * stops being empty the moment saving lands, which is what this branch is for.
 *
 * A member that is *present* and not a boolean is the other case, and the
 * distinction matters more than it looks. No release ever wrote a non-boolean
 * here, so nothing arriving with one came from an older version of this
 * document: it is corruption rather than migration, and coercing it would
 * quietly reset a dimension the user had claimed instead of saying so.
 *
 * Rebuilt rather than passed through, so a document already on the
 * `structuredClone` undo stack is not left sharing a record with the one that
 * replaced it - the same promise `normalizeChordSlot` makes about the slot.
 */
function normalizeOwnership(owned: SlotOwnership | undefined): SlotOwnership {
  if (owned === undefined) return createOwnership();
  return {
    pitches: requireOwnershipFlag(owned.pitches, 'pitches'),
    timing: requireOwnershipFlag(owned.timing, 'timing'),
    velocity: requireOwnershipFlag(owned.velocity, 'velocity')
  };
}

function requireOwnershipFlag(value: boolean, dimension: string): boolean {
  // Catches `undefined` as well as the wrong type: a record present but missing
  // one member is a half-written record, not a document that predates the field.
  if (typeof value !== 'boolean') {
    throw new Error(
      `SlotOwnership ${dimension} must be a boolean; got ${value}`
    );
  }
  return value;
}

function normalizeChordDegree(degree: ChordDegree): ChordDegree {
  const extent = requireExtent(degree.extent);
  return {
    ...degree,
    degree: requireDegreeIndex(degree.degree),
    alter: clamp(requireInteger(degree.alter, 'alter'), ALTER_MIN, ALTER_MAX),
    extent,
    inversion: normalizeInversion(requireInteger(degree.inversion, 'inversion'), extent),
    octave: clamp(requireInteger(degree.octave, 'octave'), OCTAVE_MIN, OCTAVE_MAX)
  };
}

/**
 * Checks and bounds every number on a slot that can reach the audio layer.
 *
 * Builds a new slot rather than editing in place, so a document already on the
 * `structuredClone` undo stack is not quietly amended behind it.
 *
 * The copy is shallow, and the promise should be read as exactly that: `notes`
 * is the same array by reference, holding the same `RollNote` objects, and a
 * literal slot's `harmony` is the same object too, where the degree branch and
 * `owned` both build fresh ones. Enough for the undo stack, which deep-clones on
 * the way in; not enough for a caller assuming it may now edit `notes` in place.
 *
 * `notes` is also not checked, for the reason it is safe not to copy: in M1 it
 * is regenerated wholesale from the fields above, which are checked, and never
 * mutated, so there is nothing a check could catch and nothing a shared
 * reference can spoil. M2's piano roll ends both at once, which is why the deep
 * copy and the `notes` check belong in one change.
 */
export function normalizeChordSlot(slot: ChordSlot): ChordSlot {
  const timed: ChordSlot = {
    ...slot,
    startBeat: requireStartBeat(slot.startBeat),
    lengthBeats: normalizeLengthBeats(slot.lengthBeats),
    // Before the literal branch returns, so both kinds of slot get one.
    owned: normalizeOwnership(slot.owned)
  };

  // A literal slot has no degree to check. Its timing still matters.
  if (timed.harmony.kind !== 'degree') return timed;

  return {
    ...timed,
    harmony: { kind: 'degree', degree: normalizeChordDegree(timed.harmony.degree) }
  };
}

/**
 * Checks and bounds a whole document: every slot, plus the two numbers that
 * reach the audio layer without belonging to one.
 *
 * This is the funnel's intended call site: `ProgressionService` routes
 * every mutation through a single `commit()`, and `commit()` calls this. That
 * turns "every path that produces a slot should end at `normalizeChordSlot`"
 * from a convention eleven setters each have to remember into a mechanism with
 * one place to check. `setKey` and `setTempo` are the two with no slot to
 * normalise and so no reason to think of it at all - which is exactly how
 * `tonic` and `tempo` came to be the holes in the first place.
 *
 * `timeSignature` is not checked. In M1 it is laid out and displayed but never
 * handed to Tone, so it is not on the road this rule guards; it joins when
 * `quantizeBar` in M2 starts computing bar lengths from it.
 */
export function normalizeProgressionDoc(doc: ProgressionDoc): ProgressionDoc {
  return {
    ...doc,
    key: normalizeProgressionKey(doc.key),
    tempo: normalizeTempo(doc.tempo),
    slots: doc.slots.map(slot => normalizeChordSlot(slot))
  };
}

/**
 * Bounds a key on its own, for a caller that has one before it has a document.
 *
 * Exported for `ProgressionService.setKey`, which generates every slot's notes
 * from the new key *inside* the commit that stores it - so it needs the key as
 * it will be stored rather than as it arrived, and the document normalisation
 * above does not run until the mutation is over. Two roads to the same rule
 * would be one road too many, so this is the one and the doc normaliser calls
 * it too.
 */
export function normalizeProgressionKey(key: ProgressionKey): ProgressionKey {
  return { ...key, tonic: normalizeTonic(key.tonic) };
}

