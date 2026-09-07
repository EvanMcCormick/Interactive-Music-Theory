/**
 * SPIKE (feasibility, not a feature): does a *separated* bass still transcribe?
 *
 * The product today takes an already-isolated bass stem. Source separation
 * would let it take a song instead. The question this file answers is whether
 * that trade is worth making: separation output is not an isolated stem, it is
 * a masked mixture, and the pipeline's accuracy on one says nothing about the
 * other.
 *
 * ## Why there is no separator here
 *
 * Every pretrained separator whose weights we could legally ship is either
 * blocked or unresolved (see the spike report). So instead of one third-party
 * checkpoint, this measures the **ceiling** that *any* masking separator -
 * Spleeter, Open-Unmix, MDX-Net - is bounded by, plus calibrated points below
 * it.
 *
 * A masking separator does exactly this at inference: predict a real-valued
 * magnitude mask, multiply the mixture's magnitude by it, and invert using the
 * **mixture's phase**. The best mask any of them could possibly predict is the
 * ideal ratio mask, |B| / (|B| + |R|), computed from the true sources. Feed
 * that through the same mixture-phase inversion and you get the best output the
 * whole model class can produce. If transcription degrades there, no amount of
 * model shopping fixes it.
 *
 * ## The four conditions
 *
 *   clean     the bass stem alone - what the product is handed today
 *   mix       the full mix, no separation - the control that decides whether
 *             separation buys anything at all
 *   oracle    ideal ratio mask + mixture phase - the ceiling
 *   realistic oracle mask degraded to a target SI-SDR, by bisection
 *
 * `realistic` is calibrated to published musdb18 bass SI-SDR: ~5.5 dB for
 * Spleeter/Open-Unmix-class masking models, ~9 dB for Demucs-class.
 *
 * All audio is synthesised from this repo's own Karplus-Strong string model
 * plus noise-based drums written here. Nothing copyrighted is involved.
 *
 * Run:  npx ng test --configuration=separation --watch=false
 */

import { BasicPitchDetector } from '../basic-pitch-detector';
import { DETECTION_SAMPLE_RATE } from '../note-detector';
import { suppressHarmonics } from '../transcription-harmonics';
import { MATERIAL, notesDurationSec, renderNotes } from './material';
import type { GroundTruthNote, Material } from './material';
import { pct, score, totals } from './note-matching';
import type { Scores } from './note-matching';

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

const RATE = DETECTION_SAMPLE_RATE;      // 22050
const FFT = 2048;                        // 92.9 ms - Spleeter's 4096 @ 44.1 kHz
const HOP = 512;                         // 23.2 ms - Spleeter's 1024 @ 44.1 kHz

// ---------------------------------------------------------------- FFT / STFT

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

const HANN = (() => {
  const w = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT);
  return w;
})();

interface Stft { re: Float64Array[]; im: Float64Array[]; frames: number; bins: number; length: number }

function stft(x: Float32Array): Stft {
  const bins = FFT / 2 + 1;
  const frames = Math.max(1, Math.ceil((x.length + FFT) / HOP));
  const re: Float64Array[] = [], im: Float64Array[] = [];
  const br = new Float64Array(FFT), bi = new Float64Array(FFT);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - FFT / 2;          // centred
    br.fill(0); bi.fill(0);
    for (let i = 0; i < FFT; i++) {
      const s = start + i;
      br[i] = s >= 0 && s < x.length ? x[s] * HANN[i] : 0;
    }
    fft(br, bi);
    re.push(br.slice(0, bins)); im.push(bi.slice(0, bins));
  }
  return { re, im, frames, bins, length: x.length };
}

function istft(s: Stft): Float32Array {
  const out = new Float64Array(s.length + FFT);
  const wsum = new Float64Array(s.length + FFT);
  const br = new Float64Array(FFT), bi = new Float64Array(FFT);
  for (let f = 0; f < s.frames; f++) {
    br.fill(0); bi.fill(0);
    for (let k = 0; k < s.bins; k++) { br[k] = s.re[f][k]; bi[k] = s.im[f][k]; }
    for (let k = 1; k < FFT / 2; k++) {           // hermitian mirror
      br[FFT - k] = s.re[f][k]; bi[FFT - k] = -s.im[f][k];
    }
    ifft(br, bi);
    const start = f * HOP - FFT / 2;
    for (let i = 0; i < FFT; i++) {
      const t = start + i;
      if (t < 0 || t >= out.length) continue;
      out[t] += br[i] * HANN[i];
      wsum[t] += HANN[i] * HANN[i];
    }
  }
  const y = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) y[i] = wsum[i] > 1e-8 ? out[i] / wsum[i] : 0;
  return y;
}

