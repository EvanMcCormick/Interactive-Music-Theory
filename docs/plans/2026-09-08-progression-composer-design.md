# Progression Composer — Design

**Date:** 2026-09-08
**Status:** M1–M4 implemented and merged. See
`2026-09-08-progression-m1-core.md`, `2026-09-08-progression-m2-piano-roll.md`,
`2026-09-10-progression-m3-recogniser.md` and
`2026-09-12-progression-m4-composer-track.md` for the plans they were built
from, and "Correction: `alter` cannot express a borrowed chord" for what
implementation disproved. The "M3 decisions" and "M4 decisions" sections at the
end record what each milestone settled, what it measured, and what it did not
do.

**Read the sections in reverse order.** "M4 decisions" wins over "M3 decisions",
which wins over "M2 decisions", which wins over the original design above them —
each records what the milestone before it disproved.

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

**Resolved in M3** by `note-spelling.ts` and the degree-letter rule under
"Spelling comes from the degree's letter", which also deleted `rootPrefersSharps`.
What a letter and two accidentals still cannot write is recorded there.

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

**Resolved in M3** by the composed extension model under "The chord model grows
three ways, all through `null`": `extensions` pins each extension against the
root, so `V/vi` at a ninth builds `E G♯ B D F♯` when asked. `QUALITY_INTERVALS`
still holds base shapes only, which is how the no-two-entries-share-a-shape
invariant survived it.

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
   both halves of, so the staff follows `preferSharps` there. **Amended in M3:
   that exemption is narrower than it reads.** It holds for the *ionian* position,
   which is what this finding was about; measured across the app's whole menu,
   `F#/Gb` moves for 19 of 71 items once the signature decides — lydian among
   them, and correctly, since `keySignatureKind('lydian', 6)` inherits from D flat
   major and answers flat. A claim of the form "this key never moves" was always
   going to be false somewhere; the true one is that the circle's answer wins
   wherever the circle has one. The notation
   surface is the musically right one — D sharp major has nine sharps and is not
   on the circle at all — and the root cause is upstream in a rule that reads a
   *name* for a spelling the circle already states as data. It predates M2; what
   is new is that there is now a surface to disagree with it. Fixing it moves
   note names on the fretboard, the keyboard and the chord palette at once, so it
   is its own change with its own tests. **Resolved in M3**, as "Spelling comes
   from the degree's letter" said it had to be: the tonic's spelling now comes
   from the circle's own data through `keySignatureKind`, and the fretboard, the
   keyboard and the palette agree with the staff. The sweep that holds it is
   `the whole menu, swept` in `music-theory.service.spec.ts`.

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
reaches **58 semitones** above its voicing base, where the set M2 shipped reached
45: degree 3 of the major scale in D at extent 13, altered down a tone, overridden
to `diminished`, suspended, with a ♭9 and a ♭13. (The reach is key-invariant, so
the tonic does not change the 58; the tool, the pinned spec and the sweep's own
output all name D, and an earlier draft here said C.) Two of those replacements land below
the note beneath them, so the ascent lift adds an octave twice. At `OCTAVE_MAX` of
1 that chord ends on MIDI **130**, three notes past the end.

**Measured, and one figure moved.** The four added-tone shapes alone took the
shipped set's own reach from 45 to **46** — `add9` puts its fourth note a ninth
above the root — so the 45 above is M2's number and not today's. The sweep is
`client/tools/measure-chord-reach.cjs`, which last ran on 2026-09-10 against
`VOICING_BASE_MIDI` 60: shipped 5,613,300 chords reaching 46, with the
suspensions 16,839,900 reaching 46, and the whole model 236,432,196 reaching 58 in
about three minutes. `OCTAVE_MAX`'s docstring carries the same table and the
headroom histogram behind it.

`OCTAVE_MAX` stays 1 **at this point in the argument** — it returns to 2 four
paragraphs below, once the ceiling has made that affordable, and 2 is what the
code holds. The ceiling becomes **each chord's own**: the generator knows
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

**And it gives the control its top octave back.** `OCTAVE_MAX` returns to 2, the
value M2 took it down from. That drop was the right call at the time and is the
wrong one now, for the same reason both ways round: M2 could only bound the
*input*, so the existence of chords that overflow at 2 cost **every** chord in the
app an octave. Measured over the shipped set, 99.839% of buildable chords have room
for that octave and 0.161% do not — and the ceiling holds that 0.161% at 1 by
itself, which is precisely the case a global constant could not express.

A phrase to retire while we are here: "one chord in 236 million", which appears in
M3's own commit messages and in `OCTAVE_MAX`'s earlier docstring. It borrows the
*witness's* uniqueness for a population it does not describe — the witness is the
widest chord, not the only held-down one. Across the full model 16,045 chords have
a ceiling of 0 and 1,730,647 more have a ceiling of 1. What is rare is the chord
that overflows at the *bottom* of the control, not the chord that cannot reach the
top.

So the constant stops being arithmetic and becomes **taste at both ends**: C2 at
the bottom because chords voiced below it are mud, two octaves at the top because
that is as far as the control usefully goes. What keeps a note inside MIDI is
`chordOctaveCeiling`, and every docstring that used to credit `OCTAVE_MAX` with it
now says so.

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

**What was measured, and what holds it.** `progression-recognise.roundtrip.spec.ts`
generates a chord, hands its notes straight back and asks what it is. It sweeps
**22,166 chords**: every heptatonic scale at every degree, extent and suspension;
the seven diatonic modes against every named quality and every `alter`; one
extension pinned at a time; and both of those crossed with `sus2` and `sus4`. The
last of the four was added on 2026-09-10 after the first three were found to cross
suspension with nothing at all. Four axes are still uncrossed and the spec names
them. The outcome, as printed on each run:

| | |
|---|---|
| came back field for field | 9,583 |
| overloaded — two notes in one role | 6,311, of which 6,057 at the height of the distinct notes and **254 refused** |
| respelt — same notes, a reading the model prefers | 6,272, none of them renumbered |
| outside both classes | 0 |

