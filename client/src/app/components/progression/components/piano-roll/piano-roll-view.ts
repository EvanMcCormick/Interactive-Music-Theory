import { VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
import { ChordSlot, ProgressionState, RollNote } from '../../../../models/progression.model';
import { MAX_BEAT_DIVISION, MidiRange, midiToY, rowCount, visibleMidiRange } from './piano-roll-geometry';

/**
 * What the roll draws for one published state: the notes, the keyboard beside
 * them, and how big a grid to put them on.
 *
 * Pure, on the `progression-strip-cards.ts` precedent and for its two reasons.
 * None of this is about a component - a published state goes in and a view model
 * comes out, with no Angular, no DOM and no injector - and taking it out of the
 * component put that file back under the project's line cap, which is the same
 * seam and the same argument as the strip's.
 *
 * The one thing it is *given* rather than deciding is the spelling. How a pitch
 * class is written is `MusicTheoryService`'s app-wide decision, so it arrives as
 * a function, and is asked to spell a note with a given preference rather than
 * asked what the preference is: `getNoteName` answers for the fretboard's key,
 * the two are allowed to differ, and asking the app-wide rule is how the palette
 * came to print `D♯ Maj` as the tonic chord of E flat major.
 *
 * ## Everything the component needs from one call
 *
 * `buildRollView` hands back the stored notes as well as the drawn ones, and
 * that is deliberate: a gesture dispatches `RollNote`s and the template draws
 * `RollNoteView`s, and the two lists have to be the same list in the same order
 * for a view's `index` to name the note a setter will act on. Deriving them in
 * one place is what makes that true by construction rather than by two callers
 * agreeing.
 *
 * ## What a note carries, and what it deliberately does not
 *
 * A note view carries **beats and rows, not pixels.** The roll is laid out
 * absolutely - `calc(var(--px-per-beat) * var(--note-beats))` - so the scale
 * lives in the stylesheet and this file never needs to know it. That is what
 * lets the view model be built before anything has been measured, and it is
 * why `row` is `midiToY` at a *unit* row height rather than a pixel offset: the
 * mapping from a pitch to a row is the geometry's, and the multiplication by a
 * row height is CSS's.
 *
 * It also carries no chord name. Which chord the slot is remains the strip's
 * sentence - `progression-strip-cards.ts` argues what a card prints and what it
 * does not - and printing it here as well would be a second convention for one
 * chord in two components. `positionText` says only *which* slot is open.
 */

/** How a pitch class is written. `MusicTheoryService.spellNote`, passed in. */
export type SpellNote = (pitchClass: number, preferSharps: boolean) => string;

/** The pitch classes drawn as black keys. */
const BLACK_PITCH_CLASSES: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);

/** MIDI 60 is C4, so the raw division by twelve is one octave too high. */
const MIDI_OCTAVE_OFFSET = 1;

/**
 * The width of the whole MIDI velocity range.
 *
 * Shared with the component, which measures the velocity lane against it: the
 * lane's full height *is* this range, so a bar's fraction here and a drag's
 * scale there are two halves of one statement.
 */
export const VELOCITY_SPAN = VELOCITY_MAX - VELOCITY_MIN;

/** The nominal ceiling `role="slider"` announces. See `StripCard.maxBeats`. */
const ANNOUNCED_MAX_BEATS = 16;

/** One note, ready to be drawn and dispatched from. */
export interface RollNoteView {
  /**
   * Where the note sits in the slot's own list.
   *
   * The identity the *model* gives a note - `setNoteTiming` and
   * `setNoteVelocity` both address one by index - so using anything else here
   * would mean keeping a second identity in step with the one the service
   * already uses. It is also `trackBy`, for the same reason.
   */
  index: number;
  midi: number;
  startBeat: number;
  lengthBeats: number;
  velocity: number;
  /** Rows from the top of the window. The stylesheet multiplies by the row height. */
  row: number;
  /** 0 to 1, for how tall the velocity bar is drawn. */
  velocityFraction: number;
  /** `C4`, spelled the way the progression's key spells it. */
  name: string;
  label: string;
  resizeLabel: string;
  velocityLabel: string;
  /** `1.5 beats`, for the resize handle's `aria-valuetext`. */
  beatsText: string;
  /** The ceiling the handle announces, widened to whatever this note already is. */
  maxBeats: number;
}

