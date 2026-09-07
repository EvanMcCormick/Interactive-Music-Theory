import { DetectedNote } from '../../models/transcription.model';
import {
  DEFAULT_HARMONIC_OPTIONS,
  HARMONIC_SEMITONES,
  NO_NOTE_DECISIONS,
  suppressHarmonics
} from '../transcription-harmonics';
import { REAL_DURATION_SEC, realDetections } from './real-detections.fixture';
import { serverDetections } from './server-detections.fixture';

/* eslint-disable no-console */

/**
 * Why harmonic suppression's decisions move between the two tiers - and why the
 * answer turned out not to be about suppression at all.
 *
 * `two-tier-equivalence.spec.ts` measured the symptom: 5 detections differ
 * between the tiers and 18 suppression decisions differ, an amplification of
 * 3.6. The obvious reading is that the decision is a hard `<` on a confidence
 * ratio and small perturbations flip it, so the obvious fix is a deadband. This
 * file was written to size that deadband and instead ruled it out.
 *
 * **The perturbation is too big to absorb.** The same note's confidence moves by
 * a p90 of 0.0155 between tiers. A band that wide swallows about 50 of the 402
 * judged pairs; a band narrow enough to be safe - 0.001 - covers 3. There is no
 * width that both helps and leaves the calibration alone.
 *
 * **And the offsets are bimodal, which is the real finding.** Matched notes sit
 * either exactly together or exactly two frames apart, in two consecutive
 * stretches of the file rather than interleaved. That is a decoder alignment
 * fault, not a threshold sensitivity: the server's decode runs 23.2 ms late for
 * the first 140 seconds and then catches up, because the MP3 encoder delay is
 * not being stripped and a frame goes missing mid-file.
 * `decode-envelope.spec.ts` confirms it on the audio rather than the notes, and
 * `docs/plans/2026-09-07-decoder-alignment.md` writes it up.
 *
 * Diagnostic. Nothing asserts a target; the numbers are the output.
 */
