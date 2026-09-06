# Suppression on Real Material Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop harmonic suppression leaving doubled octaves on real recordings, and get real material into the accuracy harness so the next calibration cannot be fooled the way the last one was.

**Architecture:** A source declaration — "this stem is monophonic" — that suppresses same-attack harmonic pairs without consulting a discriminator that provably cannot separate them. Plus the first real-audio fixture, frozen as detector output rather than audio.

**Tech Stack:** No new dependencies.

**Prior art:** The accuracy work is `docs/plans/2026-09-06-harmonic-accuracy.md`; the suppressor is `client/src/app/services/transcription-harmonics.ts`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\real-material`, branch `feature/real-material-suppression`. Paths below are relative to `client/`.

Baseline: **791 tests, 0 failures.** A measurement spike has already built the fixture and the harness; its files are **untracked** in this worktree. Read them before Task 1.

### What the spike measured

On a real bass stem — 1224 raw detections, 986 kept:

- **66.4 %** of kept notes monophonic on a **monophonic source**
- **86 same-attack pairs** (≤ 30 ms), **67 of them at a partial interval** the rule already knows
- **All 67 survive on the confidence clause and nothing else.** Not the onset guard, not the overlap window, not a missing interval. One defect, one cause.

### The finding that matters most

| population (same-attack, harmonic interval) | n | min | median | max |
|---|---|---|---|---|
| synthetic **artefacts** | 59 | 0.33 | 0.49 | **0.94** |
| synthetic **real notes** | 6 | **0.96** | 2.46 | 2.55 |
| **real stem, partials** | 218 | 0.37 | 0.60 | **1.41** |

On synthesis the populations do not touch — a 0.02-wide gap, so any cut inside it is perfect, and 0.65 sits there. Real material fills the gap: 15 % of real partials sit above the first quartile of the synthetic real-note population.

**`partialConfidenceRatio` was never miscalibrated. The fixture was too easy, and it hid that the discriminator has no separating power on real audio.** No value of it fixes this, because on real material there is nothing on the other side of any cut.

### Two hypotheses this killed — do not retry them

**Register-aware ratio: refuted.** The model *is* less sure in the low register — mean confidence 0.403 at MIDI 27 rising to 0.613 at 39 — but that does not reach the *ratio*, because the partial's confidence falls with its root's. Deconfounded to `+12` same-attack pairs only (n = 160): slope **+0.0017 per semitone, r = +0.037**. Flat, and pointing the wrong way. The r = −0.221 over all 402 offered pairs is a confound: low roots are over-represented among staggered pairs and among +19/+24. The one bad cell is MIDI 27 at median ratio 1.025, with **n = 3**.

**Interval tolerance for inharmonicity: refuted.** Exactly **1** of 253 raw same-attack pairs sits ±1 from a partial interval, and it does not survive suppression. Bass inharmonicity at partials 2–4 is far under the 50 cents needed to move a bin, and Basic Pitch quantises to integer semitones anyway. Measured, ±1 tolerance changes the synthetic numbers not at all and removes five notes from the real stem — while claiming a real minor ninth over a held root is a partial.

### The fix, measured

| candidate | real: kept / same-attack pairs / at known interval / mono % | synthetic P / R / F1 / destroyed |
|---|---|---|
| current (0.65) | 986 / 86 / 67 / 66.4 | 61.2 / 70.3 / 65.5 / 3 |
| flat ratio 1.20 | 885 / 10 / 2 / 83.4 | 58.2 / 58.8 / 58.5 / **24** |
| register ramp | 899 / 21 / 11 / 81.1 | 59.3 / 61.5 / 60.4 / **19** |
| interval tolerance ±1 | 981 / 84 / 65 / 67.2 | 61.2 / 70.3 / 65.5 / 3 |
| **monophony prior, 30 ms** | **921 / 15 / 0 / 76.9** | blanket: 61.4 / 68.1 / 64.6 / 7 |
| **…gated to monophonic sources** | same | **61.5 / 70.3 / 65.6 / 3** |

Gated, it takes the known-interval doubled pairs to **zero**, gains a precision point on synthesis, and destroys the same three notes as before — none extra.

**The 30 ms window is not arbitrary.** The detector places onsets on its 11.6 ms frame grid, and the survivors' lags are exactly 0, ±11.6 and ±23.2 ms. One frame (20 ms) leaves 16 pairs; two frames clears them.

### Scope decisions

1. **This is a source declaration, not a better heuristic.** On a monophonic source a same-attack harmonic pair *is* a partial, by construction. The honest framing is that we stop asking a question the data cannot answer — not that we found a smarter threshold.
2. **It must be gated, and the gate is weakly measured.** Only 2 of the 16 synthetic fixtures are monophonic, so "costs nothing on synthesis" rests on two materials. Say so where the number is quoted; do not present it as strongly established.
3. **Zero same-attack pairs is the target; 100 % monophony is not.** After the prior, 147 overlapping pairs remain and **132 are staggered** (> 30 ms, median lag 139 ms) — ring-over, which a monophonic source legitimately produces in a note-event stream.
4. **No audio is committed.** The fixture is frozen detector output, as `detections.fixture.ts` already is. `.gitignore` must keep the staging directory out.

---

## Task 1: Promote the real-material fixture and harness

**Files:** `services/harmonic-eval/real-detections.fixture.ts`, `real-material-accuracy.spec.ts`, `real-capture.spec.ts`, `angular.json`, `.gitignore`

The spike's untracked files. Promote them with production docblocks. This is the durable artefact — three milestones have called real material "the biggest threat to the numbers", and this is the first of it.

Keep:
- The **capture spec excluded** from the default suite, reachable by its own configuration, mirroring `capture` and `longform`.
- `.gitignore` covering the audio staging directory, so the user's file can never be committed.
- The **independent reimplementation of `suppressHarmonics`** the spike used, asserted note-for-note identical over all 1224 real detections — the same device that keeps `removal-attribution.ts` honest.
- Assertions on the headline counts as a **regression floor**, not a target.

The spike's counts differ slightly from the browser run quoted earlier (86 same-attack pairs against 89, 66.4 % against 66.2 %) because they are computed from the frozen fixture rather than a live session. Use the fixture's numbers throughout and say why they differ.

Commit: `test: Add the first real-material accuracy fixture`

---

## Task 2: The monophony prior

**Files:** `services/transcription-harmonics.ts` + spec, `models/transcription.model.ts`, `services/transcription.service.ts` + spec

A `monophonic` declaration on the session, and in `suppressHarmonics` a rule that, when set, suppresses a same-attack (≤ 30 ms) pair at a known partial interval **without consulting `partialConfidenceRatio`**.

Interaction to get right: a note kept by an explicit user override must still win. The override is the listener's decision and outranks every rule, including this one — that is the contract `NoteDecisions` established.

Where the default comes from is a real decision. The product is bass-first and bass is overwhelmingly monophonic, so defaulting on fixes the common case; but guitar is frequently chordal and a wrong default there deletes real notes. Consider deriving it from the chosen tuning family rather than a flat constant, and say what you chose and why.

Tests: the prior removes a same-attack octave the ratio would keep; it leaves a *staggered* octave alone; an explicit keep override survives it; off, behaviour is byte-identical to today. The accuracy harness must show the gated numbers above.

Commit: `feat: Treat a same-attack octave on a monophonic source as a partial`

---

## Task 3: The control, and verification on the real file

**Files:** `components/transcription/components/transcription-review/` + spec

A labelled checkbox — this stem is monophonic — with a hint saying what it does and that it is right for most bass stems and wrong for chordal playing. Panel conventions: real `<label for>`, `aria-describedby`, refusal beside the control, mirror-field pattern.

**Verify on the real file:** `C:\Users\EvanMccormick\OneDrive - F1Fan\Desktop\Johnny-Bass-Ab minor-153bpm-440hz.mp3`. Copy to scratchpad; **do not modify, move or delete the original**; do not commit the audio.

Report same-attack pair count and monophonic share with the prior off and on, and confirm the score reads as a single line rather than stacked octaves. Run `npx ng serve --port 4300` from this worktree's `client/` yourself and **kill it when done**. No full-screen captures.

Commit: `feat: Let the listener declare a stem monophonic`

---

## Done when

- Full suite green, `tsc -p tsconfig.spec.json --noEmit` clean, `npm run build` succeeds with TF.js and alphaTab out of `main`.
- Same-attack pairs at a known partial interval on the real stem: **zero**.
- The synthetic floors are unmoved or better.
- No audio in the repository.

## Deliberately not in scope, and why the first one is the real ceiling

- **The staggered half — 87 harmonic overlaps more than 30 ms apart — cannot be fixed from note events.** "An octave leap over a still-ringing low note" and "a partial the detector onset-detected 140 ms late" produce the *same* `{pitch, onset, offset, confidence}` tuple, and on the labelled synthetic set those populations overlap from 0.49 to 1.33 in the only feature available. No rule reading note events separates them.

  **The evidence that would exists and is being discarded.** `outputToNotesPoly` sees the onset posteriorgram; whether the upper pitch bin shows a *fresh onset spike* or only sustained frame activation is exactly the difference between a struck octave and a ringing partial. `BasicPitchDetector.detect` drops `onsets` after building note events. That is where the remaining headroom is, and it is a detector-level change.
- **More real material.** One file is one file. The fixture format takes another without changes, and a second stem — ideally chordal, to exercise the gate — would turn scope decision 2's weak measurement into a real one.
- **`outputToNotesPoly`'s cost**, ~n^2.5 and 74 % of a warm run.
- **12/8 metre**, still read as twelve tracked beats per bar.
