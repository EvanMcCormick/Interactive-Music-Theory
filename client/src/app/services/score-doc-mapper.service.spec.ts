import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDocMapperService } from './score-doc-mapper.service';
import { AlphaTexService } from './alpha-tex.service';
import {
  BeatDoc,
  MasterBarDoc,
  ScoreDoc,
  STANDARD_GUITAR_TUNING,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
  createRestBeat
} from '../models/composer.model';

function pitchedBeat(noteValue: number, octave: number): BeatDoc {
  return {
    duration: 4,
    dots: 0,
    tuplet: null,
    isRest: false,
    notes: [
      {
        pitch: { kind: 'pitched', noteValue, octave },
        isTied: false,
        accidental: 'auto',
        effects: createDefaultNoteEffects()
      }
    ],
    dynamics: null,
    lyrics: null,
    text: null,
    effects: createDefaultBeatEffects()
  };
}

function frettedBeat(string: number, fret: number): BeatDoc {
  return {
    duration: 4,
    dots: 0,
    tuplet: null,
    isRest: false,
    notes: [
      {
        pitch: { kind: 'fretted', string, fret },
        isTied: false,
        accidental: 'auto',
        effects: createDefaultNoteEffects()
      }
    ],
    dynamics: null,
    lyrics: null,
    text: null,
    effects: createDefaultBeatEffects()
  };
}

