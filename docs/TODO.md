# Outstanding

What is known to be left, as of **2026-09-14**, after M4 of the progression composer and M1 and
M2 of the composer editor shipped, and after the milestone that makes the GP Viewer the composer
was designed. Written because these items were spread across design documents, a roadmap
paragraph and a plan's hand-check list, and no single place said "here is what is not done".

This is not a backlog of ideas. Everything here is either a check nobody has performed or a
defect somebody decided not to fix yet, and each says which. What M2 settled is argued in the
composer editor design doc's "M2 decisions", not repeated here.

It is grouped by what owns the item: the checks first, since they are the only things that
cannot be settled from a chair, then what is owed for the composer, then everything else.

---

## Checks nobody has performed

The suite is headless, so none of these can be settled by running it. They are ordered by what
they would cost us to be wrong about.

### Two want real Guitar Pro

- [ ] **Open an exported `.gp` in real Guitar Pro and read the ♭II.** Reading alphaTab's
      `GpifWriter._writePitchForValue` says it displaces a note only when the default
      spelling is already sharp, which would make a C♭ export as B♭ and a B♯ as C♯ —
      exactly the two cases M4's spelling work exists to produce. D♭ is unaffected. Our
      own reload survives either way, because the importer takes pitch from
      `Octave`/`Tone`/`Midi` and reads only the accidental glyph, so this is about what
      other software shows.
      **If it holds, it is an upstream report and a recorded limitation, not a change
      here.** See "Open: what `.gp` export does with a C♭" in the progression design doc.

- [ ] **Open a composer score full of effects, exported as `.gp`, in real Guitar Pro.**
      M1 and M2 of the composer editor prove hammer-ons, bends, slides, trills, fingering,
      fermatas and forced accidentals survive a save, but their round-trip specs go through
      alphaTex, which is what the library stores — not through the `.gp` exporter, which is
      a different writer. The editor design lists this as a hand check for every milestone.

### The composer

- [ ] **Finish M2's hand check in a real browser.** It was run on 2026-09-14 in the Claude desktop app's Browser pane,
      which cannot drag, cannot press a focused button with Enter or Space, has no zoom, and has no other browser,
      operating system, keyboard layout, screen reader or DevTools. Its results are under "M2 hand check" in
      `docs/plans/2026-09-13-composer-editor-design.md`. Owed, as numbered in Task 5.2 of
      `docs/plans/2026-09-13-composer-editor-m2.md`:
      - Step 2, the palette's glyphs at 200% zoom.
      - Step 5 on four systems with a Piano track: the caret, the hover notehead, a ledger line above a later system,
        and a click between systems.
      - Step 6: a drag, Shift+click, Space playing from the start without looping, the range across a re-render, and a
        drag drifting between tracks.
      - Step 7, every palette group; Step 10, a hammer-on through save and reload.
      - Step 8: Alt+/ for 5:4, and Enter on a Section with its name cleared.
      - Step 9 with Narrator or NVDA.
      - Step 13 beyond Ctrl+S, the drawer and a load by mouse: Enter on a saved row, the progression track's refusal
        and Flatten, Export's focus, New then Save, the alphaTex draft's refusals, a double Save, a draft written against
        an earlier score, Open in Composer, and deleting the open composition.
      - Step 14: the strip's separator by drag, ↑, ↓, Home and End; a shorter window; the alphaTex panel on a short
        window; Very large font size; a refusal wrapping the status line.
      - On a Mac, in Chrome and in Safari (from the final M2 review): ⌘+← and ⌘+→ move a bar and do not go Back or
        Forward (the key handler calls `preventDefault` on them); ⌘+/ opens Triplet feel, not Safari's status bar;
        ⌃+Shift+1 to 8 set a dynamic and ⌃+Shift+Backspace deletes a track; the tooltips show neither ⌘+Space nor ⌘+Y.
      - Steps 15 to 19, 22, 27, 28 and 32: Firefox, German and French layouts, macOS, operating system hotkeys and a Mac
        keyboard.
      - Step 20, a drag released outside the score; Step 21, click-to-seek.
      - Step 23, a popover at the palette's edge; Step 24's Alternate ending in a 500px window.
      - Steps 25 and 31: popovers and menus by keyboard alone, and Escape then Space.
      - Step 26, drag and hover performance in DevTools.
      - Step 30 on the second system, and `{numbered tabs}` by hand.
      - Step 33, the prompts before unsaved work is discarded.

      Step 29, Guitar Pro, is the second item above. The alphaTex panel's re-fit of the strip, in Step 14, was fixed
      after the merge (`ff8a94c`) and has a behaviour spec; the drag that would confirm it by hand is still owed.

