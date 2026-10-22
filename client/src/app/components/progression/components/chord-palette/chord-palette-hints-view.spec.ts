import { NamedQuality } from '../../../../services/progression-harmony';
import { NextChords } from '../../../../services/progression-next-chords';
import { PaletteChord, PaletteOption } from './chord-palette.component';
import { HINT_SUFFIX, HintSubject, hintPalette } from './chord-palette-hints-view';

/**
 * Matching a target to a button, and the caption. The tables are tested in
 * `progression-next-chords.spec.ts`; these fixtures hand the view an answer and
 * check where the marks land and what the caption says.
 */
describe('hintPalette', () => {
  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];

  const G_MAJOR: HintSubject = { numeral: 'V', name: 'G Maj', subject: 'G major' };

  function chords(numerals: readonly string[], names: readonly string[]): PaletteChord[] {
    return numerals.map((numeral, degree) => ({
      degree,
      numeral,
      name: names[degree],
      label: `Add ${names[degree]}, degree ${degree + 1}`,
      spoken: names[degree],
      isTonic: degree === 0,
      hinted: false
    }));
  }

  const C_MAJOR_CHORDS = chords(
    ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
    ['C Maj', 'D min', 'E min', 'F Maj', 'G Maj', 'A min', 'B°']
  );
  const A_MINOR_CHORDS = chords(
    ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
    ['A min', 'B°', 'C Maj', 'D min', 'E min', 'F Maj', 'G Maj']
  );
  const A_MELODIC_CHORDS = chords(
    ['i', 'ii', 'III+', 'IV', 'V', 'vi°', 'vii°'],
    ['A min', 'B min', 'C aug', 'D Maj', 'E Maj', 'F#°', 'G#°']
  );

  function option(degree: number, alter: number, quality: NamedQuality, numeral: string, name: string): PaletteOption {
    return {
      degree,
      alter,
      quality,
      extent: 3,
      numeral,
      name,
      label: `Add ${name}, borrowed chord`,
      spoken: name,
      current: false,
      key: `${degree}:${alter}:${quality}`,
      hinted: false
    };
  }

  const A_MINOR_BORROWED = [
    option(1, -1, 'major', '♭II', 'Bb Maj'),
    option(4, 0, 'major', 'V', 'E Maj'),
    option(6, 1, 'diminished', '♮vii°', 'G#°')
  ];

  function targets(...list: Extract<NextChords, { kind: 'targets' }>['targets']): NextChords {
    return { kind: 'targets', targets: list };
  }

  function hintedNumerals(result: ReturnType<typeof hintPalette>): string[] {
    return [...result.chords, ...result.borrowed].filter(button => button.hinted).map(button => button.numeral);
  }

  it('marks nothing and says nothing without an answer', () => {
    const result = hintPalette({
      next: null,
      subject: null,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBeNull();
    expect(result.spokenCaption).toBeNull();
  });

  it('marks the diatonic targets and names each motion', () => {
    const result = hintPalette({
      next: targets(
        { degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' },
        { degree: 5, alter: 0, family: 'minor', reason: 'deceptive' }
      ),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual(['I', 'vi']);
    expect(result.caption).toBe('After V (G Maj): I — dominant to tonic · vi — deceptive');
    expect(result.spokenCaption).toBe('After G major: C Maj, dominant to tonic; A min, deceptive');
  });

  it('adds the suffix to a hinted button\'s label and to no other', () => {
    const result = hintPalette({
      next: targets({ degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.chords[0].label).toBe(`Add C Maj, degree 1${HINT_SUFFIX}`);
    expect(result.chords[1].label).toBe('Add D min, degree 2');
  });

  it('lands a minor key\'s major V on the Borrowed row, not on the diatonic v', () => {
    const result = hintPalette({
      next: targets(
        { degree: 4, alter: 0, family: 'major', reason: 'predominant-to-dominant' },
        { degree: 6, alter: 1, family: 'diminished', reason: 'predominant-to-dominant' }
      ),
      subject: { numeral: 'iv', name: 'D min', subject: 'D minor' },
      scaleIntervals: AEOLIAN,
      chords: A_MINOR_CHORDS,
      borrowed: A_MINOR_BORROWED
    });
    expect(hintedNumerals(result)).toEqual(['V', '♮vii°']);
  });

  it('falls back to the key\'s own chord on the root: melodic minor\'s IV for iv', () => {
    const result = hintPalette({
      next: targets({ degree: 3, alter: 0, family: 'minor', reason: 'rising-step' }),
      subject: { numeral: 'III+', name: 'C aug', subject: 'C augmented' },
      scaleIntervals: MELODIC_MINOR,
      chords: A_MELODIC_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual(['IV']);
  });

  it('drops a target no button can show, and says so when every one is dropped', () => {
    const result = hintPalette({
      next: targets({ degree: 5, alter: -1, family: 'major', reason: 'falling-fifth' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBe('No common next chord after V (G Maj)');
    expect(result.spokenCaption).toBe('No common next chord after G major');
  });

  it('says the tonic can go anywhere, and marks nothing', () => {
    const result = hintPalette({
      next: { kind: 'any' },
      subject: { numeral: 'I', name: 'C Maj', subject: 'C major' },
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(hintedNumerals(result)).toEqual([]);
    expect(result.caption).toBe('After I (C Maj): any chord — the tonic can go anywhere');
    expect(result.spokenCaption).toBe('After C major: any chord, the tonic can go anywhere');
  });

  it('says which keys the hints cover', () => {
    const result = hintPalette({
      next: { kind: 'unsupported' },
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.caption).toBe('Next-chord hints cover major, minor and the church modes');
  });

  it('names a chord with no entry', () => {
    const result = hintPalette({
      next: { kind: 'none' },
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(result.caption).toBe('No common next chord after V (G Maj)');
  });

  it('returns fresh buttons and leaves the ones it was given alone', () => {
    hintPalette({
      next: targets({ degree: 0, alter: 0, family: 'major', reason: 'dominant-to-tonic' }),
      subject: G_MAJOR,
      scaleIntervals: IONIAN,
      chords: C_MAJOR_CHORDS,
      borrowed: []
    });
    expect(C_MAJOR_CHORDS[0].hinted).toBeFalse();
  });
});
