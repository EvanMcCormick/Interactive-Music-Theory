import { BarDoc, NotePitch } from '../models/composer.model';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { buildPreviewDoc } from './preview-score';
import { DerivedScore, deriveScore } from './score-derivation';

/**
 * The preview is only trustworthy if voice 1 is provably the document that
 * exports, so that is the assertion most of these tests are really making.
 */

const note = (
  pitch: number,
  onsetSec: number,
  confidence = 1,
  id = `${pitch}@${onsetSec}`
): DetectedNote => ({
  id,
  pitch,
  onsetSec,
  offsetSec: onsetSec + 0.4,
  confidence,
  bendCents: []
});

/** Eight beats at 120 BPM: two bars of 4/4. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

function session(
  notes: DetectedNote[],
  rawNotes: DetectedNote[] = notes,
  durationSec = 4
): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec,
    notes,
    rawNotes,
    bendFrameRateHz: 86.13,
    grid: GRID,
    settings: createDefaultDerivationSettings()
  };
}

/** Notes struck in a bar's ghost voice, as [string, fret] pairs. */
function ghostsInBar(bar: BarDoc): [number, number][] {
  const voice = bar.voices[1];
  if (!voice) return [];

  return voice.beats
    .filter(beat => !beat.isRest && !beat.notes[0].isTied)
    .flatMap(beat =>
      beat.notes.map(n => {
        const pitch: NotePitch = n.pitch;
        return pitch.kind === 'fretted'
          ? ([pitch.string, pitch.fret] as [number, number])
          : ([-1, -1] as [number, number]);
      })
    );
}

function everyGhostNote(doc: { tracks: { staves: { bars: BarDoc[] }[] }[] }) {
  return doc.tracks.flatMap(track =>
    track.staves.flatMap(staff =>
      staff.bars.flatMap(bar => (bar.voices[1]?.beats ?? []).flatMap(beat => beat.notes))
    )
  );
}

