import { TestBed } from '@angular/core/testing';

import { ALTER_MAX, ALTER_MIN } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { chordRootPitchClass } from './progression-generate';
import {
  ChordExtent,
  NAMED_QUALITIES,
  NamedQuality,
  degreeQuality,
  isHeptatonic
} from './progression-harmony';
import { ChordOption, chordVocabulary } from './progression-vocabulary';

/**
 * The three groups of chords the palette offers beyond the diatonic seven,
 * checked against the tables a theory text prints rather than against the
 * arithmetic that produced them.
 *
 * This is the teaching surface. A wrong numeral here does not merely look
 * wrong, it teaches something false - so the C major and C minor expectations
 * below are written out as whole rows, hand-verified, and the sweeps that
 * follow check that the *rules* behind them hold in every seven-note scale the
 * app offers rather than only in the two keys anyone would test by hand.
 *
 * `MusicTheoryService` is injected for two things and neither is convenience.
 * `spellNote` is the app's own spelling, so the names asserted here are the
 * names a user reads; and the scale table is what the borrowed group's two
 * source modes are checked against, so the copy of aeolian and phrygian this
 * module keeps cannot drift from the app's.
 */
describe('chordVocabulary', () => {
  let service: MusicTheoryService;

  /** The app's own spelling, so a name asserted here is a name on screen. */
  let spell: (pitchClass: number, preferSharps: boolean) => string;

  const IONIAN = [0, 2, 4, 5, 7, 9, 11];
  const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

  /** C major, as `createDefaultProgression` builds it - sharps and all. */
  const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };

  /** C natural minor, whose signature is three flats. */
  const C_MINOR: ProgressionKey = { tonic: 0, scaleId: 'aeolian', preferSharps: false };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MusicTheoryService);
    spell = (pitchClass, preferSharps) => service.spellNote(pitchClass, preferSharps);
  });

  /** A selected slot on `degree`, which is all the alternates group reads. */
  function selection(degree: number, alter = 0, quality: NamedQuality | null = null): ChordDegree {
    return { degree, alter, extent: 3, quality, inversion: 0, suspension: 'none', octave: 0 };
  }

  function numerals(options: readonly ChordOption[]): string[] {
    return options.map(option => option.numeral);
  }

  function names(options: readonly ChordOption[]): string[] {
    return options.map(option => option.name);
  }

  /** Every seven-note scale the app offers, which is what the sweeps walk. */
  function heptatonicScales(): { name: string; intervals: readonly number[] }[] {
    const found: { name: string; intervals: readonly number[] }[] = [];
    for (const category of service.getScaleCategories()) {
      for (const scale of category.scales) {
        if (isHeptatonic(scale.intervals)) found.push({ name: scale.name, intervals: scale.intervals });
      }
    }
    return found;
  }

  function everyOption(intervals: readonly number[], key: ProgressionKey): ChordOption[] {
    const vocabulary = chordVocabulary(key, intervals, selection(0), spell);
    return [...vocabulary.alternates, ...vocabulary.borrowed, ...vocabulary.secondary];
  }

  // -------------------------------------------------------------------------
  // Borrowed
  // -------------------------------------------------------------------------

  describe('borrowed chords', () => {
    /**
     * The five the design doc names, in C major, hand-checked.
     *
     * These are the chords of the parallel minor - C natural minor is
     * C D E♭ F G A♭ B♭, giving E♭, Fm, A♭ and B♭ - plus the Neapolitan, which
     * comes from the parallel phrygian's flattened second. Every one of them is
     * a row of the design doc's correction table, and every one of them came
     * out with the wrong *shape* while `alter` shifted the whole stack: B♭
     * diminished for ♭VII, A♭ minor for ♭VI.
     */
    it('offers the parallel minor and the Neapolitan in a major key', () => {
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null, spell);

      expect(numerals(borrowed)).toEqual(['♭II', '♭III', 'iv', '♭VI', '♭VII']);
      expect(names(borrowed)).toEqual(['Db Maj', 'Eb Maj', 'F min', 'Ab Maj', 'Bb Maj']);
    });

    /**
     * The stored triple behind each of those five, which is what a click
     * writes into the slot.
     *
     * The accidental displaces the root and the quality carries the shape, so
     * ♭VII is *degree 6, alter -1, quality major* - the exact triple the design
     * doc's correction gives - rather than the degree-6 stack shifted down.
     */
    it('spells a borrowed chord as a displaced root under an explicit shape', () => {
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null, spell);
      const flatSeven = borrowed.find(option => option.numeral === '♭VII');

      expect(flatSeven).toBeDefined();
      expect(flatSeven!.degree).toBe(6);
      expect(flatSeven!.alter).toBe(-1);
      expect(flatSeven!.quality).toBe('major');
      expect(flatSeven!.group).toBe('borrowed');
    });

    /**
     * A minor key has almost nothing to borrow, and that is the answer rather
     * than a gap.
     *
     * ♭III, ♭VI, ♭VII and iv *are* the chords of a natural minor key, so
     * offering them as borrowings would be offering the key its own diatonic
     * row a second time - and with an accidental on a degree that is already
     * flat. What a minor key really does borrow - the major V, the Picardy I,
     * the dorian IV - all sit on roots the key already has, which makes them
     * alternates rather than borrowings. The Neapolitan is the one chord left
     * with a root of its own.
     */
    it('offers a minor key only the chords it does not already have', () => {
      const { borrowed } = chordVocabulary(C_MINOR, AEOLIAN, null, spell);

      expect(numerals(borrowed)).toEqual(['♭II']);
      expect(names(borrowed)).toEqual(['Db Maj']);
    });

    /**
     * The filter is a comparison against the key, not a list of minor modes.
     *
     * Dorian's own fourth is major, so minor iv is a genuine borrowing there
     * while ♭III and ♭VII are not - dorian already has both.
     */
    it('borrows into dorian what dorian does not already have', () => {
      const dorian = [0, 2, 3, 5, 7, 9, 10];
      const { borrowed } = chordVocabulary(
        { tonic: 0, scaleId: 'dorian', preferSharps: false },
        dorian,
        null,
        spell
      );

      expect(numerals(borrowed)).toEqual(['♭II', 'iv', '♭VI']);
    });

    /**
     * No borrowed chord is one the key already gives, in any seven-note scale.
     *
     * The claim the group's name makes, swept rather than sampled: if a chord
     * with this root and this shape is already on the diatonic row, offering it
     * under "Borrowed" is a false label.
     */
    it('never offers a chord the key already has', () => {
      for (const scale of heptatonicScales()) {
        const { borrowed } = chordVocabulary(C_MAJOR, scale.intervals, null, spell);

        for (const option of borrowed) {
          const alreadyThere =
            option.alter === 0 &&
            degreeQuality(scale.intervals, option.degree, 3) === option.quality;

          expect(alreadyThere)
            .withContext(`${scale.name} already has ${option.numeral}`)
            .toBeFalse();
        }
      }
    });

    /**
     * The two source modes are the app's own, checked against its table.
     *
     * They are written out in `progression-vocabulary.ts` because that module
     * is pure and must not reach into an Angular service for reference data.
     * This is what stops the copy drifting: the borrowed group is derived from
     * these intervals, so a change to either mode here changes every borrowed
     * chord the palette offers.
     */
    it('borrows from the app’s own aeolian and phrygian', () => {
      const byId = (id: string): readonly number[] => {
        for (const category of service.getScaleCategories()) {
          const scale = category.scales.find(candidate => candidate.id === id);
          if (scale) return scale.intervals;
        }
        throw new Error(`no scale ${id}`);
      };

      // C aeolian gives E♭, Fm, A♭ and B♭; C phrygian gives the D♭.
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null, spell);
      const roots = borrowed.map(option =>
        chordRootPitchClass(C_MAJOR, IONIAN, selection(option.degree, option.alter, option.quality))
      );

      expect(roots.slice(1)).toEqual([byId('aeolian')[2], byId('aeolian')[3], byId('aeolian')[5], byId('aeolian')[6]]);
      expect(roots[0]).toBe(byId('phrygian')[1]);
    });
  });

  // -------------------------------------------------------------------------
  // Secondary dominants
  // -------------------------------------------------------------------------

  describe('secondary dominants', () => {
    /**
     * The five a major key has, hand-checked against the fifth above each
     * target: D7 to G, E7 to A, A7 to D, B7 to E, C7 to F.
     *
     * `vii°` is not among them, and that is the rule working rather than an
     * omission: a diminished triad is no key's tonic, so there is nothing to
     * tonicise. Nor is the tonic itself - the dominant of I is V, which the
     * diatonic row already offers.
     */
    it('offers a dominant seventh a fifth above every tonicisable degree', () => {
      const { secondary } = chordVocabulary(C_MAJOR, IONIAN, null, spell);

      expect(numerals(secondary)).toEqual(['V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi']);
      expect(names(secondary)).toEqual(['A7', 'B7', 'C7', 'D7', 'E7']);
    });

    /**
     * The same rule in a minor key names different targets, because the
     * numerals of a minor key are different.
     *
     * A7 in C minor would be the dominant of D, and D is the key's diminished
     * second - so it is not offered. What is offered tonicises E♭, F, G, A♭ and
     * B♭, which are the five triads of C natural minor that a key could be in.
     */
    it('names its targets with the key’s own numerals', () => {
      const { secondary } = chordVocabulary(C_MINOR, AEOLIAN, null, spell);

      expect(numerals(secondary)).toEqual(['V/III', 'V/iv', 'V/v', 'V/VI', 'V/VII']);
      expect(names(secondary)).toEqual(['Bb7', 'C7', 'D7', 'Eb7', 'F7']);
    });

    /** Every one of them is stored as a dominant seventh, which is the rule. */
    it('stores every secondary as a dominant seventh', () => {
      const { secondary } = chordVocabulary(C_MAJOR, IONIAN, null, spell);

      for (const option of secondary) {
        expect(option.quality).withContext(option.numeral).toBe('dominant7');
        expect(option.extent).withContext(option.numeral).toBe(7);
        expect(option.group).toBe('secondary');
      }
    });

    /**
     * The rule itself, swept: the root is seven semitones above the target's
     * root, in every seven-note scale the app has.
     *
     * This is the claim that makes the group a rule rather than a table. It is
     * checked against the target's own root rather than against a list of
     * expected pitch classes, so a scale nobody thought to test still has to
     * satisfy it.
     */
    it('roots every secondary a perfect fifth above its target', () => {
      for (const scale of heptatonicScales()) {
        const { secondary } = chordVocabulary(C_MAJOR, scale.intervals, null, spell);

        // Every one of them names the degree it tonicises.
        for (const option of secondary) {
          expect(option.numeral).withContext(scale.name).toContain('/');
        }

        for (let degree = 0; degree < 7; degree++) {
          const quality = degreeQuality(scale.intervals, degree, 3);
          const tonicisable = degree !== 0 && (quality === 'major' || quality === 'minor');
          const root = (scale.intervals[degree] + 7) % 12;
          const offered = secondary.some(
            option =>
              chordRootPitchClass(
                C_MAJOR,
                scale.intervals,
                selection(option.degree, option.alter, option.quality)
              ) === root
          );

          if (tonicisable) {
            expect(offered)
              .withContext(`${scale.name} degree ${degree} has no secondary dominant`)
              .toBeTrue();
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Alternates
  // -------------------------------------------------------------------------

  describe('alternates', () => {
    /**
     * Every named quality on the selected chord's own root, which is the row
     * Captain Chords shows - and the one that turns V into V7.
     */
    it('offers every named quality on the selected root', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(0), spell);

      expect(alternates.length).toBe(NAMED_QUALITIES.length);
      expect(alternates.map(option => option.quality)).toEqual([...NAMED_QUALITIES]);
      expect(names(alternates)).toEqual([
        'C Maj', 'C min', 'C°', 'C+',
        'C Maj7', 'C7', 'C min7', 'C minMaj7',
        'Cø7', 'C°7', 'C+7', 'C+Maj7'
      ]);
      expect(numerals(alternates)).toEqual([
        'I', 'i', 'i°', 'I+',
        'Imaj7', 'I7', 'i7', 'i(maj7)',
        'iø7', 'i°7', 'I+7', 'I+maj7'
      ]);
    });

    /**
     * A seventh is offered at a seventh's height and a triad at a triad's,
     * whatever height the slot is at.
     *
     * "Turns V into V7" is a change of height as much as of shape, and the
     * alternative - offering every quality at the slot's own extent - prints
     * two buttons with the same name the moment the slot is a ninth, because a
     * `major` and a `major7` override build the same stack there.
     */
    it('offers each quality at its own height', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(4), spell);
      const heights = new Map<NamedQuality, ChordExtent>(
        alternates.map(option => [option.quality, option.extent])
      );

      expect(heights.get('major')).toBe(3);
      expect(heights.get('dominant7')).toBe(7);
      expect(names(alternates)).toContain('G7');
    });

    /** They follow the selected chord's own root, accidental and all. */
    it('follows a borrowed slot onto its chromatic root', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(6, -1, 'major'), spell);

      expect(numerals(alternates).slice(0, 4)).toEqual(['♭VII', '♭vii', '♭vii°', '♭VII+']);
      expect(names(alternates).slice(0, 4)).toEqual(['Bb Maj', 'Bb min', 'Bb°', 'Bb+']);
    });

    /** With nothing selected there is no root to offer alternates on. */
    it('offers none when nothing is selected', () => {
      const vocabulary = chordVocabulary(C_MAJOR, IONIAN, null, spell);

      expect(vocabulary.alternates).toEqual([]);
      expect(vocabulary.borrowed.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Spelling, refusals and the storable range
  // -------------------------------------------------------------------------

  /**
   * A lowered root is spelled flat and a raised one sharp, whatever the key
   * prefers.
   *
   * C major's `preferSharps` is `true` - its signature is empty, so the ionian
   * scale's own default decides - and following it here would print `A♯ Maj`
   * under a button labelled `♭VII`. The accidental in the numeral and the
   * accidental in the name are the same accidental, so the displacement decides
   * both. An undisplaced root has no opinion of its own and follows the key,
   * which is what every other label on this page does.
   */
  it('spells a displaced root in the direction it was displaced', () => {
    const { borrowed, secondary } = chordVocabulary(C_MAJOR, IONIAN, null, spell);

    expect(names(borrowed)).toContain('Bb Maj');
    expect(names(borrowed)).not.toContain('A# Maj');
    // The secondary dominants are unaltered, so they take the key's spelling.
    expect(names(secondary)).toContain('D7');
  });

  /**
   * An undisplaced root has no accidental of its own, so it follows the key -
   * and the key is the *progression's*, either way it leans.
   *
   * C major is no test of this: every root it offers with `alter` at zero is a
   * white key, and sharps and flats spell those the same. B major's dominant is
   * F sharp and E flat major's subdominant is A flat, and the two would be
   * printed `Gb` and `G#` by a rule that had stopped reading the key.
   */
  it('spells an unaltered root the way the key does', () => {
    const bMajor: ProgressionKey = { tonic: 11, scaleId: 'ionian', preferSharps: true };
    const sharps = chordVocabulary(bMajor, IONIAN, selection(4), spell);

    expect(names(sharps.alternates)[0]).toBe('F# Maj');
    expect(names(sharps.secondary)).toContain('C#7');

    const eFlatMajor: ProgressionKey = { tonic: 3, scaleId: 'ionian', preferSharps: false };
    const flats = chordVocabulary(eFlatMajor, IONIAN, selection(3), spell);

    expect(names(flats.alternates)[0]).toBe('Ab Maj');
  });

  /** The spoken label says the accidental and the shape rather than printing them. */
  it('says a borrowed chord aloud rather than spelling its symbols', () => {
    const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null, spell);
    const flatSeven = borrowed.find(option => option.numeral === '♭VII');

    expect(flatSeven!.spoken).toBe('B flat major');
  });

  /**
   * A scale that cannot stack thirds has no chords at all, so it has no
   * alternates, borrowings or secondaries either.
   *
   * Returned empty rather than thrown, on the same argument `isHeptatonic` is
   * exported for: this is a menu, and an empty menu is the honest answer for a
   * key with nothing on it. `ProgressionState.canBuildChords` is the same check
   * already applied, so the palette refuses the whole panel before it gets
   * here - and a caller that does not check gets nothing rather than an
   * exception three layers down.
   */
  it('offers nothing in a scale that cannot stack thirds', () => {
    const vocabulary = chordVocabulary(
      { tonic: 0, scaleId: 'majorPentatonic', preferSharps: true },
      MAJOR_PENTATONIC,
      selection(0),
      spell
    );

    expect(vocabulary.alternates).toEqual([]);
    expect(vocabulary.borrowed).toEqual([]);
    expect(vocabulary.secondary).toEqual([]);
  });

  /**
   * Every option is storable, in every seven-note scale the app offers.
   *
   * An option outside `ALTER_MIN`..`ALTER_MAX` would be clamped by
   * `normalizeChordDegree` on its way into a slot, so the chord that sounded
   * would not be the chord the button named - the one failure this whole module
   * exists to prevent, arriving through the back door.
   */
  it('only offers chords the model can store', () => {
    for (const scale of heptatonicScales()) {
      for (const option of everyOption(scale.intervals, C_MAJOR)) {
        expect(option.alter)
          .withContext(`${scale.name} ${option.numeral}`)
          .toBeGreaterThanOrEqual(ALTER_MIN);
        expect(option.alter)
          .withContext(`${scale.name} ${option.numeral}`)
          .toBeLessThanOrEqual(ALTER_MAX);
        expect(Number.isInteger(option.degree) && option.degree >= 0 && option.degree <= 6)
          .withContext(`${scale.name} ${option.numeral} has degree ${option.degree}`)
          .toBeTrue();
      }
    }
  });

  /**
   * No option is ever unlabelled, in any seven-note scale.
   *
   * Every option is offered at the height its own quality names, and at that
   * height the built stack always reads back as the override - so the `?` that
   * marks a stack with no name cannot appear on a button here. That is what
   * offering `major7` at a seventh rather than at the slot's own extent buys:
   * an option that names what it builds, everywhere.
   */
  it('never offers an unnameable chord', () => {
    for (const scale of heptatonicScales()) {
      for (const option of everyOption(scale.intervals, C_MAJOR)) {
        expect(option.name)
          .withContext(`${scale.name} ${option.numeral}`)
          .not.toContain('?');
        expect(option.numeral)
          .withContext(`${scale.name} ${option.name}`)
          .not.toContain('?');
      }
    }
  });

  /** Each option knows which row it came from, so a click need not be told. */
  it('marks every option with its group', () => {
    const vocabulary = chordVocabulary(C_MAJOR, IONIAN, selection(0), spell);

    expect(vocabulary.alternates.every(option => option.group === 'alternate')).toBeTrue();
    expect(vocabulary.borrowed.every(option => option.group === 'borrowed')).toBeTrue();
    expect(vocabulary.secondary.every(option => option.group === 'secondary')).toBeTrue();
  });
});
