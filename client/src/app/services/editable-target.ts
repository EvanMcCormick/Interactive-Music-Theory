/**
 * Whether a key press belongs to something the user is typing into.
 *
 * Asked by every page that binds document-wide shortcuts, before it takes a key: a letter typed into a
 * title field is a letter, and `Ctrl+Z` inside a text box is the browser's undo of the typing, which
 * `preventDefault` would take away. `<select>` is in the list because it reads its own key presses, and
 * `isContentEditable` because a rich-text field is neither tag - and is true for every element inside
 * one, not only the element carrying the attribute.
 *
 * Lifted from `progression.component.ts`, where it was private, when the composer's keyboard handler
 * needed the same answer: the composer's own check read tag names only and missed `contentEditable`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
