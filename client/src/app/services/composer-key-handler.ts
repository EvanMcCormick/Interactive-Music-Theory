import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
export type KeyEventLike = KeyPress & Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'preventDefault' | 'repeat'>;

/**
 * The composer's keyboard, as a class the page calls from its one `document:keydown` listener.
 *
 * Lifted out of `ComposerComponent`, whose `switch` on `event.key` could not tell Ctrl+1 from 1 and read
 * form fields by tag name only. The keys are the tool table's (`COMPOSER_TOOLS`), so a key and its button
 * cannot drift apart.
 */
export class ComposerKeyHandler {
  /**
   * @param scoreElement The element the score is drawn in, or null. A text selection inside it is the
   *   score's, not the page's, so Ctrl+C there still copies beats.
   */
  constructor(
    private readonly host: ComposerToolHost,
    private readonly tools: readonly ComposerTool[] = COMPOSER_TOOLS,
    private readonly scoreElement: () => Element | null = () => null
  ) {}

  /**
   * Runs the tool `event` means and claims the press, or leaves it alone and returns false.
   *
   * Left alone: a press something before this listener claimed - the shell's Escape, when it closed the
   * circle-of-fifths drawer - a press no tool is bound to, which the browser keeps; a press into a form
   * field or a `contentEditable` element, unless the tool runs from one (Ctrl+S, `inTextFields`); and
   * Ctrl+C or Ctrl+X while text outside the score is selected (`yieldsToTextSelection`), so ordinary
   * copying works on the page.
   *
   * A press a tool is bound to is claimed. An auto-repeat of a held key runs the tool again only when it is
   * `repeatable`; otherwise it is claimed and dropped, so holding a toggle's key does not flicker it and
   * holding Ctrl+S does not save over and over.
   */
  handle(event: KeyEventLike): boolean {
    if (event.defaultPrevented) return false;
    const tool = toolForPress(event, this.tools);
    if (!tool) return false;
    if (isEditableTarget(event.target) && !tool.inTextFields) return false;
    if (tool.yieldsToTextSelection && textSelectedOutside(this.scoreElement())) return false;

    event.preventDefault();
    if (event.repeat && !tool.repeatable) return true;
    tool.run(this.host, event);
    return true;
  }
}

/** Whether the page has a non-collapsed text selection that does not start inside `score`. */
function textSelectedOutside(score: Element | null): boolean {
  const selection = typeof document === 'undefined' ? null : document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  return !(score && node && score.contains(node));
}
