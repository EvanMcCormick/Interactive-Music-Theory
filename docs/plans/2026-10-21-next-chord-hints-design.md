# Next-Chord Hints — Design

**Date:** 2026-10-21
**Status:** Design agreed, not yet implemented. Plan: `2026-10-21-next-chord-hints.md`.

The progression composer builds progressions from scale degrees, with Roman numerals, borrowed chords, secondary
dominants and a recogniser - and gives no guidance on which chord to try next. This adds that guidance to the chord
palette on `/progression`: with a chord selected, the palette quietly marks the chords that conventionally follow it in
functional harmony, and says why.

The purpose is learning. The marks show *what* usually comes next; the caption names the motion - dominant to tonic,
deceptive, plagal - so the palette teaches the reason, not only the answer.

The idea came from the chord-motion tables in a bass method book the user read. Those tables are standard
functional-harmony knowledge, the book is copyrighted, and nothing here is taken from it: every entry below was checked
independently against harmony references (see [Verification](#verification)).

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| On or off | A `Suggest next` toggle, **on by default** | An explicit control, so the hints can be turned off; on by default so a learner meets them without hunting for them. |
| How a hint looks | A small `›` in the button's top-right corner, in the text colour | The palette's one colour mark - the white inset ring - means "the chord you are on". A hint must not compete with it, so it adds no colour and no ring. A glyph also reads without colour. |
| Which chord drives it | The **selected** chord, named in a caption: `After V (G Maj)` | Building left to right the selection is always the last chord, which is where a click appends. Selecting a chord in the middle still teaches what follows it, and the caption names which chord the hints are about. |
| Borrowed chords and secondary dominants | Both get hints as the selected chord; marks may land on the **Borrowed** row; secondary dominants are never targets | A minor key's major V and leading-tone vii° live on the Borrowed row - without it, "iv → V" in A minor could only point at the weak diatonic v. Marking V/x ahead of every hinted x would mark half the panel. |
| Other modes | Major and the minor family get full tables; dorian, phrygian, lydian and mixolydian get their characteristic cadence; every other scale says hints do not cover it | Only major and minor have settled tables. The church-mode cadences are well documented; anything beyond them would be invented. |
| The reason | The caption names the motion for each hinted chord | The user is building this to learn from and to teach with. |
| Songwriting | The same module, adopted after S1 | `likelyNextDegrees` takes a key's intervals and a `ChordShape` and knows nothing about the palette, so the songwriting Chords tab can call it unchanged. S1's plan is not touched. |

---

## 1. What the user sees

```
 CHORDS IN THIS KEY                               [› Suggest next]
 After V (G Maj): I — dominant to tonic · vi — deceptive

 ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
 │ I   ›│ │  ii  │ │ iii  │ │  IV  │ │  V   │ │ vi  ›│ │ vii° │
 │C Maj │ │D min │ │E min │ │F Maj │ │G Maj │ │A min │ │ B°   │
 └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
```

- **The toggle** sits at the right of the title row: a `toggle` button in the style the Sus buttons use, with
  `aria-pressed`, starting pressed.
- **The caption**, one dim line under the title, says which chord the hints answer for and why each one is hinted.
  - A hinted target: `After V (G Maj): I — dominant to tonic · vi — deceptive`. Each target is named by the numeral its
    button prints, in table order.
  - The tonic of major or minor: `After I (C Maj): any chord — the tonic can go anywhere`, and **no marks**: marking all
    seven says nothing.
  - A chord with no entry, or whose targets are on no button: `No common next chord after vi° (A dim)`.
  - A scale outside the tables: `Next-chord hints cover major, minor and the church modes`.
  - Nothing selected, a literal slot selected, a key that can build no chords, or the toggle off: no caption and no
    marks.
- **The mark** is an `aria-hidden` `›` in the top-right corner of each hinted button, on the seven diatonic buttons and
  on the Borrowed row. Never on the Secondary row and never on the alternates row, which re-shapes rather than appends.
- **Spoken:** a hinted button's label gains `, a common next chord`. The caption sits in a polite live region whose
  wrapper is always present, the rule the palette's other two regions follow, so moving the selection announces
  `After V, G major: …`. The numerals in the spoken caption are replaced by the spoken chord names, as every label on
  the palette already does.

## 2. The tables

Each target carries a **reason** - the standard name of the motion - which the caption prints. Numerals are written
as a reader expects them in that key; inside the module each chord is a letter degree, the root's semitones above the
tonic, and a triad family (see section 3).

### Major (ionian)

| After | Next | Reason |
|---|---|---|
| I | any | the tonic can go anywhere |
| ii | V, vii° | predominant to dominant |
| iii | vi · IV | falling fifth · rising step |
| IV | V, vii° · ii · I | predominant to dominant · falling third · plagal |
| V | I · vi | dominant to tonic · deceptive |
| vi | ii · IV · V | falling fifth · falling third · falling step |
| vii° | I | dominant to tonic |

**Borrowed chords in a major key** (ionian only - the chords `chordVocabulary` offers on the Borrowed row):

| After | Next | Reason |
|---|---|---|
| ♭II | V | predominant to dominant |
| ♭III | ♭VI · IV | falling fifth · rising step |
| iv | V · I | predominant to dominant · plagal |
| ♭VI | ♭VII · V · iv | rising step · predominant to dominant · falling third |
| ♭VII | I · IV | modal cadence · double plagal |

### Minor (aeolian, harmonic minor, melodic minor)

The three forms share one table, as the minor key does in practice. **V means the major dominant and vii° the raised
leading-tone triad**; in aeolian both are on the Borrowed row, which is where those marks land.

| After | Next | Reason |
|---|---|---|
| i | any | the tonic can go anywhere |
| ii° | V, vii° | predominant to dominant |
| ♭II (Neapolitan) | V | predominant to dominant |
| III | VI · iv | falling fifth · rising step |
| iv | V, vii° · ii° · i | predominant to dominant · falling third · plagal |
| V | i · VI | dominant to tonic · deceptive |
| v | VI · iv | rising step · falling step |
| VI | ii° · iv · V | falling fifth · falling third · predominant to dominant |
| VII | III · i | falling fifth · aeolian cadence |
| vii° | i | dominant to tonic |

A key's own chord on a row's root matches the row even when its quality differs - harmonic minor's III+ uses the III
row, melodic minor's ii and IV use the ii° and iv rows. Melodic minor's vi° has no row and gets the "no common next
chord" caption.

### Church modes

Each mode gets its characteristic cadence, and its tonic hints the chord that gives the mode its colour.

| Mode | After | Next | Reason |
|---|---|---|---|
| Dorian | i · IV | IV · i | the mode's signature chord · modal cadence |
| Phrygian | i · ♭II | ♭II · i | the mode's signature chord · modal cadence |
| Lydian | I · II | II · I | the mode's signature chord · modal cadence |
| Mixolydian | I · ♭VII · v | ♭VII · I · I | the mode's signature chord · modal cadence · modal cadence |

Every other chord in these modes gets the "no common next chord" caption.

### Secondary dominants (any supported key)

A selected chord that is **not one of the key's own** - its root is displaced, or its quality differs from the key's
triad on that degree - and that is major or dominant-seventh, with its root a perfect fifth above a degree carrying a
major or minor triad, hints that degree: "secondary dominant", or "dominant to tonic" when the degree is the tonic. D
major in C hints V; E7 in C hints vi.

This rule runs only after the key's tables have no entry, so a major key's own V stays a table row, and harmonic
minor's V is "dominant to tonic" rather than a secondary dominant of i.

### Matching a target to a button

A target is a root and a triad family. It is marked on the first of:

1. the diatonic button on that root whose triad has that family;
2. a Borrowed option on that root with that family;
3. the diatonic button on that root, whatever its family (melodic minor's IV for the table's iv).

A target that matches no button is dropped. If every target is dropped, the caption is the "no common next chord" one.

## 3. Architecture

### `services/progression-next-chords.ts` - pure, tested

```ts
export function likelyNextDegrees(
  scaleIntervals: readonly number[],
  selected: ChordShape
): NextChords;

export type NextChords =
  | { kind: 'targets'; targets: readonly NextChordTarget[] }
  | { kind: 'any' }          // the tonic of major or minor
  | { kind: 'none' }         // a chord the tables have no entry for
  | { kind: 'unsupported' }; // a scale outside the tables

export interface NextChordTarget {
  degree: number;            // 0-6, the letter, as ChordDegree.degree
  alter: number;             // semitones the root is displaced, for this key
  family: TriadFamily;
  reason: MotionReason;
}

export type TriadFamily = 'major' | 'minor' | 'diminished' | 'augmented';
```

- **Which table** is decided by comparing the scale's intervals with ionian, the three minor forms and the four church
  modes - the same way `progression-vocabulary.ts` names its parallel modes - and not by scale id, because
  `melodicMinor` and `melodicMinorMode1` are one scale.
- **The tables are frozen data.** A row is `{ degree, semitones, family }` and so is each target. `alter` is worked out
  per key as `semitones - scaleIntervals[degree]`, which is how one minor table serves aeolian (vii° has alter +1) and
  harmonic minor (alter 0). The music lives in the tables, not in code branches.
- **The selected chord is read through `effectiveChord`**, the identity the strip card and the fretboard already share:
  its `root` gives the semitones and its `base` the family. Sevenths and added tones reduce to their triad - dominant7,
  major7, major6 and add9 are major; minor7, minor6, minorMajor7 and minorAdd9 minor; halfDiminished7 and diminished7
  diminished; augmented7 and augmentedMajor7 augmented - so V7 and ii7 find their triad rows. A slot whose stack has no
  name (`'other'`) gets `none`.
- **Lookup order:** the key's table (exact root and family, then the key's own chord on that root), its borrowed rows
  (ionian only), the secondary-dominant rule, then `none`.

### `components/progression/components/chord-palette/chord-palette-hints-view.ts` - pure, tested

A sibling of the palette's two existing view modules. From `NextChords`, the selected chord's name, the seven
`PaletteChord`s and the Borrowed `PaletteOption`s, it builds:

- the set of hinted buttons, by the three-step matching in section 2;
- the caption, visible and spoken;
- the label suffix for hinted buttons.

### The palette component

About forty lines: the toggle handler, three fields (`hintedDegrees`, `hintedOptionKeys`, `hintCaption` and its spoken
twin), and one call in `render`. Labels are built in the view module, never in bindings. The component is at 856 lines
against the 1000-line cap, and the logic stays in the two pure modules.

### State

`ProgressionState` gains `suggestNext: boolean`, starting `true`. `ProgressionService.setSuggestNext(on)` sets it. It
is a view preference: not in the document, no undo step, not saved across reloads - the way the transport's Loop
behaves.

### Songwriting

The module takes intervals and a `ChordShape`; a song's chord atom carries a whole `ChordSlot`. The songwriting Chords
tab (`docs/plans/2026-10-01-songwriting-design.md`, on `docs/songwriting-design`) can call it unchanged once S1 has
landed. That design gets a one-line follow-up when this ships; this work does not edit it.

## 4. Testing

- `progression-next-chords.spec.ts`: one case per table row in C major and A aeolian; the minor table again in harmonic
  and melodic minor, proving the per-key `alter`; each church-mode cadence and signature; secondary dominants in a
  sharp key and a flat key, including one that targets the tonic; V7, ii7 and ø7 finding their triad rows; a
  borrowed-row chord in a minor key, where the major-key borrowed rows must not apply; `any`, `none`, `unsupported`, and
  a slot with no name; deep-frozen inputs through `deep-frozen.spec-helper.ts`.
- `chord-palette-hints-view.spec.ts`: each matching step, a dropped target, every caption, spoken forms, the label
  suffix.
- Palette component spec: the toggle, marks appearing and clearing with the selection, nothing marked with the toggle
  off or nothing selected.
- **Hand check, by ear:** walk I-vi-ii-V-I in C following the marks; A minor's iv to the borrowed V; mixolydian's ♭VII
  to I; and listen to minor v → VI and v → iv, the one entry the references did not chart.

## Verification

The tables were checked against independent references, not the book. The notes, with source URLs, are in the session
notes file `next-chord-table-verification.md`; the findings that shaped the tables:

- **Major:** all seven rows confirmed. V → I is about 85% of what follows V in the Kostka-Payne corpus counts
  (Temperley), V → vi about 3%; vi → ii dominates what follows vi. IV → I (plagal) and V → I are standard even though
  one popular chart omits them.
- **Left out on purpose:** vi → iii, iii → ii and vii° → iii are attested but rare; V → IV is the textbook retrogression
  (about 2%).
- **Minor:** i → any, ii° → V/vii°, III → VI/iv, iv → V/vii°, V → i/VI, VII → III and vii° → i confirmed. Three entries
  go beyond the strict charts, each for a stated reason: iv → ii° and iv → i by analogy with the major IV → ii and the
  plagal motion; VII → i as the aeolian cadence (♭VI-♭VII-i); and the natural v → VI, iv as its descending-bass use
  (i-v⁶-iv⁶), the weakest entry, which the hand check covers by ear.
- **Church modes:** mixolydian ♭VII → I is the classic-rock cadence and the I-♭VII-IV double plagal loop is widely
  described; the dorian, phrygian and lydian cadences are the standard characteristic-chord cadences.

## Out of scope

- Ranking the hints by how common they are. The corpus counts exist; one mark is easier to read.
- Hints that look back more than one chord.
- Marking secondary dominants as targets.
- Hints in the songwriting Chords tab - the follow-up after S1.
