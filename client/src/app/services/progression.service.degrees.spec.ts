import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { CHORD_EXTENTS, OCTAVE_MAX } from '../models/progression-normalize';
import { ChordDegree, ChordSlot, ProgressionState } from '../models/progression.model';
import { ChordExtent, ChordShape, effectiveChord } from './progression-harmony';

/**
 * The chord commands: what the strip's editor writes to a slot's degree, and
 * what a slot with no degree to write does when asked.
 *
 * These are `ProgressionDegreeEditor`'s, routed through the service - the chord
 * itself, its extent by value and by step, its inversion, its octave, and the
 * reading of the octave control's own range that the strip draws its arrows
 * from. They end in the same place and are read the same way: `regenerate`
 * builds the notes again from the degree, so every spec here pins the degree
 * that went in against the notes that came back.
 *
 * The two refusals belong here rather than among the odds and ends for the same
 * reason. A scale with no diatonic chords has no degree for a command to write,
 * and a literal slot has no degree at all - so each command has to decline, and
 * a decline that pushed a history step would be worse than a throw. That is one
 * rule read from two ends, and it is only visible with the commands beside it.
 *
 * `a quality override` is here because a pinned shape is a *degree* field: it
 * survives every regeneration untouched, which is what makes it a claim rather
 * than a setting. What it takes to get one back off a slot is
 * `progression.service.reset.spec.ts`.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3292 lines against the project's 1000-line cap, and this is one
 * of five topic-named files carved out of it. The parent's header lists them
 * all and says what stayed. The precedent for copied local fixtures rather than
 * a shared helper module is `progression.service.tensions.spec.ts`, which pins
 * the two setters M3 added to this same degree and is the sibling closest to
 * this file's subject.
 */
