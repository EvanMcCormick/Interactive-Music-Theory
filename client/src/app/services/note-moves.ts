import { BeatDoc, NoteDoc, NotePitch, ScoreDoc } from '../models/composer.model';
import { BeatRef, beatAt } from './composer-selection';
import { drawnPitchClassOf } from './edit-refusals';
import { NoteTarget, noteTargetsAt } from './note-edits';
import { PlacedNote, hammerDestinationOf, slideTargetOf, tieChainOf, tieOriginOf } from './note-landing';
import { respellingsOf } from './note-respell';
import { reduceToOctave } from './note-spelling';
import { STEP_SEMITONES } from './staff-pitch';

/**
 * Moving notes by pitch or by string. Each move checks every note first and returns why it refused
 * before changing anything, so a press is whole or nothing.
 *
 * A move takes a note's whole tie chain with it (`tieChainOf`): `Note.finish` copies a tie origin's fret
 * and pitch onto its destination (`alphaTab.core.mjs` ~6619), so one end moved alone is overwritten on
 * the next save, or loses its tie on another string. Guitar Pro moves the chain too.
 */

/** The highest fret a note can move to, as the fret digits allow. */
const MAX_FRET = 24;

/** The MIDI range a pitch and a trill's `value` must stay in. */
const MIDI_TOP = 127;

/**
 * The frets a natural harmonic sounds at, as alphaTab reads them: every fret `ModelUtils.deltaFretToHarmonicValue`
 * (`alphaTab.core.mjs` ~4123) names a node for. Any other fret it plays as the octave harmonic, which is
 * not what a guitarist can play there.
 */
const NATURAL_HARMONIC_FRETS: ReadonlySet<number> = new Set([2, 3, 4, 5, 7, 8, 9, 10, 12, 14, 15, 16, 17, 19, 21, 22, 24]);

/** Every note the press means, and every note tied to or from one, each once. */
function movedTargetsOf(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null): NoteTarget[] {
  const seen = new Set<NoteDoc>();
  const targets: NoteTarget[] = [];
  for (const target of noteTargetsAt(doc, refs, focus)) {
    for (const placed of tieChainOf(doc, target.ref, target.note)) {
      if (seen.has(placed.note)) continue;
      seen.add(placed.note);
      targets.push(placed);
    }
  }
  return targets;
}

/** Whether moving from `from` to `to` leaves `[min, max]` further behind: a loaded value past an edge may come back. */
const movesOut = (from: number, to: number, min: number, max: number): boolean => (to < min && to < from) || (to > max && to > from);

/**
 * Moves every note the press means by `delta` semitones, or returns why not and changes nothing.
 *
 * A fret moves by `delta`; a pitched note moves by `delta` across octave boundaries and loses its
 * `letter`, which named the old pitch. `trill.value` is a pitch, so it moves too, and a move that would
 * take it out of MIDI's 0 to 127 is refused, since alphaTab drops a trill there. A fret or pitch already
 * past an edge, as a loaded file can have, may move back toward it; only a move further out is refused.
 *
 * A forced accidental stays only where respell would offer it for the new pitch (`respellingsOf`): on a
 * fretted staff a black key's sharp or flat, on a pitched staff a spelling of a black key. Anything else
 * returns to `auto` - B flat moved up would otherwise be C flat, a spelling respell cannot reach and so
 * cannot take back.
 */
export function shiftSemitone(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const targets = movedTargetsOf(doc, refs, focus);
  const direction = delta > 0 ? 'up' : 'down';

  for (const { note } of targets) {
    if (note.pitch.kind === 'fretted') {
      if (movesOut(note.pitch.fret, note.pitch.fret + delta, 0, MAX_FRET)) {
        return `A fret runs from 0 to ${MAX_FRET}, so a note in the selection cannot move ${direction} a semitone.`;
      }
    } else {
      const midi = midiOf(note.pitch);
      if (movesOut(midi, midi + delta, 0, MIDI_TOP)) return `A note in the selection is at the edge of the MIDI range and cannot move ${direction}.`;
    }
    const trill = note.effects.trill;
    if (trill && movesOut(trill.value, trill.value + delta, 0, MIDI_TOP)) {
      return `A trill in the selection is at the edge of the MIDI range, and alphaTab would drop it a semitone ${direction}.`;
    }
  }

  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff) continue;
    if (note.pitch.kind === 'fretted') {
      note.pitch = { ...note.pitch, fret: note.pitch.fret + delta };
    } else {
      const midi = midiOf(note.pitch) + delta;
      note.pitch = { kind: 'pitched', noteValue: reduceToOctave(midi), octave: Math.floor(midi / 12) - 1 };
    }
    if (note.effects.trill) note.effects.trill = { ...note.effects.trill, value: note.effects.trill.value + delta };

    const fretted = note.pitch.kind === 'fretted';
    const pitchClass = drawnPitchClassOf(staff, note.pitch);
    const offered = respellingsOf(pitchClass, fretted).includes(note.accidental);
    const blackKey = !STEP_SEMITONES.includes(pitchClass);
    if (note.accidental !== 'auto' && !(offered && (fretted || blackKey))) note.accidental = 'auto';
  }
  return null;
}

function midiOf(pitch: Extract<NotePitch, { kind: 'pitched' }>): number {
  return (pitch.octave + 1) * 12 + pitch.noteValue;
}

