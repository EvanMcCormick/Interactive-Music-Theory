import {
  BarDoc,
  BeatDoc,
  ClefKind,
  DynamicValue,
  KeySignature,
  MasterBarDoc,
  NoteLetter,
  NotePitch,
  ScoreDoc,
  StaffDoc,
  TimeSignature,
  TrackDoc,
  createDefaultMasterBar,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import { ProgressionDoc, ProgressionKey } from '../models/progression.model';
import {
  DEFAULT_VELOCITY,
  VELOCITY_MAX,
  VELOCITY_MIN
} from '../models/progression-normalize';
import { FinestDivision } from '../models/transcription.model';
import { CirclePosition, keySignaturePosition } from './circle-of-fifths.data';
import { letterOf, reduceToOctave } from './note-spelling';
import { slotSpeller } from './progression-spelling';
import {
  PlacedNote,
  WrittenNote,
  chordToleranceBeats,
  quantizeBar
} from './transcription-quantize';

/**
 * Projects a progression into notation.
 *
 * The last arrow of the design doc's data flow, and the shortest: `RollNote[]`
 * to `quantizeBar` to `ScoreDoc`, from where `ScoreDocMapperService` already
 * takes it to alphaTab. `quantizeBar` does the hard half - a bar that sums to
 * exactly one bar, spans cut where they would hide a beat, ties where no single
 * value fits - and it is reused rather than reimplemented.
 *
 * Pure, with no Angular and no audio dependency, on the `score-derivation.ts`
 * precedent, which solves the same shape of problem for transcription and is
 * the model for everything below: place first, then quantize bar by bar, and
 * hand back what the caller cannot recover from the score alone.
 *
 * ## What this module actually has to decide
 *
 * A progression's slots do not line up with bars. `reflow` makes them
 * contiguous and nothing makes them land on a bar line: a slot can be one beat
 * or seven, and a note may sit past the end of the slot that owns it. So the
 * work here is to flatten every slot's notes into one absolute timeline, cut
 * that timeline into bars, and hand each bar to `quantizeBar` on its own.
 *
 * ### A beat is a quarter note
 *
 * `RollNote.startBeat` and `ChordSlot.startBeat` count quarter notes, because
 * `buildSchedule` converts them with `60 / tempo` and never looks at the meter -
 * that is Tone's BPM convention and the transport is the definition of what a
 * beat means here. `PlacedNote.beatInBar`, by contrast, counts *denominator*
 * units, which in 6/8 are eighths. The two frames differ wherever the
 * denominator is not 4, and `barBeats` and `denominatorUnits` are the only two
 * places that cross between them.
 *
 * This also settles a caveat `MIN_NOTE_BEATS` records against itself. Its
 * docstring worries that a floor of one sixteenth of a beat is finer than the
 * finest notatable event in compound meter, on the reading that a 6/8 beat is a
 * dotted quarter. It is not, in the frame the roll and the transport use, and
 * the grid this module lays down is meter-independent in any case: a slot is
 * `4 / finestDivision` quarter notes wide whatever the denominator, which at 64
 * is exactly `MIN_NOTE_BEATS`. Nothing the roll can store is too fine to write.
 *
 * ### A note is engraved on the letter its degree names
 *
 * The projection writes a `NotePitch.letter` on every note, so B flat major's
 * borrowed `♭II` engraves as a C flat chord rather than as the B major one
 * alphaTab reads out of a two-flat signature and a bare pitch class. The rule
 * is `slotSpeller`'s and belongs to neither this module nor the roll, which is
 * the point of it living in `progression-spelling.ts`: the letter drawn on a
 * keyboard key and the letter engraved on the staff are one letter.
 *
 * The scale arrives as a parameter, because `key.scaleId` resolves through
 * `MusicTheoryService` and this module is pure. It defaults to empty, which is
 * what an id that did not resolve looks like, and **every note is lettered all
 * the same** - from `preferSharps`, which is the only answer left once no
 * degree can be named. That is not the score inventing a spelling: it is the
 * spelling the roll is already drawing on its keyboard for the same note, and
 * the two agreeing is the whole reason the rule was lifted into
 * `progression-spelling.ts`. Leaving the note unlettered instead would hand it
 * to the key signature, which is the one participant with an opinion of its
 * own - a flat-preferring key labelled `Gb` on the roll and engraved `F♯`.
 *
 * See `placeProgressionNotes`, which is where the letters are actually decided
 * and why they are decided there.
 *
 * ### A note crossing a bar line is tied, not truncated
 *
 * `quantizeBar` works one bar at a time, so a note sounding across a bar line
 * has to be either cut short at the line or continued into the next bar. The
 * notation convention is a tie, and it is also the honest one: truncating would
 * draw a rest under a note that is still sounding. So a crossing note is
 * *placed twice* - struck in the bar it begins in, and again at beat 0 of every
 * later bar it sounds through, marked `isHeld` so `writeBar` can tie it. See
 * `placeProgressionNotes`.
 *
 * ### A note is written until the next attack
 *
 * The one thing `quantizeBar` could not give this module. It is onset-driven:
 * a chord runs until the next chord starts, and a gap before the first onset
 * becomes a rest. There is no way to say that a note was *released* early, so
 * `RollNote.lengthBeats` decides only which bars a note reaches, never how long
 * it is drawn for. A staccato roll comes out legato, and a lone eighth in an
 * otherwise empty 4/4 bar is written as a whole note rather than as an eighth
 * and a rest.
 *
 * That is the transcription convention - a detected note holds until the next
 * attack - and it is right for a progression's ordinary content, which is block
 * chords filling their slots. Fixing it means teaching `quantizeBar` a note-off,
 * which is a change to a module three other things depend on and not one to
 * make from here.
 */

/**
 * The grid the projection quantizes onto.
 *
 * 64 is the finest `FinestDivision` offers and is chosen so that nothing the
 * roll can store is lost: a slot on this grid is `4 / 64` quarter notes, which
 * is exactly `MIN_NOTE_BEATS`, the roll's own floor. A coarser grid would round
 * the shortest notes a drag can make onto their neighbours.
 *
 * It costs nothing in the common case. `finestDivision` sets the resolution of
 * the grid and not the density of the spelling: `slotsToDurations` still writes
 * a bar-filling chord as one whole note, because it decomposes longest-first
 * within the metric frame rather than counting slots.
 */
export const PROGRESSION_FINEST_DIVISION: FinestDivision = 64;

/**
 * Bars the preview will draw before it gives up.
 *
 * A bound rather than a preference. `normalizeLengthBeats` floors a slot's
 * length and deliberately gives it no ceiling, so `setSlotLength(id, 1e9)` is
 * reachable through the public API and would ask this module for two hundred
 * and fifty million `MasterBarDoc`s. Every one of them is an object, a full bar
 * of rests and a pass over the placements, and the page would simply stop.
 *
 * 512 bars is around twenty minutes at 100 BPM in 4/4 - longer than anything
 * this page is for - and the excess is *reported* rather than swallowed: see
 * `ProgressionScore.truncated`, which exists so the preview can say that what
 * is drawn is not all there is.
 */
export const MAX_PREVIEW_BARS = 512;

/**
 * Slack for comparing beat positions, in quarter notes.
 *
 * Slot starts accumulate through `reflow`, note starts are floats a pointer
 * chose, and the question this module asks of them - does this note reach past
 * the bar line - is exactly the one where a bar-length sum landing a
 * millionth short writes a spurious tie into an otherwise clean bar. Well below
 * `MIN_NOTE_BEATS` by four orders of magnitude, so it can never merge two
 * positions the roll can tell apart.
 */
const BEAT_EPSILON = 1e-6;

/** Below this, everything a progression is playing reads better on a bass clef. */
const MIDDLE_C = 60;

/**
 * Scales written with a minor key signature.
 *
 * `KeySignature.mode` chooses between the major and the minor label for the
 * same set of accidentals, so this decides only how the key is *named*, never
 * which accidentals are drawn - `keySignaturePosition` answers that, from the
 * parent major.
 *
 * Every id here is one `MODE_OFFSETS` gives a signature to and whose third is
 * minor. A scale with no signature is left out however minor it sounds:
 * `keySignatureOf` has already declined to place it, and calling the empty
 * signature "minor" would be a second claim about a key this module could not
 * find. That leaves the four diatonic modes with a minor third, the harmonic
 * and melodic minors, Hungarian minor, and the two modes of harmonic minor
 * whose own third is minor - locrian ♮6 and dorian ♯4.
 *
 * A modal progression is not really in a major or a minor key at all, and this
 * is the closer of the two answers rather than the right one; there is no third
 * value to give.
 */
const MINOR_MODES: ReadonlySet<string> = new Set([
  'dorian',
  'phrygian',
  'aeolian',
  'locrian',
  'harmonicMinor',
  'harmonicMinorMode1',
  'melodicMinor',
  'melodicMinorMode1',
  'hungarianMinor',
  'locrianNat6',
  'dorianSharp4'
]);

/**
 * A note placed in a bar, and what the projection needs to remember about it.
 *
 * The shape `PlacedDetection` has in `score-derivation.ts`, for its reason:
 * `PlacedNote` carries a position and a pitch and nothing that names the note
 * it came from, so a caller that has to say something about a written note
 * afterwards keeps its own record beside it. `placed` is handed to
 * `quantizeBar` and comes back by identity in its `written` list, which is what
 * links the two.
 */
export interface ProgressionPlacement {
  /** The note as the quantizer wants it: a position in the bar, and a pitch. */
  placed: PlacedNote;
  /** The pitch it was built from, so the clef and the de-duplication can compare. */
  midi: number;
  /** MIDI velocity of the `RollNote` behind it, 1-127 on the editing path. */
  velocity: number;
  /**
   * True when this is the tail of a note struck in an earlier bar rather than
   * an attack of its own.
   *
   * A held placement always sits at `beatInBar` 0 - it is what the bar line cut
   * - and `writeBar` ties every fragment it produces.
   */
  isHeld: boolean;
}

/** A projected progression, and what the score alone cannot say about it. */
export interface ProgressionScore {
  doc: ScoreDoc;
  /**
   * Bars the progression occupies, before `MAX_PREVIEW_BARS` is applied.
   *
   * Never below 1: an empty progression is drawn as one bar of rest, because a
   * score with no bars is one alphaTab draws nothing for and one
   * `ComposerService.replaceDocument` throws on.
   */
  barCount: number;
  /** True when `doc` holds fewer bars than `barCount`. See `MAX_PREVIEW_BARS`. */
  truncated: boolean;
}

/**
 * How many of the progression's beats a bar holds.
 *
 * In quarter notes, the frame `ChordSlot.startBeat` and `RollNote.startBeat`
 * count in - so 4/4 gives four and 6/8 gives three, not six. See the class
 * docstring: the numerator counts denominator units and a progression's beat is
 * a quarter whatever the denominator says.
 */
export function barBeats(timeSignature: TimeSignature): number {
  return (timeSignature.numerator * 4) / timeSignature.denominator;
}

/** A position in quarter notes, expressed in the meter's own denominator units. */
function denominatorUnits(quarters: number, timeSignature: TimeSignature): number {
  return (quarters * timeSignature.denominator) / 4;
}

/**
 * MIDI to the pitched half of `NotePitch`, the inverse of `pitchToMidi`.
 *
 * `letter` is the staff letter to engrave on, and it is required, because
 * `slotSpeller` always has one to give: a scale it cannot read degrees from -
 * or no scale at all - falls through to the key's preference rather than
 * declining. `NotePitch` still documents an absent `letter` as "spell from the
 * key signature", and that state is reachable from the mapper's reverse
 * direction; it is no longer reachable from here, and the projection does not
 * keep a branch for a case it cannot produce.
 *
 * The octave is *not* adjusted to the letter's, and deliberately. A C flat
 * sounds where B does and this pair is read by `pitchToMidi`, which has to give
 * the pitch back; alphaTab does the same arithmetic on its own side, displacing
 * the note by the forced accidental before it picks a line, so the C flat lands
 * an octave above the B without either end having to say so. See "A letter on
 * `NotePitch`" in the design doc.
 */
function pitchOf(midi: number, letter: NoteLetter): NotePitch {
  // Floored rather than truncated so a pitch below MIDI 0 still names a real
  // octave instead of folding onto octave -1.
  const octave = Math.floor(midi / 12) - 1;

  return { kind: 'pitched', noteValue: reduceToOctave(midi), octave, letter };
}

/**
 * The dynamic marking a velocity is written as.
 *
 * Guitar Pro's own table, which is the one alphaTab reads back: the eight
 * dynamics sit at 15, 31, 47 ... 127, sixteen apart, so the nearest is a
 * division rather than a ladder of comparisons. `DEFAULT_VELOCITY` is 80 and
 * lands on `mf`, whose nominal 79 it was chosen near.
 *
 * Clamped at both ends because velocity reaches here unbounded: `boundVelocity`
 * holds the editing path inside 1-127 and `normalizeRollNote` deliberately
 * checks only that a stored one is finite.
 */
export function velocityDynamic(velocity: number): DynamicValue {
  const scale: DynamicValue[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  const bounded = Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, velocity));

  return scale[Math.min(scale.length - 1, Math.max(0, Math.round((bounded - 15) / 16)))];
}

