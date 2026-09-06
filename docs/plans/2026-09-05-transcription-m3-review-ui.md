# Transcription M3: Review UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The screen where a transcription becomes trustworthy — drop a stem, see the score, turn every knob until it is right, open it in the composer.

**Architecture:** Two pure modules first (grid editing, ghost preview), then three standalone components. Re-derivation measures 0.10 ms, so every control re-renders live; nothing here needs a spinner except detection itself.

**Tech Stack:** Angular 21 standalone components with `OnPush`, alphaTab 1.8 for the preview, SCSS matching the existing dark theme, no new dependencies.

**Prior art:** M1 (`deriveScore`) and M2 (detection) are merged. Plans at `docs/plans/2026-09-05-transcription-m1-derivation-core.md` and `-m2-detection.md`; design at `-audio-transcription-design.md`.

---

## Before you start

Work in `D:\Github\MusicTheory\.worktrees\audio-transcription-m3`, branch `feature/audio-transcription-review`. Paths below are relative to `client/`.

```bash
npx ng test --watch=false --browsers=ChromeHeadless
npx ng test --watch=false --browsers=ChromeHeadless --include='**/NAME.spec.ts'
```

Baseline: **297 tests, 0 failures.**

### What M3 has to fix, not just display

Two limitations M2 recorded are M3's job:

**1. Bar-line phase is arbitrary.** `beatsSec[0]` is the first *tracked* beat, with no established relationship to the true downbeat. Tempo can be perfect while every bar line sits a beat off, and nothing downstream can tell. The chosen fix is **nudge buttons** that shift the whole grid a beat at a time — cheap to build, and cheap to use precisely because re-derivation is instant.

**2. Tempo and downbeat phase have no service method.** They are two of the design doc's nine promised live knobs, and both need `grid.beatsSec` regenerated or shifted. Task 1 builds them.

### Conventions this codebase already has

- Routes live in **`src/main.ts`**, not a routes file. Nav links are in `src/app/app.component.html`.
- Components are standalone with `changeDetection: ChangeDetectionStrategy.OnPush`, `takeUntil(destroy$)` teardown — see `components/composer/composer.component.ts`.
- Each component declares its own SCSS variables for the dark theme. Match the existing palette: `#2c3e50` nav, `#34495e` secondary, `#3498db` accent, `#ecf0f1` text, `#1a252f` surface, `#e74c3c` error, `#f39c12` warning.
- alphaTab is wired through `services/alpha-tab.service.ts` and `services/score-doc-mapper.service.ts`. `components/composer/components/composer-score/` is the working example of rendering a `ScoreDoc` — read it before Task 4.

### From the web-guidance pass

- **Container queries** (Baseline since 2023) for the two-pane layout — the panel should respond to its own width, not the viewport, so it behaves correctly however it is embedded.
- Every control gets a real `<label for>`; hints attach via `aria-describedby`. **Never a placeholder as a label.**
- **Do not put phase churn in a live region.** "Decoding… / Detecting… / Deriving…" is exactly the interstitial noise the accessibility guidance warns against. One `aria-live="polite"` region announcing meaningful completions and refusals only.

### Scope decisions

1. **Ghost notes go in voice 2, not merged into the score.** `BarDoc.voices` is an array and alphaTab renders multiple voices. Putting discarded notes in a second voice leaves voice 1 byte-identical to what exports, so what you see is what the composer gets. Merging them into one voice could not offer that guarantee — adding onsets changes quantization and fingering.
2. **The preview document is never exported.** *Open in Composer* sends `derived.doc`, not the preview.
3. **No waveform.** The design doc's review screen does not require one, and the nudge buttons make the correction it would enable unnecessary. It is the obvious M4 addition if downbeat correction proves fiddly in practice.

---

## Task 1: Grid editing

Tempo and downbeat phase — the two missing knobs.

**Files:**
- Create: `src/app/services/beat-grid-edit.ts`
- Test: `src/app/services/beat-grid-edit.spec.ts`
- Modify: `src/app/services/transcription.service.ts` (add `updateTempo`, `nudgeDownbeat`)

**Step 1: Write the failing test**

