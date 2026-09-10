import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ChordDegree, ChordSlot, ProgressionState, SlotHarmony } from '../models/progression.model';

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
 * That file is over three times the project's 1000-line cap, and M3 Task 6 set
 * the precedent for declining to add to it: a second topic-named spec with its
 * own local fixtures and no shared helper module, the two cross-referencing.
 * The `setKey` and merge blocks over there pin what a key change does to
 * **notes**, which is untouched by this task and is asserted afresh here only
 * where a note moving is the thing that makes a label wrong.
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
   */
  it('keeps a degree through a key with no chords in it', () => {
    const id = append(0);
    own(id);

    service.setKey(0, 'majorPentatonic');
    expect(harmonyOf(id).kind).toBe('degree');

    service.setKey(0, 'ionian');
    expect(degreeOf(id).quality).toBeNull();
  });
});
