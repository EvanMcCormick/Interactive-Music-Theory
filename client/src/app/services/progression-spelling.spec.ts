import { ChordDegree, ChordSlot, ProgressionKey } from '../models/progression.model';
import { createDegreeSlot } from '../models/progression.model';
import { formatNote } from './note-spelling';
import { chordRootName, scaleNoteName, slotSpeller } from './progression-spelling';

/**
 * The four spellings the old rule could not reach, and the two it reached
 * wrongly.
 *
 * Every expectation here is a claim about a *letter*, and each was worked
 * through by hand before it was written down - the point of the module is that
 * the letter comes from the degree, so a fixture derived from the output would
 * be testing nothing at all.
 *
 * The intervals are written out rather than looked up, on the
 * `progression-harmony.spec.ts` precedent: a spec that asked the service for
 * them would fail for two different reasons at once. The **ids** beside them
 * are the service's own, checked against `getScaleCategories`, because the key
 * carries an id and `keySignatureKind` reads it.
 */
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];
const SUPER_LOCRIAN = [0, 1, 3, 4, 6, 8, 10];

/**
 * A degree as a slot really holds one, with the accidental applied.
 *
 * Built through `createDegreeSlot` rather than written as an object literal so
 * that the fixture carries whatever a fresh slot carries; a displaced root is
 * given a quality because `chordPitchClasses` refuses a chromatic root with no
 * shape under it, and this module's callers all pass a real slot's degree.
 */
