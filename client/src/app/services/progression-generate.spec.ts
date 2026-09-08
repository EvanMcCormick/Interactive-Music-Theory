import { generateSlotNotes } from './progression-generate';
import {
  DEFAULT_VELOCITY,
  ProgressionKey,
  RollNote,
  createDegreeSlot
} from '../models/progression.model';

const C_MAJOR_KEY: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
const A_MINOR_KEY: ProgressionKey = { tonic: 9, scaleId: 'aeolian', preferSharps: false };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTATONIC = [0, 2, 4, 7, 9];

/** A slot with one or more of its degree fields overridden. */
function slotWithDegree(
  degree: number,
  overrides: { alter?: number; extent?: 3 | 7 | 9; inversion?: number; octave?: number }
): ReturnType<typeof createDegreeSlot> {
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
    // D F A above middle C.
    expect(notes.map(n => n.midi % 12).sort()).toEqual([2, 5, 9]);
  });

  it('holds every note for the whole slot', () => {
    const slot = { ...createDegreeSlot(0, 0), lengthBeats: 2 };
    const notes = generateSlotNotes(slot, C_MAJOR_KEY, MAJOR);
    expect(notes.every(n => n.startBeat === 0 && n.lengthBeats === 2)).toBeTrue();
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

  it('shifts the voicing base by the octave', () => {
    const notes = generateSlotNotes(slotWithDegree(0, { octave: 1 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([72, 76, 79]);
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
   */
  it('alters the pitch classes before they are voiced, not the notes after', () => {
    const notes = generateSlotNotes(slotWithDegree(0, { alter: -1 }), C_MAJOR_KEY, MAJOR);
    expect(notes.map(n => n.midi)).toEqual([71, 75, 78]);
  });

  // The guard belongs to `degreePitchClasses` and is deliberately not repeated
  // here; this pins that it still reaches the caller rather than being caught
  // and turned into an empty chord that would fail as silence.
  it('refuses a scale that has no diatonic thirds', () => {
    expect(() => generateSlotNotes(createDegreeSlot(0, 0), C_MAJOR_KEY, PENTATONIC))
      .toThrowError(/heptatonic/);
  });
});
