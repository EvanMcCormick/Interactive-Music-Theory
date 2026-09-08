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

import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  ProgressionState,
  SlotHarmony
} from '../../../../models/progression.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import { chordName, romanNumeral, spokenChordName } from '../../../../services/progression-harmony';
import {
  CardSpan,
  ReorderGesture,
  ResizeGesture,
  beyondDragThreshold,
  draggedBeats,
  dropIndexAt
} from './progression-strip-gestures';

/** One chord card: what it is called, how long it is, and what it says aloud. */
export interface StripCard {
  /** The slot's id. The card's identity for `trackBy`, and for every dispatch. */
  id: string;
  /** `V7`, or the unlabelled mark when the key cannot name this chord. */
  numeral: string;
  name: string;
  /** Beats. The card is drawn this many units wide; see the SCSS. */
  lengthBeats: number;
  isSelected: boolean;
  /** Whether this card has no numeral to show. See `describeSlot`. */
  isUnlabelled: boolean;
  /**
   * What the card says aloud, built here rather than in the template, for the
   * palette's two reasons: a concatenation in an `[attr.aria-label]` binding is
   * re-evaluated on every change-detection pass, and `V7` over `G7` announces
   * as "vee seven, gee seven" rather than as a chord. See `spokenChordName`.
   */
  label: string;
  removeLabel: string;
  resizeLabel: string;
}

/** The numeral slot of a card that has no numeral. */
const NO_NUMERAL = '—';

/** The name of a chord this key cannot name. */
const UNLABELLED_NAME = 'Unlabelled';

/** How such a card refers to itself in the labels that are read aloud. */
const UNLABELLED_SUBJECT = 'unlabelled chord';

/** Said once below the strip rather than on each card, which has no room. */
const UNLABELLED_HINT =
  'A card with no numeral is a chord this key cannot name. Its notes are kept exactly as they are.';

