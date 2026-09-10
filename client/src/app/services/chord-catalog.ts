import { ChordCategory } from '../models/music-theory.model';

/**
 * Every chord the app knows how to draw, and the one way of finding one by its
 * notes.
 *
 * Lifted out of `music-theory.service.ts` when M3 Task 5 added a category to it:
 * that file was already 48 lines over the project's 1000-line cap, and a table
 * of reference data is the part of it that is not a service at all - no state,
 * no subject, no injector, just what a chord is. The precedent is
 * `circle-of-fifths.data.ts`, which came out of the same file for the same
 * reason and is imported back into it the same way.
 *
 * **The arrays moved and not one of them changed**, which is the project's
 * standing rule on reference data and is asserted rather than promised:
 * `chord-catalog.spec.ts` holds every pre-existing entry's intervals written out
 * a second time and compares. A move is exactly the kind of change that can
 * quietly reorder or drop a member, so the guardrail is worth more here than in
 * the file it left.
 *
 * ## `steps`, and why semitones could not settle it
 *
 * Each entry now carries the letter each of its notes is written on, counted
 * from the root: a third is two letters up, a seventh six, a ninth one. That is
 * not derivable from the intervals, which is the whole reason it is stored -
 * nine semitones above the root is a **sixth** in `6` and a **seventh** in
 * `diminished7`, spelled A and B♭♭ on a C root. A chord tone spelled from its
 * interval alone gets one of those wrong whichever way the guess goes.
 *
 * `progression-harmony.ts` derives the same fact for a chord it has just built,
 * from the position in the stack; this is the same fact for a chord that was
 * only ever written down. The two agree by construction on every shape they
 * share, and `chord-catalog.spec.ts` pins that each step is within a double
 * accidental of the interval beside it - which is the property that makes a step
 * a spelling rather than a label.
 */

/**
 * The natural interval each letter step names, an octave folded away: a second
 * is 2 semitones, a fourth 5, a sixth 9.
 *
 * Exported for the spec that checks every entry against it. It is the major
 * scale read as a table of steps, which is what a letter step *is* - the C major
 * scale is the seven letters with no accidentals at all.
 */
export const STEP_INTERVALS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * The chord table.
 *
 * The four original categories are unchanged. `altered` is M3 Task 5's, and it
 * holds what the progression's chord model can now build and this table lacked -
 * see the design doc's "The fretboard is lit by interval set". Added, never
 * changed, per the guardrail above.
 */
