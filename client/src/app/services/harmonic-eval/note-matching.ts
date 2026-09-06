/**
 * mir_eval-style note matching, and the precision/recall/F1 it yields.
 *
 * A detection matches a ground-truth note when the pitch is *exact* and the
 * onset is within `toleranceSec`. mir_eval then takes a **maximum** matching
 * over that bipartite graph, not a greedy one, and so does this: greedy
 * nearest-onset assignment can strand a reference note that had a partner
 * available, which understates recall on exactly the dense material - repeated
 * notes, octave eighths - this harness exists to measure.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

import { DetectedNote } from '../../models/transcription.model';

export interface GroundTruth {
  pitch: number;
  onsetSec: number;
}

export interface Scores {
  reference: number;
  estimate: number;
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  /** Index into `estimates` for each reference note, or -1. */
  matchOf: number[];
}

export const ONSET_TOLERANCE_SEC = 0.05;

/** Kuhn's algorithm. Reference notes on the left, detections on the right. */
export function score(
  reference: GroundTruth[],
  estimates: DetectedNote[],
  toleranceSec: number = ONSET_TOLERANCE_SEC
): Scores {
  const candidates = reference.map(ref =>
    estimates
      .map((est, index) => ({ index, distance: Math.abs(est.onsetSec - ref.onsetSec) }))
      .filter(c => estimates[c.index].pitch === ref.pitch && c.distance <= toleranceSec)
      // Nearest first: the maximum matching is what the count comes from, but
      // among equally maximal matchings this picks the tighter onsets, which
      // is what a reader expects when they look at which detection was chosen.
      .sort((a, b) => a.distance - b.distance)
      .map(c => c.index)
  );

  const takenBy: number[] = new Array(estimates.length).fill(-1);

  const augment = (ref: number, seen: boolean[]): boolean => {
    for (const est of candidates[ref]) {
      if (seen[est]) continue;
      seen[est] = true;
      if (takenBy[est] === -1 || augment(takenBy[est], seen)) {
        takenBy[est] = ref;
        return true;
      }
    }

    return false;
  };

  let matched = 0;
  for (let ref = 0; ref < reference.length; ref++) {
    if (augment(ref, new Array(estimates.length).fill(false))) matched++;
  }

  const matchOf: number[] = new Array(reference.length).fill(-1);
  takenBy.forEach((ref, est) => {
    if (ref !== -1) matchOf[ref] = est;
  });

  const precision = estimates.length ? matched / estimates.length : 0;
  const recall = reference.length ? matched / reference.length : 0;

  return {
    reference: reference.length,
    estimate: estimates.length,
    matched,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    matchOf
  };
}

export function totals(all: Scores[]): Scores {
  const reference = all.reduce((s, x) => s + x.reference, 0);
  const estimate = all.reduce((s, x) => s + x.estimate, 0);
  const matched = all.reduce((s, x) => s + x.matched, 0);
  const precision = estimate ? matched / estimate : 0;
  const recall = reference ? matched / reference : 0;

  return {
    reference,
    estimate,
    matched,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    matchOf: []
  };
}

export const pct = (x: number): string => (x * 100).toFixed(1).padStart(5);
