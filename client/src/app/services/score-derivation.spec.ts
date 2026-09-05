import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';
import {
  BeatGrid,
  DetectedNote,
  STANDARD_BASS_TUNING,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { ComposerService } from './composer.service';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { candidatesFor } from './transcription-fingering';
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
  timeSignature: { numerator: 4, denominator: 4, isCommon: true }
};

function session(
  notes: DetectedNote[],
  grid: BeatGrid = GRID,
  durationSec = 4
): TranscriptionSession {
  return {
    id: 's1',
    sourceName: 'bassline.wav',
    durationSec,
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
    //
    // The source has to be long enough to hold that note - fourteen seconds -
    // or the duration cap below is the thing being measured rather than the
    // extrapolation. At the four seconds the other cases use, an onset at 13.5
    // is one the audio never contained.
    expect(deriveScore(session([note(33, 0), note(35, 13.5)], GRID, 14)).masterBars.length)
      .toBe(7);
  });

  // -------------------------------------------------------------------------
  // The bar count, bounded by the source rather than by the last onset.
  // -------------------------------------------------------------------------

  it('caps the bar count at what the source duration can hold', () => {
    // 0.01 s between beats, and an onset ten seconds into a clip a tenth of a
    // second long. `secondsToBeats` extrapolates without limit, so that onset
    // used to land in bar 251 and take 251 MasterBarDocs, 251 bars of rests
    // and 251 passes over the placed notes with it - from two notes. The same
    // grid at 1e-6 s asked for 2,500,001 bars and two and a half seconds.
    const fast: BeatGrid = {
      beatsSec: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07],
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    };

    const input = session([note(33, 0), note(35, 10)], fast, 0.1);
    const score = deriveScore(input);

    // Ten beats of audio, so three bars, plus the one a note rounding forward
    // off the end needs.
    expect(score.masterBars.length).toBe(4);
    expect(score.tracks[0].staves[0].bars.length).toBe(4);

    // Held rather than dropped: the stray onset is clamped into the last bar,
    // so both notes are still struck somewhere a reader can see them.
    expect(struckPerBar(input).flat().length).toBe(2);
  });

  it('leaves an ordinary session\'s bar count alone', () => {
    // Four bars of material inside an eight-second source: nothing here is
    // anywhere near the cap, so the cap changes nothing.
    const eightSeconds: BeatGrid = {
      beatsSec: Array.from({ length: 16 }, (_, index) => index * 0.5),
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    };

    const notes = [note(33, 0), note(35, 2), note(38, 4), note(40, 6)];

    expect(deriveScore(session(notes, eightSeconds, 8)).masterBars.length).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Degenerate input. Every one of these has to come back structurally valid,
  // because the alternative is a ScoreDoc the composer cannot open.
  // -------------------------------------------------------------------------

  it('produces a structurally valid score from a degenerate session', () => {
    const oneBeat: BeatGrid = { ...GRID, beatsSec: [0.4] };
    const noBeats: BeatGrid = { ...GRID, beatsSec: [] };

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

  // -------------------------------------------------------------------------
  // Note conservation, end to end.
  //
  // `transcription-quantize.spec.ts` has had a conservation property test
  // since the module was written, and it did not catch this: it stops at
  // `quantizeBar`, so it takes the fingering it is handed as given. The defect
  // lived in the gap between two modules, each internally consistent -
  // `transcription-fingering.ts` decided in seconds what to move onto distinct
  // strings, `transcription-quantize.ts` decided in beats what to merge into
  // one chord, and quantize merged the wider window. Between the two, a note
  // was deleted with no rest, no error and no record: at default settings any
  // separation from 35 to 125 ms at 60 BPM, 35 to 80 at 90, 35 to 60 at 120,
  // the band moving with the tempo precisely because the two windows were in
  // different units.
  //
  // A property over the whole assembly is the only shape of test that could
  // have seen it, which is why the sweep is here rather than in either module.
  // -------------------------------------------------------------------------

  /** Four-four at `bpm`, sixteen beats long. */
  function gridAtTempo(bpm: number): BeatGrid {
    const spacing = 60 / bpm;
    return {
      beatsSec: Array.from({ length: 16 }, (_, index) => index * spacing),
      timeSignature: { numerator: 4, denominator: 4, isCommon: true }
    };
  }

  /**
   * Every pitch actually struck in the derived score, read back off the tab.
   *
   * Read back rather than trusted: a string number and a fret are what the
   * score really says, so recovering the pitch from them is the same arithmetic
   * a reader does, and it fails if the fingering is wrong as well as if the
   * note is missing.
   */
  function soundedPitches(input: TranscriptionSession): number[] {
    const staff = deriveScore(input).tracks[0].staves[0];

    return staff.bars.flatMap(bar =>
      bar.voices[0].beats
        .filter(beat => !beat.isRest)
        .flatMap(beat => beat.notes)
        // Tie continuations are the same attack written again, not a note.
        .filter(entry => !entry.isTied)
        .map(entry =>
          entry.pitch.kind === 'fretted'
            ? staff.tuning[entry.pitch.string - 1] + entry.pitch.fret + staff.capo
            : NaN
        )
    );
  }

  const SETTINGS_MAX_FRET = createDefaultDerivationSettings().maxFret;

  /**
   * Whether the instrument can sound both pitches at once.
   *
   * A tab line holds one number, so two notes struck together need candidates
   * on two different strings. Taken from `candidatesFor` rather than restated
   * as a fixture, because it is the whole content of the word "genuinely" in
   * the property below - a note may go missing only when the instrument cannot
   * play it, and nothing else counts as an excuse.
   */
  function playableTogether(low: number, high: number): boolean {
    const options = candidatesFor(low, STANDARD_BASS_TUNING, 0, SETTINGS_MAX_FRET);
    const others = candidatesFor(high, STANDARD_BASS_TUNING, 0, SETTINGS_MAX_FRET);
    return options.some(one => others.some(other => one.string !== other.string));
  }

  /**
   * The first onset sits on the downbeat, and that is a real restriction on
   * what this sweep covers rather than a convenience.
   *
   * Two onsets more than half a slot apart are two clusters, and two clusters
   * can still round onto one slot - `snapToSlots` says so itself. When they do,
   * `addToChord` drops the second, and no attack window can prevent it: the
   * pair is two attacks the grid has nowhere to put, which is a statement about
   * `finestDivision` and not about units. Off a slot boundary that is reachable
   * - at 120 BPM a pair starting 65 ms in and 65 to 120 ms apart loses a note -
   * and it is recorded as a known limitation rather than fixed here. Anchoring
   * the first onset on a slot removes exactly that case and leaves the merge
   * window, which is the thing under test.
   */
  it('keeps both notes of a playable pair however far apart the onsets are', () => {
    // Each pair has a two-string fingering, checked below rather than asserted
    // here. A1/C2 is the pair the original report was measured on.
    const pairs: [number, number][] = [[33, 36], [43, 63], [32, 44], [40, 52], [33, 45]];
    const lost: string[] = [];

    for (const bpm of [60, 90, 120, 160]) {
      const grid = gridAtTempo(bpm);
      const durationSec = 16 * (60 / bpm);

      for (const [low, high] of pairs) {
        expect(playableTogether(low, high)).toBe(true);

        // Every 5 ms across the range a detector actually reports. Basic Pitch
        // emits onsets on 5.8 ms frames, so M2 walks the whole of this band.
        for (let ms = 0; ms <= 200; ms += 5) {
          const input = session(
            [note(low, 0), note(high, ms / 1000)],
            grid,
            durationSec
          );
          const sounded = soundedPitches(input);

          if (!sounded.includes(low) || !sounded.includes(high)) {
            lost.push(`${low}+${high} at ${bpm} BPM, ${ms} ms apart -> [${sounded}]`);
          }
        }
      }
    }

    // Listed rather than counted, so a failure names the band it lost.
    expect(lost).toEqual([]);
  });

  /**
   * The other half of the property, and the reason it says "playable" rather
   * than "every". A minor second at the bottom of a bass lives on the E string
   * at both ends, so struck together one of the two cannot be written at all -
   * which is what a player would tell you about that interval on that
   * instrument, and not a defect this milestone can fix.
   *
   * Making the exception explicit is what stops the sweep above from quietly
   * degrading into "notes usually survive".
   */
  it('loses a note only where the instrument has no two-string fingering', () => {
    expect(playableTogether(28, 30)).toBe(false);

    // Struck together: one E string, one number, one survivor.
    expect(soundedPitches(session([note(28, 0), note(30, 0.01)]))).toEqual([28]);

    // Far enough apart to be two attacks and the same pair comes through
    // whole, which is why the sweep above has to be a sweep.
    expect(soundedPitches(session([note(28, 0), note(30, 0.5)]))).toEqual([28, 30]);
  });
});
