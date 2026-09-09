import {
  BEATS_PER_SLOT_DEFAULT,
  createOwnership
} from './progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  createDefaultProgression,
  createDegreeSlot
} from './progression.model';

/** The degree of a slot known to be a degree slot. */
function degreeOf(slot: ChordSlot): ChordDegree {
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return slot.harmony.degree;
}

describe('createDefaultProgression', () => {
  it('starts in C major, 4/4, at 120bpm with no slots', () => {
    const doc = createDefaultProgression();
    expect(doc.key.tonic).toBe(0);
    // `ionian` is what MusicTheoryService calls the major scale, and the id has
    // to resolve there or the palette has no intervals to stack thirds through.
    expect(doc.key).toEqual({ tonic: 0, scaleId: 'ionian', preferSharps: true });
    expect(doc.timeSignature).toEqual({ numerator: 4, denominator: 4, isCommon: true });
    expect(doc.tempo).toBe(120);
    expect(doc.slots).toEqual([]);
  });

  it('gives every progression its own slot array', () => {
    // structuredClone undo depends on nothing being shared between documents.
    const a = createDefaultProgression();
    const b = createDefaultProgression();
    expect(a.slots).not.toBe(b.slots);
  });

  it('gives every progression a distinct id', () => {
    expect(createDefaultProgression().id).not.toBe(createDefaultProgression().id);
  });
});

describe('createDegreeSlot', () => {
  it('starts a slot as an untouched triad in root position', () => {
    const slot = createDegreeSlot(0, 0);
    expect(slot.harmony).toEqual({
      kind: 'degree',
      // `quality` starts null - "as the key gives it" - rather than guessing a
      // shape the scale has not been consulted about.
      degree: { degree: 0, alter: 0, extent: 3, quality: null,
                inversion: 0, suspension: 'none', octave: 0 }
    });
    expect(slot.owned).toEqual(createOwnership());
    expect(slot.lengthBeats).toBe(BEATS_PER_SLOT_DEFAULT);
    expect(slot.notes).toEqual([]);
  });

  // Asserted as a number and not only against the symbol that produced it: a
  // comparison between a slot's length and the constant it came from holds for
  // whatever value the constant takes, so the default itself stays free to
  // drift. Four beats is one bar in 4/4, which is what makes a fresh chord
  // occupy a bar of the timeline.
  it('gives a fresh slot one bar in 4/4', () => {
    expect(BEATS_PER_SLOT_DEFAULT).toBe(4);
    expect(createDegreeSlot(0, 0).lengthBeats).toBe(4);
  });

  it('gives every slot a distinct id', () => {
    expect(createDegreeSlot(0, 0).id).not.toBe(createDegreeSlot(0, 0).id);
  });

  it('places the slot where it was asked for', () => {
    // Beats are floats by design, so a slot can start off the beat grid.
    expect(createDegreeSlot(4, 12).startBeat).toBe(12);
    expect(createDegreeSlot(4, 1.5).startBeat).toBe(1.5);
    expect(degreeOf(createDegreeSlot(4, 0)).degree).toBe(4);
  });

  // The same domain `degreePitchClasses` enforces. Catching it here means a bad
  // degree fails where it was introduced rather than later, inside generation,
  // with a document already holding a slot that can never be sounded.
  it('refuses a degree the diatonic stack cannot build', () => {
    expect(() => createDegreeSlot(7, 0)).toThrowError(/degree/);
    expect(() => createDegreeSlot(-1, 0)).toThrowError(/degree/);
    expect(() => createDegreeSlot(1.5, 0)).toThrowError(/degree/);
    expect(() => createDegreeSlot(NaN, 0)).toThrowError(/degree/);
  });

  // NaN in the time axis is the same failure as NaN in the pitch axis: it
  // reaches Tone as a schedule time rather than as a note, and nothing
  // downstream checks it.
  it('refuses a start beat that is not a real position', () => {
    expect(() => createDegreeSlot(0, NaN)).toThrowError(/startBeat/);
    expect(() => createDegreeSlot(0, Infinity)).toThrowError(/startBeat/);
    expect(() => createDegreeSlot(0, -1)).toThrowError(/startBeat/);
  });
});
