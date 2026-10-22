# Next-Chord Hints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** With a chord selected on `/progression`, the chord palette marks the chords that conventionally follow it and
a caption names the motion - behind a `Suggest next` toggle that starts on.

**Architecture:** A pure module, `services/progression-next-chords.ts`, holds the harmony tables as frozen data and
answers `likelyNextDegrees(scaleIntervals, selected)`. A pure palette view module,
`chord-palette-hints-view.ts`, matches its answer to buttons and writes the caption. `ProgressionService` gains a
`BehaviorSubject<boolean>` for the toggle; the palette combines it with the state it already reads and adds a mark, a
caption region and a toggle to its template.

**Tech Stack:** Angular 21 standalone components (OnPush), RxJS 7.8, Jasmine/Karma.

**Design doc:** `docs/plans/2026-10-21-next-chord-hints-design.md` - read it first. Section 2 is the source of truth for
every table entry; this plan copies it into code.

**Test command used throughout** (from `client/`):
```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-next-chords.spec.ts'
```
Swap the `--include` glob for the spec a task names. Drop `--include` to run everything.

---

## Background you need

- **Intervals are semitones from the tonic**, `[0, 2, 4, 5, 7, 9, 11]` for major; a degree is an index 0-6 into them.
  `alter` displaces a degree's root: in C aeolian `[0,2,3,5,7,8,10]`, degree 6 is B♭ (10) and degree 6 with alter +1
  is B♮ (11). See `CLAUDE.md` for the project's conventions.
- **`effectiveChord(intervals, shape)`** in `services/progression-harmony.ts` is the one place a stored chord becomes
  what it sounds. Its result's `root` is the root's semitones above the tonic (0-11) and `base` is its quality *without*
  any suspension. The strip card and the fretboard read it; this feature must too. It throws on a scale that is not
  seven notes, so check the scale before calling it.
- **`degreeQuality(intervals, degree, 3)`** is the key's own triad on a degree.
- **`chordVocabulary`** (`services/progression-vocabulary.ts`) builds the palette's Borrowed and Secondary rows. Read
  its `BORROWINGS` docstring: in a minor key the Borrowed row is where the major `V` and the raised `♮vii°` live.
- **`describeSlot`** (`components/progression/components/progression-strip/progression-strip-cards.ts`) names a slot
  exactly as the strip card does: `numeral`, `name`, and `subject` (the spoken name). The caption uses it, so the
  caption and the card cannot disagree about the selected chord.
- **The palette's style of comments.** This codebase documents *why*, at length, in docstrings. Match the density of
  the files you touch; the code below carries short versions, which you should keep and may extend.
- **Files are capped at 1000 lines** (`CLAUDE.md`). `chord-palette.component.ts` is at 856 and its main spec at 895, so
  the component change is kept small and its tests go in a new spec file.

---

## Task 1: The tables and `likelyNextDegrees`

**Files:**
- Create: `client/src/app/services/progression-next-chords.ts`
- Test: `client/src/app/services/progression-next-chords.spec.ts`

**Step 1: Write the failing test**

