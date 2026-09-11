import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ChordDegree, ChordSlot, ProgressionState, SlotHarmony } from '../models/progression.model';
import { effectiveChord, isHeptatonic } from './progression-harmony';
import { reduce, structuralPitchClasses } from './progression-parse';

/**
 * What a key change does to a slot's *label*, which until M3 Task 8 was
 * nothing.
 *
 * The bug these specs were written for shipped in M2 and is reachable in two
 * clicks. `regenerateSlot` transposes a claimed voicing by the tonic interval
 * and leaves `harmony` exactly as it found it, which is right while only the
 * tonic moves and wrong the moment the mode moves with it: click the relative
 * minor on the circle and a hand-edited `I` in C major sounds A, C♯, E under a
 * card reading `i`. A silent mislabel is the one thing the design says this app
 * must never do, so the first spec below is the failing one and everything else
 * is the boundary around the fix.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was over three times the project's 1000-line cap, and M3 Task 6 set
 * the precedent for declining to add to it: a second topic-named spec with its
 * own local fixtures and no shared helper module, the two cross-referencing.
 * The `setKey` and merge blocks pin what a key change does to **notes**, which
 * is untouched by this task and is asserted afresh here only where a note
 * moving is the thing that makes a label wrong.
 *
 * The end of M3 split that file five ways on the same argument. `setKey` itself
 * is still in it, with the document's other fields; the merge blocks are now
 * `progression.service.regenerate.spec.ts`, which is the file this one is the
 * label half of.
 */
