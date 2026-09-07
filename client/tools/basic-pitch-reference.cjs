/**
 * Runs one window of audio through the TF.js Basic Pitch graph and freezes all
 * three outputs, so the .NET side can be held against the runtime the browser
 * actually uses.
 *
 * ## What this is for
 *
 * The server runs Basic Pitch through `Microsoft.ML.OnnxRuntime` on
 * `nmp.onnx`, which is Spotify's own `tf2onnx` export rather than anything
 * converted here. That it is theirs is reassuring and is not evidence: it is a
 * different serialisation, run by a different runtime, and the two tiers have
 * to agree about notes. This is what checks that they do at the layer where
 * disagreement would start.
 *
 * Measured when it was first run: every output matches to **4.5e-7**, which is
 * float32 rounding, while every *wrong* pairing of the two same-shaped outputs
 * differs by 0.745. That second number is the useful one — it is what makes
 * the frames/onsets mapping a measurement rather than a reading of the names.
 *
 * ## What the input is
 *
 * Two sawtooths a fifth apart, the second entering a third of the way in so
 * the onset head has an attack to find, plus a little noise. Sawtooths because
 * they are exact in double arithmetic — no `sin`, whose last bit is not pinned
 * across runtimes — so the C# side regenerates the identical 43,844 samples
 * rather than the repository carrying them, and because their harmonic series
 * is what Basic Pitch is built to pick apart, so the outputs are strongly
 * activated rather than a field of near-zeros where any two implementations
 * agree trivially.
 *
 * `summary.json` carries an FNV hash of those samples. The C# side asserts it
 * before comparing an output, so a regenerated input that has drifted fails as
 * itself rather than as a wrong model.
 *
 *     cd client && node tools/basic-pitch-reference.cjs
 *
 * Writes to the path given as the first argument, or to a `basic-pitch-ref`
 * directory beside this file. Pass `--with-input` to dump the samples too,
 * which is for debugging a hash mismatch and is not committed.
 */

const fs = require('fs');
const path = require('path');

const tf = require('@tensorflow/tfjs');

/** Matches AUDIO_N_SAMPLES: 22050 * 2 - 256. */
const AUDIO_N_SAMPLES = 43844;
const SAMPLE_RATE = 22050;

/** The library's own output names. `Identity` is the 264-bin contour. */
const OUTPUTS = { contours: 'Identity', frames: 'Identity_1', onsets: 'Identity_2' };

const MODEL_DIR = path.join(
  __dirname,
  '..',
  'node_modules',
  '@spotify',
  'basic-pitch',
  'model'
);

const OUT_DIR = process.argv[2] || path.join(__dirname, 'basic-pitch-ref');

/**
 * Loads a TF.js graph model from disk without `@tensorflow/tfjs-node`, which
 * is not a dependency of this project and would be a heavy one to add for a
 * script that runs by hand.
 */
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

/** xorshift32, matching the other tools in this directory. */
function makeRandom(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 0x9e3779b9;

  return () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x / 4294967296;
  };
}

/**
 * A sawtooth, by exact arithmetic. `phase - Math.floor(phase)` is exact for
 * every double, so this produces bit-identical samples anywhere.
 */
function sawtooth(sampleIndex, frequency, amplitude) {
  const phase = (sampleIndex * frequency) / SAMPLE_RATE;
  return amplitude * (2 * (phase - Math.floor(phase)) - 1);
}

function buildInput() {
  const random = makeRandom(20260907);
  const samples = new Float32Array(AUDIO_N_SAMPLES);

  for (let i = 0; i < AUDIO_N_SAMPLES; i++) {
    // A2 and its fifth, both well inside a bass's range, with the second
    // entering a third of the way in so that the onset head has an attack to
    // find rather than one steady tone.
    let value = sawtooth(i, 110, 0.35);
    if (i > AUDIO_N_SAMPLES / 3) {
      value += sawtooth(i - Math.floor(AUDIO_N_SAMPLES / 3), 164.8, 0.25);
    }

    samples[i] = value + (random() - 0.5) * 0.02;
  }

  return samples;
}

function writeFloats(file, data) {
  const buffer = Buffer.alloc(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    buffer.writeFloatLE(data[i], i * 4);
  }
  fs.writeFileSync(file, buffer);
  return buffer.length;
}

/**
 * FNV-1a over the float32 bit patterns, little-endian — the layout both sides
 * already have the samples in.
 */
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

  const model = await tf.loadGraphModel(fileSystemHandler(MODEL_DIR));
  const samples = buildInput();

  const input = tf.tensor3d(Array.from(samples), [1, AUDIO_N_SAMPLES, 1]);
  const results = model.execute(input, [
    OUTPUTS.contours,
    OUTPUTS.frames,
    OUTPUTS.onsets
  ]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (process.argv.includes('--with-input')) {
    writeFloats(path.join(OUT_DIR, 'input.f32'), samples);
  }

  const named = ['contours', 'frames', 'onsets'];
  const summary = {};

  results.forEach((tensor, i) => {
    const name = named[i];
    const flat = tensor.dataSync();
    const shape = tensor.shape;

    writeFloats(path.join(OUT_DIR, `${name}.f32`), flat);

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of flat) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    summary[name] = { shape, count: flat.length, min, max, mean: sum / flat.length };
    console.log(
      `${name.padEnd(9)} shape [${shape}]  min ${min.toFixed(6)}  ` +
        `max ${max.toFixed(6)}  mean ${(sum / flat.length).toFixed(6)}`
    );
  });

  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(
      {
        generatedBy: 'client/tools/basic-pitch-reference.cjs',
        tfjs: require('@tensorflow/tfjs/package.json').version,
        basicPitch: require('@spotify/basic-pitch/package.json').version,
        sampleRate: SAMPLE_RATE,
        audioNSamples: AUDIO_N_SAMPLES,
        inputHash: hashFloat32(samples),

        // The library's own output names, and the ONNX outputs they were
        // measured to correspond to. Recorded rather than inferred from the
        // `:N` suffixes: two of the three are the same shape, so a swap would
        // be silent, and the comparison that established this showed 4.5e-7
        // for the right pairing against 0.745 for the wrong one.
        outputs: {
          contours: { tfjs: 'Identity', onnx: 'StatefulPartitionedCall:0' },
          frames: { tfjs: 'Identity_1', onnx: 'StatefulPartitionedCall:1' },
          onsets: { tfjs: 'Identity_2', onnx: 'StatefulPartitionedCall:2' }
        },
        summary
      },
      null,
      2
    )
  );

  for (const tensor of results) tensor.dispose();
  input.dispose();

  console.log(`\nwrote ${OUT_DIR}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
