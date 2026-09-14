import { DurationValue, EditCursor, NoteDoc, NotePitch, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';
import { StaffEntry, staffEntryOf } from './pitch-on-strings';
import { CopiedBeats, copiedBeatsOf, pasteBeats } from './beat-clipboard';
import { clearToRests, deleteBeats, insertBeatAt, setBeatDots, setBeatDurations } from './beat-edits';
import { clampedCursor, movedCursor } from './composer-cursor';
import { BeatRef, beatAt, selectionTargets } from './composer-selection';
import { ComposerCommandHost, EditOutcome } from './composer-service-structure';
import { pasteNoticeOf } from './composer-text';
import { clearRefusal, deleteBeatsRefusal, dotsRefusal, editRefusal, entryValueOf, insertBeatRefusal, noteEntryRefusal } from './edit-refusals';
import { FermataDrops } from './fermata-settling';

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
  commit(edit: (draft: ScoreDoc) => EditOutcome, amend?: boolean): void;
  /** Remembers the note value and dots for the next note. Not an edit. */
  setInputDuration(duration: DurationValue, dots: number): void;
}

/** Note entry and the selection commands M2 adds, run through a `ComposerEntryHost`. */
export class ComposerEntryCommands {
  /**
   * The last note entry, for `retypeNote`: where it was written, and the document it left. Held by
   * identity, so any later commit, undo or redo - each of which publishes a different document - means
   * the next retype is an edit of its own.
   */
  private lastEntry: { at: EditCursor; doc: ScoreDoc } | null = null;

  /** What Copy or Cut last took. The composer's own clipboard: nothing outside the page reads a beat. */
  private clipboard: CopiedBeats | null = null;

  constructor(private readonly host: ComposerEntryHost) {}

  /**
   * Writes a note at the caret, replacing any note already on that string, and by default advances. At the input
   * duration - or at the beat's own value, over a beat in a closed tuplet group that the input duration would break
   * (`entryValueOf`).
   *
   * A pitch on a staff with a tuning - Pen's click on the notation - is written as a string and a fret, or takes out
   * the note already sounding it, and a pitch no free string reaches is refused (`staffEntryOf`).
   */
  setNoteAtCursor(pitch: NotePitch, advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    const value = entryValueOf(state.doc, cursor, state.inputDuration, state.inputDots);
    if (this.refusesEntryAt(state.doc, cursor, value)) return;
    const entry = this.entryAt(state.doc, cursor, pitch);
    if (!entry) return;

    this.commitEntry(draft => writeNote(draft, cursor, entry, value.duration, value.dots), cursor, advance);
    this.lastEntry = { at: cursor, doc: this.host.state().doc };
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
    const value = entryValueOf(state.doc, target, state.inputDuration, state.inputDots);
    if (this.refusesEntryAt(state.doc, target, value)) return;
    const entry = this.entryAt(state.doc, target, pitch);
    if (!entry) return;

    // Only a fret is built from digits. A pitched note written twice is two notes of a chord, and a note
    // on another string is another note, so neither replaces the last commit.
    const last = this.lastEntry;
    const amend = last !== null && last.doc === state.doc && pitch.kind === 'fretted' && sameString(last.at, target);
    this.host.commit(draft => writeNote(draft, target, entry, value.duration, value.dots), amend);
    this.lastEntry = { at: target, doc: this.host.state().doc };
  }

  /** Turns the beat at the caret into a rest, at the value a note would be written at (`entryValueOf`), and by default advances. */
  setRestAtCursor(advance: boolean): void {
    const state = this.host.state();
    const cursor = state.cursor;
    const value = entryValueOf(state.doc, cursor, state.inputDuration, state.inputDots);
    if (this.refusesEntryAt(state.doc, cursor, value)) return;

    this.commitEntry(
      draft => {
        const beat = beatAt(draft, cursor);
        if (!beat) return;
        beat.notes = [];
        beat.isRest = true;
        return setBeatDurations(draft, [cursor], value.duration, value.dots);
      },
      cursor,
      advance
    );
  }

