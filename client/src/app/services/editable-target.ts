/**
 * Whether a key press belongs to something the user is typing into.
 *
 * Asked by every page that binds document-wide shortcuts, before it takes a key: a letter typed into a
 * title field is a letter, and `Ctrl+Z` inside a text box is the browser's undo of the typing, which
 * `preventDefault` would take away. `<select>` is in the list because it reads its own key presses, and
 * `isContentEditable` because a rich-text field is neither tag - and is true for every element inside
 * one, not only the element carrying the attribute.
 *
 * Only inputs that are typed into count (`TYPED_INPUTS`). A checkbox, a radio, a range, a colour, a file
 * or a button input keeps the focus after a click, and a shortcut pressed next is meant for the page.
 *
 * Lifted from `progression.component.ts`, where it was private, when the composer's keyboard handler
 * needed the same answer: the composer's own check read tag names only and missed `contentEditable`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return TYPED_INPUTS.has(target.type);

  return target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** The input types text is typed into. `HTMLInputElement.type` reads `text` for a missing or unknown type. */
const TYPED_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

/**
 * Whether a key press is Space or Enter on a control the browser presses with that key: a button, a link, a
 * checkbox or radio, a `<summary>`, or an element with a pressable ARIA role. Shift does not change that;
 * Ctrl, Alt or Cmd does, and the press is the page's shortcut again.
 *
 * Asked before a page's document-wide shortcuts, which bind Space (play) and Shift+Enter (Section): a
 * focused button must still be pressed by the keys that press buttons, or a keyboard user cannot use it.
 */
export function pressesFocusedControl(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target'>): boolean {
  if ((event.key !== ' ' && event.key !== 'Enter') || event.ctrlKey || event.altKey || event.metaKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLButtonElement || target.tagName === 'SUMMARY') return true;
  if (target instanceof HTMLAnchorElement) return target.hasAttribute('href');
  if (target instanceof HTMLInputElement) return PRESSED_INPUTS.has(target.type);
  return PRESSED_ROLES.has(target.getAttribute('role') ?? '');
}

/** The input types Space or Enter presses. */
const PRESSED_INPUTS: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio']);

/** The ARIA roles of controls that Space or Enter presses. */
const PRESSED_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio'
]);
