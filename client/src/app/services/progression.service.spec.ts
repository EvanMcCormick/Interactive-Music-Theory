import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { CHORD_EXTENTS, OCTAVE_MAX } from '../models/progression-normalize';
import { ChordSlot, ProgressionState } from '../models/progression.model';
import { ChordExtent } from './progression-harmony';

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

    it('labels the slot with the quality its scale gives the degree', () => {
      service.appendSlot(1);
      const harmony = slots()[0].harmony;
      expect(harmony.kind).toBe('degree');
      if (harmony.kind !== 'degree') return;
      expect(harmony.degree.quality).toBe('minor');
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

    it('stacks another third and relabels the chord', () => {
      service.setSlotExtent(slots()[0].id, 7);
      expect(extentOf()).toBe(7);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([60, 64, 67, 71]);
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.quality).toBe('major7');
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

    it('relabels each slot with its quality in the new key', () => {
      service.appendSlot(0);
      service.setKey(9, 'aeolian');
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.quality).toBe('minor');
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
  });
});
