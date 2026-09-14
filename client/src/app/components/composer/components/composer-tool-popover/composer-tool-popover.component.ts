import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ClefKind,
  ComposerState,
  OttaviaKind,
  TripletFeelKind,
  Tuplet,
  effectiveTimeSignature
} from '../../../../models/composer.model';
import { keySignatureFault, timeSignatureFault } from '../../../../services/bar-edits';
import {
  CLEF_CHOICES,
  KEY_SIGNATURE_CHOICES,
  MAX_ENDING,
  OTTAVA_CHOICES,
  TRIPLET_FEEL_CHOICES,
  endingBitsOf,
  endingsOf
} from '../../../../services/composer-bar-choices';
import { ComposerService } from '../../../../services/composer.service';
import { TUPLET_CHOICES } from '../../../../services/composer-tool-defaults';
import { PopoverKind } from '../../../../services/composer-tools';

/** What each popover is called, for its dialog label and heading. */
const TITLES: Readonly<Record<PopoverKind, string>> = {
  timeSignature: 'Time signature',
  keySignature: 'Key signature',
  clef: 'Clef',
  section: 'Section',
  alternateEnding: 'Alternate ending',
  tuplet: 'Tuplet',
  tripletFeel: 'Triplet feel'
};

/** How far a popover keeps from its trigger and from the window's edges, in pixels. */
const POPOVER_GAP = 6;

/** A box in window coordinates, as `getBoundingClientRect` reports one. */
export interface ViewportBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a popover goes, in window coordinates, and the most it may be tall. */
export interface PopoverPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Where a popover `size` big goes beside a trigger at `anchor`, in a window `viewport` big: right of the
 * trigger, or left of it when the right has no room; level with the trigger's top, moved up so its bottom
 * stays in the window; and never taller than the window, which it then scrolls within.
 */
