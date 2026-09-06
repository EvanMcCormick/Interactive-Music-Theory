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

---

## After the final review

Five tasks landed at 674 tests. The review that closed the milestone found two
blockers, two documented guarantees that were not true, and a set of smaller
claims that had drifted from the code. What follows is what was done about
each, in the order it was committed.

### A. A click on a derivation ghost suppressed it

**The bug.** `buildPreviewDoc` draws `derived.dropped` as ghosts alongside the
suppressed ones, and `indexVoice` indexes every ghost it draws — it has no
notion of provenance and should not. So a `belowConfidence` or `beforeGrid`
note resolved from a click like any other, and `toggleNote` found it in
`session.notes`, read it as kept, and sent it to `drop`. The panel meanwhile
promised "a ghost becomes a real note".

Three consequences, escalating: nothing visible happened, because it was a
ghost and stayed one; the kept set moved, so `rederive` re-tracked the beat
grid and an accidental click could re-bar the score; and the note acquired a
`drop` override that outranks the thresholds, so the remedy the panel itself
prints for that group — "Lower the confidence floor to write these as notes" —
silently stopped working for it, with nothing on screen to say why.

**The fix.** `DiscardGroup.restorable` already draws this line and the list
already acts on it by withholding a "Restore" button. The staff has no button
to withhold, so it needs the same fact in a form a click handler can read:
`derivationRemedies(derived.dropped)` is a map from detection id to the
sentence that group prints, built from the same `DISCARD_REMEDIES` table.
`onNoteClicked` consults it, declines, and puts the remedy in the live region
instead of emitting.

Built over the whole of `derived.dropped` rather than over the rows the list
printed: `MAX_LISTED_ROWS` bounds reading, and a click lands on any ghost the
staff drew. A `DropReason` added without a remedy still declines the click,
with a general sentence, rather than falling through to the toggle.

The panel's hint said the wrong thing about those ghosts and now says the
right one.

Commit: `fix: Refuse to toggle a ghost that suppression did not remove`

### B. A refused threshold left the control blank and silent

**The bug.** `onHarmonicChange`'s docblock said "the mirror is still moved on a
refusal, because the box is showing the bad value and a mirror that disagreed
with it would be a second lie". The code returned before doing it, and the
omission was load-bearing rather than cosmetic:

1. Blank the *Overlap tolerance* box. `harmonicNotes.toleranceSec` is set, the
   message shows, nothing is emitted — correct so far.
2. Move any other control. A new state arrives and `ngOnChanges` runs
   `this.harmonicNotes = {}`, clearing the message.
3. The bound expression was `0.03` before the refusal and `0.03` after it, so
   Angular's input check sees no change, `NgModel.ngOnChanges` never fires,
   `writeValue` is never called — and the box stays empty.

An empty control, no message, and a score derived at a value nothing on screen
states: the same failure `snapRefusedControlsBack` exists to prevent, in the
one control that had not been given the same treatment.

**The fix.** Write the refused value into the mirror, as the docblock always
said. The bound value then differs from the arriving session value, so `NgModel`
writes it back through the accessor. The mirror's type widens from
`HarmonicOptions` to `HarmonicMirror` — `Record<keyof HarmonicOptions, number |
null>` — because that is what it actually holds and the narrower type is what
made the omission look correct.

The existing spec could not catch this: it never pushed an intervening state.
The new one does, and fails against the old code.

Commit: `fix: Snap a refused threshold back like every other control`

### C. Two documented guarantees that were not true

**C1. Notes past the row cap that were never drawn.** `groupDiscards` took
`notes.slice(0, MAX_LISTED_ROWS)` and computed `omitted` over the whole group.
The template then claimed, of omitted notes, "Those are only reachable from
here", and of capped notes, "They are still ghosts on the staff, and still one
click away there". An undrawn note at position 41 satisfied neither.

The cap now yields to an undrawn row: those are listed first and in full, and
the cap governs what fills the remainder. A group with more than forty undrawn
notes prints all of them and nothing else. Both sentences are then true by
construction rather than by coincidence — the wall the cap was protecting
against is a wall of rows each reachable another way, and a row reachable
nowhere else is not one of those.

**C2. The stale-index bound was incomplete.** `noteIndex` was replaced in
`ngOnChanges` while the render is debounced 120 ms, which is bounded and was
argued. Two exits from `renderPreview` leave it ahead of the pixels
*indefinitely*: `element.clientWidth === 0`, which alphaTab refuses and never
retries, and a throw from `mapper.toScore`, which leaves the previous score
drawn and clickable under an error message. In the second the reader is looking
at a stale score whose noteheads resolve through a different index — the
confident wrong answer `preview-score.ts` says the arrangement defends against.

The new index now waits in `pendingIndex` and is promoted to `noteIndex` inside
`renderPreview`, after `renderScore` has been handed the document it describes.
Index and pixels come from one derivation by construction, which is the stance
`buildPreviewDoc` already takes a level down, and it closes the debounce window
as well. What remains is alphaTab's own asynchrony — a frame, not a debounce or
a resize. The one path that draws nothing *and* supersedes what is on screen,
a document with no bars, empties the index instead, which is the behaviour that
was there before.

