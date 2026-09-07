# Stem Separation Feasibility

**Date:** 2026-09-07
**Status:** Measured. Technically viable; **blocked on a licensing answer from Deezer.**
**Context:** the product is intended to be a paid service, which makes licensing a gate rather than a footnote.

Today the app requires an already-isolated stem. Separation would unlock full-mix input — "drop any song" instead of "drop a stem you already have". This records whether that is possible, legal, and worth it.

---

## 1. Licensing — the gate, and it eliminates most candidates

| Candidate | Code | Weights | Trained on | Paid-product verdict |
|---|---|---|---|---|
| **Demucs** (all checkpoints) | MIT | **not MIT** | MusDB + 800 songs | **BLOCKED** |
| **Open-Unmix `umxl`** (default) | MIT | **CC BY-NC-SA 4.0** | private stems | **BLOCKED** |
| Open-Unmix `umx` / `umxhq` | MIT | MIT on Zenodo | MUSDB18 / -HQ | **UNCERTAIN** |
| MDX-Net (KUIELab) | MIT | unstated | MUSDB18-HQ | Unresolved |
| UVR-distributed MDX-Net / MDX23C | MIT | unstated | undocumented, largely scraped | Unknowable |
| **Spleeter** | MIT | **MIT (JOSS paper)** | Deezer internal catalogue | **Only affirmative grant** |

### What is verifiable versus commonly assumed

**Demucs is a stated no, not a grey area.** Alexandre Défossez, `facebookresearch/demucs` issue #327 (2022-05-23):

> The model weights are not covered by the MIT license, and are provided only for scientific purposes.

Still open, never retracted. Both READMEs say only "Demucs is released under the MIT license" and are silent on weights — the widespread "Demucs is MIT" belief comes from reading the README and stopping. Contributor CarlGao4 gives the reason: MusDB training data restricts the resulting model to research.

**Open-Unmix is sharper than expected.** `umxl` — the *default* — is explicitly CC BY-NC-SA 4.0 in its README. For `umx`/`umxhq` the authors did grant MIT on Zenodo (3370486 / 3370489), but those weights come from MUSDB18/-HQ, whose Zenodo licence field reads *"Other (Non-Commercial)"* — "provided for educational purposes only… should not be used for any commercial purpose without the express permission of the copyright holders" — and whose constituent tracks include MedleyDB (CC BY-NC-SA 4.0) and The Easton Ellises (CC BY-NC-SA 3.0). The authors granted rights over a corpus they do not own. Whether model weights are a derivative work of training data is unsettled law. The upstream is BY-NC-**SA**: if it reaches through at all, ShareAlike comes with it.

**Spleeter is clean on the training-data axis, with one unresolved wrinkle.** The JOSS paper (peer-reviewed, Deezer-authored, in-repo as `paper.md`) states at line 85 that "source code and pre-trained models… [are] distributed under a MIT license"; line 52 that "the models were trained on Deezer's internal datasets"; line 62 that "it was not trained, validated or optimized in any way with musdb18 data." Checkpoints ship as release assets on the MIT repo.

**But the current README narrowed to "The code of Spleeter is MIT-licensed"**, dropping "and pre-trained models". Two open issues ask Deezer to confirm — **#898** (2024) and **#957** (2026, from a commercial developer asking the identical ONNX-redistribution question). **Deezer has answered neither.**

### Consequences

- **The cheapest, highest-value next action in this entire investigation is getting Deezer to confirm the weights licence in writing.** It costs nothing and decides everything. Do not build on the JOSS sentence alone.
- Do not ship Demucs, Open-Unmix or UVR weights in a paid product.
- **Slakh2100** (CC BY 4.0, 145 h of synthesised multitrack with bass stems) appears to be the only sizeable separation corpus permitting commercial use outright — the route to weights we would own.

---

## 2. Browser viability — it runs, and the expected backend ordering is inverted

Measured with an ONNX graph architecturally identical to one Spleeter U-Net (9,825,252 params/stem, matching exactly) with random weights — inference cost depends on graph shape, not values, so this measures the real thing without redistributing anyone's checkpoint. Chrome 148, `onnxruntime-web@1.29.0`, COOP/COEP on, 11.89 s chunks.

| Model | Backend | Threads | ms/chunk | ×realtime | 4-min track | Download |
|---|---|---|---|---|---|---|
| bass-only (1 U-Net) | **wasm** | 8 | 105 | 113× | **2.1 s** | 39.3 MB |
| bass-only | webgl | — | 132 | 90× | 2.7 s | |
| **4-stem (as Spleeter ships)** | **wasm** | 8 | 461 | 26× | **9.3 s** | 157.2 MB |
| 4-stem | wasm | 1 | 1941 | 6× | 39.2 s | |
| 4-stem | webgl | — | 655 | 18× | 13.2 s | |
| any | webgpu | — | **no adapter** | — | — | |

