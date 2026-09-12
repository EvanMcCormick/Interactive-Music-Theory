# Progression Composer M4 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A progression becomes a track inside the Composer — badged, read-only, updated
when the user asks and flattened when they want it detached — and both pages export MIDI
and `.gp` with every note on the letter its degree names.

**Architecture:** Pure modules first, UI last, as in M2 and M3. The spelling work comes
before the track work because the track is the reason the spelling matters, and it is
testable on its own against the preview that already exists. The generated track is a
real `TrackDoc` carrying a marker; every write to it is a user action and goes through
the Composer's existing `commit()`, so undo needs no special case.

**Tech Stack:** Angular 21 standalone, RxJS 7.8, alphaTab 1.7, Jasmine/Karma.

**Design doc:** `docs/plans/2026-09-08-progression-composer-design.md` — read
**"M4 decisions"** at the end before starting. Where it conflicts with older sections
("Build order" and the generated-track paragraphs above all), it wins.

**M3 plan, for what already exists:** `docs/plans/2026-09-10-progression-m3-recogniser.md`

**Test command:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless
```
Run from `client/`. Add `--include='**/<name>.spec.ts'` to run one spec. **Baseline at
the start of M4: 2224 tests, 0 failures.** It moves as tasks land; check `git log`
rather than trusting a number written here.

**Worktree:** `.worktrees/progression-m4`, branch `feature/progression-m4-composer-track`.

---

## Task 1: `revision` on `ProgressionDoc`

**Files:**
- Modify: `client/src/app/models/progression.model.ts` — `ProgressionDoc`, `createDefaultProgression`
- Modify: `client/src/app/services/progression-history.ts:230` — `commit`
- Test: `client/src/app/services/progression.service.revision.spec.ts` (create)

The staleness check the Composer reads. It goes on the document rather than beside it so
that undo restores it with the document it belongs to — see step 3, which is the point of
the task.

**Step 1: Write the failing test**

```typescript
// progression.service.revision.spec.ts
describe('ProgressionService revision', () => {
  it('starts at 0 and rises once per commit', () => {
    expect(service.state.doc.revision).toBe(0);
    service.appendChord(0);
    expect(service.state.doc.revision).toBe(1);
    service.setTempo(96);
    expect(service.state.doc.revision).toBe(2);
  });

  // The reason the counter lives on the document. A track built from revision 1
  // and then undone back to revision 1 is not stale, and would be if undo
  // stamped a fresh number onto an identical document.
  it('travels backwards with undo rather than counting the undo', () => {
    service.appendChord(0);
    const at = service.state.doc.revision;
    service.appendChord(1);
    service.undo();
    expect(service.state.doc.revision).toBe(at);
  });

  it('does not rise on a publish that changes no document', () => {
    service.appendChord(0);
    const at = service.state.doc.revision;
    service.selectSlot(service.state.doc.slots[0].id);
    expect(service.state.doc.revision).toBe(at);
  });
});
```

Copy the `beforeEach` from `progression.service.spec.ts` verbatim; do not invent a
different harness.

**Step 2: Run it and watch it fail**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/progression.service.revision.spec.ts'`
Expected: FAIL — `revision` does not exist on `ProgressionDoc`.

**Step 3: Implement**

In `progression.model.ts`, on `ProgressionDoc`, after `id`:

```typescript
  /**
   * Bumped once per commit, and the whole of the Composer's staleness check.
   *
   * On the document rather than beside it, because undo restores a *document*:
   * a generated track built from revision 4 and then undone back to the
   * document that was revision 4 is current again, and a counter that lived on
   * the store would say stale about a document that had not changed. See
   * "Staleness is one comparison, and it is exact" in the design doc, which
   * also records why a counter is exact here and a projection hash is not
   * needed: every field of this interface reaches the generated track.
   */
  revision: number;
```

`createDefaultProgression()` gains `revision: 0`.

In `progression-history.ts`, inside `commit`, replace the settle line:

```typescript
    // Stamped here rather than inside `settle`, which `load` also calls and
    // which specs lean on being idempotent. `commit` is the one door a mutation
    // comes through, so it is the one place a mutation can be counted.
    const settled = { ...settle(draft), revision: state.doc.revision + 1 };
```

`undo`, `redo` and `load` are untouched: they publish a stored document, which
carries the revision it had.

