import { Node } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { NodeView, ViewMutationRecord } from 'prosemirror-view';
import type { SectionKind } from '../../../models/song.model';
import {
  SongEdit,
  commandOf,
  deleteSection,
  duplicateSection,
  moveSection,
  renameSection
} from '../../../services/song-commands';
import { sectionHeadingOf } from '../../../services/song-editor-plugins';

/**
 * A section on the sheet: its header - `[Verse 1]` and a ⋮ menu - over the section's lines.
 *
 * The header is not text in the document. It is drawn by this node view outside the section's `contentDOM`, marked
 * `contenteditable=false`, and ProseMirror is told to leave its events and its DOM alone (`stopEvent`,
 * `ignoreMutation`), so the caret never enters it and a click on its menu is the menu's. The label it shows is the
 * section node's `label` attribute, changed only through the menu's Rename - a command, so an undo step.
 *
 * Built with the DOM directly rather than as an Angular component: a node view is made and thrown away by
 * ProseMirror as sections are added, moved and undone, and an Angular view per section would have to be created,
 * attached and destroyed in step with it for a header and five buttons.
 */

/** What the sheet gives each section header: a way to run its commands, and to say what it did. */
export interface SectionHost {
  /** Runs `edit` on the sheet's view; true when it changed the song, false when refused (and reported) or unchanged. */
  run(edit: SongEdit): boolean;
  /** The editor's state now, to ask which menu items could run. */
  state(): EditorState;
  /** A polite message for the page's live region. */
  notify(message: string): void;
  /** Gives the focus back to the lyrics. */
  focusEditor(): void;
  /** Focuses the ⋮ button of the section `id`, wherever it now is. */
  focusSectionMenu(id: string): void;
}

/** How each kind is written where the sheet names one: the "+ Section" menu, and a header whose label does not say it. */
export const SECTION_KIND_NAMES: Readonly<Record<SectionKind, string>> = Object.freeze({
  intro: 'Intro',
  verse: 'Verse',
  pre: 'Pre-Chorus',
  chorus: 'Chorus',
  bridge: 'Bridge',
  outro: 'Outro',
  other: 'Section'
});

type MenuAction = 'rename' | 'up' | 'down' | 'duplicate' | 'delete';

const MENU_ITEMS: readonly { action: MenuAction; text: string }[] = [
  { action: 'rename', text: 'Rename' },
  { action: 'up', text: 'Move up' },
  { action: 'down', text: 'Move down' },
  { action: 'duplicate', text: 'Duplicate' },
  { action: 'delete', text: 'Delete' }
];

/** Gives each menu a distinct id for `aria-controls`; a section's own id would repeat while a copy is being pasted. */
let menuCount = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  return created;
}

/**
 * The kind a renamed section takes: the kind its new name says, when the name is one of the six section words
 * (`sectionHeadingOf`, the `[Chorus]` rule's reading), and otherwise the kind it had. Renaming "Verse 1" to "Chorus"
 * makes it a chorus, as typing `[Chorus]` would; renaming a chorus to "Hook" keeps it a chorus, since "Hook" says
 * nothing about what it is.
 */
export function renamedKindOf(label: string, current: SectionKind): SectionKind {
  const heading = sectionHeadingOf(label);
  return heading === null || heading.kind === 'other' ? current : heading.kind;
}

