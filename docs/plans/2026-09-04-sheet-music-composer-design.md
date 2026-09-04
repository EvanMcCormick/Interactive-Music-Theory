# Sheet Music Composer — Design

**Date:** 2026-09-04
**Status:** Implemented. See "Build status" at the end for what landed and
what is still outstanding.

## Goal

Add a page where users create sheet music and play it back. Full-featured from the
start: multi-track, key and time signature changes, dynamics, repeats, and guitar
tab alongside standard notation.

## Why this is cheap to build

alphaTab 1.8 is already integrated and already does the two hardest jobs:

- **Engraving** — renders standard notation and tab.
- **Playback** — soundfont synthesis, cursor, transport, per-track mixer.

Further APIs confirmed present in `alphaTab.d.ts` and central to this design:

| API | Use |
|---|---|
| `AlphaTabApi.tex(string)` | Render + play alphaTex source |
| `alphaTab.exporter.AlphaTexExporter` | Score to alphaTex |
| `alphaTab.exporter.Gp7Exporter` | Score to a real `.gp` file |
| `playOneTimeMidiFile(midi)` | Audition one note on the score's own soundfont |
| `metronomeVolume`, `countInVolume`, `playbackRange` | Metronome, count-in, loop |

Neither notation rendering nor audio synthesis needs to be written.

## Architecture

### Data flow

> **Revised during implementation.** The original plan hand-wrote an alphaTex
> serializer. A spike found `alphaTab.exporter.AlphaTexExporter`, so the score
> is now built as an alphaTab `Score` and rendered directly. That removed the
> largest and most error-prone piece of work, dropped a parse from every
> render, and makes the tex canonical by construction.

```
ScoreDoc  <-- map -->  alphaTab Score  --renderScore()-->  renders + plays
                             |
                             +-- AlphaTexExporter --> tex  (saving, escape hatch)
                             ^
      tex  --AlphaTexImporter-+                       (escape hatch input)
```

Editing mutates `ScoreDoc` immutably, `ScoreDocMapperService` turns it into an
alphaTab `Score`, and `api.renderScore()` engraves and rebuilds the MIDI. tex is
only generated for saving and for the escape-hatch panel. The reverse arrow runs
**only** when the user edits raw tex, so there is no sync loop.

**Why `ScoreDoc` rather than mutating alphaTab's `Score` directly:** undo/redo.
`ScoreDoc` is an acyclic plain object, so undo is `structuredClone` onto a stack.
alphaTab's model has cyclic parent references and cannot be snapshotted cheaply.

**Persistence stores the alphaTex string**, not the object graph — compact,
diffable, human-readable, and immune to `ScoreDoc` schema drift between versions.

### Score model

Shaped after Guitar Pro 7 / alphaTab, which TuxGuitar also broadly follows.

Three points where the GP shape differs from a naive model, all verified against
`alphaTab.d.ts`:

1. **Key signature lives on the bar, not the master bar.** alphaTab marks
   `MasterBar.keySignature` as `@deprecated - Use key signatures on bar level`
   (alphaTab.d.ts:10624). TuxGuitar agrees: `TGMeasure` carries the key,
   `TGMeasureHeader` does not. This matters for transposing instruments, where a
   Bb trumpet staff needs a different key signature than concert pitch in the
   same bar.
2. **A track owns several staves.** `Track.staves: Staff[]` is how a piano grand
   staff, or notation-plus-tab on one guitar track, is represented. `Staff`
   carries `stringTuning`, `capo`, `transpositionPitch`, `showTablature`, and
   chord diagrams.
3. **`Bar -> Voice[] -> Beat[]`**, not TuxGuitar's older GP5-era
   `Measure -> Beat -> Voice[]`. GP7 and alphaTab both invert it so a voice is a
   continuous stream. Matching GP7 keeps the mapping to alphaTab 1:1.

```ts
// models/composer.model.ts
// "Doc" suffix marks our editable model, distinct from alphaTab's runtime
// Score and from the existing music-theory.model.ts types.

ScoreDoc      { title, subTitle, artist, album, tempo,
                masterBars: MasterBarDoc[], tracks: TrackDoc[] }

MasterBarDoc  { timeSignature, isRepeatStart, repeatCount, alternateEndings,
                tripletFeel, section, tempoAutomation, isDoubleBar }

TrackDoc      { id, name, shortName, color,
                playback: PlaybackInfoDoc, staves: StaffDoc[] }

StaffDoc      { clef, clefOttava, tuning, capo, transpose,
                showTablature, showStandardNotation, bars: BarDoc[] }

BarDoc        { keySignature, voices: VoiceDoc[] }   // key is per bar per staff
VoiceDoc      { beats: BeatDoc[] }

BeatDoc       { duration, dots, tuplet, isRest, notes: NoteDoc[],
                dynamics, lyrics, effects }

NoteDoc       { pitch: NotePitch, isTied, accidental, effects }

type NotePitch =
  | { kind: 'fretted'; string: number; fret: number }      // alphaTex `3.3`
  | { kind: 'pitched'; noteValue: number; octave: number }  // alphaTex `C#4`
