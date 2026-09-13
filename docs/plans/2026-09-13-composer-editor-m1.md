# Composer Editor M1: Foundations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the composer's model, mapper and service able to hold, save and edit every
notation tool the M2 palette will expose - without losing data on save, and with bars that
fill their gaps and report their overflow.

**Architecture:** Bottom-up, per the design in
[2026-09-13-composer-editor-design.md](2026-09-13-composer-editor-design.md). Phase A closes
every data-loss path in `ScoreDocMapperService` and adds the model fields alphaTab already
has. Phase B adds a pure bar-filling module that measures beats exactly as alphaTab lays them out.
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

**Type-checking without a test run** (from `client/`): `npx tsc -p tsconfig.app.json --noEmit`,
then `npx tsc -p tsconfig.spec.json --noEmit`. Run both: `tsconfig.app.json` excludes
`src/**/*.spec.ts`, so a compile error that only a spec file contains is shown only by
`tsconfig.spec.json`.

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
- `Note.trillValue` is the trilled-to pitch as a MIDI number. alphaTex carries it as a fret
  relative to the string's tuning, capo included (`trillFret`): a trill to fret 7 on the G
  string (no capo) is `62` and exports as `tr (7 16)`. A negative value is no trill. Store alphaTab's
  value.
- The composer library stores alphaTex (`composer-library.service.ts` header), and every
  load goes through `toDoc`, which builds every field. **No migration is needed.**
- alphaTab measures a beat in ticks, 960 per quarter, integer-truncating at each step
  (`MidiUtils.toTicks`, `applyDot`, `applyTuplet`). `MidiUtils` is not in the public
  typings, so Phase B mirrors it and a spec pins the mirror against alphaTab.
- Bar filling uses alphaTab's **layout** length, `Beat.displayDuration`, not
  `playbackDuration`. `Voice.finish` advances each beat's `displayStart` by it
  (`alphaTab.core.mjs` ~3304) and the renderer spaces beats by it (~65300), while
  `playbackDuration` is rewritten around graces: on the beat before a before-beat grace
  (~3249), on the beat an on-beat grace steals from (~3273), on grace beats themselves
  (~7713-7730) and on the beat after a bend grace (~7736). A grace beat's `displayDuration` is
  **0** (~7726, ~7730), so it takes no room in its bar. A voice holding a lone whole rest -
  `Beat.isFullBarRest`, a rest alone in its voice with `duration === Whole` (~7281-7283) - has
  a `displayDuration` of the master bar's length whatever its dots or tuplet, because
  `_calculateDuration` returns before reading them (~7694-7696). That length is
  `numerator * valueToTicks(denominator)` (`MasterBar.calculateDuration`, ~2685-2698; the model
  has no anacrusis): the bar's capacity, in any meter. `isFullBarRest` reads the beat's own
  voice, so a lone whole rest is full in any voice, not only the first.
- alphaTab draws a beat as a tuplet when `Beat.hasTuplet` (~7370): any ratio but its default
  -1:-1 and 1:1. The mapper writes a model tuplet's ratio as it is, so Fix bar refuses any such
  beat across a bar line, even where both sides of the split are whole 64ths - its pieces would
  be written values, and the bracket would go.
- A tied continuation has to carry its dynamic. `DynamicsEffectInfo._internalShouldCreateGlyph`
  (~58929-58937) prints a dynamic wherever a beat's differs from the beat before, and an unmarked
  beat is forte (see `BeatDoc.dynamics`), so a continuation without its origin's dynamic prints
  an f. Palm mute and let ring lines run on to the next note on the string only while that note
  has the effect too (`Note.finish`, ~6259-6276), and a crescendo hairpin grows only across
  beats that share it (`CrescendoEffectInfo.canExpand`, ~58565), so a continuation without them
  cuts the line or hairpin at the tie.
- Gap rests are spelled by `slotsToDurations` in `transcription-quantize.ts`, which writes at
  most `MAX_WRITTEN_DOTS` (1) dots. A 3/4 gap of 1680 ticks from the downbeat is `r4. r16`
  under that ceiling and would be one `r4..` with two; Task B3 pins it.
- Only `ComposerService` constructs a `ComposerState` (constructor and `reset`), and only
  the model and mapper touch `vibrato`, so the model changes below have no other callers.
- A fermata is kept per bar and tick, not per beat: `Voice.finish` files it on the master
  bar, and `MasterBar.getFermata` hands it to every beat finished later at that tick
  without one - later voices, staves and tracks, never earlier ones. Pinned after Task A7.

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
5. **Accidental presses that cannot name their note are refused** (review of A8). A forced
   accidental whose shifted pitch is not a white key is drawn on a line that depends on the
   key signature, so Task C4 refuses the press with a reason rather than falling back to
   `auto`. A forced accidental on a natural harmonic on a fretted note is refused too:
   alphaTab draws it at the open string's harmonic pitch, not its fret's. Recorded in the
   design doc's "Found while designing".

### Corrections during implementation

Two reviews of Tasks B1-D5 changed the code after it was written to the tasks below. **For
the tasks named here, the plan's code blocks are superseded by the committed code**; they are
left as written, as the record of what was planned.

- **Two-pass `relength`** (Tasks C2, D4). Settled one beat at a time, a range reported
  overflow its new lengths did not have: a later beat that shrank spent its room on rests at
  once, and an earlier beat that grew could not take it. Beats now all change last to first,
  freed room fills first to last while the bar is short, and growth only a changing neighbour
  blocked takes the rests after the range. Grouped by voice, not bar.
- **The selection follows its beats** (Tasks D2, D4, D5). Every edit path commits through
  `commitFollowing`, which finds each end's beat again after the edit, so a range made shorter
  still covers its notes. It replaces `toggleGrace`'s own caret follow.
- **A beat `EditScope` names its key** (Tasks C4, D2):
  `{ family: 'beat'; key: keyof BeatEffectsDoc | 'duration' | 'dynamics' | 'tuplet' }`. Tap,
  slap and pop are refused on a pitched staff; palm mute and let ring are not.
- **Voice 1 only** (Task C4). Any ref in a later voice refuses the press.
- **A split note's hammer-on and slides** (Task B6). A hammer-on, shift and legato slide and
  slide out move from the head to the tail's last piece, since after the split the next note on
  the string is the note's own continuation. A slide in from below stays on the head.
- **Tie carry** (Task B6). A continuation's accidental resets to `auto`. Note vibrato is not
  carried, because alphaTab inherits it from the tie origin. A trill was considered and not
  carried: alphaTab already plays the origin's trill through the tie, and a trilled
  continuation plays a second trill over it.
- **Trills move with capo and tuning** (Task C6); transposition moves none. A capo on a
  pitched staff is refused, and staff views refuse only turning tablature on for one.
