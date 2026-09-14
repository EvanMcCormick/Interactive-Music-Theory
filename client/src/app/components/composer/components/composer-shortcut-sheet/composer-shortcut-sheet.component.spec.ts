import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerShortcutSheetComponent, shortcutSectionsOf, textFieldKeysOf } from './composer-shortcut-sheet.component';
import { KEY_PLATFORM, KeyPlatform } from '../../../../services/composer-key-platform';
import { COMPOSER_TOOLS } from '../../../../services/composer-tools';

describe('shortcutSectionsOf', () => {
  const sections = shortcutSectionsOf(COMPOSER_TOOLS);
  const keysOf = (label: string, from = sections): string | undefined =>
    from.flatMap(section => section.rows).find(row => row.label === label)?.keys;

  it('groups the tools in the design table\'s order', () => {
    expect(sections.map(section => section.group)).toEqual([
      'Tools', 'Edit', 'Navigation', 'Playback', 'Beats', 'Duration', 'Bar', 'Tracks', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'
    ]);
  });

  it('writes the fret digits as a range, and both bindings where a tool has two', () => {
    expect(keysOf('Fret')).toBe('0-9');
    expect(keysOf('Insert beat')).toBe('Insert or Alt+Enter');
    expect(keysOf('Play from the start')).toBe('Ctrl+Space or Shift+Space');
    expect(keysOf('Longer')).toBe('+ or =');
  });

  it('leaves out the tools with no key', () => {
    expect(keysOf('Quarter note')).toBeUndefined();
  });

  it('lists every tool that has a key, so a group left out of the sheet\'s order cannot take its tools with it unseen', () => {
    expect(sections.flatMap(section => section.rows).length).toBe(COMPOSER_TOOLS.filter(tool => tool.keys.length > 0).length);
  });

  it('writes Ctrl as ⌘ and Alt as ⌥ on a Mac, and as Ctrl and Alt elsewhere', () => {
    const mac = shortcutSectionsOf(COMPOSER_TOOLS, 'mac');

    expect(keysOf('Undo', mac)).toBe('⌘+Z');
    expect(keysOf('Flat', mac)).toBe('⌥+-');
    expect(keysOf('Undo')).toBe('Ctrl+Z');
    expect(keysOf('Flat')).toBe('Alt+-');
  });
});

describe('textFieldKeysOf', () => {
  it('names the keys that still run while typing in a field, from the tool table, as the platform writes them', () => {
    expect(textFieldKeysOf(COMPOSER_TOOLS)).toBe('Ctrl+S');
    expect(textFieldKeysOf(COMPOSER_TOOLS, 'mac')).toBe('⌘+S');
    expect(textFieldKeysOf(COMPOSER_TOOLS.filter(tool => !tool.inTextFields))).toBeNull();
  });
});

