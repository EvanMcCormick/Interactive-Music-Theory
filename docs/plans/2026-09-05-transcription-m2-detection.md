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

**4. The fundamental is *usually* the loudest note in its cluster, but only just — and not always** (0.52–0.71 amplitude for fundamentals versus ≤ 0.55 for partials). The margin is about 2 %, and the fixture violates it once: the E2 octave partial at 2.091 s comes back at 0.548 against the 0.520 of the E1 at 1.823 s that produced it. Amplitude is therefore *not* what makes Task 1 tractable. What does is that a partial is always **above** its fundamental in pitch — physics, not a heuristic — so ordering candidates by pitch ascending guarantees the fundamental is considered first with no dependence on relative loudness at all. Task 1 orders by pitch for exactly this reason.

### Facts about the library that the design doc got wrong

- The model frame rate is **86.13 fps** (`22050 / 256`), not the ~172 the design doc states. `pitchBends` carries one entry per frame at that rate. It is carried all the way to `TranscriptionSession.bendFrameRateHz`: a bend array is a list of numbers with no time axis without it, and `DetectedNote` deliberately does not record it, so whoever hands the notes on hands the rate on too.
- `noteFramesToTime` returns `amplitude`, not a confidence. We feed it to `DetectedNote.confidence` as a proxy and say so in the docblock.
- **`amplitude` is the mean, not the peak.** Corrected after review — the docblock claimed peak activation. `toMidi.ts` computes it at both construction sites as `frames.slice(start, end).reduce(...) / (end - start)`, and the second carries the numpy line it came from (`np.mean(...)`) as a comment. It matters: a mean over a decaying activation penalises long sustained notes relative to short punchy ones, the opposite of "peak"'s bias.
- **`confidenceFloor` is very nearly a no-op at its default,** which follows from the above. `outputToNotesPoly` builds a note's span out of exactly the frames that cleared `frameThresh`, so the mean of those frames is bounded below by it. `frameThresh` defaults to 0.3 and `DerivationSettings.confidenceFloor` defaults to 0.3 — the same threshold applied twice, the second time to numbers the first has already guaranteed. Measured on the spike fixture, post-suppression amplitudes cluster in **0.520–0.712**, so every floor from 0 up to 0.52 gives identical output and the knob does nothing until it is raised 0.22 above where it sits. **Not re-tuned here:** one synthetic fixture cannot pick the number, and picking it wrong throws away real notes. A calibration question for M3, where real stems are available.
- `outputToNotesPoly` returns notes in **no particular order**. Sort by `startTimeSeconds`.
- The bundled weights live at `node_modules/@spotify/basic-pitch/model/`.

### Scope decisions

1. **Beat tracking runs on detected note onsets, not on a spectral flux envelope.** The design doc specifies an STFT onset envelope. Building an FFT is real work, and for a bass stem the notes *are* the rhythm — every onset the beat tracker would find is already a `DetectedNote` with an amplitude. This keeps beat tracking a pure function testable without any audio, and Ellis's dynamic program is unchanged. A spectral envelope is the upgrade path if note onsets prove too sparse. **What it costs:** sparse material halves. A bass playing roots on beats 1 and 3 at 120 BPM comes back as 60, because there is no onset energy at the quarter-note lag for the prior to weigh — the tempo is simply not stated in the onsets, and no prior can recover what was never there. A flux envelope would still see the note *ringing* across the missing beats. This is the price of the decision, not a bug in the tracker; it is pinned by a test and recorded as a limitation.
2. **Suppression is bought with duration, and costs short notes over long ones.** Amplitude cannot tell a partial from a real note played above a ringing one: in the spike's data an octave partial comes back *louder* than the E1 that produced it (0.548 against 0.520, a ratio of 1.05). Duration can — the higher modes of a plucked string damp faster than the fundamental, and across the fixture's 21 partial suppressions the longest partial runs 0.86 of the note that produced it. So Task 1 suppresses a note at a partial's interval only when it also starts no earlier than the note below it and dies away sooner. Octave double-stops, octave leaps over a ringing low note, pumping octave eighths and slapped pops all survive that. What is still lost is a genuine note at +12, +19, +24, +28 or +31 that both overlaps the note below it *and* is markedly shorter than it — a short line over a held pedal is the case to watch: under a 2 s E1, line notes at those intervals are still deleted. Recorded as a limitation.
3. **No downbeat detection.** M1 removed `downbeatIndices` deliberately. M2 produces `beatsSec` and a caller-supplied `timeSignature`; bar 1 starts at `beatsSec[0]`. Reintroducing downbeats means reintroducing the field *and* the derivation support together, which is M3 work.

   **What this costs, stated plainly after review:** `BeatGrid` declared `beatsSec[0]` to be the first downbeat and `secondsToBeats` relied on it, but nothing establishes that. `trimBeats` returns the run beginning at the first beat whose local score clears half the RMS — whichever tracked pulse the onsets first support, with no downbeat property claimed or tested. The tracker finds the pulse and not its phase, so a line that begins on beat 3 tracks perfectly and is barred a half-bar out. **Bar-line phase is therefore arbitrary until M3 adds a downbeat control** — the user says where bar 1 begins and the grid is trimmed to it. The docblocks now say the first *tracked* beat, and the promise that "M2's tracker reintroduces it" has been removed, since M2 did not.

### The error contract

