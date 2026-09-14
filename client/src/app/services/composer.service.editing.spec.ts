import { TestBed } from '@angular/core/testing';

import { ComposerService } from './composer.service';
import { beatsIn, stateOf, writeFret } from './composer.service.spec-helper';
import { writtenBeats, writtenOf } from './written-beats.spec-helper';

/**
 * The service commands M2's palette and keyboard reach, beyond M1's: the caret, refusals, entry, and note tools.
 *
 * Each `describe` belongs to one task of the M2 plan. The pure edit functions under these commands
 * have their own specs; what is pinned here is what only the service can get wrong - a range pressed
 * as one undo step, a refusal published and nothing committed, the selection after the press. Beats, bars and the
 * clipboard over a selection are in `composer.service.beats.spec.ts`, and what an edit says it did in
 * `composer.service.outcomes.spec.ts`.
 */
describe('ComposerService moveCursor', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('extends a range beat by beat, keeping where it started', () => {
    service.setCursor({ barIndex: 0, beatIndex: 1 });

    service.moveCursor({ kind: 'beat', delta: 1 }, true);
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    expect(stateOf(service).anchor?.beatIndex).toBe(1);
    expect(stateOf(service).cursor.beatIndex).toBe(3);
  });

  it('drops the range on a plain move', () => {
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    service.moveCursor({ kind: 'bar', delta: 1 });

    expect(stateOf(service).anchor).toBeNull();
    expect(stateOf(service).cursor.barIndex).toBe(1);
  });

  it('keeps the range when the string changes, since that moves the focus and not the selection', () => {
    service.moveCursor({ kind: 'beat', delta: 1 }, true);

    service.moveCursor({ kind: 'string', delta: 1 });

    expect(stateOf(service).anchor).not.toBeNull();
    expect(stateOf(service).cursor.stringIndex).toBe(1);
  });
});

describe('ComposerService refusals clear', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  /** A refusal on screen: a note tool pressed on the caret's rest. */
  const refuseAPress = (): void => {
    service.toggleNoteEffect('isGhost', true, false);
    expect(stateOf(service).refusal).not.toBeNull();
  };

  it('when the caret moves', () => {
    refuseAPress();
    service.setCursor({ beatIndex: 1 });
    expect(stateOf(service).refusal).toBeNull();
  });

  it('when the caret steps or changes string', () => {
    refuseAPress();
    service.moveCursorByBeat(1);
    expect(stateOf(service).refusal).toBeNull();

    refuseAPress();
    service.moveCursorByString(1);
    expect(stateOf(service).refusal).toBeNull();
  });

  it('when a range is extended or the whole track selected', () => {
    refuseAPress();
    service.extendSelectionTo({ beatIndex: 2 });
    expect(stateOf(service).refusal).toBeNull();

    service.setCursor({ beatIndex: 0 });
    refuseAPress();
    service.selectAllInTrack();
    expect(stateOf(service).refusal).toBeNull();
  });

  it('on undo and on redo', () => {
    writeFret(service, 0, 0, 3);
    service.setCursor({ beatIndex: 1 });

    refuseAPress();
    service.undo();
    expect(stateOf(service).refusal).toBeNull();

    refuseAPress();
    service.redo();
    expect(stateOf(service).refusal).toBeNull();
  });
});

describe('ComposerService duration refusals', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('says why a duration press on a grace did nothing, and still remembers the choice', () => {
    service.setCursor({ beatIndex: 1 });
    service.toggleGrace('beforeBeat');
    const before = JSON.stringify(service.doc);

    service.applyDurationAtCursor(8, 0);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/grace/i);
    expect(stateOf(service).inputDuration).toBe(8);
  });
});

describe('ComposerService entry mode', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('starts in Select, so a notation click writes nothing until Pen is chosen', () => {
    expect(stateOf(service).entryMode).toBe('select');
  });

  it('switches to Pen and back, committing nothing', () => {
    service.setEntryMode('pen');
    expect(stateOf(service).entryMode).toBe('pen');
    expect(stateOf(service).canUndo).toBeFalse();

    service.setEntryMode('select');
    expect(stateOf(service).entryMode).toBe('select');
  });

  it('goes back to Select for a new score', () => {
    service.setEntryMode('pen');

    service.reset();

    expect(stateOf(service).entryMode).toBe('select');
  });
});

