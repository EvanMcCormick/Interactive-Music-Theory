# Composer Editor Redesign

**Date:** 2026-09-13
**Status:** M1 implemented, to [2026-09-13-composer-editor-m1.md](2026-09-13-composer-editor-m1.md); M2 planned, to [2026-09-13-composer-editor-m2.md](2026-09-13-composer-editor-m2.md), with its decisions under "M2 decisions" below
**Replaces:** the "Still outstanding" list in
[2026-09-04-sheet-music-composer-design.md](2026-09-04-sheet-music-composer-design.md)

**M1 hand check, 2026-09-13: passed.** In the browser, reading the regenerated alphaTex:
shortening beat 1 of an empty 4/4 bar to an eighth gave `r8 r8 r4 r4 r4`; lengthening the
first of four notes to a half overwrote nothing, left the bar over, and kept its hammer-on;
that hammer-on survived a library save, a page reload and a load; and the BPM field changed
the tempo of the loaded score. Range selection, Fix bar and the bar and track commands have
no control until M2, so they were not checked by hand and rest on their specs. The details
are under Task D6 in the plan.

The composer at `/composer` enters notes, durations, a single dot and rests, and very
little else. This design turns it into an editor in the manner of Guitar Pro and
TuxGuitar: every notation tool in a side palette, a keyboard shortcut for each, a
selection that tools act on, and bars that keep themselves honest.

It started from a manual test that could not be performed: there is no way to set a
time signature in the composer, so a 3/4 score could not be made to check the
`insertBar(0)` fix (a7f61ba). The only route today is the alphaTex panel.

---

## What the composer actually has

The original design says the outstanding features need "only the UI controls". An
inventory of the model, service, mapper and component on 2026-09-13 found that untrue
in three ways, and the redesign is shaped by all three.

**No commands.** Apart from note entry, duration, dot, rest, tempo, title, tracks,
appending and removing bars, and the progression track commands, nothing in the model
has a service command. Time and key signature, clef, repeats, endings, sections,
triplet feel, tuplets, dynamics, every note effect, tuning, capo, transpose, staff
views and the mixer are fields on `ScoreDoc` that nothing writes.
*After M1:* each has a command on `ComposerService` - beat and note effect toggles, accidental,
tie, grace, dynamics, tuplet, time and key signature, clef, the repeat, double bar and free-time
flags, repeat count, endings, triplet feel, section, tuning, capo, transpose, staff views,
playback and rename - and nothing in the page calls them yet. M2 and M3 give them controls.

**The mapper loses data.** Saving stores alphaTex made from the mapper's output, so
a mapper gap is permanent loss:

| Field | What happens | After M1 |
|---|---|---|
| `isHammerPullOrigin`, `bendPoints` | Neither written nor read | Fixed: both round-trip. alphaTab still clears a hammer-on with nothing to land on, and stores a bend in Guitar Pro's shapes - both pinned, see "Found while designing" |
| `BeatEffectsDoc.fadeIn` | Neither written nor read | Fixed |
| `BeatEffectsDoc.isStaccato` | Nowhere to go: alphaTab's `Beat` has no staccato, only `Note.isStaccato` | Removed from the model; staccato is a note effect |
| `slide` | Written, never read back - gone after a reload | Fixed for every slide the model names. alphaTab still clears a shift or legato slide with nothing to land on - pinned |
| `MasterBarDoc.isDoubleBar` | Read, never written | Written to alphaTab, so it draws. **Still lost through alphaTex**: alphaTab 1.8.0 does not export `\db`. Pinned as the upstream loss |
| `accidental: 'explicit'` | Always `ForceSharp`, so a forced flat returns as a sharp | Fixed: `AccidentalMode` names the accidental it forces - double flat, flat, sharp, double sharp - and each round-trips. A pre-bent note still loses it to alphaTab - pinned |
| Tempo | Probable: `toDoc` fills `masterBars[0].tempoAutomation`, which `toMasterBar` prefers over `doc.tempo`, so after a load the BPM field may stop changing playback. Read, not reproduced | Fixed: bar 1's tempo loads into `doc.tempo` alone, and the field wins over a bar 1 automation. Confirmed by hand |

Alongside the fixes M1 added the fields alphaTab had and the model lacked - accent, heavy
accent and tenuto; wide vibrato on a note and a beat; left-hand tap; trill; fingering for both
hands; fermata; crescendo and decrescendo; pick stroke - each with its own round-trip spec in
`score-doc-mapper.effects.spec.ts`.

**Bars do not fill.** New bars are rests to the meter, and nothing afterwards keeps
them so. Lengthening a beat overfills its bar; shortening leaves a hole; neither is
reported. *After M1:* a length change fills gaps and takes following rests, overflow is
measured by `scoreBarFills` and left for Fix bar, and today's duration, note and rest buttons
already go through it - Part 2 says how.

Smaller things found on the way are listed at the end.

### alphaTex is not the problem

Because persistence is alphaTex, the first question was whether alphaTab 1.8.0's own
importer and exporter keep the effects at all. A round trip - import, export, import,
comparing properties rather than text - was run in Node against the installed
package:

| Kept | Lost |
|---|---|
| Tempo, capo, time signature and a mid-score change, key signature, repeat open and count, alternate endings, section, triplet feel, bend, hammer-on, legato and shift slide, palm mute, let ring, staccato, ghost, natural harmonic, vibrato, accent, trill, tie, fade in, dynamics, tuplet, grace note, pick stroke, dead note, fermata, crescendo | **Double bar** (`\db` parses, is not exported) |

Fingering was in that test but not conclusively (`lf 1` read `0` on both sides). A
second probe built the score with plain property writes, the way the mapper does, and
settled it: fingering, tenuto, trill value and speed, fermata type and length,
decrescendo, pick stroke, fade in, a legato slide and a two-point bend all survive, and
`Score.finish` derives the bend type and the hammer-on destination by itself. Setting
the field is enough; the mapper never computes alphaTab's derived state.

So every loss in the table above is ours to fix, and one - the double bar - is
alphaTab's. Persistence stays alphaTex.

A syntax note that cost a run: in alphaTex 1.8 **note** properties sit after the string
(`3.3{h}.4`) and **beat** properties after the duration (`3.3.4{f}`). `3.3.4{h}` is
"Unrecognized property 'h'".

---

## Decisions

Five choices were put to the user; each records what was rejected.

1. **Scope: everything.** Song structure, rhythm, techniques and track setup, all
   reachable. Milestones set the *order*, not what is left out.
2. **Layout: Guitar Pro.** Left palette, right inspector, bottom track strip.
   Rejected: TuxGuitar's single labelled panel with track setup in dialogs (more
   clicks for the settings used most), and a top ribbon (tools split across tabs).
3. **Bar filling: fill gaps, flag overflow.** Shortening fills with rests. Lengthening
   consumes only following rests. Anything that would overwrite a note or cross the
   bar line leaves the bar red with a **Fix bar** command. Rejected: fully automatic
   (a slip overwrites earlier notes) and free-with-a-warning (every bar tidied by
   hand). Gap rests go where the gap opened, so the beats after it keep their places, as
   Guitar Pro writes them: after a beat that shrank, after a beat that grew by taking a
   longer rest than it needed, and after what Fix bar carried. A meter change, and any gap
   with no spellable position of its own - a tuplet's remainder, a bar that arrived short -
   fills at the end of the bar. Bars are measured as alphaTab lays them out. Grace beats take no room, so
   making or unmaking a grace settles the bar like any length change, and lengthening
   stops at a grace or a rest a grace leads into. A lone whole rest fills a bar in any
   meter. A free-time bar is never filled or trimmed; taking a bar out of free time fits
   it to its meter.
