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
 * losses are 22 notes. Pooling the two would let a change that destroys real
 * notes hide behind a detector that was never going to find them, so the table
 * carries them as separate columns (`miss` and `lost`) and the two listings
 * below name every note in each.
 *
 * ## What adding dynamics did to these numbers
 *
 * The first ten materials are played at one strength; the six after them are
 * not, and they were added because an amplitude discriminator cannot be
 * measured on material that has no dynamic range. Over the ten, the headline
 * was 55.6 / 57.4 / 56.5 with **12** real notes destroyed. Over the sixteen it
 * is 56.5 / 59.9 / 58.1 with **22**.
 *
 * The headline barely moved and that is misleading, so read the `lost` column
 * instead. Suppression makes three of the six new rows *worse* than the raw
 * detector: `quietOverLoud` 55.2 -> 42.1, `loudOverQuiet` 66.7 -> 60.0,
 * `ghosts` 35.7 -> 30.0. On `loudOverQuiet` it destroys three of the six notes
 * in the line. The proportion of detected notes that suppression destroys went
 * from 12 in 82 to 22 in 131 - 15 % against 17 %, so the rate is up as well as
 * the count, and it is up because the new material contains cases the old
 * material could not.
 *
 * The last spec below is where that shows most sharply. Over the ten, the best
 * amplitude cut cost 1 real note in 12; over the sixteen the same cut costs 5
 * in 28. Amplitude ratio still wins - it removes 68 of 92 artefacts where the
 * best length cut removes 41 - but it is not nearly the clean separator the
 * uniform-velocity material made it look.
 *
 * ## The assertions are a regression floor, not a target
 *
 * The raw-detector counts are asserted **exactly**: they are a property of the
 * frozen fixture and the frozen material, so if they move, one of those two
 * files was edited without the other being re-captured, and every number here
 * is describing a state that never existed.
 *
 * The suppressed numbers are asserted as **floors**. They are not good - 56.5 %
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
  referenceNotes: 182,
  rawDetections: 310,
  rawMatched: 131,
  /** Exact: a detector miss is decided before suppression ever runs. */
  detectorMisses: 51,
  /** Floors: 56.5 / 59.9 / 58.1 at 50 ms, 67.7 F1 at 75 ms. */
  keptPrecision: 0.564,
  keptRecall: 0.598,
  keptF1: 0.58,
  keptF1Wide: 0.676,
  /**
   * Ceiling: 22 real notes destroyed, up from 12 over the ten materials that
   * had no dynamics. Task 3's gate is to lower this.
   */
  realNotesDestroyed: 22
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
          amplitudeRatio: note.confidence / root.confidence,
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
          // Both ratios, on every casualty, whichever clause did the
          // killing. The duration one is what fired; the amplitude one is
          // what Task 3 is about to fire instead, and it can only be judged
          // on the notes the rule actually reaches.
          const why =
            root === undefined
              ? 'UNATTRIBUTED'
              : casualty.pitch === root.pitch
                ? `unison of ${root.pitch}@${root.onsetSec.toFixed(3)} ` +
                  `(amp ${(casualty.confidence / root.confidence).toFixed(2)}, ` +
                  `len ${(span(casualty) / span(root)).toFixed(2)})`
                : `+${casualty.pitch - root.pitch} under ${root.pitch}` +
                  `@${root.onsetSec.toFixed(3)} ` +
                  `(len ${(span(casualty) / span(root)).toFixed(2)} < ` +
                  `${DEFAULT_HARMONIC_OPTIONS.partialDurationRatio}, ` +
                  `amp ${(casualty.confidence / root.confidence).toFixed(2)})`;

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
      raw: totals(MATERIAL.map(m => score(m.notes, notesOf(m.name), toleranceSec))),
      kept: totals(
        MATERIAL.map(m => score(m.notes, suppressHarmonics(notesOf(m.name)), toleranceSec))
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

  it('shows that what the detector reports is not how hard the note was played', () => {
    // The reason six materials with dynamics were added is that Task 3 means
    // to discriminate partials by amplitude ratio, and a rule about amplitude
    // measured on material with one dynamic level is asserted rather than
    // measured. This is what the new material says back, and it is not what
    // was expected.
    //
    // `DetectedNote.confidence` is not amplitude. `basic-pitch-detector.ts`
    // says what it is - the *mean frame activation* over the note's span,
    // bounded below by the model's own 0.3 frame threshold by construction -
    // and across a 17.7 dB range of pluck strength it barely moves. On
    // `accents` the loud downbeat roots come back at 0.46 while the offbeat
    // octaves played at a third of their strength come back at 0.62: the
    // quiet notes score *higher*.
    //
    // That cuts both ways for Task 3, and both ways are worth stating.
    // Favourably: an amplitude-ratio cut is not going to be knocked over by
    // dynamics, because it cannot see them - which is why the best cut is
    // still 0.761 on this expanded set, exactly where it was on the uniform
    // one. Unfavourably: the justification for the rule cannot be that
    // partials start 8-35 dB below their fundamental and an amplitude ratio
    // measures that. It does not measure it. Whatever separating power the
    // ratio has comes from the model being less certain about a partial than
    // about a note, which is a different claim and has to be argued as one.
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
