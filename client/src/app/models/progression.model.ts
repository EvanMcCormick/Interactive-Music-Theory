import { ChordExtent, ChordQuality, noteCount } from '../services/progression-harmony';
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
 * That does leave a model importing from `services/`, which no other model does.
 * The alternative was to move the two types down here, and that is worse: they
 * are *produced* by the harmony module, whose rules decide which qualities can
 * exist at all, and splitting a type from the code that establishes its domain
 * is how the two drift apart. The import is type-only in substance - `noteCount`
 * is the single value crossing - and carries no Angular or audio dependency, so
 * nothing about the layering is actually inverted.
 *
 * ## The normalisation rule
 *
 * Every numeric field that can reach the audio layer is checked in one place,
 * `normalizeChordSlot`, under a single rule:
 *
 *  - **A value of the wrong kind is a bug, and throws.** `NaN` or `undefined` in
 *    a chord's pitch data runs through `voiceChord` untouched into
 *    `RollNote.midi` and on to `Tone.PolySynth`, which is precisely the failure
 *    `degreePitchClasses` already guards its own `degree` against. Throwing puts
 *    the error where it was introduced rather than three layers downstream.
 *  - **A value of the right kind that is out of range is a control at its limit,
 *    and is clamped or wrapped.** Pressing "octave up" at the top of the range
 *    should do nothing, not crash.
 *
 * Every path that produces a `ChordSlot` should end here, which is why the
 * factory below does too.
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

/** Middle C. Where voicings are stacked from before `octave` shifts them. */
export const VOICING_BASE_MIDI = 60;

/**
 * How far the octave control may shift the voicing base, in octaves.
 *
 * The top is arithmetic rather than taste. `voiceChord` has no MIDI clamp, so
 * this is the last line before a note reaches `Tone.PolySynth`. Across all 33
 * heptatonic scales the app offers, every degree, every extent and every
 * inversion, the highest note a chord can reach is 32 semitones above the base
 * - a 9th on the enigmatic scale, third inversion. `OCTAVE_MAX` of 2 puts the
 * base at C6 and that ceiling at 116; 3 would put it at 128 and off the end of
 * MIDI. The spec proves both halves, so a new scale that widened the stack
 * would fail rather than clip.
 *
 * The bottom is symmetric rather than pushed to the MIDI floor. C2 is already
 * below the low E of a bass in standard tuning, and chords voiced under it are
 * mud rather than music.
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

function requireLengthBeats(lengthBeats: number): number {
  // Strictly positive: a zero-length slot sounds nothing, occupies no time and
  // makes the contiguity re-flow a no-op, so it can only ever be a mistake.
  if (!Number.isFinite(lengthBeats) || lengthBeats <= 0) {
    throw new Error(
      `ChordSlot lengthBeats must be a finite duration above 0; got ${lengthBeats}`
    );
  }
  return lengthBeats;
}

function requireDegreeIndex(degree: number): number {
  // The domain `degreePitchClasses` enforces, checked here as well so a bad
  // degree fails when the slot is built rather than when it is first sounded.
  if (!Number.isInteger(degree) || degree < 0 || degree > 6) {
    throw new Error(`ChordSlot degree must be a scale degree from 0 to 6; got ${degree}`);
  }
  return degree;
}

function requireExtent(extent: ChordExtent): ChordExtent {
  // Not belt-and-braces over the union: `noteCount` reads an unlisted extent as
  // a fractional note count, and `degreePitchClasses` then loops past it and
  // returns a chord with a note too many. A wrong chord, not a crash.
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
  const count = noteCount(extent);
  return ((inversion % count) + count) % count;
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
 * Returns a copy rather than editing in place, so it composes with the
 * `structuredClone` undo stack instead of quietly amending a document that is
 * already on it.
 *
 * `notes` is not checked. In M1 they are generated from the fields above, which
 * are checked, so there is nothing a check here could catch. The moment the
 * piano roll lets a user move them by hand - M2 - that stops being true, and
 * this is where the check belongs.
 */
export function normalizeChordSlot(slot: ChordSlot): ChordSlot {
  const timed: ChordSlot = {
    ...slot,
    startBeat: requireStartBeat(slot.startBeat),
    lengthBeats: requireLengthBeats(slot.lengthBeats)
  };

  // A literal slot has no degree to check. Its timing still matters.
  if (timed.harmony.kind !== 'degree') return timed;

  return {
    ...timed,
    harmony: { kind: 'degree', degree: normalizeChordDegree(timed.harmony.degree) }
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
