/**
 * Editable score document model for the composer.
 *
 * Shaped after Guitar Pro 7 / alphaTab (which TuxGuitar broadly follows):
 *   Score -> Track -> Staff -> Bar -> Voice -> Beat -> Note
 *
 * Three deliberate choices, each verified against alphaTab's own model:
 *  1. `keySignature` lives on BarDoc, not MasterBarDoc. alphaTab marks
 *     `MasterBar.keySignature` as deprecated in favour of bar-level keys, and
 *     TuxGuitar's `TGMeasure` does the same. Transposing instruments need a
 *     different key signature per staff within the same bar.
 *  2. A track owns several staves (grand staff, or notation + tab together).
 *  3. `Bar -> Voice -> Beat`, matching GP7/alphaTab, not TuxGuitar's older
 *     GP5-era `Measure -> Beat -> Voice`.
 *
 * The `Doc` suffix distinguishes these from alphaTab's runtime model classes
 * and from the existing types in music-theory.model.ts.
 */

/** Duration denominator. 4 = quarter note. Negative values are multi-bar. */
export type DurationValue = -4 | -2 | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256;

export type ClefKind = 'g2' | 'f4' | 'c3' | 'c4' | 'n';

export type OttaviaKind = '15ma' | '8va' | 'regular' | '8vb' | '15mb';

export type DynamicValue = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

/**
 * The accidental a note forces, or `auto` to spell from the key signature.
 *
 * Was `'auto' | 'explicit'`, where `'explicit'` always forced a sharp. On a pitched note
 * `NotePitch.letter` still decides first - see `ScoreDocMapperService.toNote`.
 */
export type AccidentalMode = 'auto' | 'doubleFlat' | 'flat' | 'sharp' | 'doubleSharp';

/**
 * An accent mark. One field for three marks because alphaTab's `AccentuationType` holds
 * them in one, so a note carries at most one of them. Staccato is not one of them: alphaTab
 * keeps it in `Note.isStaccato`, and a note can be staccato and accented at once.
 */
export type AccentKind = 'none' | 'normal' | 'heavy' | 'tenuto';

/** Vibrato width, one-to-one with alphaTab's `VibratoType` - a boolean would save a wide vibrato as slight. */
export type VibratoKind = 'none' | 'slight' | 'wide';

/**
 * A trill, in alphaTab's own terms so the mapper copies rather than converts.
 *
 * `value` is `Note.trillValue`, the trilled-to pitch as a MIDI number - playback plays it
 * as it is. alphaTab exposes it relative to the string as `trillFret`, `trillValue` minus
 * the string's tuning with the capo included, and alphaTex writes and reads that fret as
 * `tr (fret speed)`: a trill to fret 7 on the G string (no capo) is value 62 and exports
 * as `tr (7 16)`. A negative value is no trill (`isTrill` is `trillValue >= 0`), so one
 * cannot be stored. Whatever sets a trill from a fret (M4's trill editor) must add the
 * string's tuning, capo included - there, once, rather than every round trip converting
 * here.
 *
 * `value` is a fixed pitch, so it does not follow its note: whatever changes a note's fret,
 * string, capo or tuning must move `trill.value` by the same amount, or a whole-step trill
 * becomes some other interval.
 */
export interface TrillDoc {
  value: number;
  speed: 16 | 32 | 64;
}

/** A finger, for either hand. `none` is alphaTab's `Fingers.Unknown`. */
export type FingerKind = 'none' | 'thumb' | 'index' | 'middle' | 'annular' | 'little';

export type KeySignatureMode = 'major' | 'minor';

export type TripletFeelKind =
  | 'none'
  | 'triplet8th'
  | 'triplet16th'
  | 'dotted8th'
  | 'dotted16th'
  | 'scottish8th'
  | 'scottish16th';

export interface TimeSignature {
  numerator: number;
  denominator: number;
  isCommon: boolean;
}

export interface KeySignature {
  /** Accidental count: -7 (7 flats) to 7 (7 sharps). 0 = C major / A minor. */
  fifths: number;
  mode: KeySignatureMode;
}

