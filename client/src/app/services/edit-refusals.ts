import {
  AccidentalMode,
  BeatDoc,
  BeatEffectsDoc,
  DurationValue,
  NoteEffectsDoc,
  NotePitch,
  ScoreDoc,
  StaffDoc,
  Tuplet
} from '../models/composer.model';
import { hasTuplet } from './bar-fill';
import {
  OpenTupletGroup,
  beatsAt,
  deleteBeats,
  fermataPositionsOf,
  insertBeatAt,
  newOpenTupletGroup,
  openTupletGroupsOf,
  setBeatDots,
  setBeatDurations,
  setGrace,
  setTuplet,
  toggledValue,
  tupletGroupsOf
} from './beat-edits';
import { BeatRef, beatAt } from './composer-selection';
import { NoteTarget, noteEffectTargets, noteTargetsAt, tieTargetsOf, trillTargetOf } from './note-edits';
import { hammerDestinationOf, slideTargetOf, tieCandidateOf, tieOriginOf } from './note-landing';
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
 * Whether forcing `accidental` would leave any of `targets` - the notes a press means - without a letter.
 * Each note is read on its own staff, because the pitch class depends on it.
 */
function anyNoteUnspellable(doc: ScoreDoc, targets: readonly NoteTarget[], accidental: AccidentalMode): boolean {
  return targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return staff !== undefined && forcedLetterOf(accidental, drawnPitchClassOf(staff, note.pitch)) === undefined;
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
 *
 * `notes`, when given, are the notes the press means (`noteTargetsAt` for `refs` and `focus`), already
 * read - so `toolStates`, asking every tool's refusal of one selection, reads them once. The refusals
 * below that look at notes take the same optional argument.
 */
export function editRefusal(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  scope: EditScope,
  focus: number | null,
  notes?: readonly NoteTarget[]
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
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
  if (targets.length === 0) return 'There is no note there to change.';
  // Fretted notes only. alphaTab moves a natural harmonic off its fret only on a stringed
  // note: `calculateRealValue`'s harmonic branch and `harmonicPitch` both test `isStringed`
  // (`Note.string >= 0`, ~5677; ~6053-6090), and the mapper sets `string` only for a fretted
  // pitch, so a pitched note keeps its default of -1. A pitched note marked natural - which
  // an alphaTex import can produce - is drawn at its own pitch, and the spelling check
  // below reads it correctly.
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    targets.some(({ note }) => note.pitch.kind === 'fretted' && note.effects.harmonic === 'natural')
  ) {
    return NATURAL_HARMONIC;
  }
  if (
    scope.key === 'accidental' &&
    scope.accidental !== 'auto' &&
    anyNoteUnspellable(doc, targets, scope.accidental)
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

const NOTHING_TO_TIE_FROM =
  'A tie needs an earlier note to tie from - on the same string, or of the same pitch on a pitched staff - within ' +
  'three bars. There is nothing there to tie from, so it would not save.';

/**
 * Why a tie press cannot apply to `refs`, or null: any tie edit's refusal, or - when the press would tie -
 * no note it means having a note to tie from (`tieTargetsOf`).
 *
 * alphaTab looks for a tie's origin up to three bars back on the same string, or the same pitch, and
 * clears the tie when it finds none (`Note.finish` and `findTieOrigin`, `alphaTab.core.mjs` ~6530,
 * ~6612) - earlier bars are already chained when a note finishes, so the reach is the whole three bars,
 * as `note-landing.spec.ts` pins. An untie is never refused for it.
 */
export function tieRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, notes?: readonly NoteTarget[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'tie' }, focus, notes);
  if (refusal) return refusal;
  const targets = tieTargetsOf(doc, refs, focus, notes);
  if (!toggledValue(targets.map(target => target.note.isTied), true, false)) return null;
  return targets.some(target => tieCandidateOf(doc, target.ref, target.note) !== null) ? null : NOTHING_TO_TIE_FROM;
}

const COUNT_WORDS: readonly string[] = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const BREAKS_A_GROUP = 'That would break a tuplet group; select the whole group.';

