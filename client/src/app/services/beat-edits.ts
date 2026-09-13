import {
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  ScoreDoc,
  Tuplet
} from '../models/composer.model';
import { absorbFollowingRests, barFillOf, barMeterAt, beatTicks, fillBarGaps, insertRestsAt } from './bar-fill';
import { BeatRef, beatAt } from './composer-selection';

/**
 * Edits that act on whole beats: their effects, dynamics and lengths.
 *
 * Every function changes the `ScoreDoc` it is given - `ComposerService.commit` hands it a
 * clone - and trusts its caller to have asked `editRefusal` first.
 */

/**
 * The value a toggle press sets: `on`, unless every target already has it, then `off`.
 *
 * The design's rule for a mixed range. It never depends on which end of the selection was
 * clicked first, so the palette can show what a press will do before it is pressed.
 */
export function toggledValue<T>(current: readonly T[], on: T, off: T): T {
  const allOn = current.length > 0 && current.every(value => JSON.stringify(value) === JSON.stringify(on));
  return allOn ? off : on;
}

/** The beats `refs` name, skipping any that name nothing. */
export function beatsAt(doc: ScoreDoc, refs: readonly BeatRef[]): BeatDoc[] {
  return refs.map(ref => beatAt(doc, ref)).filter((beat): beat is BeatDoc => beat !== null);
}

/**
 * Presses a beat effect tool on `refs`, by the toggle rule.
 *
 * Every effect but `grace`, which the type leaves out: a grace takes no room, so becoming or
 * leaving one changes how full the bar is, and only `setGrace` settles the bar for it.
 */
export function toggleBeatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  key: K,
  on: BeatEffectsDoc[K],
  off: BeatEffectsDoc[K]
): void {
  const targets = beatsAt(doc, refs);
  const value = toggledValue(targets.map(beat => beat.effects[key]), on, off);
  for (const beat of targets) beat.effects[key] = structuredClone(value);
}

/** Marks a dynamic on every beat in `refs`; null removes it. */
export function setDynamics(doc: ScoreDoc, refs: readonly BeatRef[], dynamics: DynamicValue | null): void {
  for (const beat of beatsAt(doc, refs)) beat.dynamics = dynamics;
}

/**
 * Gives every beat in `refs` a written value, then keeps each bar honest. See `relength`.
 *
 * Grace beats keep theirs. alphaTab sets a grace's written value itself when the score is
 * finished - an eighth, sixteenth or thirty-second by the size of its grace group
 * (`Beat.finish`, `alphaTab.core.mjs` ~7772-7786) - so a value set here would be drawn as
 * alphaTab's and lost on save. A grace takes no room either way, so skipping one changes no
 * bar's fill.
 */
export function setBeatDurations(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  duration: DurationValue,
  dots: number
): void {
  relength(doc, refs, beat => {
    if (beat.effects.grace !== 'none') return;
    beat.duration = duration;
    beat.dots = dots;
  });
}

/** Puts every beat in `refs` under `tuplet`, or out of any tuplet with null. See `relength`. */
export function setTuplet(doc: ScoreDoc, refs: readonly BeatRef[], tuplet: Tuplet | null): void {
  relength(doc, refs, beat => {
    beat.tuplet = tuplet ? { ...tuplet } : null;
  });
}

/**
 * Makes every beat in `refs` a grace of kind `grace`, or an ordinary beat again with `'none'`.
 * See `relength`.
 *
 * A length change, not an effect: a grace takes no room (`beatTicks`), so a beat that becomes
 * one frees its value's worth of the bar, which fills with rests where it stood - in front of
 * the grace, so it still leads into the beat after it - and a grace that becomes an ordinary
 * beat takes room, which takes the rests after it or is left as overflow.
 */
export function setGrace(doc: ScoreDoc, refs: readonly BeatRef[], grace: BeatEffectsDoc['grace']): void {
  relength(doc, refs, beat => {
    beat.effects.grace = grace;
  });
}

/**
 * Applies a length change to beats and settles each bar they are in, by the design's rule:
 * a beat that grows takes the rests after it, never a note, a grace, or another beat being
 * changed; whatever it cannot take is left as overflow for Fix bar; and a gap fills with rests
 * where it opened. A beat's length is `beatTicks`, so becoming or leaving a grace is a change
 * like any other. Each bar is settled against its own `barMeterAt`, read once and passed to
 * everything that settles it, so a free-time bar is left as the change made it: none of its
 * rests are taken and no gap is filled.
 *
 * Each beat is settled as it changes, at that beat. One that shrinks frees room right after it.
 * One that grows takes the rests after it, and when the last rest it took was longer than it
 * needed, the spare (`RestsTaken.overTaken`) is room freed right after it. Freed room fills with
 * rests there (`insertRestsAt`), spelled from where it starts - but only as much as the bar is
 * now short, so a beat that shrinks in an overflowing bar uses up the overflow first. So four
 * quarters set to eighths are `n8 r8 n8 r8 n8 r8 n8 r8`, and `n4 r4 r4 r4` dotted is
 * `n4. r8 r4 r4`.
 *
 * Beats are changed last to first within a bar, so settling one never moves a beat still
 * waiting its turn. A beat settled exactly keeps everything after it where it was, so the rests
 * already placed for later beats stay where their gaps opened. A bar still short once every beat
 * is settled - one that arrived short, or a gap no rest could spell at its position, such as a
 * tuplet's remainder - fills at its end (`fillBarGaps`), where that can be spelled.
 */
function relength(doc: ScoreDoc, refs: readonly BeatRef[], change: (beat: BeatDoc) => void): void {
  const changing = new Set(beatsAt(doc, refs));
  const bars = new Map<BarDoc, { barIndex: number; voiceIndex: number; beats: BeatDoc[] }>();

  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    const beat = beatAt(doc, ref);
    if (!bar || !beat) continue;
    const entry = bars.get(bar) ?? { barIndex: ref.barIndex, voiceIndex: ref.voiceIndex, beats: [] };
    entry.beats.push(beat);
    bars.set(bar, entry);
  }

  for (const [bar, { barIndex, voiceIndex, beats }] of bars) {
    const voice = bar.voices[voiceIndex];
    const meter = barMeterAt(doc, barIndex);
    for (const beat of [...beats].reverse()) {
      const before = beatTicks(beat);
      change(beat);
      const grown = beatTicks(beat) - before;
      const freed = grown > 0 ? absorbFollowingRests(voice, beat, grown, changing, meter).overTaken : -grown;
      const fill = barFillOf(bar, meter);
      if (freed > 0 && fill.kind === 'under') {
        insertRestsAt(voice, voice.beats.indexOf(beat) + 1, Math.min(freed, fill.ticks), meter);
      }
    }
    fillBarGaps(bar, meter);
  }
}
