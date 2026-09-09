import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  Renderer2,
  ViewChildren,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { MIN_SLOT_BEATS } from '../../../../models/progression-normalize';
import { ProgressionState } from '../../../../models/progression.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import { StripCard, buildStripView } from './progression-strip-cards';
import {
  CardSpan,
  ReorderGesture,
  ResizeGesture,
  beyondDragThreshold,
  draggedBeats,
  dropIndexAt
} from './progression-strip-gestures';

/**
 * The progression as a row of chord cards, each as wide as it is long.
 *
 * ## It holds no state of its own
 *
 * The cards are a cached rendering of `ProgressionService`'s published state,
 * rebuilt whenever that state changes, exactly as the palette's buttons are.
 * Every control dispatches straight back to the service and nothing here is
 * written except by `render` - with three exceptions, each marked as such: the
 * two gesture records from `progression-strip-gestures.ts`, and `draggingId`,
 * which is the styling half of the same fact. All three exist only between a
 * pointer going down and coming up again. They are not a second copy of the
 * document. They are what the pointer is doing, which no other component can
 * ask about and which is gone before the gesture is.
 *
 * ## The row is a timeline
 *
 * A card is laid out at `beats x --strip-px-per-beat` and the row scrolls, so
 * a beat is the same width wherever it falls and a card's left edge is its
 * start beat. The strip began proportional - `flex-grow` carrying the length
 * inside a row of fixed width - and that made the resize handle unusable:
 * growing one card shrank the others, so the length a drag reached went as
 * `w = W*n/(n+B)` while the handle was scaled by a constant, and the pointer
 * ran away from the edge it was holding by 49px on the first beat and 525px by
 * the twelfth. An absolute layout is what makes `pixelsPerBeat` a constant that
 * is actually true, and M2's playhead will need the same mapping.
 *
 * ## One source, and the key it belongs to
 *
 * Everything printed here is a property of the *progression's* key, so
 * `ProgressionService` is the only thing this component subscribes to.
 * `MusicTheoryService` is injected for `spellNote` alone, and `render` hands
 * that one method to `buildStripView` rather than the service - which is what
 * keeps "what a card says" a pure function of a published document, and it
 * lives in `progression-strip-cards.ts` along with the argument for what a card
 * prints and what it deliberately does not.
 */
