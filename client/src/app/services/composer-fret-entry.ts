import type { ComposerService } from './composer.service';
import { EditCursor, ScoreDoc } from '../models/composer.model';
import { writeSounds } from './composer-score-interaction';
import { MAX_FRET, soundingMidiOf } from './pitch-on-strings';

/**
 * Fret digits typed onto the caret's string, as in Guitar Pro.
 *
 * The first digit writes a note and advances the caret, so a melody flows. A further digit within the
 * window belongs to the same number and rewrites that note through `retypeNote` - "1" then "2" gives
 * fret 12 on one beat, as one undo step - and the caret stays where the first digit left it. A digit
 * that would take the number past the neck's 24 frets starts a new note rather than being clamped, and so does
 * one after the caret moved, however it moved, or after the document changed - an undo, a redo, any
 * other edit - since the note the first digit wrote may no longer be there. A leading 0 is a fret of its
 * own: no fret is written "05", so "0" then "5" are two notes. A number on the neck but past the frets in front of
 * a capo - 20 with the capo at 5 - is refused with the range (`maxFretOf`, through `staffEntryOf`), and the note
 * keeps its first digit's fret.
 *
 * Lifted out of `ComposerComponent`, which kept the buffer in fields and rewrote the note by moving the
 * caret back and forth - two commits, so undo left the first digit's fret behind.
 */
export class FretDigitEntry {
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
      combined <= MAX_FRET &&
      sameBeat(state.cursor, typing.leftAt);

    // A refused write - a tuplet it would break, a generated track - says why on the status line and keeps the document,
    // and a fret that was not written must not be heard (`writeSounds`).
    const before = state.doc;

    if (continuing) {
      const string = (typing.target.stringIndex ?? 0) + 1;
      this.composer.retypeNote(typing.target, { kind: 'fretted', string, fret: combined });
      this.typing = { ...typing, digits: String(combined), doc: this.composer.state.doc, at: now };
      if (writeSounds(before, this.composer.state.doc)) this.audition(soundingMidiOf(staff, { kind: 'fretted', string, fret: combined }));
      return;
    }

    const target = state.cursor;
    const string = (target.stringIndex ?? 0) + 1;
    this.composer.setNoteAtCursor({ kind: 'fretted', string, fret: digit }, true);
    this.typing = { digits: String(digit), target, leftAt: this.composer.state.cursor, doc: this.composer.state.doc, at: now };
    if (writeSounds(before, this.composer.state.doc)) this.audition(soundingMidiOf(staff, { kind: 'fretted', string, fret: digit }));
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