### The rest of the app

- [ ] **Send a progression into a score loaded from a `.gp` file** — one with a bass
      staff, so its bars carry `f4` and a real key signature. `padStaff` carries clef,
      ottava and key signature forward from the staff's last bar; that is specced, but
      never exercised against a genuinely loaded score.

- [ ] **Drive the progression cycle in a browser at a narrow viewport.** The progression rail's export
      buttons stack below about 208px of row; that was measured in headless Chrome rather than looked at. The
      composer's own narrow widths belong to the M2 hand check above, where Step 14 passed at 1000, 768, 480 and
      375px.

---

# Owed for the composer

## Known limitations, recorded rather than fixed

Each of these is argued in `docs/plans/2026-09-13-composer-editor-design.md`, under "Found while
designing"; what M2 settled is under its "M2 decisions". Most are alphaTab's rather than ours,
and the ones a save causes are pinned in `score-doc-mapper.effects.spec.ts`, so an alphaTab
upgrade that changes one turns a spec red rather than going unnoticed.

- **A double bar does not survive a save.** M1 hands it to alphaTab, so it draws, but
  alphaTab 1.8.0 reads `\db` and never writes it, and the library stores alphaTex. An
  upstream gap: the fix is theirs, and the pinned spec is ours to retire when it lands.
- **A hammer-on's or a shift or legato slide's landing is checked only when the tool is pressed.**
  Later edits - deleting beats, a cut, a string move elsewhere in the bar, an insert that pushes the
  landing past the next bar's first beat, a rest over a range - can still leave one with nothing to
  land on; the palette still shows it, and alphaTab drops it on save. Nothing re-checks a landing
  after the press that made it. An edit that strands one could refuse, or say so, as a string move
  already refuses.
- **Bends are stored in Guitar Pro's shapes, not as drawn.** alphaTab rewrites a bend of
  two to four points to the nearest standard type before anything is saved, and a pre-bend
  of 2 or more quarter tones resets a forced accidental. M4's bend curve editor has to write
  those shapes.
- **Four slide types have no name in the model.** In from above, out down, and pick slides
  down and up read back as no slide, so alphaTex applied from the source panel loses them.
  Nothing the composer writes can produce them. The GP milestone's conversion prompt lists them.
- **A grace that carries a tuplet is read one bar at a time.** alphaTab joins a bar's leading grace to the group the
  bar before ends in, and a grace after a beat in no group starts a group that never closes. The editor's open-group
  refusals read a bar on its own, so such a bar can be misread: `o ot3 ot3 ot3 o n2 n2` after a bar that ends in a
  closed triplet is read as holding an open group, where alphaTab joins the graces to that triplet. Stripping the
  tuplet on load was measured and not done: it changes alphaTab's grouping - `n4 g8t3 n8t3 n8t3 n8t3 n2` is one open
  group of four as loaded and a closed triplet stripped - so it is not a normalisation. A loaded file is the only
  source: a beat the grace tool makes a grace loses its tuplet in the same edit (`setGrace`). A save changes none of
  it: alphaTex keeps a grace's tuplet, a grace-only run's included.
