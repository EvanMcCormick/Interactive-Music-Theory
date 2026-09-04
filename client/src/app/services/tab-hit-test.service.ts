import { Injectable } from '@angular/core';

export interface StaffLines {
  /** The rendering surface these coordinates belong to. */
  surface: SVGSVGElement;
  /** y of each tablature line, top (highest string) to bottom. */
  tabLineY: number[];
  /** Spacing between adjacent tab lines, in surface units. */
  spacing: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Locates tablature string lines in alphaTab's rendered output.
 *
 * alphaTab's public API resolves the semantic half of a click - `beatMouseDown`
 * gives the exact beat - but it has no notion of which string line the pointer
 * landed on, because a Bar's bounds span the standard notation and tablature
 * staves together. That part is inherently visual, so it is measured from the
 * render surface.
 *
 * alphaTab draws staff lines as thin, wide rects. Grouping their distinct y
 * values by spacing separates the 5-line notation staff from the N-line tab
 * staff.
 *
 * This service is deliberately stateless. alphaTab replaces its render surface
 * on every re-render, and an earlier caching version kept handing out
 * coordinates measured on a detached element, which reports an all-zero
 * bounding box and put the caret off-screen. Measuring on demand is a single
 * pass over a few dozen rects, and correctness stops depending on render
 * timing.
 */
@Injectable({ providedIn: 'root' })
export class TabHitTestService {
  /** Staff lines are drawn thin; anything taller is a bar line or a glyph. */
  private static readonly MAX_LINE_THICKNESS = 2;
  /** Ignore short rects: note stems and flags are also thin. */
  private static readonly MIN_LINE_WIDTH = 20;
  /** Line spacings within one staff vary by less than this. */
  private static readonly SPACING_TOLERANCE = 2;

  /**
   * Which string a pointer landed on, or null when it was not over a tab staff.
   * Snaps to the nearest line, so a click between two lines picks the closer
   * one rather than doing nothing.
   */
  stringAt(
    container: HTMLElement,
    stringCount: number,
    clientX: number,
    clientY: number
  ): number | null {
    for (const staff of this.measure(container, stringCount)) {
      const box = staff.surface.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right) continue;

      const scale = this.scaleOf(staff.surface, box);
      const localY = (clientY - box.top) / scale;

      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      staff.tabLineY.forEach((y, index) => {
        const distance = Math.abs(y - localY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      // Only claim the click when it is near the tab staff, not elsewhere on
      // the same surface such as the standard notation staff above it.
      if (bestIndex >= 0 && bestDistance <= staff.spacing) return bestIndex + 1;
    }
    return null;
  }

  /**
   * Caret box for a beat on a given string, relative to `container`.
   * `beatX` and `beatWidth` come from alphaTab's bounds lookup and are in
   * render-surface units.
   */
  caretRect(
    container: HTMLElement,
    stringCount: number,
    beatX: number,
    beatWidth: number,
    stringNumber: number
  ): Rect | null {
    const staff = this.measure(container, stringCount).find(
      candidate => stringNumber >= 1 && stringNumber <= candidate.tabLineY.length
    );
    if (!staff) return null;

    const containerBox = container.getBoundingClientRect();
    const surfaceBox = staff.surface.getBoundingClientRect();
    if (surfaceBox.width === 0) return null;

    const scale = this.scaleOf(staff.surface, surfaceBox);
    const height = Math.max(12, staff.spacing * scale);
    const lineY = surfaceBox.top + staff.tabLineY[stringNumber - 1] * scale;

    return {
      left: surfaceBox.left - containerBox.left + beatX * scale,
      top: lineY - containerBox.top - height / 2 + container.scrollTop,
      width: Math.max(10, beatWidth * scale),
      height
    };
  }

  /** Tab staves currently rendered inside `container`. */
  private measure(container: HTMLElement, stringCount: number): StaffLines[] {
    if (stringCount <= 0) return [];

    const staves: StaffLines[] = [];
    for (const surface of Array.from(container.querySelectorAll('svg'))) {
      const lines = this.findTabLines(surface, stringCount);
      if (lines) staves.push(lines);
    }
    return staves;
  }

  /** alphaTab renders without a viewBox, so this is normally 1. */
  private scaleOf(surface: SVGSVGElement, box: DOMRect): number {
    const viewBoxWidth = surface.viewBox.baseVal.width;
    if (!viewBoxWidth || !box.width) return 1;
    return box.width / viewBoxWidth;
  }

  /**
   * Finds the run of `stringCount` evenly spaced lines that forms the tab
   * staff. The notation staff is always 5 lines at a tighter spacing, so on a
   * 6-string instrument the two are unambiguous; on a 5-string bass they are
   * told apart by spacing, tab lines being drawn further apart.
   */
  private findTabLines(surface: SVGSVGElement, stringCount: number): StaffLines | null {
    const ys = this.lineYs(surface);
    if (ys.length < stringCount) return null;

    let best: StaffLines | null = null;

    for (let start = 0; start + stringCount <= ys.length; start++) {
      const run = ys.slice(start, start + stringCount);
      const gaps: number[] = [];
      for (let i = 1; i < run.length; i++) gaps.push(run[i] - run[i - 1]);

      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      if (max - min > TabHitTestService.SPACING_TOLERANCE) continue;

      const spacing = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      // Prefer the widest-spaced candidate: tab lines sit further apart than
      // notation lines, and a 6-line run cannot be the 5-line notation staff.
      if (!best || spacing > best.spacing) {
        best = { surface, tabLineY: run, spacing };
      }
    }

    return best;
  }

  /** Distinct y values of the thin, wide rects alphaTab uses for staff lines. */
  private lineYs(surface: SVGSVGElement): number[] {
    const ys = new Set<number>();

    for (const rect of Array.from(surface.querySelectorAll('rect'))) {
      const height = Number(rect.getAttribute('height'));
      const width = Number(rect.getAttribute('width'));
      if (!Number.isFinite(height) || !Number.isFinite(width)) continue;
      if (height > TabHitTestService.MAX_LINE_THICKNESS) continue;
      if (width < TabHitTestService.MIN_LINE_WIDTH) continue;

      const y = Number(rect.getAttribute('y'));
      if (Number.isFinite(y)) ys.add(Math.round(y));
    }

    return [...ys].sort((a, b) => a - b);
  }
}
