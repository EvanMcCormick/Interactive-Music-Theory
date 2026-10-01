import { ChordDegree, ProgressionKey, createDegreeSlot } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { chordName, romanNumeral } from './progression-chord-names';
import { ChordExtent, effectiveChord, isHeptatonic } from './progression-harmony';
import { chordRootName } from './progression-spelling';
import { leadSheetNameOf, numeralOf } from './song-chord-names';

/**
 * The sheet's chord names, checked against how a lead sheet prints them.
 *
 * Every expected name here was worked out by hand before it was written down:
 * the module's whole claim is that it prints what a chart prints, so a fixture
 * read off its own output would be testing nothing. The intervals are written
 * out rather than looked up, on the `progression-spelling.spec.ts` precedent;
 * the one sweep at the bottom asks the service for its scales because its
 * question is about all of them.
 */
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const G_MAJOR: ProgressionKey = { tonic: 7, scaleId: 'ionian', preferSharps: true };
const F_MAJOR: ProgressionKey = { tonic: 5, scaleId: 'ionian', preferSharps: false };
const E_MAJOR: ProgressionKey = { tonic: 4, scaleId: 'ionian', preferSharps: true };
const E_FLAT_MAJOR: ProgressionKey = { tonic: 3, scaleId: 'ionian', preferSharps: false };
const B_FLAT_MAJOR: ProgressionKey = { tonic: 10, scaleId: 'ionian', preferSharps: false };
const A_MINOR: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };

/**
 * A degree as a slot really holds one, with the given fields over it.
 *
 * Built through `createDegreeSlot` so the fixture carries whatever a fresh slot
 * carries, as `progression-spelling.spec.ts` does.
 */
