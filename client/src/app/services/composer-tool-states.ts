import {
  AccidentalMode,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  DynamicValue,
  EditCursor,
  EntryMode,
  MasterBarDoc,
  NoteEffectsDoc,
  ScoreDoc
} from '../models/composer.model';
import { barFillAt } from './bar-fill';
import { beatsAt, fermataPositionsOf, toggledValue } from './beat-edits';
import { BeatRef, selectedBars, selectionTargets } from './composer-selection';
import { defaultFermata, fullBendPoints } from './composer-tool-defaults';
import {
  beatEffectRefusal,
  durationRefusal,
  editRefusal,
  fermataRefusal,
  noteEffectRefusal,
  tieRefusal,
  trillRefusal
} from './edit-refusals';
import { NoteTarget, noteEffectTargets, noteTargetsAt, tieTargetsOf } from './note-edits';
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

/**
 * What a palette button shows. What `pressed` means depends on the tool's `kind` (`ToolKind` in
 * composer-tools.ts), and only a toggle's and a radio's is shown as `aria-pressed`:
 * - **toggle**: true when every target has what a press sets, so a press clears it; 'mixed' when some do,
 *   so a press sets it on all; false when none do, or nothing is selected.
 * - **radio**: true when every target has this value - the note value, or the entry mode in force for
 *   Select and Pen; 'mixed' when some do. A press sets the value and never clears it.
 * - **popover**: whether the selection already carries a value of this kind - a section, a tuplet, an
 *   alternate ending. A cue for styling, not a pressed state.
 * - **action**: false, except Rest, which says every target is already a rest. Not a pressed state either.
 */
export interface ToolState {
  /** See `ToolState`: what it means depends on the tool's kind. */
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
  /** Select or Pen - or null from `toolStateOf`, which is not told and answers nothing for either. */
  entryMode: EntryMode | null;
  /** The notes a press means (`noteTargetsAt`), read the first time a reader asks and kept for the rest. */
  notes: () => readonly NoteTarget[];
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

function beatEffect<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(key: K, on: BeatEffectsDoc[K], off: BeatEffectsDoc[K]): Reader {
  return reading => ({
    pressed: share(beats(reading).map(beat => sameValue(beat.effects[key], on))),
    refusal: beatEffectRefusal(reading.doc, reading.refs, key, on, off)
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
    const notes = reading.notes();
    const targets = noteEffectTargets(reading.doc, reading.refs, reading.focus, key, on, notes);
    const values = targets.map(({ ref, note }) => {
      const origin = key === 'vibrato' ? tieOriginOf(reading.doc, ref, note) : null;
      return (origin ?? note).effects[key];
    });
    return {
      pressed: share(values.map(value => sameValue(value, on))),
      refusal: noteEffectRefusal(reading.doc, reading.refs, reading.focus, key, on, off, notes)
    };
  };
}

function accidental(mode: Exclude<AccidentalMode, 'auto'>): Reader {
  return reading => ({
    pressed: share(reading.notes().map(({ note }) => note.accidental === mode)),
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: mode }, reading.focus, reading.notes())
  });
}