export interface Tuplet {
  numerator: number;
  denominator: number;
}

/** Shared, cross-track bar attributes. GP's MasterBar / TuxGuitar's TGMeasureHeader. */
export interface MasterBarDoc {
  /** null inherits the previous bar's time signature. */
  timeSignature: TimeSignature | null;
  /**
   * BPM change starting at this bar. null = no change.
   *
   * Ignored on the first bar: bar 1's tempo is `ScoreDoc.tempo`, and `toDoc` reads it back as
   * null there.
   */
  tempoAutomation: number | null;
  isRepeatStart: boolean;
  /** 0 = not a repeat end. */
  repeatCount: number;
  /** Bitfield of alternate (1st/2nd/...) endings. 0 = none. */
  alternateEndings: number;
  tripletFeel: TripletFeelKind;
  /** Rehearsal mark / section marker. */
  section: SectionDoc | null;
  isDoubleBar: boolean;
  isFreeTime: boolean;
}

export interface SectionDoc {
  marker: string;
  text: string;
}

/** GP's mixer channel. */
export interface PlaybackInfoDoc {
  /** General MIDI program, 0-127. */
  program: number;
  /** Bank select, 0-127. */
  bank: number;
  /** 0-16. */
  volume: number;
  /** 0-16, 8 = centre. */
  balance: number;
  isMute: boolean;
  isSolo: boolean;
}

/**
 * What a generated track was generated from.
 *
 * `source` is a union rather than a `revision` plus a `diverged: boolean`
 * because the two can disagree and a union cannot: a score-wide bar insertion
 * moves a generated track's content without moving `ProgressionDoc.revision`,
 * so divergence is a *different* answer to "what is this built from", not an
 * extra flag on the same one. See "Divergence is a state of the source" in the
 * progression design doc.
 */
export interface GeneratedOrigin {
  /**
   * The `ProgressionDoc.id` this track was built from.
   *
   * May name a progression that no longer exists. A marker outlives its source
   * as soon as the two are held apart - a `ProgressionDoc` has no persistence
   * of its own, and the design doc weighs exactly that dangling reference under
   * "Saving refuses rather than flattening". Nothing guards it, because nothing
   * needs to: an id that matches no progression matches no track either, so
   * `generatedTrackIndex` returns -1 and `generatedTrackState` answers
   * `'absent'`. The score then holds a track the UI treats as ordinary, which
   * is the safe end of the failure and not an error anyone has to handle.
   */
  progressionId: string;
  /**
   * What to call the progression this track was built from.
   *
   * The *resolved* label rather than `ProgressionDoc.name` verbatim: a document
   * nobody has renamed carries `UNTITLED_PROGRESSION_NAME`, and a badge reading
   * "From Untitled" tells a reader nothing. `progressionLabel` in
   * `progression-track.ts` resolves both this and the track's own name, and is
   * exported so that whatever first renames a progression writes a resolved
   * label through rather than reopening the hole.
   *
   * Denormalised so the badge can say which progression a track came from with
   * only the score loaded. This is the second copy of the truth the design doc
   * prices in under "The generated track is a real track carrying a marker",
   * and it is a copy the revision counter cannot police: `revision` does not
   * move on a rename, so a stale name here would not even read as stale.
   */
  progressionName: string;
  source: { kind: 'revision'; revision: number } | { kind: 'diverged' };
}

export interface TrackDoc {
  id: string;
  name: string;
  shortName: string;
  /** Hex colour, e.g. "#2c3e50". */
  color: string;
  playback: PlaybackInfoDoc;
  staves: StaffDoc[];
  /**
   * The progression this track was built from, or `null` for an ordinary one.
   *
   * Read only by `generatedTrackState` in `progression-track.ts` - the badge,
   * the edit gate and the Update button all ask it rather than this field, so
   * a marker means one thing to every caller. Written there too, and - for
   * divergence alone - by the bar-structure commands in `composer.service.ts`:
   * a score-wide bar insertion moves a generated track's content without moving
   * `ProgressionDoc.revision`, so those commands restate the source as
   * `diverged`. They stamp the marker without interpreting it; what a diverged
   * source *means* is still settled in one place.
   *
   * Not optional: an absent marker and a missing field would be the same answer
   * from two different states, and `ScoreDocMapperService` already produces the
   * second - alphaTab has nowhere to keep this, so a round trip through it
   * flattens the track. That is why saving a composition refuses a linked one
   * rather than writing it out.
   */
  generated: GeneratedOrigin | null;
}

