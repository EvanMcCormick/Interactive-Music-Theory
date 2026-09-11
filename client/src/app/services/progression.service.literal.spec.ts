import { TestBed } from '@angular/core/testing';

import { ProgressionService } from './progression.service';
import { ChordDegree, ChordSlot, ProgressionState, SlotHarmony } from '../models/progression.model';
import { createOwnership } from '../models/progression-normalize';

/**
 * The way back from `literal`.
 *
 * Every command on this page refuses a slot with no numeral - `editDegree`
 * opens with that refusal, and `resetSlotToChord` used to - so a slot that lost
 * its label had no way back but undo, and undo is gone the moment the user does
 * anything else. That was tolerable while only a hand-written document could
 * make one. M3's recogniser makes them from ordinary edits, and M3 Task 8's key
 * change makes one wherever the new key cannot write an owned chord at all, so
 * `literal` has to lead out as well as in.
 *
 * `SlotHarmony.from` is what it leads out through: the degree the slot was
 * carrying when it lost its label, kept so Reset to chord can build a block
 * chord from it again - in whatever key the page has reached by then, which is
 * the half that makes it a real way back rather than a stored snapshot.
 *
 * ## Why this is not in `progression.service.spec.ts`
 *
 * That file was over three times the project's 1000-line cap, and M3 Task 6 set
 * the precedent for declining to grow it further: a second topic-named spec
 * with its own local fixtures, the two cross-referencing. What
 * `resetSlotToChord` does to a *degree* slot - the claims it drops, the pin it
 * takes back, the no-op comparison - is untouched here; this file is the
 * literal half only.
 *
 * The end of M3 split that file five ways on the same argument, and the degree
 * half now has a file of its own: `progression.service.reset.spec.ts`. The two
 * are the two halves of one command and are best read together.
 */
