import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { EditScope, durationRefusal, editRefusal, noteEffectRefusal } from './edit-refusals';
import { AccidentalMode, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

const ref = (trackIndex: number, beatIndex = 0): BeatRef =>
  ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex });

/** Guitar track 0 with a note on string 1 at beat 0; piano track 1 with a note at beat 0. */
function doc(): ScoreDoc {
  const score = ComposerService.createEmptyScore();
  score.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, score.masterBars));
  const guitar = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  guitar.isRest = false;
  guitar.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 0 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  const piano = score.tracks[1].staves[0].bars[0].voices[0].beats[0];
  piano.isRest = false;
  piano.notes = [{ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
  return score;
}

describe('editRefusal', () => {
  it('lets a note edit through when there is a note', () => {
    expect(editRefusal(doc(), [ref(0)], { family: 'note', key: 'isGhost' }, null)).toBeNull();
  });

  it('refuses when nothing is selected', () => {
    expect(editRefusal(doc(), [], { family: 'beat', key: 'duration' }, null)).toMatch(/nothing/i);
  });

  it('refuses a note edit on a rest', () => {
    expect(editRefusal(doc(), [ref(0, 1)], { family: 'note', key: 'isGhost' }, null)).toMatch(/note/i);
  });

  it('refuses a note edit on a string the caret is on but no note is', () => {
    expect(editRefusal(doc(), [ref(0)], { family: 'note', key: 'isGhost' }, 4)).toMatch(/note/i);
  });

  it('lets a beat edit through on a rest', () => {
    expect(editRefusal(doc(), [ref(0, 1)], { family: 'beat', key: 'fadeIn' }, null)).toBeNull();
  });

  it('refuses a fretted technique on a pitched staff', () => {
    expect(editRefusal(doc(), [ref(1)], { family: 'note', key: 'bendPoints' }, null)).toMatch(/fretted/i);
  });

  it('refuses tap, slap and pop on a pitched staff, naming each, and allows them on a fretted one', () => {
    for (const key of ['tap', 'slap', 'pop'] as const) {
      expect(editRefusal(doc(), [ref(1)], { family: 'beat', key }, null)).toMatch(/fretted/i);
      expect(editRefusal(doc(), [ref(1)], { family: 'beat', key }, null)).toMatch(new RegExp(`\\b${key}`, 'i'));
      expect(editRefusal(doc(), [ref(0)], { family: 'beat', key }, null)).toBeNull();
    }
  });

  it('allows palm mute and let ring on a pitched staff', () => {
    // Design Part 4 names bend, slide, tap and harmonics as the fretted-only techniques.
    expect(editRefusal(doc(), [ref(1)], { family: 'beat', key: 'isPalmMute' }, null)).toBeNull();
    expect(editRefusal(doc(), [ref(1)], { family: 'beat', key: 'isLetRing' }, null)).toBeNull();
    expect(editRefusal(doc(), [ref(1)], { family: 'note', key: 'isPalmMute' }, null)).toBeNull();
    expect(editRefusal(doc(), [ref(1)], { family: 'note', key: 'isLetRing' }, null)).toBeNull();
  });

  it('refuses the whole press when any of it reaches a second voice', () => {
    // Bar filling measures voice 1 only, so an edit there could not keep its bar honest.
    const second: BeatRef = { ...ref(0), voiceIndex: 1 };

    expect(editRefusal(doc(), [ref(0), second], { family: 'beat', key: 'duration' }, null)).toMatch(/second voice/i);
    expect(editRefusal(doc(), [second], { family: 'note', key: 'isGhost' }, null)).toMatch(/second voice/i);
  });

  it('refuses the whole range when any of it is a generated track', () => {
    const score = doc();
    score.tracks[1].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(editRefusal(score, [ref(0), ref(1)], { family: 'beat', key: 'dynamics' }, null)).toMatch(/progression/i);
    expect(editRefusal(score, [], { family: 'track', trackIndex: 1 }, null)).toMatch(/progression/i);
  });

  describe('an accidental', () => {
    const accidental = (forced: AccidentalMode): EditScope => ({ family: 'note', key: 'accidental', accidental: forced });

    /** The document with its guitar note moved to `string` and `fret`. */
    function guitarAt(string: number, fret: number): ScoreDoc {
      const score = doc();
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].pitch = { kind: 'fretted', string, fret };
      return score;
    }

    it('is refused on a note it cannot spell - a sharp on a fretted D', () => {
      // String 2 (B, 59) at fret 3 is D, 62. A sharp shifts it to 61, a black key, so
      // alphaTab would take the line from the key signature.
      expect(editRefusal(guitarAt(2, 3), [ref(0)], accidental('sharp'), null)).toMatch(/line/i);
    });

    it('is allowed on a note it can spell - a flat on a fretted B flat', () => {
      // String 3 (G, 55) at fret 3 is B flat, 58. A flat shifts it to 59, B.
      expect(editRefusal(guitarAt(3, 3), [ref(0)], accidental('flat'), null)).toBeNull();
    });

    it('reads a fretted note under a capo as alphaTab draws it, capo included', () => {
      // Fret 2 on string 2 is C sharp without a capo and D with one.
      const score = guitarAt(2, 2);
      expect(editRefusal(score, [ref(0)], accidental('sharp'), null)).toBeNull();

      score.tracks[0].staves[0].capo = 1;
      expect(editRefusal(score, [ref(0)], accidental('sharp'), null)).toMatch(/line/i);
    });

    it('is never refused as auto, which forces nothing', () => {
      expect(editRefusal(guitarAt(2, 3), [ref(0)], accidental('auto'), null)).toBeNull();
    });

    it('is checked on a pitched staff too', () => {
      // The piano's note is C, pitch class 0. A flat shifts it up to 1, a black key, so it
      // is refused. A sharp shifts it down to 11, B - a B sharp, on the B line - so it is not:
      // what is refused is an overshoot onto a black key, not a sharp on a white one.
      const score = doc();
      expect(editRefusal(score, [ref(1)], accidental('flat'), null)).toMatch(/line/i);
      expect(editRefusal(score, [ref(1)], accidental('sharp'), null)).toBeNull();

      // C sharp is 1. A flat shifts it up to 2, D - a D flat.
      score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].pitch = { kind: 'pitched', noteValue: 1, octave: 4 };
      expect(editRefusal(score, [ref(1)], accidental('flat'), null)).toBeNull();
    });

    it('checks only the focused note of a chord on one beat, and every note of a range', () => {
      // String 3 (G, 55) at fret 3 is B flat, 58: a flat shifts it to 59, B. String 2 (B, 59)
      // at fret 3 is D, 62: a flat shifts it to 63, a black key. Focus 2 is tab string 3.
      const score = guitarAt(3, 3);
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.push(
        { pitch: { kind: 'fretted', string: 2, fret: 3 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }
      );

      expect(editRefusal(score, [ref(0)], accidental('flat'), 2)).toBeNull();
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/line/i);
      // A range means every note in it, focus or not - here the chord and the rest after it - and
      // the reason says so: one note in it cannot be spelled, not the one under the caret.
      expect(editRefusal(score, [ref(0), ref(0, 1)], accidental('flat'), 2)).toMatch(/a note[\s\S]*line/i);
    });

    it('subtracts a display transposition, as alphaTab draws it', () => {
      // `Note.displayValue` is the sounding value less `displayTranspositionPitch`, so with 1
      // the fretted B flat, 58, is drawn as an A, 57, and a flat shifts that to 58, a black
      // key. Added instead, it would be drawn from 59, B, and a flat would shift that to 60,
      // C - still allowed, which is how this spec tells the two signs apart.
      const score = guitarAt(3, 3);
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toBeNull();

      score.tracks[0].staves[0].displayTranspose = 1;
      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/line/i);
    });

    it('is refused on a natural harmonic, which is not drawn at its fret', () => {
      // The B flat a flat is allowed on above. The mapper writes `harmonicType` and not
      // `harmonicValue`, so alphaTab draws a natural harmonic at the open string's pitch - G,
      // 55, whose flat would land on 56, a black key - and not at the fret the check reads.
      const score = guitarAt(3, 3);
      score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

      expect(editRefusal(score, [ref(0)], accidental('flat'), null)).toMatch(/harmonic/i);
    });

    it('is not refused on a pitched note marked as a natural harmonic, which is drawn at its pitch', () => {
      // alphaTab moves a natural harmonic only on a stringed note (`isStringed`), so the
      // piano's C is drawn as C and a sharp spells it as B sharp, as above.
      const score = doc();
      score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

      expect(editRefusal(score, [ref(1)], accidental('sharp'), null)).toBeNull();
    });
  });
});

