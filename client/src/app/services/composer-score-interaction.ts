import { ClefKind, ComposerState, EditCursor, EntryMode, ScoreDoc } from '../models/composer.model';
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

/**
 * A staff alphaTab draws: standard notation, tablature, and the two views a loaded file or an applied alphaTex draft can
 * turn on - slash notation, one line of rhythm slashes, and numbered notation, which draws no lines. Those two only take
 * the caret: a Pen click writes no pitch there, and they have no string.
 */
export type StaffKind = 'slash' | 'notation' | 'numbered' | 'tab';

/** One staff as alphaTab draws it, tied back to the track and staff it came from. */
export interface StaffSlot {
  trackIndex: number;
  staffIndex: number;
  kind: StaffKind;
}

/**
 * The staves alphaTab draws on one system, in render order, described from the document. alphaTab lays out
 * each track's staves in its default stave profile's order - slash, standard notation, numbered, tablature
 * (`Environment._createDefaultStaveProfiles`, ~75665 in 1.8), one bounds band each - and draws all of them again on
 * every system. A view left out here would shift the rank of every band after it (`slotIndexAt`). So this lists one system's staves, not the page's: `StaffHitTestService.allStaves` measures every
 * attached system, and a measured staff is matched to its slot through the system it sits in
 * (`slotIndexAt` in `composer-score-systems.ts`), never by its index on the page.
 */
export function staffSlotsOf(doc: ScoreDoc): StaffSlot[] {
  return doc.tracks.flatMap((track, trackIndex) =>
    track.staves.flatMap((staff, staffIndex) => {
      const kinds: StaffKind[] = [
        ...(staff.showSlash ? ['slash' as const] : []),
        ...(staff.showStandardNotation ? ['notation' as const] : []),
        ...(staff.showNumbered ? ['numbered' as const] : []),
        ...(staff.showTablature && staff.tuning.length > 0 ? ['tab' as const] : [])
      ];
      return kinds.map(kind => ({ trackIndex, staffIndex, kind }));
    })
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
 * anywhere in Select, and in Pen on any staff whose press wrote nothing - tablature, slash, numbered. A notation
 * drag in Pen would extend from the caret a write just advanced, and a Pen press on no staff starts no drag.
 */
export function dragExtends(mode: EntryMode, staff: StaffKind | null): boolean {
  return mode === 'select' || (staff !== null && staff !== 'notation');
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
 * The staff last clicked (`clicked`), while it is still the caret's - a slash or numbered staff only while the caret
 * is where that click, or the drag from it, left it (`clickedAt`), so it is drawn on the staff clicked but a key that
 * moves the caret takes it back to the staves notes are entered on. Otherwise the caret's tablature when the caret has
 * a string, and its notation when it has not - which is what draws the caret before the first click, when nothing has
 * been clicked to learn a staff from.
 */
export function caretSlotIndexOf(slots: readonly StaffSlot[], cursor: EditCursor, clicked: number | null, clickedAt: EditCursor | null = null): number | null {
  const isCaretStaff = (slot: StaffSlot | undefined): boolean =>
    slot !== undefined && slot.trackIndex === cursor.trackIndex && slot.staffIndex === cursor.staffIndex;
  const clickedSlot = clicked === null ? undefined : slots[clicked];
  const caretOnly = clickedSlot?.kind === 'slash' || clickedSlot?.kind === 'numbered';
  if (clicked !== null && isCaretStaff(clickedSlot) && (!caretOnly || (clickedAt !== null && sameCaret(clickedAt, cursor)))) return clicked;

  const own = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => isCaretStaff(slot));
  const wanted: StaffKind = cursor.stringIndex !== null ? 'tab' : 'notation';
  // A numbered staff draws no lines to measure a caret against, so any other kind comes before it.
  const found = own.find(({ slot }) => slot.kind === wanted) ?? own.find(({ slot }) => slot.kind !== 'numbered') ?? own[0];
  return found ? found.index : null;
}

/**
 * How far above its staff's bottom line the caret box sits, in half line-spacings: a tablature caret on
 * its string (string 1 is the top line), a notation caret where notation was last clicked, or on the
 * middle line before any click. Never below the bottom line: a tablature staff with no strings, which
 * `staffSlotsOf` does not draw, puts it there.
 */
export function caretHalfStepsOf(staff: StaffKind, stringCount: number, stringIndex: number | null, clickedHalfSteps: number | null): number {
  if (staff === 'tab') return Math.max(0, (stringCount - ((stringIndex ?? 0) + 1)) * 2);
  // A slash staff's one line is its bottom line, and a notation click there says nothing about it.
  if (staff === 'slash') return 0;
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

/**
 * Whether Pen's hover notehead stays up across a state change: only while Pen is still on and the document
 * is the one it was drawn over. A write, an undo or any edit is about to engrave the score again and move
 * what the notehead was placed against; the next pointer move draws it afresh.
 */
export function hoverSurvives(
  previous: Pick<ComposerState, 'doc' | 'entryMode'> | null,
  next: Pick<ComposerState, 'doc' | 'entryMode'>
): boolean {
  return next.entryMode === 'pen' && previous !== null && previous.doc === next.doc;
}

/** Whether two carets are one: the same track, staff, bar, voice, beat and string. */
export function sameCaret(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex &&
    a.stringIndex === b.stringIndex
  );
}

/**
 * Whether a Pen click's note is sounded: only when the write changed the document. A refused write - a full
 * bar, a tuplet it would break - publishes its reason and keeps the document, and a note that was not written
 * must not be heard. By identity, as `scoreRedrawOf` is.
 */
export function writeSounds(before: ScoreDoc, after: ScoreDoc): boolean {
  return after !== before;
}

/**
 * Where the score is in ignoring a press: `armed` once a press has closed a popover, `ignoring` from that press's
 * mouse-down on the score until its release, and `none` otherwise.
 */
export type PressGuard = 'none' | 'armed' | 'ignoring';

/** What the guard hears: a popover closed by a press outside it, a mouse-down on the score, a mouse-up anywhere. */
export type PressGuardEvent = 'popoverClosedByPress' | 'press' | 'release';

/**
 * The guard after `event`. The press that closes a popover only closes it (design decision 17): it moves no caret, seeks
 * nothing and writes nothing. The popover hears that press as a `pointerdown` in the capture phase, but alphaTab and the
 * score hear the `mousedown` and `mouseup` that follow it, in the capture phase on elements of their own, so stopping the
 * `pointerdown` stops neither. So the popover says it closed from a press, which arms the guard; the score's mouse-down
 * turns an armed guard into `ignoring`; and a release anywhere on the page ends it - a closing press that never reached
 * the score included, so the next press on the score acts.
 */
export function pressGuardAfter(guard: PressGuard, event: PressGuardEvent): PressGuard {
  if (event === 'popoverClosedByPress') return 'armed';
  if (event === 'release') return 'none';
  return guard === 'none' ? 'none' : 'ignoring';
}

/**
 * Whether a press on the score acts: not while alphaTab's bounds are still the last render's - between `renderFinished`
 * and `postRenderFinished`, when the lookup describes beats the render has replaced and the systems have moved - and not
 * the press that closed a popover (`pressGuardAfter`).
 */
export function scoreTakesPress(boundsPending: boolean, guard: PressGuard): boolean {
  return !boundsPending && guard !== 'ignoring';
}
