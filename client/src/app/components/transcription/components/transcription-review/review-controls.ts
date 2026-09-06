import { STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING, TimeSignature } from '../../../../models/composer.model';
import {
  DetectedNote,
  FinestDivision,
  TranscriptionSession
} from '../../../../models/transcription.model';
import { NoteIndex } from '../../../../services/preview-score';
import { DropReason, DroppedNote } from '../../../../services/score-derivation';
import { HarmonicOptions, NoteDecisions } from '../../../../services/transcription-harmonics';
import { FoldedNote } from '../../../../services/transcription-octave';

/**
 * The reference data and arithmetic behind the review panel's controls.
 *
 * Split out of `TranscriptionReviewComponent` because that file crossed
 * `CLAUDE.md`'s 500-line ceiling, and this is the half that comes away
 * cleanly: no Angular, no DOM, nothing stateful - a preset list, two lookups
 * and two calculations, in the manner of `staff-pitch.ts`. Everything here can
 * be asserted without a fixture, which is why the panel's spec checks the
 * counting and the tempo reading directly rather than through the template.
 *
 * ## And past that ceiling itself
 *
 * **263 of these 677 lines are code**, counted as non-blank lines outside
 * block comments and `//` lines. A file that exists because another one grew
 * too long has to answer for its own length, and the answer is the same
 * accounting the component's docblock gives: the ceiling is about how much
 * code a reader holds in their head, the code here is a table, four small pure
 * functions and one grouping pass, and what makes the file long is the
 * argument beside each - why the discard reasons are split into six rather
 * than five, why the cap yields to an undrawn row, why the pitch names are
 * sharps only. Extracting those would move the reasoning away from the code it
 * justifies, which is the thing the rule is trying to protect.
 *
 * There is no second split waiting here. The next one, if the code grows,
 * belongs on the component's side; see its docblock.
 *
 * The presets are reference data in `CLAUDE.md`'s sense: string pitches are
 * facts about instruments, not settings. They are handed out by copy at the
 * one place a caller could keep them (`onTuningChange`), so nothing downstream
 * can reach back into the table through an array it was given.
 */

/** A tuning a listener can pick, shaped as `DerivationSettings.tuning` wants it. */
export interface TuningPreset {
  id: string;
  label: string;
  /** MIDI pitch per open string, highest string first. */
  tuning: number[];
}

/** A meter a listener can pick. */
export interface TimeSignaturePreset {
  id: string;
  label: string;
  value: TimeSignature;
}

const meter = (numerator: number, denominator: number): TimeSignature => ({
  numerator,
  denominator,
  isCommon: numerator === 4 && denominator === 4
});

export const TUNING_PRESETS: readonly TuningPreset[] = [
  { id: 'bass-4', label: 'Bass, standard (G D A E)', tuning: STANDARD_BASS_TUNING },
  { id: 'bass-4-drop-d', label: 'Bass, drop D (G D A D)', tuning: [43, 38, 33, 26] },
  { id: 'bass-5', label: 'Bass, five string (G D A E B)', tuning: [43, 38, 33, 28, 23] },
  {
    id: 'guitar-6',
    label: 'Guitar, standard (E B G D A E)',
    tuning: STANDARD_GUITAR_TUNING
  },
  {
    id: 'guitar-6-drop-d',
    label: 'Guitar, drop D (E B G D A D)',
    tuning: [64, 59, 55, 50, 45, 38]
  },
  { id: 'guitar-6-eb', label: 'Guitar, half step down', tuning: [63, 58, 54, 49, 44, 39] }
];

export const TIME_SIGNATURE_PRESETS: readonly TimeSignaturePreset[] = [
  { id: '4-4', label: '4/4', value: meter(4, 4) },
  { id: '3-4', label: '3/4', value: meter(3, 4) },
  { id: '2-4', label: '2/4', value: meter(2, 4) },
  { id: '2-2', label: '2/2', value: meter(2, 2) },
  { id: '5-4', label: '5/4', value: meter(5, 4) },
  { id: '6-8', label: '6/8', value: meter(6, 8) },
  { id: '7-8', label: '7/8', value: meter(7, 8) },
  { id: '9-8', label: '9/8', value: meter(9, 8) },
  { id: '12-8', label: '12/8', value: meter(12, 8) }
];

