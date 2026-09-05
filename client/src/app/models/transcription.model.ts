import { DurationValue, KeySignature, TimeSignature } from './composer.model';

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
  /** Per-frame deviation in cents. Empty when the note has no bend. */
  bendCents: number[];
}

/**
 * Where the beats fall, in seconds.
 *
 * One entry per beat of the time signature's denominator: quarter notes in
 * 4/4, eighths in 6/8.
 */
export interface BeatGrid {
  /** Ascending. */
  beatsSec: number[];
  /** Indices into beatsSec that begin a bar. */
  downbeatIndices: number[];
  timeSignature: TimeSignature;
}

/** Every knob that turns detected events into notation. */
export interface DerivationSettings {
  /** MIDI pitch per open string, highest string first. */
  tuning: number[];
  capo: number;
  /** Shortest note that may be written. 16 = sixteenth note. */
  finestDivision: DurationValue;
  allowTriplets: boolean;
  /** null infers the key from the notes. */
  key: KeySignature | null;
  /** Notes below this confidence are left out of the score. */
  confidenceFloor: number;
  maxFret: number;
  /** Pins the fretting hand near a fret. null lets it roam. */
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

/** 4-string bass, standard tuning: G2 D2 A1 E1, highest string first. */
export const STANDARD_BASS_TUNING: number[] = [43, 38, 33, 28];

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
