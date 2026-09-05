# Transcription M2: Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn an uploaded audio stem into the `DetectedNote[]` and `BeatGrid` that M1's `deriveScore` already knows how to notate.

**Architecture:** Audio decodes to mono 22.05 kHz on the main thread, then a Web Worker runs Basic Pitch on the WebGL backend and returns raw note events. Two pure modules clean those up — harmonic suppression, then beat tracking from note onsets — and neither needs audio or a model to test.

**Tech Stack:** `@spotify/basic-pitch@1.0.1` (TF.js 3.21, model weights bundled), Web Audio API, Angular 21 web-worker support, TypeScript 5.9 strict.

**Prior art:** M1 is merged. `docs/plans/2026-09-05-transcription-m1-derivation-core.md`, design at `docs/plans/2026-09-05-audio-transcription-design.md`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\audio-transcription-m2`, branch `feature/audio-transcription-detect`. Paths below are relative to `client/`.

```bash
npx ng test --watch=false --browsers=ChromeHeadless
npx ng test --watch=false --browsers=ChromeHeadless --include='**/NAME.spec.ts'
```

Baseline: **155 tests, 0 failures.** `@spotify/basic-pitch` is already installed and committed.

### What the spike established — read this before Task 4

A throwaway spike answered the questions this plan would otherwise have guessed at. Four results shape the work:

**1. `BasicPitch.evaluateModel` hangs forever in a Web Worker.** This is the single most important finding. TF.js 3.21's asynchronous WebGL readback never resolves off the main thread — `.data()` stalls indefinitely while `.dataSync()` on identical code returns in 3 ms. Since `evaluateModel` internally awaits `tensor.array()`, it is unusable in a worker, and the CPU backend is roughly 100× slower (22.5 s for 20 s of audio). Task 4 reimplements the batch loop with synchronous readback. This needs no fork — every method it calls is public.

**2. Performance is fine once that is solved.** WebGL in a worker: 60 s of audio inferred in 1.07 s after a 0.6–4.4 s one-time shader compile. A 4-minute stem is single-digit seconds. Budget a further ~4.4 s for `outputToNotesPoly`, which is pure JS.

**3. Raw detection is 24 % precise.** On a clean synthetic bassline with 8 notes, Basic Pitch returns **34**. Recall is perfect — every true pitch is found, onsets accurate to 10–25 ms — but 26 notes are upward harmonic partials. Passing `minFreq`/`maxFreq` for a bass range removes exactly *one* of them, because the partials sit inside the band too. **Harmonic suppression is therefore a first-class module, not a polish step.** Task 1 builds it, against the spike's real output.

**4. The fundamental is reliably the loudest note in its cluster** (0.52–0.71 amplitude versus ≤ 0.55 for partials). That is what makes Task 1 tractable.

### Facts about the library that the design doc got wrong

- The model frame rate is **86.13 fps** (`22050 / 256`), not the ~172 the design doc states. `pitchBends` carries one entry per frame at that rate.
- `noteFramesToTime` returns `amplitude`, not a confidence. We feed it to `DetectedNote.confidence` as a proxy and say so in the docblock — it is peak activation, which is a reasonable stand-in and the only signal available.
- `outputToNotesPoly` returns notes in **no particular order**. Sort by `startTimeSeconds`.
- The bundled weights live at `node_modules/@spotify/basic-pitch/model/`.

### Scope decisions

1. **Beat tracking runs on detected note onsets, not on a spectral flux envelope.** The design doc specifies an STFT onset envelope. Building an FFT is real work, and for a bass stem the notes *are* the rhythm — every onset the beat tracker would find is already a `DetectedNote` with an amplitude. This keeps beat tracking a pure function testable without any audio, and Ellis's dynamic program is unchanged. A spectral envelope is the upgrade path if note onsets prove too sparse.
2. **Octave double-stops are sacrificed.** Task 1 cannot distinguish a genuine octave double-stop from a fundamental plus its second partial — in the spike's data the octave partial's amplitude (0.552) is within 2 % of the fundamental's (0.565). Losing rare double-stops to fix 4× over-detection is the right trade for a bass-first milestone. Recorded as a limitation.
3. **No downbeat detection.** M1 removed `downbeatIndices` deliberately. M2 produces `beatsSec` and a caller-supplied `timeSignature`; bar 1 starts at `beatsSec[0]`. Reintroducing downbeats means reintroducing the field *and* the derivation support together, which is M3 work.

---

## Task 1: Harmonic suppression

The marquee task. Turns 34 detected notes into 8, using the spike's actual output as the fixture.

**Files:**
- Create: `src/app/services/transcription-harmonics.ts`
- Test: `src/app/services/transcription-harmonics.spec.ts`

**Step 1: Write the failing test**

```typescript
import { DetectedNote } from '../models/transcription.model';
import { HARMONIC_SEMITONES, suppressHarmonics } from './transcription-harmonics';