function degree(d: number, alter = 0) {
  const slot = createDegreeSlot(d, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
  return { ...slot.harmony.degree, alter, quality: alter === 0 ? null : ('major' as const) };
}

function key(tonic: number, scaleId: string, preferSharps: boolean): ProgressionKey {
  return { tonic, scaleId, preferSharps };
}

/**
 * A slot as the store really holds one, carrying the given degree.
 *
 * Through `createDegreeSlot` for `degree`'s reason one paragraph up, and taking
 * an override rather than the two arguments that helper takes because the cases
 * below need an extent, a suspension and a pinned ninth as well as an alter.
 */
function degreeSlot(shape: Partial<ChordDegree> & { degree: number }): ChordSlot {
  const slot = createDegreeSlot(shape.degree, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

  return { ...slot, harmony: { kind: 'degree', degree: { ...slot.harmony.degree, ...shape } } };
}

/** A slot that has lost its numeral, which is what `literal` means. */
function literalSlot(): ChordSlot {
  return {
    ...createDegreeSlot(0, 0),
    harmony: { kind: 'literal', reason: 'unrecognised', from: null }
  };
}

/**
 * The one rule the roll and the score both spell their notes by.
 *
 * It lives here rather than in `piano-roll-view.spec.ts` because it is no
 * longer the roll's: M4 gave the score projection the same question, and the
 * letter drawn on a keyboard key has to be the letter engraved on the staff.
 * The two chord-tone cases below came from that spec, rewritten as calls
 * rather than as service states - what they assert is unchanged.
 *
 * Every expectation is worked through by hand, as everywhere else in this file.
 */
describe('slotSpeller', () => {
  /**
   * The case the module exists for, one layer up from `chordRootName`'s.
   *
   * B flat major's `♭II` is rooted on a C flat, so pitch class 11 in that slot
   * is a C flat too - the root's own tone. The scale has no pitch class 11 in
   * it at all, so without the chord the key would answer, and B flat major
   * prefers flats: `B`, a raised seventh under a numeral that says lowered
   * second.
   */
  it('spells a chord tone by its position in the chord, not by the scale', () => {
    const speller = slotSpeller(
      key(10, 'ionian', false),
      IONIAN,
      degreeSlot({ degree: 1, alter: -1, quality: 'major' })
    );

    expect(formatNote(speller(11))).toBe('Cb');
  });

  /**
   * `♭VI` in C major is A♭ C E♭. Neither the A♭ nor the E♭ is in C major, so
   * the scale has no degree for either and the key would answer - and C major
   * leans sharp, giving `G♯` and `D♯` under a numeral that says flat six. Read
   * off the chord they are a root, a third and a fifth: A, C and E, one letter
   * apart in the usual way and flattened to land on the pitches.
   */
  it('writes a flat six on flat letters in a key that prefers sharps', () => {
    const speller = slotSpeller(
      key(0, 'ionian', true),
      IONIAN,
      degreeSlot({ degree: 5, alter: -1, quality: 'major' })
    );

    expect([8, 0, 3].map(pitchClass => formatNote(speller(pitchClass))))
      .toEqual(['Ab', 'C', 'Eb']);
  });

  /** So the chord is an addition to the scale's answer rather than a replacement. */
  it('falls through to the scale for a note the chord does not contain', () => {
    const speller = slotSpeller(
      key(0, 'ionian', true),
      IONIAN,
      degreeSlot({ degree: 5, alter: -1, quality: 'major' })
    );

    expect(formatNote(speller(2))).toBe('D');
  });

  /**
   * A slot with no numeral has no chord to ask, and neither has no slot at all
   * - the roll draws a keyboard before anything is selected. Pitch class 6 is
   * outside C major either way, so the key's preference is the whole answer.
   */
  it('falls through to the key when the slot has no degree', () => {
    const cMajor = key(0, 'ionian', true);

    expect(formatNote(slotSpeller(cMajor, IONIAN, literalSlot())(6))).toBe('F#');
    expect(formatNote(slotSpeller(cMajor, IONIAN, null)(6))).toBe('F#');
  });

  /**
   * The guard that used to be `ProgressionState.canBuildChords`, asked of the
   * intervals instead.
   *
   * Both shapes of "no scale to build through" reach it: five degrees cannot
   * take seven letters one apart, and an empty array is a key whose scale id
   * resolved to nothing. `effectiveChord` throws on either, so this is the
   * refusal that has to happen before the chord is built rather than a
   * preference about the answer.
   */
  it('asks no chord of a scale thirds cannot be stacked through', () => {
    const cMinorPentatonic = key(0, 'minorPentatonic', false);
    const tonicSlot = degreeSlot({ degree: 0 });

    expect(formatNote(slotSpeller(cMinorPentatonic, [0, 3, 5, 7, 10], tonicSlot)(3))).toBe('Eb');
    expect(formatNote(slotSpeller(key(0, 'ionian', true), [], tonicSlot)(6))).toBe('F#');
  });

  /**
   * **First spelling wins**, on a stack that sounds one pitch class twice.
   *
   * A C minor ninth with the ninth pinned sharp is C E♭ G B D♯ - and the ♯9 is
   * the minor third an octave up, pitch class 3 twice over. The two positions
   * read different letters: position 1 is a third, two letters above the root,
   * and position 4 is a ninth, one. The lower position keeps the row, so this
   * is an `Eb` and not the `D#` either the upper position or the key would
   * give.
   *
   * The docstring names a sus4 at extent 11 as the case, and that is where the
   * doubling was found, but it cannot show the rule: the suspended fourth and
   * the eleventh are both three letters above the root, so first and last
   * spelling agree there. A pinned ♯9 is the same collision with the two
   * positions disagreeing, which is what makes the tie-break visible.
   */
  it('keeps the lower position when one pitch class appears twice', () => {
    const speller = slotSpeller(
      key(0, 'ionian', true),
      IONIAN,
      degreeSlot({
        degree: 0,
        quality: 'minor',
        extent: 9,
        extensions: { ninth: 1, eleventh: null, thirteenth: null }
      })
    );

    expect(formatNote(speller(3))).toBe('Eb');
  });
});

describe('chordRootName', () => {
  // B flat major's second degree is written on a C whatever it does, so the
  // lowered one is a C flat - pitch class 11, which the chromatic tables can
  // only call B.
  it('names B flat major ♭II as C flat', () => {
    expect(chordRootName(key(10, 'ionian', false), IONIAN, degree(1, -1))).toBe('Cb');
  });

  // C sharp minor's seventh degree is a B, so harmonic minor's raised one is a
  // B sharp - pitch class 0, which the tables can only call C.
  it('names C sharp aeolian ♯vii on B sharp', () => {
    expect(chordRootName(key(1, 'aeolian', true), AEOLIAN, degree(6, 1))).toBe('B#');
  });

  // One of the 112 `rootPrefersSharps` got wrong in a key a user might really
  // be in. F super locrian is F G♭ A♭ B♭♭ C♭ D♭ E♭; its fourth degree is a B
  // double flat, so raising it gives a B flat. The old rule read the sign of
  // the alter and printed `A♯`.
  it('names F super locrian ♯iv as B flat', () => {
    expect(chordRootName(key(5, 'superLocrian', false), SUPER_LOCRIAN, degree(3, 1))).toBe('Bb');
  });

  // One of the thirteen the key's own spelling got wrong: F locrian is treated
  // as a six-sharp key, so its third degree - an A flat, F locrian being
  // F G♭ A♭ B♭ C♭ D♭ E♭ - printed `G♯`.
  it('names F locrian iii as A flat', () => {
    expect(chordRootName(key(5, 'locrian', true), LOCRIAN, degree(2))).toBe('Ab');
  });
});

describe('scaleNoteName', () => {
  it('spells an in-scale note by its degree and anything else by the key', () => {
    const fLocrian = key(5, 'locrian', true);
    expect(scaleNoteName(fLocrian, LOCRIAN, 8)).toBe('Ab'); // degree 2
    expect(scaleNoteName(fLocrian, LOCRIAN, 9)).toBe('A'); // not in F locrian
  });

  // A scale with no one-letter-per-degree reading has no degree letters to
  // spell by, so the tables answer for every note of it. See the module header.
  it('leaves a scale that is not heptatonic to the key', () => {
    const cMinorPentatonic = key(0, 'minorPentatonic', false);
    expect(scaleNoteName(cMinorPentatonic, [0, 3, 5, 7, 10], 3)).toBe('Eb');
  });
});
