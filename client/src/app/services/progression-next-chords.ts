import {
  ChordQuality,
  ChordShape,
  NamedQuality,
  degreeQuality,
  effectiveChord,
  isHeptatonic
} from './progression-harmony';

/**
 * Which chords conventionally follow a chord, in the key it is in.
 *
 * The tables below are data, checked entry by entry against harmony references
 * - see `docs/plans/2026-10-21-next-chord-hints-design.md`, section 2 and
 * Verification. Change a row there first.
 *
 * Every chord is written as a letter degree, its root's semitones above the
 * tonic, and a triad family. The `alter` a caller stores is worked out per key
 * from those, which is what lets one minor table serve aeolian, harmonic and
 * melodic minor: aeolian's leading-tone vii° is degree 6 raised a semitone,
 * harmonic minor's is degree 6 as it stands.
 */

/** A chord reduced to its triad: what a functional table is written in. */
export type TriadFamily = 'major' | 'minor' | 'diminished' | 'augmented';

/** The standard name of a motion from one chord to the next. */
export type MotionReason =
  | 'predominant-to-dominant'
  | 'dominant-to-tonic'
  | 'deceptive'
  | 'plagal'
  | 'double-plagal'
  | 'falling-fifth'
  | 'falling-third'
  | 'rising-step'
  | 'falling-step'
  | 'aeolian-cadence'
  | 'modal-cadence'
  | 'modal-signature'
  | 'secondary-dominant';

/** How each reason reads in the palette's caption. */
export const MOTION_REASON_TEXT: Readonly<Record<MotionReason, string>> = {
  'predominant-to-dominant': 'predominant to dominant',
  'dominant-to-tonic': 'dominant to tonic',
  deceptive: 'deceptive',
  plagal: 'plagal',
  'double-plagal': 'double plagal',
  'falling-fifth': 'falling fifth',
  'falling-third': 'falling third',
  'rising-step': 'rising step',
  'falling-step': 'falling step',
  'aeolian-cadence': 'aeolian cadence',
  'modal-cadence': 'modal cadence',
  'modal-signature': "the mode's signature chord",
  'secondary-dominant': 'secondary dominant'
};

/** One chord to try next: where it sits in this key, its triad, and why. */
export interface NextChordTarget {
  /** 0-6, the letter, as `ChordDegree.degree`. */
  degree: number;
  /** Semitones the root is displaced from the key's own degree. */
  alter: number;
  family: TriadFamily;
  reason: MotionReason;
}

export type NextChords =
  | { kind: 'targets'; targets: readonly NextChordTarget[] }
  /** The tonic of major or minor, which can go anywhere. */
  | { kind: 'any' }
  /** A chord the tables have no entry for. */
  | { kind: 'none' }
  /** A scale outside the tables. */
  | { kind: 'unsupported' };

/** A chord in a table: letter, root above the tonic, triad. */
interface Spot {
  degree: number;
  semitones: number;
  family: TriadFamily;
}

interface Motion {
  to: Spot;
  reason: MotionReason;
}

interface Row {
  from: Spot;
  next: readonly Motion[] | 'any';
}

interface HarmonyTable {
  /** Seven-note scales this table is for, as intervals. */
  scales: readonly (readonly number[])[];
  rows: readonly Row[];
  /** Chords from outside the key, looked up after `rows`. Ionian only. */
  borrowed: readonly Row[];
}

const FAMILY_OF: Readonly<Record<NamedQuality, TriadFamily>> = {
  major: 'major',
  major7: 'major',
  dominant7: 'major',
  major6: 'major',
  add9: 'major',
  minor: 'minor',
  minor7: 'minor',
  minorMajor7: 'minor',
  minor6: 'minor',
  minorAdd9: 'minor',
  diminished: 'diminished',
  halfDiminished7: 'diminished',
  diminished7: 'diminished',
  augmented: 'augmented',
  augmented7: 'augmented',
  augmentedMajor7: 'augmented'
};

/** A quality's triad, or null for a stack with no name. */
export function triadFamilyOf(quality: ChordQuality): TriadFamily | null {
  return quality === 'other' ? null : FAMILY_OF[quality];
}

/** The key's own triad on a degree. The scale must be seven notes. */
export function triadFamilyAt(scaleIntervals: readonly number[], degree: number): TriadFamily | null {
  return triadFamilyOf(degreeQuality(scaleIntervals, degree, 3));
}

function spot(degree: number, semitones: number, family: TriadFamily): Spot {
  return { degree, semitones, family };
}

function to(target: Spot, reason: MotionReason): Motion {
  return { to: target, reason };
}

// --- Major ------------------------------------------------------------------