- **WASM is the fastest backend measured.** WebGPU was unavailable in this Chrome (`requestAdapter()` null for every preference, including `forceFallbackAdapter`) so it could not be tested — and it turns out not to matter. WebGL, expected to be a non-starter, works fine.
- **The design doc's claim that "Demucs is the only model too heavy for the browser" is unsupported for this model class.** A Spleeter-class separator runs 6–113× realtime on CPU alone. The claim was never measured.
- **TF.js 3.21 coexistence is a non-issue.** Measured with an ORT session running while the Basic Pitch TF.js WebGL backend was live: TF.js inference stayed 15–49 ms, backend never lost. On the WASM EP there is no shared GPU state at all.
- **"We only need bass" does not work for Spleeter.** Its inference mask is normalised across all four instruments (`spleeter/model/__init__.py:432`), so reproducing its bass output requires all four U-Nets. The 5-stem model couples them explicitly via `softmax_unet`. The honest number is the 4-stem row: **9.3 s and a 157 MB one-time cached download.** Open-Unmix genuinely is per-target — but it is the blocked one.

---

## 3. Does the separated bass transcribe? — the decisive question

No legally usable pretrained separator exists to test with, so this measures the **ceiling of the masking model class** instead, which is stronger evidence than any single checkpoint. A masking separator predicts a magnitude mask, multiplies the mixture magnitude and inverts with the mixture's phase; the best mask any of them could predict is the ideal ratio mask from the true sources. That mask was then degraded with a TF-correlated random field, bisected to published musdb18 bass SI-SDR.

Material: 15 Karplus-Strong bass lines from the repo's own `MATERIAL` (170 notes, 95.9 s), mixed at −3 dB against a synthesised chord bed and a noise-based kit. Nothing copyrighted. Full real pipeline, ±50 ms, exact pitch.

| Condition | SI-SDR | Est. | Matched | Precision | Recall | F1 | ΔF1 |
|---|---|---|---|---|---|---|---|
| **clean bass stem** (today) | ∞ | 197 | 117 | 59.4 | 68.8 | **63.8** | — |
| **full mix, no separation** | −3.7 dB | 832 | 113 | 13.6 | 66.5 | **22.6** | −41.2 |
| oracle IRM (class ceiling) | 9.3 dB | 222 | 120 | 54.1 | 70.6 | 61.2 | −2.5 |
| separated, Demucs-class | 8.3 dB | 323 | 125 | 38.7 | 73.5 | 50.7 | −13.1 |
| **separated, Spleeter-class** | 5.4 dB | 389 | 127 | 32.6 | **74.7** | **45.4** | **−18.3** |

*Harness validated:* the `clean` row measured P 59.4 / R 68.8 / F1 63.8 against the repo's published baseline of 61.2 / 70.3 / 65.5 — within 1.7 pp, so the deltas are trustworthy.

**Three findings, the second being the one that matters:**

1. There is a large drop — 18.3 pp at Spleeter's actual bass quality.
2. **It is entirely a precision failure. Recall goes *up*, 68.8 → 74.7 %.** Separation loses no notes; it adds spurious ones (197 → 389 detections). That is the *good* failure mode, and specifically the one this product is already built to absorb — confidence floor, harmonic suppression, and a review UI whose thesis is that the user corrects what survives. Missing notes would have been fatal. Extra notes are triage, with 5.9 pp of recall headroom to trade back for precision.
3. **Not separating is catastrophic** (F1 22.6, precision 13.6 %). Separation converts *unusable* into *usable but noisy*.

The ceiling costs only 2.5 pp, so mixture-phase masking is not the problem — mask *error* is. Better separation would translate almost linearly into better transcription.

---

## 4. The server alternative, priced

CPU-seconds derived from the single-thread WASM measurement, which is conservative — native CPU is typically faster than WASM SIMD.

| Path | Per 4-min track | Per 1000 tracks |
|---|---|---|
| Self-host Spleeter 4-stem, AWS `c7i.2xlarge` | $0.00049 | $0.49 |
| Same on Graviton / Hetzner | $0.00040 / $0.00013 | $0.40 / $0.13 |
| Licensed API (Music.AI, LALAL.ai, ~$0.05/audio-min) | $0.20 | $200 |

Self-hosted compute is effectively free; this is a CPU workload and needs no GPU.

**The cost of the server path is posture, not compute.** It breaks "nothing leaves your machine", and it moves the product from *a tool that processes the user's local file* to *a service that receives and processes copyrighted recordings on your infrastructure*. For a paid product that is a materially different copyright exposure than the compute bill, and it is the real argument against the server path.

---

## Recommendation

Worth doing, gated on one email.

1. **Get Deezer to confirm in writing that the pretrained weights are MIT.** Two people have asked and been ignored; a commercial enquiry through a business channel may fare better. Costs nothing, decides everything.
2. **Do not ship Demucs, Open-Unmix or UVR weights in a paid product.**
3. **If the licence clears, build browser-side on `onnxruntime-web` with the WASM execution provider** — not WebGPU, not WebGL. 9.3 s per four-minute track, 157 MB cached once, no GPU, no TF.js conflict, and the local-only property survives.
4. **Budget real work for post-separation false-positive suppression, and measure it first.** That is where the 18.3 pp lives, and recall has headroom. Raising the confidence floor on separated input is the obvious first lever and is already wired into the review UI; `separation-spike.spec.ts` is the harness for testing it.
5. **If Deezer stays silent:** either pass a licensed API through at $0.20/track — viable at paid pricing, but surrenders local-only processing — or train on Slakh2100 (CC BY 4.0). Do not ship the murky option.

## Caveats

Synthetic mixes only — Karplus-Strong bass against a synthesised bed, not real multitrack. The degradation model targets published musdb18 SI-SDR figures but is a model, not a measured separator, because no legally usable checkpoint was available to run. The moment one is, re-run `separation-spike.spec.ts` against its real output and replace these rows.
