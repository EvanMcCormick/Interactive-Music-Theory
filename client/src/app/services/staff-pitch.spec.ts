import {
  bottomLineDiatonic,
  diatonicAt,
  diatonicToPitch,
  keyAlteration,
  ottavaOctaves,
  pitchToMidi
} from './staff-pitch';
import { KeySignature } from '../models/composer.model';

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };
const D_MAJOR: KeySignature = { fifths: 2, mode: 'major' };
const BB_MAJOR: KeySignature = { fifths: -2, mode: 'major' };

/** Convenience: pitch of a staff position counted up from the bottom line. */
function atStep(clef: 'g2' | 'f4' | 'c3' | 'c4', steps: number, key = C_MAJOR) {
  return diatonicToPitch(bottomLineDiatonic(clef)! + steps, key);
}

describe('bottomLineDiatonic', () => {
  // Checked against the standard clefs: the note sitting on the lowest line.
  it('puts E4 on the bottom line of a treble staff', () => {
    expect(diatonicToPitch(bottomLineDiatonic('g2')!, C_MAJOR)).toEqual({
      kind: 'pitched',
      noteValue: 4,
      octave: 4
    });
  });

  it('puts G2 on the bottom line of a bass staff', () => {
    expect(diatonicToPitch(bottomLineDiatonic('f4')!, C_MAJOR)).toEqual({
      kind: 'pitched',
      noteValue: 7,
      octave: 2
    });
  });

  it('puts middle C on the middle line of an alto staff', () => {
    // Lines are two diatonic steps apart, so the middle line is 4 steps up.
    expect(pitchToMidi(atStep('c3', 4))).toBe(60);
  });

  it('puts middle C on the fourth line of a tenor staff', () => {
    expect(pitchToMidi(atStep('c4', 6))).toBe(60);
  });

  it('has no mapping for a neutral percussion staff', () => {
    expect(bottomLineDiatonic('n')).toBeNull();
  });
});

describe('treble staff positions', () => {
  // Bottom to top: E4 G4 B4 D5 F5, with spaces F4 A4 C5 E5 between.
  const expected: Array<[number, number]> = [
    [0, 64], // E4, bottom line
    [1, 65], // F4, first space
    [2, 67], // G4, second line
    [3, 69], // A4
    [4, 71], // B4, middle line
    [5, 72], // C5
    [6, 74], // D5
    [7, 76], // E5
    [8, 77] // F5, top line
  ];

  for (const [steps, midi] of expected) {
    it(`maps ${steps} steps above the bottom line to MIDI ${midi}`, () => {
      expect(pitchToMidi(atStep('g2', steps))).toBe(midi);
    });
  }

  it('reads middle C as the first ledger line below the staff', () => {
    // C4 sits two diatonic steps below E4.
    expect(pitchToMidi(atStep('g2', -2))).toBe(60);
  });
});

describe('bass staff positions', () => {
  it('reads middle C as the first ledger line above the staff', () => {
    // Top line is A3; C4 is two steps above it, ten above the bottom line.
    expect(pitchToMidi(atStep('f4', 10))).toBe(60);
  });

  it('maps the top line to A3', () => {
    expect(pitchToMidi(atStep('f4', 8))).toBe(57);
  });
});

describe('keyAlteration', () => {
  it('applies no alteration in C major', () => {
    for (let step = 0; step < 7; step++) {
      expect(keyAlteration(step, 0)).toBe(0);
    }
  });

  it('sharpens F and C in D major', () => {
    expect(keyAlteration(3, 2)).toBe(1); // F
    expect(keyAlteration(0, 2)).toBe(1); // C
    expect(keyAlteration(4, 2)).toBe(0); // G untouched
  });

  it('flattens B and E in Bb major', () => {
    expect(keyAlteration(6, -2)).toBe(-1); // B
    expect(keyAlteration(2, -2)).toBe(-1); // E
    expect(keyAlteration(5, -2)).toBe(0); // A untouched
  });

  it('follows the order of sharps F C G D A E B', () => {
    const order = [3, 0, 4, 1, 5, 2, 6];
    order.forEach((step, index) => {
      expect(keyAlteration(step, index + 1)).toBe(1);
      if (index > 0) expect(keyAlteration(step, index)).toBe(0);
    });
  });

  it('follows the order of flats B E A D G C F', () => {
    const order = [6, 2, 5, 1, 4, 0, 3];
    order.forEach((step, index) => {
      expect(keyAlteration(step, -(index + 1))).toBe(-1);
      if (index > 0) expect(keyAlteration(step, -index)).toBe(0);
    });
  });
});