```

`NotePitch` is a discriminated union because alphaTex has exactly two note
syntaxes, and this maps 1:1 onto them while satisfying strict mode.

`PlaybackInfoDoc` mirrors GP's mixer channel — program, bank, volume, balance,
mute, solo — rather than a bare MIDI program number.

**Invariant owned by `ComposerService`:** adding or deleting a bar applies to
every track at once, so `masterBars.length` always equals each staff's
`bars.length`. The timeline can never desync.

## Components

Laid out like Guitar Pro, so it reads as familiar.

```
components/composer/
  composer.component.ts            # page shell, routed at /composer
  components/
    composer-toolbar/              # transport, tempo, metronome, count-in, loop
    composer-track-list/           # GP's left panel: mute/solo/volume, instrument
    composer-score/                # alphaTab render host + caret overlay
    composer-input/                # adaptive host - swaps by staff type
      fretboard-input/             #   fretted staves: string + fret
      keyboard-input/              #   pitched staves: pitch + octave
      duration-palette/            #   duration, dots, rest, tie, tuplet, dynamics
    composer-tex-panel/            # raw alphaTex + diagnostics gutter
```

### The caret

Everything else is chrome. As in GP and TuxGuitar, one caret points at a
position; entering a note writes there and advances it.

```ts
interface EditCursor {
  trackIndex: number;  staffIndex: number;  barIndex: number;
  voiceIndex: number;  beatIndex: number;
  stringIndex: number | null;   // fretted staves only
}
```

Arrow keys move the caret, number keys type frets directly on a tab staff, `+`
and `-` change duration — GP's shortcuts, so muscle memory carries over.

`composer-input` reads `staff.showTablature` to choose its widget, so "adaptive
per track" falls out of the model rather than needing a mode switch.

### Existing components are not reusable as-is

- `KeyboardComponent` is a display widget: it takes `keys: FretNote[]` and plays
  its own Tone.js synth on click, with no `@Output()` reporting what was clicked.
- `FretboardComponent` has no `@Input`/`@Output` at all — it is a 579-line page.

The composer needs purpose-built input widgets. They can borrow layout and SCSS
from the existing components but are new code.

## Services

| Service | Responsibility |
|---|---|
| `ComposerService` | `ScoreDoc` in a `BehaviorSubject`, edit operations, caret, undo/redo |
| `ScoreDocMapperService` | `ScoreDoc` to and from alphaTab's `Score` |
| `AlphaTexService` | alphaTex export/parse via alphaTab, with positioned diagnostics |
| `ComposerLibraryService` | IndexedDB persistence |
| `ComposerExportService` | `.gp`, alphaTex and MIDI download |
| `AlphaTabService` (extend) | `renderScore()`, `render()`, `auditionNote()`, metronome, count-in |

## Performance

Re-serializing and re-parsing the whole score on every keystroke will crawl on a
long piece. Two mitigations, designed in from the start:

- Renders are **debounced** (~150ms).
- **Auditioning is decoupled** from rendering. Clicking a note fires
  `playOneTimeMidiFile()` immediately, so the note sounds instantly even while
  the engraving catches up.

All components use `OnPush` change detection with `takeUntil(destroy$)`, and
`ChangeDetectorRef.detectChanges()` in alphaTab subscriptions, per the project's
`alphatab-gp-files` skill.

## Persistence and export

IndexedDB via `ComposerLibraryService`, following the `gp-library.service.ts`
pattern — database `composer-library`, store `compositions`. Each entry holds the
alphaTex string plus denormalized metadata (title, artist, tempo, trackCount,
dateModified) so the library list renders without parsing anything.

Export paths:

- **`.gp`** via `Gp7Exporter` — opens in real Guitar Pro, and can be handed
  straight to the existing GP Library.
- **`.alphatex`** as plain text.
- **MIDI** via alphaTab's existing MIDI generation.

## Error handling and testing

- The tex panel surfaces `AlphaTexDiagnosticBag` entries with source locations in
  a gutter.
- A failed parse leaves the last-good `ScoreDoc` untouched rather than blanking
  the score.
- **Serializer round-trip is the main test target:**
  `ScoreDoc -> tex -> alphaTab Score -> ScoreDoc` must be stable. Checkable as a
  property test over generated docs.
- Interval and note-naming math gets unit tests, per the project's
  `music-theory-verification` skill.
- alphaTab is mocked in component specs.

## Build phasing

Full-featured is the target; built in vertical slices so something is playable
early.

1. **Foundation** — model, mapper, `ComposerService`, page shell, tex panel,
   playback. *Done.*
2. **Guided entry** — caret, input widgets, duration palette, keyboard
   shortcuts. *Done.*
3. **Structure** — multi-track and per-track instruments, add/remove bars and
   tracks. *Partly done* (see below).
4. **Persistence** — IndexedDB library, `.gp` / tex / MIDI export. *Done.*

## Build status

Working and verified in the browser: note entry on fretted and pitched staves,
playback, undo/redo, multi-track, add/remove bars and tracks, save/load to the
IndexedDB library, export, and the alphaTex escape hatch with diagnostics.

Still outstanding, all of which the model and mapper already support - only the
UI controls are missing:

- Editing time signature, key signature and clef per bar.
- Repeats, alternate endings, section markers and triplet feel.
- Dynamics, tuplets and note effects (bends, slides, hammer-ons, harmonics).
- Multiple voices per staff.
- Per-track staff options: tuning, capo, transposition, tab/notation toggles.
- Track mixer controls (mute, solo, volume, balance).
- Looping a bar range for practice.

Known issues elsewhere in the repo, found while building this:

- `app.module.ts` and `app-routing.module.ts` are dead code. The app bootstraps
  from `main.ts`, which holds the live route table. Both were editable without
  any effect, which cost time; they should be deleted.
- `AlphaTabService.loadFromUrl`, `loadFromBuffer`, `seekToTick` and
  `setTrackVolume` have no callers.
