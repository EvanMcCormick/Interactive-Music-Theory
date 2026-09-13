import { BeatDoc, EditCursor, ScoreDoc } from '../models/composer.model';

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
 * With no anchor, the caret's beat. With both ends on one staff, every beat between them in
 * the caret's voice, across bar lines. With the ends on different tracks or staves, whole
 * bars from the earlier end's bar to the later's, on every staff of every track between -
 * Guitar Pro's multitrack selection, which is a rectangle because bars are the only unit two
 * tracks share.
 */
export function selectionTargets(doc: ScoreDoc, anchor: EditCursor | null, head: EditCursor): BeatRef[] {
  if (!anchor) return beatAt(doc, head) ? [refOf(head)] : [];

  if (anchor.trackIndex === head.trackIndex && anchor.staffIndex === head.staffIndex) {
    const [from, to] = inTimelineOrder(anchor, head);
    return beatsBetween(doc, from, to, head.voiceIndex);
  }
  return barRectangle(doc, anchor, head);
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

function inTimelineOrder(a: EditCursor, b: EditCursor): [EditCursor, EditCursor] {
  const aFirst = a.barIndex < b.barIndex || (a.barIndex === b.barIndex && a.beatIndex <= b.beatIndex);
  return aFirst ? [a, b] : [b, a];
}

function beatsBetween(doc: ScoreDoc, from: EditCursor, to: EditCursor, voiceIndex: number): BeatRef[] {
  const staff = doc.tracks[from.trackIndex]?.staves[from.staffIndex];
  const refs: BeatRef[] = [];
  if (!staff) return refs;

  for (let barIndex = from.barIndex; barIndex <= to.barIndex; barIndex++) {
    const beats = staff.bars[barIndex]?.voices[voiceIndex]?.beats ?? [];
    const first = barIndex === from.barIndex ? from.beatIndex : 0;
    const last = Math.min(barIndex === to.barIndex ? to.beatIndex : beats.length - 1, beats.length - 1);
    for (let beatIndex = first; beatIndex <= last; beatIndex++) {
      refs.push({ trackIndex: from.trackIndex, staffIndex: from.staffIndex, barIndex, voiceIndex, beatIndex });
    }
  }
  return refs;
}

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