```typescript
import { TimeSignature } from '../models/composer.model';
import { BeatGrid } from '../models/transcription.model';
import { nudgedDownbeat, withTempo } from './beat-grid-edit';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** Five beats at 120 BPM, starting at 1.0 s. */
const GRID: BeatGrid = {
  beatsSec: [1.0, 1.5, 2.0, 2.5, 3.0],
  timeSignature: FOUR_FOUR
};

describe('withTempo', () => {
  it('respaces the beats without moving the first one', () => {
    const slower = withTempo(GRID, 60);

    expect(slower.beatsSec[0]).toBe(1.0);
    expect(slower.beatsSec[1] - slower.beatsSec[0]).toBeCloseTo(1.0, 6);
  });

  it('covers the same span it was given', () => {
    const slower = withTempo(GRID, 60);
    const last = slower.beatsSec[slower.beatsSec.length - 1];

    // Original span is 2 s; at 60 BPM that is 2 beats plus the first.
    expect(last).toBeCloseTo(3.0, 6);
  });

  it('gives more beats at a faster tempo', () => {
    expect(withTempo(GRID, 240).beatsSec.length)
      .toBeGreaterThan(GRID.beatsSec.length);
  });

  it('refuses a tempo that is not a positive number', () => {
    for (const bad of [0, -60, NaN, Infinity]) {
      expect(withTempo(GRID, bad)).toBe(GRID);
    }
  });

  it('refuses a tempo outside the musical range', () => {
    for (const bad of [MIN_TEMPO_BPM - 1, MAX_TEMPO_BPM + 1, 9999, 1e6]) {
      expect(withTempo(GRID, bad)).toBe(GRID);
    }
  });

  it('accepts both ends of the range', () => {
    expect(withTempo(GRID, MIN_TEMPO_BPM)).not.toBe(GRID);
    expect(withTempo(GRID, MAX_TEMPO_BPM)).not.toBe(GRID);
  });

  it('cannot be asked for more bars than a score can hold', () => {
    // Five minutes of audio, at the top of the range.
    const fiveMinutes: BeatGrid = { beatsSec: [0, 0.5, 300], timeSignature: FOUR_FOUR };

    expect(withTempo(fiveMinutes, MAX_TEMPO_BPM).beatsSec.length).toBeLessThan(2100);
    expect(withTempo(fiveMinutes, 9999).beatsSec).toBe(fiveMinutes.beatsSec);
  });

  it('keeps the time signature', () => {
    expect(withTempo(GRID, 90).timeSignature).toEqual(FOUR_FOUR);
  });
});

describe('nudgedDownbeat', () => {
  it('starts the bar a beat later when nudged forward', () => {
    expect(nudgedDownbeat(GRID, 1).beatsSec).toEqual([1.5, 2.0, 2.5, 3.0]);
  });

  it('starts the bar a beat earlier when nudged back', () => {
    expect(nudgedDownbeat(GRID, -1).beatsSec).toEqual([0.5, 1.0, 1.5, 2.0, 2.5, 3.0]);
  });

  it('nudges several beats at once', () => {
    expect(nudgedDownbeat(GRID, 2).beatsSec).toEqual([2.0, 2.5, 3.0]);
  });

  it('is the identity for a nudge of nothing', () => {
    expect(nudgedDownbeat(GRID, 0)).toBe(GRID);
  });

  it('never leaves fewer than two beats', () => {
    // Five beats, and the nudge asks for the most it will take at all.
    expect(nudgedDownbeat(GRID, MAX_DOWNBEAT_NUDGE_BEATS).beatsSec.length).toBe(2);
  });

  it('lets the grid start before the audio does', () => {
    // A first note on beat 2 means bar 1 began before it — which is a
    // negative time. secondsToBeats extrapolates there by design.
    expect(nudgedDownbeat(GRID, -3).beatsSec[0]).toBeCloseTo(-0.5, 6);
  });

  it('restores the original spacing on a round trip', () => {
    const there = nudgedDownbeat(GRID, 1);
    const back = nudgedDownbeat(there, -1);

    expect(back.beatsSec).toEqual(GRID.beatsSec);
  });

  it('refuses a fractional nudge', () => {
    expect(nudgedDownbeat(GRID, 0.5)).toBe(GRID);
  });

  it('refuses a nudge further than the bound, in either direction', () => {
    const tooFar = MAX_DOWNBEAT_NUDGE_BEATS + 1;

    expect(nudgedDownbeat(GRID, tooFar)).toBe(GRID);
    expect(nudgedDownbeat(GRID, -tooFar)).toBe(GRID);
  });

  it('does not build an array per beat for an absurd backward nudge', () => {
    // Before the bound this reached `Array.from({ length: 1e9 })`.
    expect(nudgedDownbeat(GRID, -1e9)).toBe(GRID);
  });

  it('accepts a nudge exactly at the bound', () => {
    expect(nudgedDownbeat(GRID, -MAX_DOWNBEAT_NUDGE_BEATS).beatsSec.length)
      .toBe(GRID.beatsSec.length + MAX_DOWNBEAT_NUDGE_BEATS);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `Cannot find module './beat-grid-edit'`.

**Step 3: Write minimal implementation**

Create `src/app/services/beat-grid-edit.ts`:

```typescript
import { BeatGrid } from '../models/transcription.model';

