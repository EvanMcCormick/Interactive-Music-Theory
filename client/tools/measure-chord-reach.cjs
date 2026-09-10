/**
 * Measures how far above its voicing base the tallest chord the progression
 * model can build actually reaches, by running every one of them through the
 * real `generateSlotNotes`.
 *
 * ## Why this is a tool and not a spec
 *
 * It was a spec. `progression-normalize.spec.ts` swept the shipped set - 5.6
 * million chords, 3.7 seconds per octave - to prove `OCTAVE_MAX` maximal, and
 * that was affordable. M3 Task 4 gave a chord a suspension and an alteration on
 * each of its three extensions, and the same sweep widened to cover them is
 * **236 million chords and about 200 seconds per octave**. The describe measured
 * four octaves, so shipping the widened sweep would have put thirteen minutes
 * into a suite that runs in under a minute, and nothing in CI should wait on a
 * measurement.
 *
 * Task 4b then removed the reason to run it in CI at all. The octave ceiling is
 * now derived per chord by `chordOctaveCeiling`, so the property the suite has
 * to prove is local - *this* chord fits under *its* ceiling, and the ceiling is
 * the highest one that fits - and that is checkable on a sample in
 * milliseconds. What survives here is the thing a global figure was for:
 * knowing how wide the model can get, so that `OCTAVE_MAX`'s note can say what
 * it costs and a reader can check the number rather than trust it.
 *
 * ## What it last measured
 *
 * On **2026-09-10**, against `VOICING_BASE_MIDI` of 60 and `OCTAVE_MAX` of 2:
 *
 * | --set      | chords      | seconds | reach | lowest ceiling |
 * |------------|-------------|---------|-------|----------------|
 * | shipped    | 5,613,300   | 4.1     | 46    | octave 1       |
 * | suspended  | 16,839,900  | 14.2    | 46    | octave 1       |
 * | full       | 236,432,196 | 180.1   | 58    | octave 0       |
 *
 * **The lowest-ceiling column reads differently than it did**, and none of its
 * numbers moved. It was measured with `OCTAVE_MAX` at 1, where a shipped-set
 * ceiling of 1 *was* the control's own bound and meant nothing was held down.
 * At 2 the same 1 sits one below the bound and means those chords are.
 *
 * The 58 is C major's degree 3 at extent 13, altered down a tone and overridden
 * to `diminished`, suspended at the fourth with a flattened ninth and a
 * flattened thirteenth, second inversion, in D - two replacements land on the
 * note below them and the ascent lift adds an octave twice. It is pinned by hand
 * in `progression-normalize.spec.ts` so the figure can be checked without
 * running the sweep.
 *
 * It is the *widest* chord rather than the only held-down one, which earlier
 * notes got wrong by calling it "the one chord in 236 million". The histogram
 * below is what says otherwise, and it is what `OCTAVE_MAX` is now chosen
 * against - a raw headroom of n is a chord that can take n octaves and no more,
 * whatever the control's bound happens to be:
 *
 * | raw headroom | shipped   | share   | full        | share   |
 * |--------------|-----------|---------|-------------|---------|
 * | 0            | -         | -       | 16,045      | 0.007%  |
 * | 1            | 9,041     | 0.161%  | 1,730,647   | 0.732%  |
 * | 2            | 511,231   | 9.107%  | 36,454,215  | 15.418% |
 * | 3            | 3,519,644 | 62.702% | 187,164,854 | 79.162% |
 * | 4            | 1,554,375 | 27.691% | 10,940,750  | 4.627%  |
 * | 5            | 19,009    | 0.339%  | 125,685     | 0.053%  |
 *
 * So `OCTAVE_MAX` of 2 gives 99.839% of the shipped set an octave back and takes
 * nothing from the 0.161% that cannot use it, because `chordOctaveCeiling` holds
 * those at 1 by themselves. Over the whole storable set - the `full` row -
 * 0.739% is held below 2 that way.
 *
 * The reach does not depend on which octave the slots are swept at: a
 * whole-octave shift of the base moves every note in a voicing by exactly twelve
 * - `voiceChord` places each note from the previous one modulo 12 - so one
 * octave is measured rather than four, and `--octave` is there to watch the
 * clamp rather than to move the answer.
 *
 * ## How it loads TypeScript without a TypeScript runner
 *
 * The repo has no `ts-node`, no `tsx`, and no build target that emits these
 * modules for Node, and the point of the exercise is defeated by a script that
 * reimplements the pipeline: two copies of one arithmetic with nothing asserting
 * that they agree is exactly how a bound comes to guard something the app has
 * stopped doing. So the modules are loaded *as they are*, through a
 * `require.extensions` hook that transpiles each file with the repo's own
 * `typescript` - already a devDependency, for the compiler the CLI runs - and
 * hands the result to Node. No dependency is added.
 *
 * `@angular/core` is stubbed rather than loaded, because the one thing this
 * needs from `MusicTheoryService` is its scale table, and a scale table is data.
 * The stub's `Injectable` is a decorator that does nothing and its `inject`
 * throws, so a module that needs a real injector fails loudly here rather than
 * quietly returning something wrong.
 *
 * ## Usage
 *
 *     cd client
 *     node tools/measure-chord-reach.cjs                  # --set=full, ~3.5 min
 *     node tools/measure-chord-reach.cjs --set=shipped
 *     node tools/measure-chord-reach.cjs --set=full --octave=1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

// ---------------------------------------------------------------------------
// Loading the app's own modules
// ---------------------------------------------------------------------------

const ANGULAR_STUB = {
  Injectable: () => () => {},
  inject: () => {
    throw new Error('measure-chord-reach: this tool has no Angular injector');
  }
};

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@angular/core') return ANGULAR_STUB;
  return load.call(this, request, parent, isMain);
};

require.extensions['.ts'] = function (module, filename) {
  const transpiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true
    },
    fileName: filename
  });
  module._compile(transpiled.outputText, filename);
};

const APP = path.join(__dirname, '..', 'src', 'app');
const { MusicTheoryService } = require(path.join(APP, 'services', 'music-theory.service.ts'));
const { QUALITY_INTERVALS, noteCount } = require(path.join(APP, 'services', 'progression-harmony.ts'));
const {
  chordOctaveCeiling,
  generateSlotNotes
} = require(path.join(APP, 'services', 'progression-generate.ts'));
const { createDegreeSlot } = require(path.join(APP, 'models', 'progression.model.ts'));
const {
  ALTER_MIN,
  ALTER_MAX,
  CHORD_EXTENTS,
  MIDI_MAX,
  SUSPENSIONS,
  VOICING_BASE_MIDI
} = require(path.join(APP, 'models', 'progression-normalize.ts'));

// ---------------------------------------------------------------------------
// The axes
// ---------------------------------------------------------------------------

/**
 * Every heptatonic scale the app offers, read from the same method the chord
 * palette reads its scales from. A scale reachable there is a scale this figure
 * has to survive.
 */
