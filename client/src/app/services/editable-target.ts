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
 * Whether a key press is one the browser presses the focused control with: Space or Enter on a button, a button
 * input, a `<summary>` or a `role="button"`; Enter alone on a link or a `role="link"`; Space alone on a checkbox, a
 * radio, or a `role` of checkbox, radio or switch. Shift does not change that; Ctrl, Alt or Cmd does, and the press is
 * the page's shortcut again. A key the browser does nothing with on that control - Space on a link - stays the page's.
 *
 * Only for a control focused from the keyboard, one that matches `:focus-visible`. A mouse click leaves the focus on
 * the button it pressed, and a Space pressed next is meant for the page - play - not for pressing that button again.
 *
 * Asked before a page's document-wide shortcuts, which bind Space (play) and Shift+Enter (Section): a
 * focused button must still be pressed by the keys that press buttons, or a keyboard user cannot use it.
 */
export function pressesFocusedControl(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target'>): boolean {
  if ((event.key !== ' ' && event.key !== 'Enter') || event.ctrlKey || event.altKey || event.metaKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return false;
  const pressedBy = keysPressingOf(target);
  return event.key === ' ' ? pressedBy.space : pressedBy.enter;
}

/** Which of Space and Enter the browser presses `target` with. */
function keysPressingOf(target: HTMLElement): { space: boolean; enter: boolean } {
  if (target instanceof HTMLButtonElement || target.tagName === 'SUMMARY') return { space: true, enter: true };
  if (target instanceof HTMLAnchorElement) return { space: false, enter: target.hasAttribute('href') };
  if (target instanceof HTMLInputElement) {
    return BUTTON_INPUTS.has(target.type) ? { space: true, enter: true } : { space: CHECKED_INPUTS.has(target.type), enter: false };
  }
  const role = target.getAttribute('role') ?? '';
  if (role === 'button') return { space: true, enter: true };
  return { space: CHECKED_ROLES.has(role), enter: role === 'link' };
}

/** The input types Space and Enter both press. */
const BUTTON_INPUTS: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'image']);

/** The input types only Space presses. */
const CHECKED_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio']);

/** The ARIA roles only Space presses. */
const CHECKED_ROLES: ReadonlySet<string> = new Set(['checkbox', 'radio', 'switch']);
