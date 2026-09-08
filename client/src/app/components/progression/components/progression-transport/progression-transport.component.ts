import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  Renderer2,
  inject
} from '@angular/core';
import { Subject, combineLatest, takeUntil } from 'rxjs';

import {
  ProgressionState,
  TEMPO_MAX,
  TEMPO_MIN
} from '../../../../models/progression.model';
import { ProgressionPlayerService } from '../../../../services/progression-player.service';
import { ProgressionService } from '../../../../services/progression.service';

/** The readout when nothing is sounding. */
const STOPPED = 'Stopped';

/** ... and when something is, but the document cannot say which chord it is. */
const PLAYING = 'Playing';

/**
 * Play, stop, loop and tempo, above the strip they act on.
 *
 * ## It holds no state of its own
 *
 * Everything here is a cached rendering of two published sources - the
 * document's tempo and history from `ProgressionService`, and the sounding slot
 * from `ProgressionPlayerService` - rebuilt whenever either changes, exactly as
 * the palette's buttons and the strip's cards are. Nothing is written except by
 * `render`, and every control dispatches straight back to a service.
 *
 * That includes the two that look most like local flags:
 *
 *  - **`loopEnabled`** is the *player's* `isLooping`, read at init and after
 *    each toggle. `setLoop` lands on the player whoever calls it, so the
 *    player's own flag is the one value that cannot be stale; a toggle that
 *    remembered the setting itself would be a second copy to keep in step, and
 *    would show "off" against a player still looping the first time anything
 *    but this button set it.
 *  - **`isPlaying`** is `currentSlot$ !== null`, and derived rather than set on
 *    the way into `play()` on purpose. `play` is asynchronous and can fail -
 *    a browser that will not resume the audio context, or anything thrown
 *    behind it - and a flag set optimistically has to be unset again on every
 *    one of those paths. Read from the cue, the question answers itself: a play
 *    that never started publishes no cue, so there is no stuck state to clear.
 *
 * ## What it does with an empty progression
 *
 * Nothing, visibly. `ProgressionPlayerService.play` already returns early on a
 * document with no length in it, so a pressable play button over an empty strip
 * would be a control that does nothing with no explanation - the failure the
 * palette's greyed steppers exist to avoid. `canPlay` greys it instead, and the
 * sentence explaining it is the one the strip already prints under itself:
 * "Pick a chord from the palette to start a progression." Saying it twice on
 * one screen would be two sentences for one fact.
 *
 * ## When the tempo is committed
 *
 * On change - blur or Enter - and never per keystroke. `setTempo` commits, and
 * every commit is an undo step, so typing `90` over `120` per keystroke would
 * cost three of them and clamp the two on the way (`9`, then `90`) up to
 * `TEMPO_MIN`, writing `20` into the box under the user's cursor. The strip's
 * run-coalescing is the other answer to that problem and is not available here:
 * it is keyed on a run the caller names, and `setTempo` takes no run - which is
 * right, because a text box has no gesture end for a run to close on the way a
 * resize drag does. See `commitTempo` for the validation, which is the live
 * half of the guard `ProgressionService.commit` put behind it.
 *
 * ## Undo and redo live here
 *
 * Not because they are transport controls - they are not - but because this is
 * the page's only toolbar, and `canUndo` / `canRedo` ride on the state exactly
 * so that a control can grey itself out. The alternative was to ship M1 with
 * the undo stack that the service and the strip both lean on unreachable by
 * hand.
 *
 * The *keyboard* half of undo is deliberately not here. `Ctrl+Z` has to work
 * with the focus anywhere on the page, which means a document-level listener,
 * which belongs to the page shell that owns the page rather than to one of the
 * components sitting on it.
 *
 * ## It does not stop playback when it is destroyed
 *
 * The player owns the transport and disposes its own chain; this is a control,
 * and a control being torn down is not a stop. A route change that should
 * silence the progression is the page shell's call - it is already the thing
 * that has to restore the fretboard's own key when playback ends.
 * `ProgressionComponent.ngOnDestroy` took that call, and says why there.
 */
