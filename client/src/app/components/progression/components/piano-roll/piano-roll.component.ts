import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  Renderer2,
  ViewChild,
  inject
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import {
  DEFAULT_VELOCITY,
  MIN_NOTE_BEATS,
  VELOCITY_MAX,
  VELOCITY_MIN
} from '../../../../models/progression-normalize';
import { ProgressionState, RollNote } from '../../../../models/progression.model';
import { MusicTheoryService } from '../../../../services/music-theory.service';
import { ProgressionService } from '../../../../services/progression.service';
import { MAX_BEAT_DIVISION, snapBeat, xToBeat, yToMidi } from './piano-roll-geometry';
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
 * to the service and nothing here is written except by `render` - with two
 * exceptions, each marked as such: the three gesture records below, which exist
 * only between a pointer going down and coming up again, and `division`.
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
 *  - **A drag, and a double-click that adds a note, use `placeNotes`.** Both put
 *    a note *somewhere* - a pitch and a beat in one movement - so both claims
 *    are the user's and both are recorded in one commit. `setSlotNotes` claims
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
 * `ProgressionService.writeNotes` states the discipline; this is where it is
 * kept, in `beginMove`, `beginResize` and `beginVelocity`, each of which starts
 * its gesture uncommitted.
 */

/** How far past a boundary the pointer must go before the value follows it. */
const SNAP_HYSTERESIS = 0.15;

/** How much one press of a velocity arrow key is worth, in MIDI units. */
const VELOCITY_NUDGE = 5;

/** The grid the roll opens on: sixteenths, the default in every DAW there is. */
const DEFAULT_BEAT_DIVISION = 4;

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
interface MoveGesture {
  index: number;
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
  committed: boolean;
}

/** A note's right edge being dragged. Transient on the same terms. */
interface ResizeGesture {
  index: number;
  originX: number;
  startBeat: number;
  startLength: number;
  pixelsPerBeat: number;
  length: number;
  committed: boolean;
}

/** A velocity being dragged. Transient on the same terms. */
interface VelocityGesture {
  index: number;
  originY: number;
  startVelocity: number;
  pixelsPerVelocity: number;
  velocity: number;
  committed: boolean;
}

