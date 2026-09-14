import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
export type KeyEventLike = KeyPress & Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'preventDefault'>;

/**
 * The composer's keyboard, as a class the page calls from its one `document:keydown` listener.
 *
 * Lifted out of `ComposerComponent`, whose `switch` on `event.key` could not tell Ctrl+1 from 1 and read
 * form fields by tag name only. The keys are the tool table's (`COMPOSER_TOOLS`), so a key and its button
 * cannot drift apart.
 */
export class ComposerKeyHandler {
  constructor(
    private readonly host: ComposerToolHost,
    private readonly tools: readonly ComposerTool[] = COMPOSER_TOOLS
  ) {}

  /**
   * Runs the tool `event` means and claims the press, or leaves it alone and returns false.
   *
   * Left alone: a press something before this listener claimed - the shell's Escape, when it closed the
   * circle-of-fifths drawer - a press into a form field or a `contentEditable` element, and a press no
   * tool is bound to, which the browser keeps. Only a press a tool runs is `preventDefault`ed.
   */
  handle(event: KeyEventLike): boolean {
    if (event.defaultPrevented || isEditableTarget(event.target)) return false;
    const tool = toolForPress(event, this.tools);
    if (!tool) return false;

    event.preventDefault();
    tool.run(this.host, event);
    return true;
  }
}
