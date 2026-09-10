import { ALTER_MAX, ALTER_MIN, CHORD_EXTENTS } from '../models/progression-normalize';
import { ExtensionAlterations } from '../models/progression.model';
import { MusicTheoryService } from './music-theory.service';
import {
  ChordExtent,
  ChordQuality,
  ChordShape,
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  degreeQuality,
  degreePitchClasses,
  effectiveQuality,
  isHeptatonic,
  noteCount,
  qualityOfIntervals
} from './progression-harmony';

/** Nothing pinned above the seventh: what a fresh slot carries. */
const NONE: ExtensionAlterations = { ninth: null, eleventh: null, thirteenth: null };

/**
 * A chord shape spread from a plain I triad.
 *
 * The builder takes an object because seven positional arguments is where
 * positional stops being readable, and the default is the chord every existing
 * case in this file was written against - so a spec that names none of the new
 * fields is asserting exactly what it asserted before they existed.
 */
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
 * How many shapes the table names, read off the table rather than written
 * down: the sweeps below multiply by it to prove they ran, and a hand-written
 * 12 is what those assertions would have been checked against after four
 * entries were added and the loop quietly grew.
 */
const NAMED_QUALITY_COUNT = Object.keys(QUALITY_INTERVALS).length;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
const NEAPOLITAN_MINOR = [0, 1, 3, 5, 7, 8, 11];

describe('degreeQuality', () => {
  // The seven triads of a major scale, checked against the figures every
  // theory text prints: I ii iii IV V vi vii-dim.
  it('gives the major scale I ii iii IV V vi vii-dim', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(MAJOR, d, 3));
    expect(qualities).toEqual([
      'major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'
    ] as ChordQuality[]);
  });

  // The Captain Chords screenshot for A minor shows i ii-dim III iv v VI VII.
  it('gives the natural minor scale i ii-dim III iv v VI VII', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(NATURAL_MINOR, d, 3));
    expect(qualities).toEqual([
      'minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major'
    ] as ChordQuality[]);
  });

  // The module claims an unusual scale yields its augmented III without anyone
  // enumerating it, and harmonic minor is the case it names. Raising the
  // seventh to 11 turns III into an augmented triad (G# above the C-E of a C
  // chord in A harmonic minor) and V into a major one, which is the whole
  // point of the scale.
  it('gives harmonic minor i ii-dim III-aug iv V VI vii-dim', () => {
    const qualities = [0, 1, 2, 3, 4, 5, 6].map(d => degreeQuality(HARMONIC_MINOR, d, 3));
    expect(qualities).toEqual([
      'minor', 'diminished', 'augmented', 'minor', 'major', 'major', 'diminished'
    ] as ChordQuality[]);
  });

  it('finds the dominant seventh on degree 5 of a major scale', () => {
    expect(degreeQuality(MAJOR, 4, 7)).toBe('dominant7');
  });

  it('finds the major seventh on degree 1 of a major scale', () => {
    expect(degreeQuality(MAJOR, 0, 7)).toBe('major7');
  });

  // The tonic seventh of both minor scales that raise the leading tone: a
  // minor triad carrying a major seventh, [0, 3, 7, 11].
  it('finds the minor-major seventh on the tonic of harmonic and melodic minor', () => {
    expect(degreePitchClasses(HARMONIC_MINOR, 0, 7)).toEqual([0, 3, 7, 11]);
    expect(degreeQuality(HARMONIC_MINOR, 0, 7)).toBe('minorMajor7');
    expect(degreeQuality(MELODIC_MINOR, 0, 7)).toBe('minorMajor7');
  });

  // The seventh over harmonic minor's augmented III: [0, 4, 8, 11] above its
  // own root, which is the III+ triad with the tonic a major seventh above it.
  it('finds the augmented major seventh on degree 3 of harmonic minor', () => {
    expect(degreePitchClasses(HARMONIC_MINOR, 2, 7)).toEqual([3, 7, 11, 14]);
    expect(degreeQuality(HARMONIC_MINOR, 2, 7)).toBe('augmentedMajor7');
  });

  // [0, 4, 8, 10] - a dominant seventh with a raised fifth. Nothing in the
  // common scales produces one; the Neapolitans do, on their third degree.
  it('finds the augmented seventh on degree 3 of Neapolitan minor', () => {
    expect(degreePitchClasses(NEAPOLITAN_MINOR, 2, 7)).toEqual([3, 7, 11, 13]);
    expect(degreeQuality(NEAPOLITAN_MINOR, 2, 7)).toBe('augmented7');
  });

  /**
   * The three `QUALITY_INTERVALS` entries nothing above reaches, each anchored
   * to a chord a theory text names rather than to the table that defines it.
   *
   * This is the only shape a check on that table can take. A round trip through
   * `qualityOfIntervals` is self-referential - `qualityOfIntervals(
   * QUALITY_INTERVALS[q]) === q` reads the entry it is checking, so it catches
   * only two entries colliding, and `qualityOfIntervals(degreePitchClasses(...))
   * === degreeQuality(...)` is `f(x) === f(x)`. Neither can see an entry that is
   * unique and wrong. `minor7` as [0, 3, 7, 11] would collide and be caught;
   * `halfDiminished7` as [0, 3, 6, 11] and `diminished7` as [0, 3, 6, 8] would
   * not, and both left the whole suite green - while turning every major key's
   * `viiø7` and every harmonic minor key's `vii°7` into a card that prints `?`
   * and a fretboard that lights nothing.
   *
   * What makes these anchors rather than more round trips is that the *stack*
   * comes from the scale - reference data this module does not own - and only
   * the *name* comes from the table. Change the table and the stack no longer
   * answers to its name.
   */
  it('finds the minor seventh on degree 2 of a major scale', () => {
    // ii7 in C major is D-F-A-C: a minor triad under a minor seventh.
    expect(degreePitchClasses(MAJOR, 1, 7)).toEqual([2, 5, 9, 12]);
    expect(degreeQuality(MAJOR, 1, 7)).toBe('minor7');
  });

  it('finds the half-diminished seventh on degree 7 of a major scale', () => {
    // viiø7 in C major is B-D-F-A: a diminished triad under a *minor* seventh,
    // which is the whole distinction from the fully diminished chord below.
    expect(degreePitchClasses(MAJOR, 6, 7)).toEqual([11, 14, 17, 21]);
    expect(degreeQuality(MAJOR, 6, 7)).toBe('halfDiminished7');
  });

  it('finds the fully diminished seventh on degree 7 of harmonic minor', () => {
    // vii°7 in A harmonic minor is G#-B-D-F: three stacked minor thirds, which
    // is the chord the raised leading tone exists to produce.
    expect(degreePitchClasses(HARMONIC_MINOR, 6, 7)).toEqual([11, 14, 17, 20]);
    expect(degreeQuality(HARMONIC_MINOR, 6, 7)).toBe('diminished7');
  });

  it('rejects a degree outside the scale', () => {
    expect(() => degreeQuality(MAJOR, -1, 3)).toThrowError(/degree/i);
    expect(() => degreeQuality(MAJOR, 7, 3)).toThrowError(/degree/i);
  });
});

