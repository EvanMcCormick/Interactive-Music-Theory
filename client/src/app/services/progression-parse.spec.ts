import { MIN_NOTE_BEATS } from '../models/progression-normalize';
import { RollNote } from '../models/progression.model';
import { parseChord, structuralPitchClasses } from './progression-parse';

/**
 * Reading notes: which of a slot's notes are the chord, and what chord they are.
 *
 * The reading half of the `notes -> harmony` arrow, tested with no key in sight -
 * every expectation here is a set of semitones in and a shape out. What a key
 * makes of the result is `progression-recognise.spec.ts`, which is also where
 * the round-trip sweep over every chord the model builds lives.
 *
 * Every expectation below was worked through by hand against the chord tables
 * before it was run - a fixture written from the implementation's output tests
 * nothing - and each case names the arithmetic it rests on where that is not
 * obvious from the notes.
 */

/** A block note filling the slot, as the generator writes one. */
function note(midi: number, startBeat = 0, lengthBeats = 4): RollNote {
  return { midi, startBeat, lengthBeats, velocity: 80 };
}

// ---------------------------------------------------------------------------

describe('structuralPitchClasses', () => {
  it('reads a block chord', () => {
    const chord = [note(60), note(64), note(67)];
    expect([...structuralPitchClasses(chord, 4)].sort()).toEqual([0, 4, 7]);
  });

  /**
   * C E G C E G C E, eighths. Only the first C is on the downbeat; the rest are
   * kept by their summed time. C sounds at 0, 1.5 and 3 for half a beat each -
   * 1.5 beats - E at 0.5, 2 and 3.5 for the same, and G at 1 and 2.5 for 1.0,
   * which is exactly the quarter of a four-beat slot the threshold asks for.
   */
  it('keeps every tone of an eighth-note arpeggio', () => {
    const cycle = [60, 64, 67, 72, 76, 79, 84, 88];
    const arpeggio = cycle.map((midi, i) => note(midi, i * 0.5, 0.5));
    expect([...structuralPitchClasses(arpeggio, 4)].sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  /**
   * C E G E, quarters. The G sounds for exactly one beat of four, which is the
   * boundary the threshold is chosen to include: tightening it past a quarter
   * would lose the fifth of a quarter-note arpeggio, and losing a chord tone is
   * a worse error than keeping a passing one.
   */
  it('keeps every tone of a quarter-note arpeggio', () => {
    const arpeggio = [note(60, 0, 1), note(64, 1, 1), note(67, 2, 1), note(64, 3, 1)];
    expect([...structuralPitchClasses(arpeggio, 4)].sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  /** A sixteenth is a quarter of a beat, a sixteenth of the slot. Not structural. */
  it('drops a sixteenth passing tone', () => {
    const chord = [note(60), note(64), note(67), note(62, 1.5, 0.25)];
    expect(structuralPitchClasses(chord, 4).has(2)).toBe(false);
  });

  /**
   * A D starting on the last half-beat and running four beats long sounds for
   * 0.5 beats *inside* a four-beat slot and 3.5 beats after it. Counting the
   * overhang would make it structural at 4.0 beats and let a note that mostly
   * belongs to the next slot decide this one's chord.
   */
  it('counts no time past the end of the slot', () => {
    const chord = [note(60), note(62, 3.5, 4)];
    expect([...structuralPitchClasses(chord, 4)]).toEqual([0]);
    expect([...structuralPitchClasses(chord, 8)].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  /** A note inside the first grid step is on the downbeat as far as a user is. */
  it('reads a note nudged by one grid step as sounding at the downbeat', () => {
    const nudged = [note(62, MIN_NOTE_BEATS / 2, 0.25)];
    expect([...structuralPitchClasses(nudged, 4)]).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------

describe('parseChord', () => {
  /** The height ladder: an eleventh with no ninth under it is no chord. */
  it('refuses a rung whose rungs below are missing', () => {
    // C E G F - the eleventh with no seventh and no ninth.
    expect(parseChord(new Set([0, 4, 7, 5]), 0)).toBeNull();
    // C E G B D F - every rung present, so the same F is an eleventh.
    expect(parseChord(new Set([0, 4, 7, 11, 2, 5]), 0)?.extent).toBe(11);
  });

  /** No third and no suspension is nothing this model can put in position 1. */
  it('refuses a chord with no third and no suspension', () => {
    expect(parseChord(new Set([0, 7]), 0)).toBeNull();
    expect(parseChord(new Set([0, 7, 10]), 0)).toBeNull();
  });

  /** The fifth is the one omission accepted, and it is filled in. */
  it('fills an absent fifth in and says that it did', () => {
    const parsed = parseChord(new Set([0, 4, 10]), 0);
    expect(parsed?.intervals).toEqual([0, 4, 7, 10]);
    expect(parsed?.complete).toBe(false);
    expect(parseChord(new Set([0, 4, 7, 10]), 0)?.complete).toBe(true);
  });

  /**
   * Nine semitones is a diminished seventh over a ♭5 and a minor third and an
   * added sixth everywhere else, and the shape settles it rather than a branch.
   */
  it('reads nine semitones as a seventh or a sixth by the shape under it', () => {
    expect(parseChord(new Set([0, 3, 6, 9]), 0)?.base).toBe('diminished7');
    expect(parseChord(new Set([0, 4, 7, 9]), 0)?.base).toBe('major6');
    expect(parseChord(new Set([0, 3, 7, 9]), 0)?.base).toBe('minor6');
  });

  /** A ninth with no seventh under it is an added ninth, not a ninth chord. */
  it('reads a ninth with no seventh as an added ninth', () => {
    const parsed = parseChord(new Set([0, 4, 7, 2]), 0);
    expect(parsed?.base).toBe('add9');
    expect(parsed?.intervals).toEqual([0, 4, 7, 14]);
    expect(parsed?.extent).toBe(7);
  });

  /** With a major third present, three semitones is a raised ninth. */
  it('reads three semitones over a major third as a sharp ninth', () => {
    const parsed = parseChord(new Set([0, 4, 7, 10, 3]), 0);
    expect(parsed?.intervals).toEqual([0, 4, 7, 10, 15]);
    expect(parsed?.ninth).toBe(1);
  });

  /** The root has to be sounding for the chord to be read from it. */
  it('refuses a root that is not in the set', () => {
    expect(parseChord(new Set([0, 4, 7]), 1)).toBeNull();
  });

  /**
   * `OPENINGS` backtracking. Harmonic minor's `vi` suspended at extent 9 is
   * A♭ D♭ E♭ G B♮ - a sus4 with a major seventh and a ♯9, and that ♯9 is three
   * semitones above the root, which is where a minor third lives. Read as the
   * third it makes a minor-major seventh and strands the D♭; read as the ♯9 it
   * is the chord that was built. Preferring the third is only a preference.
   */
  it('falls back to a suspension when the third reading strands a note', () => {
    const parsed = parseChord(new Set([0, 5, 7, 11, 3]), 0);
    expect(parsed?.suspension).toBe('sus4');
    expect(parsed?.intervals).toEqual([0, 5, 7, 11, 15]);
  });

  /**
   * `FIFTHS` backtracking. An augmented seventh raised to an eleventh sounds a
   * ♯5 and a ♯11, eight semitones and six, and six is also where a ♭5 lives.
   * Taking the six for the fifth strands the eight, which is nothing else.
   */
  it('falls back to a raised fifth when a flattened one strands a note', () => {
    const parsed = parseChord(new Set([0, 4, 8, 10, 3, 6]), 0);
    expect(parsed?.intervals).toEqual([0, 4, 8, 10, 15, 18]);
    expect(parsed?.base).toBe('augmented7');
  });

  /**
   * A sus2 sounds the natural ninth's own pitch class, so a suspended chord
   * tall enough to reach its eleventh does not sound a separate ninth for the
   * ladder to see. C major's `IVsus2` at extent 11 is F G C E A B - the G is
   * both the suspension and the ninth - and the ninth is implied rather than
   * demanded, so the B is reachable as a ♯11.
   */
  it('implies the ninth a suspended second is already sounding', () => {
    const parsed = parseChord(new Set([0, 2, 7, 11, 6]), 0);
    expect(parsed?.suspension).toBe('sus2');
    expect(parsed?.intervals).toEqual([0, 2, 7, 11, 14, 18]);
    expect(parsed?.extent).toBe(11);
  });

  /**
   * And the same chord one rung short does not grow a ninth it has no use for:
   * the implication only fires where something above it is waiting.
   */
  it('does not imply a ninth with nothing above it', () => {
    expect(parseChord(new Set([0, 2, 7, 11]), 0)?.extent).toBe(7);
  });

  /** A suspended chord is read as a suspension of the shape above the third. */
  it('reads the base with a third put back', () => {
    expect(parseChord(new Set([0, 5, 7]), 0)?.base).toBe('major');
    expect(parseChord(new Set([0, 5, 7, 10]), 0)?.base).toBe('dominant7');
    expect(parseChord(new Set([0, 2, 7]), 0)?.suspension).toBe('sus2');
  });
});
