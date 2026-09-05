import {
  BarDoc,
  KeySignature,
  MasterBarDoc,
  NotePitch,
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
 */

/** Why a detected note is not in the score. */
export type DropReason =
  /** `confidence` was below `DerivationSettings.confidenceFloor`. */
  | 'belowConfidence'
  /** No string and fret on this instrument sounds the pitch. */
  | 'unplayable'
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

/** General MIDI program 33: electric bass, finger. */
const BASS_PROGRAM = 33;

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
 * Interprets detected events as notation.
 *
 * Pure and fast, so every setting is a live knob: changing tuning, capo,
 * meter, grid or confidence floor re-derives the whole score rather than
 * re-running detection. That is the point of keeping raw events around.
 *
 * Returns the discards alongside the score. Three paths lose notes - the
 * confidence floor here, an unplayable pitch in `assignFingering`, a taken
 * string in `quantizeBar` - and a `ScoreDoc` records none of them. Handing
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

  // Checked before the sort, because a non-finite onset spoils both stages and
  // nothing downstream can recover from it. `Math.max(0, NaN)` is NaN, so such
  // a note takes a NaN bar index, matches no bar, and drags `barCount` to NaN -
  // which `Array.from` reads as zero, yielding a ScoreDoc with no bars at all.
  // `ComposerService.replaceDocument` then throws inside `clampCursor`. It also
  // defeats `quantizeBar`'s own NaN guard, which the note never reaches. The
  // sibling modules' habit: fail loudly on input that would otherwise corrupt
  // quietly, the way `correctOctaves` does on a pitch outside MIDI.
  for (const note of audible) {
    if (!Number.isFinite(note.onsetSec)) {
      throw new Error(
        `note ${note.id} has onset ${note.onsetSec}, which is not a time in seconds`
      );
    }
  }

  // Safe in place: `filter` already returned an array of its own, so the
  // caller's `session.notes` ordering is untouched. `assignFingering` documents
  // ascending onsets as a precondition and `separateSimultaneous` clusters on
  // the same assumption, so this sort is load-bearing, not cosmetic.
  audible.sort((a, b) => a.onsetSec - b.onsetSec);

  // correctOctaves folds onto one interval, lowest open string to highest
  // fret, while candidatesFor knows each string reaches only `maxFret - capo`
  // frets. Below four frets those bands stop overlapping and the two disagree;
  // see "Deliberately not in M1". No instrument here is anywhere near that
  // short, so nothing downstream compensates for it.
  const corrected = correctOctaves(audible, settings);

  const slotsPerBeat = settings.finestDivision / timeSignature.denominator;
  const slotsPerBar = timeSignature.numerator * slotsPerBeat;
  const barLimit = barsInSource(session);

  // Computed once and shared, because fingering and placement have to agree
  // about where a note sits to the last decimal. Anything before the first
  // downbeat is pulled onto it here rather than later; a proper pickup bar
  // needs a negative-bar concept the score model does not carry, and two
  // pickup onsets clamped onto beat 0 are as simultaneous to `quantizeBar` as
  // any chord, so `assignFingering` has to see them that way too.
  const beats = corrected.map(note => Math.max(0, secondsToBeats(note.onsetSec, grid)));

  // Fingering runs across the whole piece rather than bar by bar, so hand
  // position carries over bar lines the way a player's does. The NotePitch
  // values come back with 1-based tab string numbers, matching StaffDoc.tuning
  // and ScoreDocMapperService, so nothing here has to renumber them.
  //
  // The chord tolerance travels with them: `quantizeBar` merges onsets inside
  // it into one chord and keeps one pitch per string, so anything it will
  // merge has to leave `assignFingering` already on distinct strings. This
  // assembly is the only place that knows both windows, which is why sizing
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

  // Keyed by the `PlacedNote` object itself rather than by an id the type does
  // not carry, so a note `quantizeBar` turns away can be named here without
  // widening `PlacedNote` for a field only this caller would ever read.
  const source = new Map<PlacedNote, DetectedNote>();

  const placed: { bar: number; note: PlacedNote }[] = [];
  corrected.forEach((note, index) => {
    const pitch = fingering[index];
    if (!pitch) {
      // No string and fret sounds this pitch, so there is nothing to write. It
      // is reported at the corrected pitch, which is the one that had no fret.
      dropped.push({ note, reason: 'unplayable' });
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
    const entry: PlacedNote = {
      beatInBar: beat - bar * timeSignature.numerator,
      pitch
    };
    source.set(entry, note);
    placed.push({ bar, note: entry });
  });

  // Bounded by construction: every entry's bar was clamped to `barLimit - 1`.
  const barCount = placed.reduce((max, entry) => Math.max(max, entry.bar), 0) + 1;

  const masterBars: MasterBarDoc[] = Array.from({ length: barCount }, (_, index) => ({
    ...createDefaultMasterBar(),
    // Only bar 1 states the signature; the rest inherit it.
    timeSignature: index === 0 ? timeSignature : null
  }));

  const key = settings.key ?? C_MAJOR;

  const bars: BarDoc[] = Array.from({ length: barCount }, (_, index) => {
    const inBar: PlacedNote[] = placed
      .filter(entry => entry.bar === index)
      .map(entry => entry.note);

    // One array per bar, drained straight into `dropped`, so the losses come
    // out in bar order and nothing has to be matched up afterwards.
    const taken: PlacedNote[] = [];
    const beatDocs = quantizeBar(inBar, timeSignature, settings.finestDivision, taken);

    for (const entry of taken) {
      const note = source.get(entry);
      // Sound: every element of `inBar` was registered in `source` when it was
      // built above, and `quantizeBar` only ever hands back notes it was given.
      if (note) dropped.push({ note, reason: 'stringTaken' });
    }

    return {
      clef: 'f4',
      clefOttava: 'regular',
      keySignature: key,
      voices: [{ beats: beatDocs }]
    };
  });

  const staff: StaffDoc = {
    tuning: [...settings.tuning],
    tuningLabel: 'Transcribed',
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
    playback: createDefaultPlaybackInfo(BASS_PROGRAM),
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
