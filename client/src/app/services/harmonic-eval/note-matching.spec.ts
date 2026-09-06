/**
 * The metric itself, tested - because every number the accuracy harness
 * reports is this function's output, and a scorer that is quietly wrong makes
 * the whole exercise worse than useless: it would produce confident,
 * reproducible, false numbers.
 *
 * The one that matters is the **maximum** matching. mir_eval takes a maximum
 * bipartite matching rather than a greedy nearest-onset assignment, and the
 * difference is not cosmetic on this material: greedy can hand the only
 * detection a reference note could have used to a neighbour that had an
 * alternative, and then report a recall failure that never happened. Dense
 * material - repeated notes, pumping octave eighths - is exactly where that
 * bites, and it is exactly the material `MATERIAL` is made of.
 */

import { DetectedNote } from '../../models/transcription.model';
import { GroundTruth, ONSET_TOLERANCE_SEC, score, totals } from './note-matching';

function detection(pitch: number, onsetSec: number): DetectedNote {
  return {
    id: `d${pitch}@${onsetSec}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + 0.2,
    confidence: 0.5,
    bendCents: []
  };
}

const reference = (pitch: number, onsetSec: number): GroundTruth => ({ pitch, onsetSec });

describe('note matching', () => {
  it('matches on exact pitch and nothing near it', () => {
    const scores = score([reference(40, 1)], [detection(41, 1)]);

    expect(scores.matched).toBe(0);
    expect(scores.recall).toBe(0);
    expect(scores.matchOf).toEqual([-1]);
  });

  it('matches inside the onset tolerance and not outside it', () => {
    const inside = score([reference(40, 1)], [detection(40, 1 + ONSET_TOLERANCE_SEC / 2)]);
    const outside = score([reference(40, 1)], [detection(40, 1 + ONSET_TOLERANCE_SEC * 2)]);

    expect(inside.matched).toBe(1);
    expect(outside.matched).toBe(0);
  });

  it('takes the tolerance from its argument, not from the default', () => {
    const detections = [detection(40, 1.09)];

    expect(score([reference(40, 1)], detections, 0.05).matched).toBe(0);
    expect(score([reference(40, 1)], detections, 0.1).matched).toBe(1);
  });

  it('counts an unmatched detection against precision and an unmatched note against recall', () => {
    const scores = score(
      [reference(40, 1), reference(43, 2)],
      [detection(40, 1), detection(52, 1), detection(52, 3)]
    );

    expect(scores.matched).toBe(1);
    expect(scores.precision).toBeCloseTo(1 / 3, 10);
    expect(scores.recall).toBeCloseTo(1 / 2, 10);
    expect(scores.f1).toBeCloseTo(0.4, 10);
  });

  it('reports no score at all rather than dividing by zero', () => {
    const nothing = score([], []);

    expect(nothing.precision).toBe(0);
    expect(nothing.recall).toBe(0);
    expect(nothing.f1).toBe(0);
  });

  it('does not strand a reference note that a greedy assignment would', () => {
    // Both references can use the detection at 1.00; only the one at 1.01 can
    // also reach the detection at 1.04. Assigning each reference its nearest
    // free detection in turn gives 1.01 the shared one and leaves 0.98 with
    // nothing - one recall failure, invented by the metric. The maximum
    // matching pushes 1.01 onto its second choice and finds both.
    const scores = score(
      [reference(40, 1.01), reference(40, 0.98)],
      [detection(40, 1.0), detection(40, 1.04)],
      0.05
    );

    expect(scores.matched).toBe(2);
    expect(scores.recall).toBe(1);
    expect(scores.matchOf).toEqual([1, 0]);
  });

  it('never uses one detection for two reference notes', () => {
    const scores = score([reference(40, 1), reference(40, 1.01)], [detection(40, 1)], 0.05);

    expect(scores.matched).toBe(1);
    expect(scores.matchOf.filter(index => index === 0).length).toBe(1);
  });

  it('prefers the tighter onset among matchings of the same size', () => {
    // Both detections are inside the window, so the count is 1 either way.
    // Which one is named is what a reader inspecting a row will believe, so it
    // is the nearer.
    const scores = score([reference(40, 1)], [detection(40, 1.04), detection(40, 1.005)], 0.05);

    expect(scores.matchOf).toEqual([1]);
  });

  it('pools counts across fixtures rather than averaging their rates', () => {
    // A 1-note fixture scored perfectly and a 9-note fixture scored badly must
    // not come out at 55 %. Overall precision and recall are computed from the
    // totals, so a large fixture weighs what its size says it does.
    const small = score([reference(40, 0)], [detection(40, 0)]);
    const large = score(
      Array.from({ length: 9 }, (_, i) => reference(40, i)),
      // Only the first lands on its reference; the rest fall half a second off.
      Array.from({ length: 9 }, (_, i) => detection(40, i === 0 ? 0 : i + 0.5))
    );
    const all = totals([small, large]);

    expect(all.reference).toBe(10);
    expect(all.estimate).toBe(10);
    expect(all.matched).toBe(2);
    expect(all.recall).toBeCloseTo(0.2, 10);
    expect(all.precision).toBeCloseTo(0.2, 10);
  });
});
