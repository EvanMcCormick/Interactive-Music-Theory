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
 * 51 of the 182 ground-truth notes are never detected at all - 71 % of `run`,
 * 56 % of `octaves`, 62 % of `ghosts`. Those are the detector's limits and
 * nothing in `transcription-harmonics.ts` can recover them. Suppression's own
 * losses are 3 notes. Pooling the two would let a change that destroys real
 * notes hide behind a detector that was never going to find them, so the table
 * carries them as separate columns (`miss` and `lost`) and the two listings
 * below name every note in each.
 *
 * ## What replacing the discriminator did to these numbers
 *
 * The partial branch used to arbitrate on a duration ratio and now arbitrates
 * on `partialConfidenceRatio`. Over the same sixteen fixtures:
 *
 * |                     |     P |     R |    F1 | real notes destroyed |
 * |---------------------|-------|-------|-------|----------------------|
 * | raw detector        |  42.3 |  72.0 |  53.3 |                    - |
 * | length ratio < 0.9  |  56.5 |  59.9 |  58.1 |               **22** |
 * | confidence  < 0.65  |  61.2 |  70.3 |  65.5 |                **3** |
 *
 * Recall barely falls now - 72.0 raw against 70.3 kept, where the duration
 * rule cost twelve points of it - because almost everything the new clause
 * removes is an artefact. Five of the six rows where suppression used to be
 * *worse* than the raw detector are no longer: `fifths` 54.5 -> 66.7, `leaps`
 * 37.5 -> 73.7, `slap` 26.7 -> 60.0, `quietOverLoud` 42.1 -> 72.7,
 * `loudOverQuiet` 60.0 -> 92.3, each of those now also above its own raw row.
 *
 * `ghosts` is the one that does not close: 35.7 raw against 30.0 kept, exactly
 * as before. Its two casualties are dead notes at velocity 0.13-0.14 struck
 * over roots at full strength, and they are the only place in the set where
 * `confidence` really does follow how hard a note was hit - 0.49 and 0.62 of
 * their root's. Sparing them means a cut below 0.49, which costs eight points
 * of precision across the set. That is the trade this fixture exists to make
 * visible, and it is being declined rather than overlooked.
 *
 * The third casualty, `slap` E1 at 1.00 s, is not this clause's: it is removed
 * as a unison re-detection, which the change did not touch.
 *
 * ## The assertions are a regression floor, not a target
 *
 * The raw-detector counts are asserted **exactly**: they are a property of the
 * frozen fixture and the frozen material, so if they move, one of those two
 * files was edited without the other being re-captured, and every number here
 * is describing a state that never existed.
 *
 * The suppressed numbers are asserted as **floors**. They are still not good -
 * 61.2 % precision means two of every five surviving notes is an artefact. The
 * point of pinning them is the opposite of aspiration: an optimisation, a
 * refactor or a "tidy up" of the suppressor that quietly costs accuracy has
 * nothing else to fail against.
 *
 * ## Re-measuring the intervals did not move them
 *
 * The interval list was re-measured after the discriminator changed, and every
 * one of the six earned its place or was never given a chance to lose it - so
 * nothing was pruned and these numbers are unchanged by that pass.
 * `re-measures every partial interval now that the discriminator works` below
 * carries the table and the reasoning; `HARMONIC_SEMITONES` carries the
 * conclusion. The short version is that +24 read as pure harm under the
 * duration clause (0 artefacts, 4 real notes) and reads as 3 artefacts for 0
 * real notes under this one, which is why the plan forbade pruning on the
 * earlier numbers.
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
  NO_NOTE_DECISIONS,
  suppressHarmonics
} from '../transcription-harmonics';
import { MATERIAL } from './material';
import { ONSET_TOLERANCE_SEC, pct, score, totals } from './note-matching';
import type { Scores } from './note-matching';
import { detectionsOf } from './detections.fixture';
import { band, rootOf, span } from './removal-attribution';
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
  referenceNotes: 182,
  rawDetections: 310,
  rawMatched: 131,
  /** Exact: a detector miss is decided before suppression ever runs. */
  detectorMisses: 51,
  /** Floors: 61.2 / 70.3 / 65.5 at 50 ms, 74.7 F1 at 75 ms. */
  keptPrecision: 0.611,
  keptRecall: 0.702,
  keptF1: 0.654,
  keptF1Wide: 0.746,
  /**
   * Ceiling: 3 real notes destroyed, down from 22 under the duration rule. Two
   * are the `ghosts` dead notes the docblock argues are not worth eight points
   * of precision; the third is a unison re-detection, not this clause's doing.
   */
  realNotesDestroyed: 3
};

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

