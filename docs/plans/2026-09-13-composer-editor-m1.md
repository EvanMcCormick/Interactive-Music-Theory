# Composer Editor M1: Foundations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the composer's model, mapper and service able to hold, save and edit every
notation tool the M2 palette will expose - without losing data on save, and with bars that
fill their gaps and report their overflow.

**Architecture:** Bottom-up, per the design in
[2026-09-13-composer-editor-design.md](2026-09-13-composer-editor-design.md). Phase A closes
every data-loss path in `ScoreDocMapperService` and adds the model fields alphaTab already
has. Phase B adds a pure bar-filling module that measures beats exactly as alphaTab does.
Phase C adds a selection to `ComposerState` and four families of edit functions. Phase D
routes the service's commands - including today's duration buttons - through them.

**Tech Stack:** Angular 21 standalone, TypeScript 5.9 strict, alphaTab 1.8.0, Jasmine/Karma.

---

## Before you start

**Worktree.** Everything happens in `.worktrees/composer-editor-m1` on
`feature/composer-editor-m1`. Baseline on creation: **2,433 specs, 0 failures**.

**Running one spec file** (from `client/`):

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/score-doc-mapper.effects.spec.ts
```

**Running everything** (from `client/`): `npx ng test --watch=false --browsers=ChromeHeadless`

**Type-checking without a test run** (from `client/`): `npx tsc -p tsconfig.app.json --noEmit`

**Commits.** `<type>: <description>`, and every message ends with a blank line and
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Pass it as a second `-m`.

**House style.** Read `CLAUDE.md`. In particular: pure derivations are named for what they
return (`barFillOf`, not `calculateBarFill`); comments explain *why*, and this codebase
writes them generously; 1000 lines per file at most.

### Facts this plan rests on, all verified on 2026-09-13

- alphaTex 1.8 round-trips every effect in this plan **except the double bar**
  (`MasterBar.isDoubleBar` parses from `\db` and is not exported).
- Writing alphaTab model fields and calling `Score.finish` is enough. `finish` derives
  `Note.bendType` from the points and links a hammer-on to its destination. `finish`
  clears `isHammerPullOrigin` on a hammer-on with no destination - no note on the same
  string, and no left-hand-tapped note on another, within three bars - so such a
  hammer-on does not survive save. Task A1 pins that loss. It does the same to a shift
  or legato slide with no following note on its string (slide out up and slide in from
  below are unaffected); the review of Task A2 pins that loss.
- `Note.finish` (`alphaTab.core.mjs` ~6326-6467 in 1.8) classifies a custom bend of two to
  four points as one of Guitar Pro's bend types - from its first and last values, and the
  middle for three or four points - and rewrites the points to fit. A bend-release (middle
  above both ends, end not below start) ends as four points with a repeated middle; every
  other classified type - bend, release, hold, pre-bend, pre-bend bend, pre-bend release -
  ends as two, so a middle point and its timing go. Four points with differing middles,
  one point, and five or more stay custom. `addBendPoint` only appends: nothing sorts or
  checks the points. The renderer draws classified types at fixed offsets - 0 and 60, plus
  30 for a bend-release's middle (~63236-63262) - whatever is stored. The model stores
  what alphaTab keeps, and Task A3 pins a rewrite. A forced accidental resets to `Default`
  when `initialBendValue` is above 0 (~6469): a first bend value of 2 or more quarter
  tones, or a bend carried over a tie, or a whammy bar (~6157-6170). Task A8 pins the
  pre-bend case.
- Forced accidentals survive alphaTex on fretted *and* pitched notes (`{acc b}`).
- alphaTab's `Beat` has **no staccato**; only `Note.isStaccato` exists.
- Accent, heavy accent and tenuto are one field, `Note.accentuated: AccentuationType`.
- `Note.trillValue` is an absolute pitch value, not a fret: a trill to fret 7 on the G
  string exports as `tr (-48 16)` and still reads back as `7`. Store alphaTab's value.
- The composer library stores alphaTex (`composer-library.service.ts` header), and every
  load goes through `toDoc`, which builds every field. **No migration is needed.**
- alphaTab measures a beat in ticks, 960 per quarter, integer-truncating at each step
  (`MidiUtils.toTicks`, `applyDot`, `applyTuplet`). `MidiUtils` is not in the public
  typings, so Phase B mirrors it and a spec pins the mirror against alphaTab.
- Only `ComposerService` constructs a `ComposerState` (constructor and `reset`), and only
  the model and mapper touch `vibrato`, so the model changes below have no other callers.

### Where this plan departs from the design

1. **No `normalizeScoreDoc`** - see the library fact above. Recorded in the design doc.
2. **Edits mutate a draft rather than returning a copy.** `commit()` already hands its
   callback a `structuredClone`; a pure function returning a new document would clone a
   second time for no gain. The edit functions stay free of service state and are specced
   against a cloned document, which is what the purity was for.
3. **Pitched-note focus waits for M2.** A focused note on a fretted staff is
   `EditCursor.stringIndex`, which exists. A pitched staff has no way to name one note of a
   chord until Pen gives a click a pitch, so note edits there apply to every note of the
   beat.
4. **Today's duration buttons change behaviour in M1.** They are the design's "duration
   change", so they fill gaps and flag overflow from Task D1. The design's M1 row said
   "nothing else" changes; that row is corrected in the same commit as this plan.

---

## Phase A: the model and mapper stop losing data

All Phase A specs live in one new file, `score-doc-mapper.effects.spec.ts`, built up task by
task. Each spec sends a document through `toScore`, alphaTex export, parse and `toDoc` -
the path a save and a load take.

### Task A1: Round-trip harness, and hammer-on

**Files:**
- Create: `client/src/app/services/score-doc-mapper.effects.spec.ts`
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toNote`, `fromNote`)

**Step 1: Write the harness and the failing spec**

```typescript
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDocMapperService } from './score-doc-mapper.service';
import { AlphaTexService } from './alpha-tex.service';
import {
  BeatDoc,
  NoteDoc,
  ScoreDoc,
  STANDARD_GUITAR_TUNING,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';

/**
 * Every effect the composer palette can set, through the path a save and a load take:
 * `toScore`, alphaTex export, parse, `toDoc`.
 *
 * Save stores alphaTex made from the mapper's output, so a field the mapper drops is not
 * a rendering glitch but permanent loss. Each spec here was red before its task, and the
 * one that stays a loss - the double bar - is pinned as a loss, so an alphaTab upgrade
 * that fixes it fails a spec rather than going unnoticed.
 */
describe('ScoreDocMapperService effects round trip', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;
  let settings: alphaTab.Settings;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
    settings = new alphaTab.Settings();
  });

  /** A note on `string` (tab numbering, 1 = high E) at `fret`, with no effects. */
  function fretted(string: number, fret: number): NoteDoc {
    return {
      pitch: { kind: 'fretted', string, fret },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    };
  }

  /** A quarter-note beat holding `notes`, with no effects. */
  function quarter(notes: NoteDoc[]): BeatDoc {
    return {
      duration: 4,
      dots: 0,
      tuplet: null,
      isRest: notes.length === 0,
      notes,
      dynamics: null,
      lyrics: null,
      text: null,
      effects: createDefaultBeatEffects()
    };
  }

  /**
   * One full 4/4 bar on a guitar staff: four quarters on the G string, frets 5 to 8.
   * `edit` changes it before it is mapped. Four notes on one string, because a hammer-on
   * and a slide both want a following note to land on.
   */
  function guitarBar(edit: (beats: BeatDoc[]) => void): ScoreDoc {
    const beats = [5, 6, 7, 8].map(fret => quarter([fretted(3, fret)]));
    edit(beats);
    return {
      title: 'Effects',
      subTitle: '',
      artist: '',
      album: '',
      tempo: 120,
      masterBars: [
        { ...createDefaultMasterBar(), timeSignature: { numerator: 4, denominator: 4, isCommon: true } }
      ],
      tracks: [
        {
          id: 'gtr',
          name: 'Guitar',
          shortName: 'gtr',
          color: '#e74c3c',
          playback: createDefaultPlaybackInfo(25),
          staves: [
            {
              tuning: STANDARD_GUITAR_TUNING.slice(),
              tuningLabel: 'Guitar Standard Tuning',
              capo: 0,
              transpose: 0,
              displayTranspose: 0,
              showStandardNotation: true,
              showTablature: true,
              showSlash: false,
              showNumbered: false,
              bars: [
                {
                  clef: 'g2',
                  clefOttava: 'regular',
                  keySignature: { fifths: 0, mode: 'major' },
                  voices: [{ beats }]
                }
              ]
            }
          ],
          generated: null
        }
      ]
    };
  }

  /** The document as a save and a load would hand it back. */
  function throughTex(doc: ScoreDoc): ScoreDoc {
    const parsed = tex.parse(tex.export(mapper.toScore(doc, settings)));
    if (!parsed.score) throw new Error('exported alphaTex did not parse');
    return mapper.toDoc(parsed.score);
  }

  /** The first bar's beats. */
  function beatsOf(doc: ScoreDoc): BeatDoc[] {
    return doc.tracks[0].staves[0].bars[0].voices[0].beats;
  }

  it('keeps a hammer-on', () => {
    const doc = guitarBar(beats => (beats[0].notes[0].effects.isHammerPullOrigin = true));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.isHammerPullOrigin).toBeTrue();
  });

  // <!-- A2 -->
});
```

**Step 2: Run it and watch it fail**

Run the single-file command with `--include=src/app/services/score-doc-mapper.effects.spec.ts`.
Expected: 1 FAILED - `Expected false to be true.`

**Step 3: Map the field both ways**

In `toNote`, after `note.isStaccato = doc.effects.isStaccato;`:

```typescript
    note.isHammerPullOrigin = doc.effects.isHammerPullOrigin;
```

In `fromNote`, after `effects.isStaccato = note.isStaccato;`:

```typescript
    effects.isHammerPullOrigin = note.isHammerPullOrigin;
```

**Step 4: Run it and watch it pass.** Expected: 1 SUCCESS.

**Step 5: Commit**

```bash
git add client/src/app/services/score-doc-mapper.effects.spec.ts client/src/app/services/score-doc-mapper.service.ts
git commit -m "fix: Keep a hammer-on through save and load" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task A2: Slides read back

The mapper writes a slide (`applySlide` in `alpha-tab-enum.bridge.ts`) and never reads one,
so every slide is gone after a reload.

**Files:**
- Modify: `client/src/app/services/alpha-tab-enum.bridge.ts` (add `slideOf`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`fromNote`, imports)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A2 -->` with:

```typescript
  for (const slide of ['shiftSlide', 'legatoSlide', 'slideInBelow', 'slideOutUp'] as const) {
    it(`keeps a ${slide}`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.slide = slide));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.slide).toBe(slide);
    });
  }

  // <!-- A3 -->
```

**Step 2: Run.** Expected: 4 FAILED, each `Expected 'none' to be '...'`.

**Step 3: Implement.** Append to `alpha-tab-enum.bridge.ts`:

```typescript
/**
 * The slide `applySlide` would have written, read back off a note.
 *
 * `NoteEffectsDoc.slide` is one value where alphaTab has two fields - a slide in and a
 * slide out - so a note carrying both reads as its slide out, which is the one the
 * palette sets. An in-slide the model has no name for (from above) reads as none.
 */
export function slideOf(note: alphaTab.model.Note): NoteDoc['effects']['slide'] {
  switch (note.slideOutType) {
    case alphaTab.model.SlideOutType.Shift: return 'shiftSlide';
    case alphaTab.model.SlideOutType.Legato: return 'legatoSlide';
    case alphaTab.model.SlideOutType.OutUp: return 'slideOutUp';
  }
  return note.slideInType === alphaTab.model.SlideInType.IntoFromBelow ? 'slideInBelow' : 'none';
}
```

In `score-doc-mapper.service.ts`, add `slideOf` to the bridge import, and in `fromNote` after
`effects.harmonic = ...`:

```typescript
    effects.slide = slideOf(note);
```

**Step 4: Run.** Expected: 5 SUCCESS.

**Step 5: Commit** both source files and the spec:
`fix: Read slides back so a reload keeps them`.

### Task A3: Bends, as offset and value pairs

`NoteEffectsDoc.bendPoints` is `number[]` - a value per point with no position through the
note - and nothing maps it. alphaTab's `BendPoint` is `{ offset: 0-60, value: quarter tones }`.

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`BendPointDoc`, `NoteEffectsDoc.bendPoints`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toNote`, `fromNote`)
- Modify: `client/src/app/models/transcription.model.ts` (two comments, lines ~67 and ~209)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A3 -->` with:

```typescript
  it('keeps a bend as positioned points', () => {
    const points = [{ offset: 0, value: 0 }, { offset: 60, value: 4 }];
    const doc = guitarBar(beats => (beats[0].notes[0].effects.bendPoints = points));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.bendPoints).toEqual(points);
  });

  it("stores a bend in the shape alphaTab keeps - a rising bend's middle point goes", () => {
    // `Note.finish` classifies a custom bend of two to four points as one of Guitar Pro's
    // bend types and rewrites its points to fit, before a character of alphaTex is written.
    // This curve reaches a semitone three quarters of the way through and a whole tone at
    // the end. alphaTab calls it a plain Bend and keeps only its ends, so the curve's timing
    // is lost - a real point, not a redundant one. Pinned because the model's contract is
    // alphaTab's shape, not the curve as drawn, and so M4's bend curve editor knows it.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.bendPoints = [
      { offset: 0, value: 0 }, { offset: 45, value: 2 }, { offset: 60, value: 4 }
    ]));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.bendPoints)
      .toEqual([{ offset: 0, value: 0 }, { offset: 60, value: 4 }]);
  });

  // <!-- A4 -->
```

**Step 2: Run.** Expected: a compile error - `Type '{ offset: number; value: number; }' is not
assignable to type 'number'`. That is the red.

**Step 3: Implement.** In `composer.model.ts`, above `NoteEffectsDoc`:

```typescript
/**
 * One point of a bend curve, in alphaTab's own units so the mapper copies rather than
 * converts: `offset` is the position through the note, 0 to 60, and `value` is the
 * pitch in quarter tones, 0 to 12 (`BendPoint.MaxValue`), so 4 is a whole-tone bend.
 */
export interface BendPointDoc {
  offset: number;
  value: number;
}
```

and replace the `bendPoints` member:

```typescript
  /**
   * The bend curve, points in ascending `offset`. Empty = no bend.
   *
   * alphaTab neither sorts nor checks what it is given - playback times each segment by
   * the difference in offsets, so an out-of-order pair gets a negative length - and
   * `Note.finish` rewrites a bend of two to four points into one of Guitar Pro's shapes.
   * A document holds that shape only once read back through `toDoc`; until then it holds
   * the points as written. Whatever writes bends must write Guitar Pro's shapes or
   * normalise, for example by reading the note back through the mapper.
   */
  bendPoints: BendPointDoc[];
```

In `toNote`, after the hammer-on line:

```typescript
    for (const point of doc.effects.bendPoints) {
      note.addBendPoint(new alphaTab.model.BendPoint(point.offset, point.value));
    }
```

In `fromNote`, after `effects.slide = slideOf(note);`:

```typescript
    effects.bendPoints = (note.bendPoints ?? []).map(point => ({
      offset: point.offset,
      value: point.value
    }));
```

In `transcription.model.ts`, the two comments that describe `NoteEffectsDoc.bendPoints` as
"quarter tones, one value per bend point" become "offset and value pairs - a position
through the note, 0 to 60, and a pitch in quarter tones". Keep the argument each comment
makes about the frame rate; only the description of the target changes.

**Step 4: Run.** Expected: 10 SUCCESS - the effects file had 8 specs before this task (A1,
A2 and their reviews) and gains two. Then the type check - expected: no output.

**Step 5: Commit** six files: the four above, plus this plan and
`docs/plans/2026-09-13-composer-editor-design.md`, which pinning alphaTab's bend rewrite
added (the facts above, and a "Found while designing" entry):
`fix: Keep bends through save and load, in the shapes alphaTab stores`.

### Task A4: Accent, heavy accent and tenuto