- **A selection's tick-bounded end takes a whole grace run.** When a range's ends are in different voices, an end in
  the other voice bounds the range by its start tick, and a grace starts at the tick of the beat it leads into. No
  edit reaches it while edits refuse a second voice; multiple voices must decide it.
- **Deleting, or writing over, the note that holds a fermata leaves the fermata at its tick.** A fermata goes with its
  note only when the note moves; a note that is gone carries nothing, so on one track the beat that moves onto its
  tick takes the fermata. Guitar Pro removes a fermata with its beat. A paste that leaves nothing at the tick removes
  it and says so.
- **Undo and redo do not restore the caret or a followed selection.** They put back the document and clamp the
  current caret and selection into it (`ComposerHistory`), since undo entries do not store the cursor. So after undo
  then redo, a range an edit made shorter can end short of its notes, as it did not straight after the edit. Guitar
  Pro restores the selection.
- **Fix bar's button does not show its tuplet refusals** before it is pressed. The command refuses a tuplet across
  the bar line and a line inside a tuplet group, but `toolStates` reads only a generated track and whether a selected
  bar is over; showing the rest would run the carry on a copy for every selection.
- **A second voice of rests is not kept as written on save.** The mapper draws such a voice as nothing (`isEmpty`), so
  the alphaTex exporter writes none of its beats: a staff with no note in its second voice saves without one, and a
  bar whose second voice is all rests, beside bars that have notes there, comes back holding one quarter rest. It saves
  again unchanged and says nothing musically, but a fermata only such a rest holds, at a tick the first voice has no
  beat at, would be lost. Pinned in `composer.service.voices.spec.ts`. This is the *only* voice limitation: `BarDoc.voices`
  is an unbounded array and the mapper reads and writes every voice, which the GP design doc corrects the M2 design on.
- **A key pressed with Ctrl, Alt or Cmd inside a popover still reaches the page's shortcuts**, on purpose, so Ctrl+S
  saves and Ctrl+Z undoes from a popover as from any control. A symbol typed through AltGr on a popover's checkbox or
  button can therefore run a symbol tool - German AltGr+0, `}`, opens Alternate ending in place of the popover open.
- **A document marked saved is compared by identity.** A queued save compares the alphaTex it would write, but
  `markSaved` still marks the document clean only if it is the very one written, so Save, then an edit and its undo,
  leaves the unsaved marker showing for a document the library already holds.
- **The score takes the mouse only.** alphaTab and the score listen for mouse events, so a tap or a stylus press acts as a
  click, but a touch or stylus drag scrolls rather than selecting, and there is no touch hover. Pointer events would give
  both; recorded as a follow-up, not built.
- **alphaTab's `_isBeatMouseDown` stays set after a mouse-up outside the score.** The composer's drag ignores it
  (`dragContinues` reads the buttons), but alphaTab skips playback auto-scroll until the next mouse-up on the score, and
  there is no public API to clear it.
- **A press that closes a popover is ignored until the page hears that press end.** A mouse-up ends it, and so does a
  press the browser takes over and sends no mouse-up for: a `pointercancel` - one become a native drag, a touch become a
  scroll - or the `dragend` after it (`1de28dc`). An end the page hears none of - the button let go over another window -
  still leaves the guard on, and the next press on the score is ignored as well, once.
- **A slash staff is measured as one line, and a two-line staff next to another staff can be read as lone lines.** The
  hit test tells a staff's lines by their even gaps, so a single line followed by a run of three or more lines at another
  gap is a staff of its own. A numbered staff draws no lines, so it is found by its band instead, and its caret is drawn
  in the middle of that band rather than on a line.

## Bugs, recorded and not yet fixed

Found while designing and building M1 and M2 of the composer editor, and left for the milestone
that owns the control that reaches them — four of the five are M3's, and Fix bar's belongs to
whoever next opens that carry. Each is in the design doc's "Found while designing" list.

