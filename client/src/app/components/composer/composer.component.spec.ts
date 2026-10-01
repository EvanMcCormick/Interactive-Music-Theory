import { Component, ErrorHandler, EventEmitter, Input, Output } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';

import { ComposerComponent, clampedStripHeight, stripHeightRangeOf } from './composer.component';
import { ComposerLibraryPanelComponent } from './components/composer-library-panel/composer-library-panel.component';
import { ComposerPaletteComponent } from './components/composer-palette/composer-palette.component';
import { ComposerScoreComponent } from './components/composer-score/composer-score.component';
import { AlphaTabState } from '../../models/alpha-tab.model';
import { AlphaTabService } from '../../services/alpha-tab.service';
import { AlphaTexService } from '../../services/alpha-tex.service';
import { ComposerExportService } from '../../services/composer-export.service';
import { ComposerLibraryService } from '../../services/composer-library.service';
import { ComposerGpService } from '../../services/composer-gp.service';
import { ConversionOutcome, GpConversionService } from '../../services/gp-conversion.service';
import { GpFileOpener } from '../../services/gp-file-opener.service';
import { GP_LIBRARY_DB, GpLibraryService } from '../../services/gp-library.service';
import { deletedDatabase } from '../../services/indexed-db.spec-helper';
import { ASKING_PAGE_COMMANDS } from '../../services/composer-edit-intent';
import { ComposerService } from '../../services/composer.service';
import { KEY_PLATFORM } from '../../services/composer-key-platform';
import { ComposerSaveRequests } from '../../services/composer-save-requests.service';
import { shortcutTitleOf } from '../../services/composer-tools';
import { ScoreDocMapperService } from '../../services/score-doc-mapper.service';

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
  @Input() highlight: unknown = null;
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
  // A GP library of its own: the page opens one (`GpFileOpener`), and nothing here should open the one a browser holds.
  const gpDb = `gp-library-page-wiring-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await deletedDatabase(gpDb);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: gpDb }] })
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

  it('asks alphaTab for note bounds the first time the scale panel opens, and passes its highlight to the score', () => {
    const noteBounds = spyOn(TestBed.inject(AlphaTabService), 'setNoteBounds');
    const toggle = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('app-composer-scale-panel .menu-toggle'))[0];

    toggle.click();
    toggle.click();
    toggle.click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('app-composer-scale-panel') as HTMLElement;
    (panel.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    const select = panel.querySelectorAll('select')[1] as HTMLSelectElement;
    const first = select.querySelector('optgroup option') as HTMLOptionElement;
    select.value = first.value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const score = fixture.debugElement.query(By.directive(StubScoreComponent)).componentInstance as StubScoreComponent;
    expect(score.highlight).toEqual(jasmine.objectContaining({ enabled: true, rootNote: 0, name: `C ${first.textContent?.trim()}` }));
    expect(score.highlight).toBe(component.highlight);

    expect(noteBounds.calls.allArgs()).toEqual([[true]]);
  });

  describe('transport', () => {
    let player: AlphaTabService;
    let host: HTMLElement;

    beforeEach(() => {
      player = TestBed.inject(AlphaTabService);
      host = fixture.nativeElement as HTMLElement;
    });

    /** The speed, volume and seek sliders, in that order. */
    const sliders = (): HTMLInputElement[] => Array.from(host.querySelectorAll<HTMLInputElement>('.transport input[type="range"]'));

    /** The player's state, `changes` over it, as an alphaTab event would move it. */
    function playerMoves(changes: Partial<AlphaTabState>): void {
      player.getState().next({ ...player.getState().getValue(), ...changes });
      fixture.detectChanges();
    }

    /** A drag's step: the thumb moves to `value`, and the browser fires `input`. */
    function drag(input: HTMLInputElement, value: string): void {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    /** The drag let go: the browser fires `change` once, with the value it settled on. */
    function release(input: HTMLInputElement): void {
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    it("runs the viewer's transport through the player: loop, speed as a percentage, volume and the seek bar", () => {
      const looping = spyOn(player, 'setLooping');
      const speed = spyOn(player, 'setPlaybackSpeed');
      const volume = spyOn(player, 'setVolume');
      const seek = spyOn(player, 'seekToTime');
      playerMoves({ isReadyForPlayback: true, timePosition: 65_000, totalDuration: 200_000 });
      const [speedSlider, volumeSlider, seekBar] = sliders();

      Array.from(host.querySelectorAll<HTMLButtonElement>('.transport .toggle-btn')).find(button => button.textContent?.trim() === 'Loop')!.click();
      drag(speedSlider, '150');
      release(speedSlider);
      drag(volumeSlider, '40');
      drag(seekBar, '30000');
      release(seekBar);

      expect(looping).toHaveBeenCalledWith(true);
      expect(speed).toHaveBeenCalledWith(1.5);
      expect(volume).toHaveBeenCalledWith(0.4);
      expect(seek).toHaveBeenCalledWith(30000);
      expect(speedSlider.min).toBe('25');
      expect(speedSlider.max).toBe('200');
    });

    it("seeks by the second, over the player's duration, from where the player is", () => {
      playerMoves({ isReadyForPlayback: true, timePosition: 65_000, totalDuration: 200_000 });
      const seekBar = sliders()[2];

      expect(seekBar.step).toBe('1000');
      expect(seekBar.max).toBe('200000');
      expect(seekBar.value).toBe('65000');
      expect(host.querySelector('.time-readout')?.textContent?.trim()).toBe('1:05 / 3:20');

      playerMoves({ timePosition: 66_000 });
      expect(seekBar.value).toBe('66000');
      expect(seekBar.getAttribute('aria-valuetext')).toBe('1:06 / 3:20');
    });

    it('keeps a drag where the hand has it while the player plays on, and seeks once, when the drag lets go', () => {
      const seek = spyOn(player, 'seekToTime');
      playerMoves({ isReadyForPlayback: true, isPlaying: true, timePosition: 65_000, totalDuration: 200_000 });
      const seekBar = sliders()[2];

      drag(seekBar, '30000');
      drag(seekBar, '31000');
      playerMoves({ timePosition: 66_000 });

      expect(seek).not.toHaveBeenCalled();
      expect(seekBar.value).toBe('31000');
      expect(host.querySelector('.time-readout')?.textContent?.trim()).toBe('0:31 / 3:20');
      expect(seekBar.getAttribute('aria-valuetext')).toBe('0:31 / 3:20');

      release(seekBar);
      expect(seek.calls.allArgs()).toEqual([[31000]]);

      playerMoves({ timePosition: 32_000 });
      expect(seekBar.value).toBe('32000');
      expect(host.querySelector('.time-readout')?.textContent?.trim()).toBe('0:32 / 3:20');
    });

    it('sets the speed once, when the drag lets go, with the label following the drag until then', () => {
      const speed = spyOn(player, 'setPlaybackSpeed');
      playerMoves({ isReadyForPlayback: true });
      const speedSlider = sliders()[0];
      const readout = (): string | undefined => host.querySelector('.speed-readout')?.textContent?.trim();

      drag(speedSlider, '120');
      drag(speedSlider, '150');

      expect(speed).not.toHaveBeenCalled();
      expect(readout()).toBe('150%');
      expect(speedSlider.getAttribute('aria-valuetext')).toBe('150%');

      release(speedSlider);
      expect(speed.calls.allArgs()).toEqual([[1.5]]);
    });

    it("reads the speed and the volume back from the player's state, as percentages", () => {
      playerMoves({ tempoMultiplier: 0.5, volume: 0.25 });

      expect(component.speedPercent).toBe(50);
      expect(component.volumePercent).toBe(25);
      expect(host.querySelector('.speed-readout')?.textContent?.trim()).toBe('50%');
      expect(sliders()[0].value).toBe('50');
      expect(sliders()[1].value).toBe('25');
    });

    it('names each slider by its label alone, with no numbers in the name', () => {
      const names = sliders().map(slider => Array.from(slider.labels ?? []).map(label => label.textContent?.trim()));

      expect(names).toEqual([['Speed'], ['Volume'], ['Position']]);
      for (const slider of sliders()) {
        expect(slider.hasAttribute('aria-label')).withContext('aria-label').toBeFalse();
        expect(slider.hasAttribute('aria-labelledby')).withContext('aria-labelledby').toBeFalse();
      }
    });

    it("keeps the readouts out of a screen reader's hearing: the sliders' valuetext already says them", () => {
      expect(host.querySelectorAll('.transport output').length).toBe(0);
      for (const readout of Array.from(host.querySelectorAll('.speed-readout, .time-readout'))) {
        expect(readout.getAttribute('aria-hidden')).withContext(readout.className).toBe('true');
      }
    });

    it('disables speed and volume until the player is ready, and the seek bar until there is something to seek over', () => {
      const disabled = (): boolean[] => sliders().map(slider => slider.disabled);
      expect(disabled()).toEqual([true, true, true]);

      playerMoves({ isReadyForPlayback: true });
      expect(disabled()).toEqual([false, false, true]);

      playerMoves({ totalDuration: 200_000 });
      expect(disabled()).toEqual([false, false, false]);
    });
  });

  it('closes an open popover when the Scales menu opens, and closes the menu when the shortcut sheet opens', () => {
    press({ key: 'k', code: 'KeyK' });
    expect(component.popover).toBe('clef');
    const toggle = fixture.nativeElement.querySelector('app-composer-scale-panel .menu-toggle') as HTMLButtonElement;
    const menu = fixture.nativeElement.querySelector('#composer-scale-menu') as HTMLElement;

    toggle.click();
    fixture.detectChanges();

    expect(component.popover).toBeNull();
    expect(document.querySelector(':popover-open')).toBeNull();
    expect(menu.classList.contains('open')).toBeTrue();

    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(menu.classList.contains('open')).withContext('closed by the sheet opening').toBeFalse();
  });

  it("closes the Scales menu on an Escape pressed outside it, and keeps that Escape from the page's own", () => {
    press({ key: 'q', code: 'KeyQ' });
    expect(composer.state.entryMode).toBe('pen');
    const toggle = fixture.nativeElement.querySelector('app-composer-scale-panel .menu-toggle') as HTMLButtonElement;
    const menu = fixture.nativeElement.querySelector('#composer-scale-menu') as HTMLElement;
    toggle.click();
    fixture.detectChanges();
    toggle.blur();

    press({ key: 'Escape' });

    expect(menu.classList.contains('open')).toBeFalse();
    expect(composer.state.entryMode).withContext('the page did not also go back to Select').toBe('pen');

    press({ key: 'Escape' });
    expect(composer.state.entryMode).withContext("with the menu closed, Escape is the page's again").toBe('select');
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

  /** The page made tall, so the strip's range is not held at one row, and the separator whose End measures it again. */
  function tallPage(): HTMLElement {
    (fixture.nativeElement.querySelector('.composer-page') as HTMLElement).style.height = '1200px';
    return fixture.nativeElement.querySelector('.strip-resize');
  }

  it('leaves the score the minimum height the page styles give it, as measured rather than assumed', () => {
    const separator = tallPage();
    press({ key: 'End' }, separator);
    const tallest = component.stripRange.max;

    // As a larger root font makes the score's 10rem taller.
    (fixture.nativeElement.querySelector('app-composer-score') as HTMLElement).style.minHeight = '300px';
    press({ key: 'End' }, separator);

    expect(tallest - component.stripRange.max).toBe(140);
  });

  it('counts the open alphaTex panel as a row the strip leaves room for', () => {
    const separator = tallPage();
    press({ key: 'End' }, separator);
    const tallest = component.stripRange.max;
    press({ key: 'Home' }, separator);

    component.toggleTexPanel();
    fixture.detectChanges();
    const panel: HTMLElement = fixture.nativeElement.querySelector('.tex-panel');
    const panelHeight = panel.offsetHeight;
    press({ key: 'End' }, separator);

    expect(panelHeight).toBeGreaterThan(0);
    expect(tallest - component.stripRange.max).toBe(panelHeight);
  });

  /**
   * The page's `ResizeObserver` answered, and the fit it makes applied: its callback is delivered after a frame's
   * animation callbacks, so two frames cover a change made before this was called.
   */
  async function fitted(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    fixture.detectChanges();
  }

  it('fits the strip again when the status line or the open alphaTex panel changes height, as a long message wraps', async () => {
    tallPage();
    await fitted();
    const tallest = component.stripRange.max;

    // A refusal wrapping the status line onto a second line.
    const status: HTMLElement = fixture.nativeElement.querySelector('app-composer-status-line');
    status.style.minHeight = `${status.offsetHeight + 40}px`;
    await fitted();

    expect(tallest - component.stripRange.max).withContext('the room the wrapped status line took').toBe(40);

    component.toggleTexPanel();
    fixture.detectChanges();
    await fitted();
    const withPanel = component.stripRange.max;
    const panel: HTMLElement = fixture.nativeElement.querySelector('.tex-panel');

    // As the panel's diagnostics grow under its text box.
    const panelHeight = panel.offsetHeight;
    panel.style.minHeight = `${panelHeight + 30}px`;
    await fitted();

    expect(panel.offsetHeight).toBeGreaterThan(panelHeight);
    expect(withPanel - component.stripRange.max).withContext('the room the grown panel took').toBe(panel.offsetHeight - panelHeight);
  });

  it('fits the strip again when the alphaTex panel closes, giving back the room its row took', async () => {
    tallPage();
    await fitted();
    const tallest = component.stripRange.max;

    component.toggleTexPanel();
    fixture.detectChanges();
    await fitted();
    expect(component.stripRange.max).withContext('the open panel is a row the strip leaves room for').toBeLessThan(tallest);

    component.toggleTexPanel();
    fixture.detectChanges();
    await fitted();

    expect(component.stripRange.max).toBe(tallest);
  });

  it('presses any other control focused from the keyboard once for a held Enter, as a menu item or a saved row is', () => {
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.shortcuts-toggle');
    toggle.focus();
    spyOn(toggle, 'matches').and.callFake((selector: string) => selector === ':focus-visible');

    const held = press({ key: 'Enter', code: 'Enter', repeat: true }, toggle);

    expect(held.defaultPrevented).withContext('a held Enter would open and close the sheet on every repeat').toBeTrue();
  });
});

describe('ComposerComponent with its Library panel', () => {
  // A GP library of its own: the panel lists one, and nothing here should read the one a browser holds.
  const gpDb = `gp-library-page-panel-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await deletedDatabase(gpDb);
  });

  it('has one polite live region: the library says what it did in the status line', async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: gpDb }] })
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

  it('leaves the score the minimum it is given, which follows the root font size', () => {
    // At a 20px root font the score's 10rem is 200.
    expect(stripHeightRangeOf(700, 140, 200)).toEqual({ min: 72, max: 360 });
  });
});

