import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { CHORD_EXTENTS, ChordSlot, ProgressionState } from '../models/progression.model';
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
   * Asserts that `act` published no new document at all.
   *
   * Identity rather than a count of undo entries, because that is the property
   * that matters: a refused or clamped-to-nothing mutation must not push a step
   * onto a stack that only holds a hundred, or holding the + button down at the
   * top of the ladder would quietly throw the user's history away.
   */
  function expectNoCommit(act: () => void): void {
    const before = currentState().doc;
    act();
    expect(currentState().doc).toBe(before);
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

    it('stops at the bottom rather than walking off the ladder', () => {
      const past = CHORD_EXTENTS[-1];
      expectNoCommit(() => service.setSlotExtent(slots()[0].id, past));
      expect(extentOf()).toBe(3);
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
  });

  describe('setSlotInversion', () => {
    beforeEach(() => service.appendSlot(0));

    it('voices the chord from its third', () => {
      service.setSlotInversion(slots()[0].id, 1);
      expect(slots()[0].notes.map(note => note.midi)).toEqual([64, 67, 72]);
    });

    // Cyclic, so it wraps where octave clamps: the inversion above the last is
    // root position again, and it is stored wrapped so it stays nameable.
    it('wraps an inversion past the last one back to root position', () => {
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

    it('clamps past the top of the range and records nothing there', () => {
      service.setSlotOctave(slots()[0].id, 9);
      const harmony = slots()[0].harmony;
      expect(harmony.kind === 'degree' && harmony.degree.octave).toBe(2);
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

    it('takes the spelling preference the scale declares', () => {
      service.setKey(9, 'aeolian');
      expect(currentState().doc.key.preferSharps).toBeFalse();
    });

    it('wraps a tonic past the end of the chromatic scale', () => {
      service.setKey(13, 'ionian');
      expect(currentState().doc.key.tonic).toBe(1);
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

      service.replaceDocument({ ...doc, name: 'Loaded' }, true);
      expect(currentState().doc.name).toBe('Loaded');
      expect(currentState().isDirty).toBeFalse();

      service.undo();
      expect(currentState().doc.name).toBe('Untitled');
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
    });
  });
});
