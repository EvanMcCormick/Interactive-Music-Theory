import { BeatDoc, TimeSignature } from '../models/composer.model';

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
