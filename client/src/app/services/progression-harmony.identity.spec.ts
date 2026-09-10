import { CHORD_EXTENTS } from '../models/progression-normalize';
import { ExtensionAlterations } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import {
  ChordExtent,
  ChordQuality,
  ChordShape,
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  effectiveChord,
  isHeptatonic
} from './progression-harmony';

/**
 * What a chord *is*, as `effectiveChord` reads it back off the notes it built.
 *
 * Split out of `progression-harmony.spec.ts` when that file reached the
 * 1000-line cap, along the seam the module itself has. Over there the subject is
 * the arithmetic - which notes a degree, an extent and an override stack up to -
 * and every expectation is a chord table a reader can check by eye. Here every
 * one of those stacks is taken as given and the only question is what the chord
 * turns out to *be*: its base shape, its suspension, the alteration of each
 * extension, and the letter each note is written on.
 *
 * The precedent is `progression-vocabulary.spelling.spec.ts`, which came out of
 * its own neighbour the same way: a second spec file for one module, named for
 * the question it answers, with its own local fixtures rather than a shared
 * helper module for two callers.
 *
 * `progression-chord-names.spec.ts` is the third file in the chain, and it takes
 * the identities this one describes and checks what is *printed* from them.
 */

/** Nothing pinned above the seventh: what a fresh slot carries. */
const NONE: ExtensionAlterations = { ninth: null, eleventh: null, thirteenth: null };

/** A chord shape spread from a plain I triad, as the sibling spec builds one. */
function shape(overrides: Partial<ChordShape> = {}): ChordShape {
  return {
    degree: 0,
    alter: 0,
    extent: 3,
    quality: null,
    suspension: 'none',
    extensions: NONE,
    ...overrides
  };
}

/**
 * How many shapes the table names, read off the table rather than written down,
 * for the same reason the sibling spec reads it: a hand-written 12 is what the
 * sweep would have been checked against after four entries were added.
 */
const NAMED_QUALITY_COUNT = Object.keys(QUALITY_INTERVALS).length;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

/**
 * The one function on the naming path with no coverage at all, which is how
 * both the bugs below survived: deleting its override branch outright - making
 * it read the quality straight from the key - left the whole suite green, and
 * under that mutant a bVII prints `vii°`, the exact wrong label the function
 * exists to prevent.
 *
 * It was `effectiveQuality` and returned one word. M3 Task 5 made it return a
 * `ChordIdentity`, and **two specs here were deleted rather than updated**,
 * because each pinned a thing that is no longer true:
 *
 *  - *"cannot yet name a suspended chord"* pinned a sus chord coming back
 *    `'other'`. `reads the base with the suspension removed` below is what
 *    replaces it, and `progression-chord-names.spec.ts`' `names a suspended
 *    seventh` is the other half - the figure `V7sus4` that the `'other'` made
 *    unreachable.
 *  - *"cannot yet see a pinned alteration above the seventh"* pinned a V9 and a
 *    V7♭9 sharing one name. `measures each extension against the chord's own
 *    natural` replaces it here, and `drops to the seventh when the ninth is
 *    flattened` next door is the figure it buys.
 *
 * Both were written to fail loudly the day this task landed, which is what an
 * intermediate state pinned by spec is for.
 */
