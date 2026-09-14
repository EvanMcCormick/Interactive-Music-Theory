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

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    attached.splice(0).forEach(node => node.remove());
  });

  /** A key event with no modifiers, and `init` over it, whose `preventDefault` is a spy. */
  function press(init: Partial<KeyEventLike>): KeyEventLike & { preventDefault: jasmine.Spy } {
    return {
      key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
      target: document.body, defaultPrevented: false, ...init, preventDefault: jasmine.createSpy('preventDefault')
    };
  }

  it('runs a held key\'s repeats only for moves and the like: a held toggle toggles once, a held Ctrl+S saves once', () => {
    handler.handle(press({ key: 'q', code: 'KeyQ' }));
    const held = press({ key: 'q', code: 'KeyQ', repeat: true });
    expect(handler.handle(held)).toBeTrue();
    expect(held.preventDefault).toHaveBeenCalled();
    expect(composer.state.entryMode).toBe('pen');

    handler.handle(press({ key: 's', code: 'KeyS', ctrlKey: true }));
    handler.handle(press({ key: 's', code: 'KeyS', ctrlKey: true, repeat: true }));
    expect(host.requestSave).toHaveBeenCalledTimes(1);

    handler.handle(press({ key: 'ArrowRight' }));
    handler.handle(press({ key: 'ArrowRight', repeat: true }));
    expect(composer.state.cursor.beatIndex).toBe(2);
  });

  it('leaves Ctrl+C and Ctrl+X to the browser while text outside the score is selected', () => {
    const words = attach('p');
    words.textContent = 'Some words on the page';
    const score = attach('div');
    score.textContent = 'The score';
    const scored = new ComposerKeyHandler(host, undefined, () => score);
    const copy = spyOn(composer, 'copy');
    const cut = spyOn(composer, 'cut');

    document.getSelection()?.selectAllChildren(words);
    const copyPress = press({ key: 'c', code: 'KeyC', ctrlKey: true });
    expect(scored.handle(copyPress)).toBeFalse();
    expect(copyPress.preventDefault).not.toHaveBeenCalled();
    expect(scored.handle(press({ key: 'x', code: 'KeyX', ctrlKey: true }))).toBeFalse();
    expect(copy).not.toHaveBeenCalled();
    expect(cut).not.toHaveBeenCalled();

    document.getSelection()?.selectAllChildren(score);
    expect(scored.handle(press({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeTrue();
    expect(copy).toHaveBeenCalled();
  });

  it('leaves Ctrl+C to the browser when a text selection runs from the score out into the page, either way', () => {
    const words = attach('p');
    words.textContent = 'Some words on the page';
    const score = attach('div');
    score.textContent = 'The score';
    const scored = new ComposerKeyHandler(host, undefined, () => score);
    const copy = spyOn(composer, 'copy');
    const inScore = score.firstChild as Text;
    const onPage = words.firstChild as Text;

    document.getSelection()?.setBaseAndExtent(inScore, 1, onPage, 4);
    expect(scored.handle(press({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeFalse();
    document.getSelection()?.setBaseAndExtent(onPage, 4, inScore, 1);
    expect(scored.handle(press({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeFalse();
    expect(copy).not.toHaveBeenCalled();

    document.getSelection()?.setBaseAndExtent(inScore, 1, inScore, 5);
    expect(scored.handle(press({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeTrue();
    expect(copy).toHaveBeenCalled();
  });

  it('saves on Ctrl+S even from a text field, so the browser\'s own Save dialog never opens', () => {
    const event = press({ key: 's', code: 'KeyS', ctrlKey: true, target: attach('input') });

    expect(handler.handle(event)).toBeTrue();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(host.requestSave).toHaveBeenCalled();
  });

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

  it('lets only the sheet\'s own key and Escape run while a modal is open, so no key edits the score behind it', () => {
    let modalOpen = true;
    const behind = new ComposerKeyHandler(host, undefined, () => null, () => modalOpen);
    composer.setNoteAtCursor({ kind: 'fretted', string: 1, fret: 3 }, false);
    composer.copy();
    const doc = composer.doc;

    // A key with no Ctrl, Alt or Cmd is left to the browser, which scrolls the sheet with the arrows, Space and the
    // scroll keys, and does nothing with the rest.
    for (const init of [
      { key: 'Delete' },
      { key: 'r', code: 'KeyR' },
      { key: '5', code: 'Digit5' },
      { key: 'ArrowRight' },
      { key: ' ', code: 'Space' },
      { key: 'Home' },
      { key: 'End' },
      { key: 'PageDown' }
    ]) {
      const event = press(init);
      expect(behind.handle(event)).withContext(init.key).toBeFalse();
      expect(event.preventDefault).withContext(init.key).not.toHaveBeenCalled();
    }

    // A binding with Ctrl, Alt or Cmd is claimed and dropped. Left to the browser, Ctrl+K would focus its search box and
    // Ctrl+S open its Save dialog, over the sheet, and neither is the sheet's.
    for (const init of [
      { key: 'k', code: 'KeyK', ctrlKey: true },
      { key: 'Home', ctrlKey: true },
      { key: 'v', code: 'KeyV', ctrlKey: true },
      { key: 's', code: 'KeyS', ctrlKey: true },
      { key: '-', code: 'Minus', altKey: true },
      { key: 'z', code: 'KeyZ', metaKey: true }
    ]) {
      const event = press(init);
      const name = `${init.ctrlKey ? 'Ctrl+' : init.altKey ? 'Alt+' : 'Cmd+'}${init.key}`;
      expect(behind.handle(event)).withContext(name).toBeTrue();
      expect(event.preventDefault).withContext(name).toHaveBeenCalled();
    }
    expect(composer.doc).toBe(doc);
    expect(composer.state.canUndo).toBeTrue();
    expect(composer.state.cursor.beatIndex).toBe(0);
    expect(host.typeFretDigit).not.toHaveBeenCalled();
    expect(host.openPopover).not.toHaveBeenCalled();
    expect(host.requestSave).not.toHaveBeenCalled();

    // Ctrl+C yields to a text selection, so it is left to the browser, which copies the sheet's text.
    const copy = spyOn(composer, 'copy');
    const copyPress = press({ key: 'c', code: 'KeyC', ctrlKey: true });
    expect(behind.handle(copyPress)).toBeFalse();
    expect(copyPress.preventDefault).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();

    behind.handle(press({ key: '?', code: 'Slash', shiftKey: true }));
    behind.handle(press({ key: 'Escape' }));
    expect(host.toggleShortcutSheet).toHaveBeenCalled();
    expect(host.escape).toHaveBeenCalled();

    modalOpen = false;
    behind.handle(press({ key: 'Delete' }));
    expect(composer.doc).not.toBe(doc);
  });
});
