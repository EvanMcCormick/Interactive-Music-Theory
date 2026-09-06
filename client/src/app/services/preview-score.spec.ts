import * as alphaTab from '@coderline/alphatab';

import {
  BarDoc,
  NotePitch,
  STANDARD_BASS_TUNING,
  ScoreDoc,
  TimeSignature
} from '../models/composer.model';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { trackBeats } from './beat-tracking';
import { DETECTIONS, detectionsOf } from './harmonic-eval/detections.fixture';
import {
  NoteIndex,
  RenderedNote,
  buildPreviewDoc,
  detectionAt,
  renderedNoteKey
} from './preview-score';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { DerivedScore, WrittenDetection, deriveScore } from './score-derivation';
import {
  DEFAULT_HARMONIC_OPTIONS,
  NO_NOTE_DECISIONS,
  suppressHarmonics
} from './transcription-harmonics';

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
    trackedGrid: GRID,
    beatsPerPulse: 1,
    harmonics: DEFAULT_HARMONIC_OPTIONS,
    monophonic: null,
    decisions: NO_NOTE_DECISIONS,
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

    const preview = buildPreviewDoc(input, derived, []).doc;

    preview.tracks[0].staves[0].bars.forEach((bar, index) => {
      expect(bar.voices[0]).toEqual(before.tracks[0].staves[0].bars[index].voices[0]);
    });
  });

  it('carries voice 1 across by reference rather than rebuilding it', () => {
    // The module's headline guarantee, and `toEqual` above cannot make it: a
    // `structuredClone(bar.voices)` inside `withGhosts` would satisfy every
    // other test here while destroying the thing the docblock claims - that
    // voice 1 of the preview *is* voice 1 of the document that exports, so it
    // provably was not re-derived under different rules.
    const input = quiet();
    const derived = deriveScore(input);

    const preview = buildPreviewDoc(input, derived, []).doc;
    const derivedBars = derived.doc.tracks[0].staves[0].bars;

    expect(preview.tracks[0].staves[0].bars.length).toBe(derivedBars.length);
    preview.tracks[0].staves[0].bars.forEach((bar, index) => {
      expect(bar.voices[0]).toBe(derivedBars[index].voices[0]);
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
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;
    const ghosts = everyGhostNote(preview);

    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every(n => n.effects.isGhost)).toBe(true);
  });

  it('never marks a note of voice 1 as a ghost', () => {
    const input = quiet();
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;

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
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;
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
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;
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

    const preview = buildPreviewDoc(input, deriveScore(input), [partial]).doc;

    expect(everyGhostNote(preview).length).toBeGreaterThan(0);
  });

  it('adds no ghost content to a clean session', () => {
    const input = session([note(43, 0.0), note(45, 1.0), note(47, 2.0)]);
    const derived = deriveScore(input);

    expect(derived.dropped).toEqual([]);

    const preview = buildPreviewDoc(input, derived, []).doc;
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
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;
    const bars = preview.tracks[0].staves[0].bars;

    expect(bars.length).toBe(2);
    expect(bars.every(bar => bar.voices.length === 2)).toBe(true);
  });

  it('fills the ghost voice of a bar that discarded nothing with rests', () => {
    const input = session([note(43, 0.0), note(47, 2.0), note(45, 2.5, 0.1)]);
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;
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

    const preview = buildPreviewDoc(input, derived, [], omitted).doc;

    expect(omitted).toEqual([unplayable]);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('leaves out a suppressed note whose pitch is not a MIDI pitch', () => {
    // `suppressed` notes never went through `correctOctaves` - suppression
    // removed them at detection time, before derivation saw anything - so a
    // pitch `deriveScore` would have thrown on can reach here having been
    // checked by nothing. Defensive against a detector that emits 0-127, but
    // an exception on the re-derive path blanks a preview that had a score.
    const absurd = note(1e9, 1.0, 1, 'absurd');
    const kept = [note(43, 0.0)];
    const input = session(kept, [...kept, absurd]);
    const omitted: DetectedNote[] = [];

    let preview!: ScoreDoc;
    expect(() => {
      preview = buildPreviewDoc(input, deriveScore(input), [absurd], omitted).doc;
    }).not.toThrow();

    expect(omitted).toEqual([absurd]);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('leaves out a ghost whose onset is not a time', () => {
    const timeless = note(45, Number.NaN, 0.1);
    const input = session([note(43, 0.0), timeless]);
    const omitted: DetectedNote[] = [];

    const preview = buildPreviewDoc(input, deriveScore(input), [], omitted).doc;

    expect(omitted).toEqual([timeless]);
    expect(everyGhostNote(preview)).toEqual([]);
  });

  it('holds a ghost past the end of the score in its last bar', () => {
    // The kept note sizes the score at one bar; the discard is two bars later.
    const input = session([note(43, 0.0), note(45, 4.5, 0.1)], undefined, 8);
    const derived = deriveScore(input);
    const preview = buildPreviewDoc(input, derived, []).doc;
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
    const preview = buildPreviewDoc(input, deriveScore(input), []).doc;

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
 * argument from `buildPreviewDoc` is exactly that bug: on the fixture of the
 * day it lost thirteen of thirty-three candidates before anything objected,
 * and on this one it loses twelve of twenty-eight.
 *
 * Swept across the confidence floor rather than asserted at one setting,
 * because the floor is what makes it bite. Raising it shortens the derived
 * document, and every ghost from the bars that vanished is held in the last
 * one - where several land on the same string in the same slot and
 * `addToChord` has to turn them away. At 0.2 nothing is dropped and nothing
 * collides; at 0.9 nothing survives, the score is one bar, and twelve of the
 * twenty-eight candidates cannot be placed.
 */
describe('buildPreviewDoc over the pinned detector fixture', () => {
  /**
   * The detector's frozen output on `walking`, from
   * `harmonic-eval/detections.fixture.ts`.
   *
   * A hand-written list would not do here. The collisions this test is about
   * come from partials of the same fundamental sharing a string, which is a
   * property of what the model actually emits.
   *
   * It used to be thirty-four rows pasted in here, and the same thirty-four
   * pasted into `transcription-harmonics.spec.ts` and
   * `transcription.service.spec.ts`. Besides being three copies of one array,
   * the audio behind them had the discredited duration rule's premise built
   * into the signal; that spec's docblock has the measurement. Nothing in
   * *this* file was ever about suppression's rule, so nothing below changes
   * except the numbers.
   */
  const DETECTED: DetectedNote[] = detectionsOf('walking');

  const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
  /** Rounded up past the last detection, which ends at 7.19 s. */
  const DURATION_SEC = 8;

  /** The pipeline up to derivation, exactly as `TranscriptionService` runs it. */
  function detected(confidenceFloor: number): {
    input: TranscriptionSession;
    suppressed: DetectedNote[];
  } {
    const suppressed: DetectedNote[] = [];
    const notes = suppressHarmonics(DETECTED, {}, NO_NOTE_DECISIONS, false, suppressed);
    const tracked = trackBeats(notes, DURATION_SEC, FOUR_FOUR);

    return {
      suppressed,
      input: {
        id: 's1',
        sourceName: 'bassline.wav',
        durationSec: DURATION_SEC,
        notes,
        rawNotes: DETECTED,
        bendFrameRateHz: 86.13,
        // Tracked from the suppressed notes, as the service does. One call,
        // two fields, exactly as `transcribe` assembles it.
        grid: tracked,
        trackedGrid: tracked,
        beatsPerPulse: 1,
        harmonics: DEFAULT_HARMONIC_OPTIONS,
        monophonic: null,
        decisions: NO_NOTE_DECISIONS,
        settings: { ...createDefaultDerivationSettings(), confidenceFloor }
      }
    };
  }

  // Measured on this capture: 0.2 drops nothing and collides nothing, 0.3
  // drops two, 0.7 is the first floor at which a ghost cannot be placed, and
  // 0.9 collapses the score to one bar and piles all twenty-eight candidates
  // into it.
  for (const floor of [0.2, 0.3, 0.7, 0.9]) {
    it(`draws or reports every candidate at a confidence floor of ${floor}`, () => {
      const { input, suppressed } = detected(floor);
      const derived = deriveScore(input);
      const omitted: DetectedNote[] = [];

      const preview = buildPreviewDoc(input, derived, suppressed, omitted).doc;

      const candidates = derived.dropped.length + suppressed.length;

      // Guards the sweep itself: a floor that discarded nothing would satisfy
      // the conservation law by having no candidates to lose. Ten of the
      // twenty-eight detections are suppressed before derivation, and the
      // floor adds its own on top, so the smallest this ever gets is ten.
      expect(candidates).toBeGreaterThanOrEqual(10);
      expect(ghostHeads(preview) + omitted.length).toBe(candidates);
    });
  }

  it('reports the ghosts it could not place on a taken string', () => {
    // At 0.9 nothing clears the floor, so the derived score is a single bar
    // and every one of the twenty-eight candidates is held in it - where
    // twelve land on a string already spoken for. The count is the point: a
    // panel printing `omitted.length` understated it by some 40 % while these
    // were vanishing instead.
    const { input, suppressed } = detected(0.9);
    const omitted: DetectedNote[] = [];

    const derived = deriveScore(input);
    expect(derived.doc.masterBars.length).toBe(1);

    buildPreviewDoc(input, derived, suppressed, omitted);

    expect(omitted.length).toBe(12);
  });

  it('loses nothing at a floor low enough that no ghost collides', () => {
    // 0.2 is under the lowest confidence in the capture (0.2648), so
    // derivation discards nothing and the only candidates are the ten
    // suppression removed. All ten get drawn.
    const { input, suppressed } = detected(0.2);
    const omitted: DetectedNote[] = [];

    const derived = deriveScore(input);
    expect(derived.dropped).toEqual([]);

    const preview = buildPreviewDoc(input, derived, suppressed, omitted).doc;

    expect(omitted).toEqual([]);
    // Naming the count as well as the equality: with no ghosts at all this
    // would be 0 === 0 and would hold however badly the preview lost them.
    expect(suppressed.length).toBe(10);
    expect(ghostHeads(preview)).toBe(suppressed.length);
  });
});

/**
 * The way back from a note on the page to the detection behind it.
 *
 * A rendered note is a glyph: a string, a fret and a place in a bar. The thing
 * a reader wants to argue with is the *decision* - this partial was suppressed,
 * this note was kept - and a `ScoreDoc` carries no trace of which detection
 * produced which notehead. These tests are about that link surviving the trip
 * through placement, quantization and, in the last group, alphaTab's own model.
 *
 * The tests below read the keys off the document rather than predicting them.
 * Predicting a beat index means reimplementing `snapToSlots`, and a test that
 * reimplements the thing it is testing agrees with it by construction.
 */

/** One fretted notehead as it appears on the page. */
interface RenderedFret {
  bar: number;
  voice: number;
  beat: number;
  /** Tab numbering, the one `StaffDoc.tuning` counts in. */
  string: number;
  fret: number;
  /** True on the held fragments of a tie. */
  isTied: boolean;
}

/** Every fretted notehead of a document's first staff, in reading order. */
function frettedNotes(doc: ScoreDoc): RenderedFret[] {
  const out: RenderedFret[] = [];
  const staff = doc.tracks[0]?.staves[0];
  if (!staff) return out;

  staff.bars.forEach((bar, barIndex) => {
    bar.voices.forEach((voice, voiceIndex) => {
      voice.beats.forEach((beat, beatIndex) => {
        for (const written of beat.notes) {
          if (written.pitch.kind !== 'fretted') continue;
          out.push({
            bar: barIndex,
            voice: voiceIndex,
            beat: beatIndex,
            string: written.pitch.string,
            fret: written.pitch.fret,
            isTied: written.isTied
          });
        }
      });
    });
  });

  return out;
}

/** What the index says about a notehead, addressed from the document side. */
function idAt(index: NoteIndex, note: RenderedFret): string | undefined {
  return index.get(renderedNoteKey(note.bar, note.voice, note.beat, note.string));
}

/**
 * A click on the rendered side, shaped the way `detectionAt` reads one.
 *
 * `string` is alphaTab's - counted from the lowest - because that is what a
 * real `Note` carries. The tuning is only ever measured for its length.
 */
function clicked(
  bar: number,
  voice: number,
  beat: number,
  alphaTabString: number,
  strings = STANDARD_BASS_TUNING.length
): RenderedNote {
  return {
    string: alphaTabString,
    beat: {
      index: beat,
      voice: {
        index: voice,
        bar: { index: bar, staff: { tuning: new Array<number>(strings).fill(0) } }
      }
    }
  };
}

describe('the preview index', () => {
  /** A session whose middle note is too quiet to reach the score. */
  const quiet = (): TranscriptionSession =>
    session([note(43, 0.0), note(45, 1.0, 0.1), note(47, 2.0)]);

  it('resolves a ghost to the detection it was drawn for', () => {
    const input = quiet();
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);

    const ghosts = frettedNotes(doc).filter(entry => entry.voice === 1 && !entry.isTied);

    expect(ghosts.length).toBe(1);
    expect(idAt(index, ghosts[0])).toBe('45@1');
  });

  it('resolves a ghost that harmonic suppression removed', () => {
    // The direction the milestone is actually for: this note is not in
    // `session.notes` at all, so nothing but `suppressed` knows it exists.
    const kept = [note(43, 0.0), note(43, 1.0)];
    const partial = note(55, 0.0, 1, 'partial');
    const input = session(kept, [...kept, partial]);

    const { doc, index } = buildPreviewDoc(input, deriveScore(input), [partial]);
    const ghosts = frettedNotes(doc).filter(entry => entry.voice === 1 && !entry.isTied);

    expect(ghosts.length).toBe(1);
    expect(idAt(index, ghosts[0])).toBe('partial');
  });

  it('resolves a kept note too, so a decision can be reversed either way', () => {
    const input = quiet();
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);

    const kept = frettedNotes(doc).filter(entry => entry.voice === 0);

    expect(kept.map(entry => idAt(index, entry))).toEqual(['43@0', '47@2']);
  });

  it('resolves every fragment of a tie to the one note it spells', () => {
    // Struck a sixteenth into the bar and left ringing. Fifteen slots is a
    // span no single value writes, so `slotsToDurations` cuts it at the beat
    // and at the half bar: a dotted eighth tied to a quarter tied to a half.
    // Three noteheads, one detection - and a reader who clicks the held half
    // of a tie is pointing at the note they can see.
    const input = session([note(43, 0.125)]);
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);

    const fragments = frettedNotes(doc).filter(entry => entry.bar === 0);

    expect(fragments.map(entry => entry.isTied)).toEqual([false, true, true]);
    expect(fragments.map(entry => idAt(index, entry))).toEqual([
      '43@0.125',
      '43@0.125',
      '43@0.125'
    ]);
  });

  it('covers every rendered note and claims nothing else', () => {
    const input = quiet();
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);
    const rendered = frettedNotes(doc);

    // Both halves matter. Every notehead resolving says there are no gaps; the
    // size matching says the index is not also holding keys for notes that are
    // not on the page, which is how a stale entry would look.
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) expect(idAt(index, entry)).toBeDefined();
    expect(index.size).toBe(rendered.length);
  });

  it('indexes the kept notes even when there is nothing to ghost', () => {
    // The early return: no discards, so no second voice is added and the
    // document comes straight back. The index still has to describe voice 1.
    const input = session([note(43, 0.0), note(45, 1.0), note(47, 2.0)]);
    const derived = deriveScore(input);

    expect(derived.dropped).toEqual([]);

    const { doc, index } = buildPreviewDoc(input, derived, []);

    expect(doc.tracks[0].staves[0].bars.every(bar => bar.voices.length === 1)).toBe(true);
    expect(index.size).toBe(frettedNotes(doc).length);
    expect(index.size).toBe(3);
  });

  it('answers nothing for a rest, and for anything else it does not hold', () => {
    const input = quiet();
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);

    // Bar 0 beat 0 of the ghost voice is a rest: the discard is at 1.0 s.
    expect(doc.tracks[0].staves[0].bars[0].voices[1].beats[0].isRest).toBe(true);
    expect(detectionAt(index, clicked(0, 1, 0, 1))).toBeNull();

    // And a bar the score does not have.
    expect(detectionAt(index, clicked(99, 0, 0, 4))).toBeNull();
  });

  it('answers nothing for a note that is not on a string', () => {
    // alphaTab leaves `string` at -1 on a note that is not fretted, which
    // produces a key nothing holds rather than an exception or a wrong note.
    const input = quiet();
    const { index } = buildPreviewDoc(input, deriveScore(input), []);

    expect(detectionAt(index, clicked(0, 0, 0, -1))).toBeNull();
  });

  it('reads a click in alphaTab string numbering, not the tab convention', () => {
    const input = quiet();
    const { doc, index } = buildPreviewDoc(input, deriveScore(input), []);

    const first = frettedNotes(doc).filter(entry => entry.voice === 0)[0];
    const strings = doc.tracks[0].staves[0].tuning.length;
    const flipped = strings - first.string + 1;

    // Guards the test: on a four-string bass no string number is its own flip,
    // so an implementation that forgot to flip would have to answer wrongly
    // rather than accidentally right.
    expect(flipped).not.toBe(first.string);

    expect(detectionAt(index, clicked(first.bar, first.voice, first.beat, flipped)))
      .toBe(idAt(index, first) ?? null);
    expect(
      detectionAt(index, clicked(first.bar, first.voice, first.beat, first.string))
    ).not.toBe(idAt(index, first) ?? null);
  });

  it('refuses to guess when two notes claim one place on the page', () => {
    // Impossible from `quantizeBar`, which keeps one note per string per slot
    // - so this is what the index does if that ever stops being true. Silently
    // overwriting would leave a plausible index that answers a click with a
    // note the reader did not click, and an override applied to the wrong note
    // is worse than none.
    const input = quiet();
    const derived = deriveScore(input);
    const collision: DerivedScore = {
      ...derived,
      written: [
        {
          bar: 0,
          beat: 0,
          pitch: { kind: 'fretted', string: 1, fret: 0 },
          note: note(43, 0.0),
          isTied: false
        },
        {
          bar: 0,
          beat: 0,
          pitch: { kind: 'fretted', string: 1, fret: 0 },
          note: note(45, 0.0),
          isTied: false
        }
      ]
    };

    expect(() => buildPreviewDoc(input, collision, [])).toThrowError(
      /bar 0, voice 0, beat 0 writes two notes on string 1/
    );
  });

  it('accepts the same detection named twice in one place', () => {
    // Not a collision: it says one note is written there, which is what the
    // index would record anyway.
    const input = quiet();
    const derived = deriveScore(input);
    const twice: WrittenDetection = {
      bar: 0,
      beat: 0,
      pitch: { kind: 'fretted', string: 1, fret: 0 },
      note: note(43, 0.0),
      isTied: false
    };

    const { index } = buildPreviewDoc(input, { ...derived, written: [twice, twice] }, []);

    expect(index.get(renderedNoteKey(0, 0, 0, 1))).toBe('43@0');
  });
});

/**
 * The index against the model that actually gets clicked.
 *
 * Everything above addresses notes from the document side, where the key is
 * assembled from the same numbers that wrote it. The interesting failure is on
 * the other side: `ScoreDocMapperService` flips string numbers on the way into
 * alphaTab, so an index that spoke the wrong convention would pass every test
 * above and answer a real click with the wrong note - or, on a four-string
 * bass, with the note on the mirrored string.
 *
 * So this walks a rendered `alphaTab.model.Score` note by note and asks
 * `detectionAt` about each one, which is exactly what a click handler will do.
 */
describe('detectionAt over a rendered alphaTab score', () => {
  const mapper = new ScoreDocMapperService();

  /**
   * One bar carrying two kept notes and two ghosts, on four separate slots.
   *
   * Separate slots on purpose: a bar with two ghosts on one slot is a bar where
   * `addToChord` turns one of them away, and this group is about the mapping
   * rather than about what survives placement. The quiet note is a derivation
   * discard and the partial is a suppression one, so both routes into voice 2
   * are represented.
   */
  function rendered(): {
    doc: ScoreDoc;
    index: NoteIndex;
    score: alphaTab.model.Score;
  } {
    const kept = [note(43, 0.0), note(38, 1.0), note(45, 1.5, 0.1)];
    const partial = note(55, 0.5, 1, 'partial');
    const input = session(kept, [...kept, partial]);

    const { doc, index } = buildPreviewDoc(input, deriveScore(input), [partial]);
    return { doc, index, score: mapper.toScore(doc, new alphaTab.Settings()) };
  }

  it('gives every rendered note the answer the document gives', () => {
    const { doc, index, score } = rendered();
    const staff = score.tracks[0].staves[0];
    let checked = 0;
    let flipped = 0;

    doc.tracks[0].staves[0].bars.forEach((barDoc, barIndex) => {
      barDoc.voices.forEach((voiceDoc, voiceIndex) => {
        voiceDoc.beats.forEach((beatDoc, beatIndex) => {
          beatDoc.notes.forEach((noteDoc, noteIndex) => {
            if (noteDoc.pitch.kind !== 'fretted') return;

            const drawn = staff.bars[barIndex].voices[voiceIndex].beats[beatIndex]
              .notes[noteIndex];

            // The two numberings really are different here, so a missing flip
            // could not pass by coincidence.
            if (drawn.string !== noteDoc.pitch.string) flipped++;

            expect(detectionAt(index, drawn)).toBe(
              index.get(
                renderedNoteKey(barIndex, voiceIndex, beatIndex, noteDoc.pitch.string)
              ) ?? null
            );
            checked++;
          });
        });
      });
    });

    expect(checked).toBeGreaterThan(0);
    expect(flipped).toBe(checked);
  });

  it('names the ghost and the kept note a reader would click', () => {
    const { index, score } = rendered();
    const bars = score.tracks[0].staves[0].bars;

    const struck = (voice: number): alphaTab.model.Note[] =>
      bars.flatMap(bar =>
        bar.voices[voice].beats.flatMap(beat =>
          beat.notes.filter(drawn => !drawn.isTieDestination)
        )
      );

    // Voice 2 is the discards: the quiet note and the suppressed partial.
    expect(struck(1).map(drawn => detectionAt(index, drawn)).sort()).toEqual([
      '45@1.5',
      'partial'
    ]);
    // Voice 1 is what the score kept.
    expect(struck(0).map(drawn => detectionAt(index, drawn))).toEqual(['43@0', '38@1']);
  });

  it('answers nothing for a rest, which has no note to click', () => {
    const { index, score } = rendered();
    const rest = score.tracks[0].staves[0].bars[0].voices[1].beats[0];

    expect(rest.notes.length).toBe(0);
    expect(detectionAt(index, clicked(0, 1, 0, 1))).toBeNull();
  });
});

/**
 * The uniqueness the index rests on, over every capture the accuracy work has.
 *
 * `indexVoice` throws rather than overwrite, so a bar that writes two notes on
 * one string in one beat takes the whole preview down. That is the right
 * failure - the document would be malformed too - but only if it cannot happen,
 * and "cannot" is a claim about `addToChord` over real detector output rather
 * than over three hand-written notes.
 *
 * Swept across the confidence floor for the reason the conservation law above
 * is: a high floor collapses the score and `buildPreviewDoc` clamps every ghost
 * from the vanished bars into the last surviving one, which is where collisions
 * are certain. `addToChord` turns those away into `omitted` before they are
 * ever written, so the index still sees one note per string per beat - and each
 * ghost that *is* drawn still answers with its own detection rather than a
 * neighbour's.
 */
describe('the preview index over every captured material', () => {
  const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

  function pipeline(name: string, confidenceFloor: number): {
    doc: ScoreDoc;
    index: NoteIndex;
  } {
    const detections = detectionsOf(name);
    const suppressed: DetectedNote[] = [];
    const notes = suppressHarmonics(detections, {}, NO_NOTE_DECISIONS, false, suppressed);
    const durationSec =
      Math.ceil(Math.max(...detections.map(entry => entry.offsetSec))) + 1;
    const tracked = trackBeats(notes, durationSec, FOUR_FOUR);

    const input: TranscriptionSession = {
      id: 's1',
      sourceName: `${name}.wav`,
      durationSec,
      notes,
      rawNotes: detections,
      bendFrameRateHz: 86.13,
      grid: tracked,
      trackedGrid: tracked,
      beatsPerPulse: 1,
      harmonics: DEFAULT_HARMONIC_OPTIONS,
      monophonic: null,
      decisions: NO_NOTE_DECISIONS,
      settings: { ...createDefaultDerivationSettings(), confidenceFloor }
    };

    return buildPreviewDoc(input, deriveScore(input), suppressed);
  }

  for (const name of Object.keys(DETECTIONS)) {
    it(`indexes every note of ${name} exactly once`, () => {
      for (const floor of [0.2, 0.5, 0.9]) {
        // The uniqueness assertion itself: `buildPreviewDoc` throws if two
        // notes claim one key.
        const { doc, index } = pipeline(name, floor);
        const drawn = frettedNotes(doc);

        for (const entry of drawn) {
          expect(idAt(index, entry))
            .withContext(`${name} at floor ${floor}, ${JSON.stringify(entry)}`)
            .toBeDefined();
        }

        expect(index.size)
          .withContext(`${name} at floor ${floor}`)
          .toBe(drawn.length);

        // One detection per struck notehead, over both voices. Ties share an
        // id across fragments, so only the heads are counted; anything else
        // would mean two noteheads were drawn for one detection, or one
        // detection answered for two.
        const heads = drawn.filter(entry => !entry.isTied);
        expect(new Set(heads.map(entry => idAt(index, entry))).size)
          .withContext(`${name} at floor ${floor}`)
          .toBe(heads.length);
      }
    });
  }

  it('keeps each piled ghost distinct when a high floor collapses the score', () => {
    // The clamp: at 0.9 nothing on `walking` clears the floor, the derived
    // score is one bar, and all twenty-eight candidates are held in it. Twelve
    // land on a string already spoken for and never reach the page; the
    // sixteen that do each keep their own detection.
    const { doc, index } = pipeline('walking', 0.9);
    const ghosts = frettedNotes(doc).filter(entry => entry.voice === 1);

    expect(doc.masterBars.length).toBe(1);
    expect(ghosts.every(entry => entry.bar === 0)).toBe(true);

    const heads = ghosts.filter(entry => !entry.isTied);
    expect(heads.length).toBe(16);
    expect(new Set(heads.map(entry => idAt(index, entry))).size).toBe(16);
  });
});