```typescript
import { createExtensions } from '../models/progression-normalize';
import { deepFrozen } from './deep-frozen.spec-helper';
import { ChordExtent, ChordQuality, ChordShape } from './progression-harmony';
import {
  MotionReason,
  NextChordTarget,
  TriadFamily,
  likelyNextDegrees,
  triadFamilyAt,
  triadFamilyOf
} from './progression-next-chords';

/**
 * The next-chord tables, checked row by row against the design doc's section 2,
 * which is where each entry was checked against harmony references. A wrong row
 * here teaches something false, so every row is written out rather than swept.
 */
describe('likelyNextDegrees', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
  const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
  const DORIAN = [0, 2, 3, 5, 7, 9, 10];
  const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
  const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
  const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
  const HUNGARIAN_MINOR = [0, 2, 3, 6, 7, 8, 11];
  const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

  function shape(
    degree: number,
    alter = 0,
    quality: ChordQuality | null = null,
    extent: ChordExtent = 3
  ): ChordShape {
    return { degree, alter, quality, extent, suspension: 'none', extensions: createExtensions() };
  }

  function t(degree: number, alter: number, family: TriadFamily, reason: MotionReason): NextChordTarget {
    return { degree, alter, family, reason };
  }

  function targetsOf(intervals: readonly number[], selected: ChordShape): readonly NextChordTarget[] {
    const next = likelyNextDegrees(intervals, selected);
    if (next.kind !== 'targets') throw new Error(`expected targets, got ${next.kind}`);
    return next.targets;
  }

  describe('major (ionian)', () => {
    it('lets the tonic go anywhere', () => {
      expect(likelyNextDegrees(IONIAN, shape(0)).kind).toBe('any');
    });

    it('ii -> V, vii°', () => {
      expect(targetsOf(IONIAN, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('iii -> vi, IV', () => {
      expect(targetsOf(IONIAN, shape(2))).toEqual([
        t(5, 0, 'minor', 'falling-fifth'),
        t(3, 0, 'major', 'rising-step')
      ]);
    });

    it('IV -> V, vii°, ii, I', () => {
      expect(targetsOf(IONIAN, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'minor', 'falling-third'),
        t(0, 0, 'major', 'plagal')
      ]);
    });

    it('V -> I, vi', () => {
      expect(targetsOf(IONIAN, shape(4))).toEqual([
        t(0, 0, 'major', 'dominant-to-tonic'),
        t(5, 0, 'minor', 'deceptive')
      ]);
    });

    it('vi -> ii, IV, V', () => {
      expect(targetsOf(IONIAN, shape(5))).toEqual([
        t(1, 0, 'minor', 'falling-fifth'),
        t(3, 0, 'major', 'falling-third'),
        t(4, 0, 'major', 'falling-step')
      ]);
    });

    it('vii° -> I', () => {
      expect(targetsOf(IONIAN, shape(6))).toEqual([t(0, 0, 'major', 'dominant-to-tonic')]);
    });
  });

  describe('borrowed chords in a major key', () => {
    it('♭II -> V', () => {
      expect(targetsOf(IONIAN, shape(1, -1, 'major'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('♭III -> ♭VI, IV', () => {
      expect(targetsOf(IONIAN, shape(2, -1, 'major'))).toEqual([
        t(5, -1, 'major', 'falling-fifth'),
        t(3, 0, 'major', 'rising-step')
      ]);
    });

    it('iv -> V, I', () => {
      expect(targetsOf(IONIAN, shape(3, 0, 'minor'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(0, 0, 'major', 'plagal')
      ]);
    });

    it('♭VI -> ♭VII, V, iv', () => {
      expect(targetsOf(IONIAN, shape(5, -1, 'major'))).toEqual([
        t(6, -1, 'major', 'rising-step'),
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(3, 0, 'minor', 'falling-third')
      ]);
    });

    it('♭VII -> I, IV', () => {
      expect(targetsOf(IONIAN, shape(6, -1, 'major'))).toEqual([
        t(0, 0, 'major', 'modal-cadence'),
        t(3, 0, 'major', 'double-plagal')
      ]);
    });

    it('applies in ionian only: dorian\'s ♭VI has no row', () => {
      expect(likelyNextDegrees(DORIAN, shape(5, -1, 'major')).kind).toBe('none');
    });
  });

  describe('minor (aeolian)', () => {
    it('lets the tonic go anywhere', () => {
      expect(likelyNextDegrees(AEOLIAN, shape(0)).kind).toBe('any');
    });

    it('ii° -> V, vii° - the major V and the raised vii°', () => {
      expect(targetsOf(AEOLIAN, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 1, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('♭II (Neapolitan) -> V', () => {
      expect(targetsOf(AEOLIAN, shape(1, -1, 'major'))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('III -> VI, iv', () => {
      expect(targetsOf(AEOLIAN, shape(2))).toEqual([
        t(5, 0, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('iv -> V, vii°, ii°, i', () => {
      expect(targetsOf(AEOLIAN, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 1, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'diminished', 'falling-third'),
        t(0, 0, 'minor', 'plagal')
      ]);
    });

    it('V (the borrowed major dominant) -> i, VI', () => {
      expect(targetsOf(AEOLIAN, shape(4, 0, 'major'))).toEqual([
        t(0, 0, 'minor', 'dominant-to-tonic'),
        t(5, 0, 'major', 'deceptive')
      ]);
    });

    it('v (the key\'s own minor dominant) -> VI, iv', () => {
      expect(targetsOf(AEOLIAN, shape(4))).toEqual([
        t(5, 0, 'major', 'rising-step'),
        t(3, 0, 'minor', 'falling-step')
      ]);
    });

    it('VI -> ii°, iv, V', () => {
      expect(targetsOf(AEOLIAN, shape(5))).toEqual([
        t(1, 0, 'diminished', 'falling-fifth'),
        t(3, 0, 'minor', 'falling-third'),
        t(4, 0, 'major', 'predominant-to-dominant')
      ]);
    });

    it('VII -> III, i', () => {
      expect(targetsOf(AEOLIAN, shape(6))).toEqual([
        t(2, 0, 'major', 'falling-fifth'),
        t(0, 0, 'minor', 'aeolian-cadence')
      ]);
    });

    it('vii° (raised) -> i', () => {
      expect(targetsOf(AEOLIAN, shape(6, 1, 'diminished'))).toEqual([
        t(0, 0, 'minor', 'dominant-to-tonic')
      ]);
    });
  });

  describe('the minor table in the other two minor forms', () => {
    it('harmonic minor: vii° is the key\'s own, so its alter is 0', () => {
      expect(targetsOf(HARMONIC_MINOR, shape(1))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant')
      ]);
    });

    it('harmonic minor: VII is a lowered seventh, alter -1', () => {
      // VII is a target nowhere in the table except as a source, so check it
      // as a source: the lowered VII still finds its row.
      expect(targetsOf(HARMONIC_MINOR, shape(6, -1, 'major'))).toEqual([
        t(2, 0, 'major', 'falling-fifth'),
        t(0, 0, 'minor', 'aeolian-cadence')
      ]);
    });

    it('harmonic minor: the key\'s own III+ uses the III row', () => {
      expect(targetsOf(HARMONIC_MINOR, shape(2))).toEqual([
        t(5, 0, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('melodic minor: the key\'s own IV uses the iv row, and VI is lowered', () => {
      expect(targetsOf(MELODIC_MINOR, shape(3))).toEqual([
        t(4, 0, 'major', 'predominant-to-dominant'),
        t(6, 0, 'diminished', 'predominant-to-dominant'),
        t(1, 0, 'diminished', 'falling-third'),
        t(0, 0, 'minor', 'plagal')
      ]);
      expect(targetsOf(MELODIC_MINOR, shape(2))).toEqual([
        t(5, -1, 'major', 'falling-fifth'),
        t(3, 0, 'minor', 'rising-step')
      ]);
    });

    it('melodic minor: vi° has no row', () => {
      expect(likelyNextDegrees(MELODIC_MINOR, shape(5)).kind).toBe('none');
    });
  });

  describe('church modes', () => {
    it('dorian: i -> IV, IV -> i', () => {
      expect(targetsOf(DORIAN, shape(0))).toEqual([t(3, 0, 'major', 'modal-signature')]);
      expect(targetsOf(DORIAN, shape(3))).toEqual([t(0, 0, 'minor', 'modal-cadence')]);
    });

    it('phrygian: i -> ♭II, ♭II -> i', () => {
      expect(targetsOf(PHRYGIAN, shape(0))).toEqual([t(1, 0, 'major', 'modal-signature')]);
      expect(targetsOf(PHRYGIAN, shape(1))).toEqual([t(0, 0, 'minor', 'modal-cadence')]);
    });

    it('lydian: I -> II, II -> I', () => {
      expect(targetsOf(LYDIAN, shape(0))).toEqual([t(1, 0, 'major', 'modal-signature')]);
      expect(targetsOf(LYDIAN, shape(1))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
    });

    it('mixolydian: I -> ♭VII, ♭VII -> I, v -> I', () => {
      expect(targetsOf(MIXOLYDIAN, shape(0))).toEqual([t(6, 0, 'major', 'modal-signature')]);
      expect(targetsOf(MIXOLYDIAN, shape(6))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
      expect(targetsOf(MIXOLYDIAN, shape(4))).toEqual([t(0, 0, 'major', 'modal-cadence')]);
    });

    it('gives every other chord in a mode no hint', () => {
      expect(likelyNextDegrees(DORIAN, shape(1)).kind).toBe('none');
    });
  });

  describe('secondary dominants', () => {
    it('D major in C is V/V and hints V', () => {
      expect(targetsOf(IONIAN, shape(1, 0, 'major'))).toEqual([
        t(4, 0, 'major', 'secondary-dominant')
      ]);
    });

    it('E7 in C is V/vi and hints vi', () => {
      expect(targetsOf(IONIAN, shape(2, 0, 'dominant7', 7))).toEqual([
        t(5, 0, 'minor', 'secondary-dominant')
      ]);
    });

    it('a major I in aeolian is V/iv', () => {
      expect(targetsOf(AEOLIAN, shape(0, 0, 'major'))).toEqual([
        t(3, 0, 'minor', 'secondary-dominant')
      ]);
    });

    it('a major V in mixolydian resolves to the tonic, named as such', () => {
      expect(targetsOf(MIXOLYDIAN, shape(4, 0, 'major'))).toEqual([
        t(0, 0, 'major', 'dominant-to-tonic')
      ]);
    });

    it('a minor chromatic chord is no dominant', () => {
      expect(likelyNextDegrees(IONIAN, shape(4, 0, 'minor')).kind).toBe('none');
    });
  });

  describe('reading the selected chord', () => {
    it('V7, ii7 and viiø7 find their triad rows', () => {
      expect(targetsOf(IONIAN, shape(4, 0, null, 7))[0]).toEqual(t(0, 0, 'major', 'dominant-to-tonic'));
      expect(targetsOf(IONIAN, shape(1, 0, null, 7))[0]).toEqual(t(4, 0, 'major', 'predominant-to-dominant'));
      expect(targetsOf(IONIAN, shape(6, 0, null, 7))).toEqual([t(0, 0, 'major', 'dominant-to-tonic')]);
    });

    it('reads a suspended chord by the triad under it', () => {
      const vSus4: ChordShape = { ...shape(4), suspension: 'sus4' };
      expect(targetsOf(IONIAN, vSus4)[0]).toEqual(t(0, 0, 'major', 'dominant-to-tonic'));
    });

    it('gives a stack with no name no hint', () => {
      expect(likelyNextDegrees(IONIAN, shape(4, 0, 'other')).kind).toBe('none');
    });
  });

  describe('scales outside the tables', () => {
    it('refuses a seven-note scale it has no table for', () => {
      expect(likelyNextDegrees(HUNGARIAN_MINOR, shape(4)).kind).toBe('unsupported');
    });

    it('refuses a pentatonic scale before asking for a chord it cannot build', () => {
      expect(likelyNextDegrees(MAJOR_PENTATONIC, shape(0)).kind).toBe('unsupported');
    });
  });

  it('reads its inputs without writing to them', () => {
    expect(() => likelyNextDegrees(deepFrozen([...AEOLIAN]), deepFrozen(shape(3)))).not.toThrow();
  });

  describe('the two family helpers', () => {
    it('reduces sevenths and added tones to their triad', () => {
      expect(triadFamilyOf('dominant7')).toBe('major');
      expect(triadFamilyOf('minor7')).toBe('minor');
      expect(triadFamilyOf('halfDiminished7')).toBe('diminished');
      expect(triadFamilyOf('augmentedMajor7')).toBe('augmented');
      expect(triadFamilyOf('other')).toBeNull();
    });

    it('reads the key\'s own triad on a degree', () => {
      expect(triadFamilyAt(AEOLIAN, 4)).toBe('minor');
      expect(triadFamilyAt(HARMONIC_MINOR, 4)).toBe('major');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-next-chords.spec.ts'`
