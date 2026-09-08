// Split so the one runtime edge is visible; see the layering note below.
import type { ChordExtent, ChordQuality } from '../services/progression-harmony';
import { noteCount } from '../services/progression-harmony';
import { TimeSignature } from './composer.model';

/**
 * The progression document: a key, a tempo, and an ordered run of chord slots.
 *
 * This is the composer's counterpart, not its rival. `ScoreDoc` is notation -
 * bars, voices, beats - and answers "what is written". `ProgressionDoc` is
 * harmony over time and answers "what is playing". The two coexist, and the
 * arrow between them runs one way, through `quantizeBar` in M2.
 *
 * Only the document root carries the `Doc` suffix, where `composer.model.ts`
 * puts it on every type. The suffix is there to separate our types from
 * alphaTab's runtime classes of the same name, and nothing here has an alphaTab
 * twin except the root, which sits beside `ScoreDoc` and would otherwise read
 * as a `Progression` domain object rather than as a saved document.
 *
 * Three load-bearing choices, carried over from the design doc:
 *
 *  1. **`notes` is always present and always authoritative for playback;
 *     `harmony` labels and generates it.** Changing the harmony regenerates the
 *     notes; editing the notes re-runs the recogniser against the harmony
 *     (M3). Neither direction needs the other to be clean, and disagreement is
 *     representable rather than silent - that is what `literal` is for.
 *  2. **`RollNote` is MIDI, not `NotePitch`.** The roll is pitch space. Fret and
 *     string assignment is a notation concern, applied downstream where
 *     `assignFingering` already does it well.
 *  3. **Spelling comes from the degree, not from the pitch.** A degree slot
 *     knows that bVII in A minor spells G-B-D.
 *
 * `ChordQuality` and `ChordExtent` are imported from `progression-harmony.ts`
 * rather than redeclared, because a second copy of either would be a second
 * definition of the same concept - the thing the project rules forbid outright.
 * That does leave a model importing from `services/`, which is not a first:
 * `transcription.model.ts` already reaches into `transcription-harmonics.ts`
 * for `HarmonicOptions`, and for the same reason - a type produced by a module
 * belongs beside the code whose rules decide what values it can take, and
 * splitting the two is how they drift apart. The import is split the way that
 * file splits its own, and for the reason recorded there: a type-only import is
 * erased, so the dependency it would otherwise create never exists at runtime.
 * That leaves `noteCount` as the one genuine runtime edge, visible rather than
 * hidden among the types, and it carries no Angular or audio dependency.
 *
 * ## The normalisation rule
 *
 * Every numeric field that can reach the audio layer is checked in one place -
 * `normalizeChordSlot` for a slot, `normalizeProgressionDoc` for the document
 * around it - under a single rule with four clauses:
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
 *
 * `normalizeProgressionDoc` is what makes the rule a mechanism rather than a
 * convention: Task 5's `commit()` calls it on every mutation, so the funnel has
 * one call site instead of eleven setters each remembering to opt in.
 */

/** The key a progression is in. `tonic` is 0-11, C through B. */
export interface ProgressionKey {
  tonic: number;
  /**
   * A scale id from `MusicTheoryService` - `'ionian'`, `'aeolian'` - not a
   * display name. The palette looks the intervals up by this id, so an id that
   * does not resolve there leaves the page with no chords to offer.
   */
  scaleId: string;
  preferSharps: boolean;
}

export interface ProgressionDoc {
  id: string;
  name: string;
  key: ProgressionKey;
  /** BPM. */
  tempo: number;
  /** Reused from `composer.model.ts`; a bar means the same thing on both pages. */
  timeSignature: TimeSignature;
  /** Ordered and contiguous: each slot starts where the previous one ended. */
  slots: ChordSlot[];
}

export interface ChordSlot {
  id: string;
  /** The label, and the generator. */
  harmony: SlotHarmony;
  /** Absolute position in the progression, in beats. Float. */
  startBeat: number;
  lengthBeats: number;
  /** The playback truth. Beats here are relative to the slot's own start. */
  notes: RollNote[];
  /**
   * Set once the user edits the notes directly. A key change regenerates an
   * untouched degree slot but *transposes* a hand-edited one, which is the only
   * option that neither discards the user's work nor breaks the key change.
   * Nothing in M1 can set it - the piano roll that does arrives in M2.
   */
  isHandEdited: boolean;
}

