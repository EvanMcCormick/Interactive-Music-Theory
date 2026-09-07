/**
 * Basic Pitch's melodia trick, with the matrix rescan taken out of it.
 *
 * ## Why
 *
 * `outputToNotesPoly` is the ten seconds. Measured on a stem-sized
 * posteriorgram — 22,616 frames by 88 pitches, the shape of the file
 * `real-detections.fixture.ts` was captured from — the library takes
 * **17.4 s**, and **98.6 %** of that is one loop: the same call with
 * `melodiaTrick: false` returns in 239 ms. Nothing else in the decoder needs
 * touching, and nothing else here does.
 *
 * The loop is bounded by the energy it removes rather than by any count known
 * in advance, and each iteration finds the largest remaining cell by scanning
 * the whole matrix — twice, once for `globalMax` in the guard and once for the
 * `reduce` that finds the coordinate. On this input that is two million cells
 * read twice, eleven hundred times over.
 *
 * It never has to be. The loop only ever *lowers* values, always through
 * `clearBand`, and always at rows it can name — so every row it does not touch
 * still holds the maximum it held last iteration. `RowMaxIndex` keeps one
 * maximum per row and refreshes only the rows an erase touched, which turns
 * each iteration from a pass over the matrix into a pass over a `Float64Array`
 * of 22,616 numbers.
 *
 * Measured on that input: **17,422 ms to 234 ms, 74x**, with all 1,094 notes
 * identical — same order, same frames, same amplitudes to the last bit. The
 * C# port of the same fix said the same thing from the other direction: native
 * code alone was worth 9.8x and this was worth another 12x on top of it, which
 * is what established that the problem was never the language. See
 * `docs/plans/2026-09-07-csharp-decoder-port.md`.
 *
 * ## Why this is a wrapper and not a fork
 *
 * `detection-framing.ts` had to replace `prepareData` outright. This does not,
 * and the difference is worth stating because a fork of a 200-line decoder is
 * a liability every time the library moves.
 *
 * `remainingEnergy` is private to `outputToNotesPoly`, which is why the loop
 * looks unreachable from outside — but it is **exactly reconstructible from
 * the notes the onset pass returns.** It starts as a copy of `frames`, and the
 * only writes before the melodia loop are the band each accepted note clears
 * across its own span. A note that is rejected for being too short clears
 * nothing, and every note that clears something is returned. So the first
 * pass's output determines the state the second pass starts from, completely.
 *
 * So: call the library with `melodiaTrick: false` — 239 ms, and the notes are
 * the library's own, untouched — rebuild `remainingEnergy` from what it
 * returned, and run the loop here. The result is `[...onsetNotes,
 * ...melodiaNotes]`, which is the order the library builds too, because its
 * melodia pass pushes onto the array the first pass produced.
 *
 * `detection-melodia.spec.ts` holds this against the library's own
 * `outputToNotesPoly` note for note, on generated posteriorgrams, and that is
 * the assertion that matters: the reconstruction argument above is only as
 * good as the reading of a file this repository does not own.
 *
 * ## The tie-breaking is load-bearing
 *
 * `argMax` below keeps the **last** index of a repeated maximum and
 * `maxCell` keeps the **first** row, because that is what the library's two
 * `reduce`s do — the first seeds at -1 and advances on `>` rather than `>=`,
 * the second seeds at `[0, 0]` and also advances only on `>`. A run of equal
 * values is not hypothetical here: it is exactly what a zeroed band of
 * `remainingEnergy` looks like, so these rules decide real notes. Do not
 * "simplify" either of them to a plain maximum.
 */

import { outputToNotesPoly as libraryOutputToNotesPoly } from '@spotify/basic-pitch';

/**
 * The library's own note shape. Not exported from the package index — only
 * `NoteEventTime` is — so it is read back off the function that returns it,
 * which also means it cannot drift from the version installed.
 */
export type NoteEvent = ReturnType<typeof libraryOutputToNotesPoly>[number];

/** MIDI pitch of frequency bin 0. The lowest key on a piano. */
const MIDI_OFFSET = 21;

