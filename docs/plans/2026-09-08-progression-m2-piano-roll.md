# Progression Composer M2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A piano roll on the progression page — free timing, velocity, drag and
resize — whose edits survive a key change, plus borrowed chords and secondary
dominants in the palette, plus the `quantizeBar` projection to `ScoreDoc`.

**Architecture:** Semantics first, in the pure core, because the model change
(per-aspect ownership, `quality` as an override) is what every later task depends
on. Then the roll, then the vocabulary, then playback and notation. Regeneration
becomes a **merge** rather than a replace, which is the single idea the milestone
turns on.

**Tech Stack:** Angular 21 standalone, RxJS 7.8, Tone.js 15, Jasmine/Karma.

**Design doc:** `docs/plans/2026-09-08-progression-composer-design.md` — read
"Correction: `alter` cannot express a borrowed chord" and "M2 decisions" before
starting. Where they conflict with older sections, they win.

**M1 plan, for context on what already exists:**
`docs/plans/2026-09-08-progression-m1-core.md`

**Test command:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless
```
Add `--include='**/<name>.spec.ts'` to run one spec. The baseline moves as tasks
land - Tasks 1-6 took it from 1330 to 1542. Check `git log` rather than trusting
a number written here.

---

## Background you need

Everything in M1 is built, tested and merged. The pieces you will touch:

| Module | What it does now |
|---|---|
| `progression-harmony.ts` | `degreePitchClasses`, `degreeQuality`, `noteCount`, `isHeptatonic`, `romanNumeral`, `chordName`, `spokenChordName` |
| `progression-voicing.ts` | `voiceChord(pitchClasses, inversion, baseMidi)` |
| `progression-generate.ts` | `generateSlotNotes(slot, key, scaleIntervals)`, `chordRootPitchClass` |
| `progression-edit.ts` | `regenerateSlot`, `retimeNotes`, `reflow`, `settle`, `sameDegree`, `nearestExtent` |
| `progression.service.ts` | state, undo, all the setters |
| `progression-player.service.ts` | `buildSchedule`, `play`, `stop`, `setLoop`, `currentSlot$` |
| `transcription-quantize.ts` | `quantizeBar(notes, timeSignature, finestDivision, dropped?, written?)` — **reuse, do not rewrite** |

**Two rules from M1 that still hold and are easy to break:**

1. **Pitch-set edits can change a slot's identity; timing edits never do.** M3's
   recogniser depends on this. Do not let a timing change trigger re-labelling.
2. **Wrong kind throws, out-of-range clamps or wraps, outside an enumerated set
   throws.** The rule is stated in `progression.model.ts`'s header. Keep to it.

**One hazard that will bite Task 10.** M1 hit a Critical bug where an event
scheduled at exactly `lengthSeconds` fired instead of the loop rewinding, because
Tone floors event ticks (`TransportEvent.js:25`) but does not floor `loopEnd`
(`Transport.js:360`). See the comment on `onCue` in `progression-player.service.ts`.
Do not schedule the rebuild at exactly the loop boundary and assume it lands on
the right side.

---

## Task 1: Per-aspect ownership replaces `isHandEdited`

**Files:**
- Modify: `client/src/app/models/progression.model.ts`
- Test: `client/src/app/models/progression.model.spec.ts`

**Step 1: Write the failing test**

```ts
import { createDegreeSlot, createOwnership, SlotOwnership } from './progression.model';

