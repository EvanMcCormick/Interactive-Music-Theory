/**
 * Domain model for audio transcription.
 *
 * The model is deliberately two-layered:
 *  1. **Detected events are facts.** `DetectedNote` holds what the detector
 *     observed, timed in absolute seconds into the source audio. Nothing about
 *     tempo, meter, key or instrument can make it wrong.
 *  2. **A ScoreDoc is an interpretation of those facts.** Everything in
 *     `DerivationSettings` — tuning, capo, grid, confidence floor — is a knob
 *     on that interpretation, and `deriveScore` is pure, so a score can be
 *     re-derived at any time without re-running detection.
 *
 * `BeatGrid` sits on the interpretation side despite looking like measured
 * data; see its docblock.
 */

import {
  DurationValue,
  KeySignature,
  STANDARD_BASS_TUNING,
  TimeSignature
} from './composer.model';

// Instrument reference data lives in composer.model.ts alongside
// STANDARD_GUITAR_TUNING; re-exported here so transcription callers can reach
// it from the model they already import.
export { STANDARD_BASS_TUNING };

/**
 * Raw output of a note detector, before any musical interpretation.
 *
 * Times are absolute seconds into the source audio, deliberately not beats:
 * this is what the model actually observed, and it stays true no matter what
 * tempo, meter or tuning is later chosen. Everything in a ScoreDoc is derived
 * from these events, so changing an interpretation never means re-running
 * detection.
 */
export interface DetectedNote {
  id: string;
  /** MIDI pitch. */
  pitch: number;
  onsetSec: number;
  offsetSec: number;
  /** 0-1, straight from the model. */
  confidence: number;
  /**
   * Per-frame deviation in cents. Empty when the note has no bend.
   *
   * Sampled at the detector's own frame rate, which this model does not
   * record. Converting these to `NoteEffectsDoc.bendPoints` — quarter tones,
   * one value per bend point rather than per frame — therefore needs that rate
   * from the detector as well as the array itself.
   */
  bendCents: number[];
}

/**
 * Where the beats fall, in seconds.
 *
 * One entry per beat of the time signature's denominator: quarter notes in
 * 4/4, eighths in 6/8.
 *
 * Unlike DetectedNote, this is interpretation rather than raw fact. Beat
 * tracking is already an inference, and the user is expected to correct it;
 * a corrected tempo or meter is expressed by regenerating the grid, not by
 * overriding it downstream.
 */
export interface BeatGrid {
  /** Ascending. */
  beatsSec: number[];
  /**
   * Indices into beatsSec that begin a bar. Ascending, and the first entry is
   * 0: beatsSec[0] is always the first downbeat. Derivation treats it as the
   * start of bar 1, so a pickup must be trimmed out of beatsSec rather than
   * expressed by starting this array above 0.
   */
  downbeatIndices: number[];
  timeSignature: TimeSignature;
}

/**
 * Grid resolutions a bar can actually be decomposed into.
 *
 * Narrower than DurationValue on purpose: the duration table used to fill bars
 * bottoms out at a 64th note, so a finer grid would leave spans it cannot
 * express, and those spans would vanish rather than fail loudly. Derived with
 * Extract so it stays assignable to BeatDoc.duration.
 */
export type FinestDivision = Extract<DurationValue, 4 | 8 | 16 | 32 | 64>;

/** Every knob that turns detected events into notation. */
export interface DerivationSettings {
  /** MIDI pitch per open string, highest string first. */
  tuning: number[];
  /** Frets. 0 = no capo. */
  capo: number;
  /** Shortest note that may be written. 16 = sixteenth note. */
  finestDivision: FinestDivision;
  allowTriplets: boolean;
  /** null infers the key from the notes. */
  key: KeySignature | null;
  /** Notes below this confidence are left out of the score. 0-1, compared against DetectedNote.confidence. */
  confidenceFloor: number;
  /** Highest fret available on the neck, in frets. */
  maxFret: number;
  /** Pins the fretting hand near a fret number, compared against candidate frets. null lets it roam. */
  positionHint: number | null;
}

export interface TranscriptionSession {
  id: string;
  sourceName: string;
  durationSec: number;
  notes: DetectedNote[];
  grid: BeatGrid;
  settings: DerivationSettings;
}

export function createDefaultDerivationSettings(
  tuning: number[] = STANDARD_BASS_TUNING
): DerivationSettings {
  return {
    tuning: [...tuning],
    capo: 0,
    finestDivision: 16,
    allowTriplets: false,
    key: null,
    confidenceFloor: 0.3,
    maxFret: 24,
    positionHint: null
  };
}
