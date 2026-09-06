/**
 * What suppression does to a **real** recording, and what the alternatives
 * would do.
 *
 * `harmonic-accuracy.spec.ts` scores the suppressor against a hand-written
 * ground truth, which exists only because the sixteen materials beside it are
 * synthesised from it. The stem frozen in `real-detections.fixture.ts` has no
 * such truth, so nothing here reports precision or recall.
 *
 * ## The one piece of ground truth a real file still gives you
 *
 * The source is a **monophonic bass stem**. One instrument, one string at a
 * time: it cannot sound two notes at once. So two detections sharing an attack
 * are wrong whatever was played, and two sharing an attack a harmonic interval
 * apart are a partial the suppressor missed. That is not a proxy for the
 * defect, it *is* the defect, and it is checkable without a transcription.
 *
 * Two numbers follow from it and both are reported below:
 *
 *  - **same-attack pairs**: detections whose onsets fall within 30 ms of each
 *    other. On this source the correct count is zero. The raw detector gives
 *    253; `suppressHarmonics` leaves 86.
 *  - **monophonic share**: the fraction of kept notes with nothing else
 *    sounding while they sound, allowing 10 ms of slack. Raw 41.6 %, kept
 *    66.4 %. This one is a *weaker* target than it looks - see the residual
 *    breakdown below - because a detector's note offsets run long, and a
 *    previous note still being reported as ringing under the next is a
 *    different defect from a doubled attack.
 *
 * ## What the tables here are for
 *
 * The suppressor's `partialConfidenceRatio` was calibrated on synthesis, and
 * one comparison says why that does not carry. `separates the two ratio
 * populations on synthesis and not on real material` below prints it:
 *
 * | population                         | min  |  q1  | med  |  q3  | max  |
 * |------------------------------------|------|------|------|------|------|
 * | synthetic artefacts, same attack   | 0.33 | 0.44 | 0.49 | 0.55 | 0.94 |
 * | synthetic real notes, same attack  | 0.96 | 1.07 | 2.46 | 2.48 | 2.55 |
 * | **real partials, same attack**     | 0.37 | 0.50 | 0.60 | 0.73 | 1.41 |
 *
 * On synthesis the two same-attack populations do not touch: 0.94 against
 * 0.96. Any cut in that gap is perfect, and 0.65 sits in it. Real material
 * fills the gap from below - 15 % of its partials sit above 0.81, which is the
 * first quartile of the synthetic real-note population. There is no longer a
 * gap to put a threshold in.
 *
 * The candidate table therefore measures each proposal twice: against the real
 * stem's monophony, and against the sixteen synthetic fixtures whose numbers
 * are already known. A candidate that fixes one and wrecks the other is not a
 * fix.
 *
 * ## Nothing here is wired into the shipped rule
 *
 * The candidates are local to this file, in the way `removal-attribution.ts`
 * keeps a local copy of `explains` for reporting. `matches the shipped
 * suppressor exactly at its own settings` is what stops that copy drifting:
 * run with the defaults it must reproduce `suppressHarmonics` note for note,
 * over all 1224 detections rather than over a contrived pair.
 *
 * ## Every count here is a floor, not a target
 *
 * The numbers below are pinned exactly - 253 raw pairs, 86 survivors, 67 of
 * them at a partial interval - and that is deliberate in both directions. A
 * count that rises is a regression and has to fail. A count that *falls* also
 * has to fail, because the only honest way to record an improvement is to
 * change the number here and say what moved it; a `toBeLessThan` would let the
 * measurement quietly stop describing the code. The right value for every one
 * of them is zero, and none of them is a target that has been met.
 *
 * ## Why these differ slightly from the browser run that found them
 *
 * The spike that produced this file quoted 89 same-attack pairs and a 66.2 %
 * monophonic share; this file says 86 and 66.4 %. Nothing about the rule
 * changed between the two, and the difference is not a rounding artefact
 * either - the fixture rounds to four decimals, and `puts the same-attack
 * window where the detector's own frame grid puts it` below shows every lag
 * sitting on an 11.6 ms grid point with the nearest one 4.8 ms clear of the
 * boundary, which four decimals cannot move anything across.
 *
 * What differs is the detection. The browser figures were read off a live
 * inference session and these come from one frozen run of it, and Basic Pitch
 * through TF.js does not return bit-identical activations across runs: the
 * WebGL path's reduction order and the rasteriser it lands on both vary, and a
 * note whose mean activation sits near the 0.3 frame threshold can appear in
 * one run and not the next. Three detections' worth of that is what separates
 * the two counts.
 *
 * The fixture's numbers are the ones this file asserts and the ones to quote
 * anywhere else, because they are the ones that can be reproduced: this spec
 * is deterministic and runs in milliseconds, and the session that produced the
 * others is gone and cannot be re-entered. That is the whole argument for
 * freezing a capture rather than re-running one.
 */

