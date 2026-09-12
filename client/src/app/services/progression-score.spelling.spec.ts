import { BeatDoc, NoteLetter } from '../models/composer.model';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  RollNote,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import { PROGRESSION_FINEST_DIVISION, progressionToScore } from './progression-score';

/**
 * The letters a projected progression engraves on.
 *
 * The deferral M3 recorded, closed: until this the projection wrote a pitch and
 * a key signature and let alphaTab choose a letter, so B flat major's borrowed
 * `♭II` - a C flat chord - engraved on B, a raised seventh under a numeral that
 * says lowered second. The rule that fixes it is `slotSpeller`'s and is pinned
 * as a rule in `progression-spelling.spec.ts`; what is pinned here is the other
 * half of the same claim the roll's spec makes next door - that *this* caller
 * is wired to it, per slot, and that the letter survives the trip through
 * `quantizeBar` onto every `NoteDoc` it writes.
 *
 * Separate from `progression-score.spec.ts` because that file checks the shape
 * of the notation - bars, ties, durations, dynamics - and this one checks a
 * single field on a note. They fail for different reasons and read as different
 * subjects.
 *
 * Every expectation is a letter worked out by hand from the degree, on
 * `progression-spelling.spec.ts`' rule: a fixture read back off the projection
 * would be testing nothing.
 */

/** The intervals of the mode each key's id names. */
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];
/** Five degrees, so no letter arithmetic applies - `isHeptatonic` is false. */
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];

function key(tonic: number, scaleId: string, preferSharps: boolean): ProgressionKey {
  return { tonic, scaleId, preferSharps };
}

function note(midi: number, startBeat = 0, lengthBeats = 4): RollNote {
  return { midi, startBeat, lengthBeats, velocity: DEFAULT_VELOCITY };
}

/**
 * One slot holding one chord's worth of notes, as the store really holds it.
 *
 * Through `createDegreeSlot` so the fixture carries whatever a fresh slot
 * carries, with the numeral's accidental and quality written over the top - the
 * two fields a borrowed chord differs from a diatonic one by.
 */
