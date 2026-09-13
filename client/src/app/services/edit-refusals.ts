import { AccidentalMode, NoteEffectsDoc, NotePitch, ScoreDoc, StaffDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';
import { notesAt } from './note-edits';
import { forcedLetterOf, reduceToOctave } from './note-spelling';

/**
 * What kind of edit is being asked about.
 *
 * An accidental press is a variant of its own that must say which accidental it would
 * force, so the refusal can check that accidental can spell every note. With the field
 * optional on one shared note variant, a caller could leave it out and skip the check
 * without a compile error; as its own variant, `{ family: 'note', key: 'accidental' }`
 * does not type-check.
 *
 * `forcedLetterOf` comes from `note-spelling.ts`, not the mapper: this module stays pure,
 * and importing an `@Injectable` service file would pull alphaTab in with it.
 */
export type EditScope =
  | { family: 'beat' }
  | { family: 'note'; key: keyof NoteEffectsDoc | 'tie' }
  | { family: 'note'; key: 'accidental'; accidental: AccidentalMode }
  | { family: 'track'; trackIndex: number };

/** Techniques that only mean something on a string. */
const FRETTED_ONLY: ReadonlySet<string> = new Set(['bendPoints', 'slide', 'isLeftHandTapped', 'harmonic']);

const GENERATED =
  'That reaches a track generated from a progression. Flatten the track to edit it by hand.';

const UNSPELLABLE = 'That accidental cannot spell this note - it would be drawn on the wrong line.';

const NATURAL_HARMONIC = "A natural harmonic's accidental cannot be forced yet.";

/**
 * The pitch class alphaTab draws a note from, before a forced accidental shifts it.
 *
 * `AccidentalHelper.getNoteValue` (`alphaTab.core.mjs` ~24936 in 1.8) starts from
 * `Note.displayValue`: `realValue` less the staff's display transposition (~6215), moved by
 * whole octaves for an ottava, which leaves the pitch class alone. `realValue` is
 * `fret + stringTuning` on a string (~6071) and `octave * 12 + tone` otherwise (~6074), less
 * the staff's transposition - and `Note.stringTuning` is the capo plus the string's tuning
 * (~6032). So a capo moves the drawn note exactly as it moves the sounding one.
 *
 * Two parts of `displayValue` are left out. A pre-bend adds its initial bend, but
 * `Note.finish` resets a forced accidental on a pre-bent note (~6473), so nothing is drawn
 * wrong there. A natural harmonic is not drawn at its fret at all: `calculateRealValue`
 * puts it at `harmonicPitch` above the open string, capo included (~6059), and
 * `harmonicPitch` (~6078) reads `Note.harmonicValue`, which the mapper does not write. At
 * alphaTab's default of 0 that is 0, so a natural harmonic is drawn at the open string's
 * pitch whatever the fret. This function would read the fret, so `editRefusal` refuses a
 * forced accidental on a fretted natural harmonic before it asks. Both of those alphaTab
 * branches test `isStringed`, so a pitched note marked natural is drawn at its own pitch
 * and is read correctly here.
 */
function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
  const sounding =
    pitch.kind === 'fretted'
      ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
      : pitch.noteValue;
  return reduceToOctave(sounding - staff.transpose - staff.displayTranspose);
}

/**
 * Whether forcing `accidental` would leave any note a press means without a letter.
 *
 * One ref at a time, because the pitch class depends on each note's staff. The focus
 * narrows only a single-beat selection, as it does in `notesAt`.
 */
function anyNoteUnspellable(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  accidental: AccidentalMode
): boolean {
  const narrowed = refs.length === 1 ? focus : null;
  return refs.some(ref => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return (
      staff !== undefined &&
      notesAt(doc, [ref], narrowed).some(
        note => forcedLetterOf(accidental, drawnPitchClassOf(staff, note.pitch)) === undefined
      )
    );
  });
}

/**
 * Why an edit cannot apply to `refs`, or null when it can.
 *
 * Whole or nothing: one generated track anywhere in a range refuses the entire press, so a
 * range is never half-edited. `focus` must be the same one the edit will use, so this and
 * `notesAt` agree about which notes a press means.
 *
 * A forced accidental that cannot name one of its notes is refused rather than set to
 * `auto`: alphaTab would draw that note on a line chosen by the key signature while it
 * sounds right. The check is `forcedLetterOf`, the predicate the mapper reads a letter back
 * with, but not asked of the same pitch. The mapper asks it of a pitched note's stored
 * pitch class, with no transposition applied; this asks it of the pitch as drawn,
 * transposition and display transposition included. The two agree whenever a staff's
 * transpositions come to a whole number of octaves. A natural harmonic is refused outright:
 * see `drawnPitchClassOf`.
 */
export function editRefusal(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  scope: EditScope,
  focus: number | null
): string | null {
  if (scope.family === 'track') {
    return doc.tracks[scope.trackIndex]?.generated ? GENERATED : null;
  }
  if (refs.length === 0) return 'Nothing is selected.';
  if (refs.some(ref => doc.tracks[ref.trackIndex]?.generated)) return GENERATED;
  if (scope.family === 'beat') return null;

  const onPitchedStaff = refs.some(
    ref => (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) === 0
  );
  if (FRETTED_ONLY.has(scope.key) && onPitchedStaff) {
    return 'Bends, slides, taps and harmonics belong to fretted staves.';
  }
  const notes = notesAt(doc, refs, focus);
  if (notes.length === 0) return 'There is no note there to change.';
  // Fretted notes only. alphaTab moves a natural harmonic off its fret only on a stringed
  // note: `calculateRealValue`'s harmonic branch and `harmonicPitch` both test `isStringed`
  // (`Note.string >= 0`, ~5677; ~6053-6090), and the mapper sets `string` only for a fretted
  // pitch, so a pitched note keeps its default of -1. A pitched note marked natural - which
  // an alphaTex import can produce - is drawn at its own pitch, and the spelling check
  // below reads it correctly.
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    notes.some(note => note.pitch.kind === 'fretted' && note.effects.harmonic === 'natural')
  ) {
    return NATURAL_HARMONIC;
  }
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    anyNoteUnspellable(doc, refs, focus, scope.accidental)
  ) {
    return UNSPELLABLE;
  }
  return null;
}
