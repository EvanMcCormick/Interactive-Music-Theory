import { CHORD_EXTENTS, normalizeChordSlot } from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ExtensionAlterations,
  ProgressionKey,
  SuspensionKind
} from '../models/progression.model';
import { nearestExtent, reclaimPitches, regenerateSlot, sameDegree } from './progression-edit';
import { chordOctaveCeiling } from './progression-generate';
import { ChordExtent, NamedQuality } from './progression-harmony';
import { ProgressionStore } from './progression-history';
import { ProgressionKeyContext } from './progression-key-context';

/**
 * A chord to put in a slot: the four fields that decide what it sounds.
 *
 * `appendChord` and `setSlotChord` take one. It is a `ChordDegree` minus the
 * three fields a *voicing* owns - inversion, suspension and octave - because a
 * caller naming a chord is not thereby choosing how it is laid out: an appended
 * chord takes the factory's voicing and a retuned one keeps the voicing it had.
 *
 * `ChordOption` from `progression-vocabulary.ts` satisfies this structurally,
 * so the palette hands one of its own options straight over and the service
 * stays ignorant of that module. Only the four fields below are read;
 * `chosen()` copies them one at a time and says why that matters.
 */
export interface ChordChoice {
  /** 0-6, as `ChordDegree.degree`. Outside it `createDegreeSlot` throws. */
  degree: number;
  /** Semitones the root is displaced by. Clamped by the normalisation. */
  alter: number;
  /**
   * The shape, or `null` for "as the key gives it".
   *
   * `null` with a non-zero `alter` is the one pair `normalizeChordDegree`
   * refuses outright: a displaced root has no diatonic stack to fall back on.
   */
  quality: NamedQuality | null;
  /** How high the shape stands. A quality names one; see `setSlotChord`. */
  extent: ChordExtent;
}

/**
 * Where a slot's octave control stands, as `ProgressionService.slotOctave`
 * reports it.
 *
 * Three numbers rather than one because the clamp is applied on use: the
 * document holds the request, the synth hears the sounding value, and the
 * control has to disable itself against the ceiling. Collapsing them would put
 * the palette back to guessing which it had.
 *
 * ## The two predicates a control reads off these
 *
 * The stepper steps from `sounding` and the readout shows it, for the reason
 * `slotOctave` gives at length. What that method does not spell out, and Task
 * 6's palette needs, is which comparison answers which question:
 *
 *  - **`sounding >= ceiling` disables the `+` stepper.** It covers both ways of
 *    running out of room without distinguishing them, which is right for a
 *    button: at the top of the control and too wide to go higher are the same
 *    fact about what the next press would do, namely nothing.
 *  - **`ceiling < OCTAVE_MAX` chooses the message.** The ceiling is already
 *    `min(OCTAVE_MAX, headroom)`, so this is true exactly when the *chord* is
 *    what stopped it rather than the control's own top - which selects "this
 *    chord is too wide to go higher" over the ordinary "this is the top of the
 *    range".
 *
 * They are different tests and folding them into one loses a case: a chord whose
 * `ceiling` is below `OCTAVE_MAX` but which is sitting *under* that ceiling has
 * `requested === sounding < ceiling`, is limited by nothing yet, and should show
 * an enabled stepper and no message at all.
 *
 * **Task 4b wrote the second predicate as `requested > ceiling`, and that is
 * wrong.** It is *sufficient* - a document asking for more than the chord can
 * take is certainly a chord at its own limit - and it is not *necessary*, which
 * is what a message has to be chosen by. It is true only when the slot was
 * already up at a higher octave and something widened the chord underneath it;
 * it is false in the commoner case by far, which is a wide chord built where it
 * sits. The design doc's own witness reaches 58 semitones and so has a ceiling
 * of 0 at the default octave: `requested > ceiling` is `0 > 0`, and the panel
 * would have told a user pressing `+` at octave 0 of a two-octave control that
 * they were at the top of the range. `requested` is kept because it is the
 * honest record of what the document asked for, not because a message turns on
 * it.
 */
