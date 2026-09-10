import { ProgressionKey } from '../models/progression.model';
import { createDegreeSlot } from '../models/progression.model';
import { chordRootName, scaleNoteName } from './progression-spelling';

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