M1 left this open and named "before M3" as the deadline; M2 added five more modules on both sides of the line without deciding. Settled now, because M3 binds `finestDivision` and the meter to dropdowns:

> **Derivation degrades when the fault is a settings combination the user chose; it throws only on input data that cannot be honoured. A knob the user can turn must never be able to throw out of a state-reporting method.**

The case that forced it: `quantizeBar` throws whenever `finestDivision / timeSignature.denominator` is not an integer ≥ 1, and *both operands are live knobs*. Two legal public calls reach it — `transcribe(file, 6/8)` then `updateSettings({ finestDivision: 4 })` — and before the fix the exception escaped `updateSettings` into the caller's event handler, so `stateSubject` was never pushed and the UI went on showing the old score with its control in the new position. `4/16` with a `finestDivision` of 8 is the same fault from the other side.

How it is implemented:

- `barGridFault(timeSignature, finestDivision)` in `transcription-quantize.ts` returns the message or `null`. It is the single statement of the rule: `quantizeBar` throws on it, `TranscriptionService` asks it. It covers the numerator check too — the numerator arrives from the same caller through `updateTimeSignature` and is typed as a bare number.
- `TranscriptionService.rederive` calls it **before** `deriveScore` and, on a fault, pushes a state that keeps the previous `session` and `derived` and carries the message in a new `TranscriptionState.refusal` field. The change is turned away whole, not half-applied.
- `transcribe` checks the caller's meter against the default `finestDivision` before decoding, so an impossible meter costs neither a decode nor an inference and is reported as the meter's fault rather than the file's.
- `refusal` is deliberately **not** `error`. The phase is still `ready` and the score is still good; a UI rendering the two the same way would report a working score as broken. It is cleared by the next change that succeeds.

**Not a try/catch around `deriveScore`.** M1 warned that a throwing pure function inside a live re-derive loop blanks the preview, and swallowing everything reintroduces exactly that. `deriveScore`'s other throws — a non-finite onset, a pitch outside MIDI — are facts about the detection that no setting can repair, and they still throw.

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

/** ...and the eight detected events that are those notes rather than partials. */
const PLAYED_IDS = ['n0', 'n4', 'n11', 'n15', 'n17', 'n21', 'n28', 'n31'];

