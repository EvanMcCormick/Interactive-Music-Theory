import {
  BROWSER_RESERVED,
  KeyPress,
  bindingLabelOf,
  bindingLabelsOf,
  bindingMatches,
  bindingMatchesSymbol,
  bindingMatchesTyped,
  bindingSignatureOf
} from './composer-key-bindings';

/** A key press with no modifiers, and `init` over it. */
const press = (init: Partial<KeyPress>): KeyPress => ({
  key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init
});

describe('bindingMatches', () => {
  it('matches a letter in either case, with Shift exactly as bound', () => {
    expect(bindingMatches({ key: 'r' }, press({ key: 'r', code: 'KeyR' }))).toBeTrue();
    expect(bindingMatches({ key: 'r' }, press({ key: 'R', code: 'KeyR' }))).toBeTrue();
    expect(bindingMatches({ key: 'r' }, press({ key: 'R', code: 'KeyR', shiftKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 's', shift: true }, press({ key: 'S', code: 'KeyS', shiftKey: true }))).toBeTrue();
  });

  it('matches a symbol or a digit whatever Shift says', () => {
    expect(bindingMatches({ key: '?' }, press({ key: '?', code: 'Slash', shiftKey: true }))).toBeTrue();
    expect(bindingMatches({ key: '1' }, press({ key: '1', code: 'Digit1', shiftKey: true }))).toBeTrue();
  });

  it('matches a named key with Shift exactly, so Space and Shift+Space differ', () => {
    expect(bindingMatches({ key: ' ' }, press({ key: ' ', code: 'Space' }))).toBeTrue();
    expect(bindingMatches({ key: ' ' }, press({ key: ' ', code: 'Space', shiftKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 'ArrowLeft', shift: true }, press({ key: 'ArrowLeft', shiftKey: true }))).toBeTrue();
  });

  it('checks Ctrl and Alt exactly, reading Cmd as Ctrl', () => {
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', metaKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(bindingMatches({ key: '1' }, press({ key: '1', code: 'Digit1', ctrlKey: true }))).toBeFalse();
    expect(bindingMatches({ key: 'ArrowRight' }, press({ key: 'ArrowRight', ctrlKey: true }))).toBeFalse();
  });

  it('matches a binding held with Control on a Mac from the Control key only, never Cmd', () => {
    const dynamic = { code: 'Digit3', ctrl: true, shift: true, mac: 'control' } as const;

    expect(bindingMatches(dynamic, press({ key: '#', code: 'Digit3', ctrlKey: true, shiftKey: true }))).toBeTrue();
    expect(bindingMatches(dynamic, press({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true }))).toBeFalse();
    expect(bindingMatches(dynamic, press({ key: '#', code: 'Digit3', ctrlKey: true, metaKey: true, shiftKey: true }))).toBeFalse();
    // One the Mac leaves out of its labels still matches as a Ctrl binding does.
    expect(bindingMatches({ key: ' ', ctrl: true, mac: 'none' }, press({ key: ' ', code: 'Space', metaKey: true }))).toBeTrue();
  });

  it('matches a Ctrl or Alt combination by physical key, whatever the key produced', () => {
    // macOS Option+- produces an en dash.
    expect(bindingMatches({ code: 'Minus', alt: true }, press({ key: '–', code: 'Minus', altKey: true }))).toBeTrue();
  });

  it('matches Ctrl with a letter by the letter typed, and by the physical key only when no Latin letter was', () => {
    // German QWERTZ types z on KeyY. By physical key, its Ctrl+Z would redo.
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'KeyY', ctrlKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'y', code: 'KeyZ', ctrlKey: true }))).toBeFalse();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true, shift: true }, press({ key: 'Z', code: 'KeyY', ctrlKey: true, shiftKey: true }))).toBeTrue();
    // Russian types я on KeyZ: no Latin letter, so the physical key decides.
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toBeTrue();
  });

  it('never matches a Ctrl binding by physical key when the press typed a Latin letter of its own', () => {
    // Dvorak types z on Slash: Ctrl+Z there is undo's, not Ctrl+/'s.
    expect(bindingMatches({ code: 'Slash', ctrl: true }, press({ key: 'z', code: 'Slash', ctrlKey: true }))).toBeFalse();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'Slash', ctrlKey: true }))).toBeTrue();
    expect(bindingMatches({ code: 'Slash', ctrl: true }, press({ key: '/', code: 'Slash', ctrlKey: true }))).toBeTrue();
  });

  it('matches a Ctrl symbol binding by the symbol typed where the layout moves that symbol, only as a fallback', () => {
    // Dvorak types . and > on the key a US keyboard calls KeyE, , and < on KeyW, and / on BracketLeft, so by
    // physical key its Ctrl+Shift+. (diminuendo), Ctrl+Shift+, (crescendo) and Ctrl+/ (triplet feel) were out of reach.
    expect(bindingMatchesSymbol({ code: 'Period', ctrl: true, shift: true }, press({ key: '>', code: 'KeyE', ctrlKey: true, shiftKey: true }))).toBeTrue();
    expect(bindingMatchesSymbol({ code: 'Comma', ctrl: true, shift: true }, press({ key: '<', code: 'KeyW', ctrlKey: true, shiftKey: true }))).toBeTrue();
    expect(bindingMatchesSymbol({ code: 'Slash', ctrl: true }, press({ key: '/', code: 'BracketLeft', ctrlKey: true }))).toBeTrue();
    // Asked only after every binding's own key: AZERTY types . with Shift on Comma, which is crescendo's.
    expect(bindingMatches({ code: 'Period', ctrl: true, shift: true }, press({ key: '.', code: 'Comma', ctrlKey: true, shiftKey: true }))).toBeFalse();
    expect(bindingMatches({ code: 'Comma', ctrl: true, shift: true }, press({ key: '.', code: 'Comma', ctrlKey: true, shiftKey: true }))).toBeTrue();
    // Still exact about Shift, and a letter typed on the US symbol's key is that letter's.
    expect(bindingMatchesSymbol({ code: 'Period', ctrl: true, shift: true }, press({ key: '.', code: 'KeyE', ctrlKey: true }))).toBeFalse();
    expect(bindingMatchesSymbol({ code: 'Period', ctrl: true, shift: true }, press({ key: 'V', code: 'Period', ctrlKey: true, shiftKey: true }))).toBeFalse();
    expect(bindingMatchesSymbol({ code: 'Slash', ctrl: true }, press({ key: 'z', code: 'Slash', ctrlKey: true }))).toBeFalse();
    expect(bindingMatches({ code: 'KeyZ', ctrl: true }, press({ key: 'z', code: 'Slash', ctrlKey: true }))).toBeTrue();
  });

  it('matches an unmodified letter by its physical key when the layout typed no Latin letter', () => {
    expect(bindingMatches({ key: 'r' }, press({ key: 'к', code: 'KeyR' }))).toBeTrue();
    expect(bindingMatches({ key: 'r' }, press({ key: 'к', code: 'KeyT' }))).toBeFalse();
    expect(bindingMatches({ key: 'r' }, press({ key: 'К', code: 'KeyR', shiftKey: true }))).toBeFalse();
  });
});