**Step 4: Run and watch it pass**

Expected: PASS, 3 tests. Then run the whole suite — `normalizeProgressionDoc` spreads
`...doc` so `revision` survives normalisation, but any spec that builds a
`ProgressionDoc` literal will now fail to compile.

**Step 5: Fix the compile failures**

Add `revision: 0` to every `ProgressionDoc` literal the compiler names. Do not add it
via a helper or a cast.

**Step 6: Commit**

```
feat: Count a progression's revisions on the document
```

---

## Task 2: A letter on `NotePitch`, and the alphaTab mapping

**Files:**
- Modify: `client/src/app/models/composer.model.ts` — `NoteLetter`, `NotePitch`
- Modify: `client/src/app/services/note-spelling.ts` — export `letterOf`
- Modify: `client/src/app/services/score-doc-mapper.service.ts:292` (`toNote`) and `:460` (the reverse)
- Test: `client/src/app/services/score-doc-mapper.spelling.spec.ts` (create)

**Step 1: Write the failing test**

The first assertion is the one that matters. It pins behaviour read out of alphaTab's
bundle rather than out of its typings, so if alphaTab changes how a forced accidental
displaces a note, this is what says so.

```typescript
// score-doc-mapper.spelling.spec.ts
const LETTERS: NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL: Record<NoteLetter, number> =
  { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

describe('ScoreDocMapperService spelling', () => {
  it('displaces a forced note onto the letter its spelling names', () => {
    for (const letter of LETTERS) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        const alter = normalisedAlter(pitchClass, NATURAL[letter]);
        if (Math.abs(alter) > 2) continue;

        const note = mapOneNote({ kind: 'pitched', noteValue: pitchClass, octave: 4, letter });
        // AccidentalHelper displaces by the forced accidental and draws THAT
        // value's line. The displaced value must be the letter's natural pitch,
        // which is always a white key - which is why this is key-independent.
        expect(displacedValue(note) % 12).toBe(NATURAL[letter]);
      }
    }
  });

  it('round-trips every letter within a double accidental', () => {
    for (const letter of LETTERS) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        if (Math.abs(normalisedAlter(pitchClass, NATURAL[letter])) > 2) continue;
        const doc: NotePitch = { kind: 'pitched', noteValue: pitchClass, octave: 4, letter };
        expect(roundTrip(doc)).toEqual(doc);
      }
    }
  });

  it('drops a letter more than a double accidental away', () => {
    // C against pitch class 6 is a triple sharp. Not notation, so no letter.
    const note = mapOneNote({ kind: 'pitched', noteValue: 6, octave: 4, letter: 'C' });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });

  it('leaves a note with no letter exactly as it was', () => {
    const note = mapOneNote({ kind: 'pitched', noteValue: 11, octave: 4 });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });
});
```

`displacedValue` mirrors `AccidentalHelper.getNoteValue`: `tone` adjusted by `+1`
`ForceFlat`, `+2` `ForceDoubleFlat`, `-1` `ForceSharp`, `-2` `ForceDoubleSharp`. Write it
in the spec, not in `src`.

**Step 2: Run it and watch it fail**

Expected: FAIL — `letter` is not a property of the pitched variant.

**Step 3: Implement**

`composer.model.ts`, above `NotePitch`:

```typescript
/**
 * A staff letter. Declared here rather than in `note-spelling.ts` so the model
 * owns it and the spelling service imports it, which is the direction the
 * layers already run.
 */
export type NoteLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
```

`NotePitch`'s pitched variant gains:

```typescript
  | {
      kind: 'pitched';
      noteValue: number;
      octave: number;
      /**
       * The letter to engrave on, when the writer knows one.
       *
       * Absent means what the Composer has always done: spell from the key
       * signature. Only the progression's projection sets it, and only because
       * a pitch class does not have a letter and a degree does - see
       * "A letter on `NotePitch`" in the progression design doc.
       */
      letter?: NoteLetter;
    };
```

`note-spelling.ts` gains, beside `LETTER_NAMES`:

```typescript
/** The staff letter of a spelling, for a caller that wants the letter alone. */
export function letterOf(spelled: SpelledNote): NoteLetter {
  return LETTER_NAMES[(((spelled.letter % 7) + 7) % 7)] as NoteLetter;
}
```

In the mapper, above the class, the two conversions:

```typescript
/** Semitones above C of each letter's natural pitch. All white keys. */
const NATURAL_PITCH: Record<NoteLetter, number> =
  { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The accidental mode that makes alphaTab engrave `pitchClass` on `letter`.
 *
 * `AccidentalHelper.getNoteValue` displaces the note by exactly the forced
 * accidental and draws that value's line: the displaced value is the letter's
 * natural pitch, always a white key, so the key signature can never ambiguate
 * it. Past a double accidental there is no notation to ask for, so the letter
 * is dropped and alphaTab spells from the key signature - the same refusal
 * `spellAt` makes, one layer out.
 */
function accidentalModeFor(letter: NoteLetter, pitchClass: number): alphaTab.model.NoteAccidentalMode {
  const alter = ((((pitchClass - NATURAL_PITCH[letter] + 6) % 12) + 12) % 12) - 6;
  switch (alter) {
    case -2: return alphaTab.model.NoteAccidentalMode.ForceDoubleFlat;
    case -1: return alphaTab.model.NoteAccidentalMode.ForceFlat;
    case 0: return alphaTab.model.NoteAccidentalMode.Default;
    case 1: return alphaTab.model.NoteAccidentalMode.ForceSharp;
    case 2: return alphaTab.model.NoteAccidentalMode.ForceDoubleSharp;
    default: return alphaTab.model.NoteAccidentalMode.Default;
  }
}

/** The letter a forced accidental puts a pitch class on, or undefined if none is forced. */
function letterFor(mode: alphaTab.model.NoteAccidentalMode, pitchClass: number): NoteLetter | undefined {
  const alter = ALTER_BY_MODE.get(mode);
  if (alter === undefined) return undefined;
  const natural = ((((pitchClass - alter) % 12) + 12) % 12);
  return LETTER_BY_NATURAL[natural];
}
```

`ALTER_BY_MODE` maps the four forcing modes to `-2 | -1 | 1 | 2`; `LETTER_BY_NATURAL` is
`NATURAL_PITCH` inverted. Write both as module constants beside the functions.

In `toNote`, replace the `accidentalMode` assignment:

```typescript
    // A letter decides the mode; `accidental` only speaks when there is no
    // letter. Note that `'explicit'` has always meant ForceSharp, which forces
    // a sharp in a flat key - a misnomer `letter` routes around for generated
    // notes and leaves in place for composer-entered ones. See the design doc.
    note.accidentalMode =
      doc.pitch.kind === 'pitched' && doc.pitch.letter !== undefined
        ? accidentalModeFor(doc.pitch.letter, doc.pitch.noteValue)
        : doc.accidental === 'explicit'
          ? alphaTab.model.NoteAccidentalMode.ForceSharp
          : alphaTab.model.NoteAccidentalMode.Default;
```

In the reverse direction, the pitched branch gains
`letter: letterFor(note.accidentalMode, note.tone)`. Leave `accidental` as it is.

**Step 4: Run and watch it pass**

Expected: PASS. Run the whole suite; `score-doc-mapper.service.spec.ts` may need
`letter: undefined` tolerated in a deep equality — prefer fixing the assertion to
stripping the field.

**Step 5: Commit**

```
feat: Let a note say which letter to engrave it on
```

---

## Task 3: One spelling rule, out of the view

**Files:**
- Modify: `client/src/app/services/progression-spelling.ts` — export `slotSpeller`
- Modify: `client/src/app/components/progression/components/piano-roll/piano-roll-view.ts:158-168, 364-390`
- Test: `client/src/app/services/progression-spelling.spec.ts`, `piano-roll-view.spec.ts`

`chordToneSpellings` is the rule the score needs and it is private to a view file. Move
it, do not copy it: the letter the roll labels a key with and the letter the score
engraves must be the same letter.

**Step 1: Write the failing test**

In `progression-spelling.spec.ts`:

```typescript
describe('slotSpeller', () => {
  it('spells a chord tone by its position in the chord, not by the scale', () => {
    // The case the whole module exists for.
    const speller = slotSpeller(bFlatMajorKey, MAJOR_INTERVALS, flatTwoSlot);
    expect(formatNote(speller(11))).toBe('C♭');
  });

  it('falls through to the scale for a note the chord does not contain', () => { ... });

  it('falls through to the key when the slot has no degree', () => {
    const speller = slotSpeller(cMajorKey, MAJOR_INTERVALS, literalSlot);
    expect(formatNote(speller(6))).toBe('F♯');
  });

  it('keeps the lower position when one pitch class appears twice', () => { ... });
});
```

