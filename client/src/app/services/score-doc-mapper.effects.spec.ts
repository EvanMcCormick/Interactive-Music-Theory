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

  // <!-- A2 -->
});
