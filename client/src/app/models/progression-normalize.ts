// Split by kind so the runtime edge is visible: the types come back from the
// model erased, and only `noteCount` and `NAMED_QUALITIES` survive to runtime.
// See the layering note below.
import type { ChordExtent, NamedQuality } from '../services/progression-harmony';
import { NAMED_QUALITIES, noteCount } from '../services/progression-harmony';
import type {
  ChordDegree,
  ChordSlot,
  EleventhAlteration,
  ExtensionAlterations,
  NinthAlteration,
  ProgressionDoc,
  ProgressionKey,
  RollNote,
  SlotOwnership,
  SuspensionKind,
  ThirteenthAlteration
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
 * `noteCount` and `NAMED_QUALITIES` are the genuine runtime edges out of this
 * file, and neither carries an Angular or audio dependency. Both are twins of a
 * type this file has to check at runtime, where the type is gone.
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
 *  - **A value outside an enumerated set throws** - `extent`, `quality`,
 *    `suspension`, and each member of `extensions`. All are unions rather than
 *    ranges, so a value that is not in one is a type violation rather than a
 *    control at its limit, and there is no end to clamp
 *    to: the set is a ladder, not an interval. Keeping the +/- complexity
 *    buttons inside `CHORD_EXTENTS` is therefore the *stepper's* job - stepping
 *    off either end should fail loudly here rather than be rounded back onto the
 *    last rung. `quality` also carries the one *cross-field* rule in this file:
 *    a chromatic root needs a quality that names a shape, which is design
 *    decision 1 and falls under the first clause, neither field being wrong on
 *    its own. `suspension` joined this clause at M3 having been stored
 *    unchecked since M1, on the honest ground that nothing read it: it reaches
 *    `chordPitchClasses` now, where an unlisted value would silently sound the
 *    diatonic third and leave a card reading `sus4` over a chord that is not.
 *  - **A field that reaches no audio path and has a defined safe default is
 *    filled when it is absent, rather than thrown on** - `owned`. The clauses
 *    above are about values that arrive somewhere unlooked-at, where "I cannot
 *    tell" has no answer but a failure. This one is about a field that arrives
 *    nowhere at all, where it has one: the value a fresh slot already carries.
 *    The clause is about *absence* only, and absence is a migration - a field
 *    added to a document type is missing from every document written before it.
 *    A member that is present and of the wrong kind is corruption rather than
 *    migration, and falls back under the first clause and throws. `extensions`
 *    is the second field under this clause and the first one for which the
 *    migration is not hypothetical: it was added to `ChordDegree` at M3, so
 *    every slot written before it has none, and the fill is the value a fresh
 *    slot carries - all three `null`, "as the key gives it".
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
 * The last note MIDI has, and so the last note the app may sound.
 *
 * A number this well known does not obviously need a name, and it earns one
 * here because it is an *argument*: `chordOctaveCeiling` passes it to
 * `headroomOctaves`, which takes a ceiling rather than assuming one so that the
 * arithmetic can be checked against ceilings other than this. A bare 127 at that
 * call site would read as an implementation detail of the helper rather than as
 * the fact about MIDI that it is.
 *
 * It sits beside `VOICING_BASE_MIDI` because the two are read together - the
 * base is where a chord starts and this is where it must stop - and apart from
 * `VELOCITY_MAX`, which is the same number about a different byte.
 */
export const MIDI_MAX = 127;

/**
 * How far the octave control may shift the voicing base, in octaves.
 *
 * The top is arithmetic rather than taste. `voiceChord` has no MIDI clamp, so
 * this is the last line before a note reaches `Tone.PolySynth`. Measured over
 * the pipeline `generateSlotNotes` actually runs - all 33 heptatonic scales the
 * app offers, every degree, extent, inversion and tonic, and every `(alter,
 * quality)` pair a stored slot may carry - the highest note a chord can reach is
 * **46** semitones above the base. The witness is the enigmatic scale's degree 0
 * at extent 13, altered down a tone and overridden to `add9`, fourth inversion,
 * in B flat.
 *
 * It was 45, on Hungarian minor's degree 5 overridden to `augmented7`, and it
 * moved when M3 Task 4 put four added-tone shapes in `QUALITY_INTERVALS`:
 * `add9` puts its fourth note a *ninth* above the root where every seventh puts
 * one at 10 or 11, so a displaced root reaches a semitone further under the
 * diatonic notes the override leaves alone. The sweep found it without being
 * widened, because it derives its shapes from that table.
 *
 * `alter` and `tonic` belong in that measurement rather than being factored out
 * of it, because the reach is not transposition-invariant: `voiceChord` places
 * its first note anywhere from the base to eleven semitones above it, so
 * transposing a chord can widen it. A sweep of untransposed chords measures 32,
 * and is measuring a pipeline this bound does not guard.
 *
 * `quality` belongs there for a sharper reason. It used to be safe to leave out
 * because `alter` was a transposition and no override was ever read, so the
 * diatonic stack was the whole reachable set; that sweep measured 33, and 33 is
 * what this note used to quote. Root-only alteration made the override part of
 * the chord, and the reachable set grew by an octave: 34 with an override at
 * `alter` 0, 45 once `alter` moves. A plain alternates row with no chromatic
 * root at all already passes the old figure.
 *
 * `OCTAVE_MAX` of 1 puts the base at C5 and that ceiling at 118, nine short of
 * 127; 2 would put it at 130, off the end of MIDI.
 *
 * **It was 2, and dropping it cost the user the top octave of the control.**
 * That was the price of bounding the *input*, and it was paid deliberately: the
 * alternatives all bound the output instead, and every one of them rewrites the
 * chord without saying so - clamping notes individually collapses a voicing onto
 * its ceiling, and transposing an overflowing chord back down makes the control
 * non-monotonic. A wrong chord rather than a crash is the failure every guard
 * here exists to avoid.
 *
 * ## What this bound is now, after M3 Task 4b
 *
 * **It is the control's nominal range, and it is no longer what keeps a note
 * inside MIDI.** Everything above measures a chord's `(alter, quality)` and
 * nothing else, because until M3 that was the whole of what a stored slot could
 * vary. `suspension` is now sounded and `extensions` now pins the ninth,
 * eleventh and thirteenth, and the same sweep with both axes added - all 236
 * million chords of it - reaches **58** semitones above the base, not 46. At
 * `OCTAVE_MAX` of 1 that chord ends on MIDI 130, three notes past the end.
 *
 * The witness is C major's degree 3 - the IV - at extent 13, altered down a tone
 * and overridden to `diminished`, suspended at the fourth with a flattened ninth
 * and a flattened thirteenth, second inversion, in D, where two replacements
 * land on the note below them and the lift adds an octave twice. It is pinned by
 * hand in the spec.
 *
 * The fix keeps this constant and makes **the ceiling each chord's own**.
 * `chordOctaveCeiling` in `progression-generate.ts` derives from the chord it is
 * about to build the highest octave that still fits, and `generateSlotNotes`
 * voices no higher. That is the option M2 Task 3 named as the one that keeps the
 * range, and it is taken here rather than dropping this constant to 0, which
 * would have cost every chord in the app the top octave to accommodate one
 * almost nobody will build.
 *
 * `ChordDegree.octave` still stores what the user asked for, bounded by these
 * two. Storing the clamped value would make the clamp outlive its cause: a slot
 * pushed down because a pinned ♭13 widened it must return to its octave when the
 * ♭13 comes off. The clamp is applied on use and nowhere else, and
 * `ProgressionService.slotOctave` is what the palette reads to show the
 * difference.
 *
 * So the figure above is no longer load-bearing, and the sweep that produced it
 * is no longer a spec: 236 million chords is thirteen minutes, and a per-chord
 * ceiling is correct by construction and checkable on a sample in milliseconds.
 * `progression-generate.spec.ts` is where that property is proved.
 *
 * The figures above are reproducible with `client/tools/measure-chord-reach.cjs`,
 * which last ran on **2026-09-10** and measured, over 236,432,196 chords in 203
 * seconds, a reach of **58** and a lowest per-chord ceiling of **octave 0**. The
 * shipped set - 5,613,300 chords, 4 seconds - reaches 46 and is never held below
 * `OCTAVE_MAX` at all: exactly one chord in the whole model loses an octave to
 * this, which is the trade the per-chord ceiling was taken for.
 *
 * The bottom is taste, and the spec pins it as taste rather than deriving it:
 * `voiceChord` never voices below its base, so the MIDI floor would permit
 * anything down to -5 and says nothing about where to stop. C2 is where the
 * musical argument stops - below the low E of a guitar in standard tuning, and
 * chords voiced under it are mud rather than music.
 */
export const OCTAVE_MIN = -2;
export const OCTAVE_MAX = 1;

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
 * The shortest a note the roll draws may be, in beats.
 *
 * `MIN_SLOT_BEATS` says in as many words that a slot's floor is not a note's,
 * and leaves the note's to the setters that produce them. This is that floor,
 * and it is derived rather than chosen: `FinestDivision` tops out at 64, so the
 * finest event `quantizeBar` can express in 4/4 is a sixty-fourth note - one
 * sixteenth of a beat. Anything shorter is a note M2 Task 11's notation preview
 * has no symbol for, so the roll should not let a drag make one.
 *
 * **The derivation is 4/4's, and this constant is not.** A beat is a quarter
 * note only where the denominator is 4; `quantizeBar` takes a time signature,
 * and in 6/8 the beat a `RollNote` counts in is a dotted quarter, which makes
 * one sixteenth of it a ninety-sixth note rather than a sixty-fourth. So the
 * floor is finer than the finest notatable event in compound meter and coarser
 * in nothing the app offers - safe in the direction that matters, but no longer
 * the tight bound the paragraph above describes. Task 11 is where that starts
 * to matter, and a floor derived per signature is what it would want.
 *
 * It has to be strictly positive whatever its value, which the notation
 * argument gives for free: `buildSchedule` hands `lengthBeats` to Tone as a
 * duration, where 0 is a note that never sounds and a negative one is a note
 * that ends before it starts.
 *
 * There is no maximum, for the same reason `normalizeLengthBeats` has none -
 * and for one more. A note may legitimately hang past the end of the slot that
 * holds it: `retimeNotes` leaves one there through a resize deliberately, and a
 * ceiling here would drag it back in the moment anything else about it moved.
 */
export const MIN_NOTE_BEATS = 1 / 16;

/**
 * The ends of MIDI velocity, as `RollNote.velocity` documents it.
 *
 * The bottom is 1 rather than 0 because a MIDI note-on at velocity 0 is a note
 * *off*: it names silence rather than the quietest sound, and a velocity drag
 * that bottomed out there would delete the note in all but name.
 *
 * These are applied by `boundVelocity` in `progression-edit.ts` rather than by
 * `normalizeRollNote` below, which bounds nothing - and velocity is clamped
 * where `midi` is deliberately not. The asymmetry has a reason: `gainOf` in the
 * player already clamps velocity into 0-1 on the way to Tone, so a stored 500
 * would be a document claiming something the synth does not do. A `midi` out of
 * range has no such downstream clamp - what is stored is what is heard - so
 * storing it is honest where storing an out-of-range velocity is not.
 */
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;

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
 * The enumerated-set clause again, one field over.
 *
 * `quality` was the one member of a `ChordDegree` this function let through
 * untouched, which made `replaceDocument` a door for a value the type says
 * cannot exist. An arbitrary string reaches `QUALITY_INTERVALS[quality]` as
 * `undefined` and throws a raw `TypeError` off `shape.length` - from the audio
 * path, three layers downstream, naming neither the field nor the document it
 * came from. `NamedQuality` is a union rather than a range, so there is no
 * nearest legal value to clamp to and the answer is `extent`'s.
 *
 * `null` is legal and is not a missing value: it is what a fresh slot carries
 * and it means "as the key gives it".
 *
 * **`'other'` is refused**, and it is the one member of `ChordQuality` that is.
 * The field is the user's *override* and `'other'` names no interval set to
 * override with - `chordPitchClasses` says so outright, and the whole audio
 * path below agrees. It was accepted while `regenerateSlot` wrote the *derived*
 * label into this same field, where Hungarian minor's second degree derives as
 * `'other'` and refusing it would have made that chord unopenable;
 * `generateSlotNotes` then had to read a stored `'other'` back as no override
 * to keep the builder from throwing. All three are one arrangement, and M2 Task
 * 4 removed the write it rested on. This is the guard that lets the laundering
 * go with it.
 */
function requireQuality(quality: NamedQuality | null): NamedQuality | null {
  if (quality === null) return null;
  if (!NAMED_QUALITIES.includes(quality)) {
    throw new Error(
      `ChordDegree quality must be null or one of ${NAMED_QUALITIES.join(', ')}; ` +
        `got ${quality}`
    );
  }
  return quality;
}

/**
 * A chord with nothing pinned above the seventh: the value a fresh slot
 * carries, and the fifth clause's fill for an absent record.
 *
 * A function rather than a shared constant, for `createOwnership`'s reason:
 * `structuredClone` undo is only safe while no two documents point at the same
 * object, and a shared record would be handed to every slot the factory makes.
 * It lives here rather than beside `ExtensionAlterations` for `createOwnership`'s
 * other reason - left in the model it would be the one value these guards
 * needed from there, and so the one thing that would make that type-only cycle
 * real.
 */
export function createExtensions(): ExtensionAlterations {
  return { ninth: null, eleventh: null, thirteenth: null };
}

/**
 * The runtime twins of the three alteration unions and of `SuspensionKind`.
 *
 * Written out rather than derived, because unlike `NAMED_QUALITIES` there is no
 * table keyed on these types for a list to fall out of. That makes each one a
 * second statement of its union, so the spec pins them against it: a member
 * added to a union and not to the list here would be storable in the type and
 * refused at the door.
 */
const NINTH_ALTERATIONS: readonly NinthAlteration[] = [-1, 0, 1];
const ELEVENTH_ALTERATIONS: readonly EleventhAlteration[] = [0, 1];
const THIRTEENTH_ALTERATIONS: readonly ThirteenthAlteration[] = [-1, 0];
export const SUSPENSIONS: readonly SuspensionKind[] = ['none', 'sus2', 'sus4'];

/**
 * The enumerated-set clause on a field that has been stored unchecked since M1.
 *
 * It was defensible while nothing read it - `generateSlotNotes` said in as many
 * words that a suspension was stored and not sounded - and it stops being
 * defensible the moment `chordPitchClasses` reads it. An unlisted value there
 * falls through the `!== 'none'` test into the diatonic third, so a document
 * carrying `'sus9'` would sound a plain triad under a card that says it is
 * suspended: a wrong chord dressed as a right one, which is what every guard in
 * this file exists to turn into a failure.
 *
 * Absence throws rather than filling, and the distinction is the fifth clause's:
 * this field is as old as `ChordDegree`, so no document was ever written
 * without it and a missing one is corruption rather than migration.
 */
function requireSuspension(suspension: SuspensionKind): SuspensionKind {
  if (!SUSPENSIONS.includes(suspension)) {
    throw new Error(
      `ChordDegree suspension must be one of ${SUSPENSIONS.join(', ')}; got ${suspension}`
    );
  }
  return suspension;
}

/**
 * Fills in a degree's extension alterations when the record is absent, and
 * checks each member when it is not.
 *
 * The two clauses meet here, and the split is `normalizeOwnership`'s exactly.
 * The **record** absent is the fifth clause: `extensions` was added to
 * `ChordDegree` at M3, so a document written before it has none at all, and the
 * safe default is the value a fresh slot carries. A **member** present and
 * outside its union is the fourth clause: each is a union rather than a range,
 * so there is no nearest legal value to clamp to, and a `2` on the ninth would
 * reach `chordPitchClasses` as a real displacement and build a chord no name
 * fits. `undefined` on one member is caught by the same test - a record present
 * but missing a member is half-written rather than old.
 *
 * `null` is legal on every member and is not a missing value: it is what a
 * fresh slot carries and it means "as the key gives it".
 *
 * Rebuilt rather than passed through, so a document already on the
 * `structuredClone` undo stack is not left sharing a record with the one that
 * replaced it - the promise `normalizeOwnership` and `normalizeChordSlot` make.
 */
function normalizeExtensions(
  extensions: ExtensionAlterations | undefined
): ExtensionAlterations {
  if (extensions === undefined) return createExtensions();
  return {
    ninth: requireAlteration(extensions.ninth, NINTH_ALTERATIONS, 'ninth'),
    eleventh: requireAlteration(extensions.eleventh, ELEVENTH_ALTERATIONS, 'eleventh'),
    thirteenth: requireAlteration(
      extensions.thirteenth,
      THIRTEENTH_ALTERATIONS,
      'thirteenth'
    )
  };
}

function requireAlteration<T extends number>(
  value: T | null,
  allowed: readonly T[],
  extension: string
): T | null {
  if (value === null) return null;
  if (!allowed.includes(value)) {
    throw new Error(
      `ChordDegree extensions ${extension} must be null or one of ` +
        `${allowed.join(', ')}; got ${value}`
    );
  }
  return value;
}

/**
 * The cross-field half of design decision 1: a displaced root needs a shape.
 *
 * Neither field is wrong on its own - `alter` is a bounded integer and `null` is
 * the quality every fresh slot carries - and only the pair names nothing to
 * build. `chordPitchClasses` refuses the same pair, and keeping both is
 * deliberate rather than redundant: that one guards the arithmetic against a
 * caller, this one guards the *document* against a file. Without it,
 * `replaceDocument` accepted the pair, stored it, and threw from the audio path
 * on whatever edit next regenerated the slot - which is the failure the first
 * clause of the rule above exists to move back to where it was introduced.
 *
 * `null` is the only quality it has to refuse, because it is the only one left
 * that names no shape. `'other'` used to be refused beside it, with a message
 * saying which had arrived; `requireQuality` above now turns that value away
 * before this guard is reached, which is the stronger place for it - `'other'`
 * carries no root either, so there was never a pairing that made it legal.
 */
function requireBuildableRoot(alter: number, quality: NamedQuality | null): void {
  if (alter === 0) return;
  if (quality !== null) return;

  throw new Error(
    `A chromatic ChordDegree needs a quality that names a shape; got alter ` +
      `${alter} with quality null`
  );
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
 * The roll's setters, which claim a dimension without rebuilding a slot, are
 * the first of them.
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
 * audible as silence. Ownership reaches no such road. Its one reader is
 * `regenerateSlot`, which merges rather than replaces and asks this record
 * which dimensions to re-derive. The safe answer to "I cannot tell" is the
 * value a fresh slot already carries - own nothing, regenerate everything -
 * which is a defined default where a `NaN` octave has none.
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

/**
 * The first clause of the rule above, applied to the notes themselves.
 *
 * **This was owed from the commit that made regeneration a merge**, and until
 * then it genuinely was not. While every note was rebuilt wholesale from the
 * degree on every regeneration, a bad one arriving through `replaceDocument`
 * was scrubbed by the next edit and there was nothing a check could catch that
 * the rebuild did not already remove. `mergeNotes` is the first code that
 * carries a caller-supplied `RollNote` *through* a regeneration: a note with
 * `midi: NaN` on a slot claiming `pitches` is now preserved by that
 * regeneration and by every one after it, silent on `Tone.PolySynth` and
 * indistinguishable from a chord the user muted.
 *
 * The asymmetry that made it obvious sits inside one function.
 * `regenerateSlot` throws on a `transposeBy` that is not an integer, arguing
 * that a `NaN` reaching `RollNote.midi` "is silence rather than an error, three
 * layers from the caller" - and then adds that checked delta to a `note.midi`
 * nothing had checked. The guard was right; the operand was the hole.
 *
 * ## Kind is checked here; range is deliberately not
 *
 * Every check below is the wrong-kind clause and nothing more. Nothing is
 * clamped, and the ranges are deliberately open:
 *
 *  - **`midi` is not bounded to 0-127.** This used to be argued from the
 *    transposition - `regenerateSlot` adds `transposeBy` afterwards, so
 *    bounding one end of an open sum buys a false sense of a guarded pitch -
 *    and that argument had the sum the wrong way round. Each term was bounded
 *    already; the *accumulator* was `RollNote.midi` itself, and it is bounded
 *    now by `anchoredShift`, which re-anchors a transposed voicing onto the
 *    chord the new key generates instead of adding to it for ever.
 *
 *    What is left is the reason a range check here would be wrong rather than
 *    merely incomplete: a clamp applied note by note collapses a voicing onto
 *    its ceiling, silently turning a chord into a cluster. `OCTAVE_MAX` refuses
 *    that for the generator and bounds the generator's *input* instead - the
 *    choice its own note argues at length - and the anchor is the same choice
 *    made for a claimed voicing. Where a pitch drag stops on screen is the
 *    roll's geometry to decide; see `boundNote` in `progression-edit.ts`.
 *  - **`lengthBeats` and `velocity` are not clamped** for the reason
 *    `MIN_SLOT_BEATS` is a slot's floor and not a note's: the ends a drag
 *    should rest on belong with the setters that produce them, and inventing
 *    them here would be this file deciding what a note gesture means. Those
 *    setters exist now - `ProgressionService.setNoteTiming` and
 *    `setNoteVelocity` - and the bounds they apply are `MIN_NOTE_BEATS` and
 *    `VELOCITY_MIN`/`VELOCITY_MAX` above, through `boundNote` in
 *    `progression-edit.ts`. This guard stays the kind check underneath them,
 *    which is what catches the values a clamp cannot fix: `Math.max(1, NaN)` is
 *    `NaN`, so clamping alone would swallow exactly the case it is aimed at.
 *
 * A negative `startBeat` is refused rather than left open, because it is not a
 * control at its limit: a note before the start of the slot that holds it is
 * outside the slot, not at the end of it. That is `requireStartBeat`'s argument
 * one frame down - these offsets are relative to the slot's own start.
 *
 * The four fields are listed rather than spread, so a field added to `RollNote`
 * is a compile error here rather than a value this rule quietly stops covering
 * - the device `sameDegree` uses for the same purpose.
 */
function normalizeRollNote(note: RollNote, index: number): RollNote {
  const midi = note.midi;
  if (!Number.isInteger(midi)) {
    throw new Error(`RollNote ${index} midi must be a whole MIDI note number; got ${midi}`);
  }

  const startBeat = note.startBeat;
  if (!Number.isFinite(startBeat) || startBeat < 0) {
    throw new Error(
      `RollNote ${index} startBeat must be a finite offset at or after the slot's ` +
        `start; got ${startBeat}`
    );
  }

  const lengthBeats = note.lengthBeats;
  if (!Number.isFinite(lengthBeats)) {
    throw new Error(
      `RollNote ${index} lengthBeats must be a finite duration; got ${lengthBeats}`
    );
  }

  const velocity = note.velocity;
  if (!Number.isFinite(velocity)) {
    throw new Error(
      `RollNote ${index} velocity must be a finite MIDI velocity; got ${velocity}`
    );
  }

  return { midi, startBeat, lengthBeats, velocity };
}

/**
 * Checks every note on a slot, and hands back an array that shares nothing with
 * the one it was given.
 *
 * The container is checked before the contents because a missing `notes` is not
 * `owned`'s migration case - the field is as old as `ChordSlot` and no document
 * was ever written without it - so it is corruption, and `.map` of `undefined`
 * would report it as a `TypeError` naming neither the field nor the slot.
 */
function normalizeNotes(notes: RollNote[]): RollNote[] {
  if (!Array.isArray(notes)) {
    throw new Error(`ChordSlot notes must be an array of RollNote; got ${notes}`);
  }
  return notes.map((note, index) => normalizeRollNote(note, index));
}

function normalizeChordDegree(degree: ChordDegree): ChordDegree {
  const extent = requireExtent(degree.extent);
  const alter = clamp(requireInteger(degree.alter, 'alter'), ALTER_MIN, ALTER_MAX);
  const quality = requireQuality(degree.quality);
  // Judged on the alteration that will be *stored*, not the one that arrived:
  // an out-of-range `alter` is clamped above and the pair is only meaningful
  // against the value the document ends up holding.
  requireBuildableRoot(alter, quality);

  return {
    ...degree,
    degree: requireDegreeIndex(degree.degree),
    alter,
    extent,
    quality,
    suspension: requireSuspension(degree.suspension),
    extensions: normalizeExtensions(degree.extensions),
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
 * The copy is shallow in one place only: a literal slot's `harmony` is the same
 * object it arrived as, where the degree branch, `owned` and `notes` all build
 * fresh ones. Enough for the undo stack, which deep-clones on the way in.
 *
 * `notes` used to be shared and unchecked, and this docstring used to argue
 * that both were safe because M1 regenerated every note wholesale from the
 * fields above. **M2 Task 4 ended that** - `mergeNotes` carries a
 * caller-supplied note through a regeneration, so an unchecked one now
 * persists rather than being scrubbed by the next edit. The two went together
 * exactly as this note predicted they would: `normalizeRollNote` is the check,
 * and rebuilding each note is the copy, in one pass. What it does *not* do is
 * bound anything, and that line is drawn there rather than here.
 */
export function normalizeChordSlot(slot: ChordSlot): ChordSlot {
  const timed: ChordSlot = {
    ...slot,
    startBeat: requireStartBeat(slot.startBeat),
    lengthBeats: normalizeLengthBeats(slot.lengthBeats),
    // Both before the literal branch returns, so both kinds of slot get them.
    // A literal slot's notes are the only thing it has, which makes it the kind
    // that can least afford an unchecked one.
    notes: normalizeNotes(slot.notes),
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