/**
 * Corrections a listener makes to a tracked beat grid.
 *
 * Beat tracking gets tempo right far more often than it gets phase right: the
 * grid's first beat is whichever tracked pulse the onsets first support, and
 * nothing about it makes it a downbeat. So a transcription can be perfectly in
 * time and still have every bar line a beat out of place, which no amount of
 * tuning the tracker fixes and which a listener spots instantly.
 *
 * Both functions return a new grid, so the caller can re-derive and compare.
 *
 * Both corrections are bounded here rather than in the UI. These are public
 * service methods and a `min`/`max` on a number input is one caller's
 * decoration, not their contract; what is on the far side of the bound is not a
 * wrong answer but a hang. Out-of-range values are refused rather than clamped,
 * matching how both functions already treat input they cannot use, so the
 * caller can compare by identity.
 */

/** Slowest tempo a listener can state — below Larghissimo, under the tracker's 50 BPM floor. */
export const MIN_TEMPO_BPM = 20;

/**
 * Fastest tempo a listener can state.
 *
 * Twice Prestissimo and past the tracker's 210 BPM ceiling, so a listener who
 * hears the tracked pulse as half-time can double it. Bar count scales linearly
 * with tempo: `updateTempo(9999)` on a five-minute file asks for some 12,500
 * bars, each a `MasterBarDoc`, a `quantizeBar` call and a bar of rests, then an
 * alphaTab render that does not return. At 400 BPM the same file is 500 bars.
 */
export const MAX_TEMPO_BPM = 400;

/**
 * Furthest the downbeat can be moved, either way — two bars of 4/4.
 *
 * "Which pulse is beat 1" is settled inside one bar. Past two bars it is a trim
 * rather than a phase correction, and backwards it is an array element per beat
 * asked for: `nudgeDownbeat(-1e9)` went straight to `Array.from({length: 1e9})`.
 */
export const MAX_DOWNBEAT_NUDGE_BEATS = 8;

/**
 * Respaces a grid to a new tempo, anchored on its first beat.
 *
 * The first beat is the one the user has already positioned with the nudge
 * controls, so a tempo change must not move it.
 */
export function withTempo(grid: BeatGrid, bpm: number): BeatGrid {
  // A range test rather than `> 0` plus a ceiling, so NaN — which compares
  // false against everything — is refused by the same expression.
  if (!(bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM)) return grid;

  const beats = grid.beatsSec;
  if (beats.length < 2) return grid;

  const start = beats[0];
  const span = beats[beats.length - 1] - start;
  const interval = 60 / bpm;
  const count = Math.max(2, Math.round(span / interval) + 1);

  return {
    ...grid,
    beatsSec: Array.from({ length: count }, (_, i) => start + i * interval)
  };
}

