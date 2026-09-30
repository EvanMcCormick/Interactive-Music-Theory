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
import { ModalFocus } from '../../../../services/modal-focus';

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

/**
 * Every keyboard shortcut, opened with `?`.
 *
 * Read from `COMPOSER_TOOLS`, so it lists exactly the keys the handler answers to, with the modifiers the platform's
 * keyboard has (`KEY_PLATFORM`). Hidden with CSS rather than removed while closed, so opening it builds nothing.
 *
 * A modal dialog, whose focus is `ModalFocus`'s: opening it moves the focus to its heading; Tab goes round inside it; and
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

  private readonly focus = new ModalFocus();

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['open'];
    if (change) this.focus.openChanged(this.open, !!change.previousValue);
  }

  ngAfterViewChecked(): void {
    this.focus.afterViewChecked(this.heading?.nativeElement, this.sheet?.nativeElement, this.fallbackFocus);
  }

  /** Keeps Tab inside the open sheet, going round from its last control to its first, and back with Shift. */
  trapTab(event: KeyboardEvent): void {
    this.focus.trapTab(event, this.open, this.sheet?.nativeElement);
  }

  trackByGroup(_index: number, section: ShortcutSection): string {
    return section.group;
  }
}
