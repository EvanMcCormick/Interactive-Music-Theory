import {
  ClefKind,
  KeySignature,
  MasterBarDoc,
  OttaviaKind,
  ScoreDoc,
  TimeSignature,
  effectiveTimeSignature
} from '../models/composer.model';
import { barMeterAt, fitBarToMeter } from './bar-fill';
import { toggledValue } from './beat-edits';

/** Edits that act on bars. They change the document they are given. */

const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** Why no score could have `timeSignature`, or null. */
export function timeSignatureFault(timeSignature: TimeSignature): string | null {
  const { numerator, denominator } = timeSignature;
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
    return 'The top number must be a whole number from 1 to 32.';
  }
  if (!DENOMINATORS.includes(denominator)) {
    return 'The bottom number (the denominator) must be 1, 2, 4, 8, 16 or 32.';
  }
  return null;
}

/** Why no score could have `keySignature`, or null. */
export function keySignatureFault(keySignature: KeySignature): string | null {
  const { fifths, mode } = keySignature;
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
    return 'A key signature has from 7 flats to 7 sharps.';
  }
  return mode === 'major' || mode === 'minor' ? null : 'A key is major or minor.';
}

const sameMeter = (a: TimeSignature | null, b: TimeSignature | null): boolean =>
  !!a && !!b && a.numerator === b.numerator && a.denominator === b.denominator;

/**
 * Declares `timeSignature` from bar `first`, and fits every staff's bars under it.
 *
 * Declarations stay in the declare-on-change shape the mapper reads a file into: nothing is
 * declared where the meter is already in force (bar 1 always declares), and a later bar
 * that declared this same meter drops its now-repeated declaration. Each bar is fitted against
 * its own `barMeterAt`, read after the declarations change, so a free-time bar keeps what it
 * holds.
 */
export function setTimeSignature(doc: ScoreDoc, first: number, timeSignature: TimeSignature): void {
  const masterBars = doc.masterBars;
  if (!masterBars[first]) return;

  const inForce = first > 0 ? effectiveTimeSignature(masterBars, first - 1) : null;
  masterBars[first].timeSignature = sameMeter(inForce, timeSignature) ? null : { ...timeSignature };

  let end = first + 1;
  while (end < masterBars.length) {
    const declared = masterBars[end].timeSignature;
    if (declared && !sameMeter(declared, timeSignature)) break;
    masterBars[end].timeSignature = null;
    end++;
  }

  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      for (let index = first; index < end; index++) {
        const bar = staff.bars[index];
        if (bar) fitBarToMeter(bar, barMeterAt(doc, index));
      }
    }
  }
}

/** Sets the key on every staff from bar `first`, until a bar carries a different key. */
export function setKeySignature(doc: ScoreDoc, first: number, keySignature: KeySignature): void {
  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      const was = staff.bars[first]?.keySignature;
      if (!was) continue;
      const from = { ...was };
      for (let index = first; index < staff.bars.length; index++) {
        const key = staff.bars[index].keySignature;
        if (key.fifths !== from.fifths || key.mode !== from.mode) break;
        staff.bars[index].keySignature = { ...keySignature };
      }
    }
  }
}

/** Sets clef and ottava on one staff from bar `first`, until a bar carries different ones. */
export function setClef(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  first: number,
  clef: ClefKind,
  ottava: OttaviaKind
): void {
  const bars = doc.tracks[trackIndex]?.staves[staffIndex]?.bars ?? [];
  const was = bars[first];
  if (!was) return;
  const from = { clef: was.clef, ottava: was.clefOttava };
  for (let index = first; index < bars.length; index++) {
    if (bars[index].clef !== from.clef || bars[index].clefOttava !== from.ottava) break;
    bars[index].clef = clef;
    bars[index].clefOttava = ottava;
  }
}

/**
 * Presses a bar flag tool across bars `first` to `last`, by the toggle rule.
 *
 * Free time is the one flag that changes how a bar is measured. Nothing fits a bar while it is
 * in free time (`barFillOf` calls it full), so each bar this press takes out of free time is
 * fitted to its meter on every staff, read after the flag changes - otherwise a short bar would
 * stay short until its next length edit. Putting a bar into free time changes nothing else.
 */
export function toggleMasterBarFlag(
  doc: ScoreDoc,
  bars: { first: number; last: number },
  key: 'isRepeatStart' | 'isDoubleBar' | 'isFreeTime'
): void {
  const targets = doc.masterBars.slice(bars.first, bars.last + 1);
  const value = toggledValue(targets.map(bar => bar[key]), true, false);
  const leavingFreeTime = targets.flatMap((bar, offset) =>
    key === 'isFreeTime' && bar.isFreeTime && !value ? [bars.first + offset] : []
  );
  for (const bar of targets) bar[key] = value;

  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      for (const index of leavingFreeTime) {
        const bar = staff.bars[index];
        if (bar) fitBarToMeter(bar, barMeterAt(doc, index));
      }
    }
  }
}

/** Sets a valued bar attribute across bars `first` to `last`. */
export function setMasterBarValue<K extends 'repeatCount' | 'alternateEndings' | 'tripletFeel' | 'section'>(
  doc: ScoreDoc,
  bars: { first: number; last: number },
  key: K,
  value: MasterBarDoc[K]
): void {
  for (const bar of doc.masterBars.slice(bars.first, bars.last + 1)) {
    bar[key] = structuredClone(value);
  }
}
