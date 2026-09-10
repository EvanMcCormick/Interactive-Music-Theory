import { CHORD_EXTENTS, SUSPENSIONS } from '../models/progression-normalize';
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
import { parseChord, structuralPitchClasses } from './progression-parse';
import { expressInKey, recognise } from './progression-recognise';

/**
 * Writing a chord back into the key a slot is in.
 *
 * The other half is `progression-parse.spec.ts` - which notes are the chord, and
 * what chord a bare set of semitones makes - and the parse is used here as the
 * fixture builder it is: a chord is spelled out as pitch classes, parsed, and
 * then asked what numeral this key gives it.
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

  /**
   * The ruling of 2026-09-10: keep the numeral the user picked.
   *
   * ♯I and ♭II in C are one root written twice, and `expressInKey` on its own
   * picks ♭II - {C♯, E♯, G♯} shares its F with the diatonic ii and nothing with
   * the tonic triad, which is the design doc's own worked example. But this slot
   * was *already* ♯I, and the user has dragged its fifth away and back: a chord
   * whose root never moved keeps the numeral it was given.
   */
  it('keeps a chromatic numeral when the root has not moved', () => {
    const slot = degreeSlot(0, { alter: 1, quality: 'major' });
    expect(slot.notes.map(n => n.midi)).toEqual([61, 65, 68]);

    // The fifth dragged down a semitone and back, so the quiet rule cannot
    // answer: the structural set really did change and then change back.
    const dragged = sounding(slot, [61, 65, 67]).notes;
    expect(recognise(dragged, slot, C_MAJOR, MAJOR).kind).toBe('unchanged');
  });

  /**
   * And with no numeral to consult, the ordinary rule decides - which is the
   * same three notes coming back as ♭II. A `literal` slot has no history, and
   * `expressInKey` is left to spell the root on the evidence in the notes.
   */
  it('writes the same root as flat II when the slot has no numeral to keep', () => {
    const slot = degreeSlot(0, { alter: 1, quality: 'major' });
    const detached: ChordSlot = {
      ...slot,
      harmony: { kind: 'literal', reason: 'unrecognised' }
    };

    const { degree } = relabelOf(detached, sounding(slot, [61, 65, 67]).notes);
    expect(harmonyOf(degree)).toEqual(harmony({ degree: 1, alter: -1, quality: 'major' }));
  });

  /**
   * The clause is about the root and nothing above it. ♯I with a B added is a
   * dominant seventh on the same root, so the numeral stays and the shape is
   * re-read - and the spelling the clause displaced is exactly what the chip
   * should offer a user who did mean ♭II.
   */
  it('keeps the numeral while re-reading everything above the root', () => {
    const slot = degreeSlot(0, { alter: 1, quality: 'major' });
    const { degree, alternates } = relabelOf(sounding(slot, [61, 65, 68, 71]), slot.notes);

    expect(harmonyOf(degree)).toEqual(
      harmony({ degree: 0, alter: 1, extent: 7, quality: 'dominant7' })
    );
    expect(alternates.map(harmonyOf)).toContain(
      jasmine.objectContaining({ degree: 1, alter: -1, quality: 'dominant7' })
    );
  });

  /**
   * A root that genuinely moved is renumbered, which is what the clause is
   * narrow enough to allow: ♯I with its root dragged up a semitone is a D major
   * triad, and no previous numeral names D.
   */
  it('renumbers when the root itself moved', () => {
    const slot = degreeSlot(0, { alter: 1, quality: 'major' });
    const { degree } = relabelOf(sounding(slot, [62, 66, 69]), slot.notes);

    expect(harmonyOf(degree)).toEqual(harmony({ degree: 1, alter: 0, quality: 'major' }));
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
 *    recogniser cannot know from them which was meant - and the ruling of
 *    2026-09-10 is that it should not have to guess: the numeral the slot is
 *    already carrying decides, so this half of the class is now **empty on a
 *    root that did not move**, which is every root the sweep sends round. It was
 *    3,136 of the 5,565 before the clause, and 1,911 of those now come back
 *    field for field rather than respelt at all.
 *
 * Two assertions hold the class down, and the second is the ruling's:
 *
 *  - **No chord whose `alter` was 0 is ever renumbered.** A chord on its own
 *    degree comes back on its own degree, so nothing a user reaches through the
 *    palette's diatonic rows can change numeral by having a note edited and
 *    edited back.
 *  - **No chord whose root did not move is renumbered at all**, diatonic or
 *    chromatic, which is the wider statement the clause makes true. The root a
 *    chord came back on is read with `effectiveChord`, the same way the original
 *    one is, so the two are compared as pitch classes rather than as spellings -
 *    which is the whole point: it is the *spelling* that is being preserved.
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
  /**
   * The respelt class split in two: a chord that came back on another numeral,
   * against one that came back on its own numeral with a field the key already
   * gives no longer pinned. Since the ruling of 2026-09-10 the first half is
   * only reachable where the root moved, and the sweep never moves one.
   */
  const respelt = { renumbered: 0, sameNumeral: 0 };
  /** A respelling of a chord that was never displaced would be a bug. */
  const respeltDiatonic: string[] = [];
  /** And so, since the ruling, would any renumbering of an unmoved root. */
  const respeltInPlace: string[] = [];

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
      if (renumbered) respelt.renumbered++;
      else respelt.sameNumeral++;

      const trace =
        `${JSON.stringify(harmonyOf(original))} on [${scale}] -> ` +
        JSON.stringify(harmonyOf(result.degree));

      if (original.alter === 0 && renumbered && respeltDiatonic.length < 10) {
        respeltDiatonic.push(trace);
      }
      // The root the chord came back on, read the same way the original's was.
      // Equal roots mean the numeral moved and the chord did not, which is what
      // the ruling of 2026-09-10 says may no longer happen.
      if (
        renumbered &&
        effectiveChord(scale, result.degree).root === identity.root &&
        respeltInPlace.length < 10
      ) {
        respeltInPlace.push(trace);
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

    // And the ruling's own assertion, which subsumes it: a chord that came back
    // rooted where it started keeps the numeral it started on, whether or not
    // that numeral carried an accidental.
    expect(respeltInPlace.join('\n')).withContext('renumbered with the root unmoved').toBe('');
    expect(respelt.renumbered).toBe(0);

    // Enough chords, and enough of them exact, that a sweep silently reduced to
    // nothing would fail here rather than pass.
    expect(counts.unchanged + counts.overloaded + counts.respelt).toBeGreaterThan(12000);
    expect(counts.unchanged).toBeGreaterThan(4000);

    // Printed rather than pinned: the two exception classes are characterised by
    // what they are, not by how many of them there happen to be, and a number
    // here would be a figure to update rather than a rule to check. Measured on
    // 2026-09-10, before the ruling: 5537 exact, 1866 overloaded, 5565 respelt
    // (3136 of them renumbered, 2429 respelt on their own numeral), 0 outside.
    // After it: 7448 exact, 1852 overloaded, 3668 respelt and every one of them
    // on the numeral it started on, 0 outside.
    // eslint-disable-next-line no-console
    console.log('round trip:', JSON.stringify({ ...counts, respelt }));
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
