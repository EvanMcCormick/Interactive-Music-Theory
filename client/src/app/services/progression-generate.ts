import {
  DEFAULT_VELOCITY,
  MIDI_MAX,
  OCTAVE_MAX,
  OCTAVE_MIN,
  VOICING_BASE_MIDI
} from '../models/progression-normalize';
import {
  ChordDegree,
  ChordSlot,
  ProgressionKey,
  RollNote
} from '../models/progression.model';
import { chordPitchClasses } from './progression-harmony';
import { headroomOctaves, voiceChord } from './progression-voicing';

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
 * ## Why the return is `readonly`
 *
 * The two branches hand back different kinds of array. The degree branch builds
 * a fresh one holding fresh notes; the literal branch returns the slot's *own*
 * array holding the slot's *own* notes. Nothing in the signature separates
 * them, so a caller that sorted or spliced the result in place - a scheduler
 * ordering notes before handing them to Tone, say - would quietly rewrite a
 * literal slot's playback truth while leaving every degree slot untouched. That
 * is a bug reproducing only on the slots M3 creates. `readonly` costs nothing
 * while no caller mutates the result, and costs a great deal less now than
 * after something has been written against a promise this function cannot keep.
 *
 * ## Where the borrowed chords come from
 *
 * `ChordDegree.quality` used to be stored and never read here, and the pitches
 * came from the scale alone - which meant the design's borrowed-chord mechanism
 * had no implementation behind it. `alter` shifted the whole stack, which is a
 * transposition, and transposition preserves quality, so bVII in a major key
 * came out diminished, bVI, bIII and the Neapolitan bII came out minor, and
 * #iv-dim came out major.
 *
 * `chordPitchClasses` is that correction, and this module's only part in it is
 * to hand the field over: `alter` now moves the root alone and a non-null
 * quality overrides the shape. The rules that fall out - what a chromatic root
 * with no quality does, what an override does above extent 7 - live with the
 * arithmetic in `progression-harmony.ts` rather than here.
 *
 * The other half is `regenerateSlot`, which merges rather than replacing and so
 * leaves a non-null quality alone. The generator honours an override and the
 * edit path keeps it, which is what makes the field somewhere a borrowed chord
 * can be written.
 *
 * A non-heptatonic scale is not caught here either. `degreePitchClasses` throws
 * on one and that throw is allowed through, rather than being turned into an
 * empty chord that would surface as silence three layers downstream. A caller
 * that would rather explain than fail asks `isHeptatonic` first - that is what
 * it is exported for, and what the chord palette does before it renders a
 * single button. Repeating the check here would give the same rule two homes
 * and let them drift.
 */
/**
 * The pitch class a chord is rooted on: the same key applied to the same
 * degree, one note wide instead of a whole stack.
 *
 * Every part of the app that *names* a chord needs this and none of them may
 * derive it independently, because the name and the sound have to come from one
 * arithmetic. It lives here because this is the module that owns applying a key
 * to a degree at all - `progression-harmony.ts` is deliberately tonic-relative
 * - and `generateSlotNotes` below computes the same sum for the whole chord,
 * two lines down from this one, where the two can be read together.
 *
 * `alter` and then the tonic, in the order the generator applies them. Both are
 * additions, so the order between them is unobservable; what matters is that
 * neither is left out, and that `alter` can push the sum below zero, where
 * JavaScript's `%` returns a negative and `MusicTheoryService.spellNote` would
 * index off the front of the chromatic table. Nothing in M1 moves `alter`, but
 * `replaceDocument` can bring in a document that already has.
 *
 * The caller decides whether the key can name a chord at all before asking:
 * this is arithmetic, and it will happily root a chord in a scale that cannot
 * stack thirds. `ProgressionState.canBuildChords` is that check, already
 * applied.
 */
export function chordRootPitchClass(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  degree: ChordDegree
): number {
  const raw = key.tonic + scaleIntervals[degree.degree] + degree.alter;
  return ((raw % 12) + 12) % 12;
}