export const FINEST_DIVISIONS: readonly { value: FinestDivision; label: string }[] = [
  { value: 4, label: 'Quarter note' },
  { value: 8, label: 'Eighth note' },
  { value: 16, label: 'Sixteenth note' },
  { value: 32, label: 'Thirty-second note' },
  { value: 64, label: 'Sixty-fourth note' }
];

/**
 * The average tempo of a grid, in BPM, or null when it does not state one.
 *
 * Read across the whole span rather than off the first interval, because a
 * tracked grid is measured beat by beat and its intervals differ: the pinned
 * fixture comes back as [0.49, 0.49, 0.51, 0.5, ...]. The span is also the
 * figure `withTempo` reproduces - it anchors on the first beat and lays an even
 * pulse out to the last - so a tempo shown here and typed straight back leaves
 * the grid roughly where it was rather than nudging it every time it is read.
 */
export function gridTempoBpm(beatsSec: readonly number[]): number | null {
  if (beatsSec.length < 2) return null;

  const span = beatsSec[beatsSec.length - 1] - beatsSec[0];
  if (!Number.isFinite(span) || span <= 0) return null;

  return Math.round((60 * (beatsSec.length - 1)) / span);
}

/** True when two tunings are the same instrument, string for string. */
export function sameTuning(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index]);
}

export const meterId = (timeSignature: TimeSignature): string =>
  `${timeSignature.numerator}-${timeSignature.denominator}`;

/**
 * The preset list, plus the session's own tuning when it matches none of them.
 *
 * Without the extra entry a select bound to an id no option carries falls back
 * to showing the first one, and the panel would state an instrument the score
 * was not derived on.
 */
export function withCurrentTuning(tuning: readonly number[]): TuningPreset[] {
  if (TUNING_PRESETS.some(preset => sameTuning(preset.tuning, tuning))) {
    return [...TUNING_PRESETS];
  }

  const plural = tuning.length === 1 ? '' : 's';
  return [
    {
      id: 'custom',
      label: `Current (${tuning.length} string${plural})`,
      tuning: [...tuning]
    },
    ...TUNING_PRESETS
  ];
}

/** The preset list, plus the session's own meter when it matches none of them. */
export function withCurrentMeter(timeSignature: TimeSignature): TimeSignaturePreset[] {
  const id = meterId(timeSignature);
  if (TIME_SIGNATURE_PRESETS.some(preset => preset.id === id)) {
    return [...TIME_SIGNATURE_PRESETS];
  }

  return [
    {
      id,
      label: `${timeSignature.numerator}/${timeSignature.denominator}`,
      value: { ...timeSignature }
    },
    ...TIME_SIGNATURE_PRESETS
  ];
}

/**
 * What octave correction did to this derivation, or null when it did nothing.
 *
 * The panel's only account of what the pipeline did was the discard list, and a
 * fold is not a discard - so switching from a bass tuning to a guitar one moved
 * every note under E2 up an octave and the screen said nothing at all. This is
 * the sentence that says it.
 *
 * Grouped by distance rather than totalled, because "3 notes moved" does not
 * distinguish a routine octave fold from a pitch the detector missed by two.
 * Ordered by distance, deepest fold first, so the largest correction is read
 * first.
 */
export function describeFolds(folded: readonly FoldedNote[]): string | null {
  if (folded.length === 0) return null;

  const byDistance = new Map<number, number>();
  for (const entry of folded) {
    byDistance.set(entry.semitones, (byDistance.get(entry.semitones) ?? 0) + 1);
  }

  const parts = [...byDistance.entries()]
    .sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]) || b[0] - a[0])
    .map(([semitones, count]) =>
      `${count} ${count === 1 ? 'note' : 'notes'} ${describeDistance(semitones)}`
    );

  return `Folded onto the neck: ${parts.join(', ')}.`;
}

