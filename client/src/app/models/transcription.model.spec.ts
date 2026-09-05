import {
  STANDARD_BASS_TUNING,
  createDefaultDerivationSettings
} from './transcription.model';

describe('createDefaultDerivationSettings', () => {
  it('defaults to standard bass tuning, highest string first', () => {
    expect(createDefaultDerivationSettings().tuning).toEqual(STANDARD_BASS_TUNING);
  });

  it('copies the tuning so later edits do not reach back to the caller', () => {
    const tuning = [43, 38, 33, 28];
    const settings = createDefaultDerivationSettings(tuning);

    settings.tuning[0] = 99;

    expect(tuning[0]).toBe(43);
  });

  it('honours a caller-supplied tuning', () => {
    expect(createDefaultDerivationSettings([40, 45, 50, 55]).tuning)
      .toEqual([40, 45, 50, 55]);
  });

  it('does not hand out the shared constant for callers to mutate', () => {
    createDefaultDerivationSettings().tuning[0] = 99;
    expect(STANDARD_BASS_TUNING[0]).toBe(43);
  });

  it('starts with a sixteenth-note grid and no key override', () => {
    const settings = createDefaultDerivationSettings();

    expect(settings.finestDivision).toBe(16);
    expect(settings.key).toBeNull();
  });
});
