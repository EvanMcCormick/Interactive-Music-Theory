# The GP Viewer becomes the composer

**Date:** 2026-09-14
**Status:** Designed, not planned. The milestone after M2 of
[the composer editor redesign](2026-09-13-composer-editor-design.md) and before its M3.
**Supersedes:** "After M2: the GP Viewer becomes the composer" in that document (Part 1), and
the paragraph of the same name under "Next milestone, when there is one" in `docs/TODO.md`.

There are two pages that draw a score. `/gp-viewer` opens a Guitar Pro file, plays it, and
cannot change a note. `/composer` edits a score it built itself, and cannot open a file. A
user who wants to change one bar of a `.gp` file has nowhere to go.

This milestone makes the composer the one page. A `.gp` file opens there, and until the first
edit it is alphaTab's own reading of the bytes - every track, as the file was written. The
first command that would change the document asks, naming what converting that file would
change, and offers to save the untouched original first. After Convert it is an ordinary
composition, and the viewer route goes.

---

## What the two pages have today

### The viewer shows one track of a full band

`AlphaTabService.loadFile` is the only route from a file to the screen, and it reads:

```ts
this.api.load(uint8Array, [0]); // Load first track by default
```

`services/alpha-tab.service.ts:186`. Meanwhile `GpViewerComponent` lists *every* track in its
sidebar with a mute and a solo button (`components/gp-viewer/gp-viewer.component.html:43-59`),
and nothing anywhere calls `api.renderTracks`. So a four-piece file shows one staff, the
sidebar names the other three, and their mute buttons work on music that is not drawn.

### The two pages set alphaTab up differently

| | Viewer (`components/gp-viewer/gp-viewer.component.ts:124-146`) | Composer (`components/composer/components/composer-score/composer-score.component.ts:194-216`) |
|---|---|---|
| Angular zone | inside it (`:127`) | `ngZone.runOutsideAngular` (`:198`) |
| `enableUserInteraction` | `true` (`:140`) | `false` (`:206`), so alphaTab's mouse-up cannot set the playback range |
| Tracks drawn | `[0]`, hard-coded in the service | all of them: `score.tracks.map((_, index) => index)` (`:260`) |
| Zero width and resize | neither | a `renderPending` guard (`:246-249`) and a `ResizeObserver` (`:275-293`) |
| Source | bytes through `api.load` | a `ScoreDoc` through `ScoreDocMapperService.toScore` (`:255`) |
| Soundfont | `/soundfont/sonivox.sf2` (`:141`) | `/soundfont/sonivox.sf2` (`:207`) |

Both use the one root `AlphaTabService`, and `initializeApi` disposes any api already there
(`services/alpha-tab.service.ts:53-55`). That is safe only because a route is deactivated
before the next is activated - the fact the progression design already records under its third
"finding recorded rather than fixed". One page instead of two makes it safer, not less so.

### The transport the composer needs already exists, in the viewer

`AlphaTabService` has `play`, `pause`, `stop`, `seekToTime` (`:317`), `setPlaybackSpeed`
(`:326`), `setVolume` (`:336`), `setLooping` (`:346`), `setTrackMute` (`:357`) and
`setTrackSolo` (`:369`), and `AlphaTabState` carries `timePosition`, `totalDuration`,
`tempoMultiplier`, `volume` and `isLooping` (`models/alpha-tab.model.ts:11-38`). The viewer
draws controls for all of them (`components/gp-viewer/gp-viewer.component.html:109-182`); the
composer draws play, stop, a BPM field, metronome and count-in
(`components/composer/composer.component.html:20-43`) and none of the rest. So decision 10 is
a move more than a build.

### The two libraries

| | `GpLibraryService` | `ComposerLibraryService` |
|---|---|---|
| Database, store | `gp-library`, `files` (`services/gp-library.service.ts:5-7`) | `composer-library`, `compositions` (`services/composer-library.service.ts:4-6`) |
| Payload | `fileData: ArrayBuffer` (`models/alpha-tab.model.ts:171`) | `tex: string`, alphaTab's own alphaTex (`:21`) |
| Write | `store.add` - create only (`:113`) | `store.put` - upsert (`:131`) |
| Open | `initDatabase()` from the constructor, re-opened ad hoc (`:87`, `:196`) | one memoised `ensureDb()` (`:48-72`) |
| Subject holds | every record, `ArrayBuffer`s included (`:74`) | summaries with `tex` stripped (`:82-85`) |

**Files added from the gallery carry invented metadata.** `GpLibraryComponent.addFiles` calls
`addFile(file, {})` (`components/gp-library/gp-library.component.ts:152`), and the service
fills the gaps:

```ts
trackCount: metadata.trackCount || 0,
tempo: metadata.tempo || 120
```

`services/gp-library.service.ts:107-108`. Nothing parses the file, so the card prints
"120 BPM" and "0 tracks" (`components/gp-library/components/gp-file-card/gp-file-card.component.html:28-29`)
and sorting by BPM sorts every such file as if it were 120. Only a file saved from the viewer
carries real values, from `getScoreInfo()` (`components/gp-viewer/gp-viewer.component.ts:200-206`).

**This milestone fixes that as a side effect of opening the file.** Every route into the
Original state parses the bytes before anything is written, so the entry is written - or
updated through `GpLibraryService.updateEntry`, which exists at `:136` and has no caller
today - with the real title, artist, album, tempo and track count from the parsed `Score`. An
older entry is corrected the first time it is opened.

### What the composer's model cannot hold

`ScoreDoc` has seven fields (`models/composer.model.ts:379-388`) and the mapper is
`toDoc(score)` / `toScore(written, settings)` (`services/score-doc-mapper.service.ts:471`,
`:192`). Conversion is one call to `toDoc`, and one to `frettedDocOf`
(`services/pitch-on-strings.ts`) after it, so a gap in either is what the prompt has to name.
Part 2 is the full list, less the one gap this milestone closes: **percussion**, which is
decision 12 and Part 3, because a drum track did not convert short - it converted wrong.

One entry of the M2 design's own GP paragraph is wrong and is corrected here. It says the
model cannot hold **multiple voices**. It can: `BarDoc.voices` is an unbounded `VoiceDoc[]`
(`models/composer.model.ts:236`), `toDoc` reads every voice (`:567`) and `toScore` writes
every voice (`:333-335`). What is true is narrower, and belongs to the save rather than to the
conversion: `toVoice` draws a rest-only voice past the first as empty (`:376-378`), so alphaTex
writes none of its beats - already recorded in `docs/TODO.md` and pinned in
`composer.service.voices.spec.ts` - and no edit reaches a second voice at all.

---

## Decisions

Settled with the user on 2026-09-14, before planning. Written as decided.

1. **The viewer goes.** `/gp-viewer` and `GpViewerComponent` are deleted, with the nav link
   (`app.component.html:10`) and the route (`main.ts:21-25`). `/gp-library` stays as the
   gallery for `.gp` files - grid and list, filters, sort, delete, drag-and-drop import - and
   its Open goes to `/composer?gp=<id>`.
2. **The composer's Library menu lists imported `.gp` files beside saved compositions**, and
   gains **Import .gp…**. The composer page also takes a `.gp` dropped anywhere on it.
3. **Two states.** **Original** is the bytes alphaTab read, every track rendered, no `ScoreDoc`
   behind it. **Composition** is today's composer. Opening a `.gp` starts in Original; every
   other way in starts in Composition. The status line says "Viewing the original file" in
   Original, and the palette, the keys and the popovers stay live.
4. **The first command that would change the document asks**: a palette press, an editing key,
   paste, an alphaTex apply. Caret moves, selection, playback and display changes do not ask.
5. **The prompt names what converting would change in that file**, with counts and the first
   bar affected. It offers **Save the original file first**, which downloads the untouched
   `.gp`. Then **Convert** or **Cancel**. Convert maps to a `ScoreDoc`, replaces the library
   entry with the composition, drops the bytes, and applies the edit that asked. Cancel changes
   nothing.
6. **Conversion is not undoable, and the prompt says so.** History starts empty at the
   converted score, as a load does.
7. **The loss checker is a pure module over the alphaTab `Score`.** It reports nothing for a
   file that converts whole. Each item gets a spec.
8. **The track strip lists every track in both states**, and each row gains show/hide - whether
   its staves render - mute and solo. In Original these act on the alphaTab score, in
   Composition on the document. M3's mixer builds on the rows.
9. **Scale highlighting moves out of the viewer into a panel the composer can open**, working
   in both states, still reading `MusicTheoryService`.
10. **The transport gains loop, tempo percent (25-200), volume, and a seek bar with a time
    readout**, all through `AlphaTabService`, in both states.
11. **Build order** is Part 8.
12. **Percussion joins the model in this milestone.** A drum track was the one thing in Part 2's
    tables that converted *wrong* rather than short. `NotePitch` gains a third kind, `TrackDoc`
    gains the articulation list and `StaffDoc` gains `isPercussion`, so a kit converts, plays,
    saves and reloads as itself. Writing a new drum note is not part of it. Part 3.
13. **Out of scope**: growing the model past percussion, writing `.gp` back, and M3's
    inspector, mixer and bar grid.

