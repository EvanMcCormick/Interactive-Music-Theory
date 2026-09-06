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
 * ## Dynamics
 *
 * The first ten lines are played at one strength throughout, and were frozen
 * that way. That was the spike's largest caveat: amplitude ratio is the
 * discriminator harmonic suppression is about to rest on, and material with no
 * dynamic range cannot contradict an amplitude rule, so a threshold fitted to
 * those ten alone would be asserted rather than measured - the same mistake
 * `partialDurationRatio` embodies.
 *
 * The six lines after them exist to contradict it. `quietOverLoud` is the one
 * that matters most: real notes, softly played, at partial intervals over a
 * loud root still ringing - which is what an amplitude rule ought to mistake
 * for a partial, and which until now nothing in this file contained. `accents`
 * is the same case in its most ordinary form: a bassline whose offbeat octaves
 * are simply played lighter than its downbeats. `loudOverQuiet` is the
 * converse; `crescendo` and `decrescendo` are the same eight pitches at the
 * same eight onsets with the velocity ramp reversed, so the two rows differ by
 * dynamics and nothing else; `ghosts` puts dead notes at a tenth of full
 * strength next to notes at full strength.
 *
 * Velocity is not a level applied afterwards. It is how far the finger pulls
 * the string, and it enters the synthesis there; `karplus-strong.ts` says what
 * that changes that a gain would not. Notes that state no velocity are played
 * at full strength, which is why the first ten fixtures are byte-for-byte the
 * audio they were captured from.
 *
 * What these six then revealed is not what they were added to reveal, and
 * anyone choosing a velocity here should know it before choosing:
 * `DetectedNote.confidence` barely responds to how hard a note is played. Over
 * the 17.7 dB these fixtures span it moves by 5 %. It is a mean frame
 * activation and not a level - `basic-pitch-detector.ts` says so, and
 * `harmonic-accuracy.spec.ts` measures it. So do not reach for a lower
 * velocity expecting a lower `confidence`; what a lower velocity actually buys
 * is a note the detector may miss entirely, which is why `ghosts` contributes
 * eight of the fifty-one notes nothing ever found.
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
  /**
   * How hard it is plucked, 0 to 1. Absent means full strength.
   *
   * Absent rather than defaulted at every call site on purpose: the ten
   * fixtures that predate dynamics say nothing about velocity and so render
   * exactly the audio they were captured from, and a reader can see at a
   * glance which lines are about dynamics and which are not.
   */
  velocity?: number;
}

export interface Material {
  name: string;
  /** What it is meant to break. */
  stresses: string;
  notes: GroundTruthNote[];
}