describe('harmonic suppression accuracy', () => {
  const rawScores: Scores[] = [];
  const keptScores: Scores[] = [];
  const table: string[] = [];
  const destroyed: string[] = [];
  const undetected: string[] = [];
  const removals: Removal[] = [];
  /** How hard a note was played against what the detector said about it. */
  const dynamics: { velocity: number; confidence: number }[] = [];
  let unattributed = 0;

  beforeAll(() => {
    for (const material of MATERIAL) {
      const detections = detectionsOf(material.name);
      const removed: DetectedNote[] = [];
      const kept = suppressHarmonics(detections, {}, NO_NOTE_DECISIONS, removed);

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
        `${material.name.padEnd(13)} ${String(before.reference).padStart(4)} ` +
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
          confidenceRatio: note.confidence / root.confidence,
          onsetLagSec: note.onsetSec - root.onsetSec
        });
      }

      if (material.notes.some(note => note.velocity !== undefined)) {
        material.notes.forEach((ref, index) => {
          const est = before.matchOf[index];
          if (est !== -1) {
            dynamics.push({ velocity: ref.velocity ?? 1, confidence: detections[est].confidence });
          }
        });
      }

      material.notes.forEach((ref, index) => {
        if (before.matchOf[index] === -1) {
          const near = detections
            .filter(d => Math.abs(d.onsetSec - ref.onsetSec) < 0.12)
            .map(d => `${d.pitch}@${d.onsetSec.toFixed(3)}`)
            .join(' ');
          undetected.push(
            `  ${material.name.padEnd(13)} MIDI ${String(ref.pitch).padStart(2)} ` +
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
          // Both ratios, on every casualty, whichever clause did the killing:
          // the confidence one is what fires on the partial branch, and the
          // length one is reported beside it so that the rule this replaced
          // can still be seen not to have separated these notes either.
          const why =
            root === undefined
              ? 'UNATTRIBUTED'
              : casualty.pitch === root.pitch
                ? `unison of ${root.pitch}@${root.onsetSec.toFixed(3)} ` +
                  `(conf ${(casualty.confidence / root.confidence).toFixed(2)}, ` +
                  `len ${(span(casualty) / span(root)).toFixed(2)})`
                : `+${casualty.pitch - root.pitch} under ${root.pitch}` +
                  `@${root.onsetSec.toFixed(3)} ` +
                  `(conf ${(casualty.confidence / root.confidence).toFixed(2)} < ` +
                  `${DEFAULT_HARMONIC_OPTIONS.partialConfidenceRatio}, ` +
                  `len ${(span(casualty) / span(root)).toFixed(2)})`;

          destroyed.push(
            `  ${material.name.padEnd(13)} MIDI ${String(ref.pitch).padStart(2)} ` +
              `@${ref.onsetSec.toFixed(2)} lost as ${why}`
          );
        }
      });
    }
  });

  /** Scores the whole set at one onset window, both stages. */
  function overall(toleranceSec: number): { raw: Scores; kept: Scores } {
    return {
      raw: totals(MATERIAL.map(m => score(m.notes, detectionsOf(m.name), toleranceSec))),
      kept: totals(
        MATERIAL.map(m => score(m.notes, suppressHarmonics(detectionsOf(m.name)), toleranceSec))
      )
    };
  }

  function overallRow(label: string, raw: Scores, kept: Scores): string {
    return (
      `${label.padEnd(13)} ${String(raw.reference).padStart(4)} ` +
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
    log('ACC                            raw detector                after suppression   detector  supp.');
    log('ACC  fixture        ref   est     P     R    F1    est     P     R    F1   miss  lost');
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
    // whole exercise is about, and 3 is what it costs today.
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
        ['length ratio    ', (r: Removal) => r.spanRatio],
        ['confidence ratio', (r: Removal) => r.confidenceRatio],
        ['onset lag (s)   ', (r: Removal) => r.onsetLagSec]
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

  it('shows that what the detector reports is not how hard the note was played', () => {
    // The six materials with dynamics were added because the partial branch
    // was about to rest on a ratio of `confidence`, and a rule about how hard
    // a note was played, measured on material with one dynamic level, is
    // asserted rather than measured. This is what they said back, and it is
    // not what was expected.
    //
    // `DetectedNote.confidence` is not amplitude. `basic-pitch-detector.ts`
    // says what it is - the *mean frame activation* over the note's span,
    // bounded below by the model's own 0.3 frame threshold by construction -
    // and across a 17.7 dB range of pluck strength it barely moves. On
    // `accents` the loud downbeat roots come back at 0.46 while the offbeat
    // octaves played at a third of their strength come back at 0.62: the
    // quiet notes score *higher*.
    //
    // That cuts both ways for the rule that shipped, and both ways are worth
    // stating. Favourably: `partialConfidenceRatio` cannot be knocked over by
    // dynamics, because it cannot see them - which is why the best cut on this
    // expanded set is exactly where it was on the uniform one. Unfavourably:
    // the rule may not be justified by saying partials start 8-35 dB below
    // their fundamental and this ratio measures that. It does not measure it.
    // Whatever separating power the ratio has comes from the model being less
    // certain about a partial than about a note, which is a different claim
    // and is argued as one in `transcription-harmonics.ts`.
    const soft = dynamics.filter(d => d.velocity <= 0.35).map(d => d.confidence);
    const hard = dynamics.filter(d => d.velocity >= 0.85).map(d => d.confidence);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const velocities = dynamics.map(d => d.velocity);

    log('');
    log(
      `ACC ${dynamics.length} detected notes across the six materials that carry dynamics, ` +
        `plucked from ${Math.min(...velocities).toFixed(2)} to ` +
        `${Math.max(...velocities).toFixed(2)} of full strength ` +
        `(${(20 * Math.log10(Math.max(...velocities) / Math.min(...velocities))).toFixed(1)} dB)`
    );
    log(
      `ACC  mean confidence  softest (velocity <= 0.35) ${mean(soft).toFixed(3)} over ${soft.length}` +
        `   hardest (>= 0.85) ${mean(hard).toFixed(3)} over ${hard.length}` +
        `   ratio ${(mean(soft) / mean(hard)).toFixed(3)}`
    );
    log(
      'ACC  a ratio near 1 where the plucks differ by a factor of three is the finding: ' +
        'confidence is a mean frame activation, not a level'
    );

    // The material really does carry dynamics - if this fails, the fixtures
    // stopped testing what they were added to test.
    expect(Math.min(...velocities)).toBeLessThan(0.2);
    expect(Math.max(...velocities)).toBe(1);

    // ...and the detector reports them as very nearly the same note.
    // Measured 0.954 against a physical amplitude ratio near 0.3; the bound
    // is loose because the point is the order of magnitude, not the digit.
    // If a detector change ever makes confidence track dynamics, this fails,
    // and it should: every threshold chosen on this fixture would need
    // revisiting.
    expect(mean(soft) / mean(hard)).toBeGreaterThan(0.8);
  });

  /**
   * Every detection that has a lower detection under it at a partial's
   * interval, overlapping it, and starting no earlier.
   *
   * The bands in the spec above are conditioned on the rule having already
   * fired, which is a selection effect: they describe the survivors of one
   * threshold, not the population a threshold has to separate. This is that
   * population. For every pair in it, the partial branch's one remaining
   * clause decides alone, so this is the data `partialConfidenceRatio` was
   * chosen from and the data any replacement for it would have to beat.
   */
  interface Pair {
    onRealNote: boolean;
    /** Semitones between the pair, so the population can be split by interval. */
    interval: number;
    spanRatio: number;
    confidenceRatio: number;
    onsetLagSec: number;
  }

  function candidatePairs(): Pair[] {
    const pairs: Pair[] = [];
    const o = DEFAULT_HARMONIC_OPTIONS;

    for (const material of MATERIAL) {
      const detections = detectionsOf(material.name);
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
          interval: note.pitch - root.pitch,
          spanRatio: span(note) / span(root),
          confidenceRatio: note.confidence / root.confidence,
          onsetLagSec: note.onsetSec - root.onsetSec
        });
      }
    }

    return pairs;
  }

  it('scores the discriminators over every pair the partial clause arbitrates', () => {
    const pairs = candidatePairs();
    const reals = pairs.filter(p => p.onRealNote);
    const fakes = pairs.filter(p => !p.onRealNote);
    const o = DEFAULT_HARMONIC_OPTIONS;

    log('');
    log(
      `ACC ${pairs.length} candidate pairs above a root: ` +
        `${fakes.length} artefacts, ${reals.length} real notes. ` +
        'Best single-threshold split each feature admits:'
    );

    for (const [name, pick] of [
      ['length ratio    ', (p: Pair) => p.spanRatio],
      ['confidence ratio', (p: Pair) => p.confidenceRatio],
      ['onset lag (s)   ', (p: Pair) => p.onsetLagSec]
    ] as [string, (p: Pair) => number][]) {
      // Sweep every value as a threshold, suppressing below it, and keep the
      // one that removes most artefacts for fewest real notes. The 3:1 weight
      // here is a reporting choice only; the shipped cut states its own, and
      // the curve below is what it was actually read off.
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

    log(
      `ACC  shipped: confidence ratio < ${o.partialConfidenceRatio} removes ` +
        `${fakes.filter(p => p.confidenceRatio < o.partialConfidenceRatio).length}/` +
        `${fakes.length} artefacts for ` +
        `${reals.filter(p => p.confidenceRatio < o.partialConfidenceRatio).length}/` +
        `${reals.length} real notes`
    );
    log(
      'ACC  the rule this replaced: length ratio < 0.9 removed ' +
        `${fakes.filter(p => p.spanRatio < 0.9).length}/${fakes.length} artefacts for ` +
        `${reals.filter(p => p.spanRatio < 0.9).length}/${reals.length} real notes`
    );

    expect(pairs.length).toBeGreaterThan(0);
  });

  /**
   * Every (root, note) pair at `interval` that the partial clause was offered:
   * overlapping, upper note starting no earlier, everything except the
   * confidence test itself. Every root, not just the first — the question here
   * is how often the clause got to decide at this interval, and a note with
   * two possible roots was two chances to be wrong.
   */
  function opportunitiesAt(interval: number): { artefact: number; real: number } {
    const o = DEFAULT_HARMONIC_OPTIONS;
    let artefact = 0;
    let real = 0;

    for (const material of MATERIAL) {
      const detections = detectionsOf(material.name);
      for (const note of detections) {
        for (const root of detections) {
          if (root === note) continue;
          if (note.pitch - root.pitch !== interval) continue;
          if (note.onsetSec > root.offsetSec + o.toleranceSec) continue;
          if (root.onsetSec > note.offsetSec + o.toleranceSec) continue;
          if (interval > 0 && note.onsetSec < root.onsetSec - o.toleranceSec) continue;

          const onRealNote = material.notes.some(
            ref =>
              ref.pitch === note.pitch &&
              Math.abs(ref.onsetSec - note.onsetSec) <= ONSET_TOLERANCE_SEC
          );
          if (onRealNote) real++;
          else artefact++;
        }
      }
    }

    return { artefact, real };
  }

  it('re-measures every partial interval now that the discriminator works', () => {
    // Task 4. The interval list had to be re-measured rather than pruned on
    // the numbers that were already in hand, because those were gathered under
    // the duration clause and describe it rather than the intervals. Under
    // that clause +19 came out net harmful (4 artefacts against 5 real notes)
    // and +24 came out pure harm - 0 artefacts, 4 real notes destroyed. Both
    // reversed when the clause changed.
    log('');
    log('ACC per-interval evidence, under the confidence clause');
    log('ACC  interval   artefacts   dupes of a   real notes   pairs the clause');
    log('ACC              removed    kept note     destroyed   was ever offered');

    for (const interval of HARMONIC_SEMITONES) {
      const at = removals.filter(r => r.interval === interval);
      const artefacts = at.filter(r => !r.onRealNote && !r.costTheNote).length;
      const dupes = at.filter(r => r.onRealNote && !r.costTheNote).length;
      const cost = at.filter(r => r.costTheNote).length;
      const offered = opportunitiesAt(interval);

      log(
        `ACC  +${String(interval).padStart(2)}       ${String(artefacts).padStart(9)}   ` +
          `${String(dupes).padStart(10)}   ${String(cost).padStart(10)}   ` +
          `${String(offered.artefact + offered.real).padStart(6)} ` +
          `(${offered.artefact} artefact, ${offered.real} real)`
      );

      // The pruning rule, executable. An interval earns its place by removing
      // at least five artefacts for every real note it costs - the same 5:1
      // weighting `partialConfidenceRatio` was chosen under, applied to the
      // interval rather than to the threshold. +24 under the old clause scored
      // 0 against 4 and would fail here; under this one it scores 3 against 0.
      expect(artefacts).toBeGreaterThanOrEqual(5 * cost);
    }

    // ...and the two that have never fired. This is the distinction the whole
    // task turns on: +19 and +24 fire and are now right, so they stay on
    // evidence; +28 and +31 have never been offered a single pair, so they
    // stay on physics with nothing measured either way. A triangular pluck
    // rolls off as 1/k^2, which puts the 5th and 6th modes 28-34 dB down,
    // where this detector does not report them - so the silence is a property
    // of the synthesis, not a verdict on the intervals.
    //
    // A tripwire, not a target: if a re-capture ever produces such a pair,
    // this fails, and whoever sees it has real evidence to decide on for the
    // first time. Deleting the two on today's silence would be the same
    // mistake as pruning +24 would have been.
    for (const interval of [28, 31]) {
      const offered = opportunitiesAt(interval);
      log(
        `ACC  +${interval} has never fired: ${offered.artefact + offered.real} pairs in the whole ` +
          'fixture. Kept on physics, unmeasured - not kept on evidence.'
      );
      expect(offered.artefact + offered.real).toBe(0);
    }
  });

  it('shows the trade-off curve the shipped cut was read off', () => {
    // Artefacts removed against real notes destroyed, for every cut worth
    // considering. This is the curve, printed so the choice can be argued with
    // rather than taken on trust.
    //
    // The weighting is stated rather than derived: one destroyed real note
    // costs the same as **five** kept artefacts. A kept artefact renders as a
    // ghost note the reader deletes with one gesture, and it is *visible* - it
    // is there, wrong, and obvious. A destroyed note is absent: the reader has
    // to notice a hole in a line they may not know before they can re-enter
    // pitch, position and duration by hand, and the noticing is the part that
    // fails silently. Five is a judgement about that asymmetry, not a
    // measurement, so the curve is printed whole and the argmax at three other
    // weights beside it.
    const pairs = candidatePairs();
    const reals = pairs.filter(p => p.onRealNote);
    const fakes = pairs.filter(p => !p.onRealNote);

    log('');
    log('ACC confidence-ratio trade-off: suppress a partial when the ratio is below the cut');
    log('ACC   cut   artefacts removed   real notes destroyed');
    for (let cut = 0.45; cut <= 0.951; cut += 0.05) {
      log(
        `ACC  ${cut.toFixed(2)}      ${String(fakes.filter(p => p.confidenceRatio < cut).length).padStart(3)}/${fakes.length}` +
          `                 ${String(reals.filter(p => p.confidenceRatio < cut).length).padStart(2)}/${reals.length}`
      );
    }

    const netAt = (weight: number): { cut: number; net: number } => {
      let best = { cut: 0, net: -Infinity };
      for (const cut of pairs.map(p => p.confidenceRatio).sort((a, b) => a - b)) {
        const net =
          fakes.filter(p => p.confidenceRatio < cut).length -
          weight * reals.filter(p => p.confidenceRatio < cut).length;
        if (net > best.net) best = { cut, net };
      }

      return best;
    };

    for (const weight of [3, 5, 7, 10]) {
      const best = netAt(weight);
      log(`ACC  argmax at ${weight} artefacts per real note: cut ${best.cut.toFixed(3)}`);
    }

    // The chosen cut is not the argmax and is not meant to be. At weight 5 the
    // objective is flat to within two artefacts across [0.615, 0.670]; the
    // argmax sits 0.0001 below a real note in the data, which is fitting
    // rather than choosing. 0.65 is the point in that flat band with margin:
    // it falls in an empty 0.649-0.661 stretch, with the nearest real note
    // 0.020 above it. This asserts that margin, so a later re-capture that
    // moves a real note down onto the cut fails here rather than silently.
    const cut = DEFAULT_HARMONIC_OPTIONS.partialConfidenceRatio;
    const nearestRealAbove = Math.min(
      ...reals.filter(p => p.confidenceRatio >= cut).map(p => p.confidenceRatio)
    );
    log(
      `ACC  chosen cut ${cut}; nearest real note above it ` +
        `${nearestRealAbove.toFixed(4)}, margin ${(nearestRealAbove - cut).toFixed(4)}`
    );

    expect(nearestRealAbove - cut).toBeGreaterThan(0.015);
  });

  it('shows that length adds nothing on top of confidence, which is why it is gone', () => {
    // `partialDurationRatio` was removed rather than kept beside the new
    // clause, and that is a claim that has to be checkable. It is checked here:
    // over the same population, every combination of the two.
    //
    // AND collapses precision, because the artefacts confidence catches are
    // mostly *not* short. OR buys nothing until the length cut is loose enough
    // to start taking real notes with it. There is no setting at which the
    // second feature pays for the parameter it would cost.
    const pairs = candidatePairs();
    const reals = pairs.filter(p => p.onRealNote);
    const fakes = pairs.filter(p => !p.onRealNote);
    const conf = DEFAULT_HARMONIC_OPTIONS.partialConfidenceRatio;

    const alone = {
      dropped: fakes.filter(p => p.confidenceRatio < conf).length,
      cost: reals.filter(p => p.confidenceRatio < conf).length
    };

    log('');
    log(
      `ACC confidence < ${conf} alone: ${alone.dropped}/${fakes.length} artefacts, ` +
        `${alone.cost}/${reals.length} real notes`
    );

    let freeGain = 0;
    for (const length of [0.1, 0.2, 0.325, 0.5, 0.7, 0.9]) {
      const and = {
        dropped: fakes.filter(p => p.confidenceRatio < conf && p.spanRatio < length).length,
        cost: reals.filter(p => p.confidenceRatio < conf && p.spanRatio < length).length
      };
      const or = {
        dropped: fakes.filter(p => p.confidenceRatio < conf || p.spanRatio < length).length,
        cost: reals.filter(p => p.confidenceRatio < conf || p.spanRatio < length).length
      };
      log(
        `ACC  ...AND length < ${length}: ${String(and.dropped).padStart(3)}/${fakes.length}, ` +
          `${String(and.cost).padStart(2)}/${reals.length}` +
          `   ...OR length < ${length}: ${String(or.dropped).padStart(3)}/${fakes.length}, ` +
          `${String(or.cost).padStart(2)}/${reals.length}`
      );

      // AND can only ever remove a subset of what confidence removes alone.
      expect(and.dropped).toBeLessThanOrEqual(alone.dropped);
      // OR is the only way length could contribute, and it only contributes
      // for free while it costs no extra real note.
      if (or.cost === alone.cost) freeGain = Math.max(freeGain, or.dropped - alone.dropped);
    }

    // The whole measured contribution of a second, length-based clause, at
    // every setting that costs nothing: one artefact in ninety-two. That is
    // the evidence for deleting the parameter rather than leaving it at some
    // harmless-looking default.
    expect(freeGain).toBeLessThanOrEqual(1);
  });
});
