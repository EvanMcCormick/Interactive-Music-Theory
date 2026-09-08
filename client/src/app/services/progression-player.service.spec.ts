import { TestBed } from '@angular/core/testing';
import { ChordSlot, ProgressionDoc, RollNote } from '../models/progression.model';
import {
  PROGRESSION_AUDIO,
  TimedEvent,
  ToneApi,
  ToneNode,
  ToneOutputNode,
  TonePart,
  TonePolySynth,
  ToneTransport
} from './progression-audio';
import {
  ProgressionPlayerService,
  ScheduledNote,
  SlotCue,
  buildSchedule
} from './progression-player.service';

/**
 * The scheduler and the transport, tested without an audio device.
 *
 * Two halves, and the split is the point. `buildSchedule` is arithmetic - beats
 * to seconds, MIDI to hertz, a MIDI velocity to a gain - and is checked against
 * numbers worked out by hand. `ProgressionPlayerService` is the part that talks
 * to Tone, and it is checked against a fake that records what it was asked to
 * build. Neither half needs a running audio context, which is what lets the
 * whole file pass in a headless browser with no sound card in it.
 *
 * What is deliberately *not* asserted is that audio came out. `CLAUDE.md` says
 * to mock Tone and to test initialisation, and this is what that means here:
 * one chain built once, in the order the piano chain is specified; one event
 * per note at the right time with the right gain; and everything disposed on
 * teardown, because a leaked synth is the failure mode the project rules name
 * out loud.
 */

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeNode implements ToneNode {
  /** What this node was last connected onward to, or null. */
  connectedTo: unknown = null;
  disposals = 0;

  connect(destination: ToneNode): void {
    this.connectedTo = destination;
  }

  dispose(): void {
    this.disposals++;
  }
}

class FakeOutput extends FakeNode implements ToneOutputNode {
  /** How many times this node was pointed at the speakers. */
  destinations = 0;

  toDestination(): void {
    this.destinations++;
  }
}

interface TriggerCall {
  frequency: number;
  duration: number;
  time: number;
  velocity: number;
}

class FakeSynth extends FakeNode implements TonePolySynth {
  readonly triggered: TriggerCall[] = [];
  releases = 0;

  triggerAttackRelease(
    frequency: number,
    duration: number,
    time: number,
    velocity: number
  ): void {
    this.triggered.push({ frequency, duration, time, velocity });
  }

  releaseAll(): void {
    this.releases++;
  }
}

class FakePart implements TonePart {
  /** The transport time this part was started at, or null while unstarted. */
  started: number | null = null;
  disposals = 0;

  constructor(
    private readonly callback: (time: number, event: TimedEvent) => void,
    readonly events: readonly TimedEvent[]
  ) {}

  start(time: number): void {
    this.started = time;
  }

  dispose(): void {
    this.disposals++;
  }

  /** Runs the callback for one of the events, as the transport would. */
  fire(index: number): void {
    const event = this.events[index];
    this.callback(event.time, event);
  }
}

class FakeTransport implements ToneTransport {
  tempo: number | null = null;
  looping = false;
  loopEnd: number | null = null;
  starts = 0;
  stops = 0;
  cancels = 0;

  setTempo(bpm: number): void {
    this.tempo = bpm;
  }

  setLoop(on: boolean, endSeconds: number): void {
    this.looping = on;
    this.loopEnd = endSeconds;
  }

  start(): void {
    this.starts++;
  }

  stop(): void {
    this.stops++;
  }

  cancel(): void {
    this.cancels++;
  }
}

/**
 * Everything the service is allowed to know about Tone, recorded rather than
 * sounded.
 *
 * `resumeFails` is how a suspended context is played out: `Tone.start()`
 * rejects when the browser has had no user gesture, and the service has to
 * survive that without scheduling anything.
 */
class FakeToneApi implements ToneApi {
  readonly transportStub = new FakeTransport();
  readonly synths: FakeSynth[] = [];
  readonly reverbs: FakeNode[] = [];
  readonly volumes: FakeOutput[] = [];
  readonly parts: FakePart[] = [];