describe('ComposerService retypeNote', () => {
  let service: ComposerService;
  const fret = (value: number) => ({ kind: 'fretted' as const, string: 1, fret: value });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
    service.setCursor({ barIndex: 0, beatIndex: 0, stringIndex: 0 });
  });

  it('makes "1" then "2" fret 12 and one undo step, the caret staying where the first digit left it', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);

    service.retypeNote(target, fret(12));

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(12));
    expect(stateOf(service).cursor.beatIndex).toBe(1);
    service.undo();
    expect(beatsIn(service)[0].isRest).toBeTrue();
    expect(stateOf(service).canUndo).toBeFalse();
  });

  it('is an undo step of its own when anything was committed in between', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);
    service.setDynamics('pp');

    service.retypeNote(target, fret(12));
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(1));
  });

  it('is an undo step of its own on another string of the same beat', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);

    service.retypeNote({ ...target, stringIndex: 2 }, { kind: 'fretted', string: 3, fret: 12 });
    service.undo();

    expect(beatsIn(service)[0].notes.map(note => note.pitch)).toEqual([fret(1)]);
  });

  it('is an undo step of its own for a pitched note', () => {
    service.addTrack('Piano', 0, false);
    service.setCursor({ trackIndex: 1, barIndex: 0, beatIndex: 0 });
    const target = stateOf(service).cursor;
    const pianoBeat = () => service.doc.tracks[1].staves[0].bars[0].voices[0].beats[0];
    service.setNoteAtCursor({ kind: 'pitched', noteValue: 0, octave: 4 }, true);

    service.retypeNote(target, { kind: 'pitched', noteValue: 2, octave: 4 });
    service.undo();

    expect(pianoBeat().notes.map(note => (note.pitch.kind === 'pitched' ? note.pitch.noteValue : null))).toEqual([0]);
  });

  it('is an undo step of its own after an undo and redo', () => {
    const target = stateOf(service).cursor;
    service.setNoteAtCursor(fret(1), true);
    service.undo();
    service.redo();

    service.retypeNote(target, fret(12));
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual(fret(1));
  });
});

describe('ComposerService note effects that must land', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a hammer-on on the last note, commits nothing, and says why', () => {
    writeFret(service, 0, 0, 5);
    const before = JSON.stringify(service.doc);

    service.toggleNoteEffect('isHammerPullOrigin', true, false);

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/land/i);
    expect(stateOf(service).canUndo).toBeTrue();
  });

  it('puts a hammer-on on a note that has one to land on', () => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 7);
    service.setCursor({ beatIndex: 0 });

    service.toggleNoteEffect('isHammerPullOrigin', true, false);

    expect(beatsIn(service)[0].notes[0].effects.isHammerPullOrigin).toBeTrue();
  });
});

describe('ComposerService fermata', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a press on a grace alone, saying why, and commits no undo step', () => {
    service.setCursor({ beatIndex: 1 });
    service.toggleGrace('beforeBeat');
    expect(beatsIn(service)[2].effects.grace).toBe('beforeBeat');
    const before = JSON.stringify(service.doc);

    service.toggleFermata();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/grace note has no bar position/i);
    // One undo takes back the grace itself: the refused press added no step of its own.
    service.undo();
    expect(beatsIn(service).some(beat => beat.effects.grace !== 'none')).toBeFalse();
  });
});

describe('ComposerService tuplets', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('refuses a tuplet that cannot make whole groups, saying why, and commits nothing', () => {
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ barIndex: 0, beatIndex: 1 });

    service.setTuplet({ numerator: 3, denominator: 2 });

    expect(stateOf(service).refusal).toMatch(/3:2 tuplet needs three beats/i);
    expect(stateOf(service).canUndo).toBeFalse();
  });

  it('refuses a delete, an insert or a grace inside a tuplet group, committing nothing', () => {
    // Three quarters made a triplet; then each press on the group's second beat alone would leave it open. A note
    // typed there is written at the beat's own value instead (see 'ComposerService typing over a tuplet beat').
    service.setCursor({ barIndex: 0, beatIndex: 0 });
    service.extendSelectionTo({ barIndex: 0, beatIndex: 2 });
    service.setTuplet({ numerator: 3, denominator: 2 });
    service.setCursor({ barIndex: 0, beatIndex: 1 });
    const before = JSON.stringify(service.doc);
    const presses: [string, () => void][] = [
      ['deleteBeats', () => service.deleteBeats()],
      ['insertBeat', () => service.insertBeat()],
      ['toggleGrace', () => service.toggleGrace('beforeBeat')]
    ];

    for (const [name, press] of presses) {
      press();

      expect(stateOf(service).refusal).withContext(name).toMatch(/break a tuplet group/i);
      expect(JSON.stringify(service.doc)).withContext(name).toBe(before);
    }
  });

  it('refuses Delete at the caret, a clear and a cut that remove a grace a tuplet group needs, committing nothing', () => {
    // Without the before-beat grace, the on-beat grace takes its 32nd from the mixed group's first beat, and alphaTab
    // never closes the group.
    const doc = ComposerService.createEmptyScore();
    doc.tracks[0].staves[0].bars[0].voices[0].beats = writtenBeats('n4 g o n4t3 n8t3 n2');
    service.replaceDocument(doc);
    const before = JSON.stringify(service.doc);
    const presses: [string, () => void][] = [
      ['deleteAtCursor', () => (service.setCursor({ barIndex: 0, beatIndex: 1 }), service.deleteAtCursor())],
      ['clearSelectionToRests', () => (service.setCursor({ barIndex: 0, beatIndex: 0 }), service.extendSelectionTo({ beatIndex: 1 }), service.clearSelectionToRests())],
      ['cut', () => (service.setCursor({ barIndex: 0, beatIndex: 0 }), service.extendSelectionTo({ beatIndex: 1 }), service.cut())]
    ];

    for (const [name, press] of presses) {
      press();

      expect(stateOf(service).refusal).withContext(name).toMatch(/leave a tuplet group unfinished/i);
      expect(JSON.stringify(service.doc)).withContext(name).toBe(before);
    }
  });
});