/** [onsetSec, midiPitch, durationSec, amplitude] */
type Raw = [number, number, number, number];

function note([onsetSec, pitch, duration, amplitude]: Raw, index: number): DetectedNote {
  return {
    id: `n${index}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + duration,
    confidence: amplitude,
    bendCents: []
  };
}

/**
 * Verbatim output of @spotify/basic-pitch on a synthetic bassline of eight
 * notes — E1 A1 D2 G2 twice, 0.5 s apart, each with 2nd/3rd/4th harmonics.
 * Thirty-four notes for eight played: recall is perfect, precision is 24 %,
 * and every spurious note is a partial above its fundamental.
 */
const SPIKE_OUTPUT: Raw[] = [
  [0.000, 28, 0.464, 0.565], [0.058, 52, 0.244, 0.377], [0.093, 40, 0.267, 0.552],
  [0.093, 47, 0.104, 0.343], [0.488, 33, 0.395, 0.687], [0.488, 45, 0.081, 0.264],
  [0.546, 57, 0.267, 0.328], [0.557, 52, 0.070, 0.329], [0.569, 45, 0.313, 0.514],
  [0.882, 33, 0.093, 0.445], [0.894, 38, 0.081, 0.299], [0.975, 38, 0.418, 0.712],
  [1.022, 62, 0.081, 0.352], [1.045, 50, 0.360, 0.484], [1.393, 38, 0.070, 0.415],
  [1.486, 43, 0.476, 0.666], [1.521, 55, 0.383, 0.428], [1.823, 28, 0.628, 0.520],
  [2.056, 52, 0.244, 0.381], [2.091, 40, 0.267, 0.548], [2.091, 47, 0.104, 0.345],
  [2.486, 33, 0.395, 0.688], [2.486, 45, 0.081, 0.264], [2.544, 57, 0.267, 0.329],
  [2.555, 52, 0.070, 0.329], [2.567, 45, 0.313, 0.514], [2.881, 33, 0.093, 0.443],
  [2.892, 38, 0.081, 0.297], [2.973, 38, 0.488, 0.676], [3.020, 62, 0.081, 0.352],
  [3.043, 50, 0.372, 0.485], [3.496, 43, 0.476, 0.667], [3.519, 55, 0.383, 0.424],
  [3.519, 67, 0.070, 0.349]
];

const DETECTED: DetectedNote[] = SPIKE_OUTPUT.map(note);

/** The eight pitches actually synthesised, in order. */
const PLAYED = [28, 33, 38, 43, 28, 33, 38, 43];

describe('suppressHarmonics', () => {
  it('recovers the played line from the raw detector output', () => {
    const kept = suppressHarmonics(DETECTED);

    expect(kept.map(n => n.pitch)).toEqual(PLAYED);
  });

  it('keeps the strongest note of each cluster, not the first', () => {
    const kept = suppressHarmonics(DETECTED);

    // The E1 at 0.000 outranks the E3 detected 58 ms later.
    expect(kept[0].onsetSec).toBe(0);
    expect(kept[0].confidence).toBe(0.565);
  });

  it('leaves a note with no harmonic relation alone', () => {
    // A minor second is not a partial of anything.
    const pair = [
      note([0, 33, 0.4, 0.7], 0),
      note([0, 34, 0.4, 0.6], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('keeps a partial-interval note that does not overlap its root', () => {
    // An octave above, but struck long after the lower note stopped sounding.
    const pair = [
      note([0, 33, 0.2, 0.7], 0),
      note([2, 45, 0.4, 0.6], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('drops a weak short unison inside a strong note as a re-detection', () => {
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.05, 0.40], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(1);
  });

  it('keeps a genuine repeated note of comparable weight and length', () => {
    // Same pitch, overlapping because the first still rings — but struck as
    // hard and held as long, so it is a second attack, not an artefact.
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.4, 0.68], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('returns notes in onset order', () => {
    const kept = suppressHarmonics(DETECTED);
    const onsets = kept.map(n => n.onsetSec);

    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
  });

  it('does not mutate its input', () => {
    const before = DETECTED.length;
    suppressHarmonics(DETECTED);

    expect(DETECTED.length).toBe(before);
  });

  it('lists the partials of a plucked string, unison first', () => {
    // 2f0, 3f0, 4f0, 5f0, 6f0 rounded to semitones, plus unison at 0.
    expect(HARMONIC_SEMITONES).toEqual([0, 12, 19, 24, 28, 31]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/transcription-harmonics.spec.ts'
```

Expected: FAIL — `Cannot find module './transcription-harmonics'`.

**Step 3: Write minimal implementation**

Create `src/app/services/transcription-harmonics.ts`:

```typescript
import { DetectedNote } from '../models/transcription.model';

/**
 * Removes the harmonic partials a note detector reports alongside the notes
 * actually played.
 *
 * A plucked string radiates most of its energy at the fundamental but plenty
 * at 2f0, 3f0, 4f0 and beyond, and a pitch detector reports those as notes.
 * Measured on a clean synthetic bassline, Basic Pitch returns thirty-four
 * notes for eight played — recall is perfect and precision is 24 %, with every
 * spurious note a partial *above* its fundamental. Constraining the detector's
 * frequency range barely helps, because the partials fall inside the
 * instrument's range too.
 *
 * What makes this tractable is that the fundamental is reliably the loudest
 * note in its cluster. So: consider notes strongest first, and drop any that a
 * louder, overlapping note already explains as one of its partials.
 *
 * Pure, and independent of any detector.
 */

/**
 * Semitone offsets of the partials a plucked string produces, relative to its
 * fundamental. 2f0 = +12, 3f0 = +19.02, 4f0 = +24, 5f0 = +27.86, 6f0 = +31.02,
 * rounded because detectors report integer MIDI pitches.
 *
 * 0 is included: a unison "partial" is the detector reporting one note twice.
 */
export const HARMONIC_SEMITONES: number[] = [0, 12, 19, 24, 28, 31];

export interface HarmonicOptions {
  /** Slack at both ends of a fundamental's span, for detector jitter. */
  toleranceSec: number;
  /** A unison counts as a re-detection only below this share of the root's amplitude. */
  unisonAmplitudeRatio: number;
  /** ...and this share of its duration. */
  unisonDurationRatio: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicOptions = {
  toleranceSec: 0.03,
  unisonAmplitudeRatio: 0.8,
  unisonDurationRatio: 0.5
};

export function suppressHarmonics(
  notes: DetectedNote[],
  options: HarmonicOptions = DEFAULT_HARMONIC_OPTIONS
): DetectedNote[] {
  // Strongest first, so a fundamental is always considered before its own
  // partials. Ties break on onset, keeping the result deterministic.
  const byStrength = [...notes].sort(
    (a, b) => b.confidence - a.confidence || a.onsetSec - b.onsetSec || a.pitch - b.pitch
  );

  const kept: DetectedNote[] = [];
  for (const note of byStrength) {
    if (!kept.some(root => explains(root, note, options))) kept.push(note);
  }

  return kept.sort((a, b) => a.onsetSec - b.onsetSec || a.pitch - b.pitch);
}

/** True when `note` is a partial, or a re-detection, of the louder `root`. */
function explains(
  root: DetectedNote,
  note: DetectedNote,
  options: HarmonicOptions
): boolean {
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;

  // A partial only counts while its fundamental is still sounding.
  if (
    note.onsetSec < root.onsetSec - options.toleranceSec ||
    note.onsetSec > root.offsetSec + options.toleranceSec
  ) {
    return false;
  }

  if (interval > 0) return true;

  // Unison needs more care. A note genuinely struck twice also overlaps itself
  // when the first one is still ringing, and suppressing that would delete
  // repeated notes — which basslines are full of. A re-detection is both
  // markedly quieter and markedly shorter than the note it duplicates; a real
  // second attack is neither.
  const rootDuration = root.offsetSec - root.onsetSec;
  const noteDuration = note.offsetSec - note.onsetSec;

  return (
    note.confidence < root.confidence * options.unisonAmplitudeRatio &&
    noteDuration < rootDuration * options.unisonDurationRatio
  );
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 9 tests. The first assertion — 34 notes in, the exact played line out — is the one that matters.

**Step 5: Commit**

```bash
git add src/app/services/transcription-harmonics.ts src/app/services/transcription-harmonics.spec.ts
git commit -m "feat: Suppress harmonic partials from detector output"
```

---

## Task 2: Beat tracking from note onsets

Ellis's dynamic-programming beat tracker, run over an onset signal built from detected notes rather than spectral flux. Pure — no audio, no FFT.

**Files:**
- Create: `src/app/services/beat-tracking.ts`
- Test: `src/app/services/beat-tracking.spec.ts`

**Step 1: Write the failing test**

```typescript
import { TimeSignature } from '../models/composer.model';
import { DetectedNote } from '../models/transcription.model';
import { DEFAULT_BEAT_OPTIONS, estimateTempo, onsetSignal, trackBeats } from './beat-tracking';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** `count` notes, one every `intervalSec`, all equally strong. */
function pulse(count: number, intervalSec: number, startSec = 0): DetectedNote[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    pitch: 33,
    onsetSec: startSec + i * intervalSec,
    offsetSec: startSec + i * intervalSec + intervalSec * 0.8,
    confidence: 0.8,
    bendCents: []
  }));
}