const INSERT_BREAKS_A_GROUP = 'That would break a tuplet group; insert before or after the whole group.';

const NOTE_BREAKS_A_GROUP = "A note of that value would break a tuplet group; write the group's own value, or change the whole group.";

const GRACE_TUPLET = 'A grace note takes no room in its bar, so it cannot be under a tuplet.';

/** A tuplet group an edit, made on a copy, would leave open (`tupletGroupOpenedBy`). */
interface OpenedGroup {
  group: OpenTupletGroup;
  /** The voice it is in, once the edit is made. */
  after: readonly BeatDoc[];
  /** The groups that voice already held open. */
  before: readonly OpenTupletGroup[];
  /** The copy's beats that `refs` named. */
  named: ReadonlySet<BeatDoc>;
}

/**
 * The first tuplet group `edit` would leave open, in voice 1 of a bar `refs` name, that the voice did not already hold
 * open (`newOpenTupletGroup`) - or null. The rule every beat edit is held to: a group alphaTab never closes is drawn as
 * a broken bracket, and the room its beats free is off the 64th grid, so the bar is left short with nothing to say
 * why. The whole voice is read, not only the beats `refs` name, since an edit can break a group beside them.
 *
 * `edit` runs on a copy of those bars, on every track - an edit settles fermatas across tracks - so `doc`, frozen or
 * published, is left as it was. No edit but one that `writesTuplets` can open a group in a voice with no beat under a
 * tuplet, so for any other edit the copy is skipped when there is none.
 */
function tupletGroupOpenedBy(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  edit: (draft: ScoreDoc) => void,
  writesTuplets: boolean
): OpenedGroup | null {
  const voices = new Map<string, BeatRef>();
  for (const ref of refs) if (ref.voiceIndex === 0) voices.set(`${ref.trackIndex}:${ref.staffIndex}:${ref.barIndex}`, ref);
  const beatsOf = (score: ScoreDoc, at: BeatRef): BeatDoc[] =>
    score.tracks[at.trackIndex]?.staves[at.staffIndex]?.bars[at.barIndex]?.voices[0]?.beats ?? [];
  if (!writesTuplets && ![...voices.values()].some(at => beatsOf(doc, at).some(hasTuplet))) return null;

  const bars = new Set([...voices.values()].map(at => at.barIndex));
  const draft: ScoreDoc = {
    ...doc,
    tracks: doc.tracks.map(track => ({
      ...track,
      staves: track.staves.map(staff => ({ ...staff, bars: staff.bars.map((bar, index) => (bars.has(index) ? structuredClone(bar) : bar)) }))
    }))
  };
  const named = new Set(beatsAt(draft, refs));
  const before = [...voices.values()].map(at => ({ at, open: openTupletGroupsOf(beatsOf(draft, at)) }));
  edit(draft);
  for (const { at, open } of before) {
    const after = beatsOf(draft, at);
    const group = newOpenTupletGroup(open, after);
    if (group) return { group, after, before: open, named };
  }
  return null;
}

/**
 * Why a tuplet press leaves the group `opened` open, in the words that tell the user what to do: it joins an
 * unfinished group beside the selection; it splits a group beside the selection, which holds none of its beats;
 * an on-beat grace shortens a mixed group's first beat (`tupletGroupsOf`); or the selection is too few beats.
 */
function openedByTupletPress({ group, after, before, named }: OpenedGroup, tuplet: Tuplet): string {
  const groups = tupletGroupsOf(after);
  const groupOf = (beat: BeatDoc): unknown => groups[after.indexOf(beat)] ?? null;
  const joined = before.find(old =>
    old.beats.some(beat => !named.has(beat) && groupOf(beat) !== null && [...named].some(other => groupOf(other) === groupOf(beat)))
  );
  if (joined) return `That would join the unfinished ${joined.tuplet} group next to the selection and still leave a group open; select that group's beats too.`;
  if (!group.beats.some(beat => named.has(beat))) {
    return `That would split the ${group.tuplet} group next to the selection, leaving part of it unfinished; select the whole group.`;
  }
  const shortened = shortenedByOnBeatGrace(group, after);
  if (shortened) return shortened;
  const count = COUNT_WORDS[tuplet.numerator] ?? String(tuplet.numerator);
  return `A ${tuplet.numerator}:${tuplet.denominator} tuplet needs ${count} beats of the same value, or values that add up to the same length, in one bar.`;
}

