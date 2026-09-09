import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import {
  CHORD_EXTENTS,
  DEFAULT_VELOCITY,
  MIN_NOTE_BEATS,
  OCTAVE_MAX,
  VELOCITY_MAX,
  VELOCITY_MIN,
  createOwnership
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  ProgressionState,
  RollNote,
  SlotOwnership,
  createDegreeSlot
} from '../models/progression.model';
import { keyTransposeInterval, regenerateSlot } from './progression-edit';
import { ChordExtent, effectiveQuality } from './progression-harmony';

/**
 * The progression document's owner: every mutation, the contiguity invariant,
 * and undo.
 *
 * Two things are asserted here that no single method owns, because both belong
 * to the commit path rather than to any setter:
 *
 *  - **Slots are contiguous.** `slots[i].startBeat` is the sum of every earlier
 *    `lengthBeats`, after append, remove, move and resize alike.
 *  - **Bounds are applied.** Every commit runs `normalizeProgressionDoc`, so a
 *    value past its limit is clamped or wrapped wherever it entered - the tempo
 *    and the tonic being the two that reach the audio layer with no slot of
 *    their own to be checked on the way.
 */
describe('ProgressionService', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  /**
   * The state as it stands now.
   *
   * The throw is the assertion that `getState()` is backed by a
   * `BehaviorSubject`: a plain `Subject` would publish nothing to a subscriber
   * that arrives after the fact, and every expectation below would then be
   * reading a stale local rather than the service.
   */
  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    service.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function slots(): ChordSlot[] {
    return currentState().doc.slots;
  }

  /**
   * Asserts that `act` changed nothing about the document or the history.
   *
   * Document identity is the headline property: a refused or clamped-to-nothing
   * mutation must not push a step onto a stack that only holds a hundred, or
   * holding the + button down at the top of the ladder would quietly throw the
   * user's history away.
   *
   * It is not sufficient on its own, though, which is the lesson of the bug
   * this helper failed to catch: history can be pushed while the document
   * stands still, and identity alone cannot see it. The three flags are the
   * stacks' only public face, so they are checked too - and the specs that need
   * to see further than a flag walk the history explicitly rather than
   * asserting on it from here.
   */
  function expectNoCommit(act: () => void): void {
    const before = currentState();
    act();
    const after = currentState();
    expect(after.doc).toBe(before.doc);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(before.canRedo);
    expect(after.isDirty).toBe(before.isDirty);
  }

  /**
   * The intervals of the scale the key names, for the specs that read a chord's
   * name back off the scale rather than out of the document.
   *
   * The name is derived on read now rather than stored, so a spec that wants to
   * assert one has to ask the same function the strip card asks.
   */
  function keyIntervals(): readonly number[] {
    const scale = currentState().keyScale;
    if (!scale) throw new Error('the key names no scale this app knows');
    return scale.intervals;
  }

  /**
   * The invariant, checked the way the docstring states it: each slot begins
   * where the sum of everything before it ends.
   */
  function expectContiguous(): void {
    let beat = 0;
    for (const slot of slots()) {
      expect(slot.startBeat).toBe(beat);
      beat += slot.lengthBeats;
    }
  }

  describe('the empty document', () => {
    it('opens on an empty progression in C ionian', () => {
      const state = currentState();
      expect(state.doc.slots).toEqual([]);
      expect(state.doc.key).toEqual({ tonic: 0, scaleId: 'ionian', preferSharps: true });
      expect(state.canUndo).toBeFalse();
      expect(state.canRedo).toBeFalse();
      expect(state.isDirty).toBeFalse();
    });

    it('can build chords in a heptatonic key', () => {
      expect(currentState().canBuildChords).toBeTrue();
    });

    // The constructor builds its first state through the same `derive` every
    // publish uses, so a field filled in only one of the two cannot exist.
    it('publishes the scale the key names before anything is touched', () => {
      expect(currentState().keyScale?.id).toBe('ionian');
    });
  });

  /**
   * Resolving `scaleId` is a loop over every scale category, and every consumer
   * that wants the intervals, the name or the note count would otherwise write
   * that loop out again - the chord palette had it character for character.
   */
  describe('the scale the key names', () => {
    it('follows the key', () => {
      service.setKey(9, 'aeolian');
      expect(currentState().keyScale?.id).toBe('aeolian');
      expect(currentState().keyScale?.intervals).toEqual([0, 2, 3, 5, 7, 8, 10]);
    });

    // Resolved, not filtered. A page that has to explain the refusal needs to
    // name the scale it is refusing and count its notes.
    it('resolves a scale that can build no chords, rather than dropping it', () => {
      service.setKey(0, 'majorPentatonic');
      const state = currentState();

      expect(state.canBuildChords).toBeFalse();
      expect(state.keyScale?.name).toBe('Major Pentatonic');
      expect(state.keyScale?.intervals.length).toBe(5);
    });

    it('is null for an id the app does not know', () => {
      service.setKey(0, 'no-such-scale');
      expect(currentState().keyScale).toBeNull();
      expect(currentState().canBuildChords).toBeFalse();
    });
  });

  describe('appendSlot', () => {
    it('sounds a C major triad for a I in C major', () => {
      service.appendSlot(0);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67]);
    });

    /**
     * The quality field is the user's override and nothing else, so a slot
     * nobody has overridden carries `null` - which reads as "as the key gives
     * it" and is re-derived on every read.
     *
     * It used to hold the *derived* label, written by `regenerateSlot` on every
     * regeneration, and that is what erased an override on the next key change,
     * complexity step or resize. The label itself did not move: `effectiveQuality`
     * reads it off the chord that was actually built, which is where the strip
     * card and the fretboard highlight already got it.
     */
    it('leaves the quality for the key to give, and names the chord from it', () => {
      service.appendSlot(1);
      const harmony = slots()[0].harmony;
      expect(harmony.kind).toBe('degree');
      if (harmony.kind !== 'degree') return;
      expect(harmony.degree.quality).toBeNull();

      // ii in C major is D-F-A, and it is a minor triad however it is stored.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([62, 65, 69]);
      expect(effectiveQuality(keyIntervals(), 1, 3, 0, null)).toBe('minor');
    });

    it('keeps slots contiguous as they are appended', () => {
      service.appendSlot(0);
      service.appendSlot(3);
      service.appendSlot(4);
      expect(slots().length).toBe(3);
      expect(slots().map(slot => slot.startBeat)).toEqual([0, 4, 8]);
      expectContiguous();
    });

    it('selects the slot it just appended', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      expect(currentState().selectedSlotId).toBe(slots()[1].id);
    });

    // Every commit publishes a dirty document, and this is the only spec that
    // says so: `isDirty` is otherwise only ever asserted false, which a service
    // that published false from every commit would satisfy just as well.
    it('leaves the document dirty', () => {
      service.appendSlot(0);
      expect(currentState().isDirty).toBeTrue();
    });
  });

  /**
   * The four mutations that disturb the contiguity invariant, each checked
   * against it. The plan names this as the invariant to test explicitly, and it
   * is tested four times rather than once because a re-flow that ran on three
   * of the four would look right until the fourth was used.
   */
  describe('the contiguity invariant', () => {
    beforeEach(() => {
      service.appendSlot(0);
      service.appendSlot(3);
      service.appendSlot(4);
    });

    it('keeps slots contiguous after a removal', () => {
      service.removeSlot(slots()[0].id);
      expect(slots().length).toBe(2);
      expect(slots().map(slot => slot.startBeat)).toEqual([0, 4]);
      expectContiguous();
    });

    it('keeps slots contiguous after a move', () => {
      const moved = slots()[2].id;
      service.moveSlot(moved, 0);
      expect(slots()[0].id).toBe(moved);
      expectContiguous();
    });

    it('keeps slots contiguous after a resize', () => {
      service.setSlotLength(slots()[0].id, 2);
      expect(slots().map(slot => slot.startBeat)).toEqual([0, 2, 6]);
      expectContiguous();
    });
  });

  describe('removeSlot', () => {
    it('ignores an id the document does not have', () => {
      service.appendSlot(0);
      expectNoCommit(() => service.removeSlot('not-a-slot'));
      expect(slots().length).toBe(1);
    });

    it('clears the selection when the selected slot goes', () => {
      service.appendSlot(0);
      service.removeSlot(slots()[0].id);
      expect(currentState().selectedSlotId).toBeNull();
    });
  });

  describe('moveSlot', () => {
    beforeEach(() => {
      service.appendSlot(0);
      service.appendSlot(3);
      service.appendSlot(4);
    });

    it('reorders to the target index', () => {
      const first = slots()[0].id;
      service.moveSlot(first, 2);
      expect(slots().map(slot => slot.id).indexOf(first)).toBe(2);
    });

    it('clamps a target index past the end onto the last position', () => {
      const first = slots()[0].id;
      service.moveSlot(first, 99);
      expect(slots()[2].id).toBe(first);
    });

    // The other end of the same clamp, and -1 rather than -99 on purpose:
    // `splice` reads a negative start as `length + start` and so lands on 0 for
    // anything far enough out, which would hide a missing `Math.max(0, ...)`
    // entirely. -1 is where the two answers differ, and it is also what a drag
    // released just left of the strip actually computes.
    it('clamps a target index before the start onto the first position', () => {
      const last = slots()[2].id;
      service.moveSlot(last, -1);
      expect(slots()[0].id).toBe(last);
      expectContiguous();
    });

    it('records nothing when the slot is already where it is going', () => {
      expectNoCommit(() => service.moveSlot(slots()[1].id, 1));
    });
  });

  describe('setSlotLength', () => {
    it('gives the slot`s notes the slot`s new length', () => {
      service.appendSlot(0);
      service.setSlotLength(slots()[0].id, 2);
      expect(slots()[0].lengthBeats).toBe(2);
      expect(slots()[0].notes.every(note => note.lengthBeats === 2)).toBeTrue();
    });

    // A drag past the left edge produces 0 and then negatives. The model clamps
    // rather than throwing precisely so the gesture stops instead of aborting.
    it('clamps a length dragged past zero to the minimum', () => {
      service.appendSlot(0);
      service.setSlotLength(slots()[0].id, -3);
      expect(slots()[0].lengthBeats).toBe(1);
      expect(slots()[0].notes.every(note => note.lengthBeats === 1)).toBeTrue();
    });

    it('records nothing once the length is already at the minimum', () => {
      service.appendSlot(0);
      service.setSlotLength(slots()[0].id, 1);
      expectNoCommit(() => service.setSlotLength(slots()[0].id, 0));
    });

    /**
     * A slot that owns its timing keeps its rhythm through a resize.
     *
     * `retimeNotes` used to write the slot's new length onto every note
     * unconditionally, and the damage that did was **partial**, which is worse
     * than a clean reset rather than better: the onsets survived while every
     * duration was flattened to the slot's, so a hand-written rhythm came back
     * with its attacks intact and every note overlapping the next. A block
     * chord is still what an unowned slot gets - the specs above - because a
     * resize is timing and a block chord's timing is the slot's own.
     */
    describe('a slot that owns its timing', () => {
      /** A rhythm the user wrote, distinct in all three dimensions. */
      function rhythm(): RollNote[] {
        return [
          { midi: 60, startBeat: 0, lengthBeats: 0.5, velocity: 40 },
          { midi: 64, startBeat: 1.5, lengthBeats: 0.25, velocity: 100 },
          { midi: 67, startBeat: 3, lengthBeats: 1, velocity: 20 }
        ];
      }

      /** A I in C major holding that rhythm and claiming it. Its id. */
      function drawn(): string {
        service.appendSlot(0);
        const doc = currentState().doc;
        const claimed: ChordSlot = {
          ...doc.slots[0],
          notes: rhythm(),
          owned: { ...createOwnership(), timing: true }
        };
        service.replaceDocument({ ...doc, slots: [claimed] });
        return claimed.id;
      }

      it('keeps the rhythm when the slot is made longer', () => {
        const id = drawn();
        service.setSlotLength(id, 8);

        expect(slots()[0].lengthBeats).toBe(8);
        expect(slots()[0].notes).toEqual(rhythm());
      });

      /**
       * Shortening is the case worth deciding rather than the easy one: a note
       * that starts past the new end, or runs past it, is real.
       *
       * It is kept, exactly, for the reason `retimeNotes` already keeps a
       * literal slot's notes - and for one this rule adds. A resize drag goes
       * both ways, and coalescing makes the whole drag a single undo step, so a
       * rule that discarded on the way in could not be undone by the way out: a
       * pointer that overshoots to two beats and comes back to four would
       * destroy the groove in the middle of a gesture that ended where it
       * started.
       */
      it('leaves a note hanging past an end dragged in over it', () => {
        const id = drawn();
        service.setSlotLength(id, 2);

        expect(slots()[0].lengthBeats).toBe(2);
        // The third note starts a full beat past the end of the slot holding
        // it, and is still exactly where the user put it.
        expect(slots()[0].notes).toEqual(rhythm());
      });

      it('has the rhythm intact when a drag comes back out again', () => {
        const id = drawn();
        service.setSlotLength(id, 2, { coalesce: false });
        service.setSlotLength(id, 4, { coalesce: true });

        expect(slots()[0].lengthBeats).toBe(4);
        expect(slots()[0].notes).toEqual(rhythm());
      });

      /** Resizing restates no chord and no dynamic, so it claims neither. */
      it('claims nothing of its own', () => {
        const id = drawn();
        service.setSlotLength(id, 2);

        expect(slots()[0].owned).toEqual({ pitches: false, timing: true, velocity: false });
      });

      /**
       * Owning the pitches or the velocities says nothing about the rhythm, so
       * neither protects it: a resize still writes the block length onto a slot
       * that claims those two and not timing.
       */
      it('is the only claim a resize reads', () => {
        service.appendSlot(0);
        const doc = currentState().doc;
        const claimed: ChordSlot = {
          ...doc.slots[0],
          notes: rhythm(),
          owned: { ...createOwnership(), pitches: true, velocity: true }
        };
        service.replaceDocument({ ...doc, slots: [claimed] });
        service.setSlotLength(claimed.id, 2);

        expect(slots()[0].notes.map(note => note.lengthBeats)).toEqual([2, 2, 2]);
      });
    });

    /**
     * A resize drag commits on every whole beat it crosses, because the card
     * has to be the length it is being dragged to. Without coalescing that is
     * one undo entry per beat, and a pointer shaking on a beat boundary used to
     * push a hundred of them and evict everything the user had done before.
     */
    describe('coalescing a run of them', () => {
      /** How many steps back the history holds, counted by walking it. */
      function undoDepth(): number {
        let depth = 0;
        while (currentState().canUndo) {
          service.undo();
          depth++;
        }
        return depth;
      }

      it('folds a run into one undo step, landing before the run began', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        service.setSlotLength(id, 6, { coalesce: true });
        service.setSlotLength(id, 7, { coalesce: true });
        expect(slots()[0].lengthBeats).toBe(7);

        service.undo();
        expect(slots()[0].lengthBeats).toBe(4);
      });

      it('leaves one step for the run and one for the chord that preceded it', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        service.setSlotLength(id, 6, { coalesce: true });

        expect(undoDepth()).toBe(2);
      });

      it('keeps two runs on the same slot two steps apart', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        service.setSlotLength(id, 6, { coalesce: true });
        service.setSlotLength(id, 7, { coalesce: false });
        service.setSlotLength(id, 8, { coalesce: true });

        service.undo();
        expect(slots()[0].lengthBeats).toBe(6);
      });

      /** Two slots are two runs, whatever order the calls arrive in. */
      it('does not fold the length of one slot into the run of another', () => {
        service.appendSlot(0);
        service.appendSlot(4);
        const [first, second] = slots().map(slot => slot.id);

        service.setSlotLength(first, 5, { coalesce: false });
        service.setSlotLength(second, 6, { coalesce: true });

        service.undo();
        expect(slots()[1].lengthBeats).toBe(4);
        expect(slots()[0].lengthBeats).toBe(5);
      });

      /**
       * A continuation with nothing to continue opens its own step. There is no
       * transaction to leave open, so a drag abandoned anywhere - a cancelled
       * pointer, a destroyed component, a throw - costs the next commit nothing.
       */
      it('opens a step for a continuation of a run that is not under way', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: true });
        service.setSlotLength(id, 6, { coalesce: true });

        expect(undoDepth()).toBe(2);
      });

      /** Undo moves the stack out from under a run, so the next commit pushes. */
      it('ends a run when the history is walked back into it', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        service.undo();
        service.setSlotLength(id, 6, { coalesce: true });

        service.undo();
        expect(slots()[0].lengthBeats).toBe(4);
      });

      /**
       * Redo has no line of its own ending the run, and does not need one: it
       * can only follow an undo, which has already ended it. Asserted rather
       * than left to that argument, because the argument is about two other
       * methods and either could move.
       */
      it('ends a run when the history is walked forward into it', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        service.undo();
        service.redo();
        service.setSlotLength(id, 6, { coalesce: true });

        service.undo();
        expect(slots()[0].lengthBeats).toBe(5);
      });

      /**
       * And a whole document arriving ends it too: nothing carries across.
       *
       * The document that arrives has to *differ* for this to say anything -
       * replacing a document with a copy of itself leaves the same length on
       * both sides of the entry, so an assertion on it would hold whether the
       * run was ended or not.
       */
      it('ends a run when a document is loaded over it', () => {
        service.appendSlot(0);
        const id = slots()[0].id;

        service.setSlotLength(id, 5, { coalesce: false });
        const loaded = structuredClone(service.doc);
        loaded.slots[0].lengthBeats = 7;
        service.replaceDocument(loaded);

        service.setSlotLength(id, 6, { coalesce: true });

        service.undo();
        expect(slots()[0].lengthBeats).toBe(7);
      });
    });
  });

  /**
   * The +/- complexity buttons. `normalizeChordSlot` throws on an extent that
   * is not on the ladder - deliberately, because `ChordExtent` is a union and
   * not a range - so keeping the stepper on the ladder is this method's job.
   */
  describe('setSlotExtent', () => {
    beforeEach(() => service.appendSlot(0));

    function extentOf(): number {
      const harmony = slots()[0].harmony;
      return harmony.kind === 'degree' ? harmony.degree.extent : -1;
    }

    it('stacks another third, and leaves the naming to the key', () => {
      service.setSlotExtent(slots()[0].id, 7);
      expect(extentOf()).toBe(7);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67, 71]);
      // The stored field is the override, untouched at `null`; the name comes
      // off the chord that was built, which is now a major seventh.
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.quality).toBeNull();
      expect(effectiveQuality(keyIntervals(), 0, 7, 0, null)).toBe('major7');
    });

    // What a stepper actually computes at the top of the ladder:
    // `CHORD_EXTENTS[5]`, which is `undefined` at runtime whatever its static
    // type. The control must stop, not throw.
    it('stops at the top rather than walking off the ladder', () => {
      service.setSlotExtent(slots()[0].id, 13);
      const past = CHORD_EXTENTS[CHORD_EXTENTS.length];
      expectNoCommit(() => service.setSlotExtent(slots()[0].id, past));
      expect(extentOf()).toBe(13);
    });

    // From the second rung rather than the first, because on the first rung
    // "refused" and "snapped back down to 3" are the same state and the spec
    // cannot tell which one it saw.
    it('stops at the bottom rather than walking off the ladder', () => {
      service.setSlotExtent(slots()[0].id, 7);
      const past = CHORD_EXTENTS[-1];
      expectNoCommit(() => service.setSlotExtent(slots()[0].id, past));
      expect(extentOf()).toBe(7);
    });

    // A caller that computed an extent instead of indexing one. Cast because
    // the union forbids these statically, which is the point: the guard is for
    // the values that reach here anyway.
    it('snaps a value that is not a rung onto the nearest one', () => {
      service.setSlotExtent(slots()[0].id, 14 as ChordExtent);
      expect(extentOf()).toBe(13);
      service.setSlotExtent(slots()[0].id, -50 as ChordExtent);
      expect(extentOf()).toBe(3);
    });

    // 5 is exactly two from 3 and two from 7. The tie resolves low, because the
    // search keeps the rung it has unless a later one is strictly closer -
    // deterministic rather than arbitrary, and pinned here so a `<` quietly
    // becoming a `<=` is a failure rather than a silent change of answer.
    it('resolves a value equidistant from two rungs onto the lower', () => {
      service.setSlotExtent(slots()[0].id, 13);
      service.setSlotExtent(slots()[0].id, 5 as ChordExtent);
      expect(extentOf()).toBe(3);
    });
  });

  /**
   * The same +/- buttons, driven the way a button actually drives them: by a
   * direction rather than by a value it had to compute for itself.
   *
   * It clamps where `setSlotExtent` can only refuse, and the difference is that
   * it steps the *index*. Off the top and off the bottom are both `undefined`
   * as values and carry no direction; as indices they are 5 and -1, which are
   * different numbers with different clamps.
   */
  describe('stepSlotExtent', () => {
    beforeEach(() => service.appendSlot(0));

    function extentOf(): number {
      const harmony = slots()[0].harmony;
      return harmony.kind === 'degree' ? harmony.degree.extent : -1;
    }

    it('stacks another third on the way up', () => {
      service.stepSlotExtent(slots()[0].id, 1);
      expect(extentOf()).toBe(7);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67, 71]);
    });

    it('takes one off on the way down', () => {
      service.setSlotExtent(slots()[0].id, 9);
      service.stepSlotExtent(slots()[0].id, -1);
      expect(extentOf()).toBe(7);
    });

    // The press that `setSlotExtent` could only refuse. Resting on the rung it
    // is already on is what clamping looks like from the user's side, so the
    // assertion is that nothing was recorded and nothing moved.
    it('rests on the top rung when it is stepped up from there', () => {
      service.setSlotExtent(slots()[0].id, 13);
      expectNoCommit(() => service.stepSlotExtent(slots()[0].id, 1));
      expect(extentOf()).toBe(13);
    });

    it('rests on the bottom rung when it is stepped down from there', () => {
      expectNoCommit(() => service.stepSlotExtent(slots()[0].id, -1));
      expect(extentOf()).toBe(3);
    });

    // A delta big enough to leave the ladder entirely, which is where clamping
    // and refusing part company: an index of 99 or -97 is off the array either
    // way, so a stepper that did not clamp would sit still instead of arriving
    // at the end. Both ends, because a clamp is two numbers.
    it('clamps a stride past the top onto the last rung', () => {
      service.stepSlotExtent(slots()[0].id, 99);
      expect(extentOf()).toBe(13);
    });

    it('clamps a stride past the bottom onto the first rung', () => {
      service.setSlotExtent(slots()[0].id, 9);
      service.stepSlotExtent(slots()[0].id, -99);
      expect(extentOf()).toBe(3);
    });

    // The tempo box's hazard one control over: an emptied number input reads
    // as `NaN`,
    // and `NaN` rungs in either direction is not a direction at all.
    it('refuses a step that is not a number', () => {
      expectNoCommit(() => service.stepSlotExtent(slots()[0].id, Number.NaN));
      expect(extentOf()).toBe(3);
    });

    it('ignores an id the document does not have', () => {
      expectNoCommit(() => service.stepSlotExtent('not-a-slot', 1));
    });
  });

  describe('setSlotInversion', () => {
    beforeEach(() => service.appendSlot(0));

    it('voices the chord from its third', () => {
      service.setSlotInversion(slots()[0].id, 1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([64, 67, 72]);
    });

    // Cyclic, so it wraps where octave clamps: the inversion above the last is
    // root position again, and it is stored wrapped so it stays nameable.
    //
    // It leaves root position first, and asserts that it did. Asking an
    // untouched slot for inversion 3 normalises to 0, changes nothing and
    // commits nothing - so the spec would be asserting the state `appendSlot`
    // had already left, and would pass against a method with an empty body. The
    // middle assertion is what makes the last two mean something: the chord
    // demonstrably moved, and then came back.
    it('wraps an inversion past the last one back to root position', () => {
      service.setSlotInversion(slots()[0].id, 1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([64, 67, 72]);

      service.setSlotInversion(slots()[0].id, 3);
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.inversion).toBe(0);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67]);
    });
  });

  describe('setSlotOctave', () => {
    beforeEach(() => service.appendSlot(0));

    it('shifts the voicing base by whole octaves', () => {
      service.setSlotOctave(slots()[0].id, 1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([72, 76, 79]);
    });

    // Against the constant rather than its value: what this spec is about is
    // that the setter clamps and then records nothing at the stop, and the
    // number itself is derived from a MIDI sweep and pinned to a literal in
    // `progression-normalize.spec.ts`. Writing it twice made this spec fail when
    // the sweep moved the bound, which is noise rather than a finding.
    it('clamps past the top of the range and records nothing there', () => {
      service.setSlotOctave(slots()[0].id, 9);
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.octave).toBe(OCTAVE_MAX);
      expectNoCommit(() => service.setSlotOctave(slots()[0].id, 9));
    });
  });

  describe('setKey', () => {
    it('regenerates every degree slot when the key changes', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67]);

      service.setKey(9, 'aeolian');

      // I in C major is C E G; the same slot index in A minor is A C E.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([69, 72, 76]);
      // And the second slot moved too, which is what "every" means: V in C
      // major is G B D, and the same slot index in A minor is v, E G B.
      expect(slots()[1].notes.map(note => note.midi % 12).sort((a, b) => a - b)).toEqual([
        4, 7, 11
      ]);
    });

    /**
     * A `null` quality is re-derived rather than rewritten: the key change moves
     * the notes and the name follows them, with nothing written into the field
     * that would have to be undone by the next key change.
     */
    it('re-derives a slot that overrides nothing from the new key', () => {
      service.appendSlot(0);
      service.setKey(9, 'aeolian');
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.quality).toBeNull();
      expect(effectiveQuality(keyIntervals(), 0, 3, 0, null)).toBe('minor');
    });

    /**
     * The spelling comes from the key's own signature, which is `b514027`'s
     * rule reaching this page.
     *
     * It was the scale's own `preferSharps` until the chord palette printed
     * `D♯ Maj` as the tonic chord of E flat major. A signature belongs to the
     * key: E flat major carries three flats whatever the ionian scale declares,
     * and the ionian scale declares sharps.
     */
    describe('the spelling it stores', () => {
      /** The key's own preference after a move, which is what the page reads. */
      function preferSharps(): boolean {
        return currentState().doc.key.preferSharps;
      }

      it('spells a flat major key with flats', () => {
        service.setKey(3, 'ionian');
        expect(preferSharps()).toBeFalse();
      });

      it('spells a sharp major key with sharps', () => {
        service.setKey(11, 'ionian');
        expect(preferSharps()).toBeTrue();
      });

      // The b514027 case, one page over: a minor key inherits its relative
      // major's signature rather than the aeolian scale's flat default.
      it('spells a sharp minor key with sharps', () => {
        service.setKey(4, 'aeolian');
        expect(preferSharps()).toBeTrue();

        service.setKey(6, 'aeolian');
        expect(preferSharps()).toBeTrue();
      });

      it('spells a flat minor key with flats', () => {
        service.setKey(2, 'aeolian');
        expect(preferSharps()).toBeFalse();
      });

      /**
       * A signature of nothing carries no preference, so the scale's own
       * default is still what decides - which is the honest answer rather than
       * a fallback from failure.
       */
      it('leaves a key with no accidentals to the scale it is in', () => {
        service.setKey(9, 'aeolian');
        expect(preferSharps()).toBeFalse();

        service.setKey(0, 'ionian');
        expect(preferSharps()).toBeTrue();
      });

      // A pentatonic has no parent major to inherit from at all.
      it('leaves a scale with no signature to its own preference', () => {
        service.setKey(3, 'majorPentatonic');
        expect(preferSharps()).toBeTrue();
      });

      /** No scale to ask, so the preference already in force is kept. */
      it('keeps the preference in force for an id it cannot resolve', () => {
        service.setKey(3, 'ionian');
        service.setKey(11, 'no-such-scale');
        expect(preferSharps()).toBeFalse();
      });

      /**
       * The tonic is bounded before the signature is looked up. 15 is E flat's
       * pitch class an octave up, and a signature looked up from 15 is no
       * signature at all - which would silently hand the key back to the
       * ionian scale's sharp default.
       */
      it('reads the signature of the tonic it stores', () => {
        service.setKey(15, 'ionian');
        expect(currentState().doc.key.tonic).toBe(3);
        expect(preferSharps()).toBeFalse();
      });
    });

    it('wraps a tonic past the end of the chromatic scale', () => {
      service.setKey(13, 'ionian');
      expect(currentState().doc.key.tonic).toBe(1);
    });

    /**
     * The stored tonic is wrapped on the way out of the commit, and the notes
     * are generated inside it - so the two would disagree if the generator were
     * handed the raw value.
     *
     * Today they agree either way, because `voiceChord` reduces every pitch
     * class mod 12 and 13 sounds as 1. That is an accident of a module two
     * layers down rather than a promise this one makes, so the agreement is
     * pinned here: a voicing that stopped reducing would otherwise move these
     * notes an octave without failing a single spec.
     */
    it('generates from the tonic it stores, not the one it was handed', () => {
      service.appendSlot(0);
      service.setKey(13, 'ionian');
      expect(currentState().doc.key.tonic).toBe(1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([61, 65, 68]);
    });
  });

  /**
   * Regeneration is a **merge** and not a replace, which is the idea M2 turns
   * on. `SlotOwnership` says which of a slot's three dimensions are the user's,
   * and each is answered separately:
   *
   * | dimension | owned | not owned |
   * |---|---|---|
   * | pitches | transposed by the interval | re-voiced from the degree |
   * | timing | kept | regenerated as a block |
   * | velocity | kept | reset to `DEFAULT_VELOCITY` |
   *
   * `setKey` is the driver here because it is the one path that regenerates
   * every slot, and `replaceDocument` is how ownership is installed: it writes
   * the field without going near the setters that normally claim it, so a slot
   * can be put into any of the eight states in one line.
   *
   * The interval those transpositions use is `keyTransposeInterval`, tabulated
   * on its own further down; the parameter it feeds is exercised there too,
   * directly, without `setKey`'s help.
   */
  describe('regenerating a slot the user owns part of', () => {
    /**
     * Three notes with distinct pitch, timing and velocity, so that a merge
     * which dropped or confused any one dimension is visible rather than hidden
     * behind two that happen to agree.
     *
     * The shape is **nobody's triad** - a semitone and then a fifth - and that
     * matters now that a claimed voicing is re-anchored onto the chord it
     * belongs to. A C-E flat-G held over A minor lands on 69-72-76 once
     * anchored, which is A minor's own I to the note, so a spec asserting
     * "moved, not re-voiced" with a real triad would pass whichever of the two
     * had happened. This shape can only have been moved.
     *
     * Its lowest note is middle C, which is where a I in C major is voiced
     * from, so the voicing starts sitting exactly on its chord: the anchor has
     * no octave to reclaim, and every expectation below is the transposition
     * plus whatever the anchor adds and not an artefact of a fixture that began
     * out of position.
     *
     * Built per call: the specs below compare against it, and a shared array of
     * shared objects would let one of them edit the yardstick.
     */
    function handEdited(): RollNote[] {
      return [
        { midi: 60, startBeat: 0, lengthBeats: 0.5, velocity: 40 },
        { midi: 61, startBeat: 1.5, lengthBeats: 0.25, velocity: 100 },
        { midi: 67, startBeat: 3, lengthBeats: 1, velocity: 20 }
      ];
    }

    /** A I in C major holding `notes` and owning `owned`. Its id. */
    function claim(owned: Partial<SlotOwnership>, notes: RollNote[]): string {
      service.appendSlot(0);
      const doc = currentState().doc;
      const claimed: ChordSlot = {
        ...doc.slots[0],
        notes,
        owned: { ...createOwnership(), ...owned }
      };
      service.replaceDocument({ ...doc, slots: [claimed] });
      return claimed.id;
    }

    function notes(): RollNote[] {
      return slots()[0].notes;
    }

    /**
     * What the slot would sound if it owned nothing: the chord the key builds,
     * in the register the key builds it in.
     *
     * The anchor's expectations are relative to this rather than to a written-
     * out number, because that is the claim being made - a claimed voicing sits
     * where its chord sits - and a hand-copied table of twelve generated basses
     * would be pinning `voiceChord`'s arithmetic a second time in the wrong
     * file.
     */
    function revoiced(): number[] {
      const state = currentState();
      const slot = state.doc.slots[0];
      const generated = regenerateSlot(
        { ...slot, owned: createOwnership() },
        state.doc.key,
        state.keyScale?.intervals ?? null
      );
      return generated.notes.map(note => note.midi);
    }

    // I in C major is C-E-G; the same degree in A minor is A-C-E.
    const RE_VOICED = [69, 72, 76];

    it('replaces every dimension of a slot that owns nothing', () => {
      claim({}, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes()).toEqual([
        { midi: 69, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 72, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 76, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }
      ]);
    });

    it('keeps the timing of a slot that owns it while the pitches re-voice', () => {
      claim({ timing: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      // Velocity was not claimed, so it is not kept.
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    /**
     * The pitch row's "owned" column, which is the case the whole merge is
     * argued from.
     *
     * A claimed voicing is not re-voiced; it is **moved**, and its shape comes
     * through untouched. `setKey` computes the interval, being the only caller
     * that sees both keys, and `anchoredShift` then settles which octave the
     * moved voicing lands in - see below, and the function's own docstring for
     * why the interval alone could not be trusted with that.
     */
    it('transposes the pitches of a slot that owns them into the new key', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');

      // A semitone and then a fifth, exactly as the user stacked them, where A
      // minor's own I would be the [69, 72, 76] every unclaimed slot gets.
      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      // Neither of the other two was claimed, so the block returns.
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    /**
     * Which octave a moved voicing lands in is the **anchor's** answer and not
     * the interval's.
     *
     * `keyTransposeInterval` reads C to A as -3 rather than +9, and on its own
     * that would have put this voicing at 57-58-64, three semitones below where
     * the user left it, while every unclaimed slot in the progression went up
     * to A minor's own register at 69. The anchor puts the claimed voicing back
     * on its chord - the same offset from it as before, which here is none -
     * so the whole progression moves together.
     *
     * The octave of the interval is therefore not observable in what a slot
     * sounds: only its pitch class is. That is what closes the cycles below.
     */
    it('lands a moved voicing on the chord it was sitting on', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');

      const chord = revoiced();
      expect(Math.min(...notes().map(note => note.midi))).toBe(Math.min(...chord));
    });

    it('keeps the offset a voicing was written at, rather than flattening it', () => {
      // The same shape parked a fourth below its chord. The anchor moves in
      // whole octaves only, so the fourth survives the key change intact.
      claim(
        { pitches: true },
        handEdited().map(note => ({ ...note, midi: note.midi - 5 }))
      );
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([64, 65, 71]);
    });

    /**
     * A key change and its inverse cancel, which they did before the anchor
     * too - `keyTransposeInterval` is antisymmetric, so a pair was always the
     * easy case. The laps below are the ones that were not.
     */
    it('puts a claimed voicing back when the key comes back', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');
      service.setKey(0, 'ionian');

      expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
    });

    /**
     * A lap of the circle of fifths, both ways round, and a lap in major
     * thirds. None of the three is a pair, and that is the whole point: the
     * antisymmetry of `keyTransposeInterval` bounds a 2-cycle and constrains no
     * longer route at all, so before `anchoredShift` each of these walked.
     *
     * Twelve clockwise fifths were twelve moves of -5 and took this voicing
     * from 60 to 0; twelve anticlockwise took it to 120; C-E-G sharp-C gained
     * an octave a lap, for ever. `frequencyOf` would have sounded the first two
     * at 8 Hz and 790 kHz.
     *
     * The fix is not a bound but a **shape**: the answer is a function of the
     * key arrived in rather than of the route taken to it, so every cycle
     * closes by construction and these three are witnesses rather than the
     * whole of the guarantee.
     */
    describe('a lap of the circle', () => {
      /** Walks `tonics` in order, in the mode the progression starts in. */
      function walk(tonics: readonly number[]): void {
        for (const tonic of tonics) service.setKey(tonic, 'ionian');
      }

      /** The twelve keys a repeated step of `semitones` visits, ending home. */
      function lap(semitones: number): number[] {
        return Array.from({ length: 12 }, (_, step) => ((step + 1) * semitones) % 12);
      }

      it('comes home from twelve fifths clockwise', () => {
        claim({ pitches: true }, handEdited());
        walk(lap(7));

        expect(currentState().doc.key.tonic).toBe(0);
        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('comes home from twelve fifths anticlockwise', () => {
        claim({ pitches: true }, handEdited());
        walk(lap(5));

        expect(currentState().doc.key.tonic).toBe(0);
        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('comes home from a lap in major thirds', () => {
        // C to E to G sharp and home: three moves of +4, each of them the
        // nearest reading of its pitch class, and each of them upward. No
        // pairwise property can cancel a lap of three.
        claim({ pitches: true }, handEdited());
        walk([4, 8, 0]);

        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('stays in earshot part-way round', () => {
        // Not only at the ends: five clicks clockwise used to leave this
        // voicing at 35, and twenty-five at -65. The anchor holds every step
        // inside a tritone of the chord the key generates.
        claim({ pitches: true }, handEdited());

        for (let step = 1; step <= 25; step++) {
          service.setKey((step * 7) % 12, 'ionian');

          const lowest = Math.min(...notes().map(note => note.midi));
          expect(Math.abs(lowest - Math.min(...revoiced()))).toBeLessThanOrEqual(6);
        }
      });
    });

    it('moves a claimed voicing by nothing when only the mode changes', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(0, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
    });

    /**
     * The tonic is wrapped on the way into the document, and the interval is
     * measured from the value that is *stored* rather than the one that
     * arrived. 21 is A an octave up, and a delta taken from it is +21.
     *
     * **The pitches no longer witness that**, and it is worth saying why rather
     * than leaving the assertion looking sharper than it is: `anchoredShift`
     * takes whole octaves off the moved voicing, so +21 and -3 land on the same
     * three notes. Only the pitch class of the interval is observable now,
     * which is precisely the property that closes the laps above. What is left
     * to assert is the tonic the document stores - the chord is generated from
     * that, so an unwrapped one would still be wrong here - and the pitches, as
     * a regression guard over the whole path rather than over the interval.
     */
    it('measures the interval from the tonic it stores', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(21, 'aeolian');

      expect(currentState().doc.key.tonic).toBe(9);
      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
    });

    /**
     * And the tritone, which used to be the one interval whose *direction* an
     * unwrapped tonic could flip: `keyTransposeInterval`'s tie-break reads the
     * two tonics themselves, so -6 and the 6 it is stored as point the move in
     * opposite directions. That flip cost an octave a round trip, and the
     * anchor now absorbs it along with every other whole-octave difference.
     *
     * Kept for the tonic, and because a spelling that arrives as a negative is
     * a real thing for the circle of fifths to send.
     */
    it('measures the tritone from the tonic it stores too', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(-6, 'ionian');

      expect(currentState().doc.key.tonic).toBe(6);
      expect(notes().map(note => note.midi)).toEqual([66, 67, 73]);
    });

    it('keeps the velocities of a slot that owns them while the rest regenerates', () => {
      claim({ velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    // The case the design doc argues the whole mechanism from: a groove written
    // in C survives the switch to A minor while the chord re-voices under it.
    it('keeps a groove while the chord under it re-voices', () => {
      claim({ timing: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
    });

    /**
     * The other two pairs, which had no spec of their own.
     *
     * `mergeNotes` answers each dimension from its own branch and has no
     * combination branch at all, so a pair carries little risk - but "no
     * combination branch" is a fact about today's implementation rather than
     * part of the contract, and six of eight subsets covered is a gap that
     * reads as an oversight. With these two, all eight are stated.
     */
    it('keeps owned pitches and owned timing together', () => {
      claim({ pitches: true, timing: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      // Velocity is the one dimension not claimed here.
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    it('keeps owned pitches and owned velocities together', () => {
      claim({ pitches: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
      // Timing is the one dimension not claimed here, so the block returns.
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    /**
     * A slot that owns all three keeps everything it wrote and follows the key
     * with it. The pitches move because moving them is what owning them means
     * across a transposition; nothing else about the notes changes at all.
     */
    it('moves a slot that owns all three, and changes nothing else about it', () => {
      claim({ pitches: true, timing: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes()).toEqual(
        handEdited().map(note => ({ ...note, midi: note.midi + 9 }))
      );
    });

    /**
     * Pitches decide how many notes there are, because a note is a pitch: a
     * user who added two owns the count, and the three-note triad the key
     * offers has nothing to say at indices 3 and 4.
     *
     * The two dimensions that were *not* claimed still have to be answered
     * there, and the answer is the block the generator would have written - not
     * `undefined`, which would reach Tone as a schedule time and a duration by
     * the road the model's first clause exists to close.
     */
    it('regenerates the unowned dimensions of notes the chord cannot reach', () => {
      claim({ pitches: true }, [
        ...handEdited(),
        { midi: 70, startBeat: 2, lengthBeats: 2, velocity: 55 },
        { midi: 74, startBeat: 2.5, lengthBeats: 2, velocity: 55 }
      ]);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76, 79, 83]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4, 4, 4]);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80, 80, 80]);
    });

    /**
     * And the other way round: a chord that grows past the notes the user owns.
     * A complexity step turns a triad into a seventh, so there is a fourth note
     * with no claimed counterpart at its index.
     *
     * It joins the last note the user placed rather than being given a block of
     * its own. A chord tone added under a hand-written rhythm belongs to the
     * event that rhythm ends on; a note springing back to the slot's start and
     * full length would be the one voice ignoring the groove.
     */
    it('gives a note the chord grew past the timing of the last one owned', () => {
      const id = claim({ timing: true }, handEdited());
      service.stepSlotExtent(id, 1);

      expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1, 1]);
    });

    it('gives a note the chord grew past the velocity of the last one owned', () => {
      const id = claim({ velocity: true }, handEdited());
      service.stepSlotExtent(id, 1);

      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20, 20]);
    });

    /**
     * An empty note list under a claim is not something the app writes, and
     * `replaceDocument` is the door that lets one in. It has to be answered
     * with the default rather than with `undefined`, for the reason above.
     */
    it('falls back to the default velocity when there is nothing owned to keep', () => {
      claim({ velocity: true }, []);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    it('falls back to the regenerated timing when there is nothing owned to keep', () => {
      claim({ timing: true }, []);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    /**
     * The four commands that restate the chord take the pitches back.
     *
     * Without this they collide with a claim over `pitches`, and the collision
     * is not a near miss: a complexity step stores `extent: 7`, so
     * `effectiveQuality` prints `Imaj7` on the card while `mergeNotes` hands
     * back the three pitches the user was holding. One press, no audible
     * change, and the label now disagrees with the synth - which is the exact
     * failure `effectiveQuality`'s docstring is built to prevent.
     *
     * A key change is the other half of the rule and reclaims nothing, because
     * it restates no chord: keeping a voicing across a transposition is what
     * the merge is for.
     */
    describe('a harmony command reclaiming the pitches', () => {
      /**
       * All four, and what each re-voices a claimed I in C major to. Listed
       * rather than written out one `it` at a time so that "all four" is
       * visible: a fifth command routed through `editDegree` should arrive here
       * as a row rather than be left to be noticed.
       */
      const COMMANDS: readonly {
        name: string;
        run: (id: string) => void;
        revoiced: number[];
      }[] = [
        {
          name: 'setSlotExtent',
          run: id => service.setSlotExtent(id, 7),
          revoiced: [60, 64, 67, 71]
        },
        {
          name: 'stepSlotExtent',
          run: id => service.stepSlotExtent(id, 1),
          revoiced: [60, 64, 67, 71]
        },
        {
          name: 'setSlotInversion',
          run: id => service.setSlotInversion(id, 1),
          revoiced: [64, 67, 72]
        },
        {
          name: 'setSlotOctave',
          run: id => service.setSlotOctave(id, 1),
          revoiced: [72, 76, 79]
        }
      ];

      function owned(): SlotOwnership {
        return slots()[0].owned;
      }

      for (const command of COMMANDS) {
        it(`${command.name} re-voices a claimed slot rather than mislabelling it`, () => {
          const id = claim({ pitches: true }, handEdited());
          command.run(id);

          expect(notes().map(note => note.midi)).toEqual(command.revoiced);
          expect(owned().pitches).toBeFalse();
        });
      }

      /**
       * The reclaim is narrow. A complexity step restates the chord and not the
       * groove, so the rhythm and the dynamics the user wrote come through it -
       * the fourth note the seventh adds joins the last onset, which is
       * `noteAt`'s clamp.
       */
      it('keeps the rhythm and the dynamics it did not restate', () => {
        const id = claim({ pitches: true, timing: true, velocity: true }, handEdited());
        service.stepSlotExtent(id, 1);

        expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71]);
        expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3, 3]);
        expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1, 1]);
        expect(notes().map(note => note.velocity)).toEqual([40, 100, 20, 20]);
        expect(owned()).toEqual({ pitches: false, timing: true, velocity: true });
      });

      /**
       * Which is what makes taking the pitches back the safe answer rather than
       * a destructive one: the user who did not mean it is one keystroke from
       * having them, where a stepper that silently refused to move would leave
       * them no way to find out why.
       */
      it('is undone by undo, claim and all', () => {
        const id = claim({ pitches: true }, handEdited());
        service.stepSlotExtent(id, 1);
        service.undo();

        expect(notes()).toEqual(handEdited());
        expect(owned().pitches).toBeTrue();
      });

      /**
       * The reclaim rides on the commit, so a command that is refused as a
       * no-op reclaims nothing. A stepper resting on its limit is a normal
       * thing to press repeatedly, and pressing it must not cost a claim.
       */
      it('reclaims nothing when the command changes nothing', () => {
        const id = claim({ pitches: true }, handEdited());
        service.stepSlotExtent(id, -1);

        expect(owned().pitches).toBeTrue();
        expect(notes()).toEqual(handEdited());
      });

      /**
       * The other half of the rule, asserted so that moving the reclaim down
       * into `regenerateSlot` - where it would catch every path - fails here
       * rather than quietly undoing the merge's whole purpose.
       */
      it('is not something a key change does', () => {
        claim({ pitches: true }, handEdited());
        service.setKey(9, 'aeolian');

        expect(owned().pitches).toBeTrue();
      });
    });
  });

  /**
   * A non-null `quality` is the user's override, and every regeneration path
   * has to leave it alone. It used to be overwritten with the *derived* label
   * on each of them, which is consequence 4 of the design doc's correction
   * section: an override written into the field survived until the next key
   * change, complexity step or resize and no longer.
   *
   * bVII is the case that correction is argued from. In C major the key gives
   * degree 6 as B-D-F, a diminished triad; bVII is B flat-D-F, which needs the
   * root displaced *and* the shape overridden - neither alone reaches it.
   */
  describe('a quality override', () => {
    /** A bVII in C major, installed through the one door that can write one. */
    function borrow(): string {
      service.appendSlot(6);
      const doc = currentState().doc;
      const slot = doc.slots[0];
      if (slot.harmony.kind !== 'degree') throw new Error('appendSlot built no degree');

      const borrowed: ChordSlot = {
        ...slot,
        harmony: {
          kind: 'degree',
          degree: { ...slot.harmony.degree, alter: -1, quality: 'major' }
        }
      };
      service.replaceDocument({ ...doc, slots: [borrowed] });

      // `replaceDocument` settles a document; it does not regenerate one, so
      // the override reaches the notes on the first regeneration after it.
      // Re-selecting the key already in force is the smallest one available,
      // and until the palette can emit a borrowed chord there is no other.
      // `replaceDocument`'s own docstring records the consequence and the rule
      // it puts on Task 9: a path that emits harmony must be a path that
      // regenerates, and this is a test's licence rather than an example.
      service.setKey(0, 'ionian');
      return slot.id;
    }

    function degree(): ChordDegree {
      const harmony = slots()[0].harmony;
      if (harmony.kind !== 'degree') throw new Error('the slot lost its degree');
      return harmony.degree;
    }

    it('sounds the borrowed chord rather than the one the key gives', () => {
      borrow();
      // B flat-D-F, where the key's own degree 6 is B-D-F: one note apart, and
      // the note is the one the accidental moves.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([70, 74, 77]);
    });

    /**
     * A regression guard rather than a test of the merge, and named so.
     *
     * `setSlotLength` goes through `retimeNotes`, which writes the new length
     * onto the notes that are already there and never regenerates - so the
     * override survives it trivially, and would have survived it before the
     * write into `quality` was removed. It is kept because a future
     * `setSlotLength` that regenerated instead would be a real way to lose an
     * override, and this is where that would show. It proves nothing about the
     * paths that do regenerate; the three specs below are those.
     */
    it('survives a resize, which does not regenerate the slot at all', () => {
      const id = borrow();
      service.setSlotLength(id, 2);

      expect(degree().quality).toBe('major');
      expect(slots()[0].notes.map(note => note.midi)).toEqual([70, 74, 77]);
    });

    it('survives a complexity step', () => {
      const id = borrow();
      service.stepSlotExtent(id, 1);

      expect(degree().quality).toBe('major');
      expect(degree().extent).toBe(7);
      // The override sets the triad; the seventh stays the key's own A, which
      // makes this a B flat major seventh.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([70, 74, 77, 81]);
    });

    it('survives a key change', () => {
      const id = borrow();
      service.setKey(9, 'aeolian');

      expect(degree().quality).toBe('major');
      // Degree 6 of A minor is G; flattened and built major, that is
      // G flat-B flat-D flat.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([66, 70, 73]);
      expect(slots()[0].id).toBe(id);
    });

    it('survives an inversion and an octave shift', () => {
      const id = borrow();
      service.setSlotInversion(id, 1);
      expect(degree().quality).toBe('major');

      service.setSlotOctave(id, 1);
      expect(degree().quality).toBe('major');
    });
  });

  /**
   * The transposition half of the merge, exercised directly.
   *
   * "Transpose by the interval" needs the *old* key, which `regenerateSlot`
   * cannot see, so the delta is an explicit parameter rather than something it
   * infers. `setKey` is the only caller that can compute one and does not pass
   * it until Task 5, so every other call site passes 0 - which means no setter
   * reaches this branch yet, and a rule with no test is a rule someone deletes.
   *
   * The interval is half the answer. `anchoredShift` is the other half: it
   * takes whole octaves off the moved voicing until it sits on the chord the
   * new key generates, which is what stops the stored pitch being a running sum
   * over every key change the document has ever seen. The last two specs here
   * are that half on its own, where the drift can be arranged rather than
   * accumulated.
   */
  describe('the interval a regeneration transposes by', () => {
    const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
    const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

    /** Pitches that are nobody's idea of a C major triad, so a re-voice shows. */
    function held(): RollNote[] {
      return [
        { midi: 61, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 65, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 68, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }
      ];
    }

    function owning(owned: Partial<SlotOwnership>): ChordSlot {
      return {
        ...createDegreeSlot(0, 0),
        notes: held(),
        owned: { ...createOwnership(), ...owned }
      };
    }

    it('moves owned pitches by it', () => {
      const merged = regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, -3);
      expect(merged.notes.map(note => note.midi)).toEqual([58, 62, 65]);
    });

    it('leaves unowned pitches to be re-voiced, whatever the interval', () => {
      const merged = regenerateSlot(owning({}), C_MAJOR, MAJOR, -3);
      expect(merged.notes.map(note => note.midi)).toEqual([60, 64, 67]);
    });

    it('moves nothing when it is not given', () => {
      const merged = regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR);
      expect(merged.notes.map(note => note.midi)).toEqual([61, 65, 68]);
    });

    /**
     * The anchor, on its own, away from `setKey`'s arithmetic.
     *
     * A I in C major is voiced from middle C, so a claimed voicing two octaves
     * under it is 24 semitones out of position. Whatever interval it is
     * transposed by, the result lands within a tritone of 60: the octaves are
     * taken off the sum rather than added to it, which is the whole of the fix.
     */
    it('takes whole octaves off a voicing that has drifted from its chord', () => {
      const strayed: ChordSlot = {
        ...owning({ pitches: true }),
        notes: held().map(note => ({ ...note, midi: note.midi - 24 }))
      };

      const merged = regenerateSlot(strayed, C_MAJOR, MAJOR, -3);

      // The shape - a fourth and then a minor third - is untouched; only the
      // register moved, and it moved in twelves.
      expect(merged.notes.map(note => note.midi)).toEqual([58, 62, 65]);
    });

    /**
     * And the anchor is measured against the **chord**, not against a fixed
     * register.
     *
     * `voiceChord` stacks from a floor, so where a chord sits depends on which
     * chord it is: a I in C major is voiced from middle C and a vii - B-D-F -
     * from the B eleven semitones above it. A voicing written on that vii is
     * eleven clear of the base and is not out of position at all, and an anchor
     * that measured from the base rather than from the chord would haul it down
     * an octave the first time the key moved.
     */
    it('anchors to the chord the slot builds, not to the voicing base', () => {
      const leadingTone: ChordSlot = {
        ...createDegreeSlot(6, 0),
        notes: [71, 74, 78].map(midi => ({
          midi,
          startBeat: 0,
          lengthBeats: 4,
          velocity: DEFAULT_VELOCITY
        })),
        owned: { ...createOwnership(), pitches: true }
      };

      const merged = regenerateSlot(leadingTone, C_MAJOR, MAJOR);

      // B-D-F sharp against the key's B-D-F: the top note is the user's, and
      // nothing has been moved by an octave to bring it nearer middle C.
      expect(merged.notes.map(note => note.midi)).toEqual([71, 74, 78]);
    });

    /**
     * `RollNote.midi` reaches `Tone.PolySynth` with nothing between here and
     * there that looks at it again, and this parameter is added straight to it.
     * A value of the wrong kind is the first clause of the model's rule, and it
     * throws where it was introduced rather than three layers downstream.
     */
    it('refuses an interval that is not a whole number of semitones', () => {
      expect(() => regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, Number.NaN))
        .toThrowError(/transpose/i);
      expect(() => regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, 0.5))
        .toThrowError(/transpose/i);
      // Refused whether or not this particular slot would have used it: the
      // caller passing one is the bug, not the slot that happens to receive it.
      expect(() => regenerateSlot(owning({}), C_MAJOR, MAJOR, Number.NaN))
        .toThrowError(/transpose/i);
    });
  });

  /**
   * How far a key change moves a voicing the user owns.
   *
   * A rule rather than a subtraction: C to A is +9 and -3, the same chord in
   * two registers. `ProgressionService.setKey` is the only caller, and the
   * specs above exercise it through that door; this is the arithmetic on its
   * own, where all 144 pairs can be swept rather than sampled.
   */
  describe('keyTransposeInterval', () => {
    /**
     * The nearer of a pitch class's two readings. The upward one is what a
     * plain `(to - from + 12) % 12` gives, and the second half of this table is
     * where the two disagree.
     */
    const NEAREST: readonly { from: number; to: number; expected: number }[] = [
      { from: 0, to: 0, expected: 0 },
      { from: 0, to: 1, expected: 1 },
      { from: 0, to: 5, expected: 5 },
      { from: 0, to: 7, expected: -5 },
      { from: 0, to: 9, expected: -3 },
      { from: 0, to: 11, expected: -1 },
      { from: 9, to: 0, expected: 3 },
      { from: 11, to: 0, expected: 1 },
      { from: 7, to: 2, expected: -5 },
      { from: 4, to: 8, expected: 4 }
    ];

    for (const move of NEAREST) {
      it(`moves a voicing from tonic ${move.from} to tonic ${move.to} by ${move.expected}`, () => {
        expect(keyTransposeInterval(move.from, move.to)).toBe(move.expected);
      });
    }

    it('never moves a voicing further than a tritone', () => {
      for (let from = 0; from < 12; from++) {
        for (let to = 0; to < 12; to++) {
          expect(Math.abs(keyTransposeInterval(from, to))).toBeLessThanOrEqual(6);
        }
      }
    });

    /** Nearest is worth nothing if it is nearest to the wrong note. */
    it('always lands on the pitch class of the new tonic', () => {
      for (let from = 0; from < 12; from++) {
        for (let to = 0; to < 12; to++) {
          const landed = (((from + keyTransposeInterval(from, to)) % 12) + 12) % 12;
          expect(landed).toBe(to);
        }
      }
    });

    /**
     * The property the tritone tie-break exists for, swept over every pair.
     *
     * `mergeNotes` adds this interval straight to `RollNote.midi` and nothing
     * downstream bounds the sum, so a rule that did not cancel would walk a
     * claimed voicing an octave per flip of the circle - with no floor and no
     * ceiling to stop it.
     */
    it('cancels itself when the key comes back', () => {
      for (let from = 0; from < 12; from++) {
        for (let to = 0; to < 12; to++) {
          expect(keyTransposeInterval(from, to) + keyTransposeInterval(to, from)).toBe(0);
        }
      }
    });

    /**
     * Which the tritone can only manage by consulting the tonics rather than
     * the interval between them: six up and six down are the same distance, so
     * a rule reading only the difference would answer both directions the same
     * way and the pair would not cancel.
     */
    it('resolves the tritone by the direction the tonic moves', () => {
      expect(keyTransposeInterval(0, 6)).toBe(6);
      expect(keyTransposeInterval(6, 0)).toBe(-6);
      expect(keyTransposeInterval(5, 11)).toBe(6);
      expect(keyTransposeInterval(11, 5)).toBe(-6);
    });

    it('moves nothing when the tonic does not move', () => {
      for (let tonic = 0; tonic < 12; tonic++) {
        expect(keyTransposeInterval(tonic, tonic)).toBe(0);
      }
    });
  });

  /**
   * The setters the piano roll needs, and the first code in the app that writes
   * `SlotOwnership` at all.
   *
   * Each claims **exactly the dimension it changes**, which is the whole point
   * of tracking three rather than one: a velocity nudge must not opt a slot out
   * of re-voicing, and a pitch drag must not make the app believe the user
   * wrote the rhythm. `resetSlotToChord` is the way back from all three.
   *
   * They all coalesce, because they are all driven by a pointer. That mechanism
   * is `setSlotLength`'s and the argument for it is recorded there: a drag that
   * commits per pixel-crossed threshold pushes an undo entry per threshold, and
   * `MAX_HISTORY` is 100.
   */
  describe('the setters the roll writes through', () => {
    let id: string;

    beforeEach(() => {
      service.appendSlot(0);
      id = slots()[0].id;
    });

    function notes(): RollNote[] {
      return slots()[0].notes;
    }

    function owned(): SlotOwnership {
      return slots()[0].owned;
    }

    /** How many steps back the history holds, counted by walking it. */
    function undoDepth(): number {
      let depth = 0;
      while (currentState().canUndo) {
        service.undo();
        depth++;
      }
      return depth;
    }

    describe('setSlotNotes', () => {
      const DRAWN: readonly RollNote[] = [
        { midi: 62, startBeat: 0.5, lengthBeats: 1, velocity: 90 },
        { midi: 69, startBeat: 2, lengthBeats: 2, velocity: 50 }
      ];

      it('replaces the notes and claims the pitches', () => {
        service.setSlotNotes(id, DRAWN);

        expect(notes()).toEqual([...DRAWN]);
        expect(owned()).toEqual({ pitches: true, timing: false, velocity: false });
      });

      /**
       * The claim is narrow on purpose, and this is the consequence Task 7
       * inherits rather than discovers: a note *placed* in time is a timing
       * edit as well as a pitch one, and this setter says nothing about time.
       * `placeNotes` is the setter for that gesture. Claiming all three from
       * here would collapse per-aspect ownership back into the single boolean
       * this milestone exists to replace, one setter at a time.
       */
      it('leaves the timing it stored to be regenerated, having not claimed it', () => {
        service.setSlotNotes(id, DRAWN);
        service.setKey(9, 'aeolian');

        expect(notes().map(note => note.startBeat)).toEqual([0, 0]);
        expect(notes().map(note => note.lengthBeats)).toEqual([4, 4]);
        expect(notes().map(note => note.velocity)).toEqual([80, 80]);
        // The pitches, which it did claim, moved with the key - two semitones
        // above A minor's own bass, which is where they were above C major's.
        expect(notes().map(note => note.midi)).toEqual([71, 78]);
      });

      /** Deleting the last note is a pitch-set edit like any other. */
      it('lets every note be deleted', () => {
        service.setSlotNotes(id, []);

        expect(notes()).toEqual([]);
        expect(owned().pitches).toBeTrue();
      });

      it('does nothing for an id the document does not hold', () => {
        expectNoCommit(() => service.setSlotNotes('no-such-slot', DRAWN));
      });

      it('records nothing when neither the notes nor the claim would change', () => {
        service.setSlotNotes(id, DRAWN);
        expectNoCommit(() => service.setSlotNotes(id, DRAWN));
      });

      /**
       * The claim is a change even when the notes are not. A user who redraws a
       * note exactly where it already was has still said the slot is theirs,
       * and a comparison that looked only at the numbers would drop that.
       */
      it('records the claim even when the notes are what was already there', () => {
        const generated = notes().map(note => ({ ...note }));
        service.setSlotNotes(id, generated);

        expect(owned().pitches).toBeTrue();
        expect(notes()).toEqual(generated);
      });

      /**
       * A shorter list is a change even when it agrees with the longer one all
       * the way along it. Deleting the last note of a slot that already claims
       * its pitches is exactly that shape, and a comparison that walked only
       * the new list would call the two lists equal and drop the deletion.
       */
      it('records a note deleted off the end of a slot already claimed', () => {
        service.setSlotNotes(id, DRAWN);
        service.setSlotNotes(id, [DRAWN[0]]);

        expect(notes()).toEqual([DRAWN[0]]);
      });

      it('shares nothing with the array it was handed', () => {
        const handed = DRAWN.map(note => ({ ...note }));
        service.setSlotNotes(id, handed);
        handed[0].midi = 1;

        expect(notes()[0].midi).toBe(62);
      });

      it('leaves the slot`s harmony and length alone', () => {
        const before = slots()[0].harmony;
        service.setSlotNotes(id, DRAWN);

        expect(slots()[0].harmony).toEqual(before);
        expect(slots()[0].lengthBeats).toBe(4);
      });

      it('folds a drag into one undo step', () => {
        service.setSlotNotes(id, DRAWN, { coalesce: false });
        service.setSlotNotes(id, [{ ...DRAWN[0], midi: 63 }, DRAWN[1]], { coalesce: true });
        service.setSlotNotes(id, [{ ...DRAWN[0], midi: 64 }, DRAWN[1]], { coalesce: true });

        expect(notes()[0].midi).toBe(64);
        expect(undoDepth()).toBe(2);
      });

      it('is one step per call without one', () => {
        service.setSlotNotes(id, DRAWN);
        service.setSlotNotes(id, [{ ...DRAWN[0], midi: 63 }, DRAWN[1]]);

        expect(undoDepth()).toBe(3);
      });
    });

    /**
     * The setter for a gesture that puts a note *somewhere*: double-click to
     * add, and a drag that moves a note in pitch and time at once.
     *
     * It exists because the pair it replaces could not be made to work.
     * `setSlotNotes` followed by `setNoteTiming` opens two runs with two
     * different keys - `notes:<id>` and `timing:<id>:<index>` - and `commit`
     * folds only where the keys match, so the two were always two undo steps
     * however they were coalesced. Undo landed between them, on a note present
     * but snapped back to beat 0 with its pitches owned and its timing not,
     * which is a state no gesture ever produced and no user ever saw.
     *
     * One commit is the answer rather than a shared run key, because a run key
     * would have made the pair *undo* as one step while still publishing that
     * state to everything watching in between.
     */
    describe('placeNotes', () => {
      const PLACED: readonly RollNote[] = [
        { midi: 62, startBeat: 0.5, lengthBeats: 1, velocity: 90 },
        { midi: 69, startBeat: 2, lengthBeats: 2, velocity: 50 }
      ];

      it('replaces the notes and claims the pitches and the timing', () => {
        service.placeNotes(id, PLACED);

        expect(notes()).toEqual([...PLACED]);
        expect(owned()).toEqual({ pitches: true, timing: true, velocity: false });
      });

      /**
       * Which is the whole point: the note stays where it was put. The same
       * gesture through `setSlotNotes` came back blocked to beat 0 at the next
       * regeneration, because nothing in it had said the rhythm was the user's.
       */
      it('keeps a placed note where it was placed, across a key change', () => {
        service.placeNotes(id, PLACED);
        service.setKey(9, 'aeolian');

        expect(notes().map(note => note.startBeat)).toEqual([0.5, 2]);
        expect(notes().map(note => note.lengthBeats)).toEqual([1, 2]);
        expect(notes().map(note => note.midi)).toEqual([71, 78]);
        // Velocity is the dimension it does *not* claim, so it still resets.
        expect(notes().map(note => note.velocity)).toEqual([80, 80]);
      });

      /** One gesture, one commit, one step back - and no state in between. */
      it('is a single undo step for the whole placement', () => {
        service.placeNotes(id, PLACED);

        service.undo();

        expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
        expect(owned()).toEqual({ pitches: false, timing: false, velocity: false });
      });

      it('does nothing for an id the document does not hold', () => {
        expectNoCommit(() => service.placeNotes('no-such-slot', PLACED));
      });

      it('records nothing when neither the notes nor the claims would change', () => {
        service.placeNotes(id, PLACED);
        expectNoCommit(() => service.placeNotes(id, PLACED));
      });

      /**
       * The first touch is a claim whether or not a number moves, and here it
       * is two claims: placing the notes exactly where the generator already
       * had them still says the rhythm is the user's.
       */
      it('records the claims even when the notes are what was already there', () => {
        const generated = notes().map(note => ({ ...note }));
        service.placeNotes(id, generated);

        expect(owned()).toEqual({ pitches: true, timing: true, velocity: false });
      });

      it('bounds a note dragged before the start of its slot', () => {
        service.placeNotes(id, [{ midi: 62, startBeat: -2, lengthBeats: 0, velocity: 500 }]);

        expect(notes()).toEqual([
          { midi: 62, startBeat: 0, lengthBeats: MIN_NOTE_BEATS, velocity: 127 }
        ]);
      });

      it('folds a drag into one undo step', () => {
        service.placeNotes(id, PLACED, { coalesce: false });
        service.placeNotes(id, [{ ...PLACED[0], startBeat: 1 }, PLACED[1]], { coalesce: true });
        service.placeNotes(id, [{ ...PLACED[0], startBeat: 1.5 }, PLACED[1]], { coalesce: true });

        expect(notes()[0].startBeat).toBe(1.5);
        expect(undoDepth()).toBe(2);
      });

      /**
       * And its run is its own. A place is a different gesture from a pitch
       * drag even on the same slot, so one cannot fold into the other's entry -
       * the same rule that keeps a resize and a velocity drag apart.
       */
      it('does not fold into a pitch drag on the same slot', () => {
        service.setSlotNotes(id, PLACED, { coalesce: false });
        service.placeNotes(id, [{ ...PLACED[0], startBeat: 1 }, PLACED[1]], { coalesce: true });

        expect(undoDepth()).toBe(3);
      });
    });

    describe('setNoteTiming', () => {
      it('moves one note and claims the timing', () => {
        service.setNoteTiming(id, 1, 1.5, 0.5);

        expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 0]);
        expect(notes().map(note => note.lengthBeats)).toEqual([4, 0.5, 4]);
        expect(owned()).toEqual({ pitches: false, timing: true, velocity: false });
      });

      it('leaves the pitch and the velocity of the note it moves', () => {
        const before = notes()[1];
        service.setNoteTiming(id, 1, 1.5, 0.5);

        expect(notes()[1].midi).toBe(before.midi);
        expect(notes()[1].velocity).toBe(before.velocity);
      });

      /**
       * Pitch-set edits can change a slot's identity and timing edits never do,
       * which is the M1 rule M3's recogniser depends on. A move must not reach
       * the harmony at all.
       */
      it('leaves the harmony alone', () => {
        const before = slots()[0].harmony;
        service.setNoteTiming(id, 0, 1, 1);

        expect(slots()[0].harmony).toEqual(before);
      });

      it('does nothing for a note the slot does not hold', () => {
        expectNoCommit(() => service.setNoteTiming(id, 3, 1, 1));
        expectNoCommit(() => service.setNoteTiming(id, -1, 1, 1));
        expectNoCommit(() => service.setNoteTiming(id, 0.5, 1, 1));
        expectNoCommit(() => service.setNoteTiming('no-such-slot', 0, 1, 1));
      });

      it('records nothing when the note is already where it is going', () => {
        service.setNoteTiming(id, 0, 1, 1);
        expectNoCommit(() => service.setNoteTiming(id, 0, 1, 1));
      });

      /**
       * But the first touch is a claim whether or not the note moves - the twin
       * of the velocity spec below. Dropping a note back exactly where it was
       * still says the rhythm of that slot is the user's, and a comparison that
       * looked only at the numbers would throw the claim away.
       */
      it('claims the timing even when the note does not move', () => {
        const before = notes()[0];
        service.setNoteTiming(id, 0, before.startBeat, before.lengthBeats);

        expect(owned().timing).toBeTrue();
        expect(notes()[0]).toEqual(before);
      });

      it('folds a drag into one undo step', () => {
        service.setNoteTiming(id, 0, 1, 1, { coalesce: false });
        service.setNoteTiming(id, 0, 1.5, 1, { coalesce: true });
        service.setNoteTiming(id, 0, 2, 1, { coalesce: true });

        expect(notes()[0].startBeat).toBe(2);
        expect(undoDepth()).toBe(2);
      });

      /**
       * Two notes are two drags, the way two slots are two resizes. A run keyed
       * by the slot alone would let a continuation meant for one note fold into
       * the entry the previous note's drag opened.
       */
      it('does not fold a drag on one note into the drag on another', () => {
        service.setNoteTiming(id, 0, 1, 1, { coalesce: false });
        service.setNoteTiming(id, 1, 2, 1, { coalesce: true });

        expect(undoDepth()).toBe(3);
      });
    });

    describe('setNoteVelocity', () => {
      it('sets one velocity and claims the velocities', () => {
        service.setNoteVelocity(id, 2, 110);

        expect(notes().map(note => note.velocity)).toEqual([80, 80, 110]);
        expect(owned()).toEqual({ pitches: false, timing: false, velocity: true });
      });

      it('leaves the pitch and the timing of the note it changes', () => {
        const before = notes()[2];
        service.setNoteVelocity(id, 2, 110);

        expect(notes()[2].midi).toBe(before.midi);
        expect(notes()[2].startBeat).toBe(before.startBeat);
        expect(notes()[2].lengthBeats).toBe(before.lengthBeats);
      });

      it('does nothing for a note the slot does not hold', () => {
        expectNoCommit(() => service.setNoteVelocity(id, 3, 100));
        expectNoCommit(() => service.setNoteVelocity(id, -1, 100));
        expectNoCommit(() => service.setNoteVelocity('no-such-slot', 0, 100));
      });

      it('records nothing when the velocity is already what it is being set to', () => {
        service.setNoteVelocity(id, 0, 100);
        expectNoCommit(() => service.setNoteVelocity(id, 0, 100));
      });

      /**
       * The first touch is a claim whether or not the number moves. A user who
       * drags the velocity of a generated note and lets go on 80 has still said
       * that note's dynamics are theirs.
       */
      it('claims the velocities even when the number does not move', () => {
        service.setNoteVelocity(id, 0, DEFAULT_VELOCITY);

        expect(owned().velocity).toBeTrue();
        expect(notes()[0].velocity).toBe(DEFAULT_VELOCITY);
      });

      it('folds a drag into one undo step', () => {
        service.setNoteVelocity(id, 0, 100, { coalesce: false });
        service.setNoteVelocity(id, 0, 101, { coalesce: true });
        service.setNoteVelocity(id, 0, 102, { coalesce: true });

        expect(notes()[0].velocity).toBe(102);
        expect(undoDepth()).toBe(2);
      });

      it('does not fold a drag on one note into the drag on another', () => {
        service.setNoteVelocity(id, 0, 100, { coalesce: false });
        service.setNoteVelocity(id, 1, 100, { coalesce: true });

        expect(undoDepth()).toBe(3);
      });
    });

    /**
     * A run is named for the gesture that opened it, so a continuation can only
     * fold into a run of its own kind on its own note. The strip's resize is in
     * the list because it shares the mechanism and the slot: a note drag that
     * folded into the resize before it would undo the two together.
     */
    it('keeps a run of one kind out of the run of another', () => {
      service.setSlotLength(id, 5, { coalesce: false });
      service.setSlotNotes(id, [{ midi: 62, startBeat: 0.5, lengthBeats: 1, velocity: 90 }], {
        coalesce: true
      });
      service.placeNotes(id, [{ midi: 62, startBeat: 1, lengthBeats: 1, velocity: 90 }], {
        coalesce: true
      });
      service.setNoteTiming(id, 0, 1.5, 1, { coalesce: true });
      service.setNoteVelocity(id, 0, 100, { coalesce: true });

      // The append that made the slot, then one step for each of the five.
      expect(undoDepth()).toBe(6);
    });

    /**
     * What a drawn note is bounded to, and why each end is where it is.
     *
     * `normalizeRollNote` checks the *kind* of every number on a note and
     * bounds none of them, deliberately: it says in as many words that the ends
     * a gesture should rest on belong to "the setters that produce them", which
     * is these. The rule they apply is the model's second clause - a continuous
     * control past its limit clamps, because a throw the moment a drag crosses
     * an edge aborts the gesture rather than stopping it.
     */
    describe('the bounds a drawn note is held to', () => {
      it('stops a note dragged before the start of its slot at the start', () => {
        service.setNoteTiming(id, 0, -2, 1);

        expect(notes()[0].startBeat).toBe(0);
      });

      /**
       * And there is no ceiling on the other end, which is the same decision
       * `retimeNotes` makes: a note may sit past the end of the slot holding
       * it. The two have to agree, or a shrink that legitimately left a note
       * hanging would drag it back inside the moment anything else about it
       * moved.
       */
      it('lets a note sit past the end of its slot', () => {
        service.setNoteTiming(id, 0, 6, 1);

        expect(slots()[0].lengthBeats).toBe(4);
        expect(notes()[0].startBeat).toBe(6);
      });

      /**
       * The floor on a length is the shortest note the app can **notate**: a
       * sixty-fourth in 4/4, which is one sixteenth of a beat and the finest
       * `quantizeBar` accepts. Below it Task 11's preview would have no symbol
       * to draw. It has to be strictly positive whatever its value, because
       * `buildSchedule` hands the number to Tone as a duration.
       */
      it('stops a note resized past nothing at the shortest notatable one', () => {
        // Pinned as a number and not only as a symbol: every assertion below
        // compares against the constant, so a constant that moved would carry
        // them all with it and prove only that the setter reads the same one.
        expect(MIN_NOTE_BEATS).toBe(1 / 16);
        expect(MIN_NOTE_BEATS).toBeGreaterThan(0);

        service.setNoteTiming(id, 0, 0, -3);
        expect(notes()[0].lengthBeats).toBe(MIN_NOTE_BEATS);

        service.setNoteTiming(id, 1, 0, 0);
        expect(notes()[1].lengthBeats).toBe(MIN_NOTE_BEATS);
      });

      it('holds a drawn note to the same bounds', () => {
        service.setSlotNotes(id, [
          { midi: 60, startBeat: -1, lengthBeats: 0, velocity: 400 }
        ]);

        expect(notes()).toEqual([
          { midi: 60, startBeat: 0, lengthBeats: MIN_NOTE_BEATS, velocity: VELOCITY_MAX }
        ]);
      });

      /**
       * Velocity's floor is 1 and not 0, because a MIDI note-on at velocity 0
       * is a note *off*: it names silence rather than the quietest sound, and a
       * drag that bottomed out there would delete the note in all but name.
       */
      it('clamps a velocity to the MIDI range', () => {
        service.setNoteVelocity(id, 0, 500);
        expect(notes()[0].velocity).toBe(VELOCITY_MAX);

        service.setNoteVelocity(id, 0, -20);
        expect(notes()[0].velocity).toBe(VELOCITY_MIN);

        // Pinned as numbers for the reason above. 127 is the byte's own top and
        // 1 is the quietest sound, 0 being a note-off rather than a level.
        expect(VELOCITY_MIN).toBe(1);
        expect(VELOCITY_MAX).toBe(127);
      });

      /**
       * A velocity drag produces pixels and `RollNote.velocity` is documented
       * as a MIDI byte, so a fraction is rounded rather than stored.
       * `normalizeRollNote` requires `midi` to be whole and asks nothing of
       * velocity, so this is the one field a setter has to make whole itself.
       */
      it('rounds a velocity dragged between two bytes', () => {
        service.setNoteVelocity(id, 0, 90.6);
        expect(notes()[0].velocity).toBe(91);

        service.setNoteVelocity(id, 1, 90.4);
        expect(notes()[1].velocity).toBe(90);
      });

      /**
       * `midi` is deliberately left unbounded, and that is a recorded decision
       * rather than an omission. `regenerateSlot` adds an unbounded
       * `transposeBy` to it afterwards, so a bound here would be half a guard -
       * `normalizeRollNote` makes exactly that argument for not bounding it
       * either. `OCTAVE_MAX` is the bound that holds, and it holds by bounding
       * the generator's input; where a pitch drag stops on screen is the roll's
       * geometry to decide.
       *
       * Velocity is clamped and pitch is not, and the asymmetry has a reason:
       * `gainOf` already clamps velocity into 0-1 on the way to Tone, so an
       * unclamped 500 on a note would be a document claiming something the
       * synth does not do. A pitch out of range has no such downstream clamp -
       * what is stored is what is heard - so storing it is honest.
       */
      it('does not bound the pitch', () => {
        service.setSlotNotes(id, [
          { midi: 200, startBeat: 0, lengthBeats: 1, velocity: 80 }
        ]);

        expect(notes()[0].midi).toBe(200);
      });

      /**
       * A value of the wrong kind is not a control at its limit, so it is not
       * clamped into range: it goes on to the funnel and throws there, and the
       * commit that would have stored it publishes nothing. Clamping it would
       * be worse than useless - `Math.max(1, NaN)` is `NaN`, so a clamp written
       * without this in mind swallows exactly the value the guard exists for.
       */
      it('refuses a value that is not a number rather than clamping it', () => {
        const before = currentState();

        expect(() => service.setNoteVelocity(id, 0, Number.NaN)).toThrowError(/velocity/i);
        expect(() => service.setNoteVelocity(id, 0, Number.POSITIVE_INFINITY))
          .toThrowError(/velocity/i);
        expect(() => service.setNoteTiming(id, 0, Number.POSITIVE_INFINITY, 1))
          .toThrowError(/startBeat/i);
        expect(() => service.setNoteTiming(id, 0, Number.NEGATIVE_INFINITY, 1))
          .toThrowError(/startBeat/i);
        expect(() => service.setNoteTiming(id, 0, 0, Number.NaN))
          .toThrowError(/lengthBeats/i);

        expect(currentState().doc).toBe(before.doc);
        expect(currentState().canUndo).toBe(before.canUndo);
      });
    });

    /**
     * The escape hatch, and it is not optional. Per-aspect ownership is only
     * safe if there is a way back: without this, a user who drags one note has
     * opted that slot out of re-voicing for good, with no route back but undo -
     * and undo is gone the moment they do anything else.
     */
    describe('resetSlotToChord', () => {
      /** Claims all three dimensions, through the three setters that do. */
      function drawnOver(): void {
        service.setSlotNotes(id, [{ midi: 55, startBeat: 2, lengthBeats: 1, velocity: 20 }]);
        service.setNoteTiming(id, 0, 3, 0.5);
        service.setNoteVelocity(id, 0, 120);
      }

      it('gives the slot the chord back, and every claim with it', () => {
        drawnOver();
        expect(owned()).toEqual({ pitches: true, timing: true, velocity: true });

        service.resetSlotToChord(id);

        expect(notes()).toEqual([
          { midi: 60, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
          { midi: 64, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
          { midi: 67, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }
        ]);
        expect(owned()).toEqual(createOwnership());
      });

      /** It restates the chord, not the timeline: the slot keeps its length. */
      it('gives the block chord the slot`s own length', () => {
        service.setSlotLength(id, 2);
        drawnOver();
        service.resetSlotToChord(id);

        expect(slots()[0].lengthBeats).toBe(2);
        expect(notes().every(note => note.lengthBeats === 2)).toBeTrue();
      });

      it('is undoable, claims and all', () => {
        drawnOver();
        const before = notes();
        const claims = owned();

        service.resetSlotToChord(id);
        service.undo();

        expect(notes()).toEqual(before);
        expect(owned()).toEqual(claims);
      });

      it('records nothing when there is nothing to take back', () => {
        expectNoCommit(() => service.resetSlotToChord(id));
      });

      it('does nothing for an id the document does not hold', () => {
        expectNoCommit(() => service.resetSlotToChord('no-such-slot'));
      });

      /**
       * There is no chord to reset to in a key that cannot build one, and none
       * on a literal slot either. Clearing the claims without regenerating
       * would be the worst of both outcomes: the hand edits would stay, now
       * unclaimed, and the next key change would quietly throw them away.
       */
      it('refuses in a key that cannot build chords', () => {
        drawnOver();
        service.setKey(0, 'majorPentatonic');

        expectNoCommit(() => service.resetSlotToChord(id));
        expect(owned().pitches).toBeTrue();
      });

      it('refuses on a literal slot', () => {
        drawnOver();
        const doc = currentState().doc;
        service.replaceDocument({
          ...doc,
          slots: [{ ...doc.slots[0], harmony: { kind: 'literal', reason: 'user-detached' } }]
        });

        expectNoCommit(() => service.resetSlotToChord(id));
        expect(owned().pitches).toBeTrue();
      });

      /** And the slot re-voices with the key again, which is the whole point. */
      it('puts the slot back under the generator', () => {
        drawnOver();
        service.resetSlotToChord(id);
        service.setKey(9, 'aeolian');

        expect(notes().map(note => note.midi)).toEqual([69, 72, 76]);
      });
    });
  });

  describe('setTempo', () => {
    it('sets the tempo', () => {
      service.setTempo(96);
      expect(currentState().doc.tempo).toBe(96);
    });

    it('clamps outside the playable range', () => {
      service.setTempo(1000);
      expect(currentState().doc.tempo).toBe(300);
      service.setTempo(0);
      expect(currentState().doc.tempo).toBe(20);
    });

    it('leaves the slots alone', () => {
      service.appendSlot(0);
      const notes = slots()[0].notes;
      service.setTempo(96);
      expect(slots()[0].notes).toEqual(notes);
    });
  });

  describe('undo and redo', () => {
    it('restores the previous document on undo', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      expect(slots().length).toBe(2);

      service.undo();

      expect(slots().length).toBe(1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67]);
      expect(currentState().canRedo).toBeTrue();
    });

    it('puts the undone document back on redo', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      service.undo();
      service.redo();
      expect(slots().length).toBe(2);
      expect(currentState().canRedo).toBeFalse();
    });

    it('drops the redo stack once something new is done', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      service.undo();
      service.appendSlot(3);
      expect(currentState().canRedo).toBeFalse();
    });

    it('does nothing with an empty history', () => {
      expectNoCommit(() => service.undo());
      expectNoCommit(() => service.redo());
      expect(currentState().canUndo).toBeFalse();
    });

    // The cap is what stops a session's history growing without bound, and a
    // stepper held down is how a user reaches it.
    it('caps the undo stack at 100 entries', () => {
      for (let index = 0; index < 105; index++) {
        service.appendSlot(index % 7);
      }
      expect(slots().length).toBe(105);

      for (let index = 0; index < 105; index++) {
        service.undo();
      }

      // Only the last 100 states were kept, so undo runs out five chords in
      // rather than back at the empty document.
      expect(slots().length).toBe(5);
      expect(currentState().canUndo).toBeFalse();
    });

    it('drops a selection the undone document does not have', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      expect(currentState().selectedSlotId).toBe(slots()[1].id);
      service.undo();
      expect(currentState().selectedSlotId).toBeNull();
    });
  });

  /**
   * A value that cannot be normalised throws, and the class docstring promises
   * that a throw leaves the published state untouched rather than half-edited.
   *
   * The document was always safe - the mutation runs on a clone - but the
   * history was not, and the history is state too. An undo entry pushed before
   * the normalisation ran survives the throw, the redo stack it cleared does
   * not come back, and `canRedo` is left reading true from the publish that
   * never happened: an enabled redo button that does nothing, and a redo
   * history lost to a mistyped tempo.
   *
   * The transport's tempo box is the live road here. An emptied `<input
   * type="number">` reads as `null` through `ngModel` and as `NaN` through
   * `valueAsNumber`, and `Number.isFinite` refuses both.
   */
  describe('a value that cannot be normalised', () => {
    /** Undo one step, so both stacks hold something there is to lose. */
    function historyWithBothStacks(): void {
      service.appendSlot(0);
      service.appendSlot(4);
      service.undo();
      expect(currentState().canUndo).toBeTrue();
      expect(currentState().canRedo).toBeTrue();
    }

    function expectThrowsAndPublishesNothing(act: () => void): void {
      const before = currentState();
      expect(act).toThrow();
      const after = currentState();
      expect(after.doc).toBe(before.doc);
      expect(after.canUndo).toBe(before.canUndo);
      expect(after.canRedo).toBe(before.canRedo);
      expect(after.isDirty).toBe(before.isDirty);
    }

    /**
     * What the flags cannot show. `canRedo` reads true whether the redo stack
     * holds the undone chord or was emptied by a phantom push, so the stacks
     * are read the only way they can be: by walking them. Redo puts the second
     * chord back, and two undos reach the empty document with nothing over.
     */
    function expectHistoryStillWalks(): void {
      service.redo();
      expect(slots().length).toBe(2);

      service.undo();
      service.undo();
      expect(slots()).toEqual([]);
      expect(currentState().canUndo).toBeFalse();
    }

    it('leaves both stacks alone when the tempo is not a number', () => {
      historyWithBothStacks();
      expectThrowsAndPublishesNothing(() => service.setTempo(Number.NaN));
      expectHistoryStillWalks();
    });

    it('leaves both stacks alone when a replacement document is unusable', () => {
      historyWithBothStacks();
      const doc = currentState().doc;
      expectThrowsAndPublishesNothing(() =>
        service.replaceDocument({ ...doc, tempo: Number.NaN })
      );
      expectHistoryStillWalks();
    });

    it('leaves both stacks alone when the tonic is not a pitch class', () => {
      historyWithBothStacks();
      expectThrowsAndPublishesNothing(() => service.setKey(0.5, 'ionian'));
      expectHistoryStillWalks();
    });
  });

  describe('replaceDocument', () => {
    /**
     * The one place the order inside `settle()` is observable: a length that
     * arrives out of bounds. Re-flowing before the clamp would sum the length
     * the caller sent rather than the one the document ends up with, and every
     * slot after it would start in the wrong place.
     */
    it('clamps a length before summing the positions from it', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      const doc = currentState().doc;

      service.replaceDocument({
        ...doc,
        slots: [{ ...doc.slots[0], lengthBeats: 0 }, doc.slots[1]]
      });

      expect(slots()[0].lengthBeats).toBe(1);
      expect(slots()[1].startBeat).toBe(1);
      expectContiguous();
    });

    it('is undoable, and clean only when it says so', () => {
      service.appendSlot(0);
      const doc = currentState().doc;

      service.replaceDocument({ ...doc, name: 'Edited' });
      expect(currentState().isDirty).toBeTrue();

      service.replaceDocument({ ...doc, name: 'Loaded' }, true);
      expect(currentState().doc.name).toBe('Loaded');
      expect(currentState().isDirty).toBeFalse();

      service.undo();
      expect(currentState().doc.name).toBe('Edited');
      service.undo();
      expect(currentState().doc.name).toBe('Untitled');
    });

    /**
     * Ids are how every other method finds a slot, and a document that repeats
     * one is not a document this service can edit: `removeSlot` filters by id
     * and would drop both twins, and `replaceSlot` would only ever find the
     * first. It arrives here from a file rather than from a user, so it is a
     * corrupt document rather than a control at its limit - the wrong-kind
     * clause of the normalisation rule, which throws.
     */
    it('refuses a document whose slots share an id', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      const doc = currentState().doc;
      const twin = { ...doc.slots[1], id: doc.slots[0].id };

      expect(() => service.replaceDocument({ ...doc, slots: [doc.slots[0], twin] })).toThrow();
      expect(slots().length).toBe(2);
      expect(currentState().doc).toBe(doc);
    });
  });

  describe('selectSlot', () => {
    it('selects a slot without recording a document change', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      const first = slots()[0].id;
      expectNoCommit(() => service.selectSlot(first));
      expect(currentState().selectedSlotId).toBe(first);
    });

    it('refuses an id the document does not have', () => {
      service.appendSlot(0);
      service.selectSlot('not-a-slot');
      expect(currentState().selectedSlotId).toBeNull();
    });
  });

  /**
   * Stacking thirds through a five-note scale is meaningless, and
   * `degreePitchClasses` throws rather than inventing a chord. The service asks
   * `isHeptatonic` first, so nothing throws out of a setter into a component
   * and no mutation is left half-applied.
   */
  describe('a scale that has no diatonic chords', () => {
    it('reports that it cannot build chords', () => {
      service.setKey(0, 'majorPentatonic');
      expect(currentState().canBuildChords).toBeFalse();
    });

    it('refuses to append a chord rather than throwing', () => {
      service.setKey(0, 'majorPentatonic');
      expectNoCommit(() => service.appendSlot(0));
      expect(slots()).toEqual([]);
    });

    it('refuses to change a chord rather than mislabelling it', () => {
      service.appendSlot(0);
      service.setKey(0, 'majorPentatonic');
      expectNoCommit(() => service.setSlotExtent(slots()[0].id, 7));
      expectNoCommit(() => service.stepSlotExtent(slots()[0].id, 1));
    });

    // The key change itself is not refused: this page would otherwise sit
    // silently disagreeing with the fretboard behind it. The slots keep the
    // notes they had, which is the same promise a literal slot gets.
    it('keeps the key change, and the notes the slots already had', () => {
      service.appendSlot(0);
      const before = slots()[0].notes.map(note => note.midi);
      service.setKey(0, 'majorPentatonic');
      expect(currentState().doc.key.scaleId).toBe('majorPentatonic');
      expect(slots()[0].notes.map(note => note.midi)).toEqual(before);
    });

    it('still lets the timeline be edited', () => {
      service.appendSlot(0);
      service.appendSlot(4);
      service.setKey(0, 'majorPentatonic');
      service.removeSlot(slots()[0].id);
      expect(slots().length).toBe(1);
      expectContiguous();
    });

    /**
     * Resizing is timing rather than harmony, and a block chord's notes are one
     * attack filling the slot - so a length change is the same length written
     * onto notes that are already there, and needs no scale to make it.
     *
     * The slot and its notes must not be allowed to disagree about how long
     * they are, whatever key the document is in. Regenerating from the degree
     * cannot run here, so this is the spec that says re-timing is not
     * regeneration.
     */
    it('still lets a slot be resized, notes and all', () => {
      service.appendSlot(0);
      service.setKey(0, 'majorPentatonic');
      service.setSlotLength(slots()[0].id, 2);

      expect(slots()[0].lengthBeats).toBe(2);
      expect(slots()[0].notes.every(note => note.lengthBeats === 2)).toBeTrue();
    });
  });

  /**
   * A characterisation test, not a wish. `generateSlotNotes` hands a literal
   * slot its own notes back unchanged, so resizing one moves its edge and not
   * its contents - notes hang past a shortened slot, and silence follows a
   * lengthened one. That is what "notes are the truth" costs, and it is written
   * down here so M3 inherits it rather than discovers it.
   */
  describe('a literal slot', () => {
    /** Nothing in M1 makes one of these; M3's recogniser will. */
    function appendLiteral(): string {
      service.appendSlot(0);
      const id = slots()[0].id;
      const doc = currentState().doc;
      const detached: ChordSlot = {
        ...doc.slots[0],
        harmony: { kind: 'literal', reason: 'user-detached' }
      };
      service.replaceDocument({ ...doc, slots: [detached] });
      return id;
    }

    it('keeps its own notes when it is resized', () => {
      const id = appendLiteral();
      service.setSlotLength(id, 1);
      expect(slots()[0].lengthBeats).toBe(1);
      // Still four beats long: the notes were not regenerated, so they hang a
      // full three beats past the end of the slot that holds them.
      expect(slots()[0].notes.every(note => note.lengthBeats === 4)).toBeTrue();
    });

    it('has no degree for the complexity control to move', () => {
      const id = appendLiteral();
      expectNoCommit(() => service.setSlotExtent(id, 7));
      expectNoCommit(() => service.stepSlotExtent(id, 1));
    });

    /**
     * A literal slot's notes are the playback truth, so regeneration hands them
     * straight back rather than merging anything into them - which matters more
     * now than it did, because the merge resets an unowned velocity to the
     * default. A slot that owns nothing and holds notes nobody generated is
     * exactly the shape the merge would flatten.
     */
    it('keeps its own notes, velocities and all, through a key change', () => {
      service.appendSlot(0);
      const doc = currentState().doc;
      const detached: ChordSlot = {
        ...doc.slots[0],
        harmony: { kind: 'literal', reason: 'user-detached' },
        notes: [{ midi: 61, startBeat: 2, lengthBeats: 1, velocity: 33 }]
      };
      service.replaceDocument({ ...doc, slots: [detached] });

      service.setKey(9, 'aeolian');

      expect(slots()[0].notes).toEqual([
        { midi: 61, startBeat: 2, lengthBeats: 1, velocity: 33 }
      ]);
    });
  });
});
