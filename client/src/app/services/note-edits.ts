import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc } from '../models/composer.model';
import { toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';

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
  const single = refs.length === 1;
  return refs.flatMap(ref => {
    const beat = beatAt(doc, ref);
    if (!beat) return [];
    const fretted = (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) > 0;
    if (single && fretted && focus !== null) {
      return beat.notes.filter(note => note.pitch.kind === 'fretted' && note.pitch.string === focus + 1);
    }
    return beat.notes;
  });
}

/** Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value. */
export function toggleNoteEffect<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): void {
  const notes = notesAt(doc, refs, focus);
  const value = toggledValue(notes.map(note => note.effects[key]), on, off);
  for (const note of notes) note.effects[key] = structuredClone(value);
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
