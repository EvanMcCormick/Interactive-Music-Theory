import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposerComponent, clampedStripHeight } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerService } from '../../services/composer.service';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
import { ComposerSaveRequests } from '../../services/composer-save-requests.service';
import { shortcutTitleOf } from '../../services/composer-tools';

/**
 * The composer page: what it is answerable for beyond its parts.
 *
 * The parts have their own specs - the palette, the strip, the status line, the tool table and the key
 * handler. What is pinned here is the wiring: a refusal and an alphaTex error reach the live region, a key
 * press reaches the tool table and a key typed into a field does not, a palette press and a key run one
 * command, and the page's own controls - the sheet, a popover, adding a track - answer the keyboard.
 *
 * The score and the library panel are stubbed: one owns alphaTab and engraves on `AfterViewInit`, the
 * other reads IndexedDB, and neither is part of the wiring.
 */
@Component({ selector: 'app-composer-score', standalone: true, template: '' })
class StubScoreComponent {}

@Component({ selector: 'app-composer-library-panel', standalone: true, template: '' })
class StubLibraryPanelComponent {
  @Input() modalOpen = false;
  @Output() readonly menuOpened = new EventEmitter<void>();
}

describe('ComposerComponent', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let component: ComposerComponent;
  let composer: ComposerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const region = (): HTMLElement => fixture.nativeElement.querySelector('[aria-live="polite"]');

  /** Dispatches a key press on `target`, bubbling to the document as a real one does. */
  function press(init: KeyboardEventInit, target: EventTarget = document): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  }

  it('says why a press did nothing in the page\'s polite live region', () => {
    composer.toggleNoteEffect('isGhost', true, false);
    fixture.detectChanges();

    expect(region().textContent).toMatch(/no note/i);
  });

  it('shows a failed alphaTex apply in the same region', () => {
    spyOn(TestBed.inject(AlphaTexService), 'parse').and.returnValue({ score: null, diagnostics: [] });

    component.applyTex();
    fixture.detectChanges();

    expect(region().textContent).toContain('could not be parsed');
  });

  it('runs a key press through the tool table, and leaves one typed into the title alone', () => {
    press({ key: 'q', code: 'KeyQ' });
    expect(composer.state.entryMode).toBe('pen');

    press({ key: 'q', code: 'KeyQ' }, fixture.nativeElement.querySelector('.title-input'));
    expect(composer.state.entryMode).toBe('pen');
  });

  it('opens the shortcut sheet on ?, and Escape closes it alone - still Pen, still a range - until the next Escape', () => {
    press({ key: 'q', code: 'KeyQ' });
    composer.extendSelectionTo({ beatIndex: 2 });
    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(component.sheetOpen).toBeTrue();

    press({ key: 'Escape' });
    expect(component.sheetOpen).toBeFalse();
    expect(composer.state.entryMode).toBe('pen');
    expect(composer.state.anchor).not.toBeNull();

    press({ key: 'Escape' });
    expect(composer.state.entryMode).toBe('select');
  });

  it('leaves the score alone behind the open shortcut sheet: Delete clears nothing until the sheet closes', () => {
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    const doc = composer.doc;
    press({ key: '?', code: 'Slash', shiftKey: true });

    press({ key: 'Delete' });
    expect(composer.doc).toBe(doc);

    press({ key: 'Escape' });
    press({ key: 'Delete' });
    expect(composer.doc).not.toBe(doc);
  });

  it('gives the focus back to the ? button when Escape closes the sheet it opened', () => {
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.shortcuts-toggle');
    toggle.focus();
    toggle.click();
    fixture.detectChanges();
    const sheet: HTMLElement = fixture.nativeElement.querySelector('app-composer-shortcut-sheet [role="dialog"]');
    expect(sheet.contains(document.activeElement)).toBeTrue();

    press({ key: 'Escape' }, document.activeElement ?? document);
    expect(document.activeElement).toBe(toggle);
  });

  it('runs a palette button through the same command as its key', () => {
    (fixture.nativeElement.querySelector('[data-tool="rest"]') as HTMLButtonElement).click();

    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('opens a valued tool\'s popover from its key, with the focus in it', () => {
    press({ key: 'k', code: 'KeyK' });

    const open: HTMLElement | null = fixture.nativeElement.querySelector('.popover:popover-open');
    expect(component.popover).toBe('clef');
    expect(open?.contains(document.activeElement)).toBeTrue();
  });

  it('closes only the popover on Escape - still Pen, still a range - and gives focus back to its button', () => {
    press({ key: 'q', code: 'KeyQ' });
    composer.extendSelectionTo({ beatIndex: 2 });
    press({ key: 'k', code: 'KeyK' });

    press({ key: 'Escape' }, document.activeElement ?? document);

    expect(component.popover).toBeNull();
    expect(composer.state.entryMode).toBe('pen');
    expect(composer.state.anchor).not.toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-tool="clef"]'));
  });

  it('closes an open popover when its button is pressed again, and opens it on the next press', () => {
    press({ key: 'k', code: 'KeyK' });
    const clef: HTMLButtonElement = fixture.nativeElement.querySelector('[data-tool="clef"]');

    clef.click();
    fixture.detectChanges();
    expect(component.popover).toBeNull();

    clef.click();
    fixture.detectChanges();
    expect(component.popover).toBe('clef');
  });

  it('keeps ? pressed inside a popover in the popover, and closes an open popover when the sheet opens', () => {
    press({ key: '/', code: 'Slash', altKey: true });
    expect(component.popover).toBe('tuplet');

    // Inside the popover, ? is the popover's: no sheet opens under a popover in the top layer.
    press({ key: '?', code: 'Slash', shiftKey: true }, document.activeElement ?? document);
    expect(component.sheetOpen).toBeFalse();
    expect(component.popover).toBe('tuplet');

    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(component.sheetOpen).toBeTrue();
    expect(component.popover).toBeNull();
    expect(document.querySelector(':popover-open')).toBeNull();
  });

  it('says what Fix bar did in the live region, and how many bars are over outside it', () => {
    for (const beatIndex of [0, 1]) {
      composer.setCursor({ beatIndex, stringIndex: 0 });
      composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    }
    composer.setCursor({ beatIndex: 0 });
    composer.applyDurationAtCursor(1, 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.over-bars')?.textContent).toContain('1 bar over');

    composer.fixBar();
    fixture.detectChanges();
    expect(region().textContent).toContain('Fixed 1 bar');
    expect(fixture.nativeElement.querySelector('.over-bars')).toBeNull();
  });

  it('clears a failed alphaTex apply when the alphaTex panel closes', () => {
    spyOn(TestBed.inject(AlphaTexService), 'parse').and.returnValue({ score: null, diagnostics: [] });
    component.toggleTexPanel();
    component.applyTex();
    fixture.detectChanges();
    expect(region().textContent).toContain('could not be parsed');

    component.toggleTexPanel();
    fixture.detectChanges();
    expect(region().textContent).not.toContain('could not be parsed');
  });

  it('refuses a save while the alphaTex draft is not applied, from the textarea or anywhere, and says why', () => {
    const requests = TestBed.inject(ComposerSaveRequests);
    const requested = spyOn(requests, 'request');
    component.toggleTexPanel();
    fixture.detectChanges();
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('.tex-editor');

    press({ key: 's', code: 'KeyS', ctrlKey: true }, textarea);
    expect(requested).toHaveBeenCalledTimes(1);

    component.texDraft = `${component.texDraft} `;
    press({ key: 's', code: 'KeyS', ctrlKey: true }, textarea);
    press({ key: 's', code: 'KeyS', ctrlKey: true });
    expect(requested).toHaveBeenCalledTimes(1);
    expect(requests.refused()).toBeTrue();
    expect(region().textContent).toContain('Apply or revert the alphaTex draft before saving.');

    component.revertTex();
    press({ key: 's', code: 'KeyS', ctrlKey: true });
    expect(requested).toHaveBeenCalledTimes(2);
  });

  it('says the alphaTex draft refusal again when Save is pressed again, as a new message the live region reads out', () => {
    component.toggleTexPanel();
    component.texDraft = `${component.texDraft} `;
    press({ key: 's', code: 'KeyS', ctrlKey: true });
    const first = region().querySelector('.message');
    expect(first?.textContent).toContain('Apply or revert the alphaTex draft before saving.');

    press({ key: 's', code: 'KeyS', ctrlKey: true });
    const second = region().querySelector('.message');

    expect(second?.textContent).toBe(first?.textContent ?? '');
    expect(second).not.toBe(first);
  });

  it('puts the page behind the open shortcut sheet out of reach: inert, and a click over the palette lands on the backdrop, closing the sheet and changing nothing', () => {
    const palette: HTMLElement = fixture.nativeElement.querySelector('app-composer-palette');
    const doc = composer.doc;
    const cursor = composer.state.cursor;
    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(palette.closest('[inert]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.top-bar').closest('[inert]')).not.toBeNull();

    // A script's click() still reaches an inert element, and a pointer does not, so ask what a pointer there would hit.
    // The sheet is inset from the window's edges; a few pixels in from the palette's left edge is in that margin.
    const box = palette.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.max(1, box.left + 4), Math.min(innerHeight - 2, Math.max(1, box.top + 4)));
    expect(hit?.classList.contains('sheet-backdrop')).toBeTrue();
    (hit as HTMLElement).click();
    fixture.detectChanges();

    expect(component.sheetOpen).toBeFalse();
    expect(palette.closest('[inert]')).toBeNull();
    expect(composer.doc).toBe(doc);
    expect(composer.state.cursor).toEqual(cursor);
  });

  it('tells the Library panel a modal is open while the shortcut sheet is, so it closes its menus and leaves Escape to the sheet', () => {
    const panel = fixture.debugElement.query(By.directive(StubLibraryPanelComponent)).componentInstance as StubLibraryPanelComponent;
    expect(panel.modalOpen).toBeFalse();

    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(panel.modalOpen).toBeTrue();

    press({ key: 'Escape' });
    expect(component.sheetOpen).toBeFalse();
    expect(panel.modalOpen).toBeFalse();
  });

  it('closes an open popover when a Library or Export menu, or the saved list, opens', () => {
    press({ key: 'k', code: 'KeyK' });
    expect(component.popover).toBe('clef');
    const panel = fixture.debugElement.query(By.directive(StubLibraryPanelComponent)).componentInstance as StubLibraryPanelComponent;

    panel.menuOpened.emit();
    fixture.detectChanges();

    expect(component.popover).toBeNull();
    expect(document.querySelector(':popover-open')).toBeNull();
  });

  it('writes the shortcuts of Undo and Redo with the modifiers of the platform keyboard', () => {
    const platform = TestBed.inject(KEY_PLATFORM);
    const [undo, redo] = Array.from(fixture.nativeElement.querySelectorAll('.header-actions .text-btn')) as HTMLButtonElement[];

    expect(undo.title).toBe(shortcutTitleOf('undo', platform));
    expect(redo.title).toBe(shortcutTitleOf('redo', platform));
  });

  it('adds a track of the strip\'s chosen instrument from the keyboard', () => {
    press({ key: 'Insert', ctrlKey: true, shiftKey: true });

    expect(composer.doc.tracks.length).toBe(2);
    expect(composer.doc.tracks[1].name).toBe('Piano');
  });
});

describe('clampedStripHeight', () => {
  it('keeps the strip between one row and most of the window', () => {
    expect(clampedStripHeight(10, 1000)).toBe(72);
    expect(clampedStripHeight(300, 1000)).toBe(300);
    expect(clampedStripHeight(900, 1000)).toBe(600);
  });
});