New in the model. alphaTab keeps all three in `Note.accentuated`, so they are one field
here too and setting one clears the others - which is also what engraving them requires.

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`AccentKind`, `NoteEffectsDoc.accent`, default)
- Modify: `client/src/app/services/alpha-tab-enum.bridge.ts` (`toAccentuation`, `accentOf`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toNote`, `fromNote`, imports)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A4 -->` with:

```typescript
  for (const accent of ['normal', 'heavy', 'tenuto'] as const) {
    it(`keeps a ${accent} accent`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.accent = accent));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.accent).toBe(accent);
    });
  }

  // <!-- A5 -->
```

**Step 2: Run.** Expected: compile error, `Property 'accent' does not exist on type 'NoteEffectsDoc'`.

**Step 3: Implement.** In `composer.model.ts`, beside the other kind unions near the top:

```typescript
/**
 * An accent mark. One field for three marks because alphaTab's `AccentuationType` holds
 * them in one, so a note carries at most one of them.
 */
export type AccentKind = 'none' | 'normal' | 'heavy' | 'tenuto';
```

Add to `NoteEffectsDoc` after `isStaccato`:

```typescript
  accent: AccentKind;
```

and to `createDefaultNoteEffects()` after `isStaccato: false,`:

```typescript
    accent: 'none',
```

Append to `alpha-tab-enum.bridge.ts` (add `AccentKind` to its model import):

```typescript
export function toAccentuation(accent: AccentKind): alphaTab.model.AccentuationType {
  switch (accent) {
    case 'normal': return alphaTab.model.AccentuationType.Normal;
    case 'heavy': return alphaTab.model.AccentuationType.Heavy;
    case 'tenuto': return alphaTab.model.AccentuationType.Tenuto;
    default: return alphaTab.model.AccentuationType.None;
  }
}

export function accentOf(accentuated: alphaTab.model.AccentuationType): AccentKind {
  switch (accentuated) {
    case alphaTab.model.AccentuationType.Normal: return 'normal';
    case alphaTab.model.AccentuationType.Heavy: return 'heavy';
    case alphaTab.model.AccentuationType.Tenuto: return 'tenuto';
    default: return 'none';
  }
}
```

In the mapper, import both. `toNote`, after the bend loop:

```typescript
    note.accentuated = toAccentuation(doc.effects.accent);
```

`fromNote`, after the bend points:

```typescript
    effects.accent = accentOf(note.accentuated);
```

**Step 4: Run.** Expected: 9 SUCCESS.

**Step 5: Commit** the four files: `feat: Add accent, heavy accent and tenuto to the score model`.

### Task A5: Wide vibrato

`vibrato: boolean` on notes and beats collapses alphaTab's `VibratoType` to slight, so a
wide vibrato saves as a slight one. The palette has both.

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`VibratoKind`, both effects interfaces, both defaults)
- Modify: `client/src/app/services/alpha-tab-enum.bridge.ts` (`toVibratoType`, `vibratoOf`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (four vibrato lines, imports)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A5 -->` with:

```typescript
  for (const vibrato of ['slight', 'wide'] as const) {
    it(`keeps a ${vibrato} vibrato on a note`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.vibrato = vibrato));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.vibrato).toBe(vibrato);
    });

    it(`keeps a ${vibrato} vibrato on a beat`, () => {
      const doc = guitarBar(beats => (beats[0].effects.vibrato = vibrato));

      expect(beatsOf(throughTex(doc))[0].effects.vibrato).toBe(vibrato);
    });
  }

  // <!-- A6 -->
```

**Step 2: Run.** Expected: compile error, `Type '"slight"' is not assignable to type 'boolean'`.

**Step 3: Implement.** In `composer.model.ts`:

```typescript
/** Vibrato width. alphaTab's `VibratoType`, which a boolean collapsed to slight. */
export type VibratoKind = 'none' | 'slight' | 'wide';
```

In both `BeatEffectsDoc` and `NoteEffectsDoc`, `vibrato: boolean;` becomes
`vibrato: VibratoKind;`, and in both default factories `vibrato: false,` becomes
`vibrato: 'none',`.

Append to the bridge (import `VibratoKind`):

```typescript
export function toVibratoType(vibrato: VibratoKind): alphaTab.model.VibratoType {
  switch (vibrato) {
    case 'slight': return alphaTab.model.VibratoType.Slight;
    case 'wide': return alphaTab.model.VibratoType.Wide;
    default: return alphaTab.model.VibratoType.None;
  }
}

export function vibratoOf(vibrato: alphaTab.model.VibratoType): VibratoKind {
  switch (vibrato) {
    case alphaTab.model.VibratoType.Slight: return 'slight';
    case alphaTab.model.VibratoType.Wide: return 'wide';
    default: return 'none';
  }
}
```

In the mapper, import both, then replace the four vibrato statements:

```typescript
    // toBeat
    beat.vibrato = toVibratoType(doc.effects.vibrato);
    // toNote
    note.vibrato = toVibratoType(doc.effects.vibrato);
    // fromBeat
    effects.vibrato = vibratoOf(beat.vibrato);
    // fromNote
    effects.vibrato = vibratoOf(note.vibrato);
```

**Step 4: Run.** Expected: 13 SUCCESS. Then run the whole suite once - the boolean had no
other reader, and this is where you would find out otherwise. Expected: all green.

**Step 5: Commit** the four files: `fix: Keep a wide vibrato wide through save and load`.

### Task A6: Left-hand tap, trill and fingering

New in the model. alphaTab's defaults, checked on a fresh `Note`: `isLeftHandTapped` false,
`trillValue` -1 (no trill), `trillSpeed` 32, both fingers -2 (`Fingers.Unknown`).

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`TrillDoc`, `FingerKind`, four `NoteEffectsDoc` members, default)
- Modify: `client/src/app/services/alpha-tab-enum.bridge.ts` (`toFingers`, `fingerOf`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toNote`, `fromNote`, imports)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A6 -->` with:

```typescript
  it('keeps a left-hand tap', () => {
    const doc = guitarBar(beats => (beats[0].notes[0].effects.isLeftHandTapped = true));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.isLeftHandTapped).toBeTrue();
  });

  it('keeps a trill with its speed', () => {
    // `value` is alphaTab's absolute trill value, not a fret - see TrillDoc.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.trill = { value: 7, speed: 16 }));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.trill).toEqual({ value: 7, speed: 16 });
  });

  it('keeps fingering for both hands', () => {
    const doc = guitarBar(beats => {
      beats[0].notes[0].effects.leftHandFinger = 'middle';
      beats[0].notes[0].effects.rightHandFinger = 'index';
    });

    const effects = beatsOf(throughTex(doc))[0].notes[0].effects;
    expect(effects.leftHandFinger).toBe('middle');
    expect(effects.rightHandFinger).toBe('index');
  });

  // <!-- A7 -->
```

**Step 2: Run.** Expected: compile errors for the three missing members.

**Step 3: Implement.** In `composer.model.ts`:

```typescript
/**
 * A trill, in alphaTab's own terms so the mapper copies rather than converts.
 *
 * `value` is `Note.trillValue`, which alphaTab stores as an absolute value and exposes
 * relative to the string as `trillFret` - a trill to fret 7 on the G string exports as
 * `tr (-48 16)` and still reads back as 7. Whatever sets a trill from a fret (the M4
 * trill editor) converts there, once, rather than every round trip converting here.
 */
export interface TrillDoc {
  value: number;
  speed: 16 | 32 | 64;
}

/** A finger, for either hand. `none` is alphaTab's `Fingers.Unknown`. */
export type FingerKind = 'none' | 'thumb' | 'index' | 'middle' | 'annular' | 'little';
```

Add to `NoteEffectsDoc` after `accent`:

```typescript
  isLeftHandTapped: boolean;
  /** null = no trill. */
  trill: TrillDoc | null;
  leftHandFinger: FingerKind;
  rightHandFinger: FingerKind;
```

and to `createDefaultNoteEffects()` after `accent: 'none',`:

```typescript
    isLeftHandTapped: false,
    trill: null,
    leftHandFinger: 'none',
    rightHandFinger: 'none',
```

Append to the bridge (import `FingerKind`):

```typescript
const FINGERS: ReadonlyArray<[FingerKind, alphaTab.model.Fingers]> = [
  ['thumb', alphaTab.model.Fingers.Thumb],
  ['index', alphaTab.model.Fingers.IndexFinger],
  ['middle', alphaTab.model.Fingers.MiddleFinger],
  ['annular', alphaTab.model.Fingers.AnnularFinger],
  ['little', alphaTab.model.Fingers.LittleFinger]
];

export function toFingers(finger: FingerKind): alphaTab.model.Fingers {
  return FINGERS.find(([kind]) => kind === finger)?.[1] ?? alphaTab.model.Fingers.Unknown;
}

/** `NoOrDead` reads as none too: the model has no way to say "deliberately no finger". */
export function fingerOf(fingers: alphaTab.model.Fingers): FingerKind {
  return FINGERS.find(([, value]) => value === fingers)?.[0] ?? 'none';
}
```

In the mapper, import both. `toNote`, after the accent:

```typescript
    note.isLeftHandTapped = doc.effects.isLeftHandTapped;
    if (doc.effects.trill) {
      note.trillValue = doc.effects.trill.value;
      note.trillSpeed = doc.effects.trill.speed as unknown as alphaTab.model.Duration;
    }
    note.leftHandFinger = toFingers(doc.effects.leftHandFinger);
    note.rightHandFinger = toFingers(doc.effects.rightHandFinger);
```

`fromNote`, after the accent:

```typescript
    effects.isLeftHandTapped = note.isLeftHandTapped;
    effects.trill = note.isTrill
      ? { value: note.trillValue, speed: note.trillSpeed as number as TrillDoc['speed'] }
      : null;
    effects.leftHandFinger = fingerOf(note.leftHandFinger);
    effects.rightHandFinger = fingerOf(note.rightHandFinger);
```

(import `TrillDoc` from the model).

**Step 4: Run.** Expected: 16 SUCCESS.

**Step 5: Commit** the four files: `feat: Add left-hand tap, trill and fingering to the score model`.

### Task A7: Beat effects - fermata, crescendo, pick stroke, fade in; beat staccato goes

`BeatEffectsDoc.fadeIn` exists and is never mapped. `BeatEffectsDoc.isStaccato` has nowhere
to go - alphaTab's `Beat` has no staccato - and nothing reads or writes it, so it is deleted
rather than half-supported. Fermata, crescendo and pick stroke are new. alphaTab's defaults
on a fresh `Beat`: `fermata` null, `crescendo`, `pickStroke` and `fade` all 0 (none).

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`FermataDoc`, `BeatEffectsDoc`, default)
- Modify: `client/src/app/services/alpha-tab-enum.bridge.ts` (fermata, crescendo, pick stroke lookups)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toBeat`, `fromBeat`, imports)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A7 -->` with:

```typescript
  it('keeps a fade in', () => {
    const doc = guitarBar(beats => (beats[0].effects.fadeIn = true));

    expect(beatsOf(throughTex(doc))[0].effects.fadeIn).toBeTrue();
  });

  it('keeps a fermata with its type and length', () => {
    const doc = guitarBar(beats => (beats[0].effects.fermata = { type: 'long', length: 1 }));

    expect(beatsOf(throughTex(doc))[0].effects.fermata).toEqual({ type: 'long', length: 1 });
  });

  for (const crescendo of ['crescendo', 'decrescendo'] as const) {
    it(`keeps a ${crescendo}`, () => {
      const doc = guitarBar(beats => (beats[0].effects.crescendo = crescendo));

      expect(beatsOf(throughTex(doc))[0].effects.crescendo).toBe(crescendo);
    });
  }

  for (const pickStroke of ['up', 'down'] as const) {
    it(`keeps a pick stroke ${pickStroke}`, () => {
      const doc = guitarBar(beats => (beats[0].effects.pickStroke = pickStroke));

      expect(beatsOf(throughTex(doc))[0].effects.pickStroke).toBe(pickStroke);
    });
  }

  // <!-- A8 -->
```

**Step 2: Run.** Expected: `fadeIn` fails on its assertion (`Expected false to be true.`);
the rest are compile errors.

**Step 3: Implement.** In `composer.model.ts`:

```typescript
/** A fermata. alphaTab's `Fermata`: a type and a length multiplier. */
export interface FermataDoc {
  type: 'short' | 'medium' | 'long';
  length: number;
}
```

In `BeatEffectsDoc`, delete `isStaccato: boolean;` and add after `fadeIn`:

```typescript
  /** null = no fermata. */
  fermata: FermataDoc | null;
  crescendo: 'none' | 'crescendo' | 'decrescendo';
  pickStroke: 'none' | 'up' | 'down';
```

In `createDefaultBeatEffects()`, delete `isStaccato: false,` and add after `fadeIn: false,`:

```typescript
    fermata: null,
    crescendo: 'none',
    pickStroke: 'none',
```

Append to the bridge (import `FermataDoc`):

```typescript
export function toFermata(fermata: FermataDoc): alphaTab.model.Fermata {
  const result = new alphaTab.model.Fermata();
  result.type =
    fermata.type === 'short' ? alphaTab.model.FermataType.Short
      : fermata.type === 'long' ? alphaTab.model.FermataType.Long
        : alphaTab.model.FermataType.Medium;
  result.length = fermata.length;
  return result;
}

export function fermataOf(fermata: alphaTab.model.Fermata | null): FermataDoc | null {
  if (!fermata) return null;
  const type =
    fermata.type === alphaTab.model.FermataType.Short ? 'short'
      : fermata.type === alphaTab.model.FermataType.Long ? 'long'
        : 'medium';
  return { type, length: fermata.length };
}

export function toCrescendoType(kind: BeatDoc['effects']['crescendo']): alphaTab.model.CrescendoType {
  switch (kind) {
    case 'crescendo': return alphaTab.model.CrescendoType.Crescendo;
    case 'decrescendo': return alphaTab.model.CrescendoType.Decrescendo;
    default: return alphaTab.model.CrescendoType.None;
  }
}

export function crescendoOf(type: alphaTab.model.CrescendoType): BeatDoc['effects']['crescendo'] {
  switch (type) {
    case alphaTab.model.CrescendoType.Crescendo: return 'crescendo';
    case alphaTab.model.CrescendoType.Decrescendo: return 'decrescendo';
    default: return 'none';
  }
}

export function toPickStroke(kind: BeatDoc['effects']['pickStroke']): alphaTab.model.PickStroke {
  switch (kind) {
    case 'up': return alphaTab.model.PickStroke.Up;
    case 'down': return alphaTab.model.PickStroke.Down;
    default: return alphaTab.model.PickStroke.None;
  }
}

export function pickStrokeOf(stroke: alphaTab.model.PickStroke): BeatDoc['effects']['pickStroke'] {
  switch (stroke) {
    case alphaTab.model.PickStroke.Up: return 'up';
    case alphaTab.model.PickStroke.Down: return 'down';
    default: return 'none';
  }
}
```

In the mapper, import the six. `toBeat`, after `beat.graceType = ...`:

```typescript
    beat.fade = doc.effects.fadeIn ? alphaTab.model.FadeType.FadeIn : alphaTab.model.FadeType.None;
    beat.fermata = doc.effects.fermata ? toFermata(doc.effects.fermata) : null;
    beat.crescendo = toCrescendoType(doc.effects.crescendo);
    beat.pickStroke = toPickStroke(doc.effects.pickStroke);
```

`fromBeat`, after `effects.grace = ...`:

```typescript
    // Fade out and volume swell read as no fade in: the model has neither yet.
    effects.fadeIn = beat.fade === alphaTab.model.FadeType.FadeIn;
    effects.fermata = fermataOf(beat.fermata);
    effects.crescendo = crescendoOf(beat.crescendo);
    effects.pickStroke = pickStrokeOf(beat.pickStroke);
```

**Step 4: Run.** Expected: 22 SUCCESS. Type check: no output.

**Step 5: Commit** the four files: `fix: Keep fade in, fermata, crescendo and pick stroke; drop beat staccato`.

### Task A8: Accidentals name the one they force

`AccidentalMode` is `'auto' | 'explicit'`, and `'explicit'` has always meant `ForceSharp` -
so a forced flat on a fretted note saves as a sharp. Nothing in the app writes `'explicit'`;
only `score-doc-mapper.spelling.spec.ts` does, to pin the misnomer. The accidental becomes
the one it forces. `letter` still decides first on a pitched note, exactly as today.

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`AccidentalMode`)
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (a lookup table, `toNote`, `fromNote`, the comment above the accidental in `toNote`)
- Modify: `client/src/app/services/score-doc-mapper.spelling.spec.ts` (the two `'explicit'` specs, lines ~308-342)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A8 -->` with:

```typescript
  for (const accidental of ['doubleFlat', 'flat', 'sharp', 'doubleSharp'] as const) {
    it(`keeps a forced ${accidental} on a fretted note`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].accidental = accidental));

      expect(beatsOf(throughTex(doc))[0].notes[0].accidental).toBe(accidental);
    });
  }

  it('loses a forced accidental on a pre-bent note - alphaTab resets it', () => {
    // `Note.finish` sets `accidentalMode` back to `Default` when the first bend point is
    // above zero, so a pre-bent note cannot keep a forced spelling through a save.
    const doc = guitarBar(beats => {
      beats[0].notes[0].accidental = 'flat';
      beats[0].notes[0].effects.bendPoints = [{ offset: 0, value: 4 }, { offset: 60, value: 4 }];
    });

    expect(beatsOf(throughTex(doc))[0].notes[0].accidental).toBe('auto');
  });

  // <!-- A9 -->
```

The pre-bend spec pins a loss read from alphaTab's source, not yet run: it passes as soon
as the task compiles. If it fails, the forced accidental survived and the fact is wrong -
report it rather than change the assertion.

**Step 2: Run.** Expected: compile error, `Type '"flat"' is not assignable to type 'AccidentalMode'`.

**Step 3: Implement.** In `composer.model.ts`:

```typescript
/**
 * The accidental a note forces, or `auto` to spell from the key signature.
 *
 * Was `'auto' | 'explicit'`, where `'explicit'` always forced a sharp. On a pitched note
 * `NotePitch.letter` still decides first - see `ScoreDocMapperService.toNote`.
 */
export type AccidentalMode = 'auto' | 'doubleFlat' | 'flat' | 'sharp' | 'doubleSharp';
```

In the mapper, below `MODE_BY_ALTER`:

