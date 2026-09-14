import {
  AccidentalMode,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  EditCursor,
  MasterBarDoc,
  NoteEffectsDoc,
  ScoreDoc
} from '../models/composer.model';
import { barFillAt } from './bar-fill';
import { beatsAt, fermataPositionsOf, toggledValue } from './beat-edits';
import { BeatRef, selectedBars, selectionTargets } from './composer-selection';
import { defaultFermata, fullBendPoints } from './composer-tool-defaults';
import { durationRefusal, editRefusal, fermataRefusal, noteEffectRefusal } from './edit-refusals';
import { noteEffectTargets, noteTargetsAt } from './note-edits';
import { tieOriginOf } from './note-landing';
import { respellRefusal } from './note-respell';

/**
 * What each palette tool shows before it is pressed: whether its targets already have what a press
 * sets, and why a press would be refused.
 *
 * Pure, and read from the same functions the commands use - the refusals they ask and the targets they
 * write - so a button cannot say one thing and its press do another. The design's rule for a mixed
 * range decides `pressed`: on when every target has the value, so a press turns it off; mixed when some
 * do, so a press turns it on for all.
 */

/** What a palette button shows. */
export interface ToolState {
  /** true: every target has it, and a press clears. 'mixed': some do. false: none do, or nothing is selected. */
  pressed: boolean | 'mixed';
  /** Why a press would be refused, or null. The command still refuses by itself; this only says so first. */
  refusal: string | null;
}

/** The state of a tool with nothing to show. */
export const IDLE_TOOL: ToolState = { pressed: false, refusal: null };

/** Everything a reader needs about the selection, read once. */
interface Reading {
  doc: ScoreDoc;
  cursor: EditCursor;
  refs: BeatRef[];
  focus: number | null;
  bars: { first: number; last: number };
}

type Reader = (reading: Reading) => ToolState;

/** true when every flag is set, 'mixed' when some are, false when none are or there are none. */
function share(flags: readonly boolean[]): boolean | 'mixed' {
  const set = flags.filter(Boolean).length;
  return set === 0 ? false : set === flags.length ? true : 'mixed';
}

/** Whether two values are the same by the toggle rule's comparison, whatever order their keys are in. */
function sameValue<T>(value: T, other: T): boolean {
  const marker = {} as T;
  return toggledValue([value], other, marker) === marker;
}

const beats = (reading: Reading): BeatDoc[] => beatsAt(reading.doc, reading.refs);
const ungraced = (reading: Reading): BeatDoc[] => beats(reading).filter(beat => beat.effects.grace === 'none');
const masterBars = (reading: Reading): MasterBarDoc[] => reading.doc.masterBars.slice(reading.bars.first, reading.bars.last + 1);

function duration(value: DurationValue): Reader {
  return reading => ({
    pressed: share(ungraced(reading).map(beat => beat.duration === value)),
    refusal: durationRefusal(reading.doc, reading.refs)
  });
}

function dots(count: number): Reader {
  return reading => ({
    pressed: share(ungraced(reading).map(beat => beat.dots === count)),
    refusal: durationRefusal(reading.doc, reading.refs)
  });
}

function beatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(key: K, on: BeatEffectsDoc[K]): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => sameValue(beat.effects[key], on))),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key }, null)
  });
}

function grace(kind: Exclude<BeatEffectsDoc['grace'], 'none'>): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => beat.effects.grace === kind)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'grace' }, null)
  });
}

function dynamic(value: DynamicValue): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => beat.dynamics === value)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'dynamics' }, null)
  });
}

/**
 * A note effect tool. Reads the notes the command would set (`noteEffectTargets`) and asks its refusal.
 * Vibrato on a tied note reads the vibrato of the note it is tied from, which is the one alphaTab draws.
 */
function noteEffect<K extends keyof NoteEffectsDoc>(key: K, on: NoteEffectsDoc[K], off: NoteEffectsDoc[K]): Reader {
  return reading => {
    const targets = noteEffectTargets(reading.doc, reading.refs, reading.focus, key, on);
    const values = targets.map(({ ref, note }) => {
      const origin = key === 'vibrato' ? tieOriginOf(reading.doc, ref, note) : null;
      return (origin ?? note).effects[key];
    });
    return {
      pressed: share(values.map(value => sameValue(value, on))),
      refusal: noteEffectRefusal(reading.doc, reading.refs, reading.focus, key, on, off)
    };
  };
}

function accidental(mode: Exclude<AccidentalMode, 'auto'>): Reader {
  return reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.accidental === mode)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: mode }, reading.focus)
  });
}

function barFlag(read: (bar: MasterBarDoc) => boolean): Reader {
  return reading => ({ pressed: share(masterBars(reading).map(read)), refusal: null });
}

/** Fix bar's refusal, as `ComposerStructureCommands.fixBar` gives it: a generated track, or nothing over. */
function fixBarRefusal(reading: Reading): string | null {
  const { trackIndex, staffIndex } = reading.cursor;
  const generated = editRefusal(reading.doc, [], { family: 'track', trackIndex }, null);
  if (generated) return generated;
  for (let bar = reading.bars.first; bar <= reading.bars.last; bar++) {
    if (barFillAt(reading.doc, trackIndex, staffIndex, bar)?.kind === 'over') return null;
  }
  return 'No selected bar is over its time signature.';
}

const TRIPLET = { numerator: 3, denominator: 2 };
const FULL_BEND = fullBendPoints();

/**
 * A tool with nothing to show: its popover sets a value rather than toggling one, or it can always be
 * pressed. Listed rather than left out, so every palette button has a reader and the table's spec can say so.
 */
const idle: Reader = () => IDLE_TOOL;

