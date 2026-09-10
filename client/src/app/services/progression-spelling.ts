import { ChordDegree, ProgressionKey } from '../models/progression.model';
import { SpelledNote, formatNote, spellAt, spellPitchClass } from './note-spelling';
import { chordRootPitchClass } from './progression-generate';
import { isHeptatonic } from './progression-harmony';

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
 * `spellAt` refuses past a double accidental, which `alter` can reach in a
 * handful of exotic scales - super locrian's already doubly-flattened fourth,
 * lowered again. There the key's own preference answers, through
 * `spellPitchClass`, and the printed letter then disagrees with the numeral
 * exactly as it did before. `progression-vocabulary.spec.ts` pins how many
 * options that is across all 33 heptatonic scales; it is a small, named set
 * rather than a silent hole.
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
  const wanted = ((pitchClass % 12) + 12) % 12;

  if (isHeptatonic(scaleIntervals)) {
    const tonic = tonicSpelling(key);

    for (let degree = 0; degree < scaleIntervals.length; degree++) {
      if (((key.tonic + scaleIntervals[degree]) % 12 + 12) % 12 !== wanted) continue;

      const spelled = spellAt(wanted, tonic, degree);
      if (spelled) return spelled;
      break;
    }
  }

  return spellPitchClass(wanted, key.preferSharps);
}
