import {
  BarDoc,
  BeatDoc,
  ScoreDoc,
  TimeSignature,
  VoiceDoc,
  createDefaultNoteEffects,
  createRestBeat,
  effectiveTimeSignature
} from '../models/composer.model';
import { insertBarInto } from './score-structure';
import { DurationUnit, barGridFault, metricFrame, slotsToDurations } from './transcription-quantize';

/**
 * Bar arithmetic for the composer: how full a bar is, filling its gaps with rests, and
 * carrying its overflow into the next bar when the user asks.
 *
 * Everything is measured the way alphaTab lays a bar out - its ticks, its truncation, and
 * its `displayDuration` rather than its `playbackDuration` - so this module and the renderer
 * cannot disagree about whether a bar is full. See "Bar filling" in
 * docs/plans/2026-09-13-composer-editor-design.md for why gaps fill and overflow does not.
 */

/** alphaTab's `MidiUtils.QuarterTime`. */
export const TICKS_PER_QUARTER = 960;

/**
 * The ticks a beat occupies in its bar as alphaTab 1.8.0 lays it out: `Beat.displayDuration`.
 *
 * Layout, not playback, is the measure. `Voice.finish` advances each beat's `displayStart` by
 * `displayDuration` (`alphaTab.core.mjs` ~3304) and the renderer spaces beats by it (~65300).
 * `playbackDuration` is rewritten for grace notes and the beats they steal from (~3248-3276,
 * ~7713-7736), so it does not say how much of a bar a beat fills.
 *
 * A grace beat occupies no ticks: `updateDurations` sets its `displayDuration` to 0 (~7726).
 * Every other beat is `_calculateDuration` (~7690-7708): the value, then its dots, then its
 * tuplet, truncating at each step.
 *
 * alphaTab also lays out a voice made of one whole rest as exactly the bar's length
 * (`isFullBarRest`, ~7281). That depends on the voice, not the beat, so `barFillOf` applies
 * it; here a whole rest is always 3840.
 */
export function beatTicks(beat: Pick<BeatDoc, 'duration' | 'dots' | 'tuplet' | 'effects'>): number {
  if (beat.effects.grace !== 'none') return 0;

  const value = beat.duration < 0 ? 1 / -beat.duration : beat.duration;
  let ticks = (TICKS_PER_QUARTER * (4 / value)) | 0;

  if (beat.dots === 2) ticks = ticks + ((ticks / 4) | 0) * 3;
  else if (beat.dots === 1) ticks = ticks + ((ticks / 2) | 0);

  // alphaTab's guard, exactly (~7704): a tuplet with no positive denominator, or a negative
  // numerator, is no tuplet. A numerator of 0 passes it and divides by zero; `Infinity | 0`
  // (and `NaN | 0`) is 0 in JavaScript, so alphaTab measures that beat as 0 and so does this.
  if (beat.tuplet && beat.tuplet.denominator > 0 && beat.tuplet.numerator >= 0) {
    ticks = ((ticks * beat.tuplet.denominator) / beat.tuplet.numerator) | 0;
  }
  return ticks;
}

/** How a bar's contents compare with its meter. */
export type BarFill =
  | { kind: 'full' }
  | { kind: 'under'; ticks: number }
  | { kind: 'over'; ticks: number };

/**
 * Everything a bar's length is measured against: the time signature in force there, and
 * whether the bar is in free time.
 *
 * One value rather than a bare `TimeSignature`, so no per-bar function in this module can be
 * called without saying whether the meter governs the bar. Free time is the score saying it
 * does not, so a free-time bar is full whatever it holds - and nothing fills or trims it.
 */
export interface BarMeter {
  timeSignature: TimeSignature;
  isFreeTime: boolean;
}

/** The meter bar `barIndex` is measured against: the time signature in force, and free time. */
export function barMeterAt(doc: ScoreDoc, barIndex: number): BarMeter {
  return {
    timeSignature: effectiveTimeSignature(doc.masterBars, barIndex),
    isFreeTime: doc.masterBars[barIndex]?.isFreeTime ?? false
  };
}

/**
 * A bar's capacity in ticks under `timeSignature`: alphaTab's `MasterBar.calculateDuration`
 * (~2685-2698), the numerator times one denominator value's ticks. The model has no anacrusis,
 * so alphaTab's pickup-bar branch never applies.
 */
export function barCapacityTicks(timeSignature: TimeSignature): number {
  return timeSignature.numerator * ((TICKS_PER_QUARTER * (4 / timeSignature.denominator)) | 0);
}

/**
 * Whether alphaTab reads `beat` as a rest: a beat with no notes (`Beat.isRest`, ~7275). The
 * mapper writes notes only when `isRest` is false, so a beat is a rest to alphaTab when either
 * says so - including a beat marked `isRest: false` that holds no notes.
 */
