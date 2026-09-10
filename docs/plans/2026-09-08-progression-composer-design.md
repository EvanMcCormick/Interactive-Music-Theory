# Progression Composer — Design

**Date:** 2026-09-08
**Status:** M1 and M2 implemented and merged. See `2026-09-08-progression-m1-core.md`
and `2026-09-08-progression-m2-piano-roll.md` for the plans they were built from,
and "Correction: `alter` cannot express a borrowed chord" for what implementation
disproved. M3 (the recogniser) is settled under "M3 decisions" at the end of this
document and planned in `2026-09-10-progression-m3-recogniser.md`; it is not
built. M4 is designed here only.

**Read the sections in reverse order.** "M3 decisions" wins over "M2 decisions",
which wins over the original design above it — each records what the milestone
before it disproved.

## Goal

Add a page where a progression is built chord-at-a-time on a grid: pick a key,
click diatonic chords into a timeline, adjust complexity and inversion, edit the
resulting notes in a piano roll, loop it, export it.

The reference is Captain Chords. The existing composer is a *notation* editor —
note-at-a-time onto a staff. This is a different way to think about the same
music, not a different renderer, and the two coexist.

Four jobs, all wanted, all served by one engine:

| Job | What it adds over the core |
|---|---|
| Teach diatonic harmony | Roman numerals coupled to the circle of fifths |
| Songwriting sketchpad | MIDI / `.gp` export |
| Front door to notation | A generated track inside `ScoreDoc` |
| Backing-track generator | The sounding chord published to the fretboard |

## Why this is cheap to build

Most of the depth is already in the repo.

| Existing piece | Job it does here |
|---|---|
| `transcription-quantize.ts` | Free-timed notes to clean `BeatDoc[]`, meter preserved |
| `transcription-fingering.ts` | MIDI to fret/string for a guitar chord track |
| `ScoreDocMapperService` | `ScoreDoc` to alphaTab `Score` |
| `composer-export.service.ts` | MIDI and `.gp` export |
| `CircleOfFifthsComponent` | The key selector, app-wide already |
| `ComposerService` | The `BehaviorSubject` + `structuredClone` undo pattern to copy |
| Tone.js | Playback |

`quantizeBar` matters most. A free-timing piano roll has to become notation
eventually, and turning arbitrary onsets into bars that sum exactly to one bar,
split at beat boundaries, with ties where no single value fits, is the hard part
of that. It was written for transcription. It is the same problem.

## Architecture

### Data flow

```
ProgressionDoc            key + ordered ChordSlots; degree-primary
      |
      | expand: degree -> voicing -> free-timed notes
      v
RollNote[]                the editable surface (MIDI + float beats)
      |
      | quantizeBar()                      <-- reused
      v
ScoreDoc (one owned track) + hand-edited tracks
      |
      | ScoreDocMapperService              <-- existing
      v
alphaTab Score  -->  engraving, MIDI export, .gp export
```

Four derivations, each one-way. Nothing below the piano roll is new.

The two-way arrow is **piano roll to ProgressionDoc**, and only that one. It never
runs off the notation, off `ScoreDoc`, or off alphaTab. Two-way sync here is one
short arrow between adjacent layers, not a bidirectional mesh — which is the
difference between a tractable feature and a class of sync bugs.

`ProgressionDoc` persists as its own JSON, beside the alphaTex the composer saves.

### The model

New file, `models/progression.model.ts`.

```ts
export interface ProgressionDoc {
  id: string; name: string;
  key: { tonic: number; scaleId: string; preferSharps: boolean };
  tempo: number;
  timeSignature: TimeSignature;      // reused from composer.model
  slots: ChordSlot[];
}

export interface ChordSlot {
  id: string;
  harmony: SlotHarmony;              // the label, and the generator
  startBeat: number;                 // absolute, float
  lengthBeats: number;
  notes: RollNote[];                 // the playback truth
  isHandEdited: boolean;
}

export type SlotHarmony =
  | { kind: 'degree'; degree: ChordDegree }
  | { kind: 'literal'; reason: 'unrecognised' | 'user-detached' };

export interface ChordDegree {
  degree: number;                    // 0-6, matching degreePitchClasses
  alter: number;                     // bVII = degree 7, alter -1
  extent: 3 | 7 | 9 | 11 | 13;       // the +/- complexity buttons
  quality: ChordQuality;             // defaults from key; overridable = borrowed chords
  inversion: number;
  suspension: 'none' | 'sus2' | 'sus4';
  octave: number;
}

export interface RollNote {
  midi: number;
  startBeat: number;                 // relative to slot start, float
  lengthBeats: number;
  velocity: number;
}
```

Three load-bearing choices.

**`notes` is always present and always authoritative for playback; `harmony`
labels and generates it.** This is what makes two-way sync tractable. Changing
harmony regenerates `notes`. Editing `notes` re-runs the recogniser against
`harmony`. Neither direction needs the other to be clean, and there is no state
where the two disagree silently — disagreement is representable, as `literal`.

**`RollNote` is MIDI, not `NotePitch`.** The roll is pitch space. Fret and string
assignment is a notation concern applied downstream, where `assignFingering`
already does it well.

**Spelling comes from the degree, not from the pitch.** A degree slot knows that
bVII in A minor spells G-B-D. Literal slots fall back to the key signature, which
is what commit `b514027` fixed.

## Two-way sync

Runs on edit commit (mouse-up), never per frame.

