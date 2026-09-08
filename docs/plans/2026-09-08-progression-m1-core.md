# Progression Composer M1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A `/progression` page where you pick a key, click diatonic chords into a
timeline, and hear the progression loop — with the sounding chord published so the
fretboard lights up under it.

**Architecture:** Pure music-theory functions first (`progression-harmony.ts`,
`progression-voicing.ts`), then a `ProgressionService` holding
`BehaviorSubject<ProgressionState>` with a `structuredClone` undo stack, then
components that only render and dispatch. Playback is a Tone.js `PolySynth`
scheduled from `RollNote[]`. No piano roll and no notation projection in M1 —
those are M2.

**Tech Stack:** Angular 21 standalone components, RxJS 7.8, Tone.js 15, Jasmine/Karma.

**Design doc:** `docs/plans/2026-09-08-progression-composer-design.md`

**Test command used throughout:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless
```
Add `--include='**/<name>.spec.ts'` to run one spec.

---

## Background you need

**Scale intervals are semitones from the root**, `[0,2,4,5,7,9,11]` for major.
Note values are 0-11 for C through B. This is a project-wide convention — see
`CLAUDE.md`.

**A diatonic triad is built by stacking thirds within the scale**: for scale
degree `d` (0-indexed), the triad is scale degrees `d`, `d+2`, `d+4`, wrapping
round the octave and adding 12 each time you wrap. Quality comes from the
resulting intervals above the chord root:

| third | fifth | quality |
|---|---|---|
| 4 | 7 | major |
| 3 | 7 | minor |
| 3 | 6 | diminished |
| 4 | 8 | augmented |

Worked through for natural minor `[0,2,3,5,7,8,10]` this gives
i, ii°, III, iv, v, VI, VII — which is exactly what Captain Chords shows for
A minor, and is the check that the code is right.

**Only 7-note scales have diatonic triads.** Stacking thirds through a pentatonic
scale is meaningless. The palette must refuse non-heptatonic scales rather than
producing nonsense.

---

## Task 1: Diatonic chord quality and pitch classes

**Files:**
- Create: `client/src/app/services/progression-harmony.ts`
- Test: `client/src/app/services/progression-harmony.spec.ts`

**Step 1: Write the failing test**

```ts
// client/src/app/services/progression-harmony.spec.ts
import { ChordQuality, degreeQuality, degreePitchClasses } from './progression-harmony';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('degreeQuality', () => {
  // The seven triads of a major scale, checked against the figures every
  // theory text prints: I ii iii IV V vi vii-dim.
  it('gives the major scale I ii iii IV V vi vii-dim', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(MAJOR, d, 3));
    expect(qualities).toEqual([
      'major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'
    ] as ChordQuality[]);
  });

  // The Captain Chords screenshot for A minor shows i ii-dim III iv v VI VII.
  it('gives the natural minor scale i ii-dim III iv v VI VII', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(NATURAL_MINOR, d, 3));
    expect(qualities).toEqual([
      'minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'
    ] as ChordQuality[]);
  });

  it('finds the dominant seventh on degree 5 of a major scale', () => {
    expect(degreeQuality(MAJOR, 4, 7)).toBe('dominant7');
  });

  it('finds the major seventh on degree 1 of a major scale', () => {
    expect(degreeQuality(MAJOR, 0, 7)).toBe('major7');
  });
});

