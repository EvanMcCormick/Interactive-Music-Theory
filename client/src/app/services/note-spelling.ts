import { NoteLetter } from '../models/composer.model';
import { STEP_SEMITONES } from './staff-pitch';

/**
 * Writing a note as a letter and an accidental, rather than as one of twelve
 * fixed names.
 *
 * Pure, with no Angular dependency, following the `staff-pitch.ts` precedent it
 * borrows `STEP_SEMITONES` from - and deliberately with no dependency on
 * `MusicTheoryService` either, because every fallback in the milestone that
 * adopts this calls `spellPitchClass`, and a module that had to inject the
 * Angular service just to name a pitch class would push that injection into
 * every one of them.
 *
 * ## Why a letter at all
 *
 * `MusicTheoryService` spells from two twelve-name chromatic arrays, and
 * between them they hold no `C♭`, `F♭`, `B♯`, `E♯` or double accidental. So a
 * chord root whose correct spelling is one of those comes back as the wrong
 * *letter* and the numeral above it contradicts the name beside it: B♭ major's
 * `♭II` is a C flat and prints `B Maj`, which reads as a raised seventh. The
 * design doc counts 55 such buttons across the seven diatonic modes in all
 * twelve keys.
 *
 * No *preference* can fix that, which is the part worth keeping hold of. A
 * preference chooses between two names for one pitch class, and pitch class 11
 * in B♭ major has to be a C flat rather than a B natural - the same pitch, a
 * different letter. Carrying the letter apart from the accidental is what makes
 * that expressible.
 *
 * ## Why the letter comes from the degree and not from the pitch
 *
 * A pitch class does not say which letter it is; a *degree* does. The second
 * degree of any key is written on the letter one step above the tonic's,
 * whatever accidental it carries and whatever the numeral does to it - so `♭II`
 * of B♭ is still on a C, and pitch class 11 there is a C flat. Likewise a chord
 * tone is written on the letter its place in the chord names: a third is two
 * steps above the root, a seventh six, a ninth one.
 *
 * That is why `spellAt` takes a step count and derives the accidental, rather
 * than taking a pitch class and choosing a letter for it. Anyone tempted to
 * invert it - to pick the letter that needs the smallest accidental, say - would
 * be back to spelling by pitch, and back to `♭II` printing as `B Maj`.
 */

/**
 * A written note: a letter, 0-6 for C through B, and an accidental in semitones.
 *
 * The two are carried apart so the note can *be* a C flat rather than being
 * whichever of twelve names shares its pitch. Negative accidentals flatten.
 */
export interface SpelledNote {
  letter: number;
  accidental: number;
}

/** Letter names in step order, so the index is the letter. */
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** A double accidental is the furthest conventional notation goes. */
const MAX_ACCIDENTAL = 2;

