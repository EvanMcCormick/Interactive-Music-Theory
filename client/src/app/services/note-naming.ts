import { MusicTheoryItem } from '../models/music-theory.model';
import { KeySignatureKind, keySignatureKind } from './circle-of-fifths.data';
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
 * 5. **The key's own signature**, for a mode that has one - and for a chord,
 *    the signature its root's own key carries. See `signatureKind` below. A
 *    signature is a property of the key rather than of the scale shape: E minor
 *    has one sharp because its relative major is G. The rule lives in
 *    `circle-of-fifths.data.ts`, beside the table it reads, because
 *    `ProgressionService` needs the same answer for a key this app has never
 *    been told about.
 * 6. Otherwise the item's own preference; sharp where it declares none.
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
 * **`F#/Gb` ionian is the one that does not move**, and the exemption is that
 * narrow. Six o'clock is the single position the circle carries both halves of
 * and its own `accidentalKind` is sharp, so the *ionian* answer is the same one
 * the old name-reading rule gave - which is the whole of what finding 2 claimed,
 * because finding 2 was about the four majors the staff and the palette
 * disagreed on. Read as "F♯/G♭ never moves" it is simply false: 19 items in the
 * app's menu answer differently under `F#/Gb` than under `F#`, and `lydian` is
 * the instructive one and is not a bug - `keySignatureKind('lydian', 6)`
 * inherits from D♭ major and says flat, so `Gb Ab Bb C Db Eb F` is the circle's
 * own answer for it. The true statement is that the circle's answer wins
 * wherever the circle has one, and the sharp/flat halves of a split wedge are
 * not one answer between them. `music-theory.service.spec.ts` pins the whole set
 * of 19 rather than the one case that agrees.
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

  const signature = signatureKind(selection);
  if (signature === 'sharp') return true;
  if (signature === 'flat') return false;

  return item.preferSharps ?? true;
}

/**
 * The signature the selected key carries, or null where convention states none.
 *
 * `keySignatureKind` answers for a scale id it knows. A **chord** id is not one
 * of those and never will be - a chord is a shape rather than a tonality, so
 * there is no mode to work back to a parent major from - and the `null` it
 * returned for one was reaching rule 6, where a chord has no `preferSharps` at
 * all and every chord came back sharp. That is finding 2 one level down: with a
 * combined name selected, `D#/Eb` ionian printed `E♭ F G A♭ B♭ C D` and `D#/Eb`
 * major printed `D♯ F𝄪 A♯`, from one dropdown, in one key. `A#/Bb`'s `7#9`
 * reached a `B𝄪` and a `C𝄪`.
 *
 * So a chord takes its accidental from where the scale beside it takes one:
 * **the circle position for its root's pitch class**. A chord is not in a key,
 * but its root names one, and asking for the ionian signature at that pitch
 * class is asking the circle exactly that question - `MODE_OFFSETS.ionian` is
 * zero, so the parent major is the root itself. No second table, and no new
 * spelling rule: the same data the scale read, read at the same position.
 */
