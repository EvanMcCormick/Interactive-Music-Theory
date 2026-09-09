import {
  CHORD_EXTENTS,
  DEFAULT_VELOCITY,
  normalizeChordSlot,
  normalizeProgressionDoc
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionDoc,
  ProgressionKey,
  RollNote
} from '../models/progression.model';
import { generateSlotNotes } from './progression-generate';
import { ChordExtent } from './progression-harmony';

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
 * Hands a slot's pitches back to the generator.
 *
 * The one thing a command may do to ownership that the user did not do
 * directly, and it is narrow on purpose: it is for a command that **restates
 * the chord or its voicing** - `setSlotExtent`, `stepSlotExtent`,
 * `setSlotInversion`, `setSlotOctave`. Without it those four collide with a
 * claim over `pitches`, and the collision is not a near miss. A complexity step
 * on such a slot writes `extent: 7`, so `effectiveQuality` prints `Imaj7` on
 * the card, while `mergeNotes` hands back the three pitches the user was
 * holding: the stepper does nothing audible and mislabels the slot in the same
 * press. `effectiveQuality`'s own docstring spends two sections arguing that
 * exactly that - the label disagreeing with the synth about one chord on one
 * card - is the failure it exists to prevent.
 *
 * Between honouring the request and preserving the pitches the user is in the
 * act of replacing, the request wins. It is undoable, which is what makes that
 * safe: one press of undo puts the claimed voicing back, where a stepper that
 * silently refused to move would leave the user with no way to find out why.
 *
 * **A key change does not reclaim.** Preserving a voicing across a
 * transposition is the entire point of the merge, and a key change restates no
 * chord - it moves every chord at once, which is what `transposeBy` is for.
 *
 * `timing` and `velocity` are left alone by all four, because none of them
 * restates a rhythm or a dynamic: a complexity step should keep your groove.
 */
export function reclaimPitches(slot: ChordSlot): ChordSlot {
  return { ...slot, owned: { ...slot.owned, pitches: false } };
}

/**
 * Re-derives what a slot sounds, keeping the dimensions the user has claimed.
 *
 * This is a **merge**, not a replace, and that is the idea M2 turns on. M1
 * rebuilt every note from the degree on every key change, complexity step,
 * inversion and octave shift, which was safe only while nothing but the
 * generator had ever written a note. A piano roll ends that, and the single
 * `isHandEdited` boolean it would otherwise have needed forces a bad trade in
 * both directions - see `SlotOwnership`. So the three dimensions are answered
 * separately:
 *
 * | dimension | owned | not owned |
 * |---|---|---|
 * | pitches | transposed by `transposeBy` | re-voiced from the degree |
 * | timing | kept | regenerated as a block |
 * | velocity | kept | reset to `DEFAULT_VELOCITY` |
 *
 * **`quality` is left exactly as it arrived.** M1 wrote the *derived* label
 * into it here, which is consequence 4 of the design doc's correction section:
 * an override lived until the next regeneration and no longer, so there was
 * nowhere to write a borrowed chord that kept. `null` now means "as the key
 * gives it" and is re-derived on read by `effectiveQuality` - which is where
 * the strip card and the fretboard highlight already got the name, off the
 * chord that was actually built rather than out of this field.
 *
 * **The asymmetry in the pitch row is why `transposeBy` is a parameter.**
 * Re-voicing needs only the new key, which is an argument; transposing owned
 * pitches needs the interval between the *old* key and the new one, which this
 * function cannot see. `ProgressionService.setKey` is the only caller that can
 * compute one, and every other call site passes 0 - which is not a default
 * standing in for a missing answer but the honest one: a complexity step or an
 * inversion moves no key, so there is no interval to move claimed pitches by.
 *
 * ## The two paths in here differ in intent, not only in `transposeBy`
 *
 * A **key change** regenerates to keep what the user has: the pitch row's
 * "owned" column is the whole point of the merge, because a voicing written in
 * C should follow the progression to A minor rather than be thrown away by it.
 * That path arrives with `owned` exactly as the document holds it.
 *
 * A **harmony command** - `setSlotExtent`, `stepSlotExtent`, `setSlotInversion`,
 * `setSlotOctave` - regenerates to *replace* what the user has, because that is
 * what the user just asked for: each of those restates the chord or its
 * voicing, and a stepper that left claimed pitches alone would move the label
 * without moving a note. So `ProgressionService.editDegree` calls
 * `reclaimPitches` first, and that path arrives with `owned.pitches` already
 * false. This function does not know which path it is on and does not need to:
 * the caller has already said so in the only vocabulary it reads.
 *
 * The consequence for the table is that its pitch row's "owned" column is
 * reachable **from the key path alone**. `owned.timing` and `owned.velocity`
 * are untouched on both - a complexity step keeps your rhythm and your
 * dynamics, because neither is a restatement of the chord.
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
  scaleIntervals: readonly number[] | null,
  transposeBy = 0
): ChordSlot {
  // The first clause of the model's normalisation rule, one road over. This
  // number is added straight to `RollNote.midi`, which reaches
  // `Tone.PolySynth` with nothing in between that looks at it again - so a
  // `NaN` interval is silence rather than an error, three layers from the
  // caller that computed it. Checked before anything else, because the caller
  // passing one is the bug whether or not this particular slot would have used
  // it.
  if (!Number.isInteger(transposeBy)) {
    throw new Error(
      `regenerateSlot transposeBy must be a whole number of semitones to ` +
        `transpose owned pitches by; got ${transposeBy}`
    );
  }

  const bounded = normalizeChordSlot(slot);
  if (!scaleIntervals) return bounded;

  const generated = generateSlotNotes(bounded, key, scaleIntervals);
  // A literal slot gets its own array back by identity, and there is nothing
  // to merge it with: its notes ARE the truth, so every dimension of them is
  // the user's whatever `owned` says. Returning early also keeps the copy from
  // happening, which would report a change where none happened - and keeps the
  // velocity column of the table above off a slot that never asked the app for
  // a note in the first place.
  if (generated === bounded.notes) return bounded;

  return { ...bounded, notes: mergeNotes(bounded, generated, transposeBy) };
}

/**
 * The table in `regenerateSlot`, applied note by note.
 *
 * **Pitches decide how many notes there are**, because a note is a pitch: a
 * user who added or removed one owns that count, and a re-voiced chord brings
 * its own. The other two dimensions are then read at the same index from
 * whichever list owns them, which is the only correspondence available - the
 * chord is a different set of notes after a re-voice, so there is no note to
 * carry an identity across the change. That is also why `SlotOwnership` is per
 * slot rather than per note.
 *
 * The two lists can therefore differ in length, in both directions, and both
 * are reachable from one complexity step on a slot the user has claimed. The
 * shorter list is read at its last note rather than off its end - see
 * `noteAt`.
 */
