import { outputToNotesPoly as libraryOutputToNotesPoly } from '@spotify/basic-pitch';

import { NoteEvent, outputToNotesPoly, testables } from './detection-melodia';

/**
 * What pins the melodia rewrite: the library's own `outputToNotesPoly`, run on
 * the same posteriorgram, note for note.
 *
 * The module's argument for why it can lift the loop out — that
 * `remainingEnergy` is exactly reconstructible from the notes the onset pass
 * returns — is a reading of a file this repository does not own, and it would
 * be worth nothing on its own. This is the part that has to hold.
 *
 * Equality is exact, including the amplitudes. Both implementations sum the
 * same doubles in the same order, so there is no reason for them to differ by
 * an ulp, and a tolerance would hide exactly the class of bug this is for: a
 * rebuilt matrix that is one cell off, or a tie broken the other way.
 *
 * These specs run no inference and load no model. They are arithmetic.
 */

/** Contour-free posteriorgrams: frames and onsets are all the decoder reads. */
interface Posteriorgrams {
  frames: number[][];
  onsets: number[][];
}

/**
 * xorshift32, so a failing case can be reproduced from its seed alone rather
 * than from a committed matrix. The same generator seeds the C# port's
 * differential vectors; see `client/tools/basic-pitch-vectors.cjs`, which
 * explains why it avoids transcendental functions.
 */
