import { NgZone, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createOwnership } from '../models/progression-normalize';
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
    readonly events: readonly TimedEvent[],
    /**
     * The transport's tempo at the moment this part was built, or null if it
     * had none yet.
     *
     * `Tone.Part` resolves each event's time into ticks against the transport's
     * BPM, so a part built before `setTempo` places every event by the ratio of
     * the old tempo to the new one. The real transport shows that only as a
     * progression that plays at the wrong speed - which is a sound, not an
     * assertion - so the fake records the ordering instead.
     */
    readonly tempoWhenBuilt: number | null
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
  /**
   * The tempo in force when the loop was last set, or null if there was none.
   *
   * Same reason as `FakePart.tempoWhenBuilt`: Tone converts `loopEnd` to ticks
   * at the BPM current when it is assigned, so `setTempo` has to come first.
   */
  tempoAtLoop: number | null = null;
  starts = 0;
  stops = 0;
  cancels = 0;

  setTempo(bpm: number): void {
    this.tempo = bpm;
  }

  setLoop(on: boolean, endSeconds: number): void {
    this.looping = on;
    this.loopEnd = endSeconds;
    this.tempoAtLoop = this.tempo;
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

  /**
   * While true, `resume` does not settle until `openResumeGate` is called.
   *
   * The gap between `play` awaiting the audio context and its continuation
   * touching any state is where the service's two races live, and it is a real
   * gap rather than a theoretical one: on a first play `Tone.start()` waits on
   * the browser, which is long enough for a second click or a stop to land
   * inside it. A `resume` that resolves immediately closes the window and hides
   * both, so a spec that means to test the window has to hold it open.
   */
  gateResume = false;
  private readonly held: (() => void)[] = [];

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.startsBeforeResume = this.transportStub.starts;
    if (this.gateResume) await new Promise<void>(release => this.held.push(release));
    if (this.resumeFails) throw new Error('no user gesture yet');
  }

  /** Lets every `resume` held at the gate settle, in the order they arrived. */
  openResumeGate(): void {
    for (const release of this.held.splice(0)) release();
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
    const part = new FakePart(
      callback as (time: number, event: TimedEvent) => void,
      events,
      this.transportStub.tempo
    );
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
    owned: createOwnership()
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
    owned: createOwnership()
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

  it('clamps a velocity from outside MIDI\'s range back into it', () => {
    // 127 divides to exactly 1, so the top of the range does not exercise the
    // clamp at all - only a velocity that never went through
    // `normalizeChordSlot` does, which is the case the clamp is there for.
    const doc = progression([
      degreeSlot('a', 0, 4, [note(60, 0, 4, 200), note(64, 0, 4, -5)])
    ]);

    expect(buildSchedule(doc).notes.map(scheduled => scheduled.gain)).toEqual([1, 0]);
  });

  it('silences a velocity that is not a number at all', () => {
    // The clamp alone cannot catch this: `Math.min(1, Math.max(0, NaN))` is
    // NaN, so a `NaN` velocity would reach `triggerAttackRelease` as a NaN gain
    // through the very guard that exists to stop bad velocities. Silence is the
    // conservative answer - a note nobody can assign a level to should not be
    // the loudest thing in the mix.
    const doc = progression([degreeSlot('a', 0, 4, [note(60, 0, 4, NaN)])]);

    expect(buildSchedule(doc).notes[0].gain).toBe(0);
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

  /**
   * A note the roll draws has to be a note the transport reaches.
   *
   * This used to measure to the end of the last *slot*, on the argument that
   * the loop should turn over where the timeline the strip draws ends. That
   * left a note hanging off the last slot permanently silent - with looping on
   * the transport rewound before the event, and with looping off the trailing
   * cue halted first - while the roll went on drawing it and nothing said why.
   * `retimeNotes` leaves such a note there on purpose, so the schedule has to
   * reach it.
   */
  it('measures the progression to the last thing that sounds', () => {
    const doc = progression([literalSlot('lit', 0, 2, [note(60, 0, 8)])]);

    // Eight beats at 120 BPM, not the two the slot draws.
    expect(buildSchedule(doc).lengthSeconds).toBe(4);
  });

  it('measures a note that starts past the end of its slot too', () => {
    // The roll's own case rather than the resized literal slot's: a note placed
    // after the slot it belongs to, which `setNoteTiming` allows deliberately.
    // It is the start that is outside, so a schedule measuring only lengths
    // would still leave it unreachable.
    const doc = progression([degreeSlot('one', 0, 4, [note(60, 6, 1)])]);

    expect(buildSchedule(doc).lengthSeconds).toBe(3.5);
  });

  it('leaves a note overhanging into the next chord out of the measurement', () => {
    // The case the old rule was written for, and it is unchanged: the note runs
    // over the chord after it, which is the accepted trade, and the slot ends
    // are still what the progression is as long as.
    const doc = progression([
      degreeSlot('one', 0, 4, [note(60, 0, 6)]),
      degreeSlot('two', 4, 4, [note(67, 0, 4)])
    ]);

    expect(buildSchedule(doc).lengthSeconds).toBe(4);
  });

  it('measures to the furthest slot end rather than adding the lengths up', () => {
    // Two slots that overlap, which `settle` would never produce but `play`
    // accepts because it takes a document rather than the service's state. The
    // end is where the longer of the two finishes - eight beats, four seconds -
    // and not the ten beats their lengths come to.
    const doc = progression([
      degreeSlot('long', 0, 8, [note(60, 0, 8)]),
      degreeSlot('short', 2, 2, [note(64, 0, 2)])
    ]);

    expect(buildSchedule(doc).lengthSeconds).toBe(4);
  });

  it('returns the cues in the order they sound, not in document order', () => {
    // Tone's own `Timeline` sorts what it is given, so this costs nothing at
    // playback. It is for every other reader: a schedule inspected in a
    // debugger, asserted against in a spec, or drawn by M2's playhead should be
    // in the order it happens, and nothing should have to know to sort it.
    const doc = progression([
      degreeSlot('late', 4, 4, [note(60, 0, 4)]),
      degreeSlot('early', 0, 4, [note(62, 0, 4)])
    ]);

    const schedule = buildSchedule(doc);

    expect(schedule.cues.map(cue => cue.slotId)).toEqual(['early', 'late', null]);
    expect(schedule.notes.map(scheduled => scheduled.midi)).toEqual([62, 60]);
  });

  it('gives a progression with no length in it no trailing cue', () => {
    // Every slot zero beats long and holding nothing that lasts: there are
    // slots, so the old guard would have pushed a `null` cue at time 0
    // alongside the slot's own cue at time 0 - two contradictory cues at the
    // same instant. There is no moment at which this progression is over,
    // because there is no moment at which it is on.
    const doc = progression([degreeSlot('flat', 0, 0, [note(60, 0, 0)])]);

    const schedule = buildSchedule(doc);

    expect(schedule.lengthSeconds).toBe(0);
    expect(schedule.cues).toEqual([{ time: 0, slotId: 'flat' }] as SlotCue[]);
  });

  it('gives a zero-length slot the length of the note it holds', () => {
    // The other half of the line above: a slot with no length of its own still
    // sounds for as long as its note does, and a progression that sounds has a
    // moment at which it is over. `settle` clamps a slot to `MIN_SLOT_BEATS`,
    // so this arrives through `play`, which takes a document from anywhere.
    const doc = progression([degreeSlot('flat', 0, 0, [note(60, 0, 1)])]);

    const schedule = buildSchedule(doc);

    expect(schedule.lengthSeconds).toBe(0.5);
    expect(schedule.cues).toEqual([
      { time: 0, slotId: 'flat' },
      { time: 0.5, slotId: null }
    ] as SlotCue[]);
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
      providers: [
        ProgressionPlayerService,
        { provide: PROGRESSION_AUDIO, useValue: audio }
      ]
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

    it('sets the tempo before anything is measured against it', async () => {
      // Ordering, not just presence. Tone turns an event's time and the loop
      // end into ticks against whatever BPM the transport holds at that moment,
      // so a `setTempo` that arrived after either would misplace every event by
      // the ratio of the two tempi - and at 90 against a default 120 that is a
      // progression a third too fast, which no assertion in this file would
      // otherwise notice.
      player.setLoop(true);

      await player.play(progression([degreeSlot('a', 0, 4, [note(60, 0, 4)])], 90));

      expect(audio.transportStub.tempoAtLoop).toBe(90);
      expect(audio.parts.length).toBe(2);
      for (const part of audio.parts) expect(part.tempoWhenBuilt).toBe(90);
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

    it('starts no transport for a tempo that is not a number', async () => {
      // The other half of the same guard, and the one a bare `> 0` test would
      // miss: `NaN` fails every comparison, so it survives a minimum check that
      // zero does not. Every time in the schedule would be `NaN` and Tone
      // throws on the way in.
      await player.play(progression([degreeSlot('a', 0, 4, [note(60, 0, 4)])], NaN));

      expect(audio.parts.length).toBe(0);
      expect(audio.transportStub.starts).toBe(0);
    });

    it('starts no transport for a progression with no length in it', async () => {
      // Slots, but no time: there is nothing to play and nowhere for a loop to
      // turn over. Refused for the same reason a tempo of zero is.
      //
      // The note has no length either, which it did not have to before
      // `buildSchedule` began measuring to the last thing that sounds. A slot
      // of no length holding a note of some is a progression that *does* have
      // time in it, and it plays - see the arithmetic above.
      await player.play(progression([degreeSlot('flat', 0, 0, [note(60, 0, 0)])]));

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

    /**
     * **A known limitation, characterised rather than fixed.** `buildSchedule`
     * runs once per play and the parts carry that snapshot until the next
     * `play` or `stop`, so an edit made under a running transport is heard by
     * nothing. The page invites the edit - its key comes from the app-wide
     * circle of fifths, which is reachable mid-playback - so this is here to
     * make the behaviour a decision M2 inherits rather than a surprise it
     * discovers. `play` says why it was left, and the transport's
     * `describePosition` says what it looks like on screen.
     */
    it('plays the document it was handed, not the document as it becomes', async () => {
      const doc = twoChords();
      await player.play(doc);

      // The two edits the page can make while this is running: a chord
      // appended, and the key moved under it by the circle.
      doc.slots.push(degreeSlot('c', 8, 4, [note(72, 0, 4), note(76, 0, 4)]));
      doc.key = { tonic: 3, scaleId: 'ionian', preferSharps: false };

      // Six notes and two cues plus the trailing one: the two-slot schedule,
      // unchanged. Nothing re-reads the document.
      expect(notePart().events.length).toBe(6);
      expect(cuePart().events.length).toBe(3);
    });

    it('schedules nothing when the context will not resume', async () => {
      audio.resumeFails = true;

      await player.play(twoChords());

      expect(audio.parts.length).toBe(0);
      expect(audio.transportStub.starts).toBe(0);
    });

    it('lets the later of two overlapping plays win, and leaks nothing', async () => {
      // A double-click on the play button. `stop` runs at the top of `play`,
      // but the state it reads - and the state it clears - is only written
      // *after* the context resumes, so a second press inside that window finds
      // the service looking idle and disposes nothing. Both continuations then
      // schedule, both sets of parts sound, and only the last is remembered:
      // the first is a permanent leak that no later `stop` can reach.
      audio.gateResume = true;

      const first = player.play(twoChords());
      const second = player.play(twoChords());
      audio.openResumeGate();
      await first;
      await second;

      expect(audio.parts.length).toBe(2);
      expect(audio.livingParts.length).toBe(2);
      expect(audio.transportStub.starts).toBe(1);

      player.stop();

      expect(audio.livingParts.length).toBe(0);
    });

    it('abandons a play a stop overtook while the context was resuming', async () => {
      // The same window, from the other side, and a real one on a first play:
      // `Tone.start()` is genuinely slow the first time, so a stop pressed
      // straight after a play lands inside it. The stop finds nothing running
      // and returns, and the play's continuation then starts a transport the
      // user has already asked to be rid of.
      audio.gateResume = true;

      const playing = player.play(twoChords());
      player.stop();
      audio.openResumeGate();
      await playing;

      expect(audio.transportStub.starts).toBe(0);
      expect(audio.parts.length).toBe(0);
      expect(currentSlot()).toBeNull();
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

    it('publishes a cue for the same slot only once', async () => {
      // Which is what makes it safe to hand `currentSlot$` straight to an
      // `async` pipe: a cue that repeats the slot already showing must not
      // repaint, and M2's playhead will fire far more cues than there are
      // slots.
      await player.play(twoChords());
      const seen: (string | null)[] = [];
      const subscription = player.currentSlot$.subscribe(value => seen.push(value));

      cuePart().fire(0);
      cuePart().fire(0);

      subscription.unsubscribe();
      expect(seen).toEqual([null, 'a']);
    });

  });

  /**
   * The zone a cue is published in.
   *
   * Under this app's own configuration the question does not arise: Angular 21
   * bootstraps zoneless unless told otherwise and `main.ts` does not tell it
   * otherwise, so `NgZone` is a `NoopNgZone` and `AsyncPipe` repaints from any
   * zone. `TestBed` defaults the same way, which is why this block has to ask
   * for a real zone before it can test anything - under the default `NgZone`,
   * `runOutsideAngular` never leaves and `run` never re-enters, and a spec
   * written against it would assert nothing while looking like it did.
   *
   * What is pinned here is the other configuration: that if this app ever goes
   * back to `provideZoneChangeDetection`, a cue arriving on Tone's clock worker
   * in the root zone still publishes somewhere Angular is watching. Which zone
   * Tone's worker actually binds in is not decided here or anywhere else in
   * this file - it depends on who first touched the audio context - so
   * `runOutsideAngular` stands in for the case that would otherwise go unseen.
   */
  describe('publishing across zones', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      audio = new FakeToneApi();
      TestBed.configureTestingModule({
        providers: [
          provideZoneChangeDetection(),
          ProgressionPlayerService,
          { provide: PROGRESSION_AUDIO, useValue: audio }
        ]
      });
      player = TestBed.inject(ProgressionPlayerService);
    });

    it('publishes from inside Angular\'s zone wherever the cue was fired', async () => {
      await player.play(twoChords());
      const zone = TestBed.inject(NgZone);
      expect(zone.constructor.name).toBe('NgZone');

      let publishedInAngular: boolean | null = null;
      const subscription = player.currentSlot$.subscribe(() => {
        publishedInAngular = NgZone.isInAngularZone();
      });
      // Discard what `BehaviorSubject` replayed on subscribe: it arrived in the
      // test's own zone and would answer the question for the wrong emission.
      publishedInAngular = null;

      zone.runOutsideAngular(() => cuePart().fire(0));

      subscription.unsubscribe();
      expect(publishedInAngular).toBeTrue();
      expect(currentSlot()).toBe('a');
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

    it('does not stop the transport when the trailing cue lands while looping', async () => {
      // The service's half of the loop contract, and the half that is testable:
      // a cue naming no slot means "the progression ran out", which while
      // looping is the loop turning over rather than playback finishing. Acting
      // on it stops the transport dead after one pass.
      //
      // The other half - whether Tone reaches this cue at all - is *not*
      // covered by any test in this file and cannot be. It depends on where
      // `loopEnd` lands in ticks, and a fake transport has no ticks to land in.
      // See `onCue` for what the real transport does and why this guard does
      // not depend on it.
      player.setLoop(true);
      await player.play(twoChords());
      cuePart().fire(0);

      cuePart().fire(2);

      expect(audio.transportStub.stops).toBe(0);
      expect(audio.transportStub.cancels).toBe(0);
      expect(currentSlot()).toBe('a');
    });

    it('stops at the trailing cue once the loop has been turned off', async () => {
      // The guard reads the loop as it stands when the cue lands, not as it
      // stood when the schedule was built, so a loop switched off mid-play ends
      // at the end of the pass it is in.
      player.setLoop(true);
      await player.play(twoChords());
      player.setLoop(false);

      cuePart().fire(2);

      expect(audio.transportStub.stops).toBe(1);
      expect(currentSlot()).toBeNull();
    });
  });

  describe('the end of a one-shot play', () => {
    it('leaves the schedule alive, and disposable', async () => {
      // `halt` runs from inside a cue part's own callback, and deliberately
      // does not dispose the parts there - a part disposing its sibling from
      // within a running callback is not worth the cleverness for a resource
      // the next `play` or `stop` frees anyway. What makes that safe is that
      // `stop` guards on the schedule as well as on the transport: after a halt
      // nothing is running, but two parts are still outstanding, and a guard
      // that only asked whether the transport was running would return early
      // and leak both.
      await player.play(twoChords());
      const parts = audio.livingParts;
      expect(parts.length).toBe(2);

      cuePart().fire(2);

      expect(audio.livingParts.length).toBe(2);

      TestBed.resetTestingModule();

      for (const part of parts) expect(part.disposals).toBe(1);
    });

    it('frees the schedule on an explicit stop after it', async () => {
      await player.play(twoChords());
      const parts = audio.livingParts;

      cuePart().fire(2);
      player.stop();

      for (const part of parts) expect(part.disposals).toBe(1);
      expect(audio.livingParts.length).toBe(0);
    });
  });
});
