/**
 * The measurement `suppressHarmonics` is judged by.
 *
 * Runs the suppressor over the frozen detector output in
 * `detections.fixture.ts` and scores both stages against the ground truth in
 * `material.ts`. No browser beyond karma, no model, no GPU, no audio - pure
 * arithmetic over two frozen arrays, so it runs in the default suite and gives
 * the same answer on every machine. `harmonic-capture.spec.ts` is the slow
 * half that produces the fixture; it is excluded from this suite.
 *
 * ## Two kinds of loss, kept apart
 *
 * 40 of the 122 ground-truth notes are never detected at all - 71 % of `run`,
 * 56 % of `octaves`. Those are the detector's limits and nothing in
 * `transcription-harmonics.ts` can recover them. Suppression's own losses are
 * 12 notes. Pooling the two would let a change that destroys real notes hide
 * behind a detector that was never going to find them, so the table carries
 * them as separate columns (`miss` and `lost`) and the two listings below name
 * every note in each.
 *
 * ## The assertions are a regression floor, not a target
 *
 * The raw-detector counts are asserted **exactly**: they are a property of the
 * frozen fixture and the frozen material, so if they move, one of those two
 * files was edited without the other being re-captured, and every number here
 * is describing a state that never existed.
 *
 * The suppressed numbers are asserted as **floors**. They are not good - 55.6 %
 * precision means most of what survives is still an artefact - and the plan
 * this harness was built for exists to raise them. The point of pinning them
 * is the opposite of aspiration: an optimisation, a refactor or a "tidy up" of
 * the suppressor that quietly costs accuracy has, until now, had nothing to
 * fail against.
 *
 * ## Onset window
 *
 * The headline uses a 50 ms window, and that is tight for this register: Basic
 * Pitch's onset error on a 41 Hz note runs to five of its own 11.6 ms frames,
 * so some of what reads as a recall failure is a note found slightly late. A
 * 75 ms row is reported beside it so the tightness is visible rather than
 * buried, and the full 50/75/100/150 sweep below confirms the *relative*
 * verdict on suppression is the same at every window - which is why the choice
 * of window does not affect any conclusion drawn here.
 */

import { DetectedNote } from '../../models/transcription.model';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HARMONIC_SEMITONES,
  suppressHarmonics
} from '../transcription-harmonics';
import { MATERIAL } from './material';
import { ONSET_TOLERANCE_SEC, pct, score, totals } from './note-matching';
import type { Scores } from './note-matching';
import { band, notesOf, rootOf, span } from './removal-attribution';
import type { Removal } from './removal-attribution';

/** The second window reported beside the headline. See the docblock. */
const WIDE_TOLERANCE_SEC = 0.075;

/**
 * What the harness measures today, and what a change may not silently undo.
 *
 * Rates are floored a tenth of a point below the measured value so that
 * rounding can never fail the suite; counts are exact where the fixture alone
 * determines them.
 */
const MEASURED = {
  /** Exact: the frozen fixture and the frozen material fix all three. */
  referenceNotes: 122,
  rawDetections: 193,
  rawMatched: 82,
  /** Exact: a detector miss is decided before suppression ever runs. */
  detectorMisses: 40,
  /** Floors: 55.6 / 57.4 / 56.5 at 50 ms, 66.1 F1 at 75 ms. */
  keptPrecision: 0.555,
  keptRecall: 0.573,
  keptF1: 0.564,
  keptF1Wide: 0.66,
  /** Ceiling: 12 real notes destroyed. Task 3's gate is to lower this. */
  realNotesDestroyed: 12
};

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

