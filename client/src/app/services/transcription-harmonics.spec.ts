import { DetectedNote } from '../models/transcription.model';
import { HARMONIC_SEMITONES, suppressHarmonics } from './transcription-harmonics';

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
 * notes — E1 A1 D2 G2 twice, 0.5 s apart, each with 2nd/3rd/4th harmonics.
 * Thirty-four notes for eight played: recall is perfect, precision is 24 %,
 * and every spurious note is a partial above its fundamental.
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

/** The eight pitches actually synthesised, in order. */
const PLAYED = [28, 33, 38, 43, 28, 33, 38, 43];

describe('suppressHarmonics', () => {
  it('recovers the played line from the raw detector output', () => {
    const kept = suppressHarmonics(DETECTED);

    expect(kept.map(n => n.pitch)).toEqual(PLAYED);
  });

  it('suppresses a partial that is louder than its own fundamental', () => {
    // Real detector output: the E2 partial at 2.091 (amp 0.548) outweighs the
    // E1 that produced it at 1.823 (amp 0.520). Ordering by pitch rather than
    // loudness is what catches it.
    const cluster = [
      note([1.823, 28, 0.628, 0.520], 0),
      note([2.091, 40, 0.267, 0.548], 1)
    ];

    expect(suppressHarmonics(cluster).map(n => n.pitch)).toEqual([28]);
  });

  it('leaves a note with no harmonic relation alone', () => {
    // A minor second is not a partial of anything.
    const pair = [
      note([0, 33, 0.4, 0.7], 0),
      note([0, 34, 0.4, 0.6], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('keeps a partial-interval note that does not overlap its root', () => {
    // An octave above, but struck long after the lower note stopped sounding.
    const pair = [
      note([0, 33, 0.2, 0.7], 0),
      note([2, 45, 0.4, 0.6], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('drops the 5th partial, nearly two octaves and a major third up', () => {
    // 5f0 is 27.86 semitones above the fundamental: E1 at 28 rings at 56.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 56, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
  });

  it('drops the 6th partial, two octaves and a fifth up', () => {
    // 6f0 is 31.02 semitones above the fundamental: E1 at 28 rings at 59.
    const pair = [
      note([0, 28, 0.6, 0.60], 0),
      note([0.1, 59, 0.2, 0.30], 1)
    ];

    expect(suppressHarmonics(pair).map(n => n.pitch)).toEqual([28]);
  });

  it('drops a weak short unison inside a strong note as a re-detection', () => {
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.05, 0.40], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(1);
  });

  it('keeps a genuine repeated note of comparable weight and length', () => {
    // Same pitch, overlapping because the first still rings — but struck as
    // hard and held as long, so it is a second attack, not an artefact.
    const pair = [
      note([0, 33, 0.4, 0.70], 0),
      note([0.3, 33, 0.4, 0.68], 1)
    ];

    expect(suppressHarmonics(pair).length).toBe(2);
  });

  it('returns notes in onset order', () => {
    const kept = suppressHarmonics(DETECTED);
    const onsets = kept.map(n => n.onsetSec);

    expect([...onsets].sort((a, b) => a - b)).toEqual(onsets);
  });

  it('does not mutate its input', () => {
    const before = DETECTED.length;
    suppressHarmonics(DETECTED);

    expect(DETECTED.length).toBe(before);
  });

  it('gives the same answer whatever order the detector reported the notes in', () => {
    // Every pitch here but one is shared by at least two notes, and four of
    // those pairs share an amplitude too (0.514 and 0.264 at pitch 45, 0.329
    // at 52, 0.352 at 62), so neither the pitch sort nor the confidence
    // tie-break fixes the order the greedy pass sees them in; onset has to.
    const expected = suppressHarmonics(DETECTED).map(n => n.id);

    for (let trial = 0; trial < 25; trial++) {
      const shuffled = [...DETECTED];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      expect(suppressHarmonics(shuffled).map(n => n.id)).toEqual(expected);
    }
  });

  it('lists the partials of a plucked string, unison first', () => {
    // 2f0, 3f0, 4f0, 5f0, 6f0 rounded to semitones, plus unison at 0.
    expect(HARMONIC_SEMITONES).toEqual([0, 12, 19, 24, 28, 31]);
  });
});
