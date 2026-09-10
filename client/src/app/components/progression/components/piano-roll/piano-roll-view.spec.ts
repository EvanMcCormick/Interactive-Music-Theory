import { TestBed } from '@angular/core/testing';

import { RollNote } from '../../../../models/progression.model';
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

    /**
     * A chord tone is written on the letter its place in the *chord* names,
     * which is a finer answer than the scale's and sometimes a different one.
     *
     * `♭VI` in C major is A♭ C E♭. Neither the A♭ nor the E♭ is in C major, so
     * the scale has no degree for either and would fall back to the key's
     * preference - which for C major is sharps, giving `G♯` and `D♯` under a
     * numeral that says flat six. Read off the chord they are a root, a third
     * and a fifth: A, C and E, one letter apart in the usual way, flattened to
     * land on the pitches.
     */
    it('spells a chord tone from the chord rather than from the scale', () => {
      const id = build();
      progression.setSlotChord(id, { degree: 5, alter: -1, quality: 'major', extent: 3 });

      expect(notes().map(note => note.name.slice(0, -1))).toEqual(['Ab', 'C', 'Eb']);
    });

    /**
     * And a note that is not a chord tone still falls through to the scale, so
     * the upgrade is an addition rather than a replacement.
     */
    it('leaves a note that is not a chord tone to the scale', () => {
      const id = build();
      progression.setSlotChord(id, { degree: 5, alter: -1, quality: 'major', extent: 3 });
      place(id, [{ midi: 62, startBeat: 0, lengthBeats: 4, velocity: 80 }]);

      expect(notes()[0].name).toBe('D4');
    });
  });
});