```typescript
/**
 * The forcing mode each `AccidentalMode` asks for. Read both ways, so the directions cannot
 * disagree. `ForceNone` and `ForceNatural` are absent and read back as `auto`: 1.8.0
 * renders `ForceNatural` exactly as `Default` (see `ALTER_BY_MODE`), and the model has no
 * way to ask for either.
 */
const MODE_BY_ACCIDENTAL: ReadonlyMap<AccidentalMode, alphaTab.model.NoteAccidentalMode> = new Map([
  ['doubleFlat', alphaTab.model.NoteAccidentalMode.ForceDoubleFlat],
  ['flat', alphaTab.model.NoteAccidentalMode.ForceFlat],
  ['sharp', alphaTab.model.NoteAccidentalMode.ForceSharp],
  ['doubleSharp', alphaTab.model.NoteAccidentalMode.ForceDoubleSharp]
]);

function accidentalOf(mode: alphaTab.model.NoteAccidentalMode): AccidentalMode {
  for (const [accidental, forced] of MODE_BY_ACCIDENTAL) {
    if (forced === mode) return accidental;
  }
  return 'auto';
}
```

(import `AccidentalMode`). In `toNote`, the comment and ternary become:

```typescript
    // A letter decides the mode; `accidental` only speaks when there is no letter. On a
    // note read back from alphaTab the two agree, because both come from the same mode.
    note.accidentalMode =
      doc.pitch.kind === 'pitched' && doc.pitch.letter !== undefined
        ? accidentalModeFor(doc.pitch.letter, doc.pitch.noteValue)
        : MODE_BY_ACCIDENTAL.get(doc.accidental) ?? alphaTab.model.NoteAccidentalMode.Default;
```

In `fromNote`:

```typescript
      accidental: accidentalOf(note.accidentalMode),
```

In `score-doc-mapper.spelling.spec.ts`, the two specs from `'lets the letter overrule...'`
to the end of `'still forces a sharp...'` become:

```typescript
  it('lets the letter overrule the accidental', () => {
    // A C flat with `accidental: 'sharp'`: the letter decides, and the accidental only
    // speaks without one.
    const doc = buildDoc(
      { kind: 'pitched', noteValue: 11, octave: OCTAVE, letter: 'C' },
      C_MAJOR
    );
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].accidental = 'sharp';

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];

    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceFlat);
  });

  it('forces the accidental it names when there is no letter', () => {
    // Pitch class 6 in B flat major. This was the misnomer's own example: `'explicit'`
    // could only force a sharp, so it engraved F sharp where the key wants G flat.
    const doc = buildDoc({ kind: 'pitched', noteValue: 6, octave: OCTAVE }, B_FLAT_MAJOR);
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].accidental = 'flat';

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];

    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceFlat);
  });
```

**Step 4: Run** both spec files (two `--include` flags). Expected: all SUCCESS.

**Step 5: Commit** the four files: `fix: Make an accidental name the one it forces, so a flat stays a flat`.

### Task A9: Write the double bar, and pin its alphaTex loss

**Files:**
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toMasterBar`)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A9 -->` with:

```typescript
  it('hands a double bar to alphaTab', () => {
    const doc = guitarBar(() => undefined);
    doc.masterBars[0].isDoubleBar = true;

    expect(mapper.toDoc(mapper.toScore(doc, settings)).masterBars[0].isDoubleBar).toBeTrue();
  });

  it('still loses a double bar through alphaTex - an upstream gap', () => {
    // alphaTab 1.8.0 parses `\db` and does not export it. Pinned so that the upgrade which
    // fixes it turns this red, and the known limitation in the design doc gets retired
    // rather than outliving the bug.
    const doc = guitarBar(() => undefined);
    doc.masterBars[0].isDoubleBar = true;

    expect(throughTex(doc).masterBars[0].isDoubleBar).toBeFalse();
  });

  // <!-- A10 -->
```

**Step 2: Run.** Expected: the first FAILS (`Expected false to be true.`); the second passes.

**Step 3: Implement.** In `toMasterBar`, after `masterBar.isFreeTime = doc.isFreeTime;`:

```typescript
    masterBar.isDoubleBar = doc.isDoubleBar;
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit**: `fix: Draw the double bar, and pin that alphaTex does not save it`.

### Task A10: The tempo field works after a load

`toDoc` copies bar 1's tempo automation into `masterBars[0].tempoAutomation`, and
`toMasterBar` prefers that over `doc.tempo`. So once a score has been loaded or applied
from alphaTex, the BPM field changes `doc.tempo` and playback ignores it.

**Files:**
- Modify: `client/src/app/services/score-doc-mapper.service.ts` (`toMasterBar`, `fromMasterBar`)
- Test: `client/src/app/services/score-doc-mapper.effects.spec.ts`

**Step 1: Failing spec.** Replace `// <!-- A10 -->` with:

```typescript
  describe('tempo', () => {
    it('follows the tempo field after a load', () => {
      const loaded = throughTex(guitarBar(() => undefined));
      loaded.tempo = 90;

      expect(mapper.toScore(loaded, settings).tempo).toBe(90);
    });

    it('keeps bar 1 tempo in one place', () => {
      expect(throughTex(guitarBar(() => undefined)).masterBars[0].tempoAutomation).toBeNull();
    });

    it('still keeps a tempo change later in the score', () => {
      const doc = guitarBar(() => undefined);
      doc.masterBars.push({ ...createDefaultMasterBar(), tempoAutomation: 140 });
      doc.tracks[0].staves[0].bars.push(structuredClone(doc.tracks[0].staves[0].bars[0]));

      expect(throughTex(doc).masterBars[1].tempoAutomation).toBe(140);
    });
  });

  // <!-- A11 -->
```

**Step 2: Run.** Expected: 2 FAILED - `Expected 120 to be 90.` and `Expected 120 to be null.`

**Step 3: Implement.** In `toMasterBar`, the tempo line becomes:

```typescript
    // Bar 1's tempo is `ScoreDoc.tempo` and nothing else, so it wins over an automation a
    // loaded document may still carry there.
    const tempo = initialTempo ?? doc.tempoAutomation;
```

In `fromMasterBar`, `tempoAutomation` becomes:

```typescript
      // Bar 1's automation *is* the score tempo, which `toDoc` already reads into
      // `ScoreDoc.tempo`. Copying it here too gave the document two answers, and
      // `toMasterBar` used to believe the stale one.
      tempoAutomation:
        index > 0 && masterBar.tempoAutomations.length > 0
          ? masterBar.tempoAutomations[0].value
          : null,
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit**: `fix: Let the tempo field change playback after a score is loaded`.

### Task A11: `updateScoreInfo` takes score info only

`updateScoreInfo(changes: Partial<ScoreDoc>)` is an `Object.assign`, so a caller can replace
`masterBars` or `tracks` and break the one-bar-per-master-bar invariant. Its one caller
passes `{ title }`. The guard is the type, so there is no runtime spec: the red is a
deliberate compile error you write and then remove.

**Files:**
- Modify: `client/src/app/services/composer.service.ts` (`updateScoreInfo`)
- Delete at the end: the scratch line below

**Step 1: Write the red.** Temporarily add to the end of `composer.service.spec.ts`'s
`describe` body:

```typescript
  // SCRATCH - remove in step 4
  it('scratch', () => service.updateScoreInfo({ tracks: [] }));
```

**Step 2: Type check.** Expected: no error today. That is the bug.

**Step 3: Implement.**

```typescript
  /**
   * Changes the score's descriptive fields. Only those: structure has its own commands,
   * because `masterBars` and `tracks` share an invariant a blind assign could break.
   */
  updateScoreInfo(changes: Partial<Pick<ScoreDoc, 'title' | 'subTitle' | 'artist' | 'album'>>): void {
    this.commit(draft => {
      draft.title = changes.title ?? draft.title;
      draft.subTitle = changes.subTitle ?? draft.subTitle;
      draft.artist = changes.artist ?? draft.artist;
      draft.album = changes.album ?? draft.album;
    });
  }
```

Type check: expected `Object literal may only specify known properties, and 'tracks' does not exist`.

**Step 4: Delete the scratch spec.** Type check: no output.

**Step 5: Commit** `composer.service.ts`: `fix: Stop updateScoreInfo from replacing a score's structure`.

### Task A12: Phase A checkpoint

Remove the trailing `// <!-- A11 -->` marker from the effects spec. Run the whole suite.
Expected: 2,433 plus the new specs, 0 failures. Commit the marker removal with
`test: Close the effects round-trip spec`.

---

## Phase B: bars that fill their gaps and report their overflow

One pure module, `client/src/app/services/bar-fill.ts`, and its spec
`client/src/app/services/bar-fill.spec.ts`. Nothing in Phase B touches the service; Phase D
calls it.

Two rules from the design shape every function here:

- **Gaps fill; overflow is only reported.** Nothing in this module moves a note except
  `fixBarOverflow`, and that runs only when the user presses Fix bar.
- **Measure the way alphaTab plays.** Beats are measured in alphaTab's ticks with its
  truncation, so a bar this module calls full is a bar alphaTab lays out as full - including
  tuplets that do not divide evenly.

Rests are spelled by the transcription quantizer's `slotsToDurations` at a 64th-note grid
(60 ticks a slot), which already splits a span at beat and half-bar boundaries. A gap that is
not a whole number of 64ths - what a lone tuplet leaves - is not spelled at all: the bar stays
reported as under, rather than filled with something that only looks right.

### Task B1: A beat's length, the way alphaTab measures it

alphaTab 1.8.0's `Beat._calculateDuration` is `MidiUtils.toTicks(duration)`, then
`applyDot(ticks, true)` for two dots or `applyDot(ticks, false)` for one, then - when the
beat has a tuplet - `applyTuplet(ticks, tupletNumerator, tupletDenominator)`, which is
`(ticks * denominator / numerator) | 0`. `MidiUtils` is not in the public typings, so this
mirrors it, and a spec holds the mirror to alphaTab's own `Beat.playbackDuration`.

One deliberate difference: alphaTab counts a rest that is the *only* beat in its voice as a
whole bar, whatever its written value. The composer always writes explicit beats, so this
module measures written values and says so.

**Files:**
- Create: `client/src/app/services/bar-fill.ts`
- Create: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs**

```typescript
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { beatTicks } from './bar-fill';
import { BeatDoc, DurationValue, Tuplet, createRestBeat } from '../models/composer.model';

function beatOf(duration: DurationValue, dots = 0, tuplet: Tuplet | null = null): BeatDoc {
  return { ...createRestBeat(duration), dots, tuplet };
}

describe('beatTicks', () => {
  it('gives a quarter 960 ticks', () => {
    expect(beatTicks(beatOf(4))).toBe(960);
  });

  it('adds half again for a dot and three quarters again for two', () => {
    expect(beatTicks(beatOf(4, 1))).toBe(1440);
    expect(beatTicks(beatOf(4, 2))).toBe(1680);
  });

  it('scales a triplet eighth to 320', () => {
    expect(beatTicks(beatOf(8, 0, { numerator: 3, denominator: 2 }))).toBe(320);
  });

  it('agrees with alphaTab on every value, dot and tuplet the palette can write', () => {
    // The septuplet is the case that matters: 240 * 4 / 7 truncates, and a mirror that
    // rounded instead would call a bar full that alphaTab lays out one tick short.
    TestBed.configureTestingModule({});
    const mapper = TestBed.inject(ScoreDocMapperService);
    const beats = [
      beatOf(1), beatOf(2, 1), beatOf(4, 2), beatOf(64),
      beatOf(8, 0, { numerator: 3, denominator: 2 }),
      beatOf(16, 1, { numerator: 5, denominator: 4 }),
      beatOf(16, 0, { numerator: 7, denominator: 4 }),
      beatOf(32, 2, { numerator: 3, denominator: 2 })
    ];
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = beats;

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const played = score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.playbackDuration);

    expect(beats.map(beatTicks)).toEqual(played);
  });
});
```

**Step 2: Run** `--include=src/app/services/bar-fill.spec.ts`. Expected: compile error,
`Cannot find module './bar-fill'`.

**Step 3: Implement** `bar-fill.ts`:

```typescript
import { BeatDoc, TimeSignature } from '../models/composer.model';

/**
 * Bar arithmetic for the composer: how full a bar is, filling its gaps with rests, and
 * carrying its overflow into the next bar when the user asks.
 *
 * Everything is measured in alphaTab's ticks with alphaTab's truncation, so this module and
 * the renderer cannot disagree about whether a bar is full. See "Bar filling" in
 * docs/plans/2026-09-13-composer-editor-design.md for why gaps fill and overflow does not.
 */

/** alphaTab's `MidiUtils.QuarterTime`. */
export const TICKS_PER_QUARTER = 960;

/**
 * A beat's written length in ticks, as alphaTab 1.8.0's `Beat._calculateDuration` computes
 * it: the value, then its dots, then its tuplet, truncating at each step.
 *
 * Unlike alphaTab, a rest that is the only beat in its voice is measured at its written
 * value rather than as a whole bar - the composer never relies on that shorthand.
 */
export function beatTicks(beat: Pick<BeatDoc, 'duration' | 'dots' | 'tuplet'>): number {
  const value = beat.duration < 0 ? 1 / -beat.duration : beat.duration;
  let ticks = (TICKS_PER_QUARTER * (4 / value)) | 0;

  if (beat.dots === 2) ticks = ticks + ((ticks / 4) | 0) * 3;
  else if (beat.dots === 1) ticks = ticks + ((ticks / 2) | 0);

  if (beat.tuplet) ticks = ((ticks * beat.tuplet.denominator) / beat.tuplet.numerator) | 0;
  return ticks;
}
```

`TimeSignature` is imported for Task B2; if the linter objects to it being unused for one
commit, leave it out here and add it there.

**Step 4: Run.** Expected: 4 SUCCESS.

**Step 5: Commit** both files: `feat: Measure a beat in alphaTab's ticks, held to alphaTab by a spec`.

### Task B2: How full a bar is

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add to `bar-fill.spec.ts` (extend its imports with `barFillOf`,
`scoreBarFills`, `createDefaultBar`, `createDefaultMasterBar`, `ComposerService`):

```typescript
describe('barFillOf', () => {
  const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

  it('calls a bar of four quarters full in 4/4', () => {
    expect(barFillOf(createDefaultBar(false, FOUR_FOUR), FOUR_FOUR)).toEqual({ kind: 'full' });
  });

  it('reports a short bar by how much', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 8;

    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'under', ticks: 480 });
  });

  it('reports an overfull bar by how much', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 2;

    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'over', ticks: 960 });
  });

  it('measures 6/8 in its own units', () => {
    const sixEight = { numerator: 6, denominator: 8, isCommon: false };

    expect(barFillOf(createDefaultBar(false, sixEight), sixEight)).toEqual({ kind: 'full' });
  });
});

describe('scoreBarFills', () => {
  it('reads every bar of every staff against the meter in force there', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[2].voices[0].beats[0].duration = 2;

    const fills = scoreBarFills(doc);

    expect(fills[0][0].map(fill => fill.kind)).toEqual(['full', 'full', 'over', 'full']);
  });

  it('calls a free-time bar full whatever it holds', () => {
    // Free time is the score saying the meter does not govern this bar.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isFreeTime = true;
    doc.tracks[0].staves[0].bars[1].voices[0].beats[0].duration = 1;

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });
});
```

**Step 2: Run** `--include=src/app/services/bar-fill.spec.ts`. Expected: compile error, the
functions do not exist.

**Step 3: Implement.** Append to `bar-fill.ts` (extend imports with `BarDoc`, `ScoreDoc`,
`VoiceDoc`, `effectiveTimeSignature`):

```typescript
/** How a bar's contents compare with its meter. */
export type BarFill =
  | { kind: 'full' }
  | { kind: 'under'; ticks: number }
  | { kind: 'over'; ticks: number };

/** A bar's capacity in ticks under `timeSignature`. */
export function barCapacityTicks(timeSignature: TimeSignature): number {
  return ((TICKS_PER_QUARTER * 4 * timeSignature.numerator) / timeSignature.denominator) | 0;
}

/** The ticks a voice's beats add up to. */
export function voiceTicks(voice: VoiceDoc): number {
  return voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
}

/**
 * How full `bar` is under `timeSignature`.
 *
 * Voice 1 only. It is the only voice the composer writes, and multiple voices are listed
 * beyond M4 in the design; when they arrive, this answers for the fullest voice.
 */
export function barFillOf(bar: BarDoc, timeSignature: TimeSignature): BarFill {
  const voice = bar.voices[0];
  const difference = (voice ? voiceTicks(voice) : 0) - barCapacityTicks(timeSignature);
  if (difference === 0) return { kind: 'full' };
  return difference < 0 ? { kind: 'under', ticks: -difference } : { kind: 'over', ticks: difference };
}

/**
 * Every bar's fill, indexed `[track][staff][bar]`, each read against the meter in force
 * at that bar. A free-time bar is full by definition.
 */
export function scoreBarFills(doc: ScoreDoc): BarFill[][][] {
  return doc.tracks.map(track =>
    track.staves.map(staff =>
      staff.bars.map((bar, index) =>
        doc.masterBars[index]?.isFreeTime
          ? { kind: 'full' }
          : barFillOf(bar, effectiveTimeSignature(doc.masterBars, index))
      )
    )
  );
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: Measure how full every bar is, in alphaTab's ticks`.

### Task B3: Fill a bar's gap with rests

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add (import `fillBarGaps`, `createRestBeat`):

