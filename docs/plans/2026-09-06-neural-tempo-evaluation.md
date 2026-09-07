# Neural Tempo Estimation — Evaluation and Decision

**Date:** 2026-09-06
**Status:** Measured, declined. No production code changed; the spike is reverted.
**Decision:** **Do not use essentia.js.** Licensing, not capability.

`beat-tracking.ts` reads a 153 BPM bassline as 100.96 — a clean 3:2 metrical-level
error. The question this spike asked was whether a neural tempo estimator would fix
that class of error outright, making `metrical-level-inference.ts` unnecessary.

The answer is that **it would fix this file, it is affordable, and we are not
shipping it** — because essentia.js is AGPL-3.0 and this is heading for a closed
B2B SaaS. Everything below is browser-verified against the real bass stem, and is
recorded so nobody re-treads it.

---

## The acid test: it does get the real file right

The stem is the one `real-detections.fixture.ts` was captured from — Ab minor,
153 BPM, 4:22, monophonic bass.

`RhythmExtractor2013` on the full file: **151.63 BPM**, confidence 1.12, 660 beats.

Windowed, to check it is not an average over a drift:

| window | estimate |
|---|---|
| 0–15 s | 153.01 |
| 0–30 s | 152.34 |
| 60–75 s | 152.05 |
| 120–150 s | 151.73 |
| full file | 151.63 |

Against the same file, ours:

| estimator | BPM | ratio to 153 |
|---|---|---|
| **truth** | 153 | 1.000 |
| `RhythmExtractor2013` | 151.63 | 0.991 |
| **our `trackBeats`** | **100.96** | **0.660** |
| `PercivalBpmEstimator` | 76.00 | 0.497 |

`PercivalBpmEstimator` is a clean halving and is not the answer. `RhythmExtractor2013`
is the one that works, and it is the one that is AGPL.

## The honest limit: it is not immune to the same error

On `run` — the synthetic material that is an unaccented stream of identical
sixteenths — `RhythmExtractor2013` makes **the same 3:2 error we do**: 140 true,
**93.45** estimated, ratio 0.668.

That is the whole finding about generality. It gets the real file right because a
tresillo accent pattern exists there to be read; it gets `run` wrong because nothing
in `run` says where the beat is. A tempo estimator cannot recover a metrical level
the material never states, and buying one would have bought **generality on accented
material**, not immunity.

## The neural path is dead, and not for the reason expected

The plan was `TempoCNN` (deeptemp), not the DSP estimator. It does not exist in the
shipped package.

- essentia.js 0.1.3's WASM **does not compile in `TensorflowInputTempoCNN`** —
  verified by enumerating the algorithms present in the browser, not inferred from
  docs.
- `essentia.js-model.js:278` calls that algorithm, so **`TensorflowTempoCNN` is dead
  code in the shipped release**. It cannot run at all.

The *weights* were never the blocker, which is the part worth remembering:
`deeptemp-k4-3-tfjs.zip` is **101 kB**, TF.js-ready, and outputs a **256-bin softmax
over 30–286 BPM** — exactly the tempo prior we wanted, and a far better one than the
log-normal prior in `estimateTempo`.

What is missing is only the **40-band mel front-end**. Rebuilding it by hand from the
primitives that *are* present is possible but is a project, and the failure mode is
the bad one: a silent mismatch in the mel filterbank degrades the model's output
rather than erroring, so it would look like a working estimator giving mediocre
answers.

## A neural model is obtainable if it is ever wanted

`github.com/mosynthkey/beat_this_cpp` commits `onnx/beat_this.onnx` — Beat This!
(ISMIR 2024), **MIT licensed**, ~97 MB FP32. Input spec: **128-band mel at 22050 Hz**,
which is already our `DETECTION_SAMPLE_RATE`, so the front-end is one we can build
against a written spec rather than reverse-engineer. No Python required to obtain it.

It was not pursued because **97 MB to solve what 0.57 MB solved** is the wrong trade
for one metrical-level error, and because of the `run` result above — the model class
is not immune either.

## Cost, had we shipped essentia.js anyway

| measure | value |
|---|---|
| raw | 2.15 MB |
| gzip | **0.57 MB** |
| brotli | 0.42 MB |
| glue init | 15 ms |
| WASM instantiation | 20 ms |
| added to `main` bundle | **zero** (lazy, worker-side) |

Smaller over the wire than the TF.js worker chunk we already ship. **Bundle size was
never the reason to decline.**

## A trap worth recording even though we are not shipping it

`RhythmExtractor2013` **takes no sample-rate argument and assumes 44.1 kHz.**

Fed our own `decodeToMono(bytes, 22050)` output it returns **76.08** on the real
file — exactly half, deterministically, with full confidence. It is not a warning, a
throw, or a degraded estimate; it is a confident wrong answer that looks exactly like
a genuine metrical-level halving.

Anyone evaluating an essentia-family algorithm against our decode path must resample
to 44.1 kHz first. Half of the "neural estimators also halve" folklore is probably
this.

## Why we declined

**AGPL-3.0.** essentia.js is AGPL-3.0 (the `node_modules/essentia.js` entry the spike
added to `package-lock.json` declares it), and the product this feeds is a closed
B2B SaaS. Network-use copyleft over a bundle we serve to browsers is not a licence
question we want to be answering.

The secondary reason, which would not have been sufficient alone: the hand-rolled
`metrical-level-inference.ts` **already gets the problem file right**, at 0.57 MB
less. A neural estimator would have bought generality rather than a fix.

## What this leaves

`metrical-level-inference.ts` stands, with the caveats already in its own docblock —
it proposes rather than applies, and it needs `MIN_INFERENCE_ONSETS` = 250 onsets
before it will say anything.

The one thing the spike made possible and that survives it is
`tempo-accuracy.spec.ts`: `trackBeats` had never been measured against material whose
tempo is known. It is now, in the default suite, with no browser beyond karma and no
model. See that file for what it found.

## Caveats

One real file, one instrument, one player, one arrangement. The windowed agreement
above says the 151.63 is not an artefact of averaging over a tempo drift; it does not
say the algorithm generalises to material we have not tried. The `run` result says it
does not generalise to material with no accent pattern.
