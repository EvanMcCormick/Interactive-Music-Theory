import { TestBed } from '@angular/core/testing';

import { ALTER_MAX, ALTER_MIN, createExtensions } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { chordRootPitchClass } from './progression-generate';
import { romanNumeral } from './progression-chord-names';
import {
  ChordExtent,
  NAMED_QUALITIES,
  NamedQuality,
  degreeQuality,
  isHeptatonic
} from './progression-harmony';
import { ProgressionKeyContext } from './progression-key-context';
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
 * `MusicTheoryService` is injected for the scale table, which is what the
 * borrowed group's two source modes are checked against - so the copy of
 * aeolian and phrygian this module keeps cannot drift from the app's. It used
 * to be injected for `spellNote` as well; a root is now spelled by its degree's
 * letter, which needs no service at all.
 */
describe('chordVocabulary', () => {
  let service: MusicTheoryService;

  /**
   * The key-to-scale knowledge, constructed rather than injected.
   *
   * It is what `ProgressionService` builds its keys through, so the spelling
   * sweep below builds them the same way - and it takes its service as a
   * constructor argument precisely so a spec can stand one up.
   */
  let keys: ProgressionKeyContext;

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
    keys = new ProgressionKeyContext(service);
  });

  /** A selected slot on `degree`, which is all the alternates group reads. */
  function selection(degree: number, alter = 0, quality: NamedQuality | null = null): ChordDegree {
    return {
      degree,
      alter,
      extent: 3,
      quality,
      inversion: 0,
      suspension: 'none',
      extensions: createExtensions(),
      octave: 0
    };
  }

  function numerals(options: readonly ChordOption[]): string[] {
    return options.map(option => option.numeral);
  }

  function names(options: readonly ChordOption[]): string[] {
    return options.map(option => option.name);
  }

  /**
   * The one option with this numeral, or a failure that says what was there.
   *
   * `find` returns `undefined` and a `!` on the result turns a missing option
   * into "cannot read property of undefined" three lines later, naming neither
   * the numeral that went missing nor the row it went missing from.
   */
  function withNumeral(options: readonly ChordOption[], numeral: string): ChordOption {
    const found = options.find(option => option.numeral === numeral);
    if (found === undefined) {
      throw new Error(`no ${numeral} among [${numerals(options).join(', ')}]`);
    }
    return found;
  }

  /**
   * Every seven-note scale the app offers, which is what the sweeps walk.
   *
   * The **id** comes with the name because a key carries one and
   * `ProgressionKeyContext.spellingFor` reads it - the spelling sweep below
   * builds each key the way `setKey` does, and a key built with a made-up id
   * would have no signature and would test the fallback instead of the rule.
   */
  function heptatonicScales(): { id: string; name: string; intervals: readonly number[] }[] {
    const found: { id: string; name: string; intervals: readonly number[] }[] = [];
    for (const category of service.getScaleCategories()) {
      for (const scale of category.scales) {
        if (isHeptatonic(scale.intervals)) {
          found.push({ id: scale.id, name: scale.name, intervals: scale.intervals });
        }
      }
    }
    return found;
  }

  /**
   * Every selection a slot can carry: seven degrees times five accidentals.
   *
   * The alternates row is the only group that reads the selection, and it is
   * also the only group whose degree and accidental come from *outside* this
   * module - so a sweep anchored on one selection tests the borrowed and
   * secondary rules thoroughly and the alternates rule on a thirty-fifth of its
   * input. `ALTER_MIN`..`ALTER_MAX` is the whole range `normalizeChordDegree`
   * lets into a slot, so this is every selection the app can reach.
   */
  function everySelection(): ChordDegree[] {
    const selections: ChordDegree[] = [];
    for (let degree = 0; degree <= 6; degree++) {
      for (let alter = ALTER_MIN; alter <= ALTER_MAX; alter++) {
        // A chromatic root needs a shape to build from; `major` is the one every
        // reachable slot could carry, and the alternates row overrides it
        // sixteen ways regardless.
        selections.push(selection(degree, alter, alter === 0 ? null : 'major'));
      }
    }
    return selections;
  }

  function everyOption(
    intervals: readonly number[],
    key: ProgressionKey,
    selected: ChordDegree
  ): ChordOption[] {
    const vocabulary = chordVocabulary(key, intervals, selected);
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
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null);

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
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null);
      const flatSeven = withNumeral(borrowed, '♭VII');

      expect(flatSeven.degree).toBe(6);
      expect(flatSeven.alter).toBe(-1);
      expect(flatSeven.quality).toBe('major');
      expect(flatSeven.group).toBe('borrowed');
    });

    /**
     * A minor key borrows the Neapolitan and harmonic minor's two, and nothing
     * else - because it has the rest already.
     *
     * ♭III, ♭VI, ♭VII and iv *are* the chords of a natural minor key, so
     * offering them as borrowings would be offering the key its own diatonic
     * row a second time, with an accidental on a degree that is already flat.
     *
     * The two that are left are the ones minor-key harmony is actually built
     * on. `V` is the major dominant - C aeolian's own fifth degree is `v`, a G
     * minor triad, and nothing on the diatonic row is a G7 - and `♯vii°` is the
     * leading-tone triad that a raised seventh produces. Both come from the
     * parallel harmonic minor, and neither is reachable through the alternates
     * row, which can only re-shape a slot that already exists.
     */
    it('offers a minor key the Neapolitan and harmonic minor’s dominant pair', () => {
      const { borrowed } = chordVocabulary(C_MINOR, AEOLIAN, null);

      expect(numerals(borrowed)).toEqual(['♭II', 'V', '♯vii°']);
      expect(names(borrowed)).toEqual(['Db Maj', 'G Maj', 'B°']);
    });

    /**
     * The Picardy third is not among them, and that is a decision.
     *
     * It sits on the tonic, which is a root the key already has - so it is an
     * alternate, and the alternates row's limit (it can only re-shape a slot
     * that exists and is selected) does not bite on the one slot a Picardy third
     * is by definition applied to. See `BORROWINGS` for the argument in full;
     * this pins the behaviour so that adding it later is a deliberate change
     * rather than a silent one.
     */
    it('leaves the Picardy third to the alternates row', () => {
      const { borrowed, alternates } = chordVocabulary(C_MINOR, AEOLIAN, selection(0));

      expect(numerals(borrowed)).not.toContain('I');
      expect(numerals(alternates)).toContain('I');
      expect(withNumeral(alternates, 'I').name).toBe('C Maj');
    });

    /**
     * The filter is a comparison against the key, not a list of minor modes.
     *
     * Dorian's own fourth is major, so minor iv is a genuine borrowing there
     * while ♭III and ♭VII are not - dorian already has both. Its fifth degree is
     * minor and its seventh flat, so it takes harmonic minor's `V` and `♯vii°`
     * on the same terms a natural minor key does.
     */
    it('borrows into dorian what dorian does not already have', () => {
      const dorian = [0, 2, 3, 5, 7, 9, 10];
      const { borrowed } = chordVocabulary(
        { tonic: 0, scaleId: 'dorian', preferSharps: false },
        dorian,
        null,
      );

      expect(numerals(borrowed)).toEqual(['♭II', 'iv', 'V', '♭VI', '♯vii°']);
    });

    /**
     * A major key's row does not move by a single button.
     *
     * Harmonic minor's degree 4 is a major triad and ionian's already is; its
     * degree 6 is diminished and ionian's already is. Both are dropped by the
     * "the key already has it" filter, so the two rows added for minor keys are
     * invisible in a major one. Pinned because it is the property that made the
     * addition safe.
     */
    it('adds nothing to a major key', () => {
      const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null);

      expect(numerals(borrowed)).toEqual(['♭II', '♭III', 'iv', '♭VI', '♭VII']);
    });

    /**
     * No borrowed chord is one the key already gives, in any seven-note scale.
     *
     * The claim the group's name makes, swept rather than sampled: if a chord
     * with this root and this shape is already on the diatonic row, offering it
     * under "Borrowed" is a false label.
     *
     * Checked against **the whole diatonic row by pitch class**, not against the
     * implementation's own filter. That filter compares an option with the
     * chord on its own degree index and only when `alter` is zero, so restating
     * it here would be a test that cannot fail for its stated reason - it would
     * pass against any implementation that used the same rule, right or wrong.
     * Rooting both sides through `chordRootPitchClass` also catches the case the
     * index comparison would miss: a displaced root landing on some *other*
     * degree's chord.
     */
    it('never offers a chord the key already has', () => {
      for (const scale of heptatonicScales()) {
        const { borrowed } = chordVocabulary(C_MAJOR, scale.intervals, null);

        const diatonic = new Set<string>();
        for (let degree = 0; degree <= 6; degree++) {
          const root = chordRootPitchClass(C_MAJOR, scale.intervals, selection(degree));
          diatonic.add(`${root}:${degreeQuality(scale.intervals, degree, 3)}`);
        }

        for (const option of borrowed) {
          const root = chordRootPitchClass(
            C_MAJOR,
            scale.intervals,
            selection(option.degree, option.alter, option.quality)
          );

          expect(diatonic.has(`${root}:${option.quality}`))
            .withContext(`${scale.name} already has ${option.numeral} (${option.name})`)
            .toBeFalse();
        }
      }
    });

    /**
     * The three source modes are the app's own, checked against its table.
     *
     * They are written out in `progression-vocabulary.ts` because that module
     * is pure and must not reach into an Angular service for reference data.
     * This is what stops the copy drifting: the borrowed group is derived from
     * these intervals, so a change to any of the three here changes every
     * borrowed chord the palette offers.
     */
    it('borrows from the app’s own aeolian, phrygian and harmonic minor', () => {
      const byId = (id: string): readonly number[] => {
        for (const category of service.getScaleCategories()) {
          const scale = category.scales.find(candidate => candidate.id === id);
          if (scale) return scale.intervals;
        }
        throw new Error(`no scale ${id}`);
      };

      const rootOf = (option: ChordOption, key: ProgressionKey, intervals: readonly number[]) =>
        chordRootPitchClass(key, intervals, selection(option.degree, option.alter, option.quality));

      // C aeolian gives E♭, Fm, A♭ and B♭; C phrygian gives the D♭.
      const major = chordVocabulary(C_MAJOR, IONIAN, null).borrowed;
      const roots = major.map(option => rootOf(option, C_MAJOR, IONIAN));

      expect(roots.slice(1)).toEqual([byId('aeolian')[2], byId('aeolian')[3], byId('aeolian')[5], byId('aeolian')[6]]);
      expect(roots[0]).toBe(byId('phrygian')[1]);

      // C harmonic minor gives the G and the B - its fifth degree and its
      // raised seventh, which is the whole reason it is a source at all.
      const minor = chordVocabulary(C_MINOR, AEOLIAN, null).borrowed;
      const harmonic = byId('harmonicMinor');

      expect(rootOf(withNumeral(minor, 'V'), C_MINOR, AEOLIAN)).toBe(harmonic[4]);
      expect(rootOf(withNumeral(minor, '♯vii°'), C_MINOR, AEOLIAN)).toBe(harmonic[6]);
    });

    /**
     * Two rows of `BORROWINGS` can share a degree, so no two may share a label.
     *
     * Lydian takes ♭VII from aeolian and vii° from harmonic minor, both on
     * degree 6, and they are different chords on different roots. A duplicate
     * numeral would be two buttons a user cannot tell apart.
     */
    it('never offers two borrowed chords with the same numeral', () => {
      for (const scale of heptatonicScales()) {
        const { borrowed } = chordVocabulary(C_MAJOR, scale.intervals, null);

        expect(new Set(numerals(borrowed)).size)
          .withContext(`${scale.name}: ${numerals(borrowed).join(' ')}`)
          .toBe(borrowed.length);
      }
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
      const { secondary } = chordVocabulary(C_MAJOR, IONIAN, null);

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
      const { secondary } = chordVocabulary(C_MINOR, AEOLIAN, null);

      expect(numerals(secondary)).toEqual(['V/III', 'V/iv', 'V/v', 'V/VI', 'V/VII']);
      expect(names(secondary)).toEqual(['Bb7', 'C7', 'D7', 'Eb7', 'F7']);
    });

    /** Every one of them is stored as a dominant seventh, which is the rule. */
    it('stores every secondary as a dominant seventh', () => {
      const { secondary } = chordVocabulary(C_MAJOR, IONIAN, null);

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
        const { secondary } = chordVocabulary(C_MAJOR, scale.intervals, null);

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

    /**
     * And the other half of that rule: a degree no key could be in is not
     * tonicised, in any seven-note scale.
     *
     * The sweep above only ever asserts that something *is* offered, so dropping
     * the quality filter altogether would leave it green - and the palette would
     * grow a `V/vii°` and a `V/III+` that point at chords no music is ever in.
     * The target is read off the numeral rather than off the root, because two
     * degrees a fifth apart can share a dominant's pitch class while only one of
     * them is a legal target.
     */
    it('tonicises no diminished or augmented degree', () => {
      for (const scale of heptatonicScales()) {
        const { secondary } = chordVocabulary(C_MAJOR, scale.intervals, null);

        for (let degree = 0; degree < 7; degree++) {
          const quality = degreeQuality(scale.intervals, degree, 3);
          if (quality === 'major' || quality === 'minor') continue;

          const target = romanNumeral(degree, 0, quality);

          expect(secondary.some(option => option.numeral.endsWith(`/${target}`)))
            .withContext(`${scale.name} tonicises ${target}, which is ${quality}`)
            .toBeFalse();
        }
      }
    });

    /**
     * The numeral on the left of the slash is a plain `V`, never an altered one.
     *
     * It is measured against the *target*, and a secondary dominant's root is a
     * perfect fifth above its target by construction, so relative to that target
     * there is nothing to alter. The chord's displacement within the key is a
     * different measurement: pass it here and admitting a diminished target to C
     * major would print `♯V/vii°` for what is simply `V/vii°`. Every target the
     * filter admits today has `alter` zero, so this cannot fail now - it is here
     * so that widening the filter fails loudly rather than quietly relabelling.
     */
    it('never puts an accidental on the left of the slash', () => {
      for (const scale of heptatonicScales()) {
        const { secondary } = chordVocabulary(C_MAJOR, scale.intervals, null);

        for (const option of secondary) {
          expect(option.numeral)
            .withContext(`${scale.name} ${option.name}`)
            .toMatch(/^V\//);
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
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(0));

      expect(alternates.length).toBe(NAMED_QUALITIES.length);
      expect(alternates.map(option => option.quality)).toEqual([...NAMED_QUALITIES]);
      expect(names(alternates)).toEqual([
        'C Maj', 'C min', 'C°', 'C+',
        'C Maj7', 'C7', 'C min7', 'C minMaj7',
        'Cø7', 'C°7', 'C+7', 'C+Maj7',
        // The four added-tone shapes M3 Task 4 put in `QUALITY_INTERVALS`.
        // `C6` closes up and `C add9` takes a space, which is `chordName`'s
        // separator rule reading the first character of the suffix.
        'C6', 'C min6', 'C add9', 'C minadd9'
      ]);
      expect(numerals(alternates)).toEqual([
        'I', 'i', 'i°', 'I+',
        'Imaj7', 'I7', 'i7', 'i(maj7)',
        'iø7', 'i°7', 'I+7', 'I+maj7',
        // Case carries the third here as everywhere else, so the sixth and the
        // added ninth each take an upper- and a lower-case numeral.
        'I6', 'i6', 'Iadd9', 'iadd9'
      ]);
    });

    /**
     * A seventh is offered at a seventh's height and a triad at a triad's,
     * whatever height the slot is at.
     *
     * "Turns V into V7" is a change of height as much as of shape, and the
     * alternative - offering every quality at the slot's own extent - prints
     * duplicate buttons the moment the slot is a triad, which every fresh slot
     * is: a seventh override at extent 3 is cut back to its own triad, so
     * `major`, `major7` and `dominant7` would be three buttons building one
     * chord. The test below pins that, and `progression-vocabulary.ts` gives the
     * counts.
     */
    it('offers each quality at its own height', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(4));
      const heights = new Map<NamedQuality, ChordExtent>(
        alternates.map(option => [option.quality, option.extent])
      );

      expect(heights.get('major')).toBe(3);
      expect(heights.get('dominant7')).toBe(7);
      expect(names(alternates)).toContain('G7');
    });

    /** They follow the selected chord's own root, accidental and all. */
    it('follows a borrowed slot onto its chromatic root', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(6, -1, 'major'));

      expect(numerals(alternates).slice(0, 4)).toEqual(['♭VII', '♭vii', '♭vii°', '♭VII+']);
      expect(names(alternates).slice(0, 4)).toEqual(['Bb Maj', 'Bb min', 'Bb°', 'Bb+']);
    });

    /** With nothing selected there is no root to offer alternates on. */
    it('offers none when nothing is selected', () => {
      const vocabulary = chordVocabulary(C_MAJOR, IONIAN, null);

      expect(vocabulary.alternates).toEqual([]);
      expect(vocabulary.borrowed.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Which option the slot already holds
  // -------------------------------------------------------------------------

  describe('the current option', () => {
    /**
     * The commonest case of all, and the one a naive comparison gets wrong.
     *
     * A slot the user has not altered carries `quality: null`, so matching an
     * option against the stored field marks nothing on the row a user first
     * opens - even though one of the twelve buttons builds exactly the chord
     * that is sounding. It is resolved through the key instead: a plain V slot
     * at a triad's height is a G major triad, and `major` is the button.
     */
    it('marks the key’s own quality for a slot with no override', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(4));

      expect(alternates.filter(option => option.current).map(option => option.quality))
        .toEqual(['major']);
    });

    /**
     * And it follows the slot's height, because that is what decides the chord.
     *
     * The same degree at a seventh is a G7, so the marked button moves with the
     * extent rather than staying on the triad. Resolving at each *option's* own
     * height instead would mark `major` and `dominant7` both, which is two marks
     * for one chord.
     */
    it('follows the slot’s height when the key supplies the quality', () => {
      const seventh: ChordDegree = { ...selection(4), extent: 7 };
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, seventh);

      expect(alternates.filter(option => option.current).map(option => option.quality))
        .toEqual(['dominant7']);
    });

    /** An override is its own answer, and marks the button that names it. */
    it('marks the override a slot carries', () => {
      const { alternates } = chordVocabulary(C_MAJOR, IONIAN, selection(4, 0, 'minor'));

      expect(withNumeral(alternates, 'v').current).toBeTrue();
      expect(withNumeral(alternates, 'V').current).toBeFalse();
    });

    /**
     * A borrowed slot marks its own button in the borrowed row, and keeps it
     * marked when the complexity stepper raises the slot.
     *
     * A ♭VII raised to a seventh builds a B flat major *seventh*, so a
     * comparison against the built chord would un-mark the ♭VII button the
     * moment a user pressed `+`. The shape the slot holds has not changed, so
     * neither has the answer.
     */
    it('marks a borrowed slot’s own button at any height', () => {
      for (const extent of [3, 7, 9] as ChordExtent[]) {
        const slot: ChordDegree = { ...selection(6, -1, 'major'), extent };
        const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, slot);

        expect(withNumeral(borrowed, '♭VII').current)
          .withContext(`extent ${extent}`)
          .toBeTrue();
      }
    });

    /** With nothing selected there is nothing to mark, in any group. */
    it('marks nothing when nothing is selected', () => {
      const vocabulary = chordVocabulary(C_MAJOR, IONIAN, null);

      expect([...vocabulary.borrowed, ...vocabulary.secondary].some(option => option.current))
        .toBeFalse();
    });

    /**
     * At most one option **per row** is ever marked, over every scale and every
     * selection.
     *
     * A row draws one highlight, so two in one row would be a contradiction on
     * screen. Within a row the three fields compared - degree, accidental and
     * shape - are distinct, which is what makes this an invariant rather than an
     * accident of the current contents.
     */
    it('marks at most one option per row, in every scale and every selection', () => {
      for (const scale of heptatonicScales()) {
        for (const selected of everySelection()) {
          const vocabulary = chordVocabulary(C_MAJOR, scale.intervals, selected);
          const rows = [vocabulary.alternates, vocabulary.borrowed, vocabulary.secondary];

          for (const row of rows) {
            const marked = row.filter(option => option.current);

            expect(marked.length)
              .withContext(
                `${scale.name} degree ${selected.degree} alter ${selected.alter}: ` +
                  marked.map(option => option.numeral).join(', ')
              )
              .toBeLessThanOrEqual(1);
          }
        }
      }
    });

    /**
     * Two rows can mark the same chord, and that is the answer rather than a
     * leak.
     *
     * The alternates row offers every shape on the *selected* root, so a
     * slot that already holds a borrowed chord finds itself in both rows.
     * Lydian ♯2 borrows a ♭VI, and selecting it marks the borrowed button and
     * the alternates row's `major` together: one chord, two ways to reach it,
     * and clicking either does the same thing. Pinned so that a future "exactly
     * one" rule is a deliberate choice about the UI rather than a silent one.
     */
    it('marks a chord that is both a borrowing and an alternate in both rows', () => {
      const lydianSharp2 = [0, 3, 4, 6, 7, 9, 11];
      const key: ProgressionKey = { tonic: 0, scaleId: 'lydianSharp2', preferSharps: false };
      const { alternates, borrowed } = chordVocabulary(
        key,
        lydianSharp2,
        selection(5, -1, 'major'),
      );

      expect(withNumeral(borrowed, '♭VI').current).toBeTrue();
      expect(withNumeral(alternates, '♭VI').current).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // Spelling, refusals and the storable range
  // -------------------------------------------------------------------------

  /**
   * A displaced root keeps its degree's letter and takes the accidental that
   * lands it on the pitch - which in a diatonic mode is the numeral's own.
   *
   * C major's `preferSharps` is `true` - its signature is empty, so the ionian
   * scale's own default decides - and spelling by that preference would print
   * `A♯ Maj` under a button labelled `♭VII`. The seventh degree of C major is
   * written on a B, so the lowered one is a B flat, and the accidental in the
   * numeral and the accidental in the name come out the same because they are
   * the same accidental.
   *
   * The rule this replaced read the *sign* of the displacement instead, which
   * agrees here and in every diatonic mode and disagrees in 112 places
   * elsewhere. The letter sweep at the bottom of this file is the general
   * statement; this is the one a reader can check by eye.
   */
  it('spells a displaced root on its degree letter', () => {
    const { borrowed, secondary } = chordVocabulary(C_MAJOR, IONIAN, null);

    expect(names(borrowed)).toContain('Bb Maj');
    expect(names(borrowed)).not.toContain('A# Maj');
    // The secondary dominants are unaltered, so they take the key's spelling.
    expect(names(secondary)).toContain('D7');
  });

  /**
   * An undisplaced root is the key's own note, and in a diatonic mode its
   * degree letter is the letter the key signature already writes it on.
   *
   * C major is no test of this: every root it offers with `alter` at zero is a
   * white key, and sharps and flats spell those the same. B major's dominant is
   * F sharp and E flat major's subdominant is A flat, and the two would be
   * printed `Gb` and `G#` by anything that had stopped reading the key - which
   * is exactly what a degree letter counted from the tonic's own spelling
   * cannot do.
   */
  it('spells an unaltered root on its degree letter, which is the key\'s', () => {
    const bMajor: ProgressionKey = { tonic: 11, scaleId: 'ionian', preferSharps: true };
    const sharps = chordVocabulary(bMajor, IONIAN, selection(4));

    expect(names(sharps.alternates)[0]).toBe('F# Maj');
    expect(names(sharps.secondary)).toContain('C#7');

    const eFlatMajor: ProgressionKey = { tonic: 3, scaleId: 'ionian', preferSharps: false };
    const flats = chordVocabulary(eFlatMajor, IONIAN, selection(3));

    expect(names(flats.alternates)[0]).toBe('Ab Maj');
  });

  /** The spoken label says the accidental and the shape rather than printing them. */
  it('says a borrowed chord aloud rather than spelling its symbols', () => {
    const { borrowed } = chordVocabulary(C_MAJOR, IONIAN, null);

    expect(withNumeral(borrowed, '♭VII').spoken).toBe('B flat major');
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
      selection(0)
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
   *
   * Swept over every selection as well as every scale, because the alternates
   * row takes its degree and accidental from the selection: anchored on one
   * slot, this would cover a thirty-fifth of that group's input.
   */
  it('only offers chords the model can store', () => {
    for (const scale of heptatonicScales()) {
      for (const selected of everySelection()) {
        for (const option of everyOption(scale.intervals, C_MAJOR, selected)) {
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
   *
   * Swept over every selection for the same reason as the test above: a `?`
   * would appear on an *alternate*, whose root comes from the slot, so a sweep
   * that fixed the slot would be checking the two groups that cannot produce
   * one.
   */
  it('never offers an unnameable chord', () => {
    for (const scale of heptatonicScales()) {
      for (const selected of everySelection()) {
        for (const option of everyOption(scale.intervals, C_MAJOR, selected)) {
          expect(option.name)
            .withContext(`${scale.name} ${option.numeral}`)
            .not.toContain('?');
          expect(option.numeral)
            .withContext(`${scale.name} ${option.name}`)
            .not.toContain('?');
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Every option on the letter its numeral names
  // -------------------------------------------------------------------------

  /**
   * The 55 misspelt buttons the design doc counts, closed as a class rather
   * than as a list.
   *
   * A numeral names a *degree*, and a degree is written on the letter that many
   * steps above the tonic's whatever accidental it carries. So the assertion is
   * not "this button prints `Cb`" but "every button prints a letter its own
   * numeral could have named", which is the property the 55 broke and which no
   * sharp/flat preference could have restored: the two chromatic tables hold no
   * `C♭`, `F♭`, `B♯`, `E♯` or double accidental at all, so 35 flat-key
   * borrowings and 20 sharp-key ones came back on the letter next door.
   *
   * The key is built as `ProgressionService.setKey` builds one, through
   * `spellingFor`, because the tonic's own letter is where every other letter
   * is counted from - a sweep that guessed the preference would be testing a
   * key the app never puts a user in.
   */
  function letterOf(name: string): string {
    return name[0];
  }

  /** Letters in step order, so the index is the letter. */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  /** The seven diatonic modes, whose ids the spelling sweep needs. */
  const DIATONIC_MODES: readonly string[] = [
    'ionian',
    'dorian',
    'phrygian',
    'lydian',
    'mixolydian',
    'aeolian',
    'locrian'
  ];

  /** A key exactly as `setKey` would store it, signature and all. */
  function keyFor(tonic: number, scaleId: string): ProgressionKey {
    const scale = keys.findScale(scaleId);
    return {
      tonic,
      scaleId,
      preferSharps: keys.spellingFor(tonic, scaleId, scale, true)
    };
  }

  /** Every option of every group, in one key, with each degree selected once. */
  function everyOptionInKey(key: ProgressionKey, intervals: readonly number[]): ChordOption[] {
    const options: ChordOption[] = [];
    for (let degree = 0; degree <= 6; degree++) {
      options.push(...everyOption(intervals, key, selection(degree)));
    }
    return options;
  }

  /** The options whose printed root is not on the letter its numeral names. */
  function offLetter(key: ProgressionKey, intervals: readonly number[]): string[] {
    const tonicLetter = LETTERS.indexOf(letterOf(service.spellNote(key.tonic, key.preferSharps)));
    const wrong: string[] = [];

    for (const option of everyOptionInKey(key, intervals)) {
      const expected = LETTERS[(tonicLetter + option.degree) % 7];
      if (letterOf(option.name) !== expected) {
        wrong.push(`${key.scaleId} on ${key.tonic}: ${option.numeral} printed ${option.name}, wanted ${expected}`);
      }
    }

    return wrong;
  }

  it('names every option on the letter its numeral names', () => {
    const wrong: string[] = [];

    for (const mode of DIATONIC_MODES) {
      const scale = keys.findScale(mode);
      if (!scale) throw new Error(`no scale ${mode}`);

      for (let tonic = 0; tonic < 12; tonic++) {
        wrong.push(...offLetter(keyFor(tonic, mode), scale.intervals));
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * The whole reach of the fallback, across all 33 heptatonic scales in all
   * twelve keys: **sixteen buttons, on one root.**
   *
   * `spellAt` refuses past a double accidental and the caller falls back to
   * `spellPitchClass`, which spells by preference and so lands on a letter the
   * numeral did not name. That is the only way a button here can still be on
   * the wrong letter, and it is worth a number rather than a hand-wave.
   *
   * All sixteen are the **sixth degree of A♯ enigmatic**, which needs an F
   * triple sharp. Enigmatic is `[0, 1, 4, 6, 8, 10, 11]` and inherits no key
   * signature, so its own `preferSharps` decides and pitch class 10 is spelled
   * `A♯`; from an A the sixth degree is written on an F, and ten semitones above
   * A♯ is pitch class 8 - three semitones above F. There is nowhere further to
   * go, because a triple sharp is not notation. The sixteen are one root printed
   * sixteen times: the alternates row offers every shape on the selected chord,
   * so every quality repeats it.
   *
   * **It was twelve, and it moved at M3 Task 4** when `QUALITY_INTERVALS` gained
   * `major6`, `minor6`, `add9` and `minorAdd9`. The ruling this docstring asks
   * for is therefore the mildest one available: no new *root* falls back, the
   * one that already did is now printed on four more buttons, and the set is
   * still "the sixth degree of A♯ enigmatic" exactly as it was. The assertion
   * below that every entry starts `enigmatic on 10:` is what says so.
   *
   * **No borrowed or secondary option is ever affected, in any scale**, and no
   * diatonic mode is affected at all - the test above pins that half at zero.
   *
   * `TRIPLE_ACCIDENTAL_OPTIONS` is pinned rather than merely bounded so that a
   * new scale, a widened `ALTER_MIN`, or a change to a scale's `preferSharps`
   * cannot enlarge the set silently. If this number moves, the new members are
   * printed in the failure and each is a ruling to make, not a count to update.
   */
  const TRIPLE_ACCIDENTAL_OPTIONS = 16;

  it('falls back to the tables only past a double accidental', () => {
    const wrong: string[] = [];

    for (const scale of heptatonicScales()) {
      for (let tonic = 0; tonic < 12; tonic++) {
        wrong.push(...offLetter(keyFor(tonic, scale.id), scale.intervals));
      }
    }

    expect(wrong.length).withContext(wrong.join('\n')).toBe(TRIPLE_ACCIDENTAL_OPTIONS);
    expect(wrong.every(entry => entry.startsWith('enigmatic on 10:')))
      .withContext(wrong.join('\n'))
      .toBeTrue();
  });

  /** Each option knows which row it came from, so a click need not be told. */
  it('marks every option with its group', () => {
    const vocabulary = chordVocabulary(C_MAJOR, IONIAN, selection(0));

    expect(vocabulary.alternates.every(option => option.group === 'alternate')).toBeTrue();
    expect(vocabulary.borrowed.every(option => option.group === 'borrowed')).toBeTrue();
    expect(vocabulary.secondary.every(option => option.group === 'secondary')).toBeTrue();
  });
});
