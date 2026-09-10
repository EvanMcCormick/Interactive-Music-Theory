import { CHORD_EXTENTS, SUSPENSIONS } from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ExtensionAlterations,
  ProgressionKey,
  SuspensionKind,
  createDegreeSlot
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import {
  ChordExtent,
  NamedQuality,
  QUALITY_INTERVALS,
  chordPitchClasses,
  effectiveChord,
  isHeptatonic,
  noteCount
} from './progression-harmony';
import { MusicTheoryService } from './music-theory.service';
import { parseChord } from './progression-parse';
import { recognise } from './progression-recognise';

/**
 * Generate a chord's notes, read them back, and get the same chord.
 *
 * Split out of `progression-recognise.spec.ts` when that file reached the
 * 1000-line cap, along the seam its own note already drew: over there every
 * fixture is one chord and one edit, written out in MIDI notes a reader can
 * check by eye, and the question is what the recogniser says about it. Here
 * there are no fixtures at all until the exceptions, only a sweep - 22,166
 * chords built by the model and handed straight back to it - and the question
 * is whether anything at all comes back different from what went in.
 *
 * The precedent is `progression-harmony.identity.spec.ts`, which came out of its
 * own neighbour the same way: a second spec file for one module, named for the
 * question it answers, with its own local fixtures rather than a shared helper
 * module for two callers.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const NO_EXTENSIONS = { ninth: null, eleventh: null, thirteenth: null };

/** A slot on a degree of a key, with the notes the generator would give it. */
function degreeSlot(
  degree: number,
  overrides: Partial<ChordDegree>,
  key: ProgressionKey,
  scale: readonly number[]
): ChordSlot {
  const fresh = createDegreeSlot(degree, 0);
  if (fresh.harmony.kind !== 'degree') throw new Error('unreachable');

  const labelled: ChordSlot = {
    ...fresh,
    harmony: { kind: 'degree', degree: { ...fresh.harmony.degree, ...overrides } }
  };
  return { ...labelled, notes: [...generateSlotNotes(labelled, key, scale)] };
}

/** The harmony fields of a degree, which is what a relabel is judged on. */
function harmonyOf(degree: ChordDegree): Partial<ChordDegree> {
  return {
    degree: degree.degree,
    alter: degree.alter,
    extent: degree.extent,
    quality: degree.quality,
    suspension: degree.suspension,
    extensions: degree.extensions
  };
}

/** A shorthand for the six harmony fields, defaulted to a plain triad. */
function harmony(overrides: Partial<ChordDegree> = {}): Partial<ChordDegree> {
  return {
    degree: 0,
    alter: 0,
    extent: 3,
    quality: null,
    suspension: 'none',
    extensions: NO_EXTENSIONS,
    ...overrides
  };
}