The 254 are the shortfall rather than the rule — readable notes whose reading has
no name — and they are pinned as a **ceiling and not a figure**: the bucket may
shrink and may not grow. `notAtHeight` and `bug` are asserted at zero, so no chord
comes back labelled with notes the slot is not playing. Two further assertions say
no chord on its own degree is renumbered, and no chord whose root did not move is
renumbered at all.

**Speed is hardware and the order of magnitude is the claim.** Recognising an
`Imaj13♯11` — seven notes, so seven roots to try — takes **tens of microseconds**.
Figures from 17 to 34 have been taken on different machines for the same code,
which is wider than any change to the module has produced, so nothing here is a
baseline: `progression-recognise.spec.ts` prints its own measurement on every run
and that printout is the figure to read.

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

That fixes the 55 borrowed roots and retires `rootPrefersSharps`. Measured over all
33 heptatonic scales × 12 tonics × 7 degrees × 5 alters — 13,860 roots — **5,800 go
from the wrong letter to the right one and not one regresses**.

**The 996 / 112 / 176 figures on the retired rule are unaudited**, and are quoted
in three places besides this one. M3's final review reconstructed
`rootPrefersSharps` and scored it by degree letter, reaching 162 over 33 scales at
±1 and ±2 and 161 at ±1 — no population lands on 112. The same method reproduces
the 55 exactly, so it is not obviously the wrong method; the original may have
counted something else it did not record. Nothing rests on those three numbers —
the rule is gone and 5,800 / 0 is measured and pinned — but a reader should treat
them as history rather than as evidence, and anyone quoting them again should
pin them first. Output stays ASCII (`Cb`, `Ebb`, `F##`) to match the
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

**What that cost across the whole menu.** `the whole menu, swept` in
`music-theory.service.spec.ts` selects every key against every item a degree can
name and checks each name is on the letter its own position gives it. Before the
change the menu carried **292 notes on a double accidental across 172 selections,
73 of them carrying two or more and one as high as six**, and one name off its
letter entirely — `A♯/B♭` enigmatic's sixth degree, a drop to the chromatic
tables. It now carries **77 notes across 69 selections, 8 of them carrying two,
none above two**, and no name off its letter. Those eight are listed in the spec
rather than merely counted, because pinning only the best case is how "nobody
looked" passes for "somebody decided".

An earlier draft of this paragraph said "77 across 8", which arithmetic alone
falsifies: eight selections holding at most two doubles cannot carry 77 notes. The
`8` counts the selections with *two or more*, which is the number the spec's own
`doubles` array collects — every figure was right and the word "across" was not.

**This forces finding 2 under "M2 decisions".** Degree letters are only as right as
the tonic's letter, and `shouldUseSharps` spells `D#/Eb` sharp. On top of degree
letters that would print E♭ major as D♯–E♯–F##, which is worse than today. So the
fretboard's tonic takes its spelling from the circle's own data, the rule
`keySignatureKind` already states, and finding 2 is fixed as part of this rather
than as a change of its own.

### The alternates row replaces the chord

Settled at the end of M3, from a defect the final review found. The row prints each
option's name from a degree of its own; `chosen` used to write only the four fields
an option names — degree, accidental, shape, height — over the *selected* slot,
keeping its suspension and pinned tensions. So on a `Isus4` slot the row's heading
read "Other shapes on I (Bb Maj)" while the card read `Isus4`, and pressing the
button labelled "B flat diminished" built a B♭ diminished under a surviving sus4,
which is `[0,5,6]` — no named shape — and printed `I?`. A button promised a name
and produced the app's refusal to give one.

So a click on that row now clears the suspension and the tensions along with the
shape, keeping only register — inversion and octave. That is the row's own height
argument one field over: **a shape has a height, so choosing one sets it; a
suspension and a pinned ninth are alterations *of a shape*, and carried onto a
different shape they alter a chord that is gone.**

The alternative — teaching the namer about the slot's suspension so the button
prints what it would really build — loses twice. `SUSPENDED_FIGURES` names six
bases, so ten of the sixteen shapes would print `?` and announce "change to
unnamed chord": ten buttons a user cannot tell apart by sight or by screen reader.
And it leaves the pinned tension untouched, because every shape is offered at its
natural height and a pin at a height the stack does not reach changes no name — so
the round-trip spec that now guards this would have passed with that half of the
bug still in place.

`appendChord` is unaffected: it runs the same function over a fresh slot, where
there is nothing to clear.

The guard is a property rather than a fixture. For every option every group offers,
in every key, `describeSlot` of what pressing it builds must print the button's own
numeral, name and spoken label. One exemption, documented: a secondary dominant's
numeral is a slash numeral measured against its target rather than the key.

### Not in M3

- **Notation spelling.** `NotePitch` carries no letter, so alphaTab spells the
  preview from the key signature and a ♭II chord still engraves on B. The fix is a
  spelling field on `NotePitch`, and it belongs with M4, where the generated track
  becomes a composer track.
- **A thirteenth without its eleventh**, above.
- **Recognition on a key change.** Not needed once the label is re-expressed rather
  than kept.
