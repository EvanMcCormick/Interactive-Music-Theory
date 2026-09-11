import {
  ELEVENTH_ALTERATIONS,
  NINTH_ALTERATIONS,
  OCTAVE_MAX,
  SUSPENSIONS,
  THIRTEENTH_ALTERATIONS
} from '../../../../models/progression-normalize';
import {
  EleventhAlteration,
  NinthAlteration,
  SuspensionKind,
  ThirteenthAlteration
} from '../../../../models/progression.model';
import { ExtensionName, SlotOctave } from '../../../../services/progression.service';
import { ChordIdentity } from '../../../../services/progression-harmony';

/**
 * What the palette's voicing controls draw, worked out from a chord and an
 * octave and from nothing else.
 *
 * Pure, beside the component rather than inside it, on the
 * `progression-strip-cards.ts` and `piano-roll-view.ts` precedent: a view model
 * that is a function of published state is a thing that can be checked against
 * a chord table, and a component that only subscribes and dispatches is a thing
 * that can be checked against a service.
 *
 * It was taken out at M3 Task 6, when the Sus and Tensions controls carried the
 * component past the 1000-line cap. The *rows* stayed there - they are wound
 * through `chordVocabulary` and the selection in a way that is not separable
 * without moving half the component - so this holds the three controls the task
 * added and no more. That is a smaller module than the precedent suggests and
 * it is deliberately not padded out to match: what belongs here is what is a
 * function of the chord alone.
 *
 * ## Everything here reads the *built* chord
 *
 * `ChordIdentity` and not `ChordDegree`, and that is the whole reason the
 * Tensions control works. A slot stores `null` in all three extensions, meaning
 * "as the key gives it", so a row comparing the stored field would mark nothing
 * on the chord a user has just raised to a ninth - and would be silent about
 * the flat ninth the key puts on a secondary dominant. `ChordOption.current`
 * argues the same point about the alternates row at length; this is that
 * argument, one control over.
 */

/**
 * One button on the Sus control: what it stores, and what it says.
 *
 * A toggle rather than a stepper, because a suspension has three values with no
 * order between them - `sus2` is not "one more" than `none` - so there is no
 * direction for a +/- pair to move in.
 */
export interface SuspensionChoice {
  value: SuspensionKind;
  /** `None`, `sus2`, `sus4`. */
  label: string;
  /** What the button says aloud. See `PaletteChord.label`, which argues it. */
  ariaLabel: string;
  /** Whether this is the suspension the selected chord is sounding. */
  current: boolean;
}

/**
 * One button on a Tensions row: which extension it alters, and to what.
 *
 * A discriminated union on `extension`, which is what lets `setTension` hand
 * the pair straight to `setSlotExtension` with no cast: that method pairs each
 * extension name with the union of alterations it takes - `'eleventh'` with a
 * flat does not compile - and narrowing on the discriminant is what carries the
 * pairing from the table below to the dispatch. Widening `alteration` to
 * `number` would compile and would move the check to a runtime throw in the
 * normalisation, which is where a *document* is caught rather than a button.
 */
export type TensionChoice = TensionChoiceText &
  (
    | { extension: 'ninth'; alteration: NinthAlteration }
    | { extension: 'eleventh'; alteration: EleventhAlteration }
    | { extension: 'thirteenth'; alteration: ThirteenthAlteration }
  );

/** The half of a tension button that does not vary with the extension. */
interface TensionChoiceText {
  /** `♭9`, `♮11`, `♯11` - the figure as a chart prints it. */
  label: string;
  /** What the button says aloud: a glyph announces as nothing useful. */
  ariaLabel: string;
  /**
   * Whether this is the alteration the chord is **sounding**.
   *
   * See the module note above: it is read off `effectiveChord` and never off
   * `ChordDegree.extensions`, because every unedited slot stores `null` there.
   */
  current: boolean;
  /** Identity for `trackBy`, unique within the whole control. */
  key: string;
}

/** One row of the Tensions control: an extension, and the figures it can take. */
export interface TensionRow {
  extension: ExtensionName;
  /** `Ninth`, `Eleventh`, `Thirteenth` - what the row is a row of. */
  label: string;
  choices: readonly TensionChoice[];
}