The last one is the "first spelling wins" rule the existing docstring states — a sus4 at
extent 11. Port the case from `piano-roll-view.spec.ts` rather than writing a new one.

**Step 2: Run and watch it fail**

Expected: FAIL — `slotSpeller` is not exported.

**Step 3: Implement**

Move `chordToneSpellings` into `progression-spelling.ts` with its docstring intact, and
wrap it in the function both callers actually want:

```typescript
/**
 * How this progression spells a pitch class in the context of one slot.
 *
 * Chord tones first, from the slot's own degree; then the scale; then the key's
 * preference. Lifted out of `piano-roll-view.ts`, where it was private, when M4
 * gave the projection the same question to answer - one rule, because the
 * letter the roll writes on a key and the letter the score engraves are the
 * same letter, and this file's header records what happens when one rule lives
 * in two places.
 *
 * `scaleIntervals` empty means the key's scale id resolved to nothing, and
 * every pitch class then falls through to the key's preference, which is what
 * `scaleNoteSpelling` does with a scale it cannot read degrees from.
 */
export function slotSpeller(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  slot: ChordSlot | null
): (pitchClass: number) => SpelledNote {
  const chordTones = chordToneSpellings(key, scaleIntervals, slot);
  return pitchClass =>
    chordTones.get(pitchClass) ?? scaleNoteSpelling(key, scaleIntervals, pitchClass);
}
```

`chordToneSpellings` loses its `ProgressionState` parameter. It used `state.canBuildChords`
and `state.keyScale`; both are answered by `scaleIntervals` being non-empty and
heptatonic, which `effectiveChord` and `chordRootSpelling` already require. Keep the
early return, now `if (!slot || slot.harmony.kind !== 'degree' || !isHeptatonic(scaleIntervals)) return spellings;`.

In `buildRollView`, delete the local function and the two lines above `columns`:

```typescript
  const spellHere = slotSpeller(state.doc.key, intervals, slot);
```

**Step 4: Run and watch it pass**

Expected: PASS. `piano-roll-view.spec.ts` must still pass unchanged except for cases
that reached the private function directly — move those to the new spec rather than
keeping both.

**Step 5: Commit**

```
refactor: Lift the roll's spelling rule to where the score can read it
```

---

## Task 4: The projection spells its notes

**Files:**
- Modify: `client/src/app/services/progression-score.ts` — `progressionToScore`, and wherever a `NoteDoc` is built
- Modify: `client/src/app/components/progression/components/progression-notation/progression-notation.component.ts`
- Test: `client/src/app/services/progression-score.spelling.spec.ts` (create)

**Step 1: Write the failing test**

```typescript
describe('progressionToScore spelling', () => {
  it('engraves a flat two on C flat, not on B', () => {
    // The deferral M3 recorded and this milestone is closing.
    const doc = progressionIn(bFlatMajor, [flatTwo]);
    const score = progressionToScore(doc, PROGRESSION_FINEST_DIVISION, MAJOR_INTERVALS);
    expect(lettersOf(score)).toContain('C');
    expect(lettersOf(score)).not.toContain('B');
  });

  it('leaves every note unlettered when no scale is given', () => {
    // The default argument is today's behaviour, so every existing caller and
    // spec keeps the result it had.
    const score = progressionToScore(doc);
    expect(lettersOf(score).every(l => l === undefined)).toBeTrue();
  });
});
```

**Step 2: Run and watch it fail**

Expected: FAIL — `progressionToScore` takes two arguments.

**Step 3: Implement**

`progressionToScore` gains a third parameter, defaulted so no existing caller or spec
changes:

```typescript
export function progressionToScore(
  doc: ProgressionDoc,
  finestDivision: FinestDivision = PROGRESSION_FINEST_DIVISION,
  /**
   * The key's scale, for spelling. Empty - the default - leaves every note
   * unlettered and alphaTab spells from the key signature, which is what this
   * module did before M4. The projection cannot resolve `key.scaleId` itself:
   * that needs `MusicTheoryService`, and this module is pure.
   */
  scaleIntervals: readonly number[] = []
): ProgressionScore {
```

