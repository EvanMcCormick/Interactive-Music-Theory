import { decodeToMono } from '../audio-decode';
import { DETECTION_SAMPLE_RATE } from '../note-detector';

/* eslint-disable no-console */

/**
 * Prints an RMS envelope of the decoded stem, so the server's decoder can be
 * aligned against the browser's directly rather than through the notes.
 *
 * ## What it found
 *
 * `suppression-sensitivity.spec.ts` found the two tiers' onsets sitting two
 * frames apart for the first part of the file and together for the rest. Notes
 * are a lossy way to see that — quantised to frames, and only where something
 * was played — so this compares the audio instead, one bucket per model frame,
 * which is fine enough to see a 23 ms shift and coarse enough that the whole
 * file is 22,616 numbers rather than 23 MB of samples.
 *
 * Cross-correlated against the server's identical measurement, the answer was
 * unambiguous and is the reason this file exists:
 *
 * ```
 *   0-140s : best lag +2 frames (r 0.95-0.99, against r 0.79-0.88 at lag 0)
 * 140-260s : best lag  0 frames (r 0.99)
 * ```
 *
 * A clean step, not a drift. See
 * `docs/plans/2026-09-07-decoder-alignment.md`.
 *
 * Excluded from the default suite for the same reason `real-capture.spec.ts`
 * is: it needs the user's file, which is gitignored.
 *
 *     npx ng test --configuration=envelope --watch=false
 *
 * and the server's half with
 * `dotnet test --filter FullyQualifiedName~decode_envelope`, given
 * `ENVELOPE_DUMP` to write to.
 */
describe('decode envelope', () => {
  it('prints an RMS envelope of the real stem', async () => {
    const response = await fetch('/assets/real-capture/johnny-bass.mp3');
    expect(response.ok).toBe(true);

    const decoded = await decodeToMono(await response.arrayBuffer(), DETECTION_SAMPLE_RATE);
    console.log(`ENVMETA samples ${decoded.audio.length} durationSec ${decoded.durationSec}`);

    // One model frame per bucket, over the first 40 seconds. A 23 ms shift is
    // two buckets at this resolution and invisible at any coarser one; 40
    // seconds is enough to see it and small enough to print.
    const bucket = 256;
    const from = 0;
    const limit = decoded.audio.length;
    const envelope: number[] = [];

    for (let at = from; at + bucket <= limit; at += bucket) {
      let sum = 0;
      for (let i = at; i < at + bucket; i++) sum += decoded.audio[i] * decoded.audio[i];
      envelope.push(Math.round(Math.sqrt(sum / bucket) * 1e6) / 1e6);
    }

    console.log(`ENVMETA buckets ${envelope.length} bucketSamples ${bucket}`);
    for (let at = 0; at < envelope.length; at += 200) {
      console.log(`ENV ${at} ${JSON.stringify(envelope.slice(at, at + 200))}`);
    }
    console.log('ENV END');

    expect(envelope.length).toBeGreaterThan(0);
  }, 300_000);
});
