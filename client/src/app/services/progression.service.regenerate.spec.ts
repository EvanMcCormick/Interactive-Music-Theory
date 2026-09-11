import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { DEFAULT_VELOCITY, createOwnership } from '../models/progression-normalize';
import {
  ChordSlot,
  ProgressionKey,
  ProgressionState,
  RollNote,
  SlotOwnership,
  createDegreeSlot
} from '../models/progression.model';
import { regenerateSlot } from './progression-edit';

/**
 * What survives a regeneration: the question a key change asks of every slot at
 * once, and a harmony command asks of one.
 *
 * Per-aspect ownership is the subject. A slot whose pitches, timing or velocity
 * the user has claimed is a slot the generator may no longer overwrite in that
 * dimension, so every regeneration is a merge rather than a rebuild - and the
 * merge has to be right in both directions, because keeping too much is a slot
 * that stops following its key and keeping too little is a hand edit thrown
 * away without a word.
 *
 * The two describes are the same mechanism from the two ends. `regenerateSlot`
 * is called directly below to pin the transposition arithmetic on a slot built
 * by hand; everything else drives the service and asks what the document holds
 * afterwards, which is the only way to see a lap of the circle arrive home.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was 3292 lines against the project's 1000-line cap, and this is one
 * of five topic-named files carved out of it - at 556 lines the single largest
 * block in it. The parent's header lists them all and says what stayed.
 *
 * Two siblings hold the rest of what a key change does.
 * `progression.service.rekey.spec.ts` is what it does to a slot's *label*,
 * which is a separate question from what it does to the notes and was a
 * separate bug; `setKey` itself, and the interval it hands the regeneration,
 * stayed in the parent with the document's other fields.
 */
