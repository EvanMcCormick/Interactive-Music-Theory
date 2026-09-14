import { BeatDoc, NotePitch, ScoreDoc, StaffDoc } from '../models/composer.model';

/**
 * A pitch on a staff with a tuning: which string and fret play it.
 *
 * alphaTab draws a note on tablature by its string, and a pitched note has none - `Note.string` stays at -1 - so
 * `TabBarRenderer.collectSpaces` indexes `spaces[tuning.length + 1]`, which does not exist, and the render throws
 * ("Cannot read properties of undefined (reading 'push')") and draws nothing. So every note on a staff with a tuning
 * is fretted, as Guitar Pro keeps it: Pen's click on the notation writes a string and a fret, and a document that
 * arrives with a pitched note there has it fretted (`frettedDocOf`).
 *
 * A fretted note carries no letter. With `accidental: 'auto'` alphaTab spells it from the key signature, which is
 * how Pen's pitch was read off the staff (`diatonicToPitch`), so the note lands on the line that was clicked.
 */

/** The frets on the neck: the highest fret a note can be written at, with no capo. */
export const MAX_FRET = 24;

/** How many frets above the lowest one Pen still prefers the caret's string within. */
const CARET_STRING_REACH = 4;

/**
 * The highest fret a note can be written at on `staff`: 24 less the capo, since frets count from the capo and it
 * shortens the neck in front of it. The one limit for every path that writes or moves a fret - Pen, typed digits,
 * semitone and string moves, and fretting a document put in whole.
 */
export function maxFretOf(staff: Pick<StaffDoc, 'capo'>): number {
  return Math.max(0, MAX_FRET - staff.capo);
}

/** The range `maxFretOf` allows, as a refusal says it: "A fret runs from 0 to 24", or "With the capo at 5, ..." */
export function fretRangeOf(staff: Pick<StaffDoc, 'capo'>): string {
  return staff.capo > 0 ? `With the capo at ${staff.capo}, a fret runs from 0 to ${maxFretOf(staff)}` : `A fret runs from 0 to ${maxFretOf(staff)}`;
}

/** The fretted half of `NotePitch`. */
export type FrettedPitch = Extract<NotePitch, { kind: 'fretted' }>;

/** What a note entry does on a beat: writes a note, or takes out the note at `index` - a click on a notehead. */
export type StaffEntry = { kind: 'write'; pitch: NotePitch } | { kind: 'remove'; index: number };

/** The MIDI pitch a note sounds, before transposition: its open string, the capo and the fret; or the pitch itself. */
export function soundingMidiOf(staff: Pick<StaffDoc, 'tuning' | 'capo'>, pitch: NotePitch): number {
  return pitch.kind === 'fretted'
    ? (staff.tuning[pitch.string - 1] ?? 0) + staff.capo + pitch.fret
    : (pitch.octave + 1) * 12 + pitch.noteValue;
}

/**
 * The string and fret that play `midi`, or why none does.
 *
 * Chosen to be predictable, as Guitar Pro's is: the lowest fret over the strings that hold no note on the beat
 * (`taken`), a tie going to the caret's string (`caretString`, 1-based) and then to the higher string - except that the
 * caret's string, when it is free and reaches the pitch within 4 frets of that lowest fret, is preferred. So a caret
 * left on a low string by a tablature click does not send a high pitch to fret 24 there. Frets run from 0 to
 * `maxFretOf` the staff.
 */
export function frettedPlacementOf(
  staff: Pick<StaffDoc, 'tuning' | 'capo'>,
  midi: number,
  taken: ReadonlySet<number>,
  caretString: number | null
): FrettedPitch | string {
  // Listed from string 1, the highest, so the first of two equal frets is the higher string.
  const reach = maxFretOf(staff);
  const reachable = staff.tuning
    .map((open, index) => ({ string: index + 1, fret: midi - open - staff.capo }))
    .filter(candidate => candidate.fret >= 0 && candidate.fret <= reach);
  if (reachable.length === 0) {
    const lowest = Math.min(...staff.tuning) + staff.capo;
    return midi < lowest ? "That pitch is below this staff's lowest string." : "That pitch is above the highest fret this staff's strings reach.";
  }
  const free = reachable.filter(candidate => !taken.has(candidate.string));
  if (free.length === 0) return 'Every string that can play that pitch already has a note on this beat.';

  const lowest = Math.min(...free.map(candidate => candidate.fret));
  const onCaretString = free.find(candidate => candidate.string === caretString && candidate.fret - lowest <= CARET_STRING_REACH);
  const chosen = onCaretString ?? free.find(candidate => candidate.fret === lowest) ?? free[0];
  return { kind: 'fretted', string: chosen.string, fret: chosen.fret };
}