`placeProgressionNotes` already carries each note's owning slot; thread a `slotSpeller`
per slot down to wherever the `NoteDoc` is built and set
`letter: letterOf(spell(midi % 12))` on the pitched variant. Build one speller per slot,
not one per note.

`progression-notation.component.ts` passes the scale it already has from the service
state: `progressionToScore(doc, PROGRESSION_FINEST_DIVISION, state.keyScale?.intervals ?? [])`.

**Step 4: Run and watch it pass**

Expected: PASS, and the whole suite green — the default keeps every existing assertion.

**Step 5: Hand-check**

Open `/progression`, switch to B♭ major, add the borrowed ♭II, open the notation panel.
The chord engraves on C with a flat. Before this task it engraved on B.

**Step 6: Commit**

```
feat: Engrave a progression on the letters its degrees name
```

---

## Task 5: `GeneratedOrigin` on `TrackDoc`

**Files:**
- Modify: `client/src/app/models/composer.model.ts` — `GeneratedOrigin`, `TrackDoc`
- Modify: `client/src/app/services/composer.service.ts` — `createTrack`, `createEmptyScore`
- Modify: `client/src/app/services/progression-score.ts:769` — the track literal
- Test: covered by Task 6

**Step 1: Add the interface**

```typescript
/**
 * What a generated track was generated from.
 *
 * `source` is a union rather than a `revision` plus a `diverged: boolean`
 * because the two can disagree and a union cannot: a score-wide bar insertion
 * moves a generated track's content without moving `ProgressionDoc.revision`,
 * so divergence is a *different* answer to "what is this built from", not an
 * extra flag on the same one. See "Divergence is a state of the source" in the
 * progression design doc.
 */
export interface GeneratedOrigin {
  progressionId: string;
  progressionName: string;
  source: { kind: 'revision'; revision: number } | { kind: 'diverged' };
}
```

`TrackDoc` gains `generated: GeneratedOrigin | null;` with a one-line comment pointing at
`progression-track.ts`.

**Step 2: Fix every construction site**

`ComposerService.createTrack` and the track literal in `progression-score.ts` both get
`generated: null`. The compiler names the rest.

**Step 3: Run the suite, fix literals, commit**

```
feat: Give a track somewhere to say what generated it
```

---

## Task 6: `progression-track.ts` — build one, and read its state

**Files:**
- Create: `client/src/app/services/progression-track.ts`
- Test: `client/src/app/services/progression-track.spec.ts` (create)

**Step 1: Write the failing test**

```typescript
describe('progressionTrack', () => {
  it('marks the track with the revision it was built from', () => { ... });
  it('carries the projection\'s truncation flag out', () => { ... });
  it('names the track after the progression', () => { ... });
});

describe('generatedTrackState', () => {
  it('is absent when no track carries a marker', () => { ... });
  it('is absent when the marker names a different progression', () => { ... });
  it('is current when the revisions match', () => { ... });
  it('is stale when the progression has moved on', () => { ... });
  it('is stale when the track has diverged', () => { ... });
});
```

**Step 2: Run and watch it fail**

Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
/**
 * The progression, as a track in somebody else's score.
 *
 * The arrow M4 adds, and the shortest one in the feature: `progression-score.ts`
 * already projects a whole `ScoreDoc`, so this module lifts the single track out
 * of it, marks it, and reconciles it with a score that already exists. It knows
 * nothing about Angular and nothing about alphaTab.
 *
 * Read "M4 decisions" in `docs/plans/2026-09-08-progression-composer-design.md`
 * before changing anything here. Three rules in particular are decisions rather
 * than implementation details, and each has a reason recorded there: bars grow
 * and never shrink, the score's meter and tempo win, and a marker is only ever
 * written by a user action.
 */

export type GeneratedTrackState = 'absent' | 'current' | 'stale';

export interface GeneratedTrack {
  track: TrackDoc;
  masterBars: MasterBarDoc[];
  truncated: boolean;
}

export function progressionTrack(
  doc: ProgressionDoc,
  scaleIntervals: readonly number[],
  meter: TimeSignature
): GeneratedTrack

/** Index of the track carrying a marker for `doc`, or -1. */
export function generatedTrackIndex(score: ScoreDoc, doc: ProgressionDoc): number