- **A parse ranked by whether it can be written.** `parseChord` returns the first
  opening that consumes every note, even when that reading turns out to have no
  name — so a handful of chords lose their numeral to a reading that was never
  going to work while a nameable one sat behind it. Two are reachable in three
  palette clicks: Hungarian minor's `III` and double harmonic's `vi`, each at a
  ninth with a sus2. They degrade to `literal`, which is the honest fallback
  rather than a wrong label, and Reset to chord brings them back.

  **Measured after the fact, and the count is those two.** Over every heptatonic
  scale, degree, extent and suspension with no override and nothing pinned — the
  set the palette reaches without the alternates row — thirteen chords come back
  `literal`, and eleven of them already read `base: 'other'`, which means they
  print `?` and light nothing whatever the recogniser says. The two with a name
  to lose are exactly the two above, and both lose it the same way: a ♯9 over a
  suspended second, read as a minor third.

  The fix is not a patch. The parser deliberately knows nothing about keys — that
  separation is what lets `expressInKey` be reused by a key change that never
  parses anything — so "prefer a reading that can be written" cannot be asked
  inside `parseChord`. It means returning every opening's parse and ranking them
  where the key is known, which is a change to the shape of the arrow between the
  two modules. `progression-recognise.roundtrip.spec.ts` holds the count as a
  ratchet at 254 and pins a fixture for each of the two *reasons* a chord is
  refused, with the diagnosis worked through: Hungarian minor's `III` for the
  opening that wins without a name, and a suspended `add9` whose distinct notes
  are a semitone cluster for the reading that was never there to find. Double
  harmonic's `vi` fails the same way the first does and is not pinned separately.
  So the day someone takes this on, the evidence is already written down.

---

## M4 decisions

Settled 2026-09-12, before planning M4, and rewritten after building it. The
plan is `2026-09-12-progression-m4-composer-track.md`. Where these conflict with
anything above — "Build order" and the two paragraphs on the generated track in
particular — these win.

This section was a design before it was a report, and building it disproved
parts of the design. Those paragraphs say so where they stand rather than
holding the new position as though it had always been the plan: an argument that
was wrong is worth more on the page than a claim quietly edited into agreement
with the code. Each one is marked as a correction where it sits.

### Scope

The three the build order names — the generated track in the Composer, Flatten,
MIDI and `.gp` export — **and** the spelling deferral both this document and the
M3 plan pinned to M4: `NotePitch` carried no letter, so a ♭II still engraved on B.

The fourth is not separable from the first three, and the reason is the arrow M4
adds. In M3 a wrong letter was a wrong *preview*: a panel the user is looking at,
beside a roll that spells the same note correctly, and the disagreement is
visible in the moment it happens. In M4 the same wrong letter is written into a
`.gp` file that leaves the app. A preview that misspells is a bug a user can see;
an export that misspells is a bug a user finds in another program a week later.

### The generated track is a real track carrying a marker

`TrackDoc` gains `generated: GeneratedOrigin | null`. The track is an ordinary
member of `ScoreDoc.tracks` in every other respect, and the marker is what the
UI reads to draw the badge, refuse edits, and offer Update and Flatten.

The alternative was a *virtual* track: keep nothing in the document and splice
the projection in when the score is mapped to alphaTab and when it is exported.
It cannot be stale, which is a real advantage, and it loses anyway. `ScoreDoc`
has four consumers that would all have to learn about a track that is not in
`tracks`: the mapper, both export paths, the bar-count invariant stated at the
top of `composer.service.ts`, and every piece of `trackIndex` arithmetic in the
cursor. That is a wide change to buy off one narrow problem.

Materialising it instead means the invariant holds by construction, undo/redo,
alphaTex persistence and both exporters keep working untouched, and **Flatten
costs one field** — which is what "detaches it into an ordinary track" should
cost. The price is a second copy of the truth, and the next three sections are
that price being paid.

### Update is pressed, not inferred

The generated track is rebuilt only when the user asks: Send, Update, Flatten.
Nothing rebuilds it in the background.

The alternative considered first was to treat it as a projection rather than a
document — rebuilt from the live `ProgressionDoc` on every progression change and
after every undo/redo, never committed, so it could not be stale in any state
undo can reach. It was rejected for a reason that turned out to be the design's
best property rather than a mere concession.

`ComposerService.commit()` snapshots the whole `ScoreDoc` for undo. A rebuild
that commits fills the undo stack with edits the user never made; a rebuild that
does not commit lets undo restore a generated track that no longer matches its
source, which is the staleness it was supposed to prevent, arriving through a
door nobody was watching. Both are worse than a badge.

Under the explicit model neither exists, because **every write to the `ScoreDoc`
is a user action** and can go through `commit()` like any other edit. That gives
the property the whole design rests on, and it falls out rather than being built:
undoing an Update restores the old track *and* the old marker, so the stale badge
comes back with it. The document is never left claiming a freshness it does not
have. `composer.service.generated.spec.ts` pins this rather than assuming it —
it is a fact about `ComposerService`'s undo stack, so it is asserted where the
stack is, not in the pure module's spec this section used to name.

The cost is the honest one: a user can read a stale engraving until they notice
the badge. That is a cost the badge is *for*.

### Staleness is one comparison, and it over-reports in the safe direction

`ProgressionDoc` gains `revision: number`, allocated from a monotonic counter on
`ProgressionStore` and stamped onto the document in the single `commit()` in
`progression-history.ts` that every mutation already goes through. The value is
read off the *document*, so undo restores it along with the document it belongs
to and a track undone back to its own source reads as current again. The counter
that issues it never rewinds, so two documents can never answer to one number —
`progression-history.ts` argues both halves at `nextRevision`.

A document counter is coarser than a hash of the projection, so the question is
whether it reports staleness the user cannot see the reason for. It does. This
section used to say otherwise, on the grounds that every field of
`ProgressionDoc` reaches the generated track, and "Reconciling with a score that
already exists" — two sections below — is where that stops being true. Three
cases move the revision while Update would change nothing in the merged track:

- **Tempo, on a score that is not an untouched default.** "Reconciling with a
  score that already exists" gives the score's tempo the win, so `setTempo`
  bumps and the merge ignores the result.
- **Meter, always.** The generated track is barred in the score's meter, not the
  progression's, so `timeSignature` moves a number that changes no bar line.
- **A setter called with the value it already holds.** `setTempo` has no no-op
  guard; `setTempo(120)` on a 120bpm document commits, and so bumps.

A fourth was there before any of the three: `revision` is itself a field of
`ProgressionDoc`, and it reaches nothing. The blanket claim was false on its own
terms the moment it was written.

