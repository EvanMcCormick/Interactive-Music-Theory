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

export type AccidentalMode = 'auto' | 'explicit';

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
  /** BPM change starting at this bar. null = no change. */
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
  progressionId: string;
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
   * Written and read by `progression-track.ts`; nothing else interprets it.
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

export interface BeatEffectsDoc {
  isLetRing: boolean;
  isPalmMute: boolean;
  isStaccato: boolean;
  slap: boolean;
  pop: boolean;
  tap: boolean;
  fadeIn: boolean;
  vibrato: boolean;
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
       */
      letter?: NoteLetter;
    };

export interface NoteDoc {
  pitch: NotePitch;
  isTied: boolean;
  accidental: AccidentalMode;
  effects: NoteEffectsDoc;
}

export interface NoteEffectsDoc {
  isGhost: boolean;
  isDead: boolean;
  isHammerPullOrigin: boolean;
  isLetRing: boolean;
  isPalmMute: boolean;
  isStaccato: boolean;
  vibrato: boolean;
  slide: 'none' | 'shiftSlide' | 'legatoSlide' | 'slideInBelow' | 'slideOutUp';
  harmonic: 'none' | 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi';
  /** Fret offset per bend point, in quarter tones. Empty = no bend. */
  bendPoints: number[];
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

export interface ComposerState {
  doc: ScoreDoc;
  cursor: EditCursor;
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
    isStaccato: false,
    slap: false,
    pop: false,
    tap: false,
    fadeIn: false,
    vibrato: false,
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
    vibrato: false,
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