Three readings the decisions leave open, settled here and repeated in the table at the end:

- **A file that converts whole still prompts.** Decision 7 is about the checker, not the
  prompt. Conversion drops the original bytes whatever the checker finds, and decision 6 says
  that cannot be undone, so the question is still worth asking. The body then reads "Nothing in
  this file would change" and Save the original first is still offered.
- **Show/hide is never an edit**, in either state. `TrackDoc` has no visibility field and
  alphaTab's `Track.isVisibleOnMultiTrack` is not in the model, so it is a page setting -
  applied through `renderScore`'s track indices in Composition and `api.renderTracks` in
  Original - and decision 4's "display changes do not ask" covers it.
- **Mute and solo in Original are the player's, not the file's.** `AlphaTabService.setTrackMute`
  calls `api.changeTrackMute` (`services/alpha-tab.service.ts:361`), which does not write
  `Track.playbackInfo`. So Convert takes the mixer the file itself declares, which `toDoc`
  reads at `services/score-doc-mapper.service.ts:527-533`, and re-applies the strip's own mutes
  to the player on top.

---

## Part 1: Two states, and the data flow into each

### The state lives on its own service

`ComposerService` is 861 lines against `CLAUDE.md`'s 1000-line cap, and M2 already moved its
history out into `composer-history.ts` to make room for M3. The Original state does not go in
it. A new root service, `ComposerGpService` (`services/composer-gp.service.ts`), holds a
`BehaviorSubject<GpOriginal | null>`:

```ts
interface GpOriginal {
  entryId: string;          // the gp-library entry the bytes came from
  fileName: string;
  bytes: ArrayBuffer;       // dropped on Convert
  score: alphaTab.model.Score;
  loss: LossItem[];         // measured once, on load
}
```

Non-null means the page is in Original. `ComposerState` gains nothing: the empty document it
already holds is simply not drawn while a `GpOriginal` is current.

### From an entry to a render

| Entry | Opens in | Path |
|---|---|---|
| `/composer?gp=<id>` - the gallery's Open | Original | `GpLibraryService.getEntry(id)` → `fileData` → `AlphaTabService.loadBytes` |
| Library menu → **Import .gp…** | Original | the picker → parse → a `gp-library` entry → as above |
| A `.gp` dropped on the page | Original | the drop → parse → a `gp-library` entry → as above |
| Library menu → an imported `.gp` row | Original | its entry, as above |
| Library menu → a saved composition | Composition | `composer-library` alphaTex, as today |
| **New** | Composition | an empty `ScoreDoc`, as today |
| Transcription's **Open in Composer** | Composition | `derived.doc` (`components/transcription/transcription.component.ts:327-333`) |
| Progression's **Send** | Composition | today's path |
| `/composer` with no query | Composition | today's empty score |

Every route into Original writes or updates a `gp-library` entry **before** the page enters the
state, so Convert always has exactly one entry to replace, and a drop that alphaTab cannot
parse leaves nothing behind.

Rendering, per state:

```
Original      entry.fileData -> AlphaTabService.loadBytes(bytes, visibleTrackIndices)
                             -> alphaTab parses -> scoreLoaded -> the Score
                             -> conversionLossOf(score), once
                             -> api.renderTracks(...) on a show/hide change

Composition   ComposerState.doc -> ScoreDocMapperService.toScore(doc, settings)
                                -> AlphaTabService.renderScore(score, visibleTrackIndices)
```

`renderCurrentDocument` in
`components/composer/components/composer-score/composer-score.component.ts:239-266` gains the
branch, and nothing else
about it moves: the debounce (`:171-173`), the zero-width guard (`:246-249`) and the
`ResizeObserver` (`:275-293`) serve both states, and the viewer had none of them.

`AlphaTabService.loadFile` is replaced by `loadBytes(bytes: ArrayBuffer, trackIndices: number[])`.
The hard-coded `[0]` at `:186` goes with it, and so does the Blob-and-File round trip the viewer
used to get an `ArrayBuffer` back out of an `ArrayBuffer`
(`components/gp-viewer/gp-viewer.component.ts:182-185`).

`enableUserInteraction` stays `false` in both states. The composer resolves every press itself
from the bounds lookup, and M2 decision 22 turned alphaTab's own interaction off for a reason
that has not changed.

### The caret in Original

The caret is an `EditCursor` - `{ trackIndex, staffIndex, barIndex, voiceIndex, beatIndex,
stringIndex }` (`models/composer.model.ts:394-402`) - which is an address, not a piece of the
document. Everything that resolves one already works off the rendered score and its bounds:
`pressSystemIndexOf`, `slotIndexAt`, `targetTrackBeat` and `highlightBeatsOf` in
`services/composer-score-systems.ts`, and `StaffHitTestService`.

One function reads the document, and it reads five fields of each staff:

```ts
export function staffSlotsOf(doc: ScoreDoc): StaffSlot[]
```

`services/composer-score-interaction.ts:36-48`, reading `showSlash`, `showStandardNotation`,
`showNumbered`, `showTablature` and `tuning.length`. An alphaTab `Staff` has every one of them
(`showSlash`, `showStandardNotation`, `showNumbered`, `showTablature`,
`stringTuning.tunings.length`), so it gains a sibling, `staffSlotsOfScore(score, visible)`,
returning the same `StaffSlot[]` over the tracks actually drawn. That is the whole of what the
caret, the selection highlight and Pen's hover need to work in Original.

### What each state changes about the page

| | Original | Composition |
|---|---|---|
| Status line | "Viewing the original file", beside the caret readout | as today |
| Palette, keys, popovers | live; the first that would change the document asks | as today |
| Caret, selection, click-to-seek, Pen's hover | as today, over the alphaTab `Score` | as today |
| Undo, Redo | disabled - there is no history until there is a document | as today |
| The BPM field | disabled: it writes `ScoreDoc.tempo`, and there is no document. The file's tempo is shown beside it | as today |
| The title field | the file's title, read only | as today |
| Bars over their time signature | not shown: `scoreBarFills` reads a `ScoreDoc` | as today |
| alphaTex panel | opens and shows alphaTab's own alphaTex for the file; Apply asks, as any edit does | as today |
| Save | asks first, as any edit does: the library holds compositions, not files | as today |

---

## Part 2: The loss checker

**A pure module, `services/gp-conversion-loss.ts`**, over the alphaTab `Score` and nothing
else:

```ts
conversionLossOf(score: alphaTab.model.Score): LossItem[]

interface LossItem {
  id: LossId;                            // one per row of the tables below
  group: 'conversion' | 'first save';    // which heading the prompt lists it under
  label: string;                         // "Chord diagrams"
  detail: string;                        // "3 diagrams, first in bar 5"
  count: number;
  firstBar: number;                      // 1-based; 0 where the item is not on a bar
}
```

It walks the score once - master bars, then each track's staves, bars, voices, beats and notes
- and returns only the items the file has, ordered by `firstBar` then by `count` descending. A
file that converts whole returns `[]`.

It is named for what it returns, per `CLAUDE.md`'s rule for pure derivations, and it never
touches the mapper: the mapper is what it is *about*. When the model grows a field, the item
comes out of this table and its spec is deleted, which is the audit trail.

### What it reports

Every row was checked against `services/score-doc-mapper.service.ts`,
`models/composer.model.ts` and `services/alpha-tab-enum.bridge.ts`. "In the model" means the
field exists on a `*Doc`. A bare line number is `models/composer.model.ts` where it follows a
`*Doc`, and `services/score-doc-mapper.service.ts` where it follows a mapper method.

| Item | alphaTab | In the model | Counted from |
|---|---|---|---|
| Chord diagrams | `Staff.chords`, `Beat.chordId` | no - `BeatDoc` (`:243-277`) and `StaffDoc` (`:214-229`) have no chord; the mapper names neither | diagrams per staff |
| Tremolo bar | `Beat.whammyBarType`, `whammyBarPoints`, `whammyStyle` | no - `BeatEffectsDoc` (`:285-300`) has twelve fields and no whammy; bend points are per note only (`:376`) | beats with a whammy |
| Wah | `Beat.wahPedal` | no | beats with the pedal open or closed |
| Lyric lines past the first | `Beat.lyrics: string[]` | one line: `BeatDoc.lyrics: string \| null` (`:274`); read as `beat.lyrics[0]` (`:601`), written as `[doc.lyrics]` (`:396`) | beats whose array is longer than one |
| Tempo changes past a bar's first, and any on bar 1 | `MasterBar.tempoAutomations` | one BPM per bar from `index > 0` (`:505-508`); `ratioPosition`, `isLinear` and the marking's text go too | automations not kept |
| The slides with no name | `SlideOutType.OutDown`, `PickSlideDown`, `PickSlideUp`; `SlideInType.IntoFromAbove`; and a slide-in on a note that also slides out | `slideOf` (`services/alpha-tab-enum.bridge.ts:202-209`) names `Shift`, `Legato`, `OutUp` and `IntoFromBelow` only, and reads the slide-in only when the slide-out is `None` | notes per kind |
| Directions | `MasterBar.directions` - nineteen kinds, D.C., D.S., Coda, Fine | no - `MasterBarDoc` has nine fields (`:100-120`) | markings |
| Sync points | `MasterBar.syncPoints`, `Score.backingTrack` | no | sync points |
| Stylesheet and systems layout | `Score.stylesheet` (22 settings, multi-bar rests among them), `Score.defaultSystemsLayout`, `Score.systemsLayout`, `Track.systemsLayout`, `Track.lineBreaks`, `MasterBar.displayScale`/`displayWidth`, `Bar.displayScale`/`displayWidth` | none of it | one item, reported when any setting differs from alphaTab's default |
| Fade-out and volume swell | `Beat.fade`, a `FadeType` of four | a boolean: `BeatEffectsDoc.fadeIn` (`:291`). The mapper already says so - "Fade out and volume swell read as no fade in: the model has neither yet" (`:585-586`) | beats fading out or swelling |