describe('SlotOwnership', () => {
  it('starts a slot owning nothing', () => {
    expect(createDegreeSlot(0, 0).owned).toEqual({
      pitches: false, timing: false, velocity: false
    } as SlotOwnership);
  });

  it('gives every slot its own ownership record', () => {
    // structuredClone undo depends on nothing being shared between documents.
    expect(createDegreeSlot(0, 0).owned).not.toBe(createDegreeSlot(0, 0).owned);
  });

  it('normalises a slot that arrives without one', () => {
    // replaceDocument is the untrusted door; a document from anywhere else
    // may predate this field.
    const slot = { ...createDegreeSlot(0, 0) } as Record<string, unknown>;
    delete slot['owned'];
    expect(normalizeChordSlot(slot as never).owned).toEqual(createOwnership());
  });
});
```

**Step 2:** Run it, watch it fail.

**Step 3: Implement.** Replace `ChordSlot.isHandEdited: boolean` with:

```ts
/**
 * Which dimensions of this slot the user owns.
 *
 * Replaces M1's single `isHandEdited` boolean, which forced a bad trade in both
 * directions: read literally, one velocity nudge opted a slot out of re-voicing
 * forever; read narrowly, a hand-built rhythm was destroyed by the next key
 * change. Neither loss is the one the user meant.
 *
 * Tracking the three separately makes regeneration a merge - see
 * `regenerateSlot` - so a groove written in C survives a switch to A minor while
 * the chords re-voice underneath it.
 */
export interface SlotOwnership {
  /** Notes moved, added or removed. */
  pitches: boolean;
  /** Note starts or lengths changed within the slot. */
  timing: boolean;
  /** Velocities changed. */
  velocity: boolean;
}

export function createOwnership(): SlotOwnership {
  return { pitches: false, timing: false, velocity: false };
}
```

`normalizeChordSlot` must fill a missing `owned` with `createOwnership()` — it
is the funnel, and `replaceDocument` is the one untrusted door.

**Correction, from the Task 1 review:** an earlier draft of this step said to
*coerce* non-boolean members to `false` as well. That conflates two different
cases. A missing record is a migration — a field added to a document type is
absent from every document written before it — and filling it is right. A member
that is present and of the wrong kind is corruption: no release ever wrote one,
so it came from nowhere legitimate, and coercing it silently resets a dimension
the user had claimed. Absence fills; a present non-boolean throws, under the
first clause of the header rule in `progression.model.ts`.

**Step 4:** Run tests. **Step 5:** Commit.

```
refactor: Track which dimensions of a slot the user owns
```

---

## Task 2: `alter` displaces the root; `quality` becomes an override

**Files:**
- Modify: `client/src/app/services/progression-harmony.ts`
- Modify: `client/src/app/models/progression.model.ts` (`quality: ChordQuality | null`)
- Test: both specs

This is the correction recorded in the design doc. Read that section first.

**Step 1: Write the failing test**

```ts
import { QUALITY_INTERVALS, chordPitchClasses, degreeQuality } from './progression-harmony';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe('QUALITY_INTERVALS', () => {
  // The inverse of degreeQuality. If these two ever disagree, a chord built
  // from a quality would not be recognised as that quality - which is exactly
  // what M3's recogniser will do, in both directions.
  it('round-trips through degreeQuality for every named quality', () => {
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      // Build a heptatonic scale whose degree 0 stacks to exactly these tones.
      expect(qualityOfIntervals(intervals)).toBe(quality);
    }
  });
});

