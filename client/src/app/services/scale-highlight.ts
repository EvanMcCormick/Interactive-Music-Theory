import { HighlightConfig } from '../models/alpha-tab.model';
import { reduceToOctave } from './note-spelling';
import type { Rect } from './staff-hit-test.service';

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

/** A staff, as a beat's bounds reach it (`beat.voice.bar.staff`): which of the views that draw no pitch per note it shows. */
export interface DrawnStaff {
  showSlash: boolean;
  showStandardNotation: boolean;
  showNumbered: boolean;
}

/**
 * The parts of alphaTab's `BoundsLookup` this reads: systems, their master bars, each band's bar, beats, and note heads.
 *
 * `beat` and `note` may be missing. With workers, alphaTab rebuilds the lookup on this thread (`BoundsLookup.fromJson`)
 * by resolving each index against the score the API holds now, which a render race - a score swapped while the worker
 * was laying out the last - can leave with fewer beats or notes than were drawn.
 */
export interface NoteBoundsSource {
  staffSystems: readonly {
    bars: readonly {
      bars: readonly {
        beats: readonly {
          beat?: { voice: { bar: { staff: DrawnStaff } } };
          notes: readonly {
            noteHeadBounds: { x: number; y: number; w: number; h: number };
            note?: { realValue: number; isPercussion: boolean; isDead: boolean };
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
 * octave. Never marked: a drum hit, whose `realValue` is its articulation's number, not a pitch; a dead note, which
 * sounds none; a note the lookup could not find again (`NoteBoundsSource`); and any head on a slash or numbered band
 * (`isPitchedBand`).
 */
export function noteHighlightsOf(lookup: NoteBoundsSource, config: HighlightConfig): NoteHighlight[] {
  const marked = pitchClassesOf(config);
  if (marked.size === 0) return [];
  const highlights: NoteHighlight[] = [];
  for (const system of lookup.staffSystems) {
    for (const masterBar of system.bars) {
      // How many of each staff's bands this master bar has passed: a band's rank within its staff is its kind.
      const bandsPassed = new Map<DrawnStaff, number>();
      for (const bar of masterBar.bars) {
        const staff = bar.beats.find(beat => beat.beat)?.beat?.voice.bar.staff;
        if (!staff) continue;
        const band = bandsPassed.get(staff) ?? 0;
        bandsPassed.set(staff, band + 1);
        if (!isPitchedBand(staff, band)) continue;
        for (const beat of bar.beats) {
          for (const { noteHeadBounds: head, note } of beat.notes ?? []) {
            if (!note || note.isPercussion || note.isDead) continue;
            const kind = marked.get(reduceToOctave(note.realValue));
            if (kind) highlights.push({ x: head.x, y: head.y, w: head.w, h: head.h, kind });
          }
        }
      }
    }
  }
  return highlights;
}

/** A ring on the page: a marked note head's box placed in the score's container, and whether it marks the root. */
export type NoteMark = Rect & { kind: HighlightKind };

/**
 * `highlights` placed in the score's container: each moved by `offset`, where the bounds lookup's origin sits in the
 * container (`StaffHitTestService.lookupOffsetOf`) - measured once for them all, not once a note head.
 */
export function noteMarksOf(highlights: readonly NoteHighlight[], offset: { left: number; top: number }): NoteMark[] {
  return highlights.map(({ x, y, w, h, kind }) => ({ left: offset.left + x, top: offset.top + y, width: w, height: h, kind }));
}

/** Whether two sets of rings are the same, ring for ring: a redraw that moves none need not hand the view a new list. */
export function sameMarks(a: readonly NoteMark[], b: readonly NoteMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((mark, index) => {
      const other = b[index];
      return mark.kind === other.kind && mark.left === other.left && mark.top === other.top && mark.width === other.width && mark.height === other.height;
    })
  );
}

/**
 * Whether `staff`'s `band`th band in a master bar draws a head for each note at its pitch: standard notation and
 * tablature do; slash and numbered notation do not. Those two register one note bound per beat, for the beat's first
 * note, spanning the whole slash or number (`SlashBeatGlyph` and `NumberedBeatGlyph`'s `buildBoundingsLookup` in alphaTab
 * 1.8), so a mark there would claim a pitch the band does not show.
 *
 * The lookup does not say which renderer drew a bar - the worker's JSON drops it - so the kind is read from the band's
 * rank. alphaTab adds a staff's bar bounds in its stave profile's order, one per band - slash, standard notation,
 * numbered, tablature (`Environment.defaultRenderers`, as `staffSlotsOf` counts them) - each for a view the staff shows.
 * A band with no beats is not counted, and need not be: every band of a bar draws the same beats, so a bar with none
 * has none on any band, and nothing to mark.
 */
function isPitchedBand(staff: DrawnStaff, band: number): boolean {
  const pitchedBeforeTab = [...(staff.showSlash ? [false] : []), ...(staff.showStandardNotation ? [true] : []), ...(staff.showNumbered ? [false] : [])];
  return pitchedBeforeTab[band] ?? true;
}