So the counter **over-reports and never under-reports**, and that asymmetry is
the whole argument for keeping it. A revision that moved when the projection did
not costs a needless Update: one click, and the rebuild it triggers is a
refresh to the identical track. A revision that failed to move when the
projection did costs a badge that says current about an engraving that is not —
a document lying about itself, discovered later and by the user. The two errors
are not comparable, and a check that can only make the cheap one is worth more
than a hash that promises to make neither and has a second copy of the
projection's semantics to keep in step in order to keep that promise.

**A correction: the counter has to be allocated, not derived.** This section
originally said the revision was "bumped in the single `commit()`" and left it
there, as though where the number came *from* were an implementation detail. It
is the whole thing. The first implementation stamped `state.doc.revision + 1`,
which reads as the same idea and counts the *path* rather than the document:
build to 3, let the Composer mark a track `{revision: 3}`, undo one step and make
a *different* edit — the document is 3 again with different content in it, and
the check reports current for a track that was never built from what is on
screen. That is the badge going quiet about the one thing it exists to say, and
it was the milestone's only Critical finding. The issuing therefore moves off the
document: `ProgressionStore.nextRevision` is monotonic and hands out
`nextRevision++`, while the value it hands out still travels on the document so
that undo restores it. A revision is an identity and not a position — undo moves
which number is published, not which numbers are left.

**A load re-issues rather than adopts, and pays for it.** `replaceDocument` is
the one door a document this store did not build comes through, and the
`revision` on it was issued by some other producer. Installed as it stands it is
a number two documents hold — a marker left behind by that producer would later
match a document of ours that happens to reach the same value. So the allocator
is moved past whatever arrived, `Math.max(next, (doc.revision ?? 0) + 1)`, and
the document is then stamped from it like any commit. The trade is stated rather
than hidden: **the number a load shows is not the number the file held**, because
a revision means "this document, in this store" and the only thing worth carrying
across the door is the promise that no two documents answer to one.

That expression has a residual, unfixed and recorded here rather than guarded. A
`NaN` in the arriving field poisons the allocator permanently — `NaN` propagates
through `Math.max`, and a `NaN` revision equals nothing including itself, so
every later comparison reads stale forever. `?? 0` covers the reachable case, a
document written before the field existed; `NaN` is only reachable from a corrupt
document, and there is no loader yet to produce one. Whoever writes the loader
owns this.

**Before adding a field to `ProgressionDoc`, read this.** A field that does not
reach the generated track only widens the over-report, which is acceptable and
needs no more than a line here. The bug to avoid is the other direction: a field
that *does* reach the track and can be written by a path that bypasses
`commit()`. That is an under-report, and it is the thing this design cannot
survive.

### Divergence is a state of the source, not a second check

A score-wide bar insertion shifts a generated track's content while
`ProgressionDoc.revision` never moves. Left alone that is a track which no longer
matches its source, with no signal saying so — the one hole the counter cannot
see, because the edit happened on the other side of the arrow.

The fix is not a second comparison path. `GeneratedOrigin` states its source as a
union, on the `SlotHarmony` and `NotePitch` precedent:

```ts
export interface GeneratedOrigin {
  progressionId: string;
  progressionName: string;
  source: { kind: 'revision'; revision: number } | { kind: 'diverged' };
}
```

Bar insertion and removal set `diverged`; Update clears it. Both read as stale
through one function, `generatedTrackState`, and the union makes it impossible to
hold a revision and a divergence flag that disagree — which a `revision` plus a
`diverged: boolean` would allow on the first line of code that forgot one.

`markDiverged` stamps *every* marked track in the score, and it over-reports in
the same direction the counter does. `appendBar` is the plainest case and the
one the Composer's own toolbar reaches first: a bar added past the end of the
music moves no note in the generated track, the stamp lands anyway, and the badge
stays stale until an Update rebuilds the track byte-identically. The check that
would avoid it — did this bar edit actually touch this track's notes? — is a diff
of the projection wearing a cheaper name, which is the thing "Staleness is one
comparison" already declined to build. So there are two over-reporting
mechanisms and not one, and this is the second: the counter over-reports on
edits to the progression, the divergence stamp on edits to the score.

### Reconciling with a score that already exists

**A correction: there are four collisions, not three.** This section opened by
counting them — Bars, Tempo and Meter — and the count was wrong. Update replaces
a track *in place*, and a track already in the score already has a name, a short
name and a colour that the projection also has an opinion about. That is a
collision like the other three and was decided the same way; it just lived in a
code docstring and a commit message rather than here. Labels are below, as the
fourth bullet the section should always have had.

Four collisions, and the rule for each is the one that cannot destroy work.

**Bars.** `mergeGeneratedTrack` grows `masterBars` to fit the projection and
**never shrinks**, padding every other staff with rests. A progression falling
from eight bars to four leaves four bars of rest rather than deleting bars a
user's own track may be writing in.

**Tempo.** The score's tempo wins. The projection is in beats, so the music is
intact and only the speed differs — and a progression that silently re-tempos a
score the user has been working in is the worse failure. On an untouched default
score, Send adopts the progression's tempo instead.

**Meter.** The generated track's bars are shared `masterBars`, so it must be
barred in the *score's* meter and not its own. This is free: `RollNote` beats are
quarter notes and the projection's grid is meter-independent — `progression-score.ts`
says so under "A beat is a quarter note" — so projecting `{...doc, timeSignature:
scoreMeter}` re-bars without moving a note, and `progressionToScore` needs no new
argument. `progression-track.spec.ts` asserts it as a property: the multiset of
`(absolute beat, midi)` attacks is identical across 4/4, 3/4 and 6/8.

**Labels.** The track's own win. Replacing in place keeps its `name`,
`shortName` and `color`; the projection has one constant for each, so taking the
projection's would overwrite three deliberate choices with three defaults. Those
three and no more — everything else a `TrackDoc` carries is either the music
Update exists to refresh or the link itself, and preserving those would make
Update a no-op.

