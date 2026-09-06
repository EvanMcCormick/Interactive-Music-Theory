import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import {
  BeatDoc,
  ScoreDoc,
  STANDARD_BASS_TUNING,
  createDefaultBeatEffects,
  createDefaultMasterBar,
  createDefaultNoteEffects,
  createDefaultPlaybackInfo,
  createRestBeat
} from '../models/composer.model';
import { ScoreDocMapperService } from './score-doc-mapper.service';

/**
 * The rest-only accompanying voice, and why it is not drawn.
 *
 * `buildPreviewDoc` has to give *every* bar the ghost voice or none of them:
 * alphaTab's `Voice._chain` reads `bar.nextBar.voices[this.index]` unchecked,
 * so a bar carrying voice 2 followed by one that does not throws out of
 * `Score.finish` before a single glyph exists. The document therefore cannot
 * express "no ghosts in this bar", and every discard-free bar arrives carrying
 * a full bar of rests that alphaTab duly draws as a grey rest under the staff.
 *
 * The mapper is where that is answered, because it is the renderer's question
 * rather than the document's.
 */

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

const fourRests = (): BeatDoc[] => [
  createRestBeat(4),
  createRestBeat(4),
  createRestBeat(4),
  createRestBeat(4)
];

/**
 * Two bars, each with two voices.
 *
 * Bar 0's second voice carries a note; bar 1's is nothing but rests, which is
 * exactly the shape a preview of a two-bar score with one discard produces.
 * Voice 1 of bar 1 is also rest-only, to pin that an ordinary empty bar in the
 * composer keeps drawing its rests.
 */
function buildDoc(): ScoreDoc {
  const bar = (voices: BeatDoc[][]) => ({
    clef: 'f4' as const,
    clefOttava: 'regular' as const,
    keySignature: { fifths: 0, mode: 'major' as const },
    voices: voices.map(beats => ({ beats }))
  });

  return {
    title: 'Ghosts',
    subTitle: '',
    artist: '',
    album: '',
    tempo: 120,
    masterBars: [createDefaultMasterBar(), createDefaultMasterBar()],
    tracks: [
      {
        id: 't1',
        name: 'Bass',
        shortName: 'Bs',
        color: '#3498db',
        playback: createDefaultPlaybackInfo(33),
        staves: [
          {
            tuning: STANDARD_BASS_TUNING.slice(),
            tuningLabel: 'Bass Standard Tuning',
            capo: 0,
            transpose: 0,
            displayTranspose: 0,
            showStandardNotation: true,
            showTablature: true,
            showSlash: false,
            showNumbered: false,
            bars: [
              bar([
                [frettedBeat(4, 3), createRestBeat(4), createRestBeat(4), createRestBeat(4)],
                [createRestBeat(4), frettedBeat(3, 5), createRestBeat(4), createRestBeat(4)]
              ]),
              // Bar 1 discarded nothing, so its ghost voice is a bar of rests.
              bar([fourRests(), fourRests()])
            ]
          }
        ]
      }
    ]
  };
}

describe('ScoreDocMapperService accompanying voices', () => {
  let mapper: ScoreDocMapperService;
  let score: alphaTab.model.Score;

  function barAt(index: number): alphaTab.model.Bar {
    return score.tracks[0].staves[0].bars[index];
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    score = mapper.toScore(buildDoc(), new alphaTab.Settings());
  });

  it('keeps a rest-only second voice out of the bar it would clutter', () => {
    expect(barAt(1).filledVoices.has(1)).toBeFalse();
  });

  it('still draws a second voice that has something to say', () => {
    expect(barAt(0).filledVoices.has(1)).toBeTrue();
  });

  it('leaves the second voice in the model, which is what stops the crash', () => {
    // `Voice._chain` dereferences `nextBar.voices[this.index]`. Removing the
    // voice rather than emptying it is what would throw.
    expect(barAt(1).voices.length).toBe(2);
    expect(barAt(1).voices[1].beats.length).toBe(4);
  });

  it('never hides the first voice, so an empty composer bar keeps its rests', () => {
    expect(barAt(1).filledVoices.has(0)).toBeTrue();
    expect(barAt(1).voices[0].beats.every(beat => beat.isEmpty)).toBeFalse();
  });

  it('renders a two-bar preview without alphaTab chaining off the end', () => {
    // The whole reason every bar carries the voice. `score.finish` already ran
    // in `toScore`; this asserts it got through the last bar's chain.
    expect(score.masterBars.length).toBe(2);
    expect(barAt(0).voices[1].beats[0].nextBeat).not.toBeNull();
  });
});