/**
 * Bars the progression occupies, counting a note that hangs past its slot.
 *
 * The same end the transport measures - `buildSchedule` takes the later of the
 * slot's end and each note's - because a note that sounds after its slot has
 * finished is a note the page has to be long enough to show, exactly as it is
 * one the transport has to be long enough to play.
 *
 * The page is *not* exactly as long as the loop, though, and `struck` below is
 * the one case where they part. `buildSchedule` measures every end the same
 * way, so a note of zero length adds nothing to `endBeat` and the loop turns
 * over on the bar line it sits on - it is scheduled, for no time, at the moment
 * the transport stops. `struck` gives it a bar anyway. Deliberate and tested:
 * an attack is something a reader should see whether or not it sounds, and
 * measuring by ends alone put it in a bar the score did not have, where it was
 * dropped.
 */
function barsIn(doc: ProgressionDoc): number {
  const beats = barBeats(doc.timeSignature);

  /** Bars needed for something that stops at `position`. */
  const reach = (position: number): number => Math.ceil((position - BEAT_EPSILON) / beats);

  /**
   * Bars needed for something *struck* at `position`.
   *
   * `placeProgressionNotes`' own `first` formula, plus one, so the two agree
   * about where a note goes. An onset needs the bar it is struck in even when
   * it has no length to reach into the next: measuring by the end alone put a
   * zero-length note on the final bar line into a bar the score did not have,
   * where it was dropped.
   */
  const struck = (position: number): number =>
    Math.max(0, Math.floor((position + BEAT_EPSILON) / beats)) + 1;

  let bars = 0;
  for (const slot of doc.slots) {
    bars = Math.max(bars, reach(slot.startBeat + slot.lengthBeats));
    for (const note of slot.notes) {
      const start = slot.startBeat + note.startBeat;
      bars = Math.max(bars, struck(start), reach(start + Math.max(0, note.lengthBeats)));
    }
  }

  // Never below one, and never `NaN`: `requireStartBeat` and
  // `normalizeRollNote` rule out a non-finite position at the door, but this
  // module takes a `ProgressionDoc` rather than a promise that one has been
  // through them, and a `NaN` count here would empty `Array.from` and hand
  // back a score with no bars at all - the one shape alphaTab draws nothing
  // for.
  return Number.isFinite(bars) ? Math.max(1, bars) : 1;
}

