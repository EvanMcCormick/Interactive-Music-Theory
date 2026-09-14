import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { hammerDestinationOf, slideTargetOf } from './note-landing';

/**
 * Edits that act on notes: effects, accidentals and ties.
 *
 * Like the beat edits, these change the document they are given and trust the caller to
 * have asked `editRefusal` first - with the same `focus`, so the two agree about which
 * notes a press means.
 */

/**
 * The notes a press acts on.
 *
 * `focus` is `EditCursor.stringIndex`, 0-based. It narrows the press to one note only when
 * the selection is a single beat on a fretted staff - the design's "the clicked note in a
 * chord". A range, or a pitched staff, means every note: a pitched staff has no way to name
 * one note of a chord until M2's Pen gives a click a pitch.
 */
export function notesAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteDoc[] {
  return noteTargetsAt(doc, refs, focus).map(target => target.note);
}

/** A note a press means, and the beat it is on. */
export interface NoteTarget {
  ref: BeatRef;
  note: NoteDoc;
}

/** `notesAt`, keeping each note's beat: what a check that looks past the note - where it lands - needs. */
export function noteTargetsAt(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteTarget[] {
  const single = refs.length === 1;
  return refs.flatMap(ref => {
    const beat = beatAt(doc, ref);
    if (!beat) return [];
    const fretted = (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) > 0;
    const notes =
      single && fretted && focus !== null
        ? beat.notes.filter(note => note.pitch.kind === 'fretted' && note.pitch.string === focus + 1)
        : beat.notes;
    return notes.map(note => ({ ref, note }));
  });
}

/**
 * Whether `note` can hold `value` for `key`, or null when any note can: a hammer-on and a shift or
 * legato slide need somewhere to land (`note-landing.ts`), since alphaTab drops them otherwise.
 */
function landingOf<K extends keyof NoteEffectsDoc>(key: K, value: NoteEffectsDoc[K]): ((doc: ScoreDoc, ref: BeatRef, note: NoteDoc) => NoteDoc | null) | null {
  if (key === 'isHammerPullOrigin' && value === true) return hammerDestinationOf;
  if (key === 'slide' && (value === 'shiftSlide' || value === 'legatoSlide')) return slideTargetOf;
  return null;
}

/**
 * The notes a press of `key` with `on` reads and sets: the notes it means that can hold `on`, or all
 * of them when none can - which `noteEffectRefusal` refuses unless the press clears.
 */
export function noteEffectTargets<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K]
): NoteTarget[] {
  const all = noteTargetsAt(doc, refs, focus);
  const lands = landingOf(key, on);
  if (!lands) return all;
  const landing = all.filter(target => lands(doc, target.ref, target.note) !== null);
  return landing.length > 0 ? landing : all;
}

/**
 * Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value.
 *
 * The rule reads the notes that can hold the value (`noteEffectTargets`), so a range ending on a note
 * with nothing to land on still turns a hammer-on off once every other note has one. Turning on writes
 * only those notes; a clear writes every note the press means.
 */
export function toggleNoteEffect<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): void {
  const targets = noteEffectTargets(doc, refs, focus, key, on);
  const value = toggledValue(targets.map(target => target.note.effects[key]), on, off);
  const written = value === on ? targets : noteTargetsAt(doc, refs, focus);
  for (const { note } of written) note.effects[key] = structuredClone(value);
}

/**
 * Forces an accidental, or returns the notes to `auto`.
 *
 * A pitched note's `letter` overrules `accidental` in the mapper, so an explicit choice
 * drops the letter - otherwise the press would visibly do nothing on any note read back
 * from a file, which carries a letter derived from its forced mode.
 */
export function setAccidental(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  accidental: AccidentalMode
): void {
  for (const note of notesAt(doc, refs, focus)) {
    note.accidental = accidental;
    if (note.pitch.kind === 'pitched') {
      note.pitch = { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave };
    }
  }
}

/** Presses the tie tool: `isTied` marks the note a tie arrives at. */
export function toggleTie(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  const notes = notesAt(doc, refs, focus);
  const value = toggledValue(notes.map(note => note.isTied), true, false);
  for (const note of notes) note.isTied = value;
}