**What it looks at.** Only structural pitch classes: notes sounding at the slot's
downbeat, or covering a meaningful share of it. Short ornamental notes are
excluded by construction. This is what enforces the governing rule — *pitch-set
edits can change a slot's identity; timing edits never do.* Resizing a note does
not make D minor stop being iv, and adding a passing tone does not either.

**The search is local.** First compare the new pitch-class set against what
`harmony` currently generates. Equal means only voicing moved: stop. That is most
edits, and it is O(1).

Only on a difference do we search, and only the neighbourhood of the current
degree — vary one attribute at a time: quality, extent 3 to 7 to 9, suspension,
root alteration. Rank by edit distance from the current harmony first, then exact
pitch-class match, then diatonic fit in the key.

This is the point that makes the whole feature defensible. We are never
identifying a pitch set from nothing. We know the key, the slot boundaries, the
previous chord, and decisively *what the chord was before the edit*. Dragging F to
F# in a D minor slot is an edit distance of one, not a search.

No exact match in the neighbourhood means `literal`.

**Ties.** `{C,E,G,A}` is equally C6 and Am7. Break on the lowest sounding pitch,
then on proximity to the current harmony. The loser becomes the alternates chip
rather than being discarded.

**Never silent.** This is the containment rule the design turns on. A label change
highlights the slot and shows the new numeral, with a chevron listing alternates
and a "keep as literal" escape. One click reverts the label without reverting the
notes. The app never claims a Roman numeral it is not sure of — an unlabelled slot
is honest, a mislabelled one poisons trust in every label on the page.

**Key changes** interact with `isHandEdited`, which is why it is on the model:

| Slot | On key change |
|---|---|
| degree, untouched | regenerate the voicing in the new key |
| degree, hand-edited | *transpose* notes by interval, preserving voicing and rhythm |
| literal | left alone, visibly marked — it has no known relation to the key |

Transposing rather than regenerating a hand-edited slot is the only option that
neither discards the user's work nor breaks the key change.

## UI

Route `/progression`, beside Composer in the existing nav. Standalone components,
state in a service, per the project guardrails.

```
ProgressionComponent              page shell
├─ ChordPaletteComponent          diatonic 7 + alternates + octave / complexity
├─ PianoRollComponent             the grid (OnPush)
├─ ProgressionStripComponent      chord cards; drag to reorder, drag edge to resize
└─ ProgressionTransportComponent  play / loop / tempo / sound preset
```

`ProgressionService` holds `BehaviorSubject<ProgressionState>` with a
`structuredClone` undo stack — the pattern `ComposerService` already uses, capped
the same way. Components subscribe with `takeUntil(destroy$)`.

**The key selector already exists.** The circle-of-fifths drawer is app-wide and
already selects a key, so here it *is* the KEY control. No new picker, and the
teaching story writes itself: turn the circle and watch every Roman numeral hold
while the chord names move underneath it.

**Piano roll rendering.** Grid lines as CSS repeating-gradient backgrounds, notes
as positioned elements with `trackBy`. Drawing hundreds of grid lines as elements
is what makes naive piano rolls stutter; as a background they cost nothing and the
notes stay hit-testable. Canvas remains available if profiling demands it, but is
not where to start.

Layout follows the reference: left rail for key, preset and sound; palette across
the top; roll in the centre; progression strip along the bottom with
CHORDS / RHYTHM / VELOCITY tabs. Velocity is already on `RollNote`, so that tab is
a view, not a model change.

In the Composer, the progression's track renders with a "generated" badge, its
bars read-only, and a **Flatten** action that detaches it into an ordinary track.

## Playback

Tone.js, not alphaTab. `RollNote` is MIDI plus float beats, which maps straight
onto a `Tone.Part` with no quantisation and no round trip. Driving playback
through alphaTab would mean regenerate, `renderScore()`, rebuild MIDI on every
drag, which will glitch a running loop.

Accepted knowingly: the progression page and the Composer will sound different,
Tone synth against soundfont. One chain, built once, disposed in `ngOnDestroy`.

## Build order

Each milestone is independently useful.

1. **M1** — model, service, palette, strip, block-chord generation, Tone loop.
   The teaching and backing-track jobs both work at the end of this.
2. **M2** — piano roll: free timing, velocity, drag and resize. `quantizeBar` to
   `ScoreDoc` projection, notation preview.
3. **M3** — the recogniser, literal degradation, alternates UI. Deliberately after
   M2 so it is tested against a roll that really exists.
4. **M4** — generated track in the Composer, Flatten, MIDI and `.gp` export.

## Testing

Pure, table-driven specs for degree-to-pitch-class, voicing and inversion, and the
neighbourhood search, following the `staff-pitch.ts` precedent — the arithmetic
should be checkable against hand-written examples with no Angular or audio in the
way.

The recogniser gets an adversarial fixture: every diatonic chord in every key,
plus the known ambiguities — C6 against Am7, sus4 against an 11th, and the four
inversions of a diminished seventh, which are the same chord.

`quantizeBar` is already covered by its own specs.

## Decisions taken knowingly

Recorded because each was raised as a risk and chosen anyway, with reasons.

**Two-way sync over a one-way handoff.** The alternative was a read-only notation
preview with an explicit "send to composer". Two-way is worth more, and the risk
turned out to be narrower than it first looked: it is one arrow between adjacent
layers, the search is local rather than global, and `literal` gives the failure a
place to land. The residual risk is the recogniser mislabelling a slot the user
cared about — contained, not eliminated, by never changing a label silently.

