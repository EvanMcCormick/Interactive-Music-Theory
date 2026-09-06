import {
  BeatDoc,
  DurationValue,
  NotePitch,
  TimeSignature,
  createDefaultBeatEffects,
  createDefaultNoteEffects
} from '../models/composer.model';
import { FinestDivision } from '../models/transcription.model';

/**
 * Lays a bar's onsets onto a rhythmic grid and gives them written durations.
 *
 * Two guarantees, in that order of importance. A bar always sums to exactly
 * one bar: onsets snap to slots and the span between two of them is
 * decomposed into values that fill it exactly, so notation cannot drift the
 * way it does when each onset is rounded and handed its own independent
 * duration. And the meter stays visible: a span is cut where it crosses a
 * beat or the middle of the bar without being aligned to it, before values
 * are chosen, because a value that merely fits the length can still hide
 * every beat it crosses.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the arithmetic can be checked directly
 * against hand-written bars.
 */

/** A note already placed on the fretboard, still waiting for a duration. */
export interface PlacedNote {
  /** Position within the bar, in denominator-unit beats. */
  beatInBar: number;
  pitch: NotePitch;
}

/**
 * Where a placed note ended up on the written page.
 *
 * The one fact about a bar that only this module holds. A `BeatDoc` records
 * what is drawn, never which detection it was drawn for: `emit` copies the
 * pitch rather than aliasing it, so even object identity is gone by the time a
 * caller has the beat list back. Reconstructing the link afterwards means
 * re-deriving `snapToSlots`' clustering and rounding from the same inputs -
 * a second copy of the rules this module exists to be the only copy of.
 *
 * Reported per *fragment*, not per attack. A span no single value can write
 * comes back as a tie, and every fragment of it is the same musical note, so
 * each one names the note it continues; `isTied` says which is the head. That
 * is what lets a reader who clicks the held half of a tie be answered with the
 * note they can see rather than with nothing.
 */
