import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { ProgressionState } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { RelabelAlternate, RelabelChipView, buildRelabelChipView } from './relabel-chip-view';

/**
 * What the app did to a label, and the way back from it.
 *
 * The visible half of M3's recogniser. An edit to a slot's notes can change what
 * the slot is called, and the design's containment rule is that such a change is
 * **never silent**: the app may relabel, but not without saying so and not
 * without a way back. This says so - on screen as `Isus4 ▾ (was I)`, aloud
 * through a live region - and the menu behind the button is the way back.
 *
 * ## It holds no state of its own
 *
 * The chip is a rendering of `ProgressionState.relabel`, worked out in
 * `relabel-chip-view.ts`, which takes a published state and answers with a view
 * model. Two fields here are written outside `render` and both are about the
 * *page* rather than the document: `isOpen`, which is whether a menu is on
 * screen, and `announcement`, which is what the live region is currently
 * holding. Neither is undoable, neither is saved, and nothing else reads either.
 *
 * ## The live region is the wrapper, and it is always here
 *
 * The chip itself comes and goes with the notice; the region around it does not.
 * A region announces changes *to itself* rather than its own arrival, so a
 * region created in the same change-detection pass as its text says nothing at
 * all - which is the bug the palette's `unavailable-region` comment was written
 * about, one component over. The wrapper is therefore outside every `*ngIf` in
 * the template, and the component itself is placed in the roll's toolbar
 * unconditionally for the same reason.
 *
 * `announcement` is cleared whenever the notice goes, which is what lets the
 * *same* relabel be announced twice: a region whose text never changes never
 * speaks, and dragging a note back and forth is exactly how a user produces the
 * same sentence twice in a row.
 *
 * ## Every control names its own reason
 *
 * There is no disabled control here, and that is deliberate. A sibling review
 * found the palette's disabled `+` explaining itself only through a detached
 * live region - and because it is `[disabled]` it is out of the tab order, so a
 * user who arrives after the announcement cannot ask why. The pattern that
 * closes it is a focusable control that carries its own reason, and this
 * component applies it in three places rather than inheriting the older one:
 *
 *  - the chip's button points `aria-describedby` at a sentence saying what a
 *    relabel is and that the notes are kept either way, so the reason is
 *    available at any time and not only in the moment it was announced;
 *  - every menu item acts - there is no item here that can be present and
 *    refuse, because a menu of dead options is the same failure in a smaller
 *    space. Where the view builder finds a control that could not act - a notice
 *    naming another slot, whose *Back to* `revertRelabel` would refuse - it
 *    draws no chip at all;
 *  - the roll's Reset to chord beside it is changed with this, to `aria-disabled`
 *    with an early-returning handler and a reason of its own. It is the way out
 *    of `No chord matches`, so it is the one control a user of this chip is most
 *    likely to reach for while it is unavailable.
 *
 * ## Where the focus goes when the chip vanishes
 *
 * Answering the chip clears the notice, so the button the user just activated
 * stops existing - and a focus left on a removed element falls to `<body>`,
 * which is the roll's own `pendingFocus` failure in a different corner. So an
 * action emits `dismissed` and the roll puts the focus on Reset to chord, the
 * neighbour that is always focusable now and the next thing a user is likely to
 * want after *Keep as literal*.
 */

/**
 * Ids for the `aria-describedby` targets, unique per instance.
 *
 * Only one chip is on the page today. A counter rather than a constant because
 * `aria-describedby` resolves by id document-wide, so a second instance sharing
 * one id would point both buttons at whichever element happened to render first
 * - and a test bed mounting two components is the cheapest way to produce that.
 */
let nextChipId = 0;

