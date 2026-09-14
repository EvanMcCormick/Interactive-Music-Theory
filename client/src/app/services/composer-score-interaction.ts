import { ClefKind, EditCursor, EntryMode, ScoreDoc } from '../models/composer.model';
import { BeatRef, selectionTargets } from './composer-selection';
import { bottomLineDiatonic } from './staff-pitch';

/**
 * What the mouse means on the engraved score, as pure functions of the entry mode, the staff under the
 * pointer and the selection.
 *
 * `ComposerScoreComponent` owns alphaTab and has no spec, so every decision it makes about a click, a
 * drag, the caret, the highlight and what to redraw is made here, where it can be specced; the component
 * only measures the page and calls these.
 */

export type StaffKind = 'notation' | 'tab';

/** One staff as alphaTab draws it, tied back to the track and staff it came from. */
export interface StaffSlot {
  trackIndex: number;
  staffIndex: number;
  kind: StaffKind;
}

/**
 * The staves alphaTab draws on one system, in render order, described from the document. alphaTab lays out
 * each track's staves in order, standard notation before tablature, and draws all of them again on every
 * system. So this lists one system's staves, not the page's: `StaffHitTestService.allStaves` measures every
 * attached system, and a measured staff is matched to its slot through the system it sits in
 * (`slotIndexAt` in `composer-score-systems.ts`), never by its index on the page.
 */
export function staffSlotsOf(doc: ScoreDoc): StaffSlot[] {
  return doc.tracks.flatMap((track, trackIndex) =>
    track.staves.flatMap((staff, staffIndex) => [
      ...(staff.showStandardNotation ? [{ trackIndex, staffIndex, kind: 'notation' as const }] : []),
      ...(staff.showTablature && staff.tuning.length > 0 ? [{ trackIndex, staffIndex, kind: 'tab' as const }] : [])
    ])
  );
}

/** What a mouse-down on the score does. */
export type ScorePress = 'extend' | 'caret' | 'write';

/**
 * What a mouse-down does: Shift extends the range; otherwise the caret moves, and in Pen, on standard
 * notation, the clicked pitch is written too. Tablature writes by digit in both modes, never by click.
 */
export function scorePressOf(mode: EntryMode, staff: StaffKind | null, shiftKey: boolean): ScorePress {
  if (shiftKey) return 'extend';
  return mode === 'pen' && staff === 'notation' ? 'write' : 'caret';
}

/**
 * Whether moving with the button held extends the range from where the mouse-down put the caret:
 * anywhere in Select, and on tablature in Pen. A notation drag in Pen would extend from the caret a write
 * just advanced.
 */
export function dragExtends(mode: EntryMode, staff: StaffKind | null): boolean {
  return mode === 'select' || staff === 'tab';
}

/**
 * Whether a drag the last mouse-down started still extends, given `MouseEvent.buttons` from the latest
 * pointer move: only while the primary button (bit 0) is down.
 *
 * alphaTab listens for mouse-up on its own surface, so a button released outside the score never reaches
 * it - its beat mouse-move goes on firing as the pointer comes back, button up. The buttons the move itself
 * reports are the truth.
 */
export function dragContinues(dragging: boolean, buttons: number): boolean {
  return dragging && (buttons & 1) === 1;
}

/**
 * The track, staff and string the pointer names, for a click or a drag: the staff under the pointer, with its
 * string on tablature (`under.stringIndex`) and the caret's own string elsewhere, which `ComposerService`
 * clamps to the staff. With no staff under the pointer - a drag crossing the gap between two staves - the
 * caret's own track, staff and string, so the range goes on growing along the staff it is on instead of
 * jumping to the first track, which is the track alphaTab's beat hit reports there.
 */
export function dragTargetOf(
  under: { slot: StaffSlot; stringIndex: number | null } | null,
  cursor: EditCursor
): Pick<EditCursor, 'trackIndex' | 'staffIndex' | 'stringIndex'> {
  if (!under) return { trackIndex: cursor.trackIndex, staffIndex: cursor.staffIndex, stringIndex: cursor.stringIndex };
  return {
    trackIndex: under.slot.trackIndex,
    staffIndex: under.slot.staffIndex,
    stringIndex: under.slot.kind === 'tab' ? under.stringIndex : cursor.stringIndex
  };
}

