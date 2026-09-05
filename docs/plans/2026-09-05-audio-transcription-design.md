# Audio Transcription Design

**Date:** 2026-09-05
**Status:** Design agreed, not yet implemented
**Scope of v1:** Guitar/bass stem → tablature, starting with bass

---

## Thesis

Automatic music transcription is not won by having a better note detector. Detection is a research problem where the state of the art is broadly shared and hard to beat.

It is won by the pipeline *around* the detector, and by what happens to the errors.

The commonly reported weaknesses of AnthemScore — the closest comparable product — are not detection failures:

- No source separation, so everything lands in one undifferentiated pile.
- Poor rhythm quantization: durations that do not fill the bar, drifting beat grids.
- No key inference, so enharmonic spelling is arbitrary.
- Tab that is pitch-correct but unplayable, because fingering ignores hand position.
- Transcription is a one-way trip. A wrong tempo or tuning guess means re-running everything or hand-fixing hundreds of notes.

Every one of those is addressable with deterministic algorithms and a better data model. None requires beating anyone's neural network.

This project also starts with an advantage that is hard to overstate: **the composer already exists.** `ScoreDoc` is a full GP7/alphaTab-shaped score tree with fretted note pitches, and there is a working editor on top of it. Transcription output has a native place to land, and a best-in-class correction UI is already built. Errors that survive the pipeline land somewhere the user can actually fix them.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| v1 target | Guitar/bass stem → tab, bass first | On-brand; bass is near-monophonic so the whole pipeline can be validated on material where errors are rare and obvious |
| Inference location | Browser-first (Web Worker), server escape hatch | Taking a pre-isolated stem eliminates Demucs, the only model too heavy for the browser. Zero GPU cost, no upload, seconds-long iteration on the parts that matter |
| Data model | Two layers: raw events + derived score | Makes tempo, meter, tuning, capo, grid and key into live knobs instead of baked-in guesses |
| First slice | Bass stem, end to end | Proves the architecture before fighting polyphony; useful on its own |

---

## 1. The two-layer model

The boundary that everything hinges on: **the model produces facts in seconds; the score is an interpretation of those facts.** Keep them separate and the interpretation becomes a pure function that can be re-run for free.

```typescript
/** Raw detector output. Absolute time in seconds. Source of truth. */
export interface DetectedNote {
  id: string;
  pitch: number;        // MIDI
  onsetSec: number;
  offsetSec: number;
  confidence: number;   // 0-1, straight from the model
  bendCents: number[];  // per-frame deviation; empty when unused
}

export interface BeatGrid {
  beatsSec: number[];           // ascending; beatsSec[0] is the first downbeat
  downbeatIndices: number[];    // indices into beatsSec — M2, see below
  timeSignature: TimeSignature; // reused from composer.model.ts
}

/** Every knob that turns detection into notation. */
export interface DerivationSettings {
  tuning: number[];             // MIDI per string, high to low
  capo: number;
  finestDivision: DurationValue;
  allowTriplets: boolean;
  key: KeySignature | null;     // null = C major until inference lands (M3+)
  confidenceFloor: number;
  maxFret: number;
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
```

Two of those fields are not what M1 shipped, and the difference is deliberate.
`downbeatIndices` is **not in the M1 model**: derivation reads bar 1 as starting
at `beatsSec[0]` and counts uniform bars of `numerator` beats from there, so a
field it never read would have been a trap for M2's beat tracker — populate it,
assume derivation honours it, and a dropped or doubled beat silently writes bars
that disagree with the grid. M2 adds the field and the derivation support that
honours it in the same change. And `key: null` falls back to C major rather than
inferring anything; key inference is deferred.

The entire downstream half of the feature is one signature:

```typescript
function deriveScore(session: TranscriptionSession): DerivedScore
```

Pure. Synchronous. No audio, no model, no Angular. It returns the score **and
the notes it had to throw away** — below the confidence floor, unplayable on the
instrument, or struck on a string another note already held. A `ScoreDoc` cannot
say which notes are missing or why, and showing the user what was discarded is
half of what makes a transcription trustworthy.

Two consequences follow, and they are the reason for this design:

1. The part that actually differentiates the product is fully unit-testable from hand-written fixtures. No WAV files, no model weights, no async.
2. The review UI is trivial. Bind controls to `settings`, call `deriveScore`, re-render. Changing tuning or meter costs milliseconds, not a re-run.

`DetectedNote` data is retained after import, so re-derivation stays available for the life of the session rather than only at import time.

---

## 2. The pipeline

### Decode and resample