describe('degreePitchClasses', () => {
  // Relative to the tonic, so a C major I is 0,4,7 and an A minor I is too -
  // the tonic offset is applied by the caller.
  it('stacks thirds within the scale', () => {
    expect(degreePitchClasses(MAJOR, 0, 3)).toEqual([0, 4, 7]);
    expect(degreePitchClasses(MAJOR, 1, 3)).toEqual([2, 5, 9]);
    expect(degreePitchClasses(MAJOR, 6, 3)).toEqual([11, 14, 17]);
  });

  it('keeps stacking for sevenths and ninths', () => {
    expect(degreePitchClasses(MAJOR, 4, 7)).toEqual([7, 11, 14, 17]);
    expect(degreePitchClasses(MAJOR, 0, 9)).toEqual([0, 4, 7, 11, 14]);
  });

  it('refuses a scale that is not seven notes', () => {
    expect(() => degreePitchClasses([0, 2, 4, 7, 9], 0, 3)).toThrowError(/heptatonic/);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-harmony.spec.ts'
```
Expected: FAIL — `progression-harmony` has no exports yet.

**Step 3: Write the implementation**

```ts
// client/src/app/services/progression-harmony.ts

/**
 * Diatonic chords built by stacking thirds through a scale.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent, so the arithmetic can be checked directly against hand-written
 * chord tables.
 *
 * Everything here is relative to the tonic: a I chord is [0, 4, 7] in every
 * key. Applying the tonic is the caller's job, which keeps transposition a
 * single addition rather than a rule spread through the module.
 */

export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'major7' | 'minor7' | 'dominant7' | 'halfDiminished7' | 'diminished7'
  | 'other';

/** Stacked-third extent. 3 is a triad; 7, 9, 11, 13 add one third each. */
export type ChordExtent = 3 | 7 | 9 | 11 | 13;

/** Notes in a chord of the given extent. 3 -> 3 notes, 7 -> 4, 9 -> 5. */
export function noteCount(extent: ChordExtent): number {
  return extent === 3 ? 3 : (extent - 1) / 2;
}

/**
 * Pitch classes of a diatonic chord, relative to the tonic, ascending.
 *
 * Not reduced mod 12: a chord that crosses the octave keeps climbing, so
 * [11, 14, 17] rather than [11, 2, 5]. Voicing needs the ascending order and
 * reducing here would throw it away.
 */
export function degreePitchClasses(
  scaleIntervals: number[],
  degree: number,
  extent: ChordExtent
): number[] {
  if (scaleIntervals.length !== 7) {
    throw new Error(
      `Diatonic chords need a heptatonic scale; got ${scaleIntervals.length} notes`
    );
  }

  const notes: number[] = [];
  for (let i = 0; i < noteCount(extent); i++) {
    const step = degree + i * 2;
    const octaves = Math.floor(step / 7);
    notes.push(scaleIntervals[step % 7] + octaves * 12);
  }
  return notes;
}

/** Quality of the diatonic chord on `degree`, from its intervals above the root. */
export function degreeQuality(
  scaleIntervals: number[],
  degree: number,
  extent: ChordExtent
): ChordQuality {
  const notes = degreePitchClasses(scaleIntervals, degree, extent);
  const third = notes[1] - notes[0];
  const fifth = notes[2] - notes[0];

  if (extent === 3) {
    if (third === 4 && fifth === 7) return 'major';
    if (third === 3 && fifth === 7) return 'minor';
    if (third === 3 && fifth === 6) return 'diminished';
    if (third === 4 && fifth === 8) return 'augmented';
    return 'other';
  }

  const seventh = notes[3] - notes[0];
  if (third === 4 && fifth === 7 && seventh === 11) return 'major7';
  if (third === 4 && fifth === 7 && seventh === 10) return 'dominant7';
  if (third === 3 && fifth === 7 && seventh === 10) return 'minor7';
  if (third === 3 && fifth === 6 && seventh === 10) return 'halfDiminished7';
  if (third === 3 && fifth === 6 && seventh === 9) return 'diminished7';
  return 'other';
}
```

**Step 4: Run the tests**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-harmony.spec.ts'
```
Expected: PASS, 7 specs.

**Step 5: Commit**

```bash
git add client/src/app/services/progression-harmony.ts client/src/app/services/progression-harmony.spec.ts
git commit -m "feat: Build diatonic chords by stacking thirds through a scale"
```

---

## Task 2: Voicing — pitch classes to MIDI notes

**Files:**
- Create: `client/src/app/services/progression-voicing.ts`
- Test: `client/src/app/services/progression-voicing.spec.ts`

**Step 1: Write the failing test**

```ts
// client/src/app/services/progression-voicing.spec.ts
import { voiceChord } from './progression-voicing';

// Middle C is MIDI 60 throughout.
describe('voiceChord', () => {
  it('stacks a root-position C major from middle C', () => {
    expect(voiceChord([0, 4, 7], 0, 60)).toEqual([60, 64, 67]);
  });

  it('puts the third in the bass for a first inversion', () => {
    expect(voiceChord([0, 4, 7], 1, 60)).toEqual([64, 67, 72]);
  });

  it('puts the fifth in the bass for a second inversion', () => {
    expect(voiceChord([0, 4, 7], 2, 60)).toEqual([67, 72, 76]);
  });

  it('wraps back to root position when the inversion exceeds the note count', () => {
    expect(voiceChord([0, 4, 7], 3, 60)).toEqual([60, 64, 67]);
  });

  it('never repeats a pitch when two chord tones share a pitch class', () => {
    // A stacked 9th spans more than an octave; every note must still ascend.
    const notes = voiceChord([0, 4, 7, 11, 14], 0, 60);
    expect(notes).toEqual([60, 64, 67, 71, 74]);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThan(notes[i - 1]);
    }
  });

  it('starts no note below the base', () => {
    expect(Math.min(...voiceChord([0, 4, 7], 0, 48))).toBeGreaterThanOrEqual(48);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression-voicing.spec.ts'
```
Expected: FAIL — no `voiceChord`.

**Step 3: Write the implementation**

```ts
// client/src/app/services/progression-voicing.ts

/**
 * Turns a chord's pitch classes into actual MIDI notes.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent.
 *
 * The rule is that every note ascends from the one below it. That is what makes
 * an inversion a rotation: move the root to the top of the list and it is
 * re-stacked an octave up, which is what a first inversion is.
 */

/**
 * Voices a chord ascending from `baseMidi`.
 *
 * `pitchClasses` may exceed 11 - `degreePitchClasses` returns [11, 14, 17] for a
 * vii chord - and that is fine, since only the pitch class mod 12 is used.
 */
export function voiceChord(
  pitchClasses: number[],
  inversion: number,
  baseMidi: number
): number[] {
  const count = pitchClasses.length;
  if (count === 0) return [];

  const shift = ((inversion % count) + count) % count;
  const rotated = [...pitchClasses.slice(shift), ...pitchClasses.slice(0, shift)];

  const notes: number[] = [];
  // Starting one below the base means the first note lands on the base itself
  // when their pitch classes match, rather than an octave above it.
  let previous = baseMidi - 1;

  for (const pitchClass of rotated) {
    const step = (((pitchClass - previous) % 12) + 12) % 12;
    // step of 0 means the same pitch class as the previous note, which would
    // repeat it. Push it up an octave so the voicing keeps climbing.
    const midi = previous + (step === 0 ? 12 : step);
    notes.push(midi);
    previous = midi;
  }

  return notes;
}
```

**Step 4: Run the tests**

Expected: PASS, 6 specs.

**Step 5: Commit**

```bash
git add client/src/app/services/progression-voicing.ts client/src/app/services/progression-voicing.spec.ts
git commit -m "feat: Voice a chord ascending, with inversion as a rotation"
```

---

## Task 3: The model

**Files:**
- Create: `client/src/app/models/progression.model.ts`
- Test: `client/src/app/models/progression.model.spec.ts`

Types are as given in the design doc (`ProgressionDoc`, `ChordSlot`, `SlotHarmony`,
`ChordDegree`, `RollNote`), plus factories. Import `ChordQuality` and `ChordExtent`
from `progression-harmony.ts` rather than redeclaring them — the project rule is
"never create duplicate interfaces for the same concept".

**Step 1: Write the failing test**

```ts
// client/src/app/models/progression.model.spec.ts
import {
  createDefaultProgression,
  createDegreeSlot,
  BEATS_PER_SLOT_DEFAULT
} from './progression.model';

describe('createDefaultProgression', () => {
  it('starts in C major, 4/4, at 120bpm with no slots', () => {
    const doc = createDefaultProgression();
    expect(doc.key.tonic).toBe(0);
    expect(doc.timeSignature).toEqual({ numerator: 4, denominator: 4, isCommon: true });
    expect(doc.tempo).toBe(120);
    expect(doc.slots).toEqual([]);
  });

  it('gives every progression its own slot array', () => {
    // structuredClone undo depends on nothing being shared between documents.
    const a = createDefaultProgression();
    const b = createDefaultProgression();
    expect(a.slots).not.toBe(b.slots);
  });
});

describe('createDegreeSlot', () => {
  it('starts a slot as an untouched triad in root position', () => {
    const slot = createDegreeSlot(0, 0);
    expect(slot.harmony).toEqual({
      kind: 'degree',
      degree: { degree: 0, alter: 0, extent: 3, quality: 'major',
                inversion: 0, suspension: 'none', octave: 0 }
    });
    expect(slot.isHandEdited).toBeFalse();
    expect(slot.lengthBeats).toBe(BEATS_PER_SLOT_DEFAULT);
    expect(slot.notes).toEqual([]);
  });

  it('gives every slot a distinct id', () => {
    expect(createDegreeSlot(0, 0).id).not.toBe(createDegreeSlot(0, 0).id);
  });
});
```

**Step 2:** Run it, watch it fail.

**Step 3:** Write `progression.model.ts` with the interfaces from the design doc plus:

```ts
/** One bar in 4/4. The length a chord gets unless the user changes it. */
export const BEATS_PER_SLOT_DEFAULT = 4;

/** Middle C. Where voicings are stacked from before `octave` shifts them. */
export const VOICING_BASE_MIDI = 60;

export function createDefaultProgression(): ProgressionDoc { /* ... */ }
export function createDegreeSlot(degree: number, startBeat: number): ChordSlot { /* ... */ }
```

Generate ids with `crypto.randomUUID()`.

**Step 4:** Run the tests. Expected: PASS, 4 specs.

**Step 5: Commit**

```bash
git add client/src/app/models/progression.model.ts client/src/app/models/progression.model.spec.ts
git commit -m "feat: Add the progression document model"
```

---

## Task 4: Block-chord generation

**Files:**
- Create: `client/src/app/services/progression-generate.ts`
- Test: `client/src/app/services/progression-generate.spec.ts`

This is the `harmony -> notes` arrow from the design doc. In M1 every chord is a
block: one attack at the slot start, held for the whole slot.

**Step 1: Write the failing test**

```ts
import { generateSlotNotes } from './progression-generate';
import { createDegreeSlot } from '../models/progression.model';

const C_MAJOR_KEY = { tonic: 0, scaleId: 'major', preferSharps: true };
const A_MINOR_KEY = { tonic: 9, scaleId: 'natural-minor', preferSharps: false };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('generateSlotNotes', () => {
  it('sounds a C major triad for a I in C major', () => {
    const slot = createDegreeSlot(0, 0);
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([60, 64, 67]);
  });

  it('sounds a D minor triad for a iv in A minor', () => {
    // The Captain screenshot: iv in A minor is D min.
    const slot = createDegreeSlot(3, 0);
    const notes = generateSlotNotes(slot, A_MINOR_KEY, NATURAL_MINOR);
    // D F A above middle C.
    expect(notes.map(n => n.midi % 12).sort()).toEqual([2, 5, 9]);
  });

  it('holds every note for the whole slot', () => {
    const slot = { ...createDegreeSlot(0, 0), lengthBeats: 2 };
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.every(n => n.startBeat === 0 && n.lengthBeats === 2)).toBeTrue();
  });

  it('returns the slot notes unchanged when the slot is literal', () => {
    const existing = [{ midi: 61, startBeat: 0, lengthBeats: 1, velocity: 90 }];
    const slot = {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal' as const, reason: 'unrecognised' as const },
      notes: existing
    };
    expect(generateSlotNotes(slot, C_MAJOR_KEY, MAJOR)).toEqual(existing);
  });
});
```

**Step 2:** Run it, watch it fail.

**Step 3:** Implement. It composes Tasks 1 and 2:

```ts
export function generateSlotNotes(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: number[]
): RollNote[] {
  // A literal slot has no degree to generate from; its notes ARE the truth.
  if (slot.harmony.kind === 'literal') return slot.notes;

  const d = slot.harmony.degree;
  const relative = degreePitchClasses(scaleIntervals, d.degree, d.extent)
    .map(pc => pc + d.alter);
  const absolute = relative.map(pc => pc + key.tonic);
  const base = VOICING_BASE_MIDI + d.octave * 12;

  return voiceChord(absolute, d.inversion, base).map(midi => ({
    midi,
    startBeat: 0,
    lengthBeats: slot.lengthBeats,
    velocity: DEFAULT_VELOCITY
  }));
}
```

Note `suspension` is on the model but not honoured until M2 — leave a comment
saying so rather than half-implementing it.

**Step 4:** Run tests. Expected: PASS, 4 specs.

**Step 5: Commit**

```bash
git commit -m "feat: Generate block-chord notes from a slot's degree"
```

---

## Task 5: ProgressionService — state and undo

**Files:**
- Create: `client/src/app/services/progression.service.ts`
- Test: `client/src/app/services/progression.service.spec.ts`

Copy the shape of `ComposerService` (`client/src/app/services/composer.service.ts`):
a `BehaviorSubject<ProgressionState>`, a `commit(mutate)` that clones onto an undo
stack capped at 100, and `undo()`/`redo()`.

**Methods for M1:**

| Method | Behaviour |
|---|---|
| `getState(): Observable<ProgressionState>` | the subject |
| `appendSlot(degree: number)` | push a slot, generate its notes |
| `removeSlot(id: string)` | drop it, re-flow `startBeat` of the rest |
| `moveSlot(id, toIndex)` | reorder, re-flow `startBeat` |
| `setSlotLength(id, beats)` | resize, re-flow, regenerate that slot's notes |
| `setSlotExtent(id, extent)` | the +/- complexity buttons; regenerate |
| `setSlotInversion(id, inversion)` | regenerate |
| `setSlotOctave(id, octave)` | regenerate |
| `setKey(tonic, scaleId)` | regenerate every degree slot |
| `setTempo(bpm)` | no regeneration |
| `undo()` / `redo()` | |

**Invariant to test explicitly:** slots are contiguous — `slots[i].startBeat`
always equals the sum of all previous `lengthBeats`. Every mutation that changes
order or length must re-flow. Write a helper `reflow(slots)` and a spec that
asserts the invariant after append, remove, move and resize.

**Key tests:**

```ts
it('keeps slots contiguous after a removal', () => { /* ... */ });
it('regenerates every degree slot when the key changes', () => {
  // I in C major is C E G; in A minor the same slot index is A C E.
});
it('restores the previous document on undo', () => { /* ... */ });
it('caps the undo stack at 100 entries', () => { /* ... */ });
```

**Note for M3:** `setKey` regenerates unconditionally here because M1 has no way
to hand-edit a slot. The `isHandEdited` / `literal` branches from the design doc
land with the piano roll in M2/M3. Leave a comment in `setKey` saying so, so the
next person does not think the rule was forgotten.

**Commit:** `feat: Add the progression service, with contiguous slots and undo`

---

## Task 6: Chord palette component

**Files:**
- Create: `client/src/app/components/progression/components/chord-palette/chord-palette.component.{ts,html,scss}`
- Test: `.../chord-palette.component.spec.ts`

Standalone, `OnPush`, subscribes with `takeUntil(destroy$)`.

Renders seven buttons from the current key: Roman numeral (`i`, `ii°`, `III`) plus
the concrete chord name (`A min`, `B°`, `C Maj`). Casing carries the quality —
lowercase for minor, uppercase for major, `°` for diminished — which is the
teaching content, so it belongs in a tested pure function, not in the template:

```ts
export function romanNumeral(degree: number, quality: ChordQuality): string;
```

Test it against both tables from Task 1.

**Refuses non-heptatonic scales**: when the selected scale has other than 7 notes,
render an explanatory message instead of buttons. Test this — it is the guard that
stops the app inventing chords for a pentatonic scale.

Clicking a button calls `progressionService.appendSlot(degree)`.

Chord names come from `MusicTheoryService.getNoteName()` so spelling follows the
app-wide sharps/flats rule.

**Commit:** `feat: Add the diatonic chord palette`

---

## Task 7: Progression strip component

**Files:**
- Create: `client/src/app/components/progression/components/progression-strip/progression-strip.component.{ts,html,scss}`
- Test: `.../progression-strip.component.spec.ts`

A horizontal row of chord cards, each showing its numeral and name, sized in
proportion to `lengthBeats`. Uses `trackBy: slot.id`.

M1 interactions: click to select, drag to reorder, drag the right edge to resize,
a delete control. Emit through the service; hold no state locally.

Test the outputs, not the DOM geometry — per `CLAUDE.md`, DOM structure detail is
too brittle to assert. Assert that a reorder calls `moveSlot` with the right
arguments.

**Commit:** `feat: Add the progression strip`

---

## Task 8: Playback

**Files:**
- Create: `client/src/app/services/progression-player.service.ts`
- Test: `client/src/app/services/progression-player.service.spec.ts`

Owns one `Tone.PolySynth` chain, built once:

```
PolySynth -> Reverb -> Volume -> Destination
```

This is the piano chain from `CLAUDE.md`. Build in the constructor, dispose in
`ngOnDestroy` — the service implements `OnDestroy`.

**API:**

| Method | Behaviour |
|---|---|
| `play(doc: ProgressionDoc)` | schedule a `Tone.Part`, start transport |
| `stop()` | stop transport, cancel the part |
| `setLoop(on: boolean)` | `Tone.Transport.loop` over the progression length |
| `currentSlot$: Observable<string \| null>` | the sounding slot's id |

`Tone.start()` must be called on the first user gesture — the play button — before
anything is scheduled, and a suspended context handled gracefully. Both are
project guardrails.

**Testing:** mock Tone. Assert the schedule that is built — one event per note,
at `startBeat` converted to transport time — not that audio came out. Assert
`dispose()` is called on teardown; a leaked synth is the failure mode
`CLAUDE.md` calls out by name.

**Commit:** `feat: Play a progression on a reused Tone chain`

---

## Task 9: Transport component

**Files:**
- Create: `client/src/app/components/progression/components/progression-transport/progression-transport.component.{ts,html,scss}`
- Test: alongside

Play/stop, loop toggle, tempo input. Thin — it dispatches to the player service
and renders `currentSlot$`.

**Commit:** `feat: Add the progression transport`

---

## Task 10: Page shell, route and nav

**Files:**
- Create: `client/src/app/components/progression/progression.component.{ts,html,scss}`
- Modify: `client/src/main.ts` — add the route
- Modify: `client/src/app/app.component.html:8` — add the nav link
- Modify: `client/src/app/app.component.ts` — include `/progression` in the pages that show the circle-of-fifths toggle

The route must be **lazy**, matching every route but `/fretboard`:

```ts
{
  path: 'progression',
  loadComponent: () => import('./app/components/progression/progression.component')
    .then(m => m.ProgressionComponent)
}
```

`main.ts` has a comment explaining why laziness matters for bundle size — keep
faith with it.

The circle-of-fifths drawer is the key selector for this page, so add
`/progression` to the list in `app.component.ts` that decides where the toggle
shows. Verify by hand that turning the circle re-labels the palette.

**Commit:** `feat: Add the progression page and route`

---

## Task 11: Publish the sounding chord to the fretboard

**Files:**
- Modify: `client/src/app/services/music-theory.service.ts`
- Modify: `client/src/app/components/progression/progression.component.ts`

This is the backing-track job. Subscribe to `currentSlot$`, and on each change
call `MusicTheoryService.selectKeyAndMode(root, 'chords', chordId)` so the
fretboard highlights the sounding chord.

**Check before writing code** whether `selectKeyAndMode` already does what is
needed — `music-theory.service.ts:565` looks close. Extend it only if it does not.

**Restore on stop.** The user's own key/scale selection must come back when
playback stops, or the page silently eats their state. Capture it on play, restore
on stop, and test that specifically.

**Commit:** `feat: Light the fretboard with the sounding chord`

---

## Done when

- `npx ng test --watch=false --browsers=ChromeHeadless` is green
- `npx ng build` succeeds and `main` has not grown (the route is lazy)
- By hand: pick A minor on the circle; the palette reads i, ii°, III, iv, v, VI,
  VII; clicking four chords builds a strip; play loops them; the fretboard follows

## Not in M1

The piano roll, free timing, velocity editing, the `quantizeBar` projection to
`ScoreDoc`, the recogniser, `literal` degradation, the generated track in the
Composer, and export. M2 onward — see the design doc.