@Component({
  selector: 'app-progression-strip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progression-strip.component.html',
  styleUrls: ['./progression-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgressionStripComponent implements OnInit, OnDestroy {
  /** The cards, in progression order. */
  cards: readonly StripCard[] = [];

  /** The sentence under the strip, or null when every card has a numeral. */
  unlabelledHint: string | null = null;

  /** The floor the resize handle announces. The model's, not a second copy. */
  readonly minBeats = MIN_SLOT_BEATS;

  /**
   * The card being dragged, for the drag styling. Transient bookkeeping rather
   * than application state: set when a press becomes a drag, cleared when the
   * pointer comes up, and no other component has any business knowing it.
   */
  draggingId: string | null = null;

  /**
   * The rendered cards, for the two measurements a pointer gesture needs. A
   * template reference rather than a `querySelector`, so the geometry is not
   * coupled to a class name a stylesheet may rename.
   */
  @ViewChildren('cardElement') private cardElements!: QueryList<ElementRef<HTMLElement>>;

  private reorder: ReorderGesture | null = null;
  private resize: ResizeGesture | null = null;
  /** Torn-off document listeners, live only while a gesture is. */
  private unlisten: (() => void)[] = [];

  private readonly progression = inject(ProgressionService);
  private readonly musicTheory = inject(MusicTheoryService);
  private readonly renderer = inject(Renderer2);
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
    // A gesture can outlive the component - navigating away mid-drag - and its
    // listeners are on the document rather than on anything Angular tears down.
    this.endGesture();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The slot id is a card's identity: the key changes, the chord does not. */
  trackById(_index: number, card: StripCard): string {
    return card.id;
  }

  // -------------------------------------------------------------------------
  // The controls
  // -------------------------------------------------------------------------

  /** Clicking a card selects it; the palette's +/- controls then act on it. */
  select(card: StripCard): void {
    this.progression.selectSlot(card.id);
  }

  remove(card: StripCard): void {
    this.progression.removeSlot(card.id);
  }

  /**
   * The resize handle's arrow keys: the drag below, for someone not holding a
   * mouse. `setSlotLength` clamps at the short end, so this needs no floor.
   */
  nudgeLength(card: StripCard, beats: number, event?: Event): void {
    // An arrow key on a focused control inside a scrolling strip scrolls it.
    event?.preventDefault();
    this.progression.setSlotLength(card.id, card.lengthBeats + beats);
  }

  // -------------------------------------------------------------------------
  // The gestures
  // -------------------------------------------------------------------------

  /**
   * Pressing a card begins a reorder, reading the strip's geometry as it is.
   *
   * Measured once rather than as the drag goes on, which is what lets the cards
   * stay put for the length of the gesture: nothing is committed until the
   * pointer comes up, so the row the user aims at is the row they can see.
   */
  startReorder(card: StripCard, event: PointerEvent): void {
    // The primary button only. A right-click is a context menu, not a drag.
    if (event.button !== 0) return;
    this.beginReorder(card.id, event.clientX, this.cardSpans());
  }

  /**
   * Begins a reorder from a geometry the caller supplies - the seam between the
   * gesture and the DOM. `startReorder` is the adapter that measures; this is
   * the whole of what a reorder *is*, and splitting them is what lets the
   * behaviour be tested without pinning card widths, gaps or where a handle
   * sits, the layout detail `CLAUDE.md` rules out asserting.
   */
  beginReorder(id: string, originX: number, spans: readonly CardSpan[]): void {
    this.endGesture();
    this.reorder = { id, originX, spans, dragged: false };
    this.listen();
  }

  /**
   * Pressing the right edge begins a resize, scaled by the card's own width.
   *
   * The card's element is handed in by the template rather than looked up by
   * index here. `@ViewChildren` is documented to hold its elements in DOM order
   * and `cards` is what produced that order, but the two are only ever equal by
   * inspection - and a reorder is precisely when they might not be. The
   * template already has the element the press landed in.
   *
   * There is nothing here to stop propagating. This used to call
   * `stopPropagation` against "the card begins a reorder", which was simply not
   * true: `startReorder` is bound to `.body`, a *sibling* of the handle rather
   * than an ancestor of it, so a press on the handle never reaches it at all.
   */
  startResize(card: StripCard, event: PointerEvent, element: HTMLElement): void {
    if (event.button !== 0) return;
    // Text selection and the browser's own drag would both fight the gesture.
    event.preventDefault();
    // Which also suppresses the focus a press would otherwise give the handle,
    // and the arrow keys are the whole keyboard path to resizing. Without this
    // a mouse user has to Tab back to a control they are already holding.
    (event.currentTarget as HTMLElement | null)?.focus();

    // The card's own width over its own length: dragging the edge out by the
    // width of the card doubles it, which is the correspondence the user can
    // see. A card with no width on screen gives 0, and `draggedBeats` declines
    // rather than dividing by it.
    this.beginResize(card.id, event.clientX, card.lengthBeats, this.beatWidth(element, card));
  }

  /**
   * Begins a resize at a known scale - the seam above, for the other gesture.
   *
   * `pixelsPerBeat` is fixed for the drag's length, and unlike the proportional
   * layout this replaced, that is not an approximation: a card is laid out at
   * `beats x --strip-px-per-beat` and the row scrolls, so growing one card
   * moves the others along rather than squeezing them, and one beat is the same
   * number of pixels before the drag and after it.
   */
  beginResize(id: string, originX: number, startBeats: number, pixelsPerBeat: number): void {
    this.endGesture();
    this.resize = { id, originX, startBeats, pixelsPerBeat, beats: startBeats, committed: false };
    this.listen();
  }

  /**
   * A resize commits on every whole beat crossed; a reorder commits on release.
   *
   * The difference is what each can show. A resize is visible while it happens
   * - the card is the length it is being dragged to - and `setSlotLength` is
   * written for exactly that, clamping a drag past zero rather than throwing
   * out of it.
   *
   * The cost used to be that one drag across three beats left three undo
   * entries, and a pointer jittering on a beat boundary left as many as it
   * liked. `coalesce` is the service's answer - the first length a drag commits
   * opens an entry and every later one folds into it - and this is the flag
   * that says which is which. It is the gesture's own bookkeeping, not a second
   * copy of the length: `resize.beats` is what the *drag* has reached, which is
   * also what `draggedBeats` rounds against so the edge does not flicker across
   * a boundary the pointer is resting on.
   */
  onPointerMove(event: PointerEvent): void {
    const resize = this.resize;
    if (resize) {
      const beats = draggedBeats(
        resize.startBeats,
        event.clientX - resize.originX,
        resize.pixelsPerBeat,
        resize.beats
      );
      if (beats === resize.beats) return;

      this.progression.setSlotLength(resize.id, beats, { coalesce: resize.committed });
      resize.beats = beats;
      resize.committed = true;
      return;
    }

    const reorder = this.reorder;
    if (!reorder) return;
    if (!beyondDragThreshold(reorder.originX, event.clientX)) return;

    reorder.dragged = true;
    if (this.draggingId !== reorder.id) {
      this.draggingId = reorder.id;
      this.changes.markForCheck();
    }
  }

  /** Releasing drops a dragged card where the pointer left it. */
  onPointerUp(event: PointerEvent): void {
    const reorder = this.reorder;
    this.endGesture();

    // A press that never became a drag was a click, and the click handler has
    // already selected the card. Reordering it as well would move a chord the
    // user only meant to pick.
    if (!reorder || !reorder.dragged) return;

    // `moveSlot` clamps and ignores a move to where the slot already is, so a
    // drag released back over its own card costs nothing - and stating that
    // rule here as well would be a second copy of it.
    this.progression.moveSlot(reorder.id, dropIndexAt(event.clientX, reorder.spans));
  }

  /** A cancelled pointer - a browser gesture taking over - commits nothing. */
  onPointerCancel(): void {
    this.endGesture();
  }

  // -------------------------------------------------------------------------
  // Gesture plumbing
  // -------------------------------------------------------------------------

  /**
   * Listens on the document for the rest of the gesture: a drag leaves the card
   * it started on. Released when the gesture ends, so a page nobody is dragging
   * runs no pointer handler at all - an always-attached `pointermove` handler
   * costs a change-detection pass per pixel of every mouse movement anywhere.
   *
   * It assigns rather than appends, and needs no guard against listening twice:
   * both callers run `endGesture()` first, which unlistens and empties the
   * list. `progression-strip-pointer.spec.ts` holds the document to that.
   */
  private listen(): void {
    this.unlisten = [
      this.renderer.listen('document', 'pointermove', (event: PointerEvent) =>
        this.onPointerMove(event)
      ),
      this.renderer.listen('document', 'pointerup', (event: PointerEvent) =>
        this.onPointerUp(event)
      ),
      this.renderer.listen('document', 'pointercancel', () => this.onPointerCancel())
    ];
  }

  /** Ends whatever gesture is under way, committing nothing. */
  private endGesture(): void {
    this.reorder = null;
    this.resize = null;

    for (const off of this.unlisten) off();
    this.unlisten = [];

    if (this.draggingId !== null) {
      this.draggingId = null;
      this.changes.markForCheck();
    }
  }

  /** Where each card ends, left to right, as the browser has laid them out. */
  private cardSpans(): CardSpan[] {
    return this.cardElements.map(element => ({
      right: element.nativeElement.getBoundingClientRect().right
    }));
  }

  /** How many pixels one beat of this card occupies, or 0 if it is not drawn. */
  private beatWidth(element: HTMLElement, card: StripCard): number {
    // `lengthBeats` is at least `MIN_SLOT_BEATS`, so this cannot divide by zero.
    return element.getBoundingClientRect().width / card.lengthBeats;
  }

  /** Rebuilds every card from one published state. */
  private render(state: ProgressionState): void {
    const view = buildStripView(state, (pitchClass, preferSharps) =>
      this.musicTheory.spellNote(pitchClass, preferSharps)
    );

    this.cards = view.cards;
    this.unlabelledHint = view.unlabelledHint;
  }
}