export class SectionView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;

  private readonly header: HTMLElement;
  private readonly labelText: HTMLElement;
  private readonly kindTag: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly items: HTMLButtonElement[];
  private readonly renameField: HTMLInputElement;
  private renaming = false;

  constructor(
    private node: Node,
    private readonly host: SectionHost
  ) {
    this.dom = element('section', 'song-section');
    this.header = element('div', 'song-section-header');
    this.header.contentEditable = 'false';

    this.heading = element('span', 'song-section-label');
    const open = element('span', 'song-section-bracket');
    open.textContent = '[';
    open.setAttribute('aria-hidden', 'true');
    const close = element('span', 'song-section-bracket');
    close.textContent = ']';
    close.setAttribute('aria-hidden', 'true');
    this.labelText = element('span', 'song-section-name');
    this.heading.append(open, this.labelText, close);
    this.kindTag = element('span', 'song-section-kind');

    this.renameField = element('input', 'song-section-rename');
    this.renameField.type = 'text';
    this.renameField.hidden = true;
    this.renameField.setAttribute('aria-label', 'Section name');
    this.renameField.addEventListener('keydown', this.onRenameKey);
    this.renameField.addEventListener('blur', this.onRenameBlur);

    const menuId = `song-section-menu-${++menuCount}`;
    this.toggle = element('button', 'song-section-menu-toggle');
    this.toggle.type = 'button';
    this.toggle.textContent = '⋮';
    this.toggle.setAttribute('aria-haspopup', 'menu');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-controls', menuId);
    this.toggle.addEventListener('click', this.onToggle);

    this.menu = element('div', 'song-section-menu');
    this.menu.id = menuId;
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.menu.addEventListener('keydown', this.onMenuKey);
    this.items = MENU_ITEMS.map(({ action, text }) => {
      const item = element('button', 'song-section-menu-item');
      item.type = 'button';
      item.textContent = text;
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
      item.dataset['action'] = action;
      item.addEventListener('click', () => this.choose(action));
      return item;
    });
    this.menu.append(...this.items);

    const menuWrap = element('div', 'song-section-menu-wrap');
    menuWrap.append(this.toggle, this.menu);
    this.header.append(this.heading, this.renameField, this.kindTag, menuWrap);

    this.contentDOM = element('div', 'song-section-body');
    this.dom.append(this.header, this.contentDOM);
    this.render();
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /** Every event in the header is the header's: ProseMirror must not turn a click on ⋮ into a caret. */
  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.header.contains(event.target);
  }

  /** Only the lines are ProseMirror's to re-read; the header and the section's own attributes are this view's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    document.removeEventListener('mousedown', this.onOutside, true);
  }

  private get id(): string {
    return this.node.attrs['id'];
  }

  private get label(): string {
    return this.node.attrs['label'];
  }

  private get kind(): SectionKind {
    return this.node.attrs['kind'];
  }

  /** The header for the node now: its label, its kind when the label does not say it, and its menu's name. */
  private render(): void {
    this.dom.dataset['sectionId'] = this.id ?? '';
    this.dom.dataset['kind'] = this.kind;
    this.labelText.textContent = this.label;
    // "Verse 2" says it is a verse; "Middle eight" does not say it is a bridge, so the kind is shown beside it.
    const said = sectionHeadingOf(this.label)?.kind;
    this.kindTag.textContent = said === this.kind ? '' : SECTION_KIND_NAMES[this.kind];
    this.kindTag.hidden = said === this.kind;
    this.toggle.setAttribute('aria-label', `${this.label}: section menu`);
    this.menu.setAttribute('aria-label', this.label);
  }

  // -------------------------------------------------------------------------
  // The menu
  // -------------------------------------------------------------------------

  private readonly onToggle = (): void => {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu(true);
  };

  /**
   * Opens the menu with the focus on its first item. Each item that could not run now - Move up on the first section,
   * Delete on the only one - is dimmed (`aria-disabled`) but stays in the menu and can still be pressed, which says why
   * not in the live region rather than leaving the reader to guess.
   */
  private openMenu(): void {
    const state = this.host.state();
    for (const item of this.items) {
      const edit = this.editFor(item.dataset['action'] as MenuAction);
      const runnable = edit === null || commandOf(edit)(state);
      item.setAttribute('aria-disabled', String(!runnable));
    }
    this.menu.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.toggle.classList.add('on');
    document.addEventListener('mousedown', this.onOutside, true);
    this.items[0].focus();
  }

  private closeMenu(refocus: boolean): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.classList.remove('on');
    document.removeEventListener('mousedown', this.onOutside, true);
    if (refocus) this.toggle.focus();
  }

  /** A press anywhere outside the menu and its button closes it, leaving the focus wherever the press put it. */
  private readonly onOutside = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof globalThis.Node && (this.menu.contains(target) || this.toggle.contains(target))) return;
    this.closeMenu(false);
  };

  /** The menu's keys, as the ARIA menu pattern has them: arrows walk it and wrap, Home and End jump, Escape and Tab leave. */
  private readonly onMenuKey = (event: KeyboardEvent): void => {
    const index = this.items.findIndex(item => item === document.activeElement);
    const last = this.items.length - 1;
    const move = (to: number): void => {
      event.preventDefault();
      this.items[to].focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(index >= last ? 0 : index + 1);
      case 'ArrowUp':
        return move(index <= 0 ? last : index - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(last);
      case 'Escape':
        event.preventDefault();
        // The shell closes its drawer on Escape too; this one is the menu's.
        event.stopPropagation();
        return this.closeMenu(true);
      case 'Tab':
        return this.closeMenu(false);
    }
  };

  /** The edit an item runs, or null for Rename, which opens a field first. */
  private editFor(action: MenuAction): SongEdit | null {
    switch (action) {
      case 'rename':
        return null;
      case 'up':
        return moveSection(this.id, -1);
      case 'down':
        return moveSection(this.id, 1);
      case 'duplicate':
        return duplicateSection(this.id);
      case 'delete':
        return deleteSection(this.id);
    }
  }

  /**
   * Runs an item, then puts the focus where the user will want it next.
   *
   * - **Move up / down**: back on this section's ⋮, wherever the section now is - a moved section is a new node view,
   *   so the button is found again by id - so pressing again moves it again.
   * - **Duplicate**: in the copy's first line, where the command puts the caret.
   * - **Delete**: in the lyrics, since the menu went with its section. **No confirm**: a deleted section is one Undo
   *   away (Ctrl+Z, or the toolbar's Undo), ids and all, which a dialog in front of every delete would only slow; the
   *   live region says so. The library's song delete asks because it has no undo.
   */
  private choose(action: MenuAction): void {
    this.closeMenu(false);
    const edit = this.editFor(action);
    if (edit === null) {
      this.startRename();
      return;
    }

    const { id, label } = this;
    const changed = this.host.run(edit);
    if (action === 'up' || action === 'down') {
      this.host.focusSectionMenu(id);
    } else if (!changed) {
      this.toggle.focus();
    } else {
      this.host.focusEditor();
      this.host.notify(action === 'delete' ? `Deleted ${label}. Undo brings it back.` : `Duplicated ${label}.`);
    }
  }

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------

  private startRename(): void {
    this.renaming = true;
    this.renameField.value = this.label;
    this.heading.hidden = true;
    this.renameField.hidden = false;
    this.renameField.focus();
    this.renameField.select();
  }

  /**
   * Ends the rename, applying it unless `apply` is false. The new name takes its kind by `renamedKindOf`. A blank
   * name is refused by the command and said in the live region; the old name stays.
   */
  private finishRename(apply: boolean): void {
    if (!this.renaming) return;
    this.renaming = false;
    const label = this.renameField.value;
    this.renameField.hidden = true;
    this.heading.hidden = false;
    // Back to the button before the command runs, so the field's blur - fired as it is hidden - finds nothing to do.
    this.toggle.focus();
    if (apply) this.host.run(renameSection(this.id, label, renamedKindOf(label, this.kind)));
  }

  private readonly onRenameKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.finishRename(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.finishRename(false);
    }
  };

  /** Leaving the field by Tab or a click keeps what was typed, as any text field does. */
  private readonly onRenameBlur = (): void => this.finishRename(true);
}