describe('noteCount', () => {
  // Named directly rather than only through degreePitchClasses, because this
  // is where the extent-to-note-count arithmetic actually lives: every extent
  // above the triad names its topmost interval, so it has (n + 1) / 2 notes,
  // while 3 already is a note count.
  it('counts one note per third in the stack', () => {
    expect(noteCount(3)).toBe(3);
    expect(noteCount(7)).toBe(4);
    expect(noteCount(9)).toBe(5);
    expect(noteCount(11)).toBe(6);
    expect(noteCount(13)).toBe(7);
  });
});

describe('degreePitchClasses', () => {
  // Relative to the tonic, so a C major I is 0,4,7 and an A minor I is too -
  // the tonic offset is applied by the caller.
  it('stacks thirds within the scale', () => {
    expect(degreePitchClasses(MAJOR, 0, 3)).toEqual([0, 4, 7]);
    expect(degreePitchClasses(MAJOR, 1, 3)).toEqual([2, 5, 9]);
    expect(degreePitchClasses(MAJOR, 6, 3)).toEqual([11, 14, 17]);
  });

  it('keeps stacking for sevenths and ninths', () => {
    expect(degreePitchClasses(MAJOR, 4, 7)).toEqual([7, 11, 14, 17]);
    expect(degreePitchClasses(MAJOR, 0, 9)).toEqual([0, 4, 7, 11, 14]);
  });

  // The tall extents, where a wrong note count would go unnoticed in the
  // shorter chords. Both figures are the `major11` and `major13` interval
  // arrays from `music-theory.service.ts`, which is what they are checked
  // against: an independently written table of the same chords.
  it('reaches the eleventh and the thirteenth', () => {
    expect(degreePitchClasses(MAJOR, 0, 11)).toEqual([0, 4, 7, 11, 14, 17]);
    expect(degreePitchClasses(MAJOR, 0, 13)).toEqual([0, 4, 7, 11, 14, 17, 21]);
  });

  it('refuses a scale that is not seven notes', () => {
    expect(() => degreePitchClasses([0, 2, 4, 7, 9], 0, 3)).toThrowError(/heptatonic/);
    // Eight notes is refused as flatly as five. The rule is that a third has
    // to be two scale steps, not that the scale has to be big enough.
    expect(() => degreePitchClasses([0, 2, 3, 5, 6, 8, 9, 11], 0, 3))
      .toThrowError(/heptatonic/);
  });

  // Without this an out-of-range index reads `undefined` from the interval
  // array and the arithmetic quietly yields NaN, which `degreeQuality` then
  // reports as 'other' - a wrong answer dressed as a real one.
  it('refuses a degree that is not one of the seven', () => {
    expect(() => degreePitchClasses(MAJOR, -1, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, 7, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, 1.5, 3)).toThrowError(/degree/i);
    expect(() => degreePitchClasses(MAJOR, NaN, 3)).toThrowError(/degree/i);
  });

  it('accepts every degree of the scale', () => {
    for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
      expect(() => degreePitchClasses(MAJOR, degree, 3)).not.toThrow();
    }
  });
});

