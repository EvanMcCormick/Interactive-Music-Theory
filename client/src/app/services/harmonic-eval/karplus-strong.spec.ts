/**
 * Does the synthesis actually produce a plucked string?
 *
 * Every accuracy number this directory reports is measured on audio made by
 * `karplusStrong`, so if the audio is not a plucked string the numbers are
 * about something else. That is not hypothetical: the canonical noise-burst
 * excitation was tried first and **the fundamental was the strongest mode in
 * 0 of 10 pitches** - an E1 whose 6th partial came back four times louder than
 * its fundamental. A detector handed that reports the partial rather than the
 * note, which downstream is indistinguishable from a suppressor eating a real
 * note. This spec is what caught it.
 *
 * So the four things the harness depends on are measured here, not assumed:
 *
 *  1. **Tuning.** The fundamental lands on the nominal frequency of the MIDI
 *     note asked for - 41.20 Hz against 41.20 Hz, 0.0 cents. The metric
 *     matches on exact pitch, so a synth a quarter-tone sharp would show up as
 *     a detector failure.
 *  2. **Modal profile.** The fundamental is the strongest mode, everywhere,
 *     and the series rolls off above it: 1.00 0.38 0.14 0.02 0.02 0.04 0.03
 *     0.01 at E1. That shape is the Fourier series of the triangular pluck,
 *     not a profile anyone typed.
 *  3. **Per-partial decay comes only from the loop filter,** and is *small*:
 *     partials 1 to 8 of an E1 decay at -20.0 to -20.7 dB/s. Higher modes do
 *     lose more, so the ordering `suppressHarmonics` invokes is real - but a
 *     spread of 0.7 dB/s is nowhere near enough to explain why the detector
 *     reports partials as much shorter notes. That gap is what finding 3 of
 *     the accuracy plan rests on.
 *  4. **A pluck envelope**: loudest at the attack, monotonically down after.
 *  5. **Velocity is a pluck, not a gain.** Six of the sixteen materials carry
 *     dynamics, and the discriminator the accuracy plan is about to adopt
 *     reads amplitude - so if velocity were only a multiplier on the rendered
 *     voice, the new material would test that discriminator with a knob that
 *     changes nothing about the sound. It is not: scaling the initial
 *     displacement while the finger's release transient stays where it is
 *     lifts the residue above the 4th partial from 0.07 of the fundamental at
 *     full strength to 0.16-0.24 at a tenth of it. A gain cannot move that
 *     ratio at all, because it is scale-invariant and the loop is linear.
 *
 * If a change to `karplus-strong.ts` breaks any of these, the accuracy
 * fixtures are measuring a different instrument and every conclusion drawn
 * from them is void. That is why these assert rather than merely print.
 */

import { DETECTION_SAMPLE_RATE } from '../note-detector';
import { goertzel, karplusStrong, midiToHz } from './karplus-strong';
import { MATERIAL, render } from './material';

const RATE = DETECTION_SAMPLE_RATE;
const E1 = 28;

/** Open strings and stopped notes spanning the range the material uses. */
const PITCHES = [28, 31, 33, 38, 40, 43, 45, 52, 57, 64];

/** Amplitude of the `k`th partial in the window starting at `fromSec`. */
function partial(
  audio: Float32Array,
  f0: number,
  k: number,
  fromSec: number,
  windowSec: number
): number {
  return goertzel(
    audio,
    f0 * k,
    RATE,
    Math.round(fromSec * RATE),
    Math.round(windowSec * RATE)
  );
}

const log = (line: string): void => console.log(line); // eslint-disable-line no-console

