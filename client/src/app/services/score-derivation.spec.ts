import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';
import {
  BeatGrid,
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { beatSlots } from './transcription-quantize';
import { deriveScore } from './score-derivation';

const note = (pitch: number, onsetSec: number, confidence = 1): DetectedNote => ({
  id: `${pitch}@${onsetSec}`,
  pitch,
  onsetSec,
  offsetSec: onsetSec + 0.4,
  confidence,
  bendCents: []
});

/** Eight beats at 120 BPM: two bars of 4/4. */
const GRID: BeatGrid = {
  beatsSec: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  downbeatIndices: [0, 4],
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

function session(notes: DetectedNote[], grid: BeatGrid = GRID): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec: 4,
    notes,
    grid,
    settings: createDefaultDerivationSettings()
  };
}

/**
 * The fingerings actually struck, bar by bar.
 *
 * Struck rather than merely non-rest: a span no single note value can express
 * is spelled as several `BeatDoc`s for one onset, and every fragment after the
 * first is a tie continuation rather than a second attack.
 */
function struckPerBar(input: TranscriptionSession): ([number, number] | null)[][] {
  return deriveScore(input).tracks[0].staves[0].bars.map(bar =>
    bar.voices[0].beats
      .filter(beat => !beat.isRest && !beat.notes[0].isTied)
      .map(beat =>
        beat.notes[0].pitch.kind === 'fretted'
          ? ([beat.notes[0].pitch.string, beat.notes[0].pitch.fret] as [number, number])
          : null
      )
  );
}

