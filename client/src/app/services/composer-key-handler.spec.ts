import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { ComposerKeyHandler, KeyEventLike } from './composer-key-handler';
import { ComposerToolHost } from './composer-tools';

describe('ComposerKeyHandler', () => {
  let composer: ComposerService;
  let host: jasmine.SpyObj<Omit<ComposerToolHost, 'composer'>> & { composer: ComposerService };
  let handler: ComposerKeyHandler;
  const attached: HTMLElement[] = [];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    composer = TestBed.inject(ComposerService);
    host = {
      composer,
      ...jasmine.createSpyObj('host', ['openPopover', 'toggleShortcutSheet', 'escape', 'playPause', 'playFromStart', 'requestSave', 'addTrack', 'typeFretDigit'])
    };
    handler = new ComposerKeyHandler(host);
  });

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  /** A key event with no modifiers, and `init` over it, whose `preventDefault` is a spy. */
  function press(init: Partial<KeyEventLike>): KeyEventLike & { preventDefault: jasmine.Spy } {
    return {
      key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      target: document.body, defaultPrevented: false, ...init, preventDefault: jasmine.createSpy('preventDefault')
    };
  }

  function attach<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    attached.push(element);
    return element;
  }

  it('leaves a press in a form field or a contentEditable element alone', () => {
    const editor = attach('div');
    editor.contentEditable = 'true';
    for (const target of [attach('input'), attach('textarea'), attach('select'), editor]) {
      const event = press({ key: '5', code: 'Digit5', target });

      expect(handler.handle(event)).withContext(target.tagName).toBeFalse();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(host.typeFretDigit).not.toHaveBeenCalled();
  });

  it('leaves Escape alone when the shell has already used it to close the drawer', () => {
    expect(handler.handle(press({ key: 'Escape', defaultPrevented: true }))).toBeFalse();
    expect(host.escape).not.toHaveBeenCalled();

    expect(handler.handle(press({ key: 'Escape' }))).toBeTrue();
    expect(host.escape).toHaveBeenCalled();
  });

  it('writes no fret for Ctrl, Alt or Cmd with a digit, and leaves the press to the browser', () => {
    for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const event = press({ key: '1', code: 'Digit1', ...modifier });

      expect(handler.handle(event)).toBeFalse();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(host.typeFretDigit).not.toHaveBeenCalled();

    handler.handle(press({ key: '1', code: 'Digit1' }));
    expect(host.typeFretDigit).toHaveBeenCalledWith(1);
  });

  it('moves a bar with Ctrl+arrow and extends with Shift+arrow, rather than stepping a beat', () => {
    handler.handle(press({ key: 'ArrowRight', ctrlKey: true }));
    expect(composer.state.cursor.barIndex).toBe(1);

    handler.handle(press({ key: 'ArrowRight', shiftKey: true }));
    expect(composer.state.anchor?.beatIndex).toBe(0);
    expect(composer.state.cursor.beatIndex).toBe(1);
  });

  it('undoes on Ctrl+Z and not on Ctrl+Alt+Z, which is AltGr+Z on Windows', () => {
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);

    expect(handler.handle(press({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(composer.state.canUndo).toBeTrue();

    handler.handle(press({ key: 'z', code: 'KeyZ', ctrlKey: true }));
    expect(composer.state.canUndo).toBeFalse();
  });

  it('rests on r and on R', () => {
    handler.handle(press({ key: 'r', code: 'KeyR' }));
    handler.handle(press({ key: 'R', code: 'KeyR' }));

    expect(composer.state.cursor.beatIndex).toBe(2);
  });

  it('opens the shortcut sheet on ?, and saves on Ctrl+S', () => {
    handler.handle(press({ key: '?', code: 'Slash', shiftKey: true }));
    handler.handle(press({ key: 's', code: 'KeyS', ctrlKey: true }));

    expect(host.toggleShortcutSheet).toHaveBeenCalled();
    expect(host.requestSave).toHaveBeenCalled();
  });

  it('inserts a beat on Insert and on Alt+Enter, and plays from the start on Ctrl+Space and Shift+Space', () => {
    handler.handle(press({ key: 'Insert' }));
    handler.handle(press({ key: 'Enter', altKey: true }));
    expect(composer.doc.tracks[0].staves[0].bars[0].voices[0].beats.length).toBe(6);

    handler.handle(press({ key: ' ', ctrlKey: true }));
    handler.handle(press({ key: ' ', shiftKey: true }));
    expect(host.playFromStart).toHaveBeenCalledTimes(2);
  });
});
