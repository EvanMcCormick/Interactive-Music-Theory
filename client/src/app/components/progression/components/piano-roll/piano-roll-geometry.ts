import { MIN_NOTE_BEATS, VOICING_BASE_MIDI } from '../../../../models/progression-normalize';
import type { RollNote } from '../../../../models/progression.model';

/**
 * The arithmetic behind the piano roll: pixels to beats and pitches, and back.
 *
 * Pure, with no Angular and no DOM, on the `progression-strip-gestures.ts`
 * precedent and for its reason: none of this is about a component. Each
 * function takes a position and some geometry and hands back a beat, a pitch or
 * a window, so each can be checked against a table rather than through a
 * simulated drag.
 *
 * That is a split by *subject* and not a way of avoiding the browser, which the
 * strip's review had to establish the hard way. The adapter half - which button
 * was pressed, what was measured, what is torn down - is none of it arithmetic,
 * and Task 7's component spec dispatches real `PointerEvent`s at a rendered
 * roll to pin it down, taking every coordinate from a live
 * `getBoundingClientRect()`.
 *
 * ## The roll is an absolute layout, and that is what this file is for
 *
 * M1's strip shipped with its resize handle drifting up to **525 pixels** from
 * the cursor. The cards were laid out with `flex-grow`, so the pixels a beat
 * was worth were a function of the card's own length - and a fixed
 * pixels-per-beat cannot track a proportional mapping, because the relation
 * between a length and the width it is drawn at is not linear. It had to be
 * rebuilt as an absolute layout.
 *
 * So the roll is absolute from the start: `width: calc(var(--px-per-beat) *
 * beats)`, in a container that scrolls horizontally, and every function below
 * is linear through the origin. That is a stronger property than invertibility
 * and it is the one that matters, because a *proportional* mapping is
 * invertible too - `xToBeat(beatToX(b))` would have round-tripped on the broken
 * strip. What the strip's mapping was not is translation invariant: the beats a
 * pointer displacement is worth have to be the same wherever the drag started.
 * The spec asserts that directly rather than settling for the round trip.
 *
 * Being linear through the origin is also what lets the same two functions read
 * a *displacement* as well as a position - `xToBeat(dx, ppb)` is the beats in
 * `dx` pixels - which is how a drag should use them. Grabbing a note should not
 * teleport it under the pointer.
 *
 * ## Which arguments defend themselves, and which are a precondition
 *
 * The rule here is the one `progression-strip-gestures.ts` and `clampFinite`
 * arrived at between them, applied by *role* rather than by function:
 *
 *  - **The scales - `pixelsPerBeat`, `rowHeight`, `division` - are guarded.**
 *    They are divisors, and a divisor that is not a positive finite number
 *    manufactures `Infinity` or `NaN` out of a perfectly good pointer position.
 *    `normalizeRollNote` throws on both, and a throw out of a pointer handler
 *    aborts the gesture rather than declining it - which is exactly the
 *    reasoning `draggedBeats` records for its own `pixelsPerBeat <= 0` guard.
 *  - **The coordinates - `beat`, `x`, `midi`, `y`, `topMidi` - are a
 *    precondition.** A non-finite coordinate was non-finite before it arrived,
 *    and passing it on untouched is the model's rule verbatim: clamping or
 *    coercing it here would turn a value of the wrong kind into a plausible one
 *    in front of the guard that exists to catch it. `RollNote.midi` is an
 *    integer by construction - `normalizeRollNote` is the funnel and it throws
 *    otherwise - so `visibleMidiRange` needs no filter of its own.
 *  - **The multiplications are not guarded at all.** `beatToX` and `midiToY`
 *    cannot produce a non-finite number from finite arguments, so there is
 *    nothing for a guard to catch that the precondition above does not already
 *    cover.
 *
 * The strip's guard could decline by returning the length the drag had already
 * reached, because it was handed one. These functions are not, so they decline
 * with the value at zero displacement instead: `xToBeat` answers 0 beats and
 * `yToMidi` answers the pitch at the top of the window. Read as positions those
 * are jumps; read as the displacement maps a drag actually uses them as, both
 * come out as *no movement*, which is the same decline `draggedBeats` makes.
 * `snapBeat` is the one with a true identity - no grid is free timing - so it
 * hands the position back untouched.
 *
 * In practice the divisor guards should be unreachable, and that is a
 * consequence of the absolute layout rather than luck. The strip measured its
 * scale off an element, so a card not yet laid out really did give it a zero;
 * the roll's scale is a constant the stylesheet and the component share. The
 * guards stay because Task 7 may well read `--px-per-beat` back out of CSS,
 * where an unparsed custom property is `NaN` and nothing says otherwise.
 */

