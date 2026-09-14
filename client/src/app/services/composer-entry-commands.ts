import { DurationValue, EditCursor, NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';
import { clearToRests, deleteBeats, insertBeatAt, setBeatDurations } from './beat-edits';
import { CursorMove } from './composer-cursor';
import { beatAt, selectionTargets } from './composer-selection';
import { ComposerCommandHost } from './composer-service-structure';
import { editRefusal } from './edit-refusals';

/**
 * The composer's entry commands: writing a note, a rest or a delete at the caret, and the commands
 * M2's keyboard adds over the selection.
 *
 * Lifted out of `ComposerService` for the 1000-line cap, as `composer-service-structure.ts` was in
 * M1. The service owns the state, the history and the selection, exposes each command, and delegates
 * here; this class reaches it only through `ComposerEntryHost`.
 */

/** What the entry commands need from `ComposerService`, beyond what the structure commands need. */
export interface ComposerEntryHost extends ComposerCommandHost {
  /**
   * Runs `edit` on a clone and commits it with the caret where the command leaves it - or, when
   * `edit` returns a reason, publishes that and commits nothing. With `amend` the commit replaces the
   * last one rather than adding an undo step.
   */
  commit(edit: (draft: ScoreDoc) => string | null | void, amend?: boolean): void;
  /** Moves the caret, dropping any range. */
  moveCursor(move: CursorMove): void;
  /** Puts the caret at `cursor`, clamped, dropping any range. */
  select(cursor: Partial<EditCursor>): void;
}

/** Note entry and the selection commands M2 adds, run through a `ComposerEntryHost`. */
export class ComposerEntryCommands {
  /**
   * The last note entry, for `retypeNote`: where it was written, and the document it left. Held by
   * identity, so any later commit, undo or redo - each of which publishes a different document - means
   * the next retype is an edit of its own.
   */
  private lastEntry: { at: EditCursor; doc: ScoreDoc } | null = null;

  constructor(private readonly host: ComposerEntryHost) {}

  /** Writes a note at the caret, replacing any note already on that string, and by default advances. */
  setNoteAtCursor(pitch: NotePitch, advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => writeNote(draft, cursor, pitch, state.inputDuration, state.inputDots));
    this.lastEntry = { at: cursor, doc: this.host.state().doc };

    if (advance) this.host.moveCursor({ kind: 'beat', delta: 1 });
  }

  /**
   * Rewrites the note at `target` - the second digit of a two-digit fret, after the first digit's
   * `setNoteAtCursor` advanced the caret. The caret stays where it is.
   *
   * When nothing has been committed since that note was written at `target`, this replaces that
   * commit instead of adding one, so "1" then "2" is fret 12 and a single undo step takes it all back.
   * Otherwise it is an ordinary commit.
   */
  retypeNote(target: EditCursor, pitch: NotePitch): void {
    const state = this.host.state();
    if (this.refusesEntryAt(state.doc, target)) return;

    const last = this.lastEntry;
    const amend = last !== null && last.doc === state.doc && sameBeat(last.at, target);
    this.host.commit(draft => writeNote(draft, target, pitch, state.inputDuration, state.inputDots), amend);
    this.lastEntry = { at: target, doc: this.host.state().doc };
  }

  /** Turns the beat at the caret into a rest, and by default advances. */
  setRestAtCursor(advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => {
      const beat = beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
      setBeatDurations(draft, [cursor], state.inputDuration, state.inputDots);
    });

    if (advance) this.host.moveCursor({ kind: 'beat', delta: 1 });
  }

  /**
   * Clears the beat at the caret back to a rest.
   *
   * The slot is kept rather than removed: bars are pre-filled with a full measure of rests, so
   * deleting a note should empty its position, not shorten the bar.
   */
  deleteAtCursor(): void {
    const state = this.host.state();
    const cursor = state.cursor;
    if (this.refusesEntryAt(state.doc, cursor)) return;

    this.host.commit(draft => {
      const beat = beatAt(draft, cursor);
      if (!beat) return;
      beat.notes = [];
      beat.isRest = true;
    });
  }

  /** Clears every beat in the selection to a rest, keeping their values: R and Delete over a range. */
  clearSelectionToRests(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null);
    if (refusal) return this.host.refuse(refusal);
    this.host.commitFollowing(draft => clearToRests(draft, refs));
  }

  /** Inserts a rest at the input duration in front of the caret's beat, leaving the caret on it. See `insertBeatAt`. */
  insertBeat(): void {
    const state = this.host.state();
    if (this.refusesEntryAt(state.doc, state.cursor)) return;
    this.host.commit(draft => insertBeatAt(draft, state.cursor, state.inputDuration, state.inputDots));
  }

  /** Removes the selected beats, and puts the caret where the range began. See `deleteBeats`. */
  deleteBeats(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = editRefusal(state.doc, refs, { family: 'beat', key: 'duration' }, null);
    if (refusal) return this.host.refuse(refusal);
    this.host.commit(draft => deleteBeats(draft, refs));
    this.host.select(refs[0]);
  }

  /**
   * Whether note entry, rest entry or a delete at `cursor` is refused - on a generated track, or in a
   * second voice, which a click can reach in a loaded bar and bar filling cannot measure. Publishes
   * the reason and commits nothing, so a refusal costs no undo step and the caret does not advance. A
   * beat scope, not a note one: a delete on a rest clears nothing, and a note scope would refuse it as
   * a note tool on a rest.
   */
  private refusesEntryAt(doc: ScoreDoc, cursor: EditCursor): boolean {
    const refusal = editRefusal(doc, [cursor], { family: 'beat', key: 'duration' }, null);
    if (refusal) this.host.refuse(refusal);
    return refusal !== null;
  }
}

/** Whether two cursors name the same beat. */
function sameBeat(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex
  );
}

/**
 * Writes `pitch` into the beat at `cursor` at the input duration. On a fretted staff a string holds
 * one note, so a note already on that string is replaced; on a pitched staff the same pitch again
 * takes the note out, which is how a click on a notehead removes it.
 */
function writeNote(draft: ScoreDoc, cursor: EditCursor, pitch: NotePitch, duration: DurationValue, dots: number): void {
  const beat = beatAt(draft, cursor);
  if (!beat) return;

  // Length first, so the bar settles before the note lands. Settling only removes or inserts beats
  // after this one, so `beat` is still the caret's beat.
  setBeatDurations(draft, [cursor], duration, dots);
  beat.isRest = false;

  const note: NoteDoc = { pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };

  if (pitch.kind === 'fretted') {
    const existing = beat.notes.findIndex(n => n.pitch.kind === 'fretted' && n.pitch.string === pitch.string);
    if (existing >= 0) {
      beat.notes[existing] = note;
      return;
    }
  } else {
    const existing = beat.notes.findIndex(
      n => n.pitch.kind === 'pitched' && n.pitch.noteValue === pitch.noteValue && n.pitch.octave === pitch.octave
    );
    if (existing >= 0) {
      beat.notes.splice(existing, 1);
      beat.isRest = beat.notes.length === 0;
      return;
    }
  }

  beat.notes.push(note);
}
