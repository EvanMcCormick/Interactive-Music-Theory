import {
  NamedQuality,
  QUALITY_INTERVALS,
  noteCount
} from '../services/progression-harmony';
import { generateSlotNotes } from '../services/progression-generate';
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
   * that proves `OCTAVE_MAX + 1` overflows MIDI deliberately asks for an octave
   * outside it - normalising here would turn that spec into a tautology.
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
   * So both are swept here. The cost is one full pass of roughly four million
   * chords per octave, which is the price of measuring the pipeline rather than
   * a model of it.
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
   * The witness is Hungarian minor, degree 5 at extent 13, altered down a tone
   * and overridden to `augmented7`, third inversion, in the key of G. The
   * override displaces the root to a shape the scale does not give that degree
   * and the four diatonic notes above it stay where they were, so the stack is
   * [6, 10, 14, 16, 23, 26, 30] - strictly ascending, so no artefact of the
   * lift - which carries the tonic to [13, 17, 21, 23, 30, 33, 37], rotates to
   * put 23 in the bass and voices from 60 to 71, 78, 81, 85, 97, 101, 105.
   *
   * The reach is spelled out here as well as asserted, because a bound derived
   * from a sweep is only auditable if the case that produced it is written down.
   */
  it('reaches 45 semitones above the base at its widest', () => {
    const base = VOICING_BASE_MIDI;
    const { lowest, highest } = extremesAt(0);
    // `voiceChord` never places a note below its base, so the base is the floor
    // exactly, and the reach is measured from it.
    expect(lowest).toBe(base);
    expect(highest - base).toBe(45);
  });

  /**
   * The witness itself, built by hand, so the sweep's answer has a case behind
   * it that a reader can check without running four million chords.
   */
  it('voices its widest chord where the sweep says it does', () => {
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

  // `voiceChord` has no MIDI clamp, so nothing below this stops an out-of-range
  // note reaching Tone.PolySynth. The bound is only defensible if it holds for
  // every scale the app offers, not just the two the plan works through.
  it('keeps every chord the app can build inside the MIDI range', () => {
    expect(extremesAt(OCTAVE_MIN).lowest).toBeGreaterThanOrEqual(0);
    expect(extremesAt(OCTAVE_MAX).highest).toBeLessThanOrEqual(127);
  });

  // And the top of the range is not arbitrary: it is the last octave that fits.
  it('stops at the highest octave that still fits inside MIDI 127', () => {
    expect(extremesAt(OCTAVE_MAX + 1).highest).toBeGreaterThan(127);
  });

  // Middle C, asserted as a number. Every voicing spec in the project stacks
  // from this note, and comparing them against the symbol that produced them
  // leaves the symbol itself free to be anything at all.
  it('stacks voicings from middle C', () => {
    expect(VOICING_BASE_MIDI).toBe(60);
  });

  // The floor is taste, and is pinned as taste. `voiceChord` never voices below
  // its base, so the MIDI floor alone would permit any OCTAVE_MIN down to -5 -
  // the arithmetic that fixes the ceiling says nothing at all about the bottom.
  // C2 is where the musical argument stops: below the low E of a guitar in
  // standard tuning, and chords voiced under it are mud rather than music.
  it('floors the octave control at C2 by taste, not by arithmetic', () => {
    expect(OCTAVE_MIN).toBe(-2);
    expect(VOICING_BASE_MIDI + OCTAVE_MIN * 12).toBe(36);
    expect(OCTAVE_MAX).toBe(1);
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
