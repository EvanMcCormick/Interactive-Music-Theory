import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerScalePanelComponent } from './composer-scale-panel.component';
import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

describe('ComposerScalePanelComponent', () => {
  let fixture: ComponentFixture<ComposerScalePanelComponent>;
  let panel: ComposerScalePanelComponent;
  let said: HighlightConfig[];
  let firstOpenings: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerScalePanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerScalePanelComponent);
    panel = fixture.componentInstance;
    said = [];
    firstOpenings = 0;
    panel.highlightChange.subscribe(config => said.push(config));
    panel.firstOpened.subscribe(() => firstOpenings++);
    fixture.detectChanges();
  });

  /** The first scale in the catalogue, as `MusicTheoryService` offers it. */
  const firstScale = () => {
    const item = TestBed.inject(MusicTheoryService).getUnifiedCategories()[0].items[0];
    return { id: item.id, name: item.name, intervals: item.intervals, type: item.type };
  };

  it("offers the music theory catalogue's scales and chords, grouped as it groups them", () => {
    const categories = TestBed.inject(MusicTheoryService).getUnifiedCategories();

    expect(panel.groups.map(group => group.name)).toEqual(categories.map(category => category.name));
  });

  it('says the highlight as a HighlightConfig once it is switched on and a scale is chosen, and says it off again', () => {
    const scale = firstScale();
    panel.enabled = true;
    panel.rootNote = 9;
    panel.chosen = panel.groups[0].options[0];
    panel.changed();

    expect(said.at(-1)).toEqual({ enabled: true, rootNote: 9, intervals: scale.intervals, name: `A ${scale.name}`, type: scale.type });

    panel.enabled = false;
    panel.changed();
    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('says nothing is highlighted while it is on with no scale chosen', () => {
    panel.enabled = true;
    panel.changed();

    expect(said.at(-1)?.enabled).toBeFalse();
  });

  it('reports its first opening once, for the page to turn note bounds on', () => {
    panel.toggleOpen();
    panel.toggleOpen();
    panel.toggleOpen();

    expect(firstOpenings).toBe(1);
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const toggle = (): HTMLButtonElement => host().querySelector('.menu-toggle') as HTMLButtonElement;
  const menuShown = (): boolean => host().querySelector('.menu-panel')?.classList.contains('open') ?? false;

  /** Opens the menu with its button, as a click does. */
  function openMenu(): void {
    toggle().click();
    fixture.detectChanges();
  }

  /** An Escape pressed with the focus on `target`, reaching the document as a real one does. */
  function escapeOn(target: EventTarget): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  /**
   * Picks `name` in the group called `group` from the scale select, as a user does: `diminished` and `augmented` are
   * each both a scale and a triad in the catalogue, so a pick is told apart by its group as well as its id.
   */
  function pick(group: string, name: string): HTMLOptionElement {
    panel.enabled = true;
    fixture.detectChanges();
    const select = host().querySelectorAll('select')[1] as HTMLSelectElement;
    const optgroup = Array.from(select.querySelectorAll('optgroup')).find(candidate => candidate.label === group);
    const option = Array.from(optgroup?.querySelectorAll('option') ?? []).find(candidate => candidate.textContent?.trim() === name);
    if (!option) throw new Error(`no ${group} option ${name}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return option;
  }

  for (const [name, intervals] of [
    ['Diminished', [0, 3, 6]],
    ['Augmented', [0, 4, 8]]
  ] as const) {
    it(`highlights the ${name} triad, not the scale that shares its id, and keeps showing the triad`, async () => {
      const option = pick('Triads', name);
      await fixture.whenStable();

      expect(said.at(-1)).toEqual(jasmine.objectContaining({ enabled: true, intervals: [...intervals], type: 'chord' }));
      const select = host().querySelectorAll('select')[1] as HTMLSelectElement;
      expect(select.selectedOptions[0]).toBe(option);
      expect((select.selectedOptions[0].parentElement as HTMLOptGroupElement).label).toBe('Triads');
    });
  }

  it('closes on an Escape pressed anywhere while it is open, and claims it from the page', () => {
    openMenu();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const escape = escapeOn(outside);

    expect(menuShown()).toBeFalse();
    expect(escape.defaultPrevented).withContext('claimed, so the page does not also act on it').toBeTrue();
    expect(document.activeElement).withContext('the focus was outside the menu, and stays there').toBe(outside);
    outside.remove();
  });

  it('gives the focus back to its button when Escape closes it with the focus inside', () => {
    openMenu();
    const checkbox = host().querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    escapeOn(checkbox);

    expect(menuShown()).toBeFalse();
    expect(document.activeElement).toBe(toggle());
  });

  it('leaves an Escape alone while it is closed, and one something earlier claimed', () => {
    expect(escapeOn(document).defaultPrevented).withContext('closed').toBeFalse();

    openMenu();
    const claim = (event: Event): void => event.preventDefault();
    window.addEventListener('keydown', claim, true);
    try {
      escapeOn(document);
    } finally {
      window.removeEventListener('keydown', claim, true);
    }

    expect(menuShown()).toBeTrue();
  });

  it('closes when a modal opens over the page, and leaves Escape to the modal', () => {
    openMenu();

    fixture.componentRef.setInput('modalOpen', true);
    fixture.detectChanges();

    expect(menuShown()).toBeFalse();
    expect(escapeOn(document).defaultPrevented).toBeFalse();
  });

  it('says when it opens, for the page to close a popover, and not when it closes', () => {
    let openings = 0;
    panel.menuOpened.subscribe(() => openings++);

    openMenu();
    openMenu();

    expect(openings).toBe(1);
  });

  it('stops hearing the document once destroyed', () => {
    const removed = spyOn(document, 'removeEventListener').and.callThrough();

    fixture.destroy();

    expect(removed.calls.allArgs().some(([type, , capture]) => type === 'keydown' && capture === true)).toBeTrue();
  });
});
