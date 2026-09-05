import { TestBed } from '@angular/core/testing';
import { TimeSignature } from '../models/composer.model';
import { DetectedNote } from '../models/transcription.model';
import { trackBeats } from './beat-tracking';
import { DetectionResult, NoteDetector } from './note-detector';
import { suppressHarmonics } from './transcription-harmonics';
import {
  NOTE_DETECTOR,
  TranscriptionService,
  TranscriptionState
} from './transcription.service';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** [onsetSec, midiPitch, durationSec, amplitude] */
type Raw = [number, number, number, number];

function note([onsetSec, pitch, duration, amplitude]: Raw, index: number): DetectedNote {
  return {
    id: `n${index}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + duration,
    confidence: amplitude,
    bendCents: []
  };
}

/**
 * Verbatim output of @spotify/basic-pitch on a synthetic bassline of eight
 * notes - E1 A1 D2 G2 twice - the same fixture `transcription-harmonics.spec.ts`
 * is pinned against. Thirty-four notes for eight played, twenty-six of them
 * partials carrying onsets of their own.
 *
 * It is here rather than a tidy eight-note list because the ordering hazard
 * this spec exists to catch only shows up on material where suppression changes
 * the rhythm: feed these raw onsets to the beat tracker and it tracks the
 * partials instead of the notes.
 */
const SPIKE_OUTPUT: Raw[] = [
  [0.000, 28, 0.464, 0.565], [0.058, 52, 0.244, 0.377], [0.093, 40, 0.267, 0.552],
  [0.093, 47, 0.104, 0.343], [0.488, 33, 0.395, 0.687], [0.488, 45, 0.081, 0.264],
  [0.546, 57, 0.267, 0.328], [0.557, 52, 0.070, 0.329], [0.569, 45, 0.313, 0.514],
  [0.882, 33, 0.093, 0.445], [0.894, 38, 0.081, 0.299], [0.975, 38, 0.418, 0.712],
  [1.022, 62, 0.081, 0.352], [1.045, 50, 0.360, 0.484], [1.393, 38, 0.070, 0.415],
  [1.486, 43, 0.476, 0.666], [1.521, 55, 0.383, 0.428], [1.823, 28, 0.628, 0.520],
  [2.056, 52, 0.244, 0.381], [2.091, 40, 0.267, 0.548], [2.091, 47, 0.104, 0.345],
  [2.486, 33, 0.395, 0.688], [2.486, 45, 0.081, 0.264], [2.544, 57, 0.267, 0.329],
  [2.555, 52, 0.070, 0.329], [2.567, 45, 0.313, 0.514], [2.881, 33, 0.093, 0.443],
  [2.892, 38, 0.081, 0.297], [2.973, 38, 0.488, 0.676], [3.020, 62, 0.081, 0.352],
  [3.043, 50, 0.372, 0.485], [3.496, 43, 0.476, 0.667], [3.519, 55, 0.383, 0.424],
  [3.519, 67, 0.070, 0.349]
];

const DETECTED: DetectedNote[] = SPIKE_OUTPUT.map(note);

/** The eight of those that are notes rather than partials. */
const PLAYED_PITCHES = [28, 33, 38, 43, 28, 33, 38, 43];

/**
 * A `NoteDetector` that returns a fixed answer without a worker or a model.
 *
 * It **transfers the caller's buffer away**, exactly as `WorkerDetector` does
 * when it posts the samples across. That is not decoration: it is what turns
 * "the service must not reuse the audio after detection" from a comment into
 * something the suite fails on, and every test here runs against a detector
 * that detaches.
 */
class StubDetector implements NoteDetector {
  calls = 0;
  lastSampleRate = 0;
  lastAudioLength = 0;
  notes: DetectedNote[] = DETECTED;
  /** When set, `detect` rejects with this message instead of returning notes. */
  failWith: string | null = null;
  /** Progress fractions to report, in order, before finishing. */
  progressFractions: number[] = [0.25, 0.5, 1];

  async detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void
  ): Promise<DetectionResult> {
    this.calls++;
    this.lastSampleRate = sampleRate;
    this.lastAudioLength = audio.length;

    // Detach the caller's buffer, the way posting it to a worker would.
    if (audio.buffer instanceof ArrayBuffer) {
      structuredClone(audio.buffer, { transfer: [audio.buffer] });
    }

    // A microtask, so nothing can accidentally depend on a synchronous
    // detector: the real one is a round trip to a worker.
    await Promise.resolve();

    if (this.failWith !== null) throw new Error(this.failWith);

    for (const fraction of this.progressFractions) onProgress(fraction);

    return { notes: this.notes, bendFrameRateHz: 22050 / 256 };
  }
}

/**
 * A RIFF/WAVE file of `seconds` of silence at 44.1 kHz, mono 16-bit.
 *
 * Silence, because the detector is stubbed and the only thing the pipeline
 * reads off the audio is how long it is. It is a real file put through the real
 * browser decoder all the same, so the decode step is not mocked away.
 */
function silentWav(seconds: number, sampleRate = 44100): ArrayBuffer {
  const frames = Math.round(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  return buffer;
}

function wavFile(name = 'bassline.wav', seconds = 4): File {
  return new File([silentWav(seconds)], name, { type: 'audio/wav' });
}

/** Not audio at all, so the browser decoder rejects it. */
function junkFile(name = 'broken.wav'): File {
  return new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], name, { type: 'audio/wav' });
}

/** The frets actually struck, in bar order. */
function struckFrets(state: TranscriptionState): number[] {
  const bars = state.derived?.doc.tracks[0].staves[0].bars ?? [];

  return bars.flatMap(bar =>
    bar.voices[0].beats
      .filter(beat => !beat.isRest && !beat.notes[0].isTied)
      .map(beat => (beat.notes[0].pitch.kind === 'fretted' ? beat.notes[0].pitch.fret : -1))
  );
}

/**
 * The invariants every emitted state has to satisfy, whatever happened.
 *
 * Checked across the whole recorded stream rather than on the final state: the
 * inconsistencies worth catching - `ready` with no score, `failed` still
 * carrying the score of the run before it - are transient by nature, and a
 * subscriber sees every one of them.
 */
function checkInvariants(states: TranscriptionState[]): void {
  for (const state of states) {
    const where = `phase ${state.phase}`;

    expect(state.progress).withContext(`${where}: progress`).toBeGreaterThanOrEqual(0);
    expect(state.progress).withContext(`${where}: progress`).toBeLessThanOrEqual(1);

    switch (state.phase) {
      case 'ready':
        expect(state.session).withContext(`${where}: session`).not.toBeNull();
        expect(state.derived).withContext(`${where}: derived`).not.toBeNull();
        expect(state.error).withContext(`${where}: error`).toBeNull();
        break;
      case 'failed':
        expect(state.error).withContext(`${where}: error`).toBeTruthy();
        // No stale score from an earlier run: a failed state describes the run
        // that failed and nothing else.
        expect(state.derived).withContext(`${where}: derived`).toBeNull();
        expect(state.session).withContext(`${where}: session`).toBeNull();
        break;
      default:
        // idle and the three working phases have produced nothing yet.
        expect(state.derived).withContext(`${where}: derived`).toBeNull();
        expect(state.session).withContext(`${where}: session`).toBeNull();
        expect(state.error).withContext(`${where}: error`).toBeNull();
        break;
    }
  }
}

/** Progress never runs backwards inside one phase. */
function checkProgressMonotonic(states: TranscriptionState[]): void {
  for (let i = 1; i < states.length; i++) {
    if (states[i].phase !== states[i - 1].phase) continue;

    expect(states[i].progress)
      .withContext(`progress within ${states[i].phase}`)
      .toBeGreaterThanOrEqual(states[i - 1].progress);
  }
}

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let detector: StubDetector;
  let states: TranscriptionState[];

  beforeEach(() => {
    detector = new StubDetector();
    TestBed.configureTestingModule({
      providers: [{ provide: NOTE_DETECTOR, useValue: detector }]
    });
    service = TestBed.inject(TranscriptionService);
    states = [];
    service.getState().subscribe(state => states.push(state));
  });

  describe('initial state', () => {
    it('starts idle with nothing in it', () => {
      expect(states.length).toBe(1);
      expect(states[0]).toEqual({
        phase: 'idle',
        progress: 0,
        session: null,
        derived: null,
        error: null
      });
      expect(service.busy).toBeFalse();
    });

    it('replays the current state to a late subscriber', async () => {
      await service.transcribe(wavFile());

      const seen: TranscriptionState[] = [];
      service.getState().subscribe(state => seen.push(state));

      expect(seen.length).toBe(1);
      expect(seen[0].phase).toBe('ready');
    });
  });

  describe('transcribe', () => {
    it('walks decoding, detecting, deriving, ready', async () => {
      await service.transcribe(wavFile());

      // Consecutive duplicates collapsed: the order of the phases is the
      // assertion, not how many progress updates each one happened to emit.
      const phases = states.map(s => s.phase).filter((p, i, all) => p !== all[i - 1]);

      expect(phases).toEqual(['idle', 'decoding', 'detecting', 'deriving', 'ready']);
    });

    it('holds every state invariant along the way', async () => {
      await service.transcribe(wavFile());

      checkInvariants(states);
      checkProgressMonotonic(states);
    });

    it('produces a score from a real file', async () => {
      await service.transcribe(wavFile('walk.wav'));

      const state = service.state;
      expect(state.phase).toBe('ready');
      expect(state.session?.sourceName).toBe('walk.wav');
      expect(state.session?.durationSec).toBeCloseTo(4, 2);
      expect(state.derived?.doc.tracks.length).toBe(1);
      expect(state.derived?.doc.tracks[0].staves[0].bars.length).toBeGreaterThan(0);
      expect(struckFrets(state).length).toBe(PLAYED_PITCHES.length);
    });

    it('hands the detector the decoded audio at the rate it expects', async () => {
      await service.transcribe(wavFile('walk.wav', 2));

      expect(detector.lastSampleRate).toBe(22050);
      expect(detector.lastAudioLength).toBe(Math.ceil(2 * 22050));
    });

    it('keeps the duration although both buffers were detached under it', async () => {
      // `decodeToMono` detaches the ArrayBuffer it is handed, and the detector
      // detaches the Float32Array; the duration therefore has to have been read
      // off the decode result rather than off either buffer.
      await service.transcribe(wavFile('walk.wav', 3));

      expect(service.state.session?.durationSec).toBeCloseTo(3, 2);
    });

    it('suppresses the harmonics the detector reported', async () => {
      await service.transcribe(wavFile());

      expect(service.state.session?.notes.map(n => n.pitch)).toEqual(PLAYED_PITCHES);
    });

    it('tracks the beat on the suppressed notes, not the raw ones', async () => {
      // The ordering hazard, stated as a test. Twenty-six of the thirty-four
      // detections are partials carrying onsets of their own, so a tracker fed
      // the raw list follows those instead of the rhythm.
      const fromSuppressed = trackBeats(suppressHarmonics(DETECTED), 4, FOUR_FOUR);
      const fromRaw = trackBeats(DETECTED, 4, FOUR_FOUR);

      // Without this the test would pass on a service that got the order wrong.
      expect(fromRaw.beatsSec).not.toEqual(fromSuppressed.beatsSec);

      await service.transcribe(wavFile());

      expect(service.state.session?.grid.beatsSec).toEqual(fromSuppressed.beatsSec);
    });

    it('stamps the caller time signature onto the grid', async () => {
      const three: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };
      await service.transcribe(wavFile(), three);

      expect(service.state.session?.grid.timeSignature).toEqual(three);
    });

    it('reports detection progress as the detector sends it', async () => {
      detector.progressFractions = [0.1, 0.4, 0.9, 1];
      await service.transcribe(wavFile());

      const detecting = states.filter(s => s.phase === 'detecting').map(s => s.progress);

      expect(detecting).toEqual([0, 0.1, 0.4, 0.9, 1]);
    });

    it('clamps a detector that reports nonsense', async () => {
      detector.progressFractions = [-1, Number.NaN, 5, 0.5];
      await service.transcribe(wavFile());

      const detecting = states.filter(s => s.phase === 'detecting').map(s => s.progress);

      // -1 and NaN floor to 0 and the 0.5 arrives after the 5, so all three are
      // refused as backwards; only the 5 lands, clamped to 1.
      expect(detecting).toEqual([0, 1]);
      checkInvariants(states);
      checkProgressMonotonic(states);
    });
  });

  describe('failure', () => {
    it('lands in failed with a message when the file will not decode', async () => {
      await expectAsync(service.transcribe(junkFile())).toBeResolved();

      expect(service.state.phase).toBe('failed');
      expect(service.state.error).toContain('broken.wav');
      expect(service.state.derived).toBeNull();
      checkInvariants(states);
    });

    it('lands in failed when the detector rejects', async () => {
      detector.failWith = 'the model would not load';

      await expectAsync(service.transcribe(wavFile())).toBeResolved();

      expect(service.state.phase).toBe('failed');
      expect(service.state.error).toContain('the model would not load');
      checkInvariants(states);
    });

    it('does not leave an earlier run score lying in a failed state', async () => {
      await service.transcribe(wavFile());
      expect(service.state.phase).toBe('ready');

      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile('second.wav'));

      expect(service.state.phase).toBe('failed');
      expect(service.state.derived).toBeNull();
      expect(service.state.session).toBeNull();
      checkInvariants(states);
    });

    it('is ready to run again after a failure', async () => {
      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile());

      detector.failWith = null;
      await service.transcribe(wavFile());

      expect(service.busy).toBeFalse();
      expect(service.state.phase).toBe('ready');
    });
  });

  describe('concurrency', () => {
    it('refuses a second transcription while one is running', async () => {
      const first = service.transcribe(wavFile('first.wav'));

      expect(service.busy).toBeTrue();
      await expectAsync(service.transcribe(wavFile('second.wav'))).toBeRejectedWithError(
        /Already transcribing "first.wav"/
      );

      await first;
      expect(service.state.phase).toBe('ready');
      expect(service.state.session?.sourceName).toBe('first.wav');
      expect(detector.calls).toBe(1);
    });

    it('is no longer busy by the time a terminal state arrives', async () => {
      // A component that starts the next file on hearing `ready` would be
      // refused by a run that has in fact already finished.
      const busyAt = new Map<string, boolean>();
      service.getState().subscribe(state => busyAt.set(state.phase, service.busy));

      await service.transcribe(wavFile());
      expect(busyAt.get('detecting')).toBeTrue();
      expect(busyAt.get('ready')).toBeFalse();

      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile());
      expect(busyAt.get('failed')).toBeFalse();
    });

    it('pushes no state of its own when it refuses', async () => {
      const first = service.transcribe(wavFile('first.wav'));
      const before = states.length;

      await service.transcribe(wavFile('second.wav')).catch(() => undefined);

      expect(states.length).toBe(before);
      await first;
      checkInvariants(states);
    });
  });

  describe('updateSettings', () => {
    it('re-derives without running detection again', async () => {
      await service.transcribe(wavFile());
      const before = service.state.derived?.doc;
      expect(struckFrets(service.state).length).toBeGreaterThan(0);

      // Above every confidence in the fixture, so every note is dropped.
      service.updateSettings({ confidenceFloor: 0.95 });

      expect(detector.calls).toBe(1);
      expect(service.state.derived?.doc).not.toBe(before);
      expect(struckFrets(service.state).length).toBe(0);
      expect(service.state.session?.settings.confidenceFloor).toBe(0.95);
    });

    it('changes the score synchronously, in milliseconds', async () => {
      await service.transcribe(wavFile());

      const start = performance.now();
      service.updateSettings({ confidenceFloor: 0.95 });
      const elapsed = performance.now() - start;

      // Already applied by the time the call returned: no await, no pipeline.
      expect(service.state.session?.settings.confidenceFloor).toBe(0.95);
      expect(elapsed).withContext(`${elapsed.toFixed(2)} ms`).toBeLessThan(100);
    });

    it('leaves the detected notes untouched across a re-derivation', async () => {
      await service.transcribe(wavFile());
      const notes = service.state.session?.notes ?? [];

      service.updateSettings({ capo: 3 });

      expect(service.state.session?.notes).toEqual(notes);
    });

    it('re-fingers when the tuning changes', async () => {
      await service.transcribe(wavFile());
      const before = struckFrets(service.state);

      // Every string a semitone down, so nothing sits where it did.
      const tuning = (service.state.session?.settings.tuning ?? []).map(pitch => pitch - 1);
      service.updateSettings({ tuning });

      expect(detector.calls).toBe(1);
      expect(service.state.derived?.doc.tracks[0].staves[0].tuning).toEqual(tuning);
      expect(struckFrets(service.state)).not.toEqual(before);
    });

    it('does not share the tuning array the caller passed in', async () => {
      await service.transcribe(wavFile());
      const tuning = [43, 38, 33, 28];
      service.updateSettings({ tuning });

      tuning[0] = 999;

      expect(service.state.session?.settings.tuning).toEqual([43, 38, 33, 28]);
    });

    it('is a no-op before anything has been transcribed', () => {
      service.updateSettings({ confidenceFloor: 0.9 });

      expect(service.state.phase).toBe('idle');
      expect(states.length).toBe(1);
    });

    it('is a no-op while a transcription is running', async () => {
      const first = service.transcribe(wavFile());
      const before = states.length;

      service.updateSettings({ confidenceFloor: 0.9 });

      expect(states.length).toBe(before);
      await first;
      expect(service.state.session?.settings.confidenceFloor).toBe(0.3);
    });

    it('is a no-op after a failed run', async () => {
      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile());
      const before = states.length;

      service.updateSettings({ confidenceFloor: 0.9 });

      expect(service.state.phase).toBe('failed');
      expect(states.length).toBe(before);
    });

    it('keeps the state valid when handed nothing to change', async () => {
      await service.transcribe(wavFile());
      const before = states.length;

      service.updateSettings({});

      expect(states.length).toBe(before + 1);
      checkInvariants(states);
    });
  });

  describe('updateTimeSignature', () => {
    it('re-bars the score without running detection again', async () => {
      await service.transcribe(wavFile());
      const before = service.state.derived?.doc.tracks[0].staves[0].bars.length ?? 0;

      service.updateTimeSignature({ numerator: 2, denominator: 4, isCommon: false });

      expect(detector.calls).toBe(1);
      expect(service.state.session?.grid.timeSignature.numerator).toBe(2);
      // Half as many beats to a bar, so about twice as many bars.
      expect(service.state.derived?.doc.tracks[0].staves[0].bars.length).toBeGreaterThan(before);
    });

    it('leaves the tracked beats where they were', async () => {
      await service.transcribe(wavFile());
      const beats = service.state.session?.grid.beatsSec ?? [];

      service.updateTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

      expect(service.state.session?.grid.beatsSec).toEqual(beats);
    });

    it('is a no-op before anything has been transcribed', () => {
      service.updateTimeSignature(FOUR_FOUR);

      expect(service.state.phase).toBe('idle');
      expect(states.length).toBe(1);
    });
  });

  describe('dropped notes', () => {
    it('surfaces what derivation discarded, so M3 need not recompute it', async () => {
      await service.transcribe(wavFile());
      expect(service.state.derived?.dropped).toEqual([]);

      service.updateSettings({ confidenceFloor: 0.95 });

      const dropped = service.state.derived?.dropped ?? [];
      expect(dropped.length).toBe(PLAYED_PITCHES.length);
      expect(dropped.every(entry => entry.reason === 'belowConfidence')).toBeTrue();
    });
  });

  describe('session identity', () => {
    it('gives each run its own session id', async () => {
      await service.transcribe(wavFile());
      const first = service.state.session?.id;

      await service.transcribe(wavFile());

      expect(service.state.session?.id).toBeTruthy();
      expect(service.state.session?.id).not.toBe(first);
    });

    it('keeps the session id across a re-derivation', async () => {
      await service.transcribe(wavFile());
      const id = service.state.session?.id;

      service.updateSettings({ capo: 2 });

      expect(service.state.session?.id).toBe(id);
    });
  });
});
