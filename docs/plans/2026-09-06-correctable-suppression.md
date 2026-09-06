# Correctable Harmonic Suppression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the pipeline's largest discard reversible — its thresholds live, and any single decision overridable by clicking the note.

**Architecture:** Suppression moves out of `transcribe` and into the re-derive path, reading the raw detections the session already keeps. Per-note overrides are applied at the decision point rather than patched afterwards. The preview carries an index from rendered note back to detected note, which is what makes a click meaningful.

**Tech Stack:** No new dependencies. `AlphaTabService.onNoteMouseDown` already exists.

**Prior art:** M1–M3 and the accuracy work are merged. The suppressor is `client/src/app/services/transcription-harmonics.ts`; its accuracy history is `docs/plans/2026-09-06-harmonic-accuracy.md`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\correctable-suppression`, branch `feature/correctable-suppression`. Paths below are relative to `client/`.

Baseline: **573 tests, 0 failures.**

### Why this exists

Harmonic suppression removes about three quarters of all detections — more than any other stage. The accuracy work cut the real notes it destroys from 22 to 3 across 182, but three is not zero, and **a destroyed note currently has no path back**: suppression runs inside `transcribe`, before the session exists, so its four thresholds are hardcoded `{}` and re-running requires re-uploading the file. It is deterministic, so re-uploading gives the same answer.

M3 made the discards *visible* as ghost notes. This makes them *correctable*, which is what the design doc means by errors landing somewhere the user can fix them.

### The complication worth understanding first

**Beat tracking runs on the suppressed notes**, by design — harmonic partials carry their own onsets and would swamp the real rhythm. So changing a suppression threshold changes the note set the tracker sees, and the grid has to be rebuilt.

But the user may have corrected tempo or downbeat by hand, and rebuilding would silently discard that. M3 left the answer in place: `session.trackedGrid` is what `trackBeats` returned, `session.grid` is what is in force, and `withTempo` / `nudgedDownbeat` replace only the latter. So `grid !== trackedGrid` answers "has the user corrected this?".

**The rule: re-track when the user has not corrected the grid; keep their grid when they have.** After a re-track, set both fields to the new grid so the test stays meaningful.

### Scope decisions

1. **Overrides are symmetric.** Restoring a suppressed note and suppressing a kept one are one gesture on a toggle. Barely more work than one direction, and the reverse is genuinely useful — the algorithm keeps artefacts too.
2. **Overrides apply at the decision point, not afterwards.** Passing them into `suppressHarmonics` keeps one code path and correct ordering. It also means a note kept by override can then act as a *root* and suppress its own partials, which is right: if it is a real note, its partials are real partials.
3. **Harmonic settings live on the session, not in `DerivationSettings`.** `DerivationSettings` is what turns detection into notation and is consumed by `deriveScore`; suppression happens before it. Adding fields `deriveScore` ignores would muddy a contract three milestones rest on.
4. **Only `partialConfidenceRatio` gets a prominent control.** It is the one measured against 182 notes. The other three are unmeasured M2 numbers and go in an advanced group, labelled as such.

---

## Task 1: Suppression in the re-derive path

**Files:** `models/transcription.model.ts`, `services/transcription.service.ts` + spec

Add to `TranscriptionSession`:

```typescript
/** Thresholds the suppressor ran with. Live: changing them re-derives. */
harmonics: HarmonicOptions;
```

Move the `suppressHarmonics` call out of `transcribe` and into the re-derive path, reading `session.rawNotes`. Add `updateHarmonics(partial: Partial<HarmonicOptions>)` alongside `updateSettings`, routed through the same `rederive` machinery so it inherits the refusal contract — a knob the user can turn must never throw into an event handler.

Implement the re-track rule from above. `transcribe` still does the first pass; it just stops being the only one.

**Scrutinise:** re-deriving now does real work (suppression plus possibly beat tracking) where it used to be `deriveScore` alone, and M3 measured that at 0.10 ms. Measure it again and report. If a suppression change is slow enough to feel, say so — the review panel binds these to controls.

Tests: changing a threshold changes the kept set without re-running the detector (spy, call count stays 1); an untouched grid re-tracks; a corrected grid survives; `trackedGrid` stays meaningful across both.

Commit: `feat: Re-derive suppression instead of baking it in`

---

## Task 2: Per-note overrides

**Files:** `services/transcription-harmonics.ts` + spec, `models/transcription.model.ts`, `services/transcription.service.ts` + spec

```typescript
export interface NoteDecisions {
  /** Never suppress these, whatever the thresholds say. */
  keep: readonly string[];
  /** Always suppress these, whatever the thresholds say. */
  drop: readonly string[];
}
```

Carried on the session, applied inside `suppressHarmonics` via a new parameter. Note the second parameter is already named `overrides` for *option* overrides — that name is now ambiguous, so rename it and say so.

Service method `toggleNote(id: string)`: a suppressed note moves to `keep`, a kept note moves to `drop`, and a note already overridden the other way has its override removed rather than gaining a second one. Ids come from `rawNotes` and are stable across re-derivation.

**Scrutinise:**
- A note in `keep` becomes eligible to act as a root. Confirm that works and is what you want.
- What happens when a note is in both lists? Make it impossible, or define it.
- Overrides must survive a threshold change — they are the user's explicit decisions and outrank the algorithm.
- An id in neither `rawNotes` nor the current detection set should be ignored, not throw.

Tests including: an overridden keep survives a threshold that would suppress it; an overridden drop stays suppressed at a threshold that would keep it; toggling twice returns to the algorithm's own answer.

Commit: `feat: Let a suppression decision be overridden per note`

---

## Task 3: The index from rendered note back to detected note

**Files:** `services/preview-score.ts` + spec, `services/score-derivation.ts`

A click on a rendered note is meaningless without knowing which `DetectedNote` produced it. `placeDetectedNotes` knows; nothing exposes it.

Have the preview build return an index alongside the document, mapping a key derivable from an alphaTab `Note` — bar index, voice index, beat index, string — to a `DetectedNote.id`. **It must cover both voices**: voice 2 so a ghost can be restored, voice 1 so a kept note can be suppressed.

Voice 1's half needs `deriveScore` to expose its own placement-to-note mapping. Extend what `placeDetectedNotes` already returns rather than recomputing.

**Scrutinise:** two notes can share a bar, voice, beat and string only if something upstream is wrong — `quantizeBar`'s `addToChord` enforces one note per string per beat. Assert that rather than assuming it, and decide what the index does if it is ever violated.

Tests: a ghost's key resolves to the detected note it came from; a kept note's does too; the index covers every rendered note with no gaps.

Commit: `feat: Index rendered notes back to their detections`

---

## Task 4: Click a note to toggle it

**Files:** `components/transcription/components/transcription-review/` + spec

Wire `AlphaTabService.onNoteMouseDown` — it already exists and already wraps handlers in `ngZone.run`. Resolve the clicked note through Task 3's index and emit a toggle.

The component stays free of `TranscriptionService`; emit an output and let the host call `toggleNote`.

**This needs browser verification.** A click handler that resolves the wrong note, or silently resolves nothing, passes a unit test and fails in use. Load `/transcribe`, transcribe a file, click a ghost, and confirm *that* note becomes real. Then click a real note and confirm it becomes a ghost. Screenshot it.

Note for whoever runs it: `preview_start` resolves its cwd to the main checkout, not the worktree — run `npx ng serve --port 4300` from the worktree's `client/` instead. `ng.getComponent(document.querySelector('app-transcription-review'))` is an effective handle for asserting state in dev mode.

Give the interaction an affordance: a ghost should look clickable, and there should be something explaining what clicking does. A silent toggle on a grey notehead is not discoverable.

Commit: `feat: Toggle a note between kept and suppressed by clicking it`

---

## Task 5: The discard list and the threshold control

**Files:** `components/transcription/components/transcription-review/` + spec

**The list:** every suppressed note — pitch, time, why — with a restore control per row, and the same for overridden notes so a decision can be undone. This is the index for notes too small or too crowded to click, and the way to see the whole discard set at once.

Keep it scannable. On real material this is dozens of rows; group or summarise rather than printing a wall.

**The threshold:** a labelled control for `partialConfidenceRatio`. Default 0.65, chosen against 120 candidate pairs — lower keeps more, higher removes more. Say that in a hint attached with `aria-describedby`.

The other three thresholds go in an advanced group, marked as unmeasured M2 numbers rather than presented as equals.

Both follow the existing panel's conventions: real `<label for>`, refusals beside their control, no placeholder standing in for a label, container query for layout.

**Scrutinise:** the list and the score show the same information twice. Make sure they cannot disagree — both should derive from one state, not two computations.

Commit: `feat: List the discards and expose the suppression threshold`

---

## Done when

- Full suite green, `tsc -p tsconfig.spec.json --noEmit` clean, `npm run build` succeeds with TF.js and alphaTab still out of `main`.
- Changing `partialConfidenceRatio` re-derives without re-running detection.
- Clicking a ghost restores it; clicking a real note suppresses it; both verified in the browser.
- A manual tempo or downbeat correction survives a suppression change.
- The accuracy harness still passes its regression floors — this milestone must not move the numbers.

## Deliberately not in scope

- **Persisting overrides.** Sessions are not persisted at all yet.
- **Re-running the detector** with different thresholds. `outputToNotesPoly` has its own `onsetThresh` / `frameThresh` and they are hardcoded; making those live means re-running inference, which is a different feature.
- **Real recordings** for the accuracy harness. Still the biggest threat to the numbers, and still worth more than any further synthetic fixture.
- **Frame-level evidence.** The ceiling on accuracy, and it touches the detector, the worker boundary and the model.
