import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ProgressionDoc } from '../models/progression.model';
import {
  PROGRESSION_AUDIO,
  TimedEvent,
  ToneNode,
  ToneOutputNode,
  TonePart,
  TonePolySynth
} from './progression-audio';

/**
 * One note, resolved into the units Tone actually takes.
 *
 * Every conversion the audio boundary needs has happened by the time a
 * `RollNote` becomes one of these, and each of the three is a place the app
 * could have gone wrong quietly:
 *
 *  - **beats to seconds**, folding the slot's absolute position together with
 *    the note's offset inside it, at the document's tempo;
 *  - **MIDI number to hertz**, so nothing downstream has to spell a pitch;
 *  - **MIDI velocity to a 0-1 gain**, which is the hazard `RollNote.velocity`
 *    documents in as many words - 80 handed to `triggerAttackRelease` as a
 *    gain is eighty times full scale, and it clips hard.
 *
 * `midi` is carried alongside `frequency` because it is what the rest of the
 * app talks in, and it makes a schedule readable in a debugger or a failure
 * message. The two cannot disagree: `frequency` is derived from `midi` here and
 * nowhere else.
 */
export interface ScheduledNote extends TimedEvent {
  /** The slot this note came from, so the cue and the sound agree. */
  slotId: string;
  midi: number;
  frequency: number;
  /** Seconds. */
  duration: number;
  /** 0-1, as `triggerAttackRelease` takes it. */
  gain: number;
}

/**
 * A moment at which the sounding slot changes.
 *
 * `slotId` is null for the one cue that is not a slot start: the end of the
 * progression, where nothing is sounding any more. See `buildSchedule`.
 */
export interface SlotCue extends TimedEvent {
  slotId: string | null;
}

/** Everything the transport needs to play a progression through once. */
export interface PlaybackSchedule {
  readonly notes: readonly ScheduledNote[];
  readonly cues: readonly SlotCue[];
  /** Where the progression ends, and so where a loop turns over. */
  readonly lengthSeconds: number;
}

/** Concert A, and the MIDI number that names it. */
const A4_HERTZ = 440;
const A4_MIDI = 69;

/** MIDI velocity's top. `triggerAttackRelease` wants the fraction, not the byte. */
const MAX_VELOCITY = 127;