describe('isHeptatonic', () => {
  // Exported so the palette can ask before calling rather than catching a
  // throw, and so the length rule lives in exactly one place.
  it('is true for seven notes and false for anything else', () => {
    expect(isHeptatonic(MAJOR)).toBe(true);
    expect(isHeptatonic(HARMONIC_MINOR)).toBe(true);
    expect(isHeptatonic([0, 2, 4, 7, 9])).toBe(false);
    expect(isHeptatonic([0, 2, 3, 5, 6, 8, 9, 11])).toBe(false);
    expect(isHeptatonic([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chromatic roots and overridden shapes
// ---------------------------------------------------------------------------

/**
 * The correction the design doc records under "`alter` cannot express a
 * borrowed chord", checked against the table it tabulates.
 *
 * `alter` used to shift the whole stack, which is transposition, and
 * transposition preserves quality - so every conventional altered numeral in a
 * major key came out with the wrong shape on the right root. These specs are
 * that table read the other way round: what each numeral has to produce.
 */
describe('QUALITY_INTERVALS', () => {
  /**
   * The inverse of `degreeQuality`, and the pair has to agree in both
   * directions or a chord built from a quality would not be recognised as that
   * quality - which is exactly what M3's recogniser will do.
   */
  it('round-trips through the recogniser for every named quality', () => {
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      expect(qualityOfIntervals(intervals))
        .withContext(`${quality} is not recognised from its own intervals`)
        .toBe(quality as ChordQuality);
    }
  });

  /** Every name `degreeQuality` can return, except the one that names nothing. */
  it('holds every named quality and no unnamed one', () => {
    const named: ChordQuality[] = [
      'major', 'minor', 'diminished', 'augmented',
      'major7', 'minor7', 'dominant7', 'minorMajor7',
      'halfDiminished7', 'diminished7', 'augmented7', 'augmentedMajor7',
      // The four added-tone shapes M3 adds. They are four-note chords whose
      // fourth note is a sixth or a ninth rather than a seventh, so `extent` -
      // a count of stacked thirds - has nowhere to put them and they are
      // qualities instead.
      'major6', 'minor6', 'add9', 'minorAdd9'
    ];

    expect(Object.keys(QUALITY_INTERVALS).sort()).toEqual([...named].sort());
  });

  /**
   * Each four-note shape opens with the triad of the same name, which is the
   * property `chordPitchClasses` truncates against: a seventh or an added-tone
   * shape chosen at a triad's height is cut to three notes, and what is left
   * has to be that chord's own triad rather than some other chord.
   */
  it('opens every four-note shape with its own triad', () => {
    expect(QUALITY_INTERVALS.dominant7.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.major7.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.minor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
    expect(QUALITY_INTERVALS.minorMajor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
    expect(QUALITY_INTERVALS.halfDiminished7.slice(0, 3)).toEqual(QUALITY_INTERVALS.diminished);
    expect(QUALITY_INTERVALS.diminished7.slice(0, 3)).toEqual(QUALITY_INTERVALS.diminished);
    expect(QUALITY_INTERVALS.augmented7.slice(0, 3)).toEqual(QUALITY_INTERVALS.augmented);
    expect(QUALITY_INTERVALS.augmentedMajor7.slice(0, 3)).toEqual(QUALITY_INTERVALS.augmented);
    expect(QUALITY_INTERVALS.major6.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.minor6.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
    expect(QUALITY_INTERVALS.add9.slice(0, 3)).toEqual(QUALITY_INTERVALS.major);
    expect(QUALITY_INTERVALS.minorAdd9.slice(0, 3)).toEqual(QUALITY_INTERVALS.minor);
  });

  /**
   * The invariant the reverse reading rests on, asserted directly rather than
   * left to the round trip above.
   *
   * `qualityOfIntervals` returns the *first* entry whose shape matches, so two
   * entries sharing a shape would make it a first match dressed as a function
   * and the second of the two unreachable. The round trip cannot see that from
   * the loser's side - it would report the winner's name for both - and this
   * check can, which is what makes it worth writing separately for four new
   * entries added against twelve existing ones.
   */
  it('gives no two qualities the same shape', () => {
    const shapes = Object.values(QUALITY_INTERVALS).map(intervals => intervals.join(','));
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe('qualityOfIntervals', () => {
  /**
   * `degreeQuality` is this function applied to a diatonic stack, so the two
   * cannot disagree by construction. Pinned anyway: the whole point of one
   * table is that the second reading of it is not a second table.
   */
  it('agrees with degreeQuality on every degree of every scale checked here', () => {
    const scales = [MAJOR, NATURAL_MINOR, HARMONIC_MINOR, MELODIC_MINOR, NEAPOLITAN_MINOR];

    for (const scale of scales) {
      for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
        for (const extent of [3, 7, 9, 11, 13] as ChordExtent[]) {
          expect(qualityOfIntervals(degreePitchClasses(scale, degree, extent)))
            .withContext(`degree ${degree} extent ${extent}`)
            .toBe(degreeQuality(scale, degree, extent));
        }
      }
    }
  });

  /** It reads intervals above the root, wherever the root happens to sit. */
  it('reads a stack that does not start at zero', () => {
    expect(qualityOfIntervals([10, 14, 17])).toBe('major');
    expect(qualityOfIntervals([11, 14, 17])).toBe('diminished');
  });

  it('names a stack that is no chord "other"', () => {
    expect(qualityOfIntervals([0, 1, 6])).toBe('other');
  });
});

describe('chordPitchClasses', () => {
  /** Every case below is in C major, where the correction's table is written. */
  function chord(
    degree: number,
    extent: ChordExtent,
    alter: number,
    quality: ChordQuality | null
  ): number[] {
    return chordPitchClasses(MAJOR, shape({ degree, extent, alter, quality }));
  }

  it('gives the diatonic stack when no quality overrides it', () => {
    expect(chord(0, 3, 0, null)).toEqual([0, 4, 7]);
    expect(chord(6, 3, 0, null)).toEqual([11, 14, 17]);
    expect(chord(4, 7, 0, null)).toEqual([7, 11, 14, 17]);
  });

  /**
   * The five borrowed numerals the correction tabulates, each with the shape
   * its case carries rather than the shape a transposed stack would have had.
   * Pitch classes are relative to the tonic and keep climbing past the octave,
   * as `degreePitchClasses` returns them, so 14 is the D above 2.
   */
  it('builds the borrowed chords of a major key', () => {
    // bVII: B-D-F becomes Bb-D-F. Diminished under the old semantics.
    expect(chord(6, 3, -1, 'major')).toEqual([10, 14, 17]);
    // bVI: A-C-E becomes Ab-C-Eb. Minor under the old semantics.
    expect(chord(5, 3, -1, 'major')).toEqual([8, 12, 15]);
    // bIII: E-G-B becomes Eb-G-Bb. Minor under the old semantics.
    expect(chord(2, 3, -1, 'major')).toEqual([3, 7, 10]);
    // bII, the Neapolitan: D-F-A becomes Db-F-Ab. Minor under the old semantics.
    expect(chord(1, 3, -1, 'major')).toEqual([1, 5, 8]);
    // #iv-dim: F-A-C becomes F#-A-C. Major under the old semantics.
    expect(chord(3, 3, 1, 'diminished')).toEqual([6, 9, 12]);
  });

  /**
   * A secondary dominant is a dominant seventh on a diatonic root, so it needs
   * no alteration at all - only a quality the key does not give that degree.
   * V/V in C is D7: D-F#-A-C, where the key gives D-F-A-C.
   */
  it('builds a secondary dominant on an unaltered root', () => {
    expect(chord(1, 7, 0, 'dominant7')).toEqual([2, 6, 9, 12]);
  });

  /**
   * Design decision 2. `ChordQuality` names only triads and sevenths, so an
   * override at extent 9 and above has nothing to say about the extensions:
   * they keep the scale's own notes. bVII9 is Bb-D-F over a diatonic ninth.
   */
  it('leaves the extensions diatonic above an overridden triad', () => {
    expect(chord(6, 9, -1, 'major')).toEqual([10, 14, 17, 21, 24]);
    expect(chord(6, 13, -1, 'major').slice(0, 3)).toEqual([10, 14, 17]);
    expect(chord(6, 13, -1, 'major').slice(3))
      .toEqual(degreePitchClasses(MAJOR, 6, 13).slice(3));
  });

  /**
   * The other end of the same rule, which the plan's sketch left open: a
   * seventh quality asked for at a triad's height has one interval too many.
   * The extent decides how many notes a chord has - `noteCount` is what
   * `normalizeInversion` wraps against and what the complexity readout prints -
   * so the shape is taken while it lasts and no further. Every seventh opens
   * with its own triad, so what is dropped is the seventh and what is left is
   * still that quality's chord.
   */
  it('takes only as many notes as the extent asks for', () => {
    expect(chord(4, 3, 0, 'dominant7')).toEqual([7, 11, 14]);
    expect(chord(1, 3, 0, 'halfDiminished7')).toEqual([2, 5, 8]);
  });

  it('gives the extent its own note count for every quality', () => {
    for (const extent of [3, 7, 9, 11, 13] as ChordExtent[]) {
      for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
        expect(chord(0, extent, 0, quality).length)
          .withContext(`${quality} at extent ${extent}`)
          .toBe(noteCount(extent));
      }
    }
  });

  /**
   * `voiceChord`'s stated precondition, swept over everything that can reach
   * it rather than over the one slice where it holds for free.
   *
   * This used to loop the major scale at extent 9 with `alter` fixed at 0,
   * which is precisely the corner the invariant cannot fail in: with no
   * displacement the overridden root *is* the diatonic root, so the shape sits
   * under the extensions the way the scale left them. Displace the root and
   * nothing keeps `root + shape[k]` below the diatonic note above it. Over the
   * whole reachable grid the unfixed code returned 1560 non-ascending stacks,
   * 72 of them strictly descending - the same failure the fixed code has to
   * return none of.
   *
   * The scales come from the service for the reason the octave sweep in
   * `progression-normalize.spec.ts` takes them from there: a scale the palette
   * can offer is a scale this invariant has to survive, and a hand-written list
   * here would measure something narrower than the thing it guards.
   */
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** Every `alter` the normaliser will store, ends included. */
  const ALTERS: readonly number[] = [-2, -1, 0, 1, 2];

  it('sweeps the scales the app actually offers', () => {
    expect(APP_SCALES.length).toBe(33);
    expect(ALTERS[0]).toBe(ALTER_MIN);
    expect(ALTERS[ALTERS.length - 1]).toBe(ALTER_MAX);
  });

  it('keeps the stack ascending for every chord the model admits', () => {
    let checked = 0;

    for (const intervals of APP_SCALES) {
      for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
        for (const extent of CHORD_EXTENTS) {
          for (const alter of ALTERS) {
            for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
              const notes = chordPitchClasses(
                intervals,
                shape({ degree, extent, alter, quality })
              );
              checked++;

              for (let i = 1; i < notes.length; i++) {
                expect(notes[i])
                  .withContext(
                    `${quality} on degree ${degree} at extent ${extent} altered ` +
                      `by ${alter} of [${intervals}], note ${i}`
                  )
                  .toBeGreaterThan(notes[i - 1]);
              }
            }
          }
        }
      }
    }

    // The sweep is only worth anything if it ran: a filter that quietly emptied
    // `APP_SCALES` would pass every expectation above by making none.
    expect(checked).toBe(
      APP_SCALES.length *
        7 *
        CHORD_EXTENTS.length *
        ALTERS.length *
        NAMED_QUALITY_COUNT
    );
  });

  /**
   * What the lift may not do, and the reason it is a lift rather than a re-stack.
   *
   * Raising a note by whole octaves changes the register it is written at and
   * nothing else, so the chord that comes out holds the same pitch classes in
   * the same order as the one that went in. That is the whole claim: the fix is
   * to the *contract*, and it is allowed to cost nothing musically.
   */
  it('changes no pitch class while it lifts', () => {
    for (const intervals of APP_SCALES) {
      for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
        for (const extent of CHORD_EXTENTS) {
          for (const alter of ALTERS) {
            for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
              const qualityIntervals = QUALITY_INTERVALS[quality as NamedQuality];
              const diatonic = degreePitchClasses(intervals, degree, extent);
              const root = diatonic[0] + alter;
              const unlifted = diatonic.map((note, i) =>
                i < qualityIntervals.length ? root + qualityIntervals[i] : note
              );

              const built = chordPitchClasses(
                intervals,
                shape({ degree, extent, alter, quality })
              );

              expect(built.map(pitchClass => (((pitchClass % 12) + 12) % 12)))
                .withContext(`${quality} on degree ${degree} at extent ${extent}`)
                .toEqual(unlifted.map(pitchClass => (((pitchClass % 12) + 12) % 12)));
            }
          }
        }
      }
    }
  });

  /**
   * The two witnesses the review found, kept as literals so the fix is legible
   * without running the sweep.
   *
   * The first is a duplicate - `augmented`'s displaced fifth landing on the
   * diatonic seventh - and the second is strictly descending, which is the case
   * `voiceChord`'s header says it is not given.
   */
  it('lifts a duplicated and a descending extension clear', () => {
    // C major, degree 6 raised by a tone: the augmented triad's fifth lands on
    // the diatonic seventh. [13, 17, 21, 21] before the lift.
    expect(chord(6, 7, 2, 'augmented')).toEqual([13, 17, 21, 33]);
    // Harmonic minor, the same degree and shape: the diatonic seventh is a
    // semitone *below* the fifth above it. [13, 17, 21, 20] before the lift.
    expect(
      chordPitchClasses(
        HARMONIC_MINOR,
        shape({ degree: 6, extent: 7, alter: 2, quality: 'augmented' })
      )
    ).toEqual([13, 17, 21, 32]);
  });

  /**
   * Design decision 1. A chromatic root with no shape to build is a value of
   * the wrong kind rather than a control at its limit, so it throws under the
   * first clause of the rule in `progression-normalize.ts` rather than falling
   * through to the transposition that produced the wrong table above.
   */
  it('refuses a chromatic root with no shape to build', () => {
    expect(() => chord(6, 3, -1, null)).toThrowError(/quality/i);
    expect(() => chord(6, 3, 1, null)).toThrowError(/quality/i);
  });

  /** `other` names no interval set, so there is nothing to build from. */
  it('refuses an override that names no interval set', () => {
    expect(() => chord(0, 3, 0, 'other')).toThrowError(/other/i);
    expect(() => chord(0, 3, -1, 'other')).toThrowError(/other/i);
  });

  /** The guards under it still apply: the scale and the degree are checked. */
  it('refuses a scale that cannot stack thirds, and a degree off the scale', () => {
    expect(() => chordPitchClasses([0, 2, 4, 7, 9], shape({ quality: 'major' })))
      .toThrowError(/heptatonic/i);
    expect(() => chordPitchClasses(MAJOR, shape({ degree: 7, quality: 'major' })))
      .toThrowError(/degree/i);
  });

  /**
   * The round trip the one table exists to keep: a chord built from a quality
   * is recognised as that quality, on a chromatic root as much as a diatonic
   * one. bVII built as major reads back as major, where the old semantics read
   * back as diminished.
   *
   * Asked at the height the quality itself names, which is the width of the
   * claim: a triad override at extent 7 keeps the scale's seventh above it by
   * design, so the chord that comes back is that triad under a diatonic seventh
   * and is rightly named as one. The round trip is a promise about the notes
   * the override supplies, not about the ones it deliberately leaves alone.
   */
  it('builds a chord the recogniser reads back as the quality asked for', () => {
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      const extent: ChordExtent = intervals.length === 3 ? 3 : 7;

      for (const alter of [-1, 0, 1]) {
        for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
          expect(qualityOfIntervals(chord(degree, extent, alter, quality as ChordQuality)))
            .withContext(`${quality} on degree ${degree} altered by ${alter}`)
            .toBe(quality as ChordQuality);
        }
      }
    }
  });

  /**
   * The other half of that promise, stated so it is a decision rather than a
   * surprise: a triad override under an extent that reaches a seventh takes the
   * seventh from the key. bVII at extent 7 in C major is Bb-D-F over the A the
   * scale already had - a Bb major seventh, and named as one. A user who wants
   * a dominant Bb7 asks for `dominant7`, which names the seventh it wants.
   */
  it('names a triad override under a diatonic seventh after what it became', () => {
    expect(chord(6, 7, -1, 'major')).toEqual([10, 14, 17, 21]);
    expect(qualityOfIntervals(chord(6, 7, -1, 'major'))).toBe('major7');
    expect(chord(6, 7, -1, 'dominant7')).toEqual([10, 14, 17, 20]);
    expect(qualityOfIntervals(chord(6, 7, -1, 'dominant7'))).toBe('dominant7');
  });
});

/**
 * The design doc's "A real ninth chord is unreachable", answered.
 *
 * Every figure below is worked out from the chord rather than read off the
 * code: pitch classes are relative to the tonic and keep climbing past the
 * octave, so 14 is the D above 2 and a major ninth above the root is
 * `root + 14`.
 */
describe('chordPitchClasses: extensions', () => {
  // V9 in C major is G-B-D-F-A. The ninth is the key's own A, which is what the
  // field leaves alone while it is null.
  it('builds the diatonic V9 of C major', () => {
    expect(chordPitchClasses(MAJOR, shape({ degree: 4, extent: 9 })))
      .toEqual([7, 11, 14, 17, 21]);
  });

  // G7b9 is G-B-D-F-Ab. A major ninth above G is 7 + 14 = 21, an A; flattened
  // it is 20, which is that A flat.
  it('flattens the ninth: G7♭9', () => {
    expect(chordPitchClasses(MAJOR, shape({
      degree: 4, extent: 9, extensions: { ...NONE, ninth: -1 }
    }))).toEqual([7, 11, 14, 17, 20]);
  });

  /**
   * The gap this field exists to close. `V/vi` in C major is an E dominant
   * seventh - E G♯ B D - and raising it to a ninth took the ninth from the key,
   * which gives F: a flat ninth nobody asked for, with no way to ask for the
   * F♯ that makes a plain E9.
   *
   * A major ninth above E is 4 + 14 = 18, which is that F♯. The diatonic
   * version is 17, an F, and both are asserted so the fix reads as a difference
   * rather than as a figure.
   */
  it('builds a real E9 as V/vi in C major', () => {
    const e7 = shape({ degree: 2, extent: 9, quality: 'dominant7' });
    expect(chordPitchClasses(MAJOR, e7)).toEqual([4, 8, 11, 14, 17]);
    expect(chordPitchClasses(MAJOR, { ...e7, extensions: { ...NONE, ninth: 0 } }))
      .toEqual([4, 8, 11, 14, 18]);
  });

  // Cmaj13#11 is C-E-G-B-D-F♯-A. A perfect eleventh above C is 17, an F; raised
  // it is 18, that F♯, and the thirteenth above it stays the key's own A.
  it('sharpens the eleventh: Imaj13♯11', () => {
    expect(chordPitchClasses(MAJOR, shape({
      extent: 13, extensions: { ...NONE, eleventh: 1 }
    }))).toEqual([0, 4, 7, 11, 14, 18, 21]);
  });

  // A major thirteenth above C is 21, an A; flattened it is 20, an A flat.
  it('flattens the thirteenth', () => {
    expect(chordPitchClasses(MAJOR, shape({
      extent: 13, extensions: { ...NONE, thirteenth: -1 }
    }))).toEqual([0, 4, 7, 11, 14, 17, 20]);
  });

  /**
   * `extent` stays the single height control, which is what "read only once
   * `extent` reaches the extension" means: a ninth pinned on a triad is a pin
   * on a note the chord does not have, and it neither adds one nor moves
   * anything else. Without this the field would be a second, silent height
   * control and `noteCount(extent)` would stop describing the chord.
   */
  it('pins nothing on an extension the extent does not reach', () => {
    const pinned = { ninth: -1 as const, eleventh: 1 as const, thirteenth: -1 as const };
    expect(chordPitchClasses(MAJOR, shape({ extensions: pinned }))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, extensions: pinned })))
      .toEqual([0, 4, 7, 11]);
    // The ninth is the one extension extent 9 does reach, and the two above it
    // stay silent: 0 + 14 - 1 = 13, a D flat.
    expect(chordPitchClasses(MAJOR, shape({ extent: 9, extensions: pinned })))
      .toEqual([0, 4, 7, 11, 13]);
  });

  /**
   * Each alteration is measured from the *chord's* natural extension and not
   * from the scale's, which is the whole of what makes a real ninth reachable.
   * Swept rather than argued: on every degree of a major key, `ninth: 0` puts a
   * major ninth above that chord's own root, wherever the key's ninth sits.
   */
  it('measures every alteration from the root, not from the key', () => {
    for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
      const built = chordPitchClasses(
        MAJOR,
        shape({ degree, extent: 9, extensions: { ...NONE, ninth: 0 } })
      );
      expect(built[4] - built[0]).withContext(`degree ${degree}`).toBe(14);
    }
  });
});

describe('chordPitchClasses: suspensions', () => {
  // Csus4 is C-F-G and Csus2 is C-D-G: the fourth and the second standing in
  // for the third, which is the note a suspension replaces.
  it('replaces the third', () => {
    expect(chordPitchClasses(MAJOR, shape({ suspension: 'sus4' }))).toEqual([0, 5, 7]);
    expect(chordPitchClasses(MAJOR, shape({ suspension: 'sus2' }))).toEqual([0, 2, 7]);
  });

  // G7sus4 is G-C-D-F. The replacement happens at every height, so the seventh
  // above it is untouched and 7sus4 falls out with no rule of its own.
  // 7 + 5 = 12, which is the C above the tonic.
  it('suspends at every height: G7sus4', () => {
    expect(chordPitchClasses(MAJOR, shape({ degree: 4, extent: 7, suspension: 'sus4' })))
      .toEqual([7, 12, 14, 17]);
  });

  // The suspended fourth and the eleventh are one pitch class an octave apart.
  // Doubled, not dropped: the note count is what normalizeInversion wraps
  // against and what the complexity readout prints.
  it('doubles the fourth under an eleventh rather than dropping it', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 11, suspension: 'sus4' })))
      .toEqual([0, 5, 7, 11, 14, 17]);
  });

  /**
   * The suspension is measured from the root the *shape* gave rather than from
   * the degree that root displaces. `♭VII` in C major is rooted on B flat, so
   * the fourth above it is an E flat - 10 + 5 = 15 - and not the E natural a
   * fourth above the key's own B.
   */
  it('suspends above a displaced root', () => {
    expect(chordPitchClasses(MAJOR, shape({
      degree: 6, alter: -1, quality: 'major', suspension: 'sus4'
    }))).toEqual([10, 15, 17]);
  });

  /** Every extent keeps its own note count with a suspension on it. */
  it('gives the extent its own note count for every suspension', () => {
    for (const extent of CHORD_EXTENTS) {
      for (const suspension of ['none', 'sus2', 'sus4'] as const) {
        expect(chordPitchClasses(MAJOR, shape({ extent, suspension })).length)
          .withContext(`${suspension} at extent ${extent}`)
          .toBe(noteCount(extent));
      }
    }
  });
});