/**
 * Whether a mouse-down moves the playback position to the clicked beat: a click that moves the caret or
 * writes, while playback is stopped. alphaTab's own interaction did this before the composer turned it off
 * (`applyPlaybackRangeFromHighlight`, which also set the range - this sets no range). A Shift-click only
 * extends the selection, and a click during playback must not jump the transport.
 */
export function seeksOnPress(press: ScorePress, playing: boolean): boolean {
  return press !== 'extend' && !playing;
}

/**
 * What a state change redraws: `'render'` - engrave the score again - when `doc` is not the document last
 * engraved, and `'overlay'` - the highlight and the caret, drawn over the engraving - otherwise. By identity,
 * since `ComposerService` replaces the document on every edit and never mutates a published one: a
 * selection, a caret move or an entry mode change keeps the same document.
 */
export function scoreRedrawOf(lastRenderedDoc: ScoreDoc | null, doc: ScoreDoc): 'render' | 'overlay' {
  return doc === lastRenderedDoc ? 'overlay' : 'render';
}

/**
 * The index in `slots` of the staff the caret is drawn on, or null when its track draws none.
 *
 * The staff last clicked (`clicked`), while it is still the caret's; otherwise the caret's tablature when
 * the caret has a string, and its notation when it has not - which is what draws the caret before the
 * first click, when nothing has been clicked to learn a staff from.
 */
export function caretSlotIndexOf(slots: readonly StaffSlot[], cursor: EditCursor, clicked: number | null): number | null {
  const isCaretStaff = (slot: StaffSlot | undefined): boolean =>
    slot !== undefined && slot.trackIndex === cursor.trackIndex && slot.staffIndex === cursor.staffIndex;
  if (clicked !== null && isCaretStaff(slots[clicked])) return clicked;

  const own = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => isCaretStaff(slot));
  const wanted: StaffKind = cursor.stringIndex !== null ? 'tab' : 'notation';
  const found = own.find(({ slot }) => slot.kind === wanted) ?? own[0];
  return found ? found.index : null;
}

/**
 * How far above its staff's bottom line the caret box sits, in half line-spacings: a tablature caret on
 * its string (string 1 is the top line), a notation caret where notation was last clicked, or on the
 * middle line before any click.
 */
export function caretHalfStepsOf(staff: StaffKind, stringCount: number, stringIndex: number | null, clickedHalfSteps: number | null): number {
  if (staff === 'tab') return (stringCount - ((stringIndex ?? 0) + 1)) * 2;
  return clickedHalfSteps ?? 4;
}

/**
 * The range's first and last target beats, for alphaTab's `highlightPlaybackRange` - or null when there
 * is no range, or it covers one beat, which alphaTab would not draw anyway (`_cursorSelectRange` returns
 * early when both ends are one beat, ~53441).
 */
export function highlightEndsOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): { first: BeatRef; last: BeatRef } | null {
  if (!anchor) return null;
  const refs = selectionTargets(doc, anchor, cursor);
  return refs.length > 1 ? { first: refs[0], last: refs[refs.length - 1] } : null;
}

/**
 * Where Pen's hover notehead goes, in half line-spacings above the bottom line - or null when none is
 * drawn: outside Pen, off standard notation, where the pointer names no position, or under a clef with
 * no pitches.
 */
export function penHoverHalfStepsOf(mode: EntryMode, staff: StaffKind | null, diatonic: number | null, clef: ClefKind): number | null {
  const bottom = bottomLineDiatonic(clef);
  if (mode !== 'pen' || staff !== 'notation' || diatonic === null || bottom === null) return null;
  return diatonic - bottom;
}

/**
 * The hover notehead's horizontal position, in surface units, snapped to half a line spacing - so it moves
 * in steps a notehead's width can see, not with every pixel the pointer crosses.
 */
export function snappedHoverX(x: number, spacing: number): number {
  const step = spacing / 2;
  return step > 0 ? Math.round(x / step) * step : Math.round(x);
}

/**
 * What a hover notehead draws, as a key: the staff, the pitch, the snapped position, and how far the score
 * has scrolled (the box is placed in the scrolled container). Pointer moves run outside Angular, and only a
 * move that changes this key enters it to draw.
 */
export function hoverKeyOf(slotIndex: number, halfSteps: number, snappedX: number, spacing: number, scrollTop: number): string {
  return `${slotIndex}:${halfSteps}:${snappedX}:${spacing}:${scrollTop}`;
}
