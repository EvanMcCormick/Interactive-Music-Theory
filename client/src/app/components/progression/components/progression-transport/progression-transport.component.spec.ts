import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable } from 'rxjs';

import { ProgressionTransportComponent } from './progression-transport.component';
import { ProgressionDoc, ProgressionState } from '../../../../models/progression.model';
import { ProgressionPlayerService } from '../../../../services/progression-player.service';
import { ProgressionService } from '../../../../services/progression.service';

/**
 * What the transport dispatches, and what it says back.
 *
 * ## The player is faked, and the token is the reason it has to be
 *
 * `PROGRESSION_AUDIO` deliberately carries no default factory - see the token's
 * own docstring - so a spec that injected the real `ProgressionPlayerService`
 * would fail at the injector rather than quietly build a `PolySynth`, a
 * `Reverb` and a convolution on the headless browser's audio context. The
 * override below is what this file provides instead of that stub: the whole
 * player, replaced, so no Tone node is constructed at all and every dispatch is
 * a recorded call rather than a sound nobody can hear.
 *
 * ## Two DOM assertions, both about the tempo box
 *
 * `CLAUDE.md` rules out pinning structure, and the palette and strip specs each
 * make the same call. The tempo box is the exception for the same reason the
 * strip's card width is: what the box *shows* after a refused edit is the whole
 * claim. A component field that held `120` while the input on screen sat empty
 * would satisfy every expectation about the view model and lie to the user.
 * Everything else here calls the component's methods and reads the services
 * back, exactly as a click would.
 */
class FakePlayer {
  private readonly currentSlotSubject = new BehaviorSubject<string | null>(null);

  readonly currentSlot$: Observable<string | null> = this.currentSlotSubject.asObservable();

  /** The documents `play` was handed, in order. */
  readonly played: ProgressionDoc[] = [];

  readonly loops: boolean[] = [];

  stops = 0;

  /** The player's own loop flag, which the transport renders rather than owns. */
  isLooping = false;

  /** What the next `play` settles as. A rejection is a case the transport has. */
  playResult: Promise<void> = Promise.resolve();

  play(doc: ProgressionDoc): Promise<void> {
    this.played.push(doc);
    return this.playResult;
  }

  stop(): void {
    this.stops++;
  }

  setLoop(on: boolean): void {
    this.isLooping = on;
    this.loops.push(on);
  }

  /** Drives the cursor the way a Tone cue would. */
  cue(slotId: string | null): void {
    this.currentSlotSubject.next(slotId);
  }
}