describe('ComposerService clearing a grace at a fermata', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('says Delete at the caret removed a fermata, when the grace it cleared moved the fermata\'s note', () => {
    // The second guitar's quarter plays at 120, after its on-beat grace, and holds the fermata there. With the grace
    // gone it plays at 0, where the first guitar has a quarter the fermata would reach.
    const doc = ComposerService.createEmptyScore();
    doc.tracks.push(ComposerService.createTrack('Guitar 2', 'gt2', 25, true, doc.masterBars));
    doc.tracks[1].staves[0].bars[0].voices[0].beats = writtenBeats('o n4 n4 n4 n4');
    doc.tracks[1].staves[0].bars[0].voices[0].beats[1].effects.fermata = { type: 'medium', length: 1 };
    service.replaceDocument(doc);
    service.setCursor({ trackIndex: 1, barIndex: 0, beatIndex: 0 });

    service.deleteAtCursor();

    expect(writtenOf(service.doc.tracks[1].staves[0].bars[0].voices[0].beats)).toBe('n4 n4 n4 n4');
    expect(service.doc.tracks[1].staves[0].bars[0].voices[0].beats[0].effects.fermata).toBeNull();
    expect(stateOf(service).notice).toBe('1 fermata removed: its note moved where it would reach other tracks.');
  });
});

describe('ComposerService vibrato and ties over a range', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  /** Frets 5, 5 tied to it, and 7 on string 1, with the three beats selected. */
  const tiedPhrase = (): void => {
    writeFret(service, 0, 0, 5);
    writeFret(service, 0, 1, 5);
    service.toggleTie();
    writeFret(service, 0, 2, 7);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 2 });
  };
  const vibratos = (): string[] => beatsIn(service).slice(0, 3).map(beat => beat.notes[0].effects.vibrato);

  it('puts vibrato on a phrase\'s notes past a tied continuation, which draws its origin\'s', () => {
    tiedPhrase();
    expect(beatsIn(service)[1].notes[0].isTied).toBeTrue();

    service.toggleNoteEffect('vibrato', 'slight', 'none');

    expect(stateOf(service).refusal).toBeNull();
    expect(vibratos()).toEqual(['slight', 'none', 'slight']);
  });

  it('clears vibrato from the phrase, a continuation\'s own stale copy included', () => {
    tiedPhrase();
    service.toggleNoteEffect('vibrato', 'slight', 'none');
    const stale = structuredClone(service.doc);
    stale.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].effects.vibrato = 'slight';
    service.replaceDocument(stale);
    service.setCursor({ beatIndex: 0 });
    service.extendSelectionTo({ beatIndex: 2 });

    service.toggleNoteEffect('vibrato', 'slight', 'none');

    expect(stateOf(service).refusal).toBeNull();
    expect(vibratos()).toEqual(['none', 'none', 'none']);
  });

  it('refuses a tie with nothing before it to tie from, committing nothing', () => {
    writeFret(service, 0, 0, 5);
    const before = JSON.stringify(service.doc);

    service.toggleTie();

    expect(JSON.stringify(service.doc)).toBe(before);
    expect(stateOf(service).refusal).toMatch(/tie from/i);
  });
});

describe('ComposerService pitch and string moves', () => {
  let service: ComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComposerService);
  });

  it('moves the caret\'s note to the string above, and the caret with it', () => {
    writeFret(service, 0, 0, 5, 2);

    service.moveNotesToString(-1);

    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 0 });
    expect(stateOf(service).cursor.stringIndex).toBe(0);
  });

  it('refuses a move that does not fit, publishing why and leaving the caret', () => {
    writeFret(service, 0, 0, 3, 2);

    service.moveNotesToString(-1);

    expect(stateOf(service).refusal).toMatch(/fret -2/);
    expect(stateOf(service).cursor.stringIndex).toBe(1);
  });

  it('moves a semitone as one undo step', () => {
    writeFret(service, 0, 0, 5);

    service.shiftSemitone(1);
    service.undo();

    expect(beatsIn(service)[0].notes[0].pitch).toEqual({ kind: 'fretted', string: 1, fret: 5 });
  });
});