/**
 * Moves which tracked beat counts as bar 1, beat 1.
 *
 * Positive nudges drop beats off the front, so the bar starts later. Negative
 * ones extend backwards using the leading interval, which can place the first
 * beat before zero — that is correct, and means the piece begins mid-bar.
 * `secondsToBeats` extrapolates before the grid by design.
 *
 * Bounded at `MAX_DOWNBEAT_NUDGE_BEATS` in *both* directions. Forward was
 * already limited by the beats there are to drop; backward had no limit at all.
 *
 * ## What a round trip costs, on a grid that is not evenly spaced
 *
 * The *leading* interval, not the median, because it is the one the prepended
 * beat is adjacent to. On a tracked grid the two differ — the pinned fixture
 * comes back as [0.49, 0.49, 0.51, 0.5, 0.5, 0.49, 0.51] — so the two round
 * trips are asymmetric, and it is worth writing down:
 *
 * - **`-1` then `+1` is exact.** The prepended beat is the dropped beat.
 * - **`+1` then `-1` is not.** `b0` is gone for good and `2·b1 − b2` is written
 *   in its place. The error is the difference between two adjacent intervals,
 *   so under one interval, and it lands entirely on the first beat.
 * - **It does not accumulate.** The second cycle rebuilds from the same `b1`
 *   and `b2`, so it reproduces the first cycle's answer.
 *
 * A note struck after `b1` is placed identically across a round trip; one
 * struck inside the rebuilt interval moves by up to that error, at most a slot
 * on a sixteenth grid.
 */