/** "up an octave", "down two octaves" - the distance as a reader says it. */
function describeDistance(semitones: number): string {
  const octaves = Math.abs(semitones) / 12;
  const direction = semitones > 0 ? 'up' : 'down';

  if (octaves === 1) return `${direction} an octave`;

  // Not a whole number of octaves, which `correctOctaves` cannot produce - said
  // in semitones rather than rounded into a lie.
  if (!Number.isInteger(octaves)) return `${direction} ${Math.abs(semitones)} semitones`;

  return `${direction} ${OCTAVE_WORDS[octaves] ?? octaves} octaves`;
}

/** Small counts read better as words; past these the number is the point. */
const OCTAVE_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four' };

/**
 * Sharps only, deliberately.
 *
 * `CLAUDE.md` asks for both spellings and for `preferSharps` to decide between
 * them, and that rule is about scales and chords - things that carry a key. A
 * `DetectedNote` is a MIDI number the model emitted, with no key, no scale and
 * no spelling; `DerivationSettings.key` defaults to null and is never inferred.
 * Choosing flats for some of these would be inventing a harmonic context to
 * justify it. So one spelling, stated once, and the same one every time - which
 * is also what makes two rows of the discard list comparable at a glance.
 */
const CHROMATIC_SHARPS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

/**
 * A MIDI pitch as a reader says it: 28 is "E1", 58 is "A#3".
 *
 * Scientific pitch notation, where middle C (60) is C4 - so "E1" is MIDI 28,
 * the pitch `STANDARD_BASS_TUNING`'s bottom string sounds, and a bass line
 * written on it lands in the E1-G2 range rather than an octave above.
 *
 * A pitch that is not a usable number gets "?" rather than "NaN-1". These rows
 * describe notes the pipeline turned away, and `preview-score.ts` turns away
 * an uncorrectable pitch precisely because it is not one - so the list has to
 * be able to name a note that has no name.
 */
export function pitchName(pitch: number): string {
  if (!Number.isFinite(pitch)) return '?';

  const midi = Math.round(pitch);
  // `%` is signed in JS, so a pitch below MIDI 0 - which `isCorrectablePitch`
  // permits, being ten octaves wide - would index the table negatively.
  const step = ((midi % 12) + 12) % 12;

  return `${CHROMATIC_SHARPS[step]}${Math.floor(midi / 12) - 1}`;
}

/** An onset in seconds, to hundredths, or "?" when it is not a time. */
export function timeLabel(onsetSec: number): string {
  return Number.isFinite(onsetSec) ? `${onsetSec.toFixed(2)} s` : '?';
}

/** Pitch and time together: "E1 at 1.50 s". */
export function noteLabel(note: DetectedNote): string {
  return `${pitchName(note.pitch)} at ${timeLabel(note.onsetSec)}`;
}

/**
 * What a click on the score just did, read off the state it produced.
 *
 * Written from the arriving session rather than from the click that went out,
 * because the panel does not know which way a toggle goes: that depends on the
 * kept set and on the two override lists, and `TranscriptionService.toggleNote`
 * is what consults them. Asking the new session whether the note is in `notes`
 * is therefore the only account of the gesture that cannot be wrong.
 *
 * Null for an id the session does not carry. `toggleNote` ignores such an id
 * without pushing anything, so in practice this state never arrives - but a
 * second `transcribe` can replace the session while a click is in flight, and
 * a sentence about a note from a different recording would be worse than
 * silence.
 *
 * It says the gesture is repeatable, because that is the part that is not
 * discoverable: a toggle undoes itself, so an override taken by mistake costs
 * one more click rather than a re-upload.
 *
 * ## The third outcome, which is not "restored" or "suppressed"
 *
 * `toggleNote` reads the two override lists before it reads the current
 * verdict, so a note that already carries an override has it *cleared* rather
 * than gaining a second one - that ordering is what keeps a note from being
 * stuck one gesture away from the algorithm in either direction, and it is
 * right. But it means a click can be a visible no-op: restore a note, then
 * lower `partialConfidenceRatio` past its cut, and the algorithm would now keep
 * it anyway. Clicking then removes the override and changes nothing on the
 * staff. "Restored ..." over an unchanged score is the wrong sentence for that;
 * saying the override was cleared, and which way the pipeline goes without it,
 * is the right one.
 *
 * Told apart by the arriving session's own `decisions`. A toggle either adds an
 * override or removes one, so an id in neither list after the round trip is one
 * whose override was just taken away.
 */