The justification is the asymmetry alone, and it is worth being exact about that
rather than claiming more. Neither a rename nor its silent reversion is
observable today: there is no rename control on a track at all, and nothing in
the app writes `TrackDoc.name` after the track is born. So this rule costs
nothing today and buys nothing today. It is chosen for the day a rename control
lands, on the same reasoning as every other rule here — a stale label is a label
the user retypes, and a rename Update reverted underneath them is work that is
simply gone. The marker's own `progressionName` is rebuilt with the rest of the
marker, so anything wanting the progression's *current* name has it there; see
"Where the controls are" for which of the two the badge reads.

Bar 1's signature is the one used. See "Not in M4" for what that costs.

**Growing the score means padding it, and padding is not defaulting.** The
invariant `composer.service.ts` states — every staff of every track has exactly
`masterBars.length` bars — makes growth a padding job across every track,
generated or not. Two things about the bars that get appended were not in the
design and are load-bearing.

The padded bar carries the staff's **own** clef, ottava and key signature
forward, copied off `staff.bars[last]`, which is what `insertBar` already does
for the same reason. `createDefaultBar` alone writes `g2` and C major, and the
Composer routinely holds neither: `composer-library-panel.component.ts` and
`composer.component.ts` both `replaceDocument` a `.gp` file mapped into a
`ScoreDoc`, so a bass staff in `f4` with three flats is the ordinary case and not
the exotic one. Padding it with the defaults would append treble-clef,
no-accidental bars to its tail and the notes a user then wrote there would read a
fifth and three accidentals away from the rest of the staff. Those three fields
and no others: they describe *how the staff is written*, where `voices` is what
is written in it, and copying that would duplicate the last bar's music into
every bar of rest the padding exists to produce.

The padded bar's meter must be asked of the **merged** master bars, not the
score's and not the projection's. Only bar 0 carries a signature and the rest
inherit it, so `effectiveTimeSignature` answers correctly for an appended bar
only when it is walking the array the merge is about to install. Asking either
input is right whenever the two agree and wrong exactly when they do not, which
is the shape of bug that ships.

**The meter precondition is enforced, not documented.** `mergeGeneratedTrack`
cannot check that the track it is handed was projected in the score's meter — a
projected bar's beats are the only record of what it was barred in, and reading
them back would be guessing — so the check lives where both halves are known.
`sendProgression` calls `requireScoreMeter` and **throws**: this is a caller's
bug rather than a user's input, and both quiet answers are worse, since merging
corrupts a document the user has been working in and returning does nothing where
the user pressed a button. `ComposerService.scoreMeter` exists so the fix at a
call site is one word rather than an expression copied out of a docstring.

It compares bar 1 against bar 1 and no further, which is exactly as wide as the
projection is: `progressionTrack` bars the whole track in the single meter it is
handed, so one comparison decides whether that meter was the right one. What it
cannot decide is whether the *score* keeps that meter — a score that moves to 3/4
at bar 9 passes the check and still gets a generated staff whose bar lines
disagree from bar 9 on. That is the limitation recorded under "Not in M4", and
the guard points there rather than implying it covers more than it does.

### Saving refuses rather than flattening

`CompositionEntry` stores a composition as alphaTex, deliberately — "compact,
human-readable, diffable, and immune to `ScoreDoc` schema drift". alphaTex has no
property that would round-trip a marker through alphaTab's own exporter, so a
saved composition cannot carry one.

Three ways out, and the middle one was chosen. Flattening silently on save is a
change to the user's document that they did not ask for and would not discover
until they reopened it. Storing the marker beside the tex keeps a link whose far
end — a `ProgressionDoc` with no persistence of its own — may not exist when the
composition is reopened, which is a dangling reference dressed up as a feature.

So `Save` and `Save as copy` refuse while a generated track exists, and the
refusal offers **Flatten and save**: the chore is one click without becoming
implicit. Export is not blocked. An exported file has already left the app and
has nothing to stay linked to.

**The refusal has to remember which save was asked for.** The design said only
that saving refuses and offers to flatten, and stopped a step short: the offer
resumes a command, so it has to resume the right one. A refused `Save as copy`
finished as an overwrite would destroy the original the user was deliberately
keeping — and it would do it as the consequence of accepting a chore they only
accepted in order to get the copy. So the pending offer carries `asNew` beside
its text, and the two are one object rather than two fields written together by
convention: nothing makes a writer that updates one and forgets the other fail,
and forgetting is exactly this path.

**The offer has to be safe to fail.** `Flatten and save` is two steps and the
second one reaches IndexedDB, where quota, private browsing and a failed version
upgrade are ordinary outcomes. By the time one lands the flatten has already
committed, which is precisely the state the refusal exists to prevent: the
user's document changed in a way they did not ask for and nothing was written in
exchange. Reporting that in the panel's ordinary error paragraph is not enough,
because the region the user was reading — and had just pressed a button inside —
is torn down at that moment. So the failure goes back through the same announced
region the refusal used, saying the three things in order: what changed, that
nothing was written, and that undo puts it back.

**Flattening two linked tracks costs two undo entries for one click.**
`flattenTrack` takes a single index and commits, so the loop behind
`Flatten and save` lands one entry per track and one press of undo restores one
link. That is a real wart rather than a decision that came out well — the atomic
version is a `reduce` over the pure `flattenGeneratedTrack` inside one `commit`,
which is a small change. It is left alone because two progressions in one score
is rare, and the failure message spells the count out rather than letting the
user discover it by pressing undo once and finding half a link back.

### A letter on `NotePitch`

The pitched variant gains `letter?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'`.
Absent means exactly today's behaviour — spell from the key signature — so every
note the Composer already holds is unaffected and only the projection populates
it.

