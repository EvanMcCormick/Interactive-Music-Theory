import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ClefKind, ComposerState, OttaviaKind, TripletFeelKind, Tuplet } from '../../../../models/composer.model';
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
import { MIXED, popoverValuesOf } from '../../../../services/composer-popover-values';
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

/** The keys a popover lets reach the page: Tab moves the focus on, and Escape closes the popover, claimed. */
const KEYS_LEAVING_A_POPOVER: ReadonlySet<string> = new Set(['Tab', 'Escape']);

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
 * stays in the window; and never taller than the room below that top, so a popover taller than the window,
 * or whose content grows once placed, scrolls within itself rather than past the window's bottom.
 */
export function popoverPlacementOf(
  anchor: ViewportBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PopoverPlacement {
  const height = Math.min(size.height, Math.max(0, viewport.height - 2 * POPOVER_GAP));
  const fitsRight = anchor.right + POPOVER_GAP + size.width <= viewport.width - POPOVER_GAP;
  const left = fitsRight ? anchor.right + POPOVER_GAP : Math.max(POPOVER_GAP, anchor.left - POPOVER_GAP - size.width);
  const top = Math.max(POPOVER_GAP, Math.min(anchor.top, viewport.height - POPOVER_GAP - height));
  return { left, top, maxHeight: Math.max(0, viewport.height - POPOVER_GAP - top) };
}

/**
 * The small popover a valued tool opens beside its palette button (design Part 3).
 *
 * Validates what it can before committing - the same `timeSignatureFault` and `keySignatureFault` the
 * service checks, and that a section has a name - and refuses an invalid entry inline, in a region
 * rendered before there is anything to say. A valid entry commits through `ComposerService` and asks to
 * close; one the service refuses keeps it open with the reason inline, as the status line says it too. It holds
 * only the values being typed; the document is the service's.
 *
 * It opens on the selection's first bar, where the bar commands write, and shows a value the selected bars do not
 * share as mixed; Apply leaves a field still mixed as each bar has it (`popoverValuesOf`).
 *
 * Drawn in the top layer (`popover="manual"`), so the palette's scrolling box cannot clip it, and placed
 * beside its trigger by `popoverPlacementOf` - again whenever the window resizes, a box scrolls, or its content
 * grows, so it follows the trigger while open. Opening focuses its first control; closing gives focus back to the
 * trigger when the focus was inside it. A press outside it and its trigger closes it, and a key pressed inside it
 * stays in it (`onPanelKey`), so a popover opened by a key is as usable from the keyboard as one clicked open.
 */
@Component({
  selector: 'app-composer-tool-popover',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer-tool-popover.component.html',
  styleUrls: ['./composer-tool-popover.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerToolPopoverComponent implements OnChanges, AfterViewChecked, OnDestroy {
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
  /** The key chosen, by its index in `keyChoices`, or null while the selected bars' keys differ and none is chosen. */
  keyIndex: number | null = KEY_SIGNATURE_CHOICES.findIndex(choice => choice.value.fifths === 0 && choice.value.mode === 'major');
  /** Null while the selected bars differ and nothing is chosen; Apply then writes the first bar's (`firstClef`). */
  clef: ClefKind | null = 'g2';
  ottava: OttaviaKind | null = 'regular';
  sectionText = '';
  sectionMarker = '';
  /** Whether the selected bars have different sections: Apply with both fields left empty then changes none. */
  sectionMixed = false;
  endings: boolean[] = new Array<boolean>(MAX_ENDING).fill(false);
  /** Whether the selected bars have different endings, and whether a box has been changed since: until one is, Apply changes none. */
  endingsMixed = false;
  endingsTouched = false;
  /** Null while the selected bars' feels differ and none is chosen. */
  tripletFeel: TripletFeelKind | null = 'none';
  /** The selection's tuplet, as the popover says it: `3:2`, `none` or `mixed`. */
  tupletNow = 'none';
  /** Whether each of `tupletChoices` is the selection's tuplet now. */
  tupletPressed: boolean[] = TUPLET_CHOICES.map(() => false);

  /** Why the entry cannot be applied, shown inline. */
  fault: string | null = null;

  @ViewChild('panel', { static: true }) private panel?: ElementRef<HTMLElement>;

  /** The kind the popover was last opened for, so it is placed and focused once per opening, not on every check. */
  private shown: PopoverKind | null = null;
  /** The first selected bar's clef and ottava, written for a field left mixed. */
  private firstClef: ClefKind = 'g2';
  private firstOttava: OttaviaKind = 'regular';
  /** Whether closing gives the focus back to the trigger. A press outside, which closes it, puts the focus where it pressed. */
  private focusBackOnClose = true;
  /** Whether the focus was inside the popover when it was asked to close (`ngOnChanges`). */
  private focusWasInside = false;
  /** Whether the listeners that follow the trigger and hear an outside press are on. */
  private following = false;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

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
    // Read before the view changes: closing takes the fields out, and a focused field taken out drops the focus to the page.
    if (this.kind === null) this.focusWasInside = this.panel?.nativeElement.contains(this.document.activeElement) ?? false;
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
      const giveBack = this.focusBackOnClose && this.focusWasInside;
      this.focusBackOnClose = true;
      this.focusWasInside = false;
      this.stopFollowing();
      if (panel.matches(':popover-open')) panel.hidePopover();
      if (giveBack) this.triggerOf(previous)?.focus();
      return;
    }

    if (!panel.matches(':popover-open')) panel.showPopover();
    this.startFollowing(panel);
    this.triggerOf(this.kind)?.scrollIntoView({ block: 'nearest' });
    this.place(panel);
    panel.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  }

  ngOnDestroy(): void {
    this.stopFollowing();
  }

  /**
   * Keeps a key pressed inside the popover from the page's shortcuts, which listen on the document as it bubbles: a
   * digit would write a fret, R a rest, an arrow move the caret, Space play, and `?` open the shortcut sheet under a
   * popover in the top layer. Tab and Escape go on - Escape is claimed by `onEscape` first - and so does a press with
   * Ctrl, Alt or Cmd, which the page runs from a popover as from any control: Ctrl+S saves rather than opening the
   * browser's Save dialog, and Ctrl+Z undoes.
   */
  onPanelKey(event: KeyboardEvent): void {
    if (KEYS_LEAVING_A_POPOVER.has(event.key) || event.ctrlKey || event.altKey || event.metaKey) return;
    event.stopPropagation();
  }

  /**
   * Escape closes this popover and nothing else. Claimed with `preventDefault`: the page's keyboard handler
   * ignores a claimed press, so it does not also go back to Select and drop the range. A press something earlier
   * claimed - the shell closing its drawer - is left alone.
   */
  onEscape(event: Event): void {
    if (event.defaultPrevented) return;
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
    this.commit(() => this.composer.setTimeSignature(timeSignature));
  }

  applyKeySignature(): void {
    if (this.keyIndex === null) return this.closed.emit();
    const choice = this.keyChoices[Number(this.keyIndex)];
    if (!choice || this.refuse(keySignatureFault(choice.value))) return;
    this.commit(() => this.composer.setKeySignature({ ...choice.value }));
  }

  applyClef(): void {
    if (this.clef === null && this.ottava === null) return this.closed.emit();
    const clef = this.clef ?? this.firstClef;
    const ottava = this.ottava ?? this.firstOttava;
    this.commit(() => this.composer.setClef(clef, ottava));
  }

  applySection(): void {
    if (this.sectionMixed && !this.sectionText.trim() && !this.sectionMarker.trim()) return this.closed.emit();
    if (this.refuse(this.sectionText.trim() ? null : 'A section needs a name.')) return;
    const section = { marker: this.sectionMarker.trim(), text: this.sectionText.trim() };
    this.commit(() => this.composer.setMasterBarValue('section', section));
  }

  removeSection(): void {
    this.commit(() => this.composer.setMasterBarValue('section', null));
  }

  applyEndings(): void {
    if (this.endingsMixed && !this.endingsTouched) return this.closed.emit();
    const chosen = this.endingNumbers.filter((_, index) => this.endings[index]);
    this.commit(() => this.composer.setMasterBarValue('alternateEndings', endingBitsOf(chosen)));
  }

  applyTuplet(tuplet: Readonly<Tuplet> | null): void {
    this.commit(() => this.composer.setTuplet(tuplet ? { ...tuplet } : null));
  }

  applyTripletFeel(): void {
    const feel = this.tripletFeel;
    if (feel === null) return this.closed.emit();
    this.commit(() => this.composer.setMasterBarValue('tripletFeel', feel));
  }

  /**
   * Runs a command, then closes - or, when the service refused it, stays open and says why inline. The refusal is the
   * service's own, published in the status line as well, and read by whether the command published a new message.
   */
  private commit(command: () => void): void {
    const before = this.composer.state.messageId;
    command();
    const after = this.composer.state;
    if (this.refuse(after.messageId !== before ? after.refusal : null)) return;
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
    const view = this.document.defaultView;
    if (!trigger || !view) return;
    panel.style.maxHeight = '';
    const placement = popoverPlacementOf(trigger.getBoundingClientRect(), panel.getBoundingClientRect(), {
      width: view.innerWidth,
      height: view.innerHeight
    });
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
    panel.style.maxHeight = `${placement.maxHeight}px`;
  }

  /**
   * While open: an outside press closes it, and it is placed again whenever the window resizes, any box scrolls - the
   * palette, the page - or its own content grows. The placement listeners run outside Angular, since placing writes
   * styles and changes nothing a template reads, and each burst is placed once, in the next frame.
   */
  private startFollowing(panel: HTMLElement): void {
    if (this.following) return;
    this.following = true;
    this.document.addEventListener('pointerdown', this.onOutsidePress, true);
    this.zone.runOutsideAngular(() => {
      this.document.defaultView?.addEventListener('resize', this.placeSoon);
      this.document.addEventListener('scroll', this.placeSoon, true);
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.placeSoon);
        this.resizeObserver.observe(panel);
      }
    });
  }

  private stopFollowing(): void {
    if (!this.following) return;
    this.following = false;
    this.document.removeEventListener('pointerdown', this.onOutsidePress, true);
    this.document.defaultView?.removeEventListener('resize', this.placeSoon);
    this.document.removeEventListener('scroll', this.placeSoon, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly placeSoon = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const panel = this.panel?.nativeElement;
      if (panel && this.kind !== null) this.place(panel);
    });
  };

  /**
   * A press outside the popover and its trigger closes it, as a popover is expected to, leaving the focus where the
   * press puts it. The trigger's own press is left to the trigger, whose click closes an open popover. In the capture
   * phase, so a control that stops the press still closes it.
   */
  private readonly onOutsidePress = (event: Event): void => {
    const panel = this.panel?.nativeElement;
    const target = event.target;
    if (!panel || this.kind === null || !(target instanceof Node)) return;
    if (panel.contains(target) || this.triggerOf(this.kind)?.contains(target)) return;
    this.focusBackOnClose = false;
    this.closed.emit();
  };

  /** Starts every field from the selection's first bar, and says mixed where the selected bars differ. */
  private readSelection(): void {
    const state = this.state;
    if (!state) return;
    const values = popoverValuesOf(state.doc, state.anchor, state.cursor);
    this.numerator = values.timeSignature.numerator;
    this.denominator = values.timeSignature.denominator;
    this.isCommon = values.timeSignature.isCommon;

    const key = values.keySignature;
    const index = key === MIXED ? -1 : this.keyChoices.findIndex(choice => choice.value.fifths === key.fifths && choice.value.mode === key.mode);
    // A key the list does not offer - only a hand-edited file holds one - starts from C major, not from the last key shown.
    this.keyIndex = key === MIXED ? null : index >= 0 ? index : this.keyChoices.findIndex(choice => choice.value.fifths === 0 && choice.value.mode === 'major');
    this.clef = values.clef === MIXED ? null : values.clef;
    this.ottava = values.ottava === MIXED ? null : values.ottava;
    this.firstClef = values.firstClef;
    this.firstOttava = values.firstOttava;

    this.sectionMixed = values.section === MIXED;
    const section = values.section === MIXED ? null : values.section;
    this.sectionText = section?.text ?? '';
    this.sectionMarker = section?.marker ?? '';
    this.endingsMixed = values.alternateEndings === MIXED;
    this.endingsTouched = false;
    const marked = values.alternateEndings === MIXED ? [] : endingsOf(values.alternateEndings);
    this.endings = this.endingNumbers.map(ending => marked.includes(ending));
    this.tripletFeel = values.tripletFeel === MIXED ? null : values.tripletFeel;

    const tuplet = values.tuplet;
    this.tupletNow = tuplet === MIXED ? 'mixed' : tuplet ? `${tuplet.numerator}:${tuplet.denominator}` : 'none';
    this.tupletPressed = this.tupletChoices.map(
      choice => tuplet !== MIXED && tuplet !== null && choice.numerator === tuplet.numerator && choice.denominator === tuplet.denominator
    );
  }
}
