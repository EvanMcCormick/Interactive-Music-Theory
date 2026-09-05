import {
  DetectedNote,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { correctOctaves } from './transcription-octave';

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

  it('does not mutate its input', () => {
    const notes = [note(21)];
    correctOctaves(notes, SETTINGS);
    expect(notes[0].pitch).toBe(21);
  });
});