describe('harmonic suppression accuracy', () => {
  const rawScores: Scores[] = [];
  const keptScores: Scores[] = [];
  const table: string[] = [];
  const destroyed: string[] = [];
  const undetected: string[] = [];
  const removals: Removal[] = [];
  let unattributed = 0;

  beforeAll(() => {
    for (const material of MATERIAL) {
      const detections = notesOf(material.name);
      const removed: DetectedNote[] = [];
      const kept = suppressHarmonics(detections, {}, removed);

      const before = score(material.notes, detections);
      const after = score(material.notes, kept);
      rawScores.push(before);
      keptScores.push(after);

      // A note the detector never found, and a note suppression destroyed,
      // are different failures with different owners. Counted separately here
      // and listed separately below.
      const missed = before.reference - before.matched;
      const lost = before.matched - after.matched;

      table.push(
        `${material.name.padEnd(9)} ${String(before.reference).padStart(4)} ` +
          `${String(before.estimate).padStart(5)} ${pct(before.precision)} ` +
          `${pct(before.recall)} ${pct(before.f1)}  ` +
          `${String(after.estimate).padStart(5)} ${pct(after.precision)} ` +
          `${pct(after.recall)} ${pct(after.f1)}  ` +
          `${String(missed).padStart(4)} ${String(lost).padStart(5)}`
      );

      const costTheNote = (note: DetectedNote): boolean =>
        material.notes.some(
          (ref, index) =>
            ref.pitch === note.pitch &&
            Math.abs(ref.onsetSec - note.onsetSec) <= ONSET_TOLERANCE_SEC &&
            before.matchOf[index] !== -1 &&
            after.matchOf[index] === -1
        );

      for (const note of removed) {
        const root = rootOf(kept, note);
        if (!root) {
          unattributed++;
          continue;
        }

        removals.push({
          onRealNote: material.notes.some(
            ref =>
              ref.pitch === note.pitch &&
              Math.abs(ref.onsetSec - note.onsetSec) <= ONSET_TOLERANCE_SEC
          ),
          costTheNote: costTheNote(note),
          interval: note.pitch - root.pitch,
          spanRatio: span(note) / span(root),
          amplitudeRatio: note.confidence / root.confidence,
          onsetLagSec: note.onsetSec - root.onsetSec
        });
      }

      material.notes.forEach((ref, index) => {
        if (before.matchOf[index] === -1) {
          const near = detections
            .filter(d => Math.abs(d.onsetSec - ref.onsetSec) < 0.12)
            .map(d => `${d.pitch}@${d.onsetSec.toFixed(3)}`)
            .join(' ');
          undetected.push(
            `  ${material.name.padEnd(9)} MIDI ${String(ref.pitch).padStart(2)} ` +
              `@${ref.onsetSec.toFixed(2)} - near it: ${near || '(nothing)'}`
          );

          return;
        }

        if (after.matchOf[index] !== -1) return;

        for (const casualty of removed.filter(
          d =>
            d.pitch === ref.pitch && Math.abs(d.onsetSec - ref.onsetSec) <= ONSET_TOLERANCE_SEC
        )) {
          const root = rootOf(kept, casualty);
          const why =
            root === undefined
              ? 'UNATTRIBUTED'
              : casualty.pitch === root.pitch
                ? `unison of ${root.pitch}@${root.onsetSec.toFixed(3)} ` +
                  `(amp ${casualty.confidence.toFixed(2)}/${root.confidence.toFixed(2)}, ` +
                  `len ${(span(casualty) / span(root)).toFixed(2)})`
                : `+${casualty.pitch - root.pitch} under ${root.pitch}` +
                  `@${root.onsetSec.toFixed(3)} ` +
                  `(len ${span(casualty).toFixed(2)}/${span(root).toFixed(2)} = ` +
                  `${(span(casualty) / span(root)).toFixed(2)} < ` +
                  `${DEFAULT_HARMONIC_OPTIONS.partialDurationRatio})`;

          destroyed.push(
            `  ${material.name.padEnd(9)} MIDI ${String(ref.pitch).padStart(2)} ` +
              `@${ref.onsetSec.toFixed(2)} lost as ${why}`
          );
        }
      });
    }
  });

  /** Scores the whole set at one onset window, both stages. */
  function overall(toleranceSec: number): { raw: Scores; kept: Scores } {
    return {
      raw: totals(MATERIAL.map(m => score(m.notes, notesOf(m.name), toleranceSec))),
      kept: totals(
        MATERIAL.map(m => score(m.notes, suppressHarmonics(notesOf(m.name)), toleranceSec))
      )
    };
  }

  function overallRow(label: string, raw: Scores, kept: Scores): string {
    return (
      `${label.padEnd(9)} ${String(raw.reference).padStart(4)} ` +
      `${String(raw.estimate).padStart(5)} ${pct(raw.precision)} ` +
      `${pct(raw.recall)} ${pct(raw.f1)}  ` +
      `${String(kept.estimate).padStart(5)} ${pct(kept.precision)} ` +
      `${pct(kept.recall)} ${pct(kept.f1)}  ` +
      `${String(raw.reference - raw.matched).padStart(4)} ` +
      `${String(raw.matched - kept.matched).padStart(5)}`
    );
  }

  it('reports precision, recall and F1 before and after suppression', () => {
    const rawAll = totals(rawScores);
    const keptAll = totals(keptScores);
    const wide = overall(WIDE_TOLERANCE_SEC);

    log('');
    log(`ACC exact pitch; headline window +-${ONSET_TOLERANCE_SEC * 1000} ms`);
    log('ACC                        raw detector                after suppression   detector  supp.');
    log('ACC  fixture   ref   est     P     R    F1    est     P     R    F1   miss  lost');
    for (const row of table) log(`ACC  ${row}`);
    log(`ACC  ${overallRow('OVERALL', rawAll, keptAll)}`);
    log(`ACC  ${overallRow('@75ms', wide.raw, wide.kept)}`);

    // Exact. These three come from the frozen fixture and the frozen material
    // and from nothing else, so a change here means one was edited without the
    // other being re-captured - and every other number below is then fiction.
    expect(rawAll.reference).toBe(MEASURED.referenceNotes);
    expect(rawAll.estimate).toBe(MEASURED.rawDetections);
    expect(rawAll.matched).toBe(MEASURED.rawMatched);

    // Floors. See the docblock: not targets.
    expect(keptAll.precision).toBeGreaterThanOrEqual(MEASURED.keptPrecision);
    expect(keptAll.recall).toBeGreaterThanOrEqual(MEASURED.keptRecall);
    expect(keptAll.f1).toBeGreaterThanOrEqual(MEASURED.keptF1);
    // The same verdict at the wider window, so no improvement can be an
    // artefact of the tight one.
    expect(wide.kept.f1).toBeGreaterThanOrEqual(MEASURED.keptF1Wide);
  });

  it('names every real note suppression destroyed, apart from those never detected', () => {
    log('');
    log(`ACC real notes destroyed by suppression: ${destroyed.length}`);
    for (const row of destroyed) log(`ACC${row}`);
    log('');
    log(
      `ACC real notes the detector never found: ${undetected.length} ` +
        '- not suppression\'s, and not recoverable here'
    );
    for (const row of undetected) log(`ACC${row}`);

    // Every removal must be explainable by the rule that made it, or the
    // attribution in the listing above is invented.
    expect(unattributed).toBe(0);

    // A ceiling, not a floor: destroying a real note is the failure this
    // whole exercise is about, and 12 is what it costs today.
    expect(destroyed.length).toBeLessThanOrEqual(MEASURED.realNotesDestroyed);

    // Exact: suppression cannot change what the detector failed to find, so
    // this number moves only when the fixture does.
    expect(undetected.length).toBe(MEASURED.detectorMisses);
  });

  it('separates a detector timing miss from a detector blind spot', () => {
    // The headline asks for 50 ms. Widening the window says how much of what
    // reads there as a recall failure is a note found slightly late instead.
    // A diagnostic: nothing is tuned to it, and the assertion is only that the
    // relative verdict on suppression does not depend on the choice.
    log('');
    log('ACC sensitivity of the whole measurement to the onset window');
    for (const tolerance of [ONSET_TOLERANCE_SEC, WIDE_TOLERANCE_SEC, 0.1, 0.15]) {
      const { raw, kept } = overall(tolerance);

      log(
        `ACC  +-${String(tolerance * 1000).padStart(3)} ms  ` +
          `raw P${pct(raw.precision)} R${pct(raw.recall)} F${pct(raw.f1)}  |  ` +
          `kept P${pct(kept.precision)} R${pct(kept.recall)} F${pct(kept.f1)}`
      );

      expect(kept.f1).toBeGreaterThan(raw.f1);
    }
  });

  it('says what suppression traded, and whether the rule can see the difference', () => {
    const cost = removals.filter(r => r.costTheNote);
    const free = removals.filter(r => !r.costTheNote);

    log('');
    log(
      `ACC suppression removed ${removals.length} detections: ` +
        `${free.length} cost nothing, ${cost.length} cost a real note`
    );
    // The middle group is the one worth spelling out: a removal can sit on a
    // real note and still be harmless, because another detection of the same
    // note survived. Counting those as damage would overstate the cost by
    // half again.
    log(
      `ACC  of the ${free.length} that cost nothing, ` +
        `${free.filter(r => !r.onRealNote).length} sat on no real note at all and ` +
        `${free.filter(r => r.onRealNote).length} duplicated one that survived`
    );
    for (const interval of HARMONIC_SEMITONES) {
      const at = removals.filter(r => r.interval === interval);
      if (!at.length) continue;
      log(
        `ACC  +${String(interval).padStart(2)}: ` +
          `${String(at.filter(r => !r.costTheNote).length).padStart(3)} harmless, ` +
          `${String(at.filter(r => r.costTheNote).length).padStart(2)} cost a real note`
      );
    }

    for (const [label, subset] of [
      ['above the root', removals.filter(r => r.interval > 0)],
      ['unison', removals.filter(r => r.interval === 0)]
    ] as [string, Removal[]][]) {
      const fakes = subset.filter(r => !r.onRealNote);
      const reals = subset.filter(r => r.onRealNote);
      log('');
      log(`ACC  ${label}: can any one number tell an artefact from a note?`);
      for (const [name, pick] of [
        ['length ratio   ', (r: Removal) => r.spanRatio],
        ['amplitude ratio', (r: Removal) => r.amplitudeRatio],
        ['onset lag (s)  ', (r: Removal) => r.onsetLagSec]
      ] as [string, (r: Removal) => number][]) {
        log(
          `ACC    ${name}  artefact ${band(fakes.map(pick))}   ` +
            `real ${band(reals.map(pick))}`
        );
      }
    }

    expect(removals.length).toBeGreaterThan(0);
    expect(cost.length).toBeLessThanOrEqual(MEASURED.realNotesDestroyed);
  });

  it('scores the discriminators over every pair the duration clause arbitrates', () => {
    // The bands above are conditioned on the rule having already fired, which
    // is a selection effect: they say what the survivors of one threshold look
    // like, not what a threshold would have to separate. This is the honest
    // population - every detection that has a lower detection under it at a
    // partial's interval, overlapping, and starting no earlier. For each of
    // those the duration clause alone decides, so this is what any replacement
    // for it would have to work on, and it is the data Task 3 chooses from.
    interface Pair {
      onRealNote: boolean;
      spanRatio: number;
      amplitudeRatio: number;
      onsetLagSec: number;
    }
    const pairs: Pair[] = [];
    const o = DEFAULT_HARMONIC_OPTIONS;

    for (const material of MATERIAL) {
      const detections = notesOf(material.name);
      const byPitch = [...detections].sort((a, b) => a.pitch - b.pitch);

      for (const note of detections) {
        const root = byPitch.find(
          candidate =>
            candidate !== note &&
            HARMONIC_SEMITONES.includes(note.pitch - candidate.pitch) &&
            note.pitch - candidate.pitch > 0 &&
            note.onsetSec <= candidate.offsetSec + o.toleranceSec &&
            candidate.onsetSec <= note.offsetSec + o.toleranceSec &&
            note.onsetSec >= candidate.onsetSec - o.toleranceSec
        );
        if (!root) continue;

        pairs.push({
          onRealNote: material.notes.some(
            ref =>
              ref.pitch === note.pitch &&
              Math.abs(ref.onsetSec - note.onsetSec) <= ONSET_TOLERANCE_SEC
          ),
          spanRatio: span(note) / span(root),
          amplitudeRatio: note.confidence / root.confidence,
          onsetLagSec: note.onsetSec - root.onsetSec
        });
      }
    }

    const reals = pairs.filter(p => p.onRealNote);
    const fakes = pairs.filter(p => !p.onRealNote);

    log('');
    log(
      `ACC ${pairs.length} candidate pairs above a root: ` +
        `${fakes.length} artefacts, ${reals.length} real notes. ` +
        'Best single-threshold split each feature admits:'
    );

    for (const [name, pick] of [
      ['length ratio   ', (p: Pair) => p.spanRatio],
      ['amplitude ratio', (p: Pair) => p.amplitudeRatio],
      ['onset lag (s)  ', (p: Pair) => p.onsetLagSec]
    ] as [string, (p: Pair) => number][]) {
      // Sweep every value as a threshold, suppressing below it, and keep the
      // one that removes most artefacts for fewest real notes. The 3:1 weight
      // is a reporting choice and nothing is tuned to it here; Task 3 picks a
      // cut and states its own weighting.
      let best = { cut: 0, dropped: 0, cost: reals.length + 1 };
      for (const cut of pairs.map(pick).sort((a, b) => a - b)) {
        const dropped = fakes.filter(p => pick(p) < cut).length;
        const cost = reals.filter(p => pick(p) < cut).length;
        if (dropped - 3 * cost > best.dropped - 3 * best.cost) best = { cut, dropped, cost };
      }

      log(
        `ACC  ${name} cut at ${best.cut.toFixed(3).padStart(6)} removes ` +
          `${String(best.dropped).padStart(3)}/${fakes.length} artefacts ` +
          `for ${best.cost}/${reals.length} real notes`
      );
    }

    // ...and what the shipped threshold does on the same population.
    log(
      `ACC  shipped: length ratio < ${o.partialDurationRatio} removes ` +
        `${fakes.filter(p => p.spanRatio < o.partialDurationRatio).length}/${fakes.length} ` +
        `artefacts for ${reals.filter(p => p.spanRatio < o.partialDurationRatio).length}/` +
        `${reals.length} real notes`
    );

    expect(pairs.length).toBeGreaterThan(0);
  });
});