/**
 * Why `group` is open, when what leaves it so is an on-beat grace in front of it in `after`: the grace takes its
 * playback length from the group's first beat, so a group of mixed values no longer adds up to a whole one
 * (`tupletGroupsOf`). Selecting more of the group would not help, so the words say what would. Null otherwise.
 */
function shortenedByOnBeatGrace(group: OpenTupletGroup, after: readonly BeatDoc[]): string | null {
  const first = after.indexOf(group.beats[0]);
  let graces = first;
  while (graces > 0 && after[graces - 1].effects.grace !== 'none') graces--;
  if (graces === first || after[graces].effects.grace !== 'onBeat' || tupletGroupsOf(after)[first]?.equal !== false) return null;
  return `An on-beat grace before the group shortens its first beat, so alphaTab never closes a ${group.tuplet} group of mixed values there; use equal values, or make it a grace before the beat.`;
}

/**
 * Why putting `refs` under `tuplet` - or out of any tuplet, with null - cannot apply, or null: any beat edit's
 * refusal; a tuplet set on graces alone, which `setTuplet` leaves out; or a tuplet group the press would leave open,
 * in the voice as a whole (`tupletGroupOpenedBy`). alphaTab closes a group of equal values at as many beats as the
 * tuplet's numerator, and a mixed one when its values add up to a whole group. A clear is refused only when it would
 * break a closed group; a whole group's clear goes through.
 */
export function tupletRefusal(doc: ScoreDoc, refs: readonly BeatRef[], tuplet: Tuplet | null): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'tuplet' }, null);
  if (refusal) return refusal;
  const setting = tuplet !== null && hasTuplet({ tuplet });
  const targets = beatsAt(doc, refs);
  if (setting && targets.length > 0 && targets.every(beat => beat.effects.grace !== 'none')) return GRACE_TUPLET;
  const opened = tupletGroupOpenedBy(doc, refs, draft => setTuplet(draft, refs, tuplet), setting);
  if (!opened) return null;
  return setting && tuplet ? openedByTupletPress(opened, tuplet) : BREAKS_A_GROUP;
}

/**
 * Why a delete of the beats `refs` name cannot apply, or null: any beat edit's refusal, or a tuplet group it would
 * leave open (`tupletGroupOpenedBy`). A whole group can go.
 */
