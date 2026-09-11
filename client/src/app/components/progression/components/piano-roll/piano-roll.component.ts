import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  Renderer2,
  ViewChild,
  ViewChildren,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { DEFAULT_VELOCITY, MIN_NOTE_BEATS } from '../../../../models/progression-normalize';
import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { ProgressionService } from '../../../../services/progression.service';
import { MAX_BEAT_DIVISION, floorBeat, xToBeat, yToMidi } from './piano-roll-geometry';
import { draggedVelocity, heldRows, heldSnap } from './piano-roll-gestures';
import { RelabelChipComponent } from '../relabel-chip/relabel-chip.component';
import {
  DivisionOption,
  RollNoteView,
  RollRow,
  VELOCITY_SPAN,
  buildDivisions,
  buildRollView
} from './piano-roll-view';

/**
 * The selected slot's notes, on a grid of pitch rows against beats.
 *
 * ## It holds no state of its own
 *
 * The notes and the rows are a cached rendering of `ProgressionService`'s
 * published state, rebuilt whenever that state changes, exactly as the strip's
 * cards are - and worked out in `piano-roll-view.ts`, which takes a published
 * document and answers with a view model, so what the roll draws stays a pure
 * function of what the service published. Every gesture dispatches straight back
 * to the service and nothing here is written except by `render` - with three
 * exceptions, each marked as such: the three gesture records below, which exist
 * only between a pointer going down and coming up again; `pendingFocus`, which
 * exists between an edit and the change-detection pass that draws it; and
 * `division`.
 *
 * **`division` is a property of this editor, not of the progression.** How
 * finely the roll snaps is the same kind of fact as which zoom a map is at: it
 * is not saved, it is not undoable, nothing else on the page reads it, and two
 * users editing one document would each want their own. Putting it on the
 * service would make choosing a grid an event the document could be rebuilt
 * from, which is exactly what it is not.
 *
 * ## The layout is absolute, and that is not a detail
 *
 * The grid is `--px-per-beat` wide per beat and `--row-height` tall per
 * semitone, in a container that scrolls; a note is placed with `calc()` off the
 * same two custom properties. M1's strip began proportional - `flex-grow`
 * carrying the length inside a row of fixed width - and the resize handle ran up
 * to 525 pixels away from the cursor holding it, because no constant scale can
 * track a mapping that is not linear. `piano-roll-geometry.ts` carries the full
 * argument; what it means here is that the pointer arithmetic can be scaled by
 * one number, and that number is true.
 *
 * **The scale is measured rather than declared.** `gridScale` divides the grid's
 * own rect by the counts the view model already holds, which is the strip's
 * `beatWidth` and for the strip's reason: a scale read out of the stylesheet is
 * a second statement of the layout, and two statements of a rule can disagree.
 * Measuring cannot. It also gives the spec a real divisor to mutate - the strip
 * shipped with one that had been dropped, and nothing caught it.
 *
 * ## Grid lines are a background, notes are elements
 *
 * The design doc calls this out and it is the one performance decision the roll
 * makes: a four-bar slot at a 1/16 grid is 256 vertical lines and 25 horizontal
 * ones, and drawing 281 elements that nothing ever hit-tests is what makes naive
 * rolls stutter. As repeating gradients they cost one paint, and the notes -
 * which do need to be hit-tested, focused and labelled - stay elements.
 *
 * ## Which setter each gesture uses, and why it matters
 *
 * `SlotOwnership` is per aspect, so a gesture has to claim exactly what it
 * moved: over-claiming freezes a dimension out of re-voicing that the user never
 * touched, and under-claiming throws their edit away at the next key change.
 *
 *  - **A drag, and either way of adding a note, use `placeNotes`.** A
 *    double-click on the grid and the Add note button both put a note
 *    *somewhere* - a pitch and a beat in one movement - so both claims are the
 *    user's and both are recorded in one commit. `setSlotNotes` claims
 *    pitches only, so a note placed through it alone is snapped back to beat 0
 *    by the next regeneration; `placeNotes` exists for exactly this and its
 *    docstring argues the case.
 *  - **Delete, and the pitch arrows, use `setSlotNotes`.** Removing a note or
 *    moving one up a semitone says nothing whatever about the rhythm, and the
 *    keyboard is where that gesture can exist on its own, because the two axes
 *    are two different keys.
 *  - **The right edge, and the time arrows, use `setNoteTiming`.** Timing only,
 *    which is M1's rule that a timing edit never changes what chord a slot is.
 *  - **The velocity lane uses `setNoteVelocity`.**
 *
 * ## Every pointerdown opens its own undo run
 *
 * `coalesce` is false on the first commit of a gesture and true for every one
 * after, so a drag across six grid lines is one step back rather than six. That
 * has to be done per *gesture* and not per note: `setSlotNotes` and `placeNotes`
 * write the whole list, so their run keys can only name the slot, and two drags
 * on two different notes of one slot would otherwise fold into a single entry.
 * `ProgressionNoteEditor.writeNotes` states the discipline; this is where it is
 * kept, in `beginMove`, `beginResize` and `beginVelocity`, each of which starts
 * its gesture uncommitted - and `committed` becomes true only when a setter
 * says it recorded something, which `onPointerMove` argues at length.
 *
 * ## A pitch drag is read back as a chord once, at its end
 *
 * Every commit a *move* makes passes `deferRecognition`, so the recogniser does
 * not see the note travelling; `endGesture` calls `settlePitchGesture` on
 * pointerup and pointercancel, under the drag's own run key, so the label the
 * notes turned out to mean lands in the same undo entry as the notes. A one-shot
 * pitch edit - a double-click add, a delete, an arrow-key nudge - defers
 * nothing and recognises inside its own commit, because it has no later moment
 * to defer to. The resize and velocity gestures never reach it at all.
 *
 * ## Every control has a keyboard as well as a pointer
 *
 * Not a courtesy: a roll a keyboard cannot reach is an editor a keyboard user
 * cannot use, and the arrow keys are advertised on the panel itself as the
 * alternative path. So a note can be moved, resized, re-voiced, re-velocitied
 * and deleted from the keyboard - and **made**, which is what the Add note
 * button in the toolbar is for. The double-click surface is a bare `<div>` that
 * no tab reaches and no key answers, so without that button a keyboard user who
 * emptied a slot had no way to put a note back into it. `addNoteAtStart` carries
 * the argument, and `ngAfterViewChecked` the focus that has to follow it.
 */

