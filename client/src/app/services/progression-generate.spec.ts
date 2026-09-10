import { chordOctaveCeiling, generateSlotNotes } from './progression-generate';
import { ChordExtent, NamedQuality, chordPitchClasses, noteCount } from './progression-harmony';
import { MusicTheoryService } from './music-theory.service';
import { voiceChord } from './progression-voicing';
import {
  DEFAULT_VELOCITY,
  OCTAVE_MAX,
  OCTAVE_MIN,
  VOICING_BASE_MIDI
} from '../models/progression-normalize';
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
   * This asserted octave 2 rather than 1, because 1 proves almost nothing.
   *
   * The voicing base is a floor, so a C major triad voiced from *any* base
   * between 61 and 72 comes out 72-76-79. At octave 1 the base is 72 and the
   * whole family `VOICING_BASE_MIDI + octave * n` for n from 1 to 12 lands
   * inside that window, so `* 6` and `* 1` both pass. At octave 2 the base is
   * 84, which no smaller multiplier reaches - so 84-88-91 was the assertion.
   *
   * **Task 4b took octave 2 away.** `chordOctaveCeiling` holds every chord at
   * `OCTAVE_MAX` or below, so 2 and 1 now sound the same and no positive octave
   * separates the multipliers any more. That is asserted here rather than left
   * as a spec that quietly stopped testing the thing its own note says it tests.
   *
   * The multiplier is pinned below instead, on the negative side, which is where
   * the ceiling does not reach: octave -2 puts the base at 36, where `* 6` would
   * put it at 48 and voice a different chord.
   */
  it('shifts the voicing base by the octave, and no higher than the ceiling', () => {
    expect(
      generateSlotNotes(slotWithDegree(0, { octave: OCTAVE_MAX }), C_MAJOR_KEY, MAJOR)
        .map(n => n.midi)
    ).toEqual([72, 76, 79]);
    expect(
      generateSlotNotes(slotWithDegree(0, { octave: 2 }), C_MAJOR_KEY, MAJOR).map(n => n.midi)
    ).toEqual([72, 76, 79]);
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
   * The characterization spec that used to stand here asserted the opposite,
   * and it was written to be deleted on purpose rather than to be right.
   *
   * `suspension` was stored on the model from M1 and deliberately not sounded,
   * because a half-implementation would have made slots that look suspended and
   * play major. That decision lived only in a comment until the spec pinned it,
   * and M3 Task 4 is the task that had to come and delete it: the alternative
   * was the real implementation looking like a no-op against a suite that never
   * noticed either way. This is that deletion, with the assertion turned round.
   *
   * Csus4 is C-F-G and Csus2 is C-D-G. The suspension is applied to the pitch
   * classes before voicing, like `alter`, so what changes is which note is
   * stacked rather than where the chord sits.
   */
  it('sounds a suspension in place of the third', () => {
    const plain = generateSlotNotes(
      slotWithDegree(0, { suspension: 'none' }), C_MAJOR_KEY, MAJOR
    );
    expect(plain.map(n => n.midi)).toEqual([60, 64, 67]);

    expect(
      generateSlotNotes(slotWithDegree(0, { suspension: 'sus4' }), C_MAJOR_KEY, MAJOR)
        .map(n => n.midi)
    ).toEqual([60, 65, 67]);
    expect(
      generateSlotNotes(slotWithDegree(0, { suspension: 'sus2' }), C_MAJOR_KEY, MAJOR)
        .map(n => n.midi)
    ).toEqual([60, 62, 67]);
  });

  /**
   * The other half of what the generator now hands over: a pinned extension.
   *
   * V9 in C major takes its ninth from the key, which gives an A - MIDI 81 over
   * a chord voiced from middle C. `ninth: -1` asks for the A flat a semitone
   * below it, and that is a G7♭9 the app could not build at all before M3.
   */
  it('sounds an altered extension', () => {
    expect(
      generateSlotNotes(slotWithDegree(4, { extent: 9 }), C_MAJOR_KEY, MAJOR)
        .map(n => n.midi)
    ).toEqual([67, 71, 74, 77, 81]);
    expect(
      generateSlotNotes(
        slotWithDegree(4, {
          extent: 9,
          extensions: { ninth: -1, eleventh: null, thirteenth: null }
        }),
        C_MAJOR_KEY,
        MAJOR
      ).map(n => n.midi)
    ).toEqual([67, 71, 74, 77, 80]);
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

/**
 * The ceiling is the chord's own, and this is where that is proved.
 *
 * `OCTAVE_MAX` is a bound on the *control*, and it is one number for every
 * chord. That was defensible while the widest chord the model could build
 * reached 46 semitones above its base: `OCTAVE_MAX` of 1 puts that at MIDI 118,
 * nine short of the end. M3 Task 4 widened the model to 58, which is 130, and
 * three notes past the end of MIDI is a chord `Tone.PolySynth` is handed
 * unclamped.
 *
 * The fix is not a smaller constant - that costs every chord the top octave to
 * accommodate one almost nobody will build - it is a ceiling derived per chord,
 * here, where the key and the scale are already in hand.
 *
 * **The property is now local, which is what makes it cheap.** The old bound
 * could only be shown maximal by sweeping the whole reachable universe: 236
 * million chords, thirteen minutes, and that sweep is now
 * `tools/measure-chord-reach.cjs` rather than a spec. What replaces it is two
 * halves checked on a sample:
 *
 *  - a chord voiced at its ceiling never passes MIDI 127, and
 *  - the ceiling is the *highest* octave for which that is true.
 *
 * Both halves matter. A ceiling that is merely safe rather than maximal costs
 * the user range without saying so, and would pass the first half alone.
 */
describe('chordOctaveCeiling', () => {
  /**
   * The sample: every heptatonic scale the app offers, every degree, every
   * extent, every inversion and every tonic, over a handful of shapes chosen to
   * include the exotics and the widest chord the model can build.
   *
   * Read from `MusicTheoryService.getScaleCategories()` for the reason the
   * octave describe in `progression-normalize.spec.ts` gives: that is where the
   * chord palette reads its scales from, so a scale reachable there is a scale
   * this property has to survive. Enigmatic, Hungarian minor, super locrian and
   * double harmonic are the ones that produce the widest stacks, and they are in
   * that list rather than beside it.
   */
  const APP_SCALES: readonly { id: string; intervals: readonly number[] }[] =
    new MusicTheoryService()
      .getScaleCategories()
      .flatMap(category => category.scales)
      .map(scale => ({ id: scale.id, intervals: scale.intervals }))
      .filter(scale => scale.intervals.length === 7);

  /**
   * The shape combinations swept, rather than their product.
   *
   * The full product is what the tool measures and what takes thirteen minutes.
   * These six are picked to span the mechanisms that make a chord wide: a
   * diatonic stack, an override that displaces the root, an added ninth in the
   * fourth position, a suspension that can land under the note above it, and the
   * two alterations that make the ascent lift stack. The last row is the
   * 58-semitone witness's own shape.
   */
  const SHAPES: readonly Partial<ChordDegree>[] = [
    { alter: 0, quality: null },
    { alter: -2, quality: 'diminished' },
    { alter: -2, quality: 'add9' },
    { alter: 2, quality: 'augmented7' },
    { alter: -2, quality: 'augmented7', suspension: 'sus2' },
    {
      alter: -2,
      quality: 'diminished',
      suspension: 'sus4',
      extensions: { ninth: -1, eleventh: null, thirteenth: -1 }
    }
  ];

  const EXTENTS: readonly ChordExtent[] = [3, 7, 9, 11, 13];

  /** The degree a slot built from these overrides actually stores. */
  function degreeFor(degree: number, overrides: Partial<ChordDegree>): ChordDegree {
    const slot = slotWithDegree(degree, overrides);
    if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
    return slot.harmony.degree;
  }

  /** The top note of a slot's chord, voiced at a given stored octave. */
  function topAt(
    degree: number,
    overrides: Partial<ChordDegree>,
    key: ProgressionKey,
    intervals: readonly number[]
  ): number {
    const notes = generateSlotNotes(slotWithDegree(degree, overrides), key, intervals);
    return notes[notes.length - 1].midi;
  }

  /**
   * Both halves of the property, over the sample.
   *
   * The maximality half is only asked where the ceiling is below `OCTAVE_MAX`.
   * At `OCTAVE_MAX` the ceiling is the control's bound rather than MIDI's, and
   * there is nothing for the arithmetic to be maximal about - the chord would
   * fit an octave higher and is not allowed to go there.
   */
  it('is the highest octave at which the chord still fits inside MIDI', () => {
    let checked = 0;
    let clamped = 0;
    // Violations are collected and asserted once rather than expected inside
    // the loop. Four expectations over four hundred thousand chords is one and
    // a half million Jasmine results for a spec that should report one line,
    // and the line it should report is *which chord* - which an expectation
    // inside the loop cannot say.
    const illegal: string[] = [];
    const overflowing: string[] = [];
    const timid: string[] = [];

    for (const scale of APP_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of EXTENTS) {
          for (const shape of SHAPES) {
            for (let inversion = 0; inversion < noteCount(extent); inversion++) {
              for (let tonic = 0; tonic < 12; tonic++) {
                const key: ProgressionKey = { tonic, scaleId: scale.id, preferSharps: true };
                const overrides = { ...shape, extent, inversion };
                const stored = degreeFor(degree, overrides);

                const ceiling = chordOctaveCeiling(key, scale.intervals, stored);
                checked++;
                const where = `${scale.id} degree ${degree} tonic ${tonic} ` +
                  `${JSON.stringify(overrides)} ceiling ${ceiling}`;

                // The bottom clamp never fires. It is there so the answer is
                // always a legal octave, and this records that it is never the
                // reason the answer is what it is - which is what keeps the MIDI
                // half unconditional rather than traded against the floor.
                if (ceiling < OCTAVE_MIN || ceiling > OCTAVE_MAX) illegal.push(where);

                const top = topAt(degree, { ...overrides, octave: ceiling }, key, scale.intervals);
                if (top > 127) overflowing.push(`${where} top ${top}`);

                if (ceiling < OCTAVE_MAX) {
                  clamped++;
                  // Voiced directly rather than through `generateSlotNotes`,
                  // which now declines to go there: the question is what the
                  // chord *would* have done, and only the unclamped pipeline
                  // answers it.
                  const raised = voiceChord(
                    chordPitchClasses(scale.intervals, stored)
                      .map(pitchClass => pitchClass + tonic),
                    inversion,
                    VOICING_BASE_MIDI + (ceiling + 1) * 12
                  );
                  const raisedTop = raised[raised.length - 1];
                  if (raisedTop <= 127) timid.push(`${where} would reach only ${raisedTop}`);
                }
              }
            }
          }
        }
      }
    }

    // The ceiling is always a legal octave, no chord voiced at its ceiling
    // passes 127, and no ceiling is lower than it had to be.
    expect(illegal.slice(0, 3)).toEqual([]);
    expect(overflowing.slice(0, 3)).toEqual([]);
    expect(timid.slice(0, 3)).toEqual([]);

    // The sweep ran, and it found chords on both sides of the question. A
    // sample that never reached a ceiling below `OCTAVE_MAX` would prove the
    // safe half and nothing at all about the maximal one. 25 is the inversion
    // count summed over the five extents: 3 + 4 + 5 + 6 + 7.
    expect(checked).toBe(APP_SCALES.length * 7 * 25 * SHAPES.length * 12);
    expect(clamped).toBeGreaterThan(0);
  });

  /**
   * The witness, by hand.
   *
   * C major's degree 3 at extent 13, altered down a tone and overridden to
   * `diminished`, suspended at the fourth with a flattened ninth and a flattened
   * thirteenth, second inversion, in D. It reaches 58 semitones above its base -
   * the widest the M3 model can build - so its ceiling is 0 where an ordinary
   * chord's is 1: 60 + 58 is 118, and one octave higher is 130.
   */
  const WITNESS: Partial<ChordDegree> = {
    extent: 13,
    alter: -2,
    quality: 'diminished',
    suspension: 'sus4',
    extensions: { ninth: -1, eleventh: null, thirteenth: -1 },
    inversion: 2
  };
  const D_MAJOR_KEY: ProgressionKey = { tonic: 2, scaleId: 'ionian', preferSharps: true };

  it('gives the widest chord in the model a ceiling of 0', () => {
    expect(chordOctaveCeiling(D_MAJOR_KEY, MAJOR, degreeFor(3, WITNESS))).toBe(0);
  });

  it('gives an ordinary chord the whole of the control', () => {
    expect(chordOctaveCeiling(C_MAJOR_KEY, MAJOR, degreeFor(0, {}))).toBe(OCTAVE_MAX);
  });

  /**
   * What the clamp is for, end to end: the slot stores `OCTAVE_MAX` and sounds
   * at 0, rather than sounding three notes off the end of MIDI.
   *
   * Both stored octaves produce the same notes, which is the clamp doing its one
   * job. What is *not* here is a rewrite of the stored value - see
   * `ProgressionService.slotOctave` for why the request survives being clamped.
   */
  it('voices a chord that would overflow an octave lower instead', () => {
    const atZero = generateSlotNotes(
      slotWithDegree(3, { ...WITNESS, octave: 0 }), D_MAJOR_KEY, MAJOR
    ).map(note => note.midi);
    const atMax = generateSlotNotes(
      slotWithDegree(3, { ...WITNESS, octave: OCTAVE_MAX }), D_MAJOR_KEY, MAJOR
    ).map(note => note.midi);

    expect(atZero).toEqual([71, 78, 90, 97, 109, 113, 118]);
    expect(atMax).toEqual(atZero);
  });

  /**
   * And the clamp is not a blanket octave down. An ordinary chord at
   * `OCTAVE_MAX` still sounds at `OCTAVE_MAX`, which is exactly the half that
   * dropping the constant to 0 would have taken from every chord in the app.
   */
  it('leaves a chord that fits exactly where it was asked for', () => {
    expect(
      generateSlotNotes(
        slotWithDegree(0, { octave: OCTAVE_MAX }), C_MAJOR_KEY, MAJOR
      ).map(note => note.midi)
    ).toEqual([72, 76, 79]);
  });

  /**
   * A slot below its ceiling is untouched, including the widest chord there is.
   * The ceiling is a maximum and not a target, so `Math.min` is the whole rule.
   */
  it('does not raise a chord voiced below its ceiling', () => {
    expect(
      generateSlotNotes(
        slotWithDegree(3, { ...WITNESS, octave: OCTAVE_MIN }), D_MAJOR_KEY, MAJOR
      ).map(note => note.midi)
    ).toEqual([47, 54, 66, 73, 85, 89, 94]);
  });

  // The guards below it still reach the caller: the ceiling for a chord that
  // cannot be built is not a number, it is a question with no answer.
  it('refuses a scale and a shape the chord builder refuses', () => {
    expect(() => chordOctaveCeiling(C_MAJOR_KEY, PENTATONIC, degreeFor(0, {})))
      .toThrowError(/heptatonic/);
    expect(() => chordOctaveCeiling(C_MAJOR_KEY, MAJOR, { ...degreeFor(0, {}), alter: 1 }))
      .toThrowError(/quality/i);
  });
});
