import { Injectable } from '@angular/core';
import { ClefKind } from '../models/composer.model';
import { bottomLineDiatonic } from './staff-pitch';

export interface StaffLines {
  /** The rendering surface these coordinates belong to. */
  surface: SVGSVGElement;
  /** y of each staff line, top to bottom, in surface units. */
  lineY: number[];
  /** Spacing between adjacent lines, in surface units. */
  spacing: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Locates staves in alphaTab's rendered output, and maps a pointer position
 * onto one.
 *
 * alphaTab's `beatMouseDown` resolves which beat was clicked, but not which
 * staff: a beat's bounds span every staff in the system, so on a multi-track
 * score it always reports the first track. Everything vertical - which track,
 * which string, which pitch - therefore has to be measured from the rendered
 * output.
 *
 * alphaTab draws staff lines as thin, wide rects. Walking their sorted y values
 * and breaking whenever the gap changes separates the staves cleanly: a guitar
 * track contributes a 5-line notation staff and a 6-line tablature staff, and
 * each further track adds its own.
 *
 * Deliberately stateless. alphaTab replaces its render surface on every
 * re-render, and an earlier caching version handed out coordinates measured on
 * a detached element, which reports an all-zero bounding box and put the caret
 * off-screen. Measuring on demand is one pass over a few dozen rects.
 */
@Injectable({ providedIn: 'root' })
export class StaffHitTestService {
  /** Staff lines are drawn thin; anything taller is a bar line or a glyph. */
  private static readonly MAX_LINE_THICKNESS = 2;
  /** Ignore short rects: note stems and flags are also thin. */
  private static readonly MIN_LINE_WIDTH = 20;
  /** Line spacings within one staff vary by less than this. */
  private static readonly SPACING_TOLERANCE = 2;
  /** How far beyond a staff a click still belongs to it, in line spacings. */
  private static readonly LEDGER_REACH = 3;

  /**
   * Every staff currently rendered, in the order alphaTab drew them, which
   * follows track then staff order. Callers match this against their own
   * document to decide which track a staff belongs to.
   */
  allStaves(container: HTMLElement): StaffLines[] {
    const staves: StaffLines[] = [];
    for (const surface of Array.from(container.querySelectorAll('svg'))) {
      staves.push(...this.staffGroups(surface));
    }
    return staves;
  }

  /** Index into `allStaves` of the staff the pointer is over, if any. */
  staffIndexAt(container: HTMLElement, clientX: number, clientY: number): number | null {
    const staves = this.allStaves(container);

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < staves.length; index++) {
      const staff = staves[index];
      const box = staff.surface.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right) continue;

      const localY = this.toLocalY(staff, box, clientY);
      const top = staff.lineY[0];
      const bottom = staff.lineY[staff.lineY.length - 1];
      const distance = Math.max(0, top - localY, localY - bottom);

      if (distance > staff.spacing * StaffHitTestService.LEDGER_REACH) continue;
      if (distance >= bestDistance) continue;

      bestIndex = index;
      bestDistance = distance;
    }

    return bestIndex >= 0 ? bestIndex : null;
  }

  /**
   * String number for a pointer over a tablature staff, in tab numbering where
   * string 1 is the highest-pitched (the top line). Snaps to the nearest line.
   */
  stringIn(staff: StaffLines, clientY: number): number {
    const box = staff.surface.getBoundingClientRect();
    const localY = this.toLocalY(staff, box, clientY);

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    staff.lineY.forEach((y, index) => {
      const distance = Math.abs(y - localY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex + 1;
  }

  /**
   * Diatonic staff index for a pointer over a notation staff. Half a line
   * spacing is one diatonic step, so this extends onto ledger lines.
   */
  diatonicIn(staff: StaffLines, clef: ClefKind, clientY: number): number | null {
    const bottom = bottomLineDiatonic(clef);
    if (bottom === null || staff.spacing <= 0) return null;

    const box = staff.surface.getBoundingClientRect();
    const localY = this.toLocalY(staff, box, clientY);
    const bottomLineY = staff.lineY[staff.lineY.length - 1];

    return bottom + Math.round((bottomLineY - localY) / (staff.spacing / 2));
  }

  /**
   * Caret box over a staff, `halfSteps` above its bottom line.
   *
   * Both staff kinds reduce to the same measure: a tablature string sits two
   * half-steps per line above the bottom, and a notation position is already
   * counted in half-steps.
   */
  caretRect(
    container: HTMLElement,
    staffIndex: number,
    beatX: number,
    beatWidth: number,
    halfSteps: number
  ): Rect | null {
    const staff = this.allStaves(container)[staffIndex];
    if (!staff) return null;

    const containerBox = container.getBoundingClientRect();
    const surfaceBox = staff.surface.getBoundingClientRect();
    if (surfaceBox.width === 0) return null;

    const scale = this.scaleOf(staff.surface, surfaceBox);
    const bottomLineY = staff.lineY[staff.lineY.length - 1];
    const localY = bottomLineY - halfSteps * (staff.spacing / 2);
    const height = Math.max(10, staff.spacing * scale);

    return {
      left: surfaceBox.left - containerBox.left + beatX * scale,
      top: surfaceBox.top + localY * scale - containerBox.top - height / 2 + container.scrollTop,
      width: Math.max(10, beatWidth * scale),
      height
    };
  }

  /** Half-steps above the bottom line for a tab string on an N-line staff. */
  stringToHalfSteps(stringNumber: number, lineCount: number): number {
    return (lineCount - stringNumber) * 2;
  }

  private toLocalY(staff: StaffLines, box: DOMRect, clientY: number): number {
    return (clientY - box.top) / this.scaleOf(staff.surface, box);
  }

  /** alphaTab renders without a viewBox, so this is normally 1. */
  private scaleOf(surface: SVGSVGElement, box: DOMRect): number {
    const viewBoxWidth = surface.viewBox.baseVal.width;
    if (!viewBoxWidth || !box.width) return 1;
    return box.width / viewBoxWidth;
  }

  /** Staves on one surface, found by clustering line positions on their gap. */
  private staffGroups(surface: SVGSVGElement): StaffLines[] {
    const ys = this.lineYs(surface);
    const groups: StaffLines[] = [];

    let start = 0;
    while (start < ys.length - 1) {
      const spacing = ys[start + 1] - ys[start];
      let end = start + 1;

      while (
        end + 1 < ys.length &&
        Math.abs(ys[end + 1] - ys[end] - spacing) <= StaffHitTestService.SPACING_TOLERANCE
      ) {
        end++;
      }

      groups.push({ surface, lineY: ys.slice(start, end + 1), spacing });
      start = end + 1;
    }

    return groups;
  }

  /** Distinct y values of the thin, wide rects alphaTab uses for staff lines. */
  private lineYs(surface: SVGSVGElement): number[] {
    const ys = new Set<number>();

    for (const rect of Array.from(surface.querySelectorAll('rect'))) {
      const height = Number(rect.getAttribute('height'));
      const width = Number(rect.getAttribute('width'));
      if (!Number.isFinite(height) || !Number.isFinite(width)) continue;
      if (height > StaffHitTestService.MAX_LINE_THICKNESS) continue;
      if (width < StaffHitTestService.MIN_LINE_WIDTH) continue;

      const y = Number(rect.getAttribute('y'));
      if (Number.isFinite(y)) ys.add(Math.round(y));
    }

    return [...ys].sort((a, b) => a - b);
  }
}
