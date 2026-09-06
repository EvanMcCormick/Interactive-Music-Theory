import { BeatGrid } from '../models/transcription.model';

/**
 * Corrections a listener makes to a tracked beat grid.
 *
 * Beat tracking gets tempo right far more often than it gets phase right: the
 * grid's first beat is whichever tracked pulse the onsets first support, and
 * nothing about it makes it a downbeat. So a transcription can be perfectly in
 * time and still have every bar line a beat out of place, which no amount of
 * tuning the tracker fixes and which a listener spots instantly.
 *
 * Both functions return a new grid, so the caller can re-derive and compare.
 *
 * ## Both corrections are bounded here, not in the UI
 *
 * These are public service methods reached through `updateTempo` and
 * `nudgeDownbeat`, and a `min`/`max` on a number input is not their contract -
 * it is one caller's decoration. The bound has to live where the validation
 * already does, because what is on the other side of it is not a wrong answer
 * but a hang: bar count scales linearly with tempo, and a nudge builds an array
 * per beat it prepends. `updateTempo(9999)` on a five-minute file asks for some
 * 12,500 bars, each a `MasterBarDoc`, a `quantizeBar` call and a full bar of
 * rests, and then an alphaTab render that does not return.
 * `nudgeDownbeat(-1e9)` goes straight to `Array.from({ length: 1e9 })`. This is
 * the hazard `barsInSource` closes from the note side, reopened from the grid
 * side.
 *
 * Out-of-range values are refused rather than clamped, matching how both
 * functions already treat input they cannot use: the grid comes back untouched,
 * so a caller can compare by identity and a UI can say the correction was not
 * applied instead of silently applying a different one.
 */

/**
 * Slowest tempo a listener can state.
 *
 * Below Larghissimo, and slow enough that a beat is no longer felt as a pulse.
 * The tracker's own band starts at 50 BPM; this is well under it, because a
 * correction exists precisely for the cases the tracker got wrong.
 */
export const MIN_TEMPO_BPM = 20;

/**
 * Fastest tempo a listener can state.
 *
 * Twice Prestissimo, and comfortably past the tracker's 210 BPM ceiling, so a
 * listener who hears the tracked pulse as half-time can double it and still be
 * inside the range. At 400 BPM a five-minute source is 2,000 beats - 500 bars
 * of 4/4, a long score but a writable one.
 */
export const MAX_TEMPO_BPM = 400;

/**
 * Furthest the downbeat can be moved, in either direction.
 *
 * Two bars of 4/4. The correction answers "which pulse is beat 1", and that
 * question is settled inside one bar - a nudge of a whole bar is already the
 * same answer again. Anything past two bars is not a phase correction, it is a
 * trim, and this is not the control for it.
 */
export const MAX_DOWNBEAT_NUDGE_BEATS = 8;

/**
 * Respaces a grid to a new tempo, anchored on its first beat.
 *
 * The first beat is the one the user has already positioned with the nudge
 * controls, so a tempo change must not move it.
 *
 * A tempo outside `MIN_TEMPO_BPM`..`MAX_TEMPO_BPM` leaves the grid alone; see
 * the module docblock for why the bound is here rather than on an input.
 */
export function withTempo(grid: BeatGrid, bpm: number): BeatGrid {
  // Written as a range test rather than as `> 0` plus a ceiling, so NaN - which
  // compares false against everything - is refused by the same expression.
  if (!(bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM)) return grid;

  const beats = grid.beatsSec;
  if (beats.length < 2) return grid;

  const start = beats[0];
  const last = beats[beats.length - 1];

  // Makes the `Math.max(2, ...)` floor below an actual floor. `Math.max(2, NaN)`
  // is NaN and `Array.from({ length: NaN })` is `[]`, so a single non-finite
  // beat anywhere at the two ends would hand back an *empty* grid - and
  // `secondsToBeats` reads a grid of under two beats as position 0 for every
  // note in the piece. Unreachable from `trackBeats`, but a guard that reads
  // like one and is not is worse than no guard at all.
  if (!Number.isFinite(start) || !Number.isFinite(last)) return grid;

  const span = last - start;
  const interval = 60 / bpm;
  const count = Math.max(2, Math.round(span / interval) + 1);

  return {
    ...grid,
    beatsSec: Array.from({ length: count }, (_, i) => start + i * interval)
  };
}

