import {
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  noteCount
} from '../services/progression-harmony';
import { chordOctaveCeiling, generateSlotNotes } from '../services/progression-generate';
import { voiceChord } from '../services/progression-voicing';
import { MusicTheoryService } from '../services/music-theory.service';
import {
  ALTER_MAX,
  ALTER_MIN,
  CHORD_EXTENTS,
  DEFAULT_VELOCITY,
  MIN_SLOT_BEATS,
  OCTAVE_MAX,
  OCTAVE_MIN,
  TEMPO_MAX,
  TEMPO_MIN,
  VOICING_BASE_MIDI,
  createOwnership,
  normalizeChordSlot,
  normalizeProgressionDoc
} from './progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  RollNote,
  SlotOwnership,
  createDefaultProgression,
  createDegreeSlot
} from './progression.model';

/** A slot with one or more of its degree fields overridden. */
function slotWithDegree(overrides: Partial<Record<keyof ChordDegree, unknown>>): ChordSlot {
  const slot = createDegreeSlot(0, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return {
    ...slot,
    harmony: {
      kind: 'degree',
      degree: { ...slot.harmony.degree, ...overrides } as ChordDegree
    }
  };
}

/** The degree of a slot known to be a degree slot. */
function degreeOf(slot: ChordSlot): ChordDegree {
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return slot.harmony.degree;
}

/** A default document with one or more top-level fields overridden. */
function docWith(overrides: Partial<Record<keyof ProgressionDoc, unknown>>): ProgressionDoc {
  return { ...createDefaultProgression(), ...overrides } as ProgressionDoc;
}

/** A default document in a key whose tonic may be anything at all. */
function docWithTonic(tonic: unknown): ProgressionDoc {
  const doc = createDefaultProgression();
  return { ...doc, key: { ...doc.key, tonic } as ProgressionDoc['key'] };
}

describe('SlotOwnership', () => {
  it('starts owning nothing', () => {
    expect(createOwnership()).toEqual({
      pitches: false, timing: false, velocity: false
    } as SlotOwnership);
  });

  // Asserted on the factory rather than through `createDegreeSlot`, which routes
  // via `normalizeChordSlot` and rebuilds `owned` unconditionally - so a shared
  // constant here would be laundered into a fresh record before a slot could
  // show it. The roll's setters, which claim a dimension without rebuilding a
  // slot, are the first call sites where it cannot be. structuredClone undo
  // depends on nothing being shared between documents.
  it('builds a fresh record on every call', () => {
    expect(createOwnership()).not.toBe(createOwnership());
  });

  it('fills in a slot that arrives without one', () => {
    // The migration case: a document written before this field existed has no
    // `owned` at all, and nothing about it says what the slot sounds like.
    const slot = { ...createDegreeSlot(0, 0) } as Record<string, unknown>;
    delete slot['owned'];
    expect(normalizeChordSlot(slot as never).owned).toEqual(createOwnership());
  });

  // Thrown on rather than coerced, unlike a *missing* record beside it. Absence
  // is migration and has a safe answer; a member of the wrong kind is corruption
  // - no release ever wrote a non-boolean here, so nothing that arrives with one
  // came from a past version of this document.
  it('refuses a member that is not a boolean', () => {
    const slot = createDegreeSlot(0, 0);
    const withOwned = (owned: unknown) => () =>
      normalizeChordSlot({ ...slot, owned } as never);
    expect(withOwned({ pitches: 'yes', timing: false, velocity: false }))
      .toThrowError(/pitches/);
    expect(withOwned({ pitches: false, timing: 1, velocity: false }))
      .toThrowError(/timing/);
    expect(withOwned({ pitches: false, timing: false, velocity: undefined }))
      .toThrowError(/velocity/);
  });

  // Both polarities of all three members, because one fixture cannot tell a
  // preserved member from a hard-coded one: `{ pitches: true, ... }` alone is
  // satisfied by `timing: false` written as a literal.
  it('keeps the members that really are booleans', () => {
    const slot = createDegreeSlot(0, 0);
    const ownedFor = (owned: SlotOwnership): SlotOwnership =>
      normalizeChordSlot({ ...slot, owned }).owned;
    expect(ownedFor({ pitches: true, timing: false, velocity: false }))
      .toEqual({ pitches: true, timing: false, velocity: false });
    expect(ownedFor({ pitches: false, timing: true, velocity: true }))
      .toEqual({ pitches: false, timing: true, velocity: true });
  });

  // The record is rebuilt rather than passed through, for the reason the slot
  // itself is: a document already on the structuredClone undo stack must not
  // find its ownership amended behind it.
  it('does not hand back the record it was given', () => {
    const slot = createDegreeSlot(0, 0);
    expect(normalizeChordSlot(slot).owned).not.toBe(slot.owned);
  });

  // A literal slot returns early from the degree half of the normaliser, which
  // is the easiest place for a guard to be skipped by accident.
  it('normalises the ownership of a literal slot too', () => {
    const literal = {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal', reason: 'unrecognised' }
    } as Record<string, unknown>;
    delete literal['owned'];
    expect(normalizeChordSlot(literal as never).owned).toEqual(createOwnership());
  });
});

describe('normalizeChordSlot', () => {
  it('leaves a slot that is already in range alone', () => {
    const slot = createDegreeSlot(2, 4);
    expect(normalizeChordSlot(slot)).toEqual(slot);
  });

  it('does not mutate the slot it is given', () => {
    const slot = slotWithDegree({ octave: 9 });
    normalizeChordSlot(slot);
    expect(degreeOf(slot).octave).toBe(9);
  });

  // An octave control at the top of its range should stop, not throw: the user
  // pressed a button, they did not write a bug.
  it('clamps an octave beyond the range to the end of it', () => {
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ octave: 9 }))).octave).toBe(OCTAVE_MAX);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ octave: -9 }))).octave).toBe(OCTAVE_MIN);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ octave: 1 }))).octave).toBe(1);
  });

  // The other half of the rule: a value of the wrong kind is a bug, and a bug
  // that reaches the synth as `NaN` is the one this model exists to stop.
  it('refuses an octave that is not a whole number', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ octave: NaN }))).toThrowError(/octave/);
    expect(() => normalizeChordSlot(slotWithDegree({ octave: 1.5 }))).toThrowError(/octave/);
    expect(() => normalizeChordSlot(slotWithDegree({ octave: undefined }))).toThrowError(/octave/);
  });

  // Inversion is cyclic where octave is linear, so it wraps rather than clamps -
  // and it is stored wrapped so the UI can say "second inversion" rather than
  // "fifth inversion of a triad".
  it('wraps an inversion into the chord it belongs to', () => {
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ inversion: 4 }))).inversion).toBe(1);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ inversion: -1 }))).inversion).toBe(2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ inversion: 3 }))).inversion).toBe(0);
    // A seventh chord has four notes, so 3 is a real inversion there.
    expect(
      degreeOf(normalizeChordSlot(slotWithDegree({ extent: 7, inversion: 3 }))).inversion
    ).toBe(3);
  });

  it('refuses an inversion that is not a whole number', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ inversion: NaN }))).toThrowError(/inversion/);
    expect(() => normalizeChordSlot(slotWithDegree({ inversion: 0.5 }))).toThrowError(/inversion/);
  });

  // A chromatic alteration of a degree; past a whole tone it is a different
  // degree, not an alteration of this one.
  //
  // Known blind spot, recorded rather than papered over: ALTER_MIN/MAX and
  // OCTAVE_MIN/MAX are both -2 and 2, so swapping the two pairs over in
  // `normalizeChordDegree` changes nothing any test could observe. No spec can
  // close that while the numbers coincide - the two clamps are behaviourally
  // identical. Both ranges are pinned to literals instead, which at least
  // catches either one moving, and would make the swap detectable the moment
  // they stop agreeing.
  // A quality goes with every altered degree here, because a chromatic root
  // with no shape to build on it is now refused outright - see 'refuses a
  // chromatic root with no shape to build on it' below. The clamp is what is
  // under test, so the quality is the least interesting one that makes the
  // degree legal at all.
  it('clamps an alteration beyond a whole tone', () => {
    expect(ALTER_MIN).toBe(-2);
    expect(ALTER_MAX).toBe(2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: 5, quality: 'major' }))).alter)
      .toBe(2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: -5, quality: 'major' }))).alter)
      .toBe(-2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: -1, quality: 'major' }))).alter)
      .toBe(-1);
  });

  it('refuses an alteration that is not a whole number', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ alter: NaN }))).toThrowError(/alter/);
  });

  // Not a taste call: `noteCount` reads an extent that is not a stacked third
  // as a fractional note count, and the chord comes out with a note too many.
  //
  // Extent is the one out-of-range value that throws rather than clamping,
  // because `ChordExtent` is an enumerated set and not a range: there is no
  // nearest legal extent that is more right than any other, and keeping the
  // +/- complexity buttons inside the ladder is the stepper's job.
  it('refuses an extent that is not a stacked third', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ extent: 5 }))).toThrowError(/extent/);
    expect(() => normalizeChordSlot(slotWithDegree({ extent: 15 }))).toThrowError(/extent/);
    expect(() => normalizeChordSlot(slotWithDegree({ extent: NaN }))).toThrowError(/extent/);
  });

  // The other side of that guard, and the one that catches a shortened ladder:
  // dropping 11 and 13 from CHORD_EXTENTS leaves the refusal spec above green
  // while quietly making the top two complexity steps unreachable.
  it('accepts every extent on the complexity ladder', () => {
    expect(CHORD_EXTENTS).toEqual([3, 7, 9, 11, 13]);
    for (const extent of CHORD_EXTENTS) {
      expect(degreeOf(normalizeChordSlot(slotWithDegree({ extent }))).extent).toBe(extent);
    }
  });

  it('refuses a degree the diatonic stack cannot build', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ degree: 7 }))).toThrowError(/degree/);
  });

  /**
   * `suspension` under the fourth clause, and it arrives there late.
   *
   * It has been storable since M1 and unchecked for exactly as long, on the
   * honest ground that nothing read it: `generateSlotNotes` said in as many
   * words that a suspension was stored and not sounded. M3 Task 4 sounds it, so
   * an unlisted value now falls through `chordPitchClasses`' `!== 'none'` test
   * into the diatonic third and produces a plain triad under a card that says
   * the chord is suspended. A wrong chord dressed as a right one is what every
   * guard in this file exists to turn into a failure.
   */
  it('refuses a suspension that is not one of the three', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ suspension: 'sus9' })))
      .toThrowError(/suspension/i);
    expect(() => normalizeChordSlot(slotWithDegree({ suspension: 'SUS4' })))
      .toThrowError(/suspension/i);
    // As old as `ChordDegree`, so a missing one is corruption rather than a
    // document written before the field existed.
    expect(() => normalizeChordSlot(slotWithDegree({ suspension: undefined })))
      .toThrowError(/suspension/i);
  });

  it('accepts every suspension the model names', () => {
    for (const suspension of ['none', 'sus2', 'sus4'] as const) {
      expect(degreeOf(normalizeChordSlot(slotWithDegree({ suspension }))).suspension)
        .toBe(suspension);
    }
  });

  /**
   * `extensions` is the second field under the fifth clause and the first one
   * whose migration is not hypothetical: it was added to `ChordDegree` at M3,
   * so every document written before it has no record at all. The fill is the
   * value a fresh slot carries - all three `null`, "as the key gives it" - and
   * a slot filled that way builds exactly what it built before the field
   * existed, which is what makes this a migration with nothing to migrate.
   */
  it('fills in an absent extensions record', () => {
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ extensions: undefined }))).extensions)
      .toEqual({ ninth: null, eleventh: null, thirteenth: null });
  });

  /**
   * And the other half of that split, which is `normalizeOwnership`'s exactly:
   * the record absent is old, a *member* outside its union is corruption. Each
   * member is a union rather than a range - a ninth may be flattened, natural
   * or raised and nothing else - so there is no nearest legal value to clamp
   * to, and a `2` would reach `chordPitchClasses` as a real displacement and
   * build a chord no name fits.
   */
  it('refuses an alteration outside its own union', () => {
    const bad = (extensions: unknown) =>
      () => normalizeChordSlot(slotWithDegree({ extensions }));

    expect(bad({ ninth: 2, eleventh: null, thirteenth: null })).toThrowError(/ninth/i);
    // An eleventh may only be raised and a thirteenth only flattened, so the
    // sign each refuses is the interesting case rather than the magnitude.
    expect(bad({ ninth: null, eleventh: -1, thirteenth: null })).toThrowError(/eleventh/i);
    expect(bad({ ninth: null, eleventh: null, thirteenth: 1 })).toThrowError(/thirteenth/i);
    expect(bad({ ninth: '0', eleventh: null, thirteenth: null })).toThrowError(/ninth/i);
    // A record present but missing a member is half-written, not old.
    expect(bad({ eleventh: null, thirteenth: null })).toThrowError(/ninth/i);
  });

  it('accepts every alteration the model names', () => {
    for (const ninth of [-1, 0, 1] as const) {
      expect(
        degreeOf(normalizeChordSlot(slotWithDegree({
          extensions: { ninth, eleventh: null, thirteenth: null }
        }))).extensions.ninth
      ).toBe(ninth);
    }
    for (const eleventh of [0, 1] as const) {
      expect(
        degreeOf(normalizeChordSlot(slotWithDegree({
          extensions: { ninth: null, eleventh, thirteenth: null }
        }))).extensions.eleventh
      ).toBe(eleventh);
    }
    for (const thirteenth of [-1, 0] as const) {
      expect(
        degreeOf(normalizeChordSlot(slotWithDegree({
          extensions: { ninth: null, eleventh: null, thirteenth }
        }))).extensions.thirteenth
      ).toBe(thirteenth);
    }
  });

  /**
   * Rebuilt rather than passed through, so a document already on the
   * `structuredClone` undo stack is not left sharing a record with the one that
   * replaced it - the promise `normalizeOwnership` makes one field over.
   */
  it('rebuilds the extensions record rather than sharing it', () => {
    const extensions = { ninth: -1 as const, eleventh: null, thirteenth: null };
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ extensions }))).extensions)
      .not.toBe(extensions);
  });

  /**
   * `quality` under the same rule as `extent`, and for the same reason.
   *
   * It used to be the one field on a `ChordDegree` the normaliser let through
   * untouched, which made `replaceDocument` a door for two documents the model
   * says are impossible. A string that is not a quality reached
   * `QUALITY_INTERVALS[quality]` as `undefined` and threw a raw `TypeError` off
   * `shape.length`, three layers downstream of where it arrived and saying
   * nothing about which field was wrong. `ChordQuality` is an enumerated set
   * rather than a range, so the fourth clause of the rule applies to it exactly
   * as it does to the extent ladder: there is no nearest legal quality.
   */
  it('refuses a quality that is not one of the named ones', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ quality: 'sus4' })))
      .toThrowError(/quality/i);
    expect(() => normalizeChordSlot(slotWithDegree({ quality: 'Major' })))
      .toThrowError(/quality/i);
    expect(() => normalizeChordSlot(slotWithDegree({ quality: 7 })))
      .toThrowError(/quality/i);
    // `undefined` is not `null`. A degree missing the field entirely is a
    // half-written record, where `null` is the value a fresh slot carries.
    expect(() => normalizeChordSlot(slotWithDegree({ quality: undefined })))
      .toThrowError(/quality/i);
  });

  /**
   * `'other'` is a `ChordQuality` and is not a storable one: the field is the
   * user's *override*, and `'other'` names no interval set to override with.
   * `ChordDegree.quality` is `NamedQuality | null` for that reason, and this is
   * the runtime half of it - `replaceDocument` is a door the type does not
   * guard.
   *
   * It used to be accepted, and had to be: `regenerateSlot` wrote the derived
   * label into this same field, and Hungarian minor's second degree derives as
   * `'other'`, so refusing it would have made that chord unopenable. The write
   * is gone, and with it the only thing that ever produced one - so the
   * laundering that `generateSlotNotes` did to survive it is gone too, and this
   * refusal is what keeps that safe.
   */
  it('refuses the one quality that names no shape to override with', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ quality: 'other' })))
      .toThrowError(/quality/i);
    // At `alter` 0 as well, where a diatonic chord would have been buildable:
    // it is refused for what it is, not for the company it keeps.
    expect(() => normalizeChordSlot(slotWithDegree({ alter: 0, quality: 'other' })))
      .toThrowError(/other/);
  });

  it('accepts every quality a chord can be named by, and the absence of one', () => {
    const qualities: NamedQuality[] = [
      'major', 'minor', 'diminished', 'augmented',
      'major7', 'minor7', 'dominant7', 'minorMajor7',
      'halfDiminished7', 'diminished7', 'augmented7', 'augmentedMajor7'
    ];

    for (const quality of qualities) {
      expect(degreeOf(normalizeChordSlot(slotWithDegree({ quality }))).quality)
        .withContext(`${quality} was refused`)
        .toBe(quality);
    }

    expect(degreeOf(normalizeChordSlot(slotWithDegree({ quality: null }))).quality).toBeNull();
  });

  /**
   * Design decision 1, checked at the door rather than only at the point of use.
   *
   * A chromatic root needs a shape to build on it, and neither field is wrong
   * alone: `alter` is a bounded integer and `null` is what every fresh slot
   * carries. Only the pair names nothing. `chordPitchClasses` already refuses
   * it, but it refuses it from the audio path - so without this guard
   * `replaceDocument` accepted the document, stored it, and threw later from
   * `generateSlotNotes` on whatever edit happened to regenerate the slot.
   */
  it('refuses a chromatic root with no shape to build on it', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ alter: -1, quality: null })))
      .toThrowError(/quality/i);
    expect(() => normalizeChordSlot(slotWithDegree({ alter: 1, quality: null })))
      .toThrowError(/quality/i);
  });

  /** An unaltered root needs no shape of its own, so `null` stays legal there. */
  it('leaves an unaltered degree free to have no quality at all', () => {
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: 0, quality: null }))).quality)
      .toBeNull();
  });

  /**
   * The clamp runs before the pair is judged, so a document that stored an
   * out-of-range `alter` is refused on the alteration it will actually get
   * rather than on the one it asked for. An `alter` of 5 with no quality clamps
   * to 2 and is still chromatic, so it is still refused; the ordering only
   * matters in the other direction, and there is no other direction while
   * `ALTER_MIN` and `ALTER_MAX` sit either side of zero.
   */
  it('judges the pair on the alteration it will store', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ alter: 9, quality: null })))
      .toThrowError(/quality/i);
  });

  // Both ends of the range, because every other spec in this file builds a
  // chord low in the scale: a guard that stopped at degree 5 would reject
  // vii-dim, which is a palette button like any other, and nothing else here
  // would notice.
  it('accepts every degree the palette can offer', () => {
    for (let degree = 0; degree <= 6; degree++) {
      expect(degreeOf(normalizeChordSlot(slotWithDegree({ degree }))).degree).toBe(degree);
      expect(degreeOf(createDegreeSlot(degree, 0)).degree).toBe(degree);
    }
  });

  // `setSlotLength` is a drag-the-edge handler. Dragging the right edge back
  // past the left one produces exactly 0 and then negatives, and a throw there
  // would abort the gesture rather than stop it at its limit. So a length below
  // the minimum is a control at its end, and clamps.
  it('clamps a slot length below the minimum', () => {
    const slot = createDegreeSlot(0, 0);
    expect(normalizeChordSlot({ ...slot, lengthBeats: 0 }).lengthBeats).toBe(MIN_SLOT_BEATS);
    expect(normalizeChordSlot({ ...slot, lengthBeats: -2 }).lengthBeats).toBe(MIN_SLOT_BEATS);
    // Just under the boundary clamps; the boundary itself is in range.
    expect(normalizeChordSlot({ ...slot, lengthBeats: 0.75 }).lengthBeats).toBe(MIN_SLOT_BEATS);
    expect(normalizeChordSlot({ ...slot, lengthBeats: MIN_SLOT_BEATS }).lengthBeats)
      .toBe(MIN_SLOT_BEATS);
    // And a longer slot is left exactly as it is, fraction and all.
    expect(normalizeChordSlot({ ...slot, lengthBeats: 1.5 }).lengthBeats).toBe(1.5);
  });

  // One beat, not one bar and not a sixteenth: M1 slots are measured in beats
  // and sound as one block each, so a beat is the shortest slot M1 can express.
  // Free timing arrives in M2, and this is the number it has to revisit.
  it('measures the shortest slot in whole beats', () => {
    expect(MIN_SLOT_BEATS).toBe(1);
  });

  it('refuses a slot length that is not a real duration', () => {
    const slot = createDegreeSlot(0, 0);
    expect(() => normalizeChordSlot({ ...slot, lengthBeats: NaN })).toThrowError(/lengthBeats/);
    expect(() => normalizeChordSlot({ ...slot, lengthBeats: Infinity }))
      .toThrowError(/lengthBeats/);
  });

  it('refuses a start beat that is not a real position', () => {
    const slot = createDegreeSlot(0, 0);
    expect(() => normalizeChordSlot({ ...slot, startBeat: NaN })).toThrowError(/startBeat/);
    expect(() => normalizeChordSlot({ ...slot, startBeat: -1 })).toThrowError(/startBeat/);
  });

  // A literal slot has no degree to check, but it still has timing, and the
  // union branch is the easiest place for a guard to be skipped by accident.
  it('checks the timing of a literal slot, which has no degree', () => {
    const literal: ChordSlot = {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal', reason: 'unrecognised' }
    };
    expect(normalizeChordSlot(literal)).toEqual(literal);
    expect(() => normalizeChordSlot({ ...literal, lengthBeats: NaN }))
      .toThrowError(/lengthBeats/);
  });

  /**
   * `notes` was the one field this function let through unchecked, on the
   * argument that M1 regenerated every note wholesale so there was nothing a
   * check could catch. M2 Task 4 ended that: `mergeNotes` carries a
   * caller-supplied note through a regeneration, so a bad one now persists
   * instead of being scrubbed by the next edit.
   *
   * What is checked is kind and only kind. The ranges are left open on purpose,
   * and one of these specs says so - bounding `midi` here while
   * `regenerateSlot` adds an unbounded `transposeBy` to it afterwards would
   * buy a guarded-looking pitch and not a guarded one.
   */
  describe('the notes on a slot', () => {
    const NOTE: RollNote = { midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 };

    /** A degree slot holding whatever is handed over, however wrong. */
    function withNotes(notes: unknown): ChordSlot {
      return { ...createDegreeSlot(0, 0), notes } as ChordSlot;
    }

    function withNote(overrides: Partial<Record<keyof RollNote, unknown>>): () => ChordSlot {
      return () => normalizeChordSlot(withNotes([{ ...NOTE, ...overrides }]));
    }

    // A `NaN` here reaches `Tone.PolySynth` with nothing in between that looks
    // at it again, which is the whole argument for the first clause of the
    // rule: silence rather than an error, three layers from the caller.
    it('refuses a pitch that is not a whole MIDI note number', () => {
      expect(withNote({ midi: NaN })).toThrowError(/midi/);
      expect(withNote({ midi: 60.5 })).toThrowError(/midi/);
      expect(withNote({ midi: undefined })).toThrowError(/midi/);
    });

    it('refuses a note position that is not a real offset', () => {
      expect(withNote({ startBeat: NaN })).toThrowError(/startBeat/);
      // Before the slot that holds it, which is outside the slot rather than at
      // the end of it - so it is refused where a length is clamped.
      expect(withNote({ startBeat: -1 })).toThrowError(/startBeat/);
    });

    it('refuses a note length that is not a real duration', () => {
      expect(withNote({ lengthBeats: NaN })).toThrowError(/lengthBeats/);
      expect(withNote({ lengthBeats: Infinity })).toThrowError(/lengthBeats/);
    });

    it('refuses a velocity that is not a real number', () => {
      expect(withNote({ velocity: NaN })).toThrowError(/velocity/);
      expect(withNote({ velocity: undefined })).toThrowError(/velocity/);
    });

    // A slot holds several, so the message has to say which - a chord with one
    // bad note is otherwise a hunt through four that look alike.
    it('names the note that is wrong', () => {
      expect(() => normalizeChordSlot(withNotes([NOTE, NOTE, { ...NOTE, midi: NaN }])))
        .toThrowError(/RollNote 2/);
    });

    // Not the migration case `owned` gets: `notes` is as old as `ChordSlot`, so
    // an absent one is corruption, and `.map` of `undefined` would report it as
    // a `TypeError` naming neither the field nor the slot.
    it('refuses a slot whose notes are not an array at all', () => {
      expect(() => normalizeChordSlot(withNotes(undefined))).toThrowError(/notes/);
      expect(() => normalizeChordSlot(withNotes({}))).toThrowError(/notes/);
    });

    /**
     * Deliberate, and pinned so it reads as a decision rather than a gap. The
     * ends a note gesture should rest on belong to the roll's setters in M2
     * Task 5; choosing them here would be this file deciding what a drag means.
     */
    it('bounds nothing, leaving the ranges to the roll that will draw them', () => {
      const wild: RollNote[] = [{ midi: 200, startBeat: 9, lengthBeats: 0.01, velocity: 500 }];
      expect(normalizeChordSlot(withNotes(wild)).notes).toEqual(wild);
    });

    // The copy half of the same change. `structuredClone` undo is only safe
    // while no two documents point at the same note.
    it('does not hand back the array or the notes it was given', () => {
      const notes: RollNote[] = [{ ...NOTE }];
      const normalized = normalizeChordSlot(withNotes(notes));

      expect(normalized.notes).not.toBe(notes);
      expect(normalized.notes[0]).not.toBe(notes[0]);
      expect(normalized.notes).toEqual(notes);
    });
  });
});

