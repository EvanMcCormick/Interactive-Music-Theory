/**
 * The ground truth: ten lines chosen to stress harmonic suppression rather
 * than to flatter it, and the renderer that turns them into audio.
 *
 * Ground truth is what was synthesised - a pitch and an onset per note. The
 * durations are here because they shape the audio, not because the metric
 * reads them.
 *
 * Each line names what it is meant to break in `stresses`. That field is
 * documentation for whoever reads a per-fixture row of the accuracy table and
 * wants to know why that row exists; nothing computes on it.
 *
 * Known limitation, and the reason Task 2 of the accuracy plan exists: **every
 * note here is plucked at identical strength.** Any discriminator that reads
 * amplitude therefore has an easier job on this material than it would on real
 * music, because the case that would defeat it - a quiet real note over a loud
 * ringing root - cannot occur. Do not choose an amplitude threshold from these
 * fixtures alone.
 *
 * Test-support code. Nothing in the shipped app imports it.
 */

import { karplusStrong } from './karplus-strong';

export interface GroundTruthNote {
  /** MIDI. */
  pitch: number;
  onsetSec: number;
  /** How long the string is left to ring. */
  durationSec: number;
}

export interface Material {
  name: string;
  /** What it is meant to break. */
  stresses: string;
  notes: GroundTruthNote[];
}

/** `pitches` one every `spacingSec`, each ringing `durationSec`. */
function line(
  pitches: number[],
  spacingSec: number,
  durationSec: number,
  startSec = 0
): GroundTruthNote[] {
  return pitches.map((pitch, i) => ({
    pitch,
    onsetSec: startSec + i * spacingSec,
    durationSec
  }));
}

const E1 = 28;
const F$1 = 30;
const G1 = 31;
const A1 = 33;
const B1 = 35;
const C2 = 36;
const D2 = 38;
const E2 = 40;
const G2 = 43;
const A2 = 45;
const B2 = 47;
const C3 = 48;
const E3 = 52;
const G3 = 55;
const A3 = 57;
const B3 = 59;
const C4 = 60;
const D4 = 62;
const E4 = 64;