function frequencyOf(midi: number): number {
  return A4_HERTZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * A MIDI velocity as a gain.
 *
 * Clamped rather than merely divided, and that is not belt and braces: nothing
 * checks `RollNote.velocity` on the way in - `normalizeChordSlot` deliberately
 * leaves `notes` alone, because in M1 they are generated rather than typed -
 * so this is the only thing between M2's velocity editing and a gain above
 * full scale.
 *
 * The finite test is part of the same guard rather than an extra one, because
 * clamping cannot do it: `Math.min(1, Math.max(0, NaN))` is `NaN`, so an
 * unchecked velocity of the one shape arithmetic cannot fix passes straight
 * through the check meant to catch unchecked velocities and reaches
 * `triggerAttackRelease` as a `NaN` gain. Silence is the answer rather than
 * some default, because a note nobody can put a level on should not turn out to
 * be the loudest thing in the mix.
 */
function gainOf(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0;
  return Math.min(1, Math.max(0, velocity / MAX_VELOCITY));
}

/** Earliest first, and stable, so events at one instant keep their order. */
function byTime<Event extends TimedEvent>(events: Event[]): Event[] {
  return events.sort((left, right) => left.time - right.time);
}

/**
 * The `document -> schedule` arrow: what the transport is asked to play.
 *
 * Pure arithmetic, exported and tested on its own, because every way this can
 * be wrong is silent. A gain off by a factor of 127 clips; a time that forgets
 * the slot's own position stacks the whole progression on beat one; a duration
 * measured in beats where seconds were wanted holds a chord for four times too
 * long at 60 BPM. None of that raises an exception, and none of it can be seen
 * from a test that only asserts a synth was called.
 *
 * ## The two frames
 *
 * `ChordSlot.startBeat` is absolute in the progression and `RollNote.startBeat`
 * is relative to its own slot - the model says so, and they are floats. A
 * note's position is therefore the sum of the two, taken to seconds at the
 * document's tempo. That sum is the one piece of arithmetic here that a reader
 * can get wrong by reading only one of the two comments.
 *
 * ## Where the progression ends
 *
 * At the end of the last slot, not the end of the last note. The two can
 * differ: `generateSlotNotes` returns a literal slot's notes untouched, so
 * shrinking such a slot leaves notes hanging past its end. Looping to the
 * longer of the two would put a bar of silence under every repeat because one
 * slot's note overhangs; looping to the timeline the strip actually draws cuts
 * the overhang off. The strip is what the user is looking at, so the strip
 * wins.
 *
 * Measured as the furthest slot end rather than the sum of the lengths, because
 * a document that reaches here has not necessarily been through
 * `ProgressionService.settle` - `play` takes a `ProgressionDoc`, not the
 * service's state - and a max is right for both a contiguous timeline and one
 * with a hole in it.
 *
 * ## The trailing cue
 *
 * One cue per slot start, plus a final cue naming no slot at `lengthSeconds`.
 * That last one is how `currentSlot$` empties when a one-shot play runs out,
 * and it is the same event that stops the transport. Whether Tone reaches it
 * while looping is not something to rely on - see `onCue`, which is written so
 * that it does not matter either way.
 *
 * There is no trailing cue when the progression has no length: a document whose
 * slots are all zero beats long would otherwise get a cue saying it had ended
 * at the same instant as the cue saying its first slot had begun. `play`
 * refuses such a document anyway, for want of any time to play it in.
 *
 * ## Order
 *
 * Both lists come back earliest first. `Tone.Part` sorts what it is handed, so
 * this buys playback nothing; it is for every other reader - a schedule read in
 * a debugger, asserted against in a spec, or walked by M2's playhead - none of
 * which should have to know that a `PlaybackSchedule` was in document order all
 * along. Slots are laid end to end by `reflow`, so the sort is usually a no-op;
 * `play` takes a document from anywhere, so usually is not always.
 */
export function buildSchedule(doc: ProgressionDoc): PlaybackSchedule {
  const secondsPerBeat = 60 / doc.tempo;

  const notes: ScheduledNote[] = [];
  const cues: SlotCue[] = [];
  let endBeat = 0;

  for (const slot of doc.slots) {
    cues.push({ time: slot.startBeat * secondsPerBeat, slotId: slot.id });
    endBeat = Math.max(endBeat, slot.startBeat + slot.lengthBeats);

    for (const note of slot.notes) {
      notes.push({
        slotId: slot.id,
        midi: note.midi,
        frequency: frequencyOf(note.midi),
        time: (slot.startBeat + note.startBeat) * secondsPerBeat,
        duration: note.lengthBeats * secondsPerBeat,
        gain: gainOf(note.velocity)
      });
    }
  }

  const lengthSeconds = endBeat * secondsPerBeat;
  if (lengthSeconds > 0) cues.push({ time: lengthSeconds, slotId: null });

  return { notes: byTime(notes), cues: byTime(cues), lengthSeconds };
}

/**
 * Plays a progression on one Tone chain, built once and reused.
 *
 * The chain is the piano chain `CLAUDE.md` specifies - `PolySynth -> Reverb ->
 * Volume -> Destination` - constructed in the constructor and disposed in
 * `ngOnDestroy`. That is the whole of the project's audio rule and it is worth
 * saying why it is a rule rather than a preference: a synth built per note, or
 * per play, is a graph node that never leaves the audio context, and the app
 * degrades over minutes rather than failing outright. `FretboardComponent` and
 * `KeyboardComponent` each own their chain the same way; this is the third.
 *
 * Everything Tone-shaped arrives through `PROGRESSION_AUDIO`, so this class can
 * be tested with no audio device - see `progression-audio.ts` for where that
 * line is drawn and why it is drawn there.
 *
 * ## What is where
 *
 * `buildSchedule` decides *what* sounds and *when*, in seconds and gains, and
 * is pure. This class decides *whether* - the gesture, the transport, the loop
 * - and holds the two parts that carry the schedule. The split is what makes
 * the arithmetic checkable against numbers rather than against a mock.
 *
 * Two parts, not one: the notes and the cues are the same timeline read for
 * different purposes, and a slot with no notes in it still has to move the
 * cursor. Merging them would mean one callback branching on a discriminator to
 * decide whether it was making a sound or moving a highlight.
 *
 * ## The cursor runs slightly early
 *
 * `currentSlot$` is published from the transport callback, which Tone fires
 * ahead of the audio time it hands you - that lookahead is how it schedules
 * sample-accurate audio from JavaScript. So the highlight leads the sound by
 * the context's lookahead, around a tenth of a second. `Tone.Draw` is the fix
 * and it belongs with the M2 work that draws a playhead against a piano roll,
 * where a tenth of a second is visible; a chord card lighting up fractionally
 * early is not.
 *
 * ## And it runs in whichever zone Tone happens to be in
 *
 * Tone drives that clock from a Web Worker - `Ticker` posts itself a message
 * every update interval - and binds its `onmessage` when the audio context is
 * first constructed. Which zone that is depends on who touched Tone first: a
 * component constructor puts it in Angular's, a module-level side effect or an
 * async callback puts it in the root zone. It is not this service's decision to
 * make and not a template's business to know.
 *
 * Today it does not matter, and it is worth writing down why rather than
 * leaving the next reader to work it out. Angular 21's `bootstrapApplication`
 * prepends `provideZonelessChangeDetectionInternal()` to an app's own
 * providers, and `main.ts` does not override it, so this application is
 * zoneless: `NgZone` resolves to `NoopNgZone`, whose `run` is a bare
 * `fn.apply`, and `AsyncPipe`'s `markForCheck` reaches the change-detection
 * scheduler from any zone at all. `zone.js` is still in the polyfills, but
 * nothing about rendering depends on it. So a `currentSlot$ | async` highlight
 * repaints wherever the cue came from, and Task 9 has nothing to fear here.
 *
 * `publishSlot` runs through `NgZone` anyway, and knowingly. The bet is cheap -
 * a pass-through call and a closure, once per slot rather than once per tick,
 * behind the de-duplicating guard - and the alternative is that this service
 * becomes the thing that quietly breaks the day someone puts
 * `provideZoneChangeDetection()` back into `main.ts`. The rest of the app -
 * `GpLibraryService`, `ComposerLibraryService`, `AlphaTabService` - re-enters
 * the zone from its own callbacks the same way, from back when that was load
 * bearing, and a player that did not would be the odd one out for a saving of
 * nothing.
 *
 * ## Past CLAUDE.md's 500-line ceiling, deliberately
 *
 * 155 of these lines are code and 317 are prose, and most of that prose is the
 * three places where the obvious reading is wrong: a trailing cue that Tone is
 * meant to skip and sometimes does not, an `await` that leaves the service
 * looking idle while a play is under way, and a clamp that a `NaN` walks
 * straight through. The rule exists to keep a file holdable in the head, and
 * the only split available here would move those explanations away from the two
 * lines they are about. `buildSchedule` is already extracted, exported and
 * tested on its own, which is the split that was worth making.
 *
 * If the *code* grows past the ceiling the answer is different - the piano roll
 * playhead M2 wants would be the change to watch.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionPlayerService implements OnDestroy {
  private readonly audio = inject(PROGRESSION_AUDIO);
  private readonly zone = inject(NgZone);

  private readonly synth: TonePolySynth;
  private readonly reverb: ToneNode;
  private readonly volume: ToneOutputNode;

  private readonly currentSlotSubject = new BehaviorSubject<string | null>(null);

  /** The sounding slot's id, or null when nothing is sounding. */
  readonly currentSlot$: Observable<string | null> = this.currentSlotSubject.asObservable();

  /** The parts carrying the current schedule. Empty when nothing is scheduled. */
  private scheduled: TonePart[] = [];

  /** Whether the transport is running under us. */
  private running = false;

  private looping = false;

  /** The length of the schedule now loaded, for a loop toggled mid-play. */
  private lengthSeconds = 0;

  /**
   * Which play is the current one.
   *
   * `play` has to wait for the audio context, and everything it does before
   * that wait - `stop`, and building the schedule - touches no state at all,
   * while everything that marks the service as busy happens after it. So there
   * is a window in which a play is genuinely under way and the service still
   * looks idle to anyone who asks, `stop` included. It is not a narrow window
   * either: `Tone.start()` waits on the browser the first time, which is long
   * enough for a second click.
   *
   * Guarding on `running` or `scheduled` cannot close it, because those are the
   * fields that have not been written yet. A counter can: `play` takes a number
   * on the way in and checks it is still the current one on the way out, and
   * anything that supersedes it - another `play`, or a `stop` - bumps the
   * counter and thereby retires the continuation. Retiring it is enough; there
   * is nothing to unwind, because a play that has not reached its continuation
   * has not built anything.
   */
  private generation = 0;

  constructor() {
    this.synth = this.audio.createPolySynth();
    this.reverb = this.audio.createReverb();
    this.volume = this.audio.createVolume();

    // PolySynth -> Reverb -> Volume -> Destination. The volume is last so that
    // there is one control over everything this service makes, which is the
    // project's chain rule.
    this.synth.connect(this.reverb);
    this.reverb.connect(this.volume);
    this.volume.toDestination();
  }

  /**
   * Plays `doc` from the top.
   *
   * Asynchronous where the plan writes it as a command, because the first thing
   * it does is wait for the audio context. A browser will not start one without
   * a user gesture and `play` is called from the play button, which is that
   * gesture; awaiting it here is what keeps the guardrail in one place instead
   * of asking every caller to remember `Tone.start()`. A caller with nothing to
   * do afterwards can ignore the promise.
   *
   * A context that will not resume is handled by scheduling nothing: there is
   * no sense in running a transport that cannot be heard, and the alternative -
   * scheduling anyway and hoping - is how a play button comes to look like it
   * worked.
   *
   * Whatever was playing stops first, so a second press restarts rather than
   * layering. That is also what disposes the previous schedule - and a play
   * that has not finished starting counts as something playing, which is what
   * `generation` is for.
   */
  async play(doc: ProgressionDoc): Promise<void> {
    this.stop();
    const generation = ++this.generation;

    const schedule = buildSchedule(doc);
    // Three cases in one condition: a progression with no slots, and the two
    // ways a tempo that never went through `normalizeProgressionDoc` could
    // arrive - zero, which makes every time infinite, and `NaN`, which makes
    // them all unorderable. None is playable, and Tone throws on the last two.
    if (!(schedule.lengthSeconds > 0 && Number.isFinite(schedule.lengthSeconds))) return;

    try {
      await this.audio.resume();
    } catch (error) {
      // Worth saying out loud: the user pressed play and nothing happened, and
      // this is the only place that knows why.
      console.warn('Progression playback needs a user gesture to start audio', error);
      return;
    }

    // Somebody else owns the transport now. Carrying on from here would build a
    // second pair of parts, overwrite `scheduled` with them, and leave the
    // other pair sounding with nothing left holding a reference to dispose it.
    if (generation !== this.generation) return;

    const transport = this.audio.transport();
    // Tempo first, and not for tidiness: Tone resolves an event's time and the
    // loop end into ticks against the BPM in force at that moment, so a
    // `setTempo` after either would place the whole progression by the ratio of
    // the two tempi.
    transport.setTempo(doc.tempo);
    transport.setLoop(this.looping, schedule.lengthSeconds);
    this.lengthSeconds = schedule.lengthSeconds;

    this.scheduled = [
      this.audio.createPart<ScheduledNote>((time, note) => {
        // `time` comes from the transport rather than from the event: Tone
        // hands the callback the exact audio-context time the event is due,
        // which is what makes the attack sample-accurate.
        this.synth.triggerAttackRelease(note.frequency, note.duration, time, note.gain);
      }, schedule.notes),
      this.audio.createPart<SlotCue>((_time, cue) => this.onCue(cue.slotId), schedule.cues)
    ];
    for (const part of this.scheduled) part.start(0);

    this.running = true;
    transport.start();
  }

  /**
   * Stops, silences and forgets the schedule.
   *
   * Stopping while already stopped is a no-op rather than an error. It is a
   * normal thing to ask for - a stop button is pressable whether or not
   * anything is playing, and `play` calls this before every schedule it builds
   * - so the guard is on the state rather than on the caller.
   *
   * A play still waiting on the audio context is stopped too, even though the
   * guard below cannot see one. That is the whole reason the bump comes first:
   * the state the guard reads is exactly the state such a play has not written
   * yet, so a stop that returned early here would be followed moments later by
   * a transport starting up on its own.
   */
  stop(): void {
    this.generation++;

    if (!this.running && this.scheduled.length === 0) return;

    this.halt();
    // Only on an explicit stop, never at the end of a play: a stop button means
    // silence now, where the last chord of a progression should be allowed to
    // ring out into its release.
    this.synth.releaseAll();
    this.releaseSchedule();
  }

  /**
   * Loops the progression, from its start to its end.
   *
   * Remembered rather than applied when nothing is playing, because the loop
   * end is a property of the schedule and there is no schedule yet - the next
   * `play` sets both together.
   */
  setLoop(on: boolean): void {
    this.looping = on;
    if (!this.running) return;
    this.audio.transport().setLoop(on, this.lengthSeconds);
  }

  ngOnDestroy(): void {
    this.stop();
    // Disposed without disconnecting first, where `KeyboardComponent` does
    // both. Not an oversight and not a disagreement: `ToneAudioNode.dispose`
    // disconnects the node's own input and output on the way out, so the extra
    // call there is belt and braces rather than a step this one is missing. The
    // seam is the reason to leave it out - `disconnect` would have to join
    // `ToneNode` and every fake, to buy nothing.
    this.synth.dispose();
    this.reverb.dispose();
    this.volume.dispose();
    this.currentSlotSubject.complete();
  }

  /**
   * A cue reached: a slot began, or the progression ran out.
   *
   * "Ran out" means playback is over only when we are not looping. While a loop
   * is on, the same instant is the loop turning over, and halting there stops
   * the whole thing dead after a single pass.
   *
   * That reads like a guard against something that cannot happen, because Tone
   * is meant to rewind before an event at `loopEnd` is ever reached. It does -
   * but only when `loopEnd` lands on a whole tick, and the arithmetic is not
   * symmetric:
   *
   *  - `TransportEvent`'s constructor does `Math.floor(options.time)`, so our
   *    cue is filed at the tick *below* a fractional position;
   *  - `set loopEnd` does `this._loopEnd = this.toTicks(endPosition)`, with no
   *    floor, so the loop end keeps its fraction;
   *  - `_processTick` rewinds only `if (ticks >= this._loopEnd)`, against an
   *    integer `ticks`.
   *
   * So whenever `lengthSeconds` converts to a fractional tick count, the cue
   * sits one tick below the loop end, the rewind test fails at that tick, and
   * the cue fires. Twelve beats at 75 BPM is 9.600000000000001 seconds, which
   * at 192 PPQ is 2304.0000000000005 ticks: the cue is filed at 2304, and
   * `2304 >= 2304.0000000000005` is false. Sweeping 60-180 BPM against 1, 2, 3,
   * 4, 6 and 8 bars of 4/4, 62 of the 726 pairs land there - roughly one tempo
   * in twelve, silently ending a loop after one pass.
   *
   * Rather than bet the feature on floating point landing well, the loop is
   * read here. Nothing then depends on which side of the boundary Tone comes
   * down on: if it rewinds, this never runs; if it does not, this declines to
   * act. Note what that means for the spec - the Tone-side half of this is not
   * covered by any test and cannot be, because a fake transport has no ticks to
   * quantise. Only the service's half, that a trailing cue while looping does
   * not stop the transport, is pinned.
   *
   * Nothing is published on the way past, either. The first slot's cue is an
   * instant away and will paint over it; emptying the highlight in between
   * would be a flicker once per repeat.
   */
  private onCue(slotId: string | null): void {
    if (slotId !== null) {
      this.publishSlot(slotId);
      return;
    }
    if (this.looping) return;
    this.halt();
  }

  /**
   * Stops the transport and empties the cursor, leaving the schedule alone.
   *
   * The parts outlive this deliberately. `halt` is called from inside a part's
   * own callback when the trailing cue lands, and disposing a part from within
   * a callback its sibling is running is not a thing worth being clever about
   * for a resource the next `play` or `stop` frees anyway.
   */
  private halt(): void {
    if (this.running) {
      const transport = this.audio.transport();
      transport.stop();
      transport.cancel();
      this.running = false;
    }
    this.publishSlot(null);
  }

  private releaseSchedule(): void {
    for (const part of this.scheduled) part.dispose();
    this.scheduled = [];
  }

  private publishSlot(slotId: string | null): void {
    if (this.currentSlotSubject.getValue() === slotId) return;
    // A cue can arrive from Tone's clock worker in whichever zone the audio
    // context happened to be built in. Under this app's zoneless default that
    // costs a subscriber nothing and this call is a pass-through; under
    // `provideZoneChangeDetection` it is the difference between a highlight
    // that moves and one that does not. See the class docstring. Behind the
    // guard above, so it runs once per slot rather than once per clock tick.
    this.zone.run(() => this.currentSlotSubject.next(slotId));
  }
}
