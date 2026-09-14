import { AccidentalMode, NoteDoc, NoteLetter, ScoreDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';
import { drawnPitchClassOf, editRefusal } from './edit-refusals';
import { NoteTarget, noteTargetsAt } from './note-edits';
import { alterFor, forcedLetterOf, reduceToOctave } from './note-spelling';
import { STEP_SEMITONES } from './staff-pitch';

/**
 * Respell: writing a note another way without changing its pitch.
 *
 * Every spelling offered is one `forcedLetterOf` can name, which is the predicate the accidental
 * refusal checks and the mapper reads a letter back with - so a respelled note is never one that
 * refusal would have stopped.
 */

const LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** The accidental a letter needs, by its alteration in semitones. */
const MODE_BY_ALTER: ReadonlyMap<number, AccidentalMode> = new Map([
  [-2, 'doubleFlat'],
  [-1, 'flat'],
  [0, 'auto'],
  [1, 'sharp'],
  [2, 'doubleSharp']
]);

/** A pitched note's spellings in order: lowest letter, whose alteration is highest, first. */
const PITCHED_ORDER: readonly AccidentalMode[] = ['doubleSharp', 'sharp', 'auto', 'flat', 'doubleFlat'];

const WHITE_KEY = 'A natural note on a fretted staff is written one way here - respell swaps a black key between its sharp and its flat.';

const NATURAL_HARMONIC = "A natural harmonic's accidental cannot be forced yet, so it cannot be respelled.";

/**
 * The spellings of `pitchClass` respell cycles through, as the accidental each forces.
 *
 * On a fretted staff, a black key's sharp and flat, and nothing for a white key. On a pitched staff,
 * every spelling from a double sharp to a double flat that names the pitch, `auto` standing for the
 * natural letter of a white key.
 */
export function respellingsOf(pitchClass: number, fretted: boolean): AccidentalMode[] {
  const reduced = reduceToOctave(pitchClass);
  const white = STEP_SEMITONES.includes(reduced);
  if (fretted) return white ? [] : ['sharp', 'flat'];
  return PITCHED_ORDER.filter(mode => (mode === 'auto' ? white : forcedLetterOf(mode, reduced) !== undefined));
}

/**
 * The spelling `note` is drawn with now: a pitched note's letter, else its forced accidental, else what
 * alphaTab draws for `Default` - a white key's natural, or a black key sharp when the key signature has
 * no flats and flat when it has (`ModelUtils.computeAccidental`, `alphaTab.core.mjs` ~4571).
 *
 * A letter is read against the note's stored pitch, as the mapper reads it (`accidentalModeFor`), which
 * is the drawn pitch too unless the staff is transposed.
 */
function spellingOf(note: NoteDoc, pitchClass: number, fifths: number): AccidentalMode {
  if (note.pitch.kind === 'pitched' && note.pitch.letter) {
    return MODE_BY_ALTER.get(alterFor(note.pitch.noteValue, LETTERS.indexOf(note.pitch.letter))) ?? 'auto';
  }
  if (note.accidental !== 'auto') return note.accidental;
  if (STEP_SEMITONES.includes(reduceToOctave(pitchClass))) return 'auto';
  return fifths >= 0 ? 'sharp' : 'flat';
}

/**
 * `note`'s next spelling - its pitch and accidental - drawn from `pitchClass` in a key of `fifths`, or
 * null when it has none to move to. A pitched note gets the letter as well as the accidental, since the
 * mapper reads a letter first.
 *
 * On a `transposed` staff - one whose transpositions do not come to whole octaves - a pitched note gets
 * the accidental and no letter, as `setAccidental` does. The mapper reads a letter against the stored
 * pitch, so a letter chosen for the drawn pitch would name the wrong one; the accidental alone is checked
 * against the drawn pitch, as the accidental refusal checks it.
 */
export function respelledNote(
  note: NoteDoc,
  pitchClass: number,
  fifths: number,
  transposed = false
): Pick<NoteDoc, 'pitch' | 'accidental'> | null {
  const options = respellingsOf(pitchClass, note.pitch.kind === 'fretted');
  if (options.length === 0) return null;
  const next = options[(options.indexOf(spellingOf(note, pitchClass, fifths)) + 1) % options.length];
  if (note.pitch.kind === 'fretted') return { pitch: note.pitch, accidental: next };
  if (transposed) return { pitch: { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave }, accidental: next };

  const letter = next === 'auto' ? LETTERS[STEP_SEMITONES.indexOf(reduceToOctave(pitchClass))] : forcedLetterOf(next, pitchClass);
  return { pitch: { kind: 'pitched', noteValue: note.pitch.noteValue, octave: note.pitch.octave, letter }, accidental: next };
}

/** `target`'s next spelling in its own staff and key, or null. A fretted natural harmonic has none. */
function respellingOf(doc: ScoreDoc, target: NoteTarget): Pick<NoteDoc, 'pitch' | 'accidental'> | null {
  const staff = doc.tracks[target.ref.trackIndex]?.staves[target.ref.staffIndex];
  const bar = staff?.bars[target.ref.barIndex];
  if (!staff || !bar) return null;
  if (target.note.pitch.kind === 'fretted' && target.note.effects.harmonic === 'natural') return null;
  const transposed = reduceToOctave(staff.transpose + staff.displayTranspose) !== 0;
  return respelledNote(target.note, drawnPitchClassOf(staff, target.note.pitch), bar.keySignature.fifths, transposed);
}

/** Why a respell cannot apply to `refs`, or null: any note edit's refusal, or no note that can be respelled. */
export function respellRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus);
  if (refusal) return refusal;
  const targets = noteTargetsAt(doc, refs, focus);
  if (targets.some(target => respellingOf(doc, target) !== null)) return null;
  return targets.every(target => target.note.effects.harmonic === 'natural') ? NATURAL_HARMONIC : WHITE_KEY;
}

/** Respells every note the press means that can be, each by its own cycle. The rest are skipped. */
export function respellNotes(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  for (const target of noteTargetsAt(doc, refs, focus)) {
    const next = respellingOf(doc, target);
    if (!next) continue;
    target.note.pitch = next.pitch;
    target.note.accidental = next.accidental;
  }
}
