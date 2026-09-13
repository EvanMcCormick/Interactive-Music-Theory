import { BeatDoc, TimeSignature } from '../models/composer.model';

/**
 * Bar arithmetic for the composer: how full a bar is, filling its gaps with rests, and
 * carrying its overflow into the next bar when the user asks.
 *
 * Everything is measured in alphaTab's ticks with alphaTab's truncation, so this module and
 * the renderer cannot disagree about whether a bar is full. See "Bar filling" in
 * docs/plans/2026-09-13-composer-editor-design.md for why gaps fill and overflow does not.
 */

/** alphaTab's `MidiUtils.QuarterTime`. */
export const TICKS_PER_QUARTER = 960;

/**
 * A beat's written length in ticks, as alphaTab 1.8.0's `Beat._calculateDuration` computes
 * it: the value, then its dots, then its tuplet, truncating at each step.
 *
 * Unlike alphaTab, a rest that is the only beat in its voice is measured at its written
 * value rather than as a whole bar - the composer never relies on that shorthand.
 */
export function beatTicks(beat: Pick<BeatDoc, 'duration' | 'dots' | 'tuplet'>): number {
  const value = beat.duration < 0 ? 1 / -beat.duration : beat.duration;
  let ticks = (TICKS_PER_QUARTER * (4 / value)) | 0;

  if (beat.dots === 2) ticks = ticks + ((ticks / 4) | 0) * 3;
  else if (beat.dots === 1) ticks = ticks + ((ticks / 2) | 0);

  if (beat.tuplet) ticks = ((ticks * beat.tuplet.denominator) / beat.tuplet.numerator) | 0;
  return ticks;
}