/** One pitch row of the keyboard down the left-hand side. */
export interface RollRow {
  midi: number;
  /** `C`, or `Eb` - the pitch class, spelled for this key. */
  name: string;
  isBlack: boolean;
  /** Only the Cs are labelled; 25 stacked note names is not a keyboard. */
  showName: boolean;
  /** `C4`, for the row's title. */
  label: string;
}

/** One entry of the grid control. `value` is steps per beat; 0 is free timing. */
export interface DivisionOption {
  value: number;
  label: string;
}

/** The whole of what the roll renders from one published state. */
export interface RollView {
  /** The slot being edited, or null when the strip has selected nothing. */
  slotId: string | null;
  /** Its notes as the document holds them - what a gesture dispatches. */
  slotNotes: readonly RollNote[];
  /** The same notes as the template draws them, in the same order. */
  notes: readonly RollNoteView[];
  /** The keyboard down the left, highest pitch first. */
  rows: readonly RollRow[];
  /** How many beats wide the grid is. */
  totalBeats: number;
  /** How many pitch rows tall it is. */
  gridRows: number;
  /** The highest pitch drawn - `midiToY`'s `topMidi`, and the row-zero pitch. */
  topMidi: number;
  /** `Chord 2 of 4`, or why there is nothing to edit. */
  positionText: string;
  /** Whether there is a chord to hand the slot back to. */
  canReset: boolean;
}

/** Builds everything the roll draws from one published state. */
export function buildRollView(state: ProgressionState, spell: SpellNote): RollView {
  const slot = findSelected(state);
  const slotNotes = slot ? slot.notes : [];
  const range = visibleMidiRange(slotNotes);
  const spellHere = (pitchClass: number) => spell(pitchClass, state.doc.key.preferSharps);

  return {
    slotId: slot ? slot.id : null,
    slotNotes,
    notes: slotNotes.map((note, index) => buildNoteView(note, index, range, spellHere)),
    rows: buildRows(range, spellHere),
    totalBeats: gridBeats(slot),
    gridRows: rowCount(range),
    topMidi: range.high,
    positionText: describePosition(state, slot),
    // The service refuses on both counts - a key that cannot stack thirds, and a
    // literal slot with no degree to rebuild from - so this is the same question
    // asked where a button can grey itself out rather than a second rule. See
    // `ProgressionService.resetSlotToChord`.
    canReset: slot !== null && state.canBuildChords && slot.harmony.kind === 'degree'
  };
}

/**
 * The grids the control offers, from whole beats to `MAX_BEAT_DIVISION`.
 *
 * Labelled as note values because that is what a musician reads: a division
 * counts steps per *beat*, and a beat is a quarter note, so 2 steps is an eighth
 * and 3 is an eighth triplet. The ceiling is the model's - `MAX_BEAT_DIVISION`
 * is `1 / MIN_NOTE_BEATS` - rather than a number chosen here.
 */
export function buildDivisions(): DivisionOption[] {
  return [
    { value: 0, label: 'Free' },
    { value: 1, label: '1/4' },
    { value: 2, label: '1/8' },
    { value: 3, label: '1/8 triplet' },
    { value: 4, label: '1/16' },
    { value: 6, label: '1/16 triplet' },
    { value: 8, label: '1/32' },
    { value: MAX_BEAT_DIVISION, label: '1/64' }
  ];
}

/** How a pitch class is written, with the key's preference already applied. */
type SpellPitchClass = (pitchClass: number) => string;