describe('bindingMatchesTyped', () => {
  it('matches a symbol typed through AltGr or Option', () => {
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'Digit0', ctrlKey: true, altKey: true }))).toBeTrue();
    expect(bindingMatchesTyped({ key: '[' }, press({ key: '[', code: 'Digit5', altKey: true }))).toBeTrue();
  });

  it('never relaxes a digit, a letter, a named key, Ctrl alone or Cmd', () => {
    expect(bindingMatchesTyped({ key: '1' }, press({ key: '1', code: 'Digit1', altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: 'q' }, press({ key: 'q', code: 'KeyQ', ctrlKey: true, altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: 'Home' }, press({ key: 'Home', altKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'BracketRight', ctrlKey: true }))).toBeFalse();
    expect(bindingMatchesTyped({ key: '}' }, press({ key: '}', code: 'BracketRight', metaKey: true, altKey: true }))).toBeFalse();
  });
});

describe('bindingLabelOf', () => {
  it('writes modifiers, then the key as printed', () => {
    expect(bindingLabelOf({ code: 'KeyZ', ctrl: true, shift: true })).toBe('Ctrl+Shift+Z');
    expect(bindingLabelOf({ code: 'Minus', alt: true })).toBe('Alt+-');
    expect(bindingLabelOf({ key: 's', shift: true })).toBe('Shift+S');
    expect(bindingLabelOf({ key: ' ', shift: true })).toBe('Shift+Space');
    expect(bindingLabelOf({ key: 'ArrowLeft', ctrl: true })).toBe('Ctrl+←');
    expect(bindingLabelOf({ key: 'Escape' })).toBe('Esc');
    expect(bindingLabelOf({ code: 'Digit3', ctrl: true, shift: true })).toBe('Ctrl+Shift+3');
    expect(bindingLabelOf({ key: '?' })).toBe('?');
  });

  it('writes Ctrl as ⌘ and Alt as ⌥ on a Mac, leaving Shift and the key as they are', () => {
    expect(bindingLabelOf({ code: 'KeyZ', ctrl: true, shift: true }, 'mac')).toBe('⌘+Shift+Z');
    expect(bindingLabelOf({ code: 'Minus', alt: true }, 'mac')).toBe('⌥+-');
    expect(bindingLabelOf({ key: 'ArrowUp', ctrl: true, alt: true }, 'mac')).toBe('⌘+⌥+↑');
    expect(bindingLabelOf({ key: 's', shift: true }, 'mac')).toBe('Shift+S');
    expect(bindingLabelOf({ key: 'ArrowUp', ctrl: true, alt: true }, 'other')).toBe('Ctrl+Alt+↑');
  });

  it('writes a binding held with Control on a Mac as ⌃ there, and as Ctrl elsewhere', () => {
    expect(bindingLabelOf({ code: 'Digit3', ctrl: true, shift: true, mac: 'control' }, 'mac')).toBe('⌃+Shift+3');
    expect(bindingLabelOf({ code: 'Digit3', ctrl: true, shift: true, mac: 'control' }, 'other')).toBe('Ctrl+Shift+3');
  });
});