```typescript
describe('fillBarGaps', () => {
  const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
  const shape = (bar: BarDoc): string[] =>
    bar.voices[0].beats.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);

  it('fills a shortened beat\'s gap at the end of the bar', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 8;

    fillBarGaps(bar, FOUR_FOUR);

    expect(shape(bar)).toEqual(['r8', 'r4', 'r4', 'r4', 'r8']);
  });

  it('spells a long gap on the beat, not as one odd value', () => {
    // Half a bar of 4/4 is a half rest, at the half-bar, where the ear expects it.
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats = [createRestBeat(2)];

    fillBarGaps(bar, FOUR_FOUR);

    expect(shape(bar)).toEqual(['r2', 'r2']);
  });

  it('fills 6/8 in dotted quarters', () => {
    const sixEight = { numerator: 6, denominator: 8, isCommon: false };
    const bar = createDefaultBar(false, sixEight);
    bar.voices[0].beats = [{ ...createRestBeat(4), dots: 1 }];

    fillBarGaps(bar, sixEight);

    expect(shape(bar)).toEqual(['r4.', 'r4.']);
  });

  it('leaves a gap it cannot spell exactly, rather than guess', () => {
    // One triplet eighth is 320 ticks, not a whole number of 64ths.
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats = [{ ...createRestBeat(8), tuplet: { numerator: 3, denominator: 2 } }];

    fillBarGaps(bar, FOUR_FOUR);

    expect(bar.voices[0].beats.length).toBe(1);
    expect(barFillOf(bar, FOUR_FOUR).kind).toBe('under');
  });

  it('leaves a full or overfull bar alone', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats[0].duration = 2;

    fillBarGaps(bar, FOUR_FOUR);

    expect(shape(bar)).toEqual(['r2', 'r4', 'r4', 'r4']);
  });
});
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts`, importing `slotsToDurations`, `metricFrame`
and `barGridFault` from `./transcription-quantize`, and `createRestBeat` from the model:

```typescript
/** A 64th note: the finest value the rest speller writes. */
const SLOT_DIVISION = 64;
const SLOT_TICKS = TICKS_PER_QUARTER / 16;

/**
 * Appends rests to the end of `bar` until it is full, when that can be done exactly.
 *
 * The gap goes at the end because that is where shortening a beat leaves it: every later
 * beat moves earlier. Rests are spelled at a 64th grid, split at beat and half-bar lines by
 * the quantizer's own speller. Nothing happens when the bar is full or over, when the meter
 * has no 64th grid, or when the gap or its start is not a whole number of 64ths - a lone
 * tuplet's remainder - because a fill that is only nearly right is worse than a bar still
 * honestly reported as under.
 */
export function fillBarGaps(bar: BarDoc, timeSignature: TimeSignature): void {
  const fill = barFillOf(bar, timeSignature);
  const voice = bar.voices[0];
  if (fill.kind !== 'under' || !voice) return;
  if (barGridFault(timeSignature, SLOT_DIVISION) !== null) return;

  const used = voiceTicks(voice);
  if (used % SLOT_TICKS !== 0 || fill.ticks % SLOT_TICKS !== 0) return;

  const frame = metricFrame(timeSignature, SLOT_DIVISION / timeSignature.denominator);
  const units = slotsToDurations(fill.ticks / SLOT_TICKS, SLOT_DIVISION, used / SLOT_TICKS, frame);
  for (const unit of units) {
    voice.beats.push({ ...createRestBeat(unit.duration), dots: unit.dots });
  }
}
```

**Step 4: Run.** Expected: all SUCCESS. If `fills 6/8 in dotted quarters` fails with two
separate values, read `MAX_WRITTEN_DOTS` in `transcription-quantize.ts`: the speller must be
allowed one dot. It is at the time of writing.

**Step 5: Commit**: `feat: Fill the gap a shortened beat leaves with rests`.

### Task B4: A lengthened beat takes the rests after it

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add (import `absorbFollowingRests`, `NoteDoc`,
`createDefaultNoteEffects`):

```typescript
describe('absorbFollowingRests', () => {
  const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };
  const note = (): NoteDoc => ({
    pitch: { kind: 'pitched', noteValue: 0, octave: 4 },
    isTied: false,
    accidental: 'auto',
    effects: createDefaultNoteEffects()
  });

  it('removes the rests a lengthened beat now covers', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    const [first] = bar.voices[0].beats;
    first.duration = 2;

    const left = absorbFollowingRests(bar.voices[0], first, 960, new Set());

    expect(left).toBe(0);
    expect(bar.voices[0].beats.length).toBe(3);
  });

  it('stops at a note and reports what it could not take', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    const beats = bar.voices[0].beats;
    beats[1] = { ...beats[1], isRest: false, notes: [note()] };
    beats[0].duration = 2;

    const left = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set());

    expect(left).toBe(960);
    expect(bar.voices[0].beats.length).toBe(4);
  });

  it('never takes a beat that is itself being changed', () => {
    // Pressing a half on four selected quarters makes four halves, not one.
    const bar = createDefaultBar(false, FOUR_FOUR);
    const beats = bar.voices[0].beats;

    const left = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set(beats));

    expect(left).toBe(960);
    expect(bar.voices[0].beats.length).toBe(4);
  });

  it('takes a longer rest whole, leaving the difference as a gap to fill', () => {
    const bar = createDefaultBar(false, FOUR_FOUR);
    bar.voices[0].beats = [createRestBeat(4), createRestBeat(2), createRestBeat(4)];
    bar.voices[0].beats[0].duration = 2;

    const left = absorbFollowingRests(bar.voices[0], bar.voices[0].beats[0], 960, new Set());
    fillBarGaps(bar, FOUR_FOUR);

    expect(left).toBe(0);
    expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
  });
});
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts` (import `BeatDoc` if not already):

```typescript
/**
 * Removes rests after `beat` in `voice` until `ticks` are covered, and returns the ticks it
 * could not cover.
 *
 * It stops at the first note - the design's line: lengthening consumes only following
 * rests, and anything that would overwrite a note is left as overflow for the user to
 * see. It also stops at any beat in `changing`, so a range pressed together is changed
 * together rather than one beat eating its neighbours. A rest longer than what is left is
 * taken whole; the caller's `fillBarGaps` puts the difference back. Beats are held by
 * identity, not index, because every removal shifts the indices after it.
 */
export function absorbFollowingRests(
  voice: VoiceDoc,
  beat: BeatDoc,
  ticks: number,
  changing: ReadonlySet<BeatDoc>
): number {
  let remaining = ticks;
  let index = voice.beats.indexOf(beat) + 1;
  if (index === 0) return remaining;

  while (remaining > 0 && index < voice.beats.length) {
    const next = voice.beats[index];
    if (!next.isRest || changing.has(next)) break;
    remaining -= beatTicks(next);
    voice.beats.splice(index, 1);
  }
  return Math.max(0, remaining);
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit**: `feat: Let a lengthened beat take the rests after it, and no notes`.

### Task B5: Lift bar insertion out of the service

Fix bar sometimes has to append a bar, and `ComposerService.insertBar` is the only code that
knows how - including the bar-1 time signature rule from a7f61ba. It moves into a pure
function both can call. This is a refactor: the specs that already pin `insertBar`
(`composer.service.spec.ts`, `composer.service.generated.spec.ts`) are the safety net, and
one new spec pins the function's own contract.

**Files:**
- Create: `client/src/app/services/score-structure.ts`
- Create: `client/src/app/services/score-structure.spec.ts`
- Modify: `client/src/app/services/composer.service.ts` (`insertBar`, imports)

**Step 1: Failing spec** `score-structure.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { insertBarInto } from './score-structure';
import { effectiveTimeSignature } from '../models/composer.model';

describe('insertBarInto', () => {
  it('appends a bar to every staff of every track, in the meter in force', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    const at = insertBarInto(doc, doc.masterBars.length);

    expect(at).toBe(4);
    expect(doc.masterBars.length).toBe(5);
    for (const track of doc.tracks) {
      expect(track.staves[0].bars.length).toBe(5);
      expect(track.staves[0].bars[4].voices[0].beats.length).toBe(3);
    }
    expect(effectiveTimeSignature(doc.masterBars, 4).numerator).toBe(3);
  });

  it('clamps an index past the end to an append', () => {
    const doc = ComposerService.createEmptyScore();

    expect(insertBarInto(doc, 99)).toBe(4);
  });
});
```

**Step 2: Run** `--include=src/app/services/score-structure.spec.ts`. Expected: compile error.

**Step 3: Implement** `score-structure.ts`, moving the body and the docstring of
`insertBar` across verbatim apart from the clamp:

```typescript
import {
  ScoreDoc,
  createDefaultBar,
  createDefaultMasterBar,
  effectiveTimeSignature
} from '../models/composer.model';

/**
 * Inserts a bar at `index` across every track, preserving the invariant that the timeline
 * is shared, and returns the index it used after clamping.
 *
 * A new first bar takes over bar 1's time signature declaration. Anywhere else a fresh
 * master bar declaring nothing inherits the meter in force, but bar 1 has nothing to inherit
 * from, and `effectiveTimeSignature` answers an undeclared bar 1 with 4/4 - which is
 * `scoreMeter`, and so the guard on `sendProgression`. The displaced bar drops a declaration
 * that now repeats the meter already in force, so a uniform score does not gain a meter
 * change at bar 2: the shape the mapper reads a loaded file into.
 *
 * Pure apart from mutating `doc`, so the service and Fix bar share one definition of what
 * inserting a bar means. Divergence of generated tracks is the caller's to stamp - it is
 * a fact about commands, not about bars.
 */
export function insertBarInto(doc: ScoreDoc, index: number): number {
  const at = Math.max(0, Math.min(doc.masterBars.length, index));
  const masterBar = createDefaultMasterBar();
  const displaced = doc.masterBars[at];
  if (at === 0 && displaced) {
    masterBar.timeSignature = effectiveTimeSignature(doc.masterBars, 0);
    displaced.timeSignature = null;
  }
  doc.masterBars.splice(at, 0, masterBar);
  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      const template = staff.bars[Math.min(at, staff.bars.length - 1)];
      const bar = createDefaultBar(staff.showTablature, effectiveTimeSignature(doc.masterBars, at));
      if (template) {
        bar.clef = template.clef;
        bar.clefOttava = template.clefOttava;
        bar.keySignature = { ...template.keySignature };
      }
      staff.bars.splice(at, 0, bar);
    }
  }
  return at;
}
```

In `composer.service.ts`, `insertBar` becomes (import `insertBarInto`; drop the imports the
move left unused, which the type check will name):

```typescript
  /** Inserts a bar at `index` across every track. See `insertBarInto`. */
  insertBar(index: number): void {
    this.commit(draft => {
      insertBarInto(draft, index);
      this.markDiverged(draft);
    });
  }
```

**Step 4: Run** `score-structure.spec.ts`, `composer.service.spec.ts` and
`composer.service.generated.spec.ts` together (three `--include` flags). Expected: all SUCCESS.

**Step 5: Commit** the three files: `refactor: Lift bar insertion into a function Fix bar can share`.

### Task B6: Fix bar

The one function in this module that moves music, and it runs only on request. It splits
the beat that crosses the bar line, ties the part past the line into the next bar, carries
any whole beats past the line with it, and makes room there by taking trailing rests. If the
next bar has no rests to give, it is now over too, and the carry continues. It appends a bar
only when the carry runs off the end of the score.

It refuses - and says why - when the split cannot be spelled exactly: a tuplet across the
bar line. It may have changed `doc` by then, so **call it on a draft you can discard**;
Task D3 does.

What a tied continuation carries: the same pitches, `isTied` set (the model's tie flag
marks the note a tie *arrives* at), and no effects. A tied note is not struck again, so an
accent or a hammer-on on its continuation would be a second attack the player never made.

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add (import `fixBarOverflow`, `NoteDoc`, `createDefaultNoteEffects`):

```typescript
describe('fixBarOverflow', () => {
  const fretNote = (): NoteDoc => ({
    pitch: { kind: 'fretted', string: 1, fret: 0 },
    isTied: false,
    accidental: 'auto',
    effects: { ...createDefaultNoteEffects(), accent: 'normal' }
  });
  const noteBeat = (duration: DurationValue): BeatDoc => ({
    ...createRestBeat(duration),
    isRest: false,
    notes: [fretNote()]
  });
  const shape = (doc: ScoreDoc, bar: number): string[] =>
    doc.tracks[0].staves[0].bars[bar].voices[0].beats.map(beat =>
      `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}${beat.notes[0]?.isTied ? '~' : ''}`);

  it('splits a beat across the bar line and ties the rest into the next bar', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2)];

    const result = fixBarOverflow(doc, 0, 0, 0);

    expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
    expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
    expect(shape(doc, 1)).toEqual(['n4~', 'r4', 'r4', 'r4']);
  });

  it('gives the tied continuation the pitch and not the attack', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2)];

    fixBarOverflow(doc, 0, 0, 0);

    const tail = doc.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0];
    expect(tail.pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
    expect(tail.effects.accent).toBe('none');
  });

  it('carries whole beats past the line without splitting them', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

    fixBarOverflow(doc, 0, 0, 0);

    expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
    expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4']);
  });

  it('carries on into the next bar when that one has no rests to give', () => {
    const doc = ComposerService.createEmptyScore();
    const bars = doc.tracks[0].staves[0].bars;
    bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
    bars[1].voices[0].beats = [4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

    fixBarOverflow(doc, 0, 0, 0);

    expect(scoreBarFills(doc)[0][0].map(fill => fill.kind)).toEqual(['full', 'full', 'full', 'full']);
    expect(shape(doc, 2)).toEqual(['n4', 'r4', 'r4', 'r4']);
  });

  it('appends a bar only when the carry runs off the end', () => {
    const doc = ComposerService.createEmptyScore();
    const last = doc.tracks[0].staves[0].bars[3];
    last.voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

    const result = fixBarOverflow(doc, 0, 0, 3);

    expect(result).toEqual({ kind: 'fixed', appendedBars: 1 });
    expect(doc.masterBars.length).toBe(5);
    expect(shape(doc, 4)).toEqual(['n4', 'r4', 'r4', 'r4']);
  });

  it('refuses a bar that is not over', () => {
    const doc = ComposerService.createEmptyScore();

    expect(fixBarOverflow(doc, 0, 0, 0).kind).toBe('refused');
  });

  it('refuses to split a tuplet across the bar line', () => {
    // Three quarters, a triplet eighth, then a quarter that starts 640 ticks before the
    // line: 640 is not a whole number of 64ths, so no written value can be the head.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [
      noteBeat(4), noteBeat(4), noteBeat(4),
      { ...noteBeat(8), tuplet: { numerator: 3, denominator: 2 } },
      noteBeat(4)
    ];

    const result = fixBarOverflow(doc, 0, 0, 0);

    expect(result.kind).toBe('refused');
  });
});
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** First, pull the spelling out of `fillBarGaps` so both use it. Add
above `fillBarGaps` (import `DurationUnit` from `./transcription-quantize`):

```typescript
/**
 * `ticks` spelled as written values starting `startTicks` into a bar of `timeSignature`,
 * split at beat and half-bar lines - or null when that cannot be done exactly.
 */
function spelledTicks(ticks: number, startTicks: number, timeSignature: TimeSignature): DurationUnit[] | null {
  if (ticks % SLOT_TICKS !== 0 || startTicks % SLOT_TICKS !== 0) return null;
  if (barGridFault(timeSignature, SLOT_DIVISION) !== null) return null;

  const frame = metricFrame(timeSignature, SLOT_DIVISION / timeSignature.denominator);
  return slotsToDurations(ticks / SLOT_TICKS, SLOT_DIVISION, startTicks / SLOT_TICKS, frame);
}
```

and make `fillBarGaps` use it:

```typescript
export function fillBarGaps(bar: BarDoc, timeSignature: TimeSignature): void {
  const fill = barFillOf(bar, timeSignature);
  const voice = bar.voices[0];
  if (fill.kind !== 'under' || !voice) return;

  const units = spelledTicks(fill.ticks, voiceTicks(voice), timeSignature) ?? [];
  for (const unit of units) {
    voice.beats.push({ ...createRestBeat(unit.duration), dots: unit.dots });
  }
}
```

Run the spec file: the Task B3 specs must still pass.

Then append (import `insertBarInto` from `./score-structure`, `createDefaultNoteEffects`
from the model):

