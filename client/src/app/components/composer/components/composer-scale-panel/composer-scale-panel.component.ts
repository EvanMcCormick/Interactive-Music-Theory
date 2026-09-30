import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

/** A scale or chord the panel offers, from `MusicTheoryService`'s catalogue. */
interface ScaleOption {
  id: string;
  name: string;
  intervals: number[];
  type: 'scale' | 'chord';
}

/** The catalogue's groups, as the panel's `<optgroup>`s. */
interface ScaleGroup {
  name: string;
  options: ScaleOption[];
}

/** Each pitch class by both of its names, sharp first, as the note selectors elsewhere in the app say them. */
const ROOT_NAMES: readonly string[] = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

/**
 * The scale panel: highlight a scale or chord's notes on the score, in either state (the GP-composer design, decision 9).
 *
 * The viewer's highlighter's selectors, moved - its root and its scale or chord, from `MusicTheoryService`'s catalogue
 * (`getUnifiedCategories`) - in a menu off the top bar, like the Library and Export menus, so it takes no row from the
 * score or the strip. It says what it highlights as a `HighlightConfig`; the page hands that to the score, which marks
 * the notes (`scale-highlight.ts`). Its first opening is reported (`firstOpened`), since that is when the page asks
 * alphaTab for note bounds, which cost a rectangle per note and are off until then.
 */
@Component({
  selector: 'app-composer-scale-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-scale-panel.component.html',
  styleUrls: ['./composer-scale-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerScalePanelComponent {
  @Output() readonly highlightChange = new EventEmitter<HighlightConfig>();
  /** The first time the panel opens, and never again. */
  @Output() readonly firstOpened = new EventEmitter<void>();

  @ViewChild('toggle') private toggle?: ElementRef<HTMLButtonElement>;

  readonly rootNames = ROOT_NAMES;
  readonly groups: readonly ScaleGroup[];

  open = false;
  enabled = false;
  rootNote = 0;
  scaleId = '';
  private opened = false;

  constructor(
    musicTheory: MusicTheoryService,
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.groups = musicTheory.getUnifiedCategories().map(category => ({
      name: category.name,
      options: category.items.map(item => ({ id: item.id, name: item.name, intervals: item.intervals, type: item.type }))
    }));
  }

  /** The scale or chord chosen, or undefined. */
  private get chosen(): ScaleOption | undefined {
    return this.groups.flatMap(group => group.options).find(option => option.id === this.scaleId);
  }

  /** What the panel highlights, in words: "A Minor Pentatonic", or empty while nothing is. */
  get summary(): string {
    const chosen = this.chosen;
    return this.enabled && chosen ? `${ROOT_NAMES[this.rootNote]} ${chosen.name}` : '';
  }

  toggleOpen(): void {
    this.open = !this.open;
    if (this.open && !this.opened) {
      this.opened = true;
      this.firstOpened.emit();
    }
  }

  /** Any change - the switch, the root, the scale - says the highlight again. */
  changed(): void {
    const chosen = this.chosen;
    this.highlightChange.emit({
      enabled: this.enabled && chosen !== undefined,
      rootNote: Number(this.rootNote),
      intervals: chosen?.intervals.slice() ?? [],
      name: this.summary,
      type: chosen?.type ?? 'scale'
    });
  }

  /** Escape closes the menu and gives the focus to its button; the page's own Escape stands aside. */
  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.open) return;
    event.stopPropagation();
    this.open = false;
    this.toggle?.nativeElement.focus();
  }

  /** A click outside the menu closes it, as the Library and Export menus close. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open || (event.target instanceof Node && this.host.nativeElement.contains(event.target))) return;
    this.open = false;
    this.cdr.markForCheck();
  }
}
