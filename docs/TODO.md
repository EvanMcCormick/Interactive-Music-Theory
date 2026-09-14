# Outstanding

What is known to be left, as of **2026-09-13**, after M4 of the progression composer and
M1 of the composer editor shipped. Written because these items were spread across design
documents, a roadmap paragraph and a plan's hand-check list, and no single place said
"here is what is not done".

This is not a backlog of ideas. Everything here is either a check nobody has performed
or a defect somebody decided not to fix yet, and each says which.

---

## Checks nobody has performed

The suite is headless, so none of these can be settled by running it. They are ordered
by what they would cost us to be wrong about.

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
      M1 of the composer editor proves hammer-ons, bends, slides, trills, fingering,
      fermatas and forced accidentals survive a save, but its round-trip specs go through
      alphaTex, which is what the library stores — not through the `.gp` exporter, which is
      a different writer. The editor design lists this as a hand check for every milestone.

- [ ] **Send a progression into a score loaded from a `.gp` file** — one with a bass
      staff, so its bars carry `f4` and a real key signature. `padStaff` carries clef,
      ottava and key signature forward from the staff's last bar; that is specced, but
      never exercised against a genuinely loaded score.

- [ ] **Drive the whole cycle in a browser at a narrow viewport.** The rail's export
      buttons stack below about 208px of row and the tracks panel wraps its badge and
      status onto their own line; both were measured in headless Chrome rather than
      looked at.

## Known limitations, recorded rather than fixed

Each of these is argued in a design document — the reasoning is there, not here. The
progression composer's are in `docs/plans/2026-09-08-progression-composer-design.md`.

- **A score that changes meter mid-way.** A generated track is barred by the score's
  *first* time signature, so its bar lines disagree from the point the meter changes.
  Fixing it means teaching `placeProgressionNotes` and `writeBar` a per-bar signature.
- **A generated track's id is not unique after Flatten then Send.** Flatten keeps
  `progression-<uuid>` and drops the marker, so the next Send appends a second track
  with the same id. Harmless today — nothing reads `TrackDoc.id` — and reproducible in
  three clicks. Fixing it in Flatten would break "Flatten costs one field", which is
  the design's own argument for the materialised-track choice.
- **Two rows both called *Progression*.** The same Flatten-then-Send path leaves the
  panel showing a detached track and a linked one with nothing but the badge to tell
  them apart.
- **`quantizeBar` has no note-off**, so a staccato roll engraves legato.
- **`BeatDoc.dynamics: null`** is documented as "inherit" and nothing implements it.
  This reaches an exported file now as well as a preview, which raises its priority
  without changing what it is.
- **`parseChord` returns the first reading that consumes every note**, so two chords the
  palette can build in three clicks lose their numeral and degrade to `literal`. The
  evidence and the count are already written down in
  `progression-recognise.roundtrip.spec.ts`.

The composer editor's are under "Found while designing" in
`docs/plans/2026-09-13-composer-editor-design.md`. Most are alphaTab's rather than ours,
and the ones a save causes are pinned in `score-doc-mapper.effects.spec.ts`, so an
alphaTab upgrade that changes one turns a spec red rather than going unnoticed.

- **A double bar does not survive a save.** M1 hands it to alphaTab, so it draws, but
  alphaTab 1.8.0 reads `\db` and never writes it, and the library stores alphaTex. An
  upstream gap: the fix is theirs, and the pinned spec is ours to retire when it lands.
- **A hammer-on, or a shift or legato slide, with nothing to land on does not save.**
  alphaTab's `Note.finish` clears it when no note follows on its string, so the editor can
  show a technique that a reload loses. M2's tools decide whether to refuse it or allow it
  and say so. *Settled in the M2 plan: refused with a reason, landing later in the bar or on the
  next bar's first beat - alphaTab's reach as measured, not the three bars its source reads.*
- **Bends are stored in Guitar Pro's shapes, not as drawn.** alphaTab rewrites a bend of
  two to four points to the nearest standard type before anything is saved, and a pre-bend
  of 2 or more quarter tones resets a forced accidental. M4's bend curve editor has to write
  those shapes.
