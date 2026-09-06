import { NotePitch } from '../models/composer.model';
import { DerivationSettings } from '../models/transcription.model';

/**
 * Chooses where on the neck each note is played.
 *
 * The one idea here is that a hand movement costs what the time available
 * makes it cost: a five-fret shift is cheap across a rest and unacceptable
 * between two sixteenths. Per-note lowest-fret assignment cannot express
 * that, which is why tab from such tools skitters across the neck on fast
 * passages. Scoring whole paths with a Viterbi pass can.
 *
 * Cheap, though, is not free. The time factor is clamped at both ends, and
 * the floor means a five-fret shift still costs 0.5 however long the rest -
 * an earlier draft of this docblock said free, and it was wrong.
 *
 * What the model does not have is a hand position. Movement is measured from
 * the previous note's fret, so a figure that sits still under one hand is
 * charged for every finger that moves within it, and where the hand sits on
 * the neck is only weakly pinned. The plan's "Deliberately not in M1" records
 * the measurement.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the costs can be checked against fixtures
 * chosen to separate the fast answer from the slow one.
 */

export interface FingeringInput {
  /** MIDI pitch. */
  pitch: number;
  onsetSec: number;
  /**
   * Where the onset sits on the beat grid, in denominator-unit beats, exactly
   * as `score-derivation.ts` will place it.
   *
   * Carried alongside the seconds because the two are used for different
   * things and neither substitutes for the other. Movement cost is a fact
   * about hands and stays in seconds; what counts as one attack is a fact
   * about the grid the bar will be written on, and has to be measured in the
   * units `transcription-quantize.ts` measures it in - see
   * `separateSimultaneous`.
   */
  beatPosition: number;
}

export interface Candidate {
  /**
   * Index into the tuning array, so 0 is the highest string.
   *
   * Deliberately not the string number a ScoreDoc carries, which is 1-based:
   * this is a subscript, and every use of it inside this module is a lookup.
   * `assignFingering` converts at the point it emits a `NotePitch`, and that
   * is the only place the two conventions meet.
   */
  string: number;
  fret: number;
}

/**
 * Movement is judged against a quarter note at 120 BPM. A gap shorter than
 * this makes shifting proportionally more expensive, a longer gap cheaper.
 *
 * Both clamps bind well outside ordinary playing. The ceiling engages below
 * `MOVE_REFERENCE_SEC / MAX_TIME_FACTOR`, about 31 ms, which in practice
 * means chords and a detector reporting one attack twice rather than notes in
 * sequence - there is no travel to charge for between two notes struck
 * together, and without the ceiling the model charges for it anyway. The
 * floor engages above 2.5 s, so it is a fact about long rests: past that
 * point more time buys nothing, and a five-fret shift settles at 0.5.
 */
const MOVE_REFERENCE_SEC = 0.25;
const MIN_TIME_FACTOR = 0.1;
const MAX_TIME_FACTOR = 8;

const MOVE_WEIGHT = 1.0;
const STRING_CHANGE_WEIGHT = 0.8;
const FRET_HEIGHT_WEIGHT = 0.15;
const OPEN_STRING_BONUS = 1.5;
const POSITION_HINT_WEIGHT = 0.5;

/**
 * An open string buys travel time but does not make a leap free.
 *
 * Charging nothing does not merely permit a leap across an open string, it
 * *attracts* the optimiser to positions it would never otherwise pick - and it
 * composes, so an alternating fretted/open figure buys unlimited free travel.
 * E1, A1, D2 and G2 are among the most common roots in basslines, so that is
 * reachable on ordinary material rather than a contrived fixture.
 */
const OPEN_STRING_MOVE_DISCOUNT = 0.25;

/**
 * Longest neck this pipeline will describe, in frets.
 *
 * Past any real instrument - a 27-fret Ibanez is the extreme - and the point is
 * not to police lutherie but to keep the fret domain a domain: `candidatesFor`
 * offers one candidate per string per pitch, and `nodeCost` scales linearly
 * with the fret number, so an absurd neck is slow rather than wrong. The number
 * matches the `max` the review panel's control carries, which is decoration on
 * top of this rather than a second bound.
 */
export const MAX_FRET_LIMIT = 36;

