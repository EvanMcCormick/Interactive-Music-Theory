# Composer Editor Redesign

**Date:** 2026-09-13
**Status:** Designed; M1 planned in [2026-09-13-composer-editor-m1.md](2026-09-13-composer-editor-m1.md)
**Replaces:** the "Still outstanding" list in
[2026-09-04-sheet-music-composer-design.md](2026-09-04-sheet-music-composer-design.md)

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

**The mapper loses data.** Saving stores alphaTex made from the mapper's output, so
a mapper gap is permanent loss:

| Field | What happens |
|---|---|
| `isHammerPullOrigin`, `bendPoints` | Neither written nor read |
| `BeatEffectsDoc.fadeIn` | Neither written nor read |
| `BeatEffectsDoc.isStaccato` | Nowhere to go: alphaTab's `Beat` has no staccato, only `Note.isStaccato`. Removed from the model in M1 |
| `slide` | Written, never read back - gone after a reload |
| `MasterBarDoc.isDoubleBar` | Read, never written |
| `accidental: 'explicit'` | Always `ForceSharp`, so a forced flat returns as a sharp |
| Tempo | Probable: `toDoc` fills `masterBars[0].tempoAutomation`, which `toMasterBar` prefers over `doc.tempo`, so after a load the BPM field may stop changing playback. Read, not reproduced |

**Bars do not fill.** New bars are rests to the meter, and nothing afterwards keeps
them so. Lengthening a beat overfills its bar; shortening leaves a hole; neither is
reported.

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
   hand).
4. **Selection: ranges, like Guitar Pro.** Click, shift-click, drag; note tools act
   on a focused note in a chord. Rejected: caret only, and tools as sticky input
   modes.
5. **Note entry on notation: a Select / Pen toggle.** Only Pen writes on a notation
   click. Rejected: keyboard-only pitch entry (loses mouse entry), and today's
   click-writes with shift to select (a click meant to select writes a note).

And one that was proposed and accepted without a question: **a shortcut for every
tool**, following Guitar Pro's bindings where they are unambiguous.

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
| **M2** | Palette, Select / Pen, the tool table and every shortcut, the new page grid | The editor |
| **M3** | Inspector and track strip: tuning presets (a real bass tuning), capo, transpose, staff views, mixer | Track setup |
| **M4** | Tools that need their own editor: bend curve, custom tuplet, trill speed | The long tail |

M2 can ship its palette with bend, tuplet and trill applying fixed defaults (a full
bend, a triplet, a 16th trill); M4 replaces the defaults with editors.

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
transport loops.

**Commands are edit functions** of a draft document and the selection, free of service
state, in four modules: `beat-edits`, `note-edits`, `bar-edits`, `track-edits`. They
change the draft `commit()` hands them rather than returning a copy - `commit()` has
already cloned, and a second clone would buy nothing. The service wraps each call in a
single `commit()`, so one press over a forty-beat range is one undo.

**Toggles on a mixed range.** If any target lacks the effect, the press turns it on
for all; if all have it, the press turns it off. A button therefore has three states -
on, off, mixed - read from a pure `toolStates(doc, selection)`. The rule never
depends on which end of the selection was clicked first, and the button shows what a
press will do before it is pressed.

**Refusals are whole.** A selection touching a progression-generated track refuses the
entire command with a status message; nothing is applied to half a range. The
existing note and beat commands already refuse generated tracks, and this extends
that gate to every family. A note tool on a rest refuses the same way.

**Bar filling in the flow.** A duration change fills the affected bars' gaps with
rests inside the same commit. Overflow is never resolved automatically: a pure
`barStatus(doc)` reports each bar as full or over by how much, and the track strip
and score overlay read it. **Fix bar** is its own command on the selected bars: it
splits the overflowing beat at the bar line, ties the remainder into the next bar,
and appends a bar only when the carry runs off the end of the score.

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
ending, tuplet - open a small popover anchored to their button, not a modal.

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
techniques (bend, slide, tap, harmonics) on a pitched staff. Refusals, Fix bar
outcomes and paste results share one polite live region.

**Popover values** are validated before anything commits: time signature numerator 1
to 32 and denominator a power of two up to 32; key signature -7 to +7, major or minor;
tempo keeps the existing 20 to 400 clamp; a section needs a name. An invalid entry is
refused inline.

