import {
  CHORD_EXTENTS,
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  normalizeChordSlot,
  normalizeProgressionDoc
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import { ChordExtent, degreeQuality } from './progression-harmony';

/**
 * The pure decisions the progression's edit path makes.
 *
 * Split out of `ProgressionService` because none of them is about state: each
 * takes a slot, a degree or a document and hands one back, with no subject, no
 * injection and no history. The service is the funnel that decides *when* they
 * run and what it does with the answers; this is what the answers are,
 * checkable the way `progression-harmony.ts` and `progression-voicing.ts` are.
 *
 * The seam is drawn at Angular rather than at anything arbitrary. The one thing
 * the service knows that this file cannot is which scale a `scaleId` names -
 * that is `MusicTheoryService`, which is injected - so `regenerateSlot` takes
 * the intervals rather than the id, and the service resolves them.
 *
 * `CLAUDE.md` caps a file at 500 lines and the service had grown past it, which
 * is what prompted the split; the seam is where it is because everything on
 * this side of it was already the part that was never about state.
 */

/**
 * The rung of the `CHORD_EXTENTS` ladder that `extent` means, or null when it
 * means nothing.
 *
 * The parameter is `number` rather than `ChordExtent` deliberately, because
 * handling values outside that union is the whole of what this function is for
 * and a signature saying otherwise would be a lie about its job. The values do
 * arrive: `CHORD_EXTENTS[5]` and `CHORD_EXTENTS[-1]` are both `undefined` at
 * runtime whatever their static type, and a caller that computed an extent
 * rather than indexing one can produce anything at all.
 *
 * `undefined` and the other non-finite values are refused rather than clamped,
 * because off the top and off the bottom are the same value and there is no end
 * to clamp *toward*. `stepSlotExtent` is what a +/- control should use, and it
 * clamps before it ever gets here - it steps an *index* into the ladder, which
 * has two distinguishable ends where a value has none.
 *
 * A finite value that is simply not a rung snaps to the nearest, which clamps
 * at both ends: 14 and 100 both give 13, 2 and -50 both give 3. A tie resolves
 * low, because the search keeps the rung it has unless a later one is strictly
 * closer.
 */
export function nearestExtent(extent: number): ChordExtent | null {
  if (CHORD_EXTENTS.includes(extent as ChordExtent)) return extent as ChordExtent;
  if (!Number.isFinite(extent)) return null;
  return CHORD_EXTENTS.reduce((best, rung) =>
    Math.abs(rung - extent) < Math.abs(best - extent) ? rung : best
  );
}

/**
 * Whether two degrees would build the same chord.
 *
 * The comparisons are collected into a `Record<keyof ChordDegree, boolean>`
 * rather than chained with `&&`, so that a field added to `ChordDegree` and
 * forgotten here is a compile error rather than a comparison that silently
 * stops noticing an edit - and an edit this fails to notice is one that is
 * never committed.
 */
export function sameDegree(a: ChordDegree, b: ChordDegree): boolean {
  const matches: Record<keyof ChordDegree, boolean> = {
    degree: a.degree === b.degree,
    alter: a.alter === b.alter,
    extent: a.extent === b.extent,
    quality: a.quality === b.quality,
    inversion: a.inversion === b.inversion,
    suspension: a.suspension === b.suspension,
    octave: a.octave === b.octave
  };
  return Object.values(matches).every(match => match);
}

/**
 * Gives a slot's notes the slot's own length.
 *
 * Resizing is timing and not harmony. A block chord is one attack filling the
 * slot, so the new length is the only thing about the notes that changes -
 * which means a resize needs no scale, and works in a key that cannot build
 * chords at all. Regenerating from the degree would need one, and would refuse.
 *
 * **A literal slot is returned untouched, notes and all.** Its notes are the
 * playback truth - the same rule `generateSlotNotes` states by handing a
 * literal slot its own array straight back - so shortening such a slot leaves
 * notes hanging past its end and lengthening it leaves silence at the end.
 * Stretching them to fit a drag would be the app rewriting what the user
 * played. Nothing in M1 creates a literal slot; M3 does, and this is the
 * consequence it inherits rather than discovers.
 */
export function retimeNotes(slot: ChordSlot): ChordSlot {
  if (slot.harmony.kind === 'literal') return slot;
  return {
    ...slot,
    notes: slot.notes.map(note => ({ ...note, lengthBeats: slot.lengthBeats }))
  };
}

/**
 * Lays slots end to end, so the timeline has no hole and no overlap.
 *
 * Every slot is rebuilt rather than only the ones that moved. There is nothing
 * to preserve by doing otherwise: this runs inside `settle()`, downstream of
 * `normalizeProgressionDoc`, which maps every slot through `normalizeChordSlot`
 * and that spreads unconditionally - so identity is already gone by the time
 * the slots arrive here. A component rendering them tracks by `slot.id`, which
 * is what `trackBy` is for.
 */
export function reflow(slots: readonly ChordSlot[]): ChordSlot[] {
  let beat = 0;
  return slots.map(slot => {
    const placed = { ...slot, startBeat: beat };
    beat += slot.lengthBeats;
    return placed;
  });
}

/**
 * Bounds a document and lays its slots end to end.
 *
 * Normalise, then re-flow, and the order is not interchangeable: a length
 * clamped after the positions had been summed from it would leave every later
 * slot starting in the wrong place.
 */
export function settle(doc: ProgressionDoc): ProgressionDoc {
  const bounded = normalizeProgressionDoc(doc);
  return { ...bounded, slots: reflow(bounded.slots) };
}

/**
 * Re-derives everything a slot's harmony decides: its quality label and its
 * notes.
 *
 * Bounds first, generate second. The order is load-bearing for the same reason
 * it is in `commit()`: `generateSlotNotes` copies `lengthBeats` onto every note
 * it makes, so generating from an unbounded slot would give the notes a length
 * the slot itself is then clamped away from.
 *
 * `scaleIntervals` is null when the key's scale cannot stack thirds at all -
 * unknown id, or not seven notes - and then the slot comes back bounded and
 * otherwise untouched. `degreePitchClasses` would throw on such a scale, so
 * this is the check that keeps the throw from happening rather than catching
 * it, and it is the only one on the regeneration path: `setKey` leans on it
 * instead of repeating it. `appendSlot` and the degree steppers ask
 * `canBuildChords` first for a different reason - they need to *refuse*, and a
 * slot handed back unchanged is not a refusal.
 */
export function regenerateSlot(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[] | null
): ChordSlot {
  const bounded = normalizeChordSlot(slot);
  if (!scaleIntervals) return bounded;

  const labelled: ChordSlot =
    bounded.harmony.kind === 'degree'
      ? {
          ...bounded,
          harmony: {
            kind: 'degree',
            degree: {
              ...bounded.harmony.degree,
              quality: degreeQuality(
                scaleIntervals,
                bounded.harmony.degree.degree,
                bounded.harmony.degree.extent
              )
            }
          }
        }
      : bounded;

  const notes = generateSlotNotes(labelled, key, scaleIntervals);
  // A literal slot gets its own array back by identity, and copying it would
  // report a change where none happened. Copy only what was built fresh.
  return notes === labelled.notes ? labelled : { ...labelled, notes: notes.slice() };
}

/**
 * The document back, if no two of its slots share an id.
 *
 * Ids are how every method on the service finds a slot, and a repeated one
 * breaks them in different directions: `removeSlot` filters by id and drops
 * both twins, while `replaceSlot` finds the first and edits it twice over. A
 * document like that arrives from a file rather than from a user, so it is a
 * corrupt document rather than a control at its limit - the wrong-kind clause
 * of the model's normalisation rule, which throws.
 *
 * It is checked at `replaceDocument` rather than inside `settle()`, because
 * that is the only door a document the service did not build comes through.
 */
export function requireUniqueSlotIds(doc: ProgressionDoc): ProgressionDoc {
  const seen = new Set<string>();
  for (const slot of doc.slots) {
    if (seen.has(slot.id)) {
      throw new Error(`ProgressionDoc slots must have distinct ids; ${slot.id} is repeated`);
    }
    seen.add(slot.id);
  }
  return doc;
}