export interface SlotOctave {
  /** What `ChordDegree.octave` stores: what the user asked for. */
  requested: number;
  /** What the chord is voiced at, which is `min(requested, ceiling)`. */
  sounding: number;
  /**
   * The highest octave this chord fits in, bounded by `OCTAVE_MAX`. Below it,
   * the chord is too wide to sound where it was asked to.
   */
  ceiling: number;
}

/**
 * Which of the three extensions a setter is aiming at.
 *
 * `keyof ExtensionAlterations` rather than a union written out again, so the
 * three names are declared once, in the model, beside the alterations each of
 * them takes. It is what makes `setSlotExtension` type-safe in both arguments
 * at once: the name chooses the union the value has to be in, so `'eleventh'`
 * with a `-1` does not compile.
 */
export type ExtensionName = keyof ExtensionAlterations;

/**
 * Everything that changes *which chord* a slot names, and rebuilds what it
 * sounds afterwards.
 *
 * The fourth collaborator `ProgressionService` constructs and keeps private,
 * on the terms the other three are held: one door, one-line delegations, and a
 * seam that is a kind of knowledge rather than a slice of an API. The precedent
 * is `a84a8bd` and `6f63e0b`; what is here is what the plan calls the
 * palette-facing degree setters - `setSlotExtent`, `stepSlotExtent`,
 * `setSlotChord`, `setSlotInversion`, `setSlotOctave` - the `editDegree` funnel
 * they all pour through, the `slotOctave` readout the octave control needs, and
 * `regenerate`.
 *
 * ## Why this one is handed the key context when the note editor is not
 *
 * `ProgressionNoteEditor` is given the store and nothing else, and
 * `progression-key-context.ts` puts the reason sharply: that seam holds only
 * while the thing the editor is handed cannot rebuild a chord. It is not a rule
 * against key knowledge in general - it is a rule about the *note* editor, whose
 * whole claim is that it works out notes and claims and never asks what chord a
 * slot is.
 *
 * This class makes the opposite claim. Every method on it restates the chord,
 * and a restated chord has to be built - which needs the scale, which needs the
 * key. So it takes `ProgressionKeyContext` as a constructor argument, exactly as
 * the service did, and asks it the same two questions the service asked:
 * `canBuildChords` before refusing, `chordScaleFor` before rebuilding. The
 * separation that matters is preserved rather than weakened: there is still no
 * path from the note editor to a scale, because the note editor is still handed
 * only the store.
 *
 * ## `regenerate` came here, and the service now asks for it
 *
 * Task 1b left `regenerate` in the service and argued why it did not belong in
 * the key context: it merges notes, ownership and voicing, which is slot
 * knowledge rather than key knowledge, and moving it there would have made the
 * place a scale is found also the place a slot is rebuilt. That argument does
 * not carry over. Rebuilding a slot from its degree is precisely what this class
 * is, so `regenerate` is at home here, and the three methods that stayed in the
 * service and also rebuild - `append`, `resetSlotToChord` and `setKey` - ask for
 * it rather than keeping a second copy. One copy is the point: two would be two
 * statements of the merge rule, free to disagree.
 */
export class ProgressionDegreeEditor {
  constructor(
    private readonly store: ProgressionStore,
    private readonly keys: ProgressionKeyContext
  ) {}

  /**
   * Sets how far the thirds are stacked, to an absolute rung.
   *
   * `normalizeChordSlot` throws on an extent that is not on the ladder, so
   * keeping a computed one on it is this method's job rather than that guard's;
   * see `nearestExtent` for what that means at each end. **The +/- complexity
   * buttons want `stepSlotExtent`**, which clamps rather than refusing because
   * it steps the index and not the value.
   */
  setSlotExtent(id: string, extent: ChordExtent): void {
    const rung = nearestExtent(extent);
    if (rung === null) return;
    this.editDegree(id, degree => ({ ...degree, extent: rung }));
  }