const M_I = spot(0, 0, 'major');
const M_II = spot(1, 2, 'minor');
const M_III = spot(2, 4, 'minor');
const M_IV = spot(3, 5, 'major');
const M_V = spot(4, 7, 'major');
const M_VI = spot(5, 9, 'minor');
const M_VII = spot(6, 11, 'diminished');
const M_FLAT_II = spot(1, 1, 'major');
const M_FLAT_III = spot(2, 3, 'major');
const M_MINOR_IV = spot(3, 5, 'minor');
const M_FLAT_VI = spot(5, 8, 'major');
const M_FLAT_VII = spot(6, 10, 'major');

const MAJOR: HarmonyTable = {
  scales: [[0, 2, 4, 5, 7, 9, 11]],
  rows: [
    { from: M_I, next: 'any' },
    { from: M_II, next: [to(M_V, 'predominant-to-dominant'), to(M_VII, 'predominant-to-dominant')] },
    { from: M_III, next: [to(M_VI, 'falling-fifth'), to(M_IV, 'rising-step')] },
    {
      from: M_IV,
      next: [
        to(M_V, 'predominant-to-dominant'),
        to(M_VII, 'predominant-to-dominant'),
        to(M_II, 'falling-third'),
        to(M_I, 'plagal')
      ]
    },
    { from: M_V, next: [to(M_I, 'dominant-to-tonic'), to(M_VI, 'deceptive')] },
    { from: M_VI, next: [to(M_II, 'falling-fifth'), to(M_IV, 'falling-third'), to(M_V, 'falling-step')] },
    { from: M_VII, next: [to(M_I, 'dominant-to-tonic')] }
  ],
  borrowed: [
    { from: M_FLAT_II, next: [to(M_V, 'predominant-to-dominant')] },
    { from: M_FLAT_III, next: [to(M_FLAT_VI, 'falling-fifth'), to(M_IV, 'rising-step')] },
    { from: M_MINOR_IV, next: [to(M_V, 'predominant-to-dominant'), to(M_I, 'plagal')] },
    {
      from: M_FLAT_VI,
      next: [to(M_FLAT_VII, 'rising-step'), to(M_V, 'predominant-to-dominant'), to(M_MINOR_IV, 'falling-third')]
    },
    { from: M_FLAT_VII, next: [to(M_I, 'modal-cadence'), to(M_IV, 'double-plagal')] }
  ]
};

// --- Minor ------------------------------------------------------------------

const N_I = spot(0, 0, 'minor');
const N_II = spot(1, 2, 'diminished');
const N_NEAPOLITAN = spot(1, 1, 'major');
const N_III = spot(2, 3, 'major');
const N_IV = spot(3, 5, 'minor');
const N_V = spot(4, 7, 'major');
const N_MINOR_V = spot(4, 7, 'minor');
const N_VI = spot(5, 8, 'major');
const N_VII = spot(6, 10, 'major');
const N_LEADING_VII = spot(6, 11, 'diminished');

const MINOR: HarmonyTable = {
  scales: [
    [0, 2, 3, 5, 7, 8, 10],
    [0, 2, 3, 5, 7, 8, 11],
    [0, 2, 3, 5, 7, 9, 11]
  ],
  rows: [
    { from: N_I, next: 'any' },
    { from: N_II, next: [to(N_V, 'predominant-to-dominant'), to(N_LEADING_VII, 'predominant-to-dominant')] },
    { from: N_NEAPOLITAN, next: [to(N_V, 'predominant-to-dominant')] },
    { from: N_III, next: [to(N_VI, 'falling-fifth'), to(N_IV, 'rising-step')] },
    {
      from: N_IV,
      next: [
        to(N_V, 'predominant-to-dominant'),
        to(N_LEADING_VII, 'predominant-to-dominant'),
        to(N_II, 'falling-third'),
        to(N_I, 'plagal')
      ]
    },
    { from: N_V, next: [to(N_I, 'dominant-to-tonic'), to(N_VI, 'deceptive')] },
    { from: N_MINOR_V, next: [to(N_VI, 'rising-step'), to(N_IV, 'falling-step')] },
    {
      from: N_VI,
      next: [to(N_II, 'falling-fifth'), to(N_IV, 'falling-third'), to(N_V, 'predominant-to-dominant')]
    },
    { from: N_VII, next: [to(N_III, 'falling-fifth'), to(N_I, 'aeolian-cadence')] },
    { from: N_LEADING_VII, next: [to(N_I, 'dominant-to-tonic')] }
  ],
  borrowed: []
};

// --- Church modes -------------------------------------------------------------

/** A mode's tonic hints its signature chord, and the signature chord returns. */
function modalCadence(
  intervals: readonly number[],
  tonic: Spot,
  signatures: readonly Spot[]
): HarmonyTable {
  return {
    scales: [intervals],
    rows: [
      { from: tonic, next: [to(signatures[0], 'modal-signature')] },
      ...signatures.map(signature => ({ from: signature, next: [to(tonic, 'modal-cadence')] }))
    ],
    borrowed: []
  };
}