/**
 * Fewest frets that may sit in front of the capo.
 *
 * Four, because that is where `correctOctaves` and `candidatesFor` stop
 * agreeing. The fold works on one interval - lowest open string to highest
 * fret - while each string reaches only `maxFret - capo` frets, and adjacent
 * strings on a bass or a guitar are five semitones apart. At a reach of four
 * the per-string bands still meet; at three they leave a gap, and a pitch
 * folded into that gap is admitted by the fold and then found unplayable, so
 * the note vanishes with `unplayable` as the only account of it.
 *
 * `score-derivation.ts` recorded that disagreement and dismissed it as
 * unreachable, which was true of the tuning presets and false of `maxFret` and
 * `capo`, both of which the user types. At a reach of zero - capo 12 with
 * maxFret 12, both inside the spinner's own range - nothing but open strings is
 * playable and the score collapses to a bar of rests.
 */
export const MIN_REACH_FRETS = 4;

/**
 * Why these settings do not describe a playable neck, or null when they do.
 *
 * The companion to `barGridFault`, asked of the settings this module consumes
 * rather than of the meter. Same reason it exists: `capo`, `maxFret` and
 * `positionHint` are live knobs, so a caller holding a working score needs to
 * find out that a change is impossible before it destroys one, and an HTML
 * `min`/`max` does not stop a typed or pasted value.
 *
 * The three are checked together because two of them only mean anything as a
 * pair: `maxFret - capo` is the neck the player actually has, and neither
 * number is wrong on its own.
 *
 * `positionHint` is deliberately *not* tied to `maxFret - capo`. It is a
 * preference rather than a constraint - `nodeCost` charges distance from it and
 * a hint past the last fret merely pins the hand at the top - so coupling them
 * would refuse a legitimate `maxFret` reduction because of a hint set earlier,
 * which is a worse outcome than an inert hint. What it cannot be is unbounded:
 * at 1000 the hint term is `0.5 * 1000` against movement costs in single
 * figures, so the Viterbi pass degenerates into "pick the highest fret" with
 * nothing on screen to say why.
 */
export function fretboardFault(settings: DerivationSettings): string | null {
  const { capo, maxFret, positionHint } = settings;

  if (!Number.isInteger(capo) || capo < 0) {
    return `capo ${capo} is not a whole number of frets`;
  }

  if (!Number.isInteger(maxFret) || maxFret < 1) {
    return `maxFret ${maxFret} is not a whole number of frets`;
  }

  if (maxFret > MAX_FRET_LIMIT) {
    return `maxFret ${maxFret} is longer than any neck this can write (${MAX_FRET_LIMIT})`;
  }

  if (maxFret - capo < MIN_REACH_FRETS) {
    return (
      `a capo at ${capo} leaves ${maxFret - capo} fret${maxFret - capo === 1 ? '' : 's'} ` +
      `of a ${maxFret}-fret neck, and ${MIN_REACH_FRETS} is the fewest that can be played`
    );
  }

  if (positionHint !== null) {
    if (!Number.isInteger(positionHint) || positionHint < 0) {
      return `position hint ${positionHint} is not a fret number`;
    }

    if (positionHint > MAX_FRET_LIMIT) {
      return `position hint ${positionHint} is past the last fret this can write (${MAX_FRET_LIMIT})`;
    }
  }

  return null;
}

/**
 * Every string/fret pair that sounds `pitch` on this instrument.
 *
 * Frets are relative to the capo, the way tab writes them, so a capo at 5
 * leaves `maxFret - capo` frets in front of it rather than `maxFret`. Bounding
 * a capo-relative fret by `maxFret` would let the capo lengthen the neck: on a
 * 24-fret bass capoed at 5, MIDI 57 would be offered at relative fret 24,
 * which is absolute fret 29.
 */
export function candidatesFor(
  pitch: number,
  tuning: number[],
  capo: number,
  maxFret: number
): Candidate[] {
  const out: Candidate[] = [];
  const reach = maxFret - capo;

  for (let string = 0; string < tuning.length; string++) {
    const fret = pitch - tuning[string] - capo;
    if (fret >= 0 && fret <= reach) out.push({ string, fret });
  }

  return out;
}