describe('Karplus-Strong', () => {
  const e1 = karplusStrong(midiToHz(E1), 3, RATE, 3, 1);

  it('puts the fundamental where the note says', () => {
    const nominal = midiToHz(E1);
    let best = 0;
    let bestHz = 0;
    // A tenth of a semitone either side, which is finer than the metric needs.
    for (let cents = -60; cents <= 60; cents += 2) {
      const hz = nominal * Math.pow(2, cents / 1200);
      const m = goertzel(e1, hz, RATE, Math.round(0.1 * RATE), Math.round(0.4 * RATE));
      if (m > best) {
        best = m;
        bestHz = hz;
      }
    }

    const cents = 1200 * Math.log2(bestHz / nominal);
    log(
      `KS-SANITY fundamental ${bestHz.toFixed(2)} Hz vs nominal ${nominal.toFixed(2)} Hz ` +
        `(${cents.toFixed(1)} cents)`
    );

    // Measured 0.0, and the bound is two sweep steps either side rather than a
    // generous margin: reading the delay line rounded to a whole sample rather
    // than interpolated puts a high note 15 cents out, and this is the
    // assertion that would catch that.
    expect(Math.abs(cents)).toBeLessThanOrEqual(4);
  });

  it('radiates a harmonic series that decays from the top down', () => {
    const f0 = midiToHz(E1);
    const perSecond: number[] = [];

    for (let k = 1; k <= 8; k++) {
      const early = partial(e1, f0, k, 0.1, 0.25);
      const late = partial(e1, f0, k, 1.1, 0.25);
      // dB per second, over the second between the two windows.
      const rate = 20 * Math.log10(Math.max(late, 1e-9) / Math.max(early, 1e-9));
      perSecond.push(rate);
      log(
        `KS-SANITY partial ${String(k).padStart(2)} @ ${(f0 * k).toFixed(1).padStart(7)} Hz  ` +
          `early ${early.toExponential(2)}  late ${late.toExponential(2)}  ` +
          `${rate.toFixed(1).padStart(6)} dB/s`
      );
    }

    // The claim `suppressHarmonics` rests on, tested rather than assumed:
    // higher modes lose more per second than the fundamental does.
    expect(perSecond[7]).toBeLessThan(perSecond[0]);
    expect(perSecond[3]).toBeLessThan(perSecond[0]);

    // ...and the size of that difference, which is the part the shipped
    // docblock gets wrong. -20.0 against -20.7 dB/s is a real ordering and a
    // trivial magnitude: over a 0.3 s note the 8th partial loses 0.2 dB more
    // than the fundamental. Nothing that small explains a detector reporting
    // the partial as 0.4 of the note's length. Amplitude does: the 8th partial
    // starts 38 dB down.
    const spread = Math.abs(perSecond[7] - perSecond[0]);
    log(`KS-SANITY decay spread across partials 1..8 ${spread.toFixed(1)} dB/s`);
    expect(spread).toBeLessThan(3);
  });

  it('has a pluck envelope: loudest at the attack, monotonically down after', () => {
    const step = Math.round(0.05 * RATE);
    const envelope: number[] = [];
    for (let at = 0; at + step < e1.length; at += step) {
      let sum = 0;
      for (let i = at; i < at + step; i++) sum += e1[i] * e1[i];
      envelope.push(Math.sqrt(sum / step));
    }

    log('KS-SANITY envelope (50 ms RMS) ' + envelope.map(v => v.toFixed(3)).join(' '));

    expect(envelope[0]).toBe(Math.max(...envelope));
    // No revival anywhere: a real pluck only ever gets quieter. The 2 % slack
    // is for an RMS window straddling a zero crossing, not for a real rise.
    for (let i = 1; i < envelope.length; i++) {
      expect(envelope[i]).toBeLessThanOrEqual(envelope[i - 1] * 1.02);
    }
  });

  /**
   * The assertion that keeps velocity honest.
   *
   * Task 3 chooses an amplitude threshold, and it can only be measured on
   * material with dynamics. If those dynamics were a gain on the rendered
   * voice, they would still make a note quieter in the mix - but they would
   * make it quieter in a way no physical pluck is quieter, and a detector
   * reading a spectrum would be handed a loud note with the volume turned
   * down rather than a soft note.
   *
   * The difference is measurable because the finger's release transient does
   * not scale with how far the string is pulled. Below velocity 1 the
   * displacement shrinks and the transient does not, so the residue above the
   * 4th partial grows as a share of the fundamental. That share is a *ratio*,
   * so a gain leaves it exactly where it was - which is what makes it the
   * right thing to measure here.
   */
  it('takes velocity as a pluck, not as a gain on the output', () => {
    /** Energy above the 4th partial, as a share of the fundamental. */
    const residueShare = (audio: Float32Array, f0: number): number => {
      const fundamental = partial(audio, f0, 1, 0.05, 0.3);
      let residue = 0;
      for (let k = 4; k <= 12; k++) {
        const m = partial(audio, f0, k, 0.05, 0.3);
        residue += m * m;
      }

      return Math.sqrt(residue) / fundamental;
    };

    for (const midi of [28, 33, 40, 52]) {
      const f0 = midiToHz(midi);
      const shares = [1, 0.5, 0.32, 0.22, 0.12].map(velocity => ({
        velocity,
        share: residueShare(karplusStrong(f0, 1.2, RATE, 1.2, 5000 + midi, velocity), f0)
      }));

      log(
        `KS-VELOCITY midi ${String(midi).padStart(2)}  residue/fundamental  ` +
          shares.map(s => `v${s.velocity} ${s.share.toFixed(3)}`).join('  ')
      );

      // Softer is proportionally noisier, all the way down. Measured 0.069 ->
      // 0.161 at E1 and 0.043 -> 0.178 at E3.
      for (let i = 1; i < shares.length; i++) {
        expect(shares[i].share).toBeGreaterThan(shares[i - 1].share);
      }
      expect(shares[shares.length - 1].share).toBeGreaterThan(shares[0].share * 2);

      // ...and the same note at full strength, multiplied down to the same
      // level afterwards, has exactly the share it had before - which is what
      // "velocity is not a gain" means, stated as an equality rather than as
      // prose.
      const loud = karplusStrong(f0, 1.2, RATE, 1.2, 5000 + midi, 1);
      const gained = loud.map(x => x * 0.12);
      expect(residueShare(gained, f0)).toBeCloseTo(shares[0].share, 6);

      // It is still a dynamic: the soft note really is quieter.
      const soft = karplusStrong(f0, 1.2, RATE, 1.2, 5000 + midi, 0.22);
      const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak(soft)).toBeLessThan(peak(loud) * 0.4);
    }
  });

  it('renders every material without clipping or silence', () => {
    for (const material of MATERIAL) {
      const audio = render(material, RATE);
      let peak = 0;
      let sum = 0;
      for (const s of audio) {
        peak = Math.max(peak, Math.abs(s));
        sum += s * s;
      }

      log(
        `KS-SANITY material ${material.name.padEnd(9)} ` +
          `${material.notes.length} notes  ${(audio.length / RATE).toFixed(2)} s  ` +
          `peak ${peak.toFixed(3)}  rms ${Math.sqrt(sum / audio.length).toFixed(4)}`
      );

      expect(peak).toBeCloseTo(0.7, 5);
      expect(Math.sqrt(sum / audio.length)).toBeGreaterThan(0.01);
    }
  });
});

