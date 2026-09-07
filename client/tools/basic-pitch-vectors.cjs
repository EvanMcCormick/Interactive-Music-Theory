/**
 * Generates the vectors that pin the C# port of `outputToNotesPoly` to the
 * TypeScript it was ported from.
 *
 * ## Why this exists rather than a fixture of real posteriorgrams
 *
 * The obvious test is to run both implementations on the same model output
 * from a real file. That fixture is 22,600 frames by 88 pitches for frames and
 * onsets and by 264 bins for contours — a hundred megabytes of derived data to
 * commit for one test, and it would still only exercise whatever branches one
 * bass stem happens to reach.
 *
 * So the input is generated instead, from a seed, by an algorithm simple
 * enough to write twice: `BasicPitchVectors` in the test project is this file's
 * generator line for line. What gets committed is a few kilobytes of *answers*.
 *
 * ## The generator uses no transcendental functions, deliberately
 *
 * `Math.exp` and `Math.log` are not required to agree to the last bit between
 * V8 and .NET, so a generator that used them could produce two different
 * inputs and blame the port for the difference. Everything below is the PRNG,
 * addition, multiplication, comparison and integer arithmetic, all of which
 * IEEE 754 pins exactly. `inputHash` is what proves it worked: the C# side
 * recomputes it over its own generated matrices and asserts before it compares
 * a single note, so a generator that has drifted fails as a generator rather
 * than as a port bug.
 *
 * The one transcendental in the pipeline is the gaussian window inside
 * `addPitchBendsToNoteEvents`, which is why the window itself is emitted and
 * asserted separately.
 *
 * ## What the synthetic material is shaped like
 *
 * Uniform noise would be useless: at the 0.3 frame threshold nearly every cell
 * is "on", and the melodia trick would sweep a solid block. So each case lays
 * down notes — a decaying frame activation, an onset spike, and the two
 * harmonic partials Basic Pitch reliably invents above a plucked fundamental,
 * which is what exercises the neighbour-clearing band. Onset peaks straddle
 * the 0.5 threshold on purpose, so that some notes are found by the onset pass
 * and some are left for the melodia pass.
 *
 * Regenerate after any change to the vendored library:
 *
 *     cd client && node tools/basic-pitch-vectors.cjs
 *
 * It rewrites `server/MusicTheory.API.Tests/Vectors/basic-pitch-vectors.json`.
 * A diff there is a real change in the library's behaviour and wants reading,
 * not accepting.
 */

const fs = require('fs');
const path = require('path');

const {
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  testables
} = require('@spotify/basic-pitch/cjs/toMidi.js');

const OUTPUT = path.join(
  __dirname,
  '..',
  '..',
  'server',
  'MusicTheory.API.Tests',
  'Vectors',
  'basic-pitch-vectors.json'
);

/** Contour bins per semitone, as the library defines it. */
const CONTOUR_BINS_PER_SEMITONE = 3;

/** MIDI pitch of frequency bin 0. */
const MIDI_OFFSET = 21;

/**
 * xorshift32.
 *
 * Chosen for being expressible with nothing but uint32 operations, which is
 * the whole requirement: `>>> 0` is what keeps JavaScript's int32 bitwise
 * operators in unsigned range, and C# `uint` does the same thing natively. The
 * division is by a power of two, so it is exact in both.
 */
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
 * FNV-1a over the big-endian bytes of every element.
 *
 * Big-endian because JavaScript's `DataView` defaults to it and C# has to be
 * told; picking the endianness the two agree on by accident would be a trap
 * for whoever regenerates this next.
 */
