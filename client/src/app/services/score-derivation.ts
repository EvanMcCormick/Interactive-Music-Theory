import {
  BarDoc,
  ClefKind,
  KeySignature,
  MasterBarDoc,
  ScoreDoc,
  StaffDoc,
  TrackDoc,
  createDefaultMasterBar,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import { DetectedNote, TranscriptionSession } from '../models/transcription.model';
import { assignFingering } from './transcription-fingering';
import { correctOctaves } from './transcription-octave';
import { PlacedNote, chordToleranceBeats, quantizeBar } from './transcription-quantize';
import { gridTempo, secondsToBeats } from './transcription-timing';

/**
 * Assembles detected events into a score.
 *
 * The single public entry point of the derivation core, and the only module
 * here that knows the order the others run in: confidence floor, then octave
 * correction, then fingering across the whole piece, then a split into bars
 * and a quantization of each. Fingering deliberately runs before the split, so
 * the hand position a player would carry over a bar line is carried over here
 * too - bar-by-bar fingering would reset it at every line.
 *
 * Pure, with no Angular or audio dependency, following the `staff-pitch.ts`
 * precedent. Nothing is memoised and nothing is cached: re-deriving is cheap
 * enough that every setting can be a live knob.
 *
 * ## The tuning decides more than the tab
 *
 * Clef, playback program and staff name all come off `settings.tuning` through
 * `instrumentVoiceFor`. They were fixed at bass for as long as a bass was the
 * only instrument reachable; once the review panel offered guitar tunings, a
 * guitar preset changed the tab's line count - which the mapper reads straight
 * off `staff.tuning` - and left the notation staff drawing guitar pitches on a
 * bass clef and the exported track playing them on a bass program.
 */

/** Why a detected note is not in the score. */
export type DropReason =
  /** `confidence` was below `DerivationSettings.confidenceFloor`. */
  | 'belowConfidence'
  /** No string and fret on this instrument sounds the pitch. */
  | 'unplayable'
  /**
   * Sounded before the beat grid begins.
   *
   * The score has no pickup bar - a negative bar index is not a thing the
   * model carries - so such a note is pulled onto beat 0, where it can land on
   * top of what is genuinely there. When that costs the note, this is what
   * happened to it: not two notes struck together on one string, but a note
   * moved onto another one because there was nowhere earlier to put it.
   * Reporting it as `stringTaken` blamed a collision the performance did not
   * contain.
   *
   * The grid's first beat is not the music's: `trimBeats` starts the grid at
   * the first beat the onsets support, so anything quiet in front of that is
   * outside it. See `BeatGrid`.
   */
  | 'beforeGrid'
  /** Struck with another note already holding the string, and a tab line
   *  holds one number. */
  | 'stringTaken';

export interface DroppedNote {
  /**
   * The note as derivation last saw it.
   *
   * After octave correction for the two later reasons, so its pitch explains
   * the drop: a pitch folded into range and then found unplayable is reported
   * at the pitch that had no fret, not the one the detector guessed.
   */
  note: DetectedNote;
  reason: DropReason;
}

/**
 * A derived score and everything derivation had to throw away to write it.
 *
 * The discards are half the answer, not a diagnostic. A `ScoreDoc` on its own
 * cannot say whether a bar is empty because nothing was played or because
 * everything in it fell below the confidence floor, and M3 has to render those
 * notes greyed rather than let them disappear. Recovering that from the score
 * alone would mean re-filtering `session.notes` and re-implementing this
 * module's rules to work out what is missing - a second copy of the pipeline,
 * kept in step by hope.
 */
export interface DerivedScore {
  doc: ScoreDoc;
  /**
   * Grouped by the stage that discarded them: the confidence floor first, in
   * the session's own order, then the fingering and quantization losses in
   * onset order.
   */
  dropped: DroppedNote[];
}

/**
 * How a tuning is written and how it sounds back.
 *
 * Three answers that have to agree with each other and with the tuning the
 * user picked: a guitar part written on a bass clef and played by a bass
 * program is wrong three times over, and *Open in Composer* lands it in the
 * composer as a bass track.
 */
export interface InstrumentVoice {
  clef: ClefKind;
  /** General MIDI program number, 0-based, as `PlaybackInfoDoc.program` wants it. */
  program: number;
  /** What the staff is called when the caller did not name the tuning itself. */
  label: string;
}

/** General MIDI 33, electric bass (finger), on the bass clef. */
const BASS_VOICE: InstrumentVoice = { clef: 'f4', program: 33, label: 'Bass' };

/**
 * General MIDI 27, electric guitar (clean), on the treble clef.
 *
 * `clefOttava` stays `regular` rather than `8vb`, matching `createDefaultBar`'s
 * guitar staff, so a transcription and a score started in the composer are
 * written the same way. Guitar notation conventionally sounds an octave below
 * the written pitch; expressing that is `StaffDoc.displayTranspose`'s job and
 * a change to make for every guitar staff at once rather than only for these.
 */
const GUITAR_VOICE: InstrumentVoice = { clef: 'g2', program: 27, label: 'Guitar' };

/**
 * Highest open string that still reads as a bass, in MIDI.
 *
 * The two families are far apart at the top and the gap is where the threshold
 * goes: the highest string of every bass offered is G2 (43), a six-string bass
 * reaches C3 (48), and the lowest guitar offered is a half step down at Eb4
 * (63). E3 (52) sits in the middle of that fifteen-semitone gap, an octave
 * under the guitar's own top string.
 *
 * Read off `Math.max(...tuning)` rather than the string count, because string
 * count does not separate them - five-string basses and six-string basses both
 * exist, and a six-string bass and a six-string guitar share nothing but the
 * number of lines.
 *
 * A threshold is cheap and wrong at the edges: a baritone guitar or a piccolo
 * bass would be misfiled, and what that costs is a clef and a timbre, both of
 * which the composer can change. Telling instruments apart properly means an
 * instrument field on `DerivationSettings`, which is the right answer once
 * there is a third family to tell apart rather than a boundary to place.
 */
const HIGHEST_BASS_STRING = 52;

/**
 * Which family `tuning` belongs to.
 *
 * Exported because the review panel's presets and this rule have to agree
 * about what "Guitar, standard" means, and a second copy of the threshold is
 * how they would stop agreeing.
 *
 * An empty tuning gives `-Infinity`, and a tuning carrying a NaN gives NaN;
 * both compare false against the threshold and land on bass, which is the
 * pipeline's default instrument.
 */
export function instrumentVoiceFor(tuning: readonly number[]): InstrumentVoice {
  return Math.max(...tuning) > HIGHEST_BASS_STRING ? GUITAR_VOICE : BASS_VOICE;
}

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

/**
 * Bars allowed past the end of the source, so a note arriving in its final
 * moments still has somewhere to live.
 *
 * One, and no more: bar assignment rounds an onset to the nearest slot, so a
 * note in the last half-slot of the audio is carried onto the downbeat of the
 * bar after it - a bar the source duration on its own does not account for.
 */
const RING_OUT_BARS = 1;

/**
 * Bars the source audio can hold.
 *
 * `secondsToBeats` extrapolates past the tracked grid without limit, and the
 * bar count comes off the last note, so nothing in that arithmetic stops one
 * stray onset from asking for an arbitrarily long score. A grid with 0.01 s
 * between beats plus a note ten seconds later wants 251 bars from two notes;
 * at 1e-6 s it wants millions, each one a `MasterBarDoc`, a full bar of rests
 * and a pass over `placed`.
 *
 * A note cannot sound after the audio has stopped, so `durationSec` is the
 * honest ceiling. A session that does not carry one falls back to the span of
 * the tracked grid, the only other statement it makes about how long the
 * source is.
 */
function barsInSource(session: TranscriptionSession): number {
  const beats = session.grid.beatsSec;
  const trackedSec = beats.length > 0 ? beats[beats.length - 1] : 0;
  const sourceSec =
    Number.isFinite(session.durationSec) && session.durationSec > 0
      ? session.durationSec
      : trackedSec;

  const bars = Math.ceil(
    secondsToBeats(sourceSec, session.grid) / session.grid.timeSignature.numerator
  );

  // Never below one: a ScoreDoc with no bars is one ComposerService cannot
  // open, which is the failure the NaN-onset guard above also exists to stop.
  return Math.max(1, bars + RING_OUT_BARS);
}

/**
 * Where a detected note goes: which bar, where in it, and how it is fingered.
 *
 * `placed` is the shape `quantizeBar` reads; the rest is what a caller needs
 * to name the note again afterwards, since `PlacedNote` carries no id.
 */
export interface PlacedDetection {
  /** 0-based, and never past the last bar the source can hold. */
  bar: number;
  /** The note as the quantizer wants it: position in the bar, and a fingering. */
  placed: PlacedNote;
  /**
   * The note it came from, after octave correction - so anything reported
   * about this placement quotes the pitch that was actually fretted.
   */
  note: DetectedNote;
  /**
   * True when the clamp onto beat 0 is the only reason it sits where it does.
   *
   * Rounded rather than raw: a note a fraction of a slot early would have
   * snapped onto slot 0 anyway, so the clamp changed nothing about it and a
   * collision there is genuine simultaneity. Only a note whose own slot is
   * before the bar was actually relocated. See `beforeGrid`.
   */
  movedOntoGrid: boolean;
}

/** Everything `placeDetectedNotes` has to say about a batch of detections. */
export interface Placement {
  /** In ascending onset order, one entry per note that could be fingered. */
  placed: PlacedDetection[];
  /**
   * Notes no string and fret on this instrument sounds, reported at the pitch
   * octave correction left them at. Ascending onset order, never in `placed`.
   */
  unplayable: DetectedNote[];
}

/**
 * Works out where each detected note lands on the written page.
 *
 * Exported because two callers need this answer and neither may compute it
 * differently. `deriveScore` places the notes that reach the score;
 * `buildPreviewDoc` places the ones that did not, so it can draw them as
 * ghosts in the bar where the decision was taken. Ghosts positioned by a
 * second copy of these rules would be ghosts that drift out of step with the
 * score they annotate, which is the one thing a review UI must not do.
 *
 * The confidence floor is deliberately *not* applied here: it decides which
 * notes are worth placing, and the preview exists precisely to place the ones
 * it rejected. Callers filter before calling.
 *
 * Octave correction runs inside, so a ghost is drawn at the pitch the
 * instrument would have sounded rather than the one the model guessed. It is
 * idempotent on pitches already inside the neck's range, so passing a note it
 * has already corrected changes nothing.
 */
export function placeDetectedNotes(
  notes: DetectedNote[],
  session: TranscriptionSession
): Placement {
  const { settings, grid } = session;
  const timeSignature = grid.timeSignature;

  // Checked before the sort, because a non-finite onset spoils both stages and
  // nothing downstream can recover from it. `Math.max(0, NaN)` is NaN, so such
  // a note takes a NaN bar index, matches no bar, and drags a caller's bar
  // count to NaN - which `Array.from` reads as zero, yielding a ScoreDoc with
  // no bars at all. `ComposerService.replaceDocument` then throws inside
  // `clampCursor`. It also defeats `quantizeBar`'s own NaN guard, which the
  // note never reaches. The sibling modules' habit: fail loudly on input that
  // would otherwise corrupt quietly, the way `correctOctaves` does on a pitch
  // outside MIDI.
  for (const note of notes) {
    if (!Number.isFinite(note.onsetSec)) {
      throw new Error(
        `note ${note.id} has onset ${note.onsetSec}, which is not a time in seconds`
      );
    }
  }

  // Copied rather than sorted in place, so a caller's array keeps its order.
  // `assignFingering` documents ascending onsets as a precondition and
  // `separateSimultaneous` clusters on the same assumption, so this sort is
  // load-bearing, not cosmetic.
  const sorted = [...notes].sort((a, b) => a.onsetSec - b.onsetSec);

  // correctOctaves folds onto one interval, lowest open string to highest
  // fret, while candidatesFor knows each string reaches only `maxFret - capo`
  // frets. Below four frets those bands stop overlapping and the two disagree;
  // see "Deliberately not in M1". No instrument here is anywhere near that
  // short, so nothing downstream compensates for it.
  const corrected = correctOctaves(sorted, settings);

  const slotsPerBeat = settings.finestDivision / timeSignature.denominator;
  const slotsPerBar = timeSignature.numerator * slotsPerBeat;
  const barLimit = barsInSource(session);

  // Computed once and shared, because fingering and placement have to agree
  // about where a note sits to the last decimal. Anything before the first
  // beat of the grid is pulled onto it here rather than later; a proper pickup
  // bar needs a negative-bar concept the score model does not carry, and two
  // pickup onsets clamped onto beat 0 are as simultaneous to `quantizeBar` as
  // any chord, so `assignFingering` has to see them that way too.
  //
  // The unclamped positions are kept as well, because the clamp is the one
  // thing that can lose a note without the loss being about the note: see
  // `beforeGrid`.
  const rawBeats = corrected.map(note => secondsToBeats(note.onsetSec, grid));
  const beats = rawBeats.map(beat => Math.max(0, beat));

  // Fingering runs across the whole batch rather than bar by bar, so hand
  // position carries over bar lines the way a player's does. The NotePitch
  // values come back with 1-based tab string numbers, matching StaffDoc.tuning
  // and ScoreDocMapperService, so nothing here has to renumber them.
  //
  // The chord tolerance travels with them: `quantizeBar` merges onsets inside
  // it into one chord and keeps one pitch per string, so anything it will
  // merge has to leave `assignFingering` already on distinct strings. This
  // function is the only place that knows both windows, which is why sizing
  // them independently went unnoticed for so long.
  const fingering = assignFingering(
    corrected.map((note, index) => ({
      pitch: note.pitch,
      onsetSec: note.onsetSec,
      beatPosition: beats[index]
    })),
    settings,
    chordToleranceBeats(slotsPerBeat)
  );

  const placed: PlacedDetection[] = [];
  const unplayable: DetectedNote[] = [];

  corrected.forEach((note, index) => {
    const pitch = fingering[index];
    if (!pitch) {
      // No string and fret sounds this pitch, so there is nothing to write. It
      // is reported at the corrected pitch, which is the one that had no fret.
      unplayable.push(note);
      return;
    }

    const beat = beats[index];

    // The bar comes off the rounded slot, not the raw beat: a note in the last
    // half-slot of a bar belongs on the next bar's downbeat, and choosing the
    // bar first would pull it back onto this bar's final slot instead. The
    // position handed on stays unrounded, so quantizeBar can still see two
    // onsets a few tens of milliseconds apart as one chord.
    //
    // Clamped into the source, the far-end counterpart of the `Math.max(0, ...)`
    // above: an onset the grid extrapolates past the end of the audio is held
    // in the last bar rather than allowed to size the score. Held, not dropped
    // - `quantizeBar` pulls the resulting out-of-range `beatInBar` onto the
    // bar's final slot, so the onset is still struck somewhere a reader can
    // see it, which is what dropping it from `placed` would cost.
    const bar = Math.min(
      barLimit - 1,
      Math.floor(Math.round(beat * slotsPerBeat) / slotsPerBar)
    );

    placed.push({
      bar,
      placed: {
        beatInBar: beat - bar * timeSignature.numerator,
        pitch
      },
      note,
      movedOntoGrid: Math.round(rawBeats[index] * slotsPerBeat) < 0
    });
  });

  return { placed, unplayable };
}

/**
 * Interprets detected events as notation.
 *
 * Pure and fast, so every setting is a live knob: changing tuning, capo,
 * meter, grid or confidence floor re-derives the whole score rather than
 * re-running detection. That is the point of keeping raw events around.
 *
 * Returns the discards alongside the score. Three paths lose notes - the
 * confidence floor here, an unplayable pitch in `assignFingering`, a taken
 * string in `quantizeBar`, the last of which reports two different reasons
 * depending on whether the note was where the performance put it - and a
 * `ScoreDoc` records none of them. Handing
 * them back is what lets M3 render a rejected note greyed rather than let it
 * disappear, without re-deriving this module's rules over `session.notes` to
 * guess which notes are missing and why.
 */
export function deriveScore(session: TranscriptionSession): DerivedScore {
  const { settings, grid } = session;
  const timeSignature = grid.timeSignature;

  // Every note that goes in and does not come out, from all three paths that
  // can lose one. Collected as they happen rather than reconstructed at the
  // end: only the stage that discarded a note knows why.
  const dropped: DroppedNote[] = [];

  const audible: DetectedNote[] = [];
  for (const note of session.notes) {
    if (note.confidence >= settings.confidenceFloor) audible.push(note);
    else dropped.push({ note, reason: 'belowConfidence' });
  }

  const placement = placeDetectedNotes(audible, session);
  for (const note of placement.unplayable) dropped.push({ note, reason: 'unplayable' });

  // Keyed by the `PlacedNote` object itself rather than by an id the type does
  // not carry, so a note `quantizeBar` turns away can be named here without
  // widening `PlacedNote` for a field only this caller would ever read.
  const source = new Map<PlacedNote, PlacedDetection>();
  for (const entry of placement.placed) source.set(entry.placed, entry);

  // Bounded by construction: every entry's bar was clamped to `barLimit - 1`.
  const barCount =
    placement.placed.reduce((max, entry) => Math.max(max, entry.bar), 0) + 1;

  const masterBars: MasterBarDoc[] = Array.from({ length: barCount }, (_, index) => ({
    ...createDefaultMasterBar(),
    // Only bar 1 states the signature; the rest inherit it.
    timeSignature: index === 0 ? timeSignature : null
  }));

  const key = settings.key ?? C_MAJOR;

  // Inferred once, from the tuning the score is actually being written on. The
  // tuning was already the only setting the mapper read - it gives the tab its
  // line count - so before this a guitar preset changed the number of lines and
  // nothing else, and the notation staff drew guitar pitches on a bass clef.
  const voice = instrumentVoiceFor(settings.tuning);

  const bars: BarDoc[] = Array.from({ length: barCount }, (_, index) => {
    const inBar: PlacedNote[] = placement.placed
      .filter(entry => entry.bar === index)
      .map(entry => entry.placed);

    // One array per bar, drained straight into `dropped`, so the losses come
    // out in bar order and nothing has to be matched up afterwards.
    const taken: PlacedNote[] = [];
    const beatDocs = quantizeBar(inBar, timeSignature, settings.finestDivision, taken);

    for (const entry of taken) {
      const origin = source.get(entry);
      // Sound: every element of `inBar` was registered in `source` when it was
      // built above, and `quantizeBar` only ever hands back notes it was given.
      if (origin) {
        dropped.push({
          note: origin.note,
          reason: origin.movedOntoGrid ? 'beforeGrid' : 'stringTaken'
        });
      }
    }

    return {
      clef: voice.clef,
      clefOttava: 'regular',
      keySignature: key,
      voices: [{ beats: beatDocs }]
    };
  });

  const staff: StaffDoc = {
    tuning: [...settings.tuning],
    // The preset's own name when the caller stated one, so the staff says what
    // the user picked. Falling back to the inferred family rather than to a
    // placeholder: "Transcribed" named the process, not the instrument.
    tuningLabel: settings.tuningLabel ?? voice.label,
    capo: settings.capo,
    transpose: 0,
    displayTranspose: 0,
    showStandardNotation: true,
    showTablature: true,
    showSlash: false,
    showNumbered: false,
    bars
  };

  const track: TrackDoc = {
    id: 'transcription',
    name: 'Transcription',
    shortName: 'Trn',
    color: '#2c3e50',
    playback: createDefaultPlaybackInfo(voice.program),
    staves: [staff]
  };

  return {
    doc: {
      title: session.sourceName,
      subTitle: '',
      artist: '',
      album: '',
      tempo: gridTempo(grid),
      masterBars,
      tracks: [track]
    },
    dropped
  };
}
