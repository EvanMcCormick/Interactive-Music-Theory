import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ChordSlot, ProgressionState } from '../models/progression.model';
import { keyTransposeInterval } from './progression-edit';
import { ChordExtent, ChordShape, effectiveChord } from './progression-harmony';

/**
 * The document itself: the state the service publishes, the two fields that
 * belong to the whole of it rather than to any slot, and the history that takes
 * a change back.
 *
 * Two things are asserted here that no single method owns, because both belong
 * to the commit path rather than to any setter:
 *
 *  - **Bounds are applied.** Every commit runs `normalizeProgressionDoc`, so a
 *    value past its limit is clamped or wrapped wherever it entered - the tempo
 *    and the tonic being the two that reach the audio layer with no slot of
 *    their own to be checked on the way.
 *  - **A refusal records nothing.** `expectNoCommit` below is the shape of it,
 *    and it is the one helper every file in this family needs, because every
 *    command in the service can decline.
 *
 * ## Where the rest of it went
 *
 * This file was 3292 lines against the project's 1000-line cap - the largest in
 * the repo. Four siblings were carved off it during M3 and it still *grew* by
 * 249 lines, because every new service behaviour lands here by default. Five
 * topic-named files now hold what the commands do, each with its own copied
 * fixtures on the precedent `progression.service.tensions.spec.ts` sets out:
 *
 *  - `progression.service.timeline.spec.ts` - the slot list and the beat line:
 *    append, remove, move, resize, and the contiguity invariant they all keep.
 *    `slots[i].startBeat` is the sum of every earlier `lengthBeats`, which this
 *    header used to state, and it moved with the commands that can break it.
 *  - `progression.service.degrees.spec.ts` - the chord commands the strip
 *    writes through, and the two kinds of slot that have no degree to write.
 *  - `progression.service.roll.spec.ts` - the note setters the piano roll writes
 *    through, and the per-aspect claims they record.
 *  - `progression.service.reset.spec.ts` - Reset to chord, which is the way out
 *    of every claim the other two make.
 *  - `progression.service.regenerate.spec.ts` - what survives a regeneration,
 *    which is the question `setKey` below asks of every slot at once.
 *
 * Four more were carved off before this split and are unchanged by it:
 * `.tensions`, `.rekey`, `.literal` and `.relabel`.
 *
 * `setKey` and `keyTransposeInterval` stayed here with `setTempo`, because the
 * key and the tempo are the document's own two fields and because what a key
 * change does to a *slot* is a question two of the files above are entirely
 * about.
 */
describe('ProgressionService', () => {
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
      expect(effectiveChord(keyIntervals(), plainShape(0, 3)).base).toBe('minor');
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
     * and would drop both twins, and `ProgressionStore.commitSlot` would only
     * ever find the first. It arrives here from a file rather than from a user,
     * so it is a corrupt document rather than a control at its limit - the
     * wrong-kind clause of the normalisation rule, which throws.
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
});
