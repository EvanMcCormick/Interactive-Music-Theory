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
  Renderer2,
  ViewChild,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { ProgressionState, RelabelNotice } from '../../../../models/progression.model';
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
 *  - the roll's two toolbar buttons beside it are changed with this, to
 *    `aria-disabled` with early-returning handlers and a reason of their own.
 *    Reset to chord is the way out of `No chord matches`, so it is the one
 *    control a user of this chip is most likely to reach for while it is
 *    unavailable; Add note is its neighbour and refuses for the same reason, and
 *    a rule stated here that held on one of two adjacent buttons would not be a
 *    rule.
 *
 * ## The menu is a group of buttons and not a `role="menu"`
 *
 * It was the latter, and that was a promise the component did not keep. A
 * `role="menu"` behind an `aria-haspopup="menu"` puts NVDA and JAWS into
 * *application mode*: the virtual cursor is suppressed and the arrow keys are
 * handed to the page, on the understanding that the page implements the APG
 * menu-button pattern - focus moved into the menu on open, a roving `tabindex`,
 * Arrow Up and Down wrapping, Home and End. None of that was here, focus stayed
 * on the button, and the items were reachable only by Tab. So a screen-reader
 * user was told a menu existed and then given no way to move through it - a
 * sharper version of the disabled `+` this docstring was written about, because
 * a dead control at least announces that it is dead.
 *
 * Nothing about these three commands needs menu semantics. They are three
 * buttons with one heading over them, so they are a `role="group"` with an
 * `aria-label`, behind `aria-haspopup="true"`, and Tab - the model that was
 * being used all along - is now also the model that is declared. The button
 * points `aria-controls` at the group while it is open, so the relationship
 * survives the change.
 *
 * ## It can be dismissed without being answered
 *
 * Escape used to be a template binding on the chip's own element, so it worked
 * only while the focus was inside the chip; nothing at all closed the menu on a
 * click elsewhere. The menu is absolutely positioned over the top-right of the
 * roll's grid and **every item acts**, so a user who reached past a menu they
 * believed dismissed, for a note underneath it, relabelled the slot instead.
 * That is the inverse of this component's own doctrine: not a control that
 * refuses, but a live control floating over the editing surface with no way out.
 *
 * So while the menu is open there are two document-level listeners - Escape from
 * anywhere, and a `pointerdown` outside the host - and `render` closes it on any
 * *new* notice as well as on a cleared one. The last matters because a drag
 * while the menu is open would otherwise replace the items under a pointer that
 * is already moving towards one of them.
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
 * Ids for the `aria-describedby` and `aria-controls` targets, unique per
 * instance.
 *
 * Only one chip is on the page today. A counter rather than a constant because
 * both attributes resolve by id document-wide, so a second instance sharing one
 * id would point both buttons at whichever element happened to render first -
 * and a test bed mounting two components is the cheapest way to produce that.
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

  /** This instance's share of the id space. See `nextChipId`. */
  private readonly instance = nextChipId++;

  /** The `aria-describedby` target's id. */
  readonly hintId = `relabel-chip-hint-${this.instance}`;

  /** The `aria-controls` target's id: the group of commands. */
  readonly menuId = `relabel-chip-menu-${this.instance}`;

  @ViewChild('chipButton') private chipButton?: ElementRef<HTMLElement>;

  /**
   * The notice the current view was built from.
   *
   * Kept only so that `render` can tell a *replaced* notice from a republished
   * one and close the menu over the first. See the class docstring.
   */
  private shownNotice: RelabelNotice | null = null;

  /** Torn-off document listeners, live only while the menu is. */
  private unlisten: (() => void)[] = [];

  private readonly progression = inject(ProgressionService);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly renderer = inject(Renderer2);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
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
    // The listeners are on the document rather than on anything Angular tears
    // down, and a component can be destroyed with its menu open - navigating
    // away from the composer does exactly that.
    this.stopWatching();
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

  /**
   * Opens or closes the menu. The button's own `aria-expanded` follows it.
   *
   * **The focus stays on this button when the menu opens**, and that is the
   * keyboard model rather than an omission: the items are ordinary buttons in a
   * labelled group, so Tab walks into them and Shift+Tab walks back out, and
   * moving the focus off the button would break the one path that works. The
   * class docstring argues why this is not `role="menu"`;
   * `relabel-chip.component.spec.ts` pins the focus so that a later change to
   * the roles cannot quietly leave the behaviour behind.
   */
  toggle(): void {
    if (!this.view) return;

    if (this.isOpen) {
      this.close(false);
      return;
    }

    this.isOpen = true;
    this.watchForDismiss();
    // Marked by hand rather than left to the click that called it: this is
    // `OnPush`, and a caller that is not a template event binding - a key
    // handler on a parent, a spec - would otherwise flip the flag under a view
    // that never redraws.
    this.changes.markForCheck();
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
   * **Nothing at all happens when the service declines.** Not the announcement,
   * and not `dismissed` either: a refused dispatch commits nothing, so the chip
   * is still on screen with the same notice on it, and emitting would send the
   * focus to Reset to chord with nothing said about why it moved - a control
   * that is present and refuses silently, which is the one thing this component
   * is here not to be. Only the menu closes, because the user asked for that.
   */
  private act(dispatch: (id: string) => boolean, outcome: string): void {
    const view = this.view;
    if (!view) return;

    this.close(false);
    if (!dispatch(view.slotId)) return;

    this.announcement = outcome;
    this.dismissed.emit();
    this.changes.markForCheck();
  }

  /**
   * Closes the menu, and puts the focus back where it came from when asked.
   *
   * `returnFocus` is the difference between the two ways out. Escape is a
   * keyboard dismissal and owes the keyboard its place back - a menu that closes
   * under a focus it leaves behind has moved the user to nowhere, which is the
   * loss `ngAfterViewChecked` guards in the roll. A pointer elsewhere on the
   * page, or a notice replaced underneath it, has not asked for the focus and
   * must not take it.
   */
  private close(returnFocus: boolean): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.stopWatching();
    if (returnFocus) this.chipButton?.nativeElement.focus();
    this.changes.markForCheck();
  }

  /**
   * The two ways out that are not an answer, live only while the menu is.
   *
   * On the document rather than on the chip: Escape bound to the chip's own
   * element worked only while the focus was inside it, so opening the menu and
   * clicking into the grid left it stranded over the notes with no key that
   * would shut it. `pointerdown` and not `click`, so the menu is gone before the
   * press that dismissed it resolves into anything - which is the whole point,
   * since the press a user makes here is usually aimed at the note underneath.
   */
  private watchForDismiss(): void {
    this.stopWatching();
    this.unlisten = [
      this.renderer.listen('document', 'keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        this.close(true);
      }),
      this.renderer.listen('document', 'pointerdown', (event: Event) => {
        const target = event.target;
        // Inside the chip is the button itself and the items, both of which have
        // their own handlers; only a press somewhere else is a dismissal.
        if (target instanceof Node && this.host.nativeElement.contains(target)) return;
        this.close(false);
      })
    ];
  }

  private stopWatching(): void {
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  private render(state: ProgressionState): void {
    // Closed on a notice that is *not the one the menu was opened over*, which
    // covers the cleared case - the items act on `view.slotId` and there is none
    // - and the replaced one, where a drag would otherwise swap the alternates
    // under a pointer already moving towards one of them. Identity rather than
    // contents: the recogniser builds a fresh notice every time it makes one, so
    // a republished state that changed nothing here leaves the menu alone.
    if (state.relabel !== this.shownNotice) this.close(false);
    this.shownNotice = state.relabel;

    const view = buildRelabelChipView(state);
    this.view = view;

    // Cleared when there is nothing to say, which is what lets the same sentence
    // be announced twice. See the class docstring.
    this.announcement = view === null ? '' : view.announcement;
  }
}
