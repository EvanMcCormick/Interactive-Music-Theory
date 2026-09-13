import {
  BarDoc,
  BeatDoc,
  ScoreDoc,
  TimeSignature,
  VoiceDoc,
  effectiveTimeSignature
} from '../models/composer.model';

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