// --------------------------------------------------------------- separation

type Mask = Float64Array[];

/** Ideal ratio mask: the best any magnitude-masking separator could predict. */
function idealRatioMask(target: Stft, rest: Stft): Mask {
  const m: Mask = [];
  for (let f = 0; f < target.frames; f++) {
    const row = new Float64Array(target.bins);
    for (let k = 0; k < target.bins; k++) {
      const b = Math.hypot(target.re[f][k], target.im[f][k]);
      const r = Math.hypot(rest.re[f][k], rest.im[f][k]);
      row[k] = b + r > 1e-12 ? b / (b + r) : 0;
    }
    m.push(row);
  }
  return m;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A time-frequency-smooth random field. Smoothing matters: white mask noise
 * sounds like dither and barely touches a detector, whereas a separator's
 * errors are correlated blobs in the TF plane - which is what "musical noise"
 * and smearing actually are.
 */
function smoothField(frames: number, bins: number, seed: number): Float64Array[] {
  const raw: Float64Array[] = [];
  const rnd = mulberry32(seed);
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(bins);
    for (let k = 0; k < bins; k++) row[k] = rnd() * 2 - 1;
    raw.push(row);
  }
  const R = 3;   // ~70 ms x ~65 Hz correlation blobs
  const out: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      let sum = 0, n = 0;
      for (let df = -R; df <= R; df++) {
        const ff = f + df; if (ff < 0 || ff >= frames) continue;
        for (let dk = -R; dk <= R; dk++) {
          const kk = k + dk; if (kk < 0 || kk >= bins) continue;
          sum += raw[ff][kk]; n++;
        }
      }
      row[k] = (sum / n) * Math.sqrt(n);   // keep unit-ish variance
    }
    out.push(row);
  }
  return out;
}

function applyMask(mix: Stft, mask: Mask): Float32Array {
  const out: Stft = {
    re: mix.re.map((r, f) => r.map((v, k) => v * mask[f][k]) as Float64Array),
    im: mix.im.map((r, f) => r.map((v, k) => v * mask[f][k]) as Float64Array),
    frames: mix.frames, bins: mix.bins, length: mix.length,
  };
  return istft(out);
}

/** Scale-invariant SDR in dB: the standard separation-quality number. */
function siSdr(estimate: Float32Array, reference: Float32Array): number {
  let dot = 0, refE = 0;
  const n = Math.min(estimate.length, reference.length);
  for (let i = 0; i < n; i++) { dot += estimate[i] * reference[i]; refE += reference[i] * reference[i]; }
  if (refE < 1e-20) return -Infinity;
  const a = dot / refE;
  let sE = 0, eE = 0;
  for (let i = 0; i < n; i++) {
    const s = a * reference[i];
    const e = estimate[i] - s;
    sE += s * s; eE += e * e;
  }
  return eE < 1e-20 ? Infinity : 10 * Math.log10(sE / eE);
}

/** Degrade the oracle mask until the reconstruction hits `targetDb`. */
function degradeToSdr(
  mix: Stft, oracle: Mask, bass: Float32Array, targetDb: number, seed: number
): { audio: Float32Array; sdr: number; alpha: number } {
  const field = smoothField(mix.frames, mix.bins, seed);
  const at = (alpha: number): { audio: Float32Array; sdr: number } => {
    const m: Mask = oracle.map((row, f) => {
      const r = new Float64Array(row.length);
      for (let k = 0; k < row.length; k++) {
        // Multiplicative-in-log perturbation, clipped to a valid mask.
        r[k] = Math.min(1, Math.max(0, row[k] + alpha * field[f][k]));
      }
      return r;
    });
    const audio = applyMask(mix, m);
    return { audio, sdr: siSdr(audio, bass) };
  };
  let lo = 0, hi = 1.5;
  let best = at(hi);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const r = at(mid);
    if (r.sdr > targetDb) lo = mid; else hi = mid;
    best = r;
  }
  return { audio: best.audio, sdr: best.sdr, alpha: (lo + hi) / 2 };
}