/**
 * The highest octave this chord may be voiced at without leaving MIDI.
 *
 * `OCTAVE_MIN` and `OCTAVE_MAX` bound the octave *control*, one pair of numbers
 * for every chord in the app. That held while the widest chord the model could
 * build reached 46 semitones above its base - `OCTAVE_MAX` of 1 puts that at
 * MIDI 118 - and M3 Task 4 widened the model to 58, which is 130. A global bound
 * can only answer that by moving down for everyone, costing every chord the top
 * octave to accommodate one almost nobody will build.
 *
 * So the ceiling is derived per chord instead, and this is where. The pieces
 * were always in three places - the shape is `chordPitchClasses`', the reach is
 * `headroomOctaves`', and the key is only ever here - and this function is the
 * one place all three are in hand at once. `chordRootPitchClass` above is the
 * same argument one note wide.
 *
 * ## What it does *not* do
 *
 * **It does not write anything back.** `ChordDegree.octave` keeps storing what
 * the user asked for, and `normalizeChordDegree` keeps bounding it to the
 * control's own range and nothing narrower. Storing a clamped value would make
 * the clamp outlive its cause: a slot pushed down because a pinned ♭13 widened
 * it would stay down after the ♭13 came off. Clamping on use means the chord
 * returns to the octave it was given the moment it narrows again - after an
 * extension is unpinned, after a key change into a scale that stacks tighter,
 * after an inversion that puts a lower note on top.
 *
 * That is also why this cannot be a normalisation clamp even in principle: the
 * ceiling needs the chord, the chord needs the scale, and `normalizeChordDegree`
 * has neither. It guards a slot, not a slot in a key.
 *
 * ## Why it is bounded at both ends
 *
 * The result is always a legal octave, so a caller can use it as one without
 * checking. `OCTAVE_MAX` is the real bound above - an ordinary chord has
 * headroom for four or five octaves and may not have them. `OCTAVE_MIN` below is
 * defensive and provably inert: it would only bind on a chord reaching more than
 * 91 semitones above its base, where the widest the model can build reaches 58,
 * and `progression-generate.spec.ts` asserts over its sample that the floor is
 * never the reason for an answer. Left off, a chord that did somehow exceed 91
 * would be voiced below C2 rather than out of MIDI - a quieter wrong answer, and
 * one with no control that could reach back up to it.
 *
 * The refusals below belong to `chordPitchClasses` and are allowed through
 * rather than repeated: a ceiling for a chord that cannot be built is a question
 * with no answer, and `ProgressionState.canBuildChords` is the check a caller
 * that would rather explain than fail asks first.
 */
export function chordOctaveCeiling(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  degree: ChordDegree
): number {
  return ceilingFor(absolutePitchClasses(key, scaleIntervals, degree), degree.inversion);
}

/** The chord a degree names, in the key it is in: `alter`, then the tonic. */
function absolutePitchClasses(
  key: ProgressionKey,
  scaleIntervals: readonly number[],
  degree: ChordDegree
): number[] {
  return chordPitchClasses(scaleIntervals, degree).map(pitchClass => pitchClass + key.tonic);
}

/** The ceiling for an already-built chord, so the generator builds one once. */
function ceilingFor(absolute: readonly number[], inversion: number): number {
  const headroom = headroomOctaves(absolute, inversion, VOICING_BASE_MIDI, MIDI_MAX);
  return Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, headroom));
}

export function generateSlotNotes(
  slot: ChordSlot,
  key: ProgressionKey,
  scaleIntervals: readonly number[]
): readonly RollNote[] {
  // A literal slot has no degree to generate from; its notes ARE the truth.
  // Returned by identity rather than rebuilt, so a caller comparing references
  // - change detection, an undo diff - sees no edit where none happened. This
  // is the branch that lets M3 degrade a slot to literal rather than mislabel
  // it: losing the Roman numeral must cost the user nothing they played.
  //
  // Hazard for `ProgressionService.setSlotLength`: it follows that setting a
  // literal slot's length is a silent no-op as far as its notes go.
  // Regeneration returns them unchanged,
  // so shrinking the slot leaves notes hanging past its end and lengthening it
  // leaves silence at the end. That is arguably correct under "notes are the
  // truth" - stretching them to fit a drag would be the app rewriting what the
  // user played - but it should be a documented consequence rather than
  // something M3 discovers the first time a literal slot is resized.
  if (slot.harmony.kind === 'literal') return slot.notes;

  const degree = slot.harmony.degree;

  // Relative to the tonic, as `degreePitchClasses` returns it, with `alter`,
  // any override, the suspension and any pinned extension applied while still
  // in that frame. The whole degree goes over as one object - it satisfies
  // `ChordShape` by structure - which is what stopped this call growing a sixth
  // and seventh positional argument at M3.
  //
  // The field is handed over as it is stored. It used to be mapped on the way
  // in - a stored `'other'` read as no override - because `regenerateSlot` wrote
  // the *derived* label into it on every regeneration and `'other'` is the
  // derived label for a stack that is no named chord, which `chordPitchClasses`
  // refuses. That write is gone, `ChordDegree.quality` narrowed to
  // `NamedQuality | null` with it, and `normalizeChordDegree` turns `'other'`
  // away at the door - so there is nothing left to launder, and a refusal that
  // does reach here is a real one rather than an artefact.
  const absolute = absolutePitchClasses(key, scaleIntervals, degree);

  // The stored octave is what the user asked for; the ceiling is what this
  // chord can take. `Math.min` is the whole rule - a chord below its ceiling is
  // left exactly where it was put, including below the base - and it is applied
  // here rather than written back, so a slot held down by a chord too wide for
  // its octave rises again by itself when the chord narrows. See
  // `chordOctaveCeiling`.
  const octave = Math.min(degree.octave, ceilingFor(absolute, degree.inversion));
  const base = VOICING_BASE_MIDI + octave * 12;

  return voiceChord(absolute, degree.inversion, base).map(midi => ({
    midi,
    // Beats on a `RollNote` are relative to its own slot, so a block chord that
    // fills the slot starts at 0 whatever the slot's position in the timeline.
    startBeat: 0,
    lengthBeats: slot.lengthBeats,
    velocity: DEFAULT_VELOCITY
  }));
}