describe('bindingLabelsOf', () => {
  it('writes every binding, leaving out on a Mac those a Mac takes before the page', () => {
    const bindings = [{ key: ' ', ctrl: true, mac: 'none' }, { key: ' ', shift: true }] as const;

    expect(bindingLabelsOf(bindings, 'mac')).toEqual(['Shift+Space']);
    expect(bindingLabelsOf(bindings, 'other')).toEqual(['Ctrl+Space', 'Shift+Space']);
    expect(bindingLabelsOf(bindings)).toEqual(['Ctrl+Space', 'Shift+Space']);
  });
});

describe('bindingSignatureOf and BROWSER_RESERVED', () => {
  it('writes a letter bound by key and by code the same way, so collisions are found', () => {
    expect(bindingSignatureOf({ key: 'n', ctrl: true })).toBe(bindingSignatureOf({ code: 'KeyN', ctrl: true }));
  });

  it('reserves the browser\'s keys from the design', () => {
    const reserved = new Set(BROWSER_RESERVED.map(bindingSignatureOf));

    expect(reserved.has(bindingSignatureOf({ code: 'KeyT', ctrl: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ code: 'Digit9', ctrl: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ code: 'KeyS', alt: true }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ key: 'F5' }))).toBeTrue();
    expect(reserved.has(bindingSignatureOf({ key: 'Delete', ctrl: true, shift: true }))).toBeTrue();
  });
});