Expected: FAIL - the build cannot resolve `./progression-next-chords`.

**Step 3: Write the implementation**

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-next-chords.spec.ts'`
Expected: PASS, every case. If a row fails, check the row against the design doc's section 2 before touching the
test - the test is copied from the doc, not from the code.

**Step 5: Commit**

```bash
git add client/src/app/services/progression-next-chords.ts client/src/app/services/progression-next-chords.spec.ts
git commit -m "feat: Add the next-chord tables and likelyNextDegrees"
```

---

## Task 2: The toggle on `ProgressionService`

**Files:**
- Modify: `client/src/app/services/progression.service.ts` (fields near line 172; methods after `getState()` near
  line 235)
- Test: `client/src/app/services/progression.service.spec.ts` (append a `describe`)

**Step 1: Write the failing test** - append inside the top-level `describe` of `progression.service.spec.ts`, using
the `service` variable the file already sets up (read the file's `beforeEach` to confirm its name):

```typescript
  describe('suggest next', () => {
    function suggestNext(): boolean {
      let captured: boolean | undefined;
      service.getSuggestNext().subscribe(value => (captured = value)).unsubscribe();
      if (captured === undefined) throw new Error('getSuggestNext published nothing on subscribe');
      return captured;
    }

    it('starts on', () => {
      expect(suggestNext()).toBeTrue();
    });

    it('turns off and on again', () => {
      service.setSuggestNext(false);
      expect(suggestNext()).toBeFalse();
      service.setSuggestNext(true);
      expect(suggestNext()).toBeTrue();
    });

    it('is no edit to the document: nothing to undo', () => {
      service.setSuggestNext(false);
      expect(service.canUndo).toBeFalse();
    });
  });
```

If the service has no `canUndo` getter, read the flag off `getState()` the way the file's other tests do.

**Step 2: Run it** - `--include='**/progression.service.spec.ts'`. Expected: FAIL, `getSuggestNext` is not a function.

**Step 3: Implement.** Add `BehaviorSubject` to the `rxjs` import, then the field beside the other `private readonly`
fields:

```typescript
  /**
   * Whether the palette marks the chords that conventionally follow the
   * selected one. A view preference rather than a fact about the document, so
   * it is a subject of its own rather than a field on `ProgressionState`: that
   * state is rebuilt from the document on every commit, through `derive`, and a
   * preference threaded through it would have to survive every publish. No undo
   * step and not saved across reloads - the transport's Loop behaves the same.
   */
  private readonly suggestNextSubject = new BehaviorSubject<boolean>(true);
```

and after `getState()`:

```typescript
  getSuggestNext(): Observable<boolean> {
    return this.suggestNextSubject.asObservable();
  }

  setSuggestNext(on: boolean): void {
    if (this.suggestNextSubject.getValue() === on) return;
    this.suggestNextSubject.next(on);
  }
```

**Step 4: Run it.** Expected: PASS. Check `wc -l` on the service stays under 1000.

**Step 5: Commit**

```bash
git add client/src/app/services/progression.service.ts client/src/app/services/progression.service.spec.ts
git commit -m "feat: Add the suggest-next toggle to ProgressionService"
```

---

## Task 3: Spoken names and a `hinted` flag on the palette's view models

The caption needs each target button's spoken name, and the template needs to know which buttons are hinted. Both
belong on the view models the template already binds.

**Files:**
- Modify: `client/src/app/components/progression/components/chord-palette/chord-palette.component.ts` -
  `PaletteChord` (line 46), `PaletteOption` (line 80), `buildChords` (line 674)
- Modify: `client/src/app/components/progression/components/chord-palette/chord-palette-options-view.ts` -
  `buildOption` (line 219), and export `optionKey` (line 243)

**Step 1: Add the fields.** On `PaletteChord` and on `PaletteOption`:

```typescript
  /**
   * The chord as a phrase that is heard - `G major` - for the next-chord
   * caption, which names its targets aloud. `label` is not reusable for that:
   * it carries a verb and a position.
   */
  spoken: string;
  /** Whether the next-chord hints mark this button. See `chord-palette-hints-view.ts`. */
  hinted: boolean;
```

Update `PaletteOption`'s docstring, which says `spoken` is "neither drawn nor dispatched": it is now read by the
caption, which is why it is carried.

**Step 2: Fill them.** In `buildChords`, add to the returned object:

```typescript
        spoken: spokenChordName(root, chord),
        hinted: false,
```

In `buildOption` (options view):

```typescript
    spoken: option.spoken,
    hinted: false,
```

and change `function optionKey` to `export function optionKey`.

**Step 3: Run the palette's existing specs** - `--include='**/chord-palette*.spec.ts'`. Expected: PASS. A spec that
builds a `PaletteChord` or `PaletteOption` literal fails to compile; add the two fields there.

**Step 4: Commit**

```bash
git add client/src/app/components/progression/components/chord-palette/
git commit -m "refactor: Carry a spoken name and a hinted flag on the palette's buttons"
```

---

## Task 4: The hints view - matching targets to buttons, and the caption

**Files:**
- Create: `client/src/app/components/progression/components/chord-palette/chord-palette-hints-view.ts`
- Test: `client/src/app/components/progression/components/chord-palette/chord-palette-hints-view.spec.ts`

**Step 1: Write the failing test**

```typescript
import { NamedQuality } from '../../../../services/progression-harmony';
import { NextChords } from '../../../../services/progression-next-chords';
import { PaletteChord, PaletteOption } from './chord-palette.component';
import { HINT_SUFFIX, HintSubject, hintPalette } from './chord-palette-hints-view';

/**
 * Matching a target to a button, and the caption. The tables are tested in
 * `progression-next-chords.spec.ts`; these fixtures hand the view an answer and
 * check where the marks land and what the caption says.
 */
describe('hintPalette', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];

  const G_MAJOR: HintSubject = { numeral: 'V', name: 'G Maj', subject: 'G major' };

  function chords(numerals: readonly string[], names: readonly string[]): PaletteChord[] {
    return numerals.map((numeral, degree) => ({
      degree,
      numeral,
      name: names[degree],
      label: `Add ${names[degree]}, degree ${degree + 1}`,
      spoken: names[degree],
      isTonic: degree === 0,
      hinted: false
    }));
  }

  const C_MAJOR_CHORDS = chords(
    ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
    ['C Maj', 'D min', 'E min', 'F Maj', 'G Maj', 'A min', 'B°']
  );
  const A_MINOR_CHORDS = chords(
    ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
    ['A min', 'B°', 'C Maj', 'D min', 'E min', 'F Maj', 'G Maj']
  );
  const A_MELODIC_CHORDS = chords(
    ['i', 'ii', 'III+', 'IV', 'V', 'vi°', 'vii°'],
    ['A min', 'B min', 'C aug', 'D Maj', 'E Maj', 'F#°', 'G#°']
  );

  function option(degree: number, alter: number, quality: NamedQuality, numeral: string, name: string): PaletteOption {
    return {
      degree,
      alter,
      quality,
      extent: 3,
      numeral,
      name,
      label: `Add ${name}, borrowed chord`,
      spoken: name,
      current: false,
      key: `${degree}:${alter}:${quality}`,
      hinted: false
    };
  }

  const A_MINOR_BORROWED = [
    option(1, -1, 'major', '♭II', 'Bb Maj'),
    option(4, 0, 'major', 'V', 'E Maj'),
    option(6, 1, 'diminished', '♮vii°', 'G#°')
  ];

  function targets(...list: Extract<NextChords, { kind: 'targets' }>['targets']): NextChords {
    return { kind: 'targets', targets: list };
  }

  function hintedNumerals(result: ReturnType<typeof hintPalette>): string[] {
    return [...result.chords, ...result.borrowed].filter(button => button.hinted).map(button => button.numeral);
  }

  it('marks nothing and says nothing without an answer', () => {
    const result = hintPalette({
      next: null,
      subject: null,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBeNull();
    expect(result.spokenCaption).toBeNull();
  });

  it('marks the diatonic targets and names each motion', () => {
    const result = hintPalette({
      next: targets(
        { degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' },
        { degree: 5, alter: 0, family: 'minor', reason: 'deceptive' }
      ),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual(['I', 'vi']);
    expect(result.caption).toBe('After V (G Maj): I — dominant to tonic · vi — deceptive');
    expect(result.spokenCaption).toBe('After G major: C Maj, dominant to tonic; A min, deceptive');
  });

  it('adds the suffix to a hinted button\'s label and to no other', () => {
    const result = hintPalette({
      next: targets({ degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.chords[0].label).toBe(`Add C Maj, degree 1${HINT_SUFFIX}`);
    expect(result.chords[1].label).toBe('Add D min, degree 2');
  });

  it('lands a minor key\'s major V on the Borrowed row, not on the diatonic v', () => {
    const result = hintPalette({
      next: targets(
        { degree: 4, alter: 0, family: 'major', reason: 'predominant-to-dominant' },
        { degree: 6, alter: 1, family: 'diminished', reason: 'predominant-to-dominant' }
      ),
      subject: { numeral: 'iv', name: 'D min', subject: 'D minor' },
      scaleIntervals: AEOLIAN,
      chords: A_MINOR_CHORDS,
      borrowed: A_MINOR_BORROWED
    });
    expect(hintedNumerals(result)).toEqual(['V', '♮vii°']);
  });

  it('falls back to the key\'s own chord on the root: melodic minor\'s IV for iv', () => {
    const result = hintPalette({
      next: targets({ degree: 3, alter: 0, family: 'minor', reason: 'rising-step' }),
      subject: { numeral: 'III+', name: 'C aug', subject: 'C augmented' },
      scaleIntervals: MELODIC_MINOR,
      chords: A_MELODIC_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual(['IV']);
  });

  it('drops a target no button can show, and says so when every one is dropped', () => {
    const result = hintPalette({
      next: targets({ degree: 5, alter: -1, family: 'major', reason: 'falling-fifth' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBe('No common next chord after V (G Maj)');
    expect(result.spokenCaption).toBe('No common next chord after G major');
  });

  it('says the tonic can go anywhere, and marks nothing', () => {
    const result = hintPalette({
      next: { kind: 'any' },
      subject: { numeral: 'I', name: 'C Maj', subject: 'C major' },
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBe('After I (C Maj): any chord — the tonic can go anywhere');
    expect(result.spokenCaption).toBe('After C major: any chord, the tonic can go anywhere');
  });

  it('says which keys the hints cover', () => {
    const result = hintPalette({
      next: { kind: 'unsupported' },
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.caption).toBe('Next-chord hints cover major, minor and the church modes');
  });

  it('names a chord with no entry', () => {
    const result = hintPalette({
      next: { kind: 'none' },
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.caption).toBe('No common next chord after V (G Maj)');
  });

  it('returns fresh buttons and leaves the ones it was given alone', () => {
    hintPalette({
      next: targets({ degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(C_MAJOR_CHORDS[0].hinted).toBeFalse();
  });
});
```

**Step 2: Run it** - `--include='**/chord-palette-hints-view.spec.ts'`. Expected: FAIL, module not found.

**Step 3: Implement**

```typescript
import {
  MOTION_REASON_TEXT,
  NextChordTarget,
  NextChords,
  triadFamilyAt,
  triadFamilyOf
} from '../../../../services/progression-next-chords';
import { PaletteChord, PaletteOption } from './chord-palette.component';

/**
 * The next-chord hints on the palette: which buttons carry the mark, and the
 * caption that names the selected chord and the motion to each target.
 *
 * Pure, like its two siblings: the component hands it the answer
 * `likelyNextDegrees` gave and the buttons it already built, and binds what
 * comes back. Labels are finished here rather than concatenated in the
 * template, on `PaletteChord.label`'s rule.
 */

/** What a hinted button adds to the label it says aloud. */
export const HINT_SUFFIX = ', a common next chord';

const UNSUPPORTED_CAPTION = 'Next-chord hints cover major, minor and the church modes';

/** The selected chord as the strip card names it. See `describeSlot`. */
export interface HintSubject {
  numeral: string;
  name: string;
  /** Spoken. */
  subject: string;
}

export interface HintInput {
  /** Null when the toggle is off or nothing hintable is selected. */
  next: NextChords | null;
  subject: HintSubject | null;
  scaleIntervals: readonly number[];
  chords: readonly PaletteChord[];
  borrowed: readonly PaletteOption[];
}

export interface HintedPalette {
  chords: readonly PaletteChord[];
  borrowed: readonly PaletteOption[];
  caption: string | null;
  spokenCaption: string | null;
}

type Button = PaletteChord | PaletteOption;

interface Hit {
  button: Button;
  target: NextChordTarget;
}

export function hintPalette(input: HintInput): HintedPalette {
  const { next, subject } = input;
  if (next === null || subject === null) return unmarked(input, null, null);

  switch (next.kind) {
    case 'unsupported':
      return unmarked(input, UNSUPPORTED_CAPTION, UNSUPPORTED_CAPTION);
    case 'any':
      return unmarked(
        input,
        `After ${subject.numeral} (${subject.name}): any chord — the tonic can go anywhere`,
        `After ${subject.subject}: any chord, the tonic can go anywhere`
      );
    case 'none':
      return unmarked(input, ...noEntry(subject));
    case 'targets':
      return marked(input, subject, next.targets);
  }
}

function marked(input: HintInput, subject: HintSubject, targets: readonly NextChordTarget[]): HintedPalette {
  const hits: Hit[] = [];
  for (const target of targets) {
    const button = buttonFor(target, input);
    // One mark per button, kept at its first reason: two rows that land on the
    // same button would otherwise print it twice.
    if (button && !hits.some(hit => hit.button === button)) hits.push({ button, target });
  }

  if (hits.length === 0) return unmarked(input, ...noEntry(subject));

  const isHit = (button: Button): boolean => hits.some(hit => hit.button === button);
  const reason = (hit: Hit): string => MOTION_REASON_TEXT[hit.target.reason];

  return {
    chords: input.chords.map(chord => mark(chord, isHit(chord))),
    borrowed: input.borrowed.map(option => mark(option, isHit(option))),
    caption: `After ${subject.numeral} (${subject.name}): ${hits
      .map(hit => `${hit.button.numeral} — ${reason(hit)}`)
      .join(' · ')}`,
    spokenCaption: `After ${subject.subject}: ${hits
      .map(hit => `${hit.button.spoken}, ${reason(hit)}`)
      .join('; ')}`
  };
}

/**
 * The button a target lands on: the diatonic chord on its root with its triad,
 * else a Borrowed option on its root with its triad, else the diatonic chord on
 * its root whatever its triad. Design doc, section 2, "Matching a target".
 */
function buttonFor(target: NextChordTarget, input: HintInput): Button | undefined {
  const { scaleIntervals, chords, borrowed } = input;
  const diatonic = target.alter === 0 ? chords.find(chord => chord.degree === target.degree) : undefined;

  if (diatonic && triadFamilyAt(scaleIntervals, target.degree) === target.family) return diatonic;

  const option = borrowed.find(
    candidate =>
      candidate.degree === target.degree &&
      candidate.alter === target.alter &&
      triadFamilyOf(candidate.quality) === target.family
  );

  return option ?? diatonic;
}

function mark<T extends Button>(button: T, hinted: boolean): T {
  return hinted ? { ...button, hinted, label: `${button.label}${HINT_SUFFIX}` } : button;
}

function unmarked(input: HintInput, caption: string | null, spokenCaption: string | null): HintedPalette {
  return { chords: input.chords, borrowed: input.borrowed, caption, spokenCaption };
}

function noEntry(subject: HintSubject): [string, string] {
  return [
    `No common next chord after ${subject.numeral} (${subject.name})`,
    `No common next chord after ${subject.subject}`
  ];
}
```

`candidate.alter === target.alter` compares displacements against the same key degree, which is the same root. The
buttons the component passes in carry `hinted: false` (Task 3), so `unmarked` can hand them back as they are.

**Step 4: Run it.** Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/app/components/progression/components/chord-palette/chord-palette-hints-view.ts \
        client/src/app/components/progression/components/chord-palette/chord-palette-hints-view.spec.ts
git commit -m "feat: Match next-chord targets to palette buttons and write the caption"
```

---

## Task 5: Wire the hints into the palette

**Files:**
- Modify: `client/src/app/components/progression/components/chord-palette/chord-palette.component.ts`
- Modify: `client/src/app/components/progression/components/chord-palette/chord-palette.component.html`
- Modify: `client/src/app/components/progression/components/chord-palette/chord-palette.component.scss`
- Test: `client/src/app/components/progression/components/chord-palette/chord-palette.component.hints.spec.ts`
  (new - the main spec is at 895 lines)

**Step 1: Write the failing test**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChordPaletteComponent } from './chord-palette.component';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * The next-chord hints, through the real service: the toggle, the marks, and
 * the caption following the selection. Which chords are hinted is
 * `progression-next-chords.spec.ts`'s question and where they land is
 * `chord-palette-hints-view.spec.ts`'s; this checks the wiring.
 */
describe('ChordPaletteComponent next-chord hints', () => {
  let fixture: ComponentFixture<ChordPaletteComponent>;
  let component: ChordPaletteComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChordPaletteComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChordPaletteComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function hinted(): string[] {
    return [...component.chords, ...component.borrowed]
      .filter(button => button.hinted)
      .map(button => button.numeral);
  }

  it('starts on, and marks what follows the chord just added', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    fixture.detectChanges();

    expect(component.suggestNext).toBeTrue();
    expect(hinted()).toEqual(['I', 'vi']);
    expect(component.hintCaption).toBe('After V (G Maj): I — dominant to tonic · vi — deceptive');
  });

  it('follows the selection to a chord in the middle', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(1);
    progression.appendSlot(4);
    progression.selectSlot(progression.doc.slots[0].id);
    fixture.detectChanges();

    expect(hinted()).toEqual(['V', 'vii°']);
  });

  it('marks the borrowed V after iv in a minor key', () => {
    progression.setKey(9, 'aeolian');
    progression.appendSlot(3);
    fixture.detectChanges();

    expect(hinted()).toContain('V');
    expect(component.chords.find(chord => chord.numeral === 'v')?.hinted).toBeFalse();
  });

  it('clears everything when the toggle is turned off', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    component.toggleSuggestNext();
    fixture.detectChanges();

    expect(component.suggestNext).toBeFalse();
    expect(hinted()).toEqual([]);
    expect(component.hintCaption).toBeNull();
  });

  it('shows nothing with nothing selected', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    progression.selectSlot(null);
    fixture.detectChanges();

    expect(hinted()).toEqual([]);
    expect(component.hintCaption).toBeNull();
  });

  it('puts the caption on the page', () => {
    progression.setKey(0, 'ionian');
    progression.appendSlot(4);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('After V (G Maj)');
  });
});
```

Before running, check that a fresh `ProgressionService` starts with an empty progression; if
`createDefaultProgression` seeds slots, read `progression.doc.slots` and adjust the "middle" test's index rather than
the assertion.

**Step 2: Run it** - `--include='**/chord-palette.component.hints.spec.ts'`. Expected: FAIL to compile -
`suggestNext`, `hintCaption` and `toggleSuggestNext` do not exist.

**Step 3a: The component.** Imports:

```typescript
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { ChordSlot } from '../../../../models/progression.model';
import { likelyNextDegrees } from '../../../../services/progression-next-chords';
import { ChordVocabulary } from '../../../../services/progression-vocabulary';
import { describeSlot } from '../progression-strip/progression-strip-cards';
import { hintPalette } from './chord-palette-hints-view';
```

(merge them into the existing import lines rather than duplicating `rxjs` and the model import.)

Fields, after `tensions`:

```typescript
  /** Whether the next-chord hints are on. Mirrors `ProgressionService.getSuggestNext`. */
  suggestNext = true;

  /** The line under the title naming the selected chord and each hint, or null. */
  hintCaption: string | null = null;

  /** The same line as it is heard. See `chord-palette-hints-view.ts`. */
  hintSpoken: string | null = null;
```

`ngOnInit` subscribes to both:

```typescript
    combineLatest([this.progression.getState(), this.progression.getSuggestNext()])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([state, suggestNext]) => {
        this.render(state, suggestNext);
        this.changes.markForCheck();
      });
```

The handler, beside `addChord`:

```typescript
  /** The `Suggest next` toggle. */
  toggleSuggestNext(): void {
    this.progression.setSuggestNext(!this.suggestNext);
  }
```

`render` takes `suggestNext: boolean`, and `buildOptions` returns the vocabulary it built (`ChordVocabulary`) instead
of `void` - add `return vocabulary;` at its end. Then at the end of `render`:

```typescript
    this.suggestNext = suggestNext;
    this.renderHints(state, degree, suggestNext);
```

and the method, below `renderOctave`:

```typescript
  /**
   * The next-chord marks and caption. After everything else, because it
   * re-labels buttons the rows above already built.
   *
   * `canAdjust` is the guard for the reason `render` gives for the controls:
   * it is false in a key that can build no chords, where `effectiveChord`
   * would throw, and false with nothing - or a literal slot - selected.
   */
  private renderHints(state: ProgressionState, degree: ChordDegree | null, suggestNext: boolean): void {
    const scale = state.keyScale;
    const slot = this.selectedSlot(state);
    const on = suggestNext && this.canAdjust && degree !== null && scale !== null && slot !== null;

    const hints = hintPalette({
      next: on ? likelyNextDegrees(scale.intervals, degree) : null,
      subject: on ? describeSlot(slot.harmony, state.doc.key, scale.intervals) : null,
      scaleIntervals: scale?.intervals ?? [],
      chords: this.chords,
      borrowed: this.borrowed
    });

    this.chords = hints.chords;
    this.borrowed = hints.borrowed;
    this.hintCaption = hints.caption;
    this.hintSpoken = hints.spokenCaption;
  }
```

TypeScript will not narrow `scale`, `degree` and `slot` through `on`. Write it with an early branch instead if the
compiler objects:

```typescript
    if (!suggestNext || !this.canAdjust || degree === null || scale === null || slot === null) {
      this.hintCaption = null;
      this.hintSpoken = null;
      return;
    }
```

followed by the `hintPalette` call with the narrowed values - the rows were built unhinted, so there is nothing to
clear on the early return.

Split `selectedDegree` so the slot is reachable:

```typescript
  /** The selected slot, or null. */
  private selectedSlot(state: ProgressionState): ChordSlot | null {
    return state.doc.slots.find(candidate => candidate.id === state.selectedSlotId) ?? null;
  }
```

and have `selectedDegree` call it (keep its existing comment about literal slots).

`render`'s call sites: `this.render(state)` is only in `ngOnInit`, which you replaced. `buildChords`'s and
`buildOptions`'s rows come back unhinted on every render, so turning the toggle off clears the marks with no extra
code.

**Step 3b: The template.** Replace the `<h3 class="title">` line with:

```html
  <!-- The title row carries the next-chord toggle. Hidden with the rest of the
       panel when the key can build no chords: there would be nothing to hint. -->
  <div class="title-row">
    <h3 class="title">Chords in this key</h3>
    <button
      type="button"
      class="toggle suggest"
      *ngIf="unavailable === null"
      [class.current]="suggestNext"
      [attr.aria-pressed]="suggestNext"
      (click)="toggleSuggestNext()">
      <span aria-hidden="true">&rsaquo;</span> Suggest next
    </button>
  </div>

  <!-- The next-chord caption. The live region is the wrapper, which is always
       here, on the rule the two regions below argue: a region announces
       changes to itself, not its own arrival. The visible line carries
       numerals; the hidden one says the same thing in words. -->
  <div class="caption-region" aria-live="polite">
    <p class="next-caption" *ngIf="hintCaption">
      <span aria-hidden="true">{{ hintCaption }}</span>
      <span class="visually-hidden">{{ hintSpoken }}</span>
    </p>
  </div>
```

In both diatonic and Borrowed buttons, add `[class.hinted]="chord.hinted"` (or `option.hinted`) and, as the button's
last child:

```html
      <span class="next-mark" *ngIf="chord.hinted" aria-hidden="true">&rsaquo;</span>
```

Do **not** add it to the Secondary or alternates rows - the design keeps marks off both.

**Step 3c: The styles.** Add at the top: `@use '../../../../styles/a11y';` (the piano roll's path - same depth). Then:

```scss
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;

  .title {
    margin: 0;
  }
}

// The caption names the selected chord and the motion to each hint. Dim, as
// the other hints on this panel are: it explains, it does not compete.
.next-caption {
  margin: -0.35rem 0 0.6rem;
  font-size: 0.75rem;
  color: var(--palette-text-dim);
}

// The hint mark. A glyph in the text colour and no fill or ring, because the
// white ring already means "the chord you are on" and the palette keeps colour
// for that one selection. It reads without colour, and `forced-colors` keeps it.
.chord,
.option {
  position: relative;
}

.next-mark {
  position: absolute;
  top: 0.2rem;
  right: 0.3rem;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--palette-text);
}

.visually-hidden {
  @extend %sr-only;
}
```

The `.title` rule's own `margin: 0 0 0.75rem` moves to `.title-row`; keep the rest of `.title`.

**Step 4: Run the palette's specs** - `--include='**/chord-palette*.spec.ts'`. Expected: PASS, old and new. Then
`wc -l` the component: it must stay under 1000.

**Step 5: Commit**

```bash
git add client/src/app/components/progression/components/chord-palette/
git commit -m "feat: Mark the likely next chords on the progression palette"
```

---

## Task 6: Full suite, build, and the hand check

**Step 1:** From `client/`, run the whole suite: `npx ng test --watch=false --browsers=ChromeHeadless`. Expected: all
pass.

**Step 2:** `npm run build`. Expected: no errors, no new warnings.

**Step 3: Hand check in the browser** (`npm start`, then `/progression`), by ear as well as by eye. Record what you
find in the commit message or a note:

1. C major: add `I`, then follow the marks round I-vi-ii-V-I. Each mark should be on a chord the caption names, and
   each step should sound like it leads on.
2. A minor (aeolian): add `iv`. The mark must be on the Borrowed `V (E Maj)`, not the diatonic `v`. Add it; the caption
   should offer `i` and `VI`.
3. G mixolydian: add `♭VII` (diatonic degree 7, `F Maj`). The caption should read "modal cadence" to `I`.
4. A minor: add `v`, then try both marks (`VI`, `iv`). This is the one entry the references did not chart - if either
   sounds wrong, say so rather than shipping it.
5. Turn `Suggest next` off: marks and caption go. Reload: it is on again.
6. Pick Hungarian minor: the caption reads "Next-chord hints cover major, minor and the church modes".
7. A screen reader, or the accessibility tree: the toggle announces pressed/not pressed; a hinted button ends ", a
   common next chord"; moving the selection announces the caption in words.
8. Dark theme and `forced-colors` emulation: the `›` is visible in both.

**Step 4: Commit** any fixes from the hand check, one `fix:` commit each.

---

## After this ships

- Add a one-line follow-up to `docs/plans/2026-10-01-songwriting-design.md` (on `docs/songwriting-design`): the
  Chords tab can mark hints with `likelyNextDegrees` after S1.
- Update `docs/ROADMAP.md`'s Music Tooling section with the feature.
