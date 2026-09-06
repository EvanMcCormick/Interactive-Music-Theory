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
 *
 * `TranscriptionSession.harmonics` is a third group of knobs, on the same side
 * of the line as `DerivationSettings` but a step earlier: it decides which
 * detections are notes at all, where `DerivationSettings` decides how the
 * surviving ones are written. `deriveScore` never reads it, which is exactly
 * why it is not a `DerivationSettings` field. `TranscriptionSession.decisions`
 * sits beside it and overrules it note by note, for the cases where a
 * threshold calibrated over a population gets one note wrong.
 */

import {
  DurationValue,
  KeySignature,
  STANDARD_BASS_TUNING,
  TimeSignature
} from './composer.model';
// The one import here that points at a service, and deliberately `import
// type`: `HarmonicOptions` is calibration - every field of it is justified by a
// measurement printed in `harmonic-eval/`, and that argument belongs beside the
// code it justifies rather than out here. `NoteDecisions` rides along for the
// same reason: what a per-note override means is a statement about the pass
// that honours it. A type-only import is erased, so the cycle it would
// otherwise close with `transcription-harmonics.ts`'s own `DetectedNote`
// import never exists at runtime.
import type { HarmonicOptions, NoteDecisions } from '../services/transcription-harmonics';

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
   *
   * Derived, not given: `suppressHarmonics(rawNotes, harmonics)` is the whole
   * of it, and `TranscriptionService.rederive` recomputes it whenever either
   * input moves. Still the same objects `rawNotes` holds - see below.
   */
  notes: DetectedNote[];
  /**
   * Everything the detector reported, before suppression.
   *
   * Kept because of the two-layer model at the top of this file: these are the
   * facts, and harmonic suppression is a four-threshold heuristic — an
   * interpretation, which M2 ran once at detection time and which now re-runs
   * on every derivation from this list and `harmonics`. Three quarters of a
   * real detection goes through it, so discarding the input would mean
   * re-running the model to undo a heuristic. `notes` is a subset of this, not a transformation of it: the
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
  /**
   * The grid `trackBeats` returned, before any correction was made to it.
   *
   * `updateTempo` replaces `grid` with an even pulse and `nudgeDownbeat` drops
   * beats off its front, and both are one-way doors without this: the tracker
   * measures every beat separately - a real grid runs [0.49, 0.49, 0.51, 0.5,
   * ...] - so typing the original BPM back gives an even grid rather than the
   * one that followed the performance, and the measurements are gone. Seven of
   * the ten knobs are reversible and these two were not - and a metrical level,
   * which is the tenth, is reversible only because this is here.
   *
   * Kept so that they can be, and now read as well as kept:
   * `updateMetricalLevel` resamples *this* rather than the current grid, which
   * is what makes levels commutative and lossless, and `resuppressed` compares
   * against the grid the current level makes of it to decide whether the user
   * has corrected the beats by hand.
   *
   * On the session rather than the state, alongside `rawNotes`, and for the
   * same reason: it is what the tracker observed about this audio, not what the
   * current interpretation says. `updateTempo`, `nudgeDownbeat` and
   * `updateMetricalLevel` all spread the session and replace `grid` alone. The
   * one thing that rewrites it is a re-track - a suppression change is a
   * different tracker input, so the measurements themselves are new - and that
   * rewrites `grid` with it.
   */
  trackedGrid: BeatGrid;
  /**
   * Grid beats per tracked pulse: which note value the tracker actually found.
   *
   * 1 says it found the beat. 1.5 says it found a dotted quarter where the
   * music is in quarters, 2 a half note, 0.5 an eighth. `grid` is
   * `atMetricalLevel(trackedGrid, beatsPerPulse)` whenever the user has not
   * since corrected the beats by hand, which is what makes this a *statement
   * about the tracker* rather than a fourth way of setting the tempo.
   *
   * It is here and not in `DerivationSettings` for the reason `harmonics` is:
   * `deriveScore` never reads it. What it describes is how the grid was built,
   * a step before derivation, and by the time a score is derived the answer is
   * already in `grid.beatsSec`.
   *
   * ## Why the level is kept rather than only its effect
   *
   * Because the grid can be rebuilt underneath it. A suppression threshold
   * change re-tracks - beat tracking runs on the suppressed notes - and the new
   * tracked grid arrives at the tracker's level, not the corrected one. Without
   * this number there is nothing to re-apply, and moving a threshold would
   * silently undo the correction. `resuppressed` is where that is handled.
   *
   * It also settles what `grid.beatsSec !== trackedGrid.beatsSec` means. That
   * test used to read "the user corrected the beats", and a level makes the two
   * arrays differ without anyone having touched a beat; the question is now
   * asked against the grid this level implies.
   *
   * Bounded by `MIN_BEATS_PER_PULSE`..`MAX_BEATS_PER_PULSE`, and only ever
   * written by `TranscriptionService.updateMetricalLevel`, which refuses
   * anything `canApplyMetricalLevel` turns down rather than recording a level
   * the grid is not at.
   */
  beatsPerPulse: number;
  /**
   * The thresholds the suppressor ran with. Live: changing them re-derives.
   *
   * Here rather than in `DerivationSettings` because that type is the contract
   * `deriveScore` consumes, and suppression happens a step before it: these
   * four numbers decide which detections `notes` holds, not how those notes are
   * written. A field `deriveScore` had to ignore would blur a line M1 drew and
   * M2 and M3 both rest on.
   *
   * Kept alongside `rawNotes` for the same reason `rawNotes` is kept at all.
   * Suppression is the pipeline's largest discard - three quarters of a real
   * detection - and until these were on the session the only way to re-run it
   * with different numbers was to re-upload the file. Together the pair is
   * everything the pass needs, so `notes` is a derived quantity rather than a
   * fact, and `TranscriptionService.rederive` rebuilds it.
   */
  harmonics: HarmonicOptions;
  /**
   * Notes the user has overruled the suppressor on, by `DetectedNote.id`.
   *
   * `harmonics` moves the whole population at once and this moves one note.
   * Both are needed: the thresholds are a calibration over 120 candidate pairs
   * whose two distributions overlap heavily, so a cut that recovers a real
   * note the pass ate also readmits artefacts everywhere else, and the note in
   * front of the user is the only one they can actually judge.
   *
   * Applied by `suppressHarmonics` at its decision point rather than to the
   * lists it returns; `NoteDecisions` argues why, and settles what an id in
   * both lists, or in neither detection, means.
   *
   * The ids are `rawNotes` ids, and they are stable across re-derivation
   * because `notes` and the suppressed list hold the objects `rawNotes` holds
   * rather than copies of them. That is what lets a decision taken against one
   * derivation still name the same note after a threshold moves.
   *
   * Not persisted, and lost with the session - like everything else here. A
   * session survives leaving the route and coming back, because the service is
   * `providedIn: 'root'`, and nothing further.
   */
  decisions: NoteDecisions;
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