describe('normalizeProgressionDoc', () => {
  it('leaves a default progression alone', () => {
    const doc = createDefaultProgression();
    expect(normalizeProgressionDoc(doc)).toEqual(doc);
  });

  // The point of the document-level funnel: one call reaches every slot, so
  // `ProgressionService.commit` is the only place that has to remember.
  it('normalises every slot it holds', () => {
    const doc = docWith({
      slots: [slotWithDegree({ octave: 9 }), slotWithDegree({ inversion: 4 })]
    });
    const normalized = normalizeProgressionDoc(doc);
    expect(degreeOf(normalized.slots[0]).octave).toBe(OCTAVE_MAX);
    expect(degreeOf(normalized.slots[1]).inversion).toBe(1);
  });

  it('does not mutate the document it is given', () => {
    const doc = docWith({ tempo: 9000, slots: [slotWithDegree({ octave: 9 })] });
    normalizeProgressionDoc(doc);
    expect(doc.tempo).toBe(9000);
    expect(degreeOf(doc.slots[0]).octave).toBe(9);
  });

  // Tempo reaches Tone's transport, which is the same audio layer RollNote.midi
  // reaches by another road, and nothing in between looks at it either. The
  // tempo box is a continuous control, so its ends clamp.
  it('clamps a tempo outside the playable range', () => {
    expect(normalizeProgressionDoc(docWith({ tempo: 0 })).tempo).toBe(TEMPO_MIN);
    expect(normalizeProgressionDoc(docWith({ tempo: -60 })).tempo).toBe(TEMPO_MIN);
    expect(normalizeProgressionDoc(docWith({ tempo: 9000 })).tempo).toBe(TEMPO_MAX);
    // Tempo is not quantised: a metronome may sit between two whole numbers.
    expect(normalizeProgressionDoc(docWith({ tempo: 90.5 })).tempo).toBe(90.5);
  });

  it('refuses a tempo that is not a real number', () => {
    expect(() => normalizeProgressionDoc(docWith({ tempo: NaN }))).toThrowError(/tempo/);
    expect(() => normalizeProgressionDoc(docWith({ tempo: Infinity }))).toThrowError(/tempo/);
    expect(() => normalizeProgressionDoc(docWith({ tempo: undefined }))).toThrowError(/tempo/);
  });

  // `setKey` is live in M1, and the tonic it sets is added to every pitch class
  // on the way to `voiceChord` and `RollNote.midi`. It is a pitch class, so it
  // is cyclic like inversion: the note above B is C, not an error.
  it('wraps a tonic back into the octave', () => {
    expect(normalizeProgressionDoc(docWithTonic(12)).key.tonic).toBe(0);
    expect(normalizeProgressionDoc(docWithTonic(13)).key.tonic).toBe(1);
    expect(normalizeProgressionDoc(docWithTonic(-1)).key.tonic).toBe(11);
    expect(normalizeProgressionDoc(docWithTonic(11)).key.tonic).toBe(11);
  });

  it('refuses a tonic that is not a whole pitch class', () => {
    expect(() => normalizeProgressionDoc(docWithTonic(NaN))).toThrowError(/tonic/);
    expect(() => normalizeProgressionDoc(docWithTonic(1.5))).toThrowError(/tonic/);
    expect(() => normalizeProgressionDoc(docWithTonic(undefined))).toThrowError(/tonic/);
  });
});

