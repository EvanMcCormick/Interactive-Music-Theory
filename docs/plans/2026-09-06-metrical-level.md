# Metrical Level Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the beat tracker be wrong about *which* note value it found without being wrong about *where* the beats are — infer the metrical level, and let the listener correct it.

**Architecture:** A pure resampling of the tracked grid at a new level, a service method that applies it, inference that proposes one, and a control that overrides the proposal. The tracked grid stays pristine so every level is derived from the tracker's own timing.

**Tech Stack:** No new dependencies.

**Prior art:** Everything through the detection-worker fixes is merged. Beat tracking is `client/src/app/services/beat-tracking.ts`; grid editing is `beat-grid-edit.ts`; the investigation that produced this is `docs/plans/2026-09-06-detection-worker-investigation.md`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\metrical-level`, branch `feature/metrical-level`. Paths below are relative to `client/`.

Baseline: **707 tests, 0 failures.**

### The problem, measured on a real file

A user's bass stem — Ab minor, 153 BPM, 4:22 — transcribed successfully and came out at **100.96 BPM**. A clean 3:2 metrical error.

The bassline is a **3+3+2 eighth (tresillo) figure**, so the strongest onset periodicity in the signal is the three-eighth grouping and the tracker locked onto it. The discriminating measurement, from the investigation:

| subdivide the tracked beat into | mean deviation | chance | verdict |
|---|---|---|---|
| **3** | **0.039** | 0.083 | strong fit |
| 4 | 0.049 | 0.0625 | barely better than chance |

**The tracked beat is a dotted quarter.** Its *positions* are good — 23 ms mean deviation from the true eighth grid. Right pulse, wrong level.

### Why the existing controls cannot fix it

Typing 153 into the tempo box calls `withTempo`, which lays a **uniform** pulse anchored on the first beat and discards everything the tracker learned about local timing. The performance is human — measured local tempo wanders **150.5–153.8** across 20-second windows — so a uniform grid is right for about fifteen bars and at chance by 30–60 s (46.4 % of onsets on eighths against ~50 % chance), 66.9 % at 120–150 s, 52.6 % over the last 30 s. It fixes fifteen bars and abandons a hundred and fifty.

The downbeat nudge has nothing to grip: no phase scores better than ~8 % against ~6.7 % chance, because the *level* is wrong, not the phase.

Setting 12/8 makes it much worse — the pipeline reads the tracked beat as the denominator unit, so 12/8 asks for twelve tracked beats per bar: 7.1 s bars, 37 bars, and dropped notes explode from 46 to 190.

### The fix, in one line

Resample the tracked grid at a new level instead of replacing it:

```
grid[i] = interpolate(trackedGrid, i / beatsPerPulse)
```

With `beatsPerPulse = 1.5`, tracked dotted-quarters at `0.000 0.594 1.188 1.782` become quarters at `0.000 0.396 0.792 1.188` — **and each one is interpolated from tracked times, so drift-following survives.** That is the whole difference from `withTempo`.

### Scope decisions

1. **`trackedGrid` is the source, always.** Every level change resamples the pristine tracker output, never the current grid. Levels are therefore commutative and lossless — going quarter → dotted quarter → quarter returns exactly where you started. Chaining resamples would compound interpolation error.
2. **A level change discards a manual tempo edit, deliberately.** They are two ways of setting the same thing, and the level is the better one. Say so in the UI rather than silently dropping it.
3. **Inference must read the time signature.** A pulse that subdivides in three is *correct* in 6/8 and 12/8 — there the dotted quarter **is** the beat. Proposing a "correction" in compound meter would turn a right answer into a wrong one. This is the single most important constraint on Task 3.
4. **The proposal is always visible and always overridable.** The measurement that separates 3 from 4 here is 0.039 against 0.049 on different chance baselines — real but not overwhelming. A silent automatic answer that is confidently wrong is worse than a visible one that is wrong.

---

## Task 1: Resample the tracked grid at a metrical level

**Files:** `services/beat-grid-edit.ts` + spec

```typescript
/** Grid beats per tracked pulse. 1.5 means the tracker found a dotted quarter. */
export function atMetricalLevel(tracked: BeatGrid, beatsPerPulse: number): BeatGrid;
```

Treat `tracked.beatsSec` as a piecewise-linear map from beat index to time, and sample it at `i / beatsPerPulse` for as many beats as fit. Extrapolate past the last tracked beat using the final interval, consistent with `secondsToBeats`.

Refuse a non-finite or non-positive factor, and bound it the way `withTempo` and `nudgedDownbeat` are bounded — this is a public method and `min`/`max` on a control is one caller's decoration, not a contract.

**Verify with the real numbers.** Tracked dotted-quarters at 100.96 BPM resampled at 1.5 must give quarters near 151.4 BPM, and — the important part — the resampled beats must sit on interpolated tracked times rather than on a uniform pulse. Construct a grid that **drifts** (the real take wanders 150.5–153.8) and assert the resampled grid drifts with it, where `withTempo` on the same input would not. That contrast is the whole point of the function; a test that only checks the tempo number would pass for `withTempo` too.

Commit: `feat: Resample a tracked grid at a different metrical level`

---

## Task 2: The service method and session state

**Files:** `models/transcription.model.ts`, `services/transcription.service.ts` + spec

Add `beatsPerPulse: number` to the session (default 1) and `updateMetricalLevel(beatsPerPulse)`, routed through the same `rederive` machinery as every other knob so it inherits the refusal contract.

It resamples from `session.trackedGrid` per scope decision 1. Note what that means for a session where suppression later re-tracks: the new tracked grid must have the level re-applied, or a threshold change would silently revert the correction. Check `resuppressed`'s re-track path and make it hold.

Tests: a level change re-derives without re-running detection; going 1 → 1.5 → 1 returns the original grid exactly; a level survives a suppression threshold change; a level survives a re-track.

Commit: `feat: Apply a metrical level to the session`

---

## Task 3: Infer the level

**Files:** `services/beat-tracking.ts` (or a new module) + spec

For each candidate subdivision `k`, measure how well detected onsets fall on the `k`-subdivisions of the tracked beat: mean absolute distance in units of tracked beats, against the chance baseline `1/(4k)`. The best *ratio* of observed to chance wins, and only when it clears a margin — otherwise propose nothing.

Then map the winning subdivision to a level, **reading the time signature per scope decision 3**:
- In a simple meter, a pulse that subdivides in three is a dotted value: propose `1.5`.
- In a compound meter (6/8, 9/8, 12/8), a pulse subdividing in three is the beat: propose `1`.

Return the proposal *and the evidence* — the fit numbers — so the UI can show why, and so a future reader can tell a strong proposal from a marginal one.

**Test against the real measurement.** The investigation recorded 0.039 for k=3 and 0.049 for k=4 on this file; a fixture reproducing that shape must propose 1.5 in 4/4 and 1 in 12/8. Also test that ordinary straight material proposes 1, and that ambiguous material proposes nothing rather than guessing.

Commit: `feat: Infer which note value the tracker found`

---

## Task 4: The control

**Files:** `components/transcription/components/transcription-review/` + spec

A labelled select — "Pulse the tracker found" — offering eighth (0.5), quarter (1), dotted quarter (1.5), half (2), dotted half (3). Default from the inference.

Show the proposal and its evidence, so a marginal call is legible rather than authoritative. When the level is not 1, say what the corrected tempo is.

Per scope decision 2, changing the level discards a manual tempo edit — tell the user rather than doing it silently.

Follow the panel's conventions: real `<label for>`, hint via `aria-describedby`, refusal beside the control, the mirror-field pattern that keeps a refused value from sticking.

**Verify in the browser with the user's actual file** — `C:\Users\EvanMccormick\OneDrive - F1Fan\Desktop\Johnny-Bass-Ab minor-153bpm-440hz.mp3`, copied to your scratchpad, original untouched. That file is the reason this exists, and the measurable question is whether the onsets land on the grid *through the whole take* rather than only the first fifteen bars.

Report the on-grid percentage in 30-second windows across the file, at level 1 (today), at level 1.5, and with `withTempo(153)` for contrast. The investigation's numbers for `withTempo(153)` were 81.4 % in the first 30 s falling to 46.4 % at 30–60 s. **Level 1.5 should hold up across the whole file. If it does not, that is the finding and the plan is wrong.**

Commit: `feat: Let the listener correct the metrical level`

---

## Done when

- Full suite green, `tsc -p tsconfig.spec.json --noEmit` clean, `npm run build` succeeds with TF.js and alphaTab out of `main`.
- The user's file transcribes at a tempo near 153 with onsets on the grid across the whole take, not just the opening.
- Going to a level and back returns the original grid exactly.
- A proposal is shown with its evidence and can be overridden.
- The accuracy harness floors are unmoved — this changes the grid, not what is detected.

## Deliberately not in scope

- **Residual harmonic doubling.** Only 66.2 % of kept notes on the real file are monophonic, and 74 of 89 same-attack pairs are octaves or twelfths — partials suppression is still missing on real material in a way no synthetic fixture showed. This is arguably the bigger quality problem and deserves its own pass.
- **Notes above the top open string.** 135 of 986, up to F#4 — playable on paper, almost certainly partials.
- **Variable metre**, and a level that changes mid-piece.
- **`outputToNotesPoly`'s cost** — 74 % of a warm run on a four-minute file, ~n^2.5, cause pinned in the investigation doc.
