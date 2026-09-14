import { EditCursor, ScoreDoc, createDefaultCursor } from '../models/composer.model';

/**
 * Where the caret goes, as pure functions of the document.
 *
 * The keyboard has more caret moves than the service had commands - Home and End, previous and next
 * bar, first and last bar, previous and next track - and each also extends a range with Shift. One
 * function answers where any move lands, so `ComposerService.moveCursor` is one command rather than
 * a dozen, and the arithmetic is specced without a service. `clampedCursor` was the service's
 * private `clampCursor`; every caller of either now goes through here.
 */

/** A caret move the keyboard asks for. */
export type CursorMove =
  | { kind: 'beat'; delta: number }
  | { kind: 'string'; delta: number }
  | { kind: 'barEdge'; edge: 'first' | 'last' }
  | { kind: 'bar'; delta: number }
  | { kind: 'scoreEdge'; edge: 'first' | 'last' }
  | { kind: 'track'; delta: number };

const clamp = (value: number, min: number, max: number): number => (max < min ? min : Math.max(min, Math.min(max, value)));

/** `cursor` with every index pulled back inside `doc`. A pitched staff has no string. */
export function clampedCursor(cursor: EditCursor, doc: ScoreDoc): EditCursor {
  const trackIndex = clamp(cursor.trackIndex, 0, doc.tracks.length - 1);
  const track = doc.tracks[trackIndex];
  if (!track) return createDefaultCursor();

  const staffIndex = clamp(cursor.staffIndex, 0, track.staves.length - 1);
  const staff = track.staves[staffIndex];
  const barIndex = clamp(cursor.barIndex, 0, staff.bars.length - 1);
  const bar = staff.bars[barIndex];
  const voiceIndex = clamp(cursor.voiceIndex, 0, bar.voices.length - 1);
  const beats = bar.voices[voiceIndex].beats;
  const beatIndex = clamp(cursor.beatIndex, 0, Math.max(0, beats.length - 1));
  const stringIndex = staff.tuning.length > 0 ? clamp(cursor.stringIndex ?? 0, 0, staff.tuning.length - 1) : null;

  return { trackIndex, staffIndex, barIndex, voiceIndex, beatIndex, stringIndex };
}

/**
 * Where `move` takes `cursor`, inside `doc`.
 *
 * A beat step wraps across bar lines by each bar's own beat count and stops at either end of the
 * score. A bar move lands on the bar's first beat, as Guitar Pro's and TuxGuitar's do, and a track
 * move on the same bar's first beat of the other track's first staff: beat indices do not line up
 * across tracks, so keeping one would land on an arbitrary beat. A string move on a pitched staff,
 * which has no strings, goes nowhere.
 */
export function movedCursor(doc: ScoreDoc, cursor: EditCursor, move: CursorMove): EditCursor {
  const staff = doc.tracks[cursor.trackIndex]?.staves[cursor.staffIndex];
  if (!staff) return clampedCursor(cursor, doc);
  const beatCount = (barIndex: number): number => staff.bars[barIndex]?.voices[cursor.voiceIndex]?.beats.length ?? 1;
  const lastBar = staff.bars.length - 1;

  switch (move.kind) {
    case 'beat': {
      let barIndex = cursor.barIndex;
      let beatIndex = cursor.beatIndex + move.delta;
      while (beatIndex < 0 && barIndex > 0) {
        barIndex--;
        beatIndex += beatCount(barIndex);
      }
      while (barIndex < lastBar && beatIndex >= beatCount(barIndex)) {
        beatIndex -= beatCount(barIndex);
        barIndex++;
      }
      return clampedCursor({ ...cursor, barIndex, beatIndex }, doc);
    }
    case 'string':
      return staff.tuning.length === 0
        ? cursor
        : clampedCursor({ ...cursor, stringIndex: (cursor.stringIndex ?? 0) + move.delta }, doc);
    case 'barEdge':
      return clampedCursor({ ...cursor, beatIndex: move.edge === 'first' ? 0 : beatCount(cursor.barIndex) - 1 }, doc);
    case 'bar':
      return clampedCursor({ ...cursor, barIndex: cursor.barIndex + move.delta, beatIndex: 0 }, doc);
    case 'scoreEdge':
      return move.edge === 'first'
        ? clampedCursor({ ...cursor, barIndex: 0, beatIndex: 0 }, doc)
        : clampedCursor({ ...cursor, barIndex: lastBar, beatIndex: beatCount(lastBar) - 1 }, doc);
    case 'track':
      return clampedCursor(
        { ...cursor, trackIndex: cursor.trackIndex + move.delta, staffIndex: 0, voiceIndex: 0, beatIndex: 0 },
        doc
      );
  }
}