function slotOf(
  shape: Partial<ChordDegree> & { degree: number },
  notes: RollNote[],
  lengthBeats = 4
): ChordSlot {
  const slot = createDegreeSlot(shape.degree, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

  return {
    ...slot,
    lengthBeats,
    notes,
    harmony: { kind: 'degree', degree: { ...slot.harmony.degree, ...shape } }
  };
}

function docOf(progressionKey: ProgressionKey, slots: ChordSlot[]): ProgressionDoc {
  return { ...createDefaultProgression(), key: progressionKey, slots };
}

/** Every beat of the one staff the projection writes, bar by bar. */
function barsOf(doc: ProgressionDoc, scaleIntervals?: readonly number[]): BeatDoc[][] {
  const score =
    scaleIntervals === undefined
      ? progressionToScore(doc)
      : progressionToScore(doc, PROGRESSION_FINEST_DIVISION, scaleIntervals);

  return score.doc.tracks[0].staves[0].bars.map(bar => bar.voices[0].beats);
}

/** The letter on every note written anywhere in the score, in reading order. */
function lettersOf(doc: ProgressionDoc, scaleIntervals?: readonly number[]): (NoteLetter | undefined)[] {
  return barsOf(doc, scaleIntervals).flatMap(bar =>
    bar.flatMap(beat =>
      beat.notes.map(written => {
        if (written.pitch.kind !== 'pitched') throw new Error('a progression writes pitched notes');
        return written.pitch.letter;
      })
    )
  );
}

describe('progressionToScore spelling', () => {
  /**
   * The fixture the whole milestone turns on.
   *
   * B flat major's second degree is written on a C whatever the numeral does to
   * it, so the borrowed `♭II` is a C flat major triad: C♭ E♭ G♭, pitch classes
   * 11, 3 and 6. None of the three is in B flat major, so with no letter to go
   * on alphaTab spells them from the one-flat... two-flat signature and the top
   * one comes out **B**, which is the seventh degree raised - the exact reading
   * the numeral contradicts.
   *
   * Read off the chord they are a root, a third and a fifth, so their letters
   * are C, E and G, one step apart in the usual way, each flattened onto its
   * pitch.
   */
  it('engraves a flat two on C, not on B', () => {
    const doc = docOf(
      key(10, 'ionian', false),
      [slotOf({ degree: 1, alter: -1, quality: 'major' }, [note(71), note(75), note(78)])]
    );

    expect(lettersOf(doc, IONIAN)).toEqual(['C', 'E', 'G']);
  });

  /**
   * The default: no scale still means a letter, and it is the key's.
   *
   * The projection cannot resolve `key.scaleId` itself - that needs
   * `MusicTheoryService` and this module is pure - so the scale is handed in,
   * and an empty one is what an id that did not resolve looks like. There is no
   * degree to take a letter from, so `preferSharps` answers, and B flat major's
   * preference is flat: the same three pitches come back on B, E and G with the
   * lower two flattened - and the top one on the *wrong* letter, since 11 ought
   * to be a C flat and the key alone cannot know that.
   *
   * That wrong letter is the point of the case rather than an oversight in it.
   * It is exactly what the roll draws on its keyboard for this document -
   * `buildRollView` calls the same `slotSpeller` on the same empty array with no
   * gate of its own - and the invariant the whole refactor is for is that the
   * two agree. Withholding the letter here would not make the score right; it
   * would hand the note to the key signature, whose answer is a third opinion
   * neither the roll nor the speller holds.
   */
  it('spells from the key when no scale is given, as the roll does', () => {
    const doc = docOf(
      key(10, 'ionian', false),
      [slotOf({ degree: 1, alter: -1, quality: 'major' }, [note(71), note(75), note(78)])]
    );

    expect(lettersOf(doc)).toEqual(['B', 'E', 'G']);
  });

  /**
   * And a scale that resolves but names no degrees is the same case.
   *
   * A pentatonic has five degrees and cannot take seven letters one apart, so
   * `chordToneSpellings` and `scaleNoteSpelling` both refuse on `isHeptatonic`
   * and every note falls through to `preferSharps` - with a scale array that is
   * emphatically not empty. This is why the gate that used to stand in
   * `placeProgressionNotes` tested the wrong thing: it read array length, and
   * what it meant to ask was whether a degree could be named. Length said yes
   * for this scale and the notes were spelled from the preference anyway - so
   * the case the gate was written to prevent was already reachable straight
   * through it.
   *
   * C minor pentatonic, preferring flats, over a `I` slot: pitch class 3 has no
   * degree letter to claim and comes back an E flat, the letter above.
   */
  it('spells from the key for a scale with no degree letters to give', () => {
    const doc = docOf(
      key(0, 'minorPentatonic', false),
      [slotOf({ degree: 0 }, [note(60), note(63)])]
    );

    expect(lettersOf(doc, MINOR_PENTATONIC)).toEqual(['C', 'E']);
  });

  /**
   * The scale half of the rule, on a note the chord does not contain - so the
   * projection is reading the whole of `slotSpeller` and not only its chord map.
   *
   * F locrian is F G♭ A♭ B♭ C♭ D♭ E♭ and leans **sharp**: `keySignatureKind`
   * reads it off the six-sharp wedge. Its seventh degree is an E flat, pitch
   * class 3 - MIDI 63 - and the tonic triad it is not part of is F A♭ C♭. So a
   * letter taken from the key's preference would be D, and the degree's is E.
   */
  it('takes a letter from the scale for a note the chord does not contain', () => {
    const doc = docOf(
      key(5, 'locrian', true),
      [slotOf({ degree: 0 }, [note(65), note(63)])]
    );

    expect(lettersOf(doc, LOCRIAN)).toEqual(['F', 'E']);
  });

  /**
   * A slot's letters are its own, so a second chord does not inherit the first's.
   *
   * The speller is built per slot, and this is what that buys: one pitch class,
   * 11, in two slots of one projection, coming out on two letters. Under the
   * `♭II` it is the chord's own root and so a **C** flat. Under the `I` it is
   * neither a chord tone - B flat major is B♭ D F - nor in the scale at all, so
   * there is no degree to take a letter from and the key answers with its
   * preference: a plain **B**, which is the very spelling the first slot exists
   * to correct. Both are right, because they are answers to different
   * questions, and a speller shared between the slots could only give one.
   */
  it('spells each slot from its own chord', () => {
    const doc = docOf(key(10, 'ionian', false), [
      slotOf({ degree: 1, alter: -1, quality: 'major' }, [note(71)]),
      { ...slotOf({ degree: 0 }, [note(71)]), startBeat: 4 }
    ]);

    expect(lettersOf(doc, IONIAN)).toEqual(['C', 'B']);
  });

  /**
   * A pitch below MIDI 0 is still the chord tone it sounds.
   *
   * `normalizeRollNote` permits one - what is stored is what is heard - so the
   * projection has to reduce a negative MIDI the long way rather than by
   * `midi % 12`. A negative remainder is not a key of the chord-tone map, which
   * is keyed 0-11, so the lookup would miss and the *scale* would answer for a
   * note the chord names. It answers wrongly here and silently: pitch class 11
   * is not in B flat major at all, so the fall-through goes on to the key's
   * preference and prints a plain B - the very spelling the `♭II` exists to
   * correct, reached by a different route.
   *
   * MIDI -1 is pitch class 11, the same C flat the fixture above engraves, and
   * `midi % 12` makes it -1.
   */
  it('spells a pitch below MIDI 0 from the chord, not from the remainder', () => {
    const doc = docOf(
      key(10, 'ionian', false),
      [slotOf({ degree: 1, alter: -1, quality: 'major' }, [note(-1)])]
    );

    expect(lettersOf(doc, IONIAN)).toEqual(['C']);
  });

  /**
   * And the letter survives the tie, which is the one thing about the trip
   * through `quantizeBar` worth asserting.
   *
   * A note held across a bar line is written twice - struck, then tied - and the
   * two fragments are separate `NoteDoc`s built from copies of one pitch. A
   * letter set on the placement has to reach both, or a C flat would be tied to
   * a B.
   */
  it('carries the letter onto the far end of a tie', () => {
    const doc = docOf(
      key(10, 'ionian', false),
      [slotOf({ degree: 1, alter: -1, quality: 'major' }, [note(71, 0, 8)], 8)]
    );

    const letters = lettersOf(doc, IONIAN);
    expect(letters.length).toBeGreaterThan(1);
    expect(letters.every(letter => letter === 'C')).toBeTrue();
  });
});