import { DetectedNote } from '../../models/transcription.model';
import { FFT_HOP } from '../detection-framing';
import { DETECTION_SAMPLE_RATE } from '../note-detector';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HARMONIC_SEMITONES,
  suppressHarmonics
} from '../transcription-harmonics';
import { MATERIAL } from './material';
import { detectionsOf } from './detections.fixture';
import { score, totals } from './note-matching';
import { REAL_DETECTIONS, REAL_SAMPLE_COUNT, realDetections } from './real-detections.fixture';

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

/**
 * Onsets this close are one attack. Two of the detector's own 11.6 ms frames.
 *
 * Not a round number chosen for looking like one: `puts the same-attack window
 * where the detector's own frame grid puts it` measures where it could go. The
 * detector places every onset on an 11.6 ms grid, so a lag can only be 0,
 * 11.6, 23.2, 34.8 ms and so on, and the window has nothing to gain by sitting
 * anywhere but between two of those. 30 ms is between the third and the
 * fourth, with 6.8 ms of margin below and 4.8 ms above.
 */
const SAME_ATTACK_SEC = 0.03;

/** Slack when asking whether two notes sound at once. */
const OVERLAP_SLACK_SEC = 0.01;

/** A rule the measurement can vary, standing in for `explains`. */
interface Candidate {
  name: string;
  /** Ratio the partial branch compares against, given the root. */
  ratioFor?: (root: DetectedNote) => number;
  /** Suppress a same-attack harmonic pair outright, on a monophonic source. */
  monoWindowSec?: number;
  /** Partial intervals to consider. Defaults to `HARMONIC_SEMITONES`. */
  intervals?: readonly number[];
}

/** `explains`, reproduced so a candidate can vary it. See the docblock. */
function explains(root: DetectedNote, note: DetectedNote, candidate: Candidate): boolean {
  const o = DEFAULT_HARMONIC_OPTIONS;
  const interval = note.pitch - root.pitch;
  if (!(candidate.intervals ?? HARMONIC_SEMITONES).includes(interval)) return false;
  if (note.onsetSec > root.offsetSec + o.toleranceSec) return false;
  if (root.onsetSec > note.offsetSec + o.toleranceSec) return false;

  if (interval > 0) {
    if (note.onsetSec < root.onsetSec - o.toleranceSec) return false;
    if (
      candidate.monoWindowSec !== undefined &&
      Math.abs(note.onsetSec - root.onsetSec) <= candidate.monoWindowSec
    ) {
      return true;
    }
    const ratio = candidate.ratioFor?.(root) ?? o.partialConfidenceRatio;

    return note.confidence < root.confidence * ratio;
  }

  return (
    note.confidence < root.confidence * o.unisonConfidenceRatio &&
    note.offsetSec - note.onsetSec < (root.offsetSec - root.onsetSec) * o.unisonDurationRatio
  );
}

