import { ClefKind, KeySignature, OttaviaKind, TripletFeelKind } from '../models/composer.model';

/**
 * The values the composer's bar popovers offer: key signatures, clefs, ottavas, triplet feels and
 * alternate endings.
 *
 * The key signatures are all fifteen in both modes. The mapper's `KEY_SIGNATURES` lists majors only and
 * stops at six accidentals, which was enough for a picker of common keys and is not enough for a tool
 * that must reach any key a file can hold.
 */

/** One option in a popover: what it says, and the value it sets. */
export interface Choice<T> {
  label: string;
  value: T;
}

/** Major tonics from seven flats to seven sharps, index 0 being `fifths` -7. */
const MAJOR_TONICS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];

/** The relative minor of each, a minor third below. */
const MINOR_TONICS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

function accidentalsOf(fifths: number): string {
  if (fifths === 0) return 'no sharps or flats';
  const count = Math.abs(fifths);
  return `${count} ${fifths > 0 ? 'sharp' : 'flat'}${count === 1 ? '' : 's'}`;
}

/** Every key signature, majors then minors, each from seven flats to seven sharps. */
export const KEY_SIGNATURE_CHOICES: readonly Choice<KeySignature>[] = (['major', 'minor'] as const).flatMap(mode =>
  (mode === 'major' ? MAJOR_TONICS : MINOR_TONICS).map((tonic, index) => {
    const fifths = index - 7;
    return { label: `${tonic} ${mode} (${accidentalsOf(fifths)})`, value: { fifths, mode } };
  })
);

export const CLEF_CHOICES: readonly Choice<ClefKind>[] = [
  { label: 'Treble (G)', value: 'g2' },
  { label: 'Bass (F)', value: 'f4' },
  { label: 'Alto (C on the middle line)', value: 'c3' },
  { label: 'Tenor (C on the fourth line)', value: 'c4' },
  { label: 'Neutral', value: 'n' }
];

export const OTTAVA_CHOICES: readonly Choice<OttaviaKind>[] = [
  { label: 'Two octaves up (15ma)', value: '15ma' },
  { label: 'An octave up (8va)', value: '8va' },
  { label: 'As written', value: 'regular' },
  { label: 'An octave down (8vb)', value: '8vb' },
  { label: 'Two octaves down (15mb)', value: '15mb' }
];

export const TRIPLET_FEEL_CHOICES: readonly Choice<TripletFeelKind>[] = [
  { label: 'Straight', value: 'none' },
  { label: 'Triplet eighths', value: 'triplet8th' },
  { label: 'Triplet sixteenths', value: 'triplet16th' },
  { label: 'Dotted eighths', value: 'dotted8th' },
  { label: 'Dotted sixteenths', value: 'dotted16th' },
  { label: 'Scottish eighths', value: 'scottish8th' },
  { label: 'Scottish sixteenths', value: 'scottish16th' }
];

/** The highest alternate ending the popover offers. */
export const MAX_ENDING = 8;

/** The endings a bitfield marks, first ending first. Bit 0 is ending 1. */
export function endingsOf(bits: number): number[] {
  return Array.from({ length: MAX_ENDING }, (_, index) => index + 1).filter(ending => (bits & (1 << (ending - 1))) !== 0);
}

/**
 * The bitfield marking `endings`. An ending outside 1 to `MAX_ENDING`, or not a whole number, is left out rather than
 * written: 0 would shift by -1, which JavaScript takes as 31 and so makes the field negative, and 9 would set a bit
 * for an ending the popover never offers and `endingsOf` never reads back.
 */
export function endingBitsOf(endings: readonly number[]): number {
  return endings
    .filter(ending => Number.isInteger(ending) && ending >= 1 && ending <= MAX_ENDING)
    .reduce((bits, ending) => bits | (1 << (ending - 1)), 0);
}