export interface StaffDoc {
  /** MIDI pitch per string, high to low. Empty for non-fretted staves. */
  tuning: number[];
  tuningLabel: string;
  capo: number;
  /** Sounding transposition in semitones (playback). */
  transpose: number;
  /** Notation-only transposition in semitones (display). */
  displayTranspose: number;
  showStandardNotation: boolean;
  showTablature: boolean;
  showSlash: boolean;
  showNumbered: boolean;
  /** Parallel to ScoreDoc.masterBars: same length, same order. */
  bars: BarDoc[];
}

export interface BarDoc {
  clef: ClefKind;
  clefOttava: OttaviaKind;
  /** Per bar per staff, so transposing instruments work. */
  keySignature: KeySignature;
  voices: VoiceDoc[];
}

export interface VoiceDoc {
  beats: BeatDoc[];
}

export interface BeatDoc {
  duration: DurationValue;
  /** 0, 1 or 2 augmentation dots. */
  dots: number;
  tuplet: Tuplet | null;
  isRest: boolean;
  notes: NoteDoc[];
  /**
   * The dynamic marked on this beat. **`null` does not inherit.**
   *
   * It reads like an inherit and nothing implements one. `ScoreDocMapperService.
   * toBeat` skips the assignment on a null and alphaTab's `Beat.dynamics`
   * defaults to `f`, so an unmarked beat engraves *forte* and alphaTab prints
   * the change - two bars of one chord at the roll's default velocity came out
   * `mf` and then `f`, which is how this was found. The round trip is worse
   * than lossy: `toDoc` reads the same field back off alphaTab, so loading a
   * document and saving it turns every null into an explicit `f`.
   *
   * Nothing in the app writes anything but null. `createRestBeat` does, and
   * `quantizeBar` does on **every** beat it writes - so the transcription
   * review preview engraves a whole performance forte through this field.
   * `progression-score.ts` is the one caller that works around it, stating the
   * standing dynamic on every beat and saying why at `applyDynamics`. That is a
   * local fix; the transcription path still has the bug.
   *
   * Implementing the inherit means teaching the mapper to carry a standing
   * value across beats, bars and voices, and it changes what every writer of
   * this field means. That is its own task; until then the field is what it
   * says here.
   */
  dynamics: DynamicValue | null;
  lyrics: string | null;
  text: string | null;
  effects: BeatEffectsDoc;
}

/** A fermata. alphaTab's `Fermata`: a type and a length multiplier. */
export interface FermataDoc {
  type: 'short' | 'medium' | 'long';
  length: number;
}

export interface BeatEffectsDoc {
  isLetRing: boolean;
  isPalmMute: boolean;
  slap: boolean;
  pop: boolean;
  tap: boolean;
  fadeIn: boolean;
  /** null = no fermata. */
  fermata: FermataDoc | null;
  crescendo: 'none' | 'crescendo' | 'decrescendo';
  pickStroke: 'none' | 'up' | 'down';
  vibrato: VibratoKind;
  /** Strum direction across the chord. */
  brush: 'none' | 'brushUp' | 'brushDown' | 'arpeggioUp' | 'arpeggioDown';
  grace: 'none' | 'onBeat' | 'beforeBeat';
}

/**
 * A staff letter. Declared here rather than in `note-spelling.ts` so the model
 * owns it and the spelling service imports it, which is the direction the
 * layers already run.
 */
export type NoteLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

/**
 * alphaTex has exactly two note syntaxes - `3.3` (fret.string) and `C#4` -
 * so a discriminated union maps 1:1 onto them.
 */