export function describeToggle(session: TranscriptionSession, id: string): string | null {
  const note = session.rawNotes.find(candidate => candidate.id === id);
  if (!note) return null;

  const kept = session.notes.some(candidate => candidate.id === id);
  const overridden =
    session.decisions.keep.includes(id) || session.decisions.drop.includes(id);

  if (!overridden) {
    return `Cleared your override on ${noteLabel(note)}. The pipeline `
      + `${kept ? 'keeps' : 'suppresses'} it; click it again to `
      + `${kept ? 'suppress' : 'restore'} it.`;
  }

  return `${kept ? 'Restored' : 'Suppressed'} ${noteLabel(note)}. `
    + `Click it again for the pipeline's own answer.`;
}

// ---------------------------------------------------------------------------
// The discard list
// ---------------------------------------------------------------------------

/**
 * Why one detection is not in the score, including "because you said so".
 *
 * `DropReason`'s four are derivation's; `suppressed` is the harmonic pass's;
 * `youSuppressed` is the user's own, and is separated from `suppressed` rather
 * than folded into it because the two want opposite treatment. A note the
 * algorithm removed is a decision to *judge*, and the row offers to reverse
 * it; a note the user removed is a decision already made, and the row offers to
 * take it back. Reading them as one group would put the user's own gesture in
 * a list headed "harmonic partials" and invite them to argue with themselves.
 */
export type DiscardReason = DropReason | 'suppressed' | 'youSuppressed';

/** One detection the score does not contain, as the list prints it. */
export interface DiscardRow {
  /** `DetectedNote.id`: what a restore is addressed by. */
  id: string;
  /** "E2 at 0.50 s". */
  label: string;
  /**
   * Whether the score draws it as a ghost.
   *
   * Read off the preview's own index rather than recomputed, so this cannot
   * disagree with the staff beside it: see `groupDiscards`.
   */
  drawn: boolean;
}

/** Every detection that went one way, and how much of it the list will print. */
export interface DiscardGroup {
  reason: DiscardReason;
  /** "harmonic partials" - reads after a number. */
  label: string;
  /**
   * Whether a per-note toggle can put these back.
   *
   * True for the two suppression reasons and false for derivation's four, and
   * the difference is not cosmetic: `toggleNote` moves a note across the
   * *suppression* line, and a note derivation dropped never crossed it. It is
   * still in `session.notes` - it survived suppression and was turned away
   * later, for being too quiet, unplayable, early, or on a string another note
   * held - so toggling it does not restore it. It suppresses it.
   *
   * A "Restore" button on those rows was therefore a button that did the
   * opposite of what it said, and the browser pass caught it doing exactly
   * that: pressing Restore on a note below the confidence floor removed it from
   * the score. They get `remedy` instead, which names the knob that does work.
   */
  restorable: boolean;
  /** For a group a toggle cannot help, the control that can. Null otherwise. */
  remedy: string | null;
  /** How many went this way, including any the list declined to print. */
  count: number;
  /**
   * The ones the list prints: every undrawn note, then drawn ones to the cap.
   *
   * Earliest first within each of those two, which is the order they arrived
   * in. The partition is not cosmetic - it is what makes the two sentences the
   * template prints true. A note the staff never drew is reachable from this
   * list and from nowhere else, so `MAX_LISTED_ROWS` is not allowed to
   * displace one; a note past the cap is therefore always a ghost the reader
   * can go and click. See `MAX_LISTED_ROWS`.
   */
  rows: DiscardRow[];
  /**
   * `count - rows.length`, and every one of them drawn.
   *
   * Which is what lets the template say they are still ghosts on the staff and
   * still one click away there. Guaranteed by the ordering above rather than
   * asserted.
   */
  hidden: number;
  /** How many of `count` are not in the score even as ghosts. */
  omitted: number;
}

