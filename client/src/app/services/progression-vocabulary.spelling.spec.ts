import { TestBed } from '@angular/core/testing';

import { ALTER_MAX, ALTER_MIN, createExtensions } from '../models/progression-normalize';
import { ChordDegree, ProgressionKey } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import { chordRootPitchClass } from './progression-generate';
import { NAMED_QUALITIES, NamedQuality, isHeptatonic } from './progression-harmony';
import { ProgressionKeyContext } from './progression-key-context';
import { ChordOption, ChordOptionGroup, chordVocabulary } from './progression-vocabulary';

/**
 * How the palette spells the roots it offers: on the letter its own numeral
 * names, and where that is impossible, on whatever the chromatic tables have.
 *
 * Split out of `progression-vocabulary.spec.ts` when that file reached the
 * 1000-line cap, along the seam it already had - the row describes stayed, the
 * spelling section came here. The precedent is
 * `score-doc-mapper.ghost-voice.spec.ts`: a second spec file for one module,
 * named for the question it answers, with its own local fixtures rather than a
 * shared helper module for two callers.
 *
 * The two files ask different kinds of question and that is why the seam is
 * here rather than anywhere else. Over there the subject is *which* triples the
 * palette offers - a borrowing that the key already has is a false label, a
 * secondary dominant on a diminished target points at a key no music is in.
 * Here every one of those triples is taken as given and the only question is
 * what text goes on the button.
 */
