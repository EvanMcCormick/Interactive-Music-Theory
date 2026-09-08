/**
 * The twelve positions of the circle, as reference data.
 *
 * Written out rather than generated, for the same reason the scale intervals in
 * `MusicTheoryService` are: this is a fact about music, not a computation, and a
 * loop that derives it would be a second place for the spelling rules to be
 * wrong. `circle-of-fifths.data.spec.ts` checks the arithmetic instead — every
 * step a fifth, every relative minor nine semitones up, every signature one
 * accidental further from C.
 *
 * ## Why the spellings are what they are
 *
 * Every key here carries **six accidentals or fewer**, which is what puts sharps
 * on the right half and flats on the left. The alternative spellings exist —
 * C♯ major is a real key with seven sharps — and they are the wrong choice for a
 * diagram whose job is to show that neighbours differ by one accidental.
 *
 * That has a consequence beyond looks. `MusicTheoryService.flatKeys` reads the
 * key *name* to decide whether the whole app spells notes with flats, so
 * selecting G♭ from this data puts the fretboard into flats and selecting B puts
 * it into sharps. The two halves of the circle select the right spelling as well
 * as the right pitch, and nothing in the component arranges that.
 *
 * ## The one ambiguous position
 *
 * Six o'clock is F♯ major (6♯) and G♭ major (6♭) — the same pitch, two keys, and
 * a reader who has been taught one of them should find it. It is the only
 * position with an enharmonic alternative, and the only one the component splits
 * into two hit targets.
 */

/** Which way round the circle runs. Fourths is fifths reversed; see `circleOrder`. */
export type CircleDirection = 'fifths' | 'fourths';

export interface CirclePosition {
  /** Major key, spelled as `MusicTheoryService` spells it. */
  major: string;

  /** The other spelling of the same pitch, at six o'clock only. */
  majorEnharmonic: string | null;

  /**
   * Root of the relative minor — `'A'` for A minor, not `'Am'`.
   *
   * The root is what `updateKey` takes; the `m` is a label and belongs in the
   * template.
   */
  minor: string;

  minorEnharmonic: string | null;

  /** Accidentals in the major key signature, 0 to 6. */
  accidentals: number;

  accidentalKind: 'sharp' | 'flat' | 'none';

  /**
   * The enharmonic spelling's own signature, where there is one.
   *
   * Not derivable from the fields above by anything worth writing: F sharp
   * major carries six sharps and G flat major six flats, and the only reason
   * the counts happen to match is that this is the position where the circle
   * closes. Stated rather than computed, so the label under each half of the
   * split wedge is read from data instead of from an assumption.
   */
  enharmonicAccidentalKind: 'sharp' | 'flat' | null;
}

/**
 * Clockwise from C, each a fifth above the last.
 *
 * Frozen because it is reference data. Nothing should be mutating the circle of
 * fifths at runtime, and a `readonly` type alone would not stop a stray `sort`.
 */
export const CIRCLE_POSITIONS: readonly CirclePosition[] = Object.freeze([
  { major: 'C', majorEnharmonic: null, minor: 'A', minorEnharmonic: null, accidentals: 0, accidentalKind: 'none', enharmonicAccidentalKind: null },
  { major: 'G', majorEnharmonic: null, minor: 'E', minorEnharmonic: null, accidentals: 1, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'D', majorEnharmonic: null, minor: 'B', minorEnharmonic: null, accidentals: 2, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'A', majorEnharmonic: null, minor: 'F#', minorEnharmonic: null, accidentals: 3, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'E', majorEnharmonic: null, minor: 'C#', minorEnharmonic: null, accidentals: 4, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'B', majorEnharmonic: null, minor: 'G#', minorEnharmonic: null, accidentals: 5, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'F#', majorEnharmonic: 'Gb', minor: 'D#', minorEnharmonic: 'Eb', accidentals: 6, accidentalKind: 'sharp', enharmonicAccidentalKind: 'flat' },
  { major: 'Db', majorEnharmonic: null, minor: 'Bb', minorEnharmonic: null, accidentals: 5, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Ab', majorEnharmonic: null, minor: 'F', minorEnharmonic: null, accidentals: 4, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Eb', majorEnharmonic: null, minor: 'C', minorEnharmonic: null, accidentals: 3, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Bb', majorEnharmonic: null, minor: 'G', minorEnharmonic: null, accidentals: 2, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'F', majorEnharmonic: null, minor: 'D', minorEnharmonic: null, accidentals: 1, accidentalKind: 'flat', enharmonicAccidentalKind: null }
].map(position => Object.freeze(position))) as readonly CirclePosition[];

/**
 * The positions in the order the given direction reads them.
 *
 * **This is the entire circle-of-fourths implementation**, and it is one line
 * because that is genuinely all the difference there is: a fourth up is a fifth
 * down, so reading the same twelve positions anticlockwise gives the circle of
 * fourths. The tonic stays at the top in both, so only the eleven positions
 * after it reverse.
 *
 * Anyone tempted to replace this with a second hard-coded array should read
 * `circle-of-fifths.data.spec.ts` first, which asserts the reversal produces
 * ascending fourths — and would keep passing against a second array right up
 * until the two drifted apart.
 */
export function circleOrder(direction: CircleDirection): readonly CirclePosition[] {
  if (direction === 'fifths') {
    return CIRCLE_POSITIONS;
  }

  return [CIRCLE_POSITIONS[0], ...CIRCLE_POSITIONS.slice(1).reverse()];
}