const SCALES = new MusicTheoryService()
  .getScaleCategories()
  .flatMap(category => category.scales)
  .map(scale => ({ id: scale.id, name: scale.name, intervals: scale.intervals }))
  .filter(scale => scale.intervals.length === 7);

/**
 * Every `(alter, quality)` pair a stored slot can carry.
 *
 * A null quality is the diatonic chord and only survives at `alter` 0 -
 * `chordPitchClasses` refuses the pair - so the two axes are swept together as
 * legal combinations rather than as a product with an illegal corner.
 * `'other'` is not swept because it cannot be stored: it is a label rather than
 * a shape, and the field holds shapes.
 */
const SHAPES = [{ alter: 0, quality: null }].concat(
  Object.keys(QUALITY_INTERVALS).flatMap(quality =>
    [ALTER_MIN, -1, 0, 1, ALTER_MAX].map(alter => ({ alter, quality }))
  )
);

const NINTHS = [null, -1, 0, 1];
const ELEVENTHS = [null, 0, 1];
const THIRTEENTHS = [null, -1, 0];

/**
 * The extension alterations worth sweeping at each extent.
 *
 * Only where the position exists: `chordPitchClasses` ignores an alteration the
 * extent does not reach, so a pinned thirteenth on a triad is not a second
 * chord, it is the same chord counted twice. That is what puts the full sweep
 * at 236 million rather than the 606 million a blind product would give.
 */
function extensionsFor(extent) {
  const ninths = extent >= 9 ? NINTHS : [null];
  const elevenths = extent >= 11 ? ELEVENTHS : [null];
  const thirteenths = extent >= 13 ? THIRTEENTHS : [null];
  const combos = [];
  for (const ninth of ninths) {
    for (const eleventh of elevenths) {
      for (const thirteenth of thirteenths) {
        combos.push({ ninth, eleventh, thirteenth });
      }
    }
  }
  return combos;
}

const SETS = {
  /** What M2 measured: `alter` and `quality`, and nothing M3 added. */
  shipped: { suspensions: ['none'], extensions: false },
  /** Plus the two suspensions. */
  suspended: { suspensions: SUSPENSIONS, extensions: false },
  /** Plus every alteration on every extension the extent reaches. */
  full: { suspensions: SUSPENSIONS, extensions: true }
};

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const TEMPLATE = createDegreeSlot(0, 0);

/**
 * Every chord in the set, measured from the base it is actually voiced from.
 *
 * `generateSlotNotes` clamps to `chordOctaveCeiling` since Task 4b, so the base
 * a slot sounds at is not always the one its `octave` names. The reach is taken
 * from the sounding base rather than the requested one, which is what keeps this
 * a measurement of how wide a chord is rather than of what the guard decided to
 * do about it - and it stays right however wide the model gets.
 *
 * The narrowest ceiling is reported beside it, because that is now the figure
 * with consequences: it is the top of the octave control for the worst chord in
 * the set.
 */