const DISCARD_LABELS: Readonly<Record<DiscardReason, string>> = {
  belowConfidence: 'below the confidence floor',
  unplayable: 'unplayable on this tuning',
  beforeGrid: 'struck before the beat grid',
  stringTaken: 'struck on a string already held',
  suppressed: 'harmonic partials',
  youSuppressed: 'suppressed by you'
};

/**
 * What actually addresses each reason, for the four a toggle cannot.
 *
 * Every one of these notes is in `session.notes`: it passed suppression and
 * `deriveScore` turned it away afterwards. So the fix is a `DerivationSettings`
 * knob, or nothing - and saying which is the difference between a list that
 * explains a discard and one that merely counts it.
 */
const DISCARD_REMEDIES: Readonly<Record<DiscardReason, string | null>> = {
  belowConfidence: 'Lower the confidence floor to write these as notes.',
  unplayable: 'No fret on this tuning reaches them. Another tuning or capo might.',
  beforeGrid: 'They sound before bar 1. Nudge the downbeat back to make room.',
  stringTaken: 'Another note held that string in that slot. A finer division may separate them.',
  suppressed: null,
  youSuppressed: null
};

/** The reasons a per-note toggle can undo: the ones suppression itself made. */
const RESTORABLE: readonly DiscardReason[] = ['suppressed', 'youSuppressed'];

/**
 * What to say about a derivation drop that `DISCARD_REMEDIES` has no answer for.
 *
 * Unreachable today - every member of `DropReason` names a knob - and kept
 * because the alternative is worse than a vague sentence: `derivationRemedies`
 * uses the presence of an entry to decide whether a click is declined, so a
 * reason added to `DropReason` without a remedy would otherwise fall through
 * and let the click *suppress* the note. See `DiscardGroup.restorable`.
 */
const NO_REMEDY =
  'The score could not be written with this note. No suppression setting brings it back.';

/**
 * What to say instead of toggling, for every note derivation turned away.
 *
 * The other half of `DiscardGroup.restorable`, for the surface that has no
 * button to withhold. The list can simply not draw a "Restore" control on a row
 * a toggle would move the wrong way; the staff cannot, because a ghost there is
 * a notehead and every notehead is clickable. So the staff needs the same fact
 * in a form a click handler can read: the ids a toggle must decline, and the
 * sentence to say instead.
 *
 * `derived.dropped` is exactly the notes that reached `deriveScore` and were
 * turned away by it. Every one of them is still in `session.notes` - it passed
 * suppression and was rejected a stage later - so `toggleNote` would read it as
 * kept and *suppress* it: nothing visible would happen, the kept set would
 * change enough to re-track the beat grid, and the note would gain a `drop`
 * override that outranks the very threshold the remedy names.
 *
 * Keyed by id over the whole array rather than over the rows the list printed:
 * `MAX_LISTED_ROWS` is a bound on reading, and a click can land on any ghost
 * the staff drew.
 *
 * Reads the same `DISCARD_REMEDIES` table the list prints from, so the sentence
 * a declined click produces is the one the group in the list already gives.
 */
export function derivationRemedies(
  dropped: readonly DroppedNote[]
): ReadonlyMap<string, string> {
  const remedies = new Map<string, string>();

  for (const entry of dropped) {
    remedies.set(entry.note.id, DISCARD_REMEDIES[entry.reason] ?? NO_REMEDY);
  }

  return remedies;
}

/** The order the groups are read in; the largest one on real material is last. */
const DISCARD_ORDER: readonly DiscardReason[] = [
  'youSuppressed',
  'belowConfidence',
  'unplayable',
  'beforeGrid',
  'stringTaken',
  'suppressed'
];