/**
 * The sweep itself, and the two classes of exception it allows.
 *
 * This is the property the whole module is for: every chord the model can build
 * must survive the trip through `RollNote.midi` and back to a `ChordDegree` with
 * the same fields still `null`. `recognise` is asked with an empty set of
 * "before" notes so the quiet rule cannot answer for it, and against the slot's
 * own harmony so the current root is its own - which is the situation a user is
 * in when they edit one note of a chord and edit it back.
 *
 * ## What is swept, and what is sampled
 *
 * - **Every heptatonic scale the app offers**, at every degree, every extent and
 *   every suspension, with nothing overridden and nothing pinned.
 * - **The seven diatonic modes**, at every degree, with every named quality and
 *   every `alter` in -1..1.
 * - **The extension axis, sampled**: the seven diatonic modes at every degree,
 *   with one extension pinned at a time to each alteration a `ChordDegree` can
 *   store, at each extent that reaches it.
 * - **The suspension axis crossed with both**: the seven diatonic modes at every
 *   degree, `sus2` and `sus4` against every named quality at every extent, and
 *   against each single extension pin. Added on 2026-09-10, after the three
 *   blocks above were found to leave suspension crossed with nothing at all -
 *   and a suspended chord on a diminished shape turned out to be the one the
 *   recogniser could not read back. `'none'` is left out of this block only
 *   because the two above already sweep it.
 *
 * What is still *not* crossed, named because a sweep that says what it covers
 * and not what it skips reads as though it covered everything:
 *
 *  - **Quality against the extension pins** - a `V7♭9` with an override on it.
 *  - **Two or three extensions pinned at once.**
 *  - **`alter` against anything but quality** - no displaced root is swept with a
 *    suspension or with a pin.
 *  - **The 26 non-diatonic heptatonic scales against quality, `alter` or pins.**
 *    They get the first block only.
 *
 * The full product is 1.27 million chords and several minutes, where this spec
 * has a five-second budget. Each of the four is a place a bug could still be.
 *
 * ## Chords with no identity to preserve
 *
 * A chord whose own `effectiveChord` reads `base: 'other'` is skipped. It has no
 * name to come back with - the card prints `?` and the fretboard lights nothing
 * - so there is no round trip to make. There are between 21 and 52 of them per
 * extent across the 33 scales, pinned next door in
 * `progression-harmony.identity.spec.ts`.
 *
 * ## The two exception classes
 *
 * **Overloaded** - the class the plan named, and one clause wider than it was
 * written. A stack in which two notes fill one *role*: the same letter-step, or
 * the same pitch class. The plan listed the four the model reaches on purpose -
 * a sus4 at extent 11 and above, a sus2 at 9 and above, an `add9` above 7, an
 * added sixth under a thirteenth - and named the exotic-scale case where a
 * diatonic extension lands on a chord tone the chord already has. Reading starts
 * from a set of pitch classes, so the second copy is not there to be read, and
 * the chord comes back at the height of its distinct notes.
 *
 * **That last sentence is an assertion here and not a description.** The class
 * was decided from `identity.steps` and the stack alone until 2026-09-10 -
 * properties of the *input* - and returned before `result` was looked at, so
 * 1,852 of the sweep's 12,968 chords passed whatever came back - and 219 of
 * those, re-measured through the test below, were not at that height at all. So
 * the class is now split on the output, three ways, and the third is the one
 * that had to be named rather than asserted away:
 *
 *  - **`atHeight`** - `atDistinctHeight` below: every pitch class the slot
 *    sounded is in what came back, and the only note added is the fifth the
 *    parse fills in. This is the plan's promise, kept.
 *  - **`refused`** - came back `literal`. 254 of them at the last measurement,
 *    down from 219 in a sweep a third the size, and they are the half of the
 *    plan's promise that does not hold: the notes are readable and the reading
 *    is not writable. Two reasons, one for each way a role is overloaded, and a
 *    fixture for each sits under `overloaded, refused` below:
 *
 *      - **The first opening wins even when it has no name.** `parseChord`
 *        returns the first opening that consumes every note. Hungarian minor's
 *        `III` suspended by a second at extent 9 sounds a ♯9 as well, and the
 *        parse takes the ♯9 for a minor third and reads `[0, 3, 8, 11]`, which
 *        is in no table and which no `ChordDegree` builds - where the sus2
 *        reading of the same four notes is the chord the slot was built from.
 *      - **The distinct notes are no stack of thirds.** Major's `III` as an
 *        `add9` suspended by a second at extent 9 sounds {E, F, F♯, B}: drop
 *        the doubled F♯ and the semitone cluster that is left parses from no
 *        root at all. There is no chord at the height of those distinct notes,
 *        so there was never an answer for the reading to find.
 *
 *    Unlabelled rather than mislabelled is the rule the strip is built on, so
 *    `literal` is honest here and not wrong. It is counted rather than folded
 *    into `atHeight` because it is a smaller answer than the plan promised, and
 *    it is held to a ceiling rather than a figure so that the bucket may shrink
 *    and may not grow.
 *  - **`notAtHeight`** - anything else, which is a chord that came back labelled
 *    with notes the slot is not playing. Asserted empty, with traces.
 *
 * The clause the plan did not have is the *letter-step* half. `add9` at extent 9
 * on a displaced root sounds two different ninths - the shape's own, a major
 * ninth above the moved root, and the key's, which the extent added above it -
 * and they are two distinct pitch classes filling one position in the stack. A
 * parse has one ninth to give. Same failure, one axis over: the model built a
 * chord with two notes in one role, and a reading has one slot for it.
 *
 * **Respelt.** One chord, two ways for the model to write it down. Two things
 * fall in here, and the sweep tells them apart from a bug by building both the
 * original and what came back and checking they sound exactly the same notes.
 *
 *  - **A redundant override dropped.** A `I` carrying `quality: 'major'` in a
 *    major key comes back with `quality: null`, because "as the key gives it" is
 *    the reading `expressInKey` prefers and the ranking counts. That is the
 *    feature rather than the exception - it is what makes a recognised chord
 *    re-voice on a key change - and it is why the sweep's own test is "sounds
 *    the same" rather than "stores the same".
 *  - **A displaced root renumbered.** ♭VII and ♯VI in C major are one chord, and
 *    `alter` is what lets the model say it twice. Notes carry no letters, so the
 *    recogniser cannot know from them which was meant - and the ruling of
 *    2026-09-10 is that it should not have to guess: the numeral the slot is
 *    already carrying decides, so this half of the class is now **empty on a
 *    root that did not move**, which is every root the sweep sends round. It was
 *    3,136 of the 5,565 before the clause, and 1,911 of those now come back
 *    field for field rather than respelt at all.
 *
 * Two assertions hold the class down, and the second is the ruling's:
 *
 *  - **No chord whose `alter` was 0 is ever renumbered.** A chord on its own
 *    degree comes back on its own degree, so nothing a user reaches through the
 *    palette's diatonic rows can change numeral by having a note edited and
 *    edited back.
 *  - **No chord whose root did not move is renumbered at all**, diatonic or
 *    chromatic, which is the wider statement the clause makes true. The root a
 *    chord came back on is read with `effectiveChord`, the same way the original
 *    one is, so the two are compared as pitch classes rather than as spellings -
 *    which is the whole point: it is the *spelling* that is being preserved.
 *
 * A failure that is neither is a bug in the parse or in `expressInKey`, and the
 * sweep asserts there are none. Five were found this way while this spec was
 * being written, and every one is fixed in the module rather than exempted here:
 * the two rungs that needed backtracking (`OPENINGS` and `FIFTHS`), the eleventh
 * that a sus2 does not spend, the extension a suspension implies, and the order
 * `degreeCandidates` ranks a root's degrees in.
 */