  resumeCalls = 0;
  resumeFails = false;
  /** Whether the transport had been started by the time `resume` was called. */
  startsBeforeResume = 0;

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.startsBeforeResume = this.transportStub.starts;
    if (this.resumeFails) throw new Error('no user gesture yet');
  }

  transport(): ToneTransport {
    return this.transportStub;
  }

  createPolySynth(): TonePolySynth {
    const synth = new FakeSynth();
    this.synths.push(synth);
    return synth;
  }

  createReverb(): ToneNode {
    const reverb = new FakeNode();
    this.reverbs.push(reverb);
    return reverb;
  }

  createVolume(): ToneOutputNode {
    const volume = new FakeOutput();
    this.volumes.push(volume);
    return volume;
  }

  createPart<Event extends TimedEvent>(
    callback: (time: number, event: Event) => void,
    events: readonly Event[]
  ): TonePart {
    // The one cast in the file. Every part goes into a single list so the spec
    // can walk them, and the events replayed through `fire` are the ones this
    // call was given - so the narrower callback can only ever be handed the
    // events it was written for.
    const part = new FakePart(callback as (time: number, event: TimedEvent) => void, events);
    this.parts.push(part);
    return part;
  }

  /** The one synth the service is allowed to build. */
  get synth(): FakeSynth {
    if (this.synths.length !== 1) {
      throw new Error(`expected exactly one synth, found ${this.synths.length}`);
    }
    return this.synths[0];
  }

  /** The parts still live - the ones a play built and nothing has disposed. */
  get livingParts(): FakePart[] {
    return this.parts.filter(part => part.disposals === 0);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function note(midi: number, startBeat: number, lengthBeats: number, velocity = 80): RollNote {
  return { midi, startBeat, lengthBeats, velocity };
}

function degreeSlot(
  id: string,
  startBeat: number,
  lengthBeats: number,
  notes: RollNote[]
): ChordSlot {
  return {
    id,
    harmony: {
      kind: 'degree',
      degree: {
        degree: 0,
        alter: 0,
        extent: 3,
        quality: 'major',
        inversion: 0,
        suspension: 'none',
        octave: 0
      }
    },
    startBeat,
    lengthBeats,
    notes,
    isHandEdited: false
  };
}

function literalSlot(
  id: string,
  startBeat: number,
  lengthBeats: number,
  notes: RollNote[]
): ChordSlot {
  return {
    id,
    harmony: { kind: 'literal', reason: 'unrecognised' },
    startBeat,
    lengthBeats,
    notes,
    isHandEdited: false
  };
}

function progression(slots: ChordSlot[], tempo = 120): ProgressionDoc {
  return {
    id: 'doc',
    name: 'Test',
    key: { tonic: 0, scaleId: 'ionian', preferSharps: true },
    tempo,
    timeSignature: { numerator: 4, denominator: 4, isCommon: true },
    slots
  };
}

/** Two bars at 120 BPM: a C triad, then a G triad. One beat is half a second. */
function twoChords(): ProgressionDoc {
  return progression([
    degreeSlot('a', 0, 4, [note(60, 0, 4), note(64, 0, 4), note(67, 0, 4)]),
    degreeSlot('b', 4, 4, [note(67, 0, 4), note(71, 0, 4), note(74, 0, 4)])
  ]);
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

describe('buildSchedule', () => {
  it('places a note at its slot start plus its own offset, in seconds', () => {
    // 120 BPM is half a second a beat. The slot begins on beat 4 - two seconds
    // in - and the note half a beat after that, so a quarter of a second later.
    const doc = progression([degreeSlot('a', 4, 4, [note(60, 0.5, 2)])]);

    const [scheduled] = buildSchedule(doc).notes;

    expect(scheduled.time).toBeCloseTo(2.25, 10);
    expect(scheduled.duration).toBeCloseTo(1, 10);
  });

  it('scales every time by the tempo', () => {
    // The same document at 60 BPM: a beat is a whole second, so every figure
    // above doubles. Tempo is the only thing that moved.
    const doc = progression([degreeSlot('a', 4, 4, [note(60, 0.5, 2)])], 60);

    const [scheduled] = buildSchedule(doc).notes;

    expect(scheduled.time).toBeCloseTo(4.5, 10);
    expect(scheduled.duration).toBeCloseTo(2, 10);
  });

  it('divides MIDI velocity into a 0-1 gain', () => {
    // The hazard `RollNote.velocity` documents: 80 is `mf` as a MIDI byte and
    // eighty times full scale as a gain. The conversion belongs here, at the
    // Tone boundary, and nowhere upstream of it.
    const doc = progression([degreeSlot('a', 0, 4, [note(60, 0, 4, 80), note(64, 0, 4, 127)])]);

    const gains = buildSchedule(doc).notes.map(scheduled => scheduled.gain);

    expect(gains[0]).toBeCloseTo(80 / 127, 10);
    expect(gains[1]).toBe(1);
    for (const gain of gains) expect(gain).toBeLessThanOrEqual(1);
  });

  it('converts MIDI numbers to hertz', () => {
    const doc = progression([degreeSlot('a', 0, 4, [note(69, 0, 4), note(60, 0, 4)])]);

    const [a4, middleC] = buildSchedule(doc).notes;

    expect(a4.frequency).toBeCloseTo(440, 9);
    expect(middleC.frequency).toBeCloseTo(261.6255653, 6);
  });

  it('schedules one event per note, across every slot, tagged with its slot', () => {
    const schedule = buildSchedule(twoChords());

    expect(schedule.notes.length).toBe(6);
    expect(schedule.notes.map(scheduled => scheduled.slotId)).toEqual([
      'a', 'a', 'a', 'b', 'b', 'b'
    ]);
    expect(schedule.notes.map(scheduled => scheduled.time)).toEqual([0, 0, 0, 2, 2, 2]);
  });

  it('cues each slot at its start, and clears the cue at the end', () => {
    const schedule = buildSchedule(twoChords());

    expect(schedule.cues).toEqual([
      { time: 0, slotId: 'a' },
      { time: 2, slotId: 'b' },
      { time: 4, slotId: null }
    ] as SlotCue[]);
    expect(schedule.lengthSeconds).toBe(4);
  });

  it('takes a literal slot\'s notes exactly as they are', () => {
    // A literal slot's notes are the playback truth - the model says so - and
    // that includes an offset and a length that do not fill the slot, and a
    // velocity nothing generated. Nothing here may tidy them up.
    const doc = progression([
      literalSlot('lit', 2, 4, [note(62, 1.5, 0.25, 40), note(65, 3, 1, 127)])
    ]);

    const schedule = buildSchedule(doc);

    expect(schedule.notes).toEqual([
      jasmine.objectContaining<ScheduledNote>({ slotId: 'lit', midi: 62, time: 1.75, duration: 0.125 }),
      jasmine.objectContaining<ScheduledNote>({ slotId: 'lit', midi: 65, time: 2.5, duration: 0.5 })
    ]);
    expect(schedule.notes[0].gain).toBeCloseTo(40 / 127, 10);
  });

  it('cues a slot that has no notes in it', () => {
    // Which is why the cues are a schedule of their own rather than something
    // read off the note events: a slot the user has emptied still holds the
    // timeline open, and the cursor still has to cross it.
    const doc = progression([degreeSlot('quiet', 0, 4, []), degreeSlot('b', 4, 4, [note(60, 0, 4)])]);

    const schedule = buildSchedule(doc);

    expect(schedule.notes.length).toBe(1);
    expect(schedule.cues.map(cue => cue.slotId)).toEqual(['quiet', 'b', null]);
  });

  it('gives an empty progression nothing to play', () => {
    const schedule = buildSchedule(progression([]));

    expect(schedule.notes).toEqual([]);
    expect(schedule.cues).toEqual([]);
    expect(schedule.lengthSeconds).toBe(0);
  });

  it('measures the progression to the end of its last slot', () => {
    // Not to the end of its last *note*: the loop turns over where the timeline
    // the strip draws ends, so a literal slot's note hanging past its own slot
    // is cut off rather than stretching the loop under everything else.
    const doc = progression([literalSlot('lit', 0, 2, [note(60, 0, 8)])]);

    expect(buildSchedule(doc).lengthSeconds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

describe('ProgressionPlayerService', () => {
  let audio: FakeToneApi;
  let player: ProgressionPlayerService;

  beforeEach(() => {
    audio = new FakeToneApi();
    TestBed.configureTestingModule({
      providers: [{ provide: PROGRESSION_AUDIO, useValue: audio }]
    });
    player = TestBed.inject(ProgressionPlayerService);
  });

  /** The slot `currentSlot$` is publishing now. */
  function currentSlot(): string | null {
    let captured: string | null | undefined;
    player.currentSlot$.subscribe(value => (captured = value)).unsubscribe();
    if (captured === undefined) throw new Error('currentSlot$ published nothing on subscribe');
    return captured;
  }

  /** The part carrying the note events of the last play. */
  function notePart(): FakePart {
    const part = audio.livingParts.find(candidate =>
      candidate.events.some(event => 'frequency' in event)
    );
    if (!part) throw new Error('no note part was scheduled');
    return part;
  }

  /**
   * The part carrying the slot cues of the last play.
   *
   * Told apart by what a cue lacks rather than by what it has: a note event
   * carries a `slotId` too, so looking for that finds the note part first.
   */
  function cuePart(): FakePart {
    const part = audio.livingParts.find(
      candidate =>
        candidate.events.length > 0 && candidate.events.every(event => !('frequency' in event))
    );
    if (!part) throw new Error('no cue part was scheduled');
    return part;
  }

  describe('the chain', () => {
    it('builds one piano chain, once, before anything is played', () => {
      expect(audio.synths.length).toBe(1);
      expect(audio.reverbs.length).toBe(1);
      expect(audio.volumes.length).toBe(1);
    });

    it('chains PolySynth -> Reverb -> Volume -> Destination', () => {
      expect(audio.synth.connectedTo).toBe(audio.reverbs[0]);
      expect(audio.reverbs[0].connectedTo).toBe(audio.volumes[0]);
      expect(audio.volumes[0].destinations).toBe(1);
    });

    it('reuses the one synth across plays rather than building another', async () => {
      await player.play(twoChords());
      await player.play(twoChords());

      expect(audio.synths.length).toBe(1);
      expect(audio.reverbs.length).toBe(1);
      expect(audio.volumes.length).toBe(1);
    });

    it('disposes everything it built on destroy', () => {
      TestBed.resetTestingModule();

      expect(audio.synth.disposals).toBe(1);
      expect(audio.reverbs[0].disposals).toBe(1);
      expect(audio.volumes[0].disposals).toBe(1);
    });

    it('disposes a live schedule on destroy too', async () => {
      await player.play(twoChords());
      const parts = audio.livingParts;
      expect(parts.length).toBe(2);

      TestBed.resetTestingModule();

      for (const part of parts) expect(part.disposals).toBe(1);
    });
  });

  describe('play', () => {
    it('resumes the audio context before it starts the transport', async () => {
      await player.play(twoChords());

      expect(audio.resumeCalls).toBe(1);
      expect(audio.startsBeforeResume).toBe(0);
      expect(audio.transportStub.starts).toBe(1);
    });

    it('schedules one event per note, at its time and its gain', async () => {
      await player.play(twoChords());

      const events = notePart().events as ScheduledNote[];
      expect(events.length).toBe(6);
      expect(events.map(event => event.time)).toEqual([0, 0, 0, 2, 2, 2]);
      expect(events[0].frequency).toBeCloseTo(261.6255653, 6);
      expect(events[0].gain).toBeCloseTo(80 / 127, 10);
      expect(notePart().started).toBe(0);
    });

    it('sounds a note through the one synth, at the time the transport gives it', async () => {
      await player.play(twoChords());

      notePart().fire(3);

      expect(audio.synth.triggered.length).toBe(1);
      expect(audio.synth.triggered[0]).toEqual({
        frequency: jasmine.any(Number) as unknown as number,
        duration: 2,
        time: 2,
        velocity: jasmine.any(Number) as unknown as number
      });
      expect(audio.synth.triggered[0].velocity).toBeCloseTo(80 / 127, 10);
    });

    it('sets the transport tempo from the document', async () => {
      await player.play(progression([degreeSlot('a', 0, 4, [note(60, 0, 4)])], 90));

      expect(audio.transportStub.tempo).toBe(90);
    });

    it('starts no transport for an empty progression', async () => {
      await player.play(progression([]));

      expect(audio.transportStub.starts).toBe(0);
      expect(audio.parts.length).toBe(0);
      expect(currentSlot()).toBeNull();
    });

    it('starts no transport for a tempo that names no time at all', async () => {
      // `normalizeProgressionDoc` clamps the tempo of every document the service
      // publishes, but `play` takes a `ProgressionDoc` from anywhere. A tempo of
      // zero puts every event at infinity and Tone throws on the way in.
      await player.play(progression([degreeSlot('a', 0, 4, [note(60, 0, 4)])], 0));

      expect(audio.parts.length).toBe(0);
      expect(audio.transportStub.starts).toBe(0);
    });

    it('replaces the previous schedule rather than leaking it', async () => {
      await player.play(twoChords());
      const first = audio.livingParts;

      await player.play(twoChords());

      for (const part of first) expect(part.disposals).toBe(1);
      expect(audio.livingParts.length).toBe(2);
    });

    it('schedules nothing when the context will not resume', async () => {
      audio.resumeFails = true;

      await player.play(twoChords());

      expect(audio.parts.length).toBe(0);
      expect(audio.transportStub.starts).toBe(0);
    });
  });

  describe('currentSlot$', () => {
    it('starts on nothing', () => {
      expect(currentSlot()).toBeNull();
    });

    it('publishes the slot each cue names', async () => {
      await player.play(twoChords());

      cuePart().fire(0);
      expect(currentSlot()).toBe('a');

      cuePart().fire(1);
      expect(currentSlot()).toBe('b');
    });

    it('clears itself and stops the transport at the end of a one-shot play', async () => {
      await player.play(twoChords());
      cuePart().fire(1);

      cuePart().fire(2);

      expect(currentSlot()).toBeNull();
      expect(audio.transportStub.stops).toBe(1);
    });
  });

  describe('stop', () => {
    it('stops the transport, drops the schedule and silences the synth', async () => {
      await player.play(twoChords());
      cuePart().fire(0);
      const parts = audio.livingParts;

      player.stop();

      expect(audio.transportStub.stops).toBe(1);
      expect(audio.transportStub.cancels).toBe(1);
      for (const part of parts) expect(part.disposals).toBe(1);
      expect(audio.synth.releases).toBe(1);
      expect(currentSlot()).toBeNull();
    });

    it('does nothing when nothing is playing', () => {
      expect(() => player.stop()).not.toThrow();

      expect(audio.transportStub.stops).toBe(0);
      expect(audio.transportStub.cancels).toBe(0);
      expect(audio.synth.releases).toBe(0);
    });

    it('is safe to call twice', async () => {
      await player.play(twoChords());

      player.stop();
      expect(() => player.stop()).not.toThrow();

      expect(audio.transportStub.stops).toBe(1);
      for (const part of audio.parts) expect(part.disposals).toBe(1);
    });
  });

  describe('setLoop', () => {
    it('loops over the progression length when a play begins', async () => {
      player.setLoop(true);

      await player.play(twoChords());

      expect(audio.transportStub.looping).toBeTrue();
      expect(audio.transportStub.loopEnd).toBe(4);
    });

    it('does not loop unless it is asked to', async () => {
      await player.play(twoChords());

      expect(audio.transportStub.looping).toBeFalse();
    });

    it('takes effect on a play already under way', async () => {
      await player.play(twoChords());

      player.setLoop(true);

      expect(audio.transportStub.looping).toBeTrue();
      expect(audio.transportStub.loopEnd).toBe(4);
    });

    it('is remembered while nothing is playing', () => {
      expect(() => player.setLoop(true)).not.toThrow();

      expect(audio.transportStub.starts).toBe(0);
    });
  });
});