/** The octave control's readout, and the two facts its `+` button needs. */
export interface OctaveView {
  /** `+1`, `0`, `-2`, or the empty-state dash. What is *sounding*. */
  label: string;
  /** Whether the `+` has anywhere to go. */
  ceilingReached: boolean;
  /** Which limit that is, in words, or null while there is none. */
  limit: string | null;
}

/** What each suspension is called on its button, and in words. */
const SUSPENSION_LABELS: Readonly<Record<SuspensionKind, { label: string; spoken: string }>> = {
  none: { label: 'None', spoken: 'no suspension' },
  sus2: { label: 'sus2', spoken: 'suspended second' },
  sus4: { label: 'sus4', spoken: 'suspended fourth' }
};

/** The figure and the word for each extension the Tensions control shows. */
const EXTENSION_FIGURES: Readonly<Record<ExtensionName, { figure: string; spoken: string }>> = {
  ninth: { figure: '9', spoken: 'ninth' },
  eleventh: { figure: '11', spoken: 'eleventh' },
  thirteenth: { figure: '13', spoken: 'thirteenth' }
};

/**
 * Every figure any extension on this control can take.
 *
 * The union of the three, which is `-1 | 0 | 1` - the ninth's own range, since
 * the eleventh and the thirteenth each drop one end of it. Written as the union
 * rather than as that literal so it follows the model: a quarter-flat
 * thirteenth would widen this by widening `ThirteenthAlteration`, and the two
 * tables below would stop compiling until they had a face for it.
 */
type Alteration = NinthAlteration | EleventhAlteration | ThirteenthAlteration;

/**
 * How each alteration is written and said.
 *
 * `♮` is printed where a chart would often print nothing, because these are
 * three buttons in a row and the unaltered one needs a face of its own - a
 * button reading `9` beside `♭9` and `♯9` reads as the row's heading rather
 * than as one of its choices.
 *
 * Keyed on `Alteration` and not on `number`, which is the difference between a
 * missing face being a compile error and being a button labelled `undefined9`
 * that announces as "undefined ninth". A `Record<number, string>` claims to
 * hold every integer and is checked against none of them.
 */
const ALTERATION_GLYPHS: Readonly<Record<Alteration, string>> = { '-1': '♭', 0: '♮', 1: '♯' };
const ALTERATION_WORDS: Readonly<Record<Alteration, string>> = {
  '-1': 'flat',
  0: 'natural',
  1: 'sharp'
};

/** Why the octave `+` is disabled: the control's own top. */
const OCTAVE_AT_THE_TOP = 'This is the top of the range.';

/** Why the octave `+` is disabled: this chord, rather than the control. */
const OCTAVE_TOO_WIDE =
  'This chord is too wide to sound an octave higher, so it is held down here.';

/**
 * The three Sus buttons, with the one the chord is sounding marked.
 *
 * Built from `SUSPENSIONS` rather than from a list here, so the runtime twin of
 * the union is what the control offers and a fourth suspension would appear on
 * screen by being added to the model. The order is that array's, which is the
 * order the union declares: none first, because it is what a fresh slot has.
 *
 * The mark is read off the identity rather than off `ChordDegree.suspension`,
 * which is the same field one layer of derivation away. That is on purpose and
 * it is the Tensions row's rule applied here for consistency rather than for
 * necessity: `effectiveChord` carries the suspension through untouched, so the
 * two agree by construction today, and reading the built chord is what keeps
 * them agreeing if a shape ever comes to imply one.
 *
 * Offered with nothing selected, greyed rather than absent, because the group
 * is three buttons wide and would otherwise appear and disappear beside two
 * steppers that only grey out. `chord` is null then, so nothing is marked.
 */
export function buildSuspensions(chord: ChordIdentity | null): SuspensionChoice[] {
  return SUSPENSIONS.map(value => ({
    value,
    label: SUSPENSION_LABELS[value].label,
    ariaLabel: SUSPENSION_LABELS[value].spoken,
    current: chord !== null && chord.suspension === value
  }));
}

