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
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { EditRequest, GpOriginal } from '../../../../services/composer-gp.service';
import { LossItem } from '../../../../services/gp-conversion-loss';
import { ModalFocus } from '../../../../services/modal-focus';

/**
 * The question the first edit of a `.gp` file asks: convert it into a composition, or not (the GP-composer design,
 * decisions 4 to 6, and Part 4's "What the prompt says").
 *
 * It says, in this order: what the edit was, so the question is about something the user just did; that converting
 * cannot be undone; what this file would lose, from `conversionLossOf` - and, under its own heading, what the first save
 * would - or that nothing would change; then *Save the original file first*, *Convert* and *Cancel*. Saving the original
 * is not a fourth outcome: it downloads the untouched `.gp` and leaves the prompt open, so the user converts afterwards
 * without being asked twice.
 *
 * A modal, as the shortcut sheet is (`ModalFocus`): a backdrop over the window that cancels on a click, the page behind
 * made `inert` by the page, the focus moved in and Tab held inside. Escape reaches the page's key handler, which cancels.
 * Open while there is a command waiting on it (`request`) and a file to convert.
 */
@Component({
  selector: 'app-composer-convert-prompt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-convert-prompt.component.html',
  styleUrls: ['./composer-convert-prompt.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerConvertPromptComponent implements OnChanges, AfterViewChecked {
  @Input() request: EditRequest | null = null;
  @Input() original: GpOriginal | null = null;
  /** Why Convert cannot run, or null when it can. Convert is disabled and the reason shown beside it. */
  @Input() convertRefusal: string | null = null;
  /** Where the focus goes on closing when what had it has left the page: the score, asked as the prompt closes. */
  @Input() fallbackFocus: () => HTMLElement | null = () => null;
  @Output() readonly saveOriginal = new EventEmitter<void>();
  @Output() readonly convert = new EventEmitter<void>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild('dialog', { static: true }) private dialog?: ElementRef<HTMLElement>;
  @ViewChild('heading', { static: true }) private heading?: ElementRef<HTMLElement>;

  private readonly focus = new ModalFocus();

  get open(): boolean {
    return this.request !== null && this.original !== null;
  }

  /** What converting loses now. */
  get conversionLoss(): LossItem[] {
    return this.original?.loss.filter(item => item.group === 'conversion') ?? [];
  }

  /** What the first save after converting loses. */
  get saveLoss(): LossItem[] {
    return this.original?.loss.filter(item => item.group === 'first save') ?? [];
  }

  ngOnChanges(changes: SimpleChanges): void {
    const request = changes['request'];
    const original = changes['original'];
    if (!request && !original) return;
    const wasOpen = (request ? request.previousValue : this.request) != null && (original ? original.previousValue : this.original) != null;
    this.focus.openChanged(this.open, wasOpen);
  }

  ngAfterViewChecked(): void {
    this.focus.afterViewChecked(this.heading?.nativeElement, this.dialog?.nativeElement, this.fallbackFocus);
  }

  trapTab(event: KeyboardEvent): void {
    this.focus.trapTab(event, this.open, this.dialog?.nativeElement);
  }

  trackById(_index: number, item: LossItem): string {
    return item.id;
  }
}