describe('ProgressionTransportComponent', () => {
  let fixture: ComponentFixture<ProgressionTransportComponent>;
  let component: ProgressionTransportComponent;
  let progression: ProgressionService;
  let player: FakePlayer;

  /**
   * Builds the fixture. Separate from `beforeEach` because two tests need to
   * set the player up *before* the component reads it on init.
   */
  function create(): void {
    fixture = TestBed.createComponent(ProgressionTransportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    player = new FakePlayer();
    TestBed.configureTestingModule({
      imports: [ProgressionTransportComponent],
      providers: [{ provide: ProgressionPlayerService, useValue: player }]
    });
    progression = TestBed.inject(ProgressionService);
    create();
  });

  /** Re-runs change detection after a service change, as the real page does. */
  function settle(): void {
    fixture.detectChanges();
  }

  function currentState(): ProgressionState {
    let captured: ProgressionState | undefined;
    progression.getState().subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('getState published nothing on subscribe');
    return captured;
  }

  /** Appends chords on these degrees and renders, as clicking the palette would. */
  function build(...degrees: number[]): string[] {
    for (const degree of degrees) progression.appendSlot(degree);
    settle();
    return currentState().doc.slots.map(slot => slot.id);
  }

  function tempoBox(): HTMLInputElement {
    const box = fixture.nativeElement.querySelector('input[type="number"]');
    if (!box) throw new Error('the transport rendered no tempo box');
    return box as HTMLInputElement;
  }

  /** Types into the box and commits it, which is what blur and Enter both do. */
  function commitTempo(text: string): void {
    const box = tempoBox();
    box.value = text;
    box.dispatchEvent(new Event('change'));
    settle();
  }

  // -------------------------------------------------------------------------
  // Play and stop
  // -------------------------------------------------------------------------

  describe('play and stop', () => {
    it('plays the document the service is holding', () => {
      const ids = build(0, 4);

      component.play();

      expect(player.played.length).toBe(1);
      expect(player.played[0].slots.map(slot => slot.id)).toEqual(ids);
    });

    /**
     * The empty-progression answer, and it is a refusal rather than a silence.
     *
     * `ProgressionPlayerService.play` already returns early on a document with
     * no length in it, so a pressable play button would be a control that does
     * nothing with no explanation - which is the thing the palette's greyed
     * steppers exist to avoid. The strip next to it already says what to do.
     */
    it('has nothing to play until a chord is added', () => {
      expect(component.canPlay).toBeFalse();

      component.play();
      expect(player.played).toEqual([]);

      build(0);
      expect(component.canPlay).toBeTrue();
    });

    it('stops', () => {
      component.stop();

      expect(player.stops).toBe(1);
    });

    /**
     * `play` is a promise, and a rejected one must not leave the transport
     * looking like it is playing.
     *
     * It cannot, as it happens: what is playing is read from `currentSlot$`,
     * and a play that never started publishes no cue - which is the point of
     * deriving it rather than setting a flag on the way in. What this pins is
     * the other half: the rejection is caught, so it does not surface as an
     * unhandled promise, and the transport is stopped rather than left
     * half-started with a schedule nobody is going to release.
     */
    it('stops and stays stopped when a play fails', async () => {
      spyOn(console, 'warn');
      build(0);
      player.playResult = Promise.reject(new Error('no audio context'));

      component.play();
      await fixture.whenStable();
      settle();

      expect(component.isPlaying).toBeFalse();
      expect(component.positionText).toBe('Stopped');
      expect(player.stops).toBe(1);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // The cursor
  // -------------------------------------------------------------------------

  describe('what is sounding', () => {
    it('names the chord the player says is sounding', () => {
      const ids = build(0, 3, 4);

      player.cue(ids[1]);
      settle();

      expect(component.isPlaying).toBeTrue();
      expect(component.positionText).toBe('Chord 2 of 3');
    });

    it('goes back to stopped when the progression runs out', () => {
      const ids = build(0, 4);
      player.cue(ids[0]);
      settle();

      // The trailing cue: `buildSchedule` files one at the end of the last
      // slot, and it is what empties the cursor after a one-shot play.
      player.cue(null);
      settle();

      expect(component.isPlaying).toBeFalse();
      expect(component.positionText).toBe('Stopped');
    });

    /**
     * A cue for a slot the document no longer has - the removal case, which was
     * always handled and still has to be.
     *
     * The schedule catches up with the document at the loop boundary now, so a
     * chord removed mid-play does stop sounding: on the next pass. Until that
     * turnover the cue is still coming from a schedule that has it, and a
     * one-shot play never turns over at all - so the third answer between
     * "stopped" and a position stays reachable and stays needed.
     */
    it('says something is playing even when it cannot count the chord', () => {
      build(0);

      player.cue('a-slot-that-was-removed');
      settle();

      expect(component.isPlaying).toBeTrue();
      expect(component.positionText).toBe('Playing');
    });

    /**
     * The readout counts the document, and the document is what the player is
     * on its way to playing.
     *
     * M1 shipped this as a characterised bug: the total came from the document
     * and the position from a schedule built when play began, so two chords
     * appended mid-play read "Chord 2 of 6" over a transport that would stop
     * after the fourth. Nothing here changed to fix it - counting the schedule
     * instead would only have moved the lie, since the strip beside this
     * readout draws six cards either way. What changed is underneath:
     * `ProgressionComponent` hands each edit to the player and
     * `ProgressionPlayerService` swaps it in at the loop boundary, so the six
     * this counts are six chords that sound. See "edits at the loop boundary"
     * in the player's spec for the schedule end of it - a fake player cannot
     * show a turnover, and pretending otherwise here would be a component spec
     * asserting a service's behaviour.
     */
    it('counts every chord in the document, appended mid-play or not', () => {
      const ids = build(0, 3, 4, 5);
      player.cue(ids[1]);
      settle();
      expect(component.positionText).toBe('Chord 2 of 4');

      const appended = build(1, 2);

      expect(component.positionText).toBe('Chord 2 of 6');

      // And the appended chords are countable positions rather than only a
      // larger total: the fifth is where the fifth card is.
      player.cue(appended[4]);
      settle();

      expect(component.positionText).toBe('Chord 5 of 6');
    });

    it('stops listening to the player once it is destroyed', () => {
      const ids = build(0);
      fixture.destroy();

      player.cue(ids[0]);

      expect(component.isPlaying).toBeFalse();
      expect(component.positionText).toBe('Stopped');
    });
  });

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  describe('loop', () => {
    it('turns the loop on and off again', () => {
      component.toggleLoop();
      expect(player.loops).toEqual([true]);
      expect(component.loopEnabled).toBeTrue();

      component.toggleLoop();
      expect(player.loops).toEqual([true, false]);
      expect(component.loopEnabled).toBeFalse();
    });

    /**
     * The toggle renders the player's flag rather than remembering its own.
     *
     * `setLoop` lands on the player whoever calls it, so the player's flag is
     * the one that cannot be stale. Leaving the button to remember would put a
     * freshly built transport's "off" against a player that is still looping,
     * the first time anything but this button sets it.
     */
    it('opens showing the loop the player is already set to', () => {
      player.isLooping = true;

      create();

      expect(component.loopEnabled).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // Tempo
  // -------------------------------------------------------------------------

  describe('tempo', () => {
    it('opens on the document tempo', () => {
      expect(tempoBox().value).toBe('120');
    });

    it('sets the tempo when the box is committed', () => {
      commitTempo('90');

      expect(currentState().doc.tempo).toBe(90);
      expect(tempoBox().value).toBe('90');
    });

    /**
     * The hazard `ProgressionService.commit` anticipated, at the boundary where
     * it is actually met.
     *
     * An emptied `<input type="number">` reads as `''`, and `Number('')` is 0 -
     * which is finite, so a guard that only asked `Number.isFinite` would sail
     * through and clamp the tempo to 20 while the user was still typing.
     * `valueAsNumber` gives `NaN` instead, and `setTempo(NaN)` throws out of the
     * normalisation. `ProgressionService` orders `commit()` so that throw no
     * longer
     * corrupts the history, but a throw out of a `change` handler is still an
     * error in the console on a box the user merely cleared.
     *
     * So neither reaches the service: the box is put back to what the document
     * says, nothing is committed, and there is no undo step to walk back.
     */
    it('refuses an emptied box, and puts the tempo back', () => {
      expect(() => commitTempo('')).not.toThrow();

      expect(currentState().doc.tempo).toBe(120);
      expect(currentState().canUndo).toBeFalse();
      expect(tempoBox().value).toBe('120');
    });

    /**
     * The tempo is committed on change - blur, or Enter - and not per
     * keystroke, because `setTempo` commits and every commit is an undo step.
     * Typing `90` over `120` would otherwise cost three of them, and the two
     * on the way - `9`, then `90` - would each be clamped up to `TEMPO_MIN` and
     * written back into the box under the user's cursor.
     */
    it('does not commit while the box is being typed into', () => {
      const box = tempoBox();
      box.value = '9';
      box.dispatchEvent(new Event('input'));
      settle();

      expect(currentState().doc.tempo).toBe(120);
      expect(currentState().canUndo).toBeFalse();
    });

    it('shows the clamped tempo when the box asks for more than the maximum', () => {
      commitTempo('500');

      expect(currentState().doc.tempo).toBe(300);
      expect(tempoBox().value).toBe('300');
    });

    /**
     * The same clamp again, from a tempo that is already the maximum - which is
     * the case the `[value]` binding cannot fix on its own. 120 to 300 moves the
     * bound value and so writes itself; 300 to 300 does not, and without the
     * write-back the box would be left reading 500 over a progression at 300.
     */
    it('puts the box back when the clamp lands where the tempo already was', () => {
      commitTempo('300');
      expect(tempoBox().value).toBe('300');

      commitTempo('500');

      expect(currentState().doc.tempo).toBe(300);
      expect(tempoBox().value).toBe('300');
      // And it costs no undo step, which is the whole reason the bounds are
      // predicted before the comparison rather than left to the service: an
      // entry that restores 300 over 300 is a press of Undo that does nothing.
      progression.undo();
      expect(currentState().doc.tempo).toBe(120);
    });

    /**
     * The model clamps the tempo and does not round it, so a fractional BPM is
     * a value the document genuinely keeps. The box has to agree: `step="1"`
     * refused nothing, it only marked the input `:invalid` while displaying a
     * tempo that had been accepted and was sounding.
     */
    it('accepts a fractional tempo, as the document does', () => {
      commitTempo('250.7');

      expect(currentState().doc.tempo).toBe(250.7);
      expect(tempoBox().value).toBe('250.7');
      expect(tempoBox().checkValidity()).toBeTrue();
    });

    /** And the same for a tempo written differently rather than changed. */
    it('writes the tempo back in the document\'s own terms', () => {
      commitTempo('120.0');

      expect(currentState().doc.tempo).toBe(120);
      expect(currentState().canUndo).toBeFalse();
      expect(tempoBox().value).toBe('120');
    });

    it('records no undo step for a tempo committed unchanged', () => {
      commitTempo('120');

      expect(currentState().canUndo).toBeFalse();
    });

    /** An undo of a tempo change has to reach the box, not just the document. */
    it('follows the document when the tempo moves under it', () => {
      commitTempo('90');
      progression.undo();
      settle();

      expect(currentState().doc.tempo).toBe(120);
      expect(tempoBox().value).toBe('120');
    });
  });

  // -------------------------------------------------------------------------
  // Undo and redo
  // -------------------------------------------------------------------------

  describe('undo and redo', () => {
    it('has nothing to undo or redo on a fresh progression', () => {
      expect(component.canUndo).toBeFalse();
      expect(component.canRedo).toBeFalse();
    });

    it('walks the history the service keeps', () => {
      build(0);
      expect(component.canUndo).toBeTrue();

      component.undo();
      settle();

      expect(currentState().doc.slots).toEqual([]);
      expect(component.canRedo).toBeTrue();

      component.redo();
      settle();

      expect(currentState().doc.slots.length).toBe(1);
      expect(component.canRedo).toBeFalse();
    });
  });
});
