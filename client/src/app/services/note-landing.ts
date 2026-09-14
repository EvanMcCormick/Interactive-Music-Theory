import { BeatDoc, NoteDoc, ScoreDoc } from '../models/composer.model';
import { BeatRef, beatAt } from './composer-selection';

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
 *
 * Walked by index, back to front. A reader must never change the document it reads: `reverse()` on an
 * earlier bar's own `beats` array reversed that bar in the published document, with no undo step, every
 * time a tie or vibrato tool asked.
 */
function beatsBefore(doc: ScoreDoc, ref: BeatRef): BeatDoc[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const beats: BeatDoc[] = [];
  const first = Math.max(0, ref.barIndex - SAME_LINE_BAR_REACH);
  for (let barIndex = ref.barIndex; barIndex >= first; barIndex--) {
    const inBar = bars[barIndex]?.voices[ref.voiceIndex]?.beats ?? [];
    if (barIndex < ref.barIndex && inBar.length === 0) break;
    const end = barIndex === ref.barIndex ? Math.min(ref.beatIndex, inBar.length) : inBar.length;
    for (let beatIndex = end - 1; beatIndex >= 0; beatIndex--) beats.push(inBar[beatIndex]);
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
  return note.isTied ? tieCandidateOf(doc, ref, note) : null;
}

/**
 * The note a tie on `note` would be tied from, tied or not: what `tieOriginOf` finds once `note` is tied.
 * With none, alphaTab clears the tie (`Note.finish`, `alphaTab.core.mjs` ~6612), so a tie tool refuses it.
 */
export function tieCandidateOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): NoteDoc | null {
  for (const beat of beatsBefore(doc, ref)) {
    const same = sameLineNote(beat, note);
    if (same) return same;
  }
  return null;
}

/** The note on `beat` alphaTab would take for `note`'s line: the same string, or pitched, the same pitch. */
function sameLineNote(beat: BeatDoc, note: NoteDoc): NoteDoc | null {
  const pitch = note.pitch;
  if (pitch.kind === 'fretted') return noteOnString(beat, pitch.string);
  if (beat.isRest) return null;
  return (
    beat.notes.find(
      other => other.pitch.kind === 'pitched' && other.pitch.noteValue === pitch.noteValue && other.pitch.octave === pitch.octave
    ) ?? null
  );
}

/** A note, and the beat it is on. The shape of `note-edits.ts`'s `NoteTarget`, which imports this module. */
export interface PlacedNote {
  ref: BeatRef;
  note: NoteDoc;
}

/** Every beat of `ref`'s staff and voice in bars `firstBar` to `lastBar`, in order. */
function beatRefsIn(doc: ScoreDoc, ref: BeatRef, firstBar: number, lastBar: number): BeatRef[] {
  const bars = doc.tracks[ref.trackIndex]?.staves[ref.staffIndex]?.bars ?? [];
  const refs: BeatRef[] = [];
  for (let barIndex = Math.max(0, firstBar); barIndex <= Math.min(lastBar, bars.length - 1); barIndex++) {
    (bars[barIndex]?.voices[ref.voiceIndex]?.beats ?? []).forEach((_, beatIndex) => refs.push({ ...ref, barIndex, beatIndex }));
  }
  return refs;
}

const isBefore = (a: BeatRef, b: BeatRef): boolean => a.barIndex < b.barIndex || (a.barIndex === b.barIndex && a.beatIndex < b.beatIndex);

/**
 * Every note of the tie chain `note` is in, first to last: the notes it is tied from, back to one that is
 * not tied, and the notes tied onward from it. A note in no tie is a chain of one.
 *
 * `Note.finish` (~6619) copies a tie origin's `fret`, `octave` and `tone` onto its destination, so a
 * move of one end alone is overwritten on the next save, or - moved to another string - loses the tie.
 * Guitar Pro moves the whole chain, and the moves here do too.
 */
export function tieChainOf(doc: ScoreDoc, ref: BeatRef, note: NoteDoc): PlacedNote[] {
  const chain: PlacedNote[] = [{ ref, note }];
  const seen = new Set<NoteDoc>([note]);

  for (let current = chain[0]; ; ) {
    const origin = tieOriginOf(doc, current.ref, current.note);
    const originRef = origin
      ? beatRefsIn(doc, current.ref, current.ref.barIndex - SAME_LINE_BAR_REACH, current.ref.barIndex)
          .filter(candidate => isBefore(candidate, current.ref))
          .reverse()
          .find(candidate => beatAt(doc, candidate)?.notes.includes(origin))
      : undefined;
    if (!origin || !originRef || seen.has(origin)) break;
    current = { ref: originRef, note: origin };
    seen.add(origin);
    chain.unshift(current);
  }

  for (let current: PlacedNote = { ref, note }; ; ) {
    const next = nextOnLine(doc, current);
    if (!next || !next.note.isTied || seen.has(next.note) || tieOriginOf(doc, next.ref, next.note) !== current.note) break;
    seen.add(next.note);
    chain.push(next);
    current = next;
  }
  return chain;
}

/** The first note after `placed` on its line - its string, or its pitch - within the bars a tie reaches. */
function nextOnLine(doc: ScoreDoc, placed: PlacedNote): PlacedNote | null {
  for (const candidate of beatRefsIn(doc, placed.ref, placed.ref.barIndex, placed.ref.barIndex + SAME_LINE_BAR_REACH)) {
    if (!isBefore(placed.ref, candidate)) continue;
    const beat = beatAt(doc, candidate);
    const same = beat ? sameLineNote(beat, placed.note) : null;
    if (same) return { ref: candidate, note: same };
  }
  return null;
}
