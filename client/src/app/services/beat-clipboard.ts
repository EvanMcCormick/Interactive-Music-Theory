import { BeatDoc, ScoreDoc } from '../models/composer.model';
import { barMeterAt, beatTicks, fillBarGaps, insertRestsAt } from './bar-fill';
import { BeatRef, beatAt } from './composer-selection';
import { insertBarInto } from './score-structure';

/**
 * The composer's clipboard: beats copied from one staff, and pasting them at the caret.
 *
 * Paste follows design Part 4: it writes from the caret for the copied length and fills gaps where they
 * open, and a bar it overfills is flagged for Fix bar rather than pushed on.
 */

/** Beats copied from one staff. */
export interface CopiedBeats {
  /** Whether they came from a fretted staff, whose notes name strings rather than pitches. */
  fretted: boolean;
  /** The copied beats bar by bar, first bar first: `bars[1]` came from the bar after `bars[0]`'s. */
  bars: BeatDoc[][];
}

/** The beats `refs` name, copied bar by bar - or null when they are on more than one staff, or name none. */
export function copiedBeatsOf(doc: ScoreDoc, refs: readonly BeatRef[]): CopiedBeats | null {
  const first = refs[0];
  if (!first || refs.some(ref => ref.trackIndex !== first.trackIndex || ref.staffIndex !== first.staffIndex)) return null;
  const staff = doc.tracks[first.trackIndex]?.staves[first.staffIndex];
  if (!staff) return null;

  const bars: BeatDoc[][] = [];
  for (const ref of refs) {
    const beat = beatAt(doc, ref);
    if (!beat) continue;
    const offset = ref.barIndex - first.barIndex;
    while (bars.length <= offset) bars.push([]);
    bars[offset].push(structuredClone(beat));
  }
  return { fretted: staff.tuning.length > 0, bars };
}

/**
 * Pastes `copied` at `at`, or returns why not. Each copied bar is written into the bar as many after
 * `at`'s as it was after the first copied bar: into `at`'s own bar from `at`'s beat, into later bars
 * from their start. The beats it lands on are removed until the copied length is covered, and when the
 * last one reached past it the spare fills with rests right after the pasted beats (`insertRestsAt`);
 * a bar left short fills at its end. A bar the copied beats overfill stays over, for Fix bar. Bars are
 * appended when the paste runs off the end, and how many is returned so the caller can stamp generated
 * tracks diverged.
 *
 * **May leave `doc` partly changed when it refuses**, like every edit that returns a reason - call it on a draft.
 */
export function pasteBeats(doc: ScoreDoc, at: BeatRef, copied: CopiedBeats): { appendedBars: number } | string {
  const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
  if (!staff) return 'There is no staff there.';
  if ((staff.tuning.length > 0) !== copied.fretted) {
    return copied.fretted
      ? 'Those beats were copied from a fretted staff, and this staff has no strings.'
      : 'Those beats were copied from a pitched staff, and this staff writes notes by string.';
  }
  const strings = copied.bars.flat().flatMap(beat => beat.notes.map(note => (note.pitch.kind === 'fretted' ? note.pitch.string : 0)));
  const highest = Math.max(0, ...strings);
  if (highest > staff.tuning.length) return `Those beats use ${highest} strings, and this staff has ${staff.tuning.length}.`;

  let appendedBars = 0;
  copied.bars.forEach((copiedBar, offset) => {
    const barIndex = at.barIndex + offset;
    while (barIndex >= staff.bars.length) {
      insertBarInto(doc, doc.masterBars.length);
      appendedBars++;
    }
    const bar = staff.bars[barIndex];
    const voice = bar.voices[at.voiceIndex];
    if (!voice) return;

    const meter = barMeterAt(doc, barIndex);
    const written = copiedBar.map(beat => structuredClone(beat));
    const span = written.reduce((sum, beat) => sum + beatTicks(beat), 0);
    const start = offset === 0 ? Math.min(at.beatIndex, voice.beats.length) : 0;

    let covered = 0;
    while (covered < span && start < voice.beats.length) {
      covered += beatTicks(voice.beats[start]);
      voice.beats.splice(start, 1);
    }
    voice.beats.splice(start, 0, ...written);
    if (covered > span) insertRestsAt(voice, start + written.length, covered - span, meter);
    fillBarGaps(bar, meter);
  });
  return { appendedBars };
}
