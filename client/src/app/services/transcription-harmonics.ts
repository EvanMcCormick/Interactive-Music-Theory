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
 * overlaps, starts no earlier than, and that the detector was less sure of.
 * Overlap alone is not enough; that would delete octave leaps and slapped pops
 * along with the artefacts. Ordering by pitch guarantees a fundamental has been
 * considered before anything it could explain, without assuming it is the
 * louder of the two. It often is not: in the measured output an octave partial
 * comes back with a `confidence` of 0.548 against the 0.520 of the E1 that
 * produced it.
 *
 * ## What separates a partial from a note, and what does not
 *
 * This module shipped believing that a partial "decays faster than its
 * fundamental, so it sounds for less of it", and arbitrated the partial branch
 * on a duration ratio. Both halves of that were wrong.
 *
 * The physics is wrong. Measured on the synthesis the accuracy fixtures are
 * built from, partials 1 through 8 of an E1 decay at **−20.0 to −20.7 dB/s** —
 * a spread of 0.7 dB/s across the whole series. Differential damping is not
 * something a rule could be built on; there is almost nothing there to
 * measure. What does differ is where the partials *start*: 8–35 dB below the
 * fundamental. A detector's note therefore ends sooner not because the partial
 * damps faster but because it begins nearer the frame threshold and crosses it
 * earlier — a fact about the threshold, not about the string.
 *
 * The rule was wrong too, and by more than the story behind it. Over the 120
 * candidate pairs this branch arbitrates across the sixteen fixtures in
 * `harmonic-eval/harmonic-accuracy.spec.ts` — 92 artefacts and 28 real notes —
 * a length ratio under the shipped 0.9 removed 62 of the 92 artefacts and
 * destroyed **20 of the 28 real notes**. Even at its best achievable cut,
 * 0.325, it removed 41 artefacts for 7 real notes. It was barely better than a
 * coin.
 *
 * ## What the rule rests on now
 *
 * `DetectedNote.confidence`, compared against the root's. It is worth being
 * exact about that quantity, because the obvious reading of it is false and
 * the false reading is how the duration rule got justified.
 *
 * It is **not** amplitude. `basic-pitch-detector.ts` says what it is: the mean
 * frame activation over the note's span, bounded below by the model's own 0.3
 * frame threshold by construction. Measured across the six fixtures that carry
 * dynamics — 49 notes spanning 17.7 dB of pluck strength — its correlation
 * with velocity is **r = 0.182**, and the mean confidence of the softest notes
 * is 0.954 of the mean of the loudest, against a physical amplitude ratio near
 * 0.3. On the `accents` fixture the loud downbeat roots come back at 0.46
 * while the offbeat octaves plucked at a third of their strength come back at
 * 0.62: the quiet notes score *higher*. So no claim about how far below its
 * fundamental a partial starts is a claim about this number, and the rule
 * below is not an amplitude rule however much it looks like one.
 *
 * What it is, is a claim about the **detector**: the model is less certain
 * about a partial than about the note that produced it. Energy at a partial's
 * frequency lights that pitch bin, but a ringing partial does not look to the
 * model like a note being *played* there, so its frame activations sit nearer
 * the 0.3 floor and the mean over the span sits lower. Measured, that is worth
 * a good deal more than length: over the same 120 pairs a confidence ratio
 * under 0.65 removes **53 of 92 artefacts for 2 of 28 real notes**, where the
 * best length cut anywhere costs 7. This is a property of the model rather
 * than of strings, and it is calibrated against captured output of that model
 * — behind a different detector it would have to be measured again.
 *
 * It is also nothing like a clean separation, and should not be read as one.
 * The two distributions overlap heavily: artefacts run 0.33–1.33 with a median
 * of 0.61, real notes 0.49–2.53 with a median of 0.90. Every cut costs
 * something. `harmonic-accuracy.spec.ts` reports the trade-off curve the
 * default was chosen from.
 *
 * Pure, and independent of any detector.
 */

/**
 * Semitone offsets of the partials a plucked string produces, relative to its
 * fundamental. 2f0 = +12, 3f0 = +19.02, 4f0 = +24, 5f0 = +27.86, 6f0 = +31.02,
 * rounded because detectors report integer MIDI pitches.
 *
 * 0 is included: a unison "partial" is the detector reporting one note twice.
 *
 * +28 and +31 are here on physical grounds alone. The synthetic bassline the
 * fixture came from carried only 2nd, 3rd and 4th harmonics, so no pair in it
 * is 28 or 31 semitones apart and no measurement has yet confirmed a detector
 * reports those two. Real recordings should say.
 */
export const HARMONIC_SEMITONES: number[] = [0, 12, 19, 24, 28, 31];