export function deleteBeatsRefusal(doc: ScoreDoc, refs: readonly BeatRef[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  return tupletGroupOpenedBy(doc, refs, draft => deleteBeats(draft, refs), false) ? BREAKS_A_GROUP : null;
}

/**
 * Why inserting a rest of `duration` and `dots` in front of `at` cannot apply, or null: any beat edit's refusal, or
 * a tuplet group it would leave open, as one inside a group does (`tupletGroupOpenedBy`).
 */
export function insertBeatRefusal(doc: ScoreDoc, at: BeatRef, duration: DurationValue, dots: number): string | null {
  const refusal = editRefusal(doc, [at], { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  return tupletGroupOpenedBy(doc, [at], draft => void insertBeatAt(draft, at, duration, dots), false) ? INSERT_BREAKS_A_GROUP : null;
}

/**
 * Why writing a note or a rest of `duration` and `dots` at `at` cannot apply, or null: any beat edit's refusal, or a
 * tuplet group the new value would leave open (`tupletGroupOpenedBy`). Note entry sets the beat's value
 * (`setBeatDurations`), so a quarter written into a triplet eighth breaks its group; the group's own value does not.
 */
export function noteEntryRefusal(doc: ScoreDoc, at: BeatRef, duration: DurationValue, dots: number): string | null {
  const refusal = editRefusal(doc, [at], { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  return tupletGroupOpenedBy(doc, [at], draft => setBeatDurations(draft, [at], duration, dots), false) ? NOTE_BREAKS_A_GROUP : null;
}

/**
 * The value note or rest entry writes at `at` with the palette on `duration` and `dots`: the palette's, unless the
 * beat is in a tuplet group alphaTab has closed (`tupletGroupsOf`) and a beat of the palette's value would break it
 * (`noteEntryRefusal`) - then the beat's own. Guitar Pro keeps a beat's value when you type over it, and the beat
 * keeps its tuplet either way (`setBeatDurations`), so the group stays whole. In a group that is already open the
 * palette's value stands, and so does its refusal: the beat's own value would close nothing.
 */
export function entryValueOf(doc: ScoreDoc, at: BeatRef, duration: DurationValue, dots: number): { duration: DurationValue; dots: number } {
  const beats = doc.tracks[at.trackIndex]?.staves[at.staffIndex]?.bars[at.barIndex]?.voices[at.voiceIndex]?.beats ?? [];
  const beat = beats[at.beatIndex];
  const own = beat && hasTuplet(beat) && beat.effects.grace === 'none' && tupletGroupsOf(beats)[at.beatIndex]?.full;
  if (!beat || !own || (beat.duration === duration && beat.dots === dots)) return { duration, dots };
  return noteEntryRefusal(doc, at, duration, dots) === NOTE_BREAKS_A_GROUP ? { duration: beat.duration, dots: beat.dots } : { duration, dots };
}

/**
 * Why pressing Grace before or Grace on beat - `grace`, by the toggle rule - cannot apply to `refs`, or null: any
 * beat edit's refusal, or a tuplet group it would leave open (`tupletGroupOpenedBy`). A grace takes no room and is
 * not counted in a group, so a triplet beat made a grace leaves its group a beat short; and an on-beat grace in front
 * of a mixed group shortens its first beat, which is said in its own words (`shortenedByOnBeatGrace`).
 */
export function graceRefusal(doc: ScoreDoc, refs: readonly BeatRef[], grace: Exclude<BeatEffectsDoc['grace'], 'none'>): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'grace' }, null);
  if (refusal) return refusal;
  const value = toggledValue(beatsAt(doc, refs).map(beat => beat.effects.grace), grace, 'none');
  const opened = tupletGroupOpenedBy(doc, refs, draft => setGrace(draft, refs, value), false);
  return opened ? shortenedByOnBeatGrace(opened.group, opened.after) ?? BREAKS_A_GROUP : null;
}

/** The highest MIDI note, which `Note.trillValue` must not pass. */
const MIDI_TOP = 127;

const TRILL_OUT_OF_RANGE =
  'A trill a whole step above a note in the selection would pass the top of the MIDI range, and alphaTab would drop it.';

/**
 * Why a trill press cannot apply to `refs`, or null: any trill edit's refusal, or - when the press would
 * set trills - one aimed past MIDI 127 (`trillTargetOf`), which alphaTab does not keep. A clear is never
 * refused for it.
 */
export function trillRefusal(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, notes?: readonly NoteTarget[]): string | null {
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'trill' }, focus, notes);
  if (refusal) return refusal;
  const targets = notes ?? noteTargetsAt(doc, refs, focus);
  if (targets.every(target => target.note.effects.trill !== null)) return null;
  const tooHigh = targets.some(({ ref, note }) => {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    return staff !== undefined && trillTargetOf(staff, note) > MIDI_TOP;
  });
  return tooHigh ? TRILL_OUT_OF_RANGE : null;
}

/**
 * Why pressing a beat effect tool - `key` set to `on`, by the toggle rule, or cleared to `off` - cannot
 * apply to `refs`, or null. A clear is refused only where any beat edit is, so a tap, slap or pop already
 * on a pitched staff - which an alphaTex import can leave - can be taken off; only setting one there is
 * refused, as `noteEffectRefusal` treats the fretted-only note techniques.
 */