// --------------------------------------------------------- the accompaniment

/**
 * A chord bed and a drum kit, so the mixture has something for the mask to be
 * wrong about. The chords sit in the guitar/keys register and their low
 * partials overlap the bass; the kick overlaps its fundamental, which is the
 * case every bass separator actually struggles with.
 */
function accompaniment(durationSec: number, seed: number): Float32Array {
  const n = Math.ceil(durationSec * RATE);
  const out = new Float32Array(n);
  const rnd = mulberry32(seed);

  // --- chord bed: triads on the beat, Karplus-Strong via renderNotes
  const beat = 0.5;
  const roots = [52, 57, 55, 50];                 // E3 A3 G3 D3
  const chordNotes: GroundTruthNote[] = [];
  for (let b = 0; b * beat < durationSec; b++) {
    const root = roots[Math.floor(b / 4) % roots.length];
    if (b % 2 === 0) {
      for (const iv of [0, 4, 7, 12]) {
        chordNotes.push({ pitch: root + iv, onsetSec: b * beat, durationSec: beat * 1.8, velocity: 0.7 });
      }
    }
  }
  if (chordNotes.length) {
    const chords = renderNotes(chordNotes, RATE);
    for (let i = 0; i < Math.min(n, chords.length); i++) out[i] += chords[i] * 0.55;
  }

  // --- drums
  let kickPhase = 0;
  for (let b = 0; b * beat < durationSec; b++) {
    const t0 = Math.floor(b * beat * RATE);
    const isKick = b % 4 === 0 || b % 4 === 2;
    const isSnare = b % 4 === 1 || b % 4 === 3;
    if (isKick) {                                  // 55 Hz -> 40 Hz sweep + click
      kickPhase = 0;
      for (let i = 0; i < RATE * 0.35 && t0 + i < n; i++) {
        const t = i / RATE;
        const f = 90 * Math.exp(-t * 28) + 42;
        kickPhase += (2 * Math.PI * f) / RATE;
        out[t0 + i] += Math.sin(kickPhase) * Math.exp(-t * 9) * 0.9
                     + (rnd() * 2 - 1) * Math.exp(-t * 200) * 0.15;
      }
    }
    if (isSnare) {                                 // noise + 190 Hz body
      let lp = 0;
      for (let i = 0; i < RATE * 0.22 && t0 + i < n; i++) {
        const t = i / RATE;
        const white = rnd() * 2 - 1;
        lp = lp * 0.55 + white * 0.45;             // band-ish
        out[t0 + i] += (white - lp) * Math.exp(-t * 22) * 0.45
                     + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.25;
      }
    }
    for (const off of [0, 0.5]) {                  // hats on eighths
      const h0 = Math.floor((b + off) * beat * RATE);
      let lp = 0;
      for (let i = 0; i < RATE * 0.06 && h0 + i < n; i++) {
        const t = i / RATE;
        const white = rnd() * 2 - 1;
        lp = lp * 0.2 + white * 0.8;
        out[h0 + i] += (white - lp) * Math.exp(-t * 90) * 0.18;
      }
    }
  }
  return out;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Mix bass with accompaniment at a given bass-to-accompaniment ratio in dB. */
function mixAt(bass: Float32Array, acc: Float32Array, ratioDb: number): {
  mix: Float32Array; rest: Float32Array; bassScaled: Float32Array;
} {
  const n = Math.max(bass.length, acc.length);
  const want = rms(bass) / Math.pow(10, ratioDb / 20);
  const g = rms(acc) > 1e-9 ? want / rms(acc) : 0;
  const mix = new Float32Array(n), rest = new Float32Array(n), bs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = i < bass.length ? bass[i] : 0;
    const r = (i < acc.length ? acc[i] : 0) * g;
    bs[i] = b; rest[i] = r; mix[i] = b + r;
  }
  // headroom only; a single global gain changes nothing downstream
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  if (peak > 0.99) {
    const s = 0.99 / peak;
    for (let i = 0; i < n; i++) { mix[i] *= s; rest[i] *= s; bs[i] *= s; }
  }
  return { mix, rest, bassScaled: bs };
}

