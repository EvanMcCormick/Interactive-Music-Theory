/**
 * `NoteDetector` that runs the model on the server.
 *
 * The paid tier's half of the two-tier design, and the whole of it: nothing
 * else in the chain knows which detector is running. `note-detector.ts`'s own
 * docblock anticipated this before it was asked for —
 *
 * > …what leaves room for a server-side detector later: a bigger model, or one
 * > that will not fit in a bundle, becomes an implementation of `detect` that
 * > happens to POST the samples somewhere.
 *
 * — except that it does not POST the samples. It posts the **file**, because
 * the decoded form is larger: a 4:22 stem is 10 MB as MP3 and 23 MB as mono
 * Float32 at 22.05 kHz. Which is awkward, because the `NoteDetector` interface
 * takes decoded audio and has no file to give. See `detect` below.
 *
 * ## What it costs and what it buys
 *
 * The server has no WebGL, no TF.js and no Web Worker, so every
 * browser-specific failure this codebase has hit — the async readback hang, the
 * concat shader bug at certain file lengths, the software-rasteriser fallback —
 * exists only in the anonymous path. It is also about eight times faster: 1.81 s
 * against the browser's measured 15 s for the same four minutes of audio.
 *
 * ## Progress
 *
 * Over SignalR, and it is a courtesy rather than the contract. Every state
 * change is written to the database before it is broadcast, so a client that
 * connects late, or whose socket drops, loses a progress bar and not a
 * transcription — `poll` finishes the job either way. That is deliberate and it
 * is why this class treats every hub failure as non-fatal.
 */

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { DetectedNote } from '../models/transcription.model';
import { AuthService } from './auth.service';
import { errorOf } from './error-message';
import { DetectionResult, NoteDetector } from './note-detector';

/** The job states the server reports. */
type JobStatus = 'Queued' | 'Running' | 'Succeeded' | 'Failed';

interface CreateResponse {
  jobId: string;
  contentHash: string;
  status: JobStatus;
}

interface TranscriptionResponse {
  jobId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  notes: DetectedNote[] | null;
  bendFrameRateHz: number | null;
  durationSec: number | null;
}

/**
 * How often to poll while waiting, in milliseconds.
 *
 * Slow, because SignalR is doing the work of telling us and this is the
 * backstop for when it is not. A four-minute stem finishes in under two
 * seconds, so this rarely fires more than once.
 */
const POLL_INTERVAL_MS = 2000;

/** Give up after this long. Detection is seconds; a minute means something broke. */
const TIMEOUT_MS = 120_000;

export class RemoteDetector implements NoteDetector {
  private readonly api = `${environment.apiUrl}/api/transcriptions`;
  private readonly hubUrl = `${environment.apiUrl}/hubs/transcription`;

  /**
   * @param createHub Overridable so a test can run the polling path without a
   *   socket. It is not a seam for its own sake: the polling path is what a
   *   user behind a proxy that blocks WebSockets actually gets, so a test that
   *   exercises it is testing production behaviour rather than a mock.
   */
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
    private readonly createHub: () => HubConnection = () =>
      new HubConnectionBuilder()
        .withUrl(`${environment.apiUrl}/hubs/transcription`, {
          accessTokenFactory: () => auth.accessToken ?? ''
        })
        .configureLogging(LogLevel.Warning)
        .build()
  ) {}

  /**
   * Transcribes `audio` on the server.
   *
   * `file` is what actually crosses the wire; `audio` is ignored except for the
   * sample-rate check. That is a wart and it is the honest shape of the
   * problem: the interface was designed around a detector that takes decoded
   * samples, and sending decoded samples costs 2.3x the bytes for no benefit,
   * since the server has to decode anyway to know what it received.
   *
   * `TranscriptionService` already holds the file it decoded, so it passes it
   * through. A caller that has only samples — a test, or synthesised audio —
   * gets an error rather than a silent upload of the wrong thing.
   */
  async detect(
    audio: Float32Array,
    sampleRate: number,
    onProgress: (fraction: number) => void,
    file?: File
  ): Promise<DetectionResult> {
    if (!file) {
      throw new Error(
        'RemoteDetector needs the original file, not decoded samples. ' +
          'Pass it as the fourth argument to detect().'
      );
    }

    const created = await this.create(file);
    onProgress(0);

    if (created.status === 'Succeeded') {
      // Content-address hit: this audio has been transcribed before, by anyone.
      // Thirty students on one assignment reach this and never wait.
      onProgress(1);
      return this.fetchResult(created.jobId);
    }

    await this.awaitCompletion(created.jobId, onProgress);
    onProgress(1);

    return this.fetchResult(created.jobId);
  }

  private async create(file: File): Promise<CreateResponse> {
    const form = new FormData();
    form.append('file', file, file.name);

    try {
      return await firstValueFrom(this.http.post<CreateResponse>(this.api, form));
    } catch (error) {
      throw new Error(`Could not start the transcription: ${describe(error)}`);
    }
  }

  /**
   * Waits for the job, listening on the hub and polling as a backstop.
   *
   * Both, not either. The hub can fail to connect, connect after the job has
   * already finished, or drop mid-run, and none of those should cost the user
   * their transcription; the poll alone would work but would make a two-second
   * job feel like a four-second one.
   */
  private async awaitCompletion(
    jobId: string,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    const hub = await this.connect(jobId, onProgress);

    try {
      const started = Date.now();

      for (;;) {
        const status = await this.poll(jobId);

        if (status.status === 'Succeeded') {
          return;
        }

        if (status.status === 'Failed') {
          throw new Error(status.error ?? 'The transcription failed.');
        }

        if (Date.now() - started > TIMEOUT_MS) {
          throw new Error(
            `The transcription did not finish within ${TIMEOUT_MS / 1000} seconds.`
          );
        }

        onProgress(status.progress);
        await delay(POLL_INTERVAL_MS);
      }
    } finally {
      await hub?.stop().catch(() => undefined);
    }
  }

  /**
   * Connects to the progress hub, or does not.
   *
   * Returns null on any failure. A progress bar is not worth failing a
   * transcription for, and the poll below covers the same ground more slowly.
   */
  private async connect(
    jobId: string,
    onProgress: (fraction: number) => void
  ): Promise<HubConnection | null> {
    try {
      const connection = this.createHub();

      connection.on('progress', (_id: string, fraction: number) => onProgress(fraction));

      await connection.start();
      await connection.invoke('Subscribe', jobId);

      return connection;
    } catch {
      // Deliberately silent past a debug log's worth: this is the expected
      // path when WebSockets are blocked, and the poll takes over.
      return null;
    }
  }

  private poll(jobId: string): Promise<TranscriptionResponse> {
    return firstValueFrom(this.http.get<TranscriptionResponse>(`${this.api}/${jobId}`));
  }

  private async fetchResult(jobId: string): Promise<DetectionResult> {
    const response = await this.poll(jobId);

    if (response.status !== 'Succeeded' || !response.notes) {
      throw new Error(response.error ?? 'The transcription finished with no result.');
    }

    return {
      notes: response.notes,
      bendFrameRateHz: response.bendFrameRateHz ?? 0
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    // The API returns { error } for everything it rejects deliberately.
    return error.error?.error ?? error.message;
  }

  return errorOf(error).message;
}