describe('harmonic suppression sensitivity', () => {
  const browser = realDetections();
  const server = serverDetections();

  it('counts how many decisions sit within a whisker of the threshold', () => {
    for (const [label, notes] of [
      ['browser', browser],
      ['server', server]
    ] as const) {
      const margins = partialMargins(notes);
      const total = margins.length;

      const within = (m: number): number =>
        margins.filter(margin => Math.abs(margin) < m).length;

      console.log(
        `${label}: ${total} partial-interval pairs judged on confidence; ` +
          `within 0.001: ${within(0.001)}, 0.005: ${within(0.005)}, ` +
          `0.01: ${within(0.01)}, 0.02: ${within(0.02)}, 0.05: ${within(0.05)}`
      );
    }

    expect(true).toBeTrue();
  });

  it('measures how much of the difference is the cascade', () => {
    const suppressedBrowser: DetectedNote[] = [];
    const suppressedServer: DetectedNote[] = [];

    suppressHarmonics(browser, {}, NO_NOTE_DECISIONS, true, suppressedBrowser);
    suppressHarmonics(server, {}, NO_NOTE_DECISIONS, true, suppressedServer);

    console.log(
      `removed: browser ${suppressedBrowser.length}, server ${suppressedServer.length} ` +
        `(${Math.abs(suppressedBrowser.length - suppressedServer.length)} apart, ` +
        `from ${Math.abs(browser.length - server.length)} differing detections)`
    );

    expect(true).toBeTrue();
  });

  /**
   * **The number that decides whether any threshold fix can work.**
   *
   * A deadband, hysteresis, quantisation — every one of them is a bet that the
   * perturbation is smaller than the band. So the perturbation has to be
   * measured before any of them is worth building.
   *
   * Notes are matched across the two fixtures on pitch and an onset within one
   * model frame, which is the finest distinction either tier can draw. What is
   * reported is how far the *same note* moved in confidence between them.
   */
  it('measures how far a note moves between the two tiers', () => {
    const matched: number[] = [];
    const onsetOffsets: number[] = [];
    const unmatchedBrowser: DetectedNote[] = [];

    const remaining = [...server];
    const frame = 1 / 86.1328125;

    for (const note of browser) {
      // Four frames, deliberately loose. A tight window cannot tell a note
      // that moved from a note that is missing, and telling those apart is the
      // whole question.
      const at = remaining.findIndex(
        candidate =>
          candidate.pitch === note.pitch &&
          Math.abs(candidate.onsetSec - note.onsetSec) <= frame * 4
      );

      if (at < 0) {
        unmatchedBrowser.push(note);
        continue;
      }

      matched.push(Math.abs(remaining[at].confidence - note.confidence));
      onsetOffsets.push(remaining[at].onsetSec - note.onsetSec);
      remaining.splice(at, 1);
    }

    // Signed, because a *bias* is a different problem from *scatter*: scatter is
    // two decoders disagreeing, and a bias is one of them starting the audio in
    // the wrong place.
    const meanOffset = onsetOffsets.reduce((sum, d) => sum + d, 0) / onsetOffsets.length;
    const inFrames = meanOffset / frame;
    const sortedOffsets = [...onsetOffsets].sort((a, b) => a - b);

    console.log(
      `onset offset (server - browser): mean ${(meanOffset * 1000).toFixed(3)} ms ` +
        `= ${inFrames.toFixed(3)} frames, median ` +
        `${(sortedOffsets[Math.floor(sortedOffsets.length / 2)] * 1000).toFixed(3)} ms`
    );

    const histogram = new Map<number, number>();
    for (const offset of onsetOffsets) {
      const bucket = Math.round(offset / frame);
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }
    console.log(
      'offset in whole frames: ' +
        [...histogram.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([bucket, count]) => `${bucket >= 0 ? '+' : ''}${bucket}: ${count}`)
          .join('  ')
    );

    // Where in the file each population sits. A bias that switches on partway
    // through is a different fault from one that is there from the first note:
    // the model runs over 2-second windows and `modelFrameToTime` subtracts a
    // correction per window crossed, so a per-window error would show up as the
    // offset climbing with time.
    const matchedPairs: { onsetSec: number; bucket: number }[] = [];
    {
      const rest = [...server];
      for (const note of browser) {
        const at = rest.findIndex(
          candidate =>
            candidate.pitch === note.pitch &&
            Math.abs(candidate.onsetSec - note.onsetSec) <= frame * 4
        );
        if (at < 0) continue;
        matchedPairs.push({
          onsetSec: note.onsetSec,
          bucket: Math.round((rest[at].onsetSec - note.onsetSec) / frame)
        });
        rest.splice(at, 1);
      }
    }

    const windowSec = 172 * frame;
    for (const decile of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const from = (REAL_DURATION_SEC * decile) / 10;
      const to = (REAL_DURATION_SEC * (decile + 1)) / 10;
      const inRange = matchedPairs.filter(p => p.onsetSec >= from && p.onsetSec < to);
      if (inRange.length === 0) continue;

      const mean = inRange.reduce((sum, p) => sum + p.bucket, 0) / inRange.length;
      console.log(
        `  ${from.toFixed(0)}-${to.toFixed(0)}s: ${inRange.length} notes, ` +
          `mean offset ${mean.toFixed(2)} frames`
      );
    }

    console.log(`(one model window is ${windowSec.toFixed(3)}s)`);

    matched.sort((a, b) => a - b);

    const at = (q: number): number => matched[Math.floor(matched.length * q)];
    const mean = matched.reduce((sum, d) => sum + d, 0) / matched.length;

    console.log(
      `matched ${matched.length} of ${browser.length} notes ` +
        `(${unmatchedBrowser.length} browser-only, ${remaining.length} server-only)`
    );
    console.log(
      `|delta confidence|: mean ${mean.toFixed(5)}, median ${at(0.5).toFixed(5)}, ` +
        `p90 ${at(0.9).toFixed(5)}, p99 ${at(0.99).toFixed(5)}, ` +
        `max ${matched[matched.length - 1].toFixed(5)}`
    );

    // The threshold band the perturbation would have to fit inside, against
    // how many pairs sit that close to the threshold in the first place.
    console.log(
      `a deadband would have to be wider than the perturbation it absorbs; ` +
        `p90 is ${at(0.9).toFixed(4)}`
    );

    expect(matched.length).toBeGreaterThan(1000);
  });

  /**
   * The decision margin for every pair the partial rule actually judges.
   *
   * Mirrors `explains`: same interval set, same overlap test, same
   * onset-ordering guard. It does not mirror the monophonic shortcut, because
   * that branch returns before the confidence comparison and so has no margin
   * to report — which is itself the point, and is why the real stem's
   * monophonic declaration matters so much.
   */
  function partialMargins(notes: DetectedNote[]): number[] {
    const options = DEFAULT_HARMONIC_OPTIONS;
    const byPitch = [...notes].sort(
      (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
    );

    const margins: number[] = [];

    for (let i = 0; i < byPitch.length; i++) {
      const note = byPitch[i];

      for (let j = 0; j < i; j++) {
        const root = byPitch[j];
        const interval = note.pitch - root.pitch;

        if (interval <= 0 || !HARMONIC_SEMITONES.includes(interval)) continue;

        const overlaps =
          note.onsetSec <= root.offsetSec + options.toleranceSec &&
          root.onsetSec <= note.offsetSec + options.toleranceSec;
        if (!overlaps) continue;

        if (note.onsetSec < root.onsetSec - options.toleranceSec) continue;

        // How far the comparison is from flipping.
        margins.push(note.confidence - root.confidence * options.partialConfidenceRatio);
      }
    }

    return margins;
  }
});