describe('ProgressionService: a key change re-expresses an owned chord', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    service.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function slot(id: string): ChordSlot {
    const found = currentState().doc.slots.find(candidate => candidate.id === id);
    if (!found) throw new Error(`no slot ${id}`);
    return found;
  }

  function harmonyOf(id: string): SlotHarmony {
    return slot(id).harmony;
  }

  function degreeOf(id: string): ChordDegree {
    const harmony = harmonyOf(id);
    if (harmony.kind !== 'degree') throw new Error(`slot ${id} is literal`);
    return harmony.degree;
  }

  function midiOf(id: string): number[] {
    return slot(id).notes.map(note => note.midi);
  }

  /** A fresh slot on `degree`, and its id. */
  function append(degree: number): string {
    service.appendSlot(degree);
    const slots = currentState().doc.slots;
    return slots[slots.length - 1].id;
  }

  /**
   * Claims the slot's pitches without moving one.
   *
   * Writing the notes a slot already holds is the smallest hand edit there is -
   * a note dragged and dropped where it started - and it claims `pitches` all
   * the same, because a claim is a change even when a number is not. That keeps
   * every expectation below about the *label*: the notes are the generator's
   * own until the key moves them.
   */
  function own(id: string): void {
    service.setSlotNotes(id, slot(id).notes);
    expect(slot(id).owned.pitches).toBeTrue();
  }

  /**
   * The bug, and the fix.
   *
   * C major's `I` is C E G. Claimed, it transposes by `keyTransposeInterval(0,
   * 9)` - the nearer of A's two readings, which is -3 - and `anchoredShift`
   * puts it back on the chord A minor generates at 69, so the octave comes
   * back: 60, 64, 67 sound as 69, 73, 76. Those are A, C♯ and E, a major triad,
   * and the stored `I` with a null quality prints `i` over them in A minor.
   *
   * After the fix the notes are identical - the fix moves no note - and the
   * quality is pinned to `major`, which is the only way A minor has of writing
   * a major triad on its own tonic. The card reads `I`.
   */
  it('re-expresses an owned chord when the key changes mode', () => {
    const id = append(0);
    own(id);

    service.setKey(9, 'aeolian');

    expect(midiOf(id)).toEqual([69, 73, 76]);
    expect(degreeOf(id)).toEqual(
      jasmine.objectContaining({ degree: 0, alter: 0, quality: 'major' })
    );
  });

  /**
   * And the case that must **not** move: a transposition is not a re-spelling.
   *
   * C major to D major is the same degree of the same mode, so `expressInKey`
   * finds the key's own answer already right and pins nothing. Leaving
   * `quality` null is what lets the next key change re-voice this slot, so a
   * fix that pinned here would quietly opt every claimed slot out of the mode
   * changes it is meant to survive.
   */
  it('pins nothing when only the tonic moves', () => {
    const id = append(0);
    own(id);

    service.setKey(2, 'ionian');

    expect(midiOf(id)).toEqual([62, 66, 69]);
    expect(degreeOf(id).quality).toBeNull();
  });

  /** And the pin comes off again on the way home, so a round trip cancels. */
  it('unpins on the way back to a key that writes the chord itself', () => {
    const id = append(0);
    own(id);

    service.setKey(9, 'aeolian');
    expect(degreeOf(id).quality).toBe('major');

    service.setKey(0, 'ionian');
    expect(degreeOf(id).quality).toBeNull();
    expect(midiOf(id)).toEqual([60, 64, 67]);
  });

  /**
   * A slot that leaves its pitches to the generator is re-voiced from its
   * degree, so it already sounds whatever the new key makes of that degree.
   * Pinning it would be the opposite of what it asked for.
   */
  it('leaves a slot that does not own its pitches to the key', () => {
    const id = append(0);

    service.setKey(9, 'aeolian');

    expect(midiOf(id)).toEqual([69, 72, 76]);
    expect(degreeOf(id).quality).toBeNull();
  });

  /**
   * The register is not part of what a chord *is*, so neither end of it is
   * re-derived. `expressInKey` reads an inversion off a bass note because the
   * recogniser has only notes to learn one from; here it is already known, and
   * reading it off the transposed voicing instead would let the anchor turn a
   * chord the user left in first inversion into something else.
   */
  it('keeps the inversion and the octave the slot was left in', () => {
    const id = append(0);
    service.setSlotInversion(id, 1);
    service.setSlotOctave(id, 1);
    own(id);

    service.setKey(9, 'aeolian');

    expect(degreeOf(id)).toEqual(
      jasmine.objectContaining({ inversion: 1, octave: 1, quality: 'major' })
    );
  });

  /**
   * The seventh over a borrowed root, which already carried its shape.
   *
   * `♭VII` in C major is B♭ D F, stored as degree 6 with `alter: -1` and a
   * `major` override, because a displaced root has no diatonic stack to fall
   * back on. Move to C mixolydian and the same three pitch classes are that
   * key's *own* seventh degree - `mixolydian` flattens it - so the alteration
   * and the override both come off, which is `expressInKey` preferring the
   * reading that leaves the most to the key.
   */
  it('takes a borrowed chord back onto its own degree where the new key has one', () => {
    service.appendChord({ degree: 6, alter: -1, quality: 'major', extent: 3 });
    const id = currentState().doc.slots[0].id;
    own(id);
    expect(midiOf(id)).toEqual([70, 74, 77]);

    service.setKey(0, 'mixolydian');

    expect(degreeOf(id)).toEqual(
      jasmine.objectContaining({ degree: 6, alter: 0, quality: null })
    );
    expect(midiOf(id)).toEqual([70, 74, 77]);
  });

  /**
   * A literal slot has no degree to re-express and its notes are the truth in
   * every key, so a key change passes over it entirely.
   */
  it('leaves a literal slot alone', () => {
    const id = append(0);
    const doc = currentState().doc;
    service.replaceDocument({
      ...doc,
      slots: doc.slots.map(candidate => ({
        ...candidate,
        harmony: { kind: 'literal' as const, reason: 'user-detached' as const, from: null }
      }))
    });

    service.setKey(9, 'aeolian');

    expect(harmonyOf(id).kind).toBe('literal');
    expect(midiOf(id)).toEqual([60, 64, 67]);
  });

  /**
   * When the new key cannot write the chord at all.
   *
   * C enigmatic is [0, 1, 4, 6, 8, 10, 11], and thirds stacked from its second
   * degree give C♯ F♯ A♯ - intervals [0, 5, 9] above their root, which is no
   * named triad, so the identity's base is `'other'`. In C major that root is a
   * semitone from two degrees and a whole tone from a third, and every one of
   * those spellings needs a shape name to override with; there is none. So the
   * chord is honestly not expressible, and the slot loses its numeral rather
   * than keeping one that would name three different notes.
   *
   * It is marked, not silent: the strip prints no numeral and says why, and
   * `from` keeps the degree so Reset to chord is the way back.
   */
  it('degrades to literal, keeping its degree, when the new key cannot write the chord', () => {
    service.setKey(0, 'enigmatic');
    const id = append(1);
    expect(midiOf(id)).toEqual([61, 66, 70]);
    own(id);

    service.setKey(0, 'ionian');

    const harmony = harmonyOf(id);
    expect(harmony.kind).toBe('literal');
    if (harmony.kind !== 'literal') throw new Error('unreachable');
    expect(harmony.reason).toBe('unrecognised');
    expect(harmony.from).toEqual(jasmine.objectContaining({ degree: 1, alter: 0, quality: null }));
    // The notes are untouched by the degradation: what the slot sounds is what
    // the user was holding, transposed by nothing.
    expect(midiOf(id)).toEqual([61, 66, 70]);
  });

  /**
   * A key that cannot stack thirds at all is not the degradation case.
   *
   * There is no scale to read an identity in or to write one into, so the slot
   * keeps its degree and the strip says "this key cannot name it" for as long
   * as the page stays there - which is a refusal that undoes itself when the
   * key comes back, where a degradation would not.
   *
   * The **second** key change here is the one that used to be a lie, and this
   * spec used to end at C ionian, where the tonic had not moved and the mode had
   * not either: nothing needed re-expressing, so `null` came back for a reason
   * that had nothing to do with the fix, and the spec passed over the bug it was
   * standing on. Landing on A aeolian instead is the whole difference - the
   * identity has to survive a key the app cannot name it in - and it was red
   * until `rekey` learned to read the notes.
   */
  it('keeps a degree through a key with no chords in it', () => {
    const id = append(0);
    own(id);

    service.setKey(0, 'majorPentatonic');
    expect(harmonyOf(id).kind).toBe('degree');
    expect(midiOf(id)).toEqual([60, 64, 67]);

    service.setKey(9, 'aeolian');

    // The notes are a major triad on A, so the card has to say so. Reading the
    // stale numeral out of the document instead prints `i` over it.
    expect(midiOf(id)).toEqual([69, 73, 76]);
    expect(degreeOf(id).degree).toBe(0);
    expect(degreeOf(id).quality).toBe('major');
  });

  /**
   * The same identity, and the same answer, without the detour.
   *
   * The pair is the point: a route through a key that can name nothing is not
   * supposed to be a route that *changes* anything, so the chord that comes out
   * of C ionian → C majorPentatonic → A aeolian is the chord that comes out of
   * C ionian → A aeolian. It is the cheapest statement there is of what the
   * detour cost before the fix.
   */
  it('lands where the direct move lands', () => {
    const id = append(0);
    own(id);

    service.setKey(9, 'aeolian');

    expect(midiOf(id)).toEqual([69, 73, 76]);
    expect(degreeOf(id).degree).toBe(0);
    expect(degreeOf(id).quality).toBe('major');
  });

  /**
   * The invariant underneath every expectation above: **a slot's stored degree
   * names the pitch classes it is sounding.**
   *
   * Both of the failures Task 8 left behind violate exactly this and nothing
   * else - one had the quality wrong under the right root, the other had the
   * root wrong as well - and neither is a fact about a particular pair of keys.
   * A fixture per route would have pinned the two routes that were reported and
   * said nothing about the third, so the property is asserted along a **walk**
   * instead: every stop on the route below is checked, and a stop is added by
   * adding a key rather than by writing another spec.
   *
   * ## Where it is asserted, and where it honestly cannot be
   *
   * Two stops answer nothing rather than answering wrongly, and both are
   * refusals the design argues for rather than gaps in the check:
   *
   *  - **A key whose scale cannot stack thirds.** There is no degree in it for a
   *    label to name, so there is no claim to test. That the slot passes through
   *    such a key still holding its degree is the thing those stops are here to
   *    exercise, and it is checked directly.
   *  - **A literal slot.** It carries no numeral, which is the one state that
   *    cannot be a mislabel. The route below is chosen from ordinary scales so
   *    that no stop degrades, and the walk asserts that: a degradation would
   *    turn the rest of the route into a run of vacuous passes.
   *
   * ## The route
   *
   * It is not a tour for its own sake. It holds both shapes the review found -
   * a non-heptatonic stop that the tonic moves *at* (C pentatonic → A aeolian,
   * where the voicing is transposed) and one it does not (A pentatonic → A
   * aeolian, where `transposeBy` is 0 and only the anchor moves the notes, by a
   * whole octave, leaving every pitch class where it was) - plus ordinary
   * heptatonic moves between them, a six-note scale and a whole-tone one so the
   * refusal is not only ever a pentatonic, and a return to C ionian.
   */
  it('keeps the label naming the notes along a route through unnameable keys', () => {
    const id = append(0);
    own(id);
    expectLabelNamesNotes(id, 'C ionian, before anything moves');

    for (const [tonic, scaleId] of ROUTE) {
      service.setKey(tonic, scaleId);
      const where = `${tonic} ${scaleId}`;

      // Nothing on this route is honestly unnameable, so a literal slot here is
      // the degradation branch reached by accident - and it would make every
      // later stop pass without testing anything.
      expect(harmonyOf(id).kind).withContext(where).toBe('degree');
      expectLabelNamesNotes(id, where);
    }

    // Home, and back to the notes and the numeral it started with: the walk
    // closes, which is the other half of what "the route cost nothing" means.
    expect(midiOf(id)).toEqual([60, 64, 67]);
    expect(degreeOf(id).degree).toBe(0);
    expect(degreeOf(id).quality).toBeNull();
  });

  /** See the walk above for why each stop is on it. */
  const ROUTE: readonly (readonly [number, string])[] = [
    [0, 'majorPentatonic'],
    [9, 'aeolian'],
    [9, 'majorPentatonic'],
    [9, 'aeolian'],
    [2, 'dorian'],
    [2, 'minorBlues'],
    [7, 'mixolydian'],
    [7, 'wholeTone'],
    [0, 'ionian']
  ];

  /**
   * Asserts the invariant at one stop, or passes silently where there is no
   * claim to test - see the walk's docstring for which two cases those are and
   * why neither is a hole.
   *
   * The chord is read the way the whole app reads it, through `effectiveChord`,
   * rather than rebuilt here from the degree: a second construction of a chord
   * from a numeral would be a second statement of what a numeral means, free to
   * agree with the card while both disagreed with the synth. The notes are read
   * through `structuralPitchClasses`, which is what decides what a slot is
   * sounding everywhere else on this page.
   */
  function expectLabelNamesNotes(id: string, where: string): void {
    const state = currentState();
    const scale = state.keyScale;
    if (!scale || !isHeptatonic(scale.intervals)) return;

    const harmony = harmonyOf(id);
    if (harmony.kind !== 'degree') return;

    const identity = effectiveChord(scale.intervals, harmony.degree);
    const named = identity.intervals.map(interval =>
      reduce(state.doc.key.tonic + identity.root + interval)
    );

    const sounding = structuralPitchClasses(slot(id).notes, slot(id).lengthBeats);
    expect(ascending(named)).withContext(where).toEqual(ascending([...sounding]));
  }

  /** Pitch classes as a sorted list with no repeat, so two sets compare. */
  function ascending(pitchClasses: readonly number[]): number[] {
    return [...new Set(pitchClasses)].sort((left, right) => left - right);
  }
});