- **A fermata spreads to later tracks at the same tick**, on screen and in the saved file,
  because alphaTab keeps fermatas per bar and tick; clearing the original leaves the
  copies. M2's fermata tool decides whether a fermata belongs to a beat or to a bar.
  *Settled in the M2 plan: to a bar position on every track, so the spread is the rule.*
- **A grace beat's written value is alphaTab's, not the user's.** `Beat.finish` revalues an
  on-beat or before-beat grace by the size of its group, so a duration set on one does not
  survive a save. M1 skips graces when it sets durations; M2's grace tool should fix the
  value to alphaTab's rule or refuse the edit. *Settled in the M2 plan: a duration press on
  nothing but graces is refused.*
- **A tied note shows its origin's vibrato**, even when its own is none — which a Fix bar
  continuation's is, by design. M2's vibrato tool should read the tie origin. *Settled in the M2
  plan: the button reads the origin, and a press on a tied note is refused.*
- **Four slide types have no name in the model.** In from above, out down, and pick slides
  down and up read back as no slide, so alphaTex applied from the source panel loses them.
  Nothing the composer writes can produce them.

## Bugs, recorded and not yet fixed

Found while designing and building M1 of the composer editor, and left for the milestone
that owns the control that reaches them. Each is in the same "Found while designing" list.

- **A tuning, capo or transposition change can put a forced accidental on the wrong line.**
  The accidental command refuses one that cannot name its pitch, but checks only when the
  accidental is pressed; a later change moves the drawn pitch under it and nothing checks
  again. M3's track controls should count the notes a change would affect and say so.
- **Fix bar into a bar that was already short moves that bar's own beats later.** The whole
  shortfall fills right after what Fix bar carried, including the part that was at the end
  of the bar before.
- **A pitched note imported as a natural harmonic cannot have its harmonic cleared.** The
  harmonic is fretted-only, and the refusal meets the press that would turn it off as well as
  one that would turn it on. M2's harmonic tool should let a clearing press through.
  *Resolved in the M2 plan (Task 1.8), for every fretted-only note technique - not yet in code.*
- **The Bass instrument preset gets six guitar strings.** `createTrack` gives every fretted
  track `STANDARD_GUITAR_TUNING`; `STANDARD_BASS_TUNING` exists and the composer never uses
  it. M3.
- **A whole tuplet group moves the notes after it earlier.** In `relength`'s phase 2 each
  triplet beat frees 160 or 320 ticks, which is off the 64th grid, so `insertRestsAt` cannot
  spell a rest after any one of them and the bar fills at its end instead — even though the
  group's total gap spells cleanly right after the group. `n8 n8 n8 n8 n2` with its first three
  beats made a triplet puts the fourth eighth at 960 rather than 1440. The fix is to carry room
  that could not be placed forward through a contiguous run of changing beats and place it after
  the run. It must land before M2's tuplet tool. Phase 2 also counts a beat's room as `placed`
  when `insertRestsAt` returns false — harmless today, since phase 4 fills the bar anyway, but
  fragile. *Resolved in the M2 plan (Task 1.1), before its tuplet tool, counter included - not yet
  in code.*
- **Refusals are not displayed yet.** `ComposerState.refusal` has no binding in the composer
  UI, though design Part 4 promises a polite live region. So in a loaded file with a second
  voice, clicking a voice-2 beat and typing a fret is now refused silently, where it used to
  write. A refusal also outlives a caret move: `setCursor`, `extendSelectionTo`, `undo` and
  `redo` do not clear it. M2 gives refusals their live region and settles when they clear.
  *Resolved in the M2 plan (Tasks 1.3, 1.4 and 3.3): one polite live region in the status line,
  cleared by caret moves, selection changes, undo and redo - not yet in code.*

## Smaller things noticed in passing

- **A `NaN` in `ProgressionDoc.revision` would poison the allocator permanently**, since
  `Math.max` propagates it. Only reachable from a corrupt document, and there is no
  loader yet — but there will be.