// ---------------------------------------------------------------- the spike

interface Condition { key: string; label: string }

const CONDITIONS: Condition[] = [
  { key: 'clean',     label: 'clean bass stem (today)' },
  { key: 'mix',       label: 'full mix, no separation' },
  { key: 'oracle',    label: 'ideal ratio mask (ceiling)' },
  { key: 'demucs',    label: 'separated @ ~9 dB SI-SDR' },
  { key: 'spleeter',  label: 'separated @ ~5.5 dB SI-SDR' },
];

describe('separation spike', () => {
  it('measures transcription accuracy on separated vs isolated bass', async () => {
    const detector = new BasicPitchDetector();
    const perCondition = new Map<string, Scores[]>(CONDITIONS.map(c => [c.key, []]));
    const sdrs = new Map<string, number[]>(CONDITIONS.map(c => [c.key, []]));
    const rows: string[] = [];

    // The bass-only materials. `guitar` sits an octave up and is not bass.
    const chosen: Material[] = MATERIAL.filter(m => m.name !== 'guitar');
    let totalSec = 0;

    for (const material of chosen) {
      const durationSec = notesDurationSec(material.notes) + 0.5;
      totalSec += durationSec;
      const bassRaw = renderNotes(material.notes, RATE);
      const acc = accompaniment(durationSec, 7919 + material.name.length * 31);
      const { mix, rest, bassScaled } = mixAt(bassRaw, acc, -3);

      const mixS = stft(mix);
      const bassS = stft(bassScaled);
      const restS = stft(rest);
      const oracleMask = idealRatioMask(bassS, restS);
      const oracleAudio = applyMask(mixS, oracleMask);

      const dem = degradeToSdr(mixS, oracleMask, bassScaled, 9.0, 101);
      const spl = degradeToSdr(mixS, oracleMask, bassScaled, 5.5, 202);

      const audio: Record<string, Float32Array> = {
        clean: bassScaled,
        mix,
        oracle: oracleAudio,
        demucs: dem.audio,
        spleeter: spl.audio,
      };

      for (const c of CONDITIONS) {
        const a = audio[c.key];
        const sdr = c.key === 'clean' ? Infinity : siSdr(a, bassScaled);
        sdrs.get(c.key)!.push(sdr);
        const result = await detector.detect(a.slice(), RATE, () => undefined);
        const kept = suppressHarmonics(result.notes);
        const s = score(material.notes, kept);
        perCondition.get(c.key)!.push(s);
        rows.push(
          `ROW ${material.name.padEnd(14)} ${c.key.padEnd(9)} ` +
          `sdr ${Number.isFinite(sdr) ? sdr.toFixed(1).padStart(6) : '   inf'} dB  ` +
          `ref ${String(s.reference).padStart(3)} est ${String(s.estimate).padStart(3)} ` +
          `P${pct(s.precision)} R${pct(s.recall)} F${pct(s.f1)}`
        );
      }
    }

    for (const r of rows) log(r);
    log('');
    log(`SPIKE material: ${chosen.length} lines, ${totalSec.toFixed(1)} s of audio, ` +
        `bass-to-accompaniment -3 dB`);
    log('SPIKE ================= OVERALL =================');
    const base = totals(perCondition.get('clean')!);
    for (const c of CONDITIONS) {
      const t = totals(perCondition.get(c.key)!);
      const sd = sdrs.get(c.key)!.filter(Number.isFinite);
      const meanSdr = sd.length ? (sd.reduce((a, b) => a + b, 0) / sd.length).toFixed(1) + ' dB' : '  inf ';
      log(
        `SPIKE ${c.key.padEnd(9)} ${meanSdr.padStart(8)}  ` +
        `ref ${String(t.reference).padStart(3)} est ${String(t.estimate).padStart(3)} ` +
        `matched ${String(t.matched).padStart(3)}  ` +
        `P${pct(t.precision)} R${pct(t.recall)} F${pct(t.f1)}  ` +
        `dF ${((t.f1 - base.f1) * 100).toFixed(1).padStart(6)} pp   ${c.label}`
      );
    }

    expect(totals(perCondition.get('clean')!).matched).toBeGreaterThan(0);
  }, 3_600_000);
});