Web Audio `decodeAudioData`, then an `OfflineAudioContext` to produce mono at 22.05 kHz, which is what Basic Pitch expects. No dependencies.

### Note detection

Use `@spotify/basic-pitch` for v1 — it ships weights and note-creation post-processing, and is the shortest path to real output. If the TF.js bundle proves too costly, swap to an ONNX Runtime Web export behind the `NoteDetector` interface.

Basic Pitch emits three posteriorgrams at roughly 172 fps: onsets, frames, and pitch contours. Turning those into note events is onset thresholding plus forward frame-tracking. Reimplementing that step in TypeScript later makes the thresholds tunable, but it is not needed on day one.

### Beat tracking

Ellis's dynamic-programming beat tracker:

1. Spectral-flux onset strength envelope.
2. Global tempo estimate by autocorrelation of the envelope, with a log-normal prior centred near 120 BPM.
3. Dynamic programming for the beat sequence maximising onset alignment and tempo consistency.

Roughly 200 lines of TypeScript, no model, and well documented in the literature.

Downbeats are the weak link — see Risks.

### Quantization

This is where AnthemScore visibly fails, and the failure mode is instructive: snapping each onset independently to the nearest grid position produces duration sequences that do not fill the bar, which is what generates strings of spurious 32nd notes and ties.

Instead, run dynamic programming over each bar, choosing a duration sequence that sums **exactly** to the bar length, with costs for:

- deviation from the detected onset time,
- unusual or over-fine durations,
- syncopation not supported by onset strength.

Slower to write, dramatically cleaner output.

### Key inference and spelling

Krumhansl-Schmuckler correlation over the pitch-class histogram gives a key estimate, which drives `fifths` and enharmonic spelling. Matters mainly for the standard-notation staff; tab is unaffected. The user can override, and the override re-derives instantly.

---

## 3. Fingering optimization

The part that makes output feel hand-written. Pure algorithm, no ML, tunable forever.

**Candidate enumeration.** With tuning `t[s]` and capo `c`, string `s` can play pitch `p` at fret `f = p - t[s] - c`, valid when `0 <= f <= maxFret`. Bass in standard tuning `[43, 38, 33, 28]` yields 1-4 candidates per note; guitar up to 6.

**Viterbi over the note sequence**, minimising:

- **Hand movement, scaled by the time gap between notes.** This is the central idea. A five-fret shift is free across a half-rest and unacceptable between consecutive sixteenths. AnthemScore ignores timing here, which is why its tab skitters across the neck on fast passages any player would keep in one position.
- **String changes** — a small penalty, larger for skipping a string.
- **Open strings** — a bonus, not a penalty. They are free and idiomatic.
- **Fret height** — mild preference for lower positions.
- **Position hint** — when the user pins a region of the neck, penalise deviation from it.

Cost is `O(n·k²)` with `k <= 6`. Instant on a full song.

Output is `NotePitch` with `kind: 'fretted'`, which drops into the existing model with no adapter.

**The test that proves it works:** a walking bassline where naive lowest-fret assignment jumps position on every beat and the correct answer stays put. Write that fixture first — it is the feature's thesis in one assertion.

Guitar chords later extend the Viterbi *state* from a single position to a set of positions. Same algorithm, larger candidate space, needs pruning and a stretch penalty.

---

## 4. Angular integration

Five services, following how the composer is already decomposed:

| Service | Responsibility |
|---|---|
| `AudioDecodeService` | File → mono `Float32Array` at 22.05 kHz |
| `NoteDetectionService` | Wraps a swappable `NoteDetector` |
| `BeatTrackingService` | Onset envelope → tempo → beat/downbeat grid |
| `ScoreDerivationService` | Pure: quantize, spell, fingering, build `ScoreDoc` |
| `TranscriptionService` | `BehaviorSubject<TranscriptionState>`, orchestration |

The server escape hatch is a single interface:

```typescript
export interface NoteDetector {
  detect(audio: Float32Array, sampleRate: number,
         onProgress: (fraction: number) => void): Promise<DetectedNote[]>;
}
```

`BasicPitchDetector` today; a `RemoteDetector` posting to the .NET API later. Nothing else in the pipeline knows which is running.

**Detection and beat tracking run in a Web Worker.** Non-negotiable — seconds of blocked main thread on a four-minute file makes the app feel broken. Confining TF.js to the worker also keeps it out of the main bundle.

Components, all standalone per project convention:

- `TranscriptionComponent` — route `/transcribe`, owns the flow
- `AudioDropzoneComponent` — file input, waveform, duration
- `TranscriptionReviewComponent` — settings controls with live alphaTab preview