/**
 * Cuts a progression's notes into bars.
 *
 * Returns one list per bar, in bar order, with a silent bar as an empty list -
 * so the result indexes straight by bar number and `writeBar` never has to
 * search. Exported because the bar arithmetic is the part of this module worth
 * checking as a table, on `progression-strip-gestures.ts`' argument: position
 * arithmetic is where the bugs are.
 *
 * A note that sounds across a bar line appears once per bar it reaches: struck
 * in the first, held at beat 0 of the rest. A note beyond `barCount` is dropped
 * outright rather than clamped onto the last bar, which is the opposite of what
 * `placeDetectedNotes` does with an onset past the end of its audio and is the
 * right answer here for the opposite reason: there the clamp kept a real
 * performance inside a grid that had run out, here the excess is the part of a
 * progression the preview has already said it is not drawing.
 *
 * ## Where the letters are decided
 *
 * This is the only place that holds a note and the slot that owns it at the
 * same time, which is what makes it the place to spell from. A `PlacedNote`
 * carries a `NotePitch` and nothing that names its slot; by `writeBar` the
 * slot is three functions away and `quantizeBar` has copied the pitch besides.
 * So the letter goes onto the `NotePitch` here, and rides the copy
 * `quantizeBar` makes of it onto every `NoteDoc` - both ends of a tie included,
 * which is the case that would otherwise write a C flat tied to a B.
 *
 * One speller per **slot**, built outside the note loop: `slotSpeller` calls
 * `effectiveChord` and walks the chord's intervals to build its tone map, and
 * that is work per chord rather than per note.
 */
