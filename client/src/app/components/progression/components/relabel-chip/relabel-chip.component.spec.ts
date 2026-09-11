import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { RelabelChipComponent } from './relabel-chip.component';

/**
 * The chip's inputs and its outputs: what it renders from a published state,
 * what it dispatches, and where the focus goes.
 *
 * Not its DOM structure - that is `relabel-chip-view.ts`' business and it is
 * specced there. The two things checked in the template here are the two that
 * are *only* true of the DOM and would be silently wrong without a check: the
 * live region has to be on the page before the relabel it announces, and the
 * menu button has to carry `aria-haspopup` and an `aria-expanded` that follows
 * the menu.
 */
describe('RelabelChipComponent', () => {
  let fixture: ComponentFixture<RelabelChipComponent>;
  let component: RelabelChipComponent;
  let progression: ProgressionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RelabelChipComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RelabelChipComponent);
    component = fixture.componentInstance;
    progression = TestBed.inject(ProgressionService);
    fixture.detectChanges();
  });

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  function block(...midi: number[]): RollNote[] {
    return midi.map(value => ({ midi: value, startBeat: 0, lengthBeats: 4, velocity: 80 }));
  }

  /** Appends a `I` and drags it into a suspension, which relabels it. */
  function relabel(notes: RollNote[] = block(60, 65, 67)): string {
    progression.appendSlot(0);
    const id = currentState().doc.slots[0].id;
    progression.setSlotNotes(id, notes);
    fixture.detectChanges();
    return id;
  }

  it('draws no chip until something is relabelled', () => {
    expect(component.view).toBeNull();
    expect(component.announcement).toBe('');
  });

  /**
   * The palette's bug, one component over: a region announces changes to itself
   * and not its own arrival, so a region that appears with its text says nothing
   * at all. It has to be here before there is anything to say.
   */
  it('has its live region on the page before there is anything to announce', () => {
    const region: HTMLElement | null =
      fixture.nativeElement.querySelector('.relabel-region');

    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-live')).toBe('polite');
    expect(region!.textContent!.trim()).toBe('');
  });

  it('shows the relabel and announces it', () => {
    relabel();

    expect(component.view).not.toBeNull();
    expect(component.announcement).toBe(component.view!.announcement);
    expect(fixture.nativeElement.querySelector('.relabel-region').textContent).toContain(
      'Relabelled'
    );
  });

  it('opens and closes the menu, and says which it is', () => {
    relabel();
    const button: HTMLElement = fixture.nativeElement.querySelector('.chip-button');

    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    component.toggle();
    fixture.detectChanges();

    expect(component.isOpen).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    component.toggle();

    expect(component.isOpen).toBe(false);
  });

  /** Both halves: the menu goes, and the focus comes back to what opened it. */
  it('closes on Escape and returns the focus to the button', () => {
    relabel();
    component.toggle();
    fixture.detectChanges();

    const button: HTMLElement = fixture.nativeElement.querySelector('.chip-button');
    component.closeOnEscape(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.isOpen).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('reverts to the previous label, keeping the notes', () => {
    const id = relabel();
    spyOn(progression, 'revertRelabel').and.returnValue(true);

    component.revert();

    expect(progression.revertRelabel).toHaveBeenCalledWith(id);
  });

  it('takes an alternate by its own degree', () => {
    const id = relabel(block(60, 64, 67, 70));
    const alternate = component.view!.alternates[0];
    spyOn(progression, 'chooseRelabelAlternate').and.returnValue(true);

    component.choose(alternate);

    expect(progression.chooseRelabelAlternate).toHaveBeenCalledWith(id, alternate.degree);
  });

  it('keeps the slot as literal', () => {
    const id = relabel();
    spyOn(progression, 'keepAsLiteral').and.returnValue(true);

    component.keepAsLiteral();

    expect(progression.keepAsLiteral).toHaveBeenCalledWith(id);
  });

  /**
   * The outcome is said *after* the dispatch, because the dispatch clears the
   * notice and `render` empties the region on the way through. Written the other
   * way round the user would be told nothing about the choice they just made.
   */
  it('announces what the answer did, after the answer', () => {
    relabel();
    const expected = component.view!.revertedAnnouncement;

    component.revert();
    fixture.detectChanges();

    expect(component.view).toBeNull();
    expect(component.announcement).toBe(expected);
    expect(fixture.nativeElement.querySelector('.relabel-region').textContent).toContain(
      'notes are unchanged'
    );
  });

  /** The button is about to be removed, so something else has to take the focus. */
  it('emits dismissed when it has been answered', () => {
    relabel();
    const dismissed = jasmine.createSpy('dismissed');
    component.dismissed.subscribe(dismissed);

    component.revert();

    expect(dismissed).toHaveBeenCalled();
  });

  /**
   * A region whose text never changes never speaks, and dragging a note back and
   * forth is how a user produces the same sentence twice running.
   */
  it('empties the region when the notice goes, so the same thing can be said twice', () => {
    const id = relabel();
    const said = component.announcement;
    expect(said).not.toBe('');

    // Undo takes the relabel back, which takes the notice with it.
    progression.undo();
    fixture.detectChanges();
    const between = component.announcement;

    progression.setSlotNotes(id, block(60, 65, 67));
    fixture.detectChanges();

    expect(between).toBe('');
    expect(component.announcement).toBe(said);
  });

  it('closes the menu when the notice goes', () => {
    const id = relabel();
    component.toggle();

    progression.selectSlot(null);
    fixture.detectChanges();

    expect(component.view).toBeNull();
    expect(component.isOpen).toBe(false);
    expect(id).not.toBe('');
  });
});
