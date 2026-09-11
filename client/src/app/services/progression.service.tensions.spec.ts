import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ChordDegree, ChordSlot, ProgressionState } from '../models/progression.model';

/**
 * The two setters M3 Task 6 added: the suspension, and one extension's
 * alteration.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3273 lines, three times the project's 1000-line cap, and it was
 * the one piece of that debt this task could decline to add to. The cap is a
 * rule about every file this milestone touches, so a task that grows a file
 * already past it has chosen to grow it - and there is nothing in these two
 * setters that has to sit beside the contiguity invariant and the undo
 * mechanism to be read. The seam is the same one the palette's spec was split
 * on and the same one `progression-vocabulary.spelling.spec.ts` set: a second
 * topic-named spec, its own local fixtures, the two cross-referencing.
 *
 * The end of M3 split that file five ways on the same argument, so the two
 * things named above are no longer even in it: the contiguity invariant is in
 * `progression.service.timeline.spec.ts` and the undo mechanism stayed with the
 * document in the parent. The nearest neighbour of what is here is
 * `progression.service.degrees.spec.ts`, which holds the rest of the commands
 * that write a slot's degree.
 *
 * ## The fixtures are local, and one word of that argument was wrong
 *
 * The case for copying a fixture block rather than extracting a helper module
 * is that the block is *this pair's*: `append`, `degreeOf`, `pitchClassesOf`
 * and `expectNoCommit` below are read by these tests and by nothing else in the
 * project, so a shared module would serve two files and save no third one a
 * line. That holds, and it is why the decision stands.
 *
 * It does not hold of the two generic helpers a spec like this opens with, and
 * the argument as first written was not careful to exclude them. `currentState`
 * is independently defined in **15** spec files across the repo and `settle` in
 * **9** - counted at the commit that added this paragraph, this file's own copy
 * of the first included, and both were already well into double figures when
 * the sentence was written. Neither is a fixture of any topic; they are the
 * shape of "read the current published state" and "run change detection",
 * written out wherever a spec needs one. (`progression-edit.ts` has a `settle`
 * too, and it is a different thing entirely - production code, not a helper.)
 *
 * One more copy of a fifteen-copy idiom is not a new precedent, and the harness
 * that would fix it is a repo-wide change rather than this file's - so nothing
 * here moves. What is corrected is the claim: the argument above is about the
 * topic's fixtures, and it was never true of these two.
 *
 * ## What is deliberately *not* re-tested here
 *
 * Both setters go through `editDegree` and neither restates a line of it, so
 * its behaviour is asserted once - that they reach it - rather than a fourth
 * and fifth time. The refusals, the no-op comparison and the pitch reclaim have
 * a spec each below and no more: `progression.service.degrees.spec.ts` already
 * sweeps every command that funnels through that method, and duplicating it
 * would test `editDegree` five ways and these two setters not at all.
 *
 * What is tested at length is the half that is theirs: **what the chord
 * sounds**. Every expectation below is a hand-worked chord, named in a comment,
 * checked against `music-theory-verification`'s tables before it was run.
 */