export function placeProgressionNotes(
  doc: ProgressionDoc,
  barCount: number,
  finestDivision: FinestDivision = PROGRESSION_FINEST_DIVISION,
  /** The key's scale, for spelling. Empty spells from the key's preference. */
  scaleIntervals: readonly number[] = []
): ProgressionPlacement[][] {
  const timeSignature = doc.timeSignature;
  const beats = barBeats(timeSignature);
  const bars: ProgressionPlacement[][] = Array.from({ length: barCount }, () => []);

  for (const slot of doc.slots) {
    // Unconditional, and that is the invariant rather than a shortcut: the roll
    // calls `slotSpeller` on `state.keyScale ? intervals : []` with no gate of
    // its own, so a gate here is the only way the two can print different
    // letters for one note. An empty scale is not a special case to the speller
    // - it answers from `preferSharps`, exactly as it does for a scale that
    // resolves but has no degree letters to offer, a pentatonic being the case
    // that reaches it. Both were already engraved that way; only the empty one
    // used to be withheld, and withholding it is what let the roll label a key
    // `Gb` while alphaTab engraved the same note `F♯`.
    const spell = slotSpeller(doc.key, scaleIntervals, slot);

    for (const note of slot.notes) {
      const letter = letterOf(spell(reduceToOctave(note.midi)));
      const start = slot.startBeat + note.startBeat;
      // Clamped at zero: a length is only checked for finiteness on the way in,
      // so a zero or negative one is a stored value rather than an impossible
      // one. It sounds nothing, and it is still an attack a reader should see.
      const end = start + Math.max(0, note.lengthBeats);

      // Floored at bar 0 as well as capped at the last: `requireStartBeat`
      // refuses a position before the progression begins, but this module is
      // handed a document rather than a promise that it went through that, and
      // a negative bar index would index `bars` out of the array entirely.
      const first = Math.max(0, Math.floor((start + BEAT_EPSILON) / beats));
      if (first >= barCount) continue;

      // The last bar the note is still sounding *in*, so a note ending exactly
      // on a bar line stops in the bar before it and is written whole.
      const last = Math.min(
        barCount - 1,
        Math.max(first, Math.ceil((end - BEAT_EPSILON) / beats) - 1)
      );

      for (let bar = first; bar <= last; bar++) {
        const isHeld = bar > first;
        bars[bar].push({
          placed: {
            beatInBar: denominatorUnits(isHeld ? 0 : start - bar * beats, timeSignature),
            pitch: pitchOf(note.midi, letter)
          },
          midi: note.midi,
          velocity: note.velocity,
          isHeld
        });
      }
    }
  }

  // The grid travels with it, because both de-duplication rules are functions
  // of the grid: `chordToleranceBeats` widens as the grid coarsens, and the
  // second rule rounds onto its slots. A window sized for a finer grid than the
  // one `quantizeBar` will actually use lets through the pair it is there to
  // catch.
  const slotsPerBeat = finestDivision / timeSignature.denominator;
  return bars.map(bar => dedupe(bar, chordToleranceBeats(slotsPerBeat), slotsPerBeat));
}

