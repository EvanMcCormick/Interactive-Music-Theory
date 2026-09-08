import {
  ChordExtent,
  degreePitchClasses,
  noteCount
} from '../services/progression-harmony';
import { voiceChord } from '../services/progression-voicing';
import { MusicTheoryService } from '../services/music-theory.service';
import {
  BEATS_PER_SLOT_DEFAULT,
  ChordDegree,
  ChordSlot,
  OCTAVE_MAX,
  OCTAVE_MIN,
  VOICING_BASE_MIDI,
  createDefaultProgression,
  createDegreeSlot,
  normalizeChordSlot
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
      degree: { degree: 0, alter: 0, extent: 3, quality: 'major',
                inversion: 0, suspension: 'none', octave: 0 }
    });
    expect(slot.isHandEdited).toBeFalse();
    expect(slot.lengthBeats).toBe(BEATS_PER_SLOT_DEFAULT);
    expect(slot.notes).toEqual([]);
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
  it('clamps an alteration beyond a whole tone', () => {
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: 5 }))).alter).toBe(2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: -5 }))).alter).toBe(-2);
    expect(degreeOf(normalizeChordSlot(slotWithDegree({ alter: -1 }))).alter).toBe(-1);
  });

  it('refuses an alteration that is not a whole number', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ alter: NaN }))).toThrowError(/alter/);
  });

  // Not a taste call: `noteCount` reads an extent that is not a stacked third
  // as a fractional note count, and the chord comes out with a note too many.
  it('refuses an extent that is not a stacked third', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ extent: 5 }))).toThrowError(/extent/);
    expect(() => normalizeChordSlot(slotWithDegree({ extent: NaN }))).toThrowError(/extent/);
  });

  it('refuses a degree the diatonic stack cannot build', () => {
    expect(() => normalizeChordSlot(slotWithDegree({ degree: 7 }))).toThrowError(/degree/);
  });

  it('refuses a slot length that is not a real duration', () => {
    const slot = createDegreeSlot(0, 0);
    expect(() => normalizeChordSlot({ ...slot, lengthBeats: 0 })).toThrowError(/lengthBeats/);
    expect(() => normalizeChordSlot({ ...slot, lengthBeats: -2 })).toThrowError(/lengthBeats/);
    expect(() => normalizeChordSlot({ ...slot, lengthBeats: NaN })).toThrowError(/lengthBeats/);
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

describe('the octave bound', () => {
  const EXTENTS: ChordExtent[] = [3, 7, 9, 11, 13];

  /** The extremes of every chord this app can build, voiced at `octave`. */
  function extremesAt(octave: number): { lowest: number; highest: number } {
    const scales = new MusicTheoryService()
      .getScaleCategories()
      .flatMap(category => category.scales)
      .filter(scale => scale.intervals.length === 7);
    expect(scales.length).toBeGreaterThan(0);

    const base = VOICING_BASE_MIDI + octave * 12;
    let lowest = Infinity;
    let highest = -Infinity;

    for (const scale of scales) {
      for (let degree = 0; degree < 7; degree++) {
        for (const extent of EXTENTS) {
          const pitchClasses = degreePitchClasses(scale.intervals, degree, extent);
          for (let inversion = 0; inversion < noteCount(extent); inversion++) {
            for (const midi of voiceChord(pitchClasses, inversion, base)) {
              lowest = Math.min(lowest, midi);
              highest = Math.max(highest, midi);
            }
          }
        }
      }
    }
    return { lowest, highest };
  }

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
});
