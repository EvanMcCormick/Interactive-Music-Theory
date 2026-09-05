import {
  STANDARD_BASS_TUNING,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { assignFingering, candidatesFor } from './transcription-fingering';

const SETTINGS = createDefaultDerivationSettings();

describe('candidatesFor', () => {
  it('finds every string that can reach a pitch', () => {
    // A1 = 33: the open A string, or fret 5 on the E string.
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 0, 24)).toEqual([
      { string: 2, fret: 0 },
      { string: 3, fret: 5 }
    ]);
  });

  it('shifts every option by the capo, dropping what falls behind it', () => {
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 2, 24)).toEqual([
      { string: 3, fret: 3 }
    ]);
  });

  it('drops options past the last fret', () => {
    // G2 = 43 sits at fret 15 on the E string, out of reach on a 12-fret neck.
    expect(candidatesFor(43, STANDARD_BASS_TUNING, 0, 12)).toEqual([
      { string: 0, fret: 0 },
      { string: 1, fret: 5 },
      { string: 2, fret: 10 }
    ]);
  });

  it('returns nothing for a pitch below the instrument', () => {
    expect(candidatesFor(20, STANDARD_BASS_TUNING, 0, 24)).toEqual([]);
  });
});

describe('assignFingering', () => {
  it('prefers an open string to the fretted equivalent', () => {
    expect(assignFingering([{ pitch: 33, onsetSec: 0 }], SETTINGS)).toEqual([
      { kind: 'fretted', string: 2, fret: 0 }
    ]);
  });

  it('returns null where the instrument cannot play the pitch', () => {
    expect(assignFingering([{ pitch: 20, onsetSec: 0 }], SETTINGS)).toEqual([null]);
  });

  it('carries on after an unplayable note', () => {
    const result = assignFingering(
      [{ pitch: 20, onsetSec: 0 }, { pitch: 33, onsetSec: 1 }],
      SETTINGS
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ kind: 'fretted', string: 2, fret: 0 });
  });

  /**
   * The thesis of the feature, in two tests.
   *
   * The same three pitches are fingered differently depending only on how much
   * time there is between them. Played fast, the hand stays put and takes the
   * high fret on a lower string; played slowly, it has time to shift down to
   * the easier low fret. Assigning each note its lowest available fret - the
   * obvious approach - gives the low-fret answer both times, which is why such
   * tab skitters across the neck on fast passages.
   */
  it('stays in position when the notes come fast', () => {
    const fast = assignFingering(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 0.1 },
        { pitch: 45, onsetSec: 0.2 }
      ],
      SETTINGS
    );

    expect(fast[2]).toEqual({ kind: 'fretted', string: 2, fret: 12 });
  });

  it('shifts down the neck when there is time to move', () => {
    const slow = assignFingering(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 2 },
        { pitch: 45, onsetSec: 4 }
      ],
      SETTINGS
    );

    expect(slow[2]).toEqual({ kind: 'fretted', string: 0, fret: 2 });
  });

  /**
   * Charging nothing for a shift across an open string does not merely permit
   * a leap, it pays for one. `55 -> 45` on its own gives the sane
   * `s0f12 | s2f12`; interposing an open A over the same 0.04s used to buy
   * fret 22, because zeroing both move costs made staying on one string save
   * more in string-change cost than the leap cost. And it composes: an
   * alternating fretted/open figure bought unlimited free travel.
   */
  it('does not buy a leap with an open string in the middle', () => {
    const figure = assignFingering(
      [
        { pitch: 55, onsetSec: 0 },
        { pitch: 33, onsetSec: 0.02 },
        { pitch: 45, onsetSec: 0.04 }
      ],
      SETTINGS
    );

    expect(figure[0]).toEqual({ kind: 'fretted', string: 0, fret: 12 });
    expect(figure.every(pitch => pitch?.kind === 'fretted' && pitch.fret <= 12)).toBe(true);
  });

  it('pulls the hand towards a position hint', () => {
    const hinted = assignFingering(
      [{ pitch: 45, onsetSec: 0 }],
      { ...SETTINGS, positionHint: 12 }
    );

    expect(hinted[0]).toEqual({ kind: 'fretted', string: 2, fret: 12 });
  });
});
