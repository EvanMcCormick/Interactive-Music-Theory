/**
 * Key bindings for the composer's tools: what a binding is, whether a key press matches one, and how one
 * is written in a tooltip and on the shortcut sheet.
 *
 * The rules are the design's, under "Shortcuts": modifiers exactly, with Cmd read as Ctrl; an Alt
 * combination by physical key, because macOS Option rewrites `key`; a Ctrl letter by the letter typed,
 * so Ctrl+Z is undo on QWERTZ and Ctrl+A select all on AZERTY, falling back to the physical key only
 * when no Latin letter was typed (a Cyrillic layout), and a Ctrl symbol by its key, then by the symbol typed
 * once no binding's own key matched (`bindingMatchesSymbol`: Dvorak moves `.` and `/`); a letter in either case with Shift exactly, by the
 * physical key on a layout with no Latin letters; a digit or symbol whatever Shift says, because which
 * symbols need Shift depends on the layout; a named key with Shift exactly. And one the design did not
 * state: a symbol typed through AltGr or Option (`bindingMatchesTyped`), asked only after every exact
 * binding has failed.
 */

import type { KeyPlatform } from './composer-key-platform';

/** One key press a tool answers to. Exactly one of `key` and `code`. */
export interface KeyBinding {
  /** `KeyboardEvent.key`: a lower-case letter, a digit, a symbol, or a named key such as `ArrowLeft` or `' '`. */
  key?: string;
  /** `KeyboardEvent.code`, for a combination held with Ctrl or Alt. */
  code?: string;
  /** Ctrl, or Cmd on a Mac. */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /**
   * How a Ctrl binding is held on a Mac, where Ctrl is otherwise Cmd - written ⌘ and matched from `metaKey`:
   * - `control`: the Control key itself, written ⌃ there and never matched from Cmd. For a press whose ⌘ form macOS or a
   *   Mac browser takes before the page sees it, such as ⌘+Shift+3, a screenshot.
   * - `none`: left out of a Mac's labels, since neither its ⌘ nor its ⌃ form reaches the page there - ⌘+Space is
   *   Spotlight, ⌃+Space the input source. Another binding of the same tool stands in. Matched as any Ctrl binding is.
   */
  mac?: 'control' | 'none';
}

/** The parts of a `KeyboardEvent` a binding is matched against. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * What a US keyboard types on each physical symbol key, without Shift and with it. A `code` binding names a key
 * by where a US keyboard has it, so these are the symbols it stands for wherever another layout moves them.
 * Browsers report `key` with Shift applied, so a Shift binding is typed as the second.
 */
const US_SYMBOLS: Readonly<Record<string, string>> = {
  Backquote: '`~',
  Minus: '-_',
  Equal: '=+',
  BracketLeft: '[{',
  BracketRight: ']}',
  Backslash: '\\|',
  Semicolon: ';:',
  Quote: '\'"',
  Comma: ',<',
  Period: '.>',
  Slash: '/?'
};

/** A Latin letter, the only letters a binding names. */
const isLetter = (key: string): boolean => /^[a-z]$/i.test(key);
const isDigit = (key: string): boolean => /^[0-9]$/.test(key);
/** A printable key whose Shift depends on the layout: one character, not a letter and not a space. */
const isShiftFree = (key: string): boolean => key.length === 1 && !isLetter(key) && key !== ' ';

/**
 * Whether `press` is exactly `binding`.
 *
 * A letter is matched by what was typed wherever a layout moves it. `KeyboardEvent.code` names the key a
 * US keyboard has there, so by code a German Ctrl+Z (typed on `KeyY`) would redo and a French Ctrl+A
 * (on `KeyQ`) would do nothing. Held with Ctrl, a letter still reports itself in `key`, so a `Key[A-Z]`
 * binding with Ctrl and no Alt is matched on `key`. Alt stays physical: macOS Option rewrites `key` to
 * another character. Where the layout types no Latin letter at all - Cyrillic `к` on `KeyR` - `key` says
 * nothing a binding can use, so the physical key decides, for a Ctrl letter and an unmodified one alike.
 *
 * A Ctrl press that typed a Latin letter is that letter's, and matches no other Ctrl binding by its
 * physical key: Dvorak types z on the key a US keyboard calls `Slash`, so its Ctrl+Z would otherwise be
 * undo by the letter and Ctrl+/ (triplet feel) by the key.
 *
 * A symbol typed on another key is not asked here: see `bindingMatchesSymbol`, which is asked only after this has
 * failed for every binding.
 */