4. **Selection: ranges, like Guitar Pro.** Click, shift-click, drag; note tools act
   on a focused note in a chord. Rejected: caret only, and tools as sticky input
   modes.
5. **Note entry on notation: a Select / Pen toggle.** Only Pen writes on a notation
   click. Rejected: keyboard-only pitch entry (loses mouse entry), and today's
   click-writes with shift to select (a click meant to select writes a note).

And one that was proposed and accepted without a question: **a shortcut for every
tool**, following Guitar Pro's bindings where they are unambiguous.

## M2 decisions

Settled on 2026-09-13 while planning M2. The first three were put to the user; the rest were
decided in planning. Where the code or alphaTab disagreed with a decision as first written, the
decision below is the corrected one, and the M2 plan says what changed under "Where this plan
departs from the design".

1. **A hammer-on, or a shift or legato slide, with nothing to land on is refused**, with a reason,
   where alphaTab would drop it. A range puts it on the notes that can land and skips the rest,
   refusing only when none can. The rule is alphaTab's as measured: the note to land on must be
   later in the bar or on the next bar's first beat - not within three bars, as
   `Note.nextNoteOnSameLine` is written, because a later bar's beats are not yet chained when a
   note finishes. A pitched note never lands, since alphaTab files only stringed notes by string.
2. **A fermata belongs to a bar position across all tracks**, as in alphaTab and Guitar Pro. A
   press sets it on every staff's voice-1 beat that starts at that tick in that bar, on every track
   but a generated one, and a second press clears them all; the button reads all of them. M1's
   pinned spread specs now pin the rule. A grace at the position is one of its beats - alphaTab plays it
   at that tick and hands it the fermata - so it is written and cleared with the beat it leads into, and
   the toggle reads the beats that are not graces. A grace alone has no position, and a press on one is
   refused. *Settled in review:* a beat that becomes a grace leaves its fermata at its position. The first
   ordinary beat now starting there on that staff takes it, usually the rest that fills the gap. The grace
   takes the fermata of the position it now leads into, or none. A pasted grace takes that position's
   fermata too. alphaTab files a beat's fermata at the tick it finishes the beat at, and it finishes a grace
   at the tick of the beat it leads into. So a grace keeping the fermata, or handing it to the beat it leads
   into, would move it one position on, to every track, on save. *Settled in a third review:* **a fermata stays
   at its bar position through every edit that moves beats** - a note value, dots, a tuplet, a grace, note or
   rest entry, insert beat, delete beats, paste and Fix bar. Whatever starts at a position afterwards takes its
   fermata, on every staff, and a beat that moved away gives it up. A fermata whose position no beat starts at
   any more, on any staff, is dropped, since alphaTab could only file it at some other beat's tick. Before, an
   edit on an early track moved a fermata to a tick where a later track took it too on save. *Settled in a fourth
   review:* **a position is the tick a beat plays at**, where alphaTab files its fermata - not where it is drawn. A
   beat that on-beat graces lead into plays after them, and each grace plays at its own tick and takes that tick's
   fermata. **A fermata goes with its note** when the note moves and that reaches no other beat: nothing on another
   staff, or in another voice, still holds it at the old tick; nothing plays at the new one; and the new position
   holds no fermata. Otherwise it stays at its position, as above, and where it can do neither it is removed and the
   commit says so in the status line - "1 fermata removed: its note moved where it would reach other tracks." A new
   track takes every position's fermata where its rests start, and a removed track takes a fermata only it held away
   with it.
3. **M2 brings a minimal track strip forward**: a row per track with its name, remove, and the
   progression badge, status, Update and Flatten; add track with an instrument; and "Add
   progression track", keeping every selector and label the M4 specs pin, which move with the
   markup. Library and Export move into top-bar menus, with the saved list in a drawer. Mixer, bar
   grid and inspector stay M3.
4. **`+` and `=` are longer, `-` shorter** - today's direction. The shortcut table below had them
   the other way round and is corrected.
5. **Escape.** With the circle-of-fifths drawer open, Escape closes it and the composer ignores it;
   with the drawer closed, Escape is back to Select and clear the range. The shell claims the key
   (`preventDefault`) only when it closes the drawer, and the composer ignores a claimed press. A
   shared "drawer open" flag would not work: the shell's listener runs first, so the flag would read
   closed by the time the composer asked. The shell listens in the capture phase, so it does run first
   whatever order the listeners were added in.
6. **Modifiers match exactly.** Ctrl, Alt or Cmd with a digit writes no fret and is left to the
   browser; Ctrl or Shift with an arrow does its own table meaning; undo rejects Alt (AltGr on
   Windows); `r` and `R` both rest; form fields include `contentEditable`, through one helper shared
   with the progression page. One refinement: a symbol typed through AltGr or Option still matches,
   but only after every exact binding has failed, so `}` and `[` are reachable on German keyboards. And a
   Ctrl binding on a symbol key also matches that symbol typed on another key, so Dvorak reaches Ctrl+/ and
   Ctrl+Shift+.; a letter typed on the key stays that letter's. *Settled in a fourth review:* the symbol is asked only
   once no binding's own key matched, so AZERTY's Ctrl+Shift on the comma key, which types `.`, is crescendo alone.
7. **A two-digit fret is one undo step.** The second digit replaces the first digit's commit when
   nothing was committed in between.
8. **Refusals are displayed** in one polite live region, in the status line, which shows a failed
   alphaTex apply too. A refusal clears on a caret move, a selection change, undo and redo, as well
   as on the next edit. A duration press publishes its refusal; on a generated track it still
   remembers the input duration, and now also says why the beat did not change. Fix bar and paste say
   what they did in the same region (`ComposerState.notice`, cleared as a refusal is), as Part 4 asks,
   and the status line counts the bars over their time signature on a plain line outside the region, so
   ordinary duration edits are not announced. The alphaTex panel's message goes when the panel closes. *Settled in review:* each refusal or notice published is a
   new message (`ComposerState.messageId`), so the same words said twice are read out twice; and a typed fret or rest
   that removes a fermata says so, since entry moves the caret on in the commit that writes.
9. **A whole tuplet group's freed room goes after the group**, fixed before the tuplet tool:
   `n8 n8 n8 n8 n2` with its first three beats made a triplet keeps the fourth eighth at 1440. Room is held
   until alphaTab would close the group, even past the pressed beats, so no rest splits one. *Settled in
   review:* **a tuplet press that would leave a group incomplete is refused**, with a reason: "A 6:4 tuplet
   needs six beats of the same value, or values that add up to the same length, in one bar." alphaTab closes
   a group of equal values at the tuplet's numerator, and a mixed one when its values fill a whole group. The
   room an open group's beats free is off the 64th grid, so the bar would stay short with nothing to say why.
   The Triplet button shows the refusal before it is pressed. *Settled in a third review:* **no edit may leave a
   tuplet group open** that its voice did not already hold open: a tuplet press or clear, a note value, dots,
   grace before or on the beat, note or rest entry, insert beat, delete beats and paste. Each is refused before
   anything changes, with a reason - "That would break a tuplet group; select the whole group." for most, and
   for a tuplet press one that names the unfinished group it would join or the closed one it would split. The
   whole voice is read, since an edit can break a group beside the beats it names, and the note value, dot,
   Triplet and grace buttons show the refusal before they are pressed. A tuplet is never set on a grace, which
   alphaTab would count into its group. *Settled in a fourth review:* **Fix bar refuses to split a tuplet group** -
   one the bar line falls inside, which would leave both parts unfinished - and says why. The edit that overfilled
   the bar stays accepted, since Guitar Pro flags overflow and leaves the fix to the user. **Typing a fret or R over a
   beat in a closed tuplet group keeps the beat's value** where the palette's would break the group, as Guitar Pro
   keeps a beat's value; the palette keeps its choice for the next note, and the value buttons show the caret's beat.
   **A grace that carries a tuplet in a loaded file keeps it.** Stripping it on load was considered and not done:
   alphaTab groups the beats after such a grace differently without it, so it is recorded rather than normalised.
   *Settled in review of the committed M2 code:* **a beat made a grace loses its tuplet** in the same edit, and the
   open-group rule then judges what is left. A grace carrying a tuplet starts a group alphaTab never closes on a
   written value, and a bar's leading one is joined to the group the bar before ends in, which a one-bar reading
   cannot see. So a whole group made graces goes through with no group left, and part of a group is refused as
   breaking it. Only a loaded file gives a grace a tuplet.
