import {
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  ScoreDoc,
  Tuplet,
  VoiceDoc
} from '../models/composer.model';
import {
  BarMeter,
  absorbFollowingRests,
  barFillOf,
  barMeterAt,
  beatTicks,
  fillBarGaps,
  insertRestsAt
} from './bar-fill';
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
 * A range is settled in two passes, so that it never reports overflow its new lengths do not
 * have. Settled one beat at a time, a beat that shrank would spend its room on rests at once,
 * while an earlier beat that grew could not take its changing neighbour: `n4 n8 n8 n2` set to
 * quarters would read as over, holding rests, when four quarters fill the bar exactly.
 *
 * 1. **Last to first, every beat changes.** One that grows takes the rests after it
 *    (`absorbFollowingRests`), never a beat still changing. What it could not take is its
 *    blocked growth; when the last rest it took was longer than it needed, the spare
 *    (`RestsTaken.overTaken`) is room freed right after it. One that shrinks frees its
 *    difference right after it. No rest goes in yet. Last to first, so taking rests never moves
 *    a beat still waiting its turn.
 * 2. **First to last, freed room fills with rests** right after the beat that freed it
 *    (`insertRestsAt`), spelled from where it starts - but only while the bar is short, and only
 *    as much as it is short. So room a shrinking beat frees pays for growth elsewhere in the
 *    range first, and a beat that shrinks in an overflowing bar uses up the overflow. Four
 *    quarters set to eighths are `n8 r8 n8 r8 n8 r8 n8 r8`; `n4 r4 r4 r4` dotted is `n4. r8 r4 r4`.
 * 3. **Blocked growth takes the rests after the range.** A beat blocked only by its changing
 *    neighbour is still owed room when the bar is over. The range's last beat takes up to that
 *    much of the rests after it, and puts back right after itself what it took beyond the need.
 *    Growth a note blocks stays as overflow for Fix bar, as the design asks.
 * 4. A bar still short - one that arrived short, or a gap no rest could spell at its position,
 *    such as a tuplet's remainder - fills at its end (`fillBarGaps`), where that can be spelled.
 */
function relength(doc: ScoreDoc, refs: readonly BeatRef[], change: (beat: BeatDoc) => void): void {
  const changing = new Set(beatsAt(doc, refs));
  // Grouped by voice, not bar: a range's beats are settled against the voice they are in. Bar
  // filling measures voice 1 (`barFillOf`), and `editRefusal` refuses an edit on any other, so
  // today each voice here is a bar's first.
  const voices = new Map<VoiceDoc, { bar: BarDoc; barIndex: number; beats: BeatDoc[] }>();

  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    const voice = bar?.voices[ref.voiceIndex];
    const beat = beatAt(doc, ref);
    if (!bar || !voice || !beat) continue;
    const entry = voices.get(voice) ?? { bar, barIndex: ref.barIndex, beats: [] };
    entry.beats.push(beat);
    voices.set(voice, entry);
  }

  for (const [voice, { bar, barIndex, beats }] of voices) {
    settleRange(voice, bar, barMeterAt(doc, barIndex), beats, changing, change);
  }
}

/** `relength`'s passes for one voice. `beats` are the changing beats in it, in any order. */
function settleRange(
  voice: VoiceDoc,
  bar: BarDoc,
  meter: BarMeter,
  beats: readonly BeatDoc[],
  changing: ReadonlySet<BeatDoc>,
  change: (beat: BeatDoc) => void
): void {
  // Beats are removed and inserted around them, never reordered, so this order holds throughout.
  const inOrder = [...beats].sort((a, b) => voice.beats.indexOf(a) - voice.beats.indexOf(b));
  const freed = new Map<BeatDoc, number>();
  let blocked = 0;

  for (const beat of [...inOrder].reverse()) {
    const before = beatTicks(beat);
    change(beat);
    const grown = beatTicks(beat) - before;
    if (grown > 0) {
      const taken = absorbFollowingRests(voice, beat, grown, changing, meter);
      blocked += taken.uncovered;
      freed.set(beat, taken.overTaken);
    } else {
      freed.set(beat, -grown);
    }
  }

  for (const beat of inOrder) {
    const room = freed.get(beat) ?? 0;
    const fill = barFillOf(bar, meter);
    if (room > 0 && fill.kind === 'under') {
      insertRestsAt(voice, voice.beats.indexOf(beat) + 1, Math.min(room, fill.ticks), meter);
    }
  }

  const fill = barFillOf(bar, meter);
  const last = inOrder[inOrder.length - 1];
  if (fill.kind === 'over' && blocked > 0 && last) {
    const taken = absorbFollowingRests(voice, last, Math.min(blocked, fill.ticks), changing, meter);
    insertRestsAt(voice, voice.beats.indexOf(last) + 1, taken.overTaken, meter);
  }

  fillBarGaps(bar, meter);
}
