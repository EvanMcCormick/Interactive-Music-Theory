import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { AlphaTexService } from './alpha-tex.service';
import { ComposerService } from './composer.service';
import { DEFAULT_TRILL_SPEED, TUPLET_CHOICES, defaultFermata, fullBendPoints } from './composer-tool-defaults';
import { toggleTrill } from './note-edits';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { BeatDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * The values the palette applies until M4's editors, each through the path a save and a load take.
 * A default alphaTab reshapes or drops would put a mark on the page that a reload takes away.
 */
describe('composer tool defaults', () => {
  let mapper: ScoreDocMapperService;
  let tex: AlphaTexService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
    tex = TestBed.inject(AlphaTexService);
  });

  /** `doc` as a save and a load hand it back. */
  function throughTex(doc: ScoreDoc): ScoreDoc {
    const parsed = tex.parse(tex.export(mapper.toScore(doc, new alphaTab.Settings())));
    if (!parsed.score) throw new Error('exported alphaTex did not parse');
    return mapper.toDoc(parsed.score);
  }

  /** An empty score whose guitar's first beat is fret 5 on the G string, with a piano whose first beat is C4. */
  function scoreWithNotes(): ScoreDoc {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const guitar = doc.tracks[0].staves[0].bars[0].voices[0].beats[0];
    guitar.isRest = false;
    guitar.notes = [{ pitch: { kind: 'fretted', string: 3, fret: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    const piano = doc.tracks[1].staves[0].bars[0].voices[0].beats[0];
    piano.isRest = false;
    piano.notes = [{ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    return doc;
  }

  const firstBeat = (doc: ScoreDoc, trackIndex: number): BeatDoc => doc.tracks[trackIndex].staves[0].bars[0].voices[0].beats[0];

  it('bends a whole tone in a shape alphaTab keeps through a save', () => {
    const doc = scoreWithNotes();
    firstBeat(doc, 0).notes[0].effects.bendPoints = fullBendPoints();

    expect(firstBeat(throughTex(doc), 0).notes[0].effects.bendPoints).toEqual(fullBendPoints());
  });

  it('keeps the default fermata through a save', () => {
    const doc = scoreWithNotes();
    firstBeat(doc, 0).effects.fermata = defaultFermata();

    expect(firstBeat(throughTex(doc), 0).effects.fermata).toEqual(defaultFermata());
  });

  it('keeps every offered tuplet through a save', () => {
    for (const tuplet of TUPLET_CHOICES) {
      const doc = scoreWithNotes();
      firstBeat(doc, 0).tuplet = { ...tuplet };

      expect(firstBeat(throughTex(doc), 0).tuplet).withContext(`${tuplet.numerator}:${tuplet.denominator}`).toEqual({ ...tuplet });
    }
  });

  it('trills a whole step above a fretted note and a pitched one, and both survive a save', () => {
    const doc = scoreWithNotes();
    const at = (trackIndex: number) => ({ trackIndex, staffIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 });
    toggleTrill(doc, [at(0)], null);
    toggleTrill(doc, [at(1)], null);

    // The G string is 55, so fret 5 is C4, 60, and a whole step above is 62; the piano's C4 likewise.
    const back = throughTex(doc);
    expect(firstBeat(back, 0).notes[0].effects.trill).toEqual({ value: 62, speed: DEFAULT_TRILL_SPEED });
    expect(firstBeat(back, 1).notes[0].effects.trill).toEqual({ value: 62, speed: DEFAULT_TRILL_SPEED });
  });
});