/**
 * Moves which tracked beat counts as bar 1, beat 1.
 *
 * Positive nudges drop beats off the front, so the bar starts later. Negative
 * ones extend backwards using the leading interval, which can place the first
 * beat before zero — that is correct, and means the piece begins mid-bar.
 * `secondsToBeats` extrapolates before the grid by design.
 *
 * Bounded at `MAX_DOWNBEAT_NUDGE_BEATS` in *both* directions. The forward
 * direction was already limited by the beats there are to drop; the backward
 * one had no limit at all, and every beat it prepends is an array element it
 * builds first.
 *
 * ## What a round trip costs, on a grid that is not evenly spaced
 *
 * The *leading* interval, not the median, because it is the one the prepended
 * beat is adjacent to: a real tracked grid drifts, and rebuilding the head from
 * an average of the whole piece would be a worse answer than rebuilding it from
 * its neighbour. On a tracked fixture the intervals run
 * [0.49, 0.49, 0.51, 0.5, 0.5, 0.49, 0.51], so the two differ.
 *
 * That makes the two round trips asymmetric, and it is worth writing down so
 * the next reader does not have to derive it again:
 *
 * - **`-1` then `+1` is exact.** The beat that was prepended is the beat that
 *   is dropped, and nothing else was touched.
 * - **`+1` then `-1` is not.** The forward nudge discards `b0` for good, and
 *   the backward one writes `2·b1 - b2` in its place. The error is
 *   `(b1 - b0) - (b2 - b1)` - the difference between two adjacent intervals,
 *   so strictly less than one interval - and it lands entirely on the first
 *   beat, since nothing from `b1` on is rewritten.
 * - **It does not accumulate.** The second cycle rebuilds `2·b1 - b2` from the
 *   same `b1` and `b2`, so it reproduces the first cycle's answer exactly. The
 *   drift is one interval's worth once, not once per press.
 *
 * A note struck after `b1` is therefore placed identically across a round trip.
 * One struck inside the rebuilt interval moves by up to that error, which on a
 * sixteenth grid is at most a slot.
 *
 * Returns the grid it was given, by identity, whenever it would not move the
 * bar line - which `canNudgeDownbeat` answers in advance.
 */
export function nudgedDownbeat(grid: BeatGrid, beats: number): BeatGrid {
  const source = grid.beatsSec;
  if (!canNudgeDownbeat(grid, beats)) return grid;

  if (beats > 0) {
    // Bounded by the beats there are, and `canNudgeDownbeat` has already ruled
    // out a bound of zero - so this always drops at least one.
    const drop = Math.min(beats, source.length - 2);
    return { ...grid, beatsSec: source.slice(drop) };
  }

  const interval = source[1] - source[0];
  const added = Array.from(
    { length: -beats },
    (_, i) => source[0] - (i + 1) * interval
  ).reverse();

  return { ...grid, beatsSec: [...added, ...source] };
}

/**
 * Whether `nudgedDownbeat` would actually move the bar line.
 *
 * Exported so a control can be *disabled* rather than left to do nothing. The
 * forward clamp is otherwise silent: at the two-beat floor `Math.min` gives a
 * drop of zero, `slice(0)` hands back a new-but-equal array, and the caller
 * sees a fresh grid it cannot distinguish from an applied nudge - so
 * `TranscriptionService.rederive` pushes a state and the panel re-renders for
 * a correction that did not happen. `nudgedDownbeat` now returns the same grid
 * by identity in that case, and this is how a caller finds out before pressing.
 *
 * False for every reason the nudge is refused - a fractional or zero count, a
 * grid of under two beats, a count past `MAX_DOWNBEAT_NUDGE_BEATS`, and a
 * forward nudge with no beats left to drop.
 */
