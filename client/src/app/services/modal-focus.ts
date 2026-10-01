/** What can take the focus by Tab inside a modal. */
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The focus of a modal dialog the page draws over itself: the shortcut sheet and the conversion prompt.
 *
 * Opening it moves the focus to its heading and remembers what had it; Tab goes round inside it; and closing it gives the
 * focus back - or, when that element has left the page, to a fallback, the score. The page makes its own content `inert`
 * while a modal is open, so the focus cannot get there either, and closes the modal by setting its `open` input,
 * whichever way it was closed, so the focus is handled here once.
 *
 * Lifted out of `ComposerShortcutSheetComponent` when the conversion prompt became the page's second modal. A plain
 * class the component owns and calls from its own hooks: `openChanged` from `ngOnChanges`, `afterViewChecked` from
 * `ngAfterViewChecked`, and `trapTab` from the dialog's `keydown`.
 */
export class ModalFocus {
  /** What had the focus when the modal opened. */
  private returnFocusTo: HTMLElement | null = null;
  /**
   * Set on opening, and acted on once the view has shown the modal: `open` changes before the view does, and an
   * element still under `display: none` cannot take the focus.
   */
  private focusOnRender = false;
  /**
   * Set on closing, and acted on once the view is checked: the page makes itself `inert` while the modal is open, and
   * an inert element cannot take the focus. By `ngAfterViewChecked` every binding in the page's template has been
   * applied, whatever order the page wrote them in, so the page is no longer inert. What had the focus is still read
   * on opening, in `ngOnChanges`, before the bindings after the modal make the page inert.
   */
  private focusBackOnRender = false;

  /** The modal's `open` input changed from `wasOpen` to `open`. */
  openChanged(open: boolean, wasOpen: boolean): void {
    if (open && !wasOpen) {
      const active = document.activeElement;
      this.returnFocusTo = active instanceof HTMLElement ? active : null;
      this.focusOnRender = true;
      this.focusBackOnRender = false;
    } else if (!open && wasOpen) {
      this.focusOnRender = false;
      this.focusBackOnRender = true;
    }
  }

  /**
   * Moves the focus to `heading` once the modal is shown, or back once it has closed. `dialog` is the modal's element,
   * and `fallback` is asked as the modal closes - not when the page binds it, since the page's element can be a view
   * query that is unset until it renders.
   */
  afterViewChecked(heading: HTMLElement | undefined, dialog: HTMLElement | undefined, fallback: () => HTMLElement | null): void {
    if (this.focusBackOnRender) {
      this.focusBackOnRender = false;
      this.giveFocusBack(dialog, fallback);
      return;
    }
    if (!this.focusOnRender) return;
    this.focusOnRender = false;
    heading?.focus();
  }

  /** Keeps Tab inside the open `dialog`, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent, open: boolean, dialog: HTMLElement | undefined): void {
    if (event.key !== 'Tab' || !open || !dialog) return;
    const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE));
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const onAControl = tabbable.some(element => element === active);
    const leaving = event.shiftKey ? active === first || !onAControl : active === last || !onAControl;
    if (!leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  /**
   * Gives the focus back to what had it before the modal opened, or to `fallback` when that has left the page or
   * was the page itself. Only while the focus is still the modal's: a click outside that closed it has already put
   * the focus where the user wanted it.
   */
  private giveFocusBack(dialog: HTMLElement | undefined, fallback: () => HTMLElement | null): void {
    const saved = this.returnFocusTo;
    this.returnFocusTo = null;
    this.focusOnRender = false;
    const active = document.activeElement;
    const stillOurs = active === null || active === document.body || !!dialog?.contains(active);
    if (!stillOurs) return;
    const target = saved && saved.isConnected && saved !== document.body ? saved : fallback();
    target?.focus();
  }
}
