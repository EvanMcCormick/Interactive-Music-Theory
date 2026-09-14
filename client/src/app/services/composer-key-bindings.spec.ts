import {
  BROWSER_RESERVED,
  KeyPress,
  bindingLabelOf,
  bindingMatches,
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

  it('matches a Ctrl or Alt combination by physical key, whatever the key produced', () => {
    // macOS Option+- produces an en dash.
    expect(bindingMatches({ code: 'Minus', alt: true }, press({ key: '–', code: 'Minus', altKey: true }))).toBeTrue();
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