**Why the letter and not the accidental.** alphaTab's `NoteAccidentalMode` can
express this: the accidental kind plus the pitch class determines a letter
uniquely, so widening `NoteDoc.accidental` to mirror the enum 1:1 would have
worked, and would have matched the convention `composer.model.ts` states for
`NotePitch` itself. It loses because the progression *knows a letter*.
`progression-spelling.ts` exists precisely because "a preference chooses between
two names for one pitch class; it cannot choose a letter". Storing the accidental
would make the projection derive an alphaTab encoding on the way out, in a module
that has no other reason to know alphaTab exists. The letter states the musical
fact; the mapper translates it, which is the mapper's whole job.

**The mapping, and why it is key-independent.** `alter = pitchClass −
naturalPitchOf(letter)`, normalised into ±6 and then required to be within ±2:
`−2 → ForceDoubleFlat`, `−1 → ForceFlat`, `0 → Default`, `+1 → ForceSharp`,
`+2 → ForceDoubleSharp`. Past ±2 the letter is dropped and the note falls back to
`Default` — the same refusal `spellAt` already makes at a double accidental, one
layer out.

This was read out of the bundle rather than out of the enum's doc comments, which
describe displacement relative to a default position they never state.
`AccidentalHelper.getNoteValue` displaces the note by exactly the forced
accidental (`ForceFlat` +1, `ForceDoubleFlat` +2, `ForceSharp` −1,
`ForceDoubleSharp` −2) and then draws *that* value's line under the key signature,
with the forced glyph. The displaced value is always the target letter's natural
pitch — always a white key — so the key signature can never ambiguate the line.
Pitch class 11 with `ForceFlat` is C♭; pitch class 0 with `ForceSharp` is B♯.

**A correction: no spec can watch that reading.** This section originally said that
because the behaviour is read from a dependency, the spec asserts it directly, and
that if alphaTab changed it the assertion would say so. That was wrong, and the
spec header repeated it until review caught it. `AccidentalHelper` is exported from
neither the typings nor the bundle, so the helper cannot be called; a spec can only
mirror the displacement in a switch of its own, and a mirror cannot notice the
original moving. Flip `ForceFlat`'s sign upstream and every spelling spec stays
green.

What the specs do check is a different and still useful thing: that mirrored switch
is an independently written oracle for the same table `ALTER_BY_MODE` holds, and the
sweep pins the mapper against it over every letter, every pitch class within a double
accidental, and three key signatures — one flat, one sharp and C major, so the
key-independence claim is exercised rather than assumed. The tripwire for the
dependency itself is coarse and version-shaped: one spec asserts the
`@coderline/alphatab` version `client/package.json` declares equals the one
`AccidentalHelper.getNoteValue` was read at, so a bump fails and sends the next
person back to re-read the four Force* cases before moving the string.

**Why `ForceNatural` is not the mode for a natural letter.** Alter 0 maps to
`Default`, which loses information — a note with no letter also carries
`Default`, so a natural letter does not survive the round trip back into a
`NoteDoc`. `ForceNatural` would fix that, and it is still not taken. The enum's
doc comment says the mode moves the note one line down and applies a naturalize;
1.8.0 does neither. Neither `AccidentalHelper.getNoteValue` nor
`ModelUtils.computeAccidental` has a case for it, so it falls through and renders
exactly as `Default` does. The reason to decline it is therefore not the phantom
♮ it was first suspected of drawing — it draws nothing — but that adopting it
would buy a round-trip nicety on the strength of a documented behaviour the
bundle does not implement, and would go wrong in whichever direction a later
version resolved the contradiction. The lossiness it would fix costs nothing:
alphaTab puts a white pitch class on its own letter under every key signature.

**Forcing a mode does not print redundant accidentals.** The obvious worry about
lettering every note — that a diatonic B♭ in B♭ major would be engraved with a
flat the key signature already gives it — does not happen, and the reason was
read out of the bundle rather than assumed. `computeAccidental` suppresses the
glyph when the forced accidental matches the one the key signature has set for
that note, and it is indexed by the **displaced** value, which is the target
letter's natural pitch. So a B♭ asked for on the letter B displaces to B natural,
finds the key signature already flatting that line, and prints no glyph; a C♭
asked for in the same key displaces to C, finds nothing, and prints the flat that
makes it a C♭. Diatonic notes are unaffected, which is why lettering *every* note
rather than only the chromatic ones is safe.

**A correction: the projection letters every note, with no scale gate.** An
optional `letter` invites a condition on writing one, and the first
implementation took the invitation: `scaleIntervals.length > 0 ? slotSpeller(…) :
null`, which reads as prudence and is a bug. `buildRollView` calls `slotSpeller` with
the identical expression and **no gate at all**, so any gate on the score side
would by construction be the only way the roll and the staff could print
different letters for one note — which is the exact failure "Nothing new computes
the letter" exists to prevent, reintroduced one layer down. An empty scale is not
a special case to the speller; it answers from `preferSharps`, the same way it
answers for a scale that resolves but has no degree letters to offer.

One expectation moved deliberately as a consequence, and it is not an
improvement in itself: a document whose `scaleId` resolves to nothing now
engraves a plain `B` where a C♭ is wanted. That is the right answer anyway,
because it is exactly what the roll draws beside it — a wrong letter both
surfaces agree on is a bug; two surfaces disagreeing about one note is a bug plus
a reason to distrust both. `pitchOf`'s `letter` stopped being optional at the
same time, since `slotSpeller` always has one to give — the optionality on
`NotePitch` itself stays, because that is where a Composer-entered note with no
letter still lives.

**A misnomer this shows up, recorded rather than fixed.**
`NoteDoc.accidental: 'explicit'` maps to `ForceSharp`, which forces a *sharp* in a
flat key. `letter` subsumes it correctly, so the rule becomes: a letter decides
the mode, and `accidental` only speaks when there is no letter. Composer-entered
notes keep the old path and the old bug, which is M4's to leave alone.

**Nothing new computes the letter.** `piano-roll-view.ts` already holds the rule —
chord tones from the slot's degree first, scale degrees second, the key's
preference last — in a local `chordToneSpellings`. That rule moves out of the view
into `progression-spelling.ts` as an exported `slotSpeller`, and both the
roll and `progression-score.ts` call it. One implementation, because the letter
the roll labels a key with and the letter the score engraves must be the same
letter, and this document already records what happens when one rule lives in two
files.

