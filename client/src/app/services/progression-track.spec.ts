import {
  MasterBarDoc,
  ScoreDoc,
  TimeSignature,
  TrackDoc,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import {
  ChordSlot,
  ProgressionDoc,
  RollNote,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import { MAX_PREVIEW_BARS } from './progression-score';
import { generatedTrackIndex, generatedTrackState, progressionTrack } from './progression-track';

/**
 * The progression as a track, and what a score can say about it afterwards.
 *
 * Two subjects, and they fail for different reasons. `progressionTrack` is
 * mostly a lift: `progression-score.ts` has already been checked as notation
 * next door, so what is pinned here is only what this module adds on top of it
 * - the marker, the name, the meter it projects in, and the truncation flag it
 * has to carry out rather than swallow. `generatedTrackState` is the other half
 * and reads a score rather than building one; every case below is one of the
 * three answers it can give, including the two that are stale for different
 * reasons.
 */

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

const IONIAN = [0, 2, 4, 5, 7, 9, 11];

/** C major triad from middle C, the voicing `generateSlotNotes` produces for I. */
const C_MAJOR_TRIAD = [60, 64, 67];

function triadNotes(lengthBeats: number): RollNote[] {
  return C_MAJOR_TRIAD.map(midi => ({
    midi,
    startBeat: 0,
    lengthBeats,
    velocity: DEFAULT_VELOCITY
  }));
}

function slotOf(startBeat: number, lengthBeats: number): ChordSlot {
  return { ...createDegreeSlot(0, startBeat), lengthBeats, notes: triadNotes(lengthBeats) };
}

/** A progression of one bar-long chord, unless a caller wants otherwise. */
function docOf(overrides: Partial<ProgressionDoc> = {}): ProgressionDoc {
  return { ...createDefaultProgression(), slots: [slotOf(0, 4)], ...overrides };
}

/**
 * A score holding exactly these tracks.
 *
 * `masterBars` is empty and the plain tracks carry no staves, because neither
 * function under test reads a bar: they answer from `TrackDoc.generated` alone.
 * Keeping the bar counts in step is the job of whatever assembles a real score,
 * and a fixture that pretended to do it here would be checking that instead.
 */
function scoreOf(tracks: TrackDoc[]): ScoreDoc {
  const masterBars: MasterBarDoc[] = [];
  return { title: 'Score', subTitle: '', artist: '', album: '', tempo: 120, masterBars, tracks };
}

/** A track nobody generated, of the kind a user's own score is full of. */
function plainTrack(name: string): TrackDoc {
  return {
    id: name,
    name,
    shortName: name.slice(0, 3),
    color: '#3498db',
    playback: createDefaultPlaybackInfo(0),
    staves: [],
    generated: null
  };
}

describe('progressionTrack', () => {
  it('marks the track with the revision it was built from', () => {
    const doc = docOf({ revision: 7 });

    expect(progressionTrack(doc, IONIAN, FOUR_FOUR).track.generated).toEqual({
      progressionId: doc.id,
      progressionName: doc.name,
      source: { kind: 'revision', revision: 7 }
    });
  });

  it('names the track after the progression', () => {
    const doc = docOf({ name: 'Twelve bar' });

    expect(progressionTrack(doc, IONIAN, FOUR_FOUR).track.name).toBe('Twelve bar');
  });

  it('bars the progression in the meter it is given, not the one it holds', () => {
    // The whole of "the score's meter wins": eight quarter notes are two bars
    // of 4/4 and three of 3/4, and the progression's own 4/4 does not get a
    // say once it is a track in somebody else's score.
    const doc = docOf({ slots: [slotOf(0, 8)], timeSignature: FOUR_FOUR });
    const generated = progressionTrack(doc, IONIAN, THREE_FOUR);

    expect(generated.masterBars.length).toBe(3);
    expect(generated.masterBars[0].timeSignature).toEqual(THREE_FOUR);
    expect(generated.track.staves[0].bars.length).toBe(3);
  });

  it('leaves the progression it was handed alone', () => {
    const doc = docOf({ timeSignature: FOUR_FOUR });
    progressionTrack(doc, IONIAN, THREE_FOUR);

    expect(doc.timeSignature).toEqual(FOUR_FOUR);
  });

  it('carries the projection\'s truncation flag out', () => {
    // The projection stops at `MAX_PREVIEW_BARS`, and a caller that is about to
    // write a `.gp` file needs to know that what it holds is not the whole
    // progression - which it cannot tell from the track.
    const doc = docOf({ slots: [slotOf(0, 4 * (MAX_PREVIEW_BARS + 10))] });

    expect(progressionTrack(doc, IONIAN, FOUR_FOUR).truncated).toBeTrue();
  });

  it('reports an ordinary progression as whole', () => {
    expect(progressionTrack(docOf(), IONIAN, FOUR_FOUR).truncated).toBeFalse();
  });
});

describe('generatedTrackIndex', () => {
  it('finds the marked track among the user\'s own', () => {
    const doc = docOf();
    const score = scoreOf([
      plainTrack('Guitar'),
      progressionTrack(doc, IONIAN, FOUR_FOUR).track,
      plainTrack('Bass')
    ]);

    expect(generatedTrackIndex(score, doc)).toBe(1);
  });

  it('is -1 when no track carries a marker', () => {
    expect(generatedTrackIndex(scoreOf([plainTrack('Guitar')]), docOf())).toBe(-1);
  });

  it('is -1 when the marker names a different progression', () => {
    const score = scoreOf([progressionTrack(docOf(), IONIAN, FOUR_FOUR).track]);

    expect(generatedTrackIndex(score, docOf())).toBe(-1);
  });
});

describe('generatedTrackState', () => {
  it('is absent when no track carries a marker', () => {
    expect(generatedTrackState(scoreOf([plainTrack('Guitar')]), docOf())).toBe('absent');
  });

  it('is absent when the marker names a different progression', () => {
    // Two progressions can be sent to one score, and a score holding somebody
    // else's track holds nothing of this one's: absent, not stale.
    const score = scoreOf([progressionTrack(docOf({ revision: 3 }), IONIAN, FOUR_FOUR).track]);

    expect(generatedTrackState(score, docOf({ revision: 3 }))).toBe('absent');
  });

  it('is current when the revisions match', () => {
    const doc = docOf({ revision: 3 });
    const score = scoreOf([progressionTrack(doc, IONIAN, FOUR_FOUR).track]);

    expect(generatedTrackState(score, doc)).toBe('current');
  });

  it('is stale when the progression has moved on', () => {
    const doc = docOf({ revision: 3 });
    const score = scoreOf([progressionTrack(doc, IONIAN, FOUR_FOUR).track]);

    expect(generatedTrackState(score, { ...doc, revision: 4 })).toBe('stale');
  });

  it('is stale when the track has diverged', () => {
    // The hole the counter cannot see: a score-wide bar insertion moved the
    // track's content and `revision` never budged. The union is what makes it
    // one answer rather than a second check.
    const doc = docOf({ revision: 3 });
    const marked = progressionTrack(doc, IONIAN, FOUR_FOUR).track;
    const diverged: TrackDoc = {
      ...marked,
      generated: { ...marked.generated!, source: { kind: 'diverged' } }
    };

    expect(generatedTrackState(scoreOf([diverged]), doc)).toBe('stale');
  });
});