/** One upper-case letter, then up to two of a single accidental sign. */
const NOTE_NAME_PATTERN = /^([A-G])(#{1,2}|b{1,2})?$/;

/** Reduces to 0-11, for callers holding a stack that was never reduced. */
function reduceToOctave(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * The note `steps` letters above `from` that sounds `pitchClass`, or null when
 * that letter would need more than a double accidental.
 *
 * The letter is decided entirely by `from` and `steps` - see the header - and
 * the accidental is then whatever lands that letter on the pitch. So the caller
 * says *which degree this is* and gets back the spelling convention agrees on,
 * rather than saying which pitch it is and hoping for the letter it wanted.
 *
 * Null rather than a triple accidental, so the caller chooses its fallback.
 *
 * **When the refusal fires is stated here and nowhere else.**
 * `progression-spelling.ts` is the other module that meets it and it points at
 * this paragraph rather than restating it - the same argument `STEP_SEMITONES`
 * is one table read two ways under. Restating it is how the two came to
 * disagree: that module blamed `alter` and a "doubly-flattened" super locrian
 * fourth, and both halves were wrong.
 *
 * It is reached with no `alter` at all, and one witness is enough to show it.
 * The sixth degree of A♯ enigmatic is written on an F and sounds pitch class 8,
 * three semitones above F, so it is an F triple sharp. Displacement reaches
 * more: D♭ super locrian's fourth is written on a G and sounds pitch class 5,
 * which is already a G double flat before anything is displaced - the tonic is
 * itself flat and the mode's fourth is a diminished one, so the two flattenings
 * add - and `alter: -1` on it asks for a G triple flat.
 *
 * **How far the refusal reaches is measured next door, not here.**
 * `progression-vocabulary.spelling.spec.ts` sweeps all 33 heptatonic scales in
 * all twelve keys on every accidental a slot can store, and pins how many roots
 * fall back at each one, which of them lie in a diatonic mode, and the reason
 * the diatonic ones need a doubly displaced selection to reach. Those figures
 * move when a scale is added, an `ALTER` bound is widened or a `preferSharps`
 * changes, and that spec fails loudly when they do. A copy of them in this
 * docstring would go on stating the old figure in silence, which is the drift
 * the measurement was written down to stop - one layer up.
 *
 * ## What this module does not know
 *
 * Letter arithmetic, and nothing else. It is never given a key, a key signature
 * or a scale, and it has never heard of `chordVocabulary`'s alternates row - so
 * a count of misspelt *buttons*, which is a count of unspellable roots times
 * however many shapes that row offers each of them, is not a fact this file
 * could state even in principle. `from` and `steps` are the whole of the input
 * and both are the caller's to decide, which is what keeps the same three lines
 * spelling a chord tone, a scale degree and a borrowed root.
 *
 * Both arguments take unreduced input: `steps` may be negative or past a
 * seventh, and `pitchClass` may be a chord-stack member that crossed the octave
 * without being reduced, as `degreePitchClasses` returns them.
 */
export function spellAt(
  pitchClass: number,
  from: SpelledNote,
  steps: number
): SpelledNote | null {
  const letter = (((from.letter + steps) % 7) + 7) % 7;
  // The signed distance from the natural letter to the pitch, read as the
  // nearer of its two representatives: -6..5. Reading it nearest is what makes
  // B to C an ascent of one rather than a descent of eleven, which is the whole
  // question at an octave boundary - B♯ and C♭ live on opposite sides of one.
  const accidental =
    ((((pitchClass - STEP_SEMITONES[letter] + 6) % 12) + 12) % 12) - 6;

  return Math.abs(accidental) > MAX_ACCIDENTAL ? null : { letter, accidental };
}

/** The pitch class a spelled note sounds, 0-11. */
export function pitchClassOf(note: SpelledNote): number {
  return reduceToOctave(STEP_SEMITONES[note.letter] + note.accidental);
}

/**
 * A spelled note as text: `Cb`, `Ebb`, `F##`, `C`.
 *
 * ASCII rather than ♭ and ♯, to match the chromatic tables this replaces - the
 * names it produces are compared against theirs and printed beside them.
 */
export function formatNote(note: SpelledNote): string {
  const sign = note.accidental < 0 ? 'b' : '#';
  return LETTER_NAMES[note.letter] + sign.repeat(Math.abs(note.accidental));
}

/** The staff letter of a spelling, for a caller that wants the letter alone. */
export function letterOf(spelled: SpelledNote): NoteLetter {
  return LETTER_NAMES[((spelled.letter % 7) + 7) % 7];
}

/**
 * A note name read back into a spelling, or null when it is not one.
 *
 * The inverse of `formatNote` over exactly what `formatNote` writes: one
 * upper-case letter and up to two of a single accidental sign. Anything else is
 * null rather than a guess - `'C#/Db'` is a chromatic *table* entry naming two
 * notes, and reading it as either one silently would be choosing a spelling,
 * which is the thing this module exists to stop happening by accident.
 */
export function parseNoteName(name: string): SpelledNote | null {
  const match = NOTE_NAME_PATTERN.exec(name);
  if (!match) return null;

  const letter = LETTER_NAMES.indexOf(match[1] as (typeof LETTER_NAMES)[number]);
  const marks = match[2] ?? '';
  const accidental = marks.startsWith('b') ? -marks.length : marks.length;

  return { letter, accidental };
}

/**
 * The octave number a spelled note is written in, given the MIDI it sounds.
 *
 * Numbered by the **letter**, not by the pitch, which is the same rule as the
 * rest of the module and the one place it is visible without a chord around it:
 * C♭5 sounds MIDI 71, a semitone below C5, and is written in octave 5 all the
 * same. Numbering it by the pitch would print `Cb4`, a C below the C it is a
 * flattened form of. B♯3 is the mirror case - MIDI 60, the pitch of C4.
 *
 * Undoing the accidental recovers the natural letter's own MIDI, and a natural
 * letter is never on the wrong side of its octave boundary.
 */
export function scientificOctave(midi: number, spelled: SpelledNote): number {
  return Math.floor((midi - spelled.accidental) / 12) - 1;
}

/**
 * A bare pitch class spelled by preference, as the chromatic tables spell one.
 *
 * The fallback for everywhere no degree is in hand to take a letter from: a
 * note outside the scale, a tonic straight off the circle, a degree whose
 * spelling `spellAt` refused. Being the fallback is why it lives here rather
 * than staying on `MusicTheoryService` - every caller of `spellAt` needs it,
 * and none of them should need an injector for it.
 *
 * The seven natural pitch classes are their own letter whatever the preference,
 * so the preference only ever decides a black key, and it decides it the way
 * the two tables do: the letter below sharpened, or the letter above flattened.
 * Neither neighbour is itself a black key, so one step is always enough.
 */
export function spellPitchClass(pc: number, preferSharps: boolean): SpelledNote {
  const reduced = reduceToOctave(pc);

  const natural = STEP_SEMITONES.indexOf(reduced);
  if (natural >= 0) return { letter: natural, accidental: 0 };

  return preferSharps
    ? { letter: STEP_SEMITONES.indexOf(reduced - 1), accidental: 1 }
    : { letter: STEP_SEMITONES.indexOf(reduced + 1), accidental: -1 };
}