describe('chordPitchClasses', () => {
  it('gives the diatonic stack when quality is null', () => {
    expect(chordPitchClasses(MAJOR, 0, 3, 0, null)).toEqual([0, 4, 7]);
    expect(chordPitchClasses(MAJOR, 6, 3, 0, null)).toEqual([11, 14, 17]);
  });

  it('builds bVII as a major triad on the flattened seventh', () => {
    // The case the correction section tabulates. Degree 6 of C major is B-D-F
    // (diminished); bVII is Bb-D-F, which needs BOTH alter -1 and quality major.
    expect(chordPitchClasses(MAJOR, 6, 3, -1, 'major')).toEqual([10, 14, 17]);
  });

  it('builds a secondary dominant', () => {
    // V/V in C is D7: root D (pitch class 2), dominant seventh shape.
    expect(chordPitchClasses(MAJOR, 1, 7, 0, 'dominant7')).toEqual([2, 6, 9, 12]);
  });

  it('leaves extensions diatonic above an overridden seventh', () => {
    // bVII9: the triad is overridden to Bb-D-F, and the 9th and beyond come
    // from the diatonic stack unchanged.
    const notes = chordPitchClasses(MAJOR, 6, 9, -1, 'major');
    expect(notes.slice(0, 3)).toEqual([10, 14, 17]);
    expect(notes.length).toBe(5);
  });

  it('refuses a chromatic root with no shape to build', () => {
    // Design decision 1: alter !== 0 with quality null is a value of the wrong
    // kind, not a control at its limit.
    expect(() => chordPitchClasses(MAJOR, 6, 3, -1, null)).toThrowError(/quality/i);
  });

  it('refuses `other` as an override', () => {
    expect(() => chordPitchClasses(MAJOR, 0, 3, 0, 'other')).toThrowError();
  });
});
```

`qualityOfIntervals` is a helper you write: it applies `degreeQuality`'s interval
table to a bare interval list. Consider extracting that table so both directions
read from one source rather than two that can drift.

**Step 2:** Run it, watch it fail.

**Step 3: Implement.**

```ts
/** Intervals above the root for each nameable quality. The inverse of `degreeQuality`. */
export const QUALITY_INTERVALS: Readonly<Record<NamedQuality, readonly number[]>> = {
  major: [0, 4, 7],            minor: [0, 3, 7],
  diminished: [0, 3, 6],       augmented: [0, 4, 8],
  major7: [0, 4, 7, 11],       dominant7: [0, 4, 7, 10],
  minor7: [0, 3, 7, 10],       minorMajor7: [0, 3, 7, 11],
  halfDiminished7: [0, 3, 6, 10], diminished7: [0, 3, 6, 9],
  augmented7: [0, 4, 8, 10],   augmentedMajor7: [0, 4, 8, 11]
};

/** `ChordQuality` minus `other`, which names no interval set and cannot be an override. */
export type NamedQuality = Exclude<ChordQuality, 'other'>;

