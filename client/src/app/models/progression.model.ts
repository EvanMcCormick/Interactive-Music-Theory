// Split by kind so the one runtime edge is visible: every import above
// `progression-normalize` is a type and is erased. See the layering note below.
import type { ChordExtent, ChordQuality } from '../services/progression-harmony';
import type { Scale } from './music-theory.model';
import { TimeSignature } from './composer.model';
import {
  BEATS_PER_SLOT_DEFAULT,
  createOwnership,
  normalizeChordSlot
} from './progression-normalize';

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
 * splitting the two is how they drift apart. It costs nothing to do: a
 * type-only import is erased, so the dependency it would otherwise create
 * never exists at runtime.
 *
 * ## Where the bounds and the guards went
 *
 * `progression-normalize.ts` holds them, together with the five-clause rule
 * they implement. They were here, and the rule read worse for it: its second
 * clause names `OCTAVE_MIN` some three hundred lines before the constant
 * appeared, with every type declaration below in between. The move puts the
 * rule, the numbers its clauses name and the code that enforces them in one
 * file, which is what the split was for - not the line count. Roughly three
 * lines in five of this file are prose, and the argument for a number is worth
 * as much as the number.
 *
 * The two files are not free of each other, and the split is arranged so the
 * dependency runs one way. `createDegreeSlot` below calls `normalizeChordSlot`,
 * so this file imports it at runtime; `progression-normalize.ts` imports these
 * types straight back, but only as `import type`, which is erased. The cycle
 * exists for the type checker and nowhere else - the same device this file
 * already uses on `progression-harmony.ts`.
 *
 * `createOwnership` went with them, and against its own inclination: it builds
 * `SlotOwnership` and belongs beside it. But it is also the safe default the
 * rule's fifth clause fills an absent record with, and `normalizeOwnership`
 * calls it. Left here it would be the one value those guards needed from this
 * file, and so the one thing that would make that cycle real.
 */

/** The key a progression is in. `tonic` is 0-11, C through B. */
export interface ProgressionKey {
  tonic: number;
  /**
   * A scale id from `MusicTheoryService` - `'ionian'`, `'aeolian'` - not a
   * display name. `ProgressionService` resolves it once and publishes the scale
   * on `ProgressionState.keyScale`, so an id that does not resolve leaves the
   * page with no chords to offer rather than throwing somewhere downstream.
   */
  scaleId: string;
  /**
   * How this progression spells its own notes, and the *key's* answer rather
   * than the app's.
   *
   * A key signature is a property of the key and not of the scale shape, so
   * this is derived by `keySignatureKind` from the tonic and the mode together
   * - E flat ionian carries three flats however `preferSharps` is set on the
   * ionian scale, which is `true`. Filling it from the scale's own default
   * instead is what printed `D♯ Maj` as the tonic chord of E flat major.
   *
   * It is stored on the key rather than asked of `MusicTheoryService` at each
   * render because the two selections are allowed to differ: the fretboard has
   * a key of its own, and a progression must be spelled correctly on its own
   * terms rather than only while the two happen to agree.
   */
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
  /** Which dimensions of this slot the user has claimed. See `SlotOwnership`. */
  owned: SlotOwnership;
}

/**
 * Which dimensions of a slot the user owns.
 *
 * Replaces M1's single `isHandEdited` boolean, which forced a bad trade in both
 * directions. Read literally, one velocity nudge opted a slot out of re-voicing
 * forever, so the next key change left it sounding the old key's chord. Read
 * narrowly - only pitch edits count - a hand-built rhythm was destroyed by that
 * same key change. Both losses are real, and neither is the one the user meant.
 *
 * Tracking the three separately is what will make regeneration a **merge**
 * rather than a replace, so that a groove written in C survives a switch to A
 * minor while the chords re-voice underneath it - the whole point of storing
 * degrees rather than notes. Nothing reads this field yet: `regenerateSlot`
 * still replaces a slot wholesale, and becomes that merge in M2 Task 4.
 *
 * The dimensions are the three a piano roll edit can move independently, and
 * they partition a `RollNote`: `midi` is pitch, `startBeat` and `lengthBeats`
 * are timing, `velocity` is velocity. A field added to `RollNote` that fits none
 * of them would need a fourth here rather than to be folded into one.
 *
 * Ownership is per slot rather than per note, because regeneration is per slot:
 * a re-voiced chord is a different set of notes, so there is no note to carry an
 * ownership flag across the change.
 */
