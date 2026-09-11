import { VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
import { RollNote } from '../../../../models/progression.model';
import { snapBeat } from './piano-roll-geometry';

/**
 * The dead zone under the roll's three drags: what a pointer position becomes
 * once the gesture holding it is allowed to resist a boundary.
 *
 * The `progression-strip-gestures.ts` split, for its reason - none of this is
 * about a component, so each function takes a position, a scale and what the
 * gesture has already reached, and can be checked against a table rather than
 * through a simulated drag. It sits above `piano-roll-geometry.ts` rather than
 * inside it on that file's own argument: `snapBeat` stays a two-argument
 * quantiser because Task 11 will quantise notation with no pointer in sight,
 * and a quantiser that wants to know what the last drag reached is no use to
 * it. The hysteresis belongs to the gesture, and this is the gesture's side of
 * that line.
 */

/** How far past a boundary the pointer must go before the value follows it. */
const SNAP_HYSTERESIS = 0.15;

/**
 * A dragged position, snapped to the grid, with a dead zone on the boundary.
 *
 * `piano-roll-geometry.ts` argues at length that `snapBeat` stays a two-argument
 * quantiser and that the dead zone belongs to the gesture. This is that dead
 * zone, and the thing to keep right is the order: **the margin is applied to the
 * raw beat, before the snap**. Afterwards the position is already on a grid line
 * and there is nothing left to say how close to a boundary it was.
 *
 * Without it a pointer resting exactly between two lines and shaking by a pixel
 * crosses back and forth, and every crossing is a commit and a repaint. M1's
 * strip had the same bug and `draggedBeats` holds the same margin the same way;
 * this is that function with the grid step as a parameter and a floor the caller
 * names, because the roll snaps two axes and two edges rather than one length.
 *
 * `held` is what the gesture has already reached, so a single call with `held`
 * at the start reads exactly as it would with no hysteresis at all.
 */
export function heldSnap(raw: number, division: number, held: number, floor: number): number {
  if (!Number.isFinite(raw)) return held;
  // No grid is free timing rather than an error, and free timing has no boundary
  // to rest on - the position is simply where the pointer is.
  if (!Number.isFinite(division) || division <= 0) return Math.max(floor, raw);

  const dead = (0.5 + SNAP_HYSTERESIS) / division;
  if (raw < held + dead && raw > held - dead) return held;

  return Math.max(floor, snapBeat(raw, division));
}

/**
 * How many semitones up a drag has travelled, with the same dead zone.
 *
 * Rounded rather than floored, and that is the difference between a displacement
 * and a position. `yToMidi` floors because it answers "which row is this pixel
 * in", and every pixel of a row has to give the same pitch; read as a
 * displacement the same floor would move a note a whole semitone for one pixel
 * of travel in one direction and none in the other. Half a row in either
 * direction is what a drag means, which is `Math.round`.
 *
 * A row height that is not a positive number means the grid could not be
 * measured, and dividing by it manufactures `Infinity` or `NaN` out of a
 * perfectly good pointer position. Declined rather than clamped, which reads as
 * "the drag did not move" - the same answer `draggedBeats` gives.
 */
export function heldRows(deltaY: number, rowHeight: number, held: number): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return held;
  if (!Number.isFinite(deltaY)) return held;

  // Up the screen is up in pitch: the axis is inverted, which `midiToY` argues.
  const raw = -deltaY / rowHeight;
  const dead = 0.5 + SNAP_HYSTERESIS;
  if (raw < held + dead && raw > held - dead) return held;

  return Math.round(raw);
}

/**
 * The velocity a drag has reached: where it started, plus how far up the pointer
 * has travelled.
 *
 * Whole, because `RollNote.velocity` is a MIDI byte, and clamped into 1-127 here
 * as well as in `boundVelocity` - this is the last place the number is a value
 * the user is dragging to rather than one being stored, and a bar that flickered
 * past the top of its lane before the model refused it would be the strip's
 * `draggedBeats` floor problem again.
 */
export function draggedVelocity(
  startVelocity: number,
  deltaUp: number,
  pixelsPerVelocity: number,
  held: number
): number {
  if (!Number.isFinite(pixelsPerVelocity) || pixelsPerVelocity <= 0) return held;
  if (!Number.isFinite(deltaUp)) return held;

  const raw = Math.round(startVelocity + deltaUp / pixelsPerVelocity);
  return Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, raw));
}

// ---------------------------------------------------------------------------
// What a gesture records
// ---------------------------------------------------------------------------
//
// The three records the roll opens on `pointerdown` and closes on `pointerup`.
// They are here rather than in the component for this file's own reason: none
// of it is about a component - a record is a position, a scale and what the
// drag has reached so far, which is exactly what the functions above take - and
// a shape whose whole purpose is to be handed to `heldSnap`, `heldRows` and
// `draggedVelocity` belongs beside them. It also took the component back under
// the project's line cap, which it was ten lines from.

/**
 * What every gesture records the moment the pointer goes down, whatever it is
 * about to drag.
 *
 * ## The slot is captured, not read back
 *
 * `notes` on a move is snapshotted for a stated reason - a drag is measured from
 * where it began - and **the slot it belongs to is the same kind of fact.** A
 * handler that read `this.slotId` on every `pointermove` would be asking where
 * the selection is *now*, and the selection is not the gesture's to follow: the
 * strip is a sibling on the same page and a click on another card republishes
 * the state under a drag already in progress. The notes would then be slot A's,
 * measured against slot A's geometry, and written into slot B.
 *
 * Nothing on the page can do that today - a pointer held down over the roll is
 * not clicking the strip - so this closes it by construction rather than because
 * it was reachable. It costs one field, and the field is also the honest
 * statement: a gesture acts on the slot it started on.
 *
 * ## `committed` means an entry is open, and only that
 *
 * It is what decides `coalesce`, so it has to be true exactly when this gesture
 * has an undo entry of its own to fold into - which is why it is set from what
 * the setter *answers* rather than from the fact that it was called.
 * `ProgressionNoteEditor.writeNotes` carries the argument.
 */
export interface Gesture {
  /** The slot this gesture started on, and the only one it will ever write to. */
  slotId: string;
  index: number;
  /** Whether a commit of this gesture has actually landed. */
  committed: boolean;
}

/**
 * A note being dragged in pitch and time.
 *
 * Transient by construction, on the same terms as the strip's two: it exists
 * between a pointer going down and coming up again and nothing outside this
 * component can ask about it. `notes` is the slot's list as it was when the drag
 * began, so every move is measured from where the drag started rather than
 * accumulated - the strip's rule, and what stops a drag that goes out and comes
 * back leaving the note somewhere else.
 */
export interface MoveGesture extends Gesture {
  originX: number;
  originY: number;
  startBeat: number;
  startMidi: number;
  notes: readonly RollNote[];
  pixelsPerBeat: number;
  rowHeight: number;
  /** The beat the drag has reached; the dead zone is measured against it. */
  beat: number;
  /** The semitones the drag has reached, likewise. */
  semitones: number;
}

/** A note's right edge being dragged. Transient on the same terms. */
export interface ResizeGesture extends Gesture {
  originX: number;
  startBeat: number;
  startLength: number;
  pixelsPerBeat: number;
  length: number;
}

/** A velocity being dragged. Transient on the same terms. */
export interface VelocityGesture extends Gesture {
  originY: number;
  startVelocity: number;
  pixelsPerVelocity: number;
  velocity: number;
}
