import { MIN_SLOT_BEATS } from '../../../../models/progression-normalize';

/**
 * The arithmetic behind the strip's two pointer gestures.
 *
 * Pure, with no Angular and no DOM, on the `progression-edit.ts` precedent and
 * for its reason: none of this is about a component. Each function takes a
 * pointer position and some geometry and hands back an index or a length, so
 * each can be checked against a table rather than through a simulated drag.
 *
 * That is a split by *subject*, not a way of avoiding the browser. The claim
 * this docstring used to make - that dispatching real `PointerEvent`s would
 * pin card widths and handle positions, which `CLAUDE.md` rules out - conflated
 * reading geometry with asserting it, and it was wrong.
 * `progression-strip-pointer.spec.ts` dispatches real events, takes every
 * coordinate from a live `getBoundingClientRect()`, and asserts only what the
 * component dispatched to the service; it hard-codes no width and no offset.
 * The adapter layer needs that, because none of it is arithmetic: which button
 * was pressed, what gets measured, what is torn down.
 *
 * The split was also what took the component back under the project's 500-line
 * cap, the same way and at the same kind of seam as the service's split.
 */

/**
 * The right edge of one rendered card, in client pixels.
 *
 * The left edge was carried here too until the review, and never read. The
 * conventional alternative - drop onto the card whose *midpoint* the pointer
 * has passed - is what would use it, and it was tried: it makes leftward and
 * rightward drags symmetric, and it also moves a card released exactly where it
 * was picked up, because the spans are measured before the drag and the dragged
 * card is still sitting in its own. Keeping "the first card the pointer has not
 * passed" keeps that release free, so the left edge went rather than the rule.
 */
export interface CardSpan {
  right: number;
}

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * A click is a press and a release too, and a mouse moves a pixel or two under
 * a finger during one. Without a threshold every click on a card would also be
 * a reorder to wherever the pointer happened to end up.
 */
const DRAG_THRESHOLD_PX = 4;

/** Whether the pointer has moved far enough for a press to be a drag. */
export function beyondDragThreshold(originX: number, x: number): boolean {
  return Math.abs(x - originX) >= DRAG_THRESHOLD_PX;
}

/**
 * The index of the card the pointer is over: where a dragged card would land.
 *
 * Position rather than displacement, because the cards are not the same width -
 * that is the point of the strip - so a delta of 100 pixels crosses one card or
 * four depending on where it started. The spans are measured once when the drag
 * begins and nothing moves until it ends, so they stay true for its length.
 *
 * Past either end it clamps, because a drag can be released anywhere on the
 * page and the nearest card is what it meant. The gap the stylesheet leaves
 * between two cards belongs to the one on its right, which falls out of taking
 * the first card the pointer has not yet passed - and a pointer resting exactly
 * on a card's right edge is still over that card, not the next one.
 */
export function dropIndexAt(x: number, spans: readonly CardSpan[]): number {
  for (let index = 0; index < spans.length; index++) {
    if (x <= spans[index].right) return index;
  }
  return Math.max(0, spans.length - 1);
}

/**
 * How far past the halfway point the pointer must go to change the length.
 *
 * Without it the edge snaps on the exact half-beat, so a pointer resting on the
 * boundary and shaking by one pixel crosses it over and over. Each crossing is
 * a real length change and so a real commit, and a few seconds of that used to
 * push a hundred entries through the undo stack and evict everything the user
 * had done before the drag. The commit side of that is fixed in
 * `ProgressionService.commit` - a drag is one undo step now, however many
 * lengths it passes through - and this is the independent half: the length
 * stops flickering in the first place.
 */
const BEAT_SNAP_HYSTERESIS = 0.15;

/**
 * The length a resize drag has reached: where it started, plus how far the
 * pointer has travelled, in beats.
 *
 * Rounded to a whole beat because M1 measures slots in beats - `MIN_SLOT_BEATS`
 * says so, and every chord sounds as a single block filling its slot, so a
 * fraction of a beat is not something this milestone can ask for or play. M2's
 * free timing is where the rounding comes off, and it comes off here.
 *
 * `heldBeats` is the length the drag has already reached, and it is what makes
 * the rounding sticky: a new whole beat is taken only once the pointer is clear
 * of the boundary by `BEAT_SNAP_HYSTERESIS`, and inside that dead zone the
 * length stays where it is. It defaults to `startBeats`, so a single call reads
 * exactly as it did before there was any hysteresis at all.
 *
 * The floor is stated as well as in `normalizeLengthBeats`, and that is not a
 * duplicated rule: this is the last place the number is a *length the user is
 * dragging to* rather than a value being stored, and returning 0 from here
 * would have the strip flicker to a length the model then refuses.
 *
 * A scale that is not a positive number is declined rather than clamped. It
 * means the card could not be measured - not drawn yet, or laid out at zero
 * width - and dividing by it gives `Infinity` or `NaN`, which
 * `normalizeLengthBeats` throws on. A throw out of a pointer handler aborts the
 * gesture; returning the length the drag has already reached declines to resize
 * and leaves the user holding an edge that does not move.
 */
export function draggedBeats(
  startBeats: number,
  deltaX: number,
  pixelsPerBeat: number,
  heldBeats = startBeats
): number {
  const held = Math.max(MIN_SLOT_BEATS, Number.isFinite(heldBeats) ? heldBeats : startBeats);

  if (!Number.isFinite(pixelsPerBeat) || pixelsPerBeat <= 0) return held;
  if (!Number.isFinite(deltaX)) return held;

  const raw = startBeats + deltaX / pixelsPerBeat;
  const dead = 0.5 + BEAT_SNAP_HYSTERESIS;
  if (raw < held + dead && raw > held - dead) return held;

  return Math.max(MIN_SLOT_BEATS, Math.round(raw));
}

/**
 * A reorder in progress.
 *
 * Transient by construction: it exists between a pointer going down and coming
 * up again, and the component holds one only for that long. It is not a second
 * copy of the document - it is what the pointer is doing, which nothing outside
 * the strip can ask about and which is gone before the gesture is.
 */
export interface ReorderGesture {
  id: string;
  originX: number;
  /** The strip as it was when the drag began, and as it stays until it ends. */
  spans: readonly CardSpan[];
  /** Whether the pointer has travelled far enough for this to be a drag at all. */
  dragged: boolean;
}

/** A resize in progress. Transient on the same terms. */
export interface ResizeGesture {
  id: string;
  originX: number;
  startBeats: number;
  pixelsPerBeat: number;
  /** The length the drag has reached so far; `draggedBeats` rounds against it. */
  beats: number;
  /**
   * Whether this drag has already committed a length.
   *
   * It is what separates one drag from the next in the undo history: the first
   * commit of a run opens a new entry and every later one folds into it. See
   * `ProgressionService.setSlotLength`.
   */
  committed: boolean;
}
