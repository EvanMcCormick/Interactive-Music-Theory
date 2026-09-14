import { AccidentalMode, BeatEffectsDoc, NoteEffectsDoc, NotePitch, ScoreDoc, StaffDoc } from '../models/composer.model';
import { fermataPositionsOf, toggledValue } from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { noteEffectTargets, noteTargetsAt, notesAt } from './note-edits';
import { hammerDestinationOf, slideTargetOf, tieOriginOf } from './note-landing';
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
 * A beat edit names what it changes for the same reason: some beat effects belong to strings,
 * and a scope that could leave the key out could skip that check.
 *
 * `forcedLetterOf` comes from `note-spelling.ts`, not the mapper: this module stays pure,
 * and importing an `@Injectable` service file would pull alphaTab in with it.
 */
export type EditScope =
  | { family: 'beat'; key: keyof BeatEffectsDoc | 'duration' | 'dynamics' | 'tuplet' }
  | { family: 'note'; key: keyof NoteEffectsDoc | 'tie' }
  // A press that needs only notes to act on - a clear, a respell, a move of pitch or string. Refused
  // where any note edit is, never as a fretted-only technique: clearing one from a pitched note removes
  // what alphaTab cannot use there, and the moves say for themselves what does not fit.
  | { family: 'note'; key: 'notes' }
  | { family: 'note'; key: 'accidental'; accidental: AccidentalMode }
  | { family: 'track'; trackIndex: number };

/** Note techniques that only mean something on a string. */
const FRETTED_ONLY_NOTE: ReadonlySet<string> = new Set(['bendPoints', 'slide', 'isLeftHandTapped', 'harmonic']);

/**
 * Beat techniques that only mean something on a string: a tap, a slap and a pop.
 *
 * Palm mute and let ring stay allowed on a pitched staff. Design Part 4 names bend, slide, tap
 * and harmonics as the fretted-only techniques, and alphaTab draws both from their flags with no
 * string needed (`PalmMuteEffectInfo`, `alphaTab.core.mjs` ~60249, reads `note.isPalmMute`;
 * `LetRingEffectInfo` ~59704 reads `beat.isLetRing`).
 */
const FRETTED_ONLY_BEAT: ReadonlySet<string> = new Set(['tap', 'slap', 'pop']);

const FRETTED = 'Bends, slides, taps, slap, pop and harmonics belong to fretted staves.';

const GENERATED =
  'That reaches a track generated from a progression. Flatten the track to edit it by hand.';

const SECOND_VOICE = 'Editing a second voice is not available yet.';

const UNSPELLABLE = 'That accidental cannot spell a note in the selection - it would be drawn on the wrong line.';

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
export function drawnPitchClassOf(staff: StaffDoc, pitch: NotePitch): number {
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
 * Voice 1 only. Bar filling measures a bar's first voice (`barFillOf`), so an edit to another
 * could not keep its bar honest; any ref in a later voice refuses the press, until multiple
 * voices are designed.
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
  if (refs.some(ref => ref.voiceIndex > 0)) return SECOND_VOICE;

  const onPitchedStaff = refs.some(
    ref => (doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.tuning.length ?? 0) === 0
  );
  if (scope.family === 'beat') {
    return FRETTED_ONLY_BEAT.has(scope.key) && onPitchedStaff ? FRETTED : null;
  }
  if (FRETTED_ONLY_NOTE.has(scope.key) && onPitchedStaff) return FRETTED;
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

const GRACE_FERMATA = 'A grace note has no bar position of its own, so a fermata goes on the beat it leads into.';

/**
 * Why a fermata press cannot apply to `refs`, or null: any beat edit's refusal, or no bar position to put
 * it at. A grace takes no ticks, so a selection of graces alone names no position (`fermataPositionsOf`),
 * and a press there would commit an undo step that changed nothing.
 */
export function fermataRefusal(doc: ScoreDoc, refs: readonly BeatRef[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'fermata' }, null);
  if (refusal) return refusal;
  return fermataPositionsOf(doc, refs).length === 0 ? GRACE_FERMATA : null;
}

