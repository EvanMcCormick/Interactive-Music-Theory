# Composer Editor M2: The Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Put every M1 command within reach: a palette of Bravura-glyph tools, the Select / Pen toggle,
one tool table driving buttons, tooltips, a `?` shortcut sheet and the keyboard, every shortcut in the
design's table, refusals shown and announced, and a page grid of top bar, palette, score, status line and
a minimal track strip.

**Architecture:** Per the design in [2026-09-13-composer-editor-design.md](2026-09-13-composer-editor-design.md),
whose "M2 decisions" section this plan implements. Phase 1 adds the missing commands as pure edit
functions, delegated from `ComposerService` through new command modules, and fixes the tuplet placement
and refusal bugs first. Phase 2 declares every tool once in `COMPOSER_TOOLS`, reads what each button shows
from `toolStates`, and matches keys exactly in `ComposerKeyHandler`. Phase 3 builds the components and the
page grid. Phase 4 gives the score Select and Pen, drag selection, a highlight drawn from state, Pen's
hover notehead and a caret drawn before the first click. Phase 5 records what shipped and checks by hand
what the headless suite cannot see.

**Tech Stack:** Angular 21 standalone, TypeScript 5.9 strict, RxJS 7.8, alphaTab 1.8.0, Jasmine/Karma.

---

## Before you start

**Worktree.** Everything happens in `.worktrees/composer-editor-m2` on `feature/composer-editor-m2`,
from `e726b51`. Baseline on creation: **2,677 specs, 0 failures**, in 61 seconds.

**Running one spec file** (from `client/`):

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/beat-edits.spec.ts
```

**Running everything** (from `client/`):

```bash
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAILED|TOTAL|error TS" | tail -20
```

**Type-checking** (from `client/`): `npx tsc -p tsconfig.app.json --noEmit`, then
`npx tsc -p tsconfig.spec.json --noEmit`. Run both: the app config excludes specs.

**Commits.** `<type>: <description>`, and every message ends with a blank line and
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, passed as a second `-m`. Never commit
`client/yarn.lock`.

**House style.** Read `CLAUDE.md`: pure derivations are named for what they return; comments explain why,
generously; 1000 lines per file at most; standalone OnPush components; `takeUntil` for subscriptions; CSS
custom properties for theming, in component-scoped styles.

**How the code blocks are marked.** Every block that changes a file is preceded by an HTML comment the
rendered plan hides: `<!-- apply: create PATH -->` (write the whole file), `<!-- apply: append PATH -->`,
`<!-- apply: find PATH -->` followed by `<!-- apply: replace PATH -->` (exact text, which occurs exactly
once), and `<!-- apply: move FROM TO -->`. Read them as instructions; they are also what the proof below
applied mechanically.

### The proof

This plan's code was applied, task by task and in order, from a clean `e726b51` by a script reading those
markers - every block, and nothing else - and checked at each phase boundary:

| Through | Type checks | Whole suite |
|---|---|---|
| Phase 1 (Task 1.16) | both clean | **2,798 SUCCESS** |
| Phase 2 (Task 2.8) | both clean | **2,853 SUCCESS** |
| Phase 3 (Task 3.11) | both clean | **2,896 SUCCESS** |
| Phase 4 (Task 4.4) | both clean | **2,908 SUCCESS** |

The expected red in each Step 2 was observed the same way: the plan applied through that task's Step 1
only, then the spec type check (or, for Task 1.1, the spec run). The code was then reverted; nothing but
documentation was committed with the plan.

Line counts after the proof, largest first: `composer.service.ts` 911 (953 before, under the cap by
lifting note entry and the caret arithmetic out); `composer-track-strip.component.spec.ts` 647;
`composer-library-panel.component.ts` 534; `composer-track-strip.component.ts` 459;
`composer.service.editing.spec.ts` 441; `composer-score.component.ts` 439; `beat-edits.ts` 345;
`composer-tools.ts` 340; `composer.component.ts` 314 (801 before).

**Not proven by the suite:** Task 4.3's wiring of the score, which has no spec (its decisions are Task
4.1's pure functions); anything visual or keyboard-hardware - Bravura rendering, narrow widths, Firefox,
non-US layouts, macOS - which Task 5.2 checks by hand; the shapes of the twelve SMuFL code points that
alphaTab's own enum does not name (they are in the font; Task 5.2 looks at them); and the order of the
shell's and the composer's Escape listeners in the running app, which each side's spec pins separately.

### Facts this plan rests on, all verified on 2026-09-13

- **A hammer-on or a shift or legato slide lands later in its bar or on the next bar's first beat - not
  within three bars.** `Note.nextNoteOnSameLine` and `findHammerPullDestination` (`alphaTab.core.mjs`
  ~6477, ~6489) are written to search three bars, but `Staff.finish` (~12707) finishes bars in order and
  `Voice.finish` (~3195) chains its own beats before finishing them, so when a note finishes the next
  bar's first beat is linked and nothing after it is. A probe through `mapper.toScore` and through
  alphaTex agreed layout by layout; `note-landing.spec.ts` (Task 1.7) pins it against alphaTab.
- **A tie's origin is found up to three bars back**, since earlier bars are chained; with none,
  alphaTab clears `isTieDestination`. Probed.
- **A pitched note never lands a hammer-on or slide**: `Beat.addNote` files only stringed notes by string
  (~7662).
- **alphaTab draws a tied note with its origin's vibrato** (~48360 in the MIDI generator, ~63881 and
  ~64605 in the two vibrato effect infos).
- **With `player.enableUserInteraction` on, alphaTab's mouse-up sets the playback range**
  (`_onBeatMouseUp` → `applyPlaybackRangeFromHighlight`, ~53124). The beat mouse events fire whatever the
  setting (`_setupClickHandling`, ~53156); alphaTab re-applies its highlight after a render only with it
  on (~53215); `highlightPlaybackRange` and `clearPlaybackRangeHighlight` draw and clear without touching
  the range (~53263, ~53381); a one-beat range draws nothing.
- **Under `Default`, alphaTab writes a black key sharp** in a key of no accidentals or sharps and flat in
  a flat key (`ModelUtils.computeAccidental`, ~4571).
- **`ForceNatural` renders as `Default`** in 1.8 (the mapper's comment on `ALTER_BY_MODE`), so Natural
  can only clear a forced accidental.
- **Bravura is served at `/font`**: `angular.json` copies `node_modules/@coderline/alphatab/dist/font`,
  which holds `Bravura.woff2`, `Bravura.woff`, `Bravura.otf`, `Bravura.svg` and `Bravura.eot`. All 45
  code points the palette uses are glyphs in `Bravura.svg`; 33 are also named in alphaTab's
  `MusicFontSymbol` enum.
- **The defaults survive a save**: the full bend's two points, the medium fermata, each offered tuplet,
  and a whole-step trill on a fretted note and on a pitched note on a staff with no tuning -
  `composer-tool-defaults.spec.ts` (Task 1.9) sends each through alphaTex.
- **The shell's Escape listener runs before the composer's**: it is registered at bootstrap and the
  composer's when its route activates, and listeners on one target run in registration order.
- `composer.service.ts` was 953 lines; `composer.component.ts` 801, holding the keyboard `switch`, the fret
  buffer, the duration buttons and the Tracks panel.

### Decisions this plan implements

Numbered as in the design's "M2 decisions", where each is argued.

| | Decision | Tasks |
|---|---|---|
| 1 | Hammer-on and shift/legato slide refuse where nothing follows, mirroring alphaTab's rule | 1.7, 1.8 |
| 2 | A fermata belongs to a bar position across all tracks | 1.10 |
| 3 | A minimal track strip; Library and Export as top-bar menus with the saved list in a drawer | 3.7, 3.8 |
| 4 | `+`/`=` longer, `-` shorter | 2.4 |
| 5 | Escape: the drawer first, then back to Select and clear the range | 2.6, 2.7 |
| 6 | Modifiers checked exactly; one shared editable-target helper | 2.1, 2.2, 2.6 |
| 7 | A two-digit fret is one undo step | 1.6, 2.5 |
| 8 | Refusals displayed in a live region, cleared on caret, selection, undo and redo; duration refusals published | 1.3, 1.4, 3.3 |
| 9 | Tuplet placement fixed before the tuplet tool | 1.1 |
| 10 | Natural clears a forced accidental | 2.4 |
| 11 | Respell | 1.11 |
| 12, 13 | Palm mute, let ring and vibrato are note-level; tied vibrato read from its origin and refused | 1.8, 2.3, 2.4 |
| 14 | A duration press on nothing but graces is refused | 1.4 |
| 15 | A clearing press passes on a pitched staff | 1.8 |
| 16 | Defaults for bend, trill, tuplet and fermata | 1.9 |
| 17 | Anchored popovers with inline validation | 3.2, 3.5 |
| 18 | New commands in new modules; the service under the cap | 1.2-1.15 |
| 19 | Ctrl+S through a save-request channel | 3.1 |
| 20 | Menus and drawer hidden with CSS | 3.8 |
| 21 | macOS alternates | 2.4 |
| 22 | Score interaction | 4.1-4.3 |
| 23 | The page grid | 3.9, 3.10 |
| 24 | Bravura palette buttons | 2.4, 3.6 |
| 25 | The tool table's spec | 2.4 |

### Where this plan departs from the design

1. **The landing reach is the next bar's first beat, not three bars** (decision 1). The decision said "no
   note on the same string within three bars", from reading alphaTab's source; the source's bound never
   takes effect on a finished score, as the facts above say. The predicate mirrors what alphaTab keeps, and
   its spec checks alphaTab rather than the source. The refusal messages say "later in the bar or on the
   next bar's first beat".
2. **On a range, a hammer-on or slide goes on the notes that can land and skips the rest**, refusing only
   when none can (decision 1 said what a single note does). This is how a note tool already treats rests,
   and a phrase's last note should not stop the phrase taking legato. The toggle reads the notes that can
   land, so such a range still turns off.
3. **A fermata press leaves a generated track alone** (decision 2 said every track). Every edit refuses or
   skips a generated track; alphaTab may still draw the position's fermata there.
4. **Every fretted-only note technique can be cleared from a pitched staff**, not only the harmonic
   (decision 15), since clearing any of them removes what alphaTab cannot use there. The scope that asks
   only for notes, `{ family: 'note'; key: 'notes' }`, also serves respell and the pitch and string moves.
5. **Escape uses the shell's claim, not a shared drawer flag** (decision 5 suggested a service). A flag
   would read closed by the time the composer asked, because the shell's listener runs first and closes
   the drawer; a claim is read correctly in either order. Task 2.7 explains.
6. **A symbol typed through AltGr or Option still matches** after every exact binding fails (decision 6
   said exactly). Without it `}`, `|`, `[`, `]`, `$` and `<` are out of reach on German and French layouts
   and on a German Mac. Digits and letters are never relaxed, so the decision's cases hold.
7. **Nine tools have no key** (decision 25 said every tool has one): the seven note values, which `+` and
   `-` step through, and the Select and Pen buttons, which Q toggles. The design's table gives them none;
   `KEYLESS_TOOLS` names them and the spec checks the list.
8. **Triplet feel opens a popover** too (decision 17 listed six popovers): it has seven values and the
   design's table writes it with an ellipsis.
9. **Common and cut time are validated**: `isCommon` is accepted for 4/4 and 2/2 only, the two meters
   alphaTab draws with a C. Not in the design.
10. **Respell on a range** respells the notes that can be and skips the rest (decision 11 described one
    note), refusing only when none can.
11. **The half-refusal now says why** (decision 8 left it to planning): a duration press on a generated
    track remembers the input duration and publishes the reason the beat did not change.
12. **Delete beats pulls the later beats earlier** and fills the bar at its end, and **insert beat leaves
    overflow**, rather than placing rests where a gap opened or taking trailing rests. The design's gap rule
    is for length changes; a delete and an insert are about which beats exist. Cut clears to rests.
13. **The clipboard is the composer's own** and copies from one staff; a multitrack rectangle is refused.
    Paste appends bars when it runs off the end of the score (design Part 4 did not say).
14. **Shift+↑ and Shift+↓ extend to the track above and below** - a multitrack rectangle - since ↑ and ↓
    change string and the design's table only says "Extend selection".
15. **The app header's height is published by the shell** as `--app-header-height` (decision 23 said
    "minus the app header"), because the header's navigation wraps on a narrow window.
16. **Pen's hover notehead uses the clef of the caret's bar** on the staff under the pointer: no beat is
    known during a hover without asking alphaTab's bounds lookup for one.
17. **Task 4.3 has no failing spec**: `ComposerScoreComponent` has none, as decision 22 foresaw, and its
    decisions are Task 4.1's.
18. **`removeBar(0)` is fixed in passing** (Task 1.15): it turned a 3/4 score into 4/4, the fault M1 fixed
    for `insertBar(0)`.
19. **The four unnamed slide types stay unnamed.** The design's "Found while designing" put widening
    `NoteEffectsDoc.slide` with M2's slide tools, but M2's slide tools are the two the model names.
20. **Play from start is the page's stop then play**, not an `AlphaTabService` method: stop already rewinds.

### Corrections during implementation

None yet. If review changes code after it is written to a task below, list the change here and say that
the committed code supersedes that task's blocks, as the M1 plan does.

---


## Phase 1: fixes and missing commands, in the service layer

Every command the palette and the keyboard will call, as pure edit functions with their own specs,
delegated from `ComposerService` the way M1's bar and track commands are. Nothing in the page
changes in this phase.

**Phase 1 exports**

| Module | Exports added | Task |
|---|---|---|
| `beat-edits.ts` | (fix) `relength` places a tuplet group's freed room after the group | 1.1 |
| `composer-cursor.ts` (new) | `CursorMove`, `clampedCursor`, `movedCursor` | 1.2 |
| `composer.service.ts` | `moveCursor(move, extend)`; caret moves, undo and redo clear `refusal` | 1.3 |
| `edit-refusals.ts` | `durationRefusal` | 1.4 |
| `composer.model.ts` | `EntryMode`, `ComposerState.entryMode` | 1.5 |
| `composer.service.ts` | `setEntryMode` | 1.5 |
| `composer-entry-commands.ts` (new) | `ComposerEntryHost`, `ComposerEntryCommands` (note, rest and delete entry lifted out; `retypeNote`) | 1.6 |
| `note-landing.ts` (new) | `hammerDestinationOf`, `slideTargetOf`, `tieOriginOf` | 1.7 |
| `edit-refusals.ts` | `noteEffectRefusal`, `drawnPitchClassOf` (exported), scope `{ family: 'note'; key: 'notes' }` | 1.8 |
| `note-edits.ts` | `NoteTarget`, `noteTargetsAt`, `noteEffectTargets`; `toggleNoteEffect` reads and writes only notes that can hold the value | 1.8 |
| `composer-tool-defaults.ts` (new) | `fullBendPoints`, `defaultFermata`, `DEFAULT_TRILL_SPEED`, `TRILL_INTERVAL`, `TUPLET_CHOICES` | 1.9 |
| `note-edits.ts` | `trillTargetOf`, `toggleTrill` | 1.9 |
| `beat-edits.ts` | `fermataPositionsOf`, `toggleFermata` | 1.10 |
| `note-respell.ts` (new) | `respellingsOf`, `respelledNote`, `respellRefusal`, `respellNotes` | 1.11 |
| `note-moves.ts` (new) | `shiftSemitone`, `moveNotesToString` | 1.12 |
| `beat-edits.ts` | `clearToRests`, `insertBeatAt`, `deleteBeats` | 1.13 |
| `composer-entry-commands.ts` | `ComposerEntryHost.select`; `clearSelectionToRests`, `insertBeat`, `deleteBeats` | 1.13 |
| `beat-clipboard.ts` (new) | `CopiedBeats`, `copiedBeatsOf`, `pasteBeats` | 1.14 |
| `composer-entry-commands.ts` | `copy`, `cut`, `paste` | 1.14 |
| `bar-edits.ts` | `toggleRepeatClose`, `insertBarsBefore`, `deleteBars` | 1.15 |
| `composer-service-structure.ts` | `toggleRepeatClose`, `insertBarsBeforeSelection`, `deleteSelectedBars` | 1.15 |
| `composer.service.ts` | `toggleTrill`, `toggleFermata`, `respell`, `shiftSemitone`, `moveNotesToString`, `clearSelectionToRests`, `insertBeat`, `deleteBeats`, `copy`, `cut`, `paste`, `toggleRepeatClose`, `insertBarsBeforeSelection`, `deleteSelectedBars`; `removeBar` keeps the meter | 1.9-1.15 |

All new service specs go in one new file, `client/src/app/services/composer.service.editing.spec.ts`,
created in Task 1.3 and appended to after.

### Task 1.1: A whole tuplet group's freed room goes after the group

`relength`'s phase 2 places each changing beat's freed room right after that beat. A beat made a
triplet eighth frees 160 ticks, which is not a whole number of 64ths, so `insertRestsAt` cannot spell
a rest there, and the bar fills at its end instead - moving the notes after the group earlier. Carry
room that cannot be placed forward while the next beat in the voice is the next changing beat, and
place it after the run. Phase 2 also counted room as placed when `insertRestsAt` returned false; that
is fixed in the same lines. It cannot be seen today: phase 2 only places room while the bar is
short, and a bar short at that point is never over in phase 3, which is the only reader of the count.

**Files:**
- Modify: `client/src/app/services/beat-edits.ts` (`settleRange`, and `relength`'s docstring)
- Test: `client/src/app/services/beat-edits.spec.ts`

**Step 1: Failing spec.** In `beat-edits.spec.ts`, inside `describe('setTuplet', ...)`, after the
existing `it`:

<!-- apply: find client/src/app/services/beat-edits.spec.ts -->
```typescript
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
    expect(beats(doc).length).toBe(5);
  });
```

<!-- apply: replace client/src/app/services/beat-edits.spec.ts -->
```typescript
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
    expect(beats(doc).length).toBe(5);
  });

  it('puts a whole group\'s freed room right after the group, so the beats after it keep their ticks', () => {
    // `n8 n8 n8 n8 n2`. Each eighth made a triplet eighth frees 160 ticks - off the 64th grid, so no
    // rest can go after any one of them. Together they free 480, an eighth rest right after the
    // group, and the fourth eighth stays at 1440 rather than moving to 960.
    const doc = ComposerService.createEmptyScore();
    beats(doc).splice(0, beats(doc).length, ...([8, 8, 8, 8, 2] as DurationValue[]).map(value => createRestBeat(value)));
    [0, 1, 2, 3, 4].forEach(index => withNote(doc, 0, index));

    setTuplet(doc, [ref(0, 0), ref(0, 1), ref(0, 2)], { numerator: 3, denominator: 2 });

    expect(shape(doc)).toEqual(['n8', 'n8', 'n8', 'r8', 'n8', 'n2']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'full' });
  });
```

**Step 2: Run it** (from `client/`):

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/beat-edits.spec.ts
```

Expected: 1 FAILED - `Expected $[3] = 'n8' to equal 'r8'.` (and the shape messages after it): the
rest went to the end of the bar.

**Step 3: Carry the room.** In `beat-edits.ts`, replace phase 2 of `settleRange`:

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
  // Room freed but not placed, because the bar was not short when its turn came. That room has
  // already paid for growth within the range, so phase 3 must not take rests for it again.
  let unplaced = 0;
  for (const beat of inOrder) {
    const room = freed.get(beat) ?? 0;
    const fill = barFillOf(bar, meter);
    const placed = room > 0 && fill.kind === 'under' ? Math.min(room, fill.ticks) : 0;
    if (placed > 0) insertRestsAt(voice, voice.beats.indexOf(beat) + 1, placed, meter);
    unplaced += room - placed;
  }
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
  // Room freed but not placed, because the bar was not short when its turn came or no rest could
  // spell it. That room has already paid for growth within the range, so phase 3 must not take
  // rests for it again.
  //
  // Room no rest can spell where it opened - a tuplet's remainder is off the 64th grid - is carried
  // to the next beat when that beat is changing too and directly follows, and placed after the run:
  // three eighths made a triplet each free 160 ticks, which nothing can spell, and together free 480,
  // an eighth rest right after the group. So the beats after a whole group keep their ticks.
  let unplaced = 0;
  let carried = 0;
  inOrder.forEach((beat, order) => {
    const room = carried + (freed.get(beat) ?? 0);
    carried = 0;
    const fill = barFillOf(bar, meter);
    const wanted = room > 0 && fill.kind === 'under' ? Math.min(room, fill.ticks) : 0;
    const after = voice.beats.indexOf(beat) + 1;
    if (wanted > 0 && insertRestsAt(voice, after, wanted, meter)) {
      unplaced += room - wanted;
    } else if (wanted > 0 && voice.beats[after] === inOrder[order + 1]) {
      carried = room;
    } else {
      unplaced += room;
    }
  });
```

And the docstring's phase 2, so it says what the code does:

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
 *    quarters set to eighths are `n8 r8 n8 r8 n8 r8 n8 r8`; `n4 r4 r4 r4` dotted is `n4. r8 r4 r4`.
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
 *    quarters set to eighths are `n8 r8 n8 r8 n8 r8 n8 r8`; `n4 r4 r4 r4` dotted is `n4. r8 r4 r4`.
 *    Room no rest can spell where it opened - a tuplet's remainder, off the 64th grid - carries to
 *    the next beat while that beat is changing too and directly follows, and is placed after the
 *    run: `n8 n8 n8 n8 n2` with its first three beats made a triplet is `n8 n8 n8 r8 n8 n2`.
```

**Step 4: Run it.** Expected: all SUCCESS, including M1's `makes three quarters a triplet` - its
fourth beat was already a rest, so the rest lands in the same place either way.

**Step 5: Commit**

```bash
git add client/src/app/services/beat-edits.ts client/src/app/services/beat-edits.spec.ts
git commit -m "fix: Put a whole tuplet group's freed room right after the group" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 1.2: Caret moves as pure functions

The keyboard needs Home, End, previous and next bar, first and last bar, and previous and next
track, each also extending a range. Rather than seven service methods, one pure function answers
where any move lands, and the service gets one command in Task 1.3. `clampCursor` moves here too,
which takes about forty lines out of `composer.service.ts` (953 lines, 47 under the cap).

**Files:**
- Create: `client/src/app/services/composer-cursor.ts`
- Test: `client/src/app/services/composer-cursor.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-cursor.spec.ts -->
```typescript
import { ComposerService } from './composer.service';
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { EditCursor, ScoreDoc, createRestBeat } from '../models/composer.model';

const at = (barIndex: number, beatIndex: number, extra: Partial<EditCursor> = {}): EditCursor => ({
  trackIndex: 0, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex: 0, ...extra
});
const where = (cursor: EditCursor): string => `${cursor.trackIndex}:${cursor.barIndex}.${cursor.beatIndex}`;
const moved = (doc: ScoreDoc, cursor: EditCursor, move: CursorMove): string => where(movedCursor(doc, cursor, move));

describe('clampedCursor', () => {
  it('pulls every index back inside the document', () => {
    const doc = ComposerService.createEmptyScore();

    expect(clampedCursor(at(9, 9, { trackIndex: 3, stringIndex: 8 }), doc)).toEqual(at(3, 3, { stringIndex: 5 }));
  });

  it('gives a pitched staff no string', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(clampedCursor(at(0, 0, { trackIndex: 1, stringIndex: 2 }), doc).stringIndex).toBeNull();
  });
});

describe('movedCursor', () => {
  it('steps a beat, wrapping across bar lines both ways and stopping at the ends', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(0, 3), { kind: 'beat', delta: 1 })).toBe('0:1.0');
    expect(moved(doc, at(1, 0), { kind: 'beat', delta: -1 })).toBe('0:0.3');
    expect(moved(doc, at(0, 0), { kind: 'beat', delta: -1 })).toBe('0:0.0');
    expect(moved(doc, at(3, 3), { kind: 'beat', delta: 1 })).toBe('0:3.3');
  });

  it('wraps by each bar\'s own beat count', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = [createRestBeat(2), createRestBeat(2)];

    expect(moved(doc, at(1, 0), { kind: 'beat', delta: -1 })).toBe('0:0.1');
  });

  it('changes string on a fretted staff and not on a pitched one', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(movedCursor(doc, at(0, 0, { stringIndex: 5 }), { kind: 'string', delta: 1 }).stringIndex).toBe(5);
    expect(movedCursor(doc, at(0, 0, { stringIndex: 2 }), { kind: 'string', delta: -1 }).stringIndex).toBe(1);
    const piano = at(0, 0, { trackIndex: 1, stringIndex: null });
    expect(movedCursor(doc, piano, { kind: 'string', delta: 1 })).toEqual(piano);
  });

  it('goes to the first and last beat of the bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(2, 2), { kind: 'barEdge', edge: 'first' })).toBe('0:2.0');
    expect(moved(doc, at(2, 1), { kind: 'barEdge', edge: 'last' })).toBe('0:2.3');
  });

  it('goes to the first beat of the previous or next bar, and stops at the ends', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(1, 2), { kind: 'bar', delta: 1 })).toBe('0:2.0');
    expect(moved(doc, at(1, 2), { kind: 'bar', delta: -1 })).toBe('0:0.0');
    expect(moved(doc, at(3, 2), { kind: 'bar', delta: 1 })).toBe('0:3.0');
  });

  it('goes to the first beat of the score and the last', () => {
    const doc = ComposerService.createEmptyScore();

    expect(moved(doc, at(2, 2), { kind: 'scoreEdge', edge: 'first' })).toBe('0:0.0');
    expect(moved(doc, at(1, 1), { kind: 'scoreEdge', edge: 'last' })).toBe('0:3.3');
  });

  it('goes to the same bar on the next or previous track, and stops at the ends', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(moved(doc, at(2, 3), { kind: 'track', delta: 1 })).toBe('1:2.0');
    expect(moved(doc, at(2, 3, { trackIndex: 1 }), { kind: 'track', delta: 1 })).toBe('1:2.0');
    expect(moved(doc, at(2, 3, { trackIndex: 1 }), { kind: 'track', delta: -1 })).toBe('0:2.0');
  });
});
```

**Step 2: Run it** with `--include=src/app/services/composer-cursor.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-cursor' or its corresponding type declarations.`

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-cursor.ts -->
```typescript
import { EditCursor, ScoreDoc, createDefaultCursor } from '../models/composer.model';

/**
 * Where the caret goes, as pure functions of the document.
 *
 * The keyboard has more caret moves than the service had commands - Home and End, previous and next
 * bar, first and last bar, previous and next track - and each also extends a range with Shift. One
 * function answers where any move lands, so `ComposerService.moveCursor` is one command rather than
 * a dozen, and the arithmetic is specced without a service. `clampedCursor` was the service's
 * private `clampCursor`; every caller of either now goes through here.
 */

/** A caret move the keyboard asks for. */
export type CursorMove =
  | { kind: 'beat'; delta: number }
  | { kind: 'string'; delta: number }
  | { kind: 'barEdge'; edge: 'first' | 'last' }
  | { kind: 'bar'; delta: number }
  | { kind: 'scoreEdge'; edge: 'first' | 'last' }
  | { kind: 'track'; delta: number };

const clamp = (value: number, min: number, max: number): number => (max < min ? min : Math.max(min, Math.min(max, value)));

/** `cursor` with every index pulled back inside `doc`. A pitched staff has no string. */
export function clampedCursor(cursor: EditCursor, doc: ScoreDoc): EditCursor {
  const trackIndex = clamp(cursor.trackIndex, 0, doc.tracks.length - 1);
  const track = doc.tracks[trackIndex];
  if (!track) return createDefaultCursor();

  const staffIndex = clamp(cursor.staffIndex, 0, track.staves.length - 1);
  const staff = track.staves[staffIndex];
  const barIndex = clamp(cursor.barIndex, 0, staff.bars.length - 1);
  const bar = staff.bars[barIndex];
  const voiceIndex = clamp(cursor.voiceIndex, 0, bar.voices.length - 1);
  const beats = bar.voices[voiceIndex].beats;
  const beatIndex = clamp(cursor.beatIndex, 0, Math.max(0, beats.length - 1));
  const stringIndex = staff.tuning.length > 0 ? clamp(cursor.stringIndex ?? 0, 0, staff.tuning.length - 1) : null;

  return { trackIndex, staffIndex, barIndex, voiceIndex, beatIndex, stringIndex };
}

/**
 * Where `move` takes `cursor`, inside `doc`.
 *
 * A beat step wraps across bar lines by each bar's own beat count and stops at either end of the
 * score. A bar move lands on the bar's first beat, as Guitar Pro's and TuxGuitar's do, and a track
 * move on the same bar's first beat of the other track's first staff: beat indices do not line up
 * across tracks, so keeping one would land on an arbitrary beat. A string move on a pitched staff,
 * which has no strings, goes nowhere.
 */
export function movedCursor(doc: ScoreDoc, cursor: EditCursor, move: CursorMove): EditCursor {
  const staff = doc.tracks[cursor.trackIndex]?.staves[cursor.staffIndex];
  if (!staff) return clampedCursor(cursor, doc);
  const beatCount = (barIndex: number): number => staff.bars[barIndex]?.voices[cursor.voiceIndex]?.beats.length ?? 1;
  const lastBar = staff.bars.length - 1;

  switch (move.kind) {
    case 'beat': {
      let barIndex = cursor.barIndex;
      let beatIndex = cursor.beatIndex + move.delta;
      while (beatIndex < 0 && barIndex > 0) {
        barIndex--;
        beatIndex += beatCount(barIndex);
      }
      while (barIndex < lastBar && beatIndex >= beatCount(barIndex)) {
        beatIndex -= beatCount(barIndex);
        barIndex++;
      }
      return clampedCursor({ ...cursor, barIndex, beatIndex }, doc);
    }
    case 'string':
      return staff.tuning.length === 0
        ? cursor
        : clampedCursor({ ...cursor, stringIndex: (cursor.stringIndex ?? 0) + move.delta }, doc);
    case 'barEdge':
      return clampedCursor({ ...cursor, beatIndex: move.edge === 'first' ? 0 : beatCount(cursor.barIndex) - 1 }, doc);
    case 'bar':
      return clampedCursor({ ...cursor, barIndex: cursor.barIndex + move.delta, beatIndex: 0 }, doc);
    case 'scoreEdge':
      return move.edge === 'first'
        ? clampedCursor({ ...cursor, barIndex: 0, beatIndex: 0 }, doc)
        : clampedCursor({ ...cursor, barIndex: lastBar, beatIndex: beatCount(lastBar) - 1 }, doc);
    case 'track':
      return clampedCursor(
        { ...cursor, trackIndex: cursor.trackIndex + move.delta, staffIndex: 0, voiceIndex: 0, beatIndex: 0 },
        doc
      );
  }
}
```

**Step 4: Run it.** Expected: 9 SUCCESS.

**Step 5: Commit**: `feat: Caret moves as pure functions of the score`.

### Task 1.3: One caret command, and a caret move clears a refusal

`moveCursor(move, extend)` covers every navigation key and its Shift form. Today `moveCursorByBeat`
calls `setCursor`, which drops the anchor, so Shift+arrow has nothing to extend with.

A refusal also outlives the selection it answered: `setCursor`, `extendSelectionTo`, `undo` and
`redo` leave `state.refusal` standing, so after a refused press and an arrow key the status line would
explain a press on a beat the user has left. Every selection change now clears it, and so do undo
and redo.

**Files:**
- Modify: `client/src/app/services/composer.service.ts`
- Test: create `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs**

<!-- apply: create client/src/app/services/composer.service.editing.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { ComposerState } from '../models/composer.model';

/**
 * The service commands M2's palette and keyboard reach, beyond M1's.
 *
 * Each `describe` belongs to one task of the M2 plan. The pure edit functions under these commands
 * have their own specs; what is pinned here is what only the service can get wrong - a range pressed
 * as one undo step, a refusal published and nothing committed, the selection after the press.
 */

/** The service's current state. */
function stateOf(service: ComposerService): ComposerState {
  let latest: ComposerState | undefined;
  service.getState().subscribe(value => (latest = value)).unsubscribe();
  if (!latest) throw new Error('no state');
  return latest;
}

/** Writes `fret` on tab string `string` at bar `barIndex`, beat `beatIndex`, leaving the caret there. */
function writeFret(service: ComposerService, barIndex: number, beatIndex: number, fret: number, string = 1): void {
  service.setCursor({ barIndex, beatIndex, stringIndex: string - 1 });
  service.setNoteAtCursor({ kind: 'fretted', string, fret }, false);
}

/** The first track's beats in bar `barIndex`. */
function beatsIn(service: ComposerService, barIndex = 0) {
  return service.doc.tracks[0].staves[0].bars[barIndex].voices[0].beats;
}

describe('ComposerService moveCursor', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('extends a range beat by beat, keeping where it started', () => {
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.moveCursor({ kind: 'beat', delta: 1 }, true);
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    expect(stateOf(service).anchor?.beatIndex).toBe(1);
    expect(stateOf(service).cursor.beatIndex).toBe(3);
  });

  it('drops the range on a plain move', () => {
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    service.moveCursor({ kind: 'bar', delta: 1 });

    expect(stateOf(service).anchor).toBeNull();
    expect(stateOf(service).cursor.barIndex).toBe(1);
  });

  it('keeps the range when the string changes, since that moves the focus and not the selection', () => {
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    service.moveCursor({ kind: 'string', delta: 1 });

    expect(stateOf(service).anchor).not.toBeNull();
    expect(stateOf(service).cursor.stringIndex).toBe(1);
  });
});

describe('ComposerService refusals clear', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  /** A refusal on screen: a note tool pressed on the caret's rest. */
  const refuseAPress = (): void => {
    service.toggleNoteEffect('isGhost', true, false);
    expect(stateOf(service).refusal).not.toBeNull();
  };

  it('when the caret moves', () => {
    refuseAPress();
    service.setCursor({ beatIndex: 1 });
    expect(stateOf(service).refusal).toBeNull();
  });

  it('when the caret steps or changes string', () => {
    refuseAPress();
    service.moveCursorByBeat(1);
    expect(stateOf(service).refusal).toBeNull();

    refuseAPress();
    service.moveCursorByString(1);
    expect(stateOf(service).refusal).toBeNull();
  });

  it('when a range is extended or the whole track selected', () => {
    refuseAPress();
    service.extendSelectionTo({ beatIndex: 2 });
    expect(stateOf(service).refusal).toBeNull();

    service.setCursor({ beatIndex: 0 });
    refuseAPress();
    service.selectAllInTrack();
    expect(stateOf(service).refusal).toBeNull();
  });

  it('on undo and on redo', () => {
    writeFret(service, 0, 0, 3);
    service.setCursor({ beatIndex: 1 });

    refuseAPress();
    service.undo();
    expect(stateOf(service).refusal).toBeNull();

    refuseAPress();
    service.redo();
    expect(stateOf(service).refusal).toBeNull();
  });
});
```

**Step 2: Run it** with `--include=src/app/services/composer.service.editing.spec.ts`. Expected: a
compile error, `TS2339: Property 'moveCursor' does not exist on type 'ComposerService'.`

**Step 3: Implement.** In `composer.service.ts`, import the cursor module after the
`composer-selection` import:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { BeatRef, followedEnd, selectionTargets } from './composer-selection';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { BeatRef, followedEnd, selectionTargets } from './composer-selection';
```

Replace the whole cursor section, from `setCursor` to the private `clamp`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /** Moves the caret, and drops any range: a plain click or arrow key. */
  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: null,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /**
   * Moves the selection's moving end, fixing the other end where the caret was if no range
   * existed yet: shift-click and shift-arrow.
   */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.stateSubject.next({
      ...state,
      anchor: state.anchor ?? state.cursor,
      cursor: this.clampCursor({ ...state.cursor, ...cursor }, state.doc)
    });
  }

  /** Selects every beat of the caret's staff, first bar to last. */
  selectAllInTrack(): void {
    const state = this.stateSubject.getValue();
    const staff = this.staffAt(state.doc, state.cursor);
    if (!staff) return;
    const lastBar = staff.bars.length - 1;
    const lastBeat = (staff.bars[lastBar]?.voices[state.cursor.voiceIndex]?.beats.length ?? 1) - 1;
    this.stateSubject.next({
      ...state,
      anchor: { ...state.cursor, barIndex: 0, beatIndex: 0 },
      cursor: this.clampCursor({ ...state.cursor, barIndex: lastBar, beatIndex: lastBeat }, state.doc)
    });
  }

  /** Moves the caret forward or backward, wrapping across bars. */
  moveCursorByBeat(delta: number): void {
    const state = this.stateSubject.getValue();
    const cursor = { ...state.cursor };
    const staff = this.staffAt(state.doc, cursor);
    if (!staff) return;

    let beatIndex = cursor.beatIndex + delta;

    while (beatIndex < 0 && cursor.barIndex > 0) {
      cursor.barIndex--;
      beatIndex += staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1;
    }
    while (
      cursor.barIndex < staff.bars.length - 1 &&
      beatIndex >= (staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1)
    ) {
      beatIndex -= staff.bars[cursor.barIndex].voices[cursor.voiceIndex]?.beats.length ?? 1;
      cursor.barIndex++;
    }

    cursor.beatIndex = beatIndex;
    this.setCursor(cursor);
  }

  moveCursorByString(delta: number): void {
    const state = this.stateSubject.getValue();
    const staff = this.staffAt(state.doc, state.cursor);
    if (!staff || staff.tuning.length === 0) return;

    const current = state.cursor.stringIndex ?? 0;
    const next = Math.max(0, Math.min(staff.tuning.length - 1, current + delta));
    this.stateSubject.next({ ...state, cursor: { ...state.cursor, stringIndex: next } });
  }

  private clampCursor(cursor: EditCursor, doc: ScoreDoc): EditCursor {
    const trackIndex = this.clamp(cursor.trackIndex, 0, doc.tracks.length - 1);
    const track = doc.tracks[trackIndex];
    if (!track) return createDefaultCursor();

    const staffIndex = this.clamp(cursor.staffIndex, 0, track.staves.length - 1);
    const staff = track.staves[staffIndex];
    const barIndex = this.clamp(cursor.barIndex, 0, staff.bars.length - 1);
    const bar = staff.bars[barIndex];
    const voiceIndex = this.clamp(cursor.voiceIndex, 0, bar.voices.length - 1);
    const beats = bar.voices[voiceIndex].beats;
    const beatIndex = this.clamp(cursor.beatIndex, 0, Math.max(0, beats.length - 1));

    const stringIndex =
      staff.tuning.length > 0
        ? this.clamp(cursor.stringIndex ?? 0, 0, staff.tuning.length - 1)
        : null;

    return { trackIndex, staffIndex, barIndex, voiceIndex, beatIndex, stringIndex };
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Moves the caret, and drops any range: a plain click or arrow key. */
  setCursor(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.publishSelection(clampedCursor({ ...state.cursor, ...cursor }, state.doc), null);
  }

  /**
   * Moves the selection's moving end, fixing the other end where the caret was if no range
   * existed yet: shift-click and shift-arrow.
   */
  extendSelectionTo(cursor: Partial<EditCursor>): void {
    const state = this.stateSubject.getValue();
    this.publishSelection(clampedCursor({ ...state.cursor, ...cursor }, state.doc), state.anchor ?? state.cursor);
  }

  /** Selects every beat of the caret's staff, first bar to last. */
  selectAllInTrack(): void {
    const { doc, cursor } = this.stateSubject.getValue();
    this.publishSelection(
      movedCursor(doc, cursor, { kind: 'scoreEdge', edge: 'last' }),
      movedCursor(doc, cursor, { kind: 'scoreEdge', edge: 'first' })
    );
  }

  /**
   * Moves the caret by `move` (see `movedCursor`) - or, with `extend`, the selection's moving end.
   * A plain move drops the range, except a change of string, which moves the focus within it.
   */
  moveCursor(move: CursorMove, extend = false): void {
    const state = this.stateSubject.getValue();
    const anchor = extend ? state.anchor ?? state.cursor : move.kind === 'string' ? state.anchor : null;
    this.publishSelection(movedCursor(state.doc, state.cursor, move), anchor);
  }

  moveCursorByBeat(delta: number): void {
    this.moveCursor({ kind: 'beat', delta });
  }

  moveCursorByString(delta: number): void {
    this.moveCursor({ kind: 'string', delta });
  }

  /**
   * Publishes a selection, and clears any refusal: it answered a press on the selection that was,
   * and left standing it would read as the reason a press on this one failed.
   */
  private publishSelection(cursor: EditCursor, anchor: EditCursor | null): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), cursor, anchor, refusal: null });
  }
```

The history methods use the moved clamp, and undo and redo clear the refusal too:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
      doc: next,
      cursor: this.clampCursor(cursor, next),
      anchor: anchor ? this.clampCursor(anchor, next) : null,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
      doc: next,
      cursor: clampedCursor(cursor, next),
      anchor: anchor ? clampedCursor(anchor, next) : null,
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
      doc: previous,
      cursor: this.clampCursor(state.cursor, previous),
      anchor: state.anchor ? this.clampCursor(state.anchor, previous) : null,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
      doc: previous,
      cursor: clampedCursor(state.cursor, previous),
      anchor: state.anchor ? clampedCursor(state.anchor, previous) : null,
      refusal: null,
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
      doc: next,
      cursor: this.clampCursor(state.cursor, next),
      anchor: state.anchor ? this.clampCursor(state.anchor, next) : null,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
      doc: next,
      cursor: clampedCursor(state.cursor, next),
      anchor: state.anchor ? clampedCursor(state.anchor, next) : null,
      refusal: null,
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
      cursor: this.clampCursor(state.cursor, doc),
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
      cursor: clampedCursor(state.cursor, doc),
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
      const at = this.clamp(index, 0, draft.masterBars.length - 1);
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
      const at = Math.max(0, Math.min(index, draft.masterBars.length - 1));
```

**Step 4: Run** `composer.service.editing.spec.ts`, `composer.service.spec.ts` and
`composer.service.generated.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit**: `feat: One caret command for every navigation key, and a caret move clears a refusal`.

### Task 1.4: A duration press says why it did nothing

`applyDurationAtCursor` asks `editRefusal` and skips silently. It now publishes the reason, and it
refuses a press whose every target is a grace beat: alphaTab sets a grace's written value itself from
the size of its grace group (`Beat.finish`, `alphaTab.core.mjs` ~7772-7786), so the press could never
show. A range with some graces keeps skipping them, as M1 does.

M1's half-refusal stays: on a generated track the press still remembers the input duration. It now
also publishes why the beat did not change - a palette that moves while the score does not is what
M2's live region exists to explain, and publishing a message freezes nothing.

**Files:**
- Modify: `client/src/app/services/edit-refusals.ts`, `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/edit-refusals.spec.ts`, `client/src/app/services/composer.service.editing.spec.ts`,
  `client/src/app/services/composer.service.generated.spec.ts`

**Step 1: Failing specs.** Append to `edit-refusals.spec.ts`, and import `durationRefusal` beside
`editRefusal`:

<!-- apply: find client/src/app/services/edit-refusals.spec.ts -->
```typescript
import { EditScope, editRefusal } from './edit-refusals';
```

<!-- apply: replace client/src/app/services/edit-refusals.spec.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal } from './edit-refusals';
```

<!-- apply: append client/src/app/services/edit-refusals.spec.ts -->
```typescript
describe('durationRefusal', () => {
  it('refuses a press on nothing but grace beats, saying alphaTab sets their value', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[1].effects.grace = 'beforeBeat';

    expect(durationRefusal(score, [ref(0, 1)])).toMatch(/grace/i);
  });

  it('lets a range with some graces through, since those are skipped', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[1].effects.grace = 'beforeBeat';

    expect(durationRefusal(score, [ref(0, 0), ref(0, 1)])).toBeNull();
  });

  it('refuses a generated track as any beat edit does', () => {
    const score = doc();
    score.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(durationRefusal(score, [ref(0)])).toMatch(/progression/i);
  });
});
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService duration refusals', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('says why a duration press on a grace did nothing, and still remembers the choice', () => {
    service.setCursor({ beatIndex: 1 });
    service.toggleGrace('beforeBeat');
    const before = JSON.stringify(service.doc);

    service.applyDurationAtCursor(8, 0);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/grace/i);
    expect(stateOf(service).inputDuration).toBe(8);
  });
});
```

And in `composer.service.generated.spec.ts`, the half-refusal now says why:

<!-- apply: find client/src/app/services/composer.service.generated.spec.ts -->
```typescript
    expect(JSON.stringify(service.doc.tracks)).toBe(before);
    expect(state().inputDuration).toBe(8);
    expect(state().inputDots).toBe(1);
```

<!-- apply: replace client/src/app/services/composer.service.generated.spec.ts -->
```typescript
    expect(JSON.stringify(service.doc.tracks)).toBe(before);
    expect(state().inputDuration).toBe(8);
    expect(state().inputDots).toBe(1);
    // And it says why the beat did not change, since M2 shows refusals.
    expect(state().refusal).toMatch(/progression/i);
```

**Step 2: Run** the three spec files. Expected: a compile error,
`TS2305: Module '"./edit-refusals"' has no exported member 'durationRefusal'.`

**Step 3: Implement.** In `edit-refusals.ts`, import `beatAt`:

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```typescript
import { BeatRef } from './composer-selection';
```

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```typescript
import { BeatRef, beatAt } from './composer-selection';
```

Append:

<!-- apply: append client/src/app/services/edit-refusals.ts -->
```typescript
const GRACE_DURATION =
  "A grace note's written value is set by alphaTab from how many graces are in its group, so it cannot be changed.";

/**
 * Why a duration press cannot apply to `refs`, or null when it can: any beat edit's refusal, or
 * every target a grace beat.
 *
 * `Beat.finish` (`alphaTab.core.mjs` ~7772-7786 in 1.8) rewrites an on-beat or before-beat grace's
 * value by the size of its group - an eighth for one grace, a sixteenth for two, a thirty-second for
 * three or more - so a value set on one is drawn as alphaTab's and lost on save. `setBeatDurations`
 * skips graces for that reason; a press with nothing else to change is refused rather than skipped,
 * so it says why nothing happened. A range with some graces in it changes the rest.
 */
export function durationRefusal(doc: ScoreDoc, refs: readonly BeatRef[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  const allGraces = refs.every(ref => (beatAt(doc, ref)?.effects.grace ?? 'none') !== 'none');
  return allGraces ? GRACE_DURATION : null;
}
```

In `composer.service.ts`, import it:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { EditScope, editRefusal } from './edit-refusals';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal } from './edit-refusals';
```

and replace `applyDurationAtCursor` with its docstring:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * Applies the current input duration to the beat under the caret, and
   * remembers it as the choice for the next note.
   *
   * The gate covers the write and stops there, because these are two effects
   * and only one of them is the generated track's business. The score is the
   * track's; the input duration is the *toolbar's*, and the toolbar belongs to
   * whichever track the caret moves to next.
   *
   * Refusing both is what a read of the gate suggests and it is wrong twice
   * over. Every route to the input duration runs through here - the palette,
   * the dot toggle, and the `+`/`-` keys all call this method, and nothing else
   * in the app calls `setInputDuration` - so a blanket refusal freezes the
   * palette outright for as long as the caret rests on a generated track, which
   * the design explicitly permits and which is how a user reads one. It also
   * takes away the pre-selection: choose a duration while looking at the
   * generated track, move back to your own, and type.
   *
   * Nor is there an atomicity to protect. `commit()` runs its callback against
   * a draft, so a caret on an empty beat already returns early and lands an
   * empty commit with the choice remembered anyway - "write the beat and
   * remember the choice, always together" was never the invariant. What is
   * left is the honest half: a toolbar showing a duration the score under the
   * caret does not have, which is what a toolbar showing an *input* duration
   * means everywhere else in the editor.
   *
   * It acts on the selection, not only the caret, and keeps each bar honest through
   * `setBeatDurations`: a gap fills with rests where it opened, and a beat that grows takes
   * only rests. The selection follows its beats past the rests that inserts (`commitFollowing`).
   */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);

    if (!editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null)) {
      this.commitFollowing(draft => setBeatDurations(draft, refs, duration, dots));
    }

    this.setInputDuration(duration, dots);
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /**
   * Applies a duration to the selection, and remembers it as the choice for the next note.
   *
   * The refusal covers the write and stops there, because these are two effects and only one of
   * them is the score's business. The input duration is the palette's, and the palette belongs to
   * whichever track the caret moves to next: refusing both would freeze it while the caret rests on a
   * generated track, and take away choosing a duration there to carry back to your own. So a refused
   * press still remembers the choice - and says why the beat did not change (`durationRefusal`),
   * since a palette that moves while the score does not needs a reason beside it.
   *
   * It keeps each bar honest through `setBeatDurations`: a gap fills with rests where it opened, and
   * a beat that grows takes only rests. The selection follows its beats past the rests that inserts.
   */
  applyDurationAtCursor(duration: DurationValue, dots: number): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = durationRefusal(state.doc, refs);

    if (refusal) this.refuse(refusal);
    else this.commitFollowing(draft => setBeatDurations(draft, refs, duration, dots));

    this.setInputDuration(duration, dots);
  }
```

**Step 4: Run** the three files. Expected: all SUCCESS.

**Step 5: Commit**: `fix: Say why a duration press did nothing, and refuse one on nothing but graces`.

### Task 1.5: Select and Pen live in state

The Select / Pen toggle is read by the palette, the keyboard handler and the score, so it is state
the service owns rather than a field one component holds. A new score starts in Select: only Pen
writes on a notation click (design decision 5).

**Files:**
- Modify: `client/src/app/models/composer.model.ts`, `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing spec.** Append:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService entry mode', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('starts in Select, so a notation click writes nothing until Pen is chosen', () => {
    expect(stateOf(service).entryMode).toBe('select');
  });

  it('switches to Pen and back, committing nothing', () => {
    service.setEntryMode('pen');
    expect(stateOf(service).entryMode).toBe('pen');
    expect(stateOf(service).canUndo).toBeFalse();

    service.setEntryMode('select');
    expect(stateOf(service).entryMode).toBe('select');
  });

  it('goes back to Select for a new score', () => {
    service.setEntryMode('pen');

    service.reset();

    expect(stateOf(service).entryMode).toBe('select');
  });
});
```

**Step 2: Run** `composer.service.editing.spec.ts`. Expected: compile errors,
`TS2339: Property 'entryMode' does not exist on type 'ComposerState'.` and
`TS2339: Property 'setEntryMode' does not exist on type 'ComposerService'.`

**Step 3: Implement.** In `composer.model.ts`:

<!-- apply: find client/src/app/models/composer.model.ts -->
```typescript
export interface ComposerState {
  doc: ScoreDoc;
  cursor: EditCursor;
```

<!-- apply: replace client/src/app/models/composer.model.ts -->
```typescript
/**
 * What a click on standard notation does: `select` moves the caret and never writes, `pen` writes
 * the clicked pitch. Digits on tablature write in both. The design's decision 5: a click meant to
 * select must not write a note.
 */
export type EntryMode = 'select' | 'pen';

export interface ComposerState {
  doc: ScoreDoc;
  cursor: EditCursor;
```

<!-- apply: find client/src/app/models/composer.model.ts -->
```typescript
  /** Why the last command did nothing, for the status line. The next edit clears it. */
  refusal: string | null;
```

<!-- apply: replace client/src/app/models/composer.model.ts -->
```typescript
  /**
   * Why the last command did nothing, for the status line. The next edit clears it, and so does a
   * selection change, undo and redo.
   */
  refusal: string | null;
  /** Select or Pen. See `EntryMode`. */
  entryMode: EntryMode;
```

In `composer.service.ts`, add `EntryMode` to the model import:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  EditCursor,
  KeySignature,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  EditCursor,
  EntryMode,
  KeySignature,
```

Both places that build a state start in Select:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
    this.stateSubject = new BehaviorSubject<ComposerState>({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      anchor: null,
      refusal: null,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
    this.stateSubject = new BehaviorSubject<ComposerState>({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      anchor: null,
      refusal: null,
      entryMode: 'select',
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
    this.stateSubject.next({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      anchor: null,
      refusal: null,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
    this.stateSubject.next({
      doc: ComposerService.createEmptyScore(),
      cursor: createDefaultCursor(),
      anchor: null,
      refusal: null,
      entryMode: 'select',
```

And the command, after `moveCursorByString`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  moveCursorByString(delta: number): void {
    this.moveCursor({ kind: 'string', delta });
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  moveCursorByString(delta: number): void {
    this.moveCursor({ kind: 'string', delta });
  }

  /** Chooses what a notation click does. Not an edit, so no undo step. See `EntryMode`. */
  setEntryMode(entryMode: EntryMode): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), entryMode });
  }
```

**Step 4: Run** `composer.service.editing.spec.ts`, then both type checks - a `ComposerState` built
anywhere else would fail to compile now. Expected: all SUCCESS, and no type errors.

**Step 5: Commit**: `feat: Select and Pen in the composer's state`.

### Task 1.6: Two-digit frets are one undo step; note entry leaves the service

Typing "1" then "2" writes fret 1 and advances, then rewrites the note as fret 12. Today that is two
commits, so undo after typing 12 leaves a fret 1 no one meant. `retypeNote` replaces the first
commit instead of adding a second - but only when nothing was committed in between, which it checks
by identity: the document the first digit left must still be the current one. An undo, a redo or any
other edit replaces the document object, so the rewrite becomes an ordinary commit.

To make room under the 1000-line cap, note, rest and delete entry move to a new
`composer-entry-commands.ts`, which the service delegates to exactly as it does to
`composer-service-structure.ts`. `commit` learns to take a reason, like `commitFollowing`, and an
`amend` flag.

**Files:**
- Create: `client/src/app/services/composer-entry-commands.ts`
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing spec.** Append:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService retypeNote', () => {
  let service: ComposerService;
  const fret = (value: number) => ({ kind: 'fretted' as const, string: 1, fret: value });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
  });

  it('makes "1" then "2" fret 12 and one undo step, the caret staying where the first digit left it', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);

    service.retypeNote(target, fret(12));

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(12));
    expect(stateOf(service).cursor.beatIndex).toBe(1);
    service.undo();
    expect(beatsIn(service)[0].isRest).toBeTrue();
    expect(stateOf(service).canUndo).toBeFalse();
  });

  it('is an undo step of its own when anything was committed in between', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);
    service.setDynamics('pp');

    service.retypeNote(target, fret(12));
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(1));
  });

  it('is an undo step of its own after an undo and redo', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);
    service.undo();
    service.redo();

    service.retypeNote(target, fret(12));
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(1));
  });
});
```

**Step 2: Run** `composer.service.editing.spec.ts`. Expected: a compile error,
`TS2339: Property 'retypeNote' does not exist on type 'ComposerService'.`

**Step 3: Implement.** Create the entry commands, carrying `setNoteAtCursor`, `setRestAtCursor`,
`deleteAtCursor` and `refusesEntryAt` over from the service unchanged apart from where they reach:

<!-- apply: create client/src/app/services/composer-entry-commands.ts -->
```typescript
import { DurationValue, EditCursor, NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';
import { setBeatDurations } from './beat-edits';
import { CursorMove } from './composer-cursor';
import { beatAt } from './composer-selection';
import { ComposerCommandHost } from './composer-service-structure';
import { editRefusal } from './edit-refusals';

/**
 * The composer's entry commands: writing a note, a rest or a delete at the caret, and the commands
 * M2's keyboard adds over the selection.
 *
 * Lifted out of `ComposerService` for the 1000-line cap, as `composer-service-structure.ts` was in
 * M1. The service owns the state, the history and the selection, exposes each command, and delegates
 * here; this class reaches it only through `ComposerEntryHost`.
 */

/** What the entry commands need from `ComposerService`, beyond what the structure commands need. */
export interface ComposerEntryHost extends ComposerCommandHost {
  /**
   * Runs `edit` on a clone and commits it with the caret where the command leaves it - or, when
   * `edit` returns a reason, publishes that and commits nothing. With `amend` the commit replaces the
   * last one rather than adding an undo step.
   */
  commit(edit: (draft: ScoreDoc) => string | null | void, amend?: boolean): void;
  /** Moves the caret, dropping any range. */
  moveCursor(move: CursorMove): void;
}

/** Note entry and the selection commands M2 adds, run through a `ComposerEntryHost`. */
export class ComposerEntryCommands {
  /**
   * The last note entry, for `retypeNote`: where it was written, and the document it left. Held by
   * identity, so any later commit, undo or redo - each of which publishes a different document - means
   * the next retype is an edit of its own.
   */
  private lastEntry: { at: EditCursor; doc: ScoreDoc } | null = null;

  constructor(private readonly host: ComposerEntryHost) {}

  /** Writes a note at the caret, replacing any note already on that string, and by default advances. */
  setNoteAtCursor(pitch: NotePitch, advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => writeNote(draft, cursor, pitch, state.inputDuration, state.inputDots));
    this.lastEntry = { at: cursor, doc: this.host.state().doc };

    if (advance) this.host.moveCursor({ kind: 'beat', delta: 1 });
  }

  /**
   * Rewrites the note at `target` - the second digit of a two-digit fret, after the first digit's
   * `setNoteAtCursor` advanced the caret. The caret stays where it is.
   *
   * When nothing has been committed since that note was written at `target`, this replaces that
   * commit instead of adding one, so "1" then "2" is fret 12 and a single undo step takes it all back.
   * Otherwise it is an ordinary commit.
   */
  retypeNote(target: EditCursor, pitch: NotePitch): void {
    const state = this.host.state();
    if (this.refusesEntryAt(state.doc, target)) return;

    const last = this.lastEntry;
    const amend = last !== null && last.doc === state.doc && sameBeat(last.at, target);
    this.host.commit(draft => writeNote(draft, target, pitch, state.inputDuration, state.inputDots), amend);
    this.lastEntry = { at: target, doc: this.host.state().doc };
  }

  /** Turns the beat at the caret into a rest, and by default advances. */
  setRestAtCursor(advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => {
      const beat = beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
    });

    if (advance) this.host.moveCursor({ kind: 'beat', delta: 1 });
  }

  /**
   * Clears the beat at the caret back to a rest.
   *
   * The slot is kept rather than removed: bars are pre-filled with a full measure of rests, so
   * deleting a note should empty its position, not shorten the bar.
   */
  deleteAtCursor(): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => {
      const beat = beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
    });
  }

  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
   * second voice, which a click can reach in a loaded bar and bar filling cannot measure. Publishes
   * the reason and commits nothing, so a refusal costs no undo step and the caret does not advance. A
   * beat scope, not a note one: a delete on a rest clears nothing, and a note scope would refuse it as
   * a note tool on a rest.
   */
  private refusesEntryAt(doc: ScoreDoc, cursor: EditCursor): boolean {
    const refusal = editRefusal(doc, [cursor], { family: 'beat', key: 'duration' }, null);
    if (refusal) this.host.refuse(refusal);
    return refusal !== null;
  }
}

/** Whether two cursors name the same beat. */
function sameBeat(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex
  );
}

/**
 * Writes `pitch` into the beat at `cursor` at the input duration. On a fretted staff a string holds
 * one note, so a note already on that string is replaced; on a pitched staff the same pitch again
 * takes the note out, which is how a click on a notehead removes it.
 */
function writeNote(draft: ScoreDoc, cursor: EditCursor, pitch: NotePitch, duration: DurationValue, dots: number): void {
  const beat = beatAt(draft, cursor);
  if (!beat) return;

  // Length first, so the bar settles before the note lands. Settling only removes or inserts beats
  // after this one, so `beat` is still the caret's beat.
  setBeatDurations(draft, [cursor], duration, dots);
  beat.isRest = false;

  const note: NoteDoc = { pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };

  if (pitch.kind === 'fretted') {
    const existing = beat.notes.findIndex(n => n.pitch.kind === 'fretted' && n.pitch.string === pitch.string);
    if (existing >= 0) {
      beat.notes[existing] = note;
      return;
    }
  } else {
    const existing = beat.notes.findIndex(
      n => n.pitch.kind === 'pitched' && n.pitch.noteValue === pitch.noteValue && n.pitch.octave === pitch.octave
    );
    if (existing >= 0) {
      beat.notes.splice(existing, 1);
      beat.isRest = beat.notes.length === 0;
      return;
    }
  }

  beat.notes.push(note);
}
```

In `composer.service.ts`, import it beside the structure commands:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { ComposerStructureCommands } from './composer-service-structure';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { ComposerEntryCommands, ComposerEntryHost } from './composer-entry-commands';
import { ComposerStructureCommands } from './composer-service-structure';
```

One host object serves both command classes:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  private readonly structure = new ComposerStructureCommands({
    state: () => this.stateSubject.getValue(),
    commitFollowing: edit => this.commitFollowing(edit),
    refuse: reason => this.refuse(reason),
    markDiverged: draft => this.markDiverged(draft)
  });
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** What the command modules reach back through. */
  private readonly host: ComposerEntryHost = {
    state: () => this.stateSubject.getValue(),
    commit: (edit, amend) => this.commit(edit, amend),
    commitFollowing: edit => this.commitFollowing(edit),
    refuse: reason => this.refuse(reason),
    markDiverged: draft => this.markDiverged(draft),
    moveCursor: move => this.moveCursor(move)
  };
  private readonly structure = new ComposerStructureCommands(this.host);
  private readonly entry = new ComposerEntryCommands(this.host);
```

`commit` takes a reason and `amend`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /** Applies a mutation to a cloned document and commits the result. */
  private commit(mutate: (draft: ScoreDoc) => void): void {
    const draft = structuredClone(this.stateSubject.getValue().doc);
    mutate(draft);
    this.commitDocument(draft);
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /**
   * Runs `edit` on a cloned document and commits the result - or, when `edit` returns a reason,
   * publishes that and commits nothing. With `amend` the result replaces the last commit instead of
   * adding an undo step: the second digit of a two-digit fret (`retypeNote`).
   */
  private commit(edit: (draft: ScoreDoc) => string | null | void, amend = false): void {
    const draft = structuredClone(this.stateSubject.getValue().doc);
    const reason = edit(draft);
    if (typeof reason === 'string') return this.refuse(reason);
    this.commitDocument(draft, undefined, amend);
  }
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  private commitDocument(next: ScoreDoc, selection?: { cursor: EditCursor; anchor: EditCursor | null }): void {
    const state = this.stateSubject.getValue();
    const cursor = selection ? selection.cursor : state.cursor;
    const anchor = selection ? selection.anchor : state.anchor;
    this.undoStack.push(structuredClone(state.doc));
    if (this.undoStack.length > ComposerService.MAX_HISTORY) {
      this.undoStack.shift();
    }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  private commitDocument(next: ScoreDoc, selection?: { cursor: EditCursor; anchor: EditCursor | null }, amend = false): void {
    const state = this.stateSubject.getValue();
    const cursor = selection ? selection.cursor : state.cursor;
    const anchor = selection ? selection.anchor : state.anchor;
    if (!amend) {
      this.undoStack.push(structuredClone(state.doc));
      if (this.undoStack.length > ComposerService.MAX_HISTORY) this.undoStack.shift();
    }
```

`Object.assign` returns the document, which is not a reason; the two commits that use it say so:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
    this.commit(draft => Object.assign(draft, mergeGeneratedTrack(draft, generated)));
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
    this.commit(draft => void Object.assign(draft, mergeGeneratedTrack(draft, generated)));
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
    this.commit(draft => Object.assign(draft, flattenGeneratedTrack(draft, index)));
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
    this.commit(draft => void Object.assign(draft, flattenGeneratedTrack(draft, index)));
```

Replace the note entry section with delegations:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * Whether note entry, rest entry or a delete at the caret is refused - on a generated track,
   * or in a second voice, which a click can reach in a loaded bar and bar filling cannot measure.
   * Publishes the reason and commits nothing, so a refusal costs no undo step and the caret does
   * not advance. A beat scope, not a note one: a delete on a rest clears nothing, and a note
   * scope would refuse it as a note tool on a rest.
   */
  private refusesEntryAt(doc: ScoreDoc, cursor: EditCursor): boolean {
    const refusal = editRefusal(doc, [cursor], { family: 'beat', key: 'duration' }, null);
    if (refusal) this.refuse(refusal);
    return refusal !== null;
  }

  /** Writes a note at the caret, replacing any note already on that string. */
  setNoteAtCursor(pitch: NotePitch, advance = true): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;

      // Length first, so the bar settles before the note lands. Settling only removes or
      // inserts beats after this one, so `beat` is still the caret's beat.
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
      beat.isRest = false;

      const note: NoteDoc = {
        pitch,
        isTied: false,
        accidental: 'auto',
        effects: createDefaultNoteEffects()
      };

      // On a fretted staff one string holds at most one note, so replace.
      if (pitch.kind === 'fretted') {
        const existing = beat.notes.findIndex(
          n => n.pitch.kind === 'fretted' && n.pitch.string === pitch.string
        );
        if (existing >= 0) {
          beat.notes[existing] = note;
          return;
        }
      } else {
        const existing = beat.notes.findIndex(
          n =>
            n.pitch.kind === 'pitched' &&
            n.pitch.noteValue === pitch.noteValue &&
            n.pitch.octave === pitch.octave
        );
        if (existing >= 0) {
          beat.notes.splice(existing, 1);
          beat.isRest = beat.notes.length === 0;
          return;
        }
      }

      beat.notes.push(note);
    });

    if (advance) this.moveCursorByBeat(1);
  }

  /** Turns the beat at the caret into a rest. */
  setRestAtCursor(advance = true): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.commit(draft => {
      const beat = this.beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
    });

    if (advance) this.moveCursorByBeat(1);
  }

  /**
   * Clears the beat at the caret back to a rest.
   *
   * The slot is kept rather than removed: bars are pre-filled with a full
   * measure of rests, so deleting a note should empty its position, not
   * shorten the bar.
   */
  deleteAtCursor(): void {
    const state = this.stateSubject.getValue();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.commit(draft => {
      const voice = this.voiceAt(draft, cursor);
      const beat = voice?.beats[cursor.beatIndex];
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
    });
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Writes a note at the caret, replacing any note already on that string, and by default advances. */
  setNoteAtCursor(pitch: NotePitch, advance = true): void {
    this.entry.setNoteAtCursor(pitch, advance);
  }

  /** Rewrites the note just written at `target`, as one undo step with it. See `retypeNote` in composer-entry-commands.ts. */
  retypeNote(target: EditCursor, pitch: NotePitch): void {
    this.entry.retypeNote(target, pitch);
  }

  /** Turns the beat at the caret into a rest, and by default advances. */
  setRestAtCursor(advance = true): void {
    this.entry.setRestAtCursor(advance);
  }

  /** Clears the beat at the caret back to a rest, keeping its slot. */
  deleteAtCursor(): void {
    this.entry.deleteAtCursor();
  }
```

The model import no longer needs `NoteDoc` or `createDefaultNoteEffects`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  MasterBarDoc,
  NoteDoc,
  NoteEffectsDoc,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  MasterBarDoc,
  NoteEffectsDoc,
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  createDefaultMasterBar,
  createDefaultPlaybackInfo,
```

**Step 4: Run** `composer.service.editing.spec.ts`, `composer.service.spec.ts` and
`composer.service.generated.spec.ts`, then both type checks. Expected: all SUCCESS. The entry
specs M1 wrote pass unchanged: they call the same service methods.

**Step 5: Commit**: `feat: Make a two-digit fret one undo step, and lift note entry out of the service`.

### Task 1.7: Where a hammer-on, a slide and a tie land

alphaTab drops a hammer-on or pull-off, and a shift or legato slide, that has nothing to land on
(`Note.finish`, `alphaTab.core.mjs` ~6282-6303 in 1.8), and draws a tied note with the vibrato of the
note it is tied from (~48360, ~63881, ~64605). The tools need to ask the same questions of a
`ScoreDoc` before a press. This task mirrors the three lookups and checks the first two against
alphaTab itself: the spec builds each layout, finishes it through the mapper, and compares.

The rules, read from the 1.8 source and then measured, because the source's own bound is not the one
that applies:

- **`Note.nextNoteOnSameLine`** (~6477) walks `Beat.nextBeat` while the beat's bar index is at most
  the note's plus 3 (`_maxOffsetForSameLineSearch`), and returns the first note on the same string.
- **`Note.findHammerPullDestination`** (~6489) walks the same beats. On each: a note on the same
  string is the destination; otherwise the nearest note on a lower string, if left-hand tapped, and
  then the nearest on a higher string, if left-hand tapped; otherwise the next beat. A note that is not
  tapped only stops the search in its direction on that beat.
- **The walk reaches the rest of the note's bar and the next bar's first beat, not three bars.**
  `Staff.finish` finishes bars in order (~12707), and `Voice.finish` (~3195) first chains every beat
  of its voice - which links its last beat to the next bar's first (`Voice._chain`, ~3154-3170) - and
  only then finishes them. So when a note finishes, the next bar's first beat is reachable but its own
  `nextBeat` is not linked yet, and the walk ends there. A probe through `mapper.toScore` and through
  alphaTex export and parse agreed: a note at bar 0 keeps a hammer-on or slide landing on bar 1's
  first beat and loses one landing on bar 1's second beat, or on any later bar; from bar 1, bar 2's
  first beat lands and bar 3's does not. The three-bar bound never takes effect on a score finished
  this way, which is every score the composer renders, saves or loads.
- **`Note.findTieOrigin`** (~6530) walks `previousBeat` back while the bar index is at least the
  note's minus 3: a stringed note's origin is the first note on its string, a pitched note's the first
  note with its real value. Earlier bars are already chained, so this bound does apply - probed: a tie
  at bar 5 finds an origin in bar 2 and none in bar 1, and with no origin alphaTab clears
  `isTieDestination`.
- A pitched note has no string (`Note.string` stays -1, and `Beat.addNote` files only stringed notes in
  `noteStringLookup`, ~7662), so a pitched note's hammer-on and slide never land.
- alphaTab has no notes on a rest, and the mapper writes none there.

**Files:**
- Create: `client/src/app/services/note-landing.ts`
- Test: `client/src/app/services/note-landing.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/note-landing.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { hammerDestinationOf, slideTargetOf, tieOriginOf } from './note-landing';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { insertBarInto } from './score-structure';
import { NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * The landing rules, checked against alphaTab rather than only against what we believe it does: each
 * layout is finished through the mapper, which runs `Score.finish`, and alphaTab's own answer - does
 * the hammer-on survive, does the slide - must match the predicate's.
 */
describe('note landing', () => {
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  const ref = (barIndex: number, beatIndex: number, trackIndex = 0): BeatRef =>
    ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });

  /** Puts a fretted note on `string` at bar `bar`, beat `beat`, and returns it. */
  function put(doc: ScoreDoc, bar: number, beat: number, string: number, fret = 5, tapped = false): NoteDoc {
    const target = doc.tracks[0].staves[0].bars[bar].voices[0].beats[beat];
    const note: NoteDoc = { pitch: { kind: 'fretted', string, fret }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };
    note.effects.isLeftHandTapped = tapped;
    target.isRest = false;
    target.notes.push(note);
    return note;
  }

  /** alphaTab's finished note at the same place as `note` in bar 0, beat 0. */
  function finished(doc: ScoreDoc, noteIndex = 0): alphaTab.model.Note {
    const score = mapper.toScore(doc, new alphaTab.Settings());
    return score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[noteIndex];
  }

  /**
   * Layouts after a note on string 3 at bar 0, beat 0, each named for what follows it. The last four
   * pin the reach: the next bar's first beat lands, its second beat and anything later do not,
   * whatever `_maxOffsetForSameLineSearch` says - see the task for why.
   */
  const layouts: { name: string; build: (doc: ScoreDoc) => void }[] = [
    { name: 'a note on the same string next beat', build: doc => void put(doc, 0, 1, 3) },
    { name: 'a note on the same string at the end of the bar', build: doc => void put(doc, 0, 3, 3) },
    { name: 'nothing at all', build: () => undefined },
    { name: 'a note on another string, not tapped', build: doc => void put(doc, 0, 1, 2) },
    { name: 'a left-hand tap on another string', build: doc => void put(doc, 0, 1, 1, 9, true) },
    { name: 'a left-hand tap on the next bar\'s second beat', build: doc => void put(doc, 1, 1, 1, 9, true) },
    { name: 'a note on the same string on the next bar\'s first beat', build: doc => void put(doc, 1, 0, 3) },
    { name: 'a note on the same string on the next bar\'s second beat', build: doc => void put(doc, 1, 1, 3) },
    { name: 'a note on the same string three bars on', build: doc => void put(doc, 3, 0, 3) },
    { name: 'a note on the same string in a fifth bar', build: doc => {
      insertBarInto(doc, doc.masterBars.length);
      put(doc, 4, 0, 3);
    } }
  ];

  it('lands from a later bar on the bar after it, too', () => {
    const doc = ComposerService.createEmptyScore();
    const note = put(doc, 1, 3, 3);
    note.effects.isHammerPullOrigin = true;
    put(doc, 2, 0, 3);

    const score = mapper.toScore(doc, new alphaTab.Settings());
    expect(hammerDestinationOf(doc, ref(1, 3), note)).not.toBeNull();
    expect(score.tracks[0].staves[0].bars[1].voices[0].beats[3].notes[0].isHammerPullOrigin).toBeTrue();
  });

  it('finds no origin for a tie more than three bars after its note, as alphaTab finds none', () => {
    const doc = ComposerService.createEmptyScore();
    insertBarInto(doc, doc.masterBars.length);
    put(doc, 0, 3, 3);
    const tied = put(doc, 4, 0, 3);
    tied.isTied = true;

    const score = mapper.toScore(doc, new alphaTab.Settings());
    expect(tieOriginOf(doc, ref(4, 0), tied)).toBeNull();
    expect(score.tracks[0].staves[0].bars[4].voices[0].beats[0].notes[0].isTieDestination).toBeFalse();
  });

  for (const layout of layouts) {
    it(`agrees with alphaTab on a hammer-on followed by ${layout.name}`, () => {
      const doc = ComposerService.createEmptyScore();
      const note = put(doc, 0, 0, 3);
      note.effects.isHammerPullOrigin = true;
      layout.build(doc);

      expect(hammerDestinationOf(doc, ref(0, 0), note) !== null).toBe(finished(doc).isHammerPullOrigin);
    });

    it(`agrees with alphaTab on a legato slide followed by ${layout.name}`, () => {
      const doc = ComposerService.createEmptyScore();
      const note = put(doc, 0, 0, 3);
      note.effects.slide = 'legatoSlide';
      layout.build(doc);

      const kept = finished(doc).slideOutType !== alphaTab.model.SlideOutType.None;
      expect(slideTargetOf(doc, ref(0, 0), note) !== null).toBe(kept);
    });
  }

  it('finds no destination for a pitched note, which alphaTab files on no string', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const beats = doc.tracks[1].staves[0].bars[0].voices[0].beats;
    const pitched = (): NoteDoc => ({ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });
    beats[0] = { ...beats[0], isRest: false, notes: [pitched()] };
    beats[1] = { ...beats[1], isRest: false, notes: [pitched()] };

    expect(hammerDestinationOf(doc, ref(0, 0, 1), beats[0].notes[0])).toBeNull();
    expect(slideTargetOf(doc, ref(0, 0, 1), beats[0].notes[0])).toBeNull();
  });

  it('finds a tied note\'s origin on its string, across a bar line', () => {
    const doc = ComposerService.createEmptyScore();
    const origin = put(doc, 0, 3, 3);
    const tied = put(doc, 1, 0, 3);
    tied.isTied = true;

    expect(tieOriginOf(doc, ref(1, 0), tied)).toBe(origin);
  });

  it('finds no origin for a note that is not tied, or one with nothing before it', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0, 3);
    const untied = put(doc, 0, 1, 3);
    const lonely = put(doc, 0, 2, 1);
    lonely.isTied = true;

    expect(tieOriginOf(doc, ref(0, 1), untied)).toBeNull();
    expect(tieOriginOf(doc, ref(0, 2), lonely)).toBeNull();
  });

  it('finds a pitched tied note\'s origin by its pitch', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const beats = doc.tracks[1].staves[0].bars[0].voices[0].beats;
    const pitched = (noteValue: number, isTied: boolean): NoteDoc => ({ pitch: { kind: 'pitched', noteValue, octave: 4 }, isTied, accidental: 'auto', effects: createDefaultNoteEffects() });
    beats[0] = { ...beats[0], isRest: false, notes: [pitched(0, false), pitched(4, false)] };
    beats[1] = { ...beats[1], isRest: false, notes: [pitched(4, true)] };

    expect(tieOriginOf(doc, ref(0, 1, 1), beats[1].notes[0])).toBe(beats[0].notes[1]);
  });
});
```

**Step 2: Run it** with `--include=src/app/services/note-landing.spec.ts`. Expected: a compile error,
`TS2307: Cannot find module './note-landing' or its corresponding type declarations.`

**Step 3: Implement**

<!-- apply: create client/src/app/services/note-landing.ts -->
```typescript
import { BeatDoc, NoteDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';

/**
 * Where a note's technique lands, asked of a `ScoreDoc` the way alphaTab 1.8 asks it of a finished
 * score, so a tool can refuse what a save would drop.
 *
 * Mirrors three lookups on alphaTab's `Note` (`alphaTab.core.mjs` in 1.8): `nextNoteOnSameLine`
 * (~6477) and `findHammerPullDestination` (~6489), which `Note.finish` uses to keep or clear a slide
 * and a hammer-on (~6282-6303), and `findTieOrigin` (~6530), whose answer the renderer and the MIDI
 * generator read a tied note's vibrato from (~48360, ~63881, ~64605). `note-landing.spec.ts` checks
 * the first two against alphaTab itself, layout by layout.
 */

/** alphaTab's `Note._maxOffsetForSameLineSearch`: how many bars back a tie's origin is looked for. */
const SAME_LINE_BAR_REACH = 3;

/**
 * The beats a forward search from `ref` reaches when alphaTab finishes a score: the rest of `ref`'s bar
 * in its voice, and the next bar's first beat in the same voice.
 *
 * Not the three bars `Note.nextNoteOnSameLine` and `findHammerPullDestination` are written to search.
 * `Staff.finish` finishes bars in order (~12707), and `Voice.finish` (~3195) chains all of its beats -
 * linking its last to the next bar's first (`Voice._chain`, ~3154-3170) - before finishing any. So when
 * a note is finished the next bar's first beat is linked, and nothing after it is yet.
 * `note-landing.spec.ts` pins this against alphaTab layout by layout.
 */
function beatsAfter(doc: ScoreDoc, ref: BeatRef): BeatDoc[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const inBar = bars[ref.barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
  const nextFirst = bars[ref.barIndex + 1]?.voices[ref.voiceIndex]?.beats[0];
  return nextFirst ? [...inBar.slice(ref.beatIndex + 1), nextFirst] : inBar.slice(ref.beatIndex + 1);
}

/**
 * The beats before `ref`'s in its voice, nearest first, as `Beat.previousBeat` walks them, back to the
 * bar three before `ref`'s. Earlier bars are chained by the time a note finishes, so this bound is the
 * one alphaTab applies. The chain breaks at a bar whose voice has no beats, so the walk stops there.
 */
function beatsBefore(doc: ScoreDoc, ref: BeatRef): BeatDoc[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const beats: BeatDoc[] = [];
  const first = Math.max(0, ref.barIndex - SAME_LINE_BAR_REACH);
  for (let barIndex = ref.barIndex; barIndex >= first; barIndex--) {
    const inBar = bars[barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
    if (barIndex < ref.barIndex && inBar.length === 0) break;
    beats.push(...(barIndex === ref.barIndex ? inBar.slice(0, ref.beatIndex) : inBar).reverse());
  }
  return beats;
}

/** The note alphaTab finds on tab string `string` of `beat`. A rest has none: the mapper writes no notes on one. */
function noteOnString(beat: BeatDoc, string: number): NoteDoc | null {
  if (beat.isRest) return null;
  return beat.notes.find(note => note.pitch.kind === 'fretted' && note.pitch.string === string) ?? null;
}

/**
 * The note on `beat` on the nearest string numbered below `string` (`direction` -1) or above it (+1).
 * alphaTab numbers strings the other way up from tab numbering, but it searches both directions, so
 * which is which does not change whether a destination exists.
 */
function nearestNote(beat: BeatDoc, string: number, direction: -1 | 1): NoteDoc | null {
  if (beat.isRest) return null;
  let nearest: NoteDoc | null = null;
  for (const note of beat.notes) {
    if (note.pitch.kind !== 'fretted') continue;
    const distance = (note.pitch.string - string) * direction;
    if (distance <= 0) continue;
    if (!nearest || (nearest.pitch.kind === 'fretted' && distance < (nearest.pitch.string - string) * direction)) nearest = note;
  }
  return nearest;
}

/**
 * The note a hammer-on or pull-off on `note` would land on, or null when alphaTab would drop it: on the
 * first beat after it - later in its bar, or the next bar's first beat (`beatsAfter`) - with a note on
 * the same string, or a left-hand tap on the nearest string below or above where that string has no
 * note. A pitched note has no string, so it never lands.
 */
export function hammerDestinationOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (note.pitch.kind !== 'fretted') return null;
  const string = note.pitch.string;
  for (const beat of beatsAfter(doc, ref)) {
    const same = noteOnString(beat, string);
    if (same) return same;
    const below = nearestNote(beat, string, -1);
    if (below?.effects.isLeftHandTapped) return below;
    const above = nearestNote(beat, string, 1);
    if (above?.effects.isLeftHandTapped) return above;
  }
  return null;
}

/**
 * The note a shift or legato slide on `note` would run into, or null when alphaTab would drop it: the
 * first note on the same string later in its bar or on the next bar's first beat (`beatsAfter`). A
 * pitched note has no string, so it never lands.
 */
export function slideTargetOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (note.pitch.kind !== 'fretted') return null;
  const string = note.pitch.string;
  for (const beat of beatsAfter(doc, ref)) {
    const same = noteOnString(beat, string);
    if (same) return same;
  }
  return null;
}

/**
 * The note a tied `note` is tied from, as alphaTab finds it, or null when `note` is not tied or has no
 * origin within three bars back: on a string, the nearest earlier note on the same string; pitched,
 * the nearest earlier note of the same pitch.
 */
export function tieOriginOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (!note.isTied) return null;
  const pitch = note.pitch;
  for (const beat of beatsBefore(doc, ref)) {
    if (pitch.kind === 'fretted') {
      const same = noteOnString(beat, pitch.string);
      if (same) return same;
    } else if (!beat.isRest) {
      const same = beat.notes.find(
        other => other.pitch.kind === 'pitched' && other.pitch.noteValue === pitch.noteValue && other.pitch.octave === pitch.octave
      );
      if (same) return same;
    }
  }
  return null;
}
```

**Step 4: Run it.** Expected: 26 SUCCESS. If a layout disagrees, alphaTab's rule has changed: read
`Note.finish`, `Voice.finish` and `Staff.finish` in the installed version before changing the predicate.

**Step 5: Commit**: `feat: Ask where a hammer-on, a slide and a tie land, as alphaTab does`.

### Task 1.8: Note effects refuse what alphaTab would drop, and clear what they can

Four rules join the note effect press (design decisions 1, 13 and 15):

- **Nothing to land on.** Turning a hammer-on, or a shift or legato slide, on for a caret whose note
  has nothing to land on is refused, saying why. On a range, the notes that can land take it and the
  rest are skipped, as a note tool skips rests; only a range where no note can land is refused. The
  toggle rule reads the notes that can land, so a range whose last note cannot hold a hammer-on still
  turns off when every other note has one. A hammer-on on a pitched staff, which never lands, is
  refused as a fretted technique.
- **Vibrato on a tied note** is refused, both ways: alphaTab draws a continuation with its origin's
  vibrato, so a press there would write a value no one can see.
- **Clearing is allowed on a pitched staff.** A press that would *clear* a fretted-only technique -
  a natural harmonic an alphaTex import put on a piano note - passes. Only turning one on is refused.
  This is decision 15 made general: every fretted-only note technique, not only the harmonic, since
  clearing any of them from a pitched note removes something alphaTab cannot use there.
- A clear reaches every note the press means, including notes that could not hold the value.

**Files:**
- Modify: `client/src/app/services/note-edits.ts`, `client/src/app/services/edit-refusals.ts`,
  `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/note-edits.spec.ts`, `client/src/app/services/edit-refusals.spec.ts`,
  `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs.** Append to `note-edits.spec.ts`:

<!-- apply: append client/src/app/services/note-edits.spec.ts -->
```typescript
describe('toggleNoteEffect with a hammer-on', () => {
  it('puts it on the notes that can land and skips the last, then clears them all', () => {
    // Beat 1's note is the last on string 1 in the score, so it has nothing to land on.
    const doc = chordDoc();
    const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'isHammerPullOrigin', true, false);
    expect(beats[0].notes.map(note => note.effects.isHammerPullOrigin)).toEqual([true, false]);
    expect(beats[1].notes[0].effects.isHammerPullOrigin).toBeFalse();

    toggleNoteEffect(doc, [ref(0), ref(1)], null, 'isHammerPullOrigin', true, false);
    expect(beats[0].notes[0].effects.isHammerPullOrigin).toBeFalse();
  });
});
```

Append to `edit-refusals.spec.ts`, importing `noteEffectRefusal`:

<!-- apply: find client/src/app/services/edit-refusals.spec.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal } from './edit-refusals';
```

<!-- apply: replace client/src/app/services/edit-refusals.spec.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal, noteEffectRefusal } from './edit-refusals';
```

<!-- apply: append client/src/app/services/edit-refusals.spec.ts -->
```typescript
describe('noteEffectRefusal', () => {
  /** The guitar note at beat 0 followed, at beat 1, by a note on string 1 too. */
  function withFollower(): ScoreDoc {
    const score = doc();
    const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[1];
    beat.isRest = false;
    beat.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 2 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    return score;
  }

  it('refuses a hammer-on with nothing to land on, saying so', () => {
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'isHammerPullOrigin', true, false)).toMatch(/land/i);
  });

  it('allows a hammer-on with a note after it on the string', () => {
    expect(noteEffectRefusal(withFollower(), [ref(0)], null, 'isHammerPullOrigin', true, false)).toBeNull();
  });

  it('refuses a legato or shift slide with nothing to land on, and not a slide out', () => {
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'legatoSlide', 'none')).toMatch(/land/i);
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'shiftSlide', 'none')).toMatch(/land/i);
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'slideOutUp', 'none')).toBeNull();
  });

  it('lets a press that clears a hammer-on through, landing or not', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.isHammerPullOrigin = true;

    expect(noteEffectRefusal(score, [ref(0)], null, 'isHammerPullOrigin', true, false)).toBeNull();
  });

  it('refuses a hammer-on on a pitched staff as a fretted technique', () => {
    expect(noteEffectRefusal(doc(), [ref(1)], null, 'isHammerPullOrigin', true, false)).toMatch(/fretted/i);
  });

  it('lets a press that clears a natural harmonic through on a pitched staff, and refuses one that sets it', () => {
    const score = doc();
    score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

    expect(noteEffectRefusal(score, [ref(1)], null, 'harmonic', 'natural', 'none')).toBeNull();
    expect(noteEffectRefusal(score, [ref(1)], null, 'harmonic', 'artificial', 'none')).toMatch(/fretted/i);
  });

  it('refuses vibrato on a tied note either way, saying it belongs to the note it is tied from', () => {
    const score = withFollower();
    const tied = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    tied.isTied = true;

    expect(noteEffectRefusal(score, [ref(0, 1)], null, 'vibrato', 'slight', 'none')).toMatch(/tied from/i);
    tied.effects.vibrato = 'slight';
    expect(noteEffectRefusal(score, [ref(0, 1)], null, 'vibrato', 'slight', 'none')).toMatch(/tied from/i);
  });

  it('still refuses a rest and a generated track', () => {
    expect(noteEffectRefusal(doc(), [ref(0, 2)], null, 'isGhost', true, false)).toMatch(/note/i);
    const score = doc();
    score.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };
    expect(noteEffectRefusal(score, [ref(0)], null, 'isGhost', true, false)).toMatch(/progression/i);
  });
});
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService note effects that must land', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a hammer-on on the last note, commits nothing, and says why', () => {
    writeFret(service, 0, 0, 5);
    const before = JSON.stringify(service.doc);

    service.toggleNoteEffect('isHammerPullOrigin', true, false);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/land/i);
    expect(stateOf(service).canUndo).toBeTrue();
  });

  it('puts a hammer-on on a note that has one to land on', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });

    service.toggleNoteEffect('isHammerPullOrigin', true, false);

    expect(beatsIn(service)[0].notes[0].effects.isHammerPullOrigin).toBeTrue();
  });
});
```

**Step 2: Run** the three spec files. Expected: a compile error,
`TS2305: Module '"./edit-refusals"' has no exported member 'noteEffectRefusal'.`

**Step 3: Implement.** In `note-edits.ts`, replace the imports and `notesAt` with note targets that
keep their beat:

<!-- apply: find client/src/app/services/note-edits.ts -->
```typescript
import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
```

<!-- apply: replace client/src/app/services/note-edits.ts -->
```typescript
import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { hammerDestinationOf, slideTargetOf } from './note-landing';
```

<!-- apply: find client/src/app/services/note-edits.ts -->
```typescript
export function notesAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteDoc[] {
  const single = refs.length === 1;
  return refs.flatMap(ref => {
    const beat = beatAt(doc, ref);
    if (!beat) return [];
    const fretted = (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) > 0;
    if (single && fretted && focus !== null) {
      return beat.notes.filter(note => note.pitch.kind === 'fretted' && note.pitch.string === focus + 1);
    }
    return beat.notes;
  });
}

/** Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value. */
export function toggleNoteEffect<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): void {
  const notes = notesAt(doc, refs, focus);
  const value = toggledValue(notes.map(note => note.effects[key]), on, off);
  for (const note of notes) note.effects[key] = structuredClone(value);
}
```

<!-- apply: replace client/src/app/services/note-edits.ts -->
```typescript
export function notesAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteDoc[] {
  return noteTargetsAt(doc, refs, focus).map(target => target.note);
}

/** A note a press means, and the beat it is on. */
export interface NoteTarget {
  ref: BeatRef;
  note: NoteDoc;
}

/** `notesAt`, keeping each note's beat: what a check that looks past the note - where it lands - needs. */
export function noteTargetsAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteTarget[] {
  const single = refs.length === 1;
  return refs.flatMap(ref => {
    const beat = beatAt(doc, ref);
    if (!beat) return [];
    const fretted = (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) > 0;
    const notes =
      single && fretted && focus !== null
        ? beat.notes.filter(note => note.pitch.kind === 'fretted' && note.pitch.string === focus + 1)
        : beat.notes;
    return notes.map(note => ({ ref, note }));
  });
}

/**
 * Whether `note` can hold `value` for `key`, or null when any note can: a hammer-on and a shift or
 * legato slide need somewhere to land (`note-landing.ts`), since alphaTab drops them otherwise.
 */
function landingOf<K extends keyof NoteEffectsDoc>(key: K, value: NoteEffectsDoc[K]): ((doc: ScoreDoc, ref: BeatRef, note: NoteDoc) => NoteDoc | null) | null {
  if (key === 'isHammerPullOrigin' && value === true) return hammerDestinationOf;
  if (key === 'slide' && (value === 'shiftSlide' || value === 'legatoSlide')) return slideTargetOf;
  return null;
}

/**
 * The notes a press of `key` with `on` reads and sets: the notes it means that can hold `on`, or all
 * of them when none can - which `noteEffectRefusal` refuses unless the press clears.
 */
export function noteEffectTargets<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K]
): NoteTarget[] {
  const all = noteTargetsAt(doc, refs, focus);
  const lands = landingOf(key, on);
  if (!lands) return all;
  const landing = all.filter(target => lands(doc, target.ref, target.note) !== null);
  return landing.length > 0 ? landing : all;
}

/**
 * Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value.
 *
 * The rule reads the notes that can hold the value (`noteEffectTargets`), so a range ending on a note
 * with nothing to land on still turns a hammer-on off once every other note has one. Turning on writes
 * only those notes; a clear writes every note the press means.
 */
export function toggleNoteEffect<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): void {
  const targets = noteEffectTargets(doc, refs, focus, key, on);
  const value = toggledValue(targets.map(target => target.note.effects[key]), on, off);
  const written = value === on ? targets : noteTargetsAt(doc, refs, focus);
  for (const { note } of written) note.effects[key] = structuredClone(value);
}
```

In `edit-refusals.ts`, the imports and a scope for a clear:

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```typescript
import { BeatRef, beatAt } from './composer-selection';
import { notesAt } from './note-edits';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
```

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```typescript
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { noteEffectTargets, noteTargetsAt, notesAt } from './note-edits';
import { hammerDestinationOf, slideTargetOf, tieOriginOf } from './note-landing';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```typescript
  | { family: 'note'; key: keyof NoteEffectsDoc | 'tie' }
```

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```typescript
  | { family: 'note'; key: keyof NoteEffectsDoc | 'tie' }
  // A press that needs only notes to act on - a clear, a respell, a move of pitch or string. Refused
  // where any note edit is, never as a fretted-only technique: clearing one from a pitched note removes
  // what alphaTab cannot use there, and the moves say for themselves what does not fit.
  | { family: 'note'; key: 'notes' }
```

`drawnPitchClassOf` is needed by Task 1.11's respell, so export it:

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```typescript
function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
```

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```typescript
export function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
```

Append the refusal:

<!-- apply: append client/src/app/services/edit-refusals.ts -->
```typescript
const HAMMER_ON_NOTHING_FOLLOWS =
  'A hammer-on or pull-off needs a note to land on - on the same string, or a left-hand tap on another - later in the bar ' +
  "or on the next bar's first beat. With nothing to land on it would not save.";

const SLIDE_NOTHING_FOLLOWS =
  "A shift or legato slide needs a note on the same string later in the bar or on the next bar's first beat. " +
  'With nothing to land on it would not save.';

const HAMMER_ON_PITCHED = 'A hammer-on or pull-off lands on a string, so it belongs to fretted staves.';

const VIBRATO_ON_TIE = 'Vibrato on a tied note belongs to the note it is tied from.';

/**
 * Why pressing a note effect tool - `key` set to `on`, by the toggle rule, or cleared to `off` - cannot
 * apply to `refs`, or null when it can.
 *
 * - A clear is refused only where any note edit is: nothing selected, a generated track, a second
 *   voice, no note (the `notes` scope). A fretted-only technique can be cleared from a pitched note.
 * - Turning an effect on is refused as `editRefusal` refuses it, and also when no note it means can
 *   hold it: a hammer-on, or a shift or legato slide, with nothing to land on. A range skips the notes
 *   that cannot land (`noteEffectTargets`).
 * - Vibrato on a tied note is refused either way. alphaTab draws and plays a tie destination with its
 *   origin's vibrato (`tieOriginOf`), so a continuation's own value changes nothing anyone can see or
 *   hear - and writing one stops alphaTab carrying a bend across the tie.
 */
export function noteEffectRefusal<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus);
  if (refusal) return refusal;

  const all = noteTargetsAt(doc, refs, focus);
  if (key === 'vibrato' && all.some(target => tieOriginOf(doc, target.ref, target.note) !== null)) return VIBRATO_ON_TIE;

  const targets = noteEffectTargets(doc, refs, focus, key, on);
  if (toggledValue(targets.map(target => target.note.effects[key]), on, off) !== on) return null;

  const scoped = editRefusal(doc, refs, { family: 'note', key }, focus);
  if (scoped) return scoped;

  // Nothing to land on: no note the press means has a destination, so `noteEffectTargets` fell back to
  // all of them. A pitched note never has one, so a press on pitched notes alone is told why.
  if (key === 'isHammerPullOrigin' && !all.some(target => hammerDestinationOf(doc, target.ref, target.note))) {
    return all.every(target => target.note.pitch.kind === 'pitched') ? HAMMER_ON_PITCHED : HAMMER_ON_NOTHING_FOLLOWS;
  }
  if (key === 'slide' && (on === 'shiftSlide' || on === 'legatoSlide') && !all.some(target => slideTargetOf(doc, target.ref, target.note))) {
    return SLIDE_NOTHING_FOLLOWS;
  }
  return null;
}
```

In `composer.service.ts`, the note effect press asks the new refusal. Import it:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal } from './edit-refusals';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { EditScope, durationRefusal, editRefusal, noteEffectRefusal } from './edit-refusals';
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit({ family: 'note', key }, (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off));
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Presses a note effect tool on the selection. See `toggleNoteEffect` in note-edits.ts, and `noteEffectRefusal`. */
  toggleNoteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): void {
    this.applyEdit(
      (doc, refs, focus) => noteEffectRefusal(doc, refs, focus, key, on, off),
      (draft, refs, focus) => toggleNoteEffect(draft, refs, focus, key, on, off)
    );
  }
```

`applyEdit` takes a scope or a refusal of its own:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  private applyEdit(
    scope: EditScope,
    edit: (draft: ScoreDoc, refs: BeatRef[], focus: number | null) => void
  ): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const focus = state.anchor ? null : state.cursor.stringIndex;
    const refusal = editRefusal(state.doc, refs, scope, focus);
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  private applyEdit(
    scope: EditScope | ((doc: ScoreDoc, refs: BeatRef[], focus: number | null) => string | null),
    edit: (draft: ScoreDoc, refs: BeatRef[], focus: number | null) => string | null | void
  ): void {
    const state = this.stateSubject.getValue();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const focus = state.anchor ? null : state.cursor.stringIndex;
    const refusal = typeof scope === 'function' ? scope(state.doc, refs, focus) : editRefusal(state.doc, refs, scope, focus);
```

**Step 4: Run** the three spec files and `composer.service.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Refuse a hammer-on, slide or tied vibrato alphaTab would drop, and let a clear through`.

### Task 1.9: Default values, and a trill aimed at each note's own whole step

M2's bend, fermata, trill and tuplet tools apply fixed values until M4 gives them editors (design Part
1). A trill cannot be a single value pressed onto every note: `TrillDoc.value` is a pitch, so each
note's trill has to be aimed at its own whole step - open string plus capo plus fret plus 2 on a
string, or its own pitch plus 2 - which is why the trill gets a toggle of its own.

**Files:**
- Create: `client/src/app/services/composer-tool-defaults.ts`
- Modify: `client/src/app/services/note-edits.ts`, `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer-tool-defaults.spec.ts`, `client/src/app/services/note-edits.spec.ts`

**Step 1: Failing specs.** Every default must survive a save, so the spec sends each through alphaTex:

<!-- apply: create client/src/app/services/composer-tool-defaults.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerService } from './composer.service';
import { DEFAULT_TRILL_SPEED, TUPLET_CHOICES, defaultFermata, fullBendPoints } from './composer-tool-defaults';
import { toggleTrill } from './note-edits';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { BeatDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * The values the palette applies until M4's editors, each through the path a save and a load take.
 * A default alphaTab reshapes or drops would put a mark on the page that a reload takes away.
 */
describe('composer tool defaults', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
  });

  /** `doc` as a save and a load hand it back. */
  function throughTex(doc: ScoreDoc): ScoreDoc {
    const parsed = tex.parse(tex.export(mapper.toScore(doc, new alphaTab.Settings())));
    if (!parsed.score) throw new Error('exported alphaTex did not parse');
    return mapper.toDoc(parsed.score);
  }

  /** An empty score whose guitar's first beat is fret 5 on the G string, with a piano whose first beat is C4. */
  function scoreWithNotes(): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const guitar = doc.tracks[0].staves[0].bars[0].voices[0].beats[0];
    guitar.isRest = false;
    guitar.notes = [{ pitch: { kind: 'fretted', string: 3, fret: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    const piano = doc.tracks[1].staves[0].bars[0].voices[0].beats[0];
    piano.isRest = false;
    piano.notes = [{ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    return doc;
  }

  const firstBeat = (doc: ScoreDoc, trackIndex: number): BeatDoc => doc.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0];

  it('bends a whole tone in a shape alphaTab keeps through a save', () => {
    const doc = scoreWithNotes();
    firstBeat(doc, 0).notes[0].effects.bendPoints = fullBendPoints();

    expect(firstBeat(throughTex(doc), 0).notes[0].effects.bendPoints).toEqual(fullBendPoints());
  });

  it('keeps the default fermata through a save', () => {
    const doc = scoreWithNotes();
    firstBeat(doc, 0).effects.fermata = defaultFermata();

    expect(firstBeat(throughTex(doc), 0).effects.fermata).toEqual(defaultFermata());
  });

  it('keeps every offered tuplet through a save', () => {
    for (const tuplet of TUPLET_CHOICES) {
      const doc = scoreWithNotes();
      firstBeat(doc, 0).tuplet = { ...tuplet };

      expect(firstBeat(throughTex(doc), 0).tuplet).withContext(`${tuplet.numerator}:${tuplet.denominator}`).toEqual({ ...tuplet });
    }
  });

  it('trills a whole step above a fretted note and a pitched one, and both survive a save', () => {
    const doc = scoreWithNotes();
    const at = (trackIndex: number) => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    toggleTrill(doc, [at(0)], null);
    toggleTrill(doc, [at(1)], null);

    // The G string is 55, so fret 5 is C4, 60, and a whole step above is 62; the piano's C4 likewise.
    const back = throughTex(doc);
    expect(firstBeat(back, 0).notes[0].effects.trill).toEqual({ value: 62, speed: DEFAULT_TRILL_SPEED });
    expect(firstBeat(back, 1).notes[0].effects.trill).toEqual({ value: 62, speed: DEFAULT_TRILL_SPEED });
  });
});
```

Append to `note-edits.spec.ts`, importing `toggleTrill` beside the others:

<!-- apply: find client/src/app/services/note-edits.spec.ts -->
```typescript
import { notesAt, setAccidental, toggleNoteEffect, toggleTie } from './note-edits';
```

<!-- apply: replace client/src/app/services/note-edits.spec.ts -->
```typescript
import { notesAt, setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
```

<!-- apply: append client/src/app/services/note-edits.spec.ts -->
```typescript
describe('toggleTrill', () => {
  it('aims each note of a chord a whole step above itself, capo included, and a second press clears them', () => {
    // String 1 (E, 64) at fret 0 and string 2 (B, 59) at fret 1, under a capo at 2.
    const doc = chordDoc();
    doc.tracks[0].staves[0].capo = 2;
    const notes = doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;

    toggleTrill(doc, [ref(0)], null);
    expect(notes.map(note => note.effects.trill?.value)).toEqual([68, 64]);

    toggleTrill(doc, [ref(0)], null);
    expect(notes.map(note => note.effects.trill)).toEqual([null, null]);
  });

  it('gives every note a trill when some already have one', () => {
    const doc = chordDoc();
    const notes = doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    notes[0].effects.trill = { value: 70, speed: 32 };

    toggleTrill(doc, [ref(0)], null);

    expect(notes.map(note => note.effects.trill)).toEqual([{ value: 66, speed: 16 }, { value: 62, speed: 16 }]);
  });
});
```

**Step 2: Run** both spec files. Expected: compile errors,
`TS2307: Cannot find module './composer-tool-defaults' or its corresponding type declarations.` and
`TS2724: '"./note-edits"' has no exported member named 'toggleTrill'. Did you mean 'toggleTie'?`

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-tool-defaults.ts -->
```typescript
import { BendPointDoc, FermataDoc, TrillDoc, Tuplet } from '../models/composer.model';

/**
 * The values M2's tools apply where M4 will give them an editor: a bend, a fermata, a trill's speed and
 * interval, and the tuplets the tuplet popover offers.
 *
 * The structured values are functions rather than constants, so no press can hand one object to two
 * notes or beats: every caller gets its own copy. `composer-tool-defaults.spec.ts` sends each through a
 * save, because a default alphaTab reshapes would draw a mark a reload changes.
 */

/**
 * A full bend: a whole tone - 4 quarter tones - reached by the end of the note. Two points at offsets 0
 * and 60 are exactly the shape alphaTab keeps for its plain `Bend` type, so `Note.finish`, which
 * rewrites any bend of two to four points into one of Guitar Pro's shapes, leaves it as written.
 */
export function fullBendPoints(): BendPointDoc[] {
  return [
    { offset: 0, value: 0 },
    { offset: 60, value: 4 }
  ];
}

/** A medium fermata held for its written length. */
export function defaultFermata(): FermataDoc {
  return { type: 'medium', length: 1 };
}

/** A trill in sixteenth notes. */
export const DEFAULT_TRILL_SPEED: TrillDoc['speed'] = 16;

/** How far above its note a default trill alternates, in semitones: a whole step. */
export const TRILL_INTERVAL = 2;

/** The tuplets the tuplet popover offers until M4's custom tuplet editor. */
export const TUPLET_CHOICES: readonly Readonly<Tuplet>[] = [
  { numerator: 3, denominator: 2 },
  { numerator: 5, denominator: 4 },
  { numerator: 6, denominator: 4 },
  { numerator: 7, denominator: 4 }
];
```

In `note-edits.ts`:

<!-- apply: find client/src/app/services/note-edits.ts -->
```typescript
import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
```

<!-- apply: replace client/src/app/services/note-edits.ts -->
```typescript
import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc, StaffDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { DEFAULT_TRILL_SPEED, TRILL_INTERVAL } from './composer-tool-defaults';
```

<!-- apply: append client/src/app/services/note-edits.ts -->
```typescript
/**
 * The pitch a default trill on `note` alternates with, as `TrillDoc.value` stores it - alphaTab's
 * `Note.trillValue`, a MIDI number: a whole step above the note as it sounds. On a string that is the
 * open string plus the capo plus the fret, since alphaTex saves a trill as a fret relative to the
 * string with the capo included (`trillFret`); on a pitched staff, the note's own pitch.
 */
export function trillTargetOf(staff: StaffDoc, note: NoteDoc): number {
  const pitch = note.pitch;
  const sounding =
    pitch.kind === 'fretted'
      ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
      : (pitch.octave + 1) * 12 + pitch.noteValue;
  return sounding + TRILL_INTERVAL;
}

/**
 * Presses the trill tool, by the toggle rule: when every note the press means has a trill they all lose
 * it; otherwise each gets a trill a whole step above itself (`trillTargetOf`) at the default speed.
 *
 * Not `toggleNoteEffect`, whose one value for every note would trill a chord's notes to one pitch.
 */
export function toggleTrill(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  const targets = noteTargetsAt(doc, refs, focus);
  const allOn = targets.length > 0 && targets.every(target => target.note.effects.trill !== null);
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    note.effects.trill = allOn || !staff ? null : { value: trillTargetOf(staff, note), speed: DEFAULT_TRILL_SPEED };
  }
}
```

In `composer.service.ts`, import it and add the command before `applyEdit`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { setAccidental, toggleNoteEffect, toggleTie } from './note-edits';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * The one way a note or beat edit reaches the document.
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Presses Trill: each note a whole step above itself at the default speed, or none. See `toggleTrill`. */
  toggleTrill(): void {
    this.applyEdit({ family: 'note', key: 'trill' }, (draft, refs, focus) => toggleTrill(draft, refs, focus));
  }

  /**
   * The one way a note or beat edit reaches the document.
```

**Step 4: Run** both spec files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Default bend, fermata, tuplets and a trill aimed at each note's whole step`.

### Task 1.10: A fermata belongs to a bar position, on every track

The user's decision: as in alphaTab and Guitar Pro, a fermata belongs to a position in a bar, not to a
beat. alphaTab already behaves so - `Voice.finish` files a beat's fermata on the master bar by tick
(`alphaTab.core.mjs` ~3294) and `MasterBar.getFermata` (~2728) hands it to every beat finished later at
that tick - which M1 pinned as a surprise, because clearing the original left the copies. Pressing
Fermata now sets it on every staff's voice-1 beat that starts at that tick in that bar, on every track,
and pressing again clears all of them. The toggle reads all of them. A generated track is left alone,
as every edit leaves one.

**Files:**
- Modify: `client/src/app/services/beat-edits.ts`, `client/src/app/services/composer.service.ts`,
  `client/src/app/services/score-doc-mapper.effects.spec.ts` (comments only)
- Test: `client/src/app/services/beat-edits.spec.ts`

**Step 1: Failing spec.** In `beat-edits.spec.ts`, import `toggleFermata` and append:

<!-- apply: find client/src/app/services/beat-edits.spec.ts -->
```typescript
import { setBeatDurations, setGrace, setTuplet, toggleBeatEffect, toggledValue } from './beat-edits';
```

<!-- apply: replace client/src/app/services/beat-edits.spec.ts -->
```typescript
import { setBeatDurations, setGrace, setTuplet, toggleBeatEffect, toggleFermata, toggledValue } from './beat-edits';
```

<!-- apply: append client/src/app/services/beat-edits.spec.ts -->
```typescript
describe('toggleFermata', () => {
  const medium = { type: 'medium' as const, length: 1 };
  /** Each beat's fermata type in bar 0 of track `trackIndex`, or null. */
  const fermatas = (doc: ScoreDoc, trackIndex: number): (string | null)[] =>
    doc.tracks[trackIndex].staves[0].bars[0].voices[0].beats.map(beat => beat.effects.fermata?.type ?? null);
  const withPiano = (): ScoreDoc => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    return doc;
  };

  it('puts a fermata at that position on every track, and a second press clears every one', () => {
    const doc = withPiano();

    toggleFermata(doc, [ref(0, 2)], medium);
    expect(fermatas(doc, 0)).toEqual([null, null, 'medium', null]);
    expect(fermatas(doc, 1)).toEqual([null, null, 'medium', null]);

    toggleFermata(doc, [ref(0, 2)], medium);
    expect(fermatas(doc, 0)).toEqual([null, null, null, null]);
    expect(fermatas(doc, 1)).toEqual([null, null, null, null]);
  });

  it('reads the position on every track, so one on another track alone does not make the press clear', () => {
    const doc = withPiano();
    doc.tracks[1].staves[0].bars[0].voices[0].beats[2].effects.fermata = { ...medium };

    toggleFermata(doc, [ref(0, 2)], medium);

    expect(fermatas(doc, 0)[2]).toBe('medium');
    expect(fermatas(doc, 1)[2]).toBe('medium');
  });

  it('finds the position by tick, and gives nothing to a staff with no beat starting there', () => {
    // The piano's bar is two halves: its second beat starts at 1920, the guitar's third beat's tick,
    // and nothing of the piano's starts at 960, the guitar's second.
    const doc = withPiano();
    doc.tracks[1].staves[0].bars[0].voices[0].beats = [createRestBeat(2), createRestBeat(2)];

    toggleFermata(doc, [ref(0, 2)], medium);
    toggleFermata(doc, [ref(0, 1)], medium);

    expect(fermatas(doc, 0)).toEqual([null, 'medium', 'medium', null]);
    expect(fermatas(doc, 1)).toEqual([null, 'medium']);
  });

  it('leaves a generated track alone', () => {
    const doc = withPiano();
    doc.tracks[1].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    toggleFermata(doc, [ref(0, 0)], medium);

    expect(fermatas(doc, 1)).toEqual([null, null, null, null]);
  });
});
```

**Step 2: Run** `beat-edits.spec.ts`. Expected: a compile error,
`TS2305: Module '"./beat-edits"' has no exported member 'toggleFermata'.`

**Step 3: Implement.** In `beat-edits.ts`, the imports:

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
  DurationValue,
  DynamicValue,
  ScoreDoc,
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
  DurationValue,
  DynamicValue,
  FermataDoc,
  ScoreDoc,
```

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
  fillBarGaps,
  insertRestsAt
} from './bar-fill';
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
  fillBarGaps,
  insertRestsAt,
  voiceTicks
} from './bar-fill';
```

After `setDynamics`:

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
/** Marks a dynamic on every beat in `refs`; null removes it. */
export function setDynamics(doc: ScoreDoc, refs: readonly BeatRef[], dynamics: DynamicValue | null): void {
  for (const beat of beatsAt(doc, refs)) beat.dynamics = dynamics;
}
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
/** Marks a dynamic on every beat in `refs`; null removes it. */
export function setDynamics(doc: ScoreDoc, refs: readonly BeatRef[], dynamics: DynamicValue | null): void {
  for (const beat of beatsAt(doc, refs)) beat.dynamics = dynamics;
}

/**
 * Every beat a fermata pressed on `refs` belongs to: for the tick each ref's beat starts at in its bar,
 * the voice-1 beat that starts there on every staff of every track. A fermata belongs to a bar
 * position, not to a beat.
 *
 * That is alphaTab's model and Guitar Pro's. `Voice.finish` files a beat's fermata on the master bar by
 * tick (`alphaTab.core.mjs` ~3294), and `MasterBar.getFermata` (~2728) hands it to every beat finished
 * later at that tick without one - so a fermata written on one track showed on every later track
 * anyway, and clearing it left the copies. Written on every track, the document says what the page
 * shows, whichever track the press came from.
 *
 * A grace beat names no position: it takes no ticks and starts where the beat it leads into does, so a
 * ref on one is skipped, and a grace at the tick gets nothing. A staff with no beat starting at the
 * tick - a half note spans it - gets nothing either. A generated track is left alone, as every edit
 * leaves one; alphaTab may still draw the position's fermata there, and the track's document stays the
 * progression's.
 */
export function fermataPositionsOf(doc: ScoreDoc, refs: readonly BeatRef[]): BeatDoc[] {
  const ticksByBar = new Map<number, Set<number>>();
  for (const ref of refs) {
    const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
    const beat = voice?.beats[ref.beatIndex];
    if (!voice || !beat || beat.effects.grace !== 'none') continue;
    const ticks = ticksByBar.get(ref.barIndex) ?? new Set<number>();
    ticks.add(voiceTicks({ beats: voice.beats.slice(0, ref.beatIndex) }));
    ticksByBar.set(ref.barIndex, ticks);
  }

  const beats: BeatDoc[] = [];
  for (const track of doc.tracks) {
    if (track.generated) continue;
    for (const staff of track.staves) {
      for (const [barIndex, ticks] of ticksByBar) {
        let start = 0;
        for (const beat of staff.bars[barIndex]?.voices[0]?.beats ?? []) {
          if (beat.effects.grace === 'none' && ticks.has(start)) beats.push(beat);
          start += beatTicks(beat);
        }
      }
    }
  }
  return beats;
}

/** Presses Fermata on `refs`, by the toggle rule, reading and writing every beat at those positions. */
export function toggleFermata(doc: ScoreDoc, refs: readonly BeatRef[], fermata: FermataDoc): void {
  const beats = fermataPositionsOf(doc, refs);
  const value = toggledValue(beats.map(beat => beat.effects.fermata), fermata, null);
  for (const beat of beats) beat.effects.fermata = value ? { ...value } : null;
}
```

In `composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  setTuplet,
  toggleBeatEffect,
  toggledValue
} from './beat-edits';
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  setTuplet,
  toggleBeatEffect,
  toggleFermata,
  toggledValue
} from './beat-edits';
import { CursorMove, clampedCursor, movedCursor } from './composer-cursor';
import { defaultFermata } from './composer-tool-defaults';
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * The one way a note or beat edit reaches the document.
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Presses Fermata: at the selection's positions, on every track. See `toggleFermata`. */
  toggleFermata(): void {
    this.applyEdit({ family: 'beat', key: 'fermata' }, (draft, refs) => toggleFermata(draft, refs, defaultFermata()));
  }

  /**
   * The one way a note or beat edit reaches the document.
```

The spread M1 pinned is now the rule. In `score-doc-mapper.effects.spec.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.effects.spec.ts -->
```typescript
      // `Voice.finish` files a beat's fermata on the master bar by tick and hands it to every
      // beat finished after it at that tick without one - later voices, staves and tracks,
      // never earlier ones - before render or export. Pinned so M2 has to decide whether a
      // fermata is per beat.
```

<!-- apply: replace client/src/app/services/score-doc-mapper.effects.spec.ts -->
```typescript
      // `Voice.finish` files a beat's fermata on the master bar by tick and hands it to every
      // beat finished after it at that tick without one - later voices, staves and tracks,
      // never earlier ones - before render or export. M2 made that the rule: a fermata belongs
      // to a bar position, and `toggleFermata` writes it on every track itself. Still pinned, so
      // an alphaTab upgrade that stops spreading it is noticed rather than hidden by the tool.
```

<!-- apply: find client/src/app/services/score-doc-mapper.effects.spec.ts -->
```typescript
    it('does not give a fermata to an earlier track', () => {
```

<!-- apply: replace client/src/app/services/score-doc-mapper.effects.spec.ts -->
```typescript
    it('does not give a fermata to an earlier track', () => {
      // Which is why `toggleFermata` writes every track rather than relying on the spread: a
      // fermata pressed on a later track would otherwise never reach an earlier one.
```

**Step 4: Run** `beat-edits.spec.ts` and `score-doc-mapper.effects.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit**: `feat: A fermata belongs to a bar position on every track`.

### Task 1.11: Respell

Respell (E) cycles how a note is written without changing its pitch (design decision 11).

- **On a pitched note** it cycles the note's letter through every spelling `forcedLetterOf` allows
  for its drawn pitch class, highest letter-alteration first: C sharp goes to D flat, then B double
  sharp, then back to C sharp. It writes `letter` and the matching `accidental`, so the mapper and the
  accidental refusal agree about the result.
- **On a fretted note** it cycles the forced accidental between the sharp and the flat that can name a
  black key. A white key has nothing to cycle, and a natural harmonic's accidental cannot be forced
  (M1's refusal), so both are skipped in a range and refused when nothing else is selected.
- A note with no forced spelling starts from the one alphaTab draws: for a black key under `Default`,
  sharp in a key of no accidentals or sharps and flat in a flat key (`ModelUtils.computeAccidental`,
  `alphaTab.core.mjs` ~4571), so the first press always changes what is drawn.

**Files:**
- Create: `client/src/app/services/note-respell.ts`
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/note-respell.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/note-respell.spec.ts -->
```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { respellNotes, respellRefusal, respellingsOf } from './note-respell';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number): BeatRef => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });

/** A guitar and a piano, with one note on each track's first beat. */
function doc(guitar: NotePitch, piano: NotePitch): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  [guitar, piano].forEach((pitch, trackIndex) => {
    const beat = score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0];
    beat.isRest = false;
    beat.notes = [{ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  });
  return score;
}
const noteOf = (score: ScoreDoc, trackIndex: number): NoteDoc => score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0].notes[0];
/** String 2 (B, 59) at fret 2 is C sharp; at fret 1, C. */
const C_SHARP_FRET: NotePitch = { kind: 'fretted', string: 2, fret: 2 };
const C_FRET: NotePitch = { kind: 'fretted', string: 2, fret: 1 };
const C_SHARP: NotePitch = { kind: 'pitched', noteValue: 1, octave: 4 };

describe('respellingsOf', () => {
  it('offers a black key\'s sharp and flat on a fretted staff, and a white key nothing', () => {
    expect(respellingsOf(1, true)).toEqual(['sharp', 'flat']);
    expect(respellingsOf(0, true)).toEqual([]);
  });

  it('offers every spelling that names the pitch on a pitched staff', () => {
    // C sharp: B double sharp, C sharp, D flat. C: B sharp, C, D double flat.
    expect(respellingsOf(1, false)).toEqual(['doubleSharp', 'sharp', 'flat']);
    expect(respellingsOf(0, false)).toEqual(['sharp', 'auto', 'doubleFlat']);
  });
});

describe('respellNotes', () => {
  it('turns a fretted C sharp spelled from C major into D flat, and back', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);

    respellNotes(score, [ref(0)], null);
    expect(noteOf(score, 0).accidental).toBe('flat');

    respellNotes(score, [ref(0)], null);
    expect(noteOf(score, 0).accidental).toBe('sharp');
  });

  it('starts from the flat a flat key draws', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    score.tracks[0].staves[0].bars[0].keySignature = { fifths: -2, mode: 'major' };

    respellNotes(score, [ref(0)], null);

    expect(noteOf(score, 0).accidental).toBe('sharp');
  });

  it('cycles a pitched C sharp\'s letter through D flat, B double sharp and C sharp', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    const letters: (string | undefined)[] = [];

    for (let press = 0; press < 3; press++) {
      respellNotes(score, [ref(1)], null);
      const note = noteOf(score, 1);
      letters.push(note.pitch.kind === 'pitched' ? `${note.pitch.letter}:${note.accidental}` : undefined);
    }

    expect(letters).toEqual(['D:flat', 'B:doubleSharp', 'C:sharp']);
  });

  it('reads a written letter as the current spelling', () => {
    const score = doc(C_SHARP_FRET, { ...C_SHARP, letter: 'D' });

    respellNotes(score, [ref(1)], null);

    const pitch = noteOf(score, 1).pitch;
    expect(pitch.kind === 'pitched' ? pitch.letter : null).toBe('B');
  });
});

describe('respellRefusal', () => {
  it('refuses a fretted white key, saying why', () => {
    expect(respellRefusal(doc(C_FRET, C_SHARP), [ref(0)], null)).toMatch(/black key/i);
  });

  it('refuses a fretted natural harmonic', () => {
    const score = doc(C_SHARP_FRET, C_SHARP);
    noteOf(score, 0).effects.harmonic = 'natural';

    expect(respellRefusal(score, [ref(0)], null)).toMatch(/harmonic/i);
  });

  it('allows a range with something to respell, and refuses a rest', () => {
    const score = doc(C_FRET, C_SHARP);

    expect(respellRefusal(score, [ref(0), ref(1)], null)).toBeNull();
    expect(respellRefusal(score, [{ ...ref(0), beatIndex: 1 }], null)).toMatch(/note/i);
  });
});
```

**Step 2: Run** `note-respell.spec.ts`. Expected: a compile error,
`TS2307: Cannot find module './note-respell'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/note-respell.ts -->
```typescript
import { AccidentalMode, NoteDoc, NoteLetter, ScoreDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';
import { drawnPitchClassOf, editRefusal } from './edit-refusals';
import { NoteTarget, noteTargetsAt } from './note-edits';
import { alterFor, forcedLetterOf, reduceToOctave } from './note-spelling';
import { STEP_SEMITONES } from './staff-pitch';

/**
 * Respell: writing a note another way without changing its pitch.
 *
 * Every spelling offered is one `forcedLetterOf` can name, which is the predicate the accidental
 * refusal checks and the mapper reads a letter back with - so a respelled note is never one that
 * refusal would have stopped.
 */

const LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** The accidental a letter needs, by its alteration in semitones. */
const MODE_BY_ALTER: ReadonlyMap<number, AccidentalMode> = new Map([
  [-2, 'doubleFlat'],
  [-1, 'flat'],
  [0, 'auto'],
  [1, 'sharp'],
  [2, 'doubleSharp']
]);

/** A pitched note's spellings in order: lowest letter, whose alteration is highest, first. */
const PITCHED_ORDER: readonly AccidentalMode[] = ['doubleSharp', 'sharp', 'auto', 'flat', 'doubleFlat'];

const WHITE_KEY = 'A natural note on a fretted staff is written one way here - respell swaps a black key between its sharp and its flat.';

const NATURAL_HARMONIC = "A natural harmonic's accidental cannot be forced yet, so it cannot be respelled.";

/**
 * The spellings of `pitchClass` respell cycles through, as the accidental each forces.
 *
 * On a fretted staff, a black key's sharp and flat, and nothing for a white key. On a pitched staff,
 * every spelling from a double sharp to a double flat that names the pitch, `auto` standing for the
 * natural letter of a white key.
 */
export function respellingsOf(pitchClass: number, fretted: boolean): AccidentalMode[] {
  const reduced = reduceToOctave(pitchClass);
  const white = STEP_SEMITONES.includes(reduced);
  if (fretted) return white ? [] : ['sharp', 'flat'];
  return PITCHED_ORDER.filter(mode => (mode === 'auto' ? white : forcedLetterOf(mode, reduced) !== undefined));
}

/**
 * The spelling `note` is drawn with now: a pitched note's letter, else its forced accidental, else what
 * alphaTab draws for `Default` - a white key's natural, or a black key sharp when the key signature has
 * no flats and flat when it has (`ModelUtils.computeAccidental`, `alphaTab.core.mjs` ~4571).
 */
function spellingOf(note: NoteDoc, pitchClass: number, fifths: number): AccidentalMode {
  if (note.pitch.kind === 'pitched' && note.pitch.letter) {
    return MODE_BY_ALTER.get(alterFor(pitchClass, LETTERS.indexOf(note.pitch.letter))) ?? 'auto';
  }
  if (note.accidental !== 'auto') return note.accidental;
  if (STEP_SEMITONES.includes(reduceToOctave(pitchClass))) return 'auto';
  return fifths >= 0 ? 'sharp' : 'flat';
}

/**
 * `note`'s next spelling - its pitch and accidental - drawn from `pitchClass` in a key of `fifths`, or
 * null when it has none to move to. A pitched note gets the letter as well as the accidental, since the
 * mapper reads a letter first.
 */
export function respelledNote(note: NoteDoc, pitchClass: number, fifths: number): Pick<NoteDoc, 'pitch' | 'accidental'> | null {
  const options = respellingsOf(pitchClass, note.pitch.kind === 'fretted');
  if (options.length === 0) return null;
  const next = options[(options.indexOf(spellingOf(note, pitchClass, fifths)) + 1) % options.length];
  if (note.pitch.kind === 'fretted') return { pitch: note.pitch, accidental: next };

  const letter = next === 'auto' ? LETTERS[STEP_SEMITONES.indexOf(reduceToOctave(pitchClass))] : forcedLetterOf(next, pitchClass);
  return { pitch: { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave, letter }, accidental: next };
}

/** `target`'s next spelling in its own staff and key, or null. A fretted natural harmonic has none. */
function respellingOf(doc: ScoreDoc, target: NoteTarget): Pick<NoteDoc, 'pitch' | 'accidental'> | null {
  const staff = doc.tracks[target.ref.trackIndex]?.staves[target.ref.staffIndex];
  const bar = staff?.bars[target.ref.barIndex];
  if (!staff || !bar) return null;
  if (target.note.pitch.kind === 'fretted' && target.note.effects.harmonic === 'natural') return null;
  return respelledNote(target.note, drawnPitchClassOf(staff, target.note.pitch), bar.keySignature.fifths);
}

/** Why a respell cannot apply to `refs`, or null: any note edit's refusal, or no note that can be respelled. */
export function respellRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus);
  if (refusal) return refusal;
  const targets = noteTargetsAt(doc, refs, focus);
  if (targets.some(target => respellingOf(doc, target) !== null)) return null;
  return targets.every(target => target.note.effects.harmonic === 'natural') ? NATURAL_HARMONIC : WHITE_KEY;
}

/** Respells every note the press means that can be, each by its own cycle. The rest are skipped. */
export function respellNotes(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  for (const target of noteTargetsAt(doc, refs, focus)) {
    const next = respellingOf(doc, target);
    if (!next) continue;
    target.note.pitch = next.pitch;
    target.note.accidental = next.accidental;
  }
}
```

In `composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { setAccidental, toggleNoteEffect, toggleTie, toggleTrill } from './note-edits';
import { respellNotes, respellRefusal } from './note-respell';
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * The one way a note or beat edit reaches the document.
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Respell: each note to its next spelling. See note-respell.ts. */
  respell(): void {
    this.applyEdit(respellRefusal, (draft, refs, focus) => respellNotes(draft, refs, focus));
  }

  /**
   * The one way a note or beat edit reaches the document.
```

**Step 4: Run** `note-respell.spec.ts`. Expected: 9 SUCCESS.

**Step 5: Commit**: `feat: Respell a note through the spellings that name it`.

### Task 1.12: Semitone and string moves

Alt+↑/↓ moves the selection's notes a semitone; Ctrl+Alt+↑/↓ moves them to the string above or below,
keeping their pitch. Both refuse the whole press, saying why, when any note would not fit.

- **A semitone** moves a fret by one, or a pitched note by one, and drops a pitched note's `letter`,
  which named the old pitch (the model's own warning on `NotePitch.letter`). It moves `trill.value`
  with the note, since the trill's target is a pitch. A forced accidental that cannot name the new
  pitch goes back to `auto` rather than draw the note on the wrong line.
- **A string** keeps the pitch: the fret moves by the difference between the two strings' tunings. It
  refuses a note that would leave the fretboard, a string that does not exist, and a beat where two
  notes would share a string. The trill's target is a pitch, which does not change. On the caret alone,
  the caret's string follows the note.

**Files:**
- Create: `client/src/app/services/note-moves.ts`
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/note-moves.spec.ts`, `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs**

<!-- apply: create client/src/app/services/note-moves.spec.ts -->
```typescript
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { moveNotesToString, shiftSemitone } from './note-moves';
import { NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number, beatIndex = 0): BeatRef => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

/** A guitar and a piano, with `guitar`'s notes on the guitar's first beat and C4 on the piano's. */
function doc(...guitar: NotePitch[]): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  const note = (pitch: NotePitch): NoteDoc => ({ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });
  const first = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  first.isRest = false;
  first.notes = guitar.map(note);
  const piano = score.tracks[1].staves[0].bars[0].voices[0].beats[0];
  piano.isRest = false;
  piano.notes = [note({ kind: 'pitched', noteValue: 0, octave: 4, letter: 'C' })];
  return score;
}
const notesOf = (score: ScoreDoc, trackIndex: number): NoteDoc[] => score.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0].notes;

describe('shiftSemitone', () => {
  it('moves a fret and its trill up a semitone', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });
    notesOf(score, 0)[0].effects.trill = { value: 62, speed: 16 };

    expect(shiftSemitone(score, [ref(0)], null, 1)).toBeNull();

    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 3, fret: 6 });
    expect(notesOf(score, 0)[0].effects.trill).toEqual({ value: 63, speed: 16 });
  });

  it('moves a pitched note across an octave and drops the letter that named the old pitch', () => {
    const score = doc({ kind: 'fretted', string: 3, fret: 5 });

    shiftSemitone(score, [ref(1)], null, -1);

    expect(notesOf(score, 1)[0].pitch).toEqual({ kind: 'pitched', noteValue: 11, octave: 3 });
  });

  it('puts a forced accidental that cannot name the new pitch back to auto, and keeps one that can', () => {
    // String 3 (G, 55) at fret 3 is B flat, 58. A semitone up is 59, which a flat still names - C flat.
    // A semitone down is 57, A, which a flat cannot name: its letter would be a black key.
    const up = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(up, 0)[0].accidental = 'flat';
    shiftSemitone(up, [ref(0)], null, 1);
    expect(notesOf(up, 0)[0].accidental).toBe('flat');

    const down = doc({ kind: 'fretted', string: 3, fret: 3 });
    notesOf(down, 0)[0].accidental = 'flat';
    shiftSemitone(down, [ref(0)], null, -1);
    expect(notesOf(down, 0)[0].accidental).toBe('auto');
  });

  it('refuses the whole press when one note would go below fret 0, and moves nothing', () => {
    const score = doc({ kind: 'fretted', string: 1, fret: 0 }, { kind: 'fretted', string: 2, fret: 3 });

    expect(shiftSemitone(score, [ref(0)], null, -1)).toMatch(/fret/i);
    expect(notesOf(score, 0).map(note => note.pitch.kind === 'fretted' && note.pitch.fret)).toEqual([0, 3]);
  });
});

describe('moveNotesToString', () => {
  it('moves a note to the string above, keeping its pitch', () => {
    // String 2 (B, 59) at fret 5 is E, 64: fret 0 on string 1.
    const score = doc({ kind: 'fretted', string: 2, fret: 5 });

    expect(moveNotesToString(score, [ref(0)], null, -1)).toBeNull();

    expect(notesOf(score, 0)[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
  });

  it('refuses a note that would need a fret below 0, saying which', () => {
    const score = doc({ kind: 'fretted', string: 2, fret: 3 });

    expect(moveNotesToString(score, [ref(0)], null, -1)).toMatch(/fret -2/);
  });

  it('refuses a string that does not exist, and a pitched staff', () => {
    expect(moveNotesToString(doc({ kind: 'fretted', string: 1, fret: 3 }), [ref(0)], null, -1)).toMatch(/no string/i);
    expect(moveNotesToString(doc({ kind: 'fretted', string: 1, fret: 3 }), [ref(1)], null, 1)).toMatch(/pitched/i);
  });

  it('refuses a beat where two notes would share a string, and lets a whole chord move together', () => {
    const chord = (): ScoreDoc => doc({ kind: 'fretted', string: 2, fret: 5 }, { kind: 'fretted', string: 3, fret: 9 });

    expect(moveNotesToString(chord(), [ref(0)], 2, -1)).toMatch(/already/i);
    const score = chord();
    expect(moveNotesToString(score, [ref(0)], null, -1)).toBeNull();
    expect(notesOf(score, 0).map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 0 },
      { kind: 'fretted', string: 2, fret: 5 }
    ]);
  });
});
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService pitch and string moves', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('moves the caret\'s note to the string above, and the caret with it', () => {
    writeFret(service, 0, 0, 5, 2);

    service.moveNotesToString(-1);

    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
    expect(stateOf(service).cursor.stringIndex).toBe(0);
  });

  it('refuses a move that does not fit, publishing why and leaving the caret', () => {
    writeFret(service, 0, 0, 3, 2);

    service.moveNotesToString(-1);

    expect(stateOf(service).refusal).toMatch(/fret -2/);
    expect(stateOf(service).cursor.stringIndex).toBe(1);
  });

  it('moves a semitone as one undo step', () => {
    writeFret(service, 0, 0, 5);

    service.shiftSemitone(1);
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 5 });
  });
});
```

**Step 2: Run** `note-moves.spec.ts` and `composer.service.editing.spec.ts`. Expected: compile errors,
`TS2307: Cannot find module './note-moves'` and `TS2339: Property 'moveNotesToString' does not exist on type 'ComposerService'.`

**Step 3: Implement**

<!-- apply: create client/src/app/services/note-moves.ts -->
```typescript
import { BeatDoc, NoteDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef, beatAt } from './composer-selection';
import { drawnPitchClassOf } from './edit-refusals';
import { noteTargetsAt } from './note-edits';
import { forcedLetterOf, reduceToOctave } from './note-spelling';

/**
 * Moving notes by pitch or by string. Each move checks every note first and returns why it refused
 * before changing anything, so a press is whole or nothing.
 */

/** The highest fret a note can move to, as the fret digits allow. */
const MAX_FRET = 24;

/**
 * Moves every note the press means by `delta` semitones, or returns why not and changes nothing.
 *
 * A fret moves by `delta`; a pitched note moves by `delta` across octave boundaries and loses its
 * `letter`, which named the old pitch. `trill.value` is a pitch, so it moves too. A forced accidental
 * that cannot name the new drawn pitch returns to `auto` (see `forcedLetterOf`).
 */
export function shiftSemitone(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const targets = noteTargetsAt(doc, refs, focus);
  const direction = delta > 0 ? 'up' : 'down';

  for (const { note } of targets) {
    if (note.pitch.kind === 'fretted') {
      const fret = note.pitch.fret + delta;
      if (fret < 0 || fret > MAX_FRET) return `A fret runs from 0 to ${MAX_FRET}, so a note in the selection cannot move ${direction} a semitone.`;
    } else {
      const midi = (note.pitch.octave + 1) * 12 + note.pitch.noteValue + delta;
      if (midi < 0 || midi > 127) return `A note in the selection is at the edge of the MIDI range and cannot move ${direction}.`;
    }
  }

  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff) continue;
    if (note.pitch.kind === 'fretted') {
      note.pitch = { ...note.pitch, fret: note.pitch.fret + delta };
    } else {
      const midi = (note.pitch.octave + 1) * 12 + note.pitch.noteValue + delta;
      note.pitch = { kind: 'pitched', noteValue: reduceToOctave(midi), octave: Math.floor(midi / 12) - 1 };
    }
    if (note.effects.trill) note.effects.trill = { ...note.effects.trill, value: note.effects.trill.value + delta };
    if (note.accidental !== 'auto' && forcedLetterOf(note.accidental, drawnPitchClassOf(staff, note.pitch)) === undefined) {
      note.accidental = 'auto';
    }
  }
  return null;
}

/**
 * Moves every note the press means to the string `delta` away in tab numbering - -1 the string above,
 * higher in pitch; +1 the one below - keeping its pitch, or returns why not and changes nothing.
 *
 * The fret moves by the difference between the two strings' open pitches. Refused on a pitched staff,
 * for a string past either edge, for a fret off the fretboard, and where two notes of one beat would
 * end on one string - a note moving off a string frees it for another moving on.
 */
export function moveNotesToString(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const direction = delta < 0 ? 'above' : 'below';
  const moves = new Map<NoteDoc, { string: number; fret: number }>();
  const beats = new Set<BeatDoc>();

  for (const { ref, note } of noteTargetsAt(doc, refs, focus)) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff || note.pitch.kind !== 'fretted' || staff.tuning.length === 0) {
      return 'A pitched staff has no strings to move a note between.';
    }
    const string = note.pitch.string + delta;
    if (string < 1 || string > staff.tuning.length) return `There is no string ${direction} a note in the selection.`;
    const fret = note.pitch.fret + (staff.tuning[note.pitch.string - 1] ?? 0) - (staff.tuning[string - 1] ?? 0);
    if (fret < 0 || fret > MAX_FRET) return `A note in the selection does not fit on the string ${direction}: it would need fret ${fret}.`;
    moves.set(note, { string, fret });
    const beat = beatAt(doc, ref);
    if (beat) beats.add(beat);
  }

  for (const beat of beats) {
    const strings = beat.notes.map(note => moves.get(note)?.string ?? (note.pitch.kind === 'fretted' ? note.pitch.string : 0));
    if (new Set(strings).size !== strings.length) return `The string ${direction} already has a note on that beat.`;
  }

  for (const [note, { string, fret }] of moves) {
    note.pitch = { kind: 'fretted', string, fret };
  }
  return null;
}
```

In `composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { respellNotes, respellRefusal } from './note-respell';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { moveNotesToString, shiftSemitone } from './note-moves';
import { respellNotes, respellRefusal } from './note-respell';
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /**
   * The one way a note or beat edit reaches the document.
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Moves the selection's notes a semitone up (+1) or down (-1). See `shiftSemitone`. */
  shiftSemitone(delta: 1 | -1): void {
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => shiftSemitone(draft, refs, focus, delta));
  }

  /**
   * Moves the selection's notes to the string above (-1) or below (+1), keeping their pitch. See
   * `moveNotesToString`. On the caret alone, the caret's string follows the note.
   */
  moveNotesToString(delta: 1 | -1): void {
    const before = this.doc;
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => moveNotesToString(draft, refs, focus, delta));
    if (this.doc !== before && !this.stateSubject.getValue().anchor) this.moveCursor({ kind: 'string', delta });
  }

  /**
   * The one way a note or beat edit reaches the document.
```

**Step 4: Run** both spec files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Move notes by a semitone, and to another string at the same pitch`.

### Task 1.13: Rest over a range, insert beat, delete beats

- **R and Delete over a range** clear every beat in it to a rest, keeping each beat's value. On the
  caret alone they keep today's behaviour (`setRestAtCursor` applies the input duration and advances).
- **Insert beat** puts a rest at the input duration in front of the caret's beat and leaves the caret
  on it. The bar grows; any overflow is left for Fix bar, as the design asks of every edit.
- **Delete beats** removes the selected beats, so the beats after them move earlier - that is what
  sets it apart from clearing - and fills each bar it leaves short at its end. The caret goes to where
  the range began.

`ComposerEntryHost` gains `select`, the service's `setCursor`, for commands that place the caret.

**Files:**
- Modify: `client/src/app/services/beat-edits.ts`, `client/src/app/services/composer-entry-commands.ts`,
  `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/beat-edits.spec.ts`, `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs.** In `beat-edits.spec.ts`:

<!-- apply: find client/src/app/services/beat-edits.spec.ts -->
```typescript
import { setBeatDurations, setGrace, setTuplet, toggleBeatEffect, toggleFermata, toggledValue } from './beat-edits';
```

<!-- apply: replace client/src/app/services/beat-edits.spec.ts -->
```typescript
import {
  clearToRests,
  deleteBeats,
  insertBeatAt,
  setBeatDurations,
  setGrace,
  setTuplet,
  toggleBeatEffect,
  toggleFermata,
  toggledValue
} from './beat-edits';
```

<!-- apply: append client/src/app/services/beat-edits.spec.ts -->
```typescript
describe('clearToRests, insertBeatAt and deleteBeats', () => {
  it('clears notes to rests and keeps each beat\'s value', () => {
    const doc = ComposerService.createEmptyScore();
    setBeatDurations(doc, [ref(0, 0)], 8, 0);
    withNote(doc, 0, 0);
    withNote(doc, 0, 2);

    clearToRests(doc, [ref(0, 0), ref(0, 1), ref(0, 2)]);

    expect(shape(doc)).toEqual(['r8', 'r8', 'r4', 'r4', 'r4']);
  });

  it('inserts a rest in front of a beat and leaves the bar over', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);

    insertBeatAt(doc, ref(0, 0), 8, 1);

    expect(shape(doc)).toEqual(['r8.', 'n4', 'r4', 'r4', 'r4']);
    expect(scoreBarFills(doc)[0][0][0]).toEqual({ kind: 'over', ticks: 720 });
  });

  it('deletes beats, moves the later ones earlier, and fills the bar at its end', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 2);

    deleteBeats(doc, [ref(0, 0), ref(0, 1)]);

    expect(shape(doc)).toEqual(['n4', 'r4', 'r2']);
  });

  it('fills a bar whose every beat was deleted', () => {
    const doc = ComposerService.createEmptyScore();

    deleteBeats(doc, [0, 1, 2, 3].map(index => ref(0, index)));

    expect(shape(doc)).toEqual(['r1']);
  });
});
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService beats over the selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('rests every beat of a range as one undo step', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });

    service.clearSelectionToRests();
    expect(beatsIn(service).slice(0, 2).every(beat => beat.isRest)).toBeTrue();

    service.undo();
    expect(beatsIn(service).slice(0, 2).every(beat => !beat.isRest)).toBeTrue();
  });

  it('inserts a rest at the input duration in front of the caret, and leaves the caret on it', () => {
    writeFret(service, 0, 1, 5);
    service.setInputDuration(8, 0);

    service.insertBeat();

    expect(beatsIn(service)[1].isRest).toBeTrue();
    expect(beatsIn(service)[1].duration).toBe(8);
    expect(beatsIn(service)[2].isRest).toBeFalse();
    expect(stateOf(service).cursor.beatIndex).toBe(1);
  });

  it('deletes a range and puts the caret where it began, with no range', () => {
    writeFret(service, 0, 3, 5);
    service.setCursor({ beatIndex: 1 });
    service.extendSelectionTo({ beatIndex: 2 });

    service.deleteBeats();

    expect(beatsIn(service)[1].isRest).toBeFalse();
    expect(stateOf(service).cursor.beatIndex).toBe(1);
    expect(stateOf(service).anchor).toBeNull();
  });

  it('refuses to insert into a generated track', () => {
    service.addTrack('Piano', 0, false);
    service.replaceDocument({
      ...service.doc,
      tracks: service.doc.tracks.map((track, index) =>
        index === 1 ? { ...track, generated: { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision' as const, revision: 1 } } } : track
      )
    });
    service.setCursor({ trackIndex: 1 });
    const before = JSON.stringify(service.doc);

    service.insertBeat();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/progression/i);
  });
});
```

**Step 2: Run** both spec files. Expected: compile errors,
`TS2305: Module '"./beat-edits"' has no exported member 'clearToRests'.` (and `deleteBeats`,
`insertBeatAt`) and `TS2339: Property 'clearSelectionToRests' does not exist on type 'ComposerService'.`

**Step 3: Implement.** In `beat-edits.ts`, import `createRestBeat`:

<!-- apply: find client/src/app/services/beat-edits.ts -->
```typescript
  Tuplet,
  VoiceDoc
} from '../models/composer.model';
```

<!-- apply: replace client/src/app/services/beat-edits.ts -->
```typescript
  Tuplet,
  VoiceDoc,
  createRestBeat
} from '../models/composer.model';
```

Append:

<!-- apply: append client/src/app/services/beat-edits.ts -->
```typescript
/** Clears every beat in `refs` to a rest, keeping each beat's value, so no bar's fill changes. */
export function clearToRests(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  for (const beat of beatsAt(doc, refs)) {
    beat.notes = [];
    beat.isRest = true;
  }
}

/**
 * Inserts a rest of `duration` and `dots` in front of the beat `ref` names. The bar grows, and whatever
 * it holds beyond its meter is left as overflow for Fix bar: an insertion moves beats later, and taking
 * rests from the end of the bar to make room would be a second edit the user did not ask for.
 */
export function insertBeatAt(doc: ScoreDoc, ref: BeatRef, duration: DurationValue, dots: number): void {
  const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
  if (!voice) return;
  voice.beats.splice(Math.min(ref.beatIndex, voice.beats.length), 0, { ...createRestBeat(duration), dots });
}

/**
 * Removes the beats `refs` name, so the beats after them move earlier, and fills each bar left short at
 * its end (`fillBarGaps`) - unlike a clear, which keeps every later beat where it was. A voice left
 * with no beats at all, in a free-time bar that nothing fills, gets a quarter rest, since alphaTab
 * cannot chain a voice with none.
 */
export function deleteBeats(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  const removing = new Set(beatsAt(doc, refs));
  const bars = new Map<BarDoc, number>();
  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    if (bar) bars.set(bar, ref.barIndex);
  }
  for (const [bar, barIndex] of bars) {
    for (const voice of bar.voices) voice.beats = voice.beats.filter(beat => !removing.has(beat));
    fillBarGaps(bar, barMeterAt(doc, barIndex));
    for (const voice of bar.voices) if (voice.beats.length === 0) voice.beats.push(createRestBeat(4));
  }
}
```

In `composer-entry-commands.ts`, the imports and `select` on the host:

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
import { setBeatDurations } from './beat-edits';
import { CursorMove } from './composer-cursor';
import { beatAt } from './composer-selection';
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
import { clearToRests, deleteBeats, insertBeatAt, setBeatDurations } from './beat-edits';
import { CursorMove } from './composer-cursor';
import { beatAt, selectionTargets } from './composer-selection';
```

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
  /** Moves the caret, dropping any range. */
  moveCursor(move: CursorMove): void;
}
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
  /** Moves the caret, dropping any range. */
  moveCursor(move: CursorMove): void;
  /** Puts the caret at `cursor`, clamped, dropping any range. */
  select(cursor: Partial<EditCursor>): void;
}
```

The commands, before `refusesEntryAt`:

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
  /** Clears every beat in the selection to a rest, keeping their values: R and Delete over a range. */
  clearSelectionToRests(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null);
    if (refusal) return this.host.refuse(refusal);
    this.host.commitFollowing(draft => clearToRests(draft, refs));
  }

  /** Inserts a rest at the input duration in front of the caret's beat, leaving the caret on it. See `insertBeatAt`. */
  insertBeat(): void {
    const state = this.host.state();
    if (this.refusesEntryAt(state.doc, state.cursor)) return;
    this.host.commit(draft => insertBeatAt(draft, state.cursor, state.inputDuration, state.inputDots));
  }

  /** Removes the selected beats, and puts the caret where the range began. See `deleteBeats`. */
  deleteBeats(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null);
    if (refusal) return this.host.refuse(refusal);
    this.host.commit(draft => deleteBeats(draft, refs));
    this.host.select(refs[0]);
  }

  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
```

In `composer.service.ts`, the host gains `select`, and the service delegates:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
    moveCursor: move => this.moveCursor(move)
  };
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
    moveCursor: move => this.moveCursor(move),
    select: cursor => this.setCursor(cursor)
  };
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  setInputDuration(duration: DurationValue, dots = 0): void {
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Clears every beat in the selection to a rest, keeping their values. */
  clearSelectionToRests(): void {
    this.entry.clearSelectionToRests();
  }

  /** Inserts a rest at the input duration in front of the caret, leaving the caret on it. */
  insertBeat(): void {
    this.entry.insertBeat();
  }

  /** Removes the selected beats; the beats after them move earlier. */
  deleteBeats(): void {
    this.entry.deleteBeats();
  }

  setInputDuration(duration: DurationValue, dots = 0): void {
```

**Step 4: Run** both spec files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Rest over a range, insert a beat, and delete beats`.

### Task 1.14: Cut, copy and paste

Design Part 4: paste writes from the caret for the copied length and fills gaps where they open, and
overflow is flagged, never pushed on. The clipboard is the composer's own, held by the entry commands,
not the system clipboard: a copied beat is a document fragment no other program reads.

- **Copy** takes the selection's beats bar by bar, from one staff. A multitrack rectangle is refused.
- **Paste** writes each copied bar's beats into the matching bar from the caret's: into the caret's
  bar from the caret's beat, into each later bar from its start. The beats it lands on are removed
  until the copied length is covered; if the last one reached past it, the spare fills with rests right
  after the pasted beats. A copied bar longer than the room left makes its bar over, for Fix bar. A
  paste that runs off the end of the score appends bars (and stamps generated tracks diverged, as any
  bar insertion does). Beats copied from a fretted staff do not paste onto a pitched one or the other
  way round, and a staff with fewer strings than the notes use is refused.
- **Cut** is copy, then clear to rests, as one undo step.

**Files:**
- Create: `client/src/app/services/beat-clipboard.ts`
- Modify: `client/src/app/services/composer-entry-commands.ts`, `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/beat-clipboard.spec.ts`, `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs**

<!-- apply: create client/src/app/services/beat-clipboard.spec.ts -->
```typescript
import { copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { scoreBarFills } from './bar-fill';
import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

const ref = (barIndex: number, beatIndex: number, trackIndex = 0): BeatRef =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });
const beats = (doc: ScoreDoc, bar: number) => doc.tracks[0].staves[0].bars[bar].voices[0].beats;
const shape = (doc: ScoreDoc, bar: number): string[] =>
  beats(doc, bar).map(beat => `${beat.isRest ? 'r' : 'n'}${beat.duration}${'.'.repeat(beat.dots)}`);
const withNote = (doc: ScoreDoc, bar: number, beat: number): void => {
  const target = beats(doc, bar)[beat];
  target.isRest = false;
  target.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
};

describe('copiedBeatsOf', () => {
  it('copies a range bar by bar', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);

    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(copied?.bars.map(bar => bar.length)).toEqual([1, 1]);
    expect(copied?.fretted).toBeTrue();
  });

  it('copies nothing from more than one staff', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(copiedBeatsOf(doc, [ref(0, 0), ref(0, 0, 1)])).toBeNull();
  });
});

describe('pasteBeats', () => {
  it('writes the copied beats from the caret, over what was there', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 0);
    withNote(doc, 0, 1);
    const copied = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1)]);

    expect(pasteBeats(doc, ref(1, 1), copied!)).toEqual({ appendedBars: 0 });

    expect(shape(doc, 1)).toEqual(['r4', 'n4', 'n4', 'r4']);
  });

  it('fills the spare right after the pasted beats when they end inside a beat', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 1, createRestBeat(8), createRestBeat(8));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 0), copied!);

    expect(shape(doc, 1)).toEqual(['n8', 'r8', 'r4', 'r4', 'r4']);
  });

  it('leaves a bar over when the copied beats are longer than its room', () => {
    const doc = ComposerService.createEmptyScore();
    beats(doc, 0).splice(0, 2, createRestBeat(2));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    pasteBeats(doc, ref(1, 3), copied!);

    expect(scoreBarFills(doc)[0][0][1]).toEqual({ kind: 'over', ticks: 960 });
  });

  it('pastes across a bar line, and appends bars when it runs off the end', () => {
    const doc = ComposerService.createEmptyScore();
    withNote(doc, 0, 3);
    withNote(doc, 1, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 3), ref(1, 0)]);

    expect(pasteBeats(doc, ref(3, 3), copied!)).toEqual({ appendedBars: 1 });

    expect(shape(doc, 3)).toEqual(['r4', 'r4', 'r4', 'n4']);
    expect(shape(doc, 4)[0]).toBe('n4');
    expect(doc.masterBars.length).toBe(5);
  });

  it('refuses fretted beats on a pitched staff', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    withNote(doc, 0, 0);
    const copied = copiedBeatsOf(doc, [ref(0, 0)]);

    expect(pasteBeats(doc, ref(0, 0, 1), copied!)).toMatch(/fretted/i);
  });
});
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService cut, copy and paste', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a paste with nothing copied', () => {
    service.paste();

    expect(stateOf(service).refusal).toMatch(/copied/i);
  });

  it('pastes a copied range at the caret as one undo step', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 2, beatIndex: 0 });

    service.paste();
    expect(beatsIn(service, 2).slice(0, 2).map(beat => beat.notes[0]?.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 5 },
      { kind: 'fretted', string: 1, fret: 7 }
    ]);

    service.undo();
    expect(beatsIn(service, 2).every(beat => beat.isRest)).toBeTrue();
  });

  it('cuts by copying and clearing, and the cut pastes back', () => {
    writeFret(service, 0, 0, 5);
    service.setCursor({ beatIndex: 0 });

    service.cut();
    expect(beatsIn(service)[0].isRest).toBeTrue();

    service.paste();
    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 5 });
  });
});
```

**Step 2: Run** both spec files. Expected: compile errors,
`TS2307: Cannot find module './beat-clipboard'` and `TS2339: Property 'paste' does not exist on type 'ComposerService'.`

**Step 3: Implement**

<!-- apply: create client/src/app/services/beat-clipboard.ts -->
```typescript
import { BeatDoc, ScoreDoc } from '../models/composer.model';
import { barMeterAt, beatTicks, fillBarGaps, insertRestsAt } from './bar-fill';
import { BeatRef, beatAt } from './composer-selection';
import { insertBarInto } from './score-structure';

/**
 * The composer's clipboard: beats copied from one staff, and pasting them at the caret.
 *
 * Paste follows design Part 4: it writes from the caret for the copied length and fills gaps where they
 * open, and a bar it overfills is flagged for Fix bar rather than pushed on.
 */

/** Beats copied from one staff. */
export interface CopiedBeats {
  /** Whether they came from a fretted staff, whose notes name strings rather than pitches. */
  fretted: boolean;
  /** The copied beats bar by bar, first bar first: `bars[1]` came from the bar after `bars[0]`'s. */
  bars: BeatDoc[][];
}

/** The beats `refs` name, copied bar by bar - or null when they are on more than one staff, or name none. */
export function copiedBeatsOf(doc: ScoreDoc, refs: readonly BeatRef[]): CopiedBeats | null {
  const first = refs[0];
  if (!first || refs.some(ref => ref.trackIndex !== first.trackIndex || ref.staffIndex !== first.staffIndex)) return null;
  const staff = doc.tracks[first.trackIndex]?.staves[first.staffIndex];
  if (!staff) return null;

  const bars: BeatDoc[][] = [];
  for (const ref of refs) {
    const beat = beatAt(doc, ref);
    if (!beat) continue;
    const offset = ref.barIndex - first.barIndex;
    while (bars.length <= offset) bars.push([]);
    bars[offset].push(structuredClone(beat));
  }
  return { fretted: staff.tuning.length > 0, bars };
}

/**
 * Pastes `copied` at `at`, or returns why not. Each copied bar is written into the bar as many after
 * `at`'s as it was after the first copied bar: into `at`'s own bar from `at`'s beat, into later bars
 * from their start. The beats it lands on are removed until the copied length is covered, and when the
 * last one reached past it the spare fills with rests right after the pasted beats (`insertRestsAt`);
 * a bar left short fills at its end. A bar the copied beats overfill stays over, for Fix bar. Bars are
 * appended when the paste runs off the end, and how many is returned so the caller can stamp generated
 * tracks diverged.
 *
 * **May leave `doc` partly changed when it refuses**, like every edit that returns a reason - call it on a draft.
 */
export function pasteBeats(doc: ScoreDoc, at: BeatRef, copied: CopiedBeats): { appendedBars: number } | string {
  const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
  if (!staff) return 'There is no staff there.';
  if ((staff.tuning.length > 0) !== copied.fretted) {
    return copied.fretted
      ? 'Those beats were copied from a fretted staff, and this staff has no strings.'
      : 'Those beats were copied from a pitched staff, and this staff writes notes by string.';
  }
  const strings = copied.bars.flat().flatMap(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.string : 0)));
  const highest = Math.max(0, ...strings);
  if (highest > staff.tuning.length) return `Those beats use ${highest} strings, and this staff has ${staff.tuning.length}.`;

  let appendedBars = 0;
  copied.bars.forEach((copiedBar, offset) => {
    const barIndex = at.barIndex + offset;
    while (barIndex >= staff.bars.length) {
      insertBarInto(doc, doc.masterBars.length);
      appendedBars++;
    }
    const bar = staff.bars[barIndex];
    const voice = bar.voices[at.voiceIndex];
    if (!voice) return;

    const meter = barMeterAt(doc, barIndex);
    const written = copiedBar.map(beat => structuredClone(beat));
    const span = written.reduce((sum, beat) => sum + beatTicks(beat), 0);
    const start = offset === 0 ? Math.min(at.beatIndex, voice.beats.length) : 0;

    let covered = 0;
    while (covered < span && start < voice.beats.length) {
      covered += beatTicks(voice.beats[start]);
      voice.beats.splice(start, 1);
    }
    voice.beats.splice(start, 0, ...written);
    if (covered > span) insertRestsAt(voice, start + written.length, covered - span, meter);
    fillBarGaps(bar, meter);
  });
  return { appendedBars };
}
```

In `composer-entry-commands.ts`:

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
import { clearToRests, deleteBeats, insertBeatAt, setBeatDurations } from './beat-edits';
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
import { CopiedBeats, copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { clearToRests, deleteBeats, insertBeatAt, setBeatDurations } from './beat-edits';
```

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
  private lastEntry: { at: EditCursor; doc: ScoreDoc } | null = null;
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
  private lastEntry: { at: EditCursor; doc: ScoreDoc } | null = null;

  /** What Copy or Cut last took. The composer's own clipboard: nothing outside the page reads a beat. */
  private clipboard: CopiedBeats | null = null;
```

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```typescript
  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
```

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```typescript
  /** Copies the selection's beats, from one staff. Not an edit: nothing is committed. */
  copy(): void {
    const state = this.host.state();
    const copied = copiedBeatsOf(state.doc, selectionTargets(state.doc, state.anchor, state.cursor));
    if (!copied) return this.host.refuse('Copy takes beats from one staff at a time.');
    this.clipboard = copied;
  }

  /** Copies the selection's beats and clears them to rests, as one undo step. */
  cut(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null);
    if (refusal) return this.host.refuse(refusal);
    const copied = copiedBeatsOf(state.doc, refs);
    if (!copied) return this.host.refuse('Cut takes beats from one staff at a time.');
    this.clipboard = copied;
    this.host.commitFollowing(draft => clearToRests(draft, refs));
  }

  /** Pastes the clipboard at the caret. See `pasteBeats`. */
  paste(): void {
    const state = this.host.state();
    const clipboard = this.clipboard;
    if (!clipboard) return this.host.refuse('Nothing has been copied yet.');
    if (this.refusesEntryAt(state.doc, state.cursor)) return;
    this.host.commit(draft => {
      const result = pasteBeats(draft, state.cursor, clipboard);
      if (typeof result === 'string') return result;
      if (result.appendedBars > 0) this.host.markDiverged(draft);
      return null;
    });
  }

  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
```

In `composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  setInputDuration(duration: DurationValue, dots = 0): void {
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Copies the selection's beats to the composer's clipboard. */
  copy(): void {
    this.entry.copy();
  }

  /** Copies the selection's beats and clears them to rests. */
  cut(): void {
    this.entry.cut();
  }

  /** Pastes the clipboard at the caret. See `pasteBeats`. */
  paste(): void {
    this.entry.paste();
  }

  setInputDuration(duration: DurationValue, dots = 0): void {
```

**Step 4: Run** both spec files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Cut, copy and paste beats`.

### Task 1.15: Repeat close as a toggle, and inserting and deleting the selected bars

- **Repeat close** (`]`) is a toggle over the selected bars: a repeat played twice, unless every
  selected bar already closes one, and then none. M1's `setMasterBarValue('repeatCount', …)` takes a
  number, which a key cannot.
- **Insert bar** inserts as many bars as are selected, in front of the first.
- **Delete bar** removes the selected bars, refusing to remove every bar. Removing bars that declared a
  meter moves the declaration to the bar that now follows, so a 3/4 score does not become 4/4 when its
  first bar goes - the fault M1 fixed for `insertBar(0)`, which `removeBar(0)` still had. `removeBar`
  now goes through the same function.

**Files:**
- Modify: `client/src/app/services/bar-edits.ts`, `client/src/app/services/composer-service-structure.ts`,
  `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/bar-edits.spec.ts`, `client/src/app/services/composer.service.editing.spec.ts`

**Step 1: Failing specs.** Append to `bar-edits.spec.ts`:

<!-- apply: append client/src/app/services/bar-edits.spec.ts -->
```typescript
describe('toggleRepeatClose, insertBarsBefore and deleteBars', () => {
  const threeFour = THREE_FOUR;

  it('closes a repeat played twice, and opens it again when every bar closes one', () => {
    const doc = ComposerService.createEmptyScore();
    doc.masterBars[1].repeatCount = 3;

    toggleRepeatClose(doc, { first: 0, last: 1 });
    expect(doc.masterBars.slice(0, 2).map(bar => bar.repeatCount)).toEqual([2, 3]);

    toggleRepeatClose(doc, { first: 0, last: 1 });
    expect(doc.masterBars.slice(0, 2).map(bar => bar.repeatCount)).toEqual([0, 0]);
  });

  it('inserts bars in front of a bar, on every staff', () => {
    const doc = ComposerService.createEmptyScore();

    insertBarsBefore(doc, 1, 2);

    expect(doc.masterBars.length).toBe(6);
    expect(doc.tracks[0].staves[0].bars.length).toBe(6);
  });

  it('refuses to delete every bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(deleteBars(doc, { first: 0, last: 3 })).toMatch(/at least one bar/i);
    expect(doc.masterBars.length).toBe(4);
  });

  it('keeps the meter the deleted first bar declared', () => {
    const doc = ComposerService.createEmptyScore();
    setTimeSignature(doc, 0, threeFour);

    expect(deleteBars(doc, { first: 0, last: 0 })).toBeNull();

    expect(doc.masterBars.length).toBe(3);
    expect(doc.masterBars[0].timeSignature).toEqual(threeFour);
  });

  it('moves a later declaration to the bar that follows the deleted ones, and drops one that repeats', () => {
    const doc = ComposerService.createEmptyScore();
    setTimeSignature(doc, 2, threeFour);

    deleteBars(doc, { first: 1, last: 2 });
    expect(doc.masterBars[1].timeSignature).toEqual(threeFour);

    // Bar 3 repeats bar 1's 3/4 - a shape a loaded file can have. With bar 2 gone it follows bar 1
    // directly, so its declaration repeats the meter in force and is dropped.
    const same = ComposerService.createEmptyScore();
    setTimeSignature(same, 1, threeFour);
    same.masterBars[3].timeSignature = { ...threeFour };
    deleteBars(same, { first: 2, last: 2 });
    expect(same.masterBars.map(bar => bar.timeSignature?.numerator ?? null)).toEqual([4, 3, null]);
  });
});
```

and import the three beside the existing `bar-edits` imports:

<!-- apply: find client/src/app/services/bar-edits.spec.ts -->
```typescript
  toggleMasterBarFlag
} from './bar-edits';
```

<!-- apply: replace client/src/app/services/bar-edits.spec.ts -->
```typescript
  toggleMasterBarFlag,
  deleteBars,
  insertBarsBefore,
  toggleRepeatClose
} from './bar-edits';
```

Append to `composer.service.editing.spec.ts`:

<!-- apply: append client/src/app/services/composer.service.editing.spec.ts -->
```typescript
describe('ComposerService bars over the selection', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('closes a repeat over the selected bars and opens it again', () => {
    service.setCursor({ barIndex: 1 });
    service.extendSelectionTo({ barIndex: 2 });

    service.toggleRepeatClose();
    expect(service.doc.masterBars.map(bar => bar.repeatCount)).toEqual([0, 2, 2, 0]);

    service.toggleRepeatClose();
    expect(service.doc.masterBars.map(bar => bar.repeatCount)).toEqual([0, 0, 0, 0]);
  });

  it('inserts as many bars as are selected, and the selection follows its beats', () => {
    service.setCursor({ barIndex: 1 });
    service.extendSelectionTo({ barIndex: 2 });

    service.insertBarsBeforeSelection();

    expect(service.doc.masterBars.length).toBe(6);
    expect(stateOf(service).anchor?.barIndex).toBe(3);
  });

  it('refuses to delete every bar, saying why', () => {
    service.selectAllInTrack();

    service.deleteSelectedBars();

    expect(service.doc.masterBars.length).toBe(4);
    expect(stateOf(service).refusal).toMatch(/at least one bar/i);
  });

  it('keeps a 3/4 score in 3/4 when its first bar is removed', () => {
    service.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    service.removeBar(0);

    expect(service.scoreMeter.numerator).toBe(3);
  });
});
```

**Step 2: Run** both spec files. Expected: compile errors,
`TS2305: Module '"./bar-edits"' has no exported member 'deleteBars'.` (and the other two) and
`TS2339: Property 'toggleRepeatClose' does not exist on type 'ComposerService'.`

**Step 3: Implement.** Append to `bar-edits.ts`, and import `insertBarInto`:

<!-- apply: find client/src/app/services/bar-edits.ts -->
```typescript
import { toggledValue } from './beat-edits';
```

<!-- apply: replace client/src/app/services/bar-edits.ts -->
```typescript
import { toggledValue } from './beat-edits';
import { insertBarInto } from './score-structure';
```

<!-- apply: append client/src/app/services/bar-edits.ts -->
```typescript
/**
 * Presses Repeat close over bars `first` to `last`, by the toggle rule: each bar closes a repeat played
 * twice - or keeps the count it already has - unless every one already closes a repeat, and then none
 * does. `repeatCount` is how many times the section plays, so two is a plain repeat.
 */
export function toggleRepeatClose(doc: ScoreDoc, bars: { first: number; last: number }): void {
  const targets = doc.masterBars.slice(bars.first, bars.last + 1);
  const closing = !targets.every(bar => bar.repeatCount > 0);
  for (const bar of targets) bar.repeatCount = closing ? Math.max(bar.repeatCount, 2) : 0;
}

/** Inserts `count` bars in front of bar `first`, across every track. See `insertBarInto`. */
export function insertBarsBefore(doc: ScoreDoc, first: number, count: number): void {
  for (let inserted = 0; inserted < count; inserted++) insertBarInto(doc, first);
}

/**
 * Removes bars `first` to `last` from every track, or returns why not: a score keeps at least one bar.
 *
 * The meter in force after the removed bars is kept. The bar that now follows them declares it, unless
 * it is already the meter in force before them - the declare-on-change shape the mapper reads a file
 * into, and the rule `insertBarInto` keeps for bar 1. Without this, removing a 3/4 score's first bar
 * would leave a bar 1 that declares nothing, which reads as 4/4.
 */
export function deleteBars(doc: ScoreDoc, bars: { first: number; last: number }): string | null {
  const count = bars.last - bars.first + 1;
  if (count >= doc.masterBars.length) return 'A score needs at least one bar.';

  const hasFollowing = bars.last + 1 < doc.masterBars.length;
  const following = effectiveTimeSignature(doc.masterBars, bars.last + 1);
  doc.masterBars.splice(bars.first, count);
  for (const track of doc.tracks) {
    for (const staff of track.staves) staff.bars.splice(bars.first, count);
  }

  if (hasFollowing) {
    const inForce = bars.first > 0 ? effectiveTimeSignature(doc.masterBars, bars.first - 1) : null;
    doc.masterBars[bars.first].timeSignature = sameMeter(inForce, following) ? null : { ...following };
  }
  return null;
}
```

In `composer-service-structure.ts`:

<!-- apply: find client/src/app/services/composer-service-structure.ts -->
```typescript
import {
  keySignatureFault,
  setClef,
```

<!-- apply: replace client/src/app/services/composer-service-structure.ts -->
```typescript
import {
  deleteBars,
  insertBarsBefore,
  keySignatureFault,
  toggleRepeatClose,
  setClef,
```

<!-- apply: find client/src/app/services/composer-service-structure.ts -->
```typescript
  /**
   * A bar edit over the selected bars. Score-wide, like `insertBar`: never refused on a
```

<!-- apply: replace client/src/app/services/composer-service-structure.ts -->
```typescript
  /** Repeat close over the selected bars, by the toggle rule. See `toggleRepeatClose`. */
  toggleRepeatClose(): void {
    this.applyBarEdit((draft, bars) => toggleRepeatClose(draft, bars));
  }

  /** Inserts as many bars as are selected, in front of the first. The selection follows its beats. */
  insertBarsBeforeSelection(): void {
    this.applyBarEdit((draft, bars) => insertBarsBefore(draft, bars.first, bars.last - bars.first + 1));
  }

  /** Removes the selected bars from every track. See `deleteBars`. */
  deleteSelectedBars(): void {
    const state = this.host.state();
    const bars = selectedBars(state.anchor, state.cursor);
    this.host.commitFollowing(draft => {
      const refusal = deleteBars(draft, bars);
      if (refusal) return refusal;
      this.host.markDiverged(draft);
      return null;
    });
  }

  /**
   * A bar edit over the selected bars. Score-wide, like `insertBar`: never refused on a
```

In `composer.service.ts`, the delegations, and `removeBar` through `deleteBars`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  /** Carries the overflow of every over bar in the selection into the bars after it, all or nothing. */
  fixBar(): void {
    this.structure.fixBar();
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Carries the overflow of every over bar in the selection into the bars after it, all or nothing. */
  fixBar(): void {
    this.structure.fixBar();
  }

  /** Repeat close over the selected bars, by the toggle rule. */
  toggleRepeatClose(): void {
    this.structure.toggleRepeatClose();
  }

  /** Inserts as many bars as are selected, in front of the first. */
  insertBarsBeforeSelection(): void {
    this.structure.insertBarsBeforeSelection();
  }

  /** Removes the selected bars from every track, keeping the meter after them. */
  deleteSelectedBars(): void {
    this.structure.deleteSelectedBars();
  }
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  removeBar(index: number): void {
    if (this.doc.masterBars.length <= 1) return;
    this.commit(draft => {
      const at = Math.max(0, Math.min(index, draft.masterBars.length - 1));
      draft.masterBars.splice(at, 1);
      for (const track of draft.tracks) {
        for (const staff of track.staves) {
          staff.bars.splice(at, 1);
        }
      }
      this.markDiverged(draft);
    });
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  /** Removes bar `index` from every track, keeping the meter after it. See `deleteBars`. */
  removeBar(index: number): void {
    if (this.doc.masterBars.length <= 1) return;
    this.commit(draft => {
      const at = Math.max(0, Math.min(index, draft.masterBars.length - 1));
      deleteBars(draft, { first: at, last: at });
      this.markDiverged(draft);
    });
  }
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
import { insertBarInto } from './score-structure';
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
import { deleteBars } from './bar-edits';
import { insertBarInto } from './score-structure';
```

**Step 4: Run** both spec files. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Repeat close as a toggle, insert and delete the selected bars, and keep the meter when bar 1 goes`.

### Task 1.16: Phase 1 checkpoint

**Step 1:** Run both type checks and the whole suite (from `client/`):

```bash
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.spec.json --noEmit
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAILED|TOTAL|error TS" | tail -20
```

Expected: no type errors, and every spec passes. The proof run for this plan recorded the total under
"The proof" at the top.

**Step 2:** `wc -l client/src/app/services/composer.service.ts` - it must be under 1000.

**Step 3:** Nothing to commit if both are clean.

## Phase 2: the tool table, `toolStates`, and the keyboard handler

One table declares every tool: its label, group, glyph, keys and command. The palette (Phase 3), the
tooltips, the `?` sheet and the keyboard handler all read it, so a key cannot drift from its button.
`toolStates` says what each button shows and why a press would be refused, from the same refusals the
commands use. Nothing in the page reads either until Phase 3.

**Phase 2 exports**

| Module | Exports | Task |
|---|---|---|
| `editable-target.ts` (new) | `isEditableTarget` (lifted from `progression.component.ts`) | 2.1 |
| `composer-key-bindings.ts` (new) | `KeyBinding`, `KeyPress`, `bindingMatches`, `bindingMatchesTyped`, `bindingLabelOf`, `bindingSignatureOf`, `BROWSER_RESERVED` | 2.2 |
| `composer-tool-states.ts` (new) | `ToolState`, `IDLE_TOOL`, `toolStates`, `toolStateOf`, `TOOLS_WITH_STATE` | 2.3 |
| `composer-tools.ts` (new) | `ToolGroup`, `ToolGlyph`, `PopoverKind`, `ComposerToolHost`, `ComposerTool`, `COMPOSER_TOOLS`, `PALETTE_GROUPS`, `KEYLESS_TOOLS`, `toolForPress`, `DURATION_ORDER` | 2.4 |
| `composer.service.ts` | `get state()` | 2.4 |
| `composer-fret-entry.ts` (new) | `FretDigitEntry` | 2.5 |
| `composer-key-handler.ts` (new) | `KeyEventLike`, `ComposerKeyHandler` | 2.6 |
| `app.component.ts` | `onEscape(event)` claims Escape only when it closes the drawer | 2.7 |

### Task 2.1: One helper for "is this key press someone typing"

The composer's handler skips form fields by tag name and misses `contentEditable`. The progression page
already has the complete test as a private function; lift it into a shared module so both pages ask the
same question.

**Files:**
- Create: `client/src/app/services/editable-target.ts`
- Modify: `client/src/app/components/progression/progression.component.ts`
- Test: `client/src/app/services/editable-target.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/editable-target.spec.ts -->
```typescript
import { isEditableTarget } from './editable-target';

describe('isEditableTarget', () => {
  const attached: HTMLElement[] = [];

  /** An element in the document, since `isContentEditable` reads the rendered state. */
  function element<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    document.body.appendChild(created);
    attached.push(created);
    return created;
  }

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  it('is true for an input, a textarea and a select', () => {
    expect(isEditableTarget(element('input'))).toBeTrue();
    expect(isEditableTarget(element('textarea'))).toBeTrue();
    expect(isEditableTarget(element('select'))).toBeTrue();
  });

  it('is true inside a contentEditable element', () => {
    const editor = element('div');
    editor.contentEditable = 'true';
    const inner = document.createElement('span');
    editor.appendChild(inner);

    expect(isEditableTarget(editor)).toBeTrue();
    expect(isEditableTarget(inner)).toBeTrue();
  });

  it('is false for a button, the document body, and no target', () => {
    expect(isEditableTarget(element('button'))).toBeFalse();
    expect(isEditableTarget(document.body)).toBeFalse();
    expect(isEditableTarget(null)).toBeFalse();
  });
});
```

**Step 2: Run** with `--include=src/app/services/editable-target.spec.ts`. Expected: a compile error,
`TS2307: Cannot find module './editable-target'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/editable-target.ts -->
```typescript
/**
 * Whether a key press belongs to something the user is typing into.
 *
 * Asked by every page that binds document-wide shortcuts, before it takes a key: a letter typed into a
 * title field is a letter, and `Ctrl+Z` inside a text box is the browser's undo of the typing, which
 * `preventDefault` would take away. `<select>` is in the list because it reads its own key presses, and
 * `isContentEditable` because a rich-text field is neither tag - and is true for every element inside
 * one, not only the element carrying the attribute.
 *
 * Lifted from `progression.component.ts`, where it was private, when the composer's keyboard handler
 * needed the same answer: the composer's own check read tag names only and missed `contentEditable`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
```

In `progression.component.ts`, import it, use it, and delete the private copy:

<!-- apply: find client/src/app/components/progression/progression.component.ts -->
```typescript
import { errorOf } from '../../services/error-message';
```

<!-- apply: replace client/src/app/components/progression/progression.component.ts -->
```typescript
import { isEditableTarget } from '../../services/editable-target';
import { errorOf } from '../../services/error-message';
```

<!-- apply: find client/src/app/components/progression/progression.component.ts -->
```typescript
    if (isEditable(event.target)) return;
```

<!-- apply: replace client/src/app/components/progression/progression.component.ts -->
```typescript
    if (isEditableTarget(event.target)) return;
```

<!-- apply: find client/src/app/components/progression/progression.component.ts -->
```typescript
  + 'open the Composer from the navigation at the top of the page to see the track.';

/**
 * Whether a key press belongs to something the user is typing into.
 *
 * The tempo box is on this page, and `Ctrl+Z` inside a text box means undo the
 * typing - the browser's own, which `preventDefault` would otherwise take away.
 * `<select>` is in the list because it is a form control that reads its own key
 * presses, and `isContentEditable` because a rich-text field is neither tag.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT';
}
```

<!-- apply: replace client/src/app/components/progression/progression.component.ts -->
```typescript
  + 'open the Composer from the navigation at the top of the page to see the track.';
```

**Step 4: Run** `editable-target.spec.ts` and the progression component's specs
(`--include=src/app/components/progression/progression.component.spec.ts`). Expected: all SUCCESS.

**Step 5: Commit**: `refactor: Share the editable-target check between the progression page and the composer`.

### Task 2.2: Key bindings, and how a press matches one

The design's matching rules (Shortcuts, "Sources and how conflicts were settled"), and decision 6's
exactness:

- **Modifiers match exactly.** Ctrl and Cmd are one modifier (`ctrlKey || metaKey`), so Ctrl+Z is Cmd+Z
  on a Mac. So Ctrl+1 binds nothing and is left to the browser, and Ctrl+Alt+Z is not undo.
- **Ctrl or Alt combinations name a physical key** (`KeyboardEvent.code`), because macOS Option
  rewrites `key` (Option+- is an en dash).
- **A letter** matches `key` in either case, with Shift exactly as bound: Caps Lock does not change the
  tool, Shift does.
- **A digit or a symbol** matches `key` whatever Shift says, because a symbol needs Shift on one layout
  and not another - `?` is Shift+/ in the US, and every digit needs Shift on AZERTY.
- **A named key** - an arrow, Home, Delete, Space, Insert - matches `key` with Shift exactly as bound.

One refinement the design did not state: **a symbol typed through AltGr or Option still matches**,
checked only after every exact binding has failed. `}` is AltGr+0 on a German keyboard and `[` is
Option+5 on a German Mac, so an exact check would put the alternate ending and repeat open out of reach
on those layouts. Digits are never relaxed, so Alt+1 and AltGr+1 write no fret, and Alt+/ still reaches
the tuplet tool (an exact binding) before the triplet's `/`.

**Files:**
- Create: `client/src/app/services/composer-key-bindings.ts`
- Test: `client/src/app/services/composer-key-bindings.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-key-bindings.spec.ts -->
```typescript
import {
  BROWSER_RESERVED,
  KeyPress,
  bindingLabelOf,
  bindingMatches,
  bindingMatchesTyped,
  bindingSignatureOf
} from './composer-key-bindings';

/** A key press with no modifiers, and `init` over it. */
const press = (init: Partial<KeyPress>): KeyPress => ({
  key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init
});

describe('bindingMatches', () => {
  it('matches a letter in either case, with Shift exactly as bound', () => {
    expect(bindingMatches({ key: 'r' }, press({ key: 'r', code: 'KeyR' }))).toBeTrue();
    expect(bindingMatches({ key: 'r' }, press({ key: 'R', code: 'KeyR' }))).toBeTrue();
    expect(bindingMatches({ key: 'r' }, press({ key: 'R', code: 'KeyR', shiftKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 's', shift: true }, press({ key: 'S', code: 'KeyS', shiftKey: true }))).toBeTrue();
  });

  it('matches a symbol or a digit whatever Shift says', () => {
    expect(bindingMatches({ key: '?' }, press({ key: '?', code: 'Slash', shiftKey: true }))).toBeTrue();
    expect(bindingMatches({ key: '1' }, press({ key: '1', code: 'Digit1', shiftKey: true }))).toBeTrue();
  });

  it('matches a named key with Shift exactly, so Space and Shift+Space differ', () => {
    expect(bindingMatches({ key: ' ' }, press({ key: ' ', code: 'Space' }))).toBeTrue();
    expect(bindingMatches({ key: ' ' }, press({ key: ' ', code: 'Space', shiftKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 'ArrowLeft', shift: true }, press({ key: 'ArrowLeft', shiftKey: true }))).toBeTrue();
  });

  it('checks Ctrl and Alt exactly, reading Cmd as Ctrl', () => {
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', metaKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(bindingMatches({ key: '1' }, press({ key: '1', code: 'Digit1', ctrlKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 'ArrowRight' }, press({ key: 'ArrowRight', ctrlKey: true }))).toBeFalse();
  });

  it('matches a Ctrl or Alt combination by physical key, whatever the key produced', () => {
    // macOS Option+- produces an en dash.
    expect(bindingMatches({ code: 'Minus', alt: true }, press({ key: '–', code: 'Minus', altKey: true }))).toBeTrue();
  });
});

describe('bindingMatchesTyped', () => {
  it('matches a symbol typed through AltGr or Option', () => {
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'Digit0', ctrlKey: true, altKey: true }))).toBeTrue();
    expect(bindingMatchesTyped({ key: '[' }, press({ key: '[', code: 'Digit5', altKey: true }))).toBeTrue();
  });

  it('never relaxes a digit, a letter, a named key, Ctrl alone or Cmd', () => {
    expect(bindingMatchesTyped({ key: '1' }, press({ key: '1', code: 'Digit1', altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: 'q' }, press({ key: 'q', code: 'KeyQ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: 'Home' }, press({ key: 'Home', altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'BracketRight', ctrlKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'BracketRight', metaKey: true, altKey: true }))).toBeFalse();
  });
});

describe('bindingLabelOf', () => {
  it('writes modifiers, then the key as printed', () => {
    expect(bindingLabelOf({ code: 'KeyZ', ctrl: true, shift: true })).toBe('Ctrl+Shift+Z');
    expect(bindingLabelOf({ code: 'Minus', alt: true })).toBe('Alt+-');
    expect(bindingLabelOf({ key: 's', shift: true })).toBe('Shift+S');
    expect(bindingLabelOf({ key: ' ', shift: true })).toBe('Shift+Space');
    expect(bindingLabelOf({ key: 'ArrowLeft', ctrl: true })).toBe('Ctrl+←');
    expect(bindingLabelOf({ key: 'Escape' })).toBe('Esc');
    expect(bindingLabelOf({ code: 'Digit3', ctrl: true, shift: true })).toBe('Ctrl+Shift+3');
    expect(bindingLabelOf({ key: '?' })).toBe('?');
  });
});

describe('bindingSignatureOf and BROWSER_RESERVED', () => {
  it('writes a letter bound by key and by code the same way, so collisions are found', () => {
    expect(bindingSignatureOf({ key: 'n', ctrl: true })).toBe(bindingSignatureOf({ code: 'KeyN', ctrl: true }));
  });

  it('reserves the browser\'s keys from the design', () => {
    const reserved = new Set(BROWSER_RESERVED.map(bindingSignatureOf));

    expect(reserved.has(bindingSignatureOf({ code: 'KeyT', ctrl: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ code: 'Digit9', ctrl: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ code: 'KeyS', alt: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ key: 'F5' }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ key: 'Delete', ctrl: true, shift: true }))).toBeTrue();
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-key-bindings.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-key-bindings'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-key-bindings.ts -->
```typescript
/**
 * Key bindings for the composer's tools: what a binding is, whether a key press matches one, and how one
 * is written in a tooltip and on the shortcut sheet.
 *
 * The rules are the design's, under "Shortcuts": modifiers exactly, with Cmd read as Ctrl; a Ctrl or Alt
 * combination by physical key, because macOS Option rewrites `key`; a letter in either case with Shift
 * exactly; a digit or symbol whatever Shift says, because which symbols need Shift depends on the layout;
 * a named key with Shift exactly. And one the design did not state: a symbol typed through AltGr or
 * Option (`bindingMatchesTyped`), asked only after every exact binding has failed.
 */

/** One key press a tool answers to. Exactly one of `key` and `code`. */
export interface KeyBinding {
  /** `KeyboardEvent.key`: a lower-case letter, a digit, a symbol, or a named key such as `ArrowLeft` or `' '`. */
  key?: string;
  /** `KeyboardEvent.code`, for a combination held with Ctrl or Alt. */
  code?: string;
  /** Ctrl, or Cmd on a Mac. */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** The parts of a `KeyboardEvent` a binding is matched against. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const isLetter = (key: string): boolean => /^[a-z]$/i.test(key);
const isDigit = (key: string): boolean => /^[0-9]$/.test(key);
/** A printable key whose Shift depends on the layout: one character, not a letter and not a space. */
const isShiftFree = (key: string): boolean => key.length === 1 && !isLetter(key) && key !== ' ';

/** Whether `press` is exactly `binding`. */
export function bindingMatches(binding: KeyBinding, press: KeyPress): boolean {
  if ((press.ctrlKey || press.metaKey) !== !!binding.ctrl || press.altKey !== !!binding.alt) return false;
  if (binding.code !== undefined) return press.code === binding.code && press.shiftKey === !!binding.shift;

  const key = binding.key ?? '';
  if (isLetter(key)) return press.key.toLowerCase() === key.toLowerCase() && press.shiftKey === !!binding.shift;
  if (isShiftFree(key)) return press.key === key;
  return press.key === key && press.shiftKey === !!binding.shift;
}

/**
 * Whether `press` typed `binding`'s symbol through AltGr (Windows reports it as Ctrl+Alt) or Option
 * (Alt alone): the only way to type `}` on a German keyboard or `[` on a German Mac. Symbols only - never
 * a digit, so no Alt or AltGr press writes a fret - and never with Cmd or Ctrl alone. Ask it only after
 * every exact binding has failed, so Alt+/ is still the tuplet tool and not the triplet's `/`.
 */
export function bindingMatchesTyped(binding: KeyBinding, press: KeyPress): boolean {
  const key = binding.key;
  if (key === undefined || binding.ctrl || binding.alt || !isShiftFree(key) || isDigit(key)) return false;
  if (press.metaKey || !press.altKey) return false;
  return press.key === key;
}

/** Named keys as a tooltip prints them. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc'
};

/** Physical keys that are not letters or digits, as a tooltip prints them. */
const CODE_LABELS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Space: 'Space'
};

/** How `binding` is written in a tooltip and on the shortcut sheet: `Ctrl+Shift+Z`, `Alt+-`, `?`. */
export function bindingLabelOf(binding: KeyBinding): string {
  const modifiers = [binding.ctrl ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : ''].filter(Boolean);
  let key: string;
  if (binding.code !== undefined) {
    const code = binding.code;
    key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : CODE_LABELS[code] ?? code;
  } else {
    const raw = binding.key ?? '';
    key = KEY_LABELS[raw] ?? (isLetter(raw) ? raw.toUpperCase() : raw);
  }
  return [...modifiers, key].join('+');
}

/**
 * One string per distinct press, for finding two bindings that would answer the same one: modifiers,
 * then the physical key. A letter or digit bound by `key` is written as its `code`, so `{ key: 'n' }`
 * and `{ code: 'KeyN' }` are the same key; a shift-free symbol writes `*` for Shift, since it matches
 * either way.
 */
export function bindingSignatureOf(binding: KeyBinding): string {
  const key = binding.key ?? '';
  const physical =
    binding.code ?? (isLetter(key) ? `Key${key.toUpperCase()}` : isDigit(key) ? `Digit${key}` : `key:${key}`);
  const shift = binding.code === undefined && isShiftFree(key) ? '*' : binding.shift ? 'S' : '-';
  return `${binding.ctrl ? 'C' : '-'}${binding.alt ? 'A' : '-'}${shift} ${physical}`;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * What the browser keeps, from the design's rule 1: Ctrl+N, Ctrl+T, Ctrl+W and their Shift forms,
 * Ctrl+Tab, Ctrl+1 to 9 (tab switching), Alt+letter (Firefox menus), F5, F11, F12 and Ctrl+Shift+Delete.
 * The tool table's spec checks no tool is bound to any of them.
 */
export const BROWSER_RESERVED: readonly KeyBinding[] = [
  ...['KeyN', 'KeyT', 'KeyW'].flatMap(code => [{ code, ctrl: true }, { code, ctrl: true, shift: true }]),
  { key: 'Tab', ctrl: true },
  { key: 'Tab', ctrl: true, shift: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => ({ code: `Digit${digit}`, ctrl: true })),
  ...LETTERS.map(letter => ({ code: `Key${letter}`, alt: true })),
  { key: 'F5' },
  { key: 'F11' },
  { key: 'F12' },
  { key: 'Delete', ctrl: true, shift: true }
];
```

**Step 4: Run it.** Expected: 11 SUCCESS.

**Step 5: Commit**: `feat: Composer key bindings that match modifiers exactly`.

### Task 2.3: What each tool shows, and why a press would be refused

`toolStates(doc, anchor, cursor)` gives every palette tool a `ToolState`: `pressed` - true when every
target already has what the press sets, `'mixed'` when some do, false when none - and `refusal`, the
reason the command would refuse, or null. The design's rule, "the button shows what a press will do
before it is pressed", is only true if the state and the command read the same things, so each reader
asks the refusal its command asks (`noteEffectRefusal`, `durationRefusal`, `editRefusal`,
`respellRefusal`) and reads the targets its command writes (`noteEffectTargets`, `fermataPositionsOf`).

Two readings are not the note's own field:

- **Vibrato on a tied note is read from the note it is tied from** (`tieOriginOf`), because that is
  what alphaTab draws on it - and pressing it there is refused, which the state says too.
- **Natural is never pressed.** It clears a forced accidental, and alphaTab 1.8 draws `ForceNatural` as
  `Default` (the comment on `ALTER_BY_MODE` in the mapper), so there is no forced natural to show.

**Files:**
- Create: `client/src/app/services/composer-tool-states.ts`
- Test: `client/src/app/services/composer-tool-states.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-tool-states.spec.ts -->
```typescript
import { ComposerService } from './composer.service';
import { toolStateOf, toolStates } from './composer-tool-states';
import { EditCursor, NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const at = (barIndex: number, beatIndex: number, trackIndex = 0, stringIndex: number | null = 0): EditCursor =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex });

/** Puts a note on tab string `string` at bar `bar`, beat `beat` of track 0, and returns it. */
function put(doc: ScoreDoc, bar: number, beat: number, string = 1, fret = 3): NoteDoc {
  const target = doc.tracks[0].staves[0].bars[bar].voices[0].beats[beat];
  const note: NoteDoc = { pitch: { kind: 'fretted', string, fret }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };
  target.isRest = false;
  target.notes.push(note);
  return note;
}

describe('toolStates', () => {
  it('shows a note effect as on, mixed or off across a range', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0).effects.isPalmMute = true;
    put(doc, 0, 1);

    expect(toolStateOf(doc, at(0, 0), at(0, 0), 'palmMute').pressed).toBeTrue();
    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'palmMute').pressed).toBe('mixed');
    expect(toolStateOf(doc, null, at(0, 1), 'palmMute').pressed).toBeFalse();
  });

  it('reads a tied note\'s vibrato from the note it is tied from, and says why a press there is refused', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0).effects.vibrato = 'slight';
    put(doc, 0, 1).isTied = true;

    const state = toolStateOf(doc, null, at(0, 1), 'vibrato');

    expect(state.pressed).toBeTrue();
    expect(state.refusal).toMatch(/tied from/i);
  });

  it('explains a hammer-on with nothing to land on before it is pressed', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);

    expect(toolStateOf(doc, null, at(0, 0), 'hammerOn').refusal).toMatch(/land/i);
  });

  it('shows the selection\'s duration and dots, and refuses them on a grace', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats[1].dots = 1;

    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'quarter').pressed).toBeTrue();
    expect(toolStateOf(doc, at(0, 0), at(0, 1), 'dot').pressed).toBe('mixed');

    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].effects.grace = 'beforeBeat';
    expect(toolStateOf(doc, null, at(0, 0), 'quarter').refusal).toMatch(/grace/i);
  });

  it('shows a fermata that is on another track at the position', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].staves[0].bars[0].voices[0].beats[2].effects.fermata = { type: 'medium', length: 1 };

    expect(toolStateOf(doc, null, at(0, 2), 'fermata').pressed).toBe('mixed');
  });

  it('refuses note tools on a generated track, by the same reason the command gives', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);
    doc.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(toolStateOf(doc, null, at(0, 0), 'ghost').refusal).toMatch(/progression/i);
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toMatch(/progression/i);
  });

  it('refuses Fix bar when no selected bar is over, and not when one is', () => {
    const doc = ComposerService.createEmptyScore();
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toMatch(/over/i);

    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].duration = 1;
    expect(toolStateOf(doc, null, at(0, 0), 'fixBar').refusal).toBeNull();
  });

  it('refuses deleting every bar', () => {
    const doc = ComposerService.createEmptyScore();

    expect(toolStateOf(doc, at(0, 0), at(3, 0), 'deleteBar').refusal).toMatch(/at least one bar/i);
    expect(toolStateOf(doc, null, at(3, 0), 'deleteBar').refusal).toBeNull();
  });

  it('never shows Natural pressed, since it only clears', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0);

    expect(toolStateOf(doc, null, at(0, 0), 'natural').pressed).toBeFalse();
  });

  it('answers every tool it knows at once, and idle for one it does not', () => {
    const doc = ComposerService.createEmptyScore();
    const states = toolStates(doc, null, at(0, 0));

    expect(states.get('quarter')?.pressed).toBeTrue();
    expect(toolStateOf(doc, null, at(0, 0), 'no-such-tool')).toEqual({ pressed: false, refusal: null });
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-tool-states.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-tool-states'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-tool-states.ts -->
```typescript
import {
  AccidentalMode,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  EditCursor,
  MasterBarDoc,
  NoteEffectsDoc,
  ScoreDoc
} from '../models/composer.model';
import { barFillAt } from './bar-fill';
import { beatsAt, fermataPositionsOf, toggledValue } from './beat-edits';
import { BeatRef, selectedBars, selectionTargets } from './composer-selection';
import { defaultFermata, fullBendPoints } from './composer-tool-defaults';
import { durationRefusal, editRefusal, noteEffectRefusal } from './edit-refusals';
import { noteEffectTargets, noteTargetsAt } from './note-edits';
import { tieOriginOf } from './note-landing';
import { respellRefusal } from './note-respell';

/**
 * What each palette tool shows before it is pressed: whether its targets already have what a press
 * sets, and why a press would be refused.
 *
 * Pure, and read from the same functions the commands use - the refusals they ask and the targets they
 * write - so a button cannot say one thing and its press do another. The design's rule for a mixed
 * range decides `pressed`: on when every target has the value, so a press turns it off; mixed when some
 * do, so a press turns it on for all.
 */

/** What a palette button shows. */
export interface ToolState {
  /** true: every target has it, and a press clears. 'mixed': some do. false: none do, or nothing is selected. */
  pressed: boolean | 'mixed';
  /** Why a press would be refused, or null. The command still refuses by itself; this only says so first. */
  refusal: string | null;
}

/** The state of a tool with nothing to show. */
export const IDLE_TOOL: ToolState = { pressed: false, refusal: null };

/** Everything a reader needs about the selection, read once. */
interface Reading {
  doc: ScoreDoc;
  cursor: EditCursor;
  refs: BeatRef[];
  focus: number | null;
  bars: { first: number; last: number };
}

type Reader = (reading: Reading) => ToolState;

/** true when every flag is set, 'mixed' when some are, false when none are or there are none. */
function share(flags: readonly boolean[]): boolean | 'mixed' {
  const set = flags.filter(Boolean).length;
  return set === 0 ? false : set === flags.length ? true : 'mixed';
}

/** Whether two values are the same by the toggle rule's comparison, whatever order their keys are in. */
function sameValue<T>(value: T, other: T): boolean {
  const marker = {} as T;
  return toggledValue([value], other, marker) === marker;
}

const beats = (reading: Reading): BeatDoc[] => beatsAt(reading.doc, reading.refs);
const ungraced = (reading: Reading): BeatDoc[] => beats(reading).filter(beat => beat.effects.grace === 'none');
const masterBars = (reading: Reading): MasterBarDoc[] => reading.doc.masterBars.slice(reading.bars.first, reading.bars.last + 1);

function duration(value: DurationValue): Reader {
  return reading => ({
    pressed: share(ungraced(reading).map(beat => beat.duration === value)),
    refusal: durationRefusal(reading.doc, reading.refs)
  });
}

function dots(count: number): Reader {
  return reading => ({
    pressed: share(ungraced(reading).map(beat => beat.dots === count)),
    refusal: durationRefusal(reading.doc, reading.refs)
  });
}

function beatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(key: K, on: BeatEffectsDoc[K]): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => sameValue(beat.effects[key], on))),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key }, null)
  });
}

function grace(kind: Exclude<BeatEffectsDoc['grace'], 'none'>): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => beat.effects.grace === kind)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'grace' }, null)
  });
}

function dynamic(value: DynamicValue): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => beat.dynamics === value)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'dynamics' }, null)
  });
}

/**
 * A note effect tool. Reads the notes the command would set (`noteEffectTargets`) and asks its refusal.
 * Vibrato on a tied note reads the vibrato of the note it is tied from, which is the one alphaTab draws.
 */
function noteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): Reader {
  return reading => {
    const targets = noteEffectTargets(reading.doc, reading.refs, reading.focus, key, on);
    const values = targets.map(({ ref, note }) => {
      const origin = key === 'vibrato' ? tieOriginOf(reading.doc, ref, note) : null;
      return (origin ?? note).effects[key];
    });
    return {
      pressed: share(values.map(value => sameValue(value, on))),
      refusal: noteEffectRefusal(reading.doc, reading.refs, reading.focus, key, on, off)
    };
  };
}

function accidental(mode: Exclude<AccidentalMode, 'auto'>): Reader {
  return reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.accidental === mode)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: mode }, reading.focus)
  });
}

function barFlag(read: (bar: MasterBarDoc) => boolean): Reader {
  return reading => ({ pressed: share(masterBars(reading).map(read)), refusal: null });
}

/** Fix bar's refusal, as `ComposerStructureCommands.fixBar` gives it: a generated track, or nothing over. */
function fixBarRefusal(reading: Reading): string | null {
  const { trackIndex, staffIndex } = reading.cursor;
  const generated = editRefusal(reading.doc, [], { family: 'track', trackIndex }, null);
  if (generated) return generated;
  for (let bar = reading.bars.first; bar <= reading.bars.last; bar++) {
    if (barFillAt(reading.doc, trackIndex, staffIndex, bar)?.kind === 'over') return null;
  }
  return 'No selected bar is over its time signature.';
}

const TRIPLET = { numerator: 3, denominator: 2 };
const FULL_BEND = fullBendPoints();

/**
 * A tool with nothing to show: its popover sets a value rather than toggling one, or it can always be
 * pressed. Listed rather than left out, so every palette button has a reader and the table's spec can say so.
 */
const idle: Reader = () => IDLE_TOOL;

/** One reader per palette tool, by tool id. */
const READERS: Readonly<Record<string, Reader>> = {
  timeSignature: idle,
  keySignature: idle,
  clef: idle,
  insertBar: idle,
  whole: duration(1),
  half: duration(2),
  quarter: duration(4),
  eighth: duration(8),
  sixteenth: duration(16),
  thirtySecond: duration(32),
  sixtyFourth: duration(64),
  dot: dots(1),
  doubleDot: dots(2),
  triplet: reading => ({
    pressed: share(beats(reading).map(beat => beat.tuplet !== null && sameValue(beat.tuplet, TRIPLET))),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'tuplet' }, null)
  }),
  tuplet: reading => ({
    pressed: share(beats(reading).map(beat => beat.tuplet !== null)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'tuplet' }, null)
  }),
  tie: reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.isTied)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'tie' }, reading.focus)
  }),
  rest: reading => ({
    pressed: share(beats(reading).map(beat => beat.isRest)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'duration' }, null)
  }),
  repeatOpen: barFlag(bar => bar.isRepeatStart),
  repeatClose: barFlag(bar => bar.repeatCount > 0),
  alternateEnding: barFlag(bar => bar.alternateEndings > 0),
  section: barFlag(bar => bar.section !== null),
  doubleBar: barFlag(bar => bar.isDoubleBar),
  tripletFeel: barFlag(bar => bar.tripletFeel !== 'none'),
  freeTime: barFlag(bar => bar.isFreeTime),
  fixBar: reading => ({ pressed: false, refusal: fixBarRefusal(reading) }),
  deleteBar: reading => ({
    pressed: false,
    refusal: reading.bars.last - reading.bars.first + 1 >= reading.doc.masterBars.length ? 'A score needs at least one bar.' : null
  }),
  doubleFlat: accidental('doubleFlat'),
  flat: accidental('flat'),
  natural: reading => ({
    pressed: false,
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: 'auto' }, reading.focus)
  }),
  sharp: accidental('sharp'),
  doubleSharp: accidental('doubleSharp'),
  respell: reading => ({ pressed: false, refusal: respellRefusal(reading.doc, reading.refs, reading.focus) }),
  ppp: dynamic('ppp'),
  pp: dynamic('pp'),
  p: dynamic('p'),
  mp: dynamic('mp'),
  mf: dynamic('mf'),
  f: dynamic('f'),
  ff: dynamic('ff'),
  fff: dynamic('fff'),
  crescendo: beatEffect('crescendo', 'crescendo'),
  decrescendo: beatEffect('crescendo', 'decrescendo'),
  accent: noteEffect('accent', 'normal', 'none'),
  heavyAccent: noteEffect('accent', 'heavy', 'none'),
  staccato: noteEffect('isStaccato', true, false),
  tenuto: noteEffect('accent', 'tenuto', 'none'),
  fermata: reading => ({
    pressed: share(fermataPositionsOf(reading.doc, reading.refs).map(beat => beat.effects.fermata !== null && sameValue(beat.effects.fermata, defaultFermata()))),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'fermata' }, null)
  }),
  hammerOn: noteEffect('isHammerPullOrigin', true, false),
  legatoSlide: noteEffect('slide', 'legatoSlide', 'none'),
  shiftSlide: noteEffect('slide', 'shiftSlide', 'none'),
  bend: noteEffect('bendPoints', FULL_BEND, []),
  vibrato: noteEffect('vibrato', 'slight', 'none'),
  wideVibrato: noteEffect('vibrato', 'wide', 'none'),
  palmMute: noteEffect('isPalmMute', true, false),
  letRing: noteEffect('isLetRing', true, false),
  naturalHarmonic: noteEffect('harmonic', 'natural', 'none'),
  artificialHarmonic: noteEffect('harmonic', 'artificial', 'none'),
  ghost: noteEffect('isGhost', true, false),
  dead: noteEffect('isDead', true, false),
  trill: reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.effects.trill !== null)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'trill' }, reading.focus)
  }),
  tap: beatEffect('tap', true),
  leftHandTap: noteEffect('isLeftHandTapped', true, false),
  slap: beatEffect('slap', true),
  pop: beatEffect('pop', true),
  graceBefore: grace('beforeBeat'),
  graceOnBeat: grace('onBeat'),
  pickDown: beatEffect('pickStroke', 'down'),
  pickUp: beatEffect('pickStroke', 'up'),
  fadeIn: beatEffect('fadeIn', true)
};

/** The ids of every tool `toolStates` has something to say about. */
export const TOOLS_WITH_STATE: readonly string[] = Object.keys(READERS);

function readingOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): Reading {
  return {
    doc,
    cursor,
    refs: selectionTargets(doc, anchor, cursor),
    // The same focus the service's edits use: the caret's string, only when there is no range.
    focus: anchor ? null : cursor.stringIndex,
    bars: selectedBars(anchor, cursor)
  };
}

/** Every palette tool's state for the selection from `anchor` to `cursor`. */
export function toolStates(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): ReadonlyMap<string, ToolState> {
  const reading = readingOf(doc, anchor, cursor);
  return new Map(Object.entries(READERS).map(([id, read]) => [id, read(reading)]));
}

/** One tool's state, or `IDLE_TOOL` for a tool with nothing to show. For a command deciding a toggle. */
export function toolStateOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor, toolId: string): ToolState {
  const read = READERS[toolId];
  return read ? read(readingOf(doc, anchor, cursor)) : IDLE_TOOL;
}
```

**Step 4: Run it.** Expected: 10 SUCCESS.

**Step 5: Commit**: `feat: What each composer tool shows, and why a press would be refused`.

### Task 2.4: The tool table

`COMPOSER_TOOLS` declares every tool once. Its keys are the design's shortcut table, with these
settled here:

- **`+` and `=` mean longer, `-` shorter** (decision 4), today's direction. The design table said
  `+ or =` / `-` for "shorter / longer", which is the other way round; the design doc is corrected in
  the same commit as this plan.
- **R and Shift+R both rest**, so neither Caps Lock nor Shift turns the key into nothing.
- **macOS alternates** (decision 21). Mac keyboards have no Insert key, so the four Insert bindings
  each get the Enter key with the same modifiers - Shift+Enter for section, Ctrl+Enter for insert bar,
  Ctrl+Shift+Enter for add track - and insert beat, whose Insert is unmodified, gets Alt+Enter (Option+
  Return). Enter is in no binding of the design's table, and the browser's only use of it on a page is
  activating the focused control - which is why plain Enter is not taken: a keyboard user pressing a
  palette button with Enter must still press the button. Play from start gets Shift+Space beside
  Ctrl+Space, since Cmd+Space is Spotlight and Ctrl+Space switches input source on macOS. Nobody has
  checked any of these on a Mac.
- **Keyless tools.** The design gives the seven note values and the Select and Pen buttons no key of
  their own: `+`/`-` step through the values, and Q toggles Select and Pen. `KEYLESS_TOOLS` names
  them, so a new tool without a key fails the table's spec until it is added there on purpose.
- **Natural** is labelled "Natural (clears a forced accidental)", because alphaTab 1.8 draws
  `ForceNatural` as `Default` - the press can only return a note to `auto`.
- **Triplet feel** opens a popover like the other valued bar tools: it has seven values, and the
  design table writes it with an ellipsis.

Glyphs are Bravura's SMuFL code points where SMuFL has the symbol, and short text where it has none (a
hammer-on, a slide, palm mute). All 45 code points used here are glyphs in the installed
`Bravura.woff2`'s twin, `Bravura.svg`, and 33 of them are also named in alphaTab's own `MusicFontSymbol`
enum; the other 12 - the whole, half, 16th, 32nd and 64th notes, both repeat signs, the double barline,
the diminuendo hairpin, the harmonic and both grace notes - sit where SMuFL's ranges put them, between
neighbours the enum confirms. Whole to
64th notes `U+E1D2` `U+E1D3` `U+E1D5` `U+E1D7` `U+E1D9` `U+E1DB` `U+E1DD`, augmentation dot `U+E1E7`,
quarter rest `U+E4E5`, accidentals `U+E260`-`U+E264`, dynamics `U+E52A` `U+E52B` `U+E520` `U+E52C`
`U+E52D` `U+E522` `U+E52F` `U+E530`, hairpins `U+E53E` `U+E53F`, accent `U+E4A0`, marcato `U+E4AC`,
staccato `U+E4A2`, tenuto `U+E4A4`, fermata `U+E4C0`, G clef `U+E050`, common time `U+E08A`, repeats
`U+E040` `U+E041`, double barline `U+E031`, segno `U+E047`, tuplet 3 `U+E883`, trill `U+E566`,
harmonic `U+E614`, down and up bow (pick strokes) `U+E610` `U+E612`, grace notes `U+E560` `U+E562`,
X notehead (dead) `U+E0A9`, vibrato `U+EAB2` `U+EAB3`.

The service gains `get state()`, a synchronous read of the current state, which commands deciding a
toggle need.

**Files:**
- Create: `client/src/app/services/composer-tools.ts`
- Modify: `client/src/app/services/composer.service.ts`
- Test: `client/src/app/services/composer-tools.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-tools.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { BROWSER_RESERVED, KeyPress, bindingSignatureOf } from './composer-key-bindings';
import { TOOLS_WITH_STATE } from './composer-tool-states';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, KEYLESS_TOOLS, PALETTE_GROUPS, toolForPress } from './composer-tools';

const press = (init: Partial<KeyPress>): KeyPress => ({
  key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init
});
const tool = (id: string): ComposerTool => {
  const found = COMPOSER_TOOLS.find(entry => entry.id === id);
  if (!found) throw new Error(`no tool ${id}`);
  return found;
};

/**
 * The design's tool-table spec: every tool has a command, a glyph or text, a label and a group, and a
 * shortcut no other tool uses - macOS alternates included - that the browser does not keep.
 */
describe('COMPOSER_TOOLS', () => {
  it('names every tool once', () => {
    const ids = COMPOSER_TOOLS.map(entry => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every tool a label, a group, a glyph or text, and a command', () => {
    for (const entry of COMPOSER_TOOLS) {
      expect(entry.label.trim()).withContext(entry.id).not.toBe('');
      expect(entry.group).withContext(entry.id).toBeTruthy();
      const glyph = entry.glyph;
      expect(glyph.kind === 'smufl' ? glyph.codePoint >= 0xe000 && glyph.codePoint <= 0xf8ff : glyph.text.trim() !== '')
        .withContext(entry.id).toBeTrue();
      expect(typeof entry.run).withContext(entry.id).toBe('function');
    }
  });

  it('uses no binding twice, macOS alternates included', () => {
    const seen = new Map<string, string>();
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        const signature = bindingSignatureOf(binding);
        expect(seen.get(signature)).withContext(`${entry.id} and ${seen.get(signature)} both use ${signature}`).toBeUndefined();
        seen.set(signature, entry.id);
      }
    }
  });

  it('binds nothing the browser keeps', () => {
    const reserved = new Set(BROWSER_RESERVED.map(bindingSignatureOf));
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        expect(reserved.has(bindingSignatureOf(binding))).withContext(`${entry.id}: ${bindingSignatureOf(binding)}`).toBeFalse();
      }
    }
  });

  it('writes Ctrl and Alt combinations by physical key, and nothing else that way', () => {
    const named = /^(Arrow|Home|End|Insert|Delete|Backspace|Enter|Escape|F[0-9]| $)/;
    for (const entry of COMPOSER_TOOLS) {
      for (const binding of entry.keys) {
        const held = !!binding.ctrl || !!binding.alt;
        if (binding.code !== undefined) expect(held).withContext(entry.id).toBeTrue();
        else if (held) expect(named.test(binding.key ?? '')).withContext(`${entry.id}: ${binding.key}`).toBeTrue();
      }
    }
  });

  it('gives every tool a key except those the design gives none', () => {
    const keyless = COMPOSER_TOOLS.filter(entry => entry.keys.length === 0).map(entry => entry.id);

    expect(keyless.sort()).toEqual([...KEYLESS_TOOLS].sort());
  });

  it('gives every palette button but Select and Pen a state, and puts it in a palette group', () => {
    for (const entry of COMPOSER_TOOLS.filter(candidate => candidate.inPalette)) {
      expect(PALETTE_GROUPS).withContext(entry.id).toContain(entry.group);
      if (entry.id !== 'select' && entry.id !== 'pen') expect(TOOLS_WITH_STATE).withContext(entry.id).toContain(entry.id);
    }
  });

  it('offers the macOS alternates', () => {
    const labels = (id: string): number => tool(id).keys.length;

    for (const id of ['insertBeat', 'section', 'insertBar', 'addTrack', 'playFromStart']) {
      expect(labels(id)).withContext(id).toBe(2);
    }
  });
});

describe('toolForPress', () => {
  const id = (init: Partial<KeyPress>): string | null => toolForPress(press(init))?.id ?? null;

  it('finds the tool a press means, by the design\'s table', () => {
    expect(id({ key: 'r', code: 'KeyR' })).toBe('rest');
    expect(id({ key: 'R', code: 'KeyR', shiftKey: true })).toBe('rest');
    expect(id({ key: '+', code: 'Equal', shiftKey: true })).toBe('longer');
    expect(id({ key: '=', code: 'Equal' })).toBe('longer');
    expect(id({ key: '-', code: 'Minus' })).toBe('shorter');
    expect(id({ key: 'ArrowRight', ctrlKey: true })).toBe('nextBar');
    expect(id({ key: 'ArrowRight', shiftKey: true })).toBe('extendRight');
    expect(id({ key: 'Enter', altKey: true })).toBe('insertBeat');
    expect(id({ key: ' ', shiftKey: true })).toBe('playFromStart');
    expect(id({ key: '7', code: 'Digit7' })).toBe('fret');
  });

  it('prefers an exact binding to a symbol typed through Alt', () => {
    expect(id({ key: '/', code: 'Slash', altKey: true })).toBe('tuplet');
    expect(id({ key: '}', code: 'Digit0', ctrlKey: true, altKey: true })).toBe('alternateEnding');
  });

  it('finds nothing for a press the browser or the table does not give the composer', () => {
    expect(id({ key: '1', code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(id({ key: '1', code: 'Digit1', altKey: true })).toBeNull();
    expect(id({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe('COMPOSER_TOOLS commands', () => {
  let composer: ComposerService;
  let host: jasmine.SpyObj<Omit<ComposerToolHost, 'composer'>> & { composer: ComposerService };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    host = {
      composer,
      ...jasmine.createSpyObj('host', ['openPopover', 'toggleShortcutSheet', 'escape', 'playPause', 'playFromStart', 'requestSave', 'addTrack', 'typeFretDigit'])
    };
  });

  const run = (id: string, key = ''): void => tool(id).run(host, press({ key }));
  const firstBeat = () => composer.doc.tracks[0].staves[0].bars[0].voices[0].beats[0];

  it('makes the selection longer with + and shorter with -', () => {
    run('shorter');
    expect(firstBeat().duration).toBe(8);

    composer.setCursor({ beatIndex: 0 });
    run('longer');
    run('longer');
    expect(firstBeat().duration).toBe(2);
  });

  it('dots the selection, and takes the dot off when every beat has one', () => {
    run('dot');
    expect(firstBeat().dots).toBe(1);

    run('dot');
    expect(firstBeat().dots).toBe(0);
  });

  it('forces a flat, and a second press returns the note to auto', () => {
    // String 3 (G, 55) at fret 3 is B flat.
    composer.setCursor({ stringIndex: 2 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 3, fret: 3 }, false);

    run('flat');
    expect(firstBeat().notes[0].accidental).toBe('flat');

    run('flat');
    expect(firstBeat().notes[0].accidental).toBe('auto');
  });

  it('toggles Select and Pen with Q', () => {
    run('toggleEntryMode');
    expect(composer.state.entryMode).toBe('pen');

    run('toggleEntryMode');
    expect(composer.state.entryMode).toBe('select');
  });

  it('rests a range without moving on, and the caret\'s beat with the input duration otherwise', () => {
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });
    run('rest');
    expect(composer.state.cursor.beatIndex).toBe(1);

    composer.setCursor({ beatIndex: 0 });
    run('rest');
    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('hands a digit to the fret entry, and a popover tool to the page', () => {
    run('fret', '7');
    expect(host.typeFretDigit).toHaveBeenCalledWith(7);

    run('timeSignature');
    expect(host.openPopover).toHaveBeenCalledWith('timeSignature');
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-tools.spec.ts`. Expected: a compile error,
`TS2307: Cannot find module './composer-tools'`.

**Step 3: Implement.** In `composer.service.ts`, the synchronous read:

<!-- apply: find client/src/app/services/composer.service.ts -->
```typescript
  get doc(): ScoreDoc {
    return this.stateSubject.getValue().doc;
  }
```

<!-- apply: replace client/src/app/services/composer.service.ts -->
```typescript
  get doc(): ScoreDoc {
    return this.stateSubject.getValue().doc;
  }

  /** The current state, for a command that decides what to do from it - a toggle, a caret step. */
  get state(): ComposerState {
    return this.stateSubject.getValue();
  }
```

The table:

<!-- apply: create client/src/app/services/composer-tools.ts -->
```typescript
import type { ComposerService } from './composer.service';
import { DurationValue, DynamicValue, EntryMode } from '../models/composer.model';
import { KeyBinding, KeyPress, bindingMatches, bindingMatchesTyped } from './composer-key-bindings';
import { toolStateOf } from './composer-tool-states';
import { fullBendPoints } from './composer-tool-defaults';

/**
 * Every tool the composer has, declared once: its label, group, glyph, keys and command.
 *
 * The palette draws its buttons from this table, their tooltips name the keys from it, the `?` sheet
 * lists it, and the keyboard handler looks a press up in it - so a key cannot drift from its button.
 * The keys are the design's shortcut table (design doc, "Shortcuts"), with the M2 plan's corrections:
 * `+` is longer, the macOS alternates, and Shift+R beside R.
 */

/** Where a tool sits: its palette group, or the shortcut sheet's section for a tool with no button. */
export type ToolGroup =
  | 'Tools'
  | 'Edit'
  | 'Navigation'
  | 'Playback'
  | 'Beats'
  | 'Duration'
  | 'Bar'
  | 'Tracks'
  | 'Accidentals'
  | 'Dynamics'
  | 'Articulation'
  | 'Techniques';

/** The palette's groups, in the design's order. */
export const PALETTE_GROUPS: readonly ToolGroup[] = ['Tools', 'Duration', 'Bar', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'];

/** A button face: a Bravura glyph by SMuFL code point, or short text where SMuFL has no symbol. */
export type ToolGlyph = { kind: 'smufl'; codePoint: number } | { kind: 'text'; text: string };

/** The tools that take a value, each opening a small popover anchored to its button. */
export type PopoverKind = 'timeSignature' | 'keySignature' | 'clef' | 'section' | 'alternateEnding' | 'tuplet' | 'tripletFeel';

/** What a command reaches beyond the service: the page's own controls. */
export interface ComposerToolHost {
  readonly composer: ComposerService;
  /** Opens the popover for a valued tool, anchored to that tool's palette button. */
  openPopover(kind: PopoverKind): void;
  toggleShortcutSheet(): void;
  /** Back to Select and no range; closes the sheet and any popover. */
  escape(): void;
  playPause(): void;
  playFromStart(): void;
  /** Asks the library to save, as its own Save button does. */
  requestSave(): void;
  /** Adds a track of the instrument the track strip has chosen. */
  addTrack(): void;
  /** A fret digit, which may be the second digit of a two-digit fret. See `FretDigitEntry`. */
  typeFretDigit(digit: number): void;
}

export interface ComposerTool {
  id: string;
  /** The button's accessible name, and the start of its tooltip. */
  label: string;
  group: ToolGroup;
  glyph: ToolGlyph;
  /** Every press that runs it. Empty only for the tools `KEYLESS_TOOLS` names. */
  keys: readonly KeyBinding[];
  /** Whether the palette draws a button for it. */
  inPalette: boolean;
  /** Runs the command. `press` is the key that ran it, or null for a click. */
  run(host: ComposerToolHost, press: KeyPress | null): void;
}

/** The tools the design's shortcut table gives no key: the note values, which `+` and `-` step, and Select and Pen, which Q toggles. */
export const KEYLESS_TOOLS: readonly string[] = ['select', 'pen', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtySecond', 'sixtyFourth'];

/** The note values, longest first, as `+` and `-` step through them. */
export const DURATION_ORDER: readonly DurationValue[] = [1, 2, 4, 8, 16, 32, 64];

const key = (value: string, modifiers: Omit<KeyBinding, 'key' | 'code'> = {}): KeyBinding => ({ key: value, ...modifiers });
const code = (value: string, modifiers: Omit<KeyBinding, 'key' | 'code'>): KeyBinding => ({ code: value, ...modifiers });
const smufl = (codePoint: number): ToolGlyph => ({ kind: 'smufl', codePoint });
const text = (value: string): ToolGlyph => ({ kind: 'text', text: value });

/** Whether the tool `id`'s press would clear what every target has. */
function pressedNow(host: ComposerToolHost, id: string): boolean {
  const { doc, anchor, cursor } = host.composer.state;
  return toolStateOf(doc, anchor, cursor, id).pressed === true;
}

/** The value `steps` along `DURATION_ORDER` from the input duration: -1 longer, +1 shorter. */
function steppedDuration(host: ComposerToolHost, steps: -1 | 1): void {
  const state = host.composer.state;
  const index = DURATION_ORDER.indexOf(state.inputDuration);
  const next = DURATION_ORDER[Math.max(0, Math.min(DURATION_ORDER.length - 1, (index < 0 ? 2 : index) + steps))];
  host.composer.applyDurationAtCursor(next, state.inputDots);
}

function durationTool(id: string, label: string, value: DurationValue, codePoint: number): ComposerTool {
  return {
    id, label, group: 'Duration', glyph: smufl(codePoint), keys: [], inPalette: true,
    run: host => host.composer.applyDurationAtCursor(value, 0)
  };
}

function dotTool(id: string, label: string, count: number, keys: KeyBinding[], glyph: ToolGlyph): ComposerTool {
  return {
    id, label, group: 'Duration', glyph, keys, inPalette: true,
    run: host => host.composer.applyDurationAtCursor(host.composer.state.inputDuration, pressedNow(host, id) ? 0 : count)
  };
}

function dynamicTool(value: DynamicValue, digit: number, codePoint: number): ComposerTool {
  return {
    id: value, label: `Dynamic ${value}`, group: 'Dynamics', glyph: smufl(codePoint),
    keys: [code(`Digit${digit}`, { ctrl: true, shift: true })], inPalette: true,
    run: host => host.composer.setDynamics(pressedNow(host, value) ? null : value)
  };
}

function accidentalTool(id: 'doubleFlat' | 'flat' | 'sharp' | 'doubleSharp', label: string, keys: KeyBinding[], codePoint: number): ComposerTool {
  return {
    id, label, group: 'Accidentals', glyph: smufl(codePoint), keys, inPalette: true,
    run: host => host.composer.setAccidental(pressedNow(host, id) ? 'auto' : id)
  };
}

function popoverTool(id: PopoverKind, label: string, group: ToolGroup, glyph: ToolGlyph, keys: KeyBinding[]): ComposerTool {
  return { id, label, group, glyph, keys, inPalette: true, run: host => host.openPopover(id) };
}

function modeTool(id: EntryMode, label: string, glyph: ToolGlyph): ComposerTool {
  return { id, label, group: 'Tools', glyph, keys: [], inPalette: true, run: host => host.composer.setEntryMode(id) };
}

/** A tool with no button, for the keyboard and the shortcut sheet. */
function keyTool(id: string, label: string, group: ToolGroup, keys: KeyBinding[], run: ComposerTool['run']): ComposerTool {
  return { id, label, group, glyph: text(label), keys, inPalette: false, run };
}

/** A palette tool that runs a service command. */
function button(id: string, label: string, group: ToolGroup, glyph: ToolGlyph, keys: KeyBinding[], run: (composer: ComposerService) => void): ComposerTool {
  return { id, label, group, glyph, keys, inPalette: true, run: host => run(host.composer) };
}

export const COMPOSER_TOOLS: readonly ComposerTool[] = [
  // Tools
  modeTool('select', 'Select: a click on notation moves the caret', text('Select')),
  modeTool('pen', 'Pen: a click on notation writes that pitch', text('Pen')),
  keyTool('toggleEntryMode', 'Toggle Select / Pen', 'Tools', [key('q')], host =>
    host.composer.setEntryMode(host.composer.state.entryMode === 'select' ? 'pen' : 'select')
  ),
  keyTool('escape', 'Back to Select, clear the range', 'Tools', [key('Escape')], host => host.escape()),
  keyTool('shortcutSheet', 'Shortcut sheet', 'Tools', [key('?')], host => host.toggleShortcutSheet()),

  // Edit
  keyTool('undo', 'Undo', 'Edit', [code('KeyZ', { ctrl: true })], host => host.composer.undo()),
  keyTool('redo', 'Redo', 'Edit', [code('KeyZ', { ctrl: true, shift: true }), code('KeyY', { ctrl: true })], host => host.composer.redo()),
  keyTool('cut', 'Cut', 'Edit', [code('KeyX', { ctrl: true })], host => host.composer.cut()),
  keyTool('copy', 'Copy', 'Edit', [code('KeyC', { ctrl: true })], host => host.composer.copy()),
  keyTool('paste', 'Paste', 'Edit', [code('KeyV', { ctrl: true })], host => host.composer.paste()),
  keyTool('selectAll', 'Select all in track', 'Edit', [code('KeyA', { ctrl: true })], host => host.composer.selectAllInTrack()),
  keyTool('save', 'Save', 'Edit', [code('KeyS', { ctrl: true })], host => host.requestSave()),

  // Navigation
  keyTool('previousBeat', 'Previous beat', 'Navigation', [key('ArrowLeft')], host => host.composer.moveCursor({ kind: 'beat', delta: -1 })),
  keyTool('nextBeat', 'Next beat', 'Navigation', [key('ArrowRight')], host => host.composer.moveCursor({ kind: 'beat', delta: 1 })),
  keyTool('previousString', 'Previous string', 'Navigation', [key('ArrowUp')], host => host.composer.moveCursor({ kind: 'string', delta: -1 })),
  keyTool('nextString', 'Next string', 'Navigation', [key('ArrowDown')], host => host.composer.moveCursor({ kind: 'string', delta: 1 })),
  keyTool('extendLeft', 'Extend the selection a beat left', 'Navigation', [key('ArrowLeft', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'beat', delta: -1 }, true)
  ),
  keyTool('extendRight', 'Extend the selection a beat right', 'Navigation', [key('ArrowRight', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'beat', delta: 1 }, true)
  ),
  keyTool('extendUp', 'Extend the selection to the track above', 'Navigation', [key('ArrowUp', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: -1 }, true)
  ),
  keyTool('extendDown', 'Extend the selection to the track below', 'Navigation', [key('ArrowDown', { shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: 1 }, true)
  ),
  keyTool('barStart', 'First beat of the bar', 'Navigation', [key('Home')], host => host.composer.moveCursor({ kind: 'barEdge', edge: 'first' })),
  keyTool('barEnd', 'Last beat of the bar', 'Navigation', [key('End')], host => host.composer.moveCursor({ kind: 'barEdge', edge: 'last' })),
  keyTool('previousBar', 'Previous bar', 'Navigation', [key('ArrowLeft', { ctrl: true })], host => host.composer.moveCursor({ kind: 'bar', delta: -1 })),
  keyTool('nextBar', 'Next bar', 'Navigation', [key('ArrowRight', { ctrl: true })], host => host.composer.moveCursor({ kind: 'bar', delta: 1 })),
  keyTool('firstBar', 'First bar', 'Navigation', [key('Home', { ctrl: true })], host => host.composer.moveCursor({ kind: 'scoreEdge', edge: 'first' })),
  keyTool('lastBar', 'Last bar', 'Navigation', [key('End', { ctrl: true })], host => host.composer.moveCursor({ kind: 'scoreEdge', edge: 'last' })),
  keyTool('previousTrack', 'Previous track', 'Navigation', [key('ArrowUp', { ctrl: true, shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: -1 })
  ),
  keyTool('nextTrack', 'Next track', 'Navigation', [key('ArrowDown', { ctrl: true, shift: true })], host =>
    host.composer.moveCursor({ kind: 'track', delta: 1 })
  ),

  // Playback
  keyTool('playPause', 'Play / pause', 'Playback', [key(' ')], host => host.playPause()),
  keyTool('playFromStart', 'Play from the start', 'Playback', [key(' ', { ctrl: true }), key(' ', { shift: true })], host => host.playFromStart()),

  // Beats
  keyTool('fret', 'Fret', 'Beats', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => key(digit)), (host, press) =>
    host.typeFretDigit(Number(press?.key ?? 0))
  ),
  keyTool('clearBeat', 'Clear beat to rest', 'Beats', [key('Delete'), key('Backspace')], host =>
    host.composer.state.anchor ? host.composer.clearSelectionToRests() : host.composer.deleteAtCursor()
  ),
  keyTool('insertBeat', 'Insert beat', 'Beats', [key('Insert'), key('Enter', { alt: true })], host => host.composer.insertBeat()),
  keyTool('deleteBeats', 'Delete beats', 'Beats', [key('Delete', { shift: true })], host => host.composer.deleteBeats()),

  // Duration
  durationTool('whole', 'Whole note', 1, 0xe1d2),
  durationTool('half', 'Half note', 2, 0xe1d3),
  durationTool('quarter', 'Quarter note', 4, 0xe1d5),
  durationTool('eighth', 'Eighth note', 8, 0xe1d7),
  durationTool('sixteenth', 'Sixteenth note', 16, 0xe1d9),
  durationTool('thirtySecond', 'Thirty-second note', 32, 0xe1db),
  durationTool('sixtyFourth', 'Sixty-fourth note', 64, 0xe1dd),
  keyTool('longer', 'Longer', 'Duration', [key('+'), key('=')], host => steppedDuration(host, -1)),
  keyTool('shorter', 'Shorter', 'Duration', [key('-')], host => steppedDuration(host, 1)),
  dotTool('dot', 'Dot', 1, [key('.')], smufl(0xe1e7)),
  dotTool('doubleDot', 'Double dot', 2, [code('Period', { alt: true })], text('..')),
  button('triplet', 'Triplet', 'Duration', smufl(0xe883), [key('/')], composer =>
    composer.setTuplet(pressedNowOf(composer, 'triplet') ? null : { numerator: 3, denominator: 2 })
  ),
  popoverTool('tuplet', 'Tuplet…', 'Duration', text('n:m'), [code('Slash', { alt: true })]),
  button('tie', 'Tie', 'Duration', text('‿'), [key('l')], composer => composer.toggleTie()),
  {
    id: 'rest', label: 'Rest', group: 'Duration', glyph: smufl(0xe4e5), keys: [key('r'), key('r', { shift: true })], inPalette: true,
    run: host => (host.composer.state.anchor ? host.composer.clearSelectionToRests() : host.composer.setRestAtCursor())
  },

  // Bar
  popoverTool('timeSignature', 'Time signature…', 'Bar', smufl(0xe08a), [key('t', { shift: true })]),
  popoverTool('keySignature', 'Key signature…', 'Bar', smufl(0xe262), [code('KeyK', { ctrl: true })]),
  popoverTool('clef', 'Clef…', 'Bar', smufl(0xe050), [key('k')]),
  button('repeatOpen', 'Repeat open', 'Bar', smufl(0xe040), [key('[')], composer => composer.toggleMasterBarFlag('isRepeatStart')),
  button('repeatClose', 'Repeat close', 'Bar', smufl(0xe041), [key(']')], composer => composer.toggleRepeatClose()),
  popoverTool('alternateEnding', 'Alternate ending…', 'Bar', text('1.'), [key('}')]),
  popoverTool('section', 'Section…', 'Bar', smufl(0xe047), [key('Insert', { shift: true }), key('Enter', { shift: true })]),
  button('doubleBar', 'Double bar', 'Bar', smufl(0xe031), [key('b', { shift: true })], composer => composer.toggleMasterBarFlag('isDoubleBar')),
  popoverTool('tripletFeel', 'Triplet feel…', 'Bar', text('3♪'), [code('Slash', { ctrl: true })]),
  button('freeTime', 'Free time', 'Bar', text('free'), [key('|')], composer => composer.toggleMasterBarFlag('isFreeTime')),
  button('fixBar', 'Fix bar', 'Bar', text('Fix'), [key('F4')], composer => composer.fixBar()),
  button('insertBar', 'Insert bar', 'Bar', text('+bar'), [key('Insert', { ctrl: true }), key('Enter', { ctrl: true })], composer =>
    composer.insertBarsBeforeSelection()
  ),
  button('deleteBar', 'Delete bar', 'Bar', text('−bar'), [key('Delete', { ctrl: true })], composer => composer.deleteSelectedBars()),

  // Tracks
  keyTool('addTrack', 'Add track', 'Tracks', [key('Insert', { ctrl: true, shift: true }), key('Enter', { ctrl: true, shift: true })], host => host.addTrack()),
  keyTool('deleteTrack', 'Delete track', 'Tracks', [key('Backspace', { ctrl: true, shift: true })], host =>
    host.composer.removeTrack(host.composer.state.cursor.trackIndex)
  ),

  // Accidentals
  accidentalTool('doubleFlat', 'Double flat', [code('Minus', { alt: true, shift: true })], 0xe264),
  accidentalTool('flat', 'Flat', [code('Minus', { alt: true })], 0xe260),
  button('natural', 'Natural (clears a forced accidental)', 'Accidentals', smufl(0xe261), [code('Digit0', { alt: true })], composer =>
    composer.setAccidental('auto')
  ),
  accidentalTool('sharp', 'Sharp', [code('Equal', { alt: true })], 0xe262),
  accidentalTool('doubleSharp', 'Double sharp', [code('Equal', { alt: true, shift: true })], 0xe263),
  button('respell', 'Respell', 'Accidentals', text('E♯/F'), [key('e')], composer => composer.respell()),
  keyTool('semitoneDown', 'Semitone down', 'Accidentals', [key('ArrowDown', { alt: true })], host => host.composer.shiftSemitone(-1)),
  keyTool('semitoneUp', 'Semitone up', 'Accidentals', [key('ArrowUp', { alt: true })], host => host.composer.shiftSemitone(1)),
  keyTool('stringBelow', 'Note to the string below', 'Accidentals', [key('ArrowDown', { ctrl: true, alt: true })], host =>
    host.composer.moveNotesToString(1)
  ),
  keyTool('stringAbove', 'Note to the string above', 'Accidentals', [key('ArrowUp', { ctrl: true, alt: true })], host =>
    host.composer.moveNotesToString(-1)
  ),

  // Dynamics
  dynamicTool('ppp', 1, 0xe52a),
  dynamicTool('pp', 2, 0xe52b),
  dynamicTool('p', 3, 0xe520),
  dynamicTool('mp', 4, 0xe52c),
  dynamicTool('mf', 5, 0xe52d),
  dynamicTool('f', 6, 0xe522),
  dynamicTool('ff', 7, 0xe52f),
  dynamicTool('fff', 8, 0xe530),
  button('crescendo', 'Crescendo', 'Dynamics', smufl(0xe53e), [code('Comma', { ctrl: true, shift: true })], composer =>
    composer.toggleBeatEffect('crescendo', 'crescendo', 'none')
  ),
  button('decrescendo', 'Diminuendo', 'Dynamics', smufl(0xe53f), [code('Period', { ctrl: true, shift: true })], composer =>
    composer.toggleBeatEffect('crescendo', 'decrescendo', 'none')
  ),

  // Articulation
  button('accent', 'Accent', 'Articulation', smufl(0xe4a0), [key(';')], composer => composer.toggleNoteEffect('accent', 'normal', 'none')),
  button('heavyAccent', 'Heavy accent', 'Articulation', smufl(0xe4ac), [key(':')], composer => composer.toggleNoteEffect('accent', 'heavy', 'none')),
  button('staccato', 'Staccato', 'Articulation', smufl(0xe4a2), [key('!')], composer => composer.toggleNoteEffect('isStaccato', true, false)),
  button('tenuto', 'Tenuto', 'Articulation', smufl(0xe4a4), [key('_')], composer => composer.toggleNoteEffect('accent', 'tenuto', 'none')),
  button('fermata', 'Fermata', 'Articulation', smufl(0xe4c0), [key('f')], composer => composer.toggleFermata()),

  // Techniques
  button('hammerOn', 'Hammer-on / pull-off', 'Techniques', text('H'), [key('h')], composer => composer.toggleNoteEffect('isHammerPullOrigin', true, false)),
  button('legatoSlide', 'Legato slide', 'Techniques', text('sl.'), [key('s')], composer => composer.toggleNoteEffect('slide', 'legatoSlide', 'none')),
  button('shiftSlide', 'Shift slide', 'Techniques', text('sh.'), [key('s', { shift: true })], composer => composer.toggleNoteEffect('slide', 'shiftSlide', 'none')),
  button('bend', 'Bend (full)', 'Techniques', text('⤴'), [key('b')], composer => composer.toggleNoteEffect('bendPoints', fullBendPoints(), [])),
  button('vibrato', 'Vibrato', 'Techniques', smufl(0xeab2), [key('v')], composer => composer.toggleNoteEffect('vibrato', 'slight', 'none')),
  button('wideVibrato', 'Wide vibrato', 'Techniques', smufl(0xeab3), [key('v', { shift: true })], composer => composer.toggleNoteEffect('vibrato', 'wide', 'none')),
  button('palmMute', 'Palm mute', 'Techniques', text('P.M.'), [key('p')], composer => composer.toggleNoteEffect('isPalmMute', true, false)),
  button('letRing', 'Let ring', 'Techniques', text('let r.'), [key('i')], composer => composer.toggleNoteEffect('isLetRing', true, false)),
  button('naturalHarmonic', 'Natural harmonic', 'Techniques', smufl(0xe614), [key('y')], composer => composer.toggleNoteEffect('harmonic', 'natural', 'none')),
  button('artificialHarmonic', 'Artificial harmonic', 'Techniques', text('A.H.'), [key('y', { shift: true })], composer =>
    composer.toggleNoteEffect('harmonic', 'artificial', 'none')
  ),
  button('ghost', 'Ghost note', 'Techniques', text('( )'), [key('o')], composer => composer.toggleNoteEffect('isGhost', true, false)),
  button('dead', 'Dead note', 'Techniques', smufl(0xe0a9), [key('x')], composer => composer.toggleNoteEffect('isDead', true, false)),
  button('trill', 'Trill (whole step)', 'Techniques', smufl(0xe566), [key('n')], composer => composer.toggleTrill()),
  button('tap', 'Tap', 'Techniques', text('T'), [key(')')], composer => composer.toggleBeatEffect('tap', true, false)),
  button('leftHandTap', 'Left-hand tap', 'Techniques', text('LHT'), [key('(')], composer => composer.toggleNoteEffect('isLeftHandTapped', true, false)),
  button('slap', 'Slap', 'Techniques', text('S'), [key('$')], composer => composer.toggleBeatEffect('slap', true, false)),
  button('pop', 'Pop', 'Techniques', text('Pop'), [key('%')], composer => composer.toggleBeatEffect('pop', true, false)),
  button('graceBefore', 'Grace note before the beat', 'Techniques', smufl(0xe560), [key('g')], composer => composer.toggleGrace('beforeBeat')),
  button('graceOnBeat', 'Grace note on the beat', 'Techniques', smufl(0xe562), [key('g', { shift: true })], composer => composer.toggleGrace('onBeat')),
  button('pickDown', 'Pick stroke down', 'Techniques', smufl(0xe610), [key('d', { shift: true })], composer =>
    composer.toggleBeatEffect('pickStroke', 'down', 'none')
  ),
  button('pickUp', 'Pick stroke up', 'Techniques', smufl(0xe612), [key('u', { shift: true })], composer =>
    composer.toggleBeatEffect('pickStroke', 'up', 'none')
  ),
  button('fadeIn', 'Fade in', 'Techniques', text('<'), [key('<')], composer => composer.toggleBeatEffect('fadeIn', true, false))
];

/** `pressedNow` for a command that has only the service. */
function pressedNowOf(composer: ComposerService, id: string): boolean {
  const { doc, anchor, cursor } = composer.state;
  return toolStateOf(doc, anchor, cursor, id).pressed === true;
}

/**
 * The tool `press` runs, or null. Exact bindings first, over the whole table; only then a symbol typed
 * through AltGr or Option (`bindingMatchesTyped`), so an exact Alt binding always wins.
 */
export function toolForPress(press: KeyPress, tools: readonly ComposerTool[] = COMPOSER_TOOLS): ComposerTool | null {
  return (
    tools.find(tool => tool.keys.some(binding => bindingMatches(binding, press))) ??
    tools.find(tool => tool.keys.some(binding => bindingMatchesTyped(binding, press))) ??
    null
  );
}
```

**Step 4: Run it.** Expected: all SUCCESS.

**Step 5: Commit**: `feat: The composer tool table - every tool, its glyph, its keys and its command`.

### Task 2.5: Fret digits, two making one fret

Today's digit accumulator lives in `ComposerComponent`, and rewrites the first note by moving the caret
back, writing, and moving it forward - two commits. It moves to its own class, and the second digit goes
through Task 1.6's `retypeNote`, so "1" then "2" is fret 12 and one undo step (decision 7).

A digit continues the number when it comes within the window, the number stays on the fretboard, and
the caret is still where the first digit left it. The last condition replaces today's reset on every
arrow key: moving the caret is what ends a number, however it moves.

**Files:**
- Create: `client/src/app/services/composer-fret-entry.ts`
- Test: `client/src/app/services/composer-fret-entry.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-fret-entry.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { FretDigitEntry } from './composer-fret-entry';

describe('FretDigitEntry', () => {
  let composer: ComposerService;
  let now: number;
  let auditioned: number[];
  let entry: FretDigitEntry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    now = 1000;
    auditioned = [];
    entry = new FretDigitEntry(composer, () => now, midi => auditioned.push(midi));
    composer.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
  });

  const beats = () => composer.doc.tracks[0].staves[0].bars[0].voices[0].beats;
  const fretAt = (index: number): number | null => {
    const pitch = beats()[index].notes[0]?.pitch;
    return pitch?.kind === 'fretted' ? pitch.fret : null;
  };

  it('makes "1" then "2" fret 12 on one beat, and one undo takes it all back', () => {
    entry.type(1);
    now += 300;
    entry.type(2);

    expect(fretAt(0)).toBe(12);
    expect(fretAt(1)).toBeNull();
    expect(composer.state.cursor.beatIndex).toBe(1);

    composer.undo();
    expect(beats()[0].isRest).toBeTrue();
    expect(composer.state.canUndo).toBeFalse();
  });

  it('starts a new note when the number would leave the fretboard', () => {
    entry.type(3);
    entry.type(5);

    expect([fretAt(0), fretAt(1)]).toEqual([3, 5]);
  });

  it('starts a new note once the window has passed', () => {
    entry.type(1);
    now += 900;
    entry.type(2);

    expect([fretAt(0), fretAt(1)]).toEqual([1, 2]);
  });

  it('starts a new note when the caret has moved since the first digit', () => {
    entry.type(1);
    composer.moveCursor({ kind: 'beat', delta: 1 });
    entry.type(2);

    expect([fretAt(0), fretAt(1), fretAt(2)]).toEqual([1, null, 2]);
  });

  it('auditions each fret it writes, capo included', () => {
    composer.setStaffNumber('capo', 2);
    entry.type(1);
    entry.type(2);

    // String 1 is E4, 64: fret 1 under a capo at 2 is 67, fret 12 is 78.
    expect(auditioned).toEqual([67, 78]);
  });

  it('writes nothing on a pitched staff', () => {
    composer.addTrack('Piano', 0, false);
    composer.setCursor({ trackIndex: 1 });
    const before = JSON.stringify(composer.doc);

    entry.type(5);

    expect(JSON.stringify(composer.doc)).toBe(before);
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-fret-entry.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-fret-entry'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-fret-entry.ts -->
```typescript
import type { ComposerService } from './composer.service';
import { EditCursor } from '../models/composer.model';

/**
 * Fret digits typed onto the caret's string, as in Guitar Pro.
 *
 * The first digit writes a note and advances the caret, so a melody flows. A further digit within the
 * window belongs to the same number and rewrites that note through `retypeNote` - "1" then "2" gives
 * fret 12 on one beat, as one undo step - and the caret stays where the first digit left it. A digit
 * that would take the number off the fretboard starts a new note rather than being clamped, and so does
 * one after the caret moved, however it moved.
 *
 * Lifted out of `ComposerComponent`, which kept the buffer in fields and rewrote the note by moving the
 * caret back and forth - two commits, so undo left the first digit's fret behind.
 */
export class FretDigitEntry {
  /** Highest fret the digits build up to. */
  static readonly MAX_FRET = 24;
  /** How long after a digit the next one still continues its number, in milliseconds. */
  static readonly WINDOW_MS = 800;

  /** The number being typed: its digits, where it was written, where the caret was left, and when. */
  private typing: { digits: string; target: EditCursor; leftAt: EditCursor; at: number } | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly now: () => number = () => Date.now(),
    private readonly audition: (midi: number) => void = () => undefined
  ) {}

  /** Types `digit` at the caret. Nothing happens on a pitched staff, which has no frets. */
  type(digit: number): void {
    const state = this.composer.state;
    const staff = this.composer.staffAt(state.doc, state.cursor);
    if (!staff || staff.tuning.length === 0) return;

    const now = this.now();
    const typing = this.typing;
    const combined = typing ? Number(typing.digits + digit) : Number.NaN;
    const continuing =
      typing !== null &&
      now - typing.at <= FretDigitEntry.WINDOW_MS &&
      combined <= FretDigitEntry.MAX_FRET &&
      sameBeat(state.cursor, typing.leftAt);

    if (continuing) {
      const string = (typing.target.stringIndex ?? 0) + 1;
      this.composer.retypeNote(typing.target, { kind: 'fretted', string, fret: combined });
      this.typing = { ...typing, digits: String(combined), at: now };
      this.audition((staff.tuning[string - 1] ?? 0) + staff.capo + combined);
      return;
    }

    const target = state.cursor;
    const string = (target.stringIndex ?? 0) + 1;
    this.composer.setNoteAtCursor({ kind: 'fretted', string, fret: digit }, true);
    this.typing = { digits: String(digit), target, leftAt: this.composer.state.cursor, at: now };
    this.audition((staff.tuning[string - 1] ?? 0) + staff.capo + digit);
  }
}

/** Whether two cursors name the same beat and string. */
function sameBeat(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex &&
    a.stringIndex === b.stringIndex
  );
}
```

**Step 4: Run it.** Expected: 6 SUCCESS.

**Step 5: Commit**: `feat: Two fret digits make one fret and one undo step`.

### Task 2.6: The keyboard handler

A class the page constructs with its `ComposerToolHost`, and calls from one `document:keydown` listener.
It takes a press only when:

- **nothing before it claimed it** (`event.defaultPrevented`) - the shell's Escape, Task 2.7;
- **the press is not someone typing** (`isEditableTarget`), including `contentEditable`;
- **the table has a tool for it** (`toolForPress`), with modifiers exact. A press the table does not
  bind - Ctrl+1, Alt+1, Ctrl+Alt+Z - is left alone and not `preventDefault`ed, so the browser keeps it.

**Files:**
- Create: `client/src/app/services/composer-key-handler.ts`
- Test: `client/src/app/services/composer-key-handler.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-key-handler.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { ComposerKeyHandler, KeyEventLike } from './composer-key-handler';
import { ComposerToolHost } from './composer-tools';

describe('ComposerKeyHandler', () => {
  let composer: ComposerService;
  let host: jasmine.SpyObj<Omit<ComposerToolHost, 'composer'>> & { composer: ComposerService };
  let handler: ComposerKeyHandler;
  const attached: HTMLElement[] = [];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    host = {
      composer,
      ...jasmine.createSpyObj('host', ['openPopover', 'toggleShortcutSheet', 'escape', 'playPause', 'playFromStart', 'requestSave', 'addTrack', 'typeFretDigit'])
    };
    handler = new ComposerKeyHandler(host);
  });

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  /** A key event with no modifiers, and `init` over it, whose `preventDefault` is a spy. */
  function press(init: Partial<KeyEventLike>): KeyEventLike & { preventDefault: jasmine.Spy } {
    return {
      key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      target: document.body, defaultPrevented: false, ...init, preventDefault: jasmine.createSpy('preventDefault')
    };
  }

  function attach<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    attached.push(element);
    return element;
  }

  it('leaves a press in a form field or a contentEditable element alone', () => {
    const editor = attach('div');
    editor.contentEditable = 'true';
    for (const target of [attach('input'), attach('textarea'), attach('select'), editor]) {
      const event = press({ key: '5', code: 'Digit5', target });

      expect(handler.handle(event)).withContext(target.tagName).toBeFalse();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(host.typeFretDigit).not.toHaveBeenCalled();
  });

  it('leaves Escape alone when the shell has already used it to close the drawer', () => {
    expect(handler.handle(press({ key: 'Escape', defaultPrevented: true }))).toBeFalse();
    expect(host.escape).not.toHaveBeenCalled();

    expect(handler.handle(press({ key: 'Escape' }))).toBeTrue();
    expect(host.escape).toHaveBeenCalled();
  });

  it('writes no fret for Ctrl, Alt or Cmd with a digit, and leaves the press to the browser', () => {
    for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const event = press({ key: '1', code: 'Digit1', ...modifier });

      expect(handler.handle(event)).toBeFalse();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(host.typeFretDigit).not.toHaveBeenCalled();

    handler.handle(press({ key: '1', code: 'Digit1' }));
    expect(host.typeFretDigit).toHaveBeenCalledWith(1);
  });

  it('moves a bar with Ctrl+arrow and extends with Shift+arrow, rather than stepping a beat', () => {
    handler.handle(press({ key: 'ArrowRight', ctrlKey: true }));
    expect(composer.state.cursor.barIndex).toBe(1);

    handler.handle(press({ key: 'ArrowRight', shiftKey: true }));
    expect(composer.state.anchor?.beatIndex).toBe(0);
    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('undoes on Ctrl+Z and not on Ctrl+Alt+Z, which is AltGr+Z on Windows', () => {
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);

    expect(handler.handle(press({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(composer.state.canUndo).toBeTrue();

    handler.handle(press({ key: 'z', code: 'KeyZ', ctrlKey: true }));
    expect(composer.state.canUndo).toBeFalse();
  });

  it('rests on r and on R', () => {
    handler.handle(press({ key: 'r', code: 'KeyR' }));
    handler.handle(press({ key: 'R', code: 'KeyR' }));

    expect(composer.state.cursor.beatIndex).toBe(2);
  });

  it('opens the shortcut sheet on ?, and saves on Ctrl+S', () => {
    handler.handle(press({ key: '?', code: 'Slash', shiftKey: true }));
    handler.handle(press({ key: 's', code: 'KeyS', ctrlKey: true }));

    expect(host.toggleShortcutSheet).toHaveBeenCalled();
    expect(host.requestSave).toHaveBeenCalled();
  });

  it('inserts a beat on Insert and on Alt+Enter, and plays from the start on Ctrl+Space and Shift+Space', () => {
    handler.handle(press({ key: 'Insert' }));
    handler.handle(press({ key: 'Enter', altKey: true }));
    expect(composer.doc.tracks[0].staves[0].bars[0].voices[0].beats.length).toBe(6);

    handler.handle(press({ key: ' ', ctrlKey: true }));
    handler.handle(press({ key: ' ', shiftKey: true }));
    expect(host.playFromStart).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-key-handler.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-key-handler'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-key-handler.ts -->
```typescript
import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
export type KeyEventLike = KeyPress & Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'preventDefault'>;

/**
 * The composer's keyboard, as a class the page calls from its one `document:keydown` listener.
 *
 * Lifted out of `ComposerComponent`, whose `switch` on `event.key` could not tell Ctrl+1 from 1 and read
 * form fields by tag name only. The keys are the tool table's (`COMPOSER_TOOLS`), so a key and its button
 * cannot drift apart.
 */
export class ComposerKeyHandler {
  constructor(
    private readonly host: ComposerToolHost,
    private readonly tools: readonly ComposerTool[] = COMPOSER_TOOLS
  ) {}

  /**
   * Runs the tool `event` means and claims the press, or leaves it alone and returns false.
   *
   * Left alone: a press something before this listener claimed - the shell's Escape, when it closed the
   * circle-of-fifths drawer - a press into a form field or a `contentEditable` element, and a press no
   * tool is bound to, which the browser keeps. Only a press a tool runs is `preventDefault`ed.
   */
  handle(event: KeyEventLike): boolean {
    if (event.defaultPrevented || isEditableTarget(event.target)) return false;
    const tool = toolForPress(event, this.tools);
    if (!tool) return false;

    event.preventDefault();
    tool.run(this.host, event);
    return true;
  }
}
```

**Step 4: Run it.** Expected: 8 SUCCESS.

**Step 5: Commit**: `feat: The composer keyboard handler, reading the tool table`.

### Task 2.7: The shell claims Escape only when it closes the drawer

The shell's `@HostListener('document:keydown.escape')` closes the circle-of-fifths drawer, and the
composer's Escape means back to Select and clear the range (decision 5). When the drawer is open, Escape
must close it and the composer must ignore it.

A shared "is the drawer open" flag on a service would not do it: the shell's listener is registered at
bootstrap, before any routed page's, and listeners on one target run in registration order - so by the
time the composer asked, the shell would already have closed the drawer and the flag would read closed.
Instead the shell claims the key with `preventDefault` only when it closed something, and the composer's
handler ignores a press already claimed (Task 2.6). That works in either order: had the composer run
first, the drawer would still be open, and nothing would close it but the shell.

**Files:**
- Modify: `client/src/app/app.component.ts`
- Test: `client/src/app/app.component.spec.ts`

**Step 1: Failing spec.** In `app.component.spec.ts`, after `closes on Escape`:

<!-- apply: find client/src/app/app.component.spec.ts -->
```typescript
    it('closes on Escape', () => {
      component.toggleCircle();
      component.onEscape();

      expect(component.circleOpen).toBeFalse();
    });
```

<!-- apply: replace client/src/app/app.component.spec.ts -->
```typescript
    it('closes on Escape', () => {
      component.toggleCircle();
      component.onEscape();

      expect(component.circleOpen).toBeFalse();
    });

    /**
     * The composer's Escape means back to Select, and it ignores a press something before it claimed.
     * So the shell claims Escape when - and only when - it used it: a claim with the drawer closed would
     * take Escape away from every page.
     */
    it('claims Escape only when it closes the drawer', () => {
      const withDrawerClosed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(withDrawerClosed);
      expect(withDrawerClosed.defaultPrevented).toBeFalse();

      component.toggleCircle();
      const withDrawerOpen = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(withDrawerOpen);
      expect(withDrawerOpen.defaultPrevented).toBeTrue();
      expect(component.circleOpen).toBeFalse();
    });
```

**Step 2: Run** with `--include=src/app/app.component.spec.ts`. Expected: a compile error,
`TS2554: Expected 0 arguments, but got 1.`

**Step 3: Implement.** In `app.component.ts`:

<!-- apply: find client/src/app/app.component.ts -->
```typescript
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeCircle();
  }
```

<!-- apply: replace client/src/app/app.component.ts -->
```typescript
  /**
   * Escape closes the drawer, and claims the key - `preventDefault` - only when it did.
   *
   * A page listening after the shell reads the claim: the composer's Escape means back to Select, and
   * its keyboard handler ignores a press already claimed. The shell's listener is registered at
   * bootstrap, before any routed page's, so it runs first; a shared "is the drawer open" flag would read
   * closed by the time the page asked. With the drawer already closed nothing is claimed, so Escape stays
   * every page's to use.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event?: KeyboardEvent): void {
    if (!this.circleOpen) return;
    this.closeCircle();
    event?.preventDefault();
  }
```

**Step 4: Run it.** Expected: all SUCCESS.

**Step 5: Commit**: `fix: The shell claims Escape only when it closes the drawer`.

### Task 2.8: Phase 2 checkpoint

**Step 1:** Both type checks and the whole suite, as in Task 1.16. Expected: no type errors, all SUCCESS.

**Step 2:** Nothing to commit if clean.

## Phase 3: the components

The palette, its popovers, the track strip, the top bar's Library and Export menus with the saved list
in a drawer, the status line, the shortcut sheet, and the page grid that holds them. Components read and
write state only through `ComposerService`; what a component keeps is presentation - which menu is
open, how tall the strip is.

Colours in the new component styles are CSS custom properties with the composer's existing values as
fallbacks (`var(--composer-accent, #3498db)`), and the page host defines them in Task 3.9, so a component
under test - which has no page host - still renders in the house colours.

**Phase 3 exports**

| Module | Exports | Task |
|---|---|---|
| `composer-save-requests.service.ts` (new) | `ComposerSaveRequests` | 3.1 |
| `composer-bar-choices.ts` (new) | `Choice`, `KEY_SIGNATURE_CHOICES`, `CLEF_CHOICES`, `OTTAVA_CHOICES`, `TRIPLET_FEEL_CHOICES`, `MAX_ENDING`, `endingsOf`, `endingBitsOf` | 3.2 |
| `composer-status-line` (new component) | `ComposerStatusLineComponent` | 3.3 |
| `composer-shortcut-sheet` (new component) | `ComposerShortcutSheetComponent`, `ShortcutSection`, `shortcutSectionsOf` | 3.4 |
| `composer-tool-popover` (new component) | `ComposerToolPopoverComponent` | 3.5 |
| `composer-palette` (new component) | `ComposerPaletteComponent`, `PaletteButton`, `PaletteGroup`, `paletteGroupsOf` | 3.6 |
| `composer-track-strip` (new component) | `ComposerTrackStripComponent`; `composer.component.spec.ts` moves to it | 3.7 |
| `composer-library-panel` | Library and Export as menus, the saved list in a drawer | 3.8 |
| `app.component.ts` | `--app-header-height` on the document root | 3.9 |
| `composer.component` | the page grid, the tool host, the keyboard; `clampedStripHeight` | 3.10 |

### Task 3.1: Ctrl+S reaches the library's Save

Save lives on `ComposerLibraryPanelComponent`, with its refusal and its live regions, and the keyboard
handler cannot reach a component. A root service carries the request instead: the handler asks, and the
panel, already subscribed to the composer's state, runs the same `save()` its button runs - so a
keyboard save refuses a linked progression track, announces, and returns focus exactly as a click does.

**Files:**
- Create: `client/src/app/services/composer-save-requests.service.ts`
- Modify: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts`
- Test: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts`

**Step 1: Failing spec.** In the panel spec, import the service and add to `with nothing linked`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
import { ComposerService } from '../../../../services/composer.service';
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
  describe('with nothing linked', () => {
    it('saves', async () => {
      await panel.save();

      expect(library.save).toHaveBeenCalled();
      expect(panel.saveBlockedReason).toBeNull();
    });
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
  describe('with nothing linked', () => {
    it('saves', async () => {
      await panel.save();

      expect(library.save).toHaveBeenCalled();
      expect(panel.saveBlockedReason).toBeNull();
    });

    it('saves when the keyboard asks, through the same save its button runs', async () => {
      TestBed.inject(ComposerSaveRequests).request();
      await fixture.whenStable();

      expect(library.save).toHaveBeenCalled();
    });
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module '../../../../services/composer-save-requests.service'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-save-requests.service.ts -->
```typescript
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * A request to save the composition, from somewhere that cannot press the library's Save button - the
 * keyboard's Ctrl+S.
 *
 * Save stays the library panel's: its refusal of a linked progression track, its live regions and its
 * focus return all belong to the press, whichever way the press arrives. So this carries no document
 * and does no saving. It only asks, and the panel answers by running its own `save()`.
 */
@Injectable({ providedIn: 'root' })
export class ComposerSaveRequests {
  private readonly requests = new Subject<void>();

  /** Emits once per request. */
  readonly requested$: Observable<void> = this.requests.asObservable();

  request(): void {
    this.requests.next();
  }
}
```

In the panel, import and inject it:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
import { ComposerService } from '../../../../services/composer.service';
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
    private readonly tex: AlphaTexService,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
    private readonly tex: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

and answer requests in `ngOnInit`, beside the library subscription:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
    void this.library.refresh().catch(error => this.reportError(error));
  }
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
    // Ctrl+S. The same `save()` as the button, so a keyboard save is refused, announced and followed by
    // focus exactly as a click is.
    this.saveRequests.requested$.pipe(takeUntil(this.destroy$)).subscribe(() => void this.save());

    void this.library.refresh().catch(error => this.reportError(error));
  }
```

**Step 4: Run** the panel spec. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Let the keyboard ask the library to save`.

### Task 3.2: The values a popover offers

Pure lists the popovers draw from, so their content is specced without a component:

- **Key signatures: all fifteen, major and minor.** The mapper's `KEY_SIGNATURES` lists majors only and
  stops at six sharps and six flats; this lists every key from seven flats to seven sharps in both
  modes, thirty choices, each named by its tonic and its accidentals.
- Clefs and ottavas, the seven triplet feels, and alternate endings as a bitfield (bit 0 is the first
  ending, as `MasterBarDoc.alternateEndings` stores them).

**Files:**
- Create: `client/src/app/services/composer-bar-choices.ts`
- Test: `client/src/app/services/composer-bar-choices.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-bar-choices.spec.ts -->
```typescript
import { keySignatureFault } from './bar-edits';
import {
  CLEF_CHOICES,
  KEY_SIGNATURE_CHOICES,
  MAX_ENDING,
  TRIPLET_FEEL_CHOICES,
  endingBitsOf,
  endingsOf
} from './composer-bar-choices';

describe('composer bar choices', () => {
  it('offers all fifteen key signatures in both modes, every one of them valid', () => {
    expect(KEY_SIGNATURE_CHOICES.length).toBe(30);
    for (const mode of ['major', 'minor'] as const) {
      const fifths = KEY_SIGNATURE_CHOICES.filter(choice => choice.value.mode === mode).map(choice => choice.value.fifths);
      expect(fifths).toEqual([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]);
    }
    expect(KEY_SIGNATURE_CHOICES.every(choice => keySignatureFault(choice.value) === null)).toBeTrue();
  });

  it('names each key by its tonic and its accidentals', () => {
    const label = (fifths: number, mode: 'major' | 'minor'): string =>
      KEY_SIGNATURE_CHOICES.find(choice => choice.value.fifths === fifths && choice.value.mode === mode)?.label ?? '';

    expect(label(0, 'major')).toBe('C major (no sharps or flats)');
    expect(label(0, 'minor')).toBe('A minor (no sharps or flats)');
    expect(label(-7, 'major')).toBe('C♭ major (7 flats)');
    expect(label(7, 'minor')).toBe('A♯ minor (7 sharps)');
    expect(label(1, 'major')).toBe('G major (1 sharp)');
  });

  it('offers every clef the model has, and every triplet feel', () => {
    expect(CLEF_CHOICES.map(choice => choice.value)).toEqual(['g2', 'f4', 'c3', 'c4', 'n']);
    expect(TRIPLET_FEEL_CHOICES.length).toBe(7);
  });

  it('reads and writes alternate endings as a bitfield, first ending in bit 0', () => {
    expect(endingsOf(0b101)).toEqual([1, 3]);
    expect(endingBitsOf([1, 3])).toBe(0b101);
    expect(endingBitsOf(endingsOf(0b11000000))).toBe(0b11000000);
    expect(MAX_ENDING).toBe(8);
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-bar-choices.spec.ts`. Expected: a compile error,
`TS2307: Cannot find module './composer-bar-choices'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-bar-choices.ts -->
```typescript
import { ClefKind, KeySignature, OttaviaKind, TripletFeelKind } from '../models/composer.model';

/**
 * The values the composer's bar popovers offer: key signatures, clefs, ottavas, triplet feels and
 * alternate endings.
 *
 * The key signatures are all fifteen in both modes. The mapper's `KEY_SIGNATURES` lists majors only and
 * stops at six accidentals, which was enough for a picker of common keys and is not enough for a tool
 * that must reach any key a file can hold.
 */

/** One option in a popover: what it says, and the value it sets. */
export interface Choice<T> {
  label: string;
  value: T;
}

/** Major tonics from seven flats to seven sharps, index 0 being `fifths` -7. */
const MAJOR_TONICS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];

/** The relative minor of each, a minor third below. */
const MINOR_TONICS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

function accidentalsOf(fifths: number): string {
  if (fifths === 0) return 'no sharps or flats';
  const count = Math.abs(fifths);
  return `${count} ${fifths > 0 ? 'sharp' : 'flat'}${count === 1 ? '' : 's'}`;
}

/** Every key signature, majors then minors, each from seven flats to seven sharps. */
export const KEY_SIGNATURE_CHOICES: readonly Choice<KeySignature>[] = (['major', 'minor'] as const).flatMap(mode =>
  (mode === 'major' ? MAJOR_TONICS : MINOR_TONICS).map((tonic, index) => {
    const fifths = index - 7;
    return { label: `${tonic} ${mode} (${accidentalsOf(fifths)})`, value: { fifths, mode } };
  })
);

export const CLEF_CHOICES: readonly Choice<ClefKind>[] = [
  { label: 'Treble (G)', value: 'g2' },
  { label: 'Bass (F)', value: 'f4' },
  { label: 'Alto (C on the middle line)', value: 'c3' },
  { label: 'Tenor (C on the fourth line)', value: 'c4' },
  { label: 'Neutral', value: 'n' }
];

export const OTTAVA_CHOICES: readonly Choice<OttaviaKind>[] = [
  { label: 'Two octaves up (15ma)', value: '15ma' },
  { label: 'An octave up (8va)', value: '8va' },
  { label: 'As written', value: 'regular' },
  { label: 'An octave down (8vb)', value: '8vb' },
  { label: 'Two octaves down (15mb)', value: '15mb' }
];

export const TRIPLET_FEEL_CHOICES: readonly Choice<TripletFeelKind>[] = [
  { label: 'Straight', value: 'none' },
  { label: 'Triplet eighths', value: 'triplet8th' },
  { label: 'Triplet sixteenths', value: 'triplet16th' },
  { label: 'Dotted eighths', value: 'dotted8th' },
  { label: 'Dotted sixteenths', value: 'dotted16th' },
  { label: 'Scottish eighths', value: 'scottish8th' },
  { label: 'Scottish sixteenths', value: 'scottish16th' }
];

/** The highest alternate ending the popover offers. */
export const MAX_ENDING = 8;

/** The endings a bitfield marks, first ending first. Bit 0 is ending 1. */
export function endingsOf(bits: number): number[] {
  return Array.from({ length: MAX_ENDING }, (_, index) => index + 1).filter(ending => (bits & (1 << (ending - 1))) !== 0);
}

/** The bitfield marking `endings`. */
export function endingBitsOf(endings: readonly number[]): number {
  return endings.reduce((bits, ending) => bits | (1 << (ending - 1)), 0);
}
```

**Step 4: Run it.** Expected: 4 SUCCESS.

**Step 5: Commit**: `feat: Every key signature, clef, triplet feel and ending a bar popover offers`.

### Task 3.3: The status line, and the page's live region

Refusals get a display (decision 8). One polite `aria-live` region shows `state.refusal`, and the
alphaTex panel's `texApplyError` - set by `applyTex` and never rendered - is shown there too. The region
is always in the DOM, so it is in the accessibility tree before its content changes (the library panel's
template comment says why that matters). The caret readout, "Bar · Beat", moves here from the old input
panel, outside the region so a caret move is not read aloud.

**Files:**
- Create: `client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts`,
  `.html`, `.scss`
- Test: `client/src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts -->
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerStatusLineComponent } from './composer-status-line.component';
import { createDefaultCursor } from '../../../../models/composer.model';

describe('ComposerStatusLineComponent', () => {
  let fixture: ComponentFixture<ComposerStatusLineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerStatusLineComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerStatusLineComponent);
  });

  const region = (): HTMLElement => fixture.nativeElement.querySelector('[aria-live="polite"]');

  it('has its polite live region in the tree before there is anything to say', () => {
    fixture.detectChanges();

    expect(region()).not.toBeNull();
    expect(region().textContent?.trim()).toBe('');
  });

  it('says why the last press did nothing', () => {
    fixture.componentRef.setInput('refusal', 'There is no note there to change.');
    fixture.detectChanges();

    expect(region().textContent).toContain('There is no note there to change.');
  });

  it('shows a failed alphaTex apply beside a refusal', () => {
    fixture.componentRef.setInput('refusal', 'Nothing is selected.');
    fixture.componentRef.setInput('texError', 'alphaTex could not be parsed. The score is unchanged.');
    fixture.detectChanges();

    expect(region().textContent).toContain('could not be parsed');
    expect(region().textContent).toContain('Nothing is selected.');
  });

  it('shows the caret\'s bar and beat, counting from one, outside the live region', () => {
    fixture.componentRef.setInput('cursor', { ...createDefaultCursor(), barIndex: 2, beatIndex: 1 });
    fixture.detectChanges();

    const readout: HTMLElement = fixture.nativeElement.querySelector('.readout');
    expect(readout.textContent).toContain('Bar 3');
    expect(readout.textContent).toContain('Beat 2');
    expect(region().contains(readout)).toBeFalse();
  });
});
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module './composer-status-line.component'`.

**Step 3: Implement**

<!-- apply: create client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts -->
```typescript
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EditCursor, EntryMode } from '../../../../models/composer.model';

/**
 * The line between the score and the track strip: where the caret is, whether a click writes, and why
 * the last press did nothing.
 *
 * Holds the page's one polite live region. Refusals from every route - a palette button, a key, a click
 * on the score - arrive as `ComposerState.refusal`, and the region reads them out; a failed alphaTex apply
 * joins them. The caret readout sits outside the region, so moving the caret is not announced.
 */
@Component({
  selector: 'app-composer-status-line',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-status-line.component.html',
  styleUrls: ['./composer-status-line.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerStatusLineComponent {
  /** Why the last command did nothing, from `ComposerState.refusal`. */
  @Input() refusal: string | null = null;
  /** Why an alphaTex apply left the score unchanged. */
  @Input() texError: string | null = null;
  @Input() cursor: EditCursor | null = null;
  @Input() entryMode: EntryMode = 'select';

  /** What the live region says: the alphaTex error, then the refusal. */
  get messages(): string[] {
    return [this.texError, this.refusal].filter((message): message is string => !!message);
  }
}
```

<!-- apply: create client/src/app/components/composer/components/composer-status-line/composer-status-line.component.html -->
```html
<div class="status-line">
  <span class="readout" *ngIf="cursor">Bar {{ cursor.barIndex + 1 }} · Beat {{ cursor.beatIndex + 1 }}</span>
  <span class="mode" [class.pen]="entryMode === 'pen'">{{ entryMode === 'pen' ? 'Pen' : 'Select' }}</span>

  <!--
    The page's polite live region. Always rendered, and only its content comes and goes: a region
    inserted already holding its message is the case screen readers miss, so the element has to be in
    the accessibility tree before there is anything to say.
  -->
  <p class="messages" aria-live="polite">
    <span class="message" *ngFor="let message of messages">{{ message }}</span>
  </p>
</div>
```

<!-- apply: create client/src/app/components/composer/components/composer-status-line/composer-status-line.component.scss -->
```scss
// The status line: caret, mode, and the live region for refusals.

:host {
  display: block;
  min-width: 0;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 1.9rem;
  padding: 0.25rem 0.9rem;
  background-color: var(--composer-nav, #2c3e50);
  border-top: 1px solid var(--composer-border, #465666);
  color: var(--composer-text-secondary, #bdc3c7);
  font-size: 0.78rem;
}

.readout,
.mode {
  flex-shrink: 0;
  white-space: nowrap;
}

.mode.pen {
  color: var(--composer-text, #ecf0f1);
}

.messages {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--composer-text, #ecf0f1);
}

.message + .message::before {
  content: ' · ';
  color: var(--composer-text-secondary, #bdc3c7);
}
```

**Step 4: Run it.** Expected: 4 SUCCESS.

**Step 5: Commit**: `feat: A status line whose live region shows why a press did nothing`.

### Task 3.4: The shortcut sheet

`?` opens a sheet listing every tool with a key, grouped as the design's table is, read from
`COMPOSER_TOOLS` - so the sheet cannot disagree with the keys. The fret digits are written `0-9`, and a
tool with two bindings shows both, so the macOS alternates are discoverable where a Mac user would look.
The sheet is hidden with CSS rather than removed, like the library drawer.

**Files:**
- Create: `client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts`,
  `.html`, `.scss`
- Test: `client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.spec.ts -->
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerShortcutSheetComponent, shortcutSectionsOf } from './composer-shortcut-sheet.component';
import { COMPOSER_TOOLS } from '../../../../services/composer-tools';

describe('shortcutSectionsOf', () => {
  const sections = shortcutSectionsOf(COMPOSER_TOOLS);
  const keysOf = (label: string): string | undefined =>
    sections.flatMap(section => section.rows).find(row => row.label === label)?.keys;

  it('groups the tools in the design table\'s order', () => {
    expect(sections.map(section => section.group)).toEqual([
      'Tools', 'Edit', 'Navigation', 'Playback', 'Beats', 'Duration', 'Bar', 'Tracks', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'
    ]);
  });

  it('writes the fret digits as a range, and both bindings where a tool has two', () => {
    expect(keysOf('Fret')).toBe('0-9');
    expect(keysOf('Insert beat')).toBe('Insert or Alt+Enter');
    expect(keysOf('Play from the start')).toBe('Ctrl+Space or Shift+Space');
    expect(keysOf('Longer')).toBe('+ or =');
  });

  it('leaves out the tools with no key', () => {
    expect(keysOf('Quarter note')).toBeUndefined();
  });
});

describe('ComposerShortcutSheetComponent', () => {
  let fixture: ComponentFixture<ComposerShortcutSheetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerShortcutSheetComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerShortcutSheetComponent);
    fixture.detectChanges();
  });

  it('is in the page while closed, hidden rather than removed', () => {
    const sheet: HTMLElement = fixture.nativeElement.querySelector('[role="dialog"]');

    expect(sheet).not.toBeNull();
    expect(sheet.getAttribute('aria-hidden')).toBe('true');
  });

  it('says it is open, and asks to close from its close button', () => {
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const sheet: HTMLElement = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-hidden')).toBe('false');
    (fixture.nativeElement.querySelector('.sheet-close') as HTMLButtonElement).click();
    expect(closed).toBeTrue();
  });
});
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module './composer-shortcut-sheet.component'`.

**Step 3: Implement**

<!-- apply: create client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```typescript
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { bindingLabelOf } from '../../../../services/composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ToolGroup } from '../../../../services/composer-tools';

/** One line of the sheet. */
export interface ShortcutRow {
  label: string;
  keys: string;
}

/** One group of the sheet. */
export interface ShortcutSection {
  group: ToolGroup;
  rows: ShortcutRow[];
}

/** The groups in the order of the design's shortcut table. */
const SHEET_ORDER: readonly ToolGroup[] = [
  'Tools', 'Edit', 'Navigation', 'Playback', 'Beats', 'Duration', 'Bar', 'Tracks', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'
];

/** A tool's keys as the sheet writes them: every binding, joined with "or", and the ten digits as a range. */
function keysOf(tool: ComposerTool): string {
  const labels = tool.keys.map(bindingLabelOf);
  return labels.length === 10 && labels.every((label, index) => label === String(index)) ? '0-9' : labels.join(' or ');
}

/** The sheet's content, from the tool table: each group's tools that have a key, in table order. */
export function shortcutSectionsOf(tools: readonly ComposerTool[]): ShortcutSection[] {
  return SHEET_ORDER.map(group => ({
    group,
    rows: tools.filter(tool => tool.group === group && tool.keys.length > 0).map(tool => ({ label: tool.label, keys: keysOf(tool) }))
  })).filter(section => section.rows.length > 0);
}

/**
 * Every keyboard shortcut, opened with `?`.
 *
 * Read from `COMPOSER_TOOLS`, so it lists exactly the keys the handler answers to. Hidden with CSS rather
 * than removed while closed, so opening it builds nothing.
 */
@Component({
  selector: 'app-composer-shortcut-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-shortcut-sheet.component.html',
  styleUrls: ['./composer-shortcut-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerShortcutSheetComponent {
  @Input() open = false;
  @Output() readonly closed = new EventEmitter<void>();

  readonly sections: readonly ShortcutSection[] = shortcutSectionsOf(COMPOSER_TOOLS);

  trackByGroup(_index: number, section: ShortcutSection): string {
    return section.group;
  }
}
```

<!-- apply: create client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.html -->
```html
<section class="sheet" [class.open]="open" role="dialog" aria-label="Keyboard shortcuts" [attr.aria-hidden]="!open">
  <header class="sheet-header">
    <h2>Keyboard shortcuts</h2>
    <button type="button" class="sheet-close" aria-label="Close keyboard shortcuts" (click)="closed.emit()">×</button>
  </header>

  <p class="sheet-note">
    Ctrl is Cmd on a Mac. A key written as a symbol - <kbd>?</kbd>, <kbd>&#125;</kbd> - is pressed however your keyboard
    layout types that symbol. Keys are ignored while you type in a field.
  </p>

  <div class="sections">
    <section class="section" *ngFor="let section of sections; trackBy: trackByGroup">
      <h3>{{ section.group }}</h3>
      <dl>
        <ng-container *ngFor="let row of section.rows">
          <dt>{{ row.label }}</dt>
          <dd><kbd>{{ row.keys }}</kbd></dd>
        </ng-container>
      </dl>
    </section>
  </div>
</section>
```

<!-- apply: create client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.scss -->
```scss
// The shortcut sheet: an overlay over the score, hidden with CSS while closed.

.sheet {
  position: fixed;
  inset: 5vh 5vw;
  z-index: 950;
  display: none;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  &.open {
    display: flex;
  }
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--composer-border, #465666);

  h2 {
    margin: 0;
    font-size: 1rem;
  }
}

.sheet-close {
  background: none;
  border: none;
  color: var(--composer-text-secondary, #bdc3c7);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--composer-text, #ecf0f1);
  }
}

.sheet-note {
  margin: 0;
  padding: 0.5rem 1rem;
  font-size: 0.78rem;
  color: var(--composer-text-secondary, #bdc3c7);
}

.sections {
  overflow-y: auto;
  padding: 0.5rem 1rem 1rem;
  columns: 18rem;
  column-gap: 1.5rem;
}

.section {
  break-inside: avoid;
  margin-bottom: 1rem;

  h3 {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--composer-text-secondary, #bdc3c7);
  }

  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.2rem 0.75rem;
    margin: 0;
    font-size: 0.8rem;
  }

  dd {
    margin: 0;
    text-align: right;
  }
}

kbd {
  font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.75rem;
}
```

**Step 4: Run it.** Expected: 5 SUCCESS.

**Step 5: Commit**: `feat: A shortcut sheet read from the tool table`.

### Task 3.5: Popovers for the tools that take a value

Time signature, key signature, clef, section, alternate ending, tuplet and triplet feel each open a small
popover anchored to their palette button - not a modal (decision 17). Each reads its starting values from
the caret's bar, validates before committing - `timeSignatureFault`, `keySignatureFault`, a section needs a
name - and refuses an invalid entry inline, in a `role="alert"` region inside the popover that is
rendered before there is anything to say. A valid entry commits through the service and closes the
popover; anything the service itself refuses goes to the status line, like every other press.

Common time is allowed for 4/4 and cut time for 2/2, which are the two meters alphaTab draws with a C.

**Files:**
- Create: `client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts`,
  `.html`, `.scss`
- Test: `client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts -->
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerToolPopoverComponent } from './composer-tool-popover.component';
import { ComposerService } from '../../../../services/composer.service';
import { KEY_SIGNATURE_CHOICES } from '../../../../services/composer-bar-choices';
import { PopoverKind } from '../../../../services/composer-tools';

describe('ComposerToolPopoverComponent', () => {
  let fixture: ComponentFixture<ComposerToolPopoverComponent>;
  let popover: ComposerToolPopoverComponent;
  let composer: ComposerService;
  let closed: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerToolPopoverComponent] }).compileComponents();
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerToolPopoverComponent);
    popover = fixture.componentInstance;
    closed = 0;
    popover.closed.subscribe(() => closed++);
  });

  function open(kind: PopoverKind): void {
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('state', composer.state);
    fixture.detectChanges();
  }

  const alert = (): HTMLElement => fixture.nativeElement.querySelector('[role="alert"]');

  it('starts from the caret\'s meter', () => {
    composer.setTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

    open('timeSignature');

    expect(popover.numerator).toBe(3);
  });

  it('refuses an invalid time signature inline, commits nothing, and stays open', () => {
    open('timeSignature');
    const before = JSON.stringify(composer.doc);

    popover.numerator = 0;
    popover.applyTimeSignature();
    fixture.detectChanges();

    expect(alert().textContent).toMatch(/numerator/i);
    expect(JSON.stringify(composer.doc)).toBe(before);
    expect(closed).toBe(0);
  });

  it('sets a valid time signature and closes', () => {
    // The empty score is in common time, so the popover opens with the box ticked.
    open('timeSignature');
    expect(popover.isCommon).toBeTrue();

    popover.numerator = 6;
    popover.denominator = 8;
    popover.isCommon = false;
    popover.applyTimeSignature();

    expect(composer.scoreMeter).toEqual({ numerator: 6, denominator: 8, isCommon: false });
    expect(closed).toBe(1);
  });

  it('refuses common time for a meter alphaTab does not draw with a C', () => {
    open('timeSignature');

    popover.numerator = 3;
    popover.denominator = 4;
    popover.isCommon = true;
    popover.applyTimeSignature();

    expect(popover.fault).toMatch(/4\/4/);
    expect(closed).toBe(0);
  });

  it('offers every key and sets the one chosen', () => {
    open('keySignature');
    expect(popover.keyChoices.length).toBe(30);

    popover.keyIndex = KEY_SIGNATURE_CHOICES.findIndex(choice => choice.value.fifths === 7 && choice.value.mode === 'minor');
    popover.applyKeySignature();

    expect(composer.doc.tracks[0].staves[0].bars[0].keySignature).toEqual({ fifths: 7, mode: 'minor' });
  });

  it('refuses a section with no name, and sets one with a name', () => {
    open('section');

    popover.sectionText = '   ';
    popover.applySection();
    fixture.detectChanges();
    expect(alert().textContent).toMatch(/name/i);

    popover.sectionText = 'Chorus';
    popover.sectionMarker = 'B';
    popover.applySection();
    expect(composer.doc.masterBars[0].section).toEqual({ marker: 'B', text: 'Chorus' });
  });

  it('sets alternate endings from the boxes ticked', () => {
    open('alternateEnding');

    popover.endings[0] = true;
    popover.endings[1] = true;
    popover.applyEndings();

    expect(composer.doc.masterBars[0].alternateEndings).toBe(0b11);
  });

  it('puts the caret\'s beat under the tuplet chosen', () => {
    open('tuplet');

    popover.applyTuplet({ numerator: 5, denominator: 4 });

    expect(composer.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].tuplet).toEqual({ numerator: 5, denominator: 4 });
    expect(closed).toBe(1);
  });
});
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module './composer-tool-popover.component'`.

**Step 3: Implement**

<!-- apply: create client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```typescript
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ClefKind,
  ComposerState,
  OttaviaKind,
  TripletFeelKind,
  Tuplet,
  effectiveTimeSignature
} from '../../../../models/composer.model';
import { keySignatureFault, timeSignatureFault } from '../../../../services/bar-edits';
import {
  CLEF_CHOICES,
  KEY_SIGNATURE_CHOICES,
  MAX_ENDING,
  OTTAVA_CHOICES,
  TRIPLET_FEEL_CHOICES,
  endingBitsOf,
  endingsOf
} from '../../../../services/composer-bar-choices';
import { ComposerService } from '../../../../services/composer.service';
import { TUPLET_CHOICES } from '../../../../services/composer-tool-defaults';
import { PopoverKind } from '../../../../services/composer-tools';

/** What each popover is called, for its dialog label and heading. */
const TITLES: Readonly<Record<PopoverKind, string>> = {
  timeSignature: 'Time signature',
  keySignature: 'Key signature',
  clef: 'Clef',
  section: 'Section',
  alternateEnding: 'Alternate ending',
  tuplet: 'Tuplet',
  tripletFeel: 'Triplet feel'
};

/**
 * The small popover a valued tool opens, anchored beside its palette button (design Part 3).
 *
 * Validates what it can before committing - the same `timeSignatureFault` and `keySignatureFault` the
 * service checks, and that a section has a name - and refuses an invalid entry inline, in a region
 * rendered before there is anything to say. A valid entry commits through `ComposerService` and asks to
 * close. It holds only the values being typed; the document is the service's.
 */
@Component({
  selector: 'app-composer-tool-popover',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-tool-popover.component.html',
  styleUrls: ['./composer-tool-popover.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerToolPopoverComponent implements OnChanges {
  @Input() kind: PopoverKind | null = null;
  @Input() state: ComposerState | null = null;
  @Output() readonly closed = new EventEmitter<void>();

  readonly keyChoices = KEY_SIGNATURE_CHOICES;
  readonly clefChoices = CLEF_CHOICES;
  readonly ottavaChoices = OTTAVA_CHOICES;
  readonly tripletFeelChoices = TRIPLET_FEEL_CHOICES;
  readonly tupletChoices = TUPLET_CHOICES;
  readonly endingNumbers = Array.from({ length: MAX_ENDING }, (_, index) => index + 1);

  numerator = 4;
  denominator = 4;
  isCommon = false;
  keyIndex = 7;
  clef: ClefKind = 'g2';
  ottava: OttaviaKind = 'regular';
  sectionText = '';
  sectionMarker = '';
  endings: boolean[] = new Array<boolean>(MAX_ENDING).fill(false);
  tripletFeel: TripletFeelKind = 'none';

  /** Why the entry cannot be applied, shown inline. */
  fault: string | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get title(): string {
    return this.kind ? TITLES[this.kind] : '';
  }

  ngOnChanges(): void {
    this.fault = null;
    this.readSelection();
  }

  applyTimeSignature(): void {
    const timeSignature = { numerator: Number(this.numerator), denominator: Number(this.denominator), isCommon: this.isCommon };
    const commonFault =
      timeSignature.isCommon && !((timeSignature.numerator === 4 && timeSignature.denominator === 4) || (timeSignature.numerator === 2 && timeSignature.denominator === 2))
        ? 'Common time is drawn only for 4/4, and cut time only for 2/2.'
        : null;
    if (this.refuse(timeSignatureFault(timeSignature) ?? commonFault)) return;
    this.composer.setTimeSignature(timeSignature);
    this.closed.emit();
  }

  applyKeySignature(): void {
    const choice = this.keyChoices[Number(this.keyIndex)];
    if (!choice || this.refuse(keySignatureFault(choice.value))) return;
    this.composer.setKeySignature({ ...choice.value });
    this.closed.emit();
  }

  applyClef(): void {
    this.composer.setClef(this.clef, this.ottava);
    this.closed.emit();
  }

  applySection(): void {
    if (this.refuse(this.sectionText.trim() ? null : 'A section needs a name.')) return;
    this.composer.setMasterBarValue('section', { marker: this.sectionMarker.trim(), text: this.sectionText.trim() });
    this.closed.emit();
  }

  removeSection(): void {
    this.composer.setMasterBarValue('section', null);
    this.closed.emit();
  }

  applyEndings(): void {
    const chosen = this.endingNumbers.filter((_, index) => this.endings[index]);
    this.composer.setMasterBarValue('alternateEndings', endingBitsOf(chosen));
    this.closed.emit();
  }

  applyTuplet(tuplet: Readonly<Tuplet> | null): void {
    this.composer.setTuplet(tuplet ? { ...tuplet } : null);
    this.closed.emit();
  }

  applyTripletFeel(): void {
    this.composer.setMasterBarValue('tripletFeel', this.tripletFeel);
    this.closed.emit();
  }

  /**
   * Shows `fault` inline when there is one, and says whether there was. Marks the view: an apply can
   * arrive from a form submit or from the keyboard, and an OnPush view repaints only when told.
   */
  private refuse(fault: string | null): boolean {
    this.fault = fault;
    this.cdr.markForCheck();
    return fault !== null;
  }

  /** Starts every field from the caret's bar, so a popover opens on what is already there. */
  private readSelection(): void {
    const state = this.state;
    if (!state) return;
    const { barIndex, trackIndex, staffIndex } = state.cursor;
    const meter = effectiveTimeSignature(state.doc.masterBars, barIndex);
    this.numerator = meter.numerator;
    this.denominator = meter.denominator;
    this.isCommon = meter.isCommon;

    const bar = state.doc.tracks[trackIndex]?.staves[staffIndex]?.bars[barIndex];
    if (bar) {
      const key = this.keyChoices.findIndex(choice => choice.value.fifths === bar.keySignature.fifths && choice.value.mode === bar.keySignature.mode);
      this.keyIndex = key >= 0 ? key : this.keyIndex;
      this.clef = bar.clef;
      this.ottava = bar.clefOttava;
    }

    const masterBar = state.doc.masterBars[barIndex];
    if (masterBar) {
      this.sectionText = masterBar.section?.text ?? '';
      this.sectionMarker = masterBar.section?.marker ?? '';
      const marked = endingsOf(masterBar.alternateEndings);
      this.endings = this.endingNumbers.map(ending => marked.includes(ending));
      this.tripletFeel = masterBar.tripletFeel;
    }
  }
}
```

<!-- apply: create client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.html -->
```html
<div class="popover" role="dialog" [attr.aria-label]="title" (keydown.escape)="closed.emit()">
  <h3 class="popover-title">{{ title }}</h3>

  <ng-container [ngSwitch]="kind">
    <form *ngSwitchCase="'timeSignature'" (ngSubmit)="applyTimeSignature()">
      <div class="fields">
        <label>Top <input type="number" min="1" max="32" name="numerator" [(ngModel)]="numerator" /></label>
        <label>Bottom
          <select name="denominator" [(ngModel)]="denominator">
            <option *ngFor="let value of [1, 2, 4, 8, 16, 32]" [ngValue]="value">{{ value }}</option>
          </select>
        </label>
      </div>
      <label class="check"><input type="checkbox" name="isCommon" [(ngModel)]="isCommon" /> Draw as common or cut time</label>
      <div class="actions"><button type="submit" class="text-btn">Apply</button><button type="button" class="text-btn" (click)="closed.emit()">Cancel</button></div>
    </form>

    <form *ngSwitchCase="'keySignature'" (ngSubmit)="applyKeySignature()">
      <label>Key
        <select name="key" [(ngModel)]="keyIndex">
          <option *ngFor="let choice of keyChoices; let index = index" [ngValue]="index">{{ choice.label }}</option>
        </select>
      </label>
      <div class="actions"><button type="submit" class="text-btn">Apply</button><button type="button" class="text-btn" (click)="closed.emit()">Cancel</button></div>
    </form>

    <form *ngSwitchCase="'clef'" (ngSubmit)="applyClef()">
      <label>Clef
        <select name="clef" [(ngModel)]="clef">
          <option *ngFor="let choice of clefChoices" [ngValue]="choice.value">{{ choice.label }}</option>
        </select>
      </label>
      <label>Octave
        <select name="ottava" [(ngModel)]="ottava">
          <option *ngFor="let choice of ottavaChoices" [ngValue]="choice.value">{{ choice.label }}</option>
        </select>
      </label>
      <div class="actions"><button type="submit" class="text-btn">Apply</button><button type="button" class="text-btn" (click)="closed.emit()">Cancel</button></div>
    </form>

    <form *ngSwitchCase="'section'" (ngSubmit)="applySection()">
      <label>Name <input type="text" name="sectionText" [(ngModel)]="sectionText" /></label>
      <label>Mark <input type="text" name="sectionMarker" maxlength="3" [(ngModel)]="sectionMarker" /></label>
      <div class="actions">
        <button type="submit" class="text-btn">Apply</button>
        <button type="button" class="text-btn" (click)="removeSection()">Remove</button>
        <button type="button" class="text-btn" (click)="closed.emit()">Cancel</button>
      </div>
    </form>

    <form *ngSwitchCase="'alternateEnding'" (ngSubmit)="applyEndings()">
      <fieldset class="endings">
        <legend>Played on repeat</legend>
        <label class="check" *ngFor="let ending of endingNumbers; let index = index">
          <input type="checkbox" [name]="'ending' + ending" [(ngModel)]="endings[index]" /> {{ ending }}
        </label>
      </fieldset>
      <div class="actions"><button type="submit" class="text-btn">Apply</button><button type="button" class="text-btn" (click)="closed.emit()">Cancel</button></div>
    </form>

    <div *ngSwitchCase="'tuplet'" class="actions tuplets">
      <button type="button" class="text-btn" *ngFor="let tuplet of tupletChoices" (click)="applyTuplet(tuplet)">
        {{ tuplet.numerator }}:{{ tuplet.denominator }}
      </button>
      <button type="button" class="text-btn" (click)="applyTuplet(null)">None</button>
    </div>

    <form *ngSwitchCase="'tripletFeel'" (ngSubmit)="applyTripletFeel()">
      <label>Feel
        <select name="tripletFeel" [(ngModel)]="tripletFeel">
          <option *ngFor="let choice of tripletFeelChoices" [ngValue]="choice.value">{{ choice.label }}</option>
        </select>
      </label>
      <div class="actions"><button type="submit" class="text-btn">Apply</button><button type="button" class="text-btn" (click)="closed.emit()">Cancel</button></div>
    </form>
  </ng-container>

  <!-- Always rendered: an alert region inserted already holding its message is the case screen readers miss. -->
  <p class="fault" role="alert">{{ fault }}</p>
</div>
```

<!-- apply: create client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.scss -->
```scss
// A valued tool's popover, anchored beside its palette button.

.popover {
  position: absolute;
  top: 0;
  left: calc(100% + 0.4rem);
  z-index: 40;
  width: 15rem;
  padding: 0.6rem;
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.popover-title {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
}

form,
.fields {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.fields {
  flex-direction: row;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: var(--composer-text-secondary, #bdc3c7);
}

label.check {
  flex-direction: row;
  align-items: center;
}

input[type='number'],
input[type='text'],
select {
  min-width: 0;
  padding: 0.25rem 0.35rem;
  background-color: var(--composer-nav-secondary, #34495e);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
}

.endings {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.6rem;
  margin: 0;
  padding: 0.3rem;
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;

  legend {
    font-size: 0.72rem;
    color: var(--composer-text-secondary, #bdc3c7);
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.text-btn {
  background-color: var(--composer-nav-secondary, #34495e);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
  cursor: pointer;
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;

  &:hover {
    background-color: var(--composer-accent, #3498db);
  }
}

.fault {
  margin: 0.4rem 0 0;
  font-size: 0.72rem;
  color: var(--composer-warning, #f39c12);

  &:empty {
    margin: 0;
  }
}
```

**Step 4: Run it.** Expected: 8 SUCCESS.

**Step 5: Commit**: `feat: Popovers for the composer tools that take a value`.

### Task 3.6: The palette

The palette draws a button for every palette tool in `COMPOSER_TOOLS`, grouped in the design's order,
and reads what each shows from `toolStates`:

- A **toggle** says `aria-pressed` - `true`, `false` or `mixed`. A tool that is not a toggle (a popover,
  Fix bar, insert and delete bar, Natural, Respell) has no `aria-pressed`; a popover tool says
  `aria-haspopup="dialog"` and `aria-expanded`.
- A tool `toolStates` refuses says `aria-disabled="true"`, and its accessible name and tooltip carry the
  reason. It stays pressable: the command refuses by itself and publishes the reason to the status line,
  which is the M4 rule that the gate is a refusal, not a disabled button.
- Each tooltip ends with the tool's shortcut, read from the same table the keyboard reads.
- Buttons are Bravura glyphs where SMuFL has one. An `@font-face` in the palette's component styles
  points at `/font/Bravura.woff2`, which `angular.json` already serves from
  `node_modules/@coderline/alphatab/dist/font`, with `Bravura.woff` as the fallback. Test builds do not
  load fonts, so no spec depends on how a glyph renders.
- The palette scrolls vertically and never sideways (`overflow-x: hidden`).

**Files:**
- Create: `client/src/app/components/composer/components/composer-palette/composer-palette.component.ts`,
  `.html`, `.scss`
- Test: `client/src/app/components/composer/components/composer-palette/composer-palette.component.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/components/composer/components/composer-palette/composer-palette.component.spec.ts -->
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerPaletteComponent, PaletteButton, paletteGroupsOf } from './composer-palette.component';
import { ComposerService } from '../../../../services/composer.service';
import { COMPOSER_TOOLS, ComposerTool } from '../../../../services/composer-tools';

describe('paletteGroupsOf', () => {
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
  });

  const buttonFor = (id: string): PaletteButton => {
    const found = paletteGroupsOf(composer.state).flatMap(group => group.buttons).find(button => button.tool.id === id);
    if (!found) throw new Error(`no button ${id}`);
    return found;
  };

  it('draws every palette tool once, in the design\'s groups', () => {
    const groups = paletteGroupsOf(composer.state);

    expect(groups.map(group => group.group)).toEqual(['Tools', 'Duration', 'Bar', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques']);
    expect(groups.flatMap(group => group.buttons).length).toBe(COMPOSER_TOOLS.filter(tool => tool.inPalette).length);
  });

  it('says a toggle is mixed across a range', () => {
    composer.setCursor({ beatIndex: 0, stringIndex: 0 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    composer.toggleNoteEffect('isGhost', true, false);
    composer.setCursor({ beatIndex: 1 });
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 5 }, false);
    composer.setCursor({ beatIndex: 0 });
    composer.extendSelectionTo({ beatIndex: 1 });

    expect(buttonFor('ghost').pressed).toBe('mixed');
  });

  it('carries a refusal in the name and the tooltip, and the shortcut in the tooltip', () => {
    const ghost = buttonFor('ghost');

    expect(ghost.refusal).toMatch(/note/i);
    expect(ghost.label).toContain('unavailable');
    expect(ghost.tooltip).toContain('(O)');
    expect(ghost.tooltip).toContain(ghost.refusal ?? '');
  });

  it('shows Select pressed from the entry mode, and gives a popover tool no pressed state', () => {
    expect(buttonFor('select').pressed).toBe('true');
    expect(buttonFor('pen').pressed).toBe('false');
    expect(buttonFor('timeSignature').pressed).toBeNull();
    expect(buttonFor('timeSignature').opensPopover).toBeTrue();
  });

  it('writes a SMuFL glyph as its character, and text as it is', () => {
    expect(buttonFor('quarter').face).toBe(String.fromCodePoint(0xe1d5));
    expect(buttonFor('quarter').smufl).toBeTrue();
    expect(buttonFor('hammerOn').face).toBe('H');
  });
});

describe('ComposerPaletteComponent', () => {
  let fixture: ComponentFixture<ComposerPaletteComponent>;
  let composer: ComposerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerPaletteComponent] }).compileComponents();
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerPaletteComponent);
    fixture.componentRef.setInput('state', composer.state);
    fixture.detectChanges();
  });

  const button = (id: string): HTMLButtonElement => fixture.nativeElement.querySelector(`[data-tool="${id}"]`);

  it('names each button, says pressed, and says refusing with aria-disabled while staying focusable', () => {
    expect(button('quarter').getAttribute('aria-label')).toBe('Quarter note');
    expect(button('quarter').getAttribute('aria-pressed')).toBe('true');
    expect(button('ghost').getAttribute('aria-disabled')).toBe('true');
    expect(button('ghost').disabled).toBeFalse();
    expect(button('clef').getAttribute('aria-pressed')).toBeNull();
  });

  it('asks the page to run a pressed tool, refused or not', () => {
    const pressed: ComposerTool[] = [];
    fixture.componentInstance.toolPressed.subscribe((tool: ComposerTool) => pressed.push(tool));

    button('rest').click();
    button('ghost').click();

    expect(pressed.map(tool => tool.id)).toEqual(['rest', 'ghost']);
  });

  it('opens a popover beside its button', () => {
    fixture.componentRef.setInput('popover', 'clef');
    fixture.detectChanges();

    expect(button('clef').getAttribute('aria-expanded')).toBe('true');
    expect(button('clef').parentElement?.querySelector('app-composer-tool-popover')).not.toBeNull();
  });
});
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-palette/composer-palette.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module './composer-palette.component'`.

**Step 3: Implement**

<!-- apply: create client/src/app/components/composer/components/composer-palette/composer-palette.component.ts -->
```typescript
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ComposerToolPopoverComponent } from '../composer-tool-popover/composer-tool-popover.component';
import { ComposerState } from '../../../../models/composer.model';
import { bindingLabelOf } from '../../../../services/composer-key-bindings';
import { IDLE_TOOL, ToolState, toolStates } from '../../../../services/composer-tool-states';
import { COMPOSER_TOOLS, ComposerTool, PALETTE_GROUPS, PopoverKind, ToolGroup } from '../../../../services/composer-tools';

/** One palette button, as the template draws it. */
export interface PaletteButton {
  tool: ComposerTool;
  /** The glyph's character, or the tool's text. */
  face: string;
  /** Whether `face` is a Bravura glyph. */
  smufl: boolean;
  /** The accessible name: the tool's label, and why it is refusing when it is. */
  label: string;
  /** The label, the shortcut, and any refusal. */
  tooltip: string;
  /** `aria-pressed` for a toggle; null for a tool that is not one. */
  pressed: 'true' | 'false' | 'mixed' | null;
  /** Whether the tool's value is set on the selection, for a popover tool that has no pressed state. */
  hasValue: boolean;
  refusal: string | null;
  opensPopover: boolean;
}

export interface PaletteGroup {
  group: ToolGroup;
  buttons: PaletteButton[];
}

/** Palette tools a press does not toggle: they open a popover, or act once. */
const NOT_TOGGLES: ReadonlySet<string> = new Set([
  'timeSignature', 'keySignature', 'clef', 'section', 'alternateEnding', 'tuplet', 'tripletFeel', 'fixBar', 'insertBar', 'deleteBar', 'natural', 'respell'
]);

const POPOVERS: ReadonlySet<string> = new Set<PopoverKind>(['timeSignature', 'keySignature', 'clef', 'section', 'alternateEnding', 'tuplet', 'tripletFeel']);

function buttonOf(tool: ComposerTool, states: ReadonlyMap<string, ToolState>, state: ComposerState): PaletteButton {
  const isMode = tool.id === 'select' || tool.id === 'pen';
  const toolState = isMode ? { pressed: state.entryMode === tool.id, refusal: null } : states.get(tool.id) ?? IDLE_TOOL;
  const shortcut = isMode ? 'Q toggles Select and Pen' : tool.keys.map(bindingLabelOf).join(' or ');
  const pressed = toolState.pressed === 'mixed' ? 'mixed' : toolState.pressed ? 'true' : 'false';

  return {
    tool,
    face: tool.glyph.kind === 'smufl' ? String.fromCodePoint(tool.glyph.codePoint) : tool.glyph.text,
    smufl: tool.glyph.kind === 'smufl',
    label: toolState.refusal ? `${tool.label}, unavailable: ${toolState.refusal}` : tool.label,
    tooltip: `${tool.label}${shortcut ? ` (${shortcut})` : ''}${toolState.refusal ? ` - unavailable: ${toolState.refusal}` : ''}`,
    pressed: NOT_TOGGLES.has(tool.id) ? null : pressed,
    hasValue: NOT_TOGGLES.has(tool.id) && toolState.pressed !== false,
    refusal: toolState.refusal,
    opensPopover: POPOVERS.has(tool.id)
  };
}

/** The palette's groups and buttons for `state`, from the tool table and `toolStates`. */
export function paletteGroupsOf(state: ComposerState, tools: readonly ComposerTool[] = COMPOSER_TOOLS): PaletteGroup[] {
  const states = toolStates(state.doc, state.anchor, state.cursor);
  return PALETTE_GROUPS.map(group => ({
    group,
    buttons: tools.filter(tool => tool.inPalette && tool.group === group).map(tool => buttonOf(tool, states, state))
  }));
}

/**
 * Every notation tool as a button, in the design's groups (design Part 3, "Palette").
 *
 * Draws from `COMPOSER_TOOLS` and `toolStates`, computed once per state change rather than in the
 * template. A press is handed to the page, which runs the tool with its host exactly as a key press
 * does, so a button and its key cannot differ.
 */
@Component({
  selector: 'app-composer-palette',
  standalone: true,
  imports: [CommonModule, ComposerToolPopoverComponent],
  templateUrl: './composer-palette.component.html',
  styleUrls: ['./composer-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerPaletteComponent implements OnChanges {
  @Input() state: ComposerState | null = null;
  /** The popover open, if any: the page holds it, since a key can open one too. */
  @Input() popover: PopoverKind | null = null;
  @Output() readonly toolPressed = new EventEmitter<ComposerTool>();
  @Output() readonly popoverClosed = new EventEmitter<void>();

  groups: PaletteGroup[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['state']) this.groups = this.state ? paletteGroupsOf(this.state) : [];
  }

  press(button: PaletteButton): void {
    this.toolPressed.emit(button.tool);
  }

  trackByGroup(_index: number, group: PaletteGroup): string {
    return group.group;
  }

  trackByTool(_index: number, button: PaletteButton): string {
    return button.tool.id;
  }
}
```

<!-- apply: create client/src/app/components/composer/components/composer-palette/composer-palette.component.html -->
```html
<nav class="palette" aria-label="Notation tools">
  <section class="group" *ngFor="let group of groups; trackBy: trackByGroup">
    <h2 class="group-heading">{{ group.group }}</h2>
    <div class="buttons">
      <div class="tool-slot" *ngFor="let button of group.buttons; trackBy: trackByTool">
        <!--
          `aria-disabled` rather than `disabled`: a refusing tool keeps its focus and its tooltip, and a
          press still runs the command, which refuses and says why in the status line.
        -->
        <button
          type="button"
          class="tool"
          [class.smufl]="button.smufl"
          [class.on]="button.pressed === 'true' || button.hasValue"
          [class.mixed]="button.pressed === 'mixed'"
          [attr.data-tool]="button.tool.id"
          [attr.aria-label]="button.label"
          [title]="button.tooltip"
          [attr.aria-pressed]="button.pressed"
          [attr.aria-disabled]="button.refusal ? 'true' : null"
          [attr.aria-haspopup]="button.opensPopover ? 'dialog' : null"
          [attr.aria-expanded]="button.opensPopover ? popover === button.tool.id : null"
          (click)="press(button)"
        >{{ button.face }}</button>
        <app-composer-tool-popover
          *ngIf="button.opensPopover && popover === button.tool.id"
          [kind]="popover"
          [state]="state"
          (closed)="popoverClosed.emit()"
        ></app-composer-tool-popover>
      </div>
    </div>
  </section>
</nav>
```

<!-- apply: create client/src/app/components/composer/components/composer-palette/composer-palette.component.scss -->
```scss
// The notation palette: every tool as a button, Bravura glyphs where SMuFL has one.

// alphaTab serves Bravura at /font (angular.json copies node_modules/@coderline/alphatab/dist/font
// there). A @font-face is not encapsulated, so declaring it here registers the family for the page.
@font-face {
  font-family: 'Bravura';
  src: url('/font/Bravura.woff2') format('woff2'), url('/font/Bravura.woff') format('woff');
  font-display: block;
}

:host {
  display: block;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--composer-nav, #2c3e50);
  border-right: 1px solid var(--composer-border, #465666);
}

.palette {
  padding: 0.5rem;
}

.group + .group {
  margin-top: 0.6rem;
}

.group-heading {
  margin: 0 0 0.3rem;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--composer-text-secondary, #bdc3c7);
}

.buttons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.3rem, 1fr));
  gap: 0.25rem;
}

.tool-slot {
  position: relative;
}

.tool {
  width: 100%;
  height: 2.3rem;
  padding: 0;
  overflow: hidden;
  background-color: var(--composer-nav-secondary, #34495e);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  white-space: nowrap;

  &.smufl {
    // Bravura's glyphs sit on the baseline with a tall ascent, so they are drawn larger and nudged
    // down to sit in the middle of the button.
    font-family: 'Bravura', serif;
    font-size: 1.35rem;
    padding-top: 0.55rem;
  }

  &:hover:not([aria-disabled='true']) {
    background-color: var(--composer-accent, #3498db);
  }

  &.on {
    background-color: var(--composer-accent, #3498db);
    border-color: var(--composer-accent-hover, #2980b9);
  }

  &.mixed {
    box-shadow: inset 0 -3px 0 var(--composer-accent, #3498db);
  }

  &[aria-disabled='true'] {
    opacity: 0.45;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--composer-text, #ecf0f1);
    outline-offset: 1px;
  }
}
```

**Step 4: Run it.** Expected: 8 SUCCESS.

**Step 5: Commit**: `feat: The composer palette, drawn from the tool table`.

### Task 3.7: The track strip, with the generated-track controls and their specs

The Tracks panel's rows move to a bottom strip, a row per track: name, remove, and a generated track's
badge, status, Update and Flatten; then the add-track controls - instrument, Add track, and "Add
progression track" (decision 3). The markup keeps every selector and label the M4 specs pin, and the
code moves with it unchanged, comments included. `composer.component.spec.ts` moves with the markup it
tests, to `composer-track-strip.component.spec.ts`: the same tests, now against the strip. Mixer, bar grid
and inspector stay M3.

`ComposerComponent` keeps its old Tracks panel until Task 3.10 replaces its template, so this task
compiles and the suite stays green on its own.

**Files:**
- Create: `client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts`,
  `.html`, `.scss`
- Move: `client/src/app/components/composer/composer.component.spec.ts` to
  `client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`

**Step 1: Move the spec and point it at the strip.** The move:

<!-- apply: move client/src/app/components/composer/composer.component.spec.ts client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->

```bash
git mv client/src/app/components/composer/composer.component.spec.ts client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts
```

Its imports:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerComponent } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { ComposerService } from '../../services/composer.service';
import { ProgressionService } from '../../services/progression.service';
import { TrackDoc } from '../../models/composer.model';

/**
 * The Tracks panel, and the four controls a generated track adds to it.
```

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerTrackStripComponent } from './composer-track-strip.component';
import { ComposerService } from '../../../../services/composer.service';
import { ProgressionService } from '../../../../services/progression.service';
import { TrackDoc } from '../../../../models/composer.model';

/**
 * The track strip, and the four controls a generated track adds to a row.
```

The stubs are no longer needed - the strip has no score or library child:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
 * ## The two children are stubbed
 *
 * `ComposerScoreComponent` owns the alphaTab instance and engraves on
 * `AfterViewInit`; `ComposerLibraryPanelComponent` reads IndexedDB. Neither is
 * involved in a track row, and building either for real would make every test
 * in this file depend on a renderer and a database. `overrideComponent` swaps
 * both for empty standalone components wearing the same selectors, so the
 * template still compiles against known elements rather than a loosened schema.
 */
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {}

@Component({ selector: 'app-composer-library-panel', standalone: true, template: '' })
class StubLibraryPanelComponent {}

describe('ComposerComponent tracks panel', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let component: ComposerComponent;
```

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
 * ## Where these came from
 *
 * These were `composer.component.spec.ts` until M2 moved the Tracks panel out of
 * the page and into this strip. They moved with the markup unchanged, so every
 * selector, status string and label pattern M4 pinned is still pinned; only the
 * fixture changed. The strip has no alphaTab or IndexedDB child, so nothing is
 * stubbed.
 */
describe('ComposerTrackStripComponent', () => {
  let fixture: ComponentFixture<ComposerTrackStripComponent>;
  let component: ComposerTrackStripComponent;
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
    await TestBed.configureTestingModule({
      imports: [ComposerComponent]
    })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    composer = TestBed.inject(ComposerService);
    progression = TestBed.inject(ProgressionService);

    fixture = TestBed.createComponent(ComposerComponent);
```

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```typescript
    await TestBed.configureTestingModule({
      imports: [ComposerTrackStripComponent]
    }).compileComponents();

    composer = TestBed.inject(ComposerService);
    progression = TestBed.inject(ProgressionService);

    fixture = TestBed.createComponent(ComposerTrackStripComponent);
```

**Step 2: Run** with
`--include=src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`.
Expected: a compile error, `TS2307: Cannot find module './composer-track-strip.component'`.

**Step 3: Implement.** The strip carries over, from `composer.component.ts`, the instrument options,
`addTrack`, `removeTrack`, `selectTrack`, every generated-track method and the section comment above
them, and `trackByIndex`:

<!-- apply: create client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```typescript
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ComposerState, TrackDoc } from '../../../../models/composer.model';
import { ProgressionState } from '../../../../models/progression.model';
import { ComposerService } from '../../../../services/composer.service';
import { ProgressionService } from '../../../../services/progression.service';
import {
  GeneratedTrackState,
  generatedTrackState,
  progressionLabel,
  progressionTrack
} from '../../../../services/progression-track';

interface InstrumentOption {
  name: string;
  program: number;
  fretted: boolean;
}

/**
 * How one generated row stands to the progression that is open.
 *
 * `GeneratedTrackState` answers this for a score and a progression as a *pair*,
 * which is one answer short of what a row has to draw: it splits `'stale'` into
 * neither of its two halves, and it has no word at all for a row built from
 * some progression other than the one open, because from its point of view that
 * score holds nothing of this progression. This is that answer widened by the
 * two facts the row knows and the pair does not - which marker this row carries,
 * and what kind of source it names.
 *
 * Still derived from `generatedTrackState` rather than computed beside it. The
 * splitting is a *reading* of the one answer, not a second opinion about it, so
 * the enabled/refused line stays where every other caller reads it.
 */
type GeneratedRowState = 'current' | 'behind' | 'moved' | 'foreign';

/**
 * The track strip along the bottom of the composer: a row per track, and adding one.
 *
 * Moved out of `ComposerComponent` in M2 (design Part 3, "Track strip"), with the progression track's
 * badge, status, Update and Flatten and every comment that argues them, unchanged. The mixer - mute,
 * solo, volume, pan - and the bar grid are M3's. The page asks it to add a track from the keyboard, so
 * `addTrack` uses the instrument chosen here either way.
 */
@Component({
  selector: 'app-composer-track-strip',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-track-strip.component.html',
  styleUrls: ['./composer-track-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerTrackStripComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  state: ComposerState | null = null;

  /**
   * The progression this page can send, or null before the first publish.
   *
   * Held rather than read on demand because the rows ask about it on every
   * change-detection pass - the badge, the row's status, whether Update and the
   * strip's own send button are refusing, and all four of their labels come from
   * it - and `OnPush` needs the answer to change in step with the subscription
   * that delivered it.
   */
  progressionState: ProgressionState | null = null;

  readonly instruments: InstrumentOption[] = [
    { name: 'Acoustic Guitar', program: 25, fretted: true },
    { name: 'Electric Guitar', program: 27, fretted: true },
    { name: 'Bass', program: 33, fretted: true },
    { name: 'Piano', program: 0, fretted: false },
    { name: 'Strings', program: 48, fretted: false },
    { name: 'Flute', program: 73, fretted: false },
    { name: 'Trumpet', program: 56, fretted: false }
  ];

  newTrackInstrument: InstrumentOption = this.instruments[3];

  constructor(
    private readonly composer: ComposerService,
    private readonly progression: ProgressionService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.cdr.markForCheck();
      });

    // The `markForCheck` here is not held by the suite, and saying so is
    // cheaper than a test that would pin it. `fixture.detectChanges()` refreshes
    // the fixture's own view whether or not it was marked dirty, so deleting
    // this line leaves every test in the strip's spec green while the rows stop
    // repainting in the app. What keeps the risk small is that the two pages are
    // separate routes: a progression cannot be edited while this component is
    // alive today, so the only emission it currently sees is the synchronous
    // first one, which arrives before the first render anyway. A progression
    // editable beside the score - a split view, or the library this feature is
    // heading for - is what would make the line load-bearing, and is when it is
    // worth a test that drives change detection itself.
    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.progressionState = state;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Adds a track of the chosen instrument. The keyboard's Ctrl+Shift+Insert comes here too. */
  addTrack(): void {
    const instrument = this.newTrackInstrument;
    this.composer.addTrack(instrument.name, instrument.program, instrument.fretted);
  }

  removeTrack(index: number): void {
    this.composer.removeTrack(index);
  }

  selectTrack(index: number): void {
    this.composer.setCursor({ trackIndex: index, staffIndex: 0 });
  }

  // -------------------------------------------------------------------------
  // The progression's track
  //
  // ## Where the state is said, and what the two buttons do about it
  //
  // Three facts settle the shape of everything below, and the first two were
  // found by review rather than by design.
  //
  // A `disabled` button hides its own explanation from nearly everybody. It is
  // out of the tab order, so its `aria-label` cannot be reached by focus, and
  // browsers suppress `title` on it - so the sentence explaining *why* Update
  // is greyed out reached only a screen-reader user browsing the page outside
  // focus order. That is the smallest audience of the three who need it.
  //
  // And a refusal one button makes is not a refusal the strip makes. "Add
  // progression track" is the same `sendProgression` call, so pressing it on an
  // up-to-date track committed a byte-identical merge - an undo entry and a
  // dirty document for no visible change - which is exactly what the Update
  // beside it was greyed out to prevent.
  //
  // So: **the state is said on the row, in words, where nothing has to be
  // focused to read it**; both buttons refuse on one reading of that state; and
  // both refuse with `aria-disabled` plus an early return rather than with
  // `disabled`, which keeps them focusable, keeps the tooltip, and leaves the
  // reason reachable by every route. The early return is what makes the refusal
  // real - `aria-disabled` is advisory, so a handler that ignored it would let
  // a click through the announcement.
  //
  // The alternative considered was relabelling the strip's button ("Update
  // progression track" when the score already holds it). It was rejected: the
  // word on a button is what a speech-input user says to press it, so a caption
  // that changes underneath the state is a control whose name moves, and the
  // row already carries an Update whose whole job is that case.
  // -------------------------------------------------------------------------

  /**
   * What this score holds of the progression that is open, or null before the
   * first publish.
   *
   * The single reading every control below is derived from: whether either
   * button refuses, what each of the four labels says, and what the row's
   * status shows. Deriving them rather than each asking `generatedTrackState`
   * on its own terms is what stops the strip refusing a press for one reason
   * and explaining it with another.
   *
   * Null is the pre-publish state and it is not reachable today - `getState()`
   * is a `BehaviorSubject` and emits synchronously inside `ngOnInit`, so the
   * field is set before the first render. It is a branch rather than a `!`
   * because a page that could be opened without a progression is the cheaper
   * thing to keep true than to prove impossible.
   */
  private sendState(): GeneratedTrackState | null {
    if (!this.state || !this.progressionState) return null;

    return generatedTrackState(this.state.doc, this.progressionState.doc);
  }

  /**
   * Whether "Add progression track" would change the score.
   *
   * `'current'` is the one answer that refuses, and it refuses for the reason
   * the section comment gives: the merge would be byte-identical, so the press
   * would spend an undo entry and the dirty flag on nothing. `'absent'` adds and
   * `'stale'` refreshes, and both are real changes.
   */
  canAddProgressionTrack(): boolean {
    const state = this.sendState();

    return state !== null && state !== 'current';
  }

  /**
   * What the strip's send button is offering, in a sentence that starts with
   * the words printed on it.
   *
   * Leading with the visible label is WCAG 2.1 SC 2.5.3 and not house style: an
   * accessible name that does not contain the visible one is a control a
   * speech-input user cannot address by the name they can see. The old label -
   * "Add the current progression to this score as a track" - shared no phrase
   * with "Add progression track", so saying the words on the button matched
   * nothing.
   */
  addProgressionTrackLabel(): string {
    const state = this.progressionState;
    if (!state) return 'Add progression track: there is no progression to add yet';

    const from = progressionLabel(state.doc.name);

    switch (this.sendState()) {
      case 'stale':
        return `Add progression track: refreshes the copy of ${from} this score already holds`;
      case 'current':
        return `Add progression track: this score already holds ${from} as it stands`;
      default:
        return `Add progression track: puts ${from} into this score as a track`;
    }
  }

  /**
   * Puts the progression into the score, or refreshes the copy already in it.
   *
   * "Add progression track" and a row's Update are one call, because
   * `sendProgression` is one command: the merge appends when the score holds
   * nothing of this progression and replaces it in place when it does, so the
   * difference is a fact about the score rather than a choice this component
   * makes. The progression page's Send is the third button over the same call -
   * the push is where the user made the thing, the pull is where it will
   * appear, and the design doc settles that under "Where the controls are".
   *
   * The guard is `canAddProgressionTrack` and not a null check, because
   * `aria-disabled` only says a control is refusing - it does not stop the
   * click, and the handler is where the refusal is actually made.
   */
  addProgressionTrack(): void {
    // The refusal is the second half; the first is only how a null field
    // becomes a `ProgressionState` below, since `canAddProgressionTrack`
    // already answers false for it.
    const state = this.progressionState;
    if (!state || !this.canAddProgressionTrack()) return;

    // Projected fresh on every press and not retained. `sendProgression` states
    // both of the preconditions this expression satisfies: the merged score
    // shares bar objects with the projection, so a kept copy edited afterwards
    // would be writing into a committed score behind undo's back; and the
    // track has to be barred in the *score's* meter, because it will share the
    // score's bar lines - a mismatch throws rather than engraving music that
    // disagrees with the lines drawn over it. `scoreMeter` is the service's own
    // name for the meter its guard asks about, so the two cannot answer
    // differently-shaped questions.
    //
    // The scale comes from the published state because `progressionTrack` is
    // pure and cannot resolve `key.scaleId` itself. Empty when the id resolves
    // to nothing, which spells every note from the key's preference; the
    // progression page's own export does the same for the same reason.
    this.composer.sendProgression(
      progressionTrack(
        state.doc,
        state.keyScale ? state.keyScale.intervals : [],
        this.composer.scoreMeter
      )
    );
  }

  /**
   * Update, which is a Send into a score that already holds the track.
   *
   * Almost an alias, and deliberately little more: the button is named for what
   * the user is doing rather than for what the service calls it, and a second
   * method with a body of its own would be a second place for the two to drift.
   *
   * ## Why it takes no track when everything beside it does
   *
   * `flattenGeneratedTrack` takes an index, `canUpdate` and the labels take a
   * track, and this takes nothing - which is correct only because of an
   * invariant worth naming rather than rediscovering. **At most one track in a
   * score can carry the open progression's id**: `mergeGeneratedTrack` matches
   * on `progressionId` and replaces in place, so a second Send never appends a
   * second copy. A row whose marker names some *other* progression is refused
   * below rather than updated. So there is only ever one row this could mean,
   * and passing the row in would be passing in a value the call could not use.
   *
   * The day that stops being true - a score holding two progressions' tracks
   * with the second one open, which is what a progression library brings - this
   * has to take the track and send *that* row's progression, or it becomes a
   * wrong-row update: the press would refresh whichever track matches the open
   * progression rather than the one whose button was pressed.
   *
   * The refusal is `'stale'` and not "anything but current", which matters for
   * exactly that case: a row built from a progression that is not open reads
   * `'absent'` here, and falling through to the send would *append* a second
   * generated track rather than refuse.
   */
  updateGeneratedTrack(): void {
    if (this.sendState() !== 'stale') return;

    this.addProgressionTrack();
  }

  /** Hands the track over to the user, keeping the music and dropping the link. */
  flattenGeneratedTrack(index: number): void {
    this.composer.flattenTrack(index);
  }

  /**
   * How this row stands to the progression that is open.
   *
   * The one branch point the row has: the status on screen, whether Update
   * refuses and what its label says are all this answer said three ways, so
   * they cannot disagree about which of them the user is looking at.
   *
   * `generatedTrackState` is still the function that decides *stale or not* -
   * it is the one the badge, the edit gate and the service's own refusals all
   * read, and answering that here would be a second opinion about it. What this
   * adds is the two distinctions it does not carry:
   *
   *  - **Which row.** The state is a fact about a score and a progression as a
   *    pair, so a score holding some *other* progression's track would read that
   *    track's freshness off this row. `'foreign'` is that case named, and it is
   *    a refusal rather than a claim: whether that track matches its own
   *    progression is a question this page has no document to answer.
   *  - **Which half of stale.** `'stale'` is one answer to two questions, and
   *    `GeneratedOrigin.source` is where they stay apart - which is the whole
   *    reason the marker holds a union rather than a revision and a flag. A
   *    moved revision means the progression changed; `'diverged'` means a
   *    score-wide bar edit moved this track while the progression stood still.
   *    Telling a user the second was the first is a claim about a document they
   *    did not touch.
   *
   * A track that is both - a bar inserted and then the progression edited -
   * reads `'moved'`, because the marker was restated as `'diverged'` and no
   * longer holds a revision to compare. Both are stale and one Update fixes
   * both, so the cost is the less complete of two true sentences.
   */
  private generatedStatus(track: TrackDoc): GeneratedRowState {
    const marker = track.generated;
    if (!marker || marker.progressionId !== this.progressionState?.doc.id) return 'foreign';
    if (marker.source.kind === 'diverged') return 'moved';

    return this.sendState() === 'stale' ? 'behind' : 'current';
  }

  /**
   * That state in the fewest true words, drawn beside the badge.
   *
   * On screen because a `disabled` control's explanation is unreachable by
   * focus and its tooltip is suppressed - see the section comment. The row is
   * where the state can be read without pressing or focusing anything, which is
   * also what lets the labels below stay a sentence each rather than the only
   * copy of the information.
   *
   * Short because it sits under a name the user is scanning for. "behind the
   * progression" and "moved by a score edit" are the two halves of stale in the
   * plainest words that distinguish them.
   */
  generatedStatusLabel(track: TrackDoc): string {
    switch (this.generatedStatus(track)) {
      case 'behind':
        return 'behind the progression';
      case 'moved':
        return 'moved by a score edit';
      case 'foreign':
        return 'progression not open';
      default:
        return 'up to date';
    }
  }

  /** Whether this row's Update would change anything. Refuses on the other three. */
  canUpdate(track: TrackDoc): boolean {
    const state = this.generatedStatus(track);

    return state === 'behind' || state === 'moved';
  }

  /**
   * What Update is offering, in a sentence.
   *
   * The badge and the status sit *beside* this button rather than inside it,
   * and nothing carries a neighbouring element into a button's accessible name,
   * so the label has to name the track and the reason itself. Which track,
   * because a strip of rows offers one of these per row; and why, because a
   * refusal that does not say why is a greyed-out control and nothing more.
   *
   * Every answer leads with "Update", the word printed on the button. That is
   * WCAG 2.1 SC 2.5.3: an accessible name that drops the visible one leaves a
   * speech-input user saying what they can see and matching nothing. It applies
   * to the refusals too, now that they are focusable.
   *
   * Four answers, one per state, and the two halves of stale are two of them.
   * The `'foreign'` sentence is the one the app cannot currently produce - see
   * `openAnotherProgression` in the spec for what would - and it is still not
   * "up to date", because that would be a claim this page has no document to
   * check.
   */
  updateLabel(track: TrackDoc): string {
    const from = this.sourceOf(track);

    switch (this.generatedStatus(track)) {
      case 'behind':
        return `Update ${track.name} from ${from}, which has changed since this track was `
          + 'written';
      case 'moved':
        return `Update ${track.name} from ${from}, because a score edit has moved this track `
          + 'since it was written';
      case 'foreign':
        return `Update ${track.name}: ${from} is not the one that is open, so this track `
          + 'cannot be updated here';
      default:
        return `Update ${track.name}: it already matches ${from}`;
    }
  }

  /** What Flatten is offering, named the same way and for the same reason. */
  flattenLabel(track: TrackDoc): string {
    return `Flatten ${track.name}, detaching it from ${this.sourceOf(track)} and keeping the music`;
  }

  /**
   * How a label refers to the progression a track came from.
   *
   * Two names that are usually one string. The row is labelled with the track's
   * name and the marker carries the progression's, and they start out equal
   * because nothing renames a progression - so naming both said "it already
   * matches the progression Progression", which is what nearly every user
   * heard. They are still two different facts, and they come apart the moment
   * either end is renamed, so the fix is to stop saying the second aloud when
   * it would only repeat the first rather than to drop it from the sentence.
   *
   * Every caller reads this as a noun phrase mid-sentence, which is why the
   * article is in here and not at the call sites: "the progression it came
   * from" and "the progression Verse" have to substitute for one another in
   * all five, including `'foreign'`, where the phrase is the subject.
   */
  private sourceOf(track: TrackDoc): string {
    const from = track.generated?.progressionName ?? '';
    return from === track.name ? 'the progression it came from' : `the progression ${from}`;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
```

<!-- apply: create client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
<section class="track-strip" aria-label="Tracks" *ngIf="state as s">
  <ul class="track-list">
    <li
      *ngFor="let track of s.doc.tracks; let i = index; trackBy: trackByIndex"
      class="track-item"
      [class.selected]="s.cursor.trackIndex === i"
      (click)="selectTrack(i)"
    >
      <span class="track-swatch" [style.background-color]="track.color"></span>
      <span class="track-name">{{ track.name }}</span>

      <!--
        The badge says the marker's own copy of the name, not the row's.
        `mergeGeneratedTrack` keeps whatever the track is already called across
        an Update so a rename survives, which leaves `track.name` free to be the
        user's word for the row while `generated.progressionName` stays the
        progression's.

        The status beside it is the same state Update refuses on, said where
        nothing has to be focused to read it - a `disabled` control's own
        explanation is unreachable by focus and its tooltip is suppressed, so a
        label was the wrong and only place to keep it.
      -->
      <ng-container *ngIf="track.generated as origin">
        <span class="track-origin">
          <span class="track-badge">From {{ origin.progressionName }}</span>
          <span class="track-status" [class.is-stale]="canUpdate(track)">{{ generatedStatusLabel(track) }}</span>
        </span>
        <span class="track-generated">
          <!--
            `aria-disabled` and not `disabled`: the button keeps its place in
            the tab order and keeps its tooltip, so the sentence saying why it
            is refusing stays reachable. It only *says* it is refusing, so
            `updateGeneratedTrack` makes the refusal itself.

            `handler(); $event.stopPropagation()` runs the handler first, so a
            throw would skip the stop and the click would fall through to the
            row and move the caret. Nothing in either handler throws today -
            the one guard that does is `sendProgression`'s meter check, and it
            is handed `this.composer.scoreMeter`, which is the same meter it
            compares against.
          -->
          <button
            class="text-btn track-update"
            (click)="updateGeneratedTrack(); $event.stopPropagation()"
            [attr.aria-disabled]="!canUpdate(track)"
            [attr.aria-label]="updateLabel(track)"
            [title]="updateLabel(track)"
          >Update</button>
          <button
            class="text-btn track-flatten"
            (click)="flattenGeneratedTrack(i); $event.stopPropagation()"
            [attr.aria-label]="flattenLabel(track)"
            [title]="flattenLabel(track)"
          >Flatten</button>
        </span>
      </ng-container>

      <button
        class="track-remove"
        (click)="removeTrack(i); $event.stopPropagation()"
        [disabled]="s.doc.tracks.length <= 1"
        [attr.aria-label]="'Remove ' + track.name"
        title="Remove track"
      >×</button>
    </li>
  </ul>

  <div class="add-track">
    <select [(ngModel)]="newTrackInstrument" aria-label="Instrument for new track">
      <option *ngFor="let inst of instruments" [ngValue]="inst">{{ inst.name }}</option>
    </select>
    <button class="text-btn" (click)="addTrack()">Add track</button>
    <!--
      The pull half of the same service call the progression page's Send is the
      push half of. Pressed with the progression already in the score it is an
      Update, because the merge matches on the progression's id rather than
      appending - and it refuses on the same reading the rows' Update refuses
      on, so the strip cannot do from here what the button in the row is
      greyed out to prevent.

      The label leads with the words printed on the button (WCAG 2.1 SC 2.5.3);
      the caption itself never changes, because the word on a control is what a
      speech-input user says to press it.
    -->
    <button
      class="text-btn add-progression-track"
      (click)="addProgressionTrack()"
      [attr.aria-disabled]="!canAddProgressionTrack()"
      [attr.aria-label]="addProgressionTrackLabel()"
      [title]="addProgressionTrackLabel()"
    >Add progression track</button>
  </div>
</section>
```

<!-- apply: create client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.scss -->
```scss
// The track strip: a row per track along the bottom of the composer.

:host {
  display: block;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
}

.track-strip {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem 0.6rem;
}

.track-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.track-item {
  display: flex;
  align-items: center;
  // Wraps rather than squeezes: on a narrow page the badge, status and buttons go under the name
  // rather than eating it, since the name is what a user scans the strip for.
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;

  &:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }

  &.selected {
    background-color: rgba(52, 152, 219, 0.25);
    box-shadow: inset 2px 0 0 var(--composer-accent, #3498db);
  }
}

.track-swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  flex-shrink: 0;
}

.track-name {
  flex: 0 1 14rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// The badge and the status as one phrase. `min-width: 0` is load-bearing: a flex item's automatic
// minimum is its content, and the badge does not wrap, so without it a long progression name widens the
// row past the strip.
.track-origin {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.35rem;
  min-width: 0;
}

.track-badge {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--composer-text-secondary, #bdc3c7);
  background-color: rgba(52, 152, 219, 0.18);
  border: 1px solid rgba(52, 152, 219, 0.5);
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
}

// Brightness rather than hue marks a stale row: the words already say which state it is, and the
// accent blue fails contrast against a selected row, whose tint is that same blue.
.track-status {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--composer-text-secondary, #bdc3c7);

  &.is-stale {
    color: var(--composer-text, #ecf0f1);
  }
}

.track-generated {
  display: flex;
  gap: 0.3rem;
}

.track-remove {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--composer-text-secondary, #bdc3c7);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.2rem;

  &:hover:not(:disabled) {
    color: var(--composer-error, #e74c3c);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.add-track {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;

  select {
    padding: 0.3rem;
    background-color: var(--composer-nav-secondary, #34495e);
    border: 1px solid var(--composer-border, #465666);
    border-radius: 4px;
    color: var(--composer-text, #ecf0f1);
  }
}

.text-btn {
  background-color: var(--composer-nav-secondary, #34495e);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
  cursor: pointer;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;

  &:hover:not([aria-disabled='true']) {
    background-color: var(--composer-accent, #3498db);
  }

  &[aria-disabled='true'] {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
```

**Step 4: Run** the strip's spec. Expected: all SUCCESS - every test `composer.component.spec.ts` held.

**Step 5: Commit**

```bash
git add client/src/app/components/composer
git commit -m "refactor: Move the tracks panel and its specs into a bottom track strip" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3.8: Library and Export as top-bar menus, and the saved list in a drawer

The library panel moves into the top bar: a Library menu (Save, Save as copy, Saved compositions…),
an Export menu (Guitar Pro, alphaTex, MIDI), and the saved list in a drawer. Menus and drawer are
hidden with CSS, not `*ngIf` (decision 20), and the panel's `role="alert"` region and its polite status
region sit outside them, always rendered: a region inside a `display: none` menu is out of the
accessibility tree, and announcing into it would fail silently.

Returning focus to Save now opens the Library menu first, since a button inside a hidden menu cannot take
focus. A press of Export or Load closes what it was pressed in.

**Files:**
- Modify: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts`
- Replace: `composer-library-panel.component.html`, `composer-library-panel.component.scss`
- Test: `client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts`

**Step 1: Failing specs.** Add to the panel spec, after the `with nothing linked` block:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
  describe('with a generated track linked', () => {
    beforeEach(() => link('Verse'));
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```typescript
  /**
   * Menus and a drawer in the top bar, hidden with CSS rather than removed - and the announced regions
   * outside them, since a region inside a hidden menu is out of the accessibility tree.
   */
  describe('as top-bar menus', () => {
    it('keeps both menus and the drawer in the page while closed', () => {
      const menus: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.menu-panel'));
      const drawer: HTMLElement = fixture.nativeElement.querySelector('.library-drawer');

      expect(menus.length).toBe(2);
      expect(menus.every(menu => getComputedStyle(menu).display === 'none')).toBeTrue();
      expect(drawer.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps the announced regions outside the menus and the drawer', () => {
      const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
      const polite: HTMLElement = fixture.nativeElement.querySelector('[aria-live="polite"]');

      expect(alert.closest('.menu-panel, .library-drawer')).toBeNull();
      expect(polite.closest('.menu-panel, .library-drawer')).toBeNull();
    });

    it('opens a menu from its button, and the saved list in a drawer', () => {
      (fixture.nativeElement.querySelector('[aria-controls="composer-library-menu"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const library: HTMLElement = fixture.nativeElement.querySelector('#composer-library-menu');
      expect(getComputedStyle(library).display).not.toBe('none');

      (fixture.nativeElement.querySelector('.open-drawer') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.library-drawer').getAttribute('aria-hidden')).toBe('false');
      expect(panel.libraryMenuOpen).toBeFalse();
    });

    it('closes the Export menu when an export is chosen', () => {
      panel.toggleExportMenu();

      panel.exportMidi();

      expect(panel.exportMenuOpen).toBeFalse();
    });
  });

  describe('with a generated track linked', () => {
    beforeEach(() => link('Verse'));
```

**Step 2: Run** the panel spec. Expected: compile errors,
`TS2339: Property 'libraryMenuOpen' does not exist on type 'ComposerLibraryPanelComponent'.` and the same
for `toggleExportMenu` and `exportMenuOpen`.

**Step 3: Implement.** In the panel's class, the menu state after `pendingSave`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  /** The offer or report currently occupying the announced region. */
  pendingSave: PendingSave | null = null;
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  /** The offer or report currently occupying the announced region. */
  pendingSave: PendingSave | null = null;

  /**
   * Which of the top bar's menus is open, and whether the saved list's drawer is. Presentation only:
   * the three are hidden with CSS rather than removed, so the announced regions beside them stay in the
   * accessibility tree whichever is open.
   */
  libraryMenuOpen = false;
  exportMenuOpen = false;
  drawerOpen = false;
```

The toggles, before `save`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  // -------------------------------------------------------------------------
  // Save / load
  // -------------------------------------------------------------------------
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  // -------------------------------------------------------------------------
  // Menus and drawer
  // -------------------------------------------------------------------------

  toggleLibraryMenu(): void {
    this.libraryMenuOpen = !this.libraryMenuOpen;
    this.exportMenuOpen = false;
  }

  toggleExportMenu(): void {
    this.exportMenuOpen = !this.exportMenuOpen;
    this.libraryMenuOpen = false;
  }

  /** Opens the saved list, closing the menu it was opened from. */
  openDrawer(): void {
    this.drawerOpen = true;
    this.libraryMenuOpen = false;
  }

  closeDrawer(): void {
    this.drawerOpen = false;
  }

  // -------------------------------------------------------------------------
  // Save / load
  // -------------------------------------------------------------------------
```

Focus returns to Save inside an open menu:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  private returnFocusToSave(): void {
    this.cdr.detectChanges();
    this.saveButton?.nativeElement.focus();
  }
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  private returnFocusToSave(): void {
    // Save lives in the Library menu, and a button in a hidden menu cannot take focus.
    this.libraryMenuOpen = true;
    this.cdr.detectChanges();
    this.saveButton?.nativeElement.focus();
  }
```

A load closes the drawer, and an export its menu:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
      this.composer.replaceDocument(this.mapper.toDoc(parsed.score), true);
      this.currentId = id;
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
      this.composer.replaceDocument(this.mapper.toDoc(parsed.score), true);
      this.currentId = id;
      this.drawerOpen = false;
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportGuitarPro(): void {
    if (!this.state) return;
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportGuitarPro(): void {
    this.exportMenuOpen = false;
    if (!this.state) return;
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportAlphaTex(): void {
    if (!this.state) return;
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportAlphaTex(): void {
    this.exportMenuOpen = false;
    if (!this.state) return;
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportMidi(): void {
    if (!this.state) return;
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
  exportMidi(): void {
    this.exportMenuOpen = false;
    if (!this.state) return;
```

The class comment says where it lives now:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
/**
 * Save, load and export for the composer.
 *
 * Kept out of ComposerComponent so neither file outgrows the project's
 * 1000-line guideline. Every dependency is a root service, so this needs no
 * inputs or outputs.
 */
```

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```typescript
/**
 * Save, load and export for the composer: the top bar's Library and Export menus, and the saved list
 * in a drawer.
 *
 * Kept out of ComposerComponent so neither file outgrows the project's 1000-line guideline. Every
 * dependency is a root service, so this needs no inputs or outputs; the keyboard's Ctrl+S reaches
 * `save` through `ComposerSaveRequests`.
 */
```

Replace the template:

<!-- apply: create client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html -->
```html
<div class="library-panel">
  <!--
    The menus and the drawer are hidden with CSS, never removed: see the regions below for why nothing
    announced may live inside them.
  -->
  <div class="menu">
    <button
      type="button"
      class="text-btn menu-toggle"
      aria-controls="composer-library-menu"
      [attr.aria-expanded]="libraryMenuOpen"
      (click)="toggleLibraryMenu()"
    >Library</button>
    <div id="composer-library-menu" class="menu-panel" [class.open]="libraryMenuOpen" role="group" aria-label="Library">
      <div class="save-actions">
        <button class="text-btn" #saveButton (click)="save()">
          {{ currentId ? 'Save' : 'Save to library' }}
        </button>
        <button class="text-btn" (click)="save(true)" *ngIf="currentId">Save as copy</button>
        <button class="text-btn open-drawer" (click)="openDrawer()">Saved compositions…</button>
      </div>
    </div>
  </div>

  <div class="menu">
    <button
      type="button"
      class="text-btn menu-toggle"
      aria-controls="composer-export-menu"
      [attr.aria-expanded]="exportMenuOpen"
      (click)="toggleExportMenu()"
    >Export</button>
    <div id="composer-export-menu" class="menu-panel" [class.open]="exportMenuOpen" role="group" aria-label="Export">
      <div class="export-actions">
        <button class="text-btn" (click)="exportGuitarPro()" title="Guitar Pro 7 file">Guitar Pro (.gp)</button>
        <button class="text-btn" (click)="exportAlphaTex()" title="Plain alphaTex source">alphaTex</button>
        <button class="text-btn" (click)="exportMidi()" title="Standard MIDI file">MIDI</button>
      </div>
    </div>
  </div>

  <!--
    Save stays pressable and the refusal answers the press, rather than Save
    being disabled with the reason sitting beside it. A disabled button is out
    of the tab order, so a reason hung off it with aria-describedby is attached
    to something a keyboard user never lands on. role="alert" announces the
    refusal when it appears, and the offer is a real button inside the same
    region, so hearing the reason and reaching the remedy are one move.

    The region itself is always in the DOM and only its contents come and go. A
    node inserted with role="alert" already on it is the documented flake case:
    the reliable pattern is a live region that was in the accessibility tree
    before its content changed. Neither `hidden` nor `display: none` would do
    for the empty state, both being ways of taking the node back out of the
    tree - so the empty region simply has no content and no chrome, which
    collapses it to nothing without removing it. The chrome arrives with the
    content, on `.showing`.

    It sits outside both menus and the drawer for the same reason: they are
    hidden with `display: none` while closed, which would take it out of the
    tree with them.
  -->
  <div class="save-blocked" role="alert" [class.showing]="pendingSave">
    <ng-container *ngIf="pendingSave as pending">
      <p class="save-blocked-reason">{{ pending.reason }}</p>
      <div class="save-blocked-actions">
        <!--
          Once the flatten has committed there is nothing left to flatten, so
          the offer goes and the region is a report rather than a question.
        -->
        <button class="text-btn" *ngIf="!pending.flattened" (click)="flattenAndSave()">
          Flatten and save
        </button>
        <button class="text-btn" (click)="dismissSaveBlock()">
          {{ pending.flattened ? 'Dismiss' : 'Keep the link' }}
        </button>
      </div>
    </ng-container>
  </div>

  <!--
    Announced for the same reason the refusal is, and always present for the
    same reason its region is. Without this a keyboard user hears the objection
    to the press and then nothing at all when the retry works.
  -->
  <div class="status-region" aria-live="polite">
    <p class="status" *ngIf="statusMessage">{{ statusMessage }}</p>
    <p class="status error" *ngIf="errorMessage">{{ errorMessage }}</p>
  </div>

  <aside class="library-drawer" [class.open]="drawerOpen" [attr.aria-hidden]="!drawerOpen" aria-label="Saved compositions">
    <header class="drawer-header">
      <h2 class="panel-heading">Saved compositions</h2>
      <button type="button" class="drawer-close" aria-label="Close saved compositions" (click)="closeDrawer()">×</button>
    </header>

    <ul class="composition-list" *ngIf="entries.length > 0; else emptyLibrary">
      <li
        *ngFor="let entry of entries; trackBy: trackById"
        class="composition-item"
        [class.current]="entry.id === currentId"
        (click)="load(entry.id)"
        [title]="'Load ' + entry.title"
      >
        <span class="composition-title">{{ entry.title }}</span>
        <span class="composition-meta">
          {{ entry.trackCount }} track{{ entry.trackCount === 1 ? '' : 's' }} ·
          {{ entry.barCount }} bar{{ entry.barCount === 1 ? '' : 's' }}
        </span>
        <button
          class="composition-remove"
          (click)="remove(entry.id, entry.title, $event)"
          title="Delete composition"
        >×</button>
      </li>
    </ul>

    <ng-template #emptyLibrary>
      <p class="hint">Nothing saved yet.</p>
    </ng-template>
  </aside>
</div>
```

Replace the styles:

<!-- apply: create client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.scss -->
```scss
// Library and Export menus in the composer's top bar, and the saved list in a drawer.
//
// Colours are the page host's custom properties, with the composer's values as fallbacks for the
// component's own spec, which has no page host.

:host {
  display: block;
}

.library-panel {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.menu {
  position: relative;
}

// Hidden with `display: none` while closed, never removed - and so nothing announced lives inside.
.menu-panel {
  display: none;
  position: absolute;
  top: calc(100% + 0.3rem);
  right: 0;
  z-index: 60;
  min-width: 12rem;
  padding: 0.4rem;
  background-color: var(--composer-nav, #2c3e50);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);

  &.open {
    display: block;
  }
}

.panel-heading {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--composer-text-secondary, #bdc3c7);
}

.text-btn {
  background-color: var(--composer-nav-secondary, #34495e);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
  cursor: pointer;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  text-align: left;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: var(--composer-accent, #3498db);
    border-color: var(--composer-accent-hover, #2980b9);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.save-actions,
.export-actions {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

// The refusal, and the offer that resolves it, dropped below the top bar. The element is in the DOM
// whether or not there is anything to say; the chrome is what toggles, so an empty region takes no space.
.save-blocked {
  position: absolute;
  top: calc(100% + 0.3rem);
  right: 0;
  z-index: 70;
  width: min(26rem, 80vw);

  &.showing {
    padding: 0.6rem;
    border: 1px solid var(--composer-warning, #f39c12);
    border-radius: 4px;
    background-color: var(--composer-nav, #2c3e50);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }

  .save-blocked-reason {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--composer-text, #ecf0f1);
  }

  .save-blocked-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
}

.status-region {
  min-width: 0;
}

.status {
  margin: 0;
  font-size: 0.75rem;
  white-space: nowrap;
  color: var(--composer-success, #27ae60);

  &.error {
    color: var(--composer-error, #e74c3c);
  }
}

// The saved list slides in from the right, over the page. Hidden with CSS while closed.
.library-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 80;
  width: min(22rem, 90vw);
  display: flex;
  flex-direction: column;
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.35);
  visibility: hidden;
  transform: translateX(100%);
  transition: transform 0.2s ease-out, visibility 0s linear 0.2s;

  &.open {
    visibility: visible;
    transform: translateX(0);
    transition: transform 0.2s ease-out;
  }
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--composer-border, #465666);
}

.drawer-close {
  background: none;
  border: none;
  color: var(--composer-text-secondary, #bdc3c7);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.composition-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem;
  overflow-y: auto;
}

.composition-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.45rem 1.5rem 0.45rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }

  &.current {
    background-color: rgba(52, 152, 219, 0.25);
    box-shadow: inset 2px 0 0 var(--composer-accent, #3498db);
  }

  .composition-title {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .composition-meta {
    font-size: 0.7rem;
    color: var(--composer-text-secondary, #bdc3c7);
  }

  .composition-remove {
    position: absolute;
    top: 0.35rem;
    right: 0.3rem;
    background: none;
    border: none;
    color: var(--composer-text-secondary, #bdc3c7);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.2rem;

    &:hover {
      color: var(--composer-error, #e74c3c);
    }
  }
}

.hint {
  margin: 0.75rem 1rem;
  font-size: 0.75rem;
  color: var(--composer-text-secondary, #bdc3c7);
}

@media (prefers-reduced-motion: reduce) {
  .library-drawer,
  .library-drawer.open {
    transition: none;
  }
}
```

**Step 4: Run** the panel spec. Expected: all SUCCESS, including the focus-return, `role="alert"` and
`aria-live` specs M4 wrote.

**Step 5: Commit**: `feat: Library and Export menus in the top bar, and the saved list in a drawer`.

### Task 3.9: The shell says how tall its header is

The composer's grid is sized to the viewport minus the app header (design Part 3). The header's height
is not a constant - its navigation wraps on a narrow window - so the shell measures it and publishes it
as `--app-header-height` on the document root, and the page reads the property with a fallback. A CSS
custom property is the contract between shell and page, which is why this is the one place a component
writes a style onto the document.

**Files:**
- Modify: `client/src/app/app.component.ts`, `client/src/app/app.component.html`
- Test: `client/src/app/app.component.spec.ts`

**Step 1: Failing spec.** Append inside the top-level `describe('AppComponent', ...)`, after the
`opening and closing` block:

<!-- apply: find client/src/app/app.component.spec.ts -->
```typescript
  describe('opening and closing', () => {
```

<!-- apply: replace client/src/app/app.component.spec.ts -->
```typescript
  describe('the header\'s height', () => {
    it('is published for a page that fills the rest of the viewport', () => {
      component.publishHeaderHeight();

      const header: HTMLElement = fixture.nativeElement.querySelector('header');
      expect(document.documentElement.style.getPropertyValue('--app-header-height')).toBe(`${header.offsetHeight}px`);
    });
  });

  describe('opening and closing', () => {
```

**Step 2: Run** `app.component.spec.ts`. Expected: a compile error,
`TS2339: Property 'publishHeaderHeight' does not exist on type 'AppComponent'.`

**Step 3: Implement.** In `app.component.html`, name the header:

<!-- apply: find client/src/app/app.component.html -->
```html
<div class="app-container">
  <header>
```

<!-- apply: replace client/src/app/app.component.html -->
```html
<div class="app-container">
  <header #appHeader>
```

In `app.component.ts`:

<!-- apply: find client/src/app/app.component.ts -->
```typescript
import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
```

<!-- apply: replace client/src/app/app.component.ts -->
```typescript
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
```

<!-- apply: find client/src/app/app.component.ts -->
```typescript
export class AppComponent implements OnInit, OnDestroy {
  title = 'MusicTheory';
```

<!-- apply: replace client/src/app/app.component.ts -->
```typescript
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  title = 'MusicTheory';

  @ViewChild('appHeader') private header?: ElementRef<HTMLElement>;
  private headerObserver: ResizeObserver | null = null;
```

<!-- apply: find client/src/app/app.component.ts -->
```typescript
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
```

<!-- apply: replace client/src/app/app.component.ts -->
```typescript
  ngAfterViewInit(): void {
    this.publishHeaderHeight();
    const header = this.header?.nativeElement;
    if (header && typeof ResizeObserver !== 'undefined') {
      this.headerObserver = new ResizeObserver(() => this.publishHeaderHeight());
      this.headerObserver.observe(header);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.headerObserver?.disconnect();
  }

  /**
   * Publishes the header's height as `--app-header-height` on the document root.
   *
   * A page that fills the viewport under the header - the composer's grid - reads it, because the
   * header's height is not a constant: its navigation wraps on a narrow window. A CSS custom property is
   * the contract between the shell and such a page, so this is the one place a component sets a style
   * on the document. Re-published whenever the header resizes.
   */
  publishHeaderHeight(): void {
    const height = this.header?.nativeElement.offsetHeight;
    if (height !== undefined) document.documentElement.style.setProperty('--app-header-height', `${height}px`);
  }
```

**Step 4: Run** `app.component.spec.ts`. Expected: all SUCCESS.

**Step 5: Commit**: `feat: The shell publishes its header height for pages that fill the viewport`.

### Task 3.10: The page grid

`ComposerComponent` becomes the page that holds the parts: a CSS grid sized to the viewport minus the
app header (`--app-header-height`, Task 3.9), with

- the **top bar**: title, transport, BPM, Metronome, Count-in, Undo, Redo, New, the alphaTex toggle, the
  Library and Export menus, and a `?` button for the shortcut sheet;
- the **palette** on the left;
- the **score** in the centre, with the alphaTex panel under it when open;
- the **status line**;
- the **track strip** along the bottom, under a separator that drags its height - and, as a focusable
  `role="separator"`, takes the arrow keys too;
- no inspector column: that is M3's.

The page implements `ComposerToolHost` - popovers, the sheet, transport, the save request, adding a track
through the strip - and hands every key press to `ComposerKeyHandler` and every palette press to the same
tool's `run`, so a button and its key cannot differ. The old keyboard `switch`, the fret buffer, the
duration buttons and the Tracks panel go: the key handler, `FretDigitEntry`, the palette and the track
strip now hold them. Composer colours become CSS custom properties on the page host (design Part 3,
"Styling"), and the child components read them with fallbacks.

The track strip's own specs moved in Task 3.7; `composer.component.spec.ts` is recreated here for what
the page itself is answerable for.

**Files:**
- Replace: `client/src/app/components/composer/composer.component.ts`, `composer.component.html`,
  `composer.component.scss`
- Test: create `client/src/app/components/composer/composer.component.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/components/composer/composer.component.spec.ts -->
```typescript
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerComponent, clampedStripHeight } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';

/**
 * The composer page: what it is answerable for beyond its parts.
 *
 * The parts have their own specs - the palette, the strip, the status line, the tool table and the key
 * handler. What is pinned here is the wiring: a refusal and an alphaTex error reach the live region, a key
 * press reaches the tool table and a key typed into a field does not, a palette press and a key run one
 * command, and the page's own controls - the sheet, a popover, adding a track - answer the keyboard.
 *
 * The score and the library panel are stubbed: one owns alphaTab and engraves on `AfterViewInit`, the
 * other reads IndexedDB, and neither is part of the wiring.
 */
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {}

@Component({ selector: 'app-composer-library-panel', standalone: true, template: '' })
class StubLibraryPanelComponent {}

describe('ComposerComponent', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let component: ComposerComponent;
  let composer: ComposerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const region = (): HTMLElement => fixture.nativeElement.querySelector('[aria-live="polite"]');

  /** Dispatches a key press on `target`, bubbling to the document as a real one does. */
  function press(init: KeyboardEventInit, target: EventTarget = document): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  }

  it('says why a press did nothing in the page\'s polite live region', () => {
    composer.toggleNoteEffect('isGhost', true, false);
    fixture.detectChanges();

    expect(region().textContent).toMatch(/no note/i);
  });

  it('shows a failed alphaTex apply in the same region', () => {
    spyOn(TestBed.inject(AlphaTexService), 'parse').and.returnValue({ score: null, diagnostics: [] });

    component.applyTex();
    fixture.detectChanges();

    expect(region().textContent).toContain('could not be parsed');
  });

  it('runs a key press through the tool table, and leaves one typed into the title alone', () => {
    press({ key: 'q', code: 'KeyQ' });
    expect(composer.state.entryMode).toBe('pen');

    press({ key: 'q', code: 'KeyQ' }, fixture.nativeElement.querySelector('.title-input'));
    expect(composer.state.entryMode).toBe('pen');
  });

  it('opens the shortcut sheet on ?, and Escape closes it and goes back to Select', () => {
    press({ key: 'q', code: 'KeyQ' });
    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(component.sheetOpen).toBeTrue();

    press({ key: 'Escape' });
    expect(component.sheetOpen).toBeFalse();
    expect(composer.state.entryMode).toBe('select');
  });

  it('runs a palette button through the same command as its key', () => {
    (fixture.nativeElement.querySelector('[data-tool="rest"]') as HTMLButtonElement).click();

    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('opens a valued tool\'s popover from its key', () => {
    press({ key: 'k', code: 'KeyK' });

    expect(component.popover).toBe('clef');
    expect(fixture.nativeElement.querySelector('app-composer-tool-popover')).not.toBeNull();
  });

  it('adds a track of the strip\'s chosen instrument from the keyboard', () => {
    press({ key: 'Insert', ctrlKey: true, shiftKey: true });

    expect(composer.doc.tracks.length).toBe(2);
    expect(composer.doc.tracks[1].name).toBe('Piano');
  });
});

describe('clampedStripHeight', () => {
  it('keeps the strip between one row and most of the window', () => {
    expect(clampedStripHeight(10, 1000)).toBe(72);
    expect(clampedStripHeight(300, 1000)).toBe(300);
    expect(clampedStripHeight(900, 1000)).toBe(600);
  });
});
```

**Step 2: Run** with `--include=src/app/components/composer/composer.component.spec.ts`. Expected: a
compile error, `TS2305: Module '"./composer.component"' has no exported member 'clampedStripHeight'.`

**Step 3: Implement.** Replace `composer.component.ts`:

<!-- apply: create client/src/app/components/composer/composer.component.ts -->
```typescript
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { ComposerShortcutSheetComponent } from './components/composer-shortcut-sheet/composer-shortcut-sheet.component';
import { ComposerStatusLineComponent } from './components/composer-status-line/composer-status-line.component';
import { ComposerTrackStripComponent } from './components/composer-track-strip/composer-track-strip.component';
import { AlphaTabState } from '../../models/alpha-tab.model';
import { ComposerState, TexDiagnostic } from '../../models/composer.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
import { ComposerKeyHandler } from '../../services/composer-key-handler';
import { ComposerSaveRequests } from '../../services/composer-save-requests.service';
import { ComposerTool, ComposerToolHost, PopoverKind } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';

/** The shortest the track strip can be dragged, in pixels: about one row and the add-track controls. */
const STRIP_MIN_HEIGHT = 72;

/** The tallest the track strip can be dragged, as a share of the window. */
const STRIP_MAX_SHARE = 0.6;

/** How far one arrow key moves the strip's separator, in pixels. */
const STRIP_KEY_STEP = 16;

/** `height` clamped between the strip's minimum and its share of a window `viewportHeight` tall. */
export function clampedStripHeight(height: number, viewportHeight: number): number {
  const max = Math.max(STRIP_MIN_HEIGHT, Math.round(viewportHeight * STRIP_MAX_SHARE));
  return Math.max(STRIP_MIN_HEIGHT, Math.min(max, Math.round(height)));
}

/**
 * The composer page: top bar, palette, score, status line and track strip, in one grid.
 *
 * Holds no document state - that is `ComposerService`'s - only what the page presents: which popover
 * is open, whether the shortcut sheet is, the alphaTex draft, and how tall the strip is. It is the
 * `ComposerToolHost` every tool runs against, so a palette press and a key press run one command. The
 * keyboard is `ComposerKeyHandler`'s, fret digits are `FretDigitEntry`'s, the track rows are the strip's,
 * and save, load and export are the library panel's.
 */
@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
    ComposerScoreComponent,
    ComposerShortcutSheetComponent,
    ComposerStatusLineComponent,
    ComposerTrackStripComponent
  ],
  templateUrl: './composer.component.html',
  styleUrls: ['./composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerComponent implements OnInit, OnDestroy {
  @ViewChild(ComposerTrackStripComponent) private strip?: ComposerTrackStripComponent;

  private readonly destroy$ = new Subject<void>();

  state: ComposerState | null = null;
  playerState: AlphaTabState | null = null;

  texDraft = '';
  texDiagnostics: TexDiagnostic[] = [];
  showTexPanel = false;
  texApplyError: string | null = null;

  metronomeEnabled = false;
  countInEnabled = false;

  /** The valued tool whose popover is open. The page holds it, because a key can open one as well as a button. */
  popover: PopoverKind | null = null;
  sheetOpen = false;
  stripHeight = 180;

  /** What every tool runs against. */
  readonly host: ComposerToolHost;

  private readonly keyHandler: ComposerKeyHandler;
  private readonly fretEntry: FretDigitEntry;
  /** Where a drag of the strip's separator started, while one is under way. */
  private stripDrag: { startY: number; startHeight: number } | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly texService: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.fretEntry = new FretDigitEntry(composer, () => Date.now(), midi =>
      this.alphaTabService.auditionNote(midi, this.currentTrackProgram)
    );
    this.host = {
      composer,
      openPopover: kind => this.present(() => (this.popover = kind)),
      toggleShortcutSheet: () => this.present(() => (this.sheetOpen = !this.sheetOpen)),
      escape: () =>
        this.present(() => {
          this.popover = null;
          this.sheetOpen = false;
          composer.setEntryMode('select');
          composer.setCursor({});
        }),
      playPause: () => this.alphaTabService.playPause(),
      // Stop rewinds to the start, so stop then play is play from the start.
      playFromStart: () => {
        this.alphaTabService.stop();
        this.alphaTabService.play();
      },
      requestSave: () => this.saveRequests.request(),
      addTrack: () => this.strip?.addTrack(),
      typeFretDigit: digit => this.fretEntry.type(digit)
    };
    this.keyHandler = new ComposerKeyHandler(this.host);
  }

  ngOnInit(): void {
    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.cdr.markForCheck();
      });

    this.alphaTabService
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.playerState = state;
        // alphaTab events originate outside Angular's zone.
        this.cdr.detectChanges();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The page's one keyboard listener. See `ComposerKeyHandler` for what it takes and what it leaves. */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    this.keyHandler.handle(event);
  }

  /** A palette press runs the same tool, against the same host, as its key. */
  runTool(tool: ComposerTool): void {
    tool.run(this.host, null);
  }

  closePopover(): void {
    this.popover = null;
  }

  toggleShortcutSheet(): void {
    this.sheetOpen = !this.sheetOpen;
  }

  closeShortcutSheet(): void {
    this.sheetOpen = false;
  }

  /** The program of the caret's track, for auditioning a typed fret on its own sound. */
  get currentTrackProgram(): number {
    return this.state?.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 25;
  }

  // -------------------------------------------------------------------------
  // Transport and score info
  // -------------------------------------------------------------------------

  playPause(): void {
    this.alphaTabService.playPause();
  }

  stop(): void {
    this.alphaTabService.stop();
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
    this.alphaTabService.setMetronomeVolume(this.metronomeEnabled ? 1 : 0);
  }

  toggleCountIn(): void {
    this.countInEnabled = !this.countInEnabled;
    this.alphaTabService.setCountInVolume(this.countInEnabled ? 1 : 0);
  }

  onTempoChange(value: string): void {
    const tempo = Number(value);
    if (!Number.isNaN(tempo)) this.composer.setTempo(tempo);
  }

  onTitleChange(value: string): void {
    this.composer.updateScoreInfo({ title: value });
  }

  undo(): void {
    this.composer.undo();
  }

  redo(): void {
    this.composer.redo();
  }

  newScore(): void {
    this.composer.reset();
  }

  // -------------------------------------------------------------------------
  // The track strip's height
  // -------------------------------------------------------------------------

  onStripResizeStart(event: PointerEvent): void {
    this.stripDrag = { startY: event.clientY, startHeight: this.stripHeight };
    // Captured, so the drag keeps its pointer when it leaves the thin separator.
    if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId);
  }

  onStripResize(event: PointerEvent): void {
    if (!this.stripDrag) return;
    this.stripHeight = clampedStripHeight(this.stripDrag.startHeight + this.stripDrag.startY - event.clientY, window.innerHeight);
  }

  onStripResizeEnd(): void {
    this.stripDrag = null;
  }

  /**
   * The separator's arrow keys. Stopped here, so the page's keyboard listener does not also move the
   * caret's string with the same press.
   */
  onStripResizeKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === 'ArrowUp' ? STRIP_KEY_STEP : -STRIP_KEY_STEP;
    this.stripHeight = clampedStripHeight(this.stripHeight + step, window.innerHeight);
  }

  // -------------------------------------------------------------------------
  // alphaTex escape hatch
  // -------------------------------------------------------------------------

  toggleTexPanel(): void {
    this.showTexPanel = !this.showTexPanel;
    if (this.showTexPanel) {
      this.texDraft = this.currentTex();
      this.texDiagnostics = [];
      this.texApplyError = null;
    }
  }

  /** Canonical alphaTex for the current document, generated on demand. */
  private currentTex(): string {
    if (!this.state) return '';
    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      return this.texService.export(score);
    } catch {
      return '';
    }
  }

  applyTex(): void {
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;

    if (!result.score) {
      // Keep the last good document; the diagnostics explain the failure, and the status line says so.
      this.texApplyError = 'alphaTex could not be parsed. The score is unchanged.';
      this.cdr.markForCheck();
      return;
    }

    this.texApplyError = null;
    this.composer.replaceDocument(this.mapper.toDoc(result.score));
    this.cdr.markForCheck();
  }

  revertTex(): void {
    this.texDraft = this.currentTex();
    this.texDiagnostics = [];
    this.texApplyError = null;
  }

  /** Runs a change the host makes from outside a template event, and marks the page for checking. */
  private present(change: () => void): void {
    change();
    this.cdr.markForCheck();
  }
}
```

Replace `composer.component.html`:

<!-- apply: create client/src/app/components/composer/composer.component.html -->
```html
<div class="composer-page" *ngIf="state as s">
  <header class="top-bar">
    <div class="score-info">
      <input
        class="title-input"
        type="text"
        [ngModel]="s.doc.title"
        (ngModelChange)="onTitleChange($event)"
        aria-label="Score title"
      />
      <span class="dirty-marker" *ngIf="s.isDirty" title="Unsaved changes">●</span>
    </div>

    <div class="transport">
      <button
        class="icon-btn"
        type="button"
        (click)="playPause()"
        [attr.aria-label]="playerState?.isPlaying ? 'Pause' : 'Play'"
        [title]="playerState?.isPlaying ? 'Pause (Space)' : 'Play (Space)'"
      >
        <span *ngIf="!playerState?.isPlaying">▶</span>
        <span *ngIf="playerState?.isPlaying">❚❚</span>
      </button>
      <button class="icon-btn" type="button" (click)="stop()" aria-label="Stop" title="Stop">■</button>

      <label class="tempo-field">
        <span>BPM</span>
        <input type="number" min="20" max="400" [ngModel]="s.doc.tempo" (ngModelChange)="onTempoChange($event)" />
      </label>

      <button class="toggle-btn" type="button" [class.active]="metronomeEnabled" [attr.aria-pressed]="metronomeEnabled" (click)="toggleMetronome()">
        Metronome
      </button>
      <button class="toggle-btn" type="button" [class.active]="countInEnabled" [attr.aria-pressed]="countInEnabled" (click)="toggleCountIn()">
        Count-in
      </button>
    </div>

    <div class="header-actions">
      <button class="text-btn" type="button" (click)="undo()" [disabled]="!s.canUndo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="text-btn" type="button" (click)="redo()" [disabled]="!s.canRedo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <button class="text-btn" type="button" (click)="newScore()" title="Start a new score">New</button>
      <button class="text-btn" type="button" [class.active]="showTexPanel" [attr.aria-pressed]="showTexPanel" (click)="toggleTexPanel()">
        alphaTex
      </button>
      <app-composer-library-panel></app-composer-library-panel>
      <button
        class="text-btn shortcuts-toggle"
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        [attr.aria-expanded]="sheetOpen"
        (click)="toggleShortcutSheet()"
      >?</button>
    </div>
  </header>

  <app-composer-palette
    class="palette"
    [state]="s"
    [popover]="popover"
    (toolPressed)="runTool($event)"
    (popoverClosed)="closePopover()"
  ></app-composer-palette>

  <div class="score-column">
    <app-composer-score></app-composer-score>

    <section class="tex-panel" *ngIf="showTexPanel">
      <div class="tex-header">
        <h2 class="panel-heading">alphaTex source</h2>
        <div class="tex-actions">
          <button class="text-btn" type="button" (click)="applyTex()">Apply</button>
          <button class="text-btn" type="button" (click)="revertTex()">Revert</button>
        </div>
      </div>

      <textarea class="tex-editor" [(ngModel)]="texDraft" spellcheck="false" aria-label="alphaTex source"></textarea>

      <ul class="diagnostics" *ngIf="texDiagnostics.length > 0">
        <li
          *ngFor="let d of texDiagnostics"
          class="diagnostic"
          [class.error]="d.severity === 'error'"
          [class.warning]="d.severity === 'warning'"
        >
          <span class="location">{{ d.line }}:{{ d.column }}</span>
          <span class="message">{{ d.message }}</span>
        </li>
      </ul>
    </section>
  </div>

  <app-composer-status-line
    class="status"
    [refusal]="s.refusal"
    [texError]="texApplyError"
    [cursor]="s.cursor"
    [entryMode]="s.entryMode"
  ></app-composer-status-line>

  <div
    class="strip-resize"
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    aria-label="Track strip height"
    aria-valuemin="72"
    [attr.aria-valuenow]="stripHeight"
    (pointerdown)="onStripResizeStart($event)"
    (pointermove)="onStripResize($event)"
    (pointerup)="onStripResizeEnd()"
    (pointercancel)="onStripResizeEnd()"
    (keydown)="onStripResizeKey($event)"
  ></div>

  <app-composer-track-strip class="strip" [style.height.px]="stripHeight"></app-composer-track-strip>

  <app-composer-shortcut-sheet [open]="sheetOpen" (closed)="closeShortcutSheet()"></app-composer-shortcut-sheet>
</div>
```

Replace `composer.component.scss`:

<!-- apply: create client/src/app/components/composer/composer.component.scss -->
```scss
// The composer page: a grid of top bar, palette, score, status line and track strip.
//
// The composer's colours are custom properties on the page host, so every child component reads one
// set rather than re-declaring SCSS variables in each file (design Part 3, "Styling"). The children
// give each a fallback of the same value, for their own specs, which have no page host.

:host {
  --composer-nav: #2c3e50;
  --composer-nav-secondary: #34495e;
  --composer-accent: #3498db;
  --composer-accent-hover: #2980b9;
  --composer-text: #ecf0f1;
  --composer-text-secondary: #bdc3c7;
  --composer-border: #465666;
  --composer-error: #e74c3c;
  --composer-warning: #f39c12;
  --composer-success: #27ae60;
  --composer-surface: #1a252f;

  display: block;
}

// Sized to the viewport minus the app header, which the shell publishes (it wraps on a narrow window).
// No inspector column until M3.
.composer-page {
  display: grid;
  grid-template-columns: minmax(8.5rem, 12.5rem) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto 0.4rem auto;
  grid-template-areas:
    'top top'
    'palette score'
    'status status'
    'resize resize'
    'strip strip';
  height: calc(100vh - var(--app-header-height, 57px));
  height: calc(100dvh - var(--app-header-height, 57px));
  min-height: 24rem;
  overflow: hidden;
  background-color: var(--composer-surface);
  color: var(--composer-text);
}

@media (max-width: 40rem) {
  .composer-page {
    grid-template-columns: minmax(6.5rem, 8rem) minmax(0, 1fr);
  }
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

.top-bar {
  grid-area: top;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1.25rem;
  padding: 0.5rem 1rem;
  background-color: var(--composer-nav);
  border-bottom: 1px solid var(--composer-border);
}

.score-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;

  .title-input {
    min-width: 8rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--composer-text);
    font-size: 1.05rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;

    &:hover {
      border-color: var(--composer-border);
    }

    &:focus {
      outline: none;
      border-color: var(--composer-accent);
      background-color: rgba(0, 0, 0, 0.2);
    }
  }

  .dirty-marker {
    color: var(--composer-accent);
    font-size: 0.7rem;
  }
}

.transport,
.header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.tempo-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--composer-text-secondary);
  font-size: 0.8rem;

  input {
    width: 4.5rem;
    padding: 0.3rem 0.4rem;
    background-color: var(--composer-nav-secondary);
    border: 1px solid var(--composer-border);
    border-radius: 4px;
    color: var(--composer-text);

    &:focus {
      outline: none;
      border-color: var(--composer-accent);
    }
  }
}

.icon-btn,
.text-btn,
.toggle-btn {
  background-color: var(--composer-nav-secondary);
  border: 1px solid var(--composer-border);
  border-radius: 4px;
  color: var(--composer-text);
  cursor: pointer;
  padding: 0.35rem 0.7rem;
  font-size: 0.82rem;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover:not(:disabled):not([aria-disabled='true']) {
    background-color: var(--composer-accent);
    border-color: var(--composer-accent-hover);
  }

  &:disabled,
  &[aria-disabled='true'] {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.active {
    background-color: var(--composer-accent);
    border-color: var(--composer-accent-hover);
  }
}

.icon-btn {
  min-width: 2.2rem;
  font-size: 0.95rem;
}

// ---------------------------------------------------------------------------
// Palette, score and status line
// ---------------------------------------------------------------------------

.palette {
  grid-area: palette;
}

.score-column {
  grid-area: score;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

  app-composer-score {
    min-height: 0;
  }
}

.status {
  grid-area: status;
}

// ---------------------------------------------------------------------------
// The track strip and its separator
// ---------------------------------------------------------------------------

.strip-resize {
  grid-area: resize;
  cursor: row-resize;
  touch-action: none;
  background-color: var(--composer-border);

  &:hover,
  &:focus-visible {
    outline: none;
    background-color: var(--composer-accent);
  }
}

.strip {
  grid-area: strip;
}

// ---------------------------------------------------------------------------
// alphaTex panel
// ---------------------------------------------------------------------------

.tex-panel {
  flex-shrink: 0;
  max-height: 45%;
  display: flex;
  flex-direction: column;
  padding: 0.6rem 1rem 0.8rem;
  background-color: var(--composer-nav);
  border-top: 1px solid var(--composer-border);
}

.panel-heading {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--composer-text-secondary);
}

.tex-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.tex-actions {
  display: flex;
  gap: 0.4rem;
}

.tex-editor {
  width: 100%;
  min-height: 7rem;
  resize: vertical;
  box-sizing: border-box;
  background-color: #11181f;
  border: 1px solid var(--composer-border);
  border-radius: 4px;
  color: var(--composer-text);
  font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  padding: 0.6rem;

  &:focus {
    outline: none;
    border-color: var(--composer-accent);
  }
}

.diagnostics {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  overflow-y: auto;
  max-height: 8rem;
}

.diagnostic {
  display: flex;
  gap: 0.6rem;
  padding: 0.3rem 0.4rem;
  border-left: 3px solid var(--composer-text-secondary);
  margin-bottom: 2px;
  font-size: 0.78rem;
  background-color: rgba(0, 0, 0, 0.2);

  &.error {
    border-left-color: var(--composer-error);
  }

  &.warning {
    border-left-color: var(--composer-warning);
  }

  .location {
    flex-shrink: 0;
    color: var(--composer-text-secondary);
    font-family: 'Consolas', monospace;
  }

  .message {
    color: var(--composer-text);
  }
}
```

**Step 4: Run** `composer.component.spec.ts`, then both type checks. Expected: all SUCCESS, no type errors.

**Step 5: Commit**: `feat: The composer page grid - top bar, palette, score, status line and track strip`.

### Task 3.11: Phase 3 checkpoint

**Step 1:** Both type checks and the whole suite, as in Task 1.16. Expected: no type errors, all SUCCESS.

**Step 2:** Line counts - every file under 1000:

```bash
wc -l client/src/app/components/composer/composer.component.ts client/src/app/services/composer.service.ts client/src/app/services/composer-tools.ts
```

**Step 3:** Nothing to commit if clean.

## Phase 4: score interaction

A click on the score now depends on the entry mode, a drag makes a range, the range is drawn, Pen shows
where a click would write, and the caret is drawn from state before the first click (decision 22).
`ComposerScoreComponent` has no spec - it owns alphaTab and engraves after view init - so the decisions
live in pure functions with specs of their own (Task 4.1), alphaTab's events and highlight get thin
wrappers (Task 4.2), and the component only wires them (Task 4.3).

One alphaTab fact shapes all of it. With `player.enableUserInteraction` on - the composer's setting
until now - alphaTab runs its own selection: a mouse-down starts a highlight, a move extends it, and a
mouse-up calls `applyPlaybackRangeFromHighlight`, which **sets the playback range**
(`AlphaTabApiBase._onBeatMouseDown`/`_onBeatMouseMove`/`_onBeatMouseUp`, `alphaTab.core.mjs` ~53080-53130
in 1.8). The design says selecting must never change what the transport loops. So the composer turns
alphaTab's interaction off: the beat mouse events still fire (`_setupClickHandling`, ~53156, runs either
way, and `_isBeatMouseDown` is set whatever the setting), and the composer draws the highlight itself with
`highlightPlaybackRange`, which sets nothing. Two things come with the setting: alphaTab no longer calls
`preventDefault` on a mouse-down, so the score container takes `user-select: none` to keep a drag from
selecting text; and alphaTab no longer re-applies its highlight after a render (~53215 checks the setting),
which is why the composer redraws it after every `renderFinished`.

**Phase 4 exports**

| Module | Exports | Task |
|---|---|---|
| `composer-score-interaction.ts` (new) | `StaffKind`, `StaffSlot`, `staffSlotsOf`, `ScorePress`, `scorePressOf`, `dragExtends`, `caretSlotIndexOf`, `caretHalfStepsOf`, `highlightEndsOf`, `penHoverHalfStepsOf` | 4.1 |
| `alpha-tab.service.ts` | `onBeatMouseMove`, `onBeatMouseUp`, `highlightRange`, `clearHighlight` | 4.2 |
| `composer-score.component` | Select / Pen clicks, drag selection, the highlight, Pen's hover notehead, the caret from state | 4.3 |

### Task 4.1: What a click, a drag and the caret mean, as pure functions

- **A mouse-down** extends the range with Shift held; otherwise it moves the caret, and in Pen on
  standard notation it also writes the clicked pitch. Tablature never writes on a click - digits write
  there, in both modes.
- **A drag** - moving with the button held - extends the range from where the mouse-down put the caret:
  anywhere in Select, and on tablature in Pen. A notation drag in Pen would extend from the caret the
  write just advanced, which is never what a hand meant.
- **The caret** is drawn on the caret's own staff: on the staff last clicked when that is the caret's,
  otherwise on its tablature when the caret has a string and its notation when not. On notation it
  sits at the last clicked position, or the middle line before any click.
- **The highlight** runs from the range's first target beat to its last; a caret alone has none.
- **Pen's hover notehead** is drawn only in Pen, over standard notation, where the pointer's position
  names a pitch.

**Files:**
- Create: `client/src/app/services/composer-score-interaction.ts`
- Test: `client/src/app/services/composer-score-interaction.spec.ts`

**Step 1: Failing spec**

<!-- apply: create client/src/app/services/composer-score-interaction.spec.ts -->
```typescript
import { ComposerService } from './composer.service';
import {
  StaffSlot,
  caretHalfStepsOf,
  caretSlotIndexOf,
  dragExtends,
  highlightEndsOf,
  penHoverHalfStepsOf,
  scorePressOf,
  staffSlotsOf
} from './composer-score-interaction';
import { EditCursor } from '../models/composer.model';

const at = (trackIndex: number, barIndex: number, beatIndex: number, stringIndex: number | null = 0): EditCursor =>
  ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex, stringIndex });

describe('staffSlotsOf', () => {
  it('lists the staves alphaTab draws, notation before tablature, track by track', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(staffSlotsOf(doc)).toEqual([
      { trackIndex: 0, staffIndex: 0, kind: 'notation' },
      { trackIndex: 0, staffIndex: 0, kind: 'tab' },
      { trackIndex: 1, staffIndex: 0, kind: 'notation' }
    ]);
  });
});

describe('scorePressOf and dragExtends', () => {
  it('writes only in Pen, on notation, without Shift', () => {
    expect(scorePressOf('pen', 'notation', false)).toBe('write');
    expect(scorePressOf('select', 'notation', false)).toBe('caret');
    expect(scorePressOf('pen', 'tab', false)).toBe('caret');
    expect(scorePressOf('pen', null, false)).toBe('caret');
  });

  it('extends with Shift in either mode', () => {
    expect(scorePressOf('pen', 'notation', true)).toBe('extend');
    expect(scorePressOf('select', 'tab', true)).toBe('extend');
  });

  it('drags a range anywhere in Select, and only on tablature in Pen', () => {
    expect(dragExtends('select', 'notation')).toBeTrue();
    expect(dragExtends('select', null)).toBeTrue();
    expect(dragExtends('pen', 'tab')).toBeTrue();
    expect(dragExtends('pen', 'notation')).toBeFalse();
  });
});

describe('caretSlotIndexOf and caretHalfStepsOf', () => {
  const slots: StaffSlot[] = [
    { trackIndex: 0, staffIndex: 0, kind: 'notation' },
    { trackIndex: 0, staffIndex: 0, kind: 'tab' },
    { trackIndex: 1, staffIndex: 0, kind: 'notation' }
  ];

  it('draws the caret before any click: on tablature for a string, on notation without one', () => {
    expect(caretSlotIndexOf(slots, at(0, 0, 0, 2), null)).toBe(1);
    expect(caretSlotIndexOf(slots, at(1, 0, 0, null), null)).toBe(2);
  });

  it('keeps the staff last clicked while it is still the caret\'s', () => {
    expect(caretSlotIndexOf(slots, at(0, 1, 2), 0)).toBe(0);
    expect(caretSlotIndexOf(slots, at(1, 1, 2, null), 0)).toBe(2);
  });

  it('finds no staff for a caret on a track that draws none', () => {
    expect(caretSlotIndexOf(slots, at(4, 0, 0), null)).toBeNull();
  });

  it('puts a tablature caret on its string, and a notation caret where it was clicked or on the middle line', () => {
    // Six lines, string 1 on top: string 1 is 10 half-steps above the bottom line, string 6 is 0.
    expect(caretHalfStepsOf('tab', 6, 0, null)).toBe(10);
    expect(caretHalfStepsOf('tab', 6, 5, null)).toBe(0);
    expect(caretHalfStepsOf('notation', 0, null, 7)).toBe(7);
    expect(caretHalfStepsOf('notation', 0, null, null)).toBe(4);
  });
});

describe('highlightEndsOf', () => {
  it('runs from the range\'s first beat to its last, whichever end was clicked first', () => {
    const doc = ComposerService.createEmptyScore();

    const ends = highlightEndsOf(doc, at(0, 1, 2), at(0, 0, 3));

    expect(ends?.first).toEqual({ trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 3 });
    expect(ends?.last).toEqual({ trackIndex: 0, staffIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 2 });
  });

  it('draws nothing for the caret alone', () => {
    const doc = ComposerService.createEmptyScore();

    expect(highlightEndsOf(doc, null, at(0, 0, 0))).toBeNull();
    expect(highlightEndsOf(doc, at(0, 0, 1), at(0, 0, 1))).toBeNull();
  });
});

describe('penHoverHalfStepsOf', () => {
  it('places a hover notehead only in Pen, over notation, with a clef that has pitches', () => {
    // Treble clef's bottom line is E4, diatonic 30; G4, 32, is two half-steps above it.
    expect(penHoverHalfStepsOf('pen', 'notation', 32, 'g2')).toBe(2);
    expect(penHoverHalfStepsOf('select', 'notation', 32, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'tab', 32, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'notation', null, 'g2')).toBeNull();
    expect(penHoverHalfStepsOf('pen', 'notation', 32, 'n')).toBeNull();
  });
});
```

**Step 2: Run** with `--include=src/app/services/composer-score-interaction.spec.ts`. Expected: a compile
error, `TS2307: Cannot find module './composer-score-interaction'`.

**Step 3: Implement**

<!-- apply: create client/src/app/services/composer-score-interaction.ts -->
```typescript
import { ClefKind, EditCursor, EntryMode, ScoreDoc } from '../models/composer.model';
import { BeatRef, selectionTargets } from './composer-selection';
import { bottomLineDiatonic } from './staff-pitch';

/**
 * What the mouse means on the engraved score, as pure functions of the entry mode, the staff under the
 * pointer and the selection.
 *
 * `ComposerScoreComponent` owns alphaTab and has no spec, so every decision it makes about a click, a
 * drag, the caret and the highlight is made here, where it can be specced; the component only measures
 * the page and calls these.
 */

export type StaffKind = 'notation' | 'tab';

/** One staff as alphaTab draws it, tied back to the track and staff it came from. */
export interface StaffSlot {
  trackIndex: number;
  staffIndex: number;
  kind: StaffKind;
}

/**
 * The staves alphaTab draws, in render order, described from the document. alphaTab lays out each
 * track's staves in order, standard notation before tablature, so this lines up index for index with
 * `StaffHitTestService.allStaves` and says which track a measured staff belongs to.
 */
export function staffSlotsOf(doc: ScoreDoc): StaffSlot[] {
  return doc.tracks.flatMap((track, trackIndex) =>
    track.staves.flatMap((staff, staffIndex) => [
      ...(staff.showStandardNotation ? [{ trackIndex, staffIndex, kind: 'notation' as const }] : []),
      ...(staff.showTablature && staff.tuning.length > 0 ? [{ trackIndex, staffIndex, kind: 'tab' as const }] : [])
    ])
  );
}

/** What a mouse-down on the score does. */
export type ScorePress = 'extend' | 'caret' | 'write';

/**
 * What a mouse-down does: Shift extends the range; otherwise the caret moves, and in Pen, on standard
 * notation, the clicked pitch is written too. Tablature writes by digit in both modes, never by click.
 */
export function scorePressOf(mode: EntryMode, staff: StaffKind | null, shiftKey: boolean): ScorePress {
  if (shiftKey) return 'extend';
  return mode === 'pen' && staff === 'notation' ? 'write' : 'caret';
}

/**
 * Whether moving with the button held extends the range from where the mouse-down put the caret:
 * anywhere in Select, and on tablature in Pen. A notation drag in Pen would extend from the caret a write
 * just advanced.
 */
export function dragExtends(mode: EntryMode, staff: StaffKind | null): boolean {
  return mode === 'select' || staff === 'tab';
}

/**
 * The index in `slots` of the staff the caret is drawn on, or null when its track draws none.
 *
 * The staff last clicked (`clicked`), while it is still the caret's; otherwise the caret's tablature when
 * the caret has a string, and its notation when it has not - which is what draws the caret before the
 * first click, when nothing has been clicked to learn a staff from.
 */
export function caretSlotIndexOf(slots: readonly StaffSlot[], cursor: EditCursor, clicked: number | null): number | null {
  const isCaretStaff = (slot: StaffSlot | undefined): boolean =>
    slot !== undefined && slot.trackIndex === cursor.trackIndex && slot.staffIndex === cursor.staffIndex;
  if (clicked !== null && isCaretStaff(slots[clicked])) return clicked;

  const own = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => isCaretStaff(slot));
  const wanted: StaffKind = cursor.stringIndex !== null ? 'tab' : 'notation';
  const found = own.find(({ slot }) => slot.kind === wanted) ?? own[0];
  return found ? found.index : null;
}

/**
 * How far above its staff's bottom line the caret box sits, in half line-spacings: a tablature caret on
 * its string (string 1 is the top line), a notation caret where notation was last clicked, or on the
 * middle line before any click.
 */
export function caretHalfStepsOf(staff: StaffKind, stringCount: number, stringIndex: number | null, clickedHalfSteps: number | null): number {
  if (staff === 'tab') return (stringCount - ((stringIndex ?? 0) + 1)) * 2;
  return clickedHalfSteps ?? 4;
}

/**
 * The range's first and last target beats, for alphaTab's `highlightPlaybackRange` - or null when there
 * is no range, or it covers one beat, which alphaTab would not draw anyway (`_cursorSelectRange` returns
 * early when both ends are one beat, ~53441).
 */
export function highlightEndsOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): { first: BeatRef; last: BeatRef } | null {
  if (!anchor) return null;
  const refs = selectionTargets(doc, anchor, cursor);
  return refs.length > 1 ? { first: refs[0], last: refs[refs.length - 1] } : null;
}

/**
 * Where Pen's hover notehead goes, in half line-spacings above the bottom line - or null when none is
 * drawn: outside Pen, off standard notation, where the pointer names no position, or under a clef with
 * no pitches.
 */
export function penHoverHalfStepsOf(mode: EntryMode, staff: StaffKind | null, diatonic: number | null, clef: ClefKind): number | null {
  const bottom = bottomLineDiatonic(clef);
  if (mode !== 'pen' || staff !== 'notation' || diatonic === null || bottom === null) return null;
  return diatonic - bottom;
}
```

**Step 4: Run it.** Expected: 12 SUCCESS.

**Step 5: Commit**: `feat: What a click, a drag and the caret mean on the score, as pure functions`.

### Task 4.2: alphaTab's mouse-move, mouse-up and highlight, wrapped

**Files:**
- Modify: `client/src/app/services/alpha-tab.service.ts`
- Test: create `client/src/app/services/alpha-tab.service.spec.ts`

**Step 1: Failing spec.** The wrappers only forward to the api, which a headless spec does not build, so
what is pinned is the contract every existing wrapper keeps: before `initializeApi` they do nothing and
do not throw.

<!-- apply: create client/src/app/services/alpha-tab.service.spec.ts -->
```typescript
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from './alpha-tab.service';

describe('AlphaTabService before an api exists', () => {
  it('registers mouse-move and mouse-up handlers and draws and clears a highlight without throwing', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(AlphaTabService);
    const beat = new alphaTab.model.Beat();

    expect(() => {
      service.onBeatMouseMove(() => undefined);
      service.onBeatMouseUp(() => undefined);
      service.highlightRange(beat, beat);
      service.clearHighlight();
    }).not.toThrow();
  });
});
```

**Step 2: Run** with `--include=src/app/services/alpha-tab.service.spec.ts`. Expected: compile errors,
`TS2551: Property 'onBeatMouseMove' does not exist on type 'AlphaTabService'. Did you mean 'onBeatMouseDown'?`
and `TS2339` for `onBeatMouseUp`, `highlightRange` and `clearHighlight`.

**Step 3: Implement.** In `alpha-tab.service.ts`, after `onBeatMouseDown`:

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```typescript
  onBeatMouseDown(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseDown.on(beat => this.ngZone.run(() => handler(beat)));
  }
```

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```typescript
  onBeatMouseDown(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseDown.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /**
   * Notify when the pointer moves over a beat with the button held after a `beatMouseDown`.
   *
   * Fires whatever `player.enableUserInteraction` says: `_setupClickHandling` wires it either way, and
   * the flag only decides whether alphaTab runs its own selection alongside.
   */
  onBeatMouseMove(handler: (beat: alphaTab.model.Beat) => void): void {
    this.api?.beatMouseMove.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /** Notify when the button is released after a `beatMouseDown`, with the beat under the pointer or null. */
  onBeatMouseUp(handler: (beat: alphaTab.model.Beat | null) => void): void {
    this.api?.beatMouseUp.on(beat => this.ngZone.run(() => handler(beat)));
  }

  /**
   * Draws alphaTab's selection markers from `startBeat` to `endBeat` without setting the playback range,
   * so selecting never changes what the transport plays. alphaTab does not redraw it after a render while
   * `enableUserInteraction` is off, so a caller redraws after `renderFinished`.
   */
  highlightRange(startBeat: alphaTab.model.Beat, endBeat: alphaTab.model.Beat): void {
    this.api?.highlightPlaybackRange(startBeat, endBeat);
  }

  /** Removes the selection markers. */
  clearHighlight(): void {
    this.api?.clearPlaybackRangeHighlight();
  }
```

**Step 4: Run it.** Expected: 1 SUCCESS.

**Step 5: Commit**: `feat: Wrap alphaTab's beat mouse-move, mouse-up and highlight`.

### Task 4.3: The score: Select and Pen, drag selection, the highlight, Pen's hover, and the caret from state

This task wires Tasks 4.1 and 4.2 into `ComposerScoreComponent`, which has no spec: the decisions are
Task 4.1's, specced there, and the result is checked by hand in Task 5.2. So its red is not a failing
spec. Step 2 runs the suite as the baseline the replacement must keep.

- **alphaTab's own interaction is off** (`enableUserInteraction: false`), so it never sets the playback
  range; the container takes `user-select: none`.
- **A mouse-down** asks `scorePressOf`: Shift extends; otherwise the caret moves, and Pen on notation
  writes the clicked pitch as today. A Select click on notation remembers where it landed, so the caret
  box sits there, and writes nothing.
- **A drag** extends the range as the pointer crosses beats, on the staff under the pointer, while
  `dragExtends` says so, until mouse-up.
- **The highlight** is drawn from state with `highlightRange` after every render - the score re-renders
  150ms after every state change, the caret's included - and cleared when there is no range.
- **Pen's hover notehead** is an overlay drawn from `hitTest.diatonicIn` as the pointer moves over a
  notation staff, placed with `caretRect`, under the clef of the caret's bar on that staff. It is
  rendering only and never touches the document.
- **The caret is drawn from state**: `caretSlotIndexOf` finds its staff without a click.

**Files:**
- Replace: `client/src/app/components/composer/components/composer-score/composer-score.component.ts`,
  `composer-score.component.html`, `composer-score.component.scss`

**Step 1: No new spec** - see above.

**Step 2: Run the suite** (both type checks and `ng test`). Expected: all SUCCESS, as after Task 4.2.

**Step 3: Implement.** Replace `composer-score.component.ts`:

<!-- apply: create client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```typescript
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerService } from '../../../../services/composer.service';
import {
  StaffSlot,
  caretHalfStepsOf,
  caretSlotIndexOf,
  dragExtends,
  highlightEndsOf,
  penHoverHalfStepsOf,
  scorePressOf,
  staffSlotsOf
} from '../../../../services/composer-score-interaction';
import { BeatRef } from '../../../../services/composer-selection';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { Rect, StaffHitTestService, StaffLines } from '../../../../services/staff-hit-test.service';
import { bottomLineDiatonic, diatonicToPitch, pitchToMidi } from '../../../../services/staff-pitch';
import { ComposerState, EditCursor } from '../../../../models/composer.model';

/** The pointer as the last mouse event over the score left it. */
interface Pointer {
  x: number;
  y: number;
  shiftKey: boolean;
}

/**
 * The engraved score, and the mouse over it.
 *
 * Owns the alphaTab instance, the render pipeline, the caret box, the range highlight and Pen's hover
 * notehead. What a click, a drag and the caret mean is decided in `composer-score-interaction.ts`, which
 * has the specs this component cannot; this measures the page with `StaffHitTestService` and calls it.
 *
 * alphaTab's own selection is off (`enableUserInteraction: false`): with it on, a mouse-up sets the
 * playback range, and selecting must never change what the transport plays. The beat mouse events fire
 * either way, and the highlight is drawn from state after every render.
 */
@Component({
  selector: 'app-composer-score',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-score.component.html',
  styleUrls: ['./composer-score.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerScoreComponent implements OnInit, AfterViewInit, OnDestroy {
  // Assigned by Angular before `ngAfterViewInit`, which is the first place it is read.
  @ViewChild('alphaTabContainer') alphaTabContainer!: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();
  /** Coalesces renders so typing does not re-engrave on every keystroke. */
  private readonly renderRequest$ = new Subject<void>();

  state: ComposerState | null = null;
  renderError: string | null = null;

  /** Caret box drawn over the staff, in container-relative pixels. */
  caretRect: Rect | null = null;
  /** Pen's hover notehead, in container-relative pixels, or null. */
  hoverRect: Rect | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedWidth = 0;
  /** Set when a render was skipped because the container had no width yet. */
  private renderPending = false;
  private destroyed = false;
  private pointer: Pointer | null = null;

  /** The rendered staff last clicked, which the caret stays on while it is the caret's. */
  private clickedSlotIndex: number | null = null;
  /** Where on notation the last click landed, in half line-spacings above the bottom line. */
  private clickedHalfSteps: number | null = null;
  /** Whether moving with the button held extends the range, for the drag the last mouse-down started. */
  private dragging = false;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly alphaTabService: AlphaTabService,
    private readonly hitTest: StaffHitTestService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to render requests first so the initial document state below is
    // picked up. The debounce also defers the first render past
    // ngAfterViewInit, giving alphaTab time to boot its workers.
    this.renderRequest$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(() => this.renderCurrentDocument());

    this.composer
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
        this.renderRequest$.next();
        this.scheduleCaretUpdate();
        this.cdr.markForCheck();
      });
  }

  ngAfterViewInit(): void {
    this.alphaTabService.initializeApi(this.alphaTabContainer.nativeElement, {
      core: { fontDirectory: '/font/', useWorkers: true },
      display: { scale: 1.0, staveProfile: 'default', layoutMode: 'page' },
      player: {
        enablePlayer: true,
        enableCursor: true,
        // Off: with it on, alphaTab's own mouse-up sets the playback range. See the class comment.
        enableUserInteraction: false,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: this.alphaTabContainer.nativeElement
      }
    });

    this.observeContainerWidth();
    this.wireScoreInteraction();
    this.renderRequest$.next();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const element = this.alphaTabContainer?.nativeElement;
    element?.removeEventListener('mousedown', this.onScorePointerDown, { capture: true });
    element?.removeEventListener('mousemove', this.onScorePointerMove);
    element?.removeEventListener('mouseleave', this.onScorePointerLeave);
    this.alphaTabService.dispose();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderCurrentDocument(): void {
    if (!this.state) return;

    // alphaTab refuses to draw into a zero-width element, logging "skipped
    // rendering because of width=0", and never retries by itself. Defer until
    // the ResizeObserver reports a real width.
    if ((this.alphaTabContainer?.nativeElement.clientWidth ?? 0) === 0) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;

    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      // Render every track: without explicit indices alphaTab shows only the
      // first, which hides all but one staff on a multi-track score.
      this.alphaTabService.renderScore(
        score,
        score.tracks.map((_, index) => index)
      );
      this.renderError = null;
    } catch (error) {
      this.renderError =
        error instanceof Error ? error.message : 'Failed to render the score';
    }
    this.cdr.markForCheck();
  }

  /**
   * alphaTab refuses to render into a zero-width element and does not retry on
   * its own. Watch for the container gaining width and render then; this also
   * re-flows the score when the window or side panels resize.
   */
  private observeContainerWidth(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;

      if (this.renderPending) {
        this.renderCurrentDocument();
      } else if (width !== this.lastRenderedWidth) {
        this.alphaTabService.render();
      }
      this.lastRenderedWidth = width;
      this.scheduleCaretUpdate();
    });
    this.resizeObserver.observe(element);
  }

  // -------------------------------------------------------------------------
  // The mouse
  // -------------------------------------------------------------------------

  /**
   * The pointer is captured on the container in the capture phase, so its position and Shift are known
   * when alphaTab's own beat events fire. Every render moves the beats, so the highlight is redrawn and
   * the caret re-measured after each one.
   */
  private wireScoreInteraction(): void {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element) return;

    element.addEventListener('mousedown', this.onScorePointerDown, { capture: true });
    element.addEventListener('mousemove', this.onScorePointerMove);
    element.addEventListener('mouseleave', this.onScorePointerLeave);
    this.alphaTabService.onBeatMouseDown(beat => this.pressBeat(beat));
    this.alphaTabService.onBeatMouseMove(beat => this.dragOverBeat(beat));
    this.alphaTabService.onBeatMouseUp(() => (this.dragging = false));

    // alphaTab attaches the rendered surface after this event, so measuring
    // has to wait for the DOM to settle.
    this.alphaTabService.onRenderFinished(() => {
      this.drawHighlight();
      this.scheduleCaretUpdate();
    });
  }

  /**
   * Recomputes the caret once the DOM has settled.
   *
   * markForCheck alone is not enough: these callbacks originate from alphaTab,
   * outside Angular's change detection, so the view is refreshed explicitly as
   * the project's alphaTab guidance recommends.
   */
  private scheduleCaretUpdate(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.destroyed) return;
        this.updateCaretOverlay();
        this.cdr.detectChanges();
      })
    );
  }

  private readonly onScorePointerDown = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey };
  };

  private readonly onScorePointerMove = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey };
    this.updateHover();
  };

  private readonly onScorePointerLeave = (): void => {
    if (this.hoverRect === null) return;
    this.hoverRect = null;
    this.cdr.detectChanges();
  };

  /** The staff under the pointer: its index among the rendered staves, what it is, and its lines. */
  private staffUnderPointer(): { index: number; slot: StaffSlot; lines: StaffLines } | null {
    const element = this.alphaTabContainer?.nativeElement;
    if (!element || !this.state || !this.pointer) return null;
    const index = this.hitTest.staffIndexAt(element, this.pointer.x, this.pointer.y);
    if (index === null) return null;
    const slot = staffSlotsOf(this.state.doc)[index];
    const lines = this.hitTest.allStaves(element)[index];
    return slot && lines ? { index, slot, lines } : null;
  }

  /**
   * Where a beat under the pointer is, as a caret. The beat comes from alphaTab, but the track and staff
   * cannot: a beat's bounds cover every staff in the system, so alphaTab always reports the first track.
   * Both come from where the pointer is vertically, and on tablature so does the string.
   */
  private cursorAt(beat: alphaTab.model.Beat, under: { slot: StaffSlot; lines: StaffLines } | null): Partial<EditCursor> {
    const cursor: Partial<EditCursor> = {
      trackIndex: under ? under.slot.trackIndex : beat.voice.bar.staff.track.index,
      staffIndex: under ? under.slot.staffIndex : beat.voice.bar.staff.index,
      barIndex: beat.voice.bar.index,
      voiceIndex: beat.voice.index,
      beatIndex: beat.index
    };
    if (under?.slot.kind === 'tab' && this.pointer) {
      cursor.stringIndex = this.hitTest.stringIn(under.lines, this.pointer.y) - 1;
    }
    return cursor;
  }

  /** A mouse-down on a beat. See `scorePressOf`. */
  private pressBeat(beat: alphaTab.model.Beat): void {
    if (!this.state) return;
    const under = this.staffUnderPointer();
    const mode = this.state.entryMode;
    const cursor = this.cursorAt(beat, under);
    const press = scorePressOf(mode, under?.slot.kind ?? null, this.pointer?.shiftKey ?? false);

    if (press === 'extend') {
      this.composer.extendSelectionTo(cursor);
      this.dragging = false;
    } else {
      this.composer.setCursor(cursor);
      this.dragging = dragExtends(mode, under?.slot.kind ?? null);
      if (under) this.clickedSlotIndex = under.index;
      if (under?.slot.kind === 'notation') this.rememberNotationClick(under.lines);
      if (press === 'write' && under) this.placeClickedPitch(under.lines);
    }

    this.scheduleCaretUpdate();
  }

  /** A beat crossed with the button held: extends the range to it, when this drag extends at all. */
  private dragOverBeat(beat: alphaTab.model.Beat): void {
    if (!this.dragging || !this.state) return;
    const cursor = this.cursorAt(beat, this.staffUnderPointer());
    const current = this.state.cursor;
    const same =
      cursor.trackIndex === current.trackIndex &&
      cursor.staffIndex === current.staffIndex &&
      cursor.barIndex === current.barIndex &&
      cursor.beatIndex === current.beatIndex;
    if (!same) this.composer.extendSelectionTo(cursor);
  }

  /** Records where on a notation staff the click landed, so the caret box sits there. */
  private rememberNotationClick(lines: StaffLines): void {
    if (!this.pointer || !this.state) return;
    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;
    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, this.pointer.y);
    const bottom = bottomLineDiatonic(bar.clef);
    this.clickedHalfSteps = diatonic !== null && bottom !== null ? diatonic - bottom : null;
  }

  /** Writes the note the pointer landed on, for standard notation staves in Pen. */
  private placeClickedPitch(lines: StaffLines): void {
    if (!this.pointer || !this.state) return;

    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;

    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, this.pointer.y);
    if (diatonic === null) return;

    const pitch = diatonicToPitch(diatonic, bar.keySignature, bar.clefOttava);
    const program = this.state.doc.tracks[this.state.cursor.trackIndex]?.playback.program ?? 0;

    this.alphaTabService.auditionNote(pitchToMidi(pitch), program);
    // Advance so a melody flows, matching fret entry.
    this.composer.setNoteAtCursor(pitch, true);
  }

  /** Pen's hover notehead: rendering only, it never touches the document. See `penHoverHalfStepsOf`. */
  private updateHover(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const state = this.state;
    const under = state?.entryMode === 'pen' ? this.staffUnderPointer() : null;
    let next: Rect | null = null;

    if (element && state && under && this.pointer) {
      const bar = state.doc.tracks[under.slot.trackIndex]?.staves[under.slot.staffIndex]?.bars[state.cursor.barIndex];
      const diatonic = bar ? this.hitTest.diatonicIn(under.lines, bar.clef, this.pointer.y) : null;
      const halfSteps = bar ? penHoverHalfStepsOf(state.entryMode, under.slot.kind, diatonic, bar.clef) : null;
      if (halfSteps !== null) {
        const surface = under.lines.surface.getBoundingClientRect();
        const scale = surface.width > 0 && under.lines.surface.viewBox.baseVal.width > 0 ? surface.width / under.lines.surface.viewBox.baseVal.width : 1;
        const localX = (this.pointer.x - surface.left) / scale;
        next = this.hitTest.caretRect(element, under.index, localX - under.lines.spacing * 0.65, under.lines.spacing * 1.3, halfSteps);
      }
    }

    if (next === null && this.hoverRect === null) return;
    this.hoverRect = next;
    this.cdr.detectChanges();
  }

  /**
   * Draws the range from state with alphaTab's highlight, or clears it. Called after every render, since
   * every render replaces the beats the highlight was drawn on.
   */
  private drawHighlight(): void {
    const api = this.alphaTabService.getApi();
    const state = this.state;
    const ends = state ? highlightEndsOf(state.doc, state.anchor, state.cursor) : null;
    const score = api?.score;
    const beatOf = (ref: BeatRef): alphaTab.model.Beat | undefined =>
      score?.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex]?.beats[ref.beatIndex];

    const first = ends ? beatOf(ends.first) : undefined;
    const last = ends ? beatOf(ends.last) : undefined;
    if (first && last) this.alphaTabService.highlightRange(first, last);
    else this.alphaTabService.clearHighlight();
  }

  /** Measures the caret box from state: its staff (`caretSlotIndexOf`), its beat, its string or pitch. */
  private updateCaretOverlay(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const api = this.alphaTabService.getApi();
    const lookup = this.alphaTabService.getBoundsLookup();
    const state = this.state;

    if (!element || !api?.score || !lookup || !state) {
      this.caretRect = null;
      return;
    }

    const cursor = state.cursor;
    const slots = staffSlotsOf(state.doc);
    const slotIndex = caretSlotIndexOf(slots, cursor, this.clickedSlotIndex);
    const beat = api.score.tracks[cursor.trackIndex]
      ?.staves[cursor.staffIndex]
      ?.bars[cursor.barIndex]
      ?.voices[cursor.voiceIndex]
      ?.beats[cursor.beatIndex];
    const bounds = beat ? lookup.findBeat(beat) : null;

    if (slotIndex === null || !bounds) {
      this.caretRect = null;
      return;
    }

    const slot = slots[slotIndex];
    const stringCount = this.composer.staffAt(state.doc, cursor)?.tuning.length ?? 0;
    const clicked = slotIndex === this.clickedSlotIndex ? this.clickedHalfSteps : null;
    const halfSteps = caretHalfStepsOf(slot.kind, stringCount, cursor.stringIndex, clicked);

    this.caretRect = this.hitTest.caretRect(
      element,
      slotIndex,
      bounds.visualBounds.x,
      bounds.visualBounds.w,
      halfSteps
    );
  }
}
```

Replace `composer-score.component.html`:

<!-- apply: create client/src/app/components/composer/components/composer-score/composer-score.component.html -->
```html
<div class="score-area">
  <div class="alphatab-container" #alphaTabContainer [class.pen]="state?.entryMode === 'pen'">
    <div
      class="tab-caret"
      *ngIf="caretRect"
      [style.left.px]="caretRect.left"
      [style.top.px]="caretRect.top"
      [style.width.px]="caretRect.width"
      [style.height.px]="caretRect.height"
    ></div>
    <!-- Pen's hover notehead: where a click would write. Rendering only. -->
    <div
      class="pen-hover"
      *ngIf="hoverRect"
      aria-hidden="true"
      [style.left.px]="hoverRect.left"
      [style.top.px]="hoverRect.top"
      [style.width.px]="hoverRect.width"
      [style.height.px]="hoverRect.height"
    ></div>
  </div>

  <p class="render-error" *ngIf="renderError">{{ renderError }}</p>
</div>
```

Replace `composer-score.component.scss`:

<!-- apply: create client/src/app/components/composer/components/composer-score/composer-score.component.scss -->
```scss
// Score view: the engraved output, the caret, the range highlight and Pen's hover notehead.
//
// Colours are the composer page's custom properties, with fallbacks for a page that does not set them.

:host {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.score-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  position: relative;
}

.alphatab-container {
  position: relative;
  flex: 1;
  overflow: auto;
  min-height: 0;
  cursor: default;
  // alphaTab's own interaction is off, so it no longer prevents a mouse-down's default: without this, a
  // drag across the score to select beats would select the page's text as well.
  user-select: none;

  &.pen {
    cursor: crosshair;
  }
}

// Caret drawn over the staff, showing where typing will land.
.tab-caret {
  position: absolute;
  pointer-events: none;
  border-radius: 2px;
  background-color: rgba(52, 152, 219, 0.25);
  box-shadow: 0 0 0 1px var(--composer-accent, #3498db) inset;
  transition: left 0.08s ease, top 0.08s ease;
  z-index: 5;
}

// Where a Pen click would write: a notehead-shaped mark that follows the pointer.
.pen-hover {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  background-color: var(--composer-accent, #3498db);
  opacity: 0.45;
  transform: rotate(-20deg);
  z-index: 6;
}

.render-error {
  margin: 0;
  padding: 0.6rem 1rem;
  background-color: rgba(231, 76, 60, 0.15);
  border-top: 1px solid var(--composer-error, #e74c3c);
  color: var(--composer-error, #e74c3c);
  font-size: 0.85rem;
}
```

**Step 4: Run** both type checks and the whole suite. Expected: all SUCCESS.

**Step 5: Commit**: `feat: Select and Pen on the score, drag selection, the range highlight, Pen's hover and a caret drawn from state`.

### Task 4.4: Phase 4 checkpoint

**Step 1:** Both type checks and the whole suite, as in Task 1.16. Expected: no type errors, all SUCCESS.

**Step 2:** Nothing to commit if clean.

## Phase 5: documentation and the hand check

### Task 5.1: Record M2 in the design doc, the TODO and the roadmap

The decisions M2 rests on were recorded when this plan was committed. What is left is what shipped and
what implementation changed.

**Files:**
- Modify: `docs/plans/2026-09-13-composer-editor-design.md`, `docs/TODO.md`, `docs/ROADMAP.md`,
  and this plan's "Corrections during implementation"

**Step 1:** In the design doc, change the status line to `M1 and M2 implemented, to [the M1 plan] and
[the M2 plan]`, and add an "M2 hand check" paragraph under the M1 one with Task 5.2's results.

**Step 2:** In `docs/TODO.md`: take "Refusals are not displayed yet" and "A whole tuplet group moves the
notes after it earlier" out of "Bugs, recorded and not yet fixed"; take the hammer-on, fermata, grace,
tied-vibrato and pitched-harmonic items out of "Known limitations" where M2 settled them, leaving the
settlement in the design doc; move "Next milestone" on to the GP Viewer milestone.

**Step 3:** In `docs/ROADMAP.md`, the M2 row reads `Shipped` with a one-line summary.

**Step 4:** If review changed code after a task was written, list it under "Corrections during
implementation" at the top of this plan, as M1's plan does, and say that the committed code supersedes
those tasks' blocks.

**Step 5: Commit**: `docs: Record M2 of the composer editor - what shipped and what it corrected`.

### Task 5.2: The hand check

The suite is headless: it cannot see a glyph, a layout or a real keyboard. Perform each step, and record
each result - including every step that could not be performed and why - in the design doc's "M2 hand
check" paragraph.

**Step 1: Start the app.** From `client/`, `npm start`, and open `http://localhost:4200/composer` in
Chrome at about 1920×1080.

**Step 2: Bravura renders in the palette.** Every glyph button (the note values, rest, dot, triplet,
accidentals, dynamics, hairpins, accent, marcato, staccato, tenuto, fermata, G clef, common time, repeats,
double bar, segno, trill, harmonic, pick strokes, grace notes, X notehead, vibrato) shows a notation
symbol - not an empty box, not a letter in another font - and sits inside its button. Check again at
200% browser zoom. In DevTools, Network, confirm `/font/Bravura.woff2` loaded with status 200.

**Step 3: The caret before any click.** Reload. The caret box is visible on the tab staff at bar 1,
beat 1, before anything is clicked, and `→` moves it.

**Step 4: Frets and undo.** Type `1` then `2` quickly: beat 1 is fret 12 and the caret is on beat 2.
Ctrl+Z once: beat 1 is a rest again. Type `3` then `5`: two notes, 3 and 5.

**Step 5: Select and Pen.** In Select, click the standard notation staff: the caret moves, nothing is
written. Press Q: the status line says Pen, and moving over the notation staff shows the hover notehead
snapping to lines and spaces and following the pointer. Click: the pitch is written and heard. Press
Esc: back to Select.

**Step 6: Ranges and the transport.** Drag across four beats in Select: they highlight while dragging and
stay highlighted after the score re-renders. Press Space: playback starts from the start of the score (or
where it was paused), not from the highlighted range, and does not loop it. Shift+click extends the
range; `→` alone drops it.

**Step 7: Every palette group.** With a range of notes selected, press one tool from each group and see
its mark appear and `aria-pressed` change (Elements panel): Quarter, Dot, Triplet, Tie; Repeat open,
Double bar; Flat on a B flat; mf, Crescendo; Accent, Staccato; Palm mute, Vibrato. On a range where some
notes have staccato and some do not, the Staccato button shows the mixed state.

**Step 8: Popovers.** Shift+T, set 3/4, Apply: bar 1 re-bars. Shift+T, type 40 in Top, Apply: the popover
says why inline and stays open. Ctrl+K: the list has C♭ major to C♯ major and A♭ minor to A♯ minor; pick
A♯ minor: seven sharps. K: set bass clef. Alt+/: 5:4. Shift+Insert: a section named Chorus.

**Step 9: Refusals are displayed and announced.** Put a note on the last beat, press H: the status line
says there is nothing to land on. With Narrator (Windows) or NVDA running, repeat: the reason is read out.
Press → : the message clears.

**Step 10: A hammer-on that lands.** Notes on beats 1 and 2 of one string, H on beat 1: the slur draws.
Save, reload, load: it is still there. Delete beat 2 by Shift+Delete: note what alphaTab now draws.

**Step 11: Fermata on every track.** Add a Piano track. On guitar beat 3 press F: both tracks show a
fermata at that position. Press F on the piano's beat 3: both clear.

**Step 12: Escape and the circle of fifths.** In Pen, open the Circle of Fifths drawer and press Esc: the
drawer closes and the status line still says Pen. Press Esc again: Select.

**Step 13: Save from the keyboard.** Add a progression track (from the progression page's Send), then
Ctrl+S: the refusal appears under the top bar, and after "Keep the link" focus is on Save inside the open
Library menu. Flatten the track, Ctrl+S: "Saved". Library, Saved compositions…: the drawer opens and a
click loads.

**Step 14: Narrow width.** Resize the window to 1000px, 768px and 480px wide. The palette scrolls
vertically with no horizontal scrollbar; the top bar wraps; the page never scrolls sideways; the track
strip's separator drags with the mouse and moves with ↑ and ↓ when focused.

**Step 15: Firefox.** Repeat Steps 2, 4, 5, 6 and 12 in Firefox, then press each symbol key - `?` `}` `|`
`:` `!` `_` `)` `(` `$` `%` `<` `[` `]` `;` `/` `.` `+` `=` `-` - and Alt+-, Alt+=, Alt+0, Alt+/, Ctrl+/,
Ctrl+K. Each runs its tool, and no Firefox menu opens.

**Step 16: A non-US keyboard layout.** Add German (QWERTZ) and French (AZERTY) in Windows' language
settings and switch to each. On German, type `}` `|` `[` `]` `$` `<` through AltGr and Shift as the layout
does: each runs its tool. On French, type digits with and without Shift: frets are written. If a layout
cannot be added on the machine, record this step as not performed.

**Step 17: macOS.** On a Mac, in Safari and Chrome: Option+Return inserts a beat, Shift+Return a section,
Cmd+Return a bar, Cmd+Shift+Return a track, Shift+Space plays from the start, Cmd+Z undoes, and `[` on a
German Mac layout (Option+5) opens a repeat. If no Mac is available, record this step as not performed -
the plan already says nobody has checked these.

**Step 18: Guitar Pro.** Export the score from Step 7 as `.gp` and open it in Guitar Pro, if it is
installed; record what differs. This is the design's standing per-milestone check, and `docs/TODO.md`
lists it as unperformed.

**Step 19: Commit** the results with Task 5.1's documentation, or separately:
`docs: Record the M2 hand check`.

### Task 5.3: The M2 checkpoint

**Step 1:** Both type checks and the whole suite. Expected: no type errors, all SUCCESS, and a total
above the plan's proof total by however many specs review added.

**Step 2:** Every file under 1000 lines:

```bash
wc -l client/src/app/services/composer*.ts client/src/app/components/composer/**/*.ts | sort -n | tail -8
```

**Step 3:** Merge `feature/composer-editor-m2` as the project merges milestones.