describe('chordPitchClasses: added tones', () => {
  // C6 is C-E-G-A and C6/9 is C-E-G-A-D. The 6/9 needs no rule of its own: the
  // shape gives four notes and the key's own ninth sits on top of them.
  it('builds C6, and C6/9 with no rule of its own', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'major6' })))
      .toEqual([0, 4, 7, 9]);
    expect(chordPitchClasses(MAJOR, shape({ extent: 9, quality: 'major6' })))
      .toEqual([0, 4, 7, 9, 14]);
  });

  // Cadd9 is C-E-G-D: a ninth added over a triad with no seventh under it,
  // which is exactly why it is a shape rather than an extent.
  it('builds Cadd9', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'add9' })))
      .toEqual([0, 4, 7, 14]);
  });

  // Cm6 is C-Eb-G-A and Cm(add9) is C-Eb-G-D.
  it('builds the minor pair', () => {
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'minor6' })))
      .toEqual([0, 3, 7, 9]);
    expect(chordPitchClasses(MAJOR, shape({ extent: 7, quality: 'minorAdd9' })))
      .toEqual([0, 3, 7, 14]);
  });

  /**
   * The truncation invariant, on the four entries it was widened for: a
   * four-note shape asked for at a triad's height leaves that shape's own
   * triad, because every entry opens with it.
   */
  it('cuts an added-tone shape back to its own triad', () => {
    expect(chordPitchClasses(MAJOR, shape({ quality: 'major6' }))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(MAJOR, shape({ quality: 'add9' }))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(MAJOR, shape({ quality: 'minor6' }))).toEqual([0, 3, 7]);
    expect(chordPitchClasses(MAJOR, shape({ quality: 'minorAdd9' }))).toEqual([0, 3, 7]);
  });

  /** And each reads back as itself, which is what the reverse reading needs. */
  it('reads each added-tone shape back as itself', () => {
    for (const quality of ['major6', 'minor6', 'add9', 'minorAdd9'] as NamedQuality[]) {
      expect(qualityOfIntervals(chordPitchClasses(MAJOR, shape({ extent: 7, quality }))))
        .withContext(quality)
        .toBe(quality);
    }
  });
});