/**
 * How many rows a single group will print before it stops.
 *
 * A long stem discards thousands of partials, and a row each would be a wall
 * of text that is also a wall of DOM. The cap is not a loss of access: every
 * note past it is still a ghost on the staff and still one click from being
 * restored, and the group's heading still states the true total - so the list
 * summarises rather than quietly under-reporting.
 *
 * That argument only holds for notes the staff actually drew, and it was
 * applied to all of them. `groupDiscards` took the first forty and counted
 * `omitted` over the whole group, so a note at position 41 that no ghost was
 * drawn for satisfied neither sentence the panel prints: not "still one click
 * away there", because there is no glyph, and not "only reachable from here",
 * because the list stopped before it. Not a hypothetical - `preview-score.ts`
 * records thirteen of thirty-three candidates disappearing at a 0.7 floor,
 * once a shorter score piles the ghosts into the last bar and voice-2
 * collisions become certain.
 *
 * So the cap yields to an undrawn row. Those are listed first and in full, and
 * the cap governs what fills the remainder; a group with more undrawn notes
 * than this prints all of them and no others. The wall this was protecting
 * against is a wall of rows that were each reachable another way, and a row
 * that is reachable nowhere else is not one of those.
 */
export const MAX_LISTED_ROWS = 40;

/**
 * Everything missing from the score, grouped by why, in reading order.
 *
 * ## One computation, not two
 *
 * The score and this list say the same thing twice, and the way that goes
 * wrong is by their being computed separately - a list built from
 * `derived.dropped` plus `state.suppressed` while the staff is built from
 * `buildPreviewDoc` would drift the moment one of them learned a rule the
 * other did not, and a reader would have no way to tell which was lying.
 *
 * So `drawn` is the set of ids the preview's own index holds, which is not a
 * second opinion about what the score contains: the index is written *as the
 * document is written*, one entry per note actually put on a staff. A note
 * this list marks as drawn is a note the reader can go and click, by
 * construction rather than by agreement.
 *
 * The same fact supplies `omitted`. `buildPreviewDoc` guarantees every
 * candidate is either drawn or lost, so a candidate absent from the index is
 * exactly one that was lost - no fret reaches the pitch, the onset is not a
 * time, or a ghost already held that string in that slot. The out-parameter
 * that used to report it counted the same notes by a different route.
 *
 * ## What is not here
 *
 * Notes the user *restored*. They are in the score, so they are not discards;
 * `restoredRows` lists those, and the two together are the whole of what the
 * user can undo.
 */
export function groupDiscards(
  dropped: readonly DroppedNote[],
  suppressed: readonly DetectedNote[],
  decisions: NoteDecisions,
  drawn: ReadonlySet<string>
): DiscardGroup[] {
  const byReason = new Map<DiscardReason, DetectedNote[]>();
  const add = (reason: DiscardReason, note: DetectedNote): void => {
    const existing = byReason.get(reason);
    if (existing) existing.push(note);
    else byReason.set(reason, [note]);
  };

  for (const entry of dropped) add(entry.reason, entry.note);

  const droppedByUser = new Set(decisions.drop);
  for (const note of suppressed) {
    add(droppedByUser.has(note.id) ? 'youSuppressed' : 'suppressed', note);
  }

  return DISCARD_ORDER.filter(reason => (byReason.get(reason)?.length ?? 0) > 0).map(
    reason => {
      const notes = byReason.get(reason) ?? [];
      // The undrawn ones first and in full: this list is the only record of
      // them, so the cap governs what fills the remainder rather than what
      // gets in at all. See `MAX_LISTED_ROWS` and `DiscardGroup.rows`.
      const undrawn = notes.filter(note => !drawn.has(note.id));
      const onStaff = notes.filter(note => drawn.has(note.id));
      const rows = [
        ...undrawn,
        ...onStaff.slice(0, Math.max(0, MAX_LISTED_ROWS - undrawn.length))
      ].map(note => toRow(note, drawn));

      return {
        reason,
        label: DISCARD_LABELS[reason],
        restorable: RESTORABLE.includes(reason),
        remedy: DISCARD_REMEDIES[reason],
        count: notes.length,
        rows,
        hidden: notes.length - rows.length,
        omitted: undrawn.length
      };
    }
  );
}