**Full free-timing piano roll in v1** rather than block chords or preset patterns.
This is the largest single chunk of work, and it is what makes the page feel like
the reference rather than a toy. It is affordable only because `quantizeBar`
already exists; without it, this decision should be revisited.

**Degrees primary, notes authoritative.** Storing literal notes alone would have
been simpler and would have killed two of the four jobs — no key transposition, no
complexity buttons, no chord identity for fretboard highlighting.

---

## Correction: `alter` cannot express a borrowed chord

Found during M1 Task 4, verified independently three times. Recorded here rather
than fixed, because M1 cannot reach it.

`alter` shifts the **whole** chord stack. That is transposition, and
transposition preserves quality — so the accidental in a Roman numeral, which
displaces only the root and lets the case carry the shape, is not expressible.
Every conventional altered numeral in a major key comes out wrong:

| numeral | model gives | should be |
|---|---|---|
| bVII | Bb diminished | Bb major |
| bVI | Ab minor | Ab major |
| bIII | Eb minor | Eb major |
| bII (Neapolitan) | Db minor | Db major |
| #iv-dim | F# major | F# diminished |

The root is always right; the shape never is.

Secondary dominants are unreachable for the same reason. Since `alter` is
transposition, the reachable set is {diatonic chord on any degree} + alter, and a
major scale holds exactly one dominant seventh, on degree 4. So every reachable
dominant seventh is G7 shifted, needing `(targetRoot - 7) mod 12` — that is -5
for D7 and -7 for C7, both outside `ALTER_MIN/MAX` of +/-2.

**The fix, for M2.** `quality: ChordQuality | null`, where `null` means "as the
key gives it" and non-null overrides the chord tones, with `alter` displacing the
root alone. Then bVII is *degree 6, alter -1, quality 'major'* — root pitch class
10, intervals [0,4,7], giving Bb-D-F. The field already exists and is already
stored; nothing reads it.

Four consequences worth knowing before that lands:

1. **`alter !== 0` with `quality === null`** has no diatonic chord to inherit a
   shape from. Reject the combination or document a default; do not let it fall
   through to today's silent transposition.
2. **`ChordQuality` names only triads and sevenths**, so an override at extent
   9, 11 or 13 has no name to build from. Either the override adjusts the third,
   fifth and seventh against the diatonic stack and leaves the extensions
   diatonic, or overrides are refused above extent 7.

   **Settled: extensions stay diatonic — and the chord is named after what that
   makes it.** The consequence this list did not anticipate is that the override
   is then not the chord's name. bVII at extent 7 in C major is Bb-D-F over the
   key's own A, which is a Bb major seventh; a `major7` chosen at extent 3 is
   cut to a plain triad. Both directions had the card printing the override's
   name over a chord the synth was playing differently, so `effectiveQuality`
   now reads the name off the built stack rather than repeating the field. At
   the height the override itself names, the answer is always the override
   unchanged — swept over every scale, degree and `alter` — so the user's own
   choice is never contradicted; only the notes the override left to the key can
   move the name. A stack no name fits comes back `'other'`, which prints `?`
   and lights nothing: unlabelled rather than mislabelled, as everywhere else.

   The seam this opens is worth stating: the gap between an override's top note
   and the first diatonic extension is whatever the displacement left, and can
   be as wide as seven semitones. That follows from "extensions stay diatonic"
   and is recorded in `chordPitchClasses`.
3. **It invalidates a tested constant.** `OCTAVE_MAX = 2` was measured by
   sweeping the real pipeline *including* `alter`, and the 33-semitone maximum
   reach depends on `alter` meaning what it means today. Changing its semantics
   requires re-deriving that bound.
4. **`regenerateSlot` overwrites `quality` unconditionally**, and it is the
   call site the fix has to change. `progression-edit.ts:173` re-derives the
   label from the scale on every regeneration, and `ProgressionService`
   regenerates on every key change, every complexity step and every resize — so
   an override written into the field survives until the next of those and no
   longer. The field is therefore not merely unread today, it is actively
   erased, which is why `quality: ChordQuality | null` has to land *here* and
   not only in the generator: `null` must mean "re-derive" and a non-null value
   must be left alone, or the borrowed chord is gone the first time the user
   drags a card's edge.

**Why M1 does not care.** `createDegreeSlot` hardcodes `alter: 0`, no M1 setter
changes it, the palette emits only diatonic degrees, `romanNumeral(degree,
quality)` takes no `alter`, and nothing persists a document — so there is no
migration cost either. It goes live at **M3**, where the recogniser's
neighbourhood search varies root alteration as one of its axes: under today's
semantics that axis generates wrong-quality candidates, and the recogniser would
be matching pitch sets against chords nobody would write.

---

## M2 decisions

Settled before planning M2, after M1 surfaced questions the original design did
not answer. Where these conflict with anything above, these win.

### Scope

All of it: the piano roll, the edit-protection rules, the `quantizeBar`
projection and notation preview, **and** the borrowed-chord correction. The last
was filed as "for M2" and is separable from drawing a roll, but it touches the
same files, so interleaving beats stacking.

### Per-aspect ownership supersedes `isHandEdited`

`ChordSlot.isHandEdited: boolean` is replaced by a record of **which dimensions
the user owns** - pitches, timing, velocity - tracked independently.

