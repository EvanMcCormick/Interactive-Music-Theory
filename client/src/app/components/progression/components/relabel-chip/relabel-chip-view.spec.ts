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
   *
   * **The first one is pinned to literal strings**, and the loop below is the
   * weaker check that it exists to make honest. `label` against
   * `Label as ${spoken}` is the builder asserted against itself - it passes over
   * a numeral and a name that are both the empty string, or both a description
   * of the wrong chord - so something has to say what the words actually are
   * once. What the loop is then good for is the property no single case can
   * show: that every alternate carries all four.
   *
   * C-F-G is the case, because it is the one whose runners-up the chord namer
   * has real words for. The recogniser will rank a parse it can express as a
   * degree but not name - `V?`, read aloud `G unnamed chord` - and pinning one
   * of those would pin a gap rather than a rule.
   */
  it('names an alternate in the words the card would use', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 65, 67)));
    const first = view!.alternates[0];

    expect(first.numeral).toBe('IVsus2');
    expect(first.name).toBe('Fsus2');
    expect(first.spoken).toBe('F suspended second');
    expect(first.label).toBe('Label as F suspended second');
    expect(first.key).toBe('IVsus2:Fsus2');
  });

  it('names every alternate by numeral, name and phrase', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 64, 67, 70)));

    expect(view!.alternates.length).toBeGreaterThan(0);
    view!.alternates.forEach(alternate => {
      expect(alternate.numeral).not.toBe('');
      expect(alternate.name).not.toBe('');
      expect(alternate.label).toBe(`Label as ${alternate.spoken}`);
      expect(alternate.degree.degree).toBeGreaterThanOrEqual(0);
    });
  });

  /**
   * The button says the whole announcement, plus what pressing it would do. The
   * announcement itself is pinned in the table above, so the composition here is
   * checked against it rather than spelled out a third time.
   */
  it('gives the button the announcement and the affordance', () => {
    const view = buildRelabelChipView(relabelFirstSlot(block(60, 65, 67)));

    expect(view!.buttonLabel).toBe(
      'Relabelled C suspended fourth, was C major. Other names for these notes.'
    );
    expect(view!.hint).toContain('notes are kept');
  });

  /**
   * A slot relabelled *out of* an unlabelled state names the far end the way the
   * card does - `unlabelled chord` and not a shorter word of the chip's own.
   * The chip and the card are an inch apart on the page and are describing one
   * slot; the printed `(was unlabelled)` is the numeral's slot, which is a
   * different thing from what is said aloud.
   */
  it('says `unlabelled chord` where the card says it, and prints the short form', () => {
    progression.appendSlot(0);
    const doc = currentState().doc;
    const slot = doc.slots[0];
    // A cluster under a literal label, so that writing a triad over it is a real
    // change: `setSlotNotes` declines a list identical to the one it holds, and
    // a declined write recognises nothing.
    progression.replaceDocument({
      ...doc,
      slots: [
        {
          ...slot,
          harmony: { kind: 'literal', reason: 'unrecognised', from: null },
          notes: block(60, 61, 62)
        }
      ]
    });
    progression.setSlotNotes(slot.id, block(60, 64, 67));

    const view = buildRelabelChipView(currentState());

    expect(view!.previousText).toBe('(was unlabelled)');
    expect(view!.revertLabel).toBe('Back to unlabelled');
    expect(view!.announcement).toBe('Relabelled C major, was unlabelled chord');
    expect(view!.revertedAnnouncement).toBe('Back to unlabelled chord. The notes are unchanged.');
    // The two commands are otherwise indistinguishable here, so the revert says
    // what the difference is.
    expect(view!.revertAriaLabel).toContain('A later edit can still name it.');
  });

  /** The slot the chip acts on is the one the notice named. */
  it('carries the slot the notice named', () => {
    const state = relabelFirstSlot(block(60, 65, 67));

    expect(buildRelabelChipView(state)!.slotId).toBe(state.doc.slots[0].id);
  });
});