/** Cost of a position considered on its own, ignoring neighbours. */
function nodeCost(candidate: Candidate, settings: DerivationSettings): number {
  let cost = FRET_HEIGHT_WEIGHT * candidate.fret;

  // Open strings are free to play and idiomatic, so they earn a bonus rather
  // than merely avoiding a penalty.
  if (candidate.fret === 0) cost -= OPEN_STRING_BONUS;

  // An open string has no fret to be in the wrong position, so the hint skips
  // it - and with the bonus on top, no hint can pull the hand off one. Pinning
  // a hand to the twelfth fret does not make an open E worth stopping.
  if (settings.positionHint !== null && candidate.fret > 0) {
    cost += POSITION_HINT_WEIGHT * Math.abs(candidate.fret - settings.positionHint);
  }

  return cost;
}

/** Cost of moving from one position to the next, given the time available. */
function edgeCost(from: Candidate, to: Candidate, gapSec: number): number {
  // An open string needs no fretting precision and leaves the hand free to
  // travel while it rings, so a shift on either side of one is cheaper - but
  // the hand still has to cover the distance, so it is discounted, not free.
  const distance = Math.abs(to.fret - from.fret);
  const move = from.fret === 0 || to.fret === 0
    ? distance * OPEN_STRING_MOVE_DISCOUNT
    : distance;

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
 * Moves notes struck together off each other's strings.
 *
 * `bestPath` scores a sequence and has no concept of two notes sounding at
 * once, so it will finger a dyad twice on one string wherever that is the
 * cheapest path - on a bass, for about one simultaneous pitch pair in nine.
 * That is worse than merely invalid tab. A tab line holds one number, so
 * `transcription-quantize.ts` drops a pitch whose string is already spoken
 * for, and the second note leaves the score with no signal at all.
 *
 * A chord-aware Viterbi is the real answer and is deliberately not in M1, so
 * this is a bounded repair on the result instead: within one attack the note
 * already sitting cheapest keeps its string, and the others take their
 * next-cheapest candidate on a string nobody else in the attack holds.
 * Ranking by `nodeCost` rather than anything new keeps the repair speaking the
 * same language as the path it is repairing.
 *
 * Where no free candidate exists the collision stands. A minor second on the
 * bottom string of a bass has nowhere else to go, and losing one of the two
 * notes is then the honest outcome rather than a bug.
 *
 * What counts as one attack is not this module's judgement to make. Safety
 * runs one way only - everything `snapToSlots` will merge must already have
 * been moved apart here, or `addToChord` deletes a pitch with nothing left to
 * show it was struck - so `attackWindowBeats` is the merge window itself,
 * read off `chordToleranceBeats` and handed across by `score-derivation.ts`.
 * Sizing it here instead, as an independent 30 ms constant, is what opened the
 * band of separations wide enough to merge and too wide to separate: measured
 * on the assembled pipeline it swallowed a note at 35-125 ms apart at 60 BPM,
 * and the band moved with the tempo because one window was in seconds and the
 * other in beats.
 *
 * A window wider than the merge window only ever costs tab quality - two notes
 * given distinct strings that the bar was going to write on separate slots
 * anyway - so erring wide is safe and erring narrow deletes notes.
 *
 * Mutates `chosen` in place. Requires `notes` in ascending `onsetSec`, and
 * `beatPosition` ascending with it.
 */
function separateSimultaneous(
  chosen: (Candidate | null)[],
  notes: FingeringInput[],
  settings: DerivationSettings,
  attackWindowBeats: number
): void {
  let start = 0;

  while (start < notes.length) {
    // Measured from the attack's first onset rather than its last, so a run of
    // closely spaced notes cannot chain into one arbitrarily long attack. The
    // same rule `snapToSlots` uses to cluster onsets into chords, on the same
    // quantity, so the two passes group identically.
    let end = start + 1;
    while (
      end < notes.length
      && notes[end].beatPosition - notes[start].beatPosition <= attackWindowBeats
    ) {
      end++;
    }

    if (end - start > 1) separateAttack(chosen, notes, settings, start, end);
    start = end;
  }
}

/** One attack's worth of `separateSimultaneous`, over `chosen[start..end)`. */
function separateAttack(
  chosen: (Candidate | null)[],
  notes: FingeringInput[],
  settings: DerivationSettings,
  start: number,
  end: number
): void {
  const options = new Map<number, Candidate[]>();
  for (let i = start; i < end; i++) {
    if (chosen[i] === null) continue;
    options.set(
      i,
      candidatesFor(notes[i].pitch, settings.tuning, settings.capo, settings.maxFret)
    );
  }

  // Fewest options claims its string first, then cheapest position. Cost order
  // alone is not enough: the top of a bass's range lives on one string only,
  // and letting an open string it collides with claim that string first strands
  // it on a collision it had a way out of. Whichever note ends up moving, it is
  // the one with somewhere to move to.
  //
  // Every non-null assertion in this function reads from `options` or `chosen`
  // at an index that came out of `options.keys()`, and the loop above puts an
  // index in `options` only after testing `chosen[i] !== null`. So both lookups
  // are populated by construction, and neither is a guess about the caller.
  const placed = [...options.keys()].sort((a, b) =>
    options.get(a)!.length - options.get(b)!.length
    || nodeCost(chosen[a]!, settings) - nodeCost(chosen[b]!, settings)
  );

  const taken = new Set<number>();
  for (const index of placed) {
    const current = chosen[index]!;
    if (!taken.has(current.string)) {
      taken.add(current.string);
      continue;
    }

    const free = options.get(index)!.filter(candidate => !taken.has(candidate.string));

    if (free.length === 0) continue;

    const replacement = free.reduce((best, candidate) =>
      nodeCost(candidate, settings) < nodeCost(best, settings) ? candidate : best
    );

    chosen[index] = replacement;
    taken.add(replacement.string);
  }
}

/**
 * Chooses a string and fret for every note, minimising total playing effort.
 *
 * The interesting term is movement cost scaled by the gap to the previous
 * note. A five-fret shift is cheap across a rest and unacceptable between two
 * sixteenths, which is exactly the judgement a player makes and exactly what
 * per-note lowest-fret assignment cannot express. Cheap, not free: the time
 * factor's floor leaves that shift costing 0.5 however long the rest.
 *
 * `notes` must be in ascending `onsetSec`. Gaps are read pairwise and clamped
 * at zero, so an out-of-order note is scored as though struck with the one
 * before it, and `separateSimultaneous` groups on the same assumption.
 *
 * `attackWindowBeats` is how far apart two onsets may sit and still be one
 * attack, in the denominator-unit beats `FingeringInput.beatPosition` carries.
 * It belongs to the bar the notes will be written into rather than to this
 * module, so callers pass `chordToleranceBeats` from
 * `transcription-quantize.ts`; see `separateSimultaneous` for why a window
 * narrower than that one loses notes outright.
 *
 * Returns null at any index the instrument cannot play. Such a note breaks the
 * chain, and the notes after it are optimised as a fresh run.
 *
 * The returned `NotePitch.string` is 1-based, the tab convention a ScoreDoc
 * uses: string 1 is `StaffDoc.tuning[0]`, the highest-pitched string. Internal
 * `Candidate.string` values are 0-based tuning subscripts, so this function is
 * where the two conventions meet. Emitting the subscript unconverted is not a
 * cosmetic error - `ScoreDocMapperService.flipString` counts from the other
 * end, so an off-by-one there moves every note to a different string.
 */
export function assignFingering(
  notes: FingeringInput[],
  settings: DerivationSettings,
  attackWindowBeats: number
): (NotePitch | null)[] {
  const chosen: (Candidate | null)[] = new Array(notes.length).fill(null);

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
          chosen[runStart + offset] = candidate;
        });
      runStart = end;
    } else {
      // notes[runStart] is unplayable; leave it null and move past it.
      runStart++;
    }
  }

  // Runs are optimised as sequences, so two notes struck together can come out
  // on one string; the repair spans runs because an unplayable note between
  // them does not stop them sounding at the same moment.
  separateSimultaneous(chosen, notes, settings, attackWindowBeats);

  return chosen.map(candidate =>
    candidate === null
      ? null
      // Tuning subscript to tab string number; see the docblock.
      : { kind: 'fretted', string: candidate.string + 1, fret: candidate.fret }
  );
}
