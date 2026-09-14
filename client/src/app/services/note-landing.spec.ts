import { TestBed } from '@angular/core/testing';
import * as alphaTab from '@coderline/alphatab';

import { ComposerService } from './composer.service';
import { BeatRef } from './composer-selection';
import { hammerDestinationOf, slideTargetOf, tieOriginOf } from './note-landing';
import { ScoreDocMapperService } from './score-doc-mapper.service';
import { insertBarInto } from './score-structure';
import { NoteDoc, ScoreDoc, createDefaultNoteEffects } from '../models/composer.model';

/**
 * The landing rules, checked against alphaTab rather than only against what we believe it does: each
 * layout is finished through the mapper, which runs `Score.finish`, and alphaTab's own answer - does
 * the hammer-on survive, does the slide - must match the predicate's.
 */
describe('note landing', () => {
  let mapper: ScoreDocMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mapper = TestBed.inject(ScoreDocMapperService);
  });

  const ref = (barIndex: number, beatIndex: number, trackIndex = 0): BeatRef =>
    ({ trackIndex, staffIndex: 0, barIndex, voiceIndex: 0, beatIndex });

  /** Puts a fretted note on `string` at bar `bar`, beat `beat`, and returns it. */
  function put(doc: ScoreDoc, bar: number, beat: number, string: number, fret = 5, tapped = false): NoteDoc {
    const target = doc.tracks[0].staves[0].bars[bar].voices[0].beats[beat];
    const note: NoteDoc = { pitch: { kind: 'fretted', string, fret }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() };
    note.effects.isLeftHandTapped = tapped;
    target.isRest = false;
    target.notes.push(note);
    return note;
  }

  /** alphaTab's finished note at the same place as `note` in bar 0, beat 0. */
  function finished(doc: ScoreDoc, noteIndex = 0): alphaTab.model.Note {
    const score = mapper.toScore(doc, new alphaTab.Settings());
    return score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[noteIndex];
  }

  /**
   * Layouts after a note on string 3 at bar 0, beat 0, each named for what follows it. The last four
   * pin the reach: the next bar's first beat lands, its second beat and anything later do not,
   * whatever `_maxOffsetForSameLineSearch` says - see the task for why.
   */
  const layouts: { name: string; build: (doc: ScoreDoc) => void }[] = [
    { name: 'a note on the same string next beat', build: doc => void put(doc, 0, 1, 3) },
    { name: 'a note on the same string at the end of the bar', build: doc => void put(doc, 0, 3, 3) },
    { name: 'nothing at all', build: () => undefined },
    { name: 'a note on another string, not tapped', build: doc => void put(doc, 0, 1, 2) },
    { name: 'a left-hand tap on another string', build: doc => void put(doc, 0, 1, 1, 9, true) },
    { name: 'a left-hand tap on the next bar\'s second beat', build: doc => void put(doc, 1, 1, 1, 9, true) },
    { name: 'a note on the same string on the next bar\'s first beat', build: doc => void put(doc, 1, 0, 3) },
    { name: 'a note on the same string on the next bar\'s second beat', build: doc => void put(doc, 1, 1, 3) },
    { name: 'a note on the same string three bars on', build: doc => void put(doc, 3, 0, 3) },
    { name: 'a note on the same string in a fifth bar', build: doc => {
      insertBarInto(doc, doc.masterBars.length);
      put(doc, 4, 0, 3);
    } }
  ];

  it('lands from a later bar on the bar after it, too', () => {
    const doc = ComposerService.createEmptyScore();
    const note = put(doc, 1, 3, 3);
    note.effects.isHammerPullOrigin = true;
    put(doc, 2, 0, 3);

    const score = mapper.toScore(doc, new alphaTab.Settings());
    expect(hammerDestinationOf(doc, ref(1, 3), note)).not.toBeNull();
    expect(score.tracks[0].staves[0].bars[1].voices[0].beats[3].notes[0].isHammerPullOrigin).toBeTrue();
  });

  it('finds no origin for a tie more than three bars after its note, as alphaTab finds none', () => {
    const doc = ComposerService.createEmptyScore();
    insertBarInto(doc, doc.masterBars.length);
    put(doc, 0, 3, 3);
    const tied = put(doc, 4, 0, 3);
    tied.isTied = true;

    const score = mapper.toScore(doc, new alphaTab.Settings());
    expect(tieOriginOf(doc, ref(4, 0), tied)).toBeNull();
    expect(score.tracks[0].staves[0].bars[4].voices[0].beats[0].notes[0].isTieDestination).toBeFalse();
  });

  for (const layout of layouts) {
    it(`agrees with alphaTab on a hammer-on followed by ${layout.name}`, () => {
      const doc = ComposerService.createEmptyScore();
      const note = put(doc, 0, 0, 3);
      note.effects.isHammerPullOrigin = true;
      layout.build(doc);

      expect(hammerDestinationOf(doc, ref(0, 0), note) !== null).toBe(finished(doc).isHammerPullOrigin);
    });

    it(`agrees with alphaTab on a legato slide followed by ${layout.name}`, () => {
      const doc = ComposerService.createEmptyScore();
      const note = put(doc, 0, 0, 3);
      note.effects.slide = 'legatoSlide';
      layout.build(doc);

      const kept = finished(doc).slideOutType !== alphaTab.model.SlideOutType.None;
      expect(slideTargetOf(doc, ref(0, 0), note) !== null).toBe(kept);
    });
  }

  it('finds no destination for a pitched note, which alphaTab files on no string', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const beats = doc.tracks[1].staves[0].bars[0].voices[0].beats;
    const pitched = (): NoteDoc => ({ pitch: { kind: 'pitched', noteValue: 0, octave: 4 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() });
    beats[0] = { ...beats[0], isRest: false, notes: [pitched()] };
    beats[1] = { ...beats[1], isRest: false, notes: [pitched()] };

    expect(hammerDestinationOf(doc, ref(0, 0, 1), beats[0].notes[0])).toBeNull();
    expect(slideTargetOf(doc, ref(0, 0, 1), beats[0].notes[0])).toBeNull();
  });

  it('finds a tied note\'s origin on its string, across a bar line', () => {
    const doc = ComposerService.createEmptyScore();
    const origin = put(doc, 0, 3, 3);
    const tied = put(doc, 1, 0, 3);
    tied.isTied = true;

    expect(tieOriginOf(doc, ref(1, 0), tied)).toBe(origin);
  });

  it('finds no origin for a note that is not tied, or one with nothing before it', () => {
    const doc = ComposerService.createEmptyScore();
    put(doc, 0, 0, 3);
    const untied = put(doc, 0, 1, 3);
    const lonely = put(doc, 0, 2, 1);
    lonely.isTied = true;

    expect(tieOriginOf(doc, ref(0, 1), untied)).toBeNull();
    expect(tieOriginOf(doc, ref(0, 2), lonely)).toBeNull();
  });

  it('finds a pitched tied note\'s origin by its pitch', () => {
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Piano', 'pno', 0, false, doc.masterBars));
    const beats = doc.tracks[1].staves[0].bars[0].voices[0].beats;
    const pitched = (noteValue: number, isTied: boolean): NoteDoc => ({ pitch: { kind: 'pitched', noteValue, octave: 4 }, isTied, accidental: 'auto', effects: createDefaultNoteEffects() });
    beats[0] = { ...beats[0], isRest: false, notes: [pitched(0, false), pitched(4, false)] };
    beats[1] = { ...beats[1], isRest: false, notes: [pitched(4, true)] };

    expect(tieOriginOf(doc, ref(0, 1, 1), beats[1].notes[0])).toBe(beats[0].notes[1]);
  });
});