export function chordPitchClasses(
  scaleIntervals: readonly number[],
  degree: number,
  extent: ChordExtent,
  alter: number,
  quality: ChordQuality | null
): number[] {
  const diatonic = degreePitchClasses(scaleIntervals, degree, extent);
  if (quality === null) {
    if (alter !== 0) {
      throw new Error('A chromatic root needs an explicit quality to build from');
    }
    return diatonic;
  }
  if (quality === 'other') {
    throw new Error("'other' names no interval set and cannot be an override");
  }

  const shape = QUALITY_INTERVALS[quality];
  const root = diatonic[0] + alter;
  // The override supplies the triad and any seventh; positions above that keep
  // the scale's own notes, so a bVII9 is Bb-D-F over a diatonic ninth.
  return [
    ...shape.map(i => root + i),
    ...diatonic.slice(shape.length)
  ];
}
```

Then change `ChordDegree.quality` to `ChordQuality | null`, default `null` in
`createDegreeSlot`, and have `generateSlotNotes` call `chordPitchClasses` instead
of `degreePitchClasses`.

**Verify the theory yourself** before trusting the examples above — work bVII,
bVI, bII and V/V through by hand against the correction section's table.

**Step 4:** Run tests. **Step 5:** Commit.

```
feat: Let alter displace the root and quality override the shape
```

---

## Task 3: Re-derive `OCTAVE_MAX` — **DONE**

**Files:** `client/src/app/models/progression-normalize.{ts,spec.ts}`

Done in the M2 Task 2 review fixes rather than as a task of its own, because the
answer turned out to be **change, not confirm**, and leaving an overflowing bound
in place while the override path went live was not a thing to schedule.

**`OCTAVE_MAX` is now 1.** The sweep in `progression-normalize.spec.ts` was
widened from the diatonic pipeline to every `(alter, quality)` pair a stored slot
can carry, across all 33 heptatonic scales × degrees × extents × inversions × 12
tonics. What it measures:

| swept set | max reach above the base | ceiling at `OCTAVE_MAX = 2` |
|---|---|---|
| diatonic only (what the old spec measured) | 33 | 117 |
| + a quality override at `alter` 0 | 34 | 118 |
| + `alter` across its clamped range | **45** | **129 — over MIDI 127** |

The witness for 45: Hungarian minor, degree 5, extent 13, `alter -2`,
`augmented7`, tonic 7, inversion 3 → pitch classes `[6, 10, 14, 16, 23, 26, 30]`,
voicing to `[71, 78, 81, 85, 97, 101, 105]`. Note the middle row: even an
alternates row with no chromatic root at all already passes the old figure of 33.

**The trade-off, recorded.** Dropping the constant costs the user the top octave
of the control — the base ceiling moves from C6 to C5. The alternative is to
leave the octave alone and clamp the *voiced result* into MIDI range, which is a
different answer with different costs: clamping notes individually collapses a
voicing onto its ceiling, and transposing an overflowing chord back down makes
the control non-monotonic. Both silently rewrite the chord, which is the failure
every guard in that file exists to prevent. A third option — deriving each slot's
ceiling from the chord it holds, so only the widest chords lose the octave — is
recorded in the constant's docstring as the thing to reach for if the top octave
is ever missed.

The spec asserting `OCTAVE_MAX + 1` overflows MIDI 127 is kept, so the constant
is still maximal rather than merely safe.

---

## Task 4: `regenerateSlot` merges instead of replacing

**Files:**
- Modify: `client/src/app/services/progression-edit.ts`
- Test: via `progression.service.spec.ts` (that module has no spec of its own by design)

The heart of the milestone. From the design doc:

| dimension | owned | not owned |
|---|---|---|
| pitches | transpose by the interval | re-voice from the degree |
| timing | keep | regenerate as a block |
| velocity | keep | reset to `DEFAULT_VELOCITY` |

**Note the asymmetry:** "transpose by the interval" needs the *old* key, which
`regenerateSlot` does not have. Give it an explicit `transposeBy` rather than
letting it guess — `setKey` is the only caller that knows the delta, and passing
0 elsewhere makes the other call sites read honestly.

Suggested signature:

```ts
export function regenerateSlot(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[] | null,
  transposeBy = 0
): ChordSlot
```

**Also fix consequence 4 from the correction section:** this function currently
overwrites `quality` unconditionally, which erases an override on every key
change, extent step and resize. A `null` quality means "re-derive"; a non-null
one must be left alone.

**Tests that matter:**
- a slot owning nothing is fully regenerated on key change (existing behaviour)
- a slot owning `timing` keeps its note starts and lengths while pitches re-voice
- a slot owning `pitches` has them transposed, not re-voiced
- a slot owning `velocity` keeps it while everything else regenerates
- a non-null `quality` survives a resize, an extent step and a key change
- a `null` quality is still re-derived from the scale

**Commit:** `feat: Regenerate a slot by merging, not replacing`

---

## Task 5: The service honours ownership

**Files:** `client/src/app/services/progression.service.ts` and its spec.

`setKey` computes the semitone delta between old and new tonic and passes it as
`transposeBy`. `setSlotLength` must not destroy owned timing. `setSlotExtent`,
`stepSlotExtent`, `setSlotInversion` and `setSlotOctave` all regenerate, so all
must merge.

New setters the roll needs:

| Method | Behaviour |
|---|---|
| `setSlotNotes(id, notes)` | replace a slot's notes, mark `pitches` owned |
| `setNoteTiming(id, noteIndex, startBeat, lengthBeats)` | mark `timing` owned |
| `setNoteVelocity(id, noteIndex, velocity)` | mark `velocity` owned |
| `resetSlotToChord(id)` | clear all ownership and regenerate — the escape hatch |

`resetSlotToChord` is not optional. Per-aspect ownership is only safe if there is
a way back; without it a user who drags one note has silently opted that slot out
of re-voicing with no way to undo it except undo itself.

Use the **coalescing** commit run that `setSlotLength` already has for any
drag-driven setter, or a note drag will evict the undo history the way M1's
resize did before it was fixed.

**Commit:** `feat: Carry ownership through every regeneration path`

---

## Task 6: Roll geometry

**Files:**
- Create: `client/src/app/components/progression/components/piano-roll/piano-roll-geometry.ts`
- Test: alongside

Pure functions, no Angular, following `progression-strip-gestures.ts` as the
precedent — that split exists because pointer arithmetic is where the bugs are
and it is worth testing as a table.

- `beatToX(beat, pixelsPerBeat)` and `xToBeat(x, pixelsPerBeat)`
- `midiToY(midi, top, rowHeight)` and `yToMidi(y, top, rowHeight)`
- `snapBeat(beat, division)` — quantise a dragged position to the grid
- `visibleMidiRange(notes)` — the pitch window to draw, with padding

**Learn from M1's strip:** the resize handle drifted from the cursor because a
proportional layout cannot be tracked by a fixed pixels-per-beat. The roll must
be an **absolute** layout from the start — `width: calc(var(--px-per-beat) * beats)`
with the container scrolling — and a spec should assert that a pointer moved by N
pixels moves the note by exactly N pixels.

**Commit:** `feat: Add piano roll geometry`

---

## Task 7: The roll component

**Files:** `client/src/app/components/progression/components/piano-roll/piano-roll.component.{ts,html,scss,spec.ts}`

Standalone, `OnPush`, `takeUntil(destroy$)`, `trackBy`, no application state,
view model precomputed. Follow `progression-strip.component.ts`.

Renders the notes of the **selected** slot (M1 already publishes
`selectedSlotId`), on a grid of pitch rows against beats. Interactions: drag a
note in pitch and time, resize its right edge, drag velocity, add a note on
double-click, delete on right-click or a key.

**Grid lines as CSS repeating-gradients, notes as elements** — the design doc
calls this out. Drawing hundreds of grid lines as elements is what makes naive
rolls stutter.

**Test with real pointer events**, deriving coordinates from live
`getBoundingClientRect()` and asserting only the service calls. M1's strip
initially tested only the arithmetic and left six mutants alive in the adapter
layer; the review disproved the rationale for that split by writing the probe
specs itself. Do not repeat it.

**Commit:** `feat: Add the piano roll`

---

## Task 8: Alternates, borrowed chords and secondary dominants

**Files:**
- Create: `client/src/app/services/progression-vocabulary.ts`
- Test: alongside

Pure. Given a key and a selected slot, produce the three named groups:

```ts
export interface ChordOption {
  degree: number;
  alter: number;
  quality: ChordQuality | null;
  numeral: string;     // 'bVII', 'V/V', 'iv'
  name: string;        // 'Bb Maj'
  group: 'alternate' | 'borrowed' | 'secondary';
}
```

- **Alternates** — every named quality on the selected chord's own root.
- **Borrowed** — bII, bIII, bVI, bVII, and minor iv in a major key. Each is a
  `(degree, alter, quality)` triple; derive them, do not hard-code pitch classes.
- **Secondary dominants** — V/V, V/vi, V/IV, V/ii, V/iii. A secondary dominant is
  the dominant seventh whose root is a fifth above the target's root, so this is
  a rule rather than a table.

`romanNumeral` must learn to render an accidental and a slash. Its current
signature takes `(degree, quality)` and cannot express either — widen it, and
note that M1 recorded a related gap: `ChordQuality` has no 9/11/13 members, so
`romanNumeral` and `chordName` are both blind to extent. Decide whether to widen
the type here or keep deferring it, and say which.

**Verify every numeral against theory.** This is the teaching surface; a wrong
label here is the failure mode that matters most.

**Commit:** `feat: Offer borrowed chords and secondary dominants`

---

## Task 9: Palette groups

**Files:** modify `chord-palette.component.{ts,html,scss,spec.ts}`

Render the three groups from Task 8 below the diatonic seven, visually grouped
and labelled. Clicking one appends or retunes a slot with the right
`(degree, alter, quality)`.

Keep the non-heptatonic refusal working — borrowed chords are just as meaningless
in a pentatonic key.

**What Task 8 leaves for you.** Five things it found and could not fix from the
pure layer:

1. **Clicking any option resets the slot's extent**, to 3 for a triad shape and 7
   for a seventh — including the button matching the shape the slot already has.
   A user sitting on a ninth who clicks the highlighted button silently loses the
   ninth. Every option is offered at the height its own quality names, and
   `progression-vocabulary.ts` gives the argument for that; the cost is real and
   the **UI has to show it**, not the doc.
2. **`ChordOption.current` is already computed** — do not recompute it. It marks
   the option whose (degree, alter, shape) the selected slot holds, with a `null`
   quality resolved through the key at the slot's own height, which is the case a
   hand-rolled comparison gets wrong: a fresh slot stores `quality: null` and
   matching on that field alone marks nothing at all. At most one option per row
   is marked; two rows can mark the same chord when the selection is itself a
   borrowed chord, and clicking either does the same thing.
3. **`secondary` is ordered by target degree**, so `V/V` is the fourth of five
   rather than the first. If the row should lead with `V/V`, order it in the
   component.
4. **A secondary can coincide with a chord the key already has.** G mixolydian's
   `V/IV` is a G7, which is also its own `I7`. Nothing is wrong; the label is
   about function, and the palette should not be surprised by two buttons that
   sound the same.
5. **Numerals use the `♭` and `♯` glyphs, not ASCII `b` and `#`.** Markup and
   specs must expect `♭VII`, not `bVII`. Chord *names* are still ASCII, because
   those come from `MusicTheoryService`'s chromatic tables — so a card really does
   read `♭VII` over `Bb Maj`, and that mixture is deliberate (see
   `progression-chord-names.ts`).