export function canNudgeDownbeat(grid: BeatGrid, beats: number): boolean {
  const source = grid.beatsSec;
  if (source.length < 2 || !Number.isInteger(beats) || beats === 0) return false;
  if (Math.abs(beats) > MAX_DOWNBEAT_NUDGE_BEATS) return false;

  // Backwards always has somewhere to go: it builds the beats it needs.
  return beats < 0 || source.length - 2 >= 1;
}

/**
 * Slowest level a listener can state, as grid beats per tracked pulse.
 *
 * A quarter of a beat per pulse: the tracker locked onto something four times
 * longer than the beat - a whole note read as a quarter. Two binary steps, and
 * past the coarsest level the control offers.
 */
export const MIN_BEATS_PER_PULSE = 0.25;

/**
 * Fastest level a listener can state.
 *
 * Four beats per tracked pulse, the mirror of the floor: the tracker locked
 * onto something four times shorter than the beat. Bounded here for the reason
 * the module docblock gives - beat count scales linearly with this, so the far
 * side is a render that does not return rather than a wrong answer. Five
 * minutes at the top of the tracker's 210 BPM band is 1,050 pulses; at 4 that
 * is 4,200 beats and 1,050 bars of 4/4 - the same order as `MAX_TEMPO_BPM`
 * already allows, and well short of the 12,500 that hangs.
 */
export const MAX_BEATS_PER_PULSE = 4;

/**
 * Resamples a tracked grid at a different metrical level.
 *
 * `beatsPerPulse` is grid beats per tracked pulse. 1.5 says the tracker found a
 * dotted quarter where the music is in quarters; 2 says it found a half note,
 * 0.5 says it found eighths. 1 is the identity and comes straight back.
 *
 * ## Why this is not `withTempo` at a multiple of the tempo
 *
 * Because it keeps the measurements. A beat tracker can be right about *where*
 * the beats are and wrong about *which* note value they are: a 3+3+2 tresillo
 * bassline at 153 BPM tracks at 100.96, because the strongest onset
 * periodicity in it is the three-eighth grouping, and the tracked positions are
 * still good to 23 ms against the true eighth grid. Right pulse, wrong level.
 *
 * `withTempo(grid, 151)` fixes the number and throws the measurements away: it
 * lays a **uniform** pulse from the first beat, and a human take is not
 * uniform. Measured on the file this function exists for, local tempo wanders
 * 150.5 to 153.8 across the take, so the uniform grid is right for about
 * fifteen bars and at chance by 30 to 60 seconds in.
 *
 * This samples `tracked` instead - treating `beatsSec` as a piecewise-linear
 * map from beat index to time, and reading it at `i / beatsPerPulse` - so every
 * wobble the tracker measured is inherited by the grid that replaces it. On a
 * grid drifting 150.5 to 153.8, the resampled beats sit within 0.02 ms of the
 * true ones where the best possible uniform pulse is out by 193 ms mid-take,
 * half a beat at that tempo. That contrast is the function.
 *
 * ## Always resample the *tracked* grid, never the current one
 *
 * Nothing here can enforce it - a `BeatGrid` is a `BeatGrid` - but it is what
 * makes levels commutative and lossless. Sampling a grid that was itself
 * sampled compounds the interpolation error, and a round trip would no longer
 * land where it started; `TranscriptionService.updateMetricalLevel` therefore
 * always reads `session.trackedGrid`.
 *
 * Level 1 returns the grid it was given, **by identity**. That is not only an
 * optimisation: `resuppressed` asks whether `grid.beatsSec` is still the
 * tracked array to decide whether the user has corrected the beats by hand, and
 * a level of 1 that handed back an equal-but-new array would answer yes for a
 * correction nobody made. The arithmetic agrees with the shortcut anyway -
 * sampling at integer indices is exact, so the value path returns the same
 * times to the last bit.
 *
 * ## Count, and the tail
 *
 * As many beats as fit inside the tracked span, `floor((n - 1) *
 * beatsPerPulse) + 1`, so the last resampled beat is at most one beat short of
 * the last tracked one. That tail is `secondsToBeats`' extrapolation to cover,
 * exactly as it already covers the audio past the end of a tracked grid.
 *
 * The floor of two beats is the same floor `withTempo` keeps, and for the same
 * reason: `secondsToBeats` reads a grid of under two beats as position 0 for
 * every note in the piece. It only binds on a grid of two or three beats
 * resampled coarser, and there the second beat is extrapolated past the end
 * using the final tracked interval - the local one, not `secondsToBeats`'
 * median-clamped one, since a grid that short has no median worth the name.
 *
 * A `beatsPerPulse` outside `MIN_BEATS_PER_PULSE`..`MAX_BEATS_PER_PULSE`, or
 * not a number at all, leaves the grid alone - refused rather than clamped,
 * like every other correction in this module. Identity does not report that,
 * because level 1 is applied and also returns the grid; `canApplyMetricalLevel`
 * is the question a caller asks instead, and the one this is written in terms
 * of.
 */
