import type { ChordDegree, ProgressionKey } from '../models/progression.model';
import { ChordExtent, effectiveChord, isHeptatonic } from './progression-harmony';
import { ChordOption, chordVocabulary, diatonicChordsOf, optionDegree } from './progression-vocabulary';
import { leadSheetNameOf, numeralOf } from './song-chord-names';
import { NO_CHORDS_KEY } from './song-commands';

/**
 * The song sheet's Chords tab, as data: four rows of chords a click places at the caret (design Part 2).
 *
 * Pure, with no Angular, on the `progression-vocabulary.ts` precedent, which it sits on. **Nothing here decides which
 * chords a key offers.** The two diatonic rows are `diatonicChordsOf` - the builder the progression palette's own
 * diatonic row uses - at a triad's height and at a seventh's; the borrowed and secondary rows are `chordVocabulary`'s,
 * chord for chord and in its order. What this module adds is how the *sheet* writes them: every option is named by
 * `leadSheetNameOf` and numbered by `numeralOf`, the two functions the sheet prints a chord atom with
 * (`chordLabelOf`), so a cell and the chord it places read the same - `Am` over `vi`, never the palette's `A min`.
 *
 * ## The secondary dominants' two numerals
 *
 * A secondary dominant has two: what it *does*, `V/ii`, and where it *is* in the key, `VI7`. The sheet can only print
 * the second - a chord atom stores a degree, not the chord it leads to, so there is no target to write a slash
 * against - and a cell must number its chord as the sheet will. So `numeral` is the sheet's, and the slash numeral the
 * vocabulary writes is kept beside it as the option's `role`, which the panel shows under the chord: the row is
 * *about* what each chord leads to, and losing that would leave five chords with no reason to be together.
 */

/** One chord a cell places: the degree a chord atom will store, and how the sheet writes it. */
export interface SongPaletteOption {
  /** Placed whole by `chordSlotOf`: its shape, height and accidental, root position, no suspension. */
  readonly degree: ChordDegree;
  /** As the sheet prints it with names showing: `Am`, `Bb`, `Bø7`. */
  readonly name: string;
  /** As the sheet prints it with numerals showing: `vi`, `♭VII`, `viiø7`. */
  readonly numeral: string;
  /** For a label that is heard: `A minor`; a secondary dominant adds what it leads to. */
  readonly spoken: string;
  /** A secondary dominant's function, `V/ii`; null in the other rows. See the header. */
  readonly role: string | null;
}

/** The four rows, in the order the panel lays them out. */
export interface SongPaletteRows {
  readonly triads: readonly SongPaletteOption[];
  readonly sevenths: readonly SongPaletteOption[];
  readonly borrowed: readonly SongPaletteOption[];
  readonly secondary: readonly SongPaletteOption[];
}

/** A key's palette, or why it has none. */
export type SongPalette = { kind: 'rows'; rows: SongPaletteRows } | { kind: 'refused'; reason: string };

const TRIAD: ChordExtent = 3;
const SEVENTH: ChordExtent = 7;

/**
 * Steps up the scale from a secondary dominant's degree to the degree it leads to: a fifth down is four steps down,
 * which in seven is three up. The inverse of the vocabulary's `target + 4` (`secondary` in
 * `progression-vocabulary.ts`).
 */
const STEPS_TO_TARGET = 3;

/**
 * A key's four rows, or a refusal when its scale cannot build chords.
 *
 * `scaleIntervals` is the key's scale as `ProgressionKeyContext.chordScaleFor` gives it, so the page hands that
 * answer straight over: null - an id the app does not know, a scale with no thirds to stack - and a scale that is not
 * heptatonic are both refused, with the sentence the song's commands refuse a chord with (`NO_CHORDS_KEY`), because
 * it is the same fact. The song's key control offers only scales that can build chords, so the refusal is for a song
 * stored by something else.
 */
export function songPaletteOf(key: ProgressionKey, scaleIntervals: readonly number[] | null): SongPalette {
  if (scaleIntervals === null || !isHeptatonic(scaleIntervals)) return { kind: 'refused', reason: NO_CHORDS_KEY };

  const option = (degree: ChordDegree, spoken: string, role: string | null = null): SongPaletteOption => ({
    degree,
    name: leadSheetNameOf(degree, key, scaleIntervals),
    numeral: numeralOf(degree, scaleIntervals),
    spoken,
    role
  });
  const fromVocabulary = (chord: ChordOption): ChordDegree =>
    optionDegree(chord.degree, chord.alter, chord.quality, chord.extent);

  const triads = diatonicChordsOf(key, scaleIntervals, TRIAD);
  const vocabulary = chordVocabulary(key, scaleIntervals, null);

  return {
    kind: 'rows',
    rows: {
      triads: triads.map(chord => option(chord.degree, chord.spoken)),
      sevenths: diatonicChordsOf(key, scaleIntervals, SEVENTH).map(chord => option(chord.degree, chord.spoken)),
      borrowed: vocabulary.borrowed.map(chord => option(fromVocabulary(chord), chord.spoken)),
      // Its target is one of the key's own triads - the vocabulary offers a dominant only for a degree whose triad is
      // major or minor - so the triads row already holds how to say it.
      secondary: vocabulary.secondary.map(chord => {
        const target = triads[(chord.degree + STEPS_TO_TARGET) % triads.length];
        return option(fromVocabulary(chord), `${chord.spoken}, leading to ${target.spoken}`, chord.numeral);
      })
    }
  };
}

/**
 * Whether two degrees build the same chord in a scale: the same root - degree and accidental - and the same stack
 * over it. Which cell the chord selected on the sheet is.
 *
 * **The chord built, not the fields stored.** A chord typed `Bb` and the borrowed `♭VII` cell may differ in whether
 * `quality` is pinned, and a placed triad stores `quality: null` where the vocabulary's options name theirs; both build
 * the same notes and the sheet prints the same name, so they are the same chord. The stack is `effectiveChord`'s - the
 * identity the sheet names a chord from - so height counts (`G` is not `G7`) and the suspension and pinned extensions
 * count, while the inversion and octave do not: `C/E` is still the `C` cell, as it is still `I` on the sheet.
 *
 * `scaleIntervals` must be heptatonic, as for every chord on the sheet.
 */
export function isSameChord(a: ChordDegree, b: ChordDegree, scaleIntervals: readonly number[]): boolean {
  if (a.degree !== b.degree || a.alter !== b.alter) return false;
  const first = effectiveChord(scaleIntervals, a);
  const second = effectiveChord(scaleIntervals, b);
  return (
    first.suspension === second.suspension &&
    first.intervals.length === second.intervals.length &&
    first.intervals.every((interval, index) => interval === second.intervals[index])
  );
}