function buildDoc(): ScoreDoc {
  const threeFour: MasterBarDoc = {
    ...createDefaultMasterBar(),
    timeSignature: { numerator: 3, denominator: 4, isCommon: false }
  };

  return {
    title: 'Verify',
    subTitle: '',
    artist: 'Spec',
    album: '',
    tempo: 100,
    masterBars: [threeFour, createDefaultMasterBar()],
    tracks: [
      {
        id: 't1',
        name: 'Piano',
        shortName: 'Pno',
        color: '#3498db',
        playback: createDefaultPlaybackInfo(0),
        staves: [
          {
            tuning: [],
            tuningLabel: '',
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
                keySignature: { fifths: 2, mode: 'major' },
                voices: [{ beats: [pitchedBeat(0, 4), pitchedBeat(4, 4), pitchedBeat(7, 4)] }]
              },
              {
                clef: 'g2',
                clefOttava: 'regular',
                keySignature: { fifths: 2, mode: 'major' },
                voices: [{ beats: [pitchedBeat(9, 4), createRestBeat(4), pitchedBeat(0, 5)] }]
              }
            ]
          }
        ]
      },
      {
        id: 't2',
        name: 'Guitar',
        shortName: 'Gtr',
        color: '#e74c3c',
        playback: createDefaultPlaybackInfo(25),
        staves: [
          {
            tuning: STANDARD_GUITAR_TUNING.slice(),
            tuningLabel: 'Guitar Standard Tuning',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: true,
            showSlash: false,
            showNumbered: false,
            bars: [
              {
                clef: 'g2',
                clefOttava: 'regular',
                keySignature: { fifths: 2, mode: 'major' },
                voices: [{ beats: [frettedBeat(3, 0), frettedBeat(3, 2), frettedBeat(6, 0)] }]
              },
              {
                clef: 'g2',
                clefOttava: 'regular',
                keySignature: { fifths: 2, mode: 'major' },
                voices: [{ beats: [frettedBeat(1, 0), frettedBeat(1, 2), createRestBeat(4)] }]
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('ScoreDocMapperService', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;
  let settings: alphaTab.Settings;
  let doc: ScoreDoc;
  let score: alphaTab.model.Score;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
    settings = new alphaTab.Settings();
    doc = buildDoc();
    score = mapper.toScore(doc, settings);
  });

  describe('score metadata', () => {
    it('carries title and artist across', () => {
      expect(score.title).toBe('Verify');
      expect(score.artist).toBe('Spec');
    });

    it('writes the initial tempo as a master bar automation', () => {
      // Score.tempo is a read-only getter derived from the first master bar.
      expect(score.tempo).toBe(100);
    });

    it('creates one track per TrackDoc', () => {
      expect(score.tracks.length).toBe(2);
    });
  });

  describe('bar timeline', () => {
    it('applies an explicit time signature', () => {
      expect(score.masterBars[0].timeSignatureNumerator).toBe(3);
      expect(score.masterBars[0].timeSignatureDenominator).toBe(4);
    });

    it('inherits the previous time signature when the doc leaves it null', () => {
      expect(score.masterBars[1].timeSignatureNumerator).toBe(3);
      expect(score.masterBars[1].timeSignatureDenominator).toBe(4);
    });

    it('puts the key signature on the bar, not the master bar', () => {
      // D major is two sharps. alphaTab deprecates MasterBar.keySignature in
      // favour of bar-level keys so transposing instruments work.
      expect(score.tracks[0].staves[0].bars[0].keySignature as number).toBe(2);
    });
  });

  describe('octave convention', () => {
    // alphaTab stores octaves one higher than scientific pitch notation.
    it('maps scientific C4 to MIDI 60 (middle C)', () => {
      const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
      expect(note.octave).toBe(5);
      expect(note.realValue).toBe(60);
    });

    it('maps scientific A4 to MIDI 69 (concert A)', () => {
      const note = score.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0];
      expect(note.realValue).toBe(69);
    });

    it('maps scientific C5 to MIDI 72', () => {
      const note = score.tracks[0].staves[0].bars[1].voices[0].beats[2].notes[0];
      expect(note.realValue).toBe(72);
    });
  });

  describe('string numbering', () => {
    // alphaTab numbers strings from the LOWEST pitch; tab notation numbers them
    // from the highest. ScoreDoc uses the tab convention and the mapper flips.
    it('treats doc string 1 as the high E', () => {
      const beats = score.tracks[1].staves[0].bars[1].voices[0].beats;
      expect(beats[0].notes[0].realValue).toBe(64); // E4
      expect(beats[1].notes[0].realValue).toBe(66); // F#4
    });

    it('treats doc string 6 as the low E', () => {
      const beats = score.tracks[1].staves[0].bars[0].voices[0].beats;
      expect(beats[2].notes[0].realValue).toBe(40); // E2
    });

    it('treats doc string 3 as G', () => {
      const beats = score.tracks[1].staves[0].bars[0].voices[0].beats;
      expect(beats[0].notes[0].realValue).toBe(55); // G3
      expect(beats[1].notes[0].realValue).toBe(57); // A3
    });

    it('preserves the tuning and tablature flag', () => {
      expect(score.tracks[1].staves[0].stringTuning.tunings).toEqual(STANDARD_GUITAR_TUNING);
      expect(score.tracks[1].staves[0].showTablature).toBeTrue();
    });
  });

  describe('rests', () => {
    it('represents a rest as a beat with no notes', () => {
      expect(score.tracks[0].staves[0].bars[1].voices[0].beats[1].notes.length).toBe(0);
    });
  });

  describe('alphaTex round-trip', () => {
    it('is byte-stable across export, parse and re-export', () => {
      const first = tex.export(score);
      const parsed = tex.parse(first);

      expect(parsed.score).withContext('tex should parse').not.toBeNull();
      expect(tex.export(parsed.score!)).toBe(first);
    });

    it('preserves musical content back into a ScoreDoc', () => {
      const parsed = tex.parse(tex.export(score));
      const back = mapper.toDoc(parsed.score!);

      expect(back.title).toBe('Verify');
      expect(back.tempo).toBe(100);
      expect(back.tracks.length).toBe(2);
      expect(back.masterBars.length).toBe(2);
      expect(back.masterBars[0].timeSignature).toEqual({
        numerator: 3,
        denominator: 4,
        isCommon: false
      });
      expect(back.tracks[0].staves[0].bars[0].keySignature).toEqual({
        fifths: 2,
        mode: 'major'
      });
    });

    it('preserves pitched notes in scientific notation', () => {
      const parsed = tex.parse(tex.export(score));
      const back = mapper.toDoc(parsed.score!);

      expect(back.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].pitch).toEqual({
        kind: 'pitched',
        noteValue: 0,
        octave: 4
      });
    });

    it('preserves fretted notes in tab string numbering', () => {
      const parsed = tex.parse(tex.export(score));
      const back = mapper.toDoc(parsed.score!);

      expect(back.tracks[1].staves[0].bars[1].voices[0].beats[1].notes[0].pitch).toEqual({
        kind: 'fretted',
        string: 1,
        fret: 2
      });
    });

    it('preserves rests', () => {
      const parsed = tex.parse(tex.export(score));
      const back = mapper.toDoc(parsed.score!);

      expect(back.tracks[0].staves[0].bars[1].voices[0].beats[1].isRest).toBeTrue();
    });
  });
});

describe('AlphaTexService diagnostics', () => {
  let tex: AlphaTexService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    tex = TestBed.inject(AlphaTexService);
  });

  it('returns a null score and diagnostics for invalid alphaTex', () => {
    const result = tex.parse('\\notARealDirective (((');

    expect(result.score).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('reports a source position for each diagnostic', () => {
    const result = tex.parse('\\notARealDirective (((');

    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.line).toBeGreaterThanOrEqual(1);
      expect(diagnostic.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('truncates the very long enumerating messages alphaTab can produce', () => {
    const result = tex.parse('\\notARealDirective (((');

    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message.length).toBeLessThanOrEqual(243);
    }
  });

  it('parses valid alphaTex into a score', () => {
    const result = tex.parse(':4 3.3 5.3 | r.1');

    expect(result.score).not.toBeNull();
    expect(result.score!.masterBars.length).toBe(2);
  });
});