- **A tuning, capo or transposition change can put a forced accidental on the wrong line.**
  The accidental command refuses one that cannot name its pitch, but checks only when the
  accidental is pressed; a later change moves the drawn pitch under it and nothing checks
  again. M3's track controls should count the notes a change would affect and say so.
- **A transposition leaves a trill aimed where it was.** The tuning and capo commands move
  every trill on the staff with its string, but a transposition moves none, because alphaTex
  saves a trill relative to the string and capo. M3's transpose control reaches it.
- **A pitched note on a staff with a tuning loses its trill.** alphaTex carries a trill as a
  fret relative to the string's tuning, so such a note exports `tr (NaN 16)` and reads back
  with no trill. Unreachable today - the composer builds pitched staves with no tuning, and the
  alphaTex importer clears one - but it matters if M3 lets a pitched staff carry one.
- **Fix bar into a bar that was already short moves that bar's own beats later.** The whole
  shortfall fills right after what Fix bar carried, including the part that was at the end
  of the bar before.
- **The Bass instrument preset gets six guitar strings.** `ComposerService.createTrack` gives every
  fretted track `STANDARD_GUITAR_TUNING` (`composer.service.ts:203`); `STANDARD_BASS_TUNING` exists
  in `composer.model.ts` and the composer never uses it. M3.

## Found while designing the GP milestone

Recorded on 2026-09-14 in `docs/plans/2026-09-14-gp-composer-design.md`, under "Found while
designing". These are in shipped code on `/gp-viewer` and `/gp-library`. The milestone meets the
first two — the highlighter goes with the page and is rebuilt on the composer, and the metadata is
corrected as a side effect of parsing the bytes on the way in. The rest it does not meet, and they
outlive it.

- **The scale highlighter has never highlighted anything.** `applyHighlighting` queries `.at-note`
  and reads `data-note`; alphaTab 1.8 renders neither, and nothing calls the method after a render
  in any case. The `::ng-deep` rules in `gp-viewer.component.scss` are dead with it, and it is
  direct DOM manipulation, which `CLAUDE.md` names in its table of common mistakes. Decision 9 of
  the milestone builds the panel rather than moving it.
- **A file added from the gallery carries invented metadata.** `GpLibraryComponent.addFiles` calls
  `addFile(file, {})` and the service fills the gaps with `trackCount: 0` and `tempo: 120`, so the
  card prints "120 BPM" and "0 tracks" and sorting by BPM sorts every such file as if it were 120.
  Only a file saved from the viewer carries real values. The milestone parses the bytes on every
  route in, so an older entry is corrected the first time it is opened.
- **The library's key, scale and chord filters can never match.** `GpLibraryFiltersComponent` offers
  all three, and nothing in the app ever writes `key`, `detectedScales` or `detectedChords`. Either
  something should detect them or they should go.
- **There is no bulk delete.** `clearLibrary()` has no call site in its template, and it deletes the
  whole library rather than a selection. A real one needs multi-select, which the gallery has no
  notion of.
- **A file card is a `div` with a click handler** — no `role`, no `tabindex` — so Open is mouse-only.
  The row should be a button, as each saved row in the composer's drawer already is.
- **`scrollMode` is accepted and ignored**, and so are `notation.rhythmMode`, `notation.fingeringMode`
  and `display.barsPerRow`: they are on the settings interface and `AlphaTabService.initializeApi`
  never reads them. A setting a caller can pass and the service drops is worse than one it does not
  offer.
- **The service's own asset defaults are wrong for this app.** `initializeApi` falls back to
  `/assets/font/` and `/assets/soundfont/sonivox.sf2`; `angular.json` publishes them at `/font` and
  `/soundfont`. Every real caller overrides both, so nothing is broken — a caller that forgot would
  lose its music font silently.
