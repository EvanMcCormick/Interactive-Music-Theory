import { DecodedAudio, decodeToMono } from './audio-decode';
import { DETECTION_SAMPLE_RATE } from './note-detector';

/**
 * Builds a RIFF/WAVE file in memory: the 44-byte canonical header plus 16-bit
 * signed PCM. `samples` is interleaved, so a stereo file is L R L R ...
 */
function makeWav(samples: Float32Array, sampleRate: number, channels: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size for PCM
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return buffer;
}

/**
 * Splices a chunk in ahead of `fmt `, the way an editor that writes metadata
 * does. `bodyBytes` is the declared size; an odd one is padded, and the pad byte
 * is not counted in it.
 */
function withLeadingChunk(wav: ArrayBuffer, id: string, bodyBytes: number): ArrayBuffer {
  const inserted = 8 + bodyBytes + (bodyBytes % 2);
  const out = new ArrayBuffer(wav.byteLength + inserted);
  const source = new Uint8Array(wav);
  const target = new Uint8Array(out);
  const view = new DataView(out);

  target.set(source.subarray(0, 12), 0);
  for (let i = 0; i < 4; i++) view.setUint8(12 + i, id.charCodeAt(i));
  view.setUint32(16, bodyBytes, true);
  target.set(source.subarray(12), 12 + inserted);
  view.setUint32(4, view.getUint32(4, true) + inserted, true);

  return out;
}

/** A sine at `freq`, sampled at `rate` for `seconds`. */
function tone(freq: number, seconds: number, rate: number, amplitude = 0.8): Float32Array {
  const frames = Math.round(seconds * rate);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

function interleave(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    out[i * 2] = left[i];
    out[i * 2 + 1] = right[i];
  }
  return out;
}

/** RMS over the middle half, which skips any edge transient from the resampler. */
function rms(data: Float32Array): number {
  const from = Math.floor(data.length * 0.25);
  const to = Math.floor(data.length * 0.75);
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
}

/**
 * Frequency of a roughly sinusoidal signal, from rising zero crossings over the
 * middle half. A Schmitt trigger rather than a bare sign test, so ripple around
 * zero cannot be counted as a cycle. Enough to tell 440 Hz from the 880 Hz a
 * skipped resample would produce, which is all this needs to do.
 */