  /**
   * Commits a note or rest written at `cursor`, and with `advance` moves the caret to the next beat and drops any range
   * in that same commit. A separate caret move would publish again and clear what the commit said - a fermata the
   * entry removed (`ComposerState.notice`). An entry that is refused never gets here: `refusesEntryAt` has said why
   * before the commit, and neither edit returns a reason.
   */
  private commitEntry(edit: (draft: ScoreDoc) => EditOutcome, cursor: EditCursor, advance: boolean): void {
    if (!advance) return this.host.commit(edit);
    this.host.commitFollowing(edit, draft => ({
      cursor: movedCursor(draft, clampedCursor(cursor, draft), { kind: 'beat', delta: 1 }),
      anchor: null
    }));
  }

  /**
   * Clears the beat at the caret back to a rest, as a clear over a range does (`clearToRests`).
   *
   * The slot is kept rather than removed: bars are pre-filled with a full measure of rests, so
   * deleting a note should empty its position, not shorten the bar. Refused as a clear is (`clearRefusal`).
   */
  deleteAtCursor(): void {
    const state = this.host.state();
    const cursor = state.cursor;
    const refusal = clearRefusal(state.doc, [cursor]);
    if (refusal) return this.host.refuse(refusal);

    this.host.commit(draft => clearToRests(draft, [cursor]));
  }

  /**
   * Dots every beat in the selection at its own value (`setBeatDots`), and remembers `dots` for the next
   * note beside the input duration. Refused as a duration press is (`dotsRefusal`), and like one it
   * still remembers the choice when refused.
   */
  applyDotsAtCursor(dots: number): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = dotsRefusal(state.doc, refs, dots);
    if (refusal) this.host.refuse(refusal);
    else this.host.commitFollowing(draft => setBeatDots(draft, refs, dots));
    this.host.setInputDuration(this.host.state().inputDuration, dots);
  }

  /** Clears every beat in the selection to a rest, keeping their values: R and Delete over a range. See `clearRefusal`. */
  clearSelectionToRests(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = clearRefusal(state.doc, refs);
    if (refusal) return this.host.refuse(refusal);
    this.host.commitFollowing(draft => clearToRests(draft, refs));
  }

  /**
   * Inserts a rest at the input duration in front of the caret's beat (see `insertBeatAt`), leaving the
   * caret on the new rest. A range's other end follows its beat, so the range still covers what it did.
   */
  insertBeat(): void {
    const state = this.host.state();
    const cursor = state.cursor;
    const refusal = insertBeatRefusal(state.doc, cursor, state.inputDuration, state.inputDots);
    if (refusal) return this.host.refuse(refusal);
    let inserted: number | null = null;
    this.host.commitFollowing(
      draft => {
        const result = insertBeatAt(draft, cursor, state.inputDuration, state.inputDots);
        inserted = result?.index ?? null;
        return result?.droppedFermatas;
      },
      (_draft, followed) => ({ cursor: { ...cursor, beatIndex: inserted ?? cursor.beatIndex }, anchor: followed.anchor })
    );
  }

  /** Removes the selected beats, and puts the caret where the range began, in one commit. See `deleteBeats`. */
  deleteBeats(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = deleteBeatsRefusal(state.doc, refs);
    if (refusal) return this.host.refuse(refusal);
    this.host.commitFollowing(
      draft => deleteBeats(draft, refs),
      () => ({ cursor: { ...state.cursor, ...refs[0] }, anchor: null })
    );
  }

  /** Copies the selection's beats, from one staff. Not an edit: nothing is committed. */
  copy(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    if (refs.length === 0) return this.host.refuse('Nothing is selected.');
    const copied = copiedBeatsOf(state.doc, refs);
    if (!copied) return this.host.refuse('Copy takes beats from one staff at a time.');
    this.clipboard = copied;
  }

  /** Copies the selection's beats and clears them to rests, as one undo step. Refused as a clear is (`clearRefusal`). */
  cut(): void {
    const state = this.host.state();
    const refs = selectionTargets(state.doc, state.anchor, state.cursor);
    const refusal = clearRefusal(state.doc, refs);
    if (refusal) return this.host.refuse(refusal);
    const copied = copiedBeatsOf(state.doc, refs);
    if (!copied) return this.host.refuse('Cut takes beats from one staff at a time.');
    this.clipboard = copied;
    this.host.commitFollowing(draft => clearToRests(draft, refs));
  }

  /**
   * Pastes the clipboard from the start of the selection - its first beat in timeline order, whichever
   * end moved - as one run (see `pasteBeats`), and leaves the caret on the first pasted beat with no
   * range: the beats the range named were written over.
   */
  paste(): void {
    const state = this.host.state();
    const clipboard = this.clipboard;
    if (!clipboard) return this.host.refuse('Nothing has been copied yet.');
    const start = selectionTargets(state.doc, state.anchor, state.cursor)[0];
    if (!start) return this.host.refuse('Nothing is selected.');
    if (this.refusesEntryAt(state.doc, start)) return;
    let pastedAt: BeatRef = start;
    let appended = 0;
    let written = 0;
    this.host.commitFollowing(
      draft => {
        const result = pasteBeats(draft, start, clipboard);
        if (typeof result === 'string') return result;
        pastedAt = result.at;
        appended = result.appendedBars;
        written = result.beatsWritten;
        if (result.appendedBars > 0) this.host.markDiverged(draft);
        return result.droppedFermatas;
      },
      () => ({ cursor: { ...state.cursor, ...pastedAt }, anchor: null }),
      () => pasteNoticeOf(written, appended)
    );
  }

  /**
   * Whether note entry, rest entry or a paste at `at` is refused - on a generated track, or in a second
   * voice, which a click can reach in a loaded bar and bar filling cannot measure. Publishes the reason and
   * commits nothing, so a refusal costs no undo step and the caret does not advance. A beat scope, not a note
   * one: a paste can land on a rest, and a note scope would refuse it as a note tool on a rest. A press that
   * `writes` a value - a note or a rest - is also refused where that value would break a tuplet group
   * (`noteEntryRefusal`).
   */
  /**
   * What writing `pitch` at `at` does (`staffEntryOf`), or null when it is refused - having published why, before any
   * commit, so a refusal costs no undo step and the caret does not advance - or there is no staff there.
   */
  private entryAt(doc: ScoreDoc, at: EditCursor, pitch: NotePitch): StaffEntry | null {
    const staff = doc.tracks[at.trackIndex]?.staves[at.staffIndex];
    if (!staff) return null;
    const entry = staffEntryOf(staff, beatAt(doc, at), pitch, at.stringIndex === null ? null : at.stringIndex + 1);
    if (typeof entry !== 'string') return entry;
    this.host.refuse(entry);
    return null;
  }

  private refusesEntryAt(doc: ScoreDoc, at: BeatRef, writes?: { duration: DurationValue; dots: number }): boolean {
    const refusal = writes
      ? noteEntryRefusal(doc, at, writes.duration, writes.dots)
      : editRefusal(doc, [at], { family: 'beat', key: 'duration' }, null);
    if (refusal) this.host.refuse(refusal);
    return refusal !== null;
  }
}

