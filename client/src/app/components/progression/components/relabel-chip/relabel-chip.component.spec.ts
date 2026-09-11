import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { RelabelChipComponent } from './relabel-chip.component';

/**
 * The chip's inputs and its outputs: what it renders from a published state,
 * what it dispatches, and where the focus goes.
 *
 * Not its DOM structure - that is `relabel-chip-view.ts`' business and it is
 * specced there. What is checked in the template here is what is *only* true of
 * the DOM and would be silently wrong without a check: the live region has to be
 * on the page before the relabel it announces, the menu button has to carry an
 * `aria-expanded` that follows the menu, and - the group added after a review -
 * the disclosure has to declare the keyboard model it actually implements.
 *
 * ## Why the focus is pinned
 *
 * A review found this component announcing `aria-haspopup="menu"` over a
 * `role="menu"` with no roving `tabindex`, no arrow-key handling, and a focus
 * that never entered the menu - a contract that puts NVDA and JAWS into
 * application mode and then strands them. A spec over inputs and outputs, which
 * is what this file was and what its plan asked for, cannot see that: every
 * dispatch was right and every label was right. The class of bug is *where the
 * focus is*, so that is asserted directly, on open and on each way out.
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

  function chipButton(): HTMLElement {
    return fixture.nativeElement.querySelector('.chip-button');
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
    const button = chipButton();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();

    component.toggle();
    fixture.detectChanges();

    expect(component.isOpen).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(component.menuId);

    component.toggle();

    expect(component.isOpen).toBe(false);
  });

  /**
   * **The spec the review said would have caught it.**
   *
   * `aria-haspopup="menu"` over a `role="menu"` is a promise about the arrow
   * keys - focus moved into the menu on open, a roving `tabindex`, Up and Down
   * wrapping, Home and End - and none of it was implemented. What is declared
   * here now is the model that *is* implemented: a plain group of buttons behind
   * a `true`, reached by Tab, with the focus left on the button that opened it.
   *
   * So the two halves are asserted together. The focus staying put is only
   * correct while the items are in the tab order, and the items being in the tab
   * order is only honest while the roles do not claim otherwise.
   */
  it('leaves the focus on the button and puts the items in the tab order', () => {
    relabel();
    const button = chipButton();
    button.focus();

    component.toggle();
    fixture.detectChanges();

    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-haspopup')).toBe('true');

    const menu: HTMLElement = fixture.nativeElement.querySelector('.menu');
    expect(menu.getAttribute('role')).toBe('group');
    expect(menu.getAttribute('aria-label')).toBe(component.view!.menuLabel);

    const items = Array.from(menu.querySelectorAll<HTMLElement>('.item'));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.getAttribute('role')).toBeNull();
      expect(item.tabIndex).toBe(0);
    }
  });

  /**
   * Both halves: the menu goes, and the focus comes back to what opened it.
   *
   * Dispatched on the *document* rather than called on the component, because
   * that is the change: Escape was bound to the chip's own element and so worked
   * only while the focus was inside it. The press below happens with the focus
   * nowhere near the chip, which is the case that was broken.
   */
  it('closes on Escape from anywhere, and returns the focus to the button', () => {
    relabel();
    component.toggle();
    fixture.detectChanges();

    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.isOpen).toBe(false);
    expect(document.activeElement).toBe(chipButton());
  });

  /**
   * A press anywhere else dismisses it, and does **not** take the focus.
   *
   * The menu floats over the top-right of the roll's grid and every item acts,
   * so a user reaching for a note under a menu they believed dismissed used to
   * relabel the slot instead. `pointerdown` and not `click`, so the menu is gone
   * before the press resolves into anything.
   */
  it('closes on a press outside it, without taking the focus', () => {
    relabel();
    component.toggle();
    fixture.detectChanges();

    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    elsewhere.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(component.isOpen).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  /** A press on the chip itself is the button's own business, not a dismissal. */
  it('stays open under a press inside it', () => {
    relabel();
    component.toggle();
    fixture.detectChanges();

    const item: HTMLElement = fixture.nativeElement.querySelector('.item');
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(component.isOpen).toBe(true);
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

  /**
   * A declined dispatch committed nothing, so the chip is still on screen with
   * the same notice on it. Emitting `dismissed` would send the focus to Reset to
   * chord with nothing said about why it moved - a control that is present and
   * refuses silently, which is the one thing this component exists not to be.
   */
  it('says nothing and moves nothing when the service declines', () => {
    relabel();
    const dismissed = jasmine.createSpy('dismissed');
    component.dismissed.subscribe(dismissed);
    spyOn(progression, 'revertRelabel').and.returnValue(false);
    component.toggle();

    component.revert();
    fixture.detectChanges();

    expect(dismissed).not.toHaveBeenCalled();
    expect(component.announcement).toBe(component.view!.announcement);
    // The menu still closes: that is what the user asked for by choosing.
    expect(component.isOpen).toBe(false);
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

  /**
   * And when the notice is *replaced* rather than cleared. A drag while the menu
   * is open would otherwise swap the alternates under a pointer already moving
   * towards one of them, so the item that gets pressed is not the one that was
   * read.
   */
  it('closes the menu when a new notice takes the old one’s place', () => {
    const id = relabel();
    component.toggle();
    fixture.detectChanges();
    expect(component.isOpen).toBe(true);

    progression.setSlotNotes(id, block(60, 64, 67, 70));
    fixture.detectChanges();

    expect(component.view).not.toBeNull();
    expect(component.isOpen).toBe(false);
  });
});
