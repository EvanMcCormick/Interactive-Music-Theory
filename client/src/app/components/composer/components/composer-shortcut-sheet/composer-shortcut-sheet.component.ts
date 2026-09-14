import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { bindingLabelsOf } from '../../../../services/composer-key-bindings';
import { KEY_PLATFORM, KeyPlatform } from '../../../../services/composer-key-platform';
import { COMPOSER_TOOLS, ComposerTool, ToolGroup } from '../../../../services/composer-tools';

/** One line of the sheet. */
export interface ShortcutRow {
  label: string;
  keys: string;
}

/** One group of the sheet. */
export interface ShortcutSection {
  group: ToolGroup;
  rows: ShortcutRow[];
}

/**
 * The groups in the order of the design's shortcut table. A copy of `ToolGroup`'s members, in another order; the spec
 * checks the sheet lists every tool that has a key, so a group added to the table and not here fails it.
 */
const SHEET_ORDER: readonly ToolGroup[] = [
  'Tools', 'Edit', 'Navigation', 'Playback', 'Beats', 'Duration', 'Bar', 'Tracks', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'
];

/** A tool's keys as the sheet writes them: every binding, joined with "or", and the ten digits as a range. */
function keysOf(tool: ComposerTool, platform: KeyPlatform): string {
  const labels = bindingLabelsOf(tool.keys, platform);
  return labels.length === 10 && labels.every((label, index) => label === String(index)) ? '0-9' : labels.join(' or ');
}

/** The sheet's content, from the tool table: each group's tools that have a key, in table order, labelled for `platform`. */
export function shortcutSectionsOf(tools: readonly ComposerTool[], platform: KeyPlatform = 'other'): ShortcutSection[] {
  return SHEET_ORDER.map(group => ({
    group,
    rows: tools
      .filter(tool => tool.group === group && tool.keys.length > 0)
      .map(tool => ({ label: tool.label, keys: keysOf(tool, platform) }))
  })).filter(section => section.rows.length > 0);
}

/**
 * The keys that still run while the focus is in a text field (`inTextFields`), as the sheet's note names them -
 * "Ctrl+S" - or null when no tool does. From the table, so the note cannot go on naming a key that no longer runs.
 */
export function textFieldKeysOf(tools: readonly ComposerTool[], platform: KeyPlatform = 'other'): string | null {
  const labels = tools.filter(tool => tool.inTextFields).flatMap(tool => bindingLabelsOf(tool.keys, platform));
  return labels.length > 0 ? labels.join(' or ') : null;
}

/** What can take the focus by Tab inside the sheet. */
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every keyboard shortcut, opened with `?`.
 *
 * Read from `COMPOSER_TOOLS`, so it lists exactly the keys the handler answers to, with the modifiers the platform's
 * keyboard has (`KEY_PLATFORM`). Hidden with CSS rather than removed while closed, so opening it builds nothing.
 *
 * A modal dialog: opening it moves the focus to its heading and remembers what had it; Tab goes round inside it; and
 * closing it, by its ×, by Escape or by a click on the backdrop behind it, gives the focus back - or, when that element
 * has left the page, to `fallbackFocus`, the score. The backdrop covers the whole window, so a click beside the sheet
 * reaches nothing under it; the page makes its own content `inert` while the sheet is open, so the focus cannot get
 * there either. The page closes it by setting `open`, whichever way, so the focus is handled here once.
 * The keys behind it are the page's to hold back (`ComposerKeyHandler`'s `modalOpen`).
 */
@Component({
  selector: 'app-composer-shortcut-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-shortcut-sheet.component.html',
  styleUrls: ['./composer-shortcut-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerShortcutSheetComponent implements OnChanges, AfterViewChecked {
  @Input() open = false;
  /**
   * Where the focus goes on closing when what had it before the sheet opened has left the page - asked as the sheet
   * closes, not when the page binds it, since the page's element can be a view query that is unset until it renders.
   */
  @Input() fallbackFocus: () => HTMLElement | null = () => null;
  @Output() readonly closed = new EventEmitter<void>();

  private readonly platform: KeyPlatform = inject(KEY_PLATFORM);
  readonly sections: readonly ShortcutSection[] = shortcutSectionsOf(COMPOSER_TOOLS, this.platform);
  /** The keys the note says still run in a text field. */
  readonly textFieldKeys: string | null = textFieldKeysOf(COMPOSER_TOOLS, this.platform);

  @ViewChild('sheet', { static: true }) private sheet?: ElementRef<HTMLElement>;
  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  /** What had the focus when the sheet opened. */
  private returnFocusTo: HTMLElement | null = null;
  /**
   * Set on opening, and acted on once the view has shown the sheet: `open` changes before the view does, and an
   * element still under `display: none` cannot take the focus.
   */
  private focusOnRender = false;
  /**
   * Set on closing, and acted on once the view is checked: the page makes itself `inert` while the sheet is open, and
   * an inert element cannot take the focus. By `ngAfterViewChecked` every binding in the page's template has been
   * applied, whatever order the page wrote them in, so the page is no longer inert. What had the focus is still read
   * on opening, in `ngOnChanges`, before the bindings after the sheet make the page inert.
   */
  private focusBackOnRender = false;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['open'];
    if (!change) return;
    const wasOpen = !!change.previousValue;
    if (this.open && !wasOpen) {
      const active = document.activeElement;
      this.returnFocusTo = active instanceof HTMLElement ? active : null;
      this.focusOnRender = true;
      this.focusBackOnRender = false;
    } else if (!this.open && wasOpen) {
      this.focusOnRender = false;
      this.focusBackOnRender = true;
    }
  }

  ngAfterViewChecked(): void {
    if (this.focusBackOnRender) {
      this.focusBackOnRender = false;
      this.giveFocusBack();
      return;
    }
    if (!this.focusOnRender) return;
    this.focusOnRender = false;
    this.heading?.nativeElement.focus();
  }

  /** Keeps Tab inside the open sheet, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.open || !this.sheet) return;
    const tabbable = Array.from(this.sheet.nativeElement.querySelectorAll<HTMLElement>(TABBABLE));
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

  trackByGroup(_index: number, section: ShortcutSection): string {
    return section.group;
  }

  /**
   * Gives the focus back to what had it before the sheet opened, or to `fallbackFocus` when that has left the page or
   * was the page itself. Only while the focus is still the sheet's: a click outside that closed it has already put
   * the focus where the user wanted it.
   */
  private giveFocusBack(): void {
    const saved = this.returnFocusTo;
    this.returnFocusTo = null;
    this.focusOnRender = false;
    const active = document.activeElement;
    const stillOurs = active === null || active === document.body || !!this.sheet?.nativeElement.contains(active);
    if (!stillOurs) return;
    const target = saved && saved.isConnected && saved !== document.body ? saved : this.fallbackFocus();
    target?.focus();
  }
}
