import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposerComponent, clampedStripHeight, stripHeightRangeOf } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerLibraryService } from '../../services/composer-library.service';
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
class StubScoreComponent {
  ignoredPresses = 0;

  ignoreNextPress(): void {
    this.ignoredPresses++;
  }
}

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

  const region = (): HTMLElement => fixture.nativeElement.querySelector('app-composer-status-line .messages');

  /** Dispatches a key press on `target`, bubbling to the document as a real one does. */
  function press(init: KeyboardEventInit, target: EventTarget = document): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  /**
   * The palette button for `id`, focused from the keyboard: it matches `:focus-visible`, or, with `visible` false, it
   * does not, as a button the mouse left the focus on. Faked, since a headless browser decides `:focus-visible` from how
   * the focus arrived, which a script's `focus()` does not reliably set.
   */
  function focusedTool(id: string, visible = true): HTMLButtonElement {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(`[data-tool="${id}"]`);
    button.focus();
    spyOn(button, 'matches').and.callFake((selector: string) => visible && selector === ':focus-visible');
    return button;
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

  it('leaves Space to a button focused from the keyboard, and plays on Space anywhere else', () => {
    const playPause = spyOn(TestBed.inject(AlphaTabService), 'playPause');
    const rest = focusedTool('rest');

    press({ key: ' ', code: 'Space' }, rest);
    expect(playPause).not.toHaveBeenCalled();

    press({ key: ' ', code: 'Space' });
    expect(playPause).toHaveBeenCalledTimes(1);
  });

  it('plays on Space when a mouse click left the focus on a button, rather than pressing that button again', () => {
    const playPause = spyOn(TestBed.inject(AlphaTabService), 'playPause');
    const deleteBar = focusedTool('deleteBar', false);

    const space = press({ key: ' ', code: 'Space' }, deleteBar);

    expect(playPause).toHaveBeenCalledTimes(1);
    expect(space.defaultPrevented).withContext('claimed, so the browser does not press the button too').toBeTrue();
  });

  it('opens Section once for Shift+Enter on its focused button: the browser presses the button, and the shortcut stands aside', () => {
    const section = focusedTool('section');

    press({ key: 'Enter', code: 'Enter', shiftKey: true }, section);
    section.click();
    fixture.detectChanges();

    expect(component.popover).toBe('section');
  });

  it('presses a focused palette button once for a held Enter, as a held key runs a tool that does not repeat once', () => {
    const fixBar = focusedTool('fixBar');

    const first = press({ key: 'Enter', code: 'Enter' }, fixBar);
    const held = press({ key: 'Enter', code: 'Enter', repeat: true }, fixBar);

    expect(first.defaultPrevented).toBeFalse();
    expect(held.defaultPrevented).toBeTrue();
  });

  it('adds a bar at the end from the palette\'s Add bar, and from its key', () => {
    const bars = composer.doc.masterBars.length;

    (fixture.nativeElement.querySelector('[data-tool="appendBar"]') as HTMLButtonElement).click();
    press({ key: 'Insert', code: 'Insert', ctrlKey: true, altKey: true });

    expect(composer.doc.masterBars.length).toBe(bars + 2);
    expect(composer.state.cursor.barIndex).withContext('added at the end, not before the caret').toBe(0);
  });

  it('lets a save through with the alphaTex panel open on an untouched draft, which follows the score as it changes', () => {
    const requested = spyOn(TestBed.inject(ComposerSaveRequests), 'request');
    component.toggleTexPanel();
    const seeded = component.texDraft;

    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    press({ key: 's', code: 'KeyS', ctrlKey: true });

    expect(requested).toHaveBeenCalledTimes(1);
    expect(component.texDraft).not.toBe(seeded);
  });

  it('says an edited alphaTex draft is out of date once the score moves on, and asks before Apply replaces that change', () => {
    const requested = spyOn(TestBed.inject(ComposerSaveRequests), 'request');
    component.toggleTexPanel();
    component.texDraft = `${component.texDraft} `;

    composer.setTempo(140);
    press({ key: 's', code: 'KeyS', ctrlKey: true });

    expect(requested).not.toHaveBeenCalled();
    expect(region().textContent).toContain('written against an earlier score');
    expect(fixture.nativeElement.querySelector('.tex-stale')?.textContent).toContain('written against an earlier score');

    const asked = spyOn(window, 'confirm').and.returnValue(false);
    component.applyTex();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(composer.doc.tempo).toBe(140);
  });

  it('parses an out-of-date draft before asking, and asks nothing when it does not parse', () => {
    component.toggleTexPanel();
    component.texDraft = `${component.texDraft} `;
    composer.setTempo(140);
    spyOn(TestBed.inject(AlphaTexService), 'parse').and.returnValue({ score: null, diagnostics: [] });
    const asked = spyOn(window, 'confirm');

    component.applyTex();

    expect(asked).not.toHaveBeenCalled();
    expect(component.texApplyError).toContain('could not be parsed');
    expect(composer.doc.tempo).toBe(140);
  });

  it('asks before New throws away unsaved changes, and keeps them when told no', () => {
    composer.setTempo(140);
    const before = composer.state.documentId;
    const asked = spyOn(window, 'confirm').and.returnValues(false, true);

    component.newScore();
    expect(asked).toHaveBeenCalledOnceWith('Discard unsaved changes and start a new score?');
    expect(composer.doc.tempo).toBe(140);
    expect(composer.state.canUndo).toBeTrue();
    expect(composer.state.documentId).toBe(before);

    component.newScore();
    expect(composer.state.documentId).toBe(before + 1);
    expect(composer.doc.tempo).toBe(120);
  });

  it('counts an edited alphaTex draft as unsaved work, and seeds the draft again for the next composition', () => {
    component.toggleTexPanel();
    component.texDraft = `${component.texDraft} `;
    const asked = spyOn(window, 'confirm').and.returnValue(true);

    expect(composer.state.isDirty).toBeFalse();
    expect(composer.confirmDiscard('load this composition')).toBeTrue();
    expect(asked).toHaveBeenCalledTimes(1);

    composer.replaceDocument({ ...ComposerService.createEmptyScore(), tempo: 90 }, { markClean: true, newComposition: true });
    fixture.detectChanges();

    expect(component.texDraftEdited).withContext('the draft written for the composition before is gone').toBeFalse();
    expect(component.texDraft).toContain('90');
    expect(composer.confirmDiscard('load this composition')).toBeTrue();
    expect(asked).withContext('nothing unsaved is left to ask about').toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a draft left untouched', () => {
    component.toggleTexPanel();
    const asked = spyOn(window, 'confirm');

    expect(composer.confirmDiscard('start a new score')).toBeTrue();
    expect(asked).not.toHaveBeenCalled();
  });

  it('takes its save guard off when it is destroyed', () => {
    const requests = TestBed.inject(ComposerSaveRequests);
    component.toggleTexPanel();
    component.texDraft = `${component.texDraft} `;
    expect(requests.refused()).toBeTrue();

    fixture.destroy();

    expect(requests.refused()).toBeFalse();
  });

  it('copies beats on Ctrl+C while the text selected is inside the score, which the key handler knows by the score\'s element', () => {
    const copy = spyOn(composer, 'copy');
    const score: HTMLElement = fixture.nativeElement.querySelector('app-composer-score');
    score.textContent = 'engraved text';
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(score);
    selection?.removeAllRanges();
    selection?.addRange(range);

    press({ key: 'c', code: 'KeyC', ctrlKey: true });
    selection?.removeAllRanges();

    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('resizes the strip from its separator\'s keys within the range it announces, without moving the caret', () => {
    composer.setCursor({ beatIndex: 1, stringIndex: 2 });
    const cursor = composer.state.cursor;
    const separator: HTMLElement = fixture.nativeElement.querySelector('.strip-resize');

    press({ key: 'Home' }, separator);
    expect(component.stripHeight).toBe(component.stripRange.min);
    press({ key: 'End' }, separator);
    expect(component.stripHeight).toBe(component.stripRange.max);
    press({ key: 'ArrowDown' }, separator);
    expect(component.stripHeight).toBe(clampedStripHeight(component.stripRange.max - 16, component.stripRange));
    press({ key: 'ArrowUp' }, separator);
    expect(component.stripHeight).toBe(component.stripRange.max);

    expect(composer.state.cursor).toEqual(cursor);
    expect(separator.getAttribute('aria-valuemin')).toBe(`${component.stripRange.min}`);
    expect(separator.getAttribute('aria-valuemax')).toBe(`${component.stripRange.max}`);
    expect(separator.getAttribute('aria-valuenow')).toBe(`${component.stripHeight}`);
  });

  it('tells the score to ignore the press that closed a popover, so that press only closes it', () => {
    const score = fixture.debugElement.query(By.directive(StubScoreComponent)).componentInstance as StubScoreComponent;
    const palette = fixture.debugElement.query(By.directive(ComposerPaletteComponent)).componentInstance as ComposerPaletteComponent;

    palette.popoverPressedOutside.emit();

    expect(score.ignoredPresses).toBe(1);
  });
});

describe('ComposerComponent with its Library panel', () => {
  it('has one live region: the library says what it did in the status line', async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent] })
      .overrideComponent(ComposerComponent, { remove: { imports: [ComposerScoreComponent] }, add: { imports: [StubScoreComponent] } })
      .compileComponents();
    spyOn(TestBed.inject(ComposerLibraryService), 'refresh').and.resolveTo([]);
    spyOn(TestBed.inject(ComposerExportService), 'downloadMidiFile');
    const fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[aria-live]').length).toBe(1);

    (fixture.debugElement.query(By.directive(ComposerLibraryPanelComponent)).componentInstance as ComposerLibraryPanelComponent).exportMidi();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-live]').textContent).toContain('Exported MIDI file');
  });
});

describe('stripHeightRangeOf and clampedStripHeight', () => {
  it('lets the strip grow until the score keeps its minimum height, and never shrink below one row', () => {
    // A page 700 tall whose top bar, status line and separator take 140: the score keeps 160, so the strip may take 400.
    const range = stripHeightRangeOf(700, 140);

    expect(range).toEqual({ min: 72, max: 400 });
    expect(clampedStripHeight(10, range)).toBe(72);
    expect(clampedStripHeight(300, range)).toBe(300);
    expect(clampedStripHeight(900, range)).toBe(400);
  });

  it('keeps one row on a page too short for both the score\'s minimum and a strip', () => {
    expect(stripHeightRangeOf(300, 140)).toEqual({ min: 72, max: 72 });
  });
});
