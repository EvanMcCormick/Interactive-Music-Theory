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
 *
 * Bars are not stated here, they are counted. `deriveScore` reads bar 1 as
 * starting at `beatsSec[0]` and every bar after it as another `numerator`
 * beats, so a corrected downbeat phase is expressed by trimming `beatsSec` -
 * the same move scope decision 3 makes for a corrected tempo. There was a
 * `downbeatIndices` array here saying the same thing a second time, and
 * nothing read it; a beat tracker that dropped or doubled a beat could have
 * filled it with downbeats the written bars disagreed with, and nothing would
 * have said so.
 *
 * ## `beatsSec[0]` is not known to be a downbeat
 *
 * It is treated as one, which is not the same thing, and the difference is
 * worth being plain about because everything about where the bar lines fall
 * rests on it. M2's tracker finds the pulse and not its phase: `trimBeats`
 * returns the run starting at the first beat whose local score clears half the
 * RMS - whichever tracked beat the onsets first support, with no downbeat
 * property claimed for it or tested. A line that begins on beat 3 tracks
 * perfectly and is barred a half-bar out.
 *
 * So the tempo is inferred and the phase is arbitrary. M2's scope decision 3
 * deferred downbeat detection to M3, which needs a downbeat control - the user
 * says where bar 1 begins, and the grid is trimmed to it - before any of this
 * can be called a downbeat. Reintroducing `downbeatIndices` means
 * reintroducing the field *and* the derivation support that honours it
 * together, because a field derivation ignores is worse than no field at all.
 */
export interface BeatGrid {
  /**
   * Ascending. `beatsSec[0]` is the first *tracked* beat, and derivation reads
   * it as bar 1 beat 1; whether it is a downbeat is not established. See above.
   */
  beatsSec: number[];
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
  /**
   * What to call `tuning` on the staff, or `null` to name it from the pitches.
   *
   * The tuning array says which notes the open strings sound and nothing about
   * what the user thought they were choosing: "Guitar, drop D" and "Bass, five
   * string" are facts about the control that was moved, and only the caller
   * that moved it has them. `deriveScore` falls back to the family it can infer
   * — see `instrumentVoiceFor` — rather than to a placeholder, so a session
   * assembled without a label still names an instrument rather than the
   * process that produced it.
   */
  tuningLabel: string | null;
  /** Frets. 0 = no capo. */
  capo: number;
  /** Shortest note that may be written. 16 = sixteenth note. */
  finestDivision: FinestDivision;
  allowTriplets: boolean;
  /**
   * Key signature to write the score in. `null` falls back to C major.
   *
   * Not inferred: reading a key off the notes is deferred past M1, and a
   * comment here once promised it. Nothing downstream would have noticed the
   * difference, since tab is unaffected by the key signature and only the
   * standard-notation staff spells accidentals against it.
   */
  key: KeySignature | null;
  /**
   * Notes below this confidence are left out of the score. 0-1, compared
   * against DetectedNote.confidence.
   *
   * The default of 0.3 does nothing with Basic Pitch behind it: that
   * detector's amplitude is a mean over frames it has already thresholded at
   * 0.3, so no note it reports can fall below this. See the `toDetectedNote`
   * docblock in `basic-pitch-detector.ts`; calibrating it is an M3 question,
   * when real stems are available.
   */
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
  /**
   * The notes derivation works from: the detector's output with harmonic
   * partials removed.
   */
  notes: DetectedNote[];
  /**
   * Everything the detector reported, before suppression.
   *
   * Kept because of the two-layer model at the top of this file: these are the
   * facts, and harmonic suppression is a five-parameter heuristic calibrated on
   * one fixture — interpretation, on the facts side of the line only because
   * M2 runs it once at detection time. Three quarters of a real detection goes
   * through it, so discarding the input would mean re-running the model to undo
   * a heuristic. `notes` is a subset of this, not a transformation of it: the
   * objects are the same ones.
   */
  rawNotes: DetectedNote[];
  /**
   * Frame rate of every `bendCents` array above, in Hz.
   *
   * `DetectedNote` deliberately does not record it — it is a property of the
   * detector, not of a note — so whoever hands the notes on has to hand the
   * rate on with them, and this is where they come to rest. Without it
   * `bendCents` is a list of numbers with no time axis: turning it into
   * `NoteEffectsDoc.bendPoints`, which are positions through the note rather
   * than frames, is not possible. `DetectionResult.bendFrameRateHz` produced
   * it and crossed the worker boundary carrying it; this is the field that
   * stops it being dropped on arrival.
   */
  bendFrameRateHz: number;
  grid: BeatGrid;
  settings: DerivationSettings;
}

export function createDefaultDerivationSettings(
  tuning: number[] = STANDARD_BASS_TUNING
): DerivationSettings {
  return {
    tuning: [...tuning],
    tuningLabel: null,
    capo: 0,
    finestDivision: 16,
    allowTriplets: false,
    key: null,
    confidenceFloor: 0.3,
    maxFret: 24,
    positionHint: null
  };
}