10. **Natural clears a forced accidental** (`auto`), because alphaTab 1.8 draws `ForceNatural` as
    `Default`, and its label says so.
11. **Respell** cycles a pitched note's letter through every spelling `forcedLetterOf` allows for its
    drawn pitch class, and a fretted note's forced accidental between the sharp and the flat of a
    black key. A fretted white key has nothing to cycle and is refused with a reason, as is a fretted
    natural harmonic; a range respells what it can.
12. **Palm mute and let ring are note-level tools.**
13. **Vibrato is note-level.** Its button reads a tied note's vibrato from the note it is tied from,
    and a press on tied notes alone is refused: "Vibrato on a tied note belongs to the note it is tied
    from." A range skips its tied continuations, as a hammer-on skips notes that cannot land, so a phrase
    with a tie in it takes vibrato; a clear there also takes a continuation's own stale vibrato.
14. **A duration press on nothing but grace beats is refused**, since alphaTab sets a grace's value;
    a range with some graces keeps skipping them.
15. **A press that clears a fretted-only technique is allowed on a pitched staff**; only turning one
    on is refused. Made general in planning: every fretted-only note technique, not only the harmonic.
16. **Defaults until M4's editors**: a full bend of two points, `[{offset:0,value:0},{offset:60,value:4}]`,
    which alphaTab keeps exactly; a trill a whole step above each note, at sixteenths; tuplets 3:2,
    5:4, 6:4 and 7:4; a medium fermata of length 1.
17. **Tools that take a value open a small anchored popover**: time signature, key signature (all
    fifteen keys, major and minor), clef, section, alternate ending, tuplet, and triplet feel.
    Validation reuses `timeSignatureFault` and `keySignatureFault`, and an invalid entry is refused
    inline. The popover is drawn in the top layer (the HTML `popover` attribute), placed beside its
    button in window coordinates: the palette scrolls, and a popover positioned inside it was clipped.
    Opening one, by button or by key, focuses its first control; closing gives focus back to the button;
    the fields are read from the selection only when the popover's kind changes; and Escape closes the
    popover alone, claimed so the composer's Escape does not also go back to Select.
18. **Commands with no service method go in new modules** - `composer-entry-commands.ts`, delegated
    like `composer-service-structure.ts`, and pure edit functions - keeping `composer.service.ts`
    under the cap: rest over a range, insert and delete beats, semitone and string moves, cut, copy
    and paste, every navigation move and its Shift form, play from start, repeat close as a toggle,
    and inserting and deleting the selected bars.
19. **Ctrl+S reaches the library panel's own save** through a small request service, so a keyboard
    save refuses, announces and returns focus exactly as a click does.
20. **The library's menus and drawer are hidden with CSS**, never `*ngIf`, and its announced regions
    sit outside them. Each closes on Escape - claimed in the capture phase, so the composer's own Escape
    does not also act - and on a click outside. A save asked for while one is writing is remembered, however
    many times, and runs once after that write lands, over the same entry - when the document has moved on since the
    write began, or it was Save as copy - so a click and Ctrl+S together make one library entry, and an edit made
    mid-save is saved rather than marked saved. Only the document a write held is marked saved. *Settled in review of
    the committed save code:* **the saves pressed mid-write are kept for the composition they were pressed for** - at
    most one Save and one Save as copy, run one at a time in the order first pressed. A plain Save runs only when the
    document moved on, and a copy is skipped after a copy of the same document, so a double click on Save as copy
    makes one copy, and Save then Save as copy puts the edit in the original and then copies it. A load drops them,
    and a write that lands after a load leaves the loaded composition current, so the next Save never writes it over
    another entry. Destroying the panel drops them too, since the page's guards are gone.
21. **macOS**: see "macOS" under Shortcuts. Nobody has checked the bindings on a Mac. Tooltips and the shortcut sheet
    write Ctrl as ⌘ and Alt as ⌥ on a Mac, and Ctrl and Alt elsewhere, from the browser's platform, read once.
22. **Score interaction.** In Select a notation click moves the caret and never writes; in Pen it
    writes the clicked pitch; digits write on tablature in both. Mouse-down sets the caret, moving
    with the button held extends the range, and Shift-click extends. The highlight is drawn from
    state with `highlightPlaybackRange` after every render; alphaTab's own interaction is turned off,
    because with it on alphaTab's mouse-up sets the playback range. Pen shows a hover notehead, and
    the caret is drawn from state before the first click. *Corrected before it was built:* turning
    alphaTab's interaction off also took away click-to-seek, so a click on a beat while playback is
    stopped moves the playback position there, setting no range. A drag ends when the button is released
    anywhere on the page, since alphaTab hears mouse-up only on its own surface. The score is engraved
    again only when the document changes - a selection or caret change redraws the highlight and caret
    alone - and Pen's hover runs outside Angular's change detection, entering it only when what it draws
    changes.
23. **The page grid** is sized to the viewport minus the app header, whose height the shell
    publishes as `--app-header-height`: a top bar, the palette, the score, a status line, and the
    track strip under a draggable separator. There is no inspector column until M3. Composer colours
    are CSS custom properties on the page host.
24. **Palette buttons are Bravura glyphs** by SMuFL code point, from `/font/Bravura.woff2`, with text
    where SMuFL has no symbol. Each has an `aria-label`, a tooltip with its shortcut, `aria-pressed`
    with `mixed`, and `aria-disabled` with the reason when refusing.
25. **The tool table's spec** checks every tool for a command, a glyph or text, a label and a group,
    and every binding - macOS alternates included - for uniqueness and against the browser's keys.
    The note values and the Select and Pen buttons have no key of their own, as the design's table
    gives them none; the spec names them.