### MIDI without an engraver

`ComposerExportService` gains `toMidi(score, settings)` — `MidiFile`,
`AlphaSynthMidiFileHandler` in SMF1 mode, `MidiFileGenerator.generate()`,
`toBinary()` — and loses `downloadMidi(api)`.

The old one delegated to `api.downloadMidi()` and so required a *rendering*
alphaTab instance: one export of three with a precondition the other two do not
have. On `/progression` that precondition would be the notation panel being open,
which is a rule no user should have to learn. With `toMidi` there is no api to
need, and both pages run the same three steps — build a `ScoreDoc`,
`mapper.toScore(doc, new alphaTab.Settings())`, hand the score to the exporter.

**Two flags the design did not name, both required.** `MidiFile.format` must be
set to `MidiFileFormat.MultiTrack`. alphaTab's default is SMF type 0, which
funnels every event into one track, so a two-track score would arrive in a DAW as
one track of merged channels — which is not what a user pressing Export MIDI on a
multi-track score is asking for, and is silent when it happens.

**A correction: `smf1Mode: true` is not there for the reason it looks like.**
The plausible reading — that it is what alphaTab uses to play a score, so it is
the well-trodden path — is backwards. All four of alphaTab's own *player* paths
construct `AlphaSynthMidiFileHandler` with the flag left false; the only place it
passes `true` is its own `downloadMidi`, which is the file-writing path and not
the playing one. The real reason is what the flag switches off: with it false,
`addRest` emits a vendor `AlphaTabRestEvent` that only alphaSynth understands, so
a file written without it carries events no other program can read. The
documented cost of turning it on is that multiple bends sharing a beat may break,
which the progression's projection cannot produce.

**A truncated projection refuses to export.** `progressionToScore` caps at
`MAX_PREVIEW_BARS` and reports `truncated`; the preview can afford to draw 512
bars and say so beside them, because the message sits next to the music. A file
outlives the message, so an export that silently dropped bars would be a file
that lies. At 512 bars — around twenty minutes of 4/4 at 100 BPM — this is
reachable only through `setSlotLength(id, 1e9)`, which is the case the bound
exists for.

### Open: what `.gp` export does with a C♭

**Not settled, and recorded here so it is not mistaken for settled.** Reading
alphaTab's Gp7 exporter suggests it misspells the exact cases M4 exists to fix.
`GpifWriter._writePitchForValue` starts from the note's default spelling under
the key signature and then applies the forced accidental, and it only *displaces*
the step when that default spelling is already a sharp. So a D♭ exports correctly
— pitch class 1 defaults to C♯, the `#` is seen, the value moves and the step
becomes D. A C♭ does not: pitch class 11 defaults to a plain B, there is no sharp
to see, no displacement happens, and the file is written with step `B` and
accidental `b` — **B♭**. B♯ goes the same way and writes as C♯.

Three things keep this an open question rather than a recorded limitation.
Nobody has opened an exported file in real Guitar Pro, which is the only thing
that can settle what a reader actually draws from those fields. Our own reload
survives regardless, because alphaTab's importer takes the pitch from the
`Octave` and `Tone` properties and reads only the accidental out of the `Pitch`
element — so a round trip through this app looks correct and would hide the
problem from exactly the test most likely to be written. And until the hand-check
is done there is no way to tell an upstream bug report from a misreading of the
writer.

**The hand-check comes before this is written up as either.** Export a ♭II in B♭
major to `.gp`, open it in Guitar Pro, and look at the note. If it reads B♭ the
finding stands and the choice is an upstream report or a limitation recorded
beside the others; if it reads C♭ the reading above is wrong and this section
goes. Nothing in the code should be changed on the strength of it in the
meantime.

### Where the controls are

Everything has an existing home; M4 adds no new page furniture.

The Composer's **Tracks panel** draws the badge and gains Update — enabled only
when stale — and Flatten. Remove stays: removing the track is not an edit of the
progression. Note- and beat-level commands refuse when the cursor's track carries
a marker, but the cursor can still *select* it, because a read-only track the
caret cannot even rest on is worse than useless. **Save** and its refusal live in
`composer-library-panel`, beside the Export buttons they sit with today.

**The gate covers the write and stops there.** `applyDurationAtCursor` has two
effects and only one of them is the generated track's business: the score is the
track's, the input duration is the *toolbar's*, and the toolbar belongs to
whichever track the caret moves to next. Refusing both is what a quick read of
the gate suggests, and it is wrong twice over. Every route to the input duration
runs through that one method — the palette, the dot toggle and the `+`/`-` keys —
so a blanket refusal freezes the duration palette outright for as long as the
caret rests on a generated track, which the sentence above explicitly permits it
to do. It also takes away the pre-selection: choose a duration while looking at
the generated track, move back to your own, and type. Nor is there an atomicity
to protect, since a caret on an empty beat already returns early and lands an
empty commit with the choice remembered anyway. What is left is the honest half —
a toolbar showing a duration the score under the caret does not have, which is
what an *input* duration means everywhere else in the editor.

The progression page's **rail** gains a third block after Key and Sound, holding
Send to Composer, Export MIDI and Export `.gp` — written in the same voice as the
two above it, which say where a control is and what it means rather than naming
it.

Send to Composer and "Add progression track" in the Tracks panel are two buttons
over one service call. The push is where the user made the thing; the pull is
where the thing will appear, and is where Update and Flatten have to live anyway.

**Send is also Update, and says which.** There is no second method on the page.
`sendProgression` merges — replacing the track it already wrote and appending
only when there is none — so a second press refreshes rather than leaving a
second track behind, and the button's label reads `Send to Composer` or
`Update in Composer` according to `generatedTrackState`. It distinguishes only
those two and deliberately not the third: `stale` versus `current` is a fact
about a document the user is not looking at, and the badge that reports it lives
beside the track. Pressing Send then navigates to `/composer`, which is why the
call sits in the component rather than in a service — the projection and the
merge are the service's, the navigation is the page's.

