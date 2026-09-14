import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { bindingLabelOf } from '../../../../services/composer-key-bindings';
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

/** The groups in the order of the design's shortcut table. */
const SHEET_ORDER: readonly ToolGroup[] = [
  'Tools', 'Edit', 'Navigation', 'Playback', 'Beats', 'Duration', 'Bar', 'Tracks', 'Accidentals', 'Dynamics', 'Articulation', 'Techniques'
];

/** A tool's keys as the sheet writes them: every binding, joined with "or", and the ten digits as a range. */
function keysOf(tool: ComposerTool): string {
  const labels = tool.keys.map(bindingLabelOf);
  return labels.length === 10 && labels.every((label, index) => label === String(index)) ? '0-9' : labels.join(' or ');
}

/** The sheet's content, from the tool table: each group's tools that have a key, in table order. */
export function shortcutSectionsOf(tools: readonly ComposerTool[]): ShortcutSection[] {
  return SHEET_ORDER.map(group => ({
    group,
    rows: tools.filter(tool => tool.group === group && tool.keys.length > 0).map(tool => ({ label: tool.label, keys: keysOf(tool) }))
  })).filter(section => section.rows.length > 0);
}

/**
 * Every keyboard shortcut, opened with `?`.
 *
 * Read from `COMPOSER_TOOLS`, so it lists exactly the keys the handler answers to. Hidden with CSS rather
 * than removed while closed, so opening it builds nothing.
 */
@Component({
  selector: 'app-composer-shortcut-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-shortcut-sheet.component.html',
  styleUrls: ['./composer-shortcut-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerShortcutSheetComponent {
  @Input() open = false;
  @Output() readonly closed = new EventEmitter<void>();

  readonly sections: readonly ShortcutSection[] = shortcutSectionsOf(COMPOSER_TOOLS);

  trackByGroup(_index: number, section: ShortcutSection): string {
    return section.group;
  }
}
