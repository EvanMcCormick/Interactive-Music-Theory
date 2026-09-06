# Harmonic Suppression Accuracy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the discriminator harmonic suppression rests on, chosen against measurements across varied material instead of fitted to one fixture.

**Architecture:** A capture step synthesises audio, runs the real detector and freezes its output; a fast harness runs the suppressor over those frozen fixtures and reports precision, recall and F1 with no browser and no model. Every change to the algorithm is judged against that number.

**Tech Stack:** No new dependencies. Karplus-Strong synthesis in TypeScript, `mir_eval`-style note matching, Jasmine/Karma.

**Prior art:** M1–M3 are merged. The suppressor is `client/src/app/services/transcription-harmonics.ts`; its history is in `docs/plans/2026-09-05-transcription-m2-detection.md`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\harmonic-accuracy`, branch `feature/harmonic-accuracy`. Paths below are relative to `client/`.

Baseline: **548 tests, 0 failures.**

A spike has already built and run the measurement. Its files are untracked under `client/src/app/services/harmonic-spike/` — `karplus-strong.ts`, `material.ts`, `note-matching.ts`, `detections.fixture.ts`, and three specs. **Read them before Task 1.** This plan promotes that work and acts on what it found.

### What the spike measured

Current defaults, ten fixtures, 122 ground-truth notes, 46 s of material:

| | precision | recall | F1 |
|---|---|---|---|
| raw detector | 42.5 | 67.2 | 52.1 |
| after suppression | 55.6 | 57.4 | 56.5 |

Suppression removes 67 detections: **55 artefacts and 12 real notes.** F1 improves on seven fixtures, is flat on one, and gets materially worse on two — worst is `slap`, 58.3 → 26.7.

### The four findings this plan acts on

**1. `partialDurationRatio` has no discriminating power.** Over the 62 pairs the duration clause arbitrates, its best achievable cut is **7.83** — above every value in the data, meaning "suppress everything". At the shipped 0.9 it removes 33 of 50 artefacts and destroys **10 of 12** real notes. All twelve destroyed notes fired on this clause.

**2. Amplitude ratio Pareto-dominates it.** At a cut of 0.761: **38 of 50** artefacts removed, **1 of 12** real notes lost. Better on both axes, so the choice does not depend on weighting.

**3. The physical justification in the docblock is real but is not the mechanism.** Measured, partials 1→8 of an E1 decay at −20.0 to −20.7 dB/s — a spread of 0.7 dB/s. Partials are reported as *shorter* notes not because they damp faster but because they **start 8–35 dB lower** and so cross the detector's threshold sooner. That is why a duration rule fails and an amplitude rule works: amplitude is what actually differs.

**4. Two tests pin the wrong thing.** `keeps an octave leap over a note that is still ringing` and `keeps a slapped pop two octaves over the thumbed note under it` both construct the upper note as long as the root (ratios 1.0 and 1.11). Real detector output for those same figures gives **0.40–0.74** and **0.26**. They pass, and they protect nothing.

### Two caveats the spike was explicit about

- **Every note in the material is plucked at identical strength.** That makes amplitude ratio's job easier than real music would — a quiet real note over a loud ringing root is exactly the case this material cannot contain. Task 2 fixes this before Task 3 chooses a number.
- **This is synthesis, not recordings** — no inharmonicity, body resonance, pickup response or room. The fixture format must not care how the audio was made, so a real stem can be added later.

### Scope decisions

1. **Do not prune `HARMONIC_SEMITONES` on the spike's interval data.** It shows +19 net harmful and +24 pure harm — but that was measured *under a broken discriminator*, and 9 of the 12 destroyed notes died on the duration clause, not on their interval. Fix the discriminator first, then re-measure intervals. Pruning on data gathered under a defect is how you bake the defect in.
2. **The capture spec stays out of the default suite.** It disconnects karma at its 30 s `browserNoActivityTimeout`. It is run deliberately, by name, when fixtures need re-freezing.
3. **The 50 ms onset window stays**, though it is tight for this register — Basic Pitch's onset error on a 41 Hz note runs to five of its own 11.6 ms frames. The spike confirmed the *relative* verdict on suppression is stable across 50/75/100/150 ms, so the choice does not affect any conclusion. Report a second window alongside so the tightness is visible.

---

## Task 1: Promote the harness

**Files:**
- Create: `src/app/services/harmonic-eval/karplus-strong.ts` + spec
- Create: `src/app/services/harmonic-eval/material.ts`
- Create: `src/app/services/harmonic-eval/note-matching.ts` + spec
- Create: `src/app/services/harmonic-eval/detections.fixture.ts`
- Create: `src/app/services/harmonic-eval/harmonic-accuracy.spec.ts`
- Create: `src/app/services/harmonic-eval/harmonic-capture.spec.ts`

Move the spike's files in, with production docblocks. Two things to get right:

**Synthesis must stay honest.** Excite with the **triangular initial displacement** a finger makes, not a white-noise burst. The spike measured canonical noise-burst Karplus-Strong and found the fundamental was the strongest mode in **0 of 10** pitches — an "E1" came back with its 6th partial four times louder than its fundamental, because a short burst seeds every mode with an independent random amplitude. That would have contaminated every number: a detector reporting a partial instead of the note looks exactly like a suppressor eating a note. With a triangular pluck the fundamental is strongest in 10/10, tuning is exact (41.20 Hz measured against 41.20 nominal, 0.0 cents), and the 1/k² roll-off falls out of the triangle's Fourier series rather than being typed in. Per-partial decay still comes only from the loop filter.

Keep the spec that asserts this — modal profile, tuning in cents, monotonic envelope. It is what caught the trap.

**Detector losses must stay separate from suppression losses.** 40 of 122 notes were never detected at all, concentrated in `run` (29 % recall) and `octaves` (44 %). Those are detector limits. Report them as their own column so they can never be confused with notes suppression destroyed.

`harmonic-accuracy.spec.ts` must run in the default suite: no browser beyond karma, no model, deterministic. Assert current measured numbers as a **regression floor** — not aspirational targets — so a later change that silently degrades accuracy fails.

Commit: `test: Add the harmonic suppression accuracy harness`

---

## Task 2: Vary dynamics, and close the spike's main caveat

**Files:** `material.ts`, `detections.fixture.ts`, `harmonic-accuracy.spec.ts`

Every note in the spike's material is plucked at identical strength. Amplitude ratio is about to become the discriminator, so measuring it on material with no dynamic range would be exactly the mistake this whole exercise exists to avoid — fitting a parameter to a fixture that cannot contradict it.

Add material that can:

- **a quiet note over a loud ringing root** — the case that would make amplitude ratio fail, and which nothing currently contains
- a loud note over a quiet root
- a crescendo line and a decrescendo line
- ghost/dead notes at very low velocity next to full-strength notes
- an accented figure — strong downbeats, weak offbeats

Karplus-Strong takes velocity naturally as the amplitude of the initial displacement; scale it, do not post-multiply the output, so the interaction with the loop filter stays physical.

Re-run the capture, re-freeze, and **re-measure the current algorithm on the expanded set.** Report the table before and after expansion. If the current numbers get worse on the new material, that is the finding — say so plainly rather than smoothing it.

Commit: `test: Vary dynamics across the accuracy fixtures`

---

## Task 3: Replace the discriminator

**Files:** `transcription-harmonics.ts` + spec, `harmonic-accuracy.spec.ts`

Swap the partial branch's duration clause for an amplitude clause. **Choose the cut from Task 2's data, not from the spike's 0.761** — that number came from material without dynamics.

Report the trade-off curve you chose from: for a range of cuts, artefacts removed against real notes destroyed. Pick a point and justify it. Losing real notes is worse than keeping artefacts — an artefact is visible as a ghost and ignorable; a destroyed note has no path back — so weight accordingly and say what weighting you used.

Correct the docblock. It currently justifies the rule with "a partial decays faster than its fundamental, so it sounds for less of it". Measured, that is 0.7 dB/s of difference and not what separates them.

> **Correction, written while executing this task.** The replacement justification this section proposed — that partials "start 8–35 dB below their fundamental, which is what an amplitude ratio measures directly" — is also wrong, and Task 2 is what measured it. `DetectedNote.confidence` is the detector's **mean frame activation** over a note's span, floored by the model's own 0.3 frame threshold. It is not amplitude: r = 0.182 against velocity over 49 notes spanning 17.7 dB, and the softest notes average 0.954 of the loudest against a physical ratio near 0.3. On `accents`, offbeat octaves plucked at a third of the downbeats' strength come back *higher*. So the rule that shipped is **not** an amplitude rule; its separating power comes from the model being less certain about a partial than about the note that produced it — a claim about the detector, argued from the measurement, and named accordingly (`partialConfidenceRatio`). This also explains why the best cut did not move when dynamics were added: it was never tracking dynamics.

Keep `partialDurationRatio` only if it earns its place *alongside* the new clause on the data. If it does not, remove it rather than leaving a parameter that does nothing.

**Re-measure and report the full table.** The gate is: precision up, and real notes destroyed strictly down from 22 (12 over the ten pre-dynamics materials).

**Outcome.** `partialConfidenceRatio: 0.65`, chosen from the 120-pair curve weighting one destroyed real note as five kept artefacts. Over the sixteen fixtures: precision 56.5 → 61.2, recall 59.9 → 70.3, F1 58.1 → 65.5, real notes destroyed 22 → 3. `partialDurationRatio` removed: at the chosen cut a second length clause adds at most one artefact in ninety-two before it starts costing real notes. Five per-fixture rows where suppression was worse than the raw detector closed (`fifths`, `leaps`, `slap`, `quietOverLoud`, `loudOverQuiet`); `ghosts` did not. Twelve tests built on the M2 spike fixture now fail and are left failing — that fixture's audio gives partial `h` a decay rate `h` times the fundamental's, so it encodes the discredited premise; Task 5 rebuilds it.

Commit: `fix: Discriminate partials by amplitude, not duration`

---

## Task 4: Re-measure the intervals, prune what is still harmful

**Files:** `transcription-harmonics.ts` + spec, `harmonic-accuracy.spec.ts`

Now that the discriminator works, re-measure per interval — artefacts removed and real notes destroyed for each of `[0, 12, 19, 24, 28, 31]`.

Under the old discriminator: +12 was the workhorse (35 artefacts, 2 real), +19 net harmful (4 vs 5), +24 pure harm (0 artefacts, 4 real notes), +28 and +31 never fired at all. Expect that picture to change, because 9 of the 12 destroyed notes died on the duration clause rather than on their interval.

Remove any interval that still removes nothing and costs real notes. Be careful about the difference between *evidence against* and *absence of evidence*: +28 and +31 never firing on synthetic material is weak grounds for removal, whereas +24 firing four times and being wrong every time is real evidence. Say which category each falls into.

**Outcome. Nothing was pruned, and the reason is the whole point of the sequencing.** Re-measured over the sixteen fixtures under `partialConfidenceRatio`:

| interval | artefacts removed | duplicates of a kept note | real notes destroyed | pairs it was ever offered | F1 cost of dropping it |
|---|---|---|---|---|---|
| +0  | 16 | 12 | 1 | 154 | −3.9 |
| +12 | 58 | 0  | 2 | 119 | −7.2 |
| +19 | 9  | 0  | 0 | 25  | −1.3 |
| +24 | 3  | 0  | 0 | 14  | −0.3 |
| +28 | 0  | 0  | 0 | **0** | 0.0 |
| +31 | 0  | 0  | 0 | **0** | 0.0 |

+24 reversed outright — 0-for-4 under the duration clause, 3-for-0 under this one — and +19 went from net harmful to 9-for-0. Both were *evidence against* that turned out to be evidence about the clause. +28 and +31 are *absence of evidence*: across all 310 detections there is no overlapping pair at either interval, so the clause has never once been offered the choice, because a triangular pluck's 1/k² roll-off puts the 5th and 6th modes 28–34 dB down where the model does not report them at all. They stay, flagged unmeasured, with an assertion that fails the day a capture produces such a pair.

Commit: `fix: Keep only the partial intervals the data supports`

---

## Task 5: Fix the tests that protect nothing

**Files:** `transcription-harmonics.spec.ts`

`keeps an octave leap over a note that is still ringing` and `keeps a slapped pop two octaves over the thumbed note under it` construct the upper note as long as the root — ratios 1.0 and 1.11 — while real detector output for those same figures gives 0.40–0.74 and 0.26. They assert a situation the detector does not produce.

Rebuild both from **real captured detector output** rather than hand-built numbers. The fixtures exist now; use them. Then verify by mutation that each fails when its protection is removed.

Audit the rest of the file the same way: any test whose fixture asserts values the detector never emits is decoration. Report which ones you found.

**Outcome.** The M2 fixture is gone in both the forms it existed in. The thirty-four `SPIKE_OUTPUT` rows were pasted into three specs; the `pluck()` additive synthesis that produced them had two further copies, in `basic-pitch-detector.spec.ts` and `worker-detector.spec.ts`, where they were still generating audio for real inference. All five now read one place: `harmonic-eval/detections.fixture.ts` for frozen detections, `harmonic-eval/material.ts`'s Karplus-Strong string for audio. `detection(material, pitch, onsetSec)` picks a captured note out by identity, so a re-capture that moves one fails loudly rather than re-pointing a test at a different note.

Twelve red specs: eleven rebuilt against captured pairs and re-pinned, one turned into a statement of a limitation. `suppresses a partial that is louder than its own fundamental` is now `cannot suppress a partial the detector is as sure of as the note under it`, on `repeats` A1 0.3695 with an A2 artefact at 0.4102 — a ratio of 1.110, which no setting of `partialConfidenceRatio` below 1 can reach without deleting every real octave in the set. `suppressed.length > notes.length` is gone: the discard is now ten of twenty-eight rather than twenty-six of thirty-four, because the duration rule's discard was largely music. The claim kept is the partition — nothing removed disappears silently.

Four passing-but-vacuous specs were rebuilt, and the audit found four more that were not on the list: `keeps a root and the fifth above it` (no captured +7 pair would be suppressed even if +7 were added — the detector is 1.11–2.13 times as sure of the fifth as of the root, so the mistake it claimed to guard against would be invisible; replaced by a played twelfth at +19 and by a whole tone that only the interval list keeps), and three whose emptiness made them vacuous under a `no-report` mutation (`reports them in onset order`, `appends rather than replacing`, `loses nothing at a floor low enough that no ghost collides`, each now naming its count as well as its property).

Every rebuilt spec was verified by mutation: 22 mutations of `transcription-harmonics.ts`, each killing at least the specs whose protection it removes. Two findings came out of that. The sort's third key, onset, is unreachable — no captured pair ties on both pitch and confidence, and two that did could not suppress each other anyway — so it is documented as belt-and-braces rather than tested. And the detector integration line (E1 A1 D2 G2) contains no two notes a partial's interval apart, so suppression cannot destroy one of them however wrong it is; that spec is bracketed by `explains-always` and `explains-never` instead, and says so.

Suite: **573 passing, 0 failing.** Accuracy unchanged by the rebuild: 61.2 / 70.3 / 65.5, three real notes destroyed.

Commit: `test: Rebuild the suppression fixtures from real detector output`

---

## Done when

- Full suite green, `tsc -p tsconfig.spec.json --noEmit` clean.
- `harmonic-accuracy.spec.ts` runs in the default suite and asserts a regression floor.
- Real notes destroyed is strictly below 12, and precision is above 55.6.
- Every parameter in `HarmonicOptions` is justified by a measurement, or gone.
- No test in `transcription-harmonics.spec.ts` asserts detector behaviour the detector does not exhibit.

## Deliberately not in scope

- **Real recordings.** Everything here is synthetic — no inharmonicity, body resonance, pickup response or room. The fixture format is deliberately agnostic about how audio was made, so a real stem drops in later. This is the single biggest remaining threat to the numbers.
- **Frame-level evidence.** The suppressor sees note events; the detector's posteriorgram carries amplitude envelopes and onset sharpness that would separate a struck octave from a ringing partial far better than any note-level rule. That is the real ceiling, and it touches the detector, the worker boundary and the model.
- **Making suppression correctable** — moving it into the live re-derive path and letting a ghost be restored by hand. Still the right follow-up, and independent of accuracy.
- **Detector recall.** 40 of 122 notes were never found; `run` sits at 29 %. Nothing here can fix that.
