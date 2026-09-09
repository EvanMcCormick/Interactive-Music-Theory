import { InjectionToken } from '@angular/core';
import * as Tone from 'tone';
import type { InputNode } from 'tone';

/**
 * The whole of Tone as `ProgressionPlayerService` is allowed to see it.
 *
 * It exists so that the service can be tested at all. Karma runs headless with
 * no audio device, and importing Tone is not a neutral act - `import * as Tone`
 * builds the global `Context` on the way in, and every node the service would
 * construct hangs off it. A spec that drove the real library would be testing
 * Web Audio rather than the schedule, which is exactly what `CLAUDE.md` says
 * not to do: mock Tone, and test what was initialised.
 *
 * The line is drawn so that the *decisions* stay in the service and only the
 * *constructors* live behind it. The service still builds its own chain, orders
 * it, disposes it, decides what goes in a part and when the transport starts -
 * all of which a fake can watch. What is on this side is `new Tone.Reverb(...)`
 * and four one-line assignments onto the transport, which have nothing in them
 * for a test to catch.
 *
 * Two smaller consequences, both deliberate:
 *
 *  - **Times and gains are plain numbers.** Tone would take a `Time` string, a
 *    note name or a `Frequency`; the seam takes seconds, hertz and 0-1. That
 *    keeps the conversions in `buildSchedule`, where they are arithmetic and
 *    can be checked against numbers worked out by hand.
 *  - **`transport()` speaks in our terms, not Tone's.** `setTempo` and
 *    `setLoop` rather than the `bpm`, `loop`, `loopStart` and `loopEnd`
 *    properties behind them, so a fake transport is four fields rather than a
 *    reimplementation of `TransportClass`.
 */
export interface ToneApi {
  /**
   * Makes the audio context ready to sound, and resolves once it is.
   *
   * `Tone.start()` is the project guardrail - a browser will not start an audio
   * context without a user gesture, and the play button is that gesture. It
   * rejects when there has been none, which is the suspended-context case the
   * service has to survive rather than schedule into.
   */
  resume(): Promise<void>;
  transport(): ToneTransport;
  createPolySynth(): TonePolySynth;
  createReverb(): ToneNode;
  createVolume(): ToneOutputNode;
  /**
   * A `Tone.Part`: `events` replayed through `callback` against the transport's
   * clock. Each event carries its own time, in seconds from the start of the
   * progression.
   */
  createPart<Event extends TimedEvent>(
    callback: (time: number, event: Event) => void,
    events: readonly Event[]
  ): TonePart;
}

/** Anything a part can schedule: an object that knows when it happens. */
export interface TimedEvent {
  /** Seconds from the start of the progression. */
  time: number;
}

/**
 * A node in the audio chain.
 *
 * `connect` takes ours or Tone's own `InputNode`, because it is handed both: the
 * service passes one `ToneNode` to another, while at runtime those are real
 * Tone nodes being handed to a real `connect`. Naming both is what lets the
 * real classes satisfy this interface without a cast on either side.
 */
export interface ToneNode {
  connect(destination: ToneNode | InputNode): unknown;
  dispose(): unknown;
}

/** The last node in the chain - the one that reaches the speakers. */
export interface ToneOutputNode extends ToneNode {
  toDestination(): unknown;
}

export interface TonePolySynth extends ToneNode {
  /**
   * `frequency` in hertz, `duration` and `time` in seconds, and `velocity` as a
   * **0-1 gain** - not as a MIDI byte. See `RollNote.velocity`.
   */
  triggerAttackRelease(
    frequency: number,
    duration: number,
    time: number,
    velocity: number
  ): unknown;
  /** Releases every sounding voice. What a stop button means. */
  releaseAll(): unknown;
}

export interface TonePart {
  start(time: number): unknown;
  dispose(): unknown;
}

/**
 * The transport, which is global: there is one per audio context and Tone hands
 * out the same one to everybody. Nothing else in the app schedules on it today,
 * which is what makes `cancel()` - it clears the whole timeline, not just ours
 * - safe to call here.
 */
export interface ToneTransport {
  /** BPM. */
  setTempo(bpm: number): void;
  /** Loops from the start of the progression to `endSeconds` while `on`. */
  setLoop(on: boolean, endSeconds: number): void;
  /**
   * Calls `handler` each time the loop turns over. `null` stops listening.
   *
   * **The one thing on this side of the seam that is not a constructor, and the
   * reason it is here rather than being replaced by a scheduled event.** Tone
   * rewinds the transport inside `_processTick`, and it emits `loop` from
   * inside that rewind - after the position has been reset and *before* the
   * timeline events for the new position are collected. Two properties follow,
   * and the whole of `ProgressionPlayerService.update` rests on them:
   *
   *  - **It cannot land on the wrong side of the boundary.** An event filed at
   *    `lengthSeconds` can, and `onCue` documents at length how: Tone floors an
   *    event's ticks and does not floor `loopEnd`, so for 62 of the 726
   *    tempo-and-length pairs in 60-180 BPM the event sits one tick below the
   *    loop end and fires instead of the rewind happening. This is not a
   *    scheduled event. It *is* the rewind, so there is no rounding to be on
   *    the wrong side of.
   *  - **A schedule swapped in from the handler is reached by the pass that is
   *    starting.** `Timeline.forEachAtTime` iterates a `slice` of the timeline
   *    taken when it runs, so events added before it runs are invoked and
   *    events added during it are not. The handler runs before it; a cue
   *    callback runs during it. That is the difference between a note at beat
   *    one sounding on the next pass and being silently skipped for a whole
   *    cycle.
   *
   * The listener is held here rather than by the caller because `transport()`
   * hands out a fresh wrapper each call and `Emitter.off` matches on function
   * identity, so only this side can take off what it put on.
   */
  setLoopHandler(handler: (() => void) | null): void;
  start(): void;
  /** Stops, and rewinds to the top: Tone's `stop` resets the position. */
  stop(): void;
  /** Drops everything scheduled on the transport's timeline. */
  cancel(): void;
}

