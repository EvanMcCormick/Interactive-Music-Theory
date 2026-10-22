import {
  MOTION_REASON_TEXT,
  NextChordTarget,
  NextChords,
  triadFamilyAt,
  triadFamilyOf
} from '../../../../services/progression-next-chords';
import { PaletteChord, PaletteOption } from './chord-palette.component';

/**
 * The next-chord hints on the palette: which buttons carry the mark, and the
 * caption that names the selected chord and the motion to each target.
 *
 * Pure, like its two siblings: the component hands it the answer
 * `likelyNextDegrees` gave and the buttons it already built, and binds what
 * comes back. Labels are finished here rather than concatenated in the
 * template, on `PaletteChord.label`'s rule.
 */

/** What a hinted button adds to the label it says aloud. */
export const HINT_SUFFIX = ', a common next chord';

const UNSUPPORTED_CAPTION = 'Next-chord hints cover major, minor and the church modes';

/** The selected chord as the strip card names it. See `describeSlot`. */
export interface HintSubject {
  numeral: string;
  name: string;
  /** Spoken. */
  subject: string;
}

export interface HintInput {
  /** Null when the toggle is off or nothing hintable is selected. */
  next: NextChords | null;
  subject: HintSubject | null;
  scaleIntervals: readonly number[];
  chords: readonly PaletteChord[];
  borrowed: readonly PaletteOption[];
}

export interface HintedPalette {
  chords: readonly PaletteChord[];
  borrowed: readonly PaletteOption[];
  caption: string | null;
  spokenCaption: string | null;
}

type Button = PaletteChord | PaletteOption;

interface Hit {
  button: Button;
  target: NextChordTarget;
}

export function hintPalette(input: HintInput): HintedPalette {
  const { next, subject } = input;
  if (next === null || subject === null) return unmarked(input, null, null);

  switch (next.kind) {
    case 'unsupported':
      return unmarked(input, UNSUPPORTED_CAPTION, UNSUPPORTED_CAPTION);
    case 'any':
      return unmarked(
        input,
        `After ${subject.numeral} (${subject.name}): any chord — the tonic can go anywhere`,
        `After ${subject.subject}: any chord, the tonic can go anywhere`
      );
    case 'none':
      return unmarked(input, ...noEntry(subject));
    case 'targets':
      return marked(input, subject, next.targets);
  }
}

function marked(input: HintInput, subject: HintSubject, targets: readonly NextChordTarget[]): HintedPalette {
  const hits: Hit[] = [];
  for (const target of targets) {
    const button = buttonFor(target, input);
    // One mark per button, kept at its first reason: two rows that land on the
    // same button would otherwise print it twice.
    if (button && !hits.some(hit => hit.button === button)) hits.push({ button, target });
  }

  if (hits.length === 0) return unmarked(input, ...noEntry(subject));

  const isHit = (button: Button): boolean => hits.some(hit => hit.button === button);
  const reason = (hit: Hit): string => MOTION_REASON_TEXT[hit.target.reason];

  return {
    chords: input.chords.map(chord => mark(chord, isHit(chord))),
    borrowed: input.borrowed.map(option => mark(option, isHit(option))),
    caption: `After ${subject.numeral} (${subject.name}): ${hits
      .map(hit => `${hit.button.numeral} — ${reason(hit)}`)
      .join(' · ')}`,
    spokenCaption: `After ${subject.subject}: ${hits
      .map(hit => `${hit.button.spoken}, ${reason(hit)}`)
      .join('; ')}`
  };
}

/**
 * The button a target lands on: the diatonic chord on its root with its triad,
 * else a Borrowed option on its root with its triad, else the diatonic chord on
 * its root whatever its triad. Design doc, section 2, "Matching a target".
 */
function buttonFor(target: NextChordTarget, input: HintInput): Button | undefined {
  const { scaleIntervals, chords, borrowed } = input;
  const diatonic = target.alter === 0 ? chords.find(chord => chord.degree === target.degree) : undefined;

  if (diatonic && triadFamilyAt(scaleIntervals, target.degree) === target.family) return diatonic;

  const option = borrowed.find(
    candidate =>
      candidate.degree === target.degree &&
      candidate.alter === target.alter &&
      // Never null on the Borrowed row, which always names its shape; the type
      // allows it because `ChordChoice` is also the diatonic row's "as the key
      // gives it".
      candidate.quality !== null &&
      triadFamilyOf(candidate.quality) === target.family
  );

  return option ?? diatonic;
}

function mark<T extends Button>(button: T, hinted: boolean): T {
  return hinted ? { ...button, hinted, label: `${button.label}${HINT_SUFFIX}` } : button;
}

function unmarked(input: HintInput, caption: string | null, spokenCaption: string | null): HintedPalette {
  return { chords: input.chords, borrowed: input.borrowed, caption, spokenCaption };
}

function noEntry(subject: HintSubject): [string, string] {
  return [
    `No common next chord after ${subject.numeral} (${subject.name})`,
    `No common next chord after ${subject.subject}`
  ];
}