@Component({
  selector: 'app-relabel-chip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './relabel-chip.component.html',
  styleUrls: ['./relabel-chip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RelabelChipComponent implements OnInit, OnDestroy {
  /**
   * Raised when the chip has been answered and is about to go.
   *
   * The roll moves the focus off the button that is being removed. See the
   * docstring's last section.
   */
  @Output() dismissed = new EventEmitter<void>();

  /** What to draw, or null when there is no relabel to show. */
  view: RelabelChipView | null = null;

  /** Whether the menu is on screen. See the class docstring. */
  isOpen = false;

  /** What the live region is holding. Empty means it is silent. */
  announcement = '';

  /** The `aria-describedby` target's id. See `nextChipId`. */
  readonly hintId = `relabel-chip-hint-${nextChipId++}`;

  @ViewChild('chipButton') private chipButton?: ElementRef<HTMLElement>;

  private readonly progression = inject(ProgressionService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.render(state);
        this.changes.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** An alternate's identity is what it is called; see `RelabelAlternate.key`. */
  trackByKey(_index: number, alternate: RelabelAlternate): string {
    return alternate.key;
  }

  // -------------------------------------------------------------------------
  // The menu
  // -------------------------------------------------------------------------

  /** Opens or closes the menu. The button's own `aria-expanded` follows it. */
  toggle(): void {
    if (!this.view) return;

    this.isOpen = !this.isOpen;
    // Marked by hand rather than left to the click that called it: this is
    // `OnPush`, and a caller that is not a template event binding - a key
    // handler on a parent, a spec - would otherwise flip the flag under a view
    // that never redraws.
    this.changes.markForCheck();
  }

  /**
   * Escape closes the menu and puts the focus back on the button that opened it.
   *
   * Both halves are the requirement rather than one: a menu that closes under a
   * focus it leaves behind has moved a keyboard user to nowhere, which is the
   * same loss of place `ngAfterViewChecked` guards in the roll.
   */
  closeOnEscape(event: Event): void {
    if (!this.isOpen) return;

    event.stopPropagation();
    this.isOpen = false;
    this.changes.markForCheck();
    this.chipButton?.nativeElement.focus();
  }

  // -------------------------------------------------------------------------
  // The three answers
  // -------------------------------------------------------------------------

  /**
   * Takes one of the runners-up. The notes do not move: an alternate is another
   * *name* for the notes that are there.
   */
  choose(alternate: RelabelAlternate): void {
    this.act(
      id => this.progression.chooseRelabelAlternate(id, alternate.degree),
      `Labelled ${alternate.spoken}. The notes are unchanged.`
    );
  }

  /** Puts the old label back and keeps the edit. Not an undo; see the service. */
  revert(): void {
    const view = this.view;
    if (!view) return;

    this.act(id => this.progression.revertRelabel(id), view.revertedAnnouncement);
  }

  /** Says this slot is notes and not a chord, and stops it being re-read. */
  keepAsLiteral(): void {
    const view = this.view;
    if (!view) return;

    this.act(id => this.progression.keepAsLiteral(id), view.keptAnnouncement);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The shape the three answers share: dispatch, then say what happened.
   *
   * The order is load-bearing. A dispatch that records anything publishes
   * synchronously, the publish clears the notice, and `render` empties the live
   * region - so an outcome written *before* the call would be wiped by the call
   * itself, and the user would be told the chord's new name and nothing about
   * the one they just chose.
   *
   * Nothing is said when the service declines, because nothing happened.
   */
  private act(dispatch: (id: string) => boolean, outcome: string): void {
    const view = this.view;
    if (!view) return;

    this.isOpen = false;
    const acted = dispatch(view.slotId);
    if (acted) this.announcement = outcome;

    // Emitted either way: the menu is closed and the chip is going, so the focus
    // has to leave whatever it was on whether or not the document changed.
    this.dismissed.emit();
    this.changes.markForCheck();
  }

  private render(state: ProgressionState): void {
    const view = buildRelabelChipView(state);
    this.view = view;

    // Closed with the notice rather than left open over nothing: the menu's
    // items act on `view.slotId`, and there is none.
    if (view === null) this.isOpen = false;

    // Cleared when there is nothing to say, which is what lets the same sentence
    // be announced twice. See the class docstring.
    this.announcement = view === null ? '' : view.announcement;
  }
}
