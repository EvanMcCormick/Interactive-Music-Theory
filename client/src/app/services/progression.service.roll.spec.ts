import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import {
  DEFAULT_VELOCITY,
  MIN_NOTE_BEATS,
  VELOCITY_MAX,
  VELOCITY_MIN
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionState,
  RollNote,
  SlotOwnership
} from '../models/progression.model';

/**
 * The setters the piano roll needs, and the first code in the app that writes
 * `SlotOwnership` at all.
 *
 * Each claims **exactly the dimension it changes**, which is the whole point
 * of tracking three rather than one: a velocity nudge must not opt a slot out
 * of re-voicing, and a pitch drag must not make the app believe the user
 * wrote the rhythm. `resetSlotToChord` is the way back from all three, and it
 * is `progression.service.reset.spec.ts`.
 *
 * They all coalesce, because they are all driven by a pointer. That mechanism
 * is `setSlotLength`'s and the argument for it is recorded there - now in
 * `progression.service.timeline.spec.ts`: a drag that commits per
 * pixel-crossed threshold pushes an undo entry per threshold, and
 * `MAX_HISTORY` is 100.
 *
 * Each setter also answers whether it recorded anything, which is load-bearing
 * rather than informational, because the roll passes `coalesce` off that answer
 * and a gesture that believed a refused commit would fold two edits into one
 * undo. And the bounds are here: a note drawn past the end of its slot, above
 * the top of the keyboard, or shorter than the grid allows is held rather than
 * refused, because a drag that stops responding is worse than one that stops
 * moving.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3292 lines against the project's 1000-line cap, and this is one
 * of five topic-named files carved out of it. The parent's header lists them
 * all and says what stayed.
 *
 * `resetSlotToChord` was nested inside this describe and is now
 * `progression.service.reset.spec.ts`. It is the way out of every claim these
 * setters make, which is a different question from what making one does, and
 * keeping the two together would have left this file at the cap on the day it
 * was written. It carries a copy of the fixture below, for the same reason
 * everything else here is copied rather than shared.
 *
 * `progression.service.relabel.spec.ts` holds what happens when a hand-drawn
 * chord is recognised as something the key can name.
 */
describe('ProgressionService: the setters the roll writes through', () => {
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

  /** How many steps back the history holds, counted by walking it. */
  function undoDepth(): number {
    let depth = 0;
    while (currentState().canUndo) {
      service.undo();
      depth++;
    }
    return depth;
  }

  /**
   * Each of the four answers whether it recorded anything, and that answer is
   * load-bearing rather than informational.
   *
   * All three of the ways out of `writeNotes` decline *silently*, so a caller
   * that counted its own calls would count declines as commits. The roll's
   * gestures pass `coalesce` off exactly this: a gesture whose first commit
   * was refused and which believed it anyway would send `coalesce: true` on
   * its second, and `commit` honours a continuation on the run key alone -
   * which for `placeNotes` names only the slot, shared by every drag on it. It
   * would fold into the entry the previous gesture left, and one undo would
   * take back both.
   */
  describe('what a note write reports', () => {
    it('says so when it recorded an edit', () => {
      expect(service.setSlotNotes(id, [{ midi: 62, startBeat: 0, lengthBeats: 1, velocity: 90 }]))
        .toBeTrue();
      expect(service.placeNotes(id, [{ midi: 64, startBeat: 1, lengthBeats: 1, velocity: 90 }]))
        .toBeTrue();
      expect(service.setNoteTiming(id, 0, 2, 1)).toBeTrue();
      expect(service.setNoteVelocity(id, 0, 40)).toBeTrue();
    });

    /** A slot that is not there is nothing to record against. */
    it('says so when the slot does not exist', () => {
      expect(service.setSlotNotes('nope', [])).toBeFalse();
      expect(service.placeNotes('nope', [])).toBeFalse();
      expect(service.setNoteTiming('nope', 0, 1, 1)).toBeFalse();
      expect(service.setNoteVelocity('nope', 0, 40)).toBeFalse();
    });

    /** Nor is an index the slot has no note at. */
    it('says so when the note index names nothing', () => {
      expect(service.setNoteTiming(id, 99, 1, 1)).toBeFalse();
      expect(service.setNoteVelocity(id, 99, 40)).toBeFalse();
    });

    /**
     * And nor is a write that changes neither the notes nor the claim - which
     * is the case the roll can actually reach, because a drag commits on every
     * threshold it crosses and the second crossing may land back where the
     * first did.
     */
    it('says so when neither the notes nor the claim moved', () => {
      service.setNoteVelocity(id, 0, 40);
      expect(service.setNoteVelocity(id, 0, 40)).toBeFalse();

      const held = notes().map(note => ({ ...note }));
      service.placeNotes(id, held);
      expect(service.placeNotes(id, held)).toBeFalse();
    });

    /** The first touch of a control is a claim even when the number is the one there. */
    it('records the claim even where the number does not move', () => {
      expect(service.setNoteVelocity(id, 0, notes()[0].velocity)).toBeTrue();
    });
  });

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

    /**
     * The length, and the *kind* of the harmony.
     *
     * It used to be the whole harmony, and M3 Task 9 made that false on
     * purpose: a setter that claims the pitches now reads the slot back and
     * relabels it, so `DRAWN` - a fourth over the tonic - comes away a
     * suspension rather than a `I`. What this still holds is the half the
     * roll depends on: writing notes does not resize a slot and does not take
     * its numeral away. The reading itself is
     * `progression.service.relabel.spec.ts`.
     */
    it('leaves the slot`s length alone, and leaves it a chord', () => {
      service.setSlotNotes(id, DRAWN);

      expect(slots()[0].harmony.kind).toBe('degree');
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
     * either. `chordOctaveCeiling` is the bound that holds, and it holds by
     * bounding the generator's input - the octave the whole chord is voiced
     * from - rather than by clamping notes one at a time; where a pitch drag
     * stops on screen is the roll's geometry to decide.
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
});