function makeRandom(seed: number): () => number {
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
 * Note-shaped synthetic material.
 *
 * Uniform noise would be useless: at the 0.3 frame threshold nearly every cell
 * is "on" and the melodia trick sweeps a solid block. So each case lays down
 * decaying notes with an onset spike, plus the octave and the twelfth that
 * Basic Pitch reliably invents above a plucked fundamental — 182 played notes
 * came back as 310 across the `harmonic-eval/` materials — which is what
 * exercises the neighbour-clearing band.
 *
 * Onset peaks straddle the 0.5 threshold deliberately, so some notes are found
 * by the onset pass and some are left for the melodia pass. A case where every
 * note had a clean attack would leave the code under test with nothing to do.
 */
function generate(seed: number, nFrames: number, nNotes: number): Posteriorgrams {
  const nPitches = 88;
  const random = makeRandom(seed);

  const frames: number[][] = [];
  const onsets: number[][] = [];

  for (let t = 0; t < nFrames; t++) {
    const frameRow = new Array<number>(nPitches);
    const onsetRow = new Array<number>(nPitches);

    for (let p = 0; p < nPitches; p++) {
      frameRow[p] = random() * 0.08;
      onsetRow[p] = random() * 0.08;
    }

    frames.push(frameRow);
    onsets.push(onsetRow);
  }

  for (let n = 0; n < nNotes; n++) {
    const start = Math.floor(random() * (nFrames - 1));
    const length = 4 + Math.floor(random() * 60);
    const pitch = 4 + Math.floor(random() * (nPitches - 24));
    const peak = 0.55 + random() * 0.45;
    const onsetPeak = 0.3 + random() * 0.68;

    let level = peak;
    const end = Math.min(start + length, nFrames);

    for (let t = start; t < end; t++) {
      frames[t][pitch] = Math.max(frames[t][pitch], level);
      if (pitch + 12 < nPitches) {
        frames[t][pitch + 12] = Math.max(frames[t][pitch + 12], level * 0.55);
      }
      if (pitch + 19 < nPitches) {
        frames[t][pitch + 19] = Math.max(frames[t][pitch + 19], level * 0.35);
      }
      level *= 0.985;
    }

    onsets[start][pitch] = Math.max(onsets[start][pitch], onsetPeak);
    if (pitch + 12 < nPitches) {
      onsets[start][pitch + 12] = Math.max(onsets[start][pitch + 12], onsetPeak * 0.5);
    }
  }

  return { frames, onsets };
}

/** A fresh copy, because the decoder is handed matrices it may mutate. */
function copy({ frames, onsets }: Posteriorgrams): Posteriorgrams {
  return { frames: frames.map(row => row.slice()), onsets: onsets.map(row => row.slice()) };
}

function describeNote(note: NoteEvent): string {
  return `${note.pitchMidi}@${note.startFrame}+${note.durationFrames}`;
}

/**
 * Sparse through saturated, plus one case shorter than `energyTolerance` and
 * one with nothing in it at all.
 */
const CASES: { name: string; seed: number; nFrames: number; nNotes: number }[] = [
  { name: 'sparse', seed: 777, nFrames: 300, nNotes: 8 },
  { name: 'typical', seed: 1, nFrames: 600, nNotes: 40 },
  { name: 'dense', seed: 12345, nFrames: 900, nNotes: 90 },
  { name: 'saturated', seed: 424242, nFrames: 1200, nNotes: 200 },
  { name: 'tiny', seed: 99, nFrames: 20, nNotes: 3 },
  { name: 'silent', seed: 5, nFrames: 200, nNotes: 0 }
];

describe('outputToNotesPoly with the melodia rescan removed', () => {
  for (const testCase of CASES) {
    it(`returns exactly the library's notes on ${testCase.name} material`, () => {
      const material = generate(testCase.seed, testCase.nFrames, testCase.nNotes);

      const mine = copy(material);
      const theirs = copy(material);

      const expected = libraryOutputToNotesPoly(theirs.frames, theirs.onsets);
      const actual = outputToNotesPoly(mine.frames, mine.onsets);

      // Compared in the order returned, which is neither sorted nor
      // meaningful, and is exactly why it is worth asserting: two
      // implementations that agree on the multiset but not the order have
      // diverged inside the loop.
      expect(actual.map(describeNote)).toEqual(expected.map(describeNote));

      for (let i = 0; i < expected.length; i++) {
        expect(actual[i].amplitude)
          .withContext(`${testCase.name} note ${i} of ${expected.length}`)
          .toBe(expected[i].amplitude);
      }
    });
  }

  it('finds notes the onset pass alone does not', () => {
    // Otherwise every case above could pass with the melodia pass deleted.
    const material = generate(1, 600, 40);

    const onsetOnly = copy(material);
    const withMelodia = copy(material);

    const onsetNotes = outputToNotesPoly(
      onsetOnly.frames,
      onsetOnly.onsets,
      0.5,
      0.3,
      5,
      true,
      null,
      null,
      false
    );
    const allNotes = outputToNotesPoly(withMelodia.frames, withMelodia.onsets);

    expect(onsetNotes.length).toBeGreaterThan(0);
    expect(allNotes.length).toBeGreaterThan(onsetNotes.length);

    // And the onset notes are a prefix of the whole, because the library
    // pushes the melodia notes onto the array the first pass produced.
    expect(allNotes.slice(0, onsetNotes.length).map(describeNote)).toEqual(
      onsetNotes.map(describeNote)
    );
  });

  it('honours a frequency bound the same way, mutations included', () => {
    const material = generate(1, 400, 25);

    const mine = copy(material);
    const theirs = copy(material);

    // Bounds mutate `frames` in place before the copy the melodia pass runs
    // on, so passing them through is the case most likely to expose a
    // reconstruction built from the wrong array.
    const expected = libraryOutputToNotesPoly(
      theirs.frames,
      theirs.onsets,
      0.5,
      0.3,
      5,
      true,
      880,
      110
    );
    const actual = outputToNotesPoly(
      mine.frames,
      mine.onsets,
      0.5,
      0.3,
      5,
      true,
      880,
      110
    );

    expect(actual.map(describeNote)).toEqual(expected.map(describeNote));
    expect(mine.frames).toEqual(theirs.frames);
  });

  it('is faster than the library on material where it matters', () => {
    // Not a threshold on a wall clock - that is a flaky test on shared
    // hardware. The measurement that means anything is in the module
    // docblock: 17,422 ms to 234 ms on a stem-sized input. This only asserts
    // the sign of the difference, on an input big enough for the rescan to
    // dominate, so that a change putting the scan back is caught by something.
    const material = generate(31337, 2000, 250);

    const mine = copy(material);
    const theirs = copy(material);

    const libraryStart = performance.now();
    libraryOutputToNotesPoly(theirs.frames, theirs.onsets);
    const libraryMs = performance.now() - libraryStart;

    const ourStart = performance.now();
    outputToNotesPoly(mine.frames, mine.onsets);
    const ourMs = performance.now() - ourStart;

    expect(ourMs).toBeLessThan(libraryMs);
  });
});

describe('rebuildRemainingEnergy', () => {
  it('clears each note band and leaves everything else alone', () => {
    const frames = [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1]
    ];

    // MIDI 23 is bin 2, so bins 1, 2 and 3 clear across frames 0 and 1.
    const rebuilt = testables.rebuildRemainingEnergy(frames, [
      { startFrame: 0, durationFrames: 2, pitchMidi: 23, amplitude: 0.9 }
    ]);

    expect(rebuilt[0]).toEqual([1, 0, 0, 0, 1]);
    expect(rebuilt[1]).toEqual([1, 0, 0, 0, 1]);
    expect(rebuilt[2]).toEqual([1, 1, 1, 1, 1]);

    // And it copies rather than clearing the caller's matrix, which the
    // library also does.
    expect(frames[0]).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('argMax', () => {
  it('reports an empty row as -1', () => {
    expect(testables.argMax([])).toBe(-1);
  });

  it('finds the maximum', () => {
    expect(testables.argMax([1, 2, -1])).toBe(1);
  });

  /**
   * The single most important line in this file. A run of equal values is what
   * a zeroed band of `remainingEnergy` looks like, so which end of a tie wins
   * decides real notes rather than hypothetical ones.
   */
  it('breaks ties towards the later index, as the library does', () => {
    expect(testables.argMax([5, 5, 1, 5])).toBe(3);
  });
});

describe('RowMaxIndex', () => {
  /**
   * The differential specs above already prove the cache agrees with the
   * library across six decoded cases, which is the assertion that matters.
   * This one is cheaper to read when it fails: it isolates the cache from the
   * loop, and it hits ties deliberately.
   */
  it('agrees with a naive scan under mutation', () => {
    const random = makeRandom(20260907);
    const matrix: number[][] = [];

    for (let r = 0; r < 60; r++) {
      const row = new Array<number>(12);
      // Small integers, so ties are common rather than hypothetical.
      for (let c = 0; c < row.length; c++) row[c] = Math.floor(random() * 5);
      matrix.push(row);
    }

    /** What the library computes, the way the library computes it. */
    const naiveMaxCell = (): [number, number, number] => {
      let best: [number, number] = [0, 0];
      for (let row = 0; row < matrix.length; row++) {
        const col = testables.argMax(matrix[row]);
        if (matrix[row][col] > matrix[best[0]][best[1]]) best = [row, col];
      }
      return [best[0], best[1], Math.max(0, matrix[best[0]][best[1]])];
    };

    const index = new testables.RowMaxIndex(matrix);

    for (let step = 0; step < 400; step++) {
      expect(index.maxCell()).toEqual(naiveMaxCell());

      const row = Math.floor(random() * matrix.length);
      matrix[row][Math.floor(random() * matrix[row].length)] = Math.floor(random() * 5);
      index.invalidate(row);
    }

    expect(index.maxCell()).toEqual(naiveMaxCell());
  });
});