function isAlphaTabRest(beat: BeatDoc): boolean {
  return beat.isRest || beat.notes.length === 0;
}

/**
 * Whether `voice` is one whole rest, which alphaTab lays out as exactly its bar in any meter.
 *
 * alphaTab's `Beat.isFullBarRest` (~7281-7283) is a rest, alone in its voice, whose value is a
 * whole. `_calculateDuration` returns the master bar's length for it before reading dots or a
 * tuplet (~7694-7696), so a dotted or tupleted lone whole rest still fills the bar. A grace
 * beat's `displayDuration` is 0 whatever `_calculateDuration` returned (~7726), so a lone whole
 * grace rest fills nothing.
 */
function isLoneWholeRest(voice: VoiceDoc): boolean {
  if (voice.beats.length !== 1) return false;
  const beat = voice.beats[0];
  return isAlphaTabRest(beat) && beat.duration === 1 && beat.effects.grace === 'none';
}

/**
 * The ticks a voice's beats occupy, each as `beatTicks` measures it - so a grace beat adds
 * nothing. It does not apply the lone-whole-rest rule, which needs the meter: `barFillOf`
 * does, and every caller in this module reads this only for a bar `barFillOf` has not called
 * full.
 */
export function voiceTicks(voice: VoiceDoc): number {
  return voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
}

/**
 * How full `bar` is under `meter`, as alphaTab lays it out: a grace beat takes no room, a
 * voice that is a lone whole rest is full in any meter, and a free-time bar is full whatever
 * it holds.
 *
 * Voice 1 only. It is the only voice the composer writes, and multiple voices are listed
 * beyond M4 in the design. When they arrive each voice is measured on its own - alphaTab
 * applies `isFullBarRest` per voice, so a lone whole rest is full in any voice, not just the
 * first - and the bar answers for its fullest voice.
 */
export function barFillOf(bar: BarDoc, meter: BarMeter): BarFill {
  if (meter.isFreeTime) return { kind: 'full' };
  const voice = bar.voices[0];
  if (voice && isLoneWholeRest(voice)) return { kind: 'full' };
  const difference = (voice ? voiceTicks(voice) : 0) - barCapacityTicks(meter.timeSignature);
  if (difference === 0) return { kind: 'full' };
  return difference < 0 ? { kind: 'under', ticks: -difference } : { kind: 'over', ticks: difference };
}

/** Every bar's fill, indexed `[track][staff][bar]`, each read against its own `barMeterAt`. */
export function scoreBarFills(doc: ScoreDoc): BarFill[][][] {
  return doc.tracks.map(track =>
    track.staves.map(staff => staff.bars.map((bar, index) => barFillOf(bar, barMeterAt(doc, index))))
  );
}

/**
 * One bar's fill, read against its own `barMeterAt` - or undefined when there is no such bar.
 * For a caller asking about a few bars, which should not measure the whole score to do it.
 */
export function barFillAt(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  barIndex: number
): BarFill | undefined {
  const bar = doc.tracks[trackIndex]?.staves[staffIndex]?.bars[barIndex];
  return bar ? barFillOf(bar, barMeterAt(doc, barIndex)) : undefined;
}

/** A 64th note: the finest value the rest speller writes. */
const SLOT_DIVISION = 64;
const SLOT_TICKS = TICKS_PER_QUARTER / 16;

/**
 * Where the run of grace beats that ends just before `voice.beats[index]` begins - `index`
 * itself when the beat before it is not a grace.
 *
 * A grace beat is written in front of the beat after it, and alphaTab groups it with the next
 * non-grace beat in its own voice (`Voice.finish`, ~3200-3216). Anything inserted or cut at
 * `index` goes before such a run, so the placement keeps what the user wrote in order: graces
 * stay in front of the beat they lead into. A run that ends the voice leads into nothing -
 * alphaTab leaves its group incomplete (`GraceGroup.isComplete` stays false) - and it stays
 * last, where it was written.
 */
function graceRunStart(voice: VoiceDoc, index: number): number {
  let start = index;
  while (start > 0 && voice.beats[start - 1].effects.grace !== 'none') start--;
  return start;
}

/**
 * `ticks` spelled as written values starting `startTicks` into a bar of `timeSignature`,
 * split at beat and half-bar lines - or null when that cannot be done exactly.
 */
