import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HighlightConfig } from '../../../../models/alpha-tab.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';

/**
 * A scale or chord the panel offers, from `MusicTheoryService`'s catalogue. The select holds the option itself
 * (`ngValue`), never its id: an id is unique within a category and not across them - `diminished` and `augmented` are
 * each both a scale and a triad - so a pick found again by its id would find the scale.
 */
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
export class ComposerScalePanelComponent implements OnChanges, OnDestroy {
  /**
   * Whether a modal - the shortcut sheet - is open over the page, as the Library panel is told: opening one closes the
   * menu, and while it is open the menu's Escape listener stands aside, so Escape closes the modal.
   */
  @Input() modalOpen = false;

  @Output() readonly highlightChange = new EventEmitter<HighlightConfig>();
  /** The first time the panel opens, and never again. */
  @Output() readonly firstOpened = new EventEmitter<void>();
  /** Every opening, for the page to close a popover, as the Library and Export menus' openings do. */
  @Output() readonly menuOpened = new EventEmitter<void>();

  @ViewChild('toggle') private toggle?: ElementRef<HTMLButtonElement>;

  readonly rootNames = ROOT_NAMES;
  readonly groups: readonly ScaleGroup[];

  open = false;
  enabled = false;
  rootNote = 0;
  /** The scale or chord chosen - the select's own option, held rather than looked up again (`ScaleOption`) - or null. */
  chosen: ScaleOption | null = null;
  private opened = false;

  private readonly document = inject(DOCUMENT);

  constructor(
    musicTheory: MusicTheoryService,
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.groups = musicTheory.getUnifiedCategories().map(category => ({
      name: category.name,
      options: category.items.map(item => ({ id: item.id, name: item.name, intervals: item.intervals, type: item.type }))
    }));
    this.document.addEventListener('keydown', this.escapeListener, true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modalOpen'] && this.modalOpen) this.close();
  }

  ngOnDestroy(): void {
    this.document.removeEventListener('keydown', this.escapeListener, true);
  }

  /** What the panel highlights, in words: "A Minor Pentatonic", or empty while nothing is. */
  get summary(): string {
    return this.enabled && this.chosen ? `${ROOT_NAMES[this.rootNote]} ${this.chosen.name}` : '';
  }

  toggleOpen(): void {
    this.open = !this.open;
    if (!this.open) return;
    this.menuOpened.emit();
    if (!this.opened) {
      this.opened = true;
      this.firstOpened.emit();
    }
  }

  /** Any change - the switch, the root, the scale - says the highlight again. */
  changed(): void {
    const chosen = this.chosen;
    this.highlightChange.emit({
      enabled: this.enabled && chosen !== null,
      rootNote: Number(this.rootNote),
      intervals: chosen?.intervals.slice() ?? [],
      name: this.summary,
      type: chosen?.type ?? 'scale'
    });
  }

  /** A click outside the menu closes it, as the Library and Export menus close. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open || (event.target instanceof Node && this.host.nativeElement.contains(event.target))) return;
    this.close();
  }

  private close(): void {
    this.open = false;
    this.cdr.markForCheck();
  }

  /**
   * Escape closes the open menu and claims the key, giving the focus back to the menu's button when it was inside - a
   * focused control that is hidden drops the focus to the page. The Library panel's listener, for its reasons
   * (`ComposerLibraryPanelComponent.escapeListener`): on the document in the capture phase, so it runs before the page's
   * own Escape, which would go back to Select and drop the range; a press something earlier claimed, and any press while
   * a modal is open or the menu is closed, is left alone.
   */
  private readonly escapeListener = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || this.modalOpen || !this.open) return;
    event.preventDefault();
    const focusWasInside = this.host.nativeElement.contains(this.document.activeElement);
    this.close();
    if (focusWasInside) this.toggle?.nativeElement.focus();
  };
}
