import { MusicTheoryItem } from '../models/music-theory.model';
import { keySignatureKind } from './circle-of-fifths.data';
import {
  SpelledNote,
  formatNote,
  parseNoteName,
  pitchClassOf,
  spellAt,
  spellPitchClass
} from './note-spelling';
import { isHeptatonic } from './progression-harmony';

/**
 * How the fretboard and the keyboard name a note, in two questions.
 *
 * Pure, beside `chord-catalog.ts` and on the same argument: this is the rule the
 * app spells by, not a piece of state, and `MusicTheoryService` reaches 1000
 * lines with it inside. It is also the pair of questions that were previously
 * one - *which accidental* and *which letter* - and separating them is the whole
 * of M3's spelling fix, so they are worth reading together.
 *
 * ## First question: sharps or flats
 *
 * `preferSharps` is the app-wide answer, consulted for every note either
 * surface draws. It reads the key name, the key signature the circle states,
 * and the item's own default, in that order - and the order is the interesting
 * part, because one line of it was wrong for four keys. See the function.
 *
 * ## Second question: which letter
 *
 * A preference chooses between two names for one pitch class. It cannot choose
 * a *letter*, because a pitch class does not have one - which is why F locrian
 * printed `G♯` for a note that is unambiguously an A flat, and why no amount of
 * fixing the first question would have fixed it. A degree has a letter, and so
 * does a place in a chord: `noteName` spells an in-scale note by the letter its
 * degree names and a chord tone by the letter its `steps` entry names, exactly
 * as `progression-spelling.ts` does for the composer.
 *
 * The two surfaces now agree because they run the same arithmetic over the same
 * `note-spelling.ts`, rather than because anyone keeps two tables in step.
 *
 * ## What deliberately stays on the chromatic tables
 *
 * `noteName` answers `null` - meaning "the caller's own table spelling, please"
 * - for four things, and none of them is a failure:
 *
 *  - **a note outside the selected scale or chord.** The fretboard draws all
 *    twelve pitch classes and only seven of them have a degree. A note with no
 *    place in the thing on screen has no letter the thing on screen can name.
 *  - **a scale with no one-letter-per-degree reading.** A pentatonic has five
 *    degrees and cannot spread them over seven letters; a bebop scale has eight
 *    and cannot fit. `isHeptatonic` is the test, shared with the composer.
 *  - **the `fretboardNotes` display modes.** "All Notes (Sharps)" is not a key
 *    with a sharp in it - it is an instruction about which accidentals to draw,
 *    and a degree letter would overrule the choice the user made by picking it.
 *  - **a spelling past a double accidental.** `spellAt` refuses those and states
 *    why on itself. A triple sharp is not notation, so there is no better
 *    spelling being passed over.
 */

/**
 * The part of the app's selection either question needs.
 *
 * A record rather than the service, so both rules are testable with no injector
 * and neither can reach for a piece of state nobody wrote down here.
 */
export interface SpellingSelection {
  /** `MusicTheoryState.selectedCategory`. */
  categoryId: string;

  /** `MusicTheoryState.selectedItem`, which is the scale id `keySignatureKind` reads. */
  itemId: string;

  /** The key's *name* as the state stores it: `'C'`, `'Gb'`, `'D#/Eb'`. */
  keyName: string;

  /** Its pitch class, or -1 for a name neither chromatic table holds. */
  keyIndex: number;

  /** The selected scale or chord, or undefined when the id resolves to none. */
  item: MusicTheoryItem | undefined;

  /**
   * How the caller spells the root, when a table name cannot.
   *
   * The progression composer lights the fretboard with its own chord, and that
   * chord's root can be a `C♭` - a name `selectedKey` may not hold, because the
   * key dropdown and `getNoteIndex` both compare against the twelve. So the key
   * stays a table name and the true spelling rides beside it. Ignored unless it
   * names the same pitch class, which is what makes a stale one harmless.
   */
  rootSpelling?: string;
}

/** Key names that carry flats whatever else is true of the selection. */
const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

