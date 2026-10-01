import type { ChordDegree, ProgressionKey } from '../models/progression.model';
import { SpelledNote, formatNote, reduceToOctave, spellAt } from './note-spelling';
import { leadSheetChordName, romanNumeral } from './progression-chord-names';
import { ChordIdentity, effectiveChord } from './progression-harmony';
import { chordRootSpelling, scaleNoteSpelling } from './progression-spelling';

/**
 * How the song sheet writes a chord: a lead-sheet name over the lyric, or a
 * Roman numeral when the sheet's I-IV toggle is on.
 *
 * Pure, with no Angular, on the `progression-harmony.ts` precedent. Everything
 * that decides *which chord* a degree is comes from where the progression page
 * gets it - `chordRootSpelling` for the root's letter, `effectiveChord` for the
 * chord the slot actually builds, and `composeFigure` (through
 * `leadSheetChordName`) for its height, alterations and suspension - so the
 * sheet and the progression page can differ only in typography and never about
 * the chord. The one table the sheet adds, `LEAD_SHEET_SUFFIXES`, lives beside
 * the other three in `progression-chord-names.ts`, keyed on the same exhaustive
 * union.
 *
 * ## The conventions, and where each came from
 *
 * - **Accidentals in names are ASCII**, `Bb7` and `F#m`, because that is what
 *   `chordName` and the root spelling (`formatNote`) already print. Numerals
 *   keep `♭` and `♯`, which is `romanNumeral`'s own convention; the field that
 *   reads both (`song-chord-parse.ts`) takes either glyph.
 * - **Half-diminished is `ø7`**, because the app's names already write it so
 *   (`CHORD_SUFFIXES.halfDiminished7`). The catalogue's `m7b5` is read as an
 *   alias and printed back as `ø7`.
 * - **Diminished and augmented are `°` and `+`**, for the same reason.
 * - **The slash bass is spelled by its place in the chord**, as the roll spells
 *   chord tones: the third of E is `G#`, never `Ab`.
 */

/**
 * A degree's lead-sheet name in a key: `C`, `Am`, `B°`, `Bb7`, `Bø7`, `G7b9`,
 * `Gsus4`, `C6/9`, `F/A`.
 *
 * `scaleIntervals` must be heptatonic - the song's key control offers only
 * scales that can build chords - and a scale that is not throws exactly as
 * `effectiveChord` does, rather than printing a name the key cannot hold. A
 * chord with no name at all prints `?` after its root, as `chordName` does:
 * unlabelled rather than mislabelled.
 */
export function leadSheetNameOf(
  degree: ChordDegree,
  key: ProgressionKey,
  scaleIntervals: readonly number[]
): string {
  const root = chordRootSpelling(key, scaleIntervals, degree);
  const chord = effectiveChord(scaleIntervals, degree);
  const name = leadSheetChordName(formatNote(root), chord);

  const bass = bassSpelling(key, scaleIntervals, root, chord, degree.inversion);
  return bass === null ? name : `${name}/${formatNote(bass)}`;
}

/**
 * The note an inversion puts in the bass, spelled on the letter its place in
 * the chord names, or null in root position.
 *
 * `inversion` indexes the built stack, which is what `voiceChord` rotates and
 * what `inversionOf` writes back, so the note named here is the note the slot
 * sounds lowest. The letter comes from `ChordIdentity.steps` as it does for the
 * roll's chord tones (`slotSpeller`), and past a double accidental falls back to
 * the key's own spelling of that pitch class, as a root does.
 *
 * Null as well for a chord with no intervals to index - `'other'` as a stored
 * quality builds none - since there is then no note to name.
 */
function bassSpelling(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  root: SpelledNote,
  chord: ChordIdentity,
  inversion: number
): SpelledNote | null {
  if (inversion === 0) return null;

  const interval = chord.intervals.at(inversion);
  const steps = chord.steps.at(inversion);
  if (interval === undefined || steps === undefined) return null;

  const pitchClass = reduceToOctave(key.tonic + chord.root + interval);
  return spellAt(pitchClass, root, steps) ?? scaleNoteSpelling(key, scaleIntervals, pitchClass);
}

/**
 * A degree's Roman numeral, exactly as the progression page prints it: `I`,
 * `vi`, `vii°`, `V7`, `♭VII`.
 *
 * A wrapper rather than a second numeral, so the sheet's I-IV toggle has one
 * import beside `leadSheetNameOf` and cannot drift from the strip's card -
 * which builds its numeral from the same two calls (`describeSlot`). Relative
 * to the key's own mode, as those are: A aeolian's G major triad is `VII`.
 * No key is taken because a numeral needs none; the scale is the whole frame.
 */
export function numeralOf(degree: ChordDegree, scaleIntervals: readonly number[]): string {
  return romanNumeral(degree.degree, degree.alter, effectiveChord(scaleIntervals, degree));
}