export function popoverPlacementOf(
  anchor: ViewportBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PopoverPlacement {
  const maxHeight = Math.max(0, viewport.height - 2 * POPOVER_GAP);
  const height = Math.min(size.height, maxHeight);
  const fitsRight = anchor.right + POPOVER_GAP + size.width <= viewport.width - POPOVER_GAP;
  const left = fitsRight ? anchor.right + POPOVER_GAP : Math.max(POPOVER_GAP, anchor.left - POPOVER_GAP - size.width);
  const top = Math.max(POPOVER_GAP, Math.min(anchor.top, viewport.height - POPOVER_GAP - height));
  return { left, top, maxHeight };
}

/**
 * The small popover a valued tool opens beside its palette button (design Part 3).
 *
 * Validates what it can before committing - the same `timeSignatureFault` and `keySignatureFault` the
 * service checks, and that a section has a name - and refuses an invalid entry inline, in a region
 * rendered before there is anything to say. A valid entry commits through `ComposerService` and asks to
 * close. It holds only the values being typed; the document is the service's.
 *
 * Drawn in the top layer (`popover="manual"`), so the palette's scrolling box cannot clip it, and placed
 * beside its trigger by `popoverPlacementOf`. Opening focuses its first control and closing gives focus
 * back to the trigger, so a popover opened by a key is as usable from the keyboard as one clicked open.
 */
@Component({
  selector: 'app-composer-tool-popover',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-tool-popover.component.html',
  styleUrls: ['./composer-tool-popover.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerToolPopoverComponent implements OnChanges, AfterViewChecked {
  @Input() kind: PopoverKind | null = null;
  @Input() state: ComposerState | null = null;
  /**
   * The element holding the triggers - the palette - each a button marked `data-tool` with its tool's id.
   * The popover is placed beside its kind's trigger, and gives focus back to it when it closes.
   */
  @Input() triggers: ParentNode | null = null;
  @Output() readonly closed = new EventEmitter<void>();

  readonly keyChoices = KEY_SIGNATURE_CHOICES;
  readonly clefChoices = CLEF_CHOICES;
  readonly ottavaChoices = OTTAVA_CHOICES;
  readonly tripletFeelChoices = TRIPLET_FEEL_CHOICES;
  readonly tupletChoices = TUPLET_CHOICES;
  readonly endingNumbers = Array.from({ length: MAX_ENDING }, (_, index) => index + 1);

  numerator = 4;
  denominator = 4;
  isCommon = false;
  keyIndex = 7;
  clef: ClefKind = 'g2';
  ottava: OttaviaKind = 'regular';
  sectionText = '';
  sectionMarker = '';
  endings: boolean[] = new Array<boolean>(MAX_ENDING).fill(false);
  tripletFeel: TripletFeelKind = 'none';

  /** Why the entry cannot be applied, shown inline. */
  fault: string | null = null;

  @ViewChild('panel', { static: true }) private panel?: ElementRef<HTMLElement>;

  /** The kind the popover was last opened for, so it is placed and focused once per opening, not on every check. */
  private shown: PopoverKind | null = null;

  constructor(
    private readonly composer: ComposerService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get title(): string {
    return this.kind ? TITLES[this.kind] : '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only a new kind starts the fields again. `state` arrives with every edit and caret move, and reading
    // it each time would throw away what is being typed.
    if (!changes['kind']) return;
    this.fault = null;
    this.readSelection();
  }

  /**
   * Opens, moves or closes the popover once the view shows the kind asked for. After the check rather
   * than in `ngOnChanges`, so the fields a new kind draws exist to be measured and focused.
   */
  ngAfterViewChecked(): void {
    const panel = this.panel?.nativeElement;
    if (!panel || this.kind === this.shown) return;
    const previous = this.shown;
    this.shown = this.kind;

    if (this.kind === null) {
      if (panel.matches(':popover-open')) panel.hidePopover();
      this.triggerOf(previous)?.focus();
      return;
    }

    if (!panel.matches(':popover-open')) panel.showPopover();
    this.place(panel);
    panel.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  }

  /**
   * Escape closes this popover and nothing else. Claimed with `preventDefault`: the page's keyboard handler
   * ignores a claimed press, so it does not also go back to Select and drop the range.
   */
  onEscape(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }

  applyTimeSignature(): void {
    const timeSignature = { numerator: Number(this.numerator), denominator: Number(this.denominator), isCommon: this.isCommon };
    const commonFault =
      timeSignature.isCommon && !((timeSignature.numerator === 4 && timeSignature.denominator === 4) || (timeSignature.numerator === 2 && timeSignature.denominator === 2))
        ? 'Common time is drawn only for 4/4, and cut time only for 2/2.'
        : null;
    if (this.refuse(timeSignatureFault(timeSignature) ?? commonFault)) return;
    this.composer.setTimeSignature(timeSignature);
    this.closed.emit();
  }

  applyKeySignature(): void {
    const choice = this.keyChoices[Number(this.keyIndex)];
    if (!choice || this.refuse(keySignatureFault(choice.value))) return;
    this.composer.setKeySignature({ ...choice.value });
    this.closed.emit();
  }

  applyClef(): void {
    this.composer.setClef(this.clef, this.ottava);
    this.closed.emit();
  }

  applySection(): void {
    if (this.refuse(this.sectionText.trim() ? null : 'A section needs a name.')) return;
    this.composer.setMasterBarValue('section', { marker: this.sectionMarker.trim(), text: this.sectionText.trim() });
    this.closed.emit();
  }

  removeSection(): void {
    this.composer.setMasterBarValue('section', null);
    this.closed.emit();
  }

  applyEndings(): void {
    const chosen = this.endingNumbers.filter((_, index) => this.endings[index]);
    this.composer.setMasterBarValue('alternateEndings', endingBitsOf(chosen));
    this.closed.emit();
  }

  applyTuplet(tuplet: Readonly<Tuplet> | null): void {
    this.composer.setTuplet(tuplet ? { ...tuplet } : null);
    this.closed.emit();
  }

  applyTripletFeel(): void {
    this.composer.setMasterBarValue('tripletFeel', this.tripletFeel);
    this.closed.emit();
  }

  /**
   * Shows `fault` inline when there is one, and says whether there was. Marks the view: an apply can
   * arrive from a form submit or from the keyboard, and an OnPush view repaints only when told.
   */
  private refuse(fault: string | null): boolean {
    this.fault = fault;
    this.cdr.markForCheck();
    return fault !== null;
  }

  /** The palette button that opens `kind`, or null. */
  private triggerOf(kind: PopoverKind | null): HTMLElement | null {
    return kind ? this.triggers?.querySelector<HTMLElement>(`[data-tool="${kind}"]`) ?? null : null;
  }

  /**
   * Places the open popover beside its trigger. Written to the element's style rather than bound: the
   * placement needs the popover's own size, which exists only after the view is checked, and a binding
   * changed there would be changed after its check.
   */
  private place(panel: HTMLElement): void {
    const trigger = this.triggerOf(this.kind);
    if (!trigger) return;
    panel.style.maxHeight = '';
    const placement = popoverPlacementOf(trigger.getBoundingClientRect(), panel.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight
    });
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
    panel.style.maxHeight = `${placement.maxHeight}px`;
  }

  /** Starts every field from the caret's bar, so a popover opens on what is already there. */
  private readSelection(): void {
    const state = this.state;
    if (!state) return;
    const { barIndex, trackIndex, staffIndex } = state.cursor;
    const meter = effectiveTimeSignature(state.doc.masterBars, barIndex);
    this.numerator = meter.numerator;
    this.denominator = meter.denominator;
    this.isCommon = meter.isCommon;

    const bar = state.doc.tracks[trackIndex]?.staves[staffIndex]?.bars[barIndex];
    if (bar) {
      const key = this.keyChoices.findIndex(choice => choice.value.fifths === bar.keySignature.fifths && choice.value.mode === bar.keySignature.mode);
      this.keyIndex = key >= 0 ? key : this.keyIndex;
      this.clef = bar.clef;
      this.ottava = bar.clefOttava;
    }

    const masterBar = state.doc.masterBars[barIndex];
    if (masterBar) {
      this.sectionText = masterBar.section?.text ?? '';
      this.sectionMarker = masterBar.section?.marker ?? '';
      const marked = endingsOf(masterBar.alternateEndings);
      this.endings = this.endingNumbers.map(ending => marked.includes(ending));
      this.tripletFeel = masterBar.tripletFeel;
    }
  }
}
