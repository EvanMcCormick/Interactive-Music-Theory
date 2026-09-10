# Progression Composer M3 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A hand-edited slot reads its chord identity back from its notes — relabelled
visibly, degraded to `literal` honestly — over a chord model that can build and name
suspended, added-tone, extended and altered chords, spelled by degree letter everywhere
the app writes a note.

**Architecture:** Pure arithmetic first, UI last, as in M2. The spelling module and the
widened chord model come before the recogniser because the recogniser's output is
expressed in both. Recognition is a parse, not a search: each structural pitch class is
tried as a root, and the parses are ranked against the harmony the slot had before the
edit.

**Tech Stack:** Angular 21 standalone, RxJS 7.8, Tone.js 15, Jasmine/Karma.

**Design doc:** `docs/plans/2026-09-08-progression-composer-design.md` — read
**"M3 decisions"** at the end before starting. Where it conflicts with older sections
(the "Two-way sync" section above all), it wins.

**M2 plan, for what already exists:** `docs/plans/2026-09-08-progression-m2-piano-roll.md`

**Test command:**
```bash
npx ng test --watch=false --browsers=ChromeHeadless
```
Run from `client/`. Add `--include='**/<name>.spec.ts'` to run one spec. **Baseline at
the start of M3: 1855 tests, 0 failures.** It moves as tasks land; check `git log`
rather than trusting a number written here.

---

## Background you need

| Module | What it does now | What M3 does to it |
|---|---|---|
| `models/progression.model.ts` | `ChordDegree`, `SlotHarmony`, `SlotOwnership` | `extensions`; `literal.from` |
| `models/progression-normalize.ts` | the five-clause normalisation rule and every guard | guards for the new fields |
| `services/progression-harmony.ts` | `chordPitchClasses`, `QUALITY_INTERVALS`, `effectiveQuality` | sus, extensions, added tones; `effectiveChord` |
| `services/progression-chord-names.ts` | `romanNumeral`, `chordName`, `spokenChordName`, `rootPrefersSharps` | composed figures; `rootPrefersSharps` deleted |
| `services/progression-vocabulary.ts` | the palette's alternates, borrowed and secondary rows | spells by degree letter |
| `services/progression-edit.ts` | `regenerateSlot` (a merge), `sameDegree` | compares `extensions` |
| `services/progression.service.ts` | every setter; **1110 lines, over the cap** | split in Tasks 1 and 1b |
| `services/progression-history.ts` | `ProgressionStore`: document, selection, undo, `CommitRun` | carries the relabel notice |
| `services/staff-pitch.ts` | `keyAlteration`, `diatonicToPitch`, `STEP_SEMITONES` (private) | exports `STEP_SEMITONES` |
| `services/music-theory.service.ts` | chromatic tables, `spellNote`, `shouldUseSharps`, fretboard | degree letters; finding 2 fixed |
| `components/progression/components/piano-roll/` | the roll; `endGesture()` on pointerup | defers recognition to gesture end |

**Rules from M1 and M2 that still hold and are easy to break:**

1. **Pitch-set edits can change a slot's identity; timing edits never do.** Only a
   setter that claims `pitches` may run the recogniser. `setNoteTiming`,
   `setNoteVelocity` and `setSlotLength` must never reach it.
2. **Wrong kind throws, out-of-range clamps or wraps, outside an enumerated set
   throws, absent-with-a-safe-default fills.** The five clauses are in the header of
   `progression-normalize.ts`. Every new field in this plan names which clause it is
   under.
3. **Max 1000 lines per file** (`CLAUDE.md`). `progression.service.ts` is already over;
   Task 1 is not optional.
4. **Reference data is added to, never changed.** New chords go into
   `MusicTheoryService`'s tables as new entries; no existing `intervals` array moves.

**Terms used below.**

- **Structural pitch classes** — the pitch classes sounding at a slot's downbeat, plus
  any whose summed sounding time inside the slot is at least a quarter of the slot.
- **Identity** — `ChordIdentity` from Task 5: root, base shape, suspension, height and
  extension alterations. What a chord *is*, independent of the key.
- **Expressing in the key** — turning an identity into a `ChordDegree` for a given
  scale, with every field `null` wherever the key's own note agrees. Task 7.

---

## Task 1: Split the roll's note setters out of the service

**Files:**
- Create: `client/src/app/services/progression-note-editor.ts`
- Modify: `client/src/app/services/progression.service.ts`
- Modify: `client/src/app/services/progression-history.ts`
- Test: the existing `progression.service.spec.ts`, unchanged

The precedent is `a84a8bd` ("Lift the document store and history out of the service"):
the service constructs a collaborator, keeps it private, and keeps its public API as
one-line delegations. Do the same for the four roll setters.

**Step 1: Move `slotOf` and `replaceSlot` onto the store.** Both are generic document
operations, and both the service and the new editor need them. On `ProgressionStore`:

```ts
/** The slot with this id, or null when the document does not hold one. */
slot(id: string): ChordSlot | null {
  return this.doc.slots.find(candidate => candidate.id === id) ?? null;
}

/** Swaps one slot for what `build` makes of it, by id, in one commit. */
commitSlot(id: string, build: (key: ProgressionKey) => ChordSlot, run?: CommitRun): void {
  this.commit(
    draft => {
      const index = draft.slots.findIndex(slot => slot.id === id);
      if (index < 0) return;
      draft.slots[index] = build(draft.key);
    },
    undefined,
    run
  );
}
```

Replace the service's private `slotOf`/`replaceSlot` with calls to these.

**Step 2: Create `ProgressionNoteEditor`.** Move `setSlotNotes`, `placeNotes`,
`setNoteTiming`, `setNoteVelocity` and `writeNotes` into it **with their docstrings
intact** — those docstrings carry the run-key discipline and the claim rules, and they
belong with the code. Constructor: `constructor(private readonly store: ProgressionStore)`.
`EditOptions` moves with them and is re-exported from `progression.service.ts` so no
component import changes.

**Step 3: Delegate.** In the service:

```ts
/** See `ProgressionNoteEditor.setSlotNotes`. */
setSlotNotes(id: string, notes: readonly RollNote[], options: EditOptions = {}): boolean {
  return this.notes.setSlotNotes(id, notes, options);
}
```

and likewise for the other three. `resetSlotToChord` stays in the service: it needs
`regenerate` and `canBuildChords`, which are harmony.

**Step 4: Verify.**

```bash
wc -l client/src/app/services/progression.service.ts client/src/app/services/progression-note-editor.ts
npx ng test --watch=false --browsers=ChromeHeadless
```
Expected: the service under 900 lines; **1855 SUCCESS**, the same count as before.
A refactor that changes the count has changed behaviour.

**Step 5: Commit.**
```
refactor: Lift the roll's note setters out of the service
```

---

## Task 1b: Give the key-to-scale knowledge an owner — **done**

**Files:**
- Created: `client/src/app/services/progression-key-context.ts` (145 lines)
- Modified: `client/src/app/services/progression.service.ts` (895 → 864),
  `client/src/app/services/progression-history.ts` (prose only)
- Test: the existing specs, unchanged

Task 1 left the service at 895 lines against a 1000-line cap, which is 105 lines
of headroom for `setSlotSuspension` and `setSlotExtension` (Task 6), a reworked
`resetSlotToChord` and `setKey` (Task 8), and `settlePitchGesture`,
`chooseRelabelAlternate`, `revertRelabel` and `keepAsLiteral` (Task 9). In a
codebase that runs around 60% documentation, four setters and four gesture
methods do not fit in 105 lines. The cap would have been breached in the middle
of the milestone, and splitting *then* means proving a refactor
behaviour-preserving with the recogniser half-landed. So the split is taken
before Task 2 rather than after Task 9.