export function bindingMatches(binding: KeyBinding, press: KeyPress): boolean {
  if ((press.ctrlKey || press.metaKey) !== !!binding.ctrl || press.altKey !== !!binding.alt) return false;
  if (binding.mac === 'control' && (!press.ctrlKey || press.metaKey)) return false;
  if (binding.code !== undefined) {
    if (press.shiftKey !== !!binding.shift) return false;
    const letter = /^Key([A-Z])$/.exec(binding.code)?.[1];
    if (binding.ctrl && !binding.alt && isLetter(press.key)) return letter !== undefined && press.key.toUpperCase() === letter;
    return press.code === binding.code;
  }

  const key = binding.key ?? '';
  if (isLetter(key)) {
    if (press.shiftKey !== !!binding.shift) return false;
    return isLetter(press.key) ? press.key.toLowerCase() === key.toLowerCase() : press.code === `Key${key.toUpperCase()}`;
  }
  if (isShiftFree(key)) return press.key === key;
  return press.key === key && press.shiftKey === !!binding.shift;
}

/**
 * Whether `press` typed, on another key, the symbol a US keyboard types on `binding`'s key (`US_SYMBOLS`), with Ctrl and
 * Shift exactly as bound. Dvorak types `.` on `KeyE`, `,` on `KeyW` and `/` on `BracketLeft`, so by physical key alone
 * its Ctrl+Shift+. (diminuendo), Ctrl+Shift+, (crescendo) and Ctrl+/ (triplet feel) were out of reach.
 *
 * Ask it only after `bindingMatches` has failed for every binding. AZERTY types `.` with Shift on `Comma`, which is
 * crescendo's own key, so asked beside the exact bindings it would be diminuendo's as well. A letter typed is that
 * letter's (`bindingMatches`), so it never matches a symbol.
 */
export function bindingMatchesSymbol(binding: KeyBinding, press: KeyPress): boolean {
  if (binding.code === undefined || !binding.ctrl || binding.alt || press.code === binding.code) return false;
  if (!(press.ctrlKey || press.metaKey) || press.altKey || press.shiftKey !== !!binding.shift) return false;
  if (binding.mac === 'control' && (!press.ctrlKey || press.metaKey)) return false;
  const symbols = US_SYMBOLS[binding.code];
  return symbols !== undefined && press.key.length === 1 && !isLetter(press.key) && symbols.includes(press.key);
}

/**
 * Whether `press` typed `binding`'s symbol through AltGr (Windows reports it as Ctrl+Alt) or Option
 * (Alt alone): the only way to type `}` on a German keyboard or `[` on a German Mac. Symbols only - never
 * a digit, so no Alt or AltGr press writes a fret - and never with Cmd or Ctrl alone. Ask it only after
 * every exact binding has failed, so Alt+/ is still the tuplet tool and not the triplet's `/`.
 */
export function bindingMatchesTyped(binding: KeyBinding, press: KeyPress): boolean {
  const key = binding.key;
  if (key === undefined || binding.ctrl || binding.alt || !isShiftFree(key) || isDigit(key)) return false;
  if (press.metaKey || !press.altKey) return false;
  return press.key === key;
}

/** Named keys as a tooltip prints them. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc'
};

/** Physical keys that are not letters or digits, as a tooltip prints them. */
const CODE_LABELS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Space: 'Space'
};

/**
 * Ctrl and Alt as each platform names them. A Ctrl binding is Cmd on a Mac (`bindingMatches` reads Cmd as Ctrl), and
 * Alt is Option, so a Mac label writes their symbols. Shift keeps its name: ⇧ is less often recognised, and the
 * sheet's `+` joins stay as they are on every platform.
 */
const MODIFIER_NAMES: Readonly<Record<KeyPlatform, { ctrl: string; alt: string }>> = {
  mac: { ctrl: '⌘', alt: '⌥' },
  other: { ctrl: 'Ctrl', alt: 'Alt' }
};

/**
 * How `binding` is written in a tooltip and on the shortcut sheet: `Ctrl+Shift+Z`, `Alt+-`, `?` - or `⌘+Shift+Z` and `⌥+-`
 * on a Mac, and `⌃+Shift+3` there for a binding held with Control (`KeyBinding.mac`).
 */
export function bindingLabelOf(binding: KeyBinding, platform: KeyPlatform = 'other'): string {
  const names = MODIFIER_NAMES[platform];
  const ctrl = platform === 'mac' && binding.mac === 'control' ? '⌃' : names.ctrl;
  const modifiers = [binding.ctrl ? ctrl : '', binding.alt ? names.alt : '', binding.shift ? 'Shift' : ''].filter(Boolean);
  let key: string;
  if (binding.code !== undefined) {
    const code = binding.code;
    key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : CODE_LABELS[code] ?? code;
  } else {
    const raw = binding.key ?? '';
    key = KEY_LABELS[raw] ?? (isLetter(raw) ? raw.toUpperCase() : raw);
  }
  return [...modifiers, key].join('+');
}

