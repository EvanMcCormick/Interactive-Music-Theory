import { BeatDoc, NoteDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef } from './composer-selection';

/**
 * Where a note's technique lands, asked of a `ScoreDoc` the way alphaTab 1.8 asks it of a finished
 * score, so a tool can refuse what a save would drop.
 *
 * Mirrors three lookups on alphaTab's `Note` (`alphaTab.core.mjs` in 1.8): `nextNoteOnSameLine`
 * (~6477) and `findHammerPullDestination` (~6489), which `Note.finish` uses to keep or clear a slide
 * and a hammer-on (~6282-6303), and `findTieOrigin` (~6530), whose answer the renderer and the MIDI
 * generator read a tied note's vibrato from (~48360, ~63881, ~64605). `note-landing.spec.ts` checks
 * the first two against alphaTab itself, layout by layout.
 */

/** alphaTab's `Note._maxOffsetForSameLineSearch`: how many bars back a tie's origin is looked for. */
const SAME_LINE_BAR_REACH = 3;

/**
 * The beats a forward search from `ref` reaches when alphaTab finishes a score: the rest of `ref`'s bar
 * in its voice, and the next bar's first beat in the same voice.
 *
 * Not the three bars `Note.nextNoteOnSameLine` and `findHammerPullDestination` are written to search.
 * `Staff.finish` finishes bars in order (~12707), and `Voice.finish` (~3195) chains all of its beats -
 * linking its last to the next bar's first (`Voice._chain`, ~3154-3170) - before finishing any. So when
 * a note is finished the next bar's first beat is linked, and nothing after it is yet.
 * `note-landing.spec.ts` pins this against alphaTab layout by layout.
 */
function beatsAfter(doc: ScoreDoc, ref: BeatRef): BeatDoc[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const inBar = bars[ref.barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
  const nextFirst = bars[ref.barIndex + 1]?.voices[ref.voiceIndex]?.beats[0];
  return nextFirst ? [...inBar.slice(ref.beatIndex + 1), nextFirst] : inBar.slice(ref.beatIndex + 1);
}

/**
 * The beats before `ref`'s in its voice, nearest first, as `Beat.previousBeat` walks them, back to the
 * bar three before `ref`'s. Earlier bars are chained by the time a note finishes, so this bound is the
 * one alphaTab applies. The chain breaks at a bar whose voice has no beats, so the walk stops there.
 */
function beatsBefore(doc: ScoreDoc, ref: BeatRef): BeatDoc[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const beats: BeatDoc[] = [];
  const first = Math.max(0, ref.barIndex - SAME_LINE_BAR_REACH);
  for (let barIndex = ref.barIndex; barIndex >= first; barIndex--) {
    const inBar = bars[barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
    if (barIndex < ref.barIndex && inBar.length === 0) break;
    beats.push(...(barIndex === ref.barIndex ? inBar.slice(0, ref.beatIndex) : inBar).reverse());
  }
  return beats;
}

/** The note alphaTab finds on tab string `string` of `beat`. A rest has none: the mapper writes no notes on one. */
function noteOnString(beat: BeatDoc, string: number): NoteDoc | null {
  if (beat.isRest) return null;
  return beat.notes.find(note => note.pitch.kind === 'fretted' && note.pitch.string === string) ?? null;
}

/**
 * The note on `beat` on the nearest string numbered below `string` (`direction` -1) or above it (+1).
 * alphaTab numbers strings the other way up from tab numbering, but it searches both directions, so
 * which is which does not change whether a destination exists.
 */
function nearestNote(beat: BeatDoc, string: number, direction: -1 | 1): NoteDoc | null {
  if (beat.isRest) return null;
  let nearest: NoteDoc | null = null;
  for (const note of beat.notes) {
    if (note.pitch.kind !== 'fretted') continue;
    const distance = (note.pitch.string - string) * direction;
    if (distance <= 0) continue;
    if (!nearest || (nearest.pitch.kind === 'fretted' && distance < (nearest.pitch.string - string) * direction)) nearest = note;
  }
  return nearest;
}

/**
 * The note a hammer-on or pull-off on `note` would land on, or null when alphaTab would drop it: on the
 * first beat after it - later in its bar, or the next bar's first beat (`beatsAfter`) - with a note on
 * the same string, or a left-hand tap on the nearest string below or above where that string has no
 * note. A pitched note has no string, so it never lands.
 */
export function hammerDestinationOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (note.pitch.kind !== 'fretted') return null;
  const string = note.pitch.string;
  for (const beat of beatsAfter(doc, ref)) {
    const same = noteOnString(beat, string);
    if (same) return same;
    const below = nearestNote(beat, string, -1);
    if (below?.effects.isLeftHandTapped) return below;
    const above = nearestNote(beat, string, 1);
    if (above?.effects.isLeftHandTapped) return above;
  }
  return null;
}

/**
 * The note a shift or legato slide on `note` would run into, or null when alphaTab would drop it: the
 * first note on the same string later in its bar or on the next bar's first beat (`beatsAfter`). A
 * pitched note has no string, so it never lands.
 */
export function slideTargetOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (note.pitch.kind !== 'fretted') return null;
  const string = note.pitch.string;
  for (const beat of beatsAfter(doc, ref)) {
    const same = noteOnString(beat, string);
    if (same) return same;
  }
  return null;
}

/**
 * The note a tied `note` is tied from, as alphaTab finds it, or null when `note` is not tied or has no
 * origin within three bars back: on a string, the nearest earlier note on the same string; pitched,
 * the nearest earlier note of the same pitch.
 */
export function tieOriginOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  if (!note.isTied) return null;
  const pitch = note.pitch;
  for (const beat of beatsBefore(doc, ref)) {
    if (pitch.kind === 'fretted') {
      const same = noteOnString(beat, pitch.string);
      if (same) return same;
    } else if (!beat.isRest) {
      const same = beat.notes.find(
        other => other.pitch.kind === 'pitched' && other.pitch.noteValue === pitch.noteValue && other.pitch.octave === pitch.octave
      );
      if (same) return same;
    }
  }
  return null;
}