And what the sweep found beyond them. Each is something a real Guitar Pro file holds, or a step
of the conversion outside the mapper, and each reads back as nothing:

| Item | alphaTab | Note |
|---|---|---|
| Tremolo picking | `Beat.tremoloPicking` | distinct from the tremolo bar above; both are lost |
| Ornaments | `Note.ornament` - turn, inverted turn, upper and lower mordent | |
| Sustain pedal | `Bar.sustainPedals` | a piano track loses every pedal marking |
| Simile marks | `Bar.simileMark` | |
| Barré | `Beat.barreFret`, `barreShape` | |
| Rasgueado | `Beat.rasgueado` - nineteen patterns | |
| Golpe | `Beat.golpe` | |
| Beat-level ottava | `Beat.ottava` | the model has ottava on the bar's clef alone (`BarDoc.clefOttava`, `:233`) |
| Slash beats and dead slaps | `Beat.slashed`, `Beat.deadSlapped` | a dead-slapped beat has no notes, so `fromBeat` reads it as a plain rest (`:598`) |
| Per-note dynamics | `Note.dynamics` | the model marks a dynamic on the beat (`:273`) |
| An artificial harmonic's pitch | `Note.harmonicValue` | the kind survives, the pitch does not, so the note sounds and engraves wrong |
| Bend style, continued bends | `Note.bendStyle`, `isContinuedBend` | gradual and fast bends flatten to the default |
| Slurs | `Note.isSlurDestination`, `Beat.isLegatoOrigin` | |
| Invisible notes, shortened notes | `Note.isVisible`, `durationPercent` | |
| Instrument, volume and balance automations | `Beat.automations` | never read; only tempo automations are, and only a bar's first |
| Pickup bars | `MasterBar.isAnacrusis` | an anacrusis becomes a full bar |
| Bar line styles | `Bar.barLineLeft`, `barLineRight` - twelve kinds | the model has `isDoubleBar` alone (`:118`), and alphaTab marks that deprecated |
| Beaming | `MasterBar.beamingRules`, `Beat.beamingMode`, `invertBeamDirection`, `preferredBeamDirection` | |
| Brush speed | `Beat.brushDuration` | the strum direction survives, its speed does not |
| Forced natural, forced none | `AccidentalMode.ForceNatural`, `ForceNone` | both read as `auto` (`:122-127`), for the reason argued at `:62-86` |
| Notes no string can reach | - | not the mapper's: `frettedDocOf` (`services/pitch-on-strings.ts`) frets every pitched note on a staff with a tuning and leaves out the ones no free string reaches, because alphaTab cannot draw a pitched note on tablature (M2 decision 33). Counted by running it on the converted document. A percussion staff never meets it: a drum note is its own kind of pitch, and a percussion staff has no tuning to fret it on |
| Score credits | `Score.copyright`, `music`, `words`, `tab`, `notices`, `instructions`, `tempoLabel` | `ScoreDoc` holds title, subtitle, artist and album only (`:379-388`) |
| MIDI channels | `PlaybackInformation.primaryChannel`, `secondaryChannel`, `port` | `PlaybackInfoDoc` (`:127-138`) has program, bank, volume, balance, mute and solo, and no channel. A drum track is the exception and gets its channel back for nothing: `Score.finish` puts a track whose single staff is percussion on channel 9, primary and secondary (`alphaTab.core.mjs:4316-4321`) |
| Custom styles | `Score.style`, `Track.style`, `Bar.style`, `Beat.style`, `Note.style` | per-element colour and notehead choices |

### What it must not report, and what belongs to the save

- **Multiple voices convert whole.** The correction under "What the composer's model cannot
  hold" above. What the checker reports instead, as a *save* item rather than a conversion one,
  is a **second voice holding only rests**: conversion keeps it and the save after it does not
  (`:376-378`).
- **A drum track converts whole**, from this milestone on - decision 12 and Part 3. What the
  checker reports, and again as a save item, is **a kit the file invents**: percussion notes
  whose articulation indexes into a non-empty `Track.percussionArticulations`. alphaTex names a
  drum note from Guitar Pro's standard table, and an articulation that table does not name is
  written `"unknown"` and cannot be read back. The count is the exposure, not the loss - the
  table is internal to alphaTab, so nothing outside it can say which names will be found - and
  the detail says so. Part 3's "alphaTex carries percussion" has the mechanism, and the
  conversion proves the save rather than trusting this count.
- **A double bar** survives conversion and is lost by the save, because alphaTab 1.8 reads
  `\db` and never writes it - already pinned in `score-doc-mapper.effects.spec.ts` and recorded
  in `docs/TODO.md`. It is reported in the same save group.
- **Fermatas** are not a loss. alphaTab files them per bar and tick and `Voice.finish` hands
  them back, and `BeatEffectsDoc.fermata` (`:293`) carries them per beat.

The prompt draws the conversion group first and the save group under a second heading, so
"this file will look different now" and "this file will look different after you save" are not
the same sentence.

---

## Part 3: Percussion in the model

Decision 12. A drum track was the one row of Part 2 that converted *wrong* rather than short:
`fromNote` read a percussion note's `tone` and `octave` as a pitch
(`services/score-doc-mapper.service.ts:631-642`) and `toStaff` never set `isPercussion`, so a
kit came back as pitched notes on a five-line staff. It is also the smallest row to fix.
alphaTab keeps a drum note in one number, a drum kit in one list and a drum staff in one flag,
and the model can copy all three verbatim.

Every line number below is `client/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`
in 1.8.0 unless it is given a file.

### What alphaTab keeps

| Field | What it is |
|---|---|
| `Note.percussionArticulation` | one number, default -1. Below `Track.percussionArticulations.length` it is an **index into that list**; at or above it, an **id** looked up in alphaTab's own table (`PercussionMapper.getArticulation`, `:5401-5412`) |
| `Note.isPercussion` | derived, not stored: `!isStringed && percussionArticulation >= 0` (`:5705`). Such a note leaves `string`, `fret`, `tone` and `octave` at -1 |
| `Note.realValue` | the articulation number itself on a percussion note (`:6067-6069`) |
| `Track.percussionArticulations` | `InstrumentArticulation[]` (`:12911`). Empty unless the file declares its own kit |
| `Staff.isPercussion` | a boolean, with alphaTab's own comment that it belongs on the track (`:12693`) |
| `Staff.standardNotationLineCount` | 5 by default (`:12698`); a one-line cowbell part or a three-line kit sets it |
| `InstrumentArticulation` | `id`, `elementType`, `staffLine`, `noteHeadDefault`, `noteHeadHalf`, `noteHeadWhole`, `techniqueSymbol`, `techniqueSymbolPlacement`, `outputMidiNumber`, and `uniqueId`, which is `` `${elementType}.${id}` `` (`:5065-5143`). `staffLine` counts steps - lines and spaces - downwards from the top line, so 1 is the top line and a negative number is above the staff |
| The default table | 95 articulations, generated from GP7 (`PercussionMapper.instrumentArticulations`, `:5153-5248`): kick is `Acoustic Kick Drum.35` on line 8, snare `Snare.38` on line 3, closed hi-hat `Charley.42` on line -1, ride bell `Ride.53` on line 0. A names table beside it (`:5250-5346`) maps `Snare (hit)` - and `snarehit`, which is the same name with the punctuation taken out - onto those unique ids, and is what alphaTex reads and writes |

What alphaTab then does for itself, so the mapper does not have to:

- `Staff.finish` clears the tuning, turns tablature off and zeroes the display transposition on
  a percussion staff (`:12708-12712`), and `Track.finish` sets `playbackInfo.program = 0`
  (`:12935-12937`).
- `Score.finish` puts a track whose single staff is percussion on MIDI channel 9, primary and
  secondary (`:4316-4321`).
- Playback takes the articulation's `outputMidiNumber` as the note's key
  (`MidiFileGenerator._generateNote`, `:48288-48292`).
- The renderer draws the articulation's notehead at its `staffLine`, with its technique symbol
  beside it (`:72027-72033`, `:72093-72105`), and warns to the console when no articulation is
  found (`:72032`).

So `toScore` writes three things and `score.finish(settings)` - which it already calls
(`services/score-doc-mapper.service.ts:218`) - does the rest.