**Commit:** `feat: Show alternates, borrowed chords and secondaries in the palette`

---

## Task 10: Rebuild the schedule at the loop boundary

**Files:** `client/src/app/services/progression-player.service.ts` and its spec.

Design decision: edits during playback are collected and applied when the loop
turns over.

The player currently takes a `ProgressionDoc` snapshot and never looks again.
Give it a way to accept a newer document and swap at the boundary. **Do not
invert the dependency** — the player must not learn about `ProgressionService`;
that is what keeps `buildSchedule` pure and testable against numbers.

**Read the `onCue` comment before scheduling anything at the boundary.** M1's
Critical bug was an event at exactly `lengthSeconds` firing instead of the loop
rewinding, because Tone floors event ticks but not `loopEnd`. Whatever mechanism
you choose must be independent of which side of that boundary Tone lands on.

Also fix the readout M1 left wrong: the transport counts against the live
document while the player plays a snapshot, so appending during playback shows
"Chord 2 of 6" when only four will sound. Once the schedule follows the document
this resolves, but assert it.

**Commit:** `feat: Apply edits at the loop boundary`

---

## Task 11: Notation projection

**Files:**
- Create: `client/src/app/services/progression-score.ts`
- Modify: the page shell to show a preview
- Test: alongside

The last arrow in the design doc's data flow: `RollNote[]` → `quantizeBar` →
`ScoreDoc` → `ScoreDocMapperService` → alphaTab.

`quantizeBar` takes `PlacedNote { beatInBar, pitch }` and returns `BeatDoc[]` that
sum to exactly one bar. It is already written and tested — **reuse it**. The work
here is bar-splitting a progression's notes and assembling the `ScoreDoc`, which
`score-derivation.ts` is a working precedent for.

Decide and document: is the preview live on every edit, or on demand? A live
alphaTab re-render per drag frame will be too slow; if live, debounce to edit
commit.

**Commit:** `feat: Project a progression into notation`

---

## Done when

- `npx ng test` green, from whatever the baseline is when you start
- `npx ng build` succeeds and the progression route stays lazy
- By hand: draw a rhythm in C major, switch to A minor on the circle — the groove
  survives and the chords re-voice
- By hand: add a bVII from the borrowed group and hear a Bb major triad, not a Bb
  diminished one
- By hand: edit a note while the loop plays; the change is audible on the next
  pass, with no click at the boundary

## Not in M2

The recogniser, `literal` degradation and the alternates chip that reads back a
hand-edited slot's identity — those are M3, and they are deliberately after this
so they are built against a roll that really exists. The generated track in the
Composer, Flatten, and MIDI/`.gp` export are M4.
