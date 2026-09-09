import {
  BarDoc,
  BeatDoc,
  ClefKind,
  DynamicValue,
  KeySignature,
  MasterBarDoc,
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
 * Diatonic modes written with a minor key signature.
 *
 * `KeySignature.mode` chooses between the major and the minor label for the
 * same set of accidentals, so this decides only how the key is *named*, never
 * which accidentals are drawn - `keySignaturePosition` answers that, from the
 * parent major, for all seven modes at once.
 *
 * The four with a minor third. A modal progression is not really in a major or
 * a minor key at all, and this is the closer of the two answers rather than the
 * right one; there is no third value to give.
 */
const MINOR_MODES: ReadonlySet<string> = new Set(['dorian', 'phrygian', 'aeolian', 'locrian']);

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

/** MIDI to the pitched half of `NotePitch`, the inverse of `pitchToMidi`. */
function pitchOf(midi: number): NotePitch {
  return {
    kind: 'pitched',
    // Floored rather than truncated so a pitch below MIDI 0 - which
    // `normalizeRollNote` permits, since what is stored is what is heard - still
    // names a real octave instead of folding onto octave -1.
    noteValue: ((midi % 12) + 12) % 12,
    octave: Math.floor(midi / 12) - 1
  };
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
 */
export function placeProgressionNotes(
  doc: ProgressionDoc,
  barCount: number,
  finestDivision: FinestDivision = PROGRESSION_FINEST_DIVISION
): ProgressionPlacement[][] {
  const timeSignature = doc.timeSignature;
  const beats = barBeats(timeSignature);
  const bars: ProgressionPlacement[][] = Array.from({ length: barCount }, () => []);

  for (const slot of doc.slots) {
    for (const note of slot.notes) {
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
            pitch: pitchOf(note.midi)
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

/** The key signature a progression is written with. See `MINOR_MODES`. */
function keySignatureOf(key: ProgressionKey): KeySignature {
  const position = keySignaturePosition(key.scaleId, key.tonic);
  const accidentals = position?.accidentals ?? 0;
  // No parent major means no signature to inherit - a pentatonic, a blues
  // scale, an id the app does not know - and the empty one is the honest
  // answer rather than a guess, on the same terms as `keySignatureKind`'s
  // `null`. Accidentals the key needs are then drawn on the notes.
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
  finestDivision: FinestDivision = PROGRESSION_FINEST_DIVISION
): ProgressionScore {
  const timeSignature = doc.timeSignature;
  const barCount = barsIn(doc);
  const drawn = Math.min(barCount, MAX_PREVIEW_BARS);

  const placements = placeProgressionNotes(doc, drawn, finestDivision);
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
    staves: [staff]
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