/**
 * The piano voice, matching `KeyboardComponent` note for note.
 *
 * The progression is a backing track under the instrument the user is looking
 * at, so it should sound like the app's piano rather than introduce a fourth
 * timbre. `DEFAULT_VELOCITY` was chosen against these same two - see its
 * docstring - so the balance between them is not accidental.
 */
const PIANO_VOICE = {
  oscillator: { type: 'sine' as const },
  envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 1.5 }
};

const PIANO_REVERB = { decay: 2.5, wet: 0.15 };

/**
 * Quieter than the keyboard's -6 dB, because a progression plays *under*
 * whatever the user is picking out on the fretboard rather than alongside it,
 * and it plays several notes at once where the fretboard plays one.
 */
const PROGRESSION_VOLUME_DB = -10;

/** The real thing: Tone, and nothing but the constructors. */
export function createToneApi(): ToneApi {
  /**
   * The listener currently on the transport's `loop` event, or null.
   *
   * Kept in this closure rather than in the wrapper `transport()` returns,
   * because that wrapper is built fresh on every call and `Emitter.off` removes
   * by function identity: a wrapper that held its own reference could never
   * take off a listener a previous wrapper had put on. One `ToneApi` is one
   * page's worth of audio, so one listener is the right number.
   */
  let loopListener: (() => void) | null = null;

  return {
    async resume(): Promise<void> {
      // Asking a running context to start again is harmless, but asking is
      // cheap and says out loud that the gesture is only needed once.
      if (Tone.getContext().state === 'running') return;
      await Tone.start();
    },
    transport(): ToneTransport {
      const transport = Tone.getTransport();
      return {
        setTempo: (bpm: number): void => {
          transport.bpm.value = bpm;
        },
        setLoop: (on: boolean, endSeconds: number): void => {
          transport.loopStart = 0;
          transport.loopEnd = endSeconds;
          transport.loop = on;
        },
        setLoopHandler: (handler: (() => void) | null): void => {
          if (loopListener) transport.off('loop', loopListener);
          loopListener = handler;
          if (handler) transport.on('loop', handler);
        },
        start: (): void => {
          transport.start();
        },
        stop: (): void => {
          transport.stop();
        },
        cancel: (): void => {
          transport.cancel();
        }
      };
    },
    createPolySynth: (): TonePolySynth => new Tone.PolySynth(Tone.Synth, PIANO_VOICE),
    createReverb: (): ToneNode => new Tone.Reverb(PIANO_REVERB),
    createVolume: (): ToneOutputNode => new Tone.Volume(PROGRESSION_VOLUME_DB),
    createPart: <Event extends TimedEvent>(
      callback: (time: number, event: Event) => void,
      events: readonly Event[]
    ): TonePart =>
      // Built as a part of the base event, then narrowed on the way back out.
      // `Tone.Part`'s own value type is a conditional over `{ time: Time }`,
      // which cannot be resolved against a type variable, so the alternative to
      // this cast is to stop the seam being generic at all - and then it is the
      // caller doing the narrowing instead, once per part. A part replays only
      // the events it was given, so the narrowing is sound wherever it sits.
      //
      // The array is copied, not handed over: `Tone.Part` keeps what it is
      // given, and a schedule is meant to be read rather than adopted.
      new Tone.Part<TimedEvent>(
        (time: number, event: TimedEvent) => callback(time, event as Event),
        [...events]
      )
  };
}

/**
 * How `ProgressionPlayerService` reaches Tone.
 *
 * Bound to `createToneApi` by `ProgressionComponent`, deliberately with no
 * default factory here - the same choice `NOTE_DETECTOR` makes, for the same
 * reason. Bound *there* rather than in `main.ts` because this module's
 * `import * as Tone` follows whichever file names the factory, and only a page
 * that is loaded lazily keeps it out of the eager bundle. It is true
 * that resolving this token on its own constructs nothing, but that is not the
 * failure a default would let through. The trap is a component spec that injects
 * something which injects the *player*, forgets the override because nothing
 * made it think about audio, and quietly builds a real `PolySynth`, `Reverb` and
 * convolution on the headless browser's global audio context - once per
 * `TestBed`, working perfectly and testing nothing.
 *
 * Without a default that spec fails at the injector, naming the token, before it
 * has a chance to be slow and misleading instead. The cost is one line on the
 * page component, paid once.
 */
export const PROGRESSION_AUDIO = new InjectionToken<ToneApi>('ProgressionAudio');