/** The selected slot, or null - including when the selection names a lost slot. */
function findSelected(state: ProgressionState): ChordSlot | null {
  if (!state.selectedSlotId) return null;
  return state.doc.slots.find(slot => slot.id === state.selectedSlotId) ?? null;
}

/**
 * How many beats of grid to draw.
 *
 * The slot's own length, or the end of its longest note when one runs past it -
 * which `retimeNotes` and `setNoteTiming` both allow on purpose, and a note that
 * cannot be seen is a note that cannot be dragged back. Rounded up so the grid
 * ends on a beat line rather than halfway through a cell.
 */
function gridBeats(slot: ChordSlot | null): number {
  if (!slot) return 0;

  let end = slot.lengthBeats;
  for (const note of slot.notes) {
    const noteEnd = note.startBeat + note.lengthBeats;
    if (noteEnd > end) end = noteEnd;
  }

  return Math.max(1, Math.ceil(end));
}

/** The keyboard down the left-hand side, highest pitch first. */
function buildRows(range: MidiRange, spell: SpellPitchClass): RollRow[] {
  const rows: RollRow[] = [];

  for (let midi = range.high; midi >= range.low; midi--) {
    const pitchClass = pitchClassOf(midi);
    rows.push({
      midi,
      name: spell(pitchClass),
      isBlack: BLACK_PITCH_CLASSES.has(pitchClass),
      // Only the Cs carry a label. Twenty-five stacked note names is not a
      // keyboard, and a C every octave is how one is read.
      showName: pitchClass === 0,
      label: noteName(midi, spell)
    });
  }

  return rows;
}

/** One note, ready to draw. */
function buildNoteView(
  note: RollNote,
  index: number,
  range: MidiRange,
  spell: SpellPitchClass
): RollNoteView {
  const name = noteName(note.midi, spell);
  const beats = formatBeats(note.lengthBeats);

  return {
    index,
    midi: note.midi,
    startBeat: note.startBeat,
    lengthBeats: note.lengthBeats,
    velocity: note.velocity,
    // The row index is `midiToY` at a unit row height; the stylesheet multiplies
    // by `--row-height`. Asking the geometry for it rather than subtracting here
    // is what keeps one mapping between a pitch and a row - and the inversion,
    // which is the half of it that is easy to get backwards.
    row: midiToY(note.midi, range.high, 1),
    velocityFraction: (note.velocity - VELOCITY_MIN) / VELOCITY_SPAN,
    name,
    // Built here rather than in the template, for the strip's reason: a
    // concatenation in an `[attr.aria-label]` binding is re-evaluated on every
    // change-detection pass.
    label: `${name}, beat ${formatNumber(note.startBeat + 1)}, ${beats}`,
    resizeLabel: `Length of ${name}`,
    velocityLabel: `Velocity of ${name}`,
    beatsText: beats,
    maxBeats: Math.max(ANNOUNCED_MAX_BEATS, note.lengthBeats)
  };
}

/** `C4`. The octave is MIDI's: 60 is C4, so the raw division is one too high. */
function noteName(midi: number, spell: SpellPitchClass): string {
  return `${spell(pitchClassOf(midi))}${Math.floor(midi / 12) - MIDI_OCTAVE_OFFSET}`;
}

/** A pitch class in 0-11, for a `midi` the model deliberately does not clamp. */
function pitchClassOf(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** `1 beat`, `4 beats`, `1.5 beats`. */
function formatBeats(beats: number): string {
  const shown = formatNumber(beats);
  return `${shown} ${shown === 1 ? 'beat' : 'beats'}`;
}

/** Free timing means fractions, and a screen reader should not read all of them. */
function formatNumber(value: number): number {
  return Number(value.toFixed(2));
}

/** Where in the progression the edited chord is, or why there is nothing to edit. */
function describePosition(state: ProgressionState, slot: ChordSlot | null): string {
  if (!slot) return 'No chord selected';

  const index = state.doc.slots.findIndex(other => other.id === slot.id);
  return `Chord ${index + 1} of ${state.doc.slots.length}`;
}