function spelledTicks(ticks: number, startTicks: number, timeSignature: TimeSignature): DurationUnit[] | null {
  if (ticks % SLOT_TICKS !== 0 || startTicks % SLOT_TICKS !== 0) return null;
  if (barGridFault(timeSignature, SLOT_DIVISION) !== null) return null;

  const frame = metricFrame(timeSignature, SLOT_DIVISION / timeSignature.denominator);
  return slotsToDurations(ticks / SLOT_TICKS, SLOT_DIVISION, startTicks / SLOT_TICKS, frame);
}

/**
 * Adds rests at the end of `bar` until it is full, when that can be done exactly.
 *
 * The gap goes at the end because that is where shortening a beat leaves it: every later
 * beat moves earlier. The rests go in front of any grace beats that end the bar, so those
 * graces stay last, in the order they were written (`graceRunStart`). A grace takes no room,
 * so it moves no rest's start. Rests are spelled at a 64th grid, split at beat and half-bar
 * lines by the quantizer's own speller. Nothing happens when the bar is full or over - a
 * free-time bar always is (`barFillOf`) - when the meter has no 64th grid, or when the gap or
 * its start is not a whole number of 64ths - a lone tuplet's remainder - because a fill that
 * is only nearly right is worse than a bar still honestly reported as under.
 */
export function fillBarGaps(bar: BarDoc, meter: BarMeter): void {
  const fill = barFillOf(bar, meter);
  const voice = bar.voices[0];
  if (fill.kind !== 'under' || !voice) return;

  const units = spelledTicks(fill.ticks, voiceTicks(voice), meter.timeSignature) ?? [];
  const rests = units.map(unit => ({ ...createRestBeat(unit.duration), dots: unit.dots }));
  voice.beats.splice(graceRunStart(voice, voice.beats.length), 0, ...rests);
}

/**
 * Whether a walk that makes room may remove `voice.beats[index]`: a beat alphaTab reads as a
 * rest (`isAlphaTabRest`) that is not a grace beat, and that no grace beat leads into.
 *
 * A grace beat takes no room, so removing one gains nothing, and it belongs to the beat after
 * it (see `graceRunStart`): removing the rest a grace leads into would leave the grace in front
 * of whatever came next. A walk stops at either, and what it could not take is left as
 * overflow - the same line the design draws at a note.
 */
function isTakeableRest(voice: VoiceDoc, index: number): boolean {
  const beat = voice.beats[index];
  const before = index > 0 ? voice.beats[index - 1] : null;
  return isAlphaTabRest(beat) && beat.effects.grace === 'none' && (before === null || before.effects.grace === 'none');
}

/**
 * Removes rests after `beat` in `voice` until `ticks` are covered, and returns the ticks it
 * could not cover. `voice` is in a bar measured against `meter`.
 *
 * It stops at the first note - the design's line: lengthening consumes only following
 * rests, and anything that would overwrite a note is left as overflow for the user to
 * see. It stops at a grace beat too, rest or not, or a rest a grace leads into, and never
 * removes either (`isTakeableRest`). And it stops at any beat in `changing`, so a range
 * pressed together is changed together rather than one beat eating its neighbours. A rest
 * longer than what is left is taken whole; the caller's `fillBarGaps` puts the difference
 * back. Beats are held by identity, not index, because every removal shifts the indices
 * after it.
 *
 * In a free-time bar it removes nothing and returns all of `ticks`: the meter does not
 * govern that bar, so there is no room to make, and a lengthened beat simply makes the bar
 * longer. `meter` is required, like every per-bar function here, so no caller can forget
 * to ask. The walk's index never moves: each removal brings the next beat to it.
 */
export function absorbFollowingRests(
  voice: VoiceDoc,
  beat: BeatDoc,
  ticks: number,
  changing: ReadonlySet<BeatDoc>,
  meter: BarMeter
): number {
  if (meter.isFreeTime) return ticks;
  let remaining = ticks;
  const index = voice.beats.indexOf(beat) + 1;
  if (index === 0) return remaining;

  // Every pass removes a beat or stops, so the walk ends however little a beat is worth.
  while (remaining > 0 && index < voice.beats.length) {
    const next = voice.beats[index];
    if (!isTakeableRest(voice, index) || changing.has(next)) break;
    remaining -= beatTicks(next);
    voice.beats.splice(index, 1);
  }
  return Math.max(0, remaining);
}

/** What Fix bar did: how many bars it had to add, or why it did nothing. */
export type FixBarResult =
  | { kind: 'fixed'; appendedBars: number }
  | { kind: 'refused'; reason: string };

const TUPLET_ACROSS_LINE =
  'A tuplet crosses the bar line, so no written value can split it. Shorten it until the bar fits.';

