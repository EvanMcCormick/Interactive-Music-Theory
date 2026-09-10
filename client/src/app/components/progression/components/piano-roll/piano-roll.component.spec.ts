import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PianoRollComponent } from './piano-roll.component';
import { MIN_NOTE_BEATS, VELOCITY_MAX, VELOCITY_MIN } from '../../../../models/progression-normalize';
import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * What the roll draws, and what each gesture tells the service.
 *
 * The strip's three-file split, for its reasons. The `begin*` handlers take a
 * geometry the caller supplies, so the wiring - which service call, with which
 * arguments, and when - is driven straight through that seam here, with the
 * scale written as a plain number rather than measured. Everything *above* the
 * seam is the adapter, and it is next door in `piano-roll-pointer.spec.ts`,
 * driven with real `PointerEvent`s on a rendered roll: which button was
 * pressed, which element gets measured and by what divisor, what is listened to
 * and what is let go of. None of that is arithmetic and none of it can be
 * reached by calling `beginMove`, which is how the strip came to ship with six
 * mutants alive in it. The arithmetic below both is in
 * `piano-roll-geometry.spec.ts`.
 *
 * ## Three rules the roll inherits, and where each is pinned down
 *
 *  1. **A gesture that places a note in time calls `placeNotes`.**
 *     `setSlotNotes` claims pitches only, so a note placed through it alone is
 *     snapped back to beat 0 by the next regeneration. Asserted behaviourally -
 *     drag a note, change the key, and see it stay - rather than only by which
 *     spy was called, because the spy is the mechanism and the survival is the
 *     point.
 *  2. **Every pointerdown opens its own run.** The run keys for `setSlotNotes`
 *     and `placeNotes` are per *slot*, so two drags on two different notes fold
 *     into one undo entry unless each gesture passes `coalesce: false` first.
 *  3. **The dead zone goes on the unsnapped beat.** After `snapBeat` the
 *     information needed to hold a boundary is gone.
 */
