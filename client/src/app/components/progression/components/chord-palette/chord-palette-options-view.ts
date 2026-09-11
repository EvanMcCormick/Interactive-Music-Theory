import { createExtensions } from '../../../../models/progression-normalize';
import { ChordDegree } from '../../../../models/progression.model';
import { ChordExtent } from '../../../../services/progression-harmony';
import { ChordOption } from '../../../../services/progression-vocabulary';

import type { PaletteAlternate, PaletteOption } from './chord-palette.component';

/**
 * What a chord button is made of: the degree one stands for, the label it says
 * aloud, the identity `trackBy` tells it by, and the sentence under the row.
 *
 * Pure, on the `chord-palette-controls-view.ts` precedent and for its reasons.
 * None of this is about a component - an option or a degree goes in and a view
 * model or a string comes out, with no Angular, no DOM and no injector - and
 * taking it out of `chord-palette.component.ts` put that file back under the
 * project's 1000-line cap, which the controls split had done once already.
 *
 * ## The seam, which is the verb rather than the row
 *
 * Over there is everything that needs the *state*: which rows exist, which is
 * marked, what the panel says when there is nothing selected, and the
 * subscription all of it hangs off. Here is everything a button would still be
 * made of if the panel were rebuilt around some other source - and each of these
 * was already a free function below the class, with no `this` to reach for.
 * `warnAboutHeight` says at length why that mattered before there was a file to
 * move it to.
 *
 * ## The type import, and why it is not a cycle
 *
 * `PaletteOption` and `PaletteAlternate` are declared beside the component that
 * binds them, because the fields a template draws are that component's decision
 * - and `PaletteOption extends ChordChoice`, which is what makes a click hand
 * the service the object the button holds. So this module imports them back with
 * `import type`, which is erased: the runtime edge runs one way, from the
 * component to here, exactly as `progression-harmony.ts` takes `ChordDegree`
 * from a model that imports two of its types. Declaring a second pair here would
 * be the one thing the arrangement is meant to avoid.
 */

/**
 * The palette offers triads, because that is what `createDegreeSlot` builds.
 *
 * A palette that printed seventh figures and appended triads would be a label
 * disagreeing with the thing it labelled before the user had touched anything.
 * The complexity control below it is how a chord gets taller, after it is placed.
 */
const PALETTE_EXTENT: ChordExtent = 3;

/**
 * The diatonic row is unaltered, which is what makes it the diatonic row.
 *
 * Named rather than written as a bare `0` at the `romanNumeral` call, because
 * the argument it fills is the one Task 8 added for borrowed chords: the seven
 * buttons there are the key's own degrees and the accidental is what the
 * borrowed group below them carries. It is `createDegreeSlot`'s `alter` and
 * `paletteDegree`'s, for the same reason both of those write it down.
 */
export const PALETTE_ALTER = 0;

/** What each rung of the ladder is called, for the complexity readout. */
export const EXTENT_LABELS: Record<ChordExtent, string> = {
  3: 'Triad',
  7: '7th',
  9: '9th',
  11: '11th',
  13: '13th'
};

/**
 * The degree a palette button stands for, as `chordRootName` wants it.
 *
 * It is `createDegreeSlot`'s degree at the palette's own extent - the slot the
 * button appends - so building it here rather than passing the index alone is
 * what makes the label and the appended chord one description. `alter: 0` is
 * copied from that factory rather than assumed: it is the field M2's borrowed
 * chords move, and the day it moves the palette follows through the shared
 * function instead of standing still.
 *
 * `quality: null` is copied from it for the same reason, and it used to be the
 * *derived* label instead - which was the palette writing a name into a field
 * that means "override", one call site over from the `regenerateSlot` that did
 * the same thing everywhere else. The root arithmetic reads neither, so
 * nothing moved; what changed is that the two descriptions now match.
 */
export function paletteDegree(degree: number): ChordDegree {
  return {
    degree,
    alter: 0,
    extent: PALETTE_EXTENT,
    quality: null,
    inversion: 0,
    suspension: 'none',
    extensions: createExtensions(),
    octave: 0
  };
}

/**
 * The sentence under the alternates row, or null when there is nothing to warn
 * about.
 *
 * Asked of the buttons rather than of the extent, so the sentence cannot appear
 * over a row where nothing is marked or fail to appear over one where something
 * is. It names the height at stake because "these will shorten it" without
 * saying from what reads as a caution about nothing in particular.
 *
 * **The buttons are an argument and not a field**, and that is the whole of why
 * this is a free function. It read `this.alternates` and was correct because
 * `buildOptions` happened to assign that field first; the claim being made is
 * that the warning cannot disagree with the row it sits under, and a claim that
 * rests on the order of two lines in one method is a coincidence rather than an
 * invariant. Outside the class there is no field to reach for - and now outside
 * the file there is not even a class.
 */
export function warnAboutHeight(
  alternates: readonly PaletteAlternate[],
  selected: ChordDegree | null
): string | null {
  if (selected === null) return null;
  if (!alternates.some(option => option.lowersHeight)) return null;

  return (
    `Every shape has a height of its own, marked on each button. Choosing one ` +
    `sets that height, so this ${EXTENT_LABELS[selected.extent]} will not stay one.`
  );
}

