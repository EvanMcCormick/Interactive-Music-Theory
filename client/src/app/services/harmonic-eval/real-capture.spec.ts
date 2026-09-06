/**
 * The slow half of the **real**-material measurement: capture.
 *
 * `harmonic-capture.spec.ts` synthesises its audio, so it can run anywhere.
 * This one cannot: it decodes a recording, and the recording is the user's
 * file rather than the repository's. What it produces -
 * `real-detections.fixture.ts` - is derived data, and that *is* committed, so
 * `real-material-accuracy.spec.ts` scores it in milliseconds with no browser,
 * no model, no GPU and no audio.
 *
 * ## Running it
 *
 * Put a mono bass stem at `client/src/assets/real-capture/johnny-bass.mp3` -
 * any container `decodeAudioData` handles will do, the extension is only what
 * the URL below asks for - and:
 *
 *     npx ng test --configuration=real --watch=false
 *
 * Then paste the `REALCAP` chunks it prints into `real-detections.fixture.ts`,
 * concatenated in index order, and update the three `REALMETA` constants
 * beside them. `src/assets/real-capture/` is gitignored: the audio must not be
 * committed, and the fixture is what makes committing it unnecessary.
 *
 * ## Why it is excluded from the default suite
 *
 * Two reasons, either sufficient. The audio is not in the repository, so on
 * any other checkout this spec fails at the `fetch`. And it is a 161-window
 * inference run on the software rasteriser, about 80 s inside one `it`, well
 * past karma's 30 s `browserNoActivityTimeout` - the same reason
 * `harmonic-capture.spec.ts` is excluded, and it is reached the same way, by
 * an `exclude` glob on the `test` target in `angular.json` and a configuration
 * that swaps in `karma.capture.conf.js` and its raised budgets. Excluded
 * rather than renamed, so `tsc -p tsconfig.spec.json --noEmit` still
 * type-checks it every run.
 *
 * ## It also prints the synthetic ground truth
 *
 * `MATERIAL`'s notes are built by helper functions rather than written out, so
 * an offline analysis cannot read them from the file. Printing them here lets
 * a candidate rule be scored against both bodies of material outside a
 * browser, which is how the candidate table in
 * `real-material-accuracy.spec.ts` was arrived at before it was written down.
 */

import { decodeToMono } from '../audio-decode';
import { BasicPitchDetector } from '../basic-pitch-detector';
import { DETECTION_SAMPLE_RATE } from '../note-detector';
import { MATERIAL } from './material';

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

/** Four decimals: past the detector's own 11.6 ms frame by two orders. */
const round = (x: number): number => Math.round(x * 10000) / 10000;

/** Where to drop the recording. Gitignored; see the docblock. */
const AUDIO_URL = '/assets/real-capture/johnny-bass.mp3';

/** Notes per printed line: karma's socket carries ~1 MB, this is ~6 kB. */
const CHUNK = 200;

describe('real material capture', () => {
  it('detects a real bass stem and prints the frozen fixture', async () => {
    for (const material of MATERIAL) {
      log(`GT ${material.name} ${JSON.stringify(material.notes)}`);
    }

    const response = await fetch(AUDIO_URL);
    expect(response.ok).toBe(true);
    const bytes = await response.arrayBuffer();
    log(`REALMETA bytes ${bytes.byteLength}`);

    // The app's own decode path, not a shortcut: what the detector is given
    // here has to be what a user dropping this file into the review UI gives
    // it, or the fixture is measuring a different signal.
    const decoded = await decodeToMono(bytes, DETECTION_SAMPLE_RATE);
    log(
      `REALMETA samples ${decoded.audio.length} durationSec ${decoded.durationSec.toFixed(4)} ` +
        `sourceRate ${decoded.sourceSampleRate}`
    );
    expect(decoded.audio.length).toBeGreaterThan(0);

    const startedAt = performance.now();
    const result = await new BasicPitchDetector().detect(
      decoded.audio,
      DETECTION_SAMPLE_RATE,
      () => undefined
    );
    const elapsed = (performance.now() - startedAt) / 1000;

    // [onsetSec, pitch, durationSec, confidence] - the shape both fixtures
    // use. `bendCents` is dropped: suppression never reads it.
    const frozen = result.notes.map(note => [
      round(note.onsetSec),
      note.pitch,
      round(note.offsetSec - note.onsetSec),
      round(note.confidence)
    ]);

    log(`REALMETA notes ${frozen.length} inferenceSec ${elapsed.toFixed(1)}`);
    for (let at = 0; at < frozen.length; at += CHUNK) {
      log(`REALCAP ${at} ${JSON.stringify(frozen.slice(at, at + CHUNK))}`);
    }
    log('REALCAP END');

    expect(frozen.length).toBeGreaterThan(0);
  }, 900_000);
});