const GRACE_DURATION =
  "A grace note's written value is set by alphaTab from how many graces are in its group, so it cannot be changed.";

/**
 * Why a duration press cannot apply to `refs`, or null when it can: any beat edit's refusal, or
 * every target a grace beat.
 *
 * `Beat.finish` (`alphaTab.core.mjs` ~7772-7786 in 1.8) rewrites an on-beat or before-beat grace's
 * value by the size of its group - an eighth for one grace, a sixteenth for two, a thirty-second for
 * three or more - so a value set on one is drawn as alphaTab's and lost on save. `setBeatDurations`
 * skips graces for that reason; a press with nothing else to change is refused rather than skipped,
 * so it says why nothing happened. A range with some graces in it changes the rest.
 */
export function durationRefusal(doc: ScoreDoc, refs: readonly BeatRef[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  const allGraces = refs.every(ref => (beatAt(doc, ref)?.effects.grace ?? 'none') !== 'none');
  return allGraces ? GRACE_DURATION : null;
}

const HAMMER_ON_NOTHING_FOLLOWS =
  'A hammer-on or pull-off needs a note to land on - on the same string, or a left-hand tap on another - later in the bar ' +
  "or on the next bar's first beat. With nothing to land on it would not save.";

const SLIDE_NOTHING_FOLLOWS =
  "A shift or legato slide needs a note on the same string later in the bar or on the next bar's first beat. " +
  'With nothing to land on it would not save.';

const HAMMER_ON_PITCHED = 'A hammer-on or pull-off lands on a string, so it belongs to fretted staves.';

const VIBRATO_ON_TIE = 'Vibrato on a tied note belongs to the note it is tied from.';

/**
 * Why pressing a note effect tool - `key` set to `on`, by the toggle rule, or cleared to `off` - cannot
 * apply to `refs`, or null when it can.
 *
 * - A clear is refused only where any note edit is: nothing selected, a generated track, a second
 *   voice, no note (the `notes` scope). A fretted-only technique can be cleared from a pitched note.
 * - Turning an effect on is refused as `editRefusal` refuses it, and also when no note it means can
 *   hold it: a hammer-on, or a shift or legato slide, with nothing to land on. A range skips the notes
 *   that cannot land (`noteEffectTargets`).
 * - Vibrato on a tied note is refused either way. alphaTab draws and plays a tie destination with its
 *   origin's vibrato (`tieOriginOf`), so a continuation's own value changes nothing anyone can see or
 *   hear - and writing one stops alphaTab carrying a bend across the tie.
 */
export function noteEffectRefusal<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K]
): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus);
  if (refusal) return refusal;

  const all = noteTargetsAt(doc, refs, focus);
  if (key === 'vibrato' && all.some(target => tieOriginOf(doc, target.ref, target.note) !== null)) return VIBRATO_ON_TIE;

  const targets = noteEffectTargets(doc, refs, focus, key, on);
  if (toggledValue(targets.map(target => target.note.effects[key]), on, off) !== on) return null;

  const scoped = editRefusal(doc, refs, { family: 'note', key }, focus);
  if (scoped) return scoped;

  // Nothing to land on: no note the press means has a destination, so `noteEffectTargets` fell back to
  // all of them. A pitched note never has one, so a press on pitched notes alone is told why.
  if (key === 'isHammerPullOrigin' && !all.some(target => hammerDestinationOf(doc, target.ref, target.note))) {
    return all.every(target => target.note.pitch.kind === 'pitched') ? HAMMER_ON_PITCHED : HAMMER_ON_NOTHING_FOLLOWS;
  }
  if (key === 'slide' && (on === 'shiftSlide' || on === 'legatoSlide') && !all.some(target => slideTargetOf(doc, target.ref, target.note))) {
    return SLIDE_NOTHING_FOLLOWS;
  }
  return null;
}