`groupDiscards` reads `pendingIndex`, because the list describes the derivation
that has just arrived rather than the one on screen.

Commit: `fix: Keep the note index in step with what is drawn`

### D. Honesty and small edges

**D1. What the discard list cannot contain.** The panel prints a confident,
complete-looking account headed "Not in the score: N detections", and Basic
Pitch returns about 72 % recall — so roughly 28 % of the played notes never
enter the pipeline at all. They are not in `rawNotes`, not ghosts, not in
`state.suppressed` or `derived.dropped`, not in the list, and carry no id
`toggleNote` could be addressed by. A reader would reasonably conclude the list
is the whole of what is missing. One sentence now says it is an account of the
pipeline's decisions rather than of everything the score lacks.

**D2. A toggle that is a visible no-op.** `toggleNote` reads the two override
lists before the current verdict, so a note that already carries an override
has it cleared rather than gaining a second — the ordering that stops a note
being stuck one gesture from the algorithm either way, and it is right.
Reachable consequence: restore a note, then lower `partialConfidenceRatio` past
its cut, and clicking it clears an override that was no longer doing anything.
"Restored …" over an unchanged staff was the wrong sentence. `describeToggle`
now tells the three outcomes apart by reading the arriving session's own
`decisions`, and says which way the pipeline goes without the override. Two
spec fixtures that carried a restored note without the decision that restored
it were corrected.

**D3. The slider bound and the argument for it.** `onHarmonicChange`'s docblock
justified having no range check by arguing "a ratio of 5 … is a legitimate
thing to ask for", which the measured ratio's slider — capped at 2 — makes
unaskable. The argument moved: the guard is about "is a number" and nothing
else, and where a range is stated it is the control's, not the method's. Landed
with commit B, which rewrote that docblock.

**D4. The 500-line argument, settled with real numbers.** The component's
docblock claimed "303 of these lines are code" while the real count was 397,
and `review-controls.ts` — which exists *because* the component crossed the
ceiling — was 531 lines with no acknowledgement of its own.

The branch was not taken, and the docblocks now say so with the numbers that
support it. The component is **419 code lines of 1001**; `review-controls.ts`
is **263 of 677**, counted as non-blank lines outside block comments and `//`
lines. Both are under the ceiling in code and over it in prose, which is the
argument `transcription.service.ts` already makes.

The escape clause is now specific rather than gestural: the cut is a child
component owning the preview pane — `previewContainer`, `renderPreview`,
`observeContainerWidth`, `noteIndex`/`pendingIndex`, `onNoteClicked` and the
alphaTab lifecycle, about ninety lines. It has a stated cost, which is why it
waits: `groupDiscards` reads the index the preview built, and that is the whole
of how the staff and the list are kept from disagreeing. Across a component
boundary it becomes a contract about which derivation the index describes, held
between a child that renders on a debounce and a parent that counts
immediately.

**D5. Smaller.**

- `id.advancedHint` was assigned and named by nothing. The three advanced
  thresholds now name it alongside their own hints, so "unmeasured" — the most
  important thing said about them — reaches a reader arriving by control.
- Restoring a row destroyed the focused button and dropped focus to `<body>`.
  Focus moves to the discards heading (`tabindex="-1"`) *before* the emit,
  because the host is synchronous and the emit is what destroys the button.
- The component field `toggleNote` held a sentence and collided with both
  `TranscriptionService.toggleNote` and the `noteToggled` output. It is
  `lastGesture`.
- `cursor: pointer` covered the whole scroll box. It is now on alphaTab's drawn
  surface only, so the empty space the container reserves reads as empty.
  Inside the drawing it still overstates — rests and stave space show a pointer
  and `detectionAt` answers null — and the comment now says so, and says what
  narrowing further would cost: alphaTab has no hover event to borrow
  (`noteMouseMove` fires only after a press), so it would mean hit-testing
  every `mousemove` against `boundsLookup` and keeping a second copy of the hit
  test in step with the first.

**D6. A timing guard on the expensive path.** `updateSettings` had one and
`updateHarmonics`, which re-runs suppression and may re-track the beat grid
before `deriveScore` is reached, had none — its measured 0.8 ms median and
1.5 ms worst lived only in prose. It now asserts the same deliberately loose
100 ms bound, and that the re-track actually happened.

Commit: `refactor: Tighten the correction panel's edges and claims`

## Where it ended

**693 tests, 0 failures**, from 674. `tsc -p tsconfig.spec.json --noEmit`
clean, `npm run build` succeeds with TF.js and alphaTab still out of `main`
(initial total 780 kB; the three multi-megabyte chunks are lazy). The accuracy
harness is unmoved: 101 detections suppressed, 98 costing nothing and 3 costing
a real note, exactly as before.