const DORIAN = modalCadence([0, 2, 3, 5, 7, 9, 10], spot(0, 0, 'minor'), [spot(3, 5, 'major')]);
const PHRYGIAN = modalCadence([0, 1, 3, 5, 7, 8, 10], spot(0, 0, 'minor'), [spot(1, 1, 'major')]);
const LYDIAN = modalCadence([0, 2, 4, 6, 7, 9, 11], spot(0, 0, 'major'), [spot(1, 2, 'major')]);
const MIXOLYDIAN = modalCadence([0, 2, 4, 5, 7, 9, 10], spot(0, 0, 'major'), [
  spot(6, 10, 'major'),
  spot(4, 7, 'minor')
]);

const TABLES: readonly HarmonyTable[] = deepFreeze([MAJOR, MINOR, DORIAN, PHRYGIAN, LYDIAN, MIXOLYDIAN]);

// --- Lookup -------------------------------------------------------------------

const ANY: NextChords = { kind: 'any' };
const NONE: NextChords = { kind: 'none' };
const UNSUPPORTED: NextChords = { kind: 'unsupported' };

/** A perfect fifth, in semitones and in letters. */
const FIFTH_SEMITONES = 7;
const FIFTH_STEPS = 4;

/**
 * What conventionally follows the selected chord, in this key.
 *
 * Named for what it returns: the palette marks the answer's targets and the
 * songwriting Chords tab can call it unchanged once S1 has landed.
 */
export function likelyNextDegrees(scaleIntervals: readonly number[], selected: ChordShape): NextChords {
  const table = tableFor(scaleIntervals);
  if (!table) return UNSUPPORTED;

  // The identity the strip card and the fretboard read, so the hint is about
  // the chord that sounds rather than the fields that were stored.
  const chord = effectiveChord(scaleIntervals, selected);
  const family = triadFamilyOf(chord.base);
  if (family === null) return NONE;

  const at = spot(selected.degree, chord.root, family);
  const own = isOwnChord(scaleIntervals, at);
  const row =
    findRow(table.rows, at, false) ??
    (own ? findRow(table.rows, at, true) : undefined) ??
    findRow(table.borrowed, at, false);

  if (row) return row.next === 'any' ? ANY : { kind: 'targets', targets: targetsFor(row.next, scaleIntervals) };

  const resolution = own ? null : secondaryResolution(scaleIntervals, at);
  return resolution ? { kind: 'targets', targets: [resolution] } : NONE;
}

function tableFor(scaleIntervals: readonly number[]): HarmonyTable | undefined {
  if (!isHeptatonic(scaleIntervals)) return undefined;
  return TABLES.find(table => table.scales.some(scale => sameIntervals(scale, scaleIntervals)));
}

function sameIntervals(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

/**
 * The row for a chord. `anyFamily` is the second pass, for the key's own chord
 * on a row's root whose quality the row does not name: harmonic minor's III+ on
 * the III row, melodic minor's IV on the iv row.
 */
function findRow(rows: readonly Row[], at: Spot, anyFamily: boolean): Row | undefined {
  return rows.find(
    row =>
      row.from.degree === at.degree &&
      row.from.semitones === at.semitones &&
      (anyFamily || row.from.family === at.family)
  );
}

function isOwnChord(scaleIntervals: readonly number[], at: Spot): boolean {
  return (
    scaleIntervals[at.degree] === at.semitones && triadFamilyAt(scaleIntervals, at.degree) === at.family
  );
}

function targetsFor(motions: readonly Motion[], scaleIntervals: readonly number[]): NextChordTarget[] {
  return motions.map(motion => ({
    degree: motion.to.degree,
    alter: nearestAlter(motion.to.semitones - scaleIntervals[motion.to.degree]),
    family: motion.to.family,
    reason: motion.reason
  }));
}

/**
 * A chromatic major chord a fifth above a degree with a major or minor triad
 * is that degree's dominant, and resolves to it. The letter has to agree too -
 * the dominant of degree d is written on degree d + 4, the rule
 * `chordVocabulary`'s Secondary row is built on.
 */
function secondaryResolution(scaleIntervals: readonly number[], at: Spot): NextChordTarget | null {
  if (at.family !== 'major') return null;

  for (let target = 0; target < scaleIntervals.length; target++) {
    const family = triadFamilyAt(scaleIntervals, target);
    if (family !== 'major' && family !== 'minor') continue;
    if ((target + FIFTH_STEPS) % scaleIntervals.length !== at.degree) continue;
    if ((scaleIntervals[target] + FIFTH_SEMITONES) % 12 !== at.semitones) continue;

    return {
      degree: target,
      alter: 0,
      family,
      reason: target === 0 ? 'dominant-to-tonic' : 'secondary-dominant'
    };
  }

  return null;
}

/** A displacement read as the nearer of its two representatives, -6..5. */
function nearestAlter(semitones: number): number {
  return ((((semitones + 6) % 12) + 12) % 12) - 6;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) deepFreeze(inner);
  }
  return value;
}
