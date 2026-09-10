import {
  CHORD_EXTENTS,
  MIN_NOTE_BEATS,
  SUSPENSIONS
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  RollNote,
  createDegreeSlot
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import {
  ChordExtent,
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  effectiveChord,
  isHeptatonic,
  noteCount
} from './progression-harmony';
import { MusicTheoryService } from './music-theory.service';
import {
  expressInKey,
  parseChord,
  recognise,
  structuralPitchClasses
} from './progression-recognise';

/**
 * Reading a chord back off the notes a slot is sounding.
 *
 * Every expectation below was worked through by hand against the chord tables
 * before it was run - a fixture written from the implementation's output tests
 * nothing - and each case names the arithmetic it rests on where that is not
 * obvious from the notes.
 *
 * The slots are built by the real pipeline: `createDegreeSlot` for the harmony
 * and `generateSlotNotes` for the notes, then edited. So a fixture that says "I
 * with its E dragged to F" really is the chord the app would have generated with
 * one note moved, and not a hand-written list that happens to look like one.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const C_HARMONIC_MINOR: ProgressionKey = {
  tonic: 0,
  scaleId: 'harmonicMinor',
  preferSharps: false
};

/** A slot on a degree of C major, with the notes the generator would give it. */
function degreeSlot(
  degree: number,
  overrides: Partial<ChordDegree> = {},
  key: ProgressionKey = C_MAJOR,
  scale: readonly number[] = MAJOR
): ChordSlot {
  const fresh = createDegreeSlot(degree, 0);
  if (fresh.harmony.kind !== 'degree') throw new Error('unreachable');

  const labelled: ChordSlot = {
    ...fresh,
    harmony: { kind: 'degree', degree: { ...fresh.harmony.degree, ...overrides } }
  };
  return { ...labelled, notes: [...generateSlotNotes(labelled, key, scale)] };
}

/** A block note filling the slot, as the generator writes one. */
function note(midi: number, startBeat = 0, lengthBeats = 4): RollNote {
  return { midi, startBeat, lengthBeats, velocity: 80 };
}

/** The same slot sounding a different set of notes: one pitch edit's worth. */
function sounding(slot: ChordSlot, midis: readonly number[]): ChordSlot {
  return { ...slot, notes: midis.map(midi => note(midi, 0, slot.lengthBeats)) };
}

/** The harmony fields of a degree, which is what a relabel is judged on. */
function harmonyOf(degree: ChordDegree): Partial<ChordDegree> {
  return {
    degree: degree.degree,
    alter: degree.alter,
    extent: degree.extent,
    quality: degree.quality,
    suspension: degree.suspension,
    extensions: degree.extensions
  };
}

const NO_EXTENSIONS = { ninth: null, eleventh: null, thirteenth: null };

/** A shorthand for the six harmony fields, defaulted to a plain triad. */
function harmony(overrides: Partial<ChordDegree> = {}): Partial<ChordDegree> {
  return {
    degree: 0,
    alter: 0,
    extent: 3,
    quality: null,
    suspension: 'none',
    extensions: NO_EXTENSIONS,
    ...overrides
  };
}

/** The one relabel a recognition carries, or a failure naming what came back. */
function relabelOf(slot: ChordSlot, before: readonly RollNote[], key = C_MAJOR, scale = MAJOR) {
  const result = recognise(before, slot, key, scale);
  if (result.kind !== 'relabel') throw new Error(`expected a relabel; got ${result.kind}`);
  return result;
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

// ---------------------------------------------------------------------------

describe('expressInKey', () => {
  /**
   * The design doc's first worked example. D♭ major is a semitone above the
   * tonic and a semitone below the second degree, so distance cannot choose:
   * what chooses is that {D♭, F, A♭} shares its F with the diatonic ii and
   * nothing at all with the tonic chord.
   */
  it('writes D flat major in C as flat II', () => {
    const identity = parseChord(new Set([1, 5, 8]), 1);
    expect(identity?.base).toBe('major');

    const written = expressInKey(identity!, MAJOR, 0, 1);
    expect(harmonyOf(written!)).toEqual(harmony({ degree: 1, alter: -1, quality: 'major' }));
  });

  /**
   * And the second, which the same rule sends the other way: {C♯, E, G} shares
   * its E and its G with the diatonic I, so it is a raised tonic rather than a
   * lowered supertonic.
   */
  it('writes C sharp diminished in C as sharp i dim', () => {
    const identity = parseChord(new Set([1, 4, 7]), 1);
    expect(identity?.base).toBe('diminished');

    const written = expressInKey(identity!, MAJOR, 0, 1);
    expect(harmonyOf(written!)).toEqual(harmony({ degree: 0, alter: 1, quality: 'diminished' }));
  });

  /**
   * A root that is a degree is written on that degree, which is the clause the
   * design doc leaves implicit and the sweep insisted on.
   *
   * `Imaj13` in C major sounds all seven notes of the key, so it shares three of
   * its notes with every degree's triad and shared notes cannot choose. On the
   * doc's stated pair of rules - most shared, then the flat side - it would come
   * back as a doubly-flattened second.
   */
  it('writes a chord rooted on a degree on that degree', () => {
    const thirteenth = chordPitchClasses(MAJOR, {
      degree: 0,
      alter: 0,
      extent: 13,
      quality: null,
      suspension: 'none',
      extensions: NO_EXTENSIONS
    });
    expect(thirteenth).toEqual([0, 4, 7, 11, 14, 17, 21]);

    const identity = parseChord(new Set(thirteenth.map(pitch => pitch % 12)), 0)!;
    expect(harmonyOf(expressInKey(identity, MAJOR, 0, 0)!)).toEqual(harmony({ extent: 13 }));
  });

  /** The inversion is the bass's position in the built stack. */
  it('reads the inversion off the bass', () => {
    const identity = parseChord(new Set([0, 4, 7]), 0)!;
    expect(expressInKey(identity, MAJOR, 0, 0)?.inversion).toBe(0);
    expect(expressInKey(identity, MAJOR, 0, 4)?.inversion).toBe(1);
    expect(expressInKey(identity, MAJOR, 0, 7)?.inversion).toBe(2);
  });

  /** A root more than a whole tone from every degree cannot be written here. */
  it('refuses a root no degree can reach', () => {
    // A whole-tone scale has no root more than a tone from a degree, so the
    // refusal is shown on the guard that does bite: a scale of the wrong size.
    const identity = parseChord(new Set([0, 4, 7]), 0)!;
    expect(expressInKey(identity, [0, 2, 4, 7, 9], 0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('recognise', () => {
  /** An octave is a register, not a harmony: the structural set did not move. */
  it('stays quiet when only the voicing moved', () => {
    const slot = degreeSlot(0);
    expect(slot.notes.map(n => n.midi)).toEqual([60, 64, 67]);

    const moved = sounding(slot, [72, 64, 67]);
    expect(recognise(slot.notes, moved, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /**
   * C E G with the E dragged to F. From C the intervals are {5, 7}: no third,
   * so the 5 is a sus4 over a perfect fifth. From F they are {2, 7} - a sus2 -
   * and from G {5, 10} with no fifth sounding, so a `V7sus4` that guessed.
   *
   * The complete parses are the first two, and the current root is C.
   */
  it('reads a suspension: I with E dragged to F is Isus4', () => {
    const slot = degreeSlot(0);
    const edited = sounding(slot, [60, 65, 67]);
    const { degree, alternates } = relabelOf(edited, slot.notes);

    expect(harmonyOf(degree)).toEqual(harmony({ suspension: 'sus4' }));
    expect(alternates.map(harmonyOf)).toContain(
      jasmine.objectContaining({ degree: 3, suspension: 'sus2' })
    );
  });

  /**
   * C E G plus a B♭. From C: third 4, fifth 7, seventh 10 - a dominant seventh,
   * which the key does not give on its tonic, so `quality` has to be pinned.
   * The other three roots leave an interval over and parse as nothing.
   */
  it('reads a flat seventh on I as I7, the secondary dominant', () => {
    const slot = degreeSlot(0);
    const edited = sounding(slot, [60, 64, 67, 70]);
    const { degree } = relabelOf(edited, slot.notes);

    expect(harmonyOf(degree)).toEqual(harmony({ extent: 7, quality: 'dominant7' }));
  });

  /**
   * D F A with the F raised. From D: third 4, fifth 7 - a major triad on the
   * second degree, which the key gives as minor, so `major` is pinned. From F♯
   * the shape is {3, 8}, which is no named chord; from A it is a sus4 with no
   * fifth sounding, and an incomplete parse loses to a complete one.
   */
  it('reads a raised third on ii as II', () => {
    const slot = degreeSlot(1);
    expect(slot.notes.map(n => n.midi)).toEqual([62, 65, 69]);

    const { degree } = relabelOf(sounding(slot, [62, 66, 69]), slot.notes);
    expect(harmonyOf(degree)).toEqual(harmony({ degree: 1, quality: 'major' }));
  });

  /**
   * G B D plus an F. The key's own seventh on the fifth degree is that F, so
   * every field stays `null` and the slot re-voices on a key change exactly as
   * a palette `V7` would.
   */
  it('reads V plus F as V7, with every field null', () => {
    const slot = degreeSlot(4);
    expect(slot.notes.map(n => n.midi)).toEqual([67, 71, 74]);

    const { degree } = relabelOf(sounding(slot, [67, 71, 74, 77]), slot.notes);
    expect(harmonyOf(degree)).toEqual(harmony({ degree: 4, extent: 7 }));
  });

  /**
   * The design's own tie, taken from the I side. C E G A is a C6 and an Am7 at
   * once - the same four notes - and both parses are complete, so what decides
   * is that this slot's root is already C.
   */
  it('reads I plus A as I6', () => {
    const slot = degreeSlot(0);
    const { degree, alternates } = relabelOf(sounding(slot, [60, 64, 67, 69]), slot.notes);

    expect(harmonyOf(degree)).toEqual(harmony({ extent: 7, quality: 'major6' }));
    expect(alternates.map(harmonyOf)).toContain(
      jasmine.objectContaining({ degree: 5, extent: 7, quality: null })
    );
  });

  /**
   * And from the vi side, with the added G in the bass - so the bass clause
   * would have rooted it on G if it came first. It does not: the G parse has no
   * fifth of its own and is incomplete, and proximity to the current root beats
   * the bass in any case.
   */
  it('reads vi plus G as vi7', () => {
    const slot = degreeSlot(5);
    expect(slot.notes.map(n => n.midi)).toEqual([69, 72, 76]);

    const { degree, alternates } = relabelOf(sounding(slot, [67, 69, 72, 76]), slot.notes);
    expect(harmonyOf(degree)).toEqual(harmony({ degree: 5, extent: 7 }));
    expect(alternates.map(harmonyOf)).toContain(
      jasmine.objectContaining({ degree: 0, extent: 7, quality: 'major6' })
    );
  });

  /**
   * G B D F A plus a C. From G the intervals are 4, 7, 10, 14 and 17 - a third
   * is present, so the C is an eleventh rather than a suspension, and every rung
   * below it is there. The key gives all six notes, so nothing is pinned.
   */
  it('reads V9 plus C as V11', () => {
    const slot = degreeSlot(4, { extent: 9 });
    expect(slot.notes.map(n => n.midi)).toEqual([67, 71, 74, 77, 81]);

    const { degree } = relabelOf(sounding(slot, [67, 71, 74, 77, 81, 84]), slot.notes);
    expect(harmonyOf(degree)).toEqual(harmony({ degree: 4, extent: 11 }));
  });

  /**
   * The same C, but replacing the B rather than joining it. With no third in
   * the set the C is a suspension, and the chord stops at the ninth.
   */
  it('reads V9 with its third moved to C as V9sus4', () => {
    const slot = degreeSlot(4, { extent: 9 });
    const { degree } = relabelOf(sounding(slot, [67, 72, 74, 77, 81]), slot.notes);

    expect(harmonyOf(degree)).toEqual(harmony({ degree: 4, extent: 9, suspension: 'sus4' }));
  });

  /**
   * C D G is a sus2 on C and a sus4 on G, and both are complete. Which one it
   * is depends on the slot it was played into, which is the whole of what the
   * proximity clause is for.
   */
  it('reads C D G as Isus2 from a I slot, and as Vsus4 from a V slot', () => {
    const tonic = degreeSlot(0);
    expect(harmonyOf(relabelOf(sounding(tonic, [60, 62, 67]), tonic.notes).degree))
      .toEqual(harmony({ suspension: 'sus2' }));

    const dominant = degreeSlot(4);
    expect(harmonyOf(relabelOf(sounding(dominant, [67, 72, 74]), dominant.notes).degree))
      .toEqual(harmony({ degree: 4, suspension: 'sus4' }));
  });

  /**
   * The fixture that reversed the design's tie-break order.
   *
   * B D F with an A♭ under it is a diminished seventh, and a diminished seventh
   * parses identically from all four of its notes. The bass is the A♭, so a
   * ranking that broke on the bass before proximity would relabel this slot
   * every time the user re-voiced it - four different numerals for one chord.
   */
  it('keeps vii dim as vii dim 7 when a diminished seventh is added below it', () => {
    const slot = degreeSlot(6, {}, C_HARMONIC_MINOR, HARMONIC_MINOR);
    expect(slot.notes.map(n => n.midi)).toEqual([71, 74, 77]);

    const edited = sounding(slot, [68, 71, 74, 77]);
    const { degree } = relabelOf(edited, slot.notes, C_HARMONIC_MINOR, HARMONIC_MINOR);

    expect(harmonyOf(degree)).toEqual(harmony({ degree: 6, extent: 7 }));
    expect(degree.inversion).toBe(3);
  });

  /**
   * The same four notes with no current root to keep: the bass clause is what
   * is left, and it roots the chord on the A♭ in the bass.
   *
   * The degree that A♭ is written on is `expressInKey`'s question, and A♭ is
   * the sixth degree of C harmonic minor outright - a root that is a degree is
   * written on that degree, whatever a neighbour shares with it. So it is that
   * degree with a diminished seventh pinned on it, and not the fifth raised.
   */
  it('roots a diminished seventh on the bass when there is no current root', () => {
    const detached: ChordSlot = {
      ...degreeSlot(6, {}, C_HARMONIC_MINOR, HARMONIC_MINOR),
      harmony: { kind: 'literal', reason: 'unrecognised' }
    };
    const edited = sounding(detached, [68, 71, 74, 77]);
    const { degree } = relabelOf(edited, [note(71), note(74), note(77)], C_HARMONIC_MINOR, HARMONIC_MINOR);

    // The root is the A♭ in the bass, whatever letter it is written on.
    const root = (HARMONIC_MINOR[degree.degree] + degree.alter + 12) % 12;
    expect(root).toBe(8);
    expect(harmonyOf(degree)).toEqual(
      harmony({ degree: 5, alter: 0, extent: 7, quality: 'diminished7' })
    );
  });

  /** C E B, with the G taken out. A missing fifth is the one omission allowed. */
  it('accepts an omitted fifth without relabelling', () => {
    const slot = degreeSlot(0, { extent: 7 });
    expect(slot.notes.map(n => n.midi)).toEqual([60, 64, 67, 71]);

    const edited = sounding(slot, [60, 64, 71]);
    expect(recognise(slot.notes, edited, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /**
   * The case the before-and-after rule exists for.
   *
   * A timing edit has already moved the E to the last sixteenth of the slot,
   * and timing edits never run the recogniser - so the slot still reads `I`
   * while only C and G are structural. Adding a sixteenth D changes nothing
   * structural, and the answer is silence. Comparing against what `harmony`
   * generates would have found {C, E, G} against {C, G} and relabelled the slot
   * on the strength of an edit two gestures ago.
   */
  it('ignores a passing tone after a timing edit moved a chord tone off the downbeat', () => {
    const slot = degreeSlot(0);
    const retimed: ChordSlot = {
      ...slot,
      notes: [note(60), note(64, 3.75, 0.25), note(67)]
    };
    expect([...structuralPitchClasses(retimed.notes, 4)].sort((a, b) => a - b)).toEqual([0, 7]);

    const withPassing: ChordSlot = {
      ...retimed,
      notes: [...retimed.notes, note(62, 1.5, 0.25)]
    };
    expect(recognise(retimed.notes, withPassing, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /**
   * C C♯ D. From C the C♯ is a ♭9 with no seventh under it; from C♯ and from D
   * there is no third and no suspension at all. Nothing parses, so the slot
   * keeps its notes and loses its numeral.
   */
  it('degrades a cluster to literal', () => {
    const slot = degreeSlot(0);
    expect(recognise(slot.notes, sounding(slot, [60, 61, 62]), C_MAJOR, MAJOR).kind)
      .toBe('literal');
  });

  /** The user said this slot is notes rather than a chord. That stands. */
  it('never re-reads a user-detached slot', () => {
    const slot = degreeSlot(0);
    const detached: ChordSlot = {
      ...sounding(slot, [60, 64, 67, 70]),
      harmony: { kind: 'literal', reason: 'user-detached' }
    };
    expect(recognise(slot.notes, detached, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /** `unrecognised` is not a one-way door: notes that parse again are a chord. */
  it('brings an unrecognised slot back when its notes parse again', () => {
    const slot = degreeSlot(0);
    const lost: ChordSlot = {
      ...slot,
      harmony: { kind: 'literal', reason: 'unrecognised' }
    };
    const { degree } = relabelOf(lost, sounding(lost, [60, 61, 62]).notes);
    expect(harmonyOf(degree)).toEqual(harmony());
  });

  /** A slot that was unrecognised and still is has not changed. */
  it('says nothing changed when an unrecognised slot still does not parse', () => {
    const slot = degreeSlot(0);
    const lost: ChordSlot = {
      ...sounding(slot, [60, 61, 62]),
      harmony: { kind: 'literal', reason: 'unrecognised' }
    };
    expect(recognise(slot.notes, lost, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /** No degrees to express anything as, so there is nothing to say. */
  it('stays quiet in a key that cannot stack thirds', () => {
    const slot = degreeSlot(0);
    const edited = sounding(slot, [60, 64, 67, 70]);
    expect(recognise(slot.notes, edited, C_MAJOR, [0, 2, 4, 7, 9]).kind).toBe('unchanged');
  });

  /** The relabel comes with the runners-up the chip offers, best first. */
  it('offers the next three parses as alternates', () => {
    const slot = degreeSlot(0);
    const { alternates } = relabelOf(sounding(slot, [60, 65, 67]), slot.notes);
    expect(alternates.length).toBeLessThanOrEqual(3);
    expect(alternates.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

/**
 * Generate a chord's notes, read them back, and get the same chord.
 *
 * This is the property the whole module is for: every chord the model can build
 * must survive the trip through `RollNote.midi` and back to a `ChordDegree` with
 * the same fields still `null`. `recognise` is asked with an empty set of
 * "before" notes so the quiet rule cannot answer for it, and against the slot's
 * own harmony so the current root is its own - which is the situation a user is
 * in when they edit one note of a chord and edit it back.
 *
 * ## What is swept, and what is sampled
 *
 * - **Every heptatonic scale the app offers**, at every degree, every extent and
 *   every suspension, with nothing overridden and nothing pinned.
 * - **The seven diatonic modes**, at every degree, with every named quality and
 *   every `alter` in -1..1.
 * - **The extension axis, sampled**: the seven diatonic modes at every degree,
 *   with one extension pinned at a time to each alteration a `ChordDegree` can
 *   store, at each extent that reaches it. Combinations of two and three pinned
 *   extensions at once are *not* swept, and neither is the extension axis
 *   crossed with the quality axis - the full product is 1.27 million chords and
 *   several minutes, where this spec has a five-second budget.
 *
 * ## Chords with no identity to preserve
 *
 * A chord whose own `effectiveChord` reads `base: 'other'` is skipped. It has no
 * name to come back with - the card prints `?` and the fretboard lights nothing
 * - so there is no round trip to make. There are between 21 and 52 of them per
 * extent across the 33 scales, pinned next door in
 * `progression-harmony.identity.spec.ts`.
 *
 * ## The two exception classes
 *
 * **Overloaded** - the class the plan named, and one clause wider than it was
 * written. A stack in which two notes fill one *role*: the same letter-step, or
 * the same pitch class. The plan listed the four the model reaches on purpose -
 * a sus4 at extent 11 and above, a sus2 at 9 and above, an `add9` above 7, an
 * added sixth under a thirteenth - and named the exotic-scale case where a
 * diatonic extension lands on a chord tone the chord already has. Reading starts
 * from a set of pitch classes, so the second copy is not there to be read, and
 * the chord comes back at the height of its distinct notes or not at all.
 *
 * The clause the plan did not have is the *letter-step* half. `add9` at extent 9
 * on a displaced root sounds two different ninths - the shape's own, a major
 * ninth above the moved root, and the key's, which the extent added above it -
 * and they are two distinct pitch classes filling one position in the stack. A
 * parse has one ninth to give. Same failure, one axis over: the model built a
 * chord with two notes in one role, and a reading has one slot for it.
 *
 * **Respelt.** One chord, two ways for the model to write it down. Two things
 * fall in here, and the sweep tells them apart from a bug by building both the
 * original and what came back and checking they sound exactly the same notes.
 *
 *  - **A redundant override dropped.** A `I` carrying `quality: 'major'` in a
 *    major key comes back with `quality: null`, because "as the key gives it" is
 *    the reading `expressInKey` prefers and the ranking counts. That is the
 *    feature rather than the exception - it is what makes a recognised chord
 *    re-voice on a key change - and it is why the sweep's own test is "sounds
 *    the same" rather than "stores the same".
 *  - **A displaced root renumbered.** ♭VII and ♯VI in C major are one chord, and
 *    `alter` is what lets the model say it twice. Notes carry no letters, so the
 *    recogniser cannot know which was meant and writes the one the ranking
 *    prefers.
 *
 * **No chord whose `alter` was 0 is ever renumbered,** and the sweep asserts it.
 * That is what makes the class safe rather than merely explicable: a chord on
 * its own degree comes back on its own degree, so nothing a user reaches through
 * the palette's diatonic rows can change numeral by having a note edited and
 * edited back. Only a root the model has *displaced* has a second numeral to be
 * moved to.
 *
 * A failure that is neither is a bug in the parse or in `expressInKey`, and the
 * sweep asserts there are none. Five were found this way while this spec was
 * being written, and every one is fixed in the module rather than exempted here:
 * the two rungs that needed backtracking (`OPENINGS` and `FIFTHS`), the eleventh
 * that a sus2 does not spend, the extension a suspension implies, and the order
 * `degreeCandidates` ranks a root's degrees in.
 */
describe('the round trip', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** The seven modes of the major scale, which is the sweep's dense axis. */
  const DIATONIC_MODES: readonly (readonly number[])[] = [0, 1, 2, 3, 4, 5, 6].map(mode =>
    [0, 1, 2, 3, 4, 5, 6].map(step => (MAJOR[(mode + step) % 7] - MAJOR[mode] + 12) % 12)
  );

  const KEY: ProgressionKey = { tonic: 0, scaleId: 'swept', preferSharps: true };

  type Outcome = 'unchanged' | 'overloaded' | 'respelt' | 'bug';

  const counts: Record<Outcome, number> = {
    unchanged: 0,
    overloaded: 0,
    respelt: 0,
    bug: 0
  };
  const bugs: string[] = [];
  /** A respelling of a chord that was never displaced would be a bug. */
  const respeltDiatonic: string[] = [];

  /** A stack as the set of pitch classes it sounds, which is all a slot plays. */
  function pitchClassesOf(stack: readonly number[]): Set<number> {
    return new Set(stack.map(pitch => ((pitch % 12) + 12) % 12));
  }

  function sameNotes(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
    return left.size === right.size && [...left].every(member => right.has(member));
  }

  /** One chord: build it, read it back, and say which of the four it was. */
  function roundTrip(scale: readonly number[], overrides: Partial<ChordDegree>): void {
    const slot = degreeSlot(overrides.degree ?? 0, overrides, KEY, scale);
    if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

    const original = slot.harmony.degree;
    const identity = effectiveChord(scale, original);
    if (identity.base === 'other') return;

    const result = recognise([], slot, KEY, scale);
    if (result.kind === 'unchanged') {
      counts.unchanged++;
      return;
    }

    const stack = chordPitchClasses(scale, original);
    const sounded = pitchClassesOf(stack);

    // Two notes of the stack in one *role* - one letter-step, or one pitch
    // class. Nothing downstream can recover the second, because the reading
    // starts from a set.
    const roles = new Set(identity.steps.map(step => step % 7));
    if (roles.size < identity.steps.length || sounded.size < stack.length) {
      counts.overloaded++;
      return;
    }

    if (
      result.kind === 'relabel' &&
      sameNotes(sounded, pitchClassesOf(chordPitchClasses(scale, result.degree)))
    ) {
      counts.respelt++;
      const renumbered =
        result.degree.degree !== original.degree || result.degree.alter !== original.alter;
      if (original.alter === 0 && renumbered && respeltDiatonic.length < 10) {
        respeltDiatonic.push(
          `${JSON.stringify(harmonyOf(original))} on [${scale}] -> ` +
            JSON.stringify(harmonyOf(result.degree))
        );
      }
      return;
    }

    counts.bug++;
    if (bugs.length < 10) {
      bugs.push(
        `${JSON.stringify(harmonyOf(original))} on [${scale}] -> ` +
          (result.kind === 'relabel' ? JSON.stringify(harmonyOf(result.degree)) : 'literal')
      );
    }
  }

  it('reads every chord the model builds back as the chord it built', () => {
    for (const scale of APP_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of CHORD_EXTENTS) {
          for (const suspension of SUSPENSIONS) {
            roundTrip(scale, { degree, extent, suspension });
          }
        }
      }
    }

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const quality of Object.keys(QUALITY_INTERVALS) as NamedQuality[]) {
          for (const alter of [-1, 0, 1]) {
            for (const extent of CHORD_EXTENTS) {
              roundTrip(scale, { degree, extent, alter, quality });
            }
          }
        }
      }
    }

    // The extension axis, one pin at a time. `extent` is the single height
    // control, so each alteration is only swept at the extents that reach it.
    const pins: readonly { extensions: Partial<Record<string, number>>; from: ChordExtent }[] = [
      ...[-1, 0, 1].map(ninth => ({ extensions: { ninth }, from: 9 as ChordExtent })),
      ...[0, 1].map(eleventh => ({ extensions: { eleventh }, from: 11 as ChordExtent })),
      ...[-1, 0].map(thirteenth => ({ extensions: { thirteenth }, from: 13 as ChordExtent }))
    ];

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const pin of pins) {
          for (const extent of CHORD_EXTENTS.filter(candidate => candidate >= pin.from)) {
            roundTrip(scale, {
              degree,
              extent,
              extensions: { ...NO_EXTENSIONS, ...pin.extensions }
            });
          }
        }
      }
    }

    expect(bugs.join('\n')).withContext('outside both exception classes').toBe('');
    expect(counts.bug).toBe(0);

    // A chord on its own degree comes back on its own degree. Only a root the
    // model displaced has a second numeral for the ranking to move it to.
    expect(respeltDiatonic.join('\n')).withContext('renumbered with alter 0').toBe('');

    // Enough chords, and enough of them exact, that a sweep silently reduced to
    // nothing would fail here rather than pass.
    expect(counts.unchanged + counts.overloaded + counts.respelt).toBeGreaterThan(12000);
    expect(counts.unchanged).toBeGreaterThan(4000);

    // Printed rather than pinned: the two exception classes are characterised by
    // what they are, not by how many of them there happen to be, and a number
    // here would be a figure to update rather than a rule to check. Measured on
    // 2026-09-10: 5537 exact, 1866 overloaded, 5565 respelt, 0 outside.
    // eslint-disable-next-line no-console
    console.log('round trip:', JSON.stringify(counts));
  });

  /** `EXTENT_BY_LENGTH` in the module is this table read the other way. */
  it('maps every stack height back to the extent that produced it', () => {
    for (const extent of CHORD_EXTENTS) {
      const parsed = parseChord(
        new Set(chordPitchClasses(MAJOR, {
          degree: 0,
          alter: 0,
          extent,
          quality: null,
          suspension: 'none',
          extensions: NO_EXTENSIONS
        }).map(pitch => ((pitch % 12) + 12) % 12)),
        0
      );
      expect(parsed?.intervals.length).toBe(noteCount(extent));
      expect(parsed?.extent).toBe(extent);
    }
  });
});

// ---------------------------------------------------------------------------

describe('recognise: speed', () => {
  /**
   * Recognition runs once per pitch gesture, so its budget is a pointerup. The
   * figure recorded in the module header comes from this measurement; the
   * assertion is deliberately loose, because a tight one on a shared machine is
   * a flaky test rather than a guarantee.
   */
  it('reads a thirteenth chord in well under a millisecond', () => {
    const slot = degreeSlot(0, {
      extent: 13,
      extensions: { ninth: null, eleventh: 1, thirteenth: null }
    });
    expect(slot.notes.length).toBe(7);

    const runs = 2000;
    const started = performance.now();
    for (let i = 0; i < runs; i++) recognise([], slot, C_MAJOR, MAJOR);
    const each = (performance.now() - started) / runs;

    // eslint-disable-next-line no-console
    console.log(`recognise: ${(each * 1000).toFixed(1)}us per call on a 13th chord`);
    expect(each).toBeLessThan(1);
  });
});