describe('effectiveChord', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** The base alone, which is what `effectiveQuality` used to return outright. */
  function base(scaleIntervals: readonly number[], overrides: Partial<ChordShape> = {}): ChordQuality {
    return effectiveChord(scaleIntervals, shape(overrides)).base;
  }

  /** A null quality means "as the key gives it", which is `degreeQuality`. */
  it('names a slot with no override from the key', () => {
    expect(base(MAJOR)).toBe('major');
    expect(base(MAJOR, { degree: 6 })).toBe('diminished');
    expect(base(MAJOR, { degree: 4, extent: 7 })).toBe('dominant7');
    expect(base(HARMONIC_MINOR, { degree: 2 })).toBe('augmented');
  });

  /**
   * The override branch, and the one the mutant deletes. Degree 6 of a major
   * key is diminished; a bVII is major, and it has to be named major rather
   * than the `vii°` the key would have given.
   */
  it('names an overridden slot from the override, not from the key', () => {
    expect(base(MAJOR, { degree: 6, alter: -1, quality: 'major' })).toBe('major');
    expect(base(MAJOR, { degree: 5, alter: -1, quality: 'major' })).toBe('major');
    expect(base(MAJOR, { degree: 1, extent: 7, quality: 'dominant7' })).toBe('dominant7');
    // And on a degree the key already names the same way, so the branch is
    // pinned by a case where the two answers differ *and* one where they agree.
    expect(base(MAJOR, { degree: 1, quality: 'diminished' })).toBe('diminished');
  });

  /**
   * Fix 6. The label used to be the override's own name whatever the extent
   * did with it, and it disagreed with the chord in both directions.
   *
   * Below the override's height the extent drops the seventh, so a `major7` at
   * extent 3 sounds a plain triad and used to print `Imaj7` over three notes.
   * Above it the key's own seventh joins, so bVII at extent 7 in C major is
   * Bb-D-F-A - which `chordPitchClasses`' spec above names a Bb major seventh -
   * and used to print `B♭ Maj` over four.
   */
  it('names the chord the slot builds, not the override it was asked for', () => {
    expect(chordPitchClasses(MAJOR, shape({ quality: 'major7' }))).toEqual([0, 4, 7]);
    expect(base(MAJOR, { quality: 'major7' })).toBe('major');

    const flatSeven = { degree: 6, extent: 7 as ChordExtent, alter: -1, quality: 'major' as const };
    expect(chordPitchClasses(MAJOR, shape(flatSeven))).toEqual([10, 14, 17, 21]);
    expect(base(MAJOR, flatSeven)).toBe('major7');
  });

  /**
   * The other half of that decision, and the reason it costs the user nothing:
   * at the height the override itself names, the answer is the override
   * unchanged. Over every scale the app offers, every degree, every `alter` the
   * normaliser stores and every named quality - so a user who picks a chord and
   * leaves the extent where the chord's own height puts it always reads back
   * exactly what they chose.
   */
  it('gives back the override itself at the height that override names', () => {
    let checked = 0;

    for (const intervals of APP_SCALES) {
      for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
        for (const alter of [-2, -1, 0, 1, 2]) {
          for (const quality of Object.keys(QUALITY_INTERVALS) as NamedQuality[]) {
            const extent: ChordExtent = QUALITY_INTERVALS[quality].length === 3 ? 3 : 7;
            checked++;

            expect(base(intervals, { degree, extent, alter, quality }))
              .withContext(`${quality} on degree ${degree} altered by ${alter}`)
              .toBe(quality);
          }
        }
      }
    }

    expect(checked).toBe(APP_SCALES.length * 7 * 5 * NAMED_QUALITY_COUNT);
  });

  /**
   * And the cost that decision does carry, stated rather than discovered: an
   * override whose leftover diatonic notes make no named chord comes back
   * `'other'`, so the card prints `?` and the fretboard lights nothing.
   *
   * A major triad on a root two semitones flat, under a seventh the key kept
   * where it was, spans thirteen semitones from root to top. That is no chord
   * anyone has a name for, and saying so is the rule the whole strip is built
   * on: unlabelled rather than mislabelled.
   */
  it('refuses to name a stack the override leaves unnameable', () => {
    const wide = shape({ extent: 7, alter: -2, quality: 'major' });
    expect(chordPitchClasses(MAJOR, wide)).toEqual([-2, 2, 5, 11]);
    expect(effectiveChord(MAJOR, wide).base).toBe('other');
  });

  /**
   * `'other'` is its own answer rather than an argument to build from.
   *
   * `chordPitchClasses` throws on it - it names no interval set - so the branch
   * has to come first. The identity that comes back keeps the degree's own
   * root, because a numeral still says where in the key the chord sits, and
   * carries no intervals at all: nothing to light, which is the same answer the
   * `?` gives on the card.
   */
  it('hands an unnameable stored quality back as an identity that names nothing', () => {
    const identity = effectiveChord(MAJOR, shape({ degree: 4, quality: 'other' }));

    expect(identity.base).toBe('other');
    expect(identity.intervals).toEqual([]);
    expect(identity.steps).toEqual([]);
    expect(identity.root).toBe(7);
    expect(() => effectiveChord(MAJOR, shape({ quality: 'other' }))).not.toThrow();
  });

  /**
   * A null quality is answered from the key without the displacement, which is
   * also what keeps it clear of the one pair `chordPitchClasses` refuses. The
   * pair is refused at the door by `normalizeChordDegree`, and naming is not
   * the place to discover that a document carried it anyway.
   */
  it('names a chromatic root under a null quality rather than throwing', () => {
    expect(() => chordPitchClasses(MAJOR, shape({ degree: 6, alter: -1 })))
      .toThrowError(/quality/i);
    expect(base(MAJOR, { degree: 6, alter: -1 })).toBe('diminished');
  });

  /**
   * The suspension, read off the chord that is *being* suspended.
   *
   * This is what the deleted `cannot yet name a suspended chord` pinned the
   * absence of. `[0, 5, 7]` is no `QUALITY_INTERVALS` entry and never will be -
   * that table holds base shapes only - so the base is read from the stack with
   * the suspension taken out, and the suspension is carried beside it for the
   * renderer to put back as a figure.
   */
  it('reads the base with the suspension removed, and carries the suspension', () => {
    const sus4 = effectiveChord(MAJOR, shape({ suspension: 'sus4' }));
    expect(sus4.intervals).toEqual([0, 5, 7]);
    expect(sus4.base).toBe('major');
    expect(sus4.suspension).toBe('sus4');

    const g7sus4 = effectiveChord(MAJOR, shape({ degree: 4, extent: 7, suspension: 'sus4' }));
    expect(g7sus4.intervals).toEqual([0, 5, 7, 10]);
    expect(g7sus4.base).toBe('dominant7');

    // And the suspended note is a fourth as a *letter*, where the third it
    // replaced was a third. That is what a chord tone is spelled by.
    expect(g7sus4.steps).toEqual([0, 3, 4, 6]);
  });

  /**
   * Each extension against the chord's own natural, which is what the deleted
   * `cannot yet see a pinned alteration above the seventh` pinned the absence
   * of: a V9 and a V7♭9 were one `dominant7` and the card printed one numeral
   * over two different chords.
   *
   * The naturals are 14, 17 and 21 - the chord's, not the key's - so a `0` here
   * means a major ninth above *this* root however far the scale's own ninth is
   * from it.
   */
  it('measures each extension against the chord own natural', () => {
    const v9 = effectiveChord(MAJOR, shape({ degree: 4, extent: 9 }));
    expect(v9.intervals).toEqual([0, 4, 7, 10, 14]);
    expect([v9.ninth, v9.eleventh, v9.thirteenth]).toEqual([0, null, null]);

    const flatNine = effectiveChord(MAJOR, shape({
      degree: 4,
      extent: 9,
      extensions: { ninth: -1, eleventh: null, thirteenth: null }
    }));
    expect(flatNine.intervals).toEqual([0, 4, 7, 10, 13]);
    expect([flatNine.ninth, flatNine.eleventh, flatNine.thirteenth]).toEqual([-1, null, null]);

    // Both are still dominant sevenths underneath, which is the base doing its
    // job: the alteration is the extension's and not the shape's.
    expect(v9.base).toBe('dominant7');
    expect(flatNine.base).toBe('dominant7');
  });

  /**
   * An extension no figure exists for takes the whole name with it.
   *
   * The `vii°` of harmonic minor raised to an eleventh is B D F A♭ C E♭, and
   * that E♭ is a **diminished** eleventh above the B - four semitones where a
   * perfect eleventh is five. `♯11` has a figure and `11` has a figure; a
   * lowered eleventh has none, and no chart writes one.
   *
   * So the chord goes unnamed rather than being called the `vii°7` its first
   * four notes are, which would be silent about the two above them. It is
   * reachable with nothing pinned at all - the key put that E♭ there - which is
   * why the check is on the interval rather than on the stored field.
   */
  it('refuses an extension that is outside every figure', () => {
    const identity = effectiveChord(HARMONIC_MINOR, shape({ degree: 6, extent: 11 }));

    expect(identity.intervals).toEqual([0, 3, 6, 9, 13, 16]);
    expect(identity.eleventh).toBe(-1);
    expect(identity.base).toBe('other');
  });

  /**
   * The octave the ascent lift may have added is not an alteration.
   *
   * A ♭13 measured from a displaced root can land under the eleventh below it,
   * and `liftIntoAscent` raises it an octave to keep the stack ascending. An
   * octave is a register rather than a pitch, so the alteration is read as the
   * nearer of its two representatives and the chord is still a ♭13.
   */
  it('reads an alteration through an octave the ascent lift added', () => {
    const lifted = effectiveChord(MAJOR, shape({
      degree: 0,
      extent: 13,
      extensions: { ninth: null, eleventh: null, thirteenth: -1 }
    }));

    expect(lifted.thirteenth).toBe(-1);
    expect(lifted.base).toBe('major7');
  });

  /**
   * The letter each note is written on, which semitones cannot settle.
   *
   * Nine semitones above the root is a sixth in a `major6` and a seventh in a
   * `diminished7`, and the two are spelled A and B♭♭ over a C. The step comes
   * from the note's position in the stack and from the base, never from the
   * interval.
   */
  it('gives a sixth and a diminished seventh different letters for one interval', () => {
    const six = effectiveChord(MAJOR, shape({ extent: 7, quality: 'major6' }));
    expect(six.intervals).toEqual([0, 4, 7, 9]);
    expect(six.steps).toEqual([0, 2, 4, 5]);

    const dim7 = effectiveChord(HARMONIC_MINOR, shape({ degree: 6, extent: 7 }));
    expect(dim7.intervals).toEqual([0, 3, 6, 9]);
    expect(dim7.steps).toEqual([0, 2, 4, 6]);
  });

  /** An added ninth is a *second* letter-wise, an octave up. */
  it('writes an added ninth on the letter above the root', () => {
    const added = effectiveChord(MAJOR, shape({ extent: 7, quality: 'add9' }));
    expect(added.intervals).toEqual([0, 4, 7, 14]);
    expect(added.steps).toEqual([0, 2, 4, 1]);
  });

  /** The root is relative to the tonic, and reduced, whatever the stack did. */
  it('reduces the root onto its pitch class', () => {
    expect(effectiveChord(MAJOR, shape({ degree: 6, extent: 7 })).root).toBe(11);
    expect(effectiveChord(MAJOR, shape({ degree: 6, alter: 1, quality: 'diminished' })).root)
      .toBe(0);
  });

  /**
   * Every chord the app can build has one step per note, and every step is
   * within a double accidental of the interval beside it.
   *
   * That is what makes a step a *spelling* rather than a label: a note three
   * semitones from where its letter naturally sounds cannot be written on that
   * letter at all, and a step that far out would be a promise `spellAt` has to
   * break. Swept over every heptatonic scale the app offers, at every degree and
   * height, with each suspension.
   */
  it('gives every built chord a spellable step per note', () => {
    const natural = [0, 2, 4, 5, 7, 9, 11];
    const wrong: string[] = [];

    for (const intervals of APP_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of CHORD_EXTENTS) {
          for (const suspension of ['none', 'sus2', 'sus4'] as const) {
            const identity = effectiveChord(intervals, shape({ degree, extent, suspension }));
            if (identity.steps.length !== identity.intervals.length) {
              wrong.push(`degree ${degree} at ${extent} ${suspension}: step count`);
              continue;
            }

            identity.intervals.forEach((interval, i) => {
              const step = identity.steps[i];
              const from = ((((interval - natural[step % 7]) % 12) + 12 + 6) % 12) - 6;
              if (Math.abs(from) > 2) {
                wrong.push(
                  `degree ${degree} at ${extent} ${suspension}: ` +
                    `${interval} on step ${step} needs ${from}`
                );
              }
            });
          }
        }
      }
    }

    expect(wrong).withContext(wrong.slice(0, 10).join('\n')).toEqual([]);
  });

  /**
   * How far that refusal actually reaches, measured rather than assumed.
   *
   * The extension check is the one thing here that can *withdraw* a name a
   * reader used to see: `effectiveQuality` named a tall stack after its first
   * four notes, so an exotic scale's eleventh chord printed a seventh figure and
   * said nothing about the two notes above it. Anything whose extension has no
   * figure now prints `?` instead, and that is a visible change on real scales -
   * so the size of it is pinned rather than left to be discovered.
   *
   * Over all 33 heptatonic scales, every degree, every height, with nothing
   * pinned and nothing suspended:
   *
   * | extent | unnameable |
   * |---|---|
   * | 3 | 21 |
   * | 7 | 22 |
   * | 9 | 22 |
   * | 11 | 45 |
   * | 13 | 52 |
   *
   * The first three columns are the stacks that had no name before this task
   * either - a stack of thirds that is no named chord - and they are unchanged.
   * **The ninth adds none at all**, which is not luck: the ninth of a stack is
   * the scale's own next degree an octave up, no two adjacent degrees of any
   * scale here are more than three semitones apart, and a ♯9 is what three
   * semitones is. The eleventh and the thirteenth reach further because they
   * span three and five scale steps, which an exotic scale can stretch or
   * squeeze past every figure there is.
   *
   * If a number moves, the new members are a ruling to make and not a count to
   * update: either a figure is missing from `NAMEABLE_ALTERATIONS` or a scale
   * has been added.
   */
  const UNNAMEABLE_BY_EXTENT: ReadonlyMap<number, number> = new Map([
    [3, 21],
    [7, 22],
    [9, 22],
    [11, 45],
    [13, 52]
  ]);

  it('withdraws a name only where no figure exists, on every scale it offers', () => {
    const measured = new Map<number, number>();

    for (const extent of CHORD_EXTENTS) {
      let unnameable = 0;

      for (const intervals of APP_SCALES) {
        for (let degree = 0; degree <= 6; degree++) {
          if (effectiveChord(intervals, shape({ degree, extent })).base === 'other') {
            unnameable++;
          }
        }
      }

      measured.set(extent, unnameable);
    }

    expect([...measured]).toEqual([...UNNAMEABLE_BY_EXTENT]);
  });

  /** The guards below it still reach the caller. */
  it('refuses a scale that cannot stack thirds, and a degree off the scale', () => {
    expect(() => effectiveChord([0, 2, 4, 7, 9], shape({ quality: 'major' })))
      .toThrowError(/heptatonic/i);
    expect(() => effectiveChord(MAJOR, shape({ degree: 7 }))).toThrowError(/degree/i);
  });
});