export function atMetricalLevel(tracked: BeatGrid, beatsPerPulse: number): BeatGrid {
  if (!canApplyMetricalLevel(tracked, beatsPerPulse)) return tracked;
  if (beatsPerPulse === 1) return tracked;

  const beats = tracked.beatsSec;
  const last = beats.length - 1;
  const count = Math.max(2, Math.floor(last * beatsPerPulse) + 1);
  const beatsSec: number[] = [];
  for (let i = 0; i < count; i++) beatsSec.push(timeAtBeat(beats, i / beatsPerPulse));

  return { ...tracked, beatsSec };
}

/**
 * Whether `atMetricalLevel` can resample `grid` at this level at all.
 *
 * The same shape as `canNudgeDownbeat` and there for a related reason, but a
 * different question. A refused level and an applied one both hand back a
 * grid, and at level 1 they hand back *the same* grid, so identity cannot tell
 * a caller which happened - and a caller that recorded the level anyway would
 * leave a session claiming a level its grid is not at.
 *
 * So this answers applicability rather than effect: **true at level 1**, which
 * is applied and is the identity, and false only where the resampling could
 * not happen - a level outside the bounds or not a number, a grid of under two
 * beats, or one whose ends are not times.
 *
 * `atMetricalLevel` is written in terms of this rather than repeating the
 * conditions, so the two cannot drift apart.
 */
export function canApplyMetricalLevel(grid: BeatGrid, beatsPerPulse: number): boolean {
  // A range test rather than `> 0` plus a ceiling, so NaN - false against
  // everything - is refused by the same expression. `withTempo` does the same.
  if (!(beatsPerPulse >= MIN_BEATS_PER_PULSE && beatsPerPulse <= MAX_BEATS_PER_PULSE)) {
    return false;
  }

  const beats = grid.beatsSec;
  if (beats.length < 2) return false;

  // No length hazard in the resampling - the count comes off the index span,
  // not off the times - but a non-finite end would make every interpolated
  // time non-finite, and `withTempo` already refuses this grid. Handing back a
  // grid of NaNs would be worse than handing back the one that was given.
  return Number.isFinite(beats[0]) && Number.isFinite(beats[beats.length - 1]);
}

/**
 * Time of a fractional beat index on a measured grid.
 *
 * The inverse of `secondsToBeats`, and linear between neighbours for the same
 * reason it is: a grid is a list of measured beats rather than one tempo, so a
 * position between two of them is a walk along the interval they bound rather
 * than a division.
 *
 * An integer index returns its beat exactly - `beats[low] + 0 * span` - which
 * is what makes a round trip through level 1 return the original times bit for
 * bit rather than approximately.
 *
 * Past either end it extrapolates by the edge interval, which is how the tail
 * of a resampled grid gets written when the two-beat floor asks for a beat the
 * tracked grid does not reach.
 */
function timeAtBeat(beats: number[], index: number): number {
  const last = beats.length - 1;

  if (index <= 0) return beats[0] + index * (beats[1] - beats[0]);
  if (index >= last) return beats[last] + (index - last) * (beats[last] - beats[last - 1]);

  const low = Math.floor(index);

  return beats[low] + (index - low) * (beats[low + 1] - beats[low]);
}