export const CHORD_CATEGORIES: ChordCategory[] = [
  {
    id: 'triads',
    name: 'Triads',
    chords: [
      { id: 'major', name: 'Major', intervals: [0, 4, 7], steps: [0, 2, 4], symbol: '' },
      { id: 'minor', name: 'Minor', intervals: [0, 3, 7], steps: [0, 2, 4], symbol: 'm' },
      { id: 'diminished', name: 'Diminished', intervals: [0, 3, 6], steps: [0, 2, 4], symbol: 'dim' },
      { id: 'augmented', name: 'Augmented', intervals: [0, 4, 8], steps: [0, 2, 4], symbol: 'aug' },
      { id: 'sus2', name: 'Suspended 2nd', intervals: [0, 2, 7], steps: [0, 1, 4], symbol: 'sus2' },
      { id: 'sus4', name: 'Suspended 4th', intervals: [0, 5, 7], steps: [0, 3, 4], symbol: 'sus4' }
    ]
  },
  {
    id: 'seventh',
    name: 'Seventh Chords',
    chords: [
      { id: 'major7', name: 'Major 7th', intervals: [0, 4, 7, 11], steps: [0, 2, 4, 6], symbol: 'maj7' },
      { id: 'dominant7', name: 'Dominant 7th', intervals: [0, 4, 7, 10], steps: [0, 2, 4, 6], symbol: '7' },
      { id: 'minor7', name: 'Minor 7th', intervals: [0, 3, 7, 10], steps: [0, 2, 4, 6], symbol: 'm7' },
      { id: 'minorMajor7', name: 'Minor Major 7th', intervals: [0, 3, 7, 11], steps: [0, 2, 4, 6], symbol: 'mMaj7' },
      // Nine semitones, and a *seventh* rather than the sixth the same interval
      // is in `6` below. A diminished seventh is spelled B♭♭ over C: the shape
      // is four stacked minor thirds, so every note is a rung of the stack.
      { id: 'diminished7', name: 'Diminished 7th', intervals: [0, 3, 6, 9], steps: [0, 2, 4, 6], symbol: 'dim7' },
      { id: 'halfDiminished7', name: 'Half Diminished 7th', intervals: [0, 3, 6, 10], steps: [0, 2, 4, 6], symbol: 'm7b5' },
      { id: 'augmented7', name: 'Augmented 7th', intervals: [0, 4, 8, 10], steps: [0, 2, 4, 6], symbol: '7#5' },
      { id: 'augmentedMajor7', name: 'Augmented Major 7th', intervals: [0, 4, 8, 11], steps: [0, 2, 4, 6], symbol: 'maj7#5' }
    ]
  },
  {
    id: 'extended',
    name: 'Extended Chords',
    chords: [
      { id: 'major9', name: 'Major 9th', intervals: [0, 4, 7, 11, 14], steps: [0, 2, 4, 6, 1], symbol: 'maj9' },
      { id: 'dominant9', name: 'Dominant 9th', intervals: [0, 4, 7, 10, 14], steps: [0, 2, 4, 6, 1], symbol: '9' },
      { id: 'minor9', name: 'Minor 9th', intervals: [0, 3, 7, 10, 14], steps: [0, 2, 4, 6, 1], symbol: 'm9' },
      { id: 'major11', name: 'Major 11th', intervals: [0, 4, 7, 11, 14, 17], steps: [0, 2, 4, 6, 1, 3], symbol: 'maj11' },
      { id: 'dominant11', name: 'Dominant 11th', intervals: [0, 4, 7, 10, 14, 17], steps: [0, 2, 4, 6, 1, 3], symbol: '11' },
      { id: 'minor11', name: 'Minor 11th', intervals: [0, 3, 7, 10, 14, 17], steps: [0, 2, 4, 6, 1, 3], symbol: 'm11' },
      { id: 'major13', name: 'Major 13th', intervals: [0, 4, 7, 11, 14, 17, 21], steps: [0, 2, 4, 6, 1, 3, 5], symbol: 'maj13' },
      { id: 'dominant13', name: 'Dominant 13th', intervals: [0, 4, 7, 10, 14, 17, 21], steps: [0, 2, 4, 6, 1, 3, 5], symbol: '13' },
      { id: 'minor13', name: 'Minor 13th', intervals: [0, 3, 7, 10, 14, 17, 21], steps: [0, 2, 4, 6, 1, 3, 5], symbol: 'm13' }
    ]
  },
  {
    id: 'alterations',
    name: 'Altered Chords',
    chords: [
      { id: '7b9', name: '7th flat 9', intervals: [0, 4, 7, 10, 13], steps: [0, 2, 4, 6, 1], symbol: '7b9' },
      { id: '7sharp9', name: '7th sharp 9', intervals: [0, 4, 7, 10, 15], steps: [0, 2, 4, 6, 1], symbol: '7#9' },
      { id: '7b5', name: '7th flat 5', intervals: [0, 4, 6, 10], steps: [0, 2, 4, 6], symbol: '7b5' },
      { id: '7sharp5', name: '7th sharp 5', intervals: [0, 4, 8, 10], steps: [0, 2, 4, 6], symbol: '7#5' },
      { id: 'add9', name: 'Add 9', intervals: [0, 4, 7, 14], steps: [0, 2, 4, 1], symbol: 'add9' },
      { id: 'minor_add9', name: 'Minor Add 9', intervals: [0, 3, 7, 14], steps: [0, 2, 4, 1], symbol: 'madd9' },
      // Nine semitones as a *sixth*, against `diminished7` above. See the header.
      { id: '6', name: '6th', intervals: [0, 4, 7, 9], steps: [0, 2, 4, 5], symbol: '6' },
      { id: 'minor6', name: 'Minor 6th', intervals: [0, 3, 7, 9], steps: [0, 2, 4, 5], symbol: 'm6' }
    ]
  },
  {
    /**
     * What the progression can build and the four categories above could not
     * name a set of notes for.
     *
     * Two shapes the M3 plan lists are **not** here, and their absence is the
     * point of the whole category: `7b9` and `7sharp9` are already in
     * `alterations` on exactly the intervals the plan gives them, and a second
     * entry on one interval set would make `findChordByIntervals` a first-match
     * rather than a lookup. Added to what the table lacks, not to what it has.
     */
    id: 'altered',
    name: 'Altered & Suspended',
    chords: [
      { id: 'dominant9sharp11', name: 'Dominant 9th sharp 11', intervals: [0, 4, 7, 10, 14, 18], steps: [0, 2, 4, 6, 1, 3], symbol: '9#11' },
      { id: 'dominant13sharp11', name: 'Dominant 13th sharp 11', intervals: [0, 4, 7, 10, 14, 18, 21], steps: [0, 2, 4, 6, 1, 3, 5], symbol: '13#11' },
      { id: 'major9sharp11', name: 'Major 9th sharp 11', intervals: [0, 4, 7, 11, 14, 18], steps: [0, 2, 4, 6, 1, 3], symbol: 'maj9#11' },
      { id: 'major13sharp11', name: 'Major 13th sharp 11', intervals: [0, 4, 7, 11, 14, 18, 21], steps: [0, 2, 4, 6, 1, 3, 5], symbol: 'maj13#11' },
      { id: 'dominant7sus4', name: 'Dominant 7th sus 4', intervals: [0, 5, 7, 10], steps: [0, 3, 4, 6], symbol: '7sus4' },
      { id: 'dominant9sus4', name: 'Dominant 9th sus 4', intervals: [0, 5, 7, 10, 14], steps: [0, 3, 4, 6, 1], symbol: '9sus4' },
      { id: 'sixNine', name: '6/9', intervals: [0, 4, 7, 9, 14], steps: [0, 2, 4, 5, 1], symbol: '6/9' }
    ]
  }
];

