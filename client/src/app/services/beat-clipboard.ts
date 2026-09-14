import { BeatDoc, ScoreDoc } from '../models/composer.model';
import { barCapacityTicks, barFillOf, barMeterAt, beatTicks, fillBarGaps, graceRunStart, insertRestsAt, splitAtBarLine } from './bar-fill';
import { fermataPositionsOf, graceFermataOf, tupletGroupsOf } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { insertBarInto } from './score-structure';

/**
 * The composer's clipboard: beats copied from one staff, and pasting them.
 *
 * Paste follows design Part 4: it writes from the start of the selection for the copied length and
 * fills gaps where they open, and a bar it overfills is flagged for Fix bar rather than pushed on.
 */

/** Beats copied from one staff. */
export interface CopiedBeats {
  /** Whether they came from a fretted staff, whose notes name strings rather than pitches. */
  fretted: boolean;
  /** The copied beats in timeline order, as one run: bar lines between them are not kept. */
  beats: BeatDoc[];
}

/** The beats `refs` name, copied as one run - or null when they are on more than one staff, or name none. */
export function copiedBeatsOf(doc: ScoreDoc, refs: readonly BeatRef[]): CopiedBeats | null {
  const first = refs[0];
  if (!first || refs.some(ref => ref.trackIndex !== first.trackIndex || ref.staffIndex !== first.staffIndex)) return null;
  const staff = doc.tracks[first.trackIndex]?.staves[first.staffIndex];
  if (!staff) return null;

  const beats = refs.map(ref => beatAt(doc, ref)).filter((beat): beat is BeatDoc => beat !== null);
  return beats.length > 0 ? { fretted: staff.tuning.length > 0, beats: beats.map(beat => structuredClone(beat)) } : null;
}

const NO_ROOM = 'A time signature there leaves no room in a bar, so there is nowhere to paste.';

const PART_OF_A_GROUP = 'The copy holds part of a tuplet group. Copy the whole group to paste it.';

const PAST_THE_LINE = 'That beat is past the bar line; Fix bar first.';

/**
 * Pastes `copied` from `at`, or returns why not.
 *
 * The copied beats are laid down as one continuous run from `at`'s beat - from in front of any graces
 * leading into it - each starting where the one before it ended, crossing bar lines as they come to them,
 * so the spacing between copied beats is kept whatever bars they were copied from. A beat that would
 * cross a bar line is split there as Fix bar splits one (`splitAtBarLine`), its tail tied into the next
 * bar, and refused where Fix bar refuses: a tuplet across the line, or a split between 64ths. In each bar
 * the run reaches, the beats it lands on are removed until its length there is covered; when the last one
 * reached past it the spare fills with rests right after the pasted beats (`insertRestsAt`), and a bar
 * left short fills at its end. A bar the pasted beats overfill - one already over - stays over, for Fix
 * bar. A free-time bar takes the rest of the run, since no meter says where it ends. Bars are appended
 * when the run runs off the end, and how many is returned, so the caller can stamp generated tracks
 * diverged, with where the run starts, for the caret.
 *
 * A fermata belongs to a bar position on every track (the design's M2 decision 2). So each pasted beat
 * that carries one puts it on every track's beat at its position (`fermataPositionsOf`), and one that
 * carries none takes the fermata already at its position, if any - so a paste neither leaves a fermata on
 * one staff alone nor wipes one from the others. A pasted grace has no position of its own: it takes the
 * fermata at the position of the beat it leads into, or none (`graceFermataOf`), since alphaTab files a
 * grace's fermata there and a copied one would spread to every track on save.
 *
 * Refused before anything changes: a copy holding part of a tuplet group (`tupletGroupsOf`), which would
 * start a group alphaTab never closes and leave room off the 64th grid; and a paste at a beat that starts at
 * or past the line of a bar already over, which would land in the next bar while the caret stayed put.
 *
 * **May leave `doc` partly changed when it refuses**, like every edit that returns a reason - call it on a draft.
 */
