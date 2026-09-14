import {
  BarDoc,
  ClefKind,
  EditCursor,
  KeySignature,
  MasterBarDoc,
  OttaviaKind,
  ScoreDoc,
  TimeSignature,
  TripletFeelKind,
  Tuplet,
  effectiveTimeSignature
} from '../models/composer.model';
import { hasTuplet } from './bar-fill';
import { beatsAt } from './beat-edits';
import { selectedBars, selectionTargets } from './composer-selection';

/** Where the bars or beats a popover reads do not share a value. */
export const MIXED = 'mixed';

/** A value every bar or beat read holds, or `MIXED`. */
export type Shared<T> = T | typeof MIXED;

/** What a valued tool's popover opens on, read from the selection (`popoverValuesOf`). */
export interface PopoverValues {
  /** The meter in force at the first selected bar, where Time signature writes. */
  timeSignature: TimeSignature;
  /** Over the selected bars of every staff, all of which Key signature writes. */
  keySignature: Shared<KeySignature>;
  /** Over the selected bars of the caret's staff, which Clef writes. A field left mixed is sent as null, keeping each bar's. */
  clef: Shared<ClefKind>;
  ottava: Shared<OttaviaKind>;
  /** Over the selected bars, which Section, Alternate ending and Triplet feel each write alike. */
  section: Shared<MasterBarDoc['section']>;
  alternateEndings: Shared<number>;
  tripletFeel: Shared<TripletFeelKind>;
  /** The tuplet the selection's beats are under, graces aside: null for none. */
  tuplet: Shared<Tuplet | null>;
}

/**
 * What each valued tool's popover opens on for the selection from `anchor` to `head`: read from the first selected bar,
 * where every bar command writes (`selectedBars`) - not from the head, which a range selected rightwards leaves on its
 * last bar - and `MIXED` for a value the selected bars or beats do not share, compared by content.
 */
export function popoverValuesOf(doc: ScoreDoc, anchor: EditCursor | null, head: EditCursor): PopoverValues {
  const { first, last } = selectedBars(anchor, head);
  const indices = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
  const staffBars = doc.tracks[head.trackIndex]?.staves[head.staffIndex]?.bars ?? [];
  const bars = indices.map(index => staffBars[index]).filter((bar): bar is BarDoc => bar !== undefined);
  const masterBars = indices.map(index => doc.masterBars[index]).filter((bar): bar is MasterBarDoc => bar !== undefined);
  const keys = doc.tracks.flatMap(track =>
    track.staves.flatMap(staff => indices.flatMap(index => (staff.bars[index] ? [staff.bars[index].keySignature] : [])))
  );
  const beats = beatsAt(doc, selectionTargets(doc, anchor, head)).filter(beat => beat.effects.grace === 'none');

  return {
    timeSignature: effectiveTimeSignature(doc.masterBars, first),
    keySignature: sharedOf(keys, { fifths: 0, mode: 'major' }),
    clef: sharedOf(bars.map(bar => bar.clef), 'g2'),
    ottava: sharedOf(bars.map(bar => bar.clefOttava), 'regular'),
    section: sharedOf(masterBars.map(bar => bar.section), null),
    alternateEndings: sharedOf(masterBars.map(bar => bar.alternateEndings), 0),
    tripletFeel: sharedOf(masterBars.map(bar => bar.tripletFeel), 'none'),
    tuplet: sharedOf(beats.map(beat => (hasTuplet(beat) ? beat.tuplet : null)), null)
  };
}

/** The value all of `values` hold by content, `fallback` when there are none, or `MIXED`. */
function sharedOf<T>(values: readonly T[], fallback: T): Shared<T> {
  if (values.length === 0) return fallback;
  const content = contentOf(values[0]);
  return values.every(value => contentOf(value) === content) ? values[0] : MIXED;
}

/** `value` as JSON with each object's keys in order, so two objects written in different orders read the same. */
function contentOf(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner
  );
}
