# Transcription M1: Derivation Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the pure-TypeScript core that turns detected note events into a playable `ScoreDoc`, with no audio, no models and no Angular.

**Architecture:** Six pure modules under `client/src/app/services/`, following the existing `staff-pitch.ts` precedent (exported functions, no `@Injectable`). Raw `DetectedNote` events in seconds are the source of truth; `deriveScore()` interprets them into notation. Every module is independently testable from hand-written fixtures.

**Tech Stack:** TypeScript 5.9 strict, Jasmine/Karma, no new dependencies.

**Design doc:** `docs/plans/2026-09-05-audio-transcription-design.md`

---

## Before you start

Work in the worktree at `D:\Github\MusicTheory\.worktrees\audio-transcription-core`, branch `feature/audio-transcription-core`. All paths below are relative to `client/`.

**Run all tests:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

**Run one spec file:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/NAME.spec.ts'
```

Baseline before you begin: **58 tests, 0 failures.**

### Domain glossary

You do not need to know music theory to implement this, but three terms recur:

- **MIDI pitch** — an integer naming a pitch. 60 is middle C, and adding 12 raises by one octave. A 4-string bass in standard tuning has open strings at 43, 38, 33, 28 (highest string first).
- **Beat** — one unit of the time signature's *denominator*. In 4/4 that is a quarter note; in 6/8 an eighth note. A 4/4 bar is 4 beats long.
- **Slot** — the smallest rhythmic subdivision we will write down, set by `finestDivision`. With `finestDivision: 16` (sixteenth notes) in 4/4, one beat is 4 slots and a bar is 16 slots.

### Six scope decisions, made deliberately

1. **No `@Injectable` services in M1.** The design doc names a `ScoreDerivationService`, but everything here is a pure function and Angular does not require DI to call one. Components will import `deriveScore` directly. The stateful `TranscriptionService` arrives in M2 when there is actually state to hold.
2. **Quantization decomposes greedily inside metric fragments, not with the cost-based DP from the design doc.** The property that matters — every bar sums to exactly one bar, which is what stops the notation drifting — is guaranteed by construction: the finest division is always available as a one-slot unit, so every fragment decomposes exactly.
   Greedy on its own, though, is handed a span *length* and nothing else, and that produces spellings that are wrong rather than merely different: a note on the "and of 4" of a 4/4 bar preceded by a *double-dotted half rest*, a note on the second eighth of a 6/8 bar written as a *half note* straddling both dotted-quarter groups. So a span is first cut to finish the beat it starts inside, and again at the half-bar in meters that have one, and greedy runs inside those fragments. Double dots are dropped from the table for the same reason.
   What is still deferred is the DP that *chooses between* readable spellings — dotted quarter vs quarter-tied-to-eighth, where both respect the meter — by onset strength. That is polish, and is listed as follow-up work at the end of this plan.
3. **`BeatGrid` is interpretation, not raw fact.** Only `DetectedNote[]` is the immutable layer. Beat tracking is already an inference over the audio, and the user is expected to correct it, so a corrected tempo or meter is expressed by *regenerating the grid* — not by an override that downstream code has to reconcile against a grid it disagrees with. Later milestones say "actually it's 90 BPM" by handing `deriveScore` a new grid.
4. **No dynamics.** `DetectedNote` carries no amplitude or velocity, so `BeatDoc.dynamics` is always `null` in M1. Adding a velocity field is cheap; deciding how amplitude maps onto *ppp*-*fff* is not, and it is not what this milestone is about.
5. **`DetectedNote.offsetSec` is discarded; every note sustains to the next onset.** `PlacedNote` carries a position and no duration, so `quantizeBar` gives each note the whole span up to the next attack. Staccato eighths on beats 1 and 3 are written as two half notes, and a rest can only appear before a bar's first note. That is the trade, taken deliberately: over-sustaining is the *opposite* failure from raggedness, and it is the one a reader can absorb — the pitches, their order and their attack points are all still right, which is what a player needs from tab. Honouring offsets means a second quantization pass (releases snapped to the same grid, spans shortened, freed slots filled with rests) and a rule for what counts as a rest rather than a legato gap; both are milestone-sized.
6. **Bars are assigned from the rounded slot, not from the raw beat.** `deriveScore` rounds each onset to a global slot index and reads the bar off that, then hands `quantizeBar` the *unrounded* position within that bar. Choosing the bar first pulls a note in the last half-slot of a bar back onto that bar's final slot instead of forward onto the next bar's downbeat — and if the next bar opens with a note too, that writes two attacks where the performance had one. Passing the position on unrounded is what still lets `quantizeBar` recognise two onsets a few tens of milliseconds apart as one chord. `quantizeBar`'s own clamp into `[0, totalSlots - 1]` stays, now as a genuine defensive guard rather than the thing doing the work.

---

## Task 1: Transcription types

**Files:**
- Create: `src/app/models/transcription.model.ts`
- Modify: `src/app/models/composer.model.ts` (add `STANDARD_BASS_TUNING`)
- Test: `src/app/models/transcription.model.spec.ts`

**Step 1: Write the failing test**

Create `src/app/models/transcription.model.spec.ts`:

```typescript
import {
  STANDARD_BASS_TUNING,
  createDefaultDerivationSettings
} from './transcription.model';

describe('createDefaultDerivationSettings', () => {
  it('defaults to standard bass tuning, highest string first', () => {
    expect(createDefaultDerivationSettings().tuning).toEqual(STANDARD_BASS_TUNING);
  });

  it('copies the tuning so later edits do not reach back to the caller', () => {
    const tuning = [43, 38, 33, 28];
    const settings = createDefaultDerivationSettings(tuning);

    settings.tuning[0] = 99;

    expect(tuning[0]).toBe(43);
  });

  it('honours a caller-supplied tuning', () => {
    expect(createDefaultDerivationSettings([40, 45, 50, 55]).tuning)
      .toEqual([40, 45, 50, 55]);
  });

  it('does not hand out the shared constant for callers to mutate', () => {
    createDefaultDerivationSettings().tuning[0] = 99;
    expect(STANDARD_BASS_TUNING[0]).toBe(43);
  });

  it('starts with a sixteenth-note grid and no key override', () => {
    const settings = createDefaultDerivationSettings();

    expect(settings.finestDivision).toBe(16);
    expect(settings.key).toBeNull();
  });
});
```

The last two tests are what give the first one teeth: `[43, 38, 33, 28]` is
value-identical to the default, so on its own it cannot tell a correct factory
from one that ignores its argument.

**Step 2: Run test to verify it fails**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/transcription.model.spec.ts'
```

Expected: FAIL — `Cannot find module './transcription.model'`.

**Step 3: Write minimal implementation**

First, in `src/app/models/composer.model.ts`, directly after
`STANDARD_GUITAR_TUNING` under the `// Defaults` banner, add its sibling.
Instrument reference data belongs in one place, not split across two model
files:

```typescript
/** 4-string bass, standard tuning: G2 D2 A1 E1, highest string first. */
export const STANDARD_BASS_TUNING: number[] = [43, 38, 33, 28];
```

Then create `src/app/models/transcription.model.ts`:

```typescript
/**
 * Domain model for audio transcription.
 *
 * The model is deliberately two-layered:
 *  1. **Detected events are facts.** `DetectedNote` holds what the detector
 *     observed, timed in absolute seconds into the source audio. Nothing about
 *     tempo, meter, key or instrument can make it wrong.
 *  2. **A ScoreDoc is an interpretation of those facts.** Everything in
 *     `DerivationSettings` — tuning, capo, grid, confidence floor — is a knob
 *     on that interpretation, and `deriveScore` is pure, so a score can be
 *     re-derived at any time without re-running detection.
 *
 * `BeatGrid` sits on the interpretation side despite looking like measured
 * data; see its docblock.
 */

import {
  DurationValue,
  KeySignature,
  STANDARD_BASS_TUNING,
  TimeSignature
} from './composer.model';

// Instrument reference data lives in composer.model.ts alongside
// STANDARD_GUITAR_TUNING; re-exported here so transcription callers can reach
// it from the model they already import.
export { STANDARD_BASS_TUNING };

/**
 * Raw output of a note detector, before any musical interpretation.
 *
 * Times are absolute seconds into the source audio, deliberately not beats:
 * this is what the model actually observed, and it stays true no matter what
 * tempo, meter or tuning is later chosen. Everything in a ScoreDoc is derived
 * from these events, so changing an interpretation never means re-running
 * detection.
 */
export interface DetectedNote {
  id: string;
  /** MIDI pitch. */
  pitch: number;
  onsetSec: number;
  offsetSec: number;
  /** 0-1, straight from the model. */
  confidence: number;
  /**
   * Per-frame deviation in cents. Empty when the note has no bend.
   *
   * Sampled at the detector's own frame rate, which this model does not
   * record. Converting these to `NoteEffectsDoc.bendPoints` — quarter tones,
   * one value per bend point rather than per frame — therefore needs that rate
   * from the detector as well as the array itself.
   */
  bendCents: number[];
}

/**
 * Where the beats fall, in seconds.
 *
 * One entry per beat of the time signature's denominator: quarter notes in
 * 4/4, eighths in 6/8.
 *
 * Unlike DetectedNote, this is interpretation rather than raw fact. Beat
 * tracking is already an inference, and the user is expected to correct it;
 * a corrected tempo or meter is expressed by regenerating the grid, not by
 * overriding it downstream.
 */
export interface BeatGrid {
  /** Ascending. */
  beatsSec: number[];
  /**
   * Indices into beatsSec that begin a bar. Ascending, and the first entry is
   * 0: beatsSec[0] is always the first downbeat. Derivation treats it as the
   * start of bar 1, so a pickup must be trimmed out of beatsSec rather than
   * expressed by starting this array above 0.
   */
  downbeatIndices: number[];
  timeSignature: TimeSignature;
}

/**
 * Grid resolutions a bar can actually be decomposed into.
 *
 * Narrower than DurationValue on purpose: the duration table used to fill bars
 * bottoms out at a 64th note, so a finer grid would leave spans it cannot
 * express, and those spans would vanish rather than fail loudly. Derived with
 * Extract so it stays assignable to BeatDoc.duration.
 */
export type FinestDivision = Extract<DurationValue, 4 | 8 | 16 | 32 | 64>;

/** Every knob that turns detected events into notation. */
export interface DerivationSettings {
  /** MIDI pitch per open string, highest string first. */
  tuning: number[];
  /** Frets. 0 = no capo. */
  capo: number;
  /** Shortest note that may be written. 16 = sixteenth note. */
  finestDivision: FinestDivision;
  allowTriplets: boolean;
  /** null infers the key from the notes. */
  key: KeySignature | null;
  /** Notes below this confidence are left out of the score. 0-1, compared against DetectedNote.confidence. */
  confidenceFloor: number;
  /** Highest fret available on the neck, in frets. */
  maxFret: number;
  /** Pins the fretting hand near a fret number, compared against candidate frets. null lets it roam. */
  positionHint: number | null;
}

export interface TranscriptionSession {
  id: string;
  sourceName: string;
  durationSec: number;
  notes: DetectedNote[];
  grid: BeatGrid;
  settings: DerivationSettings;
}

export function createDefaultDerivationSettings(
  tuning: number[] = STANDARD_BASS_TUNING
): DerivationSettings {
  return {
    tuning: [...tuning],
    capo: 0,
    finestDivision: 16,
    allowTriplets: false,
    key: null,
    confidenceFloor: 0.3,
    maxFret: 24,
    positionHint: null
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/transcription.model.spec.ts'
```

Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add src/app/models/transcription.model.ts src/app/models/transcription.model.spec.ts src/app/models/composer.model.ts
git commit -m "feat: Add transcription domain types"
```

---

## Task 2: Beat-grid timing

Converts a time in seconds into a fractional position on the beat grid. Everything downstream works in beats, so this is the boundary between the audio world and the notation world.

**Files:**
- Create: `src/app/services/transcription-timing.ts`
- Test: `src/app/services/transcription-timing.spec.ts`

**Step 1: Write the failing test**

Create `src/app/services/transcription-timing.spec.ts`:

```typescript
import { BeatGrid } from '../models/transcription.model';
import { gridTempo, secondsToBeats } from './transcription-timing';

/** Four beats at 120 BPM, so every beat is half a second. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0],
  downbeatIndices: [0, 4],
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

/** The same grid with beat 3 held long: intervals 0.5, 0.5, 2.0, 0.5. */
const WOBBLY: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 3.0, 3.5] };

/** Slows at the end: intervals 0.5, 0.5, 0.5, 2.0. Median 0.5. */
const RITARDANDO: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 1.5, 3.5] };

/** Starts slow: intervals 2.0, 0.5, 0.5. Median 0.5. */
const ACCELERANDO: BeatGrid = {
  ...GRID,
  beatsSec: [0, 2.0, 2.5, 3.0],
  downbeatIndices: [0]
};

describe('secondsToBeats', () => {
  it('maps a beat time onto its beat index', () => {
    expect(secondsToBeats(1.0, GRID)).toBe(2);
  });

  it('interpolates between two beats', () => {
    expect(secondsToBeats(1.25, GRID)).toBe(2.5);
  });

  /**
   * GRID is perfectly uniform, so every other test here also passes for an
   * implementation that ignores where the beats actually fall and just divides
   * by one average interval - which would defeat the point of tracking beats
   * individually. Only an uneven grid exercises the bracketing search.
   */
  it('interpolates within the beat it actually lands in on an uneven grid', () => {
    // 2.0s is halfway through the long beat spanning 1.0s-3.0s.
    expect(secondsToBeats(2.0, WOBBLY)).toBe(2.5);
    expect(secondsToBeats(3.0, WOBBLY)).toBe(3);
  });

  it('extrapolates before the first beat as a negative position', () => {
    expect(secondsToBeats(-0.25, GRID)).toBe(-0.5);
  });

  it('extrapolates past the last beat using the final interval', () => {
    expect(secondsToBeats(2.5, GRID)).toBe(5);
  });

  /**
   * Both extrapolation branches read the same interval on a uniform grid, so
   * GRID cannot tell them apart: swapping one branch to use the other end's
   * interval leaves every assertion above passing. These two fixtures have
   * deliberately unequal first and final intervals, so each branch is pinned
   * to its own end of the grid - and to the clamp that bounds it.
   */
  it('extrapolates past the end by the final interval, clamped to the median', () => {
    // Final interval 2.0 is clamped to twice the 0.5 median, so 1.0s past the
    // last beat at 3.5s is one further beat, not half of one.
    expect(secondsToBeats(4.5, RITARDANDO)).toBe(5);
  });

  it('extrapolates before the start by the first interval, clamped to the median', () => {
    // First interval 2.0 is clamped to 1.0 the same way, so 1.0s before the
    // first beat is one beat early.
    expect(secondsToBeats(-1.0, ACCELERANDO)).toBe(-1);
  });

  it('leaves each edge reading its own end of the grid', () => {
    // The unclamped ends: RITARDANDO starts at the 0.5 median and ACCELERANDO
    // finishes there, so a branch reaching for the wrong end would show up.
    expect(secondsToBeats(-0.25, RITARDANDO)).toBe(-0.5);
    expect(secondsToBeats(4.0, ACCELERANDO)).toBe(5);
  });

  it('survives a grid too short to interpolate', () => {
    const single: BeatGrid = { ...GRID, beatsSec: [0.4], downbeatIndices: [0] };
    expect(secondsToBeats(9, single)).toBe(0);
  });
});