describe('suppressHarmonics', () => {
  it('recovers the played line from the raw detector output', () => {
    const kept = suppressHarmonics(DETECTED);

    expect(kept.map(n => n.pitch)).toEqual(PLAYED);
    // Which eight events, not just which eight pitches — the fixture holds
    // several detections of each played pitch, and everything downstream
    // reads their onsets as the rhythm.
    expect(kept.map(n => n.id)).toEqual(PLAYED_IDS);
  });

  it('suppresses a partial that is louder than its own fundamental', () => {
    // Real detector output: the E2 partial at 2.091 (amp 0.548) outweighs the
    // E1 that produced it at 1.823 (amp 0.520). Ordering by pitch rather than
    // loudness is what catches it.
    const cluster = [
      note([1.823, 28, 0.628, 0.520], 0),
      note([2.091, 40, 0.267, 0.548], 1)
    ];

    expect(suppressHarmonics(cluster).map(n => n.pitch)).toEqual([28]);
  });

  it('keeps a root and the fifth above it', () => {
    // A perfect fifth is not a partial of anything — 3f0 lands an octave
    // *and* a fifth up. This is root-to-fifth over a ringing low note, the
    // commonest figure in bass playing; adding +7 to HARMONIC_SEMITONES
    // would delete every one of them, and this is what would object.
    const rootAndFifth = [
      note([0, 28, 0.6, 0.70], 0),
      note([0.3, 35, 0.4, 0.55], 1)
    ];

    expect(suppressHarmonics(rootAndFifth).map(n => n.pitch)).toEqual([28, 35]);
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

  it('keeps an octave leap over a note that is still ringing', () => {
    // E1 to E2 with the low note left to ring under it. Overlapping, at a
    // partial's interval, and no quieter — the E2 is in fact the louder of
    // the two. Only its length says it was played rather than radiated.
    const leap = [
      note([0, 28, 0.8, 0.62], 0),
      note([0.6, 40, 0.8, 0.64], 1)
    ];

    expect(suppressHarmonics(leap).map(n => n.pitch)).toEqual([28, 40]);
  });

  it('keeps octave eighths pumping against each other', () => {
    // E1/E2 alternating eighths at 120 BPM, each held 0.22 s so every note
    // overlaps the one before it. Suppressing on overlap alone deletes every
    // E2 and leaves four repeated E1s.
    const eighths = Array.from({ length: 8 }, (_, i) =>
      note([i * 0.25, i % 2 ? 40 : 28, 0.22, i % 2 ? 0.58 : 0.62], i)
    );

    expect(suppressHarmonics(eighths).map(n => n.pitch)).toEqual([
      28, 40, 28, 40, 28, 40, 28, 40
    ]);
  });

  it('keeps a slapped pop two octaves over the thumbed note under it', () => {
    // Thumb on E1, pop on E3 a quarter-second later: +24 is a partial's
    // interval, and the thumbed note is still ringing when the pop lands.
    const slap = [
      note([0, 28, 0.45, 0.70], 0),
      note([0.25, 52, 0.50, 0.66], 1)
    ];

    expect(suppressHarmonics(slap).map(n => n.pitch)).toEqual([28, 52]);
  });

  it('keeps a note at a partial interval that began before its supposed root', () => {
    // A partial cannot start before the pluck that makes it. This E2 is
    // already dying away when the E1 lands underneath it, so the E1 does not
    // explain it — even though they overlap and the E2 is much the shorter.
    const pair = [
      note([0, 40, 0.6, 0.50], 0),
      note([0.5, 28, 1.0, 0.70], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([40, 28]);
  });

  it('allows the root a little slack past its offset, and not much', () => {
    // The root stops at 0.5 s and the slack is 0.03 s, so an octave landing
    // at 0.52 is still its partial and one landing at 0.54 is a new note.
    const root: Raw = [0, 28, 0.5, 0.70];
    const inside = suppressHarmonics([note(root, 0), note([0.52, 40, 0.2, 0.50], 1)]);
    const outside = suppressHarmonics([note(root, 0), note([0.54, 40, 0.2, 0.50], 1)]);

    expect(inside.map(n => n.pitch)).toEqual([28]);
    expect(outside.map(n => n.pitch)).toEqual([28, 40]);
  });

  it('takes that slack from the options it is handed', () => {
    // The same pair either side of the boundary, moved by widening the slack
    // rather than by moving the notes.
    const pair = [note([0, 28, 0.5, 0.70], 0), note([0.54, 40, 0.2, 0.50], 1)];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28, 40]);
    expect(suppressHarmonics(pair, { toleranceSec: 0.1 }).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 3rd partial, an octave and a fifth up', () => {
    // 3f0 is 19.02 semitones above the fundamental: E1 at 28 rings at 47.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 47, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 4th partial, two octaves up', () => {
    // 4f0 is exactly 24 semitones above the fundamental: E1 at 28 rings at 52.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 52, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 5th partial, nearly two octaves and a major third up', () => {
    // 5f0 is 27.86 semitones above the fundamental: E1 at 28 rings at 56.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 56, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 6th partial, two octaves and a fifth up', () => {
    // 6f0 is 31.02 semitones above the fundamental: E1 at 28 rings at 59.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 59, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
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

  it('pins how much shorter than its root a partial has to be', () => {
    // The whole margin, in one test. The fixture's longest partial runs 0.86
    // of the note that produced it and the threshold sits at 0.90, so an
    // octave held 0.95 of the note under it was played, not radiated.
    const pair = [
      note([0, 28, 1.0, 0.62], 0),
      note([0.5, 40, 0.95, 0.60], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28, 40]);
  });

  it('keeps a softer repeat that is held nearly as long', () => {
    // Quieter than the note it follows, so the amplitude half of the unison
    // rule fires — but it rings on almost as long, which no re-detection
    // does. Suppressing on loudness alone would delete it.
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.35, 0.45], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('keeps a staccato repeat played at full weight', () => {
    // Short enough for the duration half of the unison rule to fire, but
    // struck as hard as the note before it. Suppressing on length alone
    // would delete every clipped repeated note in a bassline.
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.1, 0.68], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('returns notes in onset order', () => {
    const kept = suppressHarmonics(DETECTED);
    const onsets = kept.map(n => n.onsetSec);

    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
  });

  it('does not mutate its input', () => {
    // Identities, not just the count: the pass sorts, and sorting in place
    // would leave the caller's array reordered while its length held. The
    // array has to be its own, too — the shared one has been through the
    // suppressor already, and sorting a sorted array changes nothing.
    const input = SPIKE_OUTPUT.map(note);
    const before = input.map(n => n.id);
    suppressHarmonics(input);

    expect(input.map(n => n.id)).toEqual(before);
  });

  it('gives the same answer whatever order the detector reported the notes in', () => {
    // Every pitch here but one is shared by at least two notes, and four of
    // those pairs share an amplitude too (0.514 and 0.264 at pitch 45, 0.329
    // at 52, 0.352 at 62), so neither the pitch sort nor the confidence
    // tie-break fixes the order the greedy pass sees them in; onset has to.
    const expected = suppressHarmonics(DETECTED).map(n => n.id);

    for (let trial = 0; trial < 25; trial++) {
      const shuffled = [...DETECTED];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      expect(suppressHarmonics(shuffled).map(n => n.id)).toEqual(expected);
    }
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
 * What makes this tractable is that a partial is always *above* its
 * fundamental — physics, not a heuristic. So: consider notes lowest first, and
 * drop any that a lower note already explains as one of its partials — one it
 * overlaps, starts no earlier than, and dies away sooner than. Overlap alone
 * is not enough; that would delete octave leaps and slapped pops along with
 * the artefacts. Ordering by pitch guarantees a fundamental has been considered
 * before anything it could explain, without assuming it is the louder of the
 * two. It often is not: in the measured output an octave partial comes back at
 * amplitude 0.548 against the 0.520 of the E1 that produced it.
 *
 * Pure, and independent of any detector.
 */

/**
 * Semitone offsets of the partials a plucked string produces, relative to its
 * fundamental. 2f0 = +12, 3f0 = +19.02, 4f0 = +24, 5f0 = +27.86, 6f0 = +31.02,
 * rounded because detectors report integer MIDI pitches.
 *
 * 0 is included: a unison "partial" is the detector reporting one note twice.
 *
 * +28 and +31 are here on physical grounds alone. The synthetic bassline the
 * fixture came from carried only 2nd, 3rd and 4th harmonics, so no pair in it
 * is 28 or 31 semitones apart and no measurement has yet confirmed a detector
 * reports those two. Real recordings should say.
 */
export const HARMONIC_SEMITONES: number[] = [0, 12, 19, 24, 28, 31];

export interface HarmonicOptions {
  /** Slack at both ends of a fundamental's span, for detector jitter. */
  toleranceSec: number;
  /** A unison counts as a re-detection only below this share of the root's amplitude. */
  unisonAmplitudeRatio: number;
  /** ...and this share of its duration. */
  unisonDurationRatio: number;
  /**
   * A partial decays faster than its fundamental, so it sounds for less of it.
   * Be clear-eyed about this number: it is calibrated on one fixture, whose
   * longest partial runs 0.86 of the note that produced it. 0.90 clears that
   * by four points and nothing more.
   */
  partialDurationRatio: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicOptions = {
  toleranceSec: 0.03,
  unisonAmplitudeRatio: 0.8,
  unisonDurationRatio: 0.5,
  partialDurationRatio: 0.9
};

export function suppressHarmonics(
  notes: DetectedNote[],
  overrides: Partial<HarmonicOptions> = {}
): DetectedNote[] {
  const options: HarmonicOptions = { ...DEFAULT_HARMONIC_OPTIONS, ...overrides };

  // Lowest first, so a fundamental is always considered before its own
  // partials, whatever their relative loudness. Amplitude then orders notes of
  // equal pitch, which is exactly what the unison rule needs: the strong one
  // must be seen first for the weak short one to be read as its re-detection.
  // Onset breaks the remaining ties, keeping the result deterministic.
  const byPitch = [...notes].sort(
    (a, b) => a.pitch - b.pitch || b.confidence - a.confidence || a.onsetSec - b.onsetSec
  );

  const kept: DetectedNote[] = [];
  for (const note of byPitch) {
    if (!kept.some(root => explains(root, note, options))) kept.push(note);
  }

  return kept.sort((a, b) => a.onsetSec - b.onsetSec || a.pitch - b.pitch);
}

/** True when `note` is a partial, or a re-detection, of the lower `root`. */
function explains(
  root: DetectedNote,
  note: DetectedNote,
  options: HarmonicOptions
): boolean {
  const interval = note.pitch - root.pitch;
  if (!HARMONIC_SEMITONES.includes(interval)) return false;

  // The two have to be sounding at the same time. Spans must overlap rather
  // than the partial's onset falling inside its fundamental: a re-detection
  // often begins a frame or two *before* the note it duplicates, and an
  // onset-containment test would let those through.
  const overlaps =
    note.onsetSec <= root.offsetSec + options.toleranceSec &&
    root.onsetSec <= note.offsetSec + options.toleranceSec;
  if (!overlaps) return false;

  const rootDuration = root.offsetSec - root.onsetSec;
  const noteDuration = note.offsetSec - note.onsetSec;

  if (interval > 0) {
    // A partial is set ringing by the same pluck as its fundamental, so it
    // cannot start first. Unison is exempt on purpose: a re-detection often
    // straddles the onset of the note it duplicates, and the symmetric
    // overlap above is what catches the earlier half of such a pair.
    if (note.onsetSec < root.onsetSec - options.toleranceSec) return false;

    // Overlap alone would delete real music: an octave leap over a ringing
    // low note, a slapped pop over its thumbed root, pumping octave eighths.
    // Amplitude cannot separate those from partials — in the fixture a
    // partial comes back 5 % *louder* than the note that produced it — but
    // duration can, because the higher modes of a plucked string damp faster
    // than the fundamental and so sound for less of it.
    return noteDuration < rootDuration * options.partialDurationRatio;
  }

  // Unison needs more care. A note genuinely struck twice also overlaps itself
  // when the first one is still ringing, and suppressing that would delete
  // repeated notes — which basslines are full of. A re-detection is both
  // markedly quieter and markedly shorter than the note it duplicates; a real
  // second attack is neither.
  return (
    note.confidence < root.confidence * options.unisonAmplitudeRatio &&
    noteDuration < rootDuration * options.unisonDurationRatio
  );
}
```

**Step 4: Run test to verify it passes**

Expected: PASS, 24 tests. The first assertion — 34 notes in, the exact eight played events out, by identity — is the one that matters.

**Step 5: Commit**

```bash
git add src/app/services/transcription-harmonics.ts src/app/services/transcription-harmonics.spec.ts
git commit -m "feat: Suppress harmonic partials from detector output"
```

**Amended after review: suppression has to say what it removed.**

As first written, `transcribe` kept only the return value, so the 26 suppressed notes of a 34-note detection were not retained, not reported and not recoverable — `session.notes` *was* the post-suppression list. `DerivedScore.dropped` exists so a `ScoreDoc` can say why a bar is empty and M3 can render a rejected note greyed; on real material the largest discard category by an order of magnitude was invisible to it, including the known false positive of scope decision 2 (a short line over a held pedal).

Three changes, none of them structural:

- `suppressHarmonics(notes, overrides, suppressed?)` takes an **out-parameter**, not a `{ kept, suppressed }` return. Chosen to match `quantizeBar`, which made the same call for the same situation and wrote down why: the return value is what the module is about, and here twenty-eight call sites across the specs assert on the kept notes and nothing else. One convention for both discard channels beats two.
- `TranscriptionSession.rawNotes` holds the detector's whole output. `notes` is a subset of it — the same objects — so nothing is destroyed at detection time.
- `TranscriptionState.suppressed` surfaces the partials for M3. At state level rather than on the session because it is what the current suppression pass concluded, not a fact about the audio; `rawNotes` is the fact.

**Follow-up this enables, and M3 should do: move suppression into the re-derive path.** M1's model says detected events are facts and everything else is interpretation. Harmonic suppression is a five-parameter heuristic calibrated on one fixture — interpretation — but M2 runs it once, at detection time, on the facts side of the line, where only re-running the model can undo it. With `rawNotes` on the session the rest is mechanical: put `HarmonicOptions` in `DerivationSettings`, run `suppressHarmonics` at the top of `rederive` over `session.rawNotes`, and the suppression thresholds become live knobs like every other. The one thing that is *not* mechanical is beat tracking, which runs on the suppressed notes by necessity (see `TranscriptionService`'s docblock) and would have to be re-run with them — which is why this is M3 work and not a footnote to M2.

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

/** Notes at the given times, each as loud as `confidence` says. */
function notesAt(onsets: number[], confidence: (index: number) => number = () => 0.8): DetectedNote[] {
  return onsets.map((onsetSec, i) => ({
    id: `n${i}`,
    pitch: 33,
    onsetSec,
    offsetSec: onsetSec + 0.3,
    confidence: confidence(i),
    bendCents: []
  }));
}

/** Gaps between consecutive beats. */
function gapsOf(beats: number[]): number[] {
  return beats.slice(1).map((beat, i) => beat - beats[i]);
}

describe('onsetSignal', () => {
  it('puts energy at each onset and none between', () => {
    const signal = onsetSignal(pulse(4, 0.5), 2, DEFAULT_BEAT_OPTIONS.frameRateHz);
    const rate = DEFAULT_BEAT_OPTIONS.frameRateHz;

    expect(signal[0]).toBeGreaterThan(0);
    // A quarter of the way between two onsets is well clear of both.
    expect(signal[Math.round(0.25 * rate)]).toBeLessThan(signal[0] * 0.1);
  });

  it('spreads each onset over its neighbouring frames', () => {
    // The blur is the whole reason a beat one frame off an onset still scores,
    // which is what lets the tracker follow a period that is not a whole
    // number of frames. Bare impulses pass every other test in this file.
    const signal = onsetSignal(pulse(4, 0.5), 2, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(signal[1]).toBeGreaterThan(signal[0] * 0.5);
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

  it('reads the beat and not the subdivision off barely accented eighths', () => {
    // Eighth notes at 100 BPM, the on-beat ones only 5 % louder. Raw
    // autocorrelation prefers the eighth: every onset lines up at that lag,
    // and the shorter lag has one more overlapping term to sum. Scored
    // without the log-normal prior this fixture returns 200 BPM; the prior is
    // the only thing in the module that recovers 100, and nothing else here
    // tests it.
    const eighths = notesAt(
      Array.from({ length: 30 }, (_, i) => i * 0.3),
      i => (i % 2 === 0 ? 0.8 : 0.76)
    );
    const signal = onsetSignal(eighths, 9, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(100, -0.5);
  });

  it('cannot read a tempo much above 175 BPM, and halves it instead', () => {
    // Not a defect to fix — the log-normal prior is doing exactly what it is
    // there for, and past roughly 175 BPM its penalty on the true lag exceeds
    // that lag's correlation advantage over its own double, so the answer
    // comes back exactly halved: 180 as 90, 200 as 100, 210 as 105. `maxBpm`
    // is therefore the band the search considers, not a tempo it can return.
    // Pinned here so any later change to the prior shows up as a diff.
    const at = (bpm: number) =>
      onsetSignal(pulse(40, 60 / bpm), (40 * 60) / bpm, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(at(170), DEFAULT_BEAT_OPTIONS)).toBeGreaterThan(160);
    expect(estimateTempo(at(180), DEFAULT_BEAT_OPTIONS)).toBeCloseTo(90, -0.5);
  });

  it('reads half tempo off a bass playing roots on beats 1 and 3', () => {
    // Inherent to tracking note onsets rather than a spectral flux envelope —
    // scope decision 1. Half-note-sparse material leaves no onset energy at
    // the quarter-note lag for the prior to weigh, so 120 BPM reads as 60 and
    // every note is notated at twice its written value. Pinned, not fixed:
    // the fix is the spectral envelope, which is the documented upgrade path
    // and would change only `onsetSignal`.
    const onsets = Array.from({ length: 8 }, (_, bar) => [bar * 2, bar * 2 + 1]).flat();
    const roots = notesAt(onsets);

    expect(estimateTempo(onsetSignal(roots, 16, DEFAULT_BEAT_OPTIONS.frameRateHz)))
      .toBeCloseTo(60, -0.5);

    const gaps = gapsOf(trackBeats(roots, 16, FOUR_FOUR).beatsSec);
    for (const gap of gaps) expect(gap).toBeCloseTo(1, 1);
  });

  it('falls back to a working frame rate rather than to priorBpm', () => {
    // With an unusable rate, `maxLag` comes out zero, the search loop never
    // runs and the function returns `priorBpm` — 120, a plausible number that
    // no caller can tell from an honest "nothing correlated" fallback. It is
    // exported, so it has to sanitise its own options rather than trust
    // `trackBeats` to have done it.
    const signal = onsetSignal(pulse(16, 60 / 90), 11, DEFAULT_BEAT_OPTIONS.frameRateHz);

    for (const frameRateHz of [0, Number.NaN, -50]) {
      const bpm = estimateTempo(signal, { ...DEFAULT_BEAT_OPTIONS, frameRateHz });

      expect(bpm).withContext(`frameRateHz ${frameRateHz}`).toBeCloseTo(90, -0.5);
    }
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

  it('lays the first beat on the music, not on the silence in front of it', () => {
    // Only frames inside the first half-period can start a DP chain, so the
    // untrimmed backtrace always reaches back to within half a beat of frame
    // zero. Music that starts later arrives with a run of beats no note
    // supports in front of it, and `deriveScore` reads beatsSec[0] as bar 1
    // beat 1 — so the five phantoms this fixture used to produce put the first
    // played note on bar 2 beat 2 with the tempo still exactly right.
    const grid = trackBeats(pulse(16, 0.5, 2.7), 10.7, FOUR_FOUR);

    expect(Math.abs(grid.beatsSec[0] - 2.7)).toBeLessThan(0.5);
  });

  it('stops at the last note rather than filling the stated duration', () => {
    // Eight seconds of music in a forty-second file. The beats past the end
    // corrupt nothing — `score-derivation.ts` sizes the score from the notes
    // it placed — but they are noise in an artifact a user has to correct by
    // hand, and this fixture used to end 65 beats past the last note. The
    // smoothing window carries one beat of ring-out past the last onset at
    // 7.5 s, which is why this allows a beat and not none.
    const grid = trackBeats(pulse(16, 0.5), 40, FOUR_FOUR);

    expect(grid.beatsSec[grid.beatsSec.length - 1]).toBeLessThan(8.5);
  });

  it('finds the beat when it is not at the start of the file', () => {
    // Pulse offset half a beat from zero. Every other trackBeats fixture starts
    // at t=0, where landing on the onsets and laying an even grid from frame 0
    // are the same grid — this is the one that tells phase from luck.
    const onsets = Array.from({ length: 16 }, (_, i) => 0.25 + i * 0.5);
    const grid = trackBeats(notesAt(onsets), 8.25, FOUR_FOUR);

    const tracked = grid.beatsSec.filter(beat => beat <= 7.8);
    expect(tracked.length).toBeGreaterThan(14);
    for (const beat of tracked) {
      expect(Math.min(...onsets.map(onset => Math.abs(onset - beat)))).toBeLessThan(0.03);
    }
  });

  it('tracks at the sanitised frame rate, not the one it was handed', () => {
    // The rate is sanitised once and then used for the onset signal and the
    // beat times — but the raw options used to reach `estimateTempo`, which
    // then returned `priorBpm`. The grid that came back was structurally
    // perfect and 120 BPM against music played at 90.
    for (const frameRateHz of [0, Number.NaN, -50]) {
      const grid = trackBeats(pulse(16, 60 / 90), 11, FOUR_FOUR, {
        ...DEFAULT_BEAT_OPTIONS,
        frameRateHz
      });
      const gaps = gapsOf(grid.beatsSec);
      const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

      expect(60 / meanGap).withContext(`frameRateHz ${frameRateHz}`).toBeCloseTo(90, -0.5);
    }
  });

  it('does not let one bad onset size the grid', () => {
    // `spanSec` takes the largest finite onset, so before the clamp a stray
    // `onsetSec: 1e7` asked for a billion frames — four gigabytes — and then
    // ran a dynamic program over them, hanging the thread. `durationSec` is
    // the authority on how long the source is, the same call
    // `score-derivation.ts` makes in `barsInSource`.
    const notes = [...pulse(8, 0.5), ...notesAt([1e7])];

    expect(onsetSignal(notes, 4, DEFAULT_BEAT_OPTIONS.frameRateHz).length).toBeLessThan(1000);
    expect(trackBeats(notes, 4, FOUR_FOUR).beatsSec.every(beat => beat < 6)).toBeTrue();
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

  it('follows the music when the tempo changes', () => {
    // 120 BPM for four seconds, then 132. Every other test in this file uses a
    // pulse starting at zero and holding one tempo, which an evenly spaced
    // grid laid down from frame zero satisfies without tracking anything -
    // this is the fixture that tells a dynamic program from a ruler.
    const onsets = [
      ...Array.from({ length: 8 }, (_, i) => i * 0.5),
      ...Array.from({ length: 9 }, (_, k) => 4 + k * (60 / 132))
    ];
    const grid = trackBeats(notesAt(onsets), 8, FOUR_FOUR);

    // Every beat sits on a note, before and after the change.
    for (const beat of grid.beatsSec) {
      const nearest = Math.min(...onsets.map(onset => Math.abs(onset - beat)));
      expect(nearest).toBeLessThan(0.015);
    }

    // And the beat speeds up with them rather than holding the old period.
    const tail = gapsOf(grid.beatsSec.filter(beat => beat >= 4));
    const meanGap = tail.reduce((sum, gap) => sum + gap, 0) / tail.length;

    expect(meanGap).toBeCloseTo(60 / 132, 2);
  });

  it('produces a structurally valid grid from degenerate input', () => {
    // Nothing downstream checks these, so the guarantee has to hold here:
    // `secondsToBeats` divides by the gap between neighbouring beats, and a
    // one-entry or NaN-bearing grid would silently poison every derived time.
    // These are also the cases where the trim can take everything: a lone
    // onset leaves one beat above threshold, and silence leaves none, so both
    // have to come back out as the even grid rather than as a stub.
    const cases: [string, DetectedNote[], number][] = [
      ['a single note', notesAt([1]), 4],
      ['every note at the same instant', notesAt([2, 2, 2, 2, 2]), 4],
      ['notes with no confidence at all', pulse(8, 0.5).map(n => ({ ...n, confidence: 0 })), 4],
      ['a zero duration and no notes', [], 0],
      ['a zero duration with notes', notesAt([0, 0.5, 1]), 0],
      ['a negative duration', [], -3],
      ['a duration that is not a number', [], Number.NaN]
    ];

    for (const [label, notes, durationSec] of cases) {
      const beats = trackBeats(notes, durationSec, FOUR_FOUR).beatsSec;

      expect(beats.length).withContext(label).toBeGreaterThanOrEqual(2);
      expect(beats.every(beat => Number.isFinite(beat))).withContext(label).toBeTrue();
      expect(gapsOf(beats).every(gap => gap > 0)).withContext(label).toBeTrue();
    }
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './beat-tracking'`.

**Step 3: Write minimal implementation**

Create `src/app/services/beat-tracking.ts` implementing:

- `onsetSignal(notes, durationSec, frameRateHz): Float32Array` — an impulse at each onset weighted by `confidence`, then a Gaussian blur of about 20 ms so a beat still scores when an onset sits slightly off it. Measure the Gaussian from the *unrounded* onset rather than from its nearest frame — free, and sub-frame accurate instead of up to 5 ms off. It sizes itself from the largest onset, so that has to be **clamped to `durationSec` plus a second** whenever `durationSec` is a usable positive number: unbounded, a stray `onsetSec: 1e7` asks for a billion frames — four gigabytes — and then a dynamic program of ~7.5e10 iterations that never returns. `durationSec` is the authority on how long the source is, the same call `score-derivation.ts` makes in `barsInSource`.
- `estimateTempo(signal, options): number` — autocorrelation across lags spanning `minBpm`..`maxBpm`, each lag's score scaled by Ellis's log-normal prior `exp(-0.5 * (log2(bpm / priorBpm) / priorWidth)^2)`. The prior is what stops the estimate locking onto a *subdivision* of the played tempo, which is the classic failure. It **sanitises `frameRateHz` itself** rather than trusting the caller — it is exported, and an unusable rate leaves `maxLag` at zero, so the search loop never runs and it returns `priorBpm`: 120 BPM against music played at 90, in a grid nothing downstream can tell from a tracked one. `trackBeats` passes the rate it sanitised for `onsetSignal` on to it for the same reason. Round the lag band **inward** — `ceil` for `minLag`, `floor` for `maxLag` — so it stays inside the tempos the caller asked for; outward reached 214.29 BPM against a stated 210. And note what `maxBpm` can and cannot promise: see the limitation on the tempo ceiling below.
- `trackBeats(notes, durationSec, timeSignature, options?): BeatGrid` — the dynamic program. For each frame `i`, score it as `signal[i] + max over j in [i - 2P, i - P/2] of (score[j] - tightness * log((i - j) / P)^2)`, where `P` is the period in frames. Record a back-pointer, then backtrace from the best-scoring frame in the final period. The squared-log penalty lets the beat drift with the music but not skip one.
- Both public entry points take **`Partial<BeatTrackingOptions>` merged over the defaults**, matching `suppressHarmonics(notes, overrides: Partial<HarmonicOptions> = {})` in Task 1 — a caller overriding one knob should not have to restate the other five.
- **Trim the backtrace** before returning it, as librosa's `__trim_beats` does. The DP can only start a chain in the first half-period, so its first beat is *structurally* always less than half a beat into the file: music that starts at 2.7 s comes back with five beats in front of it that no note supports, and since `deriveScore` reads `beatsSec[0]` as bar 1 beat 1, that puts the first played note on bar 2 beat 2 with the tempo still perfectly right. The tail is the same fault reversed — 8 s of music in a file stated as 40 s long produced 81 beats, 65 of them past the last note. So: sample the local score at the beat frames, smooth it with the three non-zero taps of a five-point Hann window, and keep the run from the first to the last beat clearing half the RMS of that curve. When nothing clears it — a lone onset, silence — fall through to the even grid rather than returning a stub. One deliberate deviation from librosa, whose slice stops *before* the last beat it just called valid and so drops a real one.

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

Expected: the beat spec passes, and the full suite is 155 + 24 + 20 = 199.

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

### Two of the nine live knobs have no service method

The design doc's review screen lists nine controls that re-derive in milliseconds: tempo, meter, downbeat phase, tuning, capo, finest division, triplets, confidence floor, position hint. Seven of them are reachable — six are `DerivationSettings` fields that `updateSettings` writes, and `updateTimeSignature` covers meter. **Tempo and downbeat phase are not.** Both mean changing `grid.beatsSec`: `BeatGrid`'s docblock prescribes exactly how — a corrected tempo regenerates the beats, a corrected downbeat phase trims them — and nothing implements either. M3 needs both, and the downbeat control is also what would make `beatsSec[0]` a downbeat rather than a convention (scope decision 3).

### End-to-end settings coverage through the service is thin

`transcription.service.spec.ts` exercises `confidenceFloor`, `capo`, `tuning` and now `finestDivision`; `allowTriplets`, `key`, `maxFret` and `positionHint` are covered only in `score-derivation.spec.ts`, against sessions built by hand. Meters were denominator-4 only until the error-contract work added /8 and /32 — **which is exactly what hid the throw that work fixed.** The pure modules are covered thoroughly; the seam where a real session meets a real setting is not, and that seam is where the two live knobs interact.

### Tidied after review, not otherwise interesting

- **A pre-grid note is now dropped for the right reason.** `trimBeats` can start the grid past quiet leading notes; `deriveScore` clamps those onto beat 0, where two of them collide and one is lost. That was reported as `stringTaken`, which describes a chord the performance did not contain. There is now a `beforeGrid` `DropReason`, applied when the clamp is what actually moved the note — a note a fraction of a slot early rounds onto slot 0 either way, so its collision is genuine and still reads `stringTaken`. **Residue, not fixed:** when a clamped note collides with a note genuinely on beat 1, the clamped one wins, because `addToChord` keeps the earlier onset and a pre-grid note by definition has one. The note that belongs there is the one lost, and it is reported as `stringTaken`. Arguably the clamp should lose that fight; changing it changes what gets written, so it waits for the downbeat control that makes the question moot.
- **`ChromeHeadlessNoSandbox` is gone from `karma.conf.js`.** It was referenced nowhere, and since the custom `ChromeHeadless` shadows the stock launcher it inherited the SwiftShader flags while still passing `--disable-gpu` — so any CI reaching for it by name would have got the CPU backend and failed `worker-detector.spec.ts`'s `backend === 'webgl'` assertion, on the launcher named for safety. `--no-sandbox` is already on the one launcher that remains.
- **22050 is declared once.** It was `TARGET_SAMPLE_RATE` in `audio-decode.ts` and `MODEL_SAMPLE_RATE` in `basic-pitch-detector.ts`, two ends of one contract that had to agree with nothing linking them. Now `DETECTION_SAMPLE_RATE` in `note-detector.ts`, which is the boundary they meet at and the only home that does not break the bundling constraint — the decoder cannot import from `basic-pitch-detector.ts` without dragging TF.js into the main bundle.
- **`messageOf` is declared once,** in `error-message.ts`, with an `errorOf` beside it for the callers that need an Error rather than a string. It was written out five times across `transcription.service.ts`, `worker-detector.ts` and `detection.worker.ts`. The module is two functions and no imports, because the worker imports it too.

- **Short notes at a partial's interval over long ones.** Task 1 keeps a note above a ringing lower note when it lasts at least 0.9 of it, which saves double-stops, octave leaps and slapped pops; a *short* note at +12, +19, +24, +28 or +31 over a held pedal is still read as that pedal's partial and deleted. See scope decision 2.
- **Any tolerance on the partial intervals themselves.** `HARMONIC_SEMITONES` matches integer offsets exactly, and only the 5th partial is far enough off a semitone to make that look risky: 5f0 sits at +27.863, so it lands on +28 unless the fundamental is detected more than 36 cents flat of its own bin centre. Real strings are inharmonic, and inharmonicity pushes upper partials *sharp* — toward +28, not away from it. So no tolerance is needed now. If measurement ever says otherwise, the fix is to test `Math.abs(interval - exact) <= 0.5` against the exact ratios (12, 19.020, 24, 27.863, 31.020), **not** to add a flat +27 entry: +27 is a real interval a bass player can play against a ringing low note, and listing it would delete those notes outright.
- **Evidence for +28 and +31.** Both are in the list on physical grounds. The fixture's synthetic source carried only 2nd, 3rd and 4th harmonics, so no pair in it is 28 or 31 semitones apart, and no measurement yet confirms a detector reports them. The two standalone tests for them are constructed, not observed.
- **Tempos much above 175 BPM.** `maxBpm: 210` is the band the autocorrelation search *considers*, not a tempo it can return. Past roughly 175 BPM the log-normal prior's penalty on the true lag exceeds that lag's correlation advantage over its own double, and the estimate comes back exactly halved: 170 reads as 171, but 180 reads as 90, 200 as 100 and 210 as 105. Raising `maxBpm` does not help, because it is the prior and not the band that decides. Widening `priorWidth` or moving `priorBpm` up would, at the cost of the subdivision-locking the prior exists to prevent — so the ceiling is documented on the field and pinned by a test rather than tuned around. Real bass parts sit well inside it.
- **Tempo from half-note-sparse material.** A bass playing roots on beats 1 and 3 at 120 BPM reads as 60 BPM, and every note is notated at twice its written value. Inherent to tracking note onsets — see scope decision 1. Pinned by a test.
- **Downbeat detection** — see scope decision 3.
- **Spectral-flux onset envelope** — beat tracking uses note onsets; see scope decision 1.
- **A no-WebGL fallback.** The CPU backend is ~100× slower and unusable for full songs. Bumping TF.js to 4.x via `overrides` would unlock the WASM backend, and is worth trying once — Basic Pitch touches only `loadGraphModel`, `slice`, `concat1d`, `signal.frame`, `expandDims`, `zeros`, `tensor` and `GraphModel.execute`.
- **The review UI** — that is M3.
- **Streaming posteriorgrams.** They accumulate as `number[][]`: roughly 45 MB of doubles for a 4-minute stem, plus per-row overhead. Fine for now, worth typed-array backing later.
