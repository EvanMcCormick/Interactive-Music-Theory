import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposerShortcutSheetComponent, shortcutSectionsOf } from './composer-shortcut-sheet.component';
import { COMPOSER_TOOLS } from '../../../../services/composer-tools';

describe('shortcutSectionsOf', () => {
  const sections = shortcutSectionsOf(COMPOSER_TOOLS);
  const keysOf = (label: string): string | undefined =>
    sections.flatMap(section => section.rows).find(row => row.label === label)?.keys;

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
});

describe('ComposerShortcutSheetComponent', () => {
  let fixture: ComponentFixture<ComposerShortcutSheetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerShortcutSheetComponent] }).compileComponents();
    fixture = TestBed.createComponent(ComposerShortcutSheetComponent);
    fixture.detectChanges();
  });

  it('is in the page while closed, hidden rather than removed', () => {
    const sheet: HTMLElement = fixture.nativeElement.querySelector('[role="dialog"]');

    expect(sheet).not.toBeNull();
    expect(sheet.getAttribute('aria-hidden')).toBe('true');
  });

  it('says it is open, and asks to close from its close button', () => {
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const sheet: HTMLElement = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-hidden')).toBe('false');
    (fixture.nativeElement.querySelector('.sheet-close') as HTMLButtonElement).click();
    expect(closed).toBeTrue();
  });
});