describe('deriveScore', () => {
  it('writes one bar per four beats of material', () => {
    const score = deriveScore(session([note(33, 0), note(35, 2.0)]));

    expect(score.masterBars.length).toBe(2);
  });

  it('keeps staff bars parallel to master bars', () => {
    const score = deriveScore(session([note(33, 0), note(35, 2.0)]));
    const staff = score.tracks[0].staves[0];

    expect(staff.bars.length).toBe(score.masterBars.length);
  });

  it('fills every bar exactly', () => {
    const score = deriveScore(session([note(33, 0), note(35, 0.75), note(40, 2.2)]));
    const staff = score.tracks[0].staves[0];

    for (const bar of staff.bars) {
      expect(beatSlots(bar.voices[0].beats, 16)).toBe(16);
    }
  });

  it('leaves out notes below the confidence floor', () => {
    const score = deriveScore(session([note(33, 0), note(35, 1.0, 0.05)]));
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;

    // Struck attacks, not non-rest beats. The surviving note holds the whole
    // bar, which `quantizeBar` spells as one whole note today - but how a span
    // is spelled is its business, not this test's, and it has already changed
    // once: the same bar used to come back as a half tied to a half, two
    // non-rest beats for one attack. Counting non-rest beats would have
    // reported 2 there whatever the floor did.
    expect(beats.filter(beat => !beat.isRest && !beat.notes[0].isTied).length).toBe(1);
  });

  it('reads the tempo off the beat grid', () => {
    expect(deriveScore(session([note(33, 0)])).tempo).toBe(120);
  });

  it('produces a tab staff tuned as configured', () => {
    const staff = deriveScore(session([note(33, 0)])).tracks[0].staves[0];

    expect(staff.showTablature).toBe(true);
    expect(staff.tuning).toEqual([43, 38, 33, 28]);
  });

  it('names the score after its source', () => {
    expect(deriveScore(session([note(33, 0)])).title).toBe('bassline.wav');
  });

  it('produces a valid empty score when nothing was detected', () => {
    const score = deriveScore(session([]));
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;

    expect(score.masterBars.length).toBe(1);
    expect(beats.every(beat => beat.isRest)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The hand-off to the composer.
  //
  // deriveScore is only worth anything if what it returns loads unchanged, so
  // the round trip is exercised rather than reasoned about. String numbers are
  // where an off-by-one hides: ScoreDocMapperService.flipString counts strings
  // from the other end, so a wrong convention here does not mislabel a note,
  // it sounds a different pitch.
  // -------------------------------------------------------------------------

  it('survives the round trip into alphaTab with every pitch intact', () => {
    TestBed.configureTestingModule({});
    const mapper = TestBed.inject(ScoreDocMapperService);

    const doc = deriveScore(session([note(33, 0), note(45, 1.0), note(52, 2.0)]));
    const score = mapper.toScore(doc, new alphaTab.Settings());

    const sounded = score.tracks[0].staves[0].bars.flatMap(bar =>
      bar.voices.flatMap(voice =>
        voice.beats.flatMap(beat =>
          beat.notes.filter(entry => !entry.isTieDestination).map(entry => entry.realValue)
        )
      )
    );

    expect(sounded).toEqual([33, 45, 52]);
    expect(score.tracks[0].staves[0].bars[0].clef).toBe(alphaTab.model.Clef.F4);

    // Every string number inside the tuning, counted the way a ScoreDoc counts.
    const staff = doc.tracks[0].staves[0];
    for (const bar of staff.bars) {
      for (const beat of bar.voices[0].beats) {
        for (const entry of beat.notes) {
          expect(entry.pitch.kind).toBe('fretted');
          if (entry.pitch.kind === 'fretted') {
            expect(entry.pitch.string).toBeGreaterThanOrEqual(1);
            expect(entry.pitch.string).toBeLessThanOrEqual(staff.tuning.length);
          }
        }
      }
    }
  });

  it('loads into the composer without repair', () => {
    TestBed.configureTestingModule({});
    const composer = TestBed.inject(ComposerService);

    const doc = deriveScore(session([note(33, 0), note(45, 2.2)]));
    composer.replaceDocument(doc);

    // ComposerService's standing invariant: every staff has exactly one bar
    // per master bar, and the caret can be placed in any of them.
    expect(composer.doc.masterBars.length).toBeGreaterThan(0);
    expect(composer.doc.tracks[0].staves[0].bars.length).toBe(doc.masterBars.length);
  });

  // -------------------------------------------------------------------------
  // Bar assignment, which scope decision 6 makes from the rounded slot.
  // -------------------------------------------------------------------------

  it('carries a note in the final half-slot onto the next downbeat', () => {
    // A sixteenth slot is a quarter of a beat, so the last half-slot of a 4/4
    // bar opens at beat 3.875 - 1.9375s on this grid. Below it the note stays
    // on the bar's final slot; at it the note belongs to the next downbeat
    // rather than being clamped back onto a slot it has already passed.
    expect(struckPerBar(session([note(33, 0), note(35, 3.8 * 0.5)])).length).toBe(1);

    const carried = struckPerBar(session([note(33, 0), note(35, 3.875 * 0.5)]));
    expect(carried.length).toBe(2);
    expect(carried[1].length).toBe(1);
  });

  it('puts a note exactly on the bar line at the head of the next bar', () => {
    const onTheLine = struckPerBar(session([note(33, 0), note(35, 2.0)]));

    expect(onTheLine.length).toBe(2);
    expect(onTheLine[0].length).toBe(1);
    expect(onTheLine[1].length).toBe(1);
  });

  it('never writes a trailing empty bar', () => {
    // Bar count comes off the last note, so the final bar always sounds -
    // including when rounding has pushed that note onto a bar of its own.
    for (const onset of [1.9, 3.5, 3.75, 3.99]) {
      const bars = struckPerBar(session([note(33, 0), note(35, onset)]));
      expect(bars[bars.length - 1].length).toBeGreaterThan(0);
    }
  });

  it('extends the score proportionately for a note past the tracked grid', () => {
    // The grid ends at 3.5s. A note ten seconds later extrapolates by the
    // final interval, which secondsToBeats clamps to twice the median, so the
    // bar count stays proportionate instead of running away.
    expect(deriveScore(session([note(33, 0), note(35, 13.5)])).masterBars.length).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Degenerate input. Every one of these has to come back structurally valid,
  // because the alternative is a ScoreDoc the composer cannot open.
  // -------------------------------------------------------------------------

  it('produces a structurally valid score from a degenerate session', () => {
    const oneBeat: BeatGrid = { ...GRID, beatsSec: [0.4], downbeatIndices: [0] };
    const noBeats: BeatGrid = { ...GRID, beatsSec: [], downbeatIndices: [] };

    const cases: TranscriptionSession[] = [
      session([]),
      session([note(33, 0, 0.01), note(35, 1, 0.02)]),
      {
        // Nothing playable: a one-string instrument five frets long.
        ...session([note(100, 0), note(101, 1)]),
        settings: { ...createDefaultDerivationSettings(), tuning: [28], maxFret: 5 }
      },
      session([note(33, 0), note(45, 2)], oneBeat),
      session([note(33, 0)], noBeats)
    ];

    for (const input of cases) {
      const score = deriveScore(input);
      const staff = score.tracks[0].staves[0];

      expect(score.masterBars.length).toBeGreaterThan(0);
      expect(staff.bars.length).toBe(score.masterBars.length);
      for (const bar of staff.bars) {
        expect(bar.voices.length).toBeGreaterThan(0);
        expect(bar.voices[0].beats.length).toBeGreaterThan(0);
        expect(beatSlots(bar.voices[0].beats, 16)).toBe(16);
      }
    }
  });

  /**
   * `Math.max(0, NaN)` is NaN, so the clamp that pulls a pickup onto beat 1
   * does not stop one: the note takes a NaN bar, matches no bar, and drags
   * `barCount` to NaN - which `Array.from` reads as zero. The result was a
   * ScoreDoc with no bars at all, and `ComposerService.replaceDocument` threw
   * inside `clampCursor` reading `voices` off an absent bar. It also put the
   * note beyond reach of `quantizeBar`'s own NaN guard, which never saw it.
   */
  it('rejects an onset that is not a time in seconds', () => {
    for (const onset of [NaN, Infinity, -Infinity]) {
      expect(() => deriveScore(session([note(33, onset)])))
        .toThrowError(/not a time in seconds/);
    }
  });

  // -------------------------------------------------------------------------
  // Pipeline order.
  // -------------------------------------------------------------------------

  it('carries the hand position across the bar line', () => {
    // 52 and 54 at the end of bar 1, then 45 on the downbeat of bar 2, an
    // eighth apart at 120. Fingered as one sequence the hand stays put and
    // takes fret 12 on the A string. Fingered bar by bar, bar 2 would start
    // fresh and take fret 2 on the G string - which the slow case below shows
    // is exactly what it picks when nothing is holding it in position.
    expect(struckPerBar(session([note(52, 1.75), note(54, 1.875), note(45, 2.0)])))
      .toEqual([[[1, 9], [1, 11]], [[3, 12]]]);

    expect(struckPerBar(session([note(52, 0), note(54, 1.0), note(45, 2.0)])))
      .toEqual([[[1, 9], [1, 11]], [[1, 2]]]);
  });

  it('fingers the notes in onset order however the session lists them', () => {
    // assignFingering documents ascending onsets as a precondition, and
    // separateSimultaneous clusters attacks on the same assumption, so the
    // sort has to happen before either of them sees the sequence.
    const shuffled = session([note(52, 2.0), note(33, 0), note(45, 1.0)]);
    const ordered = session([note(33, 0), note(45, 1.0), note(52, 2.0)]);

    expect(struckPerBar(shuffled)).toEqual(struckPerBar(ordered));
    expect(struckPerBar(shuffled)).toEqual([[[3, 0], [2, 7]], [[1, 9]]]);
  });
});
