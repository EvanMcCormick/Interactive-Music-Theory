/**
 * Turns an uploaded audio file into the mono 22.05 kHz signal the note
 * detector expects.
 *
 * `decodeAudioData` handles every container the browser can play, which is why
 * decoding goes through Web Audio rather than a parser of our own. Three
 * measured facts shape how it is used, and all three are easy to get wrong:
 *
 * **1. `decodeAudioData` resamples to the decoding context's rate.** It is not
 * a pure decoder. A 44.1 kHz file decoded in a default `AudioContext` on a
 * 48 kHz device comes back as a 48 kHz buffer. So the decoding context is
 * created *at the target rate*, and the decoder's own resampler — a properly
 * band-limited one — does the rate conversion as part of decoding.
 *
 * **2. Resampling by playing a buffer into a differently-rated
 * `OfflineAudioContext` aliases.** It is the obvious way to do this and it is
 * wrong: `AudioBufferSourceNode` interpolates without a low-pass, so
 * downsampling folds everything above the new Nyquist back into the band. A
 * 15 kHz tone taken from 44.1 kHz to 22.05 kHz that way survives at 0.41 RMS —
 * mirrored to 7 kHz, near full strength — against 0.00006 when the decoder
 * does the conversion. Feeding that to a pitch detector would invent notes.
 * The `OfflineAudioContext` here therefore runs at the *same* rate as the
 * decode and does nothing but the downmix, where its speaker-layout mixing
 * rules are worth having: stereo averages to `0.5 * (L + R)` and higher layouts
 * fold down with the standard coefficients, which a hand-rolled channel
 * average would get wrong for anything beyond stereo.
 *
 * **3. Nothing in Web Audio will tell you the file's own sample rate.** Point 1
 * means the decoded buffer reports the context's rate, whatever the file held.
 * Since that number is worth reporting, it is read from the container header
 * instead — which works for RIFF/WAVE and no other format, so
 * `sourceSampleRate` is 0 when the file is anything else. Reading it has to
 * happen *before* decoding, because `decodeAudioData` detaches the buffer it is
 * given.
 *
 * The decoding `AudioContext` is closed in a `finally`, including when the
 * decode fails. Browsers cap how many a page may hold and M3's review UI
 * decodes repeatedly. This is a short-lived context used purely as a decoder
 * and is unrelated to the single long-lived Tone.js context the app plays
 * through.
 */

// Basic Pitch's input rate: 22.05 kHz mono. Imported rather than declared a
// second time here: what this module resamples *to* and what the detector
// checks its input *against* are two ends of one contract, and as two
// constants they had to agree with nothing linking them.
import { DETECTION_SAMPLE_RATE } from './note-detector';

export interface DecodedAudio {
  audio: Float32Array;
  durationSec: number;
  /**
   * Sample rate of the file before resampling, for reporting. Read from the
   * container header, which only works for WAV: 0 means the format did not say
   * and the browser would not, not that the file had no rate.
   */
  sourceSampleRate: number;
}

/**
 * Decodes `data` to a single channel at `targetRate`.
 *
 * Takes ownership of `data`: decoding detaches the buffer, so the caller cannot
 * reuse it afterwards. That is deliberate — copying a four-minute stem to avoid
 * it would double the peak memory for nothing.
 *
 * Rejects if the browser cannot decode the data.
 */
export async function decodeToMono(
  data: ArrayBuffer,
  targetRate: number = DETECTION_SAMPLE_RATE
): Promise<DecodedAudio> {
  // Before decoding, which detaches the buffer.
  const sourceSampleRate = readRiffSampleRate(data);

  const decoded = await decodeAtRate(data, targetRate);
  const durationSec = decoded.duration;

  // Same rate as the decode, so this pass only mixes channels together. The
  // frame count is derived from the duration rather than read off `decoded`
  // so that it agrees exactly with what a caller computes from `durationSec`.
  const mixer = new OfflineAudioContext(1, Math.ceil(durationSec * targetRate), targetRate);
  const source = mixer.createBufferSource();
  source.buffer = decoded;
  source.connect(mixer.destination);
  source.start();
  const mono = await mixer.startRendering();

  return { audio: mono.getChannelData(0), durationSec, sourceSampleRate };
}

/**
 * Decodes at `sampleRate`, letting the decoder's band-limited resampler do the
 * rate conversion, and closes the context whatever happens.
 */
async function decodeAtRate(data: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  const context = new AudioContext({ sampleRate });
  try {
    return await context.decodeAudioData(data);
  } finally {
    // Best effort: a failure to close is not worth replacing a decode error
    // the caller can actually act on.
    await context.close().catch(() => undefined);
  }
}

/**
 * Sample rate declared by a RIFF/WAVE header, or 0 if `data` is not a WAV.
 *
 * `fmt ` is the first chunk in practically every WAV ever written, but the
 * chunks are walked rather than assumed: an editor is free to put `LIST` or
 * anything else in front of it.
 */
function readRiffSampleRate(data: ArrayBuffer): number {
  const view = new DataView(data);
  const CHUNKS_START = 12;
  if (view.byteLength < CHUNKS_START) return 0;
  if (readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') return 0;

  let offset = CHUNKS_START;
  while (offset + 8 <= view.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') {
      // Format tag, channel count, then the sample rate: bytes 8-11 of the
      // chunk's body.
      if (offset + 16 > view.byteLength) return 0;
      return view.getUint32(offset + 12, true);
    }

    // Chunk bodies are padded to an even length, and the pad byte is not
    // counted in the size.
    offset += 8 + size + (size % 2);
  }

  return 0;
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}