**`PercussionMapper` is not reachable from application code.** It is in neither
`alphaTab.d.ts` nor the runtime namespace: `alphaTab.model.PercussionMapper` is `undefined`,
checked against the shipped bundle. `alphaTab.model.InstrumentArticulation` *is* exported
(`alphaTab.d.ts:9645`, `:11558`), with its static `create`. So the model has to carry the
articulation list itself; it cannot ask alphaTab to look one up or name one.

### What the model gains

Three additions, and nothing else in `models/composer.model.ts` moves.

```ts
export type NotePitch =
  | { kind: 'fretted'; string: number; fret: number }
  | { kind: 'pitched'; noteValue: number; octave: number; letter?: NoteLetter }
  | { kind: 'percussion'; articulation: number };   // Note.percussionArticulation, verbatim

/** One entry of a track's own kit, in alphaTab's own fields so the mapper copies rather than converts. */
export interface ArticulationDoc {
  id: number;
  elementType: string;
  staffLine: number;
  noteHeadDefault: number;        // MusicFontSymbol
  noteHeadHalf: number;
  noteHeadWhole: number;
  techniqueSymbol: number;        // MusicFontSymbol
  techniqueSymbolPlacement: number;
  outputMidiNumber: number;
}

// TrackDoc gains
percussionArticulations: ArticulationDoc[];   // [] on a pitched track

// StaffDoc gains
isPercussion: boolean;
lineCount: number;                            // Staff.standardNotationLineCount
```

Why a third kind of `NotePitch` rather than a flag on the staff: `pitched` promises a
`noteValue` and an `octave`, and a drum hit has neither. Today's mapper reads one anyway and
gets `noteValue: -1, octave: -2`, which is not a pitch that went wrong but a pitch that was
never there. A kind that says what the number is - and is the only kind that carries it - makes
the wrong read impossible rather than unlikely.

Why the list lives on `TrackDoc`: alphaTab keeps it there, and a note's number is an index into
it. Splitting them would mean renumbering, which is the one thing that must not happen.

Why `lineCount` is on `StaffDoc` and not in the percussion fields: it is a staff property in
alphaTab too, and a pitched staff can use it. It also closes a loss Part 2 never listed, because
nothing had noticed it.

**The third kind is the audit trail.** `NotePitch` is a discriminated union, read in ten modules
under `strict`, and almost every read is `kind === 'fretted' ? … : (so it is pitched)`. Adding a
third member turns each of those else-branches into a compile error at the first `.noteValue`,
so the build lists the work rather than a reviewer having to: `beat-clipboard.ts`,
`composer-entry-commands.ts`, `composer-fret-entry.ts`, `edit-refusals.ts`, `note-edits.ts`,
`note-landing.ts`, `note-moves.ts`, `note-respell.ts`, `pitch-on-strings.ts` and
`score-doc-mapper.service.ts`. The two new `StaffDoc` fields and the new `TrackDoc` field do the
same for the four places that build one by hand: `composer.service.ts:202-225` (the default
track and staff), `progression-score.ts:840-868` (the piano staff),
`score-derivation.ts:603-630` (transcription) and the mapper.

`soundingMidiOf` (`services/pitch-on-strings.ts:43`) returns `number | null`: a drum hit has no
sounding pitch. Its callers are all already on a pitched path - the fret digits pass a `fretted`
literal, `drawnPitchClassOf` and `trillTargetOf` are behind refusals a percussion staff fails,
and `frettedDocOf` reads only `kind === 'pitched'` - so the one that gains a branch is
`staffEntryOf` (`:90`), which refuses before it measures. Nothing auditions a drum note:
`AlphaTabService.auditionAfterRender(midiKey, program)` (`services/alpha-tab.service.ts:240`)
plays a pitch through a program and has no channel, and channel 9 is what a drum key means.

### Both directions of the mapper

`services/score-doc-mapper.service.ts`, and the two directions stay symmetrical.

| | `toDoc` | `toScore` |
|---|---|---|
| Note | `fromNote` (`:607`) tests `note.isPercussion` **before** `note.isStringed` and returns `{ kind: 'percussion', articulation: note.percussionArticulation }`. Nothing else about the note changes: the effects it already reads are the same fields | `toNote` (`:424`) gains the third branch: `note.percussionArticulation = doc.pitch.articulation`, and it writes no string, no fret, no tone and no octave, so `isPercussion` comes out true |
| Staff | `fromStaff` (`:543`) adds `isPercussion: staff.isPercussion` and `lineCount: staff.standardNotationLineCount`. `tuning` is already `[]` on a percussion staff, because `Staff.finish` cleared it | `toStaff` (`:298`) sets `staff.isPercussion` and `staff.standardNotationLineCount` **before** the bars, and the order matters: `score.finish` is what clears the tuning, turns tablature off and forces program 0 and channel 9, and it runs last |
| Track | `fromTrack` (`:521`) copies `track.percussionArticulations` field by field into `ArticulationDoc[]` | `toTrack` (`:279`) rebuilds each with `alphaTab.model.InstrumentArticulation.create(id, elementType, staffLine, outputMidiNumber, …)` and pushes them in order, so every note's index still points where it pointed |
| Accidental | `forcedLetterOf` is asked of a pitch class, and a drum hit has none, so `accidental` stays `'auto'` and `toNote` leaves `accidentalMode` at alphaTab's default. alphaTab agrees: `AccidentalHelper` takes the percussion branch and never computes one (`:24980-24996`) | |

A percussion staff's bar clef is `Clef.Neutral`, which the model already holds as `'n'` and the
bridge already maps both ways (`services/alpha-tab-enum.bridge.ts:27`, `:37`). Nothing there
changes.

### alphaTex carries percussion

The composer's library stores alphaTex (`ComposerLibraryService`, `tex: string`), written and
read by alphaTab's own exporter and importer through `AlphaTexService`
(`services/alpha-tex.service.ts:25`, `:31`). Both carry percussion, and this was run rather
than read:

- The exporter writes `instrument percussion` as a track property (`:15428`),
  `\articulation defaults` as the staff's meta (`:15216`), `\staff{score(<lines>)}` when the
  line count is not 5 (`:15376-15385`), and each note's value as the articulation's **name**, in
  quotes (`AlphaTexExporter._note`, `:76713-76726`).
- The importer's `instrument percussion` sets every staff of the track to percussion and puts it
  on channel 9 (`:13853-13858`); `\articulation defaults` fills the name table
  (`:13284-13292`); a quoted name resolves to a `uniqueId`, whose articulation is pushed onto
  `track.percussionArticulations` and indexed by the note (`:16480-16500`).

A kit written as alphaTex, exported and parsed back gives the same articulation indices, the
same staff flag and line count, the same neutral clef, channel 9 and program 0 - and a second
export is byte-identical to the first, which is the property `AlphaTexService`'s own comment
claims for the pitched case.

**What it does not carry is a kit the file invents.** The exporter writes `\articulation
defaults` and never the track's own list, and it names each note through the default table
(`PercussionMapper.getArticulationName`, `:5380-5400`). An articulation that table cannot name
is written `"unknown"` - and the reload does not merely lose that note. The importer raises
AT209, `AlphaTexImporter.readScore` throws, and `AlphaTexService.parse` returns `score: null`
(`services/alpha-tex.service.ts:41`), so the **whole composition** fails to open. Checked by
building a track with one invented articulation, exporting it and parsing it back.

How likely that is: a GP7 file's articulation `id` is its first `InputMidiNumbers` entry and its
`elementType` is the instrument element's name (`GpifParser._parseArticulation`, `:22169-22190`)
- which is where alphaTab's table came from - so a standard kit matches. A gp3-gp5 file has no
list at all: the importer moves the note's fret into `percussionArticulation` and clears string
and fret (`:20608-20612`), so every note resolves through the default table. The exposure is a
file with a hand-built or non-General-MIDI kit.

**The conversion proves the save rather than trusting a count.** Part 4's step 2 already builds
the composition's alphaTex and refuses the whole conversion if the write fails. It gains one
line: parse that same string back with `AlphaTexService.parse`, and refuse the same way if it
does not parse. The `.gp` has not been deleted at that point, so nothing is lost, and the status
line says the drum track uses articulations alphaTex cannot name. One extra parse of a string
the conversion had already made. The checker's save item (Part 2) is what the prompt says
beforehand; this is what the conversion does about it.

### Editing a percussion track

Small on purpose, and the line is drawn at what the model can already say.

| Works | Why |
|---|---|
| The caret, the selection, a drag, click-to-seek | `EditCursor` is an address, and a percussion staff draws one standard-notation band like any other staff |
| Playback | `Staff.isPercussion` puts the track on channel 9 and the articulation supplies the key |
| Duration, dots, tuplets, rest, clear to rest, insert and delete beat | none of them reads a note's pitch |
| Cut, copy and paste within a percussion staff | with the clipboard's staff check widened, below |
| Dynamics, accent, heavy accent, tenuto, staccato, ghost | alphaTab draws each of them on a percussion notehead (`:72070-72085`) and ghost quietens it (`:48572-48576`) |
| Fermata, and every bar and score command | they belong to the master bar |
| Tie | `Beat.chain` keys its lookup by `realValue` (`:8086`), which on a percussion note is the articulation (`:6067`), so a tie between two hits of the same drum resolves |
| Rename, colour, mute, solo, show/hide, remove | `TrackDoc` fields, untouched |