// ---------------------------------------------------------------------------
// The beat axis
// ---------------------------------------------------------------------------

/** Where a beat sits, in pixels from the left edge of the grid's content box. */
export function beatToX(beat: number, pixelsPerBeat: number): number {
  return beat * pixelsPerBeat;
}

/**
 * The beat a pixel offset stands on - or, read as a displacement, the beats a
 * pointer has travelled. Both, because the mapping is linear through the
 * origin; see the header.
 *
 * Fractional and deliberately unrounded. This is M2's free timing, and rounding
 * belongs in `snapBeat` where a caller can decline it, not baked into the axis.
 */
export function xToBeat(x: number, pixelsPerBeat: number): number {
  if (!Number.isFinite(pixelsPerBeat) || pixelsPerBeat <= 0) return 0;
  return x / pixelsPerBeat;
}

// ---------------------------------------------------------------------------
// The pitch axis
// ---------------------------------------------------------------------------

/**
 * The top edge of the row a pitch is drawn on, in pixels from the top of the
 * grid's content box.
 *
 * **The axis is inverted**, which is the one thing to get right here: a higher
 * pitch is higher on the screen, so `y` *decreases* as `midi` increases. That
 * is the direction a piano roll has had since the paper ones, and it is the
 * kind of thing that looks fine until someone drags upward and the note goes
 * down. The spec asserts the direction rather than only the round trip.
 *
 * `topMidi` is the highest pitch the grid draws - `visibleMidiRange().high` -
 * and not a pixel offset, which is what makes the pair invertible on two
 * arguments. The plan calls the parameter `top`; it is spelled out here because
 * a bare `top` beside a `y` reads as a pixel and would be the easiest possible
 * thing to pass by mistake.
 *
 * The answer is the row's **top** edge rather than its centre, so it can go
 * straight into a CSS `top`, and so `yToMidi` can invert it with a floor.
 */
export function midiToY(midi: number, topMidi: number, rowHeight: number): number {
  return (topMidi - midi) * rowHeight;
}

/**
 * The pitch whose row contains a pixel offset.
 *
 * Floored rather than rounded, because `midiToY` answers a row's top edge: a
 * floor makes every pixel from that edge to just short of the next one read
 * back as the same pitch, and the two are exact inverses on the row's own edge.
 * Rounding here would offset the whole grid by half a semitone, so a note would
 * draw on one row and pick up on another.
 *
 * Nothing is clamped to the window. A pointer dragged above the top row is a
 * pitch above the window, not a pitch pinned to its ceiling - `visibleMidiRange`
 * re-derives the window from the notes, so the grid follows the drag instead of
 * fighting it. That is the same call `boundNote` makes when it passes `midi`
 * through untouched and names this file as the place the decision belongs.
 */
export function yToMidi(y: number, topMidi: number, rowHeight: number): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return topMidi;
  return topMidi - Math.floor(y / rowHeight);
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * The finest grid the roll may offer, in divisions of a beat.
 *
 * Derived rather than chosen, and derived from the model: `MIN_NOTE_BEATS` is
 * the shortest note a slot will store, so a grid step finer than it is a step a
 * resize could snap to and `boundNoteLength` would then clamp back off - an
 * edge that does not rest where the grid said it would. Task 7's division
 * control stops here.
 *
 * It bounds the *grid*, not `snapBeat`. Snapping a position finer than this is
 * harmless, because a position has no floor - only a length does - so the
 * function itself takes any positive division and the cap is the caller's.
 */