- **`GpLibraryService` keeps every file's bytes in a `BehaviorSubject`.** `loadAllEntries` pushes
  whole records, `ArrayBuffer`s included, so a library of fifty files sits in memory to render a grid
  of titles. `ComposerLibraryService.refresh` strips its payload; the fix is a summary projection and
  `getFileData`, which exists and has no caller.
- **`GpLibraryService` can open its database twice.** `initDatabase()` runs from the constructor and
  its promise is not kept, so `addFile` and `getEntry` call it again when `this.db` is still null,
  while `updateEntry`, `deleteEntry` and `clearLibrary` silently resolve instead.
  `ComposerLibraryService.ensureDb` memoises one promise and is the model to copy.
- **Its four indexes are never used.** `title`, `artist`, `dateAdded` and `key`: every read is
  `getAll()` or `get(id)`, and the filtering and sorting run in JS over the whole set. Harmless at
  this size.
- **Re-saving a file always makes a second row.** `addFile` uses `store.add`, and `isInLibrary` is
  in-memory only, so a file dropped into the viewer that the library already holds still offers
  "Save to Library". The milestone's own routes write through one path; the gallery still can.

## Smaller things noticed in passing

- **Every call to `updateScoreInfo` is an undo step**, so each keystroke in the title field
  would be its own, and retyping an unchanged title marks the score dirty. M3's inspector
  should coalesce the edits or skip a commit that changes nothing.
- **Rests that could merge are left as two.** A duration change puts a gap's rests where the gap
  opened and leaves the bar's other rests in place, so `n8 n2 r4 r8` with its first two beats
  set to quarters is `n4 n4 r8 r4 r8`. The beats after it keep their ticks, which is the point;
  M2 did not merge them. The same shape: a whole 6:4 group of sixteenths made grace notes leaves
  `r8 r8` where `r4` would do, since each grace frees its own room and the rest-spelling code
  spells each run where it opened.
- **`isEditableTarget` does not count checkboxes, radios and range sliders as typing.** Space on a
  checkbox or a radio is already covered, by M2's separate focused-control check
  (`pressesFocusedControl`), but only while the control matches `:focus-visible`; the arrows are
  covered by neither, so an arrow on a range slider or inside a radio group moves the composer's
  caret as well. M3's mixer adds such controls and must let them keep their keys.

---

# Owed elsewhere in the app

## The progression composer's known limitations

Each is argued in `docs/plans/2026-09-08-progression-composer-design.md` — the reasoning is there,
not here.

- **A score that changes meter mid-way.** A generated track is barred by the score's
  *first* time signature, so its bar lines disagree from the point the meter changes.
  Fixing it means teaching `placeProgressionNotes` and `writeBar` a per-bar signature.
- **Flatten then Send leaves two tracks that cannot be told apart.** Flatten keeps
  `progression-<uuid>` and drops the marker, so the next Send appends a second track with the same
  id, and the strip shows a detached *Progression* and a linked one with nothing but the badge
  between them. Harmless today — nothing reads `TrackDoc.id` — and reproducible in three clicks.
  Fixing it in Flatten would break "Flatten costs one field", which is the design's own argument
  for the materialised-track choice.
- **`quantizeBar` has no note-off**, so a staccato roll engraves legato.
- **`BeatDoc.dynamics: null`** is documented as "inherit" and nothing implements it.
  This reaches an exported file now as well as a preview, which raises its priority
  without changing what it is.
- **`parseChord` returns the first reading that consumes every note**, so two chords the
  palette can build in three clicks lose their numeral and degrade to `literal`. The
  evidence and the count are already written down in
  `progression-recognise.roundtrip.spec.ts`.

## Smaller things noticed in passing

- **A `NaN` in `ProgressionDoc.revision` would poison the allocator permanently**, since
  `Math.max` propagates it (`progression-history.ts:414`). Only reachable from a corrupt document,
  and there is no loader yet — but there will be.