The boolean forces a bad trade. Under it, nudging one velocity opts a slot out of
re-voicing forever, so a later key change keeps the old chord's pitches; and the
alternative reading, where only pitch edits count, silently destroys a
hand-built rhythm on the same key change. Both losses are real and neither is the
one the user meant.

With ownership per dimension, regeneration becomes a **merge** rather than a
replace:

| dimension | owned | not owned |
|---|---|---|
| pitches | transpose by the interval | re-voice from the degree |
| timing | keep | regenerate as a block |
| velocity | keep | reset to `DEFAULT_VELOCITY` |

So a groove written in C survives a switch to A minor while the chords re-voice
correctly underneath it, which is the whole point of storing degrees.

This also fixes the erasure recorded in consequence 4 above: `regenerateSlot`
merges instead of overwriting, so an override survives a resize.

### The palette gains three named groups

`quality: ChordQuality | null` is machinery, and M1 emits none of it. The UI that
does:

- **Alternates** - other qualities on the selected chord's root, which is the row
  Captain Chords shows. Turns IV into iv, or V into V7.
- **Borrowed** - bII, bIII, bVI, bVII and minor iv in a major key, each labelled
  with its numeral.
- **Secondary dominants** - V/V, V/vi, V/IV as named functions.

Borrowed and secondary chords need **chromatic roots**, which is why an
alternates row alone would not deliver the correction above: every case it
tabulates has a root outside the scale. A secondary dominant costs almost nothing
once chromatic roots exist - root a fifth above the target, quality
`dominant7` - so it is a label rule rather than new machinery.

A free root-times-quality picker was rejected. It is less code and more power,
and it abandons the Roman numeral framing that is the teaching feature: a chord
picked that way has no function relative to the key, so the circle-of-fifths
coupling stops meaning anything.

**Amended at M2 Task 8: the borrowed row also carries what a *minor* key
borrows.** The five above are what a major key borrows, and in a minor key four
of them are the key's own diatonic chords and are correctly filtered out. That
left C minor offered one borrowed chord and no route at all to `V` — the major
dominant, which is the single most important non-diatonic chord in minor-key
harmony — or to the raised `vii°` beside it. Neither is on the diatonic row (C
aeolian shows `v`, a G minor triad) and neither could be appended, because the
alternates row can only re-shape a slot that already exists.

The fix is one more source mode, the parallel **harmonic** minor, at degrees 4
and 6. Its raised seventh makes its degree-4 triad major and its degree-6 triad
diminished, so `V` and `♯vii°` fall out of the same derivation as everything
else, with no chord written down. In a major key both are dropped by the
existing "the key already has it" filter, so no major key's row changes.

The Picardy `I` was considered and left out. It sits on the tonic, and the
alternates row's real limit — that it can only re-shape an existing, selected
slot — does not bite on the one slot a Picardy third is by definition applied to.
See `BORROWINGS` in `progression-vocabulary.ts` for the argument and the one-line
change if it is ever wanted.

### Numerals are the mode's, not the parallel major's

The correction table above writes `#iv-dim`, which is a *major-relative* reading.
The app does not use one. `romanNumeral` measures `alter` from the current
scale's own degree, so F lydian prints `♭iv` for a B flat minor triad where
standard practice writes `iv`, and E phrygian prints `VII` for a D major triad
where standard practice writes `♭VII`. That is the same reading the diatonic row
already uses — it prints phrygian's second degree as `II`, not `♭II` — and one
reading throughout is worth more than agreeing with convention only in the modes
where the two coincide. The table is describing the bug, not quoting a numeral
the app prints.

### The two chromatic tables cannot spell every borrowed root

**Known limit, M3.** `MusicTheoryService` spells from two twelve-name chromatic
arrays, and between them they have no `C♭`, `F♭`, `B♯`, `E♯` or double accidental
at all. So a borrowed root whose correct spelling is one of those comes back as
the wrong *letter*, and the numeral above it contradicts the name beside it.
Across the seven diatonic modes in all twelve keys that is 55 buttons:

- **35 in the flat keys**, all in the borrowed row, wherever a lowered root lands
  on a C flat, an F flat or a double flat. B♭ major's `♭II` is a C flat and prints
  `B Maj`; E♭ major's `♭VI` is a C flat and prints `B Maj`; D♭ major's `♭II` is an
  E double flat and prints `D Maj`. `♭II` over `B Maj` reads as a raised seventh,
  which is the opposite of what the numeral says.
- **20 in the sharp keys**, nineteen of them the `♯vii°` borrowed from harmonic
  minor: C♯ aeolian's is a B sharp and prints `C°`, G♯ aeolian's is an F double
  sharp and prints `G°`.

`rootPrefersSharps` — the rule that decides whether a *displaced* root leans sharp
or flat — cannot reach any of this, because the failure is a missing letter and
not a wrong preference. Fixing it needs a spelling model that carries a letter and
an accidental separately, so a note can *be* a C flat rather than being whichever
of twelve names shares its pitch. That is a change to those two arrays and to
every caller of `spellNote`, and it is out of scope for a palette task.

The same rule has a smaller, separate failure of its own: it is right only when
the displaced note's correct accidental has the *sign* of the displacement, and
over every scale and key it gets 996 displaced roots right, 112 wrong where
following the key would have been right, and 176 wrong that the key would also
have got wrong. Seven of the 112 are in keys whose own name is a plain letter —
F super locrian's and F ultra locrian's `♯iv`, C and F ultra locrian's `♯VII`, and
the `♭V` of B enigmatic, B lydian augmented and B ionian augmented. No diatonic
mode is affected. Both are recorded in full on `rootPrefersSharps`.