export const MAX_BEAT_DIVISION = 1 / MIN_NOTE_BEATS;

/**
 * A dragged position, quantised to a grid of `division` steps per beat.
 *
 * `division` counts steps per beat rather than naming a step in beats, which
 * makes a triplet grid an exact 3 instead of a repeating 1/3, and multiplying
 * by it is better conditioned than dividing by the reciprocal. `MIN_NOTE_BEATS`
 * falls out as `MAX_BEAT_DIVISION` above.
 *
 * ## The tie, and why there is no hysteresis in here
 *
 * A position exactly halfway between two grid lines lands on the **later** one.
 * That is `Math.round`'s own rule and the choice is arbitrary, but stating it is
 * not: it is the boundary a resting pointer sits on, and the one a mutation of
 * `round` to `floor` or `ceil` walks straight through.
 *
 * M1's strip needed a dead zone around that boundary, because a pointer resting
 * on it and jittering by a pixel crossed it over and over, and every crossing
 * was a length change, a commit, and an undo entry - a hundred of them evicted
 * everything the user had done before the drag. `draggedBeats` holds its dead
 * zone in a `heldBeats` parameter, so "a pure function cannot have hysteresis"
 * is not the reason there is none here.
 *
 * **The dead zone belongs in Task 7's gesture state, and this stays a
 * two-argument quantiser.** Three reasons, in order of weight:
 *
 *  1. The undo half of the strip's bug is already closed on the commit side.
 *     `ProgressionService` coalesces a drag-driven run into one undo entry -
 *     Task 5 requires the roll's setters to use it - so a jittering pointer
 *     costs one entry however many grid lines it crosses. What is left is
 *     visual flicker of the dragged note, which is the component's own
 *     rendering concern and not the model's.
 *  2. The roll snaps two axes and, during a resize, two edges of one note. A
 *     `held` parameter would have to be threaded four ways with a separate held
 *     value behind each, and four held values are gesture state by any name -
 *     they belong with the gesture, which is where `ResizeGesture` already puts
 *     the strip's.
 *  3. Task 11 quantises for notation with no pointer anywhere in sight, and a
 *     quantiser that wants to know what the last drag reached is no use to it.
 *
 * If Task 7 does want the dead zone, it goes on the **unsnapped** beat before
 * this is called, exactly as `draggedBeats` applies it: hold the snapped value,
 * and take a new one only once the raw position is clear of the boundary by the
 * margin. Doing it after the snap cannot work - the information is gone.
 */
export function snapBeat(beat: number, division: number): number {
  // No grid is free timing rather than an error, so the position is handed back
  // as it came. The other two axes have only the origin to decline with; this
  // one has the identity.
  if (!Number.isFinite(division) || division <= 0) return beat;
  return Math.round(beat * division) / division;
}

// ---------------------------------------------------------------------------
// The pitch window
// ---------------------------------------------------------------------------

/** The pitches the grid draws, inclusive at both ends. */
export interface MidiRange {
  /** The lowest pitch drawn, on the bottom row. */
  low: number;
  /** The highest pitch drawn, on the top row - `midiToY`'s `topMidi`. */
  high: number;
}

/**
 * How much room to leave above the highest note and below the lowest.
 *
 * Two semitones: enough that a note is not drawn against the edge of its own
 * grid, and few enough that the window still reads as being about the chord.
 * It is not a drag margin - dragging past the edge is `yToMidi`'s business and
 * it declines to clamp - so there is nothing to make it larger for.
 */
export const PITCH_PADDING_SEMITONES = 2;