/** Highest bin with a neighbour above it, in an 88-bin posteriorgram. */
const MAX_FREQ_IDX = 87;

/**
 * `outputToNotesPoly`, drop-in.
 *
 * Same parameters, same defaults, same notes in the same order. The only
 * difference a caller can observe is how long it takes.
 */
export function outputToNotesPoly(
  frames: number[][],
  onsets: number[][],
  onsetThresh = 0.5,
  frameThresh = 0.3,
  minNoteLen = 5,
  inferOnsets = true,
  maxFreq: number | null = null,
  minFreq: number | null = null,
  melodiaTrick = true,
  energyTolerance = 11
): NoteEvent[] {
  // The onset pass, unmodified and unwrapped. `constrainFrequency` mutates
  // `frames` in place when a bound is given, and that is what we want: the
  // library's own `remainingEnergy` is copied after that mutation, so
  // rebuilding from the same array reproduces it rather than diverging.
  const onsetNotes = libraryOutputToNotesPoly(
    frames,
    onsets,
    onsetThresh,
    frameThresh,
    minNoteLen,
    inferOnsets,
    maxFreq,
    minFreq,
    false,
    energyTolerance
  );

  if (!melodiaTrick) {
    return onsetNotes;
  }

  const remainingEnergy = rebuildRemainingEnergy(frames, onsetNotes);

  return onsetNotes.concat(
    melodiaNotes(frames, remainingEnergy, frameThresh, minNoteLen, energyTolerance)
  );
}

/**
 * The state the library's melodia pass would have started from: `frames`, with
 * each accepted note's band cleared across its span.
 *
 * See the module docblock for why this is exact rather than approximate.
 */
function rebuildRemainingEnergy(frames: number[][], onsetNotes: NoteEvent[]): number[][] {
  const remainingEnergy = frames.map(row => row.slice());

  for (const note of onsetNotes) {
    const freqIdx = note.pitchMidi - MIDI_OFFSET;
    const end = note.startFrame + note.durationFrames;

    for (let j = note.startFrame; j < end; ++j) {
      clearBand(remainingEnergy, j, freqIdx);
    }
  }

  return remainingEnergy;
}

/**
 * The loop itself, line for line as the library writes it, except that the
 * maximum comes from `RowMaxIndex` and the amplitude is computed after the
 * length check rather than before.
 *
 * That reordering is not a behaviour change: the library computes an amplitude
 * for every candidate and throws it away when the note is too short, and a
 * rejected note can have `iStart > iEnd`, where its `slice` yields nothing and
 * the mean is a discarded `-0`. Doing the cheap check first skips the work.
 */
function melodiaNotes(
  frames: number[][],
  remainingEnergy: number[][],
  frameThresh: number,
  minNoteLen: number,
  energyTolerance: number
): NoteEvent[] {
  const nFrames = frames.length;
  const notes: NoteEvent[] = [];

  if (nFrames === 0 || frames[0].length === 0) {
    return notes;
  }

  const index = new RowMaxIndex(remainingEnergy);

  for (;;) {
    const [iMid, freqIdx, max] = index.maxCell();
    if (!(max > frameThresh)) {
      break;
    }

    remainingEnergy[iMid][freqIdx] = 0;
    index.invalidate(iMid);

    // Forward pass.
    let i = iMid + 1;
    let k = 0;
    while (i < nFrames - 1 && k < energyTolerance) {
      k = remainingEnergy[i][freqIdx] < frameThresh ? k + 1 : 0;
      clearBand(remainingEnergy, i, freqIdx);
      index.invalidate(i);
      i += 1;
    }
    const iEnd = i - 1 - k;

    // Backwards pass.
    i = iMid - 1;
    k = 0;
    while (i > 0 && k < energyTolerance) {
      k = remainingEnergy[i][freqIdx] < frameThresh ? k + 1 : 0;
      clearBand(remainingEnergy, i, freqIdx);
      index.invalidate(i);
      i -= 1;
    }
    const iStart = i + 1 + k;

    if (iStart < 0) {
      throw new Error(`iStart is not positive! value: ${iStart}`);
    }
    if (iEnd >= nFrames) {
      throw new Error(
        `iEnd is past end of times. (iEnd, times.length): (${iEnd}, ${nFrames})`
      );
    }

    if (iEnd - iStart <= minNoteLen) {
      continue;
    }

    notes.push({
      startFrame: iStart,
      durationFrames: iEnd - iStart,
      pitchMidi: freqIdx + MIDI_OFFSET,
      amplitude: meanOverBand(frames, iStart, iEnd, freqIdx)
    });
  }

  return notes;
}