describe('the octave bound', () => {
  /**
   * Every heptatonic scale the app offers.
   *
   * `MusicTheoryService.getScaleCategories()` is the contract this whole
   * describe rests on. It is where the chord palette reads its scales from, so
   * a scale reachable there is a scale the octave bound has to survive, and a
   * scale added anywhere else would be swept by neither. If that method stops
   * being the app's complete scale list, this guard silently starts measuring
   * something narrower than the thing it guards.
   */
  const HEPTATONIC_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => intervals.length === 7);

  const sweeps = new Map<number, { lowest: number; highest: number }>();

  /**
   * Every `(alter, quality)` pair a stored slot can carry.
   *
   * A null quality is the diatonic chord and only survives at `alter` 0 - the
   * pair is refused above, and `chordPitchClasses` refuses it again - so the
   * two axes are swept together as legal combinations rather than as a product
   * with an illegal corner. `'other'` is not swept because it cannot be stored:
   * it is a label rather than a shape, and the field holds shapes.
   */
  const SHAPES: readonly { alter: number; quality: NamedQuality | null }[] = [
    { alter: 0, quality: null },
    ...(Object.keys(QUALITY_INTERVALS) as NamedQuality[]).flatMap(quality =>
      [ALTER_MIN, -1, 0, 1, ALTER_MAX].map(alter => ({ alter, quality }))
    )
  ];

  /**
   * One sweep slot, spread from the factory's defaults rather than normalised.
   *
   * Normalising would clamp `octave` back inside the bound, and the spec below
   * that sweeps at `OCTAVE_MAX + 1` deliberately asks for an octave outside it:
   * what it checks is that `generateSlotNotes` holds such a slot to the control's
   * own bound, and a normalisation here would make that true before the
   * generator was reached.
   */
  const SWEEP_TEMPLATE = createDegreeSlot(0, 0);
  function sweepSlot(overrides: Partial<ChordDegree>): ChordSlot {
    return {
      ...SWEEP_TEMPLATE,
      harmony: {
        kind: 'degree',
        degree: { ...degreeOf(SWEEP_TEMPLATE), ...overrides }
      }
    };
  }

  /**
   * The extremes of every chord the app can build, voiced at `octave`.
   *
   * It calls `generateSlotNotes` rather than re-running its three steps by
   * hand. The hand-rolled version was arithmetically right, and being right was
   * the problem: two copies of a pipeline with nothing asserting that they
   * agree is exactly how a bound comes to guard something the app has stopped
   * doing. The bound is only worth anything if it is measured over the code
   * that produces the notes.
   *
   * The part that has to be walked rather than simplified is that `alter` and
   * the key's `tonic` reach the pitch classes *before* voicing. `voiceChord`'s
   * reach is not transposition-invariant - its first note lands anywhere from
   * the base to eleven semitones above it, depending on the pitch class it
   * starts from - so a sweep that voiced untransposed chords would measure a
   * pipeline this bound does not guard, and would come up a semitone short of
   * the real maximum.
   *
   * ## Why `alter` and `quality` are axes, and what it cost to leave them out
   *
   * `alter` used to be a transposition: it shifted the whole stack, so it and
   * `tonic` composed into a single uniform offset and the tonic loop alone
   * already covered all twelve residues. Dropping the `alter` loop cost
   * nothing, and it was dropped.
   *
   * It is not a transposition any more. It displaces the *root* alone and needs
   * a quality beside it to build a shape on, so it reaches chords no tonic
   * reaches, and the reach it opens is not small:
   *
   * | swept set | highest note above the base |
   * |---|---|
   * | diatonic only | 33 |
   * | + a quality override at `alter` 0 | 34 |
   * | + `alter` across its clamped range | **45** |
   *
   * Twelve semitones is the difference between a bound that holds and one that
   * does not, and the narrow sweep measured 33 either way - which is exactly
   * how `OCTAVE_MAX` came to be one octave too high while a spec said it was
   * maximal. Note that even the middle row overflows nothing but is already
   * past 33: a plain alternates row with no chromatic root at all reaches 34.
   *
   * So both are swept here. The cost is one full pass of roughly five and a
   * half million chords per octave, which is the price of measuring the
   * pipeline rather than a model of it.
   *
   * ## What this sweep does NOT cover, measured and left uncovered on purpose
   *
   * M3 Task 4 gave a chord two more axes - `suspension`, and an alteration on
   * each of the three extensions - and **this sweep varies neither**. Every
   * slot it builds carries the template's `'none'` and its three nulls. That is
   * a narrowing of the reachable set relative to what the model can now store,
   * and it is written here rather than left to be discovered.
   *
   * Both halves of the reason are measurements rather than opinions, taken over
   * this same `generateSlotNotes` pipeline with the axes added. They are
   * reproducible: `client/tools/measure-chord-reach.cjs` is that sweep, moved
   * out of here and runnable on demand.
   *
   * | swept set | chords per octave | seconds | reach |
   * |---|---|---|---|
   * | as below, 16 qualities (`--set=shipped`) | 5.6M | 3.7 | **46** |
   * | + the three suspensions (`--set=suspended`) | 16.8M | 13.8 | 46 |
   * | + every extension alteration (`--set=full`) | 236.4M | 199 | **58** |
   *
   * The full set is 200 seconds *per octave* and this describe measures four of
   * them, so shipping it would put thirteen minutes into a suite that runs in
   * under a minute. That was the first reason to leave it out, and on its own it
   * would have argued for a sampled axis with a comment saying so.
   *
   * The second reason was that **the reach of the full model is 58, and 58 did
   * not fit**: `OCTAVE_MAX` was 1 at the time and there was no other guard, so
   * that chord's top note landed on MIDI 130 and a widened sweep here would not
   * have been a slower spec but a *failing* one.
   *
   * **Task 4b settled that, and it is why this sweep is not widened even now
   * that it could be.** The ceiling is each chord's own -
   * `chordOctaveCeiling` derives it in `progression-generate.ts` - so the
   * property worth proving is local and constructive, and it is proved there on
   * a sample in milliseconds rather than here over a universe in minutes. A
   * global figure is no longer what keeps notes inside MIDI. What it is still
   * good for is knowing how wide the model can get, which is why the tool
   * exists and why the table above is quoted rather than deleted.
   *
   * One consequence for the numbers below: `generateSlotNotes` now clamps, so
   * this measures the *sounding* extremes rather than the arithmetic ones. That
   * is the right thing for a MIDI bound to measure, and the specs that want the
   * unclamped answer say so and voice by hand.
   */
  function extremesAt(octave: number): { lowest: number; highest: number } {
    const cached = sweeps.get(octave);
    if (cached) return cached;

    let lowest = Infinity;
    let highest = -Infinity;

    for (const intervals of HEPTATONIC_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of CHORD_EXTENTS) {
          const inversions = noteCount(extent);
          for (const { alter, quality } of SHAPES) {
            for (let tonic = 0; tonic < 12; tonic++) {
              const key: ProgressionKey = { tonic, scaleId: 'ionian', preferSharps: true };
              for (let inversion = 0; inversion < inversions; inversion++) {
                const slot = sweepSlot({ degree, extent, inversion, octave, alter, quality });
                for (const note of generateSlotNotes(slot, key, intervals)) {
                  if (note.midi < lowest) lowest = note.midi;
                  if (note.midi > highest) highest = note.midi;
                }
              }
            }
          }
        }
      }
    }

    const extremes = { lowest, highest };
    sweeps.set(octave, extremes);
    return extremes;
  }

  // The header quotes this count. A scale added to the service is a scale the
  // reach below has to be re-measured against, so the number is pinned rather
  // than left to drift out of the comment that cites it.
  it('sweeps every heptatonic scale the service offers', () => {
    expect(HEPTATONIC_SCALES.length).toBe(33);
  });

  /**
   * The figure the whole bound rests on, asserted rather than left in prose.
   *
   * **It was 45 until M3 Task 4 added the four added-tone shapes**, and it moved
   * to 46 without anyone widening this sweep: `SHAPES` is derived from
   * `QUALITY_INTERVALS`, so a quality added to that table is a quality this
   * measurement picks up. That is the property the derivation was for.
   *
   * The witness is the enigmatic scale, degree 0 at extent 13, altered down a
   * tone and overridden to `add9`, fourth inversion, in the key of B flat.
   * `add9` puts its fourth note a ninth above the root rather than a seventh,
   * so a root displaced down two semitones still reaches 12 while the four
   * diatonic notes above it stay where the scale left them: the stack is
   * [-2, 2, 5, 12, 13, 18, 22] - strictly ascending, so no artefact of the lift
   * - which carries the tonic to [8, 12, 15, 22, 23, 28, 32], rotates to put 23
   * in the bass and voices from 60 to 71, 76, 80, 92, 96, 99, 106.
   *
   * The reach is spelled out here as well as asserted, because a bound derived
   * from a sweep is only auditable if the case that produced it is written down.
   */
  it('reaches 46 semitones above the base at its widest', () => {
    const base = VOICING_BASE_MIDI;
    const { lowest, highest } = extremesAt(0);
    // `voiceChord` never places a note below its base, so the base is the floor
    // exactly, and the reach is measured from it.
    expect(lowest).toBe(base);
    expect(highest - base).toBe(46);
  });

  /**
   * The witness itself, built by hand, so the sweep's answer has a case behind
   * it that a reader can check without running five million chords.
   */
  it('voices its widest chord where the sweep says it does', () => {
    const slot = sweepSlot({
      degree: 0,
      extent: 13,
      alter: -2,
      quality: 'add9',
      inversion: 4,
      octave: 0
    });
    const key: ProgressionKey = { tonic: 10, scaleId: 'enigmatic', preferSharps: true };
    const enigmatic = [0, 1, 4, 6, 8, 10, 11];

    expect(generateSlotNotes(slot, key, enigmatic).map(note => note.midi))
      .toEqual([71, 76, 80, 92, 96, 99, 106]);
  });

  /**
   * The witness the sweep gave before the added-tone shapes existed, kept
   * because it is the case the *displacement* argument was written from - a
   * quality override reaching chords no tonic reaches - and because a spec that
   * only ever holds one witness cannot show that the reach moved.
   *
   * Hungarian minor, degree 5 at extent 13, altered down a tone and overridden
   * to `augmented7`, third inversion, in the key of G: 45 semitones.
   */
  it('still voices the widest chord the twelve original shapes reached', () => {
    const slot = sweepSlot({
      degree: 5,
      extent: 13,
      alter: -2,
      quality: 'augmented7',
      inversion: 3,
      octave: 0
    });
    const key: ProgressionKey = { tonic: 7, scaleId: 'hungarianMinor', preferSharps: false };
    const hungarianMinor = [0, 2, 3, 6, 7, 8, 11];

    expect(generateSlotNotes(slot, key, hungarianMinor).map(note => note.midi))
      .toEqual([71, 78, 81, 85, 97, 101, 105]);
  });

  /**
   * The widest chord the *whole* M3 model can build, pinned by hand because the
   * sweep above does not reach it and cannot afford to.
   *
   * **This is the characterization spec the ceiling rests on.** `OCTAVE_MAX` is
   * no longer what keeps this chord inside MIDI - `chordOctaveCeiling` is, and
   * it derives the ceiling from exactly this reach - so a change to
   * `liftIntoAscent` or to `voiceChord` that moved the figure would move every
   * ceiling in the app with it. It fails here, loudly, on one chord a reader can
   * check, rather than in a sweep nobody runs.
   *
   * It voices at octave 0, which is this chord's ceiling, so the clamp is inert
   * and what is asserted is the arithmetic rather than the guard.
   *
   * C major, degree 3 - the IV - at extent 13, altered down a tone and
   * overridden to `diminished`, suspended at the fourth, with a flattened ninth
   * and a flattened thirteenth, second inversion, in D. Two of the three replacements
   * land on the note below them, so the lift adds an octave twice: the stack is
   * [3, 8, 9, 16, 16, 23, 23] before it and [3, 8, 9, 16, 28, 35, 47] after,
   * which carries the tonic to [5, 10, 11, 18, 30, 37, 49] and voices from 60
   * to 71, 78, 90, 97, 109, 113, 118.
   *
   * 58 semitones above the base, twelve past what the swept set reaches. The
   * stacked lift is the mechanism and it is the arithmetic working rather than
   * failing - a duplicated voice is lifted, never dropped, for the reason
   * `chordPitchClasses` gives at length.
   */
  it('voices the widest chord a suspension and two alterations reach', () => {
    const slot = sweepSlot({
      degree: 3,
      extent: 13,
      alter: -2,
      quality: 'diminished',
      suspension: 'sus4',
      extensions: { ninth: -1, eleventh: null, thirteenth: -1 },
      inversion: 2,
      octave: 0
    });
    const key: ProgressionKey = { tonic: 2, scaleId: 'ionian', preferSharps: true };
    const major = [0, 2, 4, 5, 7, 9, 11];

    const midi = generateSlotNotes(slot, key, major).map(note => note.midi);
    expect(midi).toEqual([71, 78, 90, 97, 109, 113, 118]);
    expect(midi[midi.length - 1] - VOICING_BASE_MIDI).toBe(58);
  });

  /**
   * The overflow the widened model opened, and the ceiling closing it.
   *
   * This spec used to assert the failure, and was marked as the one to delete
   * once the constant was settled. Task 4b settled it the other way: the
   * constant stays where it is and the ceiling becomes the chord's own, so what
   * was a characterization of a bug is now a characterization of the guard.
   *
   * Both halves are asserted, because only the pair says what happened. The
   * chord *still* reaches 130 - nothing about its arithmetic changed, and
   * `voiceChord` will still put it there when asked directly - and
   * `generateSlotNotes` declines to ask. A spec pinning only the second half
   * would pass just as well if the reach had quietly shrunk instead.
   *
   * **The by-hand base is one octave above this chord's own ceiling, not
   * `OCTAVE_MAX`.** It was `OCTAVE_MAX` while that constant was 1, which is the
   * same base by coincidence - this chord's ceiling is 0 - and the coincidence
   * ended when `OCTAVE_MAX` went back to 2. Naming the ceiling says what the
   * 130 is: the first octave this chord does not fit in. Naming the control's
   * bound would make the number move whenever the control's range did, which is
   * exactly the thing this spec exists to be independent of.
   */
  it('holds a chord that would overflow at its own ceiling instead', () => {
    const widest: Partial<ChordDegree> = {
      degree: 3,
      extent: 13,
      alter: -2,
      quality: 'diminished',
      suspension: 'sus4',
      extensions: { ninth: -1, eleventh: null, thirteenth: -1 },
      inversion: 2
    };
    const key: ProgressionKey = { tonic: 2, scaleId: 'ionian', preferSharps: true };
    const major = [0, 2, 4, 5, 7, 9, 11];

    // Voiced by hand one octave above this chord's ceiling, which is where the
    // generator would have put it before Task 4b and no longer will.
    const stored = { ...degreeOf(SWEEP_TEMPLATE), ...widest };
    const ceiling = chordOctaveCeiling(key, major, stored);
    expect(ceiling).toBe(0);

    const relative = chordPitchClasses(major, stored);
    const unclamped = voiceChord(
      relative.map(pitchClass => pitchClass + key.tonic),
      2,
      VOICING_BASE_MIDI + (ceiling + 1) * 12
    );
    expect(unclamped[unclamped.length - 1]).toBe(130);

    // And what the generator does instead: the same chord an octave lower, on
    // the last note that fits.
    const midi = generateSlotNotes(sweepSlot({ ...widest, octave: OCTAVE_MAX }), key, major)
      .map(note => note.midi);
    expect(midi[midi.length - 1]).toBe(118);
    expect(midi[midi.length - 1]).toBeLessThanOrEqual(127);
  });

  // `voiceChord` has no MIDI clamp, so nothing below this stops an out-of-range
  // note reaching Tone.PolySynth. The bound is only defensible if it holds for
  // every scale the app offers, not just the two the plan works through.
  //
  // "Every chord the app can build" is the *swept* set, which since M3 Task 4
  // is narrower than the storable one - see the section on what this sweep does
  // not cover, and the two specs above.
  it('keeps every chord the app can build inside the MIDI range', () => {
    expect(extremesAt(OCTAVE_MIN).lowest).toBeGreaterThanOrEqual(0);
    expect(extremesAt(OCTAVE_MAX).highest).toBeLessThanOrEqual(127);
  });

  /**
   * What the top of the control does to the shipped set, which has now been
   * three different claims.
   *
   * It first read `extremesAt(OCTAVE_MAX + 1).highest > 127` - the constant
   * proved maximal by showing the next octave off the end. Task 4b took that
   * away, because `chordOctaveCeiling` is what stops a chord now and it is
   * proved maximal per chord in `progression-generate.spec.ts`. What went in its
   * place was `extremesAt(OCTAVE_MAX).highest - extremesAt(0).highest === 12`:
   * the whole sweep shifting rigidly by one octave, which held because at an
   * `OCTAVE_MAX` of 1 no chord in the shipped set was held down at all.
   *
   * **That second expectation was tied to the old value and does not survive
   * the new one.** At 2 the sweep stops moving rigidly: the chords that reach 46
   * have room for one more octave and not two, so they stop at 118 while the
   * rest of the set goes on up. The difference is 21 rather than 24, and 21 is
   * an artefact of which chord happens to be widest rather than a fact worth
   * pinning.
   *
   * What is worth pinning is below. Some chord in the set has exactly two
   * octaves of headroom and spends the last of it, so at the top of the control
   * the set lands on **127 exactly** - the last note MIDI has, neither short of
   * it nor past it. That is `chordOctaveCeiling`'s maximality visible as a
   * single number: a ceiling that were merely safe would leave the set short,
   * and one that were wrong would carry it past. And a stored octave above the
   * control's own bound is held to the same notes rather than climbing further,
   * which is the half `OCTAVE_MAX` itself still does.
   */
  it('reaches the last note MIDI has at the top of the control, and no further', () => {
    expect(extremesAt(OCTAVE_MAX).highest).toBe(127);
    expect(extremesAt(OCTAVE_MAX + 1).highest).toBe(extremesAt(OCTAVE_MAX).highest);
  });

  // Middle C, asserted as a number. Every voicing spec in the project stacks
  // from this note, and comparing them against the symbol that produced them
  // leaves the symbol itself free to be anything at all.
  it('stacks voicings from middle C', () => {
    expect(VOICING_BASE_MIDI).toBe(60);
  });

  // Both ends are taste, and both are pinned as taste. `voiceChord` never voices
  // below its base, so the MIDI floor alone would permit any OCTAVE_MIN down to
  // -5, and since Task 4b the MIDI ceiling permits any OCTAVE_MAX at all -
  // `chordOctaveCeiling` holds each chord where it fits whatever this pair says.
  // So neither number is derived, and a number chosen by ear is only auditable
  // if the spec says that is what it is.
  //
  // C2 is where the musical argument stops at the bottom: below the low E of a
  // guitar in standard tuning, and chords voiced under it are mud. C6 is where
  // it stops at the top: the highest note on the app's own 49- and 37-key
  // keyboards, one octave below its 61-key one.
  //
  // **`OCTAVE_MAX` was 1 here until the restoration**, and the assertion below
  // is the one place in the suite that fails on the value alone rather than on
  // something derived from it. That is deliberate: this is the spec whose job is
  // to notice.
  it('bounds the octave control by taste at both ends, not by arithmetic', () => {
    expect(OCTAVE_MIN).toBe(-2);
    expect(VOICING_BASE_MIDI + OCTAVE_MIN * 12).toBe(36);
    expect(OCTAVE_MAX).toBe(2);
    expect(VOICING_BASE_MIDI + OCTAVE_MAX * 12).toBe(84);
  });
});

describe('the note default', () => {
  // Pinned here as a number, because the only other spec that touches it -
  // `generateSlotNotes` giving every note the default velocity - compares the
  // generated notes against the imported constant, which holds for whatever the
  // constant happens to be. Without this line the fifteen lines of derivation
  // above `DEFAULT_VELOCITY` guard nothing at all.
  //
  // 80 is `mf` on the dynamics map MIDI writers share, and 80/127 is 0.63 -
  // inside the 0.5-1.0 the app's own keyboard strikes at, and at the bottom of
  // it, so a progression sits under a plucked note rather than over it.
  it('sounds every generated note at mf', () => {
    expect(DEFAULT_VELOCITY).toBe(80);
  });
});