/**
 * Drops a placement that would draw a second notehead on a note already there.
 *
 * Two slots sounding the same pitch across a bar line is the case that needs
 * this: the first slot's note is held into the second bar and the second slot
 * strikes the same pitch on that bar's downbeat, and both would be written on
 * one beat as two identical noteheads. `quantizeBar` does not catch it -
 * `addToChord` keeps one note per *string*, which says nothing about a pitched
 * staff - so it has to be caught before the notes go in.
 *
 * Two rules, because `quantizeBar` merges onsets in two stages. It clusters
 * first, inside its own chord tolerance - read from the module that owns it
 * rather than sized again here - and then *rounds* each cluster onto a slot, so
 * a pair too far apart to cluster can still land on one slot and be written as
 * one chord. Checking only the window left that second pair to draw two
 * identical noteheads on one beat.
 *
 * A re-attack outside both is a real second attack and is kept.
 *
 * The struck note wins over the held one at an equal position, which is why the
 * sort breaks ties on `isHeld`: a re-articulated chord tone should be struck.
 * Since M4 that choice also decides a **letter**, and not only an articulation:
 * the two placements come from different slots, so they were spelled by
 * different spellers, and the survivor brings the incoming slot's spelling to a
 * notehead the outgoing slot's note was going to be drawn on. That is the right
 * way round - the note is written where the new chord begins, and should read
 * as that chord's tone - but it is a second thing this rule settles, and it
 * settles it silently.
 *
 * ## The second rule is only half of `snapToSlots`, and knowingly
 *
 * `slotOf` rounds each placement **on its own**; `snapToSlots` rounds a
 * cluster's **centre**. With two notes in a cluster the two agree, because a
 * pair's centre rounds where at least one of its ends does. With three they can
 * part company, and a duplicate notehead gets through. In 4/4 at
 * `finestDivision: 64` - sixteen slots to the beat, a clustering window of half
 * a slot - midi 60 at beat 0.025, midi 64 at 0.053125 and midi 60 at 0.0625
 * come to slots 0.4, 0.85 and 1.0. This function keeps both 60s: they are
 * 0.0375 apart, wider than the window, and they round individually onto slots 0
 * and 1. `snapToSlots` gathers the first two into one cluster (0.45 apart,
 * inside the window), rounds their centre of 0.625 up to slot 1, and lands the
 * third on slot 1 as well - one chord, two identical noteheads.
 *
 * The two roundings differ because they are answering different questions.
 * `snapToSlots` clusters before it rounds precisely so that a chord whose notes
 * straddle a slot boundary is not split into two attacks, and the centre is
 * what makes that stable; this function runs *before* `quantizeBar` and has no
 * clusters to consult, because the clusters are what it is trying to keep
 * clean. Reproducing the clustering here would be the second copy of the rule
 * `transcription-quantize.ts` exists to be the only copy of - and it would be a
 * copy that has to guess, since removing a placement moves the very centre the
 * decision was made from.
 *
 * Left as it is. It needs three notes in one cluster with a repeated pitch and
 * onsets a hand's width apart, which owned timing cannot produce - a generated
 * slot puts every note at beat 0 - so it is reachable only through free timing
 * in the roll, and it costs a second notehead rather than a wrong pitch. The
 * place to fix it, if the free-timing path ever makes it common, is
 * `addToChord`: it already drops the second of two notes merged onto one
 * string, and one note per *pitch* on a pitched staff is the same rule stated
 * for the other kind of staff, applied where the slots are already known.
 */
