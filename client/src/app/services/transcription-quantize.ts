import {
  BeatDoc,
  DurationValue,
  NotePitch,
  TimeSignature,
  createDefaultBeatEffects,
  createDefaultNoteEffects
} from '../models/composer.model';
import { FinestDivision } from '../models/transcription.model';

/** A note already placed on the fretboard, still waiting for a duration. */
export interface PlacedNote {
  /** Position within the bar, in denominator-unit beats. */
  beatInBar: number;
  pitch: NotePitch;
}

/** One writable duration: a note value plus 0-2 augmentation dots. */
export interface DurationUnit {
  duration: DurationValue;
  dots: number;
  slots: number;
}

/** Slots added by each augmentation dot: none, half again, three quarters again. */
const DOT_MULTIPLIER = [1, 1.5, 1.75];

/**
 * Dots this module will write.
 *
 * Double dots are legal, and `DOT_MULTIPLIER` still measures them so
 * `beatSlots` can size a beat that came from somewhere else. But they are rare
 * enough in real parts to read as a mistake, and longest-first decomposition
 * reaches for them constantly: the rest in front of a note on the "and of 4"
 * comes out as a single double-dotted half. One dot is the practical ceiling.
 */
const MAX_WRITTEN_DOTS = 1;

/** Every duration expressible on this grid, longest first. */
function durationTable(finestDivision: number): DurationUnit[] {
  const values: DurationValue[] = [1, 2, 4, 8, 16, 32, 64];
  const table: DurationUnit[] = [];

  for (const duration of values) {
    for (let dots = 0; dots <= MAX_WRITTEN_DOTS; dots++) {
      const slots = (finestDivision / duration) * DOT_MULTIPLIER[dots];
      if (Number.isInteger(slots) && slots >= 1) {
        table.push({ duration, dots, slots });
      }
    }
  }

  return table.sort((a, b) => b.slots - a.slots);
}

/**
 * The strong points of a bar, in slots.
 *
 * Longest-first decomposition only knows how long a span is, never where it
 * starts, and that is enough to produce spellings a reader has to decode: a
 * note on the "and of 2" of a 4/4 bar comes out as a half note plus an eighth,
 * a half note that begins halfway through beat 2 and hides the middle of the
 * bar. Cutting spans at these offsets first is what turns that into the
 * eighth-tied-to-half a reader expects.
 */
export interface MetricFrame {
  /**
   * Slots in one felt beat: a quarter in 4/4, a dotted quarter in 6/8. Not the
   * denominator unit, which in a compound meter is a subdivision of the beat.
   */
  beatUnit: number;
  /** Slots to the middle of the bar, or null if the bar has no even middle. */
  halfBar: number | null;
}

/** Reads the felt beat and the half-bar off a time signature. */
export function metricFrame(
  timeSignature: TimeSignature,
  slotsPerBeat: number
): MetricFrame {
  // 6/8, 9/8 and 12/8 are felt in dotted-quarter groups of three eighths. 3/8
  // is not: it is three beats, not one group of three.
  const isCompound =
    (timeSignature.denominator === 8 || timeSignature.denominator === 16)
    && timeSignature.numerator % 3 === 0
    && timeSignature.numerator > 3;

  const beatUnit = slotsPerBeat * (isCompound ? 3 : 1);
  const totalSlots = timeSignature.numerator * slotsPerBeat;
  const feltBeats = totalSlots / beatUnit;

  return {
    beatUnit,
    // The ear hears the middle of an even bar whether or not anything is
    // written there, which is why 4/4 splits at the half-bar and 3/4 does not.
    halfBar: feltBeats % 2 === 0 ? totalSlots / 2 : null
  };
}

/**
 * Cuts a span into fragments no single written value should cross.
 *
 * At most two cuts: one to finish the beat the span starts inside, and one at
 * the half-bar. What follows starts on a beat and is left alone, so a whole
 * note is still a whole note and a dotted half still a dotted half. Only spans
 * that begin off the beat, or straddle the middle of the bar, get broken up.
 */
function metricFragments(
  startSlot: number,
  slots: number,
  frame: MetricFrame
): { start: number; slots: number }[] {
  const fragments: { start: number; slots: number }[] = [];
  let start = startSlot;
  let remaining = slots;

  const intoBeat = start % frame.beatUnit;
  if (intoBeat !== 0) {
    const head = Math.min(remaining, frame.beatUnit - intoBeat);
    fragments.push({ start, slots: head });
    start += head;
    remaining -= head;
  }

  if (remaining > 0 && frame.halfBar !== null) {
    const nextHalf = (Math.floor(start / frame.halfBar) + 1) * frame.halfBar;
    if (nextHalf < start + remaining) {
      const head = nextHalf - start;
      fragments.push({ start, slots: head });
      start += head;
      remaining -= head;
    }
  }

  if (remaining > 0) fragments.push({ start, slots: remaining });

  return fragments;
}

