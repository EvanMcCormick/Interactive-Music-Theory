import { ChordDegree, ChordSlot, ProgressionKey } from '../models/progression.model';
import {
  SpelledNote,
  formatNote,
  reduceToOctave,
  spellAt,
  spellPitchClass
} from './note-spelling';
import { chordRootPitchClass } from './progression-generate';
import { effectiveChord, isHeptatonic } from './progression-harmony';

/**
 * How the progression spells its own notes: by the letter the degree names.
 *
 * Pure, on the `progression-harmony.ts` precedent, and the layer where
 * `note-spelling.ts`'s letter arithmetic meets a *key*. That module knows how
 * to write the note three letters above a B flat; this one knows that a chord
 * on degree 3 is three letters above the tonic, and that the tonic of a
 * `ProgressionKey` is whichever of twelve names its preference gives.
 *
 * ## What it replaces, and why a preference could never have done it
 *
 * Until this module the progression spelled a root through
 * `MusicTheoryService.spellNote` and chose its argument with
 * `rootPrefersSharps`: sharp if the root was raised, flat if lowered, the key's
 * own preference otherwise. That rule got 996 displaced roots right across
 * every scale and key, 112 wrong where following the key would have been right,
 * and 176 wrong that following the key would also have got wrong.
 *
 * Underneath it sat a limit no preference could reach. The two chromatic tables
 * hold twelve names between them and none of them is `C♭`, `F♭`, `B♯`, `E♯` or
 * a double accidental, so 55 buttons across the seven diatonic modes in all
 * twelve keys came back on the wrong **letter** - B♭ major's `♭II` printed
 * `B Maj`, which reads as a raised seventh under a numeral that says lowered
 * second. A preference chooses between two names for one pitch class; it cannot
 * choose a letter, because a pitch class does not have one.
 *
 * A degree does. The second degree of any key is written on the letter one step
 * above the tonic's whatever the numeral does to it, so `♭II` of B♭ is a C, and
 * pitch class 11 there is a C flat. That is the whole rule, and it is why every
 * function here takes a degree or a scale rather than a bare pitch class.
 *
 * ## Where it falls back, and why the fallback is not a failure
 *
 * `spellAt` refuses past a double accidental. **When that fires and how far it
 * reaches is stated on `spellAt` itself**, which is the module that owns the
 * refusal, and this paragraph reads it rather than repeating it - the argument
 * `STEP_SEMITONES` is already shared under. Repeating it is exactly what went
 * wrong: this header used to blame `alter` and a "doubly-flattened" super
 * locrian fourth, and by the time `note-spelling.ts` was corrected the two files
 * said different things about one rule.
 *
 * What belongs here is what *this* module does when the refusal comes back. The
 * key's own preference answers, through `spellPitchClass`, and the printed
 * letter then disagrees with the numeral exactly as it did before. That is the
 * honest remainder rather than a silent hole: a triple accidental is not
 * notation, so there is no better spelling being passed over, and
 * `progression-vocabulary.spelling.spec.ts` pins which roots reach it rather
 * than leaving the size of it to a hand-wave.
 *
 * A scale that is not heptatonic has no degree letters at all - five degrees
 * cannot take seven letters one apart - so `scaleNoteName` leaves those to the
 * key. That is the same bargain `isHeptatonic` is exported to offer everywhere
 * else on this page: an honest table spelling rather than an arithmetic that
 * does not apply.
 */

/** How this key spells its own tonic: one of the twelve table names. */
export function tonicSpelling(key: ProgressionKey): SpelledNote {
  // Every tonic the circle offers is a plain letter or a single accidental, so
  // the key's preference is enough here and no degree is needed - which is what
  // makes it the note every other letter in this module is counted from.
  return spellPitchClass(key.tonic, key.preferSharps);
}

/**
 * The root of a chord on this degree, spelled by the letter the degree names.
 *
 * `alter` moves the pitch and never the letter, which is the correction the
 * whole module exists for: a `♭II` and a `II` are written on the same letter
 * and the accidental is what the numeral is already saying.
 *
 * Exported as a spelling rather than only as a name because a chord's *tones*
 * are spelled from its root - a third is two letters above it, a seventh six -
 * so the root's letter is the thing a later caller needs, not its text.
 */
export function chordRootSpelling(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  degree: ChordDegree
): SpelledNote {
  const pitchClass = chordRootPitchClass(key, scaleIntervals, degree);

  return (
    spellAt(pitchClass, tonicSpelling(key), degree.degree) ??
    spellPitchClass(pitchClass, key.preferSharps)
  );
}

/** The same root as text: `Cb`, `B#`, `Bb`. */
export function chordRootName(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  degree: ChordDegree
): string {
  return formatNote(chordRootSpelling(key, scaleIntervals, degree));
}

/**
 * A bare pitch class spelled as this key writes it: by its degree where the
 * scale has one, and by the key's preference where it does not.
 *
 * For the roll's keyboard and note labels, where what is in hand is a MIDI
 * number and not a chord. A note the scale contains is written on that degree's
 * letter, so F locrian's pitch class 8 is an `Ab` rather than the `G♯` the
 * tables gave it; a note outside the scale has no degree to take a letter from
 * and falls back, which is the same rule and the same reason as the fallback
 * past a double accidental.
 *
 * The search is a scan of seven intervals rather than a lookup, because the
 * scale arrives as an array and building a map per call would cost more than
 * the scan. It stops at the first degree that matches, and in a heptatonic
 * scale there is at most one - two degrees on one pitch class would mean two
 * letters for one note, which is the ambiguity `isHeptatonic` screens out.
 */
