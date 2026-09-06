/**
 * Why a detection was removed - reconstructed, because the suppressor does not
 * say.
 *
 * `suppressHarmonics` hands back the notes it dropped but not the root that
 * explained each one, and without that a removal is just a missing number: no
 * interval, no ratio, nothing to aggregate over and nothing for Task 3 to
 * choose a threshold from. So the rule is reproduced here.
 *
 * That is a duplicate, and duplicates rot. Two things hold it honest. First,
 * it reproduces `explains` exactly, including the scan order: callers must
 * walk `kept` in the order the greedy pass built it - pitch ascending, then
 * amplitude descending, then onset - rather than in the onset order
 * `suppressHarmonics` returns, because scanning in the returned order names a
 * *different* root and therefore a different interval, which is wrong in a way
 * that looks entirely plausible. `rootOf` does that sort itself so a caller
 * cannot get it wrong. Second, `harmonic-accuracy.spec.ts` asserts that every
 * removal is attributable: the moment this copy drifts from the real rule,
 * some removal stops being explainable and the suite fails.
 *
 * ## The monophony prior is attributable here and nowhere else
 *
 * `suppressHarmonics` can now remove a same-attack harmonic pair because the
 * caller declared the source monophonic, without reading
 * `partialConfidenceRatio` at all. That is a different reason from the ratio's
 * and a differently actionable one - a note lost to the declaration comes back
 * by unticking a box - but the shipped `suppressed` list carries notes and not
 * reasons, so the app cannot tell them apart. `rootOf` takes the flag so that
 * the measurement side can: pass what the pass was given, and every removal
 * stays attributable under either rule.
 *
 * Reporting only. Nothing here decides anything; it just says what did.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

import { DetectedNote } from '../../models/transcription.model';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HARMONIC_SEMITONES,
  MONOPHONIC_ATTACK_SEC
} from '../transcription-harmonics';

/** How long a detection sounds for. */
export const span = (n: DetectedNote): number => n.offsetSec - n.onsetSec;

/** `explains`, which is private to the suppressor, reproduced for reporting. */
function explains(root: DetectedNote, note: DetectedNote, monophonic: boolean): boolean {
  const o = DEFAULT_HARMONIC_OPTIONS;
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;
  if (note.onsetSec > root.offsetSec + o.toleranceSec) return false;
  if (root.onsetSec > note.offsetSec + o.toleranceSec) return false;

  if (interval > 0) {
    if (note.onsetSec < root.onsetSec - o.toleranceSec) return false;
    if (monophonic && Math.abs(note.onsetSec - root.onsetSec) <= MONOPHONIC_ATTACK_SEC) {
      return true;
    }

    return note.confidence < root.confidence * o.partialConfidenceRatio;
  }

  return (
    note.confidence < root.confidence * o.unisonConfidenceRatio &&
    span(note) < span(root) * o.unisonDurationRatio
  );
}

/**
 * The kept note that explains `note`'s removal, or undefined if none does.
 *
 * The sort is the load-bearing part; see this file's docblock. `monophonic`
 * must be what the pass being reported on was given, or a removal the prior
 * made comes back unattributed and one the prior did not make is credited to
 * it.
 */
export function rootOf(
  kept: DetectedNote[],
  note: DetectedNote,
  monophonic = false
): DetectedNote | undefined {
  return [...kept]
    .sort((a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec)
    .find(root => explains(root, note, monophonic));
}

/** One removal, in the terms a threshold could be chosen in. */
export interface Removal {
  /** The removed detection sat on a real note, within the onset tolerance. */
  onRealNote: boolean;
  /** ...and removing it actually cost that note its only match. */
  costTheNote: boolean;
  interval: number;
  spanRatio: number;
  /**
   * `note.confidence / root.confidence`. Named for the field it divides: it
   * is a ratio of mean frame activations, not of levels, and calling it an
   * amplitude ratio is how the rule it now arbitrates was mis-justified once
   * already. See `transcription-harmonics.ts`.
   */
  confidenceRatio: number;
  onsetLagSec: number;
}

/** `min .. max  median m` over a set of ratios, for the diagnostic tables. */
export function band(xs: number[]): string {
  if (!xs.length) return 'none';
  const sorted = [...xs].sort((a, b) => a - b);

  return (
    `${sorted[0].toFixed(2).padStart(6)} ..${sorted[sorted.length - 1].toFixed(2).padStart(6)}` +
    `  median ${sorted[Math.floor(sorted.length / 2)].toFixed(2).padStart(5)}`
  );
}