describe('chordVocabulary spelling', () => {
  let service: MusicTheoryService;

  /**
   * The key-to-scale knowledge, constructed rather than injected.
   *
   * It is what `ProgressionService` builds its keys through, so the sweeps
   * below build them the same way - and it takes its service as a constructor
   * argument precisely so a spec can stand one up.
   */
  let keys: ProgressionKeyContext;

  const IONIAN = [0, 2, 4, 5, 7, 9, 11];

  /** C major, as `createDefaultProgression` builds it - sharps and all. */
  const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };

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

  function names(options: readonly ChordOption[]): string[] {
    return options.map(option => option.name);
  }

  /** The one option with this numeral, or a failure that says what was there. */
  function withNumeral(options: readonly ChordOption[], numeral: string): ChordOption {
    const found = options.find(option => option.numeral === numeral);
    if (found === undefined) {
      throw new Error(`no ${numeral} among [${options.map(o => o.numeral).join(', ')}]`);
    }
    return found;
  }

  /**
   * Every seven-note scale the app offers, which is what the sweeps walk.
   *
   * The **id** comes with the name because a key carries one and
   * `ProgressionKeyContext.spellingFor` reads it - the sweeps build each key the
   * way `setKey` does, and a key built with a made-up id would have no signature
   * and would test the fallback instead of the rule.
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

  function everyOption(
    intervals: readonly number[],
    key: ProgressionKey,
    selected: ChordDegree
  ): ChordOption[] {
    const vocabulary = chordVocabulary(key, intervals, selected);
    return [...vocabulary.alternates, ...vocabulary.borrowed, ...vocabulary.secondary];
  }

  // -------------------------------------------------------------------------
  // The rule, on cases a reader can check by eye
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
   * elsewhere. The letter sweeps below are the general statement; this is the
   * one a reader can check by eye.
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

  /**
   * What each of those letters sounds, naturally: C D E F G A B.
   *
   * Written out here rather than imported from `staff-pitch.ts`, for the reason
   * the borrowed sweep next door recomputes the diatonic row rather than
   * restating the implementation's filter - a check that reads its expectation
   * off the module under test passes against any implementation that shares its
   * mistake. Seven numbers off a piano keyboard are cheap to verify by eye.
   */
  const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

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

  /**
   * The accidental a letter needs in order to sound this pitch class, -6..5.
   *
   * The nearer of the letter's two distances, which is what makes B to C an
   * ascent of one rather than a descent of eleven: `C♭` and `B♯` sit on opposite
   * sides of an octave boundary, and a plain subtraction would put them eleven
   * semitones apart and call every one of them unspellable.
   *
   * This is what turns "the button is on the wrong letter" into a *reason* -
   * the sweeps below use it to assert that every remaining wrong letter is a
   * root convention has no spelling for, rather than merely counting them.
   */
  function accidentalFor(pitchClass: number, letter: number): number {
    return ((((pitchClass - LETTER_SEMITONES[letter] + 6) % 12) + 12) % 12) - 6;
  }

  /** One option whose printed root is not on the letter its numeral names. */
  interface OffLetter {
    /** The scale, key, degree and accidental that reached it. */
    root: string;
    /** Which row the button is in. */
    group: ChordOptionGroup;
    /** The accidental the numeral's own letter would have needed. */
    accidental: number;
    /** How the failure reads when it is printed. */
    describe: string;
  }

  /**
   * Every off-letter option in one key with one slot selected.
   *
   * The selection is passed in rather than fixed, because the alternates row is
   * the one group that reads it: `alternates` offers every shape on the
   * *selected* chord's degree and accidental, so a sweep anchored on an
   * unaltered slot covers that row on a fifth of its reachable input. The
   * borrowed and secondary rows compute their own degree and accidental from
   * the key and ignore the selection entirely, which is why they are fully
   * swept whatever is passed here.
   */
  function offLetter(
    scale: { id: string; intervals: readonly number[] },
    tonic: number,
    selected: ChordDegree
  ): OffLetter[] {
    const key = keyFor(tonic, scale.id);
    const tonicLetter = LETTERS.indexOf(letterOf(service.spellNote(key.tonic, key.preferSharps)));
    const wrong: OffLetter[] = [];

    for (const option of everyOption(scale.intervals, key, selected)) {
      const letter = (tonicLetter + option.degree) % 7;
      if (letterOf(option.name) === LETTERS[letter]) continue;

      const pitchClass = chordRootPitchClass(
        key,
        scale.intervals,
        selection(option.degree, option.alter, option.quality)
      );

      wrong.push({
        root: `${scale.id} on ${tonic}: degree ${option.degree} alter ${option.alter}`,
        group: option.group,
        accidental: accidentalFor(pitchClass, letter),
        describe:
          `${scale.id} on ${tonic}: ${option.numeral} printed ${option.name}, ` +
          `wanted ${LETTERS[letter]}`
      });
    }

    return wrong;
  }

  /** Every off-letter option in one key, with each degree selected once. */
  function offLetterInKey(
    scale: { id: string; intervals: readonly number[] },
    tonic: number,
    alter: number
  ): OffLetter[] {
    const wrong: OffLetter[] = [];
    for (let degree = 0; degree <= 6; degree++) {
      // A chromatic root needs a shape to build from; `major` is the one every
      // reachable slot could carry, and the alternates row overrides it
      // sixteen ways regardless.
      wrong.push(...offLetter(scale, tonic, selection(degree, alter, alter === 0 ? null : 'major')));
    }
    return wrong;
  }

  /**
   * **Swept at `alter` zero only**, which is the whole of what this test claims.
   *
   * The design doc's 55 are palette buttons in a key a user is plainly in, and
   * an unaltered selection is what a fresh slot carries - so this is the claim
   * about the diatonic modes stated at its own scope rather than at a scope it
   * cannot hold. Displace the selection twice and the seven modes do reach the
   * fallback; the sweep below is where that is measured and ruled on, and it
   * covers these seven scales again on every accidental this one skips.
   */
  it('names every option on the letter its numeral names, for an unaltered slot', () => {
    const wrong: string[] = [];

    for (const mode of DIATONIC_MODES) {
      const scale = keys.findScale(mode);
      if (!scale) throw new Error(`no scale ${mode}`);

      for (let tonic = 0; tonic < 12; tonic++) {
        wrong.push(...offLetterInKey({ id: mode, intervals: scale.intervals }, tonic, 0).map(o => o.describe));
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * The whole reach of the fallback: **1660 roots, on every selection the model
   * can store**, and every one of them a root that needs a triple accidental.
   *
   * `spellAt` refuses past a double accidental and the caller falls back to
   * `spellPitchClass`, which spells by preference and so lands on a letter the
   * numeral did not name. **The rule is `spellAt`'s and is stated in its
   * docstring; this is where its reach is measured**, and the numbers below are
   * the ones that docstring summarises.
   *
   * That refusal is the only way a button here can still be on the wrong letter,
   * and the assertion that says so - `accidental` outside ±2 on every entry - is
   * the one worth keeping whatever the counts do. A triple accidental is not
   * notation; there is nowhere further to go, and the key's own preference is
   * the honest remainder.
   *
   * ## What is swept, and what the number counts
   *
   * All 33 heptatonic scales, all twelve keys, all seven degrees, and every
   * `alter` from `ALTER_MIN` to `ALTER_MAX` - which is every selection
   * `normalizeChordDegree` lets into a slot. The alternates row is the only
   * group that reads the selection, and it is the only group that ever falls
   * back, so sweeping the accidental axis is what takes that row from a fifth
   * of its input to all of it. **This test used to pin 16 at `alter` zero while
   * its docstring called that "the whole reach of the fallback"; it was the
   * whole reach of one fifth of the input.**
   *
   * A **root** is counted rather than a button, because a root is what falls
   * back: the alternates row offers every shape on the selected chord, so one
   * unspellable root prints on all sixteen of them and the button count is the
   * root count times `NAMED_QUALITIES.length` exactly. Counting buttons is what
   * made the old number move from 12 to 16 at Task 4, when four added-tone
   * shapes joined `QUALITY_INTERVALS` and not one new root fell back.
   *
   * ## The measurement, by accidental
   *
   * | `alter` | roots | of them in a diatonic mode |
   * |---|---|---|
   * | -2 | 669 | 111 |
   * | -1 | 80 | 0 |
   * | 0 | 1 | 0 |
   * | +1 | 92 | 0 |
   * | +2 | 818 | 141 |
   *
   * The single root at `alter` zero is the **sixth degree of A♯ enigmatic**,
   * which needs an F triple sharp. Enigmatic is `[0, 1, 4, 6, 8, 10, 11]` and
   * inherits no key signature, so its own `preferSharps` decides and pitch class
   * 10 is spelled `A♯`; from an A the sixth degree is written on an F, and ten
   * semitones above A♯ is pitch class 8 - three semitones above F.
   *
   * The 252 in a diatonic mode all sit at `alter` ±2 and none of them lower.
   * That is not a surprise once it is stated: two of the seven letters are a
   * semitone from their neighbour, so a mode's own degree can already be a
   * double accidental from its letter in a remote key, and a second displacement
   * in the same direction is one step too far. C♯ aeolian's second degree is a
   * D♯; raised twice it asks for a D triple sharp.
   *
   * ## Why nothing in the borrowed or secondary row is here
   *
   * Both compute their degree and accidental from the key rather than from the
   * selection, and both land within a double accidental everywhere. Pinned as
   * an assertion rather than left as an observation, because it is the half of
   * the claim a user meets: the two append rows are what a fresh page shows,
   * and the alternates row needs a chord selected and doubly displaced before
   * any of this is reachable at all.
   *
   * The map is pinned rather than bounded so that a new scale, a widened
   * `ALTER_MIN`, or a change to a scale's `preferSharps` cannot enlarge the set
   * silently. If a number moves, the new members are printed in the failure and
   * each is a ruling to make, not a count to update.
   */
  const FALLBACK_ROOTS_BY_ALTER: ReadonlyMap<number, number> = new Map([
    [-2, 669],
    [-1, 80],
    [0, 1],
    [1, 92],
    [2, 818]
  ]);

  /** Of those, the ones in one of the seven diatonic modes. All at `alter` ±2. */
  const FALLBACK_ROOTS_IN_A_DIATONIC_MODE = 252;

  it('falls back to the tables only past a double accidental, on every selection', () => {
    const scales = heptatonicScales();
    const rootsByAlter = new Map<number, Set<string>>();
    const diatonicRoots = new Set<string>();
    const notATripleAccidental: string[] = [];
    const notAnAlternate: string[] = [];
    let buttons = 0;

    for (let alter = ALTER_MIN; alter <= ALTER_MAX; alter++) {
      const roots = new Set<string>();

      for (const scale of scales) {
        for (let tonic = 0; tonic < 12; tonic++) {
          for (const entry of offLetterInKey(scale, tonic, alter)) {
            buttons++;
            roots.add(entry.root);
            if (DIATONIC_MODES.includes(scale.id)) diatonicRoots.add(entry.root);
            if (Math.abs(entry.accidental) <= 2) {
              notATripleAccidental.push(`${entry.describe} (needed ${entry.accidental})`);
            }
            if (entry.group !== 'alternate') {
              notAnAlternate.push(`${entry.describe} (${entry.group})`);
            }
          }
        }
      }

      rootsByAlter.set(alter, roots);
    }

    // The class, first: a button on the wrong letter is a root convention has
    // no spelling for, never a rule that was got wrong.
    expect(notATripleAccidental)
      .withContext(notATripleAccidental.join('\n'))
      .toEqual([]);
    expect(notAnAlternate).withContext(notAnAlternate.join('\n')).toEqual([]);

    // Then the size of it.
    const measured = new Map([...rootsByAlter].map(([alter, roots]) => [alter, roots.size]));
    expect([...measured]).toEqual([...FALLBACK_ROOTS_BY_ALTER]);
    expect(diatonicRoots.size).toBe(FALLBACK_ROOTS_IN_A_DIATONIC_MODE);

    // Every root prints on the whole alternates row, which is what makes the
    // root the thing worth counting.
    const allRoots = [...rootsByAlter.values()].reduce((sum, roots) => sum + roots.size, 0);
    expect(buttons).toBe(allRoots * NAMED_QUALITIES.length);
  });

  /**
   * And no diatonic mode reaches it until the selection is displaced twice.
   *
   * Stated on its own because it is what the fallback's headers claim, and the
   * claim they used to make - "nowhere in a diatonic mode" - was true only of
   * the unaltered slot the sweep above covers. A user in C major who has not
   * touched the accidental cannot see one of these; a user who has lowered a
   * slot twice in C♯ aeolian can.
   */
  it('reaches no diatonic mode below a doubly displaced selection', () => {
    const reached: string[] = [];

    for (const mode of DIATONIC_MODES) {
      const scale = keys.findScale(mode);
      if (!scale) throw new Error(`no scale ${mode}`);

      for (const alter of [-1, 0, 1]) {
        for (let tonic = 0; tonic < 12; tonic++) {
          reached.push(
            ...offLetterInKey({ id: mode, intervals: scale.intervals }, tonic, alter)
              .map(entry => entry.describe)
          );
        }
      }
    }

    expect(reached).withContext(reached.join('\n')).toEqual([]);
  });
});