function dedupe(
  bar: ProgressionPlacement[],
  tolerance: number,
  slotsPerBeat: number
): ProgressionPlacement[] {
  const ordered = [...bar].sort(
    (a, b) =>
      a.placed.beatInBar - b.placed.beatInBar || Number(a.isHeld) - Number(b.isHeld)
  );

  const slotOf = (placement: ProgressionPlacement): number =>
    Math.round(placement.placed.beatInBar * slotsPerBeat);

  const kept: ProgressionPlacement[] = [];
  for (const candidate of ordered) {
    const clash = kept.some(
      taken =>
        taken.midi === candidate.midi &&
        (candidate.placed.beatInBar - taken.placed.beatInBar <= tolerance ||
          slotOf(taken) === slotOf(candidate))
    );
    if (!clash) kept.push(candidate);
  }

  return kept;
}

/**
 * Writes the dynamic in force onto every beat of the score.
 *
 * Every beat, and not only the ones where it changes, which is the opposite of
 * what `BeatDoc.dynamics` reads like. Its `null` is documented as "inherits the
 * previous beat's dynamics" and that is true of *this* model and of nothing
 * downstream: `ScoreDocMapperService.toBeat` skips the assignment entirely on a
 * null, and alphaTab's `Beat.dynamics` defaults to `f`. So an unmarked beat
 * does not inherit - it becomes forte, and alphaTab prints the change. Two bars
 * of the same chord at the roll's default velocity engraved as `mf` and then
 * `f`, which is how this was found.
 *
 * Stating it everywhere costs nothing on the page: alphaTab draws the glyph
 * only where a beat's dynamic differs from the beat before it, so a progression
 * at one velocity still gets exactly one marking.
 *
 * Rests and the held halves of ties are written too, for the same reason - they
 * are beats, and a beat alphaTab reads as forte prints a marking whether or not
 * anything is struck on it. The value before the first attack is that attack's
 * own, so a bar of rests in front of the music does not announce a dynamic the
 * music then contradicts.
 */
function applyDynamics(bars: readonly WrittenBar[]): void {
  let standing = velocityDynamic(firstAttack(bars) ?? DEFAULT_VELOCITY);

  for (const bar of bars) {
    for (let index = 0; index < bar.beats.length; index++) {
      const attack = bar.attacks.get(index);
      if (attack !== undefined) standing = velocityDynamic(attack);
      bar.beats[index].dynamics = standing;
    }
  }
}

/** Velocity of the first note struck anywhere in the score, or null for silence. */
function firstAttack(bars: readonly WrittenBar[]): number | null {
  for (const bar of bars) {
    for (let index = 0; index < bar.beats.length; index++) {
      const attack = bar.attacks.get(index);
      if (attack !== undefined) return attack;
    }
  }
  return null;
}

/** The written bar, its attacks, and what it leaves ringing at the bar line. */
interface WrittenBar {
  beats: BeatDoc[];
  /** Keyed by beat index; a beat with no fresh attack is absent. */
  attacks: Map<number, number>;
  /**
   * MIDI of every note written on this bar's last beat.
   *
   * What the next bar may tie back to. See `writeBar`: a tie whose two ends are
   * not adjacent is not readable notation, and `quantizeBar`'s onset model can
   * stop writing a note well before the bar line.
   */
  ringing: ReadonlySet<number>;
}

/**
 * Quantizes one bar and ties whatever came over the line into it.
 *
 * `written` is what makes the tie possible. `quantizeBar` copies a pitch rather
 * than aliasing it, so nothing about a `NoteDoc` says which placement it was
 * drawn for; the out-parameter reports it, one entry per written fragment, in
 * step with `beats[entry.beat].notes` note for note. Walking it in order and
 * counting per beat recovers the index, which is the only link between the two.
 *
 * ## A held note is only tied to a note that is actually there
 *
 * `ringing` is the previous bar's last beat, and a crossing note is tied only
 * if its pitch is in it - which, given that a chord holds the notes struck at
 * one onset and no others, means it has to have been part of the last chord
 * written in that bar. The rest of the time it is written as a fresh attack.
 *
 * The gap is `quantizeBar`'s onset model, which this module documents at the
 * top: a chord is written until the *next attack in its own bar*, not until the
 * note stops. So a slot holding C4 for a whole bar while E4 is struck halfway
 * through writes the C4 as a half note and then stops writing it - and a tie
 * drawn from there into the next bar arcs straight over the E4. alphaTab finds
 * the origin by walking back for a matching pitch and draws exactly that: a tie
 * between two notes that are not adjacent, which is not something a reader can
 * parse. A re-attack is the honest degradation, because as far as the page is
 * concerned the note had already stopped.
 */
