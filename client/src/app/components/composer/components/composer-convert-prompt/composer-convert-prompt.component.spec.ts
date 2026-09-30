import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerConvertPromptComponent } from './composer-convert-prompt.component';
import { EditRequest, GpOriginal } from '../../../../services/composer-gp.service';
import { LossItem } from '../../../../services/gp-conversion-loss';

/**
 * The conversion prompt on its own: when it is open, where the focus goes, and what it lists.
 *
 * The page's spec pins the wiring - which presses ask, what Cancel and Escape change. What is pinned here is the
 * prompt's own half: it is open only while a command waits *and* there is a file to convert, it behaves as a modal for
 * the keyboard (`ModalFocus`), and it sorts the loss under the heading each item belongs to.
 */
describe('ComposerConvertPromptComponent', () => {
  let fixture: ComponentFixture<ComposerConvertPromptComponent>;
  const attached: HTMLElement[] = [];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerConvertPromptComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerConvertPromptComponent);
    fixture.detectChanges();
  });

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  /** A button outside the prompt, in the page, as the control that asked would be. */
  function attachButton(): HTMLButtonElement {
    const button = document.createElement('button');
    document.body.appendChild(button);
    attached.push(button);
    return button;
  }

  function item(id: LossItem['id'], group: LossItem['group'], label: string): LossItem {
    return { id, group, label, detail: '1 bar', count: 1, firstBar: 1 };
  }

  function original(loss: LossItem[] = []): GpOriginal {
    return { entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score: new alphaTab.model.Score(), loss };
  }

  const request: EditRequest = { id: 'hammerOn', label: 'Hammer-on', run: () => undefined };

  function set(inputs: { request?: EditRequest | null; original?: GpOriginal | null }): void {
    if (inputs.request !== undefined) fixture.componentRef.setInput('request', inputs.request);
    if (inputs.original !== undefined) fixture.componentRef.setInput('original', inputs.original);
    fixture.detectChanges();
  }

  const dialog = (): HTMLElement => fixture.nativeElement.querySelector('.prompt');
  const heading = (): HTMLElement => fixture.nativeElement.querySelector('h2');
  const cancel = (): HTMLButtonElement =>
    Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Cancel')!;

  it('is open only while a command waits and there is a file to convert', () => {
    expect(fixture.componentInstance.open).toBeFalse();

    set({ request });
    expect(fixture.componentInstance.open).toBeFalse();

    set({ original: original() });
    expect(fixture.componentInstance.open).toBeTrue();
    expect(dialog().getAttribute('aria-hidden')).toBe('false');

    set({ original: null });
    expect(fixture.componentInstance.open).toBeFalse();
    expect(dialog().getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the focus to its heading as it opens, and gives it back to what had it on Cancel', () => {
    const opener = attachButton();
    opener.focus();
    fixture.componentInstance.cancelled.subscribe(() => set({ request: null }));

    set({ request, original: original() });
    expect(document.activeElement).toBe(heading());

    cancel().click();

    expect(fixture.componentInstance.open).toBeFalse();
    expect(document.activeElement).toBe(opener);
  });

  it('gives the focus to the fallback when what had it is gone, asking for it only as it closes', () => {
    const opener = attachButton();
    let score: HTMLElement | null = null;
    fixture.componentRef.setInput('fallbackFocus', () => score);
    opener.focus();

    set({ request, original: original() });
    opener.remove();
    score = document.createElement('div');
    score.tabIndex = -1;
    document.body.appendChild(score);
    attached.push(score);
    set({ request: null });

    expect(document.activeElement).toBe(score);
  });

  it('keeps Tab inside while it is open, going round from its last control to its first and back', () => {
    set({ request, original: original() });
    const buttons = Array.from(dialog().querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const tab = (from: HTMLElement, shiftKey = false): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      from.focus();
      from.dispatchEvent(event);
      return event;
    };

    expect(tab(last).defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(first);
    expect(tab(first, true).defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(last);
  });

  it('lists what converting loses and what the first save loses under their own headings, and follows a new file', () => {
    set({
      request,
      original: original([item('credits', 'conversion', 'Credits'), item('doubleBars', 'first save', 'Double bar lines')])
    });

    const sections = (): HTMLElement[] => Array.from(dialog().querySelectorAll<HTMLElement>('.loss'));
    expect(sections().map(section => section.querySelector('h3')?.textContent?.trim())).toEqual([
      'What this file would lose',
      'What the first save would lose'
    ]);
    expect(sections()[0].textContent).toContain('Credits');
    expect(sections()[0].textContent).not.toContain('Double bar lines');
    expect(sections()[1].textContent).toContain('Double bar lines');

    set({ original: original([item('slurs', 'conversion', 'Slurs')]) });

    expect(sections().length).toBe(1);
    expect(sections()[0].textContent).toContain('Slurs');
    expect(fixture.componentInstance.saveLoss).toEqual([]);
  });
});
