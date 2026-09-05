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
import { TranscriptionSession } from '../models/transcription.model';
import { assignFingering } from './transcription-fingering';
import { correctOctaves } from './transcription-octave';
import { PlacedNote, quantizeBar } from './transcription-quantize';
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

/** General MIDI program 33: electric bass, finger. */
const BASS_PROGRAM = 33;

const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

/**
 * Interprets detected events as notation.
 *
 * Pure and fast, so every setting is a live knob: changing tuning, capo,
 * meter, grid or confidence floor re-derives the whole score rather than
 * re-running detection. That is the point of keeping raw events around.
 */
export function deriveScore(session: TranscriptionSession): ScoreDoc {
  const { settings, grid } = session;
  const timeSignature = grid.timeSignature;

  const audible = session.notes.filter(
    note => note.confidence >= settings.confidenceFloor
  );

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

  // Fingering runs across the whole piece rather than bar by bar, so hand
  // position carries over bar lines the way a player's does. The NotePitch
  // values come back with 1-based tab string numbers, matching StaffDoc.tuning
  // and ScoreDocMapperService, so nothing here has to renumber them.
  const fingering = assignFingering(
    corrected.map(note => ({ pitch: note.pitch, onsetSec: note.onsetSec })),
    settings
  );

  const slotsPerBeat = settings.finestDivision / timeSignature.denominator;
  const slotsPerBar = timeSignature.numerator * slotsPerBeat;

  const placed: { bar: number; beatInBar: number; pitch: NotePitch }[] = [];
  corrected.forEach((note, index) => {
    const pitch = fingering[index];
    if (!pitch) return;

    // Anything before the first downbeat is pulled onto it; a proper pickup
    // bar needs a negative-bar concept the score model does not carry.
    const beat = Math.max(0, secondsToBeats(note.onsetSec, grid));

    // The bar comes off the rounded slot, not the raw beat: a note in the last
    // half-slot of a bar belongs on the next bar's downbeat, and choosing the
    // bar first would pull it back onto this bar's final slot instead. The
    // position handed on stays unrounded, so quantizeBar can still see two
    // onsets a few tens of milliseconds apart as one chord.
    const bar = Math.floor(Math.round(beat * slotsPerBeat) / slotsPerBar);
    placed.push({ bar, beatInBar: beat - bar * timeSignature.numerator, pitch });
  });

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
      .map(entry => ({ beatInBar: entry.beatInBar, pitch: entry.pitch }));

    return {
      clef: 'f4',
      clefOttava: 'regular',
      keySignature: key,
      voices: [{ beats: quantizeBar(inBar, timeSignature, settings.finestDivision) }]
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
    title: session.sourceName,
    subTitle: '',
    artist: '',
    album: '',
    tempo: gridTempo(grid),
    masterBars,
    tracks: [track]
  };
}
