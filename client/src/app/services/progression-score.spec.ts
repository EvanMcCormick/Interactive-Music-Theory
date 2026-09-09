import { BeatDoc, TimeSignature } from '../models/composer.model';
import {
  ChordSlot,
  ProgressionDoc,
  RollNote,
  createDefaultProgression,
  createDegreeSlot
} from '../models/progression.model';
import { DEFAULT_VELOCITY } from '../models/progression-normalize';
import {
  MAX_PREVIEW_BARS,
  PROGRESSION_FINEST_DIVISION,
  barBeats,
  placeProgressionNotes,
  progressionToScore,
  velocityDynamic
} from './progression-score';
import { pitchToMidi } from './staff-pitch';
import { beatSlots } from './transcription-quantize';

/**
 * The projection is checked as notation, not as a well-typed object: the
 * assertions below are mostly "what would a reader see" - one whole note, three
 * bars, a tie across the line - because a `ScoreDoc` that type-checks and
 * engraves nonsense is exactly the failure this module can have.
 */

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4, isCommon: true };
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8, isCommon: false };

function note(midi: number, startBeat: number, lengthBeats: number, velocity = DEFAULT_VELOCITY): RollNote {
  return { midi, startBeat, lengthBeats, velocity };
}

/** A slot at `startBeat`, `lengthBeats` long, holding exactly `notes`. */
function slotOf(startBeat: number, lengthBeats: number, notes: RollNote[]): ChordSlot {
  return { ...createDegreeSlot(0, startBeat), lengthBeats, notes };
}

function docOf(slots: ChordSlot[], overrides: Partial<ProgressionDoc> = {}): ProgressionDoc {
  return { ...createDefaultProgression(), slots, ...overrides };
}

/** The one staff's bars, which is the only place this module writes anything. */
function barsOf(doc: ProgressionDoc): BeatDoc[][] {
  return progressionToScore(doc).doc.tracks[0].staves[0].bars.map(bar => bar.voices[0].beats);
}

function midisOf(beat: BeatDoc): number[] {
  return beat.notes.map(noteDoc => {
    if (noteDoc.pitch.kind !== 'pitched') throw new Error('a progression writes pitched notes');
    return pitchToMidi(noteDoc.pitch);
  });
}

/** C major triad from middle C, the voicing `generateSlotNotes` produces for I. */
const C_MAJOR_TRIAD = [60, 64, 67];

function triadNotes(startBeat: number, lengthBeats: number): RollNote[] {
  return C_MAJOR_TRIAD.map(midi => note(midi, startBeat, lengthBeats));
}

describe('barBeats', () => {
  // A progression's beat is a quarter note - `buildSchedule` converts one with
  // `60 / tempo` and never consults the meter - so a bar is only as many beats
  // as the numerator when the denominator is 4.
  it('counts a 4/4 bar as four beats', () => {
    expect(barBeats(FOUR_FOUR)).toBe(4);
  });

  it('counts a 6/8 bar as three beats', () => {
    expect(barBeats(SIX_EIGHT)).toBe(3);
  });

  it('counts a 3/4 bar as three beats', () => {
    expect(barBeats({ numerator: 3, denominator: 4, isCommon: false })).toBe(3);
  });
});