function sweep(setName, octave) {
  const set = SETS[setName];
  const noExtensions = [{ ninth: null, eleventh: null, thirteenth: null }];

  let chords = 0;
  let reach = -Infinity;
  let floorGap = Infinity;
  let minCeiling = Infinity;
  let witness = null;
  const headroom = new Map();

  for (const scale of SCALES) {
    for (let degree = 0; degree <= 6; degree++) {
      for (const extent of CHORD_EXTENTS) {
        const inversions = noteCount(extent);
        const tensions = set.extensions ? extensionsFor(extent) : noExtensions;
        for (const shape of SHAPES) {
          for (const suspension of set.suspensions) {
            for (const extensions of tensions) {
              for (let tonic = 0; tonic < 12; tonic++) {
                const key = { tonic, scaleId: scale.id, preferSharps: true };
                for (let inversion = 0; inversion < inversions; inversion++) {
                  const degreeValue = {
                    ...TEMPLATE.harmony.degree,
                    degree,
                    extent,
                    inversion,
                    octave,
                    alter: shape.alter,
                    quality: shape.quality,
                    suspension,
                    extensions
                  };
                  const slot = {
                    ...TEMPLATE,
                    harmony: { kind: 'degree', degree: degreeValue }
                  };
                  chords++;

                  const ceiling = chordOctaveCeiling(key, scale.intervals, degreeValue);
                  if (ceiling < minCeiling) minCeiling = ceiling;

                  const base = VOICING_BASE_MIDI + Math.min(octave, ceiling) * 12;
                  let top = -Infinity;
                  for (const note of generateSlotNotes(slot, key, scale.intervals)) {
                    if (note.midi - base < floorGap) floorGap = note.midi - base;
                    if (note.midi - base > top) top = note.midi - base;
                  }
                  if (top > reach) {
                    reach = top;
                    witness = { scale: scale.name, key: tonic, degree: degreeValue };
                  }

                  // The *unclamped* headroom, which is what says how much of the
                  // control this chord could use if the control let it. It is
                  // derived from the chord's own reach rather than asked of
                  // `headroomOctaves` again, and the two agree by the same
                  // invariance the ceiling rests on: a whole-octave shift of the
                  // base moves every note by exactly twelve, so `top` measured
                  // from the sounding base is this chord's reach whatever octave
                  // it sounded at.
                  const raw = Math.floor((MIDI_MAX - VOICING_BASE_MIDI - top) / 12);
                  headroom.set(raw, (headroom.get(raw) ?? 0) + 1);
                }
              }
            }
          }
        }
      }
    }
  }

  return { chords, reach, floorGap, minCeiling, witness, headroom };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function argument(name, fallback) {
  const flag = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(flag));
  return found === undefined ? fallback : found.slice(flag.length);
}

const setName = argument('set', 'full');
const octave = Number(argument('octave', '0'));

if (!Object.prototype.hasOwnProperty.call(SETS, setName)) {
  console.error(`Unknown --set=${setName}. One of: ${Object.keys(SETS).join(', ')}`);
  process.exit(1);
}
if (!Number.isInteger(octave)) {
  console.error(`--octave must be a whole number; got ${argument('octave', '0')}`);
  process.exit(1);
}

console.log(`Sweeping --set=${setName}, slots at octave ${octave}`);
console.log(`${SCALES.length} heptatonic scales, ${SHAPES.length} (alter, quality) pairs\n`);

const started = Date.now();
const { chords, reach, floorGap, minCeiling, witness, headroom } = sweep(setName, octave);
const seconds = (Date.now() - started) / 1000;

console.log(`chords       ${chords.toLocaleString('en-US')}`);
console.log(`seconds      ${seconds.toFixed(1)}`);
console.log(`reach        ${reach} semitones above the sounding base`);
console.log(`floor gap    ${floorGap} (voiceChord never voices below its base, so 0)`);
console.log(`min ceiling  octave ${minCeiling} (the top of the control for the worst chord)`);

// What each octave of the control costs, which is the figure `OCTAVE_MAX` is
// chosen against: a raw headroom of n is a chord that can take n octaves and no
// more, whatever the control's own bound happens to be.
console.log('\nraw headroom (unclamped by OCTAVE_MIN/OCTAVE_MAX)');
for (const raw of [...headroom.keys()].sort((a, b) => a - b)) {
  const count = headroom.get(raw);
  const share = ((count / chords) * 100).toFixed(3);
  console.log(`  ${String(raw).padStart(3)}  ${count.toLocaleString('en-US').padStart(13)}  ${share.padStart(7)}%`);
}

console.log(`\nwidest       ${witness.scale}, key ${witness.key}`);
console.log(`             ${JSON.stringify(witness.degree)}`);
console.log(
  `\n${VOICING_BASE_MIDI} + ${reach} = ${VOICING_BASE_MIDI + reach}, ` +
    `so that chord fits at octave ${Math.floor((MIDI_MAX - VOICING_BASE_MIDI - reach) / 12)} ` +
    `and no higher.`
);
