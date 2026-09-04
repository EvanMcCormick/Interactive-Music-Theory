import { ClefKind, KeySignature, NotePitch, OttaviaKind } from '../models/composer.model';

/**
 * Converts a vertical position on a standard notation staff into a pitch.
 *
 * A staff position is a diatonic step, not a semitone: each half of a line
 * spacing moves one letter name, and the key signature then decides whether
 * that letter is sharpened or flattened. Clef fixes which letter the bottom
 * line carries, and an ottava marking shifts the sounding octave.
 *
 * Pure functions with no DOM or alphaTab dependency, so the arithmetic can be
 * checked directly against known musical facts.
 */

/** The pitched half of NotePitch, narrowed so callers get noteValue/octave. */
export type PitchedNote = Extract<NotePitch, { kind: 'pitched' }>;

/** Semitone of each natural letter, C through B. */
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** Letters sharpened as the key signature gains sharps: F C G D A E B. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];

/** Letters flattened as the key signature gains flats: B E A D G C F. */
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * Diatonic index of the note on a staff's bottom line.
 *
 * Index counts letters from C0, so `octave * 7 + step`:
 *   treble (G2) bottom line E4 -> 4*7 + 2 = 30
 *   bass   (F4) bottom line G2 -> 2*7 + 4 = 18
 *   alto   (C3) bottom line F3 -> 3*7 + 3 = 24, putting C4 on the middle line
 *   tenor  (C4) bottom line D3 -> 3*7 + 1 = 22, putting C4 on the fourth line
 */
export function bottomLineDiatonic(clef: ClefKind): number | null {
  switch (clef) {
    case 'g2': return 30;
    case 'f4': return 18;
    case 'c3': return 24;
    case 'c4': return 22;
    default: return null; // neutral/percussion staves have no pitch mapping
  }
}

/** Octave offset an ottava marking applies to the sounding pitch. */
export function ottavaOctaves(ottava: OttaviaKind): number {
  switch (ottava) {
    case '15ma': return 2;
    case '8va': return 1;
    case '8vb': return -1;
    case '15mb': return -2;
    default: return 0;
  }
}

/**
 * Semitone adjustment the key signature applies to a letter.
 * Positive fifths sharpen in the order F C G D A E B; negative fifths flatten
 * in the order B E A D G C F.
 */
export function keyAlteration(step: number, fifths: number): number {
  if (fifths > 0) {
    return SHARP_ORDER.slice(0, Math.min(fifths, 7)).includes(step) ? 1 : 0;
  }
  if (fifths < 0) {
    return FLAT_ORDER.slice(0, Math.min(-fifths, 7)).includes(step) ? -1 : 0;
  }
  return 0;
}

/**
 * Turns a diatonic staff index into a sounding pitch.
 *
 * The alteration can push a letter out of its own octave: B sharpened is C of
 * the next octave up, C flattened is B of the one below, so the octave is
 * carried rather than the semitone being wrapped in place.
 */
export function diatonicToPitch(
  diatonic: number,
  key: KeySignature,
  ottava: OttaviaKind = 'regular'
): PitchedNote {
  const step = ((diatonic % 7) + 7) % 7;
  const baseOctave = Math.floor(diatonic / 7);
  const semitone = STEP_SEMITONES[step] + keyAlteration(step, key.fifths);

  let noteValue = semitone;
  let octave = baseOctave + ottavaOctaves(ottava);

  if (noteValue > 11) {
    noteValue -= 12;
    octave += 1;
  } else if (noteValue < 0) {
    noteValue += 12;
    octave -= 1;
  }

  return { kind: 'pitched', noteValue, octave };
}

/**
 * Diatonic index for a click, given the bottom staff line's position.
 *
 * Half a line spacing is one diatonic step, so this extends naturally onto
 * ledger lines above and below the staff.
 */
export function diatonicAt(
  clef: ClefKind,
  bottomLineY: number,
  lineSpacing: number,
  y: number
): number | null {
  const bottom = bottomLineDiatonic(clef);
  if (bottom === null || lineSpacing <= 0) return null;

  const steps = Math.round((bottomLineY - y) / (lineSpacing / 2));
  return bottom + steps;
}

/** Sounding MIDI number for a pitch. Middle C, C4, is 60. */
export function pitchToMidi(pitch: PitchedNote): number {
  return (pitch.octave + 1) * 12 + pitch.noteValue;
}
