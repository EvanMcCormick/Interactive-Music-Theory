import {
  STANDARD_BASS_TUNING,
  createDefaultDerivationSettings
} from '../models/transcription.model';
import { assignFingering, candidatesFor } from './transcription-fingering';
import { chordToleranceBeats } from './transcription-quantize';

const SETTINGS = createDefaultDerivationSettings();

/**
 * Beats per second in the fixtures below: 120 BPM in 4/4, the grid
 * `score-derivation.spec.ts` uses, so a quarter note is half a second and a
 * sixteenth is 0.125.
 */
const BEATS_PER_SEC = 2;

/**
 * The attack window `deriveScore` hands in at those settings: four sixteenth
 * slots to the beat, so `chordToleranceBeats` caps at half a slot - an eighth
 * of a beat, 62.5 ms here.
 */
const ATTACK_WINDOW_BEATS = chordToleranceBeats(SETTINGS.finestDivision / 4);

/**
 * `assignFingering` with the fixtures written in seconds.
 *
 * Every case here is a statement about a hand at 120 BPM, so the beat position
 * each onset carries is a restatement of its time rather than an independent
 * fixture value. Cases that are about the window itself pass their own.
 */
function finger(
  notes: { pitch: number; onsetSec: number }[],
  settings = SETTINGS,
  attackWindowBeats = ATTACK_WINDOW_BEATS
): ReturnType<typeof assignFingering> {
  return assignFingering(
    notes.map(note => ({ ...note, beatPosition: note.onsetSec * BEATS_PER_SEC })),
    settings,
    attackWindowBeats
  );
}

describe('candidatesFor', () => {
  it('finds every string that can reach a pitch', () => {
    // A1 = 33: the open A string, or fret 5 on the E string.
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 0, 24)).toEqual([
      { string: 2, fret: 0 },
      { string: 3, fret: 5 }
    ]);
  });

  it('shifts every option by the capo, dropping what falls behind it', () => {
    expect(candidatesFor(33, STANDARD_BASS_TUNING, 2, 24)).toEqual([
      { string: 3, fret: 3 }
    ]);
  });

  it('drops options past the last fret', () => {
    // G2 = 43 sits at fret 15 on the E string, out of reach on a 12-fret neck.
    expect(candidatesFor(43, STANDARD_BASS_TUNING, 0, 12)).toEqual([
      { string: 0, fret: 0 },
      { string: 1, fret: 5 },
      { string: 2, fret: 10 }
    ]);
  });

  /**
   * The capo test above only exercises the low end, where a capo obviously
   * takes options away. It also has to take them away at the top: frets are
   * counted from the capo, so bounding a capo-relative fret by `maxFret` lets
   * the capo lengthen the neck instead of shortening it.
   */
  it('drops options the capo has pushed off the end of the neck', () => {
    // A capo at 5 leaves 7 of a 12-fret neck, so G3 = 55 is the highest pitch
    // available and fret 7 of the G string is its only home. Fret 12 of the D
    // string is absolute fret 17, well past the end.
    expect(candidatesFor(55, STANDARD_BASS_TUNING, 5, 12)).toEqual([
      { string: 0, fret: 7 }
    ]);

    // One semitone higher there is nothing left to play it on.
    expect(candidatesFor(56, STANDARD_BASS_TUNING, 5, 12)).toEqual([]);
  });

  it('returns nothing for a pitch below the instrument', () => {
    expect(candidatesFor(20, STANDARD_BASS_TUNING, 0, 24)).toEqual([]);
  });
});

