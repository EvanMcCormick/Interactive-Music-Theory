import { BarDoc, NotePitch, TimeSignature } from '../models/composer.model';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { trackBeats } from './beat-tracking';
import { buildPreviewDoc } from './preview-score';
import { DerivedScore, deriveScore } from './score-derivation';
import { suppressHarmonics } from './transcription-harmonics';

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

/**
 * Ghost notes that are *struck*, not held over from the beat before.
 *
 * A span no single value can write comes back as a tie, so counting every
 * ghost `NoteDoc` counts one detection more than once. One head is one
 * detection, which is what the conservation law below is stated in.
 */
function ghostHeads(doc: { tracks: { staves: { bars: BarDoc[] }[] }[] }): number {
  return doc.tracks.reduce(
    (heads, track) =>
      heads
      + track.staves.reduce(
        (perStaff, staff) =>
          perStaff
          + staff.bars.reduce(
            (perBar, bar) =>
              perBar
              + (bar.voices[1]?.beats ?? [])
                .filter(beat => !beat.isRest && !beat.notes[0].isTied)
                .reduce((n, beat) => n + beat.notes.length, 0),
            0
          ),
        0
      ),
    0
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

/**
 * The invariant this module exists to uphold, over real detector output.
 *
 * Every candidate handed to `buildPreviewDoc` either gets drawn or gets
 * reported, and nothing may fall between the two. It is the one assertion that
 * catches a silent loss, because a loss is invisible in the document by
 * definition: what comes back is a perfectly well-formed score with fewer
 * ghosts in it than there were discards. Dropping `quantizeBar`'s `dropped`
 * argument from `buildPreviewDoc` is exactly that bug, and it lost thirteen of
 * thirty-three candidates here before anything objected.
 *
 * Swept across the confidence floor rather than asserted at one setting,
 * because the floor is what makes it bite. Raising it shortens the derived
 * document, and every ghost from the bars that vanished is held in the last
 * one - where several land on the same string in the same slot and
 * `addToChord` has to turn them away. At 0.3 nothing collides at all.
 */
describe('buildPreviewDoc over the pinned detector fixture', () => {
  /** [onsetSec, midiPitch, durationSec, amplitude] */
  type Raw = [number, number, number, number];

  const raw = ([onsetSec, pitch, duration, amplitude]: Raw, index: number): DetectedNote => ({
    id: `n${index}`,
    pitch,
    onsetSec,
    offsetSec: onsetSec + duration,
    confidence: amplitude,
    bendCents: []
  });

  /**
   * Verbatim output of @spotify/basic-pitch on a synthetic bassline of eight
   * notes - E1 A1 D2 G2 twice. The same fixture `transcription-harmonics.spec.ts`
   * and `transcription.service.spec.ts` are pinned against; thirty-four notes
   * for eight played, twenty-six of them partials.
   *
   * A hand-written list would not do here. The collisions this test is about
   * come from partials of the same fundamental sharing a string, which is a
   * property of what the model actually emits.
   */
  const SPIKE_OUTPUT: Raw[] = [
    [0.000, 28, 0.464, 0.565], [0.058, 52, 0.244, 0.377], [0.093, 40, 0.267, 0.552],
    [0.093, 47, 0.104, 0.343], [0.488, 33, 0.395, 0.687], [0.488, 45, 0.081, 0.264],
    [0.546, 57, 0.267, 0.328], [0.557, 52, 0.070, 0.329], [0.569, 45, 0.313, 0.514],
    [0.882, 33, 0.093, 0.445], [0.894, 38, 0.081, 0.299], [0.975, 38, 0.418, 0.712],
    [1.022, 62, 0.081, 0.352], [1.045, 50, 0.360, 0.484], [1.393, 38, 0.070, 0.415],
    [1.486, 43, 0.476, 0.666], [1.521, 55, 0.383, 0.428], [1.823, 28, 0.628, 0.520],
    [2.056, 52, 0.244, 0.381], [2.091, 40, 0.267, 0.548], [2.091, 47, 0.104, 0.345],
    [2.486, 33, 0.395, 0.688], [2.486, 45, 0.081, 0.264], [2.544, 57, 0.267, 0.329],
    [2.555, 52, 0.070, 0.329], [2.567, 45, 0.313, 0.514], [2.881, 33, 0.093, 0.443],
    [2.892, 38, 0.081, 0.297], [2.973, 38, 0.488, 0.676], [3.020, 62, 0.081, 0.352],
    [3.043, 50, 0.372, 0.485], [3.496, 43, 0.476, 0.667], [3.519, 55, 0.383, 0.424],
    [3.519, 67, 0.070, 0.349]
  ];

  const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
  const DETECTED: DetectedNote[] = SPIKE_OUTPUT.map(raw);
  const DURATION_SEC = 4;

  /** The pipeline up to derivation, exactly as `TranscriptionService` runs it. */
  function detected(confidenceFloor: number): {
    input: TranscriptionSession;
    suppressed: DetectedNote[];
  } {
    const suppressed: DetectedNote[] = [];
    const notes = suppressHarmonics(DETECTED, {}, suppressed);

    return {
      suppressed,
      input: {
        id: 's1',
        sourceName: 'bassline.wav',
        durationSec: DURATION_SEC,
        notes,
        rawNotes: DETECTED,
        bendFrameRateHz: 86.13,
        // Tracked from the suppressed notes, as the service does.
        grid: trackBeats(notes, DURATION_SEC, FOUR_FOUR),
        settings: { ...createDefaultDerivationSettings(), confidenceFloor }
      }
    };
  }

  // 0.3 leaves nothing colliding; 0.7 and 0.9 collapse the score to one bar and
  // pile every ghost into it. 0.6 sits between the two.
  for (const floor of [0.3, 0.6, 0.7, 0.9]) {
    it(`draws or reports every candidate at a confidence floor of ${floor}`, () => {
      const { input, suppressed } = detected(floor);
      const derived = deriveScore(input);
      const omitted: DetectedNote[] = [];

      const preview = buildPreviewDoc(input, derived, suppressed, omitted);

      const candidates = derived.dropped.length + suppressed.length;

      // Guards the sweep itself: a floor that discarded nothing would satisfy
      // the conservation law by having no candidates to lose.
      expect(candidates).toBeGreaterThan(20);
      expect(ghostHeads(preview) + omitted.length).toBe(candidates);
    });
  }

  it('reports the ghosts it could not place on a taken string', () => {
    // At 0.7 the derived score is one bar, so the ghosts of the second bar are
    // held in it and thirteen of them land on a string already spoken for. The
    // count is the point: a panel printing `omitted.length` understated it by
    // some 40 % while these were vanishing instead.
    const { input, suppressed } = detected(0.7);
    const omitted: DetectedNote[] = [];

    const derived = deriveScore(input);
    expect(derived.doc.masterBars.length).toBe(1);

    buildPreviewDoc(input, derived, suppressed, omitted);

    expect(omitted.length).toBe(13);
  });

  it('loses nothing at a floor low enough that no ghost collides', () => {
    const { input, suppressed } = detected(0.3);
    const omitted: DetectedNote[] = [];

    const preview = buildPreviewDoc(input, deriveScore(input), suppressed, omitted);

    expect(omitted).toEqual([]);
    expect(ghostHeads(preview)).toBe(suppressed.length);
  });
});