- **Common time is its own meter** (Task C5): `sameMeter` compares `isCommon`.
- **`toggledValue` compares by content**, whatever order a value's keys are in (Task C2).
- **The service split** (Task D6's step, taken during review). The bar and track commands and
  Fix bar moved to `composer-service-structure.ts`, which `ComposerService` delegates to.
- **Refusal wording.** Fix bar's grid and meter refusals end with what to do and say which
  only a loaded file can produce; the accidental refusal reads for a range; the time signature
  fault names the numerator.

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
    // 62 is fret 7 on the G string (open 55) - `value` is a pitch, see TrillDoc.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.trill = { value: 62, speed: 64 }));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.trill).toEqual({ value: 62, speed: 64 });
  });

  it('keeps a trill under a capo, where alphaTex carries it as a lower fret', () => {
    // alphaTex writes the trill as a fret relative to the string's tuning *including capo*,
    // and reads it back the same way, so a capo must not shift the stored pitch.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.trill = { value: 62, speed: 32 }));
    doc.tracks[0].staves[0].capo = 2;

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.trill).toEqual({ value: 62, speed: 32 });
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
 * `value` is `Note.trillValue`, the trilled-to pitch as a MIDI number - playback plays it
 * as it is. alphaTab exposes it relative to the string as `trillFret`, `trillValue` minus
 * the string's tuning with the capo included, and alphaTex writes and reads that fret as
 * `tr (fret speed)`: a trill to fret 7 on the G string (no capo) is value 62 and exports
 * as `tr (7 16)`. A negative value is no trill (`isTrill` is `trillValue >= 0`), so one
 * cannot be stored. Whatever sets a trill from a fret (M4's trill editor) must add the
 * string's tuning, capo included - there, once, rather than every round trip converting
 * here.
 *
 * `value` is a fixed pitch, so it does not follow its note: whatever changes a note's fret,
 * string, capo or tuning must move `trill.value` by the same amount, or a whole-step trill
 * becomes some other interval.
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

/**
 * A trill speed the model can hold. alphaTex accepts only 16th, 32nd and 64th trills and
 * rejects a file with any other - so an out-of-range speed read from elsewhere is brought
 * to alphaTab's own default rather than saved into a composition that will not load.
 */
export function trillSpeedOf(speed: alphaTab.model.Duration): TrillDoc['speed'] {
  return speed === alphaTab.model.Duration.Sixteenth || speed === alphaTab.model.Duration.SixtyFourth
    ? speed
    : 32;
}
```

(the bridge imports `TrillDoc` too). In the mapper, import `toFingers`, `fingerOf` and
`trillSpeedOf`. `toNote`, after the accent - `16 | 32 | 64` assigns to `Duration` directly:

```typescript
    note.isLeftHandTapped = doc.effects.isLeftHandTapped;
    if (doc.effects.trill) {
      note.trillValue = doc.effects.trill.value;
      note.trillSpeed = doc.effects.trill.speed;
    }
    note.leftHandFinger = toFingers(doc.effects.leftHandFinger);
    note.rightHandFinger = toFingers(doc.effects.rightHandFinger);
```

`fromNote`, after the accent:

```typescript
    effects.isLeftHandTapped = note.isLeftHandTapped;
    effects.trill = note.isTrill
      ? { value: note.trillValue, speed: trillSpeedOf(note.trillSpeed) }
      : null;
    effects.leftHandFinger = fingerOf(note.leftHandFinger);
    effects.rightHandFinger = fingerOf(note.rightHandFinger);
```

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
passes `{ title }`.

The narrow parameter type is not the guard on its own. It rejects an object literal that
names `tracks`, because TypeScript checks excess properties only on a fresh literal - but a
spread, or a variable of a wider type such as a whole `ScoreDoc`, passes it untouched. The
per-field body below is the real guard. The red here is still a deliberate compile error you
write and then remove, since that is what shows the old signature accepted anything; the
review of this task added the runtime specs in `composer.service.spec.ts` that pin the body,
by passing a spread of a whole document with `tracks: []`.

**Files:**
- Modify: `client/src/app/services/composer.service.ts` (`updateScoreInfo`)
- Delete at the end: the scratch line below

**Step 1: Write the red.** Temporarily add to the end of `composer.service.spec.ts`'s
`describe` body:

```typescript
  // SCRATCH - remove in step 4
  it('scratch', () => service.updateScoreInfo({ tracks: [] }));
```

**Step 2: Type check** with `npx tsc -p tsconfig.spec.json --noEmit` - the scratch line is
in a spec file, which `tsconfig.app.json` does not compile. Expected: no error today. That is
the bug.

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

Type check (`tsconfig.spec.json` again): expected `Object literal may only specify known
properties, and 'tracks' does not exist`.

**Step 4: Delete the scratch spec.** Type check, both configs: no output.

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
- **Measure the way alphaTab lays a bar out.** Beats are measured in alphaTab's ticks with
  its truncation, and by the length it gives them on the page (`Beat.displayDuration`) rather
  than the length it plays them for, so a bar this module calls full is a bar alphaTab lays
  out as full - including tuplets that do not divide evenly. Two rules follow. A **grace beat
  takes no room**: it is drawn in front of its beat and its sound is stolen from a neighbour,
  so four quarters and a grace note are a full bar of 4/4. And a voice that is **a lone whole
  rest fills its bar in any meter**, because alphaTab draws it as a full-bar rest - which is
  how an alphaTex `r.1` bar in 3/4 arrives from the library or the source panel.

Every function here that measures or settles one bar - `absorbFollowingRests` included -
takes a `BarMeter` - the time signature in force and whether the bar is in free time - rather
than a bare time signature, and `barMeterAt` reads one from the score, so no caller can drop
free time on the way. A free-time bar is full whatever it holds, so nothing here fills or
trims one, or takes its rests when a beat in it grows. And since a grace takes no room,
becoming or leaving a grace is a length change: Task C2's `setGrace` settles the bar for it,
as a duration change does.

Rests are spelled by the transcription quantizer's `slotsToDurations` at a 64th-note grid
(60 ticks a slot), which already splits a span at beat and half-bar boundaries and writes at
most one dot (`MAX_WRITTEN_DOTS`). A gap that is not a whole number of 64ths - what a lone
tuplet leaves - is not spelled at all: the bar stays reported as under, rather than filled with
something that only looks right.

**Gap rests go where the gap opened**, spelled from that position, so the beats after it keep
their place in the bar - which is how Guitar Pro writes them:

- A beat that **shrinks** gets its rests right after it. An empty 4/4 bar whose first quarter
  becomes an eighth is `r8 r8 r4 r4 r4`, and keeps its quarter caret slots.
- A beat that **grows** takes the rests after it, as before. When the last rest it took was
  longer than it needed, the spare goes back right after the grown beat: `n4 r4 r4 r4` dotted
  is `n4. r8 r4 r4`, not `n4. r4 r4 r8`. `absorbFollowingRests` reports that over-take.
- **Fix bar** makes room by taking trailing rests, and any room it took beyond the need goes
  right after the beats it carried into the bar.
- A **meter change** fills at the end of the bar, because that is where its gap opens - as does
  any gap with no position of its own (`fillBarGaps`).

`insertRestsAt` is the position-aware insert all of these use. It never puts rests between a
grace and the beat the grace leads into: it inserts in front of a grace run that ends where the
rests would go, which is the same tick, since a grace takes no room. Task C2's `relength`
settles each changed beat at that beat, last to first, so four quarters set to eighths become
`n8 r8 n8 r8 n8 r8 n8 r8`.

### Task B1: A beat's length, the way alphaTab measures it

alphaTab 1.8.0 lays a bar out by `Beat.displayDuration`: `Voice.finish` advances each beat's
`displayStart` by it (`alphaTab.core.mjs` ~3304) and the renderer spaces beats by it (~65300).
`Beat.updateDurations` (~7709) sets it to 0 for a grace beat (~7726, ~7730) and otherwise to
`_calculateDuration` (~7690): `MidiUtils.toTicks(duration)`, then `applyDot(ticks, true)` for
two dots or `applyDot(ticks, false)` for one, then - only when `tupletDenominator > 0 &&
tupletNumerator >= 0` (~7704) - `applyTuplet(ticks, tupletNumerator, tupletDenominator)`, which
is `(ticks * denominator / numerator) | 0`. `MidiUtils` is not in the public typings, so this
mirrors it, and a spec holds the mirror to alphaTab's own `displayDuration`.

`playbackDuration` is the wrong quantity to hold it to. alphaTab rewrites it for grace beats,
for the beats graces steal from, and for the beat after a bend grace (~3249, ~3273,
~7713-7736), so it does not say how much of a bar a beat fills.

One rule of alphaTab's depends on the voice rather than the beat, so it waits for Task B2.
`_calculateDuration` returns the master bar's length for `isFullBarRest` (~7281-7283, ~7694):
a rest that is the only beat in its voice and whose value is a **whole**, dots and tuplet
ignored. Any other lone rest is measured at its written value.

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
import {
  BeatDoc,
  DurationValue,
  Tuplet,
  createDefaultNoteEffects,
  createRestBeat
} from '../models/composer.model';

function beatOf(duration: DurationValue, dots = 0, tuplet: Tuplet | null = null): BeatDoc {
  return { ...createRestBeat(duration), dots, tuplet };
}

function noteBeatOf(duration: DurationValue, grace: BeatDoc['effects']['grace'] = 'none'): BeatDoc {
  const beat = createRestBeat(duration);
  return {
    ...beat,
    isRest: false,
    notes: [{
      pitch: { kind: 'fretted', string: 1, fret: 3 },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    }],
    effects: { ...beat.effects, grace }
  };
}

// One describe around the file, so its `beforeEach` covers every spec here and no others: a
// `beforeEach` outside any describe would run before every spec in the whole suite.
describe('bar-fill', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

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

    it('applies a tuplet only where alphaTab does', () => {
      // alphaTab's guard is `tupletDenominator > 0 && tupletNumerator >= 0`. A numerator of 0
      // passes and divides by zero, which `| 0` turns into 0.
      expect(beatTicks(beatOf(4, 0, { numerator: 3, denominator: 0 }))).toBe(960);
      expect(beatTicks(beatOf(4, 0, { numerator: -1, denominator: 2 }))).toBe(960);
      expect(beatTicks(beatOf(4, 0, { numerator: 0, denominator: 2 }))).toBe(0);
    });

    it('gives a grace beat no room in the bar', () => {
      expect(beatTicks(noteBeatOf(8, 'onBeat'))).toBe(0);
      expect(beatTicks(noteBeatOf(8, 'beforeBeat'))).toBe(0);
    });

    it('agrees with alphaTab\'s layout on every value, dot, tuplet and grace the palette can write', () => {
      // Compared with `displayDuration`, the length alphaTab lays a bar out by. Three samples
      // tell truncation from rounding: a quarter 7:4 is 548.57 (548 truncated, 549 rounded),
      // a dotted quarter 7:4 822.86, a half 9:8 1706.67. Every other tuplet here lands on or
      // below .5 and would pass either way. The graces sit before notes: a before-beat grace
      // shortens the previous beat's playback and an on-beat grace its own beat's, and neither
      // touches any beat's `displayDuration`. The voice has many beats, so the lone-whole-rest
      // rule does not apply to the whole rest.
      const mapper = TestBed.inject(ScoreDocMapperService);
      const beats = [
        beatOf(1), beatOf(2, 1), beatOf(4, 2), beatOf(64),
        beatOf(8, 0, { numerator: 3, denominator: 2 }),
        beatOf(16, 1, { numerator: 5, denominator: 4 }),
        beatOf(16, 0, { numerator: 7, denominator: 4 }),
        beatOf(32, 2, { numerator: 3, denominator: 2 }),
        beatOf(4, 0, { numerator: 7, denominator: 4 }),
        beatOf(4, 1, { numerator: 7, denominator: 4 }),
        beatOf(2, 0, { numerator: 9, denominator: 8 }),
        noteBeatOf(4),
        noteBeatOf(8, 'onBeat'),
        noteBeatOf(4),
        noteBeatOf(8, 'beforeBeat'),
        noteBeatOf(2)
      ];
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = beats;

      const score = mapper.toScore(doc, new alphaTab.Settings());
      const laidOut = score.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.displayDuration);

      expect(beats.map(beatTicks)).toEqual(laidOut);
    });
  });
});
```

The whole file sits inside one `describe('bar-fill')`, so its `beforeEach` covers every spec
here and no others - a `beforeEach` outside any describe would run before every spec in the
suite. Later tasks add their describes inside it, after the last one.

**Step 2: Run** `--include=src/app/services/bar-fill.spec.ts`. Expected: compile error,
`Cannot find module './bar-fill'`.

**Step 3: Implement** `bar-fill.ts`:

```typescript
import { BeatDoc, TimeSignature } from '../models/composer.model';

/**
 * Bar arithmetic for the composer: how full a bar is, filling its gaps with rests, and
 * carrying its overflow into the next bar when the user asks.
 *
 * Everything is measured the way alphaTab lays a bar out - its ticks, its truncation, and
 * its `displayDuration` rather than its `playbackDuration` - so this module and the renderer
 * cannot disagree about whether a bar is full. See "Bar filling" in
 * docs/plans/2026-09-13-composer-editor-design.md for why gaps fill and overflow does not.
 */

/** alphaTab's `MidiUtils.QuarterTime`. */
export const TICKS_PER_QUARTER = 960;

/**
 * The ticks a beat occupies in its bar as alphaTab 1.8.0 lays it out: `Beat.displayDuration`.
 *
 * Layout, not playback, is the measure. `Voice.finish` advances each beat's `displayStart` by
 * `displayDuration` (`alphaTab.core.mjs` ~3304) and the renderer spaces beats by it (~65300).
 * `playbackDuration` is rewritten for grace notes and the beats they steal from (~3248-3276,
 * ~7713-7736), so it does not say how much of a bar a beat fills.
 *
 * A grace beat occupies no ticks: `updateDurations` sets its `displayDuration` to 0 (~7726).
 * Every other beat is `_calculateDuration` (~7690-7708): the value, then its dots, then its
 * tuplet, truncating at each step.
 *
 * alphaTab also lays out a voice made of one whole rest as exactly the bar's length
 * (`isFullBarRest`, ~7281). That depends on the voice, not the beat, so `barFillOf` applies
 * it; here a whole rest is always 3840.
 */
export function beatTicks(beat: Pick<BeatDoc, 'duration' | 'dots' | 'tuplet' | 'effects'>): number {
  if (beat.effects.grace !== 'none') return 0;

  const value = beat.duration < 0 ? 1 / -beat.duration : beat.duration;
  let ticks = (TICKS_PER_QUARTER * (4 / value)) | 0;

  if (beat.dots === 2) ticks = ticks + ((ticks / 4) | 0) * 3;
  else if (beat.dots === 1) ticks = ticks + ((ticks / 2) | 0);

  // alphaTab's guard, exactly (~7704): a tuplet with no positive denominator, or a negative
  // numerator, is no tuplet. A numerator of 0 passes it and divides by zero; `Infinity | 0`
  // (and `NaN | 0`) is 0 in JavaScript, so alphaTab measures that beat as 0 and so does this.
  if (beat.tuplet && beat.tuplet.denominator > 0 && beat.tuplet.numerator >= 0) {
    ticks = ((ticks * beat.tuplet.denominator) / beat.tuplet.numerator) | 0;
  }
  return ticks;
}
```

`TimeSignature` is imported for Task B2; if the linter objects to it being unused for one
commit, leave it out here and add it there.

**Step 4: Run.** Expected: 6 SUCCESS.

**Step 5: Commit** both files: `feat: Measure a beat in alphaTab's ticks, held to alphaTab by a spec`.

### Task B2: How full a bar is

A bar is measured against a `BarMeter`: the time signature in force there and whether it is
in free time. `barMeterAt` reads both from the score, and every per-bar function in this
module takes one, so free time cannot be forgotten between the score and a bar. Two specs hold
the module to alphaTab rather than to itself: bar capacities across a dozen meters, and which
lone whole rests alphaTab lays out as a full bar.

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Extend `bar-fill.spec.ts`'s imports with `BarMeter`,
`barCapacityTicks`, `barFillAt`, `barFillOf`, `scoreBarFills`, `createDefaultBar`,
`createDefaultBeatEffects` and `createDefaultMasterBar` (`ComposerService`,
`ScoreDocMapperService`, `alphaTab` and `noteBeatOf` are Task B1's). Add this helper beside
Task B1's, outside the outer describe:

```typescript
/** A meter to measure a bar against. A function declaration, so every describe can use it. */
function meterOf(numerator: number, denominator: number, isFreeTime = false): BarMeter {
  return { timeSignature: { numerator, denominator, isCommon: false }, isFreeTime };
}
```

and these inside `describe('bar-fill')`, after `beatTicks`:

```typescript
  describe('barCapacityTicks', () => {
    it('agrees with alphaTab\'s bar length in every meter, truncating where alphaTab does', () => {
      // One master bar per meter, each declaring it, and a default bar on every staff. 3/7,
      // 5/12 and 11/6 have denominators that are no written value, so a seventh's 548.57
      // ticks tells truncation from rounding; 1/128 and 2/1 are the ends of the range.
      const mapper = TestBed.inject(ScoreDocMapperService);
      const meters = [[4, 4], [3, 4], [2, 2], [6, 8], [7, 8], [5, 16], [12, 8], [3, 7], [5, 12], [11, 6], [1, 128], [2, 1]];
      const signatures = meters.map(([numerator, denominator]) => ({ numerator, denominator, isCommon: false }));
      const doc = ComposerService.createEmptyScore();
      doc.masterBars = signatures.map(timeSignature => ({ ...createDefaultMasterBar(), timeSignature }));
      for (const track of doc.tracks) {
        for (const staff of track.staves) {
          staff.bars = signatures.map(timeSignature => createDefaultBar(staff.showTablature, timeSignature));
        }
      }

      const score = mapper.toScore(doc, new alphaTab.Settings());

      expect(signatures.map(barCapacityTicks)).toEqual(score.masterBars.map(masterBar => masterBar.calculateDuration()));
    });
  });

  describe('barFillOf', () => {
    const FOUR_FOUR = meterOf(4, 4);

    it('calls a bar of four quarters full in 4/4', () => {
      expect(barFillOf(createDefaultBar(false, FOUR_FOUR.timeSignature), FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('reports a short bar by how much', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'under', ticks: 480 });
    });

    it('reports an overfull bar by how much', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 2;

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'over', ticks: 960 });
    });

    it('measures 6/8 in its own units', () => {
      const sixEight = meterOf(6, 8);

      expect(barFillOf(createDefaultBar(false, sixEight.timeSignature), sixEight)).toEqual({ kind: 'full' });
    });

    it('calls a bar with no voices under by its whole capacity', () => {
      const threeFour = meterOf(3, 4);
      const bar = { ...createDefaultBar(false, threeFour.timeSignature), voices: [] };

      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'under', ticks: 2880 });
    });

    it('calls a bar holding only a whole rest full in any meter, as alphaTab draws it', () => {
      // alphaTab's `isFullBarRest`: a lone whole rest is laid out as the bar's length, and its
      // dots are never read. A lone whole note is not a rest, so it is measured, and is over.
      const threeFour = meterOf(3, 4);
      const bar = createDefaultBar(false, threeFour.timeSignature);

      bar.voices[0].beats = [createRestBeat(1)];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

      bar.voices[0].beats = [{ ...createRestBeat(1), dots: 1 }];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'full' });

      bar.voices[0].beats = [noteBeatOf(1)];
      expect(barFillOf(bar, threeFour)).toEqual({ kind: 'over', ticks: 960 });
    });

    it('calls four quarters and an on-beat grace note full in 4/4', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats.splice(2, 0, noteBeatOf(8, 'onBeat'));

      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('calls a free-time bar full whatever it holds', () => {
      // Free time is the score saying the meter does not govern this bar.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 1;

      expect(barFillOf(bar, meterOf(4, 4, true))).toEqual({ kind: 'full' });
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
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].isFreeTime = true;
      doc.tracks[0].staves[0].bars[1].voices[0].beats[0].duration = 1;

      expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
    });

    it('agrees with alphaTab about which lone whole rests fill their bar', () => {
      // Bar 1 declares 6/8 and holds a whole beat marked as no rest but with no notes, which
      // alphaTab reads as a rest. Bar 2 declares nothing; the mapper resolves it against the
      // bar before (`previousTimeSignature`), so alphaTab measures it as 6/8, 2880 ticks. It
      // holds an on-beat grace whole rest: `Beat.finish` rewrites a lone grace to an eighth
      // and `updateDurations` gives any grace 0, so it fills nothing. Bar 3 declares 2/4 and
      // holds a double-dotted whole rest, laid out as the bar's 1920 ticks, dots unread.
      const mapper = TestBed.inject(ScoreDocMapperService);
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 6, denominator: 8, isCommon: false };
      doc.masterBars[2].timeSignature = { numerator: 2, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [{ ...createRestBeat(1), isRest: false }];
      bars[1].voices[0].beats = [{ ...createRestBeat(1), effects: { ...createDefaultBeatEffects(), grace: 'onBeat' } }];
      bars[2].voices[0].beats = [{ ...createRestBeat(1), dots: 2 }];

      const score = mapper.toScore(doc, new alphaTab.Settings());
      const laidOut = [0, 1, 2].map(index => score.tracks[0].staves[0].bars[index].voices[0].beats[0].displayDuration);

      expect(score.masterBars[1].calculateDuration()).toBe(2880);
      expect(laidOut).toEqual([2880, 0, 1920]);
      expect(scoreBarFills(doc)[0][0].slice(0, 3)).toEqual([
        { kind: 'full' },
        { kind: 'under', ticks: 2880 },
        { kind: 'full' }
      ]);
    });
  });

  describe('barFillAt', () => {
    it('reads one bar against its own meter and free time', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[2].voices[0].beats[0].duration = 2;

      expect(barFillAt(doc, 0, 0, 2)).toEqual({ kind: 'over', ticks: 960 });

      doc.masterBars[2].isFreeTime = true;
      expect(barFillAt(doc, 0, 0, 2)).toEqual({ kind: 'full' });
    });

    it('is undefined where there is no bar', () => {
      const doc = ComposerService.createEmptyScore();

      expect(barFillAt(doc, 0, 0, 9)).toBeUndefined();
      expect(barFillAt(doc, 3, 0, 0)).toBeUndefined();
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

/**
 * Everything a bar's length is measured against: the time signature in force there, and
 * whether the bar is in free time.
 *
 * One value rather than a bare `TimeSignature`, so no per-bar function in this module can be
 * called without saying whether the meter governs the bar. Free time is the score saying it
 * does not, so a free-time bar is full whatever it holds - and nothing fills or trims it.
 */
export interface BarMeter {
  timeSignature: TimeSignature;
  isFreeTime: boolean;
}

/** The meter bar `barIndex` is measured against: the time signature in force, and free time. */
export function barMeterAt(doc: ScoreDoc, barIndex: number): BarMeter {
  return {
    timeSignature: effectiveTimeSignature(doc.masterBars, barIndex),
    isFreeTime: doc.masterBars[barIndex]?.isFreeTime ?? false
  };
}

/**
 * A bar's capacity in ticks under `timeSignature`: alphaTab's `MasterBar.calculateDuration`
 * (~2685-2698), the numerator times one denominator value's ticks. The model has no anacrusis,
 * so alphaTab's pickup-bar branch never applies.
 */
export function barCapacityTicks(timeSignature: TimeSignature): number {
  return timeSignature.numerator * ((TICKS_PER_QUARTER * (4 / timeSignature.denominator)) | 0);
}

/**
 * Whether alphaTab reads `beat` as a rest: a beat with no notes (`Beat.isRest`, ~7275). The
 * mapper writes notes only when `isRest` is false, so a beat is a rest to alphaTab when either
 * says so - including a beat marked `isRest: false` that holds no notes.
 */
function isAlphaTabRest(beat: BeatDoc): boolean {
  return beat.isRest || beat.notes.length === 0;
}

/**
 * Whether `voice` is one whole rest, which alphaTab lays out as exactly its bar in any meter.
 *
 * alphaTab's `Beat.isFullBarRest` (~7281-7283) is a rest, alone in its voice, whose value is a
 * whole. `_calculateDuration` returns the master bar's length for it before reading dots or a
 * tuplet (~7694-7696), so a dotted or tupleted lone whole rest still fills the bar. A grace
 * beat's `displayDuration` is 0 whatever `_calculateDuration` returned (~7726), so a lone whole
 * grace rest fills nothing.
 */
function isLoneWholeRest(voice: VoiceDoc): boolean {
  if (voice.beats.length !== 1) return false;
  const beat = voice.beats[0];
  return isAlphaTabRest(beat) && beat.duration === 1 && beat.effects.grace === 'none';
}

/**
 * The ticks a voice's beats occupy, each as `beatTicks` measures it - so a grace beat adds
 * nothing. It does not apply the lone-whole-rest rule, which needs the meter: `barFillOf`
 * does, and every caller in this module reads this only for a bar `barFillOf` has not called
 * full.
 */
export function voiceTicks(voice: VoiceDoc): number {
  return voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
}

/**
 * How full `bar` is under `meter`, as alphaTab lays it out: a grace beat takes no room, a
 * voice that is a lone whole rest is full in any meter, and a free-time bar is full whatever
 * it holds.
 *
 * Voice 1 only. It is the only voice the composer writes, and multiple voices are listed
 * beyond M4 in the design. When they arrive each voice is measured on its own - alphaTab
 * applies `isFullBarRest` per voice, so a lone whole rest is full in any voice, not just the
 * first - and the bar answers for its fullest voice.
 */
export function barFillOf(bar: BarDoc, meter: BarMeter): BarFill {
  if (meter.isFreeTime) return { kind: 'full' };
  const voice = bar.voices[0];
  if (voice && isLoneWholeRest(voice)) return { kind: 'full' };
  const difference = (voice ? voiceTicks(voice) : 0) - barCapacityTicks(meter.timeSignature);
  if (difference === 0) return { kind: 'full' };
  return difference < 0 ? { kind: 'under', ticks: -difference } : { kind: 'over', ticks: difference };
}

/** Every bar's fill, indexed `[track][staff][bar]`, each read against its own `barMeterAt`. */
export function scoreBarFills(doc: ScoreDoc): BarFill[][][] {
  return doc.tracks.map(track =>
    track.staves.map(staff => staff.bars.map((bar, index) => barFillOf(bar, barMeterAt(doc, index))))
  );
}

/**
 * One bar's fill, read against its own `barMeterAt` - or undefined when there is no such bar.
 * For a caller asking about a few bars, which should not measure the whole score to do it.
 */
export function barFillAt(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  barIndex: number
): BarFill | undefined {
  const bar = doc.tracks[trackIndex]?.staves[staffIndex]?.bars[barIndex];
  return bar ? barFillOf(bar, barMeterAt(doc, barIndex)) : undefined;
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: Measure how full every bar is, in alphaTab's ticks`.

### Task B3: Fill a bar's gap with rests

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add inside `describe('bar-fill')`, after the last describe (import
`fillBarGaps`, `insertRestsAt` and `BarDoc`; `createDefaultBeatEffects` and `meterOf` are Task
B2's, `noteBeatOf` Task B1's):

```typescript
  describe('fillBarGaps', () => {
    const FOUR_FOUR = meterOf(4, 4);
    const shape = (bar: BarDoc): string[] =>
      bar.voices[0].beats.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);
    const graceRest = (): BeatDoc => ({
      ...createRestBeat(8),
      effects: { ...createDefaultBeatEffects(), grace: 'beforeBeat' }
    });

    it('fills a gap it is given no position for at the end of the bar', () => {
      // A caller that knows where the gap opened uses `insertRestsAt`: see its describe.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r8', 'r4', 'r4', 'r4', 'r8']);
    });

    it('spells a long gap on the beat, not as one odd value', () => {
      // Half a bar of 4/4 is a half rest, at the half-bar, where the ear expects it.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(2)];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r2', 'r2']);
    });

    it('fills 6/8 in dotted quarters', () => {
      const sixEight = meterOf(6, 8);
      const bar = createDefaultBar(false, sixEight.timeSignature);
      bar.voices[0].beats = [{ ...createRestBeat(4), dots: 1 }];

      fillBarGaps(bar, sixEight);

      expect(shape(bar)).toEqual(['r4.', 'r4.']);
    });

    it('leaves a gap it cannot spell exactly, rather than guess', () => {
      // One triplet eighth is 320 ticks, not a whole number of 64ths.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [{ ...createRestBeat(8), tuplet: { numerator: 3, denominator: 2 } }];

      fillBarGaps(bar, FOUR_FOUR);

      expect(bar.voices[0].beats.length).toBe(1);
      expect(barFillOf(bar, FOUR_FOUR).kind).toBe('under');
    });

    it('leaves a full or overfull bar alone', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 2;

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r2', 'r4', 'r4', 'r4']);
    });

    it('leaves a short free-time bar alone, since the meter does not govern it', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      fillBarGaps(bar, meterOf(4, 4, true));

      expect(shape(bar)).toEqual(['r8', 'r4', 'r4', 'r4']);
    });

    it('measures a grace beat as no room', () => {
      // A quarter, a grace and a quarter leave half a bar, spelled from the half-bar.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), graceRest(), createRestBeat(4)];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r4', 'r8', 'r4', 'r2']);
    });

    it('puts the rests in front of a grace that ends the bar, keeping the order it was written in', () => {
      // alphaTab groups a grace only with a beat after it in its own voice, so a grace that ends
      // a bar leads into nothing. The rests go in front of it so it stays where it was written.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), createRestBeat(4), createRestBeat(4), graceRest()];

      fillBarGaps(bar, FOUR_FOUR);

      expect(shape(bar)).toEqual(['r4', 'r4', 'r4', 'r4', 'r8']);
      expect(bar.voices[0].beats[4].effects.grace).toBe('beforeBeat');
    });
  });

  describe('insertRestsAt', () => {
    const FOUR_FOUR = meterOf(4, 4);
    const shape = (beats: BeatDoc[]): string[] =>
      beats.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}${beat.effects.grace !== 'none' ? 'g' : ''}`);
    const graceRest = (): BeatDoc => ({
      ...createRestBeat(8),
      effects: { ...createDefaultBeatEffects(), grace: 'beforeBeat' }
    });

    it('puts a shortened beat\'s gap right after it, spelled from where it opened', () => {
      // The first quarter of an empty bar becomes an eighth. Its gap opens at 480, so the eighth
      // rest goes there and every later rest keeps its quarter slot.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0].duration = 8;

      expect(insertRestsAt(bar.voices[0], 1, 480, FOUR_FOUR)).toBeTrue();

      expect(shape(bar.voices[0].beats)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
    });

    it('spells a gap from its own position, split at the beat it opens inside', () => {
      // 1440 ticks from 480 finish beat 1 with an eighth, then take beat 2 as a quarter.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [noteBeatOf(8), noteBeatOf(2)];

      insertRestsAt(bar.voices[0], 1, 1440, FOUR_FOUR);

      expect(shape(bar.voices[0].beats)).toEqual(['n8', 'r8', 'r4', 'n2']);
    });

    it('never puts rests between a grace and the beat it leads into', () => {
      // A beat that became a grace frees its room where it stood. The rests go in front of it,
      // at the same tick, since a grace takes none, so it still leads into the quarter after it.
      const voice = { beats: [createRestBeat(4), graceRest(), createRestBeat(4), createRestBeat(4)] };

      insertRestsAt(voice, 2, 960, FOUR_FOUR);

      expect(shape(voice.beats)).toEqual(['r4', 'r4', 'r8g', 'r4', 'r4']);
    });

    it('goes after a beat a grace leads into, leaving the grace in front of that beat', () => {
      const voice = { beats: [graceRest(), createRestBeat(8), createRestBeat(4), createRestBeat(4), createRestBeat(4)] };

      insertRestsAt(voice, 2, 480, FOUR_FOUR);

      expect(shape(voice.beats)).toEqual(['r8g', 'r8', 'r8', 'r4', 'r4', 'r4']);
    });

    it('inserts nothing, and says so, when the gap cannot be spelled exactly or the bar is in free time', () => {
      // 320 ticks is a triplet eighth, not a whole number of 64ths.
      const voice = { beats: [{ ...createRestBeat(4), tuplet: { numerator: 3, denominator: 2 } }, createRestBeat(4)] };

      expect(insertRestsAt(voice, 1, 320, FOUR_FOUR)).toBeFalse();
      expect(voice.beats.length).toBe(2);

      const free = { beats: [createRestBeat(8)] };
      expect(insertRestsAt(free, 1, 480, meterOf(4, 4, true))).toBeFalse();
      expect(free.beats.length).toBe(1);
    });

    it('spells with at most one dot, the quantizer\'s `MAX_WRITTEN_DOTS`', () => {
      // `slotsToDurations` in transcription-quantize.ts spells these rests. If it stopped writing
      // dots, 6/8's second half would be two values; if it wrote two, 3/4's 1680 ticks from the
      // downbeat - 28 64ths - would be one double-dotted quarter rather than a dotted quarter
      // (24) and a sixteenth (4).
      const sixEight = { beats: [noteBeatOf(4)] };
      sixEight.beats[0].dots = 1;
      insertRestsAt(sixEight, 1, 1440, meterOf(6, 8));
      expect(shape(sixEight.beats)).toEqual(['n4.', 'r4.']);

      const threeFour = { beats: [noteBeatOf(4), noteBeatOf(16)] };
      insertRestsAt(threeFour, 0, 1680, meterOf(3, 4));
      expect(shape(threeFour.beats)).toEqual(['r4.', 'r16', 'n4', 'n16']);
    });
  });
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts`, importing `DurationUnit`, `slotsToDurations`,
`metricFrame` and `barGridFault` from `./transcription-quantize`, and `createRestBeat` from the
model:

```typescript
/** A 64th note: the finest value the rest speller writes. */
const SLOT_DIVISION = 64;
const SLOT_TICKS = TICKS_PER_QUARTER / 16;

/**
 * Where the run of grace beats that ends just before `voice.beats[index]` begins - `index`
 * itself when the beat before it is not a grace.
 *
 * A grace beat is written in front of the beat after it, and alphaTab groups it with the next
 * non-grace beat in its own voice (`Voice.finish`, ~3200-3216). Anything inserted or cut at
 * `index` goes before such a run, so the placement keeps what the user wrote in order: graces
 * stay in front of the beat they lead into. A run that ends the voice leads into nothing -
 * alphaTab leaves its group incomplete (`GraceGroup.isComplete` stays false) - and it stays
 * last, where it was written.
 */
function graceRunStart(voice: VoiceDoc, index: number): number {
  let start = index;
  while (start > 0 && voice.beats[start - 1].effects.grace !== 'none') start--;
  return start;
}

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

/**
 * Adds rests at the end of `bar` until it is full, when that can be done exactly.
 *
 * For a gap that has no position of its own to go to: a bar that arrived short, or one whose
 * meter changed, which opens its gap at the end of the bar. A gap a length change opens has a
 * position, and goes there instead - see `insertRestsAt`, which this calls at the end of the
 * voice. So the rests go in front of any grace beats that end the bar, which stay last, in the
 * order they were written. Nothing happens when the bar is full or over - a free-time bar
 * always is (`barFillOf`) - or when `insertRestsAt` cannot spell the gap exactly, because a
 * fill that is only nearly right is worse than a bar still honestly reported as under.
 */
export function fillBarGaps(bar: BarDoc, meter: BarMeter): void {
  const fill = barFillOf(bar, meter);
  const voice = bar.voices[0];
  if (fill.kind !== 'under' || !voice) return;
  insertRestsAt(voice, voice.beats.length, fill.ticks, meter);
}

/**
 * Inserts `ticks` of rests into `voice` at beat `index`, spelled from the tick they start at,
 * and says whether it could. `voice` is in a bar measured against `meter`.
 *
 * This is where a gap goes when the caller knows where it opened: right after a beat that
 * shrank (`index` one past it), right after the rests a growing beat took more of than it
 * needed, right after the beats Fix bar carried into a bar. Rests placed there keep every later
 * beat where it was in the bar, so an empty bar whose first quarter becomes an eighth reads
 * `r8 r8 r4 r4 r4`, and its quarter slots survive.
 *
 * Rests never go between a grace and the beat it leads into: the insertion moves back in front
 * of any grace run that ends at `index` (`graceRunStart`). A grace takes no room, so that is
 * the same tick. The rule for the cases that meet a grace:
 * - After a beat a grace run precedes: the rests go right after that beat. Its graces are in
 *   front of it, not at `index`, so they stay with it.
 * - After a beat followed by graces: `index` is in front of those graces, so they stay in front
 *   of the beat they lead into.
 * - After a beat that has itself become a grace: the rests go in front of it and any graces
 *   before it, and it goes on leading into the beat after it.
 * - At the end of a bar that graces end: in front of them, so they stay last.
 *
 * Rests are spelled at a 64th grid, split at beat and half-bar lines by the quantizer's own
 * speller, starting from the ticks of every beat before the insertion point. It inserts nothing
 * and returns false in a free-time bar, which the meter does not govern, when the meter has no
 * 64th grid, and when the gap or its start is not a whole number of 64ths - a tuplet's
 * remainder. A gap of 0 needs nothing and returns true.
 */
export function insertRestsAt(voice: VoiceDoc, index: number, ticks: number, meter: BarMeter): boolean {
  if (ticks === 0) return true;
  if (meter.isFreeTime || !(ticks > 0)) return false;

  const at = graceRunStart(voice, Math.max(0, Math.min(index, voice.beats.length)));
  const start = voiceTicks({ beats: voice.beats.slice(0, at) });
  const units = spelledTicks(ticks, start, meter.timeSignature);
  if (!units) return false;

  voice.beats.splice(at, 0, ...units.map(unit => ({ ...createRestBeat(unit.duration), dots: unit.dots })));
  return true;
```

Then name this module as a consumer in `transcription-quantize.ts`, so a change to the speller
there says what it breaks here. End the `MAX_WRITTEN_DOTS` docstring with:

```
 *
 * Not only transcription reads this. `bar-fill.ts` spells the composer's gap rests with
 * `slotsToDurations`, so changing the ceiling changes every rest a composer edit writes - its
 * spec "spells with at most one dot" pins the spelling a change would break.
```

and the `slotsToDurations` docstring with:

```
 *
 * `bar-fill.ts` is a consumer too: it spells every rest the composer's bar filling writes
 * through this, at a 64th grid. Changing how a span is cut or which values it reaches for
 * changes those rests, and `bar-fill.spec.ts` pins them.
```

**Step 4: Run.** Expected: all SUCCESS. If `fills 6/8 in dotted quarters` or `spells with at
most one dot` fails, read `MAX_WRITTEN_DOTS` in `transcription-quantize.ts`: the speller must
write one dot and no more. It does at the time of writing.

**Step 5: Commit** the three files: `feat: Fill a gap with rests where it opened`.

### Task B4: A lengthened beat takes the rests after it

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add inside `describe('bar-fill')`, after the last describe (import
`absorbFollowingRests` and `NoteDoc`, and `createDefaultNoteEffects` if not already imported):

```typescript
  describe('absorbFollowingRests', () => {
    const FOUR_FOUR = meterOf(4, 4);
    const note = (): NoteDoc => ({
      pitch: { kind: 'pitched', noteValue: 0, octave: 4 },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    });

    it('removes the rests a lengthened beat now covers', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const [first] = bar.voices[0].beats;
      first.duration = 2;

      const taken = absorbFollowingRests(bar.voices[0], first, 960, new Set(), FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 0, overTaken: 0 });
      expect(bar.voices[0].beats.length).toBe(3);
    });

    it('stops at a note and reports what it could not take', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats[1] = { ...beats[1], isRest: false, notes: [note()] };
      beats[0].duration = 2;

      const taken = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set(), FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 960, overTaken: 0 });
      expect(bar.voices[0].beats.length).toBe(4);
    });

    it('takes a beat with no notes, which alphaTab draws as a rest, even when it is not marked one', () => {
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats[1] = { ...beats[1], isRest: false };
      beats[0].duration = 2;

      const taken = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set(), FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 0, overTaken: 0 });
      expect(bar.voices[0].beats.length).toBe(3);
    });

    it('never takes a beat that is itself being changed', () => {
      // Pressing a half on four selected quarters makes four halves, not one.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;

      const taken = absorbFollowingRests(bar.voices[0], beats[0], 960, new Set(beats), FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 960, overTaken: 0 });
      expect(bar.voices[0].beats.length).toBe(4);
    });

    it('takes a longer rest whole, and reports what it took beyond the need for the caller to put back', () => {
      // A quarter grows to a half and takes the half rest after it whole: 960 more than it
      // needed. That goes back right after the half, at 1920, as a quarter rest.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats = [createRestBeat(4), createRestBeat(2), createRestBeat(4)];
      bar.voices[0].beats[0].duration = 2;

      const taken = absorbFollowingRests(bar.voices[0], bar.voices[0].beats[0], 960, new Set(), FOUR_FOUR);
      insertRestsAt(bar.voices[0], 1, taken.overTaken, FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 0, overTaken: 960 });
      expect(bar.voices[0].beats.map(beat => beat.duration)).toEqual([2, 4, 4]);
      expect(barFillOf(bar, FOUR_FOUR)).toEqual({ kind: 'full' });
    });

    it('puts a dotted beat\'s over-take back where Guitar Pro does', () => {
      // `n4 r4 r4 r4` with its note dotted grows by 480 and takes a whole quarter rest. The
      // eighth it did not need goes back at 1440, where the dotted quarter ends: `n4. r8 r4 r4`,
      // not `n4. r4 r4 r8`, whose middle rests would straddle beats.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      bar.voices[0].beats[0] = { ...noteBeatOf(4), dots: 1 };

      const taken = absorbFollowingRests(bar.voices[0], bar.voices[0].beats[0], 480, new Set(), FOUR_FOUR);
      insertRestsAt(bar.voices[0], 1, taken.overTaken, FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 0, overTaken: 480 });
      expect(bar.voices[0].beats.map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`))
        .toEqual(['n4.', 'r8', 'r4', 'r4']);
    });

    it('stops at a grace beat, even a grace rest, and never takes it', () => {
      // A grace takes no room, so taking one gains nothing, and it belongs to the beat after it.
      // A grace rest is the case that matters: `isRest` alone would let the walk take it.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const beats = bar.voices[0].beats;
      beats.splice(2, 0, { ...createRestBeat(8), effects: { ...createDefaultBeatEffects(), grace: 'beforeBeat' } });
      beats[0].duration = 1;

      const taken = absorbFollowingRests(bar.voices[0], beats[0], 2880, new Set(), FOUR_FOUR);

      expect(taken).toEqual({ uncovered: 1920, overTaken: 0 });
      expect(bar.voices[0].beats.map(beat => beat.effects.grace)).toEqual(['none', 'beforeBeat', 'none', 'none']);
    });

    it('takes nothing in a free-time bar, which the lengthened beat simply makes longer', () => {
      // Free time is the score saying the meter does not govern this bar, so there is no room
      // to make: all 960 ticks come back, and the three rests stay where they were.
      const bar = createDefaultBar(false, FOUR_FOUR.timeSignature);
      const before = [...bar.voices[0].beats];
      before[0].duration = 2;

      const taken = absorbFollowingRests(bar.voices[0], before[0], 960, new Set(), meterOf(4, 4, true));

      expect(taken).toEqual({ uncovered: 960, overTaken: 0 });
      expect(bar.voices[0].beats).toEqual(before);
      expect(bar.voices[0].beats.every((beat, index) => beat === before[index])).toBeTrue();
    });
  });
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts` (import `BeatDoc` if not already):

```typescript

/**
 * Whether a walk that makes room may remove `voice.beats[index]`: a beat alphaTab reads as a
 * rest (`isAlphaTabRest`) that is not a grace beat, and that no grace beat leads into.
 *
 * A grace beat takes no room, so removing one gains nothing, and it belongs to the beat after
 * it (see `graceRunStart`): removing the rest a grace leads into would leave the grace in front
 * of whatever came next. A walk stops at either, and what it could not take is left as
 * overflow - the same line the design draws at a note.
 */
function isTakeableRest(voice: VoiceDoc, index: number): boolean {
  const beat = voice.beats[index];
  const before = index > 0 ? voice.beats[index - 1] : null;
  return isAlphaTabRest(beat) && beat.effects.grace === 'none' && (before === null || before.effects.grace === 'none');
}

/** What `absorbFollowingRests` could not cover, and what it took beyond what was asked. */
export interface RestsTaken {
  /** Ticks still wanted: the growth left as overflow. */
  uncovered: number;
  /** Ticks taken past what was wanted, because the last rest taken was longer than the need. */
  overTaken: number;
}

/**
 * Removes rests after `beat` in `voice` until `ticks` are covered, and reports what it could not
 * cover and what it took beyond that. `voice` is in a bar measured against `meter`.
 *
 * It stops at the first note - the design's line: lengthening consumes only following
 * rests, and anything that would overwrite a note is left as overflow for the user to
 * see. It stops at a grace beat too, rest or not, or a rest a grace leads into, and never
 * removes either (`isTakeableRest`). And it stops at any beat in `changing`, so a range
 * pressed together is changed together rather than one beat eating its neighbours. A rest
 * longer than what is left is taken whole, and the difference comes back as `overTaken`: the
 * caller puts it back right after `beat` (`insertRestsAt`), where the room it did not need now
 * opens - so `n4 r4 r4 r4` with its note dotted reads `n4. r8 r4 r4`, as Guitar Pro writes it.
 * Beats are held by identity, not index, because every removal shifts the indices after it.
 *
 * In a free-time bar it removes nothing and reports all of `ticks` uncovered: the meter does
 * not govern that bar, so there is no room to make, and a lengthened beat simply makes the
 * bar longer. `meter` is required, like every per-bar function here, so no caller can forget
 * to ask. The walk's index never moves: each removal brings the next beat to it.
 */
export function absorbFollowingRests(
  voice: VoiceDoc,
  beat: BeatDoc,
  ticks: number,
  changing: ReadonlySet<BeatDoc>,
  meter: BarMeter
): RestsTaken {
  if (meter.isFreeTime) return { uncovered: ticks, overTaken: 0 };
  let remaining = ticks;
  const index = voice.beats.indexOf(beat) + 1;
  if (index === 0) return { uncovered: remaining, overTaken: 0 };

  // Every pass removes a beat or stops, so the walk ends however little a beat is worth.
  while (remaining > 0 && index < voice.beats.length) {
    const next = voice.beats[index];
    if (!isTakeableRest(voice, index) || changing.has(next)) break;
    remaining -= beatTicks(next);
    voice.beats.splice(index, 1);
  }
  return { uncovered: Math.max(0, remaining), overTaken: Math.max(0, -remaining) };
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

It refuses, and says which reason applies, when the beat across a line cannot be split exactly:
a beat carrying a tuplet - refused even where the split lands on whole 64ths, since its pieces
would lose the bracket - a meter on either side with no 64th grid, or a split that falls between
64th notes, as a plain beat pushed off the grid by an earlier triplet, a 128th or a dotted 64th
does. It also refuses a bar whose meter leaves no room at all (`barCapacityTicks` of 0 or less),
which would otherwise carry into appended bars forever. It may have changed `doc` by then - a
carry can refuse on a later bar - so **call it on a draft you can discard**; Task D5 does. And it
replaces beats, so no caller may hold a `BeatDoc` across it.

What a tied continuation carries is what goes on sounding, not what attacks: the same pitches
with `isTied` set (the model's tie flag marks the note a tie *arrives* at), the beat's dynamic,
palm mute and let ring on the beat and its notes, a note's harmonic, and the beat's vibrato and
crescendo. A tied note is not struck again, so an accent, hammer-on, slide, bend, trill, ghost
or dead note, staccato, tap, slap or pop, pick stroke, fade in, grace, fermata or fingering on
its continuation would be a second attack the player never made. The dynamic is a level, and
alphaTab engraves forte on a beat without one; palm mute, let ring and the hairpin would stop at
the tie without theirs. `CARRIED_OVER_A_TIE` holds the list.

Grace beats take no room and belong to the beat after them. Graces just before the first
whole beat past the line travel with it; graces before the crossing beat stay with its head,
where the attack is. Graces after the crossing beat follow its tied tail, keeping the order
they were written in: every beat after the crossing beat starts past the line, so such graces
either lead into a beat carried with them or end the bar, where they led into nothing. So
`n4 n4 n4 n2 g` fixes to `n4 n4 n4 n4 | n4~ g r4 r4 r4`.

Making room in the next bar takes its trailing rests only while it is over, and never a grace
or a rest a grace leads into (Task B4's `isTakeableRest`), so such a bar stays over and the
carry goes on. A bar that is only a whole rest is full in any meter, so Fix bar refuses it. A
carry into one takes the whole rest only if the bar is then over: in 3/4 a carried quarter
and the whole rest are, so the rest goes and the gap fills behind the quarter; in 5/4 they
fill the bar exactly, so the rest stays. A free-time bar is never over, so Fix bar refuses
one, and a carry into one ends there without taking its rests.

Any room the trailing rests give beyond the need goes back right after the carried beats,
spelled from there, so the bar keeps its slots: `n8 n2 n2` fixes to `n8 n2 n8 n4~ | n8~ r8 r4
r4 r4`, not `n8~ r4 r4 r4 r8`. A tail is spelled in the meter of the bar it lands in: a 4/4
`n4 n1.` carried into 3/4 leaves `n2.~` there, not `n2~ n4~`.

**Files:**
- Modify: `client/src/app/services/bar-fill.ts`
- Test: `client/src/app/services/bar-fill.spec.ts`

**Step 1: Failing specs.** Add inside `describe('bar-fill')`, after the last describe (import
`fixBarOverflow` and `ScoreDoc`, and `NoteDoc` and `createDefaultNoteEffects` if not already
imported):

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
    const graceBeat = (): BeatDoc => {
      const beat = noteBeat(8);
      return { ...beat, effects: { ...beat.effects, grace: 'beforeBeat' } };
    };
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

    it('refuses a free-time bar however much it holds, since free time is never over', () => {
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].isFreeTime = true;
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/not over/) });
      expect(shape(doc, 0).length).toBe(5);
    });

    it('refuses a beat at the bar line that starts between 64th notes, and says that is why', () => {
      // Each crossing beat is a plain quarter, pushed off the grid by the beat before it: a
      // triplet eighth starts it 640 ticks before the line, a 128th 930, a dotted 64th 870. None
      // is a whole number of 64ths (60 ticks), so no written value can be the head. None of the
      // crossing beats is a tuplet, so the reason must not say one is.
      const pushers: BeatDoc[] = [
        { ...noteBeat(8), tuplet: { numerator: 3, denominator: 2 } },
        noteBeat(128),
        { ...noteBeat(64), dots: 1 }
      ];
      for (const pusher of pushers) {
        const doc = ComposerService.createEmptyScore();
        doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), pusher, noteBeat(4)];

        const result = fixBarOverflow(doc, 0, 0, 0);

        expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/between 64th notes/) });
        expect(result).not.toEqual({ kind: 'refused', reason: jasmine.stringMatching(/tuplet/i) });
        expect(shape(doc, 0).length).toBe(5);
      }
    });

    it('refuses to split a tuplet across the bar line, even where the split lands on the 64th grid', () => {
      // A triplet dotted quarter is 960 ticks. After three quarters and an eighth it runs from
      // 3360 to 4320: 480 ticks each side of the line, both whole 64ths. Split into written
      // values, it would lose its bracket.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [
        noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(8),
        { ...noteBeat(4), dots: 1, tuplet: { numerator: 3, denominator: 2 } }
      ];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/tuplet/i) });
      expect(shape(doc, 0).length).toBe(5);
    });

    it('refuses a bar whose time signature leaves no room, rather than carry forever', () => {
      // A numerator of 0 is a bar of 0 ticks, so every beat is past its line - and every bar
      // appended after it inherits the same meter. A note is never taken to make room, so
      // without the refusal each bar would carry it into another appended bar, forever.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 0, denominator: 4, isCommon: false };
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/no room/) });
      expect(doc.masterBars.length).toBe(4);
    });

    it('may leave the document partly changed when a later bar of the carry refuses', () => {
      // The documented contract: call it on a draft you can discard. Bar 1's extra quarter
      // carries into bar 2, which holds a triplet eighth and so goes over with a quarter
      // starting 640 ticks before its line. Bar 1 is already cut when bar 2 refuses.
      const doc = ComposerService.createEmptyScore();
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [{ ...noteBeat(8), tuplet: { numerator: 3, denominator: 2 } }, noteBeat(4), noteBeat(4), noteBeat(4)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'refused', reason: jasmine.stringMatching(/between 64th notes/) });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'n8', 'n4', 'n4', 'n4']);
    });

    it('carries the dynamic over the tie, since a dynamic is a level and not an attack', () => {
      // alphaTab reads an unmarked beat as forte, so a continuation without the dynamic would
      // print a change to f that the player never made.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), { ...noteBeat(2), dynamics: 'pp' }];

      fixBarOverflow(doc, 0, 0, 0);

      expect(doc.tracks[0].staves[0].bars[0].voices[0].beats[3].dynamics).toBe('pp');
      expect(doc.tracks[0].staves[0].bars[1].voices[0].beats[0].dynamics).toBe('pp');
    });

    it('carries what goes on sounding over the tie, and drops what attacks', () => {
      const crossing = noteBeat(2);
      crossing.notes[0].effects = {
        ...crossing.notes[0].effects,
        harmonic: 'natural',
        isPalmMute: true,
        isLetRing: true,
        isHammerPullOrigin: true,
        bendPoints: [{ offset: 0, value: 0 }, { offset: 60, value: 4 }]
      };
      crossing.effects = {
        ...crossing.effects,
        isPalmMute: true,
        isLetRing: true,
        vibrato: 'slight',
        crescendo: 'crescendo',
        fadeIn: true,
        pickStroke: 'down',
        fermata: { type: 'medium', length: 1 }
      };
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), crossing];

      fixBarOverflow(doc, 0, 0, 0);

      const tail = doc.tracks[0].staves[0].bars[1].voices[0].beats[0];
      expect(tail.notes[0].effects).toEqual({ ...createDefaultNoteEffects(), harmonic: 'natural', isPalmMute: true, isLetRing: true });
      expect(tail.effects).toEqual({
        ...createDefaultBeatEffects(),
        isPalmMute: true,
        isLetRing: true,
        vibrato: 'slight',
        crescendo: 'crescendo'
      });
    });

    it('spells the tail in the meter of the bar it lands in', () => {
      // The dotted whole starts at 960 and has 2880 ticks past the line. Bar 2 is 3/4, where
      // 2880 from the downbeat is one dotted half; in 4/4 it would be a half and a quarter, cut
      // at the half-bar. The head, 2880 from beat 2 of 4/4, is cut at the half-bar: a quarter
      // and a half. Bar 2's three quarter rests all go to make room.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[1] = createDefaultBar(true, doc.masterBars[1].timeSignature);
      bars[0].voices[0].beats = [noteBeat(4), { ...noteBeat(1), dots: 1 }];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n2~']);
      expect(shape(doc, 1)).toEqual(['n2.~']);
    });

    it('splits a head into several pieces, and puts the tail\'s spare room right after it', () => {
      // The second half starts at 2400 with 1440 ticks to the line: an eighth to finish beat 3,
      // then a quarter for beat 4. Its 480-tick tail takes bar 2's last quarter rest to make
      // room, and the eighth it did not need goes in right after the tail, at 480, so bar 2's
      // rests keep their quarter slots.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(8), noteBeat(2), noteBeat(2)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n8', 'n2', 'n8', 'n4~']);
      expect(shape(doc, 1)).toEqual(['n8~', 'r8', 'r4', 'r4', 'r4']);
    });

    it('splits a rest across the line into rests, with no notes to tie', () => {
      // `shape` cannot tell a rest with no notes from one marked a rest that holds some, so the
      // notes are counted directly.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(8), noteBeat(2), createRestBeat(2)];

      fixBarOverflow(doc, 0, 0, 0);

      expect(shape(doc, 0)).toEqual(['n8', 'n2', 'r8', 'r4']);
      expect(shape(doc, 1)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
      const pieces = [
        ...doc.tracks[0].staves[0].bars[0].voices[0].beats.slice(2),
        doc.tracks[0].staves[0].bars[1].voices[0].beats[0]
      ];
      expect(pieces.map(beat => beat.notes.length)).toEqual([0, 0, 0]);
      expect(pieces.every(beat => beat.isRest)).toBeTrue();
    });

    it('carries into a free-time bar and stops there, taking none of its rests', () => {
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].isFreeTime = true;
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4', 'r4']);
    });

    it('carries a grace note with the beat it leads into', () => {
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [
        noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(4), graceBeat(), noteBeat(4)
      ];

      fixBarOverflow(doc, 0, 0, 0);

      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n8', 'n4', 'r4', 'r4', 'r4']);
      expect(doc.tracks[0].staves[0].bars[1].voices[0].beats[0].effects.grace).toBe('beforeBeat');
    });

    it('carries a grace that ends the bar behind the tied tail, in the order it was written', () => {
      // The grace follows the half that crosses the line, so it follows the whole half - head
      // and tail. It led into nothing where it was, and leads into a rest now.
      const doc = ComposerService.createEmptyScore();
      doc.tracks[0].staves[0].bars[0].voices[0].beats = [noteBeat(4), noteBeat(4), noteBeat(4), noteBeat(2), graceBeat()];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4~', 'n8', 'r4', 'r4', 'r4']);
      expect(doc.tracks[0].staves[0].bars[1].voices[0].beats[1].effects.grace).toBe('beforeBeat');
    });

    it('never takes a rest a grace leads into, and carries on instead', () => {
      // Bar 2 cannot give up its last rest, so it goes over and passes the grace and that rest on.
      const doc = ComposerService.createEmptyScore();
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(4), createRestBeat(4), createRestBeat(4), graceBeat(), createRestBeat(4)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 1)).toEqual(['n4', 'r4', 'r4', 'r4']);
      expect(shape(doc, 2)).toEqual(['n8', 'r4', 'r4', 'r4', 'r4']);
    });

    it('refuses a bar that is only a whole rest, which fills any meter', () => {
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
      doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1)];

      expect(fixBarOverflow(doc, 0, 0, 1).kind).toBe('refused');
    });

    it('takes a lone whole rest as room when the bar is over with it, and fills behind what it carried', () => {
      // Once the carried quarter joins it the whole rest is no longer alone, so it is measured
      // at 3840: 4800 in a 3/4 bar of 2880 is over, so it is taken, the bar is one quarter,
      // and the gap fills from beat 2.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[0].timeSignature = { numerator: 3, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(1)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r2']);
    });

    it('keeps a whole rest the carry leaves the bar exactly full with', () => {
      // In 5/4 the carried quarter and the whole rest, measured at 3840 now it is not alone,
      // are 4800 ticks: the bar's capacity. Rests are taken only while a bar is over, so the
      // whole rest stays.
      const doc = ComposerService.createEmptyScore();
      doc.masterBars[1].timeSignature = { numerator: 5, denominator: 4, isCommon: false };
      const bars = doc.tracks[0].staves[0].bars;
      bars[0].voices[0].beats = [4, 4, 4, 4, 4].map(d => noteBeat(d as DurationValue));
      bars[1].voices[0].beats = [createRestBeat(1)];

      const result = fixBarOverflow(doc, 0, 0, 0);

      expect(result).toEqual({ kind: 'fixed', appendedBars: 0 });
      expect(shape(doc, 0)).toEqual(['n4', 'n4', 'n4', 'n4']);
      expect(shape(doc, 1)).toEqual(['n4', 'r1']);
      expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
    });
  });
```

**Step 2: Run.** Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts` (import `insertBarInto` from `./score-structure`,
and `BeatEffectsDoc`, `NoteEffectsDoc`, `createDefaultBeatEffects` and
`createDefaultNoteEffects` from the model if not already imported). `spelledTicks`,
`graceRunStart` and `insertRestsAt` are Task B3's. `takeTrailingRests` replaces nothing: it is
new here, and takes the bar and its meter so it can stop the moment the bar is no longer over.

```typescript
/** What Fix bar did: how many bars it had to add, or why it did nothing. */
export type FixBarResult =
  | { kind: 'fixed'; appendedBars: number }
  | { kind: 'refused'; reason: string };

const TUPLET_ACROSS_LINE =
  'A tuplet crosses the bar line, so no written value can split it. Shorten it until the bar fits.';

const OFF_GRID_AT_LINE =
  'The beat at the bar line starts or ends between 64th notes, so it cannot be split exactly.';

const NO_GRID_AT_LINE =
  'A time signature at the bar line has no 64th-note grid, so the beat across it cannot be split exactly.';

const NO_ROOM = 'That time signature leaves no room in a bar, so there is nowhere to carry the overflow.';

/**
 * Carries the overflow of bar `barIndex` on one staff into the bars after it, tied, until
 * a bar it reaches is no longer over. See the section comment above Task B6 in the M1 plan
 * for what a continuation carries, and `CARRIED_OVER_A_TIE`.
 *
 * Every bar is read against its own `barMeterAt`, so a free-time bar is never over: Fix bar
 * refuses one, and a carry that reaches one stops there, taking none of its rests. Room in a
 * bar carried into is made by taking its trailing rests; if that takes more than was needed,
 * the spare room goes back right after the carried beats (`insertRestsAt`), where it opened.
 *
 * It refuses, and says why, when the beat across a line cannot be split exactly - a tuplet, a
 * start or end between 64th notes, a meter with no 64th grid - and when a bar it must carry out
 * of has no room at all, which would otherwise append bars forever.
 *
 * **May leave `doc` partly changed when it refuses.** Call it on a draft you can discard.
 *
 * **Replaces beats, so callers must not hold `BeatDoc` references across it.** The beat across
 * the line is replaced by new beats for its head and tail, carried beats move bars, and rests
 * are removed and inserted. Address beats again by position afterwards.
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
  /** How many beats at the start of the bar in hand were carried into it. */
  let carriedIn = 0;
  for (let index = barIndex; index < staff.bars.length; index++) {
    const meter = barMeterAt(doc, index);
    const bar = staff.bars[index];

    const fill = barFillOf(bar, meter);
    if (fill.kind !== 'over') {
      if (index === barIndex) {
        return { kind: 'refused', reason: 'That bar is not over its time signature.' };
      }
      if (fill.kind === 'under') insertRestsAt(bar.voices[0], carriedIn, fill.ticks, meter);
      return { kind: 'fixed', appendedBars };
    }

    // A bar of no ticks puts every beat past its line, and each bar appended after it inherits
    // the meter, so the carry would never end. Checked on every bar, not only the first, since
    // a carry can reach such a meter.
    if (barCapacityTicks(meter.timeSignature) <= 0) return { kind: 'refused', reason: NO_ROOM };

    const cut = beatsPastBarLine(
      bar.voices[0],
      meter.timeSignature,
      barMeterAt(doc, index + 1).timeSignature
    );
    if (cut.kind === 'refused') return cut;

    if (index === staff.bars.length - 1) {
      insertBarInto(doc, staff.bars.length);
      appendedBars++;
    }

    const next = staff.bars[index + 1];
    next.voices[0].beats.unshift(...cut.carried);
    carriedIn = cut.carried.length;
    takeTrailingRests(next, barMeterAt(doc, index + 1));
  }
  return { kind: 'fixed', appendedBars };
}

/** What cutting a voice at its bar line gave: the beats past the line, or why it could not. */
type LineCut = { kind: 'cut'; carried: BeatDoc[] } | { kind: 'refused'; reason: string };

/**
 * Whether alphaTab draws `beat` as a tuplet: `Beat.hasTuplet` (`alphaTab.core.mjs` ~7370), any
 * ratio but -1:-1, its default, and 1:1. The mapper writes a model tuplet's ratio as it is.
 */
function hasTuplet(beat: BeatDoc): boolean {
  const tuplet = beat.tuplet;
  return (
    tuplet !== null &&
    !(tuplet.numerator === -1 && tuplet.denominator === -1) &&
    !(tuplet.numerator === 1 && tuplet.denominator === 1)
  );
}

/**
 * Cuts `voice` at its bar line and returns what lay past it: the tied tail of the beat that
 * crossed the line, then every later beat whole. Refuses, leaving `voice` untouched, when the
 * crossing beat cannot be split into written values - saying which reason applies.
 *
 * A tuplet is refused first, even when both sides of the split are whole 64ths: its pieces would
 * be written values, and the bracket would be gone. Then a meter on either side with no 64th
 * grid, and then a split that falls between 64ths.
 *
 * A grace beat is 0 ticks, so it never crosses the line. Graces just before the first whole
 * beat past it go with that beat; graces before a crossing beat stay with its head. Graces
 * after a crossing beat go behind its tied tail, keeping the order they were written in - so
 * graces that ended the bar, which led into nothing there, follow the tail into the next bar.
 */
function beatsPastBarLine(
  voice: VoiceDoc,
  timeSignature: TimeSignature,
  nextTimeSignature: TimeSignature
): LineCut {
  const capacity = barCapacityTicks(timeSignature);
  let start = 0;

  for (let index = 0; index < voice.beats.length; index++) {
    const beat = voice.beats[index];
    const end = start + beatTicks(beat);
    if (end <= capacity) {
      start = end;
      continue;
    }

    if (start >= capacity) return { kind: 'cut', carried: voice.beats.splice(graceRunStart(voice, index)) };

    if (hasTuplet(beat)) return { kind: 'refused', reason: TUPLET_ACROSS_LINE };
    if (barGridFault(timeSignature, SLOT_DIVISION) !== null || barGridFault(nextTimeSignature, SLOT_DIVISION) !== null) {
      return { kind: 'refused', reason: NO_GRID_AT_LINE };
    }
    const head = spelledTicks(capacity - start, start, timeSignature);
    const tail = spelledTicks(end - capacity, 0, nextTimeSignature);
    if (!head || !tail) return { kind: 'refused', reason: OFF_GRID_AT_LINE };

    const after = voice.beats.splice(index + 1);
    voice.beats.splice(index, 1, ...piecesOf(beat, head, false));
    return { kind: 'cut', carried: [...piecesOf(beat, tail, true), ...after] };
  }
  return { kind: 'cut', carried: [] };
}

/**
 * What a tied continuation keeps of the beat and notes it continues: what goes on sounding
 * across the tie, not what attacks.
 *
 * A tied note is not struck again. So accents, hammer-ons and pull-offs, slides, bends, trills,
 * ghost and dead notes, staccato, taps, slap and pop, a pick stroke, a fade in, a grace, a
 * fermata and fingering all stay on the beat that was struck, and a continuation carrying one
 * would show a second attack the player never made. What it keeps is a state that runs on:
 *
 * - **The dynamic** (`BeatDoc.dynamics`, carried beside these), a level rather than an attack.
 *   alphaTab reads an unmarked beat as forte and prints a dynamic wherever it differs from the
 *   beat before (`DynamicsEffectInfo._internalShouldCreateGlyph`, `alphaTab.core.mjs`
 *   ~58929-58937), so a continuation without it would print an f nobody played.
 * - **Palm mute and let ring**, on the beat and its notes. alphaTab runs each line on to the
 *   next note on the string only while that note has it too (`Note.finish`, ~6259-6276), so a
 *   continuation without it would end the line at the tie.
 * - **A harmonic**, which is how the held note sounds.
 * - **Beat vibrato, and a crescendo or decrescendo.** A hairpin grows across beats that share
 *   it (`CrescendoEffectInfo.canExpand`, ~58565), so a continuation without it would cut the
 *   hairpin at the tie.
 */
const CARRIED_OVER_A_TIE = {
  beat: ['isPalmMute', 'isLetRing', 'vibrato', 'crescendo'],
  note: ['harmonic', 'isPalmMute', 'isLetRing']
} as const satisfies { beat: readonly (keyof BeatEffectsDoc)[]; note: readonly (keyof NoteEffectsDoc)[] };

/** Copies `keys` of `source` onto `target`. Generic in the key, so each copy is type-checked. */
function copyFields<T, K extends keyof T>(target: T, source: T, keys: readonly K[]): void {
  for (const key of keys) target[key] = source[key];
}

/** A tied continuation of `beat`, at `beat`'s value until `piecesOf` re-values it. */
function continuationOf(beat: BeatDoc): BeatDoc {
  const effects = createDefaultBeatEffects();
  copyFields(effects, beat.effects, CARRIED_OVER_A_TIE.beat);
  return {
    ...createRestBeat(beat.duration),
    isRest: beat.isRest,
    dynamics: beat.dynamics,
    effects,
    notes: beat.notes.map(note => {
      const noteEffects = createDefaultNoteEffects();
      copyFields(noteEffects, note.effects, CARRIED_OVER_A_TIE.note);
      return { ...structuredClone(note), isTied: true, effects: noteEffects };
    })
  };
}

/**
 * `beat` rewritten as one beat per written value. The first piece of the head is the beat
 * itself, re-valued, so its effects and attack stay where they were struck; every other piece
 * is a tied continuation (`continuationOf`).
 *
 * The first piece is a shallow copy, not a clone. `beatsPastBarLine` splices `beat` out of its
 * voice as it puts the pieces in, so nothing in the document still holds `beat`'s notes or
 * effects to share them with, and every continuation builds its own.
 */
function piecesOf(beat: BeatDoc, units: DurationUnit[], isTail: boolean): BeatDoc[] {
  return units.map((unit, index): BeatDoc =>
    index === 0 && !isTail
      ? { ...beat, duration: unit.duration, dots: unit.dots, tuplet: null }
      : { ...continuationOf(beat), duration: unit.duration, dots: unit.dots }
  );
}

/**
 * Removes rests from the end of `bar` while it is over `meter`, and stops as soon as it is not.
 *
 * Stopping when the bar stops being over, rather than once some number of ticks is covered,
 * is what keeps a whole rest that still fits: once the rests after it are gone a lone whole
 * rest is full in any meter (`barFillOf`), and a carry can leave a whole rest exactly filling
 * a bar beside it. It stops at a note, a grace beat, or a rest a grace leads into
 * (`isTakeableRest`); what it cannot take stays as overflow. A free-time bar is never over, so
 * nothing is taken from one.
 */
function takeTrailingRests(bar: BarDoc, meter: BarMeter): void {
  const voice = bar.voices[0];
  if (!voice) return;
  while (barFillOf(bar, meter).kind === 'over') {
    const last = voice.beats.length - 1;
    if (last < 0 || !isTakeableRest(voice, last)) return;
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
| `beat-edits.ts` | `toggledValue`, `beatsAt`, `toggleBeatEffect`, `setDynamics`, `setBeatDurations`, `setTuplet`, `setGrace` |
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
import { DurationValue, EditCursor, createRestBeat } from '../models/composer.model';

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

  it('orders ends in two voices by time, and takes the head voice\'s beats that start within the span', () => {
    // Voice 1 is four quarters, starting 0, 960, 1920, 2880. Voice 2 is four eighths and a
    // half, starting 0, 480, 960, 1440, 1920. Beat indices in the two voices do not line up in
    // time, so the ends are ordered by where each starts in its own voice.
    const doc = ComposerService.createEmptyScore();
    const bar = doc.tracks[0].staves[0].bars[0];
    bar.voices.push({ beats: [8, 8, 8, 8, 2].map(duration => createRestBeat(duration as DurationValue)) });
    const inVoice = (voiceIndex: number, beatIndex: number): EditCursor => ({ ...at(0, beatIndex), voiceIndex });

    // The anchor is voice 1's second quarter, at 960; the head is voice 2's second eighth, at 480.
    // By index the anchor would come first and the range would be the head alone. By time the
    // head comes first, and voice 2's beats starting from 480 to 960 are its second and third.
    const earlier = selectionTargets(doc, inVoice(0, 1), inVoice(1, 1));
    expect(positions(earlier)).toEqual(['0:0.1', '0:0.2']);
    expect(earlier.every(ref => ref.voiceIndex === 1)).toBeTrue();

    // The anchor is voice 1's last quarter, at 2880; the head is voice 2's third eighth, at 960.
    // By index the range would stop at voice 2's beat 3; by time it runs on to the half at 1920.
    expect(positions(selectionTargets(doc, inVoice(0, 3), inVoice(1, 2)))).toEqual(['0:0.2', '0:0.3', '0:0.4']);
  });

  it('keeps a multitrack rectangle on the first voice', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[0].staves[0].bars[0].voices.push({ beats: [createRestBeat(2), createRestBeat(2)] });

    const refs = selectionTargets(doc, { ...at(0, 0, 0), voiceIndex: 1 }, at(0, 0, 1));

    expect(refs.every(ref => ref.voiceIndex === 0)).toBeTrue();
    expect(refs.length).toBe(2 * 4);
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
import { beatTicks } from './bar-fill';

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
 * With no anchor, the caret's beat. With both ends on one staff, every beat of the caret's voice
 * from the earlier end to the later, across bar lines. The ends may be in different voices,
 * whose beat indices do not line up in time, so they are ordered by bar and then by where each
 * starts in its own voice, and an end in another voice bounds the range by that start tick. With
 * the ends on different tracks or staves, whole bars from the earlier end's bar to the later's,
 * on every staff of every track between - Guitar Pro's multitrack selection, which is a rectangle
 * because bars are the only unit two tracks share. See `barRectangle` for its voice.
 */
export function selectionTargets(doc: ScoreDoc, anchor: EditCursor | null, head: EditCursor): BeatRef[] {
  if (!anchor) return beatAt(doc, head) ? [refOf(head)] : [];

  if (anchor.trackIndex === head.trackIndex && anchor.staffIndex === head.staffIndex) {
    const [from, to] = inTimelineOrder(positionOf(doc, anchor), positionOf(doc, head));
    return beatsBetween(doc, head, from, to);
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

/** One end of a range, placed in time: its bar, and its beat's start tick in its own voice. */
interface TimelinePosition {
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
  ticks: number;
}

/**
 * Where `cursor` sits in time. `ticks` sums `beatTicks` over the beats before it in its own
 * voice, so a grace adds nothing - it starts where the beat it leads into does.
 */
function positionOf(doc: ScoreDoc, cursor: EditCursor): TimelinePosition {
  const beats =
    doc.tracks[cursor.trackIndex]?.staves[cursor.staffIndex]?.bars[cursor.barIndex]?.voices[cursor.voiceIndex]?.beats ?? [];
  return {
    barIndex: cursor.barIndex,
    voiceIndex: cursor.voiceIndex,
    beatIndex: cursor.beatIndex,
    ticks: beats.slice(0, cursor.beatIndex).reduce((sum, beat) => sum + beatTicks(beat), 0)
  };
}

/**
 * The two ends, earlier first: by bar, then by start tick. Two ends in one voice that start at
 * the same tick - a grace and the beat it leads into - are ordered by index, as they are written.
 */
function inTimelineOrder(a: TimelinePosition, b: TimelinePosition): [TimelinePosition, TimelinePosition] {
  const aFirst =
    a.barIndex !== b.barIndex
      ? a.barIndex < b.barIndex
      : a.ticks !== b.ticks
        ? a.ticks < b.ticks
        : a.voiceIndex !== b.voiceIndex || a.beatIndex <= b.beatIndex;
  return aFirst ? [a, b] : [b, a];
}

/**
 * The beats of `head`'s voice from `from` to `to`. An end in that voice bounds the range by its
 * beat index, exactly as written; an end in another voice bounds it by its start tick, taking
 * each beat whose own start lies within the span.
 */
function beatsBetween(doc: ScoreDoc, head: EditCursor, from: TimelinePosition, to: TimelinePosition): BeatRef[] {
  const { trackIndex, staffIndex, voiceIndex } = head;
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  const refs: BeatRef[] = [];
  if (!staff) return refs;

  for (let barIndex = from.barIndex; barIndex <= to.barIndex; barIndex++) {
    let start = 0;
    (staff.bars[barIndex]?.voices[voiceIndex]?.beats ?? []).forEach((beat, beatIndex) => {
      const afterFrom =
        barIndex > from.barIndex || (from.voiceIndex === voiceIndex ? beatIndex >= from.beatIndex : start >= from.ticks);
      const beforeTo =
        barIndex < to.barIndex || (to.voiceIndex === voiceIndex ? beatIndex <= to.beatIndex : start <= to.ticks);
      if (afterFrom && beforeTo) refs.push({ trackIndex, staffIndex, barIndex, voiceIndex, beatIndex });
      start += beatTicks(beat);
    });
  }
  return refs;
}

/**
 * Whole bars `a` to `b` on every staff of every track between them, in the first voice only,
 * whichever voice either end is in. Nothing selects or edits another voice until multiple voices
 * are designed, which is beyond M4; when they are, this decides which voices a rectangle takes.
 */
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

A grace takes no room (Task B1), so making a beat a grace, or a grace an ordinary beat, changes
how full its bar is. That is `setGrace`, which settles the bar through the same `relength` as a
duration change; `toggleBeatEffect` cannot name `grace` at all. Grace beats' written values
belong to alphaTab, which sets them by grace group size when the score is finished, so
`setBeatDurations` skips grace beats.

`relength` settles each beat's gap or over-take at that beat, where it opened, with Task B3's
`insertRestsAt` (see the Phase B intro). A beat that becomes a grace frees its room where it
stood, and the rests go in front of it, so it goes on leading into the beat after it.

**Files:**
- Create: `client/src/app/services/beat-edits.ts`
- Create: `client/src/app/services/beat-edits.spec.ts`

**Step 1: Failing specs** `beat-edits.spec.ts`:

```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { setBeatDurations, setGrace, setTuplet, toggleBeatEffect, toggledValue } from './beat-edits';
import { scoreBarFills } from './bar-fill';
import { ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

const ref = (barIndex: number, beatIndex: number): BeatRef =>
  ({ trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });
const beats = (doc: ScoreDoc, bar = 0) => doc.tracks[0].staves[0].bars[bar].voices[0].beats;
const withNote = (doc: ScoreDoc, bar: number, beat: number): void => {
  const target = beats(doc, bar)[beat];
  target.isRest = false;
  target.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
};
/** Each beat of a bar as `n` or `r`, its value and its dots: `n4.`. */
const shape = (doc: ScoreDoc, bar = 0): string[] =>
  beats(doc, bar).map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);

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
  it('fills the gap a shorter beat leaves right after it', () => {
    // The first quarter becomes an eighth. Its gap opens at 480, so the eighth rest goes there
    // and the three quarter rests keep their slots.
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 8, 0);

    expect(shape(doc)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('takes the following rests when a beat gets longer', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 4, 4]);
  });

  it('puts back what a growing beat took beyond its need, right after it', () => {
    // A dotted quarter needs 480 more ticks and takes the whole quarter rest after it. The
    // eighth it did not need goes back at 1440, where the dotted quarter ends.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);

    setBeatDurations(doc, [ref(0, 0)], 4, 1);

    expect(shape(doc)).toEqual(['n4.', 'r8', 'r4', 'r4']);
  });

  it('leaves the bar over rather than overwrite a note', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 960 });
    expect(beats(doc)[1].isRest).toBeFalse();
  });

  it('spends a shorter beat\'s room on the bar\'s overflow before filling', () => {
    // The first rest grew to a half against a note, leaving the bar 960 over. Shortened back to
    // a quarter it frees 960, which the overflow uses up, so no rest is inserted.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);
    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    setBeatDurations(doc, [ref(0, 0)], 4, 0);

    expect(shape(doc)).toEqual(['r4', 'n4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('changes every beat of a range together', () => {
    const doc = ComposerService.createEmptyScore();

    setBeatDurations(doc, [0, 1, 2, 3].map(index => ref(0, index)), 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 2, 2, 2]);
  });

  it('settles each beat of a range where its own gap opened', () => {
    // Four quarters set to eighths, last to first. The fourth frees 480 at 3360, the third at
    // 2400, the second at 1440 and the first at 480. Each is settled exactly, so nothing after
    // it moves, and every eighth rest sits right after the eighth that freed it.
    const doc = ComposerService.createEmptyScore();
    [0, 1, 2, 3].forEach(index => withNote(doc, 0, index));

    setBeatDurations(doc, [0, 1, 2, 3].map(index => ref(0, index)), 8, 0);

    expect(shape(doc)).toEqual(['n8', 'r8', 'n8', 'r8', 'n8', 'r8', 'n8', 'r8']);

    const rests = ComposerService.createEmptyScore();
    setBeatDurations(rests, [0, 1, 2, 3].map(index => ref(0, index)), 8, 0);
    expect(shape(rests)).toEqual(['r8', 'r8', 'r8', 'r8', 'r8', 'r8', 'r8', 'r8']);
  });

  it('leaves a grace beat\'s written value to alphaTab, and still settles the bar', () => {
    // A quarter, a grace written as a quarter, and three quarters: full, since a grace takes no
    // room. `Beat.finish` sets a grace's value from the size of its grace group, so a value set
    // here would not survive a save; the grace keeps its quarter. The first beat becomes a
    // sixteenth, and the three sixteenths it frees fill right after it as a dotted eighth - in
    // front of the grace, which still leads into the quarter after it.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(4));
    withNote(doc, 0, 1);
    beats(doc)[1].effects.grace = 'beforeBeat';

    setBeatDurations(doc, [ref(0, 0), ref(0, 1)], 16, 0);

    expect(beats(doc).map(beat => `${beat.duration}${'.'.repeat(beat.dots)}`)).toEqual(['16', '8.', '4', '4', '4', '4']);
    expect(beats(doc)[2].effects.grace).toBe('beforeBeat');
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('leaves a free-time bar as the change made it, taking none of its rests', () => {
    // The meter does not govern a free-time bar, so the quarter that becomes a half takes
    // nothing after it and nothing fills behind it: four beats, a half and three quarters,
    // 4800 ticks - and the bar still reads full, because a free-time bar always does.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[0].isFreeTime = true;

    setBeatDurations(doc, [ref(0, 0)], 2, 0);

    expect(beats(doc).map(beat => beat.duration)).toEqual([2, 4, 4, 4]);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
});

describe('setGrace', () => {
  it('fills the room a quarter frees by becoming a grace, in front of the grace', () => {
    // A grace takes no room, so a full 4/4 bar whose second quarter becomes a grace is a
    // quarter short. The gap opened where that quarter stood, and the rest goes there - in front
    // of the grace, at the same tick, so the grace still leads into the quarter after it.
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 1);

    setGrace(doc, [ref(0, 1)], 'beforeBeat');

    expect(beats(doc).map(beat => beat.effects.grace)).toEqual(['none', 'none', 'beforeBeat', 'none', 'none']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });

  it('takes the rest a grace led into when it becomes an ordinary beat again', () => {
    // A note, an on-beat grace written as a quarter, and three quarter rests: full. As an
    // ordinary beat the grace takes a quarter's room, and the rest after it is no longer led
    // into by a grace, so it is the room taken.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(1, 0, createRestBeat(4));
    withNote(doc, 0, 0);
    withNote(doc, 0, 1);
    beats(doc)[1].effects.grace = 'onBeat';

    setGrace(doc, [ref(0, 1)], 'none');

    expect(beats(doc).map(beat => (beat.isRest ? 'r' : 'n'))).toEqual(['n', 'n', 'r', 'r']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
});

describe('setTuplet', () => {
  it('makes three quarters a triplet and fills what they freed', () => {
    // Each triplet quarter frees 320 ticks, not a whole number of 64ths, so no rest can go where
    // one opened. Once all three are settled the bar is a quarter short, which fills at its end.
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
  Tuplet
} from '../models/composer.model';
import { absorbFollowingRests, barFillOf, barMeterAt, beatTicks, fillBarGaps, insertRestsAt } from './bar-fill';
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

/**
 * Presses a beat effect tool on `refs`, by the toggle rule.
 *
 * Every effect but `grace`, which the type leaves out: a grace takes no room, so becoming or
 * leaving one changes how full the bar is, and only `setGrace` settles the bar for it.
 */
export function toggleBeatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
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

/**
 * Gives every beat in `refs` a written value, then keeps each bar honest. See `relength`.
 *
 * Grace beats keep theirs. alphaTab sets a grace's written value itself when the score is
 * finished - an eighth, sixteenth or thirty-second by the size of its grace group
 * (`Beat.finish`, `alphaTab.core.mjs` ~7772-7786) - so a value set here would be drawn as
 * alphaTab's and lost on save. A grace takes no room either way, so skipping one changes no
 * bar's fill.
 */
export function setBeatDurations(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  duration: DurationValue,
  dots: number
): void {
  relength(doc, refs, beat => {
    if (beat.effects.grace !== 'none') return;
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
 * Makes every beat in `refs` a grace of kind `grace`, or an ordinary beat again with `'none'`.
 * See `relength`.
 *
 * A length change, not an effect: a grace takes no room (`beatTicks`), so a beat that becomes
 * one frees its value's worth of the bar, which fills with rests where it stood - in front of
 * the grace, so it still leads into the beat after it - and a grace that becomes an ordinary
 * beat takes room, which takes the rests after it or is left as overflow.
 */
export function setGrace(doc: ScoreDoc, refs: readonly BeatRef[], grace: BeatEffectsDoc['grace']): void {
  relength(doc, refs, beat => {
    beat.effects.grace = grace;
  });
}

/**
 * Applies a length change to beats and settles each bar they are in, by the design's rule:
 * a beat that grows takes the rests after it, never a note, a grace, or another beat being
 * changed; whatever it cannot take is left as overflow for Fix bar; and a gap fills with rests
 * where it opened. A beat's length is `beatTicks`, so becoming or leaving a grace is a change
 * like any other. Each bar is settled against its own `barMeterAt`, read once and passed to
 * everything that settles it, so a free-time bar is left as the change made it: none of its
 * rests are taken and no gap is filled.
 *
 * Each beat is settled as it changes, at that beat. One that shrinks frees room right after it.
 * One that grows takes the rests after it, and when the last rest it took was longer than it
 * needed, the spare (`RestsTaken.overTaken`) is room freed right after it. Freed room fills with
 * rests there (`insertRestsAt`), spelled from where it starts - but only as much as the bar is
 * now short, so a beat that shrinks in an overflowing bar uses up the overflow first. So four
 * quarters set to eighths are `n8 r8 n8 r8 n8 r8 n8 r8`, and `n4 r4 r4 r4` dotted is
 * `n4. r8 r4 r4`.
 *
 * Beats are changed last to first within a bar, so settling one never moves a beat still
 * waiting its turn. A beat settled exactly keeps everything after it where it was, so the rests
 * already placed for later beats stay where their gaps opened. A bar still short once every beat
 * is settled - one that arrived short, or a gap no rest could spell at its position, such as a
 * tuplet's remainder - fills at its end (`fillBarGaps`), where that can be spelled.
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
    const meter = barMeterAt(doc, barIndex);
    for (const beat of [...beats].reverse()) {
      const before = beatTicks(beat);
      change(beat);
      const grown = beatTicks(beat) - before;
      const freed = grown > 0 ? absorbFollowingRests(voice, beat, grown, changing, meter).overTaken : -grown;
      const fill = barFillOf(bar, meter);
      if (freed > 0 && fill.kind === 'under') {
        insertRestsAt(voice, voice.beats.indexOf(beat) + 1, Math.min(freed, fill.ticks), meter);
      }
    }
    fillBarGaps(bar, meter);
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
import { EditScope, editRefusal } from './edit-refusals';
import { AccidentalMode, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

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

  describe('an accidental', () => {
    const accidental = (forced: AccidentalMode): EditScope => ({ family: 'note', key: 'accidental', accidental: forced });

    /** The document with its guitar note moved to `string` and `fret`. */
    function guitarAt(string: number, fret: number): ScoreDoc {
      const score = doc();
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].pitch = { kind: 'fretted', string, fret };
      return score;
    }

    it('is refused on a note it cannot spell - a sharp on a fretted D', () => {
      // String 2 (B, 59) at fret 3 is D, 62. A sharp shifts it to 61, a black key, so
      // alphaTab would take the line from the key signature.
      expect(editRefusal(guitarAt(2, 3), [ref(0)], accidental('sharp'), null)).toMatch(/line/i);
    });

    it('is allowed on a note it can spell - a flat on a fretted B flat', () => {
      // String 3 (G, 55) at fret 3 is B flat, 58. A flat shifts it to 59, B.
      expect(editRefusal(guitarAt(3, 3), [ref(0)], accidental('flat'), null)).toBeNull();
    });

    it('reads a fretted note under a capo as alphaTab draws it, capo included', () => {
      // Fret 2 on string 2 is C sharp without a capo and D with one.
      const score = guitarAt(2, 2);
      expect(editRefusal(score, [ref(0)], accidental('sharp'), null)).toBeNull();

      score.tracks[0].staves[0].capo = 1;
      expect(editRefusal(score, [ref(0)], accidental('sharp'), null)).toMatch(/line/i);
    });

    it('is never refused as auto, which forces nothing', () => {
      expect(editRefusal(guitarAt(2, 3), [ref(0)], accidental('auto'), null)).toBeNull();
    });

    it('is checked on a pitched staff too', () => {
      // The piano's note is C, pitch class 0. A flat shifts it up to 1, a black key, so it
      // is refused. A sharp shifts it down to 11, B - a B sharp, on the B line - so it is not:
      // what is refused is an overshoot onto a black key, not a sharp on a white one.
      const score = doc();
      expect(editRefusal(score, [ref(1)], accidental('flat'), null)).toMatch(/line/i);
      expect(editRefusal(score, [ref(1)], accidental('sharp'), null)).toBeNull();

      // C sharp is 1. A flat shifts it up to 2, D - a D flat.
      score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].pitch = { kind: 'pitched', noteValue: 1, octave: 4 };
      expect(editRefusal(score, [ref(1)], accidental('flat'), null)).toBeNull();
    });

    it('checks only the focused note of a chord on one beat, and every note of a range', () => {
      // String 3 (G, 55) at fret 3 is B flat, 58: a flat shifts it to 59, B. String 2 (B, 59)
      // at fret 3 is D, 62: a flat shifts it to 63, a black key. Focus 2 is tab string 3.
      const score = guitarAt(3, 3);
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.push(
        { pitch: { kind: 'fretted', string: 2, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }
      );

      expect(editRefusal(score, [ref(0)], accidental('flat'), 2)).toBeNull();
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/line/i);
      // A range means every note in it, focus or not - here the chord and the rest after it.
      expect(editRefusal(score, [ref(0), ref(0, 1)], accidental('flat'), 2)).toMatch(/line/i);
    });

    it('subtracts a display transposition, as alphaTab draws it', () => {
      // `Note.displayValue` is the sounding value less `displayTranspositionPitch`, so with 1
      // the fretted B flat, 58, is drawn as an A, 57, and a flat shifts that to 58, a black
      // key. Added instead, it would be drawn from 59, B, and a flat would shift that to 60,
      // C - still allowed, which is how this spec tells the two signs apart.
      const score = guitarAt(3, 3);
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toBeNull();

      score.tracks[0].staves[0].displayTranspose = 1;
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/line/i);
    });

    it('is refused on a natural harmonic, which is not drawn at its fret', () => {
      // The B flat a flat is allowed on above. The mapper writes `harmonicType` and not
      // `harmonicValue`, so alphaTab draws a natural harmonic at the open string's pitch - G,
      // 55, whose flat would land on 56, a black key - and not at the fret the check reads.
      const score = guitarAt(3, 3);
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/harmonic/i);
    });

    it('is not refused on a pitched note marked as a natural harmonic, which is drawn at its pitch', () => {
      // alphaTab moves a natural harmonic only on a stringed note (`isStringed`), so the
      // piano's C is drawn as C and a sharp spells it as B sharp, as above.
      const score = doc();
      score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

      expect(editRefusal(score, [ref(1)], accidental('sharp'), null)).toBeNull();
    });
  });
});
```

**Step 2: Run** `--include=src/app/services/edit-refusals.spec.ts`. Expected: compile error.

**Step 3: Implement** `edit-refusals.ts`:

```typescript
import { AccidentalMode, NoteEffectsDoc, NotePitch, ScoreDoc, StaffDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';
import { notesAt } from './note-edits';
import { forcedLetterOf, reduceToOctave } from './note-spelling';

/**
 * What kind of edit is being asked about.
 *
 * An accidental press is a variant of its own that must say which accidental it would
 * force, so the refusal can check that accidental can spell every note. With the field
 * optional on one shared note variant, a caller could leave it out and skip the check
 * without a compile error; as its own variant, `{ family: 'note', key: 'accidental' }`
 * does not type-check.
 *
 * `forcedLetterOf` comes from `note-spelling.ts`, not the mapper: this module stays pure,
 * and importing an `@Injectable` service file would pull alphaTab in with it.
 */
export type EditScope =
  | { family: 'beat' }
  | { family: 'note'; key: keyof NoteEffectsDoc | 'tie' }
  | { family: 'note'; key: 'accidental'; accidental: AccidentalMode }
  | { family: 'track'; trackIndex: number };

/** Techniques that only mean something on a string. */
const FRETTED_ONLY: ReadonlySet<string> = new Set(['bendPoints', 'slide', 'isLeftHandTapped', 'harmonic']);

const GENERATED =
  'That reaches a track generated from a progression. Flatten the track to edit it by hand.';

const UNSPELLABLE = 'That accidental cannot spell this note - it would be drawn on the wrong line.';

const NATURAL_HARMONIC = "A natural harmonic's accidental cannot be forced yet.";

/**
 * The pitch class alphaTab draws a note from, before a forced accidental shifts it.
 *
 * `AccidentalHelper.getNoteValue` (`alphaTab.core.mjs` ~24936 in 1.8) starts from
 * `Note.displayValue`: `realValue` less the staff's display transposition (~6215), moved by
 * whole octaves for an ottava, which leaves the pitch class alone. `realValue` is
 * `fret + stringTuning` on a string (~6071) and `octave * 12 + tone` otherwise (~6074), less
 * the staff's transposition - and `Note.stringTuning` is the capo plus the string's tuning
 * (~6032). So a capo moves the drawn note exactly as it moves the sounding one.
 *
 * Two parts of `displayValue` are left out. A pre-bend adds its initial bend, but
 * `Note.finish` resets a forced accidental on a pre-bent note (~6473), so nothing is drawn
 * wrong there. A natural harmonic is not drawn at its fret at all: `calculateRealValue`
 * puts it at `harmonicPitch` above the open string, capo included (~6059), and
 * `harmonicPitch` (~6078) reads `Note.harmonicValue`, which the mapper does not write. At
 * alphaTab's default of 0 that is 0, so a natural harmonic is drawn at the open string's
 * pitch whatever the fret. This function would read the fret, so `editRefusal` refuses a
 * forced accidental on a fretted natural harmonic before it asks. Both of those alphaTab
 * branches test `isStringed`, so a pitched note marked natural is drawn at its own pitch
 * and is read correctly here.
 */
function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
  const sounding =
    pitch.kind === 'fretted'
      ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
      : pitch.noteValue;
  return reduceToOctave(sounding - staff.transpose - staff.displayTranspose);
}

/**
 * Whether forcing `accidental` would leave any note a press means without a letter.
 *
 * One ref at a time, because the pitch class depends on each note's staff. The focus
 * narrows only a single-beat selection, as it does in `notesAt`.
 */
function anyNoteUnspellable(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  accidental: AccidentalMode
): boolean {
  const narrowed = refs.length === 1 ? focus : null;
  return refs.some(ref => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return (
      staff !== undefined &&
      notesAt(doc, [ref], narrowed).some(
        note => forcedLetterOf(accidental, drawnPitchClassOf(staff, note.pitch)) === undefined
      )
    );
  });
}

/**
 * Why an edit cannot apply to `refs`, or null when it can.
 *
 * Whole or nothing: one generated track anywhere in a range refuses the entire press, so a
 * range is never half-edited. `focus` must be the same one the edit will use, so this and
 * `notesAt` agree about which notes a press means.
 *
 * A forced accidental that cannot name one of its notes is refused rather than set to
 * `auto`: alphaTab would draw that note on a line chosen by the key signature while it
 * sounds right. The check is `forcedLetterOf`, the predicate the mapper reads a letter back
 * with, but not asked of the same pitch. The mapper asks it of a pitched note's stored
 * pitch class, with no transposition applied; this asks it of the pitch as drawn,
 * transposition and display transposition included. The two agree whenever a staff's
 * transpositions come to a whole number of octaves. A natural harmonic is refused outright:
 * see `drawnPitchClassOf`.
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
  const notes = notesAt(doc, refs, focus);
  if (notes.length === 0) return 'There is no note there to change.';
  // Fretted notes only. alphaTab moves a natural harmonic off its fret only on a stringed
  // note: `calculateRealValue`'s harmonic branch and `harmonicPitch` both test `isStringed`
  // (`Note.string >= 0`, ~5677; ~6053-6090), and the mapper sets `string` only for a fretted
  // pitch, so a pitched note keeps its default of -1. A pitched note marked natural - which
  // an alphaTex import can produce - is drawn at its own pitch, and the spelling check
  // below reads it correctly.
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    notes.some(note => note.pitch.kind === 'fretted' && note.effects.harmonic === 'natural')
  ) {
    return NATURAL_HARMONIC;
  }
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    anyNoteUnspellable(doc, refs, focus, scope.accidental)
  ) {
    return UNSPELLABLE;
  }
  return null;
}
```

**Step 4: Run.** Expected: all SUCCESS.

**Step 5: Commit** both files: `feat: One place that says why an edit cannot apply`.

### Task C5: Bar edits

Key signature and clef live on every bar, with no inherit, so "set from this bar" means:
from this bar forward, for as long as the bars still carry the value the first bar had -
the next deliberate change stops it. A time signature inherits, so it is declared once and
the bars under it are fitted: trailing rests go while a bar is over, gaps fill at the end of the
bar, where a meter change opens them, and notes that no longer fit stay as overflow for Fix bar.
A free-time bar is left as it is.

Free time is a bar flag, and nothing fits a bar while it is in free time, so taking a bar out
of free time fits it to its meter in the same edit, on every staff - otherwise a short bar
would stay short until its next length edit. Putting a bar into free time changes nothing
else.

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
import { createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

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

  it('leaves a bar that is only a whole rest as it is, since that fills any meter', () => {
    // Measured by written value the rest would be 960 over in 3/4, taken, and refilled as a
    // dotted half. alphaTab draws it as a full-bar rest, so nothing needs to change.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1)];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([1]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });

  it('keeps a whole rest that fills the bar once the rests after it are gone', () => {
    // 5/4's whole rest and quarter rest are 4800 ticks, over 3/4's 2880. Taking the quarter
    // leaves the whole rest alone, which fills any meter, so the fit stops there.
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].timeSignature = { numerator: 5, denominator: 4, isCommon: false };
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(1), createRestBeat(4)];

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([1]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });

  it('leaves a free-time bar as it is, and fits the bars after it', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].isFreeTime = true;

    setTimeSignature(doc, 1, THREE_FOUR);

    expect(doc.tracks[0].staves[0].bars.map(bar => bar.voices[0].beats.length)).toEqual([4, 4, 3, 3]);
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

  it('fits a bar taken out of free time to its meter, on every staff', () => {
    // Bar 2 is a lone quarter rest in free time on both tracks, full while free. Out of free
    // time it is 4/4's, 2880 ticks short from beat 2: the gap fills to the half-bar with a
    // quarter rest, then a half rest, so the bar is a quarter, a quarter and a half, and full.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.masterBars[1].isFreeTime = true;
    for (const track of doc.tracks) {
      for (const staff of track.staves) staff.bars[1].voices[0].beats = [createRestBeat(4)];
    }

    toggleMasterBarFlag(doc, { first: 1, last: 1 }, 'isFreeTime');

    expect(doc.masterBars[1].isFreeTime).toBeFalse();
    for (const track of doc.tracks) {
      for (const staff of track.staves) {
        expect(staff.bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([4, 4, 2]);
      }
    }
    expect(scoreBarFills(doc).every(track => track.every(staff => staff[1].kind === 'full'))).toBeTrue();
  });

  it('leaves a bar put into free time as it was', () => {
    // A lone quarter rest is 2880 ticks short in 4/4. Free time changes nothing in the bar:
    // it only stops the meter governing it, so the bar reads full holding the same quarter.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[1].voices[0].beats = [createRestBeat(4)];

    toggleMasterBarFlag(doc, { first: 1, last: 1 }, 'isFreeTime');

    expect(doc.masterBars[1].isFreeTime).toBeTrue();
    expect(doc.tracks[0].staves[0].bars[1].voices[0].beats.map(beat => beat.duration)).toEqual([4]);
    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'full' });
  });
});
```

**Step 2: Run** `--include=src/app/services/bar-edits.spec.ts`. Expected: compile error.

**Step 3: Implement.** Append to `bar-fill.ts`:

```typescript
/**
 * Settles a bar after its meter changed: trailing rests go while the bar is over, a gap fills
 * with rests, and notes that no longer fit stay as overflow for Fix bar.
 *
 * The gap fills at the end of the bar (`fillBarGaps`), because that is where a meter change
 * opens it: no beat changed length, the bar did. Rests go only while the bar is over
 * (`takeTrailingRests`), so a whole rest left alone once the rests after it are gone stays,
 * because that fills any meter (`barFillOf`): 5/4's `r1 r4` fitted to 3/4 keeps its whole rest.
 * Trailing rests stop at a grace beat or a rest one leads into, so a bar ending that way can
 * stay over. A free-time bar is never over or under, so nothing here changes one.
 */
export function fitBarToMeter(bar: BarDoc, meter: BarMeter): void {
  takeTrailingRests(bar, meter);
  fillBarGaps(bar, meter);
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
import { barMeterAt, fitBarToMeter } from './bar-fill';
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
 * that declared this same meter drops its now-repeated declaration. Each bar is fitted against
 * its own `barMeterAt`, read after the declarations change, so a free-time bar keeps what it
 * holds.
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
        if (bar) fitBarToMeter(bar, barMeterAt(doc, index));
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

/**
 * Presses a bar flag tool across bars `first` to `last`, by the toggle rule.
 *
 * Free time is the one flag that changes how a bar is measured. Nothing fits a bar while it is
 * in free time (`barFillOf` calls it full), so each bar this press takes out of free time is
 * fitted to its meter on every staff, read after the flag changes - otherwise a short bar would
 * stay short until its next length edit. Putting a bar into free time changes nothing else.
 */
export function toggleMasterBarFlag(
  doc: ScoreDoc,
  bars: { first: number; last: number },
  key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'
): void {
  const targets = doc.masterBars.slice(bars.first, bars.last + 1);
  const value = toggledValue(targets.map(bar => bar[key]), true, false);
  const leavingFreeTime = targets.flatMap((bar, offset) =>
    key === 'isFreeTime' && bar.isFreeTime && !value ? [bars.first + offset] : []
  );
  for (const bar of targets) bar[key] = value;

  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      for (const index of leavingFreeTime) {
        const bar = staff.bars[index];
        if (bar) fitBarToMeter(bar, barMeterAt(doc, index));
      }
    }
  }
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

  it('makes a grace by the toggle rule, settling the bar each way', () => {
    // The caret's quarter rest becomes a grace, which takes no room. The rest that fills its gap
    // goes where the quarter stood, in front of the grace, so the grace moves to index 2 and
    // index 1 - where the caret stays - is the new rest. With the caret moved onto the grace,
    // pressed again it is a quarter, and takes the rest it led into.
    const beats = () => service.doc.tracks[0].staves[0].bars[0].voices[0].beats;
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.toggleGrace('beforeBeat');
    expect(beats().map(beat => beat.effects.grace)).toEqual(['none', 'none', 'beforeBeat', 'none', 'none']);

    service.setCursor({ barIndex: 0, beatIndex: 2 });
    service.toggleGrace('beforeBeat');
    expect(beats().map(beat => beat.effects.grace)).toEqual(['none', 'none', 'none', 'none']);
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

**Step 3: Implement.** Import `selectionTargets`, `BeatRef`, the beat and note edits (`beatsAt`,
`setGrace` and `toggledValue` among them), and `editRefusal`/`EditScope`. Add to
`ComposerService`:

```typescript
  // -------------------------------------------------------------------------
  // Edits on the selection
  // -------------------------------------------------------------------------

  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit({ family: 'note', key }, (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off));
  }

  setAccidental(accidental: AccidentalMode): void {
    this.applyEdit({ family: 'note', key: 'accidental', accidental }, (draft, refs, focus) => setAccidental(draft, refs, focus, accidental));
  }

  toggleTie(): void {
    this.applyEdit({ family: 'note', key: 'tie' }, (draft, refs, focus) => toggleTie(draft, refs, focus));
  }

  /** Presses a beat effect tool on the selection. Not grace: see `toggleGrace`. */
  toggleBeatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
    key: K,
    on: BeatEffectsDoc[K],
    off: BeatEffectsDoc[K]
  ): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) => toggleBeatEffect(draft, refs, key, on, off));
  }

  /**
   * Presses Grace before or Grace on beat, by the toggle rule: when every target is already
   * that grace, they become ordinary beats again. A grace takes no room, so this is a length
   * change, and `setGrace` settles each bar as a duration change does.
   */
  toggleGrace(grace: Exclude<BeatEffectsDoc['grace'], 'none'>): void {
    this.applyEdit({ family: 'beat' }, (draft, refs) =>
      setGrace(draft, refs, toggledValue(beatsAt(draft, refs).map(beat => beat.effects.grace), grace, 'none'))
    );
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

  /**
   * A bar flag over the selected bars. Taking bars out of free time fits them to their meter
   * in the same commit (`toggleMasterBarFlag`), so that is one undo step too, and like any bar
   * edit it stamps generated tracks diverged.
   */
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
`setBeatDurations` leaves a grace beat's written value to alphaTab (Task C2), so a duration
pressed on a grace, or a note written on one, keeps the grace's value. And it puts each gap's
rests where the gap opened, so an eighth written on an empty bar's first beat is followed by
its eighth rest, and the caret's next step lands on that rest, where Guitar Pro puts it.

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

  it('fills the bar when a shorter duration is applied, right after the beat', () => {
    // The caret's quarter becomes an eighth, and the eighth rest goes where its gap opened, at
    // 480, so the three quarter rests keep their places.
    service.applyDurationAtCursor(8, 0);

    expect(firstBar().map(beat => beat.duration)).toEqual([8, 8, 4, 4, 4]);
  });

  it('applies a duration to every beat of a range', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 3 });

    service.applyDurationAtCursor(8, 0);

    // Each quarter becomes an eighth with its eighth rest right after it, settled last to first
    // so no settled rest moves.
    expect(firstBar().map(beat => beat.duration)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });

  it('writes a longer note by taking the rests after it', () => {
    // The half needs 960 more ticks and the quarter rest after it is exactly that, so nothing is
    // over-taken and nothing goes back.
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
   * `setBeatDurations`: a gap fills with rests where it opened, and a beat that grows takes
   * only rests.
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
      // Length first, so the bar settles before the note lands. Settling only removes or
      // inserts beats after this one, so `beat` is still the caret's beat.
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

**Step 3: Implement** (import `barFillAt` and `fixBarOverflow`):

```typescript
  /**
   * Fix bar: carries the overflow of every over bar in the selection, on the caret's staff,
   * into the bars after it.
   *
   * Runs on a clone and commits only if every bar fixed, because `fixBarOverflow` can refuse
   * part-way - a tuplet across a line - and a half-carried score is exactly the corruption
   * the refusal exists to prevent. Refused on a generated track like any content edit.
   * Appending a bar is score-wide, so it stamps generated tracks diverged; carrying within
   * existing bars touches only this staff and does not. Each selected bar is read with
   * `barFillAt`, against its own meter and free time, rather than measuring the whole score
   * once per bar.
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
      if (barFillAt(draft, trackIndex, staffIndex, index)?.kind !== 'over') continue;
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
1. Shorten the first beat to an eighth: an eighth rest appears right after it, and the quarter
   rests after that keep their places.
2. Write four notes in a bar and lengthen the first to a half: nothing is overwritten.
3. Open the alphaTex panel, add `{h}` after a note's string (`3.3{h}.4`), apply, save to
   the library, reload the page, load it: the hammer-on is still there.
4. Load a saved score and change the BPM: playback follows.

**Step 5: Commit** the documents: `docs: Record M1 of the composer editor - what shipped and what it corrected`.

**Checkpoint, 2026-09-13.** Both type checks clean; the whole suite **2,669 specs, 0 failures**.
No file M1 touched passes 1000 lines: the largest are `bar-fill.spec.ts` (969) and
`composer.service.ts` (940, after the bar and track commands moved to
`composer-service-structure.ts`).

**Hand check, 2026-09-13: passed**, against this worktree's dev server, reading the
regenerated alphaTex from the source panel each time. (1) In an empty 4/4 bar, beat 1 made an
eighth read `r.8 r.8 r.4 r.4 r.4`. (2) `5.3{h}.4 6.3.4 7.3.4 8.3.4` with beat 1 made a half read
`5.3{h}.2 6.3.4 7.3.4 8.3.4`: nothing overwritten, the bar left over, the hammer-on kept. (3) That
score saved to the library, the page reloaded and the score loaded still read the same. (4) On
the loaded score, `\tempo 120` became `\tempo 90` when the BPM field was set to 90. Not exercised
by hand: range selection, Fix bar, and the bar and track commands, which M1 gives no control -
they arrive with M2's palette and are covered by specs only.