describe('ProgressionService: the chord commands', () => {
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

  /**
   * Retuning a slot to another chord: the palette's alternates row, and the one
   * command that moves all four harmony fields at once.
   */
  describe('setSlotChord', () => {
    beforeEach(() => service.appendSlot(4));

    it('re-shapes the slot in place rather than adding one', () => {
      service.setSlotChord(slots()[0].id, { degree: 4, alter: 0, quality: 'minor', extent: 3 });

      expect(slots().length).toBe(1);
      // G B♭ D.
      expect(slots()[0].notes.map(note => note.midi)).toEqual([67, 70, 74]);
    });

    /**
     * The height comes with the shape, which is the cost the palette has to
     * show: a slot standing on a ninth is stood back down by a triad's name.
     */
    it('sets the height the shape names, ninth and all', () => {
      const id = slots()[0].id;
      service.setSlotExtent(id, 9);
      expect(slots()[0].notes.length).toBe(5);

      service.setSlotChord(id, { degree: 4, alter: 0, quality: 'major', extent: 3 });

      expect(slots()[0].notes.length).toBe(3);
    });

    it('reclaims the pitches, as every other harmony command does', () => {
      const id = slots()[0].id;
      // The notes it already has, which claims the pitches and moves nothing.
      // M3 Task 9 made a pitch edit run the recogniser, so a hand-written note
      // list that is not a chord degrades the slot to `literal` - and every
      // harmony command, this one included, refuses a slot with no numeral.
      // What is under test here is the reclaim, so the claim is made the one
      // way that says nothing else; `progression.service.relabel.spec.ts` is
      // where the reading is pinned.
      service.setSlotNotes(id, slots()[0].notes);
      expect(slots()[0].owned.pitches).toBeTrue();

      service.setSlotChord(id, { degree: 4, alter: 0, quality: 'minor', extent: 3 });

      expect(slots()[0].owned.pitches).toBeFalse();
      expect(slots()[0].notes.map(note => note.midi)).toEqual([67, 70, 74]);
    });

    it('records nothing when the slot already holds that chord', () => {
      const id = slots()[0].id;
      service.setSlotChord(id, { degree: 4, alter: 0, quality: 'major', extent: 3 });

      expectNoCommit(() =>
        service.setSlotChord(id, { degree: 4, alter: 0, quality: 'major', extent: 3 })
      );
    });

    it('refuses in a key that can build no chords', () => {
      const id = slots()[0].id;
      service.setKey(0, 'majorPentatonic');

      expectNoCommit(() =>
        service.setSlotChord(id, { degree: 4, alter: 0, quality: 'minor', extent: 3 })
      );
    });

    it('ignores an id the document does not hold', () => {
      expectNoCommit(() =>
        service.setSlotChord('no-such-slot', { degree: 0, alter: 0, quality: 'minor', extent: 3 })
      );
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
      expect(effectiveChord(keyIntervals(), plainShape(0, 7)).base).toBe('major7');
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

  /**
   * Where the octave control stands, once the ceiling can differ from the
   * request.
   *
   * The three numbers come apart only for a chord too wide for the octave it was
   * given, which nothing in the UI can build until Task 6 adds the suspension
   * and tension controls. They are built here through `replaceDocument`, which
   * is what that route is for.
   */
  describe('slotOctave', () => {
    /**
     * The widest chord the model can build: degree 3 at extent 13, altered down
     * a tone and overridden to `diminished`, suspended at the fourth with a
     * flattened ninth and a flattened thirteenth, second inversion. In D it
     * reaches 58 semitones above its base, so its ceiling is 0.
     */
    const WIDEST: Partial<ChordDegree> = {
      extent: 13,
      alter: -2,
      quality: 'diminished',
      suspension: 'sus4',
      extensions: { ninth: -1, eleventh: null, thirteenth: -1 },
      inversion: 2
    };

    /** One slot on degree 3 in D major, with these degree fields written over it. */
    function slotInD(overrides: Partial<ChordDegree>): string {
      service.setKey(2, 'ionian');
      service.appendSlot(3);
      const slot = slots()[0];
      if (slot.harmony.kind !== 'degree') throw new Error('expected a degree slot');
      const degree: ChordDegree = { ...slot.harmony.degree, ...overrides };
      service.replaceDocument({
        ...currentState().doc,
        slots: [{ ...slot, harmony: { kind: 'degree', degree } }]
      });
      return slot.id;
    }

    it('reports one number three times for a chord that fits', () => {
      const id = slotInD({ octave: OCTAVE_MAX });
      expect(service.slotOctave(id))
        .toEqual({ requested: OCTAVE_MAX, sounding: OCTAVE_MAX, ceiling: OCTAVE_MAX });
    });

    /**
     * The case the three numbers exist for. The document holds `OCTAVE_MAX`,
     * the synth hears 0, and the ceiling says which of those is the reason.
     */
    it('separates the request from the sound for a chord that does not fit', () => {
      const id = slotInD({ ...WIDEST, octave: OCTAVE_MAX });
      expect(service.slotOctave(id)).toEqual({ requested: OCTAVE_MAX, sounding: 0, ceiling: 0 });
    });

    /**
     * The whole argument for clamping on use rather than writing back, asserted
     * as behaviour: the slot is never edited, the chord narrows, and the octave
     * the user asked for comes back on its own.
     *
     * Reset to chord is the narrowing here because it is the one control that
     * exists today - it drops the suspension and both pinned alterations, which
     * is exactly what widened the chord. Had the clamp been stored, this slot
     * would sound at 0 for ever after, and nothing would tell the user why.
     */
    it('returns the slot to the octave it asked for when the chord narrows', () => {
      const id = slotInD({ ...WIDEST, octave: OCTAVE_MAX });
      expect(service.slotOctave(id)?.sounding).toBe(0);

      service.resetSlotToChord(id);

      expect(service.slotOctave(id))
        .toEqual({ requested: OCTAVE_MAX, sounding: OCTAVE_MAX, ceiling: OCTAVE_MAX });
    });

    /** A slot below its ceiling is reported where it is, not raised to it. */
    it('does not raise a slot voiced below its ceiling', () => {
      const id = slotInD({ ...WIDEST, octave: -1 });
      expect(service.slotOctave(id)).toEqual({ requested: -1, sounding: -1, ceiling: 0 });
    });

    // Three ways there is no octave to report, all of them cases where the
    // palette's controls are already not offered, so the caller has an empty
    // state to fall into rather than a number to disbelieve.
    it('has no answer for a slot that is not there', () => {
      slotInD({});
      expect(service.slotOctave('no-such-slot')).toBeNull();
    });

    it('has no answer for a literal slot, whose notes are the truth', () => {
      const id = slotInD({});
      const slot = slots()[0];
      service.replaceDocument({
        ...currentState().doc,
        slots: [{ ...slot, harmony: { kind: 'literal', reason: 'user-detached', from: null } }]
      });
      expect(service.slotOctave(id)).toBeNull();
    });

    it('has no answer in a key that cannot stack thirds', () => {
      const id = slotInD({});
      service.setKey(0, 'majorPentatonic');
      expect(service.slotOctave(id)).toBeNull();
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
        harmony: { kind: 'literal', reason: 'user-detached', from: null }
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
        harmony: { kind: 'literal', reason: 'user-detached', from: null },
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