/**
 * Every binding's label (`bindingLabelOf`), in order, as a tooltip or the sheet lists a tool's keys - leaving out, on a
 * Mac, a binding that does not reach the page there (`mac: 'none'`), so a Mac user is never shown ⌘+Space.
 */
export function bindingLabelsOf(bindings: readonly KeyBinding[], platform: KeyPlatform = 'other'): string[] {
  return bindings.filter(binding => platform !== 'mac' || binding.mac !== 'none').map(binding => bindingLabelOf(binding, platform));
}

/**
 * One string per distinct press, for finding two bindings that would answer the same one: modifiers,
 * then the physical key. A letter or digit bound by `key` is written as its `code`, so `{ key: 'n' }`
 * and `{ code: 'KeyN' }` are the same key; a shift-free symbol writes `*` for Shift, since it matches
 * either way.
 */
export function bindingSignatureOf(binding: KeyBinding): string {
  const key = binding.key ?? '';
  const physical =
    binding.code ?? (isLetter(key) ? `Key${key.toUpperCase()}` : isDigit(key) ? `Digit${key}` : `key:${key}`);
  const shift = binding.code === undefined && isShiftFree(key) ? '*' : binding.shift ? 'S' : '-';
  return `${binding.ctrl ? 'C' : '-'}${binding.alt ? 'A' : '-'}${shift} ${physical}`;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * What the browser keeps, from the design's rule 1: Ctrl+N, Ctrl+T, Ctrl+W and their Shift forms,
 * Ctrl+Tab, Ctrl+1 to 9 (tab switching), Alt+letter (Firefox menus), F5, F11, F12 and Ctrl+Shift+Delete.
 * The tool table's spec checks no tool is bound to any of them.
 */
export const BROWSER_RESERVED: readonly KeyBinding[] = [
  ...['KeyN', 'KeyT', 'KeyW'].flatMap(code => [{ code, ctrl: true }, { code, ctrl: true, shift: true }]),
  { key: 'Tab', ctrl: true },
  { key: 'Tab', ctrl: true, shift: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => ({ code: `Digit${digit}`, ctrl: true })),
  ...LETTERS.map(letter => ({ code: `Key${letter}`, alt: true })),
  { key: 'F5' },
  { key: 'F11' },
  { key: 'F12' },
  { key: 'Delete', ctrl: true, shift: true }
];

/**
 * What a Mac takes with ⌘ before the page can claim it, written as Ctrl bindings, since Cmd is read as Ctrl. macOS:
 * ⌘+Space (Spotlight), ⌘+Tab and ⌘+` (switching apps and windows), ⌘+Q, ⌘+H, ⌘+M, ⌘+⌥+H and ⌘+⌥+M (quit, hide,
 * minimise), ⌘+, (settings), ⌘+Shift+/ (the Help menu's search), ⌘+⌥+Esc (Force Quit), ⌘+⌥+D (the Dock), and ⌘+Shift+3,
 * 4, 5 and 6 (screenshots). Chrome and Safari: ⌘+Y (history), ⌘+Shift+A (Chrome's tab search), ⌘+⌥+I and ⌘+⌥+J (developer
 * tools), and ⌘+Shift+Delete - `Backspace` to the browser, the key a Mac labels delete - which clears Chrome's browsing
 * data. ⌘+W, ⌘+T and ⌘+N are `BROWSER_RESERVED` already. The tool table's spec checks no binding pressed with ⌘ on a Mac is
 * one of them; a binding that needs one takes `mac: 'control'` or `mac: 'none'`.
 */
export const MAC_RESERVED: readonly KeyBinding[] = [
  { key: ' ', ctrl: true },
  { key: 'Tab', ctrl: true },
  { code: 'Backquote', ctrl: true },
  ...['KeyQ', 'KeyH', 'KeyM', 'KeyY'].map(code => ({ code, ctrl: true })),
  ...['KeyH', 'KeyM', 'KeyD', 'KeyI', 'KeyJ'].map(code => ({ code, ctrl: true, alt: true })),
  { key: 'Escape', ctrl: true, alt: true },
  { code: 'Comma', ctrl: true },
  { code: 'Slash', ctrl: true, shift: true },
  ...[3, 4, 5, 6].map(digit => ({ code: `Digit${digit}`, ctrl: true, shift: true })),
  { code: 'KeyA', ctrl: true, shift: true },
  { key: 'Backspace', ctrl: true, shift: true }
];