/**
 * Whether the app spells this selection with sharps.
 *
 * Six rules in order, and the fourth is the one M3 changed.
 *
 * 1. **No item at all** - nothing to ask, and sharps is the app's default.
 * 2. **An explicit `fretboardNotes` overlay wins.** "All Notes (Flats)" is a
 *    request for flats and nothing may overrule it.
 * 3. **A traditionally flat key name wins**, `FLAT_KEYS` above. It carries `F`,
 *    which is the one name in it with no accidental to read.
 * 4. **A single name states its own spelling; a combined one has none.**
 *    `'F#'` says sharp and `'Gb'` says flat, so those answer for themselves.
 *    `'D#/Eb'` names one pitch class twice and says *both*, so it says nothing,
 *    and the key signature below decides instead.
 * 5. **The key's own signature**, for a mode that has one. A signature is a
 *    property of the key rather than of the scale shape: E minor has one sharp
 *    because its relative major is G. The rule lives in
 *    `circle-of-fifths.data.ts`, beside the table it reads, because
 *    `ProgressionService` needs the same answer for a key this app has never
 *    been told about.
 * 6. Otherwise the item's own preference; a chord, which has none, is sharp.
 *
 * ## What rule 4 used to be, and what it cost
 *
 * It tested the name for a `'#'` before a `'b'`. Every combined name in
 * `chromaticScaleWithBoth` carries both spellings, so all five came back sharp
 * - and selecting `D#/Eb` with ionian gave a circle wedge reading "Eb", a
 * fretboard and a palette reading "D#", and an engraved signature of
 * `fifths: -3`, which is E flat major. Same for `A#/Bb`, `G#/Ab` and `C#/Db`.
 * The staff was the musically right one: D sharp major has nine sharps and is
 * not on the circle at all.
 *
 * Rule 5 already held the answer, as data, for every one of them - and it holds
 * the right answer for the minor modes too, where the two spellings are not
 * equally far out: `G#/Ab` aeolian is G sharp minor at five sharps rather than
 * A flat minor at seven, and comes back sharp, while `A#/Bb` aeolian is B flat
 * minor at five flats rather than A sharp minor at seven, and comes back flat.
 * A rule reading the name could not have told those two apart in either
 * direction.
 *
 * `F#/Gb` is the one combined name whose answer does not move, and that is also
 * data rather than luck: six o'clock is the single position the circle carries
 * both halves of, and its own `accidentalKind` is sharp.
 *
 * Recorded as finding 2 of the M2 review in the progression design doc, and
 * forced by the degree letters below - a wrong tonic letter propagates through
 * all seven degrees, so E flat major would have been printed D♯ E♯ F𝄪, which is
 * worse than the D♯ F G♯ it printed before.
 */
export function preferSharps(selection: SpellingSelection): boolean {
  const { categoryId, itemId, keyName, item } = selection;

  if (!item) return true;

  if (categoryId === 'fretboardNotes') {
    if (itemId === 'allNotesSharp' || itemId === 'sharps') return true;
    if (itemId === 'allNotesFlat' || itemId === 'flats') return false;
  }

  if (FLAT_KEYS.includes(keyName)) return false;

  // Rule 4. A name holding a slash holds two spellings and settles nothing.
  if (!keyName.includes('/') && (keyName.includes('#') || keyName.includes('b'))) {
    return keyName.includes('#');
  }

  const signature = keySignatureKind(itemId, selection.keyIndex);
  if (signature === 'sharp') return true;
  if (signature === 'flat') return false;

  return item.preferSharps ?? true;
}

/**
 * The letter this note is written on in the selected scale or chord, or null
 * when the selection cannot name one. See the header for all four nulls.
 *
 * One loop covers both cases because they differ only in which letter step each
 * position takes: a scale's nth degree is n letters above the tonic, and a
 * chord's nth note is `steps[n]` letters above its root. `steps` is stored on a
 * chord rather than derived because semitones cannot settle it - nine above the
 * root is a sixth in `6` and a seventh in `diminished7`, which is why a
 * diminished seventh on B is `B D F Ab` and not `B D F G#`.
 *
 * The first position matching wins. In a heptatonic scale there is at most one,
 * since two degrees on a pitch class would mean two letters for one note; in a
 * chord that doubles a pitch class an octave apart the lower rung names it,
 * which is the rung the ear hears the chord from.
 */
export function noteName(noteValue: number, selection: SpellingSelection): string | null {
  const { item } = selection;
  if (!item || selection.keyIndex < 0) return null;
  if (selection.categoryId === 'fretboardNotes') return null;

  const steps = item.steps;
  if (steps ? steps.length !== item.intervals.length : !isHeptatonic(item.intervals)) {
    return null;
  }

  const root = rootSpelling(selection);
  const rootPitch = pitchClassOf(root);
  const wanted = ((noteValue % 12) + 12) % 12;

  for (let position = 0; position < item.intervals.length; position++) {
    if ((rootPitch + item.intervals[position]) % 12 !== wanted) continue;

    const spelled = spellAt(wanted, root, steps ? steps[position] : position);
    return spelled ? formatNote(spelled) : null;
  }

  return null;
}

/**
 * The letter every other letter here is counted from.
 *
 * The caller's spelling when it gave one and it still names the key's pitch
 * class; the key's own otherwise. The pitch-class check is what keeps a
 * spelling left behind by a chord that has stopped sounding from renaming a key
 * it has nothing to do with.
 */
function rootSpelling(selection: SpellingSelection): SpelledNote {
  const given = selection.rootSpelling ? parseNoteName(selection.rootSpelling) : null;
  if (given && pitchClassOf(given) === selection.keyIndex) return given;

  return spellPitchClass(selection.keyIndex, preferSharps(selection));
}
