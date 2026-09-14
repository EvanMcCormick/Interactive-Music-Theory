import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ComposerToolPopoverComponent } from '../composer-tool-popover/composer-tool-popover.component';
import { ComposerState } from '../../../../models/composer.model';
import { bindingLabelOf } from '../../../../services/composer-key-bindings';
import { IDLE_TOOL, ToolState, toolStates } from '../../../../services/composer-tool-states';
import { COMPOSER_TOOLS, ComposerTool, PALETTE_GROUPS, PopoverKind, ToolGroup } from '../../../../services/composer-tools';

/** One palette button, as the template draws it. */
export interface PaletteButton {
  tool: ComposerTool;
  /** The glyph's character, or the tool's text. */
  face: string;
  /** Whether `face` is a Bravura glyph. */
  smufl: boolean;
  /** The accessible name: the tool's label, and why it is refusing when it is. */
  label: string;
  /** The label, the shortcut, and any refusal. */
  tooltip: string;
  /** `aria-pressed`, for a toggle or a radio; null for a popover tool or an action, which have none. */
  pressed: 'true' | 'false' | 'mixed' | null;
  /** Whether a popover tool's value is set on the selection - a cue for styling, since it has no pressed state. */
  hasValue: boolean;
  refusal: string | null;
  /** Whether it opens a popover, and so says `aria-haspopup` and `aria-expanded`. */
  opensPopover: boolean;
}

export interface PaletteGroup {
  group: ToolGroup;
  buttons: PaletteButton[];
}

function buttonOf(tool: ComposerTool, states: ReadonlyMap<string, ToolState>): PaletteButton {
  const toolState = states.get(tool.id) ?? IDLE_TOOL;
  // Select and Pen have no key of their own; the key that reaches them is Q.
  const isMode = tool.id === 'select' || tool.id === 'pen';
  const shortcut = isMode ? 'Q toggles Select and Pen' : tool.keys.map(bindingLabelOf).join(' or ');
  const pressable = tool.kind === 'toggle' || tool.kind === 'radio';
  const pressed = toolState.pressed === 'mixed' ? 'mixed' : toolState.pressed ? 'true' : 'false';

  return {
    tool,
    face: tool.glyph.kind === 'smufl' ? String.fromCodePoint(tool.glyph.codePoint) : tool.glyph.text,
    smufl: tool.glyph.kind === 'smufl',
    label: toolState.refusal ? `${tool.label}, unavailable: ${toolState.refusal}` : tool.label,
    tooltip: `${tool.label}${shortcut ? ` (${shortcut})` : ''}${toolState.refusal ? ` - unavailable: ${toolState.refusal}` : ''}`,
    pressed: pressable ? pressed : null,
    hasValue: tool.kind === 'popover' && toolState.pressed !== false,
    refusal: toolState.refusal,
    opensPopover: tool.kind === 'popover'
  };
}

/** The palette's groups and buttons for `state`, from the tool table and `toolStates`. */
export function paletteGroupsOf(state: ComposerState, tools: readonly ComposerTool[] = COMPOSER_TOOLS): PaletteGroup[] {
  const states = toolStates(state.doc, state.anchor, state.cursor, state.entryMode);
  return PALETTE_GROUPS.map(group => ({
    group,
    buttons: tools.filter(tool => tool.inPalette && tool.group === group).map(tool => buttonOf(tool, states))
  }));
}

/**
 * Every notation tool as a button, in the design's groups (design Part 3, "Palette").
 *
 * Draws from `COMPOSER_TOOLS` and `toolStates`, computed once per state change rather than in the
 * template. A press is handed to the page, which runs the tool with its host exactly as a key press
 * does, so a button and its key cannot differ. The one popover is drawn in the top layer, because this
 * box scrolls and would clip it; it finds its button here, by `data-tool`.
 */
@Component({
  selector: 'app-composer-palette',
  standalone: true,
  imports: [CommonModule, ComposerToolPopoverComponent],
  templateUrl: './composer-palette.component.html',
  styleUrls: ['./composer-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerPaletteComponent implements OnChanges {
  @Input() state: ComposerState | null = null;
  /** The popover open, if any: the page holds it, since a key can open one too. */
  @Input() popover: PopoverKind | null = null;
  @Output() readonly toolPressed = new EventEmitter<ComposerTool>();
  @Output() readonly popoverClosed = new EventEmitter<void>();

  /** This palette's element, where the popover looks for the button that opened it. */
  readonly element: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;

  groups: PaletteGroup[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['state']) this.groups = this.state ? paletteGroupsOf(this.state) : [];
  }

  press(button: PaletteButton): void {
    this.toolPressed.emit(button.tool);
  }

  trackByGroup(_index: number, group: PaletteGroup): string {
    return group.group;
  }

  trackByTool(_index: number, button: PaletteButton): string {
    return button.tool.id;
  }
}
