import { TestBed } from '@angular/core/testing';

import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { RollNoteView, buildRollView } from './piano-roll-view';

/**
 * The view model the roll draws from, called directly.
 *
 * `buildRollView` is pure - a published state goes in, a view model comes out -
 * so it needs no component and no fixture, which is the whole reason
 * it was taken out of the component in the first place. What it draws for a slot
 * is asserted here; that the browser then *puts* it where this says is next door
 * in `piano-roll-pointer.spec.ts`, through a real hit test.
 *
 * The state still comes from `ProgressionService` rather than from a document
 * written out here, because the case that matters is the one the generator
 * actually produces: every note of a chord starting at beat 0 and lasting the
 * whole slot. A hand-built document could accidentally not be that.
 */
describe('buildRollView', () => {
  let progression: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    progression = TestBed.inject(ProgressionService);
  });

  function notes(): readonly RollNoteView[] {
    let built: readonly RollNoteView[] = [];
    progression
      .getState()
      .subscribe(state => (built = buildRollView(state).notes))
      .unsubscribe();
    return built;
  }

  /** Appends a chord and selects it, exactly as clicking the palette does. */
  function build(): string {
    progression.appendSlot(0);
    let id = '';
    progression.getState().subscribe(state => (id = state.doc.slots[0].id)).unsubscribe();
    return id;
  }

  function place(id: string, drawn: readonly RollNote[]): void {
    progression.placeNotes(id, drawn);
  }

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /**
   * One column per note, side by side, and no two of them sharing a pixel.
   *
   * The velocity lane's whole failure was that this was assumed rather than
   * built: a bar drawn at its note's own beat and length put every note of a
   * generated chord on one rectangle, so the lane showed the silhouette of
   * whichever was loudest and only the last of them could be pressed.
   * `buildLaneColumns` states the rule and why no two columns can overlap.
   */
  describe('the velocity lane columns', () => {
    /** The case the bug was in: a chord, straight from the generator. */
    it('gives every note of a generated chord a column no other note touches', () => {
      build();
      const built = notes();
      expect(built.length).toBeGreaterThan(1);

      const spans = built
        .map(note => [note.laneBeat, note.laneBeat + note.laneBeats])
        .sort((left, right) => left[0] - right[0]);

      for (let index = 1; index < spans.length; index++) {
        expect(spans[index][0]).toBeGreaterThanOrEqual(spans[index - 1][1]);
      }
      for (const span of spans) expect(span[1]).toBeGreaterThan(span[0]);
    });

    /** Equal shares of the span, in the notes' own order. */
    it('splits the span evenly between the notes that start together', () => {
      const id = build();
      place(id, [
        { midi: 60, startBeat: 0, lengthBeats: 3, velocity: 80 },
        { midi: 64, startBeat: 0, lengthBeats: 3, velocity: 80 },
        { midi: 67, startBeat: 0, lengthBeats: 3, velocity: 80 }
      ]);

      expect(notes().map(note => note.laneBeat)).toEqual([0, 1, 2]);
      expect(notes().map(note => note.laneBeats)).toEqual([1, 1, 1]);
    });

    /** A column stops where the next note begins, whatever its own note does. */
    it('cuts a column off at the next note start', () => {
      const id = build();
      place(id, [
        { midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 },
        { midi: 64, startBeat: 1, lengthBeats: 1, velocity: 80 }
      ]);

      const built = notes();
      expect(built[0].laneBeat).toBe(0);
      expect(built[0].laneBeats).toBe(1);
      expect(built[1].laneBeat).toBe(1);
    });

    /**
     * And never covers a beat the note it edits is not sounding on, which is
     * why a group's span stops at its *shortest* note rather than its longest.
     */
    it('keeps every column inside the note it belongs to', () => {
      const id = build();
      place(id, [
        { midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 },
        { midi: 64, startBeat: 0, lengthBeats: 1, velocity: 80 }
      ]);

      for (const note of notes()) {
        expect(note.laneBeat).toBeGreaterThanOrEqual(note.startBeat);
        expect(note.laneBeat + note.laneBeats).toBeLessThanOrEqual(
          note.startBeat + note.lengthBeats
        );
      }
    });

    /** A lone note has the span it always had: its own, up to the next start. */
    it('gives a note that starts alone the whole of its own span', () => {
      const id = build();
      place(id, [{ midi: 60, startBeat: 1, lengthBeats: 2, velocity: 80 }]);

      const built = notes();
      expect(built[0].laneBeat).toBe(1);
      expect(built[0].laneBeats).toBe(2);
    });

    it('draws nothing for a slot with no notes', () => {
      const id = build();
      place(id, []);
      expect(notes()).toEqual([]);
    });
  });

  /**
   * A note is named by its degree's letter, and numbered by that letter's
   * octave rather than by its pitch's.
   *
   * F locrian is the key where the two part company. It is F G♭ A♭ B♭ C♭ D♭ E♭,
   * so its fifth degree is a **C flat** - the letter four steps above F - which
   * sounds a semitone below C. MIDI 71 is therefore `Cb5`, not the `B4` the
   * chromatic tables printed, and not the `Cb4` that numbering the octave by
   * the pitch would give: a C flat written a whole octave below the C it is a
   * flattened form of. `scientificOctave` undoes the accidental first, which is
   * why it takes the spelling and not just the number.
   *
   * The key leans **sharp** here - `keySignatureKind` reads F locrian off the
   * six-sharp wedge - which is the point. The letter is the degree's and not
   * the preference's, so even a sharp-preferring key writes this note flat.
   *
   * What is left here is the *number* beside the letter, which is the view's:
   * which letter a pitch class gets is `slotSpeller`'s, and it is pinned in
   * `progression-spelling.spec.ts` since the score reads the same rule. The two
   * chord-tone cases that used to sit below moved there with it.
   */
  describe('the letters a note is named by', () => {
    it('names a C flat in F locrian, in the octave its letter is in', () => {
      progression.setKey(5, 'locrian');
      const id = build();
      place(id, [{ midi: 71, startBeat: 0, lengthBeats: 4, velocity: 80 }]);

      expect(notes()[0].name).toBe('Cb5');
    });

    /** A note the scale does not contain has no degree, so the key answers. */
    it('leaves a note outside the scale to the key', () => {
      progression.setKey(5, 'locrian');
      const id = build();
      place(id, [{ midi: 60, startBeat: 0, lengthBeats: 4, velocity: 80 }]);

      expect(notes()[0].name).toBe('C4');
    });
  });

  /**
   * Whether Reset to chord can act, and what it says when it cannot.
   *
   * **This is the pair that drifted, and it drifted unnoticed for two tasks.**
   * `canReset` went on asking `harmony.kind === 'degree'` after M3 Task 8 gave
   * literal harmony the degree it degraded from and taught the service to
   * rebuild from it, so the button was greyed out on exactly the slots the
   * escape hatch had been reopened for - the one way out of `No chord matches`,
   * closed. Task 10 fixed it and specced nothing here, which is how it would
   * drift again: `describeReset` now encodes three refusals and has to stay in
   * step with `resetSlotToChord`'s three, and neither file's tests could see the
   * other's.
   *
   * So all five reachable answers are pinned, on real service states - the
   * refusals **by their sentence** and not only by the boolean, because the
   * sentence is the whole of what a focusable unavailable button is for. A
   * refusal that stopped saying why would pass a `canReset` check and leave the
   * user with a control that declines in silence.
   */
  describe('the way back to a chord', () => {
    function reset(): { canReset: boolean; resetReason: string | null } {
      const view = buildRollView(currentState());
      return { canReset: view.canReset, resetReason: view.resetReason };
    }

    /**
     * Turns the only slot literal, keeping its degree or dropping it.
     *
     * Written through `replaceDocument` for the `null` case, which is the one no
     * edit can reach: the recogniser always records the degree it degraded from,
     * so a literal slot with nothing to go back to is a document from elsewhere.
     * The other case is written the same way to keep the two comparable.
     */
    function goLiteral(keepDegree: boolean): void {
      build();
      const doc = currentState().doc;
      const slot = doc.slots[0];
      const from = keepDegree && slot.harmony.kind === 'degree' ? slot.harmony.degree : null;

      progression.replaceDocument({
        ...doc,
        slots: [{ ...slot, harmony: { kind: 'literal', reason: 'unrecognised', from } }]
      });
    }

    it('offers the way back to a slot that has a degree', () => {
      build();

      expect(reset()).toEqual({ canReset: true, resetReason: null });
    });

    /** The regression. A literal slot keeps a degree, so it keeps a way back. */
    it('offers it to a literal slot that kept the degree it degraded from', () => {
      goLiteral(true);

      expect(reset()).toEqual({ canReset: true, resetReason: null });
    });

    it('refuses a literal slot that never had one, and says which', () => {
      goLiteral(false);

      expect(reset()).toEqual({
        canReset: false,
        resetReason: 'These notes were never a chord in this app, so there is none to go back to.'
      });
    });

    it('refuses when nothing is selected, and says which', () => {
      build();
      progression.selectSlot(null);

      expect(reset()).toEqual({
        canReset: false,
        resetReason: 'Pick a chord on the strip first.'
      });
    });

    /** The slot is untouched; it is the key that has stopped being able to say. */
    it('refuses in a key that cannot stack thirds, and says which', () => {
      build();
      progression.setKey(0, 'majorPentatonic');

      expect(reset()).toEqual({
        canReset: false,
        resetReason: 'This key cannot build chords, so there is no chord to go back to.'
      });
    });

    /**
     * `from` absent rather than null, which is the shape a document parsed from
     * a file has at runtime whatever `SlotHarmony` says - `progression.model.ts`
     * tells readers to write `?? null` for exactly this and names the reason.
     *
     * This predicate did not, where `resetSlotToChord` did, and that one missing
     * coalesce is the whole difference between the two: the button came up live
     * with no reason on a slot the service would silently refuse. Nothing
     * reaches the store in this shape today - `settle` fills the field - so the
     * state is built by hand rather than through `replaceDocument`, which would
     * normalise the case away before the view ever saw it.
     */
    it('refuses a slot whose degree is absent rather than null', () => {
      build();
      const state = currentState();
      const slot = state.doc.slots[0];
      const view = buildRollView({
        ...state,
        doc: {
          ...state.doc,
          slots: [{ ...slot, harmony: { kind: 'literal', reason: 'unrecognised', from: undefined } }]
        }
      });

      expect({ canReset: view.canReset, resetReason: view.resetReason }).toEqual({
        canReset: false,
        resetReason: 'These notes were never a chord in this app, so there is none to go back to.'
      });
    });
  });
});