export function scaleNoteName(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  pitchClass: number
): string {
  return formatNote(scaleNoteSpelling(key, scaleIntervals, pitchClass));
}

/** The spelling behind `scaleNoteName`. See it for the rule. */
export function scaleNoteSpelling(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  pitchClass: number
): SpelledNote {
  const wanted = reduceToOctave(pitchClass);

  if (isHeptatonic(scaleIntervals)) {
    const tonic = tonicSpelling(key);

    for (let degree = 0; degree < scaleIntervals.length; degree++) {
      if (reduceToOctave(key.tonic + scaleIntervals[degree]) !== wanted) continue;

      const spelled = spellAt(wanted, tonic, degree);
      if (spelled) return spelled;
      break;
    }
  }

  return spellPitchClass(wanted, key.preferSharps);
}

/**
 * How this progression spells a pitch class in the context of one slot.
 *
 * Chord tones first, from the slot's own degree; then the scale; then the key's
 * preference. Lifted out of `piano-roll-view.ts`, where it was private, when M4
 * gave the score projection the same question to answer - one rule, because the
 * letter the roll writes on a key and the letter the score engraves are the
 * same letter, and this file's header records what happens when one rule lives
 * in two places.
 *
 * A speller rather than a spelling because both callers ask it many times over
 * one slot - every note of the chord, and every row of the roll's keyboard -
 * and the chord tones are worked out once for all of them.
 *
 * `scaleIntervals` empty means the key's scale id resolved to nothing, and
 * every pitch class then falls through to the key's preference, which is what
 * `scaleNoteSpelling` does with a scale it cannot read degrees from.
 */
export function slotSpeller(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  slot: ChordSlot | null
): (pitchClass: number) => SpelledNote {
  const chordTones = chordToneSpellings(key, scaleIntervals, slot);

  return pitchClass =>
    chordTones.get(pitchClass) ?? scaleNoteSpelling(key, scaleIntervals, pitchClass);
}

/**
 * How the slot's own chord spells each of its tones, by pitch class.
 *
 * A chord tone is written on the letter its *place in the chord* names - a third
 * two letters above the root, a seventh six - and that is a finer answer than
 * the scale's, which knows only which degree of the key a note is. The two
 * differ wherever a chord leaves the key: the ♯11 of a `Imaj13♯11` in C is an
 * F♯, and the scale has no F♯ to find a degree for, so it would fall back to the
 * key's preference and could print `Gb` under a numeral that says sharp eleven.
 *
 * Empty whenever there is no chord to ask - no slot, a `literal` slot, or a
 * scale thirds cannot be stacked through - and then every note falls through to
 * the scale, which is what the roll did before this existed.
 *
 * The heptatonic check is the whole of that last refusal, and it is the same
 * question `ProgressionState.canBuildChords` answers: that flag is
 * `isHeptatonic` applied to the resolved scale, and the roll passes the same
 * scale's intervals in here. Asking the intervals rather than the flag is what
 * lets the projection - which holds a `ProgressionDoc` and no published state -
 * reach the identical rule.
 *
 * **First spelling wins.** A stack can sound one pitch class twice, an octave
 * apart, and the two positions need not read the same letter. A minor ninth
 * with the ninth pinned sharp is the clean case: the minor third sits in
 * position 1, two letters above the root, and the ♯9 - the same pitch class an
 * octave up - sits in position 4, one letter above the root. One row of the
 * roll's keyboard cannot carry two names, and this map is keyed by pitch class,
 * so it cannot hold two either. The *score* is under no such constraint of its
 * own - a staff can write an E♭ and a D♯ in one chord at different octaves -
 * and it inherits this one only because it is spelled through this map. So the
 * lower position, the one the chord is built on, keeps it, and that pitch class
 * comes back an `E♭` rather than a `D♯` at both octaves.
 *
 * The doubling was first found on a sus4 at extent 11, which puts the suspended
 * fourth in position 1 and the eleventh in position 5, and that case is worth
 * naming only as where to look: it cannot demonstrate the rule. Both positions
 * are three letters above the root, so `spellAt` returns the same letter either
 * way and there is no tie for the tie-break to settle.
 */
function chordToneSpellings(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  slot: ChordSlot | null
): Map<number, SpelledNote> {
  const spellings = new Map<number, SpelledNote>();
  if (!slot || slot.harmony.kind !== 'degree' || !isHeptatonic(scaleIntervals)) return spellings;

  const degree = slot.harmony.degree;
  const chord = effectiveChord(scaleIntervals, degree);
  const root = chordRootSpelling(key, scaleIntervals, degree);

  chord.intervals.forEach((interval, i) => {
    const pitchClass = reduceToOctave(key.tonic + chord.root + interval);
    if (spellings.has(pitchClass)) return;

    // Null past a double accidental, and then this tone simply has no
    // chord-wise spelling - the scale's answer is the honest remainder, exactly
    // as it is for a root `chordRootSpelling` cannot spell.
    const spelled = spellAt(pitchClass, root, chord.steps[i]);
    if (spelled) spellings.set(pitchClass, spelled);
  });

  return spellings;
}
