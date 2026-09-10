import { VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
import { ChordSlot, ProgressionState, RollNote } from '../../../../models/progression.model';
import { SpelledNote, formatNote, scientificOctave, spellAt } from '../../../../services/note-spelling';
import { effectiveChord } from '../../../../services/progression-harmony';
import { chordRootSpelling, scaleNoteSpelling } from '../../../../services/progression-spelling';
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
 * The spelling used to be *given* rather than decided - a `SpellNote` handed in,
 * because how a pitch class is written was `MusicTheoryService`'s app-wide
 * decision. It is now asked of `progression-spelling.ts` with the progression's
 * own key and scale, so a note the scale contains is written on its degree's
 * letter: F locrian's pitch class 8 is an `Ab` here, where the chromatic tables
 * called it `G♯`. A note outside the scale still falls back to the key's
 * preference, which is what those tables were doing all along.
 *
 * A note that is a chord tone of the selected slot is spelled from the chord's
 * root instead, which is finer still: a third is two letters above the root
 * whatever the key thinks of it. See `chordToneSpellings`. The scale's answer is
 * the right one for every other note either way.
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

/** The pitch classes drawn as black keys. */
const BLACK_PITCH_CLASSES: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);

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
  /** Where this note's velocity bar starts, in beats. See `buildLaneColumns`. */
  laneBeat: number;
  /** How wide that bar is, in beats. Never shared with another note's. */
  laneBeats: number;
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
export function buildRollView(state: ProgressionState): RollView {
  const slot = findSelected(state);
  const slotNotes = slot ? slot.notes : [];
  const range = visibleMidiRange(slotNotes);
  // The scale as the key resolves it, or nothing when the id does not resolve -
  // in which case every note falls back to the key's own preference, which is
  // what `scaleNoteSpelling` does with a scale it cannot read degrees from.
  const intervals = state.keyScale ? state.keyScale.intervals : [];
  const chordTones = chordToneSpellings(state, slot);
  const spellHere = (pitchClass: number) =>
    chordTones.get(pitchClass) ?? scaleNoteSpelling(state.doc.key, intervals, pitchClass);
  const columns = buildLaneColumns(slotNotes);

  return {
    slotId: slot ? slot.id : null,
    slotNotes,
    notes: slotNotes.map((note, index) =>
      buildNoteView(note, index, range, spellHere, columns[index])
    ),
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

/** How a pitch class is written, with the key and its scale already applied. */
type SpellPitchClass = (pitchClass: number) => SpelledNote;

/** Where one velocity bar sits along the lane. See `buildLaneColumns`. */
interface LaneColumn {
  beat: number;
  beats: number;
}

/**
 * Where each note's velocity bar goes: **one column per note, side by side, no
 * two of them sharing a pixel.**
 *
 * ## The bug this exists to make impossible
 *
 * A bar used to be drawn at its note's own beat and length, full height. That
 * reads as "one bar per note" and is not: `generateSlotNotes` gives every note
 * of a generated chord `startBeat: 0` and `lengthBeats: slot.lengthBeats`, so
 * for **every chord the generator produces** all the bars occupied exactly the
 * same rectangle. They painted over each other in DOM order, so the lane showed
 * the silhouette of whichever note happened to be loudest, and a press anywhere
 * in the lane went to the last note in the list - the only one the pointer could
 * reach. A user aiming at the root of a triad edited its fifth, silently.
 *
 * ## The rule, and why it is by construction rather than by care
 *
 * Notes are grouped by the beat they start on - exactly, because a chord's notes
 * share one and the model stores beats it was given. Each group is allotted the
 * span from its start to whichever comes first: the next start beat in the slot,
 * or the end of the group's **shortest** note. That span is then split into
 * equal columns, one per member, in the notes' own index order.
 *
 * Two properties fall out, and neither depends on the data:
 *
 *  - **Groups cannot overlap**, because a group's span is cut off at the next
 *    group's start. **Columns within a group cannot overlap**, because they are
 *    equal slices of one span. So every bar has a rectangle of its own, which is
 *    what makes `elementsFromPoint` at a bar's centre answer that bar.
 *  - **A bar never covers a beat its note is not sounding**, because the span
 *    stops at the shortest note in the group. The shortest and not the longest:
 *    a bar wide enough to be comfortable but sitting past the end of the note it
 *    edits would trade this bug for a quieter one.
 *
 * The cost is at the other end. A group of four notes all at the model's minimum
 * length gets columns a quarter of `MIN_NOTE_BEATS` wide - a pixel or two at the
 * roll's scale. That is thin, but it is thin *and distinct*, and a distinct
 * two-pixel bar is reachable where an overlapping fat one is not. It is also
 * already the limit of what the roll can draw at that zoom: the note itself is
 * at `.note`'s minimum width there.
 *
 * ## Why not the alternatives
 *
 * **A row per note** - the lane split into horizontal bands - separates them
 * just as reliably and costs the drag its resolution: `velocityScale` measures
 * the lane because floor-to-ceiling is the whole MIDI range, and a band a
 * quarter of the height makes one pixel of pointer travel worth nine MIDI units.
 * The correspondence a user can see is the whole reason the scale is measured
 * off the lane.
 *
 * **Columns across the whole lane**, one per note regardless of time, separates
 * them too and throws away the only thing that says which bar belongs to which
 * note - that it sits underneath it.
 */
function buildLaneColumns(notes: readonly RollNote[]): LaneColumn[] {
  const columns: LaneColumn[] = notes.map(note => ({
    beat: note.startBeat,
    beats: note.lengthBeats
  }));

  const starts = [...new Set(notes.map(note => note.startBeat))].sort((a, b) => a - b);

  starts.forEach((start, position) => {
    const members: number[] = [];
    let shortest = Infinity;
    notes.forEach((note, index) => {
      if (note.startBeat !== start) return;
      members.push(index);
      if (note.lengthBeats < shortest) shortest = note.lengthBeats;
    });

    // `Infinity` for the last group, which nothing starts after: the span is
    // then the shortest note's, which is what a lone note has always had.
    const next = position + 1 < starts.length ? starts[position + 1] : Infinity;
    const width = Math.min(next - start, shortest) / members.length;

    members.forEach((index, rank) => {
      columns[index] = { beat: start + rank * width, beats: width };
    });
  });

  return columns;
}

/**
 * How the selected slot's own chord spells each of its tones, by pitch class.
 *
 * A chord tone is written on the letter its *place in the chord* names - a third
 * two letters above the root, a seventh six - and that is a finer answer than
 * the scale's, which knows only which degree of the key a note is. The two
 * differ wherever a chord leaves the key: the ♯11 of a `Imaj13♯11` in C is an
 * F♯, and the scale has no F♯ to find a degree for, so it would fall back to the
 * key's preference and could print `Gb` under a numeral that says sharp eleven.
 *
 * Empty whenever there is no chord to ask - no slot, a `literal` slot, or a key
 * that cannot stack thirds - and then every note falls through to the scale,
 * which is what the roll did before this existed.
 *
 * **First spelling wins.** A stack can sound one pitch class twice, an octave
 * apart, on two different letters: a sus4 at extent 11 puts the suspended fourth
 * in position 1 and the eleventh in position 5. One row of the keyboard cannot
 * carry two names, so the lower position - which is the one the chord is built
 * on - keeps it.
 */
function chordToneSpellings(
  state: ProgressionState,
  slot: ChordSlot | null
): Map<number, SpelledNote> {
  const spellings = new Map<number, SpelledNote>();
  if (!slot || slot.harmony.kind !== 'degree') return spellings;
  if (!state.canBuildChords || !state.keyScale) return spellings;

  const key = state.doc.key;
  const scaleIntervals = state.keyScale.intervals;
  const degree = slot.harmony.degree;
  const chord = effectiveChord(scaleIntervals, degree);
  const root = chordRootSpelling(key, scaleIntervals, degree);

  chord.intervals.forEach((interval, i) => {
    const pitchClass = (((key.tonic + chord.root + interval) % 12) + 12) % 12;
    if (spellings.has(pitchClass)) return;

    // Null past a double accidental, and then this tone simply has no
    // chord-wise spelling - the scale's answer is the honest remainder, exactly
    // as it is for a root `chordRootSpelling` cannot spell.
    const spelled = spellAt(pitchClass, root, chord.steps[i]);
    if (spelled) spellings.set(pitchClass, spelled);
  });

  return spellings;
}

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
      name: formatNote(spell(pitchClass)),
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
  spell: SpellPitchClass,
  column: LaneColumn
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
    laneBeat: column.beat,
    laneBeats: column.beats,
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

/**
 * `C4`. The octave is numbered by the note's **letter** and not by its pitch.
 *
 * It used to be `Math.floor(midi / 12) - 1`, which is MIDI's own numbering and
 * which agreed with the letter's for as long as every name came out of a
 * twelve-name table. Degree-letter spelling breaks that at an octave boundary:
 * a C flat sounds a semitone below its C, so C♭5 is MIDI 71 and the MIDI sum
 * would print it `Cb4` - a C below the C it is a flattened form of. B♯3 is the
 * mirror case, MIDI 60. `scientificOctave` undoes the accidental first, which
 * is why it takes the spelling rather than only the number.
 */
function noteName(midi: number, spell: SpellPitchClass): string {
  const spelled = spell(pitchClassOf(midi));
  return `${formatNote(spelled)}${scientificOctave(midi, spelled)}`;
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