describe('Karplus-Strong excitation', () => {
  /**
   * The assertion that caught the noise burst.
   *
   * A short burst of white noise seeds every mode with an independent random
   * amplitude, and this measurement said so: fundamental strongest in 0 of 10.
   * With the triangular pluck it is 10 of 10. Anything that reintroduces a
   * random excitation - a "simplification" back to the canonical algorithm, a
   * different seeding regime - fails here rather than silently invalidating
   * every accuracy fixture, which is the entire reason this is an assertion
   * and not a log.
   */
  it('gives every pitch a falling modal profile led by the fundamental', () => {
    let fundamentalStrongest = 0;

    for (const midi of PITCHES) {
      const f0 = midiToHz(midi);
      const audio = karplusStrong(f0, 1.2, RATE, 1.2, 1000 + midi * 7919);
      const mags = [1, 2, 3, 4, 5, 6, 7, 8].map(k =>
        goertzel(audio, f0 * k, RATE, Math.round(0.05 * RATE), Math.round(0.3 * RATE))
      );
      const peak = Math.max(...mags);
      const profile = mags.map(m => m / peak);
      if (mags[0] === peak) fundamentalStrongest++;

      log(
        `KS-MODES midi ${String(midi).padStart(2)} ` +
          profile.map(m => m.toFixed(2)).join(' ') +
          `  strongest = partial ${mags.indexOf(peak) + 1}`
      );

      // The triangle's 1/k^2 roll-off, stated as a shape rather than as the
      // exact numbers it happens to produce: the octave is a substantial but
      // clearly subordinate mode, the twelfth sits below it, and everything
      // above the 4th partial is residue. Measured across these ten pitches
      // the 2nd partial runs 0.25-0.38 and the 3rd 0.04-0.15, so the bounds
      // leave room for a different pluck position while still excluding the
      // noise burst, which put modes above the 4th at parity with the
      // fundamental.
      expect(profile[1]).toBeGreaterThan(0.15);
      expect(profile[1]).toBeLessThan(0.6);
      expect(profile[2]).toBeLessThan(profile[1]);
      for (const above of profile.slice(3)) expect(above).toBeLessThan(0.12);
    }

    log(`KS-MODES fundamental strongest in ${fundamentalStrongest}/${PITCHES.length}`);
    expect(fundamentalStrongest).toBe(PITCHES.length);
  });
});