  /**
   * The +/- complexity buttons: `delta` rungs further up or down the ladder,
   * clamped at both ends.
   *
   * A stepper that walked the *value* could not clamp: off the top computes
   * `CHORD_EXTENTS[5]` and off the bottom `CHORD_EXTENTS[-1]`, both `undefined`
   * at runtime and indistinguishable from each other, so there is no end to
   * clamp toward. Stepping the *index* has the ends the value lacks - 0 and
   * `CHORD_EXTENTS.length - 1` are different numbers - so + on a thirteenth
   * rests on the thirteenth and - on a triad rests on the triad.
   *
   * It also puts "which rung is this slot on" in the service rather than in
   * each of the components that will ask, which is where the project rules put
   * state that more than one component reads.
   */
  stepSlotExtent(id: string, delta: number): void {
    // A `NaN` from an emptied input is not a direction, and names no rung.
    if (!Number.isFinite(delta)) return;

    const slot = this.store.slot(id);
    if (!slot || slot.harmony.kind !== 'degree') return;

    // Always a real index: every slot in the document has been through
    // `normalizeChordSlot`, which throws on an extent that is not a rung.
    const index = CHORD_EXTENTS.indexOf(slot.harmony.degree.extent);
    const stepped = index + Math.trunc(delta);
    const rung = Math.max(0, Math.min(CHORD_EXTENTS.length - 1, stepped));

    this.setSlotExtent(id, CHORD_EXTENTS[rung]);
  }

  /**
   * Retunes a slot to another chord: its degree, its accidental, its shape and
   * its height, all in one commit.
   *
   * The palette's alternates row, which offers every named shape on the root a
   * slot already sits on. It goes through `editDegree` for everything that
   * makes an edit here safe - the no-op comparison, the pitch reclaim, the
   * regeneration - and so it inherits that method's two refusals with them: a
   * key that cannot build chords, and a literal slot with no degree to change.
   *
   * **It sets the height as well as the shape**, and that is not incidental. A
   * shape has a height: `major` and `major7` are one chord at two of them, and
   * a caller that could ask for the seventh's name without its height would be
   * asking for a name over notes that do not make it. The cost is that a slot
   * standing on a ninth is stood back down by a triad's name -
   * `progression-vocabulary.ts` makes the argument for offering every shape at
   * its own height, and the palette shows the cost on the button rather than
   * letting a user find it after the click.
   */
  setSlotChord(id: string, choice: ChordChoice): void {
    this.editDegree(id, degree => chosen(degree, choice));
  }

  /** Rotates the voicing. Wraps, so any number names a real inversion. */
  setSlotInversion(id: string, inversion: number): void {
    this.editDegree(id, degree => ({ ...degree, inversion }));
  }

  /** Shifts the voicing base by whole octaves, clamped to the playable range. */
  setSlotOctave(id: string, octave: number): void {
    this.editDegree(id, degree => ({ ...degree, octave }));
  }

  /**
   * Replaces the chord's third with its second or its fourth, or puts the third
   * back.
   *
   * The palette's Sus control. `ChordDegree.suspension` has been stored,
   * normalised and - since M3 Task 4 - *sounded* for two milestones with
   * nothing in the UI able to write one: the design's "any combination can be
   * built" was true of the model and reachable only by dragging a note in the
   * roll. This is the door.
   *
   * It goes through `editDegree` like every other setter here, so it inherits
   * the whole of that method's behaviour and none of it is restated: a key that
   * cannot build chords and a literal slot are refused, a suspension the slot
   * already has records no undo entry, and the pitches are reclaimed because a
   * suspension restates the chord.
   *
   * `SuspensionKind` is an enumerated set, so a value outside it is the third
   * normalisation clause and throws out of `normalizeChordDegree` rather than
   * being clamped to something nearby. There is no nearest suspension.
   */
  setSlotSuspension(id: string, suspension: SuspensionKind): void {
    this.editDegree(id, degree => ({ ...degree, suspension }));
  }