/**
 * What writing `pitch` on `beat` of `staff` does, or why it cannot.
 *
 * On a staff with a tuning a pitched note - Pen's click - is fretted (`frettedPlacementOf`), or, when the beat already
 * sounds that pitch, takes that note out, as the same click does on a staff with no tuning. A fret past `maxFretOf` the
 * staff - a typed number, with a capo on - is refused, and so is a fret on a staff with no strings. Anything else is
 * written as it is.
 */
export function staffEntryOf(staff: StaffDoc, beat: BeatDoc | null, pitch: NotePitch, caretString: number | null): StaffEntry | string {
  const stringed = staff.tuning.length > 0;
  if (!stringed) return pitch.kind === 'fretted' ? 'A staff with no strings has no fret to write.' : { kind: 'write', pitch };
  if (pitch.kind === 'fretted') return pitch.fret > maxFretOf(staff) ? `${fretRangeOf(staff)}.` : { kind: 'write', pitch };

  const notes = beat?.notes ?? [];
  const midi = soundingMidiOf(staff, pitch);
  const sounding = notes.findIndex(note => soundingMidiOf(staff, note.pitch) === midi);
  if (sounding >= 0) return { kind: 'remove', index: sounding };

  const placed = frettedPlacementOf(staff, midi, stringsTakenOn(notes), caretString);
  return typeof placed === 'string' ? placed : { kind: 'write', pitch: placed };
}

/** The strings a beat's fretted notes are on. */
function stringsTakenOn(notes: BeatDoc['notes']): Set<number> {
  return new Set(notes.flatMap(note => (note.pitch.kind === 'fretted' ? [note.pitch.string] : [])));
}

/** What `replaceDocument` says when `frettedDocOf` left notes out. */
export function outOfReachNoticeOf(dropped: number): string {
  return dropped === 1
    ? "1 note was out of reach of its staff's strings, and was left out."
    : `${dropped} notes were out of reach of their staves' strings, and were left out.`;
}

/**
 * `doc` with every pitched note on a staff with a tuning fretted, how many it fretted (`converted`), and how many notes no
 * free string reached, which are left out - a beat left with none becomes a rest. The same document when there is nothing
 * to fret; otherwise a copy.
 *
 * Each note takes the lowest free fret (`frettedPlacementOf`), in the beat's order, after the fretted notes already
 * there. For a document that arrives from outside the entry commands: a load, an applied alphaTex draft, a document
 * saved before Pen wrote frets. The mapper asks it too, so nothing pitched reaches alphaTab on a string.
 */
export function frettedDocOf(doc: ScoreDoc): { doc: ScoreDoc; converted: number; dropped: number } {
  const needsFretting = doc.tracks.some(track =>
    track.staves.some(staff => staff.tuning.length > 0 && staff.bars.some(bar => bar.voices.some(voice => voice.beats.some(beat => beat.notes.some(note => note.pitch.kind === 'pitched')))))
  );
  if (!needsFretting) return { doc, converted: 0, dropped: 0 };

  const copy = structuredClone(doc);
  let dropped = 0;
  let converted = 0;
  for (const staff of copy.tracks.flatMap(track => track.staves)) {
    if (staff.tuning.length === 0) continue;
    for (const beat of staff.bars.flatMap(bar => bar.voices.flatMap(voice => voice.beats))) {
      if (!beat.notes.some(note => note.pitch.kind === 'pitched')) continue;
      const taken = stringsTakenOn(beat.notes);
      beat.notes = beat.notes.filter(note => {
        if (note.pitch.kind === 'fretted') return true;
        const placed = frettedPlacementOf(staff, soundingMidiOf(staff, note.pitch), taken, null);
        if (typeof placed === 'string') {
          dropped++;
          return false;
        }
        taken.add(placed.string);
        note.pitch = placed;
        converted++;
        return true;
      });
      if (beat.notes.length === 0) beat.isRest = true;
    }
  }
  return { doc: copy, converted, dropped };
}