export const MATERIAL: Material[] = [
  {
    name: 'walking',
    stresses: 'nothing in particular - the baseline the current fixture stands for',
    notes: line([E1, G1, A1, B1, C2, B1, A1, G1, E1, F$1, G1, A1], 0.6, 0.55)
  },
  {
    name: 'octaves',
    stresses: 'the known hard case: a played octave is what a 2nd partial looks like',
    // E1/E2 pumping eighths at 116 BPM, the Billie Jean figure.
    notes: line(
      Array.from({ length: 16 }, (_, i) => (i % 2 ? E2 : E1)),
      60 / 116 / 2,
      0.3
    )
  },
  {
    name: 'pedal',
    stresses: 'the documented false positive: short notes at partial intervals over a held root',
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 2.6 },
      ...line([E2, G2, B2, E3, C3, A2], 0.36, 0.3, 0.42),
      { pitch: A1, onsetSec: 3.0, durationSec: 2.6 },
      ...line([A2, C3, E3, A3], 0.36, 0.3, 3.42)
    ]
  },
  {
    name: 'repeats',
    stresses: 'the unison rule - the same pitch struck again while the first still rings',
    notes: [
      ...line([A1, A1, A1], 0.4, 0.62),
      ...line([D2, D2], 0.3, 0.5, 1.7),
      ...line([E1, E1, E1, E1], 0.5, 0.72, 2.6),
      // A clipped repeat at full weight, and a soft one held long: the two
      // halves of the unison rule, one at a time.
      { pitch: G1, onsetSec: 4.8, durationSec: 0.6 },
      { pitch: G1, onsetSec: 5.1, durationSec: 0.12 },
      { pitch: C2, onsetSec: 5.8, durationSec: 0.6 },
      { pitch: C2, onsetSec: 6.1, durationSec: 0.55 }
    ]
  },
  {
    name: 'fifths',
    stresses: '+19 is 3f0 and also an octave and a fifth, which basses play',
    notes: [
      // Power chord, root and fifth together.
      { pitch: E1, onsetSec: 0, durationSec: 1.0 },
      { pitch: B1, onsetSec: 0, durationSec: 1.0 },
      { pitch: A1, onsetSec: 1.2, durationSec: 1.0 },
      { pitch: E2, onsetSec: 1.2, durationSec: 1.0 },
      // Root, fifth and octave: +7 and +12 at once.
      { pitch: E1, onsetSec: 2.4, durationSec: 1.2 },
      { pitch: B1, onsetSec: 2.4, durationSec: 1.2 },
      { pitch: E2, onsetSec: 2.4, durationSec: 1.2 },
      // The one that matters: a twelfth, exactly 3f0's interval, played.
      { pitch: E1, onsetSec: 3.9, durationSec: 1.3 },
      { pitch: B2, onsetSec: 4.2, durationSec: 0.9 },
      { pitch: A1, onsetSec: 5.4, durationSec: 1.3 },
      { pitch: E3, onsetSec: 5.7, durationSec: 0.9 }
    ]
  },
  {
    name: 'run',
    stresses: 'short notes packed close, each still ringing under the next',
    notes: line(
      [E1, F$1, G1, A1, B1, C2, D2, E2, D2, C2, B1, A1, G1, F$1, E1, D2, E2, G2, E2, D2, C2, B1, A1, G1],
      60 / 140 / 4,
      0.25
    )
  },
  {
    name: 'leaps',
    stresses: '+12, +19 and +24 as real leaps over a low note left ringing',
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 1.4 },
      { pitch: E3, onsetSec: 0.35, durationSec: 0.9 },
      { pitch: G1, onsetSec: 1.6, durationSec: 1.4 },
      { pitch: G2, onsetSec: 1.95, durationSec: 0.9 },
      { pitch: A1, onsetSec: 3.2, durationSec: 1.4 },
      { pitch: E3, onsetSec: 3.55, durationSec: 0.9 },
      { pitch: C2, onsetSec: 4.8, durationSec: 1.4 },
      { pitch: C4, onsetSec: 5.15, durationSec: 0.9 }
    ]
  },
  {
    name: 'slap',
    stresses: 'a popped note two octaves over the thumbed root still sounding',
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 0.9 },
      { pitch: E3, onsetSec: 0.22, durationSec: 0.28 },
      { pitch: E1, onsetSec: 1.0, durationSec: 0.9 },
      { pitch: B2, onsetSec: 1.22, durationSec: 0.28 },
      { pitch: A1, onsetSec: 2.0, durationSec: 0.9 },
      { pitch: A3, onsetSec: 2.22, durationSec: 0.28 },
      { pitch: A1, onsetSec: 3.0, durationSec: 0.9 },
      { pitch: E3, onsetSec: 3.22, durationSec: 0.28 }
    ]
  },
  {
    name: 'guitar',
    stresses: 'a register two octaves up, where the partials leave the model band',
    notes: line([E3, G3, A3, B3, C4, D4, E4, D4, C4, B3, A3, G3], 0.5, 0.45)
  },
  {
    name: 'ballad',
    stresses: 'long ring-out, where a partial has time to be reported as a long note',
    notes: line([E1, C2, G1, D2, A1, E2], 1.2, 1.6)
  }
];

export function materialDurationSec(material: Material): number {
  return Math.max(...material.notes.map(n => n.onsetSec + n.durationSec)) + 0.3;
}

/**
 * Renders a material to mono audio at `rate`.
 *
 * Every note is plucked at the same strength and the mix is normalised once at
 * the end, so nothing here encodes a view about which notes a detector should
 * find easier.
 */
export function render(material: Material, rate: number): Float32Array {
  const out = new Float32Array(Math.ceil(materialDurationSec(material) * rate));

  material.notes.forEach((note, index) => {
    const voice = karplusStrong(
      440 * Math.pow(2, (note.pitch - 69) / 12),
      note.durationSec,
      rate,
      note.durationSec,
      // A different burst per note, stable across runs.
      1000 + index * 7919
    );
    const at = Math.round(note.onsetSec * rate);
    for (let i = 0; i < voice.length && at + i < out.length; i++) out[at + i] += voice[i];
  });

  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  if (peak > 0) {
    const gain = 0.7 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }

  return out;
}