@Component({
  selector: 'app-progression-transport',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progression-transport.component.html',
  styleUrls: ['./progression-transport.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgressionTransportComponent implements OnInit, OnDestroy {
  /** Whether there is a progression to play at all. */
  canPlay = false;

  /** Whether a chord is sounding now. Derived from the player's cursor. */
  isPlaying = false;

  /** `Chord 2 of 4` while playing, and what it says instead when not. */
  positionText = STOPPED;

  /** The player's loop setting, cached for rendering. */
  loopEnabled = false;

  /** What the tempo box shows. The document's answer, not a second copy. */
  tempoText = '';

  canUndo = false;
  canRedo = false;

  /** The box's own bounds, taken from the model that enforces them. */
  readonly tempoMin = TEMPO_MIN;
  readonly tempoMax = TEMPO_MAX;

  /** The document tempo behind `tempoText`, for the comparison in `commitTempo`. */
  private tempo = 0;

  private readonly progression = inject(ProgressionService);
  private readonly player = inject(ProgressionPlayerService);
  private readonly renderer = inject(Renderer2);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loopEnabled = this.player.isLooping;

    // Combined rather than subscribed separately, because half of what is on
    // screen needs both: naming the sounding chord takes the cue *and* the
    // document it is a position in.
    combineLatest([this.progression.getState(), this.player.currentSlot$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([state, slotId]) => {
        this.render(state, slotId);
        this.changes.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // -------------------------------------------------------------------------
  // The controls
  // -------------------------------------------------------------------------

  /**
   * Plays the progression from the top.
   *
   * The document is read from the service at the moment of the press rather
   * than held in a field: `play` takes a whole `ProgressionDoc`, and a copy
   * kept here would be one more thing that can be stale by the time it is used.
   *
   * There is nothing to do when the promise resolves - what is playing is read
   * from `currentSlot$`. The rejection is the path that needs writing down: it
   * is caught so that a failure surfaces as a warning naming this page rather
   * than as an unhandled promise in the console, and the player is stopped so
   * that a play which threw halfway through starting does not leave a transport
   * running with a schedule nobody holds a reference to.
   */
  play(): void {
    if (!this.canPlay) return;

    this.player.play(this.progression.doc).catch((error: unknown) => {
      console.warn('The progression could not be played', error);
      this.player.stop();
    });
  }

  stop(): void {
    this.player.stop();
  }

  /** Loops, or stops looping. The player is the one that remembers which. */
  toggleLoop(): void {
    this.player.setLoop(!this.loopEnabled);
    this.loopEnabled = this.player.isLooping;
  }

  undo(): void {
    this.progression.undo();
  }

  redo(): void {
    this.progression.redo();
  }

  /**
   * The tempo box, committed.
   *
   * ## The validation, and why `Number.isFinite` alone is not it
   *
   * An emptied `<input type="number">` reads as `''`, and `Number('')` is 0 -
   * finite, and so accepted by the obvious guard, and then clamped by the
   * normalisation to `TEMPO_MIN`. The user cleared a box and the progression
   * dropped to 20 BPM. `valueAsNumber` reads the same box as `NaN` instead,
   * which `setTempo` rejects by *throwing* out of the normalisation -
   * `ProgressionService.commit` puts the history beyond reach of that throw,
   * but an error in the console every time someone selects-all and retypes is
   * still not a working box.
   *
   * So the empty string is turned back into `NaN` before the finite test, and
   * neither shape reaches the service. A browser hands the same `''` back for
   * anything else that is not a number, so this is one branch and not two.
   *
   * ## Why the value is written back rather than left to the binding
   *
   * `[value]` writes only when the *bound* value changes, and every case this
   * has to correct is a case where it has not. A refused edit leaves the
   * document saying 120 while the box on screen sits empty; a tempo already at
   * `TEMPO_MAX` asked for 500 comes back 300, which is what it already was; and
   * `120.0` is the same tempo as `120` written differently. In all three the
   * binding is satisfied and the box is wrong. Setting the element's value is
   * what `NumberValueAccessor.writeValue` does for the same reason, and through
   * the same `Renderer2`.
   */
  commitTempo(box: HTMLInputElement): void {
    const text = box.value.trim();
    const bpm = text === '' ? Number.NaN : Number(text);

    // Unchanged is a refusal too, and for the sharper of the two reasons: a
    // commit is an undo step, and tabbing out of a box nobody edited - or
    // asking a progression already at 300 for 500 - should not cost the user
    // one.
    //
    // The bounds are predicted here rather than owned: `setTempo` is still the
    // thing that clamps, and it is handed what the user actually typed. This is
    // only the question "would that change anything?", asked in the same two
    // constants the normalisation asks it in and the box declares as its own
    // min and max, so there is one set of bounds on the page rather than three.
    const bounded = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm));
    if (Number.isFinite(bpm) && bounded !== this.tempo) {
      this.progression.setTempo(bpm);
    }

    // `render` has already run, synchronously, if a commit went through.
    this.renderer.setProperty(box, 'value', this.tempoText);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Rebuilds everything on screen from one state and one cue. */
  private render(state: ProgressionState, slotId: string | null): void {
    // The same question `play` asks, in the terms the page can see it in: every
    // slot is at least `MIN_SLOT_BEATS` long and the tempo is bounded away from
    // zero, so a progression with a slot in it is a progression with a length.
    this.canPlay = state.doc.slots.length > 0;

    this.tempo = state.doc.tempo;
    this.tempoText = String(state.doc.tempo);

    this.canUndo = state.canUndo;
    this.canRedo = state.canRedo;

    this.isPlaying = slotId !== null;
    this.positionText = describePosition(state, slotId);
  }
}

/**
 * Where in the progression the sounding chord is.
 *
 * A cue can name a slot the document no longer has - remove the sounding chord
 * mid-play and the schedule, built from the document as it was, carries on
 * naming it - so there is a third answer between "stopped" and a position.
 *
 * ## The total is the document's and the position is the schedule's
 *
 * **A known limitation, characterised by spec rather than fixed.** Both numbers
 * are read from `state.doc`, which is the document as it is now, while the cue
 * they describe comes from a schedule built when play began. The removal above
 * is the half that was handled; a slot *added* mid-play is the half that was
 * not. Append two chords to a four-chord progression while it runs and this
 * reads "Chord 2 of 6" over a transport that will stop after the fourth.
 *
 * Counting the schedule instead would only move the lie: the strip beside this
 * readout draws six cards, so "of 4" would disagree with what the user can see.
 * The disagreement is not here. It is that `ProgressionPlayerService.play`
 * snapshots the document and nothing re-schedules under a running transport,
 * which is written up there along with the argument for leaving it until M2's
 * piano roll makes mid-play editing the normal case.
 */
function describePosition(state: ProgressionState, slotId: string | null): string {
  if (slotId === null) return STOPPED;

  const index = state.doc.slots.findIndex(slot => slot.id === slotId);
  if (index < 0) return PLAYING;

  return `Chord ${index + 1} of ${state.doc.slots.length}`;
}
