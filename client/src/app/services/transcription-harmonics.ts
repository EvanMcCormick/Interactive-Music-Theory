import { DetectedNote } from '../models/transcription.model';

/**
 * Removes the harmonic partials a note detector reports alongside the notes
 * actually played.
 *
 * A plucked string radiates most of its energy at the fundamental but plenty
 * at 2f0, 3f0, 4f0 and beyond, and a pitch detector reports those as notes.
 * Measured on a clean synthetic bassline, Basic Pitch returns thirty-four
 * notes for eight played — recall is perfect and precision is 24 %, with every
 * spurious note a partial *above* its fundamental. Constraining the detector's
 * frequency range barely helps, because the partials fall inside the
 * instrument's range too.
 *
 * What makes this tractable is that a partial is always *above* its
 * fundamental — physics, not a heuristic. So: consider notes lowest first, and
 * drop any that a lower note already explains as one of its partials — one it
 * overlaps, starts no earlier than, and dies away sooner than. Overlap alone
 * is not enough; that would delete octave leaps and slapped pops along with
 * the artefacts. Ordering by pitch guarantees a fundamental has been considered
 * before anything it could explain, without assuming it is the louder of the
 * two. It often is not: in the measured output an octave partial comes back at
 * amplitude 0.548 against the 0.520 of the E1 that produced it.
 *
 * Pure, and independent of any detector.
 */

/**
 * Semitone offsets of the partials a plucked string produces, relative to its
 * fundamental. 2f0 = +12, 3f0 = +19.02, 4f0 = +24, 5f0 = +27.86, 6f0 = +31.02,
 * rounded because detectors report integer MIDI pitches.
 *
 * 0 is included: a unison "partial" is the detector reporting one note twice.
 */
export const HARMONIC_SEMITONES: number[] = [0, 12, 19, 24, 28, 31];

export interface HarmonicOptions {
  /** Slack at both ends of a fundamental's span, for detector jitter. */
  toleranceSec: number;
  /** A unison counts as a re-detection only below this share of the root's amplitude. */
  unisonAmplitudeRatio: number;
  /** ...and this share of its duration. */
  unisonDurationRatio: number;
  /**
   * A partial decays faster than its fundamental, so it sounds for less of it.
   * Be clear-eyed about this number: it is calibrated on one fixture, whose
   * longest partial runs 0.86 of the note that produced it. 0.90 clears that
   * by four points and nothing more.
   */
  partialDurationRatio: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicOptions = {
  toleranceSec: 0.03,
  unisonAmplitudeRatio: 0.8,
  unisonDurationRatio: 0.5,
  partialDurationRatio: 0.9
};

export function suppressHarmonics(
  notes: DetectedNote[],
  options: HarmonicOptions = DEFAULT_HARMONIC_OPTIONS
): DetectedNote[] {
  // Lowest first, so a fundamental is always considered before its own
  // partials, whatever their relative loudness. Amplitude then orders notes of
  // equal pitch, which is exactly what the unison rule needs: the strong one
  // must be seen first for the weak short one to be read as its re-detection.
  // Onset breaks the remaining ties, keeping the result deterministic.
  const byPitch = [...notes].sort(
    (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
  );

  const kept: DetectedNote[] = [];
  for (const note of byPitch) {
    if (!kept.some(root => explains(root, note, options))) kept.push(note);
  }

  return kept.sort((a, b) => a.onsetSec - b.onsetSec || a.pitch - b.pitch);
}

/** True when `note` is a partial, or a re-detection, of the lower `root`. */
function explains(
  root: DetectedNote,
  note: DetectedNote,
  options: HarmonicOptions
): boolean {
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;

  // The two have to be sounding at the same time. Spans must overlap rather
  // than the partial's onset falling inside its fundamental: a re-detection
  // often begins a frame or two *before* the note it duplicates, and an
  // onset-containment test would let those through.
  const overlaps =
    note.onsetSec <= root.offsetSec + options.toleranceSec &&
    root.onsetSec <= note.offsetSec + options.toleranceSec;
  if (!overlaps) return false;

  const rootDuration = root.offsetSec - root.onsetSec;
  const noteDuration = note.offsetSec - note.onsetSec;

  if (interval > 0) {
    // A partial is set ringing by the same pluck as its fundamental, so it
    // cannot start first. Unison is exempt on purpose: a re-detection often
    // straddles the onset of the note it duplicates, and the symmetric
    // overlap above is what catches the earlier half of such a pair.
    if (note.onsetSec < root.onsetSec - options.toleranceSec) return false;

    // Overlap alone would delete real music: an octave leap over a ringing
    // low note, a slapped pop over its thumbed root, pumping octave eighths.
    // Amplitude cannot separate those from partials — in the fixture a
    // partial comes back 5 % *louder* than the note that produced it — but
    // duration can, because the higher modes of a plucked string damp faster
    // than the fundamental and so sound for less of it.
    return noteDuration < rootDuration * options.partialDurationRatio;
  }

  // Unison needs more care. A note genuinely struck twice also overlaps itself
  // when the first one is still ringing, and suppressing that would delete
  // repeated notes — which basslines are full of. A re-detection is both
  // markedly quieter and markedly shorter than the note it duplicates; a real
  // second attack is neither.
  return (
    note.confidence < root.confidence * options.unisonAmplitudeRatio &&
    noteDuration < rootDuration * options.unisonDurationRatio
  );
}
