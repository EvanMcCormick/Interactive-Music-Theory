import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EditCursor, EntryMode, ScoreDoc } from '../../../../models/composer.model';
import { scoreBarFills } from '../../../../services/bar-fill';
import { countOf } from '../../../../services/composer-text';

/** How many bars are over their time signature: every staff's, each of which Fix bar mends on its own. */
export function overBarCountOf(doc: ScoreDoc): number {
  return scoreBarFills(doc).flat(2).filter(fill => fill.kind === 'over').length;
}

/**
 * The line between the score and the track strip: where the caret is, whether a click writes, how many
 * bars are over, and why the last press did nothing or what it did.
 *
 * Holds the page's one polite live region. Refusals from every route - a palette button, a key, a click
 * on the score - arrive as `ComposerState.refusal`, Fix bar's and paste's outcomes as
 * `ComposerState.notice`, and the region reads them out; a failed alphaTex apply joins them, and so does what the
 * library panel did - a save, a load, an export, or why one failed - which it says through `ComposerService.announce`.
 * The caret readout, the score's bar count and the count of bars over sit outside the region: they change with
 * ordinary editing, and announcing them would bury what the region is for.
 */
@Component({
  selector: 'app-composer-status-line',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './composer-status-line.component.html',
  styleUrls: ['./composer-status-line.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComposerStatusLineComponent implements OnChanges {
  /** Why the last command did nothing, from `ComposerState.refusal`. */
  @Input() refusal: string | null = null;
  /** What the last command did, from `ComposerState.notice`. */
  @Input() notice: string | null = null;
  /** Which refusal or notice that is, from `ComposerState.messageId`. */
  @Input() messageId = 0;
  /** Why the alphaTex draft is in the way: an apply that could not parse, or a save refused while it is not applied. */
  @Input() texError: string | null = null;
  /** Which saying of `texError` that is, moved on by the page each time it says one, as `messageId` is by the service. */
  @Input() texErrorId = 0;
  @Input() cursor: EditCursor | null = null;
  @Input() entryMode: EntryMode = 'select';
  /** The document, for the count of bars over. */
  @Input() doc: ScoreDoc | null = null;

  /** "2 bars over their time signatures", or null when none is. Measured when the document changes, not per check. */
  overBarsLabel: string | null = null;
  /** How many bars the score has, shown beside the caret's bar; 0 before there is a document. */
  barCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['doc']) return;
    this.barCount = this.doc?.masterBars.length ?? 0;
    const over = this.doc ? overBarCountOf(this.doc) : 0;
    this.overBarsLabel = over === 0 ? null : `${countOf(over, 'bar')} over ${over === 1 ? 'its time signature' : 'their time signatures'}`;
  }

  /**
   * What the live region says: the alphaTex error, the refusal, then the outcome, each keyed by which saying it is. A
   * refusal and a notice are keyed by `messageId`, and the alphaTex error, which the page holds rather than the
   * service, by `texErrorId`. So the same words said again replace their node and are read out again.
   */
  get messages(): StatusMessage[] {
    const keyed: Array<StatusMessage | null> = [
      this.texError ? { key: `tex:${this.texErrorId}`, text: this.texError } : null,
      this.refusal ? { key: `refusal:${this.messageId}`, text: this.refusal } : null,
      this.notice ? { key: `notice:${this.messageId}`, text: this.notice } : null
    ];
    return keyed.filter((message): message is StatusMessage => message !== null);
  }

  trackByKey(_index: number, message: StatusMessage): string {
    return message.key;
  }
}

/** One message in the live region, and what identifies it there. */
export interface StatusMessage {
  key: string;
  text: string;
}