function writeBar(
  placements: ProgressionPlacement[],
  timeSignature: TimeSignature,
  finestDivision: FinestDivision,
  ringing: ReadonlySet<number>
): WrittenBar {
  const written: WrittenNote[] = [];
  const beats = quantizeBar(
    placements.map(placement => placement.placed),
    timeSignature,
    finestDivision,
    undefined,
    written
  );

  // Keyed by the `PlacedNote` object rather than by an id the type does not
  // carry - `score-derivation.ts`'s device, for its reason.
  const source = new Map<PlacedNote, ProgressionPlacement>();
  for (const placement of placements) source.set(placement.placed, placement);

  const seen = new Map<number, number>();
  const attacks = new Map<number, number>();
  const byBeat = new Map<number, number[]>();

  for (const entry of written) {
    const index = seen.get(entry.beat) ?? 0;
    seen.set(entry.beat, index + 1);

    const placement = source.get(entry.note);
    // Sound: `quantizeBar` only reports notes it was handed, and every one of
    // them was registered above.
    if (!placement) continue;

    const pitches = byBeat.get(entry.beat) ?? [];
    pitches.push(placement.midi);
    byBeat.set(entry.beat, pitches);

    const isTie = placement.isHeld && ringing.has(placement.midi);
    if (isTie) beats[entry.beat].notes[index].isTied = true;

    // Only a fresh attack carries a dynamic - and a held note the bar before it
    // was no longer writing is a fresh attack, by the paragraph above. A tie's
    // far end is the same note still sounding, and re-announcing a marking over
    // it would tell a reader something was struck there.
    if (!isTie && !entry.isTied) {
      attacks.set(entry.beat, Math.max(attacks.get(entry.beat) ?? 0, placement.velocity));
    }
  }

  // The bar's last beat, whatever it is. A rest contributes no entries, so a
  // bar that ends in silence leaves nothing for the next one to tie to.
  return { beats, attacks, ringing: new Set(byBeat.get(beats.length - 1) ?? []) };
}

/**
 * Which way a position's accidentals run, for a key that has an opinion.
 *
 * Six o'clock is one pitch class and two keys - F sharp major with six sharps
 * and G flat major with six flats - and `enharmonicAccidentalKind` is the only
 * field on the circle that separates them. It is `null` at the other eleven
 * positions, so this reads as the position's own kind everywhere else.
 *
 * `ProgressionKey.preferSharps` is the tie-breaker because it is the answer the
 * *user* gave: the circle's split wedge offers both spellings, and
 * `ProgressionComponent.adopt` carries the choice across for exactly this
 * reason. Without it the whole flat half of that wedge - G flat major, and
 * every mode whose parent it is - engraved in six sharps under a palette naming
 * G flat and C flat.
 *
 * The accidental *count* is shared between the two spellings and read from the
 * one field, which is sound only because the position where the circle closes
 * is the only one with an alternative at all. `CirclePosition` says as much
 * where `enharmonicAccidentalKind` is declared.
 */
function signatureKind(
  position: CirclePosition,
  preferSharps: boolean
): 'sharp' | 'flat' | 'none' {
  const alternative = position.enharmonicAccidentalKind;
  if (alternative === null) return position.accidentalKind;

  return (position.accidentalKind === 'sharp') === preferSharps
    ? position.accidentalKind
    : alternative;
}

/**
 * The key signature a progression is written with.
 *
 * Two facts from two sources: the accidentals from `keySignaturePosition`,
 * which works the key back to its parent major, and the major-or-minor label
 * from `MINOR_MODES`.
 *
 * The empty signature is what a scale `MODE_OFFSETS` cannot place gets, and it
 * is an answer rather than a failure - a pentatonic, a blues scale, an
 * octatonic, an exotic heptatonic no two engravers write alike, an id the app
 * does not know. Every accidental the key needs is then drawn on the notes,
 * which is what a page without a signature means.
 *
 * It is *not* what a mainstream minor gets, which is what this did until the
 * offsets grew. `MODE_OFFSETS` held only the seven diatonic modes, so E
 * harmonic minor - on the fretboard's own menu, heptatonic, so the palette
 * builds and names its chords - engraved a C major signature with every F sharp
 * written out. It carries one sharp, from G major, exactly as E aeolian does: a
 * harmonic minor's signature is its natural minor's, with the raised seventh as
 * an accidental. `MODE_OFFSETS` says which scales that reasoning reaches and
 * which are genuinely left with nothing.
 */
function keySignatureOf(key: ProgressionKey): KeySignature {
  const position = keySignaturePosition(key.scaleId, key.tonic);
  const accidentals = position?.accidentals ?? 0;
  const kind = position ? signatureKind(position, key.preferSharps) : 'none';

  return {
    fifths: kind === 'flat' ? -accidentals : accidentals,
    mode: MINOR_MODES.has(key.scaleId) ? 'minor' : 'major'
  };
}

