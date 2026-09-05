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
 *
 * Bars are not stated here, they are counted. `deriveScore` reads bar 1 as
 * starting at `beatsSec[0]` and every bar after it as another `numerator`
 * beats, so a corrected downbeat phase is expressed by trimming `beatsSec` -
 * the same move scope decision 3 makes for a corrected tempo. There was a
 * `downbeatIndices` array here saying the same thing a second time, and
 * nothing read it; a beat tracker that dropped or doubled a beat could have
 * filled it with downbeats the written bars disagreed with, and nothing would
 * have said so. M2's tracker reintroduces it together with the derivation
 * support that honours it, because a field derivation ignores is worse than no
 * field at all.
 */
export interface BeatGrid {
  /** Ascending. `beatsSec[0]` is the first downbeat. */
  beatsSec: number[];
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
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

/** The same grid with beat 3 held long: intervals 0.5, 0.5, 2.0, 0.5. */
const WOBBLY: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 3.0, 3.5] };

/** Slows at the end: intervals 0.5, 0.5, 0.5, 2.0. Median 0.5. */
const RITARDANDO: BeatGrid = { ...GRID, beatsSec: [0, 0.5, 1.0, 1.5, 3.5] };

/** Starts slow: intervals 2.0, 0.5, 0.5. Median 0.5. */
const ACCELERANDO: BeatGrid = {
  ...GRID,
  beatsSec: [0, 2.0, 2.5, 3.0]
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
    const single: BeatGrid = { ...GRID, beatsSec: [0.4] };
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
   * The other half of the same rule. A cut a reader does not need is as wrong
   * as a missing one: a span that starts on a metric boundary and ends on one
   * of that level or higher is already a single value, and breaking it writes
   * a tie the reader then has to undo. The case that shows up on every page is
   * the empty bar, which came out as two tied half rests.
   */
  it('writes a bar-filling note as a single whole note', () => {
    const beats = quantizeBar([at(0, 5)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [1, 0, false]
    ]);
  });

  it('writes an empty bar as a single whole rest', () => {
    const beats = quantizeBar([], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [1, 0, true]
    ]);
  });

  it('writes each half of a 4/4 bar as one half note', () => {
    // Slots 0-8 and 8-16. Each both starts and ends on a multiple of the
    // half-bar, so the half-bar is a boundary they meet rather than cross.
    const beats = quantizeBar([at(0, 5), at(2, 7)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [2, 0, false],
      [2, 0, false]
    ]);
    expect(beats.every(beat => !beat.notes[0].isTied)).toBe(true);
  });

  it('writes an empty 3/4 bar as a single dotted half rest', () => {
    const threeFour: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

    expect(
      quantizeBar([], threeFour, 16).map(beat => [beat.duration, beat.dots, beat.isRest])
    ).toEqual([[2, 1, true]]);
  });

  it('writes an empty 6/8 bar as a single dotted half rest', () => {
    const sixEight: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

    expect(
      quantizeBar([], sixEight, 8).map(beat => [beat.duration, beat.dots, beat.isRest])
    ).toEqual([[2, 1, true]]);
  });

  it('still cuts a span that crosses the half-bar unaligned', () => {
    // Slots 4-12: it opens on beat 2 and closes on beat 4, so neither end
    // touches the middle of the bar it crosses. Left whole it would be a half
    // note hiding the half-bar - the spelling the fragmenting exists to stop.
    const beats = quantizeBar([at(1, 5), at(3, 7)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [4, 0, true],   // quarter rest, beat 1
      [4, 0, false],  // beat 2
      [4, 0, false],  // tied across the half-bar into beat 3
      [4, 0, false]   // the note on beat 4
    ]);
    expect(beats[2].notes[0].isTied).toBe(true);
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
 * beat or the middle of the bar without being aligned to it, before values
 * are chosen, because a value that merely fits the length can still hide
 * every beat it crosses.
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
 * The window inside which two onsets are merged into one chord, in
 * denominator-unit beats - the units `secondsToBeats` reports and `PlacedNote`
 * carries.
 *
 * Exported because it is a contract, not an implementation detail.
 * `addToChord` drops the second of two notes merged onto one string, so
 * `assignFingering` has to have already moved apart everything this window
 * will merge. It cannot check that for itself: it runs before bars exist and
 * knows nothing of slots, so `score-derivation.ts` reads the window here and
 * hands it across. An independently sized window there - the 30 ms constant
 * this replaced - left a band of separations wide enough to merge and too wide
 * to separate, where the second note vanished with no rest, no error and no
 * record.
 */
export function chordToleranceBeats(slotsPerBeat: number): number {
  return Math.min(0.5 / slotsPerBeat, MAX_CHORD_SPREAD_BEATS);
}

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
  const tolerance = chordToleranceBeats(slotsPerBeat) * slotsPerBeat;
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
 * the half-bar. The rule at each level is the same - only a span that
 * *crosses* a boundary without being aligned to it needs breaking up. A span
 * that starts on a boundary and ends on one of that level or higher is
 * already spelled by a single value a reader can parse, so it is left whole:
 * a whole note stays a whole note, a dotted half a dotted half, and an empty
 * 4/4 bar one whole rest rather than two tied half rests.
 */
function metricFragments(
  startSlot: number,
  slots: number,
  frame: MetricFrame
): { start: number; slots: number }[] {
  const fragments: { start: number; slots: number }[] = [];
  let start = startSlot;
  let remaining = slots;

  // Starting on a beat is itself the alignment test at this level: the head
  // cut exists only to finish a beat the span opened partway through.
  const intoBeat = start % frame.beatUnit;
  if (intoBeat !== 0) {
    const head = Math.min(remaining, frame.beatUnit - intoBeat);
    fragments.push({ start, slots: head });
    start += head;
    remaining -= head;
  }

  if (remaining > 0 && frame.halfBar !== null) {
    const halfBar = frame.halfBar;

    // Both ends on a multiple of the half-bar - which includes the bar line,
    // the next level up, since `halfBar` is half of `totalSlots`. Such a span
    // is a unit the meter is built from, and cutting it would write a tie a
    // reader then has to undo: the bar-filling note in 4/4 is a whole note,
    // not a half tied to a half.
    const aligned = start % halfBar === 0 && (start + remaining) % halfBar === 0;

    const nextHalf = (Math.floor(start / halfBar) + 1) * halfBar;
    if (!aligned && nextHalf < start + remaining) {
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

Expected: PASS, 21 tests.

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
import { chordToleranceBeats } from './transcription-quantize';

const SETTINGS = createDefaultDerivationSettings();

/**
 * Beats per second in the fixtures below: 120 BPM in 4/4, the grid
 * `score-derivation.spec.ts` uses, so a quarter note is half a second and a
 * sixteenth is 0.125.
 */
const BEATS_PER_SEC = 2;

/**
 * The attack window `deriveScore` hands in at those settings: four sixteenth
 * slots to the beat, so `chordToleranceBeats` caps at half a slot - an eighth
 * of a beat, 62.5 ms here.
 */
const ATTACK_WINDOW_BEATS = chordToleranceBeats(SETTINGS.finestDivision / 4);

/**
 * `assignFingering` with the fixtures written in seconds.
 *
 * Every case here is a statement about a hand at 120 BPM, so the beat position
 * each onset carries is a restatement of its time rather than an independent
 * fixture value. Cases that are about the window itself pass their own.
 */
function finger(
  notes: { pitch: number; onsetSec: number }[],
  settings = SETTINGS,
  attackWindowBeats = ATTACK_WINDOW_BEATS
): ReturnType<typeof assignFingering> {
  return assignFingering(
    notes.map(note => ({ ...note, beatPosition: note.onsetSec * BEATS_PER_SEC })),
    settings,
    attackWindowBeats
  );
}

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

  /**
   * The capo test above only exercises the low end, where a capo obviously
   * takes options away. It also has to take them away at the top: frets are
   * counted from the capo, so bounding a capo-relative fret by `maxFret` lets
   * the capo lengthen the neck instead of shortening it.
   */
  it('drops options the capo has pushed off the end of the neck', () => {
    // A capo at 5 leaves 7 of a 12-fret neck, so G3 = 55 is the highest pitch
    // available and fret 7 of the G string is its only home. Fret 12 of the D
    // string is absolute fret 17, well past the end.
    expect(candidatesFor(55, STANDARD_BASS_TUNING, 5, 12)).toEqual([
      { string: 0, fret: 7 }
    ]);

    // One semitone higher there is nothing left to play it on.
    expect(candidatesFor(56, STANDARD_BASS_TUNING, 5, 12)).toEqual([]);
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

    const openTop = finger(
      [{ pitch: STANDARD_BASS_TUNING[top], onsetSec: 0 }],
      SETTINGS
    );
    const openBottom = finger(
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
    expect(finger([{ pitch: 33, onsetSec: 0 }], SETTINGS)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 }
    ]);
  });

  it('returns null where the instrument cannot play the pitch', () => {
    expect(finger([{ pitch: 20, onsetSec: 0 }], SETTINGS)).toEqual([null]);
  });

  it('carries on after an unplayable note', () => {
    const result = finger(
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
    const fast = finger(
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
    const slow = finger(
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
   * `s1f12 | s3f12`; interposing an open A across the same two thirty-seconds
   * used to buy fret 22, because zeroing both move costs made staying on one
   * string save more in string-change cost than the leap cost. And it
   * composes: an alternating fretted/open figure bought unlimited free travel.
   *
   * The onsets are thirty-seconds at 120 rather than the 20 ms this was
   * written with, which `separateSimultaneous` now reads as a single attack -
   * and repairing the collision put the first note back on fret 12 by
   * accident, which would have hidden the leap this exists to catch.
   */
  it('does not buy a leap with an open string in the middle', () => {
    const figure = finger(
      [
        { pitch: 55, onsetSec: 0 },
        { pitch: 33, onsetSec: 0.0625 },
        { pitch: 45, onsetSec: 0.125 }
      ],
      SETTINGS
    );

    expect(figure[0]).toEqual({ kind: 'fretted', string: 1, fret: 12 });
    expect(figure.every(pitch => pitch?.kind === 'fretted' && pitch.fret <= 12)).toBe(true);
  });

  /**
   * The Viterbi pass scores a sequence and cannot see that two notes sound at
   * once, so it fingers a dyad on whichever single string is cheapest. The
   * consequence is not just unreadable tab: a tab line holds one number, so
   * `transcription-quantize.ts` drops the second pitch and the note leaves the
   * score with nothing to show it was ever there.
   */
  it('moves a simultaneous note off a string already taken', () => {
    // 10 ms apart rather than exactly together: a detector does not report
    // two strings plucked at once to the sample, and a window that only
    // caught identical onsets would catch almost nothing real.
    const dyad = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 36, onsetSec: 0.01 }],
      SETTINGS
    );

    // Both notes still sound, on strings that can each hold a number.
    const sounded = dyad.map(pitch =>
      pitch?.kind === 'fretted'
        ? STANDARD_BASS_TUNING[pitch.string - 1] + pitch.fret
        : null
    );
    expect(sounded).toEqual([33, 36]);
    expect(new Set(dyad.map(pitch => pitch?.kind === 'fretted' && pitch.string)).size)
      .toBe(2);

    // Unrepaired both land on the A string, at frets 0 and 3.
    expect(dyad).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 4, fret: 8 }
    ]);
  });

  /**
   * Which note moves cannot be decided on cost alone. Above fret 24 of the D
   * string a bass has one string left, so a pitch up there has exactly one
   * candidate; if the open string it collides with claims that string first,
   * the constrained note is stranded on a collision it had a way out of.
   */
  it('moves whichever of two simultaneous notes has somewhere to go', () => {
    const dyad = finger(
      [{ pitch: 43, onsetSec: 0 }, { pitch: 63, onsetSec: 0.01 }],
      SETTINGS
    );

    // 63 can only be fret 20 of the G string, so the open G has to give way.
    expect(dyad).toEqual([
      { kind: 'fretted', string: 2, fret: 5 },
      { kind: 'fretted', string: 1, fret: 20 }
    ]);
  });

  /**
   * Not every collision is a mistake. A minor second at the bottom of a bass
   * lives on the E string at both ends, so there is no two-string fingering to
   * find and one of the two notes is lost downstream - which is what a player
   * would tell you about that interval on that instrument.
   */
  it('leaves a collision that no fingering can avoid', () => {
    expect(
      finger([{ pitch: 28, onsetSec: 0 }, { pitch: 30, onsetSec: 0.01 }], SETTINGS)
    ).toEqual([
      { kind: 'fretted', string: 4, fret: 0 },
      { kind: 'fretted', string: 4, fret: 2 }
    ]);
  });

  it('pulls the hand towards a position hint', () => {
    const hinted = finger(
      [{ pitch: 45, onsetSec: 0 }],
      { ...SETTINGS, positionHint: 12 }
    );

    expect(hinted[0]).toEqual({ kind: 'fretted', string: 3, fret: 12 });
  });

  // ---------------------------------------------------------------------
  // The weights themselves.
  //
  // The tests above pin behaviour the weights happen to produce; these pin
  // the weights. Each fixture was chosen by mutation: the answer below is
  // stable when its weight is nudged 10% either way, and changes when the
  // weight is zeroed or doubled. A fixture that only survives the true value
  // by a rounding error would pass here and prove nothing, so none were kept.
  // ---------------------------------------------------------------------

  /**
   * These two weights are one ratio, not two numbers. Every alternative
   * fingering of a pitch on an instrument tuned in fourths trades five frets
   * of height for one string of crossing, so `FRET_HEIGHT_WEIGHT * 5` and
   * `STRING_CHANGE_WEIGHT` are always weighed against each other and no
   * fixture can move one without moving the other. What can be pinned is
   * where the balance sits, which is what this does - from both sides.
   */
  it('balances a string crossing against the climb it saves', () => {
    // G#1 then G#2, two seconds apart: time enough to go anywhere.
    const octave = finger(
      [{ pitch: 32, onsetSec: 0 }, { pitch: 44, onsetSec: 2 }],
      SETTINGS
    );

    // Tip it towards crossing - no charge for it, or a dearer neck - and the
    // hand jumps three strings for fret 1. Tip it the other way and it never
    // leaves the E string, climbing to fret 16. Fret 6 of the D string is the
    // answer between them.
    expect(octave[1]).toEqual({ kind: 'fretted', string: 2, fret: 6 });
  });

  /**
   * The older open-string test cannot see this weight at all: `candidatesFor`
   * returns the open A first and ties break towards the first candidate, so
   * it passes with every weight set to zero. Here the open string has to earn
   * its place against a crossing, which is the only way the bonus can matter.
   */
  it('pays a bonus for an open string, without overpaying', () => {
    // G#1 then D2, a quarter apart. The open D is two strings away; fret 5 of
    // the A string is one. Without the bonus the nearer string wins.
    const openD = finger(
      [{ pitch: 32, onsetSec: 0 }, { pitch: 38, onsetSec: 0.25 }],
      SETTINGS
    );
    expect(openD[1]).toEqual({ kind: 'fretted', string: 2, fret: 0 });

    // A1 and C#3 struck together. Fret 5 of the E string puts the hand beside
    // the C# at fret 6 of the G string - a shape a hand can make. Double the
    // bonus and the open A is worth taking instead, spreading the same two
    // notes across the whole neck.
    const dyad = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 49, onsetSec: 0.001 }],
      SETTINGS
    );
    expect(dyad[0]).toEqual({ kind: 'fretted', string: 4, fret: 5 });
  });

  /**
   * `MIN_TIME_FACTOR` is why the module docblock cannot say a shift across a
   * rest is free. Time buys travel, but only down to a floor; past about two
   * and a half seconds the gap stops mattering and a five-fret shift still
   * costs 0.5.
   */
  it('never lets a long rest make a shift free', () => {
    // F#1, up an octave and a major third, and back - three seconds apart.
    const spaced = finger(
      [
        { pitch: 30, onsetSec: 0 },
        { pitch: 44, onsetSec: 3 },
        { pitch: 30, onsetSec: 6 }
      ],
      SETTINGS
    );

    // Take the floor away and three seconds buys a fourteen-fret climb up the
    // E string for nothing. Double it and movement outweighs the crossing, so
    // the hand takes fret 1 of the G string to stay where it is.
    expect(spaced[1]).toEqual({ kind: 'fretted', string: 2, fret: 6 });
  });

  /**
   * `MAX_TIME_FACTOR` is the other end of the same clamp, and it only engages
   * below about 31 ms - in practice a chord, or a detector reporting one
   * attack twice. There is no movement to charge for between two notes struck
   * together, and without a ceiling the model charges for it anyway.
   */
  it('never lets a chord price a string crossing out of reach', () => {
    // G#1, G#2 and D2, detected a millisecond apart: one attack.
    const chord = finger(
      [
        { pitch: 32, onsetSec: 0 },
        { pitch: 44, onsetSec: 0.001 },
        { pitch: 38, onsetSec: 0.002 }
      ],
      SETTINGS
    );

    // Without the ceiling the imagined travel swamps every other term and the
    // three notes are crammed into frets 4-6, open D and all. With it, the
    // open D survives and the G# takes fret 1 of the G string.
    expect(chord[1]).toEqual({ kind: 'fretted', string: 1, fret: 1 });
    expect(chord[2]).toEqual({ kind: 'fretted', string: 2, fret: 0 });
  });

  /**
   * The leap test above pins this discount away from 0, where an open string
   * makes travel free. It does not pin it away from 1, which is no discount
   * at all - and 1 is the value someone deleting a special case would reach
   * for. Two notes are enough to pin both ends.
   */
  it('discounts a move across an open string without abolishing it', () => {
    // A1 then G3, a sixteenth apart.
    const climb = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 55, onsetSec: 0.125 }],
      SETTINGS
    );

    // At no discount the open A is not worth the crossing and the A becomes
    // fret 5 of the E string. At a full discount the open A pays for a leap
    // to fret 22 of its own string. In between: open A, then fret 12.
    expect(climb).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 1, fret: 12 }
    ]);
  });

  /**
   * The attack window needs pinning at both ends. Too small and a detector
   * reporting a chord a few milliseconds wide stops being a chord; too large
   * and consecutive notes of an ordinary line are read as struck together,
   * and the repair scatters a run that belongs on one string.
   *
   * The same run shows the move discount doing its job: five notes up the E
   * string and then across to the open A, rather than carrying on to fret 5.
   */
  it('leaves a run of sixteenths on the string it belongs on', () => {
    const run = [28, 29, 30, 31, 32, 33, 34, 35].map((pitch, index) => ({
      pitch,
      onsetSec: index * 0.125
    }));

    expect(finger(run, SETTINGS)).toEqual([
      { kind: 'fretted', string: 4, fret: 0 },
      { kind: 'fretted', string: 4, fret: 1 },
      { kind: 'fretted', string: 4, fret: 2 },
      { kind: 'fretted', string: 4, fret: 3 },
      { kind: 'fretted', string: 4, fret: 4 },
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 3, fret: 1 },
      { kind: 'fretted', string: 3, fret: 2 }
    ]);
  });

  /**
   * The window is the caller's to size, and it has to be the one the bar will
   * be quantized on. Sizing it here instead - the 30 ms constant this replaced
   * - left every separation between the two windows unseparated and merged,
   * and `addToChord` deleted the second pitch outright.
   */
  it('measures one attack on the window the bar will be quantized to', () => {
    const spread = [{ pitch: 33, onsetSec: 0 }, { pitch: 36, onsetSec: 0.05 }];

    // 50 ms is inside half a sixteenth slot at 120 BPM, so `snapToSlots` will
    // make one chord of these two and they have to leave here on strings that
    // can each hold a number.
    expect(finger(spread)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 4, fret: 8 }
    ]);

    // A narrower window is not a milder version of the same answer. Both notes
    // stay on the A string, and one of them stops existing a stage later.
    expect(finger(spread, SETTINGS, 0.03 * BEATS_PER_SEC)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 3, fret: 3 }
    ]);
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
```

**Step 4: Run test to verify it passes**

Expected: PASS, 23 tests.

If the two position tests fail, the weights are miscalibrated rather than the algorithm being wrong — check `MOVE_REFERENCE_SEC` and `FRET_HEIGHT_WEIGHT` first. Both fixtures were chosen so the fast and slow answers differ under the constants above.

The last six tests pin the constants themselves rather than behaviour they happen to produce. Each fixture was picked by mutation: the expected answer holds when its constant is nudged 10% either way and changes when the constant is zeroed or doubled, so a fixture surviving on a rounding error cannot masquerade as a test. Zeroing or doubling any of `STRING_CHANGE_WEIGHT`, `FRET_HEIGHT_WEIGHT`, `OPEN_STRING_BONUS`, `MOVE_WEIGHT`, `POSITION_HINT_WEIGHT`, `MOVE_REFERENCE_SEC`, `MIN_TIME_FACTOR`, `MAX_TIME_FACTOR`, `OPEN_STRING_MOVE_DISCOUNT` now fails at least one test. The attack window is no longer a constant of this module - it is `chordToleranceBeats`, handed in - and the test that pins it does so by passing a narrower one and watching a note lose its string.

`STRING_CHANGE_WEIGHT` and `FRET_HEIGHT_WEIGHT` cannot be separated, and one test covers both. On an instrument tuned in fourths every alternative fingering of a pitch trades five frets of height for one string of crossing, so only the ratio `FRET_HEIGHT_WEIGHT * 5 : STRING_CHANGE_WEIGHT` is observable; a sweep of every two-note bass fixture found no case that moves one without moving the other.

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
   * A capo shortens the neck: it moves the bottom of the range up and leaves
   * the top alone. Adding it to `highest` as well would admit pitches
   * `candidatesFor` has no fret for, and a note with no fret is dropped from
   * the score without a sign - the failure this module exists to prevent.
   */
  it('does not let a capo raise the highest playable pitch', () => {
    const capoed = { ...SETTINGS, capo: 5 };

    // Still 43 + 24 = 67, so 70 folds to 58 rather than staying put as a
    // pitch that would need fret 27 in front of the capo.
    expect(correctOctaves([note(70)], capoed)[0].pitch).toBe(58);
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

  /**
   * The fold steps by 12, so a large enough pitch does not merely give a
   * strange answer - above about 2^57 one unit in the last place already
   * exceeds 12, `pitch -= 12` stops changing anything and the loop spins for
   * ever. Infinity does the same, and 1e15 would need some 8e13 iterations.
   * A finiteness check alone would let the first and last of those through.
   */
  it('rejects a pitch too far outside MIDI to be a mis-heard note', () => {
    for (const pitch of [2 ** 57, 1e15, Infinity, -Infinity, NaN]) {
      expect(() => correctOctaves([note(pitch)], SETTINGS)).toThrowError(/not a MIDI pitch/);
    }

    // An octave error can land outside MIDI, and folding it is the whole job,
    // so the bound has to sit well clear of 0-127.
    expect(correctOctaves([note(-24)], SETTINGS)[0].pitch).toBe(36);
    expect(correctOctaves([note(151)], SETTINGS)[0].pitch).toBe(67);
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
 * Corrects octave errors that a detector's own output cannot rule out.
 *
 * The pipeline knows one thing the model does not: which pitches the
 * instrument can physically sound. That is enough to catch the commonest bass
 * transcription error without any musical context, by folding anything outside
 * the neck's range back onto it in whole octaves.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the folding can be checked directly against
 * hand-written tunings.
 */

/**
 * How far outside MIDI a pitch may stray before it is a fault, not an error.
 *
 * The mistakes this module exists to fold are whole octaves, so a pitch an
 * octave or two outside MIDI's 0-127 is exactly its business. Ten octaves
 * outside is not a mis-heard note, and the folding loop is the wrong place to
 * find that out: it steps by 12, so 1e15 would take some 8e13 iterations, and
 * above about 2^57 one unit in the last place already exceeds 12 - `pitch -=
 * 12` changes nothing and the loop never ends at all. Infinity behaves the
 * same way. `Number.isFinite` catches neither of those, which is why the bound
 * is a pitch domain rather than a finiteness check.
 */
const PITCH_LIMIT = 127 + 120;

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
 *
 * Throws on a pitch outside the MIDI domain by more than ten octaves, the
 * sibling modules' habit of failing loudly on input they cannot handle rather
 * than misbehaving quietly. Nothing in `deriveScore` produces such a value,
 * but the alternative here is not a wrong answer, it is a hang.
 */
export function correctOctaves(
  notes: DetectedNote[],
  settings: DerivationSettings
): DetectedNote[] {
  for (const note of notes) {
    // Negated rather than `Math.abs(...) > PITCH_LIMIT` so NaN, which compares
    // false against everything, is rejected by the same test as Infinity.
    if (!(Math.abs(note.pitch) <= PITCH_LIMIT)) {
      throw new Error(`note ${note.id} has pitch ${note.pitch}, which is not a MIDI pitch`);
    }
  }

  // A capo raises the bottom of the range and leaves the top where it was: it
  // takes frets away from the neck rather than adding them past the end, so
  // the highest pitch is still the top string stopped at the last fret. This
  // has to agree with `candidatesFor`, or a pitch folded to here would be
  // admitted and then found unplayable, and the note would silently vanish.
  const lowest = Math.min(...settings.tuning) + settings.capo;
  const highest = Math.max(...settings.tuning) + settings.maxFret;

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

Expected: PASS, 9 tests.

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
  BeatGrid,
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
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

function session(
  notes: DetectedNote[],
  grid: BeatGrid = GRID,
  durationSec = 4
): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec,
    notes,
    grid,
    settings: createDefaultDerivationSettings()
  };
}

/**
 * The fingerings actually struck, bar by bar.
 *
 * Struck rather than merely non-rest: a span no single note value can express
 * is spelled as several `BeatDoc`s for one onset, and every fragment after the
 * first is a tie continuation rather than a second attack.
 */
function struckPerBar(input: TranscriptionSession): ([number, number] | null)[][] {
  return deriveScore(input).tracks[0].staves[0].bars.map(bar =>
    bar.voices[0].beats
      .filter(beat => !beat.isRest && !beat.notes[0].isTied)
      .map(beat =>
        beat.notes[0].pitch.kind === 'fretted'
          ? ([beat.notes[0].pitch.string, beat.notes[0].pitch.fret] as [number, number])
          : null
      )
  );
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

    // Struck attacks, not non-rest beats. The surviving note holds the whole
    // bar, which `quantizeBar` spells as one whole note today - but how a span
    // is spelled is its business, not this test's, and it has already changed
    // once: the same bar used to come back as a half tied to a half, two
    // non-rest beats for one attack. Counting non-rest beats would have
    // reported 2 there whatever the floor did.
    expect(beats.filter(beat => !beat.isRest && !beat.notes[0].isTied).length).toBe(1);
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

  // -------------------------------------------------------------------------
  // The bar count, bounded by the source rather than by the last onset.
  // -------------------------------------------------------------------------

  it('caps the bar count at what the source duration can hold', () => {
    // 0.01 s between beats, and an onset ten seconds into a clip a tenth of a
    // second long. `secondsToBeats` extrapolates without limit, so that onset
    // used to land in bar 251 and take 251 MasterBarDocs, 251 bars of rests
    // and 251 passes over the placed notes with it - from two notes. The same
    // grid at 1e-6 s asked for 2,500,001 bars and two and a half seconds.
    const fast: BeatGrid = {
      beatsSec: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07],
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    };

    const input = session([note(33, 0), note(35, 10)], fast, 0.1);
    const score = deriveScore(input);

    // Ten beats of audio, so three bars, plus the one a note rounding forward
    // off the end needs.
    expect(score.masterBars.length).toBe(4);
    expect(score.tracks[0].staves[0].bars.length).toBe(4);

    // Held rather than dropped: the stray onset is clamped into the last bar,
    // so both notes are still struck somewhere a reader can see them.
    expect(struckPerBar(input).flat().length).toBe(2);
  });

  it('leaves an ordinary session\'s bar count alone', () => {
    // Four bars of material inside an eight-second source: nothing here is
    // anywhere near the cap, so the cap changes nothing.
    const eightSeconds: BeatGrid = {
      beatsSec: Array.from({ length: 16 }, (_, index) => index * 0.5),
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    };

    const notes = [note(33, 0), note(35, 2), note(38, 4), note(40, 6)];

    expect(deriveScore(session(notes, eightSeconds, 8)).masterBars.length).toBe(4);
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
import { PlacedNote, chordToleranceBeats, quantizeBar } from './transcription-quantize';
import { gridTempo, secondsToBeats } from './transcription-timing';

/** General MIDI program 33: electric bass, finger. */
const BASS_PROGRAM = 33;

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

/**
 * Bars allowed past the end of the source, so a note arriving in its final
 * moments still has somewhere to live.
 *
 * One, and no more: bar assignment rounds an onset to the nearest slot, so a
 * note in the last half-slot of the audio is carried onto the downbeat of the
 * bar after it - a bar the source duration on its own does not account for.
 */
const RING_OUT_BARS = 1;

/**
 * Bars the source audio can hold.
 *
 * `secondsToBeats` extrapolates past the tracked grid without limit, and the
 * bar count comes off the last note, so nothing in that arithmetic stops one
 * stray onset from asking for an arbitrarily long score. A grid with 0.01 s
 * between beats plus a note ten seconds later wants 251 bars from two notes;
 * at 1e-6 s it wants millions, each one a `MasterBarDoc`, a full bar of rests
 * and a pass over `placed`.
 *
 * A note cannot sound after the audio has stopped, so `durationSec` is the
 * honest ceiling. A session that does not carry one falls back to the span of
 * the tracked grid, the only other statement it makes about how long the
 * source is.
 */
function barsInSource(session: TranscriptionSession): number {
  const beats = session.grid.beatsSec;
  const trackedSec = beats.length > 0 ? beats[beats.length - 1] : 0;
  const sourceSec =
    Number.isFinite(session.durationSec) && session.durationSec > 0
      ? session.durationSec
      : trackedSec;

  const bars = Math.ceil(
    secondsToBeats(sourceSec, session.grid) / session.grid.timeSignature.numerator
  );

  // Never below one: a ScoreDoc with no bars is one ComposerService cannot
  // open, which is the failure the NaN-onset guard above also exists to stop.
  return Math.max(1, bars + RING_OUT_BARS);
}

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

  // correctOctaves folds onto one interval, lowest open string to highest
  // fret, while candidatesFor knows each string reaches only `maxFret - capo`
  // frets. Below four frets those bands stop overlapping and the two disagree;
  // see "Deliberately not in M1". No instrument here is anywhere near that
  // short, so nothing downstream compensates for it.
  const corrected = correctOctaves(audible, settings);

  const slotsPerBeat = settings.finestDivision / timeSignature.denominator;
  const slotsPerBar = timeSignature.numerator * slotsPerBeat;
  const barLimit = barsInSource(session);

  // Computed once and shared, because fingering and placement have to agree
  // about where a note sits to the last decimal. Anything before the first
  // downbeat is pulled onto it here rather than later; a proper pickup bar
  // needs a negative-bar concept the score model does not carry, and two
  // pickup onsets clamped onto beat 0 are as simultaneous to `quantizeBar` as
  // any chord, so `assignFingering` has to see them that way too.
  const beats = corrected.map(note => Math.max(0, secondsToBeats(note.onsetSec, grid)));

  // Fingering runs across the whole piece rather than bar by bar, so hand
  // position carries over bar lines the way a player's does. The NotePitch
  // values come back with 1-based tab string numbers, matching StaffDoc.tuning
  // and ScoreDocMapperService, so nothing here has to renumber them.
  //
  // The chord tolerance travels with them: `quantizeBar` merges onsets inside
  // it into one chord and keeps one pitch per string, so anything it will
  // merge has to leave `assignFingering` already on distinct strings. This
  // assembly is the only place that knows both windows, which is why sizing
  // them independently went unnoticed for so long.
  const fingering = assignFingering(
    corrected.map((note, index) => ({
      pitch: note.pitch,
      onsetSec: note.onsetSec,
      beatPosition: beats[index]
    })),
    settings,
    chordToleranceBeats(slotsPerBeat)
  );

  const placed: { bar: number; beatInBar: number; pitch: NotePitch }[] = [];
  corrected.forEach((note, index) => {
    const pitch = fingering[index];
    if (!pitch) return;

    const beat = beats[index];

    // The bar comes off the rounded slot, not the raw beat: a note in the last
    // half-slot of a bar belongs on the next bar's downbeat, and choosing the
    // bar first would pull it back onto this bar's final slot instead. The
    // position handed on stays unrounded, so quantizeBar can still see two
    // onsets a few tens of milliseconds apart as one chord.
    //
    // Clamped into the source, the far-end counterpart of the `Math.max(0, ...)`
    // above: an onset the grid extrapolates past the end of the audio is held
    // in the last bar rather than allowed to size the score. Held, not dropped
    // - `quantizeBar` pulls the resulting out-of-range `beatInBar` onto the
    // bar's final slot, so the onset is still struck somewhere a reader can
    // see it, which is what dropping it from `placed` would cost.
    const bar = Math.min(
      barLimit - 1,
      Math.floor(Math.round(beat * slotsPerBeat) / slotsPerBar)
    );
    placed.push({ bar, beatInBar: beat - bar * timeSignature.numerator, pitch });
  });

  // Bounded by construction: every entry's bar was clamped to `barLimit - 1`.
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

Expected: PASS, 10 tests.

### Note conservation, end to end

The two tests added by the final milestone review, and the reason they live
here rather than in either module.

`transcription-quantize.spec.ts` has had a conservation property test since the
module was written, and it did not catch this: it stops at `quantizeBar`, so it
takes the fingering it is handed as given. The defect lived in the gap between
two modules, each internally consistent. `transcription-fingering.ts` decided in
*seconds* what to move onto distinct strings; `transcription-quantize.ts`
decided in *beats* what to merge into one chord; and quantize merged the wider
window. Between them a note was deleted with no rest, no error and no record —
at default settings any separation from 35 to 125 ms at 60 BPM, 35 to 80 at 90,
35 to 60 at 120. The band moved with the tempo precisely because the two windows
were in different units. Six per-module review rounds could not see it, because
neither module was wrong on its own.

The fix is that the separation window is no longer a constant of the fingering
module. `chordToleranceBeats` is exported from `transcription-quantize.ts`,
`deriveScore` reads it and hands it to `assignFingering` alongside each note's
beat position, and the two passes now group onsets on the same quantity in the
same units. Erring wide is safe — a note given a string it did not need costs
tab quality — and erring narrow deletes notes, so the containment runs one way:
*everything quantize will merge must already have been separated.*

The test is a sweep rather than a fixture: five pitch pairs × four tempi × every
5 ms of separation from 0 to 200 ms, asserting every input pitch is read back
off the derived tab. What counts as "genuinely unplayable" comes from
`candidatesFor` rather than a fixture, so the property cannot quietly degrade
into "notes usually survive"; a companion test pins the one honest loss, a minor
second at the bottom of a bass, which has no two-string fingering at all.

**Step 5: Run the full suite**

```bash
npx ng test --watch=false --browsers=ChromeHeadless
```

Expected: PASS — 58 baseline + 92 new = **150 tests, 0 failures**.

The 92 break down as 5 + 12 + 21 + 23 + 9 + 22 across tasks 1-6. Task 6's
listing above stops at 10; the other 12 were added by later review rounds and
live only in `src/app/services/score-derivation.spec.ts`. Two of those twelve
are the note-conservation property over the whole assembly, described under
Task 6.

**Step 6: Commit**

```bash
git add src/app/services/score-derivation.ts src/app/services/score-derivation.spec.ts
git commit -m "feat: Assemble detected events into a ScoreDoc"
```

---

## Done when

- `npx ng test --watch=false --browsers=ChromeHeadless` reports 150 passing, 0 failures.
- `deriveScore(session)` returns a `ScoreDoc` that `ComposerService.replaceDocument()` accepts unchanged.
- Every derived bar sums to exactly one bar **and strikes every onset it was given,
  with the pitches that onset carried**, for every time signature and grid tested.
  Length alone is not the invariant: a `quantizeBar` that discarded its notes and
  emitted rests would satisfy that half, and one that shuffled pitches between
  slots would satisfy a count of attacks. Note that fingering can cost a note here
  without `quantizeBar` being at fault: `addToChord` drops a pitch whose string is
  already taken, so two simultaneous notes fingered onto one string lose one of
  themselves. `separateSimultaneous` is what keeps that from happening wherever a
  two-string fingering exists at all.
- The two position-stability tests pass, proving fingering responds to available time.

## Deliberately not in M1

- **Cost-based quantization DP.** Greedy decomposition inside metric fragments guarantees exact bars and keeps the beat visible; choosing between the spellings that remain — dotted quarter vs quarter-tied-to-eighth, both metrically sound — by onset strength is the refinement.
- **Key inference.** `settings.key` is honoured; `null` falls back to C major. Krumhansl-Schmuckler correlation lands with the notation staff work, since tab is unaffected.
- **Triplets.** `allowTriplets` exists in the settings and is ignored.
- **Chord-aware fingering.** The Viterbi pass scores a sequence and cannot see that two notes sound at once, so `separateSimultaneous` repairs its result instead: within one attack the most constrained note claims its string first and the rest take their next-cheapest free candidate. That is enough to keep a dyad off one tab line — the collisions that survive it are the ones no fingering can avoid — but it is a repair, not a search, so the pair it lands on is not always the pair a player would choose. Scoring whole chords, and validating the shapes they make, arrives with guitar polyphony.
- **Two attacks the grid has nowhere to put.** Onsets more than half a slot apart are two clusters, and two clusters can still round onto one slot — `snapToSlots` says so itself. When they do, `addToChord` drops the second, and no attack window can prevent it: widening the separation window to cover it means separating everything within a whole slot, which would scatter an ordinary run of sixteenths across the neck. It is reachable off a slot boundary — at 120 BPM on a sixteenth grid, a pair starting 65 ms in and 65 to 120 ms apart loses a note, about 7% of the (start, separation) square swept — and it is a statement about `finestDivision` rather than about units: the two onsets round to the same sixteenth, and one sixteenth holds one attack. Closing it properly means either a finer grid or letting the two rounded slots repel each other, which changes the written rhythm; both are bigger than a repair. The conservation sweep anchors its first onset on a slot for exactly this reason, and says so.
- **Downbeats stated rather than counted.** `BeatGrid` carried a `downbeatIndices` array through all of M1 and nothing ever read it: `deriveScore` derives bars as uniform spans of `numerator` beats from `beatsSec[0]`, so the array's documented invariants were enforced nowhere. It has been removed rather than left as a trap for M2, whose beat tracker exists to produce downbeats — the natural move is to populate it and assume derivation honours it, and a tracker that dropped or doubled a beat would then write bars disagreeing with the grid, silently. M1's rule is uniform bars from `beatsSec[0]`, and a corrected downbeat phase is expressed by trimming `beatsSec`, which scope decision 3 already establishes. **M2 reintroduces the field together with the derivation support that honours it**, in the same change: a field derivation ignores is worse than no field at all.
- **Pickup bars.** Notes before the first downbeat are pulled onto beat 1.
- **Note durations.** `DetectedNote.offsetSec` is read by nothing: every note sustains until the next onset, so rests appear only before a bar's first note. See scope decision 5.
- **Context-based octave correction.** Only out-of-range folding is implemented; an octave error landing on a playable pitch survives.
- **A hand position to measure movement from.** `edgeCost` measures a shift from the previous note's fret, not from a position the hand is holding, so a figure that sits still under one hand is charged for every finger that moves inside it, and where the hand sits on the neck is only weakly constrained. The symptom is a knife edge: Db2-F2-Ab2-B2 sits in first position at onset gaps of 0.09 s and wider, and jumps to ninth position at 0.08 s and tighter, the two paths differing by 0.28 in total cost at 0.075 s. Aggregate behaviour is far better than that suggests — over 65 four-note figures rooted between E1 and E2, the mean chosen fret moves only from 2.27 at four seconds a note to 3.23 at 50 ms — but the limitation is real, and the fix is a position term rather than more weight tuning.
- **Agreement between `correctOctaves` and `candidatesFor` below four frets.** `correctOctaves` folds onto a single interval, lowest open string to highest fret, while `candidatesFor` knows each string reaches only `maxFret - capo` frets in front of the capo. Once that reach is shorter than the gap between two strings the per-string bands stop overlapping, and a few pitches inside the outer range have no fret anywhere: at `maxFret: 3` on a standard bass, 32, 37 and 42; at 2, six of them. `correctOctaves` admits them, `assignFingering` returns null, and they are dropped. Unreachable at any real fret count, so it is recorded rather than fixed — a per-string range check earns its place only if a three-fret instrument ever appears.
- **Dynamics.** `DetectedNote` records no amplitude or velocity, so every `BeatDoc.dynamics` is `null`. A decision, not an oversight: see scope decision 4.