/** Zeroes a pitch and its two neighbours at one frame. */
function clearBand(remainingEnergy: number[][], frame: number, freqIdx: number): void {
  remainingEnergy[frame][freqIdx] = 0;
  if (freqIdx < MAX_FREQ_IDX) {
    remainingEnergy[frame][freqIdx + 1] = 0;
  }
  if (freqIdx > 0) {
    remainingEnergy[frame][freqIdx - 1] = 0;
  }
}

/**
 * Mean frame activation over `[start, end)` at one pitch.
 *
 * The library slices and reduces; this accumulates in place. Same left-to-right
 * order, so the same double to the last bit, without allocating a row array per
 * note.
 */
function meanOverBand(
  frames: number[][],
  start: number,
  end: number,
  freqIdx: number
): number {
  let sum = 0;
  for (let r = start; r < end; ++r) {
    sum += frames[r][freqIdx];
  }

  return sum / (end - start);
}

/**
 * Index of the largest element, or -1 for an empty row.
 *
 * **Ties take the later index**, which is neither what numpy does nor what the
 * name suggests, and is what the library's `reduce` does: seeded at -1, so the
 * first comparison is against `undefined` and yields index 0, then advancing
 * whenever `arr[maxIndex] > current` is false. The negated comparison below is
 * that, and it also reproduces the behaviour on `NaN`.
 */
function argMax(row: number[]): number {
  if (row.length === 0) {
    return -1;
  }

  let maxIndex = 0;
  for (let i = 1; i < row.length; ++i) {
    if (!(row[maxIndex] > row[i])) {
      maxIndex = i;
    }
  }

  return maxIndex;
}

/**
 * Each row's largest element, remembered, so that erasing a note costs a
 * rescan of the rows it touched rather than of the matrix.
 *
 * The answer is the library's, not an approximation of it: `maxes[r]` is
 * exactly `matrix[r][argMaxes[r]]`, so `maxCell` makes the same sequence of
 * comparisons in the same order, and both tie-breaking rules — first row, last
 * column — are untouched. The value is floored at zero so it can stand in for
 * `globalMax`, whose `reduce` seeds there.
 *
 * `Float64Array` and `Int32Array` rather than plain arrays: the scan is the
 * only thing left in the loop that is proportional to the file's length, and a
 * dense typed array is what keeps it uninteresting.
 */
class RowMaxIndex {
  private readonly argMaxes: Int32Array;
  private readonly maxes: Float64Array;

  constructor(private readonly matrix: number[][]) {
    this.argMaxes = new Int32Array(matrix.length);
    this.maxes = new Float64Array(matrix.length);

    for (let row = 0; row < matrix.length; ++row) {
      this.invalidate(row);
    }
  }

  /** Recomputes one row, after something lowered a value in it. */
  invalidate(row: number): void {
    const col = argMax(this.matrix[row]);

    this.argMaxes[row] = col;
    // An empty row can never win, which is what the library's `continue` means.
    this.maxes[row] = col < 0 ? -Infinity : this.matrix[row][col];
  }

  /** `[row, column, value]` of the largest cell. */
  maxCell(): [number, number, number] {
    let bestRow = 0;
    let bestCol = 0;
    let best = this.matrix[0][0];

    for (let row = 0; row < this.matrix.length; ++row) {
      if (this.maxes[row] > best) {
        bestRow = row;
        bestCol = this.argMaxes[row];
        best = this.maxes[row];
      }
    }

    return [bestRow, bestCol, Math.max(0, best)];
  }
}

/**
 * Module-private pieces the spec needs, in the shape the library uses for the
 * same purpose.
 */
export const testables = {
  argMax,
  rebuildRemainingEnergy,
  RowMaxIndex
};
