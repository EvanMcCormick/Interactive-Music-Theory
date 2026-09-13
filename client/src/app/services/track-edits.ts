import { PlaybackInfoDoc, ScoreDoc, StaffDoc } from '../models/composer.model';

/**
 * Edits that act on a track or one of its staves.
 *
 * Each returns why it refused, or null, and changes nothing when it refuses.
 */

const NO_STAFF = 'There is no staff there.';

/**
 * Moves every trill on `staff` by `shift(string)` semitones, for the string its note is on.
 *
 * `TrillDoc.value` is a pitch - alphaTab's `Note.trillValue`, a MIDI number - while a note on a
 * string keeps its fret when that string's pitch moves. alphaTex saves a trill as a fret relative
 * to the string, capo included: `Note.trillFret` is `trillValue - stringTuning`
 * (`alphaTab.core.mjs` ~5972), and `stringTuning` is the capo plus the string's tuning (~6032).
 * So a retune or a capo change that left the value where it was would change the trilled interval
 * on screen, in playback and in the saved fret. A transposition is not part of `stringTuning`, so
 * it leaves `trillFret` alone and moves no trill.
 */
function moveTrills(staff: StaffDoc, shift: (string: number) => number): void {
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          const trill = note.effects.trill;
          if (trill && note.pitch.kind === 'fretted') {
            note.effects.trill = { ...trill, value: trill.value + shift(note.pitch.string) };
          }
        }
      }
    }
  }
}

/**
 * Retunes a fretted staff, keeping every note's fret and moving each trill by how far its
 * string moved (`moveTrills`). Refuses to strand a note.
 */
export function setStaffTuning(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  tuning: number[],
  label: string
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (staff.tuning.length === 0) return 'A pitched staff has no strings to tune.';
  if (tuning.length === 0) return 'A tuning needs at least one string.';

  const stranded = staff.bars.some(bar =>
    bar.voices.some(voice =>
      voice.beats.some(beat =>
        beat.notes.some(note => note.pitch.kind === 'fretted' && note.pitch.string > tuning.length)
      )
    )
  );
  if (stranded) {
    return `Some notes sit on strings a ${tuning.length}-string tuning does not have. Move them first.`;
  }

  const was = staff.tuning;
  moveTrills(staff, string => (tuning[string - 1] ?? 0) - (was[string - 1] ?? 0));
  staff.tuning = tuning.slice();
  staff.tuningLabel = label;
  return null;
}

/**
 * Sets capo, transpose or display transpose. A capo moves every trill with it (`moveTrills`);
 * a transposition does not. A pitched staff has no strings, so it takes no capo.
 */
export function setStaffNumber(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  key: 'capo' | 'transpose' | 'displayTranspose',
  value: number
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;
  if (key === 'capo' && staff.tuning.length === 0) return 'A pitched staff has no strings for a capo.';
  if (!Number.isInteger(value)) return 'That must be a whole number.';
  if (key === 'capo' && (value < 0 || value > 24)) return 'A capo sits from fret 0 to 24.';
  if (key !== 'capo' && Math.abs(value) > 24) return 'Transpose by at most two octaves either way.';

  if (key === 'capo') {
    const was = staff.capo;
    moveTrills(staff, () => value - was);
  }
  staff[key] = value;
  return null;
}

/**
 * Changes which views a staff shows. It must show something, and tab needs strings - so turning
 * tablature on is refused on a pitched staff. Only turning it on: a loaded file can leave a
 * pitched staff showing tablature, and that must not lock its other views or keep the tablature
 * from being turned off.
 */
export function setStaffViews(
  doc: ScoreDoc,
  trackIndex: number,
  staffIndex: number,
  views: Partial<Pick<StaffDoc, 'showStandardNotation' | 'showTablature' | 'showSlash' | 'showNumbered'>>
): string | null {
  const staff = doc.tracks[trackIndex]?.staves[staffIndex];
  if (!staff) return NO_STAFF;

  const next = {
    showStandardNotation: views.showStandardNotation ?? staff.showStandardNotation,
    showTablature: views.showTablature ?? staff.showTablature,
    showSlash: views.showSlash ?? staff.showSlash,
    showNumbered: views.showNumbered ?? staff.showNumbered
  };
  if (!next.showStandardNotation && !next.showTablature && !next.showSlash && !next.showNumbered) {
    return 'A staff has to show something.';
  }
  if (next.showTablature && !staff.showTablature && staff.tuning.length === 0) {
    return 'A pitched staff has no strings for tablature.';
  }

  Object.assign(staff, next);
  return null;
}

/** Changes a track's mixer channel. */
export function setPlayback(doc: ScoreDoc, trackIndex: number, changes: Partial<PlaybackInfoDoc>): string | null {
  const track = doc.tracks[trackIndex];
  if (!track) return 'There is no track there.';

  const next = { ...track.playback, ...changes };
  if ([next.volume, next.balance].some(value => !Number.isInteger(value) || value < 0 || value > 16)) {
    return 'Volume and pan run from 0 to 16.';
  }
  if ([next.program, next.bank].some(value => !Number.isInteger(value) || value < 0 || value > 127)) {
    return 'Instrument and bank run from 0 to 127.';
  }

  track.playback = next;
  return null;
}

/** Renames a track. A blank short name is derived from the name, as `addTrack` does. */
export function renameTrack(doc: ScoreDoc, trackIndex: number, name: string, shortName: string): string | null {
  const track = doc.tracks[trackIndex];
  if (!track) return 'There is no track there.';
  if (!name.trim()) return 'A track needs a name.';

  track.name = name.trim();
  track.shortName = shortName.trim() || track.name.slice(0, 3).toLowerCase();
  return null;
}