**Writing a new drum note is out of scope, and so is an articulation picker.** alphaTab does not
make either trivial: the palette would have to offer the 95-entry table to choose from, and the
table is internal, so the picker would mean a second copy of alphaTab's reference data living in
this app - which is a design of its own, and the sort of duplication `CLAUDE.md` warns about
under scale and chord data. What this milestone promises is what the milestone is about: a file
with drums opens, converts, plays right, lets its guitar part be edited, saves and reloads
unchanged, and its drum notes keep the articulation they arrived with.

### What a percussion staff refuses

One predicate, in the one place every press already asks. `editRefusal`
(`services/edit-refusals.ts:145-190`) is the gate: `toolStates` asks it for every row of
`COMPOSER_TOOLS`, and every specific refusal beside it - `fermataRefusal`, `tieRefusal`,
`tupletRefusal`, `beatEffectRefusal`, `noteEffectRefusal`, `durationRefusal`, `graceRefusal`,
`clearRefusal`, `deleteBeatsRefusal` - calls it first. It already reads the staff for exactly
this kind of question: `onPitchedStaff` is `tuning.length === 0`, and `FRETTED_ONLY_NOTE` and
`FRETTED_ONLY_BEAT` refuse there. Percussion joins as a third staff test:

```ts
const onPercussionStaff = refs.some(
  ref => doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.isPercussion === true
);
```

with one message: `PERCUSSION = 'A percussion staff has no strings and no pitch, so that belongs to a pitched staff.'`

| Refused | Tool ids, and where it is caught |
|---|---|
| Everything fretted-only | `bend`, `legatoSlide`, `shiftSlide`, `naturalHarmonic`, `artificialHarmonic`, `leftHandTap`, `tap`, `slap`, `pop` - already refused, because a percussion staff has no tuning and `FRETTED_ONLY_*` tests exactly that. They get the percussion message instead of the fretted one, because it is the truer reason |
| Pitch and spelling | `doubleFlat`, `flat`, `natural`, `sharp`, `doubleSharp`, `respell`, `semitoneDown`, `semitoneUp`. A drum hit has no pitch class to force a letter on or to shift, and alphaTab computes no accidental for one (`:24980-24996`) |
| Strings | `stringBelow`, `stringAbove`. `previousString` and `nextString` are navigation, not edits, and clamp to the staff's one slot as they do on any staff with no tuning |
| What alphaTab drops on a percussion staff at playback | `hammerOn` (`:48571`), `trill` (`:48336`) |
| Fret digits | `fret`. `FretDigitEntry.type` already returns on `staff.tuning.length === 0` (`services/composer-fret-entry.ts:36-38`) - silently. It gains the refusal so the status line says why, which is M2's rule that a press either acts or explains |
| A Pen click | `scorePressOf` writes on a `'notation'` staff (`services/composer-score-interaction.ts:59`). `StaffKind` gains a fourth member, `'percussion'`, so Pen's press moves the caret and writes nothing, and a drag from it extends the range as a tablature drag does (`dragExtends`, `:68`). The band count does not move: a percussion staff draws the same one standard-notation band, and `staffSlotsOf`'s tablature test is already `showTablature && tuning.length > 0`, so `slotIndexAt`'s ranks are unchanged. `staffSlotsOfScore` (Part 1) reads `Staff.isPercussion` for the same answer |
| Tuning and capo | `setStaffTuning` and `setStaffNumber('capo', …)` (`services/composer.service.ts:580-586`). Neither has a caller in any template today - swept - so this is a guard on the service and on the document an alphaTex apply can put in, not a button to grey out. `maxFretOf` and `fretRangeOf` are never asked of a percussion staff, because nothing writes a fret there |
| Paste across staff kinds | `CopiedBeats.fretted`, a boolean (`services/beat-clipboard.ts:17-18`, `:31`, `:87-91`), becomes a staff kind of three - fretted, pitched, percussion - and `pasteRefusal` names the mismatch. Today a drum bar and a piano bar are both "not fretted", so a kit pastes onto a piano staff and the notes go in |

Left alone, because nothing in them reads a string or a pitch and alphaTab draws them from flags:
`palmMute`, `letRing`, `vibrato`, `wideVibrato`, `pickDown`, `pickUp`, `fadeIn`, `graceBefore`,
`graceOnBeat`, `dead`, `crescendo` and `decrescendo`.

`changesDocument` (Part 4) is unaffected: it answers whether a tool *would* change the document,
not whether it may, and a refused press changes nothing either way.

---

## Part 4: The prompt, and converting

### What asks

A second pure module, `services/composer-edit-intent.ts`:

```ts
changesDocument(toolId: string): boolean
```

It answers for every `id` in `COMPOSER_TOOLS` (`services/composer-tools.ts:194`), the one table
M2 put behind every button, tooltip, shortcut and the modal sheet, so a tool added later cannot
arrive without an answer - its spec asserts one for every row. Paste and Save are in that table
already (`:210`, `:212`). The two commands outside it are a fret digit and an alphaTex apply,
and they are named beside it.

| Asks | Does not ask |
|---|---|
| every palette tool whose command writes | Select / Pen, and the note-value buttons, which only set the input duration |
| every editing key: fret digits, `R`, Delete, Backspace, Insert | every navigation move and its Shift form, Home, End |
| paste, and cut | copy, and select all |
| an alphaTex apply | opening the alphaTex panel, and typing in it |
| Save | play, pause, stop, seek, loop, tempo percent, volume |
| | show/hide, mute, solo, the scale panel, the shortcut sheet, a popover opening |

Save asks because the composition library holds compositions: saving a file that has not been
converted has nothing to write.

### What the prompt says

A modal, built as M2 built the shortcut sheet (decision 31): a backdrop, the page behind
`inert`, the focus moved in, Tab held inside, Escape closing it as Cancel. It says, in this
order:

1. **What the edit was** - "Adding a hammer-on will convert this file." The command is named, so
   the question is about something the user just did.
2. **That it cannot be undone.** "Converting cannot be undone. The original file is replaced by
   a composition, and undo starts from there."
3. **What this file would change**, from `conversionLossOf`: one line per item, with its count
   and the first bar - "Chord diagrams: 3, first in bar 5". Then, under its own heading, what
   the first save would change. A file with neither reads "Nothing in this file would change."
4. **Three buttons**: *Save the original file first*, *Convert*, *Cancel*. Save the original is
   not a fourth outcome - it downloads and leaves the prompt open, so the user converts
   afterwards without asking twice.

Save the original writes `GpOriginal.bytes` as the entry's `fileName` through an anchor and an
object URL, the way `ComposerExportService` already hands over a `.gp` export. It is the only
copy of the bytes there will be, and the prompt says that too.

### Converting

In order, and the order is the error handling:

1. `doc = frettedDocOf(mapper.toDoc(score)).doc` - both pure, and neither can fail on a score
   alphaTab parsed. The fretting runs here rather than inside `replaceDocument` so the document
   is final before anything is written, and so the count it drops is a line of the prompt rather
   than a notice after the fact. `replaceDocument` runs it again at step 4 and, on an
   already-fretted document, drops nothing - so its `markClean` survives.
2. Write the composition: `ComposerLibraryService.save({ title, artist, tex, tempo, trackCount, barCount })`,
   the alphaTex from the same exporter every save uses - but parse that alphaTex back first
   (`AlphaTexService.parse`), and treat a parse that returns no score exactly as a failed write.
   The one thing known to fail that parse is a drum kit the file invents, which alphaTex writes
   as `"unknown"` (Part 3); the check is general, and costs one parse of a string already built.
   **A failure here refuses the conversion**: the page stays in Original, the edit that asked is
   not applied, and the status line says why - naming the track when the diagnostic does.
   Nothing has been lost.
3. Delete the `.gp` entry: `GpLibraryService.deleteEntry(entryId)`. **This is the one
   irreversible step.** A failure here leaves both rows, and the status line says the original
   is still in the library - which is a better outcome than the reverse order, where a failed
   write after a successful delete would lose the file.
4. `ComposerService.replaceDocument(doc, { newComposition: true, markClean: true })`. New
   composition, so `documentId` moves on and the history starts empty (M2 decision 20); clean,
   because the library now holds exactly this. The library panel adopts the new entry, so the
   next Save writes over it rather than making a second.
5. `ComposerGpService` clears its subject and drops the bytes.
6. Apply the edit that asked, as its own commit - so undo takes back the edit and stops at the
   converted score, which is decision 6.

Cancel runs none of it. The edit is not applied, the caret and the selection are where they
were, and the status line says nothing: the prompt was the message.

---

## Part 5: The page

### The track strip

M2's strip is a row per track with its name, remove, and the progression badge, status, Update
and Flatten (`components/composer/components/composer-track-strip/composer-track-strip.component.ts`,
470 lines, `.html` 100). Each row gains three controls, and a third pure module,
`services/composer-track-rows.ts`, gives both states the same rows:

```ts
trackRowsOf(source: ScoreDoc | alphaTab.model.Score): TrackRow[]
renderedTracksOf(rows: TrackRow[]): number[]
```

| Control | Original | Composition |
|---|---|---|
| Show / hide | `api.renderTracks` over the shown tracks; `staffSlotsOfScore` follows, so the caret and the hit test agree with what is drawn | the indices `renderScore` already takes (`composer-score.component.ts:258-261`) |
| Mute | `AlphaTabService.setTrackMute` - the player's, not the file's | the same call, over `PlaybackInfoDoc.isMute` (`models/composer.model.ts:137`), which the mapper round-trips |
| Solo | `setTrackSolo`, likewise | `PlaybackInfoDoc.isSolo` (`:138`) |

Remove, the badge, Update and Flatten are hidden in Original: there is no document to remove a
track from, and a `.gp` file has no progression track. Every selector and label the M4 specs
pin stays where it is.

Hiding the last shown track is refused, with the reason in the row's name and tooltip and in
the status line, the way Remove on the last track refuses rather than disabling (M2 decision 3).

M3's mixer - volume, pan and the bar grid - builds on these rows. `PlaybackInfoDoc` already
carries `volume` and `balance` (`:134-136`), and nothing yet writes them.

### The scale panel

Decision 9 says the highlighting moves. It has to be built, because **it does not work today**.
`applyHighlighting` (`components/gp-viewer/gp-viewer.component.ts:367-397`) clears and sets a class by querying
`.at-note` elements and reading a `data-note` attribute. alphaTab 1.8 renders neither: a sweep
of `node_modules/@coderline/alphatab/dist/alphaTab.core.mjs` finds no `at-note` and no
`data-note`, and the only classes it writes are `at-cursor-bar`, `at-cursor-beat`, `at-cursors`,
`at-highlight`, `at-selection` and `at-surface`. So the selector matches nothing, the
`::ng-deep` rules at `gp-viewer.component.scss:363-376` are dead, and nothing calls
`applyHighlighting` after a render in any case - only `onHighlightChange` does (`:361`).

What replaces it is the mechanism the composer already owns. `ComposerScoreComponent` draws the
caret and the selection highlight as its own overlay from `AlphaTabService.getBoundsLookup()`,
after every render. Note bounds are in the same lookup - `BeatBounds.notes: NoteBounds[] | null`
- but only when `core.includeNoteBounds` is on, and it is off for the composer on purpose: it
costs a rectangle per note and the beat is the unit of selection
(`models/alpha-tab.model.ts:98-111`). So:

- `AlphaTabService` gains `setNoteBounds(on: boolean)`, which sets
  `api.settings.core.includeNoteBounds`, calls `api.updateSettings()` and re-renders.
- The panel's first open turns it on, for the life of the page. A page that never opens the
  panel pays nothing.
- A note's pitch class is `note.realValue % 12`, matched against
  `(rootNote + interval) % 12` as today.
- The overlay redraws with the caret's, so a re-render no longer wipes it.

The panel keeps the highlighter's own root and scale selectors, reading the catalogue from
`MusicTheoryService.getUnifiedCategories()` (`services/music-theory.service.ts:607`), and emits
the `HighlightConfig` it emits now (`models/alpha-tab.model.ts:215-226`). It opens from the top
bar, as the alphaTex panel does, and works in both states: the lookup is over whatever alphaTab
drew.

### The transport

Four controls join play, stop and BPM in the top bar, all of them the viewer's, and every call
already on `services/alpha-tab.service.ts`:

| Control | Call | State it reads |
|---|---|---|
| Loop | `setLooping` (`:346`) | `AlphaTabState.isLooping` |
| Tempo percent, 25-200 | `setPlaybackSpeed(value / 100)` (`:326`) | `tempoMultiplier` |
| Volume | `setVolume(value / 100)` (`:336`) | `volume` |
| Seek bar with `m:ss / m:ss` | `seekToTime` (`:317`) | `timePosition`, `totalDuration` |

Tempo percent is a playback multiplier and the BPM field is the score's own tempo. They sit
apart and are labelled apart, because the viewer labelled its multiplier "Tempo" and it is not
one.

The seek bar is an `<input type="range">`, not the viewer's `div` with a click handler
(`gp-viewer.component.html:111`), which no keyboard could reach and no screen reader could
name. Its keys are the browser's: M2 decision 29's `pressesFocusedControl` already leaves a
focused control the keys the browser presses it with, and `docs/TODO.md` already records that
`isEditableTarget` does not count a range slider as typing - which M3's mixer meets too. This
milestone extends that check rather than leaving M3 to find it.

---

## Part 6: Error handling

| What goes wrong | What happens |
|---|---|
| alphaTab cannot parse the file | Original never starts. alphaTab's `error` event sets `loadingState: 'error'` (`services/alpha-tab.service.ts:162-170`); the page stays in Composition on whatever was open, and the status line says the file could not be read and names it. A drop or an import writes no `gp-library` entry, so nothing half-imported is left |
| `?gp=<id>` names an entry that is not there | The composer opens in Composition on an empty score, and the status line says the file is no longer in the library. The query is cleared from the URL so a reload does not repeat it |
| The composition write fails while converting | The conversion is refused whole: still Original, the edit not applied, the `.gp` untouched, the reason in the status line |
| The `.gp` delete fails after the composition is written | The composition is open and correct, and the status line says the original file is still in the library. Both rows are listed until the user deletes one |
| A file of the wrong type is dropped | The status line says so and nothing changes. Today both surfaces ignore it silently - `isValidGpFile` (`components/gp-viewer/gp-viewer.component.ts:256-260`) and `addFiles` (`components/gp-library/gp-library.component.ts:144-151`) |
| Several files are dropped on the composer | The first `.gp` opens, and the status line says how many were ignored. The gallery keeps taking all of them |
| A drop arrives while the open composition has unsaved work | `ComposerService.confirmDiscard` first, as every path that starts a new composition already does (M2 decision 20) |
| An edit is attempted with a prompt already open | It cannot be: the prompt is modal and the page behind it is `inert`, as the shortcut sheet is |
| The score is too wide, or the container has no width yet | The composer's own guards, which the viewer never had: `renderPending` and the `ResizeObserver` in `components/composer/components/composer-score/composer-score.component.ts:246-249` and `:275-293` |

Everything the page says goes through the one polite live region in the status line
(`ComposerService.announce`, M2 decision 20), except the conversion prompt, which is a modal
question with its remedy inside.

---

## Part 7: Testing

The whole GP feature has no specs today. A repo-wide sweep of `*.spec.ts` for
`GpLibraryService`, `GpViewerComponent`, `GpLibraryComponent`, `GpFileCardComponent`,
`GpLibraryFiltersComponent` and `GpScaleHighlighterComponent` finds no match at all, and
`services/alpha-tab.service.spec.ts` is twenty lines holding one `it`, which asserts that six
methods do not throw before an api exists. This milestone brings specs for what it touches.

- **`GpLibraryService`**: add, open, replace and delete, against real IndexedDB under Karma.
  The database name becomes an injection token so each spec opens and deletes its own, which is
  the one refactor the specs need. Covers the metadata fill on open, the `add`-not-`put`
  behaviour at `:113`, and the two methods that silently resolve when `this.db` is null
  (`:137`, `:174`).
- **The gallery**: filters, sort direction, the grid and list toggle, drop of a valid and an
  invalid file, and Open's target - `/composer?gp=<id>` and not `/gp-viewer`.
- **The loss checker**: one spec per item of Part 2's tables, each building a `Score` with that
  feature and asserting the item, its count and its first bar; one clean score asserting `[]`;
  and one file holding several, asserting the order.
- **The ask-first predicate**: every row of `COMPOSER_TOOLS` has an answer, every writing
  command asks, and every navigation, playback and display command does not. The tool table's own
  spec already checks each tool for a command, a glyph, a label, a group and a unique binding
  (`services/composer-tools.spec.ts`); this is one more column it cannot drift from.
- **The composer page in both states**: the status line's text, Undo and the BPM field
  disabled, the palette live, a palette press opening the prompt, Cancel changing nothing, and
  Convert leaving one composition, no `.gp` entry, an empty history and the edit applied.
- **`staffSlotsOfScore`** against `staffSlotsOf` on a document and a score that mean the same
  thing, over a hidden track, and over a percussion staff, whose slot is `'percussion'` and not
  `'notation'`.
- **`trackRowsOf`** from both sources, and `renderedTracksOf` refusing to hide the last row.
- **Percussion, through the mapper** (`score-doc-mapper.percussion.spec.ts`, beside the mapper's
  existing specs): a `Score` → `ScoreDoc` → `Score` round trip of a drum track asserting the
  articulation number on each note, the track's articulation list field by field, the staff's
  `isPercussion` and line count, the neutral clef, program 0 and channel 9 after `score.finish`,
  and that no note comes back `isStringed` or `isPiano`. One case with a **non-empty** track list
  where the notes are indices into it, and one with an **empty** list where the notes are ids
  into alphaTab's own table - the gp3-gp5 shape - because they take different branches of
  `PercussionMapper.getArticulation` and the mapper must not care which.
