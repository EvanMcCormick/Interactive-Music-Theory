import { MusicTheoryService } from '../services/music-theory.service';
import { chordOctaveCeiling, generateSlotNotes } from '../services/progression-generate';
import {
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  noteCount
} from '../services/progression-harmony';
import { voiceChord } from '../services/progression-voicing';
import {
  ALTER_MAX,
  ALTER_MIN,
  CHORD_EXTENTS,
  OCTAVE_MAX,
  OCTAVE_MIN,
  VOICING_BASE_MIDI
} from './progression-normalize';
import { ChordDegree, ChordSlot, ProgressionKey, createDegreeSlot } from './progression.model';

/**
 * How far the widest chord the app can build reaches, and what holds it inside
 * MIDI: the sweep behind `OCTAVE_MIN` and `OCTAVE_MAX`.
 *
 * ## Why this is not in `progression-normalize.spec.ts`
 *
 * That file reached 1098 lines against the project's 1000-line cap, and this
 * describe was 434 of them - the one block whose removal settles it on its own.
 *
 * The seam is not chosen for its size, though. Everything left over there is
 * `normalizeChordSlot` and `normalizeProgressionDoc` reading a stored value and
 * deciding what it becomes: one field at a time, against a fixture a reader can
 * check by eye, with no music made and nothing slower than a clamp. What is here
 * makes music. It runs roughly five and a half million chords per octave through
 * `generateSlotNotes`, `voiceChord` and `chordOctaveCeiling` to measure a
 * **bound** - a fact about how wide the model can get - which is a different kind
 * of claim from a rule about the shape of a stored document, and it is by some
 * distance the slowest thing the two files held between them.
 *
 * `OCTAVE_MIN` and `OCTAVE_MAX` are declared in `progression-normalize.ts`
 * alongside everything the neighbour pins, which is why the block was written
 * there. Being where a constant is declared is not the same as being about what
 * the declaring module does, and the four specs at the end of this file that pin
 * the constants themselves say as much: they assert taste, not normalisation.
 *
 * The precedent is `progression-normalize.literal.spec.ts`, the sibling this
 * module already has: a second spec file for one module, named for the question
 * it answers, with its own local fixtures rather than a shared helper module for
 * two callers. `degreeOf` below is one line and is copied for that reason.
 *
 * Nothing else moved. Every assertion below stands exactly as it stood.
 */

/** The degree of a slot known to be a degree slot. */
function degreeOf(slot: ChordSlot): ChordDegree {
  if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
  return slot.harmony.degree;
}

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
   * pair is refused by `normalizeChordDegree`, which
   * `progression-normalize.spec.ts` pins, and `chordPitchClasses` refuses it
   * again - so the
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
