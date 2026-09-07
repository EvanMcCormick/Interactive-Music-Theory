import { BarDoc } from '../../models/composer.model';
import {
  DetectedNote,
  TranscriptionSession,
  createDefaultDerivationSettings
} from '../../models/transcription.model';
import { trackBeats } from '../beat-tracking';
import { deriveScore, isBassTuning } from '../score-derivation';
import {
  DEFAULT_HARMONIC_OPTIONS,
  NO_NOTE_DECISIONS,
  suppressHarmonics
} from '../transcription-harmonics';
import { DEFAULT_TIME_SIGNATURE } from '../transcription.service';
import { REAL_DURATION_SEC, realDetections } from './real-detections.fixture';
import { SERVER_DURATION_SEC, serverDetections } from './server-detections.fixture';

/* eslint-disable no-console */

/**
 * **The acceptance criterion for the two-tier design.**
 *
 * The same recording through both tiers, and the question is whether a listener
 * could tell. Not whether the floats match — the design says at length that they
 * will not and should not be expected to:
 *
 * > It will not reproduce them exactly, and the design says so rather than
 * > discovering it… Bit-equality is the wrong assertion. Musical equivalence is
 * > the right one.
 *
 * Four independent things differ before a single note is decided. Different MP3
 * decoders, so the samples differ. Different resamplers, so they differ again.
 * Different inference runtimes — TF.js on WebGL against ONNX Runtime on CPU,
 * measured 4.5e-7 apart on the model itself. And TF.js is not bit-reproducible
 * between its own runs near the 0.3 frame threshold, which is how a fixture's
 * 86 same-attack pairs came back as 89 from a live session.
 *
 * Measured when these fixtures were captured:
 *
 * | | samples | duration | detections |
 * |---|---|---|---|
 * | browser | 5,789,696 | 262.5712 s | 1,224 |
 * | server | 5,789,952 | 262.5829 s | 1,219 |
 *
 * 256 samples is one FFT hop. Five detections is 0.4 %.
 *
 * The design names three levels, and the third is the one that matters: **the
 * derived score is what a user can perceive**, and if two runtimes disagree
 * about a detection at confidence 0.301 and the score is unchanged, nothing
 * happened.
 *
 * **The first two levels pass and the third does not.** The detections agree to
 * 0.41 %, the pitches and the pulse agree — and the derived scores write the
 * same bar 27.5 % of the time. The design predicted identical. See the third
 * test for the measurement that splits the cause in half, and
 * `docs/plans/2026-09-07-csharp-decoder-port.md` for what it means.
 */