describe('PianoRollComponent', () => {
  let fixture: ComponentFixture<PianoRollComponent>;
  let component: PianoRollComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PianoRollComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(PianoRollComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function settle(): void {
    fixture.detectChanges();
  }

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /** The notes of the first slot, as the document holds them. */
  function storedNotes(): readonly RollNote[] {
    return currentState().doc.slots[0].notes;
  }

  /**
   * Appends a chord and renders it. `appendSlot` selects what it appends, so
   * the roll opens on it exactly as it does when a user clicks the palette.
   */
  function build(degree = 0): string {
    progression.appendSlot(degree);
    settle();
    return currentState().doc.slots[0].id;
  }

  /** The two fields a gesture reads off a pointer event, for the seam tests. */
  function pointerAt(clientX: number, clientY: number): PointerEvent {
    return { clientX, clientY, button: 0 } as PointerEvent;
  }

  // A comfortable scale for the seam tests: a beat is 40 pixels wide, a semitone
  // 12 tall, and one velocity unit half a pixel. None of it is measured here -
  // the point of the seam is that the geometry arrives already worked out.
  const PX_PER_BEAT = 40;
  const ROW_HEIGHT = 12;
  const PX_PER_VELOCITY = 0.5;

  // ---------------------------------------------------------------------------
  // What it renders
  // ---------------------------------------------------------------------------

  describe('what it shows', () => {
    it('shows no grid until a slot is selected', () => {
      expect(component.hasSlot).toBeFalse();
      expect(component.notes).toEqual([]);
    });

    it('draws one note per note of the selected slot', () => {
      build();
      expect(component.notes.length).toBe(storedNotes().length);
      expect(component.notes.map(note => note.midi)).toEqual(
        storedNotes().map(note => note.midi)
      );
    });

    it('follows the selection to another slot', () => {
      build();
      progression.appendSlot(4);
      settle();

      const second = currentState().doc.slots[1];
      expect(component.notes.map(note => note.midi)).toEqual(
        second.notes.map(note => note.midi)
      );

      progression.selectSlot(currentState().doc.slots[0].id);
      settle();
      expect(component.notes.map(note => note.midi)).toEqual(
        currentState().doc.slots[0].notes.map(note => note.midi)
      );
    });

    it('stops drawing a grid when the selected slot is removed', () => {
      const id = build();
      progression.removeSlot(id);
      settle();

      expect(component.hasSlot).toBeFalse();
      expect(component.notes).toEqual([]);
    });

    /** The window follows the notes, and both ends of it are drawn. */
    it('draws a row for every pitch in the window', () => {
      build();
      expect(component.rows.length).toBe(component.gridRows);
      expect(component.rows[0].midi).toBe(component.topMidi);
      expect(component.rows[component.rows.length - 1].midi).toBe(
        component.topMidi - component.gridRows + 1
      );
    });

    /**
     * A note hanging past the end of its slot is still somewhere to be seen -
     * `retimeNotes` and `setNoteTiming` both allow one deliberately, and a note
     * that cannot be seen is a note that cannot be dragged back. The length is
     * fractional because a grid that stopped short would end halfway through a
     * cell, which is the whole reason it rounds up rather than down.
     */
    it('widens the grid to the whole beat past a note that runs past the slot', () => {
      const id = build();
      progression.setNoteTiming(id, 0, 6, 3.5);
      settle();

      expect(component.totalBeats).toBe(10);
    });

    /**
     * The window is derived from the notes, not fixed: `visibleMidiRange` pads
     * them and floors the span at two octaves, so the grid opens with room
     * either side of the chord rather than around a pitch chosen in advance.
     */
    it('opens the window around the notes it is drawing', () => {
      build();
      const pitches = storedNotes().map(note => note.midi);

      expect(component.topMidi).toBeGreaterThan(Math.max(...pitches));
      expect(component.topMidi - component.gridRows + 1).toBeLessThan(Math.min(...pitches));
    });

    /** And it follows them: a note dragged above the window lifts the window. */
    it('follows a note taken above the window it opened on', () => {
      const id = build();
      const before = component.topMidi;

      progression.setSlotNotes(id, [
        { ...storedNotes()[0], midi: before + 5 },
        ...storedNotes().slice(1)
      ]);
      settle();

      expect(component.topMidi).toBeGreaterThan(before);
    });

    /**
     * The velocity bar is a fraction of the lane, measured from the *floor* of
     * the MIDI range rather than from zero: velocity 1 is the quietest a note
     * can be and draws as an empty bar, not as a bar 1/127 tall.
     */
    it('draws a velocity as a fraction of the range it can hold', () => {
      const id = build();

      progression.setNoteVelocity(id, 0, VELOCITY_MIN);
      progression.setNoteVelocity(id, 1, VELOCITY_MAX);
      settle();

      expect(component.notes[0].velocityFraction).toBe(0);
      expect(component.notes[1].velocityFraction).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // The wiring: a geometry the test supplies, and what the service is told.
  // ---------------------------------------------------------------------------

  describe('dragging a note', () => {
    it('places the note at the beat and pitch the drag reaches', () => {
      const id = build();
      const before = storedNotes();
      spyOn(progression, 'placeNotes');

      // Two beats right and three rows up.
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(180, 100 - 3 * ROW_HEIGHT));

      expect(progression.placeNotes).toHaveBeenCalledWith(
        id,
        [{ ...before[0], startBeat: 2, midi: before[0].midi + 3 }, ...before.slice(1)],
        { coalesce: false }
      );
    });

    /** Dragging down lowers the pitch. The axis is inverted; this says so. */
    it('lowers the pitch as the pointer moves down', () => {
      build();
      const before = storedNotes();

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(100, 100 + 2 * ROW_HEIGHT));
      settle();

      expect(storedNotes()[0].midi).toBe(before[0].midi - 2);
    });

    /**
     * Rule 1. `setSlotNotes` claims pitches only, so a note placed through it
     * is snapped back to beat 0 by the next regeneration - and a key change is
     * a regeneration. `placeNotes` claims both in one commit, which is what
     * this asserts without naming it.
     */
    it('leaves a dragged note where the drag put it when the key changes', () => {
      build();
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerUp();
      settle();
      expect(storedNotes().some(note => note.startBeat === 2)).toBeTrue();

      progression.setKey(9, 'aeolian');
      settle();

      expect(storedNotes().some(note => note.startBeat === 2)).toBeTrue();
    });

    /**
     * One drag is one undo step, however many grid lines it crosses.
     *
     * The spy answers `true` because that is what the setter answers when it
     * records something, and the gesture reads that answer rather than assuming
     * it - see `committing` below, which is the other half of this.
     */
    it('folds every later position of the same drag into the first', () => {
      build();
      spyOn(progression, 'placeNotes').and.returnValue(true);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerMove(pointerAt(220, 100));

      expect(
        (progression.placeNotes as jasmine.Spy).calls.allArgs().map(args => args[2])
      ).toEqual([{ coalesce: false }, { coalesce: true }, { coalesce: true }]);
    });

    it('leaves one undo step behind, and it goes back to before the drag', () => {
      build();
      const before = storedNotes()[0].startBeat;

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(220, 100));
      component.onPointerUp();
      settle();
      expect(storedNotes()[0].startBeat).toBe(3);

      progression.undo();
      settle();
      expect(storedNotes()[0].startBeat).toBe(before);
    });

    /**
     * Rule 2, and the reason it needs saying. `placeNotes` keys its run by the
     * *slot* - it writes the whole list, so there is no note for it to name -
     * which means two drags on two different notes of one slot fold into a
     * single undo entry unless each pointerdown opens its own run.
     */
    it('keeps a drag on a second note a step of its own', () => {
      build();
      spyOn(progression, 'placeNotes').and.returnValue(true);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerUp();

      component.beginMove(1, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(180, 100));

      expect(
        (progression.placeNotes as jasmine.Spy).calls.allArgs().map(args => args[2])
      ).toEqual([{ coalesce: false }, { coalesce: false }]);
    });

    /** And for real: undoing the second drag leaves the first one standing. */
    it('undoes two drags on two notes one at a time', () => {
      build();

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerUp();

      component.beginMove(1, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(220, 100));
      component.onPointerUp();
      settle();
      expect(storedNotes().map(note => note.startBeat)).toEqual([2, 3, 0]);

      progression.undo();
      settle();
      expect(storedNotes().map(note => note.startBeat)).toEqual([2, 0, 0]);
    });

    /** Absolute, not incremental: every move is measured from where it began. */
    it('measures each move from where the drag began', () => {
      build();
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(220, 100));
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerUp();
      settle();

      expect(storedNotes()[0].startBeat).toBe(1);
    });

    /**
     * Rule 3. A pointer resting on the boundary between two grid lines and
     * shaking by a pixel would otherwise cross it over and over, each crossing a
     * real commit and a real repaint. The dead zone is applied to the *raw*
     * beat, because after `snapBeat` there is nothing left to hold.
     */
    it('holds the note steady while the pointer sits on a grid boundary', () => {
      build();
      component.setDivision(1);
      spyOn(progression, 'placeNotes');

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      // 40px is one beat, so 120 is dead on the half-beat between 0 and 1.
      component.onPointerMove(pointerAt(120, 100));
      component.onPointerMove(pointerAt(122, 100));
      component.onPointerMove(pointerAt(118, 100));

      expect(progression.placeNotes).not.toHaveBeenCalled();
    });

    it('takes the next grid line once the pointer is clear of the boundary', () => {
      build();
      component.setDivision(1);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(100 + 40 * 0.7, 100));
      settle();

      expect(storedNotes()[0].startBeat).toBe(1);
    });

    /**
     * A row the drag is more than half-way into is the row it is on. Rounded
     * rather than floored, which is the difference between reading the pointer
     * as a displacement and reading it as a position: `yToMidi` floors because
     * every pixel of a row has to give one pitch, and the same floor applied to
     * a *travel* would move a note a semitone for one pixel one way and none
     * the other. The distances here are deliberately not whole rows, because
     * whole rows are where the two rules agree.
     */
    it('takes the nearer row rather than the one the drag has passed', () => {
      build();
      const before = storedNotes()[0].midi;

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(100, 100 - 1.6 * ROW_HEIGHT));
      settle();
      expect(storedNotes()[0].midi).toBe(before + 2);

      component.onPointerMove(pointerAt(100, 100 + 1.4 * ROW_HEIGHT));
      settle();
      expect(storedNotes()[0].midi).toBe(before - 1);
    });

    /** The same dead zone on the row boundary, which is just as easy to rest on. */
    it('holds the pitch steady while the pointer sits on a row boundary', () => {
      build();
      spyOn(progression, 'placeNotes');

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(100, 100 - ROW_HEIGHT / 2));
      component.onPointerMove(pointerAt(100, 100 - ROW_HEIGHT / 2 - 1));

      expect(progression.placeNotes).not.toHaveBeenCalled();
    });

    /** Free timing is what the roll is for: no grid, and no snapping. */
    it('leaves the beat unsnapped when there is no grid', () => {
      build();
      component.setDivision(0);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(113, 100));
      settle();

      expect(storedNotes()[0].startBeat).toBeCloseTo(13 / 40, 9);
    });

    /** A note cannot start before the slot does; `boundNoteStart` says so. */
    it('holds a note dragged past the left edge at the start of the slot', () => {
      const id = build();
      progression.setNoteTiming(id, 0, 2, 1);
      settle();

      component.beginMove(0, 500, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(100, 100));
      settle();

      expect(storedNotes()[0].startBeat).toBe(0);
    });

    it('stops dragging once the pointer is released', () => {
      build();
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerUp();

      spyOn(progression, 'placeNotes');
      component.onPointerMove(pointerAt(500, 100));

      expect(progression.placeNotes).not.toHaveBeenCalled();
    });

    it('commits nothing when a gesture is cancelled', () => {
      build();
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerCancel();

      spyOn(progression, 'placeNotes');
      component.onPointerMove(pointerAt(500, 100));

      expect(progression.placeNotes).not.toHaveBeenCalled();
    });
  });

  describe('dragging a note edge', () => {
    it('sets the length the drag reaches, and only the length', () => {
      const id = build();
      const before = storedNotes()[0];
      spyOn(progression, 'setNoteTiming');

      component.beginResize(0, 100, PX_PER_BEAT);
      component.onPointerMove(pointerAt(60, 100));

      expect(progression.setNoteTiming).toHaveBeenCalledWith(
        id,
        0,
        before.startBeat,
        before.lengthBeats - 1,
        { coalesce: false }
      );
    });

    it('folds every later length of the same drag into the first', () => {
      build();
      spyOn(progression, 'setNoteTiming').and.returnValue(true);

      component.beginResize(0, 100, PX_PER_BEAT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(180, 100));

      expect(
        (progression.setNoteTiming as jasmine.Spy).calls.allArgs().map(args => args[4])
      ).toEqual([{ coalesce: false }, { coalesce: true }]);
    });

    /**
     * The floor is one grid cell rather than `MIN_NOTE_BEATS`, so the edge rests
     * where the grid said it would. A shorter clamp would leave it off the grid
     * the user is snapping to.
     */
    it('stops shrinking at one cell of the grid it is snapping to', () => {
      build();
      component.setDivision(2);
      component.beginResize(0, 500, PX_PER_BEAT);
      component.onPointerMove(pointerAt(0, 100));
      settle();

      expect(storedNotes()[0].lengthBeats).toBe(0.5);
    });

    /** Including the grid the roll opens on, which nothing has to set first. */
    it('stops shrinking at one cell of the grid it opened on', () => {
      build();
      component.beginResize(0, 500, PX_PER_BEAT);
      component.onPointerMove(pointerAt(0, 100));
      settle();

      expect(storedNotes()[0].lengthBeats).toBe(0.25);
    });

    it('stops shrinking at the shortest storable note when there is no grid', () => {
      build();
      component.setDivision(0);
      component.beginResize(0, 500, PX_PER_BEAT);
      component.onPointerMove(pointerAt(0, 100));
      settle();

      expect(storedNotes()[0].lengthBeats).toBe(MIN_NOTE_BEATS);
    });

    /** A resize is a timing edit, and a timing edit never touches the pitches. */
    it('leaves the pitches to be regenerated, having claimed only the timing', () => {
      build();
      const before = storedNotes().map(note => note.midi);

      component.beginResize(0, 100, PX_PER_BEAT);
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerUp();
      settle();

      progression.setKey(9, 'aeolian');
      settle();

      expect(storedNotes().map(note => note.midi)).not.toEqual(before);
      expect(storedNotes()[0].lengthBeats).toBe(6);
    });

    it('holds the length steady while the pointer sits on a boundary', () => {
      build();
      component.setDivision(1);
      spyOn(progression, 'setNoteTiming');

      component.beginResize(0, 100, PX_PER_BEAT);
      component.onPointerMove(pointerAt(120, 100));
      component.onPointerMove(pointerAt(121, 100));

      expect(progression.setNoteTiming).not.toHaveBeenCalled();
    });
  });

  describe('dragging a velocity', () => {
    it('sets the velocity the drag reaches', () => {
      const id = build();
      const before = storedNotes()[0].velocity;
      spyOn(progression, 'setNoteVelocity');

      // Upward is louder, and a velocity unit is half a pixel here.
      component.beginVelocity(0, 100, PX_PER_VELOCITY);
      component.onPointerMove(pointerAt(0, 90));

      expect(progression.setNoteVelocity).toHaveBeenCalledWith(id, 0, before + 20, {
        coalesce: false
      });
    });

    it('folds every later velocity of the same drag into the first', () => {
      build();
      spyOn(progression, 'setNoteVelocity').and.returnValue(true);

      component.beginVelocity(0, 100, PX_PER_VELOCITY);
      component.onPointerMove(pointerAt(0, 90));
      component.onPointerMove(pointerAt(0, 80));

      expect(
        (progression.setNoteVelocity as jasmine.Spy).calls.allArgs().map(args => args[3])
      ).toEqual([{ coalesce: false }, { coalesce: true }]);
    });

    it('clamps at both ends of the MIDI range', () => {
      build();

      component.beginVelocity(0, 100, PX_PER_VELOCITY);
      component.onPointerMove(pointerAt(0, -1000));
      settle();
      expect(storedNotes()[0].velocity).toBe(VELOCITY_MAX);

      component.onPointerMove(pointerAt(0, 1000));
      settle();
      expect(storedNotes()[0].velocity).toBe(VELOCITY_MIN);
    });

    /** Velocity is its own claim: the pitches and the rhythm stay the key's. */
    it('leaves the timing to be regenerated, having claimed only the velocity', () => {
      const id = build();
      progression.setNoteTiming(id, 0, 1, 1);
      settle();

      component.beginVelocity(0, 100, PX_PER_VELOCITY);
      component.onPointerMove(pointerAt(0, 90));
      component.onPointerUp();
      settle();

      expect(currentState().doc.slots[0].owned).toEqual({
        pitches: false,
        timing: true,
        velocity: true
      });
    });
  });

  describe('one gesture at a time', () => {
    it('dispatches nothing for pointer movement with no gesture under way', () => {
      build();
      spyOn(progression, 'placeNotes');
      spyOn(progression, 'setNoteTiming');
      spyOn(progression, 'setNoteVelocity');

      component.onPointerMove(pointerAt(500, 500));
      component.onPointerUp();

      expect(progression.placeNotes).not.toHaveBeenCalled();
      expect(progression.setNoteTiming).not.toHaveBeenCalled();
      expect(progression.setNoteVelocity).not.toHaveBeenCalled();
    });

    it('abandons a move when a resize starts', () => {
      build();
      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.beginResize(0, 100, PX_PER_BEAT);

      spyOn(progression, 'placeNotes');
      component.onPointerMove(pointerAt(180, 100));

      expect(progression.placeNotes).not.toHaveBeenCalled();
    });

    it('abandons a resize when a velocity drag starts', () => {
      build();
      component.beginResize(0, 100, PX_PER_BEAT);
      component.beginVelocity(0, 100, PX_PER_VELOCITY);

      spyOn(progression, 'setNoteTiming');
      component.onPointerMove(pointerAt(180, 90));

      expect(progression.setNoteTiming).not.toHaveBeenCalled();
    });
  });

  /**
   * `committed` decides `coalesce`, so it has to mean "this gesture has an undo
   * entry open" and not "a setter was called". The setters answer whether they
   * recorded anything - `ProgressionNoteEditor.writeNotes` argues why - and these
   * drive the two answers straight at the gesture.
   */
  describe('what a gesture counts as having committed', () => {
    /**
     * A refused first commit opens no entry, so the second step of the same
     * gesture must still ask for one. Folding it instead would fold it into
     * whatever the *previous* gesture left on the stack: `placeNotes` keys its
     * run by the slot alone, so every drag on one slot shares a key, and one
     * undo would take back two drags.
     */
    it('asks for a run of its own again when the first commit was refused', () => {
      build();
      const placeNotes = spyOn(progression, 'placeNotes').and.returnValue(false);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(180, 100));

      expect(placeNotes.calls.allArgs().map(args => args[2])).toEqual([
        { coalesce: false },
        { coalesce: false }
      ]);
    });

    /** And once an entry really is open it stays open, refusals and all. */
    it('keeps folding into an entry a later refusal did not close', () => {
      build();
      const placeNotes = spyOn(progression, 'placeNotes').and.returnValues(true, false, true);

      component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(180, 100));
      component.onPointerMove(pointerAt(220, 100));

      expect(placeNotes.calls.allArgs().map(args => args[2])).toEqual([
        { coalesce: false },
        { coalesce: true },
        { coalesce: true }
      ]);
    });

    it('does the same for a refused resize', () => {
      build();
      const setNoteTiming = spyOn(progression, 'setNoteTiming').and.returnValue(false);

      component.beginResize(0, 100, PX_PER_BEAT);
      component.onPointerMove(pointerAt(140, 100));
      component.onPointerMove(pointerAt(180, 100));

      expect(setNoteTiming.calls.allArgs().map(args => args[4])).toEqual([
        { coalesce: false },
        { coalesce: false }
      ]);
    });

    it('does the same for a refused velocity', () => {
      build();
      const setNoteVelocity = spyOn(progression, 'setNoteVelocity').and.returnValue(false);

      component.beginVelocity(0, 100, PX_PER_VELOCITY);
      component.onPointerMove(pointerAt(0, 90));
      component.onPointerMove(pointerAt(0, 80));

      expect(setNoteVelocity.calls.allArgs().map(args => args[3])).toEqual([
        { coalesce: false },
        { coalesce: false }
      ]);
    });
  });

  /**
   * A gesture writes to the slot it began on. The strip is a sibling on the
   * same page and the selection is not the drag's to follow: notes snapshotted
   * from one slot and measured against its geometry must not land in another.
   */
  it('writes to the slot the drag started on, not the one selected since', () => {
    const first = build();
    progression.appendSlot(4);
    settle();
    progression.selectSlot(first);
    settle();

    component.beginMove(0, 100, 100, PX_PER_BEAT, ROW_HEIGHT);
    const second = currentState().doc.slots[1];
    progression.selectSlot(second.id);
    settle();
    component.onPointerMove(pointerAt(180, 100));
    settle();

    expect(currentState().doc.slots[0].notes[0].startBeat).toBe(2);
    expect(currentState().doc.slots[1].notes).toEqual(second.notes);
  });

  describe('the keyboard path', () => {
    /**
     * The one place the roll's two drag axes come apart. A pointer drag moves a
     * note in pitch and time at once and so claims both; Up and Down move only
     * the pitch, and `setSlotNotes` is the narrower claim that says so.
     */
    it('nudges a note in pitch, claiming the pitches and nothing else', () => {
      const id = build();
      const before = storedNotes();
      spyOn(progression, 'setSlotNotes');

      component.nudgePitch(component.notes[0], 1);

      expect(progression.setSlotNotes).toHaveBeenCalledWith(id, [
        { ...before[0], midi: before[0].midi + 1 },
        ...before.slice(1)
      ]);
    });

    it('nudges a note in time by one cell of the grid', () => {
      build();
      component.setDivision(2);

      component.nudgeStart(component.notes[0], 1);
      settle();

      expect(storedNotes()[0].startBeat).toBe(0.5);
    });

    it('nudges a note length by one cell of the grid', () => {
      build();
      component.setDivision(2);
      const before = storedNotes()[0].lengthBeats;

      component.nudgeLength(component.notes[0], -1);
      settle();

      expect(storedNotes()[0].lengthBeats).toBe(before - 0.5);
    });

    it('nudges a velocity', () => {
      build();
      const before = storedNotes()[0].velocity;

      component.nudgeVelocity(component.notes[0], 1);
      settle();

      expect(storedNotes()[0].velocity).toBeGreaterThan(before);
    });

    /** Every nudge is its own undo step: there is no drag to fold it into. */
    it('leaves one undo step per nudge', () => {
      build();
      component.nudgePitch(component.notes[0], 1);
      settle();
      const raised = storedNotes()[0].midi;

      component.nudgePitch(component.notes[0], 1);
      settle();
      expect(storedNotes()[0].midi).toBe(raised + 1);

      progression.undo();
      settle();
      expect(storedNotes()[0].midi).toBe(raised);
    });
  });

  describe('adding and removing notes', () => {
    it('removes a note through the setter that claims the pitches', () => {
      const id = build();
      const before = storedNotes();
      spyOn(progression, 'setSlotNotes');

      component.deleteNote(component.notes[1]);

      expect(progression.setSlotNotes).toHaveBeenCalledWith(id, [before[0], before[2]]);
    });

    it('removes the note for real', () => {
      build();
      const before = storedNotes().map(note => note.midi);

      component.deleteNote(component.notes[1]);
      settle();

      expect(storedNotes().map(note => note.midi)).toEqual([before[0], before[2]]);
    });

    it('lets every note be removed and the grid stay', () => {
      build();
      for (let index = component.notes.length - 1; index >= 0; index--) {
        component.deleteNote(component.notes[index]);
        settle();
      }

      expect(storedNotes()).toEqual([]);
      expect(component.hasSlot).toBeTrue();
    });

    /**
     * The keyboard path to creating one, which the roll shipped without: a
     * double-click on a bare `<div>` was the only way, so a keyboard user who
     * emptied a slot could not put a note back in it except through Reset to
     * chord - which throws away every other edit in the slot with it.
     */
    it('adds a note at the start of the slot with no pointer anywhere', () => {
      const id = build();
      const before = storedNotes();
      spyOn(progression, 'placeNotes');

      component.addNoteAtStart();

      expect(progression.placeNotes).toHaveBeenCalledWith(id, [
        ...before,
        {
          midi: jasmine.any(Number),
          startBeat: 0,
          lengthBeats: component.gridStep,
          velocity: jasmine.any(Number)
        }
      ]);
    });

    it('gets an empty slot editable again', () => {
      build();
      for (let index = component.notes.length - 1; index >= 0; index--) {
        component.deleteNote(component.notes[index]);
        settle();
      }
      expect(storedNotes()).toEqual([]);

      component.addNoteAtStart();
      settle();

      expect(storedNotes().length).toBe(1);
      expect(storedNotes()[0].startBeat).toBe(0);
    });

    /**
     * A note laid exactly on top of one already there is invisible, unreachable
     * by a pointer and indistinguishable from the button having done nothing -
     * the velocity lane's bug, in the grid.
     */
    it('never lays the new note on top of one already at that beat', () => {
      build();
      for (let added = 0; added < 4; added++) {
        component.addNoteAtStart();
        settle();
      }

      const atStart = storedNotes().filter(note => note.startBeat === 0);
      expect(new Set(atStart.map(note => note.midi)).size).toBe(atStart.length);
    });

    it('adds nothing when no slot is selected', () => {
      spyOn(progression, 'placeNotes');
      component.addNoteAtStart();
      expect(progression.placeNotes).not.toHaveBeenCalled();
    });

    /** The escape hatch: every claim dropped, the block chord rebuilt. */
    it('hands the slot back to the generator', () => {
      build();
      const generated = storedNotes().map(note => note.midi);

      component.deleteNote(component.notes[0]);
      settle();
      expect(storedNotes().length).toBe(generated.length - 1);

      component.resetToChord();
      settle();

      expect(storedNotes().map(note => note.midi)).toEqual(generated);
      expect(currentState().doc.slots[0].owned).toEqual({
        pitches: false,
        timing: false,
        velocity: false
      });
    });
  });

  describe('the grid division', () => {
    it('refuses a division finer than the shortest note the model stores', () => {
      build();
      component.setDivision(64);
      expect(component.division).toBe(4);
    });

    it('refuses a division that is not a number', () => {
      build();
      component.setDivision('nonsense');
      expect(component.division).toBe(4);
    });

    it('takes free timing, which is the absence of a grid', () => {
      build();
      component.setDivision(0);
      expect(component.division).toBe(0);
    });

    /**
     * The third number `applyDivision` writes, and the one that had no test.
     * The stylesheet divides `--px-per-beat` by it to draw the subdivision
     * gradient, and CSS cannot divide by zero - so free timing, which *is* a
     * division of zero, still has to hand the gradient the beat lines.
     */
    it('never hands the stylesheet a zero to divide by', () => {
      build();
      expect(component.gridDivision).toBe(component.division);

      component.setDivision(8);
      expect(component.gridDivision).toBe(8);

      component.setDivision(0);
      expect(component.division).toBe(0);
      expect(component.gridDivision).toBe(1);
    });

    /**
     * The one DOM assertion in this file, and it is here for the palette's
     * reason: a value the component held but never rendered would satisfy every
     * expectation above and show the user a control set to something else.
     * Angular applies a `[value]` on the `<select>` before its own `*ngFor` has
     * made an option to match, so the box opened on `Free` while the roll was
     * snapping to sixteenths - which is a bug nothing but the rendered element
     * can see.
     */
    it('shows the grid it is actually snapping to', () => {
      const select: HTMLSelectElement = fixture.nativeElement.querySelector('.grid-select');
      expect(Number(select.value)).toBe(component.division);

      component.setDivision(8);
      settle();

      expect(Number(select.value)).toBe(8);
    });

    it('commits nothing when the grid changes', () => {
      build();
      spyOn(progression, 'placeNotes');
      const before = currentState().doc;

      component.setDivision(8);

      expect(progression.placeNotes).not.toHaveBeenCalled();
      expect(currentState().doc).toBe(before);
    });
  });
});
