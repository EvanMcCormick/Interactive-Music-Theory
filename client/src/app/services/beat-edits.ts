import {
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  FermataDoc,
  ScoreDoc,
  Tuplet,
  VoiceDoc,
  createRestBeat
} from '../models/composer.model';
import {
  BarMeter,
  absorbFollowingRests,
  barFillOf,
  barMeterAt,
  beatTicks,
  fillBarGaps,
  insertRestsAt,
  voiceTicks
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
 *
 * Structured values - a fermata, a trill - compare by content, whatever order their fields were
 * written in: a value read back through the mapper and one a tool built can list the same fields
 * differently (`canonicalJsonOf`).
 */
export function toggledValue<T>(current: readonly T[], on: T, off: T): T {
  const target = canonicalJsonOf(on);
  const allOn = current.length > 0 && current.every(value => canonicalJsonOf(value) === target);
  return allOn ? off : on;
}

/** `value` as JSON with every object's keys sorted, so equal values always print alike. */
function canonicalJsonOf(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner
  );
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
 * Every beat a fermata pressed on `refs` belongs to: for the tick each ref's beat starts at in its bar,
 * the voice-1 beat that starts there on every staff of every track. A fermata belongs to a bar
 * position, not to a beat.
 *
 * That is alphaTab's model and Guitar Pro's. `Voice.finish` files a beat's fermata on the master bar by
 * tick (`alphaTab.core.mjs` ~3294), and `MasterBar.getFermata` (~2728) hands it to every beat finished
 * later at that tick without one - so a fermata written on one track showed on every later track
 * anyway, and clearing it left the copies. Written on every track, the document says what the page
 * shows, whichever track the press came from.
 *
 * A grace beat names no position: it takes no ticks and starts where the beat it leads into does, so a
 * ref on one is skipped, and a grace at the tick gets nothing. A staff with no beat starting at the
 * tick - a half note spans it - gets nothing either. A generated track is left alone, as every edit
 * leaves one; alphaTab may still draw the position's fermata there, and the track's document stays the
 * progression's.
 */
export function fermataPositionsOf(doc: ScoreDoc, refs: readonly BeatRef[]): BeatDoc[] {
  const ticksByBar = new Map<number, Set<number>>();
  for (const ref of refs) {
    const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
    const beat = voice?.beats[ref.beatIndex];
    if (!voice || !beat || beat.effects.grace !== 'none') continue;
    const ticks = ticksByBar.get(ref.barIndex) ?? new Set<number>();
    ticks.add(voiceTicks({ beats: voice.beats.slice(0, ref.beatIndex) }));
    ticksByBar.set(ref.barIndex, ticks);
  }

  const beats: BeatDoc[] = [];
  for (const track of doc.tracks) {
    if (track.generated) continue;
    for (const staff of track.staves) {
      for (const [barIndex, ticks] of ticksByBar) {
        let start = 0;
        for (const beat of staff.bars[barIndex]?.voices[0]?.beats ?? []) {
          if (beat.effects.grace === 'none' && ticks.has(start)) beats.push(beat);
          start += beatTicks(beat);
        }
      }
    }
  }
  return beats;
}

/** Presses Fermata on `refs`, by the toggle rule, reading and writing every beat at those positions. */
export function toggleFermata(doc: ScoreDoc, refs: readonly BeatRef[], fermata: FermataDoc): void {
  const beats = fermataPositionsOf(doc, refs);
  const value = toggledValue(beats.map(beat => beat.effects.fermata), fermata, null);
  for (const beat of beats) beat.effects.fermata = value ? { ...value } : null;
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
 *    Room no rest can spell where it opened - a tuplet's remainder, off the 64th grid - carries to
 *    the next beat while that beat is changing too and directly follows, and is placed after the
 *    run: `n8 n8 n8 n8 n2` with its first three beats made a triplet is `n8 n8 n8 r8 n8 n2`.
 * 3. **Blocked growth takes the rests after the range.** A beat blocked only by its changing
 *    neighbour is still owed room when the bar is over - less whatever room phase 2 freed and
 *    did not place, which has paid for it already. So a bar that arrived over keeps exactly its
 *    overflow when the range's lengths change its total by nothing: `n8 n4. r4 r4 n4 n4` with
 *    its first two beats set to quarters is `n4 n4 r4 r4 n4 n4`, still 1920 over. The range's
 *    last beat takes up to what is owed of the rests after it, no more than the bar is over, and
 *    puts back right after itself what it took beyond the need. Growth a note blocks, and that
 *    no freed room paid for, stays as overflow for Fix bar, as the design asks.
 * 4. A bar still short - one that arrived short, or a gap no rest could spell at its position,
 *    such as a tuplet's remainder - fills at its end (`fillBarGaps`), where that can be spelled.
 */
function relength(doc: ScoreDoc, refs: readonly BeatRef[], change: (beat: BeatDoc) => void): void {
  const changing = new Set(beatsAt(doc, refs));
  // Grouped by voice, not bar: a range's beats are settled against the voice they are in.
  const voices = new Map<VoiceDoc, { bar: BarDoc; barIndex: number; beats: BeatDoc[] }>();

  for (const ref of refs) {
    // Voice 1 only. Bar filling measures a bar's first voice (`barFillOf`), so a later voice
    // would be changed and then settled against voice 1's fill. `editRefusal` refuses such an
    // edit before it gets here; this is the backstop for a caller that did not ask.
    if (ref.voiceIndex !== 0) continue;
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

  // Room freed but not placed, because the bar was not short when its turn came or no rest could
  // spell it. That room has already paid for growth within the range, so phase 3 must not take
  // rests for it again.
  //
  // Room no rest can spell where it opened - a tuplet's remainder is off the 64th grid - is carried
  // to the next beat when that beat is changing too and directly follows, and placed after the run:
  // three eighths made a triplet each free 160 ticks, which nothing can spell, and together free 480,
  // an eighth rest right after the group. So the beats after a whole group keep their ticks.
  let unplaced = 0;
  let carried = 0;
  inOrder.forEach((beat, order) => {
    const room = carried + (freed.get(beat) ?? 0);
    carried = 0;
    const fill = barFillOf(bar, meter);
    const wanted = room > 0 && fill.kind === 'under' ? Math.min(room, fill.ticks) : 0;
    const after = voice.beats.indexOf(beat) + 1;
    if (wanted > 0 && insertRestsAt(voice, after, wanted, meter)) {
      unplaced += room - wanted;
    } else if (wanted > 0 && voice.beats[after] === inOrder[order + 1]) {
      carried = room;
    } else {
      unplaced += room;
    }
  });

  // Blocked growth the unplaced room did not pay for. Capped by the bar's overflow below, but the
  // overflow alone is no measure of it: a bar can arrive over, and that overflow is not owed.
  const owed = Math.max(0, blocked - unplaced);
  const fill = barFillOf(bar, meter);
  const last = inOrder[inOrder.length - 1];
  if (fill.kind === 'over' && owed > 0 && last) {
    const taken = absorbFollowingRests(voice, last, Math.min(owed, fill.ticks), changing, meter);
    insertRestsAt(voice, voice.beats.indexOf(last) + 1, taken.overTaken, meter);
  }

  fillBarGaps(bar, meter);
}

/** Clears every beat in `refs` to a rest, keeping each beat's value, so no bar's fill changes. */
export function clearToRests(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  for (const beat of beatsAt(doc, refs)) {
    beat.notes = [];
    beat.isRest = true;
  }
}

/**
 * Inserts a rest of `duration` and `dots` in front of the beat `ref` names. The bar grows, and whatever
 * it holds beyond its meter is left as overflow for Fix bar: an insertion moves beats later, and taking
 * rests from the end of the bar to make room would be a second edit the user did not ask for.
 */
export function insertBeatAt(doc: ScoreDoc, ref: BeatRef, duration: DurationValue, dots: number): void {
  const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
  if (!voice) return;
  voice.beats.splice(Math.min(ref.beatIndex, voice.beats.length), 0, { ...createRestBeat(duration), dots });
}

/**
 * Removes the beats `refs` name, so the beats after them move earlier, and fills each bar left short at
 * its end (`fillBarGaps`) - unlike a clear, which keeps every later beat where it was. A voice left
 * with no beats at all, in a free-time bar that nothing fills, gets a quarter rest, since alphaTab
 * cannot chain a voice with none.
 */
export function deleteBeats(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  const removing = new Set(beatsAt(doc, refs));
  const bars = new Map<BarDoc, number>();
  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    if (bar) bars.set(bar, ref.barIndex);
  }
  for (const [bar, barIndex] of bars) {
    for (const voice of bar.voices) voice.beats = voice.beats.filter(beat => !removing.has(beat));
    fillBarGaps(bar, barMeterAt(doc, barIndex));
    for (const voice of bar.voices) if (voice.beats.length === 0) voice.beats.push(createRestBeat(4));
  }
}