export interface HarmonicOptions {
  /** Slack at both ends of a fundamental's span, for detector jitter. */
  toleranceSec: number;
  /**
   * A unison counts as a re-detection only below this share of the root's
   * confidence.
   *
   * Was `unisonAmplitudeRatio`, which named a quantity it never compared: it
   * reads `DetectedNote.confidence`, exactly as `partialConfidenceRatio` does,
   * and that is not a level. Renamed alongside it rather than left as the one
   * misleading name beside a corrected one. The threshold itself is unchanged
   * and is still the M2 number, not a measured one.
   */
  unisonConfidenceRatio: number;
  /** ...and this share of its duration. */
  unisonDurationRatio: number;
  /**
   * How sure of a partial the detector is, relative to the note under it.
   *
   * Named for the quantity it compares and not for the one a reader expects:
   * `DetectedNote.confidence` is a mean frame activation, not a level, and it
   * does not track how hard a note was played (r = 0.182 over 17.7 dB). This
   * is a statement about the model's certainty, not about acoustics. The
   * module docblock argues why that separates partials from notes at all, and
   * why the duration rule it replaced did not.
   *
   * 0.65 chosen from the 120-pair trade-off curve in
   * `harmonic-eval/harmonic-accuracy.spec.ts`, weighting one destroyed real
   * note as five kept artefacts. That objective is flat to within two artefacts
   * across the whole of [0.615, 0.670]; 0.65 is the point in that band with
   * margin, sitting in an empty 0.649–0.661 stretch of the data with the
   * nearest real note 0.020 above it. The argmax itself, 0.670, sits 0.0001
   * below a real note: fitted rather than chosen.
   */
  partialConfidenceRatio: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicOptions = {
  toleranceSec: 0.03,
  unisonConfidenceRatio: 0.8,
  unisonDurationRatio: 0.5,
  partialConfidenceRatio: 0.65
};

/** Reading order for both lists this module hands back: earliest first. */
function byOnsetThenPitch(a: DetectedNote, b: DetectedNote): number {
  return a.onsetSec - b.onsetSec || a.pitch - b.pitch;
}

/**
 * Removes the partials, and reports what it removed.
 *
 * `suppressed`, if given, collects the notes that did not survive - three
 * quarters of a real detection, and until M2's review the largest discard in
 * the whole pipeline with no record anywhere. `DerivedScore.dropped` exists so
 * a `ScoreDoc` can say why a bar is empty and M3 can render a rejected note
 * greyed rather than let it vanish; suppression happens before derivation ever
 * sees the notes, so without this its losses are invisible to that mechanism.
 * They are worth seeing: measured over the sixteen accuracy fixtures this
 * still destroys three real notes it cannot give back, and a user currently
 * has no way to notice.
 *
 * An out-parameter rather than a widened return, matching `quantizeBar`: the
 * kept notes are what the whole module is about, and twenty-eight call sites
 * in the specs assert on them and nothing else.
 */
export function suppressHarmonics(
  notes: DetectedNote[],
  overrides: Partial<HarmonicOptions> = {},
  suppressed?: DetectedNote[]
): DetectedNote[] {
  const options: HarmonicOptions = { ...DEFAULT_HARMONIC_OPTIONS, ...overrides };

  // Lowest first, so a fundamental is always considered before its own
  // partials, whatever their relative loudness. Confidence then orders notes of
  // equal pitch, which is exactly what the unison rule needs: the strong one
  // must be seen first for the weak short one to be read as its re-detection.
  // Onset breaks the remaining ties, keeping the result deterministic.
  const byPitch = [...notes].sort(
    (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
  );

  const kept: DetectedNote[] = [];
  const removed: DetectedNote[] = [];
  for (const note of byPitch) {
    if (kept.some(root => explains(root, note, options))) removed.push(note);
    else kept.push(note);
  }

  if (suppressed) {
    // Same order as the kept list, so a renderer can walk the two together.
    // Appended one at a time rather than with `push(...removed)`: a long stem
    // discards thousands of partials and spreading them would eventually hit
    // the argument-count limit.
    for (const note of removed.sort(byOnsetThenPitch)) suppressed.push(note);
  }

  return kept.sort(byOnsetThenPitch);
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

  if (interval > 0) {
    // A partial is set ringing by the same pluck as its fundamental, so it
    // cannot start first. Unison is exempt on purpose: a re-detection often
    // straddles the onset of the note it duplicates, and the symmetric
    // overlap above is what catches the earlier half of such a pair.
    if (note.onsetSec < root.onsetSec - options.toleranceSec) return false;

    // Overlap alone would delete real music: an octave leap over a ringing
    // low note, a slapped pop over its thumbed root, pumping octave eighths.
    // What survives them is that the detector is markedly less *sure* of a
    // partial than of the note that produced it — see the module docblock for
    // why that is a claim about the model rather than about the string, and
    // why the duration rule it replaced was neither well founded nor
    // effective.
    return note.confidence < root.confidence * options.partialConfidenceRatio;
  }

  // Unison needs more care. A note genuinely struck twice also overlaps itself
  // when the first one is still ringing, and suppressing that would delete
  // repeated notes — which basslines are full of. A re-detection is both
  // markedly less certain and markedly shorter than the note it duplicates; a
  // real second attack is neither.
  return (
    note.confidence < root.confidence * options.unisonConfidenceRatio &&
    note.offsetSec - note.onsetSec <
      (root.offsetSec - root.onsetSec) * options.unisonDurationRatio
  );
}