/** `suppressHarmonics`'s greedy walk, with the rule swapped out. */
function keepUnder(notes: DetectedNote[], candidate: Candidate): DetectedNote[] {
  const byPitch = [...notes].sort(
    (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
  );
  const kept: DetectedNote[] = [];
  for (const note of byPitch) {
    if (!kept.some(root => explains(root, note, candidate))) kept.push(note);
  }

  return kept.sort((a, b) => a.onsetSec - b.onsetSec || a.pitch - b.pitch);
}

interface Pair {
  low: DetectedNote;
  high: DetectedNote;
  interval: number;
  ratio: number;
}

/** Every pair of notes struck together, lower pitch first. */
function sameAttackPairs(notes: DetectedNote[]): Pair[] {
  const byOnset = [...notes].sort((a, b) => a.onsetSec - b.onsetSec);
  const pairs: Pair[] = [];
  for (let i = 0; i < byOnset.length; i++) {
    for (let j = i + 1; j < byOnset.length; j++) {
      if (byOnset[j].onsetSec - byOnset[i].onsetSec > SAME_ATTACK_SEC) break;
      const [low, high] =
        byOnset[i].pitch <= byOnset[j].pitch
          ? [byOnset[i], byOnset[j]]
          : [byOnset[j], byOnset[i]];
      pairs.push({
        low,
        high,
        interval: high.pitch - low.pitch,
        ratio: high.confidence / low.confidence
      });
    }
  }

  return pairs;
}

/** Share of `notes` with nothing else sounding while they sound. */
function monophonicShare(notes: DetectedNote[]): number {
  const alone = notes.filter(
    a =>
      !notes.some(
        b =>
          b !== a &&
          a.onsetSec < b.offsetSec - OVERLAP_SLACK_SEC &&
          b.onsetSec < a.offsetSec - OVERLAP_SLACK_SEC
      )
  );

  return notes.length ? alone.length / notes.length : 0;
}

const known = (interval: number): boolean => HARMONIC_SEMITONES.includes(interval);
const nearMiss = (interval: number): boolean =>
  !known(interval) && HARMONIC_SEMITONES.some(x => Math.abs(x - interval) === 1);

const pct = (x: number): string => (x * 100).toFixed(1).padStart(5);
const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

interface Cost {
  precision: number;
  recall: number;
  f1: number;
  kept: number;
  destroyed: number;
}

/** The sixteen synthetic fixtures, scored under a candidate rule. */
function syntheticCost(candidate: Candidate): Cost {
  const scores = [];
  let destroyed = 0;
  for (const material of MATERIAL) {
    const detections = detectionsOf(material.name);
    const before = score(material.notes, detections);
    const after = score(material.notes, keepUnder(detections, candidate));
    scores.push(after);
    material.notes.forEach((_, index) => {
      if (before.matchOf[index] !== -1 && after.matchOf[index] === -1) destroyed++;
    });
  }
  const all = totals(scores);

  return {
    precision: all.precision,
    recall: all.recall,
    f1: all.f1,
    kept: all.estimate,
    destroyed
  };
}

const CURRENT: Candidate = { name: 'current, ratio 0.65' };

describe('harmonic suppression on real material', () => {
  const raw = realDetections();
  const kept = suppressHarmonics(raw);

  it('carries the capture the measurement is made from', () => {
    expect(REAL_DETECTIONS.length).toBe(1224);
    expect(REAL_SAMPLE_COUNT).toBe(5789696);
    expect(raw.every(note => note.offsetSec > note.onsetSec)).toBe(true);
    expect(kept.length).toBe(986);
  });

  it('matches the shipped suppressor exactly at its own settings', () => {
    // The local `explains` above is a copy, and copies rot. This is what stops
    // it: at the defaults it must reproduce `suppressHarmonics` note for note,
    // on 1224 real detections rather than on a contrived pair.
    const mine = keepUnder(raw, CURRENT);
    expect(mine.length).toBe(kept.length);
    expect(mine.map(note => note.id)).toEqual(kept.map(note => note.id));
  });

  it('leaves a monophonic stem sounding two notes at once', () => {
    const before = sameAttackPairs(raw);
    const after = sameAttackPairs(kept);

    log('');
    log('REAL  same-attack pairs on a source that can only play one note at a time');
    log(`REAL    raw  ${before.length} pairs of ${raw.length} detections`);
    log(`REAL    kept ${after.length} pairs of ${kept.length} detections`);
    log(
      `REAL    monophonic share  raw ${pct(monophonicShare(raw))} %  ` +
        `kept ${pct(monophonicShare(kept))} %`
    );

    // The defect, stated as the count it should be.
    expect(before.length).toBe(253);
    expect(after.length).toBe(86);
  });

  it('leaves them at intervals it knows, not at intervals it does not', () => {
    const after = sameAttackPairs(kept);
    const counts = new Map<number, number>();
    for (const pair of after) counts.set(pair.interval, (counts.get(pair.interval) ?? 0) + 1);

    log('');
    log('REAL  surviving same-attack pairs by interval');
    for (const interval of [...counts.keys()].sort((a, b) => a - b)) {
      const tag = known(interval)
        ? 'a partial interval'
        : nearMiss(interval)
          ? '+-1 of one'
          : 'neither';
      log(`REAL    +${String(interval).padStart(2)}  ${String(counts.get(interval)).padStart(3)}  ${tag}`);
    }

    const atKnown = after.filter(pair => known(pair.interval));
    const atNearMiss = after.filter(pair => nearMiss(pair.interval));
    log(
      `REAL    at a partial interval ${atKnown.length}, +-1 off one ${atNearMiss.length}, ` +
        `neither ${after.length - atKnown.length - atNearMiss.length}`
    );

    // 67 of the 86 survive at intervals the rule already considers, so they
    // are not a coverage gap in HARMONIC_SEMITONES.
    expect(atKnown.length).toBe(67);

    // And inharmonicity is not what is being missed. A real string's partials
    // run sharp, but not by the half semitone it would take to move one to a
    // neighbouring MIDI pitch: across all 253 raw same-attack pairs exactly
    // one sits +-1 from a partial interval, and none survives suppression.
    expect(atNearMiss.length).toBe(0);
    expect(sameAttackPairs(raw).filter(pair => nearMiss(pair.interval)).length).toBe(1);
  });

  it("puts the same-attack window where the detector's own frame grid puts it", () => {
    // Where 30 ms comes from, so that nobody rounds it off later.
    //
    // Basic Pitch reports on frames of 256 samples at 22.05 kHz - 11.61 ms,
    // `BEND_FRAME_RATE_HZ`'s reciprocal - so the lag between two detections is
    // quantised, and the same-attack window is not a continuous choice at all.
    // It selects a number of frames, and every value between two grid points
    // names the same rule.
    const FRAME_SEC = FFT_HOP / DETECTION_SAMPLE_RATE;
    const lags = new Set<string>();
    const byOnset = [...raw].sort((a, b) => a.onsetSec - b.onsetSec);
    for (let i = 0; i < byOnset.length; i++) {
      for (let j = i + 1; j < byOnset.length; j++) {
        const lag = byOnset[j].onsetSec - byOnset[i].onsetSec;
        if (lag > 0.05) break;
        lags.add(lag.toFixed(4));
      }
    }
    const seconds = [...lags].map(Number).sort((a, b) => a - b);

    log('');
    log(
      `GRID  onset lags under 50 ms, in frames of ${(FRAME_SEC * 1000).toFixed(2)} ms: ` +
        seconds.map(lag => `${lag.toFixed(4)} (${(lag / FRAME_SEC).toFixed(2)})`).join(' ')
    );

    // Whole frames, with one departure: a 1.3 ms step that turns up as 0.11
    // and 3.11 frames rather than 0 and 3. That is not jitter, it is the
    // overlap correction the library's `modelFrameToTime` applies once per
    // two-second model window - see `BasicPitchDetector.infer` - so it appears
    // at window boundaries and nowhere else. Tolerated at a fifth of a frame
    // and no more, which is far tighter than the gap being measured.
    for (const lag of seconds) {
      const frames = lag / FRAME_SEC;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(0.2);
    }

    // Three grid points at or under 30 ms and the next one clear of it, and
    // the window has 6.8 ms of margin below and 4.8 ms above. One frame - a
    // 20 ms window - leaves every pair exactly two frames apart, and there are
    // 16 of those; two frames takes them. So anything from about 24 ms to
    // 34 ms is this same rule, which is why 30 ms is a frame count rather than
    // a threshold anyone should try to tune.
    const under = seconds.filter(lag => lag <= SAME_ATTACK_SEC);
    const over = seconds.filter(lag => lag > SAME_ATTACK_SEC);
    expect(Math.max(...under)).toBeLessThan(SAME_ATTACK_SEC - 0.005);
    expect(Math.min(...over)).toBeGreaterThan(SAME_ATTACK_SEC + 0.004);

    // Counted in frames rather than in distinct values, because four decimals
    // renders one frame as both 0.0116 and 0.0117.
    expect(new Set(under.map(lag => Math.round(lag / FRAME_SEC))).size).toBe(3);
  });

  it('survives on the confidence clause and on nothing else', () => {
    const survivors = sameAttackPairs(kept).filter(
      pair => known(pair.interval) && pair.interval > 0
    );
    const onRatio = survivors.filter(
      pair => pair.ratio >= DEFAULT_HARMONIC_OPTIONS.partialConfidenceRatio
    );
    const ratios = survivors.map(pair => pair.ratio);

    log('');
    log(
      `REAL  ${survivors.length} known-interval survivors, ` +
        `${onRatio.length} of them because confidence >= 0.65 x the root's`
    );
    log(
      `REAL    ratios ${Math.min(...ratios).toFixed(3)} .. ${Math.max(...ratios).toFixed(3)}  ` +
        `median ${median(ratios).toFixed(3)}`
    );

    // Every one. Not the onset guard, not the overlap window, not a missing
    // interval: one clause decides all 67, which is what makes this one defect
    // rather than several.
    expect(onRatio.length).toBe(survivors.length);
  });

  it('does not make the detector less sure of a partial when the root is low', () => {
    // The register hypothesis: on a real bass a 41 Hz fundamental is weaker in
    // the recording than its own second harmonic, so confidence(partial) /
    // confidence(root) should climb as the root falls, and a fixed 0.65 would
    // be systematically wrong down there.
    //
    // Half of it is true. The model *is* less sure in the low register:
    // measured over all 1224 detections, mean confidence runs 0.403 at MIDI 27
    // and 0.613 at MIDI 39. But it is less sure of the partials too, by about
    // as much, and the ratio is what the rule reads.
    const octaves = sameAttackPairs(raw).filter(pair => pair.interval === 12);
    const byRoot = new Map<number, number[]>();
    for (const pair of octaves) {
      const at = byRoot.get(pair.low.pitch) ?? [];
      at.push(pair.ratio);
      byRoot.set(pair.low.pitch, at);
    }

    log('');
    log('REAL  ratio of a 2f0 partial to its own root, by root pitch (+12 only)');
    for (const pitch of [...byRoot.keys()].sort((a, b) => a - b)) {
      const at = byRoot.get(pitch) as number[];
      if (at.length < 3) continue;
      log(
        `REAL    MIDI ${String(pitch).padStart(2)}  n ${String(at.length).padStart(3)}  ` +
          `median ${median(at).toFixed(3)}  ` +
          `under 0.65 ${pct(at.filter(x => x < 0.65).length / at.length)} %`
      );
    }

    const meanPitch = octaves.reduce((sum, pair) => sum + pair.low.pitch, 0) / octaves.length;
    const meanRatio = octaves.reduce((sum, pair) => sum + pair.ratio, 0) / octaves.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const pair of octaves) {
      const dx = pair.low.pitch - meanPitch;
      const dy = pair.ratio - meanRatio;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const r = sxy / Math.sqrt(sxx * syy);
    log(
      `REAL    fit over ${octaves.length} octave pairs: ` +
        `${(sxy / sxx).toFixed(4)} per semitone, r = ${r.toFixed(3)}`
    );

    // Flat, and if anything sloping the wrong way. A register-scaled threshold
    // has nothing here to be fitted to.
    expect(Math.abs(r)).toBeLessThan(0.2);
  });

  it('separates the two ratio populations on synthesis and not on real material', () => {
    // Why 0.65 works on the fixtures and not here, in one comparison.
    const band = (xs: number[]): string => {
      const sorted = [...xs].sort((a, b) => a - b);
      const q = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

      return (
        `n ${String(sorted.length).padStart(3)}  min ${sorted[0].toFixed(2)}  ` +
        `q1 ${q(0.25).toFixed(2)}  med ${q(0.5).toFixed(2)}  q3 ${q(0.75).toFixed(2)}  ` +
        `max ${sorted[sorted.length - 1].toFixed(2)}`
      );
    };

    const artefacts: number[] = [];
    const realNotes: number[] = [];
    for (const material of MATERIAL) {
      const detections = detectionsOf(material.name);
      const played = (note: DetectedNote): boolean =>
        material.notes.some(
          g => g.pitch === note.pitch && Math.abs(g.onsetSec - note.onsetSec) <= 0.05
        );
      for (const pair of sameAttackPairs(detections)) {
        if (!known(pair.interval) || pair.interval === 0) continue;
        (played(pair.high) ? realNotes : artefacts).push(pair.ratio);
      }
    }
    const partials = sameAttackPairs(raw)
      .filter(pair => known(pair.interval) && pair.interval > 0)
      .map(pair => pair.ratio);

    log('');
    log(`SPLIT synthetic artefacts   ${band(artefacts)}`);
    log(`SPLIT synthetic real notes  ${band(realNotes)}`);
    log(`SPLIT real partials         ${band(partials)}`);

    // The gap the default was chosen from, and the fact that real material
    // fills it. Every synthetic artefact sits below every synthetic real note;
    // the real stem's partials run straight through them both.
    expect(Math.max(...artefacts)).toBeLessThan(Math.min(...realNotes));
    expect(Math.max(...partials)).toBeGreaterThan(Math.min(...realNotes));
  });

  it('measures every candidate against both, because a fix has to pass both', () => {
    const ramp =
      (high: number, slope: number, floor: number) =>
      (root: DetectedNote): number =>
        Math.max(floor, Math.min(high, high - slope * (root.pitch - 27)));
    const widened = [
      ...new Set(
        HARMONIC_SEMITONES.flatMap(iv => [iv - 1, iv, iv + 1]).filter(iv => iv >= 0)
      )
    ];

    const candidates: Candidate[] = [
      CURRENT,
      { name: 'flat ratio 1.20', ratioFor: () => 1.2 },
      { name: 'register ramp 1.2, -0.03/st', ratioFor: ramp(1.2, 0.03, 0.65) },
      { name: 'register ramp 1.0, -0.02/st', ratioFor: ramp(1.0, 0.02, 0.65) },
      { name: 'interval tolerance +-1', intervals: widened },
      { name: 'monophony prior, 20 ms', monoWindowSec: 0.02 },
      { name: 'monophony prior, 30 ms', monoWindowSec: 0.03 }
    ];

    log('');
    log('CAND  candidate                    | kept  pairs  known   mono% |     P     R    F1  lost');
    const results = candidates.map(candidate => {
      const survivors = keepUnder(raw, candidate);
      const pairs = sameAttackPairs(survivors);
      const cost = syntheticCost(candidate);
      log(
        `CAND  ${candidate.name.padEnd(28)} | ${String(survivors.length).padStart(4)} ` +
          `${String(pairs.length).padStart(6)} ` +
          `${String(pairs.filter(pair => known(pair.interval)).length).padStart(6)}  ` +
          `${pct(monophonicShare(survivors))} | ${pct(cost.precision)} ${pct(cost.recall)} ` +
          `${pct(cost.f1)} ${String(cost.destroyed).padStart(5)}`
      );

      return { candidate, pairs, cost };
    });

    const at = (name: string): (typeof results)[number] =>
      results.find(result => result.candidate.name === name) as (typeof results)[number];
    const knownPairs = (name: string): number =>
      at(name).pairs.filter(pair => known(pair.interval)).length;

    // The monophony prior is the only candidate that reaches zero doubled
    // pairs at a partial interval, and it is the cheapest of the three on
    // synthesis - even measured, as here, applied blanketly to sixteen
    // fixtures of which fourteen are polyphonic and would never be given it.
    expect(knownPairs('monophony prior, 30 ms')).toBe(0);
    expect(at('monophony prior, 30 ms').cost.destroyed).toBe(7);

    // A register-scaled threshold cannot get there, and costs far more getting
    // nowhere near: nineteen real notes destroyed against three.
    expect(knownPairs('register ramp 1.2, -0.03/st')).toBeGreaterThan(0);
    expect(at('register ramp 1.2, -0.03/st').cost.destroyed).toBe(19);

    // Interval tolerance is free and does almost nothing: five fewer notes on
    // the real stem, and the synthetic numbers do not move at all.
    expect(at('interval tolerance +-1').cost.destroyed).toBe(at(CURRENT.name).cost.destroyed);
    expect(at('interval tolerance +-1').cost.f1).toBeCloseTo(at(CURRENT.name).cost.f1, 6);
  });

  it('would still leave a monophonic stem overlapping, for a different reason', () => {
    // The monophony prior takes the doubled attacks and stops there. What is
    // left is not doubling: it is the detector's note offsets running past the
    // next onset, which no rule about partials addresses.
    const survivors = keepUnder(raw, { name: 'mono 30 ms', monoWindowSec: 0.03 });
    let sameAttack = 0;
    let staggered = 0;
    let staggeredHarmonic = 0;
    for (let i = 0; i < survivors.length; i++) {
      for (let j = i + 1; j < survivors.length; j++) {
        const a = survivors[i];
        const b = survivors[j];
        if (a.onsetSec >= b.offsetSec - OVERLAP_SLACK_SEC) continue;
        if (b.onsetSec >= a.offsetSec - OVERLAP_SLACK_SEC) continue;
        if (Math.abs(a.onsetSec - b.onsetSec) <= SAME_ATTACK_SEC) sameAttack++;
        else {
          staggered++;
          if (known(Math.abs(a.pitch - b.pitch))) staggeredHarmonic++;
        }
      }
    }

    log('');
    log(`TAIL  overlapping pairs left under the monophony prior: ${sameAttack + staggered}`);
    log(`TAIL    same attack ${sameAttack}`);
    log(`TAIL    staggered   ${staggered}, of which ${staggeredHarmonic} at a partial interval`);
    log(`TAIL  monophonic share ${pct(monophonicShare(survivors))} %, not 100 %`);

    // Most of what is left is staggered, so the same-attack argument - the one
    // solid piece of ground truth this file has - says nothing about it.
    expect(staggered).toBeGreaterThan(sameAttack * 5);
  });
});