- **`ProgressionDoc` has no rename path at all.** Several decisions in M4 turn on the
  track's name and the marker's copy diverging, and neither can move today. Whatever
  adds a rename must write a resolved label through to `GeneratedOrigin.progressionName`
  via the exported `progressionLabel` — `revision` does not move on a rename, so a stale
  copy there would not even read as stale.
- **Every call to `updateScoreInfo` is an undo step**, so each keystroke in the title field
  would be its own, and retyping an unchanged title marks the score dirty. M3's inspector
  should coalesce the edits or skip a commit that changes nothing.
- **`KEY_SIGNATURES` in the mapper lists major keys only and omits ±7.** The key signature
  popover M2 builds needs all fifteen, major and minor. *Planned in M2 (Task 3.2), beside the
  mapper's list rather than in it.*
- **Seven files still cite a "500-line guideline"** in their headers; `CLAUDE.md` raised
  it to 1000 on 2026-09-09. One was fixed in passing; the rest want a sweep.
- **`((x % 12) + 12) % 12` is written about seven more times** across
  `progression-harmony.ts`, `progression-parse.ts`, `progression-generate.ts`,
  `progression-voicing.ts`, `piano-roll-view.ts`, `note-naming.ts` and
  `review-controls.ts`. `reduceToOctave` is exported from `note-spelling.ts` and the
  spelling cluster now uses it; the rest is a separate sweep.
- **Clicking a generated notation staff still auditions the note** it will refuse to
  write. Arguably right — audition-on-read — but unconsidered rather than chosen.
- **Redo does not put back a followed selection.** An edit keeps the selection on its beats
  through the rests it inserts, but undo and redo only clamp the current selection, so after
  undo then redo a range made shorter can end short of its notes. Recorded under "Found while
  designing" in the composer editor design doc.
- **Rests that could merge are left as two.** A duration change puts a gap's rests where the gap
  opened and leaves the bar's other rests in place, so `n8 n2 r4 r8` with its first two beats
  set to quarters is `n4 n4 r8 r4 r8`. The beats after it keep their ticks, which is the point;
  M2 may merge them.

## Next milestone, when there is one

**M1 of the composer editor redesign is implemented.** Designed on 2026-09-13 in
`docs/plans/2026-09-13-composer-editor-design.md` and built to
`docs/plans/2026-09-13-composer-editor-m1.md`: saving stops losing data, a selection with
beat, note, bar and track commands over it, and bars that fill their gaps with rests and
report their overflow. Almost none of it has a control yet — only today's duration, note and
rest buttons, which now fill the gaps they open and leave overflow rather than overwrite a
note. The redesign came first because the composer cannot
set a time signature, which blocked a hand check of the `insertBar(0)` fix; M1 gives it the
command, and the control is still to come.

**Next up is M2**: the palette, the Select / Pen toggle, the tool table and a shortcut for
every tool, which put M1's commands within reach, with the new page grid and a minimal track
strip. It is planned, and the plan proven against the code, in
`docs/plans/2026-09-13-composer-editor-m2.md`; its decisions are under "M2 decisions" in the
design doc.

**After M2, the GP Viewer becomes the composer** - decided by the user on 2026-09-13, a
milestone of its own before M3, not yet planned. Opening a `.gp` file in the composer shows and
plays alphaTab's reading of it, as the viewer does; the first edit converts it to the composer's
model after a prompt listing what the file would lose - multiple voices, lyric lines beyond the
first, tremolo bar and wah, chord diagrams, tempo automations beyond bar 1, the four unnamed slide
types - so nothing is dropped silently. The GP Library's Open then goes to the composer, and the
viewer route is removed.

M3 (inspector, and the track strip's mixer and bar grid) and M4 (bend curve, custom tuplet and
trill speed editors) follow.

After that, the progression design doc's "Not in M4" names the one that unlocks the
others: **a progression library**. It would give `GeneratedOrigin.progressionId` a far end worth persisting,
make the `'foreign'` state in the tracks panel reachable (it is coded and specced but
cannot occur today), and turn "more than one generated track" from a curiosity into a
case with a name.