/** How much one press of a velocity arrow key is worth, in MIDI units. */
const VELOCITY_NUDGE = 5;

/** The grid the roll opens on: sixteenths, the default in every DAW there is. */
const DEFAULT_BEAT_DIVISION = 4;

/**
 * What every gesture records the moment the pointer goes down, whatever it is
 * about to drag.
 *
 * ## The slot is captured, not read back
 *
 * `notes` on a move is snapshotted for a stated reason - a drag is measured from
 * where it began - and **the slot it belongs to is the same kind of fact.** A
 * handler that read `this.slotId` on every `pointermove` would be asking where
 * the selection is *now*, and the selection is not the gesture's to follow: the
 * strip is a sibling on the same page and a click on another card republishes
 * the state under a drag already in progress. The notes would then be slot A's,
 * measured against slot A's geometry, and written into slot B.
 *
 * Nothing on the page can do that today - a pointer held down over the roll is
 * not clicking the strip - so this closes it by construction rather than because
 * it was reachable. It costs one field, and the field is also the honest
 * statement: a gesture acts on the slot it started on.
 *
 * ## `committed` means an entry is open, and only that
 *
 * It is what decides `coalesce`, so it has to be true exactly when this gesture
 * has an undo entry of its own to fold into - which is why it is set from what
 * the setter *answers* rather than from the fact that it was called.
 * `ProgressionNoteEditor.writeNotes` carries the argument.
 */
interface Gesture {
  /** The slot this gesture started on, and the only one it will ever write to. */
  slotId: string;
  index: number;
  /** Whether a commit of this gesture has actually landed. */
  committed: boolean;
}

/**
 * A note being dragged in pitch and time.
 *
 * Transient by construction, on the same terms as the strip's two: it exists
 * between a pointer going down and coming up again and nothing outside this
 * component can ask about it. `notes` is the slot's list as it was when the drag
 * began, so every move is measured from where the drag started rather than
 * accumulated - the strip's rule, and what stops a drag that goes out and comes
 * back leaving the note somewhere else.
 */
interface MoveGesture extends Gesture {
  originX: number;
  originY: number;
  startBeat: number;
  startMidi: number;
  notes: readonly RollNote[];
  pixelsPerBeat: number;
  rowHeight: number;
  /** The beat the drag has reached; the dead zone is measured against it. */
  beat: number;
  /** The semitones the drag has reached, likewise. */
  semitones: number;
}

/** A note's right edge being dragged. Transient on the same terms. */
interface ResizeGesture extends Gesture {
  originX: number;
  startBeat: number;
  startLength: number;
  pixelsPerBeat: number;
  length: number;
}