/** A linear velocity ramp from `from` to `to` across `count` notes. */
function ramp(from: number, to: number, count: number, index: number): number {
  return count < 2 ? to : from + ((to - from) * index) / (count - 1);
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

/** Shared by `crescendo` and `decrescendo`, so the two differ only in dynamics. */
const CRESCENDO_PITCHES: number[] = [E1, E2, G1, G2, A1, A2, C2, C3];

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
  },
  {
    name: 'quietOverLoud',
    stresses:
      'the case no other fixture contains: a real note played softly at a ' +
      "partial's interval over a loud root that is still ringing",
    // Three loud roots, each with a soft melody note above it at +12, +19 or
    // +24, plucked at a fifth to a third of the root's strength. Two of the
    // soft notes ring nearly as long as the root under them, so a length rule
    // has little to go on and an amplitude rule ought to have everything.
    //
    // Measured, it does not: the detector reports these notes at 0.70-0.90 of
    // the root's `confidence` despite being 12-14 dB under it, because
    // `confidence` is a mean frame activation rather than a level. The line
    // is still doing its job - it is the only place the question can be asked
    // - but the answer it gave was about the feature, not about the notes.
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 2.4 },
      { pitch: E2, onsetSec: 0.45, durationSec: 1.9, velocity: 0.22 },
      { pitch: B2, onsetSec: 1.3, durationSec: 0.55, velocity: 0.26 },
      { pitch: A1, onsetSec: 2.8, durationSec: 2.4 },
      { pitch: A2, onsetSec: 3.25, durationSec: 1.9, velocity: 0.2 },
      { pitch: E3, onsetSec: 3.95, durationSec: 0.6, velocity: 0.3 },
      { pitch: C2, onsetSec: 5.6, durationSec: 2.4 },
      { pitch: C4, onsetSec: 6.05, durationSec: 1.8, velocity: 0.25 },
      // Not a partial's interval, so suppression cannot touch it however
      // quiet it is. It says whether the detector can hear a note this soft
      // at all, which is the difference between a fixture that measures
      // suppression and one that measures the detector.
      { pitch: G2, onsetSec: 6.9, durationSec: 0.6, velocity: 0.28 }
    ]
  },
  {
    name: 'loudOverQuiet',
    stresses: 'the converse: a loud note at a partial interval over a quiet root',
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 2.2, velocity: 0.28 },
      { pitch: E2, onsetSec: 0.4, durationSec: 1.6 },
      { pitch: A1, onsetSec: 2.6, durationSec: 2.2, velocity: 0.25 },
      { pitch: E3, onsetSec: 3.0, durationSec: 1.6 },
      { pitch: C2, onsetSec: 5.2, durationSec: 2.2, velocity: 0.3 },
      { pitch: C4, onsetSec: 5.6, durationSec: 1.6, velocity: 0.95 }
    ]
  },
  {
    name: 'crescendo',
    stresses: 'octave pairs whose pluck strength climbs through the whole dynamic range',
    // Root, octave, root, octave up the neck, getting louder. Each note rings
    // under the two after it, so every octave is a live root/partial pair -
    // and because the line grows, the upper note of each pair is always the
    // louder one. `decrescendo` is the same eight notes at the same eight
    // onsets with the ramp reversed, which makes the two rows a controlled
    // pair: they differ by dynamics and by nothing else.
    notes: CRESCENDO_PITCHES.map((pitch, i) => ({
      pitch,
      onsetSec: i * 0.45,
      durationSec: 0.9,
      velocity: ramp(0.22, 1, CRESCENDO_PITCHES.length, i)
    }))
  },
  {
    name: 'decrescendo',
    stresses: 'the same octave pairs played the other way round, loud down to soft',
    notes: CRESCENDO_PITCHES.map((pitch, i) => ({
      pitch,
      onsetSec: i * 0.45,
      durationSec: 0.9,
      velocity: ramp(1, 0.22, CRESCENDO_PITCHES.length, i)
    }))
  },
  {
    name: 'ghosts',
    stresses: 'dead notes at a tenth of full strength, beside notes at full strength',
    notes: [
      { pitch: E1, onsetSec: 0, durationSec: 0.75 },
      { pitch: E2, onsetSec: 0.3, durationSec: 0.12, velocity: 0.12 },
      { pitch: E1, onsetSec: 0.6, durationSec: 0.12, velocity: 0.1 },
      { pitch: E1, onsetSec: 0.9, durationSec: 0.75 },
      { pitch: G1, onsetSec: 1.2, durationSec: 0.12, velocity: 0.1 },
      { pitch: A1, onsetSec: 1.8, durationSec: 0.75 },
      { pitch: A2, onsetSec: 2.1, durationSec: 0.12, velocity: 0.14 },
      { pitch: A1, onsetSec: 2.4, durationSec: 0.12, velocity: 0.1 },
      { pitch: C2, onsetSec: 2.7, durationSec: 0.75 },
      { pitch: C3, onsetSec: 3.0, durationSec: 0.12, velocity: 0.13 },
      { pitch: C2, onsetSec: 3.3, durationSec: 0.55, velocity: 0.95 },
      { pitch: G2, onsetSec: 3.9, durationSec: 0.12, velocity: 0.11 },
      { pitch: E1, onsetSec: 4.2, durationSec: 0.9 }
    ]
  },
  {
    name: 'accents',
    stresses: 'the ordinary case: offbeat octaves played lighter than the downbeat roots under them',
    // Sixteen eighths at 108 BPM, root on the beat and its octave off it, the
    // offbeats plucked at a third of the weight. This is a bassline anyone
    // would play, and every offbeat in it is a real note at +12 over a root
    // three times its strength - the shape an amplitude cut is built to
    // delete. What the detector hands back for those offbeats is a
    // *confidence* around 1.3 times the root's, not 0.3, which is the
    // clearest single illustration in the set that the two are not the same
    // quantity.
    notes: [E1, E2, E1, E2, G1, G2, G1, G2, A1, A2, A1, A2, C2, C3, C2, C3].map(
      (pitch, i) => ({
        pitch,
        onsetSec: (i * 60) / 108 / 2,
        durationSec: 0.45,
        velocity: i % 2 === 0 ? 1 : 0.32
      })
    )
  }
];

export function materialDurationSec(material: Material): number {
  return Math.max(...material.notes.map(n => n.onsetSec + n.durationSec)) + 0.3;
}

/**
 * Renders a material to mono audio at `rate`.
 *
 * Velocity reaches the string as the pluck it is - `karplusStrong` scales the
 * initial displacement - rather than as a gain on the voice it returns. The
 * mix is then normalised once, at the end, over the whole material: that is
 * what makes a note at velocity 0.22 actually quiet *relative to the root
 * ringing beside it*, and it is why scaling the rendered output instead would
 * be a strict no-op here rather than a dynamic.
 *
 * Nothing else in this function encodes a view about which notes a detector
 * should find easier.
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
      1000 + index * 7919,
      note.velocity ?? 1
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