- **Percussion, through alphaTex** (`composer-export.service.percussion.spec.ts` or beside
  `alpha-tex.service`): export a converted drum score, parse it back, and assert the same
  articulations, staff flag, line count and channel; assert a second export is byte-identical to
  the first; and assert that an **invented** articulation exports `"unknown"` and that parsing it
  back returns `score: null` with an AT209 diagnostic - which is the behaviour the conversion's
  parse-back step exists to catch, so the spec is what stops it being designed away.
- **The refusals on a percussion staff**: `editRefusal` returns the percussion message for every
  fretted-only, pitch, spelling, string, hammer-on and trill tool, and `null` for duration, dots,
  tuplet, rest, dynamics, accents, staccato, ghost, tie and fermata. Asserted over
  `COMPOSER_TOOLS` through `toolStates`, so a tool added later cannot arrive without an answer -
  the same shape the ask-first predicate's spec takes. Plus: a fret digit on a percussion staff
  writes nothing and says why, a Pen press on one moves the caret and writes nothing, and
  `pasteRefusal` refuses a drum copy onto a pitched staff and a pitched copy onto a drum staff.

**Where geometry or render selection matters, Karma renders a real alphaTab score**, as
`services/composer-score-systems.spec.ts` already does - it builds a `Settings`, maps a
document with `ScoreDocMapperService.toScore`, and calls
`renderer.renderScore(score, score.tracks.map((_, i) => i))` at `:249-275` to get genuine
bounds. The two that need it here are the note-bounds overlay behind the scale panel, which
has to be checked against real `BeatBounds.notes`, and show/hide, which has to be checked
against what `renderTracks` actually draws.

**There is no `.gp` fixture anywhere in the repo**, and this milestone does not add one: a sweep
for `*.gp`, `*.gp3`, `*.gp4`, `*.gp5`, `*.gpx` and `*.gp7` outside `node_modules` finds nothing,
and `client/src/assets` does not exist. So every spec builds its score in memory, which is what
the mapper's specs already do. A percussion score is built the two ways the importers build one,
and the cheapest way to build the first is alphaTex, since the importer is in the bundle and the
composer already wraps it:

```ts
const { score } = texService.parse([
  '\\track "Drums" {instrument percussion}',
  '\\articulation defaults',
  '("Kick (hit)" "Hi-Hat (closed)").4 "Snare (hit)".4 |'
].join('\n'));
```

That gives a track with its own articulation list and notes indexing into it. The other shape -
an empty list and notes carrying ids, which is what a gp3-gp5 file produces - is built straight
from `alphaTab.model`: a `Staff` with `isPercussion = true`, a `Note` with
`percussionArticulation = 38`, and `score.finish(settings)`. Neither needs a file, and both
exercise the branch the other does not.

Not tested, per `CLAUDE.md`: visual styling and DOM layout.

**Hand checks**, which the suite cannot settle: a real multi-track `.gp` file opening with every
staff drawn; the prompt's counts against what Guitar Pro shows for the same file; the saved
original opening in Guitar Pro, and matching the file that went in byte for byte; and a real
drum track from a `.gp` file - drawn on the right staff lines with the right noteheads,
sounding the right kit, and still doing both after a save and a reload.

---

## Part 8: Build order

Each step leaves the app working, and the viewer is deleted last so there is always a way to
open a file.

1. **Load bytes and render every track.** `loadBytes` replaces `loadFile`; the hard-coded `[0]`
   goes. The viewer gets it too, for this one step.
2. **The two states and the status line.** `ComposerGpService`, the render branch,
   `staffSlotsOfScore`, and what Part 1's last table disables.
3. **Percussion in the model** (Part 3), in two commits that each leave the app working. First
   the model and the mapper: the third `NotePitch` kind, `ArticulationDoc`,
   `TrackDoc.percussionArticulations`, `StaffDoc.isPercussion` and `lineCount`, the four
   hand-built literals, the compile errors the new kind raises in ten modules, and both mapper
   directions with their specs. Then the editing edges: `editRefusal`'s percussion test, the
   `'percussion'` staff kind, the fret-digit and paste refusals, and their specs. It comes before
   the checker because the checker's tables are written against the final model, and long before
   Convert, which is the first step that produces a document from a file.
4. **The loss checker**, with its specs, reporting into nothing yet.
5. **The prompt and Save the original first**, with `changesDocument` behind it. Convert is not
   wired: the prompt's Convert is disabled and says so.
6. **Convert and replace**, in Part 4's order, including the parse-back that proves the save.
7. **The entry points**: `?gp=<id>`, Import .gp…, the drop, the Library menu's `.gp` rows, and
   the gallery's Open.
8. **The strip's show/hide, mute and solo**, and `composer-track-rows.ts`.
9. **Scale highlighting**, the panel and the note-bounds overlay.
10. **The transport**: loop, tempo percent, volume, the seek bar.
11. **Delete the viewer**: the route (`main.ts:21-25`), the nav link
    (`app.component.html:10`), `components/gp-viewer/` and its scale highlighter.

---

## Out of scope

- **Growing the model past percussion.** Percussion is in, because a drum track converted wrong
  rather than short and the fix is three fields (decision 12, Part 3). What is left in Part 2's
  tables is a list of features, and each is its own design. The milestone's job is to say what
  goes, not to stop it going.
- **Writing a new drum note, and an articulation picker.** Part 3's last two sections. A
  converted kit keeps and plays what it arrived with; choosing a new one needs alphaTab's
  internal articulation table copied into this app, which is a design of its own.
- **Writing `.gp` back.** Export already writes one (`services/composer-export.service.ts`);
  round-tripping a file into the model and out again is a different promise.
- **M3's inspector, mixer and bar grid.** The strip's rows are built so the mixer lands on them.
- **A `.gp` file and a composition in one library.** The Library menu lists both, from two
  databases. Merging them is not worth doing before anything needs it.

---

## Risks

| Risk | What holds it |
|---|---|
| **The replace-and-drop-bytes step is the one irreversible action in the milestone.** A user converts, dislikes it, and the file is gone | Write the composition before deleting the `.gp`, so a failure leaves both. Save the original first, offered in the prompt itself. The prompt says it cannot be undone, in its own paragraph |
| Percussion is the one thing this milestone *adds* to the model, and a third kind of `NotePitch` reaches ten modules | The kind is a discriminated union under `strict`, so the compiler lists the work rather than a reviewer (Part 3). Every one of those modules already branches on `kind === 'fretted'`; what changes is that the else-branch has to say which of the other two it means |
| A converted drum track saves as alphaTex the composer cannot read back, and the whole composition is lost with it | Only for a kit the file invents, and the conversion proves the save before it deletes anything: it parses the alphaTex it just built and refuses the conversion whole if it does not parse (Part 3, Part 4 step 2). The prompt says it beforehand as a save item, and a spec pins the failure so it cannot be designed away |
| The prompt is long enough to be dismissed unread | It shows only what *this* file has, with counts and bars. Most files will show two or three lines |
| A file large enough that the checker's walk is felt | It runs once, on load, off the rendering path, and its result is kept on `ComposerGpService`. alphaTab has already walked the same score to lay it out |
| `includeNoteBounds` costs a rectangle per note | Off until the scale panel is first opened, and only then for the life of the page |
| One root `AlphaTabService` api, disposed by whoever initialises next | Unchanged, and one page fewer is one consumer fewer. The progression preview's unconditional dispose is still the open item the progression design records |
| The caret in Original addresses a score no document backs | `EditCursor` is an address, and everything that resolves one already reads the rendered score. Only `staffSlotsOf` reads the document, and it reads five fields every alphaTab `Staff` has |

---

## The decisions, in one table