describe('ComposerShortcutSheetComponent', () => {
  let fixture: ComponentFixture<ComposerShortcutSheetComponent>;
  const attached: HTMLElement[] = [];

  async function create(platform: KeyPlatform = 'other'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ComposerShortcutSheetComponent],
      providers: [{ provide: KEY_PLATFORM, useValue: platform }]
    }).compileComponents();
    fixture = TestBed.createComponent(ComposerShortcutSheetComponent);
    fixture.detectChanges();
  }

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  function attach<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    attached.push(element);
    return element;
  }

  function setOpen(open: boolean): void {
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
  }

  const sheet = (): HTMLElement => fixture.nativeElement.querySelector('[role="dialog"]');

  it('is in the page while closed, hidden rather than removed', async () => {
    await create();

    expect(sheet()).not.toBeNull();
    expect(sheet().getAttribute('aria-hidden')).toBe('true');
  });

  it('says it is open, and asks to close from its close button', async () => {
    await create();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    setOpen(true);

    expect(sheet().getAttribute('aria-hidden')).toBe('false');
    (fixture.nativeElement.querySelector('.sheet-close') as HTMLButtonElement).click();
    expect(closed).toBeTrue();
  });

  it('is a modal dialog, named by its heading', async () => {
    await create();

    expect(sheet().getAttribute('aria-modal')).toBe('true');
    const heading = document.getElementById(sheet().getAttribute('aria-labelledby') ?? '');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent).toContain('Keyboard shortcuts');
  });

  it('says keys are ignored while typing in a field, except those that run from one, written for the platform', async () => {
    await create('mac');
    const note: string = fixture.nativeElement.querySelector('.sheet-note').textContent;

    expect(note).toContain('ignored while you type in a field, except ⌘+S');
    expect(note).not.toContain('Cmd on a Mac');
  });

  it('takes the focus when it opens, and gives it back to what had it when it closes', async () => {
    await create();
    const opener = attach('button');
    opener.focus();

    setOpen(true);
    expect(sheet().contains(document.activeElement)).toBeTrue();

    setOpen(false);
    expect(document.activeElement).toBe(opener);
  });

  it('gives the focus to the score when what had it is gone, asking for the score only as it closes', async () => {
    await create();
    const opener = attach('button');
    // No score yet when the sheet opens: the page's view query can be unset until the score renders.
    let score: HTMLElement | null = null;
    fixture.componentRef.setInput('fallbackFocus', () => score);
    opener.focus();

    setOpen(true);
    opener.remove();
    score = attach('div');
    score.tabIndex = -1;
    setOpen(false);

    expect(document.activeElement).toBe(score);
  });

  describe('its backdrop', () => {
    const backdrop = (): HTMLElement => fixture.nativeElement.querySelector('.sheet-backdrop');

    it('covers the page around the sheet while it is open, and nothing while it is closed', async () => {
      await create();
      expect(getComputedStyle(backdrop()).display).toBe('none');

      setOpen(true);

      expect(getComputedStyle(backdrop()).display).not.toBe('none');
      // The sheet is inset from the window's edges; a click in that margin lands on the backdrop, not on the page.
      expect(document.elementFromPoint(1, 1)).toBe(backdrop());
    });

    it('closes the sheet on a click, giving the focus back as Escape does', async () => {
      await create();
      const opener = attach('button');
      opener.focus();
      fixture.componentInstance.closed.subscribe(() => setOpen(false));
      setOpen(true);

      backdrop().click();

      expect(fixture.componentInstance.open).toBeFalse();
      expect(document.activeElement).toBe(opener);
    });
  });

  it('sends Shift+Tab from its heading, where opening put the focus, round to its last control', async () => {
    await create();
    setOpen(true);
    const heading: HTMLElement = fixture.nativeElement.querySelector('h2');
    expect(document.activeElement).toBe(heading);

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    heading.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.sections'));
  });

  it('keeps Tab inside while it is open, going round from the last control to the first and back', async () => {
    await create();
    setOpen(true);
    const close: HTMLElement = fixture.nativeElement.querySelector('.sheet-close');
    const list: HTMLElement = fixture.nativeElement.querySelector('.sections');
    const tab = (from: HTMLElement, shiftKey = false): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      from.focus();
      from.dispatchEvent(event);
      return event;
    };

    expect(tab(list).defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(close);
    expect(tab(close, true).defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(list);
  });
});

/**
 * The sheet over a page that makes itself `inert` while the sheet is open, as the composer page does - with the sheet
 * first in the template, so it hears it is opening before the page goes inert.
 */
@Component({
  standalone: true,
  imports: [ComposerShortcutSheetComponent],
  template: `
    <app-composer-shortcut-sheet [open]="open()" (closed)="open.set(false)"></app-composer-shortcut-sheet>
    <div class="page" [attr.inert]="open() ? '' : null"><button class="opener" type="button">?</button></div>
  `
})
class InertPageHostComponent {
  /** A signal, so setting it tells change detection, as the page's own state changes do. */
  readonly open = signal(false);
}

describe('ComposerShortcutSheetComponent over an inert page', () => {
  let fixture: ComponentFixture<InertPageHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InertPageHostComponent],
      providers: [{ provide: KEY_PLATFORM, useValue: 'other' }]
    }).compileComponents();
    fixture = TestBed.createComponent(InertPageHostComponent);
    fixture.detectChanges();
  });

  it('gives the focus back to what had it once the page is no longer inert, whatever order the page binds in', () => {
    const opener: HTMLButtonElement = fixture.nativeElement.querySelector('.opener');
    opener.focus();

    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(opener.closest('[inert]')).withContext('the page is inert while the sheet is open').not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]').contains(document.activeElement)).toBeTrue();

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();

    expect(document.activeElement).toBe(opener);
  });
});