  /**
   * Pins one extension to an alteration, or hands it back to the key.
   *
   * The palette's Tensions control, and the other half of what M3's model can
   * build and its UI could not reach. `null` is "as the key gives it" - the
   * convention `quality` already uses - so this is also the only way to
   * *un*-pin one short of Reset to chord.
   *
   * **One extension at a time, and the other two left alone**, which is what
   * makes the control a row of buttons rather than a form: a user flattening a
   * ninth has said nothing about the eleventh above it, and writing a whole
   * `ExtensionAlterations` would say something about all three.
   *
   * Pinning an extension the extent does not reach is stored and sounds
   * nothing, and that is deliberate rather than a gap - `chordPitchClasses`
   * skips a position the stack does not have, which is what keeps `extent` the
   * single height control. The palette does not offer the row at all until the
   * chord reaches it, so the case arrives here only from a document.
   */
  setSlotExtension<K extends ExtensionName>(
    id: string,
    extension: K,
    alteration: ExtensionAlterations[K]
  ): void {
    this.editDegree(id, degree => ({
      ...degree,
      extensions: withAlteration(degree.extensions, extension, alteration)
    }));
  }

  /**
   * Where one slot's octave control actually stands: what was asked for, what
   * is sounding, and how high this chord may go.
   *
   * The three are usually one number. They come apart when a chord is too wide
   * for the octave it was given - `chordOctaveCeiling` explains why that is
   * clamped on use rather than written back - and this is what a control needs
   * in order to say so rather than to appear broken.
   *
   * ## The stepper steps from `sounding`, and the readout shows `sounding`
   *
   * That is the answer to "what octave is this slot on", and the other one is a
   * trap. A slot storing 1 against a ceiling of 0 *is* on 0: that is the chord
   * the user hears and the notes the roll draws. A readout showing 1 would be
   * describing a number in a document rather than a sound, and - worse - a
   * stepper that subtracted from 1 would write 0, change nothing that sounds,
   * and be a control that visibly does nothing. Stepping down from `sounding`
   * writes -1 and moves the chord, which is what the button says it does.
   *
   * `requested` is not shown, and is here because the palette's `+` needs to
   * know which of two things to say when it is disabled: the control is at its
   * limit, or this chord cannot go higher than it already is.
   *
   * ## What `null` means
   *
   * There is no octave: the slot is gone, it is literal - its notes are the
   * truth and there is no degree to voice - or the key cannot stack thirds at
   * all, which is the same refusal `editDegree` opens with. All three are cases
   * where the palette's controls are already not offered, so the caller has an
   * empty state to fall into rather than a number to disbelieve.
   */
  slotOctave(id: string): SlotOctave | null {
    const doc = this.store.doc;
    const scale = this.keys.chordScaleFor(doc.key);
    if (scale === null) return null;

    const slot = this.store.slot(id);
    if (!slot || slot.harmony.kind !== 'degree') return null;

    const degree = slot.harmony.degree;
    const ceiling = chordOctaveCeiling(doc.key, scale, degree);
    return {
      requested: degree.octave,
      sounding: Math.min(degree.octave, ceiling),
      ceiling
    };
  }

  /**
   * Re-derives what a slot sounds, in the key it is in.
   *
   * It does **not** re-derive the label. `ChordDegree.quality` is the user's
   * override and `regenerateSlot` leaves it exactly as it found it; the name on
   * the card comes from `effectiveChord`, read off the chord that was actually
   * built. Writing the derived label into the field here is what M2 Task 4
   * removed, and this line used to say so.
   *
   * `transposeBy` defaults to 0 and only `setKey` passes anything else. That is
   * the honest value rather than a stand-in for a missing answer: a complexity
   * step, an inversion, an octave shift and an append all move no key, so there
   * is no interval to move claimed pitches by.
   *
   * The intervals it builds from are `ProgressionKeyContext`'s answer, and that
   * is the whole of what this asks the key: a slot is rebuilt here, where the
   * merge rules are, and the scale is resolved there, where the tables are.
   */
  regenerate(slot: ChordSlot, key: ProgressionKey, transposeBy = 0): ChordSlot {
    return regenerateSlot(slot, key, this.keys.chordScaleFor(key), transposeBy);
  }

