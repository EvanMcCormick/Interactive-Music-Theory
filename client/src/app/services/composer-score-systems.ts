import type * as alphaTab from '@coderline/alphatab';

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

/** One stave a system draws - slash, standard notation, numbered or tablature - and the track and staff it belongs to. */
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

/**
 * The index of the system whose band holds `y`, or else of the nearest band - null only when there are none. A system's
 * band starts `systemPaddingTop` below the top of its partial, about 14 pixels above its first staff's top line at scale
 * 1, so a pointer on a ledger line above that staff, or between two systems, is in no band.
 */
export function systemIndexAt(systems: readonly Band[], y: number): number | null {
  const nearest = nearestBand(systems, y);
  return nearest ? systems.indexOf(nearest) : null;
}

/**
 * The system a press reads its beat on: the system of the staff under the pointer, found by that staff's middle line
 * (`staffCentreY`), so a press's staff and its beat come from one system - or, with no staff under the pointer, the
 * system under the pointer itself. A ledger line above a later system's first staff lies inside the band of the system
 * above, so a beat read at the pointer put the caret, and a Pen note under its clef, in the other system's bar.
 */
export function pressSystemIndexOf(systems: readonly Band[], staffCentreY: number | null, pointerY: number): number | null {
  return systemIndexAt(systems, staffCentreY ?? pointerY);
}

/**
 * The index in `slots` of the staff drawn at `y` on `system`: the stave band holding `y`, or the nearest, is
 * matched to its track and staff, and its place among that staff's bands - slash, notation, numbered, tablature, as
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
 * The index in `slots` of the numbered staff whose band on `system` holds `y`, or null when `y` is in no band, or in a
 * band of another kind. A numbered staff draws no lines, so `StaffHitTestService` never measures it and a press over it
 * would go to the nearest staff that draws lines; its band is what says the pointer is on it.
 */
export function numberedSlotAt(system: SystemBands, y: number, slots: readonly StaffSlot[]): number | null {
  if (!system.staves.some(band => y >= band.top && y < band.bottom)) return null;
  const slotIndex = slotIndexAt(system, y, slots);
  return slotIndex !== null && slots[slotIndex]?.kind === 'numbered' ? slotIndex : null;
}

/** The band on `system` that draws `slots[slotIndex]`, or null when the system draws no such staff: where a numbered staff's caret goes. */
export function staveBandOfSlot(system: SystemBands, slotIndex: number, slots: readonly StaffSlot[]): StaveBand | null {
  return system.staves.find(band => slotIndexAt(system, (band.top + band.bottom) / 2, slots) === slotIndex) ?? null;
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

/**
 * The beat under `x` on one track and staff of a master bar: that staff's bar bounds, then its beat nearest to
 * the left of `x` (`BarBounds.findBeatAtPos`). alphaTab's own hit, `MasterBarBounds.findBeatAtPos` (~45226),
 * searches every track's bars and keeps the nearest beat of any, so where the tracks' rhythms differ its beat -
 * and its beat index - belongs to another track. The bar's staff is read from its first beat, as in
 * `systemBandsOf`, since the worker path never sets `BarBounds.bar`. Null when the master bar draws no such staff.
 */
export function targetTrackBeat(
  masterBar: alphaTab.rendering.MasterBarBounds,
  x: number,
  trackIndex: number,
  staffIndex: number
): alphaTab.model.Beat | null {
  const bar = masterBar.bars.find(candidate => {
    const staff = candidate.beats[0]?.beat.voice.bar.staff;
    return staff !== undefined && staff.track.index === trackIndex && staff.index === staffIndex;
  });
  return bar?.findBeatAtPos(x)?.beat ?? null;
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