describe('the round trip', () => {
  const APP_SCALES: readonly (readonly number[])[] = new MusicTheoryService()
    .getScaleCategories()
    .flatMap(category => category.scales)
    .map(scale => scale.intervals)
    .filter(intervals => isHeptatonic(intervals));

  /** The seven modes of the major scale, which is the sweep's dense axis. */
  const DIATONIC_MODES: readonly (readonly number[])[] = [0, 1, 2, 3, 4, 5, 6].map(mode =>
    [0, 1, 2, 3, 4, 5, 6].map(step => (MAJOR[(mode + step) % 7] - MAJOR[mode] + 12) % 12)
  );

  const KEY: ProgressionKey = { tonic: 0, scaleId: 'swept', preferSharps: true };

  type Outcome = 'unchanged' | 'overloaded' | 'respelt' | 'bug';

  const counts: Record<Outcome, number> = {
    unchanged: 0,
    overloaded: 0,
    respelt: 0,
    bug: 0
  };
  const bugs: string[] = [];
  /**
   * The overloaded class split on the *output*, which is what it was never
   * examined on. See the class's note above for the three buckets and for what
   * each of them is allowed to be.
   */
  const overloaded = { atHeight: 0, refused: 0, notAtHeight: 0 };
  const overloadedTraces: string[] = [];
  /**
   * The bug class split by how it failed. A slot that lost its numeral is a
   * degradation the user can see; one that came back sounding a note the slot
   * is not playing is the silent mislabel the design says must never happen,
   * and it is the worse of the two. Both are asserted at zero.
   */
  const failures = { literal: 0, mislabelled: 0 };
  /**
   * The respelt class split in two: a chord that came back on another numeral,
   * against one that came back on its own numeral with a field the key already
   * gives no longer pinned. Since the ruling of 2026-09-10 the first half is
   * only reachable where the root moved, and the sweep never moves one.
   */
  const respelt = { renumbered: 0, sameNumeral: 0 };
  /** A respelling of a chord that was never displaced would be a bug. */
  const respeltDiatonic: string[] = [];
  /** And so, since the ruling, would any renumbering of an unmoved root. */
  const respeltInPlace: string[] = [];

  /** A stack as the set of pitch classes it sounds, which is all a slot plays. */
  function pitchClassesOf(stack: readonly number[]): Set<number> {
    return new Set(stack.map(pitch => ((pitch % 12) + 12) % 12));
  }

  function sameNotes(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
    return left.size === right.size && [...left].every(member => right.has(member));
  }

  /**
   * Whether an overloaded chord came back **at the height of its distinct
   * notes** - the outcome the plan promised that class and the sweep did not
   * check.
   *
   * Two conditions, and the second is what keeps this from being a rubber
   * stamp. Every pitch class the slot sounded has to be in what came back, so
   * nothing was dropped; and the only note that may have been *added* is the
   * perfect fifth `parseChord` fills in for a stack that was not sounding one,
   * which is the one guess the reading is allowed to make. An overloaded chord
   * coming back one note shorter is exactly right - that is what losing the
   * duplicate means - so the sizes are deliberately not compared for equality.
   *
   * The fifth is a real allowance and not a formality, so it is pinned by name
   * below rather than left inside a count: Persian's `vi` suspended at the ninth
   * comes back as a `V11` whose own fifth was never sounding. That is looser
   * than the `respelt` class, which demands the same notes exactly - and it has
   * to be, because an overloaded chord read back from a set of pitch classes is
   * a *different* chord from the one that was built, and a different chord has
   * its own fifth to be missing. `rank` puts an incomplete parse last, so this
   * only ever wins where nothing complete was written at all.
   */
  function atDistinctHeight(
    scale: readonly number[],
    sounded: ReadonlySet<number>,
    degree: ChordDegree
  ): boolean {
    const back = pitchClassesOf(chordPitchClasses(scale, degree));
    for (const member of sounded) {
      if (!back.has(member)) return false;
    }
    if (back.size === sounded.size) return true;
    if (back.size !== sounded.size + 1) return false;

    const fifth = (effectiveChord(scale, degree).root + 7) % 12;
    return [...back].every(member => sounded.has(member) || member === fifth);
  }

  /** One chord: build it, read it back, and say which of the four it was. */
  function roundTrip(scale: readonly number[], overrides: Partial<ChordDegree>): void {
    const slot = degreeSlot(overrides.degree ?? 0, overrides, KEY, scale);
    if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

    const original = slot.harmony.degree;
    const identity = effectiveChord(scale, original);
    if (identity.base === 'other') return;

    const result = recognise([], slot, KEY, scale);
    if (result.kind === 'unchanged') {
      counts.unchanged++;
      return;
    }

    const stack = chordPitchClasses(scale, original);
    const sounded = pitchClassesOf(stack);

    // Two notes of the stack in one *role* - one letter-step, or one pitch
    // class. Nothing downstream can recover the second, because the reading
    // starts from a set.
    const trace =
      `${JSON.stringify(harmonyOf(original))} on [${scale}] -> ` +
      (result.kind === 'relabel' ? JSON.stringify(harmonyOf(result.degree)) : 'literal');

    const roles = new Set(identity.steps.map(step => step % 7));
    if (roles.size < identity.steps.length || sounded.size < stack.length) {
      counts.overloaded++;
      if (result.kind === 'relabel' && atDistinctHeight(scale, sounded, result.degree)) {
        overloaded.atHeight++;
      } else if (result.kind === 'literal') {
        overloaded.refused++;
      } else {
        overloaded.notAtHeight++;
        if (overloadedTraces.length < 10) overloadedTraces.push(trace);
      }
      return;
    }

    if (
      result.kind === 'relabel' &&
      sameNotes(sounded, pitchClassesOf(chordPitchClasses(scale, result.degree)))
    ) {
      counts.respelt++;
      const renumbered =
        result.degree.degree !== original.degree || result.degree.alter !== original.alter;
      if (renumbered) respelt.renumbered++;
      else respelt.sameNumeral++;

      if (original.alter === 0 && renumbered && respeltDiatonic.length < 10) {
        respeltDiatonic.push(trace);
      }
      // The root the chord came back on, read the same way the original's was.
      // Equal roots mean the numeral moved and the chord did not, which is what
      // the ruling of 2026-09-10 says may no longer happen.
      if (
        renumbered &&
        effectiveChord(scale, result.degree).root === identity.root &&
        respeltInPlace.length < 10
      ) {
        respeltInPlace.push(trace);
      }
      return;
    }

    counts.bug++;
    if (result.kind === 'literal') failures.literal++;
    else failures.mislabelled++;
    if (bugs.length < 10) bugs.push(trace);
  }

  /**
   * A phase's outcomes, printed as the difference from the phase before it.
   *
   * The sweep is four blocks over four different axes and one total tells you
   * only that something somewhere is wrong. This is what said which: the
   * suspension block below was measured by adding it and reading this line.
   */
  function tally(): Record<string, number> {
    return { ...counts, ...overloaded, ...failures };
  }

  let mark = tally();
  function phase(label: string): void {
    const now = tally();
    const delta = Object.fromEntries(
      Object.keys(now)
        .filter(key => now[key] !== mark[key])
        .map(key => [key, now[key] - mark[key]])
    );
    mark = now;
    // eslint-disable-next-line no-console
    console.log(`round trip / ${label}:`, JSON.stringify(delta));
  }

  it('reads every chord the model builds back as the chord it built', () => {
    for (const scale of APP_SCALES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const extent of CHORD_EXTENTS) {
          for (const suspension of SUSPENSIONS) {
            roundTrip(scale, { degree, extent, suspension });
          }
        }
      }
    }
    phase('every scale');

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const quality of Object.keys(QUALITY_INTERVALS) as NamedQuality[]) {
          for (const alter of [-1, 0, 1]) {
            for (const extent of CHORD_EXTENTS) {
              roundTrip(scale, { degree, extent, alter, quality });
            }
          }
        }
      }
    }
    phase('quality x alter');

    // The extension axis, one pin at a time. `extent` is the single height
    // control, so each alteration is only swept at the extents that reach it.
    //
    // `Partial<ExtensionAlterations>` rather than `Partial<Record<string,
    // number>>`, which is what this was: under that type a misspelt key swept
    // nothing at all and the sweep still passed, because `createExtensions`'
    // three fields simply never saw it. The narrow type makes the typo a
    // compile error, and `as const` is what keeps the literals inside the
    // alteration unions rather than widening them to `number`.
    const pins: readonly { extensions: Partial<ExtensionAlterations>; from: ChordExtent }[] = [
      ...([-1, 0, 1] as const).map(ninth => ({ extensions: { ninth }, from: 9 as ChordExtent })),
      ...([0, 1] as const).map(eleventh => ({ extensions: { eleventh }, from: 11 as ChordExtent })),
      ...([-1, 0] as const).map(thirteenth => ({
        extensions: { thirteenth },
        from: 13 as ChordExtent
      }))
    ];

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const pin of pins) {
          for (const extent of CHORD_EXTENTS.filter(candidate => candidate >= pin.from)) {
            roundTrip(scale, {
              degree,
              extent,
              extensions: { ...NO_EXTENSIONS, ...pin.extensions }
            });
          }
        }
      }
    }
    phase('one pin');

    // The suspension axis crossed with the two above it, which nothing else
    // here crosses it with. `sus2` and `sus4` only: `'none'` is what the first
    // two blocks already sweep, and sweeping it again would double a count
    // rather than test anything.
    const SUSPENDED: readonly SuspensionKind[] = ['sus2', 'sus4'];

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const quality of Object.keys(QUALITY_INTERVALS) as NamedQuality[]) {
          for (const suspension of SUSPENDED) {
            for (const extent of CHORD_EXTENTS) {
              roundTrip(scale, { degree, extent, quality, suspension });
            }
          }
        }
      }
    }
    phase('quality x suspension');

    for (const scale of DIATONIC_MODES) {
      for (let degree = 0; degree <= 6; degree++) {
        for (const pin of pins) {
          for (const suspension of SUSPENDED) {
            for (const extent of CHORD_EXTENTS.filter(candidate => candidate >= pin.from)) {
              roundTrip(scale, {
                degree,
                extent,
                suspension,
                extensions: { ...NO_EXTENSIONS, ...pin.extensions }
              });
            }
          }
        }
      }
    }
    phase('one pin x suspension');

    expect(bugs.join('\n')).withContext('outside both exception classes').toBe('');
    expect(counts.bug).toBe(0);

    // The overloaded class asserted on the output rather than assumed from the
    // input: an overloaded chord comes back at the height of its distinct
    // notes, or - where its two notes in one role are two different pitch
    // classes - it comes back `literal`. What it never does is come back
    // labelled with a chord sounding a note the slot is not playing.
    expect(overloadedTraces.join('\n')).withContext('overloaded, not at height').toBe('');
    expect(overloaded.notAtHeight).toBe(0);

    // A ceiling rather than a figure, on the one bucket that is a shortfall
    // rather than a rule: 254 came back `literal` when this was measured, and
    // the two reasons are worked through above with a fixture each. The bucket
    // may shrink and may not grow.
    expect(overloaded.refused).toBeLessThanOrEqual(254);

    // A chord on its own degree comes back on its own degree. Only a root the
    // model displaced has a second numeral for the ranking to move it to.
    expect(respeltDiatonic.join('\n')).withContext('renumbered with alter 0').toBe('');

    // And the ruling's own assertion, which subsumes it: a chord that came back
    // rooted where it started keeps the numeral it started on, whether or not
    // that numeral carried an accidental.
    expect(respeltInPlace.join('\n')).withContext('renumbered with the root unmoved').toBe('');
    expect(respelt.renumbered).toBe(0);

    // Enough chords, and enough of them exact, that a sweep silently reduced to
    // nothing would fail here rather than pass.
    expect(counts.unchanged + counts.overloaded + counts.respelt).toBeGreaterThan(21000);
    expect(counts.unchanged).toBeGreaterThan(4000);

    // Printed rather than pinned: the two exception classes are characterised by
    // what they are, not by how many of them there happen to be, and a number
    // here would be a figure to update rather than a rule to check. Measured on
    // 2026-09-10 over the 12,968 chords this swept then, before the kept-numeral
    // ruling: 5537 exact, 1866 overloaded, 5565 respelt (3136 of them
    // renumbered, 2429 respelt on their own numeral), 0 outside. After it: 7448
    // exact, 1852 overloaded, 3668 respelt and every one of them on the numeral
    // it started on, 0 outside.
    //
    // And over the 22,166 this sweeps now, with the suspension axis crossed:
    // before the widening of `writeAt`, 9107 exact, 6430 overloaded (6071 at
    // height), 6230 respelt with 210 of them renumbered, and 399 outside both
    // classes - 273 chords that lost their numeral and 126 that came back
    // sounding a note the slot was not playing. After it: 9583 exact, 6311
    // overloaded (6057 at height, 254 refused), 6272 respelt and every one on
    // its own numeral, 0 outside.
    // eslint-disable-next-line no-console
    console.log('round trip:', JSON.stringify({ ...counts, respelt, ...overloaded, ...failures }));
  });

  /**
   * The one allowance `atDistinctHeight` makes, pinned so that it is a decision
   * on the page rather than a number in a bucket.
   *
   * Persian's `vi` suspended by a second at the ninth is overloaded the same way
   * the two below are - a ♯9 over the suspension, two notes in one role - and it
   * is the case that motivated the fix of 2026-09-10, because before it the
   * ranking had no `V11` to reach and nothing else either. It now comes back on
   * the dominant, at the height of the notes the parse could read, with the one
   * note the parse is allowed to guess: its own perfect fifth, which this chord
   * never sounded. The parse is `complete: false` and the ranking puts it last,
   * so this is what the notes admit and not what they prefer.
   */
  it('overloaded, at height: Persian vi sus2 at the ninth comes back as V11', () => {
    const PERSIAN = [0, 1, 4, 5, 6, 8, 11];
    const slot = degreeSlot(5, { extent: 9, suspension: 'sus2' }, KEY, PERSIAN);
    if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

    const stack = chordPitchClasses(PERSIAN, slot.harmony.degree);
    expect(stack).toEqual([8, 10, 16, 18, 23]);

    const result = recognise([], slot, KEY, PERSIAN);
    if (result.kind !== 'relabel') throw new Error(`expected a relabel; got ${result.kind}`);
    expect(harmonyOf(result.degree)).toEqual(
      harmony({
        degree: 4,
        extent: 11,
        quality: 'dominant7',
        extensions: { ninth: null, eleventh: 0, thirteenth: null }
      })
    );

    // Every note the slot sounds is in what came back, and the only note added
    // is the dominant's own fifth - pitch class 1, which is `6 + 7`.
    const sounded = new Set(stack.map(pitch => pitch % 12));
    const back = new Set(chordPitchClasses(PERSIAN, result.degree).map(pitch => pitch % 12));
    expect([...sounded].every(member => back.has(member))).toBe(true);
    expect([...back].filter(member => !sounded.has(member))).toEqual([1]);
  });

  /**
   * The `refused` bucket's first reason, pinned: the parse takes the opening
   * that has no name and does not go back for the one that has.
   *
   * Three palette clicks from a fresh slot - pick the degree, step the extent to
   * a ninth, press sus2 - so this is not a corner of the model a user has to
   * work to reach. The chord it builds has a perfectly good name, and it is the
   * *reading* that comes back nameless.
   */
  it('overloaded, refused: Hungarian minor III sus2 at the ninth', () => {
    const HUNGARIAN_MINOR = [0, 2, 3, 6, 7, 8, 11];
    const slot = degreeSlot(2, { extent: 9, suspension: 'sus2' }, KEY, HUNGARIAN_MINOR);
    if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

    // The stack the model builds: a ♭III with an augmented fifth, a major
    // seventh, and - the overload - a ♯9 over a suspended second. Two notes in
    // the one letter-step role, and here they are two different pitch classes.
    const stack = chordPitchClasses(HUNGARIAN_MINOR, slot.harmony.degree);
    expect(stack).toEqual([3, 5, 11, 14, 18]);
    expect(effectiveChord(HUNGARIAN_MINOR, slot.harmony.degree).base).toBe('augmentedMajor7');

    // What the parse makes of those five pitch classes from the same root: a
    // minor third rather than the suspension, because `OPENINGS` tries a third
    // first and this one consumes every note. The shape it lands on is in no
    // table, and no `ChordDegree` builds it.
    const sounded = new Set(stack.map(pitch => pitch % 12));
    const parsed = parseChord(sounded, 3)!;
    expect(parsed.intervals).toEqual([0, 3, 8, 11, 14]);
    expect(parsed.base).toBe('other');

    expect(recognise([], slot, KEY, HUNGARIAN_MINOR).kind).toBe('literal');
  });

  /**
   * And the second reason: there is no chord at the height of the distinct
   * notes, so nothing was ever there to be found.
   *
   * `add9` puts a ninth in the fourth position and the extent adds the key's own
   * ninth above it; the suspension then puts a second in the first. Drop the
   * pitch class that is sounded twice and {E, F, F♯, B} is left, which is a
   * semitone cluster and parses from none of its four notes.
   */
  it('overloaded, refused: a suspended add9 whose distinct notes are a cluster', () => {
    const slot = degreeSlot(2, { extent: 9, quality: 'add9', suspension: 'sus2' }, KEY, MAJOR);
    if (slot.harmony.kind !== 'degree') throw new Error('unreachable');

    const stack = chordPitchClasses(MAJOR, slot.harmony.degree);
    expect(stack).toEqual([4, 6, 11, 18, 29]);

    const sounded = new Set(stack.map(pitch => pitch % 12));
    expect([...sounded].sort((left, right) => left - right)).toEqual([4, 5, 6, 11]);

    for (const root of sounded) {
      expect(parseChord(sounded, root)).withContext(`from ${root}`).toBeNull();
    }
    expect(recognise([], slot, KEY, MAJOR).kind).toBe('literal');
  });

  /** `EXTENT_BY_LENGTH` in the module is this table read the other way. */
  it('maps every stack height back to the extent that produced it', () => {
    for (const extent of CHORD_EXTENTS) {
      const parsed = parseChord(
        new Set(chordPitchClasses(MAJOR, {
          degree: 0,
          alter: 0,
          extent,
          quality: null,
          suspension: 'none',
          extensions: NO_EXTENSIONS
        }).map(pitch => ((pitch % 12) + 12) % 12)),
        0
      );
      expect(parsed?.intervals.length).toBe(noteCount(extent));
      expect(parsed?.extent).toBe(extent);
    }
  });
});