```typescript
/** What Fix bar did: how many bars it had to add, or why it did nothing. */
export type FixBarResult =
  | { kind: 'fixed'; appendedBars: number }
  | { kind: 'refused'; reason: string };

const TUPLET_ACROSS_LINE =
  'A tuplet crosses the bar line, so no written value can split it. Shorten it until the bar fits.';

/**
 * Carries the overflow of bar `barIndex` on one staff into the bars after it, tied, until
 * a bar it reaches is no longer over. See the section comment above Task B6 in the M1 plan
 * for what a continuation carries.
 *
 * **May leave `doc` partly changed when it refuses.** Call it on a draft you can discard.
 */
export function fixBarOverflow(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  barIndex: number
): FixBarResult {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff?.bars[barIndex]) return { kind: 'refused', reason: 'There is no bar there.' };

  let appendedBars = 0;
  for (let index = barIndex; index < staff.bars.length; index++) {
    const timeSignature = effectiveTimeSignature(doc.masterBars, index);
    const bar = staff.bars[index];
    const over = !doc.masterBars[index].isFreeTime && barFillOf(bar, timeSignature).kind === 'over';

    if (!over) {
      if (index === barIndex) {
        return { kind: 'refused', reason: 'That bar is not over its time signature.' };
      }
      fillBarGaps(bar, timeSignature);
      return { kind: 'fixed', appendedBars };
    }

    const carried = beatsPastBarLine(
      bar.voices[0],
      timeSignature,
      effectiveTimeSignature(doc.masterBars, index + 1)
    );
    if (carried === null) return { kind: 'refused', reason: TUPLET_ACROSS_LINE };

    if (index === staff.bars.length - 1) {
      insertBarInto(doc, staff.bars.length);
      appendedBars++;
    }

    const next = staff.bars[index + 1].voices[0];
    next.beats.unshift(...carried);
    takeTrailingRests(next, carried.reduce((sum, beat) => sum + beatTicks(beat), 0));
  }
  return { kind: 'fixed', appendedBars };
}

/**
 * Cuts `voice` at its bar line and returns what lay past it: the tied tail of the beat that
 * crossed the line, then every later beat whole. Returns null, leaving `voice` untouched,
 * when the crossing beat cannot be split into written values.
 */
function beatsPastBarLine(
  voice: VoiceDoc,
  timeSignature: TimeSignature,
  nextTimeSignature: TimeSignature
): BeatDoc[] | null {
  const capacity = barCapacityTicks(timeSignature);
  let start = 0;

  for (let index = 0; index < voice.beats.length; index++) {
    const beat = voice.beats[index];
    const end = start + beatTicks(beat);
    if (end <= capacity) {
      start = end;
      continue;
    }

    if (start >= capacity) return voice.beats.splice(index);

    const head = spelledTicks(capacity - start, start, timeSignature);
    const tail = spelledTicks(end - capacity, 0, nextTimeSignature);
    if (!head || !tail) return null;

    const after = voice.beats.splice(index + 1);
    voice.beats.splice(index, 1, ...piecesOf(beat, head, false));
    return [...piecesOf(beat, tail, true), ...after];
  }
  return [];
}

/**
 * `beat` rewritten as one beat per written value. The first piece of the head is the beat
 * itself, re-valued, so its effects and attack stay where they were struck; every other
 * piece is a tied continuation - same pitches, `isTied`, no effects.
 */
function piecesOf(beat: BeatDoc, units: DurationUnit[], isTail: boolean): BeatDoc[] {
  return units.map((unit, index): BeatDoc => {
    if (index === 0 && !isTail) {
      return { ...structuredClone(beat), duration: unit.duration, dots: unit.dots, tuplet: null };
    }
    return {
      ...createRestBeat(unit.duration),
      dots: unit.dots,
      isRest: beat.isRest,
      notes: beat.notes.map(note => ({
        ...structuredClone(note),
        isTied: true,
        effects: createDefaultNoteEffects()
      }))
    };
  });
}

/** Removes rests from the end of `voice` until `ticks` are covered or a note is reached. */
function takeTrailingRests(voice: VoiceDoc, ticks: number): void {
  let remaining = ticks;
  while (remaining > 0 && voice.beats.length > 0) {
    const last = voice.beats[voice.beats.length - 1];
    if (!last.isRest) return;
    remaining -= beatTicks(last);
    voice.beats.pop();
  }
}
```

**Step 4: Run.** Expected: all SUCCESS. If `carries on into the next bar` fails, check that
the loop re-reads `staff.bars.length` each pass - an append inside the loop must extend it.

**Step 5: Commit**: `feat: Fix bar - carry a bar's overflow into the next, tied`.

### Task B7: Phase B checkpoint

Run the whole suite. Expected: all green. No commit unless something needed fixing.

---

## Phase C: a selection, and the edits that act on it

Four modules of edit functions plus the selection they read. Every function takes a
`ScoreDoc` it may change and the beats to change; none reads service state. Phase D wires
them into `ComposerService`.

The names Phase D relies on, so the two phases can be read in either order:

| Module | Exports |
|---|---|
| `composer-selection.ts` | `BeatRef`, `selectionTargets`, `selectedBars`, `beatAt` |
| `beat-edits.ts` | `toggledValue`, `beatsAt`, `toggleBeatEffect`, `setDynamics`, `setBeatDurations`, `setTuplet` |
| `note-edits.ts` | `notesAt`, `toggleNoteEffect`, `setAccidental`, `toggleTie` |
| `edit-refusals.ts` | `EditScope`, `editRefusal` |
| `bar-edits.ts` | `timeSignatureFault`, `keySignatureFault`, `setTimeSignature`, `setKeySignature`, `setClef`, `toggleMasterBarFlag`, `setMasterBarValue` |
| `track-edits.ts` | `setStaffTuning`, `setStaffNumber`, `setStaffViews`, `setPlayback`, `renameTrack` |

### Task C1: The selection in state, and what it covers

**Files:**
- Modify: `client/src/app/models/composer.model.ts` (`ComposerState`)
- Modify: `client/src/app/services/composer.service.ts` (constructor and `reset`: the two new fields)
- Create: `client/src/app/services/composer-selection.ts`
- Create: `client/src/app/services/composer-selection.spec.ts`

**Step 1: Failing specs** `composer-selection.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { selectedBars, selectionTargets } from './composer-selection';
import { EditCursor } from '../models/composer.model';

describe('selectionTargets', () => {
  const at = (barIndex: number, beatIndex: number, trackIndex = 0): EditCursor => ({
    trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex: 0
  });
  const positions = (refs: { barIndex: number; beatIndex: number; trackIndex: number }[]): string[] =>
    refs.map(ref => `${ref.trackIndex}:${ref.barIndex}.${ref.beatIndex}`);

  it('is the caret alone when there is no anchor', () => {
    const doc = ComposerService.createEmptyScore();

    expect(positions(selectionTargets(doc, null, at(1, 2)))).toEqual(['0:1.2']);
  });

  it('runs from anchor to head in timeline order, whichever was clicked first', () => {
    const doc = ComposerService.createEmptyScore();

    expect(positions(selectionTargets(doc, at(1, 1), at(0, 3)))).toEqual(['0:0.3', '0:1.0', '0:1.1']);
  });

  it('covers whole bars on every track between two tracks', () => {
    // Guitar Pro's multitrack selection: a rectangle of bars, not a ragged run of beats.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    const refs = selectionTargets(doc, at(1, 3, 0), at(2, 0, 1));

    expect(refs.length).toBe(2 * 2 * 4);
    expect(positions(refs).slice(0, 5)).toEqual(['0:1.0', '0:1.1', '0:1.2', '0:1.3', '0:2.0']);
  });

  it('is empty when the head names no beat', () => {
    const doc = ComposerService.createEmptyScore();

    expect(selectionTargets(doc, null, at(9, 0))).toEqual([]);
  });
});

describe('selectedBars', () => {
  it('spans the bars between the two ends, in order', () => {
    const cursor = (barIndex: number): EditCursor =>
      ({ trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex: 0, stringIndex: null });

    expect(selectedBars(cursor(3), cursor(1))).toEqual({ first: 1, last: 3 });
    expect(selectedBars(null, cursor(2))).toEqual({ first: 2, last: 2 });
  });
});
```

**Step 2: Run** `--include=src/app/services/composer-selection.spec.ts`. Expected: compile error.

**Step 3: Implement.** In `ComposerState` (model), after `cursor`:

```typescript
  /**
   * The fixed end of a range selection; `cursor` is the end that moves. null means the
   * selection is the caret alone. See `selectionTargets` for what a range covers.
   */
  anchor: EditCursor | null;
  /** Why the last command did nothing, for the status line. The next edit clears it. */
  refusal: string | null;
```

In `ComposerService`, both state literals (constructor and `reset`) gain
`anchor: null,` and `refusal: null,` after `cursor`.

`composer-selection.ts`:

```typescript
import { BeatDoc, EditCursor, ScoreDoc } from '../models/composer.model';

/** One beat, addressed: the parts of an `EditCursor` that name a beat. */
export interface BeatRef {
  trackIndex: number;
  staffIndex: number;
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
}

/** The beat `ref` names, or null. */
export function beatAt(doc: ScoreDoc, ref: BeatRef): BeatDoc | null {
  return (
    doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex]
      ?.beats[ref.beatIndex] ?? null
  );
}

/**
 * The beats a command acts on, in timeline order.
 *
 * With no anchor, the caret's beat. With both ends on one staff, every beat between them in
 * the caret's voice, across bar lines. With the ends on different tracks or staves, whole
 * bars from the earlier end's bar to the later's, on every staff of every track between -
 * Guitar Pro's multitrack selection, which is a rectangle because bars are the only unit two
 * tracks share.
 */
export function selectionTargets(doc: ScoreDoc, anchor: EditCursor | null, head: EditCursor): BeatRef[] {
  if (!anchor) return beatAt(doc, head) ? [refOf(head)] : [];

  if (anchor.trackIndex === head.trackIndex && anchor.staffIndex === head.staffIndex) {
    const [from, to] = inTimelineOrder(anchor, head);
    return beatsBetween(doc, from, to, head.voiceIndex);
  }
  return barRectangle(doc, anchor, head);
}

/** The bars a selection spans, first to last. */
export function selectedBars(anchor: EditCursor | null, head: EditCursor): { first: number; last: number } {
  const other = anchor ?? head;
  return {
    first: Math.min(other.barIndex, head.barIndex),
    last: Math.max(other.barIndex, head.barIndex)
  };
}

function refOf(cursor: EditCursor): BeatRef {
  return {
    trackIndex: cursor.trackIndex,
    staffIndex: cursor.staffIndex,
    barIndex: cursor.barIndex,
    voiceIndex: cursor.voiceIndex,
    beatIndex: cursor.beatIndex
  };
}

function inTimelineOrder(a: EditCursor, b: EditCursor): [EditCursor, EditCursor] {
  const aFirst = a.barIndex < b.barIndex || (a.barIndex === b.barIndex && a.beatIndex <= b.beatIndex);
  return aFirst ? [a, b] : [b, a];
}

function beatsBetween(doc: ScoreDoc, from: EditCursor, to: EditCursor, voiceIndex: number): BeatRef[] {
  const staff = doc.tracks[from.trackIndex]?.staves[from.staffIndex];
  const refs: BeatRef[] = [];
  if (!staff) return refs;

  for (let barIndex = from.barIndex; barIndex <= to.barIndex; barIndex++) {
    const beats = staff.bars[barIndex]?.voices[voiceIndex]?.beats ?? [];
    const first = barIndex === from.barIndex ? from.beatIndex : 0;
    const last = Math.min(barIndex === to.barIndex ? to.beatIndex : beats.length - 1, beats.length - 1);
    for (let beatIndex = first; beatIndex <= last; beatIndex++) {
      refs.push({ trackIndex: from.trackIndex, staffIndex: from.staffIndex, barIndex, voiceIndex, beatIndex });
    }
  }
  return refs;
}

function barRectangle(doc: ScoreDoc, a: EditCursor, b: EditCursor): BeatRef[] {
  const refs: BeatRef[] = [];
  const firstBar = Math.min(a.barIndex, b.barIndex);
  const lastBar = Math.max(a.barIndex, b.barIndex);

  for (let trackIndex = Math.min(a.trackIndex, b.trackIndex); trackIndex <= Math.max(a.trackIndex, b.trackIndex); trackIndex++) {
    doc.tracks[trackIndex]?.staves.forEach((staff, staffIndex) => {
      for (let barIndex = firstBar; barIndex <= lastBar; barIndex++) {
        staff.bars[barIndex]?.voices[0]?.beats.forEach((_, beatIndex) => {
          refs.push({ trackIndex, staffIndex, barIndex, voiceIndex: 0, beatIndex });
        });
      }
    });
  }
  return refs;
}
```

**Step 4: Run** the new spec and `composer.service.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit** the four files: `feat: Put a range selection in the composer's state`.

### Task C2: Beat edits, and the toggle rule

**Files:**
- Create: `client/src/app/services/beat-edits.ts`
- Create: `client/src/app/services/beat-edits.spec.ts`

**Step 1: Failing specs** `beat-edits.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { setBeatDurations, setTuplet, toggleBeatEffect, toggledValue } from './beat-edits';
import { scoreBarFills } from './bar-fill';
import { ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (barIndex: number, beatIndex: number): BeatRef =>
  ({ trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });
const beats = (doc: ScoreDoc, bar = 0) => doc.tracks[0].staves[0].bars[bar].voices[0].beats;

describe('toggledValue', () => {
  it('turns on when any target lacks the value', () => {
    expect(toggledValue([true, false], true, false)).toBeTrue();
  });

  it('turns off when every target has it', () => {
    expect(toggledValue(['wide', 'wide'], 'wide', 'none')).toBe('none');
  });

  it('compares structured values by content', () => {
    expect(toggledValue([{ type: 'long', length: 1 }], { type: 'long', length: 1 }, null)).toBeNull();
  });
});

describe('toggleBeatEffect', () => {
  it('sets every beat in the range when the range is mixed', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc)[1].effects.fadeIn = true;

    toggleBeatEffect(doc, [ref(0, 0), ref(0, 1)], 'fadeIn', true, false);

    expect(beats(doc).slice(0, 2).map(beat => beat.effects.fadeIn)).toEqual([true, true]);
  });
});

describe('setBeatDurations', () => {
  const withNote = (doc: ScoreDoc, bar: number, beat: number): void => {
    const target = beats(doc, bar)[beat];
    target.isRest = false;
    target.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  };

  it('fills the gap when a beat gets shorter', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 8, 0);

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
    expect(beats(doc).length).toBe(5);
  });

  it('takes the following rests when a beat gets longer', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 4, 4]);
  });

  it('leaves the bar over rather than overwrite a note', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 960 });
    expect(beats(doc)[1].isRest).toBeFalse();
  });

  it('changes every beat of a range together', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [0, 1, 2, 3].map(index => ref(0, index)), 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 2, 2, 2]);
  });
});

describe('setTuplet', () => {
  it('makes three quarters a triplet and fills what they freed', () => {
    const doc = ComposerService.createEmptyScore();

    setTuplet(doc, [ref(0, 0), ref(0, 1), ref(0, 2)], { numerator: 3, denominator: 2 });

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
    expect(beats(doc).length).toBe(5);
  });
});
```

**Step 2: Run** `--include=src/app/services/beat-edits.spec.ts`. Expected: compile error.

**Step 3: Implement** `beat-edits.ts`:

```typescript
import {
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  ScoreDoc,
  Tuplet,
  effectiveTimeSignature
} from '../models/composer.model';
import { absorbFollowingRests, beatTicks, fillBarGaps } from './bar-fill';
import { BeatRef, beatAt } from './composer-selection';

/**
 * Edits that act on whole beats: their effects, dynamics and lengths.
 *
 * Every function changes the `ScoreDoc` it is given - `ComposerService.commit` hands it a
 * clone - and trusts its caller to have asked `editRefusal` first.
 */

/**
 * The value a toggle press sets: `on`, unless every target already has it, then `off`.
 *
 * The design's rule for a mixed range. It never depends on which end of the selection was
 * clicked first, so the palette can show what a press will do before it is pressed.
 */
export function toggledValue<T>(current: readonly T[], on: T, off: T): T {
  const allOn = current.length > 0 && current.every(value => JSON.stringify(value) === JSON.stringify(on));
  return allOn ? off : on;
}

/** The beats `refs` name, skipping any that name nothing. */
export function beatsAt(doc: ScoreDoc, refs: readonly BeatRef[]): BeatDoc[] {
  return refs.map(ref => beatAt(doc, ref)).filter((beat): beat is BeatDoc => beat !== null);
}

/** Presses a beat effect tool on `refs`, by the toggle rule. */
export function toggleBeatEffect<K extends keyof BeatEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  key: K,
  on: BeatEffectsDoc[K],
  off: BeatEffectsDoc[K]
): void {
  const targets = beatsAt(doc, refs);
  const value = toggledValue(targets.map(beat => beat.effects[key]), on, off);
  for (const beat of targets) beat.effects[key] = structuredClone(value);
}

/** Marks a dynamic on every beat in `refs`; null removes it. */
export function setDynamics(doc: ScoreDoc, refs: readonly BeatRef[], dynamics: DynamicValue | null): void {
  for (const beat of beatsAt(doc, refs)) beat.dynamics = dynamics;
}

/** Gives every beat in `refs` a written value, then keeps each bar honest. See `relength`. */
export function setBeatDurations(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  duration: DurationValue,
  dots: number
): void {
  relength(doc, refs, beat => {
    beat.duration = duration;
    beat.dots = dots;
  });
}

/** Puts every beat in `refs` under `tuplet`, or out of any tuplet with null. See `relength`. */
export function setTuplet(doc: ScoreDoc, refs: readonly BeatRef[], tuplet: Tuplet | null): void {
  relength(doc, refs, beat => {
    beat.tuplet = tuplet ? { ...tuplet } : null;
  });
}

/**
 * Applies a length change to beats and settles each bar they are in, by the design's rule:
 * a beat that grows takes the rests after it, never a note and never another beat being
 * changed; whatever it cannot take is left as overflow for Fix bar; and any gap is filled
 * with rests.
 *
 * Beats are changed last to first within a bar, so absorbing the rests after one beat never
 * moves a beat still waiting its turn.
 */
function relength(doc: ScoreDoc, refs: readonly BeatRef[], change: (beat: BeatDoc) => void): void {
  const changing = new Set(beatsAt(doc, refs));
  const bars = new Map<BarDoc, { barIndex: number; voiceIndex: number; beats: BeatDoc[] }>();

  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    const beat = beatAt(doc, ref);
    if (!bar || !beat) continue;
    const entry = bars.get(bar) ?? { barIndex: ref.barIndex, voiceIndex: ref.voiceIndex, beats: [] };
    entry.beats.push(beat);
    bars.set(bar, entry);
  }

  for (const [bar, { barIndex, voiceIndex, beats }] of bars) {
    const voice = bar.voices[voiceIndex];
    for (const beat of [...beats].reverse()) {
      const before = beatTicks(beat);
      change(beat);
      const grown = beatTicks(beat) - before;
      if (grown > 0) absorbFollowingRests(voice, beat, grown, changing);
    }
    fillBarGaps(bar, effectiveTimeSignature(doc.masterBars, barIndex));
  }
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: Beat edits - effects by the toggle rule, lengths that keep bars honest`.

