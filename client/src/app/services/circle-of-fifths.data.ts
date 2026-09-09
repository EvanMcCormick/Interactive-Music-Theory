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
 * ## It is also the key-signature table, and `MusicTheoryService` reads it
 *
 * The circle of fifths and the list of key signatures are the same object: a
 * position's distance round the circle *is* its number of accidentals. So this
 * lives beside the service rather than inside the component that draws it, and
 * `shouldUseSharps` consults it to decide how the whole app spells notes — which
 * is what stopped E minor coming back with a G flat in it.
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

  /**
   * Pitch class of the major tonic, 0-11.
   *
   * Stated rather than parsed out of `major`, so that `keySignatureKind` below
   * can be a pure function of numbers with no note-name table of its own. The
   * app already has exactly two chromatic tables and a third one here - even a
   * private one - would be a third place for a spelling to be wrong.
   * `circle-of-fifths.data.spec.ts` pins every one of these against
   * `MusicTheoryService.getNoteIndex`, so a number that disagreed with the name
   * beside it fails rather than quietly moving a key signature.
   */
  pitchClass: number;

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
  { major: 'C', pitchClass: 0, majorEnharmonic: null, minor: 'A', minorEnharmonic: null, accidentals: 0, accidentalKind: 'none', enharmonicAccidentalKind: null },
  { major: 'G', pitchClass: 7, majorEnharmonic: null, minor: 'E', minorEnharmonic: null, accidentals: 1, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'D', pitchClass: 2, majorEnharmonic: null, minor: 'B', minorEnharmonic: null, accidentals: 2, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'A', pitchClass: 9, majorEnharmonic: null, minor: 'F#', minorEnharmonic: null, accidentals: 3, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'E', pitchClass: 4, majorEnharmonic: null, minor: 'C#', minorEnharmonic: null, accidentals: 4, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'B', pitchClass: 11, majorEnharmonic: null, minor: 'G#', minorEnharmonic: null, accidentals: 5, accidentalKind: 'sharp', enharmonicAccidentalKind: null },
  { major: 'F#', pitchClass: 6, majorEnharmonic: 'Gb', minor: 'D#', minorEnharmonic: 'Eb', accidentals: 6, accidentalKind: 'sharp', enharmonicAccidentalKind: 'flat' },
  { major: 'Db', pitchClass: 1, majorEnharmonic: null, minor: 'Bb', minorEnharmonic: null, accidentals: 5, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Ab', pitchClass: 8, majorEnharmonic: null, minor: 'F', minorEnharmonic: null, accidentals: 4, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Eb', pitchClass: 3, majorEnharmonic: null, minor: 'C', minorEnharmonic: null, accidentals: 3, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'Bb', pitchClass: 10, majorEnharmonic: null, minor: 'G', minorEnharmonic: null, accidentals: 2, accidentalKind: 'flat', enharmonicAccidentalKind: null },
  { major: 'F', pitchClass: 5, majorEnharmonic: null, minor: 'D', minorEnharmonic: null, accidentals: 1, accidentalKind: 'flat', enharmonicAccidentalKind: null }
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


/**
 * Semitones from a parent major's tonic up to each diatonic mode's tonic.
 *
 * This is what lets a key signature be worked out for a mode rather than only
 * for a major key: A aeolian is the ninth degree above C, so it carries C
 * major's signature, and E aeolian carries G major's — one sharp, which is the
 * F sharp that E minor is supposed to have.
 *
 * Only the seven diatonic modes are here, and deliberately. A pentatonic or a
 * blues scale has no parent major to inherit a signature from, so a caller that
 * finds nothing here should fall back to whatever preference the scale itself
 * declares rather than inventing one.
 */
export const MODE_OFFSETS: Readonly<Record<string, number>> = Object.freeze({
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  locrian: 11
});

/** What a key signature is made of, or `null` when the key has none at all. */
export type KeySignatureKind = 'sharp' | 'flat' | 'none';

/**
 * Whether a key carries sharps, flats, or neither.
 *
 * **A key signature is a property of the key, not of the scale shape**, and this
 * is the single statement of that rule. It works back from the mode to its
 * parent major - A aeolian is the ninth degree of C, so it inherits C major's
 * signature, and E aeolian inherits G major's one sharp - and reads that major's
 * accidentals off the circle above, which is the same table.
 *
 * It lives here, exported and pure, rather than as a private method on
 * `MusicTheoryService`, because two services need the answer. The fretboard asks
 * through `shouldUseSharps` and the progression page asks through
 * `ProgressionService.setKey`, and the second of those was a *copy* of the rule
 * before it was this call: `ProgressionKey.preferSharps` was being filled from
 * the scale's own default, which is precisely the mistake `b514027` fixed for
 * the fretboard and which put `D♯ Maj` on a palette in E flat major.
 *
 * `mode` is a scale id from `MusicTheoryService` and `tonic` a pitch class,
 * 0-11. Returns `null` for anything with no parent major to inherit from - a
 * pentatonic, a blues scale, a chord, an id the app does not know, a tonic that
 * is not a pitch class. Those keep whatever preference they declare for
 * themselves, because inventing a signature for a scale that does not have one
 * would be worse than having no opinion. So would inventing one for a note this
 * function cannot place.
 */
export function keySignatureKind(mode: string, tonic: number): KeySignatureKind | null {
  return keySignaturePosition(mode, tonic)?.accidentalKind ?? null;
}

/**
 * The circle position a key inherits its signature from, or `null` when it
 * inherits from none.
 *
 * The whole of `keySignatureKind`'s rule, stopping one field short of its
 * answer. It is separate because a signature is two facts and that function
 * returns one: *what* the accidentals are, which is all the fretboard's
 * spelling decision needs, and *how many* there are, which is what notation
 * needs - `KeySignature.fifths` is a signed count, and E flat major is three
 * flats rather than merely flat. `progression-score.ts` is the caller that
 * needs the count, and reading `accidentals` off the position it already had
 * to find is cheaper and safer than a second walk back to the parent major.
 *
 * Splitting it out rather than widening the return type keeps the call the
 * fretboard makes exactly as it was: `shouldUseSharps` asks a yes-or-no
 * question and should not have to unwrap a record to hear the answer.
 */
export function keySignaturePosition(mode: string, tonic: number): CirclePosition | null {
  const offset = MODE_OFFSETS[mode];
  if (offset === undefined) {
    return null;
  }

  // A `NaN` or a -1 from a name the caller could not resolve would otherwise
  // reach the modulo below and come back as a plausible-looking parent.
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) {
    return null;
  }

  const parent = (tonic - offset + 12) % 12;
  return CIRCLE_POSITIONS.find(candidate => candidate.pitchClass === parent) ?? null;
}
