import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ScoreDocMapperService } from './score-doc-mapper.service';
import { AlphaTexService } from './alpha-tex.service';
import {
  BeatDoc,
  NoteDoc,
  ScoreDoc,
  STANDARD_GUITAR_TUNING,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo
} from '../models/composer.model';

/**
 * Every effect the composer palette can set, through the path a save and a load take:
 * `toScore`, alphaTex export, parse, `toDoc`.
 *
 * Save stores alphaTex made from the mapper's output, so a field the mapper drops is not
 * a rendering glitch but permanent loss. Each spec here was red before its task, and the
 * one that stays a loss - the double bar - is pinned as a loss, so an alphaTab upgrade
 * that fixes it fails a spec rather than going unnoticed.
 */
describe('ScoreDocMapperService effects round trip', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;
  let settings: alphaTab.Settings;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
    settings = new alphaTab.Settings();
  });

  /** A note on `string` (tab numbering, 1 = high E) at `fret`, with no effects. */
  function fretted(string: number, fret: number): NoteDoc {
    return {
      pitch: { kind: 'fretted', string, fret },
      isTied: false,
      accidental: 'auto',
      effects: createDefaultNoteEffects()
    };
  }

  /** A quarter-note beat holding `notes`, with no effects. */
  function quarter(notes: NoteDoc[]): BeatDoc {
    return {
      duration: 4,
      dots: 0,
      tuplet: null,
      isRest: notes.length === 0,
      notes,
      dynamics: null,
      lyrics: null,
      text: null,
      effects: createDefaultBeatEffects()
    };
  }

  /**
   * One full 4/4 bar on a guitar staff: four quarters on the G string, frets 5 to 8.
   * `edit` changes it before it is mapped. Four notes on one string, because a hammer-on
   * and a slide both want a following note to land on.
   */
  function guitarBar(edit: (beats: BeatDoc[]) => void): ScoreDoc {
    const beats = [5, 6, 7, 8].map(fret => quarter([fretted(3, fret)]));
    edit(beats);
    return {
      title: 'Effects',
      subTitle: '',
      artist: '',
      album: '',
      tempo: 120,
      masterBars: [
        { ...createDefaultMasterBar(), timeSignature: { numerator: 4, denominator: 4, isCommon: true } }
      ],
      tracks: [
        {
          id: 'gtr',
          name: 'Guitar',
          shortName: 'gtr',
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
                  keySignature: { fifths: 0, mode: 'major' },
                  voices: [{ beats }]
                }
              ]
            }
          ],
          generated: null
        }
      ]
    };
  }

  /** The document as a save and a load would hand it back. */
  function throughTex(doc: ScoreDoc): ScoreDoc {
    const parsed = tex.parse(tex.export(mapper.toScore(doc, settings)));
    if (!parsed.score) throw new Error('exported alphaTex did not parse');
    return mapper.toDoc(parsed.score);
  }

  /** The first bar's beats. */
  function beatsOf(doc: ScoreDoc): BeatDoc[] {
    return doc.tracks[0].staves[0].bars[0].voices[0].beats;
  }

  it('keeps a hammer-on on its origin, and only there', () => {
    const doc = guitarBar(beats => (beats[0].notes[0].effects.isHammerPullOrigin = true));

    const back = beatsOf(throughTex(doc));
    expect(back[0].notes[0].effects.isHammerPullOrigin).toBeTrue();
    expect(back[1].notes[0].effects.isHammerPullOrigin).toBeFalse();
  });

  it('loses a hammer-on with nothing to land on - alphaTab clears it', () => {
    // `Note.finish` clears an origin with no destination: no note on the same string, and
    // no left-hand-tapped note on another, within three bars. The last beat has neither, so
    // the flag is gone before a character of alphaTex is written. Pinned so the loss stays
    // visible, and so M2's hammer-on tool has to decide what to do about it.
    const doc = guitarBar(beats => (beats[3].notes[0].effects.isHammerPullOrigin = true));

    expect(beatsOf(throughTex(doc))[3].notes[0].effects.isHammerPullOrigin).toBeFalse();
  });

  for (const slide of ['shiftSlide', 'legatoSlide', 'slideInBelow', 'slideOutUp'] as const) {
    it(`keeps a ${slide}`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.slide = slide));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.slide).toBe(slide);
    });
  }

  for (const slide of ['shiftSlide', 'legatoSlide'] as const) {
    it(`loses a ${slide} with nothing to land on - alphaTab clears it`, () => {
      // `Note.finish` resets a shift or legato slide to none when no note follows on the
      // same string within three bars, as it does a hammer-on. The last beat has none.
      const doc = guitarBar(beats => (beats[3].notes[0].effects.slide = slide));

      expect(beatsOf(throughTex(doc))[3].notes[0].effects.slide).toBe('none');
    });
  }

  it('keeps a bend as positioned points', () => {
    const points = [{ offset: 0, value: 0 }, { offset: 60, value: 4 }];
    const doc = guitarBar(beats => (beats[0].notes[0].effects.bendPoints = points));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.bendPoints).toEqual(points);
  });

  it("stores a bend in the shape alphaTab keeps - a rising bend's middle point goes", () => {
    // `Note.finish` classifies a custom bend of two to four points as one of Guitar Pro's
    // bend types and rewrites its points to fit, before a character of alphaTex is written.
    // This curve reaches a semitone three quarters of the way through and a whole tone at
    // the end. alphaTab calls it a plain Bend and keeps only its ends, so the curve's timing
    // is lost - a real point, not a redundant one. Pinned because the model's contract is
    // alphaTab's shape, not the curve as drawn, and so M4's bend curve editor knows it.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.bendPoints = [
      { offset: 0, value: 0 }, { offset: 45, value: 2 }, { offset: 60, value: 4 }
    ]));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.bendPoints)
      .toEqual([{ offset: 0, value: 0 }, { offset: 60, value: 4 }]);
  });

  for (const accent of ['normal', 'heavy', 'tenuto'] as const) {
    it(`keeps a ${accent} accent`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.accent = accent));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.accent).toBe(accent);
    });
  }

  it('keeps staccato and an accent together on one note', () => {
    // Separate fields in alphaTab, so neither may clear the other - a palette that made
    // them exclusive would be wrong.
    const doc = guitarBar(beats => {
      beats[0].notes[0].effects.isStaccato = true;
      beats[0].notes[0].effects.accent = 'heavy';
    });

    const effects = beatsOf(throughTex(doc))[0].notes[0].effects;
    expect(effects.isStaccato).toBeTrue();
    expect(effects.accent).toBe('heavy');
  });

  for (const vibrato of ['slight', 'wide'] as const) {
    it(`keeps a ${vibrato} vibrato on a note`, () => {
      const doc = guitarBar(beats => (beats[0].notes[0].effects.vibrato = vibrato));

      expect(beatsOf(throughTex(doc))[0].notes[0].effects.vibrato).toBe(vibrato);
    });

    it(`keeps a ${vibrato} vibrato on a beat`, () => {
      const doc = guitarBar(beats => (beats[0].effects.vibrato = vibrato));

      expect(beatsOf(throughTex(doc))[0].effects.vibrato).toBe(vibrato);
    });
  }

  it('keeps beat and note vibrato apart on one beat', () => {
    // alphaTex writes both as `v`/`vw` and tells them apart only by position - a note
    // property or a beat property - so a regression that let one overwrite the other would
    // pass every spec that sets only one.
    const doc = guitarBar(beats => {
      beats[0].effects.vibrato = 'wide';
      beats[0].notes[0].effects.vibrato = 'slight';
    });

    const back = beatsOf(throughTex(doc))[0];
    expect(back.effects.vibrato).toBe('wide');
    expect(back.notes[0].effects.vibrato).toBe('slight');
  });

  it('keeps a left-hand tap', () => {
    const doc = guitarBar(beats => (beats[0].notes[0].effects.isLeftHandTapped = true));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.isLeftHandTapped).toBeTrue();
  });

  it('keeps a trill with its speed', () => {
    // `value` is alphaTab's absolute trill value, not a fret - see TrillDoc.
    const doc = guitarBar(beats => (beats[0].notes[0].effects.trill = { value: 7, speed: 16 }));

    expect(beatsOf(throughTex(doc))[0].notes[0].effects.trill).toEqual({ value: 7, speed: 16 });
  });

  it('keeps fingering for both hands', () => {
    const doc = guitarBar(beats => {
      beats[0].notes[0].effects.leftHandFinger = 'middle';
      beats[0].notes[0].effects.rightHandFinger = 'index';
    });

    const effects = beatsOf(throughTex(doc))[0].notes[0].effects;
    expect(effects.leftHandFinger).toBe('middle');
    expect(effects.rightHandFinger).toBe('index');
  });

  // <!-- A7 -->
});
