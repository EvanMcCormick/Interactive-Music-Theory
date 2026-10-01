import { SUSPENSIONS } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey, createDegreeSlot } from '../models/progression.model';
import { CHORD_CATEGORIES } from './chord-catalog';
import { MusicTheoryService } from './music-theory.service';
import { ChordExtent, effectiveChord, isHeptatonic } from './progression-harmony';
import { TypedChord, chordFromText } from './song-chord-parse';
import { leadSheetNameOf, numeralOf } from './song-chord-names';

/**
 * Reading a chord typed into the sheet's `[` field, by name or by numeral.
 *
 * Fixtures first, each worked out by hand; then the round trips the parser is
 * held to - what the sheet prints, the field reads back as the same chord - over
 * a table of names and then over every chord the app's scales build.
 */
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const G_MAJOR: ProgressionKey = { tonic: 7, scaleId: 'ionian', preferSharps: true };
const D_MAJOR: ProgressionKey = { tonic: 2, scaleId: 'ionian', preferSharps: true };
const F_MAJOR: ProgressionKey = { tonic: 5, scaleId: 'ionian', preferSharps: false };
const E_FLAT_MAJOR: ProgressionKey = { tonic: 3, scaleId: 'ionian', preferSharps: false };
const G_FLAT_MAJOR: ProgressionKey = { tonic: 6, scaleId: 'ionian', preferSharps: false };
const C_SHARP_MAJOR: ProgressionKey = { tonic: 1, scaleId: 'ionian', preferSharps: true };
const A_MINOR: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };
const A_HARMONIC_MINOR: ProgressionKey = { tonic: 9, scaleId: 'harmonicMinor', preferSharps: false };
const D_DORIAN: ProgressionKey = { tonic: 2, scaleId: 'dorian', preferSharps: false };
const C_PENTATONIC: ProgressionKey = { tonic: 0, scaleId: 'majorPentatonic', preferSharps: true };

/** The degree a reading produced, or a failed expectation naming the refusal. */
function degreeOf(reading: TypedChord): ChordDegree {
  if (reading.kind !== 'chord') throw new Error(`refused: ${reading.reason}`);
  return reading.degree;
}

/** The refusal's reason, or a failed expectation naming the chord it read. */
function reasonOf(reading: TypedChord): string {
  if (reading.kind !== 'refused') throw new Error(`read a chord: ${JSON.stringify(reading.degree)}`);
  return reading.reason;
}

/** What the sheet prints for a typed name, read in a key. */
function reprinted(text: string, key: ProgressionKey, scale: readonly number[]): string {
  return leadSheetNameOf(degreeOf(chordFromText(text, key, scale)), key, scale);
}

