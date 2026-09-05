import { NotePitch, TimeSignature } from '../models/composer.model';
import { FinestDivision } from '../models/transcription.model';
import { PlacedNote, beatSlots, quantizeBar } from './transcription-quantize';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

const at = (beatInBar: number, fret: number): PlacedNote => ({
  beatInBar,
  pitch: { kind: 'fretted', string: 2, fret }
});

describe('quantizeBar', () => {
  it('fills an empty bar with exactly one bar of rests', () => {
    const beats = quantizeBar([], FOUR_FOUR, 16);

    expect(beats.every(beat => beat.isRest)).toBe(true);
    expect(beatSlots(beats, 16)).toBe(16);
  });

  it('writes four on-beat notes as four quarter notes', () => {
    const beats = quantizeBar([at(0, 0), at(1, 2), at(2, 4), at(3, 5)], FOUR_FOUR, 16);

    expect(beats.map(beat => beat.duration)).toEqual([4, 4, 4, 4]);
    expect(beats.every(beat => beat.dots === 0)).toBe(true);
  });

  it('snaps a marginally early onset onto the beat', () => {
    const beats = quantizeBar([at(0.97, 0)], FOUR_FOUR, 16);

    // A quarter rest, then the note holding the rest of the bar.
    expect(beats[0].isRest).toBe(true);
    expect(beatSlots([beats[0]], 16)).toBe(4);
  });

  it('merges notes landing on the same slot into one chord', () => {
    const beats = quantizeBar([at(0, 0), at(0.02, 2)], FOUR_FOUR, 16);

    expect(beats[0].notes.length).toBe(2);
  });

  it('ties across a span no single note value can express', () => {
    // Five sixteenths: a quarter tied to a sixteenth.
    const beats = quantizeBar([at(0, 0), at(1.25, 2)], FOUR_FOUR, 16);

    expect(beats[0].duration).toBe(4);
    expect(beats[1].duration).toBe(16);
    expect(beats[1].notes[0].isTied).toBe(true);
  });

  /**
   * Three tests on spelling, which is where longest-first decomposition on its
   * own goes wrong. It is handed a span length and nothing else, so it cannot
   * tell a value that fits from a value a reader can follow.
   */
  it('does not let a rest swallow the middle of the bar', () => {
    // One note on the "and of 4". The rest in front of it is three and a half
    // beats, which longest-first spells as a single double-dotted half rest -
    // a value that starts on beat 1 and hides every beat it crosses.
    const beats = quantizeBar([at(3.5, 5)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [2, 0, true],  // half rest, beats 1 and 2
      [4, 1, true],  // dotted quarter rest, up to the "and of 4"
      [8, 0, false]  // the eighth note itself
    ]);
  });

  it('keeps a 6/8 bar inside its two dotted-quarter groups', () => {
    const sixEight: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

    // A note on the second eighth, held to the bar line. Longest-first spells
    // it as a half note: five eighths' worth of value starting inside the
    // first group and ending inside the second, so neither group is visible.
    const beats = quantizeBar([at(1, 3)], sixEight, 8);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.isRest])).toEqual([
      [8, 0, true],   // eighth rest
      [4, 0, false],  // quarter, finishing the first group
      [4, 1, false]   // dotted quarter, the whole second group
    ]);
    expect(beats[2].notes[0].isTied).toBe(true);
  });

  it('ties a syncopated note across the beat rather than hiding it', () => {
    // Onsets on slots 0, 3 and 6 of a sixteenth grid. Longest-first gives the
    // last note a half note starting on the "and of 2".
    const beats = quantizeBar([at(0, 0), at(0.75, 2), at(1.5, 4)], FOUR_FOUR, 16);

    expect(beats.map(beat => [beat.duration, beat.dots, beat.notes[0].isTied])).toEqual([
      [8, 1, false],   // dotted eighth
      [16, 0, false],  // sixteenth, finishing beat 1
      [8, 0, true],    // tied into an eighth on beat 2
      [8, 0, false],   // eighth on the "and of 2"
      [2, 0, true]     // tied into the half that fills beats 3 and 4
    ]);
  });

  /**
   * `FinestDivision` rules out grids the duration table cannot express, but it
   * cannot rule out a grid coarser than the meter it is being applied to: 8 is
   * a perfectly good eighth-note grid, just not for a /16 bar. That stays a
   * runtime check.
   */
  it('rejects a grid coarser than the time signature', () => {
    const sixteenths: TimeSignature = { numerator: 4, denominator: 16, isCommon: false };

    expect(() => quantizeBar([], sixteenths, 8)).toThrowError(/finestDivision/);
  });

  /**
   * `FinestDivision` exists so no span can reach `slotsToDurations` that the
   * duration table cannot express - such a span under-sums silently rather
   * than failing. A fractional numerator is the one remaining way in, since
   * `TimeSignature` types the numerator as a bare number.
   */
  it('rejects a numerator that is not a whole number of beats', () => {
    const fractional: TimeSignature = { numerator: 2.5, denominator: 4, isCommon: false };

    expect(() => quantizeBar([], fractional, 16)).toThrowError(/numerator 2\.5/);
  });

  /**
   * The invariant the whole feature rests on. Independently snapping onsets to
   * a grid - the obvious approach, and what most transcribers do - produces
   * durations that overrun or underfill the bar, which is the root of the
   * ragged 32nd-note-and-tie mess such tools are known for.
   *
   * Length alone is not enough to pin that down: `beatSlots` never inspects
   * `notes` or `isRest`, so a `quantizeBar` that discarded its notes and
   * emitted a bar of rests would satisfy it for every case below. Nor is
   * counting the attacks: a `quantizeBar` that struck the right number of
   * slots with the wrong pitches on them would pass that too. So each case
   * reconstructs, from the emitted beats alone, which pitches are struck at
   * which slot offset, and compares that against the input.
   *
   * Struck notes, not non-rest beats: a span no single value can express is
   * split by `slotsToDurations` into several `BeatDoc`s for one onset, and the
   * continuation fragments are tied.
   */
  it('always produces exactly one bar of music, with every onset struck', () => {
    const signatures: TimeSignature[] = [
      { numerator: 4, denominator: 4, isCommon: true },
      { numerator: 3, denominator: 4, isCommon: false },
      { numerator: 6, denominator: 8, isCommon: false },
      { numerator: 5, denominator: 4, isCommon: false }
    ];

    for (const signature of signatures) {
      for (const finest of [8, 16, 32] as FinestDivision[]) {
        if (finest < signature.denominator) continue;

        const slotsPerBeat = finest / signature.denominator;
        const totalSlots = signature.numerator * slotsPerBeat;

        for (let seed = 0; seed < 20; seed++) {
          const notes: PlacedNote[] = Array.from({ length: seed % 7 }, (_, i) => ({
            beatInBar: (((seed * 7 + i * 13) % 100) / 100) * signature.numerator,
            pitch: { kind: 'fretted', string: 2, fret: i } as NotePitch
          }));

          const beats = quantizeBar(notes, signature, finest);

          expect(beatSlots(beats, finest)).toBe(totalSlots);

          // What should be struck where: onsets sharing a slot merge into one
          // chord, and an onset rounding past the final slot is pulled back
          // onto it.
          const bySlot = new Map<number, NotePitch[]>();
          for (const note of notes) {
            const slot = Math.min(
              totalSlots - 1,
              Math.max(0, Math.round(note.beatInBar * slotsPerBeat))
            );
            const chord = bySlot.get(slot);
            if (chord) chord.push(note.pitch);
            else bySlot.set(slot, [note.pitch]);
          }
          const expected = [...bySlot.keys()]
            .sort((a, b) => a - b)
            .map(slot => [slot, bySlot.get(slot)] as [number, NotePitch[]]);

          // What is struck where, read back out of the beats by accumulating
          // slot offsets. Only the offsets matter, not how many `BeatDoc`s a
          // span was spelled with.
          const struck: [number, NotePitch[]][] = [];
          let offset = 0;
          for (const beat of beats) {
            if (!beat.isRest && beat.notes.length > 0 && !beat.notes[0].isTied) {
              struck.push([offset, beat.notes.map(note => note.pitch)]);
            }
            offset += beatSlots([beat], finest);
          }

          expect(struck).toEqual(expected);

          // Redundant given the comparison above, but it says out loud the
          // thing a reader most wants guaranteed: no input note is dropped.
          expect(struck.reduce((sum, [, chord]) => sum + chord.length, 0))
            .toBe(notes.length);
        }
      }
    }
  });
});