describe('assignFingering', () => {
  /**
   * `Candidate.string` is a 0-based subscript into the tuning; a ScoreDoc's
   * string number is 1-based. Handing the subscript straight out is not an
   * off-by-one in a label - `ScoreDocMapperService.flipString` counts strings
   * from the other end, so on a bass every note lands a fourth sharp and the
   * top string maps to a string that does not exist.
   *
   * So this pins the two ends of the neck to the two ends of the tuning array,
   * with the array's own ordering asserted rather than assumed. Restating the
   * numbers on either side would survive the same mistake.
   */
  it('numbers strings from the highest-pitched, the way tab does', () => {
    const top = 0;
    const bottom = STANDARD_BASS_TUNING.length - 1;

    expect(STANDARD_BASS_TUNING[top]).toBe(Math.max(...STANDARD_BASS_TUNING));
    expect(STANDARD_BASS_TUNING[bottom]).toBe(Math.min(...STANDARD_BASS_TUNING));

    const openTop = finger(
      [{ pitch: STANDARD_BASS_TUNING[top], onsetSec: 0 }],
      SETTINGS
    );
    const openBottom = finger(
      [{ pitch: STANDARD_BASS_TUNING[bottom], onsetSec: 0 }],
      SETTINGS
    );

    // StaffDoc.tuning[0] is string 1, so the highest string is 1 and the
    // lowest is the string count - 4 on a bass, not 0 and 3.
    expect(openTop[0]).toEqual({ kind: 'fretted', string: 1, fret: 0 });
    expect(openBottom[0]).toEqual({
      kind: 'fretted',
      string: STANDARD_BASS_TUNING.length,
      fret: 0
    });
  });

  it('prefers an open string to the fretted equivalent', () => {
    expect(finger([{ pitch: 33, onsetSec: 0 }], SETTINGS)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 }
    ]);
  });

  it('returns null where the instrument cannot play the pitch', () => {
    expect(finger([{ pitch: 20, onsetSec: 0 }], SETTINGS)).toEqual([null]);
  });

  it('carries on after an unplayable note', () => {
    const result = finger(
      [{ pitch: 20, onsetSec: 0 }, { pitch: 33, onsetSec: 1 }],
      SETTINGS
    );

    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ kind: 'fretted', string: 3, fret: 0 });
  });

  /**
   * The thesis of the feature, in two tests.
   *
   * The same three pitches are fingered differently depending only on how much
   * time there is between them. Played fast, the hand stays put and takes the
   * high fret on a lower string; played slowly, it has time to shift down to
   * the easier low fret. Assigning each note its lowest available fret - the
   * obvious approach - gives the low-fret answer both times, which is why such
   * tab skitters across the neck on fast passages.
   */
  it('stays in position when the notes come fast', () => {
    const fast = finger(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 0.1 },
        { pitch: 45, onsetSec: 0.2 }
      ],
      SETTINGS
    );

    expect(fast[2]).toEqual({ kind: 'fretted', string: 3, fret: 12 });
  });

  it('shifts down the neck when there is time to move', () => {
    const slow = finger(
      [
        { pitch: 52, onsetSec: 0 },
        { pitch: 54, onsetSec: 2 },
        { pitch: 45, onsetSec: 4 }
      ],
      SETTINGS
    );

    expect(slow[2]).toEqual({ kind: 'fretted', string: 1, fret: 2 });
  });

  /**
   * Charging nothing for a shift across an open string does not merely permit
   * a leap, it pays for one. `55 -> 45` on its own gives the sane
   * `s1f12 | s3f12`; interposing an open A across the same two thirty-seconds
   * used to buy fret 22, because zeroing both move costs made staying on one
   * string save more in string-change cost than the leap cost. And it
   * composes: an alternating fretted/open figure bought unlimited free travel.
   *
   * The onsets are thirty-seconds at 120 rather than the 20 ms this was
   * written with, which `separateSimultaneous` now reads as a single attack -
   * and repairing the collision put the first note back on fret 12 by
   * accident, which would have hidden the leap this exists to catch.
   */
  it('does not buy a leap with an open string in the middle', () => {
    const figure = finger(
      [
        { pitch: 55, onsetSec: 0 },
        { pitch: 33, onsetSec: 0.0625 },
        { pitch: 45, onsetSec: 0.125 }
      ],
      SETTINGS
    );

    expect(figure[0]).toEqual({ kind: 'fretted', string: 1, fret: 12 });
    expect(figure.every(pitch => pitch?.kind === 'fretted' && pitch.fret <= 12)).toBe(true);
  });

  /**
   * The Viterbi pass scores a sequence and cannot see that two notes sound at
   * once, so it fingers a dyad on whichever single string is cheapest. The
   * consequence is not just unreadable tab: a tab line holds one number, so
   * `transcription-quantize.ts` drops the second pitch and the note leaves the
   * score with nothing to show it was ever there.
   */
  it('moves a simultaneous note off a string already taken', () => {
    // 10 ms apart rather than exactly together: a detector does not report
    // two strings plucked at once to the sample, and a window that only
    // caught identical onsets would catch almost nothing real.
    const dyad = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 36, onsetSec: 0.01 }],
      SETTINGS
    );

    // Both notes still sound, on strings that can each hold a number.
    const sounded = dyad.map(pitch =>
      pitch?.kind === 'fretted'
        ? STANDARD_BASS_TUNING[pitch.string - 1] + pitch.fret
        : null
    );
    expect(sounded).toEqual([33, 36]);
    expect(new Set(dyad.map(pitch => pitch?.kind === 'fretted' && pitch.string)).size)
      .toBe(2);

    // Unrepaired both land on the A string, at frets 0 and 3.
    expect(dyad).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 4, fret: 8 }
    ]);
  });

  /**
   * Which note moves cannot be decided on cost alone. Above fret 24 of the D
   * string a bass has one string left, so a pitch up there has exactly one
   * candidate; if the open string it collides with claims that string first,
   * the constrained note is stranded on a collision it had a way out of.
   */
  it('moves whichever of two simultaneous notes has somewhere to go', () => {
    const dyad = finger(
      [{ pitch: 43, onsetSec: 0 }, { pitch: 63, onsetSec: 0.01 }],
      SETTINGS
    );

    // 63 can only be fret 20 of the G string, so the open G has to give way.
    expect(dyad).toEqual([
      { kind: 'fretted', string: 2, fret: 5 },
      { kind: 'fretted', string: 1, fret: 20 }
    ]);
  });

  /**
   * Not every collision is a mistake. A minor second at the bottom of a bass
   * lives on the E string at both ends, so there is no two-string fingering to
   * find and one of the two notes is lost downstream - which is what a player
   * would tell you about that interval on that instrument.
   */
  it('leaves a collision that no fingering can avoid', () => {
    expect(
      finger([{ pitch: 28, onsetSec: 0 }, { pitch: 30, onsetSec: 0.01 }], SETTINGS)
    ).toEqual([
      { kind: 'fretted', string: 4, fret: 0 },
      { kind: 'fretted', string: 4, fret: 2 }
    ]);
  });

  it('pulls the hand towards a position hint', () => {
    const hinted = finger(
      [{ pitch: 45, onsetSec: 0 }],
      { ...SETTINGS, positionHint: 12 }
    );

    expect(hinted[0]).toEqual({ kind: 'fretted', string: 3, fret: 12 });
  });

  // ---------------------------------------------------------------------
  // The weights themselves.
  //
  // The tests above pin behaviour the weights happen to produce; these pin
  // the weights. Each fixture was chosen by mutation: the answer below is
  // stable when its weight is nudged 10% either way, and changes when the
  // weight is zeroed or doubled. A fixture that only survives the true value
  // by a rounding error would pass here and prove nothing, so none were kept.
  // ---------------------------------------------------------------------

  /**
   * These two weights are one ratio, not two numbers. Every alternative
   * fingering of a pitch on an instrument tuned in fourths trades five frets
   * of height for one string of crossing, so `FRET_HEIGHT_WEIGHT * 5` and
   * `STRING_CHANGE_WEIGHT` are always weighed against each other and no
   * fixture can move one without moving the other. What can be pinned is
   * where the balance sits, which is what this does - from both sides.
   */
  it('balances a string crossing against the climb it saves', () => {
    // G#1 then G#2, two seconds apart: time enough to go anywhere.
    const octave = finger(
      [{ pitch: 32, onsetSec: 0 }, { pitch: 44, onsetSec: 2 }],
      SETTINGS
    );

    // Tip it towards crossing - no charge for it, or a dearer neck - and the
    // hand jumps three strings for fret 1. Tip it the other way and it never
    // leaves the E string, climbing to fret 16. Fret 6 of the D string is the
    // answer between them.
    expect(octave[1]).toEqual({ kind: 'fretted', string: 2, fret: 6 });
  });

  /**
   * The older open-string test cannot see this weight at all: `candidatesFor`
   * returns the open A first and ties break towards the first candidate, so
   * it passes with every weight set to zero. Here the open string has to earn
   * its place against a crossing, which is the only way the bonus can matter.
   */
  it('pays a bonus for an open string, without overpaying', () => {
    // G#1 then D2, a quarter apart. The open D is two strings away; fret 5 of
    // the A string is one. Without the bonus the nearer string wins.
    const openD = finger(
      [{ pitch: 32, onsetSec: 0 }, { pitch: 38, onsetSec: 0.25 }],
      SETTINGS
    );
    expect(openD[1]).toEqual({ kind: 'fretted', string: 2, fret: 0 });

    // A1 and C#3 struck together. Fret 5 of the E string puts the hand beside
    // the C# at fret 6 of the G string - a shape a hand can make. Double the
    // bonus and the open A is worth taking instead, spreading the same two
    // notes across the whole neck.
    const dyad = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 49, onsetSec: 0.001 }],
      SETTINGS
    );
    expect(dyad[0]).toEqual({ kind: 'fretted', string: 4, fret: 5 });
  });

  /**
   * `MIN_TIME_FACTOR` is why the module docblock cannot say a shift across a
   * rest is free. Time buys travel, but only down to a floor; past about two
   * and a half seconds the gap stops mattering and a five-fret shift still
   * costs 0.5.
   */
  it('never lets a long rest make a shift free', () => {
    // F#1, up an octave and a major third, and back - three seconds apart.
    const spaced = finger(
      [
        { pitch: 30, onsetSec: 0 },
        { pitch: 44, onsetSec: 3 },
        { pitch: 30, onsetSec: 6 }
      ],
      SETTINGS
    );

    // Take the floor away and three seconds buys a fourteen-fret climb up the
    // E string for nothing. Double it and movement outweighs the crossing, so
    // the hand takes fret 1 of the G string to stay where it is.
    expect(spaced[1]).toEqual({ kind: 'fretted', string: 2, fret: 6 });
  });

  /**
   * `MAX_TIME_FACTOR` is the other end of the same clamp, and it only engages
   * below about 31 ms - in practice a chord, or a detector reporting one
   * attack twice. There is no movement to charge for between two notes struck
   * together, and without a ceiling the model charges for it anyway.
   */
  it('never lets a chord price a string crossing out of reach', () => {
    // G#1, G#2 and D2, detected a millisecond apart: one attack.
    const chord = finger(
      [
        { pitch: 32, onsetSec: 0 },
        { pitch: 44, onsetSec: 0.001 },
        { pitch: 38, onsetSec: 0.002 }
      ],
      SETTINGS
    );

    // Without the ceiling the imagined travel swamps every other term and the
    // three notes are crammed into frets 4-6, open D and all. With it, the
    // open D survives and the G# takes fret 1 of the G string.
    expect(chord[1]).toEqual({ kind: 'fretted', string: 1, fret: 1 });
    expect(chord[2]).toEqual({ kind: 'fretted', string: 2, fret: 0 });
  });

  /**
   * The leap test above pins this discount away from 0, where an open string
   * makes travel free. It does not pin it away from 1, which is no discount
   * at all - and 1 is the value someone deleting a special case would reach
   * for. Two notes are enough to pin both ends.
   */
  it('discounts a move across an open string without abolishing it', () => {
    // A1 then G3, a sixteenth apart.
    const climb = finger(
      [{ pitch: 33, onsetSec: 0 }, { pitch: 55, onsetSec: 0.125 }],
      SETTINGS
    );

    // At no discount the open A is not worth the crossing and the A becomes
    // fret 5 of the E string. At a full discount the open A pays for a leap
    // to fret 22 of its own string. In between: open A, then fret 12.
    expect(climb).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 1, fret: 12 }
    ]);
  });

  /**
   * The attack window needs pinning at both ends. Too small and a detector
   * reporting a chord a few milliseconds wide stops being a chord; too large
   * and consecutive notes of an ordinary line are read as struck together,
   * and the repair scatters a run that belongs on one string.
   *
   * The same run shows the move discount doing its job: five notes up the E
   * string and then across to the open A, rather than carrying on to fret 5.
   */
  it('leaves a run of sixteenths on the string it belongs on', () => {
    const run = [28, 29, 30, 31, 32, 33, 34, 35].map((pitch, index) => ({
      pitch,
      onsetSec: index * 0.125
    }));

    expect(finger(run, SETTINGS)).toEqual([
      { kind: 'fretted', string: 4, fret: 0 },
      { kind: 'fretted', string: 4, fret: 1 },
      { kind: 'fretted', string: 4, fret: 2 },
      { kind: 'fretted', string: 4, fret: 3 },
      { kind: 'fretted', string: 4, fret: 4 },
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 3, fret: 1 },
      { kind: 'fretted', string: 3, fret: 2 }
    ]);
  });

  /**
   * The window is the caller's to size, and it has to be the one the bar will
   * be quantized on. Sizing it here instead - the 30 ms constant this replaced
   * - left every separation between the two windows unseparated and merged,
   * and `addToChord` deleted the second pitch outright.
   */
  it('measures one attack on the window the bar will be quantized to', () => {
    const spread = [{ pitch: 33, onsetSec: 0 }, { pitch: 36, onsetSec: 0.05 }];

    // 50 ms is inside half a sixteenth slot at 120 BPM, so `snapToSlots` will
    // make one chord of these two and they have to leave here on strings that
    // can each hold a number.
    expect(finger(spread)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 4, fret: 8 }
    ]);

    // A narrower window is not a milder version of the same answer. Both notes
    // stay on the A string, and one of them stops existing a stage later.
    expect(finger(spread, SETTINGS, 0.03 * BEATS_PER_SEC)).toEqual([
      { kind: 'fretted', string: 3, fret: 0 },
      { kind: 'fretted', string: 3, fret: 3 }
    ]);
  });
});
