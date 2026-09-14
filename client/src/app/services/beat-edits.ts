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
  createDefaultBeatEffects,
  createRestBeat
} from '../models/composer.model';
import {
  BarMeter,
  absorbFollowingRests,
  barFillOf,
  barMeterAt,
  beatTicks,
  fillBarGaps,
  graceRunStart,
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
export function canonicalJsonOf(value: unknown): string {
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
 * ref on one is skipped, and a selection of graces alone has no position (`fermataRefusal`). But a grace
 * *at* a position is one of its beats. alphaTab plays it at that tick when the fermata is filed, so it
 * takes the fermata on the way in, on-beat or before the beat - and a clear that skipped it would leave
 * that copy to spread back to every track on the next save. So graces at the tick are returned with the
 * beats they lead into, and written and cleared with them; the toggle reads only the non-grace beats
 * (`toggleFermata`). A staff with no beat starting at the tick - a half note spans it - gets nothing. A
 * generated track is left alone, as every edit leaves one; alphaTab may still draw the position's
 * fermata there, and the track's document stays the progression's.
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
          // A grace adds no ticks, so it is at the same start as the beat it leads into.
          if (ticks.has(start)) beats.push(beat);
          start += beatTicks(beat);
        }
      }
    }
  }
  return beats;
}

/**
 * Presses Fermata on `refs`, by the toggle rule. The rule reads the non-grace beats at those positions;
 * the value is written to every beat there, graces included (`fermataPositionsOf`).
 */
