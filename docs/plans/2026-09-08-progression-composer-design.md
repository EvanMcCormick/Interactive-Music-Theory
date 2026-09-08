# Progression Composer — Design

**Date:** 2026-09-08
**Status:** Designed. Not yet implemented.

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

Three consequences worth knowing before that lands:

1. **`alter !== 0` with `quality === null`** has no diatonic chord to inherit a
   shape from. Reject the combination or document a default; do not let it fall
   through to today's silent transposition.
2. **`ChordQuality` names only triads and sevenths**, so an override at extent
   9, 11 or 13 has no name to build from. Either the override adjusts the third,
   fifth and seventh against the diatonic stack and leaves the extensions
   diatonic, or overrides are refused above extent 7.
3. **It invalidates a tested constant.** `OCTAVE_MAX = 2` was measured by
   sweeping the real pipeline *including* `alter`, and the 33-semitone maximum
   reach depends on `alter` meaning what it means today. Changing its semantics
   requires re-deriving that bound.

**Why M1 does not care.** `createDegreeSlot` hardcodes `alter: 0`, no M1 setter
changes it, the palette emits only diatonic degrees, `romanNumeral(degree,
quality)` takes no `alter`, and nothing persists a document — so there is no
migration cost either. It goes live at **M3**, where the recogniser's
neighbourhood search varies root alteration as one of its axes: under today's
semantics that axis generates wrong-quality candidates, and the recogniser would
be matching pitch sets against chords nobody would write.
