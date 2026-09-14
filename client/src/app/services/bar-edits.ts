import {
  BarDoc,
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
import { insertBarInto } from './score-structure';

/** Edits that act on bars. They change the document they are given. */

const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** Whether a meter is drawn as a C when asked: 4/4 as common time, 2/2 as cut time. */
export function commonTimeAppliesTo(numerator: number, denominator: number): boolean {
  return (numerator === 4 && denominator === 4) || (numerator === 2 && denominator === 2);
}

/**
 * Why no score could have `timeSignature`, or null. Common time on any meter but 4/4 and 2/2 is refused here, in the
 * service's guard; the popover's box follows the numbers so it never asks for it.
 */
export function timeSignatureFault(timeSignature: TimeSignature): string | null {
  const { numerator, denominator } = timeSignature;
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
    return 'The top number (the numerator) must be a whole number from 1 to 32.';
  }
  if (!DENOMINATORS.includes(denominator)) {
    return 'The bottom number (the denominator) must be 1, 2, 4, 8, 16 or 32.';
  }
  if (timeSignature.isCommon && !commonTimeAppliesTo(numerator, denominator)) {
    return 'Common time is drawn only for 4/4, and cut time only for 2/2.';
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

/**
 * Whether two declarations are the same meter as a reader sees it. Common time is its own: C is
 * drawn as its symbol and 4/4 as numbers, and the mapper writes `isCommon`, so switching between
 * them is a change to declare, and a C declared under 4/4 is not a repeat to drop.
 */
const sameMeter = (a: TimeSignature | null, b: TimeSignature | null): boolean =>
  !!a && !!b && a.numerator === b.numerator && a.denominator === b.denominator && a.isCommon === b.isCommon;

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

/** Sets the key on every staff, over the bars `writtenBarsOf` names on each. */
export function setKeySignature(doc: ScoreDoc, bars: { first: number; last: number }, keySignature: KeySignature): void {
  for (const track of doc.tracks) {
    for (const staff of track.staves) {
      for (const index of writtenBarsOf(staff.bars, bars, bar => `${bar.keySignature.fifths}:${bar.keySignature.mode}`)) {
        staff.bars[index].keySignature = { ...keySignature };
      }
    }
  }
}

/**
 * Sets clef and ottava on one staff, over the bars `writtenBarsOf` names. A null field is left as each bar has it: the
 * Clef popover sends a field the selected bars do not share, and the user did not change, as null.
 */
export function setClef(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  range: { first: number; last: number },
  clef: ClefKind | null,
  ottava: OttaviaKind | null
): void {
  const bars = doc.tracks[trackIndex]?.staves[staffIndex]?.bars ?? [];
  for (const index of writtenBarsOf(bars, range, bar => `${bar.clef}:${bar.clefOttava}`)) {
    bars[index].clef = clef ?? bars[index].clef;
    bars[index].clefOttava = ottava ?? bars[index].clefOttava;
  }
}

/**
 * The bars of a staff that a key, clef or ottava is written to. A range of more than one bar is written whole, whatever
 * each bar held, as the user selected it. From one bar - the caret, or a range inside it - the write runs on until a bar
 * holds something else (`held`), as a key or clef change does, so a change there does not stop at the bar's end.
 */
function writtenBarsOf(bars: readonly BarDoc[], range: { first: number; last: number }, held: (bar: BarDoc) => string): number[] {
  const start = bars[range.first];
  if (!start) return [];
  const indices: number[] = [];
  if (range.last > range.first) {
    for (let index = range.first; index <= range.last && index < bars.length; index++) indices.push(index);
    return indices;
  }
  const from = held(start);
  for (let index = range.first; index < bars.length && held(bars[index]) === from; index++) indices.push(index);
  return indices;
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

/**
 * Presses Repeat close over bars `first` to `last`, by the toggle rule: each bar closes a repeat played
 * twice - or keeps the count it already has - unless every one already closes a repeat, and then none
 * does. `repeatCount` is how many times the section plays, so two is a plain repeat.
 */
export function toggleRepeatClose(doc: ScoreDoc, bars: { first: number; last: number }): void {
  const targets = doc.masterBars.slice(bars.first, bars.last + 1);
  const closing = !targets.every(bar => bar.repeatCount > 0);
  for (const bar of targets) bar.repeatCount = closing ? Math.max(bar.repeatCount, 2) : 0;
}

/** Inserts `count` bars in front of bar `first`, across every track. See `insertBarInto`. */
export function insertBarsBefore(doc: ScoreDoc, first: number, count: number): void {
  for (let inserted = 0; inserted < count; inserted++) insertBarInto(doc, first);
}

/**
 * Removes bars `first` to `last` from every track, or returns why not: a score keeps at least one bar.
 *
 * The meter in force after the removed bars is kept. The bar that now follows them declares it, unless
 * it is already the meter in force before them - the declare-on-change shape the mapper reads a file
 * into, and the rule `insertBarInto` keeps for bar 1. Without this, removing a 3/4 score's first bar
 * would leave a bar 1 that declares nothing, which reads as 4/4.
 */
export function deleteBars(doc: ScoreDoc, bars: { first: number; last: number }): string | null {
  const count = bars.last - bars.first + 1;
  if (count >= doc.masterBars.length) return 'A score needs at least one bar.';

  const hasFollowing = bars.last + 1 < doc.masterBars.length;
  const following = effectiveTimeSignature(doc.masterBars, bars.last + 1);
  doc.masterBars.splice(bars.first, count);
  for (const track of doc.tracks) {
    for (const staff of track.staves) staff.bars.splice(bars.first, count);
  }

  if (hasFollowing) {
    const inForce = bars.first > 0 ? effectiveTimeSignature(doc.masterBars, bars.first - 1) : null;
    doc.masterBars[bars.first].timeSignature = sameMeter(inForce, following) ? null : { ...following };
  }
  return null;
}