/**
 * Decomposes a span of grid slots into writable durations, longest first
 * within each metric fragment.
 *
 * Guaranteed to sum to exactly `slots`, whatever the fragments come out as,
 * because one slot is by definition the finest division and so is always
 * available as a last resort. That guarantee is what keeps every derived bar
 * exactly full; the fragmenting only decides how the span is spelled.
 */
export function slotsToDurations(
  slots: number,
  finestDivision: FinestDivision,
  startSlot: number,
  frame: MetricFrame
): DurationUnit[] {
  const table = durationTable(finestDivision);
  const out: DurationUnit[] = [];

  for (const fragment of metricFragments(startSlot, slots, frame)) {
    let remaining = fragment.slots;

    while (remaining > 0) {
      const unit = table.find(candidate => candidate.slots <= remaining);
      if (!unit) break;
      out.push(unit);
      remaining -= unit.slots;
    }
  }

  return out;
}

/**
 * Lays a bar's notes onto the rhythmic grid.
 *
 * Onsets are snapped to slots, simultaneous notes collapse into a chord, each
 * note runs until the next one starts, and gaps become rests. A note whose
 * span no single value can express is split and tied rather than rounded, so
 * the bar total never moves.
 */
export function quantizeBar(
  notes: PlacedNote[],
  timeSignature: TimeSignature,
  finestDivision: FinestDivision
): BeatDoc[] {
  const slotsPerBeat = finestDivision / timeSignature.denominator;
  if (!Number.isInteger(slotsPerBeat) || slotsPerBeat < 1) {
    throw new Error(
      `finestDivision ${finestDivision} cannot express a ` +
      `${timeSignature.numerator}/${timeSignature.denominator} bar`
    );
  }

  // A fractional numerator is the one route by which a non-integer span could
  // reach slotsToDurations, where it would silently under-sum rather than
  // fail. TimeSignature types the numerator as a bare number, so the type
  // system cannot rule this out the way FinestDivision rules out bad grids.
  if (!Number.isInteger(timeSignature.numerator) || timeSignature.numerator < 1) {
    throw new Error(
      `numerator ${timeSignature.numerator} is not a whole number of beats`
    );
  }

  const totalSlots = timeSignature.numerator * slotsPerBeat;

  const chords = new Map<number, NotePitch[]>();
  for (const note of notes) {
    const slot = Math.min(
      totalSlots - 1,
      Math.max(0, Math.round(note.beatInBar * slotsPerBeat))
    );
    const existing = chords.get(slot);
    if (existing) existing.push(note.pitch);
    else chords.set(slot, [note.pitch]);
  }

  const frame = metricFrame(timeSignature, slotsPerBeat);
  const beats: BeatDoc[] = [];

  const emit = (start: number, slots: number, pitches: NotePitch[] | null): void => {
    slotsToDurations(slots, finestDivision, start, frame).forEach((unit, index) => {
      beats.push({
        duration: unit.duration,
        dots: unit.dots,
        tuplet: null,
        isRest: pitches === null,
        notes: (pitches ?? []).map(pitch => ({
          pitch,
          // Only the first fragment is struck; the rest are held over.
          isTied: index > 0,
          accidental: 'auto' as const,
          effects: createDefaultNoteEffects()
        })),
        dynamics: null,
        lyrics: null,
        text: null,
        effects: createDefaultBeatEffects()
      });
    });
  };

  const starts = [...chords.keys()].sort((a, b) => a - b);

  if (starts.length === 0) {
    emit(0, totalSlots, null);
    return beats;
  }

  if (starts[0] > 0) emit(0, starts[0], null);

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : totalSlots;
    // Non-null assertion is sound: `start` came out of `chords.keys()`, so the
    // map is guaranteed to hold an entry for it.
    emit(start, end - start, chords.get(start)!);
  });

  return beats;
}

/** Slots a beat list occupies. Used to assert bars come out exactly full. */
export function beatSlots(beats: BeatDoc[], finestDivision: number): number {
  return beats.reduce(
    (sum, beat) => sum + (finestDivision / beat.duration) * DOT_MULTIPLIER[beat.dots],
    0
  );
}