function chord(shape: Partial<ChordDegree> & { degree: number }): ChordDegree {
  const slot = createDegreeSlot(shape.degree, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
  return { ...slot.harmony.degree, ...shape };
}

describe('leadSheetNameOf', () => {
  describe('in C major', () => {
    const named = (shape: Partial<ChordDegree> & { degree: number }): string =>
      leadSheetNameOf(chord(shape), C_MAJOR, IONIAN);

    it('writes a major triad as its root alone', () => {
      expect(named({ degree: 0 })).toBe('C');
      expect(named({ degree: 4 })).toBe('G');
    });

    it('writes a minor triad with a lower-case m', () => {
      expect(named({ degree: 5 })).toBe('Am');
      expect(named({ degree: 1 })).toBe('Dm');
    });

    it('writes the diminished and augmented triads with the signs the progression page uses', () => {
      expect(named({ degree: 6 })).toBe('B°');
      expect(named({ degree: 0, quality: 'augmented' })).toBe('C+');
    });

    it('writes the four diatonic sevenths as a chart does', () => {
      expect(named({ degree: 0, extent: 7 })).toBe('Cmaj7');
      expect(named({ degree: 4, extent: 7 })).toBe('G7');
      expect(named({ degree: 5, extent: 7 })).toBe('Am7');
    });

    it('writes the half-diminished seventh with ø, which is what chordName writes', () => {
      const half = chord({ degree: 6, extent: 7 });

      expect(leadSheetNameOf(half, C_MAJOR, IONIAN)).toBe('Bø7');
      expect(chordName('B', effectiveChord(IONIAN, half))).toBe('Bø7');
    });

    it('writes the other seventh shapes', () => {
      expect(named({ degree: 6, extent: 7, quality: 'diminished7' })).toBe('B°7');
      expect(named({ degree: 0, extent: 7, quality: 'minorMajor7' })).toBe('CmMaj7');
      expect(named({ degree: 0, extent: 7, quality: 'augmented7' })).toBe('C+7');
      expect(named({ degree: 0, extent: 7, quality: 'augmentedMajor7' })).toBe('C+maj7');
    });

    it('writes a borrowed chord on the letter its numeral names', () => {
      expect(named({ degree: 6, alter: -1, quality: 'major' })).toBe('Bb');
      expect(named({ degree: 6, alter: -1, quality: 'dominant7', extent: 7 })).toBe('Bb7');
      expect(named({ degree: 5, alter: -1, quality: 'major' })).toBe('Ab');
      expect(named({ degree: 3, alter: 1, quality: 'minor' })).toBe('F#m');
    });

    it('writes a secondary dominant by its own root', () => {
      expect(named({ degree: 1, quality: 'dominant7', extent: 7 })).toBe('D7');
    });

    it('writes the suspensions last', () => {
      expect(named({ degree: 4, suspension: 'sus4' })).toBe('Gsus4');
      expect(named({ degree: 0, suspension: 'sus2' })).toBe('Csus2');
      expect(named({ degree: 4, extent: 7, suspension: 'sus4' })).toBe('G7sus4');
      expect(named({ degree: 4, extent: 9, suspension: 'sus4' })).toBe('G9sus4');
    });

    it('writes the added-tone chords', () => {
      expect(named({ degree: 0, extent: 7, quality: 'major6' })).toBe('C6');
      expect(named({ degree: 5, extent: 7, quality: 'minor6' })).toBe('Am6');
      expect(named({ degree: 0, extent: 7, quality: 'add9' })).toBe('Cadd9');
      expect(named({ degree: 5, extent: 7, quality: 'minorAdd9' })).toBe('Amadd9');
      expect(named({ degree: 0, extent: 9, quality: 'major6' })).toBe('C6/9');
    });

    it('writes ninths, elevenths and thirteenths at the height they reach', () => {
      expect(named({ degree: 0, extent: 9, quality: 'dominant7' })).toBe('C9');
      expect(named({ degree: 4, extent: 9 })).toBe('G9');
      expect(named({ degree: 1, extent: 11 })).toBe('Dm11');
      expect(named({ degree: 0, extent: 13 })).toBe('Cmaj13');
      expect(named({ degree: 4, extent: 13 })).toBe('G13');
    });

    it('writes the alterations the model can pin, ascending after the height', () => {
      const flatNine = { ninth: -1 as const, eleventh: null, thirteenth: null };
      const sharpEleven = { ninth: null, eleventh: 1 as const, thirteenth: null };

      expect(named({ degree: 4, extent: 9, extensions: flatNine })).toBe('G7b9');
      expect(named({ degree: 0, extent: 11, extensions: sharpEleven })).toBe('Cmaj9#11');
      expect(named({ degree: 4, extent: 9, extensions: { ...flatNine, ninth: 1 } })).toBe('G7#9');
    });

    it('writes an inversion as a slash over the note in the bass', () => {
      expect(named({ degree: 3, inversion: 1 })).toBe('F/A');
      expect(named({ degree: 3, inversion: 2 })).toBe('F/C');
      expect(named({ degree: 4, extent: 7, inversion: 3 })).toBe('G7/F');
    });

    it('marks a chord with no name the way chordName does, rather than guessing', () => {
      // A diminished triad has no suspended symbol: see `SUSPENDED_FIGURES`.
      const suspended = chord({ degree: 6, suspension: 'sus4' });

      expect(leadSheetNameOf(suspended, C_MAJOR, IONIAN)).toBe('B?');
      expect(chordName('B', effectiveChord(IONIAN, suspended))).toBe('B?');
    });
  });

  describe('spelling', () => {
    it('follows the key: sharps in G, flats in F', () => {
      expect(leadSheetNameOf(chord({ degree: 6 }), G_MAJOR, IONIAN)).toBe('F#°');
      expect(leadSheetNameOf(chord({ degree: 2 }), G_MAJOR, IONIAN)).toBe('Bm');
      expect(leadSheetNameOf(chord({ degree: 3 }), F_MAJOR, IONIAN)).toBe('Bb');
      expect(leadSheetNameOf(chord({ degree: 4, extent: 7 }), E_FLAT_MAJOR, IONIAN)).toBe('Bb7');
    });

    it("spells a displaced root by its degree's letter, not by preference", () => {
      // B flat major's ♭II is a C flat: the second letter above B.
      const neapolitan = chord({ degree: 1, alter: -1, quality: 'major' });
      expect(leadSheetNameOf(neapolitan, B_FLAT_MAJOR, IONIAN)).toBe('Cb');
    });

    it('spells the slash bass on the letter its place in the chord names', () => {
      expect(leadSheetNameOf(chord({ degree: 0, inversion: 1 }), E_MAJOR, IONIAN)).toBe('E/G#');
      expect(leadSheetNameOf(chord({ degree: 4, extent: 7, inversion: 1 }), E_FLAT_MAJOR, IONIAN)).toBe('Bb7/D');
      const flatSix = chord({ degree: 5, alter: -1, quality: 'major', inversion: 1 });
      expect(leadSheetNameOf(flatSix, C_MAJOR, IONIAN)).toBe('Ab/C');
    });

    it("names a mode's degrees as that mode builds them", () => {
      expect(leadSheetNameOf(chord({ degree: 6 }), A_MINOR, AEOLIAN)).toBe('G');
      expect(leadSheetNameOf(chord({ degree: 1, extent: 7 }), A_MINOR, AEOLIAN)).toBe('Bø7');
      expect(leadSheetNameOf(chord({ degree: 4, extent: 7 }), A_MINOR, HARMONIC_MINOR)).toBe('E7');
      expect(leadSheetNameOf(chord({ degree: 2 }), A_MINOR, HARMONIC_MINOR)).toBe('C+');
    });
  });

  /**
   * The name's identity comes from where `chordName`'s does, so the two can
   * never disagree about which chord a degree is: the same root, and the same
   * refusal. Only the suffix differs, and that is the one table this module adds.
   */
  it("agrees with chordName on every chord's root and on which chords have no name", () => {
    const scales = new MusicTheoryService()
      .getScaleCategories()
      .flatMap(category => category.scales)
      .filter(scale => isHeptatonic(scale.intervals));
    const extents: readonly ChordExtent[] = [3, 7, 9, 11, 13];
    let checked = 0;

    for (const scale of scales) {
      for (let tonic = 0; tonic < 12; tonic++) {
        const key: ProgressionKey = { tonic, scaleId: scale.id, preferSharps: scale.preferSharps };
        for (let degree = 0; degree < 7; degree++) {
          for (const extent of extents) {
            const shape = chord({ degree, extent });
            const root = chordRootName(key, scale.intervals, shape);
            const name = leadSheetNameOf(shape, key, scale.intervals);
            const printed = chordName(root, effectiveChord(scale.intervals, shape));

            expect(name.startsWith(root)).withContext(`${printed} in ${scale.id}`).toBeTrue();
            expect(name.endsWith('?')).withContext(`${printed} in ${scale.id}`).toBe(printed.endsWith('?'));
            checked++;
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
  });
});

describe('numeralOf', () => {
  it("is the progression page's numeral for the same degree", () => {
    const shapes: ChordDegree[] = [
      chord({ degree: 0 }),
      chord({ degree: 5 }),
      chord({ degree: 6 }),
      chord({ degree: 6, extent: 7 }),
      chord({ degree: 4, extent: 9 }),
      chord({ degree: 6, alter: -1, quality: 'major' })
    ];

    for (const shape of shapes) {
      expect(numeralOf(shape, IONIAN)).toBe(
        romanNumeral(shape.degree, shape.alter, effectiveChord(IONIAN, shape))
      );
    }
  });

  it('prints the numerals the sheet toggles to', () => {
    expect(numeralOf(chord({ degree: 0 }), IONIAN)).toBe('I');
    expect(numeralOf(chord({ degree: 5 }), IONIAN)).toBe('vi');
    expect(numeralOf(chord({ degree: 6 }), IONIAN)).toBe('vii°');
    expect(numeralOf(chord({ degree: 4, extent: 7 }), IONIAN)).toBe('V7');
    expect(numeralOf(chord({ degree: 6, alter: -1, quality: 'major' }), IONIAN)).toBe('♭VII');
  });

  it("is relative to the key's own mode", () => {
    // A aeolian's seventh is a G, so its G major triad is VII and not ♭VII.
    expect(numeralOf(chord({ degree: 6 }), AEOLIAN)).toBe('VII');
    expect(numeralOf(chord({ degree: 0 }), AEOLIAN)).toBe('i');
  });
});
