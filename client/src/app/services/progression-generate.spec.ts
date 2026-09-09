import { generateSlotNotes } from './progression-generate';
import { NamedQuality } from './progression-harmony';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  RollNote,
  createDegreeSlot
} from '../models/progression.model';

const C_MAJOR_KEY: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const A_MINOR_KEY: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTATONIC = [0, 2, 4, 7, 9];

/**
 * A slot with one or more of its degree fields overridden.
 *
 * The overrides are typed as `Partial<ChordDegree>` and the return as
 * `ChordSlot`, rather than as a hand-listed object and `ReturnType<typeof
 * createDegreeSlot>`: both of those are second definitions of concepts the
 * project already has - `ChordExtent` in particular, whose ladder runs to 13
 * where the local copy stopped at 9 - and a second definition is the thing that
 * drifts.
 */
function slotWithDegree(degree: number, overrides: Partial<ChordDegree>): ChordSlot {
  const slot = createDegreeSlot(degree, 0);
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return {
    ...slot,
    harmony: { kind: 'degree', degree: { ...slot.harmony.degree, ...overrides } }
  };
}

describe('generateSlotNotes', () => {
  it('sounds a C major triad for a I in C major', () => {
    const slot = createDegreeSlot(0, 0);
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([60, 64, 67]);
  });

  // The end-to-end check that harmony, the tonic offset and voicing compose:
  // the Captain Chords screenshot shows iv in A minor as D min, and nothing
  // short of all three steps being right produces D F A.
  it('sounds a D minor triad for a iv in A minor', () => {
    const slot = createDegreeSlot(3, 0);
    const notes = generateSlotNotes(slot, A_MINOR_KEY, NATURAL_MINOR);
    // D F A above middle C. Sorted numerically rather than with a bare
    // `.sort()`, which orders lexicographically: harmless for [2, 5, 9] and
    // wrong the moment a chord holds pitch class 10 or 11.
    expect(notes.map(n => n.midi % 12).sort((a, b) => a - b)).toEqual([2, 5, 9]);
  });

  it('holds every note for the whole slot', () => {
    const slot = { ...createDegreeSlot(0, 0), lengthBeats: 2 };
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.every(n => n.startBeat === 0 && n.lengthBeats === 2)).toBeTrue();
  });

  // Every other spec here builds its slot at beat 0, where a generator that
  // copied `slot.startBeat` onto its notes would be indistinguishable from one
  // that writes 0. `ProgressionService`'s `reflow` gives every slot after the
  // first a non-zero `startBeat`, so that mutant would ship and break the
  // invariant the docstring states - and it would break it on the second
  // chord, not the first.
  it('numbers a note from its own slot, not from the timeline', () => {
    const slot = createDegreeSlot(0, 8);
    expect(slot.startBeat).toBe(8);
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.every(n => n.startBeat === 0)).toBeTrue();
  });

  it('returns the slot notes unchanged when the slot is literal', () => {
    const existing: RollNote[] = [{ midi: 61, startBeat: 0, lengthBeats: 1, velocity: 90 }];
    const slot = {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal' as const, reason: 'unrecognised' as const },
      notes: existing
    };
    expect(generateSlotNotes(slot, C_MAJOR_KEY, MAJOR)).toEqual(existing);
  });

  // Not merely "equal to": a literal slot's notes are the playback truth, so
  // handing back a rebuilt copy would let a caller that compares by identity -
  // change detection, an undo diff - see an edit that never happened.
  it('hands back the very array a literal slot holds', () => {
    const existing: RollNote[] = [{ midi: 61, startBeat: 0, lengthBeats: 1, velocity: 90 }];
    const slot = {
      ...createDegreeSlot(0, 0),
      harmony: { kind: 'literal' as const, reason: 'user-detached' as const },
      notes: existing
    };
    expect(generateSlotNotes(slot, C_MAJOR_KEY, MAJOR)).toBe(existing);
  });

  it('gives every generated note the default velocity', () => {
    const notes = generateSlotNotes(createDegreeSlot(0, 0), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.velocity)).toEqual([
      DEFAULT_VELOCITY, DEFAULT_VELOCITY, DEFAULT_VELOCITY
    ]);
  });

  it('adds a note per third when the extent grows', () => {
    // V7 in C major is G B D F.
    const notes = generateSlotNotes(slotWithDegree(4, { extent: 7 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([67, 71, 74, 77]);
  });

  it('inverts the chord it voices', () => {
    const notes = generateSlotNotes(slotWithDegree(0, { inversion: 1 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([64, 67, 72]);
  });

  /**
   * Octave 2 rather than 1, because 1 proves almost nothing.
   *
   * The voicing base is a floor, so a C major triad voiced from *any* base
   * between 61 and 72 comes out 72-76-79. At octave 1 the base is 72 and the
   * whole family `VOICING_BASE_MIDI + octave * n` for n from 1 to 12 lands
   * inside that window, so `* 6` and `* 1` both pass. At octave 2 the base is
   * 84, which no smaller multiplier reaches.
   */
  it('shifts the voicing base by the octave', () => {
    const notes = generateSlotNotes(slotWithDegree(0, { octave: 2 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([84, 88, 91]);
  });

  // The other direction, which nothing here tested: a multiplier is only
  // pinned by a case on each side of zero, and `octave` is the one control on
  // the chord that goes negative. C2, the bottom of the range.
  it('shifts the voicing base down for a negative octave', () => {
    const notes = generateSlotNotes(slotWithDegree(0, { octave: -2 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([36, 40, 43]);
  });

  /**
   * `alter` goes into the pitch classes *before* voicing, not onto the MIDI
   * notes after it, and the difference is audible rather than notational.
   *
   * A I in C flattened by a semitone is B-D#-F#. Altering first, the base is a
   * floor that B is below, so the whole chord is voiced from the B *above*
   * middle C: 71-75-78. Altering afterwards would just slide the voiced
   * 60-64-67 down to 59-63-66, which starts below the base the caller asked
   * for. The model's `OCTAVE_MAX` reach was measured over the first ordering,
   * so reversing it would invalidate that bound as well as move the chord.
   *
   * The quality is explicit because `alter` now displaces the root alone and
   * needs a shape to build on it - a chromatic root under a null quality is
   * refused. `'major'` is what the key gives degree 0 anyway, so the notes are
   * the same ones this spec has always asserted: this is the ordering it tests,
   * not the correction.
   */
  it('alters the pitch classes before they are voiced, not the notes after', () => {
    const notes = generateSlotNotes(
      slotWithDegree(0, { alter: -1, quality: 'major' }), C_MAJOR_KEY, MAJOR
    );
    expect(notes.map(n => n.midi)).toEqual([71, 75, 78]);
  });

  /**
   * A characterization spec: this pins what the code does today, not what it
   * ought to do.
   *
   * `suspension` is stored on the model and deliberately not sounded until M2,
   * and until now that decision lived only in a comment. A comment is not a
   * gate. Written down as a spec, M2 has to delete this one on purpose to make
   * sus4 sound suspended, which is the point - the alternative is a
   * half-implementation arriving silently, or M2's real one looking like a
   * no-op against a suite that never noticed either way.
   */
  it('does not yet sound a suspension', () => {
    const plain = generateSlotNotes(
      slotWithDegree(0, { suspension: 'none' }), C_MAJOR_KEY, MAJOR
    );
    const suspended = generateSlotNotes(
      slotWithDegree(0, { suspension: 'sus4' }), C_MAJOR_KEY, MAJOR
    );
    expect(suspended.map(n => n.midi)).toEqual(plain.map(n => n.midi));
    // Spelled out as well as compared, so the spec still means something if
    // both branches break together.
    expect(suspended.map(n => n.midi)).toEqual([60, 64, 67]);
  });

  // The guard belongs to `degreePitchClasses` and is deliberately not repeated
  // here; this pins that it still reaches the caller rather than being caught
  // and turned into an empty chord that would fail as silence.
  it('refuses a scale that has no diatonic thirds', () => {
    expect(() => generateSlotNotes(createDegreeSlot(0, 0), C_MAJOR_KEY, PENTATONIC))
      .toThrowError(/heptatonic/);
  });

  /**
   * `'other'` names no interval set, so it can be neither an override nor a
   * stored value: `ChordDegree.quality` is `NamedQuality | null` and
   * `normalizeChordDegree` refuses `'other'` at the door.
   *
   * This function used to map it to "no override" on its way in, because
   * `regenerateSlot` wrote the *derived* label into the same field and Hungarian
   * minor's second degree derives as `'other'` - so the field carried a label as
   * often as an override, and passing it through crashed the builder. Both are
   * gone together: nothing writes a label there, nothing stores one, and the
   * refusal reaches the caller rather than being laundered into a chord that
   * would sound plausible and mean nothing.
   *
   * Pinned here because this function is public and takes a slot from anywhere.
   */
  it('refuses a stored quality that names no shape', () => {
    const hungarianMinor = [0, 2, 3, 6, 7, 8, 11];
    const key: ProgressionKey = { tonic: 0, scaleId: 'hungarianMinor', preferSharps: true };

    expect(() => generateSlotNotes(
      slotWithDegree(1, { quality: 'other' as NamedQuality }), key, hungarianMinor
    )).toThrowError(/other/i);
  });
});
