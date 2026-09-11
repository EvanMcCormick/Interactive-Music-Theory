import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { createOwnership } from '../models/progression-normalize';
import { ChordSlot, ProgressionState, RollNote } from '../models/progression.model';
import { ChordExtent, ChordShape, effectiveChord } from './progression-harmony';

/**
 * The slot list and the beat line it lays out: what append, remove, move and
 * resize do to the order of the slots and to where each one starts.
 *
 * The seam is the contiguity invariant. `slots[i].startBeat` is the sum of every
 * earlier `lengthBeats`, and the four commands here are exactly the ones that
 * can break it - so `expectContiguous` is checked after each of them, and the
 * describe that states the invariant on its own belongs among them rather than
 * among the commands that cannot reach it. A command that changes what a slot
 * *is* leaves every `startBeat` where it found it, which is why none of the
 * other files needs the helper.
 *
 * `setSlotLength` is more than half of this file, for two reasons that are both
 * about the beat line rather than about the setter. A length change is the one
 * edit that reaches its neighbours, because everything after it re-flows. And a
 * slot that owns its timing is held to a different rule from one that does not,
 * which is the whole of the coalescing section.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3292 lines against the project's 1000-line cap, and this is one
 * of five topic-named files carved out of it. The parent's header lists them
 * all and says what stayed. The precedent for copied local fixtures rather than
 * a shared helper module is `progression.service.tensions.spec.ts`, which sets
 * out the argument at length; the six helpers below are copied on it.
 */
describe('ProgressionService: the slot list and the beat line', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  /**
   * A chord shape with nothing pinned: what an untouched slot on `degree`
   * carries, for the assertions that ask what the key names it.
   */
  function plainShape(degree: number, extent: ChordExtent): ChordShape {
    return {
      degree,
      alter: 0,
      extent,
      quality: null,
      suspension: 'none',
      extensions: { ninth: null, eleventh: null, thirteenth: null }
    };
  }

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
     * complexity step or resize. The label itself did not move: `effectiveChord`
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
      expect(effectiveChord(keyIntervals(), plainShape(1, 3)).base).toBe('minor');
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
   * The wider door: a chord with an accidental and a shape of its own, which is
   * every chord the palette's borrowed and secondary rows offer.
   *
   * `appendSlot` takes a degree, and a degree is every chord a key *has* and no
   * chord it borrows. The three fields that make ♭VII a B flat major triad
   * rather than a B diminished one - the accidental, the shape and the height -
   * have no way in through a single number.
   */
  describe('appendChord', () => {
    /** C major's ♭VII: degree 6 with its root pulled down a semitone. */
    const FLAT_SEVEN = { degree: 6, alter: -1, quality: 'major' as const, extent: 3 as const };

    /**
     * The whole reason this is a setter rather than a document the palette
     * assembles. `replaceDocument` settles - it bounds and re-flows - and never
     * regenerates, so that route stores the new label over the old notes.
     */
    it('sounds the chord it names rather than the key’s own degree', () => {
      service.appendChord(FLAT_SEVEN);

      // B♭ D F, voiced up from middle C. The diatonic degree 6 is B D F -
      // [71, 74, 77] - so the first note is the whole of the difference, and it
      // is the note that makes the chord major rather than diminished.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([70, 74, 77]);
    });

    it('stores the triple it was given', () => {
      service.appendChord(FLAT_SEVEN);
      const harmony = slots()[0].harmony;
      if (harmony.kind !== 'degree') throw new Error('appendChord built no degree');

      expect(harmony.degree.degree).toBe(6);
      expect(harmony.degree.alter).toBe(-1);
      expect(harmony.degree.quality).toBe('major');
      expect(harmony.degree.extent).toBe(3);
    });

    /**
     * A secondary dominant arrives at a seventh, because that is the height its
     * name is true at - and the height is the field `appendSlot` fixes at three.
     */
    it('takes the height the choice names', () => {
      service.appendChord({ degree: 1, alter: 0, quality: 'dominant7', extent: 7 });

      // D F♯ A C.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([62, 66, 69, 72]);
    });

    it('appends and selects on the same terms as a diatonic chord', () => {
      service.appendSlot(0);
      service.appendChord(FLAT_SEVEN);

      expect(slots().length).toBe(2);
      expect(slots().map(slot => slot.startBeat)).toEqual([0, 4]);
      expect(currentState().selectedSlotId).toBe(slots()[1].id);
      expectContiguous();
    });

    it('refuses in a key that can build no chords', () => {
      service.setKey(0, 'majorPentatonic');
      expectNoCommit(() => service.appendChord(FLAT_SEVEN));
    });

    /**
     * The palette hands its own view model over, which carries a numeral, a
     * name and four more fields for the screen. Only the four the service reads
     * may reach the document: a spread would copy the rest into a `ChordDegree`
     * and from there into every undo entry for the life of the document.
     */
    it('stores none of the extra fields a caller’s object carries', () => {
      // A variable rather than a literal at the call, which is both what the
      // palette passes and what gets past the excess-property check - the same
      // hole the guard in `chosen()` covers.
      const decorated = { ...FLAT_SEVEN, numeral: '♭VII', name: 'Bb Maj', current: false };
      service.appendChord(decorated);
      const harmony = slots()[0].harmony;
      if (harmony.kind !== 'degree') throw new Error('appendChord built no degree');

      expect(Object.keys(harmony.degree).sort()).toEqual([
        'alter', 'degree', 'extensions', 'extent', 'inversion', 'octave',
        'quality', 'suspension'
      ]);
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
});