describe('velocityDynamic', () => {
  it('writes the roll default as mezzo-forte', () => {
    expect(velocityDynamic(DEFAULT_VELOCITY)).toBe('mf');
  });

  it('spans the whole range without a gap', () => {
    const seen = new Set<string>();
    for (let velocity = 1; velocity <= 127; velocity++) seen.add(velocityDynamic(velocity));
    expect(seen.size).toBe(8);
  });

  it('never runs off either end', () => {
    // Velocity is bounded by `boundVelocity` on the editing path and by nothing
    // at all on `replaceDocument`'s, so both ends have to hold here.
    expect(velocityDynamic(-500)).toBe('ppp');
    expect(velocityDynamic(5000)).toBe('fff');
  });

  it('rises monotonically', () => {
    const order = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
    let previous = 0;
    for (let velocity = 1; velocity <= 127; velocity++) {
      const index = order.indexOf(velocityDynamic(velocity));
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });
});

describe('placeProgressionNotes', () => {
  it('flattens a slot offset into absolute bars', () => {
    // The slot starts on bar 2; its note is a beat into it, so the note is on
    // beat 1 of bar 2 rather than beat 1 of the progression.
    const bars = placeProgressionNotes(docOf([slotOf(8, 4, [note(60, 1, 1)])]), 3);

    expect(bars[0]).toEqual([]);
    expect(bars[1]).toEqual([]);
    expect(bars[2].length).toBe(1);
    expect(bars[2][0].placed.beatInBar).toBe(1);
    expect(bars[2][0].isHeld).toBeFalse();
  });

  it('counts beatInBar in denominator units, not in quarters', () => {
    // 6/8: the progression's beat is still a quarter, and `PlacedNote` counts
    // eighths, so beat 1 of the bar is the third eighth.
    const doc = docOf([slotOf(0, 3, [note(60, 1, 1)])], { timeSignature: SIX_EIGHT });

    expect(placeProgressionNotes(doc, 1)[0][0].placed.beatInBar).toBe(2);
  });

  it('continues a note that crosses the bar line into the next bar', () => {
    const bars = placeProgressionNotes(docOf([slotOf(0, 8, [note(60, 3, 2)])]), 2);

    expect(bars[0].length).toBe(1);
    expect(bars[0][0].isHeld).toBeFalse();
    expect(bars[1].length).toBe(1);
    expect(bars[1][0].isHeld).toBeTrue();
    expect(bars[1][0].placed.beatInBar).toBe(0);
  });

  it('leaves a note ending on the bar line whole', () => {
    const bars = placeProgressionNotes(docOf([slotOf(0, 8, [note(60, 0, 4)])]), 2);

    expect(bars[0].length).toBe(1);
    expect(bars[1]).toEqual([]);
  });

  it('carries a long note through every bar it sounds in', () => {
    const bars = placeProgressionNotes(docOf([slotOf(0, 12, [note(60, 0, 11)])]), 3);

    expect(bars.map(bar => bar.length)).toEqual([1, 1, 1]);
    expect(bars.map(bar => bar[0].isHeld)).toEqual([false, true, true]);
  });

  it('drops a continuation the next bar strikes again', () => {
    // Two slots a bar apart both sounding middle C, the first overhanging into
    // the second. Written as it stands that is two noteheads on one beat.
    const bars = placeProgressionNotes(
      docOf([slotOf(0, 4, [note(60, 3, 2)]), slotOf(4, 4, [note(60, 0, 4)])]),
      2
    );

    expect(bars[1].length).toBe(1);
    expect(bars[1][0].isHeld).toBeFalse();
  });

  it('keeps a re-attack far enough from the bar line to be one', () => {
    const bars = placeProgressionNotes(
      docOf([slotOf(0, 4, [note(60, 3, 2)]), slotOf(4, 4, [note(60, 1, 3)])]),
      2
    );

    expect(bars[1].length).toBe(2);
    expect(bars[1].map(entry => entry.isHeld)).toEqual([true, false]);
  });

  it('tolerates a note of no length', () => {
    // `normalizeRollNote` checks that a length is finite and nothing more, so a
    // zero or negative one reaches here through `replaceDocument`.
    const bars = placeProgressionNotes(docOf([slotOf(0, 4, [note(60, 1, 0), note(62, 2, -3)])]), 1);

    expect(bars[0].length).toBe(2);
    expect(bars[0].every(entry => !entry.isHeld)).toBeTrue();
  });
});

describe('progressionToScore', () => {
  it('writes a four-beat triad in 4/4 as one bar of whole-note chords', () => {
    const bars = barsOf(docOf([slotOf(0, 4, triadNotes(0, 4))]));

    expect(bars.length).toBe(1);
    expect(bars[0].length).toBe(1);
    expect(bars[0][0].duration).toBe(1);
    expect(bars[0][0].dots).toBe(0);
    expect(bars[0][0].isRest).toBeFalse();
    expect(midisOf(bars[0][0])).toEqual(C_MAJOR_TRIAD);
  });

  it('writes three four-beat slots as three bars', () => {
    const bars = barsOf(
      docOf([
        slotOf(0, 4, triadNotes(0, 4)),
        slotOf(4, 4, triadNotes(0, 4)),
        slotOf(8, 4, triadNotes(0, 4))
      ])
    );

    expect(bars.length).toBe(3);
    for (const beats of bars) {
      expect(beats.length).toBe(1);
      expect(beats[0].duration).toBe(1);
      expect(midisOf(beats[0])).toEqual(C_MAJOR_TRIAD);
    }
  });

  it('fills a full 6/8 bar with a dotted half', () => {
    const doc = docOf([slotOf(0, 3, [note(60, 0, 3)])], { timeSignature: SIX_EIGHT });
    const bars = barsOf(doc);

    expect(bars.length).toBe(1);
    expect(bars[0].length).toBe(1);
    expect(bars[0][0].duration).toBe(2);
    expect(bars[0][0].dots).toBe(1);
  });

  it('gives an empty progression one bar of rest', () => {
    // `ComposerService.replaceDocument` throws on a score with no bars, and
    // alphaTab draws nothing for one, so the empty page needs a bar of its own.
    const bars = barsOf(docOf([]));

    expect(bars.length).toBe(1);
    expect(bars[0].length).toBe(1);
    expect(bars[0][0].isRest).toBeTrue();
  });

  it('states the meter on bar 1 and lets the rest inherit it', () => {
    const score = progressionToScore(docOf([slotOf(0, 8, triadNotes(0, 8))])).doc;

    expect(score.masterBars.length).toBe(2);
    expect(score.masterBars[0].timeSignature).toEqual(FOUR_FOUR);
    expect(score.masterBars[1].timeSignature).toBeNull();
  });

  it('keeps the staff parallel to the master bars', () => {
    const score = progressionToScore(docOf([slotOf(0, 12, triadNotes(0, 12))])).doc;

    expect(score.tracks[0].staves[0].bars.length).toBe(score.masterBars.length);
  });

  it('fills every bar exactly, whatever the rhythm', () => {
    const doc = docOf([
      slotOf(0, 4, [note(60, 0, 0.5), note(62, 0.75, 1.5), note(64, 3.25, 2)]),
      slotOf(4, 5, [note(65, 1.5, 0.25), note(67, 2, 4)])
    ]);

    for (const beats of barsOf(doc)) {
      expect(beatSlots(beats, PROGRESSION_FINEST_DIVISION)).toBe(4 * (PROGRESSION_FINEST_DIVISION / 4));
    }
  });

  it('bars a progression whose slots do not land on bar lines', () => {
    // The case the whole module exists for: a three-beat slot puts the next
    // chord on beat 4 of bar 1, where it sounds across the line into bar 2.
    const bars = barsOf(
      docOf([slotOf(0, 3, triadNotes(0, 3)), slotOf(3, 4, triadNotes(0, 4))])
    );

    expect(bars.length).toBe(2);

    // Bar 1: the first chord for three beats - written as a half tied to a
    // quarter, because `quantizeBar` shows the middle of a 4/4 bar - then the
    // second chord on beat 4.
    expect(bars[0].map(beat => beat.duration)).toEqual([2, 4, 4]);
    expect(bars[0].map(beat => beat.notes[0].isTied)).toEqual([false, true, false]);

    // Bar 2: the second chord, held over, and nothing struck.
    expect(bars[1].length).toBe(1);
    expect(bars[1][0].duration).toBe(1);
    expect(bars[1][0].notes.every(noteDoc => noteDoc.isTied)).toBeTrue();
  });

  it('ties a note across the bar line rather than restriking it', () => {
    const bars = barsOf(docOf([slotOf(0, 8, [note(60, 3, 2)])]));

    // Bar 1: three beats of rest, then the note.
    const struck = bars[0][bars[0].length - 1];
    expect(struck.isRest).toBeFalse();
    expect(struck.notes[0].isTied).toBeFalse();

    // Bar 2: the same note, held.
    expect(bars[1][0].isRest).toBeFalse();
    expect(midisOf(bars[1][0])).toEqual([60]);
    expect(bars[1][0].notes[0].isTied).toBeTrue();
  });

  it('restrikes rather than tying over a note the bar stopped writing', () => {
    // C4 sounds through the whole of bar 1, but E4 is struck halfway, and
    // `quantizeBar` writes each chord only until the next attack - so bar 1's
    // last beat is E4 alone. A tie from C4's half note into bar 2 would arc
    // over the E4, between two notes a reader cannot see as adjacent.
    const bars = barsOf(docOf([slotOf(0, 8, [note(60, 0, 5), note(64, 2, 2)])]));

    expect(midisOf(bars[0][bars[0].length - 1])).toEqual([64]);
    expect(midisOf(bars[1][0])).toEqual([60]);
    expect(bars[1][0].notes[0].isTied).toBeFalse();
  });

  it('still ties when the crossing note is the last chord struck in the bar', () => {
    // A lead-in note, then a chord on beat 3 that sounds over the line. It is
    // the last thing written in bar 1, so the tie's two ends are adjacent and
    // the arc is one a reader can follow.
    const bars = barsOf(
      docOf([slotOf(0, 8, [note(60, 0, 2), note(64, 2, 4), note(67, 2, 4)])])
    );

    expect(midisOf(bars[0][bars[0].length - 1])).toEqual([64, 67]);
    expect(bars[1][0].notes.every(noteDoc => noteDoc.isTied)).toBeTrue();
  });

  it('does not tie a note that stops on the bar line', () => {
    const bars = barsOf(docOf([slotOf(0, 8, [note(60, 0, 4)])]));

    expect(bars[0][0].notes[0].isTied).toBeFalse();
    expect(bars[1].every(beat => beat.isRest)).toBeTrue();
  });

  it('lets a note overhanging its slot size the score', () => {
    // Owned timing survives a shrink, so a note may sit past its slot's end -
    // `buildSchedule` already lets one lengthen the transport.
    const score = progressionToScore(docOf([slotOf(0, 4, [note(60, 3, 4)])])).doc;

    expect(score.masterBars.length).toBe(2);
    expect(score.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0].isTied).toBeTrue();
  });

  it('writes the key signature the progression is in', () => {
    const flat = progressionToScore(
      docOf([], { key: { tonic: 3, scaleId: 'ionian', preferSharps: false } })
    ).doc;
    expect(flat.tracks[0].staves[0].bars[0].keySignature).toEqual({ fifths: -3, mode: 'major' });

    const minor = progressionToScore(
      docOf([], { key: { tonic: 4, scaleId: 'aeolian', preferSharps: true } })
    ).doc;
    expect(minor.tracks[0].staves[0].bars[0].keySignature).toEqual({ fifths: 1, mode: 'minor' });
  });

  it('spells the split wedge the way the key does', () => {
    // Six o'clock is one pitch class and two keys. F sharp major and G flat
    // major share a tonic and a scale id, and `preferSharps` is the only thing
    // that separates them - the circle offers both as their own hit targets.
    const sharp = progressionToScore(
      docOf([], { key: { tonic: 6, scaleId: 'ionian', preferSharps: true } })
    ).doc;
    expect(sharp.tracks[0].staves[0].bars[0].keySignature.fifths).toBe(6);

    const flat = progressionToScore(
      docOf([], { key: { tonic: 6, scaleId: 'ionian', preferSharps: false } })
    ).doc;
    expect(flat.tracks[0].staves[0].bars[0].keySignature.fifths).toBe(-6);
  });

  it('leaves an unambiguous key alone whatever it prefers', () => {
    // Only the six o'clock position has a second spelling, so `preferSharps`
    // must not be able to reach any of the other eleven: E flat major is three
    // flats even if something asks for sharps.
    const score = progressionToScore(
      docOf([], { key: { tonic: 3, scaleId: 'ionian', preferSharps: true } })
    ).doc;

    expect(score.tracks[0].staves[0].bars[0].keySignature.fifths).toBe(-3);
  });

  it('falls back to no accidentals for a scale with no parent major', () => {
    const score = progressionToScore(
      docOf([], { key: { tonic: 5, scaleId: 'majorPentatonic', preferSharps: true } })
    ).doc;

    expect(score.tracks[0].staves[0].bars[0].keySignature).toEqual({ fifths: 0, mode: 'major' });
  });

  it('drops to the bass clef when nothing reaches middle C', () => {
    const low = progressionToScore(docOf([slotOf(0, 4, [note(48, 0, 4), note(55, 0, 4)])])).doc;
    expect(low.tracks[0].staves[0].bars[0].clef).toBe('f4');

    const high = progressionToScore(docOf([slotOf(0, 4, triadNotes(0, 4))])).doc;
    expect(high.tracks[0].staves[0].bars[0].clef).toBe('g2');
  });

  it('draws an empty progression on the treble clef', () => {
    // Nothing sounds, so nothing is below middle C - and nothing is above it
    // either. The empty page should be the one the first chord will land on.
    expect(progressionToScore(docOf([])).doc.tracks[0].staves[0].bars[0].clef).toBe('g2');
  });

  it('writes one staff of standard notation and no tab', () => {
    const staff = progressionToScore(docOf([])).doc.tracks[0].staves[0];

    expect(staff.tuning).toEqual([]);
    expect(staff.showStandardNotation).toBeTrue();
    expect(staff.showTablature).toBeFalse();
  });

  it('carries the name and the tempo across', () => {
    const score = progressionToScore(docOf([], { name: 'Turnaround', tempo: 96 })).doc;

    expect(score.title).toBe('Turnaround');
    expect(score.tempo).toBe(96);
  });

  it('states the standing dynamic on every beat', () => {
    // Not only where it changes. `BeatDoc.dynamics` documents `null` as
    // "inherits the previous beat", and nothing downstream reads it that way:
    // the mapper skips a null and alphaTab's own default is forte, so an
    // unmarked beat engraves as a change to `f`.
    const bars = barsOf(
      docOf([slotOf(0, 8, [note(60, 0, 1), note(62, 1, 1), note(64, 4, 1)])])
    );

    for (const beats of bars) {
      for (const beat of beats) expect(beat.dynamics).toBe('mf');
    }
  });

  it('marks a change of dynamic where it happens', () => {
    const bars = barsOf(
      docOf([slotOf(0, 4, [note(60, 0, 1, DEFAULT_VELOCITY), note(62, 2, 1, 110)])])
    );

    expect(bars[0][0].dynamics).toBe('mf');
    expect(bars[0][1].dynamics).toBe('ff');
  });

  it('does not restate a dynamic over the far end of a tie', () => {
    // The held half is not a new attack. It carries the standing marking - as
    // every beat does - and so changes nothing a reader can see.
    const bars = barsOf(docOf([slotOf(0, 8, [note(60, 3, 2, 110)])]));

    expect(bars[0][0].dynamics).toBe('ff');
    expect(bars[1][0].dynamics).toBe('ff');
  });

  it('takes the dynamic before the first attack from that attack', () => {
    // Three beats of rest lead the bar. Marking them at anything but the
    // note's own dynamic would announce a level the music then contradicts.
    const bars = barsOf(docOf([slotOf(0, 4, [note(60, 3, 1, 30)])]));

    expect(bars[0][0].isRest).toBeTrue();
    expect(bars[0].every(beat => beat.dynamics === 'pp')).toBeTrue();
  });

  it('marks a silent progression without inventing a level', () => {
    expect(barsOf(docOf([]))[0][0].dynamics).toBe('mf');
  });

  it('truncates a progression too long to draw, and says so', () => {
    const long = progressionToScore(docOf([slotOf(0, 4 * (MAX_PREVIEW_BARS + 10), [note(60, 0, 1)])]));

    expect(long.barCount).toBe(MAX_PREVIEW_BARS + 10);
    expect(long.truncated).toBeTrue();
    expect(long.doc.masterBars.length).toBe(MAX_PREVIEW_BARS);
  });

  it('gives a note with no length a bar to be struck in', () => {
    // A zero-length note on the final bar line reaches exactly as far as the
    // slot does, so measuring by ends alone counted one bar and then placed it
    // in the bar after the last, where it was dropped.
    const score = progressionToScore(docOf([slotOf(0, 4, [note(60, 4, 0)])]));

    expect(score.barCount).toBe(2);
    expect(score.doc.tracks[0].staves[0].bars[1].voices[0].beats[0].isRest).toBeFalse();
  });

  it('draws one notehead when two placements round onto one slot', () => {
    // Both sit inside the slot centred on beat 1 - which spans 0.96875 to
    // 1.03125 on a sixty-fourth grid - and are 0.06 apart, twice the clustering
    // window. `quantizeBar` makes them two clusters, rounds both onto slot 16
    // and writes them as one chord: its second merging stage, and the one a
    // window alone misses.
    const bars = barsOf(docOf([slotOf(0, 4, [note(60, 0.97, 1), note(60, 1.03, 1)])]));

    // Counted per beat rather than per bar: the surviving note is spelled as a
    // quarter tied to a half, so there are two sounding beats and the question
    // is how many noteheads are on each of them.
    const struck = bars[0].filter(beat => !beat.isRest);
    expect(struck.length).toBeGreaterThan(0);
    for (const beat of struck) expect(midisOf(beat)).toEqual([60]);
  });

  it('reports an ordinary progression as whole', () => {
    const short = progressionToScore(docOf([slotOf(0, 4, triadNotes(0, 4))]));

    expect(short.barCount).toBe(1);
    expect(short.truncated).toBeFalse();
  });
});