The design reason is better than the arithmetic one. `ProgressionStore` already
borrows the service's `derive` because `ProgressionState` carries `keyScale` and
`canBuildChords`, and Task 9 Step 3 hands the note editor a scale-resolving
callback for the same reason. Two arrows into the service asking one question —
how a key id becomes a scale — is the shape of a thing that has not been named.
`ProgressionKeyContext` is the name: `findScale`, `chordScale`, `chordScaleFor`,
`canBuildChords` and `spellingFor`, taking `MusicTheoryService` as a constructor
argument rather than injecting one, so it stands up in a spec with no injector.
Plain class, constructed by the service, private, delegated to — the precedent is
`a84a8bd` and `6f63e0b`.

**Two things did not move, and the reasons are the interesting part.**

`derive` stayed. It builds the whole of `ProgressionState`, and only two of its
seven fields are key-to-scale knowledge; the selection validated against the
slots, `isDirty` and the two history flags are not, and would have arrived in the
new file only because they happened to share a method with the two lines that
belong there. It asks the context its two questions and stays the seam the store
borrows, which also leaves `ProgressionStore`'s docstring true.

`regenerate` stayed, and this one is structural. It is a one-line composition of
`regenerateSlot` with the resolved scale, so on size alone it could have gone —
but `regenerateSlot` merges notes, ownership and voicing, which is slot knowledge.
Moving it would have made the key context the place a slot is rebuilt as well as
the place a scale is found, and it would have put a path to regeneration inside
the object Task 9 hands the note editor. The seam that kept `resetSlotToChord` in
the service in Task 1 is that same seam, and it holds only while the thing the
editor is handed cannot rebuild a chord. `chordScaleFor(key)` is what makes this
work without leaking: the service's `regenerate` asks for intervals and never
learns that finding them means resolving an id and testing `isHeptatonic`.

**Verified:** `npx tsc -p tsconfig.spec.json --noEmit` clean, **1855 SUCCESS, 0
failures**, no spec edited. Every source file touched is under the cap: the
service 864, the key context 145, `progression-history.ts` 370.

---

## Task 2: `note-spelling.ts` — a note is a letter and an accidental

**Files:**
- Create: `client/src/app/services/note-spelling.ts`
- Create: `client/src/app/services/note-spelling.spec.ts`
- Modify: `client/src/app/services/staff-pitch.ts` (export `STEP_SEMITONES`)

Pure, beside `staff-pitch.ts`, sharing its table rather than writing a second one.

**Step 1: Write the failing test.**

```ts
import {
  SpelledNote,
  formatNote,
  parseNoteName,
  pitchClassOf,
  scientificOctave,
  spellAt,
  spellPitchClass
} from './note-spelling';

const C: SpelledNote = { letter: 0, accidental: 0 };
const F: SpelledNote = { letter: 3, accidental: 0 };
const B_FLAT: SpelledNote = { letter: 6, accidental: -1 };
const D_FLAT: SpelledNote = { letter: 1, accidental: -1 };
const C_SHARP: SpelledNote = { letter: 0, accidental: 1 };
const G_SHARP: SpelledNote = { letter: 4, accidental: 1 };

describe('spellAt', () => {
  // The four named failures from the design doc's "cannot spell every borrowed
  // root" section, each now spelled as the numeral above it says.
  it('spells the ♭II of B flat major as C flat', () => {
    expect(spellAt(11, B_FLAT, 1)).toEqual({ letter: 0, accidental: -1 });
  });

  it('spells the ♭II of D flat major as E double flat', () => {
    expect(spellAt(2, D_FLAT, 1)).toEqual({ letter: 2, accidental: -2 });
  });

  it('spells the ♯vii° of C sharp minor on B sharp', () => {
    expect(spellAt(0, C_SHARP, 6)).toEqual({ letter: 6, accidental: 1 });
  });

  it('spells the ♯vii° of G sharp minor on F double sharp', () => {
    expect(spellAt(7, G_SHARP, 6)).toEqual({ letter: 3, accidental: 2 });
  });

  // One of the thirteen the key's own spelling got wrong: F locrian was treated
  // as a six-sharp key and printed G♯ for its third degree.
  it('spells the third degree of F locrian as A flat', () => {
    expect(spellAt(8, F, 2)).toEqual({ letter: 5, accidental: -1 });
  });

  it('refuses a spelling past a double accidental', () => {
    // Pitch class 1 on the letter E needs three flats.
    expect(spellAt(1, C, 2)).toBeNull();
  });
});

describe('formatNote and parseNoteName', () => {
  it('writes ASCII, as the chromatic tables do', () => {
    expect(formatNote({ letter: 0, accidental: -1 })).toBe('Cb');
    expect(formatNote({ letter: 2, accidental: -2 })).toBe('Ebb');
    expect(formatNote({ letter: 3, accidental: 2 })).toBe('F##');
    expect(formatNote(C)).toBe('C');
  });

  it('reads back what it writes', () => {
    for (const name of ['C', 'Db', 'F#', 'Cb', 'Ebb', 'F##', 'B#']) {
      expect(formatNote(parseNoteName(name)!)).toBe(name);
    }
  });

  it('refuses a name that is not one', () => {
    expect(parseNoteName('H')).toBeNull();
    expect(parseNoteName('C#/Db')).toBeNull();
  });
});

describe('pitchClassOf, scientificOctave, spellPitchClass', () => {
  it('wraps a spelled note onto its pitch class', () => {
    expect(pitchClassOf({ letter: 0, accidental: -1 })).toBe(11);
    expect(pitchClassOf({ letter: 6, accidental: 1 })).toBe(0);
  });

  // The octave number follows the letter, not the pitch: C flat 5 sounds B4.
  it('numbers the octave by the letter', () => {
    expect(scientificOctave(71, { letter: 0, accidental: -1 })).toBe(5); // Cb5
    expect(scientificOctave(60, { letter: 6, accidental: 1 })).toBe(3);  // B#3
    expect(scientificOctave(60, C)).toBe(4);                            // C4
  });

  it('spells a bare pitch class by preference, as the tables do', () => {
    expect(spellPitchClass(1, true)).toEqual({ letter: 0, accidental: 1 });
    expect(spellPitchClass(1, false)).toEqual({ letter: 1, accidental: -1 });
    expect(spellPitchClass(4, false)).toEqual({ letter: 2, accidental: 0 });
  });
});
```

**Step 2:** Run it, watch it fail (module not found).

**Step 3: Implement.**

```ts
import { STEP_SEMITONES } from './staff-pitch';

/**
 * A written note: a letter, 0-6 for C through B, and an accidental in semitones.
 *
 * The chromatic tables spell a pitch class as whichever of twelve names shares
 * it, so they cannot write C flat. A letter and an accidental carried apart can
 * - and which letter is a fact about the *degree*, not the pitch: see `spellAt`.
 */
export interface SpelledNote {
  letter: number;
  accidental: number;
}

const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** A double accidental is the furthest conventional notation goes. */
const MAX_ACCIDENTAL = 2;

/**
 * The note `steps` letters above `from` that sounds `pitchClass`, or null when
 * that letter would need more than a double accidental.
 *
 * Null rather than a triple accidental, so the caller chooses its fallback. It
 * is reached with no `alter` at all - the sixth degree of A♯ enigmatic is
 * written on an F and sounds pitch class 8, an F triple sharp - and alteration
 * adds more: D♭ super locrian's fourth is already a G double flat, and
 * `alter: -1` on it asks for a G triple flat. Nowhere in a diatonic mode.
 */
export function spellAt(pitchClass: number, from: SpelledNote, steps: number): SpelledNote | null {
  const letter = (((from.letter + steps) % 7) + 7) % 7;
  // The signed distance from the natural letter to the pitch, read as the
  // nearer of its two representatives: -6..5.
  const accidental = ((((pitchClass - STEP_SEMITONES[letter] + 6) % 12) + 12) % 12) - 6;
  return Math.abs(accidental) > MAX_ACCIDENTAL ? null : { letter, accidental };
}
```

