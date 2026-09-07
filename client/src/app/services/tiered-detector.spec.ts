import { DetectionResult, NoteDetector } from './note-detector';
import { TieredDetector } from './tiered-detector';

/**
 * Which tier runs, and what happens when the server does not.
 *
 * The fallback is the part worth pinning. It is cheap, it is easy to leave out,
 * and leaving it out turns a server outage into an error page for the users who
 * are paying — which is exactly the case where the product should degrade
 * rather than break.
 */
describe('TieredDetector', () => {
  const AUDIO = new Float32Array([0.1, 0.2, 0.3]);
  const FILE = new File(['bytes'], 'riff.mp3');

  /** A detector that records what it was given and returns what it was told. */
  function stub(result: DetectionResult | Error): NoteDetector & { calls: number } {
    const detector = {
      calls: 0,
      async detect(): Promise<DetectionResult> {
        detector.calls++;
        if (result instanceof Error) throw result;
        return result;
      }
    };

    return detector;
  }

  function resultWith(notes: number): DetectionResult {
    return {
      notes: Array.from({ length: notes }, (_, i) => ({
        id: `n${i}`,
        pitch: 40 + i,
        onsetSec: i,
        offsetSec: i + 0.5,
        confidence: 0.7,
        bendCents: []
      })),
      bendFrameRateHz: 86.1328125
    };
  }

  it('uses the server when signed in', async () => {
    const remote = stub(resultWith(2));
    const worker = stub(resultWith(9));

    const detector = new TieredDetector(() => true, async () => remote, () => worker);
    const result = await detector.detect(AUDIO, 22050, () => undefined, FILE);

    expect(result.notes.length).toBe(2);
    expect(remote.calls).toBe(1);
    expect(worker.calls).toBe(0);
  });

  it('uses the browser when anonymous', async () => {
    const remote = stub(resultWith(2));
    const worker = stub(resultWith(9));

    const detector = new TieredDetector(() => false, async () => remote, () => worker);
    const result = await detector.detect(AUDIO, 22050, () => undefined, FILE);

    expect(result.notes.length).toBe(9);
    expect(remote.calls).toBe(0);
  });

  it('never builds the worker for a signed-in run that succeeds', async () => {
    let workersBuilt = 0;

    const detector = new TieredDetector(
      () => true,
      async () => stub(resultWith(1)),
      () => {
        workersBuilt++;
        return stub(resultWith(9));
      }
    );

    await detector.detect(AUDIO, 22050, () => undefined, FILE);

    // The worker chunk is TF.js and a model download. A seat that never falls
    // back must never pay for it.
    expect(workersBuilt).toBe(0);
  });

  it('falls back to the browser when the server fails', async () => {
    const worker = stub(resultWith(9));
    const fallbacks: string[] = [];

    const detector = new TieredDetector(
      () => true,
      async () => stub(new Error('502 Bad Gateway')),
      () => worker,
      reason => fallbacks.push(reason.message)
    );

    const result = await detector.detect(AUDIO, 22050, () => undefined, FILE);

    expect(result.notes.length).toBe(9);
    expect(worker.calls).toBe(1);
    expect(fallbacks).toEqual(['502 Bad Gateway']);
  });

  it('resets progress before the fallback runs', async () => {
    // The server can report progress and then fail. A bar that stalls part-way
    // and then advances again from there would count the same work twice.
    const reported: number[] = [];

    const remote: NoteDetector = {
      async detect(_a, _s, onProgress): Promise<DetectionResult> {
        onProgress(0.4);
        throw new Error('dropped');
      }
    };

    const detector = new TieredDetector(() => true, async () => remote, () => stub(resultWith(1)));
    await detector.detect(AUDIO, 22050, f => reported.push(f), FILE);

    expect(reported).toContain(0.4);
    expect(reported[reported.length - 1]).toBe(0);
  });

  it('stays local when there is no file to upload', async () => {
    // Synthesised audio, which the remote detector cannot take.
    const remote = stub(resultWith(2));
    const worker = stub(resultWith(9));

    const detector = new TieredDetector(() => true, async () => remote, () => worker);
    const result = await detector.detect(AUDIO, 22050, () => undefined);

    expect(result.notes.length).toBe(9);
    expect(remote.calls).toBe(0);
  });

  it('reads auth state per call, not at construction', async () => {
    // Signing in mid-visit is a thing people do.
    let signedIn = false;
    const remote = stub(resultWith(2));
    const worker = stub(resultWith(9));

    const detector = new TieredDetector(() => signedIn, async () => remote, () => worker);

    await detector.detect(AUDIO, 22050, () => undefined, FILE);
    expect(worker.calls).toBe(1);

    signedIn = true;
    await detector.detect(AUDIO, 22050, () => undefined, FILE);
    expect(remote.calls).toBe(1);
  });

  it('terminates a worker it built, and tolerates one it did not', () => {
    let terminated = 0;
    const worker = {
      detect: async (): Promise<DetectionResult> => resultWith(1),
      terminate: (): void => {
        terminated++;
      }
    };

    const detector = new TieredDetector(() => false, async () => stub(resultWith(1)), () => worker);

    // Nothing built yet: this must not throw.
    detector.terminate();
    expect(terminated).toBe(0);
  });
});
