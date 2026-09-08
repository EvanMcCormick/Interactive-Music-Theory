import {
  ChordSlot,
  DEFAULT_VELOCITY,
  ProgressionKey,
  RollNote,
  VOICING_BASE_MIDI
} from '../models/progression.model';
import { degreePitchClasses } from './progression-harmony';
import { voiceChord } from './progression-voicing';

/**
 * The `harmony -> notes` arrow: what a chord slot's label makes it sound.
 *
 * Pure, with no Angular or audio dependency, like the two modules it composes.
 * It is where they meet, and it owns only what neither of them could know: the
 * key the chord is in, and how long it is held. `progression-harmony.ts` works
 * relative to a tonic on purpose and `progression-voicing.ts` refuses to import
 * it at all, so the tonic offset had to land somewhere - and putting it here,
 * in the one module that has both a key and a slot, leaves each of those two
 * checkable on its own against a hand-written table.
 *
 * This is also the only place in M1 that writes `ChordSlot.notes`. That is what
 * makes the model's first load-bearing choice - notes are authoritative for
 * playback, harmony generates them - a mechanism rather than a hope: there is
 * one door between a label and a sound, so "changing the harmony regenerates
 * the notes" is enforced by there being nowhere else to go.
 *
 * ## Block chords
 *
 * Every chord is one attack at the slot's start, held for the whole slot. No
 * arpeggio, no strum, no rhythm. `RollNote` can express all three and M2's
 * piano roll will, but M1's timeline has no way to ask for them, so generating
 * anything more would be inventing a rhythm the user never chose.
 *
 * ## The order of operations
 *
 * `alter` goes onto the pitch classes, then `key.tonic`, and only then does the
 * result reach `voiceChord`. Both offsets are additions, so their order between
 * themselves is unobservable - but both landing *before* voicing is very
 * observable indeed, because the voicing base is a floor rather than a centre.
 * A I in C altered down a semitone is B-D#-F#, and voiced after the alteration
 * it is stacked from the B *above* the base, an octave clear of where sliding
 * the already-voiced chord down would have put it.
 *
 * `OCTAVE_MAX` in the model was measured over exactly this pipeline, with
 * `alter` and `tonic` applied before voicing, precisely because the reach is
 * not transposition-invariant. Reordering these three lines would move chords
 * *and* invalidate the bound that keeps them inside MIDI.
 *
 * ## What is not generated
 *
 * `ChordDegree.quality` is never read. The pitches come from the scale, so the
 * quality is a label the palette computes for display; a slot whose quality
 * disagreed with its scale would still sound the scale's chord, which is the
 * behaviour the model documents.
 *
 * A non-heptatonic scale is not caught here either. `degreePitchClasses` throws
 * on one and that throw is allowed through, rather than being turned into an
 * empty chord that would surface as silence three layers downstream. A caller
 * that would rather explain than fail asks `isHeptatonic` first - that is what
 * it is exported for, and what Task 6's palette does before it renders a single
 * button. Repeating the check here would give the same rule two homes and let
 * them drift.
 */
export function generateSlotNotes(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[]
): RollNote[] {
  // A literal slot has no degree to generate from; its notes ARE the truth.
  // Returned by identity rather than rebuilt, so a caller comparing references
  // - change detection, an undo diff - sees no edit where none happened. This
  // is the branch that lets M3 degrade a slot to literal rather than mislabel
  // it: losing the Roman numeral must cost the user nothing they played.
  if (slot.harmony.kind === 'literal') return slot.notes;

  const degree = slot.harmony.degree;

  // Relative to the tonic, as `degreePitchClasses` returns it, and altered
  // while still in that frame. `suspension` would be honoured here, replacing
  // the third with the second or the fourth - it is stored on the model but
  // deliberately not sounded until M2, and half-implementing it would make
  // slots that look suspended and play major.
  const relative = degreePitchClasses(scaleIntervals, degree.degree, degree.extent)
    .map(pitchClass => pitchClass + degree.alter);

  const absolute = relative.map(pitchClass => pitchClass + key.tonic);
  const base = VOICING_BASE_MIDI + degree.octave * 12;

  return voiceChord(absolute, degree.inversion, base).map(midi => ({
    midi,
    // Beats on a `RollNote` are relative to its own slot, so a block chord that
    // fills the slot starts at 0 whatever the slot's position in the timeline.
    startBeat: 0,
    lengthBeats: slot.lengthBeats,
    velocity: DEFAULT_VELOCITY
  }));
}