/**
 * `literal` is the honest failure. A slot whose notes no longer match any chord
 * in the neighbourhood of its degree keeps its notes and loses its label,
 * rather than being given a Roman numeral the app is not sure of.
 */
export type SlotHarmony =
  | { kind: 'degree'; degree: ChordDegree }
  | { kind: 'literal'; reason: 'unrecognised' | 'user-detached' };

/** Suspensions are stored in M1 but not sounded until M2. */
export type SuspensionKind = 'none' | 'sus2' | 'sus4';

export interface ChordDegree {
  /**
   * Scale degree, **0-6**, indexing the scale's interval array directly - the
   * same domain `degreePitchClasses` takes. The design doc says "1-7"; that is
   * stale, and the plan's own tests build a I chord from degree 0.
   */
  degree: number;
  /** Chromatic shift of the whole chord, in semitones. bVII is degree 6, alter -1. */
  alter: number;
  /** How far the thirds are stacked. The +/- complexity buttons move this. */
  extent: ChordExtent;
  /**
   * The chord's name. Defaults from the key; overriding it is what makes a
   * borrowed chord.
   *
   * In M1 this is a label only. `generateSlotNotes` derives the pitches from
   * the scale, so it reads the degree and the extent and never this field - a
   * slot created before its key is known therefore carries a placeholder until
   * the palette fills it in from `degreeQuality`.
   */
  quality: ChordQuality;
  /** Root position is 0. Stored wrapped into the chord, so it is always nameable. */
  inversion: number;
  suspension: SuspensionKind;
  /** Octave shift applied to the voicing base. 0 sounds from middle C. */
  octave: number;
}

export interface RollNote {
  midi: number;
  /** Relative to the slot's start, in beats. Float. */
  startBeat: number;
  lengthBeats: number;
  /** MIDI velocity, 1-127. */
  velocity: number;
}

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
 * *stepper's* job - Task 5's `setSlotExtent` owns that, not this guard.
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
 * literal slot's `harmony` is the same object too, where the degree branch does
 * build a fresh one. Enough for the undo stack, which deep-clones on the way
 * in; not enough for a caller assuming it may now edit `notes` in place.
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
    lengthBeats: normalizeLengthBeats(slot.lengthBeats)
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
 * This is the funnel's intended call site: Task 5's `ProgressionService` routes
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
    key: { ...doc.key, tonic: normalizeTonic(doc.key.tonic) },
    tempo: normalizeTempo(doc.tempo),
    slots: doc.slots.map(slot => normalizeChordSlot(slot))
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Ids are UUIDs rather than the `${prefix}-${Date.now()}-${Math.random()}`
 * shape used elsewhere in the app: slots are created in bursts as fast as a
 * user can click, which is the one situation where a millisecond timestamp
 * stops contributing anything and the whole id rests on six random characters.
 *
 * `crypto.randomUUID` needs a secure context, which https and localhost both
 * are. A build served over plain http from anything else would not have it.
 */
function createId(): string {
  return crypto.randomUUID();
}

/**
 * An empty progression in C major.
 *
 * C ionian is what `MusicTheoryService` itself starts on, so the page opens
 * agreeing with the fretboard behind it rather than moving it on first render.
 */
export function createDefaultProgression(): ProgressionDoc {
  return {
    id: createId(),
    name: 'Untitled',
    key: { tonic: 0, scaleId: 'ionian', preferSharps: true },
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4, isCommon: true },
    // Built per call, not hoisted to a shared constant: `structuredClone` undo
    // is only safe while no two documents point at the same array.
    slots: []
  };
}

/**
 * A slot for a diatonic degree, untouched: a triad in root position, one bar
 * long, sounding from middle C.
 *
 * `notes` starts empty. Generating them needs the key and the scale, which this
 * factory has no business knowing - `generateSlotNotes` fills them in.
 *
 * `quality` starts as `'major'` for the same reason: the real quality comes from
 * the scale, and the caller that knows the scale overwrites it. Nothing in M1
 * reads the field before then.
 */
export function createDegreeSlot(degree: number, startBeat: number): ChordSlot {
  return normalizeChordSlot({
    id: createId(),
    harmony: {
      kind: 'degree',
      degree: {
        degree,
        alter: 0,
        extent: 3,
        quality: 'major',
        inversion: 0,
        suspension: 'none',
        octave: 0
      }
    },
    startBeat,
    lengthBeats: BEATS_PER_SLOT_DEFAULT,
    notes: [],
    isHandEdited: false
  });
}
