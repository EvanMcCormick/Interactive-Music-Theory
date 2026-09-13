import { BeatDoc, EditCursor, ScoreDoc } from '../models/composer.model';
import { beatTicks } from './bar-fill';

/** One beat, addressed: the parts of an `EditCursor` that name a beat. */
export interface BeatRef {
  trackIndex: number;
  staffIndex: number;
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
}

/** The beat `ref` names, or null. */
export function beatAt(doc: ScoreDoc, ref: BeatRef): BeatDoc | null {
  return (
    doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex]
      ?.beats[ref.beatIndex] ?? null
  );
}

/**
 * The beats a command acts on, in timeline order.
 *
 * With no anchor, the caret's beat. With both ends on one staff, every beat of the caret's voice
 * from the earlier end to the later, across bar lines. The ends may be in different voices,
 * whose beat indices do not line up in time, so they are ordered by bar and then by where each
 * starts in its own voice, and an end in another voice bounds the range by that start tick. With
 * the ends on different tracks or staves, whole bars from the earlier end's bar to the later's,
 * on every staff of every track between - Guitar Pro's multitrack selection, which is a rectangle
 * because bars are the only unit two tracks share. See `barRectangle` for its voice.
 */
export function selectionTargets(doc: ScoreDoc, anchor: EditCursor | null, head: EditCursor): BeatRef[] {
  if (!anchor) return beatAt(doc, head) ? [refOf(head)] : [];

  if (anchor.trackIndex === head.trackIndex && anchor.staffIndex === head.staffIndex) {
    const [from, to] = inTimelineOrder(positionOf(doc, anchor), positionOf(doc, head));
    return beatsBetween(doc, head, from, to);
  }
  return barRectangle(doc, anchor, head);
}

/**
 * `end` moved to wherever `beat` now is, after an edit that inserted or removed beats around it.
 *
 * Looked for in `end`'s own bar first, then in each later bar of the same staff and voice, in
 * order: Fix bar carries a beat wholly past the line into the bars after it, and a carry only
 * ever goes forward. `end` comes back unchanged when `beat` is null or found in none of those,
 * as when Fix bar replaced it with its split pieces. An unchanged end may point past its voice
 * now, so the caller clamps what comes back.
 */
export function followedEnd(doc: ScoreDoc, end: EditCursor, beat: BeatDoc | null): EditCursor {
  const bars = doc.tracks[end.trackIndex]?.staves[end.staffIndex]?.bars ?? [];
  if (!beat) return end;
  for (let barIndex = end.barIndex; barIndex < bars.length; barIndex++) {
    const index = bars[barIndex]?.voices[end.voiceIndex]?.beats.indexOf(beat) ?? -1;
    if (index >= 0) return { ...end, barIndex, beatIndex: index };
  }
  return end;
}

/** The bars a selection spans, first to last. */
export function selectedBars(anchor: EditCursor | null, head: EditCursor): { first: number; last: number } {
  const other = anchor ?? head;
  return {
    first: Math.min(other.barIndex, head.barIndex),
    last: Math.max(other.barIndex, head.barIndex)
  };
}

function refOf(cursor: EditCursor): BeatRef {
  return {
    trackIndex: cursor.trackIndex,
    staffIndex: cursor.staffIndex,
    barIndex: cursor.barIndex,
    voiceIndex: cursor.voiceIndex,
    beatIndex: cursor.beatIndex
  };
}

/** One end of a range, placed in time: its bar, and its beat's start tick in its own voice. */
interface TimelinePosition {
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
  ticks: number;
}

/**
 * Where `cursor` sits in time. `ticks` sums `beatTicks` over the beats before it in its own
 * voice, so a grace adds nothing - it starts where the beat it leads into does.
 */
function positionOf(doc: ScoreDoc, cursor: EditCursor): TimelinePosition {
  const beats =
    doc.tracks[cursor.trackIndex]?.staves[cursor.staffIndex]?.bars[cursor.barIndex]?.voices[cursor.voiceIndex]?.beats ?? [];
  return {
    barIndex: cursor.barIndex,
    voiceIndex: cursor.voiceIndex,
    beatIndex: cursor.beatIndex,
    ticks: beats.slice(0, cursor.beatIndex).reduce((sum, beat) => sum + beatTicks(beat), 0)
  };
}

/**
 * The two ends, earlier first: by bar, then by start tick. Two ends in one voice that start at
 * the same tick - a grace and the beat it leads into - are ordered by index, as they are written.
 */
function inTimelineOrder(a: TimelinePosition, b: TimelinePosition): [TimelinePosition, TimelinePosition] {
  const aFirst =
    a.barIndex !== b.barIndex
      ? a.barIndex < b.barIndex
      : a.ticks !== b.ticks
        ? a.ticks < b.ticks
        : a.voiceIndex !== b.voiceIndex || a.beatIndex <= b.beatIndex;
  return aFirst ? [a, b] : [b, a];
}

/**
 * The beats of `head`'s voice from `from` to `to`. An end in that voice bounds the range by its
 * beat index, exactly as written; an end in another voice bounds it by its start tick, taking
 * each beat whose own start lies within the span.
 */
function beatsBetween(doc: ScoreDoc, head: EditCursor, from: TimelinePosition, to: TimelinePosition): BeatRef[] {
  const { trackIndex, staffIndex, voiceIndex } = head;
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  const refs: BeatRef[] = [];
  if (!staff) return refs;

  for (let barIndex = from.barIndex; barIndex <= to.barIndex; barIndex++) {
    let start = 0;
    (staff.bars[barIndex]?.voices[voiceIndex]?.beats ?? []).forEach((beat, beatIndex) => {
      const afterFrom =
        barIndex > from.barIndex || (from.voiceIndex === voiceIndex ? beatIndex >= from.beatIndex : start >= from.ticks);
      const beforeTo =
        barIndex < to.barIndex || (to.voiceIndex === voiceIndex ? beatIndex <= to.beatIndex : start <= to.ticks);
      if (afterFrom && beforeTo) refs.push({ trackIndex, staffIndex, barIndex, voiceIndex, beatIndex });
      start += beatTicks(beat);
    });
  }
  return refs;
}

/**
 * Whole bars `a` to `b` on every staff of every track between them, in the first voice only,
 * whichever voice either end is in. Nothing selects or edits another voice until multiple voices
 * are designed, which is beyond M4; when they are, this decides which voices a rectangle takes.
 */
function barRectangle(doc: ScoreDoc, a: EditCursor, b: EditCursor): BeatRef[] {
  const refs: BeatRef[] = [];
  const firstBar = Math.min(a.barIndex, b.barIndex);
  const lastBar = Math.max(a.barIndex, b.barIndex);

  for (let trackIndex = Math.min(a.trackIndex, b.trackIndex); trackIndex <= Math.max(a.trackIndex, b.trackIndex); trackIndex++) {
    doc.tracks[trackIndex]?.staves.forEach((staff, staffIndex) => {
      for (let barIndex = firstBar; barIndex <= lastBar; barIndex++) {
        staff.bars[barIndex]?.voices[0]?.beats.forEach((_, beatIndex) => {
          refs.push({ trackIndex, staffIndex, barIndex, voiceIndex: 0, beatIndex });
        });
      }
    });
  }
  return refs;
}