/**
 * The shortest window the roll will draw, in semitones. Two octaves.
 *
 * A single note padded by two either way is five rows, and a five-row grid is
 * not a piano roll - there is nowhere to drag to. More to the point, a window
 * that tracked the notes exactly would resize the page every time a note was
 * added, removed or dragged past an end, and a grid that jumps under a drag is
 * worse than one that is slightly too tall.
 *
 * Two octaves rather than one because that is a triad plus somewhere to put its
 * extensions, and rather than three because 25 rows at a legible row height is
 * already most of a screen. It is inclusive of both ends, so the window is 25
 * rows: the C-to-C span a piano roll conventionally opens on.
 */
export const MIN_VISIBLE_SEMITONES = 24;

/**
 * The pitch window to draw for a slot's notes: their span, padded, and never
 * narrower than `MIN_VISIBLE_SEMITONES`.
 *
 * ## An empty slot
 *
 * A slot with no notes still needs a canvas, and it gets two octaves up from
 * `VOICING_BASE_MIDI` - middle C to C6. That is not a neutral default, it is
 * where the notes are about to be: `generateSlotNotes` stacks a voicing from
 * `VOICING_BASE_MIDI` upward, and at `octave` 0 the first chord drawn lands
 * inside this window, so the grid does not jump the moment it arrives.
 *
 * It is deliberately *not* the reachable pitch space, which the octave control
 * opens up: `OCTAVE_MIN` of -2 and `OCTAVE_MAX` of 1 put the voicing base
 * anywhere from 36 to 72, and the widest chord reaches 45 semitones above its
 * base, so everything a slot can hold spans 36 to 117. Drawing 82 rows to be
 * ready for a chord that is not there yet is a page of empty grid, and the
 * moment one real note exists the window is derived from it instead. The empty
 * case is a canvas, not a promise.
 *
 * The slot's own `octave` is not consulted, and could not be: the signature
 * takes notes. An empty slot at `octave` -2 is an empty slot, and the first
 * note drawn re-derives the window around wherever it actually landed.
 *
 * ## Notes outside MIDI's range
 *
 * The window follows them. `RollNote.midi` is deliberately unclamped -
 * `normalizeRollNote` argues it, and `boundNote` names *this file* as the place
 * where a pitch's screen limit is decided - so clamping the window to 0-127
 * would be the one thing worse than drawing an out-of-range note: hiding a
 * stored note from the user who has to fix it.
 */
export function visibleMidiRange(notes: readonly RollNote[]): MidiRange {
  if (notes.length === 0) {
    return { low: VOICING_BASE_MIDI, high: VOICING_BASE_MIDI + MIN_VISIBLE_SEMITONES };
  }

  // A loop rather than `Math.min(...notes.map(n => n.midi))`: spreading an array
  // into a call passes one argument per element, which is a stack overflow on a
  // long enough list. A slot holds a handful of notes today and this costs
  // nothing to write safely.
  let lowest = notes[0].midi;
  let highest = notes[0].midi;
  for (const note of notes) {
    if (note.midi < lowest) lowest = note.midi;
    if (note.midi > highest) highest = note.midi;
  }

  let low = lowest - PITCH_PADDING_SEMITONES;
  let high = highest + PITCH_PADDING_SEMITONES;

  const short = MIN_VISIBLE_SEMITONES - (high - low);
  if (short > 0) {
    // Split evenly, and give an odd semitone to the top: a voicing grows upward
    // from its bass, so the room is worth more above the chord than below it.
    const below = Math.floor(short / 2);
    low -= below;
    high += short - below;
  }

  return { low, high };
}

/**
 * How many rows a window is.
 *
 * Both ends are drawn, so this is the span plus one - 25 rows for two octaves,
 * not 24. It exists as a function rather than as a subtraction at each call
 * site because that `+ 1` is precisely the off-by-one that leaves the grid a
 * row short of the note sitting on its bottom edge, and it is worth one test
 * rather than one per caller. Task 7's grid is `rowCount(range) * rowHeight`
 * tall, which the spec ties back to `midiToY` so the two cannot drift.
 */
export function rowCount(range: MidiRange): number {
  return range.high - range.low + 1;
}