/**
 * What clicking an alternate does, said in the two cases where it differs.
 *
 * Every button on this row stores a shape, and on all but one of them that is
 * plainly a change - the chord was one thing and is now another. On the marked
 * one it is usually not: the chord is already that shape, so the click writes
 * no new notes and the whole of its effect is the *pin* - `ChordDegree.quality`
 * stops being `null` and becomes an override the next key change will honour.
 *
 * That is the half of this row a user could not otherwise find out. The height
 * is on the button and `warnAboutHeight` says what it costs; the pin was
 * invisible, and the marked button announced itself as "Change to G major,
 * triad" - a promise of a change, on the one button that changes no note. The
 * verb is what carries it, in the only channel a button has room for.
 *
 * It stays "Pin as" on a second click, which does nothing at all because the
 * shape is already stored. That is the right reading of a no-op rather than an
 * apology for one: the button says what state it puts the chord in,
 * `aria-current` says the chord is in it, and a command already satisfied is a
 * command that does nothing. `resetSlotToChord` is the way back out, and the row
 * says so.
 *
 * ## Unless the slot carries a suspension or a pinned extension
 *
 * Then the marked button is a change after all, because `chosen()` clears both
 * - see it for why the row replaces a chord rather than re-shaping it - and
 * "Pin as B flat major" on a `Bbsus4` slot would be the understatement this verb
 * exists to prevent, one review later: a button promising only a pin, on the
 * press that takes the suspension away. So the selected degree is read and the
 * verb falls back to "Change to", which is what the press plainly is.
 *
 * The **height** is deliberately not in this test, and the asymmetry is the
 * point rather than an oversight: a marked shape below the slot's height also
 * changes the chord, and it says so on the button itself - `heightLabel`, the
 * `↓`, and ", down from the 9th" in the label this is the first word of. What
 * has no channel of its own is the suspension and the pin, so the verb is where
 * they land.
 */
export function shapeVerb(option: ChordOption, selected: ChordDegree | null): string {
  return option.current && !isAltered(selected) ? 'Pin as' : 'Change to';
}

/**
 * Whether a slot carries anything a click on the alternates row would take
 * away: a suspension, or an extension pinned to a figure of the user's.
 *
 * The two fields `chosen()` clears, read off the stored degree rather than
 * re-derived from the built chord. That is the right source because the question
 * is what the *degree* will lose, not what is currently sounding: a ♭9 pinned on
 * a triad sounds nothing at all - `chordPitchClasses` skips a position the stack
 * does not reach - and is exactly the pin that used to survive every shape in
 * that row and come back at the next complexity step.
 */
function isAltered(degree: ChordDegree | null): boolean {
  if (degree === null) return false;

  const { ninth, eleventh, thirteenth } = degree.extensions;
  return (
    degree.suspension !== 'none' || ninth !== null || eleventh !== null || thirteenth !== null
  );
}

/**
 * `Add another` on an append-row button whose chord the selection already is.
 *
 * The mark on these two rows is a fact about the selection - the chord you are
 * on is this borrowed one - and the button still appends, so the label is where
 * the two are told apart. It is also what lets the `aria-current` come off
 * these rows without the mark going silent for a user who cannot see the ring:
 * "add another" says both halves in words, and says the half that matters.
 */
export function addVerb(option: ChordOption): string {
  return option.current ? 'Add another' : 'Add';
}

/**
 * A vocabulary option as a button, with the label its row decided on.
 *
 * The four `ChordChoice` fields are copied one at a time rather than spread,
 * for the reason the service's `chosen()` gives from the other end: what is
 * being built is the object a click hands to the service, and `spoken` and
 * `group` have no business in a document. `current` is copied and never
 * recomputed - see `ChordOption.current`, where the comparison it stands for is
 * argued at length and is not the obvious one.
 *
 * `numeral` and `name` are copied straight through too, and that is what makes
 * a button the vocabulary's option rather than a second rendering of it: there
 * is no layer between the two that could change either string.
 * `chord-palette.roundtrip.spec.ts` leans on exactly that, and sweeps the
 * vocabulary in order to sweep the buttons.
 */
export function buildOption(option: ChordOption, label: string): PaletteOption {
  return {
    degree: option.degree,
    alter: option.alter,
    quality: option.quality,
    extent: option.extent,
    numeral: option.numeral,
    name: option.name,
    label,
    current: option.current,
    key: optionKey(option)
  };
}

/**
 * A button's identity for `trackBy`: the chord it puts in a slot.
 *
 * The numeral would do for the two append rows and not for the alternates,
 * where every named shape sits on one degree and one accidental - `V` and `V7`
 * differ, but the numeral is the *rendering* and the shape is the thing. The
 * quality would do for the alternates and not for the others, where every
 * secondary dominant is a `dominant7`. The triple is what all three rows vary,
 * and it is unique within each of them.
 */
function optionKey(option: ChordOption): string {
  return `${option.degree}:${option.alter}:${option.quality}`;
}