Then `pitchClassOf`, `formatNote` (`'b'` repeated for negative, `'#'` for positive),
`parseNoteName` (a letter then zero to two of one accidental sign; anything else
null), `scientificOctave(midi, spelled)` as `Math.floor((midi - spelled.accidental) / 12) - 1`,
and `spellPitchClass(pc, preferSharps)`: a natural pitch class is its own letter; a
black key is the letter below it plus one when sharp, the letter above minus one when
flat. `spellPitchClass` is what every fallback in this plan uses, so no module needs
`MusicTheoryService` just to spell a pitch class.

**Step 4:** Run tests. **Step 5:** Commit.
```
feat: Spell a note as a letter and an accidental
```

---

## Task 3: The progression spells by degree letter

**Files:**
- Create: `client/src/app/services/progression-spelling.ts` and its spec
- Modify: `progression-chord-names.ts` (delete `rootPrefersSharps`; `spokenRoot` learns doubles)
- Modify: `progression-vocabulary.ts`, `progression-strip-cards.ts`, `piano-roll-view.ts`
- Modify: the three components that pass `spell` in, and their specs

**Step 1: Write the failing test** — `progression-spelling.spec.ts`:

```ts
import { chordRootName, scaleNoteName } from './progression-spelling';
import { createDegreeSlot } from '../models/progression.model';

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];
const SUPER_LOCRIAN = [0, 1, 3, 4, 6, 8, 10];

function degree(d: number, alter = 0) {
  const slot = createDegreeSlot(d, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
  return { ...slot.harmony.degree, alter, quality: alter === 0 ? null : ('major' as const) };
}

describe('chordRootName', () => {
  it('names B flat major ♭II as C flat', () => {
    const key = { tonic: 10, scaleId: 'ionian', preferSharps: false };
    expect(chordRootName(key, IONIAN, degree(1, -1))).toBe('Cb');
  });

  it('names C sharp aeolian ♯vii on B sharp', () => {
    const key = { tonic: 1, scaleId: 'aeolian', preferSharps: true };
    expect(chordRootName(key, AEOLIAN, degree(6, 1))).toBe('B#');
  });

  // One of the 112 `rootPrefersSharps` got wrong in a key a user might really be
  // in: F super locrian's ♯iv is a B flat, printed A♯ by the sign of the alter.
  it('names F super locrian ♯iv as B flat', () => {
    const key = { tonic: 5, scaleId: 'superLocrian', preferSharps: false };
    expect(chordRootName(key, SUPER_LOCRIAN, degree(3, 1))).toBe('Bb');
  });

  it('names F locrian iii as A flat', () => {
    const key = { tonic: 5, scaleId: 'locrian', preferSharps: true };
    expect(chordRootName(key, LOCRIAN, degree(2))).toBe('Ab');
  });
});

describe('scaleNoteName', () => {
  it('spells an in-scale note by its degree and anything else by the key', () => {
    const key = { tonic: 5, scaleId: 'locrian', preferSharps: true };
    expect(scaleNoteName(key, LOCRIAN, 8)).toBe('Ab'); // degree 2
    expect(scaleNoteName(key, LOCRIAN, 9)).toBe('A');  // not in F locrian
  });
});
```

Check the scale ids against `MusicTheoryService` before trusting them — the id strings
above are guesses; the intervals are not.

**Step 2:** Run it, watch it fail.

**Step 3: Implement `progression-spelling.ts`.**

- `tonicSpelling(key)` → `spellPitchClass(key.tonic, key.preferSharps)`. Every tonic
  the circle offers is one of the twelve table names, so the key's preference is enough
  here; degree letters start from it.
- `chordRootName(key, scaleIntervals, degree)` → `spellAt(chordRootPitchClass(key, scaleIntervals, degree), tonicSpelling(key), degree.degree)`,
  formatted; on `null`, fall back to `spellPitchClass(pc, key.preferSharps)`.
- `scaleNoteName(key, scaleIntervals, pitchClass)` → the degree whose interval puts it on
  `pitchClass` spells it by that degree's letter; any other pitch class falls back to the key.

**Step 4: Adopt it.** The builders stop taking `spell: SpellNote`:
- `buildStripView(state)` names each root with `chordRootName`.
- `chordVocabulary(key, scaleIntervals, selected)` does the same inside `buildOption`.
- `buildRollView(state)` labels rows and notes with `scaleNoteName`, and the octave with
  `scientificOctave` — `C♭5` is MIDI 71 and must not print as `Cb4`. Task 5 upgrades
  in-chord notes to chord-tone spelling.
- The components drop the `spell` argument. Delete `SpellNote` when its last user goes.

**Step 5: Retire `rootPrefersSharps`.** Delete it and its specs. Replace them with the
fixture this design doc promises, in `progression-vocabulary.spec.ts`:

```ts
// The 55 misspelt buttons from the design doc: across the seven diatonic modes in
// all twelve keys, every borrowed and secondary option's printed root must be on
// the letter its numeral names - tonic letter plus degree.
it('names every option on the letter its numeral names', () => {
  for (const mode of DIATONIC_MODES) {
    for (let tonic = 0; tonic < 12; tonic++) {
      /* build the key as ProgressionService.setKey would, call chordVocabulary,
         and for each option assert the first letter of `name` equals
         LETTERS[(tonicLetter + option.degree) % 7] */
    }
  }
});
```

Then widen the same assertion to all 33 heptatonic scales, and pin how many options
fall back — that number is the triple-accidental cases, and it should be small and
named in a comment.

