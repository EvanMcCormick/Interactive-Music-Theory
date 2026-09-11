import { TestBed } from '@angular/core/testing';

import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { buildRelabelChipView } from './relabel-chip-view';

/**
 * What the chip says about a relabel.
 *
 * Table-driven over states built by the real service - a slot appended, its
 * notes written, the recogniser run - rather than over `ProgressionState`
 * literals. A hand-made notice is a statement about what this file expects the
 * recogniser to produce, and the thing worth checking is that the chip names
 * what the recogniser actually produced.
 *
 * The one exception is the other-slot case, which the service cannot reach: a
 * selection change clears the notice, so there is no sequence of commands that
 * leaves a live notice pointing somewhere other than the selection. That case
 * spreads one field over a real state, and it is specced rather than left
 * because the whole reason for it is a control that would refuse -
 * `revertRelabel` declines a notice naming another slot outright.
 */
describe('buildRelabelChipView', () => {
  let progression: ProgressionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    progression = TestBed.inject(ProgressionService);
  });

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /** A block of notes over the whole slot, the shape the generator writes. */
  function block(...midi: number[]): RollNote[] {
    return midi.map(value => ({ midi: value, startBeat: 0, lengthBeats: 4, velocity: 80 }));
  }

  /**
   * Appends a `I` and rewrites its pitches, which recognises inside its own
   * commit - a one-shot edit has no later moment to defer to.
   */
  function relabelFirstSlot(notes: RollNote[]): ProgressionState {
    progression.appendSlot(0);
    const id = currentState().doc.slots[0].id;
    progression.setSlotNotes(id, notes);
    return currentState();
  }

  it('says nothing when nothing was relabelled', () => {
    progression.appendSlot(0);

    expect(buildRelabelChipView(currentState())).toBeNull();
  });

  /**
   * A chip over an unselected slot would offer *Back to* on a notice the service
   * refuses to act on: a control that does nothing. See the module note.
   */
  it('says nothing when the notice names a slot other than the selected one', () => {
    const state = relabelFirstSlot(block(60, 65, 67));
    expect(buildRelabelChipView(state)).not.toBeNull();

    const elsewhere: ProgressionState = { ...state, selectedSlotId: 'some-other-slot' };

    expect(buildRelabelChipView(elsewhere)).toBeNull();
  });

  /**
   * The two shapes of notice, named. `C-F-G` is a suspension the app has a
   * numeral for; `C-C♯-D` is a cluster it has none for, which is the case the
   * containment rule was written for - a slot losing its label is the largest
   * thing an edit can do to it.
   */
  const cases: {
    what: string;
    notes: RollNote[];
    headline: string;
    previousText: string;
    announcement: string;
    revertLabel: string;
  }[] = [
    {
      what: 'a slot read back as another chord',
      notes: block(60, 65, 67),
      headline: 'Isus4',
      previousText: '(was I)',
      announcement: 'Relabelled C suspended fourth, was C major',
      revertLabel: 'Back to I'
    },
    {
      what: 'a slot whose notes match nothing',
      notes: block(60, 61, 62),
      headline: 'No chord matches',
      previousText: '(was I)',
      announcement: 'No chord matches these notes, was C major',
      revertLabel: 'Back to I'
    }
  ];

  cases.forEach(entry => {
    it(`names ${entry.what}`, () => {
      const view = buildRelabelChipView(relabelFirstSlot(entry.notes));

      expect(view).not.toBeNull();
      expect(view!.headline).toBe(entry.headline);
      expect(view!.previousText).toBe(entry.previousText);
      expect(view!.announcement).toBe(entry.announcement);
      expect(view!.revertLabel).toBe(entry.revertLabel);
    });
  });

  /** Nothing parsed, so there are no runners-up to offer. */
  it('offers no alternates for a slot that matched nothing', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 61, 62)));

    expect(view!.alternates).toEqual([]);
  });

  /**
   * Every alternate is dispatchable and every alternate is sayable: the degree
   * is the recogniser's own reading, and the label is the chord in words rather
   * than a numeral read out as letters.
   */
  it('names each alternate by numeral, name and phrase', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 64, 67, 70)));

    expect(view!.alternates.length).toBeGreaterThan(0);
    view!.alternates.forEach(alternate => {
      expect(alternate.numeral).not.toBe('');
      expect(alternate.name).not.toBe('');
      expect(alternate.label).toBe(`Label as ${alternate.spoken}`);
      expect(alternate.degree.degree).toBeGreaterThanOrEqual(0);
    });
  });

  /** The button says the whole announcement, plus what pressing it would do. */
  it('gives the button the announcement and the affordance', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 65, 67)));

    expect(view!.buttonLabel).toBe(`${view!.announcement}. Other names for these notes.`);
    expect(view!.hint).toContain('notes are kept');
  });

  /** The slot the chip acts on is the one the notice named. */
  it('carries the slot the notice named', () => {
    const state = relabelFirstSlot(block(60, 65, 67));

    expect(buildRelabelChipView(state)!.slotId).toBe(state.doc.slots[0].id);
  });
});
