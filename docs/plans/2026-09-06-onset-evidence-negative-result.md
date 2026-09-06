# Onset Posteriorgram as Partial Evidence — Negative Result

**Date:** 2026-09-06
**Status:** Measured, rejected. No production code changed.

Three milestones of planning documents assert that the remaining headroom in harmonic suppression is *frame-level evidence the pipeline computes and discards*, and that separating a struck octave from a ringing partial needs the onset posteriorgram.

**That is measured and it is false.** This document records the measurement so nobody spends the effort again.

---

## The claim tested

Basic Pitch emits three posteriorgrams — frames, onsets, contours. `outputToNotesPoly` consumes them and `BasicPitchDetector.detect` discards `onsets` after building note events.

The physical claim: **a struck octave has its own attack — a fresh spike in the onset posteriorgram at that pitch bin at that time — while a ringing partial rises with its fundamental and shows sustained frame activation without an independent onset spike.**

## What was extracted

Five numbers per note, read at its own `(startFrame, pitchMidi - 21)`:

| field | what it is |
|---|---|
| `atStart` | `onsets[startFrame][bin]`, unmodified |
| **`peak`** | max over `startFrame ± 2` frames — the headline |
| `onsetBefore` | mean over `startFrame-10 .. startFrame-3`; `peak - onsetBefore` is prominence |
| `frameAtStart` | `frames[startFrame][bin]` |
| `frameBefore` | mean over the same pre-window — was this bin already ringing? |

`peak` rather than `atStart` because `outputToNotesPoly` does not place starts where the onset head peaks: it peak-picks `max(onsets, rescaled frame-difference)`, and the melodia pass places starts by walking frame energy backwards with no onset involvement at all. ±2 frames is ±23 ms.

## Synthetic material (labelled by ground truth) — excellent

Upper note of a staggered harmonic overlap, restricted to pairs whose upper note starts later. n = 23 struck / 48 partial.

| population | min | q1 | med | q3 | max |
|---|---|---|---|---|---|
| struck (must keep) | 0.234 | **0.800** | 0.899 | 0.939 | 0.979 |
| partial (must drop) | 0.086 | 0.398 | 0.576 | 0.629 | **0.757** |

**AUC 0.941.** Register-controlled per octave band: 0.763 / 1.000 / 0.956 / 0.974 / 1.000.

## Real material (labelled by monophony) — it inverts

On a monophonic bass stem the upper note of a **same-attack** harmonic pair is a partial. That yields 214 known partials and 509 known struck notes from 1224 raw detections.

| population | min | q1 | med | q3 | max |
|---|---|---|---|---|---|
| known struck | 0.217 | 0.585 | **0.669** | 0.758 | 0.924 |
| known partial | 0.172 | 0.649 | **0.725** | 0.788 | 0.883 |

**AUC 0.396 — below chance.** The partial median is *higher*. 87 % of known partials sit at or above the struck first quartile, against 37 % on synthesis. Prominence is worse: **AUC 0.159**, medians 0.281 struck against 0.462 partial.

In ratio form, beside the confidence ratio it was meant to replace:

| ratio | population | min | q1 | med | q3 | max |
|---|---|---|---|---|---|---|
| confidence | synthetic artefacts | 0.33 | 0.44 | 0.49 | 0.55 | **0.94** |
| confidence | synthetic real notes | **0.96** | 1.07 | 2.46 | 2.48 | 2.55 |
| confidence | real partials | 0.37 | 0.50 | 0.60 | 0.73 | 1.41 |
| **onset peak** | synthetic artefacts | 0.36 | 0.79 | 0.82 | 0.89 | **1.56** |
| **onset peak** | synthetic real notes | **1.34** | 1.61 | 1.81 | 1.88 | 1.89 |
| **onset peak** | real partials | 0.45 | 0.86 | 0.94 | 1.04 | 1.97 |

