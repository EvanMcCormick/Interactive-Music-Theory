import { AccidentalMode, NoteDoc, NoteEffectsDoc, ScoreDoc, StaffDoc } from '../models/composer.model';
import { canonicalJsonOf, toggledValue } from './beat-edits';
import { DEFAULT_TRILL_SPEED, TRILL_INTERVAL } from './composer-tool-defaults';
import { BeatRef, beatAt } from './composer-selection';
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';

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
 *
 * Vibrato skips a tied continuation, whose own vibrato alphaTab never draws or plays - it takes its
 * origin's (`tieOriginOf`) - so a phrase with a tie in it takes vibrato on the notes that carry it.
 */
export function noteEffectTargets<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K]
): NoteTarget[] {
  const all = noteTargetsAt(doc, refs, focus);
  const holds = holdingOf(key, on);
  if (!holds) return all;
  const holding = all.filter(target => holds(doc, target.ref, target.note));
  return holding.length > 0 ? holding : all;
}

/** Which notes can hold `value` for `key`, or null when any note can. */
function holdingOf<K extends keyof NoteEffectsDoc>(key: K, value: NoteEffectsDoc[K]): ((doc: ScoreDoc, ref: BeatRef, note: NoteDoc) => boolean) | null {
  if (key === 'vibrato') return (doc, ref, note) => tieOriginOf(doc, ref, note) === null;
  const lands = landingOf(key, value);
  return lands ? (doc, ref, note) => lands(doc, ref, note) !== null : null;
}

/**
 * Presses a note effect tool, by the toggle rule. Each note gets its own copy of the value.
 *
 * The rule reads the notes that can hold the value (`noteEffectTargets`), so a range ending on a note
 * with nothing to land on still turns a hammer-on off once every other note has one. Turning on writes
 * only those notes. A clear writes those, and every other note the press means that holds exactly the
 * value pressed - a stale hammer-on with nothing to land on, a tied continuation's own vibrato - but
 * never a note holding a different value: Shift slide over a phrase that ends in a slide out leaves the
 * slide out.
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
  const pressed = canonicalJsonOf(on);
  const written =
    value === on
      ? targets.map(target => target.note)
      : [
          ...new Set([
            ...targets.map(target => target.note),
            ...notesAt(doc, refs, focus).filter(note => canonicalJsonOf(note.effects[key]) === pressed)
          ])
        ];
  for (const note of written) note.effects[key] = structuredClone(value);
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

/**
 * The notes a tie press reads and sets: the notes it means that have a note to tie from
 * (`tieCandidateOf`), or all of them when none has - which `tieRefusal` refuses unless the press unties.
 * alphaTab clears a tie with no origin, so a range skips its first notes as a hammer-on skips its last.
 */
export function tieTargetsOf(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteTarget[] {
  const all = noteTargetsAt(doc, refs, focus);
  const tying = all.filter(target => tieCandidateOf(doc, target.ref, target.note) !== null);
  return tying.length > 0 ? tying : all;
}

/**
 * Presses the tie tool: `isTied` marks the note a tie arrives at. By the toggle rule over `tieTargetsOf`;
 * an untie also reaches every other tied note the press means.
 */
export function toggleTie(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  const targets = tieTargetsOf(doc, refs, focus).map(target => target.note);
  const value = toggledValue(targets.map(note => note.isTied), true, false);
  const written = value ? targets : [...new Set([...targets, ...notesAt(doc, refs, focus).filter(note => note.isTied)])];
  for (const note of written) note.isTied = value;
}

/**
 * The pitch a default trill on `note` alternates with, as `TrillDoc.value` stores it - alphaTab's
 * `Note.trillValue`, a MIDI number: a whole step above the note as it sounds. On a string that is the
 * open string plus the capo plus the fret, since alphaTex saves a trill as a fret relative to the
 * string with the capo included (`trillFret`); on a pitched staff, the note's own pitch.
 */
export function trillTargetOf(staff: StaffDoc, note: NoteDoc): number {
  const pitch = note.pitch;
  const sounding =
    pitch.kind === 'fretted'
      ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
      : (pitch.octave + 1) * 12 + pitch.noteValue;
  return sounding + TRILL_INTERVAL;
}

/**
 * Presses the trill tool, by the toggle rule: when every note the press means has a trill they all lose
 * it; otherwise each gets a trill a whole step above itself (`trillTargetOf`) at the default speed.
 *
 * Not `toggleNoteEffect`, whose one value for every note would trill a chord's notes to one pitch.
 */
export function toggleTrill(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): void {
  const targets = noteTargetsAt(doc, refs, focus);
  const allOn = targets.length > 0 && targets.every(target => target.note.effects.trill !== null);
  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    note.effects.trill = allOn || !staff ? null : { value: trillTargetOf(staff, note), speed: DEFAULT_TRILL_SPEED };
  }
}