/**
 * The clef a progression is drawn on.
 *
 * One clef for the whole score rather than one per bar, so the staff does not
 * flip under a reader between a low chord and a high one. The threshold is
 * middle C and it is `instrumentVoiceFor`'s kind of rule: cheap, decided from
 * the notes rather than from a setting, and wrong only at the edges, where what
 * it costs is ledger lines rather than a wrong pitch.
 *
 * It earns its place on the octave control. A progression sounds from middle C
 * by default, where the treble clef is right; `OCTAVE_MIN` is -2, which puts a
 * whole progression two octaves below that, where it is not.
 */
function clefFor(placements: readonly ProgressionPlacement[][]): ClefKind {
  let highest = Number.NEGATIVE_INFINITY;
  for (const bar of placements) {
    for (const placement of bar) highest = Math.max(highest, placement.midi);
  }

  // A progression with no notes at all takes the treble clef rather than the
  // bass one: `highest` is `-Infinity` there, which compares below middle C and
  // is not a statement about any music. The empty page's bar of rest should be
  // drawn where the first chord the palette adds will land.
  return Number.isFinite(highest) && highest < MIDDLE_C ? 'f4' : 'g2';
}

/**
 * Writes a progression as a score.
 *
 * The entry point, and the only function here a caller needs. Everything above
 * is one of its four steps: measure the progression in bars, cut the notes into
 * them, quantize each, and assemble.
 */
export function progressionToScore(
  doc: ProgressionDoc,
  finestDivision: FinestDivision = PROGRESSION_FINEST_DIVISION,
  /**
   * The key's scale, for spelling. Empty - the default - means the id did not
   * resolve, and every note is then spelled from the key's own `preferSharps`,
   * which is what `slotSpeller` does with a scale it cannot read degrees from
   * and what the roll shows for the same document.
   *
   * Handed in rather than resolved here because resolving `key.scaleId` needs
   * `MusicTheoryService` and this module is pure - the same bargain
   * `progression-spelling.ts` strikes for the same reason, and the reason its
   * functions take intervals rather than an id.
   */
  scaleIntervals: readonly number[] = []
): ProgressionScore {
  const timeSignature = doc.timeSignature;
  const barCount = barsIn(doc);
  const drawn = Math.min(barCount, MAX_PREVIEW_BARS);

  const placements = placeProgressionNotes(doc, drawn, finestDivision, scaleIntervals);
  const keySignature = keySignatureOf(doc.key);
  const clef = clefFor(placements);

  // Quantized in one pass and marked in another, because the dynamic in force
  // at the first bar is decided by the first note struck anywhere - which may
  // be several bars in. See `applyDynamics`.
  const written: WrittenBar[] = [];
  let ringing: ReadonlySet<number> = new Set<number>();
  for (const placement of placements) {
    const bar = writeBar(placement, timeSignature, finestDivision, ringing);
    written.push(bar);
    // In order and one bar behind, because whether a bar's opening tie is
    // legible is a fact about the bar before it. See `writeBar`.
    ringing = bar.ringing;
  }

  applyDynamics(written);

  const bars: BarDoc[] = written.map(bar => ({
    clef,
    clefOttava: 'regular',
    keySignature,
    voices: [{ beats: bar.beats }]
  }));

  const masterBars: MasterBarDoc[] = Array.from({ length: drawn }, (_, index) => ({
    ...createDefaultMasterBar(),
    // Only bar 1 states the signature; the rest inherit it.
    timeSignature: index === 0 ? { ...timeSignature } : null
  }));

  const staff: StaffDoc = {
    // Empty, which is what marks a staff as unfretted: a progression is pitch
    // space by design - `RollNote` is MIDI and not `NotePitch` - and there is no
    // instrument here to assign a string on.
    tuning: [],
    tuningLabel: 'Piano',
    capo: 0,
    transpose: 0,
    displayTranspose: 0,
    showStandardNotation: true,
    showTablature: false,
    showSlash: false,
    showNumbered: false,
    bars
  };

  const track: TrackDoc = {
    id: 'progression',
    name: 'Progression',
    shortName: 'Prg',
    color: '#2c3e50',
    // General MIDI 0, acoustic grand: the page's rail says the progression is a
    // piano and the score should not disagree with it.
    playback: createDefaultPlaybackInfo(0),
    staves: [staff],
    // Marked by `progression-track.ts` when a user sends it to the Composer.
    // The projection on its own is just a score.
    generated: null
  };

  return {
    doc: {
      title: doc.name,
      subTitle: '',
      artist: '',
      album: '',
      tempo: doc.tempo,
      masterBars,
      tracks: [track]
    },
    barCount,
    truncated: barCount > drawn
  };
}