function hashMatrix(rows) {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5 >>> 0;

  for (const row of rows) {
    for (const value of row) {
      view.setFloat64(0, value);
      for (let i = 0; i < 8; i++) {
        h = (h ^ view.getUint8(i)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
  }

  return h >>> 0;
}

function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * Builds one case's three posteriorgrams.
 *
 * Mirrored exactly by `BasicPitchVectors.Generate` in the test project. If you
 * change anything here, change it there, and let the input hash tell you
 * whether you got it right.
 */
function generate(seed, nFrames, nPitches, nNotes) {
  const rnd = makeRandom(seed);
  const nBins = nPitches * CONTOUR_BINS_PER_SEMITONE;

  const frames = zeros(nFrames, nPitches);
  const onsets = zeros(nFrames, nPitches);
  const contours = zeros(nFrames, nBins);

  // Floor noise. Well below the 0.3 frame threshold, so it decides nothing on
  // its own but does break every tie the melodia pass would otherwise hit.
  for (let t = 0; t < nFrames; t++) {
    for (let p = 0; p < nPitches; p++) {
      frames[t][p] = rnd() * 0.08;
      onsets[t][p] = rnd() * 0.08;
    }
    for (let b = 0; b < nBins; b++) {
      contours[t][b] = rnd() * 0.05;
    }
  }

  for (let n = 0; n < nNotes; n++) {
    const start = Math.floor(rnd() * (nFrames - 1));
    const length = 4 + Math.floor(rnd() * 60);
    const pitch = 4 + Math.floor(rnd() * (nPitches - 24));

    const peak = 0.55 + rnd() * 0.45;

    // Straddles the 0.5 onset threshold: below it the onset pass never sees an
    // attack and the note has to be recovered by the melodia trick, which is
    // the branch most worth pinning.
    const onsetPeak = 0.3 + rnd() * 0.68;

    let level = peak;
    const end = Math.min(start + length, nFrames);
    let wobble = 0;

    for (let t = start; t < end; t++) {
      frames[t][pitch] = Math.max(frames[t][pitch], level);

      // The octave and the twelfth: Basic Pitch over-detects both above a
      // plucked fundamental, measured at 310 detections for 182 played notes,
      // and they are what make the band-clearing in the decoder matter.
      if (pitch + 12 < nPitches) {
        frames[t][pitch + 12] = Math.max(frames[t][pitch + 12], level * 0.55);
      }
      if (pitch + 19 < nPitches) {
        frames[t][pitch + 19] = Math.max(frames[t][pitch + 19], level * 0.35);
      }

      // A slow integer wander, so bends are non-trivial without needing a
      // transcendental to shape them.
      if (rnd() < 0.08) {
        wobble += rnd() < 0.5 ? -1 : 1;
      }

      const centre = pitch * CONTOUR_BINS_PER_SEMITONE + wobble;
      for (let d = -6; d <= 6; d++) {
        const bin = centre + d;
        if (bin >= 0 && bin < nBins) {
          const falloff = 1 - (d * d) / 49;
          contours[t][bin] = Math.max(contours[t][bin], level * falloff);
        }
      }

      level = level * 0.985;
    }

    onsets[start][pitch] = Math.max(onsets[start][pitch], onsetPeak);
    if (pitch + 12 < nPitches) {
      onsets[start][pitch + 12] = Math.max(onsets[start][pitch + 12], onsetPeak * 0.5);
    }
  }

  return { frames, onsets, contours };
}

/**
 * The cases.
 *
 * Sparse through saturated, plus two shapes chosen for their edges: `tiny` is
 * shorter than one model window and shorter than `energyTolerance`, and
 * `saturated` leaves so little unclaimed energy that the melodia loop runs
 * hundreds of times.
 */
const CASES = [
  { name: 'sparse', seed: 777, nFrames: 300, nPitches: 88, nNotes: 8 },
  { name: 'typical', seed: 1, nFrames: 600, nPitches: 88, nNotes: 40 },
  { name: 'dense', seed: 12345, nFrames: 900, nPitches: 88, nNotes: 90 },
  { name: 'saturated', seed: 424242, nFrames: 1200, nPitches: 88, nNotes: 200 },
  { name: 'tiny', seed: 99, nFrames: 20, nPitches: 88, nNotes: 3 },
  { name: 'silent', seed: 5, nFrames: 200, nPitches: 88, nNotes: 0 }
];

/**
 * `--bench` runs one stem-sized case and prints what the TypeScript costs on
 * it, so the C# number has something to be compared against that is not a
 * remembered figure from a different input.
 *
 * The shape is taken from the real capture: 22,616 frames is a 4:22 stem at
 * 22.05 kHz on a 256-sample hop, and 600 planted notes is the density that
 * decodes to roughly the 1,224 detections `real-detections.fixture.ts` holds.
 */
const BENCH = { name: 'stem', seed: 20260907, nFrames: 22616, nPitches: 88, nNotes: 600 };

if (process.argv.includes('--bench')) {
  const built = Date.now();
  const { frames, onsets, contours } = generate(
    BENCH.seed,
    BENCH.nFrames,
    BENCH.nPitches,
    BENCH.nNotes
  );
  const generated = Date.now();

  const decodeStart = Date.now();
  const notes = outputToNotesPoly(frames, onsets);
  const decoded = Date.now();
  addPitchBendsToNoteEvents(contours, notes);
  const bent = Date.now();

  console.log(`generate            ${String(generated - built).padStart(6)} ms`);
  console.log(`outputToNotesPoly   ${String(decoded - decodeStart).padStart(6)} ms   ${notes.length} notes`);
  console.log(`addPitchBends       ${String(bent - decoded).padStart(6)} ms`);
  console.log(`decode total        ${String(bent - decodeStart).padStart(6)} ms`);
  process.exit(0);
}

const cases = CASES.map(spec => {
  const { frames, onsets, contours } = generate(
    spec.seed,
    spec.nFrames,
    spec.nPitches,
    spec.nNotes
  );

  const inputHash = {
    frames: hashMatrix(frames),
    onsets: hashMatrix(onsets),
    contours: hashMatrix(contours)
  };

  const notes = outputToNotesPoly(frames, onsets);
  const withBends = addPitchBendsToNoteEvents(contours, notes);
  const timed = noteFramesToTime(withBends);

  return {
    ...spec,
    inputHash,
    // In the order the decoder returns them, which is not sorted and not
    // meaningful — and that is exactly why it is worth asserting. Two
    // implementations that agree on the multiset but not the order have
    // diverged somewhere in the melodia loop.
    notes: withBends.map((note, i) => ({
      startFrame: note.startFrame,
      durationFrames: note.durationFrames,
      pitchMidi: note.pitchMidi,
      amplitude: note.amplitude,
      pitchBends: note.pitchBends,
      startTimeSeconds: timed[i].startTimeSeconds,
      durationSeconds: timed[i].durationSeconds
    }))
  };
});

const vectors = {
  generatedBy: 'client/tools/basic-pitch-vectors.cjs',
  library: '@spotify/basic-pitch ' + require('@spotify/basic-pitch/package.json').version,

  // The one transcendental the decoder itself uses. Emitted so the C# side can
  // assert its own window matches before it trusts a single bend.
  gaussian: testables.gaussian(51, 5),

  // Spot values for the ported librosa helpers, so a failure there is reported
  // as itself rather than as a wrong note two hundred lines later.
  scalars: {
    hzToMidi440: testables.hzToMidi(440),
    midiToHz69: testables.midiToHz(69),
    midiPitchToContourBin: [21, 40, 69, 108].map(p => testables.midiPitchToContourBin(p)),
    modelFrameToTime: [0, 1, 171, 172, 173, 344, 1000, 22599].map(f =>
      testables.modelFrameToTime(f)
    )
  },
  midiOffset: MIDI_OFFSET,
  cases
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(vectors, null, 2) + '\n');

for (const c of cases) {
  console.log(
    `${c.name.padEnd(10)} ${String(c.nFrames).padStart(5)} frames  ` +
      `${String(c.nNotes).padStart(3)} planted  ${String(c.notes.length).padStart(4)} decoded`
  );
}
console.log(`\nwrote ${path.relative(process.cwd(), OUTPUT)}`);