/**
 * Carries the overflow of bar `barIndex` on one staff into the bars after it, tied, until
 * a bar it reaches is no longer over. See the section comment above Task B6 in the M1 plan
 * for what a continuation carries.
 *
 * Every bar is read against its own `barMeterAt`, so a free-time bar is never over: Fix bar
 * refuses one, and a carry that reaches one stops there, taking none of its rests.
 *
 * **May leave `doc` partly changed when it refuses.** Call it on a draft you can discard.
 */
export function fixBarOverflow(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  barIndex: number
): FixBarResult {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff?.bars[barIndex]) return { kind: 'refused', reason: 'There is no bar there.' };

  let appendedBars = 0;
  for (let index = barIndex; index < staff.bars.length; index++) {
    const meter = barMeterAt(doc, index);
    const bar = staff.bars[index];

    if (barFillOf(bar, meter).kind !== 'over') {
      if (index === barIndex) {
        return { kind: 'refused', reason: 'That bar is not over its time signature.' };
      }
      fillBarGaps(bar, meter);
      return { kind: 'fixed', appendedBars };
    }

    const carried = beatsPastBarLine(
      bar.voices[0],
      meter.timeSignature,
      barMeterAt(doc, index + 1).timeSignature
    );
    if (carried === null) return { kind: 'refused', reason: TUPLET_ACROSS_LINE };

    if (index === staff.bars.length - 1) {
      insertBarInto(doc, staff.bars.length);
      appendedBars++;
    }

    const next = staff.bars[index + 1];
    next.voices[0].beats.unshift(...carried);
    takeTrailingRests(next, barMeterAt(doc, index + 1));
  }
  return { kind: 'fixed', appendedBars };
}

/**
 * Cuts `voice` at its bar line and returns what lay past it: the tied tail of the beat that
 * crossed the line, then every later beat whole. Returns null, leaving `voice` untouched,
 * when the crossing beat cannot be split into written values.
 *
 * A grace beat is 0 ticks, so it never crosses the line. Graces just before the first whole
 * beat past it go with that beat; graces before a crossing beat stay with its head. Graces
 * after a crossing beat go behind its tied tail, keeping the order they were written in - so
 * graces that ended the bar, which led into nothing there, follow the tail into the next bar.
 */
function beatsPastBarLine(
  voice: VoiceDoc,
  timeSignature: TimeSignature,
  nextTimeSignature: TimeSignature
): BeatDoc[] | null {
  const capacity = barCapacityTicks(timeSignature);
  let start = 0;

  for (let index = 0; index < voice.beats.length; index++) {
    const beat = voice.beats[index];
    const end = start + beatTicks(beat);
    if (end <= capacity) {
      start = end;
      continue;
    }

    if (start >= capacity) return voice.beats.splice(graceRunStart(voice, index));

    const head = spelledTicks(capacity - start, start, timeSignature);
    const tail = spelledTicks(end - capacity, 0, nextTimeSignature);
    if (!head || !tail) return null;

    const after = voice.beats.splice(index + 1);
    voice.beats.splice(index, 1, ...piecesOf(beat, head, false));
    return [...piecesOf(beat, tail, true), ...after];
  }
  return [];
}

/**
 * `beat` rewritten as one beat per written value. The first piece of the head is the beat
 * itself, re-valued, so its effects and attack stay where they were struck; every other
 * piece is a tied continuation - same pitches, `isTied`, no effects.
 */
function piecesOf(beat: BeatDoc, units: DurationUnit[], isTail: boolean): BeatDoc[] {
  return units.map((unit, index): BeatDoc => {
    if (index === 0 && !isTail) {
      return { ...structuredClone(beat), duration: unit.duration, dots: unit.dots, tuplet: null };
    }
    return {
      ...createRestBeat(unit.duration),
      dots: unit.dots,
      isRest: beat.isRest,
      notes: beat.notes.map(note => ({
        ...structuredClone(note),
        isTied: true,
        effects: createDefaultNoteEffects()
      }))
    };
  });
}

/**
 * Removes rests from the end of `bar` while it is over `meter`, and stops as soon as it is not.
 *
 * Stopping when the bar stops being over, rather than once some number of ticks is covered,
 * is what keeps a whole rest that still fits: once the rests after it are gone a lone whole
 * rest is full in any meter (`barFillOf`), and a carry can leave a whole rest exactly filling
 * a bar beside it. It stops at a note, a grace beat, or a rest a grace leads into
 * (`isTakeableRest`); what it cannot take stays as overflow. A free-time bar is never over, so
 * nothing is taken from one.
 */
function takeTrailingRests(bar: BarDoc, meter: BarMeter): void {
  const voice = bar.voices[0];
  if (!voice) return;
  while (barFillOf(bar, meter).kind === 'over') {
    const last = voice.beats.length - 1;
    if (last < 0 || !isTakeableRest(voice, last)) return;
    voice.beats.pop();
  }
}