export function beatEffectRefusal<K extends Exclude<keyof BeatEffectsDoc, 'grace'>>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  key: K,
  on: BeatEffectsDoc[K],
  off: BeatEffectsDoc[K]
): string | null {
  const clears = toggledValue(beatsAt(doc, refs).map(beat => beat.effects[key]), on, off) !== on;
  // 'duration' stands for any beat edit: the scope with no technique of its own to check.
  return editRefusal(doc, refs, { family: 'beat', key: clears ? 'duration' : key }, null);
}

const GRACE_DURATION =
  "A grace note's written value is set by alphaTab from how many graces are in its group, so it cannot be changed.";

/**
 * Why a press of `duration` and `dots` cannot apply to `refs`, or null when it can: any beat edit's refusal,
 * every target a grace beat, or a tuplet group the new values would leave open (`tupletGroupOpenedBy`).
 *
 * `Beat.finish` (`alphaTab.core.mjs` ~7772-7786 in 1.8) rewrites an on-beat or before-beat grace's
 * value by the size of its group - an eighth for one grace, a sixteenth for two, a thirty-second for
 * three or more - so a value set on one is drawn as alphaTab's and lost on save. `setBeatDurations`
 * skips graces for that reason; a press with nothing else to change is refused rather than skipped,
 * so it says why nothing happened. A range with some graces in it changes the rest.
 */
export function durationRefusal(doc: ScoreDoc, refs: readonly BeatRef[], duration: DurationValue, dots: number): string | null {
  return lengthRefusal(doc, refs, draft => setBeatDurations(draft, refs, duration, dots));
}

/**
 * Why dotting `refs` with `dots` at their own values cannot apply, or null: what refuses a duration press
 * (`durationRefusal`), with `setBeatDots` as the edit a tuplet group is checked against.
 */
export function dotsRefusal(doc: ScoreDoc, refs: readonly BeatRef[], dots: number): string | null {
  return lengthRefusal(doc, refs, draft => setBeatDots(draft, refs, dots));
}

/** `durationRefusal` and `dotsRefusal`, for the length change `edit` makes. */
function lengthRefusal(doc: ScoreDoc, refs: readonly BeatRef[], edit: (draft: ScoreDoc) => void): string | null {
  const refusal = editRefusal(doc, refs, { family: 'beat', key: 'duration' }, null);
  if (refusal) return refusal;
  const allGraces = refs.every(ref => (beatAt(doc, ref)?.effects.grace ?? 'none') !== 'none');
  if (allGraces) return GRACE_DURATION;
  return tupletGroupOpenedBy(doc, refs, edit, false) ? BREAKS_A_GROUP : null;
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
 * - Vibrato on tied notes alone is refused either way. alphaTab draws and plays a tie destination with
 *   its origin's vibrato (`tieOriginOf`), so a continuation's own value changes nothing anyone can see or
 *   hear - and writing one stops alphaTab carrying a bend across the tie. A range with other notes in it
 *   skips its continuations (`noteEffectTargets`), as a hammer-on skips notes that cannot land.
 */
export function noteEffectRefusal<K extends keyof NoteEffectsDoc>(
  doc: ScoreDoc,
  refs: readonly BeatRef[],
  focus: number | null,
  key: K,
  on: NoteEffectsDoc[K],
  off: NoteEffectsDoc[K],
  notes?: readonly NoteTarget[]
): string | null {
  const all = notes ?? noteTargetsAt(doc, refs, focus);
  const refusal = editRefusal(doc, refs, { family: 'note', key: 'notes' }, focus, all);
  if (refusal) return refusal;

  if (key === 'vibrato' && all.length > 0 && all.every(target => tieOriginOf(doc, target.ref, target.note) !== null)) {
    return VIBRATO_ON_TIE;
  }

  const targets = noteEffectTargets(doc, refs, focus, key, on, all);
  if (toggledValue(targets.map(target => target.note.effects[key]), on, off) !== on) return null;

  const scoped = editRefusal(doc, refs, { family: 'note', key }, focus, all);
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