The confidence ratio at least had a clean synthetic gap (0.94 / 0.96) for 0.65 to sit in. **The onset-peak ratio overlaps on synthesis already** (1.56 > 1.34). It is strictly worse.

## Why the features that score well are traps

`frameAtStart` reaches AUC 0.860 on the real labelled set. It is a trap three times over:

- **It is `confidence` recycled** — r = 0.845 across all 1224 detections. `confidence` is the mean frame activation; this is one sample of it.
- **`confidence` alone scores AUC 0.919**, higher than anything extracted. The feature already known to fail beats every posteriorgram feature — because it fails as a *comparison between two notes*, which is what suppression needs, not as a threshold on one.
- **It is a pitch meter.** On this stem partials sit at MIDI 39–66 (median 51), struck notes at 27–51 (median 35). Correlation with pitch: `confidence` −0.466, `onsetBefore` −0.528, `frameAtStart` −0.372.

The only register-neutral features are `peak` (r = −0.042) and `frameRise` (r = −0.042), scoring **0.396** and **0.507**. The one unconfounded feature is the anti-predictive one. That is what makes the result clean rather than merely disappointing.

## What it would cost if shipped anyway

Rule: on the staggered partial branch, drop when `peak < T`.

| T | synthetic P / R / F1 / destroyed | of the 40 cut | real partials cut | real struck cut |
|---|---|---|---|---|
| — | 61.5 / 70.3 / 65.6 / 3 | 0 | — | — |
| 0.5 | 62.1 / 70.3 / 66.0 / 3 | 16 | 10 (5 %) | 15 (3 %) |
| **0.6** | 62.4 / 70.3 / **66.1** / 3 | 28 | 33 (15 %) | **153 (30 %)** |
| 0.7 | 62.3 / 69.8 / 65.8 / 4 | 33 | 91 (43 %) | 296 (58 %) |

At its best synthetic operating point — a genuine +0.9 precision with no extra destruction — it removes **twice as many real notes as partials** on real audio.

## The 87 staggered overlaps are really 40

Split by onset order: **41 pairs (40 distinct notes)** have the upper note later and are partial candidates at all. The other **46 have the upper note first** and cannot be partials of the lower note; `explains` already rejects them.

**Those 46 are a metric artefact, not a defect.** They are counted as overlaps because the lower note's reported offset runs past the next onset — but `offsetSec` never reaches the written score. `PlacedNote` carries only `beatInBar` and `pitch`, and `score-derivation.ts` and `transcription-quantize.ts` do not mention `offsetSec` at all; every note is written until the next onset by construction.

Truncating offsets on a monophonic source, which looks like an obvious cheap fix, would therefore change nothing in the notation and would make suppression **worse**: a truncated root no longer overlaps a later partial, so `explains` would stop suppressing it.

## Conclusion

The evidence being discarded is not the bottleneck, and the "frame-level evidence is the ceiling" claim in the M2, M3 and accuracy plans is wrong.

Basic Pitch's onset head is a *learned onset likelihood* trained on real music where octaves are played — not a physical attack measurement — and on a real bass stem it fires on partials slightly more readily than on struck notes. Register-neutral and anti-predictive over a labelled real-material population of 723 is about as conclusive as one file allows.

**The ceiling is the detector.** What would actually move it:

1. **Physics rather than a classifier** — harmonic-sum f0 scoring over the spectrum. A partial at 2f0 explains less of the observed spectrum than the true fundamental does, and that is a measurement rather than a learned prior. Needs frame-level DSP in the worker; unproven here.
2. **A bass-specific or multi-instrument model.** Basic Pitch is instrument-agnostic and reports partials as notes because, in polyphonic training material, they often are.
3. Nothing at the suppression layer. Every feature available to it that looks predictive on real audio is measuring pitch.

## Caveats

One real file, one instrument, one player. Only 6 same-attack real-note pairs exist in the entire synthetic set, so the synthetic "struck" population is thin. A second real stem — ideally chordal — would test whether the inversion is general or specific to this recording.