describe('ProgressionService: suspensions and tensions', () => {
  let service: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProgressionService);
  });

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    service.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function slot(id: string): ChordSlot {
    const found = currentState().doc.slots.find(candidate => candidate.id === id);
    if (!found) throw new Error(`no slot ${id}`);
    return found;
  }

  function degreeOf(id: string): ChordDegree {
    const harmony = slot(id).harmony;
    if (harmony.kind !== 'degree') throw new Error(`slot ${id} is literal`);
    return harmony.degree;
  }

  function midiOf(id: string): number[] {
    return slot(id).notes.map(note => note.midi);
  }

  /** Pitch classes, ascending and distinct, for the chords that cross an octave. */
  function pitchClassesOf(id: string): number[] {
    const classes = slot(id).notes.map(note => ((note.midi % 12) + 12) % 12);
    return [...new Set(classes)].sort((first, second) => first - second);
  }

  /** A fresh slot on `degree`, selected, and its id. */
  function append(degree: number): string {
    service.appendSlot(degree);
    const slots = currentState().doc.slots;
    return slots[slots.length - 1].id;
  }

  const appendI = () => append(0);
  const appendV = () => append(4);

  /** Asserts that `act` changed neither the document nor the history. */
  function expectNoCommit(act: () => void): void {
    const before = currentState();
    act();
    const after = currentState();
    expect(after.doc).toBe(before.doc);
    expect(after.canUndo).toBe(before.canUndo);
  }

  describe('setSlotSuspension', () => {
    /**
     * C E G becomes C F G. The third is replaced and the fifth is left, which
     * is what a suspension is; a chord *added* to would have four notes and
     * would put `noteCount(extent)` out of step with what is sounding.
     */
    it('replaces the third with the fourth', () => {
      const id = appendI();
      service.setSlotSuspension(id, 'sus4');

      expect(degreeOf(id).suspension).toBe('sus4');
      expect(midiOf(id)).toEqual([60, 65, 67]);
    });

    /** And with the second: C D G. */
    it('replaces the third with the second', () => {
      const id = appendI();
      service.setSlotSuspension(id, 'sus2');

      expect(midiOf(id)).toEqual([60, 62, 67]);
    });

    it('puts the third back', () => {
      const id = appendI();
      service.setSlotSuspension(id, 'sus4');
      service.setSlotSuspension(id, 'none');

      expect(midiOf(id)).toEqual([60, 64, 67]);
    });

    /**
     * The reclaim, inherited from `editDegree` rather than restated: a
     * suspension replaces a note, so a claim over the pitches the slot is
     * holding is a claim over notes the user has just asked to change. Without
     * it the card would read `Isus4` over a sounding E.
     */
    it('reclaims the pitches a hand edit had claimed', () => {
      const id = appendI();
      service.setSlotNotes(id, slot(id).notes);
      expect(slot(id).owned.pitches).toBeTrue();

      service.setSlotSuspension(id, 'sus4');

      expect(midiOf(id)).toEqual([60, 65, 67]);
      expect(slot(id).owned.pitches).toBeFalse();
    });

    it('records nothing for a suspension the slot already has', () => {
      const id = appendI();
      service.setSlotSuspension(id, 'sus4');

      expectNoCommit(() => service.setSlotSuspension(id, 'sus4'));
    });

    /**
     * The suspension replaces position 1 at every height, which is what makes
     * `7sus4` and `9sus4` fall out with no rule of their own. G7 is G B D F, so
     * G7sus4 is G C D F.
     */
    it('suspends a seventh without lowering it', () => {
      const id = appendV();
      service.setSlotExtent(id, 7);
      service.setSlotSuspension(id, 'sus4');

      expect(degreeOf(id).extent).toBe(7);
      expect(pitchClassesOf(id)).toEqual([0, 2, 5, 7]);
    });

    /**
     * The suspended fourth and the eleventh are one pitch class an octave
     * apart, and the fourth is doubled rather than dropped: the note count is
     * what `normalizeInversion` wraps against and what the complexity readout
     * prints. C11sus4 is C F G B D F - six notes, two of them F.
     */
    it('doubles the fourth under an eleventh rather than dropping one', () => {
      const id = appendI();
      service.setSlotExtent(id, 11);
      service.setSlotSuspension(id, 'sus4');

      expect(slot(id).notes.length).toBe(6);
      expect(pitchClassesOf(id)).toEqual([0, 2, 5, 7, 11]);
    });

    it('refuses in a key that can build no chords', () => {
      const id = appendI();
      service.setKey(0, 'majorPentatonic');

      expectNoCommit(() => service.setSlotSuspension(id, 'sus4'));
    });

    /**
     * An enumerated set, so a value outside it throws rather than being clamped
     * to something nearby: there is no nearest suspension. It throws out of the
     * normalisation before the commit, so nothing is published - the third
     * clause of `progression-normalize.ts`' rule.
     */
    it('throws on a suspension that is not one, and commits nothing', () => {
      const id = appendI();

      expectNoCommit(() => {
        expect(() =>
          service.setSlotSuspension(id, 'sus7' as unknown as 'sus4')
        ).toThrowError(/suspension/i);
      });
    });
  });

  describe('setSlotExtension', () => {
    /** The V of C major at a ninth: G B D F A, the key's own natural ninth. */
    it('leaves an unpinned ninth to the key', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);

      expect(degreeOf(id).extensions)
        .toEqual({ ninth: null, eleventh: null, thirteenth: null });
      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 9, 11]);
    });

    /** G7♭9 is G B D F A♭. */
    it('pins one extension and leaves the others to the key', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setSlotExtension(id, 'ninth', -1);

      expect(degreeOf(id).extensions)
        .toEqual({ ninth: -1, eleventh: null, thirteenth: null });
      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 8, 11]);
    });

    /**
     * `null` is "as the key gives it", so it is also how an extension is
     * un-pinned - the only way short of Reset to chord, which hands the whole
     * slot back.
     */
    it('hands an extension back to the key', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setSlotExtension(id, 'ninth', -1);
      service.setSlotExtension(id, 'ninth', null);

      expect(degreeOf(id).extensions.ninth).toBeNull();
      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 9, 11]);
    });

    /**
     * Imaj13♯11 in C major: C E G B D F♯ A. The eleventh is the only one moved,
     * so the ninth and thirteenth stay the key's own D and A.
     */
    it('sharpens the eleventh of a thirteenth chord', () => {
      const id = appendI();
      service.setSlotExtent(id, 13);
      service.setSlotExtension(id, 'eleventh', 1);

      expect(pitchClassesOf(id)).toEqual([0, 2, 4, 6, 7, 9, 11]);
    });

    /** And the flat thirteenth on its own: C E G B D F A♭. */
    it('flattens the thirteenth', () => {
      const id = appendI();
      service.setSlotExtent(id, 13);
      service.setSlotExtension(id, 'thirteenth', -1);

      expect(pitchClassesOf(id)).toEqual([0, 2, 4, 5, 7, 8, 11]);
    });

    /**
     * The chord the design doc records as unbuildable before this field
     * existed. `V/vi` in C major is an E7, and the key's own ninth above E is
     * an F - a flat ninth nobody asked for. An explicit natural ninth builds
     * the E9 that could not be built at all: E G♯ B D F♯.
     */
    it('builds a real E9 as V/vi in C major', () => {
      const id = appendI();
      service.setSlotChord(id, { degree: 2, alter: 0, quality: 'dominant7', extent: 9 });
      expect(pitchClassesOf(id)).toEqual([2, 4, 5, 8, 11]);

      service.setSlotExtension(id, 'ninth', 0);

      expect(pitchClassesOf(id)).toEqual([2, 4, 6, 8, 11]);
    });

    it('records nothing for an alteration the slot already has', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setSlotExtension(id, 'ninth', -1);

      expectNoCommit(() => service.setSlotExtension(id, 'ninth', -1));
    });

    /**
     * `extent` stays the single height control: a pin on an extension the stack
     * does not reach is stored and sounds nothing, rather than making a triad
     * five notes tall. It sounds the moment the stepper reaches it, which is
     * what makes storing it right rather than merely harmless.
     */
    it('stores a pin the extent does not reach, and sounds it when it does', () => {
      const id = appendV();
      service.setSlotExtension(id, 'ninth', -1);

      expect(degreeOf(id).extensions.ninth).toBe(-1);
      // G B D, unchanged: a triad has no ninth to pin.
      expect(pitchClassesOf(id)).toEqual([2, 7, 11]);

      service.setSlotExtent(id, 9);

      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 8, 11]);
    });

    it('reclaims the pitches a hand edit had claimed', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setSlotNotes(id, slot(id).notes);

      service.setSlotExtension(id, 'ninth', -1);

      expect(slot(id).owned.pitches).toBeFalse();
      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 8, 11]);
    });

    it('refuses in a key that can build no chords', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setKey(0, 'majorPentatonic');

      expectNoCommit(() => service.setSlotExtension(id, 'ninth', -1));
    });

    /**
     * The enumerated-set clause again, one field over. `♭11` and `♯13` are not
     * figures, so they are refused rather than clamped to the nearest one that
     * is.
     */
    it('throws on an alteration outside the extension`s own set', () => {
      const id = appendI();
      service.setSlotExtent(id, 13);

      expectNoCommit(() => {
        expect(() =>
          service.setSlotExtension(id, 'eleventh', -1 as unknown as 0)
        ).toThrowError(/eleventh/i);
      });
    });

    /**
     * Reset to chord hands the whole slot back, which includes both of these -
     * `unpinned` drops the suspension and all three alterations along with the
     * shape override, on the argument that all of them are the user saying
     * something the key did not.
     */
    it('is taken back by Reset to chord, along with the suspension', () => {
      const id = appendV();
      service.setSlotExtent(id, 9);
      service.setSlotSuspension(id, 'sus4');
      service.setSlotExtension(id, 'ninth', -1);

      service.resetSlotToChord(id);

      expect(degreeOf(id).suspension).toBe('none');
      expect(degreeOf(id).extensions)
        .toEqual({ ninth: null, eleventh: null, thirteenth: null });
      expect(pitchClassesOf(id)).toEqual([2, 5, 7, 9, 11]);
    });
  });
});
