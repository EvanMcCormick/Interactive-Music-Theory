import { keySignatureFault } from './bar-edits';
import {
  CLEF_CHOICES,
  KEY_SIGNATURE_CHOICES,
  MAX_ENDING,
  TRIPLET_FEEL_CHOICES,
  endingBitsOf,
  endingsOf
} from './composer-bar-choices';

describe('composer bar choices', () => {
  it('offers all fifteen key signatures in both modes, every one of them valid', () => {
    expect(KEY_SIGNATURE_CHOICES.length).toBe(30);
    for (const mode of ['major', 'minor'] as const) {
      const fifths = KEY_SIGNATURE_CHOICES.filter(choice => choice.value.mode === mode).map(choice => choice.value.fifths);
      expect(fifths).toEqual([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]);
    }
    expect(KEY_SIGNATURE_CHOICES.every(choice => keySignatureFault(choice.value) === null)).toBeTrue();
  });

  it('names each key by its tonic and its accidentals', () => {
    const label = (fifths: number, mode: 'major' | 'minor'): string =>
      KEY_SIGNATURE_CHOICES.find(choice => choice.value.fifths === fifths && choice.value.mode === mode)?.label ?? '';

    expect(label(0, 'major')).toBe('C major (no sharps or flats)');
    expect(label(0, 'minor')).toBe('A minor (no sharps or flats)');
    expect(label(-7, 'major')).toBe('C♭ major (7 flats)');
    expect(label(7, 'minor')).toBe('A♯ minor (7 sharps)');
    expect(label(1, 'major')).toBe('G major (1 sharp)');
  });

  it('offers every clef the model has, and every triplet feel', () => {
    expect(CLEF_CHOICES.map(choice => choice.value)).toEqual(['g2', 'f4', 'c3', 'c4', 'n']);
    expect(TRIPLET_FEEL_CHOICES.length).toBe(7);
  });

  it('reads and writes alternate endings as a bitfield, first ending in bit 0', () => {
    expect(endingsOf(0b101)).toEqual([1, 3]);
    expect(endingBitsOf([1, 3])).toBe(0b101);
    expect(endingBitsOf(endingsOf(0b11000000))).toBe(0b11000000);
    expect(MAX_ENDING).toBe(8);
  });
});
