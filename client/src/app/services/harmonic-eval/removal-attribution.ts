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
 * Reporting only. Nothing here decides anything; it just says what did.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

import { DetectedNote } from '../../models/transcription.model';
import { DEFAULT_HARMONIC_OPTIONS, HARMONIC_SEMITONES } from '../transcription-harmonics';
import { DETECTIONS, RawDetection } from './detections.fixture';

/** How long a detection sounds for. */
export const span = (n: DetectedNote): number => n.offsetSec - n.onsetSec;

/**
 * A frozen `[onsetSec, pitch, durationSec, amplitude]` row as a `DetectedNote`.
 *
 * `bendCents` is empty because the capture never recorded it: suppression does
 * not read it, so freezing it would be bytes nothing consumes.
 */
export function toNote([onsetSec, pitch, length, amplitude]: RawDetection, i: number): DetectedNote {
  return {
    id: `d${i}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + length,
    confidence: amplitude,
    bendCents: []
  };
}

/** Every frozen detection for one material, in the order it was captured. */
export const notesOf = (name: string): DetectedNote[] => DETECTIONS[name].map(toNote);

/** `explains`, which is private to the suppressor, reproduced for reporting. */
function explains(root: DetectedNote, note: DetectedNote): boolean {
  const o = DEFAULT_HARMONIC_OPTIONS;
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;
  if (note.onsetSec > root.offsetSec + o.toleranceSec) return false;
  if (root.onsetSec > note.offsetSec + o.toleranceSec) return false;

  if (interval > 0) {
    if (note.onsetSec < root.onsetSec - o.toleranceSec) return false;

    return span(note) < span(root) * o.partialDurationRatio;
  }

  return (
    note.confidence < root.confidence * o.unisonAmplitudeRatio &&
    span(note) < span(root) * o.unisonDurationRatio
  );
}

/**
 * The kept note that explains `note`'s removal, or undefined if none does.
 *
 * The sort is the load-bearing part; see this file's docblock.
 */
export function rootOf(kept: DetectedNote[], note: DetectedNote): DetectedNote | undefined {
  return [...kept]
    .sort((a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec)
    .find(root => explains(root, note));
}

/** One removal, in the terms a threshold could be chosen in. */
export interface Removal {
  /** The removed detection sat on a real note, within the onset tolerance. */
  onRealNote: boolean;
  /** ...and removing it actually cost that note its only match. */
  costTheNote: boolean;
  interval: number;
  spanRatio: number;
  amplitudeRatio: number;
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