function signatureKind(selection: SpellingSelection): KeySignatureKind | null {
  if (selection.item?.type === 'chord') {
    return keySignatureKind('ionian', selection.keyIndex);
  }

  return keySignatureKind(selection.itemId, selection.keyIndex);
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
 * Three answers in order.
 *
 * 1. **The caller's spelling**, when it gave one and it still names the key's
 *    pitch class. The pitch-class check is what keeps a spelling left behind by
 *    a chord that has stopped sounding from renaming a key it has nothing to do
 *    with.
 * 2. **The key's own**, wherever `signatureKind` answers - which is every
 *    diatonic mode, every scale `MODE_OFFSETS` places, and every chord. The
 *    signature wins there and this rule does not get a vote.
 * 3. Otherwise **whichever of the two names writes this scale most simply**, by
 *    `simplestRoot` below.
 *
 * ## Why the third rule exists
 *
 * Rules 3 and 4 of `preferSharps` read the key *name*, and a name is not always
 * an answer: `F#/Gb` says both things at once and `Gb` says flat because
 * `FLAT_KEYS` holds it. For the ~33 scales `MODE_OFFSETS` deliberately has no
 * entry for, neither the name nor a signature settles the tonic - and before
 * this rule the fall-through reached the *scale shape's* own `preferSharps`,
 * which is the very thing `b514027` was written to stop spelling keys by. One
 * wrong tonic letter then propagates through all seven degrees: `F#/Gb` ultra
 * locrian printed `Gb Abb Bbb Cbb Dbb Ebb Fbb`, six of its seven degrees on a
 * double flat, while the same key through the circle - which publishes the
 * single name `F#` - printed `F# G A Bb C D Eb`. One key, two spellings,
 * decided by which control the user happened to touch.
 *
 * The rule this replaces it with is worth having on its own terms: **where
 * convention has no answer, prefer the spelling that writes the scale most
 * simply.** It is name-blind, so `F#/Gb`, bare `Gb` and bare `F#` reach the same
 * seven letters, which is what makes the two controls agree.
 *
 * ## What it does not reach
 *
 * `preferSharps` is unchanged and stays the app-wide answer for every note with
 * no degree to be spelled from - a note outside the scale, a pentatonic, the
 * display overlays. Those cannot be simplified, because there is no letter under
 * contest: `spellPitchClass` gives a black key one accidental either way. So a
 * no-signature scale in a black key can show degrees on one accidental and
 * out-of-scale notes on the other, and that is the honest split rather than an
 * oversight - the degrees have a convention to satisfy and the rest of the neck
 * only has the preference the user's own key control published.
 */
function rootSpelling(selection: SpellingSelection): SpelledNote {
  const given = selection.rootSpelling ? parseNoteName(selection.rootSpelling) : null;
  if (given && pitchClassOf(given) === selection.keyIndex) return given;

  if (signatureKind(selection) !== null) {
    return spellPitchClass(selection.keyIndex, preferSharps(selection));
  }

  return simplestRoot(selection);
}

/**
 * The accidentals a degree needs that convention has no spelling for.
 *
 * `spellAt` refuses past a double and states why on itself. A refusal is not
 * merely an expensive spelling - it is the caller dropping to a chromatic table
 * and printing a letter the degree did not name - so it costs more than any
 * spelling that exists, which is what three is here.
 */
const UNSPELLABLE_COST = 3;

/**
 * Of the two names for this pitch class, the one that writes the item's own
 * degrees with the fewest accidental marks. Sharp on a tie.
 *
 * The marks are counted rather than weighted, so a double flat costs two and a
 * degree nothing can spell costs `UNSPELLABLE_COST`. That is the whole of the
 * measure, and it is deliberately not a music-theoretic one - it does not know
 * about key signatures or about how far round the circle a key sits, because
 * those are exactly the questions `signatureKind` has already declined to
 * answer. What is left is the page: fewer accidentals is fewer marks to read.
 *
 * The two spellings are equal for the seven natural pitch classes, so the
 * contest is only ever between a sharp and a flat name of one black key, and the
 * tie-break only ever settles a scale that writes both equally - `F#/Gb` whole
 * tone would be one if `MODE_OFFSETS` did not already exclude it for having six
 * notes. Sharp on a tie, which is this file's standing default.
 */
function simplestRoot(selection: SpellingSelection): SpelledNote {
  const sharp = spellPitchClass(selection.keyIndex, true);
  const item = selection.item;
  if (!item) return sharp;

  const flat = spellPitchClass(selection.keyIndex, false);
  return spellingCost(item, flat) < spellingCost(item, sharp) ? flat : sharp;
}

/** Accidental marks the whole item takes when written from this root. */
function spellingCost(item: MusicTheoryItem, root: SpelledNote): number {
  const rootPitch = pitchClassOf(root);
  let cost = 0;

  for (let position = 0; position < item.intervals.length; position++) {
    const step = item.steps ? item.steps[position] : position;
    const spelled = spellAt(rootPitch + item.intervals[position], root, step);
    cost += spelled ? Math.abs(spelled.accidental) : UNSPELLABLE_COST;
  }

  return cost;
}