/** One reader per palette tool, by tool id. */
const READERS: Readonly<Record<string, Reader>> = {
  timeSignature: idle,
  keySignature: idle,
  clef: idle,
  insertBar: idle,
  whole: duration(1),
  half: duration(2),
  quarter: duration(4),
  eighth: duration(8),
  sixteenth: duration(16),
  thirtySecond: duration(32),
  sixtyFourth: duration(64),
  dot: dots(1),
  doubleDot: dots(2),
  triplet: reading => ({
    pressed: share(beats(reading).map(beat => beat.tuplet !== null && sameValue(beat.tuplet, TRIPLET))),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'tuplet' }, null)
  }),
  tuplet: reading => ({
    pressed: share(beats(reading).map(beat => beat.tuplet !== null)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'tuplet' }, null)
  }),
  tie: reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.isTied)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'tie' }, reading.focus)
  }),
  rest: reading => ({
    pressed: share(beats(reading).map(beat => beat.isRest)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'beat', key: 'duration' }, null)
  }),
  repeatOpen: barFlag(bar => bar.isRepeatStart),
  repeatClose: barFlag(bar => bar.repeatCount > 0),
  alternateEnding: barFlag(bar => bar.alternateEndings > 0),
  section: barFlag(bar => bar.section !== null),
  doubleBar: barFlag(bar => bar.isDoubleBar),
  tripletFeel: barFlag(bar => bar.tripletFeel !== 'none'),
  freeTime: barFlag(bar => bar.isFreeTime),
  fixBar: reading => ({ pressed: false, refusal: fixBarRefusal(reading) }),
  deleteBar: reading => ({
    pressed: false,
    refusal: reading.bars.last - reading.bars.first + 1 >= reading.doc.masterBars.length ? 'A score needs at least one bar.' : null
  }),
  doubleFlat: accidental('doubleFlat'),
  flat: accidental('flat'),
  natural: reading => ({
    pressed: false,
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: 'auto' }, reading.focus)
  }),
  sharp: accidental('sharp'),
  doubleSharp: accidental('doubleSharp'),
  respell: reading => ({ pressed: false, refusal: respellRefusal(reading.doc, reading.refs, reading.focus) }),
  ppp: dynamic('ppp'),
  pp: dynamic('pp'),
  p: dynamic('p'),
  mp: dynamic('mp'),
  mf: dynamic('mf'),
  f: dynamic('f'),
  ff: dynamic('ff'),
  fff: dynamic('fff'),
  crescendo: beatEffect('crescendo', 'crescendo'),
  decrescendo: beatEffect('crescendo', 'decrescendo'),
  accent: noteEffect('accent', 'normal', 'none'),
  heavyAccent: noteEffect('accent', 'heavy', 'none'),
  staccato: noteEffect('isStaccato', true, false),
  tenuto: noteEffect('accent', 'tenuto', 'none'),
  // Reads the non-grace beats at the positions, as `toggleFermata` does.
  fermata: reading => ({
    pressed: share(
      fermataPositionsOf(reading.doc, reading.refs)
        .filter(beat => beat.effects.grace === 'none')
        .map(beat => beat.effects.fermata !== null && sameValue(beat.effects.fermata, defaultFermata()))
    ),
    refusal: fermataRefusal(reading.doc, reading.refs)
  }),
  hammerOn: noteEffect('isHammerPullOrigin', true, false),
  legatoSlide: noteEffect('slide', 'legatoSlide', 'none'),
  shiftSlide: noteEffect('slide', 'shiftSlide', 'none'),
  bend: noteEffect('bendPoints', FULL_BEND, []),
  vibrato: noteEffect('vibrato', 'slight', 'none'),
  wideVibrato: noteEffect('vibrato', 'wide', 'none'),
  palmMute: noteEffect('isPalmMute', true, false),
  letRing: noteEffect('isLetRing', true, false),
  naturalHarmonic: noteEffect('harmonic', 'natural', 'none'),
  artificialHarmonic: noteEffect('harmonic', 'artificial', 'none'),
  ghost: noteEffect('isGhost', true, false),
  dead: noteEffect('isDead', true, false),
  trill: reading => ({
    pressed: share(noteTargetsAt(reading.doc, reading.refs, reading.focus).map(({ note }) => note.effects.trill !== null)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'trill' }, reading.focus)
  }),
  tap: beatEffect('tap', true),
  leftHandTap: noteEffect('isLeftHandTapped', true, false),
  slap: beatEffect('slap', true),
  pop: beatEffect('pop', true),
  graceBefore: grace('beforeBeat'),
  graceOnBeat: grace('onBeat'),
  pickDown: beatEffect('pickStroke', 'down'),
  pickUp: beatEffect('pickStroke', 'up'),
  fadeIn: beatEffect('fadeIn', true)
};

/** The ids of every tool `toolStates` has something to say about. */
export const TOOLS_WITH_STATE: readonly string[] = Object.keys(READERS);

function readingOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): Reading {
  return {
    doc,
    cursor,
    refs: selectionTargets(doc, anchor, cursor),
    // The same focus the service's edits use: the caret's string, only when there is no range.
    focus: anchor ? null : cursor.stringIndex,
    bars: selectedBars(anchor, cursor)
  };
}

/** Every palette tool's state for the selection from `anchor` to `cursor`. */
export function toolStates(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor): ReadonlyMap<string, ToolState> {
  const reading = readingOf(doc, anchor, cursor);
  return new Map(Object.entries(READERS).map(([id, read]) => [id, read(reading)]));
}

/** One tool's state, or `IDLE_TOOL` for a tool with nothing to show. For a command deciding a toggle. */
export function toolStateOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor, toolId: string): ToolState {
  const read = READERS[toolId];
  return read ? read(readingOf(doc, anchor, cursor)) : IDLE_TOOL;
}