/**
 * The notes in the score only because the user put them back.
 *
 * The other half of what is undoable, and it cannot live in `groupDiscards`
 * for the reason that makes it useful: these notes are *in* the score, so they
 * are not discards, and a list of discards would never mention them. Without
 * this a restore is a one-way door from the panel - the note is a black
 * notehead among black noteheads, and finding it again to click it means
 * remembering where it was.
 *
 * Resolved against `rawNotes`, which is where the ids came from. An id naming
 * no detection is skipped rather than printed as a blank row: `toggleNote`
 * cannot create one, but `NoteDecisions` is a plain object on a session and
 * this is a display, not a validator.
 *
 * `drawn` is not consulted. A restored note is one `deriveScore` was handed,
 * so it is subject to the same four drop reasons as any other and may not
 * have been written - in which case it appears in `groupDiscards` as well,
 * under the reason that turned it away. That is the truth about it and both
 * rows are worth having: one says the user asked for it, the other says what
 * happened next.
 */
export function restoredRows(
  session: TranscriptionSession,
  drawn: ReadonlySet<string>
): DiscardRow[] {
  const byId = new Map(session.rawNotes.map(note => [note.id, note] as const));

  return session.decisions.keep
    .map(id => byId.get(id))
    .filter((note): note is DetectedNote => note !== undefined)
    .map(note => toRow(note, drawn));
}

function toRow(note: DetectedNote, drawn: ReadonlySet<string>): DiscardRow {
  return { id: note.id, label: noteLabel(note), drawn: drawn.has(note.id) };
}

/** The ids the preview actually put on a staff, ghosts and kept notes alike. */
export function drawnIds(index: NoteIndex): Set<string> {
  return new Set(index.values());
}

// ---------------------------------------------------------------------------
// The suppression thresholds
// ---------------------------------------------------------------------------

/**
 * What to say beside a threshold that was not a number.
 *
 * Every one of the four is used unchecked in a comparison, and a NaN loses
 * every comparison it is in - so a NaN `partialConfidenceRatio` makes
 * `explains` false for every candidate and suppresses nothing at all, silently
 * and without an error anywhere. `updateHarmonics` does not check, by design:
 * it takes a `Partial<HarmonicOptions>` and its refusal contract is about
 * settings combinations that cannot be *written*, which is a different
 * question from a field that is not a number.
 *
 * So the control is where it is stopped, on the same argument `onTempoChange`
 * makes: an empty number input is one keystroke away at all times, and a panel
 * that emitted it would leave the score derived at a threshold the box no
 * longer shows. The gap this does not close is a caller other than this panel
 * handing `updateHarmonics` a NaN; nothing in the app does, and closing it
 * belongs with the service rather than here.
 */
/**
 * What the four threshold controls show, which is not always a number.
 *
 * `HarmonicOptions` would be the obvious type and is the wrong one, by exactly
 * the amount that matters. A mirror exists so a control shows what the state
 * says *and what the user just typed into it*, and the second of those can be
 * blank: an empty number input is one keystroke away at all times, and three of
 * the four are number inputs. A mirror that could not hold that would have to
 * keep the last good number instead, which is the same value the session
 * carries - and `NgModel` writes to the view only when the bound value differs
 * from the one it last saw, so an emptied box would never be refilled. It would
 * sit empty behind a message that the next state change silently clears.
 *
 * So the refused value goes in, `onHarmonicChange` says so, and the arriving
 * session then differs from it and is written back through the accessor.
 */
export type HarmonicMirror = Readonly<Record<keyof HarmonicOptions, number | null>>;

export const HARMONIC_REFUSALS: Readonly<Record<keyof HarmonicOptions, string>> = {
  partialConfidenceRatio: 'Needs a number. Leaving it blank would suppress nothing.',
  toleranceSec: 'Needs a number of seconds. Leaving it blank would suppress nothing.',
  unisonConfidenceRatio: 'Needs a number. Leaving it blank would suppress nothing.',
  unisonDurationRatio: 'Needs a number. Leaving it blank would suppress nothing.'
};