describe('gridTempo', () => {
  it('reads 120 BPM off a half-second grid', () => {
    expect(gridTempo(GRID)).toBe(120);
  });

  it('ignores a single outlier interval', () => {
    expect(gridTempo(WOBBLY)).toBe(120);
  });

  /**
   * An even number of intervals has no single middle value. Taking the upper
   * one instead of averaging the two reports the slower half of the grid as
   * the tempo of the whole.
   */
  it('averages the two middle intervals when the count is even', () => {
    const even: BeatGrid = { ...GRID, beatsSec: [0, 0.4, 0.8, 1.4, 2.0] };
    expect(gridTempo(even)).toBe(120);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/transcription-timing.spec.ts'
```

Expected: FAIL — `Cannot find module './transcription-timing'`.

**Step 3: Write minimal implementation**

Create `src/app/services/transcription-timing.ts`:

```typescript
import { BeatGrid } from '../models/transcription.model';

/**
 * Converts between audio time and beat-grid position.
 *
 * This is the boundary between the audio world, where everything is absolute
 * seconds into the source, and the notation world, where everything is beats.
 * A `BeatGrid` is a list of measured beat times rather than a single tempo, so
 * conversion is a lookup between neighbouring beats and not a division - which
 * is what lets a score follow a performance that breathes.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the arithmetic can be checked directly
 * against hand-written grids.
 */

/** Ascending gaps between consecutive beats. */
function beatIntervals(beats: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  return intervals;
}

/** Median gap. Resists a single dropped or doubled beat. */
function medianInterval(beats: number[]): number {
  const sorted = beatIntervals(beats).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  // Even counts average the two middle values rather than taking the upper.
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Interval to extrapolate an edge by.
 *
 * The local interval, so a real ritardando reads correctly, but clamped
 * against the median so a single mistracked edge beat cannot throw a note
 * into the wrong bar.
 */
function edgeInterval(local: number, median: number): number {
  if (median <= 0) return local;
  return Math.min(median * 2, Math.max(median / 2, local));
}

/**
 * Position of `sec` on the beat grid, measured in beats since the first
 * downbeat.
 *
 * `beatsSec[0]` is a downbeat by the `BeatGrid` invariant, so beat 0 of the
 * result is beat 1 of bar 1 and callers can divide by the numerator to find
 * the bar.
 *
 * The result is fractional and unbounded. Times before the first beat come
 * back negative and times past the last extrapolate onwards, so callers never
 * have to special-case a note that strays outside the tracked region - a
 * pickup before the first downbeat, or a ring-out after the last. Both edges
 * extrapolate by the local interval clamped to between half and twice the
 * median, so a genuine tempo change is honoured while a single mistracked edge
 * beat is bounded.
 */
export function secondsToBeats(sec: number, grid: BeatGrid): number {
  const beats = grid.beatsSec;
  if (beats.length < 2) return 0;

  const last = beats.length - 1;

  if (sec <= beats[0]) {
    const interval = edgeInterval(beats[1] - beats[0], medianInterval(beats));
    return interval > 0 ? (sec - beats[0]) / interval : 0;
  }

  if (sec >= beats[last]) {
    const interval = edgeInterval(beats[last] - beats[last - 1], medianInterval(beats));
    return interval > 0 ? last + (sec - beats[last]) / interval : last;
  }

  // Binary search for the pair of beats bracketing `sec`.
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (beats[mid] <= sec) low = mid;
    else high = mid;
  }

  const span = beats[low + 1] - beats[low];
  return span > 0 ? low + (sec - beats[low]) / span : low;
}

/**
 * Tempo in BPM of the denominator unit.
 *
 * Median rather than mean, so one dropped or doubled beat in the tracked grid
 * does not drag the whole tempo with it.
 */
export function gridTempo(grid: BeatGrid): number {
  const beats = grid.beatsSec;
  if (beats.length < 2) return 120;

  const median = medianInterval(beats);
  return median > 0 ? Math.round(60 / median) : 120;
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 12 tests.

**Step 5: Commit**

```bash
git add src/app/services/transcription-timing.ts src/app/services/transcription-timing.spec.ts
git commit -m "feat: Add beat-grid timing conversion"
```

---

## Task 3: Bar quantization

Turns onset positions into note durations that fill the bar **exactly**. This is the step that stops derived notation from drifting.

**Files:**
- Create: `src/app/services/transcription-quantize.ts`
- Test: `src/app/services/transcription-quantize.spec.ts`

**Step 1: Write the failing test**

Create `src/app/services/transcription-quantize.spec.ts`:

```typescript
import { NotePitch, TimeSignature } from '../models/composer.model';
import { FinestDivision } from '../models/transcription.model';
import { PlacedNote, beatSlots, quantizeBar } from './transcription-quantize';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

const at = (beatInBar: number, fret: number): PlacedNote => ({
  beatInBar,
  pitch: { kind: 'fretted', string: 2, fret }
});

/** As `at`, but naming the string, for cases that build a chord. */
const on = (beatInBar: number, string: number, fret: number): PlacedNote => ({
  beatInBar,
  pitch: { kind: 'fretted', string, fret }
});

describe('quantizeBar', () => {
  it('fills an empty bar with exactly one bar of rests', () => {
    const beats = quantizeBar([], FOUR_FOUR, 16);

    expect(beats.every(beat => beat.isRest)).toBe(true);
    expect(beatSlots(beats, 16)).toBe(16);
  });

  it('writes four on-beat notes as four quarter notes', () => {
    const beats = quantizeBar([at(0, 0), at(1, 2), at(2, 4), at(3, 5)], FOUR_FOUR, 16);

    expect(beats.map(beat => beat.duration)).toEqual([4, 4, 4, 4]);
    expect(beats.every(beat => beat.dots === 0)).toBe(true);
  });

  it('snaps a marginally early onset onto the beat', () => {
    const beats = quantizeBar([at(0.97, 0)], FOUR_FOUR, 16);

    // A quarter rest, then the note holding the rest of the bar.
    expect(beats[0].isRest).toBe(true);
    expect(beatSlots([beats[0]], 16)).toBe(4);
  });

  it('merges notes landing on the same slot into one chord', () => {
    const beats = quantizeBar([on(0, 2, 0), on(0.02, 1, 2)], FOUR_FOUR, 16);

    expect(beats[0].notes.length).toBe(2);
  });

  it('keeps a chord together when its onsets straddle a slot boundary', () => {
    // A hand crossing the strings spreads a chord over a few tens of
    // milliseconds: these two are 0.08 beats apart, 40 ms at 120 BPM. On a
    // sixteenth grid they fall either side of the midpoint between slot 1 and
    // slot 2, so rounding each on its own writes them as two attacks a
    // thirty-second apart rather than as one chord.
    const beats = quantizeBar([on(0.34, 2, 3), on(0.42, 1, 5)], FOUR_FOUR, 16);

    const struck = beats.filter(beat => !beat.isRest && !beat.notes[0].isTied);

    expect(struck.length).toBe(1);
    expect(struck[0].notes.map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 2, fret: 3 },
      { kind: 'fretted', string: 1, fret: 5 }
    ]);
  });

  it('writes at most one note per string in a chord', () => {
    // A tab line holds one number, an invariant ComposerService.setNoteAtCursor
    // enforces on the editing side. Two co-incident notes fingered to the same
    // string - or one onset detected twice - must not both be written.
    const beats = quantizeBar([on(0, 2, 3), on(0, 2, 7), on(0, 1, 5)], FOUR_FOUR, 16);

    expect(beats[0].notes.map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 2, fret: 3 },
      { kind: 'fretted', string: 1, fret: 5 }
    ]);
  });

  it('ties across a span no single note value can express', () => {
    // Five sixteenths: a quarter tied to a sixteenth.
    const beats = quantizeBar([at(0, 0), at(1.25, 2)], FOUR_FOUR, 16);

    expect(beats[0].duration).toBe(4);
    expect(beats[1].duration).toBe(16);
    expect(beats[1].notes[0].isTied).toBe(true);
  });

  /**
   * Three tests on spelling, which is where longest-first decomposition on its
   * own goes wrong. It is handed a span length and nothing else, so it cannot
   * tell a value that fits from a value a reader can follow.
   */
  it('does not let a rest swallow the middle of the bar', () => {
    // One note on the "and of 4". The rest in front of it is three and a half
    // beats, which longest-first spells as a single double-dotted half rest -
    // a value that starts on beat 1 and hides every beat it crosses.
    const beats = quantizeBar([at(3.5, 5)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [2, 0, true],  // half rest, beats 1 and 2
      [4, 1, true],  // dotted quarter rest, up to the "and of 4"
      [8, 0, false]  // the eighth note itself
    ]);
  });

  it('keeps a 6/8 bar inside its two dotted-quarter groups', () => {
    const sixEight: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

    // A note on the second eighth, held to the bar line. Longest-first spells
    // it as a half note: five eighths' worth of value starting inside the
    // first group and ending inside the second, so neither group is visible.
    const beats = quantizeBar([at(1, 3)], sixEight, 8);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [8, 0, true],   // eighth rest
      [4, 0, false],  // quarter, finishing the first group
      [4, 1, false]   // dotted quarter, the whole second group
    ]);
    expect(beats[2].notes[0].isTied).toBe(true);
  });

  it('ties a syncopated note across the beat rather than hiding it', () => {
    // Onsets on slots 0, 3 and 6 of a sixteenth grid. Longest-first gives the
    // last note a half note starting on the "and of 2".
    const beats = quantizeBar([at(0, 0), at(0.75, 2), at(1.5, 4)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.notes[0].isTied])).toEqual([
      [8, 1, false],   // dotted eighth
      [16, 0, false],  // sixteenth, finishing beat 1
      [8, 0, true],    // tied into an eighth on beat 2
      [8, 0, false],   // eighth on the "and of 2"
      [2, 0, true]     // tied into the half that fills beats 3 and 4
    ]);
  });

  /**
   * `FinestDivision` rules out grids the duration table cannot express, but it
   * cannot rule out a grid coarser than the meter it is being applied to: 8 is
   * a perfectly good eighth-note grid, just not for a /16 bar. That stays a
   * runtime check.
   */
  it('rejects a grid coarser than the time signature', () => {
    const sixteenths: TimeSignature = { numerator: 4, denominator: 16, isCommon: false };

    expect(() => quantizeBar([], sixteenths, 8)).toThrowError(/finestDivision/);
  });

  /**
   * `FinestDivision` exists so no span can reach `slotsToDurations` that the
   * duration table cannot express - such a span under-sums silently rather
   * than failing. A fractional numerator is the one remaining way in, since
   * `TimeSignature` types the numerator as a bare number.
   */
  it('rejects a numerator that is not a whole number of beats', () => {
    const fractional: TimeSignature = { numerator: 2.5, denominator: 4, isCommon: false };

    expect(() => quantizeBar([], fractional, 16)).toThrowError(/numerator 2\.5/);
  });

  /**
   * The last way a span the duration table cannot fill reaches
   * `slotsToDurations`: an onset that is not a number at all. It used to snap
   * to a NaN slot and yield an empty bar - no notes, no rests, no complaint.
   */
  it('rejects an onset that is not a number', () => {
    expect(() => quantizeBar([at(NaN, 0)], FOUR_FOUR, 16)).toThrowError(/NaN/);
  });

  it('copies each pitch rather than aliasing the caller\'s object', () => {
    const source = on(0, 2, 3);
    const beats = quantizeBar([source, on(1.25, 1, 5)], FOUR_FOUR, 16);

    expect(beats[0].notes[0].pitch).toEqual(source.pitch);
    expect(beats[0].notes[0].pitch).not.toBe(source.pitch);
    // And each tied fragment gets its own, so editing one does not edit the
    // rest of the tie. ComposerService.replaceDocument stores by reference.
    expect(beats[1].notes[0].pitch).not.toBe(beats[0].notes[0].pitch);
  });

  /**
   * The invariant the whole feature rests on. Independently snapping onsets to
   * a grid - the obvious approach, and what most transcribers do - produces
   * durations that overrun or underfill the bar, which is the root of the
   * ragged 32nd-note-and-tie mess such tools are known for.
   *
   * Length alone is not enough to pin that down: `beatSlots` never inspects
   * `notes` or `isRest`, so a `quantizeBar` that discarded its notes and
   * emitted a bar of rests would satisfy it for every case below. Nor is
   * counting the attacks: a `quantizeBar` that struck the right number of
   * slots with the wrong pitches on them would pass that too. So each case
   * reconstructs, from the emitted beats alone, which pitches are struck at
   * which slot offset, and compares that against the input.
   *
   * Struck notes, not non-rest beats: a span no single value can express is
   * split by `slotsToDurations` into several `BeatDoc`s for one onset, and the
   * continuation fragments are tied.
   */
  it('always produces exactly one bar of music, with every onset struck', () => {
    const signatures: TimeSignature[] = [
      { numerator: 4, denominator: 4, isCommon: true },
      { numerator: 3, denominator: 4, isCommon: false },
      { numerator: 6, denominator: 8, isCommon: false },
      { numerator: 5, denominator: 4, isCommon: false }
    ];

    for (const signature of signatures) {
      for (const finest of [4, 8, 16, 32, 64] as FinestDivision[]) {
        if (finest < signature.denominator) continue;

        const slotsPerBeat = finest / signature.denominator;
        const totalSlots = signature.numerator * slotsPerBeat;

        for (let seed = 0; seed < 20; seed++) {
          // One note per string, cycling: notes sharing a slot become a chord,
          // and a chord may not put two numbers on one tab line. The onsets
          // are spread widely enough that no two are close enough to cluster,
          // so each still snaps on its own.
          const notes: PlacedNote[] = Array.from({ length: seed % 7 }, (_, i) => ({
            beatInBar: (((seed * 7 + i * 13) % 100) / 100) * signature.numerator,
            pitch: { kind: 'fretted', string: i % 4, fret: i } as NotePitch
          }));

          const beats = quantizeBar(notes, signature, finest);

          expect(beatSlots(beats, finest)).toBe(totalSlots);

          // What should be struck where: onsets sharing a slot merge into one
          // chord, and an onset rounding past the final slot is pulled back
          // onto it. Walked in onset order, since that is the order a chord's
          // notes are written in - and two onsets far apart can still share
          // the final slot once the clamp has pulled the later one back.
          const bySlot = new Map<number, NotePitch[]>();
          for (const note of [...notes].sort((a, b) => a.beatInBar - b.beatInBar)) {
            const slot = Math.min(
              totalSlots - 1,
              Math.max(0, Math.round(note.beatInBar * slotsPerBeat))
            );
            const chord = bySlot.get(slot);
            if (chord) chord.push(note.pitch);
            else bySlot.set(slot, [note.pitch]);
          }
          const expected = [...bySlot.keys()]
            .sort((a, b) => a - b)
            .map(slot => [slot, bySlot.get(slot)] as [number, NotePitch[]]);

          // What is struck where, read back out of the beats by accumulating
          // slot offsets. Only the offsets matter, not how many `BeatDoc`s a
          // span was spelled with.
          const struck: [number, NotePitch[]][] = [];
          let offset = 0;
          for (const beat of beats) {
            if (!beat.isRest && beat.notes.length > 0 && !beat.notes[0].isTied) {
              struck.push([offset, beat.notes.map(note => note.pitch)]);
            }
            offset += beatSlots([beat], finest);
          }

          expect(struck).toEqual(expected);

          // Redundant given the comparison above, but it says out loud the
          // thing a reader most wants guaranteed: no input note is dropped.
          expect(struck.reduce((sum, [, chord]) => sum + chord.length, 0))
            .toBe(notes.length);
        }
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './transcription-quantize'`.

**Step 3: Write minimal implementation**

Create `src/app/services/transcription-quantize.ts`:

```typescript
import {
  BeatDoc,
  DurationValue,
  NotePitch,
  TimeSignature,
  createDefaultBeatEffects,
  createDefaultNoteEffects
} from '../models/composer.model';
import { FinestDivision } from '../models/transcription.model';

/**
 * Lays a bar's onsets onto a rhythmic grid and gives them written durations.
 *
 * Two guarantees, in that order of importance. A bar always sums to exactly
 * one bar: onsets snap to slots and the span between two of them is
 * decomposed into values that fill it exactly, so notation cannot drift the
 * way it does when each onset is rounded and handed its own independent
 * duration. And the meter stays visible: a span is cut where it crosses a
 * beat or the middle of the bar before values are chosen, because a value
 * that merely fits the length can still hide every beat it crosses.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the arithmetic can be checked directly
 * against hand-written bars.
 */

/** A note already placed on the fretboard, still waiting for a duration. */
export interface PlacedNote {
  /** Position within the bar, in denominator-unit beats. */
  beatInBar: number;
  pitch: NotePitch;
}

/** One writable duration: a note value plus 0-2 augmentation dots. */
export interface DurationUnit {
  duration: DurationValue;
  dots: number;
  slots: number;
}

/** Slots added by each augmentation dot: none, half again, three quarters again. */
const DOT_MULTIPLIER = [1, 1.5, 1.75];

/**
 * Dots this module will write.
 *
 * Double dots are legal, and `DOT_MULTIPLIER` still measures them so
 * `beatSlots` can size a beat that came from somewhere else. But they are rare
 * enough in real parts to read as a mistake, and longest-first decomposition
 * reaches for them constantly: the rest in front of a note on the "and of 4"
 * comes out as a single double-dotted half. One dot is the practical ceiling.
 */
const MAX_WRITTEN_DOTS = 1;

/** Every duration expressible on this grid, longest first. */
function durationTable(finestDivision: FinestDivision): DurationUnit[] {
  const values: DurationValue[] = [1, 2, 4, 8, 16, 32, 64];
  const table: DurationUnit[] = [];

  for (const duration of values) {
    for (let dots = 0; dots <= MAX_WRITTEN_DOTS; dots++) {
      const slots = (finestDivision / duration) * DOT_MULTIPLIER[dots];
      if (Number.isInteger(slots) && slots >= 1) {
        table.push({ duration, dots, slots });
      }
    }
  }

  return table.sort((a, b) => b.slots - a.slots);
}

/**
 * Widest gap between two onsets that still counts as one attack.
 *
 * Half a slot is the natural tolerance, being exactly the rounding radius, but
 * on a coarse grid half a slot is a rhythm rather than a chord: at
 * `finestDivision: 4` it is a whole eighth note. So it is capped here too, at
 * a thirty-second note's worth of beat - about 62 ms at 120 BPM, comfortably
 * wider than the 30-40 ms a hand takes to cross the strings.
 */
const MAX_CHORD_SPREAD_BEATS = 0.125;

/**
 * Adds a pitch to a chord, dropping it if its string is already spoken for.
 *
 * A tab line holds one number, so a fretted staff shows at most one note per
 * string - the invariant `ComposerService.setNoteAtCursor` enforces on the
 * editing side. Two co-incident notes fingered to the same string, or one
 * onset detected twice, would otherwise write two numbers on one line. The
 * earlier onset wins.
 */
function addToChord(chord: NotePitch[], pitch: NotePitch): void {
  if (
    pitch.kind === 'fretted'
    && chord.some(taken => taken.kind === 'fretted' && taken.string === pitch.string)
  ) {
    return;
  }

  chord.push(pitch);
}

/**
 * Groups a bar's onsets onto grid slots, one chord per slot.
 *
 * Onsets are clustered before they are rounded, not after. Rounding first and
 * merging on the result splits a chord whenever its notes straddle a slot
 * midpoint - for a 40 ms spread at 120 BPM on a sixteenth grid, roughly a
 * third of the time - and writes the two halves as separate attacks a
 * thirty-second apart, which is exactly the raggedness this module exists to
 * avoid.
 */
function snapToSlots(
  notes: PlacedNote[],
  slotsPerBeat: number,
  totalSlots: number
): Map<number, NotePitch[]> {
  const tolerance = Math.min(0.5, MAX_CHORD_SPREAD_BEATS * slotsPerBeat);
  const sorted = [...notes].sort((a, b) => a.beatInBar - b.beatInBar);

  const clusters: { onsets: number[]; pitches: NotePitch[] }[] = [];
  for (const note of sorted) {
    const onset = note.beatInBar * slotsPerBeat;
    const open = clusters[clusters.length - 1];

    // Measured from the cluster's first onset rather than its last, so a run
    // of closely spaced notes cannot chain into one arbitrarily wide chord.
    if (open && onset - open.onsets[0] <= tolerance) {
      open.onsets.push(onset);
      open.pitches.push(note.pitch);
    } else {
      clusters.push({ onsets: [onset], pitches: [note.pitch] });
    }
  }

  const chords = new Map<number, NotePitch[]>();
  for (const cluster of clusters) {
    const centre =
      cluster.onsets.reduce((sum, onset) => sum + onset, 0) / cluster.onsets.length;
    const slot = Math.min(totalSlots - 1, Math.max(0, Math.round(centre)));

    let chord = chords.get(slot);
    if (!chord) {
      chord = [];
      chords.set(slot, chord);
    }

    // Two clusters can still round onto one slot on a coarse grid, so the
    // per-string check belongs here rather than inside the cluster loop.
    for (const pitch of cluster.pitches) addToChord(chord, pitch);
  }

  return chords;
}

/**
 * The strong points of a bar, in slots.
 *
 * Longest-first decomposition only knows how long a span is, never where it
 * starts, and that is enough to produce spellings a reader has to decode: a
 * note on the "and of 2" of a 4/4 bar comes out as a half note plus an eighth,
 * a half note that begins halfway through beat 2 and hides the middle of the
 * bar. Cutting spans at these offsets first is what turns that into the
 * eighth-tied-to-half a reader expects.
 */
export interface MetricFrame {
  /**
   * Slots in one felt beat: a quarter in 4/4, a dotted quarter in 6/8. Not the
   * denominator unit, which in a compound meter is a subdivision of the beat.
   */
  beatUnit: number;
  /** Slots to the middle of the bar, or null if the bar has no even middle. */
  halfBar: number | null;
}

/** Reads the felt beat and the half-bar off a time signature. */
export function metricFrame(
  timeSignature: TimeSignature,
  slotsPerBeat: number
): MetricFrame {
  // 6/8, 9/8 and 12/8 are felt in dotted-quarter groups of three eighths. 3/8
  // is not: it is three beats, not one group of three.
  const isCompound =
    (timeSignature.denominator === 8 || timeSignature.denominator === 16)
    && timeSignature.numerator % 3 === 0
    && timeSignature.numerator > 3;

  const beatUnit = slotsPerBeat * (isCompound ? 3 : 1);
  const totalSlots = timeSignature.numerator * slotsPerBeat;
  const feltBeats = totalSlots / beatUnit;

  return {
    beatUnit,
    // The ear hears the middle of an even bar whether or not anything is
    // written there, which is why 4/4 splits at the half-bar and 3/4 does not.
    halfBar: feltBeats % 2 === 0 ? totalSlots / 2 : null
  };
}

/**
 * Cuts a span into fragments no single written value should cross.
 *
 * At most two cuts: one to finish the beat the span starts inside, and one at
 * the half-bar. What follows starts on a beat and is left alone, so a whole
 * note is still a whole note and a dotted half still a dotted half. Only spans
 * that begin off the beat, or straddle the middle of the bar, get broken up.
 */
function metricFragments(
  startSlot: number,
  slots: number,
  frame: MetricFrame
): { start: number; slots: number }[] {
  const fragments: { start: number; slots: number }[] = [];
  let start = startSlot;
  let remaining = slots;

  const intoBeat = start % frame.beatUnit;
  if (intoBeat !== 0) {
    const head = Math.min(remaining, frame.beatUnit - intoBeat);
    fragments.push({ start, slots: head });
    start += head;
    remaining -= head;
  }

  if (remaining > 0 && frame.halfBar !== null) {
    const nextHalf = (Math.floor(start / frame.halfBar) + 1) * frame.halfBar;
    if (nextHalf < start + remaining) {
      const head = nextHalf - start;
      fragments.push({ start, slots: head });
      start += head;
      remaining -= head;
    }
  }

  if (remaining > 0) fragments.push({ start, slots: remaining });

  return fragments;
}

/**
 * Decomposes a span of grid slots into writable durations, longest first
 * within each metric fragment.
 *
 * Guaranteed to sum to exactly `slots`, whatever the fragments come out as,
 * because one slot is by definition the finest division and so is always
 * available as a last resort. That guarantee is what keeps every derived bar
 * exactly full; the fragmenting only decides how the span is spelled.
 *
 * Throws rather than under-summing on a span it cannot fill exactly. A
 * fractional or negative span would otherwise decompose to something short
 * and the bar would silently come out wrong, which is the one failure this
 * module exists to rule out; a NaN one - the shape a NaN `beatInBar` arrives
 * in - would empty the bar with no diagnostic at all.
 */
export function slotsToDurations(
  slots: number,
  finestDivision: FinestDivision,
  startSlot: number,
  frame: MetricFrame
): DurationUnit[] {
  if (!Number.isInteger(slots) || slots < 0) {
    throw new Error(`cannot write a span of ${slots} slots`);
  }

  if (!Number.isInteger(startSlot) || startSlot < 0) {
    throw new Error(`cannot start a span at slot ${startSlot}`);
  }

  const table = durationTable(finestDivision);
  const out: DurationUnit[] = [];

  for (const fragment of metricFragments(startSlot, slots, frame)) {
    let remaining = fragment.slots;

    while (remaining > 0) {
      const unit = table.find(candidate => candidate.slots <= remaining);
      if (!unit) break;
      out.push(unit);
      remaining -= unit.slots;
    }
  }

  return out;
}

/**
 * Lays a bar's notes onto the rhythmic grid.
 *
 * Onsets close enough together to be one attack collapse into a chord, chords
 * are snapped to slots, each runs until the next one starts, and gaps become
 * rests. A span no single value can express is split and tied rather than
 * rounded, so the bar total never moves.
 */
export function quantizeBar(
  notes: PlacedNote[],
  timeSignature: TimeSignature,
  finestDivision: FinestDivision
): BeatDoc[] {
  const slotsPerBeat = finestDivision / timeSignature.denominator;
  if (!Number.isInteger(slotsPerBeat) || slotsPerBeat < 1) {
    throw new Error(
      `finestDivision ${finestDivision} cannot express a ` +
      `${timeSignature.numerator}/${timeSignature.denominator} bar`
    );
  }

  // A fractional numerator is the one route by which a non-integer span could
  // reach slotsToDurations, where it would silently under-sum rather than
  // fail. TimeSignature types the numerator as a bare number, so the type
  // system cannot rule this out the way FinestDivision rules out bad grids.
  if (!Number.isInteger(timeSignature.numerator) || timeSignature.numerator < 1) {
    throw new Error(
      `numerator ${timeSignature.numerator} is not a whole number of beats`
    );
  }

  const totalSlots = timeSignature.numerator * slotsPerBeat;

  const chords = snapToSlots(notes, slotsPerBeat, totalSlots);
  const frame = metricFrame(timeSignature, slotsPerBeat);
  const beats: BeatDoc[] = [];

  const emit = (start: number, slots: number, pitches: NotePitch[] | null): void => {
    slotsToDurations(slots, finestDivision, start, frame).forEach((unit, index) => {
      beats.push({
        duration: unit.duration,
        dots: unit.dots,
        tuplet: null,
        isRest: pitches === null,
        notes: (pitches ?? []).map(pitch => ({
          // Copied, not aliased: `ComposerService.replaceDocument` stores the
          // document by reference, so every NoteDoc needs a pitch of its own
          // or editing one tied fragment would edit the whole tie.
          pitch: { ...pitch },
          // Only the first fragment is struck; the rest are held over.
          isTied: index > 0,
          accidental: 'auto' as const,
          effects: createDefaultNoteEffects()
        })),
        dynamics: null,
        lyrics: null,
        text: null,
        effects: createDefaultBeatEffects()
      });
    });
  };

  const starts = [...chords.keys()].sort((a, b) => a - b);

  if (starts.length === 0) {
    emit(0, totalSlots, null);
    return beats;
  }

  if (starts[0] > 0) emit(0, starts[0], null);

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : totalSlots;
    // Non-null assertion is sound: `start` came out of `chords.keys()`, so the
    // map is guaranteed to hold an entry for it.
    emit(start, end - start, chords.get(start)!);
  });

  return beats;
}

/** Slots a beat list occupies. Used to assert bars come out exactly full. */
export function beatSlots(beats: BeatDoc[], finestDivision: FinestDivision): number {
  return beats.reduce(
    (sum, beat) => sum + (finestDivision / beat.duration) * DOT_MULTIPLIER[beat.dots],
    0
  );
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 15 tests.

**Step 5: Commit**

```bash
git add src/app/services/transcription-quantize.ts src/app/services/transcription-quantize.spec.ts
git commit -m "feat: Add bar quantization with exact-fill guarantee"
```

---

## Task 4: Fingering assignment

The centrepiece. Chooses a string and fret for every note by Viterbi, with hand-movement cost scaled by the time available to move.

**Files:**
- Create: `src/app/services/transcription-fingering.ts`
- Test: `src/app/services/transcription-fingering.spec.ts`

**Step 1: Write the failing test**

Create `src/app/services/transcription-fingering.spec.ts`:

```typescript
import {
  STANDARD_BASS_TUNING,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { assignFingering, candidatesFor } from './transcription-fingering';

const SETTINGS = createDefaultDerivationSettings();

describe('candidatesFor', () => {
  it('finds every string that can reach a pitch', () => {
    // A1 = 33: the open A string, or fret 5 on the E string.
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 0, 24)).toEqual([
      { string: 2, fret: 0 },
      { string: 3, fret: 5 }
    ]);
  });

  it('shifts every option by the capo, dropping what falls behind it', () => {
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 2, 24)).toEqual([
      { string: 3, fret: 3 }
    ]);
  });

  it('drops options past the last fret', () => {
    // G2 = 43 sits at fret 15 on the E string, out of reach on a 12-fret neck.
    expect(candidatesFor(43, STANDARD_BASS_TUNING, 0, 12)).toEqual([
      { string: 0, fret: 0 },
      { string: 1, fret: 5 },
      { string: 2, fret: 10 }
    ]);
  });

  it('returns nothing for a pitch below the instrument', () => {
    expect(candidatesFor(20, STANDARD_BASS_TUNING, 0, 24)).toEqual([]);
  });
});

describe('assignFingering', () => {
  /**
   * `Candidate.string` is a 0-based subscript into the tuning; a ScoreDoc's
   * string number is 1-based. Handing the subscript straight out is not an
   * off-by-one in a label - `ScoreDocMapperService.flipString` counts strings
   * from the other end, so on a bass every note lands a fourth sharp and the
   * top string maps to a string that does not exist.
   *
   * So this pins the two ends of the neck to the two ends of the tuning array,
   * with the array's own ordering asserted rather than assumed. Restating the
   * numbers on either side would survive the same mistake.
   */
  it('numbers strings from the highest-pitched, the way tab does', () => {
    const top = 0;
    const bottom = STANDARD_BASS_TUNING.length - 1;

    expect(STANDARD_BASS_TUNING[top]).toBe(Math.max(...STANDARD_BASS_TUNING));
    expect(STANDARD_BASS_TUNING[bottom]).toBe(Math.min(...STANDARD_BASS_TUNING));

    const openTop = assignFingering(
      [{ pitch: STANDARD_BASS_TUNING[top], onsetSec: 0 }],
      SETTINGS
    );
    const openBottom = assignFingering(
      [{ pitch: STANDARD_BASS_TUNING[bottom], onsetSec: 0 }],
      SETTINGS
    );

    // StaffDoc.tuning[0] is string 1, so the highest string is 1 and the
    // lowest is the string count - 4 on a bass, not 0 and 3.
    expect(openTop[0]).toEqual({ kind: 'fretted', string: 1, fret: 0 });
    expect(openBottom[0]).toEqual({
      kind: 'fretted',
      string: STANDARD_BASS_TUNING.length,
      fret: 0
    });
  });

  it('prefers an open string to the fretted equivalent', () => {
    expect(assignFingering([{ pitch: 33, onsetSec: 0 }], SETTINGS)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 }
    ]);
  });

  it('returns null where the instrument cannot play the pitch', () => {
    expect(assignFingering([{ pitch: 20, onsetSec: 0 }], SETTINGS)).toEqual([null]);
  });

  it('carries on after an unplayable note', () => {
    const result = assignFingering(
      [{ pitch: 20, onsetSec: 0 }, { pitch: 33, onsetSec: 1 }],
      SETTINGS
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ kind: 'fretted', string: 3, fret: 0 });
  });

  /**
   * The thesis of the feature, in two tests.
   *
   * The same three pitches are fingered differently depending only on how much
   * time there is between them. Played fast, the hand stays put and takes the
   * high fret on a lower string; played slowly, it has time to shift down to
   * the easier low fret. Assigning each note its lowest available fret - the
   * obvious approach - gives the low-fret answer both times, which is why such
   * tab skitters across the neck on fast passages.
   */
  it('stays in position when the notes come fast', () => {
    const fast = assignFingering(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 0.1 },
        { pitch: 45, onsetSec: 0.2 }
      ],
      SETTINGS
    );

    expect(fast[2]).toEqual({ kind: 'fretted', string: 3, fret: 12 });
  });

  it('shifts down the neck when there is time to move', () => {
    const slow = assignFingering(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 2 },
        { pitch: 45, onsetSec: 4 }
      ],
      SETTINGS
    );

    expect(slow[2]).toEqual({ kind: 'fretted', string: 1, fret: 2 });
  });

  /**
   * Charging nothing for a shift across an open string does not merely permit
   * a leap, it pays for one. `55 -> 45` on its own gives the sane
   * `s1f12 | s3f12`; interposing an open A over the same 0.04s used to buy
   * fret 22, because zeroing both move costs made staying on one string save
   * more in string-change cost than the leap cost. And it composes: an
   * alternating fretted/open figure bought unlimited free travel.
   */
  it('does not buy a leap with an open string in the middle', () => {
    const figure = assignFingering(
      [
        { pitch: 55, onsetSec: 0 },
        { pitch: 33, onsetSec: 0.02 },
        { pitch: 45, onsetSec: 0.04 }
      ],
      SETTINGS
    );

    expect(figure[0]).toEqual({ kind: 'fretted', string: 1, fret: 12 });
    expect(figure.every(pitch => pitch?.kind === 'fretted' && pitch.fret <= 12)).toBe(true);
  });

  it('pulls the hand towards a position hint', () => {
    const hinted = assignFingering(
      [{ pitch: 45, onsetSec: 0 }],
      { ...SETTINGS, positionHint: 12 }
    );

    expect(hinted[0]).toEqual({ kind: 'fretted', string: 3, fret: 12 });
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './transcription-fingering'`.

**Step 3: Write minimal implementation**

Create `src/app/services/transcription-fingering.ts`:

```typescript
import { NotePitch } from '../models/composer.model';
import { DerivationSettings } from '../models/transcription.model';

/**
 * Chooses where on the neck each note is played.
 *
 * The one idea here is that a hand movement costs what the time available
 * makes it cost: a five-fret shift is nothing across a rest and unacceptable
 * between two sixteenths. Per-note lowest-fret assignment cannot express
 * that, which is why tab from such tools skitters across the neck on fast
 * passages. Scoring whole paths with a Viterbi pass can.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the costs can be checked against fixtures
 * chosen to separate the fast answer from the slow one.
 */

export interface FingeringInput {
  /** MIDI pitch. */
  pitch: number;
  onsetSec: number;
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
 * Chooses a string and fret for every note, minimising total playing effort.
 *
 * The interesting term is movement cost scaled by the gap to the previous
 * note. A five-fret shift is free across a rest and unacceptable between two
 * sixteenths, which is exactly the judgement a player makes and exactly what
 * per-note lowest-fret assignment cannot express.
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
            // Tuning subscript to tab string number; see the docblock.
            string: candidate.string + 1,
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
```

**Step 4: Run test to verify it passes**

Expected: PASS, 12 tests.

If the two position tests fail, the weights are miscalibrated rather than the algorithm being wrong — check `MOVE_REFERENCE_SEC` and `FRET_HEIGHT_WEIGHT` first. Both fixtures were chosen so the fast and slow answers differ under the constants above.

**Step 5: Commit**

```bash
git add src/app/services/transcription-fingering.ts src/app/services/transcription-fingering.spec.ts
git commit -m "feat: Add Viterbi fingering assignment"
```

---

## Task 5: Octave correction

A cheap, instrument-aware fix for the most common detector error on bass: locking onto the second harmonic and reporting a pitch an octave high.

**Files:**
- Create: `src/app/services/transcription-octave.ts`
- Test: `src/app/services/transcription-octave.spec.ts`

**Step 1: Write the failing test**

Create `src/app/services/transcription-octave.spec.ts`:

```typescript
import {
  DetectedNote,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { correctOctaves } from './transcription-octave';

const SETTINGS = createDefaultDerivationSettings();

const note = (pitch: number): DetectedNote => ({
  id: `n${pitch}`,
  pitch,
  onsetSec: 0,
  offsetSec: 1,
  confidence: 1,
  bendCents: []
});

describe('correctOctaves', () => {
  it('raises a pitch below the lowest string into range', () => {
    // A0 = 21 is below the open E string (28), so it must be A1 = 33.
    expect(correctOctaves([note(21)], SETTINGS)[0].pitch).toBe(33);
  });

  it('lowers a pitch beyond the last fret into range', () => {
    // Highest playable is 43 + 24 = 67.
    expect(correctOctaves([note(100)], SETTINGS)[0].pitch).toBe(64);
  });

  it('leaves a playable pitch alone', () => {
    expect(correctOctaves([note(45)], SETTINGS)[0].pitch).toBe(45);
  });

  it('accounts for a capo raising the lowest playable pitch', () => {
    const capoed = { ...SETTINGS, capo: 5 };
    expect(correctOctaves([note(30)], capoed)[0].pitch).toBe(42);
  });

  /**
   * SETTINGS is the unmodified default everywhere above except the capo test,
   * and [43, 38, 33, 28] is value-identical to what a hardcoded bass range
   * would use. So `lowest = 28 + settings.capo; highest = 67` - a fold that
   * reads the capo but ignores the tuning and the fret count entirely - passes
   * every case above. Only a different instrument tells the two apart.
   */
  it('folds against the configured instrument, not a hardcoded bass range', () => {
    const guitar = { ...SETTINGS, tuning: [64, 59, 55, 50, 45, 40], maxFret: 12 };

    // 33 is playable on a bass but a fourth below a guitar's lowest string, so
    // it has to fold up. 74 is past a bass's last fret but sits at fret 10 of
    // the guitar's top string, so it must not fold down.
    expect(correctOctaves([note(33), note(74)], guitar).map(entry => entry.pitch))
      .toEqual([45, 74]);
  });

  /**
   * The two loops run in sequence, so the second can undo the first: from a
   * pitch above the range it lands within 12 of `highest`, which is below
   * `lowest` unless the range is at least an octave wide. Without the guard
   * the 36 here folds to 24 - unplayable either way, but no longer visibly so.
   */
  it('leaves a range narrower than an octave alone', () => {
    const narrow = { ...SETTINGS, tuning: [28], maxFret: 5 };

    expect(correctOctaves([note(36)], narrow)[0].pitch).toBe(36);
  });

  it('does not mutate its input', () => {
    const notes = [note(21)];
    correctOctaves(notes, SETTINGS);
    expect(notes[0].pitch).toBe(21);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './transcription-octave'`.

**Step 3: Write minimal implementation**

Create `src/app/services/transcription-octave.ts`:

```typescript
import { DetectedNote, DerivationSettings } from '../models/transcription.model';

/**
 * Folds out-of-range pitches back onto the instrument.
 *
 * Detectors are weakest in the bass register: fundamentals below 100 Hz sit
 * where spectral resolution is poorest, and the classic failure is locking
 * onto the second harmonic and reporting a pitch an octave high. The pipeline
 * knows something the model does not - a pitch outside the instrument's range
 * is simply impossible - so folding by octaves recovers the intended note
 * whenever the error pushed it past either end.
 *
 * It cannot catch an octave error that lands somewhere still playable; that
 * needs surrounding context and is left for later.
 */
export function correctOctaves(
  notes: DetectedNote[],
  settings: DerivationSettings
): DetectedNote[] {
  const lowest = Math.min(...settings.tuning) + settings.capo;
  const highest = Math.max(...settings.tuning) + settings.capo + settings.maxFret;

  // A range narrower than an octave has no safe fold.
  if (highest - lowest < 12) return notes;

  return notes.map(note => {
    let pitch = note.pitch;
    while (pitch < lowest) pitch += 12;
    while (pitch > highest) pitch -= 12;
    return pitch === note.pitch ? note : { ...note, pitch };
  });
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add src/app/services/transcription-octave.ts src/app/services/transcription-octave.spec.ts
git commit -m "feat: Add instrument-aware octave correction"
```

---

## Task 6: deriveScore assembly

Wires the pieces into the single public entry point.

**Files:**
- Create: `src/app/services/score-derivation.ts`
- Test: `src/app/services/score-derivation.spec.ts`

**Step 1: Write the failing test**

Create `src/app/services/score-derivation.spec.ts`:

```typescript
import {
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { beatSlots } from './transcription-quantize';
import { deriveScore } from './score-derivation';

const note = (pitch: number, onsetSec: number, confidence = 1): DetectedNote => ({
  id: `${pitch}@${onsetSec}`,
  pitch,
  onsetSec,
  offsetSec: onsetSec + 0.4,
  confidence,
  bendCents: []
});

/** Eight beats at 120 BPM: two bars of 4/4. */
function session(notes: DetectedNote[]): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes,
    grid: {
      beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
      downbeatIndices: [0, 4],
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    },
    settings: createDefaultDerivationSettings()
  };
}

describe('deriveScore', () => {
  it('writes one bar per four beats of material', () => {
    const score = deriveScore(session([note(33, 0), note(35, 2.0)]));

    expect(score.masterBars.length).toBe(2);
  });

  it('keeps staff bars parallel to master bars', () => {
    const score = deriveScore(session([note(33, 0), note(35, 2.0)]));
    const staff = score.tracks[0].staves[0];

    expect(staff.bars.length).toBe(score.masterBars.length);
  });

  it('fills every bar exactly', () => {
    const score = deriveScore(session([note(33, 0), note(35, 0.75), note(40, 2.2)]));
    const staff = score.tracks[0].staves[0];

    for (const bar of staff.bars) {
      expect(beatSlots(bar.voices[0].beats, 16)).toBe(16);
    }
  });

  it('leaves out notes below the confidence floor', () => {
    const score = deriveScore(session([note(33, 0), note(35, 1.0, 0.05)]));
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;

    expect(beats.filter(beat => !beat.isRest).length).toBe(1);
  });

  it('reads the tempo off the beat grid', () => {
    expect(deriveScore(session([note(33, 0)])).tempo).toBe(120);
  });

  it('produces a tab staff tuned as configured', () => {
    const staff = deriveScore(session([note(33, 0)])).tracks[0].staves[0];

    expect(staff.showTablature).toBe(true);
    expect(staff.tuning).toEqual([43, 38, 33, 28]);
  });

  it('names the score after its source', () => {
    expect(deriveScore(session([note(33, 0)])).title).toBe('bassline.wav');
  });

  it('produces a valid empty score when nothing was detected', () => {
    const score = deriveScore(session([]));
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;

    expect(score.masterBars.length).toBe(1);
    expect(beats.every(beat => beat.isRest)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './score-derivation'`.

**Step 3: Write minimal implementation**

Create `src/app/services/score-derivation.ts`:

```typescript
import {
  BarDoc,
  KeySignature,
  MasterBarDoc,
  NotePitch,
  ScoreDoc,
  StaffDoc,
  TrackDoc,
  createDefaultMasterBar,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import { TranscriptionSession } from '../models/transcription.model';
import { assignFingering } from './transcription-fingering';
import { correctOctaves } from './transcription-octave';
import { PlacedNote, quantizeBar } from './transcription-quantize';
import { gridTempo, secondsToBeats } from './transcription-timing';

/** General MIDI program 33: electric bass, finger. */
const BASS_PROGRAM = 33;

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

/**
 * Interprets detected events as notation.
 *
 * Pure and fast, so every setting is a live knob: changing tuning, capo,
 * meter, grid or confidence floor re-derives the whole score rather than
 * re-running detection. That is the point of keeping raw events around.
 */
export function deriveScore(session: TranscriptionSession): ScoreDoc {
  const { settings, grid } = session;
  const timeSignature = grid.timeSignature;

  const audible = session.notes
    .filter(note => note.confidence >= settings.confidenceFloor)
    .sort((a, b) => a.onsetSec - b.onsetSec);

  const corrected = correctOctaves(audible, settings);

  // Fingering runs across the whole piece rather than bar by bar, so hand
  // position carries over bar lines the way a player's does. The NotePitch
  // values come back with 1-based tab string numbers, matching StaffDoc.tuning
  // and ScoreDocMapperService, so nothing here has to renumber them.
  const fingering = assignFingering(
    corrected.map(note => ({ pitch: note.pitch, onsetSec: note.onsetSec })),
    settings
  );

  const slotsPerBeat = settings.finestDivision / timeSignature.denominator;
  const slotsPerBar = timeSignature.numerator * slotsPerBeat;

  const placed: { bar: number; beatInBar: number; pitch: NotePitch }[] = [];
  corrected.forEach((note, index) => {
    const pitch = fingering[index];
    if (!pitch) return;

    // Anything before the first downbeat is pulled onto it; a proper pickup
    // bar needs a negative-bar concept the score model does not carry.
    const beat = Math.max(0, secondsToBeats(note.onsetSec, grid));

    // The bar comes off the rounded slot, not the raw beat: a note in the last
    // half-slot of a bar belongs on the next bar's downbeat, and choosing the
    // bar first would pull it back onto this bar's final slot instead. The
    // position handed on stays unrounded, so quantizeBar can still see two
    // onsets a few tens of milliseconds apart as one chord.
    const bar = Math.floor(Math.round(beat * slotsPerBeat) / slotsPerBar);
    placed.push({ bar, beatInBar: beat - bar * timeSignature.numerator, pitch });
  });

  const barCount = placed.reduce((max, entry) => Math.max(max, entry.bar), 0) + 1;

  const masterBars: MasterBarDoc[] = Array.from({ length: barCount }, (_, index) => ({
    ...createDefaultMasterBar(),
    // Only bar 1 states the signature; the rest inherit it.
    timeSignature: index === 0 ? timeSignature : null
  }));

  const key = settings.key ?? C_MAJOR;

  const bars: BarDoc[] = Array.from({ length: barCount }, (_, index) => {
    const inBar: PlacedNote[] = placed
      .filter(entry => entry.bar === index)
      .map(entry => ({ beatInBar: entry.beatInBar, pitch: entry.pitch }));

    return {
      clef: 'f4',
      clefOttava: 'regular',
      keySignature: key,
      voices: [{ beats: quantizeBar(inBar, timeSignature, settings.finestDivision) }]
    };
  });

  const staff: StaffDoc = {
    tuning: [...settings.tuning],
    tuningLabel: 'Transcribed',
    capo: settings.capo,
    transpose: 0,
    displayTranspose: 0,
    showStandardNotation: true,
    showTablature: true,
    showSlash: false,
    showNumbered: false,
    bars
  };

  const track: TrackDoc = {
    id: 'transcription',
    name: 'Transcription',
    shortName: 'Trn',
    color: '#2c3e50',
    playback: createDefaultPlaybackInfo(BASS_PROGRAM),
    staves: [staff]
  };

  return {
    title: session.sourceName,
    subTitle: '',
    artist: '',
    album: '',
    tempo: gridTempo(grid),
    masterBars,
    tracks: [track]
  };
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 8 tests.

**Step 5: Run the full suite**

```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

Expected: PASS — 58 baseline + 59 new = **117 tests, 0 failures**.

The 59 break down as 5 + 12 + 15 + 12 + 7 + 8 across tasks 1-6.

**Step 6: Commit**

```bash
git add src/app/services/score-derivation.ts src/app/services/score-derivation.spec.ts
git commit -m "feat: Assemble detected events into a ScoreDoc"
```

---

## Done when

- `npx ng test --watch=false --browsers=ChromeHeadless` reports 117 passing, 0 failures.
- `deriveScore(session)` returns a `ScoreDoc` that `ComposerService.replaceDocument()` accepts unchanged.
- Every derived bar sums to exactly one bar **and strikes every onset it was given,
  with the pitches that onset carried**, for every time signature and grid tested.
  Length alone is not the invariant: a `quantizeBar` that discarded its notes and
  emitted rests would satisfy that half, and one that shuffled pitches between
  slots would satisfy a count of attacks.
- The two position-stability tests pass, proving fingering responds to available time.

## Deliberately not in M1

- **Cost-based quantization DP.** Greedy decomposition inside metric fragments guarantees exact bars and keeps the beat visible; choosing between the spellings that remain — dotted quarter vs quarter-tied-to-eighth, both metrically sound — by onset strength is the refinement.
- **Key inference.** `settings.key` is honoured; `null` falls back to C major. Krumhansl-Schmuckler correlation lands with the notation staff work, since tab is unaffected.
- **Triplets.** `allowTriplets` exists in the settings and is ignored.
- **Chords.** Simultaneous notes merge into one beat, which is right, but no chord-shape validation happens — that arrives with guitar polyphony.
- **Pickup bars.** Notes before the first downbeat are pulled onto beat 1.
- **Note durations.** `DetectedNote.offsetSec` is read by nothing: every note sustains until the next onset, so rests appear only before a bar's first note. See scope decision 5.
- **Context-based octave correction.** Only out-of-range folding is implemented; an octave error landing on a playable pitch survives.
- **Dynamics.** `DetectedNote` records no amplitude or velocity, so every `BeatDoc.dynamics` is `null`. A decision, not an oversight: see scope decision 4.
