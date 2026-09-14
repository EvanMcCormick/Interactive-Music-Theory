import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { stateOf } from './composer.service.spec-helper';
import { frettedDocOf, soundingMidiOf } from './pitch-on-strings';
import { NotePitch, ScoreDoc, createDefaultNoteEffects, createRestBeat } from '../models/composer.model';

/**
 * Pen's click on a notation staff hands the service a pitch. On a staff with a tuning the note is written as a
 * string and a fret, as Guitar Pro writes it, since alphaTab cannot draw a pitched note on tablature
 * (`TabBarRenderer.collectSpaces` reads `note.string`, which a pitched note leaves at -1).
 */
describe('ComposerService Pen on a staff with a tuning', () => {
  let service: ComposerService;

  /** D5, the fourth space of the treble staff: bar 4, beat 2 in the hand check. */
  const D5: NotePitch = { kind: 'pitched', noteValue: 2, octave: 5 };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    service.setEntryMode('pen');
  });

  const beatAt = (barIndex: number, beatIndex: number, trackIndex = 0) =>
    service.doc.tracks[trackIndex].staves[0].bars[barIndex].voices[0].beats[beatIndex];

  it('writes a fretted note that sounds the pitch clicked', () => {
    service.setCursor({ barIndex: 3, beatIndex: 1 });

    service.setNoteAtCursor(D5, true);

    const notes = beatAt(3, 1).notes;
    expect(notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
    expect(soundingMidiOf(service.doc.tracks[0].staves[0], notes[0].pitch)).toBe(74);
    expect(stateOf(service).refusal).toBeNull();
  });

  it("plays it at the lowest fret, and on the caret's string only within 4 frets of that", () => {
    // D5 on the D string is fret 24: the hand check's caret, left on string 4.
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 3 });
    service.setNoteAtCursor(D5, false);

    expect(beatAt(0, 0).notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);

    // D4: fret 3 on the B string, and 7 on the G string the caret is on.
    service.setCursor({ barIndex: 0, beatIndex: 1, stringIndex: 2 });
    service.setNoteAtCursor({ kind: 'pitched', noteValue: 2, octave: 4 }, false);

    expect(beatAt(0, 1).notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 3, fret: 7 }]);
  });

  it('adds a second pitch to the chord on another string, and a click on a pitch already there takes it out', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
    service.setNoteAtCursor(D5, false);
    service.setNoteAtCursor({ kind: 'pitched', noteValue: 7, octave: 4 }, false);

    expect(beatAt(0, 0).notes.map(note => note.pitch)).toEqual([
      { kind: 'fretted', string: 1, fret: 10 },
      { kind: 'fretted', string: 2, fret: 8 }
    ]);

    service.setNoteAtCursor(D5, false);
    expect(beatAt(0, 0).notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 2, fret: 8 }]);
  });

  it('refuses a pitch below the lowest string, saying why, and commits nothing', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    const before = service.doc;

    service.setNoteAtCursor({ kind: 'pitched', noteValue: 2, octave: 2 }, true);

    expect(service.doc).toBe(before);
    expect(stateOf(service).refusal).toBe("That pitch is below this staff's lowest string.");
    expect(stateOf(service).cursor.beatIndex).toBe(0);
    expect(stateOf(service).canUndo).toBeFalse();
  });

  it('writes a fret for a pitch given to retypeNote too', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });

    service.retypeNote(stateOf(service).cursor, D5);

    expect(beatAt(0, 0).notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
  });

  it('still writes a pitched note on a staff with no tuning', () => {
    service.addTrack('Piano', 0, false);
    service.setCursor({ trackIndex: 1, staffIndex: 0, barIndex: 0, beatIndex: 0, stringIndex: null });

    service.setNoteAtCursor(D5, true);

    expect(beatAt(0, 0, 1).notes.map(note => note.pitch)).toEqual([D5]);
  });

  it('frets the pitched notes of a document put in on a staff with a tuning, and says what it left out', () => {
    const doc = ComposerService.createEmptyScore();
    const beats = doc.tracks[0].staves[0].bars[0].voices[0].beats;
    const pitches: NotePitch[] = [D5, { kind: 'pitched', noteValue: 4, octave: 1 }];
    pitches.forEach((pitch, index) => {
      beats[index].isRest = false;
      beats[index].notes = [{ pitch, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }];
    });

    service.replaceDocument(doc);

    expect(beatAt(0, 0).notes.map(note => note.pitch)).toEqual([{ kind: 'fretted', string: 1, fret: 10 }]);
    expect(beatAt(0, 1).isRest).toBeTrue();
    expect(stateOf(service).notice).toBe("1 note was out of reach of its staff's strings, and was left out.");
  });
});

/**
 * The mapper frets a pitched note on strings as its last guard, and warns when it has to (`ScoreDocMapperService.toScore`).
 * The composer's own paths must never leave it one: Pen writes frets, and `replaceDocument` frets a document put in whole.
 */
describe('ComposerService edit paths leave the mapper nothing to fret', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  const leftToFret = (doc: ScoreDoc): { converted: number; dropped: number } => {
    const { converted, dropped } = frettedDocOf(doc);
    return { converted, dropped };
  };
  const none = { converted: 0, dropped: 0 };

  it('on a new score, after Pen on a guitar, after a paste, and after a load of pitched notes on a tuned staff', () => {
    expect(leftToFret(service.doc)).withContext('new score').toEqual(none);

    service.setEntryMode('pen');
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.setNoteAtCursor({ kind: 'pitched', noteValue: 2, octave: 5 }, false);
    expect(service.doc.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length).toBe(1);
    expect(leftToFret(service.doc)).withContext('Pen').toEqual(none);

    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 1 });
    service.copy();
    service.setCursor({ barIndex: 2, beatIndex: 0 });
    service.paste();
    expect(service.doc.tracks[0].staves[0].bars[2].voices[0].beats[0].notes.length).toBe(1);
    expect(leftToFret(service.doc)).withContext('paste').toEqual(none);

    const loaded = ComposerService.createEmptyScore();
    const beats = loaded.tracks[0].staves[0].bars[0].voices[0].beats;
    beats[0] = { ...createRestBeat(4), isRest: false, notes: [{ pitch: { kind: 'pitched', noteValue: 2, octave: 5 }, isTied: false, accidental: 'auto', effects: createDefaultNoteEffects() }] };
    expect(leftToFret(loaded).converted).withContext('the loaded document holds a pitched note on strings').toBe(1);
    service.replaceDocument(loaded, { markClean: true, newComposition: true });
    expect(leftToFret(service.doc)).withContext('load').toEqual(none);
  });
});
