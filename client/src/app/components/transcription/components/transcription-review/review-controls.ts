import { STANDARD_BASS_TUNING, STANDARD_GUITAR_TUNING, TimeSignature } from '../../../../models/composer.model';
import { DetectedNote, FinestDivision } from '../../../../models/transcription.model';
import { DropReason } from '../../../../services/score-derivation';

/**
 * The reference data and arithmetic behind the review panel's controls.
 *
 * Split out of `TranscriptionReviewComponent` because that file crossed
 * `CLAUDE.md`'s 500-line ceiling, and this is the half that comes away
 * cleanly: no Angular, no DOM, nothing stateful - a preset list, two lookups
 * and two calculations, in the manner of `staff-pitch.ts`. Everything here can
 * be asserted without a fixture, which is why the panel's spec checks the
 * counting and the tempo reading directly rather than through the template.
 *
 * The presets are reference data in `CLAUDE.md`'s sense: string pitches are
 * facts about instruments, not settings. They are handed out by copy at the
 * one place a caller could keep them (`onTuningChange`), so nothing downstream
 * can reach back into the table through an array it was given.
 */

/** A tuning a listener can pick, shaped as `DerivationSettings.tuning` wants it. */
export interface TuningPreset {
  id: string;
  label: string;
  /** MIDI pitch per open string, highest string first. */
  tuning: number[];
}

/** A meter a listener can pick. */
export interface TimeSignaturePreset {
  id: string;
  label: string;
  value: TimeSignature;
}

/** One reason detections are missing from the score, and how many went that way. */
export interface DiscardCount {
  reason: DropReason | 'suppressed';
  label: string;
  count: number;
}

const meter = (numerator: number, denominator: number): TimeSignature => ({
  numerator,
  denominator,
  isCommon: numerator === 4 && denominator === 4
});

export const TUNING_PRESETS: readonly TuningPreset[] = [
  { id: 'bass-4', label: 'Bass, standard (G D A E)', tuning: STANDARD_BASS_TUNING },
  { id: 'bass-4-drop-d', label: 'Bass, drop D (G D A D)', tuning: [43, 38, 33, 26] },
  { id: 'bass-5', label: 'Bass, five string (G D A E B)', tuning: [43, 38, 33, 28, 23] },
  {
    id: 'guitar-6',
    label: 'Guitar, standard (E B G D A E)',
    tuning: STANDARD_GUITAR_TUNING
  },
  {
    id: 'guitar-6-drop-d',
    label: 'Guitar, drop D (E B G D A D)',
    tuning: [64, 59, 55, 50, 45, 38]
  },
  { id: 'guitar-6-eb', label: 'Guitar, half step down', tuning: [63, 58, 54, 49, 44, 39] }
];

export const TIME_SIGNATURE_PRESETS: readonly TimeSignaturePreset[] = [
  { id: '4-4', label: '4/4', value: meter(4, 4) },
  { id: '3-4', label: '3/4', value: meter(3, 4) },
  { id: '2-4', label: '2/4', value: meter(2, 4) },
  { id: '2-2', label: '2/2', value: meter(2, 2) },
  { id: '5-4', label: '5/4', value: meter(5, 4) },
  { id: '6-8', label: '6/8', value: meter(6, 8) },
  { id: '7-8', label: '7/8', value: meter(7, 8) },
  { id: '9-8', label: '9/8', value: meter(9, 8) },
  { id: '12-8', label: '12/8', value: meter(12, 8) }
];

export const FINEST_DIVISIONS: readonly { value: FinestDivision; label: string }[] = [
  { value: 4, label: 'Quarter note' },
  { value: 8, label: 'Eighth note' },
  { value: 16, label: 'Sixteenth note' },
  { value: 32, label: 'Thirty-second note' },
  { value: 64, label: 'Sixty-fourth note' }
];

const DISCARD_LABELS: Readonly<Record<DropReason | 'suppressed', string>> = {
  belowConfidence: 'below the confidence floor',
  unplayable: 'unplayable on this tuning',
  beforeGrid: 'struck before the beat grid',
  stringTaken: 'struck on a string already held',
  suppressed: 'harmonic partials'
};

/**
 * The average tempo of a grid, in BPM, or null when it does not state one.
 *
 * Read across the whole span rather than off the first interval, because a
 * tracked grid is measured beat by beat and its intervals differ: the pinned
 * fixture comes back as [0.49, 0.49, 0.51, 0.5, ...]. The span is also the
 * figure `withTempo` reproduces - it anchors on the first beat and lays an even
 * pulse out to the last - so a tempo shown here and typed straight back leaves
 * the grid roughly where it was rather than nudging it every time it is read.
 */
export function gridTempoBpm(beatsSec: readonly number[]): number | null {
  if (beatsSec.length < 2) return null;

  const span = beatsSec[beatsSec.length - 1] - beatsSec[0];
  if (!Number.isFinite(span) || span <= 0) return null;

  return Math.round((60 * (beatsSec.length - 1)) / span);
}

/** True when two tunings are the same instrument, string for string. */
export function sameTuning(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index]);
}

export const meterId = (timeSignature: TimeSignature): string =>
  `${timeSignature.numerator}-${timeSignature.denominator}`;

/**
 * The preset list, plus the session's own tuning when it matches none of them.
 *
 * Without the extra entry a select bound to an id no option carries falls back
 * to showing the first one, and the panel would state an instrument the score
 * was not derived on.
 */
export function withCurrentTuning(tuning: readonly number[]): TuningPreset[] {
  if (TUNING_PRESETS.some(preset => sameTuning(preset.tuning, tuning))) {
    return [...TUNING_PRESETS];
  }

  const plural = tuning.length === 1 ? '' : 's';
  return [
    {
      id: 'custom',
      label: `Current (${tuning.length} string${plural})`,
      tuning: [...tuning]
    },
    ...TUNING_PRESETS
  ];
}

/** The preset list, plus the session's own meter when it matches none of them. */
export function withCurrentMeter(timeSignature: TimeSignature): TimeSignaturePreset[] {
  const id = meterId(timeSignature);
  if (TIME_SIGNATURE_PRESETS.some(preset => preset.id === id)) {
    return [...TIME_SIGNATURE_PRESETS];
  }

  return [
    {
      id,
      label: `${timeSignature.numerator}/${timeSignature.denominator}`,
      value: { ...timeSignature }
    },
    ...TIME_SIGNATURE_PRESETS
  ];
}

/**
 * How many detections went each way, in the order a reader should read them.
 *
 * Zero counts are left out rather than printed: "0 unplayable" is noise beside
 * the numbers that matter, and on real material the suppression figure is an
 * order of magnitude larger than the rest put together.
 *
 * `suppressed` comes from the state rather than the derivation, because
 * harmonic suppression happened at detection time - before derivation saw
 * anything - and a reader counting what is missing from the score needs both.
 */
export function countDiscards(
  dropped: readonly { reason: DropReason }[],
  suppressed: readonly DetectedNote[]
): DiscardCount[] {
  const order: (DropReason | 'suppressed')[] = [
    'belowConfidence',
    'unplayable',
    'beforeGrid',
    'stringTaken',
    'suppressed'
  ];

  const counts = new Map<DropReason | 'suppressed', number>();
  for (const entry of dropped) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  if (suppressed.length > 0) counts.set('suppressed', suppressed.length);

  return order
    .map(reason => ({
      reason,
      label: DISCARD_LABELS[reason],
      count: counts.get(reason) ?? 0
    }))
    .filter(entry => entry.count > 0);
}
