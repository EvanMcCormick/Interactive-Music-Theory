import {
  BarDoc,
  BeatDoc,
  BeatEffectsDoc,
  NoteDoc,
  NoteEffectsDoc,
  ScoreDoc,
  TimeSignature,
  VoiceDoc,
  createDefaultBeatEffects,
  createDefaultNoteEffects,
  createRestBeat,
  effectiveTimeSignature
} from '../models/composer.model';
import { insertBarInto } from './score-structure';
import { DurationUnit, barGridFault, metricFrame, slotsToDurations } from './transcription-quantize';

/** Fix bar's refusal when no selected bar is over: said by the command and by its palette button's state. */
export const NO_BAR_OVER = 'No selected bar is over its time signature.';

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

/**
 * The playback length of each grace in a run of `size`: alphaTab writes a lone grace as an eighth, two as sixteenths
 * and more as 32nds (`Beat.finish`, `alphaTab.core.mjs` ~7772), and plays them as a 32nd, a 64th and a 128th
 * (`Beat.updateDurations` ~7713).
 */
export function gracePlaybackTicks(size: number): number {
  return size === 1 ? 120 : size === 2 ? 60 : 30;
}

/**
 * For each of `beats` - one voice of one bar, in order - the tick alphaTab plays it at, which is where it files the
 * beat's fermata and where it looks for one to hand the beat (`Voice.finish` ~3226-3294, `MasterBar.getFermata`
 * ~2728). Not where it is drawn (`beatTicks`): the two differ around graces.
 *
 * - A grace plays one after another from the tick of the beat it leads into, each for its playback length
 *   (`gracePlaybackTicks`), and its fermata is filed while it is finished, at that tick.
 * - A beat that on-beat graces lead into plays after them: they take their playback lengths from its start
 *   (`GraceType.OnBeat`, ~3262). A run's first grace decides what kind it is.
 * - A beat that before-beat graces lead into plays at its own tick; they take their lengths from the beat before.
 * - Every other beat plays at its own tick.
 */