export function pasteBeats(doc: ScoreDoc, at: BeatRef, copied: CopiedBeats): { appendedBars: number; at: BeatRef } | string {
  const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
  if (!staff) return 'There is no staff there.';
  if ((staff.tuning.length > 0) !== copied.fretted) {
    return copied.fretted
      ? 'Those beats were copied from a fretted staff, and this staff has no strings.'
      : 'Those beats were copied from a pitched staff, and this staff writes notes by string.';
  }
  const strings = copied.beats.flatMap(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.string : 0)));
  const highest = Math.max(0, ...strings);
  if (highest > staff.tuning.length) return `Those beats use ${highest} strings, and this staff has ${staff.tuning.length}.`;
  if (tupletGroupsOf(copied.beats).some(group => group !== null && !group.full)) return PART_OF_A_GROUP;

  const startBar = staff.bars[at.barIndex];
  const startVoice = startBar?.voices[at.voiceIndex];
  if (!startBar || !startVoice) return 'There is no beat there to paste at.';
  const startIndex = graceRunStart(startVoice, Math.min(at.beatIndex, startVoice.beats.length));

  // The run, cut into what goes in each bar.
  const segments: { barIndex: number; startIndex: number; beats: BeatDoc[] }[] = [];
  const pending = copied.beats.map(beat => structuredClone(beat));
  let appendedBars = 0;
  let tick = startVoice.beats.slice(0, startIndex).reduce((sum, beat) => sum + beatTicks(beat), 0);

  const startMeter = barMeterAt(doc, at.barIndex);
  const startCapacity = startMeter.isFreeTime ? Number.POSITIVE_INFINITY : barCapacityTicks(startMeter.timeSignature);
  if (startCapacity > 0 && tick >= startCapacity && barFillOf(startBar, startMeter).kind === 'over') return PAST_THE_LINE;
  for (let barIndex = at.barIndex; pending.length > 0; barIndex++, tick = 0) {
    while (barIndex >= staff.bars.length) {
      insertBarInto(doc, doc.masterBars.length);
      appendedBars++;
    }
    const meter = barMeterAt(doc, barIndex);
    const capacity = meter.isFreeTime ? Number.POSITIVE_INFINITY : barCapacityTicks(meter.timeSignature);
    if (capacity <= 0) return NO_ROOM;
    const segment = { barIndex, startIndex: barIndex === at.barIndex ? startIndex : 0, beats: [] as BeatDoc[] };
    segments.push(segment);

    while (pending.length > 0) {
      const beat = pending[0];
      const ticks = beatTicks(beat);
      // A grace at the line leads into the beat after it, which starts the next bar.
      if (tick >= capacity) break;
      if (tick + ticks <= capacity) {
        segment.beats.push(beat);
        pending.shift();
        tick += ticks;
        continue;
      }
      const split = splitAtBarLine(beat, tick, meter.timeSignature, barMeterAt(doc, barIndex + 1).timeSignature);
      if (split.kind === 'refused') return split.reason;
      segment.beats.push(...split.head);
      pending.splice(0, 1, ...split.tail);
      break;
    }
  }

  for (const segment of segments) {
    const bar = staff.bars[segment.barIndex];
    const voice = bar?.voices[at.voiceIndex];
    if (!bar || !voice) continue;
    const meter = barMeterAt(doc, segment.barIndex);
    const span = segment.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
    const start = Math.min(segment.startIndex, voice.beats.length);

    let covered = 0;
    while (covered < span && start < voice.beats.length) {
      covered += beatTicks(voice.beats[start]);
      voice.beats.splice(start, 1);
    }
    voice.beats.splice(start, 0, ...segment.beats);
    if (covered > span) insertRestsAt(voice, start + segment.beats.length, covered - span, meter);
    fillBarGaps(bar, meter);
  }

  for (const segment of segments) {
    const voice = staff.bars[segment.barIndex]?.voices[at.voiceIndex];
    for (const beat of segment.beats) {
      if (!voice || beat.effects.grace !== 'none') continue;
      const ref: BeatRef = { ...at, barIndex: segment.barIndex, beatIndex: voice.beats.indexOf(beat) };
      const positions = fermataPositionsOf(doc, [ref]);
      const standing = positions.find(other => other !== beat && other.effects.grace === 'none' && other.effects.fermata !== null);
      const fermata = beat.effects.fermata ?? standing?.effects.fermata ?? null;
      for (const other of positions) other.effects.fermata = fermata ? { ...fermata } : null;
    }
  }

  for (const segment of segments) {
    const voice = staff.bars[segment.barIndex]?.voices[at.voiceIndex];
    for (const beat of segment.beats) {
      if (!voice || beat.effects.grace === 'none') continue;
      beat.effects.fermata = graceFermataOf(doc, { ...at, barIndex: segment.barIndex, beatIndex: voice.beats.indexOf(beat) });
    }
  }

  return { appendedBars, at: { ...at, beatIndex: startIndex } };
}
