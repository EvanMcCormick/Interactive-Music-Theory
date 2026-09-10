import { CHORD_CATEGORIES, STEP_INTERVALS, findChordByIntervals } from './chord-catalog';

/**
 * The chord table: that nothing in it moved, that every entry can be spelled,
 * and that a set of intervals finds exactly one chord.
 *
 * The first of those is the project's standing rule on reference data - added
 * to, never changed - and it is asserted here rather than trusted because M3
 * Task 5 both moved the table into this file and added a category to it. A move
 * is the change most likely to reorder or drop a member quietly, and a table
 * nothing reads back is a table nothing notices.
 */
describe('chord catalog', () => {
  /**
   * Every interval array the table held before M3 Task 5, written out a second
   * time from the file as it stood at `bc045b3`.
   *
   * A second copy, deliberately: a check that read the arrays out of the module
   * would pass against any edit at all. It is keyed `category/id` so a chord
   * that changed *category* fails as loudly as one whose notes changed.
   */
  const BEFORE: ReadonlyMap<string, readonly number[]> = new Map<string, readonly number[]>([
    ['triads/major', [0, 4, 7]],
    ['triads/minor', [0, 3, 7]],
    ['triads/diminished', [0, 3, 6]],
    ['triads/augmented', [0, 4, 8]],
    ['triads/sus2', [0, 2, 7]],
    ['triads/sus4', [0, 5, 7]],
    ['seventh/major7', [0, 4, 7, 11]],
    ['seventh/dominant7', [0, 4, 7, 10]],
    ['seventh/minor7', [0, 3, 7, 10]],
    ['seventh/minorMajor7', [0, 3, 7, 11]],
    ['seventh/diminished7', [0, 3, 6, 9]],
    ['seventh/halfDiminished7', [0, 3, 6, 10]],
    ['seventh/augmented7', [0, 4, 8, 10]],
    ['seventh/augmentedMajor7', [0, 4, 8, 11]],
    ['extended/major9', [0, 4, 7, 11, 14]],
    ['extended/dominant9', [0, 4, 7, 10, 14]],
    ['extended/minor9', [0, 3, 7, 10, 14]],
    ['extended/major11', [0, 4, 7, 11, 14, 17]],
    ['extended/dominant11', [0, 4, 7, 10, 14, 17]],
    ['extended/minor11', [0, 3, 7, 10, 14, 17]],
    ['extended/major13', [0, 4, 7, 11, 14, 17, 21]],
    ['extended/dominant13', [0, 4, 7, 10, 14, 17, 21]],
    ['extended/minor13', [0, 3, 7, 10, 14, 17, 21]],
    ['alterations/7b9', [0, 4, 7, 10, 13]],
    ['alterations/7sharp9', [0, 4, 7, 10, 15]],
    ['alterations/7b5', [0, 4, 6, 10]],
    ['alterations/7sharp5', [0, 4, 8, 10]],
    ['alterations/add9', [0, 4, 7, 14]],
    ['alterations/minor_add9', [0, 3, 7, 14]],
    ['alterations/6', [0, 4, 7, 9]],
    ['alterations/minor6', [0, 3, 7, 9]]
  ]);

  /** Every chord in the table, with the category it is in. */
  function entries(): { key: string; intervals: number[]; steps: number[] }[] {
    return CHORD_CATEGORIES.flatMap(category =>
      category.chords.map(chord => ({
        key: `${category.id}/${chord.id}`,
        intervals: chord.intervals,
        steps: chord.steps
      }))
    );
  }

  it('holds every pre-existing chord on exactly the intervals it had', () => {
    const moved: string[] = [];
    const found = new Set<string>();

    for (const entry of entries()) {
      const before = BEFORE.get(entry.key);
      if (before === undefined) continue;

      found.add(entry.key);
      if (entry.intervals.join() !== before.join()) {
        moved.push(`${entry.key}: [${entry.intervals}] was [${before}]`);
      }
    }

    expect(moved).withContext(moved.join('\n')).toEqual([]);
    // And none of them merely vanished, which a comparison over what is present
    // could not see.
    expect([...BEFORE.keys()].filter(key => !found.has(key))).toEqual([]);
  });

  /** The new category, named so the count above cannot absorb an accident. */
  it('adds the altered and suspended shapes as a category of their own', () => {
    const altered = CHORD_CATEGORIES.find(category => category.id === 'altered');

    expect(altered).toBeDefined();
    expect(altered?.chords.map(chord => chord.id)).toEqual([
      'dominant9sharp11',
      'dominant13sharp11',
      'major9sharp11',
      'major13sharp11',
      'dominant7sus4',
      'dominant9sus4',
      'sixNine'
    ]);
  });

  it('gives every chord one step per interval', () => {
    const wrong = entries()
      .filter(entry => entry.steps.length !== entry.intervals.length)
      .map(entry => `${entry.key}: ${entry.steps.length} steps for ${entry.intervals.length} notes`);

    expect(wrong).withContext(wrong.join('\n')).toEqual([]);
  });

  /**
   * And every step is within a double accidental of the interval beside it,
   * which is what makes a step a spelling rather than a label.
   *
   * A note three semitones from where its letter naturally sounds cannot be
   * written on that letter at all - it would need a triple accidental, which
   * `spellAt` refuses - so a step that far out is a promise the spelling cannot
   * keep. The octave is folded away because a ninth is a second an octave up and
   * the letter is the same letter either way.
   */
  it('gives every chord a step its interval can be spelled on', () => {
    const wrong: string[] = [];

    for (const entry of entries()) {
      entry.intervals.forEach((interval, i) => {
        const step = entry.steps[i];
        const natural = STEP_INTERVALS[step % 7];
        const accidental = ((((interval - natural) % 12) + 12 + 6) % 12) - 6;

        if (Math.abs(accidental) > 2) {
          wrong.push(`${entry.key}: ${interval} on step ${step} needs ${accidental}`);
        }
      });
    }

    expect(wrong).withContext(wrong.join('\n')).toEqual([]);
  });

  /**
   * The sixth and the diminished seventh are the reason `steps` exists: nine
   * semitones over a C is an A in one and a B double flat in the other, and no
   * amount of arithmetic on the 9 can tell them apart.
   */
  it('spells one interval on two letters where the chord says so', () => {
    const six = CHORD_CATEGORIES.flatMap(c => c.chords).find(chord => chord.id === '6');
    const dim7 = CHORD_CATEGORIES.flatMap(c => c.chords).find(chord => chord.id === 'diminished7');

    expect(six?.intervals[3]).toBe(9);
    expect(six?.steps[3]).toBe(5);
    expect(dim7?.intervals[3]).toBe(9);
    expect(dim7?.steps[3]).toBe(6);
  });

  describe('findChordByIntervals', () => {
    it('finds a chord by the notes it is built from', () => {
      expect(findChordByIntervals([0, 4, 7])).toEqual({
        categoryId: 'triads',
        itemId: 'major'
      });
      expect(findChordByIntervals([0, 4, 7, 10, 14])).toEqual({
        categoryId: 'extended',
        itemId: 'dominant9'
      });
      expect(findChordByIntervals([0, 5, 7, 10])).toEqual({
        categoryId: 'altered',
        itemId: 'dominant7sus4'
      });
      expect(findChordByIntervals([0, 4, 7, 9, 14])).toEqual({
        categoryId: 'altered',
        itemId: 'sixNine'
      });
    });

    /**
     * A set the table does not hold lights nothing, which is the honest answer
     * and the one `chordFor` relies on: a chord with no entry is drawn as no
     * chord rather than as the nearest one.
     */
    it('finds nothing for a set the table does not hold', () => {
      expect(findChordByIntervals([0, 4, 7, 10, 13, 18])).toBeNull();
      expect(findChordByIntervals([])).toBeNull();
    });

    /**
     * Order is part of the identity, because a rotation is an *inversion*.
     *
     * The same three pitch classes starting from the third are a C major triad
     * in first inversion, and lighting `major` for it would be answering a
     * question about voicing with an answer about shape.
     */
    it('does not match a rotation of a chord it holds', () => {
      expect(findChordByIntervals([0, 3, 8])).toBeNull();
    });

    /**
     * The one interval set two entries share, and which of them wins.
     *
     * `augmented7` and `7sharp5` are both `[0, 4, 8, 10]` and both print `7#5` -
     * two names for one chord, in the table since long before this lookup. The
     * first match wins and the first is `augmented7`, which is the id the
     * progression's own `ChordQuality` carries: the fretboard lights exactly
     * what it lit when a quality name was handed over as a chord id.
     */
    it('resolves the table one duplicate the way the old lookup did', () => {
      expect(findChordByIntervals([0, 4, 8, 10])).toEqual({
        categoryId: 'seventh',
        itemId: 'augmented7'
      });
    });

    /** And apart from that pair, every entry is found as itself. */
    it('finds every entry in the table but the known duplicate', () => {
      const wrong: string[] = [];

      for (const category of CHORD_CATEGORIES) {
        for (const chord of category.chords) {
          if (category.id === 'alterations' && chord.id === '7sharp5') continue;

          const found = findChordByIntervals(chord.intervals);
          if (found?.categoryId !== category.id || found?.itemId !== chord.id) {
            wrong.push(`${category.id}/${chord.id} found ${found?.categoryId}/${found?.itemId}`);
          }
        }
      }

      expect(wrong).withContext(wrong.join('\n')).toEqual([]);
    });
  });
});