/**
 * The progression as a row of chord cards, each as wide as it is long.
 *
 * ## It holds no state of its own
 *
 * The cards are a cached rendering of `ProgressionService`'s published state,
 * rebuilt whenever that state changes, exactly as the palette's buttons are.
 * Every control dispatches straight back to the service and nothing here is
 * written except by `render` - with one exception, marked as such: the two
 * gesture records from `progression-strip-gestures.ts`, which exist only
 * between a pointer going down and coming up again. They are not a second copy
 * of the document. They are what the pointer is doing, which no other component
 * can ask about and which is gone before the gesture is.
 *
 * ## One source, and the key it belongs to
 *
 * Everything printed here is a property of the *progression's* key, so
 * `ProgressionService` is the only thing this component subscribes to.
 * `MusicTheoryService` is injected for `spellNote` alone, and is asked to spell
 * a note with a given preference rather than asked what the preference is:
 * `getNoteName` answers for the fretboard's key, the two are allowed to differ,
 * and asking the app-wide rule is how the palette came to print `D♯ Maj` as the
 * tonic chord of E flat major.
 *
 * ## What a card prints, and what it deliberately does not
 *
 * The numeral and the name both come from `ChordDegree.quality` - the field the
 * model stores and `regenerateSlot` recomputes on every change that could move
 * it. That source of truth is chosen rather than fallen into, because a second
 * one is available and the two disagree: `degreeQuality` names a ninth after
 * its seventh, so a slot raised to a ninth reports `dominant7` and prints `V7`
 * while the palette's complexity readout beside it says "9th".
 * `romanNumeral`'s docstring records that deferral and leaves Task 7 the
 * choice - carry the height here too, which means widening that signature, or
 * label the two readouts so a user is not left comparing them.
 *
 * **The card does not show the height.** Numeral and name are both figured from
 * the one stored quality, so a card's two lines can never disagree with each
 * other, and the panel that says "9th" is labelled "Complexity" - a different
 * question about the same chord. Printing `V9` here would put a second
 * convention in a component, derived from the extent while the chord name
 * beside it still read `G7`: the disagreement would move onto the card rather
 * than off it. The fix is `romanNumeral` taking the extent, made there rather
 * than pasted onto its result here. M2, with the `quality` override that
 * borrowed chords need.
 *
 * ## Unlabelled rather than mislabelled
 *
 * `describeSlot` prints a numeral only when the slot has a degree *and* the
 * key can name it, and says so plainly otherwise. The `literal` branch is
 * unreachable in M1 - the recogniser that degrades a slot to literal is M3's -
 * but the rule becomes visible to a user here, on the card, so it is written
 * now rather than discovered then.
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

  /** Pressing the right edge begins a resize, scaled by the card's own width. */
  startResize(card: StripCard, event: PointerEvent): void {
    if (event.button !== 0) return;
    // The handle sits inside the card, and the card begins a reorder. Without
    // this, dragging the edge would drag the whole chord as well.
    event.stopPropagation();
    event.preventDefault();

    // The card's own width over its own length: dragging the edge out by the
    // width of the card doubles it, which is the correspondence the user can
    // see. A card with no width on screen gives 0, and `draggedBeats` declines
    // rather than dividing by it.
    this.beginResize(card.id, event.clientX, card.lengthBeats, this.beatWidth(card));
  }

  /**
   * Begins a resize at a known scale - the seam above, for the other gesture.
   *
   * `pixelsPerBeat` is fixed for the drag's length even though the strip
   * re-flows underneath it: a scale recomputed from the card being resized
   * would change every time it grew, so the pointer would chase a moving target.
   */
  beginResize(id: string, originX: number, startBeats: number, pixelsPerBeat: number): void {
    this.endGesture();
    this.resize = { id, originX, startBeats, pixelsPerBeat };
    this.listen();
  }

  /**
   * A resize commits on every whole beat crossed; a reorder commits on release.
   *
   * The difference is what each can show. A resize is visible while it happens
   * - the card is the length it is being dragged to - and `setSlotLength` is
   * written for exactly that, clamping a drag past zero rather than throwing
   * out of it. The cost is that one drag across three beats leaves three undo
   * entries. Each is a length the user passed through deliberately, so none is
   * wrong; collapsing them is a transaction on `commit()` rather than something
   * this component should fake by holding a second copy of the length.
   */
  onPointerMove(event: PointerEvent): void {
    if (this.resize) {
      const beats = draggedBeats(
        this.resize.startBeats,
        event.clientX - this.resize.originX,
        this.resize.pixelsPerBeat
      );
      this.progression.setSlotLength(this.resize.id, beats);
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
   */
  private listen(): void {
    if (this.unlisten.length > 0) return;
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

  /** Where each card sits, left to right, as the browser has laid them out. */
  private cardSpans(): CardSpan[] {
    return this.cardElements.map(element => {
      const rect = element.nativeElement.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
  }

  /** How many pixels one beat of this card occupies, or 0 if it is not drawn. */
  private beatWidth(card: StripCard): number {
    const index = this.cards.findIndex(candidate => candidate.id === card.id);
    const element = this.cardElements.get(index);
    if (!element) return 0;
    // `lengthBeats` is at least `MIN_SLOT_BEATS`, so this cannot divide by zero.
    return element.nativeElement.getBoundingClientRect().width / card.lengthBeats;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Rebuilds every card from one published state. */
  private render(state: ProgressionState): void {
    // The palette's gate, read rather than recomputed. `canBuildChords` is
    // `isHeptatonic` already applied to `keyScale`, so the strip refuses to
    // name a chord in exactly the keys the palette refuses to offer one - two
    // halves of one screen giving one answer about what the key can say.
    const intervals = state.canBuildChords && state.keyScale ? state.keyScale.intervals : null;

    this.cards = state.doc.slots.map(slot => this.buildCard(slot, state, intervals));
    this.unlabelledHint = this.cards.some(card => card.isUnlabelled) ? UNLABELLED_HINT : null;
  }

  private buildCard(
    slot: ChordSlot,
    state: ProgressionState,
    intervals: readonly number[] | null
  ): StripCard {
    const described = this.describeSlot(slot.harmony, state.doc.key, intervals);
    const beats = formatBeats(slot.lengthBeats);

    return {
      id: slot.id,
      numeral: described.numeral,
      name: described.name,
      lengthBeats: slot.lengthBeats,
      isSelected: slot.id === state.selectedSlotId,
      isUnlabelled: described.numeral === NO_NUMERAL,
      label: `${described.subject}, ${described.detail}, ${beats}`,
      removeLabel: `Remove ${described.subject}`,
      resizeLabel: `Length of ${described.subject}, ${beats}`
    };
  }

  /**
   * What to print on a card, and what to say about it.
   *
   * Three roads to the same refusal, told apart because they are different
   * facts about the progression: a slot the recogniser could not name, one the
   * user detached by hand, and a slot whose degree is perfectly good but whose
   * *key* has no name for it. The last is reachable today - build in C major
   * and switch to a pentatonic - and it is a refusal rather than a stale label
   * because the stored quality came from a scale no longer selected.
   */
  private describeSlot(
    harmony: SlotHarmony,
    key: ProgressionKey,
    intervals: readonly number[] | null
  ): CardDescription {
    if (harmony.kind === 'literal') {
      return unlabelled(
        harmony.reason === 'unrecognised'
          ? 'its notes match no chord in this key'
          : 'detached from the key by hand'
      );
    }

    if (!intervals) return unlabelled('this key cannot name it');

    const degree = harmony.degree;
    const root = this.musicTheory.spellNote(rootPitchClass(key, intervals, degree), key.preferSharps);

    return {
      numeral: romanNumeral(degree.degree, degree.quality),
      name: chordName(root, degree.quality),
      subject: spokenChordName(root, degree.quality),
      // The numeral is dropped from the spoken label and the position given as
      // a degree instead, exactly as the palette does it: read aloud a numeral
      // is a string of letters, and the quality it carries is already in the
      // spoken name.
      detail: `degree ${degree.degree + 1}`
    };
  }
}

/** What a card prints, and the two phrases its labels are built from. */
interface CardDescription {
  numeral: string;
  name: string;
  /** The chord as a phrase to be read aloud: `G major`. */
  subject: string;
  /** What else there is to say about it: its position, or why it has no numeral. */
  detail: string;
}

/** A card with no numeral, and the reason it has none. */
function unlabelled(detail: string): CardDescription {
  return {
    numeral: NO_NUMERAL,
    name: UNLABELLED_NAME,
    subject: UNLABELLED_SUBJECT,
    detail
  };
}

/**
 * The pitch class a card names its chord from.
 *
 * `alter` then the tonic, which is the order `generateSlotNotes` applies them
 * in - so the name and the sound come from one arithmetic. Both are additions
 * and the order between them is unobservable; what matters is that neither is
 * left out, and `alter` can push the sum below zero, where JavaScript's `%`
 * returns a negative and `spellNote` would index off the front of the
 * chromatic table. Nothing in M1 moves `alter`, but `replaceDocument` can bring
 * in a document that already has.
 */
function rootPitchClass(
  key: ProgressionKey,
  intervals: readonly number[],
  degree: ChordDegree
): number {
  const raw = key.tonic + intervals[degree.degree] + degree.alter;
  return ((raw % 12) + 12) % 12;
}

/** `1 beat`, `4 beats`, `1.5 beats`. */
function formatBeats(beats: number): string {
  // `lengthBeats` is a float, and M2's free timing will put fractions here.
  const shown = Number(beats.toFixed(2));
  return `${shown} ${shown === 1 ? 'beat' : 'beats'}`;
}