**Send refuses a truncated projection, and for a stronger reason than the
exports do.** An export refuses because a file outlives the message beside it;
Send refuses because the message cannot reach the result at all. The page
navigates, so the rail carrying the warning is gone a moment later, and nothing
on the other side would repeat it — a `GeneratedOrigin` records which revision a
track came from, not how much of it arrived, so the Composer has no fact to draw
a badge from. The truncated track would then be saved to the library and
exported from over there as though it were the whole progression: the same lie
the export refusal prevents, told one page further from the user. Warning and
proceeding loses on the same ground — a warning nobody is left looking at is not
a warning.

**The badge reads the marker's name, not the track's.** "From …" is
`marker.progressionName` and it has to be, because the collision rule above
preserves the incumbent track's `name` across an Update: the track's label is the
user's and goes stale on purpose, so it is the wrong thing to name a *source*
with. That makes the marker's copy the one that has to be right, which is why
both names a generated track carries are resolved through one function — a raw
`ProgressionDoc.name` is how the badge came to read "From Untitled" about a track
labelled "Progression".

**Clicking a generated notation staff still auditions the note it will not
write.** The edit gate lives in `ComposerService`, so the click reaches
`placeClickedPitch`, sounds the pitch, and then hands a write to a command that
refuses it. That is arguably the right behaviour — audition-on-read is what a
read-only staff should do under a pointer, and the alternative is a track you can
look at and not hear — but it is currently *unconsidered* rather than chosen, and
recording it that way is the honest version. Whoever next touches the click path
should decide it deliberately.

### Two conventions the milestone found out about

**`CLAUDE.md` §6 is out of step, and it is §6 that is wrong.** It says methods
are "camelCase, verb-first". This codebase names a pure derivation for **what it
returns** and has done since well before M4: `progressionToScore`,
`keySignatureOf`, `slotSpeller`, `barBeats`, `letterOf`, and now
`progressionTrack` and `generatedTrackState`. The rule as written would have
`getProgressionTrack` and `computeBarBeats`, which reads worse and says less —
`barBeats(timeSignature)` is a noun because the thing it hands back is a number
of beats, not an action. The verb-first rule is right for commands, which is
where it came from and where every method it names lives. What is wanted is a
line in the §6 table admitting the second convention, not a rename sweep; the
rename would touch every call site in the projection to make the code agree with
a sentence.

**M4's specs were written beside their bases, not appended to them.** Four went
into files of their own under the repo's existing `<base>.<aspect>.spec.ts`
convention — `progression.component.export.spec.ts`,
`progression-score.spelling.spec.ts`, `score-doc-mapper.spelling.spec.ts` and
`composer.service.generated.spec.ts`. Appending them would have put
`progression.component.spec.ts` over the 1000-line cap on its own, so one of
these is a cap that would have been hit; the other three are the same choice made
before it had to be. The seam is what the file *measures* rather than a line
number, which is how the source modules are cut too: a spec named for an aspect
is one a later reader can decide to read or skip, where a spec named for a half
is one they have to open to find out.

### Not in M4

- **A score that changes meter mid-way.** The generated track is barred by the
  score's *first* time signature, so in a score that moves to 3/4 at bar 9 the
  generated track's bar lines disagree from there on. Fixing it means teaching
  `placeProgressionNotes` and `writeBar` a per-bar signature — correct in all
  cases, and a change to a module three other things depend on, for a score shape
  this page has no other reason to produce. Filed here with the other known
  limitations rather than half-done.
- **`insertBar(0)` erases a score's declared meter.** `createDefaultMasterBar()`
  writes `timeSignature: null`, and `insertBar` copies clef, ottava and key
  signature off a neighbouring *bar* but takes nothing from the neighbouring
  *master* bar. So inserting at index 0 in a 3/4 score leaves a bar 1 that
  declares nothing, and `effectiveTimeSignature`, walking backwards and finding
  no signature at all, falls through to its hardcoded 4/4 — to the meter guard
  and to the padding alike. The score's own 3/4 has moved to what is now bar 2
  and still declares itself there, so a uniform 3/4 score has quietly become a
  score that changes meter at bar 2, which is the limitation above arriving by
  accident. `requireScoreMeter` does not catch it: every caller derives the meter
  from bar 0 the same way the guard does, so both sides agree on 4/4 and the
  refusal never fires — the projection is merged, correctly barred against a
  wrong answer. Pre-existing, and it earns an entry here because M4 promoted
  `effectiveTimeSignature(masterBars, 0)` to *the* definition of the score's
  meter and gave a latent oddity in bar insertion something to break.
- **A generated track's id is not unique after flatten-then-Send.** Flatten
  clears the marker and keeps `progression-<uuid>`, so the next Send finds no
  marker to match, appends, and leaves the score holding two tracks with one id.
  Harmless today — every lookup here matches on the marker and nothing reads
  `TrackDoc.id` — and deliberately not fixed in Flatten, because rewriting the id
  on the way out would spend the "Flatten costs one field" argument that made the
  marker a field on a real track in the first place. If the id ever becomes
  load-bearing, the de-duplication belongs in `mergeGeneratedTrack`'s append
  branch, which is the only place a second track wearing an existing id is made
  and which already holds the score to check against.
- **More than one generated track.** One `ProgressionDoc` exists at a time, so
  there is no second progression to send and no "which one?" to ask. A
  progression library would change that, and would also give the marker a far end
  worth persisting — the two belong together, in that order.
- **The three limitations M1–M3 recorded** are untouched: `quantizeBar` has no
  note-off so a staccato roll still engraves legato, `BeatDoc.dynamics: null` is
  still documented as "inherit" with nothing implementing it, and `parseChord`
  still returns the first reading that consumes every note. The second of these
  now reaches an exported file as well as a preview, which raises its priority
  without changing what it is.
