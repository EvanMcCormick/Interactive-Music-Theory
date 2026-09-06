import { TestBed } from '@angular/core/testing';
import { TimeSignature } from '../models/composer.model';
import { DetectedNote } from '../models/transcription.model';
import { trackBeats } from './beat-tracking';
import { detectionsOf } from './harmonic-eval/detections.fixture';
import { MATERIAL } from './harmonic-eval/material';
import { DetectionResult, NoteDetector } from './note-detector';
import { suppressHarmonics } from './transcription-harmonics';
import {
  NOTE_DETECTOR,
  TranscriptionService,
  TranscriptionState
} from './transcription.service';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/**
 * The detector's frozen output on `walking` - twelve notes of a bass line,
 * twenty-eight detections, ten of them partials carrying onsets of their own.
 *
 * It is here rather than a tidy twelve-note list because the ordering hazard
 * this spec exists to catch only shows up on material where suppression
 * changes the rhythm: feed these raw onsets to the beat tracker and it tracks
 * the partials instead of the notes.
 *
 * This used to be thirty-four rows of `SPIKE_OUTPUT` pasted in here, in
 * `transcription-harmonics.spec.ts` and in `preview-score.spec.ts` - three
 * copies of one array whose audio, it turned out, had the discredited duration
 * rule's premise built into it. `harmonic-eval/detections.fixture.ts` now
 * holds one copy of sixteen captures from honest Karplus-Strong material, and
 * that spec's docblock has the measurement.
 */
const DETECTED: DetectedNote[] = detectionsOf('walking');

/** How long the fixture runs, rounded up: the stub returns notes out to 7.2 s. */
const DURATION_SEC = 8;

/** The twelve pitches `walking` actually plays, in order. */
const PLAYED_PITCHES: number[] = (
  MATERIAL.find(m => m.name === 'walking')?.notes ?? []
).map(n => n.pitch);

/**
 * What suppression leaves of those twenty-eight, measured not chosen.
 *
 * Eighteen, not twelve: on this material suppression removes ten artefacts and
 * every note the detector found survives, but six artefacts survive with them.
 * `harmonic-eval/harmonic-accuracy.spec.ts` is where that is measured across
 * all sixteen materials - 61.2 % precision - and `guitar` is the only one where
 * the played line comes back exactly.
 */
const KEPT_COUNT = 18;

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