**Saving an overflowing bar is allowed**, with a status warning naming how many bars
are over. A linked progression track stays a refusal because it loses data; an
overflowing bar does not - alphaTex stores and renders it.

**Paste** writes from the caret for the copied length and then fills gaps. Overflow is
flagged, never pushed on.

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

Matching: unmodified symbols match on `KeyboardEvent.key`; combinations with Alt or
Ctrl match on `KeyboardEvent.code`, because macOS Option rewrites `key` (Option+- is
an en dash). Keys marked † produce a symbol through Shift and need the non-US layout
hand check.

**macOS is open.** Two things the table does not settle yet, both for M2 to decide
with a Mac in front of it: Mac keyboards have no Insert key, so insert beat, section,
insert bar and add track each need a second binding; and if Ctrl is read as Cmd,
Play from start becomes Cmd+Space, which is Spotlight.

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
| | Extend selection | Shift+← → ↑ ↓ | new |
| | First / last beat of bar | Home / End | new |
| | Previous / next bar | Ctrl+← / Ctrl+→ | Tux |
| | First / last bar | Ctrl+Home / Ctrl+End | GP |
| | Previous / next track | Ctrl+Shift+↑ / Ctrl+Shift+↓ | Tux |
| Playback | Play / pause | Space | today |
| | Play from start | Ctrl+Space | GP |
| Beats | Fret | 0-9 | today |
| | Rest | R | today, GP |
| | Clear beat to rest | Delete, Backspace | today |
| | Insert beat | Insert | GP |
| | Delete beats | Shift+Delete | GP |
| Duration | Shorter / longer | + or = / - | today, GP, Tux |
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
| | Section… | Shift+Insert | GP, Tux |
| | Double bar | Shift+B | new |
| | Triplet feel… | Ctrl+/ | GP |
| | Free time | \| † | GP |
| | Fix bar | F4 | GP's "check bar durations" |
| | Insert / delete bar | Ctrl+Insert / Ctrl+Delete | GP |
| Tracks | Add track | Ctrl+Shift+Insert | GP, Tux |
| | Delete track | Ctrl+Shift+Backspace | new (Ctrl+Shift+Delete is the browser's) |
| Accidentals | Flat / sharp | Alt+- / Alt+= | new |
| | Natural | Alt+0 | new |
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
- **`KEY_SIGNATURES` in the mapper** lists major keys only and omits ±7. The key
  signature popover needs all fifteen, major and minor.
- **Sidebar clipping.** A user saw headings lose their first letter ("RACKS", "ARS",
  "IBRARY") at about 1870px. Not reproduced on an empty score; consistent with the
  panel scrolled sideways, which its styles permit. The M2 grid removes the panel.
- **Before the first click, the caret box is not drawn** - it needs a click to learn
  which staff it is on - so arrow keys move an invisible caret. The selection
  highlight in M2 draws from state rather than from the last click.
- **A hammer-on or a shift or legato slide with nothing to land on does not save.**
  alphaTab's `Note.finish` clears `isHammerPullOrigin` when no note follows on the same
  string, or on another string as a left-hand tap, within three bars, and resets a shift
  or legato slide when no note follows on its string - so the editor can show a
  technique that a reload loses. M1 pins both losses in
  `score-doc-mapper.effects.spec.ts`. M2 decides what the hammer-on and slide tools do:
  refuse where there is nothing to land on, or allow it and say so.
- **Four slide types have no name in the model.** In from above, out down, and pick
  slides down and up read back as no slide, so alphaTex applied from the source panel
  loses them. Nothing the composer writes can produce them; widening
  `NoteEffectsDoc.slide` belongs with M2's slide tools.
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
  tie origin, and either refuse on a continuation or write to the origin.
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
  was, and the interval silently changes. M2's pitch tools and M3's capo and tuning
  controls must move it with the note.
- **A fermata spreads to later tracks and voices at the same tick.** alphaTab keeps
  fermatas per bar and tick (`Voice.finish` ~3294, `MasterBar.getFermata` ~2728): a
  fermata on one track appears on every later track's beat at that tick, on screen at once
  and in the saved file, while an earlier track is untouched - so clearing the original
  leaves the copies. M1 pins it. M2's fermata tool decides whether a fermata belongs to a
  beat or to a bar and tick; the latter matches alphaTab and Guitar Pro and would make the
  spread correct rather than surprising.
