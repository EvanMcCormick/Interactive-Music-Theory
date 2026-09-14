import { BeatDoc, NoteDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef, beatAt } from './composer-selection';
import { drawnPitchClassOf } from './edit-refusals';
import { noteTargetsAt } from './note-edits';
import { forcedLetterOf, reduceToOctave } from './note-spelling';

/**
 * Moving notes by pitch or by string. Each move checks every note first and returns why it refused
 * before changing anything, so a press is whole or nothing.
 */

/** The highest fret a note can move to, as the fret digits allow. */
const MAX_FRET = 24;

/**
 * Moves every note the press means by `delta` semitones, or returns why not and changes nothing.
 *
 * A fret moves by `delta`; a pitched note moves by `delta` across octave boundaries and loses its
 * `letter`, which named the old pitch. `trill.value` is a pitch, so it moves too. A forced accidental
 * that cannot name the new drawn pitch returns to `auto` (see `forcedLetterOf`).
 */
export function shiftSemitone(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const targets = noteTargetsAt(doc, refs, focus);
  const direction = delta > 0 ? 'up' : 'down';

  for (const { note } of targets) {
    if (note.pitch.kind === 'fretted') {
      const fret = note.pitch.fret + delta;
      if (fret < 0 || fret > MAX_FRET) return `A fret runs from 0 to ${MAX_FRET}, so a note in the selection cannot move ${direction} a semitone.`;
    } else {
      const midi = (note.pitch.octave + 1) * 12 + note.pitch.noteValue + delta;
      if (midi < 0 || midi > 127) return `A note in the selection is at the edge of the MIDI range and cannot move ${direction}.`;
    }
  }

  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff) continue;
    if (note.pitch.kind === 'fretted') {
      note.pitch = { ...note.pitch, fret: note.pitch.fret + delta };
    } else {
      const midi = (note.pitch.octave + 1) * 12 + note.pitch.noteValue + delta;
      note.pitch = { kind: 'pitched', noteValue: reduceToOctave(midi), octave: Math.floor(midi / 12) - 1 };
    }
    if (note.effects.trill) note.effects.trill = { ...note.effects.trill, value: note.effects.trill.value + delta };
    if (note.accidental !== 'auto' && forcedLetterOf(note.accidental, drawnPitchClassOf(staff, note.pitch)) === undefined) {
      note.accidental = 'auto';
    }
  }
  return null;
}

/**
 * Moves every note the press means to the string `delta` away in tab numbering - -1 the string above,
 * higher in pitch; +1 the one below - keeping its pitch, or returns why not and changes nothing.
 *
 * The fret moves by the difference between the two strings' open pitches. Refused on a pitched staff,
 * for a string past either edge, for a fret off the fretboard, and where two notes of one beat would
 * end on one string - a note moving off a string frees it for another moving on.
 */
export function moveNotesToString(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const direction = delta < 0 ? 'above' : 'below';
  const moves = new Map<NoteDoc, { string: number; fret: number }>();
  const beats = new Set<BeatDoc>();

  for (const { ref, note } of noteTargetsAt(doc, refs, focus)) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff || note.pitch.kind !== 'fretted' || staff.tuning.length === 0) {
      return 'A pitched staff has no strings to move a note between.';
    }
    const string = note.pitch.string + delta;
    if (string < 1 || string > staff.tuning.length) return `There is no string ${direction} a note in the selection.`;
    const fret = note.pitch.fret + (staff.tuning[note.pitch.string - 1] ?? 0) - (staff.tuning[string - 1] ?? 0);
    if (fret < 0 || fret > MAX_FRET) return `A note in the selection does not fit on the string ${direction}: it would need fret ${fret}.`;
    moves.set(note, { string, fret });
    const beat = beatAt(doc, ref);
    if (beat) beats.add(beat);
  }

  for (const beat of beats) {
    const strings = beat.notes.map(note => moves.get(note)?.string ?? (note.pitch.kind === 'fretted' ? note.pitch.string : 0));
    if (new Set(strings).size !== strings.length) return `The string ${direction} already has a note on that beat.`;
  }

  for (const [note, { string, fret }] of moves) {
    note.pitch = { kind: 'fretted', string, fret };
  }
  return null;
}
