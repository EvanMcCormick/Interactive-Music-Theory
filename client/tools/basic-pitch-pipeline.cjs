/**
 * Runs a whole file through the library's own end-to-end path and freezes the
 * notes, so the C# detector can be held against it.
 *
 * ## Why this is the test that matters
 *
 * `basic-pitch-reference.cjs` pins the *model* — one window in, three
 * posteriorgrams out. This pins everything between a file and a note: the
 * framing, the batch loop, the two trims, the decoder, the bend pass and the
 * ordering. Those are where a port goes wrong quietly, because every one of
 * them is arithmetic that produces plausible output when it is slightly wrong.
 * A frame miscounted at the tail displaces the end of the file; an overlap
 * trimmed from the wrong end displaces all of it.
 *
 * It deliberately calls `BasicPitch.evaluateModel` rather than reproducing the
 * client's loop. That path frames with the library's own `prepareData`, which
 * the client replaces — so this checks the C# framing against the definition it
 * was ported from rather than against the port's sibling. The two are asserted
 * equal elementwise by `detection-framing.spec.ts`; this is the third corner of
 * that triangle.
 *
 * ## The audio
 *
 * Six seconds of plucked sawtooths walking up a chord, each with a decay
 * envelope built by repeated multiplication. Every constant is a decimal
 * literal and every operation is multiply, add or floor, so both runtimes
 * generate bit-identical samples and the repository carries a hash rather than
 * six seconds of audio. Sawtooths for their harmonic series, which is what
 * Basic Pitch is built to pick apart and what makes the harmonic partials the
 * suppressor exists for show up.
 *
 *     cd client && node tools/basic-pitch-pipeline.cjs [outDir]
 */

const fs = require('fs');
const path = require('path');

const tf = require('@tensorflow/tfjs');
const { BasicPitch } = require('@spotify/basic-pitch/cjs/inference.js');
const {
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  noteFramesToTime
} = require('@spotify/basic-pitch/cjs/toMidi.js');

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 6;
const SAMPLE_COUNT = SAMPLE_RATE * DURATION_SECONDS;

/**
 * Decimal literals, not `midiToHz`: `Math.pow` is not pinned to the last bit
 * across runtimes, and a frequency that differs in its last bit drifts in phase
 * over six seconds. These parse to the same double everywhere.
 *
 * E2 A2 C3 E3 G3 B3 - an E minor climb that keeps every fundamental inside a
 * bass's range, so the partials above them are unambiguous.
 */
const FREQUENCIES = [82.41, 110.0, 130.81, 164.81, 196.0, 246.94];

/** Samples per note. Six notes over six seconds. */
const NOTE_SAMPLES = SAMPLE_COUNT / FREQUENCIES.length;

const MODEL_DIR = path.join(
  __dirname,
  '..',
  'node_modules',
  '@spotify',
  'basic-pitch',
  'model'
);

const OUT_DIR = process.argv[2] || path.join(__dirname, 'basic-pitch-pipeline');

/** Loads a TF.js graph model from disk without `@tensorflow/tfjs-node`. */
function fileSystemHandler(dir) {
  return {
    load: async () => {
      const modelJson = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));

      const specs = [];
      const buffers = [];
      for (const group of modelJson.weightsManifest) {
        for (const file of group.paths) {
          buffers.push(fs.readFileSync(path.join(dir, file)));
        }
        specs.push(...group.weights);
      }

      const weights = Buffer.concat(buffers);

      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs: specs,
        weightData: weights.buffer.slice(
          weights.byteOffset,
          weights.byteOffset + weights.byteLength
        ),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        signature: modelJson.signature,
        userDefinedMetadata: modelJson.userDefinedMetadata
      };
    }
  };
}

/**
 * Mirrored by `BuildReferenceAudio` in `BasicPitchDetectorTests`.
 *
 * `phase - Math.floor(phase)` is exact for every double, and the envelope is a
 * repeated multiply, so this is reproducible to the bit.
 */
function buildAudio() {
  const samples = new Float32Array(SAMPLE_COUNT);

  for (let note = 0; note < FREQUENCIES.length; note++) {
    const frequency = FREQUENCIES[note];
    const start = note * NOTE_SAMPLES;
    let level = 0.6;

    for (let i = 0; i < NOTE_SAMPLES; i++) {
      const phase = (i * frequency) / SAMPLE_RATE;
      samples[start + i] = level * (2 * (phase - Math.floor(phase)) - 1);
      level = level * 0.99985;
    }
  }

  return samples;
}

/** FNV-1a over the little-endian float32 bit patterns. */
function hashFloat32(data) {
  const view = new DataView(new ArrayBuffer(4));
  let h = 0x811c9dc5 >>> 0;

  for (const value of data) {
    view.setFloat32(0, value, true);
    for (let i = 0; i < 4; i++) {
      h = (h ^ view.getUint8(i)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }

  return h >>> 0;
}

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();

  const model = tf.loadGraphModel(fileSystemHandler(MODEL_DIR));
  const basicPitch = new BasicPitch(model);

  const audio = buildAudio();

  const frames = [];
  const onsets = [];
  const contours = [];

  await basicPitch.evaluateModel(
    audio,
    (f, o, c) => {
      for (const row of f) frames.push(row);
      for (const row of o) onsets.push(row);
      for (const row of c) contours.push(row);
    },
    () => {}
  );

  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets))
  );

  notes.sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi
  );

  const centsPerBin = 100 / 3;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'pipeline.json'),
    JSON.stringify(
      {
        generatedBy: 'client/tools/basic-pitch-pipeline.cjs',
        tfjs: require('@tensorflow/tfjs/package.json').version,
        basicPitch: require('@spotify/basic-pitch/package.json').version,
        sampleRate: SAMPLE_RATE,
        sampleCount: SAMPLE_COUNT,
        frequencies: FREQUENCIES,
        inputHash: hashFloat32(audio),
        modelFrames: frames.length,
        bendFrameRateHz: SAMPLE_RATE / 256,
        notes: notes.map((note, i) => ({
          id: `bp-${i}`,
          pitch: note.pitchMidi,
          onsetSec: note.startTimeSeconds,
          offsetSec: note.startTimeSeconds + note.durationSeconds,
          confidence: note.amplitude,
          bendCents: (note.pitchBends || []).map(bins => bins * centsPerBin)
        }))
      },
      null,
      2
    )
  );

  console.log(`audio       ${SAMPLE_COUNT} samples, ${DURATION_SECONDS}s`);
  console.log(`model       ${frames.length} frames`);
  console.log(`decoded     ${notes.length} notes`);
  console.log(
    `pitches     ${[...new Set(notes.map(n => n.pitchMidi))].sort((a, b) => a - b).join(' ')}`
  );
  console.log(`\nwrote ${path.join(OUT_DIR, 'pipeline.json')}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