**Step 6:** `spokenRoot` in `progression-chord-names.ts` handles `bb` and `##` ("E double
flat"). One spec each.

**Step 7:** Run tests. Expect existing strip, palette and roll specs that assert a
misspelling to fail — each is one of the 55 and is now right. Update them and say which
in the commit body. **Step 8:** Commit.
```
feat: Spell the progression by degree letter
```

---

## Task 4: Extensions, sounded suspensions, added-tone shapes

**Files:**
- Modify: `models/progression.model.ts`, `models/progression-normalize.ts` and spec
- Modify: `services/progression-harmony.ts` and spec
- Modify: `services/progression-generate.ts`, `progression-edit.ts` (`sameDegree`),
  `progression-vocabulary.ts` (its `toDegree`), `progression.service.ts` (`chosen`, `unpinned`)
- Modify: `services/progression-chord-names.ts` (three table rows each, for the new shapes)

**Step 1: The model.**

```ts
/** ♭9, 9, ♯9 - semitones from a major ninth. */
export type NinthAlteration = -1 | 0 | 1;
/** 11, ♯11 - from a perfect eleventh. */
export type EleventhAlteration = 0 | 1;
/** ♭13, 13 - from a major thirteenth. */
export type ThirteenthAlteration = -1 | 0;

/**
 * One alteration per extension, each `null` for "as the key gives it" - the
 * convention `quality` already uses, which is what makes this a migration with
 * nothing to migrate: a slot with all three null builds exactly what it built
 * before the field existed. Read only once `extent` reaches the extension, so
 * `extent` stays the single height control.
 */
export interface ExtensionAlterations {
  ninth: NinthAlteration | null;
  eleventh: EleventhAlteration | null;
  thirteenth: ThirteenthAlteration | null;
}
```

`ChordDegree` gains `extensions: ExtensionAlterations`. `createDegreeSlot` writes all
three `null`. The four added-tone shapes join `ChordQuality` and `QUALITY_INTERVALS`:

```ts
major6: [0, 4, 7, 9],
minor6: [0, 3, 7, 9],
add9: [0, 4, 7, 14],
minorAdd9: [0, 3, 7, 14],
```

Each opens with the triad of its own name, which is the property `chordPitchClasses`'
seventh truncation rests on; no two entries share a shape, which is the property
`qualityOfIntervals` rests on. Say both in the table's comment.

**Step 2: The guards**, in `progression-normalize.ts`, each under the clause it belongs to:
- `extensions` **absent** → `{ ninth: null, eleventh: null, thirteenth: null }` (the
  fifth clause, a migration).
- `extensions` present, a member not `null` and not in its union → throw (the
  enumerated-set clause).
- `suspension` not one of `'none' | 'sus2' | 'sus4'` → throw. It has been stored
  unchecked since M1, because nothing read it.

**Step 3: Write the failing tests** — `progression-harmony.spec.ts`. The builder now takes
a shape object, because seven positional arguments is where positional stops being
readable:

```ts
const NONE = { ninth: null, eleventh: null, thirteenth: null };
function shape(overrides: Partial<ChordShape>): ChordShape {
  return {
    degree: 0, alter: 0, extent: 3, quality: null,
    suspension: 'none', extensions: NONE, ...overrides
  };
}

describe('chordPitchClasses: extensions', () => {
  it('builds the diatonic V9 of C major', () => {
    expect(chordPitchClasses(MAJOR, shape({ degree: 4, extent: 9 }))).toEqual([7, 11, 14, 17, 21]);
  });

  it('flattens the ninth: G7♭9', () => {
    expect(chordPitchClasses(MAJOR, shape({
      degree: 4, extent: 9, extensions: { ...NONE, ninth: -1 }
    }))).toEqual([7, 11, 14, 17, 20]);
  });

  // The design doc's "a real ninth chord is unreachable": V/vi raised to a ninth
  // built E G♯ B D F, a flat ninth off the key. An explicit natural ninth builds
  // the E9 that could not be built at all.
  it('builds a real E9 as V/vi in C major', () => {
    const e7 = shape({ degree: 2, extent: 9, quality: 'dominant7' });
    expect(chordPitchClasses(MAJOR, e7)).toEqual([4, 8, 11, 14, 17]);
    expect(chordPitchClasses(MAJOR, { ...e7, extensions: { ...NONE, ninth: 0 } }))
      .toEqual([4, 8, 11, 14, 18]);
  });

  it('sharpens the eleventh: Imaj13♯11', () => {
    expect(chordPitchClasses(MAJOR, shape({
      extent: 13, extensions: { ...NONE, eleventh: 1 }
    }))).toEqual([0, 4, 7, 11, 14, 18, 21]);
  });
});

describe('chordPitchClasses: suspensions', () => {
  it('replaces the third', () => {
    expect(chordPitchClasses(MAJOR, shape({ suspension: 'sus4' }))).toEqual([0, 5, 7]);
    expect(chordPitchClasses(MAJOR, shape({ suspension: 'sus2' }))).toEqual([0, 2, 7]);
  });

  it('suspends at every height: G7sus4', () => {
    expect(chordPitchClasses(MAJOR, shape({ degree: 4, extent: 7, suspension: 'sus4' })))
      .toEqual([7, 12, 14, 17]);
  });

  // The suspended fourth and the eleventh are one pitch class an octave apart.
  // Doubled, not dropped: the note count is what normalizeInversion wraps against.
  it('doubles the fourth under an eleventh rather than dropping it', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 11, suspension: 'sus4' })))
      .toEqual([0, 5, 7, 11, 14, 17]);
  });
});

describe('chordPitchClasses: added tones', () => {
  it('builds C6, and C6/9 with no rule of its own', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'major6' }))).toEqual([0, 4, 7, 9]);
    expect(chordPitchClasses(MAJOR, shape({ extent: 9, quality: 'major6' }))).toEqual([0, 4, 7, 9, 14]);
  });

  it('builds Cadd9', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'add9' }))).toEqual([0, 4, 7, 14]);
  });
});
```

**Verify the theory yourself** before trusting these: work G7♭9, E9 and Imaj13♯11
through by hand.

**Step 4: Implement.** `ChordShape = Pick<ChordDegree, 'degree' | 'alter' | 'extent' | 'quality' | 'suspension' | 'extensions'>`.
Order of operations inside `chordPitchClasses`, after the existing two refusals:

1. the diatonic stack, with the quality override mapped over it as today;
2. the suspension replaces position 1 with `root + 2` or `root + 5`;
3. each non-null extension replaces its position (4, 5, 6) with
   `root + natural + alteration`, where natural is 14, 17, 21 — only where that
   position exists at this extent;
4. `liftIntoAscent`, as today, over the result.

Update every caller: `generateSlotNotes`, `effectiveQuality`, the vocabulary, the specs.
`sameDegree` gains `extensions` (the `Record<keyof ChordDegree, boolean>` makes this a
compile error until it does — compare the three members). `unpinned` (Reset to chord)
also clears `extensions` to all-null and `suspension` to `'none'`: both are user intent
in the sense its docstring argues, and Reset hands the whole slot back.

The three naming tables need a row each for the four new shapes: numeral figures
`6`, `6` (lower case), `add9`, `add9` (lower case); suffixes `6`, `min6`, `add9`,
`minadd9`; spoken `sixth`, `minor sixth`, `added ninth`, `minor added ninth`.

Until Task 5, `major6` and `minorAdd9` light nothing on the fretboard: their names are
not chord ids (`'6'`, `'minor_add9'`). That is the intermediate state and it is the
honest one; Task 5 replaces lighting by name with lighting by interval set.

**Step 5: Re-derive `OCTAVE_MAX` — done, and both checkpoints fired.**

| swept set | chords | seconds | reach |
|---|---|---|---|
| 16 qualities (what is shipped) | 5.6M | 3.7 | **46** |
| + three suspensions | 16.8M | 13.8 | 46 |
| + every extension alteration | 236.4M | **199** | **58** |

1. **The widened sweep is unshippable at ~200 s per octave** — thirteen minutes over the
   four the describe measures. It was not shipped and not quietly narrowed: `extremesAt`'s
   docstring names the two axes it omits and carries this table.
2. **The reach of 58 puts the ceiling at MIDI 130**, three notes past the end. `OCTAVE_MAX`
   was left alone. The witness: C major, degree 3, extent 13, `alter -2`, `diminished`,
   `sus4`, ♭9 + ♭13, inversion 2, in D — two replacements land below the note beneath them,
   so the ascent lift adds an octave twice.
3. A side effect the plan did not anticipate: the four added-tone shapes alone moved the
   *shipped* reach from 45 to 46, because `add9` puts its fourth note a ninth above the root.

**Settled: the ceiling becomes the chord's own, not the model's.** Task 4b, below. The
alternative — dropping `OCTAVE_MAX` to 0 — would cost every chord the top octave to
accommodate one almost nobody will build.

**Step 6:** Run tests. **Step 7:** Commit.
```
feat: Sound suspensions, and let each extension be altered
```

---

## Task 4b: The octave ceiling is the chord's, not the model's

**Files:**
- Modify: `models/progression-normalize.ts` (`OCTAVE_MAX` keeps its meaning; the sweep changes)
- Modify: `services/progression-voicing.ts` or `progression-generate.ts` (where the ceiling is applied)
- Modify: `services/progression.service.ts` (the octave stepper), `chord-palette.component.*` (what it shows)
- Create: a measurement script for the full sweep
- Test: `progression-normalize.spec.ts`, `progression-generate.spec.ts`, `progression.service.spec.ts`

**This must land before Task 6.** Task 6 adds the sus and tensions controls, which are what
make the overflowing chord reachable at all. Until then nothing can build one — nothing
writes `suspension` or `extensions`, and `replaceDocument` has no production caller.

**Scope: the model, the generator, the service and the script.** The palette's *display* of
the ceiling — the effective octave, and the up-stepper disabled with a reason — moves to
Task 6, which is already the task that builds palette controls and already owns that
component's spec.

**The shape, and the one thing that makes it awkward.** A per-slot ceiling needs the chord,
and the chord needs the scale — which `normalizeChordDegree` does not have. So the ceiling
cannot be a normalisation clamp. It belongs where the scale is already known.

The design that avoids silently losing the user's intent:

- **`ChordDegree.octave` keeps storing what the user asked for**, bounded as today by
  `OCTAVE_MIN`/`OCTAVE_MAX`, which stay what they are — the control's nominal range.
- **The generator clamps on use.** `generateSlotNotes` already has the key and the scale;
  it derives the ceiling from the chord it is about to build and voices no higher. So a
  slot at octave 1 that becomes too wide — a key change into a scale that widens it, a
  tension pinned onto it — sounds an octave lower and **returns to octave 1 by itself** when
  the chord narrows again. Storing the clamped value instead would destroy that.
- **The palette shows the effective octave**, and disables the up-stepper with a reason when
  the chord is against its ceiling. A control that silently does nothing is the failure this
  page has been fixed for twice.

**Correctness becomes constructive, which is what makes the spec cheap.** Today's spec sweeps
the universe to prove one global constant is maximal. With the ceiling derived per chord, the
property to prove is local: *the chord voiced at its derived ceiling never exceeds MIDI 127,
and the ceiling is the highest octave for which that is true.* That is checkable on a sample
in milliseconds — all 33 scales × degrees × extents, with a handful of shape combinations
including the 130 witness — instead of 236 million chords.

Keep a **characterization spec pinning the witness chord's reach at 58**, so a future change
to the lift or to `voiceChord` that moved it fails loudly.

**The full sweep becomes a script**, not a spec: it is a measurement, it takes thirteen
minutes, and nothing in CI should wait on it. Put it where a reader will find it from the
constant's docstring, and record in that docstring what it last measured and when.

**Judgement calls, to be reported rather than assumed:**
- Whether the ceiling is derived inside `generateSlotNotes` or by a helper beside
  `voiceChord`. The second is more testable; the first has the key already in hand.
- Whether the palette's octave readout shows the requested value, the effective one, or
  both. "Octave 1 (sounding 0)" is honest but wordy; think about what a user needs.

**Commit:** `fix: Give each chord its own octave ceiling`

---

## Task 5: A chord's identity, and names composed from it

**Files:**
- Modify: `services/progression-harmony.ts` (`ChordIdentity`, `effectiveChord`; `effectiveQuality` goes)
- Modify: `services/progression-chord-names.ts` (the three renderers take an identity)
- Modify: `progression-strip-cards.ts`, `progression-vocabulary.ts`, `progression.component.ts`, `piano-roll-view.ts`
- Modify: `models/music-theory.model.ts` (`Chord.steps`), `services/music-theory.service.ts` (new entries, `steps`, `findChordByIntervals`)

**Step 1: The identity.**

```ts
/**
 * What a chord is, independent of the key it is written in: the thing both the
 * name and the fretboard are read off, so the two cannot disagree.
 */
export interface ChordIdentity {
  /** The root, relative to the tonic, 0-11. */
  root: number;
  /** The triad, seventh or added-tone shape; `'other'` when no name fits. */
  base: ChordQuality;
  suspension: SuspensionKind;
  extent: ChordExtent;
  /** Semitones above the root, ascending, as built. What the fretboard is lit by. */
  intervals: readonly number[];
  /** Alteration from natural of each extension present; null when absent. */
  ninth: number | null;
  eleventh: number | null;
  thirteenth: number | null;
  /** Letter steps above the root, per interval. What chord tones are spelled by. */
  steps: readonly number[];
}
```

`effectiveChord(scaleIntervals, shape)` builds the stack and reads it: `base` from
`qualityOfIntervals` over the stack built **with the suspension removed** (a G7sus4's base
is `dominant7`); the extension alterations off positions 4-6 against 14, 17, 21; the steps
from the positions (0, 2, 4, 6, 1, 3, 5, with sus2 at 1 and sus4 at 3 in position 1, an
added sixth at 5). An extension altered outside its nameable set — a diatonic ninth an
octave above the root, reachable in exotic scales — makes `base` `'other'`, which prints
`?` and lights nothing: unlabelled rather than mislabelled, as everywhere else.

**Step 2: Write the failing naming tests** — `progression-chord-names.spec.ts`. The rule:
the height is the highest **unaltered** extension present; altered extensions follow it in
ascending order; the suspension goes last.

| chord (C major unless said) | numeral | name | spoken |
|---|---|---|---|
| V at extent 9 | `V9` | `G9` | G dominant ninth |
| V, ninth −1 | `V7♭9` | `G7b9` | G dominant seventh flat nine |
| I at 13, eleventh +1 | `Imaj13♯11` | `C Maj13#11` | C major thirteenth sharp eleven |
| ii at 11 | `ii11` | `D min11` | D minor eleventh |
| V at 7, sus4 | `V7sus4` | `G7sus4` | G dominant seventh suspended fourth |
| I, sus2 | `Isus2` | `Csus2` | C suspended second |
| I, `major6` at 9 | `I6/9` | `C6/9` | C six nine |
| vii° at 7 in C harmonic minor | `vii°7` | `B°7` | B diminished seventh |

The existing seventh-and-triad specs must keep passing unchanged: an identity at extent 3
or 7 with nothing altered renders exactly what the tables render today.

**Step 3: Implement** the renderers as the existing tables plus three small rules (height,
alterations, suspension). The alteration glyphs are the module's existing `♭`/`♯` in the
numeral and ASCII `b`/`#` in the name, matching what each already prints.

**Step 4: Adopt the identity** everywhere `effectiveQuality` was read: the strip card,
`buildOption` in the vocabulary, `chordFor` in `progression.component.ts`. Delete
`effectiveQuality`; its docstring's argument moves to `effectiveChord`. The roll labels a
note that is a chord tone of the selected slot by `spellAt(pc, rootSpelling, step)`, and
any other note by `scaleNoteName` as in Task 3.

This settles `progression-strip-cards.ts`' note on the height: its argument was that `V9`
over `G7` would be worse than `V7` over `G7`. Both lines now come from one identity and
agree at every height. Rewrite the note to say so rather than deleting it silently.

**Step 5: Light by interval set.** On `MusicTheoryService`:

```ts
/**
 * The chord category and id whose intervals are exactly these, or null.
 *
 * Replaces the correspondence the progression used to lean on, where a quality
 * name happened to be a chord id. Matching intervals makes it a lookup, and
 * lights every chord the table holds rather than the twelve whose names match.
 */
findChordByIntervals(intervals: readonly number[]): { categoryId: string; itemId: string } | null
```

Chord categories only, for the reason `findChordCategory` gives. `chordFor` uses it with
`identity.intervals`.

**Step 6: Extend the chord table.** `Chord` gains `steps: number[]`. Add it to every
existing entry — triads `[0,2,4]`, `sus2` `[0,1,4]`, `sus4` `[0,3,4]`, sevenths `[0,2,4,6]`
(including `diminished7`, whose 9 semitones is a **seventh**), ninths append 1, elevenths 3,
thirteenths 5, `add9` `[0,2,4,1]`, `6` and `minor6` `[0,2,4,5]`. Then add a new category
`altered` ("Altered & Suspended") holding exactly what the model can build and the table
lacks:

| id | intervals | symbol |
|---|---|---|
| `dominant7b9` | `[0,4,7,10,13]` | `7b9` |
| `dominant7sharp9` | `[0,4,7,10,15]` | `7#9` |
| `dominant9sharp11` | `[0,4,7,10,14,18]` | `9#11` |
| `dominant13sharp11` | `[0,4,7,10,14,18,21]` | `13#11` |
| `major9sharp11` | `[0,4,7,11,14,18]` | `maj9#11` |
| `major13sharp11` | `[0,4,7,11,14,18,21]` | `maj13#11` |
| `dominant7sus4` | `[0,5,7,10]` | `7sus4` |
| `dominant9sus4` | `[0,5,7,10,14]` | `9sus4` |
| `sixNine` | `[0,4,7,9,14]` | `6/9` |

A spec checks every entry: `steps.length === intervals.length`, and each interval is
within a double accidental of the natural interval its step names. **No existing
`intervals` array changes** — that is the guardrail, and the spec should assert the
pre-existing entries' intervals are exactly what they were.

**Step 7:** Run tests. **Step 8:** Commit.
```
feat: Name a chord from what it is, and light the fretboard by its intervals
```

---

## Task 6: Sus and tensions in the palette

**Files:**
- Modify: `services/progression.service.ts` (`setSlotSuspension`, `setSlotExtension`)
- Modify: `components/progression/components/chord-palette/*`
- Test: `progression.service.spec.ts`, `chord-palette.component.spec.ts`

Nothing in the UI sets `suspension` today, and the design's "any combination can be
built" is only true with a control for it. The recogniser can reach both through the roll,
but the palette should not require dragging a note to get a sus4.

**Do not start this until Task 4b has landed.** These two controls are what make the
chord that overflows MIDI reachable, and 4b is the ceiling that catches it.

**It also carries 4b's UI half:** the octave readout shows the *effective* octave, and the
up-stepper is disabled with a reason when the chord is against its ceiling — a control that
silently does nothing is the failure this panel has been fixed for twice.

**Check the service's line count before you start.** Task 1b split it at 864 lines on the
argument that 105 lines of headroom would not hold this task, Task 8 and Task 9; Task 4
spent 31 of them. If `setSlotSuspension` and `setSlotExtension` take it near 1000, the next
seam is the palette-facing degree setters — `setSlotExtent`, `stepSlotExtent`,
`setSlotChord`, `setSlotInversion`, `setSlotOctave`, `editDegree` — and taking it is
cheaper before Tasks 8 and 9 add to the same file than after.

**Step 1: Failing service tests.** Both setters go through `editDegree`, so they inherit
its refusals, its no-op comparison and its pitch reclaim:

```ts
it('suspends the selected chord and reclaims its pitches', () => {
  const id = appendI();                       // helper: appendSlot(0), return its id
  service.setSlotNotes(id, notesOf(id));      // claims the pitches
  service.setSlotSuspension(id, 'sus4');
  expect(midiOf(id)).toEqual([60, 65, 67]);   // C F G
  expect(slot(id).owned.pitches).toBe(false);
});

it('pins one extension and leaves the others to the key', () => {
  const id = appendV();
  service.setSlotExtent(id, 9);
  service.setSlotExtension(id, 'ninth', -1);
  expect(degreeOf(id).extensions).toEqual({ ninth: -1, eleventh: null, thirteenth: null });
});

it('records nothing for a suspension the slot already has', () => { /* undo depth unchanged */ });
```

**Step 2: Implement** the setters, then the controls under Complexity in
`chord-palette.component.html`: a **Sus** group (None / sus2 / sus4, `aria-pressed` on
the current one) and a **Tensions** group shown only when the extent reaches a ninth, one
row per extension present — ♭9 ♮9 ♯9, ♮11 ♯11, ♭13 ♮13 — with the effective alteration
marked. The marked value is read off `effectiveChord`, not off the stored field, for the
reason `ChordOption.current` gives. Clicking pins, exactly as the alternates row does; the
note under that row already names Reset to chord as the way back.

The alternates row gains the four added-tone shapes on its own: it maps
`NAMED_QUALITIES`, which is derived from `QUALITY_INTERVALS`. Check that `buildOption`
offers them at extent 7 (four notes), and add a spec that it does.

**Step 3:** Component specs for the controls' inputs and outputs — not their DOM
structure. **Step 4:** Run tests. **Step 5:** Commit.
```
feat: Let the palette suspend a chord and alter its tensions
```

---

## Task 7: The recogniser

**Files:**
- Create: `client/src/app/services/progression-recognise.ts`
- Create: `client/src/app/services/progression-recognise.spec.ts`

Pure: no Angular, no store. It is handed the notes before and after an edit and answers
what the slot now is.

**The API.**

```ts
export type Recognition =
  | { kind: 'unchanged' }
  | { kind: 'relabel'; degree: ChordDegree; alternates: readonly ChordDegree[] }
  | { kind: 'literal' };

export function structuralPitchClasses(notes: readonly RollNote[], lengthBeats: number): Set<number>;
export function parseChord(pitchClasses: ReadonlySet<number>, root: number): ParsedChord | null;
export function expressInKey(identity: ChordIdentity, scaleIntervals: readonly number[], octave: number, bass: number): ChordDegree | null;
export function recognise(
  before: readonly RollNote[],
  slot: ChordSlot,
  scaleIntervals: readonly number[]
): Recognition;
```

**The rules, as the design doc settles them.**

- **Structural:** sounding at the downbeat (`startBeat < MIN_NOTE_BEATS`), or summed
  sounding time inside the slot ≥ `lengthBeats / 4`. Time past the slot's end does not count.
- **Quiet:** `structuralPitchClasses(before)` equals `structuralPitchClasses(after)` → `unchanged`.
- **A `user-detached` literal** → `unchanged`, always.
- **Parse**, from each structural pitch class as the root, intervals mod 12:
  - third: 4, else 3; with 4 present, a 3 is a ♯9. No third: 5 is sus4, else 2 is sus2.
  - fifth: 7; else 6 is a ♭5, 8 is a ♯5; absent is allowed and marks the parse incomplete.
    With 7 present, 6 is a ♯11 and 8 is a ♭13.
  - seventh: 10 or 11; 9 is a diminished seventh over a ♭5 and minor third, else an
    added sixth, or a thirteenth when a seventh is present.
  - extensions: 1/2/3 ninth, 5/6 eleventh (5 only with a third present), 8/9 thirteenth.
  - height needs every rung below it: an eleventh without a ninth and seventh does not
    parse as an eleventh chord. The one omission accepted is the fifth.
  - any interval left over → no parse from this root.
- **Express in the key:** the root takes the degree whose diatonic chord shares the most
  pitch classes with the parse, then the flat side, within `ALTER_MIN..ALTER_MAX`; every
  field `null` where the key's own note agrees; `alter !== 0` always carries its quality;
  inversion is the bass's position in the built stack.
- **Rank:** complete → keeps the current root → root is the bass → most fields `null` →
  lowest extent. Top equals the current degree ignoring inversion → `unchanged`; otherwise
  `relabel` with the next three as alternates. No parse → `literal`.

`ParsedChord` and `ChordIdentity` should be one type if they can be — Task 8 re-expresses
an identity through `expressInKey` without parsing, and two shapes for one thing is the
duplication the project rules forbid. Try it; if they genuinely differ, say why in a comment.

**Step 1: Write the failing tests.** Build each slot with `generateSlotNotes` in C major
unless stated, then edit its notes — the fixture is the real pipeline, not hand-written
note lists.

```ts
describe('structuralPitchClasses', () => {
  it('reads a block chord', () => { /* C E G, 4 beats -> {0,4,7} */ });
  it('keeps every tone of an eighth-note arpeggio', () => { /* C E G C E G C E */ });
  it('keeps every tone of a quarter-note arpeggio', () => { /* C E G E: G is exactly 1/4 */ });
  it('drops a sixteenth passing tone', () => { /* + D at 1.5 for 0.25 */ });
  it('counts no time past the end of the slot', () => { /* a note hanging off a shortened slot */ });
});

describe('recognise', () => {
  it('stays quiet when only the voicing moved', () => { /* C up an octave */ });
  it('reads a suspension: I with E dragged to F is Isus4', () => { /* alternates include IVsus2 */ });
  it('reads a flat seventh on I as I7, the secondary dominant', () => { /* quality dominant7 */ });
  it('reads a raised third on ii as II', () => { /* D F A, F -> F#: quality major */ });
  it('reads V plus F as V7, with every field null', () => { /* extent 7, quality null */ });

  // The design's own tie. Each keeps its own root.
  it('reads I plus A as I6', () => { /* quality major6; vi7 an alternate */ });
  it('reads vi plus G as vi7', () => { /* quality null; I6 an alternate */ });

  // sus4 against an 11th: a third present means an eleventh.
  it('reads V9 plus C as V11', () => {});
  it('reads V9 with its third moved to C as V9sus4', () => {});

  it('reads C D G as Isus2 from a I slot, and as Vsus4 from a V slot', () => {});

  // The fixture that reversed the design's tie-break order.
  it('keeps vii° as vii°7 when a diminished seventh is added below it', () => {
    /* C harmonic minor, B D F + A♭ in the bass: root stays B */
  });
  it('roots a diminished seventh on the bass when there is no current root', () => {
    /* same notes on an `unrecognised` literal slot: root A♭ */
  });

  it('accepts an omitted fifth without relabelling', () => { /* I7 minus G */ });

  // The case the before/after rule exists for.
  it('ignores a passing tone after a timing edit moved a chord tone off the downbeat', () => {
    /* I; E moved to beat 3.75 for 0.25 (no recognition - a timing edit);
       then a sixteenth D added: before {C,G}, after {C,G} -> unchanged */
  });

  it('degrades a cluster to literal', () => { /* C C# D */ });
  it('never re-reads a user-detached slot', () => {});
  it('brings an unrecognised slot back when its notes parse again', () => {});
});

describe('expressInKey', () => {
  it('writes D flat major in C as ♭II', () => { /* degree 1, alter -1, major */ });
  it('writes C sharp diminished in C as ♯i°', () => { /* degree 0, alter +1: shares E and G */ });
});
```

Fill every body with real notes and real expectations. **Work each expectation through
by hand before running it**; a fixture written from the implementation's output tests
nothing.

**Step 2: The round-trip sweep.** For every chord the model can build, generating its
notes and recognising them from a slot of that same harmony (so the current root is its
own) must give back the same `ChordDegree` — with the same `null` fields — or be a named
exception.

Sweep: every heptatonic scale × degree × extent × suspension with quality `null` and no
extensions; plus the seven diatonic modes × every quality × `alter ∈ {-1, 0, 1}` × every
extension alteration at the extents where it exists. Keep the spec under ~5 s; if it is
not, sample the extension axis on the diatonic modes and say so in the spec's comment.

**The expected exception class:** a stack that sounds one pitch class twice (sus4 at
extent 11 and above, sus2 at 9 and above, `add9` above 7, an added sixth under a
thirteenth, and wherever an exotic scale's diatonic extension lands on a chord tone). Those
read back at the height of their distinct notes. Assert that **every** failure is in this
class — a failure outside it is a bug in the parser or in `expressInKey`, and each needs a
ruling, not an exemption. If there are more than a handful, stop and report them.

**Step 3: Time it.** Recognising a thirteenth chord should take well under a millisecond;
measure and record the figure in the module header, as transcription M3 did for
`deriveScore`.

**Step 4:** Run tests. **Step 5:** Commit.
```
feat: Read a chord's identity back from its notes
```

---

## Task 8: A way back from `literal`, and key changes that tell the truth

**Files:**
- Modify: `models/progression.model.ts`, `models/progression-normalize.ts` and spec
- Modify: `services/progression.service.ts` (`resetSlotToChord`, `setKey`)
- Modify: `progression-strip-cards.ts` (the hint)
- Test: `progression.service.spec.ts`

**Step 1: Write the failing test for the bug first.** It is reachable in M2 today:

```ts
// A slot that owns its pitches keeps its degree while its notes move by the tonic
// interval. When the mode changes too, the two drift apart: the relative-minor
// click leaves A C# E sounding under a card that reads `i`.
it('re-expresses an owned chord when the key changes mode', () => {
  const id = appendI();                           // C major, I
  service.setSlotNotes(id, notesOf(id));          // own the pitches
  service.setKey(9, 'aeolian');                   // A minor
  expect(pitchClassesOf(id)).toEqual([9, 1, 4]);  // A C# E - unchanged by the fix
  expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: 0, alter: 0, quality: 'major' }));
});

it('pins nothing when only the tonic moves', () => {
  const id = appendI();
  service.setSlotNotes(id, notesOf(id));
  service.setKey(2, 'ionian');                    // D major
  expect(degreeOf(id).quality).toBeNull();
});
```

Run it and watch the first fail with `quality: null` — that is the bug.

**Step 2: Fix `setKey`.** For each degree slot that owns its pitches: take
`effectiveChord` in the **old** scale, regenerate as today (the notes transpose and
re-anchor), then set the harmony to `expressInKey(identity, newScale, ...)`. No
recognition runs and no notice is raised: the chord did not change, its spelling in the
new key did. If `expressInKey` cannot place it within `ALTER_MIN..ALTER_MAX`, degrade to
`literal` `unrecognised` with `from` set — visibly marked, never silent — and cover that in
a spec with whichever exotic scale reaches it.

**Step 3: `literal.from`.** The harmony type becomes:

```ts
| { kind: 'literal'; reason: 'unrecognised' | 'user-detached'; from: ChordDegree | null }
```

`from` absent → `null` (the fifth clause); present → `normalizeChordDegree`d.
`resetSlotToChord` on a literal slot with `from` rebuilds the block chord from
`unpinned(from)`, in the key the page is in now, with every claim dropped. With `from`
`null` it refuses, as every command does today. The strip's hint gains the way back:
"…Its notes are kept exactly as they are. Reset to chord, in the roll, turns it back
into one."

**Step 4:** Run tests. **Step 5:** Commit.
```
fix: Re-express an owned chord when the key changes mode
```
and
```
feat: Let a literal slot find its way back to a chord
```
as two commits — the fix is a fix to shipped behaviour and should be findable as one.

---

## Task 9: Recognise on a pitch edit

**Files:**
- Modify: `models/progression.model.ts` (`RelabelNotice`, `ProgressionState.relabel`)
- Modify: `services/progression-history.ts` (the store carries the notice)
- Modify: `services/progression-note-editor.ts`, `services/progression.service.ts`
- Modify: `components/progression/components/piano-roll/piano-roll.component.ts`
- Test: `progression.service.spec.ts`, `piano-roll.component.spec.ts`

**Step 1: The notice.**

```ts
/**
 * The last relabel the recogniser made, for the chip to show. Page state, not
 * document state - beside `selectedSlotId` and off the undo stack for the same
 * reason: it is where the user is, not what they wrote.
 */
export interface RelabelNotice {
  slotId: string;
  previous: SlotHarmony;
  current: SlotHarmony;
  alternates: readonly ChordDegree[];
}
```

`ProgressionState.relabel: RelabelNotice | null`. The store holds it beside the selection:
`commit` takes an optional `notice` and publishes it in the same emission, defaulting to
`null`, so **any** document change clears it; `selectSlot`, `undo` and `redo` clear it.

**Step 2: Failing service tests.**

```ts
it('relabels on a one-shot pitch edit, in the same undo entry', () => {
  const id = appendI();
  service.setSlotNotes(id, [...notesOf(id), note(70)]);     // + Bb
  expect(degreeOf(id).quality).toBe('dominant7');
  expect(state.relabel?.slotId).toBe(id);
  service.undo();
  expect(midiOf(id)).toEqual([60, 64, 67]);                 // notes back
  expect(degreeOf(id).quality).toBeNull();                  // and the label
});

it('defers a drag to its end, and folds the relabel into the drag', () => {
  const id = appendI();
  const before = notesOf(id);
  service.placeNotes(id, withMidi(before, 1, 65), { deferRecognition: true });
  service.placeNotes(id, withMidi(before, 1, 66), { coalesce: true, deferRecognition: true });
  service.placeNotes(id, withMidi(before, 1, 65), { coalesce: true, deferRecognition: true });
  expect(degreeOf(id).suspension).toBe('none');             // nothing yet
  service.settlePitchGesture(id, before);
  expect(degreeOf(id).suspension).toBe('sus4');
  service.undo();                                           // ONE undo
  expect(midiOf(id)).toEqual([60, 64, 67]);
  expect(degreeOf(id).suspension).toBe('none');
});

it('never recognises on a timing edit', () => { /* setNoteTiming moving E off the downbeat */ });
it('clears the notice on the next edit, a selection change, and undo', () => {});
it('keeps the notes when the label is put back', () => { /* revertRelabel */ });
it('detaches a slot on keep-as-literal, and never re-reads it', () => {});
```

**Step 3: Implement.**
- `EditOptions` gains `deferRecognition?: boolean`.
- `writeNotes`, when `claims.pitches` is set and recognition is not deferred, runs
  `recognise(slot.notes, written, scale)` **inside the same commit** and applies it:
  `relabel` sets the harmony, `literal` sets `literal` `unrecognised` with `from` the
  degree it had. Notes and ownership are untouched either way. The notice goes out with
  the commit.
- `settlePitchGesture(id, before)` runs the same against `before`, committing under the
  run key `place:${id}` with `continues: true`, so it folds into the drag's entry.
- `chooseRelabelAlternate(id, degree)`, `revertRelabel(id)`, `keepAsLiteral(id)` are each
  their own undo entry. Keep-as-literal writes `literal` `user-detached` with `from` the
  degree it had.
- The scale reaches the editor as a callback the service hands it at construction —
  `ProgressionKeyContext.findScale` behind it, the store's `derive` as the precedent —
  so the editor never learns how a scale id resolves. Hand it a bound method or a
  closure, **not the context itself** — the editor needs the scale to express a
  recognised chord in and nothing else, and a whole object hands over four more
  questions it has no business asking.

**Step 4: The roll.** Move commits pass `deferRecognition: true`. `endGesture` — which
pointerup and pointercancel both reach — calls `settlePitchGesture(move.slotId, move.notes)`
when a move gesture committed, **before** clearing `move`. `move.notes` is already the
gesture-start snapshot. Resize and velocity gestures do not call it. Spec it through the
component's outputs.

**Step 5:** Run tests. **Step 6:** Commit.
```
feat: Recognise a slot's chord when its pitches are edited
```

---

## Task 10: The chip

**Files:**
- Create: `components/progression/components/relabel-chip/relabel-chip.component.{ts,html,scss,spec.ts}`
- Create: `components/progression/components/relabel-chip/relabel-chip-view.ts` and spec
- Modify: `piano-roll.component.html` (the toolbar), `progression-strip-cards.ts` and the strip template

Standalone, `OnPush`, subscribing with `takeUntil(destroy$)`, per the guardrails.

**Step 1: The view model, pure** — `buildRelabelChipView(state)`, on the
`progression-strip-cards.ts` precedent. From `state.relabel` it produces:
- the headline — `V7♭9` and `(was V9)`; for a literal notice, `No chord matches` and the
  old numeral;
- the alternates, each with numeral, name and spoken label;
- the spoken announcement — "Relabelled G dominant seventh flat nine, was G dominant ninth";
- `null` when there is no notice, or the notice is for a slot other than the selected one.

Spec it table-driven, from states built with the real service.

**Step 2: The component.** A menu button (`aria-haspopup="menu"`, `aria-expanded`)
reading the headline, opening a menu of the alternates, *Back to V9* and *Keep as literal*;
Escape closes it and returns focus to the button. It dispatches to
`chooseRelabelAlternate`, `revertRelabel`, `keepAsLiteral`. A `polite` live region wraps the
chip and is **always present** — the palette's `unavailable-region` comment says why a region
that arrives with its text announces nothing.

**Step 3: Place it** in the roll toolbar beside Reset to chord. On the strip, a card whose
id is `state.relabel.slotId` gets `isRelabelled` and a highlight — colour **and** a mark,
for the reason the alternates row's `lowers-mark` gives.

**Step 4: Component specs** for inputs and outputs, not DOM structure.

**Step 5: See it work.** Start the dev server with the Browser pane (`preview_start`;
add a `.claude/launch.json` entry for `npm start` on port 4200 if there is none). On
`/progression`: add I, select it, drag its E to F in the roll, release. Check the chip
reads `Isus4 ▾ (was I)`, the card is highlighted, *Back to I* restores the label and keeps
F, and one undo takes back both. Screenshot the chip open.

**Step 6:** Run tests. **Step 7:** Commit.
```
feat: Show a relabel, and let the user take it back
```

---

## Task 11: The fretboard and keyboard spell by degree letter

**Files:**
- Modify: `services/music-theory.service.ts` and spec
- Modify: `components/progression/progression.component.ts` (`chordFor`)

**Step 1: Failing tests** in `music-theory.service.spec.ts`:

```ts
// Finding 2: every combined name carries a '#', so D#/Eb came back sharp.
it('spells E flat major in flats', () => {
  service.selectKeyAndMode('D#/Eb', 'modes', 'ionian');
  expect(namesInMode()).toEqual(['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
});

it('spells F locrian by degree: A flat, not G sharp', () => {
  service.selectKeyAndMode('F', 'modes', 'locrian');
  expect(namesInMode()).toContain('Ab');
  expect(namesInMode()).not.toContain('G#');
});

it('spells a diminished seventh on B with an A flat', () => {
  service.selectKeyAndMode('B', 'seventh', 'diminished7');
  expect(namesInMode()).toEqual(['B', 'D', 'F', 'Ab']);
});

it('leaves a pentatonic and the explicit sharp/flat views on the tables', () => {});
```

Check the category ids against the service before trusting them.

**Step 2: Fix the tonic.** One rule replaces the `#`-first test in `shouldUseSharps`: a
single name (`Gb`, from the circle's split wedge) is its own answer; a combined name
(`D#/Eb`) takes `keySignatureKind(item, pc)`; neither takes the item's `preferSharps`.
That is finding 2's fix. Delete the "KNOWN DISAGREEMENT" comment and replace it with the
rule.

**Step 3: Spell in-mode notes by letter.** A `noteNameFor(noteValue)` used by
`generateFretboard`, `generateKeyboard` and `getFormulaAsNotes`: a heptatonic scale spells
a note in it by its degree; a chord spells a tone by its `steps`; everything else, and every
note outside the scale or chord, keeps `getNoteName`.

**Step 4: The progression's lit chord.** Its root may be `Cb`, which is not one of the
twelve names `selectedKey` is compared against across the app — the key dropdown and
`getNoteIndex` both read it. So `selectedKey` stays a table name, and
`selectKeyAndMode(key, categoryId, itemId, rootSpelling?)` gains an optional spelling the
fretboard names the chord from. `chordFor` passes `chordRootName`. Grep every reader of
`selectedKey` and confirm none sees the new argument.

**Step 5:** Run tests. Expect fretboard specs asserting `D#`-family names to fail; each is
finding 2 and is now right. Update them and list them in the commit body. **Step 6:** Commit.
```
fix: Spell the fretboard by degree letter, and E flat major in flats
```

---

## Task 12: Documentation

**Files:** `docs/plans/2026-09-08-progression-composer-design.md`, `docs/ROADMAP.md`,
`README.md`

- Design doc: status line to "M1–M3 implemented"; under "The two chromatic tables cannot
  spell every borrowed root", "A real ninth chord is unreachable" and finding 2, a line
  saying M3 resolved each and where. Record any exception class Task 7's sweep settled,
  the timing Task 7 measured, and whatever Task 4 found about `OCTAVE_MAX`.
- ROADMAP: M3 shipped, with what it added.
- README: what a user can now do.

Commit:
```
docs: Catch the design doc and roadmap up with M3
```

---

## Hand-check before calling it done

On `/progression` in C major:

1. Add I. In the roll, drag E to F: `Isus4`, chip showing, card highlighted.
2. *Back to I*: label restored, F kept. Undo: notes back as well.
3. Add V, raise it to a ninth, drag the ninth down a semitone: `V7♭9`, name `G7b9`, and
   the fretboard lights G B D F A♭ spelled with an A flat.
4. Add ii, drag its F to F♯: `II`.
5. Drag three notes of a slot into C C♯ D: the card goes unlabelled; Reset to chord brings
   the chord back.
6. Own a I's pitches, then click A minor on the circle: A C♯ E sounding, the card reads `I`.
7. Switch to B♭ major and add the borrowed ♭II: `C♭ Maj`.
8. Pick D♯/E♭ major on the fretboard's own key selector: every name is a flat.

## Not in M3

- **Notation spelling.** `NotePitch` has no letter; alphaTab spells the preview from the
  key signature, so a ♭II still engraves on B. Belongs with M4.
- **A thirteenth without its eleventh** goes literal. One line in the parse when a user
  misses it.
- The generated track in the Composer, Flatten, MIDI and `.gp` export — M4.