export interface WrittenNote {
  /** Index into the beat list `quantizeBar` returned. */
  beat: number;
  /** The note that was written, by identity with the one handed in. */
  note: PlacedNote;
  /** True for the held fragments of a tie, false for the struck head. */
  isTied: boolean;
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
function durationTable(finestDivision: FinestDivision): DurationUnit[] {
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
 * Widest gap between two onsets that still counts as one attack.
 *
 * Half a slot is the natural tolerance, being exactly the rounding radius, but
 * on a coarse grid half a slot is a rhythm rather than a chord: at
 * `finestDivision: 4` it is a whole eighth note. So it is capped here too, at
 * a thirty-second note's worth of beat - about 62 ms at 120 BPM, comfortably
 * wider than the 30-40 ms a hand takes to cross the strings.
 */
const MAX_CHORD_SPREAD_BEATS = 0.125;

/**
 * The window inside which two onsets are merged into one chord, in
 * denominator-unit beats - the units `secondsToBeats` reports and `PlacedNote`
 * carries.
 *
 * Exported because it is a contract, not an implementation detail.
 * `addToChord` drops the second of two notes merged onto one string, so
 * `assignFingering` has to have already moved apart everything this window
 * will merge. It cannot check that for itself: it runs before bars exist and
 * knows nothing of slots, so `score-derivation.ts` reads the window here and
 * hands it across. An independently sized window there - the 30 ms constant
 * this replaced - left a band of separations wide enough to merge and too wide
 * to separate, where the second note vanished with no rest, no error and no
 * record.
 */
export function chordToleranceBeats(slotsPerBeat: number): number {
  return Math.min(0.5 / slotsPerBeat, MAX_CHORD_SPREAD_BEATS);
}

/**
 * Adds a note to a chord, dropping it if its string is already spoken for.
 *
 * A tab line holds one number, so a fretted staff shows at most one note per
 * string - the invariant `ComposerService.setNoteAtCursor` enforces on the
 * editing side. Two co-incident notes fingered to the same string, or one
 * onset detected twice, would otherwise write two numbers on one line. The
 * earlier onset wins.
 *
 * The loser is appended to `dropped` when the caller supplied one. It is the
 * only note this module can lose, and losing it without a record is what makes
 * it dangerous: the score that comes back is perfectly well formed and simply
 * has one fewer note in it than the performance did.
 */
function addToChord(
  chord: PlacedNote[],
  note: PlacedNote,
  dropped: PlacedNote[] | undefined
): void {
  const pitch = note.pitch;

  if (
    pitch.kind === 'fretted'
    && chord.some(
      taken => taken.pitch.kind === 'fretted' && taken.pitch.string === pitch.string
    )
  ) {
    dropped?.push(note);
    return;
  }

  chord.push(note);
}

/**
 * Groups a bar's onsets onto grid slots, one chord per slot.
 *
 * Onsets are clustered before they are rounded, not after. Rounding first and
 * merging on the result splits a chord whenever its notes straddle a slot
 * midpoint - for a 40 ms spread at 120 BPM on a sixteenth grid, roughly a
 * third of the time - and writes the two halves as separate attacks a
 * thirty-second apart, which is exactly the raggedness this module exists to
 * avoid.
 */
function snapToSlots(
  notes: PlacedNote[],
  slotsPerBeat: number,
  totalSlots: number,
  dropped: PlacedNote[] | undefined
): Map<number, PlacedNote[]> {
  const tolerance = chordToleranceBeats(slotsPerBeat) * slotsPerBeat;
  const sorted = [...notes].sort((a, b) => a.beatInBar - b.beatInBar);

  const clusters: { onsets: number[]; notes: PlacedNote[] }[] = [];
  for (const note of sorted) {
    const onset = note.beatInBar * slotsPerBeat;
    const open = clusters[clusters.length - 1];

    // Measured from the cluster's first onset rather than its last, so a run
    // of closely spaced notes cannot chain into one arbitrarily wide chord.
    if (open && onset - open.onsets[0] <= tolerance) {
      open.onsets.push(onset);
      open.notes.push(note);
    } else {
      clusters.push({ onsets: [onset], notes: [note] });
    }
  }

  const chords = new Map<number, PlacedNote[]>();
  for (const cluster of clusters) {
    const centre =
      cluster.onsets.reduce((sum, onset) => sum + onset, 0) / cluster.onsets.length;
    const slot = Math.min(totalSlots - 1, Math.max(0, Math.round(centre)));

    let chord = chords.get(slot);
    if (!chord) {
      chord = [];
      chords.set(slot, chord);
    }

    // Two clusters can still round onto one slot on a coarse grid, so the
    // per-string check belongs here rather than inside the cluster loop.
    for (const note of cluster.notes) addToChord(chord, note, dropped);
  }

  return chords;
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
 * the half-bar. The rule at each level is the same - only a span that
 * *crosses* a boundary without being aligned to it needs breaking up. A span
 * that starts on a boundary and ends on one of that level or higher is
 * already spelled by a single value a reader can parse, so it is left whole:
 * a whole note stays a whole note, a dotted half a dotted half, and an empty
 * 4/4 bar one whole rest rather than two tied half rests.
 */
function metricFragments(
  startSlot: number,
  slots: number,
  frame: MetricFrame
): { start: number; slots: number }[] {
  const fragments: { start: number; slots: number }[] = [];
  let start = startSlot;
  let remaining = slots;

  // Starting on a beat is itself the alignment test at this level: the head
  // cut exists only to finish a beat the span opened partway through.
  const intoBeat = start % frame.beatUnit;
  if (intoBeat !== 0) {
    const head = Math.min(remaining, frame.beatUnit - intoBeat);
    fragments.push({ start, slots: head });
    start += head;
    remaining -= head;
  }

  if (remaining > 0 && frame.halfBar !== null) {
    const halfBar = frame.halfBar;

    // Both ends on a multiple of the half-bar - which includes the bar line,
    // the next level up, since `halfBar` is half of `totalSlots`. Such a span
    // is a unit the meter is built from, and cutting it would write a tie a
    // reader then has to undo: the bar-filling note in 4/4 is a whole note,
    // not a half tied to a half.
    const aligned = start % halfBar === 0 && (start + remaining) % halfBar === 0;

    const nextHalf = (Math.floor(start / halfBar) + 1) * halfBar;
    if (!aligned && nextHalf < start + remaining) {
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
 *
 * Throws rather than under-summing on a span it cannot fill exactly. A
 * fractional or negative span would otherwise decompose to something short
 * and the bar would silently come out wrong, which is the one failure this
 * module exists to rule out; a NaN one - the shape a NaN `beatInBar` arrives
 * in - would empty the bar with no diagnostic at all.
 */
export function slotsToDurations(
  slots: number,
  finestDivision: FinestDivision,
  startSlot: number,
  frame: MetricFrame
): DurationUnit[] {
  if (!Number.isInteger(slots) || slots < 0) {
    throw new Error(`cannot write a span of ${slots} slots`);
  }

  if (!Number.isInteger(startSlot) || startSlot < 0) {
    throw new Error(`cannot start a span at slot ${startSlot}`);
  }

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
 * Why this grid cannot write this meter, or null when it can.
 *
 * The two conditions `quantizeBar` refuses on, asked as a question instead of
 * answered with an exception. Both are combinations of things a user turns:
 * `finestDivision` is a `DerivationSettings` field and the meter comes in
 * through `TranscriptionService.updateTimeSignature`, so a caller holding a
 * working score needs to be able to find out that a change is impossible
 * *before* it destroys one. Exported for that caller; `quantizeBar` itself
 * still throws, because by then the choice has already been made and a bar it
 * cannot write is not something it can degrade into.
 *
 * The pair is what matters, not either half. `finestDivision` is typed to the
 * values the duration table can express and `TimeSignature` to a legal meter,
 * yet 4 with 6/8 and 8 with 4/16 are both grids coarser than the beat they are
 * being applied to. The numerator is checked here too: it is typed as a bare
 * number, it arrives from the same caller, and a fractional one is the other
 * way a span the duration table cannot fill reaches `slotsToDurations`.
 */
export function barGridFault(
  timeSignature: TimeSignature,
  finestDivision: FinestDivision
): string | null {
  const slotsPerBeat = finestDivision / timeSignature.denominator;
  if (!Number.isInteger(slotsPerBeat) || slotsPerBeat < 1) {
    return (
      `finestDivision ${finestDivision} cannot express a ` +
      `${timeSignature.numerator}/${timeSignature.denominator} bar`
    );
  }

  // A fractional numerator is the one route by which a non-integer span could
  // reach slotsToDurations, where it would silently under-sum rather than
  // fail. TimeSignature types the numerator as a bare number, so the type
  // system cannot rule this out the way FinestDivision rules out bad grids.
  if (!Number.isInteger(timeSignature.numerator) || timeSignature.numerator < 1) {
    return `numerator ${timeSignature.numerator} is not a whole number of beats`;
  }

  return null;
}

/**
 * Lays a bar's notes onto the rhythmic grid.
 *
 * Onsets close enough together to be one attack collapse into a chord, chords
 * are snapped to slots, each runs until the next one starts, and gaps become
 * rests. A span no single value can express is split and tied rather than
 * rounded, so the bar total never moves.
 *
 * `dropped`, if given, collects the notes this bar could not write: `addToChord`
 * keeps one note per string, and the ones it turns away are the only notes that
 * go in and do not come out. An out-parameter rather than a widened return,
 * because the return type is what the whole module is about and nine call sites
 * in the spec do not care - `score-derivation.ts` passes an array, unwraps
 * nothing, and reports upward.
 *
 * `written`, likewise, collects the other half of that account: where each note
 * that *was* written ended up. See `WrittenNote`. Together the two are
 * exhaustive - every note handed in appears in exactly one of them, once per
 * tie fragment in the second - which is the property a caller building an index
 * from rendered note back to source note needs and cannot check for itself.
 */
export function quantizeBar(
  notes: PlacedNote[],
  timeSignature: TimeSignature,
  finestDivision: FinestDivision,
  dropped?: PlacedNote[],
  written?: WrittenNote[]
): BeatDoc[] {
  const fault = barGridFault(timeSignature, finestDivision);
  if (fault !== null) throw new Error(fault);

  const slotsPerBeat = finestDivision / timeSignature.denominator;
  const totalSlots = timeSignature.numerator * slotsPerBeat;

  const chords = snapToSlots(notes, slotsPerBeat, totalSlots, dropped);
  const frame = metricFrame(timeSignature, slotsPerBeat);
  const beats: BeatDoc[] = [];

  const emit = (start: number, slots: number, chord: PlacedNote[] | null): void => {
    slotsToDurations(slots, finestDivision, start, frame).forEach((unit, index) => {
      // Read before the push, so it names the beat this fragment becomes.
      const beat = beats.length;

      beats.push({
        duration: unit.duration,
        dots: unit.dots,
        tuplet: null,
        isRest: chord === null,
        notes: (chord ?? []).map(placed => ({
          // Copied, not aliased: `ComposerService.replaceDocument` stores the
          // document by reference, so every NoteDoc needs a pitch of its own
          // or editing one tied fragment would edit the whole tie.
          pitch: { ...placed.pitch },
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

      // In step with the `notes` array above, note for note: both walk `chord`
      // in order, so `written[k].note` is the source of `beats[beat].notes[k]`.
      if (written) {
        for (const placed of chord ?? []) {
          written.push({ beat, note: placed, isTied: index > 0 });
        }
      }
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
export function beatSlots(beats: BeatDoc[], finestDivision: FinestDivision): number {
  return beats.reduce(
    (sum, beat) => sum + (finestDivision / beat.duration) * DOT_MULTIPLIER[beat.dots],
    0
  );
}
