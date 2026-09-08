import { MIN_SLOT_BEATS } from '../../../../models/progression.model';

/**
 * The arithmetic behind the strip's two pointer gestures.
 *
 * Pure, with no Angular and no DOM, on the `progression-edit.ts` precedent and
 * for its reason: none of this is about a component. Each function takes a
 * pointer position and some geometry and hands back an index or a length, so
 * each can be checked against a table rather than through a simulated drag.
 *
 * That split is what keeps the strip's specs off the strip's layout. A drag
 * asserted by dispatching `PointerEvent`s at a fixture pins card widths, gaps
 * and where the resize handle sits - DOM detail `CLAUDE.md` rules out asserting
 * because it breaks on the first style change. The component keeps only the
 * measuring: it reads the rendered geometry and hands it here.
 *
 * It was also what took the component back under the project's 500-line cap,
 * the same way and at the same kind of seam as the service's split.
 */

/** The horizontal extent of one rendered card, in client pixels. */
export interface CardSpan {
  left: number;
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
 * the first card the pointer has not yet passed.
 */
export function dropIndexAt(x: number, spans: readonly CardSpan[]): number {
  for (let index = 0; index < spans.length; index++) {
    if (x <= spans[index].right) return index;
  }
  return Math.max(0, spans.length - 1);
}

/**
 * The length a resize drag has reached: where it started, plus how far the
 * pointer has travelled, in beats.
 *
 * Rounded to a whole beat because M1 measures slots in beats - `MIN_SLOT_BEATS`
 * says so, and every chord sounds as a single block filling its slot, so a
 * fraction of a beat is not something this milestone can ask for or play. M2's
 * free timing is where the rounding comes off, and it comes off here.
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
 * gesture; returning the length the drag started at declines to resize and
 * leaves the user holding an edge that does not move.
 */
export function draggedBeats(startBeats: number, deltaX: number, pixelsPerBeat: number): number {
  if (!Number.isFinite(pixelsPerBeat) || pixelsPerBeat <= 0) return startBeats;
  if (!Number.isFinite(deltaX)) return startBeats;

  return Math.max(MIN_SLOT_BEATS, Math.round(startBeats + deltaX / pixelsPerBeat));
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
}