export type NotePitch =
  | { kind: 'fretted'; string: number; fret: number }
  | {
      kind: 'pitched';
      noteValue: number;
      octave: number;
      /**
       * The letter to engrave on, when the writer knows one.
       *
       * Absent means what the Composer has always done: spell from the key
       * signature. Only the progression's projection sets it, and only because
       * a pitch class does not have a letter and a degree does - see
       * "A letter on `NotePitch`" in the progression design doc.
       *
       * Anything that changes `noteValue` must drop or recompute the letter, or
       * a stale letter overrules the accidental.
       */
      letter?: NoteLetter;
    };

export interface NoteDoc {
  pitch: NotePitch;
  isTied: boolean;
  accidental: AccidentalMode;
  effects: NoteEffectsDoc;
}

/**
 * One point of a bend curve, in alphaTab's own units so the mapper copies rather than
 * converts: `offset` is the position through the note, 0 to 60, and `value` is the
 * pitch in quarter tones, 0 to 12 (`BendPoint.MaxValue`), so 4 is a whole-tone bend.
 */
export interface BendPointDoc {
  offset: number;
  value: number;
}

export interface NoteEffectsDoc {
  isGhost: boolean;
  isDead: boolean;
  isHammerPullOrigin: boolean;
  isLetRing: boolean;
  isPalmMute: boolean;
  isStaccato: boolean;
  accent: AccentKind;
  isLeftHandTapped: boolean;
  /** null = no trill. */
  trill: TrillDoc | null;
  leftHandFinger: FingerKind;
  rightHandFinger: FingerKind;
  vibrato: VibratoKind;
  slide: 'none' | 'shiftSlide' | 'legatoSlide' | 'slideInBelow' | 'slideOutUp';
  harmonic: 'none' | 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi';
  /**
   * The bend curve, points in ascending `offset`. Empty = no bend.
   *
   * alphaTab neither sorts nor checks what it is given - playback times each segment by
   * the difference in offsets, so an out-of-order pair gets a negative length - and
   * `Note.finish` rewrites a bend of two to four points into one of Guitar Pro's shapes.
   * A document holds that shape only once read back through `toDoc`; until then it holds
   * the points as written. Whatever writes bends must write Guitar Pro's shapes or
   * normalise, for example by reading the note back through the mapper.
   */
  bendPoints: BendPointDoc[];
}

export interface ScoreDoc {
  title: string;
  subTitle: string;
  artist: string;
  album: string;
  /** BPM at bar 1. */
  tempo: number;
  masterBars: MasterBarDoc[];
  tracks: TrackDoc[];
}

/**
 * Where the edit caret sits. Entering a note writes here and advances.
 * Mirrors Guitar Pro / TuxGuitar's caret.
 */
export interface EditCursor {
  trackIndex: number;
  staffIndex: number;
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
  /** Fretted staves only; null on pitched staves. */
  stringIndex: number | null;
}

/** A parse or validation message from the alphaTex escape hatch. */
export interface TexDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: number;
  message: string;
  line: number;
  column: number;
}

/**
 * What a click on standard notation does: `select` moves the caret and never writes, `pen` writes
 * the clicked pitch. Digits on tablature write in both. The design's decision 5: a click meant to
 * select must not write a note.
 */
export type EntryMode = 'select' | 'pen';