describe('buildPreviewDoc', () => {
  /** A session whose second note is too quiet to reach the score. */
  const quiet = (): TranscriptionSession =>
    session([note(43, 0.0), note(45, 1.0, 0.1), note(47, 2.0)]);

  it('leaves voice 1 deep-equal to the derived document', () => {
    const input = quiet();
    const derived = deriveScore(input);
    const before = JSON.parse(JSON.stringify(derived.doc));

    const preview = buildPreviewDoc(input, derived, []);

    preview.tracks[0].staves[0].bars.forEach((bar, index) => {
      expect(bar.voices[0]).toEqual(before.tracks[0].staves[0].bars[index].voices[0]);
    });
  });

  it('does not disturb the document it was given', () => {
    const input = quiet();
    const derived = deriveScore(input);
    const before = JSON.parse(JSON.stringify(derived.doc));

    buildPreviewDoc(input, derived, []);

    expect(JSON.parse(JSON.stringify(derived.doc))).toEqual(before);
  });

  it('marks every note it adds as a ghost', () => {
    const input = quiet();
    const preview = buildPreviewDoc(input, deriveScore(input), []);
    const ghosts = everyGhostNote(preview);

    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every(n => n.effects.isGhost)).toBe(true);
  });

  it('never marks a note of voice 1 as a ghost', () => {
    const input = quiet();
    const preview = buildPreviewDoc(input, deriveScore(input), []);

    const struck = preview.tracks[0].staves[0].bars.flatMap(bar =>
      bar.voices[0].beats.flatMap(beat => beat.notes)
    );

    expect(struck.length).toBeGreaterThan(0);
    expect(struck.some(n => n.effects.isGhost)).toBe(false);
  });

  it('puts a discarded note in the bar its onset falls in', () => {
    // The kept notes at 0 s and 2 s make the score two bars long; 2.5 s is
    // beat 5 of the grid, which is beat 2 of bar 2.
    const input = session([note(43, 0.0), note(47, 2.0), note(45, 2.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []);
    const bars = preview.tracks[0].staves[0].bars;

    expect(bars.length).toBe(2);
    expect(ghostsInBar(bars[0])).toEqual([]);
    expect(ghostsInBar(bars[1]).length).toBe(1);
  });

  it('places a ghost on the beat the discarded note was played on', () => {
    // 1.5 s is the last beat of a 4/4 bar at 120 BPM, so the ghost voice is
    // three beats of rest and then the note - four slots per beat on a
    // sixteenth grid, however those twelve slots end up spelled.
    const input = session([note(43, 0.0), note(45, 1.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []);
    const ghostVoice = preview.tracks[0].staves[0].bars[0].voices[1];

    expect(ghostVoice).toBeDefined();

    const struckAt = ghostVoice.beats.findIndex(beat => !beat.isRest);
    const before = ghostVoice.beats.slice(0, struckAt);

    expect(before.every(beat => beat.isRest)).toBe(true);
    expect(
      before.reduce(
        (slots, beat) => slots + (16 / beat.duration) * [1, 1.5, 1.75][beat.dots],
        0
      )
    ).toBe(12);
  });

  it('ghosts the notes harmonic suppression removed', () => {
    const kept = [note(43, 0.0), note(43, 1.0)];
    const partial = note(55, 0.0, 1, 'partial');
    const input = session(kept, [...kept, partial]);

    const preview = buildPreviewDoc(input, deriveScore(input), [partial]);

    expect(everyGhostNote(preview).length).toBeGreaterThan(0);
  });

  it('adds no ghost content to a clean session', () => {
    const input = session([note(43, 0.0), note(45, 1.0), note(47, 2.0)]);
    const derived = deriveScore(input);

    expect(derived.dropped).toEqual([]);

    const preview = buildPreviewDoc(input, derived, []);
    const bars = preview.tracks[0].staves[0].bars;

    expect(bars.every(bar => bar.voices.length === 1)).toBe(true);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('gives every bar a ghost voice once anything has been discarded', () => {
    // Only bar 2 has a discard, but bar 1 gets the voice too. alphaTab reads
    // `bar.nextBar.voices[index]` unchecked when it chains beats, so a bar
    // carrying voice 2 followed by a bar without one throws out of
    // `Score.finish` before a note is drawn.
    const input = session([note(43, 0.0), note(47, 2.0), note(45, 2.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []);
    const bars = preview.tracks[0].staves[0].bars;

    expect(bars.length).toBe(2);
    expect(bars.every(bar => bar.voices.length === 2)).toBe(true);
  });

  it('fills the ghost voice of a bar that discarded nothing with rests', () => {
    const input = session([note(43, 0.0), note(47, 2.0), note(45, 2.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []);
    const quiet = preview.tracks[0].staves[0].bars[0].voices[1];

    expect(quiet.beats.every(beat => beat.isRest)).toBe(true);
  });

  it('leaves out a ghost no fingering can place, rather than crashing', () => {
    // A one-string instrument five frets long reaches 28 to 33 and no further.
    // The range is narrower than an octave, so `correctOctaves` has no safe
    // fold and leaves the pitch where the detector put it - which is how a
    // note ends up genuinely unplayable rather than merely misheard.
    const unplayable = note(100, 1.0);
    const input: TranscriptionSession = {
      ...session([note(28, 0.0), unplayable]),
      settings: { ...createDefaultDerivationSettings(), tuning: [28], maxFret: 5 }
    };
    const omitted: DetectedNote[] = [];

    const derived = deriveScore(input);
    expect(derived.dropped).toEqual([{ note: unplayable, reason: 'unplayable' }]);

    const preview = buildPreviewDoc(input, derived, [], omitted);

    expect(omitted).toEqual([unplayable]);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('leaves out a ghost whose onset is not a time', () => {
    const timeless = note(45, Number.NaN, 0.1);
    const input = session([note(43, 0.0), timeless]);
    const omitted: DetectedNote[] = [];

    const preview = buildPreviewDoc(input, deriveScore(input), [], omitted);

    expect(omitted).toEqual([timeless]);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('holds a ghost past the end of the score in its last bar', () => {
    // The kept note sizes the score at one bar; the discard is two bars later.
    const input = session([note(43, 0.0), note(45, 4.5, 0.1)], undefined, 8);
    const derived = deriveScore(input);
    const preview = buildPreviewDoc(input, derived, []);
    const bars = preview.tracks[0].staves[0].bars;

    expect(bars.length).toBe(derived.doc.tracks[0].staves[0].bars.length);
    expect(ghostsInBar(bars[bars.length - 1]).length).toBe(1);
  });

  it('reports nothing omitted when everything could be drawn', () => {
    const input = quiet();
    const omitted: DetectedNote[] = [];

    buildPreviewDoc(input, deriveScore(input), [], omitted);

    expect(omitted).toEqual([]);
  });

  it('keeps the ghost bar exactly as full as the bar it sits under', () => {
    const input = session([note(43, 0.0), note(45, 1.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []);

    for (const bar of preview.tracks[0].staves[0].bars) {
      const slots = (voice: { beats: { duration: number; dots: number }[] }): number =>
        voice.beats.reduce(
          (sum, beat) => sum + (16 / beat.duration) * [1, 1.5, 1.75][beat.dots],
          0
        );

      for (const voice of bar.voices) expect(slots(voice)).toBe(16);
    }
  });

  it('survives a derivation with no discards and no suppression', () => {
    const empty: DerivedScore = deriveScore(session([]));

    expect(() => buildPreviewDoc(session([]), empty, [])).not.toThrow();
  });
});