export function nudgedDownbeat(grid: BeatGrid, beats: number): BeatGrid {
  const source = grid.beatsSec;
  if (source.length < 2 || !Number.isInteger(beats) || beats === 0) return grid;
  if (Math.abs(beats) > MAX_DOWNBEAT_NUDGE_BEATS) return grid;

  if (beats > 0) {
    const drop = Math.min(beats, source.length - 2);
    return { ...grid, beatsSec: source.slice(drop) };
  }

  const interval = source[1] - source[0];
  const added = Array.from(
    { length: -beats },
    (_, i) => source[0] - (i + 1) * interval
  ).reverse();

  return { ...grid, beatsSec: [...added, ...source] };
}
```

**The round-trip tests need an unevenly headed grid.** Every fixture above is evenly spaced, which makes the leading, trailing and median intervals the same number: the choice of interval is untested and `+1` then `-1` reproduces the array exactly whatever it picks. Add `[0, 0.42, 0.92, 1.42, 1.92]` and assert what the docblock actually claims — that `-1`/`+1` is exact, that `+1`/`-1` writes `2·b1 − b2` and so does *not* restore `beatsSec`, that the drift is confined to the first beat and bounded by one interval, that a second cycle changes nothing, and that the backward nudge extends by 0.42 rather than the 0.5 median. Then run it through `deriveScore`: notes struck after the second beat are written in the same slots on both grids, which is the claim worth making; a note in front of the second beat moves by up to one sixteenth, which is worth stating rather than hiding.

**Step 4: Add the service methods**

In `transcription.service.ts`, add `updateTempo(bpm: number)` and `nudgeDownbeat(beats: number)`. Both replace `session.grid` and re-derive through the **same path** `updateSettings` uses — including the `barGridFault` check, so they cannot throw into a caller's event handler either. Add tests mirroring the existing `updateSettings` ones: the detector spy must stay at one call.

**Step 5: Run the full suite, then commit**

```bash
git add src/app/services/beat-grid-edit.ts src/app/services/beat-grid-edit.spec.ts src/app/services/transcription.service.ts src/app/services/transcription.service.spec.ts
git commit -m "feat: Let the listener correct tempo and downbeat"
```

---

## Task 2: Ghost notes for discarded detections

**Files:**
- Create: `src/app/services/preview-score.ts`
- Test: `src/app/services/preview-score.spec.ts`
- Modify: `src/app/services/score-derivation.ts` (export the placement step)

M1 reports every dropped note and why; M2 reports the harmonic partials it removed. None of it is visible. This puts them in the score, in rhythm, where the decision actually happened.

**First, a small refactor.** `deriveScore` computes each note's bar and position inline. Extract that into an exported function — something like `placeDetectedNotes(notes, session): PlacedInBar[]` returning bar index, `beatInBar` and `NotePitch` — and have `deriveScore` use it. `buildPreviewDoc` then places ghosts by exactly the same rules, so the two cannot drift. Do not duplicate the logic.

**Give it its own spec.** It is public API precisely because two callers must not answer its question differently, so its contract cannot be left to the callers' end-to-end results — there a changed rule shows up as a moved note, indistinguishable from a changed intent. Pin: `placed` in ascending onset order; `unplayable` ascending and never also in `placed`; the confidence floor deliberately *absent*, since the preview exists to place the notes it rejected; a non-finite onset throwing rather than corrupting a bar count; and the caller's array left in the order it arrived — the sort is a copy, and sorting in place would silently rewrite `session.notes`, the array the whole re-derive path reads.

**Then:**

```typescript
export function buildPreviewDoc(
  session: TranscriptionSession,
  derived: DerivedScore,
  suppressed: DetectedNote[],
  omitted?: DetectedNote[]
): ScoreDoc;
```

It clones `derived.doc`, places `derived.dropped.map(d => d.note)` plus `suppressed` through the same placement, quantizes them per bar with the session's settings, marks every resulting note `effects.isGhost = true`, and adds them as **voice 2** of each bar. Voice 1 is untouched.

**`omitted` is the conservation law, not a diagnostic.** Some candidates cannot be drawn, and every one of them has to be counted or the panel above the score lies:

```
candidates === ghost heads drawn + omitted.length
```

Three ways to lose one. A pitch `assignFingering` cannot place and an onset that is not a time in seconds have nowhere to go on a tab staff. The third is a ghost struck on a string another ghost in the same slot already holds — `addToChord` keeps one note per string and turns the second away, reporting it through `quantizeBar`'s fourth argument. **Pass that argument.** Omitting it is silent: `deriveScore` passes one and reports the loss as `stringTaken`, and a preview that does not simply drops the note with no glyph and no count.

It bites hardest at exactly the setting a user reaches for to inspect discards. Raising `confidenceFloor` removes the later notes, `derived.doc` collapses to fewer bars, and `Math.min(lastBar, entry.bar)` piles every ghost from the vanished bars into the last one, where collisions are certain. Measured on the pinned basic-pitch fixture, before the fourth argument was passed:

| floor | candidates | ghosts drawn | `omitted` | vanished |
|---|---|---|---|---|
| 0.3 | 26 | 26 | 0 | 0 |
| 0.6 | 28 | 28 | 0 | 0 |
| 0.7 | 33 | 20 | 0 | **13** |
| 0.9 | 34 | 20 | 0 | **14** |

**Quantize once per bar index, outside the staff mapper.** A document can carry several staves; quantizing inside the per-staff map counts every collision once per staff and reports more omissions than there were candidates. Share the resulting `BeatDoc[]` across staves — the module already shares voice 1 by reference, and nothing writes to a `BeatDoc`.

**Voice 1 is shared for provenance, not safety.** Sharing is what would let a mutation *propagate*; a deep copy is what would stop one. What object identity buys is a checkable statement that the previewed voice 1 was carried across rather than rebuilt under slightly different rules — the one failure a preview must not have — and it is free. The safety rests on the callers: `ScoreDocMapperService` only reads the document, and `ComposerService.commit` `structuredClone`s before handing a draft to any mutation. Both are dependencies rather than guarantees, so say so in the docblock.

Tests: voice 1 is *identical* (`toBe`, not `toEqual`) to `derived.doc`'s voice 1; every note in voice 2 is a ghost; a discarded note lands in the bar its onset falls in; a clean session produces a document with no ghost content; unplayable notes are excluded rather than crashing. And the conservation law above, over the real pinned fixture, swept across `confidenceFloor` at 0.3, 0.6, 0.7 and 0.9. Count *heads* — non-rest voice-2 beats whose first note is not tied — since a split span writes tied continuations that would be counted twice.

**Verify in the browser before committing.** Render a preview document through the existing alphaTab path and look at it. The open question this plan cannot answer from a spec is whether a bar whose voice 2 is entirely rests renders visible clutter. If it does, add voice 2 only to bars that actually carry ghosts, and say so in your report.

Commit: `feat: Show discarded detections as ghost notes`

---

## Task 3: AudioDropzoneComponent

**Files:**
- Create: `src/app/components/transcription/components/audio-dropzone/` (`.ts`, `.html`, `.scss`, `.spec.ts`)

A labelled file input that also accepts a drop. Emits `@Output() fileSelected = new EventEmitter<File>()`.

Requirements:
- A real `<input type="file" accept="audio/*">` with a real `<label for>`. The drop zone is an enhancement over a working control, never a replacement for it — keyboard and screen-reader users must be able to choose a file.
- `dragover`/`dragleave`/`drop` with `preventDefault`, and a visible state while a file is over the zone.
- Reject non-audio files with a message rather than silently ignoring them.
- Show the chosen file's name and size.

Tests: emits on input change; emits on drop; rejects a non-audio file; the input has an associated label.

Commit: `feat: Add the audio dropzone`

---

## Task 4: TranscriptionReviewComponent

**Files:**
- Create: `src/app/components/transcription/components/transcription-review/` (`.ts`, `.html`, `.scss`, `.spec.ts`)

The product. Controls on one side, live score on the other.

**Inputs:** the `TranscriptionState`. **Outputs:** one event per knob, or a single `settingsChanged` — your call, but keep the component free of `TranscriptionService`, so it is testable with a plain state object.

**Controls**, each with a `<label for>` and, where it needs one, a hint via `aria-describedby`:

| Control | Bound to |
|---|---|
| Tuning | `settings.tuning` (preset list) |
| Capo | `settings.capo` |
| Finest division | `settings.finestDivision` |
| Confidence floor | `settings.confidenceFloor` |
| Position hint | `settings.positionHint` |
| Max fret | `settings.maxFret` |
| Time signature | `updateTimeSignature` |
| Tempo | `updateTempo` |
| Downbeat | `nudgeDownbeat(-1)` / `nudgeDownbeat(+1)` |

**The preview** renders the *ghost* document via the existing alphaTab path. Read `components/composer/components/composer-score/` first and reuse its approach rather than inventing a second one.

**Discards:** a short line stating what was dropped and why, with counts by reason.

**Refusals:** `TranscriptionState.refusal` is set when a settings combination cannot be expressed (`finestDivision: 4` in 6/8, say). Show it next to the control that caused it, keep the previous score on screen, and do not style it as an error — the score is still valid.

Layout: two panes, side by side when there is room, stacked when there is not, driven by a **container query** on the component's own wrapper.

Tests: changing a control emits the right value; the refusal message renders; discard counts render; the component survives a null session.

Commit: `feat: Add the transcription review panel`

---

## Task 5: TranscriptionComponent, route and navigation

**Files:**
- Create: `src/app/components/transcription/` (`.ts`, `.html`, `.scss`, `.spec.ts`)
- Modify: `src/main.ts` (route), `src/app/app.component.html` (nav link)

The route host. Owns `TranscriptionService`, shows the dropzone until there is a session and the review panel after, and provides *Open in Composer* → `ComposerService.replaceDocument(state.derived.doc)` then `router.navigate(['/composer'])`.

- Progress while detecting. **One** `aria-live="polite"` region, announcing completion and refusal only — not every phase.
- Call `WorkerDetector.terminate()` in `ngOnDestroy`. `TranscriptionService` deliberately does not own the worker; a component that wants inference cancelled on destroy injects `NOTE_DETECTOR` and terminates it. That is the documented contract.
- `takeUntil(destroy$)` on the state subscription.

Add `{ path: 'transcribe', component: TranscriptionComponent }` to `main.ts` and a `Transcribe` link to the nav.

**Verify in the browser.** Start the dev server, load `/transcribe`, and drive it: drop a file, watch progress, turn each knob and confirm the score re-renders, check the layout stacks at a narrow width, and confirm *Open in Composer* lands the score in the composer. Screenshot the result.

Commit: `feat: Add the transcription route`

---

## Done when

- Full suite green, `npx tsc -p tsconfig.spec.json --noEmit` clean, `npm run build` succeeds with the main bundle near 716 kB and TF.js still confined to the worker chunk.
- `/transcribe` takes a real audio file to a rendered score in the browser.
- Every one of the design doc's nine live knobs has a control, and each re-renders without re-running detection.
- Discarded notes are visible as ghosts.
- *Open in Composer* opens the clean document, and undo works (`replaceDocument` is already wrapped by the composer's undo stack).

## Deliberately not in M3

- **A waveform view** — see scope decision 3.
- **Persisting sessions** to the API.
- **Multi-track / multi-stem** transcription.
- **Automatic downbeat inference** — the nudge controls are the answer for now; inference needs a spectral envelope M2 deliberately did not build.
- **Re-running harmonic suppression on a settings change.** M2 baked suppression in at detection time; moving it into the re-derive path (and `HarmonicOptions` into `DerivationSettings`) is real work and would mean re-running beat tracking too, since the tracker runs on the suppressed notes.