26. **Paste writes one continuous run from the start of the selection** - its first beat in time,
    whichever end moved - keeping the spacing between the copied beats across bar lines. A beat that
    would cross a bar line is split there as Fix bar splits one, tied into the next bar, and the paste is
    refused where Fix bar refuses. A pasted fermata goes on every track at its position (decision 2).
    The range is dropped after the paste. Settled when review found paste wrote bar by bar, at the
    moving end. *Settled in a second review:* **pasting part of a tuplet group is refused** ("The copy holds
    part of a tuplet group."), since it would start a group alphaTab never closes. So is **pasting at a beat
    that starts at or past the bar line of a bar already over** ("That beat is past the bar line; Fix bar
    first."), which would write into the next bar while the caret stayed on the selected beat. A third review
   refused **pasting at a grace that ends a full bar** for the same reason, and **a paste that would split a
   tuplet group** (decision 9).
27. **A tie with nothing to tie from is refused**, with a reason, as a hammer-on with nothing to land on
    is: alphaTab looks three bars back on the string, or for the pitch, and clears a tie that finds
    nothing. A range ties the notes that can be tied.
28. **Tie chains move whole.** A semitone or string move takes every note tied to or from a note it
    moves, since alphaTab copies a tie origin's fret and pitch onto the notes tied from it. A string move
    that would break a landing, change a tie's origin or put a natural harmonic off a node is refused.
29. **Space and Enter press a focused button.** Without Ctrl, Alt or Cmd, Space or Enter on a focused
    button, link, checkbox or radio is the browser's, and the composer's keyboard is not asked - so Space
    plays only when no button has the focus. Settled when review found the keyboard would claim them.
30. **A save is refused while the alphaTex panel holds a draft that is not applied**, from Ctrl+S - which
    runs in the textarea - or the Library menu's Save, and the status line says "Apply or revert the
    alphaTex draft before saving." A save writes the document, not the draft. Settled in review.
31. **The shortcut sheet is modal.** Opening it moves the focus into it, Tab stays inside it, and closing it - its close
    button or Escape - gives the focus back, or to the score when what had it is gone. While it is open no key but its
    own and Escape reaches the score behind it, and Escape closes the sheet alone, as it closes a popover. Its note says
    keys are ignored while typing in a field except those that still run there - Ctrl+S - read from the tool table.
    Settled in review of Task 3.4. *Settled in a second review:* **it is modal to the mouse and to Ctrl keys too.** A
    backdrop covers the window and a click on it closes the sheet as Escape does, and the page behind is `inert`, so
    neither a click nor the focus reaches it; the sheet gives the focus back once the page is no longer inert. Behind
    it every Ctrl, Alt or Cmd binding but Ctrl+C and Ctrl+X is claimed and dropped, so Ctrl+K does not reach the
    browser's search box, while keys with no modifier still scroll the sheet. Opening it closes the Library panel's
    menus and drawer, so Escape reaches the sheet.

---

## Part 1: Architecture and milestones

Built bottom-up. A palette button is only as good as the command and the persistence
under it, so each layer is proven before the next leans on it.

1. **Model and mapper.** Add to the model what alphaTab has and `ScoreDoc` lacks:
   accent, heavy accent and tenuto (one field - alphaTab's `AccentuationType` makes
   them exclusive), trill, fingering, fermata, crescendo and diminuendo, wide vibrato,
   pick stroke. Fix every row of the loss table. One
   round-trip spec per field, through the mapper and alphaTex and back. The double bar
   is reported upstream and pinned as a known loss, the way the C♭ `.gp` question was
   recorded.
2. **Selection and commands.** A selection in `ComposerService`, and commands in four
   families - beat, note, bar, track - that apply to all of it.
3. **Bar filling.** A pure module: fill gaps, measure overflow, and Fix bar.
4. **Interface.** Palette, inspector, track strip, and one tool table that drives
   keys, tooltips and the shortcut sheet.

| | Delivers | Visible change |
|---|---|---|
| **M1** | Model additions, mapper fixes and round-trip specs, selection, commands, bar filling | Saving stops losing data, and today's duration buttons fill gaps and leave overflow for Fix bar |
| **M2** | Palette, Select / Pen, the tool table and every shortcut, the new page grid, and a minimal track strip | The editor |
| **After M2** | The GP Viewer page becomes the composer - see below | One page opens, plays and edits a `.gp` file |
| **M3** | Inspector, and the track strip's mixer and bar grid: tuning presets (a real bass tuning), capo, transpose, staff views, mixer | Track setup |
| **M4** | Tools that need their own editor: bend curve, custom tuplet, trill speed | The long tail |

M2 can ship its palette with bend, tuplet and trill applying fixed defaults (a full
bend, a triplet, a 16th trill); M4 replaces the defaults with editors.

### After M2: the GP Viewer becomes the composer

Decided by the user on 2026-09-13: a milestone of its own, directly after M2 and before M3. Its
tasks are not planned yet.

Opening a `.gp` file in the composer shows and plays alphaTab's own reading of the file, as the
viewer does today. The first edit converts the file to the composer's model, after a prompt
listing what that file would lose, so nothing is dropped silently. The model cannot yet hold
everything a Guitar Pro file can - multiple voices, lyric lines beyond the first, tremolo bar and
wah, chord diagrams, tempo automations beyond bar 1, and the four slide types with no name - so
the prompt has real entries. After the merge, the GP Library's Open goes to the composer and the
separate viewer route is removed.

---

## Part 2: Selection and commands

**The selection lives in state.** `EditCursor` stays, as the selection's *head*.
`ComposerState` gains `anchor: EditCursor | null` - null means no range - and a
focused note, identified by string on a fretted staff and by pitch on a pitched one.
A caret is a selection of one beat.

**What a range covers.** Within one track, every beat from anchor to head in timeline
order, across bar lines, whichever end comes first. Across tracks, a rectangle of
whole bars on every track between them - Guitar Pro's multitrack selection.

The highlight uses alphaTab's `highlightPlaybackRange(startBeat, endBeat)`, which draws
the markers without setting `playbackRange`, so selecting does not change what the
transport loops. Planning M2 found that alphaTab's own interaction undoes this: with
`player.enableUserInteraction` on, its mouse-up sets the playback range. So the composer turns
that interaction off and draws the highlight itself, after every render.

**Commands are edit functions** of a draft document and the selection, free of service
state, in four modules: `beat-edits`, `note-edits`, `bar-edits`, `track-edits`. They
change the draft `commit()` hands them rather than returning a copy - `commit()` has
already cloned, and a second clone would buy nothing. The service wraps each call in a
single `commit()`, so one press over a forty-beat range is one undo. The bar and track
commands and Fix bar sit in `composer-service-structure.ts`, which `ComposerService` delegates
to unchanged, to keep the service under the 1000-line cap; the service still owns the state,
the history and the selection.

**Toggles on a mixed range.** If any target lacks the effect, the press turns it on
for all; if all have it, the press turns it off. A button therefore has three states -
on, off, mixed - read from a pure `toolStates(doc, selection)`. The rule never
depends on which end of the selection was clicked first, and the button shows what a
press will do before it is pressed. A structured value - a fermata, a trill - counts as
the same by content, whatever order its fields were written in, since one read back through
the mapper and one a tool built can list them differently.

**Refusals are whole.** A selection touching a progression-generated track refuses the
entire command with a status message; nothing is applied to half a range. The
existing note and beat commands already refuse generated tracks, and this extends
that gate to every family. A note tool on a rest refuses the same way.

**Bar filling in the flow.** A duration change fills the affected bars' gaps with
rests inside the same commit, each where it opened and spelled from there, so the beats after
it keep their places. A beat that shrinks gets its rests right after it: an empty 4/4 bar
whose first quarter becomes an eighth is `r8 r8 r4 r4 r4`. A beat that grows takes the rests
after it, and when the last one it took was longer than it needed the spare goes back right
after it: `n4 r4 r4 r4` dotted is `n4. r8 r4 r4`. Rests never go between a grace and the beat
it leads into. A range edit settles in two passes: every beat changes first, last to first,
taking rests as it grows; then the room the shrinking beats freed fills with rests, first to
last, only while the bar is short; and growth that only a changing neighbour blocked takes the
rests after the range. So a range edit never reports overflow its new lengths do not have -
`n4 n8 n8 n2` set to quarters is four quarters, not a bar over and holding rests. Growth a
note blocks is overflow, unless room the range freed covers it, as settling one beat at a
time would: `n2 n8 n4 r8` with its first two beats set to quarters is `n4 r8 n4 n4 r8`, a full
bar, since the half gives up the room the eighth grows into. A bar that was already over keeps
exactly its overflow when a range's lengths change its total by nothing. The selection's ends follow their beats through the rests an
edit inserts, so a range of four notes made eighths still covers all four. A note tool on a
range of notes and rests applies to the notes and skips the rests, refusing only when there
are no notes at all. Overflow is never resolved automatically: a pure
`scoreBarFills(doc)` reports each bar as full, under or over by how much - `barFillAt`
reads one bar - and the track strip and score overlay read it. **Fix bar** is its own
command on the selected bars: it splits the overflowing beat at the bar line, ties the
remainder into the next bar - carrying what goes on sounding, the dynamic, palm mute, let
ring, a harmonic, beat vibrato and a crescendo, and nothing that attacks - makes room there by
taking trailing rests, putting any it took beyond the need right after what it carried, and
appends a bar only when the carry runs off the end of the score. It refuses, saying why, a
tuplet across the line, a split between 64th notes, and a meter with no room. Implementation
corrected three details of the carry. Note vibrato and a trill are not carried: alphaTab
already draws and plays a tie destination with its origin's vibrato and plays the origin's
trill through the tie, so a continuation's own trill would sound a second one. A continuation's
accidental resets to automatic, since the tie already says the pitch goes on. And what connects
the note to the next one - a hammer-on, a shift or legato slide, a slide out - moves from the
head to the last tied piece, because after the split the next note on the string is the note's
own continuation; a slide in from below stays on the head. A grace beat
takes no room, so making a beat a grace, or a grace an ordinary beat, settles the bar
in the same commit as a duration change does, and a lengthened beat stops at a grace
or a rest a grace leads into rather than take it. A bar holding only a whole rest is
full in any meter, because alphaTab draws it as a full-bar rest. A free-time bar is full
whatever it holds: nothing fills it, trims it, carries out of it, or takes its rests when
a beat in it grows. Taking a bar out of free time fits it to its meter in the same
commit, on every staff: trailing rests go while it is over, a gap fills at the end of the
bar, where a meter change opens it, and notes that no longer fit stay as overflow for Fix bar.

**Pen** writes through the same note commands. Its hover notehead is rendering only
and never touches the document.

---

## Part 3: The page and its components

**Layout.** A CSS grid sized to the viewport *minus* the app header:

```
+--------------------------- top bar ---------------------------+
| palette |               score                   | inspector   |
|         |                                       | (collapses) |
+------------------------- track strip -------------------------+
```

Today `.composer-container` is `100vh` under a 57px header, which puts the bottom
toolbar partly below the fold, and `.track-panel` declares only `overflow-y`, so its
computed `overflow-x` is `auto` and it can scroll sideways. The palette and inspector
scroll vertically with `overflow-x: hidden`. The track strip has a draggable height.

**Palette** (`composer-palette`), in group order:

| Group | Tools |
|---|---|
| Tools | Select, Pen |
| Duration | Whole to 64th, dot, double dot, triplet, tuplet, tie, rest |
| Bar | Time signature, key signature, clef, repeat open, repeat close, alternate ending, section, double bar, triplet feel, free time, Fix bar, insert bar, delete bar |
| Accidentals | Double flat, flat, natural, sharp, double sharp, respell |
| Dynamics | ppp, pp, p, mp, mf, f, ff, fff, crescendo, diminuendo |
| Articulation | Accent, heavy accent, staccato, tenuto, fermata |
| Techniques | Hammer-on / pull-off, legato slide, shift slide, bend, vibrato, wide vibrato, palm mute, let ring, natural harmonic, artificial harmonic, ghost, dead, trill, tap, left-hand tap, slap, pop, grace before, grace on beat, pick stroke down, pick stroke up, fade in |

Tools that take a value - time and key signature, clef, section name, alternate
ending, tuplet - open a small popover beside their button, not a modal. *M2:* drawn in the top
layer, since the palette scrolls and would clip it, and reachable by keyboard (decision 17).

Buttons are Bravura glyphs, from the font alphaTab already serves at `/font`, with an
`aria-label`, a tooltip that includes the shortcut, and `aria-pressed` including
`mixed`.

**The tool table.** `COMPOSER_TOOLS` declares every tool once: id, label, glyph, group,
shortcut, command. The palette, tooltips, the `?` sheet and the keyboard handler all
read it, so a key cannot drift from its button.

**Inspector** (`composer-inspector`). *Song:* title, subtitle, artist, album, tempo.
*Track:* name, instrument, tuning presets, capo, transpose, notation / tab / slash
views, colour.

**Track strip** (`composer-track-strip`). A row per track - name, mute, solo, volume,
pan - carrying the progression badge, status, Update and Flatten from today's
sidebar with the labels the M4 specs pin. Beside the rows, a bar grid: a cell per bar,
red when over, highlighted when selected; clicking a cell selects the bar.

**Top bar.** Transport as today. Library and Export become menus; the saved list opens
in a drawer.

**State** goes through `ComposerService`; no component holds document state.

**Styling.** Composer colours become CSS custom properties on the page host, as
`CLAUDE.md` asks, replacing the SCSS variables re-declared in each file today.
Lifting the keyboard handler and sidebar out takes `composer.component.ts` (801 lines)
well under the 1000-line cap.

---

## Part 4: Error handling and testing

**Refusals.** The service enforces every precondition. The button explains with
`aria-disabled` and a tooltip reason, and the command still refuses when it arrives
by another route - the M4 rule that the gate is a refusal, not a disabled button.
Cases: a selection touching a generated track; a note tool on a rest; fretted-only
techniques (bend, slide, tap, harmonics - and slap and pop, which M1 refuses with tap) on a
pitched staff; until multiple voices are designed, any edit that reaches a second voice. Refusals, Fix bar
outcomes and paste results share one polite live region.

**Popover values** are validated before anything commits: time signature numerator 1
to 32 and denominator a power of two up to 32; key signature -7 to +7, major or minor;
tempo keeps the existing 20 to 400 clamp; a section needs a name. An invalid entry is
refused inline.

**Saving an overflowing bar is allowed**, with a status warning naming how many bars
are over. A linked progression track stays a refusal because it loses data; an
overflowing bar does not - alphaTex stores and renders it. *M2:* the warning is the status
line's count of bars over, on a plain line outside the live region, so it is read on the page
but not announced on every duration edit (decision 8).

**Paste** writes from the caret for the copied length and then fills gaps, each where it
opens, as a duration change does. Overflow is flagged, never pushed on.

**Older saves need nothing.** The library stores alphaTex, not a serialised `ScoreDoc` -
`composer-library.service.ts` says so, for exactly this reason - and every load goes
through `ScoreDocMapperService.toDoc`, which constructs every field. A composition saved
before the redesign cannot come back missing a new one. The `normalizeScoreDoc` this
section first proposed was dropped while planning M1.

**Tests.**

- *Mapper:* a round-trip spec per field. The double bar is pinned as the upstream
  loss, so an alphaTab upgrade that fixes it fails a spec rather than going unnoticed.
- *Bar filling:* gaps to rests; overflow measured with dots, tuplets and 6/8; Fix bar
  ties across the bar line and appends only at the end.
- *Selection:* anchor after head, ranges across bar lines, multitrack rectangles.
- *Toggle rule:* on, off, mixed.
- *Tool table:* every tool has a command, a glyph and a shortcut no other tool uses.
- *Service:* a press over a range is one undo; a refusal on a generated track leaves
  the document byte-identical.
- *Components:* the palette reflects pressed and mixed; shortcuts are ignored while
  focus is in a form field; the track strip keeps the M4 labels.
- Not tested, per `CLAUDE.md`: visual styling and DOM layout.

**Hand checks, per milestone:** Bravura glyphs render in the palette; the page at a
narrow width; a saved score opened in real Guitar Pro; the shortcuts marked below on a
non-US keyboard layout and in Firefox.

---

## Shortcuts

### Sources and how conflicts were settled

The official Guitar Pro 8 shortcut page returned 403, as did DefKey. The list used is
[UseTheKeyboard's Guitar Pro sheet](https://usethekeyboard.com/guitar-pro/), which
names no version and collides with itself - `[` is both repeat open and palm mute,
Shift+5 both dotting and a simile mark, F6 three things. TuxGuitar's
[default shortcuts](https://www.tuxguitar.app/files/devel/desktop/help/tools_shortcuts.html)
are complete and consistent.

The rules, in order:

1. **The browser wins.** Never bound: Ctrl+N, Ctrl+T, Ctrl+W and their Shift forms,
   Ctrl+Tab, Ctrl+1 to 9 (tab switching), Alt+letter (Firefox menus), F5, F11, F12,
   Ctrl+Shift+Delete. Guitar Pro's Ctrl+T time signature, Ctrl+7/8/9 accidentals and
   Ctrl+Shift+Delete delete track move for this reason.
2. **Today's keys stay.** Arrows, fret digits, `r`, `+` / `-`, Delete, Space, Ctrl+Z.
   Unmodified digits belong to fret entry.
3. **Guitar Pro where its binding is unambiguous.**
4. **TuxGuitar where Guitar Pro collides.** Palm mute takes TuxGuitar's `P`; repeats
   keep Guitar Pro's `[` and `]`.
5. **Shift+arrows extend the selection**, as in every text editor, which moves
   TuxGuitar's string and pitch moves onto Alt.

Matching: unmodified symbols match on `KeyboardEvent.key`. A Ctrl letter matches on `key`
too: held with Ctrl a letter still reports itself there, while `code` names the key a US
keyboard has in that place, so by `code` a German Ctrl+Z (typed on the key US calls Y)
would redo and a French Ctrl+A would do nothing. It falls back to `code` only when `key` is
not a Latin letter, as on a Cyrillic layout, and an unmodified letter falls back the same
way. Alt combinations, and Ctrl combinations that are not letters, match on
`KeyboardEvent.code`, because macOS Option rewrites `key` (Option+- is an en dash). Keys
marked † produce a symbol through Shift and need the non-US layout hand check. M2's plan
settles the rest: modifiers match exactly, with Cmd read as Ctrl; a letter matches in either
case, with Shift exactly as bound; a digit or symbol matches whatever Shift says; and a symbol
typed through AltGr or Option still matches once every exact binding has failed, since `}` is
AltGr+0 on a German keyboard. A Ctrl symbol typed on another key than its binding's, as Dvorak places `.` and `/`, is
asked between the two: after every binding's own key, before AltGr and Option.

**AZERTY's digit row**, for the hand check: unshifted it types `& é " ' ( - è _ ç à`, and the
digits need Shift. Fret digits match what was typed, so Shift+5 (or the numpad) writes fret 5,
while an unshifted 5, 6 or 8 presses left-hand tap, Shorter or Tenuto. Check whether that is
bearable for a French player, or whether an unmodified digit-row key should also write its digit.

**Held keys** repeat only moves - every navigation and extend move, semitone and string moves - undo
and redo, and `+` and `-`, where holding the key means doing it again. Every other tool runs once per
press, its auto-repeat claimed and dropped: held, a toggle would flicker on and off, Ctrl+S would save
over and over, a digit would write a run of notes, and Delete would stack undo steps that change nothing.

**Clipboard and save in text.** Ctrl+C and Ctrl+X are left to the browser while text outside the
score is selected, so copying words on the page works. Ctrl+S is the composer's even from a text
field, so the browser's own Save dialog never opens on the composer - and refuses while the
alphaTex panel holds a draft that is not applied, saying why (decision 30).

**Focused buttons.** Space and Enter on a focused button, link, checkbox or radio, without Ctrl,
Alt or Cmd, press it: the composer's keyboard is not asked, so Space plays only when no button has
the focus, and Shift+Enter on a focused button presses the button rather than opening Section
(decision 29).

**macOS**, settled in M2's plan without a Mac to hand - nobody has checked these on one. Mac
keyboards have no Insert key, so each Insert binding also gets the Enter key with the same
modifiers: section Shift+Enter, insert bar Ctrl+Enter (Cmd+Return), add track Ctrl+Shift+Enter.
Insert beat, whose Insert is unmodified, gets Alt+Enter (Option+Return), because plain Enter must
still press a focused button. Enter is in no other binding of the table, and the browser's only
use of it on a page is activating the focused control. Play from start keeps Ctrl+Space and gains
Shift+Space, since Cmd+Space is Spotlight and Ctrl+Space switches input source.

The Select / Pen toggle is **Q**, not the `N` shown in the design question: `N` is
Guitar Pro's trill.

### Table

| Group | Action | Key | From |
|---|---|---|---|
| Tools | Toggle Select / Pen | Q | new |
| | Back to Select, clear range | Esc | new |
| | Shortcut sheet | ? † | new |
| Edit | Undo | Ctrl+Z | today |
| | Redo | Ctrl+Shift+Z, Ctrl+Y | today, Tux |
| | Cut / copy / paste | Ctrl+X / Ctrl+C / Ctrl+V | GP, Tux |
| | Select all in track | Ctrl+A | GP, Tux |
| | Save | Ctrl+S | GP, Tux |
| Navigation | Previous / next beat | ← / → | today |
| | Previous / next string | ↑ / ↓ | today |
| | Extend selection | Shift+← → (a beat), Shift+↑ ↓ (a track) | new |
| | First / last beat of bar | Home / End | new |
| | Previous / next bar | Ctrl+← / Ctrl+→ | Tux |
| | First / last bar | Ctrl+Home / Ctrl+End | GP |
| | Previous / next track | Ctrl+Shift+↑ / Ctrl+Shift+↓ | Tux |
| Playback | Play / pause | Space | today |
| | Play from start | Ctrl+Space, Shift+Space | GP, new (macOS) |
| Beats | Fret | 0-9 | today |
| | Rest | R, Shift+R | today, GP |
| | Clear beat to rest | Delete, Backspace | today |
| | Insert beat | Insert, Alt+Enter | GP, new (macOS) |
| | Delete beats | Shift+Delete | GP |
| Duration | Longer / shorter | + or = / - | today, GP, Tux |
| | Dot | . | new |
| | Double dot | Alt+. | new |
| | Triplet | / | GP, Tux |
| | Tuplet… | Alt+/ | new |
| | Tie | L | GP, Tux |
| Bar | Time signature… | Shift+T | new (GP's Ctrl+T is the browser's) |
| | Key signature… | Ctrl+K | GP |
| | Clef… | K | GP |
| | Repeat open / close | [ / ] | GP |
| | Alternate ending… | } † | new |
| | Section… | Shift+Insert, Shift+Enter | GP, Tux, new (macOS) |
| | Double bar | Shift+B | new |
| | Triplet feel… | Ctrl+/ | GP |
| | Free time | \| † | GP |
| | Fix bar | F4 | GP's "check bar durations" |
| | Insert / delete bar | Ctrl+Insert or Ctrl+Enter / Ctrl+Delete | GP, new (macOS) |
| Tracks | Add track | Ctrl+Shift+Insert, Ctrl+Shift+Enter | GP, Tux, new (macOS) |
| | Delete track | Ctrl+Shift+Backspace | new (Ctrl+Shift+Delete is the browser's) |
| Accidentals | Flat / sharp | Alt+- / Alt+= | new |
| | Natural (clears a forced accidental) | Alt+0 | new |
| | Double flat / double sharp | Alt+Shift+- / Alt+Shift+= | new |
| | Respell | E | Tux |
| | Semitone down / up | Alt+↓ / Alt+↑ | new |
| | Note to string below / above | Ctrl+Alt+↓ / Ctrl+Alt+↑ | new |
| Dynamics | ppp … fff | Ctrl+Shift+1 … Ctrl+Shift+8 | new |
| | Crescendo / diminuendo | Ctrl+Shift+, / Ctrl+Shift+. | new |
| Articulation | Accent | ; | GP |
| | Heavy accent | : † | GP |
| | Staccato | ! † | GP |
| | Tenuto | _ † | GP |
| | Fermata | F | GP |
| Techniques | Hammer-on / pull-off | H | GP, Tux |
| | Legato slide | S | GP, Tux |
| | Shift slide | Shift+S | new (GP's Alt+S is a Firefox menu) |
| | Bend | B | GP, Tux |
| | Vibrato / wide vibrato | V / Shift+V | GP, Tux |
| | Palm mute | P | Tux |
| | Let ring | I | GP |
| | Natural / artificial harmonic | Y / Shift+Y | GP |
| | Ghost | O | GP, Tux |
| | Dead | X | GP, Tux |
| | Trill | N | GP |
| | Tap / left-hand tap | ) † / ( † | GP |
| | Slap / pop | $ † / % † | GP / new |
| | Grace before / on beat | G / Shift+G | GP / new |
| | Pick stroke down / up | Shift+D / Shift+U | GP |
| | Fade in | < † | GP |

Pop is `%` rather than Guitar Pro's Ctrl+Shift+4, which the dynamics range uses for
`mp`. The tool-table spec checks the whole table for duplicates.

---

## Beyond M4

Not rejected - not yet placed. Each needs its own design pass:

- **Multiple voices.** The model and mapper carry voices; nothing selects or edits
  one, and Guitar Pro's Ctrl+1 to 4 are the browser's.
- Lyrics and beat text; tremolo bar and whammy; wah; brush, arpeggio and rasgueado;
  simile marks; multi-bar rests; chord diagrams; tempo automation beyond bar 1;
  looping a bar range for practice.

## Found while designing

- **The Bass instrument preset gets six guitar strings.** `createTrack` always uses
  `STANDARD_GUITAR_TUNING`; `STANDARD_BASS_TUNING` exists and is unused. M3.
- **The tempo round trip** in the loss table above. M1.
- **`updateScoreInfo` is a blind `Object.assign`** of `Partial<ScoreDoc>`, so it could
  replace `masterBars` or `tracks` and break the bar-count invariant. M1.
- **Every call to `updateScoreInfo` is an undo step.** It commits on every call, so each
  keystroke in the title field is its own undo step, and retyping an unchanged title marks
  the score dirty. Whichever milestone gives score info a real UI (M3's inspector) should
  coalesce the edits, or skip a commit that changes nothing, as `flattenTrack` already
  does by returning before it commits.
- **`KEY_SIGNATURES` in the mapper** lists major keys only and omits ±7. The key
  signature popover needs all fifteen, major and minor. *Planned in M2 (Task 3.2):
  `composer-bar-choices.ts` lists all thirty, and the mapper's list is left as it was.*
- **Sidebar clipping.** A user saw headings lose their first letter ("RACKS", "ARS",
  "IBRARY") at about 1870px. Not reproduced on an empty score; consistent with the
  panel scrolled sideways, which its styles permit. The M2 grid removes the panel.
  *Planned in M2 (Tasks 3.7 and 3.10).*
- **Before the first click, the caret box is not drawn** - it needs a click to learn
  which staff it is on - so arrow keys move an invisible caret. The selection
  highlight in M2 draws from state rather than from the last click. *Planned in M2 (Task
  4.3): the caret is drawn from state as well, before any click.*
- **A hammer-on or a shift or legato slide with nothing to land on does not save.**
  alphaTab's `Note.finish` clears `isHammerPullOrigin` when no note follows on the same
  string, or on another string as a left-hand tap, within three bars, and resets a shift
  or legato slide when no note follows on its string - so the editor can show a
  technique that a reload loses. M1 pins both losses in
  `score-doc-mapper.effects.spec.ts`. M2 decides what the hammer-on and slide tools do:
  refuse where there is nothing to land on, or allow it and say so. *Settled in M2's plan
  (Tasks 1.7 and 1.8): refused, with a reason. The reach was measured, not read: the note to
  land on must be later in the bar or on the next bar's first beat, not within three bars.
  `Note.nextNoteOnSameLine` is written to search three bars, but `Staff.finish` finishes bars
  in order and `Voice.finish` chains a bar's beats only when that bar finishes, so a note's
  walk ends at the next bar's first beat. The three-bar bound does apply backwards, to a tie's
  origin.*
- **Four slide types have no name in the model.** In from above, out down, and pick
  slides down and up read back as no slide, so alphaTex applied from the source panel
  loses them. Nothing the composer writes can produce them; widening
  `NoteEffectsDoc.slide` belongs with M2's slide tools. *Still open after M2's plan: its slide
  tools are the legato and shift slides the model already names, so nothing yet needs the other
  four. The GP Viewer milestone's conversion prompt will list them.*
- **Bends are stored in Guitar Pro's shapes, not as drawn.** alphaTab's `Note.finish`
  classifies a bend of two to four points as a standard bend type and rewrites the points
  to fit - a rising bend's middle point goes and the curve's timing with it, a bend-release
  gains a repeated middle - before anything is saved. An in-memory document keeps the
  points as written until a save and reload, so the editor can show a curve that a reload
  changes. M1 stores what alphaTab keeps and pins the rewrite. M4's bend curve editor must
  write Guitar Pro's shapes, or normalise after each edit. A pre-bend of 2 or more quarter
  tones also resets a forced accidental; M1 pins that too.
- **A tied note shows its origin's vibrato.** alphaTab draws and plays a tie destination
  with the vibrato of the note it is tied from, even when its own value is none - and a
  tied continuation written by Fix bar has none by design. So a palette that lights vibrato
  from the selected note would show it off on a note with a visible wave, and pressing it
  would write the continuation's own value, which changes nothing on screen but stops
  alphaTab carrying a bend across the tie. M2's vibrato tool should read vibrato from the
  tie origin, and either refuse on a continuation or write to the origin. *Settled in M2's
  plan (Tasks 1.8 and 2.3): the button reads the tie origin, and a press on a continuation is
  refused.*
- **A pitched note on a staff with a tuning loses its trill.** alphaTex carries a trill as
  a fret relative to the string's tuning, and a pitched note has no string, so on a staff
  that has a tuning it exports as `tr (NaN 16)` and reads back as no trill. Unreachable
  today - the composer builds pitched staves with no tuning, and the alphaTex importer
  clears a pitched staff's tuning (`applyStaffNoteKind`'s Pitched case calls
  `stringTuning.reset()`, `alphaTab.core.mjs` ~16517-16526 in 1.8, reached from
  `\tuning piano|none|voice` ~13178 or from the first pitched note on a staff ~16411) - but
  it matters if M3 lets a pitched staff carry one.
- **A trill's target does not follow its note.** `TrillDoc.value` is a pitch, so moving a
  trilled note by a fret, string, capo or tuning change leaves the trill aimed where it
  was, and the interval silently changes. *Partly corrected in M1:* the tuning and capo
  commands move every trill on the staff by how far its string moved, so M3's controls get
  that for free; a transposition moves none, because alphaTex saves a trill relative to the
  string and capo, not the transposition. M2's pitch tools must still move it with the note.
  *Planned in M2 (Task 1.12): a semitone move moves the trill with the note, and a string move
  keeps the note's pitch and so the trill's.*
  The same review made the capo command refuse a pitched staff, and the staff views command
  refuse only turning tablature *on* for one, so a loaded file that shows tablature on a
  pitched staff can still turn it off.
- **Common time is its own meter.** alphaTab draws common time as its symbol and 4/4 as
  numbers, and the mapper writes `isCommon`, so the bar edits compare it: a change from one
  to the other is a meter change, and a bar that declares one is not redundant under the
  other. Found in review of M1.
- **A fermata spreads to later tracks and voices at the same tick.** alphaTab keeps
  fermatas per bar and tick (`Voice.finish` ~3294, `MasterBar.getFermata` ~2728): a
  fermata on one track appears on every later track's beat at that tick, on screen at once
  and in the saved file, while an earlier track is untouched - so clearing the original
  leaves the copies. M1 pins it. M2's fermata tool decides whether a fermata belongs to a
  beat or to a bar and tick; the latter matches alphaTab and Guitar Pro and would make the
  spread correct rather than surprising. *Settled in M2's plan (Task 1.10): a fermata belongs
  to a bar position on every track, so the spread is the rule.*
- **A forced accidental that cannot name its pitch is drawn on the wrong line.** alphaTab
  shifts the note by the forced amount and picks the staff line from the key signature, so
  whenever the pitch minus the forced alteration is not a white key - a sharp on D, a flat
  on C, any double accidental that overshoots - the note is drawn on a line that depends
  on the key while still sounding right. The model can hold this from M1's A8 on. M1's
  accidental edit refuses it with a reason rather than falling back to `auto`. The check is
  the predicate the mapper uses to find a note's letter, `forcedLetterOf`, but not asked of
  the same pitch: the mapper reads a pitched note's letter from its stored pitch class, with
  no transposition applied, and the refusal checks the pitch as drawn, transposition and
  display transposition included. They agree whenever a staff's transpositions come to a
  whole number of octaves. A forced accidental on a natural harmonic is refused outright:
  the mapper writes `harmonicType` and not `harmonicValue`, so alphaTab draws a natural
  harmonic at its open string's pitch, not its fret's.
- **A grace beat's written value is alphaTab's, not the user's.** `Beat.finish`
  (`alphaTab.core.mjs` ~7772-7786 in 1.8) rewrites an on-beat or before-beat grace's
  `duration` by the size of its grace group - an eighth for one grace, a sixteenth for two,
  a thirty-second for three or more - when the score is finished, so before anything is
  saved. A lone on-beat grace written as a half, quarter, sixteenth or thirty-second comes
  back from `toScore` as an eighth, and alphaTex exports it as one (`3.1.8{gr onbeat}`). A
  duration the user sets on a grace does not survive a save. Adjacent before-beat and
  on-beat graces merge into one group (`Voice.finish` groups every run of non-`None` grace
  types, ~3200-3216) and are revalued together by that group's size. A bend grace is not
  rewritten: `Beat.finish` revalues only on-beat and before-beat graces. M1 skips grace beats
  when setting durations (`setBeatDurations`). M2's grace tool should either fix the grace's
  value to alphaTab's rule or refuse a duration edit on a grace. *Settled in M2's plan (Task
  1.4): a duration press on nothing but graces is refused, saying why; a range skips them.*
- **Palm mute and let ring stay allowed on a pitched staff.** Part 4 names bend, slide, tap
  and harmonics as the fretted-only techniques, and alphaTab draws both marks from their flags
  alone, with no string needed (`PalmMuteEffectInfo` reads `note.isPalmMute`,
  `LetRingEffectInfo` reads `beat.isLetRing`, `alphaTab.core.mjs` ~60249 and ~59704 in 1.8).
  M1 refuses tap, slap and pop on a pitched staff, and nothing else at beat level.
- **A tuning, capo or transposition change can leave a forced accidental unspellable.** The
  accidental refusal reads the pitch as drawn - tuning, capo, transposition and display
  transposition included - but only when the accidental is pressed. A later change to any of
  those moves the drawn pitch under an accidental that stays, and can put the note on a line
  chosen by the key signature. M1 does not check. M3's track controls should count the notes a
  change would affect, the way the save warning counts bars over, and say so.
- **A pitched note imported as a natural harmonic cannot be cleared with the harmonic tool.**
  The harmonic is fretted-only, so the refusal meets the press that would turn it off as well as
  one that would turn it on. An alphaTex import can produce such a note. M2's harmonic tool
  should let a press that clears the harmonic through. *Planned in M2 (Task 1.8), for every
  fretted-only note technique.*
- **Fix bar into a bar that was already short puts the fill after the carried beats.** The
  carry's spare room opens right after what it carried, and Fix bar fills the bar's whole
  shortfall there. A bar that arrived short had part of that gap at its end, so its own beats
  move later than they were written. Recorded, not changed in M1.
- **A selection's tick-bounded end takes a whole grace run.** When a range's ends are in
  different voices, an end in the other voice bounds the range by its start tick, and a grace
  starts at the tick of the beat it leads into. So at the earlier end every grace in a run at
  that tick is taken with its beat, and at the later end the beat the run leads into is taken
  too. No edit reaches it in M1, which refuses a second voice; multiple voices must decide it.
- **Rests that could merge are left unmerged.** A duration change puts the rests for a gap where
  the gap opened, and the rests already in the bar keep their places, so two rests that could be
  written as one stay two: `n8 n2 r4 r8` with its first two beats set to quarters is
  `n4 n4 r8 r4 r8`, not `n4 n4 r4. r8`. The beats after the edit keep their ticks, which is what
  the rule is for. M2 may merge them. *M2's plan does not.*
- **Redo does not restore a followed selection.** An edit that commits through
  `commitFollowing` moves the selection's ends onto the beats they named, but undo and redo only
  clamp whatever selection is current into the document they restore. So after undo then redo,
  a range made shorter no longer covers its notes, as it did straight after the edit. Recorded,
  not changed in M1, nor in M2's plan.
- **With `player.enableUserInteraction` on, alphaTab's own mouse-up sets the playback range**
  (`_onBeatMouseUp` calls `applyPlaybackRangeFromHighlight`, `alphaTab.core.mjs` ~53124 in 1.8), so
  a drag across the score changed what the transport played. M2's plan turns alphaTab's interaction
  off and draws the highlight itself (Task 4.3). Found while planning M2. *Found in review of the plan:*
  the same code path is how a click set the playback position (`tickPosition`, ~53330), so turning it
  off lost click-to-seek, which M2 restores without a range; and alphaTab listens for mouse-up only on
  its own surface, so a button released outside the score left its beat mouse-move firing.
- **A hammer-on's or slide's landing is checked only when the tool is pressed.** M2 refuses a
  hammer-on or a shift or legato slide with nothing to land on, and a string move that would strand
  one, but nothing re-checks a landing afterwards: deleting beats, a cut, a string move elsewhere in
  the bar, an insert that pushes the landing past the next bar's first beat, or a rest over a range can
  still leave one with nothing to land on. The palette still shows it, and alphaTab drops it on save.
  Recorded in review of the M2 plan; not changed in M2.
- **`removeBar(0)` turned a 3/4 score into 4/4**, the fault M1 fixed for `insertBar(0)`: the new bar 1
  declared nothing. M2's plan removes bars through `deleteBars`, which keeps the meter (Task 1.15).
  Found while planning M2.
- **The shell's Escape closed the circle-of-fifths drawer without saying so**, so a page could not
  tell an Escape the shell had used from one it had not. M2's plan has the shell claim Escape only
  when it closes the drawer (Task 2.7). Found while planning M2.