/** Whether two cursors name the same beat and the same string: where a two-digit fret is being typed. */
function sameString(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex &&
    a.stringIndex === b.stringIndex
  );
}

/**
 * Writes `entry` into the beat at `cursor` at the input duration. On a fretted staff a string holds
 * one note, so a note already on that string is replaced; on a pitched staff the same pitch again
 * takes the note out, which is how a click on a notehead removes it - and a `remove` entry, read from the
 * document before the commit (`staffEntryOf`), does that on a fretted staff.
 */
function writeNote(draft: ScoreDoc, cursor: EditCursor, entry: StaffEntry, duration: DurationValue, dots: number): FermataDrops {
  const beat = beatAt(draft, cursor);
  if (!beat) return [];

  // Length first, so the bar settles before the note lands. Settling only removes or inserts beats
  // after this one, so `beat` is still the caret's beat, and its notes are in the order `entry` read.
  const dropped = setBeatDurations(draft, [cursor], duration, dots);
  beat.isRest = false;

  if (entry.kind === 'remove') {
    beat.notes.splice(entry.index, 1);
    beat.isRest = beat.notes.length === 0;
    return dropped;
  }

  const pitch = entry.pitch;
  const note: NoteDoc = { pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };

  if (pitch.kind === 'fretted') {
    const existing = beat.notes.findIndex(n => n.pitch.kind === 'fretted' && n.pitch.string === pitch.string);
    if (existing >= 0) {
      beat.notes[existing] = note;
      return dropped;
    }
  } else {
    const existing = beat.notes.findIndex(
      n => n.pitch.kind === 'pitched' && n.pitch.noteValue === pitch.noteValue && n.pitch.octave === pitch.octave
    );
    if (existing >= 0) {
      beat.notes.splice(existing, 1);
      beat.isRest = beat.notes.length === 0;
      return dropped;
    }
  }

  beat.notes.push(note);
  return dropped;
}
