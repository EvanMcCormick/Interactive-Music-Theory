/**
 * The slow half of the measurement: **capture**.
 *
 * Synthesises each material, runs the real `BasicPitchDetector` over it, and
 * prints the detector's output so it can be frozen into `detections.fixture.ts`.
 * `harmonic-accuracy.spec.ts` then scores that frozen output in milliseconds,
 * with no browser, no model and no GPU - which is the only reason the accuracy
 * measurement can live in the default suite at all.
 *
 * ## This spec is excluded from the default suite, deliberately
 *
 * Ten materials, each a model load and a WebGL inference run, all inside one
 * `it`. Karma's `browserNoActivityTimeout` is 30 s, and a browser that spends
 * longer than that in a single spec is indistinguishable from a dead one - so
 * including this in `npm test` ends the whole run at
 * `Executed 448 of 559 DISCONNECTED`, taking every later spec's result down
 * with it. It is excluded by an `exclude` glob on the `test` target in
 * `angular.json`, not by being renamed or commented out, so `tsc -p
 * tsconfig.spec.json --noEmit` still type-checks it on every run.
 *
 * Run it deliberately, when the material or the detector changes:
 *
 *     npm test -- --configuration=capture --watch=false
 *
 * That configuration selects this file and swaps in `karma.capture.conf.js`,
 * which is the ordinary config with a no-activity budget that matches the
 * jasmine timeout below. Then paste the `CAPTURE <name> [...]` lines it prints
 * into `detections.fixture.ts`.
 *
 * It also prints the scores it measures live, from the detector's real output
 * rather than the freeze. If those ever disagree with what
 * `harmonic-accuracy.spec.ts` reports, the freeze is stale or lossy - which is
 * the one failure mode a frozen fixture has, and the reason both halves print
 * the same table.
 */

import { BasicPitchDetector } from '../basic-pitch-detector';
import { DETECTION_SAMPLE_RATE } from '../note-detector';
import { suppressHarmonics } from '../transcription-harmonics';
import { MATERIAL, render } from './material';
import { pct, score, totals } from './note-matching';
import type { Scores } from './note-matching';

/** Four decimals: past the detector's own 11.6 ms frame by two orders. */
const round = (x: number): number => Math.round(x * 10000) / 10000;

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

describe('harmonic capture', () => {
  it('detects every material and prints the frozen fixture', async () => {
    const detector = new BasicPitchDetector();
    const rows: string[] = [];
    const raw: Scores[] = [];
    const kept: Scores[] = [];

    for (const material of MATERIAL) {
      const audio = render(material, DETECTION_SAMPLE_RATE);
      const result = await detector.detect(audio, DETECTION_SAMPLE_RATE, () => undefined);

      // [onsetSec, pitch, durationSec, amplitude] - the same shape the existing
      // fixture uses. `bendCents` is dropped: suppression never reads it.
      const frozen = result.notes.map(n => [
        round(n.onsetSec),
        n.pitch,
        round(n.offsetSec - n.onsetSec),
        round(n.confidence)
      ]);

      log(`CAPTURE ${material.name} ${JSON.stringify(frozen)}`);

      const before = score(material.notes, result.notes);
      const after = score(material.notes, suppressHarmonics(result.notes));
      raw.push(before);
      kept.push(after);
      rows.push(
        `LIVE ${material.name.padEnd(9)} ref ${String(before.reference).padStart(3)} ` +
          `raw ${String(before.estimate).padStart(3)} P${pct(before.precision)} ` +
          `R${pct(before.recall)} F${pct(before.f1)} | ` +
          `kept ${String(after.estimate).padStart(3)} P${pct(after.precision)} ` +
          `R${pct(after.recall)} F${pct(after.f1)}`
      );
    }

    const rawAll = totals(raw);
    const keptAll = totals(kept);
    rows.push(
      `LIVE ${'OVERALL'.padEnd(9)} ref ${String(rawAll.reference).padStart(3)} ` +
        `raw ${String(rawAll.estimate).padStart(3)} P${pct(rawAll.precision)} ` +
        `R${pct(rawAll.recall)} F${pct(rawAll.f1)} | ` +
        `kept ${String(keptAll.estimate).padStart(3)} P${pct(keptAll.precision)} ` +
        `R${pct(keptAll.recall)} F${pct(keptAll.f1)}`
    );

    for (const row of rows) log(row);

    expect(rawAll.matched).toBeGreaterThan(0);
  }, 600_000);
});
