import { TimeSignature } from '../models/composer.model';
import { DetectedNote } from '../models/transcription.model';
import { DEFAULT_BEAT_OPTIONS, estimateTempo, onsetSignal, trackBeats } from './beat-tracking';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };

/** `count` notes, one every `intervalSec`, all equally strong. */
function pulse(count: number, intervalSec: number, startSec = 0): DetectedNote[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    pitch: 33,
    onsetSec: startSec + i * intervalSec,
    offsetSec: startSec + i * intervalSec + intervalSec * 0.8,
    confidence: 0.8,
    bendCents: []
  }));
}

/** Notes at the given times, each as loud as `confidence` says. */
function notesAt(onsets: number[], confidence: (index: number) => number = () => 0.8): DetectedNote[] {
  return onsets.map((onsetSec, i) => ({
    id: `n${i}`,
    pitch: 33,
    onsetSec,
    offsetSec: onsetSec + 0.3,
    confidence: confidence(i),
    bendCents: []
  }));
}

/** Gaps between consecutive beats. */
function gapsOf(beats: number[]): number[] {
  return beats.slice(1).map((beat, i) => beat - beats[i]);
}

describe('onsetSignal', () => {
  it('puts energy at each onset and none between', () => {
    const signal = onsetSignal(pulse(4, 0.5), 2, DEFAULT_BEAT_OPTIONS.frameRateHz);
    const rate = DEFAULT_BEAT_OPTIONS.frameRateHz;

    expect(signal[0]).toBeGreaterThan(0);
    // A quarter of the way between two onsets is well clear of both.
    expect(signal[Math.round(0.25 * rate)]).toBeLessThan(signal[0] * 0.1);
  });

  it('spreads each onset over its neighbouring frames', () => {
    // The blur is the whole reason a beat one frame off an onset still scores,
    // which is what lets the tracker follow a period that is not a whole
    // number of frames. Bare impulses pass every other test in this file.
    const signal = onsetSignal(pulse(4, 0.5), 2, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(signal[1]).toBeGreaterThan(signal[0] * 0.5);
  });
});

describe('estimateTempo', () => {
  it('reads 120 BPM off a half-second pulse', () => {
    const signal = onsetSignal(pulse(16, 0.5), 8, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(120, -0.5);
  });

  it('reads 90 BPM off a two-thirds-second pulse', () => {
    const signal = onsetSignal(pulse(16, 60 / 90), 11, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(90, -0.5);
  });

  it('reads the beat and not the subdivision off barely accented eighths', () => {
    // Eighth notes at 100 BPM, the on-beat ones only 5 % louder. Raw
    // autocorrelation prefers the eighth: every onset lines up at that lag,
    // and the shorter lag has one more overlapping term to sum. Scored
    // without the log-normal prior this fixture returns 200 BPM; the prior is
    // the only thing in the module that recovers 100, and nothing else here
    // tests it.
    const eighths = notesAt(
      Array.from({ length: 30 }, (_, i) => i * 0.3),
      i => (i % 2 === 0 ? 0.8 : 0.76)
    );
    const signal = onsetSignal(eighths, 9, DEFAULT_BEAT_OPTIONS.frameRateHz);

    expect(estimateTempo(signal, DEFAULT_BEAT_OPTIONS)).toBeCloseTo(100, -0.5);
  });
});

describe('trackBeats', () => {
  it('lands beats on the notes that produced them', () => {
    const grid = trackBeats(pulse(16, 0.5), 8, FOUR_FOUR);

    expect(grid.beatsSec.length).toBeGreaterThan(10);
    for (const beat of grid.beatsSec) {
      const nearest = Math.round(beat / 0.5) * 0.5;
      expect(Math.abs(beat - nearest)).toBeLessThan(0.03);
    }
  });

  it('keeps the pulse through a missing note', () => {
    // Drop the note on beat 5 — the tracker must not skip or halve.
    const notes = pulse(16, 0.5).filter((_, i) => i !== 5);
    const grid = trackBeats(notes, 8, FOUR_FOUR);

    const gaps = grid.beatsSec.slice(1).map((b, i) => b - grid.beatsSec[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 1);
  });

  it('lays the first beat on the music, not on the silence in front of it', () => {
    // Only frames inside the first half-period can start a DP chain, so the
    // untrimmed backtrace always reaches back to within half a beat of frame
    // zero. Music that starts later arrives with a run of beats no note
    // supports in front of it, and `deriveScore` reads beatsSec[0] as bar 1
    // beat 1 — so the five phantoms this fixture used to produce put the first
    // played note on bar 2 beat 2 with the tempo still exactly right.
    const grid = trackBeats(pulse(16, 0.5, 2.7), 10.7, FOUR_FOUR);

    expect(Math.abs(grid.beatsSec[0] - 2.7)).toBeLessThan(0.5);
  });

  it('stops at the last note rather than filling the stated duration', () => {
    // Eight seconds of music in a forty-second file. The beats past the end
    // corrupt nothing — `score-derivation.ts` sizes the score from the notes
    // it placed — but they are noise in an artifact a user has to correct by
    // hand, and this fixture used to end 65 beats past the last note. The
    // smoothing window carries one beat of ring-out past the last onset at
    // 7.5 s, which is why this allows a beat and not none.
    const grid = trackBeats(pulse(16, 0.5), 40, FOUR_FOUR);

    expect(grid.beatsSec[grid.beatsSec.length - 1]).toBeLessThan(8.5);
  });

  it('carries the caller time signature through', () => {
    const three: TimeSignature = { numerator: 3, denominator: 4, isCommon: false };

    expect(trackBeats(pulse(12, 0.5), 6, three).timeSignature).toEqual(three);
  });

  it('produces a usable grid when there are no notes at all', () => {
    const grid = trackBeats([], 4, FOUR_FOUR);

    expect(grid.beatsSec.length).toBeGreaterThan(1);
    const gaps = grid.beatsSec.slice(1).map((b, i) => b - grid.beatsSec[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.5, 1);
  });

  it('returns beats in ascending order', () => {
    const grid = trackBeats(pulse(16, 0.5), 8, FOUR_FOUR);

    expect([...grid.beatsSec].sort((a, b) => a - b)).toEqual(grid.beatsSec);
  });

  it('follows the music when the tempo changes', () => {
    // 120 BPM for four seconds, then 132. Every other test in this file uses a
    // pulse starting at zero and holding one tempo, which an evenly spaced
    // grid laid down from frame zero satisfies without tracking anything -
    // this is the fixture that tells a dynamic program from a ruler.
    const onsets = [
      ...Array.from({ length: 8 }, (_, i) => i * 0.5),
      ...Array.from({ length: 9 }, (_, k) => 4 + k * (60 / 132))
    ];
    const grid = trackBeats(notesAt(onsets), 8, FOUR_FOUR);

    // Every beat sits on a note, before and after the change.
    for (const beat of grid.beatsSec) {
      const nearest = Math.min(...onsets.map(onset => Math.abs(onset - beat)));
      expect(nearest).toBeLessThan(0.015);
    }

    // And the beat speeds up with them rather than holding the old period.
    const tail = gapsOf(grid.beatsSec.filter(beat => beat >= 4));
    const meanGap = tail.reduce((sum, gap) => sum + gap, 0) / tail.length;

    expect(meanGap).toBeCloseTo(60 / 132, 2);
  });

  it('produces a structurally valid grid from degenerate input', () => {
    // Nothing downstream checks these, so the guarantee has to hold here:
    // `secondsToBeats` divides by the gap between neighbouring beats, and a
    // one-entry or NaN-bearing grid would silently poison every derived time.
    // These are also the cases where the trim can take everything: a lone
    // onset leaves one beat above threshold, and silence leaves none, so both
    // have to come back out as the even grid rather than as a stub.
    const cases: [string, DetectedNote[], number][] = [
      ['a single note', notesAt([1]), 4],
      ['every note at the same instant', notesAt([2, 2, 2, 2, 2]), 4],
      ['notes with no confidence at all', pulse(8, 0.5).map(n => ({ ...n, confidence: 0 })), 4],
      ['a zero duration and no notes', [], 0],
      ['a zero duration with notes', notesAt([0, 0.5, 1]), 0],
      ['a negative duration', [], -3],
      ['a duration that is not a number', [], Number.NaN]
    ];

    for (const [label, notes, durationSec] of cases) {
      const beats = trackBeats(notes, durationSec, FOUR_FOUR).beatsSec;

      expect(beats.length).withContext(label).toBeGreaterThanOrEqual(2);
      expect(beats.every(beat => Number.isFinite(beat))).withContext(label).toBeTrue();
      expect(gapsOf(beats).every(gap => gap > 0)).withContext(label).toBeTrue();
    }
  });
});