### A real ninth chord is unreachable

**Known gap, M3.** `ChordQuality` names triads and sevenths only, and
`ChordDegree.quality` overrides the chord tones from the bottom up while
everything above the override stays diatonic. So the ninth, eleventh and
thirteenth of *every* chord in the app come from the key, and there is no way to
ask for any others: `V/vi` in C major raised to a ninth builds `E G♯ B D F`, a
flat ninth, and a plain dominant ninth `E G♯ B D F♯` cannot be built at all.

M2 Task 8 recorded this the wrong way round — it claimed a `dominant9` override
would build the same notes a `dominant7` one does, "because the ninth is diatonic
either way". It does not: the two disagree in 812 of the 1015 (scale, degree,
alter) combinations the app can reach. So widening `ChordQuality` is not a
relabelling, it is **new reachable harmony**, and that makes it a feature to plan
rather than a naming preference that was declined.

The reasons it was still deferred stand: `QUALITY_INTERVALS` is read in both
directions and rests on no two entries sharing a shape, which a ninth breaks
three ways over (`[0,4,7,10,14]`, `[0,4,7,10,13]`, `[0,4,7,10,15]` are all in the
app's chord table), and the three naming tables in `progression-chord-names.ts`
are keyed exhaustively on `ChordQuality`, so each new member needs a numeral
figure, a printed suffix and a spoken phrase.

### Edits during playback take effect at the loop boundary

The schedule is a snapshot, and M1 could live with that because a chord strip
invites little mid-play editing. A roll inverts that - loop four bars and nudge
until it sits right is the primary workflow.

Changes are collected and the schedule rebuilt when the loop turns over. This is
musically motivated rather than merely cheaper: swapping notes under a sounding
chord clicks and cuts notes in half, which is why live-looping tools quantise
changes to a boundary. The wait is at most one cycle, and one cycle is the rhythm
the user is already listening in.

### Three smaller rulings

1. **`alter !== 0` with `quality === null` is rejected**, not defaulted. A
   chromatic root with no shape to build is a value of the wrong kind under the
   model's existing rule, and every UI path supplies both.
2. **An override above extent 7 sets the triad and the seventh; extensions stay
   diatonic.** The alternative - refusing overrides above extent 7 - would make
   the complexity stepper fail on exactly the borrowed chords a user most wants
   to extend.
3. **`OCTAVE_MAX` must be re-derived.** Its value of 2 was measured by sweeping
   the real pipeline including `alter`, and the 33-semitone maximum reach depends
   on `alter` meaning what it means today. Re-run that sweep under root-only
   alteration before trusting the constant.

   **Settled: it is now 1.** The reach under the new semantics is 45 semitones,
   not 33, and 2 put the ceiling at 129 — off the end of MIDI. See M2 Task 3 for
   the witness and the trade-off.

### Three findings recorded rather than fixed

The M2 review turned up three defects whose honest fix is wider than the piano
roll. Each is written down where the reader will meet it in the code; this is
the index.

1. **`BeatDoc.dynamics` does not inherit, and nothing implements the inherit its
   comment promised.** `ScoreDocMapperService.toBeat` skips the assignment on a
   null and alphaTab's `Beat.dynamics` defaults to `f`, so an unmarked beat
   engraves *forte* and alphaTab prints the change. The round trip is worse than
   lossy: `toDoc` reads the field back, so loading a document and saving it turns
   every null into an explicit `f`. `quantizeBar` writes `dynamics: null` on
   every beat it produces, which means the reach is wider than this page — the
   **transcription review preview engraves whole performances forte** through the
   same path. `progression-score.ts` works around it locally, stating the
   standing dynamic on every beat, and `applyDynamics` says why. The real fix is
   a standing value carried across beats, bars and voices in the mapper, and it
   changes what every writer of the field means; it belongs with transcription
   and the composer rather than here.

2. **Four enharmonic keys where the staff and the palette disagree.**
   `MusicTheoryService.shouldUseSharps` tests for `'#'` before `'b'`, and every
   combined name in `chromaticScaleWithBoth` carries both spellings — so `D#/Eb`
   comes back sharp. Selecting it with ionian gives a circle wedge reading "Eb",
   a fretboard and a palette reading "D#", and an engraved signature of
   `fifths: -3`, which is E flat major. Same for `A#/Bb`, `G#/Ab` and `C#/Db`;
   `F#/Gb` is exempt because six o'clock is the one position the circle carries
   both halves of, so the staff follows `preferSharps` there. The notation
   surface is the musically right one — D sharp major has nine sharps and is not
   on the circle at all — and the root cause is upstream in a rule that reads a
   *name* for a spelling the circle already states as data. It predates M2; what
   is new is that there is now a surface to disagree with it. Fixing it moves
   note names on the fretboard, the keyboard and the chord palette at once, so it
   is its own change with its own tests.

3. **`AlphaTabService` is a root singleton holding one api, and the notation
   panel disposes it unconditionally.** The panel creates the api in its
   `@ViewChild` setter and calls `dispose` in `teardown` without checking that
   the api it is disposing is the one it made — nothing on the service records
   who made it, and `initializeApi` already disposes an existing api before
   building its own, so the last caller in wins. Safe today on a fact about the
   router rather than about the component: the GP library and the composer are on
   other routes, and a route is deactivated before the next is activated, so no
   two consumers are alive at once. It stops being safe the moment two engravers
   share a page. The fix, if that day comes, is a handle on the service rather
   than a check in the panel.

### The key signature of a scale that is not a diatonic mode

`MODE_OFFSETS` held only the seven diatonic modes, which made
`ProgressionScore` engrave a **C major signature for every heptatonic minor**:
E harmonic minor is on the fretboard's own menu, is heptatonic so the palette
builds and names its chords, and came out with no signature and every F sharp
written on the note — labelled major, on top of it, because `MINOR_MODES` did
not list it either. It is the only user-visible wrong output the milestone had.

The table is now what convention says, scale by scale, and it is stated rather
than derived — like `CIRCLE_POSITIONS`, and for the same reason. No rule
produces it from a scale's intervals. *The parent scale's own signature* puts
super locrian in a key nothing writes it in; *the nearest diatonic mode* makes
melodic minor a tie between ionian ♭3 and dorian ♯7, and so has no answer for
the one scale whose signature every theory course teaches.

What it now covers, beyond the diatonic modes:

- **Harmonic minor and five of its six other modes.** Harmonic minor is aeolian
  with a raised seventh, and a chromatic raise moves no letter name — so it is
  written in the natural minor's signature with the seventh as an accidental,
  and each rotation is the corresponding rotation of the *natural* minor with
  one note raised. The app's own names say which: "Locrian ♮6", "Ionian
  Augmented", "Dorian ♯4", "Lydian ♯2", phrygian dominant. Ultra locrian is left
  out — its tonic *is* the raised note, so it stands a semitone above the mode
  it would otherwise correspond to and needs a double flat to spell.
- **Melodic minor**, on the same convention. Its six modes are not included:
  two raised degrees leave more than one plausible parent, the parent melodic
  minor's signature and the mode each is named after disagree for every one of
  them, and jazz practice settles on neither.
- **Hungarian minor**, harmonic minor with a raised fourth.

Everything else still falls back to no signature, and that is the right answer
rather than a failure: scales with fewer than seven notes have no parent major
and no seven letters to hang a signature on, the octatonic and the bebop scales
have more notes than a signature has letters, and the exotic heptatonics —
double harmonic, Hungarian major, both Neapolitans, enigmatic, Persian, Arabic —
read as more than one diatonic mode plus accidentals with no reading that
engravers agree on. `naturalNotes` is excluded although it is the major scale's
shape: it belongs to the fretboard's spelling overlay, and a signature would let
the table overrule the choice the user made by picking it.

`MINOR_MODES` grew with the offsets and only with them. A scale the table cannot
place keeps the major label, because a signature this module could not find is
not one it may then call minor either.

---

## M3 decisions

Settled 2026-09-10, before planning M3. The plan is
`2026-09-10-progression-m3-recogniser.md`. Where these conflict with anything
above — "Two-way sync" in particular, which M3 is the first milestone to build —
these win.

### Scope

The recogniser, `literal` degradation and the chip, **and** the three items this
document filed as "M3" beside them: suspensions sounded, a chord model that can
build and name extended and altered chords ("A real ninth chord is unreachable"),
and a spelling model that can write a C flat ("The two chromatic tables cannot
spell every borrowed root").

The last two are not separable from the first in practice. Without extended
chords, every altered extension a user drags into place has nothing to match and
goes literal. And a recogniser that labels chromatic roots makes the misspellings
it cannot fix more common.

### The chord model grows three ways, all through `null`

```ts
interface ChordDegree {
  degree; alter; extent; inversion; octave;   // unchanged
  quality: NamedQuality | null;               // gains four added-tone shapes
  suspension: 'none' | 'sus2' | 'sus4';       // now sounded
  extensions: {                               // new
    ninth: -1 | 0 | 1 | null;                 // ♭9 / 9 / ♯9
    eleventh: 0 | 1 | null;                   // 11 / ♯11
    thirteenth: -1 | 0 | null;                // ♭13 / 13
  };
}
```

`extensions` carries one alteration per extension, and `null` means "as the key
gives it" — the convention `quality` already uses. That makes it a migration with
nothing to migrate: every existing slot is all-null and builds exactly what it
builds today. A number overrides that one extension relative to the root, and is
read only once `extent` reaches its height, so `extent` stays the single height
control.

Rejected: widening `ChordQuality` into a flat list of named extended chords. It is
simpler to look up and cannot build a combination nobody listed, and it stores the
height twice — in the name and in `extent` — which multiplies the disagreements
`effectiveQuality` already spends two sections on.

Four added-tone shapes join `QUALITY_INTERVALS` as four-note qualities: `major6`,
`minor6`, `add9`, `minorAdd9`. Each opens with the triad of its own name, so the
invariant `chordPitchClasses` rests on holds, and a `major6` at extent 9 builds a
6/9 with no rule of its own.

`suspension` replaces the third with the second or the fourth at every height, so
7sus4 and 9sus4 fall out. Where the suspended note is also an extension — sus4 at
extent 11, sus2 at 9 and above — the chord sounds that pitch class twice, an
octave apart, rather than dropping a note the count depends on.

### The octave ceiling is the chord's, not the model's

Widening the model widened what it can reach. The tallest chord it can now build
reaches **58 semitones** above its voicing base, where the shipped set reached 45:
degree 3 of C major at extent 13, altered down a tone, overridden to `diminished`,
suspended, with a ♭9 and a ♭13. Two of those replacements land below the note
beneath them, so the ascent lift adds an octave twice. At `OCTAVE_MAX` of 1 that
chord ends on MIDI **130**, three notes past the end.

`OCTAVE_MAX` stays 1. The ceiling becomes **each chord's own**: the generator knows
the key and the scale, so it derives from the chord it is about to build the
highest octave that still fits, and voices no higher. M2's own note on the
constant recorded this as the thing to reach for if the top octave were ever
missed, and this is that day — the alternative, dropping the constant to 0, costs
every chord the top octave to accommodate one almost nobody will build.

**`ChordDegree.octave` still stores what the user asked for**, and that is the
half worth arguing. Storing the clamped value instead would make the clamp
permanent: a slot pushed down because a pinned ♭13 widened it would stay down
after the ♭13 came off. Clamping on use means the chord returns to the octave it
was given the moment it narrows again, and the palette shows the effective value
with its up-stepper disabled rather than doing nothing when pressed.

The bound also stops being something a sweep has to prove. A global constant is
only defensible by measuring every chord the model can build — 236 million of
them, thirteen minutes — where a per-chord ceiling is correct by construction and
checkable on a sample.

### Names are composed, and still read off the chord

`effectiveQuality` becomes `effectiveChord` and returns an identity rather than a
quality: the base shape, the suspension, the height, and the extensions that are
altered. Three renderers compose from the existing tables plus one rule: the
height is the highest *unaltered* extension, altered ones follow it, and the
suspension goes last. So `V9`, `V7♭9`, `Imaj13♯11`, `V7sus4`.

`QUALITY_INTERVALS` still holds base shapes only, which is what keeps "no two
entries share a shape" true: the combinations live in the composed layer, where no
table has to list them.

This settles the strip's argument against printing the height, which was that
`V9` over `G7` would be worse than `V7` over `G7`. Both lines now come from one
identity and agree at every height.

### The fretboard is lit by interval set

A built chord finds its `MusicTheoryService` id by matching intervals against the
chord table. That the twelve quality names were also chord ids was a coincidence
the code leaned on. Matching intervals makes it a lookup, and lights the ninth,
eleventh and thirteenth entries the table already had. The common altered
dominants and the suspended sevenths are added as new entries — added, not
changed, per the guardrail on reference data. A chord the table does not hold
lights nothing.

### The recogniser

A pure module, `progression-recognise.ts`.

**What it reads.** The slot's *structural* pitch classes: those sounding at the
downbeat, plus any whose summed sounding time within the slot is at least a
quarter of the slot. An eighth-note arpeggio keeps every chord tone; a sixteenth
passing tone drops out. A quarter-note passing tone in a four-beat slot is on the
line and counts — the alternative threshold loses the tones of a quarter-note
arpeggio, which is the worse error.

**When it is quiet.** When the structural set is the same before and after the
edit. This replaces "compare the new pitch-class set against what `harmony`
currently generates" above, which is wrong once timing edits exist. They never run
the recogniser, so they can change which notes are structural without anything
re-reading the slot — and a comparison against the label would then relabel a slot
the next time a passing tone was added.

**It parses; it does not search.** Each structural pitch class is tried as a
root — seven at most — and the intervals above it are parsed into an identity: a
third or a suspension, a fifth that may be absent, a seventh or an added sixth or
ninth, and the extensions. An interval left over means no parse from that root.

This replaces "vary one attribute at a time". The locality that section wanted
survives, because an edit is one note and the ranking prefers the current root.
What the parse adds is that it cannot miss a natural edit that happens to change
two fields: adding a flat seventh to `I` moves both `extent` and `quality`, and it
is the most common way there is to make a secondary dominant.

Each parse is expressed in the key. The root takes the degree whose diatonic chord
shares the most notes with it, then the flat side, within `ALTER_MIN..ALTER_MAX`.
Every field is `null` wherever the key's own note agrees, so a recognised `ii`
stores `quality: null` and re-voices on a key change exactly as a palette `ii`
does. The inversion is read from the bass.

**Ranking**, best first:

1. complete (fifth present) over fifth omitted;
2. keeps the current root;
3. its root is the bass;
4. most fields `null`;
5. lowest extent.

This reverses the order under "Ties" above, which broke on the bass first.
Proximity has to come first because of the fixture this document asks for itself:
the four inversions of a diminished seventh are the same chord, so re-voicing a
`vii°7` must not relabel it four ways. C6 against Am7 still comes out the way that
section wanted — `I` plus an A is `I6`, `vi` plus a G is `vi7` — because each keeps
its own root.

**Outcomes.** The best parse equals the current harmony, ignoring inversion:
nothing changes. It differs: the slot is relabelled, and the next parses become the
chip's alternates. No parse: `literal`, reason `unrecognised`. A `user-detached`
slot is never re-read.

The only omission it accepts is the fifth, so a thirteenth voiced without its
eleventh goes literal. Accepting it is a one-line widening of the parse and more
ambiguity in the ranking, and is left until a user misses it.

### When it runs, and undo

Once per pitch gesture, inside that gesture's undo entry. A drag defers it to
pointerup, from the roll's `endGesture`, and commits the relabel under the drag's
own run key, so one undo takes back the notes and the label together. A one-shot
edit — double-click add, delete, an arrow-key nudge — recognises inside its own
commit.

### The chip

In the roll's toolbar beside Reset to chord rather than on the card: the roll is
where the edit happened, and a card can be one beat wide. The card is highlighted
to match. The chip reads `V7♭9 ▾ (was V9)` and offers the alternates, *Back to
V9* — the old label restored, the notes kept — and *Keep as literal*. A polite live
region says the same thing aloud, because "never silent" is owed to a screen
reader too.

Its state is `ProgressionState.relabel`, beside `selectedSlotId` and off the undo
stack for the reason that one is: it is where the user is, not what they wrote.
Any document change, a selection change, and undo or redo clear it — an undo can
take away the relabel it describes.

### `literal` is no longer a one-way door

Every command refused a literal slot, so the recogniser would have opened a door
with no way back but undo. Literal harmony now keeps the degree it degraded from:

```ts
| { kind: 'literal'; reason: 'unrecognised' | 'user-detached'; from: ChordDegree | null }
```

Reset to chord rebuilds the block chord from `from`, in whatever key the page is
in by then. Notes edited back into something that parses bring an `unrecognised`
slot back on their own, with the chip. `from` is `null` only for a document from
elsewhere, which keeps today's refusal.

### A key change re-expresses an owned chord

Found by reading `mergeNotes`, and reachable in M2. A slot that owns its pitches
keeps its degree while its notes move by the tonic interval, and when the *mode*
changes with the tonic the two drift apart: click the relative minor on the circle
and a hand-edited `I` in C major plays A–C♯–E under a card reading `i`. That is a
silent mislabel, the one thing this design says the app must never do.

The rule now is that a key change never changes what an owned chord *is*. Its
identity — `effectiveChord` in the old key — is re-expressed in the new key through
the step the recogniser ends with, and the card reads `I`. Nothing is recognised
and no chip appears, because the chord did not change; its spelling in the new key
did.

The key-change table under "Two-way sync" is amended: *degree, hand-edited*
transposes the notes **and re-expresses the label**. Slots that do not own their
pitches re-voice from the degree as before, and literal slots are left alone.

### Spelling comes from the degree's letter

Supersedes "a change to those two arrays and to every caller of `spellNote`"
above. A letter-and-accidental type is necessary and not sufficient: a pitch class
does not say which letter it is, so no preference can choose C♭ over B. The degree
can. `note-spelling.ts` writes a note as the letter some number of steps above a
known one, with whatever accidental lands it on the pitch:

- a scale degree `d` is `d` steps from the tonic;
- a chord root on degree `d` is `d` steps from the tonic whatever its `alter` — so
  ♭II of B♭ is a C, and pitch class 11 there is C♭;
- a chord tone is spelled from its root by its place in the identity: third 2,
  fifth 4, seventh 6, ninth 1, eleventh 3, thirteenth 5, sus2 1, sus4 3, added
  sixth 5.

That fixes the 55 borrowed roots and retires `rootPrefersSharps` with its 112
wrong displaced roots. Measured over all 33 heptatonic scales × 12 tonics × 7
degrees × 5 alters — 13,860 roots — **5,800 go from the wrong letter to the right
one and not one regresses**. Output stays ASCII (`Cb`, `Ebb`, `F##`) to match the
tables it falls back to.

**Where it still cannot spell, and why no preference could.** A letter takes an
accidental, and notation has two. A root three semitones from its letter has no
spelling at all: A♯ enigmatic's sixth degree is an F triple sharp, and it gets
there with no `alter` involved. The **alternates row** reaches many more of them,
because it offers every named shape on whatever root the selected slot holds — so
a slot already on a doubly-displaced root pushes all of them a further two
semitones out. Those buttons fall back to the chromatic tables, which is a wrong
letter under a right numeral: the same failure in miniature, and the honest floor
rather than a bug, because a triple accidental is not something the model can
write.

The counts are pinned per `alter` in `progression-vocabulary.spelling.spec.ts`
rather than described here, and pinned as **roots** rather than buttons: a root is
what falls back, and the alternates row merely repeats it across every shape. That
distinction is not pedantry — the count was once pinned as buttons, and it drifted
from 12 to 16 the day Task 4 added four qualities, without one new root having
failed.

It is adopted app-wide. The fretboard and keyboard spell in-scale notes by degree
for a heptatonic scale and chord tones by step for a chord, including the chord the
progression lights. Notes outside either keep the tables, and so do scales with no
one-letter-per-degree reading. Chord entries gain a `steps` array beside
`intervals`, because semitones alone cannot settle it: 9 is a sixth in `6` and a
seventh in `diminished7`.

**This forces finding 2 under "M2 decisions".** Degree letters are only as right as
the tonic's letter, and `shouldUseSharps` spells `D#/Eb` sharp. On top of degree
letters that would print E♭ major as D♯–E♯–F##, which is worse than today. So the
fretboard's tonic takes its spelling from the circle's own data, the rule
`keySignatureKind` already states, and finding 2 is fixed as part of this rather
than as a change of its own.

### Not in M3

- **Notation spelling.** `NotePitch` carries no letter, so alphaTab spells the
  preview from the key signature and a ♭II chord still engraves on B. The fix is a
  spelling field on `NotePitch`, and it belongs with M4, where the generated track
  becomes a composer track.
- **A thirteenth without its eleventh**, above.
- **Recognition on a key change.** Not needed once the label is re-expressed rather
  than kept.