function measuredFrequency(data: Float32Array, sampleRate: number): number {
  const from = Math.floor(data.length * 0.25);
  const to = Math.floor(data.length * 0.75);
  const threshold = 0.05;
  let armed = false;
  let crossings = 0;

  for (let i = from; i < to; i++) {
    if (data[i] < -threshold) armed = true;
    else if (armed && data[i] > threshold) {
      crossings++;
      armed = false;
    }
  }

  return crossings / ((to - from) / sampleRate);
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

/**
 * Runs `work` with the global `AudioContext` swapped for a subclass that records
 * every instance, and hands back what was opened. Browsers cap how many hardware
 * contexts a page may hold, but this Chrome's cap is high enough — twenty-five
 * opened without complaint while this was written — that decoding in a loop
 * would not on its own prove the module closes anything. Each context's own
 * `state` does.
 */
async function whileTrackingContexts(work: () => Promise<void>): Promise<AudioContext[]> {
  const globals = window as unknown as { AudioContext: AudioContextCtor };
  const RealAudioContext = globals.AudioContext;
  const opened: AudioContext[] = [];

  class TrackedAudioContext extends RealAudioContext {
    constructor(options?: AudioContextOptions) {
      super(options);
      opened.push(this);
    }
  }

  globals.AudioContext = TrackedAudioContext;
  try {
    await work();
  } finally {
    globals.AudioContext = RealAudioContext;
  }

  return opened;
}

describe('decodeToMono', () => {
  it('resamples a 44.1 kHz file down to the target rate', async () => {
    const decoded: DecodedAudio = await decodeToMono(makeWav(tone(440, 1, 44100), 44100, 1));

    expect(decoded.audio.length).toBe(Math.ceil(decoded.durationSec * DETECTION_SAMPLE_RATE));
    // Half the frames of the file it came from: a real resample, not the
    // decoded buffer handed straight back.
    expect(decoded.audio.length).toBe(22050);
  });

  it('reports the duration it decoded, on a length that does not divide evenly', async () => {
    // 0.75 s at 44.1 kHz is 33075 frames, which is 16537.5 frames at 22.05 kHz.
    const decoded = await decodeToMono(makeWav(tone(440, 0.75, 44100), 44100, 1));

    expect(decoded.durationSec).toBeCloseTo(0.75, 3);
    expect(decoded.audio.length).toBe(Math.ceil(decoded.durationSec * DETECTION_SAMPLE_RATE));
  });

  it('keeps the pitch of a tone through the resample', async () => {
    // Dropping every other sample instead of filtering would read back as
    // 880 Hz, and so would copying the buffer into a half-rate one.
    const decoded = await decodeToMono(makeWav(tone(440, 1, 44100), 44100, 1));

    expect(measuredFrequency(decoded.audio, DETECTION_SAMPLE_RATE)).toBeCloseTo(440, -0.5);
  });

  it('does not fold content above the target Nyquist back into the band', async () => {
    // 15 kHz cannot exist at 22.05 kHz. A rate conversion with no low-pass
    // mirrors it to 7050 Hz at nearly full amplitude rather than removing it,
    // which is exactly what an AudioBufferSourceNode rate change does.
    const decoded = await decodeToMono(makeWav(tone(15000, 0.5, 44100), 44100, 1));

    expect(rms(decoded.audio)).toBeLessThan(0.02);
  });

  it('averages the channels of a stereo file rather than taking one', async () => {
    const left = tone(440, 0.5, 44100);
    const silence = new Float32Array(left.length);
    const stereo = await decodeToMono(makeWav(interleave(left, silence), 44100, 2));
    const mono = await decodeToMono(makeWav(left, 44100, 1));

    expect(stereo.audio.length).toBe(mono.audio.length);
    expect(rms(stereo.audio)).toBeCloseTo(rms(mono.audio) / 2, 2);
    // Taking the left channel would hand the mono level back untouched.
    expect(rms(stereo.audio)).toBeLessThan(rms(mono.audio) * 0.75);
  });

  it('cancels a stereo file whose channels are exact opposites', async () => {
    // The sharpest form of the same question: L and -L average to nothing, and
    // to full level if either channel is simply picked.
    const left = tone(440, 0.5, 44100);
    const right = left.map(sample => -sample);
    const decoded = await decodeToMono(makeWav(interleave(left, right), 44100, 2));

    expect(rms(decoded.audio)).toBeLessThan(0.01);
  });

  it('reports the sample rate of the file, not the target', async () => {
    const at441 = await decodeToMono(makeWav(tone(440, 0.2, 44100), 44100, 1));
    const at48 = await decodeToMono(makeWav(tone(440, 0.2, 48000), 48000, 1));

    expect(at441.sourceSampleRate).toBe(44100);
    expect(at48.sourceSampleRate).toBe(48000);
    expect(at441.sourceSampleRate).not.toBe(DETECTION_SAMPLE_RATE);
  });

  it('finds the sample rate behind a chunk that comes before the format chunk', async () => {
    // An odd-sized JUNK chunk, so the pad byte has to be accounted for too.
    const wav = withLeadingChunk(makeWav(tone(440, 0.2, 44100), 44100, 1), 'JUNK', 3);
    const decoded = await decodeToMono(wav);

    expect(decoded.sourceSampleRate).toBe(44100);
    expect(decoded.audio.length).toBe(Math.ceil(decoded.durationSec * DETECTION_SAMPLE_RATE));
  });

  it('honours an explicit target rate', async () => {
    const decoded = await decodeToMono(makeWav(tone(440, 0.5, 44100), 44100, 1), 16000);

    expect(decoded.audio.length).toBe(Math.ceil(decoded.durationSec * 16000));
    expect(decoded.audio.length).toBe(8000);
    expect(decoded.sourceSampleRate).toBe(44100);
  });

  it('rejects data that is not audio', async () => {
    const notAudio = new TextEncoder().encode('this is not a sound file').buffer;

    await expectAsync(decodeToMono(notAudio)).toBeRejected();
  });

  it('decodes twenty files in a row', async () => {
    // Browsers cap how many AudioContexts a page may hold, and M3's review UI
    // decodes repeatedly. Twenty in sequence has to simply work.
    for (let i = 0; i < 20; i++) {
      const decoded = await decodeToMono(makeWav(tone(220 + i, 0.1, 44100), 44100, 1));
      expect(decoded.audio.length).toBe(Math.ceil(decoded.durationSec * DETECTION_SAMPLE_RATE));
    }
  });

  it('closes every AudioContext it opens', async () => {
    const opened = await whileTrackingContexts(async () => {
      for (let i = 0; i < 20; i++) {
        await decodeToMono(makeWav(tone(220, 0.05, 44100), 44100, 1));
      }
    });

    expect(opened.length).toBe(20);
    for (const context of opened) expect(context.state).toBe('closed');
  });

  it('closes the AudioContext even when the decode fails', async () => {
    const opened = await whileTrackingContexts(async () => {
      const notAudio = new TextEncoder().encode('still not a sound file').buffer;
      await expectAsync(decodeToMono(notAudio)).toBeRejected();
    });

    expect(opened.length).toBe(1);
    expect(opened[0].state).toBe('closed');
  });
});
