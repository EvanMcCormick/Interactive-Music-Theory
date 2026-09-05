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
 */
export function correctOctaves(
  notes: DetectedNote[],
  settings: DerivationSettings
): DetectedNote[] {
  const lowest = Math.min(...settings.tuning) + settings.capo;
  const highest = Math.max(...settings.tuning) + settings.capo + settings.maxFret;

  // A range narrower than an octave has no safe fold.
  if (highest - lowest < 12) return notes;

  return notes.map(note => {
    let pitch = note.pitch;
    while (pitch < lowest) pitch += 12;
    while (pitch > highest) pitch -= 12;
    return pitch === note.pitch ? note : { ...note, pitch };
  });
}