describe('onsetSignal', () => {
  it('puts energy at each onset and none between', () => {
    const signal = onsetSignal(pulse(4, 0.5), 2, DEFAULT_BEAT_OPTIONS.frameRateHz);
    const rate = DEFAULT_BEAT_OPTIONS.frameRateHz;

    expect(signal[0]).toBeGreaterThan(0);
    // A quarter of the way between two onsets is well clear of both.
    expect(signal[Math.round(0.25 * rate)]).toBeLessThan(signal[0] * 0.1);
  });
});

describe('estimateTempo', () => {
  it('reads 120 BPM off a half-second pulse', () => {
    const signal = onsetSignal(pulse(16, 0.5), 8, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(120, -0.5);
  });

  it('reads 90 BPM off a two-thirds-second pulse', () => {
    const signal = onsetSignal(pulse(16, 60 / 90), 11, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(90, -0.5);
  });
});

describe('trackBeats', () => {
  it('lands beats on the notes that produced them', () => {
    const grid = trackBeats(pulse(16, 0.5), 8, FOUR_FOUR);

    expect(grid.beatsSec.length).toBeGreaterThan(10);
    for (const beat of grid.beatsSec) {
      const nearest = Math.round(beat / 0.5) * 0.5;
      expect(Math.abs(beat - nearest)).toBeLessThan(0.03);
    }
  });

  it('keeps the pulse through a missing note', () => {
    // Drop the note on beat 5 — the tracker must not skip or halve.
    const notes = pulse(16, 0.5).filter((_, i) => i !== 5);
    const grid = trackBeats(notes, 8, FOUR_FOUR);

    const gaps = grid.beatsSec.slice(1).map((b, i) => b - grid.beatsSec[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 1);
  });

  it('carries the caller time signature through', () => {
    const three: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

    expect(trackBeats(pulse(12, 0.5), 6, three).timeSignature).toEqual(three);
  });

  it('produces a usable grid when there are no notes at all', () => {
    const grid = trackBeats([], 4, FOUR_FOUR);

    expect(grid.beatsSec.length).toBeGreaterThan(1);
    const gaps = grid.beatsSec.slice(1).map((b, i) => b - grid.beatsSec[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 1);
  });

  it('returns beats in ascending order', () => {
    const grid = trackBeats(pulse(16, 0.5), 8, FOUR_FOUR);

    expect([...grid.beatsSec].sort((a, b) => a - b)).toEqual(grid.beatsSec);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './beat-tracking'`.

**Step 3: Write minimal implementation**

Create `src/app/services/beat-tracking.ts` implementing:

- `onsetSignal(notes, durationSec, frameRateHz): Float32Array` — an impulse at each onset weighted by `confidence`, then a Gaussian blur of about 20 ms so a beat still scores when an onset sits slightly off it.
- `estimateTempo(signal, options): number` — autocorrelation across lags spanning `minBpm`..`maxBpm`, each lag's score scaled by Ellis's log-normal prior `exp(-0.5 * (log2(bpm / priorBpm) / priorWidth)^2)`. The prior is what stops the estimate locking onto a half- or double-time peak, which is the classic failure.
- `trackBeats(notes, durationSec, timeSignature, options?): BeatGrid` — the dynamic program. For each frame `i`, score it as `signal[i] + max over j in [i - 2P, i - P/2] of (score[j] - tightness * log((i - j) / P)^2)`, where `P` is the period in frames. Record a back-pointer, then backtrace from the best-scoring frame in the final period. The squared-log penalty lets the beat drift with the music but not skip one.

Defaults:

```typescript
export const DEFAULT_BEAT_OPTIONS: BeatTrackingOptions = {
  frameRateHz: 100,
  minBpm: 50,
  maxBpm: 210,
  priorBpm: 120,
  priorWidth: 1.0,
  tightness: 100
};
```

With no notes, return an even grid at `priorBpm` spanning `durationSec` — a degenerate but structurally valid grid, matching how M1's `secondsToBeats` degrades rather than throws.

**Step 4: Run tests, then the full suite**

Expected: the beat spec passes, and the full suite is 155 + 9 + 8 = 172.

**Step 5: Commit**

```bash
git add src/app/services/beat-tracking.ts src/app/services/beat-tracking.spec.ts
git commit -m "feat: Track beats from detected note onsets"
```

---

## Task 3: Audio decode and resample

**Files:**
- Create: `src/app/services/audio-decode.ts`
- Test: `src/app/services/audio-decode.spec.ts`

Basic Pitch expects mono at 22.05 kHz. `decodeAudioData` handles every format the browser knows; an `OfflineAudioContext` with one output channel does the downmix and resample in one pass.

```typescript
export const TARGET_SAMPLE_RATE = 22050;

export interface DecodedAudio {
  audio: Float32Array;
  durationSec: number;
  /** Sample rate of the file before resampling, for reporting. */
  sourceSampleRate: number;
}

export async function decodeToMono(
  data: ArrayBuffer,
  targetRate: number = TARGET_SAMPLE_RATE
): Promise<DecodedAudio>
```

Close the `AudioContext` in a `finally` — the browser caps how many a page may hold, and the review UI will decode repeatedly.

**Testing note.** Karma runs in a real Chrome, so this is testable: build a small WAV in memory (44-byte RIFF header plus 16-bit PCM samples of a known tone), decode it, and assert the output length is `ceil(durationSec * 22050)`, that `durationSec` matches, and that a stereo input collapses to one channel. Write a `makeWav(samples, sampleRate, channels)` helper in the spec.

Commit: `feat: Decode and resample audio for detection`

---

## Task 4: NoteDetector interface and the Basic Pitch adapter

**Files:**
- Create: `src/app/services/note-detector.ts`
- Create: `src/app/services/basic-pitch-detector.ts`
- Modify: `angular.json` (serve the bundled model)
- Test: `src/app/services/basic-pitch-detector.spec.ts`

**The interface** — this is the server escape hatch the design promises:

```typescript
export interface DetectionResult {
  notes: DetectedNote[];
  /** Frame rate of DetectedNote.bendCents, in Hz. Basic Pitch: 22050/256. */
  bendFrameRateHz: number;
}

export interface NoteDetector {
  detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void
  ): Promise<DetectionResult>;
}
```

**Serving the model.** Add to *both* the `build` and `test` architects' `assets` arrays in `angular.json`:

```json
{ "glob": "**/*", "input": "node_modules/@spotify/basic-pitch/model", "output": "/basic-pitch-model" }
```

`new BasicPitch('/basic-pitch-model/model.json')` then loads in 10–25 ms; the weight shard resolves relative to `model.json` automatically.

**The adapter, and the one thing you must not do.** Do **not** call `BasicPitch.evaluateModel` — it awaits `tensor.array()`, and TF.js 3.21's async WebGL readback never resolves inside a Web Worker. Reimplement its loop with synchronous readback instead. Read `node_modules/@spotify/basic-pitch/src/inference.ts` and mirror `evaluateModel`'s structure, substituting `arraySync()` for every `await ...array()`. Everything you need is public: `prepareData`, `unwrapOutput`, and the `model` promise.

Then post-process exactly as the library does:

```
outputToNotesPoly(frames, onsets)
  → addPitchBendsToNoteEvents(contours, notes)
  → noteFramesToTime(notes)
  → sort by startTimeSeconds
  → map to DetectedNote
```

The mapping:

| `NoteEventTime` | `DetectedNote` |
|---|---|
| `pitchMidi` | `pitch` |
| `startTimeSeconds` | `onsetSec` |
| `startTimeSeconds + durationSeconds` | `offsetSec` |
| `amplitude` | `confidence` — peak activation, used as a proxy; say so in the docblock |
| `pitchBends ?? []` | `bendCents` |

Give each note a stable `id`.

**Testing.** This one genuinely needs a browser and the model, so keep it to a couple of integration tests rather than trying to unit-test inference: synthesise a short bass tone in the spec, run the detector, and assert the played fundamental appears among the results. Do not assert an exact note count — that is what Task 1 is for, and it is already pinned against real output.

Commit: `feat: Detect notes with Basic Pitch`

---

## Task 5: Run detection in a Web Worker

**Files:**
- Create: `src/tsconfig.worker.json`
- Create: `src/app/workers/detection.worker.ts`
- Create: `src/app/services/worker-detector.ts`
- Modify: `angular.json`
- Test: `src/app/services/worker-detector.spec.ts`

Inference must not block the main thread, and confining TF.js to the worker is also what keeps the main bundle at 714 kB instead of 1.76 MB.

`ng generate web-worker` sets this up but the spike found three sharp edges, all of which you should expect:

1. The generated `"include": ["src/**/*.worker.ts"]` matches nothing, because `tsconfig.worker.json` itself lives in `src/`. It must be `"**/*.worker.ts"`.
2. Once `webWorkerTsConfig` is set and no `*.worker.ts` file exists, **every build fails** with `TS18003: No inputs were found in config file`. Add the config and the first worker in the same commit.
3. The schematic writes `"lib": ["es2018", "webworker"]`, downgrading from the project's ES2022. Raise it.

The schematic adds `webWorkerTsConfig` to both the `build` and `test` architects — keep both, since the specs run under the karma builder.

`WorkerDetector` implements `NoteDetector` on the main thread, owning the worker's lifecycle: post `{ audio, sampleRate }`, receive `{ type: 'progress', fraction }` and `{ type: 'done', result }` (and `{ type: 'error', message }`), resolve the promise, and expose a `terminate()` the component calls in `ngOnDestroy`. Transfer the `Float32Array`'s buffer rather than copying it.

Commit: `feat: Run note detection in a web worker`

---

## Task 6: TranscriptionService

**Files:**
- Create: `src/app/services/transcription.service.ts`
- Test: `src/app/services/transcription.service.spec.ts`

The orchestration layer, and the first stateful piece in the feature. Per `CLAUDE.md`, state lives in a service behind a `BehaviorSubject`.

```typescript
export type TranscriptionPhase =
  | 'idle' | 'decoding' | 'detecting' | 'deriving' | 'ready' | 'failed';

export interface TranscriptionState {
  phase: TranscriptionPhase;
  /** 0-1 within the current phase. */
  progress: number;
  session: TranscriptionSession | null;
  derived: DerivedScore | null;
  error: string | null;
}
```

`transcribe(file: File)` runs decode → detect → suppress harmonics → track beats → assemble a `TranscriptionSession` → `deriveScore`, pushing state at each step. `updateSettings(partial)` re-derives from the *existing* session without re-running detection — this is the whole point of M1's two-layer model, and it must be a synchronous `deriveScore` call.

Inject the detector so tests can supply a stub:

```typescript
export const NOTE_DETECTOR = new InjectionToken<NoteDetector>('NoteDetector');
```

Provide `WorkerDetector` for it at the application level. Tests provide a stub returning fixed `DetectedNote`s — no worker, no model, fast.

Test the state transitions, that a failed decode lands in `'failed'` with a message rather than throwing, and that `updateSettings` changes the derived score without calling the detector again (spy on it and assert the call count stays at 1).

Commit: `feat: Add TranscriptionService orchestration`

---

## Done when

- Full suite green, `npx tsc -p tsconfig.spec.json --noEmit` clean.
- `suppressHarmonics` turns the spike's 34-note fixture into exactly the eight played pitches.
- `npm run build` succeeds and the main bundle stays near 714 kB, with TF.js in a separate worker chunk.
- A real audio file dropped through `TranscriptionService` produces a `ScoreDoc` the composer opens.

## Deliberately not in M2

- **Octave double-stops** — Task 1 cannot distinguish one from a fundamental plus its second partial, since their amplitudes are within 2 % in real output.
- **Downbeat detection** — see scope decision 3.
- **Spectral-flux onset envelope** — beat tracking uses note onsets; see scope decision 1.
- **A no-WebGL fallback.** The CPU backend is ~100× slower and unusable for full songs. Bumping TF.js to 4.x via `overrides` would unlock the WASM backend, and is worth trying once — Basic Pitch touches only `loadGraphModel`, `slice`, `concat1d`, `signal.frame`, `expandDims`, `zeros`, `tensor` and `GraphModel.execute`.
- **The review UI** — that is M3.
- **Streaming posteriorgrams.** They accumulate as `number[][]`: roughly 45 MB of doubles for a 4-minute stem, plus per-row overhead. Fine for now, worth typed-array backing later.
