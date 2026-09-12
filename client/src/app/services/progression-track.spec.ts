import {
  BeatDoc,
  ClefKind,
  KeySignatureMode,
  MasterBarDoc,
  NoteDoc,
  OttaviaKind,
  ScoreDoc,
  TimeSignature,
  TrackDoc,
  createDefaultBar,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import {
  ChordSlot,
  ProgressionDoc,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import { MAX_PREVIEW_BARS, PROGRESSION_FINEST_DIVISION, progressionToScore } from './progression-score';
import {
  GeneratedTrack,
  flattenGeneratedTrack,
  generatedTrackIndex,
  generatedTrackState,
  mergeGeneratedTrack,
  progressionTrack
} from './progression-track';

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
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

const IONIAN = [0, 2, 4, 5, 7, 9, 11];

/** C major triad from middle C, the voicing `generateSlotNotes` produces for I. */
const C_MAJOR_TRIAD = [60, 64, 67];
const F_MAJOR_TRIAD = [65, 69, 72];
const G_MAJOR_TRIAD = [67, 71, 74];

/** A chord held for the whole of its slot, which is what the roll writes. */
function slotOf(startBeat: number, lengthBeats: number, midis = C_MAJOR_TRIAD): ChordSlot {
  return {
    ...createDegreeSlot(0, startBeat),
    lengthBeats,
    notes: midis.map(midi => ({ midi, startBeat: 0, lengthBeats, velocity: DEFAULT_VELOCITY }))
  };
}

/** A progression of one bar-long chord, unless a caller wants otherwise. */
function docOf(overrides: Partial<ProgressionDoc> = {}): ProgressionDoc {
  return { ...createDefaultProgression(), slots: [slotOf(0, 4)], ...overrides };
}

/** A progression of `bars` bar-long chords, one per 4/4 bar. */
function docOfBars(bars: number, overrides: Partial<ProgressionDoc> = {}): ProgressionDoc {
  return docOf({
    slots: Array.from({ length: bars }, (_, index) => slotOf(index * 4, 4)),
    ...overrides
  });
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
function plainTrack(name: string, bars = 0, meter: TimeSignature = FOUR_FOUR): TrackDoc {
  return {
    id: name,
    name,
    shortName: name.slice(0, 3),
    color: '#3498db',
    playback: createDefaultPlaybackInfo(0),
    staves: [
      {
        tuning: [],
        tuningLabel: '',
        capo: 0,
        transpose: 0,
        displayTranspose: 0,
        showStandardNotation: true,
        showTablature: false,
        showSlash: false,
        showNumbered: false,
        bars: Array.from({ length: bars }, () => createDefaultBar(false, meter))
      }
    ],
    generated: null
  };
}

/**
 * A staff whose bars carry none of `createDefaultBar`'s defaults.
 *
 * `plainTrack` cannot stand in for this one and that is the whole reason it
 * exists: its bars *are* `createDefaultBar`'s output, so a padding routine that
 * ignored the staff it was padding and wrote fresh defaults would agree with it
 * exactly. This is the score a user actually has after loading a `.gp` file -
 * `composer-library-panel.component.ts` and `composer.component.ts` both hand
 * `replaceDocument` a mapped `ScoreDoc`, and a bass staff in E flat comes back
 * with `f4` and three flats on every bar.
 */
function loadedTrack(name: string, bars: number): TrackDoc {
  const track = plainTrack(name, bars);

  return {
    ...track,
    staves: track.staves.map(staff => ({
      ...staff,
      bars: staff.bars.map(bar => ({
        ...bar,
        clef: 'f4' as ClefKind,
        clefOttava: '8vb' as OttaviaKind,
        keySignature: { fifths: -3, mode: 'major' as KeySignatureMode }
      }))
    }))
  };
}

/**
 * A score of `bars` bars holding the user's own tracks, and nothing generated.
 *
 * Unlike `scoreOf` this one honours the invariant at the top of
 * `composer.service.ts` - every staff has exactly `masterBars.length` bars -
 * because that invariant is the thing the merge cases are checking, and a
 * fixture that broke it going in would make the assertion coming out
 * unreadable.
 */
function userScore(
  bars: number,
  tracks: TrackDoc[] = [plainTrack('Guitar', bars)],
  meter: TimeSignature = FOUR_FOUR
): ScoreDoc {
  return {
    title: 'Score',
    subTitle: '',
    artist: '',
    album: '',
    tempo: 120,
    masterBars: Array.from({ length: bars }, (_, index) => ({
      ...createDefaultMasterBar(),
      timeSignature: index === 0 ? { ...meter } : null
    })),
    tracks
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

  it('falls back to a name of its own when the progression has none', () => {
    // Nothing stops a progression being saved unnamed, and a track labelled
    // with the empty string is a row in the panel the user cannot point at.
    // The projection's own constant is the fallback, because it is the honest
    // description of a track nobody has named.
    expect(progressionTrack(docOf({ name: '   ' }), IONIAN, FOUR_FOUR).track.name).toBe(
      'Progression'
    );
  });

  it('gives each progression a track id of its own', () => {
    // The projection calls its only track `progression`, which is unique in a
    // preview holding one. Two progressions sent to one score - the case
    // `generatedTrackIndex` exists for - would otherwise collide.
    const first = progressionTrack(docOf(), IONIAN, FOUR_FOUR).track;
    const second = progressionTrack(docOf(), IONIAN, FOUR_FOUR).track;

    expect(first.id).not.toBe(second.id);
  });

  it('keeps one progression\'s track id across rebuilds', () => {
    // The other half of the id rule, and the half Update needs: a refresh of a
    // track already in the score has to be recognisably the same track.
    const doc = docOf({ revision: 1 });

    expect(progressionTrack({ ...doc, revision: 2 }, IONIAN, FOUR_FOUR).track.id).toBe(
      progressionTrack(doc, IONIAN, FOUR_FOUR).track.id
    );
  });

  it('is projected from a score of exactly one track', () => {
    // The assumption `progressionTrack` destructures on. It reads as a detail
    // of the projection and is load-bearing here: with `noUncheckedIndexedAccess`
    // off, a projection that emitted none would hand this module `undefined`
    // and be noticed only by whatever read the track afterwards.
    const projected = progressionToScore(docOf(), PROGRESSION_FINEST_DIVISION, IONIAN);

    expect(projected.doc.tracks.length).toBe(1);
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
    // The whole document rather than the meter it swaps, because the meter is
    // only the field this function is known to touch: the projection walks
    // every slot and note under it, and a future version that decorated a
    // `RollNote` in place would be caught here rather than by whatever read
    // the progression next.
    const doc = docOf({ timeSignature: FOUR_FOUR });
    const before = structuredClone(doc);

    progressionTrack(doc, IONIAN, THREE_FOUR);

    expect(doc).toEqual(before);
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

  it('is absent for a score with no tracks at all', () => {
    // The case the `tracks[-1]` idiom rests on, and the only one where the
    // index and the lookup are both empty-handed rather than just the lookup.
    expect(generatedTrackState(scoreOf([]), docOf())).toBe('absent');
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
      // Written out rather than spread over `marked.generated`, which is
      // `GeneratedOrigin | null` and would need an assertion to spread.
      generated: {
        progressionId: doc.id,
        progressionName: doc.name,
        source: { kind: 'diverged' }
      }
    };

    expect(generatedTrackState(scoreOf([diverged]), doc)).toBe('stale');
  });
});

/**
 * A copy of `score` with a note struck in one bar of one track.
 *
 * Stands in for the user's own work, and it has to be a *note* rather than a
 * marker of some cheaper kind: the rule under test is that a shorter
 * progression does not delete a bar somebody else is writing in, and only a bar
 * with something in it can demonstrate that it survived.
 */
function withNoteIn(score: ScoreDoc, trackIndex: number, barIndex: number, midi = 62): ScoreDoc {
  const note: NoteDoc = {
    pitch: { kind: 'pitched', noteValue: midi % 12, octave: Math.floor(midi / 12) - 1 },
    isTied: false,
    accidental: 'auto',
    effects: createDefaultNoteEffects()
  };

  const clone = structuredClone(score);
  const beat = clone.tracks[trackIndex].staves[0].bars[barIndex].voices[0].beats[0];
  beat.isRest = false;
  beat.notes = [note];
  return clone;
}

/** MIDI of the first note written in that bar, or null if the bar is silent. */
function noteMidiAt(score: ScoreDoc, trackIndex: number, barIndex: number): number | null {
  const bar = score.tracks[trackIndex].staves[0].bars[barIndex];
  for (const beat of bar?.voices[0].beats ?? []) {
    if (!beat.isRest && beat.notes.length > 0) return midiOf(beat.notes[0]);
  }
  return null;
}

/**
 * The invariant at the top of `composer.service.ts`, asserted rather than
 * assumed.
 *
 * Called from every merge case instead of from one of them, because each case
 * reaches the padding by a different route - appending, replacing, growing -
 * and a single check would only pin whichever route it happened to take.
 */
function expectEveryStaffBarred(score: ScoreDoc): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      expect(staff.bars.length).toBe(score.masterBars.length);
    }
  }
}

describe('mergeGeneratedTrack', () => {
  it('never shrinks the score, and keeps the bars a user was writing in', () => {
    // The rule of the three that protects a user's own work, so it is the one
    // written first. A progression falling from eight bars to four leaves four
    // bars of rest behind; deleting bar 7 out from under the guitar track is
    // not an answer, however tidy the result looks.
    const eight = mergeGeneratedTrack(userScore(1), progressionTrack(docOfBars(8), IONIAN, FOUR_FOUR));
    const withWork = withNoteIn(eight, 0, 6);

    const four = mergeGeneratedTrack(withWork, progressionTrack(docOfBars(4), IONIAN, FOUR_FOUR));

    expect(four.masterBars.length).toBe(8);
    expect(noteMidiAt(four, 0, 6)).toBe(62);
    expectEveryStaffBarred(four);
  });

  it('appends when the score has none', () => {
    const generated = progressionTrack(docOf(), IONIAN, FOUR_FOUR);

    const merged = mergeGeneratedTrack(userScore(4), generated);

    expect(merged.tracks.length).toBe(2);
    expect(merged.tracks[1].generated).toEqual(generated.track.generated);
    expectEveryStaffBarred(merged);
  });

  it('replaces in place, keeping the track order', () => {
    // Update is a refresh of a track the user has already placed among their
    // own. Appending a second one, or moving this one to the end, would both
    // rearrange a panel the user arranged.
    const doc = docOf({ revision: 1 });
    const score = mergeGeneratedTrack(
      userScore(4, [plainTrack('Guitar', 4), plainTrack('Bass', 4)]),
      progressionTrack(doc, IONIAN, FOUR_FOUR)
    );
    const reordered: ScoreDoc = {
      ...score,
      tracks: [score.tracks[0], score.tracks[2], score.tracks[1]]
    };

    const merged = mergeGeneratedTrack(
      reordered,
      progressionTrack({ ...doc, revision: 2 }, IONIAN, FOUR_FOUR)
    );

    expect(merged.tracks.length).toBe(3);
    expect(merged.tracks.map(track => track.name)).toEqual(['Guitar', doc.name, 'Bass']);
    expect(merged.tracks[1].generated?.source).toEqual({ kind: 'revision', revision: 2 });
    expectEveryStaffBarred(merged);
  });

  it('keeps the name the track in the score already carries', () => {
    // Update refreshes music, not labels. The marker keeps its own copy of the
    // progression's name, so the track's own name is free to be the user's -
    // and the answer that cannot destroy work is the one that does not
    // overwrite it.
    const doc = docOf({ revision: 1, name: 'Verse' });
    const score = mergeGeneratedTrack(userScore(4), progressionTrack(doc, IONIAN, FOUR_FOUR));
    const renamed: ScoreDoc = {
      ...score,
      tracks: score.tracks.map(track => (track.generated ? { ...track, name: 'Intro riff' } : track))
    };

    const merged = mergeGeneratedTrack(
      renamed,
      progressionTrack({ ...doc, revision: 2, name: 'Chorus' }, IONIAN, FOUR_FOUR)
    );

    expect(merged.tracks[1].name).toBe('Intro riff');
    // What the track came from is still current, because that is the marker's
    // copy and not the label's.
    expect(merged.tracks[1].generated?.progressionName).toBe('Chorus');
  });

  it('grows masterBars to fit and pads every other staff', () => {
    const merged = mergeGeneratedTrack(
      userScore(2, [plainTrack('Guitar', 2), plainTrack('Bass', 2)]),
      progressionTrack(docOfBars(6), IONIAN, FOUR_FOUR)
    );

    expect(merged.masterBars.length).toBe(6);
    // Padding, not silence-by-omission: the caret steps through a bar's rests,
    // so an empty bar has to be a bar of rests.
    expect(merged.tracks[0].staves[0].bars[5].voices[0].beats.length).toBe(4);
    expect(merged.tracks[0].staves[0].bars[5].voices[0].beats.every(beat => beat.isRest)).toBeTrue();
    expectEveryStaffBarred(merged);
  });

  it('pads a staff in the clef and key signature its own bars carry', () => {
    // The regression a `.gp` file finds and `plainTrack` cannot. A bass staff
    // loaded from a file is in `f4` with a real key signature on every bar, and
    // `createDefaultBar` writes `g2` in C major - so padding that ignores the
    // staff it is padding puts treble-clef, no-accidental bars on the tail of a
    // bass staff. `composer.service.ts`'s own `insertBar` copies all three from
    // a template bar, and this is the same job on the other end of the staff.
    const merged = mergeGeneratedTrack(
      userScore(2, [loadedTrack('Bass', 2)]),
      progressionTrack(docOfBars(6), IONIAN, FOUR_FOUR)
    );
    const padded = merged.tracks[0].staves[0].bars[5];

    expect(padded.clef).toBe('f4');
    expect(padded.clefOttava).toBe('8vb');
    expect(padded.keySignature).toEqual({ fifths: -3, mode: 'major' });
    expectEveryStaffBarred(merged);
  });

  it('falls back to the defaults for a staff with no bar to copy from', () => {
    // The other half of the rule, and the case that has no answer but the
    // default: a staff of no bars carries no clef to carry forward. Reachable
    // through the invariant rather than in spite of it - a score of no bars has
    // staves of no bars, and merging into one is how a progression reaches an
    // empty Composer.
    const merged = mergeGeneratedTrack(
      userScore(0, [plainTrack('Guitar', 0)]),
      progressionTrack(docOf(), IONIAN, FOUR_FOUR)
    );
    const padded = merged.tracks[0].staves[0].bars[0];

    expect(padded.clef).toBe('g2');
    expect(padded.keySignature).toEqual({ fifths: 0, mode: 'major' });
  });

  it('keeps the repeats and sections the score\'s own bars carry', () => {
    // What the "only bars past the score's end come from the projection" rule
    // is *for*. A `MasterBarDoc` holds repeats, sections and tempo automations
    // the projection has never heard of, so a grow that took the projection's
    // bar wherever it had one would erase them. Every other fixture here is a
    // default master bar, which the projection's own bar matches byte for byte
    // - so this is the only case where taking the wrong one shows.
    const score = userScore(2);
    const marked: ScoreDoc = {
      ...score,
      masterBars: score.masterBars.map((bar, index) =>
        index === 1
          ? { ...bar, isRepeatStart: true, section: { marker: 'B', text: 'Chorus' } }
          : bar
      )
    };

    const merged = mergeGeneratedTrack(marked, progressionTrack(docOfBars(6), IONIAN, FOUR_FOUR));

    expect(merged.masterBars.length).toBe(6);
    expect(merged.masterBars[1].isRepeatStart).toBeTrue();
    expect(merged.masterBars[1].section).toEqual({ marker: 'B', text: 'Chorus' });
  });

  it('pads in the meter the score is in, not the one every fixture happens to be', () => {
    // `effectiveTimeSignature` earning its call. A 3/4 score padded with 4/4
    // bars gives the caret a fourth position in a bar the master bars say holds
    // three, and every fixture above is in 4/4 - so a literal would pass all of
    // them.
    const merged = mergeGeneratedTrack(
      userScore(2, [plainTrack('Guitar', 2, THREE_FOUR)], THREE_FOUR),
      progressionTrack(docOfBars(6), IONIAN, THREE_FOUR)
    );

    expect(merged.tracks[0].staves[0].bars[5].voices[0].beats.length).toBe(3);
    expectEveryStaffBarred(merged);
  });

  it('appends rather than overwriting when the generated track carries no marker', () => {
    // The guard the match helper opens with, and the only thing standing
    // between an unmarked `GeneratedTrack` and the user's first track: an
    // ordinary track's `generated` is null and `null?.progressionId` is
    // `undefined` too, so a search for an undefined id finds the first track
    // *nobody* generated and replaces it.
    const generated = progressionTrack(docOf(), IONIAN, FOUR_FOUR);
    const unmarked: GeneratedTrack = {
      ...generated,
      track: { ...generated.track, generated: null }
    };

    const merged = mergeGeneratedTrack(userScore(4), unmarked);

    expect(merged.tracks.length).toBe(2);
    expect(merged.tracks[0].name).toBe('Guitar');
  });

  it('leaves the score it was handed alone', () => {
    // Pure, and for the reason a pure module is pure rather than for anything
    // about the Composer: both arguments belong to the caller, which is
    // entitled to go on reading either one after the merge returns. The
    // Composer's `commit()` happens to clone twice over and so would survive a
    // merge that wrote through - that is its business, and not this module's
    // licence to.
    const score = withNoteIn(userScore(2), 0, 1);
    const before = structuredClone(score);

    mergeGeneratedTrack(score, progressionTrack(docOfBars(6), IONIAN, FOUR_FOUR));

    expect(score).toEqual(before);
  });
});

/**
 * A generated track detached into an ordinary one.
 *
 * The whole of Flatten is the marker going away, so the cases below are mostly
 * about what does *not* move: the track keeps its name, its id, its bars and
 * its place, and the rest of the score is not rewritten around it. The three
 * no-op cases are one rule stated three ways - an index naming no marked track
 * is nothing to detach, whether it names no track at all or one nobody
 * generated.
 */
describe('flattenGeneratedTrack', () => {
  it('clears the marker and changes nothing else', () => {
    const doc = docOf();
    const before = mergeGeneratedTrack(userScore(4), progressionTrack(doc, IONIAN, FOUR_FOUR));
    const index = generatedTrackIndex(before, doc);

    const after = flattenGeneratedTrack(before, index);

    expect(after.tracks[index].generated).toBeNull();
    // The whole document rather than the track, because "changes nothing else"
    // is a claim about the score: the bars, the other tracks and the track's
    // own name and id all have to arrive the way they left.
    expect(after).toEqual({
      ...before,
      tracks: before.tracks.map((track, at) => (at === index ? { ...track, generated: null } : track))
    });
  });

  it('leaves a score with no generated track alone', () => {
    // Spelled through `generatedTrackIndex` because that is how the Composer
    // will reach it, and -1 is what it hands over for a score holding nothing
    // of this progression.
    const score = userScore(4);

    expect(flattenGeneratedTrack(score, generatedTrackIndex(score, docOf()))).toBe(score);
  });

  it('leaves a score alone for an index past its last track', () => {
    const score = userScore(4);

    expect(flattenGeneratedTrack(score, score.tracks.length)).toBe(score);
  });

  it('leaves a track nobody generated alone', () => {
    // An in-range index is not on its own a licence to write: the marker is
    // what Flatten removes, and a plain track has none to remove.
    const score = userScore(4);

    expect(flattenGeneratedTrack(score, 0)).toBe(score);
  });

  it('leaves the score it was handed alone', () => {
    // Pure, like its neighbours, and for the same reason: the score handed in
    // is the caller's, and a caller comparing before against after has to have
    // a before left to compare.
    const doc = docOf();
    const score = mergeGeneratedTrack(userScore(4), progressionTrack(doc, IONIAN, FOUR_FOUR));
    const snapshot = structuredClone(score);

    flattenGeneratedTrack(score, generatedTrackIndex(score, doc));

    expect(score).toEqual(snapshot);
  });
});

/**
 * Quarter notes a written beat occupies, dots and tuplet included.
 *
 * Negative durations are alphaTab's: -2 is a breve and -4 a longa, so they
 * multiply where the positive values divide.
 */
function beatQuarters(beat: BeatDoc): number {
  const plain = beat.duration < 0 ? 4 * -beat.duration : 4 / beat.duration;
  const dotted = plain * (2 - Math.pow(0.5, beat.dots));
  return beat.tuplet ? (dotted * beat.tuplet.denominator) / beat.tuplet.numerator : dotted;
}

function midiOf(note: NoteDoc): number {
  if (note.pitch.kind !== 'pitched') throw new Error('the projection writes pitched notes only');
  return note.pitch.noteValue + (note.pitch.octave + 1) * 12;
}

/**
 * Every attack in a generated track, as sorted `beat@midi` strings.
 *
 * Walks the bars and sums durations rather than reading a position off
 * anything, because a position read back off the same bar lines the property is
 * about would agree with itself whatever those bar lines did. Tied notes are
 * skipped: a tie's far end is one attack still sounding, and where a re-barring
 * cuts it is exactly what is allowed to move.
 */
function attackSet(generated: GeneratedTrack): string[] {
  const attacks: string[] = [];
  let quarters = 0;

  for (const bar of generated.track.staves[0].bars) {
    for (const beat of bar.voices[0].beats) {
      for (const note of beat.notes) {
        if (!note.isTied) attacks.push(`${quarters.toFixed(4)}@${midiOf(note)}`);
      }
      quarters += beatQuarters(beat);
    }
  }

  return attacks.sort();
}

describe('the meter is the score\'s, and re-barring moves no note', () => {
  it('places the same attacks in 4/4, 3/4 and 6/8', () => {
    // What the design's meter rule rests on. Swapping the progression's meter
    // for the score's is only free if it moves bar lines and nothing else, and
    // this is the whole of that claim: twelve quarter notes of I-IV-V land on
    // the same absolute beats however they are barred.
    const doc = docOf({
      slots: [
        slotOf(0, 4, C_MAJOR_TRIAD),
        slotOf(4, 4, F_MAJOR_TRIAD),
        slotOf(8, 4, G_MAJOR_TRIAD)
      ]
    });
    const attacks = (meter: TimeSignature) => attackSet(progressionTrack(doc, IONIAN, meter));

    // Two guards, because an equality between two empty arrays is also true and
    // so is one between two re-barrings that did not re-bar. Nine attacks, and
    // three bars against four.
    expect(attacks(FOUR_FOUR).length).toBe(9);
    expect(progressionTrack(doc, IONIAN, FOUR_FOUR).masterBars.length).toBe(3);
    expect(progressionTrack(doc, IONIAN, THREE_FOUR).masterBars.length).toBe(4);
    expect(progressionTrack(doc, IONIAN, SIX_EIGHT).masterBars.length).toBe(4);

    expect(attacks(THREE_FOUR)).toEqual(attacks(FOUR_FOUR));
    expect(attacks(SIX_EIGHT)).toEqual(attacks(FOUR_FOUR));
  });
});