describe('durationRefusal', () => {
  it('refuses a press on nothing but grace beats, saying alphaTab sets their value', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[1].effects.grace = 'beforeBeat';

    expect(durationRefusal(score, [ref(0, 1)])).toMatch(/grace/i);
  });

  it('lets a range with some graces through, since those are skipped', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[1].effects.grace = 'beforeBeat';

    expect(durationRefusal(score, [ref(0, 0), ref(0, 1)])).toBeNull();
  });

  it('refuses a generated track as any beat edit does', () => {
    const score = doc();
    score.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };

    expect(durationRefusal(score, [ref(0)])).toMatch(/progression/i);
  });
});

describe('noteEffectRefusal', () => {
  /** The guitar note at beat 0 followed, at beat 1, by a note on string 1 too. */
  function withFollower(): ScoreDoc {
    const score = doc();
    const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[1];
    beat.isRest = false;
    beat.notes = [{ pitch: { kind: 'fretted', string: 1, fret: 2 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    return score;
  }

  it('refuses a hammer-on with nothing to land on, saying so', () => {
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'isHammerPullOrigin', true, false)).toMatch(/land/i);
  });

  it('allows a hammer-on with a note after it on the string', () => {
    expect(noteEffectRefusal(withFollower(), [ref(0)], null, 'isHammerPullOrigin', true, false)).toBeNull();
  });

  it('refuses a legato or shift slide with nothing to land on, and not a slide out', () => {
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'legatoSlide', 'none')).toMatch(/land/i);
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'shiftSlide', 'none')).toMatch(/land/i);
    expect(noteEffectRefusal(doc(), [ref(0)], null, 'slide', 'slideOutUp', 'none')).toBeNull();
  });

  it('lets a press that clears a hammer-on through, landing or not', () => {
    const score = doc();
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].effects.isHammerPullOrigin = true;

    expect(noteEffectRefusal(score, [ref(0)], null, 'isHammerPullOrigin', true, false)).toBeNull();
  });

  it('refuses a hammer-on on a pitched staff as a fretted technique', () => {
    expect(noteEffectRefusal(doc(), [ref(1)], null, 'isHammerPullOrigin', true, false)).toMatch(/fretted/i);
  });

  it('lets a press that clears a natural harmonic through on a pitched staff, and refuses one that sets it', () => {
    const score = doc();
    score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].effects.harmonic = 'natural';

    expect(noteEffectRefusal(score, [ref(1)], null, 'harmonic', 'natural', 'none')).toBeNull();
    expect(noteEffectRefusal(score, [ref(1)], null, 'harmonic', 'artificial', 'none')).toMatch(/fretted/i);
  });

  it('refuses vibrato on a tied note either way, saying it belongs to the note it is tied from', () => {
    const score = withFollower();
    const tied = score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0];
    tied.isTied = true;

    expect(noteEffectRefusal(score, [ref(0, 1)], null, 'vibrato', 'slight', 'none')).toMatch(/tied from/i);
    tied.effects.vibrato = 'slight';
    expect(noteEffectRefusal(score, [ref(0, 1)], null, 'vibrato', 'slight', 'none')).toMatch(/tied from/i);
  });

  it('still refuses a rest and a generated track', () => {
    expect(noteEffectRefusal(doc(), [ref(0, 2)], null, 'isGhost', true, false)).toMatch(/note/i);
    const score = doc();
    score.tracks[0].generated = { progressionId: 'p', progressionName: 'Verse', source: { kind: 'revision', revision: 1 } };
    expect(noteEffectRefusal(score, [ref(0)], null, 'isGhost', true, false)).toMatch(/progression/i);
  });
});
