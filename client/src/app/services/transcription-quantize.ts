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

/** Every duration expressible on this grid, longest first. */
function durationTable(finestDivision: number): DurationUnit[] {
  const values: DurationValue[] = [1, 2, 4, 8, 16, 32, 64];
  const table: DurationUnit[] = [];

  for (const duration of values) {
    for (let dots = 0; dots <= 2; dots++) {
      const slots = (finestDivision / duration) * DOT_MULTIPLIER[dots];
      if (Number.isInteger(slots) && slots >= 1) {
        table.push({ duration, dots, slots });
      }
    }
  }

  return table.sort((a, b) => b.slots - a.slots);
}

/**
 * Decomposes a span of grid slots into writable durations, longest first.
 *
 * Guaranteed to sum to exactly `slots`, because one slot is by definition the
 * finest division and so is always available as a last resort. That guarantee
 * is what keeps every derived bar exactly full.
 */
export function slotsToDurations(
  slots: number,
  finestDivision: FinestDivision
): DurationUnit[] {
  const table = durationTable(finestDivision);
  const out: DurationUnit[] = [];
  let remaining = slots;

  while (remaining > 0) {
    const unit = table.find(candidate => candidate.slots <= remaining);
    if (!unit) break;
    out.push(unit);
    remaining -= unit.slots;
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

  const beats: BeatDoc[] = [];

  const emit = (slots: number, pitches: NotePitch[] | null): void => {
    slotsToDurations(slots, finestDivision).forEach((unit, index) => {
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
    emit(totalSlots, null);
    return beats;
  }

  if (starts[0] > 0) emit(starts[0], null);

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : totalSlots;
    // Non-null assertion is sound: `start` came out of `chords.keys()`, so the
    // map is guaranteed to hold an entry for it.
    emit(end - start, chords.get(start)!);
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