/** Select or Pen: pressed when it is the entry mode in force. */
function entryModeTool(mode: EntryMode): Reader {
  return reading => (reading.entryMode === null ? IDLE_TOOL : { pressed: reading.entryMode === mode, refusal: null });
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
  select: entryModeTool('select'),
  pen: entryModeTool('pen'),
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
    pressed: share(tieTargetsOf(reading.doc, reading.refs, reading.focus, reading.notes()).map(({ note }) => note.isTied)),
    refusal: tieRefusal(reading.doc, reading.refs, reading.focus, reading.notes())
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
    refusal: editRefusal(reading.doc, reading.refs, { family: 'note', key: 'accidental', accidental: 'auto' }, reading.focus, reading.notes())
  }),
  sharp: accidental('sharp'),
  doubleSharp: accidental('doubleSharp'),
  respell: reading => ({ pressed: false, refusal: respellRefusal(reading.doc, reading.refs, reading.focus, reading.notes()) }),
  ppp: dynamic('ppp'),
  pp: dynamic('pp'),
  p: dynamic('p'),
  mp: dynamic('mp'),
  mf: dynamic('mf'),
  f: dynamic('f'),
  ff: dynamic('ff'),
  fff: dynamic('fff'),
  crescendo: beatEffect('crescendo', 'crescendo', 'none'),
  decrescendo: beatEffect('crescendo', 'decrescendo', 'none'),
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
    pressed: share(reading.notes().map(({ note }) => note.effects.trill !== null)),
    refusal: trillRefusal(reading.doc, reading.refs, reading.focus, reading.notes())
  }),
  tap: beatEffect('tap', true, false),
  leftHandTap: noteEffect('isLeftHandTapped', true, false),
  slap: beatEffect('slap', true, false),
  pop: beatEffect('pop', true, false),
  graceBefore: grace('beforeBeat'),
  graceOnBeat: grace('onBeat'),
  pickDown: beatEffect('pickStroke', 'down', 'none'),
  pickUp: beatEffect('pickStroke', 'up', 'none'),
  fadeIn: beatEffect('fadeIn', true, false)
};

/** The ids of every tool `toolStates` has something to say about. */
export const TOOLS_WITH_STATE: readonly string[] = Object.keys(READERS);

function readingOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor, entryMode: EntryMode | null): Reading {
  const refs = selectionTargets(doc, anchor, cursor);
  // The same focus the service's edits use: the caret's string, only when there is no range.
  const focus = anchor ? null : cursor.stringIndex;
  let notes: readonly NoteTarget[] | null = null;
  return {
    doc,
    cursor,
    refs,
    focus,
    bars: selectedBars(anchor, cursor),
    entryMode,
    notes: () => (notes ??= noteTargetsAt(doc, refs, focus))
  };
}

/** What `toolStates` was last asked, and its answer. */
let lastStates: {
  doc: ScoreDoc;
  anchor: EditCursor | null;
  cursor: EditCursor;
  entryMode: EntryMode;
  states: ReadonlyMap<string, ToolState>;
} | null = null;

/**
 * Every palette tool's state for the selection from `anchor` to `cursor`, with `entryMode` in force.
 *
 * Memoized on the identity of its arguments. A page reading this in its template asks on every change
 * detection, and over a select-all each reading walks every note of the track for every tool; asked again
 * with the same state, the same map comes back without reading anything. One entry is enough - there is
 * one composer - and identity is the right test because `ComposerService` replaces the document and the
 * selection whenever they change and never mutates a published one. Within one reading, the notes the
 * selection means are read once and shared by every tool (`Reading.notes`).
 */
export function toolStates(
  doc: ScoreDoc,
  anchor: EditCursor | null,
  cursor: EditCursor,
  entryMode: EntryMode
): ReadonlyMap<string, ToolState> {
  const last = lastStates;
  if (last && last.doc === doc && last.anchor === anchor && last.cursor === cursor && last.entryMode === entryMode) {
    return last.states;
  }
  const reading = readingOf(doc, anchor, cursor, entryMode);
  const states: ReadonlyMap<string, ToolState> = new Map(Object.entries(READERS).map(([id, read]) => [id, read(reading)]));
  lastStates = { doc, anchor, cursor, entryMode, states };
  return states;
}

/**
 * One tool's state, or `IDLE_TOOL` for a tool with nothing to show. For a command deciding a toggle, so it
 * is not told the entry mode: Select and Pen come back idle here, and `toolStates` answers for them.
 */
export function toolStateOf(doc: ScoreDoc, anchor: EditCursor | null, cursor: EditCursor, toolId: string): ToolState {
  const read = READERS[toolId];
  return read ? read(readingOf(doc, anchor, cursor, null)) : IDLE_TOOL;
}
