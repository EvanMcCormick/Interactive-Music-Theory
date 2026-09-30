import { HighlightConfig } from '../models/alpha-tab.model';
import { reduceToOctave } from './note-spelling';

/**
 * Which drawn notes a scale or chord highlight marks, and where: the composer's scale panel (the GP-composer design,
 * Part 5, "The scale panel").
 *
 * Built rather than moved. The viewer's highlighter queried `.at-note` elements and a `data-note` attribute, and alphaTab
 * 1.8 renders neither, so it never marked a note. What replaces it is the mechanism the composer already owns for its
 * caret: rectangles drawn over the engraving from alphaTab's bounds lookup, which carries each note's head
 * (`BeatBounds.notes`) once `core.includeNoteBounds` is on. Pure, over the parts of the lookup it reads, so a spec can
 * hand it plain objects; the score measures the page and draws what this returns.
 */

/** How a highlighted note is marked: the root, in red, or another note of the scale, in blue (`CLAUDE.md`'s colours). */
export type HighlightKind = 'root' | 'inScale';

/** A note head to mark, in the bounds lookup's pixels: from the top left of alphaTab's `.at-surface`. */
export interface NoteHighlight {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: HighlightKind;
}

/** The parts of alphaTab's `BoundsLookup` this reads: systems, their master bars, each staff's bars, beats, and note heads. */
export interface NoteBoundsSource {
  staffSystems: readonly {
    bars: readonly {
      bars: readonly {
        beats: readonly {
          notes: readonly {
            noteHeadBounds: { x: number; y: number; w: number; h: number };
            note: { realValue: number; isPercussion: boolean };
          }[] | null;
        }[];
      }[];
    }[];
  }[];
}

/** The pitch classes `config` marks, each as the root or a note of its scale - none while it is off. */
export function pitchClassesOf(config: HighlightConfig): ReadonlyMap<number, HighlightKind> {
  if (!config.enabled) return new Map();
  const marked = new Map<number, HighlightKind>();
  for (const interval of config.intervals) marked.set(reduceToOctave(config.rootNote + interval), 'inScale');
  marked.set(reduceToOctave(config.rootNote), 'root');
  return marked;
}

/**
 * Every drawn note head `config` marks. A note's pitch class is its `realValue` - the pitch it sounds - reduced to the
 * octave. A drum hit is never marked: its `realValue` is its articulation's number, not a pitch.
 */
export function noteHighlightsOf(lookup: NoteBoundsSource, config: HighlightConfig): NoteHighlight[] {
  const marked = pitchClassesOf(config);
  if (marked.size === 0) return [];
  const highlights: NoteHighlight[] = [];
  for (const system of lookup.staffSystems) {
    for (const masterBar of system.bars) {
      for (const bar of masterBar.bars) {
        for (const beat of bar.beats) {
          for (const { noteHeadBounds: head, note } of beat.notes ?? []) {
            if (note.isPercussion) continue;
            const kind = marked.get(reduceToOctave(note.realValue));
            if (kind) highlights.push({ x: head.x, y: head.y, w: head.w, h: head.h, kind });
          }
        }
      }
    }
  }
  return highlights;
}