@Component({
  selector: 'app-piano-roll',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './piano-roll.component.html',
  styleUrls: ['./piano-roll.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PianoRollComponent implements OnInit, OnDestroy {
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

  /** The divisor the subdivision gradient uses; never 0, which CSS cannot divide by. */
  gridDivision = 1;

  /** The grid control's entries. */
  readonly divisions: readonly DivisionOption[] = buildDivisions();

  @ViewChild('grid') private gridElement?: ElementRef<HTMLElement>;
  @ViewChild('lane') private laneElement?: ElementRef<HTMLElement>;

  /** The slot being edited, and its notes as the document holds them. */
  private slotId: string | null = null;
  private slotNotes: readonly RollNote[] = [];

  private move: MoveGesture | null = null;
  private resize: ResizeGesture | null = null;
  private velocity: VelocityGesture | null = null;
  /** Torn-off document listeners, live only while a gesture is. */
  private unlisten: (() => void)[] = [];

  private readonly progression = inject(ProgressionService);
  private readonly musicTheory = inject(MusicTheoryService);
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

  /** Hands the slot back to the generator: every claim dropped, the chord rebuilt. */
  resetToChord(): void {
    if (!this.slotId) return;
    this.progression.resetSlotToChord(this.slotId);
  }

  /** Removes a note. A pitch-set edit, which is all it is. */
  deleteNote(note: RollNoteView, event?: Event): void {
    // A right-click deletes, so the browser's own menu must not also open.
    event?.preventDefault();
    if (!this.slotId) return;

    this.progression.setSlotNotes(
      this.slotId,
      this.slotNotes.filter((_note, index) => index !== note.index)
    );
  }

  /**
   * Writes a note where the grid was double-clicked.
   *
   * The beat is snapped by the same `snapBeat` a drag uses, so there is one rule
   * for where a note may sit rather than one for putting it there and another
   * for moving it. The pitch is `yToMidi`, which is a position rather than a
   * displacement and so floors into the row the pointer is actually over.
   */
  addNote(event: MouseEvent): void {
    const grid = this.gridElement?.nativeElement;
    if (!this.slotId || !grid) return;

    const rect = grid.getBoundingClientRect();
    const scale = this.gridScale();
    const beat = Math.max(
      0,
      snapBeat(xToBeat(event.clientX - rect.left, scale.pixelsPerBeat), this.division)
    );
    const midi = yToMidi(event.clientY - rect.top, this.topMidi, scale.rowHeight);

    this.progression.placeNotes(this.slotId, [
      ...this.slotNotes,
      { midi, startBeat: beat, lengthBeats: this.gridStep, velocity: DEFAULT_VELOCITY }
    ]);
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
    const note = this.slotNotes[index];
    if (!note) return;

    this.endGesture();
    this.move = {
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
    const note = this.slotNotes[index];
    if (!note) return;

    this.endGesture();
    this.resize = {
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
    const note = this.slotNotes[index];
    if (!note) return;

    this.endGesture();
    this.velocity = {
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
   */
  onPointerMove(event: PointerEvent): void {
    if (!this.slotId) return;

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
      this.progression.placeNotes(
        this.slotId,
        move.notes.map((note, index) =>
          index === move.index
            ? { ...note, startBeat: beat, midi: move.startMidi + semitones }
            : note
        ),
        { coalesce: move.committed }
      );
      move.committed = true;
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
      this.progression.setNoteTiming(this.slotId, resize.index, resize.startBeat, length, {
        coalesce: resize.committed
      });
      resize.committed = true;
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
    this.progression.setNoteVelocity(this.slotId, velocity.index, next, {
      coalesce: velocity.committed
    });
    velocity.committed = true;
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

  /** Ends whatever gesture is under way, committing nothing more. */
  private endGesture(): void {
    this.move = null;
    this.resize = null;
    this.velocity = null;

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
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Rebuilds everything on screen from one published state.
   *
   * One call, and the spelling handed over as a function rather than the service
   * that owns it - `buildRollView` takes a published document and answers with a
   * view model, which is what keeps "what the roll draws" a pure function of
   * what the service published. The strip's `render` is the same three lines for
   * the same reason.
   */
  private render(state: ProgressionState): void {
    const view = buildRollView(state, (pitchClass, preferSharps) =>
      this.musicTheory.spellNote(pitchClass, preferSharps)
    );

    this.slotId = view.slotId;
    this.slotNotes = view.slotNotes;
    this.hasSlot = view.slotId !== null;
    this.canReset = view.canReset;
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

// ---------------------------------------------------------------------------
// The gesture arithmetic
// ---------------------------------------------------------------------------

/**
 * A dragged position, snapped to the grid, with a dead zone on the boundary.
 *
 * `piano-roll-geometry.ts` argues at length that `snapBeat` stays a two-argument
 * quantiser and that the dead zone belongs to the gesture. This is that dead
 * zone, and the thing to keep right is the order: **the margin is applied to the
 * raw beat, before the snap**. Afterwards the position is already on a grid line
 * and there is nothing left to say how close to a boundary it was.
 *
 * Without it a pointer resting exactly between two lines and shaking by a pixel
 * crosses back and forth, and every crossing is a commit and a repaint. M1's
 * strip had the same bug and `draggedBeats` holds the same margin the same way;
 * this is that function with the grid step as a parameter and a floor the caller
 * names, because the roll snaps two axes and two edges rather than one length.
 *
 * `held` is what the gesture has already reached, so a single call with `held`
 * at the start reads exactly as it would with no hysteresis at all.
 */
function heldSnap(raw: number, division: number, held: number, floor: number): number {
  if (!Number.isFinite(raw)) return held;
  // No grid is free timing rather than an error, and free timing has no boundary
  // to rest on - the position is simply where the pointer is.
  if (!Number.isFinite(division) || division <= 0) return Math.max(floor, raw);

  const dead = (0.5 + SNAP_HYSTERESIS) / division;
  if (raw < held + dead && raw > held - dead) return held;

  return Math.max(floor, snapBeat(raw, division));
}

/**
 * How many semitones up a drag has travelled, with the same dead zone.
 *
 * Rounded rather than floored, and that is the difference between a displacement
 * and a position. `yToMidi` floors because it answers "which row is this pixel
 * in", and every pixel of a row has to give the same pitch; read as a
 * displacement the same floor would move a note a whole semitone for one pixel
 * of travel in one direction and none in the other. Half a row in either
 * direction is what a drag means, which is `Math.round`.
 *
 * A row height that is not a positive number means the grid could not be
 * measured, and dividing by it manufactures `Infinity` or `NaN` out of a
 * perfectly good pointer position. Declined rather than clamped, which reads as
 * "the drag did not move" - the same answer `draggedBeats` gives.
 */
function heldRows(deltaY: number, rowHeight: number, held: number): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return held;
  if (!Number.isFinite(deltaY)) return held;

  // Up the screen is up in pitch: the axis is inverted, which `midiToY` argues.
  const raw = -deltaY / rowHeight;
  const dead = 0.5 + SNAP_HYSTERESIS;
  if (raw < held + dead && raw > held - dead) return held;

  return Math.round(raw);
}

/**
 * The velocity a drag has reached: where it started, plus how far up the pointer
 * has travelled.
 *
 * Whole, because `RollNote.velocity` is a MIDI byte, and clamped into 1-127 here
 * as well as in `boundVelocity` - this is the last place the number is a value
 * the user is dragging to rather than one being stored, and a bar that flickered
 * past the top of its lane before the model refused it would be the strip's
 * `draggedBeats` floor problem again.
 */
function draggedVelocity(
  startVelocity: number,
  deltaUp: number,
  pixelsPerVelocity: number,
  held: number
): number {
  if (!Number.isFinite(pixelsPerVelocity) || pixelsPerVelocity <= 0) return held;
  if (!Number.isFinite(deltaUp)) return held;

  const raw = Math.round(startVelocity + deltaUp / pixelsPerVelocity);
  return Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, raw));
}
