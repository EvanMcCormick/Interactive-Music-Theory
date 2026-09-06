/**
 * Karplus-Strong string synthesis, for measuring harmonic suppression against
 * material whose harmonic structure nobody chose.
 *
 * The fixture `transcription-harmonics.spec.ts` is built on was made by adding
 * sinusoids at hand-picked amplitudes and hand-picked decay rates. Measuring
 * `suppressHarmonics` against that is close to circular: its
 * `partialDurationRatio` rests on partials decaying faster than fundamentals,
 * which is exactly what those hand-picked decays assert.
 *
 * Karplus-Strong asserts nothing of the kind. An excitation circulates in a
 * delay line one period long, through a low-pass filter. The harmonic series
 * appears because a delay line of length P resonates at every multiple of
 * 1/P; the per-partial decay appears because the filter takes more off each
 * mode the higher it sits, once per round trip. Neither is a number anyone
 * picked. The only per-note number here is `decaySec` - a uniform loop gain
 * that says how long the string is left to ring, applied to every mode alike.
 * It can make the whole note shorter; it cannot make one partial outlive
 * another.
 *
 * ## Why the excitation is a pluck and not the canonical noise burst
 *
 * Karplus and Strong seed the line with white noise, and that was tried first.
 * Measured over ten pitches, **the fundamental was the strongest mode in none
 * of them** - a burst of white noise this short gives every mode an
 * independent random amplitude, so an "E1" came back with its 6th partial four
 * times louder than its fundamental. That is not a plucked string, and it
 * would have contaminated every number this directory produces: a detector
 * that reports the partial instead of the note it was handed looks exactly
 * like a suppressor eating a real note.
 *
 * So the line is seeded with the physical initial condition instead: the
 * triangular displacement a finger makes pulling a string sideways at
 * `PLUCK_POSITION` along its length. The 1/k^2 roll-off a real string has
 * falls out of that triangle's Fourier series - it is not a profile anyone
 * typed - and the comb it puts on the series is the pluck position, which is
 * a place on the instrument rather than a number about partials. A little
 * noise rides on top for the release transient a real finger makes.
 *
 * Measured, the pluck gives the fundamental as the strongest mode in 10 of 10
 * pitches, tuning exact to 0.0 cents, and a modal profile of
 * `1.00 0.38 0.14 0.02 0.02 0.04 0.03 0.01`. `karplus-strong.spec.ts` asserts
 * all three, and it is the spec that caught the noise burst. Do not
 * "simplify" this back to a burst: it invalidates every accuracy number
 * without failing anything else.
 *
 * Per-partial *decay*, which is the only thing `partialDurationRatio` rests
 * on, is untouched by any of this: it comes from the loop filter alone.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

/** Deterministic PRNG, so a fixture renders identically on every machine. */
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
 * Where along the string it is plucked, as a fraction of its length.
 *
 * Roughly where a bassist's plucking hand sits. Deliberately not a neat
 * fraction: 1/5 would put an exact null on every 5th partial, and real hands
 * do not land on exact fractions.
 */
export const PLUCK_POSITION = 0.22;

/** The broadband transient of a finger letting go, relative to the pluck. */
export const PICK_NOISE = 0.05;

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * One plucked string.
 *
 * @param decaySec time for the loop gain to take the note down 60 dB. The one
 *   performance parameter, uniform across partials.
 */
export function karplusStrong(
  freqHz: number,
  seconds: number,
  rate: number,
  decaySec: number,
  seed: number
): Float32Array {
  const total = Math.max(1, Math.round(seconds * rate));
  const out = new Float32Array(total);

  // The two-tap average below is itself half a sample of delay, so the line
  // has to be half a sample shorter than the period it must sound. Read with
  // linear interpolation rather than rounded to a whole sample: rounding puts
  // a high note as much as 15 cents off its own MIDI number, and the metric
  // this feeds demands an exact pitch match.
  const delay = Math.max(2, rate / freqHz - 0.5);
  const size = Math.ceil(delay) + 1;
  const line = new Float32Array(size);

  const rng = mulberry32(seed);
  const apex = Math.max(1, Math.round(PLUCK_POSITION * size));
  let mean = 0;
  for (let i = 0; i < size; i++) {
    const displacement = i < apex ? i / apex : (size - i) / (size - apex);
    line[i] = displacement + PICK_NOISE * (rng() * 2 - 1);
    mean += line[i];
  }
  mean /= size;
  // The triangle has a large non-zero mean, and the averaging filter passes DC
  // at unity - so the offset would survive as a subsonic thump the whole
  // length of the note. Removing it is bookkeeping, not voicing: a real
  // string's displacement is measured from its own rest position.
  for (let i = 0; i < size; i++) line[i] -= mean;
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(line[i]));
  if (peak > 0) for (let i = 0; i < size; i++) line[i] /= peak;

  const rho = Math.pow(0.001, 1 / Math.max(1, freqHz * decaySec));

  let write = 0;
  let previous = 0;
  for (let n = 0; n < total; n++) {
    const readPos = (write - delay + 2 * size) % size;
    const i0 = Math.floor(readPos);
    const i1 = (i0 + 1) % size;
    const g = readPos - i0;
    const sample = line[i0] * (1 - g) + line[i1] * g;
    const value = rho * 0.5 * (sample + previous);

    previous = sample;
    line[write] = value;
    write = (write + 1) % size;
    out[n] = value;
  }

  // A finger stopping the string. Without it the render ends on a step, and a
  // step is broadband - exactly what an onset detector is built to notice.
  const release = Math.min(total, Math.round(0.02 * rate));
  for (let i = 0; i < release; i++) out[total - 1 - i] *= i / release;

  return out;
}

/** Magnitude of `freqHz` in `samples`, by Goertzel. For the sanity check. */
export function goertzel(
  samples: Float32Array,
  freqHz: number,
  rate: number,
  from: number,
  length: number
): number {
  const end = Math.min(samples.length, from + length);
  const count = end - from;
  if (count <= 0) return 0;

  const coeff = 2 * Math.cos((2 * Math.PI * freqHz) / rate);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < end; i++) {
    // Hann, so a partial 3 Hz away does not leak into its neighbour's bin.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - from)) / count);
    const s0 = w * samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return (Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) * 2) / count;
}