export function playbackStartsOf(beats: readonly Pick<BeatDoc, 'duration' | 'dots' | 'tuplet' | 'effects'>[]): number[] {
  const starts: number[] = [];
  let tick = 0;
  let index = 0;
  while (index < beats.length) {
    let end = index;
    while (end < beats.length && beats[end].effects.grace !== 'none') end++;
    const size = end - index;
    const each = gracePlaybackTicks(size);
    for (let grace = 0; grace < size; grace++) starts.push(tick + grace * each);
    if (end === beats.length) break;
    starts.push(size > 0 && beats[index].effects.grace === 'onBeat' ? tick + size * each : tick);
    tick += beatTicks(beats[end]);
    index = end + 1;
  }
  return starts;
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
export function graceRunStart(voice: VoiceDoc, index: number): number {
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
 * For a gap that has no position of its own to go to: a bar that arrived short, or one whose
 * meter changed, which opens its gap at the end of the bar. A gap a length change opens has a
 * position, and goes there instead - see `insertRestsAt`, which this calls at the end of the
 * voice. So the rests go in front of any grace beats that end the bar, which stay last, in the
 * order they were written. Nothing happens when the bar is full or over - a free-time bar
 * always is (`barFillOf`) - or when `insertRestsAt` cannot spell the gap exactly, because a
 * fill that is only nearly right is worse than a bar still honestly reported as under.
 */
export function fillBarGaps(bar: BarDoc, meter: BarMeter): void {
  const fill = barFillOf(bar, meter);
  const voice = bar.voices[0];
  if (fill.kind !== 'under' || !voice) return;
  insertRestsAt(voice, voice.beats.length, fill.ticks, meter);
}

/**
 * Inserts `ticks` of rests into `voice` at beat `index`, spelled from the tick they start at,
 * and says whether it could. `voice` is in a bar measured against `meter`.
 *
 * This is where a gap goes when the caller knows where it opened: right after a beat that
 * shrank (`index` one past it), right after the rests a growing beat took more of than it
 * needed, right after the beats Fix bar carried into a bar. Rests placed there keep every later
 * beat where it was in the bar, so an empty bar whose first quarter becomes an eighth reads
 * `r8 r8 r4 r4 r4`, and its quarter slots survive.
 *
 * Rests never go between a grace and the beat it leads into: the insertion moves back in front
 * of any grace run that ends at `index` (`graceRunStart`). A grace takes no room, so that is
 * the same tick. The rule for the cases that meet a grace:
 * - After a beat a grace run precedes: the rests go right after that beat. Its graces are in
 *   front of it, not at `index`, so they stay with it.
 * - After a beat followed by graces: `index` is in front of those graces, so they stay in front
 *   of the beat they lead into.
 * - After a beat that has itself become a grace: the rests go in front of it and any graces
 *   before it, and it goes on leading into the beat after it.
 * - At the end of a bar that graces end: in front of them, so they stay last.
 *
 * Rests are spelled at a 64th grid, split at beat and half-bar lines by the quantizer's own
 * speller, starting from the ticks of every beat before the insertion point. It inserts nothing
 * and returns false in a free-time bar, which the meter does not govern, when the meter has no
 * 64th grid, and when the gap or its start is not a whole number of 64ths - a tuplet's
 * remainder. A gap of 0 needs nothing and returns true.
 */
export function insertRestsAt(voice: VoiceDoc, index: number, ticks: number, meter: BarMeter): boolean {
  if (ticks === 0) return true;
  if (meter.isFreeTime || !(ticks > 0)) return false;

  const at = graceRunStart(voice, Math.max(0, Math.min(index, voice.beats.length)));
  const start = voiceTicks({ beats: voice.beats.slice(0, at) });
  const units = spelledTicks(ticks, start, meter.timeSignature);
  if (!units) return false;

  voice.beats.splice(at, 0, ...units.map(unit => ({ ...createRestBeat(unit.duration), dots: unit.dots })));
  return true;
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

/** What `absorbFollowingRests` could not cover, and what it took beyond what was asked. */
export interface RestsTaken {
  /** Ticks still wanted: the growth left as overflow. */
  uncovered: number;
  /** Ticks taken past what was wanted, because the last rest taken was longer than the need. */
  overTaken: number;
}

/**
 * Removes rests after `beat` in `voice` until `ticks` are covered, and reports what it could not
 * cover and what it took beyond that. `voice` is in a bar measured against `meter`.
 *
 * It stops at the first note - the design's line: lengthening consumes only following
 * rests, and anything that would overwrite a note is left as overflow for the user to
 * see. It stops at a grace beat too, rest or not, or a rest a grace leads into, and never
 * removes either (`isTakeableRest`). And it stops at any beat in `changing`, so a range
 * pressed together is changed together rather than one beat eating its neighbours. A rest
 * longer than what is left is taken whole, and the difference comes back as `overTaken`: the
 * caller puts it back right after `beat` (`insertRestsAt`), where the room it did not need now
 * opens - so `n4 r4 r4 r4` with its note dotted reads `n4. r8 r4 r4`, as Guitar Pro writes it.
 * Beats are held by identity, not index, because every removal shifts the indices after it.
 *
 * In a free-time bar it removes nothing and reports all of `ticks` uncovered: the meter does
 * not govern that bar, so there is no room to make, and a lengthened beat simply makes the
 * bar longer. `meter` is required, like every per-bar function here, so no caller can forget
 * to ask. The walk's index never moves: each removal brings the next beat to it.
 */
export function absorbFollowingRests(
  voice: VoiceDoc,
  beat: BeatDoc,
  ticks: number,
  changing: ReadonlySet<BeatDoc>,
  meter: BarMeter
): RestsTaken {
  if (meter.isFreeTime) return { uncovered: ticks, overTaken: 0 };
  let remaining = ticks;
  const index = voice.beats.indexOf(beat) + 1;
  if (index === 0) return { uncovered: remaining, overTaken: 0 };

  // Every pass removes a beat or stops, so the walk ends however little a beat is worth.
  while (remaining > 0 && index < voice.beats.length) {
    const next = voice.beats[index];
    if (!isTakeableRest(voice, index) || changing.has(next)) break;
    remaining -= beatTicks(next);
    voice.beats.splice(index, 1);
  }
  return { uncovered: Math.max(0, remaining), overTaken: Math.max(0, -remaining) };
}

/** What Fix bar did: how many bars it had to add, or why it did nothing. */
export type FixBarResult =
  | { kind: 'fixed'; appendedBars: number }
  | { kind: 'refused'; reason: string };

const TUPLET_ACROSS_LINE =
  'A tuplet crosses the bar line, so no written value can split it. Shorten it until the bar fits.';

const OFF_GRID_AT_LINE =
  'A beat before the bar line, or the one across it, is off the 64th-note grid, so the beat across ' +
  'the line cannot be split exactly. Change the tuplet, 128th or dotted 64th that puts it off the grid first.';

// The next two can only come from a loaded file: `timeSignatureFault` refuses every meter that
// would cause them before the composer can set one.
const NO_GRID_AT_LINE =
  'A time signature at the bar line has no 64th-note grid, which only a loaded file can have, so ' +
  'the beat across the line cannot be split exactly. Change the time signature first.';

const NO_ROOM =
  'That time signature leaves no room in a bar, which only a loaded file can have, so there is ' +
  'nowhere to carry the overflow. Change the time signature first.';

/**
 * Carries the overflow of bar `barIndex` on one staff into the bars after it, tied, until
 * a bar it reaches is no longer over. See the section comment above Task B6 in the M1 plan
 * for what a continuation carries, and `CARRIED_OVER_A_TIE`.
 *
 * Every bar is read against its own `barMeterAt`, so a free-time bar is never over: Fix bar
 * refuses one, and a carry that reaches one stops there, taking none of its rests. Room in a
 * bar carried into is made by taking its trailing rests; if that takes more than was needed,
 * the spare room goes back right after the carried beats (`insertRestsAt`), where it opened.
 *
 * It refuses, and says why, when the beat across a line cannot be split exactly - a tuplet, a
 * start or end between 64th notes, a meter with no 64th grid - and when a bar it must carry out
 * of has no room at all, which would otherwise append bars forever.
 *
 * **May leave `doc` partly changed when it refuses.** Call it on a draft you can discard.
 *
 * **Replaces beats, so callers must not hold `BeatDoc` references across it.** The beat across
 * the line is replaced by new beats for its head and tail, carried beats move bars, and rests
 * are removed and inserted. Address beats again by position afterwards.
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
  /** How many beats at the start of the bar in hand were carried into it. */
  let carriedIn = 0;
  for (let index = barIndex; index < staff.bars.length; index++) {
    const meter = barMeterAt(doc, index);
    const bar = staff.bars[index];

    const fill = barFillOf(bar, meter);
    if (fill.kind !== 'over') {
      if (index === barIndex) {
        return { kind: 'refused', reason: 'That bar is not over its time signature.' };
      }
      if (fill.kind === 'under') insertRestsAt(bar.voices[0], carriedIn, fill.ticks, meter);
      return { kind: 'fixed', appendedBars };
    }

    // A bar of no ticks puts every beat past its line, and each bar appended after it inherits
    // the meter, so the carry would never end. Checked on every bar, not only the first, since
    // a carry can reach such a meter.
    if (barCapacityTicks(meter.timeSignature) <= 0) return { kind: 'refused', reason: NO_ROOM };

    const cut = beatsPastBarLine(
      bar.voices[0],
      meter.timeSignature,
      barMeterAt(doc, index + 1).timeSignature
    );
    if (cut.kind === 'refused') return cut;

    if (index === staff.bars.length - 1) {
      insertBarInto(doc, staff.bars.length);
      appendedBars++;
    }

    const next = staff.bars[index + 1];
    next.voices[0].beats.unshift(...cut.carried);
    carriedIn = cut.carried.length;
    takeTrailingRests(next, barMeterAt(doc, index + 1));
  }
  return { kind: 'fixed', appendedBars };
}

/** What cutting a voice at its bar line gave: the beats past the line, or why it could not. */
type LineCut = { kind: 'cut'; carried: BeatDoc[] } | { kind: 'refused'; reason: string };

/**
 * Whether alphaTab reads `beat` as under a tuplet: `Beat.hasTuplet` (`alphaTab.core.mjs` ~7370), any
 * ratio but -1:-1, its default, and 1:1. The mapper writes a model tuplet's ratio as it is. What draws a
 * bracket, and what `Beat.finishTuplet` groups (`tupletGroupsOf`).
 */
export function hasTuplet(beat: Pick<BeatDoc, 'tuplet'>): boolean {
  const tuplet = beat.tuplet;
  return (
    tuplet !== null &&
    !(tuplet.numerator === -1 && tuplet.denominator === -1) &&
    !(tuplet.numerator === 1 && tuplet.denominator === 1)
  );
}

/**
 * Cuts `voice` at its bar line and returns what lay past it: the tied tail of the beat that
 * crossed the line, then every later beat whole. Refuses, leaving `voice` untouched, when the
 * crossing beat cannot be split into written values - saying which reason applies.
 *
 * A tuplet is refused first, even when both sides of the split are whole 64ths: its pieces would
 * be written values, and the bracket would be gone. Then a meter on either side with no 64th
 * grid, and then a split that falls between 64ths.
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
): LineCut {
  const capacity = barCapacityTicks(timeSignature);
  let start = 0;

  for (let index = 0; index < voice.beats.length; index++) {
    const beat = voice.beats[index];
    const end = start + beatTicks(beat);
    if (end <= capacity) {
      start = end;
      continue;
    }

    if (start >= capacity) return { kind: 'cut', carried: voice.beats.splice(graceRunStart(voice, index)) };

    const split = splitAtBarLine(beat, start, timeSignature, nextTimeSignature);
    if (split.kind === 'refused') return split;

    const after = voice.beats.splice(index + 1);
    voice.beats.splice(index, 1, ...split.head);
    return { kind: 'cut', carried: [...split.tail, ...after] };
  }
  return { kind: 'cut', carried: [] };
}

/** A beat split at a bar line: its pieces before the line and its tied pieces after, or why it cannot be. */
export type BarLineSplit = { kind: 'split'; head: BeatDoc[]; tail: BeatDoc[] } | { kind: 'refused'; reason: string };

/**
 * `beat`, starting `start` ticks into a bar of `timeSignature`, split at that bar's line into written
 * values: the head up to the line, and a tail tied on from it spelled from the start of a bar of
 * `nextTimeSignature` - or why it cannot be split, with Fix bar's reasons. `beat` must cross the line.
 *
 * The split Fix bar makes (`beatsPastBarLine`), and a paste across a bar line makes too: a tuplet is
 * refused, since its pieces would lose the bracket; so is a meter on either side with no 64th grid, and
 * a split between 64ths. The head's first piece is `beat` itself, re-valued; every other piece is a
 * continuation carrying what goes on sounding (`piecesOf`, `CARRIED_OVER_A_TIE`). `beat` must not be
 * held anywhere else afterwards: the head's first piece shares its effects.
 */
export function splitAtBarLine(
  beat: BeatDoc,
  start: number,
  timeSignature: TimeSignature,
  nextTimeSignature: TimeSignature
): BarLineSplit {
  const capacity = barCapacityTicks(timeSignature);
  const end = start + beatTicks(beat);
  if (hasTuplet(beat)) return { kind: 'refused', reason: TUPLET_ACROSS_LINE };
  if (barGridFault(timeSignature, SLOT_DIVISION) !== null || barGridFault(nextTimeSignature, SLOT_DIVISION) !== null) {
    return { kind: 'refused', reason: NO_GRID_AT_LINE };
  }
  const head = spelledTicks(capacity - start, start, timeSignature);
  const tail = spelledTicks(end - capacity, 0, nextTimeSignature);
  if (!head || !tail) return { kind: 'refused', reason: OFF_GRID_AT_LINE };
  return { kind: 'split', head: piecesOf(beat, head, false), tail: piecesOf(beat, tail, true) };
}

/**
 * What a tied continuation keeps of the beat and notes it continues: what goes on sounding
 * across the tie, not what attacks.
 *
 * A tied note is not struck again. So accents, bends, ghost and dead notes, staccato, taps, slap
 * and pop, a pick stroke, a fade in, a grace, a fermata, fingering and a slide in from below all
 * stay on the beat that was struck, and a continuation carrying one would show a second attack
 * the player never made. What connects the note to the next one - a hammer-on or pull-off, a
 * shift or legato slide, a slide out - goes to the note's last piece instead (`piecesOf`).
 *
 * A continuation prints no accidental: `continuationOf` resets it to `auto`, because the tie
 * already says the pitch goes on.
 *
 * Two things that do go on sounding are still not carried, because of how alphaTab treats a tie:
 *
 * - **Note vibrato.** alphaTab draws and plays a tie destination with its origin's vibrato
 *   (`MidiFileGenerator`, `alphaTab.core.mjs` ~48360; `SlightNoteVibratoEffectInfo` ~63881;
 *   `WideNoteVibratoEffectInfo` ~64605), so the continuation's own stays none.
 * - **A trill.** `_generateTrill` (~48998) plays the origin's trill to the end of the tie
 *   (`untilTieOrSlideEnd`, ~48500), and a continuation with its own trill plays a second one over
 *   it: pinned by probe, a tied quarter's trill doubled its note events in the bar carried into.
 *   The cost is on screen: `TrillEffectInfo` (~64233) draws a trill line only on a note that
 *   has one, so the line stops at the bar line while the sound runs on.
 *
 * What a continuation keeps is a state that runs on:
 *
 * - **The dynamic** (`BeatDoc.dynamics`, carried beside these), a level rather than an attack.
 *   alphaTab reads an unmarked beat as forte and prints a dynamic wherever it differs from the
 *   beat before (`DynamicsEffectInfo._internalShouldCreateGlyph`, `alphaTab.core.mjs`
 *   ~58929-58937), so a continuation without it would print an f nobody played.
 * - **Palm mute and let ring**, on the beat and its notes. alphaTab runs each line on to the
 *   next note on the string only while that note has it too (`Note.finish`, ~6259-6276), so a
 *   continuation without it would end the line at the tie.
 * - **A harmonic**, which is how the held note sounds.
 * - **Beat vibrato, and a crescendo or decrescendo.** A hairpin grows across beats that share
 *   it (`CrescendoEffectInfo.canExpand`, ~58565), so a continuation without it would cut the
 *   hairpin at the tie.
 */
const CARRIED_OVER_A_TIE = {
  beat: ['isPalmMute', 'isLetRing', 'vibrato', 'crescendo'],
  note: ['harmonic', 'isPalmMute', 'isLetRing']
} as const satisfies { beat: readonly (keyof BeatEffectsDoc)[]; note: readonly (keyof NoteEffectsDoc)[] };

/** Copies `keys` of `source` onto `target`. Generic in the key, so each copy is type-checked. */
function copyFields<T, K extends keyof T>(target: T, source: T, keys: readonly K[]): void {
  for (const key of keys) target[key] = source[key];
}

/** A tied continuation of `beat`, at `beat`'s value until `piecesOf` re-values it. */
function continuationOf(beat: BeatDoc): BeatDoc {
  const effects = createDefaultBeatEffects();
  copyFields(effects, beat.effects, CARRIED_OVER_A_TIE.beat);
  return {
    ...createRestBeat(beat.duration),
    isRest: beat.isRest,
    dynamics: beat.dynamics,
    effects,
    notes: beat.notes.map(note => {
      const noteEffects = createDefaultNoteEffects();
      copyFields(noteEffects, note.effects, CARRIED_OVER_A_TIE.note);
      return { ...structuredClone(note), isTied: true, accidental: 'auto', effects: noteEffects };
    })
  };
}

/**
 * Slides that belong to where a note ends. A shift or legato slide runs into the next note on
 * its string (`Note.finish`, ~6291-6303) and a slide out is drawn off the note's right edge
 * (~72859). A slide in from below leads into the attack, so it is not here.
 */
const SLIDES_AT_THE_END: ReadonlySet<NoteEffectsDoc['slide']> = new Set(['shiftSlide', 'legatoSlide', 'slideOutUp']);

/** `note` without what connects it to the note after it. */
function withoutEnding(note: NoteDoc): NoteDoc {
  const slide = SLIDES_AT_THE_END.has(note.effects.slide) ? 'none' : note.effects.slide;
  return { ...note, effects: { ...note.effects, isHammerPullOrigin: false, slide } };
}

/** `piece` given what connected `origin` to the note after it. */
function withEndingOf(piece: NoteDoc, origin: NoteDoc): NoteDoc {
  const slide = SLIDES_AT_THE_END.has(origin.effects.slide) ? origin.effects.slide : piece.effects.slide;
  return { ...piece, effects: { ...piece.effects, isHammerPullOrigin: origin.effects.isHammerPullOrigin, slide } };
}

/**
 * `beat` rewritten as one beat per written value. The first piece of the head is the beat
 * itself, re-valued, so its effects and attack stay where they were struck; every other piece
 * is a tied continuation (`continuationOf`).
 *
 * What connects the note to the next one moves to the tail's last piece. alphaTab looks for a
 * hammer-on's destination and a slide's target on the next beat with a note on the same string
 * (`Note.nextNoteOnSameLine` and `findHammerPullDestination`, ~6477-6510), and after a split
 * that is the note's own tie continuation - so left on the head, a hammer-on or slide would land
 * on the tie instead of the note the user wrote it toward.
 *
 * The first piece is a shallow copy of the beat, with new note objects only where an ending is
 * taken off. `beatsPastBarLine` splices `beat` out of its voice as it puts the pieces in, so
 * nothing in the document still holds `beat`'s notes or effects to share them with, and every
 * continuation builds its own.
 */
function piecesOf(beat: BeatDoc, units: DurationUnit[], isTail: boolean): BeatDoc[] {
  return units.map((unit, index): BeatDoc => {
    if (index === 0 && !isTail) {
      return { ...beat, notes: beat.notes.map(withoutEnding), duration: unit.duration, dots: unit.dots, tuplet: null };
    }
    const piece = { ...continuationOf(beat), duration: unit.duration, dots: unit.dots };
    if (!isTail || index !== units.length - 1) return piece;
    return { ...piece, notes: piece.notes.map((note, noteIndex) => withEndingOf(note, beat.notes[noteIndex])) };
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

/**
 * Settles a bar after its meter changed: trailing rests go while the bar is over, a gap fills
 * with rests, and notes that no longer fit stay as overflow for Fix bar.
 *
 * The gap fills at the end of the bar (`fillBarGaps`), because that is where a meter change
 * opens it: no beat changed length, the bar did. Rests go only while the bar is over
 * (`takeTrailingRests`), so a whole rest left alone once the rests after it are gone stays,
 * because that fills any meter (`barFillOf`): 5/4's `r1 r4` fitted to 3/4 keeps its whole rest.
 * Trailing rests stop at a grace beat or a rest one leads into, so a bar ending that way can
 * stay over. A free-time bar is never over or under, so nothing here changes one.
 */
export function fitBarToMeter(bar: BarDoc, meter: BarMeter): void {
  takeTrailingRests(bar, meter);
  fillBarGaps(bar, meter);
}