/**
 * The chord category and id whose intervals are exactly these, or null.
 *
 * Replaces the correspondence the progression used to lean on, where a quality
 * name happened to be a chord id. Matching intervals makes it a lookup, and
 * lights every chord the table holds rather than the twelve whose names match.
 *
 * **Exact and ordered**, not a set comparison. A chord's intervals are a stack
 * read from the bottom up and the same pitch classes in a different order are a
 * different voicing of it, which is `inversion`'s business and not this
 * function's. `ChordIdentity.intervals` arrives ascending from root position for
 * exactly that reason.
 *
 * Chord categories only, on `findChordCategory`'s argument: a scale is not a
 * chord, and `[0, 4, 7]` matching some scale's first three degrees would light a
 * scale where a chord was asked for.
 *
 * **The first match wins, and one collision is pre-existing.** `augmented7` in
 * `seventh` and `7sharp5` in `alterations` are both `[0, 4, 8, 10]` with the
 * symbol `7#5` - two names for one chord, in the table since before this
 * function existed. Order decides it and the order gives `augmented7`, which is
 * the id the progression's own `ChordQuality` carries, so the fretboard lights
 * exactly what it lit when the quality was handed over as an id.
 */
export function findChordByIntervals(
  intervals: readonly number[]
): { categoryId: string; itemId: string } | null {
  if (intervals.length === 0) return null;

  for (const category of CHORD_CATEGORIES) {
    for (const chord of category.chords) {
      if (
        chord.intervals.length === intervals.length &&
        chord.intervals.every((interval, i) => interval === intervals[i])
      ) {
        return { categoryId: category.id, itemId: chord.id };
      }
    }
  }

  return null;
}
