import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { DEFAULT_VELOCITY, createOwnership } from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState,
  RollNote,
  SlotOwnership
} from '../models/progression.model';

/**
 * Reset to chord: everything a slot gives back.
 *
 * The escape hatch, and it is not optional. Per-aspect ownership is only safe if
 * there is a way back: without this, a user who drags one note has opted that
 * slot out of re-voicing for good, with no route back but undo - and undo is
 * gone the moment they do anything else. The same argument covers the three
 * claims the ownership record holds and the three it does not - the pinned
 * shape, the suspension, and each pinned extension - which is why one button
 * drops all six and why each of them has a spec here.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3292 lines against the project's 1000-line cap, and this is one
 * of five topic-named files carved out of it. The parent's header lists them
 * all and says what stayed.
 *
 * This block was nested inside `the setters the roll writes through`, and it
 * moved out rather than with it because the two ask opposite questions - what
 * making a claim does, against what dropping every claim does - and because the
 * roll's own specs would otherwise have arrived at the cap on the day they were
 * split out. The fixture it shared with them is copied, not extracted, on the
 * precedent `progression.service.tensions.spec.ts` sets out.
 *
 * `progression.service.literal.spec.ts` is the other half of this command: what
 * it does to a slot that has lost its numeral, where there is no degree to
 * rebuild from and `SlotHarmony.from` is the way back instead. Everything below
 * is the degree half.
 */