export interface SlotOwnership {
  /** Notes moved in pitch, added or removed. */
  pitches: boolean;
  /** Note starts or lengths changed within the slot. */
  timing: boolean;
  /** Velocities changed. */
  velocity: boolean;
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
  /**
   * Chromatic shift of the **whole chord**, in semitones.
   *
   * Every note moves together, so this is a transposition, and transposition
   * preserves quality. That is the whole of what the field does, and it is less
   * than a Roman numeral's accidental needs: an accidental displaces the *root*
   * and leaves the case to carry the quality, which no uniform shift can do.
   * So this field cannot express a borrowed chord. Degree 6 of a major scale is
   * a diminished triad, and altered down a semitone it is a diminished triad on
   * Bb rather than the Bb major chord bVII names; bVI, bIII and the Neapolitan
   * bII all come out minor, and #iv-dim comes out major. Overriding `quality`
   * is what a borrowed chord actually needs, and M1 has no mechanism for it -
   * see the note in `progression-generate.ts`.
   *
   * What is left is real but small. `alter` and `key.tonic` are both added to
   * every pitch class in `generateSlotNotes` and compose into one offset, so
   * this field reaches no harmony the key does not already reach - the same
   * diatonic chord, spelled as though the key were a tone away. Its value is
   * that it moves one slot rather than all of them, not that it adds a chord.
   */
  alter: number;
  /** How far the thirds are stacked. The +/- complexity buttons move this. */
  extent: ChordExtent;
  /**
   * The chord's name, as the key gives it.
   *
   * In M1 this is a label only, and a *derived* one. `generateSlotNotes` reads
   * the degree and the extent and never this field, and
   * `ProgressionService.regenerate` recomputes it from `degreeQuality` on every
   * change that could move it - the key, the extent, the inversion, the octave.
   * So the placeholder `createDegreeSlot` writes survives only until the slot
   * reaches the service, and there is nowhere a value written here can persist.
   *
   * **Which is why this field cannot yet override anything.** The design says
   * overriding the quality is what makes a borrowed chord, and that is right -
   * `alter` transposes the whole stack and so preserves quality, which no
   * accidental in a Roman numeral does; see "Correction: `alter` cannot express
   * a borrowed chord" in the design doc. But an override written here is
   * clobbered by the next regeneration, so the mechanism is not merely unread:
   * it is actively overwritten. The fix both halves need is the same one -
   * `quality: ChordQuality | null`, where `null` means "as the key gives it"
   * and a non-null value survives regeneration and reaches the generator - and
   * it is M2 work. Latent in M1, where no setter moves `alter` and the palette
   * emits only diatonic degrees.
   */
  quality: ChordQuality;
  /** Root position is 0. Stored wrapped into the chord, so it is always nameable. */
  inversion: number;
  suspension: SuspensionKind;
  /** Octave shift applied to the voicing base. 0 sounds from middle C. */
  octave: number;
}

/**
 * What the progression page renders: the document, plus the three things about
 * it that are true of the page rather than of the file.
 *
 * `ComposerState` is the precedent and the shape is deliberately its shape -
 * `doc` beside a caret and the history flags. Two differences, both of which
 * the composer's own layout argues for:
 *
 *  - **`selectedSlotId` sits beside `doc`, not inside it**, exactly as
 *    `EditCursor` does. It is where the user is rather than what they wrote, so
 *    it does not belong on the undo stack: undoing a chord change should put
 *    the chord back, not move the selection somewhere the user has since left.
 *    It is on the state rather than in the strip component because the strip is
 *    not its only reader - the +/- controls act on the selected slot, and M2's
 *    piano roll opens on it - and the project rules put state shared between
 *    components in the service.
 *  - **`canBuildChords` is derived, and stored anyway.** Whether the key's
 *    scale is heptatonic decides both whether the palette can offer a chord and
 *    whether the service will accept one, and computing it in one place is what
 *    stops those two answers drifting. It is not a second definition of the
 *    rule: it is `isHeptatonic` called once, on the scale the key names.
 *  - **`keyScale` is the scale that `canBuildChords` was decided on**, published
 *    for the same reason and beside it. `ProgressionKey.scaleId` is a string
 *    and resolving it is a loop over every scale category; every consumer that
 *    wants the intervals, the name or the note count would otherwise write that
 *    loop out again, and the palette already had the service's copy of it
 *    verbatim before this field existed.
 *
 * `isDirty` earns its place the way `ProgressionDoc.id` and `.name` do - a
 * document with a name and an id is a document something means to save, and the
 * composer's library is the shape that saving will take.
 */
export interface ProgressionState {
  doc: ProgressionDoc;
  /** The slot the strip has selected, or null. Never an id the doc has lost. */
  selectedSlotId: string | null;
  /** Whether the key's scale can produce diatonic chords at all. */
  canBuildChords: boolean;
  /**
   * The scale `key.scaleId` names, or null when the id names nothing the app
   * knows.
   *
   * Resolved, not filtered: a pentatonic arrives here whole, with
   * `canBuildChords` false beside it. That is what lets the palette say *which*
   * scale it is refusing and how many notes it has, instead of "not seven".
   *
   * Reference data owned by `MusicTheoryService`, handed on by reference. It is
   * to be read and not written, on the same terms as the arrays
   * `getScaleCategories` returns.
   */
  keyScale: Scale | null;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface RollNote {
  midi: number;
  /** Relative to the slot's start, in beats. Float. */
  startBeat: number;
  lengthBeats: number;
  /**
   * MIDI velocity, 1-127.
   *
   * Hazard for the scheduler: `Tone.PolySynth.triggerAttackRelease` takes
   * velocity as a 0-1 gain, not as a MIDI byte. Handing it 80 asks for eighty
   * times full scale and clips hard. The conversion is `/ 127`, and it belongs
   * at the Tone boundary rather than here, so that `RollNote` stays MIDI end to
   * end - the same choice `midi` makes.
   */
  velocity: number;
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
 *
 * `preferSharps: true` is what `ProgressionService.setKey` would derive for
 * this key, and written out rather than derived because a model factory has no
 * scale table to consult: C major's signature is empty, so the ionian scale's
 * own default decides, and that is `true`.
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
 * long, sounding from middle C, owning none of its own dimensions.
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
    owned: createOwnership()
  });
}