/** A velocity being dragged. Transient on the same terms. */
interface VelocityGesture extends Gesture {
  originY: number;
  startVelocity: number;
  pixelsPerVelocity: number;
  velocity: number;
}

@Component({
  selector: 'app-piano-roll',
  standalone: true,
  imports: [CommonModule, RelabelChipComponent],
  templateUrl: './piano-roll.component.html',
  styleUrls: ['./piano-roll.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PianoRollComponent implements OnInit, AfterViewChecked, OnDestroy {
  /** Whether a slot is selected at all. Nothing is drawn when none is. */
  hasSlot = false;

  /** The notes on screen, in the slot's own order. */
  notes: readonly RollNoteView[] = [];

  /** The keyboard down the left, top row first. */
  rows: readonly RollRow[] = [];

  /** How many beats wide the grid is: the slot, or the last note if it runs past. */
  totalBeats = 0;

  /** How many pitch rows tall it is. `rowCount` of the window. */
  gridRows = 0;

  /** The highest pitch drawn - `midiToY`'s `topMidi`, and the row-zero pitch. */
  topMidi = 0;

  /** `Chord 2 of 4`, or the reason there is nothing to edit. */
  positionText = '';

  /** Whether there is a chord to hand the slot back to. */
  canReset = false;

  /** Why there is not, or null when there is. See `RollView.resetReason`. */
  resetReason: string | null = null;

  /** Steps per beat, or 0 for free timing. See the class docstring. */
  division = DEFAULT_BEAT_DIVISION;

  /**
   * One grid cell in beats - what an arrow key moves, and how long a new note is.
   *
   * The three fields below are derived from `division` and are written **only**
   * by `applyDivision`, which `ngOnInit` calls before the first render for
   * exactly that reason: initialising them here as well would be a second
   * statement of a rule that already has one, and a second statement that
   * happens to agree today is the kind that stops agreeing quietly. The zeros
   * are TypeScript's definite-assignment requirement and nothing else - nothing
   * reads them.
   */
  gridStep = 0;

  /**
   * The shortest a resize may reach.
   *
   * One grid cell rather than `MIN_NOTE_BEATS`, so the edge rests where the grid
   * says it will: snapping to a 1/4-beat grid and then clamping to a 1/16 beat
   * would leave the edge off the very lines the user is snapping to. The two
   * meet at `MAX_BEAT_DIVISION`, which is `1 / MIN_NOTE_BEATS` and is derived
   * from it for exactly this reason.
   */
  minNoteLength = 0;

  /**
   * The divisor the subdivision gradient uses. Never 0 once `applyDivision` has
   * run, which is the point of it - CSS cannot divide by zero - and the zero
   * here is the same definite-assignment placeholder as the two above, for the
   * reason their docstring gives. It read `1` and so read as a default, which is
   * a second statement of a rule `applyDivision` already makes.
   */
  gridDivision = 0;

  /** The grid control's entries. */
  readonly divisions: readonly DivisionOption[] = buildDivisions();

  @ViewChild('grid') private gridElement?: ElementRef<HTMLElement>;
  @ViewChild('lane') private laneElement?: ElementRef<HTMLElement>;
  @ViewChild('addButton') private addButton?: ElementRef<HTMLElement>;
  @ViewChild('resetButton') private resetButton?: ElementRef<HTMLElement>;
  @ViewChildren('noteBody') private noteBodies?: QueryList<ElementRef<HTMLElement>>;

  /**
   * Where the focus has to go once the notes have been redrawn, or null.
   *
   * Deferred rather than done at the call, because the element to focus does not
   * exist yet: a setter publishes, `render` rebuilds the view model, and only
   * the change-detection pass after that puts the new note in the DOM.
   * `ngAfterViewChecked` is the first moment it is there.
   */
  private pendingFocus: number | 'add' | null = null;

  /** The slot being edited, and its notes as the document holds them. */
  private slotId: string | null = null;
  private slotNotes: readonly RollNote[] = [];

  private move: MoveGesture | null = null;
  private resize: ResizeGesture | null = null;
  private velocity: VelocityGesture | null = null;
  /** Torn-off document listeners, live only while a gesture is. */
  private unlisten: (() => void)[] = [];

  private readonly progression = inject(ProgressionService);
  private readonly renderer = inject(Renderer2);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    // Before the first render, and before the subscription below can trigger
    // one: `gridStep` and `minNoteLength` are `division` in other units, and
    // this is the only thing that writes them.
    this.applyDivision();

    this.progression
      .getState()
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.render(state);
        this.changes.markForCheck();
      });
  }

  /**
   * Puts the focus where the last edit left it, once the DOM has caught up.
   *
   * Deleting a note removes the element the focus was on, and `trackByIndex`
   * means the survivors shuffle down into the indices above it - so without
   * this, deleting the note under the focus either drops the focus to `<body>`
   * (there is no element at that index any more) or silently hands it to a
   * *different* note that has moved into the index. Both are the same WCAG
   * failure: the keyboard user's place in the editor is gone, and nothing said
   * so.
   */
  ngAfterViewChecked(): void {
    const target = this.pendingFocus;
    if (target === null) return;

    // Cleared before focusing rather than after: `focus()` is what puts the
    // element in view, which can scroll, and a scroll is not worth a second
    // pass through here looking at a request already served.
    this.pendingFocus = null;
    this.applyFocus(target);
  }

  ngOnDestroy(): void {
    // A gesture can outlive the component - navigating away mid-drag - and its
    // listeners are on the document rather than on anything Angular tears down.
    this.endGesture();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** A note's index is its identity; see `RollNoteView.index`. */
  trackByIndex(index: number): number {
    return index;
  }

  /** A row's pitch is its identity: the window slides, the pitches do not. */
  trackByMidi(_index: number, row: RollRow): number {
    return row.midi;
  }

  // -------------------------------------------------------------------------
  // The controls
  // -------------------------------------------------------------------------

  /**
   * Sets how finely the roll snaps.
   *
   * Refused rather than clamped outside the range, which is the model's rule for
   * a value with no meaningful nearest end - and a division finer than
   * `MAX_BEAT_DIVISION` has one: it names a grid the model cannot store a note
   * on. A `<select>` cannot produce one, so anything that reaches here is a
   * caller bug rather than a user's mistake. 0 is free timing and is a real
   * answer, not a missing one.
   */
  setDivision(value: string | number): void {
    const division = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(division) || division < 0 || division > MAX_BEAT_DIVISION) return;
    if (division === this.division) return;

    this.division = division;
    this.applyDivision();
    this.changes.markForCheck();
  }

  /**
   * Hands the slot back to the generator: every claim dropped, the chord
   * rebuilt.
   *
   * The unavailable case returns early here rather than being held off by
   * `[disabled]`, because the button stays focusable so that it can name its own
   * reason - see `RollView.resetReason`.
   */
  resetToChord(): void {
    if (!this.slotId || !this.canReset) return;
    this.progression.resetSlotToChord(this.slotId);
  }

  /**
   * Takes the focus once the relabel chip has been answered and removed, which
   * would otherwise drop it to `<body>` - the loss of place
   * `ngAfterViewChecked` guards against one gesture over. Reset to chord is the
   * neighbour, is always focusable now, and is the likeliest next thing after
   * *Keep as literal*.
   */
  focusAfterRelabel(): void {
    this.resetButton?.nativeElement.focus();
  }

  /**
   * Removes a note. A pitch-set edit, which is all it is - and a move of the
   * focus, when the focus was on the note being removed.
   *
   * The focus goes to whichever note takes the removed one's place, or to the
   * one before it when the last in the list went, or to the Add button when the
   * slot is left empty. It is moved **only** when it was inside the note being
   * deleted: a right-click deletes too, and a right-click on one note while
   * another is focused must not move the focus off the note the user is working
   * on.
   */
  deleteNote(note: RollNoteView, event?: Event): void {
    // A right-click deletes, so the browser's own menu must not also open.
    event?.preventDefault();
    if (!this.slotId) return;

    const held = this.holdsFocus(note.index);
    const remaining = this.slotNotes.filter((_note, index) => index !== note.index);
    this.progression.setSlotNotes(this.slotId, remaining);

    if (!held) return;
    this.pendingFocus = remaining.length === 0 ? 'add' : Math.min(note.index, remaining.length - 1);
  }

  /**
   * Writes a note where the grid was double-clicked.
   *
   * Both axes answer the same question - **which cell was clicked** - so both
   * floor into the cell the pointer is actually inside: `yToMidi` into its row
   * and `floorBeat` into its column. `snapBeat` is the drag's rule and it is the
   * wrong one here, which `floorBeat`'s docstring argues: rounding the beat while
   * flooring the pitch made a click past the middle of a cell create a note that
   * started to the right of the pointer and did not contain the point that asked
   * for it, on a grid where a cell is a quarter of a beat wide.
   */
  addNote(event: MouseEvent): void {
    const grid = this.gridElement?.nativeElement;
    if (!this.slotId || !grid) return;

    const rect = grid.getBoundingClientRect();
    const scale = this.gridScale();
    const beat = Math.max(
      0,
      floorBeat(xToBeat(event.clientX - rect.left, scale.pixelsPerBeat), this.division)
    );

    this.placeNewNote(yToMidi(event.clientY - rect.top, this.topMidi, scale.rowHeight), beat);
  }

  /**
   * Adds a note without a pointer, and puts the focus on it.
   *
   * **The keyboard path to creating one, and the roll had none.** Every other
   * edit here has had two paths from the start - a note can be moved, resized,
   * re-voiced, re-velocitied and deleted from the keyboard - but the only way to
   * *make* one was a double-click on a bare `<div>` that was not in the tab
   * order and answered no key. A keyboard user who deleted the last note of a
   * slot could not get one back except through Reset to chord, which throws
   * every other edit in the slot away with it. That is WCAG 2.1.1, and it
   * contradicted what this component's own help text says the arrow keys are.
   *
   * The note lands at beat 0 - the start of the slot, the one beat every slot
   * has - on the first free pitch at or above the middle of the window, so it
   * arrives somewhere visible and never underneath a note that is already there.
   * From there it is the arrow keys' to move, which is the point.
   */
  addNoteAtStart(): void {
    if (!this.slotId) return;

    const index = this.slotNotes.length;
    const midi = this.freePitchNear(this.topMidi - Math.floor(this.gridRows / 2), 0);
    if (this.placeNewNote(midi, 0)) this.pendingFocus = index;
  }

  /**
   * Adds one note to the slot, at a pitch and a beat the caller has decided.
   *
   * `placeNotes` rather than `setSlotNotes`, for the reason the class docstring
   * gives: adding a note says both where it sounds and when, so both claims are
   * the user's and both belong in one commit. The new note is **appended**,
   * which is what makes its index the old length - nothing between here and the
   * document reorders a slot's notes, and `mergeNotes` walks the two lists by
   * index for exactly that reason.
   */
  private placeNewNote(midi: number, beat: number): boolean {
    if (!this.slotId) return false;

    return this.progression.placeNotes(this.slotId, [
      ...this.slotNotes,
      { midi, startBeat: beat, lengthBeats: this.gridStep, velocity: DEFAULT_VELOCITY }
    ]);
  }

  /**
   * The first pitch at or above `midi` with nothing already on it at `beat`.
   *
   * A new note laid exactly on top of an old one is invisible, unreachable by a
   * pointer, and indistinguishable from the click having done nothing - the
   * velocity lane's bug in the grid. The search runs upward because a voicing
   * grows upward, and it terminates: a beat holds at most as many notes as the
   * slot does, so one of the `length + 1` pitches tried is free.
   */
  private freePitchNear(midi: number, beat: number): number {
    for (let pitch = midi; pitch < midi + this.slotNotes.length; pitch++) {
      const taken = this.slotNotes.some(note => note.midi === pitch && note.startBeat === beat);
      if (!taken) return pitch;
    }

    return midi + this.slotNotes.length;
  }

  // -------------------------------------------------------------------------
  // The keyboard path
  // -------------------------------------------------------------------------

  /**
   * The arrow keys, for someone not holding a mouse - and the one place the
   * roll's two drag axes come apart.
   *
   * A pointer drag moves a note in pitch and time at once, so it claims both.
   * Up and Down move only the pitch, so this claims only the pitches, which is
   * the narrower and more honest thing to say about the slot. `setSlotNotes` is
   * that claim.
   */
  nudgePitch(note: RollNoteView, semitones: number, event?: Event): void {
    // An arrow key on a focused control inside a scrolling grid scrolls it.
    event?.preventDefault();
    if (!this.slotId) return;

    this.progression.setSlotNotes(
      this.slotId,
      this.slotNotes.map((stored, index) =>
        index === note.index ? { ...stored, midi: stored.midi + semitones } : stored
      )
    );
  }

  /** Left and Right move the note in time alone, one grid cell at a time. */
  nudgeStart(note: RollNoteView, steps: number, event?: Event): void {
    event?.preventDefault();
    if (!this.slotId) return;

    this.progression.setNoteTiming(
      this.slotId,
      note.index,
      note.startBeat + steps * this.gridStep,
      note.lengthBeats
    );
  }

  /** The resize handle's arrow keys: the edge drag, from the keyboard. */
  nudgeLength(note: RollNoteView, steps: number, event?: Event): void {
    event?.preventDefault();
    if (!this.slotId) return;

    this.progression.setNoteTiming(
      this.slotId,
      note.index,
      note.startBeat,
      Math.max(this.minNoteLength, note.lengthBeats + steps * this.gridStep)
    );
  }

  /** The velocity control's arrow keys. `boundVelocity` clamps at both ends. */
  nudgeVelocity(note: RollNoteView, steps: number, event?: Event): void {
    event?.preventDefault();
    if (!this.slotId) return;

    this.progression.setNoteVelocity(
      this.slotId,
      note.index,
      note.velocity + steps * VELOCITY_NUDGE
    );
  }

  // -------------------------------------------------------------------------
  // The gestures: the adapters that measure
  // -------------------------------------------------------------------------

  /**
   * Pressing a note begins a drag, reading the grid's geometry as it is.
   *
   * Measured once rather than as the drag goes on, which is what makes the scale
   * a constant for the length of the gesture: the grid grows as a note is
   * dragged past its end, and a scale re-read mid-drag would change under the
   * pointer holding it.
   */
  startMove(note: RollNoteView, event: PointerEvent): void {
    // The primary button only. A right-click is a delete, not a drag.
    if (event.button !== 0) return;
    // Text selection and the browser's own drag would both fight the gesture...
    event.preventDefault();
    // ...which also suppresses the focus the press would have given the note,
    // and the arrow keys on it are the whole keyboard path to moving one.
    (event.currentTarget as HTMLElement | null)?.focus();

    const scale = this.gridScale();
    this.beginMove(note.index, event.clientX, event.clientY, scale.pixelsPerBeat, scale.rowHeight);
  }

  /** Pressing the right edge begins a resize, scaled by the same beat width. */
  startResize(note: RollNoteView, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.focus();

    this.beginResize(note.index, event.clientX, this.gridScale().pixelsPerBeat);
  }

  /**
   * Pressing a velocity bar begins a velocity drag, scaled by the lane's own
   * height: dragging from the floor of the lane to its ceiling is the whole MIDI
   * range, which is the correspondence the user can see.
   */
  startVelocity(note: RollNoteView, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.focus();

    this.beginVelocity(note.index, event.clientY, this.velocityScale());
  }

  // -------------------------------------------------------------------------
  // The gestures: the seam, and what each commits
  // -------------------------------------------------------------------------

  /**
   * Begins a drag from a geometry the caller supplies - the seam between the
   * gesture and the DOM, on the strip's precedent and for its reason: it is what
   * lets the behaviour be tested without pinning a row height or a beat width,
   * the layout detail `CLAUDE.md` rules out asserting.
   */
  beginMove(
    index: number,
    originX: number,
    originY: number,
    pixelsPerBeat: number,
    rowHeight: number
  ): void {
    const slotId = this.slotId;
    const note = this.slotNotes[index];
    if (!slotId || !note) return;

    this.endGesture();
    this.move = {
      slotId,
      index,
      originX,
      originY,
      startBeat: note.startBeat,
      startMidi: note.midi,
      notes: this.slotNotes,
      pixelsPerBeat,
      rowHeight,
      beat: note.startBeat,
      semitones: 0,
      committed: false
    };
    this.listen();
  }

  /** Begins a resize at a known scale - the seam above, for the second gesture. */
  beginResize(index: number, originX: number, pixelsPerBeat: number): void {
    const slotId = this.slotId;
    const note = this.slotNotes[index];
    if (!slotId || !note) return;

    this.endGesture();
    this.resize = {
      slotId,
      index,
      originX,
      startBeat: note.startBeat,
      startLength: note.lengthBeats,
      pixelsPerBeat,
      length: note.lengthBeats,
      committed: false
    };
    this.listen();
  }

  /** Begins a velocity drag at a known scale - the seam, for the third. */
  beginVelocity(index: number, originY: number, pixelsPerVelocity: number): void {
    const slotId = this.slotId;
    const note = this.slotNotes[index];
    if (!slotId || !note) return;

    this.endGesture();
    this.velocity = {
      slotId,
      index,
      originY,
      startVelocity: note.velocity,
      pixelsPerVelocity,
      velocity: note.velocity,
      committed: false
    };
    this.listen();
  }

  /**
   * Every gesture commits on each threshold the pointer crosses, and folds the
   * lot into one undo entry.
   *
   * The note has to *be* where it is being dragged to - that is what a roll is -
   * so there is nothing to defer to the release. `coalesce` is what makes that
   * affordable: the first commit of a gesture opens an entry and every later one
   * joins it, so a drag across six grid lines is one step back rather than six.
   * `committed` is the flag that says which, and it is the gesture's own
   * bookkeeping rather than a second copy of the note.
   *
   * **It is set from what the setter answered, not from the fact that it was
   * called.** A setter declines silently - a note that did not move and a claim
   * that was already made open no entry - and a gesture that recorded the call
   * as a commit anyway would send `coalesce: true` on its next one, which
   * `commit` honours on the run key alone; for `placeNotes` that key names only
   * the slot, so the step would fold into the entry the *previous* gesture left
   * on the stack and one undo would take back two drags. Once an entry is open
   * it stays open for the rest of the gesture, so the flag only ever goes one
   * way - which is why each line below is `||` rather than an assignment.
   *
   * Every write goes to the slot the gesture *started* on, which is the
   * gesture's own field. `Gesture` argues why it is not `this.slotId`.
   */
  onPointerMove(event: PointerEvent): void {
    const move = this.move;
    if (move) {
      const beat = heldSnap(
        move.startBeat + xToBeat(event.clientX - move.originX, move.pixelsPerBeat),
        this.division,
        move.beat,
        0
      );
      const semitones = heldRows(event.clientY - move.originY, move.rowHeight, move.semitones);
      if (beat === move.beat && semitones === move.semitones) return;

      move.beat = beat;
      move.semitones = semitones;
      const placed = this.progression.placeNotes(
        move.slotId,
        move.notes.map((note, index) =>
          index === move.index
            ? { ...note, startBeat: beat, midi: move.startMidi + semitones }
            : note
        ),
        // The drag defers recognition to its own end. A chord read on every
        // threshold the pointer crosses would relabel the card once per grid
        // line the note travels over, and the user is only passing through
        // those. `endGesture` is where the reading happens instead.
        { coalesce: move.committed, deferRecognition: true }
      );
      move.committed = move.committed || placed;
      return;
    }

    const resize = this.resize;
    if (resize) {
      const length = heldSnap(
        resize.startLength + xToBeat(event.clientX - resize.originX, resize.pixelsPerBeat),
        this.division,
        resize.length,
        this.minNoteLength
      );
      if (length === resize.length) return;

      resize.length = length;
      const timed = this.progression.setNoteTiming(
        resize.slotId,
        resize.index,
        resize.startBeat,
        length,
        { coalesce: resize.committed }
      );
      resize.committed = resize.committed || timed;
      return;
    }

    const velocity = this.velocity;
    if (!velocity) return;

    const next = draggedVelocity(
      velocity.startVelocity,
      velocity.originY - event.clientY,
      velocity.pixelsPerVelocity,
      velocity.velocity
    );
    if (next === velocity.velocity) return;

    velocity.velocity = next;
    const written = this.progression.setNoteVelocity(velocity.slotId, velocity.index, next, {
      coalesce: velocity.committed
    });
    velocity.committed = velocity.committed || written;
  }

  /** Releasing ends the gesture. Everything it meant is already committed. */
  onPointerUp(): void {
    this.endGesture();
  }

  /** A cancelled pointer - a browser gesture taking over - commits nothing more. */
  onPointerCancel(): void {
    this.endGesture();
  }

  // -------------------------------------------------------------------------
  // Gesture plumbing
  // -------------------------------------------------------------------------

  /**
   * Listens on the document for the rest of the gesture: a drag leaves the note
   * it started on. Released when the gesture ends, so a page nobody is dragging
   * runs no pointer handler at all - an always-attached `pointermove` handler
   * costs a change-detection pass per pixel of every mouse movement anywhere.
   *
   * It assigns rather than appends, and needs no guard against listening twice:
   * every caller runs `endGesture()` first, which unlistens and empties the list.
   */
  private listen(): void {
    this.unlisten = [
      this.renderer.listen('document', 'pointermove', (event: PointerEvent) =>
        this.onPointerMove(event)
      ),
      this.renderer.listen('document', 'pointerup', () => this.onPointerUp()),
      this.renderer.listen('document', 'pointercancel', () => this.onPointerCancel())
    ];
  }

  /**
   * Ends whatever gesture is under way, and reads a finished pitch drag back as
   * a chord.
   *
   * The one thing a gesture *does* defer to its end. Every threshold crossing
   * has already been committed - the note has to be where it is being dragged to
   * - but each of those passed `deferRecognition`, so the slot is still carrying
   * the label it had when the drag began. This is the moment the notes have
   * stopped moving, and `settlePitchGesture` folds the reading into the drag's
   * own undo entry so that one undo takes back the notes and the label together.
   *
   * **Only when the drag committed**, which is the discipline `onPointerMove`
   * argues and `ProgressionNoteEditor.writeNotes` states: the settle commits
   * under the drag's run key with `continues: true`, and a continuation of a run
   * that never opened folds into the entry the *previous* gesture left. So the
   * flag that gates it has to be the one set from what the setter answered.
   *
   * The other two gestures do not call it, and that is the M1 rule rather than
   * an omission: a resize is a timing edit and a velocity drag a dynamics one,
   * and neither may change what a slot is called however much it changes which
   * notes are sounding at the downbeat.
   *
   * The gesture is cleared *before* the settle rather than after. The commit
   * publishes synchronously and the subscription re-renders inside it, so
   * clearing first means nothing downstream can observe a gesture that is over,
   * and a re-entrant call - a destroy triggered by that render - finds nothing
   * left to settle rather than settling twice.
   */
  private endGesture(): void {
    const move = this.move;
    this.move = null;
    this.resize = null;
    this.velocity = null;

    if (move?.committed) this.progression.settlePitchGesture(move.slotId, move.notes);

    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  /**
   * How many pixels one beat and one semitone occupy, measured off the grid.
   *
   * Both divisors are the counts the grid is laid out from, so this cannot drift
   * from what the browser drew: the grid is exactly `totalBeats` beats wide and
   * `gridRows` rows tall by construction. A grid that is not on screen yet gives
   * 0, which every geometry function declines rather than dividing by - see
   * their guards, and `draggedBeats` for the reasoning behind declining.
   */
  private gridScale(): { pixelsPerBeat: number; rowHeight: number } {
    const grid = this.gridElement?.nativeElement;
    if (!grid) return { pixelsPerBeat: 0, rowHeight: 0 };

    const rect = grid.getBoundingClientRect();
    return {
      pixelsPerBeat: this.totalBeats > 0 ? rect.width / this.totalBeats : 0,
      rowHeight: this.gridRows > 0 ? rect.height / this.gridRows : 0
    };
  }

  /** How many pixels one MIDI velocity unit is worth, measured off the lane. */
  private velocityScale(): number {
    const lane = this.laneElement?.nativeElement;
    if (!lane) return 0;
    return lane.getBoundingClientRect().height / VELOCITY_SPAN;
  }

  // -------------------------------------------------------------------------
  // The focus
  // -------------------------------------------------------------------------

  /**
   * Whether the focus is inside the note at this index.
   *
   * The whole `.note` element rather than its body, because the resize handle is
   * the note's other focusable child and deleting the note out from under it is
   * the same loss. The velocity bars are elsewhere in the DOM and are left out
   * on purpose: no key on one deletes anything, so a bar cannot be the thing
   * that asked.
   */
  private holdsFocus(index: number): boolean {
    const note = this.noteBodies?.get(index)?.nativeElement.parentElement;
    return note != null && note.contains(document.activeElement);
  }

  /**
   * Puts the focus on a note, or on the Add button.
   *
   * The button is the fallback rather than a second branch: an index that no
   * longer names a note is the case where there is nothing left to focus, and
   * the button is then both the only control that can undo that and the one
   * thing a keyboard user needs next.
   */
  private applyFocus(target: number | 'add'): void {
    const body = target === 'add' ? undefined : this.noteBodies?.get(target)?.nativeElement;
    (body ?? this.addButton?.nativeElement)?.focus();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Rebuilds everything on screen from one published state.
   *
   * One call and nothing else - `buildRollView` takes a published document and
   * answers with a view model, which is what keeps "what the roll draws" a pure
   * function of what the service published. The spelling used to be handed over
   * as a function beside it; it now comes from the key and scale the state
   * already carries. The strip's `render` is the same two lines for the same
   * reason.
   */
  private render(state: ProgressionState): void {
    const view = buildRollView(state);

    this.slotId = view.slotId;
    this.slotNotes = view.slotNotes;
    this.hasSlot = view.slotId !== null;
    this.canReset = view.canReset;
    this.resetReason = view.resetReason;
    this.positionText = view.positionText;
    this.topMidi = view.topMidi;
    this.gridRows = view.gridRows;
    this.totalBeats = view.totalBeats;
    this.rows = view.rows;
    this.notes = view.notes;
  }

  /** The three numbers the division decides, kept together so they cannot drift. */
  private applyDivision(): void {
    this.gridStep = this.division > 0 ? 1 / this.division : 1;
    this.minNoteLength = this.division > 0 ? 1 / this.division : MIN_NOTE_BEATS;
    // CSS cannot divide by zero, and free timing still wants the beat lines.
    this.gridDivision = this.division > 0 ? this.division : 1;
  }
}