export function generatedTrackState(score: ScoreDoc, doc: ProgressionDoc): GeneratedTrackState
```

`progressionTrack` calls `progressionToScore({ ...doc, timeSignature: meter },
PROGRESSION_FINEST_DIVISION, scaleIntervals)` — the meter swap is the whole of "barred in
the score's meter", and it needs no change to the projection because `RollNote` beats are
quarter notes.

`generatedTrackState` returns `'absent'` when `generatedTrackIndex` is `-1`, `'stale'`
when the marker's `source.kind` is `'diverged'` or its revision differs, `'current'`
otherwise.

**Step 4: Run, pass, commit**

```
feat: Project a progression into a markable track
```

---

## Task 7: `mergeGeneratedTrack`, and the meter property

**Files:**
- Modify: `client/src/app/services/progression-track.ts`
- Test: `client/src/app/services/progression-track.spec.ts`

**Step 1: Write the failing tests**

```typescript
describe('mergeGeneratedTrack', () => {
  it('appends when the score has none', () => { ... });
  it('replaces in place, keeping the track order', () => { ... });
  it('grows masterBars to fit and pads every other staff', () => { ... });

  it('never shrinks the score', () => {
    // The rule that protects a user's own track from a progression that got
    // shorter. Four bars of rest is the right answer; deleting bar 7 is not.
    const eight = merge(emptyScore(), trackOf(eightBarProgression));
    const withWork = writeANoteIn(eight, /* track */ 0, /* bar */ 6);
    const four = merge(withWork, trackOf(fourBarProgression));
    expect(four.masterBars.length).toBe(8);
    expect(noteAt(four, 0, 6)).not.toBeNull();
  });

  it('keeps every staff at masterBars.length', () => {
    // The invariant stated at the top of composer.service.ts. Assert it after
    // each of the four merges above rather than trusting one case.
  });
});

describe('the meter is the score\'s, and re-barring moves no note', () => {
  it('places the same attacks in 4/4, 3/4 and 6/8', () => {
    const attacks = (meter: TimeSignature) =>
      attackSet(progressionTrack(doc, MAJOR_INTERVALS, meter));
    expect(attacks(THREE_FOUR)).toEqual(attacks(FOUR_FOUR));
    expect(attacks(SIX_EIGHT)).toEqual(attacks(FOUR_FOUR));
  });
});
```

`attackSet` returns a sorted array of `[absoluteBeat, midi]`, computed by walking the
bars and summing durations. Write it in the spec. This is the property the design's
meter rule rests on, so it is worth the twenty lines.

**Step 2: Run and watch it fail**

**Step 3: Implement**

```typescript
/**
 * Puts a generated track into a score that already exists.
 *
 * Bars grow and never shrink. A progression that got shorter leaves bars of
 * rest behind rather than deleting bars another track may be writing in - the
 * invariant at the top of `composer.service.ts` says every staff has exactly
 * `masterBars.length` bars, and this honours it in the one direction that
 * cannot destroy work.
 */
export function mergeGeneratedTrack(score: ScoreDoc, generated: GeneratedTrack): ScoreDoc
```

Steps, in order: find the existing index; take `barCount = max(score.masterBars.length,
generated.masterBars.length)`; extend `score.masterBars` from `generated.masterBars`
where the score is short; pad every staff of every track to `barCount` with
`createDefaultBar`; pad the generated track's own staff the same way; then splice it in
at the existing index or push it.

**Step 4: Run, pass, commit**

```
feat: Merge a generated track without shrinking the score
```

---

## Task 8: Flatten

**Files:**
- Modify: `client/src/app/services/progression-track.ts`
- Test: `client/src/app/services/progression-track.spec.ts`

**Step 1: Write the failing test**

```typescript
it('clears the marker and changes nothing else', () => {
  const before = merge(emptyScore(), trackOf(doc));
  const after = flattenGeneratedTrack(before, generatedTrackIndex(before, doc));
  expect(after.tracks[0].generated).toBeNull();
  expect({ ...after.tracks[0], generated: null })
    .toEqual({ ...before.tracks[0], generated: null });
});