/**
 * The one function on the naming path with no coverage at all, which is how
 * both the bugs below survived: deleting its override branch outright - making
 * it `return degreeQuality(...)` - left the whole suite green, and under that
 * mutant a bVII prints `vii°`, the exact wrong label the function exists to
 * prevent.
 */
describe('effectiveQuality', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** A null quality means "as the key gives it", which is `degreeQuality`. */
  it('names a slot with no override from the key', () => {
    expect(effectiveQuality(MAJOR, shape())).toBe('major');
    expect(effectiveQuality(MAJOR, shape({ degree: 6 }))).toBe('diminished');
    expect(effectiveQuality(MAJOR, shape({ degree: 4, extent: 7 }))).toBe('dominant7');
    expect(effectiveQuality(HARMONIC_MINOR, shape({ degree: 2 }))).toBe('augmented');
  });

  /**
   * The override branch, and the one the mutant deletes. Degree 6 of a major
   * key is diminished; a bVII is major, and it has to be named major rather
   * than the `vii°` the key would have given.
   */
  it('names an overridden slot from the override, not from the key', () => {
    expect(effectiveQuality(MAJOR, shape({ degree: 6, alter: -1, quality: 'major' })))
      .toBe('major');
    expect(effectiveQuality(MAJOR, shape({ degree: 5, alter: -1, quality: 'major' })))
      .toBe('major');
    expect(effectiveQuality(MAJOR, shape({ degree: 1, extent: 7, quality: 'dominant7' })))
      .toBe('dominant7');
    // And on a degree the key already names the same way, so the branch is
    // pinned by a case where the two answers differ *and* one where they agree.
    expect(effectiveQuality(MAJOR, shape({ degree: 1, quality: 'diminished' })))
      .toBe('diminished');
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
    expect(effectiveQuality(MAJOR, shape({ quality: 'major7' }))).toBe('major');

    const flatSeven = shape({ degree: 6, extent: 7, alter: -1, quality: 'major' });
    expect(chordPitchClasses(MAJOR, flatSeven)).toEqual([10, 14, 17, 21]);
    expect(effectiveQuality(MAJOR, flatSeven)).toBe('major7');
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

            expect(effectiveQuality(intervals, shape({ degree, extent, alter, quality })))
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
    expect(effectiveQuality(MAJOR, wide)).toBe('other');
  });

  /**
   * `'other'` is its own answer rather than an argument to build from.
   *
   * `chordPitchClasses` throws on it - it names no interval set - so the branch
   * has to come first. It is reachable: `regenerateSlot` writes the derived
   * quality into the field, and Hungarian minor's second degree derives as
   * `'other'`.
   */
  it('hands an unnameable stored quality straight back', () => {
    expect(effectiveQuality(MAJOR, shape({ quality: 'other' }))).toBe('other');
    expect(() => effectiveQuality(MAJOR, shape({ quality: 'other' }))).not.toThrow();
  });

  /**
   * A null quality is answered from the key without building anything, which
   * is also what keeps it clear of the one pair `chordPitchClasses` refuses.
   * The pair is refused at the door by `normalizeChordDegree`, and naming is
   * not the place to discover that a document carried it anyway.
   */
  it('names a chromatic root under a null quality rather than throwing', () => {
    expect(() => chordPitchClasses(MAJOR, shape({ degree: 6, alter: -1 })))
      .toThrowError(/quality/i);
    expect(effectiveQuality(MAJOR, shape({ degree: 6, alter: -1 }))).toBe('diminished');
  });

  /**
   * The first of two intermediate states this function's docstring argues for
   * and nothing asserted. **M3 Task 5 deletes this when `effectiveChord`
   * replaces `effectiveQuality`.**
   *
   * The promise is that the name comes off the chord, and what that promise
   * cannot do is name a chord `QUALITY_INTERVALS` has no entry for. A
   * suspension is exactly that: `[0, 5, 7]` is no entry there, so a sus chord
   * comes back `'other'` and the card prints `?`. Unlabelled rather than
   * mislabelled, on the same terms as everywhere else - and unreachable through
   * the UI until Task 6, because nothing writes `suspension` today.
   *
   * `effectiveChord` reads the base shape with the suspension *removed* and
   * composes the figure, so the G7sus4 below becomes `dominant7` plus `sus4`
   * rather than nothing at all. Pinned here so that the day it changes, the
   * change is a failing spec rather than a docstring nobody re-read.
   */
  it('cannot yet name a suspended chord, and says so rather than guessing', () => {
    expect(chordPitchClasses(MAJOR, shape({ suspension: 'sus4' }))).toEqual([0, 5, 7]);
    expect(effectiveQuality(MAJOR, shape({ suspension: 'sus4' }))).toBe('other');
    expect(effectiveQuality(MAJOR, shape({ suspension: 'sus2' }))).toBe('other');

    // The one that shows what is actually lost: a G7sus4 is a chord with a
    // name, and this function has no way to reach it.
    const g7sus4 = shape({ degree: 4, extent: 7, suspension: 'sus4' });
    expect(chordPitchClasses(MAJOR, g7sus4)).toEqual([7, 12, 14, 17]);
    expect(effectiveQuality(MAJOR, g7sus4)).toBe('other');
  });

  /**
   * The second, and the opposite failure to the first. **M3 Task 5 deletes this
   * when `effectiveChord` replaces `effectiveQuality`.**
   *
   * `qualityOfIntervals` names a stack from its first four notes, which is the
   * convention `ChordDegree.quality` stores a ninth under and is right for the
   * *base* shape. It means a pinned alteration above the seventh cannot move
   * the answer: a V9 and a V7♭9 are one `dominant7` here, and the card prints
   * the same numeral over two different chords.
   *
   * Where the suspension above is unlabelled, this is *under*-labelled - the
   * name is not wrong, it is silent about the note the user pinned. Both are
   * the same missing layer: a quality is one word and this chord needs a
   * composed figure. `effectiveChord` returns the alteration alongside the base
   * and the renderers compose `V7♭9` from the pair.
   */
  it('cannot yet see a pinned alteration above the seventh', () => {
    const plain = shape({ degree: 4, extent: 9 });
    const flatNine = shape({
      degree: 4,
      extent: 9,
      extensions: { ninth: -1, eleventh: null, thirteenth: null }
    });

    // Two different chords - the ninth is a semitone lower in the second.
    expect(chordPitchClasses(MAJOR, plain)).toEqual([7, 11, 14, 17, 21]);
    expect(chordPitchClasses(MAJOR, flatNine)).toEqual([7, 11, 14, 17, 20]);

    // One name, because the fifth note is never read.
    expect(effectiveQuality(MAJOR, plain)).toBe('dominant7');
    expect(effectiveQuality(MAJOR, flatNine)).toBe('dominant7');
  });

  /** The guards below it still reach the caller. */
  it('refuses a scale that cannot stack thirds, and a degree off the scale', () => {
    expect(() => effectiveQuality([0, 2, 4, 7, 9], shape({ quality: 'major' })))
      .toThrowError(/heptatonic/i);
    expect(() => effectiveQuality(MAJOR, shape({ degree: 7 }))).toThrowError(/degree/i);
  });
});
