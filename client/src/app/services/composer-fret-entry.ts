import type { ComposerService } from './composer.service';
import { EditCursor, ScoreDoc } from '../models/composer.model';

/**
 * Fret digits typed onto the caret's string, as in Guitar Pro.
 *
 * The first digit writes a note and advances the caret, so a melody flows. A further digit within the
 * window belongs to the same number and rewrites that note through `retypeNote` - "1" then "2" gives
 * fret 12 on one beat, as one undo step - and the caret stays where the first digit left it. A digit
 * that would take the number off the fretboard starts a new note rather than being clamped, and so does
 * one after the caret moved, however it moved, or after the document changed - an undo, a redo, any
 * other edit - since the note the first digit wrote may no longer be there. A leading 0 is a fret of its
 * own: no fret is written "05", so "0" then "5" are two notes.
 *
 * Lifted out of `ComposerComponent`, which kept the buffer in fields and rewrote the note by moving the
 * caret back and forth - two commits, so undo left the first digit's fret behind.
 */
export class FretDigitEntry {
  /** Highest fret the digits build up to. */
  static readonly MAX_FRET = 24;
  /** How long after a digit the next one still continues its number, in milliseconds. */
  static readonly WINDOW_MS = 800;

  /** The number being typed: its digits, where it was written, where the caret was left, the document it left, and when. */
  private typing: { digits: string; target: EditCursor; leftAt: EditCursor; doc: ScoreDoc; at: number } | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly now: () => number = () => Date.now(),
    private readonly audition: (midi: number) => void = () => undefined
  ) {}

  /** Types `digit` at the caret. Nothing happens on a pitched staff, which has no frets. */
  type(digit: number): void {
    const state = this.composer.state;
    const staff = this.composer.staffAt(state.doc, state.cursor);
    if (!staff || staff.tuning.length === 0) return;

    const now = this.now();
    const typing = this.typing;
    const combined = typing ? Number(typing.digits + digit) : Number.NaN;
    const continuing =
      typing !== null &&
      typing.digits !== '0' &&
      state.doc === typing.doc &&
      now - typing.at <= FretDigitEntry.WINDOW_MS &&
      combined <= FretDigitEntry.MAX_FRET &&
      sameBeat(state.cursor, typing.leftAt);

    if (continuing) {
      const string = (typing.target.stringIndex ?? 0) + 1;
      this.composer.retypeNote(typing.target, { kind: 'fretted', string, fret: combined });
      this.typing = { ...typing, digits: String(combined), doc: this.composer.state.doc, at: now };
      this.audition((staff.tuning[string - 1] ?? 0) + staff.capo + combined);
      return;
    }

    const target = state.cursor;
    const string = (target.stringIndex ?? 0) + 1;
    this.composer.setNoteAtCursor({ kind: 'fretted', string, fret: digit }, true);
    this.typing = { digits: String(digit), target, leftAt: this.composer.state.cursor, doc: this.composer.state.doc, at: now };
    this.audition((staff.tuning[string - 1] ?? 0) + staff.capo + digit);
  }
}

/** Whether two cursors name the same beat and string. */
function sameBeat(a: EditCursor, b: EditCursor): boolean {
  return (
    a.trackIndex === b.trackIndex &&
    a.staffIndex === b.staffIndex &&
    a.barIndex === b.barIndex &&
    a.voiceIndex === b.voiceIndex &&
    a.beatIndex === b.beatIndex &&
    a.stringIndex === b.stringIndex
  );
}