export interface ComposerState {
  doc: ScoreDoc;
  cursor: EditCursor;
  /**
   * The fixed end of a range selection; `cursor` is the end that moves. null means the
   * selection is the caret alone. See `selectionTargets` for what a range covers.
   */
  anchor: EditCursor | null;
  /**
   * Why the last command did nothing, for the status line. The next edit clears it, and so does a
   * selection change, undo and redo.
   */
  refusal: string | null;
  /**
   * What the last command did, where that is worth saying aloud: Fix bar's and paste's outcomes, which
   * change bars the user may not be looking at (design Part 4). Published with the commit, and cleared
   * wherever `refusal` is - the next edit, a selection change, undo, redo - and by a refusal.
   */
  notice: string | null;
  /**
   * Which refusal or notice is showing. Bumped each time one is published, so the same words published twice - two
   * Fix bar refusals, the same paste twice - are two messages, and the live region replaces its node and says them
   * again. Unchanged by anything that publishes neither, and by the second digit of a fret, which keeps the first
   * digit's notice rather than saying it again.
   */
  messageId: number;
  /**
   * Which composition the document is. Bumped when `reset` starts a new one and when `replaceDocument` puts in one marked
   * clean - a load - and by nothing that changes the same composition: an edit, undo, redo, an applied alphaTex draft.
   * The library panel forgets the entry it last loaded or saved when this changes, so Save never writes a new score
   * over it.
   */
  documentId: number;
  /** Select or Pen. See `EntryMode`. */
  entryMode: EntryMode;
  /** Duration applied to the next entered note. */
  inputDuration: DurationValue;
  inputDots: number;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const STANDARD_GUITAR_TUNING: number[] = [64, 59, 55, 50, 45, 40];

/** 4-string bass, standard tuning: G2 D2 A1 E1, highest string first. */
export const STANDARD_BASS_TUNING: number[] = [43, 38, 33, 28];

export function createDefaultPlaybackInfo(program = 25): PlaybackInfoDoc {
  return { program, bank: 0, volume: 15, balance: 8, isMute: false, isSolo: false };
}

export function createDefaultBeatEffects(): BeatEffectsDoc {
  return {
    isLetRing: false,
    isPalmMute: false,
    slap: false,
    pop: false,
    tap: false,
    fadeIn: false,
    fermata: null,
    crescendo: 'none',
    pickStroke: 'none',
    vibrato: 'none',
    brush: 'none',
    grace: 'none'
  };
}

export function createDefaultNoteEffects(): NoteEffectsDoc {
  return {
    isGhost: false,
    isDead: false,
    isHammerPullOrigin: false,
    isLetRing: false,
    isPalmMute: false,
    isStaccato: false,
    accent: 'none',
    isLeftHandTapped: false,
    trill: null,
    leftHandFinger: 'none',
    rightHandFinger: 'none',
    vibrato: 'none',
    slide: 'none',
    harmonic: 'none',
    bendPoints: []
  };
}

export function createDefaultMasterBar(): MasterBarDoc {
  return {
    timeSignature: null,
    tempoAutomation: null,
    isRepeatStart: false,
    repeatCount: 0,
    alternateEndings: 0,
    tripletFeel: 'none',
    section: null,
    isDoubleBar: false,
    isFreeTime: false
  };
}

export function createRestBeat(duration: DurationValue = 4): BeatDoc {
  return {
    duration,
    dots: 0,
    tuplet: null,
    isRest: true,
    notes: [],
    dynamics: null,
    lyrics: null,
    text: null,
    effects: createDefaultBeatEffects()
  };
}

/**
 * A bar filled with rests for a whole measure.
 *
 * Guitar Pro shows every position in a bar as a rest until it is filled in, and
 * the caret steps between those positions. A bar holding a single rest would
 * give a 4/4 measure just one slot, so every note entered would land on top of
 * the last one.
 */
export function createDefaultBar(
  showTablature: boolean,
  timeSignature: TimeSignature = { numerator: 4, denominator: 4, isCommon: true }
): BarDoc {
  const slotDuration = (timeSignature.denominator as DurationValue) ?? 4;
  const slots = Math.max(1, timeSignature.numerator);

  return {
    clef: 'g2',
    clefOttava: 'regular',
    keySignature: { fifths: 0, mode: 'major' },
    voices: [{ beats: Array.from({ length: slots }, () => createRestBeat(slotDuration)) }]
  };
}

/** Time signature in force at `index`, following the inherit-from-previous rule. */
export function effectiveTimeSignature(
  masterBars: MasterBarDoc[],
  index: number
): TimeSignature {
  for (let i = Math.min(index, masterBars.length - 1); i >= 0; i--) {
    const signature = masterBars[i]?.timeSignature;
    if (signature) return signature;
  }
  return { numerator: 4, denominator: 4, isCommon: true };
}

export function createDefaultCursor(): EditCursor {
  return {
    trackIndex: 0,
    staffIndex: 0,
    barIndex: 0,
    voiceIndex: 0,
    beatIndex: 0,
    stringIndex: 0
  };
}