/**
 * One row per extension the chord actually has, from the ninth up.
 *
 * The presence test is `identity.ninth !== null`, which is `identityOfStack`
 * reporting that the stack reaches that position - so the rows appear exactly
 * as the complexity stepper climbs past 7, 9 and 11, and `extent` stays the
 * single height control. Asking the chord rather than comparing `degree.extent`
 * against three numbers is what keeps that true without a second copy of the
 * rule.
 *
 * A chord can sound an alteration no button offers: an exotic scale's own ninth
 * can land somewhere no figure names, which is what makes `ChordIdentity.base`
 * `'other'` and the card print `?`. The row is then drawn with nothing marked,
 * on the rule the alternates row follows in the same situation - unlabelled
 * rather than mislabelled - and any button on it is still a way out.
 */
export function buildTensions(chord: ChordIdentity): TensionRow[] {
  const rows: TensionRow[] = [];

  if (chord.ninth !== null) {
    const sounding = chord.ninth;
    rows.push({
      extension: 'ninth',
      label: 'Ninth',
      choices: NINTH_ALTERATIONS.map(alteration => ({
        extension: 'ninth',
        alteration,
        ...tensionText('ninth', alteration, alteration === sounding)
      }))
    });
  }

  if (chord.eleventh !== null) {
    const sounding = chord.eleventh;
    rows.push({
      extension: 'eleventh',
      label: 'Eleventh',
      choices: ELEVENTH_ALTERATIONS.map(alteration => ({
        extension: 'eleventh',
        alteration,
        ...tensionText('eleventh', alteration, alteration === sounding)
      }))
    });
  }

  if (chord.thirteenth !== null) {
    const sounding = chord.thirteenth;
    rows.push({
      extension: 'thirteenth',
      label: 'Thirteenth',
      choices: THIRTEENTH_ALTERATIONS.map(alteration => ({
        extension: 'thirteenth',
        alteration,
        ...tensionText('thirteenth', alteration, alteration === sounding)
      }))
    });
  }

  return rows;
}

/**
 * The octave readout, and which of the two limits the `+` has run into.
 *
 * Both predicates are `SlotOctave`'s, and that docstring argues them - including
 * why the second is `ceiling < OCTAVE_MAX` rather than the `requested > ceiling`
 * Task 4b wrote down, which is true only of a chord that was widened after it
 * was raised and silent about one that was built wide where it sits.
 *
 * `null` is the empty state: no selection, a literal slot, or a key that can
 * build no chords. The readout says so and neither message applies, because
 * there is no chord for either to be about.
 */
export function buildOctaveView(octave: SlotOctave | null, emptyLabel: string): OctaveView {
  if (octave === null) {
    return { label: emptyLabel, ceilingReached: false, limit: null };
  }

  const ceilingReached = octave.sounding >= octave.ceiling;
  return {
    label: formatOctave(octave.sounding),
    ceilingReached,
    limit: !ceilingReached
      ? null
      : octave.ceiling < OCTAVE_MAX
        ? OCTAVE_TOO_WIDE
        : OCTAVE_AT_THE_TOP
  };
}

/** The half of a tension button that is the same whichever extension it is on. */
function tensionText(
  extension: ExtensionName,
  alteration: Alteration,
  current: boolean
): TensionChoiceText {
  const { figure, spoken } = EXTENSION_FIGURES[extension];

  return {
    label: `${ALTERATION_GLYPHS[alteration]}${figure}`,
    // The glyph is dropped from the spoken form rather than read out: `♭9`
    // announces as "flat nine" at best and as nothing at all at worst, and the
    // fact it carries is the word. `PaletteChord.label` makes the same call.
    ariaLabel: `${ALTERATION_WORDS[alteration]} ${spoken}`,
    current,
    key: `${extension}:${alteration}`
  };
}

/** `+1`, `0`, `-2` - signed, so the readout says which way it has been moved. */
function formatOctave(octave: number): string {
  return octave > 0 ? `+${octave}` : `${octave}`;
}