describe('ProgressionService: reset to chord', () => {
  let service: ProgressionService;
  let id: string;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
    service.appendSlot(0);
    id = slots()[0].id;
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

  function notes(): RollNote[] {
    return slots()[0].notes;
  }

  function owned(): SlotOwnership {
    return slots()[0].owned;
  }

  /** The slot's degree, for the specs that read its shape override back. */
  function degree(): ChordDegree {
    const harmony = slots()[0].harmony;
    if (harmony.kind !== 'degree') throw new Error('the slot lost its degree');
    return harmony.degree;
  }

  /** What the slot sounds, as pitch classes: the half a label cannot show. */
  function pitchClasses(): number[] {
    const classes = notes().map(note => ((note.midi % 12) + 12) % 12);
    return [...new Set(classes)].sort((first, second) => first - second);
  }

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
        slots: [
          { ...doc.slots[0], harmony: { kind: 'literal', reason: 'user-detached', from: null } }
        ]
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

    /**
     * The fourth claim, which is not on the ownership record.
     *
     * `ChordDegree.quality` is durable user intent exactly as `owned` is -
     * `regenerateSlot` carries it through every regeneration untouched - so a
     * slot the palette's alternates row has pinned is a slot opted out of
     * re-voicing in the one dimension the three booleans do not cover. Before
     * this, `createDegreeSlot` was the only producer of `quality: null` in
     * the app, which made a pin a one-way door.
     */
    describe('the shape override', () => {
      /** The whole failure, in the shape the plan's own hand-check states. */
      it('lets the slot follow the key again after a shape was pinned', () => {
        service.setSlotChord(id, { degree: 0, alter: 0, quality: 'major', extent: 3 });
        service.setKey(0, 'aeolian');
        // Pinned: C major in a key whose tonic triad is C minor.
        expect(notes().map(note => note.midi)).toEqual([60, 64, 67]);

        service.setKey(0, 'ionian');
        service.resetSlotToChord(id);
        service.setKey(0, 'aeolian');

        expect(degree().quality).toBeNull();
        expect(notes().map(note => note.midi)).toEqual([60, 63, 67]);
      });

      /**
       * The pin that costs no note is the one a comparison over notes alone
       * would miss - and it is the commonest of all, being what clicking the
       * marked button on the alternates row does.
       */
      it('records the reset even when the shape it drops sounds the same', () => {
        service.setSlotChord(id, { degree: 0, alter: 0, quality: 'major', extent: 3 });
        const before = notes().map(note => note.midi);

        service.resetSlotToChord(id);

        expect(degree().quality).toBeNull();
        expect(notes().map(note => note.midi)).toEqual(before);
        expect(currentState().canUndo).toBeTrue();
      });

      /**
       * A displaced root has no diatonic stack to fall back on, so its shape
       * is not an override on top of something else - it is the only answer
       * there is, and `normalizeChordDegree` refuses the pair outright. A
       * borrowed chord therefore stays borrowed through the reset.
       */
      it('leaves a borrowed chord its shape', () => {
        service.setSlotChord(id, { degree: 6, alter: -1, quality: 'major', extent: 3 });
        drawnOver();

        service.resetSlotToChord(id);

        expect([degree().degree, degree().alter]).toEqual([6, -1]);
        expect(degree().quality).toBe('major');
        // B flat D F, rather than the diatonic B D F of degree 6.
        expect(pitchClasses()).toEqual([2, 5, 10]);
      });

      it('still records nothing on a slot that was never pinned', () => {
        expect(degree().quality).toBeNull();
        expectNoCommit(() => service.resetSlotToChord(id));
      });
    });

    /**
     * The two fields M3 adds, dropped on the same argument the shape is.
     *
     * A suspension and a pinned extension are user intent in exactly the
     * sense `ChordDegree.quality` is: `regenerateSlot` carries all three
     * through every regeneration untouched, so each is a dimension the
     * ownership record does not cover and each is a one-way door without a
     * way back. Reset to chord hands the *whole* slot back, so a button that
     * dropped the shape and left a ♭9 pinned would be the one path out of a
     * hand-made chord that does not quite lead out.
     *
     * Neither has a pairing that makes dropping it illegal - there is no
     * suspension a displaced root needs to stay buildable - so unlike the
     * shape they are dropped unconditionally.
     *
     * Nothing in the UI writes either yet; Task 6 adds the controls, and
     * `replaceDocument` is the door until then, on the licence that spec's
     * own note records.
     */
    describe('the suspension and the pinned extensions', () => {
      /** Installs a G7♭9sus4 on the slot, through the only door there is. */
      function pinned(): void {
        const doc = service.doc;
        const slot = doc.slots[0];
        if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
        service.replaceDocument({
          ...doc,
          slots: [{
            ...slot,
            harmony: {
              kind: 'degree',
              degree: {
                ...slot.harmony.degree,
                degree: 4,
                extent: 9,
                suspension: 'sus4',
                extensions: { ninth: -1, eleventh: null, thirteenth: null }
              }
            }
          }]
        });
        // `replaceDocument` settles rather than regenerating, so the pins
        // reach the notes on the first regeneration after it.
        service.setKey(0, 'ionian');
      }

      it('drops both, and puts the notes back under the generator', () => {
        pinned();
        // G C D F Ab: the suspended fourth in place of the third, and the
        // flattened ninth in place of the key's own A.
        expect(notes().map(note => note.midi)).toEqual([67, 72, 74, 77, 80]);

        service.resetSlotToChord(id);

        expect(degree().suspension).toBe('none');
        expect(degree().extensions).toEqual({
          ninth: null,
          eleventh: null,
          thirteenth: null
        });
        // A plain V9 in C major again.
        expect(notes().map(note => note.midi)).toEqual([67, 71, 74, 77, 81]);
      });

      /**
       * An extension pinned on its own, which is what pins the *comparison*
       * rather than the drop. `sameDegree` collects its answers into a
       * `Record<keyof ChordDegree, boolean>` so a new field is a compile
       * error there, and `extensions` is a record rather than a scalar: two
       * degrees that pin nothing hold two different all-null objects, so
       * comparing it by reference would call every reset a change and
       * comparing it not at all would call this one a no-op.
       */
      it('drops an extension pinned with nothing else', () => {
        const doc = service.doc;
        const slot = doc.slots[0];
        if (slot.harmony.kind !== 'degree') throw new Error('unreachable');
        service.replaceDocument({
          ...doc,
          slots: [{
            ...slot,
            harmony: {
              kind: 'degree',
              degree: {
                ...slot.harmony.degree,
                extent: 9,
                extensions: { ninth: 1, eleventh: null, thirteenth: null }
              }
            }
          }]
        });
        service.setKey(0, 'ionian');
        // I9♯9 in C: the raised ninth, 0 + 14 + 1, in place of the key's D.
        expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71, 75]);

        service.resetSlotToChord(id);

        expect(degree().extensions.ninth).toBeNull();
        expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71, 74]);
      });

      it('still records nothing on a slot that pinned neither', () => {
        expect(degree().suspension).toBe('none');
        expectNoCommit(() => service.resetSlotToChord(id));
      });
    });
  });
});
