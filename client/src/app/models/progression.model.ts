// Split by kind so the one runtime edge is visible: every import above
// `progression-normalize` is a type and is erased. See the layering note below.
import type { ChordExtent, NamedQuality } from '../services/progression-harmony';
import type { Scale } from './music-theory.model';
import { TimeSignature } from './composer.model';
import {
  BEATS_PER_SLOT_DEFAULT,
  createExtensions,
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
 * `NamedQuality` and `ChordExtent` are imported from `progression-harmony.ts`
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
 *
 * `createExtensions` is there for exactly the same reason, one field over, and
 * the argument is worth repeating rather than assuming: `ExtensionAlterations`
 * is declared below, beside the `ChordDegree` that holds it, while the record
 * of three nulls that is both a fresh slot's value and the fifth clause's fill
 * for an absent one is built there.
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
  /**
   * A number no two documents share, and the whole of the Composer's staleness
   * check.
   *
   * On the document rather than beside it, because undo restores a *document*:
   * a generated track built from revision 4 and then undone back to the
   * document that was revision 4 is current again, and a counter that lived on
   * the store would say stale about a document that had not changed. Issued by
   * one that does not rewind, though - see `ProgressionStore.nextRevision`,
   * which is what stops an undone branch's number being handed to the different
   * document that replaces it.
   *
   * Equality here is not exactly "the generated track would differ". It
   * over-reports: `tempo` and `timeSignature` move it while a merge into an
   * existing score ignores both, a setter called with the value it already holds
   * commits anyway, and this field is itself a field that never reaches the
   * track. "Staleness is one comparison, and it over-reports in the safe
   * direction" in the design doc argues why that is the direction to err in, and
   * is the thing to read before adding a field here.
   */
  revision: number;
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
 * Tracking the three separately is what makes regeneration a **merge** rather
 * than a replace, so that a groove written in C survives a switch to A minor
 * while the chords re-voice underneath it - the whole point of storing degrees
 * rather than notes. `regenerateSlot` holds the table each dimension is
 * answered from and is the reader to start at, but it stopped being the only
 * one: `retimeNotes` asks about `timing`, `ProgressionDegreeEditor.rekey` asks
 * about `pitches` before it will re-express a slot in a new key, and the
 * editors' no-op comparisons ask `sameOwnership` about all three. A dimension
 * added here has four callers to answer for.
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
 *
 * ## It is no longer a one-way door
 *
 * Every command on this page refuses a literal slot - `editDegree` opens with
 * that refusal and `resetSlotToChord` used to - so a recogniser that could
 * degrade a slot would be opening a door with no way out but undo, and undo is
 * gone the moment the user does anything else. `from` is the way back: the
 * degree the slot carried at the moment it lost its label, kept so that Reset
 * to chord can build a block chord from it again, in whatever key the page is
 * in by then.
 *
 * `null` means there is no way back, and it is honest rather than lazy: a
 * document from elsewhere may hold a literal slot that was never a degree at
 * all, and inventing one for it would be the app guessing at a numeral, which
 * is the one thing this variant exists to refuse.
 */
export type SlotHarmony =
  | { kind: 'degree'; degree: ChordDegree }
  | {
      kind: 'literal';
      reason: LiteralReason;
      /**
       * The degree this slot degraded from, or `null` when it had none.
       *
       * **A required key with an optional value**, which is the pair of facts
       * this field actually has and which `from?:` collapsed into one. The
       * *value* may be absent, because the field was added at M3 Task 8 and
       * every slot written before it arrives without one - the fifth clause of
       * the normalisation rule, which `normalizeLiteralHarmony` fills with
       * `null` and `normalizeChordSlot` puts on every slot in the store. The
       * *key* is required because nothing in this app writes a pre-Task-8
       * document: every literal harmony built in this source is built now, by a
       * writer who knows whether it has a degree to keep.
       *
       * `from?:` said only the first, and the second is the one with teeth. Task
       * 8 shipped with eighteen construction sites and every one of them in a
       * spec - not one in production - so a required key would have compiled
       * against the whole app on the day it was added, and the convention it
       * replaced was holding by luck rather than by type. The failure it now
       * cannot have is a writer degrading a slot and forgetting the field, which
       * is a slot with no way back at all: `resetSlotToChord` refuses it, every
       * command on the page refuses it, and undo is gone the moment the user
       * does anything else.
       *
       * `literalHarmony` is still the door for code that writes one, and still
       * takes the degree as a required argument. What has changed is that the
       * door is no longer the only thing holding the guarantee.
       *
       * Readers still write `?? null` rather than trusting the fill, because a
       * caller may hold a slot it has just built - and because a document parsed
       * from a file is `undefined` here at runtime whatever this type says.
       */
      from: ChordDegree | null | undefined;
    };

/**
 * Why a slot has no numeral: the recogniser could not name its notes, or the
 * user said it is notes rather than a chord.
 *
 * Named rather than written inline because three files now narrow on it - the
 * strip's card, the recogniser's quiet clause, and the factory below.
 */
export type LiteralReason = 'unrecognised' | 'user-detached';

/**
 * A slot's harmony as `literal`, keeping the degree it degraded from.
 *
 * The argument is required, and so - since the review of 2026-09-10 - is the
 * field. Absence is a *migration*, a document written before M3 Task 8, and
 * nothing in this app writes one of those; a caller here always knows whether it
 * has a degree to keep, and passing `null` should be a decision rather than a
 * line nobody wrote. `setKey`'s degradation and Task 9's keep-as-literal both
 * have one, and both would compile without this.
 *
 * It is still worth going through rather than writing the object literal out:
 * this names the three fields once, so a fourth added to the variant is a
 * compile error here and not a field every writer has to remember.
 */
export function literalHarmony(reason: LiteralReason, from: ChordDegree | null): SlotHarmony {
  return { kind: 'literal', reason, from };
}

/**
 * Which note stands in for the third.
 *
 * Stored since M1 and read by nothing until M3, which is the milestone that
 * sounds it: `chordPitchClasses` replaces the chord's second note with the
 * second or the fourth above the root, at every height, so `7sus4` and `9sus4`
 * fall out of the one rule. Where the suspended note is also an extension -
 * sus4 at extent 11, sus2 at 9 and above - the chord sounds that pitch class
 * twice an octave apart rather than dropping a note, for the reason
 * `chordPitchClasses` gives about a duplicated voice: `noteCount(extent)` is
 * what the inversion wraps against and what the complexity readout prints.
 */
export type SuspensionKind = 'none' | 'sus2' | 'sus4';

/** ♭9, 9, ♯9 - semitones from a major ninth. */
export type NinthAlteration = -1 | 0 | 1;
/** 11, ♯11 - from a perfect eleventh. */
export type EleventhAlteration = 0 | 1;
/** ♭13, 13 - from a major thirteenth. */
export type ThirteenthAlteration = -1 | 0;

/**
 * One alteration per extension, each `null` for "as the key gives it" - the
 * convention `quality` already uses, which is what makes this a migration with
 * nothing to migrate: a slot with all three null builds exactly what it built
 * before the field existed.
 *
 * A number overrides that one extension **relative to the root**, where `null`
 * leaves the scale's own note where it was. Each is read only once `extent`
 * reaches the extension it names, so `extent` stays the single height control
 * and this record never adds a note to a chord.
 *
 * The unions are the alterations conventional harmony has names for and no
 * others: a ninth may be flattened, natural or raised; an eleventh raised; a
 * thirteenth flattened. That is what makes the composed names of M3 Task 5 a
 * finite set rather than a rendering problem, and it is why the three are
 * separate unions rather than one signed integer.
 *
 * Rejected: widening `ChordQuality` into a flat list of named extended chords.
 * It stores the height twice - in the name and in `extent` - which multiplies
 * exactly the disagreements `effectiveChord` already spends two sections on,
 * and it cannot build a combination nobody listed. See "The chord model grows
 * three ways, all through `null`" in the design doc.
 */
export interface ExtensionAlterations {
  ninth: NinthAlteration | null;
  eleventh: EleventhAlteration | null;
  thirteenth: ThirteenthAlteration | null;
}

export interface ChordDegree {
  /**
   * Scale degree, **0-6**, indexing the scale's interval array directly - the
   * same domain `degreePitchClasses` takes. The design doc says "1-7"; that is
   * stale, and the plan's own tests build a I chord from degree 0.
   */
  degree: number;
  /**
   * Chromatic shift of the chord's **root**, in semitones.
   *
   * What a Roman numeral's accidental does: it displaces the root and leaves
   * the case of the letter to carry the quality. `chordPitchClasses` builds the
   * root as `diatonic[0] + alter` and stacks `quality`'s shape on it, note for
   * note as far as the shape reaches - so bVII in a major key is *degree 6,
   * alter -1, quality 'major'*: Bb-D-F, where the key gives B-D-F.
   *
   * **This field shifted the whole stack until M2 Task 2**, and that is why the
   * two fields have to be read together. A uniform shift is a transposition and
   * transposition preserves quality, so bVII came out diminished, bVI, bIII and
   * the Neapolitan bII came out minor and #iv-dim came out major: every
   * borrowed chord in the design's own table was wrong. The correction is
   * `quality`, twenty lines below, and it is what makes this field usable
   * rather than merely a spelling of the same diatonic chord.
   *
   * So the two are not independent. **A non-zero `alter` under a null quality
   * is refused** - `chordPitchClasses` throws rather than falling back to the
   * whole-stack shift that produced that table - because a chromatic root with
   * no shape to build on it is exactly the combination that got them wrong.
   * `normalizeChordDegree` keeps the pair storable and `progression-generate.ts`
   * carries it through; `quality` below has the rest of the rules.
   */
  alter: number;
  /** How far the thirds are stacked. The +/- complexity buttons move this. */
  extent: ChordExtent;
  /**
   * The chord's shape, or `null` for "as the key gives it".
   *
   * `null` is the default and the common case rather than a missing value: it
   * says the key decides. `chordPitchClasses` reads it that way for the notes
   * and `effectiveChord` for the name, so a slot left alone re-derives its
   * chord from whichever scale is selected, and a key change re-voices it.
   *
   * A non-null value **overrides** the shape, and since M3 the shapes it may
   * name include four whose fourth note is not a seventh - `major6`, `minor6`,
   * `add9` and `minorAdd9`. They are qualities rather than heights because
   * `extent` counts stacked thirds and an added sixth or ninth is not one; a
   * `major6` at extent 9 is a 6/9, with the key's own ninth over the shape's
   * four notes.
   *
   * Overriding is what a borrowed chord
   * needs and what `alter` could not give it. `alter` moves the root alone; the
   * quality carries what the case of a Roman numeral's letter carries; and the
   * two together spell bVII as *degree 6, alter -1, quality 'major'* - Bb-D-F,
   * where the key gives B-D-F. See "Correction: `alter` cannot express a
   * borrowed chord" in the design doc, and `chordPitchClasses` for the rules
   * that fall out of it.
   *
   * Two consequences worth knowing here:
   *
   *  - **`alter !== 0` under a null quality is refused.** A chromatic root with
   *    no shape to build from is the combination that produced every wrong
   *    numeral in that table, so `chordPitchClasses` throws on it rather than
   *    falling back to the whole-stack shift that got them wrong.
   *  - **`'other'` is not one of the values this field can take.** It is a
   *    `ChordQuality` and a perfectly good *answer* - `degreeQuality` returns it
   *    for a stack of thirds that is no named chord - but it names no interval
   *    set, so there is nothing to override a shape with. The type is
   *    `NamedQuality | null` for that reason and `normalizeChordDegree` refuses
   *    it at the door. It was storable while `regenerateSlot` wrote the derived
   *    label into this same field, which is the write M2 Task 4 removed.
   */
  quality: NamedQuality | null;
  /** Root position is 0. Stored wrapped into the chord, so it is always nameable. */
  inversion: number;
  suspension: SuspensionKind;
  /**
   * How the ninth, eleventh and thirteenth are altered, each `null` for "as
   * the key gives it". See `ExtensionAlterations`.
   *
   * It is the answer to the design doc's "A real ninth chord is unreachable":
   * `quality` overrides the chord tones from the bottom up and leaves
   * everything above it diatonic, so before this field every extension in the
   * app came from the key and a plain `E9` as `V/vi` in C major - E G♯ B D F♯ -
   * could not be built at all.
   */
  extensions: ExtensionAlterations;
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
/**
 * The last relabel the recogniser made, for the chip to show.
 *
 * Page state, not document state - beside `selectedSlotId` and off the undo
 * stack for the same reason that one is: it is where the user is, not what they
 * wrote. Any document change, a selection change, and undo or redo clear it,
 * which is not merely tidiness - **an undo can take away the relabel this
 * describes**, and a chip still offering *Back to `V9`* over a slot that is
 * `V9` again would be offering to undo something that has already been undone.
 *
 * `previous` and `current` are whole `SlotHarmony` values rather than degrees,
 * because either end can be `literal`: a slot dragged into a cluster degrades,
 * and the chip has to say `No chord matches` and name what it was. `alternates`
 * is empty in that case - nothing parsed, so there are no runners-up.
 */
export interface RelabelNotice {
  slotId: string;
  previous: SlotHarmony;
  current: SlotHarmony;
  alternates: readonly ChordDegree[];
}

export interface ProgressionState {
  doc: ProgressionDoc;
  /** The slot the strip has selected, or null. Never an id the doc has lost. */
  selectedSlotId: string | null;
  /**
   * The relabel the last edit made, or null.
   *
   * Cleared by every publish that is not the one raising it, which is what puts
   * it beside the selection rather than in the document. See `RelabelNotice`.
   */
  relabel: RelabelNotice | null;
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
    revision: 0,
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
 * `quality` starts as `null`, which is the answer rather than a placeholder:
 * the shape is the key's to give until a user overrides it, and it stays `null`
 * through every regeneration. The `'major'` this factory used to write was a
 * guess that happened to be overwritten before anything read it.
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
        quality: null,
        inversion: 0,
        suspension: 'none',
        // All three null, for the same reason `quality` is: the key decides
        // until the user says otherwise. That is what makes the field a
        // migration with nothing to migrate.
        extensions: createExtensions(),
        octave: 0
      }
    },
    startBeat,
    lengthBeats: BEATS_PER_SLOT_DEFAULT,
    notes: [],
    owned: createOwnership()
  });
}