function wavFile(name = 'bassline.wav', seconds = DURATION_SEC): File {
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
        expect(state.suppressed).withContext(`${where}: suppressed`).toEqual([]);
        expect(state.refusal).withContext(`${where}: refusal`).toBeNull();
        break;
      default:
        // idle and the three working phases have produced nothing yet.
        expect(state.derived).withContext(`${where}: derived`).toBeNull();
        expect(state.session).withContext(`${where}: session`).toBeNull();
        expect(state.suppressed).withContext(`${where}: suppressed`).toEqual([]);
        expect(state.error).withContext(`${where}: error`).toBeNull();
        expect(state.refusal).withContext(`${where}: refusal`).toBeNull();
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
        suppressed: [],
        error: null,
        refusal: null
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
      expect(state.session?.durationSec).toBeCloseTo(DURATION_SEC, 2);
      expect(state.derived?.doc.tracks.length).toBe(1);
      expect(state.derived?.doc.tracks[0].staves[0].bars.length).toBeGreaterThan(0);
      // Thirteen, measured. Eighteen detections survive suppression; two of
      // them fall under the default 0.3 confidence floor before derivation,
      // and quantisation stacks several of the rest onto beats they share, so
      // a struck fret is not one per surviving note.
      //
      // Nor is it one per note played. Twelve would mean suppression had
      // recovered the line exactly, which it does on one of the sixteen
      // captured materials and not on this one; six of the eighteen survivors
      // are artefacts. `harmonic-eval/harmonic-accuracy.spec.ts` is where that
      // is measured rather than asserted.
      expect(struckFrets(state).length).toBe(13);
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

      const notes = service.state.session?.notes ?? [];
      // The service has to run suppression, not carry the detector's list
      // through: twenty-eight in, eighteen out, and the eighteen are the ones
      // the suppressor picks rather than some other eighteen.
      expect(notes.length).toBe(KEPT_COUNT);
      expect(notes.map(n => n.id)).toEqual(suppressHarmonics(DETECTED).map(n => n.id));

      // ...and the musical claim underneath the counts: every pitch `walking`
      // plays that the detector found is still on the session. Suppression
      // costs this material nothing.
      const kept = new Set(notes.map(n => n.pitch));
      const found = new Set(
        DETECTED.filter(d => PLAYED_PITCHES.includes(d.pitch)).map(d => d.pitch)
      );
      for (const pitch of found) {
        expect(kept.has(pitch)).withContext(`MIDI ${pitch}`).toBeTrue();
      }
    });

    it('tracks the beat on the suppressed notes, not the raw ones', async () => {
      // The ordering hazard, stated as a test. Ten of the twenty-eight
      // detections are partials carrying onsets of their own, so a tracker fed
      // the raw list follows those instead of the rhythm.
      const fromSuppressed = trackBeats(suppressHarmonics(DETECTED), DURATION_SEC, FOUR_FOUR);
      const fromRaw = trackBeats(DETECTED, DURATION_SEC, FOUR_FOUR);

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

  /**
   * The way out of a finished run.
   *
   * Without it `session` is non-null from the first success onwards, and every
   * UI that shows a dropzone "until there is a session" shows it exactly once
   * per page load - the service is root-scoped, so navigating away and back
   * replays the same state.
   */
  describe('reset', () => {
    it('returns to idle, throwing the finished score away', async () => {
      await service.transcribe(wavFile());
      expect(service.state.phase).toBe('ready');

      service.reset();

      expect(service.state).toEqual({
        phase: 'idle',
        progress: 0,
        session: null,
        derived: null,
        suppressed: [],
        error: null,
        refusal: null
      });
      checkInvariants(states);
    });

    it('clears a failure as well as a success', async () => {
      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile());
      expect(service.state.phase).toBe('failed');

      service.reset();

      expect(service.state.phase).toBe('idle');
      expect(service.state.error).toBeNull();
    });

    it('lets a second file be transcribed, on the same detector', async () => {
      await service.transcribe(wavFile('first.wav'));
      const first = service.state.session;

      service.reset();
      await service.transcribe(wavFile('second.wav'));

      expect(service.state.phase).toBe('ready');
      expect(service.state.session?.sourceName).toBe('second.wav');
      expect(service.state.session?.id).not.toBe(first?.id ?? '');
      expect(service.state.derived?.doc.title).toBe('second.wav');
      // The worker is what makes the first detection expensive, so a reset
      // must not throw it away: two runs, one detector, two calls.
      expect(detector.calls).toBe(2);
      checkInvariants(states);
    });

    it('is a no-op while a run is still going', async () => {
      const first = service.transcribe(wavFile('first.wav'));
      const before = states.length;

      service.reset();

      // Anything else would be cleared and then immediately overwritten by the
      // terminal state of the run that is still in flight.
      expect(states.length).toBe(before);
      await first;
      expect(service.state.phase).toBe('ready');
    });

    it('says nothing new when there is nothing to clear', () => {
      const before = states.length;

      service.reset();
      service.reset();

      expect(states.length).toBe(before);
      expect(service.state.phase).toBe('idle');
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

  describe('updateTempo', () => {
    it('respaces the grid without running detection again', async () => {
      await service.transcribe(wavFile());

      service.updateTempo(90);

      expect(detector.calls).toBe(1);
      // Read straight back off the grid by `gridTempo`, so the score says what
      // was asked for rather than what the tracker measured.
      expect(service.state.derived?.doc.tempo).toBe(90);

      const beats = service.state.session?.grid.beatsSec ?? [];
      expect(beats.length).toBeGreaterThan(1);
      expect(beats[1] - beats[0]).toBeCloseTo(60 / 90, 6);
    });

    it('anchors the respacing on the first beat', async () => {
      await service.transcribe(wavFile());
      const first = service.state.session?.grid.beatsSec[0];

      service.updateTempo(90);

      // The beat the downbeat controls have already positioned. A tempo change
      // that moved it would undo that work.
      expect(service.state.session?.grid.beatsSec[0]).toBe(first!);
    });

    it('leaves the grid alone for a tempo that is not a positive number', async () => {
      await service.transcribe(wavFile());
      const beats = service.state.session?.grid.beatsSec ?? [];

      for (const bad of [0, -60, NaN, Infinity]) {
        service.updateTempo(bad);

        expect(service.state.phase).toBe('ready');
        expect(service.state.session?.grid.beatsSec).toEqual(beats);
      }

      expect(detector.calls).toBe(1);
      checkInvariants(states);
    });

    it('is a no-op before anything has been transcribed', () => {
      service.updateTempo(90);

      expect(service.state.phase).toBe('idle');
      expect(states.length).toBe(1);
    });

    it('is a no-op after a failed run', async () => {
      detector.failWith = 'gone wrong';
      await service.transcribe(wavFile());
      const before = states.length;

      service.updateTempo(90);

      expect(service.state.phase).toBe('failed');
      expect(states.length).toBe(before);
    });
  });

  describe('nudgeDownbeat', () => {
    it('moves the bar lines without running detection again', async () => {
      await service.transcribe(wavFile());
      const beats = service.state.session?.grid.beatsSec ?? [];

      service.nudgeDownbeat(1);

      expect(detector.calls).toBe(1);
      // The beat after the one bar 1 used to start on.
      expect(service.state.session?.grid.beatsSec).toEqual(beats.slice(1));
    });

    it('lets bar 1 begin before the audio does', async () => {
      await service.transcribe(wavFile());
      const beats = service.state.session?.grid.beatsSec ?? [];
      expect(beats[0]).toBeLessThan(0.1);

      service.nudgeDownbeat(-1);

      // Negative, and still a working score: the piece begins mid-bar, which
      // is what a first note on beat 2 means. `secondsToBeats` extrapolates
      // there by design.
      expect(service.state.session?.grid.beatsSec[0]).toBeLessThan(0);
      expect(service.state.phase).toBe('ready');
      expect(service.state.error).toBeNull();
      expect(struckFrets(service.state).length).toBeGreaterThan(0);
      checkInvariants(states);
    });

    it('restores the original placement on a round trip', async () => {
      await service.transcribe(wavFile());
      const frets = struckFrets(service.state);
      const bars = service.state.derived?.doc.tracks[0].staves[0].bars.length;
      expect(frets.length).toBeGreaterThan(0);

      service.nudgeDownbeat(1);
      service.nudgeDownbeat(-1);

      // The placement, not the beat times: nudging back reconstructs the
      // dropped beat from the interval that is now leading, and a tracked grid
      // is not evenly spaced. What has to come back is where the notes are
      // written, which is the only thing the user asked to move.
      expect(struckFrets(service.state)).toEqual(frets);
      expect(service.state.derived?.doc.tracks[0].staves[0].bars.length).toBe(bars!);
      expect(detector.calls).toBe(1);
    });

    it('leaves the grid alone for a fractional nudge', async () => {
      await service.transcribe(wavFile());
      const beats = service.state.session?.grid.beatsSec ?? [];

      service.nudgeDownbeat(0.5);

      expect(service.state.session?.grid.beatsSec).toEqual(beats);
      expect(detector.calls).toBe(1);
    });

    it('is a no-op before anything has been transcribed', () => {
      service.nudgeDownbeat(1);

      expect(service.state.phase).toBe('idle');
      expect(states.length).toBe(1);
    });

    it('is a no-op while a transcription is running', async () => {
      const first = service.transcribe(wavFile());
      const before = states.length;

      service.nudgeDownbeat(1);

      expect(states.length).toBe(before);
      await first;
    });
  });

  /**
   * The error contract: a settings combination the user chose degrades, and
   * only input data that cannot be honoured throws.
   *
   * `quantizeBar` cannot write a bar whose beat the grid is coarser than, and
   * both halves of that pair are live knobs - `finestDivision` through
   * `updateSettings`, the denominator through `updateTimeSignature`. Before
   * this was checked, the sequence below threw out of `updateSettings` into
   * the caller's event handler: no state was pushed at all, so a UI went on
   * showing the old score with its control in the new position.
   */
  describe('settings a bar cannot express', () => {
    const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

    it('refuses a finestDivision coarser than the meter, keeping the score', async () => {
      await service.transcribe(wavFile(), SIX_EIGHT);
      const derived = service.state.derived;
      const settings = service.state.session?.settings;
      expect(struckFrets(service.state).length).toBeGreaterThan(0);

      service.updateSettings({ finestDivision: 4 });

      expect(service.state.phase).toBe('ready');
      // The previous score, not a re-derived one and not a blank one.
      expect(service.state.derived).toBe(derived!);
      expect(service.state.session?.settings).toBe(settings!);
      expect(service.state.session?.settings.finestDivision).toBe(16);
      expect(service.state.refusal).toContain('6/8');
      expect(service.state.error).toBeNull();
      checkInvariants(states);
    });

    it('refuses a meter the current grid cannot write', async () => {
      await service.transcribe(wavFile());
      const derived = service.state.derived;

      // 16 slots to a /32 beat is half a slot: the same fault from the other
      // side, and reachable from a meter dropdown alone.
      service.updateTimeSignature({ numerator: 4, denominator: 32, isCommon: false });

      expect(service.state.phase).toBe('ready');
      expect(service.state.derived).toBe(derived!);
      expect(service.state.session?.grid.timeSignature.denominator).toBe(4);
      expect(service.state.refusal).toContain('4/32');
      checkInvariants(states);
    });

    it('stays usable: a legal change still applies and clears the refusal', async () => {
      await service.transcribe(wavFile(), SIX_EIGHT);
      service.updateSettings({ finestDivision: 4 });
      expect(service.state.refusal).not.toBeNull();

      // 8 does express a 6/8 bar, so this one goes through.
      service.updateSettings({ finestDivision: 8 });

      expect(service.state.refusal).toBeNull();
      expect(service.state.session?.settings.finestDivision).toBe(8);
      expect(struckFrets(service.state).length).toBeGreaterThan(0);
      expect(detector.calls).toBe(1);
      checkInvariants(states);
    });

    it('reports the refusal to subscribers rather than throwing at the caller', async () => {
      await service.transcribe(wavFile(), SIX_EIGHT);
      const before = states.length;

      expect(() => service.updateSettings({ finestDivision: 4 })).not.toThrow();

      // A state *was* pushed: a control that moved and produced nothing is the
      // failure this exists to prevent.
      expect(states.length).toBe(before + 1);
      expect(states[states.length - 1].refusal).toBeTruthy();
    });

    it('refuses an impossible meter up front, before decoding or detecting', async () => {
      // 4/32 against the default sixteenth grid. The run never starts, so the
      // fault is reported as the meter's rather than the file's.
      await expectAsync(
        service.transcribe(wavFile('walk.wav'), { numerator: 4, denominator: 32, isCommon: false })
      ).toBeResolved();

      expect(service.state.phase).toBe('failed');
      expect(service.state.error).toContain('4/32');
      expect(detector.calls).toBe(0);
      expect(service.busy).toBeFalse();
      checkInvariants(states);
    });
  });

  /**
   * The other half of the error contract, over the settings that describe a
   * neck.
   *
   * `capo`, `maxFret` and `positionHint` used to be checked nowhere: the
   * component tested `Number.isFinite` and the template carried a `min`/`max`,
   * which a typed or pasted value walks straight past. Capo 12 with maxFret 12
   * is reachable on the spinner arrows alone and collapses the score to a bar
   * of rests, because nothing but an open string is left playable.
   */
  describe('settings a neck cannot express', () => {
    it('refuses a capo that leaves no neck in front of it, keeping the score', async () => {
      await service.transcribe(wavFile());
      const derived = service.state.derived;
      expect(struckFrets(service.state).length).toBeGreaterThan(0);

      service.updateSettings({ capo: 12, maxFret: 12 });

      expect(service.state.phase).toBe('ready');
      expect(service.state.derived).toBe(derived!);
      expect(service.state.session?.settings.capo).toBe(0);
      expect(service.state.refusal).toContain('capo at 12');
      expect(service.state.error).toBeNull();
      expect(struckFrets(service.state).length).toBeGreaterThan(0);
      checkInvariants(states);
    });

    it('refuses a position hint that would dwarf every other cost', async () => {
      await service.transcribe(wavFile());
      const frets = struckFrets(service.state);

      // 0.5 * 1000 against movement costs in single figures: fingering
      // degenerates into "pick the highest fret" with nothing to say why.
      service.updateSettings({ positionHint: 1000 });

      expect(service.state.session?.settings.positionHint).toBeNull();
      expect(service.state.refusal).toContain('position hint');
      expect(struckFrets(service.state)).toEqual(frets);
    });

    it('refuses a neck longer than anything it can write', async () => {
      await service.transcribe(wavFile());

      service.updateSettings({ maxFret: 1e6 });

      expect(service.state.session?.settings.maxFret).toBe(24);
      expect(service.state.refusal).not.toBeNull();
    });

    it('refuses rather than clamping, so nothing is applied by halves', async () => {
      await service.transcribe(wavFile());

      // A legal capo travelling with an illegal max fret. Applying the half
      // that was fine would leave the state describing a change nobody made.
      service.updateSettings({ capo: 2, maxFret: 0 });

      expect(service.state.session?.settings.capo).toBe(0);
      expect(service.state.session?.settings.maxFret).toBe(24);
      expect(service.state.refusal).not.toBeNull();
    });

    it('stays usable: a legal neck still applies and clears the refusal', async () => {
      await service.transcribe(wavFile());
      service.updateSettings({ capo: 12, maxFret: 12 });
      expect(service.state.refusal).not.toBeNull();

      service.updateSettings({ capo: 5 });

      expect(service.state.refusal).toBeNull();
      expect(service.state.session?.settings.capo).toBe(5);
      expect(detector.calls).toBe(1);
      checkInvariants(states);
    });

    it('reports the refusal to subscribers rather than throwing at the caller', async () => {
      await service.transcribe(wavFile());
      const before = states.length;

      expect(() => service.updateSettings({ capo: 99 })).not.toThrow();

      expect(states.length).toBe(before + 1);
      expect(states[states.length - 1].refusal).toBeTruthy();
    });
  });

  describe('dropped notes', () => {
    it('surfaces what derivation discarded, so M3 need not recompute it', async () => {
      await service.transcribe(wavFile());
      // Two of the eighteen survivors are already under the default 0.3 floor
      // - the capture's weakest detections are 0.2648 and 0.28 - so this
      // starts at two rather than at nothing, and what the spec is about is
      // that it moves with the floor.
      expect(service.state.derived?.dropped.length).toBe(2);

      service.updateSettings({ confidenceFloor: 0.95 });

      const dropped = service.state.derived?.dropped ?? [];
      // A floor of 0.95 is above every confidence the detector reported on
      // this material, so derivation drops every note suppression handed it.
      expect(dropped.length).toBe(KEPT_COUNT);
      expect(dropped.every(entry => entry.reason === 'belowConfidence')).toBeTrue();
    });
  });

  /**
   * Ten of this fixture's twenty-eight detections are removed before derivation
   * ever sees them. Until M2's review they were removed and then unrecoverable:
   * `session.notes` was the post-suppression list, so the largest discard in
   * the pipeline was invisible to the mechanism `DerivedScore.dropped` exists
   * for.
   */
  describe('suppressed partials', () => {
    it('reports the partials it removed rather than dropping them silently', async () => {
      await service.transcribe(wavFile());

      const suppressed = service.state.suppressed;
      expect(suppressed.length).toBe(DETECTED.length - KEPT_COUNT);

      // This used to assert that the discard was *larger* than what survived -
      // twenty-six removed against eight kept - and that is no longer true on
      // any of the sixteen captured materials. It stopped being true when the
      // partial branch moved from a duration ratio to a confidence one: the
      // duration rule removed 62 of 92 candidate artefacts and took 20 of 28
      // real notes with them, so a great deal of what made that discard large
      // was the music. Ten of twenty-eight is what removing mostly artefacts
      // looks like. The claim worth keeping was never the size of the discard
      // but that none of it disappears silently, which is what the partition
      // below says.
      expect(suppressed.length).toBeGreaterThan(0);

      // Every one of them is a note the detector reported and derivation never
      // saw, so the two lists partition the detection with nothing left over.
      const kept = new Set(service.state.session?.notes.map(n => n.id));
      expect(suppressed.every(n => !kept.has(n.id))).toBeTrue();
      expect(suppressed.length + kept.size).toBe(DETECTED.length);
    });

    it('reports them in reading order, like the kept notes', async () => {
      await service.transcribe(wavFile());

      // An empty list is trivially sorted, so this has to say there is one.
      expect(service.state.suppressed.length).toBe(DETECTED.length - KEPT_COUNT);
      const onsets = service.state.suppressed.map(n => n.onsetSec);
      expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
    });

    it('keeps the raw detection on the session, undamaged by suppression', async () => {
      await service.transcribe(wavFile());

      const session = service.state.session;
      expect(session?.rawNotes.length).toBe(DETECTED.length);
      expect(session?.rawNotes.map(n => n.id)).toEqual(DETECTED.map(n => n.id));
      // Its own array: a detector that reused the one it returned could not
      // reach into the session through it.
      expect(session?.rawNotes).not.toBe(DETECTED);
    });

    it('carries both across a re-derivation', async () => {
      await service.transcribe(wavFile());
      const suppressed = service.state.suppressed;
      const rawNotes = service.state.session?.rawNotes;

      service.updateSettings({ capo: 3 });

      expect(service.state.suppressed).toBe(suppressed);
      expect(service.state.session?.rawNotes).toBe(rawNotes!);
      expect(detector.calls).toBe(1);
    });

    it('keeps the bend frame rate the detector reported', async () => {
      // `bendCents` is a list of numbers with no time axis without it, and the
      // rate rides on the detection result rather than on each note - so this
      // is the one place it can come to rest.
      await service.transcribe(wavFile());

      expect(service.state.session?.bendFrameRateHz).toBe(22050 / 256);
    });

    it('reports nothing when the detector reports no partials', async () => {
      detector.notes = DETECTED.filter(n => PLAYED_PITCHES.includes(n.pitch)).slice(0, 2);

      await service.transcribe(wavFile());

      expect(service.state.suppressed).toEqual([]);
      expect(service.state.phase).toBe('ready');
    });
  });

  /**
   * `updateTempo` and `nudgeDownbeat` are the two knobs that cannot be undone.
   *
   * The tracker measures every beat separately - the fixture comes back as
   * [0.49, 0.49, 0.51, 0.5, ...] - and `withTempo` replaces those measurements
   * with an even pulse, so typing the original BPM back gives an even grid
   * rather than the one that followed the performance. `nudgedDownbeat` drops
   * beats off the front for good. Nothing can rebuild either without re-running
   * the tracker, which means re-running suppression, which means the detector.
   *
   * So the tracked grid is kept. The control that offers it back is follow-up
   * work; the fact it preserves is destroyed at the first correction, which is
   * why the field cannot wait for the control.
   */
  describe('the tracked grid', () => {
    it('is what the tracker measured, and starts out the working grid', async () => {
      await service.transcribe(wavFile());

      const session = service.state.session;
      expect(session?.trackedGrid.beatsSec).toEqual(
        trackBeats(suppressHarmonics(DETECTED), session?.durationSec ?? 0, FOUR_FOUR).beatsSec
      );
      expect(session?.trackedGrid).toBe(session!.grid);
    });

    it('survives a tempo correction that replaced the working grid', async () => {
      await service.transcribe(wavFile());
      const tracked = service.state.session?.trackedGrid.beatsSec ?? [];
      expect(tracked.length).toBeGreaterThan(2);

      service.updateTempo(90);

      expect(service.state.session?.grid.beatsSec).not.toEqual(tracked);
      expect(service.state.session?.trackedGrid.beatsSec).toEqual(tracked);
    });

    it('survives a downbeat nudge, which drops beats for good', async () => {
      await service.transcribe(wavFile());
      const tracked = service.state.session?.trackedGrid.beatsSec ?? [];

      service.nudgeDownbeat(1);
      service.updateTempo(200);
      service.nudgeDownbeat(1);

      expect(service.state.session?.trackedGrid.beatsSec).toEqual(tracked);
    });

    it('survives an ordinary re-derivation', async () => {
      await service.transcribe(wavFile());
      const trackedGrid = service.state.session?.trackedGrid;

      service.updateSettings({ capo: 3 });
      service.updateTimeSignature({ numerator: 3, denominator: 4, isCommon: false });

      expect(service.state.session?.trackedGrid).toBe(trackedGrid!);
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
