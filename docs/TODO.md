# Outstanding

What is known to be left, as of **2026-09-13**, after M4 of the progression composer
shipped. Written because these items were spread across a design document, a roadmap
paragraph and a plan's hand-check list, and no single place said "here is what is not
done".

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

- [ ] **Send a progression into a score loaded from a `.gp` file** — one with a bass
      staff, so its bars carry `f4` and a real key signature. `padStaff` carries clef,
      ottava and key signature forward from the staff's last bar; that is specced, but
      never exercised against a genuinely loaded score.

- [ ] **Drive the whole cycle in a browser at a narrow viewport.** The rail's export
      buttons stack below about 208px of row and the tracks panel wraps its badge and
      status onto their own line; both were measured in headless Chrome rather than
      looked at.

## Known limitations, recorded rather than fixed

Each of these is argued in `docs/plans/2026-09-08-progression-composer-design.md` —
the reasoning is there, not here.

- **A score that changes meter mid-way.** A generated track is barred by the score's
  *first* time signature, so its bar lines disagree from the point the meter changes.
  Fixing it means teaching `placeProgressionNotes` and `writeBar` a per-bar signature.
- **`insertBar(0)` erases a score's declared meter.** `createDefaultMasterBar()` has
  `timeSignature: null` and `insertBar` copies clef, ottava and key signature but
  nothing from the master bar, so inserting at index 0 in a 3/4 score makes bar 1 read
  as the hardcoded 4/4 default. Pre-existing, but M4 promoted
  `effectiveTimeSignature(masterBars, 0)` to *the* definition of the score's meter, so
  it now has a corruption path attached. **This one is a real bug and deserves its own
  fix**, not just a note.
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

## Smaller things noticed in passing

- **`NoteDoc.accidental: 'explicit'` maps to `ForceSharp`**, which forces a sharp in a
  flat key. `letter` routes around it for generated notes; composer-entered notes keep
  the old path and the old bug.
- **A `NaN` in `ProgressionDoc.revision` would poison the allocator permanently**, since
  `Math.max` propagates it. Only reachable from a corrupt document, and there is no
  loader yet — but there will be.
- **`ProgressionDoc` has no rename path at all.** Several decisions in M4 turn on the
  track's name and the marker's copy diverging, and neither can move today. Whatever
  adds a rename must write a resolved label through to `GeneratedOrigin.progressionName`
  via the exported `progressionLabel` — `revision` does not move on a rename, so a stale
  copy there would not even read as stale.
- **Seven files still cite a "500-line guideline"** in their headers; `CLAUDE.md` raised
  it to 1000 on 2026-09-09. One was fixed in passing; the rest want a sweep.
- **`((x % 12) + 12) % 12` is written about seven more times** across
  `progression-harmony.ts`, `progression-parse.ts`, `progression-generate.ts`,
  `progression-voicing.ts`, `piano-roll-view.ts`, `note-naming.ts` and
  `review-controls.ts`. `reduceToOctave` is exported from `note-spelling.ts` and the
  spelling cluster now uses it; the rest is a separate sweep.
- **Clicking a generated notation staff still auditions the note** it will refuse to
  write. Arguably right — audition-on-read — but unconsidered rather than chosen.

## Next milestone, when there is one

The design doc's "Not in M4" names the one that unlocks the others: **a progression
library**. It would give `GeneratedOrigin.progressionId` a far end worth persisting,
make the `'foreign'` state in the tracks panel reachable (it is coded and specced but
cannot occur today), and turn "more than one generated track" from a curiosity into a
case with a name.
