# Songwriting: design

**Status:** S1 implemented, to [2026-10-01-songwriting-s1.md](2026-10-01-songwriting-s1.md), and on `main` since
2026-10-21; S2-S5 designed, not planned. Agreed with the user on 2026-10-01 in a brainstorming session, section by
section. What building S1 corrected, and its hand check, are at the end of this document.

A songwriting tool inside the app, after [songcraft.io](https://songcraft.io/): a lyric sheet split into sections,
chord names over the words, tab blocks between them, a key / BPM / Transpose bar, and a side panel of the key's
chords. Built on what the app already has: chords as scale degrees (the progression page), the chord palette's
vocabulary, the composer's tab engine and player, and IndexedDB libraries.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Scope of the first version | Everything songcraft's core has: sheet, sound, tab, writing helpers, voice memos, print and export. Not collaboration (decision 6). |
| 2 | How a song's chords relate to the progression page | Each section's chords are a progression in the existing model: scale degrees, so Transpose changes the key and every chord re-spells. |
| 3 | What decides how long a chord plays | The word places it, its length is its own. Order comes from where the chords sit in the lyrics; each chord has a length (default one bar). Moving a chord to another word moves where it shows, not how long it plays. |
| 4 | Where rhymes and syllables come from | Both: the CMU Pronouncing Dictionary bundled for syllables and rhymes offline, and a "More ideas" button that asks Datamuse, only when pressed. |
| 5 | How a tab block is edited | Inline, with the composer's engine. |
| 6 | Beyond the browser | Local library and export now. Real-time collaboration later - so this version must not close that door (Part 8). |
| 7 | What the sheet is built on | ProseMirror. The only one of the three options whose model `y-prosemirror` syncs as it stands, so the collaboration goal reuses this work instead of replacing it. Rejected: a hand-built Angular editor (we would write cursor, split, merge, undo, paste and anchor-tracking ourselves, then again for collaboration); ChordPro text as the source (awkward to write in, a loose link to degrees, and no place for a live tab block). |
| 8 | A second chorus | Its own copy of the chords. No links between sections in this version. |
| 9 | Saving | Autosave, always shown: "Saved · just now", "Saving…", or "Not saved: <reason>". |

## Part 1: The data model

A song is one ProseMirror document. Everything that defines it lives inside, so one undo history covers it and - later -
syncing the document syncs the song.

```
SongDoc  { id, revision, createdAt, updatedAt, content: <ProseMirror JSON> }

doc       attrs: title, artist, key (ProgressionKey), tempo, timeSignature
 └ section+        attrs: id, label ("Verse 1"), kind (intro|verse|pre|chorus|bridge|outro|other)
    └ (lyricLine | tabBlock | memo)*
       lyricLine   inline content: text | chord
       chord       inline atom, attrs: a ChordSlot (id, harmony: degree, lengthBeats, notes, owned)
       tabBlock    block atom,  attrs: id, name, a ScoreDoc (one track, the composer's model)
       memo        block atom,  attrs: id, name, durationSec - the audio is kept outside the document
```

- **The chord atom is the chord.** It carries a whole `ChordSlot` from `models/progression.model.ts` - its degree,
  length, voicing notes and ownership. A section's progression is *derived*: its chord atoms in document order, start
  beats summed as it goes. There is no second store to keep in step, so moving a chord to another word reorders the
  progression by construction.
- **Open in Progression** sends a section's derived progression to the progression page, and writes the edits back
  into the atoms by slot id, as one undo step.
- **Key, tempo and time signature are the song's**, on the `doc` node, so they are in the history too. Every section
  shares them. `ProgressionKey` is reused as is, `preferSharps` included.
- **Tab blocks hold a `ScoreDoc`** with one track, kept to the song's tempo and time signature.
- **Memos hold only a reference.** The audio is in its own store (Part 6), so binary data stays out of undo history and
  out of a future sync.
- **Stable ids for everything** - sections, chords, tab blocks, memos. Never an index or a position stored outside the
  document.

## Part 2: The sheet and the chord panel

```
┌ ← Library   "Last Dance" ▾        Saved · just now              Export ▾  ⚙ ┐
│ ▶ ■  ⟲  BPM [100]  Key [C major ▾]  Transpose ↑ ↓  Aa | I-IV                 │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ [Verse 1] ⋮                                    │ Chords │ Words │ Memos       │
│      Am            F                           │   ↑  C major  ↓              │
│  5   Wondering where the                       │ Triads   Sevenths            │
│ [Chorus] ⋮                                     │ Borrowed Secondary           │
│      C                       F    G            │                              │
│  8   Got me thinking bout that last dance      │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

- **Lyrics are monospace.** A chord atom has no width in the text; its name sits above the letter it is anchored to.
  When two names would collide, the line widens rather than letting them overlap. The margin number is the line's
  syllable count (Part 5).
- **Placing a chord:** click one in the panel to insert it at the caret, or press `[` for a small field that takes a
  name or a numeral - `Am`, `vi`, `Bb7`, `F/A` - and Enter. A name outside the key becomes the right degree: `Bb` in C
  is ♭VII, so it transposes correctly. A name that cannot be read is refused with its reason, not guessed. **This needs
  a new parser:** the app reads chords from *notes* (`parseChord` in `services/progression-parse.ts`) and writes a
  reading into a key (`expressInKey` in `services/progression-recognise.ts`), but nothing parses a typed chord name.
  The new parser produces a root and a chord shape and hands them to `expressInKey`.
- **Editing a chord:** click its name for a popover - change the chord or its quality, its length (beats or bars),
  audition it, delete it.
- **Moving a chord:** drag its name to another letter, or select it and press Alt+←/→. Its timing does not change.
- **Sections:** "+ Section" (pick the kind), or type `[Chorus]` on an empty line. Each header has a ⋮ menu: rename,
  duplicate, move up or down, delete, play, Open in Progression.
- **The toolbar:**
  - Key: every chord re-spells from its degree. Changing the mode uses the progression page's re-key
    (`ProgressionDegreeEditor.rekey`), so the chords keep sounding the same.
  - Transpose ↑↓: the tonic a semitone at a time.
  - `I-IV`: chord names or Roman numerals on the sheet.
  - `Aa`: lyric font size.
- **The Chords tab** shows the vocabulary the progression palette offers (`chordVocabulary` in
  `services/progression-vocabulary.ts`): diatonic triads and sevenths, borrowed chords, secondary dominants, each as
  numeral and name. Its ↑↓ transposes the song.
  - **After S1: next-chord hints.** The progression palette marks the chords that conventionally follow the selected
    one and names each motion (`docs/plans/2026-10-21-next-chord-hints-design.md`, shipped on `main`). The table is
    `likelyNextDegrees(scaleIntervals, selected)` in `services/progression-next-chords.ts`: it takes a key's intervals
    and a `ChordShape`, which a chord atom's `ChordSlot` already carries, and knows nothing about the palette - so the
    Chords tab can mark the chords that follow the one at the caret, and share the palette's caption, without a second
    table. Not part of S1, whose plan is unchanged; picked up once S1 has landed.

## Part 3: Sound

- **Auditioning one chord** - clicking it in the panel or on the sheet - plays it at once through the progression page's
  Tone.js synth (`services/progression-audio.ts`), the voicing the palette auditions today. Light, instant, and
  independent of anything playing.
- **Playing the song:** the song is assembled into one composer score - each lyric section's chords become bars of a
  "Chords" track through `progressionToScore` (`services/progression-score.ts`), each tab block bars of a "Tab" track,
  sections one after another, a track resting through sections with nothing for it. A hidden alphaTab player that the
  song page owns plays it, which brings the composer's metronome, count-in, loop and speed, and tab that sounds like a
  guitar rather than a synth.
- **One builder, used twice:** the same song → score function is what Send to Composer exports (Part 6), so what the
  page plays is what the composer receives.
- **The sheet follows along:** as alphaTab reports each beat, the sounding chord name and its section header are
  highlighted, and a tab block shows its own caret.
- **Controls:** ▶ in the toolbar plays the song; a section's ⋮ → Play section, loopable. Space plays and pauses, as on the
  other pages.
- **Memos** play through a plain audio element, apart from the song's timeline.
- A section with lyrics and no chords plays as one bar of silence, so the count stays steady.
- **Edits made during playback apply from the next press of Play**, as in the composer: rebuilding the score mid-phrase
  glitches.

## Part 4: Tab blocks

- A block is a small composer document: one track, at the song's tempo and time signature. "+ Tab" in a section, or
  `/tab` on an empty line, picks the instrument and tuning the way the composer's Add track does. It starts with two
  empty bars.
- **One block is live at a time.** Every block in view is drawn as a static engraving by alphaTab's headless
  `ScoreRenderer`, which also measures note bounds. Clicking a block, or arrowing into it, makes it live: it swaps to
  the composer's own score component, with the caret, keyboard entry (fret digits, arrows, durations, techniques),
  selection, copy and paste. A compact tool row of the palette's own tools appears under it: durations, h/p, slides,
  bends, P.M., let ring - flat, colour only on the selection.
- **One undo step per visit.** While a block is live, Ctrl+Z walks the block's own history as in the composer. Leaving
  it - Escape, a click on the lyrics, or an arrow past its edge - writes the result into the song as one step ("Edit
  Intro tab").
- **Isolation, and the riskiest part of the design.** The live block gets its own composer state: the composer's
  services, created fresh for that block, so the composition open on the composer page is never touched. Those services
  were written as page-wide singletons, so **S3 opens with a spike** proving a second, isolated set can run on the song
  page. If it cannot, the fallback is "Edit in Composer": the composer opens on the block, and Done brings it back.
- **The block's ⋮ menu:** rename, play and loop, instrument and tuning, add or remove bars, duplicate, delete, and Copy
  to Composer, which opens it as a new composition - a copy, not a link (decision 8).
- **Not in this version:** chord names drawn over the tab, and more than one track in a block.

## Part 5: Writing helpers

The Words tab and the Memos tab.

- **The dictionary.** A build step turns the CMU Pronouncing Dictionary (BSD licence, about 134,000 words) into a compact
  word → phonemes file, about 1 MB gzipped. It is fetched only when the song page first needs it, parsed in a Web
  Worker so the page never stutters, and cached. A word it lacks (slang, a name) gets a spelling-based estimate, marked
  `≈` so it is never mistaken for a dictionary count.
- **Syllables:** the margin counts every lyric line, chords excluded. Comparing verse 1 to verse 2 in the margin is
  left for later.
- **Rhymes:** the caret on a word, or a double-click, fills the Words tab:
  - perfect rhymes: the same sounds from the last stressed vowel on (dance → chance, glance, romance);
  - near rhymes: the same last stressed vowel with a similar ending (dance → stand, plans, last);
  - grouped by syllable count. Click one to replace the word as one undo step; Alt-click to insert it after.
- **Rhyme-scheme gutter**, optional: each line's ending lettered A, B, C… within a section, so AABB or ABAB shows at a
  glance.
- **"More ideas"**, only when pressed: asks Datamuse for synonyms, words of related meaning and words that often follow.
  The button names what it sends ("sends 'dance' to datamuse.com"). Nothing is sent otherwise; offline, the panel says
  so.
- **Memos:** Record in the Memos tab uses the browser's microphone, asking permission the first time. The recording is
  attached to the section the caret is in, as a memo row in the sheet (▶, name, length). The tab lists every memo with
  play, rename, download and delete. Audio is stored as Opus in its own store; deleting the memo from the sheet deletes
  its audio.
- **Not in this version:** recording while the song plays. Lining a take up with playback needs latency compensation,
  and gets its own small design.

## Part 6: Library, import and export

- **Where songs live:** a **Songs** item in the main nav. `/songs` is a library of cards - title, artist, key, sections,
  last edited - with search, New song, Duplicate, and Delete with a confirmation. `/songs/:id` is the sheet, with
  "← Library" at the top.
- **Storage:** a new IndexedDB database, `song-library`, with a `songs` store and a `memos` store, its name behind an
  injection token as `GP_LIBRARY_DB` is, so specs never touch the real one.
- **Autosave** (decision 9) persists the latest document a moment after the last change, and the title bar always
  shows the result.
- **Import**, from the library page or a drop on it:
  - **ChordPro** (`.cho`, `.chordpro`, `.crd`): `{title}`, `{key}`, `{tempo}`, `{start_of_chorus}`, `{comment}` and the
    rest map to sections; inline `[Am]` chords become chord atoms.
  - **Chords over lyrics**, the format most chord sites use: a line of chord names only belongs to the lyric line under
    it, matched by column. Pasting such text into the sheet converts it the same way.
  - **The key:** the file's own if it says; otherwise the import suggests one from the chords and asks before anything
    is stored as degrees.
  - **ASCII tab** in a file becomes a tab block. Plain-text tab has no rhythm, so every note is read as an eighth, and
    the import report says so.
  - Anything not read is listed in an **import report**. Nothing is dropped silently.
- **Export**, from the sheet's Export ▾:
  - **Print / PDF:** a print stylesheet turns the page into a clean chord sheet - no panels, sections kept whole across
    pages - and the browser's print dialog saves the PDF.
  - **ChordPro**, with tab blocks as ASCII inside `{start_of_tab}` … `{end_of_tab}`.
  - **Plain text**, chords over lyrics.
  - **Send to Composer:** the whole song as a new composition, through Part 3's builder.
  - A section's ⋮ → Open in Progression (Part 1).
  - Memos stay out of the text exports; each has its own Download.

## Part 7: Build order and testing

Five milestones, each usable when it lands.

1. **S1 - The sheet.** ProseMirror, the schema, `SongDoc`, the `song-library` store, the `/songs` and `/songs/:id`
   pages; sections, lyrics, chord atoms, the `[` field and its chord-name parser, the chord popover; key, Transpose and
   the numerals toggle; the Chords tab, auditioning, autosave, undo; Open in Progression both ways.
2. **S2 - Sound.** The song → score builder, the hidden player, the transport (play, section loop, metronome, count-in),
   following along, Send to Composer.
3. **S3 - Tab blocks.** Opens with the isolation spike (Part 4); then static rendering, the live block, the block menu,
   tab in playback. If the spike fails, S3 builds the "Edit in Composer" fallback instead, and the user hears about it
   before anything else is built.
4. **S4 - Words and memos.** The dictionary build step and worker, the syllable margin, rhymes, the rhyme-scheme
   gutter, More ideas; memo recording and storage.
5. **S5 - Import and export.** ChordPro and chords-over-lyrics import with the key question and the report, paste
   conversion, ASCII tab both ways, print, ChordPro and plain-text export.

**Testing:**
- **Jasmine specs on every pure module:** the schema's JSON round trip, a section's derived progression, the chord-name
  parser, transpose, syllables and rhymes against a small fixture dictionary, the ChordPro and plain-text parsers and
  writers, ASCII tab, and the song → score builder.
- **Editor commands** on a headless ProseMirror `EditorState`, no DOM needed.
- **Storage specs** use their own database names and delete them after.
- **Tab blocks** are checked against real alphaTab renders, as `composer-score-systems.spec.ts` does.
- **Each milestone ends with a hand check** on real material - a ChordPro file, a printed sheet, a recorded memo. A step
  that cannot be performed (the built-in browser pane may have no microphone) is recorded as not performed, never as
  passed.

## Part 8: Keeping collaboration possible

Real-time collaboration is a later milestone (decision 6), most likely Yjs through `y-prosemirror` on the ASP.NET
backend. This version keeps that door open:

- **Stable ids everywhere**, and nothing addressed by index or position outside the ProseMirror document.
- **All song state lives in the document**, except memo audio, which is referenced by id.
- **Autosave is "persist the latest document"**, a single seam a sync provider can replace.
- **Derived things stay derived:** a section's progression, the song score, syllable counts and rhyme letters are
  computed from the document and never stored.

## Corrections found in building S1

Each is argued in [the S1 plan's "Corrections to the design"](2026-10-01-songwriting-s1.md); one line each here.

1. The progression types live in `models/progression.model.ts`, not `composer.model.ts`.
2. Nothing auditioned one chord: `ProgressionPlayerService.audition` and `ToneApi.now()` were added, off the transport.
3. `chordVocabulary` had no diatonic row: `diatonicChordsOf` now builds it for the palette and the Chords tab alike.
4. `chordName` writes `A min`; lead-sheet names (`Am`, `Cmaj7`) come from a fourth suffix table beside the others.
5. Nothing read a chord typed by name: `chordFromText` writes it on the degree its letter names, or refuses why.
6. The progression page has no key picker; the song has its own, and refuses a key that cannot build chords.
7. `rekey` needed a store: its body is the pure `rekeyedSlot`, and the song re-keys every chord through it.
8. ProseMirror needs a default for every attribute: ids default to null and the id plugin fills them.
9. `[` opens the chord field on a line with text and is typed on an empty one, where the bracket rule reads it.
10. ProseMirror selected an atom on a modified arrow: a key handler steps past chords instead.
11. A chord name keeps zero width, but lines are taller, and spacing is measured from no padding each time.
12. Open in Progression keeps the link in `sessionStorage`, merges the return three ways, and guards `adopt`.
13. Display choices are the viewer's, in `localStorage`, out of the document and its history.
14. Autosave is compare-and-swap: a save over a newer revision is refused, never retried on a timer.
15. A key is shown as the progression page shows it, "C Ionian (Major)".
16. A secondary dominant is numbered as the sheet prints it (`VI7`), with `V/ii` as a caption under the cell.

## Hand check (S1)

Run on 2026-10-21 in the desktop app's browser pane, against the dev server, typing with real key events. The pane's
browser could not hear, could not be a Mac, and its synthetic drags do not reliably start the browser's own
drag-and-drop - so three things below are recorded as not performed, and one as inconclusive.

1. **A song from nothing - passed.** A title; `[Am]` at the start of an empty line read as a chord; `[` mid-line
   opened the field and `]` closed it; `[G]` alone on a line; `[Chorus]` started a section. "Saved · just now", and a
   reload brought all of it back.
2. **Chords over words - passed by measurement**, at 375, 498 and 1,400 px: every name starts on its own letter and
   sits directly above it, no two names overlap and none covers lyric text, including three chords piled on an empty
   line and lines that wrap at 375 px. Not looked at on a real phone.
3. **Key and Transpose - passed.** C to G, then up to A♭ and down to F♯: every name re-spelled (`Fm D♭ A♭ E♭`,
   `D♯m B F♯ C♯`) and the numerals held at `vi IV I V`.
4. **The Chords tab - passed.** Three clicks built `[G][C][D]` left to right at the caret; with `D` selected, `Em`
   replaced it; the panel's arrows transposed the song and the key menu followed.
5. **Hearing - not performed.** Nothing here can hear a chord; placing, Hear it and the preference want ears.
6. **The popover and moving - passed in part.** The popover changed `C` to `Cmaj7` (`IVmaj7`) and its length from 4 to
   8 beats; Alt+→ and Alt+← moved the chord a letter at a time and kept it selected. **Dragging is inconclusive:** one
   synthetic drag moved the chord (to the next word along, likely from coordinates taken before a scroll) and the next
   did not move it at all. Wants a hand.
7. **The caret - passed on Windows.** Ctrl+→ went word by word and stepped past chords; Ctrl+Shift+→ selected a word
   and its space; Home and End; Ctrl+← from a line's end stopped before the last word's chord; ↓ reached the next line.
   **Option+arrows on a Mac - not performed.**
8. **Open in Progression - passed.** Verse 1 opened with "Editing Verse 1 of “Last Dance” · Back to song"; a chord
   changed, a length changed and a chord added there came back with "Verse 1: 2 chords changed on the Progression page.
   1 chord added on the Progression page is at the end of Verse 1's last line; drag it onto its word."; one Undo took
   all three back; the progression page's own I-V-vi was back. A reload in the middle of a hand-off kept the section
   and the banner, and the chord added before it landed on return. The edits on the progression page were made through
   its own service commands from the console, not by clicking its controls.
9. **Two tabs - passed.** The second tab's save was refused: "Not saved: This song was changed in another tab or window
   after it was opened here, so the changes here were not saved. Reload it to see that version." The first tab's edit
   is the one stored.
10. **Library - passed.** Duplicate made "Last Dance (copy)"; search narrowed to it; Delete asked "Delete "Hand Check
    Song"? This cannot be undone." - the pane dismisses a native dialog as Cancel, which kept the song, and accepting
    it was checked by answering the dialog from the console; a record corrupted in IndexedDB got its own card, "This
    song cannot be opened: Unknown node type: not-a-song", with Delete.

## Open questions

- Whether the Chords tab's key arrows should also move the circle of fifths' key, or stay the song's alone (the
  composer's Scales menu stays apart from the circle today; see `docs/TODO.md`).
- Whether a section should one day *link* to another (a chorus that repeats its chords) instead of copying them
  (decision 8 chose copies for now).