### Task C3: Note edits

A focused note is `EditCursor.stringIndex` - 0-based, so tab string `stringIndex + 1`
(`composer.component.ts` builds fretted pitches that way). Focus applies only when the
selection is one beat on a fretted staff; a range, or a pitched staff, means every note.

**Files:**
- Create: `client/src/app/services/note-edits.ts`
- Create: `client/src/app/services/note-edits.spec.ts`

**Step 1: Failing specs** `note-edits.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { notesAt, setAccidental, toggleNoteEffect, toggleTie } from './note-edits';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (beatIndex: number): BeatRef =>
  ({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });
const noteOn = (pitch: NotePitch): NoteDoc =>
  ({ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });

/** Guitar score whose first beat is a two-note chord on strings 1 and 2, and second beat one note. */
function chordDoc(): ScoreDoc {
  const doc = ComposerService.createEmptyScore();
  const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;
  beats[0] = { ...beats[0], isRest: false, notes: [noteOn({ kind: 'fretted', string: 1, fret: 0 }), noteOn({ kind: 'fretted', string: 2, fret: 1 })] };
  beats[1] = { ...beats[1], isRest: false, notes: [noteOn({ kind: 'fretted', string: 1, fret: 3 })] };
  return doc;
}

describe('notesAt', () => {
  it('is the focused string\'s note when one beat is selected', () => {
    expect(notesAt(chordDoc(), [ref(0)], 1).map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 2, fret: 1 }]);
  });

  it('is every note when a range is selected, focus or not', () => {
    expect(notesAt(chordDoc(), [ref(0), ref(1)], 1).length).toBe(3);
  });

  it('is every note in the beat without a focus', () => {
    expect(notesAt(chordDoc(), [ref(0)], null).length).toBe(2);
  });
});

describe('toggleNoteEffect', () => {
  it('turns a valued effect off when every target already has it', () => {
    const doc = chordDoc();
    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'accent', 'heavy', 'none');

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'accent', 'heavy', 'none');

    expect(notesAt(doc, [ref(0), ref(1)], null).map(note => note.effects.accent)).toEqual(['none', 'none', 'none']);
  });

  it('gives every target its own copy of a structured value', () => {
    const doc = chordDoc();
    const bend = [{ offset: 0, value: 0 }, { offset: 60, value: 4 }];

    toggleNoteEffect(doc, [ref(0)], null, 'bendPoints', bend, []);
    const [first, second] = notesAt(doc, [ref(0)], null);
    first.effects.bendPoints.push({ offset: 30, value: 2 });

    expect(second.effects.bendPoints.length).toBe(2);
  });
});

describe('setAccidental', () => {
  it('forces the accidental and drops a letter that would overrule it', () => {
    const doc = ComposerService.createEmptyScore();
    const beat = doc.tracks[0].staves[0].bars[0].voices[0].beats[0];
    beat.isRest = false;
    beat.notes = [noteOn({ kind: 'pitched', noteValue: 1, octave: 4, letter: 'C' })];

    setAccidental(doc, [ref(0)], null, 'flat');

    expect(beat.notes[0].accidental).toBe('flat');
    expect(beat.notes[0].pitch).toEqual({ kind: 'pitched', noteValue: 1, octave: 4 });
  });
});

describe('toggleTie', () => {
  it('ties, then unties, the focused note', () => {
    const doc = chordDoc();

    toggleTie(doc, [ref(1)], null);
    expect(notesAt(doc, [ref(1)], null)[0].isTied).toBeTrue();

    toggleTie(doc, [ref(1)], null);
    expect(notesAt(doc, [ref(1)], null)[0].isTied).toBeFalse();
  });
});
```

**Step 2: Run** `--include=src/app/services/note-edits.spec.ts`. Expected: compile error.

**Step 3: Implement** `note-edits.ts`:

```typescript
import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';

/**
 * Edits that act on notes: effects, accidentals and ties.
 *
 * Like the beat edits, these change the document they are given and trust the caller to
 * have asked `editRefusal` first - with the same `focus`, so the two agree about which
 * notes a press means.
 */

/**
 * The notes a press acts on.
 *
 * `focus` is `EditCursor.stringIndex`, 0-based. It narrows the press to one note only when
 * the selection is a single beat on a fretted staff - the design's "the clicked note in a
 * chord". A range, or a pitched staff, means every note: a pitched staff has no way to name
 * one note of a chord until M2's Pen gives a click a pitch.
 */
export function notesAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteDoc[] {
  const single = refs.length === 1;
  return refs.flatMap(ref => {
    const beat = beatAt(doc, ref);
    if (!beat) return [];
    const fretted = (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) > 0;
    if (single && fretted && focus !== null) {
      return beat.notes.filter(note => note.pitch.kind === 'fretted' && note.pitch.string === focus + 1);
    }
    return beat.notes;
  });
}

/** Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value. */
export function toggleNoteEffect<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): void {
  const notes = notesAt(doc, refs, focus);
  const value = toggledValue(notes.map(note => note.effects[key]), on, off);
  for (const note of notes) note.effects[key] = structuredClone(value);
}

/**
 * Forces an accidental, or returns the notes to `auto`.
 *
 * A pitched note's `letter` overrules `accidental` in the mapper, so an explicit choice
 * drops the letter - otherwise the press would visibly do nothing on any note read back
 * from a file, which carries a letter derived from its forced mode.
 */
export function setAccidental(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  accidental: AccidentalMode
): void {
  for (const note of notesAt(doc, refs, focus)) {
    note.accidental = accidental;
    if (note.pitch.kind === 'pitched') {
      note.pitch = { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave };
    }
  }
}

/** Presses the tie tool: `isTied` marks the note a tie arrives at. */
export function toggleTie(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  const notes = notesAt(doc, refs, focus);
  const value = toggledValue(notes.map(note => note.isTied), true, false);
  for (const note of notes) note.isTied = value;
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: Note edits - effects, accidentals and ties on a focused note or a range`.

### Task C4: Refusals

One function answers "why can't this press do anything?", so the service, and in M2 the
palette's disabled-state tooltips, give the same reason.

**Files:**
- Create: `client/src/app/services/edit-refusals.ts`
- Create: `client/src/app/services/edit-refusals.spec.ts`

**Step 1: Failing specs** `edit-refusals.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { editRefusal } from './edit-refusals';
import { ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number, beatIndex = 0): BeatRef =>
  ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

/** Guitar track 0 with a note on string 1 at beat 0; piano track 1 with a note at beat 0. */
function doc(): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  const guitar = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  guitar.isRest = false;
  guitar.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  const piano = score.tracks[1].staves[0].bars[0].voices[0].beats[0];
  piano.isRest = false;
  piano.notes = [{ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  return score;
}

describe('editRefusal', () => {
  it('lets a note edit through when there is a note', () => {
    expect(editRefusal(doc(), [ref(0)], { family: 'note', key: 'isGhost' }, null)).toBeNull();
  });

  it('refuses when nothing is selected', () => {
    expect(editRefusal(doc(), [], { family: 'beat' }, null)).toMatch(/nothing/i);
  });

  it('refuses a note edit on a rest', () => {
    expect(editRefusal(doc(), [ref(0, 1)], { family: 'note', key: 'isGhost' }, null)).toMatch(/note/i);
  });

  it('refuses a note edit on a string the caret is on but no note is', () => {
    expect(editRefusal(doc(), [ref(0)], { family: 'note', key: 'isGhost' }, 4)).toMatch(/note/i);
  });

  it('lets a beat edit through on a rest', () => {
    expect(editRefusal(doc(), [ref(0, 1)], { family: 'beat' }, null)).toBeNull();
  });

  it('refuses a fretted technique on a pitched staff', () => {
    expect(editRefusal(doc(), [ref(1)], { family: 'note', key: 'bendPoints' }, null)).toMatch(/fretted/i);
  });

  it('refuses the whole range when any of it is a generated track', () => {
    const score = doc();
    score.tracks[1].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(editRefusal(score, [ref(0), ref(1)], { family: 'beat' }, null)).toMatch(/progression/i);
    expect(editRefusal(score, [], { family: 'track', trackIndex: 1 }, null)).toMatch(/progression/i);
  });
});
```

**Step 2: Run** `--include=src/app/services/edit-refusals.spec.ts`. Expected: compile error.

**Step 3: Implement** `edit-refusals.ts`:

```typescript
import { NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';
import { notesAt } from './note-edits';

/** What kind of edit is being asked about. */
export type EditScope =
  | { family: 'beat' }
  | { family: 'note'; key: keyof NoteEffectsDoc | 'accidental' | 'tie' }
  | { family: 'track'; trackIndex: number };

/** Techniques that only mean something on a string. */
const FRETTED_ONLY: ReadonlySet<string> = new Set(['bendPoints', 'slide', 'isLeftHandTapped', 'harmonic']);

const GENERATED =
  'That reaches a track generated from a progression. Flatten the track to edit it by hand.';

/**
 * Why an edit cannot apply to `refs`, or null when it can.
 *
 * Whole or nothing: one generated track anywhere in a range refuses the entire press, so a
 * range is never half-edited. `focus` must be the same one the edit will use, so this and
 * `notesAt` agree about which notes a press means.
 */
export function editRefusal(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  scope: EditScope,
  focus: number | null
): string | null {
  if (scope.family === 'track') {
    return doc.tracks[scope.trackIndex]?.generated ? GENERATED : null;
  }
  if (refs.length === 0) return 'Nothing is selected.';
  if (refs.some(ref => doc.tracks[ref.trackIndex]?.generated)) return GENERATED;
  if (scope.family === 'beat') return null;

  const onPitchedStaff = refs.some(
    ref => (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) === 0
  );
  if (FRETTED_ONLY.has(scope.key) && onPitchedStaff) {
    return 'Bends, slides, taps and harmonics belong to fretted staves.';
  }
  if (notesAt(doc, refs, focus).length === 0) return 'There is no note there to change.';
  return null;
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: One place that says why an edit cannot apply`.

### Task C5: Bar edits

Key signature and clef live on every bar, with no inherit, so "set from this bar" means:
from this bar forward, for as long as the bars still carry the value the first bar had -
the next deliberate change stops it. A time signature inherits, so it is declared once and
the bars under it are fitted: trailing rests that no longer fit go, gaps fill, and notes
that no longer fit stay as overflow for Fix bar.

**Files:**
- Modify: `client/src/app/services/bar-fill.ts` (export `fitBarToMeter`)
- Create: `client/src/app/services/bar-edits.ts`
- Create: `client/src/app/services/bar-edits.spec.ts`

**Step 1: Failing specs** `bar-edits.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import {
  keySignatureFault,
  setClef,
  setKeySignature,
  setTimeSignature,
  timeSignatureFault,
  toggleMasterBarFlag
} from './bar-edits';
import { scoreBarFills } from './bar-fill';
import { createDefaultNoteEffects } from '../models/composer.model';

const THREE_FOUR = { numerator: 3, denominator: 4, isCommon: false };
const FOUR_FOUR = { numerator: 4, denominator: 4, isCommon: true };

describe('timeSignatureFault and keySignatureFault', () => {
  it('accepts what a score can have', () => {
    expect(timeSignatureFault({ numerator: 7, denominator: 8, isCommon: false })).toBeNull();
    expect(keySignatureFault({ fifths: -7, mode: 'minor' })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(timeSignatureFault({ numerator: 5, denominator: 6, isCommon: false })).toMatch(/denominator/i);
    expect(timeSignatureFault({ numerator: 0, denominator: 4, isCommon: false })).toMatch(/top/i);
    expect(keySignatureFault({ fifths: 8, mode: 'major' })).toMatch(/7/);
  });
});

describe('setTimeSignature', () => {
  it('declares at the bar and fits every bar up to the next declaration', () => {
    const doc = ComposerService.createEmptyScore();

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.masterBars.map(bar => bar.timeSignature?.numerator ?? null)).toEqual([4, 3, null, null]);
    expect(scoreBarFills(doc)[0][0].every(fill => fill.kind === 'full')).toBeTrue();
  });

  it('declares nothing when the meter is already in force', () => {
    const doc = ComposerService.createEmptyScore();

    setTimeSignature(doc, 2, FOUR_FOUR);

    expect(doc.masterBars[2].timeSignature).toBeNull();
  });

  it('drops a later declaration the change now repeats', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[3].timeSignature = THREE_FOUR;

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.masterBars[3].timeSignature).toBeNull();
  });

  it('leaves notes that no longer fit as overflow', () => {
    const doc = ComposerService.createEmptyScore();
    const last = doc.tracks[0].staves[0].bars[1].voices[0].beats[3];
    last.isRest = false;
    last.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'over', ticks: 960 });
  });
});

describe('setKeySignature and setClef', () => {
  it('runs forward until the bars carry a different key', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[3].keySignature = { fifths: -1, mode: 'major' };

    setKeySignature(doc, 1, { fifths: 2, mode: 'major' });

    expect(doc.tracks[0].staves[0].bars.map(bar => bar.keySignature.fifths)).toEqual([0, 2, 2, -1]);
  });

  it('sets a clef on one staff only', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    setClef(doc, 1, 0, 0, 'f4', 'regular');

    expect(doc.tracks[1].staves[0].bars.every(bar => bar.clef === 'f4')).toBeTrue();
    expect(doc.tracks[0].staves[0].bars[0].clef).toBe('g2');
  });
});

describe('toggleMasterBarFlag', () => {
  it('follows the toggle rule across the bars', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isDoubleBar = true;

    toggleMasterBarFlag(doc, { first: 0, last: 1 }, 'isDoubleBar');

    expect(doc.masterBars.slice(0, 2).map(bar => bar.isDoubleBar)).toEqual([true, true]);
  });
});
```

**Step 2: Run** `--include=src/app/services/bar-edits.spec.ts`. Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts`:

```typescript
/**
 * Settles a bar after its meter changed: trailing rests it no longer has room for go, a gap
 * fills with rests, and notes that no longer fit stay as overflow for Fix bar.
 */
export function fitBarToMeter(bar: BarDoc, timeSignature: TimeSignature): void {
  const fill = barFillOf(bar, timeSignature);
  const voice = bar.voices[0];
  if (fill.kind === 'over' && voice) takeTrailingRests(voice, fill.ticks);
  fillBarGaps(bar, timeSignature);
}
```

`bar-edits.ts`:

```typescript
import {
  ClefKind,
  KeySignature,
  MasterBarDoc,
  OttaviaKind,
  ScoreDoc,
  TimeSignature,
  effectiveTimeSignature
} from '../models/composer.model';
import { fitBarToMeter } from './bar-fill';
import { toggledValue } from './beat-edits';

/** Edits that act on bars. They change the document they are given. */

const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** Why no score could have `timeSignature`, or null. */
export function timeSignatureFault(timeSignature: TimeSignature): string | null {
  const { numerator, denominator } = timeSignature;
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
    return 'The top number must be a whole number from 1 to 32.';
  }
  if (!DENOMINATORS.includes(denominator)) {
    return 'The bottom number (the denominator) must be 1, 2, 4, 8, 16 or 32.';
  }
  return null;
}

/** Why no score could have `keySignature`, or null. */
export function keySignatureFault(keySignature: KeySignature): string | null {
  const { fifths, mode } = keySignature;
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
    return 'A key signature has from 7 flats to 7 sharps.';
  }
  return mode === 'major' || mode === 'minor' ? null : 'A key is major or minor.';
}

const sameMeter = (a: TimeSignature | null, b: TimeSignature | null): boolean =>
  !!a && !!b && a.numerator === b.numerator && a.denominator === b.denominator;

/**
 * Declares `timeSignature` from bar `first`, and fits every staff's bars under it.
 *
 * Declarations stay in the declare-on-change shape the mapper reads a file into: nothing is
 * declared where the meter is already in force (bar 1 always declares), and a later bar
 * that declared this same meter drops its now-repeated declaration.
 */
export function setTimeSignature(doc: ScoreDoc, first: number, timeSignature: TimeSignature): void {
  const masterBars = doc.masterBars;
  if (!masterBars[first]) return;

  const inForce = first > 0 ? effectiveTimeSignature(masterBars, first - 1) : null;
  masterBars[first].timeSignature = sameMeter(inForce, timeSignature) ? null : { ...timeSignature };

  let end = first + 1;
  while (end < masterBars.length) {
    const declared = masterBars[end].timeSignature;
    if (declared && !sameMeter(declared, timeSignature)) break;
    masterBars[end].timeSignature = null;
    end++;
  }

  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      for (let index = first; index < end; index++) {
        const bar = staff.bars[index];
        if (bar) fitBarToMeter(bar, effectiveTimeSignature(masterBars, index));
      }
    }
  }
}

/** Sets the key on every staff from bar `first`, until a bar carries a different key. */
export function setKeySignature(doc: ScoreDoc, first: number, keySignature: KeySignature): void {
  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      const was = staff.bars[first]?.keySignature;
      if (!was) continue;
      const from = { ...was };
      for (let index = first; index < staff.bars.length; index++) {
        const key = staff.bars[index].keySignature;
        if (key.fifths !== from.fifths || key.mode !== from.mode) break;
        staff.bars[index].keySignature = { ...keySignature };
      }
    }
  }
}