function mergeNotes(
  slot: ChordSlot,
  generated: readonly RollNote[],
  transposeBy: number
): RollNote[] {
  const held = slot.notes;
  const owned = slot.owned;

  // The list is walked rather than rebuilt: the map below writes every field of
  // every note anyway, so a transposed copy made here would be an object built
  // to have one number read off it. The shift is hoisted to match - it is 0 on
  // the re-voiced branch by the same argument that makes `transposeBy` 0 at
  // every call site but `setKey`: a chord rebuilt from the degree is already in
  // the new key, so moving it again would move it twice.
  const pitched = owned.pitches ? held : generated;
  const shift = owned.pitches ? transposeBy : 0;

  return pitched.map((note, index) => {
    // `note` as the last resort rather than a written-out block: when timing is
    // not owned the source *is* the generated list, so this falls back to the
    // note it is already standing on, and the block-chord rule stays stated in
    // `generateSlotNotes` alone. It is only reached by a claim over an empty
    // note list, which `replaceDocument` can bring in.
    const timing = noteAt(owned.timing ? held : generated, index) ?? note;

    return {
      midi: note.midi + shift,
      startBeat: timing.startBeat,
      lengthBeats: timing.lengthBeats,
      velocity: owned.velocity
        ? noteAt(held, index)?.velocity ?? DEFAULT_VELOCITY
        : DEFAULT_VELOCITY
    };
  });
}

/**
 * The note at `index`, the last note when the list is shorter than that, or
 * null when it holds none.
 *
 * The clamp is the answer to a chord that grew past the notes the user owns -
 * a complexity step under a hand-written rhythm, where the new seventh has no
 * claimed counterpart at its index. It joins the last note the user placed,
 * because a chord tone added under a rhythm belongs to the event that rhythm
 * ends on; springing back to the slot's start and full length would make it the
 * one voice ignoring the groove.
 *
 * ## One extra note is the easy case, and not the argument
 *
 * The gap is a gap and not an off-by-one: three held notes against a thirteenth
 * chord's seven puts **four** notes on the last onset, all sounding together
 * where the user wrote one. That is a real change to what the slot sounds like,
 * and no rule available here avoids it - the user owns three onsets and the
 * chord has seven notes, so at least two tones must share.
 *
 * The clamp is still the right rule, for a stronger reason than "the last event
 * is the closest one". It keeps the onsets **monotone in chord-tone order**:
 * read up the stack and the attacks never go backwards. The obvious
 * alternative - wrapping round to note 0 - would put the eleventh and the
 * thirteenth at the *start* of an ascending arpeggio and the root at its end,
 * inverting the figure the user actually wrote. And the clamp invents no
 * attack: every onset in the result is one the user placed, where spreading the
 * overflow across the slot would be the app writing rhythm on their behalf.
 * Piling notes onto an onset that exists is a smaller lie than inventing one
 * that does not.
 *
 * **The same clamp decides velocity, and there it has a shape worth knowing.**
 * The overflow tones inherit the *last* note's velocity, so under a decrescendo
 * the chord tones the step adds are the quietest notes in the slot - the added
 * seventh and ninth arrive under the chord rather than on top of it. That reads
 * as a deliberate voicing more often than not, but it is a consequence of the
 * clamp rather than a decision about dynamics, and a roll that later wants to
 * spread the added tones should change both dimensions together.
 *
 * `null` rather than `undefined` so the caller has to say what an empty list
 * means for its own dimension, which is not the same answer twice: timing falls
 * back to the regenerated note and velocity to `DEFAULT_VELOCITY`.
 */
function noteAt(notes: readonly RollNote[], index: number): RollNote | null {
  if (notes.length === 0) return null;
  return notes[Math.min(index, notes.length - 1)];
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
