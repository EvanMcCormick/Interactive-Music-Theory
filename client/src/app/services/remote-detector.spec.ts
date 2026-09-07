import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { RemoteDetector } from './remote-detector';

/**
 * The HTTP contract, and the two things about it that are easy to get wrong.
 *
 * The first is the content-address hit: a file the server has seen before comes
 * back `Succeeded` from the POST itself, and waiting on a hub for a job that has
 * already finished would hang until the timeout. The second is that a failed job
 * has to reject, because `TieredDetector` only falls back to the browser if this
 * throws.
 *
 * SignalR is not exercised here. It is a courtesy channel that this class treats
 * as optional by design — every path below completes on polling alone, which is
 * exactly the behaviour a blocked WebSocket produces in production.
 */
describe('RemoteDetector', () => {
  const API = `${environment.apiUrl}/api/transcriptions`;
  const AUDIO = new Float32Array([0.1, 0.2]);
  const FILE = new File(['bytes'], 'riff.mp3');

  let http: HttpClient;
  let controller: HttpTestingController;
  let detector: RemoteDetector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);

    // Enough of AuthService for the hub's token factory, which never runs here.
    const auth = { accessToken: 'token', isAuthenticated: true } as AuthService;

    // No socket. This is the path a user behind a WebSocket-blocking proxy
    // gets, and the class is built to complete on polling alone.
    detector = new RemoteDetector(http, auth, () => {
      throw new Error('no hub in tests');
    });
  });

  afterEach(() => controller.verify());

  /**
   * Lets the detector's own `await` continuations run.
   *
   * `flush` resolves the observable, but everything the detector does next is a
   * microtask, so a bare `expectOne` on the following line looks before the
   * request has been made.
   */
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  it('returns the detections when the audio was transcribed before', async () => {
    const running = detector.detect(AUDIO, 22050, () => undefined, FILE);

    const post = controller.expectOne(API);
    expect(post.request.method).toBe('POST');
    expect(post.request.body instanceof FormData).toBeTrue();

    // A cache hit: the server already has this content hash.
    post.flush({ jobId: 'job-1', contentHash: 'abc', status: 'Succeeded' });
    await settle();

    const get = controller.expectOne(`${API}/job-1`);
    get.flush({
      jobId: 'job-1',
      status: 'Succeeded',
      progress: 1,
      error: null,
      notes: [
        {
          id: 'bp-0',
          pitch: 45,
          onsetSec: 0.5,
          offsetSec: 1.2,
          confidence: 0.8,
          bendCents: [0, 33.33]
        }
      ],
      bendFrameRateHz: 86.1328125,
      durationSec: 12.5
    });

    const result = await running;

    expect(result.notes.length).toBe(1);
    expect(result.notes[0].pitch).toBe(45);
    expect(result.bendFrameRateHz).toBe(86.1328125);
  });

  it('reports 1 for a cache hit without ever waiting', async () => {
    const reported: number[] = [];
    const running = detector.detect(AUDIO, 22050, f => reported.push(f), FILE);

    controller.expectOne(API).flush({ jobId: 'job-1', contentHash: 'abc', status: 'Succeeded' });
    await settle();
    controller.expectOne(`${API}/job-1`).flush(succeeded());

    await running;

    expect(reported[reported.length - 1]).toBe(1);
  });

  it('rejects when the job fails, so the caller can fall back', async () => {
    const running = detector.detect(AUDIO, 22050, () => undefined, FILE);

    controller.expectOne(API).flush({ jobId: 'job-1', contentHash: 'abc', status: 'Queued' });
    await settle();

    // The first poll finds it already failed.
    controller.expectOne(`${API}/job-1`).flush({
      jobId: 'job-1',
      status: 'Failed',
      progress: 0,
      error: 'Unsupported audio format.',
      notes: null,
      bendFrameRateHz: null,
      durationSec: null
    });

    await expectAsync(running).toBeRejectedWithError(/Unsupported audio format/);
  });

  it('rejects when the upload itself is refused', async () => {
    const running = detector.detect(AUDIO, 22050, () => undefined, FILE);

    controller.expectOne(API).flush(
      { error: 'Audio is larger than the 50 MB limit.' },
      { status: 400, statusText: 'Bad Request' }
    );

    await expectAsync(running).toBeRejectedWithError(/50 MB limit/);
  });

  it('refuses synthesised audio rather than uploading the wrong thing', async () => {
    await expectAsync(
      detector.detect(AUDIO, 22050, () => undefined)
    ).toBeRejectedWithError(/needs the original file/);
  });

  function succeeded(): Record<string, unknown> {
    return {
      jobId: 'job-1',
      status: 'Succeeded',
      progress: 1,
      error: null,
      notes: [],
      bendFrameRateHz: 86.1328125,
      durationSec: 1
    };
  }
});