/** A degree as a slot really holds one, with the given fields over it. */
function chord(shape: Partial<ChordDegree> & { degree: number }): ChordDegree {
  const slot = createDegreeSlot(shape.degree, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
  return { ...slot.harmony.degree, ...shape };
}

describe('chordFromText', () => {
  describe('reading a name', () => {
    it('reads a diatonic chord as the degree the palette would store', () => {
      const am = degreeOf(chordFromText('Am', C_MAJOR, IONIAN));

      expect(am).toEqual(chord({ degree: 5 }));
    });

    it('reads a borrowed chord as its degree: Bb in C is ♭VII', () => {
      const bb = degreeOf(chordFromText('Bb', C_MAJOR, IONIAN));

      expect(bb.degree).toBe(6);
      expect(bb.alter).toBe(-1);
      expect(bb.quality).toBe('major');
      expect(numeralOf(bb, IONIAN)).toBe('♭VII');
    });

    it('reads a secondary dominant on its own root: D7 in C', () => {
      const d7 = degreeOf(chordFromText('D7', C_MAJOR, IONIAN));

      expect(d7.degree).toBe(1);
      expect(d7.alter).toBe(0);
      expect(d7.quality).toBe('dominant7');
      expect(d7.extent).toBe(7);
    });

    it('leaves to the key whatever the key already agrees with', () => {
      const g7 = degreeOf(chordFromText('G7', C_MAJOR, IONIAN));

      expect(g7).toEqual(chord({ degree: 4, extent: 7 }));
    });

    it('reads F/A as a first-inversion F', () => {
      expect(degreeOf(chordFromText('F/A', C_MAJOR, IONIAN))).toEqual(
        chord({ degree: 3, inversion: 1 })
      );
      expect(degreeOf(chordFromText('G7/F', C_MAJOR, IONIAN)).inversion).toBe(3);
    });

    it('reads suspensions, heights and alterations into the fields that hold them', () => {
      expect(degreeOf(chordFromText('Gsus4', C_MAJOR, IONIAN)).suspension).toBe('sus4');
      expect(degreeOf(chordFromText('C9', C_MAJOR, IONIAN))).toEqual(
        chord({ degree: 0, extent: 9, quality: 'dominant7' })
      );
      expect(degreeOf(chordFromText('G7b9', C_MAJOR, IONIAN)).extensions.ninth).toBe(-1);
    });

    it('takes the musical flat and sharp signs as well as b and #', () => {
      expect(reprinted('B♭7', C_MAJOR, IONIAN)).toBe('Bb7');
      expect(reprinted('F♯m', D_MAJOR, IONIAN)).toBe('F#m');
    });

    it('trims the field, and reads the progression page\'s own spaced names', () => {
      expect(reprinted('  Am  ', C_MAJOR, IONIAN)).toBe('Am');
      expect(reprinted('C Maj7', C_MAJOR, IONIAN)).toBe('Cmaj7');
      expect(reprinted('A min', C_MAJOR, IONIAN)).toBe('Am');
      expect(reprinted('B°', C_MAJOR, IONIAN)).toBe('B°');
    });

    it('keeps the letter typed, so a root spelled outside the key is still that spelling', () => {
      // F# in C is the raised fourth, not the flattened fifth expressInKey would
      // pick for a root that arrived with no letter at all.
      const sharpFour = degreeOf(chordFromText('F#', C_MAJOR, IONIAN));
      expect(numeralOf(sharpFour, IONIAN)).toBe('♯IV');
      expect(reprinted('Gb', C_MAJOR, IONIAN)).toBe('Gb');
    });

    it('reads Cb, E# and B# as the notes they name', () => {
      expect(reprinted('Cb', G_FLAT_MAJOR, IONIAN)).toBe('Cb');
      expect(degreeOf(chordFromText('Cb', G_FLAT_MAJOR, IONIAN))).toEqual(chord({ degree: 3 }));
      expect(reprinted('E#m', C_SHARP_MAJOR, IONIAN)).toBe('E#m');
      expect(degreeOf(chordFromText('B#°', C_SHARP_MAJOR, IONIAN))).toEqual(chord({ degree: 6 }));
      // Outside the keys that use them they are still the note typed, on that letter.
      expect(reprinted('Cb', C_MAJOR, IONIAN)).toBe('Cb');
      expect(numeralOf(degreeOf(chordFromText('Cb', C_MAJOR, IONIAN)), IONIAN)).toBe('♭I');
    });
  });

  describe('reading a numeral', () => {
    it('reads the case as the third', () => {
      expect(degreeOf(chordFromText('vi', C_MAJOR, IONIAN))).toEqual(chord({ degree: 5 }));
      expect(degreeOf(chordFromText('IV', C_MAJOR, IONIAN))).toEqual(chord({ degree: 3 }));
      expect(degreeOf(chordFromText('iv', C_MAJOR, IONIAN))).toEqual(
        chord({ degree: 3, quality: 'minor' })
      );
    });

    it('reads an accidental prefix as the root displaced', () => {
      for (const text of ['bVII', '♭VII']) {
        const flatSeven = degreeOf(chordFromText(text, C_MAJOR, IONIAN));
        expect(flatSeven).toEqual(chord({ degree: 6, alter: -1, quality: 'major' }));
      }
      expect(degreeOf(chordFromText('#iv°', C_MAJOR, IONIAN))).toEqual(
        chord({ degree: 3, alter: 1, quality: 'diminished' })
      );
    });

    it('keeps the numeral typed rather than respelling it', () => {
      const sharpFour = degreeOf(chordFromText('#IV', C_MAJOR, IONIAN));
      expect(sharpFour.degree).toBe(3);
      expect(sharpFour.alter).toBe(1);
    });

    it('reads the figures °, +, 7, maj7 and ø7', () => {
      expect(degreeOf(chordFromText('vii°', C_MAJOR, IONIAN))).toEqual(chord({ degree: 6 }));
      expect(degreeOf(chordFromText('V7', C_MAJOR, IONIAN))).toEqual(chord({ degree: 4, extent: 7 }));
      expect(degreeOf(chordFromText('Imaj7', C_MAJOR, IONIAN))).toEqual(chord({ degree: 0, extent: 7 }));
      expect(degreeOf(chordFromText('viiø7', C_MAJOR, IONIAN))).toEqual(chord({ degree: 6, extent: 7 }));
      expect(degreeOf(chordFromText('III+', A_HARMONIC_MINOR, HARMONIC_MINOR))).toEqual(
        chord({ degree: 2 })
      );
      expect(degreeOf(chordFromText('V7', A_MINOR, AEOLIAN))).toEqual(
        chord({ degree: 4, extent: 7, quality: 'dominant7' })
      );
    });

    it("is relative to the key's own mode, as the progression page's numerals are", () => {
      // A aeolian's seventh degree is a G, so VII is a G major triad there.
      expect(degreeOf(chordFromText('VII', A_MINOR, AEOLIAN))).toEqual(chord({ degree: 6 }));
      expect(reprinted('VII', A_MINOR, AEOLIAN)).toBe('G');
      expect(reprinted('IV', D_DORIAN, DORIAN)).toBe('G');
    });
  });

  describe('refusing', () => {
    it('refuses an empty field', () => {
      expect(reasonOf(chordFromText('', C_MAJOR, IONIAN))).toMatch(/chord name/);
      expect(reasonOf(chordFromText('   ', C_MAJOR, IONIAN))).toMatch(/chord name/);
    });

    it('refuses a key whose scale cannot build chords', () => {
      expect(reasonOf(chordFromText('C', C_PENTATONIC, MAJOR_PENTATONIC))).toMatch(/seven-note scale/);
      expect(reasonOf(chordFromText('C', C_PENTATONIC, null))).toMatch(/seven-note scale/);
    });

    it('refuses a root that is not a note, naming it', () => {
      expect(reasonOf(chordFromText('H7', C_MAJOR, IONIAN))).toContain('"H"');
      expect(reasonOf(chordFromText('7', C_MAJOR, IONIAN))).toContain('"7"');
    });

    it('asks for a capital rather than reading a lower-case root', () => {
      expect(reasonOf(chordFromText('am', C_MAJOR, IONIAN))).toContain('Am');
    });

    it('refuses an unknown suffix, naming it', () => {
      expect(reasonOf(chordFromText('Cxyz', C_MAJOR, IONIAN))).toContain('"xyz"');
      expect(reasonOf(chordFromText('Cmaj7b11', C_MAJOR, IONIAN))).toContain('"b11"');
    });

    it('refuses a power chord, which has no third to build from', () => {
      expect(reasonOf(chordFromText('C5', C_MAJOR, IONIAN))).toMatch(/no third/);
    });

    it('refuses an altered extension with no seventh under it', () => {
      expect(reasonOf(chordFromText('Cadd9#11', C_MAJOR, IONIAN))).toMatch(/seventh/);
    });

    it('refuses a shape the model has no quality for', () => {
      expect(reasonOf(chordFromText('C7b5', C_MAJOR, IONIAN))).toContain('C7b5');
    });

    /**
     * The model has no field for a bass that is not a chord tone: `expressInKey`
     * reads one as root position (`inversionOf`), so C/D would be stored as a
     * plain C and the D lost. Refused instead, never dropped.
     */
    it('refuses a slash bass that is not a note of the chord', () => {
      const reason = reasonOf(chordFromText('C/D', C_MAJOR, IONIAN));
      expect(reason).toContain('D');
      expect(reason).toMatch(/note of the chord/);
      expect(reasonOf(chordFromText('C/H', C_MAJOR, IONIAN))).toContain('"H"');
      expect(reasonOf(chordFromText('/E', C_MAJOR, IONIAN))).toMatch(/before the slash/);
    });

    it('refuses a numeral in mixed case or past the seventh degree', () => {
      expect(reasonOf(chordFromText('Vi', C_MAJOR, IONIAN))).toMatch(/one case/);
      expect(reasonOf(chordFromText('VIII', C_MAJOR, IONIAN))).toMatch(/I to VII/);
    });

    it('refuses a figure that contradicts the case', () => {
      expect(reasonOf(chordFromText('VII°', C_MAJOR, IONIAN))).toMatch(/lower case/);
      expect(reasonOf(chordFromText('iii+', C_MAJOR, IONIAN))).toMatch(/upper case/);
    });

    it('refuses a secondary numeral, pointing at its own name instead', () => {
      expect(reasonOf(chordFromText('V/V', C_MAJOR, IONIAN))).toMatch(/chord name/);
    });
  });

  describe('the round trip: what the sheet prints, the field reads back', () => {
    const TABLE: readonly { key: ProgressionKey; scale: readonly number[]; names: readonly string[] }[] = [
      {
        key: C_MAJOR,
        scale: IONIAN,
        names: [
          'C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°', 'Cmaj7', 'Dm7', 'G7', 'Am7', 'Bø7',
          'Bb', 'Ab', 'Eb', 'Db', 'Fm', 'F#m', 'D7', 'E7', 'A7', 'Gsus4', 'Csus2', 'G7sus4',
          'G9sus4', 'C6', 'Am6', 'Cadd9', 'Amadd9', 'C6/9', 'C9', 'G13', 'Dm11', 'Cmaj13',
          'G7b9', 'G7#9', 'Cmaj9#11', 'G13#11', 'F/A', 'C/E', 'C/G', 'G7/F', 'C+', 'C+7',
          'C+maj7', 'CmMaj7', 'B°7', 'Bb7/D', 'Ab/C'
        ]
      },
      { key: G_MAJOR, scale: IONIAN, names: ['G', 'Am', 'Bm', 'C', 'D7', 'Em', 'F#°', 'F', 'Bb', 'D/F#'] },
      { key: F_MAJOR, scale: IONIAN, names: ['F', 'Gm', 'Am', 'Bb', 'C7', 'Dm', 'E°', 'Eb', 'C/E', 'Bbmaj7'] },
      { key: E_FLAT_MAJOR, scale: IONIAN, names: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb7', 'Cm', 'D°', 'Db', 'Bb7/D'] },
      { key: A_MINOR, scale: AEOLIAN, names: ['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G', 'E7', 'Bø7', 'Am/C'] },
      { key: D_DORIAN, scale: DORIAN, names: ['Dm7', 'Em', 'F', 'G', 'Am', 'B°', 'C', 'Bb'] }
    ];

    for (const { key, scale, names } of TABLE) {
      for (const name of names) {
        it(`${name} in ${key.scaleId} on ${key.tonic}`, () => {
          expect(reprinted(name, key, scale)).toBe(name);
        });
      }
    }

    it('reads every alias to the canonical name', () => {
      const aliases: readonly [string, string][] = [
        ['Amin', 'Am'], ['A-', 'Am'], ['CM7', 'Cmaj7'], ['CΔ7', 'Cmaj7'], ['CΔ', 'Cmaj7'],
        ['CMaj7', 'Cmaj7'], ['Cmaj', 'C'], ['CM', 'C'], ['Cdim', 'C°'], ['Co', 'C°'],
        ['Caug', 'C+'], ['Bm7b5', 'Bø7'], ['Bø', 'Bø7'], ['C-7', 'Cm7'], ['Cmin7', 'Cm7'],
        ['Csus', 'Csus4'], ['Cadd2', 'Cadd9'], ['C7#5', 'C+7'], ['Caug7', 'C+7'],
        ['Cmaj7#5', 'C+maj7'], ['Cdim7', 'C°7'], ['Co7', 'C°7'], ['Cm(maj7)', 'CmMaj7'],
        ['CminMaj7', 'CmMaj7'], ['C69', 'C6/9'], ['C7#11', 'C9#11'], ['C7(b9)', 'C7b9'],
        ['C Maj', 'C'], ['Cmin6', 'Cm6'], ['C minadd9', 'Cmadd9'], ['C min6/9', 'Cm6/9']
      ];

      for (const [typed, canonical] of aliases) {
        expect(reprinted(typed, C_MAJOR, IONIAN)).withContext(typed).toBe(canonical);
      }
    });

    it('builds every catalogue symbol it reads on exactly the catalogue intervals', () => {
      const unbuildable = new Set(['7b5']);
      let read = 0;

      for (const category of CHORD_CATEGORIES) {
        for (const entry of category.chords) {
          const reading = chordFromText(`C${entry.symbol}`, C_MAJOR, IONIAN);
          if (unbuildable.has(entry.symbol)) {
            expect(reading.kind).withContext(entry.symbol).toBe('refused');
            continue;
          }

          const built = effectiveChord(IONIAN, degreeOf(reading));
          expect(built.intervals).withContext(entry.symbol).toEqual(entry.intervals);
          read++;
        }
      }

      // 38 entries, `7b5` refused: [0, 4, 6, 10] is no `QUALITY_INTERVALS` shape.
      expect(read).toBe(37);
    });

    it('reads every numeral it prints back as the same numeral', () => {
      const numerals: readonly string[] = [
        'I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°', 'Imaj7', 'ii7', 'V7', 'viiø7', '♭VII', '♭III',
        '♭VI', 'iv', 'II7', '♯iv°', '♯IV', 'V9', 'V7♭9', 'V7sus4', 'Isus2', 'I6', 'Iadd9', 'I6/9',
        'I+', 'vii°7'
      ];

      for (const numeral of numerals) {
        const read = degreeOf(chordFromText(numeral, C_MAJOR, IONIAN));
        expect(numeralOf(read, IONIAN)).withContext(numeral).toBe(numeral);
      }

      const minorMajor = degreeOf(chordFromText('i(maj7)', A_HARMONIC_MINOR, HARMONIC_MINOR));
      expect(numeralOf(minorMajor, HARMONIC_MINOR)).toBe('i(maj7)');
    });

    /**
     * Every chord the app's heptatonic scales build on their own degrees, in all
     * twelve keys, at every height and suspension: printed as a name and as a
     * numeral, and each read back.
     *
     * Three kinds of chord are held to a weaker promise, and all are counted so
     * the exemptions stay visible:
     *
     *  - **No name** (`?`). There is nothing to read back.
     *  - **One pitch class twice.** A suspension at a height doubles an
     *    extension's pitch class (a sus2 is the ninth an octave down), and so
     *    does a diminished seventh's thirteenth. The parse reads pitch classes,
     *    so it reads the shorter chord: the same notes, and the name may differ.
     *  - **A sus2 carrying a ♯9.** The ♯9 is the minor third's pitch class, and
     *    `parseChord` tries a third before a suspension (`OPENINGS`), so
     *    `Cmaj7#9sus2` reads as `CmMaj9`: the same notes, named the other way.
     *    Reachable only in the exotic scales whose own ninth sits a minor third
     *    up (ultra locrian's seventh degree, for one).
     *
     * Both of the last two are promised the same pitch classes, by name and by
     * numeral.
     */
    it('reads back every chord the app builds, by name and by numeral', () => {
      const scales = new MusicTheoryService()
        .getScaleCategories()
        .flatMap(category => category.scales)
        .filter(scale => isHeptatonic(scale.intervals));
      const extents: readonly ChordExtent[] = [3, 7, 9, 11, 13];
      const counts = { exact: 0, unnamed: 0, doubled: 0, sus2SharpNine: 0 };

      for (const scale of scales) {
        for (let tonic = 0; tonic < 12; tonic++) {
          const key: ProgressionKey = { tonic, scaleId: scale.id, preferSharps: scale.preferSharps };
          for (let degree = 0; degree < 7; degree++) {
            for (const extent of extents) {
              for (const suspension of SUSPENSIONS) {
                const shape = chord({ degree, extent, suspension });
                const built = effectiveChord(scale.intervals, shape);
                const name = leadSheetNameOf(shape, key, scale.intervals);
                const context = `${name} (${scale.id} on ${tonic})`;

                if (name.endsWith('?')) {
                  counts.unnamed++;
                  continue;
                }

                const byName = degreeOf(chordFromText(name, key, scale.intervals));
                const byNumeral = degreeOf(
                  chordFromText(numeralOf(shape, scale.intervals), key, scale.intervals)
                );
                const pitchClasses = new Set(built.intervals.map(interval => interval % 12));

                const doubled = pitchClasses.size < built.intervals.length;
                const sus2SharpNine = built.suspension === 'sus2' && built.ninth === 1;
                if (doubled || sus2SharpNine) {
                  if (doubled) counts.doubled++;
                  else counts.sus2SharpNine++;

                  const sounding = soundingOf(shape, key, scale.intervals);
                  expect(soundingOf(byName, key, scale.intervals)).withContext(context).toEqual(sounding);
                  expect(soundingOf(byNumeral, key, scale.intervals)).withContext(context).toEqual(sounding);
                  continue;
                }

                counts.exact++;
                expect(leadSheetNameOf(byName, key, scale.intervals)).withContext(context).toBe(name);
                expect(numeralOf(byNumeral, scale.intervals))
                  .withContext(context)
                  .toBe(numeralOf(shape, scale.intervals));
              }
            }
          }
        }
      }

      // Pinned rather than bounded, so a scale added to the app or a change to
      // the parse moves a number here and says which exemption it moved.
      // 41,580 chords: 33 scales, 12 keys, 7 degrees, 5 heights, 3 suspensions.
      expect(counts).toEqual({ exact: 22176, unnamed: 13656, doubled: 5280, sus2SharpNine: 468 });
    });
  });
});

/** The pitch classes a degree sounds in a key, sorted, for comparing two readings. */
function soundingOf(degree: ChordDegree, key: ProgressionKey, scale: readonly number[]): number[] {
  const built = effectiveChord(scale, degree);
  const classes = new Set(built.intervals.map(interval => (key.tonic + built.root + interval) % 12));
  return [...classes].sort((left, right) => left - right);
}