export function toggleFermata(doc: ScoreDoc, refs: readonly BeatRef[], fermata: FermataDoc): void {
  const beats = fermataPositionsOf(doc, refs);
  const read = beats.filter(beat => beat.effects.grace === 'none');
  const value = toggledValue(read.map(beat => beat.effects.fermata), fermata, null);
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

/**
 * Gives every beat in `refs` `dots` augmentation dots at its own written value, then keeps each bar
 * honest. See `relength`. What the dot tool does, so dotting a half makes a dotted half whatever note
 * value the palette holds. Grace beats keep theirs, as `setBeatDurations` leaves them.
 */
export function setBeatDots(doc: ScoreDoc, refs: readonly BeatRef[], dots: number): void {
  relength(doc, refs, beat => {
    if (beat.effects.grace !== 'none') return;
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
 *
 * A beat that becomes a grace leaves its fermata at its bar position (the design's M2 decision 2): the
 * rest that fills its room, or the beat that moves up to its tick in a bar that was over, takes it, and the
 * grace takes the fermata at the position it now leads into (`settleFermatas`, which `relength` runs). A
 * grace that becomes an ordinary beat takes its tick's fermata the same way.
 */
export function setGrace(doc: ScoreDoc, refs: readonly BeatRef[], grace: BeatEffectsDoc['grace']): void {
  relength(doc, refs, beat => {
    beat.effects.grace = grace;
  });
}

/**
 * The fermata the grace `ref` names holds by the per-position rule: the one standing on the ordinary beats
 * at the position of the beat it leads into, on any track (`fermataPositionsOf`) - or none, when it leads
 * into nothing or nothing there has one. A grace has no position of its own; alphaTab finishes it at the
 * tick of the beat it leads into and files its fermata there, so any other value spreads on save.
 */
export function graceFermataOf(doc: ScoreDoc, ref: BeatRef): FermataDoc | null {
  const beats = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
  let into = ref.beatIndex + 1;
  while (into < beats.length && beats[into].effects.grace !== 'none') into++;
  if (into >= beats.length) return null;
  const standing = fermataPositionsOf(doc, [{ ...ref, beatIndex: into }]).find(
    beat => beat.effects.grace === 'none' && beat.effects.fermata !== null
  );
  return standing?.effects.fermata ? { ...standing.effects.fermata } : null;
}

/**
 * Each bar position's fermata before an edit, for the bars it may move beats in: by bar index, the fermata at
 * every tick where a beat starts on some staff, or null where none there has one. See `settleFermatas`.
 */
export type FermataSnapshot = ReadonlyMap<number, ReadonlyMap<number, FermataDoc | null>>;

/**
 * The fermata at every bar position of the bars `barIndices`, read as `fermataPositionsOf` reads a position:
 * voice 1 of every staff of every track but a generated one, graces aside. Where tracks disagree - only a loaded
 * file can leave them so - the first fermata found stands for the position.
 */
export function fermataSnapshotOf(doc: ScoreDoc, barIndices: Iterable<number>): FermataSnapshot {
  const snapshot = new Map<number, Map<number, FermataDoc | null>>();
  for (const barIndex of barIndices) {
    if (snapshot.has(barIndex)) continue;
    const positions = new Map<number, FermataDoc | null>();
    for (const { beats } of positionVoicesOf(doc, barIndex)) {
      forEachStart(beats, (beat, start) => {
        if (beat.effects.grace === 'none' && !positions.get(start)) {
          positions.set(start, beat.effects.fermata ? { ...beat.effects.fermata } : null);
        }
      });
    }
    snapshot.set(barIndex, positions);
  }
  return snapshot;
}

/**
 * Puts every fermata in the bars of `before` back at its bar position, on every track, after an edit that moved
 * beat starts: a length change, an insert, a delete, a paste, Fix bar.
 *
 * alphaTab finishes tracks in order and files a beat's fermata on the master bar at the tick the beat starts at,
 * handing it to every beat finished later at that tick without one (`Voice.finish`, `alphaTab.core.mjs` ~3294;
 * `MasterBar.addFermata` ~2705; `MasterBar.getFermata` ~2728). So a fermata beat an edit moves takes its fermata
 * to its new tick, and on save every later track's beat there takes it too, while the tracks it left keep theirs.
 * A fermata belongs to a bar position instead (the design's M2 decision 2):
 *
 * 1. Every ordinary beat now starting at a position `before` holds, on any staff, takes that position's fermata -
 *    the beat an edit moved onto it included. So a beat that moved away from a fermata gives it up, and one that
 *    moved to a tick that held none, or that was no position before, takes none.
 * 2. `pasted` beats, graces aside, bring their own fermata, which wins at the tick they land on (`pasteBeats`).
 * 3. A position no beat starts at any longer, on any staff, loses its fermata. alphaTab keeps a fermata only by
 *    filing a beat's, at that beat's own tick, so nothing can hold one at a tick no beat starts at: kept on the
 *    beat that moved, it would be filed at the beat's new tick, and reach every track there on save.
 * 4. Every grace takes the fermata at the position of the beat it leads into (`graceFermataOf`).
 */
export function settleFermatas(
  doc: ScoreDoc,
  before: FermataSnapshot,
  pasted: ReadonlyMap<BeatDoc, FermataDoc> = new Map()
): void {
  for (const [barIndex, positions] of before) {
    const voices = positionVoicesOf(doc, barIndex);
    const settled = new Map(positions);
    for (const { beats } of voices) {
      forEachStart(beats, (beat, start) => {
        const own = pasted.get(beat);
        if (own && beat.effects.grace === 'none') settled.set(start, own);
      });
    }
    for (const { beats } of voices) {
      forEachStart(beats, (beat, start) => {
        if (beat.effects.grace === 'none') setFermata(beat, settled.get(start) ?? null);
      });
    }
    for (const { trackIndex, staffIndex, beats } of voices) {
      beats.forEach((beat, beatIndex) => {
        if (beat.effects.grace === 'none') return;
        setFermata(beat, graceFermataOf(doc, { trackIndex, staffIndex, barIndex, voiceIndex: 0, beatIndex }));
      });
    }
  }
}

/** Voice 1 of bar `barIndex` on every staff of every track but a generated one: where a fermata position is read. */
function positionVoicesOf(doc: ScoreDoc, barIndex: number): { trackIndex: number; staffIndex: number; beats: BeatDoc[] }[] {
  const voices: { trackIndex: number; staffIndex: number; beats: BeatDoc[] }[] = [];
  doc.tracks.forEach((track, trackIndex) => {
    if (track.generated) return;
    track.staves.forEach((staff, staffIndex) => {
      const beats = staff.bars[barIndex]?.voices[0]?.beats;
      if (beats) voices.push({ trackIndex, staffIndex, beats });
    });
  });
  return voices;
}

/** Calls `visit` with each of `beats` and the tick it starts at in its bar. A grace starts where the beat it leads into does. */
function forEachStart(beats: readonly BeatDoc[], visit: (beat: BeatDoc, start: number) => void): void {
  let start = 0;
  for (const beat of beats) {
    visit(beat, start);
    start += beatTicks(beat);
  }
}

/**
 * Gives `beat` `fermata`, when it holds another. A new effects object, since a spread-copied beat can share its
 * effects with another.
 */
function setFermata(beat: BeatDoc, fermata: FermataDoc | null): void {
  if (canonicalJsonOf(beat.effects.fermata) === canonicalJsonOf(fermata)) return;
  beat.effects = { ...beat.effects, fermata: fermata ? { ...fermata } : null };
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
 *    run: `n8 n8 n8 n8 n2` with its first three beats made a triplet is `n8 n8 n8 r8 n8 n2`. Inside a
 *    tuplet group alphaTab has not closed, room is held however it spells, and goes after the beat
 *    where alphaTab closes the group, whether or not that beat is changing, so a rest never ends a
 *    group half-way: six sixteenths made 6:4 free a sixteenth after three beats, and an eighth rest
 *    goes after the sixth (`tupletGroupEndOf`).
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
 * 5. Every fermata in the bars goes back to its bar position, on every track (`settleFermatas`).
 */
function relength(doc: ScoreDoc, refs: readonly BeatRef[], change: (beat: BeatDoc) => void): void {
  const fermatas = fermataSnapshotOf(doc, refs.filter(ref => ref.voiceIndex === 0).map(ref => ref.barIndex));
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
  settleFermatas(doc, fermatas);
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
  //
  // Inside a tuplet group that alphaTab has not closed yet, room is held without trying to place it,
  // however it spells: a 6:4 beat frees a third of its value, so three of them free a whole value, and
  // a rest there would end alphaTab's group half-way (`TupletGroup.check`, ~6760). It carries to the next
  // beat of the run while that beat is in the same group, and otherwise goes after the beat that closes
  // the group (`tupletGroupEndOf`) - which need not be changing: beats already 6:4 after the run close
  // the group the run's beats join. So the room goes after each group, when the run holds several.
  let unplaced = 0;
  let carried = 0;
  inOrder.forEach((beat, order) => {
    const room = carried + (freed.get(beat) ?? 0);
    carried = 0;
    const next = inOrder[order + 1];
    const index = voice.beats.indexOf(beat);
    const end = tupletGroupEndOf(voice.beats, index);
    if (end > index && next && voice.beats.indexOf(next) <= end) {
      carried = room;
      return;
    }
    const after = end + 1;
    const fill = barFillOf(bar, meter);
    const wanted = room > 0 && fill.kind === 'under' ? Math.min(room, fill.ticks) : 0;
    if (wanted > 0 && insertRestsAt(voice, after, wanted, meter)) {
      unplaced += room - wanted;
    } else if (wanted > 0 && voice.beats[after] === next) {
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

/** alphaTab's `TupletGroup._allTicks`: the written values a mixed-length group's total is checked against. */
const TUPLET_GROUP_TICKS: readonly number[] = [1920, 960, 480, 240, 120, 60, 30, 15];

/** Whether `beat` is under a tuplet as alphaTab reads one (`Beat.hasTuplet`, ~7370): 1:1 is none. */
function hasTuplet(beat: BeatDoc): boolean {
  return beat.tuplet !== null && !(beat.tuplet.numerator === 1 && beat.tuplet.denominator === 1);
}

/** A tuplet group as alphaTab builds one while it finishes a voice (`TupletGroup`, ~6700). */
export interface TupletGroupRun {
  first: BeatDoc;
  /** The beats counted, graces not among them. */
  count: number;
  ticks: number;
  equal: boolean;
  /** Whether alphaTab has closed the group, so it takes no more beats but graces. */
  full: boolean;
}

/**
 * For each of `beats` - one voice of one bar, in order - the tuplet group alphaTab puts it in, or null. Beats
 * in one group share one `TupletGroupRun`, and its `full` says whether the group was closed by its end.
 *
 * alphaTab groups a voice's beats as it finishes them (`Beat.finishTuplet`, ~7741, and
 * `TupletGroup.check`, ~6742): a beat joins the group before it when it has the same tuplet and that
 * group is not full; a grace joins the group before it, full or not, without counting; anything else
 * starts a new group or none. A group of equal values is full at as many beats as the tuplet's numerator;
 * a mixed one when its total is a written value times the numerator over the denominator, truncated.
 * Groups never cross a bar, since `check` refuses a beat from another voice. Lengths are `beatTicks`,
 * alphaTab's `displayDuration` - which is what `check` adds for every beat but a group's first, where it
 * adds `playbackDuration`; the two differ only on a beat a grace steals from, and a grace-led group is
 * left to that small difference.
 */
export function tupletGroupsOf(beats: readonly BeatDoc[]): (TupletGroupRun | null)[] {
  const groups: (TupletGroupRun | null)[] = [];
  let group: TupletGroupRun | null = null;
  for (const beat of beats) {
    if (beat.effects.grace !== 'none' && group) {
      groups.push(group);
      continue;
    }
    if (!hasTuplet(beat)) {
      group = null;
      groups.push(null);
      continue;
    }
    if (!group || group.full || !sameTuplet(beat, group.first)) {
      group = { first: beat, count: 1, ticks: beatTicks(beat), equal: true, full: false };
    } else {
      const open: TupletGroupRun = group;
      open.count++;
      open.ticks += beatTicks(beat);
      if (beatTicks(beat) !== beatTicks(open.first)) open.equal = false;
      const tuplet = open.first.tuplet ?? { numerator: 1, denominator: 1 };
      const factor = (tuplet.numerator / tuplet.denominator) | 0;
      open.full = open.equal ? open.count === tuplet.numerator : TUPLET_GROUP_TICKS.some(ticks => open.ticks === ticks * factor);
    }
    groups.push(group);
  }
  return groups;
}

/** Whether two beats are under the same tuplet, by alphaTab's comparison of numerator and denominator. */
function sameTuplet(a: BeatDoc, b: BeatDoc): boolean {
  return a.tuplet?.numerator === b.tuplet?.numerator && a.tuplet?.denominator === b.tuplet?.denominator;
}

/**
 * The index of the last of `beats` in the tuplet group `beats[index]` is in - where alphaTab closes it, or
 * where the bar ends it unclosed - or `index` itself when it is in none (`tupletGroupsOf`).
 */
export function tupletGroupEndOf(beats: readonly BeatDoc[], index: number): number {
  const groups = tupletGroupsOf(beats);
  const group = groups[index];
  let end = index;
  while (group && groups[end + 1] === group) end++;
  return end;
}

/**
 * Whether putting the beats `refs` name under `tuplet` leaves every tuplet group they are in closed, as
 * alphaTab closes one (`tupletGroupsOf`). A group left open - four eighths made 6:4 - is drawn as a broken
 * group, and the room its beats free is off the 64th grid, so the bar would be left short with nothing to
 * say why. Beats already under `tuplet` next to the run count: three 6:4 eighths complete three more.
 */
export function tupletGroupsCompleteWith(doc: ScoreDoc, refs: readonly BeatRef[], tuplet: Tuplet): boolean {
  const changing = new Set(beatsAt(doc, refs));
  const voices = new Set<VoiceDoc>();
  for (const ref of refs) {
    const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
    if (voice) voices.add(voice);
  }
  for (const voice of voices) {
    const changed = voice.beats.map(beat => (changing.has(beat) ? { ...beat, tuplet } : beat));
    const groups = tupletGroupsOf(changed);
    if (voice.beats.some((beat, index) => changing.has(beat) && groups[index] !== null && !groups[index]?.full)) return false;
  }
  return true;
}

/**
 * Clears every beat in `refs` to a rest, keeping each beat's value, so no bar's fill changes.
 *
 * What a rest cannot do goes with its notes: every beat effect returns to its default - let ring, palm
 * mute, tap, slap, pop, a pick stroke, fade in, vibrato, a brush, a crescendo - since on a rest each is
 * an attack with nothing to attack, and a cut would carry it to wherever it is pasted. Two stay: the
 * dynamic, which stands until the next one, and the fermata, which belongs to the bar position rather
 * than to the notes (the design's M2 decision 2).
 *
 * A grace beat is removed rather than left as a grace rest. It takes no room, so the bar's fill is
 * unchanged, and a rest that leads into the beat after it is nothing a score writes.
 */
export function clearToRests(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  const graces = new Set<BeatDoc>();
  for (const beat of beatsAt(doc, refs)) {
    if (beat.effects.grace !== 'none') {
      graces.add(beat);
      continue;
    }
    beat.notes = [];
    beat.isRest = true;
    beat.effects = { ...createDefaultBeatEffects(), fermata: beat.effects.fermata };
  }
  if (graces.size === 0) return;
  for (const ref of refs) {
    const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
    if (voice) voice.beats = voice.beats.filter(beat => !graces.has(beat));
  }
}

/**
 * Inserts a rest of `duration` and `dots` in front of the beat `ref` names - in front of any graces that
 * lead into it (`graceRunStart`), so they still lead into their beat. The bar grows, and whatever it
 * holds beyond its meter is left as overflow for Fix bar: an insertion moves beats later, and taking
 * rests from the end of the bar to make room would be a second edit the user did not ask for.
 *
 * Returns the index the rest went in at, or null when `ref` names no voice. Every fermata in the bar stays at its
 * bar position (`settleFermatas`).
 */
export function insertBeatAt(doc: ScoreDoc, ref: BeatRef, duration: DurationValue, dots: number): number | null {
  const voice = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex]?.voices[ref.voiceIndex];
  if (!voice) return null;
  const fermatas = fermataSnapshotOf(doc, [ref.barIndex]);
  const at = graceRunStart(voice, Math.min(ref.beatIndex, voice.beats.length));
  voice.beats.splice(at, 0, { ...createRestBeat(duration), dots });
  settleFermatas(doc, fermatas);
  return at;
}

/**
 * Removes the beats `refs` name, so the beats after them move earlier, and fills each bar left short at
 * its end (`fillBarGaps`) - unlike a clear, which keeps every later beat where it was. A voice left
 * with no beats at all, in a free-time bar that nothing fills, gets a quarter rest, since alphaTab
 * cannot chain a voice with none. Every fermata in those bars stays at its bar position (`settleFermatas`).
 */
export function deleteBeats(doc: ScoreDoc, refs: readonly BeatRef[]): void {
  const removing = new Set(beatsAt(doc, refs));
  const bars = new Map<BarDoc, number>();
  for (const ref of refs) {
    const bar = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars[ref.barIndex];
    if (bar) bars.set(bar, ref.barIndex);
  }
  const fermatas = fermataSnapshotOf(doc, bars.values());
  for (const [bar, barIndex] of bars) {
    for (const voice of bar.voices) voice.beats = voice.beats.filter(beat => !removing.has(beat));
    fillBarGaps(bar, barMeterAt(doc, barIndex));
    for (const voice of bar.voices) if (voice.beats.length === 0) voice.beats.push(createRestBeat(4));
  }
  settleFermatas(doc, fermatas);
}
