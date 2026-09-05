import { NotePitch } from '../models/composer.model';
import { DerivationSettings } from '../models/transcription.model';

export interface FingeringInput {
  /** MIDI pitch. */
  pitch: number;
  onsetSec: number;
}

export interface Candidate {
  /** Index into the tuning array, so 0 is the highest string. */
  string: number;
  fret: number;
}

/**
 * Movement is judged against a quarter note at 120 BPM. A gap shorter than
 * this makes shifting proportionally more expensive, a longer gap cheaper.
 */
const MOVE_REFERENCE_SEC = 0.25;
const MIN_TIME_FACTOR = 0.1;
const MAX_TIME_FACTOR = 8;

const MOVE_WEIGHT = 1.0;
const STRING_CHANGE_WEIGHT = 0.8;
const FRET_HEIGHT_WEIGHT = 0.15;
const OPEN_STRING_BONUS = 1.5;
const POSITION_HINT_WEIGHT = 0.5;

/** Every string/fret pair that sounds `pitch` on this instrument. */
export function candidatesFor(
  pitch: number,
  tuning: number[],
  capo: number,
  maxFret: number
): Candidate[] {
  const out: Candidate[] = [];

  for (let string = 0; string < tuning.length; string++) {
    const fret = pitch - tuning[string] - capo;
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret });
  }

  return out;
}

/** Cost of a position considered on its own, ignoring neighbours. */
function nodeCost(candidate: Candidate, settings: DerivationSettings): number {
  let cost = FRET_HEIGHT_WEIGHT * candidate.fret;

  // Open strings are free to play and idiomatic, so they earn a bonus rather
  // than merely avoiding a penalty.
  if (candidate.fret === 0) cost -= OPEN_STRING_BONUS;

  if (settings.positionHint !== null && candidate.fret > 0) {
    cost += POSITION_HINT_WEIGHT * Math.abs(candidate.fret - settings.positionHint);
  }

  return cost;
}

/** Cost of moving from one position to the next, given the time available. */
function edgeCost(from: Candidate, to: Candidate, gapSec: number): number {
  // An open string needs no fretting hand, so it neither costs a shift nor
  // pins the hand in place for the note that follows.
  const move = from.fret === 0 || to.fret === 0
    ? 0
    : Math.abs(to.fret - from.fret);

  const timeFactor = Math.min(
    MAX_TIME_FACTOR,
    Math.max(MIN_TIME_FACTOR, MOVE_REFERENCE_SEC / Math.max(gapSec, 1e-3))
  );

  return MOVE_WEIGHT * move * timeFactor
    + STRING_CHANGE_WEIGHT * Math.abs(to.string - from.string);
}

/** Viterbi over one unbroken run of playable notes. */
function bestPath(
  candidateSets: Candidate[][],
  notes: FingeringInput[],
  settings: DerivationSettings
): Candidate[] {
  const costs: number[][] = [candidateSets[0].map(c => nodeCost(c, settings))];
  const back: number[][] = [candidateSets[0].map(() => -1)];

  for (let i = 1; i < candidateSets.length; i++) {
    const gap = Math.max(0, notes[i].onsetSec - notes[i - 1].onsetSec);
    const row: number[] = [];
    const pointers: number[] = [];

    for (const candidate of candidateSets[i]) {
      let bestCost = Infinity;
      let bestIndex = 0;

      candidateSets[i - 1].forEach((previous, k) => {
        const total = costs[i - 1][k] + edgeCost(previous, candidate, gap);
        if (total < bestCost) {
          bestCost = total;
          bestIndex = k;
        }
      });

      row.push(bestCost + nodeCost(candidate, settings));
      pointers.push(bestIndex);
    }

    costs.push(row);
    back.push(pointers);
  }

  const finalRow = costs[costs.length - 1];
  let index = finalRow.indexOf(Math.min(...finalRow));

  const path: Candidate[] = [];
  for (let i = candidateSets.length - 1; i >= 0; i--) {
    path.unshift(candidateSets[i][index]);
    index = back[i][index];
  }

  return path;
}

/**
 * Chooses a string and fret for every note, minimising total playing effort.
 *
 * The interesting term is movement cost scaled by the gap to the previous
 * note. A five-fret shift is free across a rest and unacceptable between two
 * sixteenths, which is exactly the judgement a player makes and exactly what
 * per-note lowest-fret assignment cannot express.
 *
 * Returns null at any index the instrument cannot play. Such a note breaks the
 * chain, and the notes after it are optimised as a fresh run.
 */
export function assignFingering(
  notes: FingeringInput[],
  settings: DerivationSettings
): (NotePitch | null)[] {
  const result: (NotePitch | null)[] = new Array(notes.length).fill(null);

  let runStart = 0;
  while (runStart < notes.length) {
    const candidateSets: Candidate[][] = [];
    let end = runStart;

    while (end < notes.length) {
      const candidates = candidatesFor(
        notes[end].pitch,
        settings.tuning,
        settings.capo,
        settings.maxFret
      );
      if (candidates.length === 0) break;
      candidateSets.push(candidates);
      end++;
    }

    if (candidateSets.length > 0) {
      bestPath(candidateSets, notes.slice(runStart, end), settings)
        .forEach((candidate, offset) => {
          result[runStart + offset] = {
            kind: 'fretted',
            string: candidate.string,
            fret: candidate.fret
          };
        });
      runStart = end;
    } else {
      // notes[runStart] is unplayable; leave it null and move past it.
      runStart++;
    }
  }

  return result;
}