describe('key signature applied to staff positions', () => {
  it('reads the bottom treble line as F#4 in D major', () => {
    // First space is F; D major sharpens it.
    expect(pitchToMidi(atStep('g2', 1, D_MAJOR))).toBe(66); // F#4
  });

  it('leaves E natural in D major', () => {
    expect(pitchToMidi(atStep('g2', 0, D_MAJOR))).toBe(64);
  });

  it('reads B as Bb in Bb major', () => {
    // B4 is four steps above the bottom line.
    expect(pitchToMidi(atStep('g2', 4, BB_MAJOR))).toBe(70); // Bb4
  });
});

describe('accidentals that cross an octave boundary', () => {
  it('treats B sharp as C of the next octave', () => {
    // Seven sharps sharpens every letter, so B4 becomes B#4, sounding C5.
    const sevenSharps: KeySignature = { fifths: 7, mode: 'major' };
    const pitch = diatonicToPitch(bottomLineDiatonic('g2')! + 4, sevenSharps);
    expect(pitch).toEqual({ kind: 'pitched', noteValue: 0, octave: 5 });
    expect(pitchToMidi(pitch)).toBe(72);
  });

  it('treats C flat as B of the previous octave', () => {
    // Seven flats flattens every letter, so C5 becomes Cb5, sounding B4.
    const sevenFlats: KeySignature = { fifths: -7, mode: 'major' };
    const pitch = diatonicToPitch(bottomLineDiatonic('g2')! + 5, sevenFlats);
    expect(pitch).toEqual({ kind: 'pitched', noteValue: 11, octave: 4 });
    expect(pitchToMidi(pitch)).toBe(71);
  });
});

describe('ottavaOctaves', () => {
  it('shifts by whole octaves in the notated direction', () => {
    expect(ottavaOctaves('15ma')).toBe(2);
    expect(ottavaOctaves('8va')).toBe(1);
    expect(ottavaOctaves('regular')).toBe(0);
    expect(ottavaOctaves('8vb')).toBe(-1);
    expect(ottavaOctaves('15mb')).toBe(-2);
  });

  it('sounds a treble 8vb staff an octave below what is written', () => {
    const written = bottomLineDiatonic('g2')!;
    expect(pitchToMidi(diatonicToPitch(written, C_MAJOR, '8vb'))).toBe(52); // E3
    expect(pitchToMidi(diatonicToPitch(written, C_MAJOR, 'regular'))).toBe(64); // E4
  });
});

describe('diatonicAt', () => {
  // A staff drawn with lines 9px apart, bottom line at y = 72.
  const bottomLineY = 72;
  const spacing = 9;

  it('reads a click on the bottom line as that line', () => {
    expect(diatonicAt('g2', bottomLineY, spacing, 72)).toBe(bottomLineDiatonic('g2'));
  });

  it('reads each half spacing as one diatonic step upwards', () => {
    expect(diatonicAt('g2', bottomLineY, spacing, 67.5)).toBe(bottomLineDiatonic('g2')! + 1);
    expect(diatonicAt('g2', bottomLineY, spacing, 63)).toBe(bottomLineDiatonic('g2')! + 2);
  });

  it('snaps to the nearest position rather than truncating', () => {
    // Two thirds of the way to the next step still rounds up to it.
    expect(diatonicAt('g2', bottomLineY, spacing, 69)).toBe(bottomLineDiatonic('g2')! + 1);
  });

  it('extends below the staff onto ledger lines', () => {
    expect(diatonicAt('g2', bottomLineY, spacing, 81)).toBe(bottomLineDiatonic('g2')! - 2);
  });

  it('returns null for a staff with no pitch mapping', () => {
    expect(diatonicAt('n', bottomLineY, spacing, 72)).toBeNull();
  });

  it('returns null for a degenerate line spacing', () => {
    expect(diatonicAt('g2', bottomLineY, 0, 72)).toBeNull();
  });
});