/**
 * The page while it is showing a `.gp` file as alphaTab read it (`ComposerGpService`).
 *
 * The palette, the keys and the popovers stay live, and the first command that would change the document asks - the
 * conversion prompt - and what changes about the rest is what the page can honestly show: there is no document to undo,
 * to set a BPM on, or to rename.
 */
describe('ComposerComponent in the Original state', () => {
  let fixture: ComponentFixture<ComposerComponent>;
  let gp: ComposerGpService;
  let composer: ComposerService;
  // A GP library of its own, so a conversion deletes from nothing a browser already holds.
  const gpDb = `gp-library-page-spec-${Math.random().toString(36).slice(2)}`;

  afterAll(() => void indexedDB.deleteDatabase(gpDb));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComposerComponent], providers: [provideRouter([]), { provide: GP_LIBRARY_DB, useValue: gpDb }] })
      .overrideComponent(ComposerComponent, {
        remove: { imports: [ComposerScoreComponent, ComposerLibraryPanelComponent] },
        add: { imports: [StubScoreComponent, StubLibraryPanelComponent] }
      })
      .compileComponents();

    gp = TestBed.inject(ComposerGpService);
    composer = TestBed.inject(ComposerService);
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();
  });

  /**
   * Opens a file in the Original state and settles the page.
   *
   * `whenStable` because `ngModel` writes its value and its disabled state in a microtask, so the title and the BPM
   * field are still the composition's immediately after `detectChanges`.
   */
  async function openFile(title: string, tempo: number): Promise<void> {
    const score = new alphaTab.model.Score();
    score.title = title;
    const masterBar = new alphaTab.model.MasterBar();
    masterBar.tempoAutomations.push(alphaTab.model.Automation.buildTempoAutomation(false, 0, tempo, 60));
    score.addMasterBar(masterBar);
    gp.open({ entryId: 'entry-1', fileName: `${title}.gp`, bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const titleInput = (): HTMLInputElement => fixture.nativeElement.querySelector('.title-input');
  const tempoInput = (): HTMLInputElement => fixture.nativeElement.querySelector('.tempo-field input');
  const textButton = (label: string): HTMLButtonElement => {
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.text-btn'));
    return buttons.find(button => button.textContent?.trim() === label)!;
  };

  it('says it is viewing the original file', async () => {
    expect(fixture.nativeElement.querySelector('.original')).toBeNull();

    await openFile('Band', 132);

    expect(fixture.nativeElement.querySelector('.original')?.textContent?.trim()).toBe('Viewing the original file');
  });

  it("shows the file's title, read only", async () => {
    await openFile('Band', 132);

    expect(titleInput().value).toBe('Band');
    expect(titleInput().readOnly).toBe(true);
  });

  it("shows the file's tempo, in a field that cannot be typed into", async () => {
    await openFile('Band', 132);

    expect(tempoInput().value).toBe('132');
    expect(tempoInput().disabled).toBe(true);
  });

  it('disables Undo and Redo: there is no history until there is a document', async () => {
    await openFile('Band', 132);

    expect(textButton('Undo').disabled).toBe(true);
    expect(textButton('Redo').disabled).toBe(true);
  });

  it('drops a command asked on the page when the page goes, so it cannot outlive the prompt that showed it', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });
    expect(gp.request).not.toBeNull();

    fixture.destroy();

    expect(gp.request).toBeNull();
  });

  it('shows a command asked before the page was there - a progression sent from its own page - as it arrives', async () => {
    await openFile('Band', 132);
    fixture.destroy();
    gp.requestEdit(ASKING_PAGE_COMMANDS.progressionTrack, 'Sending the progression', () => undefined);

    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    expect(promptOpen()).toBeTrue();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Sending the progression would convert this file.');
  });

  it('does not open the shortcut sheet over the prompt on ?', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    press({ key: '?', code: 'Slash', shiftKey: true });

    expect(fixture.componentInstance.sheetOpen).toBeFalse();
    expect(promptOpen()).toBeTrue();
  });

  it('closes an open popover when a command asks, so it does not sit in the top layer above the prompt', async () => {
    await openFile('Band', 132);
    press({ key: 'k', code: 'KeyK' });
    expect(fixture.componentInstance.popover).toBe('clef');

    gp.requestEdit('hammerOn', 'Hammer-on', () => undefined);
    fixture.detectChanges();

    expect(fixture.componentInstance.popover).toBeNull();
    expect(promptOpen()).toBeTrue();
  });

  it("seeds an untouched alphaTex draft with the file's own when the file opens with the panel already open", async () => {
    const texService = TestBed.inject(AlphaTexService);
    fixture.componentInstance.toggleTexPanel();
    const composition = fixture.componentInstance.texDraft;

    await openFile('Band', 132);
    expect(fixture.componentInstance.texDraft).toBe(texService.export(gp.original!.score));

    gp.clear();
    fixture.detectChanges();
    expect(fixture.componentInstance.texDraft).toBe(composition);
  });

  /** Drops `files` on the page, as the browser would, and returns the event: its `defaultPrevented` says the browser kept them. */
  function dropOnPage(files: File[]): DragEvent {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    fixture.nativeElement.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('refuses a file dropped while the conversion prompt is open, and keeps the file and the edit it holds', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });
    const importDropped = spyOn(TestBed.inject(GpFileOpener), 'importDropped').and.resolveTo();

    const drop = dropOnPage([new File([new Uint8Array([1])], 'other.gp')]);

    expect(drop.defaultPrevented).withContext('the browser would open the file itself').toBeTrue();
    expect(importDropped).not.toHaveBeenCalled();
    expect(composer.state.refusal).toBe('Answer the question about the open file before opening another.');
    expect(promptOpen()).toBeTrue();
    expect(gp.request).not.toBeNull();
    expect(gp.original?.score.title).toBe('Band');
  });

  it('refuses a file dropped while a conversion is under way, and opens nothing for the conversion to clear', async () => {
    let finish: (outcome: ConversionOutcome) => void = () => undefined;
    spyOn(TestBed.inject(GpConversionService), 'convert').and.returnValue(new Promise<ConversionOutcome>(resolve => (finish = resolve)));
    await openFile('Band', 132);
    press({ key: 'h' });
    promptButton('Convert').click();
    fixture.detectChanges();
    const importDropped = spyOn(TestBed.inject(GpFileOpener), 'importDropped').and.resolveTo();

    const drop = dropOnPage([new File([new Uint8Array([1])], 'other.gp')]);

    expect(drop.defaultPrevented).withContext('the browser would open the file itself').toBeTrue();
    expect(importDropped).not.toHaveBeenCalled();
    expect(composer.state.refusal).toBe('Wait for the conversion to finish before opening another file.');
    expect(gp.original?.score.title).toBe('Band');

    finish({ kind: 'refused', reason: 'Stopped.' });
    await until(() => !fixture.componentInstance.converting);
  });

  it("counts the file's bars in the status line, not the empty composition's", async () => {
    await openFile('Band', 132);

    expect(fixture.nativeElement.querySelector('.readout')?.textContent).toContain('of 1');
  });

  const prompt = (): HTMLElement => fixture.nativeElement.querySelector('app-composer-convert-prompt .prompt');
  const promptOpen = (): boolean => prompt().classList.contains('open');
  const promptButton = (label: string): HTMLButtonElement =>
    Array.from(prompt().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === label)!;

  function press(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  }

  it('asks before a palette press that would change the document, naming it, and changes nothing yet', async () => {
    await openFile('Band', 132);
    const before = composer.doc;

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-tool="hammerOn"]')!.click();
    fixture.detectChanges();

    expect(promptOpen()).toBeTrue();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Hammer-on / pull-off would convert this file.');
    expect(prompt().textContent).toContain('Converting cannot be undone.');
    expect(composer.doc).toBe(before);
    expect(fixture.nativeElement.querySelector('.palette').hasAttribute('inert')).toBeTrue();
  });

  it('asks before an editing key the same way, and not before a caret move, which moves the file\'s caret', async () => {
    await openFileOfBars(2);

    press({ key: 'ArrowRight' });
    expect(promptOpen()).toBeFalse();
    expect(gp.caret?.cursor.barIndex).toBe(1);
    expect(composer.state.cursor.barIndex).withContext('the empty composition under the file').toBe(0);

    press({ key: 'Delete' });
    expect(promptOpen()).toBeTrue();
  });

  it("reads out the file's caret in the status line, not the empty composition's", async () => {
    await openFileOfBars(3);

    composer.setCursor({ barIndex: 2 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.readout')?.textContent).toContain('Bar 3 of 3');
  });

  /** Opens a file of one guitar track of `bars` one-beat bars. */
  async function openFileOfBars(bars: number): Promise<void> {
    const score = TestBed.inject(AlphaTexService).parse(['\\track "Guitar"', Array(bars).fill('3.3.1').join(' | ') + ' |'].join('\n')).score;
    if (!score) throw new Error('the file did not parse');
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('changes nothing on Cancel, and says nothing: the prompt was the message', async () => {
    await openFile('Band', 132);
    const before = composer.state;
    press({ key: 'h' });

    promptButton('Cancel').click();
    fixture.detectChanges();

    expect(promptOpen()).toBeFalse();
    expect(composer.state).toBe(before);
    expect(composer.state.refusal).toBeNull();
    expect(gp.isOriginal).toBeTrue();
  });

  it('cancels on Escape', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    press({ key: 'Escape' });

    expect(promptOpen()).toBeFalse();
    expect(gp.request).toBeNull();
  });

  it('asks before a save: the library holds compositions, and the file is not one yet', async () => {
    await openFile('Band', 132);
    let saves = 0;
    TestBed.inject(ComposerSaveRequests).requested$.subscribe(() => saves++);

    press({ code: 'KeyS', key: 's', ctrlKey: true });

    expect(promptOpen()).toBeTrue();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Save would convert this file.');
    expect(saves).toBe(0);
  });

  it('says a file that converts whole would change nothing', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });

    expect(prompt().querySelector('.whole')?.textContent?.trim()).toBe('Nothing in this file would change.');
  });

  it('lists what this file would lose, and what its first save would, under their own headings', async () => {
    const score = new alphaTab.model.Score();
    score.copyright = '2026';
    const masterBar = new alphaTab.model.MasterBar();
    masterBar.isDoubleBar = true;
    score.addMasterBar(masterBar);
    gp.open({ entryId: 'entry-1', fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    press({ key: 'h' });

    const sections = Array.from(prompt().querySelectorAll<HTMLElement>('.loss'));
    expect(sections.map(section => section.querySelector('h3')?.textContent?.trim())).toEqual([
      'What this file would lose',
      'What the first save would lose'
    ]);
    expect(sections[0].textContent).toContain('Credits');
    expect(sections[1].textContent).toContain('Double bar lines');
  });

  it('saves the untouched original under its own name, and stays open to convert after', async () => {
    await openFile('Band', 132);
    const download = spyOn(TestBed.inject(ComposerExportService), 'downloadOriginal');
    press({ key: 'h' });

    promptButton('Save the original file first').click();
    fixture.detectChanges();

    expect(download).toHaveBeenCalledWith(gp.original!.bytes, 'Band.gp');
    expect(promptOpen()).toBeTrue();
  });

  /** Resolves once `done` holds, checking every few milliseconds for up to two seconds: IndexedDB answers outside the zone. */
  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done() && waited < 2000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges();
  }

  it('converts on Convert: the composition saved, the file\'s entry gone, and the edit that asked applied on an empty history', async () => {
    const save = spyOn(TestBed.inject(ComposerLibraryService), 'save').and.resolveTo('composition-1');
    const gpLibrary = TestBed.inject(GpLibraryService);
    const entry = await gpLibrary.addBytes(new Uint8Array([1]).buffer, 'Band.gp', {});
    const score = new alphaTab.model.Score();
    score.title = 'Band';
    score.addMasterBar(new alphaTab.model.MasterBar());
    const track = new alphaTab.model.Track();
    track.addStaff(new alphaTab.model.Staff());
    score.addTrack(track);
    const bar = new alphaTab.model.Bar();
    track.staves[0].addBar(bar);
    bar.addVoice(new alphaTab.model.Voice());
    score.finish(new alphaTab.Settings());
    gp.open({ entryId: entry.id, fileName: 'Band.gp', bytes: new ArrayBuffer(4), score });
    fixture.detectChanges();
    press({ key: 'b', shiftKey: true });

    promptButton('Convert').click();
    fixture.detectChanges();
    await until(() => !gp.isOriginal);

    expect(promptOpen()).toBeFalse();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await gpLibrary.getEntry(entry.id)).toBeNull();
    expect(composer.doc.masterBars[0].isDoubleBar).toBeTrue();
    composer.undo();
    expect(composer.state.canUndo).toBeFalse();
    expect(fixture.nativeElement.querySelector('.original')).toBeNull();
  });

  it('closes the prompt on a refused conversion, stays in Original, and says why', async () => {
    spyOn(TestBed.inject(GpConversionService), 'convert').and.resolveTo({ kind: 'refused', reason: 'The track "Kit" uses drums alphaTex cannot name.' });
    await openFile('Band', 132);
    press({ key: 'h' });

    promptButton('Convert').click();
    await until(() => gp.request === null);

    expect(promptOpen()).toBeFalse();
    expect(gp.isOriginal).toBeTrue();
    expect(composer.state.refusal).toBe('The track "Kit" uses drums alphaTex cannot name.');
  });

  const statusText = (): string => fixture.nativeElement.querySelector('app-composer-status-line .messages')?.textContent ?? '';

  it('never leaves Convert stuck when the file cannot be read: the prompt closes, Convert is enabled again, and the status line says why', async () => {
    await openFile('Band', 132);
    press({ key: 'h' });
    spyOn(TestBed.inject(ScoreDocMapperService), 'toDoc').and.throwError('unreadable');

    promptButton('Convert').click();
    await until(() => gp.request === null);

    expect(promptOpen()).toBeFalse();
    expect(fixture.componentInstance.converting).toBeFalse();
    expect(promptButton('Convert').disabled).toBeFalse();
    expect(gp.isOriginal).toBeTrue();
    expect(statusText()).toContain('The file could not be read as a composition, so it was not converted: unreadable');
  });

  it('reports a conversion that throws, closes the prompt, and says the file could not be converted', async () => {
    const thrown = new Error('boom');
    spyOn(TestBed.inject(GpConversionService), 'convert').and.rejectWith(thrown);
    const handleError = spyOn(TestBed.inject(ErrorHandler), 'handleError');
    await openFile('Band', 132);
    press({ key: 'h' });

    promptButton('Convert').click();
    await until(() => gp.request === null && !fixture.componentInstance.converting);

    expect(handleError).toHaveBeenCalledWith(thrown);
    expect(promptOpen()).toBeFalse();
    expect(promptButton('Convert').disabled).toBeFalse();
    expect(composer.state.refusal).toBe('The file could not be converted.');
    expect(statusText()).toContain('The file could not be converted.');
  });

  it('lets nothing cancel a conversion under way: Escape, Cancel and the backdrop do nothing, and the page stays inert', async () => {
    let finish: (outcome: ConversionOutcome) => void = () => undefined;
    spyOn(TestBed.inject(GpConversionService), 'convert').and.returnValue(new Promise<ConversionOutcome>(resolve => (finish = resolve)));
    await openFile('Band', 132);
    press({ key: 'h' });
    promptButton('Convert').click();
    fixture.detectChanges();

    press({ key: 'Escape' });
    expect(promptOpen()).toBeTrue();
    expect(gp.request).not.toBeNull();

    expect(promptButton('Cancel').disabled).toBeTrue();
    fixture.componentInstance.cancelConvert();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.prompt-backdrop')?.click();
    fixture.detectChanges();
    expect(gp.request).not.toBeNull();

    gp.cancelEdit();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.palette').hasAttribute('inert')).toBeTrue();

    finish({ kind: 'refused', reason: 'Stopped.' });
    await until(() => !fixture.componentInstance.converting);
    expect(fixture.nativeElement.querySelector('.palette').hasAttribute('inert')).toBeFalse();
  });

  it("shows the file's own alphaTex, and asks before applying it", async () => {
    await openFile('Band', 132);
    const host = fixture.nativeElement as HTMLElement;
    const texButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.text-btn')).find(button => button.textContent?.trim() === 'alphaTex')!;
    texButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.texDraft).toBe(TestBed.inject(AlphaTexService).export(gp.original!.score));

    fixture.componentInstance.applyTex();
    fixture.detectChanges();
    expect(prompt().querySelector('h2')?.textContent?.trim()).toBe('Applying the alphaTex draft would convert this file.');
  });

  /** A one-track score written as a Guitar Pro 7 file, as a real `.gp` would arrive: there is no fixture in the repo. */
  function gpBytes(title: string): ArrayBuffer {
    const { score } = TestBed.inject(AlphaTexService).parse([`\\title "${title}"`, '\\tempo 90', '\\track "Guitar"', '3.3.4 3.3.4 3.3.4 3.3.4 |'].join('\n'));
    if (!score) throw new Error('the file did not parse');
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  it('opens /composer?gp=<id> in Original, and takes the query off the address', async () => {
    const entry = await TestBed.inject(GpLibraryService).addBytes(gpBytes('Riff'), 'riff.gp', {});
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/?gp=${entry.id}`);
    fixture.destroy();
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    await until(() => gp.isOriginal);

    expect(gp.original?.entryId).toBe(entry.id);
    expect(gp.original?.score.title).toBe('Riff');
    await until(() => !router.url.includes('gp='));
    expect(router.url).not.toContain('gp=');
  });

  it('says a file no longer in the library is gone, and stays in Composition', async () => {
    await TestBed.inject(Router).navigateByUrl('/?gp=missing');
    fixture.destroy();
    fixture = TestBed.createComponent(ComposerComponent);
    fixture.detectChanges();

    await until(() => composer.state.refusal !== null);

    expect(composer.state.refusal).toBe('That file is no longer in the library.');
    expect(gp.isOriginal).toBeFalse();
  });

  it('opens a .gp dropped on the page, and says why it ignores anything else', async () => {
    const drop = (files: File[]): void => {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      fixture.nativeElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    };

    drop([new File(['text'], 'notes.txt')]);
    await until(() => composer.state.refusal !== null);
    expect(composer.state.refusal).toBe('"notes.txt" is not a Guitar Pro file.');

    drop([new File([gpBytes('Dropped')], 'dropped.gp'), new File(['text'], 'notes.txt')]);
    await until(() => gp.isOriginal);
    expect(gp.original?.score.title).toBe('Dropped');
    await until(() => composer.state.notice !== null);
    expect(composer.state.notice).toBe('Opened "dropped.gp". 1 file was not a Guitar Pro file.');
  });

  it('gives the title and the BPM back once the file is gone', async () => {
    await openFile('Band', 132);
    gp.clear();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(titleInput().readOnly).toBe(false);
    expect(tempoInput().disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.original')).toBeNull();
  });
});