/** Sets clef and ottava on one staff from bar `first`, until a bar carries different ones. */
export function setClef(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  first: number,
  clef: ClefKind,
  ottava: OttaviaKind
): void {
  const bars = doc.tracks[trackIndex]?.staves[staffIndex]?.bars ?? [];
  const was = bars[first];
  if (!was) return;
  const from = { clef: was.clef, ottava: was.clefOttava };
  for (let index = first; index < bars.length; index++) {
    if (bars[index].clef !== from.clef || bars[index].clefOttava !== from.ottava) break;
    bars[index].clef = clef;
    bars[index].clefOttava = ottava;
  }
}

/** Presses a bar flag tool across bars `first` to `last`, by the toggle rule. */
export function toggleMasterBarFlag(
  doc: ScoreDoc,
  bars: { first: number; last: number },
  key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'
): void {
  const targets = doc.masterBars.slice(bars.first, bars.last + 1);
  const value = toggledValue(targets.map(bar => bar[key]), true, false);
  for (const bar of targets) bar[key] = value;
}

/** Sets a valued bar attribute across bars `first` to `last`. */
export function setMasterBarValue<K extends 'repeatCount' | 'alternateEndings' | 'tripletFeel' | 'section'>(
  doc: ScoreDoc,
  bars: { first: number; last: number },
  key: K,
  value: MasterBarDoc[K]
): void {
  for (const bar of doc.masterBars.slice(bars.first, bars.last + 1)) {
    bar[key] = structuredClone(value);
  }
}
```

**Step 4: Run** `bar-edits.spec.ts` and `bar-fill.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit** the three files: `feat: Bar edits - meter, key, clef and bar flags`.

### Task C6: Track edits

Each of these can be asked for something no staff can be, so each returns the reason and
changes nothing when it refuses - which is what lets D3 run them on a clone and commit only
a success. Retuning keeps fret numbers, as Guitar Pro does: the tab stays readable, and the
notes sound where the new tuning puts them.

**Files:**
- Create: `client/src/app/services/track-edits.ts`
- Create: `client/src/app/services/track-edits.spec.ts`

**Step 1: Failing specs** `track-edits.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { renameTrack, setPlayback, setStaffNumber, setStaffTuning, setStaffViews } from './track-edits';
import { STANDARD_BASS_TUNING, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/** A guitar score with a note on string 6 in bar 1, and a piano track. */
function doc(): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  beat.isRest = false;
  beat.notes = [{ pitch: { kind: 'fretted', string: 6, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  return score;
}

describe('setStaffTuning', () => {
  it('refuses to strand notes, and changes nothing', () => {
    const score = doc();

    expect(setStaffTuning(score, 0, 0, STANDARD_BASS_TUNING, 'Bass')).toMatch(/string/i);
    expect(score.tracks[0].staves[0].tuning.length).toBe(6);
  });

  it('retunes when every note fits, keeping frets', () => {
    const score = doc();
    const dropD = [64, 59, 55, 50, 45, 38];

    expect(setStaffTuning(score, 0, 0, dropD, 'Drop D')).toBeNull();
    expect(score.tracks[0].staves[0].tuning).toEqual(dropD);
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 6, fret: 3 });
  });

  it('refuses to tune a pitched staff', () => {
    expect(setStaffTuning(doc(), 1, 0, STANDARD_BASS_TUNING, 'Bass')).toMatch(/pitched/i);
  });
});

describe('setStaffNumber', () => {
  it('sets a capo within the neck and refuses one past it', () => {
    const score = doc();

    expect(setStaffNumber(score, 0, 0, 'capo', 2)).toBeNull();
    expect(setStaffNumber(score, 0, 0, 'capo', 30)).toMatch(/capo/i);
    expect(score.tracks[0].staves[0].capo).toBe(2);
  });
});

describe('setStaffViews', () => {
  it('refuses a staff that would show nothing', () => {
    expect(setStaffViews(doc(), 0, 0, { showStandardNotation: false, showTablature: false })).toMatch(/something/i);
  });

  it('refuses tablature on a pitched staff', () => {
    expect(setStaffViews(doc(), 1, 0, { showTablature: true })).toMatch(/pitched/i);
  });
});

describe('setPlayback and renameTrack', () => {
  it('mutes, and refuses a volume off the scale', () => {
    const score = doc();

    expect(setPlayback(score, 0, { isMute: true })).toBeNull();
    expect(setPlayback(score, 0, { volume: 20 })).toMatch(/16/);
    expect(score.tracks[0].playback).toEqual(jasmine.objectContaining({ isMute: true, volume: 15 }));
  });

  it('refuses a blank name', () => {
    expect(renameTrack(doc(), 0, '   ', '')).toMatch(/name/i);
  });
});
```

**Step 2: Run** `--include=src/app/services/track-edits.spec.ts`. Expected: compile error.

**Step 3: Implement** `track-edits.ts`:

```typescript
import { PlaybackInfoDoc, ScoreDoc, StaffDoc } from '../models/composer.model';

/**
 * Edits that act on a track or one of its staves.
 *
 * Each returns why it refused, or null, and changes nothing when it refuses.
 */

const NO_STAFF = 'There is no staff there.';

/** Retunes a fretted staff, keeping every note's fret. Refuses to strand a note. */
export function setStaffTuning(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  tuning: number[],
  label: string
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (staff.tuning.length === 0) return 'A pitched staff has no strings to tune.';
  if (tuning.length === 0) return 'A tuning needs at least one string.';

  const stranded = staff.bars.some(bar =>
    bar.voices.some(voice =>
      voice.beats.some(beat =>
        beat.notes.some(note => note.pitch.kind === 'fretted' && note.pitch.string > tuning.length)
      )
    )
  );
  if (stranded) {
    return `Some notes sit on strings a ${tuning.length}-string tuning does not have. Move them first.`;
  }

  staff.tuning = tuning.slice();
  staff.tuningLabel = label;
  return null;
}

/** Sets capo, transpose or display transpose. */
export function setStaffNumber(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  key: 'capo' | 'transpose' | 'displayTranspose',
  value: number
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (!Number.isInteger(value)) return 'That must be a whole number.';
  if (key === 'capo' && (value < 0 || value > 24)) return 'A capo sits from fret 0 to 24.';
  if (key !== 'capo' && Math.abs(value) > 24) return 'Transpose by at most two octaves either way.';

  staff[key] = value;
  return null;
}

/** Changes which views a staff shows. It must show something, and tab needs strings. */
export function setStaffViews(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  views: Partial<Pick<StaffDoc, 'showStandardNotation' | 'showTablature' | 'showSlash' | 'showNumbered'>>
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;

  const next = {
    showStandardNotation: views.showStandardNotation ?? staff.showStandardNotation,
    showTablature: views.showTablature ?? staff.showTablature,
    showSlash: views.showSlash ?? staff.showSlash,
    showNumbered: views.showNumbered ?? staff.showNumbered
  };
  if (!next.showStandardNotation && !next.showTablature && !next.showSlash && !next.showNumbered) {
    return 'A staff has to show something.';
  }
  if (next.showTablature && staff.tuning.length === 0) {
    return 'A pitched staff has no strings for tablature.';
  }

  Object.assign(staff, next);
  return null;
}

/** Changes a track's mixer channel. */
export function setPlayback(doc: ScoreDoc, trackIndex: number, changes: Partial<PlaybackInfoDoc>): string | null {
  const track = doc.tracks[trackIndex];
  if (!track) return 'There is no track there.';

  const next = { ...track.playback, ...changes };
  if ([next.volume, next.balance].some(value => !Number.isInteger(value) || value < 0 || value > 16)) {
    return 'Volume and pan run from 0 to 16.';
  }
  if ([next.program, next.bank].some(value => !Number.isInteger(value) || value < 0 || value > 127)) {
    return 'Instrument and bank run from 0 to 127.';
  }

  track.playback = next;
  return null;
}

/** Renames a track. A blank short name is derived from the name, as `addTrack` does. */
export function renameTrack(doc: ScoreDoc, trackIndex: number, name: string, shortName: string): string | null {
  const track = doc.tracks[trackIndex];
  if (!track) return 'There is no track there.';
  if (!name.trim()) return 'A track needs a name.';

  track.name = name.trim();
  track.shortName = shortName.trim() || track.name.slice(0, 3).toLowerCase();
  return null;
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: Track edits that refuse what no staff can be`.

### Task C7: Phase C checkpoint

Run the whole suite. Expected: all green. No commit unless something needed fixing.

---

## Phase D: the service uses them

`ComposerService` gains the selection commands and one entry point per edit family. All
Phase D specs go in `client/src/app/services/composer.service.spec.ts`, each task under its
own `describe`, using the same `TestBed` setup the file already has.

### Task D1: Selection commands

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.spec.ts`

**Step 1: Failing specs.** Append a new top-level `describe` (import `selectionTargets`):

```typescript
describe('ComposerService selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const state = (): ComposerState => {
    let latest: ComposerState | undefined;
    service.getState().subscribe(value => (latest = value)).unsubscribe();
    if (!latest) throw new Error('no state');
    return latest;
  };

  it('starts as the caret alone', () => {
    expect(state().anchor).toBeNull();
  });

  it('extends from where the caret was', () => {
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.extendSelectionTo({ barIndex: 1, beatIndex: 0 });

    expect(state().anchor?.beatIndex).toBe(1);
    expect(state().cursor.barIndex).toBe(1);
    expect(selectionTargets(service.doc, state().anchor, state().cursor).length).toBe(4);
  });

  it('drops the range on a plain caret move', () => {
    service.extendSelectionTo({ barIndex: 2 });

    service.setCursor({ barIndex: 0 });

    expect(state().anchor).toBeNull();
  });

  it('selects every beat of the caret\'s track', () => {
    service.selectAllInTrack();

    expect(selectionTargets(service.doc, state().anchor, state().cursor).length).toBe(16);
  });

  it('keeps the anchor inside the score when bars go', () => {
    service.setCursor({ barIndex: 0 });
    service.extendSelectionTo({ barIndex: 3 });
    service.setCursor({ barIndex: 3 });
    service.extendSelectionTo({ barIndex: 0 });

    service.removeBar(3);

    expect(state().anchor?.barIndex).toBe(2);
  });

  it('drops the range when the whole document is replaced', () => {
    service.extendSelectionTo({ barIndex: 2 });

    service.replaceDocument(ComposerService.createEmptyScore());

    expect(state().anchor).toBeNull();
  });
});
```

(`ComposerState` joins the model import.)

**Step 2: Run** `--include=src/app/services/composer.service.spec.ts`. Expected: compile errors
for `extendSelectionTo` and `selectAllInTrack`.

**Step 3: Implement.** In `ComposerService`:

`setCursor` drops the anchor - a plain click or arrow key is not a range:

```typescript
  /** Moves the caret, and drops any range: a plain click or arrow key. */
  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: null,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /**
   * Moves the selection's moving end, fixing the other end where the caret was if no range
   * existed yet: shift-click and shift-arrow.
   */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: state.anchor ?? state.cursor,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /** Selects every beat of the caret's staff, first bar to last. */
  selectAllInTrack(): void {
    const state = this.stateSubject.getValue();
    const staff = this.staffAt(state.doc, state.cursor);
    if (!staff) return;
    const lastBar = staff.bars.length - 1;
    const lastBeat = (staff.bars[lastBar]?.voices[state.cursor.voiceIndex]?.beats.length ?? 1) - 1;
    this.stateSubject.next({
      ...state,
      anchor: { ...state.cursor, barIndex: 0, beatIndex: 0 },
      cursor: this.clampCursor({ ...state.cursor, barIndex: lastBar, beatIndex: lastBeat }, state.doc)
    });
  }
```

`moveCursorByString` ends with `this.setCursor({ stringIndex: next });`. Changing string
inside a range must not drop the range, so replace that line with a write of its own -
`state` is already the method's local, and `next` is already clamped to the staff:

```typescript
    this.stateSubject.next({ ...state, cursor: { ...state.cursor, stringIndex: next } });
```

In `commit`, `undo` and `redo`, keep the anchor inside the document the same way the cursor
is, and clear `refusal` on a commit. In each `this.stateSubject.next({...})`, add:

```typescript
      anchor: state.anchor ? this.clampCursor(state.anchor, draft) : null,
```

(with `previous` / `next` in place of `draft` in `undo` / `redo`), and in `commit` also
`refusal: null,`. In `replaceDocument`, add `anchor: null, refusal: null,`.

**Step 4: Run.** Expected: all SUCCESS, including the existing specs in that file and
`composer.service.generated.spec.ts` (run both).

**Step 5: Commit**: `feat: Selection commands on the composer service`.

### Task D2: Note and beat edits, refused whole or applied whole

Depends on C3 and C4. One private entry point computes the targets, asks `editRefusal`,
and either publishes the refusal - no commit, so no undo step - or commits the edit once.

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.spec.ts`

**Step 1: Failing specs.** Append:

```typescript
describe('ComposerService edits', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const refusal = (): string | null => {
    let latest: string | null = null;
    service.getState().subscribe(value => (latest = value.refusal)).unsubscribe();
    return latest;
  };
  const writeNote = (barIndex: number, beatIndex: number, string = 1): void => {
    service.setCursor({ barIndex, beatIndex, stringIndex: string - 1 });
    service.setNoteAtCursor({ kind: 'fretted', string, fret: 3 }, false);
  };

  it('palm-mutes every note in a range as one undo step', () => {
    writeNote(0, 0);
    writeNote(0, 1);
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });

    service.toggleNoteEffect('isPalmMute', true, false);
    const beats = service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.slice(0, 2).every(beat => beat.notes[0].effects.isPalmMute)).toBeTrue();

    service.undo();
    expect(service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.isPalmMute).toBeFalse();
  });

  it('acts on the caret\'s string alone in a chord', () => {
    writeNote(0, 0, 1);
    writeNote(0, 0, 2);
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 1 });

    service.toggleNoteEffect('isGhost', true, false);

    const notes = service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    expect(notes.map(note => note.effects.isGhost)).toEqual([false, true]);
  });

  it('refuses a note tool on a rest, says why, and spends no undo', () => {
    const before = JSON.stringify(service.doc);

    service.toggleNoteEffect('isGhost', true, false);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(refusal()).toMatch(/note/i);
    let canUndo = true;
    service.getState().subscribe(value => (canUndo = value.canUndo)).unsubscribe();
    expect(canUndo).toBeFalse();
  });

  it('clears the refusal when the next edit lands', () => {
    service.toggleNoteEffect('isGhost', true, false);
    writeNote(0, 0);

    service.toggleNoteEffect('isGhost', true, false);

    expect(refusal()).toBeNull();
  });

  it('marks a dynamic on every beat in a range, rests included', () => {
    service.selectAllInTrack();

    service.setDynamics('mp');

    expect(service.doc.tracks[0].staves[0].bars[3].voices[0].beats[3].dynamics).toBe('mp');
  });
});
```

Generated-track refusal for a range is pinned in `composer.service.generated.spec.ts`,
beside the existing gate specs:

```typescript
  it('refuses a range that reaches a generated track, whole', () => {
    service.sendProgression(built(atRevision(4)));
    const generated = service.doc.tracks.findIndex(track => track.generated !== null);
    service.setCursor({ trackIndex: 0, barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ trackIndex: generated, barIndex: 1 });
    const before = JSON.stringify(service.doc);

    service.setDynamics('pp');

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(state().refusal).toMatch(/progression/i);
  });
```

**Step 2: Run** both files. Expected: compile errors for the new methods.

**Step 3: Implement.** Import `selectionTargets`, `BeatRef`, the beat and note edits, and
`editRefusal`/`EditScope`. Add to `ComposerService`:

```typescript
  // -------------------------------------------------------------------------
  // Edits on the selection
  // -------------------------------------------------------------------------

  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit({ family: 'note', key }, (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off));
  }

  setAccidental(accidental: AccidentalMode): void {
    this.applyEdit({ family: 'note', key: 'accidental' }, (draft, refs, focus) => setAccidental(draft, refs, focus, accidental));
  }

  toggleTie(): void {
    this.applyEdit({ family: 'note', key: 'tie' }, (draft, refs, focus) => toggleTie(draft, refs, focus));
  }

  /** Presses a beat effect tool on the selection. */
  toggleBeatEffect<K extends keyof BeatEffectsDoc>(key: K, on: BeatEffectsDoc[K], off: BeatEffectsDoc[K]): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => toggleBeatEffect(draft, refs, key, on, off));
  }

  setDynamics(dynamics: DynamicValue | null): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => setDynamics(draft, refs, dynamics));
  }

  setTuplet(tuplet: Tuplet | null): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => setTuplet(draft, refs, tuplet));
  }

  /**
   * The one way a note or beat edit reaches the document.
   *
   * A refusal is published and nothing is committed, so a refused press costs no undo step
   * and changes nothing at all - not half a range. The focused string applies only when the
   * selection is the caret alone: a range means every note in it.
   */
  private applyEdit(
    scope: EditScope,
    edit: (draft: ScoreDoc, refs: BeatRef[], focus: number | null) => void
  ): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const focus = state.anchor ? null : state.cursor.stringIndex;
    const refusal = editRefusal(state.doc, refs, scope, focus);
    if (refusal) {
      this.refuse(refusal);
      return;
    }
    this.commit(draft => edit(draft, refs, focus));
  }
```