**The review screen is the product.** Every control change calls `deriveScore` and re-renders in milliseconds: tempo, meter, downbeat phase, tuning, capo, finest division, triplets, confidence floor, position hint. Notes below the confidence floor render greyed rather than disappearing, so the user can see what was discarded and lower the threshold if too much was cut.

Hand-off is one button, *Open in Composer*, calling `ComposerService.replaceDocument(doc)` (`client/src/app/services/composer.service.ts:185`). Because undo/redo already wraps that method, importing a transcription is undoable for free.

`takeUntil(destroy$)` on every subscription. The worker terminates and the `AudioContext` closes in `ngOnDestroy`.

---

## 5. Testing

Three tiers. Most of the value sits in the tier that needs no audio at all.

**Tier 1 — Pure derivation.** Hand-written `DetectedNote[]` plus a synthetic `BeatGrid` in, expected `ScoreDoc` out. No models, no files, milliseconds to run. Covers quantization, spelling and fingering — everything that differentiates the product.

Two tests to write before anything else:

- *Bar-sum invariant* (property test): for any event list and any settings, every derived bar's durations sum **exactly** to its time signature. This single assertion is what prevents AnthemScore-style rhythm garbage.
- *Position stability*: the walking-bassline fixture from section 3.

Then capo offsets, `maxFret` clamping, open-string preference, unreachable pitches, and structural validity of the emitted `ScoreDoc` (staff bars parallel to `masterBars`).

**Tier 2 — DSP on synthetic audio.** Construct `Float32Array` buffers directly; no `AudioContext`, no committed binary fixtures. A click track at exactly 120 BPM must yield 120 BPM within tolerance with beats on the clicks. Sawtooths at known pitches and onsets exercise the onset envelope.

**Tier 3 — Model integration.** A handful of short real clips, run rarely, treated as regression guards rather than unit tests.

Component tests receive a stub `NoteDetector` returning fixed events.

**Beyond tests: an accuracy harness.** "Better than AnthemScore" needs a number or it is vibes. Build a small eval set of bass clips with ground-truth MIDI and compute `mir_eval`-style onset F1 and note F1 — onset within 50 ms, exact pitch. Run it on every threshold change. Without it, the confidence floor gets tuned by feel and silently regresses.

---

## 6. Milestones

**M1 — Derivation core.** Types, `deriveScore`, quantization DP, fingering Viterbi, and their tests. No UI, no audio, no models — pure TDD from fixtures. Most of the differentiating work, provable before touching a single WAV.

**M2 — Audio in, notes out.** Decode/resample, Web Worker, Basic Pitch, beat tracking. End to end: file → `TranscriptionSession`.

**M3 — Review UI.** `/transcribe`, dropzone, live controls, alphaTab preview, *Open in Composer*.

**M4 — Accuracy harness.** Eval set, F1 metrics, threshold tuning against a number.

---

## Out of scope for v1

Each is a real feature; none is needed to prove the thesis.

- Source separation (Demucs) and full-mix input
- Guitar polyphony and chord shapes
- Drum transcription
- Server-side inference
- Persisting `TranscriptionSession` to the API
- Bend, slide and vibrato detection from pitch contours

## Likely order after v1

1. **Guitar polyphony** — extends the Viterbi state to sets of positions.
2. **Server-side Demucs → full mixes.** This is where the Python microservice arrives; the `NoteDetector` interface already anticipates it.
3. **Bend and slide detection** from Basic Pitch's pitch contours — guitar-specific and genuinely differentiating.
4. **Persisted sessions**, so teachers can assign transcription exercises. Fits the existing SaaS roadmap.

---

## Risks

**Downbeat detection from a bass stem alone is unreliable.** Not "needs tuning" — genuinely hard without harmonic or percussive context. The mitigation is architectural rather than algorithmic: make downbeat phase and meter into controls, and let instant re-derivation absorb the error. A human fixes in two seconds what an algorithm gets wrong a large fraction of the time.

**Bass is the weakest region for most detectors.** Fundamentals below 100 Hz sit where CQT resolution is poorest, and the classic failure is locking onto the second harmonic, an octave high. But the pipeline has a constraint the model does not: **any pitch below the open low string is unplayable on the instrument.** A dedicated octave-correction pass using the tuning is cheap and should fix a meaningful share of errors. This kind of instrument-aware correction is exactly the category of work the competition does not do.

**TF.js bundle size.** Mitigated by lazy-loading the worker, and by the ONNX swap path if it remains a problem.
