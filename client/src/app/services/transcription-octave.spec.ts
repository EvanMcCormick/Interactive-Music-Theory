import {
  DetectedNote,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { FoldedNote, correctOctaves } from './transcription-octave';

const SETTINGS = createDefaultDerivationSettings();

const note = (pitch: number): DetectedNote => ({
  id: `n${pitch}`,
  pitch,
  onsetSec: 0,
  offsetSec: 1,
  confidence: 1,
  bendCents: []
});

describe('correctOctaves', () => {
  it('raises a pitch below the lowest string into range', () => {
    // A0 = 21 is below the open E string (28), so it must be A1 = 33.
    expect(correctOctaves([note(21)], SETTINGS)[0].pitch).toBe(33);
  });

  it('lowers a pitch beyond the last fret into range', () => {
    // Highest playable is 43 + 24 = 67.
    expect(correctOctaves([note(100)], SETTINGS)[0].pitch).toBe(64);
  });

  it('leaves a playable pitch alone', () => {
    expect(correctOctaves([note(45)], SETTINGS)[0].pitch).toBe(45);
  });

  it('accounts for a capo raising the lowest playable pitch', () => {
    const capoed = { ...SETTINGS, capo: 5 };
    expect(correctOctaves([note(30)], capoed)[0].pitch).toBe(42);
  });

  /**
   * A capo shortens the neck: it moves the bottom of the range up and leaves
   * the top alone. Adding it to `highest` as well would admit pitches
   * `candidatesFor` has no fret for, and a note with no fret is dropped from
   * the score without a sign - the failure this module exists to prevent.
   */
  it('does not let a capo raise the highest playable pitch', () => {
    const capoed = { ...SETTINGS, capo: 5 };

    // Still 43 + 24 = 67, so 70 folds to 58 rather than staying put as a
    // pitch that would need fret 27 in front of the capo.
    expect(correctOctaves([note(70)], capoed)[0].pitch).toBe(58);
  });

  /**
   * SETTINGS is the unmodified default everywhere above except the capo test,
   * and [43, 38, 33, 28] is value-identical to what a hardcoded bass range
   * would use. So `lowest = 28 + settings.capo; highest = 67` - a fold that
   * reads the capo but ignores the tuning and the fret count entirely - passes
   * every case above. Only a different instrument tells the two apart.
   */
  it('folds against the configured instrument, not a hardcoded bass range', () => {
    const guitar = { ...SETTINGS, tuning: [64, 59, 55, 50, 45, 40], maxFret: 12 };

    // 33 is playable on a bass but a fourth below a guitar's lowest string, so
    // it has to fold up. 74 is past a bass's last fret but sits at fret 10 of
    // the guitar's top string, so it must not fold down.
    expect(correctOctaves([note(33), note(74)], guitar).map(entry => entry.pitch))
      .toEqual([45, 74]);
  });

  /**
   * The two loops run in sequence, so the second can undo the first: from a
   * pitch above the range it lands within 12 of `highest`, which is below
   * `lowest` unless the range is at least an octave wide. Without the guard
   * the 36 here folds to 24 - unplayable either way, but no longer visibly so.
   */
  it('leaves a range narrower than an octave alone', () => {
    const narrow = { ...SETTINGS, tuning: [28], maxFret: 5 };

    expect(correctOctaves([note(36)], narrow)[0].pitch).toBe(36);
  });

  /**
   * The fold steps by 12, so a large enough pitch does not merely give a
   * strange answer - above about 2^57 one unit in the last place already
   * exceeds 12, `pitch -= 12` stops changing anything and the loop spins for
   * ever. Infinity does the same, and 1e15 would need some 8e13 iterations.
   * A finiteness check alone would let the first and last of those through.
   */
  it('rejects a pitch too far outside MIDI to be a mis-heard note', () => {
    for (const pitch of [2 ** 57, 1e15, Infinity, -Infinity, NaN]) {
      expect(() => correctOctaves([note(pitch)], SETTINGS)).toThrowError(/not a MIDI pitch/);
    }

    // An octave error can land outside MIDI, and folding it is the whole job,
    // so the bound has to sit well clear of 0-127.
    expect(correctOctaves([note(-24)], SETTINGS)[0].pitch).toBe(36);
    expect(correctOctaves([note(151)], SETTINGS)[0].pitch).toBe(67);
  });

  it('does not mutate its input', () => {
    const notes = [note(21)];
    correctOctaves(notes, SETTINGS);
    expect(notes[0].pitch).toBe(21);
  });
});

/**
 * A fold is interpretation, and interpretation has to be reportable.
 *
 * The correction is silent by construction - the note is in the score, at a
 * different octave - so the only way a listener finds out is if the pipeline
 * says so. Switching from a bass tuning to a guitar one raises the floor from
 * MIDI 28 to 40 and moves every note below E2 up an octave.
 */
describe('correctOctaves, reporting what it moved', () => {
  it('reports the note, the pitch it was heard at, and how far it went', () => {
    const folded: FoldedNote[] = [];

    correctOctaves([note(21)], SETTINGS, folded);

    expect(folded.length).toBe(1);
    expect(folded[0].detectedPitch).toBe(21);
    expect(folded[0].semitones).toBe(12);
    // The note as it was written, so a caller quoting it quotes the pitch that
    // is actually in the score.
    expect(folded[0].note.pitch).toBe(33);
  });

  it('signs the distance, and counts whole octaves', () => {
    const folded: FoldedNote[] = [];

    // 100 is two octaves above the highest playable pitch of 67.
    correctOctaves([note(100)], SETTINGS, folded);

    expect(folded[0].semitones).toBe(-36);
  });

  it('says nothing about a pitch it left alone', () => {
    const folded: FoldedNote[] = [];

    correctOctaves([note(45), note(33)], SETTINGS, folded);

    expect(folded).toEqual([]);
  });

  it('reports the notes in the order it was handed them', () => {
    const folded: FoldedNote[] = [];

    correctOctaves([note(21), note(45), note(100)], SETTINGS, folded);

    expect(folded.map(entry => entry.detectedPitch)).toEqual([21, 100]);
  });

  it('is unchanged when nobody asks', () => {
    // The out-parameter is optional, in the manner of `quantizeBar`'s dropped
    // list: most callers want the corrected notes and nothing else.
    expect(correctOctaves([note(21)], SETTINGS)[0].pitch).toBe(33);
  });
});