describe('ProgressionService: what survives a regeneration', () => {
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
   * Regeneration is a **merge** and not a replace, which is the idea M2 turns
   * on. `SlotOwnership` says which of a slot's three dimensions are the user's,
   * and each is answered separately:
   *
   * | dimension | owned | not owned |
   * |---|---|---|
   * | pitches | transposed by the interval | re-voiced from the degree |
   * | timing | kept | regenerated as a block |
   * | velocity | kept | reset to `DEFAULT_VELOCITY` |
   *
   * `setKey` is the driver here because it is the one path that regenerates
   * every slot, and `replaceDocument` is how ownership is installed: it writes
   * the field without going near the setters that normally claim it, so a slot
   * can be put into any of the eight states in one line.
   *
   * The interval those transpositions use is `keyTransposeInterval`, tabulated
   * on its own further down; the parameter it feeds is exercised there too,
   * directly, without `setKey`'s help.
   */
  describe('regenerating a slot the user owns part of', () => {
    /**
     * Three notes with distinct pitch, timing and velocity, so that a merge
     * which dropped or confused any one dimension is visible rather than hidden
     * behind two that happen to agree.
     *
     * The shape is **nobody's triad** - a semitone and then a fifth - and that
     * matters now that a claimed voicing is re-anchored onto the chord it
     * belongs to. A C-E flat-G held over A minor lands on 69-72-76 once
     * anchored, which is A minor's own I to the note, so a spec asserting
     * "moved, not re-voiced" with a real triad would pass whichever of the two
     * had happened. This shape can only have been moved.
     *
     * Its lowest note is middle C, which is where a I in C major is voiced
     * from, so the voicing starts sitting exactly on its chord: the anchor has
     * no octave to reclaim, and every expectation below is the transposition
     * plus whatever the anchor adds and not an artefact of a fixture that began
     * out of position.
     *
     * Built per call: the specs below compare against it, and a shared array of
     * shared objects would let one of them edit the yardstick.
     */
    function handEdited(): RollNote[] {
      return [
        { midi: 60, startBeat: 0, lengthBeats: 0.5, velocity: 40 },
        { midi: 61, startBeat: 1.5, lengthBeats: 0.25, velocity: 100 },
        { midi: 67, startBeat: 3, lengthBeats: 1, velocity: 20 }
      ];
    }

    /** A I in C major holding `notes` and owning `owned`. Its id. */
    function claim(owned: Partial<SlotOwnership>, notes: RollNote[]): string {
      service.appendSlot(0);
      const doc = currentState().doc;
      const claimed: ChordSlot = {
        ...doc.slots[0],
        notes,
        owned: { ...createOwnership(), ...owned }
      };
      service.replaceDocument({ ...doc, slots: [claimed] });
      return claimed.id;
    }

    function notes(): RollNote[] {
      return slots()[0].notes;
    }

    /**
     * What the slot would sound if it owned nothing: the chord the key builds,
     * in the register the key builds it in.
     *
     * The anchor's expectations are relative to this rather than to a written-
     * out number, because that is the claim being made - a claimed voicing sits
     * where its chord sits - and a hand-copied table of twelve generated basses
     * would be pinning `voiceChord`'s arithmetic a second time in the wrong
     * file.
     */
    function revoiced(): number[] {
      const state = currentState();
      const slot = state.doc.slots[0];
      const generated = regenerateSlot(
        { ...slot, owned: createOwnership() },
        state.doc.key,
        state.keyScale?.intervals ?? null
      );
      return generated.notes.map(note => note.midi);
    }

    // I in C major is C-E-G; the same degree in A minor is A-C-E.
    const RE_VOICED = [69, 72, 76];

    it('replaces every dimension of a slot that owns nothing', () => {
      claim({}, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes()).toEqual([
        { midi: 69, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 72, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 76, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }
      ]);
    });

    it('keeps the timing of a slot that owns it while the pitches re-voice', () => {
      claim({ timing: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      // Velocity was not claimed, so it is not kept.
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    /**
     * The pitch row's "owned" column, which is the case the whole merge is
     * argued from.
     *
     * A claimed voicing is not re-voiced; it is **moved**, and its shape comes
     * through untouched. `setKey` computes the interval, being the only caller
     * that sees both keys, and `anchoredShift` then settles which octave the
     * moved voicing lands in - see below, and the function's own docstring for
     * why the interval alone could not be trusted with that.
     */
    it('transposes the pitches of a slot that owns them into the new key', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');

      // A semitone and then a fifth, exactly as the user stacked them, where A
      // minor's own I would be the [69, 72, 76] every unclaimed slot gets.
      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      // Neither of the other two was claimed, so the block returns.
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    /**
     * Which octave a moved voicing lands in is the **anchor's** answer and not
     * the interval's.
     *
     * `keyTransposeInterval` reads C to A as -3 rather than +9, and on its own
     * that would have put this voicing at 57-58-64, three semitones below where
     * the user left it, while every unclaimed slot in the progression went up
     * to A minor's own register at 69. The anchor puts the claimed voicing back
     * on its chord - the same offset from it as before, which here is none -
     * so the whole progression moves together.
     *
     * The octave of the interval is therefore not observable in what a slot
     * sounds: only its pitch class is. That is what closes the cycles below.
     */
    it('lands a moved voicing on the chord it was sitting on', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');

      const chord = revoiced();
      expect(Math.min(...notes().map(note => note.midi))).toBe(Math.min(...chord));
    });

    it('keeps the offset a voicing was written at, rather than flattening it', () => {
      // The same shape parked a fourth below its chord. The anchor moves in
      // whole octaves only, so the fourth survives the key change intact.
      claim(
        { pitches: true },
        handEdited().map(note => ({ ...note, midi: note.midi - 5 }))
      );
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([64, 65, 71]);
    });

    /**
     * A key change and its inverse cancel, which they did before the anchor
     * too - `keyTransposeInterval` is antisymmetric, so a pair was always the
     * easy case. The laps below are the ones that were not.
     */
    it('puts a claimed voicing back when the key comes back', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(9, 'aeolian');
      service.setKey(0, 'ionian');

      expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
    });

    /**
     * A lap of the circle of fifths, both ways round, and a lap in major
     * thirds. None of the three is a pair, and that is the whole point: the
     * antisymmetry of `keyTransposeInterval` bounds a 2-cycle and constrains no
     * longer route at all, so before `anchoredShift` each of these walked.
     *
     * Twelve clockwise fifths were twelve moves of -5 and took this voicing
     * from 60 to 0; twelve anticlockwise took it to 120; C-E-G sharp-C gained
     * an octave a lap, for ever. `frequencyOf` would have sounded the first two
     * at 8 Hz and 790 kHz.
     *
     * The fix is not a bound but a **shape**: the answer is a function of the
     * key arrived in rather than of the route taken to it, so every cycle
     * closes by construction and these three are witnesses rather than the
     * whole of the guarantee.
     */
    describe('a lap of the circle', () => {
      /** Walks `tonics` in order, in the mode the progression starts in. */
      function walk(tonics: readonly number[]): void {
        for (const tonic of tonics) service.setKey(tonic, 'ionian');
      }

      /** The twelve keys a repeated step of `semitones` visits, ending home. */
      function lap(semitones: number): number[] {
        return Array.from({ length: 12 }, (_, step) => ((step + 1) * semitones) % 12);
      }

      it('comes home from twelve fifths clockwise', () => {
        claim({ pitches: true }, handEdited());
        walk(lap(7));

        expect(currentState().doc.key.tonic).toBe(0);
        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('comes home from twelve fifths anticlockwise', () => {
        claim({ pitches: true }, handEdited());
        walk(lap(5));

        expect(currentState().doc.key.tonic).toBe(0);
        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('comes home from a lap in major thirds', () => {
        // C to E to G sharp and home: three moves of +4, each of them the
        // nearest reading of its pitch class, and each of them upward. No
        // pairwise property can cancel a lap of three.
        claim({ pitches: true }, handEdited());
        walk([4, 8, 0]);

        expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
      });

      it('stays in earshot part-way round', () => {
        // Not only at the ends: five clicks clockwise used to leave this
        // voicing at 35, and twenty-five at -65. The anchor holds every step
        // inside a tritone of the chord the key generates.
        claim({ pitches: true }, handEdited());

        for (let step = 1; step <= 25; step++) {
          service.setKey((step * 7) % 12, 'ionian');

          const lowest = Math.min(...notes().map(note => note.midi));
          expect(Math.abs(lowest - Math.min(...revoiced()))).toBeLessThanOrEqual(6);
        }
      });
    });

    it('moves a claimed voicing by nothing when only the mode changes', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(0, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([60, 61, 67]);
    });

    /**
     * The tonic is wrapped on the way into the document, and the interval is
     * measured from the value that is *stored* rather than the one that
     * arrived. 21 is A an octave up, and a delta taken from it is +21.
     *
     * **The pitches no longer witness that**, and it is worth saying why rather
     * than leaving the assertion looking sharper than it is: `anchoredShift`
     * takes whole octaves off the moved voicing, so +21 and -3 land on the same
     * three notes. Only the pitch class of the interval is observable now,
     * which is precisely the property that closes the laps above. What is left
     * to assert is the tonic the document stores - the chord is generated from
     * that, so an unwrapped one would still be wrong here - and the pitches, as
     * a regression guard over the whole path rather than over the interval.
     */
    it('measures the interval from the tonic it stores', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(21, 'aeolian');

      expect(currentState().doc.key.tonic).toBe(9);
      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
    });

    /**
     * And the tritone, which used to be the one interval whose *direction* an
     * unwrapped tonic could flip: `keyTransposeInterval`'s tie-break reads the
     * two tonics themselves, so -6 and the 6 it is stored as point the move in
     * opposite directions. That flip cost an octave a round trip, and the
     * anchor now absorbs it along with every other whole-octave difference.
     *
     * Kept for the tonic, and because a spelling that arrives as a negative is
     * a real thing for the circle of fifths to send.
     */
    it('measures the tritone from the tonic it stores too', () => {
      claim({ pitches: true }, handEdited());
      service.setKey(-6, 'ionian');

      expect(currentState().doc.key.tonic).toBe(6);
      expect(notes().map(note => note.midi)).toEqual([66, 67, 73]);
    });

    it('keeps the velocities of a slot that owns them while the rest regenerates', () => {
      claim({ velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    // The case the design doc argues the whole mechanism from: a groove written
    // in C survives the switch to A minor while the chord re-voices under it.
    it('keeps a groove while the chord under it re-voices', () => {
      claim({ timing: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
    });

    /**
     * The other two pairs, which had no spec of their own.
     *
     * `mergeNotes` answers each dimension from its own branch and has no
     * combination branch at all, so a pair carries little risk - but "no
     * combination branch" is a fact about today's implementation rather than
     * part of the contract, and six of eight subsets covered is a gap that
     * reads as an oversight. With these two, all eight are stated.
     */
    it('keeps owned pitches and owned timing together', () => {
      claim({ pitches: true, timing: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1]);
      // Velocity is the one dimension not claimed here.
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    it('keeps owned pitches and owned velocities together', () => {
      claim({ pitches: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76]);
      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20]);
      // Timing is the one dimension not claimed here, so the block returns.
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    /**
     * A slot that owns all three keeps everything it wrote and follows the key
     * with it. The pitches move because moving them is what owning them means
     * across a transposition; nothing else about the notes changes at all.
     */
    it('moves a slot that owns all three, and changes nothing else about it', () => {
      claim({ pitches: true, timing: true, velocity: true }, handEdited());
      service.setKey(9, 'aeolian');

      expect(notes()).toEqual(
        handEdited().map(note => ({ ...note, midi: note.midi + 9 }))
      );
    });

    /**
     * Pitches decide how many notes there are, because a note is a pitch: a
     * user who added two owns the count, and the three-note triad the key
     * offers has nothing to say at indices 3 and 4.
     *
     * The two dimensions that were *not* claimed still have to be answered
     * there, and the answer is the block the generator would have written - not
     * `undefined`, which would reach Tone as a schedule time and a duration by
     * the road the model's first clause exists to close.
     */
    it('regenerates the unowned dimensions of notes the chord cannot reach', () => {
      claim({ pitches: true }, [
        ...handEdited(),
        { midi: 70, startBeat: 2, lengthBeats: 2, velocity: 55 },
        { midi: 74, startBeat: 2.5, lengthBeats: 2, velocity: 55 }
      ]);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual([69, 70, 76, 79, 83]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4, 4, 4]);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80, 80, 80]);
    });

    /**
     * And the other way round: a chord that grows past the notes the user owns.
     * A complexity step turns a triad into a seventh, so there is a fourth note
     * with no claimed counterpart at its index.
     *
     * It joins the last note the user placed rather than being given a block of
     * its own. A chord tone added under a hand-written rhythm belongs to the
     * event that rhythm ends on; a note springing back to the slot's start and
     * full length would be the one voice ignoring the groove.
     */
    it('gives a note the chord grew past the timing of the last one owned', () => {
      const id = claim({ timing: true }, handEdited());
      service.stepSlotExtent(id, 1);

      expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71]);
      expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3, 3]);
      expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1, 1]);
    });

    it('gives a note the chord grew past the velocity of the last one owned', () => {
      const id = claim({ velocity: true }, handEdited());
      service.stepSlotExtent(id, 1);

      expect(notes().map(note => note.velocity)).toEqual([40, 100, 20, 20]);
    });

    /**
     * An empty note list under a claim is not something the app writes, and
     * `replaceDocument` is the door that lets one in. It has to be answered
     * with the default rather than with `undefined`, for the reason above.
     */
    it('falls back to the default velocity when there is nothing owned to keep', () => {
      claim({ velocity: true }, []);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.midi)).toEqual(RE_VOICED);
      expect(notes().map(note => note.velocity)).toEqual([80, 80, 80]);
    });

    it('falls back to the regenerated timing when there is nothing owned to keep', () => {
      claim({ timing: true }, []);
      service.setKey(9, 'aeolian');

      expect(notes().map(note => note.startBeat)).toEqual([0, 0, 0]);
      expect(notes().map(note => note.lengthBeats)).toEqual([4, 4, 4]);
    });

    /**
     * The four commands that restate the chord take the pitches back.
     *
     * Without this they collide with a claim over `pitches`, and the collision
     * is not a near miss: a complexity step stores `extent: 7`, so
     * `effectiveQuality` prints `Imaj7` on the card while `mergeNotes` hands
     * back the three pitches the user was holding. One press, no audible
     * change, and the label now disagrees with the synth - which is the exact
     * failure `effectiveQuality`'s docstring is built to prevent.
     *
     * A key change is the other half of the rule and reclaims nothing, because
     * it restates no chord: keeping a voicing across a transposition is what
     * the merge is for.
     */
    describe('a harmony command reclaiming the pitches', () => {
      /**
       * All four, and what each re-voices a claimed I in C major to. Listed
       * rather than written out one `it` at a time so that "all four" is
       * visible: a fifth command routed through `editDegree` should arrive here
       * as a row rather than be left to be noticed.
       */
      const COMMANDS: readonly {
        name: string;
        run: (id: string) => void;
        revoiced: number[];
      }[] = [
        {
          name: 'setSlotExtent',
          run: id => service.setSlotExtent(id, 7),
          revoiced: [60, 64, 67, 71]
        },
        {
          name: 'stepSlotExtent',
          run: id => service.stepSlotExtent(id, 1),
          revoiced: [60, 64, 67, 71]
        },
        {
          name: 'setSlotInversion',
          run: id => service.setSlotInversion(id, 1),
          revoiced: [64, 67, 72]
        },
        {
          name: 'setSlotOctave',
          run: id => service.setSlotOctave(id, 1),
          revoiced: [72, 76, 79]
        }
      ];

      function owned(): SlotOwnership {
        return slots()[0].owned;
      }

      for (const command of COMMANDS) {
        it(`${command.name} re-voices a claimed slot rather than mislabelling it`, () => {
          const id = claim({ pitches: true }, handEdited());
          command.run(id);

          expect(notes().map(note => note.midi)).toEqual(command.revoiced);
          expect(owned().pitches).toBeFalse();
        });
      }

      /**
       * The reclaim is narrow. A complexity step restates the chord and not the
       * groove, so the rhythm and the dynamics the user wrote come through it -
       * the fourth note the seventh adds joins the last onset, which is
       * `noteAt`'s clamp.
       */
      it('keeps the rhythm and the dynamics it did not restate', () => {
        const id = claim({ pitches: true, timing: true, velocity: true }, handEdited());
        service.stepSlotExtent(id, 1);

        expect(notes().map(note => note.midi)).toEqual([60, 64, 67, 71]);
        expect(notes().map(note => note.startBeat)).toEqual([0, 1.5, 3, 3]);
        expect(notes().map(note => note.lengthBeats)).toEqual([0.5, 0.25, 1, 1]);
        expect(notes().map(note => note.velocity)).toEqual([40, 100, 20, 20]);
        expect(owned()).toEqual({ pitches: false, timing: true, velocity: true });
      });

      /**
       * Which is what makes taking the pitches back the safe answer rather than
       * a destructive one: the user who did not mean it is one keystroke from
       * having them, where a stepper that silently refused to move would leave
       * them no way to find out why.
       */
      it('is undone by undo, claim and all', () => {
        const id = claim({ pitches: true }, handEdited());
        service.stepSlotExtent(id, 1);
        service.undo();

        expect(notes()).toEqual(handEdited());
        expect(owned().pitches).toBeTrue();
      });

      /**
       * The reclaim rides on the commit, so a command that is refused as a
       * no-op reclaims nothing. A stepper resting on its limit is a normal
       * thing to press repeatedly, and pressing it must not cost a claim.
       */
      it('reclaims nothing when the command changes nothing', () => {
        const id = claim({ pitches: true }, handEdited());
        service.stepSlotExtent(id, -1);

        expect(owned().pitches).toBeTrue();
        expect(notes()).toEqual(handEdited());
      });

      /**
       * The other half of the rule, asserted so that moving the reclaim down
       * into `regenerateSlot` - where it would catch every path - fails here
       * rather than quietly undoing the merge's whole purpose.
       */
      it('is not something a key change does', () => {
        claim({ pitches: true }, handEdited());
        service.setKey(9, 'aeolian');

        expect(owned().pitches).toBeTrue();
      });
    });
  });

  /**
   * The transposition half of the merge, exercised directly.
   *
   * "Transpose by the interval" needs the *old* key, which `regenerateSlot`
   * cannot see, so the delta is an explicit parameter rather than something it
   * infers. `setKey` is the only caller that can compute one and does not pass
   * it until Task 5, so every other call site passes 0 - which means no setter
   * reaches this branch yet, and a rule with no test is a rule someone deletes.
   *
   * The interval is half the answer. `anchoredShift` is the other half: it
   * takes whole octaves off the moved voicing until it sits on the chord the
   * new key generates, which is what stops the stored pitch being a running sum
   * over every key change the document has ever seen. The last two specs here
   * are that half on its own, where the drift can be arranged rather than
   * accumulated.
   */
  describe('the interval a regeneration transposes by', () => {
    const C_MAJOR: ProgressionKey = { tonic: 0, scaleId: 'ionian', preferSharps: true };
    const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

    /** Pitches that are nobody's idea of a C major triad, so a re-voice shows. */
    function held(): RollNote[] {
      return [
        { midi: 61, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 65, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY },
        { midi: 68, startBeat: 0, lengthBeats: 4, velocity: DEFAULT_VELOCITY }
      ];
    }

    function owning(owned: Partial<SlotOwnership>): ChordSlot {
      return {
        ...createDegreeSlot(0, 0),
        notes: held(),
        owned: { ...createOwnership(), ...owned }
      };
    }

    it('moves owned pitches by it', () => {
      const merged = regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, -3);
      expect(merged.notes.map(note => note.midi)).toEqual([58, 62, 65]);
    });

    it('leaves unowned pitches to be re-voiced, whatever the interval', () => {
      const merged = regenerateSlot(owning({}), C_MAJOR, MAJOR, -3);
      expect(merged.notes.map(note => note.midi)).toEqual([60, 64, 67]);
    });

    it('moves nothing when it is not given', () => {
      const merged = regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR);
      expect(merged.notes.map(note => note.midi)).toEqual([61, 65, 68]);
    });

    /**
     * The anchor, on its own, away from `setKey`'s arithmetic.
     *
     * A I in C major is voiced from middle C, so a claimed voicing two octaves
     * under it is 24 semitones out of position. Whatever interval it is
     * transposed by, the result lands within a tritone of 60: the octaves are
     * taken off the sum rather than added to it, which is the whole of the fix.
     */
    it('takes whole octaves off a voicing that has drifted from its chord', () => {
      const strayed: ChordSlot = {
        ...owning({ pitches: true }),
        notes: held().map(note => ({ ...note, midi: note.midi - 24 }))
      };

      const merged = regenerateSlot(strayed, C_MAJOR, MAJOR, -3);

      // The shape - a fourth and then a minor third - is untouched; only the
      // register moved, and it moved in twelves.
      expect(merged.notes.map(note => note.midi)).toEqual([58, 62, 65]);
    });

    /**
     * And the anchor is measured against the **chord**, not against a fixed
     * register.
     *
     * `voiceChord` stacks from a floor, so where a chord sits depends on which
     * chord it is: a I in C major is voiced from middle C and a vii - B-D-F -
     * from the B eleven semitones above it. A voicing written on that vii is
     * eleven clear of the base and is not out of position at all, and an anchor
     * that measured from the base rather than from the chord would haul it down
     * an octave the first time the key moved.
     */
    it('anchors to the chord the slot builds, not to the voicing base', () => {
      const leadingTone: ChordSlot = {
        ...createDegreeSlot(6, 0),
        notes: [71, 74, 78].map(midi => ({
          midi,
          startBeat: 0,
          lengthBeats: 4,
          velocity: DEFAULT_VELOCITY
        })),
        owned: { ...createOwnership(), pitches: true }
      };

      const merged = regenerateSlot(leadingTone, C_MAJOR, MAJOR);

      // B-D-F sharp against the key's B-D-F: the top note is the user's, and
      // nothing has been moved by an octave to bring it nearer middle C.
      expect(merged.notes.map(note => note.midi)).toEqual([71, 74, 78]);
    });

    /**
     * `RollNote.midi` reaches `Tone.PolySynth` with nothing between here and
     * there that looks at it again, and this parameter is added straight to it.
     * A value of the wrong kind is the first clause of the model's rule, and it
     * throws where it was introduced rather than three layers downstream.
     */
    it('refuses an interval that is not a whole number of semitones', () => {
      expect(() => regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, Number.NaN))
        .toThrowError(/transpose/i);
      expect(() => regenerateSlot(owning({ pitches: true }), C_MAJOR, MAJOR, 0.5))
        .toThrowError(/transpose/i);
      // Refused whether or not this particular slot would have used it: the
      // caller passing one is the bug, not the slot that happens to receive it.
      expect(() => regenerateSlot(owning({}), C_MAJOR, MAJOR, Number.NaN))
        .toThrowError(/transpose/i);
    });
  });
});