it('leaves a score with no generated track alone', () => { ... });
```

**Step 2–4: Fail, implement, pass.** The implementation is one spread. If it is longer
than five lines, something else is being done that should not be.

**Step 5: Commit**

```
feat: Detach a generated track into an ordinary one
```

---

## Task 9: The Composer's three commands, and the edit gate

**Files:**
- Modify: `client/src/app/services/composer.service.ts` — three commands, `insertBar:392`, `removeBar:418`, the note-level commands
- Test: `client/src/app/services/composer.service.generated.spec.ts` (create)

**Step 1: Write the failing tests**

```typescript
describe('ComposerService generated tracks', () => {
  it('sends, and marks the track with the progression\'s revision', () => { ... });
  it('updates in place rather than appending a second', () => { ... });

  it('restores the old marker on undo, so the stale badge comes back', () => {
    // The property the whole explicit-Update design rests on. Every write is a
    // user action through commit(), so undo governs the marker too.
    service.sendProgression(built(atRevision(4)));
    service.updateProgression(built(atRevision(9)));
    service.undo();
    const marker = service.doc.tracks[0].generated!;
    expect(marker.source).toEqual({ kind: 'revision', revision: 4 });
  });

  it('refuses a note written into a generated track', () => { ... });
  it('allows the caret to select one', () => { ... });

  it('marks a generated track diverged when a bar is inserted', () => {
    // The hole the revision counter cannot see: the edit happened on the
    // score's side of the arrow.
    service.sendProgression(built(atRevision(4)));
    service.insertBar(1);
    expect(service.doc.tracks[0].generated!.source).toEqual({ kind: 'diverged' });
  });

  it('marks it diverged when a bar is removed', () => { ... });
  it('clears divergence on update', () => { ... });
});
```

**Step 2: Run and watch it fail**

**Step 3: Implement**

Three commands, each one call into the pure module inside the existing `commit()`:

```typescript
  /**
   * Puts the progression into the score, or refreshes the one already there.
   *
   * Both go through `commit()` like any edit, which is the whole reason the
   * explicit-Update model is safe: undo restores the old track *and* its old
   * marker, so the badge cannot end up claiming a freshness the document does
   * not have. `composer.service.generated.spec.ts` pins that.
   */
  sendProgression(generated: GeneratedTrack): void {
    this.commit(draft => Object.assign(draft, mergeGeneratedTrack(draft, generated)));
  }

  flattenTrack(index: number): void { ... }
```

`updateProgression` is `sendProgression`; keep one method and let the UI name it twice,
rather than two methods that must not drift.

The edit gate is one private predicate, `isGenerated(draft, trackIndex)`, consulted at
the top of every command that writes a note, a beat or a bar's contents. It does **not**
guard `insertBar`, `removeBar` or track selection.

`insertBar` and `removeBar` gain, inside their existing `commit`:

```typescript
      // Score-wide, so it moves a generated track's content without moving the
      // progression's revision. Divergence is how that becomes visible.
      for (const track of draft.tracks) {
        if (track.generated) track.generated = { ...track.generated, source: { kind: 'diverged' } };
      }
```

**Step 4: Run, pass, commit**

```
feat: Send, update and flatten a generated track
```

---

## Task 10: MIDI without an engraver

**Files:**
- Modify: `client/src/app/services/composer-export.service.ts`
- Modify: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts`
- Test: `client/src/app/services/composer-export.service.spec.ts` (create if absent)

**Step 1: Write the failing test**

```typescript
it('writes a standard MIDI header', () => {
  const bytes = exporter.toMidi(scoreOf(twoTrackDoc), new alphaTab.Settings());
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]); // MThd
});

it('needs no rendering api', () => {
  // The point of the change: the old downloadMidi required one, so one export
  // of three had a precondition the other two did not.
  expect(() => exporter.toMidi(scoreOf(twoTrackDoc), new alphaTab.Settings())).not.toThrow();
});
```

Do not assert the byte stream past the header.

**Step 2–4: Fail, implement, pass.**

```typescript
  /** Standard MIDI bytes, generated from the score with no engraver involved. */
  toMidi(score: alphaTab.model.Score, settings: alphaTab.Settings): Uint8Array {
    const file = new alphaTab.midi.MidiFile();
    const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(file, true);
    new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
    return file.toBinary();
  }
```

`downloadMidiFile(score, settings, fileName)` reuses the private `downloadBlob` with
`audio/midi` and the `mid` extension. Delete `downloadMidi(api)` and repoint the library
panel at the new one.

**Step 5: Commit**

