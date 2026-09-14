import { KeyPress } from './composer-key-bindings';
import { COMPOSER_TOOLS, ComposerTool, ComposerToolHost, toolForPress } from './composer-tools';
import { isEditableTarget } from './editable-target';

/** The parts of a `KeyboardEvent` the handler reads. */
export type KeyEventLike = KeyPress & Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'preventDefault' | 'repeat'>;

/**
 * The tools a key still runs while a modal - the shortcut sheet - is open: the sheet's own key, which closes it, and
 * Escape. Every other tool acts on the score, which is hidden behind the modal, so a key pressed while reading the
 * sheet must not delete a beat or write a fret nobody can see.
 */
export const TOOLS_OVER_A_MODAL: ReadonlySet<string> = new Set(['shortcutSheet', 'escape']);

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
   * @param modalOpen Whether a modal is open over the page - the shortcut sheet - so that only `TOOLS_OVER_A_MODAL`
   *   run. Asked on every press, so the page answers from its own state.
   */
  constructor(
    private readonly host: ComposerToolHost,
    private readonly tools: readonly ComposerTool[] = COMPOSER_TOOLS,
    private readonly scoreElement: () => Element | null = () => null,
    private readonly modalOpen: () => boolean = () => false
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
   * While a modal is open, every press but the sheet's key and Escape (`TOOLS_OVER_A_MODAL`) is left alone too, as
   * a press in a text field is, so the browser scrolls the sheet with the arrow keys and Space. A tool that runs from
   * a text field is claimed and dropped instead: Ctrl+S runs there so that the browser's Save dialog never opens, and
   * it should not open over the sheet either.
   *
   * A press a tool is bound to is claimed. An auto-repeat of a held key runs the tool again only when it is
   * `repeatable`; otherwise it is claimed and dropped, so holding a toggle's key does not flicker it and
   * holding Ctrl+S does not save over and over.
   */
  handle(event: KeyEventLike): boolean {
    if (event.defaultPrevented) return false;
    const tool = toolForPress(event, this.tools);
    if (!tool) return false;
    if (this.modalOpen() && !TOOLS_OVER_A_MODAL.has(tool.id)) {
      if (!tool.inTextFields) return false;
      event.preventDefault();
      return true;
    }
    if (isEditableTarget(event.target) && !tool.inTextFields) return false;
    if (tool.yieldsToTextSelection && textSelectedOutside(this.scoreElement())) return false;

    event.preventDefault();
    if (event.repeat && !tool.repeatable) return true;
    tool.run(this.host, event);
    return true;
  }
}

/**
 * Whether the page has a non-collapsed text selection that is not wholly inside `score`: either end - where
 * the drag started, or where it ended - outside. A selection dragged from the score out into page text holds
 * page text, so Ctrl+C there is the browser's.
 */
function textSelectedOutside(score: Element | null): boolean {
  const selection = typeof document === 'undefined' ? null : document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const inScore = (node: Node | null): boolean => !!(score && node && score.contains(node));
  return !(inScore(selection.anchorNode) && inScore(selection.focusNode));
}