  /**
   * Changes one slot's harmony and re-derives what it sounds.
   *
   * The bounded result is compared with what is already there, and an edit that
   * changes nothing is not recorded. That is not tidiness: the extent and
   * octave controls are steppers that clamp, so pressing one at its limit is a
   * normal thing to do repeatedly, and a hundred of those would empty the undo
   * stack of everything the user actually did.
   *
   * ## It reclaims the pitches, where `setKey` does not
   *
   * Every command that reaches here - `setSlotChord`, `setSlotExtent`,
   * `stepSlotExtent`, `setSlotInversion`, `setSlotOctave` - restates the chord
   * or its voicing, so the pitches the slot is holding are the ones the user is
   * asking to replace.
   * Leaving a claim over them intact would let the label move while the notes
   * did not: a complexity step on a claimed slot stores `extent: 7`, the card
   * prints `Imaj7`, and the synth keeps sounding the three pitches that were
   * there. `reclaimPitches` is that decision, and its docstring carries the
   * argument.
   *
   * The reclaim happens **after** the no-op comparison above, so a stepper
   * resting on its limit reclaims nothing - there is no commit to reclaim in.
   * `owned.timing` and `owned.velocity` are not touched by any of the four.
   */
  private editDegree(id: string, change: (degree: ChordDegree) => ChordDegree): void {
    const doc = this.store.doc;
    // A slot whose label and notes could not be made to agree is worse than a
    // control that does nothing, so the whole edit is refused.
    if (!this.keys.canBuildChords(doc.key)) return;

    const slot = this.store.slot(id);
    // A literal slot has no degree to change - its notes are the truth, and
    // there is no label for a stepper to move.
    if (!slot || slot.harmony.kind !== 'degree') return;

    const current = slot.harmony.degree;
    const edited = normalizeChordSlot({
      ...slot,
      harmony: { kind: 'degree', degree: change(current) }
    });
    if (edited.harmony.kind !== 'degree') return;
    if (sameDegree(edited.harmony.degree, current)) return;

    this.store.commitSlot(id, draftKey => this.regenerate(reclaimPitches(edited), draftKey));
  }
}

/**
 * One extension's alteration written over a set of three, the other two left.
 *
 * A named function rather than a computed key in an object literal, because
 * `{ ...extensions, [extension]: alteration }` under a generic key widens to an
 * index signature and stops being an `ExtensionAlterations` - the type would
 * have to be asserted back, and an assertion is exactly what the pairing this
 * signature enforces exists to avoid.
 */
function withAlteration<K extends ExtensionName>(
  extensions: ExtensionAlterations,
  extension: K,
  alteration: ExtensionAlterations[K]
): ExtensionAlterations {
  const changed: ExtensionAlterations = { ...extensions };
  changed[extension] = alteration;
  return changed;
}

/**
 * A degree with the four fields a choice names written over it, and the four
 * it does not name - inversion, suspension, extensions, octave - left where
 * they were.
 *
 * Leaving them is the same rule as ever and it is worth restating now that two
 * of them sound: a palette button re-shapes the chord it is pressed on, so a
 * slot that was suspended stays suspended and a pinned ♭9 stays pinned.
 * `unpinned`, in `progression.service.ts`, is the one that takes all of it
 * back, and the note under the alternates row already names Reset to chord as
 * the way there.
 *
 * Copied one at a time rather than spread, and that is a guard rather than a
 * style. `ChordChoice` is satisfied structurally, so what actually arrives is a
 * palette view model carrying a numeral, a printed name and several more fields
 * meant for the screen. A spread would write every one of them into the stored
 * `ChordDegree`, where `normalizeChordDegree` spreads them on again and
 * `structuredClone` copies them into every undo entry the document ever takes -
 * a display string preserved as though it were harmony, and preserved *stale*,
 * because nothing regenerates it.
 */
export function chosen(degree: ChordDegree, choice: ChordChoice): ChordDegree {
  return {
    ...degree,
    degree: choice.degree,
    alter: choice.alter,
    quality: choice.quality,
    extent: choice.extent
  };
}