describe('ProgressionService: the way back from literal', () => {
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

  function harmonyOf(id: string): SlotHarmony {
    return slot(id).harmony;
  }

  function degreeOf(id: string): ChordDegree {
    const harmony = harmonyOf(id);
    if (harmony.kind !== 'degree') throw new Error(`slot ${id} is literal`);
    return harmony.degree;
  }

  function midiOf(id: string): number[] {
    return slot(id).notes.map(note => note.midi);
  }

  /** A fresh slot on `degree`, and its id. */
  function append(degree: number): string {
    service.appendSlot(degree);
    const slots = currentState().doc.slots;
    return slots[slots.length - 1].id;
  }

  /**
   * A literal slot holding `notes`, carrying `from`, and claiming everything.
   *
   * Written through `replaceDocument` rather than produced by an edit, because
   * the specs below are about what Reset does with the degree it finds and not
   * about how the slot came to be literal. The claims are all set so that
   * dropping them is observable.
   */
  function literalSlot(from: ChordDegree | null, notes: number[]): string {
    const id = append(0);
    const doc = currentState().doc;
    const built: ChordSlot = {
      ...doc.slots[0],
      harmony: { kind: 'literal', reason: 'unrecognised', from },
      notes: notes.map(midi => ({ midi, startBeat: 0, lengthBeats: 1, velocity: 100 })),
      owned: { pitches: true, timing: true, velocity: true }
    };
    service.replaceDocument({ ...doc, slots: [built] });
    return id;
  }

  /** A `ChordDegree` on `degree`, with `overrides` written over it. */
  function degreeFor(degree: number, overrides: Partial<ChordDegree> = {}): ChordDegree {
    const id = append(degree);
    const built = { ...degreeOf(id), ...overrides };
    service.undo();
    return built;
  }

  /** Asserts that `act` changed neither the document nor the history. */
  function expectNoCommit(act: () => void): void {
    const before = currentState();
    act();
    const after = currentState();
    expect(after.doc).toBe(before.doc);
    expect(after.canUndo).toBe(before.canUndo);
  }

  /**
   * The door. A `V` that lost its numeral comes back as the key's own `V`, as a
   * block, with every claim dropped - which is what Reset means everywhere else
   * on this page.
   */
  it('rebuilds a literal slot from the degree it kept', () => {
    const id = literalSlot(degreeFor(4), [61, 62, 63]);

    service.resetSlotToChord(id);

    expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: 4, quality: null }));
    expect(midiOf(id)).toEqual([67, 71, 74]);
    expect(slot(id).owned).toEqual(createOwnership());
  });

  /**
   * With no degree recorded there is nothing to go back to, and inventing one
   * would be the app guessing at a numeral - the one thing `literal` exists to
   * refuse. That is the refusal every command made before this task, kept
   * exactly where it was for the document that still needs it: one from
   * elsewhere, holding a literal slot that was never a degree.
   */
  it('refuses a literal slot with no way back', () => {
    const id = literalSlot(null, [61, 62, 63]);
    expectNoCommit(() => service.resetSlotToChord(id));
  });

  /**
   * The suspension and the pinned tensions do **not** come back with it.
   *
   * `unpinned` drops all three, and that is the behaviour to want rather than
   * an edge of it: Reset to chord hands the whole slot back, so a `V7sus4` with
   * a flat ninth that was dragged into something unnameable resets to the key's
   * own seventh on that degree - G B D F - and not to the suspension the user
   * is trying to get out of. The degree, the accidental and the height are what
   * `from` is for, and those survive: the height here is still a seventh.
   */
  it('drops the suspension and the pins the slot degraded with', () => {
    const id = literalSlot(
      degreeFor(4, {
        extent: 7,
        suspension: 'sus4',
        extensions: { ninth: -1, eleventh: null, thirteenth: null }
      }),
      [61, 62, 63]
    );

    service.resetSlotToChord(id);

    expect(degreeOf(id)).toEqual(
      jasmine.objectContaining({
        degree: 4,
        extent: 7,
        suspension: 'none',
        extensions: { ninth: null, eleventh: null, thirteenth: null }
      })
    );
    expect(midiOf(id)).toEqual([67, 71, 74, 77]);
  });

  /**
   * In whatever key the page is in by then, which is what makes this a way back
   * rather than a snapshot restored. The degree is the durable thing; the notes
   * it makes are the current key's business.
   */
  it('rebuilds in the key the page has reached', () => {
    const id = literalSlot(degreeFor(1), [61, 62, 63]);
    service.setKey(2, 'ionian');

    service.resetSlotToChord(id);

    // Degree 2 of D major is E minor: E G B.
    expect(midiOf(id)).toEqual([64, 67, 71]);
  });

  /** One undo step, and it takes back the numeral and the notes together. */
  it('is a single undo step', () => {
    const id = literalSlot(degreeFor(4), [61, 62, 63]);

    service.resetSlotToChord(id);
    service.undo();

    expect(harmonyOf(id).kind).toBe('literal');
    expect(midiOf(id)).toEqual([61, 62, 63]);
  });

  /**
   * And the refusal it shares with every other rebuild: there is no chord to
   * reset to in a key that cannot stack thirds, whichever kind of slot asked.
   */
  it('refuses in a key that can build no chords', () => {
    const id = literalSlot(degreeFor(4), [61, 62, 63]);
    service.setKey(0, 'majorPentatonic');

    expectNoCommit(() => service.resetSlotToChord(id));
  });

  /**
   * The end-to-end path, through the degradation M3 Task 8's key change makes.
   *
   * Thirds stacked from the second degree of C enigmatic give C♯ F♯ A♯, which
   * is no named shape, so a claimed voicing of it cannot be written in C major
   * at all and the slot loses its numeral there. Reset puts it back as C
   * major's own second degree: D F A.
   */
  it('brings back a slot the key change could not write', () => {
    service.setKey(0, 'enigmatic');
    const id = append(1);
    service.setSlotNotes(id, slot(id).notes);
    service.setKey(0, 'ionian');
    expect(harmonyOf(id).kind).toBe('literal');

    service.resetSlotToChord(id);

    expect(degreeOf(id)).toEqual(jasmine.objectContaining({ degree: 1, quality: null }));
    expect(midiOf(id)).toEqual([62, 65, 69]);
  });

  /**
   * The no-op comparison still belongs to the degree branch alone. A literal
   * slot changes kind whatever else it does, so it always records a step; a
   * degree slot that is already what Reset would make of it still records none.
   */
  it('still records nothing for a degree slot that is already reset', () => {
    const id = append(0);
    expectNoCommit(() => service.resetSlotToChord(id));
  });
});