/**
 * Moves every note the press means to the string `delta` away in tab numbering - -1 the string above,
 * higher in pitch; +1 the one below - keeping its pitch, or returns why not and changes nothing.
 *
 * The fret moves by the difference between the two strings' open pitches. Refused on a pitched staff,
 * for a string past either edge, for a fret off the fretboard (a loaded fret past it may come back), for
 * a natural harmonic that would land where none sounds, and where two notes of one beat would end on one
 * string - a note moving off a string frees it for another moving on.
 *
 * Refused too when the move would break what connects notes on a string, which alphaTab finds by
 * string: a hammer-on or a shift or legato slide - the moved note's own, or another note's landing on it
 * - that landed before and would not after (`note-landing.ts`), and a tie whose origin would change,
 * because another note on the new string comes between. Those are checked on the moved notes and put
 * back when the move is refused.
 */
export function moveNotesToString(doc: ScoreDoc, refs: readonly BeatRef[], focus: number | null, delta: 1 | -1): string | null {
  const direction = delta < 0 ? 'above' : 'below';
  const targets = movedTargetsOf(doc, refs, focus);
  const moves = new Map<NoteDoc, { string: number; fret: number }>();
  const beats = new Set<BeatDoc>();

  for (const { ref, note } of targets) {
    const staff = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex];
    if (!staff || note.pitch.kind !== 'fretted' || staff.tuning.length === 0) {
      return 'A pitched staff has no strings to move a note between.';
    }
    const string = note.pitch.string + delta;
    if (string < 1 || string > staff.tuning.length) return `There is no string ${direction} a note in the selection.`;
    const fret = note.pitch.fret + (staff.tuning[note.pitch.string - 1] ?? 0) - (staff.tuning[string - 1] ?? 0);
    if (movesOut(note.pitch.fret, fret, 0, MAX_FRET)) {
      return `A note in the selection does not fit on the string ${direction}: it would need fret ${fret}.`;
    }
    if (note.effects.harmonic === 'natural' && !NATURAL_HARMONIC_FRETS.has(fret)) {
      return `A natural harmonic in the selection would be at fret ${fret} on the string ${direction}, where no natural harmonic sounds.`;
    }
    moves.set(note, { string, fret });
    const beat = beatAt(doc, ref);
    if (beat) beats.add(beat);
  }

  for (const beat of beats) {
    const strings = beat.notes.map(note => moves.get(note)?.string ?? (note.pitch.kind === 'fretted' ? note.pitch.string : 0));
    if (new Set(strings).size !== strings.length) return `The string ${direction} already has a note on that beat.`;
  }

  const landers = connectedNotesAround(doc, targets, -1, 0).filter(placed => landingOf(doc, placed) !== null);
  const tied = connectedNotesAround(doc, targets, 0, 3)
    .filter(placed => placed.note.isTied)
    .map(placed => ({ placed, origin: tieOriginOf(doc, placed.ref, placed.note) }));

  const before = new Map([...moves.keys()].map(note => [note, note.pitch]));
  for (const [note, { string, fret }] of moves) note.pitch = { kind: 'fretted', string, fret };

  const refusal =
    landers.some(placed => landingOf(doc, placed) === null && moves.has(placed.note))
      ? `Moved to the string ${direction}, a note in the selection would lose the note its hammer-on or slide lands on.`
      : landers.some(placed => landingOf(doc, placed) === null)
        ? "Another note's hammer-on or slide lands on a note in the selection, and would have nothing to land on after the move."
        : tied.some(({ placed, origin }) => tieOriginOf(doc, placed.ref, placed.note) !== origin)
          ? 'That would put another note between a tied note and the note it is tied from.'
          : null;

  if (refusal) for (const [note, pitch] of before) note.pitch = pitch;
  return refusal;
}

/**
 * The note a hammer-on, shift slide or legato slide on `placed` lands on, or null - also null when it has
 * none of those, so only notes that connect onward are checked.
 */
function landingOf(doc: ScoreDoc, { ref, note }: PlacedNote): NoteDoc | null {
  if (note.effects.isHammerPullOrigin) return hammerDestinationOf(doc, ref, note);
  if (note.effects.slide === 'shiftSlide' || note.effects.slide === 'legatoSlide') return slideTargetOf(doc, ref, note);
  return null;
}

/**
 * Every note on the staves `targets` are on, in the bars from `before` bars ahead of the first target to
 * `after` bars past the last: where a landing onto a moved note starts (the bar before, whose last beat
 * lands on the next bar's first), or where a tie from one reaches (three bars on).
 */
function connectedNotesAround(doc: ScoreDoc, targets: readonly NoteTarget[], before: number, after: number): PlacedNote[] {
  const placed: PlacedNote[] = [];
  const staves = new Map<string, { ref: BeatRef; first: number; last: number }>();
  for (const { ref } of targets) {
    const key = `${ref.trackIndex}:${ref.staffIndex}:${ref.voiceIndex}`;
    const span = staves.get(key) ?? { ref, first: ref.barIndex, last: ref.barIndex };
    staves.set(key, { ref, first: Math.min(span.first, ref.barIndex), last: Math.max(span.last, ref.barIndex) });
  }
  for (const { ref, first, last } of staves.values()) {
    const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
    for (let barIndex = Math.max(0, first + before); barIndex <= Math.min(bars.length - 1, last + after); barIndex++) {
      (bars[barIndex]?.voices[ref.voiceIndex]?.beats ?? []).forEach((beat, beatIndex) => {
        for (const note of beat.notes) placed.push({ ref: { ...ref, barIndex, beatIndex }, note });
      });
    }
  }
  return placed;
}