| # | Decided | What it rules out |
|---|---|---|
| 1 | `/gp-viewer` and its component go; `/gp-library` stays as the gallery, and its Open goes to `/composer?gp=<id>` | Keeping a read-only viewer beside an editor that can do everything it does |
| 2 | The Library menu lists imported `.gp` files beside compositions and gains Import .gp…; the page takes a `.gp` dropped on it | Making the gallery the only way in |
| 3 | Two states. Original is alphaTab's reading of the bytes, every track, no `ScoreDoc`; Composition is today's composer. A `.gp` opens in Original, everything else in Composition | Converting on open, which would lose what the file holds before the user had seen it |
| 4 | The first command that would change the document asks. Caret, selection, playback and display do not | A modal on arrival, and a silent conversion on the first key press |
| 5 | The prompt names what this file would change, with counts and the first bar, offers to save the original, then Convert or Cancel | A generic warning that says the same thing about every file |
| 6 | Conversion is not undoable, the prompt says so, and history starts empty at the converted score | An undo stack that straddles the conversion and could put back a state the library no longer holds |
| 7 | The loss checker is pure over the alphaTab `Score`, reports nothing for a file that converts whole, and each item has a spec | A list maintained by hand beside a mapper that moves |
| 8 | Every track is listed in both states; each row gains show/hide, mute and solo | A sidebar that names tracks it does not draw, which is what the viewer does today |
| 9 | Scale highlighting becomes a composer panel, in both states, reading `MusicTheoryService` | Leaving it on a page that is being deleted - and leaving it broken |
| 10 | The transport gains loop, tempo percent 25-200, volume and a seek bar with a readout | Losing the viewer's transport with the viewer |
| 11 | Build order: bytes and every track; the states; percussion in the model; the checker; the prompt; convert; the entry points; the strip; highlighting; the transport; delete the viewer | Deleting the viewer before the composer can open a file |
| 12 | Percussion joins the model: a third `NotePitch` kind carrying `Note.percussionArticulation`, the articulation list on `TrackDoc`, `isPercussion` and the line count on `StaffDoc`. A percussion staff refuses frets, strings, pitch, spelling, hammer-ons, trills, Pen, tuning and capo, and a cross-kind paste. Writing a new drum note and an articulation picker stay out | Three worse answers: leaving a drum track to convert into pitched notes on a five-line staff; refusing to convert a file that has drums, which would leave its guitar part unreachable; and copying alphaTab's 95-entry articulation table into this app so the palette could write a kit |
| 13 | Out of scope: growing the model past percussion, writing `.gp` back, M3's inspector, mixer and bar grid | A milestone that never ends |
| 14 | *Settled here:* a file that converts whole still prompts, reading "Nothing in this file would change" | Converting without asking, when the step cannot be undone whatever the checker found |
| 15 | *Settled here:* show/hide is a page setting, never an edit, in both states | A `TrackDoc` field, and a document change for something that is only a view |
| 16 | *Settled here:* mute and solo in Original are the player's; Convert takes the file's own mixer and re-applies the strip's mutes on top | Pretending a player mute was an edit of a file that has not been converted |
| 17 | *Settled here:* every route into Original writes or updates a `gp-library` entry before the state starts | A converted file with no entry to replace, and a failed parse leaving a half-imported row |

---

## Found while designing

- **The scale highlighter has never highlighted anything.** `applyHighlighting`
  (`components/gp-viewer/gp-viewer.component.ts:367-397`) queries `.at-note` and reads
  `data-note`; alphaTab 1.8 renders neither, and its only classes are `at-cursor-bar`,
  `at-cursor-beat`, `at-cursors`, `at-highlight`, `at-selection` and `at-surface`. The
  `::ng-deep` rules at `gp-viewer.component.scss:363-376` are dead with it, and nothing calls
  the method after a render in any case. It is also direct DOM manipulation, which `CLAUDE.md`
  names in its table of common mistakes. Decision 9 therefore builds rather than moves, through
  the bounds lookup (Part 5).
- **The library's key, scale and chord filters can never match.** `GpLibraryFiltersComponent`
  offers all three, and nothing in the app ever writes `key`, `detectedScales` or
  `detectedChords`: the gallery passes `{}` (`components/gp-library/gp-library.component.ts:152`)
  and the viewer's save omits them (`components/gp-viewer/gp-viewer.component.ts:200-206`). The
  milestone fills tempo and track count on open because it parses the file anyway; it does not
  detect a key, so these three filters stay decorative. Either something should detect them or
  they should go.
- **There is no bulk delete.** `clearLibrary()` (`components/gp-library/gp-library.component.ts:163`)
  has no call site in its template, and it deletes the whole library rather than a selection.
  Decision 1 lists bulk delete among what the gallery keeps; what it keeps is a per-card delete.
  A real one needs multi-select, which the gallery has no notion of.
- **A file card is a `div` with a click handler.** `gp-file-card.component.html:5` - no `role`,
  no `tabindex` - so Open is mouse-only. The row should be a button, as each saved row in the
  composer's drawer already is (M2 decision 20).
- **`scrollMode` is accepted and ignored.** It is on the settings interface
  (`models/alpha-tab.model.ts:149`) and the viewer passes `'continuous'`
  (`components/gp-viewer/gp-viewer.component.ts:143`), and `initializeApi` never reads it
  (`services/alpha-tab.service.ts:57-93`). So do `notation.rhythmMode`,
  `notation.fingeringMode` and `display.barsPerRow`. A setting a caller can pass and the service
  drops is worse than one it does not offer.
- **The service's own asset defaults are wrong for this app.** `initializeApi` falls back to
  `/assets/font/` (`:60`) and `/assets/soundfont/sonivox.sf2` (`:80`), and `angular.json:28`
  and `:33` publish them at `/font` and `/soundfont`. Every real caller overrides both, so nothing is
  broken; a caller that forgot would lose its music font silently.
- **The viewer imports Tone for two empty methods.** `import * as Tone from 'tone'`
  (`components/gp-viewer/gp-viewer.component.ts:19`) feeds `suspendToneJs` and `resumeToneJs`,
  whose bodies are comments (`:109-119`). Deleting the viewer takes it, and a chunk with it.
- **`GpLibraryService` keeps every file's bytes in a `BehaviorSubject`.** `loadAllEntries`
  (`:65-81`) pushes whole records, `ArrayBuffer`s included, so a library of fifty files sits in
  memory to render a grid of titles. `ComposerLibraryService.refresh` strips its payload
  (`:82-85`). The fix is a summary projection and `getFileData` - which exists at `:218` and has
  no caller - for the bytes.
- **`GpLibraryService` can open its database twice.** `initDatabase()` runs from the constructor
  and its promise is not kept (`:17`), so `addFile` (`:87-89`) and `getEntry` (`:196-198`) call
  it again when `this.db` is still null, while `updateEntry` (`:137`), `deleteEntry` (`:174`)
  and `clearLibrary` (`:316`) silently resolve instead. `ComposerLibraryService.ensureDb`
  (`:48-72`) memoises one promise and is the model to copy. The spec work in Part 7 will meet
  this.
- **Its four indexes are never used.** `title`, `artist`, `dateAdded` and `key`
  (`services/gp-library.service.ts:53-56`); every read is `getAll()` or `get(id)` and the
  filtering and sorting run in JS over the whole set (`:226-293`). Harmless at this size.
- **Re-saving a file always makes a second row.** `addFile` uses `store.add` (`:113`), and
  `isInLibrary` is in-memory only, so a file dropped into the viewer that the library already
  holds still offers "Save to Library". The milestone's own routes write through one path, so
  it does not meet this; the gallery still can.
- **A drum note read back as a pitch was never a wrong pitch - it was no pitch at all.** The
  first reading of this was that `fromNote` read a percussion note's tone and octave as a pitch.
  It is worse and simpler than that: alphaTab leaves `tone` and `octave` at -1 on a percussion
  note, so `fromNote` produced `{ kind: 'pitched', noteValue: -1, octave: -2 }` for every drum
  hit in the file, and `toStaff` never set `isPercussion`. Whatever the staff then drew, it was
  not a reading of the file. Decision 12 fixes it rather than reporting it; Part 3 is the design.
- **alphaTab's percussion table is real, generated from GP7, and completely out of reach.**
  `PercussionMapper` holds 95 articulations, their staff lines, their noteheads and their MIDI
  numbers, and the names alphaTex reads and writes. It is in neither `alphaTab.d.ts` nor the
  runtime namespace - `alphaTab.model.PercussionMapper` is `undefined` - so nothing outside
  alphaTab can look one up, name one, or offer a list of them. `InstrumentArticulation` itself
  *is* exported, so a kit can be carried and rebuilt; it just cannot be browsed. That single
  fact is what puts an articulation picker out of scope and what makes the model carry the
  track's list verbatim instead of an id it could resolve later.
- **alphaTex carries percussion, and a file's own kit is the hole in it.** The exporter writes
  `instrument percussion`, `\articulation defaults` and each note's articulation by name; the
  importer reads all three back, indices and channel included, and a second export is
  byte-identical. But the exporter never writes the track's own articulation list, so an
  articulation the default table cannot name is written `"unknown"` - and reading that back does
  not lose one note, it throws, and `AlphaTexService.parse` returns no score at all. A
  composition saved that way cannot be opened again. Part 3 has the mechanism and the answer; it
  is the one place in this milestone where a save could be silently unrecoverable, and it is now
  the reason the conversion parses its own output before it deletes anything.
- **The M2 design's GP paragraph names multiple voices as a loss and they are not.** Corrected
  under "What the composer's model cannot hold". The real limit is the save, not the
  conversion, and it is already recorded in `docs/TODO.md`.
- **The composer never used the router.** `ComposerComponent` injects neither `Router` nor
  `ActivatedRoute`; the transcription hands its document over through `ComposerService` and
  then navigates (`components/transcription/transcription.component.ts:327-333`). `?gp=<id>` is
  the first query parameter the page reads, and the milestone should clear it after opening so
  a reload does not re-open a file the user has since converted.
- **`/composer` already carries the circle-of-fifths drawer** - `CIRCLE_ROUTES` is
  `['/fretboard', '/composer', '/progression']` (`app.component.ts:47`) and the GP routes were
  deliberately left out. So the scale panel and the app-wide key will sit on the same page for
  the first time. Coupling them - the panel following the circle - is not in this milestone,
  and is the obvious next question to ask about it.