describe('two-tier equivalence on the real stem', () => {
  /**
   * The session `TranscriptionService.transcribe` builds, step for step.
   *
   * `grid` is overridable so that one experiment below can hold the beat grid
   * constant and vary only the notes, which is the only way to tell a
   * disagreement about *notes* from a disagreement about *where the bar lines
   * are*.
   */
  function sessionFor(
    notes: DetectedNote[],
    durationSec: number,
    grid?: TranscriptionSession['grid']
  ): TranscriptionSession {
    const settings = createDefaultDerivationSettings();

    const suppressed = suppressHarmonics(
      notes,
      {},
      NO_NOTE_DECISIONS,
      isBassTuning(settings.tuning)
    );

    const tracked = grid ?? trackBeats(suppressed, durationSec, DEFAULT_TIME_SIGNATURE);

    return {
      id: 'equivalence',
      sourceName: 'johnny-bass.mp3',
      durationSec,
      notes: suppressed,
      rawNotes: [...notes],
      bendFrameRateHz: 86.1328125,
      grid: tracked,
      trackedGrid: tracked,
      beatsPerPulse: 1,
      harmonics: DEFAULT_HARMONIC_OPTIONS,
      monophonic: null,
      decisions: NO_NOTE_DECISIONS,
      settings
    };
  }

  const browser = sessionFor(realDetections(), REAL_DURATION_SEC);
  const server = sessionFor(serverDetections(), SERVER_DURATION_SEC);

  const browserScore = deriveScore(browser);
  const serverScore = deriveScore(server);

  const browserBars = browserScore.doc.tracks[0].staves[0].bars;
  const serverBars = serverScore.doc.tracks[0].staves[0].bars;

  /** Level 2: the counts agree within a small tolerance. */
  it('detects the same number of notes to within a fraction of a percent', () => {
    const ratio =
      Math.abs(browser.rawNotes.length - server.rawNotes.length) / browser.rawNotes.length;

    console.log(
      `raw detections: browser ${browser.rawNotes.length}, server ${server.rawNotes.length} ` +
        `(${(ratio * 100).toFixed(2)}% apart)`
    );

    expect(ratio).toBeLessThan(0.02);
  });

  it('survives harmonic suppression on both sides in step', () => {
    const ratio = Math.abs(browser.notes.length - server.notes.length) / browser.notes.length;

    console.log(
      `after suppression: browser ${browser.notes.length}, server ${server.notes.length} ` +
        `(${(ratio * 100).toFixed(2)}% apart)`
    );

    // Suppression is where a small difference could be amplified: it decides on
    // ratios between neighbouring notes, so one missing partial can change the
    // verdict on its neighbour.
    expect(ratio).toBeLessThan(0.04);
  });

  /**
   * Level 1: every pitch one tier hears, the other hears too.
   *
   * Per pitch rather than per note, because the counts differ. A tier that lost
   * a whole note of the line shows up here and nowhere else — a single missing
   * note barely moves a count.
   */
  it('hears the same pitches', () => {
    const pitches = (session: TranscriptionSession): number[] =>
      [...new Set(session.notes.map(n => n.pitch))].sort((a, b) => a - b);

    const browserPitches = pitches(browser);
    const serverPitches = pitches(server);

    console.log(`browser pitches ${browserPitches.join(' ')}`);
    console.log(`server  pitches ${serverPitches.join(' ')}`);

    // The stem is a bass tuned a half step down: MIDI 27, 32, 37 and 42 are the
    // open strings, and the fixture records that nothing below 27 is reported.
    expect(Math.min(...serverPitches)).toBe(Math.min(...browserPitches));

    const common = browserPitches.filter(p => serverPitches.includes(p));
    expect(common.length / browserPitches.length).toBeGreaterThan(0.85);
  });

  it('tracks the same pulse', () => {
    const bpm = (session: TranscriptionSession): number => {
      const beats = session.grid.beatsSec;
      return (60 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0]);
    };

    console.log(
      `tempo: browser ${bpm(browser).toFixed(2)} BPM over ${browser.grid.beatsSec.length} beats, ` +
        `server ${bpm(server).toFixed(2)} BPM over ${server.grid.beatsSec.length} beats`
    );

    // The stem is 153 BPM. Both tiers have to find the same pulse: every bar
    // line hangs off it, so a tempo that differed would make the comparison
    // below meaningless rather than merely failing.
    expect(bpm(server)).toBeCloseTo(bpm(browser), 0);
  });

  /**
   * **Level 3, and the only one a user can perceive.**
   *
   * Everything above is a property of the detections. This is a property of the
   * score.
   */
  it('derives a score of very nearly the same length', () => {
    console.log(`bars: browser ${browserBars.length}, server ${serverBars.length}`);
    console.log(
      `dropped: browser ${browserScore.dropped.length}, server ${serverScore.dropped.length}`
    );

    // One bar in a hundred and nine, which is the two extra tracked beats
    // arriving as an extra bar rather than as anything musical.
    expect(Math.abs(serverBars.length - browserBars.length)).toBeLessThanOrEqual(1);
  });

  /**
   * **The design's acceptance criterion, and it is not met.**
   *
   * The design says the third level is "the derived `ScoreDoc` is identical" and
   * calls it "the only level a user can perceive". Measured on the real stem, it
   * is not identical and is not close to it:
   *
   * | | bars written the same |
   * |---|---|
   * | each tier tracking its own grid | **27.5 %** (30/109) |
   * | both on the browser's grid | **63.3 %** (69/109) |
   *
   * Those two numbers split the cause roughly in half, which is the useful part
   * of the result.
   *
   * **Half is beat tracking.** Two extra beats in 438 shift every bar after
   * them, and a bar-by-bar comparison counts one displaced grid as a hundred
   * failures. `trackBeats` runs client-side in *both* tiers, so this is not a
   * property of the port at all — it is the tracker being sensitive to which
   * notes it is given.
   *
   * **Half is harmonic suppression amplifying a small difference.** The two
   * tiers disagree about 5 detections in 1,224 — 0.41 % — and after suppression
   * they disagree about 13 notes in ~930, which is 1.4 %. Suppression removed
   * 303 notes on one side and 285 on the other: an 18-note difference in
   * decisions out of a 5-note difference in input. It decides on *ratios between
   * neighbouring notes*, so a confidence that moves in the last few percent can
   * flip the verdict on a note that itself did not change.
   *
   * Neither is a defect in the C# port, and neither is fixed by making the port
   * more faithful — the ONNX weights already agree with TF.js to 4.5e-7. Both
   * are consequences of a pipeline with threshold decisions in it being fed
   * audio that two different decoders produced. What that means for the design
   * is written up in `docs/plans/2026-09-07-csharp-decoder-port.md`.
   *
   * The assertions below are regression guards at the measured values, not
   * targets. They exist so that this getting *worse* is noticed; they are not
   * evidence that it is good enough.
   */
  it('measures how far the two tiers derived scores diverge', () => {
    const shared = sessionFor(serverDetections(), SERVER_DURATION_SEC, browser.grid);
    const sharedBars = deriveScore(shared).doc.tracks[0].staves[0].bars;

    const own = agreementBetween(browserBars, serverBars, 'each tier tracking its own grid');
    const held = agreementBetween(browserBars, sharedBars, 'both on the browser grid');

    // Measured 27.5 % and 63.3 %.
    expect(own).toBeGreaterThan(0.2);
    expect(held).toBeGreaterThan(0.55);

    // The split itself: holding the grid constant recovers about 36 points, so
    // beat tracking is about half the story and note-level disagreement is the
    // other half. If this gap closes, the diagnosis above has changed and the
    // docblock is stale.
    expect(held).toBeGreaterThan(own + 0.25);
  });

  function agreementBetween(left: BarDoc[], right: BarDoc[], label: string): number {
    let identical = 0;
    const differences: string[] = [];

    for (let bar = 0; bar < Math.min(left.length, right.length); bar++) {
      const a = pitchesIn(left[bar]);
      const b = pitchesIn(right[bar]);

      if (a === b) {
        identical++;
      } else if (differences.length < 4) {
        differences.push(`bar ${bar + 1}:\n      browser ${a}\n      server  ${b}`);
      }
    }

    const agreement = identical / left.length;
    console.log(
      `bars identical, ${label}: ${identical}/${left.length} ` +
        `(${(agreement * 100).toFixed(1)}%)`
    );
    for (const line of differences) {
      console.log(`    ${line}`);
    }

    return agreement;
  }

  /** Every pitch written into a bar, in order, as a comparable string. */
  function pitchesIn(bar: BarDoc): string {
    return bar.voices
      .flatMap(voice =>
        voice.beats.flatMap(beat =>
          beat.isRest
            ? []
            : beat.notes.map(note =>
                note.pitch.kind === 'fretted'
                  ? `s${note.pitch.string}f${note.pitch.fret}`
                  : `p${note.pitch.noteValue}o${note.pitch.octave}`
              )
        )
      )
      .join(' ');
  }
});
