import {
  CardSpan,
  beyondDragThreshold,
  draggedBeats,
  dropIndexAt
} from './progression-strip-gestures';
import { MIN_SLOT_BEATS } from '../../../../models/progression-normalize';

/**
 * The arithmetic of the strip's two pointer gestures, checked against a table.
 *
 * This is the half of a drag that can be pinned down without a browser, and it
 * is where the drags are really tested: a pointer position and some geometry go
 * in, an index or a length comes out. `progression-strip-pointer.spec.ts` has
 * the other two halves - which service call the component makes with these
 * answers, and what a real `PointerEvent` on a rendered strip does before it
 * gets here.
 */

/** Three cards a hundred pixels wide, laid end to end. */
const THREE_SPANS: CardSpan[] = [{ right: 100 }, { right: 200 }, { right: 300 }];

/**
 * The pure half of the resize gesture: a pointer delta, a scale, and the
 * length that comes out.
 */
describe('draggedBeats', () => {
  it('leaves the length alone when the pointer has not moved', () => {
    expect(draggedBeats(4, 0, 40)).toBe(4);
  });

  it('adds a beat for each beat-width dragged right', () => {
    expect(draggedBeats(4, 40, 40)).toBe(5);
    expect(draggedBeats(4, 120, 40)).toBe(7);
  });

  it('takes a beat off for each beat-width dragged left', () => {
    expect(draggedBeats(4, -40, 40)).toBe(3);
  });

  /** M1 measures slots in whole beats, so the edge snaps to the nearest one. */
  it('snaps to the nearest whole beat', () => {
    expect(draggedBeats(4, 10, 40)).toBe(4);
    expect(draggedBeats(4, 30, 40)).toBe(5);
  });

  it('stops at the shortest slot rather than going through it', () => {
    expect(draggedBeats(4, -1000, 40)).toBe(MIN_SLOT_BEATS);
  });

  /**
   * The dead zone. Exactly on the half-beat the length does not move, and a
   * pointer sitting there and shaking by a pixel commits nothing - which used
   * to be a commit per crossing, and a hundred of them empties the undo stack.
   */
  it('holds the length while the pointer sits on the boundary', () => {
    expect(draggedBeats(4, 20, 40)).toBe(4);
    expect(draggedBeats(4, 21, 40)).toBe(4);
    expect(draggedBeats(4, 19, 40)).toBe(4);
  });

  /**
   * And the zone travels with the length the drag has reached, which is what
   * makes it hysteresis rather than a wider snap: the same pointer position
   * gives 4 to a drag that has reached 4 and 5 to one that has reached 5.
   */
  it('keeps whichever length the drag already reached', () => {
    expect(draggedBeats(4, 20, 40, 4)).toBe(4);
    expect(draggedBeats(4, 20, 40, 5)).toBe(5);
  });

  it('takes a new beat once the pointer is clear of the boundary', () => {
    expect(draggedBeats(4, 27, 40, 4)).toBe(5);
    expect(draggedBeats(4, 13, 40, 5)).toBe(4);
  });

  /**
   * The guard that matters. A card with no width on screen gives a scale of
   * zero, and dividing by it produces `Infinity` - which
   * `normalizeLengthBeats` throws on, aborting the gesture with an exception
   * rather than declining to resize.
   */
  it('declines to resize when the card has no width to measure', () => {
    expect(draggedBeats(4, 120, 0)).toBe(4);
    expect(draggedBeats(4, 120, Number.NaN)).toBe(4);
    expect(draggedBeats(4, 120, -40)).toBe(4);
  });

  it('declines to resize on a pointer position that is not a number', () => {
    expect(draggedBeats(4, Number.NaN, 40)).toBe(4);
  });
});

/**
 * The pure half of the reorder gesture: where the pointer is, and which card
 * it is over.
 */
describe('dropIndexAt', () => {
  it('reports the card the pointer is over', () => {
    expect(dropIndexAt(50, THREE_SPANS)).toBe(0);
    expect(dropIndexAt(150, THREE_SPANS)).toBe(1);
    expect(dropIndexAt(250, THREE_SPANS)).toBe(2);
  });

  /** A pointer on a card's last pixel is still over that card. */
  it('reads the right edge of a card as that card, not the next one', () => {
    expect(dropIndexAt(100, THREE_SPANS)).toBe(0);
    expect(dropIndexAt(200, THREE_SPANS)).toBe(1);
  });

  /** A drag can be released past either end, and the nearest card is what it meant. */
  it('clamps to the ends of the strip', () => {
    expect(dropIndexAt(-500, THREE_SPANS)).toBe(0);
    expect(dropIndexAt(5000, THREE_SPANS)).toBe(2);
  });

  /** Cards are drawn with a gap between them; it belongs to the card after it. */
  it('reads a gap between two cards as the one on its right', () => {
    const gapped: CardSpan[] = [{ right: 90 }, { right: 190 }];
    expect(dropIndexAt(95, gapped)).toBe(1);
  });

  it('answers 0 for a strip with no cards in it', () => {
    expect(dropIndexAt(50, [])).toBe(0);
  });
});

/**
 * A click is a press and a release too, and a mouse moves a pixel or two under
 * a finger during one. This is what stops every click on a card also being a
 * reorder to wherever the pointer happened to end up.
 */
describe('beyondDragThreshold', () => {
  it('reads a press that has barely moved as a click', () => {
    expect(beyondDragThreshold(50, 50)).toBeFalse();
    expect(beyondDragThreshold(50, 52)).toBeFalse();
  });

  it('reads a press that has travelled as a drag, in either direction', () => {
    expect(beyondDragThreshold(50, 60)).toBeTrue();
    expect(beyondDragThreshold(50, 40)).toBeTrue();
  });

  /** Four pixels either way, and four is far enough. */
  it('turns over at four pixels', () => {
    expect(beyondDragThreshold(50, 53)).toBeFalse();
    expect(beyondDragThreshold(50, 54)).toBeTrue();
    expect(beyondDragThreshold(50, 47)).toBeFalse();
    expect(beyondDragThreshold(50, 46)).toBeTrue();
  });
});
