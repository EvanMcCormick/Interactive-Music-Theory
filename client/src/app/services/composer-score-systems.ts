import { StaffSlot } from './composer-score-interaction';

/**
 * Where the staves are on alphaTab's rendered page, system by system, as pure functions of its bounds lookup.
 *
 * Page layout engraves one partial `<svg>` per system (`_layoutAndRenderScore` paints each system as its own
 * partial, `alphaTab.core.mjs` ~67149 in 1.8), and each system draws every track's staves again. So a staff
 * measured on the page is identified by the system it sits in and its place within that system - never by
 * its position among every staff on the page, which on system 2 runs past the end of `staffSlotsOf`. Lazy
 * loading (`core.enableLazyLoading`, on by default) attaches only the systems near the viewport, so a count
 * down the page would also shift as the score scrolls.
 *
 * Every y here is in the bounds lookup's pixels: from the top of alphaTab's `.at-surface` element
 * (`StaffHitTestService.surfaceOriginOf`).
 */

/** A vertical band, top inclusive, bottom exclusive. */
export interface Band {
  top: number;
  bottom: number;
}

/** One stave a system draws - standard notation or tablature - and the track and staff it belongs to. */
export interface StaveBand extends Band {
  trackIndex: number;
  staffIndex: number;
}

/** One system (a row of the page), and the staves it draws, top to bottom. */
export interface SystemBands extends Band {
  staves: StaveBand[];
}

/** The part of a beat's model the lookup's beats are read through. */
interface BeatShape {
  beat: { voice: { bar: { staff: { index: number; track: { index: number } } } } };
}

/** The part of alphaTab's `BoundsLookup` this reads, so a spec can hand it a plain object. */
export interface BoundsLookupShape {
  staffSystems: readonly {
    realBounds: { y: number; h: number };
    bars: readonly { bars: readonly { realBounds: { y: number; h: number }; beats: readonly BeatShape[] }[] }[];
  }[];
}

/**
 * Each system's band, and the staves it draws, from its first master bar.
 *
 * A master bar's bounds hold one `BarBounds` per rendered stave (`StaffSystem.buildBoundingsLookup` calls
 * each renderer of each visible stave, ~66280), so notation and tablature of one staff are two bands. The
 * track and staff are read from a bar's first beat, not from `BarBounds.bar`: on the worker path
 * `BoundsLookup.fromJson` (~45429) restores beats but never sets `bar`.
 */
export function systemBandsOf(lookup: BoundsLookupShape): SystemBands[] {
  return lookup.staffSystems.map(system => ({
    top: system.realBounds.y,
    bottom: system.realBounds.y + system.realBounds.h,
    staves: (system.bars[0]?.bars ?? [])
      .flatMap(bar => {
        const staff = bar.beats[0]?.beat.voice.bar.staff;
        return staff
          ? [{ trackIndex: staff.track.index, staffIndex: staff.index, top: bar.realBounds.y, bottom: bar.realBounds.y + bar.realBounds.h }]
          : [];
      })
      .sort((a, b) => a.top - b.top)
  }));
}

/** The index of the system whose band holds `y`, or null when none does. */
export function systemIndexAt(systems: readonly Band[], y: number): number | null {
  const index = systems.findIndex(system => y >= system.top && y < system.bottom);
  return index >= 0 ? index : null;
}

/**
 * The index in `slots` of the staff drawn at `y` on `system`: the stave band holding `y`, or the nearest, is
 * matched to its track and staff, and its place among that staff's bands - notation before tablature, as
 * `staffSlotsOf` lists them - picks the slot. Null when the system draws no staves, or the document lists no
 * slot for that band.
 */
export function slotIndexAt(system: SystemBands, y: number, slots: readonly StaffSlot[]): number | null {
  const band = nearestBand(system.staves, y);
  if (!band) return null;
  const sameStaff = (entry: { trackIndex: number; staffIndex: number }): boolean =>
    entry.trackIndex === band.trackIndex && entry.staffIndex === band.staffIndex;

  const rank = system.staves.filter(sameStaff).indexOf(band);
  const own = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => sameStaff(slot));
  return own[rank]?.index ?? null;
}

/**
 * The index in `staffYs` - the middle line of every staff measured on the page - of the one on `system` that
 * draws `slots[slotIndex]`, or null when that system is not attached (lazy loading) or draws no such staff.
 */
export function measuredStaffOfSlot(
  system: SystemBands,
  staffYs: readonly number[],
  slotIndex: number,
  slots: readonly StaffSlot[]
): number | null {
  const index = staffYs.findIndex(y => y >= system.top && y < system.bottom && slotIndexAt(system, y, slots) === slotIndex);
  return index >= 0 ? index : null;
}

/**
 * The range's end beats to hand alphaTab's highlight, or null to clear it: both beats must exist and the bounds
 * lookup must know both. alphaTab's `_cursorSelectRange` reads `startBeat.bounds.realBounds` without a check
 * (~53458), and while a render is in flight the lookup is still the last render's, whose beats the mapper has
 * since replaced - on the worker path `renderFinished` fires before `BoundsLookup.fromJson` (~55561-55567).
 */
export function highlightBeatsOf<B>(
  first: B | undefined,
  last: B | undefined,
  lookup: { findBeat(beat: B): unknown } | null
): { first: B; last: B } | null {
  if (!first || !last || !lookup) return null;
  if ((lookup.findBeat(first) ?? null) === null || (lookup.findBeat(last) ?? null) === null) return null;
  return { first, last };
}

/** The band holding `y`, or else the one nearest it. */
function nearestBand<T extends Band>(bands: readonly T[], y: number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    const distance = y < band.top ? band.top - y : y >= band.bottom ? y - band.bottom : 0;
    if (distance < bestDistance) {
      best = band;
      bestDistance = distance;
    }
  }
  return best;
}