(import `AccidentalMode`, `BeatEffectsDoc`, `DynamicValue`, `NoteEffectsDoc`, `Tuplet` from
the model).

**Step 4: Run** both files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Note and beat edits on the selection, refused or applied whole`.

D2 also adds the refusal writer the later tasks share:

```typescript
  /** Publishes why a command did nothing. Commits nothing, so it costs no undo step. */
  private refuse(reason: string): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), refusal: reason });
  }
```

### Task D3: Bar and track commands

Depends on C5 and C6. Bar edits are score-wide like `insertBar`: they are not refused on a
generated track, and they stamp every generated track diverged. Track edits that change
what a staff *is* - tuning, capo, transpose, views, name - are refused on a generated
track; the mixer is not, because muting a progression's track changes nothing it holds.

Some track edits can refuse part-way (a tuning that would strand notes), and Fix bar in D5
can too. Both run on a clone and commit it only when they succeed, so this task splits
`commit` into the clone-and-mutate step and a `commitDocument` step that publishes a
prepared document.

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.spec.ts`

**Step 1: Failing specs.** Append:

```typescript
describe('ComposerService bar and track edits', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const latest = (): ComposerState => {
    let value: ComposerState | undefined;
    service.getState().subscribe(state => (value = state)).unsubscribe();
    if (!value) throw new Error('no state');
    return value;
  };

  it('declares a time signature from the caret\'s bar and fits the bars under it', () => {
    service.setCursor({ barIndex: 1 });

    service.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    expect(service.doc.masterBars[1].timeSignature?.numerator).toBe(3);
    const bars = service.doc.tracks[0].staves[0].bars;
    expect(bars.map(bar => bar.voices[0].beats.length)).toEqual([4, 3, 3, 3]);
  });

  it('refuses a time signature no score can have, and commits nothing', () => {
    const before = JSON.stringify(service.doc);

    service.setTimeSignature({ numerator: 5, denominator: 6, isCommon: false });

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(latest().refusal).toMatch(/denominator/i);
  });

  it('sets the key on every staff from the caret\'s bar on', () => {
    service.addTrack('Piano', 0, false);
    service.setCursor({ barIndex: 2 });

    service.setKeySignature({ fifths: 2, mode: 'major' });

    for (const track of service.doc.tracks) {
      expect(track.staves[0].bars.map(bar => bar.keySignature.fifths)).toEqual([0, 0, 2, 2]);
    }
  });

  it('toggles a repeat start across the selected bars as one undo step', () => {
    service.setCursor({ barIndex: 0 });
    service.extendSelectionTo({ barIndex: 1 });

    service.toggleMasterBarFlag('isRepeatStart');
    expect(service.doc.masterBars.slice(0, 2).map(bar => bar.isRepeatStart)).toEqual([true, true]);

    service.undo();
    expect(service.doc.masterBars[0].isRepeatStart).toBeFalse();
  });

  it('refuses a tuning that would strand notes on strings it removes', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 5 });
    service.setNoteAtCursor({ kind: 'fretted', string: 6, fret: 3 }, false);
    const before = JSON.stringify(service.doc);

    service.setStaffTuning([43, 38, 33, 28], 'Bass Standard Tuning');

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(latest().refusal).toMatch(/string/i);
  });

  it('retunes a staff whose notes all fit', () => {
    service.setStaffTuning([43, 38, 33, 28], 'Bass Standard Tuning');

    expect(service.doc.tracks[0].staves[0].tuning).toEqual([43, 38, 33, 28]);
  });

  it('mutes a track', () => {
    service.setPlayback({ isMute: true });

    expect(service.doc.tracks[0].playback.isMute).toBeTrue();
  });
});
```

**Step 2: Run.** Expected: compile errors for the new methods.

**Step 3: Implement.** Split `commit`:

```typescript
  /** Applies a mutation to a cloned document and commits the result. */
  private commit(mutate: (draft: ScoreDoc) => void, cursor?: EditCursor): void {
    const draft = structuredClone(this.stateSubject.getValue().doc);
    mutate(draft);
    this.commitDocument(draft, cursor);
  }

  /**
   * Publishes a prepared document and pushes the old one onto undo. For edits that can
   * refuse part-way: they run on a clone, and only a clone that succeeded arrives here.
   */
  private commitDocument(next: ScoreDoc, cursor?: EditCursor): void {
    const state = this.stateSubject.getValue();
    this.undoStack.push(structuredClone(state.doc));
    if (this.undoStack.length > ComposerService.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    this.stateSubject.next({
      ...state,
      doc: next,
      cursor: this.clampCursor(cursor ?? state.cursor, next),
      anchor: state.anchor ? this.clampCursor(state.anchor, next) : null,
      refusal: null,
      isDirty: true,
      canUndo: true,
      canRedo: false
    });
  }
```

(`state.doc` is published and never mutated, so snapshotting it at commit time is the same
snapshot the old `commit` took before mutating.)

Then the commands (import the bar and track edits, `selectedBars`, `ClefKind`,
`KeySignature`, `MasterBarDoc`, `OttaviaKind`, `PlaybackInfoDoc`, `StaffDoc`):

```typescript
  // -------------------------------------------------------------------------
  // Bar and track edits
  // -------------------------------------------------------------------------

  setTimeSignature(timeSignature: TimeSignature): void {
    const fault = timeSignatureFault(timeSignature);
    if (fault) return this.refuse(fault);
    this.applyBarEdit((draft, bars) => setTimeSignature(draft, bars.first, timeSignature));
  }

  setKeySignature(keySignature: KeySignature): void {
    const fault = keySignatureFault(keySignature);
    if (fault) return this.refuse(fault);
    this.applyBarEdit((draft, bars) => setKeySignature(draft, bars.first, keySignature));
  }

  setClef(clef: ClefKind, ottava: OttaviaKind): void {
    const { trackIndex, staffIndex } = this.stateSubject.getValue().cursor;
    this.applyBarEdit((draft, bars) => setClef(draft, trackIndex, staffIndex, bars.first, clef, ottava));
  }

  toggleMasterBarFlag(key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'): void {
    this.applyBarEdit((draft, bars) => toggleMasterBarFlag(draft, bars, key));
  }

  setMasterBarValue<K extends 'repeatCount' | 'alternateEndings' | 'tripletFeel' | 'section'>(
    key: K,
    value: MasterBarDoc[K]
  ): void {
    if (key === 'section' && value !== null && !(value as MasterBarDoc['section'])?.text.trim()) {
      return this.refuse('A section needs a name.');
    }
    if ((key === 'repeatCount' || key === 'alternateEndings') && (value as number) < 0) {
      return this.refuse('That cannot be negative.');
    }
    this.applyBarEdit((draft, bars) => setMasterBarValue(draft, bars, key, value));
  }

  setStaffTuning(tuning: number[], label: string): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffTuning(draft, t, s, tuning, label));
  }

  setStaffNumber(key: 'capo' | 'transpose' | 'displayTranspose', value: number): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffNumber(draft, t, s, key, value));
  }

  setStaffViews(views: Partial<Pick<StaffDoc, 'showStandardNotation' | 'showTablature' | 'showSlash' | 'showNumbered'>>): void {
    this.applyTrackEdit(true, (draft, t, s) => setStaffViews(draft, t, s, views));
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>): void {
    this.applyTrackEdit(false, (draft, t) => setPlayback(draft, t, changes));
  }

  renameTrack(name: string, shortName: string): void {
    this.applyTrackEdit(true, (draft, t) => renameTrack(draft, t, name, shortName));
  }

  /**
   * A bar edit over the selected bars. Score-wide, like `insertBar`: never refused on a
   * generated track, and it stamps every generated track diverged in the same commit.
   */
  private applyBarEdit(edit: (draft: ScoreDoc, bars: { first: number; last: number }) => void): void {
    const state = this.stateSubject.getValue();
    const bars = selectedBars(state.anchor, state.cursor);
    this.commit(draft => {
      edit(draft, bars);
      this.markDiverged(draft);
    });
  }

  /**
   * A track edit on the caret's staff, run on a clone so an edit that refuses part-way
   * leaves nothing behind. `gated` edits are refused on a generated track.
   */
  private applyTrackEdit(
    gated: boolean,
    edit: (draft: ScoreDoc, trackIndex: number, staffIndex: number) => string | null | void
  ): void {
    const state = this.stateSubject.getValue();
    const { trackIndex, staffIndex } = state.cursor;
    if (gated) {
      const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
      if (refusal) return this.refuse(refusal);
    }
    const draft = structuredClone(state.doc);
    const reason = edit(draft, trackIndex, staffIndex);
    if (typeof reason === 'string') return this.refuse(reason);
    this.commitDocument(draft);
  }
```

**Step 4: Run** `composer.service.spec.ts` and `composer.service.generated.spec.ts`.
Expected: all SUCCESS.

**Step 5: Commit**: `feat: Bar and track commands on the composer service`.

### Task D4: Today's duration, note and rest commands keep bars honest

The visible change in M1. `applyDurationAtCursor` acts on the selection through
`setBeatDurations`; `setNoteAtCursor` and `setRestAtCursor` stop assigning a duration
directly and go through it too. The generated-track behaviour documented on
`applyDurationAtCursor` is kept exactly: the write is refused, the input duration is still
remembered, and - because that half-refusal is deliberate - no refusal message is published.

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.spec.ts`

**Step 1: Failing specs.** Append:

```typescript
describe('ComposerService durations and bar filling', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const firstBar = () => service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
  const note = (string = 1) => ({ kind: 'fretted' as const, string, fret: 0 });

  it('fills the bar when a shorter duration is applied', () => {
    service.applyDurationAtCursor(8, 0);

    expect(firstBar().map(beat => beat.duration)).toEqual([8, 4, 4, 4, 8]);
  });

  it('applies a duration to every beat of a range', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 3 });

    service.applyDurationAtCursor(8, 0);

    expect(firstBar().map(beat => beat.duration)).toEqual([8, 8, 8, 8, 2]);
  });

  it('writes a longer note by taking the rests after it', () => {
    service.setInputDuration(2, 0);

    service.setNoteAtCursor(note(), false);

    expect(firstBar().map(beat => beat.duration)).toEqual([2, 4, 4]);
  });

  it('leaves overflow for Fix bar rather than overwrite a note', () => {
    service.setCursor({ beatIndex: 1 });
    service.setNoteAtCursor(note(), false);
    service.setCursor({ beatIndex: 0 });

    service.applyDurationAtCursor(2, 0);

    expect(firstBar().length).toBe(4);
    expect(firstBar()[1].isRest).toBeFalse();
  });
});
```

**Step 2: Run.** Expected: FAILED - today's command writes the duration and nothing else,
so `[8, 4, 4, 4]` and similar.

**Step 3: Implement.** Import `setBeatDurations`. `applyDurationAtCursor` keeps its long
docstring (it is still true); append one paragraph to it -

```
   * It acts on the selection, not only the caret, and keeps each bar honest through
   * `setBeatDurations`: a gap fills with rests, and a beat that grows takes only rests.
```

- and its body becomes:

```typescript
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);

    if (!editRefusal(state.doc, refs, { family: 'beat' }, null)) {
      this.commit(draft => setBeatDurations(draft, refs, duration, dots));
    }

    this.setInputDuration(duration, dots);
```

In `setNoteAtCursor`, replace

```typescript
      beat.isRest = false;
      beat.duration = state.inputDuration;
      beat.dots = state.inputDots;
```

with

```typescript
      // Length first, so the bar settles before the note lands. Absorbing only removes
      // beats after this one, so `beat` is still the caret's beat.
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
      beat.isRest = false;
```

and in `setRestAtCursor`, replace

```typescript
      beat.duration = state.inputDuration;
      beat.dots = state.inputDots;
```

with

```typescript
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
```

**Step 4: Run** `composer.service.spec.ts`, `composer.service.generated.spec.ts` and
`composer.component.spec.ts`. Expected: all SUCCESS - the generated specs pin that the
half-refusal survives.

**Step 5: Commit**: `feat: Keep bars full when a duration, note or rest changes a beat's length`.

### Task D5: Fix bar on the service

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.spec.ts`, `client/src/app/services/composer.service.generated.spec.ts`

**Step 1: Failing specs.** Append to `composer.service.spec.ts`:

```typescript
describe('ComposerService fix bar', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const overfillBar = (barIndex: number): void => {
    for (const beatIndex of [0, 1, 2, 3]) {
      service.setCursor({ barIndex, beatIndex, stringIndex: 0 });
      service.setNoteAtCursor({ kind: 'fretted', string: 1, fret: beatIndex }, false);
    }
    service.setCursor({ barIndex, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);
  };

  it('carries the caret bar\'s overflow into the next as one undo step', () => {
    overfillBar(0);
    const before = JSON.stringify(service.doc);

    service.fixBar();
    expect(scoreBarFills(service.doc)[0][0].slice(0, 2).map(fill => fill.kind)).toEqual(['full', 'full']);

    service.undo();
    expect(JSON.stringify(service.doc)).toBe(before);
  });

  it('refuses when no selected bar is over, committing nothing', () => {
    const before = JSON.stringify(service.doc);
    let refusal: string | null = null;

    service.fixBar();
    service.getState().subscribe(state => (refusal = state.refusal)).unsubscribe();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(refusal).toMatch(/over/i);
  });
});
```

(import `scoreBarFills`). Append to `composer.service.generated.spec.ts`, beside the
divergence specs:

```typescript
  it('stamps divergence when Fix bar has to append a bar', () => {
    service.sendProgression(built(atRevision(4)));
    const last = service.doc.masterBars.length - 1;
    for (const beatIndex of [0, 1, 2, 3]) {
      service.setCursor({ trackIndex: 0, barIndex: last, beatIndex, stringIndex: 0 });
      service.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 0 }, false);
    }
    service.setCursor({ trackIndex: 0, barIndex: last, beatIndex: 0 });
    service.applyDurationAtCursor(2, 0);

    service.fixBar();

    expect(marker().source).toEqual({ kind: 'diverged' });
  });
```

**Step 2: Run** both. Expected: compile error, `fixBar` does not exist.

**Step 3: Implement** (import `fixBarOverflow`, `scoreBarFills`):

```typescript
  /**
   * Fix bar: carries the overflow of every over bar in the selection, on the caret's staff,
   * into the bars after it.
   *
   * Runs on a clone and commits only if every bar fixed, because `fixBarOverflow` can refuse
   * part-way - a tuplet across a line - and a half-carried score is exactly the corruption
   * the refusal exists to prevent. Refused on a generated track like any content edit.
   * Appending a bar is score-wide, so it stamps generated tracks diverged; carrying within
   * existing bars touches only this staff and does not.
   */
  fixBar(): void {
    const state = this.stateSubject.getValue();
    const { trackIndex, staffIndex } = state.cursor;
    const refusal = editRefusal(state.doc, [], { family: 'track', trackIndex }, null);
    if (refusal) return this.refuse(refusal);

    const bars = selectedBars(state.anchor, state.cursor);
    const draft = structuredClone(state.doc);
    let fixed = false;
    let appended = 0;

    for (let index = bars.first; index <= bars.last; index++) {
      if (scoreBarFills(draft)[trackIndex]?.[staffIndex]?.[index]?.kind !== 'over') continue;
      const result = fixBarOverflow(draft, trackIndex, staffIndex, index);
      if (result.kind === 'refused') return this.refuse(result.reason);
      fixed = true;
      appended += result.appendedBars;
    }

    if (!fixed) return this.refuse('No selected bar is over its time signature.');
    if (appended > 0) this.markDiverged(draft);
    this.commitDocument(draft);
  }
```

**Step 4: Run** both. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Fix bar on the composer service, all or nothing`.

### Task D6: Documentation and the M1 checkpoint

**Step 1: Whole suite and type check.** From `client/`: the full test run, then
`npx tsc -p tsconfig.app.json --noEmit`. Expected: all green, no output.

**Step 2: Line counts.** `wc -l` every file this plan touched. `composer.service.ts` is the
one to watch; if it passes 1000, move the bar and track command block (D3) into a
`composer-service-structure` helper the service delegates to, and say so in its header.

**Step 3: Documents.**
- `docs/TODO.md`: delete the "`NoteDoc.accidental: 'explicit'` maps to `ForceSharp`" item
  (fixed in A8).
- `docs/plans/2026-09-13-composer-editor-design.md`: status becomes "M1 implemented; M2
  not started". In "What the composer actually has", mark each loss-table row fixed except
  the double bar, and record anything the implementation corrected.
- `docs/ROADMAP.md`: the Composer Editor Redesign row's status becomes "M1 implemented".
- `README.md`: a "Composer Editor Foundations (September 2026)" block above the progression
  composer's, with one line each for: saving keeps hammer-ons, bends, slides, wide vibrato,
  fade-ins, fermatas and accidentals; the BPM field changes playback after a score is
  loaded; changing a duration fills the bar with rests and never overwrites a note. Update
  the test count to the number Step 1 printed.

**Step 4: Hand check in the browser** (`npm start` from `client/`, then `/composer`):
1. Shorten the first beat to an eighth: an eighth rest appears at the end of the bar.
2. Write four notes in a bar and lengthen the first to a half: nothing is overwritten.
3. Open the alphaTex panel, add `{h}` after a note's string (`3.3{h}.4`), apply, save to
   the library, reload the page, load it: the hammer-on is still there.
4. Load a saved score and change the BPM: playback follows.

**Step 5: Commit** the documents: `docs: Record M1 of the composer editor - what shipped and what it corrected`.