```
refactor: Generate MIDI from the score rather than from the engraver
```

---

## Task 11: Export from the progression page

**Files:**
- Modify: `client/src/app/components/progression/progression.component.html` and `.ts`
- Modify: `client/src/app/components/progression/progression.component.scss`
- Test: `client/src/app/components/progression/progression.component.spec.ts`

**Step 1: Write the failing tests**

```typescript
it('exports the whole progression, not the preview\'s cap', () => { ... });

it('refuses to export a truncated projection', () => {
  // A file outlives the message beside it, so an export that silently dropped
  // bars would be a file that lies. The preview may draw 512 and say so.
  component.exportGuitarPro();
  expect(exporter.downloadGuitarPro).not.toHaveBeenCalled();
  expect(component.exportError).toContain('512');
});
```

**Step 2–4: Fail, implement, pass.** A third `rail-block` after Sound, in the voice of
the two above it — say what the control does, not just its name. Three buttons: Send to
Composer, Export MIDI, Export `.gp`. Each builds the `ScoreDoc` through
`progressionToScore`, maps it with `new alphaTab.Settings()`, and hands it to the
exporter. Send navigates to `/composer` after committing.

**Step 5: Commit**

```
feat: Export a progression, and send it to the composer
```

---

## Task 12: The Tracks panel

**Files:**
- Modify: `client/src/app/components/composer/composer.component.html:56-85` and `.ts`, `.scss`
- Test: `client/src/app/components/composer/composer.component.spec.ts`

The badge, Update (enabled only when stale), Flatten, and "Add progression track" beside
"Add track". Remove stays enabled: removing the track is not an edit of the progression.

Assert the disabled states, not the styling. Give Update an `aria-label` that says which
track and why it is offered — a badge is not reachable by a screen reader as an
explanation for a button beside it.

**Commit:**

```
feat: Badge, update and flatten a generated track in the tracks panel
```

---

## Task 13: Save refuses rather than flattening

**Files:**
- Modify: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.*`
- Test: its spec

**Step 1: Write the failing tests**

```typescript
it('refuses to save while a generated track is linked', () => {
  // alphaTex cannot round-trip the marker, so saving would silently flatten -
  // a change to the user's document they would not find until they reopened it.
  expect(library.save).not.toHaveBeenCalled();
  expect(panel.saveBlockedReason).not.toBeNull();
});

it('flattens and saves when the user takes the offer', () => {
  panel.flattenAndSave();
  expect(composer.doc.tracks.every(t => t.generated === null)).toBeTrue();
  expect(library.save).toHaveBeenCalled();
});

it('does not block export', () => { ... });
```

**Steps 2–4: Fail, implement, pass.**

**Step 5: Commit**

```
feat: Refuse to save a linked track, and offer to flatten it
```

---

## Task 14: Documentation

**Files:** `docs/plans/2026-09-08-progression-composer-design.md`, `docs/ROADMAP.md`,
`README.md`

- Design doc: status to "M1–M4 implemented". Under each M4 decision that implementation
  changed, a line saying what it changed and why — the "M4 decisions" section was written
  before the code and is a design until this task makes it a report. Record what Task 2
  measured about `AccidentalHelper` if it differed from what the design predicted, and
  whatever Task 7 found about staff padding.
- ROADMAP: M4 shipped, with what it added; the known-limitations paragraph gains the
  mid-score meter change.
- README: what a user can now do.

**Commit:**

```
docs: Catch the design doc and roadmap up with M4
```

---

## Hand-check before calling it done

On `/progression` in B♭ major:

1. Add the borrowed ♭II. Open the notation panel: it engraves on C with a flat, not on B.
2. Send to Composer. The Composer opens with a badged, read-only Progression track.
3. Try to type a note into it: refused. Click it in the Tracks panel: it selects.
4. Back on `/progression`, add a chord. Return to the Composer: the badge reads stale.
5. Press Update: the track redraws. Press undo: the old track *and* the stale badge come back.
6. Insert a bar into the score: the badge reads stale again, with the progression untouched.
7. Press Update, then Save: refused, with "Flatten and save" offered. Take it — the badge
   goes and the composition saves.
8. Export `.gp` from both pages and open both in the GP viewer: the ♭II is a C♭ in each.
9. Export MIDI from `/progression` with the notation panel **closed**: it downloads.
