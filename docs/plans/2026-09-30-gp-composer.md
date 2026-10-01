# The GP Viewer Becomes the Composer: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the milestone designed in [2026-09-14-gp-composer-design.md](2026-09-14-gp-composer-design.md): a `.gp`
file opens in the composer as alphaTab read it, the first edit asks and converts it - drums included - and the GP
Viewer goes.

**Architecture:** Build steps 3 to 11 of the design's Part 8, on top of steps 1 and 2, which are already on
`feature/gp-composer`. Percussion joins the model first, so the loss checker is written against the final model; the
prompt, the conversion and the entry points follow; then the strip, the scale panel and the transport the viewer had;
and the viewer is deleted last, so there is always a way to open a file. Every writing command in the Original state
goes through one gate, `ComposerGpService.requestEdit`, which holds it for the conversion prompt; everything that must
not reach the page component - converting, opening, the track view - is a root service of its own, and every pure rule
- what a conversion loses, which tracks are drawn, which notes a scale marks - is a module named for what it returns.

**Tech Stack:** Angular 21 standalone, TypeScript 5.9 strict, RxJS 7.8, alphaTab 1.8.0, IndexedDB, Jasmine/Karma.

---

## Corrections during implementation

Every task was reviewed after it was committed, and each review's fix commit changed the code after this plan's blocks
were written. **For every task named here, the committed code supersedes the plan's code blocks**; they are left as
written, as the record of what was planned. A few fixes touched this plan as they landed - two comments in Task A.1's
mapper block, Task B.1's "Corrected in review" note, Task C.1's description of the gate, and corrections 7 and 10 to the
design below - but no task's blocks were brought up to date with its review. Task J.2's hand check was performed as its list reads, and its results, step by step, are under "Hand check" in
the design doc; the fix it led to is the last entry here.

- **Task 0.1** (`733d229`). The page passes the file's bar count from a `fileBarCount` getter, and specs pin that
  Original measures no bar as over.
- **Task A.1** (`d3d0367`).
  - The mapper's comments said `Score.finish` puts a drum track on channel 9; they now say `toScore` assigns it
    (`midiChannelsOf`), and `midi-channels.spec.ts` pins the channel rule.
  - `toArticulation` records that alphaTab's constructor turns a `None` half or whole notehead into the default one, so
    such an entry does not come back field for field.
- **Task A.2** (`edfe2ea`).
  - Beats copied from a drum track carry its kit (`CopiedBeats.kit`), and a paste onto a drum track with another kit
    refuses: the same number names another drum there.
  - A trill press that clears trills is refused only where any note edit is, so a trill an imported file put on a drum
    hit can come off. Setting one is still refused.
  - With no string, the caret takes a drum staff's percussion band as its notation, rather than falling back to a slash
    staff drawn above it.
- **Task B.1** (`3be7bad`, `f3173a6`). In full in the task's own "Corrected in review" note. In short: rows fired for
  what alphaTab's real importers put in every file, so the checker now reports only what conversion changes in what is
  seen or heard; a new row, `tempoText`, takes the tempo markings' words, and `credits` drops `tempoLabel`;
  `midiChannels` reports only a track that is not a kit on channel 9; `restVoices` moves to the conversion group; and
  the mapper keeps a natural harmonic's pitch (`services/natural-harmonics.ts`).
- **Task C.1** (`4780fd3`).
  - The progression's three doors - the strip's Add progression track and Update, and the progression page's Send - go
    through `requestEdit` (`ASKING_PAGE_COMMANDS.progressionTrack`), since `sendProgression` does not move
    `documentId`. A held Send projects the progression again when it runs, after Convert.
  - A request asked on the composer page is cancelled with the page; a second request while one waits is dropped.
  - Measuring the loss no longer stops a file opening: a throw is reported, and the prompt lists one `unmeasured` item.
  - The prompt splits the loss into its two groups when the file changes, not on every check; an open, untouched
    alphaTex panel reseeds when a file opens; and an export of the file that throws leaves the panel empty.
  - Superseded and not corrected in the block: `ComposerGpService`'s header comment still lists "a progression sent
    over" among what moves `documentId`. The committed comment says it does not, and why it is gated instead.
- **Task D.1** (`5782620`). Writes to both IndexedDB libraries settle when their transaction commits (`committed`, in
  `services/indexed-db.ts`), not on the request's success; `updateEntry` reads and writes in one transaction; a failed
  open, or a `versionchange` from another tab, lets the connection go so the next call opens it again; and the specs
  wait until their databases are really deleted (`indexed-db.spec-helper.ts`).
- **Task D.2** (`9c7f299`).
  - Convert never sticks: a throw is reported and said in the status line, and `converting` clears in `finally`.
  - Nothing cancels a conversion under way: Cancel and Save the original file first are disabled (`busy`), Escape and the
    backdrop do nothing, and the page stays inert.
  - The page is given the document read back from the alphaTex that was saved, so it is what the library holds; a
    mapper that throws refuses the conversion.
  - The status line says the file converted beside the edit's own refusal, or that the edit could not be applied.
  - A list refresh failing after a committed write is logged, not thrown, in both libraries.
  - A held Send refuses a projection that runs past the bound in the composer's status line (`SEND_TRUNCATED`).
- **Task E.1** (`2c451c2`).
  - A file dropped over a modal - the prompt, a conversion under way, the shortcut sheet - is refused out loud.
  - The file shows before its library entry is corrected; one open runs at a time; a file or library that cannot be read
    says so.
  - A drop of several files says how many other Guitar Pro files, and how many other files, it left.
  - Import .gp…'s `accept` and the name test share `GP_FILE_EXTENSIONS`; the drawer is "Library", opened by "Browse the
    library…"; and Import .gp… gives the focus back to the Library button.
  - Specs no longer open the real `gp-library` database; `gp-file-opener.service.spec.ts` is new.
- **Task F.1** (`adb2b36`, `6b87f9f`).
  - A change to mute or solo alone is drawn as an overlay (`differsOnlyInMixer`), not a render, so the MIDI is not
    reloaded and playback keeps going. It is compared by walking both documents, not by serialising them.
  - Show / hide redraws with `renderTracks`, which keeps the MIDI.
  - The hidden set keeps only tracks the document still has, never covers every track, starts again when a document is
    replaced, and is carried across Convert by the file's track order (`carryThroughConvert`).
  - The caret moves off a track as it is hidden, a hidden row's click refuses, and keyboard track moves pass over hidden
    tracks (`passOverTracks`).
  - Mutes and solos are sent offs before ons, since tracks share MIDI channels; the player's mixer is left alone until a
    page sets it, and forgotten on `dispose`.
  - Show / hide is named "Show <track>" with `aria-pressed`; the rows read the composer's current document.
- **Task G.1** (`79ff184`).
  - The select holds the option itself (`ngValue`), not its id: the Diminished and Augmented triads share ids with
    scales, so a triad picked was found again as the scale.
  - Dead notes, and heads on slash and numbered bands, are not marked; a beat or note the lookup lost is skipped.
  - The Scales menu closes as Library and Export do: Escape from a capture listener, a modal opening, and it closes an
    open popover as it opens.
  - The page is measured once per redraw rather than per note head, and unchanged rings are left as they are; the
    root's ring is a red double ring, told apart without its colour.
- **Task H.1** (`d13ec27`).
  - The seek bar steps by a second (`step` 1000).
  - Dragging the seek bar or the speed slider moves a draft; the player is set once, on `change`.
  - The readouts are `aria-hidden` spans, not `<output>` live regions read out every second; the sliders are disabled
    until the player is ready; position events mark for check rather than running change detection.
  - `clockTimeOf` reads a time that is not a finite number as `0:00`.
  - `movesFocusedSlider` was made to ask `:focus-visible`; the hand check undid that (the last entry).
- **Task I.1** (`05fc2f7`).
  - The `/gp-viewer` redirect is a function in its own module (`gp-viewer-redirect.ts`) returning a `UrlTree`, with
    specs: the string redirect read an id starting with `:` as a route parameter and dropped it.
  - `gp-file-name.ts` holds the extension test, so the gallery's chunk no longer imports alphaTab.
  - `AlphaTabService.pause` and `reset`, which only the viewer called, go; the project skills under `.claude/skills/`
    are updated for the viewer's removal.
- **After the hand check** (`4f40809`).
  - A focused range slider owns its arrow keys however it was focused. Chrome turns `:focus-visible` on at the key
    press, so the H.1 review's exception for a mouse-focused slider never took effect.
  - A backing track is its own loss row, `backingTrack` ("Backing track", "the audio is not kept"), and no longer
    counts as a sync point: a file synced once read "2 sync points" and never said its audio went.
- **After the final review** (`5a2686b`, `b2d77cc`, `995f1c2`, and the `chore:` commit after them).
  - The file has its own caret (`ComposerGpService.caret`). In Original, `ComposerService.setCursor` clamped presses to
    the empty composition under the file, so the caret sat at bar 1: a click seeked there, selection and Pen's hover
    were inert, and the edit that asked was written over the file's first beat after Convert. `ComposerService` now
    lends its caret commands to the file while it is shown (`lendCaret`), over `toDoc` of the file; the score draws,
    seeks and hovers from that caret, the status line and the strip read it, and Convert puts the composition in place
    with it (`DocumentReplacement.selection`) before the edit that asked runs. The hidden-track step still wins.
  - Original renders the `Score` the opener read (`renderScore`) instead of handing alphaTab the bytes, which it parsed
    again synchronously on the main thread; `loadBytes` and `ALL_TRACKS` go.
  - The GP library publishes `GpLibrarySummary`, an entry without its bytes, read through a cursor; the read cost is in
    `docs/TODO.md`.
  - Show / hide is checked against a real engraving (`composer-score-systems.spec.ts`); `AlphaTabState` drops
    `score`, `selectedTracks` and `tickPosition`, which nothing read; design Part 6 says a missing `?gp=<id>` is
    refused, as the code does; and the composer library holds the open entry by `documentId`
    (`ComposerLibraryService.rememberOpen`), so Save after leaving the page and coming back no longer makes a second
    composition.

## Before you start

**Worktree.** Everything happens in `.worktrees/gp-composer` on `feature/gp-composer`, from `4ac17a9`: the merge of
`main` - the palette restyle and the docs of what shipped - over `0487b27`, which holds the design's build steps 1 and 2
and the ask-first predicate:

| Commit | What |
|---|---|
| `250107c` | karma's ping and inactivity timeouts, for whole-suite runs |
| `9229449` | Step 1: `loadBytes` and every track drawn |
| `3097ef1` | Step 2: `ComposerGpService`, the Original state, the status line |
| `0487b27` | `composer-edit-intent.ts`: which commands change the document |

Baseline there: **3,383 specs, 0 failures**. The merge touches no file the plan's code does.

**Running specs** (from `client/`). One file, or several with one `--include` each:

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/gp-conversion-loss.spec.ts
```

Everything:

```bash
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | sed 's/\x1b\[[0-9;]*[mAK]//g' | grep -E "FAILED$|TOTAL" | grep -v Executed
```

**Type-checking** (from `client/`): `npx tsc -p tsconfig.app.json --noEmit`, then `npx tsc -p tsconfig.spec.json --noEmit`.
Run both: the app config excludes specs, and the spec config leaves out any file no spec imports. A template error only
shows in a build: `npx ng build --configuration development`.

**Commits.** `<type>: <description>`, and every message ends with a blank line and
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `client/yarn.lock`: a checkout rewrites its line
endings, and nothing in this plan changes it.

**House style.** Read `CLAUDE.md`: pure derivations are named for what they return; comments explain why, generously; 1000
lines per file at most; standalone OnPush components; `takeUntil` for subscriptions; CSS custom properties, in
component-scoped styles; no `!` assertion in application code without a reason given.

**How the code blocks are marked.** Every block that changes a file is preceded by an HTML comment the rendered plan
hides: `<!-- apply: create PATH -->` (write the whole file), `<!-- apply: find PATH -->` followed by
`<!-- apply: replace PATH -->` (exact text, which occurs exactly once in the file as the earlier blocks of the task have
left it; line endings are the file's own, compared as LF), and `<!-- apply: delete PATH -->`. Read them as
instructions; they are also what the proof below applied, mechanically and in order.

### The proof

This plan's code was built first, task by task on a branch of its own (`proof/gp-composer`), and the blocks below were
generated from those commits. Then the plan itself was applied, from a clean `0487b27`, by a script reading those markers
- every block, and nothing else - task by task:

- after each task's Step 1 (its specs alone), the spec type check or the task's specs were run, to see the red the
  task's Step 2 names;
- after each task's Step 3, both type checks, the task's specs, and the whole suite.

At the end the tree the plan built was compared with the branch it was generated from: **identical**. The plan was
then applied again from `4ac17a9`, after `main` was merged in, and the tree it built compared with the proof branch
merged the same way: **identical**, and the whole suite there **3,543 SUCCESS**. The code was not merged into
`feature/gp-composer`; nothing but documentation was committed with the plan.

| Task | After Step 1 | After Step 3: its specs | Whole suite |
|---|---|---|---|
| 0.1 | the specs fail | TOTAL: 13 SUCCESS | TOTAL: 3384 SUCCESS |
| A.1 | 30 errors in the spec type check | TOTAL: 149 SUCCESS | TOTAL: 3395 SUCCESS |
| A.2 | 11 errors in the spec type check | TOTAL: 35 SUCCESS | TOTAL: 3410 SUCCESS |
| B.1 | 10 errors in the spec type check | TOTAL: 71 SUCCESS | TOTAL: 3465 SUCCESS |
| C.1 | 20 errors in the spec type check | TOTAL: 155 SUCCESS | TOTAL: 3484 SUCCESS |
| D.1 | 8 errors in the spec type check | TOTAL: 7 SUCCESS | TOTAL: 3491 SUCCESS |
| D.2 | 5 errors in the spec type check | TOTAL: 66 SUCCESS | TOTAL: 3498 SUCCESS |
| E.1 | 7 errors in the spec type check | TOTAL: 124 SUCCESS | TOTAL: 3509 SUCCESS |
| F.1 | 13 errors in the spec type check | TOTAL: 101 SUCCESS | TOTAL: 3523 SUCCESS |
| G.1 | 8 errors in the spec type check | TOTAL: 76 SUCCESS | TOTAL: 3536 SUCCESS |
| H.1 | 2 errors in the spec type check | TOTAL: 95 SUCCESS | TOTAL: 3543 SUCCESS |
| I.1 | nothing fails: the specs only follow a removal | TOTAL: 15 SUCCESS | TOTAL: 3543 SUCCESS |

The tree the plan built, against `proof/gp-composer`: **identical**.

### What this plan adds

| Task | New module | What it is |
|---|---|---|
| A.1 | `services/midi-channels.ts` | `midiChannelsOf`: alphaTab's importers' channel rule, which `Score.finish` does not run |
| A.1 | `services/score-doc-mapper.percussion.spec.ts` | A drum track both ways through the mapper and alphaTex |
| A.2 | `services/edit-refusals.percussion.spec.ts` | What a percussion staff refuses, over the whole tool table |
| B.1 | `services/gp-conversion-loss.ts` | `conversionLossOf`: what converting a file would change, and what its first save would |
| C.1 | `components/composer/components/composer-convert-prompt/composer-convert-prompt.component.ts` | The conversion prompt |
| C.1 | `services/modal-focus.ts` | `ModalFocus`: a modal's focus, shared by the shortcut sheet and the prompt |
| D.2 | `services/gp-conversion.service.ts` | `GpConversionService`: Convert, in the design's order |
| E.1 | `services/gp-file-opener.service.ts` | `GpFileOpener`: every way a `.gp` file comes in |
| F.1 | `services/composer-track-rows.ts` | `trackRowsOf`, `renderedTracksOf`, `hideRefusalOf` |
| F.1 | `services/composer-track-view.service.ts` | `ComposerTrackViewService`: which tracks are hidden, and the player's mutes in Original |
| G.1 | `components/composer/components/composer-scale-panel/composer-scale-panel.component.ts` | The Scales menu |
| G.1 | `services/scale-highlight.ts` | `pitchClassesOf`, `noteHighlightsOf` |
| H.1 | `services/transport-time.ts` | `clockTimeOf`, `SPEED_RANGE` |

## Corrections to the design, found while building it

The design was written before any of this code. Building it disproved or refined these readings; each task below is
written to the corrected version, and Task J.1 records them in the design doc.

1. **`InstrumentArticulation.create` is not in `alphaTab.d.ts`.** The design's Part 3 has the mapper rebuild a kit
   with it. It exists in the bundle but not the typings; the public constructor takes the same fields with the id
   last, and the mapper uses that (Task A.1).
2. **A score the composer builds plays every track on MIDI channel 0.** alphaTab assigns channels in
   `ModelUtils.consolidate` (`alphaTab.core.mjs` ~4315), which only its importers run - `Score.finish` does not, and
   `ModelUtils` is not exported. The design says `Score.finish` puts a drum track on channel 9; it does not, so a
   converted kit would have played as pitched notes on program 0 - and every multi-track composition already shared
   one channel, so one program, whichever was set last. Found, not caused, by this milestone. `midi-channels.ts`
   copies `consolidate`'s rule, the mapper applies it in `toScore`, and the loss checker compares a file's own
   channels against it (Tasks A.1, B.1).
3. **A drum track keeps its clef.** The design expects `Clef.Neutral` on a percussion staff. alphaTex writes and
   reads `\clef g2` on one, and the mapper's round trip keeps whatever the file had; the spec asserts that, not neutral.
4. **Per-note dynamics are not a loss.** `Beat.finish` copies each beat's dynamic onto its notes (~7811), so a parsed
   file has none of its own. The design's row goes; a spec pins why.
5. **The "kit the file invents" row is exact, not an exposure count.** The design counts every note indexing a
   declared kit, since alphaTab's table is out of reach. But alphaTab's own exporter and importer are not: the checker
   writes a one-note score of each distinct articulation as alphaTex, reads it back and compares. That also catches
   a case the design missed - a standard id with a changed staff line, notehead or MIDI key, which the reload
   silently replaces with the table's. Renamed `unsavableKit` (Task B.1).
6. **Three silent losses beyond the design's tables**, found in `alpha-tab-enum.bridge.ts`: dynamics outside ppp-fff
   (sfz, pppp, fp and the rest) read as none and play forte; a bend grace reads as no grace and becomes a full beat;
   a feedback harmonic reads as none. Each is a row (Task B.1).
7. **The first beat's instrument automation is alphaTab's.** `Beat.finish` puts one on every track's first beat from
   its program (~7765), and on a drum track from the program before `Track.finish` zeroed it. The checker keeps it, or
   every file would report an instrument change (Task B.1). Likewise a first-beat volume, balance or bank automation
   equal to the track's own, which a GP5 mix table on bar 1 puts there (~20525-20540).
8. **The checker takes the converted document as a second argument.** Its "notes no string reaches" row can only be
   counted by `frettedDocOf` on `toDoc(score)`, which now also returns the first bar it dropped a note from.
9. **Every writing path in the page asks, not only the tool table.** `changesDocument` answers for a command id; the
   gate that asks it is `ComposerGpService.requestEdit`, and a popover's value, Pen's write, the strip's Add track,
   an alphaTex apply and Save each go through it. `ASKING_PAGE_COMMANDS` gains `penWrite` (Task C.1).
10. **Original ends by itself.** Rather than every path that opens a composition remembering to leave Original, the
    service follows `ComposerState.documentId` and clears itself when it moves - which Convert's `replaceDocument`
    does, so step 5 of Part 4 needs no code (Tasks C.1, D.2). A progression sent over does not move it:
    `sendProgression` is a plain commit into the empty composition under the file. So its three doors - the strip's
    Add progression track and Update, and the progression page's Send - are gated instead (`ASKING_PAGE_COMMANDS`
    gains `progressionTrack`), and Send's request waits for the composer page to show it on arrival.
11. **The GP library could say it deleted a file it had not.** `updateEntry`, `deleteEntry` and `clearLibrary`
    resolved having done nothing when the database was still opening - a "found while designing" item that Convert's
    one irreversible step would have trusted. Fixed before Convert, with the specs Part 7 asked for (Task D.1).
12. **A file opens over a fresh page.** The design does not say what composition sits under the Original state.
    Opening a file resets the composer first, so the library panel forgets the entry it had, and nothing the user
    saves later can land on the composition that was open before (Task E.1).
13. **Files are parsed before the page is touched**, with `ScoreLoader.loadScoreFromBytes`, rather than through the
    api's `error` event: a file alphaTab cannot read is refused before any library entry is written (Task E.1).
14. **Mute and solo in Original stay the player's, and end with it.** Decision 16's second half - re-applying the
    strip's player mutes on top of the converted composition - cannot hold: every edit re-renders, and each render
    re-applies the document's own mixer. The composition starts from the mixer the file declares, which is the half
    that can hold. And the player never reads a score's `PlaybackInformation.isMute` at all - only `changeTrackMute`
    reaches it - so `AlphaTabService.setTrackPlayback` keeps the mixer the page wants and puts it back after every MIDI
    load (Task F.1).
15. **The scale panel is a menu off the top bar**, like Library and Export, rather than a row beside the alphaTex
    panel: it takes no height from the score or the strip, and the strip's fitting needs nothing new (Task G.1).
16. **The Original state's status line counted the wrong bars.** Step 2 left the caret readout's "of N" reading the
    empty composition under the file. Found in the hand check; fixed first (Task 0.1).

---

## Phase 0: The Original state, finished

Step 2 left one reading of the empty document behind; it is fixed before anything builds on it.

### Task 0.1: The status line counts the file's bars

In Original the page draws the file, but the status line's caret readout - "Bar 1 of 4" - counts the bars
of the empty composition `ComposerService` holds underneath it, and would measure that document's bars against their
time signatures. The hand check caught it only because its file happened to have four bars too.

The page passes the file's bar count when there is a file (`fileBarCount`), and the status line uses it in place of the
document's and measures nothing, as the design's Part 1 table says ("Bars over their time signature: not shown").

**Files** (under `client/src/app/` unless given in full):
- Modify: `components/composer/components/composer-status-line/composer-status-line.component.spec.ts`, `components/composer/components/composer-status-line/composer-status-line.component.ts`, `components/composer/composer.component.html`

**Step 1: The failing specs.**

`client/src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts -->
```ts

    expect(fixture.nativeElement.querySelector('.original')).toBeNull();
  });

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts -->
```ts

    expect(fixture.nativeElement.querySelector('.original')).toBeNull();
  });

  it("counts the file's bars in Original, not the empty document's, and measures none against a time signature", () => {
    fixture.componentRef.setInput('cursor', createDefaultCursor());
    fixture.componentRef.setInput('doc', ComposerService.createEmptyScore());
    fixture.componentRef.setInput('fileBarCount', 12);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.readout')?.textContent?.trim()).toBe('Bar 1 of 12 · Beat 1');
    expect(fixture.nativeElement.querySelector('.over-bars')).toBeNull();
  });

```

**Step 2: Watch them fail.** The spec type check is clean; the specs themselves fail:

```text
TOTAL: 1 FAILED, 12 SUCCESS | Chrome Headless 154.0.0.0 (Windows 10) ComposerStatusLineComponent counts the file's bars in Original, not the empty document's, and measures none against a time signature FAILED
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts -->
```ts
   */
  @Input() viewingOriginal = false;

  /** "2 bars over their time signatures", or null when none is. Measured when the document changes, not per check. */
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts -->
```ts
   */
  @Input() viewingOriginal = false;
  /**
   * In Original, how many bars the file has: the document behind the page then is the empty one `ComposerService` holds,
   * not the file, so its bars are not the ones the caret moves over. Null in Composition.
   */
  @Input() fileBarCount: number | null = null;

  /** "2 bars over their time signatures", or null when none is. Measured when the document changes, not per check. */
```

<!-- apply: find client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts -->
```ts

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['doc']) return;
    this.barCount = this.doc?.masterBars.length ?? 0;
    const over = this.doc ? overBarCountOf(this.doc) : 0;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-status-line/composer-status-line.component.ts -->
```ts

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['doc'] && !changes['fileBarCount']) return;
    // In Original nothing is measured against a time signature: `scoreBarFills` reads a document, and there is none.
    if (this.fileBarCount !== null) {
      this.barCount = this.fileBarCount;
      this.overBarsLabel = null;
      return;
    }
    this.barCount = this.doc?.masterBars.length ?? 0;
    const over = this.doc ? overBarCountOf(this.doc) : 0;
```

`client/src/app/components/composer/composer.component.html`:

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
    [doc]="s.doc"
    [viewingOriginal]="viewingOriginal"
  ></app-composer-status-line>

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
    [doc]="s.doc"
    [viewingOriginal]="viewingOriginal"
    [fileBarCount]="original?.score?.masterBars?.length ?? null"
  ></app-composer-status-line>

```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/components/composer-status-line/composer-status-line.component.spec.ts
```

Expected: `TOTAL: 13 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3384 SUCCESS`.

**Step 6: Commit.**

```text
fix: Count the file's bars in the Original state's status line

The readout said the empty composition's bar count beside the caret, and
measured bars over their time signature in a document that is not what the
page shows. In Original it counts the file's bars and measures none.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase A: Percussion in the model

Build step 3, in the design's two commits: the model and the mapper, then the editing edges.

### Task A.1: Percussion through the model and the mapper

The design's Part 3, first commit. A drum track was the one row of the loss tables that converted *wrong*:
alphaTab leaves `tone` and `octave` at -1 on a drum note, so `fromNote` read every hit as
`{ kind: 'pitched', noteValue: -1, octave: -2 }`, and `toStaff` never set `isPercussion`.

`NotePitch` gains a third kind, `{ kind: 'percussion'; articulation }`, carrying `Note.percussionArticulation` verbatim -
an index into the track's kit when it is below the kit's length, an id in alphaTab's own table otherwise, and the mapper
does not care which. `TrackDoc` gains `percussionArticulations` (the kit, field by field, in order: a note's index points
into it) and `StaffDoc` gains `isPercussion` and `lineCount`. The four places that build a track or staff by hand get the
new fields, and every module that branched `fretted ? … : pitched` says which of the other two it means - the compiler
lists them, which is the point of a third kind.

`soundingMidiOf` and `drawnPitchClassOf` gain overloads: given a fretted or pitched literal they still return a number,
given any `NotePitch` they return `number | null`, null for a drum hit, which has no pitch. `trillTargetOf` follows. So the
fret digits, which pass a fretted literal, change not at all, and every caller that reads a note from a document has to
say what a drum does.

The mapper also assigns MIDI channels now (correction 2): `midi-channels.ts` is `ModelUtils.consolidate`'s rule, and
without it the converted kit would play on channel 0.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/midi-channels.ts`, `services/score-doc-mapper.percussion.spec.ts`
- Modify: `models/composer.model.ts`, `services/composer-entry-commands.ts`, `services/composer-export.service.spec.ts`, `services/composer.service.ts`, `services/edit-refusals.ts`, `services/harmonic-eval/two-tier-equivalence.spec.ts`, `services/note-edits.ts`, `services/note-landing.ts`, `services/note-moves.ts`, `services/note-respell.ts`, `services/pitch-on-strings.ts`, `services/progression-score.ts`, `services/progression-track.spec.ts`, `services/score-derivation.ts`, `services/score-doc-mapper.effects.spec.ts`, `services/score-doc-mapper.ghost-voice.spec.ts`, `services/score-doc-mapper.service.spec.ts`, `services/score-doc-mapper.service.ts`, `services/score-doc-mapper.spelling.spec.ts`

**Step 1: The failing specs.**

`client/src/app/services/composer-export.service.spec.ts`:

<!-- apply: find client/src/app/services/composer-export.service.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
        staves: [
          {
```

becomes

<!-- apply: replace client/src/app/services/composer-export.service.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
        percussionArticulations: [],
        staves: [
          {
```

<!-- apply: find client/src/app/services/composer-export.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            bars: [
              bar([quarterNote(0, 4), quarterNote(4, 4), quarterNote(7, 4), quarterNote(0, 5)])
```

becomes

<!-- apply: replace client/src/app/services/composer-export.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              bar([quarterNote(0, 4), quarterNote(4, 4), quarterNote(7, 4), quarterNote(0, 5)])
```

<!-- apply: find client/src/app/services/composer-export.service.spec.ts -->
```ts
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        staves: [
          {
```

becomes

<!-- apply: replace client/src/app/services/composer-export.service.spec.ts -->
```ts
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        percussionArticulations: [],
        staves: [
          {
```

<!-- apply: find client/src/app/services/composer-export.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            bars: [
              bar([quarterNote(0, 3), quarterNote(3, 3), quarterNote(7, 3), quarterNote(0, 4)])
```

becomes

<!-- apply: replace client/src/app/services/composer-export.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              bar([quarterNote(0, 3), quarterNote(3, 3), quarterNote(7, 3), quarterNote(0, 4)])
```

`client/src/app/services/harmonic-eval/two-tier-equivalence.spec.ts`:

<!-- apply: find client/src/app/services/harmonic-eval/two-tier-equivalence.spec.ts -->
```ts
                note.pitch.kind === 'fretted'
                  ? `s${note.pitch.string}f${note.pitch.fret}`
                  : `p${note.pitch.noteValue}o${note.pitch.octave}`
              )
        )
```

becomes

<!-- apply: replace client/src/app/services/harmonic-eval/two-tier-equivalence.spec.ts -->
```ts
                note.pitch.kind === 'fretted'
                  ? `s${note.pitch.string}f${note.pitch.fret}`
                  : note.pitch.kind === 'pitched'
                    ? `p${note.pitch.noteValue}o${note.pitch.octave}`
                    : `a${note.pitch.articulation}`
              )
        )
```

`client/src/app/services/progression-track.spec.ts`:

<!-- apply: find client/src/app/services/progression-track.spec.ts -->
```ts
    color: '#3498db',
    playback: createDefaultPlaybackInfo(0),
    staves: [
      {
```

becomes

<!-- apply: replace client/src/app/services/progression-track.spec.ts -->
```ts
    color: '#3498db',
    playback: createDefaultPlaybackInfo(0),
    percussionArticulations: [],
    staves: [
      {
```

<!-- apply: find client/src/app/services/progression-track.spec.ts -->
```ts
        showSlash: false,
        showNumbered: false,
        bars: Array.from({ length: bars }, () => createDefaultBar(false, meter))
      }
```

becomes

<!-- apply: replace client/src/app/services/progression-track.spec.ts -->
```ts
        showSlash: false,
        showNumbered: false,
        isPercussion: false,
        lineCount: 5,
        bars: Array.from({ length: bars }, () => createDefaultBar(false, meter))
      }
```

`client/src/app/services/score-doc-mapper.effects.spec.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.effects.spec.ts -->
```ts
          color: '#e74c3c',
          playback: createDefaultPlaybackInfo(25),
          staves: [
            {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.effects.spec.ts -->
```ts
          color: '#e74c3c',
          playback: createDefaultPlaybackInfo(25),
          percussionArticulations: [],
          staves: [
            {
```

<!-- apply: find client/src/app/services/score-doc-mapper.effects.spec.ts -->
```ts
              showSlash: false,
              showNumbered: false,
              bars: [
                {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.effects.spec.ts -->
```ts
              showSlash: false,
              showNumbered: false,
              isPercussion: false,
              lineCount: 5,
              bars: [
                {
```

`client/src/app/services/score-doc-mapper.ghost-voice.spec.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.ghost-voice.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(33),
        generated: null,
        staves: [
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.ghost-voice.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(33),
        percussionArticulations: [],
        generated: null,
        staves: [
```

<!-- apply: find client/src/app/services/score-doc-mapper.ghost-voice.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            bars: [
              bar([
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.ghost-voice.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              bar([
```

`client/src/app/services/score-doc-mapper.percussion.spec.ts`, new:

<!-- apply: create client/src/app/services/score-doc-mapper.percussion.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { PERCUSSION_CHANNEL } from './midi-channels';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { NoteDoc, ScoreDoc, createDefaultBar, createDefaultMasterBar, createDefaultPlaybackInfo } from '../models/composer.model';

/**
 * A drum track, both ways through the mapper and through the alphaTex a save writes.
 *
 * alphaTab keeps a drum note in one number (`Note.percussionArticulation`), a kit in one list
 * (`Track.percussionArticulations`) and a drum staff in one flag (`Staff.isPercussion`). The number is an index into the
 * list when it is below the list's length and an id in alphaTab's own table otherwise, and the two shapes come from
 * different importers - a GP7 file declares its kit, a gp3-gp5 file declares none - so both are built here, and the mapper
 * must not care which. There is no `.gp` fixture in the repo; the first shape is built from alphaTex, which the composer
 * already wraps, and the second straight from `alphaTab.model`, as the design's Part 7 says.
 */
describe('ScoreDocMapperService percussion', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;
  let settings: alphaTab.Settings;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
    settings = new alphaTab.Settings();
  });

  /** A kit declared by the file: kick and closed hi-hat together, then a snare, then a half rest. */
  function declaredKit(): alphaTab.model.Score {
    const { score } = tex.parse(
      ['\\track "Drums" {instrument percussion}', '\\articulation defaults', '("Kick (hit)" "Hi-Hat (closed)").4 "Snare (hit)".4 r.2 |'].join('\n')
    );
    if (!score) throw new Error('the kit did not parse');
    return score;
  }

  /** A gp3-gp5 drum track: no kit list, and each note carrying an id from alphaTab's own table. */
  function kitById(ids: readonly number[], lineCount = 5): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    score.addMasterBar(new alphaTab.model.MasterBar());
    const track = new alphaTab.model.Track();
    const staff = new alphaTab.model.Staff();
    staff.isPercussion = true;
    staff.standardNotationLineCount = lineCount;
    track.addStaff(staff);
    score.addTrack(track);
    const bar = new alphaTab.model.Bar();
    staff.addBar(bar);
    const voice = new alphaTab.model.Voice();
    bar.addVoice(voice);
    for (const id of ids) {
      const beat = new alphaTab.model.Beat();
      beat.duration = alphaTab.model.Duration.Quarter;
      const note = new alphaTab.model.Note();
      note.percussionArticulation = id;
      beat.addNote(note);
      voice.addBeat(beat);
    }
    score.finish(settings);
    return score;
  }

  const hits = (doc: ScoreDoc): NoteDoc['pitch'][][] =>
    doc.tracks[0].staves[0].bars[0].voices[0].beats.map(beat => beat.notes.map(note => note.pitch));

  const notesOf = (score: alphaTab.model.Score): alphaTab.model.Note[] =>
    score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(beat => beat.notes);

  it('reads a drum note as percussion, not as the pitch alphaTab leaves at -1', () => {
    const doc = mapper.toDoc(declaredKit());

    expect(hits(doc)).toEqual([
      [
        { kind: 'percussion', articulation: 0 },
        { kind: 'percussion', articulation: 1 }
      ],
      [{ kind: 'percussion', articulation: 2 }],
      []
    ]);
  });

  it("copies a declared kit field by field, in the file's order", () => {
    const score = declaredKit();
    const doc = mapper.toDoc(score);

    expect(doc.tracks[0].percussionArticulations).toEqual(
      score.tracks[0].percussionArticulations.map(articulation => ({
        id: articulation.id,
        elementType: articulation.elementType,
        staffLine: articulation.staffLine,
        noteHeadDefault: articulation.noteHeadDefault,
        noteHeadHalf: articulation.noteHeadHalf,
        noteHeadWhole: articulation.noteHeadWhole,
        techniqueSymbol: articulation.techniqueSymbol,
        techniqueSymbolPlacement: articulation.techniqueSymbolPlacement,
        outputMidiNumber: articulation.outputMidiNumber
      }))
    );
    expect(doc.tracks[0].percussionArticulations.map(articulation => `${articulation.elementType}.${articulation.id}`)).toEqual([
      'Acoustic Kick Drum.35',
      'Charley.42',
      'Snare.38'
    ]);
  });

  it('reads the staff as percussion, with its line count and no tuning', () => {
    const staff = mapper.toDoc(declaredKit()).tracks[0].staves[0];

    expect(staff.isPercussion).toBeTrue();
    expect(staff.lineCount).toBe(5);
    expect(staff.tuning).toEqual([]);
    expect(staff.showTablature).toBeFalse();
  });

  it('writes a declared kit back as it was read: the numbers, the list, the flag and the clef', () => {
    const read = declaredKit();
    const written = mapper.toScore(mapper.toDoc(read), settings);

    const track = written.tracks[0];
    expect(track.percussionArticulations.map(articulation => articulation.uniqueId)).toEqual(
      read.tracks[0].percussionArticulations.map(articulation => articulation.uniqueId)
    );
    expect(notesOf(written).map(note => note.percussionArticulation)).toEqual([0, 1, 2]);
    expect(notesOf(written).every(note => note.isPercussion && !note.isStringed && !note.isPiano)).toBeTrue();
    expect(track.staves[0].isPercussion).toBeTrue();
    expect(track.staves[0].standardNotationLineCount).toBe(5);
    expect(track.staves[0].bars[0].clef).toBe(read.tracks[0].staves[0].bars[0].clef);
  });

  it('puts a drum track on channel 9 with program 0, which is what makes it sound as a kit', () => {
    const written = mapper.toScore(mapper.toDoc(declaredKit()), settings);

    const playback = written.tracks[0].playbackInfo;
    expect(playback.primaryChannel).toBe(PERCUSSION_CHANNEL);
    expect(playback.secondaryChannel).toBe(PERCUSSION_CHANNEL);
    expect(playback.program).toBe(0);
  });

  it('reads and writes a kit with no list, whose notes are ids in alphaTab\'s own table', () => {
    const read = kitById([38, 42, 36]);
    const doc = mapper.toDoc(read);

    expect(doc.tracks[0].percussionArticulations).toEqual([]);
    expect(hits(doc)).toEqual([
      [{ kind: 'percussion', articulation: 38 }],
      [{ kind: 'percussion', articulation: 42 }],
      [{ kind: 'percussion', articulation: 36 }]
    ]);

    const written = mapper.toScore(doc, settings);
    expect(written.tracks[0].percussionArticulations.length).toBe(0);
    expect(notesOf(written).map(note => note.percussionArticulation)).toEqual([38, 42, 36]);
    expect(notesOf(written).every(note => note.isPercussion)).toBeTrue();
    expect(written.tracks[0].playbackInfo.primaryChannel).toBe(PERCUSSION_CHANNEL);
  });

  it('keeps a line count other than five', () => {
    const doc = mapper.toDoc(kitById([56], 1));

    expect(doc.tracks[0].staves[0].lineCount).toBe(1);
    expect(mapper.toScore(doc, settings).tracks[0].staves[0].standardNotationLineCount).toBe(1);
  });

  it('ties two hits of one drum, since alphaTab chains a percussion note by its articulation', () => {
    const doc = mapper.toDoc(kitById([38, 38]));
    doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].isTied = true;

    const [first, second] = notesOf(mapper.toScore(doc, settings));
    expect(second.isTieDestination).toBeTrue();
    expect(second.tieOrigin).toBe(first);
  });

  describe('MIDI channels', () => {
    /** A one-staff track of `program`, pitched or a kit, with one empty bar. */
    function trackDoc(id: string, program: number, isPercussion: boolean): ScoreDoc['tracks'][number] {
      return {
        id,
        name: id,
        shortName: id,
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(program),
        staves: [
          {
            tuning: [],
            tuningLabel: '',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            isPercussion,
            lineCount: 5,
            bars: [createDefaultBar(false)]
          }
        ],
        generated: null,
        percussionArticulations: []
      };
    }

    it('gives every pitched track channels of its own and never 9, as the importers do', () => {
      const doc: ScoreDoc = {
        title: '',
        subTitle: '',
        artist: '',
        album: '',
        tempo: 120,
        masterBars: [createDefaultMasterBar()],
        tracks: [trackDoc('gtr', 25, false), trackDoc('drums', 0, true), trackDoc('bass', 33, false), trackDoc('pno', 0, false)]
      };

      const channels = mapper.toScore(doc, settings).tracks.map(track => [track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel]);

      expect(channels).toEqual([
        [0, 1],
        [9, 9],
        [2, 3],
        [4, 5]
      ]);
    });
  });

  describe('through alphaTex', () => {
    it('saves a kit and reads it back unchanged, and a second save is byte-identical', () => {
      const doc = mapper.toDoc(declaredKit());
      const saved = tex.export(mapper.toScore(doc, settings));
      const { score: reloaded } = tex.parse(saved);
      if (!reloaded) throw new Error('the saved kit did not parse');

      const again = mapper.toDoc(reloaded);
      expect(hits(again)).toEqual(hits(doc));
      expect(again.tracks[0].percussionArticulations).toEqual(doc.tracks[0].percussionArticulations);
      expect(again.tracks[0].staves[0].isPercussion).toBeTrue();
      expect(again.tracks[0].staves[0].lineCount).toBe(5);
      expect(reloaded.tracks[0].playbackInfo.primaryChannel).toBe(PERCUSSION_CHANNEL);
      expect(tex.export(mapper.toScore(again, settings))).toBe(saved);
    });

    /**
     * The one hole in it, pinned so it cannot be designed away: the exporter writes `\articulation defaults` and never
     * the track's own list, and names each note from alphaTab's table, so an articulation the table has no name for is
     * written `"unknown"` - and reading that back throws, so the whole composition fails to open. The conversion parses
     * its own alphaTex back before it deletes the `.gp` for exactly this reason (design Part 3 and Part 4).
     */
    it('writes an articulation the file invents as "unknown", which does not parse back', () => {
      const doc = mapper.toDoc(declaredKit());
      doc.tracks[0].percussionArticulations.push({
        id: 999,
        elementType: 'Mystery',
        staffLine: 5,
        noteHeadDefault: 0,
        noteHeadHalf: 0,
        noteHeadWhole: 0,
        techniqueSymbol: -1,
        techniqueSymbolPlacement: 1,
        outputMidiNumber: 77
      });
      doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes = [
        { ...doc.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0], pitch: { kind: 'percussion', articulation: 3 } }
      ];

      const saved = tex.export(mapper.toScore(doc, settings));
      expect(saved).toContain('"unknown"');

      const reloaded = tex.parse(saved);
      expect(reloaded.score).toBeNull();
      expect(reloaded.diagnostics.map(diagnostic => diagnostic.code)).toContain(209);
    });
  });
});
```

`client/src/app/services/score-doc-mapper.service.spec.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
        staves: [
          {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
        percussionArticulations: [],
        staves: [
          {
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            bars: [
              {
                clef: 'g2',
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              {
                clef: 'g2',
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        staves: [
          {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        percussionArticulations: [],
        staves: [
          {
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            bars: [
              {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              {
```

`client/src/app/services/score-doc-mapper.spelling.spec.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.spelling.spec.ts -->
```ts
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(0),
        generated: null,
        staves: [
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.spelling.spec.ts -->
```ts
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(0),
        percussionArticulations: [],
        generated: null,
        staves: [
```

<!-- apply: find client/src/app/services/score-doc-mapper.spelling.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            bars: [
              {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.spelling.spec.ts -->
```ts
            showSlash: false,
            showNumbered: false,
            isPercussion: false,
            lineCount: 5,
            bars: [
              {
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 30 errors, the first:

```text
src/app/services/composer-export.service.spec.ts(72,13): error TS2353: Object literal may only specify known properties, and 'isPercussion' does not exist in type 'StaffDoc'.
```

**Step 3: The implementation.**

`client/src/app/models/composer.model.ts`:

<!-- apply: find client/src/app/models/composer.model.ts -->
```ts
   */
  generated: GeneratedOrigin | null;
}

```

becomes

<!-- apply: replace client/src/app/models/composer.model.ts -->
```ts
   */
  generated: GeneratedOrigin | null;
  /**
   * The track's own drum kit, in the order alphaTab keeps it - `Track.percussionArticulations`. Empty on a pitched
   * track, and on a drum track whose notes name alphaTab's own table by id rather than an index into this list, which
   * is what a gp3-gp5 file gives.
   *
   * A percussion note's `articulation` below this list's length is an index into it, so the order is the data: the
   * mapper copies it field by field and rebuilds it in the same order, and nothing may sort or filter it.
   */
  percussionArticulations: ArticulationDoc[];
}

/**
 * One entry of a track's own kit, in alphaTab's own fields so the mapper copies rather than converts
 * (`alphaTab.model.InstrumentArticulation`).
 *
 * Carried whole because alphaTab's table of 95 standard articulations (`PercussionMapper`) is internal to the bundle
 * and cannot be asked to look one up: the model has to hold what a note's index points at. See "Percussion in the
 * model" in the GP-composer design doc.
 */
export interface ArticulationDoc {
  id: number;
  /** The instrument element, e.g. "Snare". With `id` it makes alphaTab's `uniqueId`, `Snare.38`. */
  elementType: string;
  /** Steps - lines and spaces - down from the top line. 1 is the top line; negative is above the staff. */
  staffLine: number;
  /** `MusicFontSymbol` values. */
  noteHeadDefault: number;
  noteHeadHalf: number;
  noteHeadWhole: number;
  /** A `MusicFontSymbol` drawn beside the notehead, or `MusicFontSymbol.None`. */
  techniqueSymbol: number;
  /** A `TechniqueSymbolPlacement`: above, below, inside or outside the staff. */
  techniqueSymbolPlacement: number;
  /** The MIDI key playback strikes on channel 9. */
  outputMidiNumber: number;
}

```

<!-- apply: find client/src/app/models/composer.model.ts -->
```ts
  showSlash: boolean;
  showNumbered: boolean;
  /** Parallel to ScoreDoc.masterBars: same length, same order. */
  bars: BarDoc[];
```

becomes

<!-- apply: replace client/src/app/models/composer.model.ts -->
```ts
  showSlash: boolean;
  showNumbered: boolean;
  /**
   * A drum staff: its notes are `percussion` pitches, it has no tuning and no tablature, and alphaTab plays it on MIDI
   * channel 9. alphaTab keeps the flag per staff and says in its own comment that it belongs on the track; the model
   * copies where alphaTab keeps it.
   */
  isPercussion: boolean;
  /** Lines in the standard-notation staff: `Staff.standardNotationLineCount`, 5 unless a part says otherwise. */
  lineCount: number;
  /** Parallel to ScoreDoc.masterBars: same length, same order. */
  bars: BarDoc[];
```

<!-- apply: find client/src/app/models/composer.model.ts -->
```ts

/**
 * alphaTex has exactly two note syntaxes - `3.3` (fret.string) and `C#4` -
 * so a discriminated union maps 1:1 onto them.
 */
export type NotePitch =
```

becomes

<!-- apply: replace client/src/app/models/composer.model.ts -->
```ts

/**
 * alphaTex has three note syntaxes - `3.3` (fret.string), `C#4`, and a drum
 * articulation's name in quotes - so a discriminated union maps 1:1 onto them.
 *
 * `percussion` is not a pitch that happens to be unpitched: a drum hit has no
 * `noteValue` and no `octave`, and alphaTab leaves both at -1 on one. Its one
 * number is `Note.percussionArticulation`, verbatim - an index into the track's
 * `percussionArticulations` when it is below that list's length, and otherwise
 * an id in alphaTab's own table. The mapper does not care which.
 */
export type NotePitch =
```

<!-- apply: find client/src/app/models/composer.model.ts -->
```ts
       */
      letter?: NoteLetter;
    };

export interface NoteDoc {
```

becomes

<!-- apply: replace client/src/app/models/composer.model.ts -->
```ts
       */
      letter?: NoteLetter;
    }
  | { kind: 'percussion'; articulation: number };

export interface NoteDoc {
```

`client/src/app/services/composer-entry-commands.ts`:

<!-- apply: find client/src/app/services/composer-entry-commands.ts -->
```ts
      return dropped;
    }
  } else {
    const existing = beat.notes.findIndex(
      n => n.pitch.kind === 'pitched' && n.pitch.noteValue === pitch.noteValue && n.pitch.octave === pitch.octave
```

becomes

<!-- apply: replace client/src/app/services/composer-entry-commands.ts -->
```ts
      return dropped;
    }
  } else if (pitch.kind === 'pitched') {
    const existing = beat.notes.findIndex(
      n => n.pitch.kind === 'pitched' && n.pitch.noteValue === pitch.noteValue && n.pitch.octave === pitch.octave
```

`client/src/app/services/composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```ts
      showSlash: false,
      showNumbered: false,
      bars: masterBars.map((_, index) =>
        createDefaultBar(fretted, effectiveTimeSignature(masterBars, index))
```

becomes

<!-- apply: replace client/src/app/services/composer.service.ts -->
```ts
      showSlash: false,
      showNumbered: false,
      isPercussion: false,
      lineCount: 5,
      bars: masterBars.map((_, index) =>
        createDefaultBar(fretted, effectiveTimeSignature(masterBars, index))
```

<!-- apply: find client/src/app/services/composer.service.ts -->
```ts
      playback: createDefaultPlaybackInfo(program),
      staves: [staff],
      generated: null
    };
  }
```

becomes

<!-- apply: replace client/src/app/services/composer.service.ts -->
```ts
      playback: createDefaultPlaybackInfo(program),
      staves: [staff],
      generated: null,
      percussionArticulations: []
    };
  }
```

`client/src/app/services/edit-refusals.ts`:

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
import { soundingMidiOf } from './pitch-on-strings';

/**
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
import { SoundingPitch, soundingMidiOf } from './pitch-on-strings';

/**
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
 * branches test `isStringed`, so a pitched note marked natural is drawn at its own pitch
 * and is read correctly here.
 */
export function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
  // A pitched note's octave adds whole octaves, which the reduction takes off again.
  return reduceToOctave(soundingMidiOf(staff, pitch) - staff.transpose - staff.displayTranspose);
}

```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
 * branches test `isStringed`, so a pitched note marked natural is drawn at its own pitch
 * and is read correctly here.
 *
 * Null for a drum hit, which is drawn at its articulation's staff line and has no pitch class at all.
 */
export function drawnPitchClassOf(staff: StaffDoc, pitch: SoundingPitch): number;
export function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number | null;
export function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number | null {
  const midi = soundingMidiOf(staff, pitch);
  // A pitched note's octave adds whole octaves, which the reduction takes off again.
  return midi === null ? null : reduceToOctave(midi - staff.transpose - staff.displayTranspose);
}

```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
  return targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return staff !== undefined && forcedLetterOf(accidental, drawnPitchClassOf(staff, note.pitch)) === undefined;
  });
}
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
  return targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    const pitchClass = staff === undefined ? null : drawnPitchClassOf(staff, note.pitch);
    return pitchClass !== null && forcedLetterOf(accidental, pitchClass) === undefined;
  });
}
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
  const tooHigh = targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return staff !== undefined && trillTargetOf(staff, note) > MIDI_TOP;
  });
  return tooHigh ? TRILL_OUT_OF_RANGE : null;
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
  const tooHigh = targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    const target = staff === undefined ? null : trillTargetOf(staff, note);
    return target !== null && target > MIDI_TOP;
  });
  return tooHigh ? TRILL_OUT_OF_RANGE : null;
```

`client/src/app/services/midi-channels.ts`, new:

<!-- apply: create client/src/app/services/midi-channels.ts -->
```ts
/**
 * Which MIDI channels each track of a score plays on, as alphaTab's importers assign them.
 *
 * alphaTab assigns channels in `ModelUtils.consolidate` (`alphaTab.core.mjs` ~4315-4335 in 1.8), which every importer
 * runs and `Score.finish` does not - and `ModelUtils` is not exported. So a score the composer built, rather than one
 * alphaTab read, kept every track on `PlaybackInformation`'s default of channel 0: the tracks shared one program,
 * whichever was set last, and a drum kit was played as pitched notes, since only channel 9 means a kit.
 *
 * Pure, and over the least a track can be described by, so the mapper that writes channels and the conversion's loss
 * checker that compares a file's own against them read one rule. The model holds no channel (`PlaybackInfoDoc`): this
 * is the whole of what decides one.
 */

/** The General MIDI channel a drum kit sounds on: alphaTab's `SynthConstants.PercussionChannel`. */
export const PERCUSSION_CHANNEL = 9;

/** A track, as far as its channels go: whether it is one percussion staff. */
export interface ChannelledTrack {
  staves: readonly { isPercussion: boolean }[];
}

/** One track's channels. */
export interface MidiChannels {
  primary: number;
  secondary: number;
}

/**
 * The channels `consolidate` gives `tracks`, in order, from alphaTab's defaults of 0 and 0: a track whose one staff is
 * percussion goes on channel 9, primary and secondary; every other track takes the lowest unused channel for each, never 9.
 */
export function midiChannelsOf(tracks: readonly ChannelledTrack[]): MidiChannels[] {
  const used = new Set<number>([PERCUSSION_CHANNEL]);
  const lowestFree = (): number => {
    let channel = 0;
    while (used.has(channel)) channel++;
    used.add(channel);
    return channel;
  };
  return tracks.map(track => {
    if (track.staves.length === 1 && track.staves[0].isPercussion) return { primary: PERCUSSION_CHANNEL, secondary: PERCUSSION_CHANNEL };
    const primary = lowestFree();
    return { primary, secondary: lowestFree() };
  });
}
```

`client/src/app/services/note-edits.ts`:

<!-- apply: find client/src/app/services/note-edits.ts -->
```ts
 * `Note.trillValue`, a MIDI number: a whole step above the note as it sounds. On a string that is the
 * open string plus the capo plus the fret, since alphaTex saves a trill as a fret relative to the
 * string with the capo included (`trillFret`); on a pitched staff, the note's own pitch.
 */
export function trillTargetOf(staff: StaffDoc, note: NoteDoc): number {
  return soundingMidiOf(staff, note.pitch) + TRILL_INTERVAL;
}

```

becomes

<!-- apply: replace client/src/app/services/note-edits.ts -->
```ts
 * `Note.trillValue`, a MIDI number: a whole step above the note as it sounds. On a string that is the
 * open string plus the capo plus the fret, since alphaTex saves a trill as a fret relative to the
 * string with the capo included (`trillFret`); on a pitched staff, the note's own pitch. Null for a drum hit, which has
 * no pitch to trill from - and alphaTab plays no trill on a percussion staff in any case.
 */
export function trillTargetOf(staff: StaffDoc, note: NoteDoc): number | null {
  const midi = soundingMidiOf(staff, note.pitch);
  return midi === null ? null : midi + TRILL_INTERVAL;
}

```

<!-- apply: find client/src/app/services/note-edits.ts -->
```ts
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    note.effects.trill = allOn || !staff ? null : { value: trillTargetOf(staff, note), speed: DEFAULT_TRILL_SPEED };
  }
}
```

becomes

<!-- apply: replace client/src/app/services/note-edits.ts -->
```ts
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    const value = allOn || !staff ? null : trillTargetOf(staff, note);
    note.effects.trill = value === null ? null : { value, speed: DEFAULT_TRILL_SPEED };
  }
}
```

`client/src/app/services/note-landing.ts`:

<!-- apply: find client/src/app/services/note-landing.ts -->
```ts
}

/** The note on `beat` alphaTab would take for `note`'s line: the same string, or pitched, the same pitch. */
function sameLineNote(beat: BeatDoc, note: NoteDoc): NoteDoc | null {
  const pitch = note.pitch;
  if (pitch.kind === 'fretted') return noteOnString(beat, pitch.string);
  if (beat.isRest) return null;
  return (
    beat.notes.find(
```

becomes

<!-- apply: replace client/src/app/services/note-landing.ts -->
```ts
}

/**
 * The note on `beat` alphaTab would take for `note`'s line: the same string; pitched, the same pitch; a drum hit, the
 * same articulation. `Beat.chain` keys its lookup by `realValue`, which on a percussion note is the articulation number
 * (`alphaTab.core.mjs` ~6067, ~8086), so a tie between two hits of one drum resolves.
 */
function sameLineNote(beat: BeatDoc, note: NoteDoc): NoteDoc | null {
  const pitch = note.pitch;
  if (pitch.kind === 'fretted') return noteOnString(beat, pitch.string);
  if (beat.isRest) return null;
  if (pitch.kind === 'percussion') {
    return beat.notes.find(other => other.pitch.kind === 'percussion' && other.pitch.articulation === pitch.articulation) ?? null;
  }
  return (
    beat.notes.find(
```

`client/src/app/services/note-moves.ts`:

<!-- apply: find client/src/app/services/note-moves.ts -->
```ts
import { respellingsOf } from './note-respell';
import { reduceToOctave } from './note-spelling';
import { fretRangeOf, maxFretOf } from './pitch-on-strings';
import { STEP_SEMITONES } from './staff-pitch';

```

becomes

<!-- apply: replace client/src/app/services/note-moves.ts -->
```ts
import { respellingsOf } from './note-respell';
import { reduceToOctave } from './note-spelling';
import { PERCUSSION, fretRangeOf, maxFretOf } from './pitch-on-strings';
import { STEP_SEMITONES } from './staff-pitch';

```

<!-- apply: find client/src/app/services/note-moves.ts -->
```ts

  for (const { ref, note } of targets) {
    if (note.pitch.kind === 'fretted') {
      const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex] ?? { capo: 0 };
```

becomes

<!-- apply: replace client/src/app/services/note-moves.ts -->
```ts

  for (const { ref, note } of targets) {
    // `editRefusal` refuses a percussion staff before this is reached; a drum hit has no pitch to move in any case.
    if (note.pitch.kind === 'percussion') return PERCUSSION;
    if (note.pitch.kind === 'fretted') {
      const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex] ?? { capo: 0 };
```

<!-- apply: find client/src/app/services/note-moves.ts -->
```ts
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff) continue;
    if (note.pitch.kind === 'fretted') {
      note.pitch = { ...note.pitch, fret: note.pitch.fret + delta };
```

becomes

<!-- apply: replace client/src/app/services/note-moves.ts -->
```ts
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff || note.pitch.kind === 'percussion') continue;
    if (note.pitch.kind === 'fretted') {
      note.pitch = { ...note.pitch, fret: note.pitch.fret + delta };
```

`client/src/app/services/note-respell.ts`:

<!-- apply: find client/src/app/services/note-respell.ts -->
```ts
  if (options.length === 0) return null;
  const next = options[(options.indexOf(spellingOf(note, pitchClass, fifths)) + 1) % options.length];
  if (note.pitch.kind === 'fretted') return { pitch: note.pitch, accidental: next };
  if (transposed) return { pitch: { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave }, accidental: next };

```

becomes

<!-- apply: replace client/src/app/services/note-respell.ts -->
```ts
  if (options.length === 0) return null;
  const next = options[(options.indexOf(spellingOf(note, pitchClass, fifths)) + 1) % options.length];
  if (note.pitch.kind !== 'pitched') return { pitch: note.pitch, accidental: next };
  if (transposed) return { pitch: { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave }, accidental: next };

```

<!-- apply: find client/src/app/services/note-respell.ts -->
```ts
  if (!staff || !bar) return null;
  if (target.note.pitch.kind === 'fretted' && target.note.effects.harmonic === 'natural') return null;
  const transposed = reduceToOctave(staff.transpose + staff.displayTranspose) !== 0;
  return respelledNote(target.note, drawnPitchClassOf(staff, target.note.pitch), bar.keySignature.fifths, transposed);
}

```

becomes

<!-- apply: replace client/src/app/services/note-respell.ts -->
```ts
  if (!staff || !bar) return null;
  if (target.note.pitch.kind === 'fretted' && target.note.effects.harmonic === 'natural') return null;
  // A drum hit has no pitch class, so no spelling to move to.
  const pitchClass = drawnPitchClassOf(staff, target.note.pitch);
  if (pitchClass === null) return null;
  const transposed = reduceToOctave(staff.transpose + staff.displayTranspose) !== 0;
  return respelledNote(target.note, pitchClass, bar.keySignature.fifths, transposed);
}

```

`client/src/app/services/pitch-on-strings.ts`:

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
export type FrettedPitch = Extract<NotePitch, { kind: 'fretted' }>;

/** What a note entry does on a beat: writes a note, or takes out the note at `index` - a click on a notehead. */
export type StaffEntry = { kind: 'write'; pitch: NotePitch } | { kind: 'remove'; index: number };

/** The MIDI pitch a note sounds, before transposition: its open string, the capo and the fret; or the pitch itself. */
export function soundingMidiOf(staff: Pick<StaffDoc, 'tuning' | 'capo'>, pitch: NotePitch): number {
  return pitch.kind === 'fretted'
    ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
export type FrettedPitch = Extract<NotePitch, { kind: 'fretted' }>;

/** Every `NotePitch` that sounds a pitch: a fretted note or a pitched one. A drum hit has none. */
export type SoundingPitch = Exclude<NotePitch, { kind: 'percussion' }>;

/**
 * Why a percussion staff refuses a press that needs strings or a pitch: frets, strings, accidentals, respelling, semitone
 * moves, hammer-ons, trills and every fretted-only technique. Here rather than in `edit-refusals.ts`, which imports this
 * module, so `staffEntryOf` can say it too.
 */
export const PERCUSSION = 'A percussion staff has no strings and no pitch, so that belongs to a pitched staff.';

/** What a note entry does on a beat: writes a note, or takes out the note at `index` - a click on a notehead. */
export type StaffEntry = { kind: 'write'; pitch: NotePitch } | { kind: 'remove'; index: number };

/**
 * The MIDI pitch a note sounds, before transposition: its open string, the capo and the fret; or the pitch itself. Null
 * for a drum hit, which has no pitch: its articulation's MIDI number is a key on channel 9, not a note in a scale.
 */
export function soundingMidiOf(staff: Pick<StaffDoc, 'tuning' | 'capo'>, pitch: SoundingPitch): number;
export function soundingMidiOf(staff: Pick<StaffDoc, 'tuning' | 'capo'>, pitch: NotePitch): number | null;
export function soundingMidiOf(staff: Pick<StaffDoc, 'tuning' | 'capo'>, pitch: NotePitch): number | null {
  if (pitch.kind === 'percussion') return null;
  return pitch.kind === 'fretted'
    ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
```

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
 * On a staff with a tuning a pitched note - Pen's click - is fretted (`frettedPlacementOf`), or, when the beat already
 * sounds that pitch, takes that note out, as the same click does on a staff with no tuning. A fret past `maxFretOf` the
 * staff - a typed number, with a capo on - is refused, and so is a fret on a staff with no strings. Anything else is
 * written as it is.
 */
export function staffEntryOf(staff: StaffDoc, beat: BeatDoc | null, pitch: NotePitch, caretString: number | null): StaffEntry | string {
  const stringed = staff.tuning.length > 0;
  if (!stringed) return pitch.kind === 'fretted' ? 'A staff with no strings has no fret to write.' : { kind: 'write', pitch };
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
 * On a staff with a tuning a pitched note - Pen's click - is fretted (`frettedPlacementOf`), or, when the beat already
 * sounds that pitch, takes that note out, as the same click does on a staff with no tuning. A fret past `maxFretOf` the
 * staff - a typed number, with a capo on - is refused, and so is a fret on a staff with no strings. Nothing is written on
 * a percussion staff, and no drum hit is written anywhere: writing a new drum note needs an articulation to choose, and
 * alphaTab's table of them is internal (the GP-composer design's "Percussion in the model"). Anything else is written as
 * it is.
 */
export function staffEntryOf(staff: StaffDoc, beat: BeatDoc | null, pitch: NotePitch, caretString: number | null): StaffEntry | string {
  if (staff.isPercussion || pitch.kind === 'percussion') return PERCUSSION;
  const stringed = staff.tuning.length > 0;
  if (!stringed) return pitch.kind === 'fretted' ? 'A staff with no strings has no fret to write.' : { kind: 'write', pitch };
```

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
      const taken = stringsTakenOn(beat.notes);
      beat.notes = beat.notes.filter(note => {
        if (note.pitch.kind === 'fretted') return true;
        const placed = frettedPlacementOf(staff, soundingMidiOf(staff, note.pitch), taken, null);
        if (typeof placed === 'string') {
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
      const taken = stringsTakenOn(beat.notes);
      beat.notes = beat.notes.filter(note => {
        // A drum hit is kept as it is: it has no pitch to put on a string. It is not found on a staff with a tuning
        // unless an alphaTex draft put it there, and alphaTab plays it from its articulation either way.
        if (note.pitch.kind !== 'pitched') return true;
        const placed = frettedPlacementOf(staff, soundingMidiOf(staff, note.pitch), taken, null);
        if (typeof placed === 'string') {
```

`client/src/app/services/progression-score.ts`:

<!-- apply: find client/src/app/services/progression-score.ts -->
```ts
    showSlash: false,
    showNumbered: false,
    bars
  };
```

becomes

<!-- apply: replace client/src/app/services/progression-score.ts -->
```ts
    showSlash: false,
    showNumbered: false,
    isPercussion: false,
    lineCount: 5,
    bars
  };
```

<!-- apply: find client/src/app/services/progression-score.ts -->
```ts
    // Marked by `progression-track.ts` when a user sends it to the Composer.
    // The projection on its own is just a score.
    generated: null
  };

```

becomes

<!-- apply: replace client/src/app/services/progression-score.ts -->
```ts
    // Marked by `progression-track.ts` when a user sends it to the Composer.
    // The projection on its own is just a score.
    generated: null,
    percussionArticulations: []
  };

```

`client/src/app/services/score-derivation.ts`:

<!-- apply: find client/src/app/services/score-derivation.ts -->
```ts
    showSlash: false,
    showNumbered: false,
    bars
  };
```

becomes

<!-- apply: replace client/src/app/services/score-derivation.ts -->
```ts
    showSlash: false,
    showNumbered: false,
    isPercussion: false,
    lineCount: 5,
    bars
  };
```

<!-- apply: find client/src/app/services/score-derivation.ts -->
```ts
    // it: the field means "generated from a progression" and nothing broader.
    // It is a link back to a `ProgressionDoc`, and a transcription has none.
    generated: null
  };

```

becomes

<!-- apply: replace client/src/app/services/score-derivation.ts -->
```ts
    // it: the field means "generated from a progression" and nothing broader.
    // It is a link back to a `ProgressionDoc`, and a transcription has none.
    generated: null,
    percussionArticulations: []
  };

```

`client/src/app/services/score-doc-mapper.service.ts`:

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
import {
  AccidentalMode,
  BarDoc,
  BeatDoc,
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
import {
  AccidentalMode,
  ArticulationDoc,
  BarDoc,
  BeatDoc,
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
  createDefaultNoteEffects
} from '../models/composer.model';
import { frettedDocOf } from './pitch-on-strings';
import {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
  createDefaultNoteEffects
} from '../models/composer.model';
import { midiChannelsOf } from './midi-channels';
import { frettedDocOf } from './pitch-on-strings';
import {
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
      score.addTrack(this.toTrack(trackDoc));
    }

    score.finish(settings);
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
      score.addTrack(this.toTrack(trackDoc));
    }
    // As alphaTab's importers would: `score.finish` assigns none, and a score built here kept every track on channel 0.
    midiChannelsOf(score.tracks).forEach(({ primary, secondary }, index) => {
      score.tracks[index].playbackInfo.primaryChannel = primary;
      score.tracks[index].playbackInfo.secondaryChannel = secondary;
    });

    score.finish(settings);
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
      track.addStaff(this.toStaff(staffDoc));
    }
    return track;
  }

```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
      track.addStaff(this.toStaff(staffDoc));
    }
    // In order: a percussion note's number below this list's length is an index into it, so the list must come back
    // exactly as it was read. `Track.finish` zeroes a drum track's program, and `toScore` assigns its channel
    // (`midiChannelsOf`).
    for (const articulation of doc.percussionArticulations) {
      track.percussionArticulations.push(this.toArticulation(articulation));
    }
    return track;
  }

  /**
   * The public constructor, not `InstrumentArticulation.create`: `create` takes the id first and is what alphaTab's own
   * importers call, but it is not in `alphaTab.d.ts`. The constructor takes the same fields with the id last.
   */
  private toArticulation(doc: ArticulationDoc): alphaTab.model.InstrumentArticulation {
    return new alphaTab.model.InstrumentArticulation(
      doc.elementType,
      doc.staffLine,
      doc.outputMidiNumber,
      doc.noteHeadDefault,
      doc.noteHeadHalf,
      doc.noteHeadWhole,
      doc.techniqueSymbol,
      doc.techniqueSymbolPlacement,
      doc.id
    );
  }

```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
    staff.showSlash = doc.showSlash;
    staff.showNumbered = doc.showNumbered;

    if (doc.tuning.length > 0) {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
    staff.showSlash = doc.showSlash;
    staff.showNumbered = doc.showNumbered;
    // Before the bars, and before `score.finish`, which is what reads the flag: it clears the tuning, turns tablature off
    // and zeroes the display transposition on a percussion staff.
    staff.isPercussion = doc.isPercussion;
    staff.standardNotationLineCount = doc.lineCount;

    if (doc.tuning.length > 0) {
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
      note.string = this.flipString(doc.pitch.string, stringCount);
      note.fret = doc.pitch.fret;
    } else {
      note.octave = doc.pitch.octave + ScoreDocMapperService.OCTAVE_OFFSET;
      note.tone = doc.pitch.noteValue;
    }

```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
      note.string = this.flipString(doc.pitch.string, stringCount);
      note.fret = doc.pitch.fret;
    } else if (doc.pitch.kind === 'pitched') {
      note.octave = doc.pitch.octave + ScoreDocMapperService.OCTAVE_OFFSET;
      note.tone = doc.pitch.noteValue;
    } else {
      // No string, fret, tone or octave: `Note.isPercussion` is `!isStringed && percussionArticulation >= 0`, and
      // playback takes the articulation's MIDI number as the key.
      note.percussionArticulation = doc.pitch.articulation;
    }

```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
      // back out of it is an ordinary one. Stated rather than left off: a
      // missing field and an absent marker must not be two different states.
      generated: null
    };
  }
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
      // back out of it is an ordinary one. Stated rather than left off: a
      // missing field and an absent marker must not be two different states.
      generated: null,
      percussionArticulations: track.percussionArticulations.map(articulation => ({
        id: articulation.id,
        elementType: articulation.elementType,
        staffLine: articulation.staffLine,
        noteHeadDefault: articulation.noteHeadDefault,
        noteHeadHalf: articulation.noteHeadHalf,
        noteHeadWhole: articulation.noteHeadWhole,
        techniqueSymbol: articulation.techniqueSymbol,
        techniqueSymbolPlacement: articulation.techniqueSymbolPlacement,
        outputMidiNumber: articulation.outputMidiNumber
      }))
    };
  }
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
      showSlash: staff.showSlash,
      showNumbered: staff.showNumbered,
      bars: staff.bars.map(b => this.fromBar(b, staff.stringTuning.tunings.length))
    };
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
      showSlash: staff.showSlash,
      showNumbered: staff.showNumbered,
      // The tuning above is already empty on a percussion staff: `Staff.finish` cleared it.
      isPercussion: staff.isPercussion,
      lineCount: staff.standardNotationLineCount,
      bars: staff.bars.map(b => this.fromBar(b, staff.stringTuning.tunings.length))
    };
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts

    const accidental = accidentalOf(note.accidentalMode);
    const pitch: NotePitch = note.isStringed
      ? {
          kind: 'fretted',
          string: this.flipString(note.string, stringCount),
          fret: note.fret
        }
      : {
          kind: 'pitched',
          noteValue: note.tone,
          octave: note.octave - ScoreDocMapperService.OCTAVE_OFFSET,
          letter: forcedLetterOf(accidental, note.tone)
        };

    return {
```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts

    const accidental = accidentalOf(note.accidentalMode);
    const pitch = this.pitchOf(note, stringCount, accidental);

    return {
```

<!-- apply: find client/src/app/services/score-doc-mapper.service.ts -->
```ts
  }

}

```

becomes

<!-- apply: replace client/src/app/services/score-doc-mapper.service.ts -->
```ts
  }

  /**
   * What `note` is: a string and a fret, a pitch, or a drum.
   *
   * Percussion is asked first. A drum note is not stringed, so it used to fall to the pitched branch, and alphaTab
   * leaves `tone` and `octave` at -1 on one - so every hit read back as `{ noteValue: -1, octave: -2 }`, which is not a
   * wrong pitch but no pitch at all. The articulation is copied verbatim, index or id alike.
   */
  private pitchOf(note: alphaTab.model.Note, stringCount: number, accidental: AccidentalMode): NotePitch {
    if (note.isPercussion) return { kind: 'percussion', articulation: note.percussionArticulation };
    if (note.isStringed) return { kind: 'fretted', string: this.flipString(note.string, stringCount), fret: note.fret };
    return {
      kind: 'pitched',
      noteValue: note.tone,
      octave: note.octave - ScoreDocMapperService.OCTAVE_OFFSET,
      letter: forcedLetterOf(accidental, note.tone)
    };
  }
}

```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/composer-export.service.spec.ts --include=src/app/services/harmonic-eval/two-tier-equivalence.spec.ts --include=src/app/services/progression-track.spec.ts --include=src/app/services/score-doc-mapper.effects.spec.ts --include=src/app/services/score-doc-mapper.ghost-voice.spec.ts --include=src/app/services/score-doc-mapper.percussion.spec.ts --include=src/app/services/score-doc-mapper.service.spec.ts --include=src/app/services/score-doc-mapper.spelling.spec.ts
```

Expected: `TOTAL: 149 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3395 SUCCESS`.

**Step 6: Commit.**

```text
feat: Carry percussion through the model and the mapper

NotePitch gains a percussion kind holding Note.percussionArticulation
verbatim; TrackDoc gains the track's articulation list and StaffDoc its
percussion flag and line count, so a drum track converts, plays, saves and
reloads as itself. toScore now assigns MIDI channels as alphaTab's importers
do, since Score.finish does not: a composed score kept every track on
channel 0, and a kit would have played as pitched notes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task A.2: What a percussion staff refuses

The design's Part 3, second commit: "the line is drawn at what the model can already say". One predicate in
`editRefusal`, which every press already asks, with one message, `PERCUSSION` - kept in `pitch-on-strings.ts` because
`edit-refusals.ts` imports that module, and `staffEntryOf` says it too.

- Every fretted-only technique, every accidental and Natural, a respell, a semitone move, a string move, a hammer-on and
  a trill are refused on a drum staff. The `notes` scope splits in three - `notes`, `pitch`, `string` - so a respell and
  the moves are refused there while a clear still reaches a drum hit.
- A fret digit says why it wrote nothing; Pen's click on a drum staff only moves the caret (`StaffKind` gains
  `'percussion'`, the same one band as `notation`, so `slotIndexAt`'s ranks do not move); tuning and capo refuse.
- The clipboard's `fretted: boolean` becomes three kinds (`StaffNotes`), so a kit no longer pastes onto a piano staff.

What reads no pitch - duration, dots, rest, dynamics, accents, staccato, ghost, tie (alphaTab chains a drum by its
articulation), fermata - goes through, and the spec asserts both lists over the tool table through `toolStates`.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/edit-refusals.percussion.spec.ts`
- Modify: `services/beat-clipboard.spec.ts`, `services/beat-clipboard.ts`, `services/composer-fret-entry.ts`, `services/composer-score-interaction.ts`, `services/composer.service.ts`, `services/edit-refusals.ts`, `services/note-respell.ts`, `services/track-edits.ts`

**Step 1: The failing specs.**

`client/src/app/services/beat-clipboard.spec.ts`:

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts

    expect(copied?.beats.map(beat => beat.isRest)).toEqual([false, false]);
    expect(copied?.fretted).toBeTrue();
  });

```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts

    expect(copied?.beats.map(beat => beat.isRest)).toEqual([false, false]);
    expect(copied?.notes).toBe('fretted');
  });

```

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts
    const group = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1), ref(0, 2)])!;

    expect(pasteBeats(structuredClone(doc), ref(0, 1), { fretted: true, beats: writtenBeats('n4') })).toMatch(/paste would split a tuplet group/i);
    expect(pasteBeats(structuredClone(doc), ref(0, 0), group)).toEqual({ appendedBars: 0, at: ref(0, 0), droppedFermatas: [], beatsWritten: 3 });
  });
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts
    const group = copiedBeatsOf(doc, [ref(0, 0), ref(0, 1), ref(0, 2)])!;

    expect(pasteBeats(structuredClone(doc), ref(0, 1), { notes: 'fretted', beats: writtenBeats('n4') })).toMatch(/paste would split a tuplet group/i);
    expect(pasteBeats(structuredClone(doc), ref(0, 0), group)).toEqual({ appendedBars: 0, at: ref(0, 0), droppedFermatas: [], beatsWritten: 3 });
  });
```

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts
    beats(doc, 0).splice(0, 4, ...writtenBeats(Array.from({ length: 12 }, () => 'n8t3').join(' ')));

    expect(pasteBeats(doc, ref(0, 11), { fretted: true, beats: writtenBeats('n8t3 n8t3 n8t3') })).toMatch(/paste would split a tuplet group/i);
  });

```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts
    beats(doc, 0).splice(0, 4, ...writtenBeats(Array.from({ length: 12 }, () => 'n8t3').join(' ')));

    expect(pasteBeats(doc, ref(0, 11), { notes: 'fretted', beats: writtenBeats('n8t3 n8t3 n8t3') })).toMatch(/paste would split a tuplet group/i);
  });

```

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts
    beats(doc, 0).splice(0, 4, ...writtenBeats('n1 g'));

    expect(pasteBeats(doc, ref(0, 1), { fretted: true, beats: writtenBeats('n4') })).toMatch(/grace.*full bar.*next bar/i);
    expect(shape(doc, 1)).toEqual(['r4', 'r4', 'r4', 'r4']);
  });
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts
    beats(doc, 0).splice(0, 4, ...writtenBeats('n1 g'));

    expect(pasteBeats(doc, ref(0, 1), { notes: 'fretted', beats: writtenBeats('n4') })).toMatch(/grace.*full bar.*next bar/i);
    expect(shape(doc, 1)).toEqual(['r4', 'r4', 'r4', 'r4']);
  });
```

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts
    grace.notes = [{ pitch: { kind: 'fretted', string: 2, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    grace.effects = { ...grace.effects, grace: 'beforeBeat', fermata };
    return { fretted: true, beats: [grace] };
  };
  const fermatas = (doc: ScoreDoc): (string | null)[][] =>
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts
    grace.notes = [{ pitch: { kind: 'fretted', string: 2, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    grace.effects = { ...grace.effects, grace: 'beforeBeat', fermata };
    return { notes: 'fretted', beats: [grace] };
  };
  const fermatas = (doc: ScoreDoc): (string | null)[][] =>
```

<!-- apply: find client/src/app/services/beat-clipboard.spec.ts -->
```ts
    sixtyFourth.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];

    pasteBeats(doc, ref(0, 0), { fretted: true, beats: [sixtyFourth] });

    expect(fermatas(doc).map(list => list.indexOf('medium'))).toEqual([-1, 1, 1]);
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.spec.ts -->
```ts
    sixtyFourth.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];

    pasteBeats(doc, ref(0, 0), { notes: 'fretted', beats: [sixtyFourth] });

    expect(fermatas(doc).map(list => list.indexOf('medium'))).toEqual([-1, 1, 1]);
```

`client/src/app/services/edit-refusals.percussion.spec.ts`, new:

<!-- apply: create client/src/app/services/edit-refusals.percussion.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { ComposerService } from './composer.service';
import { FretDigitEntry } from './composer-fret-entry';
import { dragExtends, scorePressOf, staffSlotsOf, staffSlotsOfScore } from './composer-score-interaction';
import { toolStates } from './composer-tool-states';
import { COMPOSER_TOOLS } from './composer-tools';
import { deepFrozen } from './deep-frozen.spec-helper';
import { PERCUSSION } from './pitch-on-strings';
import { setStaffNumber, setStaffTuning } from './track-edits';
import { EditCursor, NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * What a percussion staff refuses, and what it lets through.
 *
 * One predicate, in `editRefusal`, which every press already asks: a drum hit has no string and no pitch, so every
 * fretted-only technique, every accidental, respelling, semitone and string moves, a hammer-on and a trill say so; what
 * reads no pitch - duration, dots, rest, dynamics, accents, staccato, ghost, tie, fermata - goes through. Asserted over
 * `COMPOSER_TOOLS` through `toolStates`, so a tool added later cannot arrive without an answer.
 */
describe('a percussion staff', () => {
  /** A drum hit of `articulation`, with no effects. */
  const hit = (articulation: number): NoteDoc => ({
    pitch: { kind: 'percussion', articulation },
    isTied: false,
    accidental: 'auto',
    effects: createDefaultNoteEffects()
  });

  /** Guitar on track 0, a kit on track 1 with a snare on beats 0 and 1 of the first bar. */
  function kit(): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    const drums = ComposerService.createTrack('Drums', 'drm', 0, false, doc.masterBars);
    drums.staves[0].isPercussion = true;
    const beats = drums.staves[0].bars[0].voices[0].beats;
    for (const index of [0, 1]) {
      beats[index].isRest = false;
      beats[index].notes = [hit(38)];
    }
    doc.tracks.push(drums);
    return doc;
  }

  const onDrums = (beatIndex: number): EditCursor => ({ trackIndex: 1, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex, stringIndex: null });

  /** The tools a percussion staff refuses, with the percussion message. */
  const REFUSED = [
    'bend',
    'legatoSlide',
    'shiftSlide',
    'naturalHarmonic',
    'artificialHarmonic',
    'leftHandTap',
    'tap',
    'slap',
    'pop',
    'doubleFlat',
    'flat',
    'natural',
    'sharp',
    'doubleSharp',
    'respell',
    'hammerOn',
    'trill'
  ];

  /** Tools the design names as going through on a drum hit. */
  const ALLOWED = [
    'whole',
    'quarter',
    'eighth',
    'dot',
    'doubleDot',
    'rest',
    'ppp',
    'f',
    'fff',
    'crescendo',
    'accent',
    'heavyAccent',
    'tenuto',
    'staccato',
    'ghost',
    'dead',
    'tie',
    'fermata',
    'palmMute',
    'letRing',
    'vibrato',
    'wideVibrato',
    'pickDown',
    'pickUp',
    'fadeIn',
    'graceBefore',
    'graceOnBeat'
  ];

  describe('through the tool table', () => {
    // Beat 1: it has a snare before it to tie from, so Tie's own rule is met and only the staff is being asked about.
    const states = (): ReadonlyMap<string, { refusal: string | null }> => toolStates(deepFrozen(kit()), null, onDrums(1), 'select');

    it('refuses every fretted-only, pitch, spelling, hammer-on and trill tool with the percussion message', () => {
      const read = states();
      for (const id of REFUSED) expect(read.get(id)?.refusal).withContext(id).toBe(PERCUSSION);
    });

    it('lets through what reads no pitch', () => {
      const read = states();
      for (const id of ALLOWED) expect(read.get(id)?.refusal).withContext(id).toBeNull();
    });

    it('answers for every tool in the table, so a new one cannot arrive unasked', () => {
      const read = states();
      const answered = new Set([...REFUSED, ...ALLOWED]);
      for (const tool of COMPOSER_TOOLS) {
        const refusal = read.get(tool.id)?.refusal ?? null;
        if (refusal === PERCUSSION) expect(answered.has(tool.id)).withContext(`${tool.id} is refused but not listed`).toBeTrue();
      }
    });

    it('refuses a range reaching a percussion staff whole, as any mixed range is refused', () => {
      const guitar: EditCursor = { trackIndex: 0, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0, stringIndex: 0 };
      const read = toolStates(deepFrozen(kit()), guitar, onDrums(0), 'select');

      expect(read.get('sharp')?.refusal).toBe(PERCUSSION);
    });
  });

  describe('through the service', () => {
    let composer: ComposerService;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      composer = TestBed.inject(ComposerService);
      composer.replaceDocument(kit(), { markClean: true });
      composer.setCursor(onDrums(0));
    });

    it('refuses a semitone move, a string move and a respell, and changes nothing', () => {
      const before = composer.doc;
      for (const press of [() => composer.shiftSemitone(1), () => composer.moveNotesToString(1), () => composer.respell()]) {
        press();
        expect(composer.doc).toBe(before);
        expect(composer.state.refusal).toBe(PERCUSSION);
      }
    });

    it('says why a fret digit writes nothing', () => {
      const before = composer.doc;
      new FretDigitEntry(composer).type(3);

      expect(composer.doc).toBe(before);
      expect(composer.state.refusal).toBe(PERCUSSION);
    });

    it('writes nothing where a note would be entered', () => {
      composer.setNoteAtCursor({ kind: 'pitched', noteValue: 0, octave: 4 }, true);

      expect(composer.state.refusal).toBe(PERCUSSION);
      expect(composer.doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes).toEqual([hit(38)]);
    });

    it('still takes a duration, a dynamic and an accent', () => {
      composer.applyDurationAtCursor(8, 0);
      composer.setDynamics('pp');
      composer.toggleNoteEffect('accent', 'normal', 'none');

      const beat = composer.doc.tracks[1].staves[0].bars[0].voices[0].beats[0];
      expect(beat.duration).toBe(8);
      expect(beat.dynamics).toBe('pp');
      expect(beat.notes[0].effects.accent).toBe('normal');
    });
  });

  describe('tuning and capo', () => {
    it('refuses a tuning and a capo', () => {
      const doc = kit();

      expect(setStaffTuning(doc, 1, 0, [64, 59, 55, 50, 45, 40], 'Guitar')).toBe(PERCUSSION);
      expect(setStaffNumber(doc, 1, 0, 'capo', 2)).toBe(PERCUSSION);
      expect(doc.tracks[1].staves[0].tuning).toEqual([]);
      expect(doc.tracks[1].staves[0].capo).toBe(0);
    });
  });

  describe('on the score', () => {
    it("draws as a 'percussion' band where a pitched staff draws 'notation', so the ranks do not move", () => {
      expect(staffSlotsOf(kit()).map(slot => slot.kind)).toEqual(['notation', 'tab', 'percussion']);
    });

    it('reads the same from an alphaTab score', () => {
      const score = new alphaTab.model.Score();
      const track = new alphaTab.model.Track();
      const staff = new alphaTab.model.Staff();
      staff.isPercussion = true;
      track.addStaff(staff);
      score.addTrack(track);

      expect(staffSlotsOfScore(score).map(slot => slot.kind)).toEqual(['percussion']);
    });

    it('takes a Pen press as a caret move, and a drag from it as a range', () => {
      expect(scorePressOf('pen', 'percussion', false)).toBe('caret');
      expect(dragExtends('pen', 'percussion')).toBeTrue();
    });
  });

  describe('paste', () => {
    const at = (trackIndex: number) => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });

    it('copies drums as drums', () => {
      expect(copiedBeatsOf(kit(), [at(1)])?.notes).toBe('percussion');
    });

    it('refuses drums onto a pitched staff, and a pitched copy onto drums', () => {
      const doc = kit();
      doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
      const drums = copiedBeatsOf(doc, [at(1)]);
      const piano = copiedBeatsOf(doc, [at(2)]);
      if (!drums || !piano) throw new Error('nothing copied');

      expect(pasteBeats(structuredClone(doc), at(2), drums)).toMatch(/copied from a percussion staff/);
      expect(pasteBeats(structuredClone(doc), at(1), piano)).toMatch(/copied from a pitched staff.*percussion staff/);
    });

    it('pastes drums onto drums', () => {
      const doc = kit();
      const drums = copiedBeatsOf(doc, [at(1)]);
      if (!drums) throw new Error('nothing copied');

      expect(typeof pasteBeats(doc, { ...at(1), beatIndex: 2 }, drums)).toBe('object');
      expect(doc.tracks[1].staves[0].bars[0].voices[0].beats[2].notes).toEqual([hit(38)]);
    });
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 11 errors, the first:

```text
src/app/services/beat-clipboard.spec.ts(32,20): error TS2339: Property 'notes' does not exist on type 'CopiedBeats'.
```

**Step 3: The implementation.**

`client/src/app/services/beat-clipboard.ts`:

<!-- apply: find client/src/app/services/beat-clipboard.ts -->
```ts
import { BeatDoc, FermataDoc, ScoreDoc } from '../models/composer.model';
import { barCapacityTicks, barFillOf, barMeterAt, beatTicks, fillBarGaps, graceRunStart, insertRestsAt, splitAtBarLine } from './bar-fill';
import { newOpenTupletGroup, openTupletGroupsOf, tupletGroupsOf } from './beat-edits';
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.ts -->
```ts
import { BeatDoc, FermataDoc, ScoreDoc, StaffDoc } from '../models/composer.model';
import { barCapacityTicks, barFillOf, barMeterAt, beatTicks, fillBarGaps, graceRunStart, insertRestsAt, splitAtBarLine } from './bar-fill';
import { newOpenTupletGroup, openTupletGroupsOf, tupletGroupsOf } from './beat-edits';
```

<!-- apply: find client/src/app/services/beat-clipboard.ts -->
```ts
 */

/** Beats copied from one staff. */
export interface CopiedBeats {
  /** Whether they came from a fretted staff, whose notes name strings rather than pitches. */
  fretted: boolean;
  /** The copied beats in timeline order, as one run: bar lines between them are not kept. */
  beats: BeatDoc[];
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.ts -->
```ts
 */

/**
 * What a staff's notes name: strings and frets, pitches, or drums. A paste goes only between staves of one kind - was a
 * boolean, `fretted`, under which a drum bar and a piano bar were both "not fretted", so a kit pasted onto a piano staff.
 */
export type StaffNotes = 'fretted' | 'pitched' | 'percussion';

/** What `staff`'s notes name. */
export function staffNotesOf(staff: Pick<StaffDoc, 'isPercussion' | 'tuning'>): StaffNotes {
  return staff.isPercussion ? 'percussion' : staff.tuning.length > 0 ? 'fretted' : 'pitched';
}

/** Beats copied from one staff. */
export interface CopiedBeats {
  /** What the staff they came from names its notes by. */
  notes: StaffNotes;
  /** The copied beats in timeline order, as one run: bar lines between them are not kept. */
  beats: BeatDoc[];
```

<!-- apply: find client/src/app/services/beat-clipboard.ts -->
```ts

  const beats = refs.map(ref => beatAt(doc, ref)).filter((beat): beat is BeatDoc => beat !== null);
  return beats.length > 0 ? { fretted: staff.tuning.length > 0, beats: beats.map(beat => structuredClone(beat)) } : null;
}

const NO_ROOM = 'A time signature there leaves no room in a bar, so there is nowhere to paste.';

const PART_OF_A_GROUP = 'The copy holds part of a tuplet group. Copy the whole group to paste it.';
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.ts -->
```ts

  const beats = refs.map(ref => beatAt(doc, ref)).filter((beat): beat is BeatDoc => beat !== null);
  return beats.length > 0 ? { notes: staffNotesOf(staff), beats: beats.map(beat => structuredClone(beat)) } : null;
}

const NO_ROOM = 'A time signature there leaves no room in a bar, so there is nowhere to paste.';

/** Why beats copied from a staff naming `from` do not paste onto one naming `onto`. */
function crossKindRefusalOf(from: StaffNotes, onto: StaffNotes): string {
  if (from === 'fretted' && onto === 'pitched') return 'Those beats were copied from a fretted staff, and this staff has no strings.';
  if (from === 'pitched' && onto === 'fretted') return 'Those beats were copied from a pitched staff, and this staff writes notes by string.';
  return from === 'percussion'
    ? 'Those beats were copied from a percussion staff, and its drums have no pitch to write on this staff.'
    : `Those beats were copied from a ${from} staff, and a percussion staff has no strings and no pitch.`;
}

const PART_OF_A_GROUP = 'The copy holds part of a tuplet group. Copy the whole group to paste it.';
```

<!-- apply: find client/src/app/services/beat-clipboard.ts -->
```ts
  const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
  if (!staff) return 'There is no staff there.';
  if ((staff.tuning.length > 0) !== copied.fretted) {
    return copied.fretted
      ? 'Those beats were copied from a fretted staff, and this staff has no strings.'
      : 'Those beats were copied from a pitched staff, and this staff writes notes by string.';
  }
  const strings = copied.beats.flatMap(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.string : 0)));
  const highest = Math.max(0, ...strings);
```

becomes

<!-- apply: replace client/src/app/services/beat-clipboard.ts -->
```ts
  const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
  if (!staff) return 'There is no staff there.';
  const onto = staffNotesOf(staff);
  if (onto !== copied.notes) return crossKindRefusalOf(copied.notes, onto);
  const strings = copied.beats.flatMap(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.string : 0)));
  const highest = Math.max(0, ...strings);
```

`client/src/app/services/composer-fret-entry.ts`:

<!-- apply: find client/src/app/services/composer-fret-entry.ts -->
```ts
import { EditCursor, ScoreDoc } from '../models/composer.model';
import { writeSounds } from './composer-score-interaction';
import { MAX_FRET, soundingMidiOf } from './pitch-on-strings';

/**
```

becomes

<!-- apply: replace client/src/app/services/composer-fret-entry.ts -->
```ts
import { EditCursor, ScoreDoc } from '../models/composer.model';
import { writeSounds } from './composer-score-interaction';
import { MAX_FRET, PERCUSSION, soundingMidiOf } from './pitch-on-strings';

/**
```

<!-- apply: find client/src/app/services/composer-fret-entry.ts -->
```ts
  ) {}

  /** Types `digit` at the caret. Nothing happens on a pitched staff, which has no frets. */
  type(digit: number): void {
    const state = this.composer.state;
    const staff = this.composer.staffAt(state.doc, state.cursor);
    if (!staff || staff.tuning.length === 0) return;

```

becomes

<!-- apply: replace client/src/app/services/composer-fret-entry.ts -->
```ts
  ) {}

  /**
   * Types `digit` at the caret. Nothing happens on a pitched staff, which has no frets. A percussion staff says why, since
   * a drum part looks like it could take a number: M2's rule that a press either acts or explains.
   */
  type(digit: number): void {
    const state = this.composer.state;
    const staff = this.composer.staffAt(state.doc, state.cursor);
    if (staff?.isPercussion) return this.composer.announce(PERCUSSION, true);
    if (!staff || staff.tuning.length === 0) return;

```

`client/src/app/services/composer-score-interaction.ts`:

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
 * turn on - slash notation, one line of rhythm slashes, and numbered notation, which draws no lines. Those two only take
 * the caret: a Pen click writes no pitch there, and they have no string.
 */
export type StaffKind = 'slash' | 'notation' | 'numbered' | 'tab';

/** One staff as alphaTab draws it, tied back to the track and staff it came from. */
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
 * turn on - slash notation, one line of rhythm slashes, and numbered notation, which draws no lines. Those two only take
 * the caret: a Pen click writes no pitch there, and they have no string.
 *
 * `percussion` is a drum staff's standard-notation band. It is the same one band, so it counts where `notation` would
 * and `slotIndexAt`'s ranks do not move, but a Pen click on it only moves the caret: a line there is a drum, not a
 * pitch, and writing a new drum note is out of the GP milestone's scope.
 */
export type StaffKind = 'slash' | 'notation' | 'percussion' | 'numbered' | 'tab';

/** One staff as alphaTab draws it, tied back to the track and staff it came from. */
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
        ...(staff.showStandardNotation ? ['notation' as const] : []),
        ...(staff.showNumbered ? ['numbered' as const] : []),
        ...(staff.showTablature && staff.tuning.length > 0 ? ['tab' as const] : [])
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
        ...(staff.showStandardNotation ? [staff.isPercussion ? ('percussion' as const) : ('notation' as const)] : []),
        ...(staff.showNumbered ? ['numbered' as const] : []),
        ...(staff.showTablature && staff.tuning.length > 0 ? ['tab' as const] : [])
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
 * `staffSlotsOf`'s sibling, and the whole of what the caret, the selection highlight and Pen's hover need to work
 * over a file that has no `ScoreDoc` behind it: an alphaTab `Staff` carries every field `staffSlotsOf` reads -
 * `showSlash`, `showStandardNotation`, `showNumbered`, `showTablature` and `stringTuning.tunings.length`.
 *
 * `visibleTrackIndices` are the tracks actually drawn (the strip's show/hide), in the order `api.renderTracks` was
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
 * `staffSlotsOf`'s sibling, and the whole of what the caret, the selection highlight and Pen's hover need to work
 * over a file that has no `ScoreDoc` behind it: an alphaTab `Staff` carries every field `staffSlotsOf` reads -
 * `showSlash`, `showStandardNotation`, `showNumbered`, `showTablature`, `isPercussion` and `stringTuning.tunings.length`.
 *
 * `visibleTrackIndices` are the tracks actually drawn (the strip's show/hide), in the order `api.renderTracks` was
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
        ...(staff.showStandardNotation ? ['notation' as const] : []),
        ...(staff.showNumbered ? ['numbered' as const] : []),
        ...(staff.showTablature && staff.stringTuning.tunings.length > 0 ? ['tab' as const] : [])
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
        ...(staff.showStandardNotation ? [staff.isPercussion ? ('percussion' as const) : ('notation' as const)] : []),
        ...(staff.showNumbered ? ['numbered' as const] : []),
        ...(staff.showTablature && staff.stringTuning.tunings.length > 0 ? ['tab' as const] : [])
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
/**
 * What a mouse-down does: Shift extends the range; otherwise the caret moves, and in Pen, on standard
 * notation, the clicked pitch is written too. Tablature writes by digit in both modes, never by click.
 */
export function scorePressOf(mode: EntryMode, staff: StaffKind | null, shiftKey: boolean): ScorePress {
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
/**
 * What a mouse-down does: Shift extends the range; otherwise the caret moves, and in Pen, on standard
 * notation, the clicked pitch is written too. Tablature writes by digit in both modes, never by click, and a
 * percussion staff not at all.
 */
export function scorePressOf(mode: EntryMode, staff: StaffKind | null, shiftKey: boolean): ScorePress {
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
/**
 * Whether moving with the button held extends the range from where the mouse-down put the caret:
 * anywhere in Select, and in Pen on any staff whose press wrote nothing - tablature, slash, numbered. A notation
 * drag in Pen would extend from the caret a write just advanced, and a Pen press on no staff starts no drag.
 */
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
/**
 * Whether moving with the button held extends the range from where the mouse-down put the caret:
 * anywhere in Select, and in Pen on any staff whose press wrote nothing - tablature, slash, numbered, percussion. A notation
 * drag in Pen would extend from the caret a write just advanced, and a Pen press on no staff starts no drag.
 */
```

`client/src/app/services/composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```ts
  /** Moves the selection's notes a semitone up (+1) or down (-1). See `shiftSemitone`. */
  shiftSemitone(delta: 1 | -1): void {
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => shiftSemitone(draft, refs, focus, delta));
  }

```

becomes

<!-- apply: replace client/src/app/services/composer.service.ts -->
```ts
  /** Moves the selection's notes a semitone up (+1) or down (-1). See `shiftSemitone`. */
  shiftSemitone(delta: 1 | -1): void {
    this.applyEdit({ family: 'note', key: 'pitch' }, (draft, refs, focus) => shiftSemitone(draft, refs, focus, delta));
  }

```

<!-- apply: find client/src/app/services/composer.service.ts -->
```ts
  moveNotesToString(delta: 1 | -1): void {
    const before = this.doc;
    this.applyEdit({ family: 'note', key: 'notes' }, (draft, refs, focus) => moveNotesToString(draft, refs, focus, delta));
    if (this.doc !== before && !this.stateSubject.getValue().anchor) this.moveCursor({ kind: 'string', delta });
  }
```

becomes

<!-- apply: replace client/src/app/services/composer.service.ts -->
```ts
  moveNotesToString(delta: 1 | -1): void {
    const before = this.doc;
    this.applyEdit({ family: 'note', key: 'string' }, (draft, refs, focus) => moveNotesToString(draft, refs, focus, delta));
    if (this.doc !== before && !this.stateSubject.getValue().anchor) this.moveCursor({ kind: 'string', delta });
  }
```

`client/src/app/services/edit-refusals.ts`:

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
import { SoundingPitch, soundingMidiOf } from './pitch-on-strings';

/**
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';
import { forcedLetterOf, reduceToOctave } from './note-spelling';
import { PERCUSSION, SoundingPitch, soundingMidiOf } from './pitch-on-strings';

/**
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
  // A press that needs only notes to act on - a clear, a respell, a move of pitch or string. Refused
  // where any note edit is, never as a fretted-only technique: clearing one from a pitched note removes
  // what alphaTab cannot use there, and the moves say for themselves what does not fit.
  | { family: 'note'; key: 'notes' }
  | { family: 'note'; key: 'accidental'; accidental: AccidentalMode }
  | { family: 'track'; trackIndex: number };
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
  // A press that needs only notes to act on - a clear, a respell, a move of pitch or string. Refused
  // where any note edit is, never as a fretted-only technique: clearing one from a pitched note removes
  // what alphaTab cannot use there, and the moves say for themselves what does not fit. `pitch` - a respell,
  // a semitone move - and `string` - a move between strings - are refused on a percussion staff as well,
  // since a drum hit has neither; `notes` is not, so a clear still reaches one.
  | { family: 'note'; key: 'notes' | 'pitch' | 'string' }
  | { family: 'note'; key: 'accidental'; accidental: AccidentalMode }
  | { family: 'track'; trackIndex: number };
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts

const FRETTED = 'Bends, slides, taps, slap, pop and harmonics belong to fretted staves.';

const GENERATED =
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts

const FRETTED = 'Bends, slides, taps, slap, pop and harmonics belong to fretted staves.';

/**
 * Note edits a percussion staff refuses, beyond the fretted-only ones it refuses too, with `PERCUSSION` rather than
 * `FRETTED` since it is the truer reason: every accidental and Natural, respelling and semitone moves (`pitch`),
 * moving between strings, a hammer-on - alphaTab drops one on a percussion staff at playback (`alphaTab.core.mjs`
 * ~48571) - and a trill, likewise (~48336). What is left - duration, dots, tuplets, rests, dynamics, accents,
 * staccato, ghost, tie, fermata - reads no pitch, and alphaTab draws each on a percussion notehead.
 */
const PERCUSSION_REFUSED_NOTE: ReadonlySet<string> = new Set([...FRETTED_ONLY_NOTE, 'accidental', 'pitch', 'string', 'isHammerPullOrigin', 'trill']);

const GENERATED =
```

<!-- apply: find client/src/app/services/edit-refusals.ts -->
```ts
    ref => (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) === 0
  );
  if (scope.family === 'beat') {
    return FRETTED_ONLY_BEAT.has(scope.key) && onPitchedStaff ? FRETTED : null;
  }
  if (FRETTED_ONLY_NOTE.has(scope.key) && onPitchedStaff) return FRETTED;
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
```

becomes

<!-- apply: replace client/src/app/services/edit-refusals.ts -->
```ts
    ref => (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) === 0
  );
  // A percussion staff has no tuning, so it is a pitched staff too as far as `onPitchedStaff` goes; asked first so the
  // refusal gives the truer reason.
  const onPercussionStaff = refs.some(ref => doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.isPercussion === true);
  if (scope.family === 'beat') {
    if (!FRETTED_ONLY_BEAT.has(scope.key)) return null;
    return onPercussionStaff ? PERCUSSION : onPitchedStaff ? FRETTED : null;
  }
  if (onPercussionStaff && PERCUSSION_REFUSED_NOTE.has(scope.key)) return PERCUSSION;
  if (FRETTED_ONLY_NOTE.has(scope.key) && onPitchedStaff) return FRETTED;
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
```

`client/src/app/services/note-respell.ts`:

<!-- apply: find client/src/app/services/note-respell.ts -->
```ts
 */
export function respellRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, notes?: readonly NoteTarget[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus, notes);
  if (refusal) return refusal;
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
```

becomes

<!-- apply: replace client/src/app/services/note-respell.ts -->
```ts
 */
export function respellRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, notes?: readonly NoteTarget[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'pitch' }, focus, notes);
  if (refusal) return refusal;
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
```

`client/src/app/services/track-edits.ts`:

<!-- apply: find client/src/app/services/track-edits.ts -->
```ts
import { PlaybackInfoDoc, ScoreDoc, StaffDoc } from '../models/composer.model';
import { MAX_FRET } from './pitch-on-strings';

/**
```

becomes

<!-- apply: replace client/src/app/services/track-edits.ts -->
```ts
import { PlaybackInfoDoc, ScoreDoc, StaffDoc } from '../models/composer.model';
import { MAX_FRET, PERCUSSION } from './pitch-on-strings';

/**
```

<!-- apply: find client/src/app/services/track-edits.ts -->
```ts
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (staff.tuning.length === 0) return 'A pitched staff has no strings to tune.';
  if (tuning.length === 0) return 'A tuning needs at least one string.';
```

becomes

<!-- apply: replace client/src/app/services/track-edits.ts -->
```ts
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (staff.isPercussion) return PERCUSSION;
  if (staff.tuning.length === 0) return 'A pitched staff has no strings to tune.';
  if (tuning.length === 0) return 'A tuning needs at least one string.';
```

<!-- apply: find client/src/app/services/track-edits.ts -->
```ts
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (key === 'capo' && staff.tuning.length === 0) return 'A pitched staff has no strings for a capo.';
  if (!Number.isInteger(value)) return 'That must be a whole number.';
```

becomes

<!-- apply: replace client/src/app/services/track-edits.ts -->
```ts
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (key === 'capo' && staff.isPercussion) return PERCUSSION;
  if (key === 'capo' && staff.tuning.length === 0) return 'A pitched staff has no strings for a capo.';
  if (!Number.isInteger(value)) return 'That must be a whole number.';
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/beat-clipboard.spec.ts --include=src/app/services/edit-refusals.percussion.spec.ts
```

Expected: `TOTAL: 35 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3410 SUCCESS`.

**Step 6: Commit.**

```text
feat: Refuse what a percussion staff has no string or pitch for

editRefusal gains a percussion test: fretted-only techniques, accidentals,
respelling, semitone and string moves, hammer-ons and trills say why, and
duration, dynamics, accents, tie and fermata go through. A fret digit says
why it wrote nothing, Pen only moves the caret on a drum staff, tuning and
capo refuse, and the clipboard's staff check has three kinds, so a kit no
longer pastes onto a piano staff.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase B: The loss checker

Build step 4: a pure module, reporting into nothing yet.

### Task B.1: The loss checker

The design's Part 2: `conversionLossOf(score, converted)`, pure over the alphaTab `Score` - and the converted
document, for its one row that needs `frettedDocOf` (correction 8). It walks master bars, tracks, staves, bars, voices,
beats and notes once, and returns only what the file holds, each with a count and a first bar, grouped as lost on
conversion or on the first save, ordered by first bar then count. A file that converts whole returns `[]`.

Forty rows. The design's two tables, less per-note dynamics (correction 4), plus three it missed (correction 6), with
two rows made exact that the design could only estimate: the drum kit alphaTex cannot carry, asked of alphaTab's own
exporter and importer one articulation at a time (correction 5), and MIDI channels, compared with `midiChannelsOf`. The
first beat's instrument automation is alphaTab's own and is kept (correction 7).

`frettedDocOf` also says the first bar it left a note out of. Nothing reads the list yet: the prompt does, in Phase C.

Every row has its own case in the spec, table-driven: a clean two-bar score parsed from alphaTex, the one feature set on
alphaTab's model after, and the item, its count and its first bar asserted, with no other item reported.

Corrected in review: the code blocks below are the first cut, and a review of files read by alphaTab's real importers
(`Gp3To5Importer`, `GpifParser`) found rows firing for what conversion keeps or nobody sees. The shipped checker, with
`alphaTab.core.mjs` line numbers in its comments, differs as follows; its spec adds a GP7 round trip
(`Gp7Exporter` then `ScoreLoader.loadScoreFromBytes`) and a GP5-shaped case for each importer habit.
- `tempoChanges` counts two automations at one place with one value once (GP3-5 puts bar 1's tempo there twice), and
  no longer treats `isLinear` as a reshaping (GP5 sets it on every mix-table change; alphaTab plays a step).
- A new row, `tempoText` ("Tempo markings' words", conversion), counts the words of every visible tempo marking, which
  the model drops while keeping the BPM - bar 1's included, so a GP5 file's "Moderate" is reported once.
- `credits` no longer includes `tempoLabel`; that text is `tempoText`'s now.
- `midiChannels` no longer compares `port` (nothing plays from it) and reports only the audible case: a track that is
  not a one-staff kit but that the file put on channel 9, which plays as drums until conversion. Relabelled to say so.
- `customStyles` counts a style only when it holds a colour, or on a note a notehead; the header and footer are
  compared with `ScoreStyle.defaultHeaderAndFooter` line by line, as drawn on what conversion keeps, under `layout`. A
  line's hide flag counts only for the tabber and the second copyright line: the renderer shows or hides the other
  eight by the notation settings, which the app leaves on.
- `layout` counts a per-track tuning entry only when it hides a tuning that would be drawn (global on, the track's
  staff stringed, tuned, not percussion, showing tablature), and leaves out the three chord-diagram settings, since the
  model drops chords and `chordDiagrams` says so. It no longer counts a systems layout, or a bar's or master bar's
  `displayScale` and `displayWidth`: the app renders the Page layout only and never sets `systemsLayoutMode`, so none
  is read (`lineBreaks` still count).
- `barLines` ignores the `LightLight` right bar line both importers set on a double bar, only where an automatic bar
  line draws the same: a double bar that is not a repeat end, not the last bar and not in free time.
- `lyricLines` counts a beat only when a line past the first has text: GP files pad every beat to five lines of `''`.
- `bendStyle` no longer counts `isContinuedBend`, which `Note.finish` recomputes from the tie and bend the mapper keeps.
- `unsavableKit` ignores a technique symbol's placement when there is no symbol, and `roundTripKeeps` finishes and
  exports inside its `try`.
- The mapper gives a natural harmonic the `harmonicValue` alphaTex's `nh` does (`naturalHarmonicValueOf` in its own
  pure module, `services/natural-harmonics.ts`, a copy of `ModelUtils.deltaFretToHarmonicValue`); before, a converted
  natural harmonic sounded the open string. `harmonicPitch` now reports an artificial, pinch, tap or semi harmonic
  whose pitch conversion drops, and a natural one whose value differs from its fret's - heard, or drawn in the tab.
- `keptAutomation` also keeps a first-beat volume, balance or bank automation equal to the track's own (correction 7).
- `restVoices` moves to the conversion group: its rests stop being drawn when the file converts, not at the save.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/gp-conversion-loss.spec.ts`, `services/gp-conversion-loss.ts`
- Modify: `services/pitch-on-strings.spec.ts`, `services/pitch-on-strings.ts`

**Step 1: The failing specs.**

`client/src/app/services/gp-conversion-loss.spec.ts`, new:

<!-- apply: create client/src/app/services/gp-conversion-loss.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { LossId, conversionLossOf } from './gp-conversion-loss';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * One spec per row of the loss checker: a score with that feature and no other, asserting the item, its count and its
 * first bar. There is no `.gp` fixture in the repo (the GP-composer design, Part 7), so each score is parsed from alphaTex
 * - a guitar track of two bars, a clean conversion - and the feature is set on alphaTab's model after, where a reader of
 * a real file would find it.
 */
describe('conversionLossOf', () => {
  let tex: AlphaTexService;
  let mapper: ScoreDocMapperService;
  const model = alphaTab.model;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    tex = TestBed.inject(AlphaTexService);
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  /** Two bars of four quarters on the G string, which convert whole. */
  function guitar(): alphaTab.model.Score {
    const { score } = tex.parse(['\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.4 5.3.4 5.3.4 5.3.4 |'].join('\n'));
    if (!score) throw new Error('the base score did not parse');
    return score;
  }

  const staffOf = (score: alphaTab.model.Score): alphaTab.model.Staff => score.tracks[0].staves[0];
  /** Beat `beat` of bar `bar` - bar 1, the second, unless said otherwise, so a first bar of 2 proves the bar is read. */
  const beatOf = (score: alphaTab.model.Score, beat = 0, bar = 1): alphaTab.model.Beat => staffOf(score).bars[bar].voices[0].beats[beat];
  const noteOf = (score: alphaTab.model.Score, beat = 0, bar = 1): alphaTab.model.Note => beatOf(score, beat, bar).notes[0];

  const lossOf = (score: alphaTab.model.Score) => conversionLossOf(score, mapper.toDoc(score));
  const itemOf = (score: alphaTab.model.Score, id: LossId) => lossOf(score).find(item => item.id === id);

  it('reports nothing for a file that converts whole', () => {
    expect(lossOf(guitar())).toEqual([]);
  });

  /** A case: what to set, what it reports, and the count and first bar it reports it with. */
  interface Case {
    id: LossId;
    set: (score: alphaTab.model.Score) => void;
    count?: number;
    firstBar?: number;
  }

  const cases: Case[] = [
    {
      id: 'chordDiagrams',
      set: score => {
        staffOf(score).addChord('c1', new model.Chord());
        staffOf(score).addChord('c2', new model.Chord());
        beatOf(score).chordId = 'c1';
      },
      count: 2
    },
    {
      id: 'tremoloBar',
      set: score => {
        const beat = beatOf(score);
        beat.whammyBarType = model.WhammyType.Dive;
        beat.addWhammyBarPoint(new model.BendPoint(0, 0));
        beat.addWhammyBarPoint(new model.BendPoint(60, -4));
      }
    },
    { id: 'wah', set: score => (beatOf(score).wahPedal = model.WahPedal.Open) },
    { id: 'lyricLines', set: score => (beatOf(score).lyrics = ['one', 'two']) },
    {
      id: 'tempoChanges',
      set: score => {
        score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, 90, 0));
        score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0.5, 100, 0));
      }
    },
    { id: 'tempoChanges', set: score => score.masterBars[1].tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0.5, 100, 0)) },
    { id: 'unnamedSlides', set: score => (noteOf(score).slideOutType = model.SlideOutType.OutDown) },
    { id: 'unnamedSlides', set: score => (noteOf(score).slideInType = model.SlideInType.IntoFromAbove) },
    {
      id: 'unnamedSlides',
      set: score => {
        noteOf(score).slideInType = model.SlideInType.IntoFromBelow;
        noteOf(score).slideOutType = model.SlideOutType.OutUp;
      }
    },
    { id: 'directions', set: score => (score.masterBars[1].directions = new Set([model.Direction.JumpDaCapo, model.Direction.TargetFine])), count: 2 },
    {
      id: 'syncPoints',
      set: score => {
        const point = new model.Automation();
        point.type = model.AutomationType.SyncPoint;
        score.masterBars[1].syncPoints = [point];
      }
    },
    { id: 'layout', set: score => (score.stylesheet.hideDynamics = true), firstBar: 0 },
    { id: 'layout', set: score => (score.masterBars[1].displayWidth = 300) },
    { id: 'fades', set: score => (beatOf(score).fade = model.FadeType.FadeOut) },
    { id: 'fades', set: score => (beatOf(score).fade = model.FadeType.VolumeSwell) },
    { id: 'tremoloPicking', set: score => (beatOf(score).tremoloPicking = new model.TremoloPickingEffect()) },
    { id: 'ornaments', set: score => (noteOf(score).ornament = model.NoteOrnament.Turn) },
    { id: 'sustainPedals', set: score => staffOf(score).bars[1].sustainPedals.push(new model.SustainPedalMarker()) },
    { id: 'simile', set: score => (staffOf(score).bars[1].simileMark = model.SimileMark.Simple) },
    {
      id: 'barre',
      set: score => {
        beatOf(score).barreShape = model.BarreShape.Full;
        beatOf(score).barreFret = 5;
      }
    },
    { id: 'rasgueado', set: score => (beatOf(score).rasgueado = model.Rasgueado.Ii) },
    { id: 'golpe', set: score => (beatOf(score).golpe = model.GolpeType.Thumb) },
    { id: 'beatOttava', set: score => (beatOf(score).ottava = model.Ottavia._8va) },
    { id: 'slashedBeats', set: score => (beatOf(score).slashed = true) },
    { id: 'otherDynamics', set: score => (beatOf(score).dynamics = model.DynamicValue.SFZ) },
    { id: 'bendGraces', set: score => (beatOf(score).graceType = model.GraceType.BendGrace) },
    {
      id: 'harmonicPitch',
      set: score => {
        noteOf(score).harmonicType = model.HarmonicType.Artificial;
        noteOf(score).harmonicValue = 12;
      }
    },
    { id: 'feedbackHarmonics', set: score => (noteOf(score).harmonicType = model.HarmonicType.Feedback) },
    { id: 'bendStyle', set: score => (noteOf(score).bendStyle = model.BendStyle.Gradual) },
    { id: 'bendStyle', set: score => (noteOf(score).isContinuedBend = true) },
    { id: 'slurs', set: score => (beatOf(score).isLegatoOrigin = true) },
    { id: 'slurs', set: score => (noteOf(score).isSlurDestination = true) },
    { id: 'hiddenNotes', set: score => (noteOf(score).isVisible = false) },
    { id: 'hiddenNotes', set: score => (noteOf(score).durationPercent = 0.5) },
    {
      id: 'beatAutomations',
      set: score => {
        const volume = new model.Automation();
        volume.type = model.AutomationType.Volume;
        beatOf(score).automations.push(volume);
      }
    },
    { id: 'pickupBars', set: score => (score.masterBars[0].isAnacrusis = true), firstBar: 1 },
    { id: 'barLines', set: score => (staffOf(score).bars[1].barLineRight = model.BarLineStyle.Heavy) },
    { id: 'beaming', set: score => (beatOf(score).invertBeamDirection = true) },
    { id: 'beaming', set: score => (beatOf(score).beamingMode = model.BeatBeamingMode.ForceMergeWithNext) },
    {
      id: 'brushSpeed',
      set: score => {
        beatOf(score).brushType = model.BrushType.BrushDown;
        beatOf(score).brushDuration = 120;
      }
    },
    { id: 'forcedNaturals', set: score => (noteOf(score).accidentalMode = model.NoteAccidentalMode.ForceNatural) },
    { id: 'forcedNaturals', set: score => (noteOf(score).accidentalMode = model.NoteAccidentalMode.ForceNone) },
    {
      // A pitched C0 on a guitar staff: `frettedDocOf` finds no string that reaches it.
      id: 'unreachableNotes',
      set: score => {
        const low = new model.Note();
        low.octave = 1;
        low.tone = 0;
        beatOf(score, 1).addNote(low);
      }
    },
    {
      id: 'credits',
      set: score => {
        score.copyright = '2026';
        score.words = 'Someone';
      },
      count: 2,
      firstBar: 0
    },
    { id: 'midiChannels', set: score => (score.tracks[0].playbackInfo.primaryChannel = 5), firstBar: 0 },
    { id: 'customStyles', set: score => (noteOf(score).style = new model.NoteStyle()) },
    { id: 'doubleBars', set: score => (score.masterBars[1].isDoubleBar = true) }
  ];

  for (const { id, set, count = 1, firstBar = 2 } of cases) {
    it(`reports ${id}, with its count and first bar`, () => {
      const score = guitar();
      set(score);

      const loss = lossOf(score);
      expect(loss.map(item => item.id)).withContext('only the item set').toEqual([id]);
      expect(loss[0].count).toBe(count);
      expect(loss[0].firstBar).toBe(firstBar);
    });
  }

  it('says the count and the first bar in the detail, and lists the first save under its own group', () => {
    const score = guitar();
    beatOf(score, 0).wahPedal = model.WahPedal.Open;
    beatOf(score, 2).wahPedal = model.WahPedal.Closed;
    score.masterBars[1].isDoubleBar = true;

    const loss = lossOf(score);
    expect(itemOf(score, 'wah')).toEqual({ id: 'wah', group: 'conversion', label: 'Wah', detail: '2 beats, first in bar 2', count: 2, firstBar: 2 });
    expect(loss.find(item => item.id === 'doubleBars')?.group).toBe('first save');
  });

  it('lists items by first bar, then by count, most first', () => {
    const score = guitar();
    score.copyright = '2026';
    beatOf(score, 0).wahPedal = model.WahPedal.Open;
    beatOf(score, 0, 0).golpe = model.GolpeType.Thumb;
    beatOf(score, 1).rasgueado = model.Rasgueado.Ii;
    beatOf(score, 2).rasgueado = model.Rasgueado.Ii;

    expect(lossOf(score).map(item => item.id)).toEqual(['credits', 'golpe', 'rasgueado', 'wah']);
  });

  it('does not report per-note dynamics, which alphaTab copies from the beat on every finish', () => {
    const score = guitar();
    noteOf(score).dynamics = model.DynamicValue.PP;
    score.finish(new alphaTab.Settings());

    expect(lossOf(score)).toEqual([]);
  });

  it('does not report multiple voices, which convert whole, and does report a second voice of rests alone as a save item', () => {
    const score = guitar();
    for (const bar of staffOf(score).bars) {
      const voice = new model.Voice();
      bar.addVoice(voice);
      for (let index = 0; index < 4; index++) {
        const beat = new model.Beat();
        beat.duration = model.Duration.Quarter;
        // Bar 1's second voice has notes; bar 2's is rests alone.
        if (bar.index === 0) {
          const note = new model.Note();
          note.fret = 0;
          note.string = 1;
          beat.addNote(note);
        }
        voice.addBeat(beat);
      }
    }
    score.finish(new alphaTab.Settings());

    const loss = lossOf(score);
    expect(loss.map(item => item.id)).toEqual(['restVoices']);
    expect(loss[0]).toEqual(jasmine.objectContaining({ group: 'first save', count: 1, firstBar: 2 }));
  });

  describe('drums', () => {
    function kit(extra: alphaTab.model.InstrumentArticulation | null = null): alphaTab.model.Score {
      const { score } = tex.parse(['\\track "Drums" {instrument percussion}', '\\articulation defaults', '"Kick (hit)".4 "Snare (hit)".4 r.2 |'].join('\n'));
      if (!score) throw new Error('the kit did not parse');
      if (extra) {
        score.tracks[0].percussionArticulations.push(extra);
        score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].percussionArticulation = score.tracks[0].percussionArticulations.length - 1;
      }
      return score;
    }

    it('reports nothing for a standard kit, which alphaTex names and reads back as itself', () => {
      expect(lossOf(kit())).toEqual([]);
    });

    it('reports a drum alphaTex has no name for as a save item, since the save would not reopen', () => {
      const head = model.MusicFontSymbol.NoteheadBlack;
      const loss = lossOf(kit(new model.InstrumentArticulation('Mystery', 5, 77, head, head, head, model.MusicFontSymbol.None, undefined, 999)));

      expect(loss.map(item => item.id)).toEqual(['unsavableKit']);
      expect(loss[0]).toEqual(jasmine.objectContaining({ group: 'first save', count: 1, firstBar: 1 }));
    });

    it('reports a standard drum the file draws or plays differently, which the reload would take from the table', () => {
      const snare = kit().tracks[0].percussionArticulations.find(articulation => articulation.id === 38);
      if (!snare) throw new Error('no snare');
      const moved = new model.InstrumentArticulation(snare.elementType, snare.staffLine + 2, snare.outputMidiNumber, snare.noteHeadDefault, snare.noteHeadHalf, snare.noteHeadWhole, snare.techniqueSymbol, snare.techniqueSymbolPlacement, snare.id);

      expect(lossOf(kit(moved)).map(item => item.id)).toEqual(['unsavableKit']);
    });
  });
});
```

`client/src/app/services/pitch-on-strings.spec.ts`:

<!-- apply: find client/src/app/services/pitch-on-strings.spec.ts -->
```ts
    doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes = [noteOf({ kind: 'pitched', noteValue: 0, octave: 4 })];

    expect(frettedDocOf(doc)).toEqual({ doc, converted: 0, dropped: 0 });
  });

```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.spec.ts -->
```ts
    doc.tracks[1].staves[0].bars[0].voices[0].beats[0].notes = [noteOf({ kind: 'pitched', noteValue: 0, octave: 4 })];

    expect(frettedDocOf(doc)).toEqual({ doc, converted: 0, dropped: 0, firstDroppedBar: null });
  });

```

<!-- apply: find client/src/app/services/pitch-on-strings.spec.ts -->
```ts
    expect(doc).toEqual(before);
    expect(result.dropped).toBe(1);
    expect(result.converted).toBe(1);
    expect(beats[0].notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.spec.ts -->
```ts
    expect(doc).toEqual(before);
    expect(result.dropped).toBe(1);
    expect(result.firstDroppedBar).toBe(0);
    expect(result.converted).toBe(1);
    expect(beats[0].notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 10 errors, the first:

```text
src/app/services/gp-conversion-loss.spec.ts(5,42): error TS2307: Cannot find module './gp-conversion-loss' or its corresponding type declarations.
```

**Step 3: The implementation.**

`client/src/app/services/gp-conversion-loss.ts`, new:

<!-- apply: create client/src/app/services/gp-conversion-loss.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';
import { fromDynamicValue } from './alpha-tab-enum.bridge';
import { midiChannelsOf } from './midi-channels';
import { frettedDocOf } from './pitch-on-strings';

/**
 * What converting a `.gp` file into a composition would change, read from the file itself.
 *
 * Conversion is one call to `ScoreDocMapperService.toDoc` and one to `frettedDocOf` after it (the GP-composer design,
 * Part 4), so a gap in either is what the conversion prompt has to name. This walks the alphaTab `Score` once - master
 * bars, then each track's staves, bars, voices, beats and notes - and returns only what the file has, with counts and
 * the first bar, so the prompt can say "Chord diagrams: 3, first in bar 5" rather than a warning that says the same about
 * every file. A file that converts whole returns `[]`.
 *
 * Per-note dynamics are not an item, though the model marks a dynamic on the beat alone: `Beat.finish` copies the
 * beat's dynamic onto each of its notes (`alphaTab.core.mjs` ~7811), so a parsed score has none of its own to lose.
 *
 * Named for what it returns, per `CLAUDE.md`. It never calls the mapper - the mapper is what it is about - but reads the
 * same fields the mapper reads and skips. When the model grows a field, its row comes out of `ITEMS` and its spec is
 * deleted, which is the audit trail. Two rows need more than the score: the notes no string reaches, which only running
 * `frettedDocOf` on the converted document can say (`converted`), and a drum kit alphaTex cannot carry, which is asked of
 * alphaTab's own exporter and importer (`alphaTexKeeps`).
 */

/** Which heading the prompt lists an item under: what the file loses now, or what the first save of it loses. */
export type LossGroup = 'conversion' | 'first save';

export type LossId =
  | 'chordDiagrams'
  | 'tremoloBar'
  | 'wah'
  | 'lyricLines'
  | 'tempoChanges'
  | 'unnamedSlides'
  | 'directions'
  | 'syncPoints'
  | 'layout'
  | 'fades'
  | 'tremoloPicking'
  | 'ornaments'
  | 'sustainPedals'
  | 'simile'
  | 'barre'
  | 'rasgueado'
  | 'golpe'
  | 'beatOttava'
  | 'slashedBeats'
  | 'otherDynamics'
  | 'bendGraces'
  | 'harmonicPitch'
  | 'feedbackHarmonics'
  | 'bendStyle'
  | 'slurs'
  | 'hiddenNotes'
  | 'beatAutomations'
  | 'pickupBars'
  | 'barLines'
  | 'beaming'
  | 'brushSpeed'
  | 'forcedNaturals'
  | 'unreachableNotes'
  | 'credits'
  | 'midiChannels'
  | 'customStyles'
  | 'restVoices'
  | 'unsavableKit'
  | 'doubleBars';

export interface LossItem {
  id: LossId;
  group: LossGroup;
  /** What the prompt names: "Chord diagrams". */
  label: string;
  /** How many and where: "3 diagrams, first in bar 5". */
  detail: string;
  count: number;
  /** 1-based; 0 where the item is not on a bar - the stylesheet, the credits, the channels. */
  firstBar: number;
}

/** How each item is named, counted and grouped. `one` and `many` are the counted thing, singular and plural. */
const ITEMS: Readonly<Record<LossId, { label: string; one: string; many: string; group: LossGroup; note?: string }>> = {
  chordDiagrams: { label: 'Chord diagrams', one: 'diagram', many: 'diagrams', group: 'conversion' },
  tremoloBar: { label: 'Tremolo bar', one: 'beat', many: 'beats', group: 'conversion' },
  wah: { label: 'Wah', one: 'beat', many: 'beats', group: 'conversion' },
  lyricLines: { label: 'Lyric lines past the first', one: 'beat', many: 'beats', group: 'conversion' },
  tempoChanges: { label: 'Tempo changes within a bar', one: 'change', many: 'changes', group: 'conversion' },
  unnamedSlides: { label: 'Slides out downwards, pick slides and slides in from above', one: 'note', many: 'notes', group: 'conversion' },
  directions: { label: 'Directions: D.C., D.S., Coda, Fine', one: 'marking', many: 'markings', group: 'conversion' },
  syncPoints: { label: 'Backing-track sync points', one: 'sync point', many: 'sync points', group: 'conversion' },
  layout: { label: 'Page layout and stylesheet', one: 'setting', many: 'settings', group: 'conversion', note: 'the layout goes back to the default' },
  fades: { label: 'Fade-outs and volume swells', one: 'beat', many: 'beats', group: 'conversion' },
  tremoloPicking: { label: 'Tremolo picking', one: 'beat', many: 'beats', group: 'conversion' },
  ornaments: { label: 'Ornaments: turns and mordents', one: 'note', many: 'notes', group: 'conversion' },
  sustainPedals: { label: 'Sustain pedal', one: 'marking', many: 'markings', group: 'conversion' },
  simile: { label: 'Simile marks', one: 'bar', many: 'bars', group: 'conversion' },
  barre: { label: 'Barré', one: 'beat', many: 'beats', group: 'conversion' },
  rasgueado: { label: 'Rasgueado', one: 'beat', many: 'beats', group: 'conversion' },
  golpe: { label: 'Golpe', one: 'beat', many: 'beats', group: 'conversion' },
  beatOttava: { label: 'Ottava on a beat', one: 'beat', many: 'beats', group: 'conversion', note: "only a bar's clef keeps an ottava" },
  slashedBeats: { label: 'Slash beats and dead slaps', one: 'beat', many: 'beats', group: 'conversion' },
  otherDynamics: { label: 'Dynamics other than ppp to fff', one: 'beat', many: 'beats', group: 'conversion', note: 'they play forte' },
  bendGraces: { label: 'Bend grace notes', one: 'beat', many: 'beats', group: 'conversion', note: 'they become full beats' },
  harmonicPitch: { label: 'The pitch of harmonics', one: 'note', many: 'notes', group: 'conversion', note: 'they sound and engrave at the fretted pitch' },
  feedbackHarmonics: { label: 'Feedback harmonics', one: 'note', many: 'notes', group: 'conversion' },
  bendStyle: { label: 'Gradual, fast and continued bends', one: 'note', many: 'notes', group: 'conversion' },
  slurs: { label: 'Slurs', one: 'slur', many: 'slurs', group: 'conversion' },
  hiddenNotes: { label: 'Invisible and shortened notes', one: 'note', many: 'notes', group: 'conversion' },
  beatAutomations: { label: 'Instrument, volume and balance changes', one: 'change', many: 'changes', group: 'conversion' },
  pickupBars: { label: 'Pickup bars', one: 'bar', many: 'bars', group: 'conversion', note: 'each becomes a full bar' },
  barLines: { label: 'Bar line styles', one: 'bar', many: 'bars', group: 'conversion' },
  beaming: { label: 'Beaming', one: 'place', many: 'places', group: 'conversion' },
  brushSpeed: { label: 'Strum speed', one: 'beat', many: 'beats', group: 'conversion', note: 'the direction stays' },
  forcedNaturals: { label: 'Forced naturals and hidden accidentals', one: 'note', many: 'notes', group: 'conversion' },
  unreachableNotes: { label: "Notes no string reaches", one: 'note', many: 'notes', group: 'conversion', note: 'they are left out' },
  credits: { label: 'Credits: copyright, music, words, notices', one: 'field', many: 'fields', group: 'conversion' },
  midiChannels: { label: 'MIDI channels', one: 'track', many: 'tracks', group: 'conversion', note: 'each track is given its own' },
  customStyles: { label: 'Custom colours and noteheads', one: 'element', many: 'elements', group: 'conversion' },
  restVoices: { label: 'A second voice of rests alone', one: 'bar', many: 'bars', group: 'first save', note: 'saving writes only voices with notes' },
  unsavableKit: {
    label: 'Drums alphaTex cannot name',
    one: 'note',
    many: 'notes',
    group: 'first save',
    note: 'the save would not reopen, so converting refuses'
  },
  doubleBars: { label: 'Double bar lines', one: 'bar', many: 'bars', group: 'first save' }
};

/** A running count of each item, and the first bar it was met in. */
class Tally {
  private readonly counts = new Map<LossId, { count: number; firstBar: number }>();

  /** Counts `count` of `id` in the bar at `barIndex` (0-based), or on no bar at all when it is null. */
  add(id: LossId, barIndex: number | null, count = 1): void {
    if (count <= 0) return;
    const bar = barIndex === null ? 0 : barIndex + 1;
    const seen = this.counts.get(id);
    this.counts.set(id, {
      count: (seen?.count ?? 0) + count,
      firstBar: seen === undefined ? bar : Math.min(seen.firstBar, bar)
    });
  }

  items(): LossItem[] {
    return [...this.counts]
      .map(([id, { count, firstBar }]) => {
        const text = ITEMS[id];
        const counted = `${count} ${count === 1 ? text.one : text.many}`;
        const where = firstBar > 0 ? `${counted}, first in bar ${firstBar}` : counted;
        return { id, group: text.group, label: text.label, detail: text.note ? `${where}; ${text.note}` : where, count, firstBar };
      })
      .sort((a, b) => a.firstBar - b.firstBar || b.count - a.count);
  }
}

/**
 * Everything converting `score` would change, and everything its first save would, in the order the prompt lists them:
 * by first bar, then by count, most first. `converted` is the document Convert would make - `toDoc(score)` - and is read
 * for one row only, the notes `frettedDocOf` leaves out.
 */
export function conversionLossOf(score: alphaTab.model.Score, converted: ScoreDoc): LossItem[] {
  const tally = new Tally();
  scoreLossInto(tally, score);
  score.masterBars.forEach((masterBar, index) => masterBarLossInto(tally, masterBar, index));

  const channels = midiChannelsOf(score.tracks);
  score.tracks.forEach((track, index) => {
    const playback = track.playbackInfo;
    const expected = channels[index];
    if (playback.primaryChannel !== expected.primary || playback.secondaryChannel !== expected.secondary || playback.port !== 1) {
      tally.add('midiChannels', null);
    }
    if (track.style) tally.add('customStyles', null);
    if (track.systemsLayout.length > 0 || (track.lineBreaks?.size ?? 0) > 0) tally.add('layout', null);
    for (const staff of track.staves) staffLossInto(tally, staff);
  });

  const fretted = frettedDocOf(converted);
  tally.add('unreachableNotes', fretted.firstDroppedBar, fretted.dropped);
  return tally.items();
}

/** A fresh score, for what alphaTab's own defaults are. */
const DEFAULTS = new alphaTab.model.Score();

function scoreLossInto(tally: Tally, score: alphaTab.model.Score): void {
  const credits = [score.copyright, score.music, score.words, score.tab, score.notices, score.instructions, score.tempoLabel];
  tally.add('credits', null, credits.filter(field => (field ?? '') !== '').length);
  if (score.style) tally.add('customStyles', null);
  if (score.backingTrack) tally.add('syncPoints', null);

  const sheet = score.stylesheet as unknown as Record<string, unknown>;
  const defaults = DEFAULTS.stylesheet as unknown as Record<string, unknown>;
  const changed = Object.keys(defaults).filter(key => !sameSetting(sheet[key], defaults[key])).length;
  const systems = score.defaultSystemsLayout !== DEFAULTS.defaultSystemsLayout || score.systemsLayout.length > 0 ? 1 : 0;
  tally.add('layout', null, changed + systems);
}

/** Whether a stylesheet setting is its default: equal, or both empty collections. */
function sameSetting(value: unknown, fallback: unknown): boolean {
  const size = (entry: unknown): number | null => (entry instanceof Map || entry instanceof Set ? entry.size : null);
  if (size(value) !== null || size(fallback) !== null) return (size(value) ?? 0) === (size(fallback) ?? 0);
  return value === fallback;
}

function masterBarLossInto(tally: Tally, masterBar: alphaTab.model.MasterBar, index: number): void {
  tally.add('directions', index, masterBar.directions?.size ?? 0);
  tally.add('syncPoints', index, masterBar.syncPoints?.length ?? 0);
  if (masterBar.isAnacrusis) tally.add('pickupBars', index);
  if (masterBar.beamingRules) tally.add('beaming', index);
  if (masterBar.displayScale !== 1 || masterBar.displayWidth !== -1) tally.add('layout', index);
  if (masterBar.isDoubleBar) tally.add('doubleBars', index);

  // The model keeps one BPM per bar, at its start: `toDoc` reads the first automation of every bar after the first, and
  // bar 1's is the score's tempo. Every other automation goes, and so does a first one that starts mid-bar or ramps.
  const automations = masterBar.tempoAutomations;
  const [first] = automations;
  const reshaped = first !== undefined && (first.ratioPosition > 0 || first.isLinear) ? 1 : 0;
  tally.add('tempoChanges', index, Math.max(0, automations.length - 1) + reshaped);
}

function staffLossInto(tally: Tally, staff: alphaTab.model.Staff): void {
  const diagrams = staff.chords?.size ?? 0;
  if (diagrams > 0) {
    const firstUse = staff.bars.find(bar => bar.voices.some(voice => voice.beats.some(beat => beat.chordId !== null)));
    tally.add('chordDiagrams', firstUse?.index ?? null, diagrams);
  }
  for (const bar of staff.bars) barLossInto(tally, bar);
}

function barLossInto(tally: Tally, bar: alphaTab.model.Bar): void {
  const at = bar.index;
  tally.add('sustainPedals', at, bar.sustainPedals.length);
  if (bar.simileMark !== alphaTab.model.SimileMark.None) tally.add('simile', at);
  if (bar.barLineLeft !== alphaTab.model.BarLineStyle.Automatic || bar.barLineRight !== alphaTab.model.BarLineStyle.Automatic) {
    tally.add('barLines', at);
  }
  if (bar.displayScale !== 1 || bar.displayWidth !== -1) tally.add('layout', at);
  if (bar.style) tally.add('customStyles', at);

  bar.voices.forEach((voice, index) => {
    if (voice.style) tally.add('customStyles', at);
    // Kept by the conversion and dropped by the save: `toVoice` draws a rest-only voice past the first as empty, so
    // alphaTex writes none of its beats. An empty voice - a file's placeholder - has nothing to lose. Both flags are
    // `Voice.finish`'s own, which a parsed score has run.
    if (index > 0 && !voice.isEmpty && voice.isRestOnly) tally.add('restVoices', at);
    for (const beat of voice.beats) beatLossInto(tally, beat, at);
  });
}

function beatLossInto(tally: Tally, beat: alphaTab.model.Beat, at: number): void {
  const model = alphaTab.model;
  if (beat.hasWhammyBar) tally.add('tremoloBar', at);
  if (beat.wahPedal !== model.WahPedal.None) tally.add('wah', at);
  if ((beat.lyrics?.length ?? 0) > 1) tally.add('lyricLines', at);
  if (beat.fade === model.FadeType.FadeOut || beat.fade === model.FadeType.VolumeSwell) tally.add('fades', at);
  if (beat.isTremolo) tally.add('tremoloPicking', at);
  if (beat.barreShape !== model.BarreShape.None) tally.add('barre', at);
  if (beat.rasgueado !== model.Rasgueado.None) tally.add('rasgueado', at);
  if (beat.golpe !== model.GolpeType.None) tally.add('golpe', at);
  if (beat.ottava !== model.Ottavia.Regular) tally.add('beatOttava', at);
  if (beat.slashed || beat.deadSlapped) tally.add('slashedBeats', at);
  if (beat.isLegatoOrigin) tally.add('slurs', at);
  tally.add('beatAutomations', at, beat.automations.filter(automation => !keptAutomation(beat, automation)).length);
  if (beat.beamingMode !== model.BeatBeamingMode.Auto || beat.invertBeamDirection || beat.preferredBeamDirection !== null) {
    tally.add('beaming', at);
  }
  if (beat.brushType !== model.BrushType.None && beat.brushDuration !== 0) tally.add('brushSpeed', at);
  if (beat.graceType === model.GraceType.BendGrace) tally.add('bendGraces', at);
  if (!beat.isRest && fromDynamicValue(beat.dynamics) === null) tally.add('otherDynamics', at);
  if (beat.style) tally.add('customStyles', at);
  for (const note of beat.notes) noteLossInto(tally, note, at);
}

function noteLossInto(tally: Tally, note: alphaTab.model.Note, at: number): void {
  const model = alphaTab.model;
  if (note.ornament !== model.NoteOrnament.None) tally.add('ornaments', at);
  if (note.harmonicType === model.HarmonicType.Feedback) tally.add('feedbackHarmonics', at);
  else if (note.harmonicType !== model.HarmonicType.None && note.harmonicValue !== 0) tally.add('harmonicPitch', at);
  if (note.bendStyle !== model.BendStyle.Default || note.isContinuedBend) tally.add('bendStyle', at);
  if (note.isSlurDestination) tally.add('slurs', at);
  if (!note.isVisible || note.durationPercent !== 1) tally.add('hiddenNotes', at);
  if (note.accidentalMode === model.NoteAccidentalMode.ForceNatural || note.accidentalMode === model.NoteAccidentalMode.ForceNone) {
    tally.add('forcedNaturals', at);
  }
  if (unnamedSlide(note)) tally.add('unnamedSlides', at);
  if (note.style) tally.add('customStyles', at);
  if (note.isPercussion && !alphaTexKeeps(note)) tally.add('unsavableKit', at);
}

/**
 * Whether `automation`, on `beat`, survives the conversion: a tempo automation, which `tempoChanges` counts; or the
 * instrument automation `Beat.finish` puts on a track's first beat from its own program (`alphaTab.core.mjs` ~7765),
 * which `toScore`'s finish puts back, since the program is `PlaybackInfoDoc.program`. On a drum track that automation
 * carries the program from before `Track.finish` zeroed it, and channel 9 plays no program, so it is kept whatever it says.
 */
function keptAutomation(beat: alphaTab.model.Beat, automation: alphaTab.model.Automation): boolean {
  const type = alphaTab.model.AutomationType;
  if (automation.type === type.Tempo) return true;
  const staff = beat.voice.bar.staff;
  const first = beat.index === 0 && beat.voice.index === 0 && beat.voice.bar.index === 0 && staff.index === 0;
  if (!first || automation.type !== type.Instrument) return false;
  return staff.isPercussion || automation.value === staff.track.playbackInfo.program;
}

/**
 * Whether `slideOf` (`alpha-tab-enum.bridge.ts`) drops the slide: it names a shift, a legato slide, a slide out upwards
 * and a slide in from below, and reads the slide in only when there is no slide out.
 */
function unnamedSlide(note: alphaTab.model.Note): boolean {
  const out = alphaTab.model.SlideOutType;
  const into = alphaTab.model.SlideInType;
  if (note.slideOutType === out.OutDown || note.slideOutType === out.PickSlideDown || note.slideOutType === out.PickSlideUp) return true;
  if (note.slideInType === into.IntoFromAbove) return true;
  return note.slideInType !== into.None && note.slideOutType !== out.None;
}

/** What alphaTex does with a drum, by the articulation it names: kept, or not. Asked once per distinct articulation. */
const KEPT_BY_ALPHATEX = new Map<string, boolean>();

/**
 * Whether the alphaTex a save writes carries `note`'s drum back as itself.
 *
 * alphaTex names a drum from alphaTab's own table and never writes the track's kit, so the save keeps a drum only when
 * the table has one of the same `uniqueId` - `elementType.id` - and the same staff line, noteheads, symbol and MIDI key,
 * since the reload takes all of those from the table. A drum the table has no name for is written `"unknown"`, and the
 * reload throws (design Part 3). alphaTab's table is internal to it, so rather than copy the table this asks alphaTab: a
 * one-note score of that drum is written and read back, and the drum it reads compared with the one it wrote.
 */
function alphaTexKeeps(note: alphaTab.model.Note): boolean {
  const kit = note.beat.voice.bar.staff.track.percussionArticulations;
  const own = note.percussionArticulation < kit.length ? kit[note.percussionArticulation] : null;
  const key = own ? articulationKeyOf(own) : `id:${note.percussionArticulation}`;
  let kept = KEPT_BY_ALPHATEX.get(key);
  if (kept === undefined) {
    kept = roundTripKeeps(own, note.percussionArticulation);
    KEPT_BY_ALPHATEX.set(key, kept);
  }
  return kept;
}

function articulationKeyOf(articulation: alphaTab.model.InstrumentArticulation): string {
  return [
    articulation.elementType,
    articulation.id,
    articulation.staffLine,
    articulation.noteHeadDefault,
    articulation.noteHeadHalf,
    articulation.noteHeadWhole,
    articulation.techniqueSymbol,
    articulation.techniqueSymbolPlacement,
    articulation.outputMidiNumber
  ].join('|');
}

/** Writes one drum - `own`, a track's articulation, or the id `id` in alphaTab's table - as alphaTex, reads it back, and compares. */
function roundTripKeeps(own: alphaTab.model.InstrumentArticulation | null, id: number): boolean {
  const settings = new alphaTab.Settings();
  const score = new alphaTab.model.Score();
  score.addMasterBar(new alphaTab.model.MasterBar());
  const track = new alphaTab.model.Track();
  const staff = new alphaTab.model.Staff();
  staff.isPercussion = true;
  track.addStaff(staff);
  score.addTrack(track);
  if (own) track.percussionArticulations.push(own);
  const bar = new alphaTab.model.Bar();
  staff.addBar(bar);
  const voice = new alphaTab.model.Voice();
  bar.addVoice(voice);
  const beat = new alphaTab.model.Beat();
  voice.addBeat(beat);
  const drum = new alphaTab.model.Note();
  drum.percussionArticulation = own ? 0 : id;
  beat.addNote(drum);
  score.finish(settings);

  const tex = new alphaTab.exporter.AlphaTexExporter().exportToString(score, settings);
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.logErrors = false;
  try {
    importer.initFromString(tex, settings);
    const read = importer.readScore();
    const readTrack = read.tracks[0];
    const readNote = readTrack?.staves[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0];
    if (!readTrack || !readNote) return false;
    const readOwn = readNote.percussionArticulation < readTrack.percussionArticulations.length ? readTrack.percussionArticulations[readNote.percussionArticulation] : null;
    if (!own) return readOwn !== null && readOwn.id === id;
    return readOwn !== null && articulationKeyOf(readOwn) === articulationKeyOf(own);
  } catch {
    return false;
  }
}
```

`client/src/app/services/pitch-on-strings.ts`:

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
/**
 * `doc` with every pitched note on a staff with a tuning fretted, how many it fretted (`converted`), and how many notes no
 * free string reached, which are left out - a beat left with none becomes a rest. The same document when there is nothing
 * to fret; otherwise a copy.
 *
 * Each note takes the lowest free fret (`frettedPlacementOf`), in the beat's order, after the fretted notes already
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
/**
 * `doc` with every pitched note on a staff with a tuning fretted, how many it fretted (`converted`), and how many notes no
 * free string reached, which are left out - a beat left with none becomes a rest - with the first bar, 0-based, that
 * lost one (`firstDroppedBar`, null when none did). The same document when there is nothing to fret; otherwise a copy.
 *
 * Each note takes the lowest free fret (`frettedPlacementOf`), in the beat's order, after the fretted notes already
```

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
 * saved before Pen wrote frets. The mapper asks it too, so nothing pitched reaches alphaTab on a string.
 */
export function frettedDocOf(doc: ScoreDoc): { doc: ScoreDoc; converted: number; dropped: number } {
  const needsFretting = doc.tracks.some(track =>
    track.staves.some(staff => staff.tuning.length > 0 && staff.bars.some(bar => bar.voices.some(voice => voice.beats.some(beat => beat.notes.some(note => note.pitch.kind === 'pitched')))))
  );
  if (!needsFretting) return { doc, converted: 0, dropped: 0 };

  const copy = structuredClone(doc);
  let dropped = 0;
  let converted = 0;
  for (const staff of copy.tracks.flatMap(track => track.staves)) {
    if (staff.tuning.length === 0) continue;
    for (const beat of staff.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats))) {
      if (!beat.notes.some(note => note.pitch.kind === 'pitched')) continue;
      const taken = stringsTakenOn(beat.notes);
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
 * saved before Pen wrote frets. The mapper asks it too, so nothing pitched reaches alphaTab on a string.
 */
export function frettedDocOf(doc: ScoreDoc): { doc: ScoreDoc; converted: number; dropped: number; firstDroppedBar: number | null } {
  const needsFretting = doc.tracks.some(track =>
    track.staves.some(staff => staff.tuning.length > 0 && staff.bars.some(bar => bar.voices.some(voice => voice.beats.some(beat => beat.notes.some(note => note.pitch.kind === 'pitched')))))
  );
  if (!needsFretting) return { doc, converted: 0, dropped: 0, firstDroppedBar: null };

  const copy = structuredClone(doc);
  let dropped = 0;
  let converted = 0;
  let firstDroppedBar: number | null = null;
  for (const staff of copy.tracks.flatMap(track => track.staves)) {
    if (staff.tuning.length === 0) continue;
    for (const [barIndex, beat] of staff.bars.flatMap((bar, index) => bar.voices.flatMap(voice => voice.beats.map(beat => [index, beat] as const)))) {
      if (!beat.notes.some(note => note.pitch.kind === 'pitched')) continue;
      const taken = stringsTakenOn(beat.notes);
```

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
        if (typeof placed === 'string') {
          dropped++;
          return false;
        }
```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
        if (typeof placed === 'string') {
          dropped++;
          firstDroppedBar = Math.min(firstDroppedBar ?? barIndex, barIndex);
          return false;
        }
```

<!-- apply: find client/src/app/services/pitch-on-strings.ts -->
```ts
    }
  }
  return { doc: copy, converted, dropped };
}

```

becomes

<!-- apply: replace client/src/app/services/pitch-on-strings.ts -->
```ts
    }
  }
  return { doc: copy, converted, dropped, firstDroppedBar };
}

```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/gp-conversion-loss.spec.ts --include=src/app/services/pitch-on-strings.spec.ts
```

Expected: `TOTAL: 71 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3465 SUCCESS`.

**Step 6: Commit.**

```text
feat: Name what converting a .gp file would change

conversionLossOf walks the alphaTab Score once and returns only what the
file holds that the model cannot, with counts and the first bar, grouped as
lost on conversion or on the first save. A drum kit is asked of alphaTab's
own exporter and importer rather than counted as an exposure, and
frettedDocOf now says the first bar it left a note out of. Nothing reads the
list yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase C: The prompt

Build step 5: the gate, the prompt and Save the original first. Convert is disabled and says so.

### Task C.1: The gate, the prompt, and Save the original first

Build step 5. Three pieces:

- **The gate.** `ComposerGpService.requestEdit(id, label, run)` runs `run` - or, in Original, when `changesDocument(id)`,
  holds it and publishes it as the `request` the prompt answers. Every writing command on the page goes through it:
  the tool table, wrapped once in the page so the palette and the keys ask alike; a popover's value; Pen's write,
  which reads the pointer's height now for a write that may run after Convert; the strip's Add track, and its Add
  progression track and Update; the progression page's Send, whose request the composer page shows on arrival; an
  alphaTex apply, which keeps the draft as typed, since converting reseeds the panel; and Save, from Ctrl+S and from
  the Library menu, through the page's save guard. The service also measures the loss as a file opens, and ends Original
  by itself when `documentId` moves (correction 10).
- **The prompt.** `ComposerConvertPromptComponent`, a modal as the shortcut sheet is: what the edit was, that
  converting cannot be undone, what the file and its first save would lose - or that nothing would change - then *Save
  the original file first*, *Convert* and *Cancel*. Escape and the backdrop cancel; while it is open the page is inert
  and the keys reach only Escape. The sheet's focus handling moves into `ModalFocus`, which both use.
- **Save the original.** `ComposerExportService.downloadOriginal` hands the bytes back under the file's own name, and
  the prompt stays open.

Convert is disabled here and says so: converting is Phase D.

**Files** (under `client/src/app/` unless given in full):
- Create: `components/composer/components/composer-convert-prompt/composer-convert-prompt.component.html`, `components/composer/components/composer-convert-prompt/composer-convert-prompt.component.scss`, `components/composer/components/composer-convert-prompt/composer-convert-prompt.component.ts`, `services/modal-focus.ts`
- Modify: `components/composer/components/composer-score/composer-score.component.ts`, `components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts`, `components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts`, `components/composer/components/composer-tool-popover/composer-tool-popover.component.ts`, `components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`, `components/composer/components/composer-track-strip/composer-track-strip.component.ts`, `components/composer/composer.component.html`, `components/composer/composer.component.spec.ts`, `components/composer/composer.component.ts`, `services/composer-edit-intent.spec.ts`, `services/composer-edit-intent.ts`, `services/composer-export.service.ts`, `services/composer-gp.service.spec.ts`, `services/composer-gp.service.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts -->
```ts

import { ComposerToolPopoverComponent, popoverPlacementOf } from './composer-tool-popover.component';
import { ComposerService } from '../../../../services/composer.service';
import { effectiveTimeSignature } from '../../../../models/composer.model';
import { KEY_SIGNATURE_CHOICES } from '../../../../services/composer-bar-choices';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts -->
```ts

import { ComposerToolPopoverComponent, popoverPlacementOf } from './composer-tool-popover.component';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from '../../../../services/composer.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { effectiveTimeSignature } from '../../../../models/composer.model';
import { KEY_SIGNATURE_CHOICES } from '../../../../services/composer-bar-choices';
```

<!-- apply: find client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts -->
```ts
    expect(composer.state.refusal).toMatch(/tuplet needs/i);
  });
});

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts -->
```ts
    expect(composer.state.refusal).toMatch(/tuplet needs/i);
  });

  it('asks the conversion prompt before a value is set on a file not yet converted, and closes for it', () => {
    const gp = TestBed.inject(ComposerGpService);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score: new alphaTab.model.Score() });
    const before = composer.doc;
    open('timeSignature');
    popover.numerator = 7;

    popover.applyTimeSignature();

    expect(composer.doc).toBe(before);
    expect(gp.request?.label).toBe('Setting the time signature');
    expect(closed).toBe(1);
  });
});

```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts

import { ComposerTrackStripComponent } from './composer-track-strip.component';
import { ComposerService } from '../../../../services/composer.service';
import { ProgressionService } from '../../../../services/progression.service';
import { TrackDoc } from '../../../../models/composer.model';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts

import { ComposerTrackStripComponent } from './composer-track-strip.component';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from '../../../../services/composer.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { ProgressionService } from '../../../../services/progression.service';
import { TrackDoc } from '../../../../models/composer.model';
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts
    expect(add.getAttribute('aria-label')).toMatch(/^Add progression track\b/);
  });
});

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts
    expect(add.getAttribute('aria-label')).toMatch(/^Add progression track\b/);
  });

  it('asks the conversion prompt before adding a track to a file not yet converted', () => {
    const gp = TestBed.inject(ComposerGpService);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score: new alphaTab.model.Score() });
    const tracks = composer.doc.tracks.length;

    component.addTrack();

    expect(composer.doc.tracks.length).toBe(tracks);
    expect(gp.request?.label).toBe('Add track');
  });
});

```

`client/src/app/components/composer/composer.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
 * The page while it is showing a `.gp` file as alphaTab read it (`ComposerGpService`).
 *
 * The palette, the keys and the popovers stay live - the first command that would change the document asks, which is
 * Phase 4 - and what changes here is what the page can honestly show: there is no document to undo, to set a BPM on,
 * or to rename.
 */
describe('ComposerComponent in the Original state', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let gp: ComposerGpService;

  beforeEach(async () => {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
 * The page while it is showing a `.gp` file as alphaTab read it (`ComposerGpService`).
 *
 * The palette, the keys and the popovers stay live, and the first command that would change the document asks - the
 * conversion prompt - and what changes about the rest is what the page can honestly show: there is no document to undo,
 * to set a BPM on, or to rename.
 */
describe('ComposerComponent in the Original state', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let gp: ComposerGpService;
  let composer: ComposerService;

  beforeEach(async () => {
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts

    gp = TestBed.inject(ComposerGpService);
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts

    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  it('gives the title and the BPM back once the file is gone', async () => {
    await openFile('Band', 132);
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  const prompt = (): HTMLElement => fixture.nativeElement.querySelector('app-composer-convert-prompt .prompt');
  const promptOpen = (): boolean => prompt().classList.contains('open');
  const promptButton = (label: string): HTMLButtonElement =>
    Array.from(prompt().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === label)!;

  function press(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  }

  it('asks before a palette press that would change the document, naming it, and changes nothing yet', async () => {
    await openFile('Band', 132);
    const before = composer.doc;

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-tool="hammerOn"]')!.click();
    fixture.detectChanges();

    expect(promptOpen()).toBeTrue();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Hammer-on / pull-off would convert this file.');
    expect(prompt().textContent).toContain('Converting cannot be undone.');
    expect(composer.doc).toBe(before);
    expect(fixture.nativeElement.querySelector('.palette').hasAttribute('inert')).toBeTrue();
  });

  it('asks before an editing key the same way, and not before a caret move', async () => {
    await openFile('Band', 132);

    press({ key: 'ArrowRight' });
    expect(promptOpen()).toBeFalse();
    expect(composer.state.cursor.beatIndex).toBe(1);

    press({ key: 'Delete' });
    expect(promptOpen()).toBeTrue();
  });

  it('changes nothing on Cancel, and says nothing: the prompt was the message', async () => {
    await openFile('Band', 132);
    const before = composer.state;
    press({ key: 'h' });

    promptButton('Cancel').click();
    fixture.detectChanges();

    expect(promptOpen()).toBeFalse();
    expect(composer.state).toBe(before);
    expect(composer.state.refusal).toBeNull();
    expect(gp.isOriginal).toBeTrue();
  });

  it('cancels on Escape', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    press({ key: 'Escape' });

    expect(promptOpen()).toBeFalse();
    expect(gp.request).toBeNull();
  });

  it('asks before a save: the library holds compositions, and the file is not one yet', async () => {
    await openFile('Band', 132);
    let saves = 0;
    TestBed.inject(ComposerSaveRequests).requested$.subscribe(() => saves++);

    press({ code: 'KeyS', key: 's', ctrlKey: true });

    expect(promptOpen()).toBeTrue();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Save would convert this file.');
    expect(saves).toBe(0);
  });

  it('says a file that converts whole would change nothing', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    expect(prompt().querySelector('.whole')?.textContent?.trim()).toBe('Nothing in this file would change.');
  });

  it('lists what this file would lose, and what its first save would, under their own headings', async () => {
    const score = new alphaTab.model.Score();
    score.copyright = '2026';
    const masterBar = new alphaTab.model.MasterBar();
    masterBar.isDoubleBar = true;
    score.addMasterBar(masterBar);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    press({ key: 'h' });

    const sections = Array.from(prompt().querySelectorAll<HTMLElement>('.loss'));
    expect(sections.map(section => section.querySelector('h3')?.textContent?.trim())).toEqual([
      'What this file would lose',
      'What the first save would lose'
    ]);
    expect(sections[0].textContent).toContain('Credits');
    expect(sections[1].textContent).toContain('Double bar lines');
  });

  it('saves the untouched original under its own name, and stays open to convert after', async () => {
    await openFile('Band', 132);
    const download = spyOn(TestBed.inject(ComposerExportService), 'downloadOriginal');
    press({ key: 'h' });

    promptButton('Save the original file first').click();
    fixture.detectChanges();

    expect(download).toHaveBeenCalledWith(gp.original!.bytes, 'Band.gp');
    expect(promptOpen()).toBeTrue();
  });

  it('offers Convert disabled, saying why, until converting is wired', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    expect(promptButton('Convert').disabled).toBeTrue();
    expect(prompt().querySelector('.convert-refusal')?.textContent?.trim()).toBe('Converting is not available yet.');
  });

  it("shows the file's own alphaTex, and asks before applying it", async () => {
    await openFile('Band', 132);
    const host = fixture.nativeElement as HTMLElement;
    const texButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.text-btn')).find(button => button.textContent?.trim() === 'alphaTex')!;
    texButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.texDraft).toBe(TestBed.inject(AlphaTexService).export(gp.original!.score));

    fixture.componentInstance.applyTex();
    fixture.detectChanges();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Applying the alphaTex draft would convert this file.');
  });

  it('gives the title and the BPM back once the file is gone', async () => {
    await openFile('Band', 132);
```

`client/src/app/services/composer-edit-intent.spec.ts`:

<!-- apply: find client/src/app/services/composer-edit-intent.spec.ts -->
```ts
  });

  it('asks for an applied alphaTex draft, which is not a tool', () => {
    expect(changesDocument(ASKING_PAGE_COMMANDS.texApply)).toBe(true);
  });

```

becomes

<!-- apply: replace client/src/app/services/composer-edit-intent.spec.ts -->
```ts
  });

  it('asks for an applied alphaTex draft and a Pen write, which are not tools', () => {
    expect(changesDocument(ASKING_PAGE_COMMANDS.texApply)).toBe(true);
    expect(changesDocument(ASKING_PAGE_COMMANDS.penWrite)).toBe(true);
  });

```

`client/src/app/services/composer-gp.service.spec.ts`:

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService, GpOriginal } from './composer-gp.service';

/**
 * The Original state: the `.gp` file the page is showing as alphaTab read it.
 *
 * Non-null means the page is in Original; null means Composition. Nothing else in the composer keeps this, so
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService, GpFile, GpOriginal } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { ASKING_PAGE_COMMANDS } from './composer-edit-intent';

/**
 * The Original state: the `.gp` file the page is showing as alphaTab read it, and the command waiting on the
 * conversion prompt.
 *
 * Non-null means the page is in Original; null means Composition. Nothing else in the composer keeps this, so
```

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts
describe('ComposerGpService', () => {
  let service: ComposerGpService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerGpService);
  });

  function original(entryId: string): GpOriginal {
    const score = new alphaTab.model.Score();
    score.title = entryId;
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts
describe('ComposerGpService', () => {
  let service: ComposerGpService;
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
  });

  /** A one-bar score titled `entryId`, as its file. */
  function file(entryId: string): GpFile {
    const score = new alphaTab.model.Score();
    score.title = entryId;
```

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts
    service.getState().subscribe(value => seen.push(value));

    service.open(original('a'));

    expect(service.isOriginal).toBe(true);
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts
    service.getState().subscribe(value => seen.push(value));

    service.open(file('a'));

    expect(service.isOriginal).toBe(true);
```

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts
  });

  it('opening another file replaces the first, rather than stacking', () => {
    service.open(original('a'));
    service.open(original('b'));

    expect(service.original?.entryId).toBe('b');
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts
  });

  it('measures what converting the file would change as it opens', () => {
    const credited = file('a');
    credited.score.copyright = '2026';

    service.open(credited);

    expect(service.original?.loss.map(item => item.id)).toEqual(['credits']);
  });

  it('opening another file replaces the first, rather than stacking', () => {
    service.open(file('a'));
    service.open(file('b'));

    expect(service.original?.entryId).toBe('b');
```

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts

  it('clearing goes back to Composition and drops the bytes', () => {
    service.open(original('a'));

    service.clear();
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts

  it('clearing goes back to Composition and drops the bytes', () => {
    service.open(file('a'));

    service.clear();
```

<!-- apply: find client/src/app/services/composer-gp.service.spec.ts -->
```ts
    expect(service.original).toBeNull();
  });
});

```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.spec.ts -->
```ts
    expect(service.original).toBeNull();
  });

  it('goes back to Composition when another composition opens', () => {
    service.open(file('a'));

    composer.reset();

    expect(service.isOriginal).toBe(false);
  });

  it('stays in Original through what does not open a composition: a caret move', () => {
    service.open(file('a'));

    composer.setCursor({ beatIndex: 1 });

    expect(service.isOriginal).toBe(true);
  });

  describe('requestEdit', () => {
    it('runs a command at once in Composition', () => {
      let ran = 0;

      service.requestEdit('hammerOn', 'Hammer-on', () => ran++);

      expect(ran).toBe(1);
      expect(service.request).toBeNull();
    });

    it('runs a command that does not change the document at once in Original', () => {
      service.open(file('a'));
      let ran = 0;

      service.requestEdit('nextBeat', 'Next beat', () => ran++);

      expect(ran).toBe(1);
      expect(service.request).toBeNull();
    });

    it('holds a writing command in Original, for the prompt', () => {
      service.open(file('a'));
      let ran = 0;

      service.requestEdit(ASKING_PAGE_COMMANDS.texApply, 'Applying the alphaTex draft', () => ran++);

      expect(ran).toBe(0);
      expect(service.request?.label).toBe('Applying the alphaTex draft');
    });

    it('drops the command on Cancel, and on leaving Original', () => {
      service.open(file('a'));
      service.requestEdit('hammerOn', 'Hammer-on', () => undefined);

      service.cancelEdit();
      expect(service.request).toBeNull();

      service.requestEdit('hammerOn', 'Hammer-on', () => undefined);
      service.clear();
      expect(service.request).toBeNull();
    });
  });
});

```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 20 errors, the first:

```text
src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts(552,15): error TS2339: Property 'request' does not exist on type 'ComposerGpService'.
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.html`, new:

<!-- apply: create client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.html -->
```html
<!-- Behind the prompt and over the whole window, while it is open: a click beside it cancels, as Escape does. -->
<div class="prompt-backdrop" [class.open]="open" aria-hidden="true" (click)="cancelled.emit()"></div>

<section
  #dialog
  class="prompt"
  [class.open]="open"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="composer-convert-prompt-heading"
  aria-describedby="composer-convert-prompt-undo"
  [attr.aria-hidden]="!open"
  (keydown)="trapTab($event)"
>
  <h2 #heading id="composer-convert-prompt-heading" tabindex="-1">{{ request?.label }} would convert this file.</h2>

  <p id="composer-convert-prompt-undo" class="undo-note">
    Converting cannot be undone. The original file is replaced by a composition, and undo starts from there.
  </p>

  <ng-container *ngIf="conversionLoss.length > 0 || saveLoss.length > 0; else whole">
    <section class="loss" *ngIf="conversionLoss.length > 0">
      <h3>What this file would lose</h3>
      <ul>
        <li *ngFor="let item of conversionLoss; trackBy: trackById"><span class="label">{{ item.label }}:</span> {{ item.detail }}</li>
      </ul>
    </section>
    <section class="loss" *ngIf="saveLoss.length > 0">
      <h3>What the first save would lose</h3>
      <ul>
        <li *ngFor="let item of saveLoss; trackBy: trackById"><span class="label">{{ item.label }}:</span> {{ item.detail }}</li>
      </ul>
    </section>
  </ng-container>
  <ng-template #whole><p class="whole">Nothing in this file would change.</p></ng-template>

  <p class="original-note">
    Save the original file first to keep <strong>{{ original?.fileName }}</strong> as it is: once it is converted, the
    library holds the composition in its place.
  </p>
  <p class="convert-refusal" *ngIf="convertRefusal">{{ convertRefusal }}</p>

  <div class="actions">
    <button type="button" class="text-btn" (click)="saveOriginal.emit()">Save the original file first</button>
    <button type="button" class="text-btn primary" [disabled]="convertRefusal !== null" [attr.title]="convertRefusal" (click)="convert.emit()">
      Convert
    </button>
    <button type="button" class="text-btn" (click)="cancelled.emit()">Cancel</button>
  </div>
</section>
```

`client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.scss`, new:

<!-- apply: create client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.scss -->
```scss
// The conversion prompt: a modal over the page, hidden with CSS while closed, over a backdrop that covers the window.
// Above the shortcut sheet's layers, since a command can ask while nothing else is open and the two are never open together.

.prompt-backdrop {
  position: fixed;
  inset: 0;
  z-index: 959;
  display: none;
  background-color: rgba(0, 0, 0, 0.45);

  &.open {
    display: block;
  }
}

.prompt {
  position: fixed;
  top: 12vh;
  left: 50%;
  z-index: 960;
  display: none;
  flex-direction: column;
  gap: 0.6rem;
  width: min(34rem, calc(100vw - 2rem));
  max-height: 76vh;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  transform: translateX(-50%);
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  &.open {
    display: flex;
  }

  h2 {
    margin: 0;
    font-size: 1rem;

    // Focused by the prompt on opening, never by Tab: no ring for a focus the user did not move.
    &:focus {
      outline: none;
    }
  }

  p {
    margin: 0;
    font-size: 0.85rem;
  }
}

.undo-note {
  font-weight: 600;
}

.loss {
  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--composer-text-secondary, #bdc3c7);
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.82rem;
  }

  .label {
    font-weight: 600;
  }
}

.original-note,
.convert-refusal {
  color: var(--composer-text-secondary, #bdc3c7);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.4rem;
}

.text-btn {
  padding: 0.35rem 0.75rem;
  background: none;
  border: 1px solid var(--composer-border, #465666);
  border-radius: 4px;
  color: var(--composer-text, #ecf0f1);
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: var(--composer-nav-hover, #34495e);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.primary {
    border-color: var(--composer-accent, #3498db);
  }

  &:focus-visible {
    outline: 2px solid var(--composer-accent, #3498db);
    outline-offset: 1px;
  }
}
```

`client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.ts`, new:

<!-- apply: create client/src/app/components/composer/components/composer-convert-prompt/composer-convert-prompt.component.ts -->
```ts
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { EditRequest, GpOriginal } from '../../../../services/composer-gp.service';
import { LossItem } from '../../../../services/gp-conversion-loss';
import { ModalFocus } from '../../../../services/modal-focus';

/**
 * The question the first edit of a `.gp` file asks: convert it into a composition, or not (the GP-composer design,
 * decisions 4 to 6, and Part 4's "What the prompt says").
 *
 * It says, in this order: what the edit was, so the question is about something the user just did; that converting
 * cannot be undone; what this file would lose, from `conversionLossOf` - and, under its own heading, what the first save
 * would - or that nothing would change; then *Save the original file first*, *Convert* and *Cancel*. Saving the original
 * is not a fourth outcome: it downloads the untouched `.gp` and leaves the prompt open, so the user converts afterwards
 * without being asked twice.
 *
 * A modal, as the shortcut sheet is (`ModalFocus`): a backdrop over the window that cancels on a click, the page behind
 * made `inert` by the page, the focus moved in and Tab held inside. Escape reaches the page's key handler, which cancels.
 * Open while there is a command waiting on it (`request`) and a file to convert.
 */
@Component({
  selector: 'app-composer-convert-prompt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-convert-prompt.component.html',
  styleUrls: ['./composer-convert-prompt.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerConvertPromptComponent implements OnChanges, AfterViewChecked {
  @Input() request: EditRequest | null = null;
  @Input() original: GpOriginal | null = null;
  /** Why Convert cannot run, or null when it can. Convert is disabled and the reason shown beside it. */
  @Input() convertRefusal: string | null = null;
  /** Where the focus goes on closing when what had it has left the page: the score, asked as the prompt closes. */
  @Input() fallbackFocus: () => HTMLElement | null = () => null;
  @Output() readonly saveOriginal = new EventEmitter<void>();
  @Output() readonly convert = new EventEmitter<void>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild('dialog', { static: true }) private dialog?: ElementRef<HTMLElement>;
  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  private readonly focus = new ModalFocus();

  get open(): boolean {
    return this.request !== null && this.original !== null;
  }

  /** What converting loses now. */
  get conversionLoss(): LossItem[] {
    return this.original?.loss.filter(item => item.group === 'conversion') ?? [];
  }

  /** What the first save after converting loses. */
  get saveLoss(): LossItem[] {
    return this.original?.loss.filter(item => item.group === 'first save') ?? [];
  }

  ngOnChanges(changes: SimpleChanges): void {
    const request = changes['request'];
    const original = changes['original'];
    if (!request && !original) return;
    const wasOpen = (request ? request.previousValue : this.request) != null && (original ? original.previousValue : this.original) != null;
    this.focus.openChanged(this.open, wasOpen);
  }

  ngAfterViewChecked(): void {
    this.focus.afterViewChecked(this.heading?.nativeElement, this.dialog?.nativeElement, this.fallbackFocus);
  }

  trapTab(event: KeyboardEvent): void {
    this.focus.trapTab(event, this.open, this.dialog?.nativeElement);
  }

  trackById(_index: number, item: LossItem): string {
    return item.id;
  }
}
```

`client/src/app/components/composer/components/composer-score/composer-score.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { ComposerGpService, GpOriginal } from '../../../../services/composer-gp.service';
import { ComposerService } from '../../../../services/composer.service';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
import { ComposerGpService, GpOriginal } from '../../../../services/composer-gp.service';
import { ComposerService } from '../../../../services/composer.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  }

  /** Writes the note the pointer landed on, for standard notation staves in Pen. */
  private placeClickedPitch(lines: StaffLines): void {
    if (!this.pointer || !this.state) return;

    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;

    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, this.pointer.y);
    if (diatonic === null) return;

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  }

  /**
   * Writes the note the pointer landed on, for standard notation staves in Pen - asking the conversion prompt first in
   * Original. The pointer's height is read now, for a write that may run only after the prompt's Convert, by which time
   * the pointer has moved to press it.
   */
  private placeClickedPitch(lines: StaffLines): void {
    if (!this.pointer) return;
    const y = this.pointer.y;
    this.gp.requestEdit(ASKING_PAGE_COMMANDS.penWrite, 'Writing a note with Pen', () => this.writePitchAt(lines, y));
  }

  /** Writes the pitch at height `y` on `lines`, at the caret. */
  private writePitchAt(lines: StaffLines, y: number): void {
    if (!this.state) return;

    const bar = this.composer.barAt(this.state.doc, this.state.cursor);
    if (!bar) return;

    const diatonic = this.hitTest.diatonicIn(lines, bar.clef, y);
    if (diatonic === null) return;

```

`client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
import { KEY_PLATFORM, KeyPlatform } from '../../../../services/composer-key-platform';
import { COMPOSER_TOOLS, ComposerTool, ToolGroup } from '../../../../services/composer-tools';

/** One line of the sheet. */
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
import { KEY_PLATFORM, KeyPlatform } from '../../../../services/composer-key-platform';
import { COMPOSER_TOOLS, ComposerTool, ToolGroup } from '../../../../services/composer-tools';
import { ModalFocus } from '../../../../services/modal-focus';

/** One line of the sheet. */
```

<!-- apply: find client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
}

/** What can take the focus by Tab inside the sheet. */
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every keyboard shortcut, opened with `?`.
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
}

/**
 * Every keyboard shortcut, opened with `?`.
```

<!-- apply: find client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
 * keyboard has (`KEY_PLATFORM`). Hidden with CSS rather than removed while closed, so opening it builds nothing.
 *
 * A modal dialog: opening it moves the focus to its heading and remembers what had it; Tab goes round inside it; and
 * closing it, by its ×, by Escape or by a click on the backdrop behind it, gives the focus back - or, when that element
 * has left the page, to `fallbackFocus`, the score. The backdrop covers the whole window, so a click beside the sheet
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
 * keyboard has (`KEY_PLATFORM`). Hidden with CSS rather than removed while closed, so opening it builds nothing.
 *
 * A modal dialog, whose focus is `ModalFocus`'s: opening it moves the focus to its heading; Tab goes round inside it; and
 * closing it, by its ×, by Escape or by a click on the backdrop behind it, gives the focus back - or, when that element
 * has left the page, to `fallbackFocus`, the score. The backdrop covers the whole window, so a click beside the sheet
```

<!-- apply: find client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  /** What had the focus when the sheet opened. */
  private returnFocusTo: HTMLElement | null = null;
  /**
   * Set on opening, and acted on once the view has shown the sheet: `open` changes before the view does, and an
   * element still under `display: none` cannot take the focus.
   */
  private focusOnRender = false;
  /**
   * Set on closing, and acted on once the view is checked: the page makes itself `inert` while the sheet is open, and
   * an inert element cannot take the focus. By `ngAfterViewChecked` every binding in the page's template has been
   * applied, whatever order the page wrote them in, so the page is no longer inert. What had the focus is still read
   * on opening, in `ngOnChanges`, before the bindings after the sheet make the page inert.
   */
  private focusBackOnRender = false;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['open'];
    if (!change) return;
    const wasOpen = !!change.previousValue;
    if (this.open && !wasOpen) {
      const active = document.activeElement;
      this.returnFocusTo = active instanceof HTMLElement ? active : null;
      this.focusOnRender = true;
      this.focusBackOnRender = false;
    } else if (!this.open && wasOpen) {
      this.focusOnRender = false;
      this.focusBackOnRender = true;
    }
  }

  ngAfterViewChecked(): void {
    if (this.focusBackOnRender) {
      this.focusBackOnRender = false;
      this.giveFocusBack();
      return;
    }
    if (!this.focusOnRender) return;
    this.focusOnRender = false;
    this.heading?.nativeElement.focus();
  }

  /** Keeps Tab inside the open sheet, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.open || !this.sheet) return;
    const tabbable = Array.from(this.sheet.nativeElement.querySelectorAll<HTMLElement>(TABBABLE));
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const onAControl = tabbable.some(element => element === active);
    const leaving = event.shiftKey ? active === first || !onAControl : active === last || !onAControl;
    if (!leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  private readonly focus = new ModalFocus();

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['open'];
    if (change) this.focus.openChanged(this.open, !!change.previousValue);
  }

  ngAfterViewChecked(): void {
    this.focus.afterViewChecked(this.heading?.nativeElement, this.sheet?.nativeElement, this.fallbackFocus);
  }

  /** Keeps Tab inside the open sheet, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent): void {
    this.focus.trapTab(event, this.open, this.sheet?.nativeElement);
  }

```

<!-- apply: find client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
    return section.group;
  }

  /**
   * Gives the focus back to what had it before the sheet opened, or to `fallbackFocus` when that has left the page or
   * was the page itself. Only while the focus is still the sheet's: a click outside that closed it has already put
   * the focus where the user wanted it.
   */
  private giveFocusBack(): void {
    const saved = this.returnFocusTo;
    this.returnFocusTo = null;
    this.focusOnRender = false;
    const active = document.activeElement;
    const stillOurs = active === null || active === document.body || !!this.sheet?.nativeElement.contains(active);
    if (!stillOurs) return;
    const target = saved && saved.isConnected && saved !== document.body ? saved : this.fallbackFocus();
    target?.focus();
  }
}

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-shortcut-sheet/composer-shortcut-sheet.component.ts -->
```ts
    return section.group;
  }
}

```

`client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
} from '../../../../services/composer-bar-choices';
import { ComposerService } from '../../../../services/composer.service';
import { MIXED, popoverValuesOf } from '../../../../services/composer-popover-values';
import { TUPLET_CHOICES } from '../../../../services/composer-tool-defaults';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
} from '../../../../services/composer-bar-choices';
import { ComposerService } from '../../../../services/composer.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { MIXED, popoverValuesOf } from '../../../../services/composer-popover-values';
import { TUPLET_CHOICES } from '../../../../services/composer-tool-defaults';
```

<!-- apply: find client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
  constructor(
    private readonly composer: ComposerService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
  constructor(
    private readonly composer: ComposerService,
    private readonly gp: ComposerGpService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

<!-- apply: find client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
   * Runs a command, then closes - or, when the service refused it, stays open and says why inline. The refusal is the
   * service's own, published in the status line as well, and read by whether the command published a new message.
   */
  private commit(command: () => void): void {
    const before = this.composer.state.messageId;
    this.applying = true;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.ts -->
```ts
   * Runs a command, then closes - or, when the service refused it, stays open and says why inline. The refusal is the
   * service's own, published in the status line as well, and read by whether the command published a new message.
   *
   * In Original the value asks the conversion prompt first (`ComposerGpService.requestEdit`), and the popover closes for
   * the prompt: the value is set once the file is converted, and a refusal then is said in the status line.
   */
  private commit(command: () => void): void {
    this.gp.requestEdit(ASKING_PAGE_COMMANDS.popoverValue, `Setting the ${this.title.toLowerCase()}`, () => this.commitNow(command));
    if (this.gp.request) this.closed.emit();
  }

  private commitNow(command: () => void): void {
    const before = this.composer.state.messageId;
    this.applying = true;
```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
import { ProgressionState } from '../../../../models/progression.model';
import { ComposerService } from '../../../../services/composer.service';
import { LAST_TRACK_REFUSAL } from '../../../../services/composer-text';
import { ProgressionService } from '../../../../services/progression.service';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
import { ProgressionState } from '../../../../models/progression.model';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { LAST_TRACK_REFUSAL } from '../../../../services/composer-text';
import { ProgressionService } from '../../../../services/progression.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    private readonly composer: ComposerService,
    private readonly progression: ProgressionService,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    private readonly composer: ComposerService,
    private readonly progression: ProgressionService,
    private readonly gp: ComposerGpService,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
  }

  /** Adds a track of the chosen instrument. The keyboard's Ctrl+Shift+Insert comes here too. */
  addTrack(): void {
    const instrument = this.newTrackInstrument;
    this.composer.addTrack(instrument.name, instrument.program, instrument.fretted);
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
  }

  /**
   * Adds a track of the chosen instrument - asking the conversion prompt first in Original, as the `addTrack` tool does.
   * The keyboard's Ctrl+Shift+Insert comes here too, already past that question, and asking twice is asking once: the
   * gate runs a command straight through outside Original.
   */
  addTrack(): void {
    const instrument = this.newTrackInstrument;
    this.gp.requestEdit('addTrack', 'Add track', () => this.composer.addTrack(instrument.name, instrument.program, instrument.fretted));
  }

```

`client/src/app/components/composer/composer.component.html`:

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
  -->
  <app-composer-shortcut-sheet [open]="sheetOpen" [fallbackFocus]="scoreHost" (closed)="closeShortcutSheet()"></app-composer-shortcut-sheet>

  <header #topBar class="top-bar" [attr.inert]="sheetOpen ? '' : null">
    <div class="score-info">
      <input
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
  -->
  <app-composer-shortcut-sheet [open]="sheetOpen" [fallbackFocus]="scoreHost" (closed)="closeShortcutSheet()"></app-composer-shortcut-sheet>
  <app-composer-convert-prompt
    [request]="editRequest"
    [original]="original"
    [convertRefusal]="convertRefusal"
    [fallbackFocus]="scoreHost"
    (saveOriginal)="saveOriginal()"
    (convert)="convert()"
    (cancelled)="cancelConvert()"
  ></app-composer-convert-prompt>

  <header #topBar class="top-bar" [attr.inert]="modalOpen ? '' : null">
    <div class="score-info">
      <input
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
        alphaTex
      </button>
      <app-composer-library-panel [modalOpen]="sheetOpen" (menuOpened)="closePopover()"></app-composer-library-panel>
      <button
        class="text-btn shortcuts-toggle"
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
        alphaTex
      </button>
      <app-composer-library-panel [modalOpen]="modalOpen" (menuOpened)="closePopover()"></app-composer-library-panel>
      <button
        class="text-btn shortcuts-toggle"
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
  <app-composer-palette
    class="palette"
    [attr.inert]="sheetOpen ? '' : null"
    [state]="s"
    [popover]="popover"
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
  <app-composer-palette
    class="palette"
    [attr.inert]="modalOpen ? '' : null"
    [state]="s"
    [popover]="popover"
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
  ></app-composer-palette>

  <div class="score-column" [attr.inert]="sheetOpen ? '' : null">
    <!-- Focusable by script only, for the shortcut sheet to give the focus back to. -->
    <app-composer-score #score tabindex="-1"></app-composer-score>
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
  ></app-composer-palette>

  <div class="score-column" [attr.inert]="modalOpen ? '' : null">
    <!-- Focusable by script only, for the shortcut sheet to give the focus back to. -->
    <app-composer-score #score tabindex="-1"></app-composer-score>
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
    #statusLine
    class="status"
    [attr.inert]="sheetOpen ? '' : null"
    [refusal]="s.refusal"
    [notice]="s.notice"
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
    #statusLine
    class="status"
    [attr.inert]="modalOpen ? '' : null"
    [refusal]="s.refusal"
    [notice]="s.notice"
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
    #stripSeparator
    class="strip-resize"
    [attr.inert]="sheetOpen ? '' : null"
    role="separator"
    tabindex="0"
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
    #stripSeparator
    class="strip-resize"
    [attr.inert]="modalOpen ? '' : null"
    role="separator"
    tabindex="0"
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
  ></div>

  <app-composer-track-strip class="strip" [attr.inert]="sheetOpen ? '' : null" [style.height.px]="stripHeight"></app-composer-track-strip>
</div>

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
  ></div>

  <app-composer-track-strip class="strip" [attr.inert]="modalOpen ? '' : null" [style.height.px]="stripHeight"></app-composer-track-strip>
</div>

```

`client/src/app/components/composer/composer.component.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ComposerConvertPromptComponent } from './components/composer-convert-prompt/composer-convert-prompt.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerGpService, GpOriginal } from '../../services/composer-gp.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ASKING_PAGE_COMMANDS } from '../../services/composer-edit-intent';
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
    CommonModule,
    FormsModule,
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
    CommonModule,
    FormsModule,
    ComposerConvertPromptComponent,
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
   */
  original: GpOriginal | null = null;

  texDraft = '';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
   */
  original: GpOriginal | null = null;
  /** The command waiting on the conversion prompt, which is open while there is one (`ComposerGpService.requestEdit`). */
  editRequest: EditRequest | null = null;
  /** Why the prompt's Convert cannot run yet: the conversion itself is the milestone's next step. */
  readonly convertRefusal: string | null = 'Converting is not available yet.';

  texDraft = '';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** The title shown: the composition's, or the file's own - its score title, or its file name where it has none. */
  get titleText(): string {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /**
   * Whether a modal is open over the page - the shortcut sheet, or the conversion prompt - so the rest of the page is
   * `inert` and the keys reach only what a modal takes (`ComposerKeyHandler`).
   */
  get modalOpen(): boolean {
    return this.sheetOpen || this.editRequest !== null;
  }

  /** The title shown: the composition's, or the file's own - its score title, or its file name where it has none. */
  get titleText(): string {
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  /** What every tool runs against. */
  readonly host: ComposerToolHost;

  private readonly keyHandler: ComposerKeyHandler;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  /** What every tool runs against. */
  readonly host: ComposerToolHost;
  /**
   * `COMPOSER_TOOLS`, each asking `ComposerGpService.requestEdit` before it runs, so in Original the first that would change
   * the document opens the conversion prompt instead - from the palette and the keys alike.
   */
  private readonly gatedTools: readonly ComposerTool[];

  private readonly keyHandler: ComposerKeyHandler;
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly texService: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef
  ) {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly texService: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly exporter: ComposerExportService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
      // A popover's own button, or its key, closes it when it is the one open, as a disclosure button does.
      openPopover: kind => this.present(() => (this.popover = this.popover === kind ? null : kind)),
      toggleShortcutSheet: () => this.present(() => this.toggleShortcutSheet()),
      escape: () =>
        this.present(() => {
          // An open popover takes Escape alone - as the popover itself does when it has the focus - and so does the
          // open shortcut sheet, a modal over the score: the press that closes either does not also drop the range.
          if (this.popover) {
            this.popover = null;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
      // A popover's own button, or its key, closes it when it is the one open, as a disclosure button does.
      openPopover: kind => this.present(() => (this.popover = this.popover === kind ? null : kind)),
      // Not over the conversion prompt: the sheet would open behind a question the page is waiting on.
      toggleShortcutSheet: () => this.present(() => this.editRequest === null && this.toggleShortcutSheet()),
      escape: () =>
        this.present(() => {
          // The conversion prompt takes Escape as Cancel. An open popover takes Escape alone - as the popover itself does
          // when it has the focus - and so does the open shortcut sheet, a modal over the score: the press that closes
          // either does not also drop the range.
          if (this.editRequest) {
            this.gp.cancelEdit();
            return;
          }
          if (this.popover) {
            this.popover = null;
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
      typeFretDigit: digit => this.fretEntry.type(digit)
    };
    // The score's element, so a text selection inside the score does not stop Ctrl+C and Ctrl+X copying beats.
    // And the sheet's state: while it is open, only its own key and Escape reach the tools, so no key edits the score
    // hidden behind it (`TOOLS_OVER_A_MODAL`), and a Ctrl, Alt or Cmd press is claimed and dropped, so the browser's own
    // shortcuts do not act behind it either.
    this.keyHandler = new ComposerKeyHandler(
      this.host,
      COMPOSER_TOOLS,
      () => this.scoreElement?.nativeElement ?? null,
      () => this.sheetOpen
    );
  }
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
      typeFretDigit: digit => this.fretEntry.type(digit)
    };
    this.gatedTools = COMPOSER_TOOLS.map(tool => ({
      ...tool,
      run: (host, press) => this.gp.requestEdit(tool.id, tool.label, () => tool.run(host, press))
    }));
    // The score's element, so a text selection inside the score does not stop Ctrl+C and Ctrl+X copying beats.
    // And whether a modal is open: while one is, only the sheet's key and Escape reach the tools, so no key edits the
    // score hidden behind it (`TOOLS_OVER_A_MODAL`), and a Ctrl, Alt or Cmd press is claimed and dropped, so the
    // browser's own shortcuts do not act behind it either.
    this.keyHandler = new ComposerKeyHandler(
      this.host,
      this.gatedTools,
      () => this.scoreElement?.nativeElement ?? null,
      () => this.modalOpen
    );
  }
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
      });

    // Save in the Library menu asks the same question Ctrl+S does (`requestSave`).
    this.removeSaveGuard = this.saveRequests.guard(() => this.refusesSaveForDraft());
    // An edited draft is unsaved work that a load, New or an opened transcription would throw away.
    this.releaseUnsavedDraft = this.composer.holdUnsavedWork(() => this.showTexPanel && this.texDraftEdited);
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
      });

    this.gp
      .getRequest()
      .pipe(takeUntil(this.destroy$))
      .subscribe(request => {
        this.editRequest = request;
        // A popover left open would sit in the top layer above the prompt, inside a palette gone inert.
        if (request) this.popover = null;
        this.cdr.markForCheck();
      });

    // Save in the Library menu asks the same questions Ctrl+S does (`requestSave`): the draft's, and in Original the
    // conversion prompt's, since the library holds compositions and a file not yet converted has none to write.
    this.removeSaveGuard = this.saveRequests.guard(() => this.refusesSaveForDraft() || this.asksBeforeSaving());
    // An edited draft is unsaved work that a load, New or an opened transcription would throw away.
    this.releaseUnsavedDraft = this.composer.holdUnsavedWork(() => this.showTexPanel && this.texDraftEdited);
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** A palette press runs the same tool, against the same host, as its key. */
  runTool(tool: ComposerTool): void {
    tool.run(this.host, null);
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** A palette press runs the same tool, against the same host, as its key - asking first in Original, as the key does. */
  runTool(tool: ComposerTool): void {
    this.gp.requestEdit(tool.id, tool.label, () => tool.run(this.host, null));
  }

  /** The prompt's Cancel, its backdrop, and Escape: the command that asked is dropped, and the page says nothing more. */
  cancelConvert(): void {
    this.gp.cancelEdit();
  }

  /** "Save the original file first": the untouched bytes, under the file's own name. The prompt stays open. */
  saveOriginal(): void {
    const original = this.original;
    if (original) this.exporter.downloadOriginal(original.bytes, original.fileName);
  }

  /** The prompt's Convert. Not wired yet: the button is disabled and says so (`convertRefusal`). */
  convert(): void {
    return;
  }

```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** Canonical alphaTex for the current document, generated on demand. */
  private currentTex(): string {
    if (!this.state) return '';
    try {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /**
   * Canonical alphaTex for the current document, generated on demand - or, in Original, alphaTab's own alphaTex for the
   * file, which has no document behind it (design Part 1). Applying a draft of it asks, as any edit does.
   */
  private currentTex(): string {
    if (this.original) return this.texService.export(this.original.score);
    if (!this.state) return '';
    try {
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts

  /**
   * Applies the draft as an edit of this composition, on the undo stack (`replaceDocument`). A draft out of date would
   * replace the changes made since it was written, so that is asked - once the draft parses, since a draft that cannot
   * be applied has nothing to ask about.
   */
  applyTex(): void {
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts

  /**
   * In Original, refuses the save and asks the conversion prompt instead, with the save as the command waiting on it:
   * once converted, the save runs again and finds a composition to write.
   */
  private asksBeforeSaving(): boolean {
    if (!this.viewingOriginal) return false;
    this.gp.requestEdit('save', 'Save', () => this.saveRequests.request());
    return true;
  }

  /**
   * Apply: in Original it asks the conversion prompt first, with the draft as typed held for after it. Converting opens a
   * new composition, which seeds the panel afresh (`discardTexDraft`), so the draft is put back before it is applied.
   */
  applyTex(): void {
    const draft = this.texDraft;
    this.gp.requestEdit(ASKING_PAGE_COMMANDS.texApply, 'Applying the alphaTex draft', () => {
      this.texDraft = draft;
      this.applyTexDraft();
    });
  }

  /**
   * Applies the draft as an edit of this composition, on the undo stack (`replaceDocument`). A draft out of date would
   * replace the changes made since it was written, so that is asked - once the draft parses, since a draft that cannot
   * be applied has nothing to ask about.
   */
  private applyTexDraft(): void {
    const result = this.texService.parse(this.texDraft);
    this.texDiagnostics = result.diagnostics;
```

`client/src/app/services/composer-edit-intent.ts`:

<!-- apply: find client/src/app/services/composer-edit-intent.ts -->
```ts
/**
 * The page's own commands, which are not in `COMPOSER_TOOLS` because they are not palette tools or key bindings:
 * applying the alphaTex draft, and choosing a value in a popover, whose button only opens it.
 */
export const ASKING_PAGE_COMMANDS = {
  texApply: 'page:texApply',
  popoverValue: 'page:popoverValue'
} as const;

```

becomes

<!-- apply: replace client/src/app/services/composer-edit-intent.ts -->
```ts
/**
 * The page's own commands, which are not in `COMPOSER_TOOLS` because they are not palette tools or key bindings:
 * applying the alphaTex draft, choosing a value in a popover, whose button only opens it, and Pen's click on standard
 * notation, which writes the pitch clicked.
 */
export const ASKING_PAGE_COMMANDS = {
  texApply: 'page:texApply',
  popoverValue: 'page:popoverValue',
  penWrite: 'page:penWrite'
} as const;

```

`client/src/app/services/composer-export.service.ts`:

<!-- apply: find client/src/app/services/composer-export.service.ts -->
```ts
  }

  /** Turns a score title into a safe file name. */
  toFileName(title: string): string {
```

becomes

<!-- apply: replace client/src/app/services/composer-export.service.ts -->
```ts
  }

  /**
   * Hands the bytes of a `.gp` file back as they came, under `fileName`: the conversion prompt's "Save the original file
   * first", the only copy of them there will be once Convert has dropped them.
   */
  downloadOriginal(bytes: ArrayBuffer, fileName: string): void {
    this.downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), fileName);
  }

  /** Turns a score title into a safe file name. */
  toFileName(title: string): string {
```

`client/src/app/services/composer-gp.service.ts`:

<!-- apply: find client/src/app/services/composer-gp.service.ts -->
```ts
import type * as alphaTab from '@coderline/alphatab';

/**
 * The `.gp` file the composer is showing as alphaTab read it - every track, as the file was written, with no
 * `ScoreDoc` behind it.
 *
 * `bytes` is the only copy there will be: Convert drops them, and "Save the original file first" in the conversion
 * prompt is what writes them out.
 */
export interface GpOriginal {
  /** The `gp-library` entry the bytes came from. Convert replaces exactly this entry with the composition. */
  entryId: string;
  fileName: string;
  bytes: ArrayBuffer;
  score: alphaTab.model.Score;
}

/**
 * Which of the composer's two states the page is in.
 *
 * Non-null is **Original**: the bytes alphaTab read, every track rendered, no document. Null is **Composition**:
 * today's composer. A `.gp` opens in Original and every other way in starts in Composition.
 *
 * Its own root service rather than a field on `ComposerService`, which is 861 lines against `CLAUDE.md`'s 1000-line
 * cap and whose history M2 already moved out to make room. `ComposerState` gains nothing either: the empty document
 * it already holds is simply not drawn while an original is current.
 */
@Injectable({ providedIn: 'root' })
export class ComposerGpService {
  private readonly subject = new BehaviorSubject<GpOriginal | null>(null);

  getState(): Observable<GpOriginal | null> {
    return this.subject.asObservable();
  }

```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.ts -->
```ts
import type * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { changesDocument } from './composer-edit-intent';
import { LossItem, conversionLossOf } from './gp-conversion-loss';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/** A `.gp` file as alphaTab read it: what opening it into the Original state takes. */
export interface GpFile {
  /** The `gp-library` entry the bytes came from. Convert replaces exactly this entry with the composition. */
  entryId: string;
  fileName: string;
  /**
   * The only copy there will be: Convert drops them, and "Save the original file first" in the conversion prompt is
   * what writes them out.
   */
  bytes: ArrayBuffer;
  score: alphaTab.model.Score;
}

/** The file the composer is showing, with what converting it would change, measured once as it opened. */
export interface GpOriginal extends GpFile {
  /** `conversionLossOf` the file: what the conversion prompt lists. */
  loss: LossItem[];
}

/**
 * A command held back until the file is converted: the first command in Original that would change the document asks
 * first (design decision 4), and runs only once the prompt's Convert has made a document for it to change.
 */
export interface EditRequest {
  /** The command's id: a tool's, or one of `ASKING_PAGE_COMMANDS`. */
  id: string;
  /** What the prompt calls it: a tool's label, or a phrase for a page command - "Applying the alphaTex draft". */
  label: string;
  run: () => void;
}

/**
 * Which of the composer's two states the page is in, and the command waiting on the conversion prompt.
 *
 * Non-null `original` is **Original**: the bytes alphaTab read, every track rendered, no document. Null is
 * **Composition**: today's composer. A `.gp` opens in Original and every other way in starts in Composition.
 *
 * Its own root service rather than a field on `ComposerService`, which is 861 lines against `CLAUDE.md`'s 1000-line
 * cap and whose history M2 already moved out to make room. `ComposerState` gains nothing either: the empty document
 * it already holds is simply not drawn while an original is current.
 *
 * **Another composition opening ends Original.** A load, New, an opened transcription, a progression sent over and
 * Convert itself each move `ComposerState.documentId` on, and the file on show is no longer what the page is about -
 * so the service follows the composer's state and clears itself, rather than every one of those paths remembering to.
 */
@Injectable({ providedIn: 'root' })
export class ComposerGpService {
  private readonly subject = new BehaviorSubject<GpOriginal | null>(null);
  private readonly requestSubject = new BehaviorSubject<EditRequest | null>(null);
  /** The composition that was open when the file opened: once another is, Original ends. */
  private openedOver: number | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService
  ) {
    this.composer.getState().subscribe(state => {
      if (this.openedOver !== null && state.documentId !== this.openedOver) this.clear();
    });
  }

  getState(): Observable<GpOriginal | null> {
    return this.subject.asObservable();
  }

  /** The command waiting on the conversion prompt, or null: the prompt is open while there is one. */
  getRequest(): Observable<EditRequest | null> {
    return this.requestSubject.asObservable();
  }

```

<!-- apply: find client/src/app/services/composer-gp.service.ts -->
```ts
  }

  /** Shows `original`, replacing whatever was shown: opening a second file is not a stack. */
  open(original: GpOriginal): void {
    this.subject.next(original);
  }

  /** Back to Composition, dropping the bytes: a conversion, or a composition opened over the file. */
  clear(): void {
    this.subject.next(null);
  }
}
```

becomes

<!-- apply: replace client/src/app/services/composer-gp.service.ts -->
```ts
  }

  /** The command waiting on the prompt, or null. */
  get request(): EditRequest | null {
    return this.requestSubject.getValue();
  }

  /**
   * Shows `file`, replacing whatever was shown: opening a second file is not a stack. What converting it would change is
   * measured here, once, off the rendering path (design Risks): `toDoc` is the conversion's first step, and the checker
   * reads it for the notes no string would reach.
   */
  open(file: GpFile): void {
    const loss = conversionLossOf(file.score, this.mapper.toDoc(file.score));
    this.openedOver = this.composer.state.documentId;
    this.requestSubject.next(null);
    this.subject.next({ ...file, loss });
  }

  /** Back to Composition, dropping the bytes and any command waiting on the prompt. */
  clear(): void {
    this.openedOver = null;
    this.requestSubject.next(null);
    if (this.subject.getValue() !== null) this.subject.next(null);
  }

  /**
   * Runs `run` - or, in Original, when the command `id` would change the document (`changesDocument`), holds it and
   * opens the conversion prompt instead. The one gate every writing command on the page goes through: the tools, from
   * the palette and the keys, a popover's value, Pen's write, the strip's Add track, an alphaTex apply, and Save.
   */
  requestEdit(id: string, label: string, run: () => void): void {
    if (!this.isOriginal || !changesDocument(id)) {
      run();
      return;
    }
    this.requestSubject.next({ id, label, run });
  }

  /** Cancel: the command that asked is dropped, and nothing else changes. */
  cancelEdit(): void {
    this.requestSubject.next(null);
  }
}
```

`client/src/app/services/modal-focus.ts`, new:

<!-- apply: create client/src/app/services/modal-focus.ts -->
```ts
/** What can take the focus by Tab inside a modal. */
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The focus of a modal dialog the page draws over itself: the shortcut sheet and the conversion prompt.
 *
 * Opening it moves the focus to its heading and remembers what had it; Tab goes round inside it; and closing it gives the
 * focus back - or, when that element has left the page, to a fallback, the score. The page makes its own content `inert`
 * while a modal is open, so the focus cannot get there either, and closes the modal by setting its `open` input,
 * whichever way it was closed, so the focus is handled here once.
 *
 * Lifted out of `ComposerShortcutSheetComponent` when the conversion prompt became the page's second modal. A plain
 * class the component owns and calls from its own hooks: `openChanged` from `ngOnChanges`, `afterViewChecked` from
 * `ngAfterViewChecked`, and `trapTab` from the dialog's `keydown`.
 */
export class ModalFocus {
  /** What had the focus when the modal opened. */
  private returnFocusTo: HTMLElement | null = null;
  /**
   * Set on opening, and acted on once the view has shown the modal: `open` changes before the view does, and an
   * element still under `display: none` cannot take the focus.
   */
  private focusOnRender = false;
  /**
   * Set on closing, and acted on once the view is checked: the page makes itself `inert` while the modal is open, and
   * an inert element cannot take the focus. By `ngAfterViewChecked` every binding in the page's template has been
   * applied, whatever order the page wrote them in, so the page is no longer inert. What had the focus is still read
   * on opening, in `ngOnChanges`, before the bindings after the modal make the page inert.
   */
  private focusBackOnRender = false;

  /** The modal's `open` input changed from `wasOpen` to `open`. */
  openChanged(open: boolean, wasOpen: boolean): void {
    if (open && !wasOpen) {
      const active = document.activeElement;
      this.returnFocusTo = active instanceof HTMLElement ? active : null;
      this.focusOnRender = true;
      this.focusBackOnRender = false;
    } else if (!open && wasOpen) {
      this.focusOnRender = false;
      this.focusBackOnRender = true;
    }
  }

  /**
   * Moves the focus to `heading` once the modal is shown, or back once it has closed. `dialog` is the modal's element,
   * and `fallback` is asked as the modal closes - not when the page binds it, since the page's element can be a view
   * query that is unset until it renders.
   */
  afterViewChecked(heading: HTMLElement | undefined, dialog: HTMLElement | undefined, fallback: () => HTMLElement | null): void {
    if (this.focusBackOnRender) {
      this.focusBackOnRender = false;
      this.giveFocusBack(dialog, fallback);
      return;
    }
    if (!this.focusOnRender) return;
    this.focusOnRender = false;
    heading?.focus();
  }

  /** Keeps Tab inside the open `dialog`, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent, open: boolean, dialog: HTMLElement | undefined): void {
    if (event.key !== 'Tab' || !open || !dialog) return;
    const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE));
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const onAControl = tabbable.some(element => element === active);
    const leaving = event.shiftKey ? active === first || !onAControl : active === last || !onAControl;
    if (!leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  /**
   * Gives the focus back to what had it before the modal opened, or to `fallback` when that has left the page or
   * was the page itself. Only while the focus is still the modal's: a click outside that closed it has already put
   * the focus where the user wanted it.
   */
  private giveFocusBack(dialog: HTMLElement | undefined, fallback: () => HTMLElement | null): void {
    const saved = this.returnFocusTo;
    this.returnFocusTo = null;
    this.focusOnRender = false;
    const active = document.activeElement;
    const stillOurs = active === null || active === document.body || !!dialog?.contains(active);
    if (!stillOurs) return;
    const target = saved && saved.isConnected && saved !== document.body ? saved : fallback();
    target?.focus();
  }
}
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/components/composer-tool-popover/composer-tool-popover.component.spec.ts --include=src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts --include=src/app/components/composer/composer.component.spec.ts --include=src/app/services/composer-edit-intent.spec.ts --include=src/app/services/composer-gp.service.spec.ts
```

Expected: `TOTAL: 155 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3484 SUCCESS`.

**Step 6: Commit.**

```text
feat: Ask before the first edit of a .gp file, and offer to save the original

In Original every writing command - a tool from the palette or the keys, a
popover's value, Pen's write, Add track, an alphaTex apply and Save - goes
through ComposerGpService.requestEdit, which holds it and opens the
conversion prompt: what the edit was, that converting cannot be undone, what
the file and its first save would lose, and Save the original file first.
Convert is disabled until the next step wires it. The modal's focus handling
moves out of the shortcut sheet into ModalFocus, which both now use, and
Original ends by itself when another composition opens.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase D: Converting

Build step 6, in Part 4's order - after the one repair it depends on.

### Task D.1: The GP library opens once, and says what it did

Convert's one irreversible step is `GpLibraryService.deleteEntry`, and it could resolve having deleted nothing:
the service opened its database from its constructor and kept no hold on the promise, so `updateEntry`, `deleteEntry`
and `clearLibrary` arriving first returned at once (correction 11).

It keeps one database promise now, as `ComposerLibraryService` does, and every method awaits it. The database name is an
injection token, `GP_LIBRARY_DB`, so each spec opens and deletes a database of its own - the one refactor Part 7 said the
specs would need - and `addBytes` adds a file from bytes, for the importer in Phase E. These are the service's first specs.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/gp-library.service.spec.ts`
- Modify: `services/gp-library.service.ts`

**Step 1: The failing specs.**

`client/src/app/services/gp-library.service.spec.ts`, new:

<!-- apply: create client/src/app/services/gp-library.service.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { GP_LIBRARY_DB, GpLibraryService } from './gp-library.service';

/**
 * The library of `.gp` files, against real IndexedDB under Karma - each spec in a database of its own
 * (`GP_LIBRARY_DB`), deleted after it, so nothing here touches the library a browser already holds.
 */
describe('GpLibraryService', () => {
  let service: GpLibraryService;
  let dbName: string;

  beforeEach(() => {
    dbName = `gp-library-spec-${Math.random().toString(36).slice(2)}`;
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: dbName }] });
    service = TestBed.inject(GpLibraryService);
  });

  afterEach(async () => {
    // Wait for the service's own open to settle, so the delete is not blocked by a connection still opening.
    await service.getEntry('none');
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

  it('adds bytes as a file, filling in what the caller does not say, and reads them back', async () => {
    const added = await service.addBytes(bytes(1, 2, 3), 'My_Song-take.gp', { trackCount: 4 });

    const read = await service.getEntry(added.id);
    expect(read?.fileName).toBe('My_Song-take.gp');
    expect(read?.fileSize).toBe(3);
    expect(Array.from(new Uint8Array(read!.fileData))).toEqual([1, 2, 3]);
    expect(read?.title).toBe('My Song take');
    expect(read?.trackCount).toBe(4);
    expect(read?.tempo).toBe(120);
  });

  it('adds a File through the same path', async () => {
    const added = await service.addFile(new File([new Uint8Array([9])], 'one.gp'), { title: 'One' });

    expect((await service.getEntry(added.id))?.title).toBe('One');
  });

  it('adds rather than overwrites: the same file added twice is two entries', async () => {
    await service.addBytes(bytes(1), 'a.gp', {});
    await service.addBytes(bytes(1), 'a.gp', {});

    const entries = await firstValueFrom(service.getEntries().pipe(filter(list => list.length === 2)));
    expect(entries.length).toBe(2);
  });

  it('updates an entry in place, and refuses one that is not there', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});

    await service.updateEntry(added.id, { tempo: 96, trackCount: 3 });

    const read = await service.getEntry(added.id);
    expect(read?.tempo).toBe(96);
    expect(read?.trackCount).toBe(3);
    await expectAsync(service.updateEntry('missing', { tempo: 1 })).toBeRejectedWithError('Entry not found');
  });

  it('deletes an entry, even when asked before the database has finished opening', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: GP_LIBRARY_DB, useValue: dbName }] });
    const fresh = TestBed.inject(GpLibraryService);

    await fresh.deleteEntry(added.id);

    expect(await fresh.getEntry(added.id)).toBeNull();
    service = fresh;
  });

  it('publishes the entries after every change', async () => {
    const added = await service.addBytes(bytes(1), 'a.gp', {});
    await firstValueFrom(service.getEntries().pipe(filter(list => list.length === 1)));

    await service.deleteEntry(added.id);

    expect(await firstValueFrom(service.getEntries())).toEqual([]);
  });

  it('clears the library', async () => {
    await service.addBytes(bytes(1), 'a.gp', {});

    await service.clearLibrary();

    expect(await firstValueFrom(service.getEntries())).toEqual([]);
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 8 errors, the first:

```text
src/app/services/gp-library.service.spec.ts(5,10): error TS2305: Module '"./gp-library.service"' has no exported member 'GP_LIBRARY_DB'.
```

**Step 3: The implementation.**

`client/src/app/services/gp-library.service.ts`:

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GpLibraryEntry, GpLibraryFilter } from '../models/alpha-tab.model';

const DB_NAME = 'gp-library';
const DB_VERSION = 1;
const STORE_NAME = 'files';

@Injectable({
  providedIn: 'root'
})
export class GpLibraryService {
  private db: IDBDatabase | null = null;
  private entriesSubject = new BehaviorSubject<GpLibraryEntry[]>([]);

  constructor(private ngZone: NgZone) {
    this.initDatabase();
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
import { Injectable, InjectionToken, NgZone, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GpLibraryEntry, GpLibraryFilter } from '../models/alpha-tab.model';

const DB_VERSION = 1;
const STORE_NAME = 'files';

/**
 * The IndexedDB database the library keeps its files in: `gp-library`. A token so each spec can open a database of its
 * own and delete it after, rather than share - or wipe - the one a developer's browser holds.
 */
export const GP_LIBRARY_DB = new InjectionToken<string>('GP_LIBRARY_DB', { providedIn: 'root', factory: () => 'gp-library' });

/** What a caller can say about a file it adds; everything else is filled in (`addBytes`). */
export type GpFileMetadata = Partial<Omit<GpLibraryEntry, 'id' | 'fileName' | 'fileSize' | 'fileData' | 'dateAdded'>>;

/**
 * The library of `.gp` files: IndexedDB, the gallery's source, and where the composer's Original state reads a file from.
 *
 * **One database promise** (`ensureDb`), as `ComposerLibraryService` keeps. The service used to start opening the
 * database from its constructor and keep no hold on the promise, so a write arriving before it opened either opened it a
 * second time or - `updateEntry`, `deleteEntry`, `clearLibrary` - resolved having done nothing. The conversion deletes
 * a file's entry once its composition is written, and a delete that did nothing would say it had.
 */
@Injectable({
  providedIn: 'root'
})
export class GpLibraryService {
  private readyPromise: Promise<IDBDatabase> | null = null;
  private entriesSubject = new BehaviorSubject<GpLibraryEntry[]>([]);
  private readonly dbName: string = inject(GP_LIBRARY_DB);

  constructor(private ngZone: NgZone) {
    // The gallery lists the library as soon as it is shown.
    void this.loadAllEntries().catch(error => console.error('Failed to open the GP library:', error));
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
  }

  /**
   * Initialize IndexedDB database
   */
  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.loadAllEntries();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store for GP files
```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
  }

  /** Opens the database once; later calls await the same promise. */
  private ensureDb(): Promise<IDBDatabase> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => reject(request.error ?? new Error('Failed to open the GP library'));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;

        // Create object store for GP files
```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
        }
      };
    });
  }

  /**
```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
        }
      };
    });
    return this.readyPromise;
  }

  /** Runs `body` against the store in one transaction and resolves with what its request returns. */
  private async inStore<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.ensureDb();
    return new Promise<T>((resolve, reject) => {
      const request = body(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('The GP library could not be read or written'));
    });
  }

  /**
```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   * Load all entries from IndexedDB
   */
  private loadAllEntries(): void {
    if (!this.db) return;

    const transaction = this.db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      this.ngZone.run(() => {
        this.entriesSubject.next(request.result || []);
      });
    };

    request.onerror = () => {
      console.error('Failed to load entries:', request.error);
    };
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   * Load all entries from IndexedDB
   */
  private async loadAllEntries(): Promise<void> {
    const entries = await this.inStore<GpLibraryEntry[]>('readonly', store => store.getAll());
    // IndexedDB callbacks run outside Angular's zone.
    this.ngZone.run(() => this.entriesSubject.next(entries ?? []));
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   * Add a GP file to the library
   */
  async addFile(file: File, metadata: Partial<GpLibraryEntry>): Promise<GpLibraryEntry> {
    if (!this.db) {
      await this.initDatabase();
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const entry: GpLibraryEntry = {
          id: this.generateId(),
          fileName: file.name,
          fileSize: file.size,
          fileData: reader.result as ArrayBuffer,
          title: metadata.title || this.extractTitleFromFileName(file.name),
          artist: metadata.artist || '',
          album: metadata.album || '',
          dateAdded: new Date(),
          key: metadata.key,
          detectedScales: metadata.detectedScales || [],
          detectedChords: metadata.detectedChords || [],
          trackCount: metadata.trackCount || 0,
          tempo: metadata.tempo || 120
        };

        const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = () => {
          this.loadAllEntries();
          resolve(entry);
        };

        request.onerror = () => {
          reject(request.error);
        };
      };

      reader.onerror = () => {
        reject(reader.error);
      };

      reader.readAsArrayBuffer(file);
    });
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   * Add a GP file to the library
   */
  async addFile(file: File, metadata: GpFileMetadata): Promise<GpLibraryEntry> {
    return this.addBytes(await file.arrayBuffer(), file.name, metadata);
  }

  /**
   * Adds `bytes` as a file named `fileName`, with what `metadata` says of it, and returns the entry. A title the metadata
   * does not give is the file name's; a tempo and a track count it does not give are 120 and 0, which is what a file no
   * one parsed can say.
   */
  async addBytes(bytes: ArrayBuffer, fileName: string, metadata: GpFileMetadata): Promise<GpLibraryEntry> {
    const entry: GpLibraryEntry = {
      id: this.generateId(),
      fileName,
      fileSize: bytes.byteLength,
      fileData: bytes,
      title: metadata.title || this.extractTitleFromFileName(fileName),
      artist: metadata.artist || '',
      album: metadata.album || '',
      dateAdded: new Date(),
      key: metadata.key,
      detectedScales: metadata.detectedScales || [],
      detectedChords: metadata.detectedChords || [],
      trackCount: metadata.trackCount || 0,
      tempo: metadata.tempo || 120
    };
    await this.inStore('readwrite', store => store.add(entry));
    await this.loadAllEntries();
    return entry;
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   */
  async updateEntry(id: string, updates: Partial<GpLibraryEntry>): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        const updatedEntry = { ...entry, ...updates };
        const putRequest = store.put(updatedEntry);

        putRequest.onsuccess = () => {
          this.loadAllEntries();
          resolve();
        };

        putRequest.onerror = () => {
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   */
  async updateEntry(id: string, updates: Partial<GpLibraryEntry>): Promise<void> {
    const entry = await this.getEntry(id);
    if (!entry) throw new Error('Entry not found');
    await this.inStore('readwrite', store => store.put({ ...entry, ...updates, id }));
    await this.loadAllEntries();
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   */
  async deleteEntry(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        this.loadAllEntries();
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   */
  async deleteEntry(id: string): Promise<void> {
    await this.inStore('readwrite', store => store.delete(id));
    await this.loadAllEntries();
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   */
  async getEntry(id: string): Promise<GpLibraryEntry | null> {
    if (!this.db) {
      await this.initDatabase();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   */
  async getEntry(id: string): Promise<GpLibraryEntry | null> {
    return (await this.inStore<GpLibraryEntry | undefined>('readonly', store => store.get(id))) ?? null;
  }

```

<!-- apply: find client/src/app/services/gp-library.service.ts -->
```ts
   */
  async clearLibrary(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.entriesSubject.next([]);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
```

becomes

<!-- apply: replace client/src/app/services/gp-library.service.ts -->
```ts
   */
  async clearLibrary(): Promise<void> {
    await this.inStore('readwrite', store => store.clear());
    this.ngZone.run(() => this.entriesSubject.next([]));
  }
}
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/services/gp-library.service.spec.ts
```

Expected: `TOTAL: 7 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3491 SUCCESS`.

**Step 6: Commit.**

```text
fix: Open the GP library once, and never resolve a write that did nothing

GpLibraryService keeps one database promise, as ComposerLibraryService does.
It used to start opening from its constructor and keep no hold on it, so
updateEntry, deleteEntry and clearLibrary resolved having done nothing when
they came first - and the conversion is about to trust a delete. The database
name is an injection token so specs open their own, addBytes adds a file
from bytes, and the service has its first specs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task D.2: Convert

Build step 6, in Part 4's order, which is the error handling. `GpConversionService.convert`:

1. the document, `frettedDocOf(toDoc(score))`, final before anything is written - a file with no title takes its file
   name's;
2. the composition, from the alphaTex every save writes, parsed back first: a parse with no score refuses the whole
   conversion, naming the track the diagnostic's line falls in, and nothing has been written;
3. the `.gp` entry deleted - a failure converts anyway and says the original is still in the library;
4. `replaceDocument(doc, { newComposition: true, markClean: true })`, which starts the history afresh and, by moving
   `documentId`, ends Original; the library panel adopts the new entry through `ComposerLibraryService.opened$`;
5. the edit that asked, on its own undo step.

The page's Convert runs it, closes the prompt on a refusal and says why in the status line.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/gp-conversion.service.spec.ts`, `services/gp-conversion.service.ts`
- Modify: `components/composer/components/composer-library-panel/composer-library-panel.component.ts`, `components/composer/composer.component.spec.ts`, `components/composer/composer.component.ts`, `services/composer-library.service.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/composer.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
import { ComposerLibraryService } from '../../services/composer-library.service';
import { ComposerGpService } from '../../services/composer-gp.service';
import { ComposerService } from '../../services/composer.service';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
import { ComposerLibraryService } from '../../services/composer-library.service';
import { ComposerGpService } from '../../services/composer-gp.service';
import { GpConversionService } from '../../services/gp-conversion.service';
import { GP_LIBRARY_DB, GpLibraryService } from '../../services/gp-library.service';
import { ComposerService } from '../../services/composer.service';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
  let gp: ComposerGpService;
  let composer: ComposerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
  let gp: ComposerGpService;
  let composer: ComposerService;
  // A GP library of its own, so a conversion deletes from nothing a browser already holds.
  const gpDb = `gp-library-page-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(() => void indexedDB.deleteDatabase(gpDb));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [{ provide: GP_LIBRARY_DB, useValue: gpDb }] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  it('offers Convert disabled, saying why, until converting is wired', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    expect(promptButton('Convert').disabled).toBeTrue();
    expect(prompt().querySelector('.convert-refusal')?.textContent?.trim()).toBe('Converting is not available yet.');
  });

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  /** Resolves once `done` holds, checking every few milliseconds for up to two seconds: IndexedDB answers outside the zone. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done() && waited < 2000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges();
  }

  it('converts on Convert: the composition saved, the file\'s entry gone, and the edit that asked applied on an empty history', async () => {
    const save = spyOn(TestBed.inject(ComposerLibraryService), 'save').and.resolveTo('composition-1');
    const gpLibrary = TestBed.inject(GpLibraryService);
    const entry = await gpLibrary.addBytes(new Uint8Array([1]).buffer, 'Band.gp', {});
    const score = new alphaTab.model.Score();
    score.title = 'Band';
    score.addMasterBar(new alphaTab.model.MasterBar());
    const track = new alphaTab.model.Track();
    track.addStaff(new alphaTab.model.Staff());
    score.addTrack(track);
    const bar = new alphaTab.model.Bar();
    track.staves[0].addBar(bar);
    bar.addVoice(new alphaTab.model.Voice());
    score.finish(new alphaTab.Settings());
    gp.open({ entryId: entry.id, fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    press({ key: 'b', shiftKey: true });

    promptButton('Convert').click();
    fixture.detectChanges();
    await until(() => !gp.isOriginal);

    expect(promptOpen()).toBeFalse();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await gpLibrary.getEntry(entry.id)).toBeNull();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();
    composer.undo();
    expect(composer.state.canUndo).toBeFalse();
    expect(fixture.nativeElement.querySelector('.original')).toBeNull();
  });

  it('closes the prompt on a refused conversion, stays in Original, and says why', async () => {
    spyOn(TestBed.inject(GpConversionService), 'convert').and.resolveTo({ kind: 'refused', reason: 'The track "Kit" uses drums alphaTex cannot name.' });
    await openFile('Band', 132);
    press({ key: 'h' });

    promptButton('Convert').click();
    await until(() => gp.request === null);

    expect(promptOpen()).toBeFalse();
    expect(gp.isOriginal).toBeTrue();
    expect(composer.state.refusal).toBe('The track "Kit" uses drums alphaTex cannot name.');
  });

```

`client/src/app/services/gp-conversion.service.spec.ts`, new:

<!-- apply: create client/src/app/services/gp-conversion.service.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerLibraryService } from './composer-library.service';
import { ComposerService } from './composer.service';
import { GpConversionService } from './gp-conversion.service';
import { GpLibraryService } from './gp-library.service';

/**
 * Convert, in the design's order - which is its error handling. The two libraries are spied rather than opened: what is
 * pinned here is which of them is written, deleted from or left alone at each step, and what the page is left showing.
 * The page's spec converts through real IndexedDB.
 */
describe('GpConversionService', () => {
  let conversion: GpConversionService;
  let gp: ComposerGpService;
  let composer: ComposerService;
  let tex: AlphaTexService;
  let save: jasmine.Spy;
  let deleteEntry: jasmine.Spy;
  let markOpened: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    conversion = TestBed.inject(GpConversionService);
    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    tex = TestBed.inject(AlphaTexService);
    const library = TestBed.inject(ComposerLibraryService);
    save = spyOn(library, 'save').and.resolveTo('composition-1');
    markOpened = spyOn(library, 'markOpened');
    deleteEntry = spyOn(TestBed.inject(GpLibraryService), 'deleteEntry').and.resolveTo();
  });

  /** Opens `source`, parsed as alphaTex, as the file `Band.gp` in entry `entry-1`. */
  function openFile(source: string): void {
    const { score } = tex.parse(source);
    if (!score) throw new Error('the file did not parse');
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
  }

  const guitar = ['\\title "Riff"', '\\tempo 96', '\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.1 |'].join('\n');

  /** Holds a double bar on bar 1 as the edit that asked. */
  function askWithDoubleBar(): void {
    gp.requestEdit('doubleBar', 'Double bar', () => composer.toggleMasterBarFlag('isDoubleBar'));
  }

  it('writes the composition, deletes the file, and opens the composition clean with the edit on its own undo step', async () => {
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'converted', compositionId: 'composition-1', originalKept: false });
    expect(save).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Riff', tempo: 96, trackCount: 1, barCount: 2 }));
    expect(deleteEntry).toHaveBeenCalledWith('entry-1');
    expect(markOpened).toHaveBeenCalledWith('composition-1');
    expect(gp.isOriginal).toBeFalse();
    expect(composer.doc.title).toBe('Riff');
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();

    composer.undo();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeFalse();
    expect(composer.state.canUndo).toBeFalse();
  });

  it('saves the alphaTex it proved reopens', async () => {
    openFile(guitar);
    askWithDoubleBar();

    await conversion.convert();

    const written = (save.calls.mostRecent().args[0] as { tex: string }).tex;
    expect(tex.parse(written).score).not.toBeNull();
  });

  it('names a file with no title after its file name', async () => {
    openFile(['\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 |'].join('\n'));
    askWithDoubleBar();

    await conversion.convert();

    expect(composer.doc.title).toBe('Band');
    expect(save).toHaveBeenCalledWith(jasmine.objectContaining({ title: 'Band' }));
  });

  it('refuses a drum kit alphaTex cannot name, naming the track, and writes and deletes nothing', async () => {
    openFile(['\\track "Kit" {instrument percussion}', '\\articulation defaults', '"Snare (hit)".4 r.4 r.2 |'].join('\n'));
    const kit = gp.original!.score.tracks[0];
    const head = alphaTab.model.MusicFontSymbol.NoteheadBlack;
    kit.percussionArticulations.push(new alphaTab.model.InstrumentArticulation('Mystery', 5, 77, head, head, head, alphaTab.model.MusicFontSymbol.None, undefined, 999));
    kit.staves[0].bars[0].voices[0].beats[0].notes[0].percussionArticulation = kit.percussionArticulations.length - 1;
    askWithDoubleBar();
    const before = composer.doc;

    const outcome = await conversion.convert();

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.reason).toMatch(/^The track "Kit" uses drums alphaTex cannot name/);
    expect(save).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(gp.isOriginal).toBeTrue();
    expect(composer.doc).toBe(before);
  });

  it('refuses when the composition cannot be saved, and deletes nothing', async () => {
    save.and.rejectWith(new Error('Quota exceeded'));
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'refused', reason: 'The composition could not be saved, so the file was not converted: Quota exceeded' });
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(gp.isOriginal).toBeTrue();
  });

  it('converts and keeps the original when its delete fails, and says the original is still in the library', async () => {
    deleteEntry.and.rejectWith(new Error('blocked'));
    openFile(guitar);
    askWithDoubleBar();

    const outcome = await conversion.convert();

    expect(outcome).toEqual({ kind: 'converted', compositionId: 'composition-1', originalKept: true });
    expect(gp.isOriginal).toBeFalse();
    expect(composer.state.refusal).toBeNull();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 5 errors, the first:

```text
src/app/components/composer/composer.component.spec.ts(15,37): error TS2307: Cannot find module '../../services/gp-conversion.service' or its corresponding type declarations.
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
        this.cdr.markForCheck();
      });

    this.document.addEventListener('keydown', this.escapeListener, true);
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
        this.cdr.markForCheck();
      });

    // An entry opened elsewhere - a converted `.gp` file - is the one the next Save writes over, as a load's is.
    this.library.opened$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.currentId = id;
      this.cdr.markForCheck();
    });

    this.document.addEventListener('keydown', this.escapeListener, true);
```

`client/src/app/components/composer/composer.component.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { GpConversionService } from '../../services/gp-conversion.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  /** The command waiting on the conversion prompt, which is open while there is one (`ComposerGpService.requestEdit`). */
  editRequest: EditRequest | null = null;
  /** Why the prompt's Convert cannot run yet: the conversion itself is the milestone's next step. */
  readonly convertRefusal: string | null = 'Converting is not available yet.';

  texDraft = '';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  /** The command waiting on the conversion prompt, which is open while there is one (`ComposerGpService.requestEdit`). */
  editRequest: EditRequest | null = null;
  /** Whether a conversion is under way: the prompt's Convert does not start a second. */
  converting = false;

  texDraft = '';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /**
   * Whether a modal is open over the page - the shortcut sheet, or the conversion prompt - so the rest of the page is
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** Why the prompt's Convert cannot run now: one is already under way. */
  get convertRefusal(): string | null {
    return this.converting ? 'Converting…' : null;
  }

  /**
   * Whether a modal is open over the page - the shortcut sheet, or the conversion prompt - so the rest of the page is
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly saveRequests: ComposerSaveRequests,
    private readonly exporter: ComposerExportService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly saveRequests: ComposerSaveRequests,
    private readonly exporter: ComposerExportService,
    private readonly conversion: GpConversionService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** The prompt's Convert. Not wired yet: the button is disabled and says so (`convertRefusal`). */
  convert(): void {
    return;
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /**
   * The prompt's Convert (`GpConversionService`). Converted, the page is a composition and the edit that asked has run;
   * refused, the prompt closes, the page stays in Original with nothing applied, and the status line says why.
   */
  convert(): void {
    if (this.converting) return;
    this.converting = true;
    void this.conversion.convert().then(outcome => {
      this.converting = false;
      if (outcome.kind === 'refused') {
        this.gp.cancelEdit();
        this.composer.announce(outcome.reason, true);
      }
      this.cdr.markForCheck();
    });
  }

```

`client/src/app/services/composer-library.service.ts`:

<!-- apply: find client/src/app/services/composer-library.service.ts -->
```ts
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const DB_NAME = 'composer-library';
```

becomes

<!-- apply: replace client/src/app/services/composer-library.service.ts -->
```ts
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

const DB_NAME = 'composer-library';
```

<!-- apply: find client/src/app/services/composer-library.service.ts -->
```ts
  private db: IDBDatabase | null = null;
  private readonly entriesSubject = new BehaviorSubject<CompositionSummary[]>([]);
  private readyPromise: Promise<void> | null = null;

```

becomes

<!-- apply: replace client/src/app/services/composer-library.service.ts -->
```ts
  private db: IDBDatabase | null = null;
  private readonly entriesSubject = new BehaviorSubject<CompositionSummary[]>([]);
  private readonly openedSubject = new Subject<string>();

  /**
   * The id of an entry opened by something other than the library panel - a converted `.gp` file, written and opened
   * in one step (`GpConversionService`) - so the panel adopts it, and the next Save writes over it rather than making a
   * second. Emitted after the document it holds is in place, so the panel has already forgotten the one before.
   */
  readonly opened$: Observable<string> = this.openedSubject.asObservable();
  private readyPromise: Promise<void> | null = null;

```

<!-- apply: find client/src/app/services/composer-library.service.ts -->
```ts
  getEntries(): Observable<CompositionSummary[]> {
    return this.entriesSubject.asObservable();
  }

```

becomes

<!-- apply: replace client/src/app/services/composer-library.service.ts -->
```ts
  getEntries(): Observable<CompositionSummary[]> {
    return this.entriesSubject.asObservable();
  }

  /** Says the entry `id` is the composition now open (`opened$`). */
  markOpened(id: string): void {
    this.openedSubject.next(id);
  }

```

`client/src/app/services/gp-conversion.service.ts`, new:

<!-- apply: create client/src/app/services/gp-conversion.service.ts -->
```ts
import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';

import { TexDiagnostic } from '../models/composer.model';
import { AlphaTexService } from './alpha-tex.service';
import { ComposerGpService } from './composer-gp.service';
import { ComposerLibraryService } from './composer-library.service';
import { ComposerService } from './composer.service';
import { GpLibraryService } from './gp-library.service';
import { frettedDocOf } from './pitch-on-strings';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/** What Convert did: made the composition - keeping the original's entry only when its delete failed - or refused. */
export type ConversionOutcome =
  | { kind: 'converted'; compositionId: string; originalKept: boolean }
  | { kind: 'refused'; reason: string };

/** alphaTab's diagnostic for a drum note whose name it does not know: what a kit alphaTex cannot name reads back as. */
const UNKNOWN_ARTICULATION = 209;

/**
 * Converts the `.gp` file on show into a composition: the prompt's Convert (the GP-composer design, Part 4).
 *
 * In order, and the order is the error handling:
 * 1. The document: `toDoc`, then `frettedDocOf`, both pure. Fretted here rather than inside `replaceDocument`, so the
 *    document is final before anything is written; `replaceDocument` frets again at step 4 and, on a fretted document,
 *    drops nothing, so its `markClean` survives.
 * 2. The composition is written, from the alphaTex every save writes - but that alphaTex is parsed back first, and a
 *    parse with no score refuses the conversion as a failed write does. A drum kit the file invents is the one thing known
 *    to fail it (design Part 3). **A failure here refuses the conversion**: the page stays in Original, the edit that asked
 *    is not applied, the `.gp` is untouched, and the reason names the track when the diagnostic does.
 * 3. The `.gp` entry is deleted: **the one irreversible step.** A failure leaves both rows, and says the original is still
 *    in the library - better than the reverse order, where a failed write after a delete would lose the file.
 * 4. The document replaces the page's as a new composition, clean: the library holds exactly it. `documentId` moves on,
 *    so the history starts empty (design decision 6), the library panel adopts the new entry (`markOpened`), and
 *    `ComposerGpService` leaves Original by itself, dropping the bytes - step 5.
 * 5. The edit that asked runs, as its own commit, so undo takes back the edit and stops at the converted score.
 */
@Injectable({ providedIn: 'root' })
export class GpConversionService {
  constructor(
    private readonly gp: ComposerGpService,
    private readonly composer: ComposerService,
    private readonly mapper: ScoreDocMapperService,
    private readonly tex: AlphaTexService,
    private readonly library: ComposerLibraryService,
    private readonly gpLibrary: GpLibraryService
  ) {}

  async convert(): Promise<ConversionOutcome> {
    const original = this.gp.original;
    if (!original) return { kind: 'refused', reason: 'There is no file to convert.' };
    // Taken now: leaving Original at step 4 drops it.
    const request = this.gp.request;

    // 1. The document. A file with no title takes its file name's, so the composition is not saved untitled.
    const doc = frettedDocOf(this.mapper.toDoc(original.score)).doc;
    if (!doc.title.trim()) doc.title = original.fileName.replace(/\.[^.]+$/, '');

    // 2. The composition, proved to reopen before it is written.
    let tex: string;
    try {
      tex = this.tex.export(this.mapper.toScore(doc, new alphaTab.Settings()));
    } catch (error) {
      return { kind: 'refused', reason: `The file could not be written as a composition, so it was not converted: ${messageOf(error)}` };
    }
    const reread = this.tex.parse(tex);
    if (!reread.score) return { kind: 'refused', reason: unsavableReasonOf(tex, reread.diagnostics) };

    let compositionId: string;
    try {
      compositionId = await this.library.save({
        title: doc.title,
        artist: doc.artist,
        tex,
        tempo: doc.tempo,
        trackCount: doc.tracks.length,
        barCount: doc.masterBars.length
      });
    } catch (error) {
      return { kind: 'refused', reason: `The composition could not be saved, so the file was not converted: ${messageOf(error)}` };
    }

    // 3. The one step that cannot be taken back.
    let originalKept = false;
    try {
      await this.gpLibrary.deleteEntry(original.entryId);
    } catch {
      originalKept = true;
    }

    // 4. The composition, as a new one, clean; the library panel names its entry.
    this.composer.replaceDocument(doc, { newComposition: true, markClean: true });
    this.library.markOpened(compositionId);
    if (originalKept) {
      this.composer.announce(`"${doc.title}" was converted, and the original file is still in the library.`, true);
    }

    // 5. The edit that asked, on its own undo step.
    request?.run();
    return { kind: 'converted', compositionId, originalKept };
  }
}

/** Why a composition whose alphaTex would not parse back is refused, naming the track the first error is in when it can. */
function unsavableReasonOf(tex: string, diagnostics: readonly TexDiagnostic[]): string {
  const error = diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? diagnostics[0];
  const track = error ? trackAtLine(tex, error.line) : null;
  const where = track ? `The track "${track}"` : 'A track';
  if (error?.code === UNKNOWN_ARTICULATION) {
    return `${where} uses drums alphaTex cannot name, so the file was not converted: a composition saved with them would not open again.`;
  }
  return `${where} would not open again once saved, so the file was not converted${error ? `: ${error.message}` : '.'}`;
}

/** The name of the `\track` the 1-based `line` of `tex` is in, or null. */
function trackAtLine(tex: string, line: number): string | null {
  const lines = tex.split('\n').slice(0, line);
  for (let index = lines.length - 1; index >= 0; index--) {
    const named = /^\s*\\track\s*\(?\s*"([^"]*)"/.exec(lines[index]);
    if (named) return named[1];
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/composer.component.spec.ts --include=src/app/services/gp-conversion.service.spec.ts
```

Expected: `TOTAL: 66 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3498 SUCCESS`.

**Step 6: Commit.**

```text
feat: Convert a .gp file into a composition

GpConversionService runs the design's order: the document, then the
composition written from alphaTex it first proves reopens, then the file's
entry deleted - the one step that cannot be taken back - then the
composition opened clean on an empty history, and the edit that asked run on
its own undo step. A kit alphaTex cannot name refuses the whole conversion
and names the track; a failed delete converts and says the original is still
in the library. The library panel adopts the new entry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase E: The entry points

Build step 7: `?gp=<id>`, Import .gp…, the drop, the Library drawer, and the gallery.

### Task E.1: The ways a file comes in

Build step 7. `GpFileOpener` is every route into Original: `openEntry(id)` for `/composer?gp=<id>` and the
Library drawer's new "Guitar Pro files" list; `importFile(file)` for Import .gp…; `importDropped(files)` for a drop on the
page, which opens the first `.gp` and says how many it left.

Each route parses the bytes first (correction 13), asks about unsaved work (`confirmDiscard`), writes or corrects the
library entry with what the file says of itself - so a gallery card's invented "120 BPM" is corrected the first time it
is opened - and then shows the file over a fresh page (correction 12). What goes wrong is said in the status line.

The page reads `?gp=` and clears it at once, so a reload does not reopen a file converted since; it is the first query
parameter the composer has read, so the page specs now provide a router. The gallery's Open goes to the composer, and
the gallery has its first spec.

**Files** (under `client/src/app/` unless given in full):
- Create: `components/gp-library/gp-library.component.spec.ts`, `services/gp-file-opener.service.ts`
- Modify: `components/composer/components/composer-library-panel/composer-library-panel.component.html`, `components/composer/components/composer-library-panel/composer-library-panel.component.scss`, `components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts`, `components/composer/components/composer-library-panel/composer-library-panel.component.ts`, `components/composer/composer.component.spec.ts`, `components/composer/composer.component.ts`, `components/gp-library/gp-library.component.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';

/**
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
import { GpFileOpener } from '../../../../services/gp-file-opener.service';
import { GP_LIBRARY_DB, GpLibraryService } from '../../../../services/gp-library.service';

/**
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComposerLibraryPanelComponent]
    }).compileComponents();

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComposerLibraryPanelComponent],
      // A GP library of its own: the drawer lists it, and nothing here should read the one a browser holds.
      providers: [{ provide: GP_LIBRARY_DB, useValue: `gp-library-panel-spec-${Math.random().toString(36).slice(2)}` }]
    }).compileComponents();

```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
    });
  });
});

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts -->
```ts
    });
  });

  describe('Guitar Pro files', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

    it('lists the library\'s .gp files in the drawer beside the compositions, and opens one as the file', async () => {
      const opened = spyOn(TestBed.inject(GpFileOpener), 'openEntry').and.resolveTo(true);
      const entry = await TestBed.inject(GpLibraryService).addBytes(new Uint8Array([1]).buffer, 'riff.gp', { title: 'Riff' });
      fixture.detectChanges();

      const row = host().querySelector<HTMLButtonElement>('.gp-file-list .composition-load');
      expect(row?.textContent).toContain('Riff');
      row!.click();
      await fixture.whenStable();

      expect(opened).toHaveBeenCalledWith(entry.id);
    });

    it('imports the file Import .gp… picks, and clears the picker so the same file can come again', async () => {
      const imported = spyOn(TestBed.inject(GpFileOpener), 'importFile').and.resolveTo(true);
      const picker = host().querySelector<HTMLInputElement>('.gp-picker')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1])], 'riff.gp'));
      picker.files = transfer.files;

      picker.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      expect(imported).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'riff.gp' }));
      expect(picker.value).toBe('');
    });

    it('adopts an entry opened elsewhere - a converted file - so Save writes over it', () => {
      library.markOpened('converted-id');
      fixture.detectChanges();

      expect(host().querySelector('.save-actions')?.textContent).toContain('Save as copy');
    });
  });
});

```

`client/src/app/components/composer/composer.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposerComponent, clampedStripHeight, stripHeightRangeOf } from './composer.component';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';

import { ComposerComponent, clampedStripHeight, stripHeightRangeOf } from './composer.component';
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([])] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
describe('ComposerComponent with its Library panel', () => {
  it('has one polite live region: the library says what it did in the status line', async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, { remove: { imports: [ComposerScoreComponent] }, add: { imports: [StubScoreComponent] } })
      .compileComponents();
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
describe('ComposerComponent with its Library panel', () => {
  it('has one polite live region: the library says what it did in the status line', async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([])] })
      .overrideComponent(ComposerComponent, { remove: { imports: [ComposerScoreComponent] }, add: { imports: [StubScoreComponent] } })
      .compileComponents();
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [{ provide: GP_LIBRARY_DB, useValue: gpDb }] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: gpDb }] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  it('gives the title and the BPM back once the file is gone', async () => {
    await openFile('Band', 132);
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
  });

  /** A one-track score written as a Guitar Pro 7 file, as a real `.gp` would arrive: there is no fixture in the repo. */
  function gpBytes(title: string): ArrayBuffer {
    const { score } = TestBed.inject(AlphaTexService).parse([`\\title "${title}"`, '\\tempo 90', '\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 |'].join('\n'));
    if (!score) throw new Error('the file did not parse');
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  it('opens /composer?gp=<id> in Original, and takes the query off the address', async () => {
    const entry = await TestBed.inject(GpLibraryService).addBytes(gpBytes('Riff'), 'riff.gp', {});
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/?gp=${entry.id}`);
    fixture.destroy();
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    await until(() => gp.isOriginal);

    expect(gp.original?.entryId).toBe(entry.id);
    expect(gp.original?.score.title).toBe('Riff');
    await until(() => !router.url.includes('gp='));
    expect(router.url).not.toContain('gp=');
  });

  it('says a file no longer in the library is gone, and stays in Composition', async () => {
    await TestBed.inject(Router).navigateByUrl('/?gp=missing');
    fixture.destroy();
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    await until(() => composer.state.refusal !== null);

    expect(composer.state.refusal).toBe('That file is no longer in the library.');
    expect(gp.isOriginal).toBeFalse();
  });

  it('opens a .gp dropped on the page, and says why it ignores anything else', async () => {
    const drop = (files: File[]): void => {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      fixture.nativeElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    };

    drop([new File(['text'], 'notes.txt')]);
    await until(() => composer.state.refusal !== null);
    expect(composer.state.refusal).toBe('"notes.txt" is not a Guitar Pro file.');

    drop([new File([gpBytes('Dropped')], 'dropped.gp'), new File(['text'], 'notes.txt')]);
    await until(() => gp.isOriginal);
    expect(gp.original?.score.title).toBe('Dropped');
    await until(() => composer.state.notice !== null);
    expect(composer.state.notice).toBe('Opened "dropped.gp". 1 other file was left: one file opens at a time.');
  });

  it('gives the title and the BPM back once the file is gone', async () => {
    await openFile('Band', 132);
```

`client/src/app/components/gp-library/gp-library.component.spec.ts`, new:

<!-- apply: create client/src/app/components/gp-library/gp-library.component.spec.ts -->
```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { GpLibraryComponent } from './gp-library.component';
import { GP_LIBRARY_DB, GpLibraryService } from '../../services/gp-library.service';

/**
 * The gallery of `.gp` files, which stays when the viewer goes (the GP-composer design, decision 1): its Open goes to the
 * composer, and what it lists, filters, sorts and takes from a drop. Against a library of its own in real IndexedDB.
 */
describe('GpLibraryComponent', () => {
  let fixture: ComponentFixture<GpLibraryComponent>;
  let component: GpLibraryComponent;
  let library: GpLibraryService;
  let dbName: string;

  beforeEach(async () => {
    dbName = `gp-gallery-spec-${Math.random().toString(36).slice(2)}`;
    await TestBed.configureTestingModule({
      imports: [GpLibraryComponent],
      providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: dbName }]
    }).compileComponents();
    library = TestBed.inject(GpLibraryService);
    fixture = TestBed.createComponent(GpLibraryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    await library.getEntry('none');
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });

  const bytes = (): ArrayBuffer => new Uint8Array([1]).buffer;

  it("opens a file in the composer, as the file, by its id: /composer?gp=<id>", async () => {
    const entry = await library.addBytes(bytes(), 'riff.gp', {});
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    component.openFile(entry);

    expect(navigate).toHaveBeenCalledWith(['/composer'], { queryParams: { gp: entry.id } });
  });

  it('takes the Guitar Pro files of a drop and leaves the rest', async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], 'one.gp5'));
    transfer.items.add(new File(['text'], 'notes.txt'));

    await component.onDrop(new DragEvent('drop', { dataTransfer: transfer }));

    const entries = await firstValueFrom(library.getEntries().pipe(filter(list => list.length > 0)));
    expect(entries.map(entry => entry.fileName)).toEqual(['one.gp5']);
  });

  it('lists what the search matches', async () => {
    await library.addBytes(bytes(), 'a.gp', { title: 'Blues in A' });
    await library.addBytes(bytes(), 'b.gp', { title: 'Reel' });
    await firstValueFrom(library.getEntries().pipe(filter(list => list.length === 2)));

    component.onFilterChange({ searchText: 'blues' });

    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Blues in A']);
  });

  it('sorts a new field in its natural direction, and flips the direction when the same field is chosen again', async () => {
    await library.addBytes(bytes(), 'a.gp', { title: 'Beta' });
    await library.addBytes(bytes(), 'b.gp', { title: 'Alpha' });
    await firstValueFrom(library.getEntries().pipe(filter(list => list.length === 2)));

    component.onSortChange('title');
    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Alpha', 'Beta']);

    component.onSortChange('title');
    expect(component.filteredEntries.map(entry => entry.title)).toEqual(['Beta', 'Alpha']);
  });

  it('toggles between the grid and the list', () => {
    expect(component.viewMode).toBe('grid');
    component.toggleViewMode();
    expect(component.viewMode).toBe('list');
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 7 errors, the first:

```text
src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts(14,30): error TS2307: Cannot find module '../../../../services/gp-file-opener.service' or its corresponding type declarations.
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html -->
```html
        <button class="text-btn" (click)="save(true)" *ngIf="currentId">Save as copy</button>
        <button class="text-btn open-drawer" (click)="openDrawer()">Saved compositions…</button>
      </div>
    </div>
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html -->
```html
        <button class="text-btn" (click)="save(true)" *ngIf="currentId">Save as copy</button>
        <button class="text-btn open-drawer" (click)="openDrawer()">Saved compositions…</button>
        <!-- A button that presses the hidden picker, so Tab reaches it and Enter and Space press it. -->
        <button class="text-btn import-gp" type="button" (click)="gpPicker.click()">Import .gp…</button>
        <input #gpPicker class="gp-picker" type="file" accept=".gp,.gp3,.gp4,.gp5,.gpx" tabindex="-1" aria-hidden="true" (change)="importGpFile(gpPicker)" />
      </div>
    </div>
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html -->
```html
      <p class="hint">Nothing saved yet.</p>
    </ng-template>
  </aside>
</div>
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.html -->
```html
      <p class="hint">Nothing saved yet.</p>
    </ng-template>

    <!-- Beside the compositions, from the library of `.gp` files: each opens as the file, until its first edit converts it. -->
    <h3 class="drawer-section" *ngIf="gpFiles.length > 0">Guitar Pro files</h3>
    <ul class="composition-list gp-file-list" *ngIf="gpFiles.length > 0">
      <li *ngFor="let file of gpFiles; trackBy: trackByGpId" class="composition-item">
        <button type="button" class="composition-load" (click)="openGpFile(file.id)" [title]="'Open ' + file.title">
          <span class="composition-title">{{ file.title }}</span>
          <span class="composition-meta">
            {{ file.fileName }}<ng-container *ngIf="file.trackCount"> · {{ file.trackCount }} track{{ file.trackCount === 1 ? '' : 's' }}</ng-container>
          </span>
        </button>
      </li>
    </ul>
  </aside>
</div>
```

`client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.scss`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.scss -->
```scss
    outline-offset: 2px;
  }
}

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.scss -->
```scss
    outline-offset: 2px;
  }
}

// The picker behind Import .gp…, which its button presses.
.gp-picker {
  display: none;
}

.drawer-section {
  margin: 0.75rem 1rem 0.25rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--composer-text-secondary, #bdc3c7);
}

```

`client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { ComposerState } from '../../../../models/composer.model';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
import { ComposerService } from '../../../../services/composer.service';
import { ComposerSaveRequests } from '../../../../services/composer-save-requests.service';
import { GpFileOpener } from '../../../../services/gp-file-opener.service';
import { GpLibraryService } from '../../../../services/gp-library.service';
import { GpLibraryEntry } from '../../../../models/alpha-tab.model';
import { ScoreDocMapperService } from '../../../../services/score-doc-mapper.service';
import { ComposerState } from '../../../../models/composer.model';
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
  linkedProgressions: string[] = [];

  /** The offer or report currently occupying the announced region. */
  pendingSave: PendingSave | null = null;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
  linkedProgressions: string[] = [];

  /** The `.gp` files in the library, listed in the drawer beside the compositions (design decision 2). */
  gpFiles: GpLibraryEntry[] = [];

  /** The offer or report currently occupying the announced region. */
  pendingSave: PendingSave | null = null;
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
    private readonly tex: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly cdr: ChangeDetectorRef,
    private readonly host: ElementRef<HTMLElement>
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
    private readonly tex: AlphaTexService,
    private readonly saveRequests: ComposerSaveRequests,
    private readonly gpLibrary: GpLibraryService,
    private readonly opener: GpFileOpener,
    private readonly cdr: ChangeDetectorRef,
    private readonly host: ElementRef<HTMLElement>
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
      .subscribe(entries => {
        this.entries = entries;
        this.cdr.markForCheck();
      });
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
      .subscribe(entries => {
        this.entries = entries;
        this.cdr.markForCheck();
      });

    this.gpLibrary
      .getEntries()
      .pipe(takeUntil(this.destroy$))
      .subscribe(files => {
        this.gpFiles = files;
        this.cdr.markForCheck();
      });
```

<!-- apply: find client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
  }

  async load(id: string): Promise<void> {
    // A load starts a fresh history, so unsaved work - the document's, or an edited alphaTex draft - is asked about first.
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-library-panel/composer-library-panel.component.ts -->
```ts
  }

  /** Opens an imported `.gp` file from the drawer, in the Original state. */
  async openGpFile(id: string): Promise<void> {
    if (await this.opener.openEntry(id)) this.closeDrawer();
  }

  /** Import .gp…: the picker's file, added to the library and opened. The picker is cleared so the same file can come again. */
  async importGpFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    this.closeMenus();
    if (file) await this.opener.importFile(file);
  }

  trackByGpId(_index: number, entry: GpLibraryEntry): string {
    return entry.id;
  }

  async load(id: string): Promise<void> {
    // A load starts a fresh history, so unsaved work - the document's, or an edited alphaTex draft - is asked about first.
```

`client/src/app/components/composer/composer.component.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import * as alphaTab from '@coderline/alphatab';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { GpConversionService } from '../../services/gp-conversion.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerGpService, EditRequest, GpOriginal } from '../../services/composer-gp.service';
import { GpConversionService } from '../../services/gp-conversion.service';
import { GpFileOpener } from '../../services/gp-file-opener.service';
import { ComposerService } from '../../services/composer.service';
import { FretDigitEntry } from '../../services/composer-fret-entry';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly exporter: ComposerExportService,
    private readonly conversion: GpConversionService,
    private readonly cdr: ChangeDetectorRef
  ) {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
    private readonly exporter: ComposerExportService,
    private readonly conversion: GpConversionService,
    private readonly opener: GpFileOpener,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
      });

    // Save in the Library menu asks the same questions Ctrl+S does (`requestSave`): the draft's, and in Original the
    // conversion prompt's, since the library holds compositions and a file not yet converted has none to write.
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
      });

    // `/composer?gp=<id>`, the gallery's Open: the file opens in Original. The query is cleared first, so a reload does not
    // open again a file converted since - the page never used the router before, and this is the one parameter it reads.
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const id = params.get('gp');
      if (!id) return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { gp: null }, queryParamsHandling: 'merge', replaceUrl: true });
      void this.opener.openEntry(id);
    });

    // Save in the Library menu asks the same questions Ctrl+S does (`requestSave`): the draft's, and in Original the
    // conversion prompt's, since the library holds compositions and a file not yet converted has none to write.
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** Whether `target` is a palette button whose tool a held key runs again. */
  private repeatableToolAt(target: EventTarget | null): boolean {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** A file dragged over the page may be dropped on it: without this the browser would open the file itself. */
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  }

  /** A `.gp` dropped anywhere on the page opens in Original (`GpFileOpener.importDropped`). */
  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void this.opener.importDropped(files);
  }

  /** Whether `target` is a palette button whose tool a held key runs again. */
  private repeatableToolAt(target: EventTarget | null): boolean {
```

`client/src/app/components/gp-library/gp-library.component.ts`:

<!-- apply: find client/src/app/components/gp-library/gp-library.component.ts -->
```ts
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { GpLibraryService } from '../../services/gp-library.service';
import { GpLibraryEntry, GpLibraryFilter } from '../../models/alpha-tab.model';
```

becomes

<!-- apply: replace client/src/app/components/gp-library/gp-library.component.ts -->
```ts
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { isGpFileName } from '../../services/gp-file-opener.service';
import { GpLibraryService } from '../../services/gp-library.service';
import { GpLibraryEntry, GpLibraryFilter } from '../../models/alpha-tab.model';
```

<!-- apply: find client/src/app/components/gp-library/gp-library.component.ts -->
```ts
  }

  /**
   * Open a file in the GP viewer
   */
  openFile(entry: GpLibraryEntry): void {
    this.router.navigate(['/gp-viewer'], {
      queryParams: { id: entry.id }
    });
  }
```

becomes

<!-- apply: replace client/src/app/components/gp-library/gp-library.component.ts -->
```ts
  }

  /** Opens a file in the composer, in the Original state: `/composer?gp=<id>`. */
  openFile(entry: GpLibraryEntry): void {
    void this.router.navigate(['/composer'], {
      queryParams: { gp: entry.id }
    });
  }
```

<!-- apply: find client/src/app/components/gp-library/gp-library.component.ts -->
```ts
   */
  private async addFiles(files: File[]): Promise<void> {
    const validExtensions = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];

    for (const file of files) {
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));

      if (isValid) {
        try {
          await this.libraryService.addFile(file, {});
```

becomes

<!-- apply: replace client/src/app/components/gp-library/gp-library.component.ts -->
```ts
   */
  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (isGpFileName(file.name)) {
        try {
          await this.libraryService.addFile(file, {});
```

`client/src/app/services/gp-file-opener.service.ts`, new:

<!-- apply: create client/src/app/services/gp-file-opener.service.ts -->
```ts
import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';

import { GpLibraryEntry } from '../models/alpha-tab.model';
import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { GpFileMetadata, GpLibraryService } from './gp-library.service';

/** The extensions of a file alphaTab can read as Guitar Pro. */
const GP_FILE = /\.(gp|gp3|gp4|gp5|gpx)$/i;

/** Whether `fileName` names a Guitar Pro file, by its extension. */
export function isGpFileName(fileName: string): boolean {
  return GP_FILE.test(fileName);
}

/** What a parsed file says about itself, for its library entry: its title, artist, album, tempo and track count. */
export function gpMetadataOf(score: alphaTab.model.Score): GpFileMetadata {
  return {
    title: score.title || undefined,
    artist: score.artist || undefined,
    album: score.album || undefined,
    tempo: score.tempo,
    trackCount: score.tracks.length
  };
}

/**
 * Every way a `.gp` file comes into the composer, and each opens it in the Original state (the GP-composer design,
 * Part 1's table): `?gp=<id>` from the gallery, a row of the Library drawer, Import .gp…, and a file dropped on the page.
 *
 * Each route parses the bytes before anything is written, and writes or corrects the file's `gp-library` entry before the
 * page enters Original (design decision 17): so Convert always has exactly one entry to replace, a file alphaTab cannot
 * read leaves nothing half-imported behind, and an entry the gallery added with invented metadata - "120 BPM", "0
 * tracks" - is corrected the first time it is opened. Unsaved work is asked about first, as every path that opens
 * another composition asks (`confirmDiscard`). What went wrong is said in the status line.
 */
@Injectable({ providedIn: 'root' })
export class GpFileOpener {
  constructor(
    private readonly gp: ComposerGpService,
    private readonly gpLibrary: GpLibraryService,
    private readonly composer: ComposerService
  ) {}

  /** Opens the library's entry `id`. False when it did not - the entry gone, unreadable, or the user kept their work. */
  async openEntry(id: string): Promise<boolean> {
    const entry = await this.gpLibrary.getEntry(id).catch(() => null);
    if (!entry) return this.refuse('That file is no longer in the library.');
    const score = scoreOf(entry.fileData);
    if (!score) return this.refuse(unreadable(entry.fileName));
    if (!this.composer.confirmDiscard('open this file')) return false;

    await this.correctEntry(entry, score);
    this.show(entry.id, entry.fileName, entry.fileData, score);
    return true;
  }

  /** Imports `file` into the library and opens it. False when it did not, having said why. */
  async importFile(file: File): Promise<boolean> {
    if (!isGpFileName(file.name)) return this.refuse(`"${file.name}" is not a Guitar Pro file.`);
    const bytes = await file.arrayBuffer();
    const score = scoreOf(bytes);
    if (!score) return this.refuse(unreadable(file.name));
    if (!this.composer.confirmDiscard('open this file')) return false;

    let entry: GpLibraryEntry;
    try {
      entry = await this.gpLibrary.addBytes(bytes, file.name, gpMetadataOf(score));
    } catch (error) {
      return this.refuse(`"${file.name}" could not be added to the library: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.show(entry.id, file.name, bytes, score);
    return true;
  }

  /**
   * Opens the first Guitar Pro file of `files`, dropped on the page, and says how many others it left: one file is open
   * at a time. The gallery, which lists rather than opens, takes all of them.
   */
  async importDropped(files: readonly File[]): Promise<void> {
    const gpFiles = files.filter(file => isGpFileName(file.name));
    if (gpFiles.length === 0) {
      this.refuse(files.length === 1 ? `"${files[0].name}" is not a Guitar Pro file.` : 'None of those files is a Guitar Pro file.');
      return;
    }
    const opened = await this.importFile(gpFiles[0]);
    const ignored = files.length - 1;
    if (opened && ignored > 0) {
      this.composer.announce(`Opened "${gpFiles[0].name}". ${ignored} other file${ignored === 1 ? ' was' : 's were'} left: one file opens at a time.`);
    }
  }

  /**
   * Shows the file over a fresh page: the composition that was open is not what the page is about now, so the library
   * panel forgets its entry and a Save cannot write the file's conversion over it.
   */
  private show(entryId: string, fileName: string, bytes: ArrayBuffer, score: alphaTab.model.Score): void {
    this.composer.reset();
    this.gp.open({ entryId, fileName, bytes, score });
  }

  /** Writes what the parsed file says about itself over what its entry says, where they differ. */
  private async correctEntry(entry: GpLibraryEntry, score: alphaTab.model.Score): Promise<void> {
    const read = gpMetadataOf(score);
    const updates: Partial<GpLibraryEntry> = {};
    if (read.title && read.title !== entry.title) updates.title = read.title;
    if ((read.artist ?? '') !== (entry.artist ?? '')) updates.artist = read.artist ?? '';
    if ((read.album ?? '') !== (entry.album ?? '')) updates.album = read.album ?? '';
    if (read.tempo !== entry.tempo) updates.tempo = read.tempo;
    if (read.trackCount !== entry.trackCount) updates.trackCount = read.trackCount;
    if (Object.keys(updates).length === 0) return;
    // A correction that fails costs a stale card in the gallery, not the file: opening goes on.
    await this.gpLibrary.updateEntry(entry.id, updates).catch(() => undefined);
  }

  private refuse(message: string): false {
    this.composer.announce(message, true);
    return false;
  }
}

/** `bytes` read as a Guitar Pro file, or null when alphaTab cannot. */
function scoreOf(bytes: ArrayBuffer): alphaTab.model.Score | null {
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes), new alphaTab.Settings());
  } catch {
    return null;
  }
}

function unreadable(fileName: string): string {
  return `"${fileName}" could not be read as a Guitar Pro file.`;
}
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/components/composer-library-panel/composer-library-panel.component.spec.ts --include=src/app/components/composer/composer.component.spec.ts --include=src/app/components/gp-library/gp-library.component.spec.ts
```

Expected: `TOTAL: 124 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3509 SUCCESS`.

**Step 6: Commit.**

```text
feat: Open .gp files in the composer from the gallery, the Library menu and a drop

GpFileOpener is every way a .gp comes in: /composer?gp=<id>, a row of the
Library drawer's new Guitar Pro files list, Import .gp..., and a file dropped
on the page. Each parses the bytes first, writes or corrects the file's
library entry with what the file says of itself, asks about unsaved work,
and only then shows the file in Original over a fresh page. The query is
cleared once read, and the gallery's Open now goes to the composer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase F: The track strip

Build step 8: show / hide, mute and solo on every row, in both states.

### Task F.1: Show / hide, mute and solo on every row

Build step 8. `composer-track-rows.ts` gives the strip one list from either source - a composition's
document, or the file's alphaTab score - as a `TrackView` shows them: `trackRowsOf`, `renderedTracksOf`, `hideRefusalOf`.

- **Show / hide** is a page setting in both states (decision 15), kept by `ComposerTrackViewService`, keyed by a
  composition track's id so it survives the tracks around it moving. The score draws only the tracks shown -
  `renderScore`'s indices in Composition, `api.renderTracks` in Original - and `staffSlotsOf` and `staffSlotsOfScore`
  follow, so the caret and the hit test agree with what is drawn. Hiding the last one refuses and says why.
- **Mute and solo** are the composition's own mixer in Composition, as edits, through `setPlayback`'s new track index;
  in Original they are the player's, taken from what the file declares as it opens (correction 14).
- **The player** is told through `AlphaTabService.setTrackPlayback`, which keeps what the page wants and puts it back
  after every MIDI load, since the player never reads a score's own mute.

In Original the strip hides what needs a document: Remove, the progression's badge, Update, Flatten and Add progression
track.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/composer-track-rows.spec.ts`, `services/composer-track-rows.ts`, `services/composer-track-view.service.spec.ts`, `services/composer-track-view.service.ts`
- Modify: `components/composer/components/composer-score/composer-score.component.spec.ts`, `components/composer/components/composer-score/composer-score.component.ts`, `components/composer/components/composer-track-strip/composer-track-strip.component.html`, `components/composer/components/composer-track-strip/composer-track-strip.component.scss`, `components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`, `components/composer/components/composer-track-strip/composer-track-strip.component.ts`, `services/alpha-tab.service.spec.ts`, `services/alpha-tab.service.ts`, `services/composer-score-interaction.spec.ts`, `services/composer-score-interaction.ts`, `services/composer-service-structure.ts`, `services/composer.service.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/components/composer-score/composer-score.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.spec.ts -->
```ts
      'initializeApi',
      'renderScore',
      'render',
      'auditionAfterRender',
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.spec.ts -->
```ts
      'initializeApi',
      'renderScore',
      'renderTracks',
      'setTrackPlayback',
      'render',
      'auditionAfterRender',
```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts
    expect(gp.request?.label).toBe('Add track');
  });
});

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts -->
```ts
    expect(gp.request?.label).toBe('Add track');
  });

  describe('show / hide, mute and solo', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const rowButtons = (selector: string): HTMLButtonElement[] => Array.from(host().querySelectorAll<HTMLButtonElement>(selector));

    beforeEach(() => {
      composer.addTrack('Piano', 0, false);
      fixture.detectChanges();
    });

    it('hides a track\'s staves as a page setting, not an edit, and refuses to hide the last one shown', () => {
      const before = composer.doc;
      rowButtons('.track-shown')[0].click();
      fixture.detectChanges();

      expect(rowButtons('.track-shown')[0].getAttribute('aria-pressed')).toBe('false');
      expect(composer.doc).toBe(before);
      expect(rowButtons('.track-shown')[1].getAttribute('aria-disabled')).toBe('true');
      expect(rowButtons('.track-shown')[1].getAttribute('aria-label')).toContain('unavailable');

      rowButtons('.track-shown')[1].click();
      fixture.detectChanges();
      expect(composer.state.refusal).toMatch(/At least one track is shown/);
      expect(rowButtons('.track-shown')[1].getAttribute('aria-pressed')).toBe('true');
    });

    it("mutes and solos a composition's track in its own mixer, as an edit", () => {
      rowButtons('.track-mute')[1].click();
      rowButtons('.track-solo')[0].click();
      fixture.detectChanges();

      expect(composer.doc.tracks[1].playback.isMute).toBeTrue();
      expect(composer.doc.tracks[0].playback.isSolo).toBeTrue();
      expect(rowButtons('.track-mute')[1].getAttribute('aria-pressed')).toBe('true');
      composer.undo();
      expect(composer.doc.tracks[0].playback.isSolo).toBeFalse();
    });

    it("lists a file's tracks in Original, with no Remove, badge or Update, and mutes them in the player only", () => {
      const score = new alphaTab.model.Score();
      for (const name of ['Lead', 'Bass', 'Drums']) {
        const track = new alphaTab.model.Track();
        track.name = name;
        score.addTrack(track);
      }
      TestBed.inject(ComposerGpService).open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
      fixture.detectChanges();

      expect(Array.from(host().querySelectorAll('.track-name')).map(name => name.textContent?.trim())).toEqual(['Lead', 'Bass', 'Drums']);
      expect(host().querySelector('.track-remove')).toBeNull();
      expect(host().querySelector('.add-progression-track')).toBeNull();

      const before = composer.doc;
      rowButtons('.track-mute')[2].click();
      fixture.detectChanges();

      expect(rowButtons('.track-mute')[2].getAttribute('aria-pressed')).toBe('true');
      expect(composer.doc).toBe(before);
      expect(score.tracks[2].playbackInfo.isMute).toBeFalse();
    });
  });
});

```

`client/src/app/services/alpha-tab.service.spec.ts`:

<!-- apply: find client/src/app/services/alpha-tab.service.spec.ts -->
```ts
      service.seekToBeat(beat);
      service.renderTracks([0, 1]);
    }).not.toThrow();
  });
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.spec.ts -->
```ts
      service.seekToBeat(beat);
      service.renderTracks([0, 1]);
      service.setTrackPlayback([{ mute: true, solo: false }]);
    }).not.toThrow();
  });
```

`client/src/app/services/composer-score-interaction.spec.ts`:

<!-- apply: find client/src/app/services/composer-score-interaction.spec.ts -->
```ts
    expect(caretSlotIndexOf(slots, at(0, 0, 0, null), null)).toBe(1);
  });
});

```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.spec.ts -->
```ts
    expect(caretSlotIndexOf(slots, at(0, 0, 0, null), null)).toBe(1);
  });
});

describe('staffSlotsOf over the tracks drawn', () => {
  it('lists the staves of the tracks shown, in the order drawn, and those alone', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));

    expect(staffSlotsOf(doc).map(slot => `${slot.trackIndex}:${slot.kind}`)).toEqual(['0:notation', '0:tab', '1:notation']);
    expect(staffSlotsOf(doc, [1]).map(slot => `${slot.trackIndex}:${slot.kind}`)).toEqual(['1:notation']);
  });
});

```

`client/src/app/services/composer-track-rows.spec.ts`, new:

<!-- apply: create client/src/app/services/composer-track-rows.spec.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { EMPTY_TRACK_VIEW, LAST_SHOWN_TRACK, TrackView, hideRefusalOf, renderedTracksOf, trackRowsOf } from './composer-track-rows';

describe('trackRowsOf', () => {
  /** A composition of guitar and piano, the piano muted in its own mixer. */
  function composition() {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    doc.tracks[1].playback.isMute = true;
    return doc;
  }

  /** A file of two tracks, the second unnamed. */
  function file(): alphaTab.model.Score {
    const score = new alphaTab.model.Score();
    const first = new alphaTab.model.Track();
    first.name = 'Lead';
    score.addTrack(first);
    score.addTrack(new alphaTab.model.Track());
    return score;
  }

  it("reads a composition's rows from its document, mute and solo from its own mixer", () => {
    const doc = composition();

    const rows = trackRowsOf(doc, EMPTY_TRACK_VIEW);

    expect(rows.map(row => [row.index, row.key, row.name, row.shown, row.muted, row.soloed])).toEqual([
      [0, doc.tracks[0].id, doc.tracks[0].name, true, false, false],
      [1, doc.tracks[1].id, 'Piano', true, true, false]
    ]);
  });

  it("reads a file's rows from the alphaTab score, and mute and solo from the view: the player's, not the file's", () => {
    const view: TrackView = { hidden: new Set(['1']), muted: new Set(['0']), soloed: new Set(['1']) };

    const rows = trackRowsOf(file(), view);

    expect(rows.map(row => [row.index, row.key, row.name, row.shown, row.muted, row.soloed])).toEqual([
      [0, '0', 'Lead', true, true, false],
      [1, '1', 'Track 2', false, false, true]
    ]);
  });

  it("keeps a composition's hidden track by its id, so it stays hidden when a track before it goes", () => {
    const doc = composition();
    const view: TrackView = { ...EMPTY_TRACK_VIEW, hidden: new Set([doc.tracks[1].id]) };
    doc.tracks.shift();

    expect(trackRowsOf(doc, view).map(row => row.shown)).toEqual([false]);
  });
});

describe('renderedTracksOf', () => {
  it('draws the rows shown, in order', () => {
    const rows = trackRowsOf(ComposerService.createEmptyScore(), EMPTY_TRACK_VIEW);

    expect(renderedTracksOf(rows)).toEqual([0]);
    expect(renderedTracksOf(rows.map(row => ({ ...row, shown: false })))).toEqual([]);
  });
});

describe('hideRefusalOf', () => {
  it('refuses hiding the last track shown, and nothing else', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const both = trackRowsOf(doc, EMPTY_TRACK_VIEW);
    const one = trackRowsOf(doc, { ...EMPTY_TRACK_VIEW, hidden: new Set([doc.tracks[0].id]) });

    expect(hideRefusalOf(both, 0)).toBeNull();
    expect(hideRefusalOf(one, 1)).toBe(LAST_SHOWN_TRACK);
    // Showing the hidden one is never refused.
    expect(hideRefusalOf(one, 0)).toBeNull();
  });
});
```

`client/src/app/services/composer-track-view.service.spec.ts`, new:

<!-- apply: create client/src/app/services/composer-track-view.service.spec.ts -->
```ts
import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { LAST_SHOWN_TRACK, trackRowsOf } from './composer-track-rows';
import { ComposerTrackViewService } from './composer-track-view.service';

describe('ComposerTrackViewService', () => {
  let views: ComposerTrackViewService;
  let gp: ComposerGpService;
  let composer: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    views = TestBed.inject(ComposerTrackViewService);
    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
  });

  /** A file of two tracks, the second muted and soloed by the file itself. */
  function openFile(): void {
    const score = new alphaTab.model.Score();
    score.addTrack(new alphaTab.model.Track());
    const second = new alphaTab.model.Track();
    second.playbackInfo.isMute = true;
    second.playbackInfo.isSolo = true;
    score.addTrack(second);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
  }

  it("takes a file's mutes and solos from what the file declares, with every track shown", () => {
    openFile();

    expect([...views.view.muted]).toEqual(['1']);
    expect([...views.view.soloed]).toEqual(['1']);
    expect(views.view.hidden.size).toBe(0);
  });

  it('toggles the player\'s mute and solo in Original, and never the file\'s', () => {
    openFile();

    views.toggleMuted('0');
    views.toggleSoloed('1');

    expect([...views.view.muted].sort()).toEqual(['0', '1']);
    expect([...views.view.soloed]).toEqual([]);
    expect(gp.original?.score.tracks[0].playbackInfo.isMute).toBeFalse();
  });

  it('hides and shows a track, and refuses to hide the last one shown', () => {
    openFile();
    const rows = () => trackRowsOf(gp.original!.score, views.view);

    expect(views.toggleShown(rows(), 0)).toBeNull();
    expect(views.toggleShown(rows(), 1)).toBe(LAST_SHOWN_TRACK);
    expect(rows().map(row => row.shown)).toEqual([false, true]);
    expect(views.toggleShown(rows(), 0)).toBeNull();
    expect(rows().map(row => row.shown)).toEqual([true, true]);
  });

  it('shows every track again when another composition opens', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    composer.replaceDocument(doc, { newComposition: true });
    views.toggleShown(trackRowsOf(composer.doc, views.view), 0);
    expect(views.view.hidden.size).toBe(1);

    composer.reset();

    expect(views.view.hidden.size).toBe(0);
  });

  it('keeps nothing of the file once the page leaves it', () => {
    openFile();

    gp.clear();

    expect(views.view.muted.size).toBe(0);
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 13 errors, the first:

```text
src/app/components/composer/components/composer-score/composer-score.component.spec.ts(23,37): error TS2769: No overload matches this call.
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-score/composer-score.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
import { ComposerGpService, GpOriginal } from '../../../../services/composer-gp.service';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { TrackView, renderedTracksOf, trackRowsOf } from '../../../../services/composer-track-rows';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
import { ComposerGpService, GpOriginal } from '../../../../services/composer-gp.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  private surfaceObserver: MutationObserver | null = null;
  /** The staves the document draws, for the document they were read from. */
  private slotsRead: { source: unknown; slots: StaffSlot[] } | null = null;
  /** The file whose bytes alphaTab was last given, so the Original state loads once rather than on every redraw. */
  private lastLoadedOriginal: GpOriginal | null = null;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  private surfaceObserver: MutationObserver | null = null;
  /** The staves the document draws, for the document they were read from. */
  private slotsRead: { source: unknown; drawn: string; slots: StaffSlot[] } | null = null;
  /** The track strip's hidden tracks and, in Original, the player's mutes (`ComposerTrackViewService`). */
  private trackView: TrackView;
  /** The tracks last drawn from the file in Original, so a show or hide redraws only when it changes them. */
  private lastDrawnOriginalTracks = '';
  /** The file whose bytes alphaTab was last given, so the Original state loads once rather than on every redraw. */
  private lastLoadedOriginal: GpOriginal | null = null;
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
    private readonly alphaTabService: AlphaTabService,
    private readonly gp: ComposerGpService,
    private readonly hitTest: StaffHitTestService,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone
  ) {}

  ngOnInit(): void {
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
    private readonly alphaTabService: AlphaTabService,
    private readonly gp: ComposerGpService,
    private readonly trackViews: ComposerTrackViewService,
    private readonly hitTest: StaffHitTestService,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone
  ) {
    this.trackView = trackViews.view;
  }

  ngOnInit(): void {
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        if (!this.gp.isOriginal && scoreRedrawOf(this.lastRenderedDoc, state.doc) === 'render') this.renderRequest$.next();
        else this.drawHighlight();
        this.scheduleCaretUpdate();
        this.cdr.markForCheck();
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        if (!this.gp.isOriginal && scoreRedrawOf(this.lastRenderedDoc, state.doc) === 'render') this.renderRequest$.next();
        else this.drawHighlight();
        this.applyTrackPlayback();
        this.scheduleCaretUpdate();
        this.cdr.markForCheck();
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        this.renderRequest$.next();
      });
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        this.renderRequest$.next();
      });

    // A track shown or hidden redraws; a mute or solo only plays differently.
    this.trackViews
      .getView()
      .pipe(takeUntil(this.destroy$))
      .subscribe(view => {
        const hiddenChanged = view.hidden !== this.trackView.hidden;
        this.trackView = view;
        if (hiddenChanged) this.redrawShownTracks();
        this.applyTrackPlayback();
      });
  }

  /** The strip's rows for what the page is showing: the file's in Original, the document's in Composition. */
  private trackRows(): ReturnType<typeof trackRowsOf> {
    const original = this.gp.original;
    if (original) return trackRowsOf(original.score, this.trackView);
    return this.state ? trackRowsOf(this.state.doc, this.trackView) : [];
  }

  /**
   * Redraws after a track was shown or hidden. In Composition the document is engraved again with the tracks shown; in
   * Original alphaTab draws those tracks of the score it holds (`renderTracks`), since there is no document to engrave.
   */
  private redrawShownTracks(): void {
    this.slotsRead = null;
    if (!this.gp.isOriginal) {
      this.lastRenderedDoc = null;
      this.renderRequest$.next();
      return;
    }
    const shown = renderedTracksOf(this.trackRows());
    if (shown.join(',') === this.lastDrawnOriginalTracks) return;
    this.lastDrawnOriginalTracks = shown.join(',');
    this.alphaTabService.renderTracks(shown);
  }

  /** Plays each track muted and soloed as its row says (`AlphaTabService.setTrackPlayback`). */
  private applyTrackPlayback(): void {
    this.alphaTabService.setTrackPlayback(this.trackRows().map(row => ({ mute: row.muted, solo: row.soloed })));
  }

```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        this.lastLoadedOriginal = original;
        this.lastRenderedDoc = null;
        this.alphaTabService.loadBytes(original.bytes, ALL_TRACKS);
      }
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
        this.lastLoadedOriginal = original;
        this.lastRenderedDoc = null;
        this.lastDrawnOriginalTracks = '';
        this.alphaTabService.loadBytes(original.bytes, ALL_TRACKS);
      }
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
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
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
    try {
      const score = this.mapper.toScore(this.state.doc, new alphaTab.Settings());
      // The tracks the strip shows, explicitly: without indices alphaTab shows only the first, which hides all but one
      // staff on a multi-track score.
      this.alphaTabService.renderScore(score, renderedTracksOf(this.trackRows()));
      this.renderError = null;
    } catch (error) {
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

  /**
   * The staves drawn, read once per source: the document's (`staffSlotsOf`), or - in Original, where there is no
   * document behind what alphaTab drew - the file's (`staffSlotsOfScore`).
   */
  private slots(doc: ScoreDoc): StaffSlot[] {
    const original = this.gp.original;
    const source: unknown = original ? original.score : doc;
    let read = this.slotsRead;
    if (!read || read.source !== source) {
      read = this.slotsRead = { source, slots: original ? staffSlotsOfScore(original.score) : staffSlotsOf(doc) };
    }
    return read.slots;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

  /**
   * The staves drawn, read once per source and per set of tracks shown: the document's (`staffSlotsOf`), or - in
   * Original, where there is no document behind what alphaTab drew - the file's (`staffSlotsOfScore`).
   */
  private slots(doc: ScoreDoc): StaffSlot[] {
    const original = this.gp.original;
    const source: unknown = original ? original.score : doc;
    const shown = renderedTracksOf(this.trackRows());
    const drawn = shown.join(',');
    let read = this.slotsRead;
    if (!read || read.source !== source || read.drawn !== drawn) {
      read = this.slotsRead = { source, drawn, slots: original ? staffSlotsOfScore(original.score, shown) : staffSlotsOf(doc, shown) };
    }
    return read.slots;
```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
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
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
<section class="track-strip" aria-label="Tracks" *ngIf="state as s">
  <ul class="track-list">
    <!--
      The rows are the document's tracks in Composition and the file's in Original (`trackRowsOf`). Show / hide, mute and
      solo are on every row in both; what needs a document - the progression's badge, Update, Flatten and Remove - only
      on a composition's.
    -->
    <li
      *ngFor="let row of rows; let i = index; trackBy: trackByKey"
      class="track-item"
      [class.selected]="s.cursor.trackIndex === i"
      [class.hidden-track]="!row.shown"
      (click)="selectTrack(i)"
    >
      <span class="track-swatch" [style.background-color]="row.color"></span>
      <span class="track-name">{{ row.name }}</span>

      <span class="track-view">
        <!-- Pressed while shown. `aria-disabled` on the last row shown, as Remove refuses the last track. -->
        <button
          type="button"
          class="track-toggle track-shown"
          [attr.aria-pressed]="row.shown"
          [attr.aria-disabled]="hideRefused(row) ? 'true' : null"
          [attr.aria-label]="shownLabel(row)"
          [title]="shownLabel(row)"
          (click)="toggleShown(row); $event.stopPropagation()"
        >{{ row.shown ? '◉' : '○' }}</button>
        <button
          type="button"
          class="track-toggle track-mute"
          [attr.aria-pressed]="row.muted"
          [attr.aria-label]="'Mute ' + row.name"
          title="Mute"
          (click)="toggleMuted(row); $event.stopPropagation()"
        >M</button>
        <button
          type="button"
          class="track-toggle track-solo"
          [attr.aria-pressed]="row.soloed"
          [attr.aria-label]="'Solo ' + row.name"
          title="Solo"
          (click)="toggleSoloed(row); $event.stopPropagation()"
        >S</button>
      </span>

      <!--
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
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

      <!--
        `aria-disabled` rather than `disabled` on the last track, for the reason Update above uses it: a disabled button
        hides why from focus and from its tooltip. The press still reaches the service, which refuses and says why in
        the status line.
      -->
      <button
        type="button"
        class="track-remove"
        (click)="removeTrack(i); $event.stopPropagation()"
        [attr.aria-disabled]="s.doc.tracks.length <= 1 ? 'true' : null"
        [attr.aria-label]="removeLabel(track, s.doc.tracks.length)"
        [title]="removeTitle(s.doc.tracks.length)"
      >×</button>
    </li>
  </ul>
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
        label was the wrong and only place to keep it.
      -->
      <ng-container *ngIf="trackAt(i) as track">
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

        <!--
          `aria-disabled` rather than `disabled` on the last track, for the reason Update above uses it: a disabled button
          hides why from focus and from its tooltip. The press still reaches the service, which refuses and says why in
          the status line.
        -->
        <button
          type="button"
          class="track-remove"
          (click)="removeTrack(i); $event.stopPropagation()"
          [attr.aria-disabled]="s.doc.tracks.length <= 1 ? 'true' : null"
          [attr.aria-label]="removeLabel(track, s.doc.tracks.length)"
          [title]="removeTitle(s.doc.tracks.length)"
        >×</button>
      </ng-container>
    </li>
  </ul>
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
    -->
    <button
      class="text-btn add-progression-track"
      (click)="addProgressionTrack()"
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.html -->
```html
    -->
    <button
      *ngIf="!original"
      class="text-btn add-progression-track"
      (click)="addProgressionTrack()"
```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.scss`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.scss -->
```scss
}

.track-remove {
  margin-left: auto;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.scss -->
```scss
}

// Show / hide, mute and solo: flat, as the palette's tools are - no chrome, colour only on what is pressed.
.track-view {
  display: inline-flex;
  gap: 0.1rem;
  margin-left: 0.5rem;
}

.track-toggle {
  min-width: 1.4rem;
  padding: 0 0.25rem;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--composer-text-secondary, #bdc3c7);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;

  &:hover:not([aria-disabled='true']) {
    color: var(--composer-text, #ecf0f1);
  }

  &[aria-pressed='true'] {
    color: var(--composer-text, #ecf0f1);
  }

  &.track-mute[aria-pressed='true'] {
    background-color: var(--composer-warning, #e67e22);
  }

  &.track-solo[aria-pressed='true'] {
    background-color: var(--composer-accent, #3498db);
  }

  &[aria-disabled='true'] {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--composer-accent, #3498db);
    outline-offset: 1px;
  }
}

// A hidden track's row stays listed, dimmed, so it can be shown again.
.track-item.hidden-track .track-name {
  opacity: 0.5;
}

.track-remove {
  margin-left: auto;
```

`client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
import { ProgressionState } from '../../../../models/progression.model';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerGpService } from '../../../../services/composer-gp.service';
import { LAST_TRACK_REFUSAL } from '../../../../services/composer-text';
import { ProgressionService } from '../../../../services/progression.service';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
import { ProgressionState } from '../../../../models/progression.model';
import { ComposerService } from '../../../../services/composer.service';
import { ComposerGpService, GpOriginal } from '../../../../services/composer-gp.service';
import { EMPTY_TRACK_VIEW, TrackRow, TrackView, hideRefusalOf, trackRowsOf } from '../../../../services/composer-track-rows';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
import { LAST_TRACK_REFUSAL } from '../../../../services/composer-text';
import { ProgressionService } from '../../../../services/progression.service';
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts

  state: ComposerState | null = null;

  /**
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts

  state: ComposerState | null = null;
  /** The `.gp` file the page is showing, or null in Composition: its tracks are the rows then, with no document behind them. */
  original: GpOriginal | null = null;
  /** The rows the strip draws, in either state (`trackRowsOf`). */
  rows: TrackRow[] = [];
  private view: TrackView = EMPTY_TRACK_VIEW;

  /**
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    private readonly progression: ProgressionService,
    private readonly gp: ComposerGpService,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    private readonly progression: ProgressionService,
    private readonly gp: ComposerGpService,
    private readonly trackViews: ComposerTrackViewService,
    private readonly cdr: ChangeDetectorRef
  ) {}
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
      .subscribe(state => {
        this.state = state;
        this.cdr.markForCheck();
      });
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
      .subscribe(state => {
        this.state = state;
        this.readRows();
        this.cdr.markForCheck();
      });

    this.gp
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(original => {
        this.original = original;
        this.readRows();
        this.cdr.markForCheck();
      });

    this.trackViews
      .getView()
      .pipe(takeUntil(this.destroy$))
      .subscribe(view => {
        this.view = view;
        this.readRows();
        this.cdr.markForCheck();
      });
```

<!-- apply: find client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    this.destroy$.next();
    this.destroy$.complete();
  }

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-track-strip/composer-track-strip.component.ts -->
```ts
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The rows again, from the file in Original or the document in Composition, as the view shows them. */
  private readRows(): void {
    this.rows = this.original ? trackRowsOf(this.original.score, this.view) : this.state ? trackRowsOf(this.state.doc, this.view) : [];
  }

  /** The document's track behind a row, or null in Original, where the rows are the file's. */
  trackAt(index: number): TrackDoc | null {
    return this.original ? null : (this.state?.doc.tracks[index] ?? null);
  }

  /**
   * Shows or hides a row's staves: a page setting, never an edit, in either state (design decision 15). Hiding the last
   * row shown is refused, and says why in the status line as well as in the button's name.
   */
  toggleShown(row: TrackRow): void {
    const refusal = this.trackViews.toggleShown(this.rows, row.index);
    if (refusal) this.composer.announce(refusal, true);
  }

  /** Whether hiding `row` is refused: it is the last one shown (`hideRefusalOf`). */
  hideRefused(row: TrackRow): boolean {
    return hideRefusalOf(this.rows, row.index) !== null;
  }

  /** Show / hide's accessible name: the track's, and why it refuses while it is the last shown. */
  shownLabel(row: TrackRow): string {
    const refusal = hideRefusalOf(this.rows, row.index);
    const action = row.shown ? `Hide ${row.name}` : `Show ${row.name}`;
    return refusal ? `${action}, unavailable: ${refusal}` : action;
  }

  /** Mutes or unmutes a row: the player's in Original (decision 16), the composition's own mixer in Composition. */
  toggleMuted(row: TrackRow): void {
    if (this.original) this.trackViews.toggleMuted(row.key);
    else this.composer.setPlayback({ isMute: !row.muted }, row.index);
  }

  /** Solos a row, or takes its solo off, as `toggleMuted` does. */
  toggleSoloed(row: TrackRow): void {
    if (this.original) this.trackViews.toggleSoloed(row.key);
    else this.composer.setPlayback({ isSolo: !row.soloed }, row.index);
  }

  trackByKey(_index: number, row: TrackRow): string {
    return row.key;
  }

```

`client/src/app/services/alpha-tab.service.ts`:

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts
 */
export const ALL_TRACKS: readonly number[] = [-1];

/**
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts
 */
export const ALL_TRACKS: readonly number[] = [-1];

/** How the player sounds one track: muted, soloed, both or neither. */
export interface TrackPlayback {
  mute: boolean;
  solo: boolean;
}

/**
```

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts
    });

    // MIDI loaded: a render's `loadMidiFile` has stopped the player, so a note entry's audition can sound now.
    this.api.midiLoaded.on(() => {
      const audition = this.auditions.midiLoaded();
      if (audition) this.auditionNote(audition.midiKey, audition.program);
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts
    });

    // MIDI loaded: a render's `loadMidiFile` has stopped the player, so a note entry's audition can sound now. And the
    // mixer the page wants goes back on: a score alphaTab is given carries its mutes in `PlaybackInformation`, which the
    // player never reads - only `changeTrackMute` and `changeTrackSolo` reach it.
    this.api.midiLoaded.on(() => {
      this.applyTrackPlayback();
      const audition = this.auditions.midiLoaded();
      if (audition) this.auditionNote(audition.midiKey, audition.program);
```

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts


  /**
   * Mute/unmute a track
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts


  /** The mute and solo each track should play with, by index, kept and applied again after every MIDI load. */
  private trackPlayback: readonly TrackPlayback[] = [];

  /**
   * Plays each track of the score alphaTab holds muted or soloed as `states` say, by index, now and after every render
   * from here on (`midiLoaded`). The page's one mixer: the track strip's rows, in either state.
   */
  setTrackPlayback(states: readonly TrackPlayback[]): void {
    // Asked on every caret move by the score; the player is told only of a change.
    const same =
      states.length === this.trackPlayback.length &&
      states.every((state, index) => state.mute === this.trackPlayback[index].mute && state.solo === this.trackPlayback[index].solo);
    if (same) return;
    this.trackPlayback = states;
    this.applyTrackPlayback();
  }

  private applyTrackPlayback(): void {
    const score = this.api?.score;
    if (!this.api || !score) return;
    const tracksWhere = (test: (state: TrackPlayback) => boolean): alphaTab.model.Track[] =>
      score.tracks.filter((_, index) => test(this.trackPlayback[index] ?? { mute: false, solo: false }));
    this.api.changeTrackMute(tracksWhere(state => state.mute), true);
    this.api.changeTrackMute(tracksWhere(state => !state.mute), false);
    this.api.changeTrackSolo(tracksWhere(state => state.solo), true);
    this.api.changeTrackSolo(tracksWhere(state => !state.solo), false);
  }

  /**
   * Mute/unmute a track
```

`client/src/app/services/composer-score-interaction.ts`:

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts

/**
 * The staves alphaTab draws on one system, in render order, described from the document. alphaTab lays out
 * each track's staves in its default stave profile's order - slash, standard notation, numbered, tablature
 * (`Environment._createDefaultStaveProfiles`, ~75665 in 1.8), one bounds band each - and draws all of them again on
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts

/**
 * The staves alphaTab draws on one system, in render order, described from the document - over the tracks
 * `visibleTrackIndices` names, in the order `renderScore` was given them, or every track. alphaTab lays out
 * each track's staves in its default stave profile's order - slash, standard notation, numbered, tablature
 * (`Environment._createDefaultStaveProfiles`, ~75665 in 1.8), one bounds band each - and draws all of them again on
```

<!-- apply: find client/src/app/services/composer-score-interaction.ts -->
```ts
 * (`slotIndexAt` in `composer-score-systems.ts`), never by its index on the page.
 */
export function staffSlotsOf(doc: ScoreDoc): StaffSlot[] {
  return doc.tracks.flatMap((track, trackIndex) =>
    track.staves.flatMap((staff, staffIndex) => {
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
```

becomes

<!-- apply: replace client/src/app/services/composer-score-interaction.ts -->
```ts
 * (`slotIndexAt` in `composer-score-systems.ts`), never by its index on the page.
 */
export function staffSlotsOf(doc: ScoreDoc, visibleTrackIndices?: readonly number[]): StaffSlot[] {
  const drawn = visibleTrackIndices ?? doc.tracks.map((_, index) => index);
  return drawn.flatMap(trackIndex =>
    (doc.tracks[trackIndex]?.staves ?? []).flatMap((staff, staffIndex) => {
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
```

`client/src/app/services/composer-service-structure.ts`:

<!-- apply: find client/src/app/services/composer-service-structure.ts -->
```ts
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>): void {
    this.applyTrackEdit(false, (draft, t) => setPlayback(draft, t, changes));
  }

```

becomes

<!-- apply: replace client/src/app/services/composer-service-structure.ts -->
```ts
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>, trackIndex?: number): void {
    this.applyTrackEdit(false, (draft, t) => setPlayback(draft, trackIndex ?? t, changes));
  }

```

`client/src/app/services/composer-track-rows.ts`, new:

<!-- apply: create client/src/app/services/composer-track-rows.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { ScoreDoc } from '../models/composer.model';

/**
 * The track strip's rows, from what the page is showing: a composition's document, or - in the Original state - the
 * alphaTab `Score` of the `.gp` file, which has no document behind it (the GP-composer design, Part 5).
 *
 * One shape for both states, so the strip draws one list and M3's mixer lands on it. Pure, and named for what it returns.
 */

/** What the page keeps about the tracks beside the score itself: never part of a document, never an edit. */
export interface TrackView {
  /**
   * The tracks not drawn, by `TrackRow.key`. A page setting in both states (design decision 15): `TrackDoc` has no
   * visibility field, and alphaTab's own is not in the model.
   */
  hidden: ReadonlySet<string>;
  /**
   * In Original, the tracks the player mutes and solos, by key: the player's, not the file's (decision 16), since there
   * is no document to write them to. Unread in Composition, where a document's `PlaybackInfoDoc` holds both.
   */
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
}

/** Nothing hidden, muted or soloed. */
export const EMPTY_TRACK_VIEW: TrackView = { hidden: new Set(), muted: new Set(), soloed: new Set() };

export interface TrackRow {
  /** The track's index in its document or score. */
  index: number;
  /** What the view keeps it by: a composition's `TrackDoc.id`, which survives the tracks around it moving; a file's index. */
  key: string;
  name: string;
  /** A CSS colour. */
  color: string;
  shown: boolean;
  muted: boolean;
  soloed: boolean;
}

/** The rows `source` has, as `view` shows them. */
export function trackRowsOf(source: ScoreDoc | alphaTab.model.Score, view: TrackView): TrackRow[] {
  if (source instanceof alphaTab.model.Score) {
    return source.tracks.map((track, index) => {
      const key = String(index);
      return {
        index,
        key,
        name: track.name || `Track ${index + 1}`,
        color: track.color.rgba,
        shown: !view.hidden.has(key),
        muted: view.muted.has(key),
        soloed: view.soloed.has(key)
      };
    });
  }
  return source.tracks.map((track, index) => ({
    index,
    key: track.id,
    name: track.name,
    color: track.color,
    shown: !view.hidden.has(track.id),
    muted: track.playback.isMute,
    soloed: track.playback.isSolo
  }));
}

/** The indices of the rows drawn, in order: what `renderScore` and `api.renderTracks` are given. */
export function renderedTracksOf(rows: readonly TrackRow[]): number[] {
  return rows.filter(row => row.shown).map(row => row.index);
}

/** Why hiding the track at `index` is refused: a score draws at least one track. */
export const LAST_SHOWN_TRACK = 'At least one track is shown: show another before hiding this one.';

/** Why the row at `index` cannot be hidden, or null: it is the last one shown. Showing is never refused. */
export function hideRefusalOf(rows: readonly TrackRow[], index: number): string | null {
  const row = rows.find(candidate => candidate.index === index);
  if (!row?.shown) return null;
  return rows.filter(candidate => candidate.shown).length <= 1 ? LAST_SHOWN_TRACK : null;
}
```

`client/src/app/services/composer-track-view.service.ts`, new:

<!-- apply: create client/src/app/services/composer-track-view.service.ts -->
```ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type * as alphaTab from '@coderline/alphatab';

import { ComposerGpService } from './composer-gp.service';
import { ComposerService } from './composer.service';
import { EMPTY_TRACK_VIEW, TrackRow, TrackView, hideRefusalOf } from './composer-track-rows';

/**
 * What the page keeps about its tracks beside the score: which are hidden, and in Original which the player mutes and
 * solos (`TrackView`). The strip changes it and the score draws and plays from it, so it is a root service both read.
 *
 * It starts again whenever what the page shows changes: a file opening takes its mute and solo from what the file
 * itself declares, and another composition - a load, New, Convert - shows every track again.
 */
@Injectable({ providedIn: 'root' })
export class ComposerTrackViewService {
  private readonly subject = new BehaviorSubject<TrackView>(EMPTY_TRACK_VIEW);
  private documentId: number | null = null;

  constructor(gp: ComposerGpService, composer: ComposerService) {
    gp.getState().subscribe(original => this.subject.next(original ? viewOfFile(original.score) : EMPTY_TRACK_VIEW));
    composer.getState().subscribe(state => {
      if (this.documentId !== null && state.documentId !== this.documentId && !gp.isOriginal) this.subject.next(EMPTY_TRACK_VIEW);
      this.documentId = state.documentId;
    });
  }

  getView(): Observable<TrackView> {
    return this.subject.asObservable();
  }

  get view(): TrackView {
    return this.subject.getValue();
  }

  /** Shows the row at `index`, or hides it - or returns why not: it is the last one shown (`hideRefusalOf`). */
  toggleShown(rows: readonly TrackRow[], index: number): string | null {
    const row = rows.find(candidate => candidate.index === index);
    if (!row) return null;
    const refusal = hideRefusalOf(rows, index);
    if (refusal) return refusal;
    this.subject.next({ ...this.view, hidden: toggled(this.view.hidden, row.key) });
    return null;
  }

  /** The player's mute on the file's track `key`, in Original. */
  toggleMuted(key: string): void {
    this.subject.next({ ...this.view, muted: toggled(this.view.muted, key) });
  }

  /** The player's solo on the file's track `key`, in Original. */
  toggleSoloed(key: string): void {
    this.subject.next({ ...this.view, soloed: toggled(this.view.soloed, key) });
  }
}

/** A file as it opens: every track shown, and muted and soloed as the file itself declares. */
function viewOfFile(score: alphaTab.model.Score): TrackView {
  const keysWhere = (test: (track: alphaTab.model.Track) => boolean): Set<string> =>
    new Set(score.tracks.flatMap((track, index) => (test(track) ? [String(index)] : [])));
  return { hidden: new Set(), muted: keysWhere(track => track.playbackInfo.isMute), soloed: keysWhere(track => track.playbackInfo.isSolo) };
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
```

`client/src/app/services/composer.service.ts`:

<!-- apply: find client/src/app/services/composer.service.ts -->
```ts
  }

  setPlayback(changes: Partial<PlaybackInfoDoc>): void {
    this.structure.setPlayback(changes);
  }

```

becomes

<!-- apply: replace client/src/app/services/composer.service.ts -->
```ts
  }

  /** Changes the mixer of the track at `trackIndex` - the caret's, unless another is named, as the strip's mute and solo do. */
  setPlayback(changes: Partial<PlaybackInfoDoc>, trackIndex?: number): void {
    this.structure.setPlayback(changes, trackIndex);
  }

```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/components/composer-score/composer-score.component.spec.ts --include=src/app/components/composer/components/composer-track-strip/composer-track-strip.component.spec.ts --include=src/app/services/alpha-tab.service.spec.ts --include=src/app/services/composer-score-interaction.spec.ts --include=src/app/services/composer-track-rows.spec.ts --include=src/app/services/composer-track-view.service.spec.ts
```

Expected: `TOTAL: 101 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3523 SUCCESS`.

**Step 6: Commit.**

```text
feat: Show or hide, mute and solo every track, in both states

composer-track-rows.ts gives the strip one list of rows from a composition's
document or, in Original, the file's alphaTab score. Show / hide is a page
setting kept by ComposerTrackViewService; the score draws only the tracks
shown and its staves follow them. Mute and solo are the composition's own
mixer in Composition and the player's in Original, and AlphaTabService puts
them back on the player after every MIDI load, since it never reads a
score's own. Hiding the last track shown refuses and says why.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase G: Scale highlighting

Build step 9: built, not moved - the viewer's never marked a note.

### Task G.1: The scale panel and the note marks

Build step 9. The viewer's highlighter never marked a note: it queried `.at-note` and `data-note`, which
alphaTab 1.8 does not render. What replaces it is the composer's own overlay mechanism.

- `scale-highlight.ts`: `pitchClassesOf(config)` and `noteHighlightsOf(lookup, config)`, pure over the parts of the
  bounds lookup it reads, so a spec can hand it plain objects. A drum hit is never marked: its `realValue` is an
  articulation.
- `ComposerScalePanelComponent`: the highlighter's root and scale selectors, from `MusicTheoryService`'s catalogue, as a
  menu off the top bar (correction 15). Its first opening asks for note bounds - `AlphaTabService.setNoteBounds` - which
  cost a rectangle per note and stay off until then.
- The score rings each note head the highlight names, the root red and the rest blue, placed as the caret is
  (`StaffHitTestService.lookupRect`), after every render.

One spec renders a real score, as `composer-score-systems.spec.ts` does, to check the marks against alphaTab's own
`BeatBounds.notes`.

**Files** (under `client/src/app/` unless given in full):
- Create: `components/composer/components/composer-scale-panel/composer-scale-panel.component.html`, `components/composer/components/composer-scale-panel/composer-scale-panel.component.scss`, `components/composer/components/composer-scale-panel/composer-scale-panel.component.spec.ts`, `components/composer/components/composer-scale-panel/composer-scale-panel.component.ts`, `services/scale-highlight.spec.ts`, `services/scale-highlight.ts`
- Modify: `components/composer/components/composer-score/composer-score.component.html`, `components/composer/components/composer-score/composer-score.component.scss`, `components/composer/components/composer-score/composer-score.component.ts`, `components/composer/composer.component.html`, `components/composer/composer.component.spec.ts`, `components/composer/composer.component.ts`, `services/alpha-tab.service.ts`, `services/staff-hit-test.service.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.spec.ts`, new:

<!-- apply: create client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.spec.ts -->
```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerScalePanelComponent } from './composer-scale-panel.component';
import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

describe('ComposerScalePanelComponent', () => {
  let fixture: ComponentFixture<ComposerScalePanelComponent>;
  let panel: ComposerScalePanelComponent;
  let said: HighlightConfig[];
  let firstOpenings: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerScalePanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerScalePanelComponent);
    panel = fixture.componentInstance;
    said = [];
    firstOpenings = 0;
    panel.highlightChange.subscribe(config => said.push(config));
    panel.firstOpened.subscribe(() => firstOpenings++);
    fixture.detectChanges();
  });

  /** The first scale in the catalogue, as `MusicTheoryService` offers it. */
  const firstScale = () => {
    const item = TestBed.inject(MusicTheoryService).getUnifiedCategories()[0].items[0];
    return { id: item.id, name: item.name, intervals: item.intervals, type: item.type };
  };

  it("offers the music theory catalogue's scales and chords, grouped as it groups them", () => {
    const categories = TestBed.inject(MusicTheoryService).getUnifiedCategories();

    expect(panel.groups.map(group => group.name)).toEqual(categories.map(category => category.name));
  });

  it('says the highlight as a HighlightConfig once it is switched on and a scale is chosen, and says it off again', () => {
    const scale = firstScale();
    panel.enabled = true;
    panel.rootNote = 9;
    panel.scaleId = scale.id;
    panel.changed();

    expect(said.at(-1)).toEqual({ enabled: true, rootNote: 9, intervals: scale.intervals, name: `A ${scale.name}`, type: scale.type });

    panel.enabled = false;
    panel.changed();
    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('says nothing is highlighted while it is on with no scale chosen', () => {
    panel.enabled = true;
    panel.changed();

    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('reports its first opening once, for the page to turn note bounds on', () => {
    panel.toggleOpen();
    panel.toggleOpen();
    panel.toggleOpen();

    expect(firstOpenings).toBe(1);
  });

  it('closes on Escape, and keeps the Escape from the page', () => {
    panel.toggleOpen();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stop = spyOn(escape, 'stopPropagation').and.callThrough();

    panel.onKey(escape);

    expect(panel.open).toBeFalse();
    expect(stop).toHaveBeenCalled();
  });
});
```

`client/src/app/components/composer/composer.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {
  ignoredPresses = 0;

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {
  @Input() highlight: unknown = null;
  ignoredPresses = 0;

```

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts
    expect(component.popover).toBeNull();
    expect(document.querySelector(':popover-open')).toBeNull();
  });

  it('writes the shortcuts of Undo and Redo with the modifiers of the platform keyboard', () => {
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts
    expect(component.popover).toBeNull();
    expect(document.querySelector(':popover-open')).toBeNull();
  });

  it('asks alphaTab for note bounds the first time the scale panel opens, and passes its highlight to the score', () => {
    const noteBounds = spyOn(TestBed.inject(AlphaTabService), 'setNoteBounds');
    const toggle = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('app-composer-scale-panel .menu-toggle'))[0];

    toggle.click();
    toggle.click();
    toggle.click();
    fixture.detectChanges();

    expect(noteBounds.calls.allArgs()).toEqual([[true]]);
  });

  it('writes the shortcuts of Undo and Redo with the modifiers of the platform keyboard', () => {
```

`client/src/app/services/scale-highlight.spec.ts`, new:

<!-- apply: create client/src/app/services/scale-highlight.spec.ts -->
```ts
import * as alphaTab from '@coderline/alphatab';

import { HighlightConfig } from '../models/alpha-tab.model';
import { AlphaTexService } from './alpha-tex.service';
import { NoteBoundsSource, noteHighlightsOf, pitchClassesOf } from './scale-highlight';

describe('pitchClassesOf', () => {
  const aMinorPentatonic: HighlightConfig = { enabled: true, rootNote: 9, intervals: [0, 3, 5, 7, 10], name: 'A Minor Pentatonic', type: 'scale' };

  it('marks the root and the rest of the scale, wrapping past B', () => {
    expect([...pitchClassesOf(aMinorPentatonic)].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'inScale'],
      [2, 'inScale'],
      [4, 'inScale'],
      [7, 'inScale'],
      [9, 'root']
    ]);
  });

  it('marks nothing while the highlight is off', () => {
    expect(pitchClassesOf({ ...aMinorPentatonic, enabled: false }).size).toBe(0);
  });
});

describe('noteHighlightsOf', () => {
  const cMajorTriad: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 4, 7], name: 'C Major', type: 'chord' };

  /** One system, one master bar, one staff bar, one beat of `notes`: head x, the note's real value, and whether it is a drum. */
  function lookupOf(notes: readonly [number, number, boolean?][]): NoteBoundsSource {
    return {
      staffSystems: [
        {
          bars: [
            {
              bars: [
                {
                  beats: [
                    {
                      notes: notes.map(([x, realValue, isPercussion = false]) => ({
                        noteHeadBounds: { x, y: 20, w: 8, h: 6 },
                        note: { realValue, isPercussion }
                      }))
                    },
                    // A beat with no note bounds: `includeNoteBounds` was off when it was laid out.
                    { notes: null }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }

  it('marks each note head whose pitch class is in the chord, root apart, in any octave', () => {
    const lookup = lookupOf([
      [10, 60],
      [20, 64],
      [30, 66],
      [40, 43]
    ]);

    expect(noteHighlightsOf(lookup, cMajorTriad)).toEqual([
      { x: 10, y: 20, w: 8, h: 6, kind: 'root' },
      { x: 20, y: 20, w: 8, h: 6, kind: 'inScale' },
      { x: 40, y: 20, w: 8, h: 6, kind: 'inScale' }
    ]);
  });

  it('never marks a drum hit, whose value is an articulation rather than a pitch', () => {
    expect(noteHighlightsOf(lookupOf([[10, 36, true]]), cMajorTriad)).toEqual([]);
  });

  it('marks nothing while the highlight is off', () => {
    expect(noteHighlightsOf(lookupOf([[10, 60]]), { ...cMajorTriad, enabled: false })).toEqual([]);
  });
});

/**
 * Against what alphaTab really lays out: `BeatBounds.notes` exists only while `core.includeNoteBounds` is on, which is what
 * the scale panel's first opening turns on (`AlphaTabService.setNoteBounds`). Rendered on this thread, as
 * `composer-score-systems.spec.ts` renders.
 */
describe('noteHighlightsOf over a real render', () => {
  function lookupOf(includeNoteBounds: boolean): alphaTab.rendering.BoundsLookup | null {
    const settings = new alphaTab.Settings();
    settings.core.engine = 'svg';
    settings.core.useWorkers = false;
    settings.core.enableLazyLoading = false;
    settings.core.includeNoteBounds = includeNoteBounds;
    // C4 E4 G4 as a chord, then D4 and B3 on their own: three notes of C major's triad, two outside it.
    const { score } = new AlphaTexService().parse(['\\track "Piano"', '\\staff {score}', '(C4 E4 G4).4 D4.4 B3.2 |'].join('\n'));
    if (!score) throw new Error('the score did not parse');
    const renderer = new alphaTab.rendering.ScoreRenderer(settings);
    renderer.width = 800;
    renderer.renderScore(score, [0]);
    return renderer.boundsLookup;
  }

  const cMajorTriad: HighlightConfig = { enabled: true, rootNote: 0, intervals: [0, 4, 7], name: 'C Major', type: 'chord' };

  it('marks the chord tones alphaTab drew, each on its own note head', () => {
    const lookup = lookupOf(true);
    if (!lookup) throw new Error('nothing was laid out');

    const marks = noteHighlightsOf(lookup, cMajorTriad);

    expect(marks.map(mark => mark.kind).sort()).toEqual(['inScale', 'inScale', 'root']);
    expect(new Set(marks.map(mark => mark.y)).size).toBe(3);
    expect(marks.every(mark => mark.w > 0 && mark.h > 0)).toBeTrue();
  });

  it('has nothing to mark while note bounds are off, which is why the panel turns them on', () => {
    const lookup = lookupOf(false);
    if (!lookup) throw new Error('nothing was laid out');

    expect(noteHighlightsOf(lookup, cMajorTriad)).toEqual([]);
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 8 errors, the first:

```text
src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.spec.ts(3,45): error TS2307: Cannot find module './composer-scale-panel.component' or its corresponding type declarations.
```

**Step 3: The implementation.**

`client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.html`, new:

<!-- apply: create client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.html -->
```html
<!-- A menu off the top bar, as Library and Export are: hidden with CSS while closed. -->
<div class="menu" (keydown)="onKey($event)">
  <button
    #toggle
    type="button"
    class="text-btn menu-toggle"
    aria-controls="composer-scale-menu"
    [attr.aria-expanded]="open"
    [class.active]="enabled && summary"
    [title]="summary ? 'Highlighting ' + summary : 'Highlight a scale or chord'"
    (click)="toggleOpen()"
  >Scales</button>
  <div id="composer-scale-menu" class="menu-panel" [class.open]="open" role="group" aria-label="Scale highlighting">
    <label class="switch">
      <input type="checkbox" [(ngModel)]="enabled" (ngModelChange)="changed()" />
      <span>Highlight a scale or chord</span>
    </label>
    <label class="field">
      <span>Root</span>
      <select [(ngModel)]="rootNote" (ngModelChange)="changed()" [disabled]="!enabled">
        <option *ngFor="let name of rootNames; let i = index" [ngValue]="i">{{ name }}</option>
      </select>
    </label>
    <label class="field">
      <span>Scale or chord</span>
      <select [(ngModel)]="scaleId" (ngModelChange)="changed()" [disabled]="!enabled">
        <option value="">Choose…</option>
        <optgroup *ngFor="let group of groups" [label]="group.name">
          <option *ngFor="let option of group.options" [value]="option.id">{{ option.name }}</option>
        </optgroup>
      </select>
    </label>
    <p class="summary" *ngIf="summary">Highlighting {{ summary }}: the root in red, the rest in blue.</p>
  </div>
</div>
```

`client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.scss`, new:

<!-- apply: create client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.scss -->
```scss
// The scale menu, off the top bar: as the Library and Export menus, hidden with CSS while closed.

.menu {
  position: relative;
}

.menu-panel {
  display: none;
  position: absolute;
  top: calc(100% + 0.3rem);
  right: 0;
  z-index: 60;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 15rem;
  padding: 0.6rem;
  background-color: var(--composer-nav, #2c3e50);
  color: var(--composer-text, #ecf0f1);
  border: 1px solid var(--composer-border, #465666);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);

  &.open {
    display: flex;
  }
}

.switch,
.field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
}

.field {
  justify-content: space-between;

  select {
    max-width: 10rem;
    background-color: var(--composer-nav-hover, #34495e);
    color: var(--composer-text, #ecf0f1);
    border: 1px solid var(--composer-border, #465666);
    border-radius: 3px;
  }
}

.summary {
  margin: 0;
  font-size: 0.75rem;
  color: var(--composer-text-secondary, #bdc3c7);
}

.text-btn {
  padding: 0.3rem 0.6rem;
  background: none;
  border: none;
  color: var(--composer-text-secondary, #bdc3c7);
  cursor: pointer;

  &:hover,
  &.active {
    color: var(--composer-text, #ecf0f1);
  }

  &:focus-visible {
    outline: 2px solid var(--composer-accent, #3498db);
    outline-offset: 1px;
  }
}
```

`client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.ts`, new:

<!-- apply: create client/src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.ts -->
```ts
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

/** A scale or chord the panel offers, from `MusicTheoryService`'s catalogue. */
interface ScaleOption {
  id: string;
  name: string;
  intervals: number[];
  type: 'scale' | 'chord';
}

/** The catalogue's groups, as the panel's `<optgroup>`s. */
interface ScaleGroup {
  name: string;
  options: ScaleOption[];
}

/** Each pitch class by both of its names, sharp first, as the note selectors elsewhere in the app say them. */
const ROOT_NAMES: readonly string[] = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

/**
 * The scale panel: highlight a scale or chord's notes on the score, in either state (the GP-composer design, decision 9).
 *
 * The viewer's highlighter's selectors, moved - its root and its scale or chord, from `MusicTheoryService`'s catalogue
 * (`getUnifiedCategories`) - in a menu off the top bar, like the Library and Export menus, so it takes no row from the
 * score or the strip. It says what it highlights as a `HighlightConfig`; the page hands that to the score, which marks
 * the notes (`scale-highlight.ts`). Its first opening is reported (`firstOpened`), since that is when the page asks
 * alphaTab for note bounds, which cost a rectangle per note and are off until then.
 */
@Component({
  selector: 'app-composer-scale-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-scale-panel.component.html',
  styleUrls: ['./composer-scale-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerScalePanelComponent {
  @Output() readonly highlightChange = new EventEmitter<HighlightConfig>();
  /** The first time the panel opens, and never again. */
  @Output() readonly firstOpened = new EventEmitter<void>();

  @ViewChild('toggle') private toggle?: ElementRef<HTMLButtonElement>;

  readonly rootNames = ROOT_NAMES;
  readonly groups: readonly ScaleGroup[];

  open = false;
  enabled = false;
  rootNote = 0;
  scaleId = '';
  private opened = false;

  constructor(
    musicTheory: MusicTheoryService,
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.groups = musicTheory.getUnifiedCategories().map(category => ({
      name: category.name,
      options: category.items.map(item => ({ id: item.id, name: item.name, intervals: item.intervals, type: item.type }))
    }));
  }

  /** The scale or chord chosen, or undefined. */
  private get chosen(): ScaleOption | undefined {
    return this.groups.flatMap(group => group.options).find(option => option.id === this.scaleId);
  }

  /** What the panel highlights, in words: "A Minor Pentatonic", or empty while nothing is. */
  get summary(): string {
    const chosen = this.chosen;
    return this.enabled && chosen ? `${ROOT_NAMES[this.rootNote]} ${chosen.name}` : '';
  }

  toggleOpen(): void {
    this.open = !this.open;
    if (this.open && !this.opened) {
      this.opened = true;
      this.firstOpened.emit();
    }
  }

  /** Any change - the switch, the root, the scale - says the highlight again. */
  changed(): void {
    const chosen = this.chosen;
    this.highlightChange.emit({
      enabled: this.enabled && chosen !== undefined,
      rootNote: Number(this.rootNote),
      intervals: chosen?.intervals.slice() ?? [],
      name: this.summary,
      type: chosen?.type ?? 'scale'
    });
  }

  /** Escape closes the menu and gives the focus to its button; the page's own Escape stands aside. */
  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.open) return;
    event.stopPropagation();
    this.open = false;
    this.toggle?.nativeElement.focus();
  }

  /** A click outside the menu closes it, as the Library and Export menus close. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open || (event.target instanceof Node && this.host.nativeElement.contains(event.target))) return;
    this.open = false;
    this.cdr.markForCheck();
  }
}
```

`client/src/app/components/composer/components/composer-score/composer-score.component.html`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.html -->
```html
      [style.width.px]="caretRect.width"
      [style.height.px]="caretRect.height"
    ></div>
    <!-- Pen's hover notehead: where a click would write. Rendering only. -->
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.html -->
```html
      [style.width.px]="caretRect.width"
      [style.height.px]="caretRect.height"
    ></div>
    <!-- The scale panel's highlight: a ring on each note head it names, the root in red and the rest in blue. -->
    <div
      *ngFor="let mark of noteMarks"
      class="scale-mark"
      aria-hidden="true"
      [class.root]="mark.kind === 'root'"
      [style.left.px]="mark.left"
      [style.top.px]="mark.top"
      [style.width.px]="mark.width"
      [style.height.px]="mark.height"
    ></div>
    <!-- Pen's hover notehead: where a click would write. Rendering only. -->
```

`client/src/app/components/composer/components/composer-score/composer-score.component.scss`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.scss -->
```scss
  font-size: 0.85rem;
}

```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.scss -->
```scss
  font-size: 0.85rem;
}

// A note head the scale panel names: in-scale in blue, the root in red, drawn over the engraving and never taking a press.
.scale-mark {
  position: absolute;
  z-index: 2;
  box-sizing: content-box;
  margin: -2px 0 0 -2px;
  border: 2px solid var(--composer-in-scale, #3498db);
  border-radius: 50%;
  pointer-events: none;

  &.root {
    border-color: var(--composer-root, #e74c3c);
  }
}

```

`client/src/app/components/composer/components/composer-score/composer-score.component.ts`:

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  Component,
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { TrackView, renderedTracksOf, trackRowsOf } from '../../../../services/composer-track-rows';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
import { ALL_TRACKS, AlphaTabService } from '../../../../services/alpha-tab.service';
import { TrackView, renderedTracksOf, trackRowsOf } from '../../../../services/composer-track-rows';
import { DEFAULT_HIGHLIGHT_CONFIG, HighlightConfig } from '../../../../models/alpha-tab.model';
import { HighlightKind, noteHighlightsOf } from '../../../../services/scale-highlight';
import { ComposerTrackViewService } from '../../../../services/composer-track-view.service';
import { ASKING_PAGE_COMMANDS } from '../../../../services/composer-edit-intent';
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  /** Caret box drawn over the staff, in container-relative pixels. */
  caretRect: Rect | null = null;
  /** Pen's hover notehead, in container-relative pixels, or null. */
  hoverRect: Rect | null = null;
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
  /** Caret box drawn over the staff, in container-relative pixels. */
  caretRect: Rect | null = null;
  /**
   * The scale panel's highlight (`ComposerScalePanelComponent`), and the note heads it marks on the page, drawn over the
   * engraving as the caret is and redrawn with it after every render.
   */
  @Input() set highlight(config: HighlightConfig | null) {
    this.highlightConfig = config ?? DEFAULT_HIGHLIGHT_CONFIG;
    this.updateScaleOverlay();
  }
  private highlightConfig: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG;
  noteMarks: (Rect & { kind: HighlightKind })[] = [];
  /** Pen's hover notehead, in container-relative pixels, or null. */
  hoverRect: Rect | null = null;
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
      this.drawHighlight();
      this.scheduleCaretUpdate();
    });
    this.observeSurface(element);
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts
      this.drawHighlight();
      this.scheduleCaretUpdate();
      this.updateScaleOverlay();
    });
    this.observeSurface(element);
```

<!-- apply: find client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

  /**
   * Measures the caret box from state: its slot (`caretSlotIndexOf`), drawn on the system that holds its beat
   * (`measuredStaffOfSlot`), its beat, and its string or pitch - or, on a numbered staff, which has no lines, in the
```

becomes

<!-- apply: replace client/src/app/components/composer/components/composer-score/composer-score.component.ts -->
```ts

  /**
   * Marks the note heads the scale panel's highlight names (`noteHighlightsOf`), from the bounds lookup of what alphaTab
   * drew - the file's in Original, the document's in Composition - or none while it is off or the lookup is not ready.
   */
  private updateScaleOverlay(): void {
    const element = this.alphaTabContainer?.nativeElement;
    const lookup = this.alphaTabService.getBoundsLookup();
    const marks = element && lookup && !this.boundsPending ? noteHighlightsOf(lookup, this.highlightConfig) : [];
    this.noteMarks = marks.flatMap(mark => {
      const rect = element ? this.hitTest.lookupRect(element, mark.x, mark.y, mark.w, mark.h) : null;
      return rect ? [{ ...rect, kind: mark.kind }] : [];
    });
    this.cdr.markForCheck();
  }

  /**
   * Measures the caret box from state: its slot (`caretSlotIndexOf`), drawn on the system that holds its beat
   * (`measuredStaffOfSlot`), its beat, and its string or pitch - or, on a numbered staff, which has no lines, in the
```

`client/src/app/components/composer/composer.component.html`:

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
        alphaTex
      </button>
      <app-composer-library-panel [modalOpen]="modalOpen" (menuOpened)="closePopover()"></app-composer-library-panel>
      <button
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
        alphaTex
      </button>
      <app-composer-scale-panel (firstOpened)="onScalePanelOpened()" (highlightChange)="highlight = $event"></app-composer-scale-panel>
      <app-composer-library-panel [modalOpen]="modalOpen" (menuOpened)="closePopover()"></app-composer-library-panel>
      <button
```

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
  <div class="score-column" [attr.inert]="modalOpen ? '' : null">
    <!-- Focusable by script only, for the shortcut sheet to give the focus back to. -->
    <app-composer-score #score tabindex="-1"></app-composer-score>

    <section #texPanel class="tex-panel" *ngIf="showTexPanel">
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
  <div class="score-column" [attr.inert]="modalOpen ? '' : null">
    <!-- Focusable by script only, for the shortcut sheet to give the focus back to. -->
    <app-composer-score #score tabindex="-1" [highlight]="highlight"></app-composer-score>

    <section #texPanel class="tex-panel" *ngIf="showTexPanel">
```

`client/src/app/components/composer/composer.component.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerConvertPromptComponent } from './components/composer-convert-prompt/composer-convert-prompt.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerConvertPromptComponent } from './components/composer-convert-prompt/composer-convert-prompt.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScalePanelComponent } from './components/composer-scale-panel/composer-scale-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerStatusLineComponent } from './components/composer-status-line/composer-status-line.component';
import { ComposerTrackStripComponent } from './components/composer-track-strip/composer-track-strip.component';
import { AlphaTabState } from '../../models/alpha-tab.model';
import { ComposerState, ScoreDoc, TexDiagnostic } from '../../models/composer.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { ComposerStatusLineComponent } from './components/composer-status-line/composer-status-line.component';
import { ComposerTrackStripComponent } from './components/composer-track-strip/composer-track-strip.component';
import { AlphaTabState, DEFAULT_HIGHLIGHT_CONFIG, HighlightConfig } from '../../models/alpha-tab.model';
import { ComposerState, ScoreDoc, TexDiagnostic } from '../../models/composer.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
    ComposerScoreComponent,
    ComposerShortcutSheetComponent,
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
    ComposerLibraryPanelComponent,
    ComposerPaletteComponent,
    ComposerScalePanelComponent,
    ComposerScoreComponent,
    ComposerShortcutSheetComponent,
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
   */
  texErrorId = 0;

  metronomeEnabled = false;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
   */
  texErrorId = 0;

  /** The scale panel's highlight, which the score draws, in either state. */
  highlight: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG;

  metronomeEnabled = false;
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  /** The scale panel opened for the first time: note bounds from here on, for the highlight to read. */
  onScalePanelOpened(): void {
    this.alphaTabService.setNoteBounds(true);
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
```

`client/src/app/services/alpha-tab.service.ts`:

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts


  /** The mute and solo each track should play with, by index, kept and applied again after every MIDI load. */
  private trackPlayback: readonly TrackPlayback[] = [];
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts


  /**
   * Turns alphaTab's note bounds on or off and lays the score out again: `BeatBounds.notes` in the bounds lookup, which
   * the scale panel's highlight reads. Off by default - a rectangle per note, and the beat is the unit of selection - and
   * turned on by the panel's first opening, for the life of the page.
   */
  setNoteBounds(on: boolean): void {
    if (!this.api || this.api.settings.core.includeNoteBounds === on) return;
    this.api.settings.core.includeNoteBounds = on;
    this.api.updateSettings();
    this.api.render();
  }

  /** The mute and solo each track should play with, by index, kept and applied again after every MIDI load. */
  private trackPlayback: readonly TrackPlayback[] = [];
```

`client/src/app/services/scale-highlight.ts`, new:

<!-- apply: create client/src/app/services/scale-highlight.ts -->
```ts
import { HighlightConfig } from '../models/alpha-tab.model';
import { reduceToOctave } from './note-spelling';

/**
 * Which drawn notes a scale or chord highlight marks, and where: the composer's scale panel (the GP-composer design,
 * Part 5, "The scale panel").
 *
 * Built rather than moved. The viewer's highlighter queried `.at-note` elements and a `data-note` attribute, and alphaTab
 * 1.8 renders neither, so it never marked a note. What replaces it is the mechanism the composer already owns for its
 * caret: rectangles drawn over the engraving from alphaTab's bounds lookup, which carries each note's head
 * (`BeatBounds.notes`) once `core.includeNoteBounds` is on. Pure, over the parts of the lookup it reads, so a spec can
 * hand it plain objects; the score measures the page and draws what this returns.
 */

/** How a highlighted note is marked: the root, in red, or another note of the scale, in blue (`CLAUDE.md`'s colours). */
export type HighlightKind = 'root' | 'inScale';

/** A note head to mark, in the bounds lookup's pixels: from the top left of alphaTab's `.at-surface`. */
export interface NoteHighlight {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: HighlightKind;
}

/** The parts of alphaTab's `BoundsLookup` this reads: systems, their master bars, each staff's bars, beats, and note heads. */
export interface NoteBoundsSource {
  staffSystems: readonly {
    bars: readonly {
      bars: readonly {
        beats: readonly {
          notes: readonly {
            noteHeadBounds: { x: number; y: number; w: number; h: number };
            note: { realValue: number; isPercussion: boolean };
          }[] | null;
        }[];
      }[];
    }[];
  }[];
}

/** The pitch classes `config` marks, each as the root or a note of its scale - none while it is off. */
export function pitchClassesOf(config: HighlightConfig): ReadonlyMap<number, HighlightKind> {
  if (!config.enabled) return new Map();
  const marked = new Map<number, HighlightKind>();
  for (const interval of config.intervals) marked.set(reduceToOctave(config.rootNote + interval), 'inScale');
  marked.set(reduceToOctave(config.rootNote), 'root');
  return marked;
}

/**
 * Every drawn note head `config` marks. A note's pitch class is its `realValue` - the pitch it sounds - reduced to the
 * octave. A drum hit is never marked: its `realValue` is its articulation's number, not a pitch.
 */
export function noteHighlightsOf(lookup: NoteBoundsSource, config: HighlightConfig): NoteHighlight[] {
  const marked = pitchClassesOf(config);
  if (marked.size === 0) return [];
  const highlights: NoteHighlight[] = [];
  for (const system of lookup.staffSystems) {
    for (const masterBar of system.bars) {
      for (const bar of masterBar.bars) {
        for (const beat of bar.beats) {
          for (const { noteHeadBounds: head, note } of beat.notes ?? []) {
            if (note.isPercussion) continue;
            const kind = marked.get(reduceToOctave(note.realValue));
            if (kind) highlights.push({ x: head.x, y: head.y, w: head.w, h: head.h, kind });
          }
        }
      }
    }
  }
  return highlights;
}
```

`client/src/app/services/staff-hit-test.service.ts`:

<!-- apply: find client/src/app/services/staff-hit-test.service.ts -->
```ts
  }

  /** `surface`'s box, measured once per call that holds `boxes`. */
  private boxOf(boxes: Map<SVGSVGElement, DOMRect>, surface: SVGSVGElement): DOMRect {
```

becomes

<!-- apply: replace client/src/app/services/staff-hit-test.service.ts -->
```ts
  }

  /**
   * A box given in the bounds lookup's pixels (from the top of `.at-surface`) - a note head's - placed in `container`, as
   * the caret's is. Null before a surface exists.
   */
  lookupRect(container: HTMLElement, x: number, y: number, w: number, h: number): Rect | null {
    const origin = this.surfaceOriginOf(container);
    if (!origin) return null;
    const containerBox = container.getBoundingClientRect();
    return { left: origin.left - containerBox.left + x, top: origin.top - containerBox.top + y + container.scrollTop, width: w, height: h };
  }

  /** `surface`'s box, measured once per call that holds `boxes`. */
  private boxOf(boxes: Map<SVGSVGElement, DOMRect>, surface: SVGSVGElement): DOMRect {
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/components/composer-scale-panel/composer-scale-panel.component.spec.ts --include=src/app/components/composer/composer.component.spec.ts --include=src/app/services/scale-highlight.spec.ts
```

Expected: `TOTAL: 76 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3536 SUCCESS`.

**Step 6: Commit.**

```text
feat: Highlight a scale or chord's notes on the score, in both states

The viewer's highlighter never marked a note: it looked for .at-note and
data-note, which alphaTab 1.8 does not render. The composer's Scales menu
keeps its root and scale choices from the music theory catalogue, and the
score rings each note head the highlight names - the root in red, the rest
in blue - from alphaTab's note bounds, redrawn after every render. The
menu's first opening turns note bounds on, for the life of the page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase H: The transport

Build step 10: the viewer's loop, speed, volume and seek bar.

### Task H.1: The viewer's transport

Build step 10: loop, a speed from 25 to 200 percent - labelled apart from the BPM, since the viewer called
its multiplier "Tempo" and it is not the score's tempo - volume, and a seek bar with an `m:ss / m:ss` readout, all
through `AlphaTabService`, in both states.

The seek bar is an `<input type="range">`, which the keyboard reaches and a screen reader names. So the key handler has
to leave a focused slider the keys that move it: `movesFocusedSlider` - an arrow, Home, End, Page Up or Page Down with no
modifier - while Space still plays and Ctrl+→ still moves a bar. M3's mixer meets the same rule.

**Files** (under `client/src/app/` unless given in full):
- Create: `services/transport-time.spec.ts`, `services/transport-time.ts`
- Modify: `components/composer/composer.component.html`, `components/composer/composer.component.scss`, `components/composer/composer.component.spec.ts`, `components/composer/composer.component.ts`, `services/composer-key-handler.spec.ts`, `services/composer-key-handler.ts`, `services/editable-target.spec.ts`, `services/editable-target.ts`

**Step 1: The failing specs.**

`client/src/app/components/composer/composer.component.spec.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.spec.ts -->
```ts

    expect(noteBounds.calls.allArgs()).toEqual([[true]]);
  });

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.spec.ts -->
```ts

    expect(noteBounds.calls.allArgs()).toEqual([[true]]);
  });

  it("runs the viewer's transport through the player: loop, speed as a percentage, volume and the seek bar", () => {
    const player = TestBed.inject(AlphaTabService);
    const looping = spyOn(player, 'setLooping');
    const speed = spyOn(player, 'setPlaybackSpeed');
    const volume = spyOn(player, 'setVolume');
    const seek = spyOn(player, 'seekToTime');
    const host = fixture.nativeElement as HTMLElement;
    const sliders = Array.from(host.querySelectorAll<HTMLInputElement>('.transport input[type="range"]'));
    const set = (input: HTMLInputElement, value: string): void => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    Array.from(host.querySelectorAll<HTMLButtonElement>('.transport .toggle-btn')).find(button => button.textContent?.trim() === 'Loop')!.click();
    set(sliders[0], '150');
    set(sliders[1], '40');

    expect(looping).toHaveBeenCalledWith(true);
    expect(speed).toHaveBeenCalledWith(1.5);
    expect(volume).toHaveBeenCalledWith(0.4);
    expect(sliders[0].min).toBe('25');
    expect(sliders[0].max).toBe('200');

    player.getState().next({ ...player.getState().getValue(), timePosition: 65_000, totalDuration: 200_000 });
    fixture.detectChanges();
    set(sliders[2], '30000');
    expect(seek).toHaveBeenCalledWith(30000);
    expect(host.querySelector('.time-readout')?.textContent?.trim()).toBe('1:05 / 3:20');
  });

```

`client/src/app/services/composer-key-handler.spec.ts`:

<!-- apply: find client/src/app/services/composer-key-handler.spec.ts -->
```ts
    expect(composer.doc).not.toBe(doc);
  });
});

```

becomes

<!-- apply: replace client/src/app/services/composer-key-handler.spec.ts -->
```ts
    expect(composer.doc).not.toBe(doc);
  });

  it("leaves an arrow on a focused slider to the slider, and plays on Space there", () => {
    const slider = Object.assign(document.createElement('input'), { type: 'range' });
    const before = composer.state.cursor;

    expect(handler.handle(press({ key: 'ArrowRight', target: slider }))).toBeFalse();
    expect(composer.state.cursor).toBe(before);

    expect(handler.handle(press({ key: ' ', target: slider }))).toBeTrue();
    expect(host.playPause).toHaveBeenCalled();
  });
});

```

`client/src/app/services/editable-target.spec.ts`:

<!-- apply: find client/src/app/services/editable-target.spec.ts -->
```ts
import { isEditableTarget, pressesFocusedControl } from './editable-target';

describe('isEditableTarget', () => {
```

becomes

<!-- apply: replace client/src/app/services/editable-target.spec.ts -->
```ts
import { isEditableTarget, movesFocusedSlider, pressesFocusedControl } from './editable-target';

describe('isEditableTarget', () => {
```

<!-- apply: find client/src/app/services/editable-target.spec.ts -->
```ts
    expect(keysPressing(keyboardFocused('div', div => div.setAttribute('role', 'tab')))).toEqual([]);
  });
});

```

becomes

<!-- apply: replace client/src/app/services/editable-target.spec.ts -->
```ts
    expect(keysPressing(keyboardFocused('div', div => div.setAttribute('role', 'tab')))).toEqual([]);
  });
});

describe('movesFocusedSlider', () => {
  const slider = (): HTMLInputElement => Object.assign(document.createElement('input'), { type: 'range' });
  const on = (target: EventTarget, key: string, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>> = {}) =>
    movesFocusedSlider({ key, ctrlKey: false, altKey: false, metaKey: false, target, ...modifiers });

  it("takes the keys a range slider moves itself with, and only on a range slider", () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(on(slider(), key)).withContext(key).toBeTrue();
    }
    expect(on(document.createElement('button'), 'ArrowLeft')).toBeFalse();
    expect(on(Object.assign(document.createElement('input'), { type: 'checkbox' }), 'ArrowLeft')).toBeFalse();
  });

  it("leaves every other key on a slider to the page: Space plays, and Ctrl+→ moves a bar", () => {
    expect(on(slider(), ' ')).toBeFalse();
    expect(on(slider(), 'h')).toBeFalse();
    expect(on(slider(), 'ArrowRight', { ctrlKey: true })).toBeFalse();
  });

  it('still counts a range slider as not typed into, so the page keeps its other keys', () => {
    expect(isEditableTarget(slider())).toBeFalse();
  });
});

```

`client/src/app/services/transport-time.spec.ts`, new:

<!-- apply: create client/src/app/services/transport-time.spec.ts -->
```ts
import { clockTimeOf } from './transport-time';

describe('clockTimeOf', () => {
  it('writes minutes and two-digit seconds, rounding down to the second', () => {
    expect(clockTimeOf(0)).toBe('0:00');
    expect(clockTimeOf(65_999)).toBe('1:05');
    expect(clockTimeOf(600_000)).toBe('10:00');
  });

  it('never goes below zero', () => {
    expect(clockTimeOf(-500)).toBe('0:00');
  });
});
```

**Step 2: Watch them fail.** `npx tsc -p tsconfig.spec.json --noEmit` fails with 2 errors, the first:

```text
src/app/services/editable-target.spec.ts(1,28): error TS2305: Module '"./editable-target"' has no exported member 'movesFocusedSlider'.
```

**Step 3: The implementation.**

`client/src/app/components/composer/composer.component.html`:

<!-- apply: find client/src/app/components/composer/composer.component.html -->
```html
        Count-in
      </button>
    </div>

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.html -->
```html
        Count-in
      </button>
      <button
        class="toggle-btn"
        type="button"
        [class.active]="playerState?.isLooping"
        [attr.aria-pressed]="playerState?.isLooping ?? false"
        (click)="toggleLoop()"
      >Loop</button>

      <!-- A playback multiplier, labelled apart from the BPM: the viewer called it "Tempo", and it is not the score's tempo. -->
      <label class="slider-field">
        <span>Speed</span>
        <input
          type="range"
          [min]="speedRange.min"
          [max]="speedRange.max"
          [step]="speedRange.step"
          [value]="speedPercent"
          [attr.aria-valuetext]="speedPercent + '%'"
          (input)="onSpeedInput($any($event.target).value)"
        />
        <output>{{ speedPercent }}%</output>
      </label>
      <label class="slider-field">
        <span>Volume</span>
        <input
          type="range"
          min="0"
          max="100"
          [value]="volumePercent"
          [attr.aria-valuetext]="volumePercent + '%'"
          (input)="onVolumeInput($any($event.target).value)"
        />
      </label>
      <!-- A range, not the viewer's clickable div: the keyboard reaches it and a screen reader names it. -->
      <label class="slider-field seek-field">
        <span class="visually-hidden">Position</span>
        <input
          type="range"
          min="0"
          [max]="playerState?.totalDuration ?? 0"
          [value]="playerState?.timePosition ?? 0"
          [attr.aria-valuetext]="timeReadout"
          (input)="onSeekInput($any($event.target).value)"
        />
        <output class="time-readout">{{ timeReadout }}</output>
      </label>
    </div>

```

`client/src/app/components/composer/composer.component.scss`:

<!-- apply: find client/src/app/components/composer/composer.component.scss -->
```scss
  align-items: center;
  gap: 0.4rem;
}

```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.scss -->
```scss
  align-items: center;
  gap: 0.4rem;
}

.slider-field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--composer-text-secondary);

  input[type='range'] {
    width: 5.5rem;
    accent-color: var(--composer-accent, #3498db);
  }

  output {
    min-width: 2.6rem;
    font-variant-numeric: tabular-nums;
  }
}

.seek-field input[type='range'] {
  width: 9rem;
}

.time-readout {
  min-width: 5.5rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

```

`client/src/app/components/composer/composer.component.ts`:

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, PopoverKind, shortcutTitleOf } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';

/** What the status line says when a save meets an alphaTex draft that has been edited and not applied. */
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, PopoverKind, shortcutTitleOf } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';
import { SPEED_RANGE, clockTimeOf } from '../../services/transport-time';

/** What the status line says when a save meets an alphaTex draft that has been edited and not applied. */
```

<!-- apply: find client/src/app/components/composer/composer.component.ts -->
```ts
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
```

becomes

<!-- apply: replace client/src/app/components/composer/composer.component.ts -->
```ts
  }

  // -------------------------------------------------------------------------
  // The rest of the transport: loop, speed, volume and the seek bar - the viewer's, in both states (design decision 10)
  // -------------------------------------------------------------------------

  readonly speedRange = SPEED_RANGE;

  toggleLoop(): void {
    this.alphaTabService.setLooping(!(this.playerState?.isLooping ?? false));
  }

  /** Speed, as a percentage of the score's own tempo: a playback multiplier, never the BPM, which is the score's. */
  get speedPercent(): number {
    return Math.round((this.playerState?.tempoMultiplier ?? 1) * 100);
  }

  onSpeedInput(value: string): void {
    this.alphaTabService.setPlaybackSpeed(Number(value) / 100);
  }

  get volumePercent(): number {
    return Math.round((this.playerState?.volume ?? 1) * 100);
  }

  onVolumeInput(value: string): void {
    this.alphaTabService.setVolume(Number(value) / 100);
  }

  onSeekInput(value: string): void {
    this.alphaTabService.seekToTime(Number(value));
  }

  /** Where playback is and how long the score plays, as `1:05 / 3:20`. */
  get timeReadout(): string {
    return `${clockTimeOf(this.playerState?.timePosition ?? 0)} / ${clockTimeOf(this.playerState?.totalDuration ?? 0)}`;
  }

  toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled;
```

`client/src/app/services/composer-key-handler.ts`:

<!-- apply: find client/src/app/services/composer-key-handler.ts -->
```ts
import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
```

becomes

<!-- apply: replace client/src/app/services/composer-key-handler.ts -->
```ts
import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget, movesFocusedSlider } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
```

<!-- apply: find client/src/app/services/composer-key-handler.ts -->
```ts
      return true;
    }
    if (isEditableTarget(event.target) && !tool.inTextFields) return false;
    if (tool.yieldsToTextSelection && textSelectedOutside(this.scoreElement())) return false;

```

becomes

<!-- apply: replace client/src/app/services/composer-key-handler.ts -->
```ts
      return true;
    }
    if ((isEditableTarget(event.target) || movesFocusedSlider(event)) && !tool.inTextFields) return false;
    if (tool.yieldsToTextSelection && textSelectedOutside(this.scoreElement())) return false;

```

`client/src/app/services/editable-target.ts`:

<!-- apply: find client/src/app/services/editable-target.ts -->
```ts
/** The input types text is typed into. `HTMLInputElement.type` reads `text` for a missing or unknown type. */
const TYPED_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

/**
```

becomes

<!-- apply: replace client/src/app/services/editable-target.ts -->
```ts
/** The input types text is typed into. `HTMLInputElement.type` reads `text` for a missing or unknown type. */
const TYPED_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

/** The keys a focused range slider moves itself with. */
const SLIDER_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Whether a key press moves a focused range slider - the transport's seek bar, speed and volume, and M3's mixer - and so
 * is the slider's rather than the page's: an arrow, Home, End, Page Up or Page Down with no Ctrl, Alt or Cmd. Every other
 * key on a slider stays the page's, as `isEditableTarget` leaves it: Space still plays, and Ctrl+→ still moves a bar.
 */
export function movesFocusedSlider(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target'>): boolean {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'range') return false;
  return SLIDER_KEYS.has(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
```

`client/src/app/services/transport-time.ts`, new:

<!-- apply: create client/src/app/services/transport-time.ts -->
```ts
/**
 * The transport's seek readout: a time in milliseconds as minutes and seconds, `1:05`, rounded down to the second as a
 * player's clock is. Named for what it returns, per `CLAUDE.md`.
 */
export function clockTimeOf(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** The speed the transport offers, as percentages of the score's own tempo: the viewer's range, 25 to 200. */
export const SPEED_RANGE = { min: 25, max: 200, step: 5 } as const;
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/components/composer/composer.component.spec.ts --include=src/app/services/composer-key-handler.spec.ts --include=src/app/services/editable-target.spec.ts --include=src/app/services/transport-time.spec.ts
```

Expected: `TOTAL: 95 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3543 SUCCESS`.

**Step 6: Commit.**

```text
feat: Give the composer the viewer's transport: loop, speed, volume and a seek bar

Loop, a speed from 25 to 200 percent labelled apart from the score's BPM,
volume, and a seek bar with an m:ss readout, all through AlphaTabService in
both states. The seek bar is a range input rather than the viewer's
clickable div, so the keyboard reaches it; a focused slider now keeps the
keys that move it, while Space and the page's modified shortcuts stay the
page's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase I: Deleting the viewer

Build step 11, last, now that the composer opens every file.

### Task I.1: Delete the viewer

Build step 11, last: the route, the nav link, `components/gp-viewer/` and its scale highlighter go, with what
only the viewer read - `getTrackInfo`, `getScoreInfo` and their models, and `setTrackMute` and `setTrackSolo`, which
`setTrackPlayback` replaces. An old `/gp-viewer?id=` link opens that file in the composer; `/gp-viewer` alone goes to
the gallery. The route table is typed `Routes` so the redirect's function type-checks.

**Files** (under `client/src/app/` unless given in full):
- Modify: `app.component.html`, `app.component.spec.ts`, `models/alpha-tab.model.ts`, `services/alpha-tab.service.ts`, `main.ts`
- Delete: `components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.html`, `components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.scss`, `components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.ts`, `components/gp-viewer/gp-viewer.component.html`, `components/gp-viewer/gp-viewer.component.scss`, `components/gp-viewer/gp-viewer.component.ts`

**Step 1: The specs.** They only follow what the task takes out.

`client/src/app/app.component.spec.ts`:

<!-- apply: find client/src/app/app.component.spec.ts -->
```ts
 *
 * The drawer sets `selectedKey`, so it is only meaningful where something reads
 * it. On `/gp-viewer` and `/gp-library` it would do nothing; on `/transcribe` it
 * would be worse than nothing, because that page has its own key handling inside
 * `DerivationSettings` and a global key control that did not drive it would look
```

becomes

<!-- apply: replace client/src/app/app.component.spec.ts -->
```ts
 *
 * The drawer sets `selectedKey`, so it is only meaningful where something reads
 * it. On `/gp-library` it would do nothing; on `/transcribe` it
 * would be worse than nothing, because that page has its own key handling inside
 * `DerivationSettings` and a global key control that did not drive it would look
```

<!-- apply: find client/src/app/app.component.spec.ts -->
```ts

    it('withholds it where it would do nothing', () => {
      expect(AppComponent.showsCircle('/gp-viewer')).toBeFalse();
      expect(AppComponent.showsCircle('/gp-library')).toBeFalse();
    });
```

becomes

<!-- apply: replace client/src/app/app.component.spec.ts -->
```ts

    it('withholds it where it would do nothing', () => {
      expect(AppComponent.showsCircle('/gp-library')).toBeFalse();
    });
```

**Step 2: Nothing to watch fail.** The specs pass before the implementation as after: `TOTAL: 15 SUCCESS`.

**Step 3: The implementation.**

`client/src/app/app.component.html`:

<!-- apply: find client/src/app/app.component.html -->
```html
        <a routerLink="/progression" routerLinkActive="active">Progression</a>
        <a routerLink="/transcribe" routerLinkActive="active">Transcribe</a>
        <a routerLink="/gp-viewer" routerLinkActive="active">GP Viewer</a>
        <a routerLink="/gp-library" routerLinkActive="active">GP Library</a>
      </nav>
```

becomes

<!-- apply: replace client/src/app/app.component.html -->
```html
        <a routerLink="/progression" routerLinkActive="active">Progression</a>
        <a routerLink="/transcribe" routerLinkActive="active">Transcribe</a>
        <a routerLink="/gp-library" routerLinkActive="active">GP Library</a>
      </nav>
```

<!-- apply: delete client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.html -->
Delete `client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.html`.

<!-- apply: delete client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.scss -->
Delete `client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.scss`.

<!-- apply: delete client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.ts -->
Delete `client/src/app/components/gp-viewer/components/gp-scale-highlighter/gp-scale-highlighter.component.ts`.

<!-- apply: delete client/src/app/components/gp-viewer/gp-viewer.component.html -->
Delete `client/src/app/components/gp-viewer/gp-viewer.component.html`.

<!-- apply: delete client/src/app/components/gp-viewer/gp-viewer.component.scss -->
Delete `client/src/app/components/gp-viewer/gp-viewer.component.scss`.

<!-- apply: delete client/src/app/components/gp-viewer/gp-viewer.component.ts -->
Delete `client/src/app/components/gp-viewer/gp-viewer.component.ts`.

`client/src/app/models/alpha-tab.model.ts`:

<!-- apply: find client/src/app/models/alpha-tab.model.ts -->
```ts
  /** Error message if loadingState is 'error' */
  errorMessage: string | null;
}

/**
 * Simplified track info for UI display
 */
export interface GpTrackInfo {
  /** Track index */
  index: number;
  /** Track display name */
  name: string;
  /** Short name (abbreviation) */
  shortName: string;
  /** Track color (hex string) */
  color: string;
  /** Whether track is muted */
  isMuted: boolean;
  /** Whether track is soloed */
  isSolo: boolean;
  /** Whether this is a percussion track */
  isPercussion: boolean;
  /** MIDI channel */
  channel: number;
  /** MIDI program (instrument) */
  program: number;
}

/**
 * Simplified score info for UI display
 */
export interface GpScoreInfo {
  /** Song title */
  title: string;
  /** Song subtitle */
  subtitle: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Copyright info */
  copyright: string;
  /** Tab author */
  tabAuthor: string;
  /** Initial tempo in BPM */
  tempo: number;
  /** Number of tracks */
  trackCount: number;
  /** Number of bars */
  barCount: number;
}

```

becomes

<!-- apply: replace client/src/app/models/alpha-tab.model.ts -->
```ts
  /** Error message if loadingState is 'error' */
  errorMessage: string | null;
}

```

`client/src/app/services/alpha-tab.service.ts`:

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts
import {
  AlphaTabState,
  GpTrackInfo,
  GpScoreInfo,
  AlphaTabSettings,
  DEFAULT_ALPHA_TAB_STATE
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts
import {
  AlphaTabState,
  AlphaTabSettings,
  DEFAULT_ALPHA_TAB_STATE
```

<!-- apply: find client/src/app/services/alpha-tab.service.ts -->
```ts

  /**
   * Mute/unmute a track
   */
  setTrackMute(trackIndex: number, mute: boolean): void {
    if (this.api && this.api.score) {
      const track = this.api.score.tracks[trackIndex];
      if (track) {
        this.api.changeTrackMute([track], mute);
      }
    }
  }

  /**
   * Solo/unsolo a track
   */
  setTrackSolo(trackIndex: number, solo: boolean): void {
    if (this.api && this.api.score) {
      const track = this.api.score.tracks[trackIndex];
      if (track) {
        this.api.changeTrackSolo([track], solo);
      }
    }
  }


  /**
   * Get simplified track info for UI
   */
  getTrackInfo(): GpTrackInfo[] {
    const state = this.getCurrentState();
    if (!state.score) return [];

    return state.score.tracks.map((track: any, index: number) => ({
      index,
      name: track.name,
      shortName: track.shortName,
      color: this.colorToHex(track.color),
      isMuted: false, // alphaTab doesn't expose this directly
      isSolo: false,
      isPercussion: track.isPercussion,
      channel: track.playbackInfo.primaryChannel,
      program: track.playbackInfo.program
    }));
  }

  /**
   * Get simplified score info for UI
   */
  getScoreInfo(): GpScoreInfo | null {
    const state = this.getCurrentState();
    if (!state.score) return null;

    return {
      title: state.score.title || 'Untitled',
      subtitle: state.score.subTitle || '',
      artist: state.score.artist || 'Unknown Artist',
      album: state.score.album || '',
      copyright: state.score.copyright || '',
      tabAuthor: state.score.tab || '',
      tempo: state.score.tempo,
      trackCount: state.score.tracks.length,
      barCount: state.score.masterBars.length
    };
  }

  /**
   * Convert alphaTab Color to hex string
   */
  private colorToHex(color: alphaTab.model.Color): string {
    const r = color.r.toString(16).padStart(2, '0');
    const g = color.g.toString(16).padStart(2, '0');
    const b = color.b.toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  /**
   * Get the raw alphaTab API (for advanced use cases)
   */
```

becomes

<!-- apply: replace client/src/app/services/alpha-tab.service.ts -->
```ts

  /**
   * Get the raw alphaTab API (for advanced use cases)
   */
```

`client/src/main.ts`:

<!-- apply: find client/src/main.ts -->
```ts
import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
```

becomes

<!-- apply: replace client/src/main.ts -->
```ts
import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { Routes, provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
```

<!-- apply: find client/src/main.ts -->
```ts
}

const routes = [
  { path: '', redirectTo: '/fretboard', pathMatch: 'full' as const },
  { path: 'fretboard', component: FretboardComponent },
  {
    path: 'gp-viewer',
    loadComponent: () => import('./app/components/gp-viewer/gp-viewer.component')
      .then(m => m.GpViewerComponent)
  },
  {
```

becomes

<!-- apply: replace client/src/main.ts -->
```ts
}

const routes: Routes = [
  { path: '', redirectTo: '/fretboard', pathMatch: 'full' as const },
  { path: 'fretboard', component: FretboardComponent },
  // The GP Viewer is gone: a `.gp` opens in the composer, as the file, until its first edit converts it. An old link to
  // a file in the viewer opens that file there; one to the viewer alone goes to the gallery.
  {
    path: 'gp-viewer',
    redirectTo: ({ queryParams }) =>
      queryParams['id'] ? `/composer?gp=${encodeURIComponent(queryParams['id'])}` : '/gp-library'
  },
  {
```

<!-- apply: find client/src/main.ts -->
```ts
  // Lazy, where the plan wrote `component:`. The review panel renders its
  // preview through alphaTab, which lives in a 1.14 MB chunk shared by the
  // composer and the GP viewer because both of those routes are lazy too. An
  // eager route here would be a value import of that chunk from the entry
  // graph, which pulls the whole engraver into `main` - and the milestone's
```

becomes

<!-- apply: replace client/src/main.ts -->
```ts
  // Lazy, where the plan wrote `component:`. The review panel renders its
  // preview through alphaTab, which lives in a 1.14 MB chunk shared by the
  // composer and the gallery because both of those routes are lazy too. An
  // eager route here would be a value import of that chunk from the entry
  // graph, which pulls the whole engraver into `main` - and the milestone's
```

**Step 4: Watch them pass.**

```bash
npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/app.component.spec.ts
```

Expected: `TOTAL: 15 SUCCESS`

**Step 5: Type checks and the whole suite.** Expected: both type checks clean, `TOTAL: 3543 SUCCESS`.

**Step 6: Commit.**

```text
feat: Delete the GP Viewer: a .gp file opens in the composer

The route, the nav link, GpViewerComponent and its scale highlighter go,
with the service code only the viewer read: getTrackInfo, getScoreInfo,
setTrackMute and setTrackSolo, which setTrackPlayback replaces, and their
models. An old /gp-viewer?id= link opens that file in the composer, and
/gp-viewer alone goes to the gallery.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Phase J: documentation and the hand check

### Task J.1: Record the milestone in the design doc, the TODO and the roadmap

**Files:**
- Modify: `docs/plans/2026-09-14-gp-composer-design.md`, `docs/TODO.md`, `docs/ROADMAP.md`, and this plan's
  "Corrections during implementation" (added at the top if review changes code)

**Step 1:** In the design doc, change the status line to `Implemented, to [the plan](2026-09-30-gp-composer.md)`, and add
a "Corrections found in building" section listing this plan's sixteen corrections, one line each, pointing here for the
argument. Add a "Hand check" paragraph with Task J.2's results.

**Step 2:** In `docs/TODO.md`:
- Move "Next milestone" on: the GP milestone is done, and M3 (the inspector, the mixer and the bar grid) is next, then
  M4, then the progression library.
- Take out of "Found while designing the GP milestone" what this plan settled: the highlighter that never highlighted,
  the GP library's double open and silent resolves, the viewer's Tone import. Keep what it did not: the key, scale and
  chord filters that can never match, bulk delete, the file card as a `div`, `scrollMode` accepted and ignored, the
  asset defaults, the bytes kept in the entries subject, the unused indexes, and a re-save making a second row.
- Add, under "Found in building the GP milestone": the composer's scores all played on MIDI channel 0 until
  `midiChannelsOf` (fixed, recorded for the record); the scale panel and the circle of fifths now sit on one page with
  no coupling - the design's last open question; writing a new drum note is still out of scope.

**Step 3:** In `docs/ROADMAP.md`, the GP row reads `Shipped` with a one-line summary, and M3 reads `Next`.

**Step 4:** If review changed code after a task was written, list it under "Corrections during implementation" at the
top of this plan and say that the committed code supersedes those tasks' blocks.

**Step 5: Commit**: `docs: Record the GP milestone - what shipped and what building it corrected`.

### Task J.2: The hand check

The suite is headless: it cannot see a glyph, hear a kit or open Guitar Pro. Perform each step and record each result in
the design doc's "Hand check" paragraph. **A step that cannot be performed is recorded as not performed, with the
reason; it is never recorded as passed.**

The plan's own build ran steps 1, 3 (in part) and 5 below against a file alphaTab's GP7 exporter wrote - three tracks,
guitar, bass and a standard kit, with a copyright line: every staff drew, the drum staff with its noteheads; `h`
opened the prompt naming the hammer-on with "Credits: 1 field"; Convert left one composition of three tracks, its kit
intact, and no `.gp` entry; New, then loading it, drew the kit again; and the Scales menu ringed every G-major note head.
Repeat them against real files.

1. **A real multi-track `.gp` file**, from Guitar Pro, dropped on `/composer`: every staff drawn, the title and tempo
   the file's, "Viewing the original file" in the status line, the gallery card corrected to the file's tempo and
   track count.
2. **The prompt's counts against Guitar Pro.** For a file with chord diagrams, a tremolo bar, a D.S. al Coda and
   lyrics in two lines, open it in Guitar Pro and compare each count and first bar the prompt lists.
3. **Save the original first**: the downloaded file opens in Guitar Pro and matches the file that went in byte for byte
   (`fc /b` or `cmp`).
4. **A real drum track**: drawn on the right lines with the right noteheads, sounding the right kit - on channel 9 - in
   Original, after Convert, and after a save and a reload.
5. **Convert, then undo**: the edit that asked goes, the converted score stays, Undo is then disabled.
6. **Show / hide, mute and solo** in both states, by ear: a muted track is silent, a soloed one alone.
7. **The transport**: loop, speed at 50% and 200%, volume, and a seek bar dragged and moved with the arrow keys.
8. **The scale panel**: a highlight survives an edit, a hidden track and a window resize.
9. **`/gp-viewer?id=<an id>`** in the address bar opens that file in the composer; `/gp-viewer` opens the gallery.
10. **Keyboard alone**: the prompt reached, answered and cancelled without a mouse; the focus back on the score after.

### Task J.3: The milestone checkpoint

**Step 1:** Both type checks, `npx ng build --configuration development`, and the whole suite. Expected: no errors, all
SUCCESS.

**Step 2:** `superpowers:finishing-a-development-branch`.
