import { DetectedNote, DerivationSettings } from '../models/transcription.model';

/**
 * Corrects octave errors that a detector's own output cannot rule out.
 *
 * The pipeline knows one thing the model does not: which pitches the
 * instrument can physically sound. That is enough to catch the commonest bass
 * transcription error without any musical context, by folding anything outside
 * the neck's range back onto it in whole octaves.
 *
 * Pure functions with no Angular or audio dependency, following the
 * `staff-pitch.ts` precedent, so the folding can be checked directly against
 * hand-written tunings.
 */

/**
 * How far outside MIDI a pitch may stray before it is a fault, not an error.
 *
 * The mistakes this module exists to fold are whole octaves, so a pitch an
 * octave or two outside MIDI's 0-127 is exactly its business. Ten octaves
 * outside is not a mis-heard note, and the folding loop is the wrong place to
 * find that out: it steps by 12, so 1e15 would take some 8e13 iterations, and
 * above about 2^57 one unit in the last place already exceeds 12 - `pitch -=
 * 12` changes nothing and the loop never ends at all. Infinity behaves the
 * same way. `Number.isFinite` catches neither of those, which is why the bound
 * is a pitch domain rather than a finiteness check.
 */
const PITCH_LIMIT = 127 + 120;

/**
 * Whether `correctOctaves` would accept this pitch or throw on it.
 *
 * The same test, asked as a question. `correctOctaves` throwing is right for
 * `deriveScore`, which is handling the notes a detector actually reported and
 * has no better answer than failing loudly. `buildPreviewDoc` is not in that
 * position: it runs *after* a successful derivation, on notes that derivation
 * set aside, and throwing there would blank a preview that had a score to draw
 * - the failure M1 warned about. So it filters first, using this rather than a
 * second copy of the bound.
 *
 * Negated rather than `Math.abs(...) > PITCH_LIMIT`, so NaN - which compares
 * false against everything - is rejected by the same test as Infinity.
 */
export function isCorrectablePitch(pitch: number): boolean {
  return Math.abs(pitch) <= PITCH_LIMIT;
}

/**
 * Folds out-of-range pitches back onto the instrument.
 *
 * Detectors are weakest in the bass register: fundamentals below 100 Hz sit
 * where spectral resolution is poorest, and the classic failure is locking
 * onto the second harmonic and reporting a pitch an octave high. The pipeline
 * knows something the model does not - a pitch outside the instrument's range
 * is simply impossible - so folding by octaves recovers the intended note
 * whenever the error pushed it past either end.
 *
 * It cannot catch an octave error that lands somewhere still playable; that
 * needs surrounding context and is left for later.
 *
 * Throws on a pitch outside the MIDI domain by more than ten octaves, the
 * sibling modules' habit of failing loudly on input they cannot handle rather
 * than misbehaving quietly. Nothing in `deriveScore` produces such a value,
 * but the alternative here is not a wrong answer, it is a hang.
 */
export function correctOctaves(
  notes: DetectedNote[],
  settings: DerivationSettings
): DetectedNote[] {
  for (const note of notes) {
    if (!isCorrectablePitch(note.pitch)) {
      throw new Error(`note ${note.id} has pitch ${note.pitch}, which is not a MIDI pitch`);
    }
  }

  // A capo raises the bottom of the range and leaves the top where it was: it
  // takes frets away from the neck rather than adding them past the end, so
  // the highest pitch is still the top string stopped at the last fret. This
  // has to agree with `candidatesFor`, or a pitch folded to here would be
  // admitted and then found unplayable, and the note would silently vanish.
  const lowest = Math.min(...settings.tuning) + settings.capo;
  const highest = Math.max(...settings.tuning) + settings.maxFret;

  // A range narrower than an octave has no safe fold.
  if (highest - lowest < 12) return notes;

  return notes.map(note => {
    let pitch = note.pitch;
    while (pitch < lowest) pitch += 12;
    while (pitch > highest) pitch -= 12;
    return pitch === note.pitch ? note : { ...note, pitch };
  });
}