- **`ProgressionDoc` has no rename path at all.** Several decisions in M4 turn on the
  track's name and the marker's copy diverging, and neither can move today. Whatever
  adds a rename must write a resolved label through to `GeneratedOrigin.progressionName`
  via the exported `progressionLabel` — `revision` does not move on a rename, so a stale
  copy there would not even read as stale.
- **Three file headers still cite a 500-line ceiling** that has not existed since 2026-09-09, when
  `CLAUDE.md` raised the cap to 1000: `transcription-review.component.ts` and `transcription.service.ts`
  each have a section "Past CLAUDE.md's 500-line ceiling, deliberately", and `alpha-tab-enum.bridge.ts`
  gives "the project's 500-line guideline" as its reason for existing. The headers that say the cap
  *stood* at 500 when they were split — `review-controls.ts`, `progression-strip-gestures.ts`,
  `progression-strip-cards.ts`, `progression-chord-names.ts`, `progression-edit.ts` — are history, and
  right as they are.
- **`progression.component.ts` is 1,012 lines**, over `CLAUDE.md`'s 1000-line cap. Found while
  reviewing M2 of the composer editor, which touches only its shared editable-target helper. A
  small refactor of its own: lift a cohesive block out, as `composer.service.ts` shed its bar and
  track commands and then its history.
- **`((x % 12) + 12) % 12` is written out ten more times** across
  `progression-harmony.ts` (twice), `progression-parse.ts`, `progression-generate.ts`,
  `progression-voicing.ts`, `progression-edit.ts`, `progression-vocabulary.ts`,
  `piano-roll-view.ts`, `note-naming.ts` and `review-controls.ts`. `reduceToOctave` is exported
  from `note-spelling.ts` and the spelling cluster uses it; the rest is a separate sweep.

---

## Next milestone

**M1 and M2 of the composer editor redesign are implemented**, M2 merged at `f23bb1c`. Designed on
2026-09-13 in `docs/plans/2026-09-13-composer-editor-design.md`, and built to
`docs/plans/2026-09-13-composer-editor-m1.md` and `docs/plans/2026-09-13-composer-editor-m2.md`.
M1 laid the foundations: saving stops losing data, a selection with beat, note, bar and track
commands over it, and bars that fill their gaps with rests and report their overflow. M2 put
them within reach: a palette of Bravura-glyph tools, the Select / Pen toggle, one tool table
driving buttons, tooltips, a modal shortcut sheet and every shortcut, refusals and outcomes in
one polite live region, and a page grid of top bar, palette, score, status line and a minimal
track strip. What implementation changed is under "Corrections during implementation" in the M2
plan; its decisions, as corrected, are under "M2 decisions" in the design doc. A review after the
merge added `54381aa`, and `0c5ebc9` restyled the palette flat.

**Next up, the GP Viewer becomes the composer.** Decided by the user on 2026-09-13 and designed on
2026-09-14 in `docs/plans/2026-09-14-gp-composer-design.md`, which supersedes the paragraph that
stood here and the "After M2" section of the editor design. Seventeen decisions, a build order of
eleven steps, and percussion joining the model — because a drum track did not convert short, it
converted wrong: alphaTab leaves `tone` and `octave` at -1 on a percussion note, so `fromNote`
produced `{ kind: 'pitched', noteValue: -1, octave: -2 }` for every drum hit in the file. The
design is merged at `2e875be`; the implementation plan is being written on `feature/gp-composer`.

M3 (inspector, and the track strip's mixer and bar grid) and M4 (bend curve, custom tuplet and
trill speed editors) follow it.

After that, the progression design doc's "Not in M4" names the one that unlocks the
others: **a progression library**. It would give `GeneratedOrigin.progressionId` a far end worth persisting,
make the `'foreign'` state in the tracks panel reachable (it is coded and specced but
cannot occur today), and turn "more than one generated track" from a curiosity into a
case with a name.
