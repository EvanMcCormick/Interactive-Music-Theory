import { VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
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
