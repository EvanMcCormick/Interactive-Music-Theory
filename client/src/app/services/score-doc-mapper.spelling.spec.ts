import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import {
  NoteLetter,
  NotePitch,
  ScoreDoc,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * The letter a note asks to be engraved on, and how the mapper says it in
 * alphaTab's terms.
 *
 * `NoteAccidentalMode` is the only channel alphaTab offers, and its doc
 * comments describe a displacement relative to a default position they never
 * state. The behaviour the mapping rests on was therefore read out of the
 * bundle - `AccidentalHelper.getNoteValue` in
 * `@coderline/alphatab/dist/alphaTab.core.mjs`, around line 24936 - which
 * displaces the note by exactly the forced accidental and then draws *that*
 * value's line under the key signature, with the forced glyph.
 *
 * That is a dependency's internal, so the first spec here asserts it directly
 * rather than trusting it: the displaced value must be the target letter's
 * natural pitch, always a white key, which is the whole reason the mapping
 * needs no key. `AccidentalHelper` is not exported from the package, so
 * `displacedValue` below mirrors it; if alphaTab ever changes the displacement,
 * that spec is what says so.
 */

/** Semitones above C of each letter's natural pitch. All white keys. */
const NATURAL: Record<NoteLetter, number> =
  { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const LETTERS: NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** How far a pitch class sits from a letter's natural pitch, normalised into ±6. */
function normalisedAlter(pitchClass: number, natural: number): number {
  return ((((pitchClass - natural + 6) % 12) + 12) % 12) - 6;
}

/**
 * `AccidentalHelper.getNoteValue`, mirrored.
 *
 * Reads `displayValue` because that is what the helper reads - the note has to
 * be attached to a beat, voice, bar and staff for it to resolve, which is why
 * every note here comes back out of a mapped score rather than being built bare.
 */
function displacedValue(note: alphaTab.model.Note): number {
  switch (note.accidentalMode) {
    case alphaTab.model.NoteAccidentalMode.ForceDoubleFlat:
      return note.displayValue + 2;
    case alphaTab.model.NoteAccidentalMode.ForceFlat:
      return note.displayValue + 1;
    case alphaTab.model.NoteAccidentalMode.ForceSharp:
      return note.displayValue - 1;
    case alphaTab.model.NoteAccidentalMode.ForceDoubleSharp:
      return note.displayValue - 2;
    default:
      return note.displayValue;
  }
}

/** One unfretted whole note in one bar, shaped as the progression's projection is. */
function buildDoc(pitch: NotePitch): ScoreDoc {
  return {
    title: 'Spelling',
    subTitle: '',
    artist: '',
    album: '',
    tempo: 120,
    masterBars: [createDefaultMasterBar()],
    tracks: [
      {
        id: 'piano',
        name: 'Piano',
        shortName: 'Pno',
        color: '#2c3e50',
        playback: createDefaultPlaybackInfo(0),
        staves: [
          {
            // Empty, which is what marks the staff as unfretted.
            tuning: [],
            tuningLabel: 'Piano',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: false,
            showSlash: false,
            showNumbered: false,
            bars: [
              {
                clef: 'g2',
                clefOttava: 'regular',
                keySignature: { fifths: 0, mode: 'major' },
                voices: [
                  {
                    beats: [
                      {
                        duration: 1,
                        dots: 0,
                        tuplet: null,
                        isRest: false,
                        notes: [
                          {
                            pitch,
                            isTied: false,
                            accidental: 'auto',
                            effects: createDefaultNoteEffects()
                          }
                        ],
                        dynamics: null,
                        lyrics: null,
                        text: null,
                        effects: createDefaultBeatEffects()
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('ScoreDocMapperService spelling', () => {
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  function mapOneNote(pitch: NotePitch): alphaTab.model.Note {
    const score = mapper.toScore(buildDoc(pitch), new alphaTab.Settings());
    return score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  }

  function roundTrip(pitch: NotePitch): NotePitch {
    const score = mapper.toScore(buildDoc(pitch), new alphaTab.Settings());
    return mapper.toDoc(score).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0]
      .pitch;
  }

  it('displaces a forced note onto the letter its spelling names', () => {
    for (const letter of LETTERS) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        if (Math.abs(normalisedAlter(pitchClass, NATURAL[letter])) > 2) continue;

        const note = mapOneNote({ kind: 'pitched', noteValue: pitchClass, octave: 4, letter });
        // AccidentalHelper displaces by the forced accidental and draws THAT
        // value's line. The displaced value must be the letter's natural pitch,
        // which is always a white key - which is why this is key-independent.
        expect(displacedValue(note) % 12)
          .withContext(`${letter} against pitch class ${pitchClass}`)
          .toBe(NATURAL[letter]);
      }
    }
  });

  it('round-trips every letter that needs an accidental', () => {
    for (const letter of LETTERS) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        const alter = normalisedAlter(pitchClass, NATURAL[letter]);
        if (alter === 0 || Math.abs(alter) > 2) continue;

        const doc: NotePitch = { kind: 'pitched', noteValue: pitchClass, octave: 4, letter };
        expect(roundTrip(doc))
          .withContext(`${letter} against pitch class ${pitchClass}`)
          .toEqual(doc);
      }
    }
  });

  it('reads back a natural letter as no letter, which engraves the same', () => {
    // The one lossy corner, and it costs nothing. A natural forces nothing, so
    // the score carries `Default` and cannot say whether a letter was asked
    // for. It does not matter: alphaTab's step tables put a white pitch class
    // on its own letter under every key signature, so the note the round trip
    // produces still engraves on the letter that was dropped.
    const doc: NotePitch = { kind: 'pitched', noteValue: 4, octave: 4, letter: 'E' };
    const back = roundTrip(doc);

    expect(back).toEqual({ kind: 'pitched', noteValue: 4, octave: 4, letter: undefined });
    expect(displacedValue(mapOneNote(back)) % 12).toBe(NATURAL['E']);
  });

  it('drops a letter more than a double accidental away', () => {
    // C against pitch class 6 is a triple sharp. Not notation, so no letter.
    const note = mapOneNote({ kind: 'pitched', noteValue: 6, octave: 4, letter: 'C' });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });

  it('leaves a note with no letter exactly as it was', () => {
    const note = mapOneNote({ kind: 'pitched', noteValue: 11, octave: 4 });
    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.Default);
  });

  it('lets the letter overrule the accidental flag it subsumes', () => {
    // `accidental: 'explicit'` has always meant ForceSharp; a C flat asks for
    // the opposite. The letter decides, and the flag only speaks without one.
    const doc = buildDoc({ kind: 'pitched', noteValue: 11, octave: 4, letter: 'C' });
    doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].accidental = 'explicit';

    const score = mapper.toScore(doc, new alphaTab.Settings());
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];

    expect(note.accidentalMode).toBe(alphaTab.model.NoteAccidentalMode.ForceFlat);
  });
});
